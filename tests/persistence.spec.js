import { test, expect } from '@playwright/test'
import {
  uniqueUser,
  signup,
  trackPageErrors,
  seedScan,
  getScans
} from './helpers.js'

test.describe('Auth + data persistence', () => {
  test('session survives a full page reload (server-side JWT)', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    // TopBar shows the logged-in username while the session is valid
    await expect(page.locator('.hbtn-profile')).toContainText(user.username, {
      timeout: 15_000
    })

    await page.reload()

    // Still authenticated after reload: profile button visible, /login blocked
    await expect(page.locator('.hbtn-profile')).toContainText(user.username, {
      timeout: 15_000
    })
    await page.goto('/login')
    await page.waitForURL(/\/home/, { timeout: 15_000 })

    expect(errors).toEqual([])
  })

  test('seeded scan history: View Result renders the stored scan, delete removes it', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    // Server-seeded scan (no AI quota needed). authenticity.status must be
    // one of the MySQL ENUM values (schema.sql line 75).
    const items = [
      {
        name: 'Persistence Test Rupee',
        kind: 'coin',
        country: 'India',
        year: '2011',
        category: 'Common',
        rarity: 'Common',
        price: 45,
        match: 88
      }
    ]
    await seedScan(page, {
      items,
      authenticity: {
        status: 'LIKELY_GENUINE',
        message: 'Seeded image-analysis assessment for the persistence test.'
      }
    })

    await page.goto('/history')
    const row = page.locator('.glass-card, tr, .history-row').filter({
      hasText: 'Persistence Test Rupee'
    })
    await expect(
      page.getByText('Persistence Test Rupee').first()
    ).toBeVisible({ timeout: 15_000 })

    // Open the stored scan result from history
    await page.getByRole('button', { name: /view result/i }).first().click()
    await page.waitForURL('**/result', { timeout: 15_000 })
    await expect(page.getByText('Persistence Test Rupee')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/\d+%\s*Match/).first()).toBeVisible()

    // The seeded authenticity status from the server is shown with its
    // proper label (LIKELY_GENUINE -> "No obvious suspicious signs
    // detected"), never invented
    await expect(page.getByText(/No obvious suspicious signs detected/i)).toBeVisible()

    // Back to history, delete the scan, verify it is gone on the server too.
    // Scoped to the seeded entry's card: the sidebar also has a "Delete
    // Account" button that would otherwise match .first().
    await page.goto('/history')
    await row.getByRole('button', { name: /delete/i }).first().click()
    // confirmation dialog if present
    const confirm = page.getByRole('button', { name: /^(yes|confirm|delete)$/i })
    if (await confirm.count()) await confirm.first().click()

    await expect
      .poll(async () => (await getScans(page)).length, { timeout: 10_000 })
      .toBe(0)

    expect(errors).toEqual([])
  })

  test('tampered JWT is rejected: session cleared, redirected to /login', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    // Corrupt the stored token (not a valid signature)
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('coinscan_auth'))
      raw.token = 'garbage.token.value'
      localStorage.setItem('coinscan_auth', JSON.stringify(raw))
    })

    // Navigating triggers a real API call -> 401 -> cleared -> redirected
    await page.goto('/collection')
    await page.waitForURL(/\/login/, { timeout: 15_000 })
    await expect(page.getByRole('button', { name: /^log in$/i })).toBeVisible({
      timeout: 15_000
    })

    // Token really is gone (the app cleared the corrupted session)
    const stored = await page.evaluate(() => localStorage.getItem('coinscan_auth'))
    expect(stored).toBeNull()

    expect(errors).toEqual([])
  })
})
