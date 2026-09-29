"""Contact Us endpoint: stores feedback and emails it via SMTP.

Flow: validate -> dedupe (submissionId) -> SAVE TO DB FIRST -> best-effort
email. A later SMTP failure can never lose a submission, and the response
always truthfully separates "saved" from "emailed".

Rating semantics: 0 means "not rated" (the user left the stars untouched).
0 is stored as-is for backward compatibility with existing rows; 1-5 are
explicit ratings.

Email recipient: config.CONTACT_TO — the team inbox shown in the Contact
page's CONTACT_INFO (env-overridable; default is the team address).
"""

import datetime
import re
import smtplib
import ssl
import sys
from email.message import EmailMessage

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import config
import db
from deps import get_optional_user

router = APIRouter(prefix="/api/contact", tags=["contact"])

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

    Called AFTER the row is already persisted — an SMTP outage must never
    lose the database submission. Returns (ok, reason) where reason is a
    sanitized token: ok | not_configured | no_recipient | delivery_failed.
    """
    if not config.SMTP_USER or not config.SMTP_PASSWORD:
        _log(
            "SMTP not configured (SMTP_USER/SMTP_PASSWORD empty in backend/.env) "
            "— skipping email; the feedback is saved in the database."
        )
        return False, "not_configured"
    if not config.CONTACT_TO:
        _log("CONTACT_TO is empty — cannot deliver feedback email.")
        return False, "no_recipient"

    sender_name = _sanitize_header(username or "Guest")
    msg = EmailMessage()
    msg["Subject"] = _sanitize_header(f"CoinScan Feedback ({rating}/5) from {sender_name}")
    msg["From"] = config.SMTP_USER
    msg["To"] = config.CONTACT_TO
    msg["Reply-To"] = email or config.SMTP_USER

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
    msg.set_content(body)

    try:
        if config.SMTP_PORT == 465:
            with smtplib.SMTP_SSL(
                config.SMTP_HOST, config.SMTP_PORT, context=ssl.create_default_context()
            ) as srv:
                srv.login(config.SMTP_USER, config.SMTP_PASSWORD)
                srv.send_message(msg)
        else:
            with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=20) as srv:
                if config.SMTP_STARTTLS:
                    srv.starttls(context=ssl.create_default_context())
                srv.login(config.SMTP_USER, config.SMTP_PASSWORD)
                srv.send_message(msg)
        return True, "ok"
    except Exception as exc:  # noqa: BLE001 — log type only, never the raw error
        _log(
            f"email delivery to CONTACT_TO failed ({type(exc).__name__}); "
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

    # 1) Persist FIRST — the message is never lost to a later SMTP failure.
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
