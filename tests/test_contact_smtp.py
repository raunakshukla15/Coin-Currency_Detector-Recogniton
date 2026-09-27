"""Contact-Us endpoint tests: the three real outcomes + input validation.

  State A  SMTP capture server UP     -> saved=true,  emailSent=true,  row in DB,
                                         message captured by SMTP server
  State B  SMTP server unreachable    -> saved=true,  emailSent=false,
                                         row STILL in DB (DB-first ordering)
  State C  SMTP server rejects (550)  -> saved=true,  emailSent=false,
                                         row STILL in DB
  State D  Database down              -> HTTP 500 with clean "Database error"
                                         detail, no traceback leak
  State E  Validation                 -> 422 for invalid email / empty text

Run from the repo root:
    python tests/test_contact_smtp.py
"""

import json
import os
import socket
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "backend"))

import config  # noqa: E402
import db  # noqa: E402

RESULTS = []
MARKER = f"contact-smtp-{int(time.time())}"
SMTP_PORT = 2531
JSONL = os.path.join(REPO, "tests", "servers", ".smtp_capture.jsonl")
CAPTURE_PROC = None

# Real SMTP-looking settings; only host/port point at the local capture server.
SMTP_SETTINGS = {
    "SMTP_HOST": "127.0.0.1",
    "SMTP_PORT": SMTP_PORT,
    "SMTP_USER": "noreply@coinscan.test",
    "SMTP_PASSWORD": "test-password",
    "SMTP_STARTTLS": False,
    "CONTACT_TO": "inbox@coinscan.test",
}
_ORIG = {k: getattr(config, k) for k in SMTP_SETTINGS}


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


def apply_smtp(enabled=True):
    if enabled:
        for k, v in SMTP_SETTINGS.items():
            setattr(config, k, v)
    else:
        for k, v in _ORIG.items():
            setattr(config, k, v)


def start_capture(mode):
    if os.path.exists(JSONL):
        os.remove(JSONL)
    proc = subprocess.Popen(
        [sys.executable, os.path.join(REPO, "tests", "servers", "smtp_capture.py"),
         "--port", str(SMTP_PORT), "--mode", mode, "--jsonl", JSONL],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(50):
        try:
            with socket.create_connection(("127.0.0.1", SMTP_PORT), timeout=0.2):
                return proc
        except OSError:
            time.sleep(0.1)
    proc.terminate()
    raise RuntimeError("smtp capture server did not start")


def stop_capture():
    global CAPTURE_PROC
    if CAPTURE_PROC is not None:
        CAPTURE_PROC.terminate()
        CAPTURE_PROC.wait(timeout=5)
        CAPTURE_PROC = None


def client():
    from fastapi.testclient import TestClient
    from main import app
    return TestClient(app)


def submit(marker, email="sender@coinscan-e2e.com", name="Test Sender", rating=4):
    return client().post("/api/contact", json={
        "text": f"{MARKER} {marker}", "rating": rating,
        "email": email, "username": name,
    })


def db_rows(marker):
    rows = db.query(
        "SELECT name, email, rating, message FROM contact_messages "
        "WHERE message LIKE %s ORDER BY id DESC",
        (f"%{MARKER} {marker}%",),
    )
    return rows


def cleanup_db():
    db.execute(
        "DELETE FROM contact_messages WHERE message LIKE %s", (f"%{MARKER}%",)
    )


def read_capture():
    if not os.path.exists(JSONL):
        return []
    with open(JSONL, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


# --------------------------------------------------------------------------
# states
# --------------------------------------------------------------------------

def state_a_email_sent():
    global CAPTURE_PROC
    CAPTURE_PROC = start_capture("accept")
    apply_smtp(True)
    try:
        r = submit("A")
        expect(r.status_code == 200, f"status {r.status_code}: {r.text}")
        body = r.json()
        expect(body.get("saved") is True, f"saved flag: {body}")
        expect(body.get("emailSent") is True, f"emailSent should be true: {body}")
        rows = db_rows("A")
        expect(len(rows) == 1, f"expected 1 DB row, got {len(rows)}")
        row = rows[0]
        expect(row["name"] == "Test Sender", f"name not stored: {row}")
        expect(row["email"] == "sender@coinscan-e2e.com", f"email not stored: {row}")
        expect(row["rating"] == 4, f"rating not stored: {row}")
        captured = read_capture()
        expect(len(captured) == 1, f"SMTP server captured {len(captured)} messages")
        rec = captured[0]
        expect(MARKER in rec["body"], "message text missing from email body")
        expect("Test Sender" in rec["body"], "sender name missing from email body")
        expect(rec["subject"].startswith("CoinScan Feedback (4/5)"),
               f"bad subject: {rec['subject']!r}")
    finally:
        stop_capture()


def state_b_server_down():
    apply_smtp(True)
    # Point at a closed port: connection refused (capture server stopped).
    config.SMTP_PORT = SMTP_PORT + 7
    try:
        r = submit("B")
        expect(r.status_code == 200, f"status {r.status_code}: {r.text}")
        body = r.json()
        expect(body.get("saved") is True, f"row must be saved: {body}")
        expect(body.get("emailSent") is False,
               f"emailSent must be false when SMTP is down: {body}")
        rows = db_rows("B")
        expect(len(rows) == 1,
               f"DB row must persist despite SMTP failure, got {len(rows)}")
    finally:
        apply_smtp(False)


def state_c_server_rejects():
    global CAPTURE_PROC
    CAPTURE_PROC = start_capture("reject")
    apply_smtp(True)
    try:
        r = submit("C")
        expect(r.status_code == 200, f"status {r.status_code}: {r.text}")
        body = r.json()
        expect(body.get("saved") is True, f"row must be saved: {body}")
        expect(body.get("emailSent") is False,
               f"emailSent must be false on SMTP 550: {body}")
        rows = db_rows("C")
        expect(len(rows) == 1, f"DB row must persist on SMTP reject, got {len(rows)}")
        expect(read_capture() == [], "rejected message must not be captured")
    finally:
        stop_capture()
        apply_smtp(False)


def state_d_database_down():
    orig_host, orig_port = config.MYSQL_HOST, config.MYSQL_PORT
    config.MYSQL_HOST, config.MYSQL_PORT = "127.0.0.1", 1  # nothing listens here
    try:
        r = submit("D")
        expect(r.status_code == 500, f"expected 500, got {r.status_code}: {r.text}")
        detail = r.json().get("detail", "")
        expect(str(detail).startswith("Database error"),
               f"detail not clean: {detail!r}")
        expect("Traceback" not in r.text and "pymysql" not in r.text,
               "500 leaked internals")
    finally:
        config.MYSQL_HOST, config.MYSQL_PORT = orig_host, orig_port


def state_e_validation():
    c = client()
    r = c.post("/api/contact", json={
        "text": f"{MARKER} bad email", "rating": 3, "email": "not-an-email",
    })
    expect(r.status_code == 422, f"invalid email accepted: {r.status_code}")
    r = c.post("/api/contact", json={"text": "   ", "rating": 0})
    expect(r.status_code == 422, f"whitespace text accepted: {r.status_code}")
    r = c.post("/api/contact", json={
        "text": f"{MARKER} rating", "rating": 99, "email": "a@b.co",
    })
    expect(r.status_code == 422, f"rating 99 accepted: {r.status_code}")
    rows = db_rows("bad email")
    expect(len(rows) == 0, f"422 must not write a DB row, found: {rows}")


def main():
    global CAPTURE_PROC
    print("== Contact endpoint states (SMTP capture + DB) ==")
    for name, fn in [
        ("A: SMTP up -> saved + emailSent=true + email captured", state_a_email_sent),
        ("B: SMTP down -> saved + emailSent=false, row persists", state_b_server_down),
        ("C: SMTP rejects -> saved + emailSent=false, row persists", state_c_server_rejects),
        ("D: DB down -> 500 clean detail, no traceback", state_d_database_down),
        ("E: validation 422 (invalid email/text/rating)", state_e_validation),
    ]:
        check(name, fn)

    stop_capture()
    apply_smtp(False)
    try:
        cleanup_db()
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
