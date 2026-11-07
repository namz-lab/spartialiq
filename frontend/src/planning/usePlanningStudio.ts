// src/planning/usePlanningStudio.ts
// ─────────────────────────────────────────────────────────────────────────
// Planning Studio rendering engine. Given the Studio's MapLibre map and the shared
// planning engine, it: wires the editable proposal layers, keeps them in sync with
// engine state, loads the chosen parcel as the planning area, fits to it, and exposes
// a layer registry (existing context = locked; proposed = editable) for the Layer
// Manager. Reuses planning-layers + getFeature; no new subdivision logic.
// ─────────────────────────────────────────────────────────────────────────
import { ref, watch } from 'vue'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import { addPlanningLayers, syncPlanningLayers } from './planning-layers'
import { getFeature } from '@/services/vectorTiles'
import type { PlanningToolsApi } from './usePlanningTools'

export interface StudioLayer {
  id: string                 // registry id
  label: string              // domain-language name
  styleIds: string[]         // underlying MapLibre layer ids it toggles
  group: 'context' | 'proposed'
  locked: boolean            // context is read-only
  visible: boolean
}

// Curated locked context layers (only the ones that exist as tiles today).
const CONTEXT_LAYERS: Array<{ id: string; label: string }> = [
  { id: 'buildings', label: 'Existing buildings' },
  { id: 'roads', label: 'Existing roads' },
  { id: 'water_areas', label: 'Water' },
  { id: 'waterways', label: 'Rivers & streams' },
  { id: 'vungu_parcels', label: 'Adjacent parcels' },
  { id: 'landuse', label: 'Land use' },
]
// Editable proposal layers (from planning-layers.ts).
const PROPOSED_LAYERS: Array<{ id: string; label: string; styleIds: string[] }> = [
  { id: 'pl-roads', label: 'Proposed roads', styleIds: ['pl-road-line'] },
  { id: 'pl-lots', label: 'Stands', styleIds: ['pl-lot-fill', 'pl-lot-line', 'pl-lot-label'] },
  { id: 'pl-openspace', label: 'Open space & reserves', styleIds: ['pl-openspace-fill'] },
  { id: 'pl-blocks', label: 'Blocks', styleIds: ['pl-block-fill', 'pl-block-line'] },
  { id: 'pl-constraints', label: 'Constraints', styleIds: ['pl-constraint-fill', 'pl-constraint-line'] },
]

export function usePlanningStudio(planning: PlanningToolsApi) {
  const layerRegistry = ref<StudioLayer[]>([])
  const loading = ref(false)
  const error = ref('')
  let map: any = null

  /** Wire proposal layers + keep them in sync; build the Layer Manager registry. */
  function attach(m: any) {
    map = m
    addPlanningLayers(map)
    syncPlanningLayers(map, planning.layers.value as any)
    watch(planning.layers, (l) => { if (map) syncPlanningLayers(map, l as any) }, { deep: true })

    const reg: StudioLayer[] = []
    for (const c of CONTEXT_LAYERS) {
      const styleIds = (map.getStyle().layers || [])
        .map((l: any) => l.id as string)
        .filter((id: string) => id === `vungu-${c.id}` || id.startsWith(`vungu-${c.id}`))
      if (styleIds.length) reg.push({ id: c.id, label: c.label, styleIds, group: 'context', locked: true, visible: true })
    }
    for (const p of PROPOSED_LAYERS) {
      reg.push({ id: p.id, label: p.label, styleIds: p.styleIds, group: 'proposed', locked: false, visible: true })
    }
    layerRegistry.value = reg
  }

  function setLayerVisible(id: string, visible: boolean) {
    const entry = layerRegistry.value.find(l => l.id === id)
    if (!entry || !map) return
    entry.visible = visible
    for (const sid of entry.styleIds) {
      if (map.getLayer(sid)) map.setLayoutProperty(sid, 'visibility', visible ? 'visible' : 'none')
    }
    layerRegistry.value = [...layerRegistry.value]
  }

  /** Load the right-clicked parcel as the planning area, then fit the map to it. */
  async function loadParcel(layer: string, fid: number) {
    loading.value = true
    error.value = ''
    try {
      const feature = await getFeature(layer, fid)
      const gt = feature?.geometry?.type
      if (!feature || (gt !== 'Polygon' && gt !== 'MultiPolygon')) {
        error.value = 'That feature is not a piece of land that can be subdivided.'
        return false
      }
      const name = feature.properties?.name || feature.properties?.name_cfu
      planning.selectParcel(feature, name)
      planning.projectName.value = name || `Subdivision — ${layer} ${fid}`
      fitToArea()
      return true
    } catch (e: any) {
      error.value = e?.message || 'Failed to load the parcel.'
      return false
    } finally { loading.value = false }
  }

  function fitToArea() {
    const a = planning.planningArea.value
    if (!a || !map) return
    try {
      const bb = turf.bbox(turf.feature(a.geom as any))
      map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]] as any, { padding: 60, duration: 500 })
    } catch { /* ignore */ }
  }

  return { attach, loadParcel, fitToArea, setLayerVisible, layerRegistry, loading, error }
}
