// All AI calls go through the FastAPI backend (/api/ai/*). The Gemini key
// lives ONLY in backend/.env and is never exposed to the browser.

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '/api'

export function isBackendError(e) {
  return Boolean(e && (e.name === 'BackendError' || e.status !== undefined || e.wasBackend))
}

function getToken() {
  try {
    const raw = localStorage.getItem('coinscan_auth')
    const session = raw ? JSON.parse(raw) : null
    if (session?.token && !session.demo) return session.token
  } catch (e) {
    /* ignore */
  }
  return null
}

export function isAuthenticated() {
  return Boolean(getToken())
}

function backendErrorMessage(res) {
  return `Backend error ${res.status}: ${res.statusText || 'unknown'}`
}

// FastAPI can return `detail` as a string, an array of validation objects,
// or an object — render them all as readable text (never "[object Object]").
function apiErrorMessage(body, res) {
  const detail = body?.detail ?? body?.message
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => (typeof d === 'string' ? d : typeof d?.msg === 'string' ? d.msg : null))
      .filter(Boolean)
    if (parts.length) return parts.join(' ')
  }
  if (detail && typeof detail === 'object' && typeof detail.msg === 'string') return detail.msg
  return backendErrorMessage(res)
}

async function backendRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  const token = getToken()
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      ...options,
      headers
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
    const err = new Error(apiErrorMessage(body, res))
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

// ---------- Coin vision / chat (proxied via backend) ----------

// Downscale a data-URL image so its longest side is <= maxDim, encoded as
// JPEG. Returns the original string if anything fails or it's already small.
export function downscaleImage(dataUrl, maxDim = 1024, quality = 0.82) {
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
  // Shrink large photos before upload to keep payloads small, then let the
  // backend call the vision model server-side and return items plus a
  // SEPARATE authenticity assessment.
  const smallImage = await downscaleImage(imageBase64, 1024).catch(() => imageBase64)
  const data = await backendRequest('/ai/identify', {
    method: 'POST',
    body: JSON.stringify({ image: smallImage })
  })
  return { items: data.items || [], authenticity: data.authenticity || null }
}

// Kept as an alias for compatibility.
export function identifyCoins(imageBase64) {
  return identifyItems(imageBase64)
}

export async function chatCompletion(messages) {
  const slimmed = await Promise.all(
    (messages || []).map(async (m) => {
      if (m?.image) {
        const image = await downscaleImage(m.image, 1024).catch(() => m.image)
        return { ...m, image }
      }
      return m
    })
  )
  const data = await backendRequest('/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: slimmed })
  })
  return data.reply || ''
}

// ---------- Scan history (per-user, MySQL) ----------

export function fetchScans() {
  return backendRequest('/scans')
}

export function saveScan({ items, image = null, authenticity = null }) {
  return backendRequest('/scans', {
    method: 'POST',
    body: JSON.stringify({ items, image, authenticity })
  })
}

export function deleteScan(id) {
  return backendRequest(`/scans/${id}`, { method: 'DELETE' })
}

export function clearScans() {
  return backendRequest('/scans', { method: 'DELETE' })
}

// ---------- Chat conversations (per-user, MySQL) ----------

export function fetchChats() {
  return backendRequest('/chats')
}

export function createChat(title = 'New chat') {
  return backendRequest('/chats', {
    method: 'POST',
    body: JSON.stringify({ title })
  })
}

export function fetchMessages(chatId) {
  return backendRequest(`/chats/${chatId}/messages`)
}

export function saveMessage(chatId, { role, content, image = null }) {
  return backendRequest(`/chats/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role, content, image })
  })
}

export function deleteChat(chatId) {
  return backendRequest(`/chats/${chatId}`, { method: 'DELETE' })
}

// ---------- Images (owner-only fetch, returns a data URL) ----------

export async function fetchImageDataUrl(imageId) {
  if (!imageId) return null
  const token = getToken()
  if (!token) return null
  let res
  try {
    res = await fetch(`${BACKEND_URL}/images/${imageId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
  } catch (e) {
    return null
  }
  if (!res.ok) return null
  const blob = await res.blob()
  return await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

// ---------- Collection (per-user, MySQL) ----------

export function fetchCollection() {
  return backendRequest('/collection')
}

export function addCollectionItem(coinId, item, image = null) {
  return backendRequest('/collection', {
    method: 'POST',
    body: JSON.stringify({ coinId, item, image })
  })
}

export function setCollectionFavorite(coinId, favorite) {
  return backendRequest(`/collection/${encodeURIComponent(coinId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ favorite })
  })
}

export function removeCollectionItem(coinId) {
  return backendRequest(`/collection/${encodeURIComponent(coinId)}`, { method: 'DELETE' })
}

export function clearCollectionItems() {
  return backendRequest('/collection', { method: 'DELETE' })
}
