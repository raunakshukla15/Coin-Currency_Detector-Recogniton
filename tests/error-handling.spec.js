import { test, expect } from '@playwright/test'
import { uniqueUser, signup, trackPageErrors } from './helpers.js'

const NOTE_IMAGE = 'tests/fixtures/note.jpg'

test.describe('Error handling (backend unreachable)', () => {
  test('login failure keeps the user on /login with a real error message', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await page.goto('/signup')
    await signup(page, user)

    // Log out first: /login is PublicOnly and redirects authenticated users
    await page.getByRole('button', { name: /^logout$/i }).click()

    // Kill every backend call, then try to log in again
    await page.route('**/api/**', (route) => route.abort())
    await page.goto('/login')
    await page.fill('#identifier', user.username)
    await page.fill('#password', user.password)
    await page.getByRole('button', { name: /^log in$/i }).click()

    // Still on /login, showing the network error — never a fake success
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText(/backend unreachable/i)).toBeVisible({ timeout: 15_000 })

    // No page-level crash
    expect(errors).toEqual([])
  })

  test('contact form shows the saved/failed state honestly when the API is down', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await page.route('**/api/**', (route) => route.abort())
    await page.goto('/contact')
    await page.getByTestId('contact-name').fill('Offline Tester')
    await page.getByTestId('contact-email').fill('offline@coinscan-e2e.com')
    await page.getByTestId('contact-message').fill('Sending while the backend is down.')
    await page.getByTestId('contact-submit').click()

    // Total-failure state: no "saved" wording, real error surfaced
    await expect(page.getByTestId('contact-error')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('contact-error')).toContainText(/unreachable|failed|unable/i)
    await expect(page.getByTestId('contact-success')).toHaveCount(0)

    expect(errors).toEqual([])
  })

  test('image detection failure shows the Identification Failed modal, no fake result', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await page.route('**/api/**', (route) => route.abort())
    await page.goto('/home')
    await page.locator('input[type="file"]').setInputFiles(NOTE_IMAGE)
    await expect(page.getByText(/image ready for identification/i)).toBeVisible({
      timeout: 15_000
    })

    await page.getByRole('button', { name: /^detect/i }).first().click()

    // Modal with a friendly, truthful error — and NO navigation to /result
    await expect(page.getByText('Identification Failed')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/backend unreachable/i)).toBeVisible()
    expect(page.url()).not.toContain('/result')

    expect(errors).toEqual([])
  })

  test('chatbot shows an error bubble instead of inventing an answer', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await page.route('**/api/**', (route) => route.abort())
    await page.goto('/chatbot')
    await page.getByPlaceholder('Ask CoinScan AI anything about coins...').fill('Is this coin genuine?')
    await page.getByRole('button', { name: /send message/i }).click()

    // The assistant bubble carries a failure message, never a fabricated answer
    await expect(
      page.getByText(/unavailable|unreachable|couldn't|try again/i).first()
    ).toBeVisible({ timeout: 20_000 })
    // The user's own question is still shown
    await expect(page.getByText('Is this coin genuine?')).toBeVisible()

    expect(errors).toEqual([])
  })

  test('backend outage during reload keeps the session optimistically (no crash)', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    // Backend down, frontend still served: /me fails with a network error,
    // which must NOT clear the session (AuthContext restores optimistically)
    await page.route('**/api/**', (route) => route.abort())
    await page.reload({ waitUntil: 'domcontentloaded' })

    await expect(page.locator('.hbtn-profile')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.hbtn-profile')).toContainText(user.username)

    // Backend back: the same session is genuinely valid server-side
    // (RequireAuth would redirect to /login on a 401; TopBar only renders
    // on /home /result /history, hence the two-step check)
    await page.unroute('**/api/**')
    await page.goto('/collection')
    await expect(page).toHaveURL(/\/collection/, { timeout: 15_000 })
    await expect(page.getByRole('button', { name: /^logout$/i })).toBeVisible({
      timeout: 15_000
    })
    await page.goto('/home')
    await expect(page.locator('.hbtn-profile')).toContainText(user.username, {
      timeout: 15_000
    })

    expect(errors).toEqual([])
  })
})
