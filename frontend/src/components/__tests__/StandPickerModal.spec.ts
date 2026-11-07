// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import StandPickerModal from '../StandPickerModal.vue'
import type { StandLocation } from '@/services/parcels'

// Stub MapLibre + basemap so the component mounts without a real canvas.
vi.mock('maplibre-gl', () => ({
  default: {
    Map: class { on() {} addControl() {} remove() {} flyTo() {} resize() {} },
    NavigationControl: class {}, ScaleControl: class {},
    Marker: class { setLngLat() { return this } addTo() { return this } remove() {} },
  },
}))
vi.mock('@/map/vunguBasemap', () => ({ addVunguBasemap: vi.fn() }))

const inVungu: StandLocation = {
  in_jurisdiction: true, district: 'Gweru',
  authority: { name: 'Vungu Rural District Council', telephone: null, email: 'x@y', address: null },
  stand: { fid: 4, stand_number: 'Communal Land', province: 'Midlands', area_ha: 12.3,
    centroid: [29.39, -19.29], ward: '6', district: 'Gweru', description: 'Parcel Communal Land, Gweru — 12.3 ha' },
}
const outVungu: StandLocation = {
  in_jurisdiction: false, district: 'Harare', authority: null, stand: null,
}

describe('StandPickerModal', () => {
  it('enables confirm and emits the stand when in jurisdiction', async () => {
    const w = mount(StandPickerModal, { props: { open: true } })
    await (w.vm as any).applyLocation(inVungu)
    const confirm = w.get('[data-test="confirm"]')
    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    expect(w.emitted('select')?.[0]?.[0]).toMatchObject({ stand: { stand_number: 'Communal Land' } })
  })

  it('blocks confirm and shows the district message when out of jurisdiction', async () => {
    const w = mount(StandPickerModal, { props: { open: true } })
    await (w.vm as any).applyLocation(outVungu)
    expect(w.get('[data-test="confirm"]').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('Harare')
    expect(w.text()).toContain('outside Vungu RDC')
  })
})
