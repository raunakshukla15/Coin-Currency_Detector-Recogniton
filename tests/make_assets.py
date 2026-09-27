"""Generate Playwright test assets that don't exist yet in the repo.

    python tests/make_assets.py            # build everything into tests/fixtures

Produces:
  1. camera.y4m        — fake-camera video for Chromium's
                         --use-file-for-fake-video-capture (I420/YUV420,
                         built from the genuine ₹500 note photo).
  2. noncurrency.png   — an obvious NON-currency image (Pillow-generated) used
                         to prove the app says "not a currency image" instead
                         of inventing an identification.
  3. foreign_note.jpg  — a foreign banknote photo (Wikimedia Commons API) so
                         scans cover non-Indian paper currency too.

Existing assets (NOT regenerated here) live in
C:/Users/119ar/AppData/Local/Temp/opencode/auth_tests/ :
  genuine_500.jpg (Indian note), india_Five_100.jpg (Indian ₹5 coin),
  coin_20piso.jpg (foreign coin), fake_500.jpg / poor_quality.jpg.
"""

import json
import os
import sys
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "fixtures")
ASSET_SRC = r"C:\Users\119ar\AppData\Local\Temp\opencode\auth_tests"
UA = {"User-Agent": "CoinScan-E2E-Tests/1.0 (test asset fetch; contact: local)"}


def make_y4m(src_image: str, out_path: str, width=320, height=240, frames=15, fps=30):
    """Write an I420 (YUV420) Y4M clip from a still image.

    Chromium loops --use-file-for-fake-video-capture files, so a short clip
    of the same frame is enough to simulate a live camera.
    """
    img = Image.open(src_image).convert("RGB")
    # Center-crop to the target aspect, then resize (dimensions stay even).
    tw, th = width, height
    iw, ih = img.size
    scale = max(tw / iw, th / ih)
    nw, nh = int(iw * scale + 0.5), int(ih * scale + 0.5)
    img = img.resize((nw, nh), Image.LANCZOS)
    left, top = (nw - tw) // 2, (nh - th) // 2
    img = img.crop((left, top, left + tw, top + th))

    ycc = img.convert("YCbCr")
    y_channel, cb, cr = ycc.split()
    cb_small = cb.resize((tw // 2, th // 2), Image.BILINEAR)
    cr_small = cr.resize((tw // 2, th // 2), Image.BILINEAR)

    y_bytes = y_channel.tobytes()
    c_bytes = cb_small.tobytes() + cr_small.tobytes()

    header = f"YUV4MPEG2 W{tw} H{th} F{fps}:1 Ip A1:1 C420\n".encode("ascii")
    frame_header = b"FRAME\n"
    with open(out_path, "wb") as fh:
        fh.write(header)
        for _ in range(frames):
            fh.write(frame_header)
            fh.write(y_bytes)
            fh.write(c_bytes)
    size = os.path.getsize(out_path)
    print(f"y4m: {out_path} ({size} bytes, {frames} frames {tw}x{th})")


def make_noncurrency(out_path: str, width=900, height=650):
    """A deliberately non-currency image: gradients, shapes, and text."""
    img = Image.new("RGB", (width, height), (36, 44, 68))
    px = img.load()
    for y in range(height):
        for x in range(width):
            px[x, y] = (
                36 + (x * 60) // width,
                44 + (y * 70) // height,
                68 + ((x + y) * 40) // (width + height),
            )
    draw = ImageDraw.Draw(img)
    draw.rectangle([60, 60, width - 60, height - 60], outline=(230, 230, 235), width=6)
    draw.ellipse([140, 150, 420, 430], outline=(0, 229, 195), width=10)
    draw.polygon(
        [(520, 430), (620, 170), (720, 430)], outline=(255, 125, 156), width=10
    )
    draw.line([140, 520, 760, 520], fill=(240, 212, 146), width=8)
    draw.text((150, 80), "NOT A BANKNOTE - TEST IMAGE", fill=(255, 255, 255))
    draw.text((250, 560), "shapes and text only", fill=(220, 224, 235))
    img.save(out_path)
    print(f"noncurrency: {out_path}")


def make_foreign_note(out_path: str, width=1200) -> bool:
    """Download a foreign banknote photo from Wikimedia Commons via the API."""
    api = (
        "https://en.wikipedia.org/w/api.php?"
        + urllib.parse.urlencode({
            "action": "query",
            "titles": "File:US one dollar bill, obverse, series 2009.jpg",
            "prop": "imageinfo",
            "iiprop": "url",
            "iiurlwidth": str(width),
            "format": "json",
        })
    )
    try:
        req = urllib.request.Request(api, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as res:
            data = json.loads(res.read().decode("utf-8"))
        pages = data.get("query", {}).get("pages", {})
        thumb = None
        for page in pages.values():
            info = (page or {}).get("imageinfo") or []
            if info:
                thumb = info[0].get("thumburl") or info[0].get("url")
                break
        if not thumb:
            print("foreign_note: no URL in API response", file=sys.stderr)
            return False
        req = urllib.request.Request(thumb, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as res:
            payload = res.read()
        if not payload.startswith(b"\xff\xd8"):
            print("foreign_note: response was not a JPEG", file=sys.stderr)
            return False
        with open(out_path, "wb") as fh:
            fh.write(payload)
        print(f"foreign_note: {out_path} ({len(payload)} bytes from {thumb[:90]})")
        return True
    except Exception as exc:
        print(f"foreign_note: download failed: {exc}", file=sys.stderr)
        return False


def main():
    os.makedirs(FIXTURES, exist_ok=True)
    y4m_src = os.path.join(ASSET_SRC, "genuine_500.jpg")
    if not os.path.exists(y4m_src):
        y4m_src = os.path.join(FIXTURES, "note.jpg")
    make_y4m(y4m_src, os.path.join(FIXTURES, "camera.y4m"))
    make_noncurrency(os.path.join(FIXTURES, "noncurrency.png"))
    ok = make_foreign_note(os.path.join(FIXTURES, "foreign_note.jpg"))
    if not ok:
        print("WARNING: foreign note not downloaded (offline?)", file=sys.stderr)
    print("assets done")


if __name__ == "__main__":
    main()
