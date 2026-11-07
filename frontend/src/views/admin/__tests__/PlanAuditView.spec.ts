// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: 'p1' } }) }))

const api = vi.hoisted(() => ({ getPlan: vi.fn(), audit: vi.fn(), matrixGrid: vi.fn() }))
vi.mock('@/services/planWorkbench', async (orig) => {
  const actual = await (orig as any)()
  return { ...actual, wb: api }
})

import PlanAuditView from '@/views/admin/PlanAuditView.vue'

const column = (over: any = {}) => ({
  code: 'Cemetery', name: 'Cemetery', category: 'open_space', review_status: 'unreviewed', reviewed_by: null, reviewed_at: null,
  permitted: 1, special_consent: 1, prohibited: 1, ...over,
})
const detail = (planOver: any = {}, zones = [column(), column({ code: 'Light Industry', name: 'Light Industry', review_status: 'reviewed', reviewed_by: 'T. Dube' })]) => ({
  plan: { id: 'p1', title: 'Vungu local plan', status: 'unknown', is_template: false, version: 1, authority_name: 'Vungu RDC', ...planOver },
  next_statuses: [], events: [], zone_types: zones,
})
const P = { permission_code: 'P', control_type: 'permitted', conditions: null }
const SC = { permission_code: 'SC', control_type: 'special_consent', conditions: null }
const X = { permission_code: 'X', control_type: 'prohibited', conditions: null }
const grid = {
  zone_types: [{ code: 'Cemetery', label: 'Cemetery', order: 1 }, { code: 'Light Industry', label: 'Light Industry', order: 2 }],
  land_uses: [
    { code: 'A', description: 'Detached dwelling houses', category: 'residential', cells: [X, P] },
    { code: 'D', description: 'Shops', category: 'commercial', cells: [SC, null] },
  ],
}
const finding = (over: any = {}) => ({ severity: 'review', kind: 'special_consent_without_condition', zone_code: 'Cemetery', group_code: null, detail: '3 special-consent decisions state no condition', ...over })
const auditOf = (findings: any[]) => ({
  errors: findings.filter((f) => f.severity === 'error').length, warnings: findings.filter((f) => f.severity === 'warning').length,
  reviews: findings.filter((f) => f.severity === 'review').length, findings,
})

async function show(opts: { d?: any; a?: any; g?: any } = {}) {
  api.getPlan.mockResolvedValue(opts.d ?? detail())
  if (opts.a instanceof Error) api.audit.mockRejectedValue(opts.a); else api.audit.mockResolvedValue(opts.a ?? auditOf([]))
  if (opts.g instanceof Error) api.matrixGrid.mockRejectedValue(opts.g); else api.matrixGrid.mockResolvedValue(opts.g ?? grid)
  const w = mount(PlanAuditView, { global: { mocks: { $router: { push: vi.fn() } } } })
  await flushPromises()
  return w
}

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()) })

describe('PlanAuditView', () => {
  it('names the plan and its status, and calls a plan not in force a draft', async () => {
    const w = await show()
    expect(w.find('h1').text()).toBe('Vungu local plan')
    expect(w.text()).toContain('Version 1 · Vungu RDC')
    const banner = w.find('[data-testid="draft-banner"]').text()
    expect(banner).toContain('Draft rules, not council policy')
    expect(banner).toContain('legal status has not been confirmed')
  })

  it('has no draft banner once the plan is in force', async () => {
    const w = await show({ d: detail({ status: 'gazetted' }) })
    expect(w.find('[data-testid="draft-banner"]').exists()).toBe(false)
  })

  it('puts the findings in council words, worst first, naming the zone', async () => {
    const w = await show({ a: auditOf([
      finding(),
      finding({ severity: 'error', kind: 'residential_zone_without_dwellings', zone_code: 'Light Industry', detail: 'a residential zone that permits no dwelling outright' }),
      finding({ severity: 'warning', kind: 'default_fill', zone_code: 'Cemetery', detail: 'permits 29 of 32 uses outright' }),
    ]) })
    const kinds = w.findAll('.pa-group').map((g) => g.attributes('data-kind'))
    expect(kinds).toEqual(['residential_zone_without_dwellings', 'default_fill', 'special_consent_without_condition'])
    const first = w.find('[data-kind="residential_zone_without_dwellings"]').text()
    expect(first).toContain('A residential zone permits no dwelling')
    expect(first).toContain('Why it matters')
    expect(first).toContain('To decide')
    expect(first).toContain('Light Industry.')
    expect(w.find('[data-kind="special_consent_without_condition"]').text()).toContain('Cemetery.')
  })

  it('shows a finding kind it does not know in the server\'s own words', async () => {
    const w = await show({ a: auditOf([finding({ kind: 'brand_new_rule', zone_code: null, group_code: 'L1', detail: 'something the server noticed' })]) })
    const g = w.find('[data-kind="brand_new_rule"]').text()
    expect(g).toContain('brand new rule')
    expect(g).toContain('Use L1.')
    expect(g).toContain('something the server noticed')
    expect(g).not.toContain('Why it matters')
  })

  it('says plainly when there is nothing to settle', async () => {
    const w = await show()
    expect(w.find('[data-testid="nothing-to-settle"]').text()).toContain('Nothing to settle')
  })

  it('draws the matrix: a row per zone, P, SC, X and blank cells, and the review state', async () => {
    const w = await show({ a: auditOf([finding({ severity: 'error', kind: 'residential_zone_without_dwellings', zone_code: 'Cemetery', detail: 'x' })]) })
    const row = w.find('tr[data-zone="Cemetery"]')
    expect(row.findAll('td.cell').map((c) => c.text())).toEqual(['X', 'SC'])
    expect(w.find('tr[data-zone="Light Industry"]').findAll('td.cell').map((c) => c.text())).toEqual(['P', '·'])
    expect(w.find('tr[data-zone="Light Industry"] td.cell.blank').attributes('title')).toBe('Shops: not decided')
    expect(row.find('td.cell.X').attributes('title')).toBe('Detached dwelling houses: prohibited')
    expect(row.text()).toContain('Not reviewed')
    expect(w.find('tr[data-zone="Light Industry"]').text()).toContain('Reviewed')
    expect(w.find('tr[data-zone="Light Industry"]').text()).toContain('T. Dube')
    expect(row.find('.flag').text()).toBe('error')                       // the zone with an error is flagged
    expect(w.find('tr[data-zone="Light Industry"] .flag').exists()).toBe(false)
    expect(w.text()).toContain('Detached dwelling houses')               // the key to the class codes
  })

  it('summarises: counts of findings, columns reviewed and decisions made', async () => {
    const w = await show({ a: auditOf([finding(), finding({ severity: 'warning', kind: 'default_fill' })]) })
    const tiles = w.find('.pa-tiles').text()
    expect(tiles).toContain('1 of 2')            // zone columns reviewed
    expect(tiles).toContain('3')                 // decisions made (4 cells, 1 blank)
    expect(tiles).toContain('1 blank')
  })

  it('does not pass off a partial picture as the whole when the audit cannot be read', async () => {
    const w = await show({ a: new Error('down') })
    expect(w.find('[role="alert"]').text()).toContain('incomplete')
    expect(w.text()).toContain('The audit could not be read')
    expect(w.find('[data-testid="nothing-to-settle"]').exists()).toBe(false)
    expect(w.find('tr[data-zone="Cemetery"]').exists()).toBe(true)
  })

  it('says so when the matrix cannot be read, and still shows the findings', async () => {
    const w = await show({ g: new Error('down'), a: auditOf([finding()]) })
    expect(w.text()).toContain('The matrix could not be read')
    expect(w.find('[data-kind="special_consent_without_condition"]').exists()).toBe(true)
  })

  it('shows a plain message when the plan cannot be opened', async () => {
    api.getPlan.mockRejectedValue({ response: { status: 404 } })
    const w = mount(PlanAuditView, { global: { mocks: { $router: { push: vi.fn() } } } })
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('could not be opened')
    expect(w.find('.pa-tiles').exists()).toBe(false)
    expect(api.audit).not.toHaveBeenCalled()
  })

  it('prints on request', async () => {
    const print = vi.fn()
    window.print = print as unknown as typeof window.print   // happy-dom has no print
    const w = await show()
    await w.findAll('button').find((b) => b.text().includes('Print this page'))!.trigger('click')
    expect(print).toHaveBeenCalled()
  })

  it('changes nothing: it only reads', async () => {
    await show({ a: auditOf([finding()]) })
    expect(Object.keys(api).sort()).toEqual(['audit', 'getPlan', 'matrixGrid'])   // the view has no write calls to make
  })
})
