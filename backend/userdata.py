"""User-owned persistent data: scans, chats, messages, images, collection.

Every endpoint resolves the caller from the JWT (deps.get_current_user) and
filters every query by that user_id. Request bodies may NOT supply a user_id.
"""

import base64
import json
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

import ai
import db
from deps import get_current_user

router = APIRouter(prefix="/api", tags=["userdata"])

DATA_URL_RE = re.compile(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", re.DOTALL)
MAX_STORED_IMAGE_BYTES = 6 * 1024 * 1024


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _decode_data_url(image: str) -> tuple[bytes, str]:
    if not isinstance(image, str):
        raise HTTPException(status_code=422, detail="Invalid image payload.")
    m = DATA_URL_RE.match(image)
    if not m:
        raise HTTPException(status_code=422, detail="Image must be a data: URL.")
    mime, b64 = m.group(1), m.group(2)
    try:
        raw = base64.b64decode(b64, validate=True)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Image is not valid base64.") from exc
    if len(raw) > MAX_STORED_IMAGE_BYTES:
        raise HTTPException(status_code=422, detail="Image exceeds the 6 MB limit.")
    return raw, mime


def _store_image(user_id: int, image: str) -> int:
    raw, mime = _decode_data_url(image)
    image_id = db.execute(
        "INSERT INTO user_images (user_id, mime_type, byte_size, data) VALUES (%s, %s, %s, %s)",
        (user_id, mime, len(raw), raw),
    )
    if not image_id:
        raise HTTPException(status_code=500, detail="Failed to store image.")
    return image_id


def _image_data_url(image_id: int | None, user_id: int) -> str | None:
    if not image_id:
        return None
    row = db.fetch_one(
        "SELECT mime_type, data FROM user_images WHERE id = %s AND user_id = %s",
        (image_id, user_id),
    )
    if not row:
        return None
    b64 = base64.b64encode(row["data"]).decode("ascii")
    return f"data:{row['mime_type']};base64,{b64}"


def _owned_chat(chat_id: int, user_id: int) -> dict:
    chat = db.fetch_one(
        "SELECT id, user_id, title, created_at, updated_at FROM chats WHERE id = %s AND user_id = %s",
        (chat_id, user_id),
    )
    if not chat:
        # Same response whether the chat is missing or belongs to someone else.
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return chat


# ---------------------------------------------------------------------------
# AI proxy (Gemini key stays on the server)
# ---------------------------------------------------------------------------

class IdentifyIn(BaseModel):
    image: str = Field(min_length=100)


class AIChatIn(BaseModel):
    # Each message must be an object ({role, content, ...}); plain strings or
    # other scalars would crash the chat formatter — reject them with 422
    # instead of a 500.
    messages: list[dict] = Field(min_length=1, max_length=100)


@router.post("/ai/identify")
def ai_identify(body: IdentifyIn, user: dict = Depends(get_current_user)):
    try:
        return ai.identify(body.image)
    except ai.AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/ai/chat")
def ai_chat(body: AIChatIn, user: dict = Depends(get_current_user)):
    try:
        reply = ai.chat(body.messages)
    except ai.AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"reply": reply}


# ---------------------------------------------------------------------------
# Scan history
# ---------------------------------------------------------------------------

class ScanIn(BaseModel):
    items: list = Field(default_factory=list)
    image: str | None = None
    authenticity: dict | None = None


def _scan_out(row: dict) -> dict:
    try:
        items = json.loads(row.get("items_json") or "[]")
    except (json.JSONDecodeError, ValueError):
        items = []
    return {
        "id": row["id"],
        "name": row["name"],
        "detectedCountry": row["detected_country"],
        "detectedCurrency": row["detected_currency"],
        "denomination": row["denomination"],
        "confidence": row["confidence"],
        "authenticityStatus": row["authenticity_status"],
        "authenticityMessage": row["authenticity_message"],
        "items": items,
        "imageId": row.get("image_id"),
        "timestamp": row["created_at"].isoformat() if row.get("created_at") else None,
    }


@router.get("/scans")
def list_scans(user: dict = Depends(get_current_user)):
    rows = db.query(
        """SELECT id, image_id, name, detected_country, detected_currency, denomination,
                  confidence, authenticity_status, authenticity_message, items_json, created_at
           FROM scan_history WHERE user_id = %s ORDER BY created_at DESC, id DESC LIMIT 50""",
        (user["id"],),
    )
    return {"scans": [_scan_out(r) for r in rows]}


@router.post("/scans")
def create_scan(body: ScanIn, user: dict = Depends(get_current_user)):
    items = [i for i in (body.items or []) if isinstance(i, dict)]
    if not items:
        raise HTTPException(status_code=422, detail="No identification items to save.")
    first = items[0]

    overall = body.authenticity if isinstance(body.authenticity, dict) else None
    allowed = (
        "LIKELY_GENUINE",
        "SUSPICIOUS",
        "LIKELY_COUNTERFEIT",
        "UNABLE_TO_VERIFY",
    )
    # Only persist a status that came from image analysis. Never invent one
    # from match % or item metadata when the client sent authenticity=null.
    if overall is not None and overall.get("status") not in allowed + ("VERIFIED_AUTHENTIC",):
        overall = None
    if overall is None:
        status = "UNABLE_TO_VERIFY"
        message = ""
    else:
        status = overall.get("status", "UNABLE_TO_VERIFY")
        # Honest guards: image-only flow can never persist VERIFIED_AUTHENTIC.
        if status not in allowed:
            status = "UNABLE_TO_VERIFY"
        message = str(overall.get("message") or "")[:512]

    image_id = _store_image(user["id"], body.image) if body.image else None

    name = str(first.get("name") or "Identified Coin")[:255]
    country = str(first.get("country") or "")[:100]
    currency = str(first.get("currencyName") or first.get("currency") or "")[:100]
    denomination = str(first.get("denomination") or "")[:100]
    match = first.get("match")
    confidence = int(match) if isinstance(match, (int, float)) else 0
    confidence = max(0, min(100, confidence))

    scan_id = db.execute(
        """INSERT INTO scan_history
           (user_id, image_id, name, detected_country, detected_currency, denomination,
            confidence, authenticity_status, authenticity_message, items_json)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            user["id"], image_id, name, country, currency, denomination,
            confidence, status, message, json.dumps(items, ensure_ascii=False),
        ),
    )
    row = db.fetch_one(
        """SELECT id, image_id, name, detected_country, detected_currency, denomination,
                  confidence, authenticity_status, authenticity_message, items_json, created_at
           FROM scan_history WHERE id = %s AND user_id = %s""",
        (scan_id, user["id"]),
    )
    out = _scan_out(row)
    out["image"] = _image_data_url(image_id, user["id"])
    return {"scan": out}


@router.get("/scans/{scan_id}")
def get_scan(scan_id: int, user: dict = Depends(get_current_user)):
    row = db.fetch_one(
        """SELECT id, image_id, name, detected_country, detected_currency, denomination,
                  confidence, authenticity_status, authenticity_message, items_json, created_at
           FROM scan_history WHERE id = %s AND user_id = %s""",
        (scan_id, user["id"]),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Scan not found.")
    out = _scan_out(row)
    out["image"] = _image_data_url(row.get("image_id"), user["id"])
    return {"scan": out}


@router.delete("/scans/{scan_id}")
def delete_scan(scan_id: int, user: dict = Depends(get_current_user)):
    row = db.fetch_one(
        "SELECT id FROM scan_history WHERE id = %s AND user_id = %s",
        (scan_id, user["id"]),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Scan not found.")
    db.execute("DELETE FROM scan_history WHERE id = %s AND user_id = %s", (scan_id, user["id"]))
    _cleanup_orphan_images(user["id"])
    return {"ok": True}


@router.delete("/scans")
def clear_scans(user: dict = Depends(get_current_user)):
    db.execute("DELETE FROM scan_history WHERE user_id = %s", (user["id"],))
    _cleanup_orphan_images(user["id"])
    return {"ok": True}


def _cleanup_orphan_images(user_id: int) -> None:
    """Delete this user's stored images that nothing references anymore."""
    db.execute(
        "DELETE im FROM user_images im "
        "LEFT JOIN chat_messages cm ON cm.image_id = im.id "
        "LEFT JOIN scan_history sc ON sc.image_id = im.id "
        "LEFT JOIN collection_items ci ON ci.image_id = im.id "
        "WHERE im.user_id = %s AND cm.id IS NULL AND sc.id IS NULL AND ci.id IS NULL",
        (user_id,),
    )


# ---------------------------------------------------------------------------
# Images (owner-only)
# ---------------------------------------------------------------------------

@router.get("/images/{image_id}")
def get_image(image_id: int, user: dict = Depends(get_current_user)):
    row = db.fetch_one(
        "SELECT mime_type, data FROM user_images WHERE id = %s AND user_id = %s",
        (image_id, user["id"]),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Image not found.")
    return Response(content=row["data"], media_type=row["mime_type"])


# ---------------------------------------------------------------------------
# Chats & messages
# ---------------------------------------------------------------------------

class ChatIn(BaseModel):
    title: str = Field(default="New chat", max_length=100)


class MessageIn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=32000)
    image: str | None = None


def _message_out(row: dict, include_image: bool, user_id: int) -> dict:
    return {
        "id": row["id"],
        "chatId": row["chat_id"],
        "role": row["role"],
        "content": row["content"],
        "imageId": row.get("image_id"),
        "image": _image_data_url(row.get("image_id"), user_id) if include_image else None,
        "timestamp": row["created_at"].isoformat() if row.get("created_at") else None,
    }


@router.get("/chats")
def list_chats(user: dict = Depends(get_current_user)):
    rows = db.query(
        """SELECT c.id, c.title, c.created_at, c.updated_at,
                  (SELECT COUNT(*) FROM chat_messages m WHERE m.chat_id = c.id) AS message_count
           FROM chats c WHERE c.user_id = %s ORDER BY c.updated_at DESC, c.id DESC""",
        (user["id"],),
    )
    return {
        "chats": [
            {
                "id": r["id"],
                "title": r["title"],
                "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
                "updatedAt": r["updated_at"].isoformat() if r["updated_at"] else None,
                "messageCount": r["message_count"],
            }
            for r in rows
        ]
    }


@router.post("/chats")
def create_chat(body: ChatIn, user: dict = Depends(get_current_user)):
    title = (body.title or "New chat").strip()[:100] or "New chat"
    chat_id = db.execute(
        "INSERT INTO chats (user_id, title) VALUES (%s, %s)",
        (user["id"], title),
    )
    return {"chat": {"id": chat_id, "title": title, "createdAt": None, "updatedAt": None}}


@router.get("/chats/{chat_id}/messages")
def list_messages(chat_id: int, user: dict = Depends(get_current_user)):
    _owned_chat(chat_id, user["id"])
    rows = db.query(
        """SELECT id, chat_id, role, content, image_id, created_at
           FROM chat_messages WHERE chat_id = %s AND user_id = %s
           ORDER BY created_at ASC, id ASC""",
        (chat_id, user["id"]),
    )
    return {"messages": [_message_out(r, True, user["id"]) for r in rows]}


@router.post("/chats/{chat_id}/messages")
def add_message(chat_id: int, body: MessageIn, user: dict = Depends(get_current_user)):
    _owned_chat(chat_id, user["id"])
    image_id = _store_image(user["id"], body.image) if body.image else None
    msg_id = db.execute(
        "INSERT INTO chat_messages (chat_id, user_id, role, content, image_id) VALUES (%s, %s, %s, %s, %s)",
        (chat_id, user["id"], body.role, body.content, image_id),
    )
    db.execute("UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = %s AND user_id = %s",
               (chat_id, user["id"]))

    # Auto-title a fresh conversation from the first user message.
    if body.role == "user":
        chat = db.fetch_one("SELECT title FROM chats WHERE id = %s AND user_id = %s",
                            (chat_id, user["id"]))
        if chat and chat["title"] in ("New chat", ""):
            one_line = re.sub(r"\s+", " ", body.content).strip()
            title = (one_line[:42] + "…") if len(one_line) > 42 else (one_line or "New chat")
            db.execute("UPDATE chats SET title = %s WHERE id = %s AND user_id = %s",
                       (title, chat_id, user["id"]))

    row = db.fetch_one(
        "SELECT id, chat_id, role, content, image_id, created_at FROM chat_messages WHERE id = %s AND user_id = %s",
        (msg_id, user["id"]),
    )
    return {"message": _message_out(row, True, user["id"])}


@router.delete("/chats/{chat_id}")
def delete_chat(chat_id: int, user: dict = Depends(get_current_user)):
    chat = db.fetch_one("SELECT id FROM chats WHERE id = %s AND user_id = %s",
                        (chat_id, user["id"]))
    if not chat:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    db.execute("DELETE FROM chats WHERE id = %s AND user_id = %s", (chat_id, user["id"]))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Collection (per-user, replaces localStorage)
# ---------------------------------------------------------------------------

class CollectionItemIn(BaseModel):
    coinId: str = Field(min_length=1, max_length=64)
    item: dict = Field(default_factory=dict)
    image: str | None = None


class CollectionFavoriteIn(BaseModel):
    favorite: bool = False


@router.get("/collection")
def list_collection(user: dict = Depends(get_current_user)):
    rows = db.query(
        """SELECT id, coin_id, image_id, item_json, created_at
           FROM collection_items WHERE user_id = %s ORDER BY created_at DESC, id DESC""",
        (user["id"],),
    )
    out = []
    for r in rows:
        try:
            item = json.loads(r["item_json"] or "{}")
        except (json.JSONDecodeError, ValueError):
            item = {}
        item["id"] = r["coin_id"]
        item["imageId"] = r.get("image_id")
        out.append(item)
    return {"items": out}


@router.post("/collection")
def add_collection_item(body: CollectionItemIn, user: dict = Depends(get_current_user)):
    existing = db.fetch_one(
        "SELECT id FROM collection_items WHERE user_id = %s AND coin_id = %s",
        (user["id"], body.coinId),
    )
    if existing:
        return {"ok": True, "duplicate": True}
    image_id = _store_image(user["id"], body.image) if body.image else None
    payload = dict(body.item or {})
    payload.pop("image", None)
    payload.pop("imageId", None)
    try:
        db.execute(
            "INSERT INTO collection_items (user_id, coin_id, image_id, item_json) VALUES (%s, %s, %s, %s)",
            (user["id"], body.coinId, image_id, json.dumps(payload, ensure_ascii=False)),
        )
    except Exception as exc:  # noqa: BLE001
        # Unique key (user_id, coin_id) raced with a concurrent identical add.
        if getattr(exc, "args", None) and exc.args and exc.args[0] == 1062:
            return {"ok": True, "duplicate": True}
        raise HTTPException(status_code=500, detail="Failed to save collection item.") from exc
    return {"ok": True}


@router.patch("/collection/{coin_id}")
def update_collection_item(coin_id: str, body: CollectionFavoriteIn,
                           user: dict = Depends(get_current_user)):
    row = db.fetch_one(
        "SELECT item_json FROM collection_items WHERE user_id = %s AND coin_id = %s",
        (user["id"], coin_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Collection item not found.")
    try:
        item = json.loads(row["item_json"] or "{}")
    except (json.JSONDecodeError, ValueError):
        item = {}
    item["favorite"] = bool(body.favorite)
    db.execute(
        "UPDATE collection_items SET item_json = %s WHERE user_id = %s AND coin_id = %s",
        (json.dumps(item, ensure_ascii=False), user["id"], coin_id),
    )
    return {"ok": True}


@router.delete("/collection/{coin_id}")
def delete_collection_item(coin_id: str, user: dict = Depends(get_current_user)):
    row = db.fetch_one(
        "SELECT id FROM collection_items WHERE user_id = %s AND coin_id = %s",
        (user["id"], coin_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Collection item not found.")
    db.execute(
        "DELETE FROM collection_items WHERE user_id = %s AND coin_id = %s",
        (user["id"], coin_id),
    )
    _cleanup_orphan_images(user["id"])
    return {"ok": True}


@router.delete("/collection")
def clear_collection(user: dict = Depends(get_current_user)):
    db.execute("DELETE FROM collection_items WHERE user_id = %s", (user["id"],))
    _cleanup_orphan_images(user["id"])
    return {"ok": True}
