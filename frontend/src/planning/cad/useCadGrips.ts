// src/planning/cad/useCadGrips.ts
// ─────────────────────────────────────────────────────────────────────────
// Grips/Stretch interaction composable (CAD-2).  Computes grip handles for the
// current selection, manages drag state, and exposes three map-event handlers
// (pointerDown / pointerMove / pointerUp) that the hosting Vue component wires
// to MapLibre mouse events.
//
// Drag lifecycle:
//   1. pointerDown on a grip → pushUndo() saves pre-drag state, marks activeGrip
//   2. pointerMove            → previewStretch() mutates geom without committing
//   3. pointerUp              → clears activeGrip; undo stack already correct
//
// syncGrips() is called automatically whenever grips or hotGripIdx change, so
// the host component only needs to call addGripLayer(map) once on mount.
// ─────────────────────────────────────────────────────────────────────────
import { ref, computed, watch } from 'vue'
import type maplibregl from 'maplibre-gl'
import { getGrips, type CadGrip } from './cadGrips'
import { syncGrips, GRIP_LAYER_ID } from './cadRender'
import type { CadDocumentApi } from './useCadDocument'

// `getMap` is a getter (not a Ref) to match the codebase convention
// (useStudioSnapping) and to avoid Vue's deep ref-unwrap of the complex Map type.
export function useCadGrips(cadDoc: CadDocumentApi, getMap: () => maplibregl.Map | null) {
  // ── grip list (recomputed on selection change) ───────────────────────────
  const grips = computed<CadGrip[]>(() =>
    cadDoc.selectedEntities.value
      .filter(e => !e.locked)
      .flatMap(e => getGrips(e)),
  )

  // ── drag state ────────────────────────────────────────────────────────────
  const activeGrip = ref<CadGrip | null>(null)
  const hotGripIdx = ref<number | null>(null)
  const isDragging = computed(() => activeGrip.value !== null)

  // ── auto-sync grip layer whenever grips or hot state changes ─────────────
  watch(
    [grips, hotGripIdx],
    ([g, hot]) => {
      const map = getMap()
      if (map) syncGrips(map, g, hot)
    },
    { deep: true },
  )

  // ── map event handlers (to be wired in the host component) ───────────────

  /**
   * Call on MapLibre `mousedown`.  Returns true when a grip was hit so the
   * host can preventDefault() and suppress normal map-pan / entity-select.
   */
  function onPointerDown(e: maplibregl.MapMouseEvent): boolean {
    const map = getMap()
    if (!map) return false

    const hits = map.queryRenderedFeatures(e.point, { layers: [GRIP_LAYER_ID] })
    if (!hits.length) return false

    const gripIdx = hits[0].properties?.gripIdx as number | undefined
    if (gripIdx === undefined) return false

    const grip = grips.value[gripIdx]
    if (!grip) return false

    cadDoc.pushUndo()
    activeGrip.value = grip
    hotGripIdx.value = gripIdx
    map.getCanvas().style.cursor = 'grabbing'
    return true
  }

  /** Call on MapLibre `mousemove`. Live-updates the vertex being dragged. */
  function onPointerMove(e: maplibregl.MapMouseEvent): void {
    const map = getMap()
    if (!map) return

    if (!activeGrip.value) {
      // hover highlight
      const hits = map.queryRenderedFeatures(e.point, { layers: [GRIP_LAYER_ID] })
      const idx = hits.length ? (hits[0].properties?.gripIdx as number) : null
      if (idx !== hotGripIdx.value) {
        hotGripIdx.value = idx
        map.getCanvas().style.cursor = idx !== null ? 'grab' : ''
      }
      return
    }

    const { lng, lat } = e.lngLat
    cadDoc.previewStretch(activeGrip.value.entityId, activeGrip.value.gripPath, [lng, lat])
  }

  /** Call on MapLibre `mouseup` (and `mouseleave` as a safety net). */
  function onPointerUp(): void {
    if (!activeGrip.value) return
    activeGrip.value = null
    const map = getMap()
    if (map) map.getCanvas().style.cursor = ''
  }

  return {
    grips,
    isDragging,
    hotGripIdx,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}
