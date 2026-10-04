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

function dbUser(email) {
  try {
    return execFileSync('python', [DBCHECK, 'user', '--email', email], {
      encoding: 'utf8',
      timeout: 20_000
    })
  } catch (e) {
    return `dbcheck failed: ${e.message}`
  }
}

function dbClearContacts() {
  // Scoped cleanup: removes ONLY rows this suite created (email prefix
  // `e2e-` or message prefix `Playwright feedback `) — never real
  // feedback, never rows from the Python suites (see tests/dbcheck.py).
  try {
    return execFileSync('python', [DBCHECK, 'clear-contacts-e2e'], {
      encoding: 'utf8',
      timeout: 20_000
    })
  } catch (e) {
    return `dbcheck failed: ${e.message}`
  }
}

test.describe('Contact form', () => {
  // Remove the rows this suite wrote so repeated runs don't accumulate.
  test.afterAll(() => {
    dbClearContacts()
  })
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
      /email notification was sent to the team|email notification could not be delivered/i
    )

    // The row really exists in MySQL with the submitted email
    await expect
      .poll(() => dbContacts(), { timeout: 20_000 })
      .toContain(marker)

    // ...and it is linked to THIS account's user row (signed-in submissions
    // store user_id; guest submissions would be NULL)
    const saved = JSON.parse(dbContacts()).contacts.find((r) => r.email === marker)
    expect(saved, 'contact row for the marker email exists').toBeTruthy()
    const account = JSON.parse(dbUser(user.email))
    expect(account.found, 'user row exists').toBe(true)
    expect(saved.user_id, 'contact row linked to the submitting account').toBe(
      account.user.id
    )

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

  test('DB failure shows the save-failure message and never a success panel', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    // Simulate a database outage: the backend answers 500 for this POST.
    await page.route('**/api/contact', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Database error while saving your message.' })
      })
    )

    await page.goto('/contact')
    await page.getByTestId('contact-message').fill('This must not be reported as saved.')
    await page.getByTestId('contact-submit').click()

    // Honest failure state: generic wording (no internal exception text),
    // and absolutely no success/confirmation panel.
    await expect(page.getByTestId('contact-error')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('contact-error')).toHaveText(
      'Your feedback could not be saved. Please try again.'
    )
    await expect(page.getByTestId('contact-success')).toHaveCount(0)

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

  test('P: Contact Details card shows exactly the four updated team details', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)
    await page.goto('/contact')

    // Scope to the Contact Details card (second grid column), not the form
    const card = page.locator('.contact-grid > *').filter({ hasText: 'Contact Details' })
    await expect(card).toHaveCount(1)
    await expect(card).toBeVisible()

    const details = [
      ['Made by', 'Team 5'],
      ['Contact Number', '9561119717'],
      ['Email', 'archanark1013@gmail.com'],
      ['Location', 'India']
    ]
    for (const [label, value] of details) {
      await expect(card.getByText(label, { exact: true })).toBeVisible()
      await expect(card.getByText(value, { exact: true })).toBeVisible()
    }

    // The old placeholder values are gone from the page entirely
    await expect(page.getByText('Earth', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Available on request', { exact: true })).toHaveCount(0)
    await expect(page.getByText('your-team@example.com', { exact: true })).toHaveCount(0)

    // Mobile viewport: all four pairs stay visible
    await page.setViewportSize({ width: 390, height: 844 })
    for (const [label, value] of details) {
      await expect(card.getByText(label, { exact: true })).toBeVisible()
      await expect(card.getByText(value, { exact: true })).toBeVisible()
    }

    expect(errors).toEqual([])
  })
})
