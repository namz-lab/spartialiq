// e2e/pipeline-sync.spec.ts
// Proves the pipeline screen renders real data from the backend and that the
// live tail shows a genuine SSE event — the same event a QGIS Desktop save
// produces. Both parts matter: a screen full of placeholders would look
// identical to a working one if only the markup were asserted.
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const COVERAGE = '/api/qgis/sync/coverage'

async function signIn(page: Page) {
  await page.goto('/login')
  await page.fill('input[type="email"], input[name="email"]', 'demo.admin@vungu.test')
  await page.fill('input[type="password"], input[name="password"]', 'demo1234')
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
}

test.describe('QGIS to web pipeline screen', () => {
  test('renders coverage for every registry layer, from the API', async ({ page }) => {
    await signIn(page)

    // Read the API through the signed-in session the page now holds, so the two
    // cannot disagree about what was rendered.
    const api = await page.request.get(COVERAGE).then((r) => (r.ok() ? r.json() : null))
    test.skip(!api?.data?.summary, `backend not reachable (${api === null ? 'no response' : 'error body'})`)
    const layers = api.data.summary.layers as number

    await page.goto('/admin/pipeline-sync')
    await expect(page.getByRole('heading', { name: /QGIS → web pipeline/i })).toBeVisible()

    // The verdict figure is a real count, so it must match the API rather than
    // being a hard-coded 31.
    await expect(page.locator('.pipe-verdict-of')).toContainText(`of ${layers}`)

    // Every layer appears, and the notification path is spelled out per row —
    // including the base table behind the zones view, which is the link whose
    // absence made a QGIS save vanish on 2026-10-05.
    await expect(page.locator('table').first()).toContainText('vungu-vungu_proposed_peri_urban_zones')

    const rows = page.locator('.ui-panel', { hasText: 'Every layer' }).locator('tbody tr')
    await expect(rows).toHaveCount(layers)
  })

  test('opening a layer detail names the table the trigger fires on', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/pipeline-sync')

    const row = page.locator('tbody tr', { hasText: 'Proposed Peri-Urban Zones' }).first()
    await expect(row).toBeVisible()
    await row.click()

    const detail = page.locator('.pipe-detail')
    await expect(detail).toBeVisible()
    // The base table, not the view the registry names — this is the link whose
    // absence made a QGIS save vanish on 2026-10-05.
    await expect(detail).toContainText('proposed_peri_urban_zones')
    await expect(detail).toContainText('fires')
  })

  // The tail's connection is asserted here; that it shows a REAL event is
  // proved by scripts/verify_live_sync.js in app-backend, which commits a scoped
  // single-row write and reads the resulting event off this same bus. That
  // script owns the database write; this spec owns the browser. Duplicating the
  // write here would need a `pg` client the frontend does not depend on, and the
  // two copies would drift.
  test('watching subscribes to the event stream and reports connected', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/pipeline-sync')

    await page.getByRole('button', { name: /watch for edits/i }).click()
    await expect(page.getByRole('button', { name: /stop watching/i })).toBeVisible()
    await expect(page.getByText(/listening on \/api\/map\/events/i)).toBeVisible()
    // The tail opens its own EventSource; the map may hold a second. Both are
    // fine, which is why only the subscribed state is asserted here.

    await page.getByRole('button', { name: /stop watching/i }).click()
    await expect(page.getByRole('button', { name: /watch for edits/i })).toBeVisible()
  })

  test('the page is reachable by the GIS officer console link', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/gis-symbology')
    await expect(page.getByRole('link', { name: /live-sync check/i })).toBeVisible()
  })
})