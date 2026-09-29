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


def get_optional_user(authorization: str = Header(default="")) -> dict | None:
    """Resolve the caller from the Bearer JWT if present, else None (guest).

    Used by endpoints that must accept BOTH logged-in and guest traffic
    (e.g. Contact Us). The identity, when present, ALWAYS comes from the
    verified token — never from a value supplied by the client. An absent,
    invalid, or expired token is treated as a guest (user_id = NULL) so a
    submission is never lost because a session lapsed mid-use.
    """
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        return None
    payload = security.decode_token(token)
    if not payload:
        return None
    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        return None
    # None also when the account was deleted after the token was issued.
    return db.fetch_one(
        "SELECT id, email, username FROM users WHERE id = %s", (user_id,)
    )
