/**
 * Visit every staff console section and record API 500s and crash screens.
 * Results → ../../DEAD_END_CRAWL.json
 */
import { test } from '@playwright/test'
import type { Page, Response } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'DEAD_END_CRAWL.json')

const planner = [
  'dashboard', 'workflow', 'register', 'property', 'referrals',
  'participation', 'inspections', 'committee', 'appeals',
  'enforcement', 'plans', 'forward', 'layouts', 'matrix', 'reports', 'reference',
].map((s) => `/planner?pane=console&section=${s}`)

const eo = [
  'dashboard', 'register', 'intake', 'diligence', 'notification',
  'circulation', 'committee', 'decision', 'permits', 'enforcement',
  'appeals', 'plans', 'reports', 'matrix', 'reference', 'settings',
].map((s) => `/eo-planner-portal?section=${s}`)

const clerk = [
  'dashboard', 'search', 'receipt', 'verification', 'public_inspection', 'matrix',
  'deadlines', 'acknowledgements', 'notices', 'refusals', 'register',
  'correspondence', 'fees', 'movements', 'dispatch', 'enforcement', 'appeals', 'preferences',
].map((s) => `/planning-clerk-portal?section=${s}`)

const inspector = [
  'dashboard', 'bookings', 'stages', 'preconstruction', 'casefile',
  'plans', 'enforcement', 'complaints', 'certificates',
  'referrals', 'reports', 'reference', 'settings',
].map((s) => `/inspector-workspace?pane=console&section=${s}`)

const eho = [
  'dashboard', 'inspections', 'surveillance', 'enforcement',
  'programmes', 'licensing', 'appraisal', 'certificates',
  'reports', 'reference', 'settings',
].map((s) => `/env-officer-workspace?section=${s}`)

const citizen = [
  'dashboard', 'services', 'new', 'applications', 'map', 'documents', 'notices',
  'payments', 'inspections', 'certificates', 'rates_clearance', 'appeals',
  'complaints', 'service_desk', 'profile', 'reference',
].map((s) => `/citizen?section=${s}`)

const ROLES: { email: string; urls: string[] }[] = [
  { email: 'demo.planner@vungu.test', urls: planner },
  { email: 'demo.eo@vungu.test', urls: eo },
  { email: 'demo.clerk@vungu.test', urls: clerk },
  { email: 'demo.inspector@vungu.test', urls: inspector },
  { email: 'demo.envoffice@vungu.test', urls: eho },
  { email: 'demo.gis@vungu.test', urls: ['/gis-officer-portal', '/gis', '/gis/map', '/gis/edits', '/gis/integration', '/admin/gis-symbology'] },
  { email: 'demo.surveyor@vungu.test', urls: ['/surveyor', '/surveyor/jobs'] },
  { email: 'demo.admin@vungu.test', urls: ['/admin/users', '/admin/gis-symbology', '/statutory-registers', '/custodian', '/title-notices'] },
  { email: 'demo.viewer@vungu.test', urls: [...citizen, '/payment/new', '/lookup', '/services', '/about'] },
]

type Fail = { role: string; page: string; kind: string; detail: string }
const fails: Fail[] = []

async function signIn(page: Page, email: string) {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.keyboard.press('Escape').catch(() => {})
  await page.fill('input[type="email"], input[name="email"]', email)
  await page.fill('input[type="password"], input[name="password"]', 'demo1234')
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
}

test('section crawl records dead ends', async ({ page }) => {
  test.setTimeout(900_000)
  const pending: { role: string; page: string; api: string; status: number }[] = []
  let role = ''
  page.on('response', (res: Response) => {
    const api = res.url()
    if (!api.includes('/api/')) return
    if (res.status() < 500) return
    if (api.includes('/api/analytics')) return
    pending.push({ role, page: page.url(), api: api.replace('http://localhost:3000', ''), status: res.status() })
  })

  for (const r of ROLES) {
    role = r.email
    try {
      await signIn(page, r.email)
    } catch (e) {
      fails.push({ role: r.email, page: '/login', kind: 'login', detail: (e as Error).message.split('\n')[0] })
      continue
    }
    for (const url of r.urls) {
      pending.length = 0
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await page.waitForTimeout(900)
        const body = await page.locator('body').innerText().catch(() => '')
        if (/Something went wrong|Application error|Cannot GET|Internal Server Error|Payment not found/i.test(body)) {
          fails.push({ role: r.email, page: url, kind: 'screen', detail: body.replace(/\s+/g, ' ').slice(0, 180) })
        }
        const landed = new URL(page.url())
        if (landed.pathname === '/login') {
          fails.push({ role: r.email, page: url, kind: 'auth', detail: 'bounced to login' })
        }
      } catch (e) {
        fails.push({ role: r.email, page: url, kind: 'nav', detail: (e as Error).message.split('\n')[0] })
      }
      for (const p of pending) {
        fails.push({ role: r.email, page: url, kind: `api ${p.status}`, detail: p.api })
      }
    }
  }

  const unique = new Map<string, Fail>()
  for (const f of fails) unique.set(`${f.kind}|${f.detail}|${f.page}`, f)
  const list = [...unique.values()]
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), count: list.length, fails: list }, null, 2))
  console.log(`Dead ends: ${list.length} → ${OUT}`)
  for (const f of list.slice(0, 40)) console.log(`FAIL ${f.role} ${f.page} ${f.kind} ${f.detail}`)
})
