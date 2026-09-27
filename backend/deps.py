"""Shared FastAPI dependencies — authenticated user resolution from JWT."""

from fastapi import Depends, HTTPException, Header

import db
import security


def get_current_user(authorization: str = Header(default="")) -> dict:
    """Resolve the authenticated user from the Bearer JWT.

    The user identity ALWAYS comes from the verified token — never from a
    user_id supplied in the request body or query string.
    """
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    payload = security.decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = db.fetch_one(
        "SELECT id, email, username FROM users WHERE id = %s", (int(payload["sub"]),)
    )
    if not user:
        raise HTTPException(status_code=401, detail="Account no longer exists")
    return user


def current_user(user: dict = Depends(get_current_user)) -> dict:
    return user
