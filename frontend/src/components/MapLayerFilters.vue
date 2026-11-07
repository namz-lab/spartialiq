<script setup lang="ts">
// Filter chips for the PostGIS vector-tile basemap. Each layer renders as
// a toggleable chip with a coloured swatch matching the map paint.
//
// `country` is intentionally NOT exposed as a toggle — it is the always-on
// outline that anchors the map and must never be hidden.
import { onMounted, ref, watch } from 'vue'
import {
  getTileLayerCatalog,
  type TileLayerMeta,
} from '@/services/vectorTiles'
import {
  setBasemapLayerVisible,
  ALWAYS_ON_LAYER,
} from '@/map/vunguBasemap'
import { chipColorFor } from '@/map/vunguBasemapStyle'
import { ChevronUp, ChevronDown } from 'lucide-vue-next'

const props = defineProps<{
  /** MapLibre map instance. The component no-ops until this is set. */
  map: any | null
}>()

const layers = ref<TileLayerMeta[]>([])
// Default: every catalog layer is on (matches addVunguBasemap's default).
// The set is populated from the catalog response so the chip state mirrors
// what the map is actually rendering.
const visible = ref<Set<string>>(new Set())
const open = ref(false)
// Per-layer opacity (0–1). Lets an officer fade a layer back to read what is
// underneath — e.g. drop the landuse fill to see imagery or parcels through it.
const opacity = ref<Record<string, number>>({})

async function loadCatalog() {
  const catalog = await getTileLayerCatalog()
  // Hide the always-on layer from the toggle list entirely.
  layers.value = catalog.filter((l) => l.id !== ALWAYS_ON_LAYER)
  visible.value = new Set(layers.value.map((l) => l.id))
  const init: Record<string, number> = {}
  for (const l of layers.value) init[l.id] = 1
  opacity.value = init
}

onMounted(loadCatalog)

// Re-apply current visibility when the map becomes available — covers the
// case where MapLayerFilters mounts before InteractiveMap finishes loading.
watch(
  () => props.map,
  (m) => {
    if (!m) return
    for (const l of layers.value) {
      setBasemapLayerVisible(m, l.id, visible.value.has(l.id))
    }
  },
)

function toggle(layer: TileLayerMeta) {
  const next = !visible.value.has(layer.id)
  const nextSet = new Set(visible.value)
  if (next) nextSet.add(layer.id)
  else nextSet.delete(layer.id)
  visible.value = nextSet
  if (props.map) setBasemapLayerVisible(props.map, layer.id, next)
}

// Apply an opacity value to whichever paint property matches the layer type.
function applyOpacity(m: any, id: string, val: number) {
  const ly = m.getLayer?.(id)
  if (!ly) return
  try {
    if (ly.type === 'symbol') {
      m.setPaintProperty(id, 'icon-opacity', val)
      m.setPaintProperty(id, 'text-opacity', val)
    } else if (ly.type === 'fill') {
      m.setPaintProperty(id, 'fill-opacity', val)
    } else if (ly.type === 'line') {
      m.setPaintProperty(id, 'line-opacity', val)
    } else if (ly.type === 'circle') {
      m.setPaintProperty(id, 'circle-opacity', val)
      m.setPaintProperty(id, 'circle-stroke-opacity', val)
    } else if (ly.type === 'fill-extrusion') {
      m.setPaintProperty(id, 'fill-extrusion-opacity', val)
    }
  } catch {
    /* paint property not applicable to this layer */
  }
}

function setLayerOpacity(layer: TileLayerMeta, val: number) {
  opacity.value = { ...opacity.value, [layer.id]: val }
  if (props.map) applyOpacity(props.map, `vungu-${layer.id}`, val)
}

// ── layer draw-order control ────────────────────────────────────────────
// The first symbol layer marks the start of the label hierarchy; we keep all
// reordered fills/lines BELOW it so labels stay legible whatever the order.
function firstSymbolLayerId(m: any): string | undefined {
  const ls = m.getStyle?.()?.layers || []
  return ls.find((l: any) => l.type === 'symbol')?.id
}

// Re-stack each toggle layer's main render layer to match the panel order
// (top of the list = drawn on top, beneath the labels).
function applyOrder(m: any, ids: string[]) {
  if (!m) return
  const anchor = firstSymbolLayerId(m)
  for (let i = ids.length - 1; i >= 0; i--) {
    const main = `vungu-${ids[i]}`
    if (m.getLayer?.(main)) {
      try {
        m.moveLayer(main, anchor)
      } catch {
        /* layer not movable (e.g. not yet added) */
      }
    }
  }
}

function move(index: number, dir: -1 | 1) {
  const j = index + dir
  if (j < 0 || j >= layers.value.length) return
  const arr = [...layers.value]
  ;[arr[index], arr[j]] = [arr[j], arr[index]]
  layers.value = arr
  if (props.map) applyOrder(props.map, arr.map((l) => l.id))
}
</script>

<template>
  <div class="basemap-filters" :class="{ open }">
    <button class="filters-toggle" @click="open = !open" type="button">
      <span class="filters-icon" aria-hidden="true">▦</span>
      <span class="filters-label">Layers</span>
      <span class="filters-count">{{ visible.size }}</span>
    </button>

    <div v-show="open" class="filters-panel" role="group" aria-label="Map layer filters">
      <p class="filters-hint">Country boundary is always shown.</p>
      <p class="filters-hint">Top of the list draws on top. Use the arrows to reorder.</p>
      <div class="layer-list">
        <div v-for="(l, idx) in layers" :key="l.id" class="layer-row">
          <span class="reorder">
            <button
              type="button"
              class="reorder-btn"
              :disabled="idx === 0"
              aria-label="Move layer up"
              title="Move up"
              @click="move(idx, -1)"
            ><ChevronUp :size="13" /></button>
            <button
              type="button"
              class="reorder-btn"
              :disabled="idx === layers.length - 1"
              aria-label="Move layer down"
              title="Move down"
              @click="move(idx, 1)"
            ><ChevronDown :size="13" /></button>
          </span>
          <button
            type="button"
            class="chip"
            :class="{ active: visible.has(l.id) }"
            :title="`${l.title} (zoom ${l.minzoom}+)`"
            @click="toggle(l)"
          >
            <span class="swatch" :style="{ background: chipColorFor(l.id, l.geomType) }" />
            <span class="chip-label">{{ l.title }}</span>
          </button>
          <input
            v-if="visible.has(l.id)"
            class="opacity-slider"
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="opacity[l.id] ?? 1"
            :aria-label="`${l.title} opacity`"
            :title="`${l.title} opacity`"
            @input="setLayerOpacity(l, Number(($event.target as HTMLInputElement).value))"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Filter chips follow DESIGN.md § Components > Filter chips:
 *  - Active = accent fill (#1a73e8)
 *  - Inactive = warm sunken neutral (#ece9e0) on Google-grey text
 *  - Shadows and panel background use the same warm-tinted neutrals
 *    so the chrome lives in the same colour-temperature as the map. */
.basemap-filters {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 5;
  font-family: inherit;
  color: #3c4043;
}
.filters-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #ffffff;
  border: 1px solid #dadce0;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.10);
  font-size: 13px;
  font-weight: 600;
  color: #3c4043;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.filters-toggle:hover {
  background: #f5f3ee;
  border-color: #bdc1c6;
}
.filters-toggle:focus-visible {
  outline: 2px solid #1a73e8;
  outline-offset: 2px;
}
.filters-icon { font-size: 14px; line-height: 1; opacity: 0.65; }
.filters-label { letter-spacing: 0.01em; }
.filters-count {
  font-size: 11px;
  font-weight: 700;
  background: #1a73e8;
  color: #ffffff;
  padding: 2px 7px;
  border-radius: 999px;
  min-width: 18px;
  text-align: center;
}

.filters-panel {
  margin-top: 8px;
  width: min(260px, calc(100vw - 32px));
  background: #ffffff;
  border: 1px solid #dadce0;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.14);
  padding: 12px;
  max-height: 380px;
  overflow-y: auto;
}
.filters-hint {
  font-size: 11px;
  color: #5a5a5a;
  margin: 0 0 10px 0;
  letter-spacing: 0.01em;
}
.layer-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.layer-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.layer-row .chip {
  flex: 1;
  justify-content: flex-start;
}
.opacity-slider {
  width: 64px;
  flex: none;
  accent-color: #1a73e8;
  cursor: pointer;
}
.opacity-slider:focus-visible {
  outline: 2px solid #1a73e8;
  outline-offset: 2px;
}
.reorder {
  display: flex;
  flex-direction: column;
  flex: none;
}
.reorder-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 14px;
  padding: 0;
  border: none;
  background: transparent;
  color: #80868b;
  cursor: pointer;
  border-radius: 3px;
}
.reorder-btn:hover:not(:disabled) { background: #ece9e0; color: #3c4043; }
.reorder-btn:disabled { opacity: 0.3; cursor: default; }
.reorder-btn:focus-visible { outline: 2px solid #1a73e8; outline-offset: 1px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: #ece9e0;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 12px;
  color: #5a5a5a;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.chip:hover {
  background: #ddd9cc;
  color: #3c4043;
}
.chip:focus-visible {
  outline: 2px solid #1a73e8;
  outline-offset: 2px;
}
.chip.active {
  background: #1a73e8;
  color: #ffffff;
  border-color: #1a73e8;
}
.chip.active:hover {
  background: #1557b0;
}
.swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.6);
}
.chip-label { white-space: nowrap; }
</style>
