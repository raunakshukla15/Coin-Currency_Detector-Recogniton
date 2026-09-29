import { test, expect } from '@playwright/test'
import { uniqueUser, signup, trackPageErrors } from './helpers.js'

// Currency converter functional audit: bundled-rate conversion math,
// amount handling, swap, and the two selectors (pure client-side data).

function resultBox(page) {
  return page.locator('.label:text-is("Converted Result") + div')
}

async function resultNumber(page) {
  const text = (await resultBox(page).innerText()).replace(/\s+/g, '')
  return text.replace(/[^\d.,]/g, '')
}

test.describe('Currency Converter', () => {
  test('defaults: 100 INR -> EUR using the bundled reference rate', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)
    await page.goto('/converter')

    await expect(page.getByTestId('converter-amount')).toHaveValue('100')
    await expect(page.getByText('INR → EUR')).toBeVisible()

    const from = page.locator('select.input').nth(0)
    const to = page.locator('select.input').nth(1)
    await expect(from).toHaveValue('INR')
    await expect(to).toHaveValue('EUR')

    // 100 INR * 0.0091 EUR/INR = 0.91 EUR (hardcoded expectation from the
    // bundled rates table — not computed via the app's own convert()).
    expect(await resultNumber(page)).toBe('0.91')
    await expect(page.getByText('1 INR = 0.0091 EUR').first()).toBeVisible()

    expect(errors).toEqual([])
  })

  test('changing the amount recalculates the result and rate lines stay consistent', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)
    await page.goto('/converter')

    await page.getByTestId('converter-amount').fill('250')
    // 250 * 0.0091 = 2.275
    await expect.poll(() => resultNumber(page)).toBe('2.275')

    await page.getByTestId('converter-amount').fill('1')
    await expect.poll(() => resultNumber(page)).toBe('0.0091')

    expect(errors).toEqual([])
  })

  test('invalid amounts (negative, empty) show 0.00 — never NaN or a crash', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)
    await page.goto('/converter')

    const amount = page.getByTestId('converter-amount')
    await amount.fill('-5')
    await expect(amount).toHaveValue('')
    expect(await resultNumber(page)).toBe('0.00')

    await amount.fill('0')
    await expect.poll(() => resultNumber(page)).toBe('0.00')

    await amount.clear()
    await expect.poll(() => resultNumber(page)).toBe('0.00')

    // No NaN anywhere in the converter UI
    expect(await page.locator('.converter-page').innerText()).not.toContain('NaN')

    expect(errors).toEqual([])
  })

  test('swap flips the pair and recalculates (EUR -> INR)', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)
    await page.goto('/converter')

    await page.getByRole('button', { name: 'Swap currencies' }).click()

    const from = page.locator('select.input').nth(0)
    const to = page.locator('select.input').nth(1)
    await expect(from).toHaveValue('EUR')
    await expect(to).toHaveValue('INR')
    await expect(page.getByText('EUR → INR')).toBeVisible()

    // 100 EUR / 0.0091 = 10,989.011 INR
    await expect.poll(() => resultNumber(page)).toBe('10,989.011')
    await expect(page.getByText('1 EUR = 109.8901 INR').first()).toBeVisible()

    expect(errors).toEqual([])
  })

  test('selects exclude the opposite side; changing From updates result and header', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)
    await page.goto('/converter')

    const from = page.locator('select.input').nth(0)
    const to = page.locator('select.input').nth(1)

    // From must not offer the current To (and vice versa)
    await expect(from.locator('option[value="EUR"]')).toHaveCount(0)
    await expect(to.locator('option[value="INR"]')).toHaveCount(0)
    await expect(from.locator('option[value="USD"]')).toHaveCount(1)
    await expect(from.locator('option')).toHaveCount(31) // 32 currencies minus EUR

    await from.selectOption('USD')
    await expect(page.getByText('USD → EUR')).toBeVisible()
    // 100 / 0.0117 USD * 0.0091 EUR = 77.7778 EUR; rate 0.7778
    await expect.poll(() => resultNumber(page)).toBe('77.7778')
    await expect(page.getByText('1 USD = 0.7778 EUR').first()).toBeVisible()

    // From still excludes the To side (EUR); To now excludes the new From
    // (USD) and offers INR again.
    await expect(from.locator('option[value="EUR"]')).toHaveCount(0)
    await expect(from.locator('option[value="USD"]')).toHaveCount(1)
    await expect(to.locator('option[value="USD"]')).toHaveCount(0)
    await expect(to.locator('option[value="INR"]')).toHaveCount(1)

    expect(errors).toEqual([])
  })
})
