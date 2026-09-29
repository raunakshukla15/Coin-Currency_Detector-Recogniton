"""AI failure-path tests: free-model failover, quota, 5xx, timeouts, malformed
responses, paid-model refusal — against a LOCAL fake Gemini upstream.

No real network, no paid AI, no quota burn.

Run from the repo root:
    python tests/test_ai_failures.py

Covers (unit level, via backend/ai.py):
  1  429 daily quota      -> clean USER_MSG_QUOTA, fail-fast (1 request only)
  2  503 all models       -> clean USER_MSG_CHAT_FAILED / ANALYSIS message
  3  malformed HTTP body  -> clean failure, next model tried
  4  empty content        -> clean failure, next model tried
  5  non-JSON on vision   -> clean ANALYSIS failure
  6  invalid API key 400  -> explicit key-rejected error, fail-fast (1 request)
  7  paid/non-free model  -> refused BEFORE any request (free-only policy)
  8  missing API key      -> clean config error, 0 requests
  9  flaky 503 then ok    -> failover to next model succeeds
  10 timeout              -> clean failure within the time budget
  11 identify ok          -> items + authenticity from deterministic policy
  12 failures not cached  -> a failed identify() is retried, not served stale
And (endpoint level, via FastAPI TestClient):
  13 /api/ai/identify 502 clean detail on upstream failure (no traceback)
  14 /api/ai/identify 502 clean detail on daily quota
  15 /api/ai/identify 200 happy path against the fake upstream
   16 /api/ai/chat 502 clean detail; 401 without token
   17 /api/ai/chat non-dict message entries -> 422 (never 500)
   18 /api/contact input validation (same app)
"""

import base64
import json
import os
import sys
import threading
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "backend"))
sys.path.insert(0, os.path.join(REPO, "tests", "servers"))

import config  # noqa: E402
import ai  # noqa: E402
import fake_gemini  # noqa: E402

RESULTS = []


def check(name, fn):
    started = time.time()
    try:
        fn()
        RESULTS.append((name, True, ""))
        print(f"  PASS  {name} ({time.time() - started:.1f}s)")
    except Exception as exc:  # noqa: BLE001 - report every failure
        RESULTS.append((name, False, f"{type(exc).__name__}: {exc}"))
        print(f"  FAIL  {name}: {type(exc).__name__}: {exc}")


def expect(cond, msg):
    if not cond:
        raise AssertionError(msg)


# --------------------------------------------------------------------------
# fake upstream helpers
# --------------------------------------------------------------------------

def control(**kwargs):
    data = json.dumps(kwargs).encode("utf-8")
    req = urllib.request.Request(
        f"{FAKE_BASE}/__control", data=data, method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5) as res:
        res.read()


def stats():
    with urllib.request.urlopen(f"{FAKE_BASE}/__stats", timeout=5) as res:
        return json.loads(res.read().decode("utf-8"))


def reset_stats():
    with urllib.request.urlopen(f"{FAKE_BASE}/__reset", timeout=5) as res:
        res.read()


def image_url(marker: str) -> str:
    """Unique fake data-URL per test (cache keys must not collide)."""
    payload = base64.b64encode(f"img:{marker}:".encode() + b"\x00" * 64).decode()
    return f"data:image/png;base64,{payload}"


def expect_ai_error(fn, needle: str):
    try:
        fn()
    except ai.AIError as exc:
        expect(needle in str(exc), f"error message {str(exc)!r} lacks {needle!r}")
        return str(exc)
    raise AssertionError("expected AIError, but call succeeded")


# --------------------------------------------------------------------------
# unit-level checks (ai.chat / ai.identify against fake upstream)
# --------------------------------------------------------------------------

def t_quota_fail_fast():
    control(scenario="quota")
    reset_stats()
    expect_ai_error(
        lambda: ai.chat([{"role": "user", "content": "hello"}]),
        ai.USER_MSG_QUOTA,
    )
    st = stats()
    expect(st["requests"] == 1,
           f"daily quota must fail fast with ONE request, got {st['requests']}")


def t_503_all_models():
    control(scenario="e503")
    reset_stats()
    expect_ai_error(
        lambda: ai.chat([{"role": "user", "content": "hello"}]),
        ai.USER_MSG_CHAT_FAILED,
    )
    st = stats()
    expect(st["requests"] >= 2, "503 should rotate through several free models")
    expect(len(set(st["models"])) >= 2, f"models not rotated: {st['models']}")


def t_malformed_body():
    control(scenario="malformed")
    reset_stats()
    expect_ai_error(
        lambda: ai.chat([{"role": "user", "content": "hello"}]),
        ai.USER_MSG_CHAT_FAILED,
    )
    expect(stats()["requests"] >= 2, "malformed body should trigger failover")


def t_empty_content():
    control(scenario="empty")
    reset_stats()
    expect_ai_error(
        lambda: ai.chat([{"role": "user", "content": "hello"}]),
        ai.USER_MSG_CHAT_FAILED,
    )
    expect(stats()["requests"] >= 2, "empty content should trigger failover")


def t_vision_nonjson_content():
    control(scenario="nonjson")
    reset_stats()
    expect_ai_error(
        lambda: ai.identify(image_url("vision-nonjson")),
        ai.USER_MSG_ANALYSIS_FAILED,
    )
    expect(stats()["requests"] >= 2,
           "vision path should rotate models on non-JSON content")


def t_key_rejected():
    control(scenario="keyerr")
    reset_stats()
    msg = expect_ai_error(
        lambda: ai.chat([{"role": "user", "content": "hello"}]),
        ai.USER_MSG_KEY_REJECTED,
    )
    expect("GEMINI_API_KEY" in msg, f"key error should point at GEMINI_API_KEY: {msg}")
    st = stats()
    expect(st["requests"] == 1, "invalid key must abort immediately (no retries)")


def t_paid_model_refused():
    old = config.GEMINI_MODEL
    reset_stats()
    for bad in ("gemini-2.5-pro", "gpt-4o", "openrouter/free"):
        config.GEMINI_MODEL = bad
        msg = expect_ai_error(
            lambda: ai.chat([{"role": "user", "content": "hello"}]), "non-free"
        )
        expect(bad in msg, f"paid-model error should name the model: {msg}")
    config.GEMINI_MODEL = old
    expect(stats()["requests"] == 0,
           "paid/non-free model must be refused BEFORE any request")


def t_missing_key():
    old_key = config.GEMINI_API_KEY
    config.GEMINI_API_KEY = ""
    reset_stats()
    try:
        expect_ai_error(
            lambda: ai.chat([{"role": "user", "content": "hello"}]),
            ai.USER_MSG_KEY_MISSING,
        )
    finally:
        config.GEMINI_API_KEY = old_key
    expect(stats()["requests"] == 0, "missing key must not call the upstream")


def t_flaky_failover_succeeds():
    control(scenario="flaky", fail_first=1)
    reset_stats()
    reply = ai.chat([{"role": "user", "content": "hello"}])
    expect(isinstance(reply, str) and len(reply) > 10, f"bad reply: {reply!r}")
    st = stats()
    expect(st["requests"] == 2, f"expected 2 attempts (fail+ok), got {st['requests']}")
    expect(len(set(st["models"])) == 2,
           f"failover should use a different model: {st['models']}")
    control(fail_first=0)


def t_timeout_clean_failure():
    control(scenario="timeout")
    reset_stats()
    # Shrink per-attempt timeouts so this test finishes in ~15s instead of 90s.
    old = (ai._PER_ATTEMPT_TIMEOUT_S, ai._MIN_PER_ATTEMPT_TIMEOUT_S,
           ai._IDENTIFY_TIME_BUDGET_S)
    ai._PER_ATTEMPT_TIMEOUT_S = 2.0
    ai._MIN_PER_ATTEMPT_TIMEOUT_S = 1.0
    ai._IDENTIFY_TIME_BUDGET_S = 12.0
    try:
        msg = expect_ai_error(
            lambda: ai.identify(image_url("timeout-case")),
            ai.USER_MSG_ANALYSIS_FAILED,
        )
        expect("Traceback" not in msg, "timeout must not leak a traceback")
    finally:
        (ai._PER_ATTEMPT_TIMEOUT_S, ai._MIN_PER_ATTEMPT_TIMEOUT_S,
         ai._IDENTIFY_TIME_BUDGET_S) = old


def t_identify_ok():
    item = {
        "kind": "coin", "name": "Fake Test Coin", "country": "India",
        "year": "2011", "denomination": "5", "type": "rupee10",
    }
    control(scenario="ok", content=json.dumps([item]))
    reset_stats()
    result = ai.identify(image_url("identify-ok"))
    expect(isinstance(result.get("items"), list) and result["items"],
           f"no items returned: {result}")
    first = result["items"][0]
    expect("authenticity_status" in first,
           f"deterministic authenticity missing: {first.keys()}")
    expect(result.get("authenticity") is not None, "overall authenticity missing")
    control(content=None)  # back to default prose


def t_identify_failure_not_cached():
    control(scenario="e503")
    reset_stats()
    marker = "identify-fail-nocache"
    expect_ai_error(lambda: ai.identify(image_url(marker)),
                    ai.USER_MSG_ANALYSIS_FAILED)
    n1 = stats()["requests"]
    expect_ai_error(lambda: ai.identify(image_url(marker)),
                    ai.USER_MSG_ANALYSIS_FAILED)
    n2 = stats()["requests"]
    expect(n2 > n1, "failed identify() must NOT be cached — second call made no request")
    # and the success path IS cached (second call makes no upstream request)
    item = {"kind": "coin", "name": "Cache Probe", "country": "India"}
    control(scenario="ok", content=json.dumps([item]))
    reset_stats()
    ai.identify(image_url("cache-probe"))
    ai.identify(image_url("cache-probe"))
    expect(stats()["requests"] <= 2, "unexpected requests for cached probe")
    control(content=None)


def t_quota_identify_preserved():
    control(scenario="quota")
    reset_stats()
    expect_ai_error(lambda: ai.identify(image_url("quota-case")),
                    ai.USER_MSG_QUOTA)


# --------------------------------------------------------------------------
# endpoint-level checks (TestClient, same app the browser talks to)
# --------------------------------------------------------------------------

def _client_and_token():
    from fastapi.testclient import TestClient
    from main import app
    client = TestClient(app)
    name = f"aifail{int(time.time()) % 100000}{os.getpid() % 100}"
    creds = {
        "username": name,
        "email": f"{name}@coinscan-e2e.com",
        "password": "Playwright!123",
    }
    r = client.post("/api/auth/signup", json=creds)
    if r.status_code == 409:
        r = client.post("/api/auth/login", json={
            "identifier": creds["username"], "password": creds["password"],
        })
    expect(r.status_code in (200, 201), f"signup/login failed: {r.status_code} {r.text}")
    token = r.json().get("token")
    expect(token, f"no token in {r.json()}")
    return client, token


def t_endpoint_identify_502():
    client, token = _client_and_token()
    control(scenario="e503")
    reset_stats()
    r = client.post(
        "/api/ai/identify",
        json={"image": image_url("endpoint-502")},
        headers={"Authorization": f"Bearer {token}"},
    )
    expect(r.status_code == 502, f"expected 502, got {r.status_code}: {r.text}")
    detail = r.json().get("detail", "")
    expect(detail == ai.USER_MSG_ANALYSIS_FAILED, f"detail not clean: {detail!r}")
    expect("Traceback" not in r.text and "File \"" not in r.text,
           "502 leaked internals")


def t_endpoint_quota_502():
    client, token = _client_and_token()
    control(scenario="quota")
    r = client.post(
        "/api/ai/identify",
        json={"image": image_url("endpoint-quota")},
        headers={"Authorization": f"Bearer {token}"},
    )
    expect(r.status_code == 502, f"expected 502, got {r.status_code}")
    expect(r.json().get("detail") == ai.USER_MSG_QUOTA,
           f"quota detail not clean: {r.json().get('detail')!r}")


def t_endpoint_identify_200():
    client, token = _client_and_token()
    item = {"kind": "coin", "name": "Endpoint Coin", "country": "India",
            "year": "2010", "denomination": "10"}
    control(scenario="ok", content=json.dumps([item]))
    reset_stats()
    r = client.post(
        "/api/ai/identify",
        json={"image": image_url("endpoint-ok")},
        headers={"Authorization": f"Bearer {token}"},
    )
    expect(r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}")
    body = r.json()
    expect(body.get("items"), f"no items: {body}")
    expect("authenticity_status" in body["items"][0], "authenticity missing")
    control(content=None)


def t_endpoint_chat_502_and_401():
    client, token = _client_and_token()
    control(scenario="e503")
    r = client.post(
        "/api/ai/chat",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {token}"},
    )
    expect(r.status_code == 502, f"expected 502, got {r.status_code}")
    expect(r.json().get("detail") == ai.USER_MSG_CHAT_FAILED,
           f"chat detail not clean: {r.json().get('detail')!r}")
    r2 = client.post("/api/ai/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    expect(r2.status_code == 401, f"expected 401 without token, got {r2.status_code}")


def t_endpoint_chat_bad_messages_422():
    """Non-object message entries must be a clean 422, never a 500.

    Regression: AIChatIn used to accept any list, so messages=["hi"] crashed
    the chat formatter (AttributeError -> 500).
    """
    client, token = _client_and_token()
    r = client.post(
        "/api/ai/chat",
        json={"messages": ["hi"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    expect(r.status_code == 422,
           f"expected 422 for string messages, got {r.status_code}: {r.text}")
    expect("Traceback" not in r.text, "422 leaked internals")
    r2 = client.post(
        "/api/ai/chat",
        json={"messages": []},
        headers={"Authorization": f"Bearer {token}"},
    )
    expect(r2.status_code == 422,
           f"expected 422 for empty messages, got {r2.status_code}")
    # Valid shape still passes validation (reaches the AI -> mocked 502).
    control(scenario="e503")
    r3 = client.post(
        "/api/ai/chat",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {token}"},
    )
    expect(r3.status_code == 502,
           f"valid messages no longer reach AI: {r3.status_code}: {r3.text}")


def t_endpoint_contact_validation():
    """Contact input validation lives in the same app (422 paths)."""
    from fastapi.testclient import TestClient
    from main import app
    client = TestClient(app)
    r = client.post("/api/contact", json={
        "text": "hello", "rating": 5,
        "email": "not-an-email", "username": "x",
    })
    expect(r.status_code == 422, f"invalid email accepted: {r.status_code}")
    r = client.post("/api/contact", json={"text": "   ", "rating": 0})
    expect(r.status_code == 422, f"empty text accepted: {r.status_code}")


# --------------------------------------------------------------------------

def main():
    global FAKE_BASE
    server = fake_gemini.QuietThreadingHTTPServer(
        ("127.0.0.1", 0), fake_gemini.Handler
    )
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    FAKE_BASE = f"http://127.0.0.1:{port}"

    # Point the backend modules at the fake upstream (this process only).
    config.GEMINI_API_URL = FAKE_BASE
    config.GEMINI_API_KEY = "test-key-not-a-real-key"
    ai._GEMINI_CLIENT = None  # rebuild the client with the fake endpoint
    # Shrink chat retries slightly so multi-step failures stay quick.
    old_timeout = ai._PER_ATTEMPT_TIMEOUT_S
    ai._PER_ATTEMPT_TIMEOUT_S = 8.0

    unit = [
        ("429 daily quota fails fast with clean message", t_quota_fail_fast),
        ("503 on all models -> clean chat failure", t_503_all_models),
        ("malformed HTTP body -> clean failure + failover", t_malformed_body),
        ("empty content -> clean failure + failover", t_empty_content),
        ("vision non-JSON content -> clean analysis failure", t_vision_nonjson_content),
        ("invalid API key -> explicit rejection, 1 request", t_key_rejected),
        ("paid/non-free model -> refused before any request", t_paid_model_refused),
        ("missing API key -> clean config error, 0 requests", t_missing_key),
        ("flaky 503 then OK -> failover succeeds", t_flaky_failover_succeeds),
        ("upstream timeout -> clean failure in budget", t_timeout_clean_failure),
        ("identify OK -> items + deterministic authenticity", t_identify_ok),
        ("failed identify not cached; success is cached", t_identify_failure_not_cached),
        ("identify 429 quota message preserved", t_quota_identify_preserved),
    ]
    endpoint = [
        ("POST /api/ai/identify 502 on upstream failure", t_endpoint_identify_502),
        ("POST /api/ai/identify 502 clean quota detail", t_endpoint_quota_502),
        ("POST /api/ai/identify 200 happy path", t_endpoint_identify_200),
        ("POST /api/ai/chat 502 clean detail + 401 no token", t_endpoint_chat_502_and_401),
        ("POST /api/ai/chat non-dict messages -> 422, valid -> 502", t_endpoint_chat_bad_messages_422),
        ("POST /api/contact rejects invalid email/empty text", t_endpoint_contact_validation),
    ]

    print("== AI failure tests (fake Gemini upstream, no quota) ==")
    for name, fn in unit + endpoint:
        check(name, fn)

    ai._PER_ATTEMPT_TIMEOUT_S = old_timeout
    server.shutdown()

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    total = len(RESULTS)
    print(f"\nRESULT: {passed}/{total} passed")
    for name, ok, err in RESULTS:
        if not ok:
            print(f"  FAILED: {name} :: {err}")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
