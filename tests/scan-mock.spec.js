import { test, expect } from '@playwright/test'
import {
  uniqueUser,
  signup,
  trackPageErrors,
  seedScan,
  getScans,
  getCollection,
  FIXTURE_NOTE
} from './helpers.js'

// Image upload / recognition flow with a MOCKED /api/ai/identify (no Gemini
// quota). Scan history + collection use the real backend (e2e database).

async function mockIdentify(page, { items, authenticity = null, status = 200, detail } = {}) {
  const state = { count: 0 }
  await page.route('**/api/ai/identify', async (route) => {
    state.count += 1
    await route.fulfill(
      status === 200
        ? {
            contentType: 'application/json',
            body: JSON.stringify({ items, authenticity })
          }
        : {
            status,
            contentType: 'application/json',
            body: JSON.stringify({ detail })
          }
    )
  })
  return state
}

async function pickAndDetect(page) {
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_NOTE)
  await expect(page.getByText(/Image ready for identification/i)).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /^detect/i }).first().click()
}

test.describe('Image upload + recognition (mocked AI) and scan history', () => {
  test('success flow: result page fields, history entry, add to collection', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    const identify = await mockIdentify(page, {
      items: [
        {
          kind: 'coin',
          name: 'Mock Rupee',
          country: 'India',
          year: '1998',
          denomination: '5 Rupees',
          composition: 'Cupro-Nickel',
          match: 91
        }
      ],
      authenticity: {
        status: 'LIKELY_GENUINE',
        message: 'Mock authenticity assessment for the audit.',
        indicators: [],
        confidence: 80
      }
    })

    await page.goto('/home')
    await pickAndDetect(page)

    await expect(page).toHaveURL(/\/result/, { timeout: 20_000 })
    expect(identify.count).toBe(1)

    // Result page shows the mocked fields — no fabrication
    await expect(page.getByRole('heading', { name: 'Mock Rupee' })).toBeVisible()
    await expect(page.getByText('INDIA', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/91% Match/)).toBeVisible()
    await expect(page.getByText(/Authenticity: Likely genuine/)).toBeVisible()
    await expect(page.getByText('Estimated Value')).toBeVisible()
    await expect(page.getByText(/Coin Identified/)).toBeVisible()

    // Add to collection (real backend; the context saves optimistically
    // without awaiting, so poll until the server confirms)
    await page.getByRole('button', { name: /add to collection/i }).click()
    await expect(page.getByText(/Added Mock Rupee/)).toBeVisible()
    await expect(page.getByRole('button', { name: /in collection/i })).toBeVisible()
    await expect
      .poll(
        async () => (await getCollection(page)).some((c) => c?.name === 'Mock Rupee'),
        { timeout: 15_000 }
      )
      .toBe(true)

    // The scan was persisted to history (real backend)
    await page.goto('/history')
    const rows = page.locator('.glass-card, tr, .history-row').filter({ hasText: 'Mock Rupee' })
    await expect(rows).toHaveCount(1)

    expect(errors).toEqual([])
  })

  test('no detection: honest failure modal, no result page, nothing saved', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    const identify = await mockIdentify(page, { items: [], authenticity: null })
    await page.goto('/home')
    await pickAndDetect(page)

    await expect(page.getByText('Identification Failed')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/not a supported currency\/coin image/i)).toBeVisible()
    expect(page.url()).not.toContain('/result')
    expect(identify.count).toBe(1)

    // Nothing was written to history
    expect((await getScans(page)).length).toBe(0)

    // Modal closes, user stays on /home (the modal's own X is aria-labelled)
    await page.getByLabel('Close').first().click()
    await expect(page.getByText('Identification Failed')).toHaveCount(0)
    await expect(page).toHaveURL(/\/home/)

    expect(errors).toEqual([])
  })

  test('backend failure (502): failure modal shows the real detail, no fake result', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await mockIdentify(page, { status: 502, detail: 'Vision service down (mock).', items: null })
    await page.goto('/home')
    await pickAndDetect(page)

    await expect(page.getByText('Identification Failed')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Vision service down (mock).')).toBeVisible()
    expect(page.url()).not.toContain('/result')
    expect((await getScans(page)).length).toBe(0)

    expect(errors).toEqual([])
  })

  test('non-image file: visible modal, no upload request at all', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    // Safety net: if a request ever went out it must not reach the real AI
    const identify = await mockIdentify(page, { status: 503, detail: 'unexpected', items: null })
    await page.goto('/home')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'not-a-coin.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('definitely not an image')
    })

    await expect(page.getByText('Unsupported File')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/is not an image/i)).toBeVisible()
    expect(identify.count).toBe(0)

    await page.getByLabel('Close').first().click()
    await expect(page.getByText('Unsupported File')).toHaveCount(0)

    expect(errors).toEqual([])
  })

  test('oversized image (>6 MB) is rejected by the backend validation with a clear message', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await page.goto('/home')
    // No route mock: this request must reach the real backend, whose
    // validation rejects it BEFORE any upstream AI call (no quota burn).
    await page.locator('input[type="file"]').setInputFiles({
      name: 'huge.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(7 * 1024 * 1024, 0x89)
    })
    await expect(page.getByText(/Image ready for identification/i)).toBeVisible({
      timeout: 15_000
    })
    await page.getByRole('button', { name: /^detect/i }).first().click()

    await expect(page.getByText('Identification Failed')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/max 6 MB/)).toBeVisible()
    expect(page.url()).not.toContain('/result')
    expect((await getScans(page)).length).toBe(0)

    expect(errors).toEqual([])
  })

  test('history clear-all is two-step: Clear All arms, Confirm Clear empties the server list', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await seedScan(page, {
      items: [{ name: 'Clear Probe One', kind: 'coin', country: 'India', year: '1991' }]
    })
    await seedScan(page, {
      items: [{ name: 'Clear Probe Two', kind: 'coin', country: 'India', year: '1992' }]
    })

    await page.goto('/history')
    const rows = page.locator('.glass-card, tr, .history-row').filter({ hasText: 'Clear Probe' })
    await expect(rows).toHaveCount(2)

    // First click only arms the confirmation — nothing is deleted yet
    await page.getByRole('button', { name: /clear all/i }).click()
    await expect(page.getByRole('button', { name: /confirm clear/i })).toBeVisible()
    await expect(rows).toHaveCount(2)
    expect((await getScans(page)).length).toBe(2)

    // Confirm actually clears, including server-side
    await page.getByRole('button', { name: /confirm clear/i }).click()
    await expect(page.getByText(/upload history cleared/i)).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => (await getScans(page)).length).toBe(0)
    await expect(rows).toHaveCount(0)

    expect(errors).toEqual([])
  })
})
