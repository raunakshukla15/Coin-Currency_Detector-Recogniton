import { test, expect } from '@playwright/test'
import {
  uniqueUser,
  signup,
  logout,
  trackPageErrors,
  apiToken,
  BACKEND_URL,
  FIXTURE_NOTE
} from './helpers.js'

// Chatbot functional audit with a MOCKED /api/ai/chat: deterministic, no
// Gemini quota. Conversation storage (chats/messages) uses the real backend.
const PLACEHOLDER = 'Ask CoinScan AI anything about coins...'
const GREETING = "Hello! I'm your AI Numismatic Assistant."

async function mockChat(page, { reply, detail, delay = 0, status = 200 } = {}) {
  const state = { count: 0, bodies: [] }
  await page.route('**/api/ai/chat', async (route) => {
    state.count += 1
    state.bodies.push(route.request().postDataJSON())
    if (delay) await new Promise((r) => setTimeout(r, delay))
    await route.fulfill(
      status === 200
        ? { contentType: 'application/json', body: JSON.stringify({ reply }) }
        : { status, contentType: 'application/json', body: JSON.stringify({ detail }) }
    )
  })
  return state
}

async function seedChat(page, title, content) {
  const token = await apiToken(page)
  const res = await page.request.post(`${BACKEND_URL}/api/chats`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title }
  })
  if (!res.ok()) throw new Error(`seedChat failed: ${res.status()} ${await res.text()}`)
  const { chat } = await res.json()
  const res2 = await page.request.post(`${BACKEND_URL}/api/chats/${chat.id}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { role: 'user', content, image: null }
  })
  if (!res2.ok()) throw new Error(`seedMessage failed: ${res2.status()} ${await res2.text()}`)
  return chat.id
}

async function getServerChatTitles(page) {
  const token = await apiToken(page)
  const res = await page.request.get(`${BACKEND_URL}/api/chats`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok()) throw new Error(`listChats failed: ${res.status()} ${await res.text()}`)
  const { chats } = await res.json()
  return (chats || []).map((c) => c.title)
}

async function createAccountViaApi(page, user) {
  const res = await page.request.post(`${BACKEND_URL}/api/auth/signup`, {
    data: { username: user.username, email: user.email, password: user.password }
  })
  expect(res.status(), `signup API failed: ${await res.text()}`).toBe(200)
  return (await res.json()).token
}

async function loginNoReload(page, user) {
  // Already on /login (post-logout). Fill the form — never goto().
  await page.fill('#identifier', user.username)
  await page.fill('#password', user.password)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL('**/home', { timeout: 20_000 })
}

test.describe('Chatbot (mocked AI, real persistence)', () => {
  test('greeting panel, empty-history state, empty/whitespace never reach the AI', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    const ai = await mockChat(page, { reply: 'MUST NOT BE USED' })
    await page.goto('/chatbot')

    // Intro/greeting + empty history
    await expect(page.getByText(GREETING)).toBeVisible()
    await expect(page.getByText('Origin & country')).toBeVisible()
    await expect(page.getByText('No conversations yet.')).toBeVisible()
    await expect(page.locator('.sidebar-history-count')).toHaveText('0')

    const input = page.getByPlaceholder(PLACEHOLDER)
    const send = page.getByRole('button', { name: 'Send message' })

    // Empty input: button disabled, Enter does nothing
    await expect(send).toBeDisabled()
    await input.press('Enter')

    // Whitespace-only: still disabled, Enter does not clear or send
    await input.fill('   ')
    await expect(send).toBeDisabled()
    await input.press('Enter')
    await expect(input).toHaveValue('   ')

    await page.waitForTimeout(600)
    expect(ai.count).toBe(0)
    // Nothing was created server-side either
    await expect(page.locator('.sidebar-history-count')).toHaveText('0')

    expect(errors).toEqual([])
  })

  test('send flow: loading indicator, reply render, conversation persisted across reload', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    const ai = await mockChat(page, {
      reply: 'A denarius was a silver coin of ancient Rome.',
      delay: 800
    })
    await page.goto('/chatbot')
    const input = page.getByPlaceholder(PLACEHOLDER)
    await input.fill('What is a Roman denarius?')
    await page.getByRole('button', { name: 'Send message' }).click()

    // Typing indicator while the reply is in flight, then the real reply
    await expect(page.locator('.typing-dot').first()).toBeVisible()
    await expect(page.getByText('A denarius was a silver coin of ancient Rome.')).toBeVisible({
      timeout: 10_000
    })
    await expect(page.locator('.typing-dot')).toHaveCount(0)
    await expect.poll(() => ai.count).toBe(1)
    // The AI received the question + the system-ready history shape
    expect(ai.bodies[0].messages.at(-1).content).toContain('Roman denarius')

    // Sidebar conversation created + titled from the first message
    await expect(page.locator('.chat-history-title')).toHaveText('What is a Roman denarius?')

    // Full reload: conversation + both messages survive (server-side)
    await page.reload()
    await expect(page.locator('.chat-history-title')).toHaveText('What is a Roman denarius?', {
      timeout: 15_000
    })
    await page.locator('.chat-history-open').click()
    await expect(page.getByText('What is a Roman denarius?', { exact: true })).toBeVisible()
    await expect(
      page.getByText('A denarius was a silver coin of ancient Rome.', { exact: true })
    ).toBeVisible()
    await expect(page.locator('.typing-dot')).toHaveCount(0)

    expect(errors).toEqual([])
  })

  test('AI failure (503): honest error bubble, error never persisted as an answer', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await mockChat(page, { status: 503, detail: 'Mock AI outage. Try again later.' })
    await page.goto('/chatbot')
    await page.getByPlaceholder(PLACEHOLDER).fill('Is this coin genuine?')
    await page.getByRole('button', { name: 'Send message' }).click()

    // The real backend detail is shown; no generic fabrication
    await expect(page.getByText('Mock AI outage. Try again later.')).toBeVisible({
      timeout: 10_000
    })
    await expect(page.getByText(/Sorry, the AI service is unavailable/i)).toHaveCount(0)
    await expect(page.locator('.typing-dot')).toHaveCount(0)

    // Reload + reopen: the failure is not stored as an assistant answer
    await page.reload()
    await page.locator('.chat-history-open').click()
    await expect(page.getByText('Is this coin genuine?', { exact: true })).toBeVisible()
    await expect(page.getByText('Mock AI outage. Try again later.')).toHaveCount(0)
    // Only the user bubble exists (no assistant bubble at all)
    await expect(page.locator('.chat-panel .glass-card-soft.glass-interior')).toHaveCount(0)

    expect(errors).toEqual([])
  })

  test('switch race: a slow message load for chat A never paints into chat B', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    const chatA = await seedChat(page, 'Race Chat A', 'Alpha secret message 123')
    await seedChat(page, 'Race Chat B', 'Beta secret message 456')

    // Chat A's message load is slow; everything else is normal
    await page.route('**/api/chats/*/messages', async (route) => {
      const url = route.request().url()
      if (route.request().method() === 'GET' && url.includes(`/chats/${chatA}/messages`)) {
        await new Promise((r) => setTimeout(r, 1400))
      }
      await route.continue()
    })

    await page.goto('/chatbot')
    await expect(page.locator('.chat-history-title')).toHaveCount(2)

    // Open the slow chat, then immediately switch to the fast one
    await page.locator('.chat-history-open', { hasText: 'Race Chat A' }).click()
    await page.locator('.chat-history-open', { hasText: 'Race Chat B' }).click()

    await expect(page.getByText('Beta secret message 456')).toBeVisible({ timeout: 10_000 })
    // Let chat A's delayed load resolve — it must be discarded
    await page.waitForTimeout(2000)
    await expect(page.getByText('Beta secret message 456')).toBeVisible()
    await expect(page.getByText('Alpha secret message 123')).toHaveCount(0)
    await expect(page.locator('.chat-history-item.active .chat-history-title')).toHaveText(
      'Race Chat B'
    )

    expect(errors).toEqual([])
  })

  test('reply while switched away: persisted to its own chat, never painted into the new view', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    const ai = await mockChat(page, { reply: 'Delayed mock reply XYZ', delay: 1600 })
    await page.goto('/chatbot')
    const panel = page.locator('.chat-panel')
    const input = page.getByPlaceholder(PLACEHOLDER)
    await input.fill('Delayed question?')
    await page.getByRole('button', { name: 'Send message' }).click()

    // Immediately leave the conversation while the send is in flight
    await page.locator('.chat-new-btn').click()
    await expect(page.getByText(GREETING)).toBeVisible()
    await expect.poll(() => ai.count, { timeout: 5000 }).toBe(1)

    // View change clears the typing indicator (no stuck loading state)
    await expect(page.locator('.typing-dot')).toHaveCount(0)

    // Reply resolves: it must NOT appear in the New Chat view (the sidebar
    // title for the stored conversation is expected to exist)
    await page.waitForTimeout(1800)
    await expect(panel.getByText('Delayed mock reply XYZ')).toHaveCount(0)
    await expect(panel.getByText('Delayed question?')).toHaveCount(0)
    await expect(page.locator('.typing-dot')).toHaveCount(0)

    // But it WAS persisted to the originating conversation
    await expect(page.locator('.chat-history-title')).toHaveText('Delayed question?')
    await page.locator('.chat-history-open').click()
    await expect(panel.getByText('Delayed question?', { exact: true })).toBeVisible()
    await expect(panel.getByText('Delayed mock reply XYZ', { exact: true })).toBeVisible()

    expect(errors).toEqual([])
  })

  test('repeated sends while typing are ignored (single AI request)', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    const ai = await mockChat(page, { reply: 'One answer only.', delay: 900 })
    await page.goto('/chatbot')
    const input = page.getByPlaceholder(PLACEHOLDER)
    await input.fill('First question?')
    await page.getByRole('button', { name: 'Send message' }).click()

    // While typing: a second send must be blocked and keep the draft
    await expect(page.locator('.typing-dot').first()).toBeVisible()
    await input.fill('Second question?')
    await input.press('Enter')
    await expect(input).toHaveValue('Second question?')

    await page.waitForTimeout(1400)
    expect(ai.count).toBe(1)
    await expect(page.getByText('One answer only.')).toBeVisible()
    await expect(page.locator('.typing-dot')).toHaveCount(0)
    // Draft survived the blocked attempt
    await expect(input).toHaveValue('Second question?')

    expect(errors).toEqual([])
  })

  test('long message (4000+ chars) sends, renders, and does not crash', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await mockChat(page, { reply: 'Mock long answer about minting errors.' })
    await page.goto('/chatbot')
    const long = 'Explain minting errors and how to spot them. '.repeat(90) // ~4k chars
    const input = page.getByPlaceholder(PLACEHOLDER)
    await input.fill(long)
    await page.getByRole('button', { name: 'Send message' }).click()

    await expect(page.getByText('Mock long answer about minting errors.')).toBeVisible({
      timeout: 10_000
    })
    const userBubble = page
      .locator('.chat-panel .glass-card-soft:not(.glass-interior)')
      .filter({ hasText: long.slice(0, 40) })
    await expect(userBubble).toBeVisible()
    expect((await userBubble.innerText()).length).toBeGreaterThan(3900)
    await expect(page.locator('.chat-history-title')).toHaveText(
      /^Explain minting errors and how to spot the/
    )

    expect(errors).toEqual([])
  })

  test('attachment validation: wrong type and oversized files show errors, preview stays in sync', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    const ai = await mockChat(page, { reply: 'Unused.' })
    await page.goto('/chatbot')
    const fileInput = page.locator('input[type="file"]')

    // Valid image -> preview appears
    await fileInput.setInputFiles(FIXTURE_NOTE)
    await expect(page.locator('img[alt="Attachment"]')).toBeVisible()

    // Rejected file -> visible error AND the stale preview is cleared
    await fileInput.setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image at all')
    })
    await expect(page.getByText(/Please choose an image file/)).toBeVisible()
    await expect(page.locator('img[alt="Attachment"]')).toHaveCount(0)

    // Oversized image (raw > 4 MB) -> clear size error, no preview
    await fileInput.setInputFiles({
      name: 'huge.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(4.5 * 1024 * 1024, 7)
    })
    await expect(page.getByText(/maximum 4 MB/)).toBeVisible()
    await expect(page.locator('img[alt="Attachment"]')).toHaveCount(0)

    // Nothing was ever sent to the AI
    await page.waitForTimeout(400)
    expect(ai.count).toBe(0)

    expect(errors).toEqual([])
  })

  test('image question: attachment alone enables send; mocked reply + image bubble render', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    const ai = await mockChat(page, { reply: 'Photo received. This looks like a banknote.' })
    await page.goto('/chatbot')
    const send = page.getByRole('button', { name: 'Send message' })
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_NOTE)
    await expect(page.locator('img[alt="Attachment"]')).toBeVisible()

    // Empty text + valid attachment -> send enabled (no silent no-op)
    await expect(send).toBeEnabled()
    await send.click()

    await expect(page.getByText('Photo received. This looks like a banknote.')).toBeVisible({
      timeout: 10_000
    })
    expect(ai.count).toBe(1)
    expect(ai.bodies[0].messages.at(-1).image).toMatch(/^data:image\//)
    // The user's own bubble shows the attachment
    await expect(page.locator('img[alt="Attached coin photo"]')).toBeVisible()
    await expect(page.locator('.typing-dot')).toHaveCount(0)

    expect(errors).toEqual([])
  })

  test('successful deletion: removed from sidebar + server, active view resets, no error', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await seedChat(page, 'Doomed Chat', 'Message to be deleted')
    await seedChat(page, 'Keep Chat', 'Message that stays')
    await page.goto('/chatbot')
    await expect(page.locator('.chat-history-title')).toHaveCount(2)

    // Delete the ACTIVE conversation (open it first) — view resets to intro
    await page.locator('.chat-history-open', { hasText: 'Doomed Chat' }).click()
    await expect(page.getByText('Message to be deleted')).toBeVisible()
    await page
      .locator('.chat-history-item', { hasText: 'Doomed Chat' })
      .getByLabel('Delete conversation')
      .click()

    await expect(page.locator('.chat-history-title')).toHaveCount(1)
    await expect(page.locator('.chat-history-title')).toHaveText('Keep Chat')
    await expect(page.getByText(GREETING)).toBeVisible()
    await expect(page.getByTestId('chat-delete-error')).toHaveCount(0)

    // Server-side deletion really happened (poll: the optimistic UI update
    // can win the race against the in-flight DELETE)
    await expect
      .poll(async () => (await getServerChatTitles(page)).includes('Doomed Chat'), {
        timeout: 10_000
      })
      .toBe(false)
    expect(await getServerChatTitles(page)).toContain('Keep Chat')

    // Delete the remaining (non-active) conversation — empty state returns
    await page
      .locator('.chat-history-item', { hasText: 'Keep Chat' })
      .getByLabel('Delete conversation')
      .click()
    await expect(page.getByText('No conversations yet.')).toBeVisible()
    await expect(page.getByTestId('chat-delete-error')).toHaveCount(0)
    await expect
      .poll(async () => (await getServerChatTitles(page)).length, { timeout: 10_000 })
      .toBe(0)

    // Persists across a reload
    await page.reload()
    await expect(page.getByText('No conversations yet.')).toBeVisible({ timeout: 15_000 })

    expect(errors).toEqual([])
  })

  test('failed deletion: chat restored in the UI with an honest error; retry succeeds', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    const doomedId = await seedChat(page, 'Survivor Chat', 'Secret survivor message')
    await seedChat(page, 'Witness Chat', 'Witness message')

    // The server rejects THIS chat's deletion
    await page.route('**/api/chats/*', async (route) => {
      if (route.request().method() === 'DELETE' && route.request().url().includes(`/chats/${doomedId}`)) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Delete rejected (mock).' })
        })
        return
      }
      await route.continue()
    })

    await page.goto('/chatbot')
    await expect(page.locator('.chat-history-title')).toHaveCount(2)
    await page.locator('.chat-history-open', { hasText: 'Survivor Chat' }).click()
    await expect(page.getByText('Secret survivor message')).toBeVisible()

    // Optimistic removal is rolled back: the chat comes back…
    await page
      .locator('.chat-history-item', { hasText: 'Survivor Chat' })
      .getByLabel('Delete conversation')
      .click()
    await expect(page.locator('.chat-history-title')).toHaveCount(2, { timeout: 10_000 })

    // …with an honest, visible error (nothing pretends to have succeeded)
    const errLine = page.getByTestId('chat-delete-error')
    await expect(errLine).toBeVisible()
    await expect(errLine).toContainText('Could not delete this conversation')

    // The open conversation was restored, not clobbered
    await expect(
      page.locator('.chat-history-item.active', { hasText: 'Survivor Chat' })
    ).toBeVisible()
    await expect(page.getByText('Secret survivor message')).toBeVisible()

    // Server still has it — the failed delete changed nothing
    expect(await getServerChatTitles(page)).toContain('Survivor Chat')

    // Retry after the outage clears: deletion succeeds and the error goes away
    await page.unroute('**/api/chats/*')
    await page
      .locator('.chat-history-item', { hasText: 'Survivor Chat' })
      .getByLabel('Delete conversation')
      .click()
    await expect(page.locator('.chat-history-title')).toHaveCount(1, { timeout: 10_000 })
    await expect(errLine).toHaveCount(0)
    await expect
      .poll(async () => (await getServerChatTitles(page)).includes('Survivor Chat'), {
        timeout: 10_000
      })
      .toBe(false)

    expect(errors).toEqual([])
  })

  test('a delete failure resolving after an account switch never touches the new account', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const userA = uniqueUser()
    const userB = uniqueUser()
    await signup(page, userA)
    await seedChat(page, 'A Private Chat', 'Confidential A message')
    const tokenA = await apiToken(page)

    // A's delete is slow AND fails — it resolves only after B is logged in
    await page.route('**/api/chats/*', async (route) => {
      if (route.request().method() === 'DELETE') {
        await new Promise((r) => setTimeout(r, 4000))
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Late delete failure (mock).' })
        })
        return
      }
      await route.continue()
    })

    await page.goto('/chatbot')
    await page
      .locator('.chat-history-item', { hasText: 'A Private Chat' })
      .getByLabel('Delete conversation')
      .click()
    await expect(page.locator('.chat-history-title')).toHaveCount(0)

    // Switch accounts WITHOUT any reload while the delete is in flight
    await logout(page)
    await createAccountViaApi(page, userB)
    await loginNoReload(page, userB)
    await page.goto('/chatbot')

    // B has no conversations — A's chat must not appear after the late failure
    await expect(page.getByText('No conversations yet.')).toBeVisible({ timeout: 15_000 })

    // Let A's failure resolve well after B's view is loaded
    await page.waitForTimeout(5000)
    await expect(page.locator('.chat-history-title')).toHaveCount(0)
    await expect(page.getByText('A Private Chat')).toHaveCount(0)
    await expect(page.getByTestId('chat-delete-error')).toHaveCount(0)

    // A's failed delete never happened server-side either
    const resA = await page.request.get(`${BACKEND_URL}/api/chats`, {
      headers: { Authorization: `Bearer ${tokenA}` }
    })
    expect(resA.ok()).toBeTruthy()
    expect((await resA.json()).chats.map((c) => c.title)).toContain('A Private Chat')

    expect(errors).toEqual([])
  })
})
