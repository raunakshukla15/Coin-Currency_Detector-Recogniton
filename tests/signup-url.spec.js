import { test, expect } from '@playwright/test'
import { uniqueUser, trackPageErrors } from './helpers.js'

// API base URL configuration + exact signup URL.
//
// Regression coverage for the live bug where the production build used the
// relative '/api' base, so the browser posted signup to the static Cloudflare
// Worker origin (team5.coinscan.workers.dev/api/auth/signup → 404) instead of
// the Render backend. In dev the relative '/api' base is CORRECT (vite dev
// proxy → http://localhost:8000) and must stay unchanged.

async function importApi(page) {
  // vite dev serves src/api.js as ESM; import.meta.env is already baked.
  // All normalization checks run INSIDE the page (functions cannot cross
  // the Playwright serialization boundary) and return plain values.
  return page.evaluate(async () => {
    const m = await import('/src/api.js')
    const cases = {
      renderPlain: m.normalizeApiBase('https://coinscan.onrender.com'),
      renderSlash: m.normalizeApiBase('https://coinscan.onrender.com/'),
      renderApi: m.normalizeApiBase('https://coinscan.onrender.com/api'),
      renderApiSlash: m.normalizeApiBase('https://coinscan.onrender.com/api/'),
      renderDouble: m.normalizeApiBase('https://coinscan.onrender.com/api/api'),
      empty: m.normalizeApiBase(''),
      slash: m.normalizeApiBase('/'),
      devRelative: m.normalizeApiBase('/api'),
      withSpaces: m.normalizeApiBase('  http://localhost:8000  '),
      joinedSignup: m.API_BASE + '/auth/signup'
    }
    return { API_BASE: m.API_BASE, cases }
  })
}

test.describe('API base configuration + signup URL', () => {
  test('dev API_BASE stays relative /api and joins paths with exactly one /api', async ({
    page
  }) => {
    await page.goto('/')
    const { API_BASE, cases } = await importApi(page)

    // Dev/e2e must keep the relative base (vite proxy handles routing).
    expect(API_BASE).toBe('/api')
    expect(cases.joinedSignup).toBe('/api/auth/signup')
    expect(cases.joinedSignup).not.toContain('/api/api')

    // Production default (Render) resolves with the /api prefix exactly once.
    expect(cases.renderPlain).toBe('https://coinscan.onrender.com/api')
    expect(cases.renderSlash).toBe('https://coinscan.onrender.com/api')
    expect(cases.renderApi).toBe('https://coinscan.onrender.com/api')
    expect(cases.renderApiSlash).toBe('https://coinscan.onrender.com/api')
    // A double prefix is collapsed, never shipped.
    expect(cases.renderDouble).toBe('https://coinscan.onrender.com/api')
    // Empty/odd inputs still yield a usable base with the prefix.
    expect(cases.empty).toBe('/api')
    expect(cases.slash).toBe('/api')
    expect(cases.devRelative).toBe('/api')
    expect(cases.withSpaces).toBe('http://localhost:8000/api')
  })

  test('signup POSTs to exactly /api/auth/signup (single prefix, proxied origin)', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    const seen = []

    await page.route('**/auth/signup*', async (route) => {
      seen.push(route.request().url())
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'mock.e2e.token',
          user: { id: 4242, username: user.username, email: user.email, demo: false }
        })
      })
    })

    await page.goto('/signup')
    await page.fill('#username', user.username)
    await page.fill('#email', user.email)
    await page.fill('#password', user.password)
    await page.fill('#confirm', user.password)
    await page.getByRole('button', { name: /create account/i }).click()
    await page.waitForURL('**/home', { timeout: 20_000 })

    expect(seen).toHaveLength(1)
    const url = new URL(seen[0])
    expect(url.pathname).toBe('/api/auth/signup')
    expect((url.pathname.match(/\/api\//g) || []).length).toBe(1)
    expect(seen[0]).not.toContain('/api/api')
    // Dev/e2e: relative base → same origin as the page (vite proxy → :8000).
    expect(url.origin).toBe(new URL(page.url()).origin)

    expect(errors).toEqual([])
  })
})
