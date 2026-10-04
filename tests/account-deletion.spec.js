import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { uniqueUser, signup, trackPageErrors, seedScan, getScans } from './helpers.js'

// Two-step account deletion: confirmation dialog -> password dialog ->
// DELETE /api/auth/account (real backend, real MySQL). Verifies the guards
// (cancel, empty password, show/hide, wrong password, duplicate submits),
// that state is cleared ONLY after backend success, that the old
// credentials/JWT are dead, and that username reuse starts clean.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DBCHECK = path.join(__dirname, 'dbcheck.py')

function dbJson(cmd, ...args) {
  try {
    return JSON.parse(
      execFileSync('python', [DBCHECK, cmd, ...args], { encoding: 'utf8', timeout: 20_000 })
    )
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

test.describe('Account deletion', () => {
  let cleanupEmail = null
  test.afterAll(() => {
    if (cleanupEmail) dbJson('clear-user', '--email', cleanupEmail)
  })

  test('two-step confirm, guards, wrong password, success cleanup, credential reuse', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    cleanupEmail = user.email
    await signup(page, user)
    await seedScan(page, {
      items: [{ name: 'Doomed Scan', kind: 'coin', country: 'India', year: '1999' }]
    })
    expect(dbJson('scans', '--email', user.email).scans?.length, 'seeded scan exists').toBe(1)

    let deleteRequests = 0
    let holdNextDelete = false
    await page.route('**/api/auth/account', async (route) => {
      deleteRequests += 1
      if (holdNextDelete) await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })

    await page.goto('/home')
    await page.evaluate(() => sessionStorage.setItem('coinscan_lastident', 'stale-preview'))

    // 1+2. First dialog opens, explains the consequence, Cancel does nothing
    await page.getByTestId('delete-account-trigger').click()
    const step1 = page.getByTestId('delete-confirm-step1')
    await expect(step1).toBeVisible()
    await expect(step1).toContainText(/permanently removes/i)
    await page.getByTestId('delete-cancel-1').click()
    await expect(page.getByTestId('delete-confirm-step1')).toHaveCount(0)
    expect(deleteRequests, 'cancel fired a request').toBe(0)
    expect(await page.evaluate(() => localStorage.getItem('coinscan_auth'))).toBeTruthy()
    expect(dbJson('user', '--email', user.email).found).toBe(true)

    // 3. Continue opens the password dialog WITHOUT deleting anything
    await page.getByTestId('delete-account-trigger').click()
    await page.getByTestId('delete-continue').click()
    await expect(page.getByTestId('delete-password-step2')).toBeVisible()
    await expect(page.getByTestId('delete-password-step2')).toContainText(/permanent/i)
    expect(deleteRequests, 'continue fired a delete request').toBe(0)
    expect(dbJson('user', '--email', user.email).found).toBe(true)

    // 4. Second-dialog Cancel does nothing either
    await page.getByTestId('delete-cancel-2').click()
    await expect(page.getByTestId('delete-password-step2')).toHaveCount(0)
    expect(deleteRequests).toBe(0)
    expect(await page.evaluate(() => localStorage.getItem('coinscan_auth'))).toBeTruthy()

    // 5. Empty password is rejected before any request
    await page.getByTestId('delete-account-trigger').click()
    await page.getByTestId('delete-continue').click()
    await page.getByTestId('delete-submit').click()
    await expect(page.getByTestId('delete-error')).toContainText('Please enter your current password')
    expect(deleteRequests, 'empty password reached the backend').toBe(0)

    // 6. Show/hide password control
    const input = page.getByTestId('delete-password-input')
    const toggle = page.getByTestId('delete-password-toggle')
    await expect(input).toHaveAttribute('type', 'password')
    await toggle.click()
    await expect(input).toHaveAttribute('type', 'text')
    await expect(toggle).toHaveAttribute('aria-label', 'Hide password')
    await toggle.click()
    await expect(input).toHaveAttribute('type', 'password')
    await expect(toggle).toHaveAttribute('aria-label', 'Show password')

    // 7. Wrong password: honest error, session NOT cleared, nothing deleted
    await input.fill('definitely-not-my-password')
    await page.getByTestId('delete-submit').click()
    await expect(page.getByTestId('delete-error')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('delete-error')).toContainText('Incorrect password')
    expect(deleteRequests).toBe(1)
    expect(page.url()).toContain('/home')
    expect(await page.evaluate(() => localStorage.getItem('coinscan_auth'))).toBeTruthy()
    expect(dbJson('user', '--email', user.email).found, 'wrong password deleted the user').toBe(
      true
    )
    expect(dbJson('scans', '--email', user.email).scans?.length).toBe(1)

    // 8+9. Correct password: submission disabled in flight (no duplicate
    // request), then success clears state and redirects
    holdNextDelete = true
    await input.fill(user.password)
    await page.getByTestId('delete-submit').click()
    await expect(page.getByTestId('delete-submit')).toBeDisabled()
    await expect(page).toHaveURL('/login', { timeout: 30_000 })
    expect(deleteRequests, 'duplicate or extra delete request fired').toBe(2)

    // 10. Frontend cleanup after backend confirmation
    await expect(page.getByTestId('account-deleted-notice')).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('coinscan_auth'))).toBeNull()
    expect(await page.evaluate(() => sessionStorage.getItem('coinscan_lastident'))).toBeNull()
    expect(await page.evaluate(() => sessionStorage.getItem('coinscan_account_deleted'))).toBeNull()

    // Server-side: account + owned rows are gone
    expect(dbJson('user', '--email', user.email).found, 'user row still exists').toBe(false)
    expect(dbJson('scans', '--email', user.email).user_found).toBe(false)
    expect(dbJson('chats', '--email', user.email).user_found).toBe(false)
    expect(dbJson('collection', '--email', user.email).user_found).toBe(false)

    // Old credentials can no longer log in (generic error)
    await page.fill('#identifier', user.username)
    await page.fill('#password', user.password)
    await page.getByRole('button', { name: /log in/i }).click()
    await expect(page.getByText('Invalid credentials').first()).toBeVisible({ timeout: 10_000 })

    // Username/email reuse: fresh identity with no access to old data
    await page.goto('/signup')
    await page.fill('#username', user.username)
    await page.fill('#email', user.email)
    await page.fill('#password', user.password)
    await page.fill('#confirm', user.password)
    await page.getByRole('button', { name: /create account/i }).click()
    await page.waitForURL('**/home', { timeout: 20_000 })
    expect((await getScans(page)).length, 'reused account sees old scans').toBe(0)
    expect(dbJson('collection', '--email', user.email).count ?? 0).toBe(0)

    expect(errors).toEqual([])
  })
})
