// Takes the screenshots for the EO Planning manual from the running app, working two example cases through their steps.
// Demo accounts only. Everything created is recorded in created.json so cleanup.js can remove it.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { chromium } = require('C:/lamis/frontend/node_modules/playwright')

const BASE = 'http://localhost:5174'
const OUT = 'C:/lamis/docs/manuals/images'
const CREATED = path.join(__dirname, 'created.json')
const created = { permits: [], meetings: [], members: [], referrals: [] }
const save = () => fs.writeFileSync(CREATED, JSON.stringify(created, null, 2))
fs.mkdirSync(OUT, { recursive: true })

const psql = (sql) => execSync(`docker exec lamis-db psql -U postgres -d vungu_master_db_v1 -At -c "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (n) => iso(new Date(Date.now() + n * 86_400_000))

async function login(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 2600 }, deviceScaleFactor: 1.5, locale: 'en-GB', timezoneId: 'Africa/Harare' })
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { email, password: 'demo1234' } })
  const body = await r.json()
  if (!body.success) throw new Error('login failed for ' + email)
  await ctx.addInitScript(() => { localStorage.setItem('auth_present', '1'); localStorage.setItem('vungu_cookie_consent', 'rejected') })
  return ctx
}
async function api(ctx, method, url, data) {
  const r = await ctx.request.fetch(BASE + '/api' + url, { method, data })
  const text = await r.text()
  let json; try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (r.status() >= 400) throw new Error(`${method} ${url} -> ${r.status()} ${text.slice(0, 300)}`)
  return json.data !== undefined ? json.data : json
}

async function openCase(page, id, section) {
  await page.goto(`${BASE}/eo-planner-portal?case=${id}&section=${section}`)
  await page.waitForSelector('[data-testid="case-road"]', { timeout: 20000 })
  await sleep(1200)
}
async function waitPanel(page) {
  await page.waitForFunction(() => { const p = document.querySelector('[data-testid="workflow-gates"]'); return p && !/Reading the case/.test(p.innerText) }, null, { timeout: 20000 })
  await sleep(400)
}
async function shot(page, selector, file, { pad = 0 } = {}) {
  const loc = page.locator(selector).first()
  await loc.scrollIntoViewIfNeeded()
  await loc.screenshot({ path: path.join(OUT, file) })
  console.log('  shot', file)
}
async function shotRegion(page, selectors, file) {
  // the union of several elements, e.g. the case bar and the road under it
  const boxes = []
  for (const s of selectors) { const b = await page.locator(s).first().boundingBox(); if (b) boxes.push(b) }
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y))
  const x2 = Math.max(...boxes.map((b) => b.x + b.width)), y2 = Math.max(...boxes.map((b) => b.y + b.height))
  await page.screenshot({ path: path.join(OUT, file), clip: { x, y, width: x2 - x, height: y2 - y } })
  console.log('  shot', file)
}
async function top(page, file) { await page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, width: 1360, height: 860 } }); console.log('  shot', file) }
async function page_(ctx) { const p = await ctx.newPage(); p.on('dialog', (d) => d.accept()); return p }

;(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Users/Dr Paradzayi/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
  const planner = await login(browser, 'demo.planner@vungu.test')
  const eoCtx = await login(browser, 'demo.eo@vungu.test')
  const eo = await page_(eoCtx)

  const newCase = async (applicant, type, stand, description, ref) => {
    const c = await api(planner, 'POST', '/permit-applications', { applicant_name: applicant, development_type: type, stand_number: stand, description })
    created.permits.push(c.id); save()
    psql(`UPDATE spatial_planning.permit_application SET tpd_reference = '${ref}' WHERE id = '${c.id}'`)
    let rev = c.revision
    for (const status of ['acknowledged', 'under_review']) {
      const r = await api(planner, 'PATCH', `/permit-applications/${c.id}/status`, { status, expectedRevision: rev })
      rev = r.revision
    }
    return c.id
  }

  const roster = (await api(planner, 'GET', '/committee-members')).filter((m) => m.active !== false)
  const present = async (mid) => { for (const m of roster.slice(0, 3)) await api(planner, 'POST', `/committee-meetings/${mid}/attendance`, { member_id: m.id, status: 'present' }) }
  // ═══ Example 1: an unopposed extension, decided by the committee ═══
  console.log('Example 1')
  const id1 = await newCase('Mr B. Phiri', 'extension', '1378', 'Two-bedroom extension to the existing dwelling on the stand', 'TPD/VUN/2026/0911')
  await api(planner, 'POST', `/permit-applications/${id1}/rule-snapshot`, { land_use_code: 'A' })

  // the second case is lodged now too, so the dashboard shows a working day
  const id2 = await newCase('Mrs L. Hlongwane', 'change_of_use', '1379', 'Change of use: part of the dwelling to a tuck shop, beside the Gweru road', 'TPD/VUN/2026/0912')
  psql(`UPDATE spatial_planning.permit_application SET acknowledged_at = CURRENT_DATE - 65 WHERE id = '${id2}'`)
  await api(planner, 'POST', `/permit-applications/${id2}/rule-snapshot`, { land_use_code: 'A' }).catch(() => null)
  await eo.goto(`${BASE}/eo-planner-portal?section=dashboard`); await sleep(3500)
  await top(eo, 'console-dashboard.png')

  await openCase(eo, id1, 'decision'); await waitPanel(eo)
  await shotRegion(eo, ['.eo-casebar', '[data-testid="case-road"]'], 'ex1-1-case-bar.png')
  await shot(eo, '[data-testid="workflow-gates"]', 'ex1-2-before-you-decide-blocked.png')

  // the EO answers "no" to each of the Act's questions and records the direction check, on the screen
  const box = eo.locator('[data-testid="statutory-checks"]')
  for (const r of await box.locator('input[type=radio]').all()) { if (/No/.test(await r.evaluate((e) => e.parentElement.innerText))) await r.click() }
  await box.getByRole('button', { name: 'Save answers' }).click(); await sleep(1200)
  await eo.getByRole('button', { name: /I have checked: none applies/ }).click(); await sleep(1200)
  await shot(eo, '[data-testid="workflow-gates"]', 'ex1-3-before-you-decide-answered.png')

  // the committee hears it
  const mtg = await api(planner, 'POST', '/committee-meetings', { title: 'Planning Committee, November sitting', meeting_date: addDays(0), quorum: 2 })
  created.meetings.push(mtg.id); save()
  const item = await api(planner, 'POST', `/committee-meetings/${mtg.id}/agenda`, { permit_app_id: id1, purpose: 'determination' })
  await present(mtg.id)
  await api(eoCtx, 'PATCH', `/agenda-items/${item.id}`, { outcome: 'approved', resolution: 'Approved: the extension complies with the plan for the zone.' })
  await openCase(eo, id1, 'committee'); await sleep(1500)
  await top(eo, 'ex1-4-committee.png')

  // the decision
  await openCase(eo, id1, 'decision'); await waitPanel(eo)
  await shot(eo, '[data-testid="workflow-gates"]', 'ex1-5-before-you-decide-ready.png')
  await eo.locator('textarea[placeholder^="Reasons for the decision"]').fill('Approved on the committee\'s resolution. The extension is a permitted use in the zone and stays within the stand\'s coverage.')
  await sleep(400)
  await shot(eo, '.eodr-decide', 'ex1-6-determination.png')
  await eo.getByRole('button', { name: 'Approve', exact: true }).click(); await sleep(2500)
  await openCase(eo, id1, 'permits'); await sleep(2000)
  await shotRegion(eo, ['.eo-casebar', '[data-testid="case-road"]'], 'ex1-7-decided-road.png')
  await top(eo, 'ex1-8-permits.png')

  // ═══ Example 2: an objected application beside a State road ═══
  console.log('Example 2')
  await openCase(eo, id2, 'decision'); await waitPanel(eo)
  await shotRegion(eo, ['.eo-casebar', '[data-testid="case-road"]'], 'ex2-1-case-bar-dates.png')
  const box2 = eo.locator('[data-testid="statutory-checks"]')
  // yes to the State road question, no to the rest
  for (const li of await box2.locator('.wg-qs li').all()) {
    const isRoad = /State road/.test(await li.innerText())
    await li.locator('label', { hasText: isRoad ? 'Yes' : 'No' }).locator('input').click()
  }
  await box2.getByRole('button', { name: 'Save answers' }).click(); await sleep(1400)
  await shot(eo, '[data-testid="workflow-gates"]', 'ex2-2-road-referral-waiting.png')
  await eo.getByRole('button', { name: 'Record the referral' }).click(); await sleep(1400)
  await shot(eo, '[data-testid="statutory-checks"]', 'ex2-3-road-referral-sent.png')

  // an objection arrives at the counter; the EO considers it and puts it to the applicant
  const ob = await api(eoCtx, 'POST', `/permit-applications/${id2}/objections`, { objector_name: 'Mr J. Khumalo', grounds_detail: 'Noise and traffic from a shop beside the road, and no parking for customers.' })
  await api(eoCtx, 'PATCH', `/objections/${ob.id}/consideration`, { sustained: true, consideration_notes: 'Sustained: there is no parking, and the stand is on a bend.' })
  await openCase(eo, id2, 'notification'); await sleep(2000)
  await eo.locator('.pn-objections').first().scrollIntoViewIfNeeded()
  await shot(eo, '.pn-objections', 'ex2-4-objection-to-put.png')
  await eo.getByRole('button', { name: /Put to the applicant/ }).click(); await sleep(1800)
  await shot(eo, '.pn-objections', 'ex2-5-objection-put.png')

  // the clock: the applicant agrees, in writing, to more time
  await openCase(eo, id2, 'decision'); await waitPanel(eo)
  await eo.getByRole('button', { name: /Record the applicant's written extension/ }).click(); await sleep(500)
  await eo.locator('.wg-form input[type=date]').first().fill(addDays(30))
  await eo.locator('.wg-form input[type=text]').first().fill("Mrs Hlongwane's letter of 12 November, file TPD/VUN/2026, item 14")
  await sleep(300)
  await shot(eo, '[data-testid="workflow-gates"]', 'ex2-6-extension.png')
  await eo.getByRole('button', { name: 'Record extension' }).click(); await sleep(1500)

  // the committee refuses; the EO refuses with reasons
  const mtg2 = await api(planner, 'POST', '/committee-meetings', { title: 'Planning Committee, special sitting', meeting_date: addDays(0), quorum: 2 })
  created.meetings.push(mtg2.id); save()
  const item2 = await api(planner, 'POST', `/committee-meetings/${mtg2.id}/agenda`, { permit_app_id: id2, purpose: 'determination' })
  await present(mtg2.id)
  await api(eoCtx, 'PATCH', `/agenda-items/${item2.id}`, { outcome: 'refused', resolution: 'Refused: no parking is provided, the objection is sustained, and the access is on a bend.' })
  await api(eoCtx, 'POST', `/permit-applications/${id2}/direction-check`).catch(() => null)
  await openCase(eo, id2, 'decision'); await waitPanel(eo)
  await shot(eo, '[data-testid="workflow-gates"]', 'ex2-7-before-refusing.png')
  await eo.locator('textarea[placeholder^="Reasons for the decision"]').fill('Refused on the committee\'s resolution (s.26(6)(b)): no parking is provided for customers, the objection of Mr J. Khumalo is sustained, and the access is on a bend of the Gweru road. The applicant may appeal to the Administrative Court within one month of notification.')
  await sleep(300)
  await eo.getByRole('button', { name: 'Refuse', exact: true }).click(); await sleep(2500)
  await openCase(eo, id2, 'permits'); await sleep(1800)
  await shotRegion(eo, ['.eo-casebar', '[data-testid="case-road"]'], 'ex2-8-refused-road.png')

  // ═══ the registers ═══
  await eo.goto(`${BASE}/eo-planner-portal?section=workflow`); await sleep(2500)
  await top(eo, 'reg-1-referral-log.png')
  await eo.getByRole('tab', { name: 'Switches' }).click(); await sleep(800)
  await top(eo, 'reg-2-switches.png')

  await browser.close()
  console.log('done', JSON.stringify({ id1, id2 }))
})().catch((e) => { console.error('FAILED:', e.message); save(); process.exit(1) })
