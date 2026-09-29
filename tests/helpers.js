import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const BACKEND_URL = 'http://127.0.0.1:8000'
export const FIXTURE_NOTE = path.join(__dirname, 'fixtures', 'note.jpg')

export function uniqueUser() {
  const id =
    Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)
  return {
    username: `pw${id}`,
    // Pydantic EmailStr rejects reserved/special-use domains (.local, .test,
    // example.com) — use a normal-looking domain.
    email: `pw${id}@coinscan-e2e.com`,
    // Randomly generated per account (letters + digits + symbol, well over
    // the backend's minimum length). Never reused across accounts.
    password: `Playwright!${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`
  }
}

export function trackPageErrors(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

// ----- API seeding helpers (used to test persistence/filtering without
// ----- spending the 50/day free-AI quota; the real AI flow lives in
// ----- scan.spec.js / chat.spec.js) -----

export async function apiToken(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('coinscan_auth')
      return raw ? JSON.parse(raw).token || null : null
    } catch (e) {
      return null
    }
  })
}

export async function seedCollection(page, entries) {
  const token = await apiToken(page)
  for (const { coinId, item } of entries) {
    const res = await page.request.post(`${BACKEND_URL}/api/collection`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { coinId, item }
    })
    if (!res.ok()) {
      throw new Error(`seedCollection ${coinId} failed: ${res.status()} ${await res.text()}`)
    }
  }
}

export async function getCollection(page) {
  const token = await apiToken(page)
  const res = await page.request.get(`${BACKEND_URL}/api/collection`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok()) throw new Error(`getCollection failed: ${res.status()}`)
  return (await res.json()).items || []
}

export async function seedScan(page, { items, authenticity = null }) {
  const token = await apiToken(page)
  const res = await page.request.post(`${BACKEND_URL}/api/scans`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { items, image: null, authenticity }
  })
  if (!res.ok()) throw new Error(`seedScan failed: ${res.status()} ${await res.text()}`)
  return res.json()
}

export async function getScans(page) {
  const token = await apiToken(page)
  const res = await page.request.get(`${BACKEND_URL}/api/scans`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok()) throw new Error(`getScans failed: ${res.status()}`)
  return (await res.json()).scans || []
}

export async function signup(page, user) {
  await page.goto('/signup')
  await page.fill('#username', user.username)
  await page.fill('#email', user.email)
  await page.fill('#password', user.password)
  await page.fill('#confirm', user.password)
  await page.getByRole('button', { name: /create account/i }).click()
  await page.waitForURL('**/home', { timeout: 20_000 })
}

export async function logout(page) {
  await page.getByRole('button', { name: /^logout$/i }).click()
  await page.waitForURL('**/login', { timeout: 20_000 })
}

export async function login(page, user) {
  await page.goto('/login')
  await page.fill('#identifier', user.username)
  await page.fill('#password', user.password)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL('**/home', { timeout: 20_000 })
}

// Wait for a real AI assistant reply bubble. The intro panel uses the same
// classes as assistant bubbles, so we must distinguish them: keep polling
// until the LAST matching bubble is not the intro, then validate it's a real
// answer (not one of the known error messages).
export async function expectRealAiReply(page, timeout = 150_000) {
  const deadline = Date.now() + timeout
  let lastText = ''
  while (Date.now() < deadline) {
    const bubbles = page.locator('.glass-card-soft.glass-interior')
    const n = await bubbles.count()
    if (n > 0) {
      const text = (await bubbles.last().innerText()).trim()
      lastText = text
      if (!/I'm your AI Numismatic Assistant/i.test(text)) {
        if (text.length < 40) {
          throw new Error(`AI reply too short (likely empty/failed): "${text}"`)
        }
        if (
          /service is unavailable|couldn't reliably analyze|couldn't get a response|rate-limited|not a supported currency|Backend unreachable|Empty reply|Please try again/i.test(
            text
          )
        ) {
          throw new Error(`AI reply is an error message, not a real answer: "${text}"`)
        }
        return text
      }
    }
    await page.waitForTimeout(500)
  }
  throw new Error(
    `No AI reply arrived within ${timeout}ms (last bubble: "${lastText.slice(0, 120)}")`
  )
}
