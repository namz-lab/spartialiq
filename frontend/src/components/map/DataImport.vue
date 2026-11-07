<script setup lang="ts">
// ─────────────────────────────────────────────────────────────────────────
// DataImport — upload a GeoJSON / KML / zipped-shapefile from the browser,
// preview it on the map, then optionally save it to PostGIS. Removes the
// "everything must go through QGIS/ogr2ogr offline" bottleneck for officers.
//
// Parsing is client-side (importGeo.ts); the file is only sent to the backend
// (POST /api/gis/import) when the user clicks Save. Preview geometry lives in
// its own transient source ('gis-import') so it never touches the basemap.
// ─────────────────────────────────────────────────────────────────────────
import { ref, onBeforeUnmount } from 'vue'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import { Upload, X, Save, Trash2 } from 'lucide-vue-next'
import { parseGeoFile } from '@/map/tools/importGeo'
import { fitBounds as fitBoundsRM } from '@/map/tools/camera'
import api from '@/services/api'

const props = defineProps<{ map: any | null }>()

const open = ref(false)
const fileName = ref('')
const parsing = ref(false)
const error = ref('')
const count = ref(0)
const layerName = ref('')
const saving = ref(false)
const saveMsg = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

let parsed: any = null
const SRC = 'gis-import'

function ensureLayers(m: any) {
  if (!m || m.getSource(SRC)) return
  try {
    m.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    m.addLayer({
      id: 'gis-import-fill', type: 'fill', source: SRC, filter: ['==', '$type', 'Polygon'],
      paint: { 'fill-color': '#0b8043', 'fill-opacity': 0.18 },
    })
    m.addLayer({
      id: 'gis-import-line', type: 'line', source: SRC, filter: ['in', '$type', 'LineString', 'Polygon'],
      paint: { 'line-color': '#0b8043', 'line-width': 2 },
    })
    m.addLayer({
      id: 'gis-import-pts', type: 'circle', source: SRC, filter: ['==', '$type', 'Point'],
      paint: { 'circle-radius': 5, 'circle-color': '#0b8043', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
    })
  } catch {
    /* style not ready */
  }
}

function setData(fc: any) {
  const src = props.map?.getSource(SRC)
  if (src) src.setData(fc || { type: 'FeatureCollection', features: [] })
}

async function onFiles(files: FileList | null) {
  const file = files && files[0]
  if (!file) return
  error.value = ''
  saveMsg.value = ''
  parsing.value = true
  fileName.value = file.name
  try {
    const res = await parseGeoFile(file)
    parsed = res.featureCollection
    count.value = res.count
    if (!layerName.value) layerName.value = file.name.replace(/\.[^.]+$/, '').slice(0, 60)
    ensureLayers(props.map)
    setData(parsed)
    fitToData()
  } catch (e: any) {
    parsed = null
    count.value = 0
    error.value = e?.message || 'Could not read that file.'
    setData(null)
  } finally {
    parsing.value = false
  }
}

function fitToData() {
  if (!props.map || !parsed) return
  try {
    const b = turf.bbox(parsed) as [number, number, number, number]
    if (b.every((n) => Number.isFinite(n))) {
      fitBoundsRM(props.map, [[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 17 })
    }
  } catch {
    /* leave the view as-is */
  }
}

function clearImport() {
  parsed = null
  count.value = 0
  fileName.value = ''
  error.value = ''
  saveMsg.value = ''
  setData(null)
  if (fileInput.value) fileInput.value.value = ''
}

async function save() {
  if (!parsed || !parsed.features?.length) return
  saving.value = true
  saveMsg.value = ''
  try {
    const res = await api.post('/gis/import', {
      layer: (layerName.value || 'imported').trim().slice(0, 64),
      features: parsed.features,
    })
    const n = (res.data as any)?.inserted ?? parsed.features.length
    saveMsg.value = `Saved ${n} feature${n === 1 ? '' : 's'} to PostGIS.`
  } catch (e: any) {
    const code = e?.response?.status
    saveMsg.value =
      code === 401 || code === 403
        ? 'Sign in as a GIS officer or planner to save.'
        : code === 404 || code === 400
          ? 'Save endpoint not ready (apply migration 091). Preview still works.'
          : code === 413
            ? 'Too large to save in one go — split the file and retry.'
            : 'Could not save. The preview is still on the map.'
  } finally {
    saving.value = false
  }
}

onBeforeUnmount(() => {
  if (props.map) {
    try {
      for (const id of ['gis-import-fill', 'gis-import-line', 'gis-import-pts']) {
        if (props.map.getLayer(id)) props.map.removeLayer(id)
      }
      if (props.map.getSource(SRC)) props.map.removeSource(SRC)
    } catch {
      /* ignore */
    }
  }
})
</script>

<template>
  <div class="data-import" v-if="map">
    <button v-if="!open" class="import-launch" type="button" @click="open = true" aria-label="Import spatial data">
      <Upload :size="15" />
      <span>Import</span>
    </button>

    <div v-else class="import-panel" role="group" aria-label="Import spatial data">
      <div class="panel-head">
        <span class="panel-title">Import data</span>
        <button class="icon-btn" type="button" aria-label="Close" @click="open = false"><X :size="15" /></button>
      </div>
      <div class="panel-body">
        <input
          ref="fileInput"
          type="file"
          accept=".geojson,.json,.kml,.zip,.dxf"
          class="file-input"
          aria-label="Choose a spatial file"
          @change="onFiles(($event.target as HTMLInputElement).files)"
        />
        <p class="hint">GeoJSON, KML, DXF, or a zipped shapefile (.zip). Parsed in your browser — nothing uploads until you save.</p>

        <p v-if="parsing" class="hint">Reading {{ fileName }}…</p>
        <p v-if="error" class="hint error">{{ error }}</p>

        <div v-if="count" class="readout">
          <div class="readout-row"><span>Features</span><strong>{{ count }}</strong></div>
          <label class="field">
            <span>Layer name</span>
            <input v-model="layerName" class="text-input" type="text" maxlength="64" aria-label="Layer name" />
          </label>
        </div>

        <div v-if="count" class="btn-row">
          <button class="ghost-btn" type="button" @click="clearImport"><Trash2 :size="14" /> Remove</button>
          <button class="primary-btn" type="button" :disabled="saving" @click="save">
            <Save :size="14" /> {{ saving ? 'Saving…' : 'Save to PostGIS' }}
          </button>
        </div>
        <p v-if="saveMsg" class="hint">{{ saveMsg }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.data-import {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  font-family: inherit;
  color: #3c4043;
}
.import-launch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: #ffffff;
  border: 1px solid #dadce0;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.1);
  font-size: 13px;
  font-weight: 600;
  color: #3c4043;
  cursor: pointer;
}
.import-launch:hover { background: #f5f3ee; }
.import-launch:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }

.import-panel {
  width: min(280px, calc(100vw - 24px));
  background: #ffffff;
  border: 1px solid #dadce0;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.14);
  overflow: hidden;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid #eceff1;
}
.panel-title { font-size: 13px; font-weight: 600; }
.icon-btn { display: inline-flex; border: none; background: transparent; color: #5f6368; cursor: pointer; padding: 2px; border-radius: 6px; }
.icon-btn:hover { background: #f1f3f4; color: #202124; }
.panel-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }

.file-input { font-size: 12px; color: #3c4043; }
.field { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: #5f6368; margin-top: 6px; }
.text-input {
  flex: 1;
  min-width: 0;
  padding: 6px 9px;
  border: 1px solid #dadce0;
  border-radius: 8px;
  font-size: 13px;
  color: #202124;
}
.text-input:focus { outline: 2px solid #1a73e8; outline-offset: 0; border-color: #1a73e8; }

.hint { font-size: 11px; color: #5f6368; margin: 0; line-height: 1.4; }
.hint.error { color: #c5221f; }

.readout { background: #f8f9fa; border: 1px solid #eceff1; border-radius: 8px; padding: 8px 10px; }
.readout-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #5f6368; }
.readout-row strong { color: #202124; font-size: 13px; font-variant-numeric: tabular-nums; }

.btn-row { display: flex; gap: 6px; }
.ghost-btn, .primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.ghost-btn { border: 1px solid #dadce0; background: #fff; color: #3c4043; }
.ghost-btn:hover { background: #f1f3f4; }
.primary-btn { border: none; background: #1a73e8; color: #fff; flex: 1; justify-content: center; }
.primary-btn:disabled { opacity: 0.6; cursor: default; }
</style>
