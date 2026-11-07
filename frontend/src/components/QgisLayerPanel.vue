<script setup lang="ts">
// Authoritative QGIS layer controls for the home map.
//
// These are the layers of vungu-project.qgs, rendered by QGIS Server itself
// (WMS) so the home map shows the same pixels as QGIS Desktop and /qgis-map.
// All map work is delegated to the shared @/map/qgisWmsOverlay module — this
// component is only UI state (which layers are on, their order and opacity).
//
// Mode strategy:
//   healthy  -> WMS, QGIS Server renders the real project symbology
//   degraded -> vector fallback (PostGIS via WFS, statutory palette)
// The mode is always visible to the user, and load errors are shown rather
// than swallowed.
import { onMounted, ref, watch } from 'vue'
import { ChevronUp, ChevronDown, RefreshCw } from 'lucide-vue-next'
import {
  fetchQgisHealth,
  fetchQgisLayers,
  addQgisLayer,
  removeQgisLayer,
  setQgisLayerOpacity,
  applyQgisOrder,
  type QgisHealth,
  type QgisLayerMeta,
  type QgisRenderMode,
} from '@/map/qgisWmsOverlay'

const props = defineProps<{
  /** MapLibre map instance. The component no-ops until this is set. */
  map: any | null
}>()

const open = ref(false)
const loading = ref(false)
const health = ref<QgisHealth>('unknown')
const layers = ref<QgisLayerMeta[]>([])
const active = ref<Set<string>>(new Set())
const busy = ref<Set<string>>(new Set())
const opacity = ref<Record<string, number>>({})
const error = ref('')

/** WMS while QGIS Server renders; vector only as a degraded fallback. */
const modeFor = (): QgisRenderMode => (health.value === 'healthy' ? 'wms' : 'vector')

const healthLabel = () => ({
  healthy: 'QGIS Server — authoritative rendering',
  degraded: 'Degraded — vector fallback from PostGIS',
  offline: 'QGIS Server offline — vector fallback',
  unknown: 'Checking QGIS Server…',
}[health.value])

async function load() {
  loading.value = true
  error.value = ''
  try {
    health.value = await fetchQgisHealth()
    layers.value = await fetchQgisLayers()
    for (const l of layers.value) if (opacity.value[l.name] == null) opacity.value[l.name] = 0.85
    if (!layers.value.length) error.value = 'No layers returned by the QGIS project.'
  } catch (e: any) {
    health.value = 'offline'
    error.value = e?.message || 'Could not reach the OGC bridge.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// The map may mount after this panel; re-apply anything already toggled on.
watch(
  () => props.map,
  async (m) => {
    if (!m || !active.value.size) return
    for (const name of active.value) {
      const meta = layers.value.find((l) => l.name === name)
      if (meta) await addQgisLayer(m, meta, { mode: modeFor(), opacity: opacity.value[name] })
    }
    applyQgisOrder(m, layers.value.map((l) => l.name).filter((n) => active.value.has(n)))
  },
)

async function toggle(layer: QgisLayerMeta) {
  if (!props.map || busy.value.has(layer.name)) return
  const name = layer.name
  error.value = ''

  if (active.value.has(name)) {
    removeQgisLayer(props.map, name)
    const next = new Set(active.value); next.delete(name); active.value = next
    return
  }

  busy.value = new Set(busy.value).add(name)
  try {
    await addQgisLayer(props.map, layer, { mode: modeFor(), opacity: opacity.value[name] ?? 0.85 })
    active.value = new Set(active.value).add(name)
    applyQgisOrder(props.map, layers.value.map((l) => l.name).filter((n) => active.value.has(n)))
  } catch (e: any) {
    // Surface the failure — never leave a dead toggle with no explanation.
    error.value = `${layer.title || name}: ${e?.message || 'failed to load'}`
  } finally {
    const b = new Set(busy.value); b.delete(name); busy.value = b
  }
}

function setOpacity(layer: QgisLayerMeta, val: number) {
  opacity.value = { ...opacity.value, [layer.name]: val }
  if (props.map) setQgisLayerOpacity(props.map, layer.name, val)
}

function move(index: number, dir: -1 | 1) {
  const j = index + dir
  if (j < 0 || j >= layers.value.length) return
  const arr = [...layers.value]
  ;[arr[index], arr[j]] = [arr[j], arr[index]]
  layers.value = arr
  if (props.map) applyQgisOrder(props.map, arr.map((l) => l.name).filter((n) => active.value.has(n)))
}

/** Re-check health and re-render active layers in the now-correct mode. */
async function refresh() {
  const previous = modeFor()
  await load()
  if (!props.map || modeFor() === previous) return
  for (const name of active.value) {
    const meta = layers.value.find((l) => l.name === name)
    if (meta) {
      try {
        await addQgisLayer(props.map, meta, { mode: modeFor(), opacity: opacity.value[name] })
      } catch (e: any) {
        error.value = `${meta.title || name}: ${e?.message || 'failed to reload'}`
      }
    }
  }
}
</script>

<template>
  <div class="qgis-panel" :class="{ open }">
    <button class="qgis-toggle" type="button" @click="open = !open">
      <span class="dot" :class="`is-${health}`" aria-hidden="true" />
      <span class="qgis-label">QGIS</span>
      <span class="qgis-count">{{ active.size }}</span>
    </button>

    <div v-show="open" class="qgis-body" role="group" aria-label="QGIS project layers">
      <div class="qgis-status">
        <span class="dot" :class="`is-${health}`" aria-hidden="true" />
        <span class="status-text">{{ healthLabel() }}</span>
        <button class="refresh-btn" type="button" title="Re-check QGIS Server" @click="refresh">
          <RefreshCw :size="12" />
        </button>
      </div>

      <p class="qgis-hint">
        Rendered by QGIS Server from <code>vungu-project.qgs</code> — same styling as QGIS Desktop.
      </p>
      <p class="qgis-hint">Top of the list draws on top. Use the arrows to reorder.</p>

      <p v-if="error" class="qgis-error" role="alert">{{ error }}</p>
      <p v-if="loading" class="qgis-hint">Loading layers…</p>

      <div class="layer-list">
        <div v-for="(l, idx) in layers" :key="l.name" class="layer-row">
          <span class="reorder">
            <button type="button" class="reorder-btn" :disabled="idx === 0"
                    title="Move up" aria-label="Move layer up" @click="move(idx, -1)">
              <ChevronUp :size="13" />
            </button>
            <button type="button" class="reorder-btn" :disabled="idx === layers.length - 1"
                    title="Move down" aria-label="Move layer down" @click="move(idx, 1)">
              <ChevronDown :size="13" />
            </button>
          </span>

          <button type="button" class="chip" :class="{ active: active.has(l.name) }"
                  :disabled="busy.has(l.name)" :title="l.name" @click="toggle(l)">
            <span class="chip-label">{{ l.title }}</span>
            <span v-if="busy.has(l.name)" class="chip-spin">…</span>
          </button>

          <input v-if="active.has(l.name)" class="opacity-slider" type="range"
                 min="0" max="1" step="0.05" :value="opacity[l.name] ?? 0.85"
                 :aria-label="`${l.title} opacity`"
                 @input="setOpacity(l, Number(($event.target as HTMLInputElement).value))" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Sits under the basemap "Layers" control (top-right) so the two layer
   panels read as one stack rather than competing widgets. */
.qgis-panel {
  position: absolute;
  /* Beside MapLibre's top-right control column (zoom, fullscreen, locate),
     never over it: at right: 16px it covered the zoom buttons. */
  top: 10px;
  right: 52px;
  z-index: 5;
  font-family: inherit;
  color: #3c4043;
}
/* Phone: below the map search box, which takes the top row there. */
@media (max-width: 767px) {
  .qgis-panel { top: 68px; }
}
.qgis-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: #ffffff;
  border: 1px solid #e3e6ea;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.qgis-toggle:hover { background: #f8fafc; }
.qgis-count {
  min-width: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #eef2f7;
  font-size: 11px;
  text-align: center;
}
.dot { width: 8px; height: 8px; border-radius: 50%; background: #9aa0a6; flex: none; }
.dot.is-healthy { background: #16a34a; }
.dot.is-degraded { background: #d97706; }
.dot.is-offline { background: #dc2626; }

.qgis-body {
  margin-top: 6px;
  width: 290px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid #e3e6ea;
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.12);
}
.qgis-status { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.status-text { font-size: 11.5px; font-weight: 600; flex: 1; }
.refresh-btn {
  display: inline-flex; align-items: center; padding: 3px;
  background: none; border: 1px solid #e3e6ea; border-radius: 5px; cursor: pointer; color: #5f6368;
}
.refresh-btn:hover { background: #f1f5f9; }
.qgis-hint { margin: 0 0 6px; font-size: 11px; color: #5f6368; line-height: 1.45; }
.qgis-hint code { font-size: 10.5px; background: #f1f5f9; padding: 0 3px; border-radius: 3px; }
.qgis-error {
  margin: 0 0 8px; padding: 6px 8px; font-size: 11px; line-height: 1.4;
  color: #b42318; background: #fef3f2; border: 1px solid #fecdca; border-radius: 6px;
}
.layer-list { display: flex; flex-direction: column; gap: 5px; }
.layer-row { display: flex; align-items: center; gap: 5px; }
.reorder { display: flex; flex-direction: column; gap: 1px; }
.reorder-btn {
  display: inline-flex; padding: 0; background: none; border: none;
  color: #9aa0a6; cursor: pointer; line-height: 1;
}
.reorder-btn:disabled { opacity: 0.3; cursor: default; }
.reorder-btn:not(:disabled):hover { color: #1a73e8; }
.chip {
  flex: 1; display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 8px; background: #f8fafc; border: 1px solid #e3e6ea;
  border-radius: 6px; font-size: 11.5px; text-align: left; cursor: pointer;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.chip.active { background: #e8f0fe; border-color: #1a73e8; color: #174ea6; font-weight: 600; }
.chip:disabled { opacity: 0.6; cursor: progress; }
.chip-label { overflow: hidden; text-overflow: ellipsis; }
.chip-spin { margin-left: auto; }
.opacity-slider { width: 56px; flex: none; accent-color: #1a73e8; }
</style>
