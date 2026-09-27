"""Server-side Google Gemini AI proxy: identification + authenticity + chatbot.

The Gemini API key lives only in backend/.env (config.GEMINI_API_KEY)
and is never returned to the browser. Only FREE-TIER models are allowed
(the backend refuses anything outside the verified free allowlist).

Pipeline (mandatory):
  USER IMAGE (data URL) -> GEMINI VISION API (inline image bytes) ->
  IDENTIFICATION + FACTUAL OBSERVATIONS -> authenticity policy -> RESULT

Authenticity policy (important):
- Authenticity analysis runs ONLY when an image was uploaded and the vision
  API returned at least one physical coin/banknote. Empty/non-currency
  results return authenticity=null — no assessment is invented.
- Never derive authenticity from filename, prior chat turns, match %, or
  stored metadata. The vision model must receive the raw image pixels.
- Recognition confidence (match %) ONLY reflects object/class identification.
- Authenticity is a SEPARATE, evidence-based visual assessment with exactly
  four statuses: LIKELY_GENUINE, SUSPICIOUS, LIKELY_COUNTERFEIT,
  UNABLE_TO_VERIFY.
- Image analysis can NEVER produce VERIFIED_AUTHENTIC (there is no forensic/
  laboratory authentication in this project).
- identify() is the SINGLE analysis engine: the main /ai/identify endpoint and
  the chatbot's image flow both call it with the uploaded image, so both always
  report the same result. Cache is keyed by image content hash (memoizes a
  prior vision-API result for the identical pixels — not metadata).
- No hardcoded test images or denomination special-cases.
"""

import base64
import copy
import hashlib
import json
import re
import time

import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types

import config

MAX_IMAGE_BYTES = 6 * 1024 * 1024  # 6 MB decoded image cap

# identify() cache: image-content-hash -> (timestamp, result).
_IDENTIFY_CACHE: dict[str, tuple[float, dict]] = {}
_IDENTIFY_CACHE_TTL = 1800  # 30 minutes
_IDENTIFY_CACHE_MAX = 64

AUTH_STATUSES = ("LIKELY_GENUINE", "SUSPICIOUS", "LIKELY_COUNTERFEIT", "UNABLE_TO_VERIFY")
# Severity used to combine multiple detected items (worst status wins).
_AUTH_SEVERITY = {
    "LIKELY_GENUINE": 0,
    "UNABLE_TO_VERIFY": 1,
    "SUSPICIOUS": 2,
    "LIKELY_COUNTERFEIT": 3,
}
_AUTH_LABELS = {
    "LIKELY_GENUINE": "Likely genuine",
    "SUSPICIOUS": "Suspicious",
    "LIKELY_COUNTERFEIT": "Likely counterfeit",
    "UNABLE_TO_VERIFY": "Unable to verify",
}
_AUTH_DISCLAIMER = (
    " Assessment is based on image analysis only and does not replace physical "
    "or forensic authentication."
)

IDENTIFY_PROMPT = """You are an expert numismatist vision analyst. The attached image may contain ONE OR MORE collectible objects: coins and/or paper currency notes (banknotes). Identify EVERY coin and EVERY currency note visible - one object per item - AND record factual visual observations for authenticity assessment.

Return a JSON ARRAY of item objects (and nothing else, no markdown), one element per detected item.

For kind = "coin", use ONLY these fields:
{
  "kind": "coin",
  "name": "Coin name (e.g. '10 Rupees (₹10)')",
  "country": "Country of origin",
  "year": "Year or era (e.g. '2010 – Present')",
  "denomination": "Denomination (e.g. '10 Rupees (₹10)')",
  "composition": "Metal composition (e.g. 'Bimetallic\\n(Cu-Ni center, Al-Bronze ring)')",
  "weight": "Weight (e.g. '7.71 grams')",
  "diameter": "Diameter (e.g. '27 mm')",
  "obverse": "Obverse description (e.g. 'Ashoka Lion Capital\\n(Satyameva Jayate)')",
  "reverse": "Reverse description (e.g. '₹10 with decorative rays')",
  "description": "A brief 2-3 sentence description of the coin",
  "rarity": "Common, Uncommon, Rare, or Very Rare",
  "estimatedValue": "Estimated market value range in USD (e.g. '$1 – $15')",
  "type": "One of: rupee10, rupee1, eic, tetradrachm, morgan, drape, anna, sestertius, commem, kushan",
  "match": 92,
  "confidence": "low, medium, or high",
  "observations": { ...see OBSERVATIONS SCHEMA... }
}

For kind = "currency", use ONLY these fields:
{
  "kind": "currency",
  "name": "Note name (e.g. '100 Indian Rupees Note')",
  "country": "Country of issue (e.g. 'India')",
  "currencyName": "Currency unit (e.g. 'Indian Rupee', 'US Dollar')",
  "denomination": "Denomination (e.g. '100 Indian Rupees (₹100)')",
  "series": "Series/theme (e.g. 'Mahatma Gandhi New Series 2016')",
  "year": "Series year or era (e.g. '2016 – Present')",
  "front": "Front design description",
  "back": "Back design description",
  "description": "A brief 2-3 sentence description of the note",
  "rarity": "Common or Collectible",
  "estimatedValue": "Estimated collector value range in USD",
  "match": 90,
  "confidence": "low, medium, or high",
  "observations": { ...see OBSERVATIONS SCHEMA... }
}

=== RECOGNITION (do not confuse with authenticity) ===
- "match" / "confidence" = RECOGNITION confidence only: how sure you are of WHAT the object is. It says NOTHING about genuineness. 90% recognition never means "90% genuine".
- You do NOT choose an authenticity status. You only record honest factual observations from the pixels; a separate step maps observations to a status.

=== OBSERVATIONS SCHEMA (include under "observations" for EVERY item) ===
Answer each field ONLY from what is actually visible in THIS image. Use true/false. Use null only when truly impossible to judge. Never guess a security feature you cannot see.

Common fields (coins AND notes):
{
  "is_physical_object": true,            // true = photo of a real physical coin/note; false = drawing, 3D render, UI screenshot, wallpaper, logo
  "blur_prevents_assessment": false,     // true if blur/pixelation/glare is so bad you cannot judge colour mode, copy artifacts, or security features
  "notes": "One short line: the single most notable visual fact (e.g. 'flat greyscale print with cut borders on a bank passbook')",
  "external_overlay_or_annotation": false, // true if text/graphics were added to the PHOTOGRAPH and are not physically part of the item (marker writing, watermark, highlight box, sticker); a stamp printed on the item itself (SPECIMEN overprint) is not this
  "overlay_compromises_assessment": false  // true if such an overlay crosses/covers the item or asserts a claim about it (e.g. FAKE/REAL written across) — the photo is then not a clean reference for physical authenticity; a small corner watermark that does not cover the item is false
}

Overlay rule: an overlay/annotation/watermark is NOT evidence that the physical item is counterfeit and its wording must never decide genuineness; equally, a normal-looking design under an overlay does NOT confirm the item is genuine. Judge authenticity only from the item's own physical characteristics.

Extra fields for kind = "currency":
{
  "monochrome_reproduction": false,
  // true if the BANKNOTE ITSELF (ignore background colour) is printed only in
  // black/grey/white tones like a photocopy or laser print of a note that
  // should have colour. Example TRUE: greyscale ₹500 photocopy where the note
  // shows no stone-grey/green ink, only black toner on white paper — even if
  // the photo's background (logos, ribbons) has colour. Example FALSE: a sharp
  // colour scan/photo of the stone-grey ₹500 (muted colour is still colour).
  // When you see ANY black toner-only rendering of the note, set true.
  "paper_cut_or_registration_marks": false,
  // true if ANY of these appear with the note: black printer registration /
  // alignment tick marks along an edge, crop/cut marks, white paper cut-out
  // border or margin framing the note shape, halftone dot pattern, the note
  // clearly cut out and laid/pasted on other paper. Example TRUE: photocopied
  // note with short black alignment lines on the left edge and white cut
  // borders. A clean straight photo edge of an isolated note = false.
  "lying_on_unrelated_objects": false,
  // true if the note (or its copy) is photographed lying on unrelated items
  // (bank passbooks, ledgers, forms, books, desks) rather than held/isolated.
  "specimen_or_sample_stamp": false,     // true if a literal 'SPECIMEN' / 'SAMPLE' / 'OVERPRINT' text stamp is visible on the note
  "color_scheme_plausible": null,        // false only if the note's colour is clearly WRONG for the identified series (e.g. note that should be green appears orange); true if colours look right; null if cannot judge. For a greyscale photocopy use null or false — do NOT say true just because you cannot see colour.
  "series_design_mismatch": false,       // true only if the printed design clearly does NOT match the series/year you claimed (wrong portrait layout, wrong monument, etc.)
  "serial_number_anomaly": false,        // true only if serials are visibly missing, garbled, overlapping, or hand-added where they should be printed
  "cut_paste_overlay_tape": false,       // true if you see cut/paste seams, overlay panels, tape, lamination bubbles, or erasure on the note
  "enough_detail_to_judge_features": false // true if thread/watermark/microprint area is at least partially visible and sharp enough to inspect
}

Extra fields for kind = "coin":
{
  "monochrome_or_bad_photo": false,      // true if image is greyscale photocopy-style or too degraded to see the coin surface properly
  "casting_or_plating_defects": false,   // true only if you SEE casting seams, porous surface, plating bubbles/peeling - NOT normal wear
  "design_matches_denomination": null    // true/false/null: does the visible design match the denomination you claimed?
}

Before writing the JSON, run this photocopy check explicitly: Look at ONLY the banknote region. Is it made of continuous-tone colour ink (even if muted), or does it look like black/grey toner on paper (photocopy/printout)? Do you see black alignment ticks, white cut-out borders, or the note laid on a passbook/ledger? If YES to a toner-only note OR cut/registration borders, set monochrome_reproduction and/or paper_cut_or_registration_marks to true. Then also answer: real photo vs artwork? SPECIMEN stamp? colour correct for series? design matches series? serials OK? damage/cut-paste? quality good enough to judge?

If the image contains no physical coin or banknote (artwork, scenery, UI screenshot, decorative graphic, pure illustration), return [] .
Return ONLY the JSON array, no extra text."""

# Second, SHORT vision pass: forced observation questionnaire only.
# The main prompt is long and the model often omits the currency-specific
# observation keys; this dedicated call fills them reliably.
OBSERVE_PROMPT = """Look at the banknote/coin in this image and answer a fixed authenticity questionnaire. Return ONLY one JSON object, no markdown, with EXACTLY these keys (all required):

{
  "is_physical_object": true,
  "blur_prevents_assessment": false,
  "notes": "one short line describing the most notable visual fact",
  "monochrome_reproduction": false,
  "paper_cut_or_registration_marks": false,
  "lying_on_unrelated_objects": false,
  "specimen_or_sample_stamp": false,
  "color_scheme_plausible": null,
  "series_design_mismatch": false,
  "serial_number_anomaly": false,
  "cut_paste_overlay_tape": false,
  "enough_detail_to_judge_features": false,
  "monochrome_or_bad_photo": false,
  "casting_or_plating_defects": false,
  "design_matches_denomination": null,
  "on_bank_documents": false,
  "cut_out_with_borders": false,
  "registration_ticks": false,
  "toner_only_note": false,
  "note_has_natural_texture": false,
  "external_overlay_or_annotation": false,
  "overlay_compromises_assessment": false,
  "overlay_description": ""
}

Field rules:
- is_physical_object: false if artwork, 3D render, UI screenshot, wallpaper, or logo; true if a photo of a real physical coin/banknote.
- blur_prevents_assessment: true only if blur/pixelation/glare blocks judging colour, copy artifacts, or features.
- monochrome_reproduction: true if the BANKNOTE itself is black/grey toner only (photocopy/printout of a note that should have colour). Background colour does not matter. A sharp colour photo (even muted stone-grey ink) is false.
- paper_cut_or_registration_marks: true if black registration/alignment tick marks, crop/cut marks, white cut-out paper borders framing the note, or halftone dots are visible with the note.
- lying_on_unrelated_objects: true if the note lies on passbooks, ledgers, forms, books, or a desk (not held isolated).
- specimen_or_sample_stamp: true if literal text SPECIMEN/SAMPLE/OVERPRINT is printed on the note.
- color_scheme_plausible: false only if note colour is clearly wrong for its series; true if colours look right; null if cannot judge (including pure greyscale copies).
- series_design_mismatch: true if the printed design clearly contradicts the visible denomination/series — for example a portrait showing a DIFFERENT person or subject than the official design for that note (an actor's face instead of the statesman), or a novelty/custom-printed subject — even when the denomination text itself matches. A genuine note whose portrait and layout match the official design is false.
- serial_number_anomaly: true only if serials missing, garbled, overlapping, or hand-added.
- cut_paste_overlay_tape: true only if cut/paste seams, overlay, tape, or erasure visible ON the note.
- enough_detail_to_judge_features: true if the note/coin is sharp enough to inspect security features or surface (thread area, watermark area, microprint, or coin relief). A clean high-res scan of a note = true. Heavy blur = false.
- monochrome_or_bad_photo (coins): true if greyscale photocopy-style or surface unreadable.
- casting_or_plating_defects (coins): true only if casting seams, porosity, plating bubbles/peeling are VISIBLE (normal wear = false).
- design_matches_denomination (coins): true/false/null whether visible design matches the claimed denomination.
- on_bank_documents: a bank passbook, account statement, ledger, or bank form is visible UNDER or AROUND the note (readable bank name, account fields, branch text, logo). Plain white/green paper alone is false.
- cut_out_with_borders: the note shape is framed by a white paper cut-out margin (scissors/cut border), i.e. the note was cut from a sheet and laid down.
- registration_ticks: short black parallel printer alignment lines along the note paper edge.
- toner_only_note: the note area itself is black/grey toner only — no stone-grey/green note ink visible. Ignore colour in background/documents.
- note_has_natural_texture: real cotton-note fibre, embossing, or natural shadow on the NOTE surface (flat printed paper = false).
- Image annotation vs item — keep these three strictly separate: (1) characteristics of the physical coin/banknote itself, (2) text/watermarks/labels/stamps/annotations added to the PHOTOGRAPH (marker writing, seller watermark or logo, highlight box, sticker, words such as FAKE or REAL written over the image), and (3) visual evidence that the physical item itself is counterfeit.
- external_overlay_or_annotation: true if text or graphics were added to the photograph and are NOT physically part of the item (handwritten/marker text over the photo, digital watermark or logo, highlight box, arrow, sticker text). A stamp that is part of the item's own printing (e.g. a SPECIMEN overprint on the note) is NOT this — use specimen_or_sample_stamp for that.
- overlay_compromises_assessment: true if such an overlay crosses or covers the item, or asserts a claim about it — for example large words like FAKE or REAL written across the coin/note — so this photo is not a clean reference for judging the physical item. Any verdict-claim written over the item (FAKE/REAL/REPLICA etc.) makes this true. A small corner watermark or logo that does not cover the item is false.
- overlay_description: one short phrase naming the overlay, e.g. "red FAKE written across the coin face", "small dealer watermark bottom-right".
- Overlay rules: an overlay/annotation/watermark is NOT evidence that the physical item is counterfeit, and its wording must never decide the verdict (never set casting_or_plating_defects, series_design_mismatch, or copy/artifact flags merely because of an overlay). Equally, a normal-looking design under an overlay must NOT be treated as confirming the item is genuine — judge authenticity only from the item's own physical characteristics.
- Consistency rule (overlays): if your notes mention an overlay, marker text, watermark, highlight, or label added to the photo, external_overlay_or_annotation MUST be true; if that overlay crosses the item or claims something about it, overlay_compromises_assessment MUST be true — never describe an overlay in text while marking its flag false.
- Photocopy scene = on_bank_documents AND cut_out_with_borders. A SPECIMEN/SAMPLE stamp alone does NOT mean photocopy.
- Consistency rule: your boolean flags must agree with your own observations. If your notes/description mention a novelty, replica, custom print, wrong portrait, or documents/passbooks under the note, the matching flags (series_design_mismatch, on_bank_documents, lying_on_unrelated_objects, ...) MUST be set accordingly — never describe something in text while marking its flag false.

Photocopy check (do this first for banknotes): Is the note region toner-only greyscale with cut borders or alignment ticks, possibly lying on a bank passbook/ledger? If yes, set monochrome_reproduction and/or paper_cut_or_registration_marks to true. Do not mark colour_scheme_plausible=true for a greyscale photocopy.

Return ONLY the JSON object."""

# Ultra-short vision pass: structured scene questions. Stable across runs and
# correctly separates a cut-out photocopy on a bank passbook from a clean
# official scan (SPECIMEN stamp alone is NOT copy evidence).
PHOTOCOPY_PROMPT = """Answer ONLY this JSON about the banknote image (no markdown, no other text):
{"on_bank_documents": true/false,
 "cut_out_with_borders": true/false,
 "registration_ticks": true/false,
 "toner_only_note": true/false,
 "note_has_natural_texture": true/false,
 "evidence": "one short sentence"}

Definitions:
- on_bank_documents: a bank passbook, account statement, ledger, or bank form is visible UNDER or AROUND the note (readable bank name, account fields, branch text, logo). Plain white/green paper alone is false.
- cut_out_with_borders: the note shape is framed by a white paper cut-out margin (scissors/cut border), i.e. the note was cut from a sheet and laid down.
- registration_ticks: short black parallel printer alignment lines along the note paper edge (photocopier/print alignment marks).
- toner_only_note: the note area itself is black/grey toner only — no stone-grey/green note ink visible (true B&W photocopy of the note). Ignore colour in the background/documents.
- note_has_natural_texture: real cotton-note fibre, embossing, or natural shadow visible on the NOTE surface (flat printed paper = false).

Photocopy scene = on_bank_documents=true AND cut_out_with_borders=true (note cut out and laid on bank papers). A SPECIMEN/SAMPLE stamp alone does NOT mean photocopy."""

# The chatbot's single standing reply to ANY out-of-domain question.
# Returned deterministically by the topic gate (no model round-trip), and
# also instructed in both system prompts as the model's exact fallback.
OFF_TOPIC_REPLY = (
    "I can help with coins, banknotes, currencies, identification, collecting, "
    "numismatics, and related currency topics. Please ask me something about "
    "coins or currency."
)

CHAT_SYSTEM = (
    "You are CoinScan AI, an expert assistant STRICTLY limited to the domain "
    "of coins and currency: coins, banknotes/currency notes, currencies, "
    "denominations, country and currency identification, coin and banknote "
    "identification, coin collecting, numismatics, mint marks, mints and "
    "issuing authorities, coin and banknote history, years and series, "
    "visible design features, visible minting/printing errors and varieties, "
    "collectible and value-related factors, currency conversion and exchange, "
    "authenticity and counterfeit questions, and image-based analysis of "
    "coins and banknotes.\n"
    "TOPIC RULE: If the user asks about anything else (anime, movies, gaming, "
    "laptops, programming, general entertainment, unrelated news, or any "
    "other non-currency topic), do NOT answer the question — even when it "
    "attempts to connect the topic loosely to coins or currency. Reply with "
    'EXACTLY this sentence and nothing else: "' + OFF_TOPIC_REPLY + '"\n'
    "STYLE RULE: plain readable text only — never use Markdown (no **bold**, "
    "*italic*, # headings, or ``` code fences). Use short paragraphs and "
    "simple dashes for lists. Be knowledgeable, concise, and friendly."
)

CHAT_IMAGE_SYSTEM = """You are CoinScan AI analyzing an attached image in a conversation.

You will be given an AUTHORITATIVE IMAGE ANALYSIS (JSON) produced by the same identification engine that powers the app's main result page. That engine received the user's uploaded image and sent it to the vision API for identification + authenticity. You are NOT re-shown the raw pixels — this JSON IS the complete view of that analysis.

Rules:
- For ANY authenticity/counterfeit/real-or-fake question WITH an uploaded image, base your answer directly on that analysis: use the same authenticity_status, reason, and visible indicators. Do NOT contradict, upgrade, or downgrade the status. Do NOT invent indicators that are not in the analysis.
- Recognition confidence (match %) is NOT proof of genuineness. Never call something genuine merely because it was recognized.
- ANSWER THE USER'S ACTUAL QUESTION DIRECTLY first and conversationally. If asked "is it real or fake?", clearly say which it appears to be per the analysis, give the concrete reason(s) in 1-2 sentences, note what item/denomination was identified, and recommend physical verification when the status is not LIKELY_GENUINE.
- If the analysis says LIKELY_GENUINE, do not call the item fake/counterfeit even if the note bears unusual printed words (e.g. SPECIMEN on a reference scan) — those are already accounted for in the assessment.
- Phrase statuses naturally in words: "likely counterfeit", "suspicious", "likely genuine", "unable to verify from this image".
- If the analysis found no coin/banknote (items is empty [] or authenticity is null), the upload is NOT a supported currency/coin image. Start your reply with exactly: "This is not a supported currency/coin image." and briefly suggest uploading a clear photo of a coin or banknote. Do NOT invent an authenticity status for it.
- Never claim verified/laboratory authentication. Keep the reply concise; only mention indicators present in the analysis.
- If the user asks a non-authenticity question (history, value, mint marks, etc.), answer conversationally using the analysis and your numismatic knowledge.
- Text-only messages (no new image in this turn and no injected analysis) are normal Q&A: answer from numismatic knowledge and NEVER fabricate a per-image authenticity verdict.
- TOPIC RULE: the conversation stays strictly on coins and currency (coins, banknotes, currencies, denominations, identification, collecting, numismatics, mint marks, history, series, design features, errors and varieties, value factors, conversion and exchange, authenticity, image analysis). If the user's question is about anything else (anime, movies, gaming, laptops, programming, general entertainment, unrelated news, or any other non-currency subject), do NOT answer it even when it could be loosely connected to coins — the injected analysis does not change this. Reply with EXACTLY this sentence and nothing else: \"""" + OFF_TOPIC_REPLY + """\"
- STYLE RULE: plain readable text only — never use Markdown (no **bold**, *italic*, # headings, or ``` code fences)."""


class AIError(Exception):
    """Raised when the upstream AI call fails or the key is missing."""


# Last Gemini model id actually served (diagnostics only).
LAST_RESOLVED_MODEL: str | None = None

# Verified $0 free-tier Gemini vision models (Google's official pricing page
# lists input+output as "Free of charge"; all accept image input).
# Used as in-process failover when the primary model errors or returns
# empty/non-JSON content. NEVER append a paid model here.
_VERIFIED_FREE_GEMINI_MODELS = (
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
)

# Per-attempt / overall time budgets (free models are slow; never hang).
_IDENTIFY_TIME_BUDGET_S = 70.0
_CHAT_TIME_BUDGET_S = 60.0
_PER_ATTEMPT_TIMEOUT_S = 28.0
_MIN_PER_ATTEMPT_TIMEOUT_S = 10.0

# Clean user-facing messages (never raw Python tracebacks / model dumps).
USER_MSG_ANALYSIS_FAILED = (
    "Sorry, I couldn't reliably analyze this image right now. "
    "Please try again with a clearer image."
)
USER_MSG_UNSUPPORTED = (
    "This is not a supported currency/coin image, so I can't identify or authenticate it."
)
USER_MSG_QUOTA = (
    "The free AI service is temporarily rate-limited. Please try again in a few minutes."
)
USER_MSG_CHAT_FAILED = (
    "Sorry, I couldn't get a response right now. Please try again in a moment."
)
USER_MSG_KEY_MISSING = (
    "The AI service is not configured on the server (missing GEMINI_API_KEY)."
)
USER_MSG_KEY_REJECTED = (
    "The AI service rejected the configured API key. "
    "Check GEMINI_API_KEY in backend/.env."
)
# Clean messages that identify()/chat() must pass through unchanged.
_PASSTHROUGH_MESSAGES = (
    USER_MSG_ANALYSIS_FAILED,
    USER_MSG_QUOTA,
    USER_MSG_CHAT_FAILED,
    USER_MSG_KEY_MISSING,
    USER_MSG_KEY_REJECTED,
)


def _assert_free_only(model: str) -> str:
    """Reject any model outside the verified FREE-tier allowlist."""
    m = (model or "").strip().lower()
    if not m:
        raise AIError("GEMINI_MODEL is empty — free model routing required.")
    if m.startswith("models/"):
        m = m[len("models/"):]
    if m in _VERIFIED_FREE_GEMINI_MODELS:
        return m
    raise AIError(
        f"Refusing non-free/unsupported model '{model}'. "
        "Set GEMINI_MODEL to a verified free-tier model: "
        + ", ".join(_VERIFIED_FREE_GEMINI_MODELS)
        + "."
    )


def _free_model_queue() -> list[str]:
    """Primary free model first, then the other verified free-tier models."""
    primary = _assert_free_only(config.GEMINI_MODEL)
    queue = [primary]
    for m in _VERIFIED_FREE_GEMINI_MODELS:
        if m not in queue:
            queue.append(m)
    return queue


# Free-router content-safety stubs — not usable as chat/vision answers.
_NON_ANSWER_PREFIXES = ("user safety:", "safe", "content safety:")


def _try_json_loads(text: str):
    """Parse JSON with light repairs (trailing commas). Returns object or None."""
    if not text:
        return None
    candidates = [text]
    repaired = re.sub(r",\s*([}\]])", r"\1", text)
    if repaired != text:
        candidates.append(repaired)
    for cand in candidates:
        try:
            return json.loads(cand)
        except (json.JSONDecodeError, ValueError):
            continue
    return None


def _balanced_slice(text: str, open_ch: str, close_ch: str) -> str | None:
    """Return the first balanced {...} or [...] slice starting at open_ch."""
    start = text.find(open_ch)
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    # Truncated output: attempt to close open structures.
    fragment = text[start:]
    opens = fragment.count(open_ch) - fragment.count(close_ch)
    if opens > 0 and len(fragment) < 20000:
        closed = fragment + (close_ch * opens)
        return closed
    return None


def parse_model_json(raw: str):
    """Safely extract JSON (array or object) from free-model output.

    Free models routinely return: markdown fences, prose around the JSON,
    trailing commas, or truncated bodies. Returns a list (items) when the
    payload is an item array / single item object, a dict when the payload
    is a questionnaire-style object, or None when nothing valid is found.
    """
    if not isinstance(raw, str) or not raw.strip():
        return None
    text = raw.strip()

    # 1. Markdown fences (```json ... ```).
    fence = re.search(r"```(?:json|JSON)?\s*([\s\S]*?)```", text)
    if fence:
        inner = fence.group(1).strip()
        parsed = _try_json_loads(inner)
        if parsed is not None:
            return _shape_json(parsed)

    # 2. Direct parse of the whole body.
    parsed = _try_json_loads(text)
    if parsed is not None:
        return _shape_json(parsed)

    # 3. First balanced array or object (handles surrounding prose).
    for open_ch, close_ch in (("[", "]"), ("{", "}")):
        slice_text = _balanced_slice(text, open_ch, close_ch)
        if slice_text:
            parsed = _try_json_loads(slice_text)
            if parsed is not None:
                return _shape_json(parsed)

    # 4. Regex fallback (last resort; may fail on nested strings).
    m = re.search(r"\[[\s\S]*\]", text)
    if m:
        parsed = _try_json_loads(m.group(0))
        if parsed is not None:
            return _shape_json(parsed)
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        parsed = _try_json_loads(m.group(0))
        if parsed is not None:
            return _shape_json(parsed)
    return None


def _shape_json(parsed):
    """Normalize parsed JSON into items-list or dict form for callers."""
    if isinstance(parsed, dict) and isinstance(parsed.get("items"), list):
        return parsed["items"]
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        # Single item-ish object (has name/kind/observations) vs questionnaire.
        if any(k in parsed for k in ("kind", "name", "observations", "denomination")):
            return [parsed]
        return parsed
    return None


def _looks_like_json(content: str) -> bool:
    return parse_model_json(content) is not None


def _is_usable_reply(content: str, require_json: bool) -> bool:
    c = (content or "").strip()
    if not c:
        return False
    low = c.lower()
    if any(low.startswith(p) for p in _NON_ANSWER_PREFIXES) and len(c) < 80:
        return False
    if require_json and not _looks_like_json(c):
        return False
    return True


def _quota_limited(detail: str) -> bool:
    """True only for Gemini's DAILY free-tier quota (not per-minute blips)."""
    d = (detail or "").lower()
    return (
        "per day" in d
        or "per-day" in d
        or "requests per day" in d
        or "daily" in d
    )


def _split_data_url(data_url: str) -> tuple[str, str] | None:
    """data:image/png;base64,XXXX -> ("image/png", "XXXX"). None if invalid."""
    m = re.match(r"^data:([^;,]+)(?:;[^,]*)?,(.+)$", data_url, re.DOTALL)
    if not m:
        return None
    return m.group(1).strip().lower(), m.group(2)


def _messages_to_gemini(messages) -> tuple[str, list]:
    """Translate OpenAI-style messages -> (system_instruction, contents).

    Supports string content, text parts, and image_url data URLs (the only
    image format the API layer accepts — see _validate_image_data_url).
    """
    system_chunks: list[str] = []
    contents: list = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        role = m.get("role", "user")
        content = m.get("content")
        parts: list = []
        if isinstance(content, str):
            if content.strip():
                parts.append(genai_types.Part.from_text(text=content))
        elif isinstance(content, list):
            for c in content:
                if not isinstance(c, dict):
                    continue
                if c.get("type") == "text":
                    txt = c.get("text") or ""
                    if txt:
                        parts.append(genai_types.Part.from_text(text=txt))
                elif c.get("type") == "image_url":
                    url = ((c.get("image_url") or {}).get("url")) or ""
                    split = _split_data_url(url) if url.startswith("data:") else None
                    if split is None:
                        raise AIError(USER_MSG_UNSUPPORTED)
                    mime, b64 = split
                    try:
                        raw = base64.b64decode(b64)
                    except (ValueError, TypeError) as exc:
                        raise AIError("Invalid image: bad base64 payload.") from exc
                    if len(raw) > MAX_IMAGE_BYTES:
                        raise AIError("Image is too large (max 6 MB after encoding).")
                    parts.append(genai_types.Part.from_bytes(data=raw, mime_type=mime))
        if not parts:
            continue
        if role == "system":
            system_chunks.extend(
                p.text for p in parts if getattr(p, "text", None)
            )
        elif role == "assistant":
            contents.append(genai_types.Content(role="model", parts=parts))
        else:
            contents.append(genai_types.Content(role="user", parts=parts))
    return "\n\n".join(system_chunks), contents


_GEMINI_CLIENT: genai.Client | None = None


def _gemini_client() -> genai.Client:
    """Lazy singleton Gemini client (key/endpoint read from config)."""
    global _GEMINI_CLIENT
    if _GEMINI_CLIENT is None:
        http_opts = {}
        if config.GEMINI_API_URL:
            # Tests/proxies only: point the SDK at a local fake upstream.
            http_opts["base_url"] = config.GEMINI_API_URL
        _GEMINI_CLIENT = genai.Client(
            api_key=config.GEMINI_API_KEY,
            http_options=genai_types.HttpOptions(**http_opts),
        )
    return _GEMINI_CLIENT


def _response_text(resp) -> tuple[str, str | None]:
    """Extract (text, finish_reason) from a GenerateContentResponse safely."""
    finish: str | None = None
    chunks: list[str] = []
    try:
        pf = getattr(resp, "prompt_feedback", None)
        if pf is not None and getattr(pf, "block_reason", None):
            return "", f"blocked:{pf.block_reason}"
        for cand in getattr(resp, "candidates", None) or []:
            fr = getattr(cand, "finish_reason", None)
            if fr is not None:
                finish = str(fr)
            content = getattr(cand, "content", None)
            for part in (getattr(content, "parts", None) or []):
                txt = getattr(part, "text", None)
                if txt:
                    chunks.append(txt)
    except Exception:  # noqa: BLE001 - never surface SDK parsing noise
        return "", finish
    return "".join(chunks).strip(), finish


def _call_gemini(messages, max_tokens=1500, timeout=45, temperature=0.2,
                 retries=2, require_json=False, deadline: float | None = None,
                 fail_message: str | None = None) -> str:
    """Call the Gemini API using FREE-tier models only.

    Failover (require_json vision path):
      - Try each verified free model in the queue at most once per call.
      - Empty content, non-JSON, timeouts, 429/5xx, 404 -> next free model.
      - Daily free-tier 429 -> fail fast with a clean message (no storm).
      - NEVER falls back to a paid model. NEVER retries endlessly.
    """
    if not config.GEMINI_API_KEY:
        raise AIError(USER_MSG_KEY_MISSING)
    fail_msg = fail_message or (
        USER_MSG_ANALYSIS_FAILED if require_json else USER_MSG_CHAT_FAILED
    )
    # Thinking models spend output tokens reasoning before the answer:
    # give every attempt a generous floor.
    if max_tokens < 2000:
        max_tokens = 2000
    queue = _free_model_queue()
    if deadline is None:
        deadline = time.time() + max(float(timeout), 20.0)
    system_instruction, contents = _messages_to_gemini(messages)
    if not contents:
        raise AIError("No messages to send.")
    last_error: AIError | None = None
    # Vision JSON: rotate through the free queue but cap attempts so one
    # request cannot burn the whole daily free-tier budget.
    # Text/chat: a few rotates off the primary (retries + 1), still free-only.
    if require_json:
        steps = min(len(queue), 4)
    else:
        steps = min(retries + 1, len(queue))
    for step in range(steps):
        if time.time() >= deadline:
            raise AIError(fail_msg)
        model = queue[step % len(queue)]
        # Later attempts get more output headroom (thinking + answer).
        if require_json:
            tokens = min(max_tokens + step * 2000, 8192)
        else:
            tokens = min(max_tokens + step * 1000, 4096)
        remaining = deadline - time.time()
        attempt_timeout = max(
            _MIN_PER_ATTEMPT_TIMEOUT_S,
            min(float(timeout), _PER_ATTEMPT_TIMEOUT_S, remaining),
        )
        try:
            resp = _gemini_client().models.generate_content(
                model=model,
                contents=contents,
                config=genai_types.GenerateContentConfig(
                    system_instruction=system_instruction or None,
                    # identify() passes temperature=0: the same image must
                    # yield a stable authenticity verdict across requests.
                    temperature=temperature,
                    max_output_tokens=tokens,
                    # Vision/JSON paths: force a pure-JSON body (no markdown).
                    response_mime_type="application/json" if require_json else None,
                    # Our loop owns retry/deadline policy: one HTTP attempt
                    # per step, bounded by the remaining budget.
                    http_options=genai_types.HttpOptions(
                        timeout=int(attempt_timeout * 1000),
                        retry_options=genai_types.HttpRetryOptions(attempts=1),
                    ),
                ),
            )
        except genai_errors.APIError as exc:
            code = getattr(exc, "code", None)
            detail = str(getattr(exc, "message", "") or exc)[:500]
            low = detail.lower()
            if code in (400, 401, 403) and (
                "api key" in low or "api_key" in low or "permission" in low
                or "unauthenticated" in low
            ):
                # Never leak the key itself — clean config-level message.
                raise AIError(USER_MSG_KEY_REJECTED) from exc
            if code == 429 and _quota_limited(detail):
                # Daily free-tier quota exhausted: fail fast, one request.
                raise AIError(USER_MSG_QUOTA) from exc
            last_error = AIError(f"Upstream AI error {code}: {detail}")
            if code in (404, 408, 429, 500, 502, 503, 504) and step < steps - 1:
                # Gateway blip / per-minute 429 / unknown model: next free model.
                time.sleep(0.4 + (step % 2) * 0.3)
                continue
            if step < steps - 1:
                continue
            raise AIError(fail_msg) from exc
        except (httpx.HTTPError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            # Transport failure, timeout, or malformed upstream HTTP body.
            last_error = AIError(f"Unable to reach the AI service: {exc}")
            if step < steps - 1 and time.time() < deadline:
                time.sleep(0.3)
                continue
            raise AIError(fail_msg) from exc

        global LAST_RESOLVED_MODEL
        model_version = getattr(resp, "model_version", None)
        LAST_RESOLVED_MODEL = (
            str(model_version).removeprefix("models/") if model_version else model
        )
        text, finish = _response_text(resp)
        if _is_usable_reply(text, require_json):
            return text
        # Empty / content-safety / truncated (MAX_TOKENS) / non-JSON content.
        last_error = AIError(
            f"Upstream returned empty or non-JSON content on free model "
            f"{model!r} (finish={finish})."
        )
        if step < steps - 1 and time.time() < deadline:
            time.sleep(0.25)
            continue
        break
    # All free models exhausted (or deadline hit): clean user-facing error.
    raise AIError(fail_msg) from last_error


def _extract_json_array(raw: str):
    """Back-compat wrapper: list of items, or parsed dict, or None."""
    return parse_model_json(raw)


def _normalize_status(raw) -> str | None:
    """Map a model-supplied status onto the four allowed values (or None)."""
    if not isinstance(raw, str):
        return None
    key = re.sub(r"[\s\-]+", "_", raw.strip().upper())
    aliases = {
        "GENUINE": "LIKELY_GENUINE",
        "PROBABLY_GENUINE": "LIKELY_GENUINE",
        "APPEARS_GENUINE": "LIKELY_GENUINE",
        "LIKELY_FAKE": "LIKELY_COUNTERFEIT",
        "FAKE": "LIKELY_COUNTERFEIT",
        "COUNTERFEIT": "LIKELY_COUNTERFEIT",
        "PROBABLY_COUNTERFEIT": "LIKELY_COUNTERFEIT",
        "UNABLE_TO_VALIDATE": "UNABLE_TO_VERIFY",
        "UNABLETOVERIFY": "UNABLE_TO_VERIFY",
        "INSUFFICIENT_EVIDENCE": "UNABLE_TO_VERIFY",
        "UNKNOWN": "UNABLE_TO_VERIFY",
        "VERIFIED_AUTHENTIC": None,  # explicitly forbidden from images
        "AUTHENTIC": None,
        "VERIFIED": None,
    }
    if key in AUTH_STATUSES:
        return key
    if key in aliases:
        return aliases[key]
    return None


def _extract_indicators(item: dict) -> list[str]:
    raw = item.get("visible_indicators")
    if raw is None:
        raw = item.get("suspiciousIndicators") or []
    if not isinstance(raw, list):
        raw = [str(raw)] if raw else []
    return [str(i).strip() for i in raw if str(i).strip()]


def _obs(item: dict) -> dict:
    o = item.get("observations")
    return o if isinstance(o, dict) else {}


def _flag(o: dict, key: str) -> bool:
    """Truthy flag from vision observations; missing/None -> False."""
    return o.get(key) is True


def assess_from_observations(item: dict) -> dict | None:
    """Deterministic authenticity policy over factual vision observations.

    The vision model only records what it sees (photocopy? blur? SPECIMEN
    stamp? design mismatch? ...). This function — NOT the LLM's mood — maps
    those facts onto the four allowed statuses, in priority order:

      1. Not a physical object           -> UNABLE_TO_VERIFY (artwork etc.)
      2. Blur blocks assessment          -> UNABLE_TO_VERIFY (never SUSPICIOUS)
      3. Photocopy/scan evidence         -> LIKELY_COUNTERFEIT
      4. Strong design/serial/cut anomalies -> LIKELY_COUNTERFEIT
      5. Weaker concrete anomalies       -> SUSPICIOUS
      6. Enough detail, no anomaly       -> LIKELY_GENUINE (SPECIMEN stamp
         alone is a printing overprint, NOT counterfeit evidence)
      7. Otherwise                       -> UNABLE_TO_VERIFY

    Returns None when the item has no "observations" block (legacy path).
    """
    o = _obs(item)
    if not o:
        return None

    name = item.get("denomination") or item.get("name") or "this item"
    kind = item.get("kind")
    physical = o.get("is_physical_object")
    blur = _flag(o, "blur_prevents_assessment")
    detail = _flag(o, "enough_detail_to_judge_features")

    indicators: list[str] = []
    notes = str(o.get("notes") or "").strip()
    # External annotations added to the PHOTOGRAPH (not part of the item).
    # These never prove the item fake, but a compromising overlay means the
    # photo is not clean evidence for an affirmative genuineness verdict.
    overlay = _flag(o, "external_overlay_or_annotation")
    overlay_blocks = _flag(o, "overlay_compromises_assessment")
    overlay_desc = str(o.get("overlay_description") or "").strip()

    # 1. Artwork / render / screenshot — not a physical coin/note photo.
    if physical is False:
        return {
            "status": "UNABLE_TO_VERIFY",
            "message": (
                "Unable to verify. The image does not show a photograph of a "
                "physical coin or banknote, so authenticity cannot be assessed."
                + _AUTH_DISCLAIMER
            ),
            "indicators": [],
            "confidence": None,
        }

    if kind == "currency":
        mono = _flag(o, "monochrome_reproduction") or _flag(o, "is_photocopy_or_scan") or _flag(o, "toner_only_note")
        cutmarks = _flag(o, "paper_cut_or_registration_marks") or _flag(o, "registration_ticks")
        scene = _flag(o, "on_bank_documents") and _flag(o, "cut_out_with_borders")
        onjunk = _flag(o, "lying_on_unrelated_objects")
        specimen = _flag(o, "specimen_or_sample_stamp")
        color_ok = o.get("color_scheme_plausible")
        mismatch = _flag(o, "series_design_mismatch")
        serial = _flag(o, "serial_number_anomaly")
        cutpaste = _flag(o, "cut_paste_overlay_tape")
        pc_ev = str(o.get("photocopy_evidence") or "").strip()

        # 1b. QUALITY GATE before copy detection: on a blurry image the scene
        #     detector is unreliable (false positives), and you cannot honestly
        #     claim to have "seen" copy artifacts through the blur.
        if blur:
            status = "UNABLE_TO_VERIFY"
            reason = (
                f"Authenticity of {name} cannot be determined from this image "
                "— image quality prevents assessment of security features."
            )
            indicators = ["Insufficient image detail to assess security features"]
            if overlay:
                indicators.insert(
                    0,
                    "External overlay/annotation visible on the photograph"
                    + (f": {overlay_desc}" if overlay_desc else ""),
                )
            conf = None
            parts = [f"{_AUTH_LABELS[status]}. {reason}"]
            if indicators:
                parts.append("Visible indicators: " + "; ".join(indicators[:5]) + ".")
            parts.append(_AUTH_DISCLAIMER.strip())
            return {
                "status": status,
                "message": " ".join(p.strip() for p in parts if p and p.strip())[:512],
                "indicators": indicators,
                "confidence": conf,
            }

        copy_hits = []
        if scene:
            copy_hits.append(
                pc_ev or
                "Note is a cut-out reproduction laid on bank passbook/ledger documents"
            )
        if mono and not scene:
            copy_hits.append(
                pc_ev or
                "Monochrome/greyscale reproduction of a note that should have colour"
            )
        if cutmarks:
            copy_hits.append("Paper cut borders, margins, or registration/crop marks visible")
        if onjunk and (mono or cutmarks or scene):
            copy_hits.append("Reproduction photographed lying on unrelated documents")

        strong_hits = []
        if color_ok is False and not mono:
            strong_hits.append("Note colour clearly wrong for the identified series")
        if mismatch:
            strong_hits.append("Printed design does not match the claimed series")
        if serial:
            strong_hits.append("Serial number anomaly (missing/garbled/hand-added)")
        if cutpaste:
            strong_hits.append("Cut/paste, overlay, tape, or erasure evidence")

        # 3. Photocopy / scan / printout of a banknote -> LIKELY_COUNTERFEIT.
        if scene or (mono and (cutmarks or onjunk)) or (mono and not color_ok) or (copy_hits and (mono or cutmarks or scene)):
            status = "LIKELY_COUNTERFEIT"
            reason = (
                f"The image of {name} is a photocopy/scan/printout reproduction "
                "rather than a photograph of an intact physical banknote."
            )
            indicators = copy_hits + strong_hits
            conf = 85 if (scene or mono) else 75
        elif strong_hits:
            # 4. Strong positive anomalies (colour wrong, design mismatch,
            #    serial fraud, cut/paste) -> LIKELY_COUNTERFEIT.
            status = "LIKELY_COUNTERFEIT"
            reason = (
                f"The image of {name} shows visible characteristics inconsistent "
                "with a genuine example of this series."
            )
            indicators = strong_hits
            conf = 75
        elif overlay and overlay_blocks:
            # 4b. A compromising overlay/annotation was added to the photo.
            #     The annotation is not evidence about the note itself, and a
            #     design that looks normal underneath it cannot be certified
            #     from an annotated image -> honest abstention, acknowledging
            #     the overlay (never LIKELY_GENUINE, never auto-counterfeit).
            status = "UNABLE_TO_VERIFY"
            reason = (
                f"Authenticity of {name} cannot be established from this image: "
                "the photograph carries an external overlay/annotation added to "
                "the picture, which is not evidence about the physical item "
                "itself."
            )
            indicators = [
                "External overlay/annotation on the photograph: "
                + (overlay_desc or "visible text/graphics not part of the item")
                + " — not evidence that the item is counterfeit"
            ]
            conf = None
        elif not detail:
            # 5. Quality gate (features simply not inspectable).
            status = "UNABLE_TO_VERIFY"
            reason = (
                f"Authenticity of {name} cannot be determined from this image "
                "— image quality prevents assessment of security features."
            )
            indicators = ["Insufficient image detail to assess security features"]
            conf = None
        elif specimen:
            # SPECIMEN overprint alone: official reference/sample print, not
            # a counterfeit indicator by itself (still not "verified").
            status = "LIKELY_GENUINE"
            reason = (
                f"Expected design and colour of {name} are present with no "
                "observed counterfeit indicators; a SPECIMEN overprint marks a "
                "reference/sample note, not a fake."
            )
            indicators = ["SPECIMEN overprint present (reference/sample note)"]
            if notes:
                indicators.append(notes)
            conf = 70
        elif detail and color_ok is not False:
            # 6. Enough visible genuine characteristics, no anomaly observed.
            status = "LIKELY_GENUINE"
            reason = (
                f"Expected design and security characteristics of {name} appear "
                "consistent with no obvious anomaly visible in this image."
            )
            indicators = ["Expected design features visible", "No observed counterfeit indicators"]
            if notes:
                indicators.append(notes)
            conf = 75
        else:
            status = "UNABLE_TO_VERIFY"
            reason = (
                f"Authenticity of {name} cannot be determined from this image "
                "— there is not enough visible evidence to classify it."
            )
            indicators = []
            conf = None
    else:  # coin
        badphoto = _flag(o, "monochrome_or_bad_photo")
        defects = _flag(o, "casting_or_plating_defects")
        design_ok = o.get("design_matches_denomination")

        if blur or (badphoto and not defects):
            status = "UNABLE_TO_VERIFY"
            reason = (
                f"Authenticity of {name} cannot be determined from this image "
                "— image quality prevents assessment of surface details."
            )
            indicators = ["Insufficient image detail to assess coin surface"]
            conf = None
        elif defects:
            status = "LIKELY_COUNTERFEIT"
            reason = (
                f"The image of {name} shows casting or plating defects "
                "inconsistent with a genuine struck coin."
            )
            indicators = ["Casting seams, porous surface, or plating defects visible"]
            conf = 75
        elif design_ok is False:
            status = "SUSPICIOUS"
            reason = (
                f"The visible design of {name} does not clearly match the "
                "claimed denomination and requires physical verification."
            )
            indicators = ["Visible design does not match claimed denomination"]
            conf = 60
        elif badphoto:
            status = "UNABLE_TO_VERIFY"
            reason = (
                f"Authenticity of {name} cannot be determined from this image "
                "— the coin surface is not clearly visible."
            )
            indicators = []
            conf = None
        elif overlay and overlay_blocks:
            # A compromising overlay/annotation (e.g. words written across the
            # coin in the photo) is not evidence about the physical coin, but
            # it blocks an affirmative genuineness verdict from this image:
            # acknowledge it and abstain honestly (never LIKELY_GENUINE merely
            # because the underlying design looks normal; never auto-fake).
            status = "UNABLE_TO_VERIFY"
            reason = (
                f"Authenticity of {name} cannot be established from this image: "
                "the photograph carries an external overlay/annotation added to "
                "the picture, which is not evidence about the physical coin "
                "itself."
            )
            indicators = [
                "External overlay/annotation on the photograph: "
                + (overlay_desc or "visible text/graphics not part of the item")
                + " — not evidence that the coin is counterfeit"
            ]
            conf = None
        else:
            status = "LIKELY_GENUINE"
            reason = (
                f"Expected design and surface characteristics of {name} appear "
                "consistent with no obvious anomaly visible in this image."
            )
            indicators = ["Expected design features visible", "No observed casting/plating defects"]
            if notes:
                indicators.append(notes)
            conf = 70

    # Acknowledge any photo-level overlay/annotation in the final reasoning,
    # whatever status the evidence chain produced (unless already cited).
    if overlay and not any(
        any(w in str(ind).lower() for w in ("overlay", "annotation", "watermark"))
        for ind in indicators
    ):
        indicators.insert(
            0,
            "External overlay/annotation visible on the photograph"
            + (f": {overlay_desc}" if overlay_desc else ""),
        )

    if not indicators and notes:
        indicators = [notes]

    parts = [f"{_AUTH_LABELS[status]}. {reason}"]
    if indicators:
        parts.append("Visible indicators: " + "; ".join(indicators[:5]) + ".")
    parts.append(_AUTH_DISCLAIMER.strip())
    message = " ".join(p.strip() for p in parts if p and p.strip())
    return {
        "status": status,
        "message": message[:512],
        "indicators": indicators,
        "confidence": conf,
    }


def assess_authenticity(item: dict) -> dict:
    """Build the authenticity assessment for one identified item.

    Prefers the deterministic observation policy when the vision model
    returned an "observations" block; otherwise falls back to the model's
    own authenticity_status (legacy) or an indicator heuristic.
    Never returns VERIFIED_AUTHENTIC: photo-only analysis cannot verify
    genuineness.
    """
    from_obs = assess_from_observations(item)
    if from_obs is not None:
        return from_obs

    name = item.get("denomination") or item.get("name") or "this item"
    indicators = _extract_indicators(item)
    reason = str(item.get("authenticity_reason") or "").strip()

    status = _normalize_status(item.get("authenticity_status"))
    if status is None:
        status = "SUSPICIOUS" if indicators else "UNABLE_TO_VERIFY"

    conf = item.get("authenticity_confidence")
    try:
        conf = max(0, min(100, int(conf))) if conf is not None else None
    except (TypeError, ValueError):
        conf = None

    default_reason = {
        "LIKELY_COUNTERFEIT": (
            f"The image of {name} shows visible characteristics inconsistent "
            "with a genuine example."
        ),
        "SUSPICIOUS": (
            f"The image of {name} shows anomalies that require physical "
            "authenticity verification."
        ),
        "LIKELY_GENUINE": (
            f"Expected design and security characteristics of {name} appear "
            "consistent with no obvious anomaly visible in this image."
        ),
        "UNABLE_TO_VERIFY": (
            f"Authenticity of {name} cannot be determined from this image "
            "— there is not enough visible evidence to classify it."
        ),
    }[status]

    parts = [f"{_AUTH_LABELS[status]}. {reason or default_reason}"]
    if indicators:
        parts.append("Visible indicators: " + "; ".join(indicators[:5]) + ".")
    parts.append(_AUTH_DISCLAIMER.strip())
    message = " ".join(p.strip() for p in parts if p and p.strip())
    return {
        "status": status,
        "message": message[:512],
        "indicators": indicators,
        "confidence": conf,
    }


def overall_authenticity(items: list) -> dict:
    """Worst-case status across items (LIKELY_COUNTERFEIT outranks SUSPICIOUS
    outranks UNABLE_TO_VERIFY outranks LIKELY_GENUINE)."""
    assessments = [assess_authenticity(i) for i in items if isinstance(i, dict)]
    if not assessments:
        return {
            "status": "UNABLE_TO_VERIFY",
            "message": (
                "Authenticity cannot be verified from this image. "
                + _AUTH_DISCLAIMER.strip()
            ),
            "indicators": [],
            "confidence": None,
        }
    worst = max(assessments, key=lambda a: _AUTH_SEVERITY.get(a["status"], 1))
    return worst


def _validate_image_data_url(image: str) -> None:
    if not isinstance(image, str) or not image.startswith("data:image/"):
        raise AIError("Invalid image: expected a data URL (data:image/...).")
    # Rough decoded-size check on the base64 payload.
    b64 = image.split(",", 1)[-1]
    if len(b64) * 3 // 4 > MAX_IMAGE_BYTES:
        raise AIError("Image is too large (max 6 MB after encoding).")


def _identify_cache_get(key: str) -> dict | None:
    now = time.time()
    expired = [k for k, (ts, _) in _IDENTIFY_CACHE.items()
               if now - ts > _IDENTIFY_CACHE_TTL]
    for k in expired:
        del _IDENTIFY_CACHE[k]
    hit = _IDENTIFY_CACHE.get(key)
    if hit is None:
        return None
    return copy.deepcopy(hit[1])


def _identify_cache_put(key: str, result: dict) -> None:
    if len(_IDENTIFY_CACHE) >= _IDENTIFY_CACHE_MAX:
        oldest = min(_IDENTIFY_CACHE, key=lambda k: _IDENTIFY_CACHE[k][0])
        del _IDENTIFY_CACHE[oldest]
    _IDENTIFY_CACHE[key] = (time.time(), copy.deepcopy(result))


def identify(image: str) -> dict:
    """Single shared vision analysis: identification + authenticity.

    Pipeline: uploaded image data URL -> Gemini vision API (inline bytes) ->
    items + factual observations -> authenticity policy.

    Used by BOTH /api/ai/identify and the chatbot's image flow. The raw image
    is always part of the vision request (never filename/metadata/match %).

    If the vision API finds no physical coin/banknote, returns
    {"items": [], "authenticity": None} — no authenticity assessment is
    invented for unsupported images.
    """
    _validate_image_data_url(image)
    cache_key = hashlib.sha256(image.encode("utf-8")).hexdigest()
    cached = _identify_cache_get(cache_key)
    if cached is not None:
        return cached
    deadline = time.time() + _IDENTIFY_TIME_BUDGET_S
    try:
        raw = _call_gemini(
            [
                {
                    "role": "system",
                    "content": (
                        "You are a careful numismatic vision analyzer. The user "
                        "uploaded an image; inspect the pixels and return only "
                        "valid JSON."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": IDENTIFY_PROMPT},
                        {"type": "image_url", "image_url": {"url": image}},
                    ],
                },
            ],
            max_tokens=1500,
            # Deterministic classification: same image -> same verdict.
            temperature=0,
            # Free router sometimes lands on non-vision/content-safety models that
            # return unusable text — require parseable JSON before accepting.
            require_json=True,
            deadline=deadline,
            timeout=_PER_ATTEMPT_TIMEOUT_S,
        )
    except AIError as exc:
        # Preserve clean user-facing messages; wrap unknown upstream noise.
        if str(exc) in _PASSTHROUGH_MESSAGES:
            raise
        raise AIError(USER_MSG_ANALYSIS_FAILED) from exc
    data = parse_model_json(raw)
    items = (
        [d for d in data if isinstance(d, dict)]
        if isinstance(data, list)
        else ([data] if isinstance(data, dict) else [])
    )
    # Dedicated short questionnaire pass: the long identify prompt often
    # omits currency-specific observation keys; this fills them reliably.
    if items and time.time() < deadline - 5:
        try:
            obs_raw = _call_gemini(
                [
                    {
                        "role": "system",
                        "content": "Return only valid JSON. No markdown.",
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": OBSERVE_PROMPT},
                            {"type": "image_url", "image_url": {"url": image}},
                        ],
                    },
                ],
                max_tokens=2500,
                temperature=0,
                require_json=True,
                deadline=deadline,
                timeout=_PER_ATTEMPT_TIMEOUT_S,
            )
            obs = parse_model_json(obs_raw)
            if isinstance(obs, list) and obs and isinstance(obs[0], dict):
                obs = obs[0]
            if isinstance(obs, dict):
                # Merge: questionnaire wins for authenticity-relevant keys;
                # keep identify()'s notes if questionnaire notes empty.
                merged = dict(obs)
                if not str(merged.get("notes") or "").strip():
                    old_notes = (items[0].get("observations") or {}).get("notes")
                    if old_notes:
                        merged["notes"] = old_notes
                # Photocopy scene derived from questionnaire scene flags.
                if items[0].get("kind") == "currency":
                    scene = (
                        merged.get("on_bank_documents") is True
                        and merged.get("cut_out_with_borders") is True
                    )
                    merged["is_photocopy_or_scan"] = scene
                    if scene or merged.get("toner_only_note") is True:
                        merged["monochrome_reproduction"] = True
                        if scene and not str(merged.get("photocopy_evidence") or "").strip():
                            merged["photocopy_evidence"] = (
                                "Note is a cut-out reproduction laid on bank "
                                "passbook/ledger documents"
                            )
                    if merged.get("registration_ticks") is True:
                        merged["paper_cut_or_registration_marks"] = True
                items[0]["observations"] = merged
        except AIError:
            # questionnaire is best-effort; identify()'s own observations
            # (or the UNABLE fallback) still apply if this call fails.
            pass
    if not items:
        # Vision found no physical coin/banknote (JSON was valid but empty /
        # non-currency): do NOT invent an item or authenticity status.
        # Failures already raised AIError above and are NOT cached here.
        result = {"items": [], "authenticity": None}
        _identify_cache_put(cache_key, result)
        return copy.deepcopy(result)
    for item in items:
        # Drop any model-hallucinated authenticity fields: status comes from
        # the deterministic observation policy (or legacy fallback inside
        # assess_authenticity), never from a free-form LLM verdict.
        if isinstance(item.get("observations"), dict):
            for k in ("authenticity_status", "authenticity_reason",
                      "authenticity_confidence", "visible_indicators"):
                item.pop(k, None)
        auth = assess_authenticity(item)
        item["authenticity_status"] = auth["status"]
        item["authenticity_message"] = auth["message"]
        item["suspiciousIndicators"] = auth["indicators"]  # backward compat
        if auth["confidence"] is not None:
            item["authenticity_confidence"] = auth["confidence"]
    overall = overall_authenticity(items)
    result = {
        "items": items,
        "authenticity": {
            "status": overall["status"],
            "message": overall["message"],
            "indicators": overall["indicators"],
            "confidence": overall.get("confidence"),
        },
    }
    _identify_cache_put(cache_key, result)
    return copy.deepcopy(result)


# High-precision out-of-domain signals for the chatbot's topic gate.
# Deliberately narrow: neutral openers ("hello", "hi") and coin/currency
# vocabulary never appear here, and a question whose actual subject is one
# of these markers stays off-topic even if it also mentions coins (loose
# connections do not rescue an unrelated question).
_OFF_TOPIC_RE = re.compile(
    r"\b(anime|manga|movies?|films?|netflix|hulu|gaming|gamers?|"
    r"video[- ]games?|playstation|xbox|nintendo|laptops?|programming|"
    r"programmers?|coding|javascript|python|music|songs?|singers?|"
    r"celebrit(?:y|ies)|gossip|hollywood|bollywood|entertainment|"
    r"jokes?|pranks?|horoscopes?|football|soccer|basketball|cricket)\b",
    re.IGNORECASE,
)


def _is_off_topic(text: str) -> bool:
    """True when the message's subject falls outside coins-and-currency."""
    return bool(text) and _OFF_TOPIC_RE.search(text) is not None


def _strip_markdown(text: str) -> str:
    """Convert model markdown to the plain text the chat UI renders.

    ChatMessage displays content as pre-formatted plain text, so raw
    markers (**bold**, *italic*, # headings, ``` fences) would appear
    literally. Applied to every outgoing chat reply; already-clean text
    (e.g. OFF_TOPIC_REPLY or the fixed failure messages) passes through
    unchanged.
    """
    if not text or not isinstance(text, str):
        return text
    t = text
    t = re.sub(r"```[^\n]*\n?", "\n", t)          # code fences -> keep body
    t = t.replace("```", "")
    t = re.sub(r"`([^`\n]+)`", r"\1", t)           # inline code
    t = re.sub(r"\*\*\*(?!\s)([^*\n]+?)\*\*\*", r"\1", t)
    t = re.sub(r"\*\*(?!\s)([^*\n]+?)\*\*", r"\1", t)
    t = re.sub(r"\*(?!\s)([^*\n]*[^*\n\s])\*", r"\1", t)
    t = re.sub(r"__(?!\s)([^_\n]+?)__", r"\1", t)
    t = re.sub(r"(?<![\w])_(?!\s)([^_\n]+?)_(?![\w])", r"\1", t)
    t = re.sub(r"~~([^~\n]+?)~~", r"\1", t)
    t = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", t)   # headings -> plain line
    t = re.sub(r"(?m)^\s{0,3}>\s?", "", t)        # blockquotes
    t = re.sub(r"(?m)^(\s*)\*(?=\s)", r"\1•", t)  # "* " bullets -> bullet char
    t = re.sub(r"\[([^\]\n]+)\]\([^)\n]*\)", r"\1", t)  # links -> label
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def chat(messages: list) -> str:
    """Chat completion.

    - Text-only messages: normal numismatic Q&A (CHAT_SYSTEM). No image is
      sent to the vision API and no authenticity status is invented.
    - Messages with an uploaded image: the image data URL is passed to the
      shared identify() engine (vision API), and that analysis is injected as
      the sole source for denomination + authenticity answers.
    - Off-topic text questions (outside coins/currency) get the standing
      OFF_TOPIC_REPLY deterministically, before any model call.
    - Every outgoing reply is passed through _strip_markdown so the plain
      text chat UI never shows raw markdown markers.
    """
    # Strict domain gate: the latest user message decides. Deterministic
    # refusal (no upstream call), so the OFF_TOPIC answer cannot drift.
    for m in reversed(messages):
        if isinstance(m, dict) and m.get("role") == "user":
            if _is_off_topic(str(m.get("content") or "")):
                return _strip_markdown(OFF_TOPIC_REPLY)
            break

    image_msg = None
    for m in reversed(messages):
        if isinstance(m, dict) and m.get("role") == "user" and m.get("image"):
            image_msg = m
            break

    analysis = None
    deadline = time.time() + _CHAT_TIME_BUDGET_S
    if image_msg is not None:
        # USER IMAGE -> GEMINI VISION API (identify sends the image pixels).
        # Shared identify() engine; its own deadline keeps chat from hanging.
        analysis = identify(image_msg["image"])
        system = (
            CHAT_IMAGE_SYSTEM
            + "\n\nAUTHORITATIVE IMAGE ANALYSIS (JSON):\n"
            + json.dumps(analysis, ensure_ascii=False)
        )
    else:
        system = CHAT_SYSTEM

    formatted = [{"role": "system", "content": system}]
    for m in messages:
        role = m.get("role", "user")
        if role not in ("user", "assistant"):
            continue
        image = m.get("image")
        content = m.get("content") or ""
        if role == "user" and image:
            _validate_image_data_url(image)
            if analysis is not None:
                # The vision pass inside identify() already consumed these
                # pixels. The chat completion stays text-only so the language
                # model answers from that analysis instead of re-judging.
                formatted.append(
                    {"role": "user", "content": content or "Analyze this coin image."}
                )
            else:
                formatted.append(
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": content or "Analyze this coin image."},
                            {"type": "image_url", "image_url": {"url": image}},
                        ],
                    }
                )
        else:
            formatted.append({"role": role, "content": content})
    if len(formatted) < 2:
        raise AIError("No messages to send.")
    try:
        reply = _call_gemini(
            formatted,
            max_tokens=1200 if analysis is not None else 1000,
            timeout=_PER_ATTEMPT_TIMEOUT_S,
            retries=2,
            deadline=deadline,
            fail_message=(
                USER_MSG_ANALYSIS_FAILED if analysis is not None else USER_MSG_CHAT_FAILED
            ),
        )
    except AIError as exc:
        if str(exc) in _PASSTHROUGH_MESSAGES:
            raise
        if analysis is not None:
            # Image path: never invent authenticity; clean failure message.
            raise AIError(USER_MSG_ANALYSIS_FAILED) from exc
        raise
    return _strip_markdown(reply)
