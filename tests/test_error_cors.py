"""Signup 500 + CORS: every 500 answer must be a JSON body with CORS headers.

Production incident: POST /api/auth/signup returned 500 and the BROWSER
reported a CORS error, because the failure escaped as an unhandled exception
and ServerErrorMiddleware (which sits OUTSIDE CORSMiddleware) answered with a
bare text 500 that has no Access-Control-Allow-Origin.

Evidence chain covered here:
  E1  /api/health stays 200 while the database is unreachable (health never
      touches MySQL) AND signup then fails with a 500 that carries CORS
      headers + a clean stage-specific detail (signup's guarded lookup).
      This mirrors production exactly: health OK, signup 500.
  E2  an exception the route guards do not catch (non-MySQL) is answered by
      the global handler: JSON detail with the exception CLASS NAME only,
      CORS headers for allowed origins, Vary: Origin, no traceback / no
      exception message / no internals in the body.
  E3  the pre-existing INSERT guard still returns its clean detail (with CORS).
  E4  a normal signup still succeeds: 200 + token + CORS headers.
  E5  an origin that is NOT on the allow-list gets NO ACAO header
      (the handler must not reflect arbitrary origins).

Runs from the repo root (E4 needs a reachable database, e.g. e2e):
    $env:MYSQL_DATABASE='coinscan_e2e_test'; python tests/test_error_cors.py
"""

import os
import secrets
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "backend"))

import pymysql  # noqa: E402

import config  # noqa: E402
import db  # noqa: E402

RESULTS = []
ORIGIN_OK = "http://localhost:5173"  # on the default allow-list
ORIGIN_BAD = "https://evil.example"


def check(name, fn):
    started = time.time()
    try:
        fn()
        RESULTS.append((name, True, ""))
        print(f"  PASS  {name} ({time.time() - started:.1f}s)")
    except Exception as exc:  # noqa: BLE001 - report every failure
        RESULTS.append((name, False, f"{type(exc).__name__}: {exc}"))
        print(f"  FAIL  {name}: {type(exc).__name__}: {exc}")


def expect(cond, msg):
    if not cond:
        raise AssertionError(msg)


def client():
    from fastapi.testclient import TestClient
    from main import app

    # raise_server_exceptions=False: ServerErrorMiddleware sends the handler's
    # response and THEN re-raises; we assert on the response it sent.
    return TestClient(app, raise_server_exceptions=False)


def signup_body():
    stamp = secrets.token_hex(5)
    return {"username": f"e4{stamp}", "email": f"e4{stamp}@test.example",
            "password": "secret123"}


def post_signup(c, origin):
    return c.post("/api/auth/signup", json=signup_body(),
                  headers={"Origin": origin})


# ---------------------------------------------------------------- E1
def e1_db_unreachable_health_ok_signup_500_with_cors():
    orig_host, orig_port = config.MYSQL_HOST, config.MYSQL_PORT
    config.MYSQL_HOST, config.MYSQL_PORT = "127.0.0.1", 1  # nothing listens here
    try:
        c = client()
        r = c.get("/api/health")
        expect(r.status_code == 200 and r.json().get("ok") is True,
               f"health must stay OK without a DB, got {r.status_code}")

        r = post_signup(c, ORIGIN_OK)
        expect(r.status_code == 500, f"expected 500, got {r.status_code}: {r.text[:200]}")
        acao = r.headers.get("access-control-allow-origin")
        expect(acao == ORIGIN_OK,
               f"500 must carry CORS for allowed origin, ACAO={acao!r}")
        expect(r.headers.get("access-control-allow-credentials") == "true",
               "missing Access-Control-Allow-Credentials on 500")
        detail = r.json().get("detail", "")  # JSON, never bare text
        expect(detail.startswith("Database error while checking"),
               f"detail not stage-clean: {detail!r}")
        expect("Traceback" not in r.text and "pymysql" not in r.text
               and "127.0.0.1" not in r.text,
               "500 leaked internals")
    finally:
        config.MYSQL_HOST, config.MYSQL_PORT = orig_host, orig_port


# ---------------------------------------------------------------- E2
def e2_unhandled_error_json_cors_no_leak():
    orig = db.fetch_one

    def boom(*_a, **_k):
        raise RuntimeError("internal detail that must not leak")

    db.fetch_one = boom
    try:
        r = post_signup(client(), ORIGIN_OK)
        expect(r.status_code == 500, f"expected 500, got {r.status_code}")
        acao = r.headers.get("access-control-allow-origin")
        expect(acao == ORIGIN_OK,
               f"handler must add ACAO for allowed origin, ACAO={acao!r}")
        expect(r.headers.get("access-control-allow-credentials") == "true",
               "missing Access-Control-Allow-Credentials")
        expect("Origin" in (r.headers.get("vary") or ""),
               f"missing Vary: Origin, got {r.headers.get('vary')!r}")
        detail = r.json().get("detail", "")
        expect(detail == "Internal server error (RuntimeError).",
               f"unexpected detail: {detail!r}")
        expect("must not leak" not in r.text and "Traceback" not in r.text
               and "boom" not in r.text,
               "500 body leaked the exception message/traceback")
    finally:
        db.fetch_one = orig


# ---------------------------------------------------------------- E3
def e3_insert_guard_still_clean_with_cors():
    orig_fetch, orig_exec = db.fetch_one, db.execute
    db.fetch_one = lambda *_a, **_k: None  # no 409 conflict

    def boom(*_a, **_k):
        raise pymysql.MySQLError(1062, "simulated duplicate key")

    db.execute = boom
    try:
        r = post_signup(client(), ORIGIN_OK)
        expect(r.status_code == 500, f"expected 500, got {r.status_code}")
        expect(r.headers.get("access-control-allow-origin") == ORIGIN_OK,
               f"handled 500 must keep CORS, ACAO={r.headers.get('access-control-allow-origin')!r}")
        detail = r.json().get("detail", "")
        expect(detail.startswith("Database error while creating"),
               f"INSERT guard detail changed: {detail!r}")
        expect("pymysql" not in r.text and "duplicate" not in r.text,
               "500 leaked driver internals")
    finally:
        db.fetch_one, db.execute = orig_fetch, orig_exec


# ---------------------------------------------------------------- E4
def e4_signup_ok_with_cors():
    r = post_signup(client(), ORIGIN_OK)
    expect(r.status_code == 200, f"signup failed: {r.status_code}: {r.text[:300]}")
    expect(bool(r.json().get("token")), "signup returned no token")
    expect(r.headers.get("access-control-allow-origin") == ORIGIN_OK,
           f"200 must carry CORS, ACAO={r.headers.get('access-control-allow-origin')!r}")


# ---------------------------------------------------------------- E5
def e5_disallowed_origin_gets_no_acao():
    orig_host, orig_port = config.MYSQL_HOST, config.MYSQL_PORT
    config.MYSQL_HOST, config.MYSQL_PORT = "127.0.0.1", 1
    try:
        r = post_signup(client(), ORIGIN_BAD)
        expect(r.status_code == 500, f"expected 500, got {r.status_code}")
        expect("access-control-allow-origin" not in r.headers,
               f"reflected a disallowed origin: {r.headers.get('access-control-allow-origin')!r}")
    finally:
        config.MYSQL_HOST, config.MYSQL_PORT = orig_host, orig_port


def main():
    # Import main (and run dbinit) against the configured database BEFORE any
    # case mutates config, so startup logs reflect the real environment.
    client()
    for name, fn in [
        ("E1 unreachable DB: health 200 + signup 500 JSON with CORS", e1_db_unreachable_health_ok_signup_500_with_cors),
        ("E2 unhandled error -> global handler JSON + CORS, no leak", e2_unhandled_error_json_cors_no_leak),
        ("E3 INSERT guard detail intact + CORS", e3_insert_guard_still_clean_with_cors),
        ("E4 normal signup 200 + token + CORS", e4_signup_ok_with_cors),
        ("E5 disallowed origin gets no ACAO", e5_disallowed_origin_gets_no_acao),
    ]:
        check(name, fn)

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    total = len(RESULTS)
    print(f"\nRESULT: {passed}/{total} passed")
    for name, ok, err in RESULTS:
        if not ok:
            print(f"  FAILED: {name} :: {err}")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
