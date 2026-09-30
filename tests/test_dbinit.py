"""Database initialization tests: idempotent, create-missing-only, safe.

Covers:
  D1  schema.sql parses cleanly; every statement is CREATE DATABASE / USE /
      CREATE TABLE IF NOT EXISTS — no DROP/ALTER/INSERT can ever run
  D2  plan() skips CREATE DATABASE + USE (database stays MYSQL_DATABASE)
  D3  plan() creates only missing tables; never touches existing ones
  D4  plan() refuses DROP and any unrecognized statement
  D5  init_schema() is idempotent on a real database (e2e) — second run
      creates nothing, no table disappears, all schema tables present
  D6  TLS context: verification always on (CERT_REQUIRED + hostname);
      missing CA file fails with the path but leaks no secrets
  D7  db.connection(): MYSQL_SSL=true attaches a verified SSLContext,
      MYSQL_SSL=false leaves SSL to server negotiation
  D8  init failures raise messages that never contain passwords/JWT/API keys
  D9  app boots via main.py and exposes NO public initialization endpoint
  D10 explicit init command (init_db.py): --check is a pure dry run and
      execute mode changes nothing on an already-initialized database;
      output leaks no secrets

Runs against the configured database (use MYSQL_DATABASE=coinscan_e2e_test):
    $env:MYSQL_DATABASE='coinscan_e2e_test'; python tests/test_dbinit.py
"""

import os
import ssl
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "backend"))

import config  # noqa: E402
import db  # noqa: E402
import dbinit  # noqa: E402

RESULTS = []


def check(name, fn):
    started = time.time()
    try:
        fn()
        RESULTS.append((name, True, ""))
        print(f"  PASS  {name} ({time.time() - started:.2f}s)")
    except Exception as exc:  # noqa: BLE001
        RESULTS.append((name, False, f"{type(exc).__name__}: {exc}"))
        print(f"  FAIL  {name}: {type(exc).__name__}: {exc}")


def expect(cond, msg):
    if not cond:
        raise AssertionError(msg)


# ---------------------------------------------------------------- D1
def d1_schema_statements_are_creatable_only():
    stmts = dbinit.schema_statements()
    expect(len(stmts) >= 8, f"expected >=8 statements, got {len(stmts)}")
    tables = []
    kinds = set()
    for s in stmts:
        head = s.lstrip().upper()
        expect("DROP" not in head, f"DROP found in schema statement: {s[:60]}")
        if head.startswith("CREATE TABLE IF NOT EXISTS"):
            kinds.add("table")
            m = dbinit._CREATE_TABLE_RE.match(s.lstrip())
            expect(m, f"table name not parseable: {s[:60]}")
            tables.append(m.group(1))
        elif head.startswith("CREATE DATABASE"):
            kinds.add("create-db")
        elif head.startswith("USE "):
            kinds.add("use")
        else:
            raise AssertionError(f"unexpected statement kind: {s[:60]}")
    expect(kinds <= {"table", "create-db", "use"}, f"kinds={kinds}")
    expect(len(tables) == 7, f"expected 7 tables, got {tables}")
    for t in ("users", "contact_messages", "user_images", "chats",
              "chat_messages", "scan_history", "collection_items"):
        expect(t in tables, f"missing table in schema.sql: {t}")


# ---------------------------------------------------------------- D2
def d2_plan_skips_create_db_and_use():
    p = dbinit.plan(dbinit.schema_statements(), existing=set())
    expect(len(p["to_create"]) == 7, f"to_create={len(p['to_create'])}")
    expect(len(p["skipped"]) == 2, f"skipped={p['skipped']}")
    expect(any(s.upper().startswith("CREATE DATABASE") for s in p["skipped"]),
           f"CREATE DATABASE not skipped: {p['skipped']}")
    expect(any(s.upper().startswith("USE ") for s in p["skipped"]),
           f"USE not skipped: {p['skipped']}")
    expect(p["refused"] == [], f"refused={p['refused']}")


# ---------------------------------------------------------------- D3
def d3_plan_creates_only_missing():
    all7 = {"users", "contact_messages", "user_images", "chats",
            "chat_messages", "scan_history", "collection_items"}
    p = dbinit.plan(dbinit.schema_statements(), existing=all7)
    expect(p["to_create"] == [], f"to_create should be empty, got {p['to_create']}")
    expect(sorted(p["present"]) == sorted(all7), f"present={p['present']}")

    p = dbinit.plan(dbinit.schema_statements(), existing={"users", "chats"})
    names = [n for n, _ in p["to_create"]]
    expect(len(names) == 5, f"expected 5 missing, got {names}")
    expect("users" not in names and "chats" not in names, f"existing wrongly queued: {names}")

    p = dbinit.plan(dbinit.schema_statements(), existing=set())
    expect(len(p["to_create"]) == 7, "empty DB must plan all 7 tables")


# ---------------------------------------------------------------- D4
def d4_plan_refuses_destructive_and_unknown():
    p = dbinit.plan(["DROP TABLE users", "DROP DATABASE coinscan"], existing=set())
    expect(p["to_create"] == [], "DROP must never be planned")
    expect(len(p["refused"]) == 2, f"refused={p['refused']}")

    p = dbinit.plan(["ALTER TABLE users ADD COLUMN x INT"], existing=set())
    expect(p["to_create"] == [], "ALTER must never be auto-planned")
    expect(len(p["refused"]) == 1, f"refused={p['refused']}")

    p = dbinit.plan(["DELETE FROM users"], existing=set())
    expect(p["to_create"] == [] and len(p["refused"]) == 1, "DELETE must be refused")


# ---------------------------------------------------------------- D5
def d5_init_idempotent_on_real_db():
    before = dbinit.existing_tables()
    summary1 = dbinit.init_schema(log=lambda *_: None)
    mid = dbinit.existing_tables()
    summary2 = dbinit.init_schema(log=lambda *_: None)
    after = dbinit.existing_tables()

    expect(summary1["database"] == config.MYSQL_DATABASE,
           f"summary targets {summary1['database']} != {config.MYSQL_DATABASE}")
    expect(len(summary2["created"]) == 0,
           f"second run must create nothing, got {summary2['created']}")
    expect(after == mid, f"tables changed: {sorted(before)} -> {sorted(after)}")
    expect(before == mid or len(mid) >= len(before),
           f"tables must not disappear: {sorted(before)} -> {sorted(mid)}")
    expect(summary2["tables_ready"] == summary2["tables_expected"] == 7,
           f"ready={summary2['tables_ready']}/{summary2['tables_expected']}")
    for t in ("users", "contact_messages", "user_images", "chats",
              "chat_messages", "scan_history", "collection_items"):
        expect(t in after, f"table missing after init: {t}")
    expect(summary1["refused"] == [] and summary2["refused"] == [],
           f"refused statements in real schema: {summary1['refused']}")


# ---------------------------------------------------------------- D6
def d6_ssl_context_verification_always_on():
    old_ca, old_cert, old_key = config.MYSQL_SSL_CA, config.MYSQL_SSL_CERT, config.MYSQL_SSL_KEY
    try:
        config.MYSQL_SSL_CA = ""
        config.MYSQL_SSL_CERT = ""
        config.MYSQL_SSL_KEY = ""
        ctx = db.ssl_context()
        expect(isinstance(ctx, ssl.SSLContext), "not an SSLContext")
        expect(ctx.verify_mode == ssl.CERT_REQUIRED, f"verify_mode={ctx.verify_mode}")
        expect(ctx.check_hostname is True, "check_hostname must be True")

        config.MYSQL_SSL_CA = os.path.join(REPO, "does-not-exist-ca.pem")
        try:
            db.ssl_context()
            raise AssertionError("missing CA file must raise")
        except FileNotFoundError as exc:
            msg = str(exc)
            expect("does-not-exist-ca.pem" in msg, f"path not in message: {msg}")
            expect(config.MYSQL_PASSWORD not in msg or not config.MYSQL_PASSWORD,
                   "password leaked in CA error")
    finally:
        config.MYSQL_SSL_CA, config.MYSQL_SSL_CERT, config.MYSQL_SSL_KEY = old_ca, old_cert, old_key


# ---------------------------------------------------------------- D7
def d7_connection_ssl_wiring():
    old_ssl, old_connect = config.MYSQL_SSL, db.pymysql.connect
    captured = {}

    def fake_connect(**kwargs):
        captured.clear()
        captured.update(kwargs)
        raise RuntimeError("captured")

    try:
        config.MYSQL_SSL = False
        db.pymysql.connect = fake_connect
        try:
            db.connection()
        except RuntimeError:
            pass
        expect("ssl" not in captured, "SSL must not be forced when MYSQL_SSL=false")

        config.MYSQL_SSL = True
        try:
            db.connection()
        except RuntimeError:
            pass
        expect(isinstance(captured.get("ssl"), ssl.SSLContext),
               f"ssl kwarg missing/wrong: {type(captured.get('ssl'))}")
        expect(captured["ssl"].verify_mode == ssl.CERT_REQUIRED, "verified mode required")
        expect(captured["ssl"].check_hostname is True, "hostname check required")
        expect(captured["database"] == config.MYSQL_DATABASE, "wrong database wired")
    finally:
        config.MYSQL_SSL = old_ssl
        db.pymysql.connect = old_connect


# ---------------------------------------------------------------- D8
def d8_failure_message_has_no_secrets():
    old_port = config.MYSQL_PORT
    try:
        config.MYSQL_PORT = 1  # nothing listens here -> fast connect failure
        try:
            dbinit.init_schema(log=lambda *_: None)
            raise AssertionError("expected a connection failure")
        except Exception as exc:  # noqa: BLE001
            msg = f"{type(exc).__name__}: {exc}"
            if config.MYSQL_PASSWORD:
                expect(config.MYSQL_PASSWORD not in msg, "password leaked")
            expect(config.JWT_SECRET not in msg, "JWT secret leaked")
            if config.GEMINI_API_KEY:
                expect(config.GEMINI_API_KEY not in msg, "Gemini key leaked")
    finally:
        config.MYSQL_PORT = old_port


# ---------------------------------------------------------------- D9
def d9_no_public_init_endpoint_app_boots():
    from main import app  # boots init (idempotent) — must not raise

    expect(app is not None, "app missing")
    paths = [getattr(r, "path", "") for r in app.routes]
    bad = [p for p in paths
           if ("init" in p.lower() or "schema" in p.lower()
               or "migrate" in p.lower() or "setup" in p.lower())]
    expect(bad == [], f"public init endpoint exposed: {bad}")


# ---------------------------------------------------------------- D10
def d10_explicit_init_command_safe():
    import contextlib
    import io

    import init_db

    before = dbinit.existing_tables()

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc_check = init_db.main(["init_db.py", "--check"])
    out_check = buf.getvalue()
    expect(rc_check == 0, f"--check exit code {rc_check}")
    expect(dbinit.existing_tables() == before,
           "--check must not create or remove tables")
    if config.MYSQL_PASSWORD:
        expect(config.MYSQL_PASSWORD not in out_check, "password leaked in --check output")
    expect(config.JWT_SECRET not in out_check, "JWT secret leaked in --check output")
    if config.GEMINI_API_KEY:
        expect(config.GEMINI_API_KEY not in out_check, "Gemini key leaked in --check output")

    buf2 = io.StringIO()
    with contextlib.redirect_stdout(buf2):
        rc_run = init_db.main(["init_db.py"])
    out_run = buf2.getvalue()
    expect(rc_run == 0, f"execute exit code {rc_run}")
    expect(dbinit.existing_tables() == before,
           "execute mode on a ready database must not change tables")
    if config.MYSQL_PASSWORD:
        expect(config.MYSQL_PASSWORD not in out_run, "password leaked in execute output")


def main():
    print(f"database under test: {config.MYSQL_DATABASE}")
    expect(config.MYSQL_DATABASE == "coinscan_e2e_test",
           "refusing to run: set MYSQL_DATABASE=coinscan_e2e_test first")

    for name, fn in [
        ("D1 schema statements are CREATE-only (no DROP/ALTER/INSERT)", d1_schema_statements_are_creatable_only),
        ("D2 plan skips CREATE DATABASE + USE", d2_plan_skips_create_db_and_use),
        ("D3 plan creates only missing tables", d3_plan_creates_only_missing),
        ("D4 plan refuses destructive/unknown statements", d4_plan_refuses_destructive_and_unknown),
        ("D5 init_schema idempotent on real e2e DB", d5_init_idempotent_on_real_db),
        ("D6 TLS context always verified (CERT_REQUIRED + hostname)", d6_ssl_context_verification_always_on),
        ("D7 MYSQL_SSL wires a verified SSLContext", d7_connection_ssl_wiring),
        ("D8 init failure messages leak no secrets", d8_failure_message_has_no_secrets),
        ("D9 app boots; no public initialization endpoint", d9_no_public_init_endpoint_app_boots),
        ("D10 explicit init_db.py command is safe (dry-run + no-op)", d10_explicit_init_command_safe),
    ]:
        check(name, fn)

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    total = len(RESULTS)
    print(f"\nRESULT: {passed}/{total} passed")
    for name, ok, err in RESULTS:
        if not ok:
            print(f"  FAILED: {name} :: {err}")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
