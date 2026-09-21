const API_URL = 'https://openrouter.ai/api/v1/chat/completions'
// NEVER hardcode the key here — it gets revoked by OpenRouter once pushed to GitHub.
// Put it in a local `.env` file as VITE_OPENROUTER_API_KEY (see `.env.example`).
// Vite only exposes env vars prefixed with VITE_ to the browser.
const API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY || ''

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '/api'

export function isBackendError(e) {
  return Boolean(e && (e.name === 'BackendError' || e.status !== undefined || e.wasBackend))
}

function backendErrorMessage(res) {
  return `Backend error ${res.status}: ${res.statusText || 'unknown'}`
}

async function backendRequest(path, options = {}) {
  let res
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    })
  } catch (e) {
    const err = new Error('Backend unreachable. Make sure the FastAPI server is running on port 8000.')
    err.wasBackend = true
    throw err
  }

  let body = null
  try {
    body = await res.json()
  } catch (e) {
    /* non-JSON response */
  }

  if (!res.ok) {
    const err = new Error(body?.detail || body?.message || backendErrorMessage(res))
    err.status = res.status
    err.wasBackend = true
    throw err
  }
  return body
}

// ---------- Backend auth ----------

export function authLogin(identifier, password) {
  return backendRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password })
  })
}

export function authSignup(username, email, password) {
  return backendRequest('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ username, email, password })
  })
}

export function authMe(token) {
  return backendRequest('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
}

export function authLogout(token) {
  return backendRequest('/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  }).catch(() => null)
}

// ---------- Contact Us ----------

export function sendContact({ text, rating = 0, email = '', username = '' }) {
  return backendRequest('/contact', {
    method: 'POST',
    body: JSON.stringify({ text, rating, email, username })
  })
}

// ---------- OpenRouter coin vision / chat ----------

const VISION_MODEL = 'openai/gpt-4o-mini'
const CHAT_MODEL = 'openai/gpt-4o-mini'

async function callAPI(messages, model, maxTokens = 2000) {
  if (!API_KEY) {
    const err = new Error(
      'Missing OpenRouter API key. Create a `.env` file with VITE_OPENROUTER_API_KEY set (see `.env.example`).'
    )
    err.status = 0
    throw err
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    // Cap max_tokens: OpenRouter reserves (prompt + max_tokens) against your
    // credit balance. The default (~16k) exceeds small balances and causes
    // 402 errors. Our JSON answer fits comfortably in 2000 tokens.
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  })
  if (!res.ok) {
    const errText = await res.text()
    let hint = ''
    if (res.status === 401) {
      hint =
        ' (401 Unauthorized: your OpenRouter key is missing, invalid, or was revoked after being pushed to Git — get a new one at https://openrouter.ai/keys)'
    } else if (res.status === 402) {
      hint = ' (402: OpenRouter account has insufficient credits — top up at https://openrouter.ai/credits)'
    } else if (res.status === 429) {
      hint = ' (429: rate limited — wait a moment and retry)'
    }
    const err = new Error(`API error ${res.status}: ${errText}${hint}`)
    err.status = res.status
    throw err
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

// Downscale a data-URL image so its longest side is <= maxDim, encoded as
// JPEG. Returns the original string if anything fails or it's already small.
function downscaleImage(dataUrl, maxDim = 1024, quality = 0.82) {
  return new Promise((resolve) => {
    try {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
        resolve(dataUrl)
        return
      }
      const img = new Image()
      img.onload = () => {
        try {
          const longest = Math.max(img.width || 0, img.height || 0)
          if (!longest || longest <= maxDim) {
            resolve(dataUrl)
            return
          }
          const scale = maxDim / longest
          const w = Math.max(1, Math.round(img.width * scale))
          const h = Math.max(1, Math.round(img.height * scale))
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          canvas.getContext('2d').drawImage(img, 0, 0, w, h)
          resolve(canvas.toDataURL('image/jpeg', quality))
        } catch (e) {
          resolve(dataUrl)
        }
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    } catch (e) {
      resolve(dataUrl)
    }
  })
}

export async function identifyItems(imageBase64) {
  // Shrink large photos before upload: full-res phone/camera shots cost
  // thousands of input tokens and can push the request over a small credit
  // balance (402). 1024px is plenty for coin identification.
  const smallImage = await downscaleImage(imageBase64, 1024).catch(() => imageBase64)
  const content = [
    {
      type: 'text',
      text: `You are an expert numismatist and currency expert AI. The attached image may contain ONE or MORE collectible objects: coins and/or paper currency notes (banknotes). Identify EVERY coin and EVERY currency note visible in the image - one object per item.

Return a JSON ARRAY of item objects (and nothing else, no markdown), one element per detected item:
[
  {
    "kind": "coin" or "currency",
    ...fields for that kind...
  }
]

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
  "confidence": "low, medium, or high"
}

For kind = "currency", use ONLY these fields:
{
  "kind": "currency",
  "name": "Note name (e.g. '100 Indian Rupees Note')",
  "country": "Country of issue (e.g. 'India')",
  "currencyName": "Currency unit (e.g. 'Indian Rupee', 'US Dollar')",
  "denomination": "Denomination (e.g. '100 Rupees (₹100)')",
  "series": "Design series or theme (e.g. 'Mahatma Gandhi New Series 2016')",
  "year": "Series year or era (e.g. '2016 – Present')",
  "front": "Front design description",
  "back": "Back design description",
  "description": "A brief 2-3 sentence description of the note",
  "rarity": "Common or Collectible",
  "estimatedValue": "Estimated collector value range in USD",
  "match": 90,
  "confidence": "low, medium, or high"
}

Rules:
- Return one object per distinct item visible in the image, in the order they appear (top-left to bottom-right).
- Return a coin object for every coin and a currency object for every currency note, even if they appear together in one photo.
- Ignore rulers, backgrounds, hands, and shipping material.
- If only one item is present, return an array with exactly one object.
- If a field cannot be determined, use a reasonable default.
Return ONLY the JSON array, no extra text.`,
    },
    {
      type: 'image_url',
      image_url: { url: smallImage },
    },
  ]

  const raw = await callAPI([{ role: 'user', content }], VISION_MODEL)
  const data = extractJSON(raw)
  const items = Array.isArray(data)
    ? data.filter((c) => c && typeof c === 'object')
    : data && typeof data === 'object'
      ? [data]
      : [enrichFallback()]
  // Normalize kind: default to 'coin' if the model omitted it.
  return items.length ? items : [enrichFallback()]
}

// Kept as an alias for compatibility.
export function identifyCoins(imageBase64) {
  return identifyItems(imageBase64)
}

function extractJSON(raw) {
  if (!raw) return null
  let cleaned = String(raw).replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch (e) {
    /* try to isolate the first JSON array/object */
    const arrMatch = cleaned.match(/\[[\s\S]*\]/)
    if (arrMatch) {
      try {
        return JSON.parse(arrMatch[0])
      } catch (e2) {
        /* ignore */
      }
    }
    const objMatch = cleaned.match(/\{[\s\S]*\}/)
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0])
      } catch (e2) {
        /* ignore */
      }
    }
    return null
  }
}

function enrichFallback() {
  return {
    kind: 'coin',
    name: 'Unidentified Coin',
    country: 'Unknown',
    year: '',
    denomination: 'Unknown',
    composition: 'Unknown',
    weight: 'Unknown',
    diameter: 'Unknown',
    obverse: 'Unable to read',
    reverse: 'Unable to read',
    description: 'The AI could not reliably identify this coin from the image. Please try a clearer, well-lit photo.',
    rarity: 'Unknown',
    estimatedValue: '$1 – $5',
    type: 'rupee10',
    match: 0,
    confidence: 'low'
  }
}

export async function chatCompletion(messages) {
  const systemMessage = {
    role: 'system',
    content: `You are CoinScan AI, an expert numismatic assistant. You help users with coin identification, history, grading, mint marks, market values, errors, and collecting advice. Be knowledgeable, concise, and friendly. Use bullet points and structured formatting when helpful. If a user uploads an image, analyze it and describe the coin.`,
  }

  const formatted = [systemMessage, ...messages.map((m) => ({
    role: m.role,
    content: m.image
      ? [
          { type: 'text', text: m.content || 'Analyze this coin image.' },
          { type: 'image_url', image_url: { url: m.image } },
        ]
      : m.content,
  }))]

  return await callAPI(formatted, CHAT_MODEL)
}
