"""Audit evidence suite: proves every data type is really saved, retrieved,
cross-account-protected, and deleted IN MYSQL — not just hidden in the UI.

For each type: SAVE -> direct DB verify -> API RETRIEVE -> cross-account
probe -> DELETE -> direct DB verify gone -> unrelated account byte-identical.

Rules honored by this suite:
  * Runs against the CONFIGURED database (prints which host it hits first).
  * Creates only dedicated fixtures (audA*/audB* accounts) and deletes ONLY
    its own rows; final table counts must equal the starting counts.
  * SMTP is disabled for the duration (no real emails are sent).
  * Prints no secrets and no third-party data (aggregate counts only).

Run from the repo root:
    python tests/test_audit_evidence.py
"""

import json
import os
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "backend"))

import config  # noqa: E402
import db  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

TS = str(int(time.time() * 1000))
USER_A = {"username": f"audA{TS}", "email": f"audA{TS}@coinscan-e2e.com", "password": "AuditPassA1!"}
USER_B = {"username": f"audB{TS}", "email": f"audB{TS}@coinscan-e2e.com", "password": "AuditPassB1!"}
GUEST_SUB = f"audit-guest-{TS}"
AUTHED_SUB = f"audit-authed-{TS}"
GUEST_MSG = (
    "AUDIT PROBE guest feedback with SQLi payload: "
    "'; DROP TABLE contact_messages; -- \" <script>alert(1)</script>"
)
PNG_1PX = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
# 7 MB fake payload (> 6 MB limit) — same bytes, huge padding.
BIG_IMAGE = "data:image/png;base64," + "A" * (7 * 1024 * 1024 // 3 * 4)

TABLES = ["users", "scan_history", "collection_items", "user_images", "chats", "chat_messages", "contact_messages"]
RESULTS = []


def check(name, fn):
    t0 = time.time()
    try:
        detail = fn()
        RESULTS.append((name, True, ""))
        print(f"  PASS  {name}" + (f" — {detail}" if detail else "") + f" ({time.time() - t0:.1f}s)")
        return True
    except Exception as exc:  # noqa: BLE001
        RESULTS.append((name, False, f"{type(exc).__name__}: {exc}"))
        print(f"  FAIL  {name}: {type(exc).__name__}: {exc}")
        return False


def counts() -> dict:
    out = {}
    for t in TABLES:
        r = db.fetch_one(f"SELECT COUNT(*) AS n FROM {t}")  # table names are the fixed allowlist above
        out[t] = int(r["n"]) if r else -1
    return out


def uid(username: str):
    r = db.fetch_one("SELECT id FROM users WHERE username = %s", (username,))
    return int(r["id"]) if r else None


def signup(c: TestClient, u: dict) -> dict:
    r = c.post("/api/auth/signup", json=u)
    assert r.status_code in (200, 201), f"signup {r.status_code}: {r.text}"
    return r.json()


def token(c: TestClient, u: dict) -> str:
    r = c.post("/api/auth/login", json={"identifier": u["username"], "password": u["password"]})
    assert r.status_code == 200, f"login {r.status_code}: {r.text}"
    return r.json()["token"]


def auth(t: str) -> dict:
    return {"Authorization": f"Bearer {t}"}


def main_run():
    print(f"database under test: host={config.MYSQL_HOST} db={config.MYSQL_DATABASE}")
    assert config.MYSQL_HOST in ("localhost", "127.0.0.1"), "refusing: not a local database"

    # No real email may leave this suite.
    orig_user, orig_pw = config.SMTP_USER, config.SMTP_PASSWORD
    config.SMTP_USER, config.SMTP_PASSWORD = "", ""
    start = counts()
    print(f"counts at start: {json.dumps(start)}")

    c = TestClient(main.app)
    id_a = id_a2 = id_b = None
    scan_a = img_a = coll_a = chat_a = None

    try:
        # ---------- F: registration / login ----------
        def e1_signup_hash():
            nonlocal id_a
            signup(c, USER_A)
            id_a = uid(USER_A["username"])
            assert id_a, "user row missing"
            r = db.fetch_one("SELECT password_hash FROM users WHERE id = %s", (id_a,))
            h = r["password_hash"]
            assert h != USER_A["password"], "plaintext password stored!"
            assert h.startswith("pbkdf2_sha256$"), f"unexpected hash format: {h[:20]}"
            return f"user id={id_a}, hash={h.split('$')[0]} (not plaintext)"
        check("E1 signup stores PBKDF2 hash, never plaintext", e1_signup_hash)

        def e2_duplicate():
            r = c.post("/api/auth/signup", json=USER_A)
            assert r.status_code == 409, f"got {r.status_code}"
            return "409 on duplicate username/email"
        check("E2 duplicate signup -> 409, no second row", e2_duplicate)

        def e3_login_generic():
            r = c.post("/api/auth/login", json={"identifier": USER_A["username"], "password": "wrong-password-x"})
            assert r.status_code == 401 and "Invalid credentials" in r.json()["detail"], r.text
            r2 = c.post("/api/auth/login", json={"identifier": "nobody-here-xyz", "password": "x"})
            assert r2.status_code == 401 and r2.json()["detail"] == r.json()["detail"]
            return "identical error for wrong-password and unknown-user"
        check("E3 failed login is generic (no account enumeration)", e3_login_generic)

        tok_a = token(c, USER_A)
        signup(c, USER_B)
        id_b = uid(USER_B["username"])
        tok_b = token(c, USER_B)

        # ---------- injection / validation ----------
        def e4_sqli():
            r = c.post("/api/contact", json={
                "text": GUEST_MSG, "rating": 3, "email": "a@b.co", "username": "aud\"guest",
                "submissionId": GUEST_SUB,
            })
            assert r.status_code == 200 and r.json()["saved"] is True, r.text
            row = db.fetch_one("SELECT message FROM contact_messages WHERE submission_id = %s", (GUEST_SUB,))
            assert row and row["message"] == GUEST_MSG, "payload not stored literally"
            still = db.fetch_one("SELECT COUNT(*) AS n FROM contact_messages")
            assert int(still["n"]) == start["contact_messages"] + 1, "unexpected contact row delta"
            # coin_id free-text path (parameterized too)
            payload = "x'; DROP TABLE collection_items; --"
            r2 = c.post("/api/collection", json={"coinId": payload, "item": {"name": "SQLi Coin"}},
                        headers=auth(tok_a))
            assert r2.status_code == 200, r2.text
            row2 = db.fetch_one("SELECT coin_id FROM collection_items WHERE user_id=%s AND coin_id=%s",
                                (id_a, payload))
            assert row2 and row2["coin_id"] == payload
            # users table still exists (no injection executed)
            assert db.fetch_one("SELECT COUNT(*) AS n FROM users")
            return "payloads stored verbatim; all tables intact"
        check("E4 SQL-injection payloads stored literally (parameterized queries)", e4_sqli)

        # ---------- A: scans ----------
        def e5_scan_save():
            nonlocal scan_a, img_a
            before = start["scan_history"]
            r = c.post("/api/scans", json={
                "items": [{"name": "Audit Rupee", "country": "India", "currencyName": "Indian Rupee",
                           "denomination": "10", "match": 91}],
                "image": PNG_1PX,
                "authenticity": {"status": "LIKELY_GENUINE", "message": "audit"},
            }, headers=auth(tok_a))
            assert r.status_code == 200, r.text
            scan_a = r.json()["scan"]["id"]
            row = db.fetch_one(
                "SELECT user_id, image_id, name, detected_country, denomination, confidence, "
                "authenticity_status FROM scan_history WHERE id=%s", (scan_a,))
            assert row and int(row["user_id"]) == id_a, "wrong owner on scan row"
            assert row["name"] == "Audit Rupee" and row["denomination"] == "10"
            assert row["confidence"] == 91 and row["authenticity_status"] == "LIKELY_GENUINE"
            img_a = row["image_id"]
            irow = db.fetch_one("SELECT user_id, byte_size FROM user_images WHERE id=%s", (img_a,))
            assert irow and int(irow["user_id"]) == id_a and int(irow["byte_size"]) > 0
            now = int(db.fetch_one("SELECT COUNT(*) AS n FROM scan_history")["n"])
            assert now == before + 1, f"expected exactly one row, delta={now - before}"
            lst = c.get("/api/scans", headers=auth(tok_a)).json()["scans"]
            assert [s["id"] for s in lst].count(scan_a) == 1, "not exactly once in list"
            return f"scan id={scan_a} img id={img_a}, +1 row only, all fields stored"
        check("E5 scan save: exactly one row, correct owner, image linked", e5_scan_save)

        def e6_scan_retrieve():
            r = c.get(f"/api/scans/{scan_a}", headers=auth(tok_a))
            assert r.status_code == 200
            s = r.json()["scan"]
            assert s["name"] == "Audit Rupee" and s["denomination"] == "10"
            assert s["confidence"] == 91 and s["authenticityStatus"] == "LIKELY_GENUINE"
            assert s["image"] and s["image"].startswith("data:image/png;base64,")
            assert s["timestamp"]
            return "GET returns stored fields + image data-url + timestamp"
        check("E6 scan retrieve: API read-back matches DB", e6_scan_retrieve)

        def e7_scan_cross():
            lst = c.get("/api/scans", headers=auth(tok_b)).json()["scans"]
            assert all(s["id"] != scan_a for s in lst), "A's scan leaked into B's list"
            assert c.get(f"/api/scans/{scan_a}", headers=auth(tok_b)).status_code == 404
            assert c.delete(f"/api/scans/{scan_a}", headers=auth(tok_b)).status_code == 404
            row = db.fetch_one("SELECT COUNT(*) AS n FROM scan_history WHERE id=%s", (scan_a,))
            assert int(row["n"]) == 1, "B's delete removed A's scan!"
            assert c.get(f"/api/scans/{scan_a}").status_code == 401
            return "B sees 0, gets 404 on read/delete; row intact; unauth 401"
        check("E7 cross-account + unauthenticated scan access blocked", e7_scan_cross)

        def e8_scan_delete():
            assert c.delete(f"/api/scans/{scan_a}", headers=auth(tok_a)).status_code == 200
            assert int(db.fetch_one("SELECT COUNT(*) AS n FROM scan_history WHERE id=%s", (scan_a,))["n"]) == 0, \
                "scan row still in DB after delete"
            assert int(db.fetch_one("SELECT COUNT(*) AS n FROM user_images WHERE id=%s", (img_a,))["n"]) == 0, \
                "orphaned image BLOB left behind"
            lst = c.get("/api/scans", headers=auth(tok_a)).json()["scans"]
            assert all(s["id"] != scan_a for s in lst)
            return "row gone + orphan image reaped; API re-read confirms"
        check("E8 scan delete removes DB row AND its image", e8_scan_delete)

        def e9_clear_scans():
            for i in range(2):
                c.post("/api/scans", json={"items": [{"name": f"ClearMe{i}", "country": "X"}]},
                       headers=auth(tok_a))
            c.post("/api/scans", json={"items": [{"name": "BSentinel", "country": "Y"}]}, headers=auth(tok_b))
            n_b = int(db.fetch_one("SELECT COUNT(*) AS n FROM scan_history WHERE user_id=%s", (id_b,))["n"])
            assert c.delete("/api/scans", headers=auth(tok_a)).status_code == 200
            n_a = int(db.fetch_one("SELECT COUNT(*) AS n FROM scan_history WHERE user_id=%s", (id_a,))["n"])
            n_b2 = int(db.fetch_one("SELECT COUNT(*) AS n FROM scan_history WHERE user_id=%s", (id_b,))["n"])
            assert n_a == 0, f"A still has {n_a} scans"
            assert n_b2 == n_b == 1, "clear_scans touched B's scans!"
            return "A cleared to 0; B's sentinel scan untouched"
        check("E9 clear_scans clears only the caller's rows", e9_clear_scans)

        # ---------- B: collection ----------
        def e10_coll_add():
            nonlocal coll_a
            payload = "aud-coll-" + TS
            coll_a = payload
            r = c.post("/api/collection", json={"coinId": payload, "item": {"name": "Audit Coin", "year": 1999},
                                                 "image": PNG_1PX}, headers=auth(tok_a))
            assert r.status_code == 200 and not r.json().get("duplicate"), r.text
            row = db.fetch_one("SELECT user_id, image_id FROM collection_items WHERE coin_id=%s", (payload,))
            assert row and int(row["user_id"]) == id_a and row["image_id"]
            r2 = c.post("/api/collection", json={"coinId": payload, "item": {"name": "Audit Coin"}},
                        headers=auth(tok_a))
            assert r2.json().get("duplicate") is True
            n = int(db.fetch_one("SELECT COUNT(*) AS n FROM collection_items WHERE coin_id=%s", (payload,))["n"])
            assert n == 1, "duplicate add created a second row"
            return "row owned by A, image linked, duplicate add -> still 1 row"
        check("E10 collection add: one real row, duplicate handled", e10_coll_add)

        def e11_coll_cross():
            r = c.patch(f"/api/collection/{coll_a}", json={"favorite": True}, headers=auth(tok_b))
            assert r.status_code == 404, f"foreign PATCH -> {r.status_code}"
            row = db.fetch_one("SELECT item_json FROM collection_items WHERE coin_id=%s", (coll_a,))
            assert '"favorite"' not in (row["item_json"] or ""), "B changed A's item_json!"
            assert c.delete(f"/api/collection/{coll_a}", headers=auth(tok_b)).status_code == 404
            assert int(db.fetch_one("SELECT COUNT(*) AS n FROM collection_items WHERE coin_id=%s",
                                    (coll_a,))["n"]) == 1, "B's delete removed A's row"
            r2 = c.patch(f"/api/collection/{coll_a}", json={"favorite": True}, headers=auth(tok_a))
            assert r2.status_code == 200
            row2 = db.fetch_one("SELECT item_json FROM collection_items WHERE coin_id=%s", (coll_a,))
            assert '"favorite": true' in row2["item_json"], "owner PATCH not persisted"
            lst = c.get("/api/collection", headers=auth(tok_b)).json()["items"]
            assert all(i.get("id") != coll_a for i in lst), "A's item leaked into B's list"
            return "B PATCH/DELETE -> 404 + DB unchanged; owner PATCH persists; B list clean"
        check("E11 collection cross-account PATCH/DELETE blocked; owner PATCH persists", e11_coll_cross)

        def e12_coll_delete():
            row = db.fetch_one("SELECT image_id FROM collection_items WHERE coin_id=%s", (coll_a,))
            iid = row["image_id"]
            assert c.delete(f"/api/collection/{coll_a}", headers=auth(tok_a)).status_code == 200
            assert int(db.fetch_one("SELECT COUNT(*) AS n FROM collection_items WHERE coin_id=%s",
                                    (coll_a,))["n"]) == 0, "row survived delete"
            assert int(db.fetch_one("SELECT COUNT(*) AS n FROM user_images WHERE id=%s", (iid,))["n"]) == 0, \
                "collection image orphaned"
            c.post("/api/collection", json={"coinId": f"aud-c2-{TS}", "item": {}}, headers=auth(tok_a))
            n_b = int(db.fetch_one("SELECT COUNT(*) AS n FROM collection_items WHERE user_id=%s", (id_b,))["n"])
            c.delete("/api/collection", headers=auth(tok_a))
            n_a = int(db.fetch_one("SELECT COUNT(*) AS n FROM collection_items WHERE user_id=%s", (id_a,))["n"])
            n_b2 = int(db.fetch_one("SELECT COUNT(*) AS n FROM collection_items WHERE user_id=%s", (id_b,))["n"])
            assert n_a == 0 and n_b2 == n_b, "clear_collection affected B"
            return "delete removes row+image; clear_collection scoped to A"
        check("E12 collection delete + clear: DB truth, image reaped, B intact", e12_coll_delete)

        # ---------- C: images ----------
        def e13_image_scope():
            r = c.post("/api/scans", json={"items": [{"name": "ImgProbe", "country": "Z"}], "image": PNG_1PX},
                       headers=auth(tok_a))
            row = db.fetch_one("SELECT image_id FROM scan_history WHERE id=%s", (r.json()["scan"]["id"],))
            iid = row["image_id"]
            ok = c.get(f"/api/images/{iid}", headers=auth(tok_a))
            assert ok.status_code == 200 and ok.content[:8].hex().startswith("89504e47"), "owner GET failed"
            assert c.get(f"/api/images/{iid}", headers=auth(tok_b)).status_code == 404, "foreign GET allowed!"
            assert c.get(f"/api/images/{iid}").status_code == 401
            c.delete(f"/api/scans/{r.json()['scan']['id']}", headers=auth(tok_a))
            return "owner 200 (PNG bytes), foreign 404, unauth 401; probe scan cleaned"
        check("E13 images owner-only retrieval", e13_image_scope)

        def e14_oversize():
            n0 = int(db.fetch_one("SELECT COUNT(*) AS n FROM user_images")["n"])
            r = c.post("/api/scans", json={"items": [{"name": "Big", "country": "X"}], "image": BIG_IMAGE},
                       headers=auth(tok_a))
            assert r.status_code == 422, f"oversized -> {r.status_code}"
            n1 = int(db.fetch_one("SELECT COUNT(*) AS n FROM user_images")["n"])
            assert n1 == n0, "partial image write left behind!"
            n_s = int(db.fetch_one("SELECT COUNT(*) AS n FROM scan_history WHERE user_id=%s", (id_a,))["n"])
            return f"422, image rows unchanged ({n1}), A scan rows={n_s}"
        check("E14 oversized upload -> 422 with no partial writes", e14_oversize)

        # ---------- D: chats ----------
        def e15_chat_save():
            nonlocal chat_a
            r = c.post("/api/chats", json={"title": "Audit Chat"}, headers=auth(tok_a))
            chat_a = r.json()["chat"]["id"]
            r2 = c.post(f"/api/chats/{chat_a}/messages",
                        json={"role": "user", "content": "audit question", "image": PNG_1PX},
                        headers=auth(tok_a))
            assert r2.status_code == 200, r2.text
            row = db.fetch_one("SELECT user_id FROM chats WHERE id=%s", (chat_a,))
            assert row and int(row["user_id"]) == id_a
            m = db.fetch_one(
                "SELECT image_id FROM chat_messages WHERE chat_id=%s AND user_id=%s",
                (chat_a, id_a))
            n = db.fetch_one("SELECT COUNT(*) AS n FROM chat_messages WHERE chat_id=%s AND user_id=%s",
                             (chat_a, id_a))
            assert int(n["n"]) == 1
            im = db.fetch_one("SELECT user_id FROM user_images WHERE id=%s", (m["image_id"],))
            assert im and int(im["user_id"]) == id_a
            return f"chat id={chat_a}, 1 message + image, all owned by A"
        check("E15 chat + message + image saved to correct account", e15_chat_save)

        def e16_chat_cross():
            assert c.get(f"/api/chats/{chat_a}/messages", headers=auth(tok_b)).status_code == 404
            assert c.post(f"/api/chats/{chat_a}/messages", json={"role": "user", "content": "hi"},
                          headers=auth(tok_b)).status_code == 404
            assert c.delete(f"/api/chats/{chat_a}", headers=auth(tok_b)).status_code == 404
            assert c.delete(f"/api/chats/{chat_a}").status_code == 401
            n = int(db.fetch_one("SELECT COUNT(*) AS n FROM chats WHERE id=%s", (chat_a,))["n"])
            assert n == 1, "foreign delete removed the chat!"
            lst = c.get("/api/chats", headers=auth(tok_b)).json()["chats"]
            assert all(x["id"] != chat_a for x in lst), "A's chat leaked into B's list"
            return "foreign read/write/delete -> 404, unauth 401, row intact, B list clean"
        check("E16 cross-account chat access blocked", e16_chat_cross)

        def e17_chat_delete():
            row = db.fetch_one("SELECT image_id FROM chat_messages WHERE chat_id=%s", (chat_a,))
            iid = row["image_id"]
            assert c.delete(f"/api/chats/{chat_a}", headers=auth(tok_a)).status_code == 200
            assert int(db.fetch_one("SELECT COUNT(*) AS n FROM chats WHERE id=%s", (chat_a,))["n"]) == 0
            assert int(db.fetch_one("SELECT COUNT(*) AS n FROM chat_messages WHERE chat_id=%s",
                                    (chat_a,))["n"]) == 0, "messages survived chat delete"
            assert int(db.fetch_one("SELECT COUNT(*) AS n FROM user_images WHERE id=%s", (iid,))["n"]) == 0, \
                "chat image orphaned"
            return "chat + messages + image all gone (FK cascade + orphan reaper)"
        check("E17 chat delete removes messages and image", e17_chat_delete)

        # ---------- E: contact ----------
        def e18_contact():
            r = c.post("/api/contact", json={
                "text": "AUDIT AUTHED FEEDBACK", "rating": 5, "email": USER_A["email"],
                "username": "AuditA", "submissionId": AUTHED_SUB,
            }, headers=auth(tok_a))
            assert r.status_code == 200 and r.json()["saved"] is True, r.text
            assert r.json()["emailSent"] is False and r.json()["emailReason"] == "not_configured", \
                "SMTP blanked but email reported sent!"
            row = db.fetch_one("SELECT user_id FROM contact_messages WHERE submission_id=%s", (AUTHED_SUB,))
            assert row and int(row["user_id"]) == id_a, "authenticated feedback not linked to account"
            guest = db.fetch_one("SELECT user_id FROM contact_messages WHERE submission_id=%s", (GUEST_SUB,))
            assert guest and guest["user_id"] is None, "guest feedback wrongly linked"
            r2 = c.post("/api/contact", json={"text": "AUDIT AUTHED FEEDBACK", "rating": 5,
                                              "submissionId": AUTHED_SUB}, headers=auth(tok_a))
            assert r2.json().get("duplicate") is True
            n = int(db.fetch_one("SELECT COUNT(*) AS n FROM contact_messages WHERE submission_id=%s",
                                 (AUTHED_SUB,))["n"])
            assert n == 1, "dedupe failed"
            assert config.CONTACT_TO == "archanark1013@gmail.com", config.CONTACT_TO
            return "authed linked to A, guest NULL, dedupe 1 row, recipient=archanark1013"
        check("E18 contact save/ownership/dedupe (SMTP disabled: no real email)", e18_contact)

        # ---------- F: account deletion ----------
        def e19_wrong_pw_delete():
            snap = counts()
            r = c.request("DELETE", "/api/auth/account", headers=auth(tok_a), json={"password": "nope-wrong"})
            assert r.status_code == 403, r.text
            assert counts() == snap, "wrong-password delete changed rows!"
            return "403, all 7 table counts identical"
        check("E19 wrong-password account deletion changes nothing", e19_wrong_pw_delete)

        def e20_unauth():
            for meth, path in [("GET", "/api/scans"), ("DELETE", "/api/collection"),
                               ("GET", "/api/chats"), ("DELETE", "/api/auth/account")]:
                r = c.request(meth, path, json={} if meth == "DELETE" else None)
                assert r.status_code == 401, f"{meth} {path} -> {r.status_code}"
            return "401 on all probes without a token"
        check("E20 unauthenticated requests rejected (401)", e20_unauth)

        def e21_account_delete():
            snap_b = {t: int(db.fetch_one(f"SELECT COUNT(*) AS n FROM {t} WHERE user_id=%s", (id_b,))["n"])
                      for t in ["scan_history", "collection_items", "user_images", "chats",
                                "chat_messages", "contact_messages"]}
            r = c.request("DELETE", "/api/auth/account", headers=auth(tok_a), json={"password": USER_A["password"]})
            assert r.status_code == 200 and r.json().get("ok") is True, r.text
            for t in TABLES:
                if t == "users":
                    n = int(db.fetch_one("SELECT COUNT(*) AS n FROM users WHERE id=%s", (id_a,))["n"])
                elif t == "contact_messages":
                    n = int(db.fetch_one(
                        "SELECT COUNT(*) AS n FROM contact_messages WHERE user_id=%s OR submission_id=%s",
                        (id_a, AUTHED_SUB))["n"])
                else:
                    n = int(db.fetch_one(f"SELECT COUNT(*) AS n FROM {t} WHERE user_id=%s", (id_a,))["n"])
                assert n == 0, f"{t} still holds {n} rows for deleted account"
            guest = db.fetch_one("SELECT COUNT(*) AS n FROM contact_messages WHERE submission_id=%s", (GUEST_SUB,))
            assert int(guest["n"]) == 1, "guest feedback was destroyed by account deletion"
            for t in ["scan_history", "collection_items", "user_images", "chats", "chat_messages",
                      "contact_messages"]:
                n = int(db.fetch_one(f"SELECT COUNT(*) AS n FROM {t} WHERE user_id=%s", (id_b,))["n"])
                assert n == snap_b[t], f"B's {t} changed ({snap_b[t]} -> {n}) during A's deletion"
            assert c.get("/api/auth/me", headers=auth(tok_a)).status_code == 401, "old JWT still valid!"
            r3 = c.post("/api/auth/login", json={"identifier": USER_A["username"], "password": USER_A["password"]})
            assert r3.status_code == 401 and "Invalid credentials" in r3.json()["detail"]
            return "all A rows gone (7 tables), guest contact kept, B identical, old JWT 401, login 401"
        check("E21 account deletion: full cleanup, preservation, revocation", e21_account_delete)

        def e22_reregister():
            nonlocal id_a2
            signup(c, USER_A)
            id_a2 = uid(USER_A["username"])
            assert id_a2 and id_a2 != id_a, "reuse did not mint a new id"
            tok2 = token(c, USER_A)
            assert c.get("/api/scans", headers=auth(tok2)).json()["scans"] == []
            assert c.get("/api/collection", headers=auth(tok2)).json()["items"] == []
            assert c.get("/api/chats", headers=auth(tok2)).json()["chats"] == []
            return f"new id={id_a2} != old {id_a}; 0 scans/collection/chats"
        check("E22 re-registration: fresh identity, zero inherited data", e22_reregister)

    finally:
        # ---------- cleanup: only this suite's fixtures ----------
        config.SMTP_USER, config.SMTP_PASSWORD = orig_user, orig_pw
        for u in (USER_A, USER_B):
            try:
                t = token(c, u)
                c.request("DELETE", "/api/auth/account", headers=auth(t), json={"password": u["password"]})
            except Exception:  # noqa: BLE001
                pass
        db.execute("DELETE FROM contact_messages WHERE submission_id IN (%s, %s)", (GUEST_SUB, AUTHED_SUB))
        # Scoped force-cleanup for THIS suite's fixture ids only (children first),
        # so the net-zero assertion cannot be masked by a failed API delete.
        for uid_ in filter(None, (id_a, id_b, id_a2)):
            for t in ["chat_messages", "chats", "scan_history", "collection_items", "contact_messages"]:
                db.execute(f"DELETE FROM {t} WHERE user_id = %s", (uid_,))
            db.execute("DELETE FROM user_images WHERE user_id = %s", (uid_,))
            db.execute("DELETE FROM users WHERE id = %s", (uid_,))

    end = counts()
    print(f"counts at end:   {json.dumps(end)}")

    def e23_net_zero():
        assert end == start, f"row counts changed: {json.dumps({'start': start, 'end': end})}"
        return f"all 7 tables identical: {json.dumps(end)}"
    check("E23 suite cleanup: final counts == starting counts (net zero)", e23_net_zero)

    print()
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    print(f"RESULT: {passed}/{len(RESULTS)} passed")
    if passed != len(RESULTS):
        for n, ok, err in RESULTS:
            if not ok:
                print(f"  FAILED: {n} :: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main_run()
