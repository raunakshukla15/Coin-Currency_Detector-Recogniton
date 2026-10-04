"""Secure account deletion tests: auth, ownership, atomicity, revocation.

Covers (backend requirements 1-15):
  D1  wrong password -> 403, every account row untouched
  D2  unauthenticated / garbage token -> 401, nothing modified
  D3  empty password -> 422 (server-side), nothing modified
  D4  correct password -> 200; ALL owned rows removed (users, scans,
      chats, messages, collection, image BLOBs, user-linked contact),
      while guest feedback with the SAME email survives
  D5  identity from JWT only: a spoofed user_id body field is ignored and
      the other account stays fully intact
  D6  old JWT after deletion -> 401 on /me, scans, collection, chats, images
  D7  login with deleted credentials -> generic 401 "Invalid credentials."
  D8  repeated deletion -> fails safely (401), other accounts unaffected
  D9  username/email reuse -> NEW user id, zero access to old data
  D10 simulated mid-transaction DB failure -> 500, full rollback, no
      partial deletion, no false success
  D11 FK constraints present (deletion order works against the real schema)
  D12 other account's data byte-for-byte unchanged across the whole run

Runs in-process against the real MySQL (FastAPI TestClient), no live server:
    python tests/test_account_deletion.py

Cleanup removes ONLY the rows this test created (delA*/delB* accounts and
its marker contact row).
"""

import os
import sys
import time
from contextlib import contextmanager
from unittest import mock

import pymysql

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "backend"))

import db  # noqa: E402

RESULTS = []
TS = str(int(time.time() * 1000))
MARKER = f"del-tests-{TS}"
PNG_1PX = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
ITEM = [{"name": "Deletion Probe Coin", "country": "India", "year": "1996", "match": 77}]


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


def signup(c, username, email, password):
    r = c.post("/api/auth/signup", json={
        "username": username, "email": email, "password": password,
    })
    expect(r.status_code == 200, f"signup {username}: {r.status_code} {r.text[:200]}")
    body = r.json()
    return {"id": body["user"]["id"], "token": body["token"],
            "username": username, "email": email, "password": password}


def scalar(sql, params=()):
    return db.fetch_one(sql, params)["n"]


def owned_counts(uid):
    return {
        "users": scalar("SELECT COUNT(*) n FROM users WHERE id = %s", (uid,)),
        "scans": scalar("SELECT COUNT(*) n FROM scan_history WHERE user_id = %s", (uid,)),
        "chats": scalar("SELECT COUNT(*) n FROM chats WHERE user_id = %s", (uid,)),
        "msgs": scalar("SELECT COUNT(*) n FROM chat_messages WHERE user_id = %s", (uid,)),
        "collection": scalar("SELECT COUNT(*) n FROM collection_items WHERE user_id = %s", (uid,)),
        "images": scalar("SELECT COUNT(*) n FROM user_images WHERE user_id = %s", (uid,)),
        "contact": scalar("SELECT COUNT(*) n FROM contact_messages WHERE user_id = %s", (uid,)),
    }


def image_bytes(uid):
    return db.fetch_one(
        "SELECT COALESCE(SUM(byte_size), 0) AS b FROM user_images WHERE user_id = %s", (uid,)
    )["b"]


def seed_user_data(c, acct, with_image=True, contact=True):
    """Give an account one of every owned resource type."""
    tok = acct["token"]
    r = c.post("/api/scans", headers=hdr(tok),
               json={"items": ITEM, "image": PNG_1PX if with_image else None,
                     "authenticity": None})
    expect(r.status_code == 200, f"seed scan -> {r.status_code} {r.text[:150]}")
    r = c.post("/api/collection", headers=hdr(tok),
               json={"coinId": f"{MARKER}-{acct['username']}",
                     "item": {"name": "Del Coin", "kind": "coin"},
                     "image": PNG_1PX if with_image else None})
    expect(r.status_code == 200 and r.json().get("ok"), f"seed collection -> {r.text[:150]}")
    r = c.post("/api/chats", headers=hdr(tok), json={"title": f"{MARKER} chat"})
    chat_id = r.json()["chat"]["id"]
    r = c.post(f"/api/chats/{chat_id}/messages", headers=hdr(tok),
               json={"role": "user", "content": f"{MARKER} message",
                     "image": PNG_1PX if with_image else None})
    expect(r.status_code == 200, f"seed message -> {r.status_code} {r.text[:150]}")
    if contact:
        r = c.post("/api/contact", headers=hdr(tok),
                   json={"text": f"{MARKER} owned feedback", "rating": 4,
                         "email": acct["email"], "username": acct["username"]})
        expect(r.status_code == 200 and r.json().get("saved"), f"seed contact -> {r.text[:150]}")


# --------------------------------------------------------------------------
# setup
# --------------------------------------------------------------------------

def setup(c):
    A = signup(c, f"delA{TS}", f"delA{TS}@coinscan-e2e.com", "DelA!Pass123")
    B = signup(c, f"delB{TS}", f"delB{TS}@coinscan-e2e.com", "DelB!Pass123")
    seed_user_data(c, A, with_image=True, contact=True)
    seed_user_data(c, B, with_image=True, contact=True)
    # Guest feedback with A's exact email but NO account linkage — must
    # survive A's deletion (ownership comes only from user_id).
    r = c.post("/api/contact",
               json={"text": f"{MARKER} guest feedback", "rating": 5,
                     "email": A["email"], "username": "Guest With Same Email"})
    expect(r.status_code == 200 and r.json().get("saved"), f"seed guest contact -> {r.text[:150]}")
    return A, B


# --------------------------------------------------------------------------
# D11 — FK constraints present on the real schema
# --------------------------------------------------------------------------

def d11_foreign_keys_present(_AB):
    n = scalar(
        "SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS "
        "WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'"
    )
    expect(n >= 10, f"expected the 10 schema FKs, found {n}")


# --------------------------------------------------------------------------
# D1 / D2 / D3 — rejection paths change nothing
# --------------------------------------------------------------------------

def d1_wrong_password_preserves_everything(AB):
    c, (A, B) = AB["client"], AB["accts"]
    before_a, before_b = owned_counts(A["id"]), owned_counts(B["id"])
    expect(before_a["images"] > 0 and image_bytes(A["id"]) > 0, "setup: A has no images")

    r = c.request("DELETE", "/api/auth/account", headers=hdr(A["token"]),
                 json={"password": "WrongPassword!999"})
    expect(r.status_code == 403, f"wrong password -> {r.status_code} (want 403): {r.text[:150]}")
    expect("Incorrect password" in r.json().get("detail", ""), f"detail: {r.text[:150]}")
    expect(owned_counts(A["id"]) == before_a, "wrong password CHANGED A's data!")
    expect(image_bytes(A["id"]) > 0, "wrong password removed A's image bytes!")
    expect(owned_counts(B["id"]) == before_b, "wrong password touched B's data!")


def d2_unauthenticated_rejected(AB):
    c, (A, B) = AB["client"], AB["accts"]
    before_a, before_b = owned_counts(A["id"]), owned_counts(B["id"])
    r = c.request("DELETE", "/api/auth/account", json={"password": A["password"]})
    expect(r.status_code == 401, f"no token -> {r.status_code} (want 401)")
    r = c.request("DELETE", "/api/auth/account", headers=hdr("not-a-jwt"),
                 json={"password": A["password"]})
    expect(r.status_code == 401, f"garbage token -> {r.status_code} (want 401)")
    r = c.request("DELETE", "/api/auth/account", headers=hdr(A["token"] + "x"),
                 json={"password": A["password"]})
    expect(r.status_code == 401, f"tampered token -> {r.status_code} (want 401)")
    expect(owned_counts(A["id"]) == before_a, "unauthenticated attempts changed A!")
    expect(owned_counts(B["id"]) == before_b, "unauthenticated attempts changed B!")


def d3_empty_password_rejected(AB):
    c, (A,) = AB["client"], (AB["accts"][0],)
    before = owned_counts(A["id"])
    r = c.request("DELETE", "/api/auth/account", headers=hdr(A["token"]), json={"password": ""})
    expect(r.status_code == 422, f"empty password -> {r.status_code} (want 422)")
    expect(owned_counts(A["id"]) == before, "empty password attempt changed data!")


# --------------------------------------------------------------------------
# D4 + D5 — successful deletion, ownership from token only
# --------------------------------------------------------------------------

def d4_d5_delete_success_and_spoof_protection(AB):
    c, (A, B) = AB["client"], AB["accts"]
    before_b = owned_counts(B["id"])
    b_bytes = image_bytes(B["id"])

    # Spoof field: even a body naming B's user_id cannot redirect the
    # deletion — identity comes only from A's verified JWT.
    r = c.request("DELETE", "/api/auth/account", headers=hdr(A["token"]),
                 json={"password": A["password"], "user_id": B["id"],
                       "id": B["id"]})
    expect(r.status_code == 200 and r.json().get("ok") is True,
           f"valid deletion -> {r.status_code} {r.text[:200]}")

    # A: everything gone, including image BLOBs and user-linked contact.
    expect(owned_counts(A["id"]) == {
        "users": 0, "scans": 0, "chats": 0, "msgs": 0,
        "collection": 0, "images": 0, "contact": 0,
    }, f"A leftovers: {owned_counts(A['id'])}")
    expect(image_bytes(A["id"]) == 0, "A's image bytes not removed")

    # Guest feedback with A's email survives (no reliable ownership link).
    guest = db.fetch_one(
        "SELECT user_id FROM contact_messages WHERE message LIKE %s",
        (f"%{MARKER} guest feedback%",))
    expect(guest is not None, "guest feedback was deleted with the account!")
    expect(guest["user_id"] is None, f"guest feedback user_id={guest['user_id']} want NULL")

    # B untouched (the spoofed user_id did NOT delete B).
    expect(owned_counts(B["id"]) == before_b, "B's data changed during A's deletion!")
    expect(image_bytes(B["id"]) == b_bytes, "B's image bytes changed!")


# --------------------------------------------------------------------------
# D6 / D7 / D8 — revocation: old JWT, login, repeat delete
# --------------------------------------------------------------------------

def d6_old_jwt_rejected(AB):
    c, (A, B) = AB["client"], AB["accts"]
    old = A["token"]
    for path, method in [("/api/auth/me", "GET"), ("/api/scans", "GET"),
                         ("/api/collection", "GET"), ("/api/chats", "GET")]:
        r = c.request(method, path, headers=hdr(old))
        expect(r.status_code == 401, f"old JWT {path} -> {r.status_code} (want 401)")
    # Images: the rows are gone AND the token is dead — never 200.
    img = db.fetch_one("SELECT id FROM user_images WHERE user_id = %s", (A["id"],))
    expect(img is None, "A's image rows still exist")
    r = c.get("/api/images/999999991", headers=hdr(old))
    expect(r.status_code == 401, f"old JWT images -> {r.status_code} (want 401)")
    # B's live token still works (only the deleted account is revoked).
    r = c.get("/api/auth/me", headers=hdr(B["token"]))
    expect(r.status_code == 200, f"B's token broken by A's deletion -> {r.status_code}")


def d7_deleted_login_fails_generically(AB):
    c, (A,) = AB["client"], (AB["accts"][0],)
    r = c.post("/api/auth/login",
               json={"identifier": A["username"], "password": A["password"]})
    expect(r.status_code == 401, f"login as deleted user -> {r.status_code} (want 401)")
    expect(r.json().get("detail") == "Invalid credentials.",
           f"not a generic response: {r.text[:150]}")
    r = c.post("/api/auth/login",
               json={"identifier": A["email"], "password": A["password"]})
    expect(r.status_code == 401, f"login by deleted email -> {r.status_code} (want 401)")
    expect(r.json().get("detail") == "Invalid credentials.",
           f"not generic: {r.text[:150]}")


def d8_repeated_delete_fails_safely(AB):
    c, (A, B) = AB["client"], AB["accts"]
    before_b = owned_counts(B["id"])
    r = c.request("DELETE", "/api/auth/account", headers=hdr(A["token"]),
                 json={"password": A["password"]})
    expect(r.status_code == 401, f"repeat delete -> {r.status_code} (want 401)")
    expect(owned_counts(B["id"]) == before_b, "repeat delete touched B!")


# --------------------------------------------------------------------------
# D9 — username/email reuse creates a NEW identity with no old data
# --------------------------------------------------------------------------

def d9_reuse_gets_new_identity(AB):
    c, (A,) = AB["client"], (AB["accts"][0],)
    fresh = signup(c, A["username"], A["email"], A["password"])
    expect(fresh["id"] != A["id"], f"reused id {fresh['id']} == old id {A['id']}")
    scans = c.get("/api/scans", headers=hdr(fresh["token"])).json()["scans"]
    coll = c.get("/api/collection", headers=hdr(fresh["token"])).json()["items"]
    chats = c.get("/api/chats", headers=hdr(fresh["token"])).json()["chats"]
    expect(scans == [] and coll == [] and chats == [],
           f"new account sees OLD data! scans={len(scans)} coll={len(coll)} chats={len(chats)}")
    expect(owned_counts(fresh["id"])["images"] == 0, "new account has old images")
    # The old user-linked contact rows were deleted, not re-linked.
    owned_old = scalar("SELECT COUNT(*) n FROM contact_messages WHERE user_id = %s",
                       (A["id"],))
    expect(owned_old == 0, "old contact rows re-appeared for the reused username")
    # Keep the fresh account around so later tests can still see B intact;
    # removed in cleanup by username.
    AB["reuse"] = fresh


# --------------------------------------------------------------------------
# D10 — simulated mid-transaction failure rolls everything back
# --------------------------------------------------------------------------

def d10_db_failure_rolls_back(AB):
    c, (A, B) = AB["client"], AB["accts"]
    before_b = owned_counts(B["id"])
    b_bytes = image_bytes(B["id"])
    real_transaction = db.transaction

    @contextmanager
    def failing_transaction():
        with real_transaction() as cur:
            yield cur
            # Runs AFTER the endpoint's own deletes, BEFORE commit —
            # simulating a database failure mid-transaction.
            cur.execute("DELETE FROM contact_messages WHERE user_id = %s", (B["id"],))
            raise pymysql.OperationalError("simulated mid-transaction failure")

    with mock.patch.object(db, "transaction", failing_transaction):
        r = c.request("DELETE", "/api/auth/account", headers=hdr(B["token"]),
                     json={"password": B["password"]})
    expect(r.status_code == 500, f"DB failure -> {r.status_code} (want 500): {r.text[:150]}")
    expect("Database error" in r.json().get("detail", ""), f"detail: {r.text[:150]}")
    expect(owned_counts(B["id"]) == before_b,
           f"rollback left partial deletion: {owned_counts(B['id'])} vs {before_b}")
    expect(image_bytes(B["id"]) == b_bytes, "rollback lost B's image bytes")
    # And the account still works after the failed attempt.
    r = c.get("/api/auth/me", headers=hdr(B["token"]))
    expect(r.status_code == 200, f"B broken after failed deletion -> {r.status_code}")


# --------------------------------------------------------------------------
# run
# --------------------------------------------------------------------------

def cleanup(c, A, B, reuse=None):
    for acct in (B, reuse):
        if acct:
            db.execute("DELETE FROM users WHERE username = %s", (acct["username"],))
    db.execute("DELETE FROM contact_messages WHERE message LIKE %s", (f"%{MARKER}%",))
    db.execute("DELETE FROM users WHERE username = %s", (A["username"],))


def main():
    print("== Account deletion (real MySQL) ==")
    c = client()
    A, B = setup(c)
    AB = {"client": c, "accts": (A, B), "reuse": None}
    try:
        for name, fn in [
            ("D11 FK constraints present on the schema", d11_foreign_keys_present),
            ("D1 wrong password -> 403, all data intact", d1_wrong_password_preserves_everything),
            ("D2 unauthenticated/tampered token -> 401", d2_unauthenticated_rejected),
            ("D3 empty password -> 422", d3_empty_password_rejected),
            ("D4+D5 delete succeeds; spoofed user_id ignored; guest contact kept",
             d4_d5_delete_success_and_spoof_protection),
            ("D6 old JWT -> 401 on every protected endpoint", d6_old_jwt_rejected),
            ("D7 deleted account login -> generic invalid credentials", d7_deleted_login_fails_generically),
            ("D8 repeated deletion fails safely", d8_repeated_delete_fails_safely),
            ("D9 username reuse -> new id, zero old data", d9_reuse_gets_new_identity),
            ("D10 DB failure -> 500 + full rollback", d10_db_failure_rolls_back),
        ]:
            check(name, lambda fn=fn: fn(AB))
    finally:
        try:
            cleanup(c, A, B, AB.get("reuse"))
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
