"""Gemini free-tier migration checks (lightweight, no quota burn).

Run from the repo root:
    python tests/test_gemini_free.py

Verifies:
  1  official google-genai SDK installed, major version pinned < 3
  2  config exposes GEMINI_* only — no OPENROUTER_* anywhere in backend
  3  configured GEMINI_MODEL is inside the verified free allowlist
  4  allowlist accepts the 3 verified free models; rejects paid/unknown ids
  5  free queue order: configured primary first, then the other free models
  6  production source files contain no OpenRouter references
  7  API key lives only in backend/.env (config) — never in code/health output
  8  prompt hardening preserved (series-design + consistency rules)
  9  authenticity contract: exactly the 4 allowed statuses, no VERIFIED_AUTHENTIC
 10  message translation: system -> systemInstruction, data URL -> inline bytes,
     assistant -> model role (pure unit, no network)
 11  daily-quota classifier: 'per day' fails fast, per-minute does not
 12  ONE tiny live free-tier call (skipped with GEMINI_FREE_TEST_LIVE=0)
"""

import base64
import json
import os
import re
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "backend"))

import config  # noqa: E402
import ai  # noqa: E402

RESULTS = []
GEMINI_FILES = ("ai.py", "config.py", "main.py", "userdata.py", "contact.py",
                "auth.py", "db.py", "deps.py", "schema.py", "smtp_capture.py")


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


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


# --------------------------------------------------------------------------

def t_sdk_installed():
    import google.genai
    from google.genai import errors, types  # noqa: F401
    ver = getattr(google.genai, "__version__", None)
    expect(ver is not None, "google-genai has no __version__")
    major = int(ver.split(".")[0])
    expect(major >= 1 and major < 3,
           f"google-genai {ver} outside supported range >=1,<3")


def t_config_gemini_only():
    cfg_src = _read(os.path.join(REPO, "backend", "config.py"))
    expect("GEMINI_API_KEY" in cfg_src, "config.py must define GEMINI_API_KEY")
    expect("GEMINI_MODEL" in cfg_src, "config.py must define GEMINI_MODEL")
    expect("GEMINI_API_URL" in cfg_src, "config.py must define GEMINI_API_URL")
    expect("OPENROUTER" not in cfg_src, "config.py still references OPENROUTER")
    expect(not hasattr(config, "OPENROUTER_API_KEY"),
           "config still exposes OPENROUTER_API_KEY")


def t_model_in_allowlist():
    expect(config.GEMINI_MODEL in ai._VERIFIED_FREE_GEMINI_MODELS,
           f"configured GEMINI_MODEL {config.GEMINI_MODEL!r} is not in the "
           f"verified free allowlist {ai._VERIFIED_FREE_GEMINI_MODELS}")
    expect(ai._assert_free_only(config.GEMINI_MODEL) in
           ai._VERIFIED_FREE_GEMINI_MODELS, "allowlist return mismatch")


def t_allowlist_accepts_and_rejects():
    for good in ai._VERIFIED_FREE_GEMINI_MODELS:
        expect(ai._assert_free_only(good) == good, f"{good} should be accepted")
        expect(ai._assert_free_only(f"models/{good}") == good,
               f"models/-prefixed {good} should be accepted")
    for bad in ("", "gemini-2.5-pro", "gemini-3.5-flash", "gpt-4o",
                "openrouter/free", "qwen/qwen3.8-27b:free"):
        try:
            ai._assert_free_only(bad)
        except ai.AIError as exc:
            expect("non-free" in str(exc) or "empty" in str(exc),
                   f"rejection for {bad!r} lacks reason: {exc}")
            continue
        raise AssertionError(f"paid/unknown model {bad!r} was NOT rejected")


def t_free_queue_order():
    old = config.GEMINI_MODEL
    config.GEMINI_MODEL = "gemini-2.5-flash-lite"
    try:
        q = ai._free_model_queue()
    finally:
        config.GEMINI_MODEL = old
    expect(q[0] == "gemini-2.5-flash-lite", f"primary not first: {q}")
    expect(set(q) == set(ai._VERIFIED_FREE_GEMINI_MODELS),
           f"queue must only contain verified free models: {q}")
    expect(len(q) == len(set(q)), f"duplicate queue entries: {q}")


def t_no_openrouter_in_production():
    for name in GEMINI_FILES:
        path = os.path.join(REPO, "backend", name)
        if not os.path.exists(path):
            continue
        src = _read(path).lower()
        expect("openrouter" not in src,
               f"backend/{name} still references openrouter")
    api_src = _read(os.path.join(REPO, "src", "api.js")).lower()
    expect("openrouter" not in api_src, "src/api.js still references openrouter")


def t_key_only_in_env():
    key = config.GEMINI_API_KEY
    expect(bool(key), "GEMINI_API_KEY missing — fill backend/.env")
    expect(len(key) >= 30, f"GEMINI_API_KEY looks too short ({len(key)} chars)")
    # The key must never be hardcoded in source files.
    for name in GEMINI_FILES:
        path = os.path.join(REPO, "backend", name)
        if not os.path.exists(path):
            continue
        expect(key not in _read(path), f"API key leaked into backend/{name}")
    expect(key not in _read(os.path.join(REPO, "src", "api.js")),
           "API key leaked into frontend code")
    # Health endpoint must not echo the key.
    from fastapi.testclient import TestClient
    from main import app
    r = TestClient(app).get("/api/health")
    expect(r.status_code == 200, f"health failed: {r.status_code}")
    body = json.dumps(r.json())
    expect(key not in body, "health endpoint leaks the API key")
    expect(r.json().get("ai_model") in ai._VERIFIED_FREE_GEMINI_MODELS,
           f"health ai_model not free: {r.json().get('ai_model')}")
    expect(r.json().get("ai_model") == config.GEMINI_MODEL,
           "health ai_model must equal configured GEMINI_MODEL")


def t_prompt_hardening_preserved():
    obs = ai.OBSERVE_PROMPT
    expect("series_design_mismatch" in obs, "OBSERVE_PROMPT lost series rule")
    expect("novelty" in obs.lower() or "DIFFERENT person" in obs,
           "OBSERVE_PROMPT lost novelty/portrait rule")
    expect("must be set accordingly" in obs.lower(),
           "OBSERVE_PROMPT lost flags-must-match-notes consistency rule")
    expect("Identify EVERY coin" in ai.IDENTIFY_PROMPT, "identify prompt lost")
    expect("observations" in ai.IDENTIFY_PROMPT, "observations schema lost")


def t_authenticity_contract():
    expect(ai.AUTH_STATUSES == (
        "LIKELY_GENUINE", "SUSPICIOUS", "LIKELY_COUNTERFEIT", "UNABLE_TO_VERIFY"),
        f"unexpected statuses: {ai.AUTH_STATUSES}")
    expect("VERIFIED_AUTHENTIC" not in ai.AUTH_STATUSES,
           "VERIFIED_AUTHENTIC must never be an allowed status")
    # Non-currency image -> items empty, authenticity null (policy preserved).
    expect(ai._normalize_status("VERIFIED_AUTHENTIC") is None,
           "model-supplied VERIFIED_AUTHENTIC must be rejected")
    expect(ai._normalize_status("genuine") == "LIKELY_GENUINE",
           "status alias mapping lost")


def t_message_translation():
    img = "data:image/png;base64," + base64.b64encode(b"\x89PNG-fake").decode()
    system, contents = ai._messages_to_gemini([
        {"role": "system", "content": "System rules here."},
        {"role": "user", "content": [
            {"type": "text", "text": "Identify this."},
            {"type": "image_url", "image_url": {"url": img}},
        ]},
        {"role": "assistant", "content": "Earlier answer"},
        {"role": "user", "content": "Follow-up question"},
    ])
    expect(system == "System rules here.", f"system lost: {system!r}")
    expect(len(contents) == 3, f"expected 3 contents, got {len(contents)}")
    expect(contents[0].role == "user", "first content role")
    part_kinds = [sorted(p.model_dump(exclude_none=True).keys())
                  for p in contents[0].parts]
    expect(any("text" in k for ks in part_kinds for k in ks), "text part lost")
    expect(any("inline_data" in k for ks in part_kinds for k in ks),
           f"inline image bytes lost: {part_kinds}")
    expect(contents[1].role == "model", "assistant must map to model role")
    expect(contents[2].role == "user", "final user message lost")
    # split helper
    mime, b64 = ai._split_data_url(img)
    expect(mime == "image/png" and bool(b64), "split_data_url parse failed")
    expect(b64 == base64.b64encode(b"\x89PNG-fake").decode(),
           "split_data_url returned wrong payload")
    expect(ai._split_data_url("http://not-a-data-url.png") is None,
           "non-data URL must be rejected")


def t_quota_classifier():
    daily = ("Quota exceeded for quota metric 'Generate Content requests "
             "per day' and quota limit 'Generate Content requests per day'.")
    expect(ai._quota_limited(daily) is True, "daily quota not detected")
    expect(ai._quota_limited("Resource has been exhausted (e.g. check quota).")
           is False, "per-minute 429 must NOT be treated as daily quota")


def t_live_free_call():
    if os.getenv("GEMINI_FREE_TEST_LIVE", "1").strip().lower() in ("0", "false", "no"):
        print("    (live call skipped: GEMINI_FREE_TEST_LIVE=0)")
        return
    from google import genai
    from google.genai import types
    client = genai.Client(
        api_key=config.GEMINI_API_KEY,
        http_options=types.HttpOptions(timeout=30000),
    )
    t0 = time.time()
    r = client.models.generate_content(
        model=config.GEMINI_MODEL,
        contents="Reply with exactly: OK",
        config=types.GenerateContentConfig(
            max_output_tokens=100, temperature=0.0,
            http_options=types.HttpOptions(
                timeout=30000,
                retry_options=types.HttpRetryOptions(attempts=2),
            ),
        ),
    )
    text = (r.text or "").strip()
    expect("OK" in text, f"free model returned {text!r} in {time.time()-t0:.1f}s")
    print(f"    live free-tier call: {text!r} ({time.time() - t0:.1f}s)")


def main():
    print("== Gemini free-tier checks ==")
    for name, fn in [
        ("google-genai SDK installed (>=1,<3)", t_sdk_installed),
        ("config exposes GEMINI_* only (no OPENROUTER)", t_config_gemini_only),
        ("configured GEMINI_MODEL is in the free allowlist", t_model_in_allowlist),
        ("allowlist accepts free, rejects paid/unknown", t_allowlist_accepts_and_rejects),
        ("free queue: primary first, free-only, no dupes", t_free_queue_order),
        ("no OpenRouter refs in production sources", t_no_openrouter_in_production),
        ("API key only in backend/.env, never in code/health", t_key_only_in_env),
        ("prompt hardening rules preserved", t_prompt_hardening_preserved),
        ("authenticity statuses contract preserved", t_authenticity_contract),
        ("system/image/assistant message translation", t_message_translation),
        ("daily-vs-minute quota classifier", t_quota_classifier),
        ("ONE live free-tier call on configured model", t_live_free_call),
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
