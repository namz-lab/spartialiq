import { chromium } from '@playwright/test'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 980 } })
const log = (...a) => console.log('[shot]', ...a)

await page.goto('http://localhost:5174/login', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
await page.fill('input[type="email"]', 'demo.finance-officer@vungu.test')
await page.fill('input[type="password"]', 'demo1234')
await page.click('button[type="submit"]')
await page.waitForTimeout(3500)
log('url after login:', page.url())

// The finance map section
await page.goto('http://localhost:5174/finance?section=map')
await page.waitForTimeout(6000)
await page.screenshot({ path: '/tmp/vungu-visual/finance-map.png', fullPage: false })
log('map shot taken')

// The budget section with the ward filter (synced if a ward was selected)
await page.goto('http://localhost:5174/finance?section=budget')
await page.waitForTimeout(3500)
await page.screenshot({ path: '/tmp/vungu-visual/finance-budget.png', fullPage: false })
log('budget shot taken')

await browser.close()
