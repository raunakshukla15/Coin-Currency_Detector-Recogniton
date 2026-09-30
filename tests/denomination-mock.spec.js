import { test, expect } from '@playwright/test'
import { uniqueUser, signup, trackPageErrors, FIXTURE_NOTE } from './helpers.js'

// Denomination display integrity with a MOCKED /api/ai/identify (no Gemini
// quota). Regression for the reported "₹2 shown as ₹10" class of bugs:
// the result page must render Gemini's denomination VERBATIM, and when the
// denomination is absent it must show the neutral '—' — never a static
// catalogue default (TYPE_DEFAULTS) substituted from the "type" label.

async function mockIdentify(page, items) {
  await page.route('**/api/ai/identify', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ items, authenticity: null })
    })
  )
}

async function detectToResult(page) {
  await page.goto('/home')
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_NOTE)
  await expect(page.getByText(/Image ready for identification/i)).toBeVisible({
    timeout: 15_000
  })
  await page.getByRole('button', { name: /^detect/i }).first().click()
  await expect(page).toHaveURL(/\/result/, { timeout: 20_000 })
}

test.describe('Denomination display integrity (mocked Gemini)', () => {
  test('Gemini denomination is shown verbatim even when type=rupee10', async ({ page }) => {
    const errors = trackPageErrors(page)
    await signup(page, uniqueUser())

    await mockIdentify(page, [
      {
        kind: 'coin',
        name: '2 Rupees (₹2)',
        country: 'India',
        year: '2019',
        denomination: '2 Rupees (₹2)',
        type: 'rupee10',
        match: 74
      }
    ])
    await detectToResult(page)

    const cell = page
      .locator('.result-facts .glass-card-soft')
      .filter({ hasText: /denomination/i })
      .first()
    await expect(cell).toBeVisible()
    await expect(cell).toContainText('2 Rupees (₹2)')
    // The static TYPE_DEFAULTS value for type=rupee10 must never appear.
    await expect(page.getByText('10 Rupees (₹10)')).toHaveCount(0)

    expect(errors).toEqual([])
  })

  test('missing denomination shows neutral —, never a catalogue default', async ({ page }) => {
    const errors = trackPageErrors(page)
    await signup(page, uniqueUser())

    await mockIdentify(page, [
      {
        kind: 'coin',
        name: 'Unlabeled Modern Coin',
        country: 'India',
        type: 'rupee10',
        match: 55
      }
    ])
    await detectToResult(page)

    const cell = page
      .locator('.result-facts .glass-card-soft')
      .filter({ hasText: /denomination/i })
      .first()
    await expect(cell).toBeVisible()
    await expect(cell).toContainText('—')
    // No static defaults may leak in from the type label.
    await expect(page.getByText('10 Rupees (₹10)')).toHaveCount(0)
    await expect(page.getByText('5 Rupees (₹5)')).toHaveCount(0)

    expect(errors).toEqual([])
  })

  test('currency note denomination is also passed through verbatim', async ({ page }) => {
    const errors = trackPageErrors(page)
    await signup(page, uniqueUser())

    await mockIdentify(page, [
      {
        kind: 'currency',
        name: 'Test Note',
        country: 'India',
        currencyName: 'Indian Rupee',
        denomination: '20 Indian Rupees (₹20)',
        match: 80
      }
    ])
    await detectToResult(page)

    const cell = page
      .locator('.result-facts .glass-card-soft')
      .filter({ hasText: /denomination/i })
      .first()
    await expect(cell).toBeVisible()
    await expect(cell).toContainText('20 Indian Rupees (₹20)')

    expect(errors).toEqual([])
  })
})
