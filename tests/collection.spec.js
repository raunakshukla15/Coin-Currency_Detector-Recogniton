import { test, expect } from '@playwright/test'
import {
  uniqueUser,
  signup,
  trackPageErrors,
  seedCollection,
  getCollection
} from './helpers.js'

// Two server-seeded items: A has reference data (price/category), B is a
// deliberately SPARSE AI-style item (no price, no match, no specs) used to
// prove the result page shows honest placeholders instead of invented data.
const ITEM_A = {
  coinId: 'e2e-legacy-rupee',
  item: {
    name: 'Legacy Silver Rupee',
    kind: 'coin',
    country: 'India',
    year: '1983',
    category: 'Rare',
    rarity: 'Rare',
    price: 1500,
    match: 91,
    composition: 'Silver',
    denomination: '1 Rupee'
  }
}
const ITEM_B = {
  coinId: 'e2e-mystery-coin',
  item: {
    name: 'Mystery Coin',
    kind: 'coin',
    country: 'India',
    year: '2004',
    category: 'Common',
    rarity: 'Common'
    // no price / match / composition / weight / valueRange on purpose
  }
}

async function seed(page) {
  await seedCollection(page, [ITEM_A, ITEM_B])
}

test.describe('Collection page', () => {
  test('seeded items render with honest values (no fake trend/price)', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)
    await seed(page)

    await page.goto('/collection')
    await expect(page.getByRole('button', { name: /view details/i }).first()).toBeVisible({
      timeout: 15_000
    })

    // Both items visible by name
    await expect(page.getByText('Legacy Silver Rupee')).toBeVisible()
    await expect(page.getByText('Mystery Coin')).toBeVisible()

    // Portfolio value only counts items that actually have a price
    // (the stat card and the item card both show it)
    await expect(page.getByText('₹1,500').first()).toBeVisible()

    // The fabricated "+12.4%" portfolio trend must be gone
    await expect(page.getByText(/\+12\.4%/)).toHaveCount(0)

    // Sparse item shows an honest dash, not ₹0
    await expect(page.getByText('—').first()).toBeVisible()

    expect(errors).toEqual([])
  })

  test('search, category filter, and clear-filters work', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)
    await seed(page)
    await page.goto('/collection')

    // Search narrows to one item
    await page.getByPlaceholder(/search by coin name/i).fill('Mystery')
    await expect(page.getByText('Mystery Coin')).toBeVisible()
    await expect(page.getByText('Legacy Silver Rupee')).toHaveCount(0)

    // No match -> empty state + clear filters restores everything
    await page.getByPlaceholder(/search by coin name/i).fill('zzz-no-such-coin')
    await expect(page.getByText(/no coins match your current filters/i)).toBeVisible()
    await page.getByRole('button', { name: /clear filters/i }).click()
    await expect(page.getByText('Legacy Silver Rupee')).toBeVisible()
    await expect(page.getByText('Mystery Coin')).toBeVisible()

    // Category filter: categories are recomputed from the year on load
    // (1983 -> Epic, 2004 -> Very Rare) by CollectionContext.normalize()
    await expect(page.getByRole('button', { name: /^Epic/ })).toBeVisible()
    await page.getByRole('button', { name: /^Epic/ }).click()
    await expect(page.getByText('Legacy Silver Rupee')).toBeVisible()
    await expect(page.getByText('Mystery Coin')).toHaveCount(0)

    expect(errors).toEqual([])
  })

  test('sort + list/grid toggle + favorite persist across reload', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)
    await seed(page)
    await page.goto('/collection')

    // Sort: Oldest puts 1983 first, Newest puts 2004 first
    await page.locator('select').first().selectOption('Oldest')
    const firstOld = page.locator('.coin-grid > *').first()
    await expect(firstOld).toContainText('Legacy Silver Rupee')
    await page.locator('select').first().selectOption('Newest')
    await expect(page.locator('.coin-grid > *').first()).toContainText('Mystery Coin')

    // List view: the toggle button visibly activates
    const listBtn = page.getByRole('button', { name: 'List view' })
    const before = await listBtn.getAttribute('style')
    await listBtn.click()
    const after = await listBtn.getAttribute('style')
    expect(after).not.toBe(before)

    // Favorite the first list item (server PATCH)
    await page.getByRole('button', { name: 'Toggle favorite' }).first().click()
    await expect
      .poll(async () => {
        const items = await getCollection(page)
        const fav = items.find((i) => i.id === ITEM_B.coinId || i.id === ITEM_A.coinId)
        return items.filter((i) => i.favorite).length
      }, { timeout: 10_000 })
      .toBeGreaterThan(0)

    // Favorite survives a reload (it lives on the server, not just in
    // memory) — check the heart on the SAME card (sort resets on reload)
    await page.reload()
    const mysteryCard = page.locator('.coin-grid > *').filter({ hasText: 'Mystery Coin' }).first()
    const styleAfter = await mysteryCard
      .getByRole('button', { name: 'Toggle favorite' })
      .getAttribute('style')
    expect(styleAfter).toContain('drop-shadow')

    expect(errors).toEqual([])
  })

  test('View Details opens an honest result for a sparse AI item', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)
    await seed(page)
    await page.goto('/collection')

    const card = page.locator('.coin-grid > *').filter({ hasText: 'Mystery Coin' }).first()
    await card.getByRole('button', { name: /view details/i }).click()
    await page.waitForURL('**/result', { timeout: 15_000 })

    await expect(page.getByText('Mystery Coin')).toBeVisible({ timeout: 15_000 })

    // Honest placeholders: no invented match %, no invented specs/values
    await expect(page.getByText(/\d+%\s*Match/)).toHaveCount(0)
    await expect(page.getByText('AI Identified').first()).toBeVisible()

    // No fabricated appreciation trend from the old UI
    await expect(page.getByText(/\+38%/)).toHaveCount(0)
    await expect(page.getByText(/12-month appreciation/)).toHaveCount(0)
    await expect(page.getByText(/Sample trend data/i)).toBeVisible()

    // Estimated value + currency box: dashes, never made-up numbers
    await expect(page.getByText('Estimated Value')).toBeVisible()
    await expect(page.getByText('—').first()).toBeVisible()
    await expect(page.getByText(/₹150\b/)).toHaveCount(0)

    expect(errors).toEqual([])
  })
})
