// @vitest-environment happy-dom
//
// The boundary proposals panel: who sees what, and that the panel never lets a proposal with problems be sent
// or a return/reject go out without a reason. The server makes the same checks; this pins what the person sees.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), submit: vi.fn(), withdraw: vi.fn(), decide: vi.fn() }))
vi.mock('@/services/parcelChangeService', async (orig) => {
  const real = await orig<typeof import('@/services/parcelChangeService')>()
  return { ...real, parcelChangeApi: { ...real.parcelChangeApi, ...api } }
})

import StandChangeProposals from '../StandChangeProposals.vue'
import { useAuthStore } from '@/stores/auth'
import { describeProblem } from '@/services/parcelChangeService'

const SQUARE: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }
const SUMMARY = { id: 'p1', kind: 'split', status: 'draft', reason: null, requested_by: 'u1', requested_by_name: 'Pat', submitted_at: null, decided_at: null,
  survey_task_id: null, general_plan_id: null, created_at: '2026-11-15', stands: ['1228'], items: 2 }
const detail = (over: Record<string, unknown> = {}) => ({
  ...SUMMARY, decided_by: null, decision_note: null, items: [], problems: [],
  parents: [{ parcel_id: 'P-1', stand_no: '1228', township_code: 'HERTS', status: 'current', area_m2: '500', geometry: SQUARE }], ...over,
})

function mountAs(role: string, id = 'u1') {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  ;(auth as any).user = { id, role }
  return mount(StandChangeProposals)
}

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()) })

describe('describeProblem', () => {
  it('says a problem in plain words, with its figures', () => {
    expect(describeProblem({ code: 'items_overlap', detail: { overlap_m2: 12.5 } })).toContain('12.5 m²')
    expect(describeProblem({ code: 'parent_reserved_or_allocated', detail: { stand_no: '1231' } })).toContain('1231')
    expect(describeProblem({ code: 'something_new', detail: {} })).toContain('something_new')
  })
})

describe('StandChangeProposals', () => {
  it("lists the drafter's proposals with the stands and the status in words", async () => {
    api.list.mockResolvedValue([SUMMARY])
    const w = mountAs('planner')
    await flushPromises()
    expect(api.list).toHaveBeenCalledWith({ mine: true })
    expect(w.text()).toContain('Split')
    expect(w.text()).toContain('1228')
    expect(w.text()).toContain('Draft')
    expect(w.find('[role="tablist"]').exists()).toBe(false)   // no Survey queue for a drafter
  })

  it('does not let a proposal with problems be sent, and lists them', async () => {
    api.list.mockResolvedValue([SUMMARY])
    api.get.mockResolvedValue(detail({ problems: [{ code: 'items_outside_parents', detail: { mismatch_m2: 40 } }] }))
    const w = mountAs('planner')
    await flushPromises()
    await w.find('.scp__row').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('40 m²')
    expect(w.findAll('button').find((b) => b.text().startsWith('Send to the Survey Section'))!.attributes('disabled')).toBeDefined()
  })

  it('sends a clean proposal and shows it as with the Survey Section', async () => {
    api.list.mockResolvedValue([SUMMARY])
    api.get.mockResolvedValue(detail())
    api.submit.mockResolvedValue(detail({ status: 'submitted' }))
    const w = mountAs('planner')
    await flushPromises()
    await w.find('.scp__row').trigger('click')
    await flushPromises()
    const send = w.findAll('button').find((b) => b.text().startsWith('Send to the Survey Section'))!
    expect(send.attributes('disabled')).toBeUndefined()
    await send.trigger('click')
    await flushPromises()
    expect(api.submit).toHaveBeenCalledWith('p1')
    expect(w.emitted('changed')).toBeTruthy()
    expect(w.text()).toContain('With the Survey Section')
  })

  it("shows the Survey Section its queue, and only lets it return or reject with a reason", async () => {
    api.list.mockResolvedValue([{ ...SUMMARY, status: 'submitted', requested_by: 'someone-else' }])
    api.get.mockResolvedValue(detail({ status: 'submitted', requested_by: 'someone-else' }))
    api.decide.mockResolvedValue(detail({ status: 'returned', decision_note: 'Show the road.' }))
    const w = mountAs('gis_data', 'u2')
    await flushPromises()
    expect(w.find('[role="tablist"]').exists()).toBe(true)
    await w.findAll('[role="tab"]').find((t) => t.text() === 'Survey queue')!.trigger('click')
    await flushPromises()
    expect(api.list).toHaveBeenLastCalledWith({ status: ['submitted', 'accepted'] })
    await w.find('.scp__row').trigger('click')
    await flushPromises()
    const btn = (label: string) => w.findAll('button').find((b) => b.text() === label)!
    expect(btn('Accept').attributes('disabled')).toBeUndefined()
    expect(btn('Return').attributes('disabled')).toBeDefined()
    expect(btn('Reject').attributes('disabled')).toBeDefined()
    await w.find('#scp-note').setValue('Show the road.')
    expect(btn('Return').attributes('disabled')).toBeUndefined()
    await btn('Return').trigger('click')
    await flushPromises()
    expect(api.decide).toHaveBeenCalledWith('p1', 'return', 'Show the road.')
  })

  it('offers withdrawing only to the person who drew the proposal', async () => {
    api.list.mockResolvedValue([SUMMARY])
    api.get.mockResolvedValue(detail({ status: 'submitted', requested_by: 'u1' }))
    const mine = mountAs('planner', 'u1')
    await flushPromises()
    await mine.find('.scp__row').trigger('click')
    await flushPromises()
    expect(mine.findAll('button').some((b) => b.text() === 'Withdraw')).toBe(true)

    const other = mountAs('planner', 'u9')
    await flushPromises()
    await other.find('.scp__row').trigger('click')
    await flushPromises()
    expect(other.findAll('button').some((b) => b.text() === 'Withdraw')).toBe(false)
  })
})
