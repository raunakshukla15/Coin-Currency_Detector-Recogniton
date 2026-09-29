import { test, expect } from '@playwright/test'
import {
  uniqueUser,
  signup,
  logout,
  trackPageErrors,
  seedCollection,
  getCollection,
  seedScan,
  getScans,
  apiToken,
  BACKEND_URL
} from './helpers.js'

// Regression spec for the account-switch collection bug: CollectionProvider
// used to fetch once with [] deps and logout() never cleared the cache, so
// after logout -> login as a DIFFERENT account (without any page reload)
// account B still saw account A's collection items.
//
// The whole point of this test: NO page.goto/navigation reload happens
// between A's data being loaded and B inspecting the collection.

const TS = Date.now()

function item(name) {
  return { kind: 'coin', country: 'India', year: '1975', material: 'nickel', name }
}

async function navTo(page, label) {
  // Sidebar nav items are <button>s using react-router navigate() — SPA only.
  await page.getByRole('button', { name: label, exact: true }).click()
}

async function loginNoReload(page, user) {
  // We are already on /login (post-logout). Fill the form — never goto().
  await page.fill('#identifier', user.username)
  await page.fill('#password', user.password)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL('**/home', { timeout: 20_000 })
}

async function createAccountViaApi(page, user) {
  const res = await page.request.post(`${BACKEND_URL}/api/auth/signup`, {
    data: { username: user.username, email: user.email, password: user.password }
  })
  expect(res.status(), `signup API failed: ${await res.text()}`).toBe(200)
  return (await res.json()).token
}

async function seedWithToken(page, token, entries) {
  for (const { coinId, item } of entries) {
    const res = await page.request.post(`${BACKEND_URL}/api/collection`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { coinId, item }
    })
    expect(res.ok(), `seed ${coinId} failed: ${res.status()} ${await res.text()}`).toBeTruthy()
  }
}

test.describe('Account switch (no reload)', () => {
  test('after logout -> login as another user, the collection never leaks across accounts', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const userA = uniqueUser()
    const userB = uniqueUser()
    const coinA = `sw-alpha-${TS}`
    const coinB = `sw-beta-${TS}`

    // --- Account A: seed + view. The initial view may use a normal load;
    // the NO-RELOAD requirement starts at logout below. ---
    await signup(page, userA)
    await seedCollection(page, [
      { coinId: coinA, item: item('Alpha Legacy Coin') }
    ])
    await page.goto('/collection')
    await expect(page.getByText('Alpha Legacy Coin').first()).toBeVisible({ timeout: 15_000 })

    // --- Logout A (SPA button — NO reload), create B + seed B's data via
    // API with B's token, then login B without any navigation. ---
    await logout(page)
    const tokenB = await createAccountViaApi(page, userB)
    await seedWithToken(page, tokenB, [{ coinId: coinB, item: item('Beta Modern Coin') }])
    await loginNoReload(page, userB)

    // B inspects the collection over SPA: B's own item must be there,
    // A's must NOT (the original bug showed Alpha here).
    await navTo(page, 'Collection')
    await expect(page.getByText('Beta Modern Coin').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Alpha Legacy Coin')).toHaveCount(0)

    // API check with B's token: only B's coin id.
    const itemsB = await getCollection(page)
    expect(itemsB.map((i) => i.id).sort()).toEqual([coinB])

    // --- Switch back to A, still without any reload ---
    await logout(page)
    await loginNoReload(page, userA)
    await navTo(page, 'Collection')
    await expect(page.getByText('Alpha Legacy Coin').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Beta Modern Coin')).toHaveCount(0)

    const itemsA = await getCollection(page)
    expect(itemsA.map((i) => i.id).sort()).toEqual([coinA])

    expect(errors).toEqual([])
  })

  test('seeded scan history stays with its owner across the same no-reload switch', async ({
    page
  }) => {
    const userA = uniqueUser()
    const userB = uniqueUser()

    await signup(page, userA)
    await seedScan(page, {
      items: [{ name: 'Switch Probe Scan', country: 'India', year: '1988', match: 88 }]
    })

    await logout(page)
    await createAccountViaApi(page, userB)
    await loginNoReload(page, userB)

    const scansB = await getScans(page)
    expect(
      JSON.stringify(scansB),
      'B sees A scan history after no-reload switch'
    ).not.toContain('Switch Probe Scan')
  })

  test('History and Chatbot PAGES never render the previous account data (no reload)', async ({
    page
  }) => {
    const userA = uniqueUser()
    const userB = uniqueUser()

    // --- Account A: one seeded upload + one seeded conversation. ---
    await signup(page, userA)
    await seedScan(page, {
      items: [{ name: 'UI History Probe A', country: 'India', year: '1993', match: 93 }]
    })
    const tokenA = await apiToken(page)
    const chatRes = await page.request.post(`${BACKEND_URL}/api/chats`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { title: 'UI Chat Probe A' }
    })
    expect(chatRes.ok(), `chat seed failed: ${await chatRes.text()}`).toBeTruthy()

    // A actually views both pages (data loaded into page state).
    await page.goto('/history')
    await expect(page.getByText('UI History Probe A').first()).toBeVisible({ timeout: 15_000 })
    await page.goto('/chatbot')
    await expect(page.getByText('UI Chat Probe A').first()).toBeVisible({ timeout: 15_000 })

    // --- Switch to B with NO reload/navigation between A viewing and B checking. ---
    await logout(page)
    await createAccountViaApi(page, userB)
    await loginNoReload(page, userB)

    // Upload History: B sees the empty state, never A's upload.
    await navTo(page, 'Upload History')
    await expect(page.getByText('UI History Probe A')).toHaveCount(0)
    await expect(page.getByText('No uploads yet')).toBeVisible({ timeout: 15_000 })

    // Chatbot: B sees the empty state, never A's conversation.
    await navTo(page, 'Chatbot')
    await expect(page.getByText('UI Chat Probe A')).toHaveCount(0)
    await expect(page.getByText('No conversations yet')).toBeVisible({ timeout: 15_000 })

    // Server-side check with B's own session: still zero scans.
    const scansB = await getScans(page)
    expect(JSON.stringify(scansB)).not.toContain('UI History Probe A')
  })
})
