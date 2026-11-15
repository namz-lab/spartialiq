// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ identity: vi.fn(), style: vi.fn() }))
vi.mock('@/services/gisStyles', () => ({ getPublishedStyle: h.style }))
vi.mock('@/services/planLegend', async (orig) => ({ ...(await (orig as any)()), getPlanIdentity: h.identity }))

import PlanLegend from '../PlanLegend.vue'
import { legendFor, identityLine, kindLegend } from '@/services/planLegend'

const style = { definition: { renderer: { fallback: { symbol: { fill: '#efeadf' } }, categories: [
  { label: 'Cemetery', value: 'Cemetery', symbol: { fill: '#8a8a8a' } }, { label: 'Institutional', value: 'Institutional', symbol: { fill: '#c0392b' } }] } } }
const plan = (over: any = {}) => ({ id: 'p', title: 'Vungu RDC peri-urban local plan', version: 1, status: 'gazetted', authority: 'Vungu RDC', provisional: false,
  revision_label: 'Rev 005', revision_date: '2026-07-01', map_scale: 120000, gazette_ref: 'SI 9', effective_from: '2026-09-01',
  adopted_by_council: true, approved_by_minister: true, zones: [{ name: 'Cemetery', polygons: 1, hectares: 3 }, { name: 'Unmapped', polygons: 1, hectares: 1 }], ...over })

beforeEach(() => { h.identity.mockReset(); h.style.mockReset() })

describe('legendFor', () => {
  it('colours each zone as the published style does, and uses the style fallback for a zone it does not know', () => {
    expect(legendFor(style, plan()).map((e) => [e.label, e.fill])).toEqual([['Cemetery', '#8a8a8a'], ['Unmapped', '#efeadf']])
    expect(legendFor(null, plan())).toEqual([])
  })
  it('reads every layer that draws the zones of the plan, so a farm zone is not shown in the fallback colour', () => {
    const beyond = { definition: { renderer: { fallback: { symbol: { fill: '#efeadf' } }, categories: [{ label: 'Communal', value: 'Communal', symbol: { fill: '#aeb178' } }] } } }
    const p = plan({ zones: [{ name: 'Cemetery', polygons: 1, hectares: 3 }, { name: 'Communal', polygons: 1, hectares: 5 }] })
    expect(legendFor([style, beyond], p).map((e) => [e.label, e.fill])).toEqual([['Cemetery', '#8a8a8a'], ['Communal', '#aeb178']])
  })
  it('writes the sheet\'s title block line', () => {
    expect(identityLine({ revision_label: 'Rev 005', revision_date: '2026-07-01', map_scale: 120000 })).toBe('Rev 005 · July 2026 · 1:120 000')
  })
})

describe('kindLegend', () => {
  it('lists the published categories of a layer with their colours, as dots or areas', () => {
    expect(kindLegend(style, 'dot')).toEqual([{ label: 'Cemetery', fill: '#8a8a8a', shape: 'dot' }, { label: 'Institutional', fill: '#c0392b', shape: 'dot' }])
    expect(kindLegend(null, 'area')).toEqual([])
  })
})

describe('PlanLegend', () => {
  it('shows the plan, its revision and scale, that it is in force, and a swatch per zone', async () => {
    h.identity.mockResolvedValue({ plans: [plan()], published: true }); h.style.mockResolvedValue(style)
    const w = mount(PlanLegend); await flushPromises()
    expect(w.get('[data-testid=plan-legend-identity]').text()).toContain('Rev 005 · July 2026 · 1:120 000')
    expect(w.get('[data-testid=plan-legend-standing]').text()).toContain('In force since')
    expect(w.findAll('ul')[0].findAll('li')).toHaveLength(2)
    // the printed sheet's facilities and land features, from their own published styles
    expect(w.get('[data-testid=plan-legend-features]').findAll('li')).toHaveLength(4)
    expect(w.findAll('.pl-sw.dot')).toHaveLength(2)
  })
  it('says a plan not yet in force is shown for information only', async () => {
    h.identity.mockResolvedValue({ plans: [plan({ status: 'unknown', provisional: true })], published: false }); h.style.mockResolvedValue(style)
    const w = mount(PlanLegend); await flushPromises()
    expect(w.get('[data-testid=plan-legend-standing]').text()).toContain('Not yet in force')
  })
  it('says so plainly when there is no plan, or the details cannot be loaded', async () => {
    h.identity.mockResolvedValue({ plans: [], published: false })
    expect((mount(PlanLegend), await flushPromises(), true)).toBe(true)
    const w = mount(PlanLegend); await flushPromises()
    expect(w.text()).toContain('No plan is in force')
    h.identity.mockRejectedValue(new Error('x'))
    const f = mount(PlanLegend); await flushPromises()
    expect(f.text()).toContain('could not be loaded')
  })
})
