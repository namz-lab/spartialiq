/**
 * Walk every finance workspace as its own demo role and report what a viewer would see break.
 *
 *   node scripts/finance-demo-crawl.mjs [baseUrl] [outDir]      (default http://127.0.0.1:5180)
 *   ONLY=accountant,cashier node scripts/finance-demo-crawl.mjs
 *
 * For each workspace it signs in, opens the workspace home, collects every sidebar link under the
 * workspace's path, and visits each one. Per page it records API responses >= 400, uncaught page
 * errors, console errors, visible "error"/"failed" banners and whether the page looks empty, and
 * saves a full-page screenshot. It only reads: it clicks no buttons.
 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:5180'
const OUT = process.argv[3] || '/tmp/lamis-finance-crawl'
const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
fs.mkdirSync(OUT, { recursive: true })

const WORKSPACES = [
  ['manager', 'demo.finance-admin'], ['officer', 'demo.finance-officer'], ['accountant', 'demo.accountant'],
  ['accounting', 'demo.ceo'], ['budget', 'demo.budget-officer'], ['department', 'demo.dept-head'],
  ['committee', 'demo.treasurer'], ['cashier', 'demo.cashier'], ['revenue', 'demo.revenue'],
  ['publisher', 'demo.publisher'], ['audit', 'demo.auditor'], ['administration', 'demo.admin'],
]
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null

const browser = await chromium.launch()
const report = []
for (const [ws, user] of WORKSPACES) {
  if (only && !only.has(ws)) continue
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.fill('input[type="email"]', `${user}@vungu.test`)
    await page.fill('input[type="password"]', PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 })
  } catch (e) { report.push({ ws, page: '(login)', problems: [`login ${e.message.split('\n')[0]}`] }); await ctx.close(); continue }
  let current = null
  page.on('response', (r) => {
    if (current && r.url().includes('/api/') && r.status() >= 400) current.problems.push(`API ${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`)
  })
  page.on('pageerror', (e) => current && current.problems.push(`pageerror ${String(e.message).slice(0, 200)}`))
  page.on('console', (m) => { if (current && m.type() === 'error') current.problems.push(`console ${m.text().slice(0, 200)}`) })

  const visit = async (url) => {
    current = { ws, page: url, problems: [] }
    try {
      await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    } catch (e) { current.problems.push(`navigation ${e.message.split('\n')[0]}`) }
    await page.waitForTimeout(1500)
    const landed = new URL(page.url()).pathname
    if (!landed.startsWith(`/finance/${ws}`)) current.problems.push(`redirected to ${landed}`)
    const text = await page.locator('main').first().innerText().catch(() => page.locator('body').innerText())
    current.chars = text.length
    const banners = text.split('\n').filter((l) => /(could not|failed|error|went wrong|not available|forbidden|unauthori[sz]ed)/i.test(l)).slice(0, 4)
    if (banners.length) current.problems.push(...banners.map((b) => `text: ${b.slice(0, 160)}`))
    const empties = text.split('\n').filter((l) => /^(no |nothing |none |empty)/i.test(l.trim())).slice(0, 6)
    current.empty = empties
    const shot = path.join(OUT, `${ws}${url.replace(`/finance/${ws}`, '').replace(/[^a-z0-9]+/gi, '_') || '_home'}.png`)
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
    current.shot = shot
    report.push(current)
  }

  await visit(`/finance/${ws}`)
  const links = await page.$$eval(`a[href^="/finance/${ws}"]`, (as) => [...new Set(as.map((a) => a.getAttribute('href').split('?')[0].split('#')[0]))])
  for (const href of links.filter((h) => h !== `/finance/${ws}` && h !== `/finance/${ws}/`)) await visit(href)
  await ctx.close()
}
await browser.close()

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
let bad = 0
for (const r of report) {
  const flag = r.problems.length ? 'FAIL' : (r.empty?.length ? 'EMPTY?' : 'ok')
  if (r.problems.length) bad++
  console.log(`${flag.padEnd(6)} ${r.ws.padEnd(14)} ${r.page}${r.problems.length ? '\n         ' + [...new Set(r.problems)].join('\n         ') : ''}${!r.problems.length && r.empty?.length ? '  [' + r.empty.join(' | ').slice(0, 160) + ']' : ''}`)
}
console.log(`\n${report.length} pages, ${bad} with problems. Screenshots and report.json in ${OUT}`)
