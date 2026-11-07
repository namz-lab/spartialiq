// src/planning/cad/cadXref.ts
// ─────────────────────────────────────────────────────────────────────────
// Xref — external reference context (CAD-3). Attaches a curated set of the
// council's real-world context layers (existing buildings, roads, water,
// parcels, land use) to the clean Studio canvas as DIMMED, NON-INTERACTIVE,
// read-only underlays beneath the CAD drawing. Default hidden — the planner
// toggles a reference on when they need to trace/align against what exists.
//
// Non-interactive by design: no click handlers are added, so CAD picking is
// never intercepted. The catalog is injected (not fetched here) so this stays
// pure/testable; the Studio passes the result of getTileLayerCatalog().
// ─────────────────────────────────────────────────────────────────────────
import { tileUrlTemplate, type TileLayerMeta } from '@/services/vectorTiles'

/** The context layers offered as reference underlays (must exist as tiles). */
export const XREF_CONTEXT: Array<{ id: string; label: string }> = [
  { id: 'buildings', label: 'Existing buildings' },
  { id: 'roads', label: 'Existing roads' },
  { id: 'water_areas', label: 'Water bodies' },
  { id: 'waterways', label: 'Rivers & streams' },
  { id: 'vungu_parcels', label: 'Adjacent parcels' },
  { id: 'landuse', label: 'Existing land use' },
]

/** Dimmed reference tint per context id (grey by default, faint blue for water). */
const TINT: Record<string, { fill: string; line: string }> = {
  buildings: { fill: '#dfe3e8', line: '#c3cad3' },
  roads: { fill: '#cbd5e1', line: '#b6c0cc' },
  water_areas: { fill: '#dbeafe', line: '#bfdbfe' },
  waterways: { fill: '#bfdbfe', line: '#93c5fd' },
  vungu_parcels: { fill: '#eceef1', line: '#d6dbe0' },
  landuse: { fill: '#e8ece4', line: '#d4dccb' },
}

export interface XrefLayer { id: string; label: string; layerIds: string[]; visible: boolean }

/** MapLibre layer specs for one context id, given its geometry type. */
function dimLayers(id: string, sourceId: string, geomType: TileLayerMeta['geomType'], minzoom: number): any[] {
  const t = TINT[id] || { fill: '#e5e7eb', line: '#cbd5e1' }
  if (geomType === 'polygon') {
    return [
      { id: `xref-${id}-fill`, type: 'fill', source: sourceId, 'source-layer': id, minzoom, paint: { 'fill-color': t.fill, 'fill-opacity': 0.5 } },
      { id: `xref-${id}-line`, type: 'line', source: sourceId, 'source-layer': id, minzoom, paint: { 'line-color': t.line, 'line-width': 0.5 } },
    ]
  }
  if (geomType === 'line') {
    return [{ id: `xref-${id}-line`, type: 'line', source: sourceId, 'source-layer': id, minzoom, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': t.line, 'line-width': id === 'roads' ? 1.2 : 0.8 } }]
  }
  return [{ id: `xref-${id}-pt`, type: 'circle', source: sourceId, 'source-layer': id, minzoom, paint: { 'circle-radius': 1.6, 'circle-color': t.line } }]
}

/**
 * Add the curated context layers as hidden, dimmed underlays. `catalog` is the
 * tile catalog (from getTileLayerCatalog); only ids present in it are added.
 * `beforeId` (optional) inserts the layers beneath an existing layer.
 * Returns the toggle registry (all `visible:false`).
 */
export function attachXref(map: any, catalog: TileLayerMeta[], beforeId?: string): XrefLayer[] {
  const byId = new Map(catalog.map(l => [l.id, l]))
  const origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : ''
  const out: XrefLayer[] = []
  for (const ctx of XREF_CONTEXT) {
    const meta = byId.get(ctx.id)
    if (!meta) continue
    const sourceId = `vungu-${ctx.id}`
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: 'vector', tiles: [origin + tileUrlTemplate(ctx.id)], minzoom: meta.minzoom, maxzoom: meta.maxzoom })
    }
    const layerIds: string[] = []
    for (const def of dimLayers(ctx.id, sourceId, meta.geomType, meta.minzoom)) {
      if (!map.getLayer(def.id)) {
        if (beforeId && map.getLayer(beforeId)) map.addLayer(def, beforeId)
        else map.addLayer(def)
        map.setLayoutProperty(def.id, 'visibility', 'none')   // default hidden
      }
      layerIds.push(def.id)
    }
    if (layerIds.length) out.push({ id: ctx.id, label: ctx.label, layerIds, visible: false })
  }
  return out
}

/** Toggle a reference layer's visibility (mutates `layer.visible`). */
export function setXrefVisible(map: any, layer: XrefLayer, visible: boolean): void {
  layer.visible = visible
  for (const id of layer.layerIds) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
  }
}
