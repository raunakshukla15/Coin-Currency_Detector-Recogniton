import os
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from auth import router as auth_router
from contact import router as contact_router
from userdata import router as userdata_router
import config
from config import CORS_ORIGINS, GEMINI_MODEL
import ai

# --- Environment/secrets guardrails (dev warns, production refuses) ---
_WEAK_SECRETS = {"", "dev-only-change-me", "change-me-to-a-long-random-string"}
if config.APP_ENV == "production":
    if config.JWT_SECRET in _WEAK_SECRETS or len(config.JWT_SECRET) < 32:
        raise RuntimeError(
            "Refusing to start in production with a default/weak JWT_SECRET. "
            "Set JWT_SECRET to a long random string (>=32 chars) in the environment."
        )
    if not os.getenv("GEMINI_API_KEY"):
        raise RuntimeError("Refusing to start in production without GEMINI_API_KEY.")
elif config.JWT_SECRET in _WEAK_SECRETS:
    print(
        "[config] WARNING: using the default dev JWT_SECRET. "
        "Set a strong JWT_SECRET before deploying.",
        file=sys.stderr,
    )

# Free-tier-only guard: refuse ANY model outside the verified free allowlist
# (dev and prod alike) so no paid model can ever be configured by accident.
try:
    ai._assert_free_only(GEMINI_MODEL)
except ai.AIError as exc:
    raise RuntimeError(str(exc)) from exc

# --- Automatic schema initialization (idempotent, startup-time, no endpoint) ---
# Creates ONLY missing tables in the configured MYSQL_DATABASE. Existing
# tables/rows are never touched; CREATE DATABASE / USE / DROP statements in
# schema.sql are never executed (see dbinit.py). Failures are logged with
# table names only — never passwords, JWT secrets, or API keys — and do not
# crash boot, so /api/health keeps working while the database is unreachable.
try:
    from dbinit import init_schema

    init_schema()
except Exception as exc:  # noqa: BLE001
    print(f"[dbinit] ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
    print(
        "[dbinit] database schema initialization failed — data endpoints will "
        "return errors until the database is reachable and configured "
        "correctly (check MYSQL_* and MYSQL_SSL_* settings above).",
        file=sys.stderr,
    )

app = FastAPI(title="CoinScan API", version="1.1.0")

if config.APP_ENV == "production":
    # Production deployments must override these explicitly (see .env.example).
    print(
        f"[config] APP_ENV=production; CORS origins: {', '.join(CORS_ORIGINS) or '(none)'}",
        file=sys.stderr,
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(contact_router)
app.include_router(userdata_router)


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "service": "coinscan",
        "version": "1.0.0",
        "ai_model": GEMINI_MODEL,
        "ai_model_resolved": ai.LAST_RESOLVED_MODEL,
    }