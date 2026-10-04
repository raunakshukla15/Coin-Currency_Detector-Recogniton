"""MySQL image storage tests: round-trip, ownership, lifecycle, limits.

Covers:
  S1  scan image: stored as a real blob, round-trips byte-for-byte, owner-only
  S2  chat attachment: stored, returned in the message list, owner-only
  S3  collection image: survives across sessions (fresh client), owner-only
  S4  deleted image row -> scan still reads (image None), image GET 404
  S5  delete_chat reaps its orphaned images but never one a scan still
      references (shared reference survives); last delete reaps it
  S6  oversized (>6 MB) image -> 422 on scan/message/collection with no
      partial rows written

Runs in-process against the real MySQL (FastAPI TestClient), no live server:
    python tests/test_image_storage.py

Cleanup removes ONLY the rows this test created (the two img* accounts it
signed up; everything they own cascades away with them).
"""

import base64
import os
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "backend"))

import db  # noqa: E402

RESULTS = []
TS = str(int(time.time() * 1000))
MARKER = f"img-tests-{TS}"
PNG_1PX = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
ITEM = [{"name": "Storage Probe Coin", "country": "India", "year": "1990", "match": 91}]


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


def make_accounts(n=2):
    c = client()
    letters = "AB"[:n]
    accts = {}
    for L in letters:
        r = c.post("/api/auth/signup", json={
            "username": f"img{TS}{L.lower()}",
            "email": f"img{TS}{L.lower()}@coinscan-e2e.com",
            "password": "Img!Pass123",
        })
        expect(r.status_code == 200, f"signup {L}: {r.status_code} {r.text}")
        body = r.json()
        accts[L] = {"id": body["user"]["id"], "token": body["token"]}
    accts["client"] = c
    return accts


def get_json(c, path, token=None, expect_status=200):
    r = c.get(path, headers=hdr(token) if token else {})
    expect(r.status_code == expect_status,
           f"GET {path} -> {r.status_code} (wanted {expect_status}): {r.text[:200]}")
    return r.json()


def image_count(user_id):
    return db.fetch_one(
        "SELECT COUNT(*) AS n FROM user_images WHERE user_id = %s", (user_id,)
    )["n"]


def image_row(image_id, user_id=None):
    if user_id is None:
        return db.fetch_one("SELECT id, user_id, byte_size, mime_type FROM user_images WHERE id = %s",
                            (image_id,))
    return db.fetch_one(
        "SELECT id, user_id, byte_size, mime_type FROM user_images WHERE id = %s AND user_id = %s",
        (image_id, user_id),
    )


def save_scan(c, token, image):
    r = c.post("/api/scans", headers=hdr(token),
               json={"items": ITEM, "image": image, "authenticity": None})
    return r


# --------------------------------------------------------------------------
# S1 — scan image round-trip + owner-only
# --------------------------------------------------------------------------

def s1_scan_image_roundtrip(A):
    c = A["client"]
    tok = A["A"]["token"]

    r = save_scan(c, tok, PNG_1PX)
    expect(r.status_code == 200, f"save scan -> {r.status_code}: {r.text[:200]}")
    scan = r.json()["scan"]
    expect(scan.get("imageId"), "scan has no imageId")
    expect(scan.get("image") == PNG_1PX, "create response image != uploaded bytes")

    row = image_row(scan["imageId"])
    expect(row is not None, "user_images row not written")
    expect(row["user_id"] == A["A"]["id"], f"image owner {row['user_id']} want {A['A']['id']}")
    expect(row["byte_size"] > 0, "byte_size is 0 — no data stored")
    expect(row["mime_type"] == "image/png", f"mime {row['mime_type']} want image/png")
    png_bytes = base64.b64decode(PNG_1PX.split(",", 1)[1])
    expect(row["byte_size"] == len(png_bytes),
           f"byte_size {row['byte_size']} != {len(png_bytes)}")

    got = get_json(c, f"/api/scans/{scan['id']}", tok)["scan"]
    expect(got["image"] == PNG_1PX, "GET scan image did not round-trip byte-for-byte")

    r = c.get(f"/api/images/{scan['imageId']}", headers=hdr(tok))
    expect(r.status_code == 200, f"owner GET /images -> {r.status_code}")
    expect(r.headers.get("content-type", "").startswith("image/png"),
           f"content-type {r.headers.get('content-type')}")
    body_b64 = base64.b64encode(r.content).decode("ascii")
    expect(body_b64 == PNG_1PX.split(",", 1)[1], "/images bytes differ from upload")

    r = c.get(f"/api/images/{scan['imageId']}", headers=hdr(A["B"]["token"]))
    expect(r.status_code == 404, f"cross-account GET /images -> {r.status_code} (want 404)")
    r = c.get(f"/api/scans/{scan['id']}", headers=hdr(A["B"]["token"]))
    expect(r.status_code == 404, f"cross-account GET /scans/id -> {r.status_code} (want 404)")


# --------------------------------------------------------------------------
# S2 — chat attachment round-trip + owner-only
# --------------------------------------------------------------------------

def s2_chat_attachment_roundtrip(A):
    c = A["client"]
    tok = A["A"]["token"]

    r = c.post("/api/chats", headers=hdr(tok), json={"title": f"{MARKER} img chat"})
    expect(r.status_code == 200, f"create chat -> {r.status_code}")
    chat_id = r.json()["chat"]["id"]

    r = c.post(f"/api/chats/{chat_id}/messages", headers=hdr(tok),
               json={"role": "user", "content": f"{MARKER} attachment", "image": PNG_1PX})
    expect(r.status_code == 200, f"post message -> {r.status_code}: {r.text[:200]}")
    msg = r.json().get("message") or {}
    expect(msg.get("imageId"), "message has no imageId")
    expect(msg.get("image") == PNG_1PX, "create response message image != uploaded bytes")

    row = image_row(msg["imageId"])
    expect(row is not None and row["user_id"] == A["A"]["id"] and row["byte_size"] > 0,
           f"chat image row wrong: {row}")

    msgs = get_json(c, f"/api/chats/{chat_id}/messages", tok)["messages"]
    mine = [m for m in msgs if m["content"] == f"{MARKER} attachment"]
    expect(mine and mine[0]["image"] == PNG_1PX, "message list did not round-trip the image")

    r = c.get(f"/api/chats/{chat_id}/messages", headers=hdr(A["B"]["token"]))
    expect(r.status_code == 404, f"cross-account GET messages -> {r.status_code} (want 404)")
    r = c.get(f"/api/images/{msg['imageId']}", headers=hdr(A["B"]["token"]))
    expect(r.status_code == 404, f"cross-account GET chat image -> {r.status_code} (want 404)")

    return chat_id, msg["imageId"]


# --------------------------------------------------------------------------
# S3 — collection image survives a fresh session, owner-only
# --------------------------------------------------------------------------

def s3_collection_image_session(A):
    c = A["client"]
    tok = A["A"]["token"]
    coin_id = f"{MARKER}-coin"

    r = c.post("/api/collection", headers=hdr(tok),
               json={"coinId": coin_id,
                     "item": {"name": "Session Coin", "kind": "coin", "year": "2001"},
                     "image": PNG_1PX})
    expect(r.status_code == 200 and r.json().get("ok"), f"add collection -> {r.text}")

    c2 = client()
    items = get_json(c2, "/api/collection", tok)["items"]
    mine = [i for i in items if i["id"] == coin_id]
    expect(mine, "collection item missing in a fresh session")
    expect(mine[0].get("imageId"), "collection item lost its imageId across sessions")

    r = c2.get(f"/api/images/{mine[0]['imageId']}", headers=hdr(tok))
    expect(r.status_code == 200, f"owner GET collection image -> {r.status_code}")
    expect(r.content == base64.b64decode(PNG_1PX.split(",", 1)[1]),
           "collection image bytes differ after session reload")
    r = c2.get(f"/api/images/{mine[0]['imageId']}", headers=hdr(A["B"]["token"]))
    expect(r.status_code == 404, f"cross-account GET collection image -> {r.status_code} (want 404)")


# --------------------------------------------------------------------------
# S4 — missing image row handled gracefully
# --------------------------------------------------------------------------

def s4_missing_image_graceful(A):
    c = A["client"]
    tok = A["A"]["token"]

    r = save_scan(c, tok, PNG_1PX)
    expect(r.status_code == 200, f"save scan -> {r.status_code}")
    scan = r.json()["scan"]
    image_id, scan_id = scan["imageId"], scan["id"]

    db.execute("DELETE FROM user_images WHERE id = %s AND user_id = %s",
               (image_id, A["A"]["id"]))

    got = get_json(c, f"/api/scans/{scan_id}", tok)["scan"]
    expect(got["image"] is None, f"scan read with deleted image not graceful: {got.get('image')!r}")

    r = c.get(f"/api/images/{image_id}", headers=hdr(tok))
    expect(r.status_code == 404, f"GET deleted image -> {r.status_code} (want 404)")


# --------------------------------------------------------------------------
# S5 — chat delete reaps orphans, protects shared references
# --------------------------------------------------------------------------

def s5_chat_delete_orphan_reaping(A):
    c = A["client"]
    tok = A["A"]["token"]

    chat_id, shared_image_id = s2_chat_attachment_roundtrip(A)

    r = save_scan(c, tok, None)
    expect(r.status_code == 200, f"save scan -> {r.status_code}")
    scan_id = r.json()["scan"]["id"]
    db.execute("UPDATE scan_history SET image_id = %s WHERE id = %s AND user_id = %s",
               (shared_image_id, scan_id, A["A"]["id"]))

    r = c.delete(f"/api/chats/{chat_id}", headers=hdr(tok))
    expect(r.status_code == 200, f"delete chat -> {r.status_code}")

    expect(image_row(shared_image_id) is not None,
           "shared image reaped by delete_chat while a scan still references it")
    got = get_json(c, f"/api/scans/{scan_id}", tok)["scan"]
    expect(got["image"] == PNG_1PX, "scan lost its shared image after chat delete")

    r = c.delete(f"/api/scans/{scan_id}", headers=hdr(tok))
    expect(r.status_code == 200, f"delete scan -> {r.status_code}")
    expect(image_row(shared_image_id) is None,
           "orphaned image not reaped after the last reference was deleted")


# --------------------------------------------------------------------------
# S6 — oversized image rejected, no partial writes
# --------------------------------------------------------------------------

def s6_oversized_rejected(A):
    c = A["client"]
    tok = A["A"]["token"]
    before = image_count(A["A"]["id"])

    big = "data:image/png;base64," + base64.b64encode(
        os.urandom(6 * 1024 * 1024 + 4096)
    ).decode("ascii")

    r = save_scan(c, tok, big)
    expect(r.status_code == 422, f"oversized scan -> {r.status_code} (want 422)")
    expect("6 MB" in r.json().get("detail", ""), f"unexpected detail: {r.text[:120]}")

    r = c.post("/api/chats", headers=hdr(tok), json={"title": f"{MARKER} big img"})
    chat_id = r.json()["chat"]["id"]
    r = c.post(f"/api/chats/{chat_id}/messages", headers=hdr(tok),
               json={"role": "user", "content": "oversized attachment", "image": big})
    expect(r.status_code == 422, f"oversized message -> {r.status_code} (want 422)")

    r = c.post("/api/collection", headers=hdr(tok),
               json={"coinId": f"{MARKER}-big", "item": {"name": "Big"}, "image": big})
    expect(r.status_code == 422, f"oversized collection image -> {r.status_code} (want 422)")
    items = [i["id"] for i in get_json(c, "/api/collection", tok)["items"]]
    expect(f"{MARKER}-big" not in items, "collection item written despite image rejection")

    expect(image_count(A["A"]["id"]) == before,
           f"partial image rows written: {before} -> {image_count(A['A']['id'])}")


# --------------------------------------------------------------------------
# run
# --------------------------------------------------------------------------

def cleanup(A):
    for L in "AB":
        db.execute("DELETE FROM users WHERE username = %s", (f"img{TS}{L.lower()}",))


def main():
    print("== MySQL image storage (real MySQL) ==")
    A = make_accounts(2)
    try:
        for name, fn in [
            ("S1 scan image round-trip, blob stored, owner-only", lambda: s1_scan_image_roundtrip(A)),
            ("S2 chat attachment round-trip, owner-only", lambda: s2_chat_attachment_roundtrip(A)),
            ("S3 collection image survives new session, owner-only", lambda: s3_collection_image_session(A)),
            ("S4 deleted image row -> graceful None + 404", lambda: s4_missing_image_graceful(A)),
            ("S5 delete_chat reaps orphans, protects shared refs", lambda: s5_chat_delete_orphan_reaping(A)),
            ("S6 oversized image -> 422, no partial writes", lambda: s6_oversized_rejected(A)),
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
