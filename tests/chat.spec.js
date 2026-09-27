import { test, expect } from '@playwright/test'
import {
  uniqueUser,
  signup,
  trackPageErrors,
  expectRealAiReply,
  FIXTURE_NOTE
} from './helpers.js'

test.describe('Chatbot (real AI)', () => {
  test('L: text question gets a real AI answer that persists in the chat', async ({
    page
  }) => {
    test.setTimeout(240_000)
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await page.goto('/chatbot')
    const question = 'What is a mint mark and why does it matter to collectors?'
    await page.getByPlaceholder('Ask CoinScan AI anything about coins...').fill(question)
    await page.getByRole('button', { name: /send message/i }).click()

    // The user's question appears
    await expect(page.getByText(question)).toBeVisible({ timeout: 15_000 })

    // A real AI answer (not a canned/error reply)
    await expectRealAiReply(page)

    // The conversation was persisted to the server for this user — reopen it
    // from the chat history after a reload.
    await page.reload()
    await page.locator('button.chat-history-open').first().click()
    await expect(page.getByText(question)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.glass-card-soft.glass-interior').last()).toBeVisible({
      timeout: 30_000
    })

    expect(errors).toEqual([])
  })

  test('M: image question gets a real AI answer about the photo', async ({ page }) => {
    test.setTimeout(300_000)
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await page.goto('/chatbot')
    await page.setInputFiles('input[type="file"]', FIXTURE_NOTE)
    await expect(page.getByAltText('Attachment')).toBeVisible({ timeout: 15_000 })

    const question = 'What currency and denomination is shown in this photo?'
    await page.getByPlaceholder('Ask CoinScan AI anything about coins...').fill(question)
    await page.getByRole('button', { name: /send message/i }).click()

    await expectRealAiReply(page, 240_000)

    // Persisted: reopen after reload — the conversation exists on the server.
    // The question text must come from the server (proves the chat loaded and
    // the intro panel is gone), then the assistant reply bubble is real.
    await page.reload()
    await page.locator('button.chat-history-open').first().click()
    await expect(page.getByText(question)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.glass-card-soft.glass-interior').last()).toBeVisible({
      timeout: 30_000
    })

    expect(errors).toEqual([])
  })
})
