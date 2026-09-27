"""10-image real-AI accuracy benchmark against Gemini free tier.

Run from the repo root:
    python tests/benchmark_gemini_10.py

EXPECTED below is PRE-REGISTERED: every expected value was fixed BEFORE the
benchmark was executed, from independent visual ground-truth inspection of
the pixels (not from model output). Scores:

  identification  first detected item matches kind + country + denomination
                  (image 09 expects NO items; image 10 accepts no items or an
                  UNABLE_TO_VERIFY verdict — an honest abstention)
  authenticity    overall status equals the pre-registered expected status
                  (image 09 expects authenticity=null; image 10 expects
                  UNABLE_TO_VERIFY or null)

Uses the same engine as production (backend/ai.py identify()), one real
request pair per image, paced to respect free-tier per-minute limits.
Results are printed and written to tests/benchmark_results.json.
"""

import base64
import json
import os
import re
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "backend"))

import ai  # noqa: E402

BENCH_DIR = os.path.join(REPO, "tests", "fixtures", "benchmark")
RESULTS_PATH = os.path.join(REPO, "tests", "benchmark_results.json")

# ---------------------------------------------------------------------------
# PRE-REGISTERED EXPECTATIONS (fixed before running the benchmark)
# Ground truth from independent visual inspection of each image's pixels.
# ---------------------------------------------------------------------------
EXPECTED = {
    "01_genuine_500_specimen.jpg": {
        "kind": "currency", "country": "india", "denom": r"500",
        "status": "SUSPICIOUS",
        "why": "Official SPECIMEN ₹500 front with red SPECIMEN overprint and "
               "all-zero serials: non-circulating markers must be flagged, "
               "but it is an official print, not a forgery.",
    },
    "02_genuine_500_reverse.jpg": {
        "kind": "currency", "country": "india", "denom": r"500",
        "status": "SUSPICIOUS",
        "why": "Official SPECIMEN ₹500 reverse with red SPECIMEN overprint; "
               "same non-circulating markers as the front.",
    },
    "03_fake_500.jpg": {
        "kind": "currency", "country": "india", "denom": r"500",
        "status": "LIKELY_COUNTERFEIT",
        "why": "Trimmed printout with white cut-out paper borders lying on "
               "SBI bank paperwork: classic photocopy/cut-out scene.",
    },
    "04_india_100.jpg": {
        "kind": "coin", "country": "india", "denom": r"(^|\D)5($|\D)",
        "status": "LIKELY_GENUINE",
        "why": "Photo of a standard circulation ₹5 coin (obverse), crisp "
               "strike and correct lettering, no anomalies.",
    },
    "05_india_120.jpg": {
        "kind": "coin", "country": "india", "denom": r"(^|\D)5($|\D)",
        "status": "LIKELY_GENUINE",
        "why": "Second photo of a standard ₹5 coin under harder lighting; "
               "no visible defects.",
    },
    "06_india_20.jpg": {
        "kind": "coin", "country": "india", "denom": r"(^|\D)5($|\D)",
        "status": "LIKELY_GENUINE",
        "why": "Heavily circulated ₹5 coin with tarnish; wear is consistent "
               "with genuine coin, nothing suggests a fake.",
    },
    "07_coin.jpg": {
        "kind": "coin", "country": r"united states|usa|u\.s\.|america",
        "denom": r"quarter|25\s*cent",
        "status": "LIKELY_GENUINE",
        "why": "US Washington quarter (mint mark D), correct legends and "
               "circulated wear; dealer stock photo with watermark only.",
    },
    "08_foreign_note.jpg": {
        "kind": "currency", "country": r"united states|usa|u\.s\.",
        "denom": r"\$1|\b1\b.*dollar|dollar.*\b1\b|one dollar",
        "status": "LIKELY_GENUINE",
        "why": "Flat scan of a Series 2009 US$1 note; every visible design "
               "element matches a genuine note, no anomalies.",
    },
    "09_noncurrency.png": {
        "empty": True,
        "status": None,
        "why": "Synthetic graphic that says NOT A BANKNOTE - TEST IMAGE: "
               "the engine must return no items and authenticity=null.",
    },
    "10_poor_quality.jpg": {
        "empty_or_unable": True,
        "status": "UNABLE_TO_VERIFY",
        "why": "~170px pixelated thumbnail: nothing legible, the only honest "
               "verdict is abstention (no items, or UNABLE_TO_VERIFY).",
    },
}


def data_url(path: str) -> str:
    with open(path, "rb") as fh:
        raw = fh.read()
    ext = os.path.splitext(path)[1].lower()
    mime = "image/png" if ext == ".png" else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")


def score_image(name: str, spec: dict, result: dict) -> tuple[bool, bool, str]:
    items = result.get("items") or []
    auth = result.get("authenticity")
    auth_status = auth.get("status") if isinstance(auth, dict) else None

    # --- identification ---
    if spec.get("empty"):
        ident_ok = (len(items) == 0)
        ident_note = "expected no items" + ("" if ident_ok else f", got {len(items)}")
    elif spec.get("empty_or_unable"):
        ident_ok = (len(items) == 0) or (auth_status == "UNABLE_TO_VERIFY")
        ident_note = ("abstained" if ident_ok else
                      f"made a claim (items={len(items)}, status={auth_status})")
    else:
        first = items[0] if items else {}
        kind = str(first.get("kind") or "")
        hay = " ".join(str(first.get(k) or "") for k in
                       ("name", "country", "denomination", "currencyName")).lower()
        kind_ok = kind == spec["kind"]
        country_ok = re.search(spec["country"], hay) is not None
        denom_ok = re.search(spec["denom"], hay) is not None
        ident_ok = bool(items) and kind_ok and country_ok and denom_ok
        ident_note = (f"kind={kind or '-'} country_ok={country_ok} "
                      f"denom_ok={denom_ok} name={first.get('name', '-')}")

    # --- authenticity ---
    if spec.get("empty"):
        auth_ok = (auth is None)
        auth_note = f"authenticity={auth!r} (expected null)"
    elif spec.get("empty_or_unable"):
        auth_ok = auth_status in ("UNABLE_TO_VERIFY", None)
        auth_note = f"status={auth_status!r}"
    else:
        auth_ok = auth_status == spec["status"]
        auth_note = f"status={auth_status!r} expected={spec['status']!r}"
    return ident_ok, auth_ok, f"{ident_note} | {auth_note}"


def main():
    files = sorted(os.listdir(BENCH_DIR))
    files = [f for f in files if os.path.splitext(f)[1].lower() in (".jpg", ".png")]
    if len(files) != 10:
        print(f"ERROR: expected exactly 10 benchmark images, found {len(files)}")
        sys.exit(2)
    missing = [f for f in files if f not in EXPECTED]
    if missing:
        print(f"ERROR: images without pre-registered expectations: {missing}")
        sys.exit(2)

    # Force real upstream calls for every image (no memoized earlier results).
    ai._IDENTIFY_CACHE.clear()

    print("== 10-image Gemini free-tier benchmark (identify engine) ==")
    print(f"model: {ai._assert_free_only(__import__('config').GEMINI_MODEL)}\n")

    rows = []
    ident_score = auth_score = 0
    for i, fname in enumerate(files, 1):
        spec = EXPECTED[fname]
        path = os.path.join(BENCH_DIR, fname)
        t0 = time.time()
        error = None
        result = None
        try:
            result = ai.identify(data_url(path))
        except ai.AIError as exc:
            error = str(exc)
        latency = time.time() - t0

        if error is not None:
            ident_ok = auth_ok = False
            note = f"AIError: {error}"
        else:
            ident_ok, auth_ok, note = score_image(fname, spec, result)
        ident_score += 1 if ident_ok else 0
        auth_score += 1 if auth_ok else 0

        mark_id = "OK" if ident_ok else "MISS"
        mark_au = "OK" if auth_ok else "MISS"
        print(f"[{i:2d}/10] {fname}")
        print(f"         expect: {spec['why']}")
        print(f"         ident={mark_id} auth={mark_au} "
              f"({latency:.1f}s, model={ai.LAST_RESOLVED_MODEL})")
        print(f"         {note}")
        rows.append({
            "image": fname,
            "expectation": spec["why"],
            "expected_status": spec.get("status"),
            "identification_ok": ident_ok,
            "authenticity_ok": auth_ok,
            "latency_s": round(latency, 1),
            "resolved_model": ai.LAST_RESOLVED_MODEL,
            "error": error,
            "items": (result or {}).get("items"),
            "authenticity": (result or {}).get("authenticity"),
            "detail": note,
        })
        # Pace requests to stay inside free-tier per-minute limits.
        if i < len(files):
            time.sleep(6)

    ident_pct = 100.0 * ident_score / 10
    auth_pct = 100.0 * auth_score / 10
    both = sum(1 for r in rows if r["identification_ok"] and r["authenticity_ok"])
    print("\n" + "=" * 60)
    print(f"IDENTIFICATION ACCURACY : {ident_score}/10 ({ident_pct:.0f}%)")
    print(f"AUTHENTICITY ACCURACY   : {auth_score}/10 ({auth_pct:.0f}%)")
    print(f"BOTH CORRECT            : {both}/10 ({100.0 * both / 10:.0f}%)")
    print("=" * 60)
    for r in rows:
        if not (r["identification_ok"] and r["authenticity_ok"]):
            print(f"  MISS: {r['image']} :: {r['detail']}")

    with open(RESULTS_PATH, "w", encoding="utf-8") as fh:
        json.dump({
            "model": ai.LAST_RESOLVED_MODEL,
            "identification": f"{ident_score}/10",
            "authenticity": f"{auth_score}/10",
            "both": f"{both}/10",
            "rows": rows,
        }, fh, ensure_ascii=False, indent=2)
    print(f"\nresults written to {RESULTS_PATH}")
    sys.exit(0 if both == 10 else 1)


if __name__ == "__main__":
    main()
