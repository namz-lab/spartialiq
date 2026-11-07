// @vitest-environment happy-dom
// Text + Leader annotations (useCadDocument.addText / addLeader).
import { describe, it, expect } from 'vitest'
import type { LineString } from 'geojson'
import { useCadDocument } from '../useCadDocument'

const A: [number, number] = [29.8, -19.4]
const B: [number, number] = [29.81, -19.41]

describe('addText', () => {
  it('places a text entity that renders via the label layer', () => {
    const d = useCadDocument()
    const e = d.addText(A, 'Lot 14')!
    expect(e.type).toBe('text')
    expect(e.text).toBe('Lot 14')
    expect(e.geom).toEqual({ type: 'Point', coordinates: A })
    const feat = (d.toGeoJSON.value.features as any[]).find(f => f.properties.id === e.id)
    expect(feat.properties.type).toBe('text')
    expect(feat.properties.text).toBe('Lot 14')
  })

  it('trims whitespace and rejects empty text', () => {
    const d = useCadDocument()
    expect(d.addText(A, '   ')).toBeNull()
    expect(d.entities.value).toHaveLength(0)
    const e = d.addText(A, '  Park  ')!
    expect(e.text).toBe('Park')
  })
})

describe('addLeader', () => {
  it('creates a pointer line + a label as ONE undo step', () => {
    const d = useCadDocument()
    const res = d.addLeader(A, B, 'See note 3')!
    expect(d.entities.value).toHaveLength(2)
    expect(res.line.type).toBe('polyline')
    expect((res.line.geom as LineString).coordinates).toEqual([A, B])
    expect(res.label.type).toBe('text')
    expect(res.label.text).toBe('See note 3')
    expect(res.label.geom).toEqual({ type: 'Point', coordinates: B })

    // a single undo removes the whole callout (both entities)
    d.undo()
    expect(d.entities.value).toHaveLength(0)
  })

  it('rejects an empty callout', () => {
    const d = useCadDocument()
    expect(d.addLeader(A, B, '')).toBeNull()
    expect(d.entities.value).toHaveLength(0)
  })
})
