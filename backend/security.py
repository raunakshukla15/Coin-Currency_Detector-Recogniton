"""Password hashing (PBKDF2 via stdlib) and JWT signing."""

import base64
import hashlib
import hmac
import os
import time

import jwt

import config

_PBKDF2_ITERATIONS = 210_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return (
        f"pbkdf2_sha256${_PBKDF2_ITERATIONS}"
        f"${base64.b64encode(salt).decode('ascii')}"
        f"${base64.b64encode(dk).decode('ascii')}"
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt_b64, hash_b64 = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(dk, expected)
    except (ValueError, TypeError):
        return False


def create_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "iat": int(time.time()),
        "exp": int(time.time()) + config.JWT_EXPIRES_DAYS * 86400,
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


def decode_token(token: str):
    try:
        return jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None