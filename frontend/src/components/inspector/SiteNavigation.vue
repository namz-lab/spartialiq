<script setup lang="ts">
/**
 * In-app directions to an inspection site.
 *
 * Routes over the council's own OSM road network (fetched as a corridor, routed
 * on the device), draws the route on the council basemap, tracks the vehicle,
 * and re-routes after a wrong turn — without leaving the application and
 * without an external maps service.
 *
 * WHAT IT PROMISES AND WHAT IT DOES NOT
 * The estimate is distance over a per-class design speed: no live traffic, no
 * road closures, no turn restrictions beyond one-way. When the stand or the
 * inspector sits off the mapped network it says so and shows a straight line
 * with a heading, which is the honest answer for a rural stand — never a
 * confident line the driver might follow into a river.
 */
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import {
  Navigation2, X, LocateFixed, RefreshCw, AlertTriangle, WifiOff, CornerUpLeft, CornerUpRight,
  ArrowUp, MapPin, Flag, ChevronUp, ChevronDown, RotateCcw, Volume2, VolumeX,
} from 'lucide-vue-next'
import { addVunguBasemap, setBasemapLayerVisible, prefersReducedMotion } from '@/map/vunguBasemap'
import { routeToSite, type SiteRoute } from '@/services/routingService'
import {
  progressAlong, formatDistanceM, formatDuration, haversine,
  type LngLat, type Manoeuvre,
} from '@/inspector/routeGraph'
import { captureGps, isGpsFailure, gpsFailureMessage } from '@/composables/useInspectionNavigation'
import {
  createAnnouncer, speak, stopSpeaking, voiceSupported,
} from '@/inspector/navVoice'
import { useInspectorPreferences } from '@/composables/useInspectorPreferences'
import UiButton from '@/components/ui/UiButton.vue'

const props = defineProps<{
  open: boolean
  /** Destination — the stand's authoritative position. */
  lat: number
  lng: number
  stand?: string | null
  ward?: string | null
  reference?: string | null
}>()

const emit = defineEmits<{ 'update:open': [boolean]; arrived: [LngLat] }>()

const ARRIVAL_M = 40        // inside this, the inspector is at the stand
const OFF_ROUTE_M = 60      // beyond this from the line, the route is stale
const REROUTE_COOLDOWN_MS = 15_000

const mapContainer = ref<HTMLElement | null>(null)
const mapRef = shallowRef<maplibregl.Map | null>(null)
const mapReady = ref(false)

const position = ref<LngLat | null>(null)
const accuracyM = ref<number | null>(null)
const heading = ref<number | null>(null)
const gpsError = ref<string | null>(null)
const routing = ref(false)
const routeError = ref<string | null>(null)
const currentRoute = ref<SiteRoute | null>(null)
const following = ref(true)
const stepsOpen = ref(false)
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const arrived = ref(false)
// Muted is DERIVED from the shared preference, not a second copy of it: the
// Settings section writes the same flag, and a local ref would keep saying
// "Voice" on this panel after it had been turned off elsewhere.
const { prefs, set: setPreference } = useInspectorPreferences()
const muted = computed(() => !prefs.value.voiceGuidance)
const canSpeak = voiceSupported()

let watchId: number | null = null
let lastRerouteAt = 0
let markerEl: HTMLElement | null = null
let marker: maplibregl.Marker | null = null

const announcer = createAnnouncer()

function toggleMute() {
  const nextMuted = !muted.value
  setPreference('voiceGuidance', !nextMuted)
  if (nextMuted) stopSpeaking()
  // Un-muting mid-drive says the turn in hand rather than leaving the driver in
  // silence until the next band, which can be most of a kilometre away.
  else if (progress.value?.nextStep) {
    speak(progress.value.nextStep.instruction, { interrupt: true, muted: false })
  }
}

// ── Screen wake lock ───────────────────────────────────────────────────
// A phone that sleeps halfway to the stand is a navigation system that stopped
// navigating. Released as soon as the directions close, so nothing holds the
// screen awake once the drive is over.
type WakeLockLike = { release: () => Promise<void> }
let wakeLock: WakeLockLike | null = null

async function acquireWakeLock() {
  if (wakeLock) return
  const api = (navigator as Navigator & {
    wakeLock?: { request: (t: 'screen') => Promise<WakeLockLike> }
  }).wakeLock
  if (!api) return
  try {
    wakeLock = await api.request('screen')
  } catch {
    // Denied, or the battery is too low for the browser to allow it. The
    // directions still work; the screen just times out as usual.
    wakeLock = null
  }
}

function releaseWakeLock() {
  void wakeLock?.release().catch(() => { /* already gone */ })
  wakeLock = null
}

// The browser drops the lock whenever the page is hidden, so it has to be taken
// again each time the inspector comes back to the tab.
function onVisibility() {
  if (typeof document === 'undefined') return
  if (document.visibilityState === 'visible' && props.open) void acquireWakeLock()
  else wakeLock = null
}

const destination = computed<LngLat>(() => ({ lng: props.lng, lat: props.lat }))

const progress = computed(() => {
  if (!currentRoute.value || !position.value) return null
  return progressAlong(position.value, currentRoute.value)
})

const etaClock = computed(() => {
  const s = progress.value?.remainingS ?? currentRoute.value?.durationS
  if (s == null || !Number.isFinite(s)) return null
  return new Date(Date.now() + s * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
})

const MANOEUVRE_ICON: Record<Manoeuvre, typeof ArrowUp> = {
  depart: Navigation2, arrive: Flag, straight: ArrowUp,
  'slight-left': CornerUpLeft, left: CornerUpLeft, 'sharp-left': CornerUpLeft,
  'slight-right': CornerUpRight, right: CornerUpRight, 'sharp-right': CornerUpRight,
  'u-turn': RotateCcw,
}

// ── Map ────────────────────────────────────────────────────────────────
async function initMap() {
  if (!mapContainer.value || mapRef.value) return
  const map = new maplibregl.Map({
    container: mapContainer.value,
    style: {
      version: 8,
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f2efe9' } }],
      glyphs: '/fonts/{fontstack}/{range}.pbf',
    } as never,
    center: [props.lng, props.lat],
    zoom: 14,
    attributionControl: false,
  })
  mapRef.value = map
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
  map.on('error', () => { /* tile and glyph noise is handled by the basemap module */ })
  map.on('dragstart', () => { following.value = false })

  map.on('load', async () => {
    try { await addVunguBasemap(map, { interactive: false, autoTilt: false }) } catch { /* basemap optional */ }
    if (!mapRef.value) return
    setBasemapLayerVisible(map, 'stands', true)

    map.addSource('nav-route', { type: 'geojson', data: emptyLine() })
    map.addLayer({
      id: 'nav-route-casing', type: 'line', source: 'nav-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0b3c74', 'line-width': 10, 'line-opacity': 0.9 },
    })
    map.addLayer({
      id: 'nav-route-line', type: 'line', source: 'nav-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2f8ae0', 'line-width': 6 },
    })

    // The destination pin needs no handle: it is owned by the map, and the
    // teardown below removes the map itself, taking every marker with it.
    new maplibregl.Marker({ color: '#bd2f28' })
      .setLngLat([props.lng, props.lat]).addTo(map)

    mapReady.value = true
    drawRoute()
  })
}

function emptyLine() {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } as never
}

function drawRoute() {
  const map = mapRef.value
  const r = currentRoute.value
  if (!map || !mapReady.value || !r) return
  const src = map.getSource('nav-route') as maplibregl.GeoJSONSource | undefined
  src?.setData({
    type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: r.coordinates },
  } as never)
  map.setPaintProperty('nav-route-line', 'line-color', r.straightLine ? '#a8620a' : '#2f8ae0')
  map.setPaintProperty('nav-route-line', 'line-dasharray', r.straightLine ? [2, 1.5] : [1])
  fitRoute()
}

function fitRoute() {
  const map = mapRef.value
  const r = currentRoute.value
  if (!map || !r || r.coordinates.length < 2) return
  const b = new maplibregl.LngLatBounds(r.coordinates[0] as [number, number], r.coordinates[0] as [number, number])
  for (const c of r.coordinates) b.extend(c as [number, number])
  map.fitBounds(b, { padding: 64, duration: prefersReducedMotion() ? 0 : 600 })
}

function updateMarker() {
  const map = mapRef.value
  const p = position.value
  if (!map || !p) return
  if (!marker) {
    markerEl = document.createElement('div')
    markerEl.className = 'nav-me'
    markerEl.innerHTML = '<span class="nav-me-dot"></span><span class="nav-me-arrow"></span>'
    marker = new maplibregl.Marker({ element: markerEl }).setLngLat([p.lng, p.lat]).addTo(map)
  } else {
    marker.setLngLat([p.lng, p.lat])
  }
  if (markerEl && heading.value != null) {
    markerEl.style.setProperty('--nav-heading', `${heading.value}deg`)
  }
  if (following.value) {
    map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 15), duration: prefersReducedMotion() ? 0 : 450 })
  }
}

// ── Routing ────────────────────────────────────────────────────────────
async function buildRoute(force = false) {
  if (routing.value) return
  routing.value = true
  routeError.value = null
  try {
    const from = position.value ?? await currentPosition()
    if (!from) return
    const next = await routeToSite(from, destination.value, { force })
    currentRoute.value = next
    drawRoute()

    // A new route voids every cue said about the old one — the coordinate
    // indices the announcer keys on no longer mean the same turns.
    announcer.reset()
    if (next.straightLine) {
      announcer.once(
        'straight-line',
        'No mapped road route. Following a straight line towards the site — check the terrain before driving it.',
        muted.value,
      )
    } else {
      const depart = next.steps.find(s => s.manoeuvre === 'depart')
      if (depart) announcer.once('depart', `${depart.instruction}.`, muted.value)
    }
  } catch (err: unknown) {
    routeError.value = err instanceof Error
      ? `Directions could not be calculated: ${err.message}`
      : 'Directions could not be calculated.'
  } finally {
    routing.value = false
  }
}

async function currentPosition(): Promise<LngLat | null> {
  const fix = await captureGps()
  if (isGpsFailure(fix)) {
    gpsError.value = gpsFailureMessage(fix).replace(/ Photos will be saved without GPS coordinates\.| Coordinates will not be attached\./, '')
    return null
  }
  gpsError.value = null
  position.value = { lng: fix.lng, lat: fix.lat }
  accuracyM.value = fix.accuracyM
  return position.value
}

function startWatch() {
  if (typeof navigator === 'undefined' || !navigator.geolocation || watchId != null) return
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      gpsError.value = null
      position.value = { lng: pos.coords.longitude, lat: pos.coords.latitude }
      accuracyM.value = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null
      if (Number.isFinite(pos.coords.heading as number)) heading.value = pos.coords.heading as number
      updateMarker()
      onPositionUpdate()
    },
    (err) => { gpsError.value = err.code === 1 ? 'Location access was denied, so the route cannot follow you.' : 'Location is unavailable.' },
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
  )
}

function stopWatch() {
  if (watchId != null && typeof navigator !== 'undefined') navigator.geolocation.clearWatch(watchId)
  watchId = null
}

/** Arrival and off-route handling, on every fix. */
function onPositionUpdate() {
  const p = position.value
  const r = currentRoute.value
  if (!p) return

  if (haversine(p, destination.value) <= ARRIVAL_M) {
    if (!arrived.value) {
      arrived.value = true
      speak('You have arrived at the inspection site.', { interrupt: true, muted: muted.value })
      emit('arrived', p)
    }
    return
  }
  arrived.value = false

  if (!r || r.straightLine) return
  const prog = progressAlong(p, r)
  announcer.onProgress(prog.nextStep, prog.distanceToNextM, muted.value)

  if (prog.offRouteM > OFF_ROUTE_M && Date.now() - lastRerouteAt > REROUTE_COOLDOWN_MS) {
    lastRerouteAt = Date.now()
    speak('Off route. Re-calculating.', { interrupt: true, muted: muted.value })
    void buildRoute()
  }
}

function recentre() {
  following.value = true
  updateMarker()
  if (!position.value) void currentPosition()
}

function close() { emit('update:open', false) }

function onOnline() { online.value = true }
function onOffline() { online.value = false }

watch(() => props.open, async (isOpen) => {
  if (isOpen) {
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisibility)
    void acquireWakeLock()
    await new Promise(r => setTimeout(r, 0))     // let the panel lay out first
    await initMap()
    await currentPosition()
    startWatch()
    await buildRoute()
  } else {
    stopWatch()
    stopSpeaking()
    announcer.reset()
    releaseWakeLock()
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('visibilitychange', onVisibility)
    mapRef.value?.remove()
    mapRef.value = null
    marker = null
    mapReady.value = false
    currentRoute.value = null
    arrived.value = false
  }
}, { immediate: true })

onBeforeUnmount(() => {
  stopWatch()
  stopSpeaking()
  releaseWakeLock()
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  document.removeEventListener('visibilitychange', onVisibility)
  mapRef.value?.remove()
})

const corridorAge = computed(() => {
  const at = currentRoute.value?.corridorFetchedAt
  if (!at) return null
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000)
  return days >= 1 ? `${days} day${days === 1 ? '' : 's'} old` : null
})
</script>

<template>
  <div v-if="open" class="nav-root" role="dialog" aria-modal="true" aria-label="Directions to the inspection site">
    <div ref="mapContainer" class="nav-map" />

    <!-- Instruction banner -->
    <header class="nav-top">
      <button type="button" class="nav-close" aria-label="Close directions" @click="close">
        <X :size="18" aria-hidden="true" />
      </button>

      <div class="nav-instruction" aria-live="polite">
        <template v-if="arrived">
          <span class="nav-icon t-arrive"><Flag :size="22" aria-hidden="true" /></span>
          <div>
            <strong>You have arrived</strong>
            <span>Stand {{ stand || '—' }}<template v-if="ward"> · {{ ward }}</template></span>
          </div>
        </template>
        <template v-else-if="progress?.nextStep">
          <span class="nav-icon"><component :is="MANOEUVRE_ICON[progress.nextStep.manoeuvre]" :size="22" aria-hidden="true" /></span>
          <div>
            <strong>{{ progress.nextStep.instruction }}</strong>
            <span>in {{ formatDistanceM(progress.distanceToNextM) }}</span>
          </div>
        </template>
        <template v-else-if="routing">
          <span class="nav-icon"><RefreshCw :size="22" class="nav-spin" aria-hidden="true" /></span>
          <div><strong>Calculating directions…</strong><span>Reading the council road network</span></div>
        </template>
        <template v-else>
          <span class="nav-icon"><Navigation2 :size="22" aria-hidden="true" /></span>
          <div>
            <strong>Directions to Stand {{ stand || '—' }}</strong>
            <span>{{ reference || 'Inspection site' }}</span>
          </div>
        </template>
      </div>
    </header>

    <!-- Honest state, above the fold -->
    <div class="nav-flags">
      <p v-if="!online" class="nav-flag t-warn"><WifiOff :size="14" aria-hidden="true" /> Offline — routing from roads saved on this device.</p>
      <p v-else-if="currentRoute?.fromCache" class="nav-flag"><RefreshCw :size="14" aria-hidden="true" /> Roads from this device{{ corridorAge ? ` (${corridorAge})` : '' }}.</p>
      <p v-if="currentRoute?.straightLine" class="nav-flag t-warn">
        <AlertTriangle :size="14" aria-hidden="true" />
        No mapped road route. This is a straight line and a heading — check the terrain before following it.
      </p>
      <p v-if="currentRoute?.partialNetwork" class="nav-flag t-warn">
        <AlertTriangle :size="14" aria-hidden="true" /> The road network was clipped; a better route may exist.
      </p>
      <p v-if="gpsError" class="nav-flag t-warn"><AlertTriangle :size="14" aria-hidden="true" /> {{ gpsError }}</p>
      <p v-if="routeError" class="nav-flag t-warn" role="alert"><AlertTriangle :size="14" aria-hidden="true" /> {{ routeError }}</p>
      <p v-if="accuracyM != null && accuracyM > 50" class="nav-flag">
        <MapPin :size="14" aria-hidden="true" /> Position accurate to about {{ Math.round(accuracyM) }} m.
      </p>
    </div>

    <!-- Trip summary + controls -->
    <footer class="nav-bottom">
      <div class="nav-summary">
        <div class="nav-figure">
          <strong>{{ formatDistanceM(progress?.remainingM ?? currentRoute?.distanceM ?? NaN) }}</strong>
          <span>remaining</span>
        </div>
        <div class="nav-figure">
          <strong>{{ formatDuration(progress?.remainingS ?? currentRoute?.durationS ?? NaN) }}</strong>
          <span>{{ etaClock ? `arrive ~${etaClock}` : 'estimate' }}</span>
        </div>
        <div class="nav-actions">
          <button
            v-if="canSpeak"
            type="button"
            class="nav-btn"
            :class="{ active: !muted }"
            :aria-pressed="!muted"
            :aria-label="muted ? 'Turn spoken directions on' : 'Turn spoken directions off'"
            @click="toggleMute">
            <component :is="muted ? VolumeX : Volume2" :size="16" aria-hidden="true" />
            <span class="nav-btn-label">{{ muted ? 'Muted' : 'Voice' }}</span>
          </button>
          <button type="button" class="nav-btn" :class="{ active: following }" @click="recentre">
            <LocateFixed :size="16" aria-hidden="true" /> <span class="nav-btn-label">Follow</span>
          </button>
          <button type="button" class="nav-btn" :disabled="routing" @click="buildRoute(true)">
            <RefreshCw :size="16" :class="{ 'nav-spin': routing }" aria-hidden="true" /> <span class="nav-btn-label">Re-route</span>
          </button>
          <button type="button" class="nav-btn" :aria-expanded="stepsOpen" @click="stepsOpen = !stepsOpen">
            <component :is="stepsOpen ? ChevronDown : ChevronUp" :size="16" aria-hidden="true" />
            <span class="nav-btn-label">Steps</span>
          </button>
        </div>
      </div>

      <ol v-if="stepsOpen && currentRoute" class="nav-steps">
        <li v-for="(s, i) in currentRoute.steps" :key="i"
            :class="{ current: progress?.nextStep === s }">
          <component :is="MANOEUVRE_ICON[s.manoeuvre]" :size="16" aria-hidden="true" />
          <span class="nav-step-text">{{ s.instruction }}</span>
          <span v-if="s.distanceM > 0" class="nav-step-dist">{{ formatDistanceM(s.distanceM) }}</span>
        </li>
      </ol>

      <p v-if="currentRoute && !currentRoute.straightLine" class="nav-disclaimer">
        Estimated from road class — no live traffic or closures.
      </p>

      <UiButton v-if="arrived" variant="primary" block @click="close">
        Back to the inspection
      </UiButton>
    </footer>
  </div>
</template>

<style scoped>
.nav-root { position: fixed; inset: 0; z-index: var(--ent-z-modal); background: var(--ent-canvas); display: flex; flex-direction: column; }
.nav-map { position: absolute; inset: 0; }

.nav-top {
  position: relative; z-index: 2; display: flex; align-items: stretch; gap: var(--ent-s2);
  margin: var(--ent-s3); padding: var(--ent-s3) var(--ent-s4);
  background: var(--ent-surface); border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-lg); box-shadow: var(--ent-e3);
}
.nav-close {
  flex-shrink: 0; width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--ent-line); border-radius: var(--ent-r);
  color: var(--ent-text-2); cursor: pointer;
}
.nav-close:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.nav-instruction { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--ent-s3); }
.nav-instruction strong { display: block; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); color: var(--ent-text); line-height: var(--ent-lh-tight); }
.nav-instruction span { display: block; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.nav-icon {
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  width: 44px; height: 44px; border-radius: var(--ent-r-md);
  background: var(--ent-accent-soft); color: var(--ent-accent);
}
.nav-icon.t-arrive { background: var(--ent-success-soft); color: var(--ent-success); }

.nav-flags { position: relative; z-index: 2; margin: 0 var(--ent-s3); display: flex; flex-direction: column; gap: var(--ent-s1); }
.nav-flag {
  display: flex; align-items: center; gap: var(--ent-s2); margin: 0;
  padding: var(--ent-s2) var(--ent-s3); border-radius: var(--ent-r);
  background: var(--ent-map-panel-bg); border: 1px solid var(--ent-line);
  font-size: var(--ent-fs-xs); color: var(--ent-text-2);
}
.nav-flag.t-warn { border-color: var(--ent-tone-warning-line); background: var(--ent-warning-soft); color: var(--ent-text); }
.nav-flag svg { flex-shrink: 0; }

.nav-bottom {
  position: relative; z-index: 2; margin-top: auto; padding: var(--ent-s3) var(--ent-s4) calc(var(--ent-s4) + var(--ent-safe-bottom, 0px));
  background: var(--ent-surface); border-top: 1px solid var(--ent-line); box-shadow: var(--ent-e3);
  display: flex; flex-direction: column; gap: var(--ent-s3);
}
.nav-summary { display: flex; align-items: center; gap: var(--ent-s5); flex-wrap: wrap; }
.nav-figure strong { display: block; font-size: var(--ent-fs-xl); font-weight: var(--ent-fw-bold); color: var(--ent-text); font-variant-numeric: tabular-nums; line-height: 1.1; }
.nav-figure span { display: block; font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
.nav-actions { margin-left: auto; display: flex; gap: var(--ent-s2); }
.nav-btn {
  display: inline-flex; align-items: center; gap: var(--ent-s2); min-height: 44px; padding: 0 var(--ent-s3);
  background: var(--ent-surface); border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r);
  color: var(--ent-text); font-family: var(--ent-font); font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); cursor: pointer;
}
.nav-btn.active { background: var(--ent-accent-soft); border-color: var(--ent-accent-line); color: var(--ent-accent); }
.nav-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.nav-btn:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }

.nav-steps { list-style: none; margin: 0; padding: 0; max-height: 34vh; overflow-y: auto; border-top: 1px solid var(--ent-line); }
.nav-steps li { display: flex; align-items: center; gap: var(--ent-s3); padding: var(--ent-s3) 0; border-bottom: 1px solid var(--ent-line); font-size: var(--ent-fs-sm); color: var(--ent-text); }
.nav-steps li.current { color: var(--ent-accent); font-weight: var(--ent-fw-semibold); }
.nav-step-text { flex: 1; min-width: 0; }
.nav-step-dist { color: var(--ent-text-3); font-variant-numeric: tabular-nums; }
.nav-disclaimer { margin: 0; font-size: var(--ent-fs-micro); color: var(--ent-text-3); }

.nav-spin { animation: nav-rotate 0.9s linear infinite; }
@keyframes nav-rotate { to { transform: rotate(360deg); } }

:deep(.nav-me) { width: 22px; height: 22px; position: relative; }
:deep(.nav-me-dot) {
  position: absolute; inset: 3px; border-radius: 50%;
  background: var(--ent-accent); border: 2px solid #fff; box-shadow: 0 0 0 2px rgba(31, 90, 168, 0.35);
}
:deep(.nav-me-arrow) {
  position: absolute; inset: 0; transform: rotate(var(--nav-heading, 0deg));
  border-left: 5px solid transparent; border-right: 5px solid transparent;
  border-bottom: 9px solid var(--ent-accent); width: 0; height: 0; margin: -8px auto 0;
}

@media (max-width: 767px) {
  .nav-instruction strong { font-size: var(--ent-fs-md); }
  .nav-btn-label { display: none; }
  .nav-btn { padding: 0 var(--ent-s3); }
}
@media (prefers-reduced-motion: reduce) { .nav-spin { animation: none; } }
</style>
