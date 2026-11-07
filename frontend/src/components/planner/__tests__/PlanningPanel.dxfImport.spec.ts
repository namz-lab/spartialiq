// @vitest-environment happy-dom
// Wires the "Import from CAD/QGIS (DXF)" button in PlanningPanel.vue end to
// end: disabled with no planning area, then a real file-input change event
// carrying an actual exported DXF flows through parseDxfToGeoJSON ->
// usePlanningTools().importDxf() -> a success notify. The parsing and
// reconciliation logic itself is covered in depth elsewhere (dxfImport.spec.ts,
// dxf-import-reconcile.spec.ts) — this test exists to catch wiring mistakes
// those unit tests can't see (wrong ref, wrong prop, event never firing).
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Feature, Polygon } from 'geojson'
import { usePlanningTools } from '@/planning/usePlanningTools'
import { exportFeaturesToDxf } from '@/map/tools/dxfExport'
import PlanningPanel from '../PlanningPanel.vue'

const O: [number, number] = [29.8, -19.4]
const move = (p: number[], m: number, b: number) => turf.destination(p, m, b, { units: 'meters' }).geometry.coordinates as [number, number]
function squareFeature(sizeM: number): Feature<Polygon> {
  const o = O, e = move(o, sizeM, 90), ne = move(e, sizeM, 0), n = move(o, sizeM, 0)
  return turf.polygon([[o, e, ne, n, o]]) as any
}

let capturedBlob: Blob | null = null
let origCreateObjectURL: typeof URL.createObjectURL
let origRevokeObjectURL: typeof URL.revokeObjectURL

beforeEach(() => {
  capturedBlob = null
  origCreateObjectURL = URL.createObjectURL
  origRevokeObjectURL = URL.revokeObjectURL
  URL.createObjectURL = ((blob: Blob) => { capturedBlob = blob; return 'blob:mock' }) as any
  URL.revokeObjectURL = (() => {}) as any
})
afterEach(() => {
  URL.createObjectURL = origCreateObjectURL
  URL.revokeObjectURL = origRevokeObjectURL
})

describe('PlanningPanel — Import from CAD/QGIS (DXF)', () => {
  it('is disabled until a planning area is selected', async () => {
    const t = usePlanningTools()
    const wrapper = mount(PlanningPanel, { props: { planning: t } })
    // The import button lives in the Metrics tab (alongside Save/Export/CSV).
    await wrapper.findAll('.pl-tabs button').find(b => b.text() === 'Metrics')!.trigger('click')
    const btn = wrapper.findAll('button').find(b => b.text().includes('Import from CAD/QGIS'))
    expect(btn).toBeTruthy()
    expect(btn!.attributes('disabled')).toBeDefined()
  })

  it('imports a real exported DXF back through the panel and reports the result', async () => {
    const t = usePlanningTools()
    const sq = squareFeature(120)
    t.selectParcel(sq as any, 'Test block')
    t.runBlocks()
    t.runSubdivision()
    expect(t.lots.value.length).toBeGreaterThan(0)

    // Build a real DXF the same way exportDxf() in this component does.
    const feats = t.lots.value.map(l => ({
      type: 'Feature' as const,
      properties: { kind: 'lot', id: `Lot ${l.lotNumber ?? ''}`.trim(), roundTripId: l.id },
      geometry: l.geom,
    }))
    exportFeaturesToDxf(feats, [], { fileName: 'panel-test' })
    expect(capturedBlob).toBeTruthy()
    const dxfFile = new File([await capturedBlob!.text()], 'panel-test.dxf', { type: 'application/dxf' })

    const wrapper = mount(PlanningPanel, { props: { planning: t } })
    // The import button lives in the Metrics tab (alongside Save/Export/CSV).
    await wrapper.findAll('.pl-tabs button').find(b => b.text() === 'Metrics')!.trigger('click')
    const btn = wrapper.findAll('button').find(b => b.text().includes('Import from CAD/QGIS'))
    expect(btn!.attributes('disabled')).toBeUndefined()

    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [dxfFile], configurable: true })
    await input.trigger('change')
    await flushPromises()

    const notifyEvents = wrapper.emitted('notify')
    expect(notifyEvents).toBeTruthy()
    const [message, type] = notifyEvents![notifyEvents!.length - 1]
    expect(type).toBe('success')
    expect(message).toMatch(/Imported from DXF.*matched/i)
  })
})
