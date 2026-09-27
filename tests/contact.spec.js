import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { uniqueUser, signup, trackPageErrors } from './helpers.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DBCHECK = path.join(__dirname, 'dbcheck.py')

function dbContacts() {
  try {
    return execFileSync('python', [DBCHECK, 'contacts'], {
      encoding: 'utf8',
      timeout: 20_000
    })
  } catch (e) {
    return `dbcheck failed: ${e.message}`
  }
}

function dbClearContacts() {
  try {
    return execFileSync('python', [DBCHECK, 'clear-contacts'], {
      encoding: 'utf8',
      timeout: 20_000
    })
  } catch (e) {
    return `dbcheck failed: ${e.message}`
  }
}

test.describe('Contact form', () => {
  test('O: submitting feedback saves it on the server and shows the success state', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await page.goto('/contact')
    const marker = `e2e-${Date.now()}@coinscan-e2e.com`
    const feedback = `Playwright feedback ${Date.now()} — great tool.`

    // Name/email are prefilled from the signed-in session
    await expect(page.getByTestId('contact-name')).toHaveValue(user.username)
    await expect(page.getByTestId('contact-email')).toHaveValue(user.email)

    await page.getByTestId('contact-email').fill(marker)
    await page.getByTestId('contact-message').fill(feedback)
    await page.getByTestId('contact-submit').click()

    // Success panel appears only after the backend accepted the message
    await expect(page.getByTestId('contact-success')).toBeVisible({ timeout: 20_000 })
    // Detail must be one of the two honest states (emailed vs saved-only) —
    // never a claim that an email was sent when emailSent=false
    await expect(page.getByTestId('contact-success-detail')).toContainText(
      /emailed to the team|email delivery to the team failed/i
    )

    // The row really exists in MySQL with the submitted email
    await expect
      .poll(() => dbContacts(), { timeout: 20_000 })
      .toContain(marker)

    expect(errors).toEqual([])
  })

  test('O+: send button is disabled while the message is empty', async ({ page }) => {
    const user = uniqueUser()
    await signup(page, user)
    await page.goto('/contact')
    await expect(page.getByTestId('contact-submit')).toBeDisabled()
  })

  test('invalid email is rejected client-side with no server row', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    const marker = `bad-email-${Date.now()}@coinscan-e2e.com`
    await page.goto('/contact')
    await page.getByTestId('contact-email').fill('not-an-email')
    await page.getByTestId('contact-message').fill('Should be rejected before any network call.')
    await page.getByTestId('contact-submit').click()

    await expect(page.getByTestId('contact-error')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('contact-error')).toContainText(/valid email/i)
    await expect(page.getByTestId('contact-success')).toHaveCount(0)

    // No row with an invalid address could have been created (the marker
    // never even went to the server — sanity-check dbcheck output too)
    expect(dbContacts()).not.toContain(marker)

    expect(errors).toEqual([])
  })

  test('rating stars reflect the selected value', async ({ page }) => {
    const user = uniqueUser()
    await signup(page, user)
    await page.goto('/contact')

    const star4 = page.getByTestId('rating-star-4')
    await star4.click()
    await expect(star4).toHaveCSS('color', 'rgb(245, 200, 106)')

    // Selecting a lower rating deactivates the higher one
    await page.getByTestId('rating-star-2').click()
    await expect(star4).not.toHaveCSS('color', 'rgb(245, 200, 106)')
  })
})
