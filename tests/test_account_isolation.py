"""User account isolation tests: 4 accounts, ownership on every resource.

Covers:
  I1  every account gets a different, stable user id
  I2  collection items are visible ONLY to their owner (A/B/C/D)
  I3  scan history is per-account
  I4  chats + messages are per-account
  I5  images are owner-only
  I6  cross-account access by id -> 404/401 (view/edit/delete via tampering)
  I7  delete affects only the authenticated owner
  I8  contact feedback: linked to the signed-in user's id from the VERIFIED
      token; guests (and invalid tokens) -> user_id NULL, submission kept
  I9  contact values stored exactly; rating 0 = "not rated" stays 0
  I10 duplicate submissionId -> single row (idempotent)

Runs in-process against the real MySQL (FastAPI TestClient), no live server:
    python tests/test_account_isolation.py

Cleanup removes ONLY the rows this test created (marker/contact rows +
the four iso* accounts it signed up).
"""

import os
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "backend"))

import db  # noqa: E402

RESULTS = []
TS = str(int(time.time() * 1000))
MARKER = f"iso-tests-{TS}"
PNG_1PX = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def check(name, fn):
    started = time.time()
    try:
        fn()
        RESULTS.append((name, True, ""))
        print(f"  PASS  {name} ({time.time() - started:.1f}s)")
    except Exception as exc:  # noqa: BLE001
        RESULTS.append((name, False, f"{type(exc).__name__}: {exc}"))
        print(f"  FAIL  {name}: {type(exc).__name__}: {exc}")


def expect(cond, msg):
    if not cond:
        raise AssertionError(msg)


def client():
    from fastapi.testclient import TestClient
    from main import app
    return TestClient(app)


def hdr(token):
    return {"Authorization": f"Bearer {token}"}


def make_accounts(n=4):
    c = client()
    letters = "ABCD"[:n]
    accts = {}
    for L in letters:
        r = c.post("/api/auth/signup", json={
            "username": f"iso{TS}{L.lower()}",
            "email": f"iso{TS}{L.lower()}@coinscan-e2e.com",
            "password": "Iso!Pass123",
        })
        expect(r.status_code == 200, f"signup {L}: {r.status_code} {r.text}")
        body = r.json()
        accts[L] = {"id": body["user"]["id"], "token": body["token"], "c": c}
    accts["client"] = c
    return accts


def get_json(c, path, token=None, expect_status=200):
    r = c.get(path, headers=hdr(token) if token else {})
    expect(r.status_code == expect_status,
           f"GET {path} -> {r.status_code} (wanted {expect_status}): {r.text[:200]}")
    return r.json()


# --------------------------------------------------------------------------
# I1 — distinct ids
# --------------------------------------------------------------------------

def i1_distinct_ids(A):
    ids = [A[k]["id"] for k in ("A", "B", "C", "D")]
    expect(len(set(ids)) == 4, f"user ids not distinct: {ids}")
    for k in ("A", "B", "C", "D"):
        me = get_json(A["client"], "/api/auth/me", A[k]["token"])
        expect(me["id"] == A[k]["id"], f"{k} /me id mismatch: {me}")


# --------------------------------------------------------------------------
# I2 + I6 + I7 — collection ownership
# --------------------------------------------------------------------------

def i2_collection_isolation(A):
    c = A["client"]
    # A adds an item (with an image so we can test image ownership too)
    r = c.post("/api/collection", headers=hdr(A["A"]["token"]),
               json={"coinId": f"{MARKER}-alpha",
                     "item": {"name": "Alpha Iso Coin", "kind": "coin", "year": "1975"},
                     "image": PNG_1PX})
    expect(r.status_code == 200 and r.json().get("ok"), f"A add failed: {r.text}")

    # B adds a different item
    r = c.post("/api/collection", headers=hdr(A["B"]["token"]),
               json={"coinId": f"{MARKER}-beta",
                     "item": {"name": "Beta Iso Coin", "kind": "coin", "year": "2015"}})
    expect(r.status_code == 200 and r.json().get("ok"), f"B add failed: {r.text}")

    def items(k):
        return [i["id"] for i in get_json(c, "/api/collection", A[k]["token"])["items"]]

    a_items, b_items = items("A"), items("B")
    expect(f"{MARKER}-alpha" in a_items, "A cannot see its own item")
    expect(f"{MARKER}-alpha" not in b_items, "B SEES A's item (leak)")
    expect(f"{MARKER}-beta" in b_items, "B cannot see its own item")
    expect(f"{MARKER}-beta" not in a_items, "A SEES B's item (leak)")
    for k in ("C", "D"):
        expect(items(k) == [], f"{k} sees other accounts' items: {items(k)}")


def i6_collection_cross_access(A):
    c = A["client"]
    # B tries to view-edit-delete A's item by id -> 404, A's item intact
    r = c.patch(f"/api/collection/{MARKER}-alpha", headers=hdr(A["B"]["token"]),
                json={"favorite": True})
    expect(r.status_code == 404, f"B PATCH A's item -> {r.status_code} (want 404)")
    r = c.delete(f"/api/collection/{MARKER}-alpha", headers=hdr(A["B"]["token"]))
    expect(r.status_code == 404, f"B DELETE A's item -> {r.status_code} (want 404)")
    r = c.delete(f"/api/collection/{MARKER}-beta", headers=hdr(A["C"]["token"]))
    expect(r.status_code == 404, f"C DELETE B's item -> {r.status_code} (want 404)")
    a_items = [i["id"] for i in get_json(c, "/api/collection", A["A"]["token"])["items"]]
    expect(f"{MARKER}-alpha" in a_items, "A's item lost after cross-account delete attempts")
    # unauthenticated / tampered token
    r = c.get("/api/collection")
    expect(r.status_code == 401, f"no token -> {r.status_code} (want 401)")
    r = c.get("/api/collection", headers=hdr("not-a-jwt"))
    expect(r.status_code == 401, f"garbage token -> {r.status_code} (want 401)")
    r = c.get("/api/collection", headers=hdr(A["A"]["token"] + "x"))
    expect(r.status_code == 401, f"tampered token -> {r.status_code} (want 401)")


def i7_delete_only_owner(A):
    c = A["client"]
    # B deletes its own item -> 200; A's item unaffected
    r = c.delete(f"/api/collection/{MARKER}-beta", headers=hdr(A["B"]["token"]))
    expect(r.status_code == 200, f"B delete own -> {r.status_code}")
    a_items = [i["id"] for i in get_json(c, "/api/collection", A["A"]["token"])["items"]]
    expect(f"{MARKER}-alpha" in a_items, "A's item removed by B's delete!")


def i5_images_owner_only(A):
    c = A["client"]
    items = get_json(c, "/api/collection", A["A"]["token"])["items"]
    mine = [i for i in items if i["id"] == f"{MARKER}-alpha"]
    expect(mine and mine[0].get("imageId"), "A's item has no imageId")
    image_id = mine[0]["imageId"]
    r = c.get(f"/api/images/{image_id}", headers=hdr(A["B"]["token"]))
    expect(r.status_code == 404, f"B fetch A's image -> {r.status_code} (want 404)")
    r = c.get(f"/api/images/{image_id}", headers=hdr(A["A"]["token"]))
    expect(r.status_code == 200, f"A fetch own image -> {r.status_code}")


# --------------------------------------------------------------------------
# I3 — scans
# --------------------------------------------------------------------------

def i3_scans_isolation(A):
    c = A["client"]
    r = c.post("/api/scans", headers=hdr(A["A"]["token"]),
               json={"items": [{"name": "Isolation Probe Coin", "country": "India",
                                "year": "1988", "match": 88}],
                     "image": None, "authenticity": None})
    expect(r.status_code == 200, f"A save scan -> {r.status_code}: {r.text[:200]}")
    scan_id = r.json()["scan"]["id"]

    a_ids = [s["id"] for s in get_json(c, "/api/scans", A["A"]["token"])["scans"]]
    expect(scan_id in a_ids, "A cannot see its own scan")
    for k in ("B", "C", "D"):
        ids = [s["id"] for s in get_json(c, "/api/scans", A[k]["token"])["scans"]]
        expect(scan_id not in ids, f"{k} SEES A's scan (leak)")

    # cross-account delete/get by id -> 404
    r = c.delete(f"/api/scans/{scan_id}", headers=hdr(A["B"]["token"]))
    expect(r.status_code == 404, f"B DELETE A's scan -> {r.status_code} (want 404)")
    r = c.get(f"/api/scans/{scan_id}", headers=hdr(A["C"]["token"]))
    expect(r.status_code == 404, f"C GET A's scan -> {r.status_code} (want 404)")
    # owner delete works
    r = c.delete(f"/api/scans/{scan_id}", headers=hdr(A["A"]["token"]))
    expect(r.status_code == 200, f"A DELETE own scan -> {r.status_code}")


# --------------------------------------------------------------------------
# I4 — chats & messages
# --------------------------------------------------------------------------

def i4_chats_isolation(A):
    c = A["client"]
    r = c.post("/api/chats", headers=hdr(A["A"]["token"]), json={"title": f"{MARKER} chat A"})
    expect(r.status_code == 200, f"A create chat -> {r.status_code}")
    chat_a = r.json()["chat"]["id"]
    r = c.post(f"/api/chats/{chat_a}/messages", headers=hdr(A["A"]["token"]),
               json={"role": "user", "content": f"{MARKER} secret A message"})
    expect(r.status_code == 200, f"A add message -> {r.status_code}")

    r = c.post("/api/chats", headers=hdr(A["B"]["token"]), json={"title": f"{MARKER} chat B"})
    chat_b = r.json()["chat"]["id"]

    # B must not see or touch A's chat
    chats_b = [ch["id"] for ch in get_json(c, "/api/chats", A["B"]["token"])["chats"]]
    expect(chat_a not in chats_b, "B SEES A's chat list entry (leak)")
    r = c.get(f"/api/chats/{chat_a}/messages", headers=hdr(A["B"]["token"]))
    expect(r.status_code == 404, f"B GET A's messages -> {r.status_code} (want 404)")
    r = c.post(f"/api/chats/{chat_a}/messages", headers=hdr(A["B"]["token"]),
               json={"role": "user", "content": "injection attempt"})
    expect(r.status_code == 404, f"B POST to A's chat -> {r.status_code} (want 404)")
    r = c.delete(f"/api/chats/{chat_a}", headers=hdr(A["C"]["token"]))
    expect(r.status_code == 404, f"C DELETE A's chat -> {r.status_code} (want 404)")

    # A still sees its message; D sees neither chat
    msgs = get_json(c, f"/api/chats/{chat_a}/messages", A["A"]["token"])["messages"]
    expect(any(MARKER in m["content"] for m in msgs), "A lost its own message")
    for k in ("C", "D"):
        chats = get_json(c, "/api/chats", A[k]["token"])["chats"]
        expect(all(ch["id"] not in (chat_a, chat_b) for ch in chats),
               f"{k} sees another account's chats")

    # owner deletes own chat only
    r = c.delete(f"/api/chats/{chat_a}", headers=hdr(A["A"]["token"]))
    expect(r.status_code == 200, f"A DELETE own chat -> {r.status_code}")
    r = c.get(f"/api/chats/{chat_b}/messages", headers=hdr(A["B"]["token"]))
    expect(r.status_code == 200, "B's chat lost after A deleted its own")


# --------------------------------------------------------------------------
# I8/I9/I10 — contact linkage & values
# --------------------------------------------------------------------------

def i8_contact_linkage(A):
    c = A["client"]
    # logged-in: linked to A's id taken from the VERIFIED token
    r = c.post("/api/contact", headers=hdr(A["A"]["token"]),
               json={"text": f"{MARKER} authed feedback", "rating": 3,
                     "email": "iso-feedback@coinscan-e2e.com", "username": "Iso Tester",
                     "submissionId": f"{TS}authed"})
    expect(r.status_code == 200 and r.json().get("saved") is True, f"authed contact: {r.text}")
    # guest: no header at all
    r = c.post("/api/contact",
               json={"text": f"{MARKER} guest feedback", "rating": 0,
                     "email": "guest-feedback@coinscan-e2e.com", "username": "Guest Person"})
    expect(r.status_code == 200 and r.json().get("saved") is True, f"guest contact: {r.text}")
    # invalid token: submission must NOT be lost; treated as guest
    r = c.post("/api/contact", headers=hdr("expired-or-bogus-token"),
               json={"text": f"{MARKER} stale-token feedback", "rating": 5,
                     "email": "stale@coinscan-e2e.com", "username": "Stale Session"})
    expect(r.status_code == 200 and r.json().get("saved") is True,
           f"stale-token contact lost: {r.status_code} {r.text}")

    rows = db.query(
        "SELECT user_id, name, email, rating, message, submission_id "
        "FROM contact_messages WHERE message LIKE %s", (f"%{MARKER}%",))
    by_msg = {row["message"]: row for row in rows}
    authed = by_msg.get(f"{MARKER} authed feedback")
    guest = by_msg.get(f"{MARKER} guest feedback")
    stale = by_msg.get(f"{MARKER} stale-token feedback")
    expect(authed is not None, "authed row missing")
    expect(authed["user_id"] == A["A"]["id"],
           f"authed row user_id={authed['user_id']} want {A['A']['id']}")
    expect(authed["name"] == "Iso Tester" and authed["email"] == "iso-feedback@coinscan-e2e.com"
           and authed["rating"] == 3, f"authed values wrong: {authed}")
    expect(guest is not None, "guest row missing")
    expect(guest["user_id"] is None, f"guest row user_id={guest['user_id']} want NULL")
    expect(stale is not None, "stale-token row missing")
    expect(stale["user_id"] is None, f"stale-token row user_id={stale['user_id']} want NULL")
    expect(stale["rating"] == 5, "stale-token rating wrong")

    # Identity fields supplied by the client must be IGNORED: association
    # comes ONLY from the verified token. A body user_id pointing at account
    # B must never link account A's submission to B (regression guard).
    r = c.post("/api/contact", headers=hdr(A["A"]["token"]),
               json={"text": f"{MARKER} spoofed user_id feedback", "rating": 4,
                     "username": "Spoof Attempt", "user_id": A["B"]["id"],
                     "submission_id": f"{TS}spoof",
                     "submissionId": f"{TS}spoof"})
    expect(r.status_code == 200 and r.json().get("saved") is True,
           f"spoof-field contact: {r.status_code} {r.text}")
    spoof = db.fetch_one(
        "SELECT user_id FROM contact_messages WHERE message LIKE %s",
        (f"%{MARKER} spoofed user_id feedback%",))
    expect(spoof is not None, "spoof-test row missing")
    expect(spoof["user_id"] == A["A"]["id"],
           f"client user_id TRUSTED: row user_id={spoof['user_id']} want "
           f"token owner {A['A']['id']} (never {A['B']['id']})")


def i9_rating_zero_means_not_rated(A):
    c = A["client"]
    r = c.post("/api/contact", headers=hdr(A["B"]["token"]),
               json={"text": f"{MARKER} rating zero", "rating": 0,
                     "email": "zero@coinscan-e2e.com", "username": "Zero Stars",
                     "submissionId": f"{TS}rating0"})
    expect(r.status_code == 200, f"rating-0 submit -> {r.status_code}")
    row = db.fetch_one("SELECT rating, user_id FROM contact_messages WHERE message LIKE %s",
                       (f"%{MARKER} rating zero%",))
    expect(row and row["rating"] == 0, f"rating 0 not stored as 0: {row}")
    expect(row["user_id"] == A["B"]["id"], "rating-0 row not linked to B")


def i10_contact_dedupe(A):
    c = A["C"]["c"]
    sid = f"{TS}dupe"
    payload = {"text": f"{MARKER} duplicate probe", "rating": 2,
               "email": "dupe@coinscan-e2e.com", "username": "Dupe", "submissionId": sid}
    r1 = c.post("/api/contact", headers=hdr(A["C"]["token"]), json=payload)
    r2 = c.post("/api/contact", headers=hdr(A["C"]["token"]), json=payload)
    expect(r1.status_code == 200 and r1.json().get("saved") is True, f"first: {r1.text}")
    expect(r2.status_code == 200 and r2.json().get("duplicate") is True,
           f"retry not deduped: {r2.text}")
    n = db.fetch_one("SELECT COUNT(*) AS n FROM contact_messages WHERE submission_id = %s",
                     (sid,))["n"]
    expect(n == 1, f"expected 1 row for submission_id, got {n}")


# --------------------------------------------------------------------------
# run
# --------------------------------------------------------------------------

def cleanup(A):
    db.execute("DELETE FROM contact_messages WHERE message LIKE %s", (f"%{MARKER}%",))
    # Remove only the four accounts THIS test created (cascades their
    # remaining collection/scans/chats/images). Never touches other users.
    for L in "ABCD":
        name = f"iso{TS}{L.lower()}"
        db.execute("DELETE FROM users WHERE username = %s", (name,))


def main():
    print("== Account isolation (4 accounts, real MySQL) ==")
    A = make_accounts(4)
    try:
        for name, fn in [
            ("I1 distinct user ids + /me consistency", lambda: i1_distinct_ids(A)),
            ("I2 collection visible only to owner (A/B/C/D)", lambda: i2_collection_isolation(A)),
            ("I6 cross-account id tampering -> 404/401", lambda: i6_collection_cross_access(A)),
            ("I7 delete affects only the owner", lambda: i7_delete_only_owner(A)),
            ("I5 images owner-only", lambda: i5_images_owner_only(A)),
            ("I3 scan history per-account + tamper 404", lambda: i3_scans_isolation(A)),
            ("I4 chats/messages per-account + tamper 404", lambda: i4_chats_isolation(A)),
            ("I8 contact linked to verified user; guest/stale -> NULL", lambda: i8_contact_linkage(A)),
            ("I9 rating 0 = not rated, still linked", lambda: i9_rating_zero_means_not_rated(A)),
            ("I10 duplicate submissionId -> single row", lambda: i10_contact_dedupe(A)),
        ]:
            check(name, fn)
    finally:
        try:
            cleanup(A)
        except Exception as exc:  # noqa: BLE001
            print(f"  (cleanup warning: {exc})")

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    total = len(RESULTS)
    print(f"\nRESULT: {passed}/{total} passed")
    for name, ok, err in RESULTS:
        if not ok:
            print(f"  FAILED: {name} :: {err}")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
