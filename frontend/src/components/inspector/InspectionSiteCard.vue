<script setup lang="ts">
// Site identity + navigate. Coordinates are cadastral/permit geometry when
// present; GPS is a separate observation and is never substituted silently.
import { computed, ref } from 'vue'
import { MapPin, Navigation, Satellite, AlertTriangle } from 'lucide-vue-next'
import SiteNavigation from '@/components/inspector/SiteNavigation.vue'
import {
  captureGps, formatDistance, haversineMetres, hasCoordinates,
  isGpsFailure, gpsFailureMessage, navigationHref, prefersGeoHandoff,
  type GpsObservation,
} from '@/composables/useInspectionNavigation'

const props = defineProps<{
  stand?: string | null
  ward?: string | null
  property?: string | null
  lat?: number | null
  lng?: number | null
  applicationRef?: string | null
}>()

const gps = ref<GpsObservation | null>(null)
const gpsError = ref<string | null>(null)
const locating = ref(false)

const hasSite = computed(() => hasCoordinates(props.lat, props.lng))

const distance = computed(() => {
  if (!gps.value || !hasSite.value) return null
  return haversineMetres(
    { lat: gps.value.lat, lng: gps.value.lng },
    { lat: props.lat as number, lng: props.lng as number },
  )
})

async function locateMe() {
  locating.value = true
  gpsError.value = null
  const result = await captureGps()
  locating.value = false
  if (isGpsFailure(result)) {
    gps.value = null
    gpsError.value = gpsFailureMessage(result)
    return
  }
  gps.value = result
}

/**
 * Navigate is a real link, not a scripted window.open: a link cannot be eaten by
 * a popup blocker, it survives a JavaScript error, and the inspector can
 * long-press it to copy or open in another app. On a phone it hands off to the
 * maps application; on a workstation it opens a web map.
 */
// Plain functions, re-evaluated on every render — NOT computed(), which would
// cache the first answer forever because the device rule has no reactive
// dependency to invalidate it. This card is kept alive across section switches,
// so a value frozen at creation can outlive the conditions it was read under
// and leave a workstation pointing at a geo: URL the browser refuses to launch.
function geoHandoff(): boolean {
  return prefersGeoHandoff()
}
function navHref(): string | undefined {
  if (!hasSite.value) return undefined
  return navigationHref(props.lat as number, props.lng as number, geoHandoff())
}
/** The in-app directions screen. The external map stays as a secondary escape,
 *  and that link uses navHref() — which honours the geo-handoff preference. */
const navOpen = ref(false)
</script>

<template>
  <SiteNavigation
    v-if="hasSite"
    v-model:open="navOpen"
    :lat="lat as number"
    :lng="lng as number"
    :stand="stand"
    :ward="ward"
    :reference="applicationRef"
  />

  <section class="isc" aria-label="Inspection site">
    <header>
      <MapPin :size="14" aria-hidden="true" />
      <h3>Inspection site</h3>
    </header>
    <dl>
      <div><dt>Stand / property</dt><dd>{{ stand || '—' }}</dd></div>
      <div><dt>Ward</dt><dd>{{ ward || '—' }}</dd></div>
      <div v-if="property"><dt>Description</dt><dd>{{ property }}</dd></div>
      <div v-if="applicationRef"><dt>Application</dt><dd class="mono">{{ applicationRef }}</dd></div>
      <div>
        <dt>Authoritative coordinates</dt>
        <dd v-if="hasSite" class="mono">{{ Number(lat).toFixed(5) }}, {{ Number(lng).toFixed(5) }}</dd>
        <dd v-else>Not stored on this permit. Navigation is unavailable until the parcel is geolocated.</dd>
      </div>
    </dl>

    <div class="isc-gps">
      <p>
        <Satellite :size="12" aria-hidden="true" />
        GPS observation is a field reading. It does not replace cadastral geometry.
      </p>
      <button type="button" class="isc-btn" :disabled="locating" @click="locateMe">
        {{ locating ? 'Locating…' : (gps ? 'Refresh GPS' : 'Capture current location') }}
      </button>
      <p v-if="gps" class="mono">
        {{ gps.lat.toFixed(5) }}, {{ gps.lng.toFixed(5) }}
        <template v-if="gps.accuracyM != null"> · ±{{ Math.round(gps.accuracyM) }} m</template>
      </p>
      <p v-if="distance != null">Distance to site: {{ formatDistance(distance) }}</p>
      <p v-if="gpsError" class="isc-err"><AlertTriangle :size="12" /> {{ gpsError }}</p>
    </div>

    <template v-if="hasSite">
      <button type="button" class="isc-nav" @click="navOpen = true">
        <Navigation :size="14" aria-hidden="true" /> Directions to site
      </button>
      <p class="isc-hint">
        Directions use the council's own road network and work offline once the route is loaded.
        <a class="isc-link" :href="navHref()" target="_blank" rel="noopener noreferrer">
          Open in an external map instead
        </a>
      </p>
    </template>
    <p v-else class="isc-hint">
      Navigation is unavailable: this permit has no stored position. Record the site position from
      the map before relying on directions.
    </p>
  </section>
</template>

<style scoped>
.isc { display:flex; flex-direction:column; gap:var(--ent-s3); }
.isc-link { color:var(--ent-accent); }
.isc header { display:flex; align-items:center; gap:var(--ent-s2); }
.isc h3 { margin:0; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); }
.isc dl { margin:0; display:grid; gap:0.35rem; }
.isc dl > div { display:grid; grid-template-columns:9rem 1fr; gap:var(--ent-s2); font-size:var(--ent-fs-sm); }
.isc dt { color:var(--ent-text-3); font-weight:var(--ent-fw-medium); }
.isc dd { margin:0; color:var(--ent-text); }
.mono { font-family:var(--ent-font-mono); font-size:var(--ent-fs-xs); }
.isc-gps {
  padding:var(--ent-s3); background:var(--ent-surface-2); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-sm); font-size:var(--ent-fs-xs); color:var(--ent-text-2);
}
.isc-gps p { margin:0 0 0.35rem; display:flex; align-items:center; gap:0.3rem; }
.isc-btn, .isc-nav {
  display:inline-flex; align-items:center; justify-content:center; gap:0.35rem;
  min-height:var(--ent-control-h); padding:0 0.85rem; border-radius:var(--ent-r-sm);
  font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); cursor:pointer;
}
.isc-btn { background:var(--ent-surface); border:1px solid var(--ent-line); color:var(--ent-text); }
.isc-nav { background:var(--ent-accent); color:var(--ent-text-on-accent); border:none; align-self:flex-start;
  text-decoration:none; font-family:var(--ent-font); }
.isc-nav:hover { background:var(--ent-accent-hover); }
.isc-nav:focus-visible, .isc-link:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.isc-btn:disabled { opacity:0.5; cursor:not-allowed; }
.isc-err { color:var(--ent-danger); }
.isc-hint { margin:0; font-size:var(--ent-fs-xs); color:var(--ent-text-3); line-height:var(--ent-lh); }
</style>
