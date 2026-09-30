"""Idempotent schema initialization for deployments (Render, local, tests).

Creates ONLY the tables that are missing from the configured MYSQL_DATABASE.
Called automatically from main.py at startup — there is deliberately no
public initialization endpoint.

Safety rules (enforced in code, covered by tests/test_dbinit.py):
  * Never executes CREATE DATABASE / USE — the connection already targets
    MYSQL_DATABASE, so Aiven's `defaultdb` (or whatever is configured) is
    used as-is; a hardcoded `USE coinscan` can never redirect us.
  * Never executes DROP / ALTER / or any unrecognized statement from
    schema.sql — only `CREATE TABLE IF NOT EXISTS ...` runs, and only for
    tables that information_schema says are missing.
  * Existing tables are never touched; rows are never modified or deleted.
  * Logs table names and counts only — never passwords, JWT secrets,
    API keys, or connection strings.
"""

import os
import re

import config
import db

SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")

_COMMENT_RE = re.compile(r"^\s*--")
_CREATE_TABLE_RE = re.compile(
    r"^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`?([A-Za-z0-9_]+)`?", re.IGNORECASE
)
_CREATE_DB_RE = re.compile(r"^CREATE\s+DATABASE\b", re.IGNORECASE)
_USE_RE = re.compile(r"^USE\s+\S+", re.IGNORECASE)
_DROP_RE = re.compile(r"\bDROP\s+(TABLE|DATABASE)\b", re.IGNORECASE)


def schema_statements(path: str = SCHEMA_PATH) -> list:
    """Statements from schema.sql with `--` comment lines removed."""
    with open(path, encoding="utf-8") as fh:
        lines = [line for line in fh if not _COMMENT_RE.match(line)]
    return [s.strip() for s in "\n".join(lines).split(";") if s.strip()]


def existing_tables() -> set:
    """Table names currently present in the connected MYSQL_DATABASE."""
    rows = db.query(
        "SELECT TABLE_NAME AS name FROM information_schema.tables "
        "WHERE TABLE_SCHEMA = DATABASE()"
    )
    return {r["name"] for r in rows}


def plan(statements: list, existing: set) -> dict:
    """Decide what may run. Pure function so tests can exercise every branch.

    Returns {"to_create": [(name, stmt)...], "present": [name...],
             "skipped": [line...], "refused": [line...]}.
    """
    to_create, present, skipped, refused = [], [], [], []
    for stmt in statements:
        head = stmt.lstrip()
        first = head.splitlines()[0][:100]
        if _DROP_RE.search(stmt):
            refused.append(first)  # never executed
            continue
        if _CREATE_DB_RE.match(head) or _USE_RE.match(head):
            skipped.append(first)  # database stays MYSQL_DATABASE
            continue
        m = _CREATE_TABLE_RE.match(head)
        if m:
            name = m.group(1)
            if name in existing:
                present.append(name)
            else:
                to_create.append((name, stmt))
            continue
        refused.append(first)  # unrecognized: run nothing, review manually
    return {
        "to_create": to_create,
        "present": present,
        "skipped": skipped,
        "refused": refused,
    }


def init_schema(log=print) -> dict:
    """Create missing tables in the configured database. Idempotent.

    Returns a summary dict (table names only) and raises on SQL errors so
    callers can log a clear failure.
    """
    statements = schema_statements()
    existing = existing_tables()
    p = plan(statements, existing)

    created = []
    conn = db.connection()
    try:
        with conn.cursor() as cur:
            for name, stmt in p["to_create"]:
                cur.execute(stmt)
                created.append(name)
    finally:
        conn.close()

    expected = sum(1 for s in statements if _CREATE_TABLE_RE.match(s.lstrip()))
    ready = set(p["present"]) | set(created)
    missing = max(0, expected - len(ready))
    summary = {
        "database": config.MYSQL_DATABASE,
        "created": created,
        "already_present": sorted(p["present"]),
        "skipped": p["skipped"],
        "refused": p["refused"],
        "tables_ready": len(ready),
        "tables_expected": expected,
    }

    log(
        f"[dbinit] schema check on '{config.MYSQL_DATABASE}': "
        f"created={created or '[]'} already_present={len(p['present'])} "
        f"missing={missing}"
    )
    for line in p["skipped"]:
        log(f"[dbinit] skipped (never executed): {line}")
    for line in p["refused"]:
        log(f"[dbinit] REFUSED (not auto-executed, review manually): {line}")
    if missing:
        log(
            f"[dbinit] WARNING: {missing} table(s) from schema.sql "
            "are still missing — see REFUSED lines above."
        )
    return summary
