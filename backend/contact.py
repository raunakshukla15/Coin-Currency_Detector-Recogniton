"""Contact Us endpoint: stores feedback and emails it via SMTP."""

import smtplib
import ssl
from email.message import EmailMessage

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import config
import db

router = APIRouter(prefix="/api/contact", tags=["contact"])


class ContactIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    rating: int = Field(default=0, ge=0, le=5)
    email: str = Field(default="", max_length=255)
    username: str = Field(default="", max_length=40)


def send_email(text: str, rating: int, email: str, username: str) -> bool:
    """Deliver the feedback message to CONTACT_TO via SMTP. Returns True on success."""
    if not config.SMTP_USER or not config.SMTP_PASSWORD:
        return False

    msg = EmailMessage()
    msg["Subject"] = f"CoinScan Feedback ({rating}/5) from {username or 'Guest'}"
    msg["From"] = config.SMTP_USER
    msg["To"] = config.CONTACT_TO
    msg["Reply-To"] = email or config.SMTP_USER

    body = (
        f"New feedback received from the CoinScan Contact Us page.\n\n"
        f"Sender name: {username or '-'}\n"
        f"Sender email: {email or '-'}\n"
        f"Star rating: {rating}/5\n\n"
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
                srv.starttls(context=ssl.create_default_context())
                srv.login(config.SMTP_USER, config.SMTP_PASSWORD)
                srv.send_message(msg)
        return True
    except Exception:
        return False


@router.post("")
def submit(body: ContactIn):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Feedback message cannot be empty.")

    try:
        db.execute(
            "INSERT INTO contact_messages (name, email, rating, message) VALUES (%s, %s, %s, %s)",
            (body.username.strip(), body.email.strip(), body.rating, text),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    email_sent = send_email(text, body.rating, body.email.strip(), body.username.strip())
    return {"ok": True, "saved": True, "emailSent": email_sent}