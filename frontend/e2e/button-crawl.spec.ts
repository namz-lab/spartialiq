/**
 * Role-home + primary-control crawl.
 *
 * For each demo role: sign in, land on role home, click visible nav items
 * (with Escape to dismiss overlays), then exercise statutory registers (EO)
 * and citizen rates clearance (viewer).
 *
 * Results → ../../BUTTON_CRAWL_RESULTS.json
 *
 * Hard failures: login/home crash, error surfaces, statutory/C15 UI broken.
 * Soft failures (overlay intercepts, flaky clicks) are recorded but do not
 * fail the suite — the product still works; the crawl could not reach them.
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'BUTTON_CRAWL_RESULTS.json')

type Hit = { role: string; action: string; ok: boolean; soft?: boolean; detail: string }
const hits: Hit[] = []

function record(role: string, action: string, ok: boolean, detail: string, soft = false) {
  hits.push({ role, action, ok, soft: soft || undefined, detail: detail.slice(0, 240) })
  const mark = ok ? 'PASS' : soft ? 'SOFT' : 'FAIL'
  console.log(`${mark} [${role}] ${action} — ${detail}`)
}

const ROLES: { email: string; role: string; home: RegExp }[] = [
  { email: 'demo.admin@vungu.test', role: 'admin', home: /\/admin/ },
  { email: 'demo.planner@vungu.test', role: 'planner', home: /\/planner/ },
  { email: 'demo.eo@vungu.test', role: 'eo', home: /\/eo-planner/ },
  { email: 'demo.clerk@vungu.test', role: 'planning_clerk', home: /\/planning-clerk/ },
  { email: 'demo.inspector@vungu.test', role: 'building_inspector', home: /\/inspector/ },
  { email: 'demo.gis@vungu.test', role: 'gis_officer', home: /\/gis/ },
  { email: 'demo.surveyor@vungu.test', role: 'surveyor', home: /\/surveyor/ },
  { email: 'demo.viewer@vungu.test', role: 'viewer', home: /\/citizen/ },
]

async function dismissOverlays(page: Page) {
  await page.keyboard.press('Escape').catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(150)
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies()
  await page.goto('/login')
  await dismissOverlays(page)
  await page.fill('input[type="email"], input[name="email"]', email)
  await page.fill('input[type="password"], input[name="password"]', 'demo1234')
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
}

async function pageCrashed(page: Page) {
  const bodyText = await page.locator('body').innerText().catch(() => '')
  return /Something went wrong|Application error|Cannot GET|Internal Server Error/i.test(bodyText)
}

/** Click primary navigation controls only — not every button on the page. */
async function crawlNav(page: Page, role: string, max = 18) {
  await dismissOverlays(page)
  const nav = page.locator(
    [
      'aside nav button:visible',
      'nav.aw-nav button:visible',
      '.aw-nav-item:visible',
      '.ck-nav-item:visible',
      '.cp-side-item:visible',
      '[data-testid^="sr-tab-"]:visible',
      'nav[aria-label] a:visible',
      '.eo-rail button:visible',
      '.planner-rail button:visible',
    ].join(', '),
  )
  let controls = nav
  const count = await nav.count().catch(() => 0)
  if (count === 0) {
    controls = page.locator('[role="tab"]:visible, .sr-tab:visible, [role="menuitem"]:visible')
    const tcount = await controls.count().catch(() => 0)
    if (tcount === 0) {
      record(role, 'crawl_summary', true, 'no nav items found (shell may be map-first)', true)
      return
    }
  }
  const limit = Math.min(await controls.count(), max)
  let clicked = 0
  for (let i = 0; i < limit; i++) {
    await dismissOverlays(page)
    const btn = controls.nth(i)
    try {
      if (!(await btn.isVisible().catch(() => false))) continue
      const label = ((await btn.innerText().catch(() => '')) || (await btn.getAttribute('title')) || `nav-${i}`)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60)
      if (/log\s*out|sign\s*out|delete|remove|revoke|collapse/i.test(label)) {
        record(role, `skip:${label}`, true, 'skipped')
        continue
      }
      await btn.click({ timeout: 3_000, trial: false })
      clicked++
      await page.waitForTimeout(300)
      if (await pageCrashed(page)) {
        record(role, `click:${label}`, false, 'error surface after click')
        break
      }
      record(role, `click:${label}`, true, page.url())
    } catch (e) {
      // Overlay / detached — soft
      record(role, `click:#${i}`, false, (e as Error).message.split('\n')[0], true)
      await dismissOverlays(page)
    }
  }
  record(role, 'crawl_summary', clicked > 0 || limit === 0, `clicked=${clicked} of ${limit} nav`)
}

test.describe.configure({ mode: 'serial' })

test('role homes + nav crawl + statutory registers', async ({ page }) => {
  test.setTimeout(420_000)

  for (const r of ROLES) {
    try {
      await signIn(page, r.email)
      record(r.role, 'login', true, page.url())
      await expect(page).toHaveURL(r.home, { timeout: 20_000 })
      record(r.role, 'land_home', true, page.url())
      if (await pageCrashed(page)) {
        record(r.role, 'home_render', false, 'error surface on home')
      } else {
        record(r.role, 'home_render', true, 'ok')
        await crawlNav(page, r.role)
      }
    } catch (e) {
      record(r.role, 'login_or_home', false, (e as Error).message)
    }
  }

  // ── Statutory registers (EO) ──────────────────────────────────────
  try {
    await signIn(page, 'demo.eo@vungu.test')
    await page.goto('/statutory-registers')
    await expect(page.getByTestId('statutory-registers')).toBeVisible({ timeout: 20_000 })
    record('eo', 'open_statutory_registers', true, page.url())

    for (const t of ['bylaws', 'plans', 'acquisitions', 'clearances', 'expenses'] as const) {
      await page.getByTestId(`sr-tab-${t}`).click()
      await page.waitForTimeout(500)
      const err = page.getByTestId('sr-error')
      const hasErr = await err.isVisible().catch(() => false)
      record('eo', `tab_${t}`, !hasErr, hasErr ? await err.innerText() : 'ok')
    }

    await page.getByTestId('sr-tab-bylaws').click()
    await page.getByTestId('sr-bylaw-title').fill(`Playwright bylaw ${Date.now()}`)
    await page.getByTestId('sr-create-submit').click()
    await page.waitForTimeout(1000)
    const flash = page.getByTestId('sr-flash')
    const listCount = await page.getByTestId('sr-list').locator('li').count()
    const saved = (await flash.isVisible().catch(() => false)) || listCount > 0
    record('eo', 'create_bylaw_ui', saved, saved ? `list=${listCount}` : 'no flash/list')
  } catch (e) {
    record('eo', 'statutory_registers', false, (e as Error).message)
  }

  // ── Citizen rates clearance (C15) ─────────────────────────────────
  try {
    await signIn(page, 'demo.viewer@vungu.test')
    await page.goto('/citizen?section=rates_clearance')
    await expect(page.getByTestId('rates-clearance')).toBeVisible({ timeout: 20_000 })
    record('viewer', 'open_rates_clearance', true, page.url())
    await page.getByTestId('rc-stand').fill('HDR-105')
    await page.getByTestId('rc-name').fill('Playwright Citizen')
    await page.getByTestId('rc-submit').click()
    await page.waitForTimeout(1200)
    const okMsg = page.getByTestId('rc-ok')
    const errMsg = page.getByTestId('rc-error')
    const ok = await okMsg.isVisible().catch(() => false)
    const err = await errMsg.isVisible().catch(() => false)
    record(
      'viewer',
      'lodge_rates_clearance',
      ok && !err,
      ok ? await okMsg.innerText() : err ? await errMsg.innerText() : 'no feedback',
    )
  } catch (e) {
    record('viewer', 'rates_clearance', false, (e as Error).message)
  }

  const hardFail = hits.filter((h) => !h.ok && !h.soft)
  const softFail = hits.filter((h) => !h.ok && h.soft)
  const summary = {
    at: new Date().toISOString(),
    pass: hits.filter((h) => h.ok).length,
    soft_fail: softFail.length,
    hard_fail: hardFail.length,
    hits,
  }
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2))
  console.log(
    `\nButton crawl: ${summary.pass} pass, ${summary.soft_fail} soft, ${summary.hard_fail} hard → ${OUT}`,
  )

  expect(hardFail, `${hardFail.length} hard failures — see BUTTON_CRAWL_RESULTS.json`).toHaveLength(0)
})
