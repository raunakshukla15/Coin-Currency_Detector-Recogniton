import { test, expect } from '@playwright/test'
import { uniqueUser, signup, trackPageErrors, FIXTURE_NOTE } from './helpers.js'

// Preliminary coin authenticity display (Task E) with a MOCKED
// /api/ai/identify — verifies the three required user-facing labels,
// visible warning signs, limitations, and recommended next steps, plus
// legacy-row fallbacks when the stored row predates the new backend fields.

async function mockIdentify(page, { items, authenticity = null } = {}) {
  await page.route('**/api/ai/identify', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ items, authenticity })
    })
  })
}

async function pickAndDetect(page) {
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_NOTE)
  await expect(page.getByText(/Image ready for identification/i)).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /^detect/i }).first().click()
}

const coinItem = (extra) => ({
  kind: 'coin',
  name: 'Mock Sovereign',
  country: 'United Kingdom',
  year: '1911',
  denomination: '1 Sovereign',
  match: 87,
  ...extra
})

test.describe('Authenticity assessment display (mocked AI)', () => {
  test('potentially suspicious: badge, warning-sign bullets, limitations, next steps', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await mockIdentify(page, {
      items: [coinItem({ authenticity_status: 'SUSPICIOUS' })],
      authenticity: {
        status: 'SUSPICIOUS',
        label: 'Potentially suspicious',
        message:
          'Potentially suspicious. The image shows visible differences that require physical examination.',
        indicators: ['Coin outline/symmetry appears irregular for a struck coin'],
        limitations:
          'Preliminary visual assessment from the uploaded photo only. A photograph cannot verify metal composition.',
        next_steps:
          'Have the item physically verified by a qualified authority before relying on it.',
        confidence: null
      }
    })

    await page.goto('/home')
    await pickAndDetect(page)
    await expect(page).toHaveURL(/\/result/, { timeout: 20_000 })

    await expect(page.getByText(/Authenticity: Potentially suspicious/)).toBeVisible()
    await expect(page.getByText('Visible warning signs')).toBeVisible()
    await expect(
      page.getByText('Coin outline/symmetry appears irregular for a struck coin')
    ).toBeVisible()
    await expect(page.getByText(/cannot verify metal composition/).first()).toBeVisible()
    await expect(page.getByText(/Next steps:/)).toBeVisible()
    await expect(page.getByText(/physically verified by a qualified authority/).first()).toBeVisible()

    // Never a fabricated percentage on the assessment
    await expect(page.getByText(/\d+% (authenticity|confidence)/i)).toHaveCount(0)

    expect(errors).toEqual([])
  })

  test('legacy row without new fields: fallback label + fallback limitations/next steps', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    // Stored/legacy shape: status + message only — no label/limitations/
    // next_steps, mirroring rows saved before the feature existed.
    await mockIdentify(page, {
      items: [coinItem({ authenticity_status: 'LIKELY_GENUINE' })],
      authenticity: {
        status: 'LIKELY_GENUINE',
        message: 'Legacy stored assessment text.',
        indicators: [],
        confidence: 80
      }
    })

    await page.goto('/home')
    await pickAndDetect(page)
    await expect(page).toHaveURL(/\/result/, { timeout: 20_000 })

    await expect(
      page.getByText(/Authenticity: No obvious suspicious signs detected/)
    ).toBeVisible()
    await expect(page.getByText(/Legacy stored assessment text\./)).toBeVisible()
    // fallback limitations + next steps still shown (never "likely genuine" claim)
    await expect(page.getByText(/cannot verify metal composition/).first()).toBeVisible()
    await expect(page.getByText(/does NOT confirm authenticity/).first()).toBeVisible()

    expect(errors).toEqual([])
  })

  test('inconclusive: photo request for both faces and the edge, no warning signs', async ({
    page
  }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)

    await mockIdentify(page, {
      items: [
        coinItem({
          authenticity_status: 'UNABLE_TO_VERIFY',
          authenticity_label: 'Inconclusive',
          authenticity_message:
            'Inconclusive. Image quality prevents assessment of surface details.',
          suspiciousIndicators: ['Insufficient image detail to assess coin surface'],
          authenticity_limitations:
            'Preliminary visual assessment from the uploaded photo only.',
          authenticity_next_steps:
            'Please upload clear, well-lit photographs of BOTH faces and of the edge (where practical) and scan again.'
        })
      ],
      authenticity: null
    })

    await page.goto('/home')
    await pickAndDetect(page)
    await expect(page).toHaveURL(/\/result/, { timeout: 20_000 })

    await expect(page.getByText(/Authenticity: Inconclusive/)).toBeVisible()
    await expect(page.getByText('Visible warning signs')).toBeVisible()
    await expect(
      page.getByText('Insufficient image detail to assess coin surface')
    ).toBeVisible()
    await expect(
      page.getByText(/photographs of BOTH faces and of the edge/)
    ).toBeVisible()

    expect(errors).toEqual([])
  })
})
