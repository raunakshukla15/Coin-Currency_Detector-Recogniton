"""Thin MySQL connection helper backed by PyMySQL."""

import pymysql
import pymysql.cursors

import config


def connection():
    return pymysql.connect(
        host=config.MYSQL_HOST,
        port=config.MYSQL_PORT,
        user=config.MYSQL_USER,
        password=config.MYSQL_PASSWORD,
        database=config.MYSQL_DATABASE,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )


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