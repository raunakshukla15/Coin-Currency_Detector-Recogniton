"""Preliminary coin authenticity assessment feature tests (Task E).

Covers (no live Gemini calls — ai._call_gemini is mocked where identify()
is involved, quota untouched):
  F1  all four internal statuses map to exactly the three required
      user-facing labels (positive / potentially suspicious / inconclusive)
  F2  every assessment carries the fixed limitations text (photo cannot
      verify metal/weight/magnetic properties, never confirms genuineness)
      and a non-empty next_steps recommendation
  F3  UNABLE_TO_VERIFY asks for clear photos of BOTH faces and the edge
  F4  artwork/non-physical upload -> Inconclusive + upload-a-photo next step
  F5  new coin observation anomalies (outline, lettering, edge, surface)
      each produce SUSPICIOUS with the matching visible warning sign
  F6  no fabricated numeric confidence anywhere; identify() output contains
      no authenticity_confidence key and overall confidence is null
  F7  malformed observation values never crash and never yield
      VERIFIED_AUTHENTIC
  F8  messages stay <= 512 chars, start with the label, contain no % figure
      and no certified/guaranteed genuineness claims
  F9  identify() wires label/limitations/next_steps into each item and the
      overall authenticity block
  F10 prompts carry the new observation fields and the chatbot uses the new
      wording (no old "likely genuine" phrase instruction)

Run:
    python tests/test_authenticity_feature.py
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

REQUIRED_LABELS = {
    "LIKELY_GENUINE": "No obvious suspicious signs detected",
    "SUSPICIOUS": "Potentially suspicious",
    "LIKELY_COUNTERFEIT": "Potentially suspicious",
    "UNABLE_TO_VERIFY": "Inconclusive",
}


def coin_obs(**overrides):
    """Coin observations that pass every quality/design gate."""
    o = {
        "is_physical_object": True,
        "blur_prevents_assessment": False,
        "notes": "",
        "enough_detail_to_judge_features": True,
        "monochrome_or_bad_photo": False,
        "casting_or_plating_defects": False,
        "design_matches_denomination": True,
        "shape_and_symmetry_plausible": True,
        "lettering_and_date_legible": True,
        "edge_pattern_visible": True,
        "unusual_surface_marks": False,
    }
    o.update(overrides)
    return o


def coin_item(**overrides):
    item = {"kind": "coin", "denomination": "5 Rupees (₹5)",
            "observations": coin_obs()}
    item.update(overrides)
    return item


# ---------------------------------------------------------------- F1
def f1_three_required_labels():
    for status, label in REQUIRED_LABELS.items():
        r = ai.assess_from_observations(coin_item(observations=coin_obs()))
        # force each status through the legacy fallback (no observations)
        legacy = ai.assess_authenticity(
            {"kind": "coin", "authenticity_status": status})
        expect(legacy["label"] == label,
               f"{status}: got {legacy['label']!r}, want {label!r}")
    # positive path label comes from the real policy:
    r = ai.assess_from_observations(coin_item())
    expect(r["status"] == "LIKELY_GENUINE", r["status"])
    expect(r["label"] == REQUIRED_LABELS["LIKELY_GENUINE"], r["label"])
    # only these three user-facing strings are ever produced
    seen = set()
    for status in REQUIRED_LABELS:
        legacy = ai.assess_authenticity(
            {"kind": "coin", "authenticity_status": status})
        seen.add(legacy["label"])
    expect(seen == {"No obvious suspicious signs detected",
                    "Potentially suspicious", "Inconclusive"},
           f"unexpected label set: {seen}")


# ---------------------------------------------------------------- F2
def f2_limitations_and_next_steps_everywhere():
    variants = [
        coin_item(),                                                   # genuine
        coin_item(observations=coin_obs(blur_prevents_assessment=True)),   # unable
        coin_item(observations=coin_obs(casting_or_plating_defects=True)), # counterfeit
        coin_item(observations=coin_obs(shape_and_symmetry_plausible=False)), # suspicious
        {"kind": "coin", "observations": {"is_physical_object": False}},    # artwork
        {"kind": "coin", "authenticity_status": "SUSPICIOUS"},              # legacy
    ]
    for it in variants:
        r = ai.assess_authenticity(it)
        lim = str(r.get("limitations") or "")
        nxt = str(r.get("next_steps") or "")
        for needle in ("metal", "weight", "magnetic", "verify",
                       "does not confirm"):
            expect(needle in lim.lower(),
                   f"{r['status']}: limitations missing {needle!r}: {lim!r}")
        expect(nxt.strip(), f"{r['status']}: empty next_steps")
        expect(r.get("label"), f"{r['status']}: missing label")
        expect(r.get("confidence") is None,
               f"{r['status']}: fabricated confidence {r.get('confidence')}")


# ---------------------------------------------------------------- F3
def f3_unable_asks_both_faces_and_edge():
    r = ai.assess_from_observations(
        coin_item(observations=coin_obs(blur_prevents_assessment=True)))
    expect(r["status"] == "UNABLE_TO_VERIFY", r["status"])
    nxt = r["next_steps"].lower()
    expect("both faces" in nxt, f"no both-faces request: {r['next_steps']!r}")
    expect("edge" in nxt, f"no edge request: {r['next_steps']!r}")
    expect("clear" in nxt and "well-lit" in nxt,
           f"no photo-quality ask: {r['next_steps']!r}")
    expect(r["label"] == "Inconclusive", r["label"])


# ---------------------------------------------------------------- F4
def f4_artwork_is_inconclusive_with_upload_ask():
    r = ai.assess_authenticity(
        {"kind": "coin", "observations": {"is_physical_object": False}})
    expect(r["status"] == "UNABLE_TO_VERIFY", r["status"])
    expect(r["label"] == "Inconclusive", r["label"])
    expect(r["message"].startswith("Inconclusive."),
           f"message must start with label: {r['message']!r}")
    nxt = r["next_steps"].lower()
    expect("photograph" in nxt and "physical" in nxt,
           f"no upload-a-photo ask: {r['next_steps']!r}")
    expect("scan again" in nxt, f"no retry ask: {r['next_steps']!r}")


# ---------------------------------------------------------------- F5
def f5_coin_anomaly_flags_produce_suspicious():
    cases = [
        ("shape_and_symmetry_plausible", False,
         "outline/symmetry appears irregular"),
        ("lettering_and_date_legible", False,
         "lettering or date appears garbled"),
        ("edge_pattern_visible", False,
         "edge pattern appears inconsistent"),
        ("unusual_surface_marks", True,
         "unusual surface marks"),
    ]
    for key, value, needle in cases:
        r = ai.assess_from_observations(
            coin_item(observations=coin_obs(**{key: value})))
        expect(r["status"] == "SUSPICIOUS",
               f"{key}={value} -> {r['status']}, want SUSPICIOUS")
        expect(r["label"] == "Potentially suspicious", r["label"])
        joined = " ".join(r["indicators"]).lower()
        expect(needle in joined,
               f"{key}: indicator missing {needle!r}: {r['indicators']}")
        expect("verif" in r["next_steps"].lower(),
               f"{key}: next steps must recommend physical verification")
    # all-new-keys clean -> still LIKELY_GENUINE (no false positive)
    r = ai.assess_from_observations(coin_item())
    expect(r["status"] == "LIKELY_GENUINE", r["status"])
    # a non-bool garbage value must not trigger the anomaly branch
    r = ai.assess_from_observations(
        coin_item(observations=coin_obs(shape_and_symmetry_plausible="false")))
    expect(r["status"] == "LIKELY_GENUINE",
           f"garbage value wrongly triggered {r['status']}")


# ---------------------------------------------------------------- F6
def f6_no_fabricated_confidence():
    # policy paths
    for it in (coin_item(),
               coin_item(observations=coin_obs(blur_prevents_assessment=True)),
               coin_item(observations=coin_obs(casting_or_plating_defects=True)),
               coin_item(observations=coin_obs(shape_and_symmetry_plausible=False))):
        r = ai.assess_from_observations(it)
        expect(r["confidence"] is None,
               f"confidence not None: {r['confidence']!r}")
    # legacy path ignores a model-supplied percentage
    r = ai.assess_authenticity(
        {"kind": "coin", "authenticity_status": "SUSPICIOUS",
         "authenticity_confidence": 97})
    expect(r["confidence"] is None,
           f"model-supplied confidence passed through: {r['confidence']!r}")
    # identify() end-to-end (mocked): no confidence key anywhere
    result, _ = run_identify(payload=ITEM_CLEAN)
    expect(result["authenticity"]["confidence"] is None,
           f"overall confidence: {result['authenticity']['confidence']!r}")
    blob = json.dumps(result, ensure_ascii=False)
    expect("authenticity_confidence" not in blob,
           "authenticity_confidence leaked into identify() output")


# ---------------------------------------------------------------- F7
def f7_malformed_observations_safe():
    garbage_values = ["false", 0, "", None, {}, [], "yes", 1.0]
    for v in garbage_values:
        for key in ("shape_and_symmetry_plausible", "lettering_and_date_legible",
                    "edge_pattern_visible", "unusual_surface_marks",
                    "is_physical_object", "blur_prevents_assessment"):
            r = ai.assess_authenticity(
                coin_item(observations=coin_obs(**{key: v})))
            expect(r["status"] in ai.AUTH_STATUSES,
                   f"{key}={v!r}: bad status {r['status']}")
            expect(r["status"] != "VERIFIED_AUTHENTIC",
                   f"{key}={v!r}: verification claimed")
    # observations that are not even a dict
    r = ai.assess_authenticity({"kind": "coin", "observations": "nonsense"})
    expect(r["status"] in ai.AUTH_STATUSES, r["status"])


# ---------------------------------------------------------------- F8
def f8_messages_honest_and_bounded():
    variants = [
        coin_item(),
        coin_item(observations=coin_obs(blur_prevents_assessment=True)),
        coin_item(observations=coin_obs(casting_or_plating_defects=True)),
        coin_item(observations=coin_obs(shape_and_symmetry_plausible=False)),
        {"kind": "coin", "observations": {"is_physical_object": False}},
    ]
    banned = ("guaranteed", "definitely genuine", "definitely real",
              "verified authentic", "certified genuine", "100%",
              "confirmed genuine")
    for it in variants:
        r = ai.assess_authenticity(it)
        expect(len(r["message"]) <= 512,
               f"message too long ({len(r['message'])}): {r['message']!r}")
        expect(r["message"].startswith(r["label"] + "."),
               f"message must start with label: {r['message']!r}")
        combined = (r["message"] + " " + r["limitations"] + " "
                    + r["next_steps"]).lower()
        expect("%" not in combined,
               f"percentage figure in user text: {combined!r}")
        for b in banned:
            expect(b not in combined, f"banned claim {b!r} in: {combined!r}")


# ---------------------------------------------------------------- F9
def f9_identify_wires_new_fields():
    result, _ = run_identify(payload=ITEM_CLEAN)
    item = result["items"][0]
    for key in ("authenticity_status", "authenticity_label",
                "authenticity_message", "authenticity_limitations",
                "authenticity_next_steps", "suspiciousIndicators"):
        expect(key in item, f"item missing {key!r}")
    expect(item["authenticity_label"] ==
           REQUIRED_LABELS[item["authenticity_status"]], item["authenticity_label"])
    overall = result["authenticity"]
    for key in ("status", "label", "message", "indicators", "limitations",
                "next_steps", "confidence"):
        expect(key in overall, f"overall missing {key!r}")
    expect(overall["label"] == REQUIRED_LABELS[overall["status"]],
           overall["label"])
    # suspicious observation path through identify(): label + warning signs
    # (the mocked OBSERVE pass returns the suspicious flags — it merges over
    # the item's own observations, mirroring production precedence)
    result2, _ = run_identify(
        payload=ITEM_CLEAN,
        questionnaire=coin_obs(shape_and_symmetry_plausible=False))
    item2 = result2["items"][0]
    expect(item2["authenticity_status"] == "SUSPICIOUS", item2["authenticity_status"])
    expect(item2["authenticity_label"] == "Potentially suspicious",
           item2["authenticity_label"])
    expect(item2["suspiciousIndicators"], "no visible warning signs")


# --------------------------------------------------------------- F10
def f10_prompts_carry_new_fields():
    for needle in ("shape_and_symmetry_plausible", "lettering_and_date_legible",
                   "edge_pattern_visible", "unusual_surface_marks"):
        expect(needle in ai.OBSERVE_PROMPT, f"OBSERVE_PROMPT missing {needle}")
        expect(needle in ai.IDENTIFY_PROMPT, f"IDENTIFY_PROMPT missing {needle}")
    # tri-state edge rule (null = not visible) is spelled out
    expect("edge IS visible" in ai.OBSERVE_PROMPT,
           "edge_pattern_visible tri-state rule missing")
    # chatbot uses the new wording, not the retired phrases
    expect("Phrase statuses naturally" not in ai.CHAT_IMAGE_SYSTEM,
           "old status-wording instruction still present")
    expect("label" in ai.CHAT_IMAGE_SYSTEM, "chat prompt missing label guidance")
    expect("metal composition" in ai.CHAT_IMAGE_SYSTEM
           or "verify metal" in ai.CHAT_IMAGE_SYSTEM,
           "chat prompt missing photo-cannot-verify note")


# ---- identify() harness (copied pattern from test_denomination_passthrough)
QUESTIONNAIRE = coin_obs() | {"notes": "worn coin surface"}


def run_identify(payload=None, raw=None, questionnaire=None):
    """identify() with _call_gemini mocked. Returns (result, prompt_texts)."""
    ai._IDENTIFY_CACHE.clear()
    prompts = []
    obs_pass = questionnaire if questionnaire is not None else QUESTIONNAIRE

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
        return json.dumps(obs_pass, ensure_ascii=False)

    orig = ai._call_gemini
    ai._call_gemini = fake_call_gemini
    try:
        result = ai.identify(TINY_PNG)
    finally:
        ai._call_gemini = orig
        ai._IDENTIFY_CACHE.clear()
    return result, prompts


ITEM_CLEAN = [{
    "kind": "coin",
    "name": "5 Rupees (₹5)",
    "country": "India",
    "year": "2011 – Present",
    "denomination": "5 Rupees (₹5)",
    "type": "rupee1",
    "match": 88,
    "confidence": "high",
    "observations": coin_obs(),
}]


def main():
    print(f"authenticity feature tests (mocked Gemini, model={ai.LAST_RESOLVED_MODEL})")
    for name, fn in [
        ("F1 three required user-facing labels", f1_three_required_labels),
        ("F2 limitations + next steps on every assessment", f2_limitations_and_next_steps_everywhere),
        ("F3 inconclusive asks for both faces + edge photos", f3_unable_asks_both_faces_and_edge),
        ("F4 artwork -> inconclusive + upload-a-photo ask", f4_artwork_is_inconclusive_with_upload_ask),
        ("F5 coin anomaly flags -> potentially suspicious", f5_coin_anomaly_flags_produce_suspicious),
        ("F6 no fabricated numeric confidence", f6_no_fabricated_confidence),
        ("F7 malformed observations safe, never verified", f7_malformed_observations_safe),
        ("F8 messages honest, bounded, label-first", f8_messages_honest_and_bounded),
        ("F9 identify() wires label/limitations/next_steps", f9_identify_wires_new_fields),
        ("F10 prompts carry new fields + new chat wording", f10_prompts_carry_new_fields),
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
