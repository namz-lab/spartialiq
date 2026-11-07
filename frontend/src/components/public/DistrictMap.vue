<script setup lang="ts">
/**
 * The council's basemap, for the public pages. Two jobs, one component:
 *
 *   backdrop mode — behind the landing-page hero, no input accepted, a slow
 *                   drift, and a scrim that guarantees the copy's contrast.
 *   panel mode    — the map beside the gazetteer, pan and zoom on, driven
 *                   from outside via the exposed `flyToPoint` / `setLayerVisible`.
 *
 * They share everything that matters — create a MapLibre map on the
 * self-hosted blank style, call `addVunguBasemap`, tear it down cleanly — and
 * differ only in whether input is accepted and whether the camera moves by
 * itself. That is one component with a switch, not two components.
 *
 * WHY NOT `InteractiveMap.vue`
 * That component is 2,600 lines and mounts a GIS workstation: a layer-filter
 * panel, the QGIS WMS overlay panel, the full MapToolbar (search, measure,
 * notification radius, PDF export), an attribute table and a data-import
 * dialog. On the landing page that produced a second search box twenty
 * pixels from the page's own one, and put staff tooling on a surface an
 * anonymous visitor reaches. It is still the right component for /explorer,
 * where someone has come to do that work — hence the "Open the full
 * explorer" link rather than a reduced copy of it here.
 *
 * FAILURE IS SILENT AND SOFT. If MapLibre will not start, or the tile service
 * is down, the canvas never fades in and the surrounding page is unaffected.
 * Someone reading about a stand application should not be told that the
 * vector tile endpoint returned a 500.
 */
import { ref, shallowRef, onMounted, onUnmounted } from 'vue'
import { prefersReducedMotion } from '@/composables/reveal'

const props = withDefaults(defineProps<{
  /** Accept pan/zoom and show the navigation control. */
  interactive?: boolean
  /** Slow ambient camera drift. Backdrop only; ignored when interactive. */
  drift?: boolean
  /** Lay the contrast scrim and survey grid over the map. */
  scrim?: boolean
  /** Seconds for one full drift cycle. Longer reads as calmer. */
  cycleSeconds?: number
  /** Starting zoom. The drift breathes around it. */
  zoom?: number
}>(), {
  interactive: false,
  drift: true,
  scrim: false,
  cycleSeconds: 90,
  zoom: 10.2,
})

/**
 * Vungu RDC = Gweru rural district, pcode ZW1704. The centre is the middle of
 * that polygon's real extent (29.0920,-19.9732 → 30.1871,-19.0910), and the
 * zoom is set so the district fills the frame. Pulled out any further and the
 * country label appears, at which point the backdrop is a picture of Zimbabwe
 * rather than of this district.
 */
const CENTRE: [number, number] = [29.64, -19.53]

/**
 * What the backdrop draws.
 *
 * The first cut of this list kept only boundaries, water, roads and land
 * use, which was cheap and wrong: without the settlement labels and the
 * smaller area layers the map lost its skeleton and read as scattered
 * coloured polygons rather than as a district. The structure a map needs to
 * be recognisable at a glance is the road network AND the place names on it.
 *
 * What stays off is what is genuinely expensive and invisible here anyway:
 * `buildings` is 133,840 footprints in this district alone, and the points
 * of interest, traffic and transport layers are street-furniture detail
 * nobody will read through the wash. Everything else is drawn.
 */
const BACKDROP_LAYERS = [
  'country', 'provinces', 'districts', 'wards', 'admin_areas',
  'water_areas', 'waterways', 'protected_areas', 'natural_areas',
  'roads', 'railways', 'landuse',
  'places_areas', 'places_points',
]

const host = ref<HTMLDivElement | null>(null)
/**
 * shallowRef, never ref: a MapLibre Map is a large graph of mutable objects
 * and Vue's deep reactivity proxy over it corrupts internal identity checks
 * (ADR 0011).
 */
const map = shallowRef<any>(null)
const painted = ref(false)

let drift = 0
let io: IntersectionObserver | null = null
let visible = true
/** Stops the ambient drift for good once the visitor takes the wheel. */
let userTookOver = false

/**
 * A slow Lissajous drift — the two axes share no period, so the camera never
 * retraces the same path and the motion reads as a survey rather than a loop.
 * Amplitude is a few hundredths of a degree: at this zoom a gentle parallax,
 * not a tour.
 */
function startDrift() {
  if (!props.drift || props.interactive || prefersReducedMotion() || !map.value) return
  const t0 = performance.now()
  const period = props.cycleSeconds * 1000
  const step = () => {
    drift = requestAnimationFrame(step)
    // Off-screen, backgrounded tab, or the visitor has moved the map
    // themselves — in all three cases the frame would be wasted or rude.
    if (!visible || userTookOver || !map.value || document.hidden) return
    const t = ((performance.now() - t0) % period) / period
    const a = t * Math.PI * 2
    map.value.jumpTo({
      center: [
        CENTRE[0] + Math.sin(a) * 0.055,
        CENTRE[1] + Math.sin(a * 0.61 + 1.1) * 0.038,
      ],
      zoom: props.zoom + Math.sin(a * 0.43) * 0.28,
      bearing: Math.sin(a * 0.31) * 4,
    })
  }
  drift = requestAnimationFrame(step)
}

onMounted(async () => {
  if (!host.value) return
  try {
    // Dynamic import: MapLibre and the basemap module are several hundred KB
    // and this is the last thing on the page that has to be ready. The hero
    // renders and is readable before either arrives.
    const [{ default: maplibregl }, { addVunguBasemap }] = await Promise.all([
      import('maplibre-gl'),
      import('@/map/vunguBasemap'),
    ])
    if (!host.value) return

    map.value = new maplibregl.Map({
      container: host.value,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f5f3ee' } }],
        glyphs: '/fonts/{fontstack}/{range}.pbf',
      } as any,
      center: CENTRE,
      zoom: props.zoom,
      minZoom: 6,
      maxZoom: 18,
      interactive: props.interactive,
      attributionControl: false,
      // No cross-fade between zoom levels: under a drifting camera it never
      // settles and the layers shimmer.
      fadeDuration: props.interactive ? 300 : 0,
    })

    // A missing tile is a fact about the network, not something to shout
    // about in the console of a visitor reading a council page.
    map.value.on('error', () => {})

    if (props.interactive) {
      map.value.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
      map.value.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left')
      // Once someone drags or zooms, the map is theirs.
      map.value.on('dragstart', () => { userTookOver = true })
      map.value.on('zoomstart', () => { userTookOver = true })
    }

    // `interactive: false` on the basemap in backdrop mode: its click
    // drill-down would bind handlers to an element nobody can click. In panel
    // mode it stays on so a feature click still identifies something.
    //
    // BACKDROP MODE TAKES A REDUCED LAYER SET. The basemap is 24 layers, and
    // the backdrop is texture behind a headline: nobody is going to read a
    // shop name through a 34%-opacity wash, but every one of those layers
    // still costs a tile request and a decode. Landing on this page already
    // starts two WebGL contexts; on the mid-range Android most of this
    // district browses on, asking both of them for buildings and points of
    // interest is what turns a landing page into a space heater.
    await addVunguBasemap(map.value, {
      interactive: props.interactive,
      autoTilt: false,
      defaultVisible: props.interactive ? undefined : BACKDROP_LAYERS,
    })

    map.value.once('idle', () => { painted.value = true })
    // Belt and braces: 'idle' may never fire if one source stalls, and the
    // map should still appear rather than sit at zero opacity for ever.
    setTimeout(() => { painted.value = true }, 2500)

    startDrift()

    if ('IntersectionObserver' in window && host.value) {
      io = new IntersectionObserver(
        (entries) => { visible = entries.some((e) => e.isIntersecting) },
        { threshold: 0 },
      )
      io.observe(host.value)
    }
  } catch {
    // MapLibre unavailable, tiles down, WebGL blocked — keep the background.
    painted.value = false
  }
})

onUnmounted(() => {
  cancelAnimationFrame(drift)
  io?.disconnect()
  io = null
  try { map.value?.remove() } catch { /* already torn down */ }
  map.value = null
})

defineExpose({
  /** Centre on a gazetteer hit. Stops the drift — the visitor asked for this. */
  flyToPoint(lngLat: [number, number], zoom = 13) {
    if (!map.value) return
    userTookOver = true
    map.value.flyTo({
      center: lngLat,
      zoom,
      // Reduced motion gets the destination, not the journey (ADR: the same
      // rule vunguBasemap applies to fitBounds).
      duration: prefersReducedMotion() ? 0 : 1400,
      essential: true,
    })
  },
  /** Show or hide one basemap layer by its tile-registry id. */
  async setLayerVisible(layerId: string, show: boolean) {
    if (!map.value) return
    const { setBasemapLayerVisible } = await import('@/map/vunguBasemap')
    setBasemapLayerVisible(map.value, layerId, show)
  },
  /** Back to the whole district. */
  resetView() {
    if (!map.value) return
    map.value.flyTo({
      center: CENTRE,
      zoom: props.zoom,
      duration: prefersReducedMotion() ? 0 : 900,
      essential: true,
    })
  },
})
</script>

<template>
  <div class="district-map-root" :class="{ 'is-backdrop': scrim }" :aria-hidden="scrim ? 'true' : undefined">
    <div ref="host" class="district-backdrop-map" :class="{ 'is-painted': painted }"></div>
    <template v-if="scrim">
      <!-- The hero copy has to clear WCAG AA against whatever the camera
           happens to be over, and the map underneath is not a fixed colour.
           The wash is the contrast guarantee, not a mood. -->
      <div class="district-backdrop-scrim"></div>
    </template>
  </div>
</template>
