import os

from dotenv import load_dotenv

load_dotenv()

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
CONTACT_TO = os.getenv("CONTACT_TO", "raunakbshukla133@gmail.com")

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]