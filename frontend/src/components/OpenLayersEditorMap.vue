<template>
  <div class="ol-editor" :style="sizeStyle">
    <div ref="mapContainer" class="ol-editor-map"></div>

    <div v-if="editable" class="ol-toolbar" role="toolbar" aria-label="Map editing tools">
      <label class="ol-field">
        <span>Edit layer</span>
        <select v-model="targetLayer" :disabled="!layers.length" aria-label="Layer that new features are added to">
          <option v-for="l in layers" :key="l" :value="l">{{ l }}</option>
        </select>
      </label>

      <div class="ol-group" role="group" aria-label="Tool">
        <button
          v-for="t in tools"
          :key="t.mode"
          type="button"
          class="ol-btn"
          :aria-pressed="mode === t.mode"
          :class="{ active: mode === t.mode }"
          @click="setMode(t.mode)"
        >{{ t.label }}</button>
      </div>

      <button type="button" class="ol-btn danger" :disabled="!selectedFeature" @click="deleteSelected">
        Delete selected
      </button>

      <span class="ol-pending" aria-live="polite">
        {{ pendingCount ? `${pendingCount} unsaved ${pendingCount === 1 ? 'change' : 'changes'}` : 'No unsaved changes' }}
      </span>

      <button type="button" class="ol-btn" :disabled="!pendingCount || saving" @click="discard">Discard</button>
      <button
        type="button"
        class="ol-btn primary"
        :disabled="!pendingCount || saving || !enableWfsT"
        :title="enableWfsT ? undefined : 'Saving is disabled for this editor'"
        @click="saveEdits"
      >{{ saving ? 'Saving…' : 'Save changes' }}</button>
    </div>

    <p v-if="message" class="ol-message" :class="{ error: messageIsError }" role="status">{{ message }}</p>

    <aside v-if="editable && selectedFeature" class="ol-attrs" aria-label="Selected feature attributes">
      <h3>Attributes</h3>
      <p v-if="selectedKey === undefined" class="ol-note">
        This layer exposes no id, fid or gid attribute, so edits to this feature cannot be saved.
      </p>
      <p v-if="!attrRows.length" class="ol-note">No editable attributes.</p>
      <label v-for="row in attrRows" :key="row.key" class="ol-attr">
        <span>{{ row.key }}</span>
        <input v-model="row.value" type="text" @change="commitAttribute(row)" />
      </label>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, nextTick } from 'vue'
import { Feature, Map, View } from 'ol'
import { Tile as TileLayer, Vector as VectorLayer } from 'ol/layer'
import { OSM, Vector as VectorSource } from 'ol/source'
import { GeoJSON, TopoJSON } from 'ol/format'
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style'
import { Draw, Modify, Select, Snap } from 'ol/interaction'
import { defaults as defaultControls } from 'ol/control'
import { fromLonLat } from 'ol/proj'
import { getUid } from 'ol/util'
import type { Geometry } from 'ol/geom'
import 'ol/ol.css'
import api from '@/services/api'
import {
  EditTracker,
  buildTransactions,
  countKeylessEdits,
  editableProperties,
  featureKey,
  KEY_PROPERTIES,
  type EditedFeature,
  type PendingEdits,
} from '@/map/editorTransactions'

type Mode = 'select' | 'Point' | 'LineString' | 'Polygon'

interface Props {
  height?: number
  width?: number
  center?: [number, number]
  zoom?: number
  layers?: string[]
  editable?: boolean
  enableWfsT?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  height: undefined,
  width: undefined,
  center: () => [31.05, -18.93], // Zimbabwe center approx
  zoom: 7,
  layers: () => [],
  editable: false,
  enableWfsT: false,
})

const emit = defineEmits<{
  'feature-selected': [feature: Record<string, unknown>]
  'feature-changed': [feature: Record<string, unknown>]
  'features-saved': [summary: { layer: string; inserted: number; updated: number; deleted: number }[]]
  'dirty-change': [pending: number]
}>()

const tools: { mode: Mode; label: string }[] = [
  { mode: 'select', label: 'Select / modify' },
  { mode: 'Point', label: 'Draw point' },
  { mode: 'LineString', label: 'Draw line' },
  { mode: 'Polygon', label: 'Draw polygon' },
]

const sizeStyle = computed(() => ({
  height: props.height ? `${props.height}px` : '100%',
  width: props.width ? `${props.width}px` : '100%',
}))

const mapContainer = ref<HTMLDivElement | null>(null)
const mode = ref<Mode>('select')
const targetLayer = ref(props.layers[0] ?? '')
const pendingCount = ref(0)
const saving = ref(false)
const message = ref('')
const messageIsError = ref(false)
const selectedFeature = shallowRef<Feature<Geometry> | null>(null)
const attrRows = ref<{ key: string; value: string; numeric: boolean }[]>([])

let map: Map | null = null
let vectorSource: VectorSource | null = null
let vectorLayer: VectorLayer<VectorSource> | null = null
let drawInteraction: Draw | null = null
let modifyInteraction: Modify | null = null
let selectInteraction: Select | null = null
let snapInteraction: Snap | null = null
const tracker = new EditTracker()
const geojson = new GeoJSON()

const selectedKey = computed(() =>
  selectedFeature.value ? featureKey(selectedFeature.value.getProperties()) : undefined,
)

const defaultStyle = new Style({
  fill: new Fill({ color: 'rgba(255, 255, 255, 0.2)' }),
  stroke: new Stroke({ color: '#ffcc33', width: 2 }),
  image: new CircleStyle({
    radius: 7,
    fill: new Fill({ color: '#ffcc33' }),
    stroke: new Stroke({ color: '#ffffff', width: 2 }),
  }),
})

function say(text: string, isError = false) {
  message.value = text
  messageIsError.value = isError
}

function syncPending() {
  pendingCount.value = tracker.count
  emit('dirty-change', tracker.count)
}

const layerOf = (f: Feature<Geometry>) => String(f.get('_layer') ?? '')

onMounted(async () => {
  await nextTick()
  if (!mapContainer.value) return

  vectorSource = new VectorSource()
  vectorLayer = new VectorLayer({ source: vectorSource, style: defaultStyle, zIndex: 10 })

  map = new Map({
    target: mapContainer.value,
    layers: [new TileLayer({ source: new OSM(), zIndex: 0 }), vectorLayer],
    view: new View({ center: fromLonLat(props.center), zoom: props.zoom }),
    controls: defaultControls({ attribution: true, zoom: true }),
  })

  if (props.editable) setupEditing()
  loadLayers()
})

// Interactions are re-created whenever the tool changes. Snap must be the
// last interaction added, so it is rebuilt each time.
function setupEditing() {
  if (!map || !vectorSource || !vectorLayer) return

  selectInteraction = new Select({ layers: [vectorLayer] })
  selectInteraction.on('select', () => {
    const f = selectInteraction?.getFeatures().item(0) as Feature<Geometry> | undefined
    selectedFeature.value = f ?? null
    attrRows.value = f ? rowsFor(f) : []
    if (f) emit('feature-selected', f.getProperties())
  })

  modifyInteraction = new Modify({ source: vectorSource })
  modifyInteraction.on('modifyend', (event) => {
    event.features.forEach((f) => {
      const feature = f as Feature<Geometry>
      tracker.markModified(getUid(feature), layerOf(feature))
      emit('feature-changed', feature.getProperties())
    })
    syncPending()
  })

  applyMode()
}

function applyMode() {
  if (!map || !vectorSource || !selectInteraction || !modifyInteraction) return
  for (const i of [selectInteraction, modifyInteraction, drawInteraction, snapInteraction]) {
    if (i) map.removeInteraction(i)
  }
  drawInteraction = null

  if (mode.value === 'select') {
    map.addInteraction(selectInteraction)
    map.addInteraction(modifyInteraction)
  } else {
    selectInteraction.getFeatures().clear()
    selectedFeature.value = null
    attrRows.value = []
    drawInteraction = new Draw({ source: vectorSource, type: mode.value })
    drawInteraction.on('drawend', (event) => {
      const feature = event.feature as Feature<Geometry>
      feature.set('_layer', targetLayer.value)
      tracker.markCreated(getUid(feature), targetLayer.value)
      syncPending()
      emit('feature-changed', feature.getProperties())
    })
    map.addInteraction(drawInteraction)
  }
  snapInteraction = new Snap({ source: vectorSource })
  map.addInteraction(snapInteraction)
}

function setMode(next: Mode) {
  if (next !== 'select' && !targetLayer.value) {
    say('Choose a layer to draw into first.', true)
    return
  }
  say('')
  mode.value = next
  applyMode()
}

// ── attributes ────────────────────────────────────────────────────────────
function rowsFor(f: Feature<Geometry>) {
  const props = editableProperties(f.getProperties())
  return Object.entries(props)
    .filter(([k]) => !(KEY_PROPERTIES as readonly string[]).includes(k))
    .map(([key, v]) => ({ key, value: v === null ? '' : String(v), numeric: typeof v === 'number' }))
}

function commitAttribute(row: { key: string; value: string; numeric: boolean }) {
  const f = selectedFeature.value
  if (!f) return
  let value: string | number | null = row.value
  if (row.numeric) {
    value = row.value.trim() === '' ? null : Number(row.value)
    if (Number.isNaN(value)) {
      say(`"${row.key}" must be a number.`, true)
      row.value = f.get(row.key) === null ? '' : String(f.get(row.key))
      return
    }
  } else if (row.value === '') {
    value = null
  }
  say('')
  f.set(row.key, value)
  tracker.markModified(getUid(f), layerOf(f))
  syncPending()
  emit('feature-changed', f.getProperties())
}

// ── delete ────────────────────────────────────────────────────────────────
function deleteSelected() {
  const f = selectedFeature.value
  if (!f || !vectorSource || !selectInteraction) return
  tracker.markDeleted(getUid(f), layerOf(f), featureKey(f.getProperties()))
  selectInteraction.getFeatures().clear()
  vectorSource.removeFeature(f)
  selectedFeature.value = null
  attrRows.value = []
  syncPending()
}

// ── load ──────────────────────────────────────────────────────────────────
function parseFeatures(payload: any): Feature<Geometry>[] {
  const data = payload?.data ?? payload
  if (!data || !map) return []
  const options = { dataProjection: 'EPSG:4326', featureProjection: map.getView().getProjection() }
  if (Array.isArray(data.features)) {
    return geojson.readFeatures(data, options) as Feature<Geometry>[]
  }
  if (data.type === 'Topology') {
    // The backend's fallback embeds plain GeoJSON features under objects.collection.
    const embedded = data.objects?.collection?.features
    if (Array.isArray(embedded)) {
      return geojson.readFeatures({ type: 'FeatureCollection', features: embedded }, options) as Feature<Geometry>[]
    }
    return new TopoJSON().readFeatures(data, options) as Feature<Geometry>[]
  }
  return []
}

async function loadLayer(layerName: string) {
  if (!vectorSource) return
  try {
    const response = await api.get(`/ogc/wfs/features/${layerName}`, {
      params: { outputFormat: 'application/json', maxFeatures: 10000 },
    })
    const features = parseFeatures(response.data)
    features.forEach((f) => f.set('_layer', layerName))
    vectorSource.addFeatures(features)
  } catch (error) {
    console.error(`Failed to load layer ${layerName}:`, error)
    say(`Could not load layer "${layerName}".`, true)
  }
}

async function loadLayers() {
  if (!vectorSource || !map) return
  for (const layerName of props.layers) await loadLayer(layerName)
  const extent = vectorSource.getFeatures().length > 0 ? vectorSource.getExtent() : null
  if (extent) map.getView().fit(extent, { padding: [50, 50, 50, 50] })
}

// ── save / discard ────────────────────────────────────────────────────────
function snapshot(f: Feature<Geometry>): EditedFeature | null {
  const geom = f.getGeometry()
  if (!geom || !map) return null
  const props = f.getProperties()
  return {
    layer: layerOf(f),
    key: featureKey(props),
    properties: editableProperties(props),
    geometry: geojson.writeGeometryObject(geom, {
      dataProjection: 'EPSG:4326',
      featureProjection: map.getView().getProjection(),
    }) as EditedFeature['geometry'],
  }
}

function collectPending(): PendingEdits {
  const byUid: Record<string, Feature<Geometry>> = {}
  vectorSource?.getFeatures().forEach((f) => { byUid[getUid(f)] = f as Feature<Geometry> })
  const pick = (uids: string[]) =>
    uids.map((u) => byUid[u]).filter((f): f is Feature<Geometry> => !!f).map(snapshot).filter((e): e is EditedFeature => !!e)
  return {
    created: pick(tracker.createdUids()),
    modified: pick(tracker.modifiedUids()),
    deleted: tracker.deletedEntries(),
  }
}

function dropLayerFeatures(layerName: string) {
  if (!vectorSource) return
  vectorSource.getFeatures().filter((f) => layerOf(f as Feature<Geometry>) === layerName).forEach((f) => vectorSource!.removeFeature(f))
}

async function saveEdits() {
  if (!props.enableWfsT || !vectorSource || saving.value || !tracker.count) return
  const pending = collectPending()
  const keyless = countKeylessEdits(pending)
  if (keyless) {
    say(`${keyless} edited or deleted ${keyless === 1 ? 'feature has' : 'features have'} no id, fid or gid attribute and cannot be saved. Discard to start over.`, true)
    return
  }

  saving.value = true
  say('')
  const summary: { layer: string; inserted: number; updated: number; deleted: number }[] = []
  const failures: string[] = []
  selectInteraction?.getFeatures().clear()
  selectedFeature.value = null
  attrRows.value = []

  // One transaction per layer: a failure leaves that layer's edits pending.
  for (const tx of buildTransactions(pending)) {
    try {
      const res = await api.post('/ogc/wfs/transaction', tx)
      const d = res.data?.data ?? {}
      summary.push({ layer: tx.typeName, inserted: d.inserted ?? 0, updated: d.updated ?? 0, deleted: d.deleted ?? 0 })
      tracker.clearLayer(tx.typeName)
      // Reload so new rows pick up their database ids.
      dropLayerFeatures(tx.typeName)
      await loadLayer(tx.typeName)
    } catch (error: any) {
      failures.push(`${tx.typeName}: ${error?.response?.data?.error ?? error?.message ?? 'save failed'}`)
    }
  }

  saving.value = false
  syncPending()
  if (summary.length) emit('features-saved', summary)
  if (failures.length) {
    say(`Not saved — ${failures.join('; ')}. Nothing was changed on ${failures.length === 1 ? 'that layer' : 'those layers'}.`, true)
  } else {
    say('Changes saved.')
  }
}

async function discard() {
  if (!vectorSource || !tracker.count) return
  tracker.clear()
  selectInteraction?.getFeatures().clear()
  selectedFeature.value = null
  attrRows.value = []
  vectorSource.clear()
  await loadLayers()
  syncPending()
  say('Unsaved changes discarded.')
}

defineExpose({
  saveEdits,
  discard,
  setMode,
  hasPendingEdits: () => tracker.count > 0,
  clearSelection: () => {
    selectInteraction?.getFeatures().clear()
    selectedFeature.value = null
    attrRows.value = []
  },
  getFeatures: () => vectorSource?.getFeatures() || [],
})

onUnmounted(() => {
  if (map) {
    map.setTarget(undefined)
    map = null
  }
})
</script>

<style scoped>
.ol-editor {
  position: relative;
  min-height: 320px;
}
.ol-editor-map {
  width: 100%;
  height: 100%;
}
/* The planner view floats its own button over the top-left corner. */
.ol-editor :deep(.ol-zoom) {
  top: 48px;
}
.ol-toolbar {
  position: absolute;
  top: 8px;
  left: 190px;
  right: 8px;
  z-index: 15;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--login-surface, #fff);
  border: 1px solid var(--login-input-border, #e1e5e9);
  border-radius: var(--login-control-radius, 8px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  font-size: 13px;
  color: var(--login-label, #333);
}
.ol-field {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ol-field select {
  max-width: 180px;
  padding: 4px 6px;
  border: 1px solid var(--login-input-border, #e1e5e9);
  border-radius: 6px;
  background: var(--login-surface, #fff);
}
.ol-group {
  display: flex;
  gap: 4px;
}
.ol-btn {
  padding: 5px 10px;
  border: 1px solid var(--login-input-border, #e1e5e9);
  border-radius: 6px;
  background: var(--login-surface, #fff);
  color: var(--login-label, #333);
  font: inherit;
  cursor: pointer;
}
.ol-btn:hover:not(:disabled) {
  border-color: var(--login-accent, #0066cc);
}
.ol-btn:focus-visible,
.ol-field select:focus-visible,
.ol-attr input:focus-visible {
  outline: 2px solid var(--login-accent, #0066cc);
  outline-offset: 2px;
}
.ol-btn.active {
  border-color: var(--login-accent, #0066cc);
  background: var(--login-accent-ring, rgba(0, 102, 204, 0.1));
  color: var(--login-accent-dark, #0052a3);
}
.ol-btn.primary {
  background: var(--login-accent, #0066cc);
  border-color: var(--login-accent, #0066cc);
  color: #fff;
}
.ol-btn.danger {
  color: var(--login-error-fg, #cc3333);
}
.ol-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ol-pending {
  margin-left: auto;
  color: var(--login-muted, #666);
}
.ol-message {
  position: absolute;
  left: 8px;
  bottom: 28px;
  z-index: 15;
  max-width: min(520px, calc(100% - 16px));
  margin: 0;
  padding: 8px 12px;
  background: var(--login-surface, #fff);
  border: 1px solid var(--login-input-border, #e1e5e9);
  border-radius: var(--login-control-radius, 8px);
  font-size: 13px;
}
.ol-message.error {
  background: var(--login-error-bg, #fee);
  color: var(--login-error-fg, #c33);
  border-color: var(--login-error-fg, #c33);
}
.ol-attrs {
  position: absolute;
  top: 72px;
  right: 8px;
  z-index: 15;
  width: 240px;
  max-height: calc(100% - 140px);
  overflow-y: auto;
  padding: 10px 12px;
  background: var(--login-surface, #fff);
  border: 1px solid var(--login-input-border, #e1e5e9);
  border-radius: var(--login-control-radius, 8px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  font-size: 13px;
}
.ol-attrs h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--login-heading, #1a1a1a);
}
.ol-attr {
  display: block;
  margin-bottom: 8px;
}
.ol-attr span {
  display: block;
  margin-bottom: 2px;
  color: var(--login-muted, #666);
}
.ol-attr input {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--login-input-border, #e1e5e9);
  border-radius: 6px;
  font: inherit;
}
.ol-note {
  margin: 0 0 8px;
  color: var(--login-muted, #666);
}
@media (max-width: 640px) {
  .ol-toolbar {
    left: 8px;
    top: 48px;
  }
  .ol-attrs {
    top: auto;
    bottom: 64px;
    width: calc(100% - 16px);
    max-height: 40%;
  }
}
</style>
