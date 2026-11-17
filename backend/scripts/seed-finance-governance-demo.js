#!/usr/bin/env node
/**
 * Governance demo data for the finance module: publication, documents, internal audit and finance
 * access administration. Builds on the DD- financial year (scripts/seed-finance-director-demo.js).
 *
 * Everything is driven through the real API as the correct demo role (publisher requests and
 * publishes, demo.treasurer approves or rejects, demo.auditor runs the audit plan, demo.admin sets
 * access), so separation of duties and the audit trail are genuine. Afterwards the timestamps are
 * moved back to plausible dates in Jul–Nov 2026 with a direct UPDATE (the only SQL writes).
 *
 * WHAT IT CREATES (identified by the prefix GOV)
 *   Publications (scope.seed = 'GOV'), for the open year:
 *     budget v1      published  (approved budget estimates; approved budget lines marked published)
 *     documents v1   published  (the public documents register)
 *     reports v1     published  (Q1 Jul–Sep 2026 budget performance report)
 *     expenditure v1 withdrawn  (published, then withdrawn with a reason)
 *     revenue v1     rejected   (by the treasurer, with a reason)
 *     revenue v2     published  (the resubmission, approved and live)
 *     expenditure v2 published  (re-release after the withdrawal)
 *     projects v1    approved   (waiting for the publisher to put it live)
 *     reports v2     pending    (Q2 interim report waiting for the treasurer)
 *   Documents (small generated PDFs, uploaded through POST /finance/documents): 4 public, 3 internal,
 *     2 private, attached to the year, the publications, a budget line, a transaction and a project.
 *   Internal audit: 6 engagements (notes start "Ref GOV-IA-…") across not_started / in_progress
 *     (fieldwork, reporting) / completed, with 15 findings (detail starts "Ref GOV-IA-…/F…"):
 *     high/medium/low, open, open-with-management-response, overdue and closed (on time and late).
 *   Finance access: demo.dept-head scoped to Engineering (DD-ENG); demo.revenue granted the till
 *     (finance.cash.session.operate) until 31 Dec 2026 as a relief cashier. (The budget seed sets the
 *     same dept-head scope; whichever runs first writes it, the other skips.)
 *
 * USAGE (local database only — refuses any other host):
 *   DATABASE_URL=postgresql://…@127.0.0.1:5434/… API_BASE=http://127.0.0.1:3011 \
 *     node scripts/seed-finance-governance-demo.js [--report | --clean]
 *
 * Idempotent: every item is looked up first and only missing steps are performed. A re-run also
 * marks any budget line approved since the last run as published (the budget is live).
 * --clean removes what this script created (publications, documents and their files, audit
 * engagements and findings) and lifts the till override (the dept-head scope is left, as the
 * budget seed relies on it). Nothing here posts to the ledger.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const { Client } = require('pg')
const { allowRemoteDb, allowRemoteApi, unguardFinanceTriggers, reguardFinanceTriggers } = require('./lib/seed-remote')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error('DATABASE_URL is required.'); process.exit(1) }
allowRemoteDb(DATABASE_URL, { what: 'seed-finance-governance-demo.js' })
const API = (process.env.API_BASE || 'http://127.0.0.1:3011').replace(/\/$/, '')
const PASSWORD = process.env.DEMO_PASSWORD || 'demo1234'
const SEED = 'GOV'
const args = new Set(process.argv.slice(2))

// ── API ──────────────────────────────────────────────────────────────────────────────────────────
const tokens = {}
async function login(who) {
  if (tokens[who]) return tokens[who]
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `demo.${who}@vungu.test`, password: PASSWORD }),
  })
  if (res.status !== 200) throw new Error(`login demo.${who} failed: ${res.status} ${await res.text()}`)
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || '']
  const access = cookies.find((c) => c.startsWith('vungu_at='))
  if (!access) throw new Error(`login demo.${who} returned no vungu_at cookie`)
  await res.arrayBuffer()
  tokens[who] = access.split(';')[0]
  return tokens[who]
}

async function call(who, method, path, body, { expect = [200, 201], form } = {}) {
  const headers = { cookie: await login(who) }
  let payload
  if (form) payload = form
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body) }
  const res = await fetch(`${API}/api${path}`, { method, headers, body: payload })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!expect.includes(res.status)) {
    throw new Error(`${who} ${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`)
  }
  return { status: res.status, data: json.data, body: json }
}

// ── A small, valid PDF ───────────────────────────────────────────────────────────────────────────
function makePdf(title, lines) {
  const esc = (s) => String(s).replace(/[^\x20-\x7e]/g, '-').replace(/[\\()]/g, (m) => `\\${m}`)
  let content = `BT /F2 15 Tf 50 790 Td (${esc(title)}) Tj ET\n`
  content += 'BT /F1 9 Tf 50 772 Td (Vungu Rural District Council - Finance Department, P.O. Box 41, Gweru) Tj ET\n'
  let y = 745
  for (const line of lines) {
    if (y < 50) break
    const bold = line.startsWith('## ')
    content += `BT /${bold ? 'F2' : 'F1'} ${bold ? 11 : 10} Tf 50 ${y} Td (${esc(bold ? line.slice(3) : line)}) Tj ET\n`
    y -= bold ? 18 : 14
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── Definitions ──────────────────────────────────────────────────────────────────────────────────
// Each publication: its key, dataset, the target state and the back-dated timeline.
const PUBLICATIONS = [
  { key: 'budget-v1', dataset: 'budget', target: 'published', label: 'Approved budget estimates 2026/27',
    asAt: '2026-06-30', created: '2026-07-06 09:20', approved: '2026-07-14 15:10', published: '2026-07-15 10:05',
    request: 'Approved estimates as adopted by full Council (resolution 14/2026). Release to the public portal.',
    approveNote: 'Approved for release: matches the estimates adopted by Council on 26 June 2026.' },
  { key: 'documents-v1', dataset: 'documents', target: 'published', label: 'Council finance documents register',
    asAt: '2026-07-15', created: '2026-07-06 09:25', approved: '2026-07-14 15:12', published: '2026-07-15 10:07',
    request: 'Open the public documents register so the approved budget book and resolution can be downloaded.',
    approveNote: 'Approved. Only documents classified public by the publisher will appear.' },
  { key: 'reports-v1', dataset: 'reports', target: 'published', label: 'Q1 2026/27 (July-September 2026) budget performance report',
    asAt: '2026-09-30', created: '2026-10-13 08:45', approved: '2026-10-20 14:30', published: '2026-10-21 09:00',
    request: 'Quarterly budget performance report for Q1, as tabled at the Finance and General Purposes Committee on 20 October 2026.',
    approveNote: 'Approved by the Finance Committee, minute F&GP/10/2026/4.' },
  { key: 'expenditure-v1', dataset: 'expenditure', target: 'withdrawn', label: 'Q1 2026/27 expenditure (July-September 2026)',
    asAt: '2026-09-30', created: '2026-10-13 08:50', approved: '2026-10-20 14:35', published: '2026-10-21 09:04', withdrawn: '2026-10-23 11:40',
    request: 'Q1 expenditure by department and account, to accompany the Q1 performance report.',
    approveNote: 'Approved with the Q1 report.',
    withdrawReason: 'Withdrawn: the released expenditure dataset included scheduled postings dated after the 30 September 2026 reporting date. It will be re-released once the period cut-off is applied.' },
  { key: 'revenue-v1', dataset: 'revenue', target: 'rejected', label: 'Q1 2026/27 revenue (July-September 2026)',
    asAt: '2026-09-30', created: '2026-10-13 08:55', reviewed: '2026-10-20 14:40',
    request: 'Q1 revenue collected by source, to accompany the Q1 performance report.',
    rejectNote: 'Rejected: September ZWG receipts are not yet reconciled to the bank statement. Resubmit after the September bank reconciliation is signed off by the Treasurer.' },
  { key: 'revenue-v2', dataset: 'revenue', target: 'published', label: '2026/27 revenue to date (July-November 2026)',
    asAt: '2026-11-15', created: '2026-11-10 09:40', approved: '2026-11-13 16:00', published: '2026-11-16 08:30',
    request: 'Resubmission of the revenue release after the September bank reconciliation was signed off (rejected v1). Revenue collected to date.',
    approveNote: 'September reconciliation signed off on 6 November 2026. Approved for release.' },
  { key: 'expenditure-v2', dataset: 'expenditure', target: 'published', label: '2026/27 expenditure to date (July-November 2026)',
    asAt: '2026-11-15', created: '2026-11-10 09:45', approved: '2026-11-13 16:02', published: '2026-11-16 08:32',
    request: 'Re-release of expenditure with the period cut-off applied (replaces the withdrawn v1). Expenditure posted to date only.',
    approveNote: 'Cut-off confirmed: no posting after the data-as-at date. Approved for release.' },
  { key: 'projects-v1', dataset: 'projects', target: 'approved', label: 'Capital projects register - November 2026',
    asAt: '2026-10-31', created: '2026-11-09 10:15', approved: '2026-11-13 16:05',
    request: 'Capital projects with progress to 31 October 2026 (roads, culverts, boreholes).',
    approveNote: 'Approved for release. Publisher to put live after the ward councillors have been briefed.' },
  { key: 'reports-v2', dataset: 'reports', target: 'pending', label: 'Q2 2026/27 interim (October 2026) budget performance report',
    asAt: '2026-10-31', created: '2026-11-16 11:30',
    request: 'Interim Q2 position to 31 October 2026 for the November Finance Committee. Awaiting Committee approval.' },
]

const ENGAGEMENTS = [
  { ref: 'GOV-IA-2026-01', title: 'Cash office surprise cash count - Head office and Lower Gweru sub-office', area: 'Cash management',
    phase: 'follow_up', status: 'completed', start: '2026-07-13', end: '2026-07-24', created: '2026-07-01 08:30', completed: '2026-08-07 16:00',
    notes: 'Unannounced count of all tills and the main safe on 14 July 2026. Report issued 7 August 2026.',
    findings: [
      { risk: 'high', title: 'Cash-up variance of USD 312 at Lower Gweru not explained in writing',
        detail: 'Till LG-02 was short by USD 312.00 at the count; the shortage had been carried for four days without a written explanation or supervisor sign-off.',
        action: 'Cash supervisor to sign every variance above USD 20 on the day; shortages above USD 100 reported to the Treasurer.', owner: 'Cash Supervisor',
        due: '2026-08-31', created: '2026-07-24 15:00', close: { at: '2026-08-26 10:00', note: 'Variance register introduced 3 August 2026; tested 20 cash-ups in August, all signed. Closed.' } },
      { risk: 'medium', title: 'Spare safe key held by a cashier instead of the Treasurer',
        detail: 'The duplicate key to the main safe was found in the desk drawer of a cashier at head office.',
        action: 'Duplicate key to be lodged with the Treasurer in a sealed envelope, logged in the key register.', owner: 'Treasurer',
        due: '2026-08-15', created: '2026-07-24 15:05', close: { at: '2026-08-04 09:30', note: 'Key lodged and sealed 4 August 2026; key register sighted.' } },
      { risk: 'low', title: 'Manual receipt books not issued in sequence',
        detail: 'Two manual receipt books (Nos. 0451 and 0453) were in use while book 0452 was unissued in the store.',
        action: 'Issue manual receipt books strictly in sequence and record issue and return in the stationery register.', owner: 'Revenue Officer',
        due: '2026-10-31', created: '2026-07-24 15:10' },
    ] },
  { ref: 'GOV-IA-2026-02', title: 'Revenue collection - rates, licences and levies (Q1)', area: 'Revenue',
    phase: 'reporting', status: 'in_progress', start: '2026-08-17', end: '2026-10-09', created: '2026-08-10 09:00',
    notes: 'Draft report issued to the Treasurer on 30 October 2026; management responses received on two of four findings.',
    findings: [
      { risk: 'high', title: '38 commercial properties in Mvuma and Lower Gweru not on the valuation roll',
        detail: 'A field check of business centres found 38 trading stands with no rates account, an estimated USD 41,000 a year not billed.',
        action: 'Management response (6 Nov 2026): the Revenue Officer will add the stands to the supplementary valuation roll and bill from 1 January 2027.', owner: 'Revenue Officer',
        due: '2026-12-15', created: '2026-10-28 10:00' },
      { risk: 'medium', title: 'Rates arrears over 90 days not followed up',
        detail: '61% of rates debtors by value are over 90 days; no final demands were issued between July and September.',
        action: 'Issue final demands to all accounts over 90 days and report progress monthly to the F&GP Committee.', owner: 'Revenue Officer',
        due: '2026-11-10', created: '2026-10-28 10:10' },
      { risk: 'medium', title: 'ZWG receipts posted before bank confirmation',
        detail: 'Receipts for ZWG transfers were issued on the strength of payer proof-of-payment slips, before the funds were seen in the bank.',
        action: 'Management response (11 Nov 2026): ZWG transfer receipts will be issued only after the cashbook officer confirms the credit.', owner: 'Treasurer',
        due: '2026-12-31', created: '2026-10-28 10:20' },
      { risk: 'low', title: 'Approved 2026/27 tariff schedule not displayed at the cash office',
        detail: 'Ratepayers could not see the approved tariffs at the head-office counter.',
        action: 'Display the approved tariff schedule at every collection point.', owner: 'Revenue Officer',
        due: '2026-11-15', created: '2026-10-28 10:30', close: { at: '2026-11-05 12:00', note: 'Tariff schedule displayed at head office and Lower Gweru; photographs on file.' } },
    ] },
  { ref: 'GOV-IA-2026-03', title: 'Payroll and allowances', area: 'Payroll',
    phase: 'fieldwork', status: 'in_progress', start: '2026-10-12', end: '2026-11-27', created: '2026-10-05 08:00',
    notes: 'Headcount verification at the Mvuma and Shurugwi road camps completed; testing of allowances in progress.',
    findings: [
      { risk: 'high', title: 'Two former general hands still on the payroll after termination',
        detail: 'Two general hands at the Mvuma road camp whose contracts ended on 31 July 2026 were paid for August, September and October (USD 1,860 in total).',
        action: 'Remove both from the payroll, recover the overpayment and reconcile HR terminations to payroll monthly.', owner: 'Human Resources Officer',
        due: '2026-11-30', created: '2026-11-04 14:00' },
      { risk: 'medium', title: 'Overtime paid without prior written authorisation',
        detail: '14 of 30 overtime claims sampled for September had no authorisation signed before the work was done.',
        action: 'Overtime to be pre-authorised on form HR-OT1 by the head of department.', owner: 'Engineering Department',
        due: '2026-12-18', created: '2026-11-04 14:10' },
      { risk: 'low', title: 'Leave records not updated for the Engineering department',
        detail: 'Leave cards for 9 Engineering staff had not been updated since May 2026.',
        action: 'Update leave records and reconcile to the leave register.', owner: 'Human Resources Officer',
        due: '2027-01-15', created: '2026-11-04 14:20' },
    ] },
  { ref: 'GOV-IA-2026-04', title: 'Procurement and creditors - road maintenance contracts', area: 'Procurement',
    phase: 'fieldwork', status: 'in_progress', start: '2026-09-21', end: '2026-11-13', created: '2026-09-14 08:00',
    notes: 'Testing of 25 purchase orders over USD 1,000 raised July to September 2026. Exit meeting scheduled.',
    findings: [
      { risk: 'high', title: 'Gravel supply for the Shurugwi road split to stay under the tender threshold',
        detail: 'Three orders to the same supplier within nine days (USD 9,400, 9,800 and 9,650) for one stretch of road, each just below the USD 10,000 formal-tender threshold.',
        action: 'Aggregate requirements per project; procurement committee to review all same-supplier orders within 30 days.', owner: 'Procurement Officer',
        due: '2026-11-06', created: '2026-10-19 11:00' },
      { risk: 'medium', title: 'Three quotations not on file for six purchases',
        detail: 'Six purchases between USD 1,000 and USD 5,000 had fewer than three written quotations on file.',
        action: 'Attach all three quotations to the requisition before an order is raised.', owner: 'Procurement Officer',
        due: '2026-10-31', created: '2026-10-05 11:00', close: { at: '2026-10-27 15:00', note: 'Requisition checklist updated; 10 October orders tested, all with three quotations.' } },
      { risk: 'medium', title: 'Goods received notes signed by the person who requisitioned',
        detail: 'For 7 of 25 orders the requisitioning officer also signed the goods received note.',
        action: 'Management response (12 Nov 2026): stores clerk to receive and sign for all deliveries; requisitioners may not sign GRNs.', owner: 'Stores Supervisor',
        due: '2026-12-31', created: '2026-10-19 11:10' },
    ] },
  { ref: 'GOV-IA-2026-05', title: 'Bank reconciliations and cashbook - USD and ZWG accounts', area: 'Treasury',
    phase: 'follow_up', status: 'completed', start: '2026-08-03', end: '2026-08-21', created: '2026-07-27 08:00', completed: '2026-09-04 16:30',
    notes: 'Review of June and July 2026 reconciliations for the CBZ USD and ZWG accounts. Report issued 4 September 2026.',
    findings: [
      { risk: 'medium', title: 'July bank reconciliations signed three weeks late',
        detail: 'The July USD and ZWG reconciliations were reviewed on 28 August 2026; the policy requires review by the 10th of the following month.',
        action: 'Reconciliations prepared by the 7th and reviewed by the 10th of each month.', owner: 'Accountant',
        due: '2026-09-15', created: '2026-08-21 12:00', close: { at: '2026-09-28 11:00', note: 'August reconciliations reviewed on 9 September 2026. Closed after the due date.' } },
      { risk: 'low', title: 'Stale cheques not written back',
        detail: 'Eleven cheques older than six months (USD 2,140) remained as reconciling items.',
        action: 'Write back stale cheques after six months with Treasurer approval.', owner: 'Accountant',
        due: '2026-10-15', created: '2026-08-21 12:10', close: { at: '2026-10-08 10:00', note: 'Stale cheques written back by journal on 2 October 2026.' } },
    ] },
  { ref: 'GOV-IA-2026-06', title: 'Fixed assets verification - plant, vehicles and equipment', area: 'Fixed assets',
    phase: 'planning', status: 'not_started', start: '2026-12-01', end: '2026-12-18', created: '2026-11-11 09:00',
    notes: 'Physical verification of graders, tipper trucks and motor cycles at the Vungu depot and road camps. Terms of reference agreed with the Accountant.',
    findings: [] },
]

const nameOf = (f) => f.split('/').pop()

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const db = new Client({ connectionString: DATABASE_URL })
  await db.connect()
  try {
    const { rows: yr } = await db.query(
      `SELECT id, label FROM finance.financial_year
        WHERE status = 'open' AND start_date <= DATE '2026-11-17' AND end_date >= DATE '2026-11-17'
        ORDER BY start_date LIMIT 1`)
    if (!yr[0]) throw new Error('No open financial year covering 2026-11-17. Run seed-finance-director-demo.js first.')
    const year = yr[0]
    const users = Object.fromEntries((await db.query(
      `SELECT split_part(split_part(email, '@', 1), '.', 2) AS k, id FROM public.users WHERE email LIKE 'demo.%@vungu.test'`)).rows.map((r) => [r.k, r.id]))

    if (args.has('--clean')) return await clean(db, year, users)
    if (!args.has('--report')) {
      await seedAccess(db, users)
      await seedAudit(db, year)
      const pubs = await seedPublications(db, year)
      await seedDocuments(db, year, pubs)
    }
    await report(db, year)
  } finally {
    await db.end()
  }
}

// Backdate with triggers off so updated_at keeps the date we give it.
async function backdate(db, sql, params) {
  await db.query('BEGIN')
  try {
    await unguardFinanceTriggers(db)
    await db.query(sql, params)
    await reguardFinanceTriggers(db)
    await db.query('COMMIT')
  } catch (err) { await db.query('ROLLBACK'); throw err }
}

// ── Access ───────────────────────────────────────────────────────────────────────────────────────
async function seedAccess(db, users) {
  const { rows: eng } = await db.query("SELECT id FROM finance.department WHERE code = 'DD-ENG' AND deleted_at IS NULL")
  const head = (await call('admin', 'GET', `/finance/users/${users['dept-head']}/access`)).data
  if (eng[0] && !(head.department_scope || []).some((d) => d.id === eng[0].id)) {
    await call('admin', 'PUT', `/finance/users/${users['dept-head']}/access`, {
      department_ids: [...(head.department_scope || []).map((d) => d.id), eng[0].id],
      reason: 'Departmental head of Engineering and Works: confined to the Engineering votes (GOV demo setup).',
    })
    console.log('  access: demo.dept-head scoped to DD-ENG')
  }
  const rev = (await call('admin', 'GET', `/finance/users/${users.revenue}/access`)).data
  if (!(rev.overrides || []).some((o) => o.permission_code === 'finance.cash.session.operate')) {
    await call('admin', 'PUT', `/finance/users/${users.revenue}/access`, {
      overrides: [
        ...(rev.overrides || []).map((o) => ({ permission_code: o.permission_code, effect: o.effect, expires_at: o.expires_at, reason: o.reason })),
        { permission_code: 'finance.cash.session.operate', effect: 'grant', expires_at: '2026-12-31T23:59:59+02:00',
          reason: 'Relief cashier at the Lower Gweru sub-office while the substantive cashier is on annual leave (memo FIN/HR/2026/112).' },
      ],
      reason: 'Temporary till access for leave cover, approved by the Treasurer (GOV demo setup).',
    })
    console.log('  access: demo.revenue granted finance.cash.session.operate until 2026-12-31')
  }
}

// ── Internal audit ───────────────────────────────────────────────────────────────────────────────
async function seedAudit(db, year) {
  const { rows: auditorRow } = await db.query("SELECT id FROM public.users WHERE email = 'demo.auditor@vungu.test'")
  for (const e of ENGAGEMENTS) {
    let { rows: [row] } = await db.query('SELECT id, status FROM finance.audit_engagement WHERE notes LIKE $1', [`Ref ${e.ref}.%`])
    if (!row) {
      const created = (await call('auditor', 'POST', '/finance/internal-audit/engagements', {
        title: e.title, area: e.area, financial_year_id: year.id, phase: 'planning', status: 'not_started',
        planned_start: e.start, planned_end: e.end, lead_user_id: auditorRow[0].id, notes: `Ref ${e.ref}. ${e.notes}`,
      })).data
      row = { id: created.id, status: 'not_started' }
      console.log(`  audit: created ${e.ref}`)
    }
    for (const [i, f] of e.findings.entries()) {
      const ref = `Ref ${e.ref}/F${i + 1}.`
      let { rows: [fr] } = await db.query('SELECT id, status FROM finance.audit_finding WHERE engagement_id = $1 AND detail LIKE $2', [row.id, `${ref}%`])
      if (!fr) {
        const c = (await call('auditor', 'POST', '/finance/internal-audit/findings', {
          engagement_id: row.id, title: f.title, detail: `${ref} ${f.detail}`, risk: f.risk,
          action: f.action, action_owner: f.owner, due_date: f.due,
        })).data
        fr = { id: c.id, status: 'open' }
        await backdate(db, 'UPDATE finance.audit_finding SET created_at = $2, updated_at = $2 WHERE id = $1', [fr.id, f.created])
      }
      if (f.close && fr.status !== 'closed') {
        await call('auditor', 'PATCH', `/finance/internal-audit/findings/${fr.id}`, { close: true, closure_note: f.close.note })
        await backdate(db, 'UPDATE finance.audit_finding SET closed_at = $2, updated_at = $2 WHERE id = $1', [fr.id, f.close.at])
      }
    }
    if (row.status !== e.status || e.phase !== 'planning') {
      const { rows: [cur] } = await db.query('SELECT phase, status FROM finance.audit_engagement WHERE id = $1', [row.id])
      if (cur.phase !== e.phase || cur.status !== e.status) {
        await call('auditor', 'PATCH', `/finance/internal-audit/engagements/${row.id}`, { phase: e.phase, status: e.status })
      }
    }
    const lastTouch = e.completed || [e.created, ...e.findings.map((f) => f.close?.at || f.created)].sort().pop()
    await backdate(db,
      `UPDATE finance.audit_engagement SET created_at = $2, updated_at = $3,
              completed_at = CASE WHEN status = 'completed' THEN $4::timestamptz END WHERE id = $1`,
      [row.id, e.created, lastTouch, e.completed || null])
  }
}

// ── Publications ─────────────────────────────────────────────────────────────────────────────────
async function seedPublications(db, year) {
  const out = {}
  for (const p of PUBLICATIONS) {
    let { rows: [row] } = await db.query(
      "SELECT id, state FROM finance.publication WHERE financial_year_id = $1 AND scope->>'seed' = $2 AND scope->>'key' = $3",
      [year.id, SEED, p.key])
    if (!row) {
      const c = (await call('publisher', 'POST', '/finance/publications', {
        financial_year_id: year.id, dataset: p.dataset, scope: { seed: SEED, key: p.key },
        reporting_period_label: p.label, data_as_at: p.asAt, notes: p.request,
      })).data
      row = { id: c.id, state: c.state }
      console.log(`  publication: requested ${p.key}`)
    }
    const id = row.id
    const step = async () => (await db.query('SELECT state FROM finance.publication WHERE id = $1', [id])).rows[0].state
    let state = await step()
    if (state === 'pending' && p.target === 'rejected') {
      await call('treasurer', 'POST', `/finance/publications/${id}/reject`, { note: p.rejectNote })
      state = await step()
    }
    if (state === 'pending' && ['approved', 'published', 'withdrawn'].includes(p.target)) {
      await call('treasurer', 'POST', `/finance/publications/${id}/approve`, { note: p.approveNote })
      state = await step()
    }
    if (state === 'approved' && ['published', 'withdrawn'].includes(p.target)) {
      await call('publisher', 'POST', `/finance/publications/${id}/publish`)
      state = await step()
    }
    if (state === 'published' && p.target === 'withdrawn') {
      await call('publisher', 'POST', `/finance/publications/${id}/withdraw`, { reason: p.withdrawReason })
      state = await step()
    }
    if (p.dataset === 'budget' && ['approved', 'published'].includes(state)) {
      const r = (await call('publisher', 'POST', `/finance/publications/${id}/mark-budget-lines`, {})).data
      if (r.marked) console.log(`  budget: marked ${r.marked} approved line(s) published`)
    }
    if (state !== p.target) console.warn(`  ! ${p.key} is ${state}, wanted ${p.target}`)
    await backdate(db,
      `UPDATE finance.publication
          SET created_at = $2::timestamptz,
              reviewed_at = CASE WHEN reviewed_at IS NOT NULL THEN COALESCE($3::timestamptz, $4::timestamptz) END,
              approved_at = CASE WHEN approved_at IS NOT NULL THEN $3::timestamptz END,
              published_at = CASE WHEN published_at IS NOT NULL THEN $5::timestamptz END,
              withdrawn_at = CASE WHEN withdrawn_at IS NOT NULL THEN $6::timestamptz END,
              updated_at = GREATEST($2::timestamptz, $3::timestamptz, $4::timestamptz, $5::timestamptz, $6::timestamptz)
        WHERE id = $1`,
      [id, p.created, p.approved || null, p.reviewed || null, p.published || null, p.withdrawn || null])
    out[p.key] = id
  }
  return out
}

// ── Documents ────────────────────────────────────────────────────────────────────────────────────
async function seedDocuments(db, year, pubs) {
  const totals = (await db.query(
    `SELECT l.currency, a.kind, sum(l.original_amount) AS amount, count(*)::int AS n
       FROM finance.budget_line l JOIN finance.account a ON a.id = l.account_id
      WHERE l.financial_year_id = $1 AND l.deleted_at IS NULL AND l.status IN ('approved','published')
      GROUP BY 1, 2 ORDER BY 1, 2`, [year.id])).rows
  const q1 = (await db.query(
    `SELECT t.currency, a.kind, sum(t.amount) AS amount, count(*)::int AS n
       FROM finance.transaction t JOIN finance.account a ON a.id = t.account_id
      WHERE t.financial_year_id = $1 AND t.deleted_at IS NULL AND t.txn_date BETWEEN '2026-07-01' AND '2026-09-30'
      GROUP BY 1, 2 ORDER BY 1, 2`, [year.id])).rows
  const budgetLines = totals.map((t) => `${t.currency}  ${t.kind.padEnd(12)}  ${money(t.amount).padStart(18)}   (${t.n} votes)`)
  const q1Lines = totals.map((t) => {
    const a = q1.find((x) => x.currency === t.currency && x.kind === t.kind)
    const pct = a && Number(t.amount) ? ((Number(a.amount) / Number(t.amount)) * 100).toFixed(1) : '0.0'
    return `${t.currency}  ${t.kind.padEnd(12)}  budget ${money(t.amount).padStart(16)}   Q1 actual ${money(a?.amount).padStart(15)}   (${pct}%)`
  })
  const { rows: [line] } = await db.query(
    `SELECT l.id, l.code, l.description FROM finance.budget_line l JOIN finance.department d ON d.id = l.department_id
      WHERE l.financial_year_id = $1 AND d.code = 'DD-ENG' AND l.deleted_at IS NULL ORDER BY l.code LIMIT 1`, [year.id])
  const { rows: [txn] } = await db.query(
    `SELECT t.id, t.reference, t.amount, t.currency, t.txn_date::text AS d FROM finance.transaction t JOIN finance.account a ON a.id = t.account_id
      WHERE t.financial_year_id = $1 AND a.kind = 'expenditure' AND t.deleted_at IS NULL AND t.txn_date <= '2026-09-30'
      ORDER BY (t.description ILIKE '%grad%' OR t.description ILIKE '%gravel%') DESC, t.txn_date, t.reference LIMIT 1`, [year.id])
  const { rows: [project] } = await db.query(
    "SELECT id, reference, name FROM finance.project WHERE deleted_at IS NULL AND status IN ('in_progress','approved') ORDER BY reference LIMIT 1")

  const DOCS = [
    { file: 'Vungu RDC Approved Budget Estimates 2026-27.pdf', type: 'Approved budget', kind: 'financial_year', subject: year.id,
      visibility: 'public', at: '2026-07-15 10:15', by: 'finance-admin',
      reason: 'Approved estimates adopted by Council on 26 June 2026 (resolution 14/2026); statutory publication.',
      title: 'Approved Budget Estimates 2026/27',
      lines: ['Financial year 1 July 2026 to 30 June 2027. Adopted by full Council, resolution 14/2026.', '',
        '## Summary of approved estimates (per currency, never combined - Council decision D4)', ...budgetLines, '',
        'Detailed estimates by department and vote are available on the public finance portal.',
        'Prepared by the Treasurer. Approved by the Finance and General Purposes Committee.'] },
    { file: 'Council Resolution 14-2026 - Adoption of the 2026-27 Budget.pdf', type: 'Council resolution', kind: 'financial_year', subject: year.id,
      visibility: 'public', at: '2026-07-15 10:20', by: 'finance-admin', reason: 'Resolution adopting the 2026/27 budget, published with the estimates.',
      title: 'Council Resolution 14/2026',
      lines: ['Full Council meeting held at the Council Chambers, Vungu, on 26 June 2026.', '',
        'RESOLVED: that the estimates of revenue and expenditure for the year ending 30 June 2027,',
        'as tabled by the Finance and General Purposes Committee, be adopted;',
        'that the tariffs set out in Schedule A apply from 1 July 2026; and',
        'that the Chief Executive Officer publish the approved estimates.', '', 'Moved: Cllr T. Moyo (Ward 7). Seconded: Cllr R. Sibanda (Ward 2). Carried.'] },
    { file: 'Q1 2026-27 Budget Performance Report (July-September 2026).pdf', type: 'Quarterly budget performance report', kind: 'publication', subject: pubs['reports-v1'],
      visibility: 'public', at: '2026-10-21 09:10', by: 'finance-admin', reason: 'Q1 report approved by the F&GP Committee (minute F&GP/10/2026/4).',
      title: 'Q1 2026/27 Budget Performance Report',
      lines: ['Period: 1 July to 30 September 2026. Data as at 30 September 2026.', '',
        '## Budget against actual, Q1 (per currency)', ...q1Lines, '',
        '## Commentary', 'Rates collection improved after the July billing run; ZWG licence income is on budget.',
        'Road grading in Wards 1 and 4 is ahead of the quarterly profile following early fuel deliveries.',
        'Capital spending on culverts in Ward 2 is behind plan pending delivery of pipes from Gweru.'] },
    { file: 'Q1 2026-27 Statement of Revenue and Expenditure.pdf', type: 'Financial statement', kind: 'publication', subject: pubs['reports-v1'],
      visibility: 'public', at: '2026-10-21 09:12', by: 'finance-admin', reason: 'Statement accompanying the published Q1 performance report.',
      title: 'Statement of Revenue and Expenditure - Q1 2026/27',
      lines: ['For the three months ended 30 September 2026. Unaudited.', '',
        ...q1.map((a) => `${a.currency}  ${a.kind.padEnd(12)}  ${money(a.amount).padStart(18)}   (${a.n} postings)`), '',
        'USD and ZWG amounts are reported separately and are not converted or added together.'] },
    { file: 'Q2 2026-27 Interim Budget Performance Report (October 2026) - DRAFT.pdf', type: 'Quarterly budget performance report', kind: 'publication', subject: pubs['reports-v2'],
      visibility: 'private', at: '2026-11-16 11:35', by: 'finance-admin',
      title: 'DRAFT - Q2 2026/27 Interim Budget Performance Report',
      lines: ['Period: 1 October to 31 October 2026. Data as at 31 October 2026.', 'DRAFT for the November Finance Committee - not for publication.'] },
    { file: 'Expenditure release Q1 - withdrawal memo.pdf', type: 'Memo', kind: 'publication', subject: pubs['expenditure-v1'],
      visibility: 'internal', at: '2026-10-23 11:45', by: 'finance-admin',
      title: 'Memo: withdrawal of the Q1 expenditure release',
      lines: ['To: Chief Executive Officer. From: Treasurer. Date: 23 October 2026.', '',
        'The Q1 expenditure dataset released on 21 October included scheduled postings dated after',
        'the 30 September reporting date. It has been withdrawn from the portal and will be re-released',
        'once the period cut-off is applied. No financial record was changed.'] },
    line && { file: `Costing schedule - ${line.code} ${line.description}.pdf`, type: 'Costing schedule', kind: 'budget_line', subject: line.id,
      visibility: 'internal', at: '2026-07-08 14:00', by: 'budget-officer',
      title: `Costing schedule - ${line.code}`,
      lines: [line.description, '', 'Grader hire: 42 days at USD 1,150', 'Fuel: 18,000 litres diesel', 'Gravel: 3,600 m3 from the Gweru borrow pit', 'Labour: 12 general hands for 4 months'] },
    txn && { file: `Supplier invoice - Gweru Earthmoving (Pvt) Ltd - ${txn.reference}.pdf`, type: 'Supplier invoice', kind: 'transaction', subject: txn.id,
      visibility: 'private', at: `${txn.d} 12:00`, by: 'finance-admin',
      title: 'TAX INVOICE - Gweru Earthmoving (Pvt) Ltd',
      lines: ['14 Lobengula Avenue, Gweru. BP 200314712.', `Invoice to: Vungu Rural District Council. Ref ${txn.reference}.`, '',
        `Plant hire and grading services   ${txn.currency} ${money(txn.amount)}`] },
    project && { file: `Progress report - ${project.reference} ${project.name}.pdf`, type: 'Project progress report', kind: 'project', subject: project.id,
      visibility: 'internal', at: '2026-11-03 09:00', by: 'finance-admin',
      title: `Project progress report - ${project.reference}`,
      lines: [project.name, 'Progress to 31 October 2026, prepared by the District Engineer.'] },
  ].filter(Boolean)

  for (const d of DOCS) {
    if (!d.subject) continue
    // The supporting documents pick their subject from data other seeds keep adding to, so one of
    // each kind is enough: if this script already attached one anywhere, leave it.
    if (['budget_line', 'transaction', 'project'].includes(d.kind)) {
      const prefix = d.file.split(' - ')[0] + ' - '
      const { rows: any } = await db.query(
        `SELECT 1 FROM finance.document WHERE subject_kind = $1 AND document_type = $2 AND starts_with(filename, $3) AND deleted_at IS NULL`,
        [d.kind, d.type, prefix])
      if (any.length) continue
    }
    let { rows: [row] } = await db.query(
      'SELECT id, visibility FROM finance.document WHERE filename = $1 AND subject_kind = $2 AND subject_id = $3 AND deleted_at IS NULL',
      [d.file, d.kind, String(d.subject)])
    if (!row) {
      const form = new FormData()
      form.append('subject_kind', d.kind)
      form.append('subject_id', String(d.subject))
      form.append('document_type', d.type)
      form.append('file', new Blob([makePdf(d.title, d.lines)], { type: 'application/pdf' }), d.file)
      const r = await call(d.by, 'POST', '/finance/documents', undefined, { form })
      row = { id: r.data.document.id, visibility: 'private' }
      console.log(`  document: uploaded ${d.file}`)
    }
    if (row.visibility !== d.visibility) {
      await call('publisher', 'PATCH', `/finance/documents/${row.id}/visibility`,
        { visibility: d.visibility, reason: d.reason || 'Classified for internal use by the publisher.' })
    }
    await backdate(db, 'UPDATE finance.document SET uploaded_at = $2 WHERE id = $1', [row.id, d.at])
  }
}

// ── Clean ────────────────────────────────────────────────────────────────────────────────────────
async function clean(db, year, users) {
  const { rows: pubs } = await db.query("SELECT id FROM finance.publication WHERE scope->>'seed' = $1", [SEED])
  const ids = pubs.map((p) => p.id)
  const { rows: docs } = await db.query(
    `SELECT id, object_key FROM finance.document
      WHERE (subject_kind = 'publication' AND subject_id = ANY($1::text[]))
         OR filename IN ('Vungu RDC Approved Budget Estimates 2026-27.pdf', 'Council Resolution 14-2026 - Adoption of the 2026-27 Budget.pdf')
         OR filename LIKE 'Costing schedule - %' OR filename LIKE 'Supplier invoice - Gweru Earthmoving (Pvt) Ltd - %'
         OR filename LIKE 'Progress report - %'`, [ids])
  for (const d of docs) { try { fs.unlinkSync(d.object_key) } catch { /* file already gone */ } }
  await db.query('DELETE FROM finance.document WHERE id = ANY($1::uuid[])', [docs.map((d) => d.id)])
  await db.query('DELETE FROM finance.publication WHERE id = ANY($1::uuid[])', [ids])
  // Unmark budget lines only if no budget publication is still live for the year.
  const { rows: live } = await db.query("SELECT 1 FROM finance.publication WHERE financial_year_id = $1 AND dataset = 'budget' AND state = 'published'", [year.id])
  let unmarked = 0
  if (!live.length) {
    unmarked = (await db.query("UPDATE finance.budget_line SET status = 'approved' WHERE financial_year_id = $1 AND status = 'published'", [year.id])).rowCount
  }
  const { rows: engs } = await db.query("SELECT id FROM finance.audit_engagement WHERE notes LIKE 'Ref GOV-IA-%'")
  const e = engs.map((x) => x.id)
  const f = (await db.query('DELETE FROM finance.audit_finding WHERE engagement_id = ANY($1::uuid[])', [e])).rowCount
  await db.query('DELETE FROM finance.audit_engagement WHERE id = ANY($1::uuid[])', [e])
  // Access: lift the two changes through the API, leaving anything else in place.
  // demo.dept-head's DD-ENG scope is shared with the budget seed, so it is left in place.
  const rev = (await call('admin', 'GET', `/finance/users/${users.revenue}/access`)).data
  if (rev.overrides.some((o) => o.permission_code === 'finance.cash.session.operate')) {
    await call('admin', 'PUT', `/finance/users/${users.revenue}/access`, {
      overrides: rev.overrides.filter((o) => o.permission_code !== 'finance.cash.session.operate')
        .map((o) => ({ permission_code: o.permission_code, effect: o.effect, expires_at: o.expires_at, reason: o.reason })),
      reason: 'GOV demo clean-up.' })
  }
  console.log(`clean: ${ids.length} publications, ${docs.length} documents, ${e.length} engagements, ${f} findings removed; ${unmarked} budget lines back to approved`)
}

// ── Report ───────────────────────────────────────────────────────────────────────────────────────
async function report(db, year) {
  const q = async (sql, p = []) => (await db.query(sql, p)).rows
  console.log(`\nGovernance demo — ${year.label}`)
  console.table(await q(
    `SELECT dataset, version, state, reporting_period_label AS period, published_at::date AS published,
            (scope->>'seed') AS seed FROM finance.publication WHERE financial_year_id = $1 ORDER BY dataset, version`, [year.id]))
  console.table(await q('SELECT status, count(*)::int FROM finance.budget_line WHERE financial_year_id = $1 AND deleted_at IS NULL GROUP BY 1', [year.id]))
  console.table(await q('SELECT visibility, subject_kind, count(*)::int FROM finance.document WHERE deleted_at IS NULL GROUP BY 1, 2 ORDER BY 1, 2'))
  console.table(await q(
    `SELECT left(notes, 19) AS ref, phase, status, (SELECT count(*)::int FROM finance.audit_finding f WHERE f.engagement_id = e.id) AS findings
       FROM finance.audit_engagement e ORDER BY notes`))
  console.table(await q(
    `SELECT risk, status, count(*)::int AS n, count(*) FILTER (WHERE status = 'open' AND due_date < CURRENT_DATE)::int AS overdue,
            count(*) FILTER (WHERE status = 'open' AND action LIKE 'Management response%')::int AS mgmt_response
       FROM finance.audit_finding GROUP BY 1, 2 ORDER BY 1, 2`))
  console.table(await q(
    `SELECT u.email, 'scope ' || d.code AS access FROM finance.user_scope s JOIN public.users u ON u.id = s.user_id JOIN finance.department d ON d.id = s.department_id
     UNION ALL
     SELECT u.email, o.effect || ' ' || o.permission_code || COALESCE(' until ' || o.expires_at::date, '') FROM finance.user_permission_override o JOIN public.users u ON u.id = o.user_id`))
}

main().catch((err) => { console.error(err); process.exit(1) })
