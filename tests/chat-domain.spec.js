import { test, expect } from '@playwright/test'
import { uniqueUser, signup, trackPageErrors, expectRealAiReply } from './helpers.js'

const OFF_TOPIC =
  'I can help with coins, banknotes, currencies, identification, collecting, numismatics, and related currency topics. Please ask me something about coins or currency.'

const RAW_MARKDOWN = /(\*\*|```|(^|\n)\s{0,3}#{1,6}\s|\*\s[^*]+\*)/

test.describe('Chatbot domain focus & clean text (UI)', () => {
  test('off-topic anime question shows the exact CoinScan OFF_TOPIC response', async ({
    page
  }) => {
    test.setTimeout(120_000)
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await page.goto('/chatbot')
    await page.getByPlaceholder('Ask CoinScan AI anything about coins...').fill(
      'Tell me about anime.'
    )
    await page.getByRole('button', { name: /send message/i }).click()

    // The exact OFF_TOPIC reply appears in the assistant bubble.
    await expect(page.getByText(OFF_TOPIC, { exact: true }).last()).toBeVisible({
      timeout: 30_000
    })
    // The question was refused, not answered: no anime content anywhere.
    const chatText = await page.locator('.glass-card-soft.glass-interior').last().innerText()
    expect(chatText.trim()).toBe(OFF_TOPIC)

    expect(errors).toEqual([])
  })

  test('assistant replies render as clean text without raw markdown markers', async ({
    page
  }) => {
    test.setTimeout(240_000)
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await page.goto('/chatbot')
    await page
      .getByPlaceholder('Ask CoinScan AI anything about coins...')
      .fill('List the main mint marks on world coins and briefly explain each one.')
    await page.getByRole('button', { name: /send message/i }).click()

    const reply = await expectRealAiReply(page, 180_000)
    // The rendered bubble text must never contain raw markdown markers.
    expect(RAW_MARKDOWN.test(reply)).toBe(false)
    const bubbleText = await page.locator('.glass-card-soft.glass-interior').last().innerText()
    expect(RAW_MARKDOWN.test(bubbleText)).toBe(false)

    expect(errors).toEqual([])
  })
})
