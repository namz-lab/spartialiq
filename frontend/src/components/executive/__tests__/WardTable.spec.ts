// @vitest-environment happy-dom
//
// The ward tables: every ward a row, the totals and "in no ward" lines that make the rows add up, a missing figure written "not recorded" and never as
// zero, a rate with no total, the provisional-ward note, and the export carrying all of it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ ceo: vi.fn(), unit: vi.fn() }))
vi.mock('@/services/spatialEngine', () => ({ spatialEngineApi: { wardTable: api.ceo } }))
vi.mock('@/services/units', () => ({ unitsApi: { wardTable: api.unit } }))
const exported = vi.hoisted(() => ({ table: null as null | { rows: unknown[][]; totals?: unknown; extra?: unknown[]; notes?: string[]; columns: string[] } }))
vi.mock('@/components/shared/ExportMenu.vue', () => ({
  default: { name: 'ExportMenu', props: ['build', 'filename', 'print'], setup(p: { build: () => never }) { return { grab: () => { exported.table = p.build() } } }, template: '<button data-testid="export" @click="grab">export</button>' },
}))

import WardTable from '../WardTable.vue'
import type { WardTable as Data } from '@/services/spatialEngine'

const DATA: Data = {
  ward_register: { linked: true, wards: 3, basis: 'interim', instrument_ref: null },
  run: { id: 1, computed_at: '2026-11-15T09:00:00Z', wards: 3, ward_register_basis: 'interim' },
  measures: [
    { key: 'cov', label: 'Stands with a rates account', unit: '% of stands', kind: 'share', owner_dept: 'Finance' },
    { key: 'dens', label: 'Parcels per km²', unit: 'parcels per km²', kind: 'density', owner_dept: 'Planning' },
  ],
  counts: [{ key: 'stands', label: 'Stands' }, { key: 'farms', label: 'Farm parcels' }],
  rows: [
    { ward_code: 'W10', name: '10', area_km2: 10, measures: { cov: { value: 83.33, reliability: 'ok' }, dens: { value: 1.234, reliability: 'ok' } }, counts: { stands: 5, farms: 0 } },
    { ward_code: 'W2', name: '2', area_km2: 20, measures: { cov: { value: null, reliability: 'no_data' }, dens: { value: 0.5, reliability: 'ok' } }, counts: { stands: 0, farms: 11 } },
    { ward_code: 'W9', name: '9', area_km2: 30, measures: { cov: { value: 100, reliability: 'ok' }, dens: { value: null, reliability: 'no_data' } }, counts: { stands: 7, farms: 3 } },
  ],
  totals: { stands: 15, farms: 20 },
  not_in_a_ward: { stands: 3, farms: 6 },
  reason: null,
}

beforeEach(() => { api.ceo.mockReset(); api.unit.mockReset(); exported.table = null })
const mountIt = async (props = {}) => { const w = mount(WardTable, { props }); await flushPromises(); return w }
const text = (w: ReturnType<typeof mount>, id: string) => w.get(`[data-testid=${id}]`).text()

describe('WardTable', () => {
  it('shows every ward as a row, in ward-number order (10 after 9), with the total and what lies in no ward', async () => {
    api.ceo.mockResolvedValue(DATA)
    const w = await mountIt()
    const wards = w.get('[data-testid=wt-counts]').findAll('tbody th').map((t) => t.text())
    expect(wards).toEqual(['2', '9', '10'])
    expect(text(w, 'wt-total')).toContain('15')
    expect(text(w, 'wt-total')).toContain('20')
    expect(text(w, 'wt-outside')).toContain('in no ward')
    expect(text(w, 'wt-outside')).toContain('6')
  })

  it('writes a missing figure "not recorded", keeps a real zero, and formats shares and densities', async () => {
    api.ceo.mockResolvedValue(DATA)
    const m = text(await mountIt(), 'wt-measures')
    expect(m).toContain('83.3%')
    expect(m).toContain('1.23')
    expect(m).toContain('not recorded')
    const cells = (await mountIt()).get('[data-testid=wt-counts]').findAll('tbody td').map((c) => c.text())
    expect(cells).toContain('0')   // a ward with no farms counted has a real zero, not 'not recorded'
  })

  it('sorts by a column, putting "not recorded" last whichever way', async () => {
    api.ceo.mockResolvedValue(DATA)
    const w = await mountIt()
    const sortBtn = w.get('[data-testid=wt-measures]').findAll('thead button').find((b) => b.text() === 'Stands with a rates account')!
    await sortBtn.trigger('click')   // first click: high to low
    expect(w.get('[data-testid=wt-measures]').findAll('tbody th').map((t) => t.text())).toEqual(['9', '10', '2'])
    await sortBtn.trigger('click')   // second: low to high, the gap still last
    expect(w.get('[data-testid=wt-measures]').findAll('tbody th').map((t) => t.text())).toEqual(['10', '9', '2'])
  })

  it('says the ward list is provisional while the ward register is open, and that a gap is not a zero', async () => {
    api.ceo.mockResolvedValue(DATA)
    const w = await mountIt()
    expect(w.text()).toContain('provisional')
    expect(w.text()).toContain('is not zero')
  })

  it('exports the table with the as-at, the caveats, the totals and the "not in any ward" line, and gaps as null', async () => {
    api.ceo.mockResolvedValue(DATA)
    const w = await mountIt()
    await w.get('[data-testid=export]').trigger('click')
    const t = exported.table!
    expect(t.columns[0]).toBe('Ward')
    expect(t.columns).toContain('Stands')
    expect(t.columns.some((c) => c.includes('% of stands'))).toBe(true)
    expect(t.notes!.some((n) => n.includes('provisional'))).toBe(true)
    expect(t.rows[0][0]).toBe('2')
    expect(t.rows[0]).toContain(null)   // ward 2 has no coverage figure: null, written "not recorded" by the export
    expect(t.totals).toMatchObject({ label: 'Total' })
    expect(t.extra).toHaveLength(1)
  })

  it('reads a unit\'s own table when given a unit', async () => {
    api.unit.mockResolvedValue({ ...DATA, counts: [], totals: null, not_in_a_ward: null })
    const w = await mountIt({ unitKey: 'engineering' })
    expect(api.unit).toHaveBeenCalledWith('engineering')
    expect(api.ceo).not.toHaveBeenCalled()
    expect(w.find('[data-testid=wt-counts]').exists()).toBe(false)
    expect(w.find('[data-testid=wt-measures]').exists()).toBe(true)
  })

  it('shows one table when told which, keeps the other for printing, and still exports both', async () => {
    api.ceo.mockResolvedValue(DATA)
    const w = await mountIt({ only: 'measures' })
    const block = (id: string) => w.get(`[data-testid=${id}]`).element.parentElement as HTMLElement
    expect(block('wt-counts').style.display).toBe('none')     // hidden on screen, still in the page for print
    expect(block('wt-measures').style.display).toBe('')
    await w.get('[data-testid=export]').trigger('click')
    expect(exported.table!.columns).toContain('Stands')        // the export carries the counts too
  })

  it('says so when no wards are linked, and when the tables cannot be read', async () => {
    api.ceo.mockResolvedValue({ ...DATA, rows: [], counts: [], measures: [], totals: null, not_in_a_ward: null })
    expect((await mountIt()).get('[data-testid=wt-empty]').text()).toContain('No wards are linked')
    api.ceo.mockRejectedValue(new Error('x'))
    expect((await mountIt()).text()).toContain('could not be read')
  })
})
