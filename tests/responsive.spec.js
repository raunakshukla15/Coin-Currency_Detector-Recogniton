import { test, expect } from '@playwright/test'
import { uniqueUser, signup, trackPageErrors } from './helpers.js'

const PAGES = ['/home', '/history', '/collection', '/converter', '/contact']

const VIEWPORTS = [
  { name: 'iPhone 14', width: 390, height: 844, mobile: true },
  { name: 'small Android', width: 360, height: 640, mobile: true },
  // ≤768px is the hamburger layout (sidebar is off-canvas there)
  { name: 'tablet', width: 768, height: 1024, mobile: true },
  { name: 'laptop', width: 1024, height: 768, mobile: false },
  { name: 'desktop', width: 1280, height: 800, mobile: false },
  { name: 'wide desktop', width: 1920, height: 1080, mobile: false }
]

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} (${vp.width}×${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test(`no horizontal overflow on key pages — ${vp.name}`, async ({ page }) => {
      const errors = trackPageErrors(page)
      const user = uniqueUser()
      await signup(page, user)

      for (const path of PAGES) {
        await page.goto(path)
        await page.waitForTimeout(600)
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth
        )
        expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(2)
      }

      expect(errors).toEqual([])
    })

    if (vp.mobile) {
      test(`hamburger navigation works — ${vp.name}`, async ({ page }) => {
        const errors = trackPageErrors(page)
        const user = uniqueUser()
        await signup(page, user)

        await page.goto('/home')
        await page.getByRole('button', { name: /open navigation/i }).click()
        await page.getByRole('button', { name: /currency converter/i }).click()
        await page.waitForURL('**/converter', { timeout: 15_000 })
        await expect(page).toHaveURL(/\/converter$/)

        expect(errors).toEqual([])
      })
    } else {
      test(`sidebar navigation works — ${vp.name}`, async ({ page }) => {
        const errors = trackPageErrors(page)
        const user = uniqueUser()
        await signup(page, user)

        await page.goto('/home')
        await page.getByRole('button', { name: /upload history/i }).click()
        await page.waitForURL('**/history', { timeout: 15_000 })
        await expect(page).toHaveURL(/\/history$/)

        expect(errors).toEqual([])
      })
    }
  })
}
