import os

from dotenv import load_dotenv

load_dotenv()

# Deployment environment: "development" (default) or "production".
# Production refuses to start with a weak/default JWT secret (see main.py).
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()

# MySQL connection settings
MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "coinscan")

# Secret used to sign JWT access tokens (change in production!)
JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRES_DAYS = int(os.getenv("JWT_EXPIRES_DAYS", "7"))

# SMTP settings used to deliver Contact Us messages by email.
# For Gmail set SMTP_USER to your Gmail address and SMTP_PASSWORD to an
# App Password (https://myaccount.google.com/apppasswords), not your login password.
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
# Team inbox that receives Contact Us feedback (shown on the Contact page).
CONTACT_TO = os.getenv("CONTACT_TO", "raunakbshukla133@gmail.com")
# STARTTLS: on by default for submission ports (587/25); off otherwise so
# local/internal relays (e.g. a test capture server on 2525) work without TLS.
SMTP_STARTTLS_RAW = os.getenv("SMTP_STARTTLS", "").strip().lower()
SMTP_STARTTLS = (
    SMTP_STARTTLS_RAW in ("1", "true", "yes", "on")
    if SMTP_STARTTLS_RAW
    else SMTP_PORT in (587, 25)
)

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]

# Google Gemini (server-side only — never sent to the browser)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
# Endpoint override — only for tests/proxies. Empty = Google's official API.
GEMINI_API_URL = os.getenv("GEMINI_API_URL", "")
# Free-tier model only ($0 — no credits/payment). The backend refuses any
# model that is not in the verified free allowlist (see backend/ai.py).
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")