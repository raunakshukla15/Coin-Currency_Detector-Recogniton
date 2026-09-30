"""Thin MySQL connection helper backed by PyMySQL."""

import os
import ssl as ssl_lib

import pymysql
import pymysql.cursors

import config


def ssl_context() -> "ssl_lib.SSLContext":
    """Build a VERIFIED TLS context (CERT_REQUIRED + hostname check).

    Used when MYSQL_SSL is enabled (e.g. Aiven MySQL, which requires TLS).
    Certificate verification can never be turned off here: the context comes
    from ssl.create_default_context(), which only ever *adds* requirements.

    - MYSQL_SSL_CA: PEM bundle used to verify the server cert (path relative
      to backend/ unless absolute). Aiven: download the service's `ca.pem`.
    - MYSQL_SSL_CERT / MYSQL_SSL_KEY: optional client certificate pair.
    Raises FileNotFoundError with the path (never the password) if the CA
    file is missing.
    """
    ca = config.MYSQL_SSL_CA or None
    if ca and not os.path.isabs(ca):
        ca = os.path.join(os.path.dirname(os.path.abspath(__file__)), ca)
    if ca and not os.path.isfile(ca):
        raise FileNotFoundError(f"MYSQL_SSL_CA file not found: {ca}")
    ctx = ssl_lib.create_default_context(cafile=ca)
    if config.MYSQL_SSL_CERT and config.MYSQL_SSL_KEY:
        ctx.load_cert_chain(config.MYSQL_SSL_CERT, config.MYSQL_SSL_KEY)
    return ctx


def connection():
    kwargs = dict(
        host=config.MYSQL_HOST,
        port=config.MYSQL_PORT,
        user=config.MYSQL_USER,
        password=config.MYSQL_PASSWORD,
        database=config.MYSQL_DATABASE,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )
    if config.MYSQL_SSL:
        # Required + verified TLS; passing an SSLContext makes pymysql
        # treat SSL as mandatory (no silent plaintext fallback).
        kwargs["ssl"] = ssl_context()
    return pymysql.connect(**kwargs)


def query(sql: str, params: tuple = ()):
    """Run a SELECT and return the list of row dicts."""
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


def fetch_one(sql: str, params: tuple = ()):
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: tuple = ()):
    """Run an INSERT/UPDATE/DELETE. Returns last insert id (or None)."""
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.lastrowid
