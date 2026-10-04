"""Authentication endpoints backed by MySQL + JWT."""

import re
import sys

import pymysql
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr, Field

import db
import deps
import security

router = APIRouter(prefix="/api/auth", tags=["auth"])

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class SignUpIn(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=r"^[a-zA-Z0-9_.-]+$")
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginIn(BaseModel):
    identifier: str = Field(min_length=1)
    password: str = Field(min_length=1)


class MeOut(BaseModel):
    id: int
    email: str
    username: str


class DeleteAccountIn(BaseModel):
    # Non-empty password is required; the identity comes ONLY from the JWT.
    password: str = Field(min_length=1, max_length=128)


@router.get("/health")
def health():
    return {"ok": True}


@router.post("/signup")
def signup(body: SignUpIn):
    username = body.username.strip()
    email = body.email.strip()

    try:
        existing = db.fetch_one(
            "SELECT id FROM users WHERE username = %s OR email = %s", (username, email)
        )
    except pymysql.MySQLError as exc:
        # Same guard as the INSERT below: connection/TLS/table failures here
        # used to escape as an unhandled exception, so the browser received a
        # bare 500 without CORS headers (reported as a CORS error).
        print(f"[auth] signup lookup database error ({type(exc).__name__})", file=sys.stderr)
        raise HTTPException(
            status_code=500, detail="Database error while checking the account."
        ) from exc
    if existing:
        raise HTTPException(
            status_code=409, detail="An account with that username or email already exists."
        )

    password_hash = security.hash_password(body.password)
    try:
        user_id = db.execute(
            "INSERT INTO users (username, email, password_hash) VALUES (%s, %s, %s)",
            (username, email, password_hash),
        )
    except pymysql.MySQLError as exc:
        # Never expose SQL/driver internals to the client — log the type only.
        print(f"[auth] signup database error ({type(exc).__name__})", file=sys.stderr)
        raise HTTPException(
            status_code=500, detail="Database error while creating the account."
        ) from exc

    token = security.create_token(user_id)
    return {"user": {"id": user_id, "email": email, "username": username}, "token": token}


@router.post("/login")
def login(body: LoginIn):
    identifier = body.identifier.strip()
    email = identifier if EMAIL_RE.match(identifier) else None

    user = (
        db.fetch_one("SELECT * FROM users WHERE email = %s", (identifier,))
        if email
        else db.fetch_one("SELECT * FROM users WHERE username = %s", (identifier,))
    )
    if not user or not security.verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    token = security.create_token(user["id"])
    return {
        "user": {"id": user["id"], "email": user["email"], "username": user["username"]},
        "token": token,
    }


@router.post("/logout")
def logout():
    # Stateless JWT flow: the token simply expires client-side. There is
    # nothing server-side to invalidate.
    return {"ok": True}


@router.get("/me", response_model=MeOut)
def me(authorization: str = Header(default="")):
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    payload = security.decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    user = db.fetch_one("SELECT id, email, username FROM users WHERE id = %s", (int(payload["sub"]),))
    if not user:
        raise HTTPException(status_code=401, detail="Account no longer exists")

    return {"id": user["id"], "email": user["email"], "username": user["username"]}


@router.delete("/account")
def delete_account(body: DeleteAccountIn, user: dict = Depends(deps.get_current_user)):
    """Permanently delete the authenticated account and everything it owns.

    Identity comes exclusively from the verified JWT (get_current_user also
    proves the account still exists). The re-entered password is verified
    against the stored hash BEFORE any row is touched; a wrong password
    changes nothing. All deletes run in one transaction and are committed
    only when every statement succeeded.
    """
    row = db.fetch_one(
        "SELECT id, password_hash FROM users WHERE id = %s", (user["id"],)
    )
    if not row:
        raise HTTPException(status_code=401, detail="Account no longer exists")
    if not security.verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=403, detail="Incorrect password.")

    uid = row["id"]
    try:
        with db.transaction() as cur:
            # Children first so the order is safe with or without the
            # ON DELETE CASCADE/SET NULL foreign keys. Every statement is
            # scoped to this one user_id — never a broad delete.
            cur.execute("DELETE FROM contact_messages WHERE user_id = %s", (uid,))
            cur.execute("DELETE FROM chat_messages WHERE user_id = %s", (uid,))
            cur.execute("DELETE FROM chats WHERE user_id = %s", (uid,))
            cur.execute("DELETE FROM scan_history WHERE user_id = %s", (uid,))
            cur.execute("DELETE FROM collection_items WHERE user_id = %s", (uid,))
            cur.execute("DELETE FROM user_images WHERE user_id = %s", (uid,))
            cur.execute("DELETE FROM users WHERE id = %s", (uid,))
            if cur.rowcount != 1:
                # Concurrently removed by another request — nothing was left
                # to delete; roll back and report, never claim success.
                raise HTTPException(status_code=401, detail="Account no longer exists")
    except HTTPException:
        raise
    except pymysql.MySQLError as exc:
        # Transaction already rolled back — no partial deletion can persist.
        print(f"[auth] delete account database error ({type(exc).__name__})", file=sys.stderr)
        raise HTTPException(
            status_code=500, detail="Database error while deleting the account."
        ) from exc

    return {"ok": True}