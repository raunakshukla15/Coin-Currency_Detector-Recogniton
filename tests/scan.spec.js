import { test, expect } from '@playwright/test'
import { uniqueUser, signup, trackPageErrors, FIXTURE_NOTE } from './helpers.js'

const ALLOWED_AUTH_STATUS =
  /Authenticity:\s*(No obvious suspicious signs detected|Potentially suspicious|Inconclusive)/i

test.describe('Currency identification end-to-end (real AI)', () => {
  test('H/I/J: upload note → identify → result shows items + allowed authenticity status', async ({
    page
  }) => {
    test.setTimeout(300_000)
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    // H — currency upload
    await page.setInputFiles('input[type="file"]', FIXTURE_NOTE)
    await expect(page.getByText(/image ready for identification/i)).toBeVisible({
      timeout: 15_000
    })

    // H — run detection (real vision call)
    await page.getByRole('button', { name: /detect coin/i }).click()
    await page.waitForURL('**/result', { timeout: 240_000 })

    // I — items listed
    await expect(page.getByText(/Identified/).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/match/i).first()).toBeVisible()

    // J — authenticity section with an allowed status (never VERIFIED_AUTHENTIC)
    await expect(page.getByText(ALLOWED_AUTH_STATUS)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/VERIFIED AUTHENTIC/i)).toHaveCount(0)

    expect(errors).toEqual([])
  })

  test('K: the identified scan persists to Upload History', async ({ page }) => {
    test.setTimeout(300_000)
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await page.setInputFiles('input[type="file"]', FIXTURE_NOTE)
    await page.getByRole('button', { name: /detect coin/i }).click()
    await page.waitForURL('**/result', { timeout: 240_000 })

    await page.getByRole('button', { name: /upload history/i }).click()
    await page.waitForURL('**/history', { timeout: 20_000 })

    await expect(page.getByText(/saved to your account/i)).toBeVisible({
      timeout: 20_000
    })
    await expect(page.getByRole('button', { name: /view result/i }).first()).toBeVisible({
      timeout: 20_000
    })

    // Reopen from history → result page shows the persisted authenticity status
    await page.getByRole('button', { name: /view result/i }).first().click()
    await page.waitForURL('**/result', { timeout: 20_000 })
    await expect(page.getByText(ALLOWED_AUTH_STATUS)).toBeVisible({ timeout: 20_000 })

    expect(errors).toEqual([])
  })

  test('N: add to collection from result, view it, remove it', async ({ page }) => {
    test.setTimeout(300_000)
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await page.setInputFiles('input[type="file"]', FIXTURE_NOTE)
    await page.getByRole('button', { name: /detect coin/i }).click()
    await page.waitForURL('**/result', { timeout: 240_000 })

    // Add
    await page.getByRole('button', { name: /add to collection/i }).first().click()
    await expect(
      page.getByRole('button', { name: /in collection/i }).first()
    ).toBeVisible({ timeout: 15_000 })

    // It shows up on the collection page
    await page.getByRole('button', { name: /^collection$/i }).click()
    await page.waitForURL('**/collection', { timeout: 20_000 })
    await expect(page.getByText(/your collection is empty/i)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /view details/i }).first()).toBeVisible({
      timeout: 15_000
    })

    // Remove it again from the result view
    await page.getByRole('button', { name: /view details/i }).first().click()
    await page.waitForURL('**/result', { timeout: 20_000 })
    await page.getByRole('button', { name: /remove from collection/i }).first().click()
    await expect(page.getByRole('button', { name: /add to collection/i }).first()).toBeVisible({
      timeout: 15_000
    })

    // Collection is empty again
    await page.getByRole('button', { name: /^collection$/i }).click()
    await page.waitForURL('**/collection', { timeout: 20_000 })
    await expect(page.getByText(/your collection is empty/i)).toBeVisible({ timeout: 15_000 })

    expect(errors).toEqual([])
  })
})
