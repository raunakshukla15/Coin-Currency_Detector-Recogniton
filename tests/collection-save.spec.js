import { test, expect } from '@playwright/test'
import {
  uniqueUser,
  signup,
  logout,
  trackPageErrors,
  seedCollection,
  getCollection,
  BACKEND_URL,
  FIXTURE_NOTE
} from './helpers.js'

// Collection save (CollectionContext.addCoin) regression tests: an optimistic
// add must never keep looking successful when the POST fails — it rolls back,
// shows an honest error, and allows a retry; a failure resolving across an
// account switch must never touch the new account's data or view.
// AI identify is MOCKED (no Gemini quota); collection uses the real e2e DB.

const TS = Date.now()

function item(name) {
  return { kind: 'coin', country: 'India', year: '1975', material: 'nickel', name }
}

async function mockIdentify(page) {
  await page.route('**/api/ai/identify', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            kind: 'coin',
            name: 'Mock Rupee',
            country: 'India',
            year: '1998',
            denomination: '5 Rupees',
            match: 91
          }
        ],
        authenticity: null
      })
    })
  )
}

async function gotoResult(page) {
  await page.goto('/home')
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_NOTE)
  await expect(page.getByText(/Image ready for identification/i)).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /^detect/i }).first().click()
  await expect(page).toHaveURL(/\/result/, { timeout: 20_000 })
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

async function seedWithToken(page, token, entries) {
  for (const { coinId, item: entry } of entries) {
    const res = await page.request.post(`${BACKEND_URL}/api/collection`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { coinId, item: entry }
    })
    expect(res.ok(), `seed ${coinId} failed: ${res.status()} ${await res.text()}`).toBeTruthy()
  }
}

test.describe('Collection save failure handling (rollback + honest error)', () => {
  test('successful save: optimistic entry reaches the server and stays visible', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await mockIdentify(page)
    await gotoResult(page)

    await page.getByRole('button', { name: /add to collection/i }).click()
    await expect(page.getByText(/Added Mock Rupee/)).toBeVisible()
    await expect(page.getByRole('button', { name: /in collection/i })).toBeVisible()
    await expect
      .poll(async () => (await getCollection(page)).some((c) => c?.name === 'Mock Rupee'), {
        timeout: 15_000
      })
      .toBe(true)
    await expect(page.getByText(/couldn.t save this item/i)).toHaveCount(0)

    await page.goto('/collection')
    await expect(page.getByText('Mock Rupee').first()).toBeVisible({ timeout: 15_000 })

    expect(errors).toEqual([])
  })

  test('API failure: honest error, rollback with retry, existing collection data preserved', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)
    const keepId = `keep-${TS}`
    await seedCollection(page, [{ coinId: keepId, item: item('Legacy Keeper Coin') }])

    // The save POST fails; GETs and everything else pass through untouched
    await page.route('**/api/collection', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Collection save rejected (mock).' })
        })
        return
      }
      await route.continue()
    })

    await mockIdentify(page)
    await gotoResult(page)
    await page.getByRole('button', { name: /add to collection/i }).click()

    // The optimistic "Added…" toast is replaced by the honest error
    await expect(
      page.getByText(/couldn.t save this item to your collection/i)
    ).toBeVisible({ timeout: 10_000 })

    // Rollback: the button flips back to "Add to Collection" (retry possible)
    await expect(page.getByRole('button', { name: /add to collection/i })).toBeVisible()

    // The failed item never reached the server; existing data is intact
    const items = await getCollection(page)
    expect(items.some((c) => c?.name === 'Mock Rupee')).toBe(false)
    expect(items.some((c) => c?.name === 'Legacy Keeper Coin')).toBe(true)

    // Retry with the API healthy again → success, error clears
    await page.unroute('**/api/collection')
    await page.getByRole('button', { name: /add to collection/i }).click()
    await expect(page.getByRole('button', { name: /in collection/i })).toBeVisible()
    await expect(page.getByText(/couldn.t save this item/i)).toHaveCount(0, { timeout: 8_000 })
    await expect
      .poll(async () => (await getCollection(page)).some((c) => c?.name === 'Mock Rupee'), {
        timeout: 15_000
      })
      .toBe(true)

    // Pre-existing collection data survived both the failure and the rollback
    await page.goto('/collection')
    await expect(page.getByText('Legacy Keeper Coin').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Mock Rupee').first()).toBeVisible()

    expect(errors).toEqual([])
  })

  test('a save failure resolving across an account switch never touches the new account', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const userA = uniqueUser()
    const userB = uniqueUser()
    const betaId = `beta-${TS}`

    await signup(page, userA)
    await mockIdentify(page)
    await gotoResult(page) // A is on /result

    // A's save is slow AND fails — it resolves only after B is fully loaded
    await page.route('**/api/collection', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((r) => setTimeout(r, 7000))
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Late save failure (mock).' })
        })
        return
      }
      await route.continue()
    })

    await page.getByRole('button', { name: /add to collection/i }).click()
    await expect(page.getByRole('button', { name: /in collection/i })).toBeVisible() // A's optimistic state

    // Switch accounts with NO reload while A's save is still in flight
    await logout(page)
    const tokenB = await createAccountViaApi(page, userB)
    await seedWithToken(page, tokenB, [{ coinId: betaId, item: item('Beta Only Coin') }])
    await loginNoReload(page, userB)

    // B runs their own (mocked) identification and lands on the result page
    await gotoResult(page)
    await expect(page.getByRole('button', { name: /add to collection/i })).toBeVisible()

    // Let A's failure resolve well after B's view is loaded
    await page.waitForTimeout(5_500)

    // No error from A's failure is ever shown to B…
    await expect(page.getByText(/couldn.t save this item/i)).toHaveCount(0)
    // …A's optimistic state never flipped B's button…
    await expect(page.getByRole('button', { name: /add to collection/i })).toBeVisible()
    // …and B's collection data is untouched: exactly B's own item
    expect((await getCollection(page)).map((c) => c?.id)).toEqual([betaId])

    expect(errors).toEqual([])
  })
})
