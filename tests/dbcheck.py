"""Direct MySQL verification CLI used by Playwright specs (and Python tests).

Imports the backend's own config (backend/.env is loaded by backend/config.py),
so it always talks to the same database the API uses.

Examples:
    python tests/dbcheck.py ping
    python tests/dbcheck.py contacts --limit 5 --json
    python tests/dbcheck.py count-contacts
    python tests/dbcheck.py scans --email user@coinscan-e2e.com --json
    python tests/dbcheck.py collection --email user@coinscan-e2e.com --json
    python tests/dbcheck.py user --email user@coinscan-e2e.com
    python tests/dbcheck.py delete-user --email user@coinscan-e2e.com
    python tests/dbcheck.py clear-contacts

Exit code 0 = success (and a JSON document on stdout); 1 = failure.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import db  # noqa: E402  (backend/db.py, loads backend/.env via config)


def _out(doc) -> None:
    print(json.dumps(doc, ensure_ascii=False, default=str))


def cmd_ping(_args):
    row = db.fetch_one("SELECT 1 AS ok")
    _out({"ok": bool(row and row.get("ok") == 1)})


def cmd_count_contacts(_args):
    row = db.fetch_one("SELECT COUNT(*) AS n FROM contact_messages")
    _out({"count": int(row["n"] if row else 0)})


def cmd_contacts(args):
    rows = db.query(
        "SELECT id, name, email, rating, message, created_at "
        "FROM contact_messages ORDER BY id DESC LIMIT %s",
        (int(args.limit),),
    )
    if args.match:
        needle = args.match.lower()
        rows = [
            r for r in rows
            if needle in (r.get("message") or "").lower()
            or needle in (r.get("email") or "").lower()
            or needle in (r.get("name") or "").lower()
        ]
    _out({"contacts": rows})


def cmd_clear_contacts(_args):
    db.execute("DELETE FROM contact_messages")
    _out({"ok": True})


def cmd_user(args):
    row = db.fetch_one(
        "SELECT id, username, email, created_at FROM users WHERE email = %s",
        (args.email,),
    )
    _out({"found": bool(row), "user": row})


def cmd_users(_args):
    rows = db.query("SELECT id, username, email, created_at FROM users ORDER BY id DESC LIMIT 50")
    _out({"users": rows})


def cmd_delete_user(args):
    row = db.fetch_one("SELECT id FROM users WHERE email = %s", (args.email,))
    if row:
        db.execute("DELETE FROM users WHERE id = %s", (row["id"],))
    _out({"ok": True, "deleted": bool(row)})


def cmd_scans(args):
    user = db.fetch_one("SELECT id FROM users WHERE email = %s", (args.email,))
    if not user:
        _out({"scans": [], "user_found": False})
        return
    rows = db.query(
        "SELECT id, name, detected_country, authenticity_status, created_at "
        "FROM scan_history WHERE user_id = %s ORDER BY id DESC LIMIT %s",
        (user["id"], int(args.limit)),
    )
    _out({"scans": rows, "user_found": True})


def cmd_clear_scans(args):
    user = db.fetch_one("SELECT id FROM users WHERE email = %s", (args.email,))
    if user:
        db.execute("DELETE FROM scan_history WHERE user_id = %s", (user["id"],))
    _out({"ok": True, "user_found": bool(user)})


def cmd_collection(args):
    user = db.fetch_one("SELECT id FROM users WHERE email = %s", (args.email,))
    if not user:
        _out({"items": [], "user_found": False})
        return
    rows = db.query(
        "SELECT coin_id, item_json, created_at FROM collection_items "
        "WHERE user_id = %s ORDER BY id DESC LIMIT %s",
        (user["id"], int(args.limit)),
    )
    items = []
    for r in rows:
        try:
            parsed = json.loads(r.get("item_json") or "{}")
        except json.JSONDecodeError:
            parsed = {}
        items.append({
            "coin_id": r.get("coin_id"),
            "name": parsed.get("name"),
            "price": parsed.get("price"),
            "created_at": r.get("created_at"),
        })
    _out({"items": items, "count": len(items), "user_found": True})


def cmd_clear_collection(args):
    user = db.fetch_one("SELECT id FROM users WHERE email = %s", (args.email,))
    if user:
        db.execute("DELETE FROM collection_items WHERE user_id = %s", (user["id"],))
    _out({"ok": True, "user_found": bool(user)})


def cmd_clear_user(args):
    """Delete a user row; MySQL ON DELETE CASCADE removes scans/collection/chats."""
    user = db.fetch_one("SELECT id FROM users WHERE email = %s", (args.email,))
    if user:
        db.execute("DELETE FROM users WHERE id = %s", (user["id"],))
    _out({"ok": True, "deleted": bool(user)})


def main():
    parser = argparse.ArgumentParser(description="CoinScan test DB checker")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("ping")
    sub.add_parser("count-contacts")

    p = sub.add_parser("contacts")
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--match", default="")
    sub.add_parser("clear-contacts")

    p = sub.add_parser("user")
    p.add_argument("--email", required=True)
    sub.add_parser("users")
    p = sub.add_parser("delete-user")
    p.add_argument("--email", required=True)

    p = sub.add_parser("scans")
    p.add_argument("--email", required=True)
    p.add_argument("--limit", type=int, default=20)
    p = sub.add_parser("clear-scans")
    p.add_argument("--email", required=True)

    p = sub.add_parser("collection")
    p.add_argument("--email", required=True)
    p.add_argument("--limit", type=int, default=50)
    p = sub.add_parser("clear-collection")
    p.add_argument("--email", required=True)

    p = sub.add_parser("clear-user")
    p.add_argument("--email", required=True)

    args = parser.parse_args()
    handlers = {
        "ping": cmd_ping,
        "count-contacts": cmd_count_contacts,
        "contacts": cmd_contacts,
        "clear-contacts": cmd_clear_contacts,
        "user": cmd_user,
        "users": cmd_users,
        "delete-user": cmd_delete_user,
        "scans": cmd_scans,
        "clear-scans": cmd_clear_scans,
        "collection": cmd_collection,
        "clear-collection": cmd_clear_collection,
        "clear-user": cmd_clear_user,
    }
    try:
        handlers[args.cmd](args)
    except Exception as exc:  # surface a machine-readable failure for specs
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
