import { test, expect } from '@playwright/test'
import { uniqueUser, signup, login, logout, trackPageErrors } from './helpers.js'

test.describe('Auth, routing and console health', () => {
  test('C/P: signup lands on /home, logout → /login, login again → /home', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()

    await signup(page, user)
    await expect(page).toHaveURL(/\/home$/)

    await logout(page)
    await expect(page).toHaveURL(/\/login$/)

    await login(page, user)
    await expect(page).toHaveURL(/\/home$/)

    expect(errors).toEqual([])
  })

  test('D: protected routes redirect logged-out users to /login', async ({ page }) => {
    const errors = trackPageErrors(page)
    for (const path of ['/home', '/history', '/result', '/collection', '/chatbot', '/converter', '/contact']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login$/)
    }
    expect(errors).toEqual([])
  })

  test('F+G: all main routes render for a logged-in user with no JS errors', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    const routes = [
      ['/home', /upload a coin image|detect coin/i],
      ['/history', /upload history/i],
      ['/collection', /my collection/i],
      ['/chatbot', /ai numismatic/i],
      ['/converter', /converter|exchange/i],
      ['/contact', /contact/i]
    ]

    for (const [path, marker] of routes) {
      await page.goto(path)
      await expect(page).toHaveURL(new RegExp(path.replace('/', '\\/') + '$'))
      await expect(page.getByText(marker).first()).toBeVisible({ timeout: 15_000 })
    }

    expect(errors).toEqual([])
  })

  test('/result with no identification data redirects to /home (no fabricated result)', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await page.goto('/result')
    await expect(page).toHaveURL(/\/home$/, { timeout: 15_000 })

    expect(errors).toEqual([])
  })

  test('login rejects wrong password with a visible error (no fake session)', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)
    await logout(page)

    await page.goto('/login')
    await page.fill('#identifier', user.username)
    await page.fill('#password', 'definitely-wrong')
    await page.getByRole('button', { name: /log in/i }).click()

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.locator('text=Invalid credentials').first()).toBeVisible({ timeout: 10_000 })

    expect(errors).toEqual([])
  })
})
