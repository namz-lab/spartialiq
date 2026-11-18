// Takes the screenshots of the planning team's "At a glance" screens for the council deck and the manuals.
// Read-only: it signs in with the demo accounts of the development build and creates nothing, so there is
// nothing to clean up afterwards. Needs the backend (3000) and the front end (5174) running.
//
//   node capture-team.js
//
//   team-1-overview.png        the EO Planning console's first screen: one tile per desk under the EO
//   team-2-planners-desk.png   one desk opened in full, with the screens where its work is done
//   team-3-clerk-home.png      the planning clerk's home, on the same tiles
const path = require('path')
const { chromium } = require('C:/lamis/frontend/node_modules/playwright')

const BASE = 'http://localhost:5174'
const OUT = 'C:/lamis/docs/manuals/images'
const W = 1360, H = 860

async function login(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1.5, locale: 'en-GB', timezoneId: 'Africa/Harare' })
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { email, password: 'demo1234' } })
  const body = await r.json()
  if (!body.success) throw new Error('login failed for ' + email)
  await ctx.addInitScript(() => { localStorage.setItem('auth_present', '1'); localStorage.setItem('vungu_cookie_consent', 'rejected') })
  return ctx
}

async function settle(page, test) {
  // the tiles say "Reading…" until their figures arrive
  await page.waitForSelector(`[data-testid^="${test}-tile-"]`, { timeout: 30000 })
  await page.waitForFunction(() => !/Reading/.test(document.body.innerText.replace('Reading queues', '')), null, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)
}

;(async () => {
  // Playwright's own Chromium if installed, otherwise the Edge that ships with Windows
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'msedge' }))
  try {
    const eo = await (await login(browser, 'demo.eo@vungu.test')).newPage()
    await eo.goto(`${BASE}/eo-planner-portal?section=team`)
    await settle(eo, 'tm')
    // below the app bar and the case bar: the rail, the heading and the tiles
    await eo.screenshot({ path: path.join(OUT, 'team-1-overview.png'), clip: { x: 0, y: 104, width: W, height: 690 } })
    console.log('  shot team-1-overview.png')

    await eo.goto(`${BASE}/eo-planner-portal?section=team&tab=planners`)
    await eo.waitForSelector('[data-testid="tm-desk-planners"]', { timeout: 30000 })
    await eo.waitForFunction(() => !/Reading the desk/.test(document.querySelector('[data-testid="tm-desk-planners"]').innerText), null, { timeout: 30000 })
    await eo.waitForTimeout(800)
    await eo.locator('[data-testid="tm-desk-planners"]').screenshot({ path: path.join(OUT, 'team-2-planners-desk.png') })
    console.log('  shot team-2-planners-desk.png')

    const clerk = await (await login(browser, 'demo.clerk@vungu.test')).newPage()
    await clerk.goto(`${BASE}/planning-clerk-portal`)
    await settle(clerk, 'clk')
    await clerk.locator('[data-testid="clk-glance"]').screenshot({ path: path.join(OUT, 'team-3-clerk-home.png') })
    console.log('  shot team-3-clerk-home.png')
  } finally {
    await browser.close()
  }
})().catch((e) => { console.error(e.message); process.exit(1) })
