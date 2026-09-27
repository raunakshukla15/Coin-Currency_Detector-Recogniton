"""Authenticity overlay/annotation fix tests (real Gemini backend).

Run from the repo root:
    python tests/test_overlay_authenticity.py

Required cases:
 1. Clean genuine-looking 20 Paise   -> ID correct, status NOT changed by fix
 2. George V Sovereign + "FAKE" overlay -> ID = Sovereign George V, NEVER
    LIKELY_GENUINE, overlay acknowledged, status limited to
    UNABLE_TO_VERIFY / SUSPICIOUS
 3. Known counterfeit 500 note       -> still LIKELY_COUNTERFEIT
 4. Poor-quality image                -> UNABLE_TO_VERIFY
 5. Harmless watermark/label          -> NOT auto-classified counterfeit
 6. Existing regression suites pass   -> run separately (see report)

Part A is deterministic policy unit testing (no network). Part B is live.
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

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = "http://127.0.0.1:8000/api"
FIX = os.path.join(HERE, "fixtures")
PASS, FAIL = [], []


def check(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print(f"  PASS  {name}")
    else:
        FAIL.append(f"{name} :: {detail}")
        print(f"  FAIL  {name} :: {detail}")


def data_url(path):
    raw = open(path, "rb").read()
    mime = "image/png" if path.lower().endswith(".png") else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(raw).decode()


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


def obs_item(kind, **obs):
    base = {"is_physical_object": True, "blur_prevents_assessment": False,
            "enough_detail_to_judge_features": True, "notes": "n"}
    if kind == "coin":
        base.update({"monochrome_or_bad_photo": False,
                     "casting_or_plating_defects": False,
                     "design_matches_denomination": True})
    else:
        base.update({"monochrome_reproduction": False,
                     "paper_cut_or_registration_marks": False,
                     "lying_on_unrelated_objects": False,
                     "specimen_or_sample_stamp": False,
                     "color_scheme_plausible": True,
                     "series_design_mismatch": False,
                     "serial_number_anomaly": False,
                     "cut_paste_overlay_tape": False,
                     "on_bank_documents": False, "cut_out_with_borders": False,
                     "registration_ticks": False, "toner_only_note": False})
    base.update(obs)
    return {"kind": kind, "name": "X", "observations": base}


def part_a_units():
    print("== A. Policy unit checks (deterministic, no network) ==")
    cases = [
        ("clean coin -> LIKELY_GENUINE",
         obs_item("coin"), "LIKELY_GENUINE", False),
        ("blocking overlay coin -> UNABLE_TO_VERIFY",
         obs_item("coin", external_overlay_or_annotation=True,
                  overlay_compromises_assessment=True,
                  overlay_description="red FAKE across coin"),
         "UNABLE_TO_VERIFY", True),
        ("harmless watermark coin -> LIKELY_GENUINE (+ack)",
         obs_item("coin", external_overlay_or_annotation=True,
                  overlay_compromises_assessment=False,
                  overlay_description="corner watermark"),
         "LIKELY_GENUINE", True),
        ("casting defects + overlay -> LIKELY_COUNTERFEIT (independent evidence)",
         obs_item("coin", casting_or_plating_defects=True,
                  external_overlay_or_annotation=True,
                  overlay_compromises_assessment=True),
         "LIKELY_COUNTERFEIT", True),
        ("design mismatch + overlay -> SUSPICIOUS (existing rule)",
         obs_item("coin", design_matches_denomination=False,
                  external_overlay_or_annotation=True,
                  overlay_compromises_assessment=True),
         "SUSPICIOUS", True),
        ("clean note -> LIKELY_GENUINE",
         obs_item("currency"), "LIKELY_GENUINE", False),
        ("blocking overlay note -> UNABLE_TO_VERIFY",
         obs_item("currency", external_overlay_or_annotation=True,
                  overlay_compromises_assessment=True,
                  overlay_description="FAKE stamped over note"),
         "UNABLE_TO_VERIFY", True),
        ("photocopy scene + overlay -> LIKELY_COUNTERFEIT (existing rule)",
         obs_item("currency", on_bank_documents=True, cut_out_with_borders=True,
                  external_overlay_or_annotation=True,
                  overlay_compromises_assessment=True),
         "LIKELY_COUNTERFEIT", True),
        ("blur + overlay -> UNABLE_TO_VERIFY (+ack)",
         obs_item("currency", blur_prevents_assessment=True,
                  external_overlay_or_annotation=True,
                  overlay_compromises_assessment=True),
         "UNABLE_TO_VERIFY", True),
    ]
    for name, it, want, ack_required in cases:
        r = ai.assess_from_observations(it)
        ok = r["status"] == want
        ack = True
        if ack_required:
            ack = any(w in " ".join(r["indicators"]).lower()
                      for w in ("overlay", "annotation", "watermark"))
        check(name, ok and ack, f"got {r['status']} ack={ack} want {want}")
        check(f"  status allowed: {r['status']}", r["status"] in ai.AUTH_STATUSES
              and r["status"] != "VERIFIED_AUTHENTIC", r["status"])
    # The forbidden simplistic rule must NOT exist: the decision policy must
    # not map words seen in the image (e.g. "FAKE") onto a status. Status
    # vocabulary normalization in _normalize_status() (legacy string aliases)
    # is unrelated to image content and remains as before.
    import inspect
    policy_src = inspect.getsource(ai.assess_from_observations)
    check("policy has no image-word -> status literal (e.g. FAKE)",
          "FAKE" not in policy_src)
    check("VERIFIED_AUTHENTIC still forbidden by normalizer",
          ai._normalize_status("VERIFIED_AUTHENTIC") is None)


def part_b_live():
    print("\n== B. Live cases (real Gemini) ==")
    s = str(int(time.time()) % 100000)
    st, body = req("/auth/signup", "POST", body={
        "username": f"ovl{s}", "email": f"ovl{s}@example.com",
        "password": "Testpass123!"})
    tok = body.get("token")
    if not tok:
        st, body = req("/auth/login", "POST", body={
            "identifier": f"ovl{s}", "password": "Testpass123!"})
        tok = body.get("token")
    check("auth token", bool(tok), str(body)[:200])
    if not tok:
        sys.exit(1)

    def identify(label, path):
        st, body = req("/ai/identify", "POST", tok, {"image": data_url(path)})
        items = (body or {}).get("items") or []
        auth = (body or {}).get("authenticity") or {}
        first = items[0] if items else {}
        print(f"  [{label}] status={auth.get('status')} name={first.get('name')!r} "
              f"match={first.get('match')}")
        return st, items, auth

    # --- Case 1: clean 20 Paise ---
    print("\n-- Case 1: clean 20 Paise --")
    st, items, auth = identify("paise20", os.path.join(FIX, "paise20_clean.jpg"))
    name = str((items[0] if items else {}).get("name") or "")
    check("case1 identify 200 + item", st == 200 and items, f"{st} {items}")
    check("case1 ID = 20 Paise", re.search(r"paise", name, re.I) is not None, name)
    check("case1 status unchanged (LIKELY_GENUINE)",
          auth.get("status") == "LIKELY_GENUINE", str(auth.get("status")))
    check("case1 recognition separate (match present)",
          isinstance((items[0] if items else {}).get("match"), (int, float)))
    time.sleep(3)

    # --- Case 2: George V Sovereign with FAKE overlay ---
    print("\n-- Case 2: George V Sovereign + FAKE overlay --")
    st, items, auth = identify("overlay", os.path.join(FIX, "overlay_fake_sovereign.jpg"))
    name = str((items[0] if items else {}).get("name") or "")
    joined = json.dumps(auth, ensure_ascii=False).lower()
    check("case2 identify 200 + item", st == 200 and items, f"{st} {items}")
    check("case2 ID = Sovereign – George V",
          re.search(r"sovereign", name, re.I) is not None
          and re.search(r"george", name, re.I) is not None, name)
    check("case2 NOT LIKELY_GENUINE", auth.get("status") != "LIKELY_GENUINE",
          str(auth.get("status")))
    check("case2 status limited to UNABLE/SUSPICIOUS",
          auth.get("status") in ("UNABLE_TO_VERIFY", "SUSPICIOUS"),
          str(auth.get("status")))
    check("case2 acknowledges the overlay",
          re.search(r"overlay|annotation|fake", joined) is not None, joined[:300])
    check("case2 overlay not treated as proof of counterfeit",
          auth.get("status") != "LIKELY_COUNTERFEIT", str(auth.get("status")))
    check("case2 never VERIFIED_AUTHENTIC", auth.get("status") != "VERIFIED_AUTHENTIC")
    time.sleep(3)

    # --- Case 3: known counterfeit 500 ---
    print("\n-- Case 3: known counterfeit 500 note --")
    st, items, auth = identify("fake500", os.path.join(FIX, "benchmark", "03_fake_500.jpg"))
    check("case3 identify 200 + item", st == 200 and items, f"{st} {items}")
    check("case3 still LIKELY_COUNTERFEIT",
          auth.get("status") == "LIKELY_COUNTERFEIT", str(auth.get("status")))
    check("case3 counterfeit evidence in indicators",
          len(auth.get("indicators") or []) > 0, str(auth.get("indicators")))
    time.sleep(3)

    # --- Case 4: poor quality ---
    print("\n-- Case 4: poor-quality image --")
    st, items, auth = identify("poor", os.path.join(FIX, "benchmark", "10_poor_quality.jpg"))
    check("case4 identify 200", st == 200, str(st))
    check("case4 UNABLE_TO_VERIFY",
          auth.get("status") == "UNABLE_TO_VERIFY"
          or (not items and auth.get("authenticity") is None),
          str(auth.get("status")))
    time.sleep(3)

    # --- Case 5: harmless watermark/label ---
    print("\n-- Case 5: harmless dealer watermark --")
    st, items, auth = identify("watermark", os.path.join(FIX, "benchmark", "07_coin.jpg"))
    check("case5 identify 200 + item", st == 200 and items, f"{st} {items}")
    check("case5 NOT auto-counterfeit",
          auth.get("status") != "LIKELY_COUNTERFEIT", str(auth.get("status")))
    check("case5 status in allowed four",
          auth.get("status") in ai.AUTH_STATUSES, str(auth.get("status")))


def main():
    part_a_units()
    part_b_live()
    print(f"\nRESULT: {len(PASS)} passed, {len(FAIL)} failed")
    for f in FAIL:
        print("  FAIL:", f)
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
