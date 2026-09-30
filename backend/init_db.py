"""Explicit, safe database initialization command (manual use only).

Nothing in this file runs automatically and it is never exposed as an
HTTP endpoint. From the backend directory:

    python init_db.py --check    # dry run: report what WOULD be created
    python init_db.py            # create only the missing tables, then exit

Reads MYSQL_* / MYSQL_SSL_* from backend/.env (loaded by config) or from
the process environment. Safe to run repeatedly against the real database:

  * only `CREATE TABLE IF NOT EXISTS` statements for tables that
    information_schema shows are missing are executed;
  * CREATE DATABASE / USE / DROP / ALTER / DELETE are never executed
    (see dbinit.plan);
  * existing tables and rows are never modified or deleted;
  * output contains database/table names only — never passwords, JWT
    secrets, API keys, or connection strings.

Exit codes: 0 = success, 1 = some schema tables still missing (see
REFUSED lines), 2 = database unreachable / execution error.
"""

import sys

import config
import dbinit


def _emit(line: str, err: bool = False) -> None:
    print(line, file=sys.stderr if err else sys.stdout)


def main(argv: list | None = None) -> int:
    argv = list(sys.argv if argv is None else argv)
    if any(a in ("--help", "-h") for a in argv[1:]):
        print(__doc__)
        return 0
    check_only = any(a in ("--check", "-n") for a in argv[1:])

    ssl_state = "verified TLS" if config.MYSQL_SSL else "TLS off"
    _emit(
        f"[init] database '{config.MYSQL_DATABASE}' at "
        f"{config.MYSQL_HOST}:{config.MYSQL_PORT} ({ssl_state})"
    )
    try:
        statements = dbinit.schema_statements()
        existing = dbinit.existing_tables()
        plan = dbinit.plan(statements, existing)
    except Exception as exc:  # noqa: BLE001 - surfaced without secrets
        _emit(f"[init] ERROR: {type(exc).__name__}: {exc}", err=True)
        _emit(
            "[init] could not reach the database — check MYSQL_HOST, "
            "MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE and the "
            "MYSQL_SSL_* settings (never paste those values into chat).",
            err=True,
        )
        return 2

    to_create = [name for name, _ in plan["to_create"]]
    verb = "would be created" if check_only else "to create"
    _emit(f"[init] present ({len(plan['present'])}): {sorted(plan['present'])}")
    _emit(f"[init] {verb} ({len(to_create)}): {to_create}")
    for line in plan["skipped"]:
        _emit(f"[init] skipped (never executed): {line}")
    for line in plan["refused"]:
        _emit(f"[init] REFUSED (not auto-executed, review manually): {line}")

    if check_only:
        _emit("[init] --check: dry run only, no changes were made.")
        return 0

    try:
        summary = dbinit.init_schema()
    except Exception as exc:  # noqa: BLE001
        _emit(f"[init] ERROR: {type(exc).__name__}: {exc}", err=True)
        return 2

    if summary["tables_ready"] < summary["tables_expected"]:
        _emit(
            f"[init] only {summary['tables_ready']}/"
            f"{summary['tables_expected']} schema tables are ready — see "
            "REFUSED lines above and review schema.sql manually.",
            err=True,
        )
        return 1
    _emit(
        f"[init] OK: {summary['tables_ready']}/{summary['tables_expected']} "
        "schema tables ready."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
