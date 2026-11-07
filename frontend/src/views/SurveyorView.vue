<script setup lang="ts">
// Surveyor Console (/surveyor) — municipal GIS survey workspace, styled as
// a dark field instrument: graphite panels, instrument-amber readouts,
// monospace coordinates, a live cursor grid readout and a centre reticle.
// Survey tasks, the linked citizen application, GIS context, and findings
// capture all come from the backend (/surveyor/* — migration 080). No mock
// data: every panel has explicit loading / empty / error states.

import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSpatialStore } from '@/stores/spatial'
import { addVunguBasemap, setBasemapLayerVisible, DEFAULT_VISIBLE } from '@/map/vunguBasemap'
import { chipColorFor } from '@/map/vunguBasemapStyle'
import { escapeHtml } from '@/utils/escapeHtml'
import {
  useSurveyorTasks, TASK_TYPE_LABELS, STATUS_LABELS, recommendationLabel,
} from '@/composables/useSurveyorTasks'
import { surveyorApi } from '@/services/surveyor'
import type { SurveyRecommendation } from '@/services/surveyor'
import { wgs84ToPyx, type ZimZone } from '@/utils/zimZones'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import SurveyorToolsPanel from '@/views/SurveyorToolsPanel.vue'
import SpecialistReferralsInbox from '@/components/workflow/SpecialistReferralsInbox.vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Compass, Search, RefreshCw, LayoutDashboard, ChevronRight, Layers,
  MapPin, Ruler, ClipboardCheck, Send, Plus, AlertTriangle,
  Clock, MessageSquare, Inbox, Crosshair, FileText, Calculator,
} from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()
const spatialStore = useSpatialStore()
const survey = useSurveyorTasks()

// Surveying is done in SurveyPro: this opens the selected job there (a signed, single-use link; see docs/SURVEYPRO-INTEGRATION.md).
const launching = ref(false)
const launchMessage = ref('')
const launchLink = ref('')
async function openInSurveyPro(id: string) {
  launching.value = true; launchMessage.value = ''; launchLink.value = ''
  try {
    const { url } = await surveyorApi.launchInSurveyPro(id)
    const win = window.open(url, '_blank', 'noopener')
    if (!win) { launchLink.value = url; launchMessage.value = 'Your browser blocked the new tab. Use the link below.' }
    await survey.select(id)   // launching starts the job: refresh its status
    await survey.refresh()
  } catch (e: any) {
    const d = e?.response?.data
    launchMessage.value = d?.message || (d?.error === 'not_your_job' ? 'Only the surveyor this job is assigned to can open it in SurveyPro.' : d?.error === 'job_closed' ? 'This job is closed.' : 'Could not open the job in SurveyPro.')
  } finally { launching.value = false }
}

// ── Filters ─────────────────────────────────────────────────────────────────
const filters = reactive({ status: '', ward: '' })
function applyFilters() {
  survey.refresh({ status: filters.status || undefined, ward: filters.ward || undefined })
}

const leftCollapsed = ref(false)
const leftMode = ref<'tasks' | 'referrals'>('tasks')
const rightTab = ref<'context' | 'records' | 'comms' | 'tools'>('context')

// ── Instrument chrome: clock + live cursor grid readout ─────────────────────
const clock = ref('--:--:--')
let clockTimer: ReturnType<typeof setInterval> | null = null
function tickClock() {
  clock.value = new Date().toLocaleTimeString('en-GB', { hour12: false })
}

// Working Lo zone follows the selected task; defaults to Lo31.
const zone = computed<ZimZone>(() => {
  const z = survey.detail.value?.gauss_lo
  return (z === 25 || z === 27 || z === 29 || z === 31 || z === 33 ? z : 31) as ZimZone
})

const cursor = ref<{ lng: number; lat: number } | null>(null)
const cursorGrid = computed(() => {
  if (!cursor.value) return null
  const { y, x } = wgs84ToPyx(cursor.value.lng, cursor.value.lat, zone.value)
  return { y, x }
})
const mapZoom = ref(8)

// ── Map ──────────────────────────────────────────────────────────────────────
const mapContainer = ref<HTMLElement | null>(null)
const mapInstance = ref<any>(null)
const mapLoading = ref(true)
const layerVisibility = reactive<Record<string, boolean>>({})
const catalogHint = ref('')

const eoLayers = computed(() =>
  spatialStore.tileLayers.map(l => ({
    id: l.id, name: l.title, group: l.group.replace(/_/g, ' '),
    color: chipColorFor(l.id, l.geomType), type: l.geomType,
  })),
)
function toggleLayer(l: { id: string; name: string }) {
  const map = mapInstance.value
  if (!map) return
  spatialStore.toggleTileLayer(map, l.id)
  layerVisibility[l.id] = spatialStore.visibleTileLayers.has(l.id)
}

let taskMarkers: maplibregl.Marker[] = []
function renderTaskPins() {
  const map = mapInstance.value
  if (!map) return
  taskMarkers.forEach(m => m.remove())
  taskMarkers = []
  for (const t of survey.sorted.value) {
    if (t.lng == null || t.lat == null) continue
    const el = document.createElement('div')
    el.style.cssText = 'width:14px;height:14px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #10151b;cursor:pointer;box-shadow:0 0 0 1px rgba(240,178,74,.35),0 1px 4px rgba(0,0,0,.5)'
    el.style.background = t.status === 'submitted' ? '#48c78e'
      : t.priority === 'urgent' ? '#e5534b'
      : t.status === 'in_progress' ? '#58a6ff' : '#f0b24a'
    const popup = new maplibregl.Popup({ offset: 16, closeButton: true }).setHTML(
      `<div style="font-family:ui-monospace,monospace;font-size:12px">
         <div style="font-weight:700">${escapeHtml(t.stand_number || t.applicant_name || 'Survey task')}</div>
         <div>${escapeHtml(TASK_TYPE_LABELS[t.task_type] || t.task_type)}</div>
         <div style="color:#8b98a9;font-size:11px;margin-top:3px">${escapeHtml(t.suburb_ward || '')} · ${escapeHtml(STATUS_LABELS[t.status] || t.status)}</div>
       </div>`)
    const m = new maplibregl.Marker({ element: el }).setLngLat([t.lng, t.lat]).setPopup(popup).addTo(map)
    el.addEventListener('click', () => openTask(t.id))
    taskMarkers.push(m)
  }
}
watch(() => survey.sorted.value, () => renderTaskPins())

function flyToTask(t: { lng: number | null; lat: number | null }) {
  if (mapInstance.value && t.lng != null && t.lat != null) {
    mapInstance.value.flyTo({ center: [t.lng, t.lat], zoom: 15, duration: 800 })
  }
}

// ── Task selection + detail ──────────────────────────────────────────────────
async function openTask(id: string) {
  await survey.select(id)
  rightTab.value = 'context'
  if (survey.detail.value) flyToTask(survey.detail.value)
}

// ── Findings / records / comments forms ──────────────────────────────────────
const finding = reactive({ summary: '', recommendation: '' as '' | SurveyRecommendation, conditions: '', notes: '' })
async function submitFinding() {
  const d = survey.detail.value
  if (!d || !finding.summary.trim()) return
  await survey.submitFinding(d.id, {
    summary: finding.summary.trim(),
    recommendation: finding.recommendation || undefined,
    conditions: finding.conditions || undefined,
    notes: finding.notes || undefined,
  })
  finding.summary = ''; finding.recommendation = ''; finding.conditions = ''; finding.notes = ''
}

const coord = reactive({ label: '', longitude: '', latitude: '', coord_system: 'WGS84' })
async function addCoordinate() {
  const d = survey.detail.value
  if (!d) return
  await survey.addCoordinate(d.id, {
    label: coord.label || null, coord_system: coord.coord_system,
    longitude: coord.longitude === '' ? null : Number(coord.longitude),
    latitude: coord.latitude === '' ? null : Number(coord.latitude),
  })
  coord.label = ''; coord.longitude = ''; coord.latitude = ''
}

const beacon = reactive({ corner_label: '', beacon_type: 'iron_peg', status: 'intact' })
async function addBeacon() {
  const d = survey.detail.value
  if (!d) return
  await survey.addBeacon(d.id, { corner_label: beacon.corner_label || null, beacon_type: beacon.beacon_type, status: beacon.status })
  beacon.corner_label = ''
}

const commentBody = ref('')
async function postComment() {
  const d = survey.detail.value
  if (!d || !commentBody.value.trim()) return
  await survey.addComment(d.id, commentBody.value.trim())
  commentBody.value = ''
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function handleLogout() { authStore.logout(); router.push('/login') }

onMounted(async () => {
  tickClock()
  clockTimer = setInterval(tickClock, 1000)
  survey.refresh()
  spatialStore.loadTileLayers().then(() => {
    for (const l of spatialStore.tileLayers) {
      if (layerVisibility[l.id] === undefined) {
        layerVisibility[l.id] = DEFAULT_VISIBLE.has(l.id)
      }
    }
    catalogHint.value = spatialStore.tileLayers.length
      ? ''
      : 'Tile catalog returned no layers. Confirm the backend is running.'
  }).catch((e: any) => {
    catalogHint.value = e?.message || 'Could not load the tile catalog.'
  })
  if (!mapContainer.value) return
  const blankStyle = {
    version: 8 as const,
    sources: {},
    layers: [{ id: 'background', type: 'background' as const, paint: { 'background-color': '#171d24' } }],
    glyphs: '/fonts/{fontstack}/{range}.pbf',
  }
  // @ts-ignore
  mapInstance.value = new maplibregl.Map({
    container: mapContainer.value, style: blankStyle as any,
    center: [29.65, -19.45], zoom: 8, minZoom: 1, maxZoom: 22, attributionControl: false,
  })
  // @ts-ignore
  mapInstance.value.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
  // When offline (or the glyph CDN is blocked) the external label-font fetches
  // flood the console with MapLibre error events. The local PostGIS geometry
  // still renders; swallow network/glyph/tile fetch errors and surface only
  // unexpected ones.
  mapInstance.value.on('error', (e: any) => {
    const msg = e?.error?.message ?? ''
    if (!/fetch|network|ajax|load|glyph|tile|font|ERR_|unimplemented type/i.test(msg)) console.warn('[surveyor map]', msg)
  })
  mapInstance.value.on('mousemove', (e: any) => {
    cursor.value = { lng: e.lngLat.lng, lat: e.lngLat.lat }
  })
  mapInstance.value.on('zoomend', () => { mapZoom.value = mapInstance.value.getZoom() })
  mapInstance.value.on('load', () => {
    addVunguBasemap(mapInstance.value)
    DEFAULT_VISIBLE.forEach(id => { layerVisibility[id] = true })
    mapLoading.value = false
    renderTaskPins()
  })
})
onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
  mapInstance.value?.remove()
})

// keep a no-op reference so the imported helper is retained for future
// per-layer control without a lint error if unused above.
void setBasemapLayerVisible
</script>

<template>
  <div class="sv-root">
    <!-- ══ INSTRUMENT HEADER ══ -->
    <header class="sv-header">
      <div class="sv-brand">
        <div class="sv-icon"><Compass :size="15" /></div>
        <div>
          <span class="sv-title">Survey Console</span>
          <span class="sv-sub">Vungu RDC · Land Survey Division</span>
        </div>
      </div>

      <div class="sv-instrument">
        <span class="sv-led" :class="{ err: !!survey.error.value }"></span>
        <span class="sv-inst-item">{{ survey.error.value ? 'LINK DOWN' : 'ONLINE' }}</span>
        <span class="sv-inst-sep"></span>
        <span class="sv-inst-item">LO{{ zone }}</span>
        <span class="sv-inst-sep"></span>
        <span class="sv-inst-item">Z{{ mapZoom.toFixed(1) }}</span>
        <span class="sv-inst-sep"></span>
        <span class="sv-inst-item sv-clock">{{ clock }}</span>
      </div>

      <button class="sv-btn" @click="applyFilters" :disabled="survey.loading.value">
        <RefreshCw :size="13" :class="{ 'spin-icon': survey.loading.value }" /><span>Refresh</span>
      </button>
      <button class="sv-btn" @click="router.push('/surveyor/jobs')" title="The council's survey job queue">
        <LayoutDashboard :size="13" /><span>Job queue</span>
      </button>
      <ProfileDropdown role-label="Surveyor" avatar-key="surveyor_avatar" @logout="handleLogout" />
    </header>

    <div class="sv-workspace">
      <!-- ┌── LEFT: Task queue ──┐ -->
      <aside class="sv-left" :class="{ collapsed: leftCollapsed, wide: leftMode === 'referrals' && !leftCollapsed }">
        <button class="sv-collapse" @click="leftCollapsed = !leftCollapsed">
          <ChevronRight :size="14" :class="{ 'rotate-180': !leftCollapsed }" />
        </button>
        <div v-show="!leftCollapsed" class="sv-left-body">
          <div class="sv-rail-tabs">
            <button type="button" :class="{ active: leftMode === 'tasks' }" @click="leftMode = 'tasks'">Tasks</button>
            <button type="button" :class="{ active: leftMode === 'referrals' }" @click="leftMode = 'referrals'">Referrals</button>
          </div>

          <div v-if="leftMode === 'referrals'" class="sv-referrals">
            <SpecialistReferralsInbox
              :department-needles="['survey', 'surveyor', 'cadastral']"
              heading="Survey referrals"
              empty-next-step="No survey referrals in technical circulation. Files appear here when the planner or EO circulates a case to Survey."
            />
          </div>
          <div v-else class="sv-task-pane">
          <!-- KPIs -->
          <div class="sv-kpis">
            <div class="sv-kpi"><span class="sv-kpi-val">{{ survey.kpis.value.open }}</span><span class="sv-kpi-lbl">Open</span></div>
            <div class="sv-kpi"><span class="sv-kpi-val accent">{{ survey.kpis.value.inProgress }}</span><span class="sv-kpi-lbl">Active</span></div>
            <div class="sv-kpi"><span class="sv-kpi-val warn">{{ survey.kpis.value.unclaimed }}</span><span class="sv-kpi-lbl">Unclaimed</span></div>
          </div>

          <!-- Filters -->
          <div class="sv-filters">
            <select v-model="filters.status" @change="applyFilters" class="sv-input">
              <option value="">All statuses</option>
              <option v-for="(label, key) in STATUS_LABELS" :key="key" :value="key">{{ label }}</option>
            </select>
            <div class="sv-search">
              <Search :size="12" />
              <input v-model="filters.ward" @keydown.enter="applyFilters" class="sv-input" placeholder="Filter by ward…" />
            </div>
          </div>

          <!-- States + list -->
          <div v-if="survey.loading.value" class="sv-state"><RefreshCw :size="16" class="spin-icon" /> Loading tasks…</div>
          <div v-else-if="survey.error.value" class="sv-state error">
            <AlertTriangle :size="16" /> {{ survey.error.value }}
            <button class="sv-link" @click="applyFilters">Retry</button>
          </div>
          <div v-else-if="!survey.sorted.value.length" class="sv-state">
            <Inbox :size="20" /><p>No survey tasks assigned.</p>
            <span>Planners and EO Planners assign tasks from an application, or open Referrals for technical-circulation files.</span>
          </div>
          <div v-else class="sv-task-list">
            <button v-for="t in survey.sorted.value" :key="t.id"
              class="sv-task" :class="{ active: survey.detail.value?.id === t.id, [t.priority]: true }"
              @click="openTask(t.id)">
              <div class="sv-task-top">
                <span class="sv-task-type">{{ TASK_TYPE_LABELS[t.task_type] || t.task_type }}</span>
                <span class="sv-chip" :class="t.status">{{ STATUS_LABELS[t.status] || t.status }}</span>
              </div>
              <div class="sv-task-stand">Stand {{ t.stand_number || '—' }} · {{ t.suburb_ward || 'Unassigned ward' }}</div>
              <div class="sv-task-meta">
                <span>{{ t.applicant_name || 'No applicant' }}</span>
                <span v-if="t.assigned_to == null" class="sv-unclaimed">Unclaimed</span>
                <span v-if="t.due_date">· due {{ fmtDate(t.due_date) }}</span>
              </div>
            </button>
          </div>
          </div>
        </div>
      </aside>

      <!-- ┌── CENTER: Map ──┐ -->
      <div class="sv-center">
        <div class="sv-map-wrap">
          <div ref="mapContainer" class="sv-map"></div>
          <div class="sv-reticle" aria-hidden="true"></div>
          <div v-if="mapLoading" class="sv-map-overlay"><RefreshCw :size="18" class="spin-icon" /><span>Loading basemap…</span></div>

          <!-- GIS layer panel -->
          <div class="sv-layers">
            <div class="sv-layers-head"><Layers :size="12" /> GIS layers
              <span v-if="spatialStore.isLoading" class="sv-mini">loading…</span>
            </div>
            <div v-if="spatialStore.error" class="sv-mini">{{ spatialStore.error }}</div>
            <div v-else-if="catalogHint" class="sv-mini">{{ catalogHint }}</div>
            <div v-else-if="!eoLayers.length && !spatialStore.isLoading" class="sv-mini">No layers available</div>
            <label v-for="l in eoLayers" :key="l.id" class="sv-layer">
              <input type="checkbox" :checked="layerVisibility[l.id]" @change="toggleLayer(l)" />
              <span class="sv-dot" :style="{ background: l.color }"></span>
              <span class="sv-layer-name">{{ l.name }}</span>
            </label>
          </div>

          <!-- Live cursor grid readout -->
          <div class="sv-readout" v-if="cursorGrid && cursor">
            <span class="sv-ro-label">LO{{ zone }}</span>
            <span class="sv-ro-val">Y {{ cursorGrid.y.toFixed(2) }}</span>
            <span class="sv-ro-val">X {{ cursorGrid.x.toFixed(2) }}</span>
            <span class="sv-ro-sep"></span>
            <span class="sv-ro-label">WGS84</span>
            <span class="sv-ro-val">{{ cursor.lng.toFixed(6) }}</span>
            <span class="sv-ro-val">{{ cursor.lat.toFixed(6) }}</span>
          </div>
          <div class="sv-readout idle" v-else>
            <span class="sv-ro-label">LO{{ zone }}</span>
            <span class="sv-ro-val">move cursor over map for grid readout</span>
          </div>
        </div>
      </div>

      <!-- ┌── RIGHT: Task detail ──┐ -->
      <aside class="sv-right">
        <div v-if="survey.detailLoading.value" class="sv-state"><RefreshCw :size="16" class="spin-icon" /> Loading task…</div>
        <div v-else-if="!survey.detail.value" class="sv-state">
          <ClipboardCheck :size="20" /><p>Select a survey task</p>
          <span>Its application, GIS context, capture tools and COGO toolkit appear here.</span>
        </div>
        <div v-else class="sv-detail">
          <!-- Task header + status actions -->
          <div class="sv-detail-head">
            <div>
              <div class="sv-detail-type">{{ TASK_TYPE_LABELS[survey.detail.value.task_type] || survey.detail.value.task_type }}</div>
              <div class="sv-detail-stand">Stand {{ survey.detail.value.stand_number || '—' }} · {{ survey.detail.value.suburb_ward || '—' }}</div>
            </div>
            <span class="sv-chip" :class="survey.detail.value.status">{{ STATUS_LABELS[survey.detail.value.status] || survey.detail.value.status }}</span>
          </div>
          <div class="sv-actions">
            <button v-if="survey.detail.value.assigned_to == null" class="sv-btn primary" :disabled="survey.busy.value"
              @click="survey.claim(survey.detail.value.id)"><Crosshair :size="13" /> Claim</button>
            <button v-if="['assigned','returned'].includes(survey.detail.value.status)" class="sv-btn" :disabled="survey.busy.value"
              @click="survey.setStatus(survey.detail.value.id, 'in_progress')"><Clock :size="13" /> Start</button>
            <button v-if="survey.detail.value.lat != null" class="sv-btn" @click="flyToTask(survey.detail.value)"><MapPin :size="13" /> Locate</button>
            <button v-if="survey.detail.value.assigned_to != null && !['cancelled','accepted'].includes(survey.detail.value.status)" class="sv-btn primary"
              :disabled="launching" @click="openInSurveyPro(survey.detail.value.id)"><Ruler :size="13" /> Survey in SurveyPro</button>
          </div>
          <p v-if="launchMessage" class="sv-note" role="status">{{ launchMessage }} <a v-if="launchLink" :href="launchLink" target="_blank" rel="noopener">Open SurveyPro</a></p>

          <!-- Tabs -->
          <div class="sv-tabs">
            <button :class="{ active: rightTab === 'context' }" @click="rightTab = 'context'"><FileText :size="12" /> Application</button>
            <button :class="{ active: rightTab === 'records' }" @click="rightTab = 'records'"><Ruler :size="12" /> Capture</button>
            <button :class="{ active: rightTab === 'tools' }" @click="rightTab = 'tools'"><Calculator :size="12" /> COGO</button>
            <button :class="{ active: rightTab === 'comms' }" @click="rightTab = 'comms'"><MessageSquare :size="12" /> Comms</button>
          </div>

          <!-- Application context + findings -->
          <div v-show="rightTab === 'context'" class="sv-pane">
            <div class="sv-card">
              <header>Citizen application</header>
              <div class="sv-kv"><span>Applicant</span><strong>{{ survey.detail.value.applicant_name || '—' }}</strong></div>
              <div class="sv-kv"><span>Type</span><strong>{{ survey.detail.value.development_type || '—' }}</strong></div>
              <div class="sv-kv"><span>Register</span><strong>{{ survey.detail.value.dev_register_no || survey.detail.value.tpd_reference || '—' }}</strong></div>
              <div class="sv-kv"><span>App. status</span><strong>{{ survey.detail.value.application_status || '—' }}</strong></div>
              <p v-if="survey.detail.value.application_description" class="sv-desc">{{ survey.detail.value.application_description }}</p>
              <p v-if="survey.detail.value.instructions" class="sv-instr"><strong>Instructions:</strong> {{ survey.detail.value.instructions }}</p>
              <a v-if="survey.detail.value.site_plan_url" :href="survey.detail.value.site_plan_url" target="_blank" rel="noopener" class="sv-link sv-link-pad">Open site plan</a>
            </div>

            <div class="sv-card">
              <header>Findings <span v-if="survey.detail.value.findings.length" class="sv-mini">{{ survey.detail.value.findings.length }}</span></header>
              <div v-if="!survey.detail.value.findings.length" class="sv-mini pad">No findings submitted yet.</div>
              <div v-for="f in survey.detail.value.findings" :key="f.id" class="sv-finding">
                <div class="sv-finding-rec">{{ recommendationLabel(f.recommendation) }}</div>
                <div class="sv-finding-sum">{{ f.summary }}</div>
                <div v-if="f.conditions" class="sv-mini">Conditions: {{ f.conditions }}</div>
                <div class="sv-mini">{{ fmtDate(f.submitted_at) }}</div>
              </div>
              <!-- Submit finding -->
              <div class="sv-form">
                <textarea v-model="finding.summary" rows="2" class="sv-input" placeholder="Findings summary…"></textarea>
                <select v-model="finding.recommendation" class="sv-input">
                  <option value="">Recommendation…</option>
                  <option value="no_objection">No objection</option>
                  <option value="objection">Objection</option>
                  <option value="approve">Approve</option>
                  <option value="approve_conditions">Approve with conditions</option>
                  <option value="refuse">Refuse</option>
                  <option value="refer_back">Refer back</option>
                </select>
                <input v-model="finding.conditions" class="sv-input" placeholder="Conditions (optional)" />
                <button class="sv-btn primary" :disabled="survey.busy.value || !finding.summary.trim()" @click="submitFinding">
                  <Send :size="13" /> Submit findings to Planner / EO
                </button>
              </div>
            </div>
          </div>

          <!-- Capture: coordinates + beacons -->
          <div v-show="rightTab === 'records'" class="sv-pane">
            <div class="sv-card">
              <header>Coordinates <span v-if="survey.detail.value.coordinates.length" class="sv-mini">{{ survey.detail.value.coordinates.length }}</span></header>
              <div v-if="!survey.detail.value.coordinates.length" class="sv-mini pad">No coordinates recorded.</div>
              <div v-for="c in survey.detail.value.coordinates" :key="c.id" class="sv-row">
                <strong>{{ c.label || '—' }}</strong>
                <span class="sv-num">{{ c.coord_system }}: {{ c.longitude ?? c.easting }}, {{ c.latitude ?? c.northing }}</span>
              </div>
              <div class="sv-form sv-form-row">
                <input v-model="coord.label" class="sv-input" placeholder="Label (e.g. NE)" />
                <input v-model="coord.longitude" class="sv-input" placeholder="Lng" />
                <input v-model="coord.latitude" class="sv-input" placeholder="Lat" />
                <button class="sv-btn" :disabled="survey.busy.value" @click="addCoordinate"><Plus :size="13" /></button>
              </div>
            </div>
            <div class="sv-card">
              <header>Beacons <span v-if="survey.detail.value.beacons.length" class="sv-mini">{{ survey.detail.value.beacons.length }}</span></header>
              <div v-if="!survey.detail.value.beacons.length" class="sv-mini pad">No beacons recorded.</div>
              <div v-for="b in survey.detail.value.beacons" :key="b.id" class="sv-row">
                <strong>{{ b.corner_label || '—' }}</strong>
                <span>{{ b.beacon_type.replace(/_/g, ' ') }} · {{ b.status }}</span>
              </div>
              <div class="sv-form sv-form-row">
                <input v-model="beacon.corner_label" class="sv-input" placeholder="Corner" />
                <select v-model="beacon.beacon_type" class="sv-input">
                  <option value="iron_peg">Iron peg</option>
                  <option value="concrete_beacon">Concrete</option>
                  <option value="survey_nail">Nail</option>
                  <option value="witness_beacon">Witness</option>
                </select>
                <select v-model="beacon.status" class="sv-input">
                  <option value="intact">Intact</option>
                  <option value="missing">Missing</option>
                  <option value="damaged">Damaged</option>
                  <option value="replaced">Replaced</option>
                </select>
                <button class="sv-btn" :disabled="survey.busy.value" @click="addBeacon"><Plus :size="13" /></button>
              </div>
            </div>
          </div>

          <!-- Comms thread -->
          <div v-show="rightTab === 'comms'" class="sv-pane">
            <div class="sv-card">
              <header>Discussion with Planner / EO</header>
              <div v-if="!survey.detail.value.comments.length" class="sv-mini pad">No messages yet.</div>
              <div v-for="m in survey.detail.value.comments" :key="m.id" class="sv-comment">
                <div class="sv-comment-head">{{ m.author_role || 'user' }} · {{ fmtDate(m.created_at) }}</div>
                <div>{{ m.body }}</div>
              </div>
              <div class="sv-form">
                <textarea v-model="commentBody" rows="2" class="sv-input" placeholder="Ask the planner for clarification…"></textarea>
                <button class="sv-btn primary" :disabled="survey.busy.value || !commentBody.trim()" @click="postComment"><Send :size="13" /> Send</button>
              </div>
            </div>
          </div>

          <!-- Survey tools (COGO, parcels, plan, documents, control points) -->
          <div v-show="rightTab === 'tools'" class="sv-pane">
            <SurveyorToolsPanel
              :task-id="survey.detail.value.id"
              :gauss-lo="survey.detail.value.gauss_lo"
              :stand-number="survey.detail.value.stand_number"
              :suburb-ward="survey.detail.value.suburb_ward"
              :task-type="survey.detail.value.task_type"
            />
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* ── Field-instrument theme tokens ─────────────────────────────────── */
.sv-root {
  --sv-bg: #0e1319;         /* app background */
  --sv-panel: #131920;      /* side panels */
  --sv-raised: #1a212b;     /* cards, inputs */
  --sv-line: #242e3a;       /* borders */
  --sv-line-soft: #1d2530;
  --sv-text: #dbe4ee;
  --sv-text-dim: #8b98a9;
  --sv-text-faint: #5c6875;
  --sv-amber: #f0b24a;      /* instrument accent */
  --sv-amber-dim: rgba(240, 178, 74, 0.14);
  --sv-green: #48c78e;
  --sv-blue: #58a6ff;
  --sv-red: #e5534b;
  --sv-mono: 'Geist Mono', ui-monospace, SFMono-Regular, monospace;

  display: flex; flex-direction: column; height: var(--ent-vh);
  background: var(--sv-bg); color: var(--sv-text); font-size: 0.875rem;
}

/* ── Header ────────────────────────────────────────────────────────── */
.sv-header {
  display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 1rem;
  background: var(--sv-panel); border-bottom: 1px solid var(--sv-line); flex-shrink: 0;
}
.sv-brand { display: flex; align-items: center; gap: 0.55rem; }
.sv-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1.9rem; height: 1.9rem; border-radius: 0.4rem;
  background: var(--sv-amber-dim); color: var(--sv-amber);
  border: 1px solid rgba(240, 178, 74, 0.3);
}
.sv-title { display: block; font-size: 0.8rem; font-weight: 700; line-height: 1.1; letter-spacing: 0.04em; text-transform: uppercase; }
.sv-sub { display: block; font-size: 0.62rem; color: var(--sv-text-dim); }

.sv-instrument {
  display: flex; align-items: center; gap: 0.55rem; margin: 0 auto;
  padding: 0.3rem 0.75rem; border: 1px solid var(--sv-line); border-radius: 0.4rem;
  background: #0b0f14; font-family: var(--sv-mono); font-size: 0.66rem;
  color: var(--sv-amber); letter-spacing: 0.08em;
}
.sv-inst-item { white-space: nowrap; }
.sv-inst-sep { width: 1px; height: 0.85rem; background: var(--sv-line); }
.sv-clock { min-width: 4.4rem; text-align: right; }
.sv-led {
  width: 0.45rem; height: 0.45rem; border-radius: 50%;
  background: var(--sv-green); box-shadow: 0 0 6px var(--sv-green);
}
.sv-led.err { background: var(--sv-red); box-shadow: 0 0 6px var(--sv-red); }

.sv-btn {
  display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.4rem 0.7rem;
  border: 1px solid var(--sv-line); border-radius: 0.4rem;
  background: var(--sv-raised); color: var(--sv-text); font-size: 0.7rem; cursor: pointer;
}
.sv-btn:hover { border-color: var(--sv-text-faint); }
.sv-btn.primary { background: var(--sv-amber); color: #10151b; border-color: var(--sv-amber); font-weight: 600; }
.sv-btn.primary:hover { filter: brightness(1.08); }
.sv-btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* ── Layout ────────────────────────────────────────────────────────── */
.sv-workspace { flex: 1; min-height: 0; display: flex; overflow: hidden; }
.sv-left {
  width: 20rem; background: var(--sv-panel); border-right: 1px solid var(--sv-line);
  display: flex; overflow: hidden; flex-shrink: 0; transition: width 0.2s; position: relative;
}
.sv-left.collapsed { width: 1.5rem; }
.sv-left.wide { width: min(44rem, 55vw); }
.sv-collapse {
  position: absolute; top: 0.5rem; right: 0.25rem; z-index: 2;
  border: 1px solid var(--sv-line); border-radius: 0.3rem; background: var(--sv-raised);
  color: var(--sv-text-dim); cursor: pointer;
}
.rotate-180 { transform: rotate(180deg); }
.sv-left-body { flex: 1; overflow-y: auto; padding: 0.6rem; display: flex; flex-direction: column; gap: 0.6rem; }

.sv-rail-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 0.25rem; }
.sv-rail-tabs button {
  border: 1px solid var(--sv-line); border-radius: 0.35rem; background: var(--sv-raised);
  color: var(--sv-text-dim); font-size: 0.68rem; padding: 0.35rem 0.4rem; cursor: pointer;
}
.sv-rail-tabs button.active { color: var(--sv-amber); border-color: var(--sv-amber); }
.sv-rail-tabs button:focus-visible { outline: 2px solid var(--sv-amber); outline-offset: 2px; }
.sv-referrals {
  flex: 1; min-height: 0; overflow: auto;
  background: #f5f3ee; border-radius: 0.4rem; color: #1a1a1a;
}
.sv-referrals :deep(.sri) { padding: 0.55rem; }
.sv-referrals :deep(.sri-body) { grid-template-columns: minmax(12rem, 16rem) 1fr; min-height: 16rem; }
.sv-referrals :deep(.sri-head h2) { color: #1a1a1a; }
.sv-task-pane { display: flex; flex-direction: column; gap: 0.6rem; flex: 1; min-height: 0; }

/* KPIs */
.sv-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.4rem; }
.sv-kpi { background: var(--sv-raised); border: 1px solid var(--sv-line); border-radius: 0.4rem; padding: 0.45rem 0.4rem; text-align: center; }
.sv-kpi-val { display: block; font-size: 1.15rem; font-weight: 700; font-family: var(--sv-mono); }
.sv-kpi-val.accent { color: var(--sv-blue); }
.sv-kpi-val.warn { color: var(--sv-amber); }
.sv-kpi-lbl { display: block; font-size: 0.55rem; color: var(--sv-text-dim); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 0.1rem; }

/* Filters */
.sv-filters { display: flex; flex-direction: column; gap: 0.35rem; }
.sv-search { display: flex; align-items: center; gap: 0.3rem; border: 1px solid var(--sv-line); border-radius: 0.4rem; padding: 0 0.4rem; color: var(--sv-text-faint); background: var(--sv-raised); }
.sv-search .sv-input { border: none; padding: 0.35rem 0; background: transparent; }
.sv-input {
  width: 100%; border: 1px solid var(--sv-line); border-radius: 0.4rem; padding: 0.35rem 0.5rem;
  font-size: 0.72rem; background: var(--sv-raised); color: var(--sv-text); box-sizing: border-box;
}
.sv-input:focus { outline: none; border-color: var(--sv-amber); }
.sv-input::placeholder { color: var(--sv-text-faint); }

/* States */
.sv-state { padding: 1.25rem; text-align: center; color: var(--sv-text-faint); font-size: 0.75rem; display: flex; flex-direction: column; align-items: center; gap: 0.35rem; }
.sv-state.error { color: var(--sv-red); }
.sv-state p { margin: 0; font-weight: 600; color: var(--sv-text-dim); }
.sv-state span { font-size: 0.65rem; }
.sv-link { background: none; border: none; color: var(--sv-amber); cursor: pointer; font-size: 0.72rem; text-decoration: underline; padding: 0; }
.sv-link-pad { display: inline-block; margin: 0.3rem 0.7rem; }

/* Task queue */
.sv-task-list { display: flex; flex-direction: column; gap: 0.4rem; }
.sv-task {
  text-align: left; background: var(--sv-raised); border: 1px solid var(--sv-line);
  border-left: 3px solid var(--sv-text-faint); border-radius: 0.4rem; padding: 0.5rem 0.6rem;
  cursor: pointer; color: var(--sv-text);
}
.sv-task:hover { border-color: var(--sv-text-faint); }
.sv-task.active { border-color: var(--sv-amber); background: var(--sv-amber-dim); }
.sv-task.urgent { border-left-color: var(--sv-red); }
.sv-task.high { border-left-color: var(--sv-amber); }
.sv-task-top { display: flex; justify-content: space-between; align-items: center; gap: 0.3rem; }
.sv-task-type { font-weight: 600; font-size: 0.72rem; }
.sv-task-stand { font-size: 0.68rem; color: var(--sv-text-dim); margin-top: 0.15rem; font-family: var(--sv-mono); }
.sv-task-meta { font-size: 0.6rem; color: var(--sv-text-faint); margin-top: 0.2rem; display: flex; gap: 0.3rem; flex-wrap: wrap; }
.sv-unclaimed { color: var(--sv-amber); font-weight: 600; }

/* Status chips */
.sv-chip {
  font-size: 0.56rem; font-weight: 600; padding: 0.12rem 0.4rem; border-radius: 0.25rem;
  background: var(--sv-line-soft); color: var(--sv-text-dim);
  text-transform: uppercase; letter-spacing: 0.05em; font-family: var(--sv-mono);
}
.sv-chip.in_progress { background: rgba(88, 166, 255, 0.15); color: var(--sv-blue); }
.sv-chip.submitted { background: rgba(72, 199, 142, 0.15); color: var(--sv-green); }
.sv-chip.assigned { background: var(--sv-amber-dim); color: var(--sv-amber); }
.sv-chip.returned { background: rgba(229, 83, 75, 0.15); color: var(--sv-red); }

/* ── Map ───────────────────────────────────────────────────────────── */
.sv-center { flex: 1; min-width: 0; position: relative; }
.sv-map-wrap { position: absolute; inset: 0; }
.sv-map { position: absolute; inset: 0; }
.sv-map-overlay {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 0.4rem; background: var(--sv-bg); color: var(--sv-text-dim); font-size: 0.78rem;
}
/* Centre reticle: fine crosshair, never intercepts the mouse */
.sv-reticle { position: absolute; left: 50%; top: 50%; width: 26px; height: 26px; transform: translate(-50%, -50%); pointer-events: none; opacity: 0.55; }
.sv-reticle::before, .sv-reticle::after { content: ''; position: absolute; background: var(--sv-amber); }
.sv-reticle::before { left: 50%; top: 0; width: 1px; height: 100%; transform: translateX(-0.5px); }
.sv-reticle::after { top: 50%; left: 0; height: 1px; width: 100%; transform: translateY(-0.5px); }

.sv-layers {
  position: absolute; top: 0.6rem; left: 0.6rem; width: 13rem; max-height: 60%; overflow-y: auto;
  background: rgba(19, 25, 32, 0.94); border: 1px solid var(--sv-line); border-radius: 0.5rem;
  padding: 0.5rem; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4); backdrop-filter: blur(4px);
}
.sv-layers-head { display: flex; align-items: center; gap: 0.3rem; font-size: 0.64rem; font-weight: 700; margin-bottom: 0.35rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sv-text-dim); }
.sv-mini { font-size: 0.6rem; color: var(--sv-text-faint); font-weight: 400; }
.sv-mini.pad { padding: 0.5rem 0.7rem; }
.sv-layer { display: flex; align-items: center; gap: 0.4rem; padding: 0.15rem 0; font-size: 0.68rem; cursor: pointer; color: var(--sv-text); }
.sv-layer input { accent-color: var(--sv-amber); }
.sv-dot { width: 0.7rem; height: 0.7rem; border-radius: 0.2rem; flex-shrink: 0; }
.sv-layer-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Live grid readout */
.sv-readout {
  position: absolute; left: 50%; bottom: 0.6rem; transform: translateX(-50%);
  display: flex; align-items: center; gap: 0.6rem; padding: 0.35rem 0.8rem;
  background: rgba(11, 15, 20, 0.92); border: 1px solid var(--sv-line); border-radius: 0.4rem;
  font-family: var(--sv-mono); font-size: 0.68rem; white-space: nowrap;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4); backdrop-filter: blur(4px);
}
.sv-readout.idle { color: var(--sv-text-faint); }
.sv-ro-label { color: var(--sv-text-faint); font-size: 0.58rem; letter-spacing: 0.1em; }
.sv-ro-val { color: var(--sv-amber); }
.sv-readout.idle .sv-ro-val { color: var(--sv-text-faint); }
.sv-ro-sep { width: 1px; height: 0.85rem; background: var(--sv-line); }

/* ── Right panel ───────────────────────────────────────────────────── */
.sv-right { width: 24rem; background: var(--sv-panel); border-left: 1px solid var(--sv-line); overflow-y: auto; flex-shrink: 0; }
.sv-detail { padding: 0.7rem; display: flex; flex-direction: column; gap: 0.6rem; }
.sv-detail-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; }
.sv-detail-type { font-weight: 700; font-size: 0.85rem; }
.sv-detail-stand { font-size: 0.7rem; color: var(--sv-text-dim); font-family: var(--sv-mono); }
.sv-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.sv-note { margin: 0.4rem 0 0; font-size: 0.8rem; color: var(--text-muted, #475569); }
.sv-note a { color: inherit; text-decoration: underline; }

.sv-tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--sv-line); }
.sv-tabs button {
  display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.4rem 0.55rem;
  background: none; border: none; border-bottom: 2px solid transparent;
  color: var(--sv-text-dim); font-size: 0.7rem; cursor: pointer;
}
.sv-tabs button.active { color: var(--sv-amber); border-bottom-color: var(--sv-amber); font-weight: 600; }
.sv-pane { display: flex; flex-direction: column; gap: 0.6rem; }

.sv-card { border: 1px solid var(--sv-line); border-radius: 0.5rem; overflow: hidden; background: var(--sv-raised); }
.sv-card > header {
  display: flex; align-items: center; gap: 0.4rem; padding: 0.45rem 0.7rem;
  background: var(--sv-line-soft); border-bottom: 1px solid var(--sv-line);
  font-size: 0.64rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sv-text-dim);
}
.sv-kv { display: flex; justify-content: space-between; gap: 0.5rem; padding: 0.3rem 0.7rem; font-size: 0.7rem; }
.sv-kv span { color: var(--sv-text-faint); }
.sv-desc { margin: 0.3rem 0.7rem; font-size: 0.7rem; color: var(--sv-text-dim); }
.sv-instr { margin: 0.3rem 0.7rem; font-size: 0.7rem; color: var(--sv-text); }
.sv-finding { padding: 0.4rem 0.7rem; border-top: 1px solid var(--sv-line-soft); }
.sv-finding-rec { font-weight: 700; font-size: 0.68rem; color: var(--sv-green); }
.sv-finding-sum { font-size: 0.72rem; }
.sv-row { display: flex; justify-content: space-between; gap: 0.5rem; padding: 0.3rem 0.7rem; border-top: 1px solid var(--sv-line-soft); font-size: 0.68rem; }
.sv-num { font-family: var(--sv-mono); color: var(--sv-text-dim); }
.sv-comment { padding: 0.4rem 0.7rem; border-top: 1px solid var(--sv-line-soft); font-size: 0.72rem; }
.sv-comment-head { font-size: 0.6rem; color: var(--sv-text-faint); text-transform: capitalize; }

.sv-form { display: flex; flex-direction: column; gap: 0.35rem; padding: 0.5rem 0.7rem; border-top: 1px solid var(--sv-line-soft); }
.sv-form-row { flex-direction: row; flex-wrap: wrap; align-items: center; }
.sv-form-row .sv-input { flex: 1; min-width: 4rem; }

.spin-icon { animation: sv-spin 1s linear infinite; }
@keyframes sv-spin { to { transform: rotate(360deg); } }

/* Dark chrome for the maplibre zoom control */
:deep(.maplibregl-ctrl-group) { background: var(--sv-raised); border: 1px solid var(--sv-line); }
:deep(.maplibregl-ctrl-group button) { background: var(--sv-raised); }
:deep(.maplibregl-ctrl-group button + button) { border-top: 1px solid var(--sv-line); }
:deep(.maplibregl-ctrl button .maplibregl-ctrl-icon) { filter: invert(0.85); }
:deep(.maplibregl-popup-content) { background: var(--sv-raised); color: var(--sv-text); border: 1px solid var(--sv-line); }
:deep(.maplibregl-popup-tip) { border-top-color: var(--sv-raised); }
</style>
