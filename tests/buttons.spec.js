import { test, expect } from '@playwright/test'
import {
  uniqueUser,
  signup,
  trackPageErrors,
  seedCollection,
  seedScan
} from './helpers.js'

// Every visible button on every page must (a) have an accessible name and
// (b) actually DO something observable when clicked (URL, text, or DOM
// class/style change). Destructive, costly (AI/network-write), native-share,
// and hardware-dependent controls are name-audited but not clicked — they
// are covered by their dedicated specs.
const SKIP_CLICK =
  /(log ?out|delete|remove|clear all|clear history|cancel|detect|try again|send feedback|send message|upload an image|choose image|use camera|camera|attach|toggle theme|share|new chat)/i

const ACTIVE_NAV = {
  '/home': 'Home',
  '/history': 'Upload History',
  '/collection': 'Collection',
  '/converter': 'Currency Converter',
  '/chatbot': 'Chatbot',
  '/contact': 'Contact Us',
  '/result': null
}

async function collectButtons(page) {
  const loc = page.locator('button:visible, [role="button"]:visible')
  const n = await loc.count()
  const out = []
  for (let i = 0; i < n; i++) {
    const b = loc.nth(i)
    const meta = await b.evaluate((el) => ({
      name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim(),
      title: (el.getAttribute('title') || '').trim()
    }))
    out.push({ ...meta })
  }
  return out
}

function snapshot(page) {
  return page.evaluate(() => ({
    url: location.pathname + location.search,
    text: document.body.innerText,
    fields: [...document.querySelectorAll('input, textarea, select')]
      .map((e) => e.value)
      .join('\u0003'),
    sig: [...document.querySelectorAll('*')]
      .map((e) => {
        const cls = typeof e.className === 'string' ? e.className : (e.className?.baseVal || '')
        return cls + '\u0002' + (e.getAttribute('style') || '')
      })
      .join('\u0001')
  }))
}

test.describe('Buttons: accessible names + click liveness', () => {
  test('every visible button has an accessible name', async ({ page }) => {
    const errors = trackPageErrors(page)
    const user = uniqueUser()
    await signup(page, user)
    await seedCollection(page, [
      { coinId: 'btn-a', item: { name: 'Button Audit Coin', kind: 'coin', country: 'India', year: '1990', category: 'Rare', rarity: 'Rare', price: 100, match: 77 } }
    ])
    await seedScan(page, { items: [{ name: 'Button Audit Scan', kind: 'coin', country: 'India', year: '2001' }], authenticity: null })
    await page.evaluate(() => {
      sessionStorage.setItem(
        'coinscan_lastident',
        JSON.stringify({ item: { name: 'Button Audit Result', kind: 'coin', country: 'India', year: '1995', match: 82 }, image: null })
      )
    })

    const pages = ['/home', '/history', '/collection', '/converter', '/contact', '/chatbot', '/result']
    for (const path of pages) {
      await page.goto(path)
      await page.waitForTimeout(500)
      const buttons = await collectButtons(page)
      expect(buttons.length, `${path} should render buttons`).toBeGreaterThan(0)
      for (const [i, b] of buttons.entries()) {
        expect(b.name, `${path} button #${i} must have an accessible name`).not.toBe('')
      }
    }

    expect(errors).toEqual([])
  })

  test('every non-skipped button produces an observable change when clicked', async ({ page }) => {
    test.setTimeout(300_000)
    const errors = trackPageErrors(page)
    // Cancel any file chooser opened by accident (we never intend to)
    let fileChooserFired = false
    page.on('filechooser', (fc) => {
      fileChooserFired = true
      fc.setFiles([]).catch(() => {})
    })

    const user = uniqueUser()
    await signup(page, user)
    await seedCollection(page, [
      { coinId: 'btn-a', item: { name: 'Button Audit Coin', kind: 'coin', country: 'India', year: '1990', category: 'Rare', rarity: 'Rare', price: 100, match: 77 } }
    ])
    await seedScan(page, { items: [{ name: 'Button Audit Scan', kind: 'coin', country: 'India', year: '2001' }], authenticity: null })
    await page.evaluate(() => {
      sessionStorage.setItem(
        'coinscan_lastident',
        JSON.stringify({ item: { name: 'Button Audit Result', kind: 'coin', country: 'India', year: '1995', match: 82 }, image: null })
      )
    })

    const pages = ['/home', '/history', '/collection', '/converter', '/contact', '/chatbot', '/result']
    const failures = []

    for (const path of pages) {
      await page.goto(path)
      await page.waitForTimeout(500)
      const buttons = await collectButtons(page)

      for (let i = 0; i < buttons.length; i++) {
        const { name } = buttons[i]
        if (!name || SKIP_CLICK.test(name)) continue
        if (name === ACTIVE_NAV[path]) continue // clicking current page = legal no-op

        // Fresh state for every click so clicks can't mask each other
        await page.goto(path)
        await page.waitForTimeout(500)
        const btn = page.locator('button:visible, [role="button"]:visible').nth(i)
        if (!(await btn.isVisible().catch(() => false))) continue
        if (await btn.isDisabled().catch(() => true)) continue

        const before = await snapshot(page)
        try {
          await btn.click({ timeout: 5000 })
        } catch (e) {
          failures.push(`${path} "${name}": not clickable (${e.message.split('\n')[0]})`)
          continue
        }
        await page.waitForTimeout(350)
        // A click that opens the OS file picker is observably live by nature
        if (fileChooserFired) {
          fileChooserFired = false
          continue
        }
        const after = await snapshot(page)
        if (
          before.url === after.url &&
          before.text === after.text &&
          before.fields === after.fields &&
          before.sig === after.sig
        ) {
          failures.push(`${path} "${name}" (#${i}): clicked but nothing changed`)
        }
      }
    }

    expect(failures, failures.join('\n')).toEqual([])
    expect(errors).toEqual([])
  })
})
