"""Contact Us endpoint: stores feedback and emails it via the Brevo API.

Flow: validate -> dedupe (submissionId) -> SAVE TO DB FIRST -> best-effort
email. A later delivery failure can never lose a submission, and the response
always truthfully separates "saved" from "emailed".

Rating semantics: 0 means "not rated" (the user left the stars untouched).
0 is stored as-is for backward compatibility with existing rows; 1-5 are
explicit ratings.

Delivery: Brevo's transactional REST API over HTTPS (api-key header) —
replaces the old Gmail SMTP path, which Render Free blocks on port 587.
Recipient: config.CONTACT_TO — the team inbox shown in the Contact page's
CONTACT_INFO (env-overridable; default is the team address).
"""

import datetime
import json
import re
import sys
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import config
import db
from deps import get_optional_user

router = APIRouter(prefix="/api/contact", tags=["contact"])

BREVO_URL = "https://api.brevo.com/v3/smtp/email"
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
# Client-generated idempotency key (crypto.randomUUID() = 8-36 base62/dash).
SUBMISSION_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,36}$")
# Control chars (incl. CR/LF) are stripped everywhere a value enters an
# email header — prevents header injection.
_HEADER_UNSAFE_RE = re.compile(r"[\x00-\x1f\x7f]+")


def _log(msg: str) -> None:
    """Sanitized server-side log line (never includes credentials/secrets)."""
    print(f"[contact] {msg}", file=sys.stderr)


def _sanitize_header(value: str) -> str:
    return _HEADER_UNSAFE_RE.sub(" ", value).strip()


class ContactIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    rating: int = Field(default=0, ge=0, le=5)
    email: str = Field(default="", max_length=255)
    username: str = Field(default="", max_length=40)
    # Optional client idempotency key: retries with the same id never
    # create a duplicate row or a duplicate email.
    submissionId: str | None = Field(
        default=None, min_length=8, max_length=36, pattern=r"^[A-Za-z0-9-]+$"
    )


def _brevo_request(payload: dict, api_key: str) -> int:
    """POST one transactional email to Brevo's HTTPS API; return HTTP status.

    Standard-library urllib only (no new dependency). Any non-2xx response
    raises urllib.error.HTTPError; network/DNS/TLS failures raise
    urllib.error.URLError. The API key travels ONLY in the `api-key` header
    and is never included in any log or exception message here.
    """
    req = urllib.request.Request(
        BREVO_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "api-key": api_key,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310 — fixed HTTPS URL
        return getattr(resp, "status", None) or resp.getcode()


def send_email(
    text: str,
    rating: int,
    email: str,
    username: str,
    submitted_at: str,
    linked: str,
    submission_id: str | None = None,
) -> tuple[bool, str]:
    """Deliver the feedback message to the team inbox (config.CONTACT_TO).

    Called AFTER the row is already persisted — a Brevo/API outage must never
    lose the database submission. Returns (ok, reason) where reason is a
    sanitized token: ok | not_configured | no_recipient | delivery_failed.
    """
    if not config.BREVO_API_KEY or not config.BREVO_SENDER_EMAIL:
        _log(
            "Brevo not configured (BREVO_API_KEY/BREVO_SENDER_EMAIL empty in the "
            "environment) — skipping email; the feedback is saved in the database."
        )
        return False, "not_configured"
    if not config.CONTACT_TO:
        _log("CONTACT_TO is empty — cannot deliver feedback email.")
        return False, "no_recipient"

    sender_name = _sanitize_header(username or "Guest")
    subject = _sanitize_header(f"CoinScan Feedback ({rating}/5) from {sender_name}")
    body = (
        f"New feedback received from the CoinScan Contact Us page.\n\n"
        f"Sender name: {_sanitize_header(username) or '-'}\n"
        f"Sender email: {email or '-'}\n"
        f"Linked account: {linked}\n"
        f"Star rating: {rating}/5 ({'not rated' if rating == 0 else 'rated'})\n"
        f"Submitted at: {submitted_at}\n"
        f"Submission id: {submission_id or '-'}\n\n"
        f"Message:\n{text}\n"
    )
    payload = {
        "sender": {"name": "CoinScan", "email": config.BREVO_SENDER_EMAIL},
        "to": [{"email": config.CONTACT_TO}],
        "subject": subject,
        "textContent": body,
    }
    if email:
        payload["replyTo"] = {"email": email}

    try:
        status = _brevo_request(payload, config.BREVO_API_KEY)
    except urllib.error.HTTPError as exc:
        # Brevo answered with an error (4xx/5xx). Log the status only —
        # never the API key or the response body.
        _log(
            f"Brevo email delivery failed (HTTP {exc.code}); "
            "the feedback remains saved in the database."
        )
        return False, "delivery_failed"
    except Exception as exc:  # noqa: BLE001 — log type only, never the raw error
        _log(
            f"Brevo email delivery failed ({type(exc).__name__}); "
            "the feedback remains saved in the database."
        )
        return False, "delivery_failed"

    if 200 <= status < 300:
        return True, "ok"
    _log(
        f"Brevo email delivery failed (HTTP {status}); "
        "the feedback remains saved in the database."
    )
    return False, "delivery_failed"


@router.post("")
def submit(body: ContactIn, user: dict | None = Depends(get_optional_user)):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Feedback message cannot be empty.")

    email = body.email.strip()
    if email and not EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Please enter a valid email address.")

    # Idempotency: a retried request with the same submissionId neither
    # inserts a second row nor sends a second email.
    if body.submissionId:
        existing = db.fetch_one(
            "SELECT id FROM contact_messages WHERE submission_id = %s",
            (body.submissionId,),
        )
        if existing:
            return {
                "ok": True,
                "saved": True,
                "emailSent": False,
                "duplicate": True,
                "emailReason": "duplicate",
            }

    user_id = user["id"] if user else None
    linked = f"{user['username']} (user #{user['id']})" if user else "Guest (not signed in)"
    submitted_at = datetime.datetime.now().astimezone().isoformat(timespec="seconds")

    # 1) Persist FIRST — the message is never lost to a later delivery failure.
    try:
        db.execute(
            "INSERT INTO contact_messages "
            "(name, email, rating, message, user_id, submission_id) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (body.username.strip(), email, body.rating, text, user_id, body.submissionId),
        )
    except Exception as exc:  # noqa: BLE001
        # Race: same submissionId inserted concurrently -> treat as duplicate.
        if body.submissionId and getattr(exc, "args", None) and exc.args and exc.args[0] == 1062:
            return {
                "ok": True,
                "saved": True,
                "emailSent": False,
                "duplicate": True,
                "emailReason": "duplicate",
            }
        _log(f"database error while saving feedback ({type(exc).__name__})")
        raise HTTPException(
            status_code=500, detail="Database error while saving your message."
        ) from exc

    # 2) Best-effort email — failure only flips emailSent=false.
    email_ok, reason = send_email(
        text,
        body.rating,
        email,
        body.username.strip(),
        submitted_at,
        linked,
        body.submissionId,
    )
    return {"ok": True, "saved": True, "emailSent": email_ok, "emailReason": reason}
