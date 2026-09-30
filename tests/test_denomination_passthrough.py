"""Denomination passthrough + Gemini-response parsing regression tests.

Covers (no live Gemini calls — ai._call_gemini is mocked, quota untouched):
  P1  IDENTIFY_PROMPT contains the denomination numeral/self-check rules
  P2  identify() returns Gemini's denomination EXACTLY as received
  P3  a wrong "type" label never overrides / remaps denomination
  P4  a missing denomination is NOT fabricated (no static default injected)
  P5  markdown-fenced and trailing-comma responses parse, denomination exact
  P6  a truncated multi-item response salvages only complete items — the
      salvaged denomination is the exact string Gemini returned
  P7  unparseable model output -> empty items + null authenticity (no crash,
      no invented item)

Run:
    python tests/test_denomination_passthrough.py
"""

import json
import os
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "backend"))

import ai  # noqa: E402

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


# Tiny 1x1 PNG data URL — passes validation; never sent upstream (mocked).
TINY_PNG = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
    "AAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)

# Short observation questionnaire returned by the mocked second pass.
QUESTIONNAIRE = {
    "is_physical_object": True,
    "blur_prevents_assessment": False,
    "notes": "worn coin surface",
    "monochrome_reproduction": False,
    "paper_cut_or_registration_marks": False,
    "lying_on_unrelated_objects": False,
    "specimen_or_sample_stamp": False,
    "color_scheme_plausible": None,
    "series_design_mismatch": False,
    "serial_number_anomaly": False,
    "cut_paste_overlay_tape": False,
    "enough_detail_to_judge_features": True,
    "monochrome_or_bad_photo": False,
    "casting_or_plating_defects": False,
    "design_matches_denomination": True,
}


def run_identify(payload=None, raw=None):
    """identify() with _call_gemini mocked. Returns (result, prompt_texts)."""
    ai._IDENTIFY_CACHE.clear()
    prompts = []

    def fake_call_gemini(messages, **kwargs):
        text = ""
        for m in messages:
            c = m.get("content")
            if isinstance(c, list):
                for part in c:
                    if isinstance(part, dict) and part.get("type") == "text":
                        text += part.get("text") or ""
        prompts.append(text)
        if "expert numismatist" in text:
            return raw if raw is not None else json.dumps(payload, ensure_ascii=False)
        return json.dumps(QUESTIONNAIRE, ensure_ascii=False)

    orig = ai._call_gemini
    ai._call_gemini = fake_call_gemini
    try:
        result = ai.identify(TINY_PNG)
    finally:
        ai._call_gemini = orig
        ai._IDENTIFY_CACHE.clear()
    return result, prompts


ITEM_5 = [{
    "kind": "coin",
    "name": "5 Rupees (₹5)",
    "country": "India",
    "year": "2011 – Present",
    "denomination": "5 Rupees (₹5)",
    "type": "rupee1",
    "match": 88,
    "confidence": "high",
    "observations": {"is_physical_object": True, "notes": "worn steel coin"},
}]


# ---------------------------------------------------------------- P1
def p1_prompt_contains_denomination_rules():
    for needle in (
        "=== DENOMINATION (read the printed numeral) ===",
        "NEVER infer the value",
        "Self-check before returning",
        "never guess a standard value",
        "must never override the visible numeral",
    ):
        expect(needle in ai.IDENTIFY_PROMPT, f"prompt missing: {needle!r}")


# ---------------------------------------------------------------- P2
def p2_denomination_passthrough_exact():
    result, prompts = run_identify(payload=ITEM_5)
    expect(len(prompts) >= 1, "identify pass did not run")
    items = result["items"]
    expect(len(items) == 1, f"expected 1 item, got {len(items)}")
    expect(items[0].get("denomination") == "5 Rupees (₹5)",
           f"denomination altered: {items[0].get('denomination')!r}")
    expect(items[0].get("name") == "5 Rupees (₹5)",
           f"name altered: {items[0].get('name')!r}")


# ---------------------------------------------------------------- P3
def p3_wrong_type_never_overrides_denomination():
    payload = [dict(ITEM_5[0], type="rupee10", name="2 Rupees (₹2)",
                    denomination="2 Rupees (₹2)")]
    result, _ = run_identify(payload=payload)
    got = result["items"][0].get("denomination")
    expect(got == "2 Rupees (₹2)",
           f"type=rupee10 must not remap denomination, got {got!r}")
    expect(got != "10 Rupees (₹10)", "denomination was rewritten to ₹10")


# ---------------------------------------------------------------- P4
def p4_missing_denomination_not_fabricated():
    payload = [{
        "kind": "coin",
        "name": "Unlabeled Modern Coin",
        "country": "India",
        "type": "rupee10",
        "match": 55,
        "observations": {"is_physical_object": True, "notes": "illegible"},
    }]
    result, _ = run_identify(payload=payload)
    item = result["items"][0]
    expect("denomination" not in item or not item.get("denomination"),
           f"backend fabricated a denomination: {item.get('denomination')!r}")
    for banned in ("10 Rupees (₹10)", "5 Rupees (₹5)", "1 Rupee"):
        expect(banned not in json.dumps(result, ensure_ascii=False),
               f"static default {banned!r} injected into result")


# ---------------------------------------------------------------- P5
def p5_fenced_and_trailing_comma_responses_parse():
    fenced = "```json\n" + json.dumps(ITEM_5, ensure_ascii=False) + "\n```"
    result, _ = run_identify(raw=fenced)
    expect(result["items"][0].get("denomination") == "5 Rupees (₹5)",
           f"fenced parse altered denomination: {result['items']}")

    body = json.dumps(ITEM_5, ensure_ascii=False)[:-1] + ",]"
    result2, _ = run_identify(raw=body)
    expect(result2["items"][0].get("denomination") == "5 Rupees (₹5)",
           f"trailing-comma repair altered denomination: {result2['items']}")


# ---------------------------------------------------------------- P6
def p6_truncated_response_keeps_only_complete_items():
    full = json.dumps(ITEM_5, ensure_ascii=False)          # [{complete item}]
    raw = full[:-1] + ', {"kind": "coin", "name": "trunca'  # cut mid item 2
    result, _ = run_identify(raw=raw)
    items = result["items"]
    expect(len(items) == 1, f"expected only the complete item, got {len(items)}")
    expect(items[0].get("denomination") == "5 Rupees (₹5)",
           f"salvaged denomination altered: {items[0].get('denomination')!r}")


# ---------------------------------------------------------------- P7
def p7_unparseable_output_is_empty_not_crash():
    result, _ = run_identify(raw="I'm sorry, I cannot help with that.")
    expect(result == {"items": [], "authenticity": None},
           f"expected empty honest result, got {result!r}")


def main():
    print(f"denomination passthrough tests (mocked Gemini, model={ai.LAST_RESOLVED_MODEL})")
    for name, fn in [
        ("P1 prompt contains denomination numeral/self-check rules", p1_prompt_contains_denomination_rules),
        ("P2 denomination passthrough is exact", p2_denomination_passthrough_exact),
        ("P3 wrong type label never overrides denomination", p3_wrong_type_never_overrides_denomination),
        ("P4 missing denomination is never fabricated", p4_missing_denomination_not_fabricated),
        ("P5 fenced/trailing-comma JSON parses, denomination exact", p5_fenced_and_trailing_comma_responses_parse),
        ("P6 truncated response keeps only complete items", p6_truncated_response_keeps_only_complete_items),
        ("P7 unparseable output -> empty items, no crash", p7_unparseable_output_is_empty_not_crash),
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
