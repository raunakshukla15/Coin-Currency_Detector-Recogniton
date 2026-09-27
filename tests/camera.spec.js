import { test, expect } from '@playwright/test'
import { uniqueUser, signup, trackPageErrors } from './helpers.js'

// The Playwright config injects a fake webcam
// (--use-file-for-fake-video-capture=tests/fixtures/camera.y4m), so
// getUserMedia succeeds in headless Chromium without real hardware.
test.describe('Camera capture (fake webcam)', () => {
  test('open camera → Capture enables when the video is live → preview appears', async ({
    page
  }) => {
    test.setTimeout(60_000)
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)
    await page.goto('/home')

    await page.getByRole('button', { name: /use camera/i }).click()

    // Modal opens and the <video> receives frames from the fake device
    const video = page.locator('video')
    await expect(video).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(async () => video.evaluate((v) => v.videoWidth), { timeout: 20_000 })
      .toBeGreaterThan(0)
    await expect
      .poll(async () => video.evaluate((v) => v.videoHeight), { timeout: 20_000 })
      .toBeGreaterThan(0)

    // Capture stays disabled until the stream is playable, then enables
    const capture = page.getByRole('button', { name: /capture/i })
    await expect(capture).toBeEnabled({ timeout: 20_000 })
    await expect(capture).toContainText('Capture')

    await capture.click()

    // Preview shows the captured frame with the camera filename
    await expect(page.getByText('camera-capture.jpg')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/image ready for identification/i)).toBeVisible()

    // Remove returns to the empty upload state (exact name: the preview's
    // close icon is labelled "Remove image" and must not match here)
    await page.getByRole('button', { name: /^remove$/i }).click()
    await expect(page.getByText(/upload a coin image/i)).toBeVisible()

    expect(errors).toEqual([])
  })

  test('camera modal Cancel closes the stream without a capture', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)
    await page.goto('/home')

    await page.getByRole('button', { name: /use camera/i }).click()
    await expect(page.locator('video')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /^cancel$/i }).click()

    await expect(page.locator('video')).toHaveCount(0)
    await expect(page.getByText(/upload a coin image/i)).toBeVisible()
    await expect(page.getByText('camera-capture.jpg')).toHaveCount(0)

    expect(errors).toEqual([])
  })
})
