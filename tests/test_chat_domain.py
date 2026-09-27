"""CoinScan chatbot domain + plain-text reply tests (real Gemini backend).

Run from the repo root:
    python tests/test_chat_domain.py

Covers the required acceptance list:
 1. "What is a 10 rupee Indian coin?"        -> answered
 2. "What currency does Japan use?"          -> answered
 3. "What is a mint mark?"                   -> answered
 4. "Can you identify this coin?" + image    -> image analyzed
 5. "Is this note real or fake?" + image     -> cautious image analysis
 6. "Tell me about anime."                   -> exact OFF_TOPIC reply
 7. No raw markdown (**, *, #, ```) in any chatbot response
 8. Chat messages and attached images persist in MySQL (via the API)
"""

import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO, "backend"))

import ai  # noqa: E402
import config  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = "http://127.0.0.1:8000/api"
FIX_COIN = os.path.join(HERE, "fixtures", "coin.jpg")
FIX_NOTE = os.path.join(HERE, "fixtures", "note.jpg")
PASS, FAIL = [], []


def check(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print(f"  PASS  {name}")
    else:
        FAIL.append(f"{name} :: {detail}")
        print(f"  FAIL  {name} :: {detail}")


def req(path, method="GET", token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=240) as res:
            try:
                return res.status, json.loads(res.read())
            except Exception:
                return res.status, {}
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def data_url(path):
    raw = open(path, "rb").read()
    mime = "image/png" if path.lower().endswith(".png") else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(raw).decode()


def chat(tok, content, image=None, timeout_note=""):
    msg = {"role": "user", "content": content}
    if image:
        msg["image"] = image
    st, body = req("/ai/chat", "POST", tok, {"messages": [msg]})
    return st, (body or {}).get("reply") or ""


RAW_MD = re.compile(
    r"\*\*|```|^\s{0,3}#{1,6}\s|^\*\s|\*(?!\s)[^*\n]*[^*\n\s]\*",
    re.MULTILINE,
)


def clean_of_markdown(reply):
    return not RAW_MD.search(reply or "")


def main():
    print("== 0. Unit: topic gate + markdown stripper (no network) ==")
    for s in ("Tell me about anime.", "Recommend me a good movie",
              "my laptop is slow", "teach me programming",
              "best gaming laptop for school", "who won the football match"):
        check(f"off-topic: {s!r}", ai._is_off_topic(s))
    for s in ("What is a mint mark?", "hello", "10 rupee Indian coin",
              "Is this note real or fake?", "What currency does Japan use?",
              "Can you identify this coin?", "hello smoke"):
        check(f"on-topic: {s!r}", not ai._is_off_topic(s))

    md_cases = [
        ("bold", "**likely counterfeit** note", "likely counterfeit note"),
        ("italic", "a *small* mark", "a small mark"),
        ("heading", "# Mint marks\nIndian coins", "Mint marks\nIndian coins"),
        ("fence", '```json\n{"a": 1}\n```', '{"a": 1}'),
        ("bullet", "* first\n* second", "• first\n• second"),
        ("link", "see [RBI](https://rbi.org) site", "see RBI site"),
    ]
    for name, src, want in md_cases:
        got = ai._strip_markdown(src)
        check(f"strip {name}", got == want and "**" not in got
              and "```" not in got, f"got {got!r}")
    check("OFF_TOPIC passes through strip",
          ai._strip_markdown(ai.OFF_TOPIC_REPLY) == ai.OFF_TOPIC_REPLY)

    # Off-topic gate must answer WITHOUT any upstream call: with the key
    # removed the reply is still the OFF_TOPIC text (not a key error).
    old_key = config.GEMINI_API_KEY
    config.GEMINI_API_KEY = ""
    try:
        r = ai.chat([{"role": "user", "content": "Tell me about anime."}])
        check("gate needs no upstream (works with empty key)",
              r == ai.OFF_TOPIC_REPLY, repr(r))
    finally:
        config.GEMINI_API_KEY = old_key

    # Signup
    s = str(int(time.time()) % 100000)
    st, body = req("/auth/signup", "POST", body={
        "username": f"domains{s}", "email": f"domains{s}@example.com",
        "password": "Testpass123!"})
    tok = body.get("token")
    if not tok:
        st, body = req("/auth/login", "POST", body={
            "identifier": f"domains{s}", "password": "Testpass123!"})
        tok = body.get("token")
    check("auth token", bool(tok), str(body)[:200])
    if not tok:
        sys.exit(1)

    replies = {}

    print("\n== 1. 10 rupee Indian coin (text) ==")
    st, r = chat(tok, "What is a 10 rupee Indian coin?")
    replies["t1"] = r
    check("answered 200", st == 200, str(st))
    check("not OFF_TOPIC", r != ai.OFF_TOPIC_REPLY, r[:80])
    check("mentions rupee/coin", re.search(r"rupee|coin|₹", r, re.I) is not None, r[:160])
    time.sleep(3)

    print("\n== 2. Japan currency (text) ==")
    st, r = chat(tok, "What currency does Japan use?")
    replies["t2"] = r
    check("answered 200", st == 200, str(st))
    check("not OFF_TOPIC", r != ai.OFF_TOPIC_REPLY, r[:80])
    check("says yen", re.search(r"\byen\b|JPY", r, re.I) is not None, r[:160])
    time.sleep(3)

    print("\n== 3. mint mark (text) ==")
    st, r = chat(tok, "What is a mint mark?")
    replies["t3"] = r
    check("answered 200", st == 200, str(st))
    check("not OFF_TOPIC", r != ai.OFF_TOPIC_REPLY, r[:80])
    check("explains mint", re.search(r"mint", r, re.I) is not None, r[:160])
    time.sleep(3)

    print("\n== 4. identify this coin (image) ==")
    coin = data_url(FIX_COIN)
    st, r = chat(tok, "Can you identify this coin?", image=coin)
    replies["t4"] = r
    check("answered 200", st == 200, str(st))
    check("not OFF_TOPIC", r != ai.OFF_TOPIC_REPLY, r[:80])
    check("real analysis (long, not an error)", len(r) > 40
          and "couldn't reliably analyze" not in r, r[:160])
    check("mentions the item", re.search(
        r"coin|quarter|dollar|25|united states|cent", r, re.I) is not None, r[:200])
    time.sleep(3)

    print("\n== 5. real or fake (image, cautious) ==")
    note = data_url(FIX_NOTE)
    st, r = chat(tok, "Is this note real or fake?", image=note)
    replies["t5"] = r
    check("answered 200", st == 200, str(st))
    check("not OFF_TOPIC", r != ai.OFF_TOPIC_REPLY, r[:80])
    check("real analysis (long, not an error)", len(r) > 40
          and "couldn't reliably analyze" not in r, r[:160])
    check("cautious verdict wording", re.search(
        r"counterfeit|genuine|suspicious|unable|verify|specimen|fake", r, re.I)
        is not None, r[:200])
    check("never claims certified authenticity", not re.search(
        r"verified authentic|100% genuine|guaranteed genuine|laboratory|forensically "
        r"confirmed|definitely (real|genuine)", r, re.I), r[:200])
    time.sleep(3)

    print("\n== 6. off-topic: anime -> OFF_TOPIC response ==")
    st, r = chat(tok, "Tell me about anime.")
    check("answered 200", st == 200, str(st))
    check("exact OFF_TOPIC reply", r == ai.OFF_TOPIC_REPLY,
          f"got {r!r} want {ai.OFF_TOPIC_REPLY!r}")
    st, r2 = chat(tok, "Can anime cards be collected like coins?")
    check("loose connection also OFF_TOPIC", r2 == ai.OFF_TOPIC_REPLY, r2[:160])
    st, r3 = chat(tok, "Which laptop should I buy for school?")
    check("laptop question also OFF_TOPIC", r3 == ai.OFF_TOPIC_REPLY, r3[:160])

    print("\n== 7. no raw markdown in any response ==")
    for key, r in replies.items():
        check(f"clean markdown: {key}", clean_of_markdown(r),
              repr((r or "")[:200]))
    check("OFF_TOPIC has no markdown", clean_of_markdown(ai.OFF_TOPIC_REPLY))

    print("\n== 8. messages + images persist in MySQL (via API) ==")
    st, b = req("/chats", "POST", tok, {"title": "Domain test"})
    chat_id = (b.get("chat") or {}).get("id")
    check("chat created", st == 200 and chat_id, str(b)[:160])
    st, b = req(f"/chats/{chat_id}/messages", "POST", tok, {
        "role": "user", "content": "Can you identify this coin?", "image": coin})
    m1 = b.get("message") or {}
    check("user message saved with image", st == 200 and m1.get("id")
          and m1.get("imageId"), str(b)[:200])
    check("image round-trips as data URL",
          str(m1.get("image") or "").startswith("data:image"), str(m1.get("image"))[:60])
    st, b = req(f"/chats/{chat_id}/messages", "POST", tok, {
        "role": "assistant", "content": replies["t4"]})
    m2 = b.get("message") or {}
    check("assistant reply saved", st == 200 and m2.get("id"), str(b)[:200])
    st, b = req(f"/chats/{chat_id}/messages", token=tok)
    msgs = b.get("messages") or []
    check("both messages reloaded from DB", st == 200 and len(msgs) == 2,
          f"{st} n={len(msgs)}")
    if len(msgs) == 2:
        check("user content persisted", msgs[0].get("content") == "Can you identify this coin?")
        check("assistant reply persisted (clean)", msgs[1].get("content") == replies["t4"]
              and clean_of_markdown(msgs[1].get("content") or ""))
        check("image persisted on message",
              bool(msgs[0].get("imageId"))
              and str(msgs[0].get("image") or "").startswith("data:image"))
    st, b = req("/chats", token=tok)
    row = [c for c in (b.get("chats") or []) if c.get("id") == chat_id]
    check("chat listed with 2 messages (MySQL rowcount)",
          st == 200 and row and row[0].get("messageCount") == 2, str(b)[:200])

    print(f"\nRESULT: {len(PASS)} passed, {len(FAIL)} failed")
    for f in FAIL:
        print("  FAIL:", f)
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
