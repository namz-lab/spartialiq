// @vitest-environment happy-dom
//
// Internal Audit workspace:
//   1. SAMPLING IS REPRODUCIBLE: the same seed, population and size give the same positions.
//   2. EXCEPTION TESTS COMPARE PEOPLE AND TIMES, never money.
//   3. THE TRAIL SEARCH SENDS THE SERVER'S FILTERS from the address, and pages.
//   4. THE EXPORT IS OFFERED ONLY WITH finance.audit.export, and says it covers the dates only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h } from 'vue'

vi.mock('../api/auditApi', async (orig) => {
  const real = await orig<typeof import('../api/auditApi')>()
  return { ...real, auditApi: { trail: vi.fn(), exportTrail: vi.fn() } }
})

import { auditApi, type TrailEvent } from '../api/auditApi'
import AuditTrailPage from '../workspaces/audit/pages/AuditTrailPage.vue'
import { samplePositions, seededRandom } from '../workspaces/audit/sampling'
import {
  sameVoucherHands, sameCashUpHands, samePublicationHands, cashUpsWithVariance, refusalsByPerson, outsideHours,
} from '../workspaces/audit/exceptions'
import { useFinanceStore } from '../stores/finance'

const trail = (auditApi as unknown as Record<string, ReturnType<typeof vi.fn>>).trail
const ev = (over: Partial<TrailEvent> = {}): TrailEvent => ({
  id: 'e1', occurred_at: '2026-11-10T09:00:00Z', actor_id: 'u1', actor_email: 'clerk@vungu.example', actor_role: 'accountant',
  event: 'FIN_LEDGER_POST', severity: 'critical', method: 'POST', path: '/api/finance/ledger/vouchers/v1/post', status: 200,
  entity_type: 'finance_voucher', entity_id: 'v1', ip: '10.0.0.1', details: null, ...over,
})

describe('sample selection', () => {
  it('draws the same positions from the same seed, and different ones from another', () => {
    const a = samplePositions(1000, 25, 123456, 'random')
    expect(samplePositions(1000, 25, 123456, 'random')).toEqual(a)
    expect(samplePositions(1000, 25, 654321, 'random')).not.toEqual(a)
  })
  it('draws without replacement, inside the population, ascending', () => {
    const a = samplePositions(40, 30, 7, 'random')
    expect(new Set(a).size).toBe(30)
    expect(a.every((p) => p >= 0 && p < 40)).toBe(true)
    expect([...a].sort((x, y) => x - y)).toEqual(a)
  })
  it('takes the whole population when the size reaches it, and nothing from an empty one', () => {
    expect(samplePositions(5, 9, 1, 'random')).toEqual([0, 1, 2, 3, 4])
    expect(samplePositions(0, 9, 1, 'random')).toEqual([])
  })
  it('steps systematically from a random start', () => {
    const s = samplePositions(100, 10, 99, 'systematic')
    expect(s).toHaveLength(10)
    expect(s[1] - s[0]).toBe(10)
    expect(s[0]).toBeLessThan(10)
  })
  it('the generator is deterministic', () => {
    const r1 = seededRandom(42); const r2 = seededRandom(42)
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()])
  })
})

describe('exception tests', () => {
  it('finds a voucher posted by its preparer and ignores drafts', () => {
    const rows = [
      { id: 'a', prepared_by: 'u1', posted_by: 'u2' }, { id: 'b', prepared_by: 'u1', posted_by: 'u1' }, { id: 'c', prepared_by: 'u1', posted_by: null },
    ] as never
    expect(sameVoucherHands(rows).map((v: { id: string }) => v.id)).toEqual(['b'])
  })
  it('finds a cash-up verified by its cashier', () => {
    expect(sameCashUpHands([{ id: 's', cashier_id: 'u1', verified_by: 'u1' }, { id: 't', cashier_id: 'u1', verified_by: 'u2' }] as never)).toHaveLength(1)
  })
  it('finds a release approved and published by one person, and not when an id is missing', () => {
    expect(samePublicationHands([{ approved_by: 'u1', published_by: 'u1' }, { approved_by: null, published_by: 'u1' }] as never)).toHaveLength(1)
  })
  it('reads a variance as text: zero in any form is not a difference', () => {
    const s = (v: string | null) => ({ id: v, counts: [{ variance: v }] })
    expect(cashUpsWithVariance([s('0.00'), s('-0.00'), s(null), s('-2.50'), s('0.01')] as never).map((x: { id: string }) => x.id)).toEqual(['-2.50', '0.01'])
  })
  it('groups refusals by person and module, most first, and ignores successes', () => {
    const g = refusalsByPerson([
      ev({ id: '1', status: 403 }), ev({ id: '2', status: 403, occurred_at: '2026-11-11T09:00:00Z' }),
      ev({ id: '3', status: 403, actor_id: 'u2', actor_email: 'b@x' }), ev({ id: '4', status: 200 }),
    ])
    expect(g[0]).toMatchObject({ actor_id: 'u1', count: 2, last: '2026-11-11T09:00:00Z' })
    expect(g).toHaveLength(2)
  })
  it('a Saturday or a late evening is outside the working day', () => {
    expect(outsideHours(new Date(2026, 10, 14, 10).toISOString())).toBe(true) // Saturday
    expect(outsideHours(new Date(2026, 10, 16, 19).toISOString())).toBe(true)
    expect(outsideHours(new Date(2026, 10, 16, 10).toISOString())).toBe(false)
  })
})

let wrappers: VueWrapper[] = []
async function mountTrail(path: string, permissions: string[]) {
  const store = useFinanceStore()
  store.identity = { user_id: 'u-me', role: 'auditor', authority_id: 1, permissions, department_scope: [], catalogue: [] } as never
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/trail', name: 'aud-trail', component: AuditTrailPage }, { path: '/x', name: 'x', component: defineComponent({ render: () => h('div') }) },
  ] })
  await router.push(path)
  await router.isReady()
  const w = mount(AuditTrailPage, { global: { plugins: [router] } })
  wrappers.push(w)
  await flushPromises()
  return { w, router }
}

describe('audit trail search', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    trail.mockResolvedValue({ events: [ev(), ev({ id: 'e2', status: 403, method: 'PATCH' })], limit: 100, offset: 0, note: 'Refused attempts are recorded too.' })
  })
  afterEach(() => { wrappers.forEach((w) => w.unmount()); wrappers = [] })

  it('sends the filters in the address to the server, and a refused outcome as status_min 400', async () => {
    await mountTrail('/trail?actor=u1&module=FIN_LEDGER_POST&outcome=refused&from=2026-11-01&to=2026-11-15&entity_id=v1&page=2', ['finance.audit.view'])
    expect(trail).toHaveBeenCalledWith(expect.objectContaining({
      actor_id: 'u1', event: 'FIN_LEDGER_POST', status_min: 400, from: '2026-11-01', to: '2026-11-15', entity_id: 'v1', limit: 100, offset: 200,
    }))
  })
  it('opens on the last thirty days, and an empty from in the address means no lower date', async () => {
    await mountTrail('/trail', ['finance.audit.view'])
    expect(trail.mock.calls[0][0].from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await mountTrail('/trail?from=', ['finance.audit.view'])
    expect(trail.mock.calls[1][0].from).toBeUndefined()
  })
  it('shows a refusal in words and offers people seen in the results', async () => {
    const { w } = await mountTrail('/trail', ['finance.audit.view'])
    expect(w.text()).toContain('Refused (403)')
    expect(w.text()).toContain('Ledger postings and year-end')
    expect(w.findAll('option').some((o) => o.text().includes('clerk@vungu.example'))).toBe(true)
  })
  it('narrows the page by action on screen only', async () => {
    const { w } = await mountTrail('/trail?action=PATCH', ['finance.audit.view'])
    expect(trail.mock.calls[0][0]).not.toHaveProperty('method')
    expect(w.findAll('tbody tr').filter((r) => r.text().includes('Changed'))).toHaveLength(1)
    expect(w.find('tbody').text()).not.toContain('Created or acted')
  })
  it('offers the export only with finance.audit.export and says it covers the dates only', async () => {
    const plain = await mountTrail('/trail', ['finance.audit.view'])
    expect(plain.w.findAll('button').some((b) => b.text().includes('CSV'))).toBe(false)
    const auditor = await mountTrail('/trail', ['finance.audit.view', 'finance.audit.export'])
    expect(auditor.w.findAll('button').some((b) => b.text().includes('CSV'))).toBe(true)
    expect(auditor.w.text()).toContain('the other filters are not applied to the file')
  })
  it('says so when the server refuses, with Retry', async () => {
    trail.mockRejectedValueOnce({})
    const { w } = await mountTrail('/trail', ['finance.audit.view'])
    expect(w.find('[role="alert"]').text()).toContain('could not be read')
  })
})
