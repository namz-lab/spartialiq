// One screenshot for every step of the Full Council demonstration (docs/presentations/council-demo-guide.md),
// taken by working the two cases through the real screens, signed in as each member of the team in turn.
//
// RUNS ON THE DEMONSTRATION COPY ONLY: the backend on 3011 over the local Docker database (lamis-db) and the
// front end on 5175, started as the guide's section 1 says. It refuses to run if the backend's database is not
// the local one. Everything it creates (two applications, two committee sittings, the receipts) is real data in
// that copy and is listed in demo-created.json.
//
//   node capture-demo-steps.js            -> docs/presentations/demo-steps/*.png
//
// Each step is done the way the presenter does it where that is one or two clicks on the screen; where the
// step is a form the presenter fills by hand, the script calls the same API the screen calls and then takes
// the screen. A step that fails is reported and the rest still run.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { chromium } = require('C:/lamis/frontend/node_modules/playwright')

const BASE = 'http://localhost:5175'
const API = 'http://localhost:3011/api'
const OUT = 'C:/lamis/docs/presentations/demo-steps'
const CREATED = path.join(__dirname, 'demo-created.json')
const W = 1360, H = 860
fs.mkdirSync(OUT, { recursive: true })

// Kept across runs, so every rehearsal's records stay listed.
const created = fs.existsSync(path.join(__dirname, 'demo-created.json'))
  ? JSON.parse(fs.readFileSync(path.join(__dirname, 'demo-created.json'), 'utf8'))
  : { permits: [], meetings: [], receipts: [] }
const save = () => fs.writeFileSync(CREATED, JSON.stringify(created, null, 2))
// One line only: the Windows shell would cut a query at its first line break and run what is left of it.
const psql = (sql) => execSync(`docker exec lamis-db psql -U postgres -d vungu_master_db_v1 -At -c "${sql.replace(/\s+/g, ' ').replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const today = () => new Date().toISOString().slice(0, 10)
const addDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const failures = []

// ── Safety: the demonstration backend must be on the local database ───────────────────────────────
function assertLocal() {
  const env = fs.readFileSync('C:/lamis/backend/.env.local.bak', 'utf8')
  if (!/localhost:5433\/vungu_master_db_v1/.test(env)) throw new Error('.env.local.bak does not point at the local database')
  const log = fs.existsSync('C:/lamis/demo-backend.log') ? fs.readFileSync('C:/lamis/demo-backend.log', 'utf8') : ''
  if (/neon\.tech/.test(log)) throw new Error('the demonstration backend log mentions a hosted database: refusing to run')
}

// ── Accounts ──────────────────────────────────────────────────────────────────────────────────────
async function login(browser, who) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1.5, locale: 'en-GB', timezoneId: 'Africa/Harare' })
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { email: `${who}@vungu.test`, password: 'demo1234' } })
  const body = await r.json()
  if (!body.success) throw new Error('login failed for ' + who)
  await ctx.addInitScript(() => { localStorage.setItem('auth_present', '1'); localStorage.setItem('vungu_cookie_consent', 'rejected') })
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  return { ctx, page, who }
}
async function api(as, method, url, data) {
  const r = await as.ctx.request.fetch(API.replace('localhost:3011', 'localhost:5175') + url, { method, data })
  const text = await r.text()
  let json; try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (r.status() >= 400) throw new Error(`${as.who} ${method} ${url} -> ${r.status()} ${text.slice(0, 240)}`)
  return json.data !== undefined ? json.data : json
}

// ── Screenshots ───────────────────────────────────────────────────────────────────────────────────
async function shot(page, file) {
  await sleep(600)
  await page.screenshot({ path: path.join(OUT, file) })
  console.log('  shot', file)
}
async function step(name, fn) {
  try { await fn() } catch (e) { failures.push(`${name}: ${e.message.split('\n')[0]}`); console.log('  FAILED', name, '-', e.message.split('\n')[0]) }
}
async function openEo(as, id, section) {
  await as.page.goto(`${BASE}/eo-planner-portal?case=${id}&section=${section}`)
  await as.page.waitForSelector('[data-testid="case-road"]', { timeout: 30000 }).catch(() => {})
  await sleep(1500)
}
async function waitGates(page) {
  await page.waitForFunction(() => { const p = document.querySelector('[data-testid="workflow-gates"]'); return p && !/Reading the case/.test(p.innerText) }, null, { timeout: 30000 })
  await sleep(500)
}

;(async () => {
  assertLocal()
  // Playwright's own Chromium if installed, otherwise the Edge that ships with Windows
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'msedge' }))
  const [cashier, clerk, planner, eo, revenue, supervisor, civilTech] = await Promise.all(
    ['demo.cashier', 'demo.clerk', 'demo.planner', 'demo.eo', 'demo.revenue', 'demo.supervisor', 'demo.civil-tech'].map((w) => login(browser, w)))

  // ═══ Before the meeting (guide, "The day before") ═══
  console.log('Preparing')
  // A till left open from an earlier day is cashed up (declared as expected, verified by the supervisor), then today's is opened.
  const stale = psql(`SELECT s.id FROM finance.cashier_session s JOIN public.users u ON u.id = s.cashier_id
                       WHERE u.email = 'demo.cashier@vungu.test' AND s.status = 'open' AND s.opened_at::date < current_date LIMIT 1`)
  if (stale) {
    const counts = psql(`SELECT json_agg(json_build_object('currency', currency, 'declared_total', total::text, 'explanation', 'Demonstration copy: cashed up before the meeting.'))
                           FROM (SELECT currency, sum(amount) FILTER (WHERE is_physical) AS total FROM finance.v_cashier_session_total WHERE cashier_session_id = '${stale}' GROUP BY currency) t`)
    const c = counts ? JSON.parse(counts).map((x) => ({ ...x, declared_total: Number(x.declared_total || 0).toFixed(2) })) : [{ currency: 'USD', declared_total: '0.00' }]
    await api(cashier, 'POST', `/finance/cash/sessions/${stale}/close`, { counts: c })
    await api(supervisor, 'POST', `/finance/cash/sessions/${stale}/verify`, { note: 'Cashed up before the demonstration.' })
    console.log('  cashed up the earlier session')
  }
  const hasToday = psql(`SELECT s.id FROM finance.cashier_session s JOIN public.users u ON u.id = s.cashier_id
                          WHERE u.email = 'demo.cashier@vungu.test' AND s.status = 'open' LIMIT 1`)
  if (!hasToday) {
    const point = psql(`SELECT id FROM finance.cash_point WHERE code = 'CASH-LGW'`)
    await api(cashier, 'POST', '/finance/cash/sessions', { cash_point_id: point })
    console.log('  opened today\'s cash session')
  }

  // The two applications, as lodged: pending payment, not acknowledged.
  const lodge = async (applicant, type, stand, description, ref) => {
    psql(`UPDATE spatial_planning.permit_application SET tpd_reference = NULL WHERE tpd_reference = '${ref}'`)
    const c = await api(planner, 'POST', '/permit-applications', { applicant_name: applicant, development_type: type, stand_number: stand, description, suburb_ward: 'Ward 7' })
    created.permits.push(c.id); save()
    psql(`UPDATE spatial_planning.permit_application SET tpd_reference = '${ref}', status = 'pending_payment', fee_paid_at = NULL, acknowledged_at = NULL WHERE id = '${c.id}'`)
    // the planner's land-use assessment against the plan (residential, use class A), which an approval rests on
    await api(planner, 'POST', `/permit-applications/${c.id}/rule-snapshot`, { land_use_code: 'A' }).catch((e) => console.log('  (no rule snapshot:', e.message.slice(0, 80) + ')'))
    return c.id
  }
  // An earlier rehearsal's two applications are withdrawn and renamed, so the cashier's search finds only today's.
  if (created.permits.length) {
    psql(`UPDATE spatial_planning.permit_application SET status = 'withdrawn', applicant_name = applicant_name || ' (rehearsal)'
           WHERE id IN (${created.permits.map((x) => `'${x}'`).join(',')}) AND applicant_name NOT LIKE '%(rehearsal)'`)
    // their acknowledgement and refusal letters are voided and renumbered: a letter number is unique, and today's must be free
    for (const table of ['clerk_acknowledgement', 'clerk_refusal']) {
      psql(`UPDATE spatial_planning.${table}
             SET voided_at = COALESCE(voided_at, now()), voided_reason = COALESCE(voided_reason, 'Demonstration rehearsal'),
                 letter_no = letter_no || '-R' || substr(id::text, 1, 6)
             WHERE permit_application_id IN (${created.permits.map((x) => `'${x}'`).join(',')}) AND letter_no NOT LIKE '%-R%'`)
    }
  }
  const id1 = await lodge('Mr B. Phiri', 'extension', '1378', 'Two-bedroom extension to the existing dwelling on the stand', 'TPD/VUN/2026/0911')
  const id2 = await lodge('Mrs L. Hlongwane', 'change_of_use', '1379', 'Change of use: part of the dwelling to a tuck shop, beside the Gweru road', 'TPD/VUN/2026/0912')

  // ── The four counter steps, used by both cases (screenshots only for case 1) ──
  async function payAtCashOffice(ref, payer, file) {
    const p = cashier.page
    await p.goto(`${BASE}/finance/cashier/issue-receipt`)
    await p.getByRole('heading', { name: 'Issue Receipt' }).first().waitFor({ timeout: 30000 })
    await p.locator('.cw-field', { hasText: 'Received from' }).locator('input').fill(payer)
    const service = p.locator('select[aria-label="Service"]').first()
    const opt = await service.locator('option', { hasText: 'Planning application fee' }).first().getAttribute('value')
    await service.selectOption(opt)
    await p.getByLabel('Unit amount').first().fill('50.00')
    await p.getByPlaceholder('Reference, register number, stand or applicant').fill(ref.slice(-4))
    await p.locator('.ir-hit', { hasText: ref }).first().click({ timeout: 15000 })
    if (file) await shot(p, file.replace('.png', '-form.png'))
    await p.getByRole('button', { name: 'Issue Receipt' }).click()
    await p.locator('[data-testid="ir-app-paid"]').waitFor({ timeout: 30000 })
    if (file) await shot(p, file)
  }
  async function showFeeCard(id, file) {
    const p = clerk.page
    await p.goto(`${BASE}/planning-clerk-portal?section=receipt&permit=${id}`)
    await p.locator('[data-testid="clk-rec-fee"]').waitFor({ timeout: 30000 })
    await p.locator('[data-testid="clk-rec-fee"]').scrollIntoViewIfNeeded()
    if (file) await shot(p, file)
  }
  async function stampReceipt(id, letter, file) {
    const p = clerk.page
    for (const box of await p.locator('.ins-checks input[type=checkbox]').all()) { if (!(await box.isChecked()) && await box.isEnabled()) await box.check() }
    const letterEl = p.locator('#clk-rec-letter')
    if (!(await letterEl.inputValue())) await letterEl.fill(letter)
    const to = p.locator('#clk-rec-to')
    if (!(await to.inputValue())) await to.fill('The applicant')
    await p.getByRole('button', { name: /Stamp receipt/ }).click()
    await sleep(2500)
    if (file) await shot(p, file)
  }
  async function markSent(ref, file) {
    const p = clerk.page
    await p.goto(`${BASE}/planning-clerk-portal?section=acknowledgements`)
    await sleep(2500)
    const row = p.locator('li, tr', { hasText: ref }).filter({ has: p.getByRole('button', { name: 'Mark sent' }) }).first()
    await row.getByRole('button', { name: 'Mark sent' }).click({ timeout: 15000 })
    // a short form: when it went and how; it counts as sent only once recorded
    await p.locator('#clk-ack-how').waitFor({ timeout: 15000 })
    if (!(await p.locator('#clk-ack-when').inputValue())) await p.locator('#clk-ack-when').fill(`${today()}T09:00`)
    const how = p.locator('#clk-ack-how')
    if (!(await how.inputValue())) await how.selectOption({ index: 0 })
    if (file) await shot(p, file.replace('.png', '-form.png'))
    await p.getByRole('button', { name: 'Record as sent' }).click()
    await sleep(2500)
    if (file) await shot(p, file)
  }

  // The committee: a sitting today, the case on its agenda, three members present, and the outcome.
  const roster = (await api(planner, 'GET', '/committee-members')).filter((m) => m.active !== false)
  async function committee(id, title, outcome, resolution) {
    const mtg = await api(planner, 'POST', '/committee-meetings', { title, meeting_date: today(), quorum: 2 })
    created.meetings.push(mtg.id); save()
    const item = await api(planner, 'POST', `/committee-meetings/${mtg.id}/agenda`, { permit_app_id: id, purpose: 'determination' })
    for (const m of roster.slice(0, 3)) await api(planner, 'POST', `/committee-meetings/${mtg.id}/attendance`, { member_id: m.id, status: 'present' })
    await api(eo, 'PATCH', `/agenda-items/${item.id}`, { outcome, resolution })
  }

  // The planner circulates a case to the departments on the circulation screen, each with a date to reply by.
  async function circulate(id, depts, file) {
    const p = planner.page
    await openEo(planner, id, 'circulation')
    for (const [dept, blocking] of depts) {
      const card = p.locator('li.tc-dept').filter({ has: p.locator('header', { hasText: dept }) }).first()
      await card.locator('.tc-send input[type=date]').fill(addDays(14))
      if (blocking) await card.locator('.tc-send input[type=checkbox]').check()
      await card.getByRole('button', { name: 'Circulate' }).click(); await sleep(1800)
    }
    await openEo(planner, id, 'circulation')
    if (file) await shot(p, file)
  }
  // The Civil Engineering Technician answers a referral on the Roads and Works referral desk: each head of the s.26(5)
  // infrastructure-cost test, then the department's reply and its reasons.
  async function roadsWorksReply(applicant, { costs, response, notes }, file) {
    const p = civilTech.page
    await p.goto(`${BASE}/units/engineering?view=referrals`)
    const item = p.locator('[data-testid="referrals-panel"] .rf-item', { hasText: applicant }).first()
    await item.waitFor({ timeout: 30000 })
    await item.getByRole('button', { name: 'Reply' }).click()
    for (const h of ['roads', 'parking', 'drainage', 'sewerage', 'water']) {
      await p.locator(`input[name="cost-${h}"][value="${!!costs[h]}"]`).check()
    }
    await p.locator(`input[name="resp"][value="${response}"]`).check()
    await p.locator('.rf-form textarea').last().fill(notes)
    await p.locator('.rf-form').scrollIntoViewIfNeeded()
    if (file) await shot(p, file)
    await p.getByRole('button', { name: 'Send the reply' }).click(); await sleep(2500)
  }
  const NO_COST = { roads: false, parking: false, drainage: false, sewerage: false, water: false }

  // ═══ Case 1: the extension, approved ═══
  console.log('Case 1')
  await step('1.1 cashier', () => payAtCashOffice('TPD/VUN/2026/0911', 'Mr B. Phiri', 'c1-01-cashier-receipt.png'))
  await step('1.2 clerk fee card', () => showFeeCard(id1, 'c1-02-clerk-fee-paid.png'))
  await step('1.3 clerk stamp', () => stampReceipt(id1, 'ACK/2026/0911', 'c1-03-clerk-stamped.png'))
  await step('1.4 clerk mark sent', () => markSent('0911', 'c1-04-clerk-ack-sent.png'))
  // No status is set by hand: the sent letter makes the case Acknowledged (migration 248), the first circulation puts it in
  // circulation, and the Act's questions put it under review (backend src/services/caseProgress.js).
  await step('1.5 planner circulation', () =>
    // Roads and Works, marked blocking, and Environmental health
    circulate(id1, [['Roads and Works', true], ['Environmental health', false]], 'c1-05-planner-circulation.png'))
  await step('1.5b Roads and Works replies: no objection, no cost to the council', () =>
    // A two-bedroom extension on a serviced stand adds nothing to the council's roads, parking, drains, sewers or water.
    roadsWorksReply('Phiri', {
      costs: NO_COST, response: 'no_objection',
      notes: 'No cost to the council under s.26(5): the extension uses the existing access, sewer and water connections. Roof water to a soakaway on the stand; the extension keeps clear of the road reserve.',
    }, 'c1-05b-roads-works-reply.png'))
  await step('1.6 planner Act questions', async () => {
    await openEo(planner, id1, 'decision'); await waitGates(planner.page)
    const box = planner.page.locator('[data-testid="statutory-checks"]')
    for (const r of await box.locator('input[type=radio]').all()) { if (/No/.test(await r.evaluate((e) => e.parentElement.innerText))) await r.click() }
    await box.getByRole('button', { name: 'Save answers' }).click(); await sleep(1500)
    await box.scrollIntoViewIfNeeded()
    await shot(planner.page, 'c1-06-planner-act-questions.png')
  })
  await step('1.7 clerk committee', async () => {
    // the other departments have answered by the time the committee sits (Roads and Works answered on its desk, step 1.5b)
    psql(`UPDATE spatial_planning.application_consultation SET response_status = 'no_objection', response_received_at = now(), task_status = 'accepted' WHERE permit_app_id = '${id1}' AND response_status = 'pending'`)
    await committee(id1, 'Planning Committee, November sitting', 'approved', 'Approved: the extension complies with the plan for the zone.')
    await openEo(clerk, id1, 'committee')
    await shot(clerk.page, 'c1-07-clerk-committee.png')
  })
  await step('1.8 EO determination', async () => {
    const p = eo.page
    await openEo(eo, id1, 'decision'); await waitGates(p)
    const check = p.getByRole('button', { name: /I have checked: none applies/ })
    if (await check.count()) { await check.click(); await sleep(1500) }
    // whatever the plan check still asks for: the acceptance box, or a reason in a sentence
    const plan = p.locator('[data-testid="plan-basis"]')
    if (await plan.count()) {
      for (const box of await plan.locator('input[type=checkbox]').all()) if (!(await box.isChecked())) await box.check()
      for (const t of await plan.locator('textarea').all()) await t.fill('The stand is not yet linked to a parcel of the register; the extension was assessed against the residential zone by the planner.')
    }
    await p.locator('textarea[placeholder^="Reasons for the decision"]').fill('Approved on the committee\'s resolution. The extension is a permitted use in the zone and stays within the stand\'s coverage.')
    await p.locator('.eodr-decide').scrollIntoViewIfNeeded().catch(() => {})
    await shot(p, 'c1-08-eo-determination-form.png')
    await p.getByRole('button', { name: 'Approve', exact: true }).click(); await sleep(3000)
    await openEo(eo, id1, 'decision')
    await p.getByText('Loading decision package').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
    await sleep(800)
    await shot(p, 'c1-08-eo-approved.png')
    const rw = p.locator('[data-testid="engineering-assessment"]')
    if (await rw.count()) { await rw.scrollIntoViewIfNeeded(); await shot(p, 'c1-08b-eo-roads-works-assessment.png') }
  })
  await step('1.9 EO permit and notification', async () => {
    const rev = psql(`SELECT revision FROM spatial_planning.permit_application WHERE id = '${id1}'`)
    await api(eo, 'PATCH', `/permit-applications/${id1}/case`, { notification_date: today(), expectedRevision: Number(rev) }).catch(() => null)
    await openEo(eo, id1, 'permits')
    await shot(eo.page, 'c1-09-eo-permit-issued.png')
  })
  await step('1.10 revenue planning fees', async () => {
    await revenue.page.goto(`${BASE}/finance/revenue/planning-fees`)
    await revenue.page.getByText('TPD/VUN/2026/0911').first().waitFor({ timeout: 30000 })
    await revenue.page.getByPlaceholder('Reference, stand, payer, receipt or voucher').fill('TPD/VUN/2026/0911'); await sleep(1500)
    await shot(revenue.page, 'c1-10-revenue-planning-fees.png')
  })

  // ═══ Case 2: the tuck shop, refused ═══
  console.log('Case 2')
  // Its fee and acknowledgement are done before the meeting (the guide's note), with no screenshots.
  await step('2.0 counter steps', async () => {
    await payAtCashOffice('TPD/VUN/2026/0912', 'Mrs L. Hlongwane', null)
    await showFeeCard(id2, null)
    await stampReceipt(id2, 'ACK/2026/0912', null)
    await markSent('0912', null)
    // it has been with the council a while: its clock started 65 days ago
    psql(`UPDATE spatial_planning.permit_application SET acknowledged_at = CURRENT_DATE - 65, statutory_due_date = CURRENT_DATE + 27 WHERE id = '${id2}'`)
  })
  await step('2.1 planner Act questions: yes to a State road', async () => {
    const p = planner.page
    await openEo(planner, id2, 'decision'); await waitGates(p)
    const box = p.locator('[data-testid="statutory-checks"]')
    for (const li of await box.locator('.wg-qs li').all()) {
      const isRoad = /State road/.test(await li.innerText())
      await li.locator('label', { hasText: isRoad ? 'Yes' : 'No' }).locator('input').click()
    }
    await box.getByRole('button', { name: 'Save answers' }).click(); await sleep(1500)
    await p.locator('[data-testid="workflow-gates"]').scrollIntoViewIfNeeded()
    await shot(p, 'c2-01-planner-state-road.png')
  })
  await step('2.2 planner records the referral', async () => {
    const p = planner.page
    await p.getByRole('button', { name: 'Record the referral' }).click(); await sleep(1800)
    await p.locator('[data-testid="statutory-checks"]').scrollIntoViewIfNeeded()
    await shot(p, 'c2-02-planner-referral-sent.png')
  })
  await step('2.2b planner circulates to Roads and Works', () =>
    circulate(id2, [['Roads and Works', true]], 'c2-02b-planner-circulates-roads-works.png'))
  await step('2.2c Roads and Works objects', () =>
    // The Gweru road is a State road: an access onto it is for the minister responsible for roads, not the council (the
    // referral of step 2.2). The council's concern is the traffic and parking the shop would bring, and the bend.
    roadsWorksReply('Hlongwane', {
      costs: NO_COST, response: 'objection',
      notes: 'Objection. The stand has no room for customer parking, so customers would stop on the shoulder of the Gweru road, on a bend where drivers cannot see far ahead. The Gweru road is a State road: any access onto it is for the Department of Roads, already referred under s.40(2)(c). No cost to the council under s.26(5) if the application is refused.',
    }, 'c2-02c-roads-works-objection.png'))
  let objection
  await step('2.3 clerk records the objection', async () => {
    objection = await api(clerk, 'POST', `/permit-applications/${id2}/objections`, { objector_name: 'Mr J. Khumalo', grounds_detail: 'Noise and traffic from a shop beside the road, and no parking for customers.' })
      .catch(() => api(eo, 'POST', `/permit-applications/${id2}/objections`, { objector_name: 'Mr J. Khumalo', grounds_detail: 'Noise and traffic from a shop beside the road, and no parking for customers.' }))
    await openEo(clerk, id2, 'notification')
    await clerk.page.locator('.pn-objections').first().scrollIntoViewIfNeeded().catch(() => {})
    await shot(clerk.page, 'c2-03-clerk-objection.png')
  })
  await step('2.4 EO considers the objection', async () => {
    await api(eo, 'PATCH', `/objections/${objection.id}/consideration`, { sustained: true, consideration_notes: 'Sustained: there is no parking, and the stand is on a bend. Roads and Works objects on the same grounds.' })
    await openEo(eo, id2, 'notification')
    await eo.page.locator('.pn-objections').first().scrollIntoViewIfNeeded()
    await shot(eo.page, 'c2-04-eo-objection-considered.png')
  })
  await step('2.5 clerk puts it to the applicant', async () => {
    const p = clerk.page
    await openEo(clerk, id2, 'notification')
    await p.getByRole('button', { name: /Put to the applicant/ }).click(); await sleep(2000)
    await p.locator('.pn-objections').first().scrollIntoViewIfNeeded()
    await shot(p, 'c2-05-clerk-put-to-applicant.png')
  })
  await step('2.6 EO records the written extension', async () => {
    const p = eo.page
    await openEo(eo, id2, 'decision'); await waitGates(p)
    await p.getByRole('button', { name: /Record the applicant's written extension/ }).click(); await sleep(500)
    await p.locator('.wg-form input[type=date]').first().fill(addDays(45))
    await p.locator('.wg-form input[type=text]').first().fill("Mrs Hlongwane's letter of 12 November, file TPD/VUN/2026, item 14")
    await p.getByRole('button', { name: 'Record extension' }).click(); await sleep(2000)
    await openEo(eo, id2, 'decision'); await waitGates(p)
    await shot(p, 'c2-06-eo-extension.png')
  })
  await step('safeguard: approval refused', async () => {
    const p = eo.page
    const check = p.getByRole('button', { name: /I have checked: none applies/ })
    if (await check.count()) { await check.click(); await sleep(1500) }
    // Approve stays disabled while a gate is open; the gates panel says which one and why.
    const approve = p.getByRole('button', { name: 'Approve', exact: true })
    if (await approve.isEnabled()) {
      await p.locator('textarea[placeholder^="Reasons for the decision"]').fill('Trying to approve before the referral is answered.')
      await approve.click(); await sleep(2000)
    }
    await p.locator('[data-testid="workflow-gates"]').scrollIntoViewIfNeeded()
    await shot(p, 'c2-06b-safeguard-approval-refused.png')
  })
  await step('2.7 clerk records the committee refusal', async () => {
    await committee(id2, 'Planning Committee, special sitting', 'refused', 'Refused: no parking is provided, the access is on a bend of the Gweru road (Roads and Works objects), and the objection is sustained.')
    await openEo(clerk, id2, 'committee')
    await shot(clerk.page, 'c2-07-clerk-committee-refused.png')
  })
  await step('2.8 EO refuses with reasons', async () => {
    const p = eo.page
    await openEo(eo, id2, 'decision'); await waitGates(p)
    const check = p.getByRole('button', { name: /I have checked: none applies/ })
    if (await check.count()) { await check.click(); await sleep(1500) }
    await p.locator('textarea[placeholder^="Reasons for the decision"]').fill('Refused on the committee\'s resolution (s.26(6)(b)): no parking is provided for customers, who would stop on the shoulder of the Gweru road on a bend (the objection of the Department of Roads and Works); and the objection of Mr J. Khumalo is sustained. The applicant may appeal to the Administrative Court within one month of notification.')
    await p.getByRole('button', { name: 'Refuse', exact: true }).click(); await sleep(3000)
    await openEo(eo, id2, 'decision')
    await p.getByText('Loading decision package').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
    await sleep(800)
    await shot(p, 'c2-08-eo-refused.png')
    const rw = p.locator('[data-testid="engineering-assessment"]')
    if (await rw.count()) { await rw.scrollIntoViewIfNeeded(); await shot(p, 'c2-08b-eo-roads-works-objection.png') }
  })
  await step('2.9 clerk refusal letter', async () => {
    // the clerk drafts the letter on the open file, from the committee's resolution
    await api(clerk, 'POST', '/planning-clerk/registers/refusals', {
      permit_application_id: id2, letter_no: 'VRDC/PL/REF/2026/0912', recipient: 'Mrs L. Hlongwane',
      council_resolution_date: new Date().toISOString(), due_by: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      reasons: 'No parking is provided for customers, who would stop on the shoulder of the Gweru road on a bend (the objection of the council\'s Department of Roads and Works); the objection of Mr J. Khumalo is sustained. You may appeal to the Administrative Court within one month of being notified.' })
    await clerk.page.goto(`${BASE}/planning-clerk-portal?section=refusals`)
    await sleep(3000)
    await shot(clerk.page, 'c2-09-clerk-refusal-letter.png')
  })

  // ═══ Opening: the EO's first screen ═══
  await step('the EO at a glance', async () => {
    await eo.page.goto(`${BASE}/eo-planner-portal?section=team`)
    await eo.page.waitForSelector('[data-testid^="tm-tile-"]', { timeout: 30000 }); await sleep(2500)
    await shot(eo.page, 'c0-eo-at-a-glance.png')
  })

  await browser.close()
  save()
  console.log(failures.length ? `\n${failures.length} step(s) failed:\n  ${failures.join('\n  ')}` : '\nall steps captured')
  console.log('created', JSON.stringify({ id1, id2 }))
})().catch((e) => { console.error('FAILED:', e.message); save(); process.exit(1) })
