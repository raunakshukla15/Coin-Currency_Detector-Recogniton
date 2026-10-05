"""Contact-Us endpoint tests: the real outcomes + input validation.

Email delivery goes through Brevo's HTTPS transactional API
(contact._brevo_request) — which is MOCKED below. No network traffic and no
real email is ever sent by this suite.

  State A  Brevo accepts          -> saved=true, emailSent=true, row in DB,
                                      payload has sender/recipient/subject/body
  State B  Brevo unreachable      -> saved=true, emailSent=false,
                                      row STILL in DB (DB-first ordering)
  State C  Brevo answers HTTP 401 -> saved=true, emailSent=false,
                                      row STILL in DB
  State D  Database down          -> HTTP 500 with clean "Database error"
                                      detail, no traceback leak
  State E  Validation             -> 422 for invalid email / empty text
  State F  Recipient + content    -> to == CONTACT_TO; payload carries name,
                                      sender email, rating, the feedback text,
                                      submission id, "Submitted at:" +
                                      "Linked account:"; a CR/LF-laden name
                                      cannot corrupt the subject line
  State G  Brevo creds unset      -> saved=true, emailSent=false,
                                      emailReason=not_configured, row kept
  State H  submissionId idempotency -> retry: 1 row + 1 send; new id:
                                      new row + new send
  State I  Recipient configuration -> config.CONTACT_TO == team inbox
  State J  Secret hygiene          -> BREVO_API_KEY never appears in the
                                      response body, the server log, or the
                                      request payload sent to Brevo

Run from the repo root:
    python tests/test_contact_smtp.py
"""

import contextlib
import io
import json
import os
import sys
import time
import urllib.error

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "backend"))

import config  # noqa: E402
import db  # noqa: E402
import contact  # noqa: E402

RESULTS = []
MARKER = f"contact-smtp-{int(time.time())}"

# Test-only Brevo settings; the key is a sentinel that must never be logged.
BREVO_SETTINGS = {
    "BREVO_API_KEY": "test-brevo-key-never-leave-machine",
    "BREVO_SENDER_EMAIL": "archanark1013@gmail.com",
    "CONTACT_TO": "inbox@coinscan.test",
}
_ORIG = {k: getattr(config, k) for k in BREVO_SETTINGS}

# Captured (payload, api_key) tuples from mocked Brevo sends.
SENDS = []
_ORIG_BREVO_REQUEST = contact._brevo_request


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


def apply_brevo(enabled=True):
    if enabled:
        for k, v in BREVO_SETTINGS.items():
            setattr(config, k, v)
    else:
        for k, v in _ORIG.items():
            setattr(config, k, v)


def set_brevo(fn):
    contact._brevo_request = fn


def unset_brevo():
    contact._brevo_request = _ORIG_BREVO_REQUEST
    SENDS.clear()


def brevo_ok(payload, api_key):
    SENDS.append((payload, api_key))
    return 201


def brevo_unreachable(payload, api_key):
    SENDS.append((payload, api_key))
    raise urllib.error.URLError("connection refused")


def brevo_http_error(payload, api_key):
    SENDS.append((payload, api_key))
    raise urllib.error.HTTPError(contact.BREVO_URL, 401, "Unauthorized", None, None)


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


# --------------------------------------------------------------------------
# states
# --------------------------------------------------------------------------

def state_a_email_sent():
    apply_brevo(True)
    set_brevo(brevo_ok)
    try:
        r = submit("A")
        expect(r.status_code == 200, f"status {r.status_code}: {r.text}")
        body = r.json()
        expect(body.get("saved") is True, f"saved flag: {body}")
        expect(body.get("emailSent") is True, f"emailSent should be true: {body}")
        expect(body.get("emailReason") == "ok", f"emailReason should be ok: {body}")
        rows = db_rows("A")
        expect(len(rows) == 1, f"expected 1 DB row, got {len(rows)}")
        row = rows[0]
        expect(row["name"] == "Test Sender", f"name not stored: {row}")
        expect(row["email"] == "sender@coinscan-e2e.com", f"email not stored: {row}")
        expect(row["rating"] == 4, f"rating not stored: {row}")
        expect(len(SENDS) == 1, f"expected 1 Brevo send, got {len(SENDS)}")
        payload, api_key = SENDS[0]
        expect(api_key == BREVO_SETTINGS["BREVO_API_KEY"],
               "send must use BREVO_API_KEY from config")
        expect(payload["sender"] == {"name": "CoinScan",
                                     "email": BREVO_SETTINGS["BREVO_SENDER_EMAIL"]},
               f"wrong sender: {payload.get('sender')}")
        expect(payload["to"] == [{"email": BREVO_SETTINGS["CONTACT_TO"]}],
               f"wrong recipient: {payload.get('to')}")
        expect(payload["subject"].startswith("CoinScan Feedback (4/5)"),
               f"bad subject: {payload.get('subject')!r}")
        expect(MARKER + " A" in payload["textContent"],
               "message text missing from email body")
        expect("Test Sender" in payload["textContent"],
               "sender name missing from email body")
    finally:
        unset_brevo()
        apply_brevo(False)


def state_b_server_down():
    apply_brevo(True)
    set_brevo(brevo_unreachable)
    try:
        r = submit("B")
        expect(r.status_code == 200, f"status {r.status_code}: {r.text}")
        body = r.json()
        expect(body.get("saved") is True, f"row must be saved: {body}")
        expect(body.get("emailSent") is False,
               f"emailSent must be false when Brevo is unreachable: {body}")
        expect(body.get("emailReason") == "delivery_failed",
               f"emailReason must be delivery_failed: {body}")
        rows = db_rows("B")
        expect(len(rows) == 1,
               f"DB row must persist despite delivery failure, got {len(rows)}")
    finally:
        unset_brevo()
        apply_brevo(False)


def state_c_server_rejects():
    apply_brevo(True)
    set_brevo(brevo_http_error)
    try:
        r = submit("C")
        expect(r.status_code == 200, f"status {r.status_code}: {r.text}")
        body = r.json()
        expect(body.get("saved") is True, f"row must be saved: {body}")
        expect(body.get("emailSent") is False,
               f"emailSent must be false on Brevo HTTP error: {body}")
        rows = db_rows("C")
        expect(len(rows) == 1, f"DB row must persist on Brevo error, got {len(rows)}")
        expect(len(SENDS) == 1, "the send must have been attempted exactly once")
        expect(BREVO_SETTINGS["BREVO_API_KEY"] not in r.text,
               "API key leaked into the response body")
    finally:
        unset_brevo()
        apply_brevo(False)


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


def state_f_recipient_and_content():
    """Email goes to CONTACT_TO only; payload carries name, sender email,
    rating, the feedback text, timestamp, submission id + linkage; a
    CR/LF-laden name cannot smuggle control characters into the subject."""
    apply_brevo(True)
    set_brevo(brevo_ok)
    try:
        sid = f"statef{int(time.time() * 1000)}"
        probe_text = f"{MARKER} F recipient probe"
        r = client().post("/api/contact", json={
            "text": probe_text,
            "rating": 5,
            "email": "f-probe@coinscan-e2e.com",
            "username": "Evil\r\nBcc: evil@x.example",
            "submissionId": sid,
        })
        expect(r.status_code == 200, f"status {r.status_code}: {r.text}")
        expect(r.json().get("emailSent") is True, f"emailSent: {r.json()}")
        expect(len(SENDS) == 1, f"expected 1 send, got {len(SENDS)}")
        payload, _ = SENDS[0]
        expect(payload["to"] == [{"email": "inbox@coinscan.test"}],
               f"wrong recipient(s): {payload.get('to')} (want [CONTACT_TO])")
        text = payload["textContent"]
        # Required content: name, email, rating, feedback, submission id
        expect("Evil" in text, "sender name missing from email body")
        expect("f-probe@coinscan-e2e.com" in text,
               "sender email missing from email body")
        expect("5/5" in text, "rating missing from email body")
        expect(probe_text in text, "feedback text missing from email body")
        expect(sid in text, "submission identifier missing from email body")
        expect("Submitted at:" in text, "email body missing 'Submitted at:'")
        expect("Linked account:" in text, "email body missing 'Linked account:'")
        expect("Guest (not signed in)" in text,
               "guest submission should be linked as Guest")
        # Header/subject hygiene: the subject is a single line with no CR/LF,
        # and no extra addressing fields (bcc/cc) exist anywhere in the payload.
        subject = payload["subject"]
        expect("\r" not in subject and "\n" not in subject,
               f"CR/LF leaked into subject: {subject!r}")
        expect(subject.startswith("CoinScan Feedback (5/5) from Evil"),
               f"bad subject after sanitize: {subject!r}")
        flat = json.dumps(payload).lower()
        expect('"bcc' not in flat and '"cc' not in flat,
               f"injected addressing field found in payload: {flat}")
    finally:
        unset_brevo()
        apply_brevo(False)


def state_g_not_configured():
    """Brevo creds unset: the row is still saved and the API reports the
    honest reason not_configured (no send attempted, no crash)."""
    apply_brevo(True)
    orig_key, orig_sender = config.BREVO_API_KEY, config.BREVO_SENDER_EMAIL
    config.BREVO_API_KEY, config.BREVO_SENDER_EMAIL = "", ""
    try:
        r = submit("G")
        expect(r.status_code == 200, f"status {r.status_code}: {r.text}")
        body = r.json()
        expect(body.get("saved") is True, f"row must be saved: {body}")
        expect(body.get("emailSent") is False, f"emailSent must be false: {body}")
        expect(body.get("emailReason") == "not_configured",
               f"emailReason must be not_configured: {body}")
        expect(SENDS == [], "no send may be attempted when not configured")
        rows = db_rows("G")
        expect(len(rows) == 1, f"expected 1 DB row, got {len(rows)}")
    finally:
        config.BREVO_API_KEY, config.BREVO_SENDER_EMAIL = orig_key, orig_sender
        unset_brevo()
        apply_brevo(False)


def state_h_submission_dedupe():
    """Same submissionId retried -> one row + one send; a NEW id -> new row."""
    apply_brevo(True)
    set_brevo(brevo_ok)
    try:
        sid = f"stateh{int(time.time() * 1000)}"
        payload = {
            "text": f"{MARKER} H dedupe probe", "rating": 2,
            "email": "h-probe@coinscan-e2e.com", "username": "Dedupe",
            "submissionId": sid,
        }
        r1 = client().post("/api/contact", json=payload)
        expect(r1.status_code == 200 and r1.json().get("saved") is True,
               f"first submit: {r1.status_code} {r1.text}")
        expect(not r1.json().get("duplicate"), f"first submit flagged duplicate: {r1.json()}")
        expect(len(SENDS) == 1, "first submit must send exactly one email")

        r2 = client().post("/api/contact", json=payload)
        expect(r2.status_code == 200 and r2.json().get("duplicate") is True,
               f"retry not deduped: {r2.status_code} {r2.text}")
        expect(r2.json().get("saved") is True, f"retry must still read saved: {r2.json()}")
        expect(len(SENDS) == 1, "retry must not send a second email")
        n_sid = db.fetch_one(
            "SELECT COUNT(*) AS n FROM contact_messages WHERE submission_id = %s",
            (sid,))["n"]
        expect(n_sid == 1, f"expected 1 row for sid, got {n_sid}")

        # Same text under a NEW id is a legitimate second submission.
        payload2 = dict(payload, submissionId=f"stateh2{int(time.time() * 1000)}")
        r3 = client().post("/api/contact", json=payload2)
        expect(r3.status_code == 200 and r3.json().get("saved") is True
               and not r3.json().get("duplicate"),
               f"new sid submit: {r3.status_code} {r3.text}")
        expect(len(SENDS) == 2, "new sid must send its own email")
        expect(len(db_rows("H dedupe")) == 2, "expected 2 rows total for H probes")
    finally:
        unset_brevo()
        apply_brevo(False)


def state_i_recipient_configured():
    """config.CONTACT_TO (env-overridable, default set in backend/config.py)
    must be the team inbox — this is where delivery goes (state F proves the
    recipient follows the config)."""
    apply_brevo(False)  # restore the real configuration (env/.env/defaults)
    expect(
        config.CONTACT_TO == "archanark1013@gmail.com",
        f"CONTACT_TO must be the team inbox, got {config.CONTACT_TO!r}",
    )


def state_j_api_key_never_exposed():
    """BREVO_API_KEY must never surface in the HTTP response body, the
    server log line, or the JSON payload handed to Brevo."""
    apply_brevo(True)
    set_brevo(brevo_http_error)
    try:
        key = config.BREVO_API_KEY
        expect(key, "test BREVO_API_KEY must be configured for this state")
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            r = submit("J")
        expect(r.status_code == 200, f"status {r.status_code}: {r.text}")
        expect(r.json().get("emailSent") is False, f"emailSent: {r.json()}")
        expect(key not in r.text, "API key leaked into the response body")
        log_text = err.getvalue()
        expect(key not in log_text, "API key leaked into the server log")
        expect(len(SENDS) == 1, f"expected 1 attempted send, got {len(SENDS)}")
        payload, sent_key = SENDS[0]
        expect(key not in json.dumps(payload), "API key leaked into the payload")
        expect(sent_key == key, "send must receive the configured API key")
    finally:
        unset_brevo()
        apply_brevo(False)


def main():
    print("== Contact endpoint states (Brevo mocked + DB) ==")
    for name, fn in [
        ("A: Brevo accepts -> saved + emailSent=true + payload correct", state_a_email_sent),
        ("B: Brevo unreachable -> saved + emailSent=false, row persists", state_b_server_down),
        ("C: Brevo HTTP error -> saved + emailSent=false, row persists", state_c_server_rejects),
        ("D: DB down -> 500 clean detail, no traceback", state_d_database_down),
        ("E: validation 422 (invalid email/text/rating)", state_e_validation),
        ("F: recipient=CONTACT_TO, Submitted-at/linkage, subject sanitized",
         state_f_recipient_and_content),
        ("G: Brevo creds unset -> saved + emailReason=not_configured", state_g_not_configured),
        ("H: submissionId retry -> 1 row + 1 send; new id -> new row",
         state_h_submission_dedupe),
        ("I: CONTACT_TO configured to the team inbox", state_i_recipient_configured),
        ("J: API key never in response, logs, or payload", state_j_api_key_never_exposed),
    ]:
        check(name, fn)

    unset_brevo()
    apply_brevo(False)
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
