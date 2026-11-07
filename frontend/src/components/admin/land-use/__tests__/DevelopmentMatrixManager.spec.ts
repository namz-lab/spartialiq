// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const get = vi.fn(async (url: string) => ({
  data: {
    success: true,
    data: {
      '/development-control/zones': [
        { id: 1, zone_code: 'R1', zone_name: 'Residential 1', zone_type: 'Peri-Urban' },
        { id: 2, zone_code: 'AG', zone_name: 'Agriculture', zone_type: 'Farming' },
      ],
      '/development-control/groups': [
        { group_id: 'g1', group_code: 'A1', description: 'Dwelling house', group_category: 'Residential' },
      ],
      '/development-control/matrix': [
        { matrix_id: 'm1', zone_id: 1, group_id: 'g1', group_code: 'A1', permission_code: 'P',
          conditions: 'One per stand', max_units: '1', max_height_meters: null, min_lot_size_sqm: null, legal_reference: null },
      ],
      '/development-control/matrix/history': [
        { history_id: 1, action: 'created', permission_code: 'X', conditions: null,
          changed_at: '2026-10-01T09:00:00Z', changed_by_name: 'T. Planner' },
      ],
    }[url],
  },
}))
const post = vi.fn(async (..._a: unknown[]) => ({ data: { success: true, data: { matrix_id: 'm2' } } }))
vi.mock('@/services/api', () => ({
  default: { get: (u: string) => get(u), post: (...a: unknown[]) => post(...a), delete: vi.fn() },
  unwrapData: (r: any) => r.data.data,
}))
let role = 'planner'
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: { role } }) }))

import DevelopmentMatrixManager from '../DevelopmentMatrixManager.vue'

describe('DevelopmentMatrixManager', () => {
  it('renders the zone × group grid and saves an edited cell', async () => {
    const w = mount(DevelopmentMatrixManager, { global: { stubs: { teleport: true } } })
    await flushPromises()

    const cells = w.findAll('button.dm-cell')
    expect(cells.map(c => c.text())).toEqual(['P', '·'])
    expect(cells[1].attributes('aria-label')).toBe('A1 in Agriculture: Not scheduled')

    await cells[1].trigger('click')
    await flushPromises()
    expect(w.find('.dm-history').text()).toContain('Set to Prohibited')
    expect(w.find('.dm-history').text()).toContain('T. Planner')
    await w.find('input[type="radio"][value="SC"]').setValue()
    await w.find('input[type="number"]').setValue('2')
    await w.find('form#dm-form').trigger('submit')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/development-control/matrix', expect.objectContaining({
      zone_id: 2, group_code: 'A1', permission_code: 'SC', max_units: 2,
    }))
    expect(w.emitted('changed')?.length).toBe(2) // initial load + reload after save
  })

  it('previews a CSV import and applies only the changed cells', async () => {
    post.mockClear()
    const w = mount(DevelopmentMatrixManager, { global: { stubs: { teleport: true } } })
    await flushPromises()
    const input = w.find('input[type="file"]')
    const file = new File(['Group,Description,R1,AG\nA1,Dwelling house,P,X\n'], 'matrix.csv', { type: 'text/csv' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()

    expect(w.find('.dm-import').text()).toContain('1 rule will be set and 0 cleared')
    const apply = w.findAll('button').find(b => b.text() === 'Apply changes')!
    await apply.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/development-control/matrix/import', {
      changes: [{ zone_id: 2, group_code: 'A1', permission_code: 'X' }],
    })
  })

  it('lets every other officer open a cell read-only, with its conditions and history', async () => {
    role = 'building_inspector'
    post.mockClear()
    const w = mount(DevelopmentMatrixManager, { global: { stubs: { teleport: true } } })
    await flushPromises()
    expect(w.find('input[type="file"]').exists()).toBe(false) // no import
    await w.findAll('button.dm-cell')[0].trigger('click')
    await flushPromises()
    expect(w.find('form#dm-form').exists()).toBe(false)
    expect(w.find('.dm-detail').text()).toContain('One per stand')
    expect(w.find('.dm-history').text()).toContain('T. Planner')
    expect(w.findAll('button').some(b => b.text() === 'Save rule')).toBe(false)
    role = 'planner'
  })

  it('treats the Executive Officer as an editor', async () => {
    role = 'eo'
    const w = mount(DevelopmentMatrixManager, { global: { stubs: { teleport: true } } })
    await flushPromises()
    await w.findAll('button.dm-cell')[0].trigger('click')
    await flushPromises()
    expect(w.find('form#dm-form').exists()).toBe(true)
    role = 'planner'
  })
})
