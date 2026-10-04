"""Thin MySQL connection helper backed by PyMySQL."""

import os
import ssl as ssl_lib
from contextlib import contextmanager

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


@contextmanager
def transaction():
    """Single connection running an explicit transaction.

    Commits when the block completes normally, rolls back on ANY error
    (including HTTPException raised inside the block), then closes the
    connection. pymysql's plain connection context manager only closes
    (implicit rollback), so commit/rollback are handled here.

    The helpers above open one autocommit connection per call and cannot be
    used for atomic multi-statement work — use this instead, e.g.:

        with transaction() as cur:
            cur.execute("DELETE FROM ...", (id,))
            cur.execute("DELETE FROM ...", (id,))
    """
    conn = connection()
    try:
        conn.autocommit(False)
        with conn.cursor() as cur:
            yield cur
        conn.commit()
    except BaseException:
        try:
            conn.rollback()
        except pymysql.MySQLError:
            pass
        raise
    finally:
        try:
            conn.close()
        except pymysql.MySQLError:
            pass
