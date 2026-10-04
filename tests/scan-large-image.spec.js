import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { uniqueUser, signup, trackPageErrors, getScans } from './helpers.js'

// Regression: a photo whose raw size exceeds the backend's 6 MB stored-image
// cap must still be saved to history. The client downscales to <=1024px JPEG
// before upload (schema design) and before putting the image into
// sessionStorage — previously the ORIGINAL >6MB data URL went to POST
// /api/scans (422, silently swallowed by persistScan) and also blew the
// sessionStorage quota on the way to the result page.
// AI identify is mocked (no Gemini quota); scan persistence hits the real
// backend + MySQL.

async function mockIdentify(page, items) {
  await page.route('**/api/ai/identify', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ items, authenticity: null })
    })
  )
}

async function generateLargeJpeg(page) {
  return page.evaluate(() => {
    const attempts = [
      [2600, 1950],
      [3400, 2550],
      [4200, 3150]
    ]
    const target = 6.5 * 1024 * 1024
    for (const [w, h] of attempts) {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      const img = ctx.createImageData(w, h)
      const d = img.data
      for (let i = 0; i < d.length; i += 4) {
        d[i] = (Math.random() * 256) | 0
        d[i + 1] = (Math.random() * 256) | 0
        d[i + 2] = (Math.random() * 256) | 0
        d[i + 3] = 255
      }
      ctx.putImageData(img, 0, 0)
      const dataUrl = c.toDataURL('image/jpeg', 0.7)
      const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      if (Math.floor((b64.length * 3) / 4) > target) return dataUrl
    }
    return null
  })
}

test.describe('Oversized photo (>6MB) persists after downscale', () => {
  test('large photo is downscaled before upload, saved to history and shown', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await mockIdentify(page, [
      {
        kind: 'coin',
        name: 'Mock Large Photo',
        country: 'India',
        year: '2005',
        denomination: '10 Rupees',
        match: 88
      }
    ])

    const savedBodies = []
    await page.route('**/api/scans', async (route) => {
      if (route.request().method() === 'POST') {
        try {
          savedBodies.push(await route.request().postDataJSON())
        } catch {
          /* recorded as a failure by the length assertion below */
        }
      }
      await route.continue()
    })

    const dataUrl = await generateLargeJpeg(page)
    test.skip(!dataUrl, 'browser could not generate a >6MB JPEG in this environment')
    const tmp = path.join(os.tmpdir(), `coinscan-large-${Date.now()}.jpg`)
    fs.writeFileSync(tmp, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
    try {
      const originalSize = fs.statSync(tmp).size
      expect(originalSize, 'fixture must exceed the 6MB backend cap').toBeGreaterThan(
        6 * 1024 * 1024
      )

      await page.goto('/home')
      await page.locator('input[type="file"]').setInputFiles(tmp)
      await expect(page.getByText(/Image ready for identification/i)).toBeVisible({
        timeout: 30_000
      })
      await page.getByRole('button', { name: /^detect/i }).first().click()
      await expect(page).toHaveURL(/\/result/, { timeout: 40_000 })

      expect(savedBodies.length, 'POST /api/scans must have fired').toBe(1)
      const uploaded = Buffer.from(savedBodies[0].image.split(',')[1], 'base64')
      expect(
        uploaded.length,
        'client uploaded the RAW >6MB photo (would be rejected with 422)'
      ).toBeLessThan(3 * 1024 * 1024)
      expect(uploaded.length).toBeLessThanOrEqual(6 * 1024 * 1024)

      const scans = await getScans(page)
      expect(scans.length, 'scan not persisted (422 swallowed?)').toBe(1)
      expect(scans[0].imageId, 'persisted scan has no imageId').toBeTruthy()
      expect(scans[0].name).toBe('Mock Large Photo')

      await page.goto('/history')
      const rows = page
        .locator('.glass-card, tr, .history-row')
        .filter({ hasText: 'Mock Large Photo' })
      await expect(rows).toHaveCount(1)
      expect((await getScans(page)).length, 'scan lost after navigation').toBe(1)

      expect(errors).toEqual([])
    } finally {
      fs.rmSync(tmp, { force: true })
    }
  })
})
