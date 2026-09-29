import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  uniqueUser,
  signup,
  logout,
  trackPageErrors,
  getCollection,
  getScans,
  apiToken,
  BACKEND_URL
} from './helpers.js'

// Three synthetic accounts (A, B, C) rotated across Collection, Upload
// History and Chatbot WITHOUT any page reload between switches — extends
// the two-account coverage in account-switch.spec.js to a full A -> B -> C
// -> A rotation and adds direct DB (dbcheck) assertions per account.
// Runs against the disposable coinscan_e2e_test database.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DBCHECK = path.join(__dirname, 'dbcheck.py')
const TS = Date.now()

function dbRows(cmd, email) {
  try {
    return execFileSync('python', [DBCHECK, cmd, '--email', email], {
      encoding: 'utf8',
      timeout: 20_000
    })
  } catch (e) {
    return `dbcheck failed: ${e.message}`
  }
}

function item(name) {
  return { kind: 'coin', country: 'India', year: '1975', material: 'nickel', name }
}

async function navTo(page, label) {
  await page.getByRole('button', { name: label, exact: true }).click()
}

async function loginNoReload(page, user) {
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

async function seedChat(page, token, title) {
  const res = await page.request.post(`${BACKEND_URL}/api/chats`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title }
  })
  expect(res.ok(), `chat seed failed: ${await res.text()}`).toBeTruthy()
}

async function seedAccount(page, token, m) {
  const col = await page.request.post(`${BACKEND_URL}/api/collection`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { coinId: m.coinId, item: item(m.coinName) }
  })
  expect(col.ok(), `collection seed failed: ${await col.text()}`).toBeTruthy()
  const scan = await page.request.post(`${BACKEND_URL}/api/scans`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { items: [{ name: m.scanName, country: 'India', year: '1991', match: 91 }], image: null, authenticity: null }
  })
  expect(scan.ok(), `scan seed failed: ${await scan.text()}`).toBeTruthy()
  await seedChat(page, token, m.chatTitle)
}

test.describe('Three accounts (A/B/C) isolation', () => {
  test('A, B and C each see only their own Collection, History and Chatbot data across a no-reload A -> B -> C -> A rotation', async ({
    page
  }) => {
    test.setTimeout(180_000)
    const errors = trackPageErrors(page)
    const A = uniqueUser()
    const B = uniqueUser()
    const C = uniqueUser()
    const mA = {
      coinId: `3ac-a-${TS}`,
      coinName: `Three Acct Coin A ${TS}`,
      scanName: `Three Acct Scan A ${TS}`,
      chatTitle: `Three Acct Chat A ${TS}`
    }
    const mB = {
      coinId: `3ac-b-${TS}`,
      coinName: `Three Acct Coin B ${TS}`,
      scanName: `Three Acct Scan B ${TS}`,
      chatTitle: `Three Acct Chat B ${TS}`
    }
    const mC = {
      coinId: `3ac-c-${TS}`,
      coinName: `Three Acct Coin C ${TS}`,
      scanName: `Three Acct Scan C ${TS}`,
      chatTitle: `Three Acct Chat C ${TS}`
    }
    const all = [mA, mB, mC]

    async function others(m) {
      return all.filter((x) => x !== m)
    }

    // --- A registers through the UI; B and C are created through the API
    // (both registration paths are exercised) and all three get data. ---
    await signup(page, A)
    const tokenA = await apiToken(page)
    await seedAccount(page, tokenA, mA)
    const tokenB = await createAccountViaApi(page, B)
    await seedAccount(page, tokenB, mB)
    const tokenC = await createAccountViaApi(page, C)
    await seedAccount(page, tokenC, mC)

    // The SPA fetched A's collection while it was still empty (initial mount).
    // One reload gives the app a fresh initial fetch — the no-reload
    // requirement applies to the A -> B -> C -> A switches below (same
    // allowance as account-switch.spec.js's first view).
    await page.reload()
    await page.waitForURL('**/home', { timeout: 20_000 })

    // --- While signed in as A, A views all three pages over the SPA. ---
    async function assertOnlyMine(m) {
      const foreign = await others(m)

      await navTo(page, 'Collection')
      await expect(page.getByText(m.coinName).first()).toBeVisible({ timeout: 15_000 })
      for (const f of foreign) {
        await expect(page.getByText(f.coinName)).toHaveCount(0)
      }

      await navTo(page, 'Upload History')
      await expect(page.getByText(m.scanName).first()).toBeVisible({ timeout: 15_000 })
      for (const f of foreign) {
        await expect(page.getByText(f.scanName)).toHaveCount(0)
      }

      await navTo(page, 'Chatbot')
      await expect(page.getByText(m.chatTitle).first()).toBeVisible({ timeout: 15_000 })
      for (const f of foreign) {
        await expect(page.getByText(f.chatTitle)).toHaveCount(0)
      }

      // API session (localStorage token belongs to the current user only)
      const items = await getCollection(page)
      expect(items.map((i) => i.id).sort()).toEqual([m.coinId])
      const scans = await getScans(page)
      expect(JSON.stringify(scans)).toContain(m.scanName)
      for (const f of foreign) {
        expect(JSON.stringify(scans), `scans leak from ${f.scanName}`).not.toContain(f.scanName)
      }

      // Direct DB rows: only this account's rows exist for these markers
      const collectionJson = dbRows('collection', userFor(m).email)
      expect(collectionJson).toContain(m.coinId)
      const scansJson = dbRows('scans', userFor(m).email)
      expect(scansJson).toContain(m.scanName)
      const chatsJson = dbRows('chats', userFor(m).email)
      expect(chatsJson).toContain(m.chatTitle)
      for (const f of foreign) {
        expect(collectionJson, `collection leak into ${f.coinId}`).not.toContain(f.coinId)
        expect(scansJson, `scan leak into ${f.scanName}`).not.toContain(f.scanName)
        expect(chatsJson, `chat leak into ${f.chatTitle}`).not.toContain(f.chatTitle)
      }
    }

    function userFor(m) {
      if (m === mA) return A
      if (m === mB) return B
      return C
    }

    await assertOnlyMine(mA)

    // --- Rotate A -> B with NO reload, then B -> C, then C -> A. ---
    await logout(page)
    await loginNoReload(page, B)
    await assertOnlyMine(mB)

    await logout(page)
    await loginNoReload(page, C)
    await assertOnlyMine(mC)

    await logout(page)
    await loginNoReload(page, A)
    await assertOnlyMine(mA)

    expect(errors).toEqual([])
  })
})
