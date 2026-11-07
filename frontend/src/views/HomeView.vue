<script setup lang="ts">
/**
 * The council's front door.
 *
 * WHAT THIS REPLACED, AND WHY
 * The previous landing page was an eight-panel single-screen app branded
 * "SpartialIQ" that swapped panels with `v-show` and never scrolled. Four
 * things were wrong with it and all four were visible to a resident:
 *
 *   · Every figure on it was typed into the template. "19 Wards",
 *     "609,588 ha", "1,521 km Roads" — the front page of a spatial data
 *     portal was the one screen in the building that could not tell you what
 *     the spatial data said. The figures now come from PostGIS
 *     (`useDistrictOverview`) and a ward added to the register changes them.
 *   · The search box asked "how many schools in Vungu" and posted to
 *     `/api/map-query`, a route that does not exist. Every search 404'd.
 *     It now calls the gazetteer that is actually registered, and says what
 *     it can do rather than what it cannot.
 *   · The header linked to `/welcome` and `/workflow`, neither of which is a
 *     route. Both went to the 404 page.
 *   · It had no footer, and no link to the council's own pages — the
 *     profile, the committees, the departments, the publications — all of
 *     which exist at `/council/:slug` and were reachable from nowhere.
 *
 * STRUCTURE — the order is the order a resident needs things, not the order
 * the council is organised in. What can I do → is this thing real → show me
 * the map → who does what → why invest → who is accountable → how do I get
 * hold of a person.
 *
 * MOTION — see `composables/reveal.ts`. Everything decorative is gated on
 * `prefers-reduced-motion`, and nothing is hidden until it animates: with
 * motion off, every element is marked revealed at mount.
 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { RouterLink } from 'vue-router'
import {
  ArrowRight, Search, X, Layers, MapPin, Phone, Mail, Clock, Globe,
  FileText, Building2, CreditCard, ClipboardList, ScrollText, Map as MapIcon,
  Landmark, Route as RouteIcon, Activity, Droplets, BarChart3, Briefcase,
  Users, TreePine, ChevronDown, AlertCircle, RotateCw, ExternalLink,
  Sprout, Pickaxe, Sun, Store, Binoculars,
} from 'lucide-vue-next'

import SiteHeader from '@/components/SiteHeader.vue'
import SiteFooter from '@/components/SiteFooter.vue'
import DistrictMap from '@/components/public/DistrictMap.vue'
import FigureTile from '@/components/public/FigureTile.vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { COUNCIL_CONTACT } from '@/content/siteContent'
import {
  useDistrictOverview, formatFigure, compactFigure, freshness,
} from '@/services/districtOverview'
import { prefersReducedMotion } from '@/composables/reveal'

const auth = useAuthStore()

// ── Live district figures ───────────────────────────────────────────────
const { figures, asOf, loading: figuresLoading, error: figuresError, ready: figuresReady, refresh: refreshFigures } =
  useDistrictOverview()

onMounted(() => { refreshFigures() })

/** The four the hero carries. The rest are in the register section below. */
const heroFigures = computed(() => [
  { key: 'wards', label: 'Wards', value: figures.value.wards },
  { key: 'hectares', label: 'Hectares mapped', value: figures.value.hectares },
  { key: 'roadKm', label: 'km of road', value: figures.value.roadKm },
  { key: 'buildings', label: 'Buildings', value: figures.value.buildings },
])

const registerFigures = computed(() => [
  { key: 'wards', label: 'Wards', value: figures.value.wards, source: 'Ward boundaries within the district' },
  { key: 'hectares', label: 'Hectares', unit: 'ha', value: figures.value.hectares, source: 'Area of the district boundary' },
  { key: 'roadKm', label: 'Road network', unit: 'km', value: figures.value.roadKm, source: 'Every road clipped to the district' },
  { key: 'buildings', label: 'Buildings mapped', value: figures.value.buildings, source: 'Building footprints on record' },
  { key: 'parcels', label: 'Land parcels', value: figures.value.parcels, source: "The council's parcel register" },
  { key: 'farms', label: 'Farm holdings', value: figures.value.farms, source: 'Farm cadastre' },
  { key: 'planningZones', label: 'Planning zones', value: figures.value.planningZones, source: 'Peri-urban and land tenure zones' },
  { key: 'waterBodies', label: 'Water bodies', value: figures.value.waterBodies, source: 'Dams, pans and reservoirs' },
])

const asOfPhrase = computed(() => {
  const when = freshness(asOf.value)
  return when ? `Read from the council register ${when}` : ''
})

// ── Gazetteer search ────────────────────────────────────────────────────
//
// `GET /api/map-search` is a NAME LOOKUP across wards, places, parcels,
// farms, stands, roads, zones and facilities — not the natural-language
// engine the old copy promised. The placeholder says so, because a search
// box that invites "how many schools in Vungu" and then answers nothing is
// worse than one that asks for a name.

interface GazetteerHit {
  id: string
  type: string
  label: string
  subtitle?: string
  center: [number, number]
  inDistrict?: boolean
}

const homeMapRef = ref<InstanceType<typeof DistrictMap> | null>(null)
const query = ref('')
const hits = ref<GazetteerHit[]>([])
const searching = ref(false)
const searchError = ref('')
const searchNotice = ref('')
const searched = ref(false)

const MIN_QUERY = 2
const MAX_QUERY = 80

let debounce: ReturnType<typeof setTimeout> | null = null
let controller: AbortController | null = null

/**
 * Validate before spending a round trip. On a rural connection the cheapest
 * request is the one not sent, and "type at least two characters" is a
 * better answer than a spinner followed by an empty list.
 */
function validateQuery(raw: string): { ok: boolean; value: string; message?: string } {
  const value = raw.trim().replace(/\s+/g, ' ')
  if (!value) return { ok: false, value, message: '' }
  if (value.length < MIN_QUERY) {
    return { ok: false, value, message: `Type at least ${MIN_QUERY} characters.` }
  }
  if (value.length > MAX_QUERY) {
    return { ok: false, value, message: 'That search is too long. Try a place, ward or stand number.' }
  }
  // A search of nothing but punctuation matches every row via ILIKE '%...%'
  // and returns a meaningless page of results.
  if (!/[\p{L}\p{N}]/u.test(value)) {
    return { ok: false, value, message: 'Search for a name, a ward or a stand number.' }
  }
  return { ok: true, value }
}

function onInput() {
  searchError.value = ''
  searchNotice.value = ''
  if (debounce) clearTimeout(debounce)
  const check = validateQuery(query.value)
  if (!check.ok) {
    hits.value = []
    searched.value = false
    // Only nag once there is something to nag about — an empty box is not
    // an error, it is the starting state.
    searchNotice.value = check.message ?? ''
    return
  }
  debounce = setTimeout(() => runSearch(check.value), 220)
}

async function runSearch(value: string) {
  // Abandon the previous request rather than racing it: with a 220ms
  // debounce a fast typist can still have two in flight, and the slower one
  // landing second would overwrite the newer results.
  controller?.abort()
  controller = new AbortController()
  searching.value = true
  searchError.value = ''
  try {
    const res = await api.get('/map-search', {
      params: { q: value },
      signal: controller.signal,
    })
    const rows = (res.data?.data ?? res.data?.results ?? []) as GazetteerHit[]
    hits.value = rows
      .filter((r) => r && r.label && Array.isArray(r.center) && r.center.length === 2)
      .slice(0, 12)
    searched.value = true
  } catch (err) {
    // An aborted request is this component's own doing, not a failure to report.
    if ((err as { code?: string; name?: string })?.code === 'ERR_CANCELED') return
    if ((err as { name?: string })?.name === 'CanceledError') return
    hits.value = []
    searched.value = true
    searchError.value = 'Search is unavailable right now. The map below still works.'
  } finally {
    if (!controller?.signal.aborted) searching.value = false
  }
}

function submitSearch() {
  if (debounce) clearTimeout(debounce)
  const check = validateQuery(query.value)
  if (!check.ok) { searchNotice.value = check.message ?? 'Type something to search for.'; return }
  runSearch(check.value)
}

function clearSearch() {
  if (debounce) clearTimeout(debounce)
  controller?.abort()
  query.value = ''
  hits.value = []
  searched.value = false
  searchError.value = ''
  searchNotice.value = ''
}

/**
 * The gazetteer answers with a centre point, never an extent, so the zoom is
 * chosen by what kind of thing was found: a ward is a large polygon and a
 * stand is a few dozen metres across, and landing both at the same zoom puts
 * one off the screen and the other in an empty field.
 */
const HIT_ZOOM: Record<string, number> = {
  ward: 11, district: 9.5, place: 13, zone: 12,
  farm: 13.5, parcel: 15, stand: 17, poi: 15, road: 13,
}

function flyTo(hit: GazetteerHit) {
  const [lng, lat] = hit.center
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
  homeMapRef.value?.flyToPoint([lng, lat], HIT_ZOOM[hit.type] ?? 13)
}

/**
 * Terms that are actually in the gazetteer. The first set here was the
 * council's growth points — Maboleni, Insukamini, Muchakatata — which are
 * real places and return nothing, because the tables behind this search hold
 * wards, parcels, the farm cadastre and OSM points, and none of them names a
 * growth point. Suggesting a search that finds nothing is worse than
 * suggesting none: it reads as a broken search rather than a thin gazetteer.
 */
const EXAMPLES = ['Ward 12', 'Guinea Fowl', 'Daisyfield', 'Henley']

function runExample(term: string) {
  query.value = term
  submitSearch()
}

onUnmounted(() => {
  if (debounce) clearTimeout(debounce)
  controller?.abort()
})

// ── Map panel ───────────────────────────────────────────────────────────
//
// The panel map is mounted only once its section comes within a screen of
// the viewport. Two MapLibre maps is two WebGL contexts and two sets of
// vector tiles; starting both at page load costs a visitor who never scrolls
// past the hero — most of them — a second map they will not see. The hero
// backdrop stays eager because it is the first thing on the page.
const mapSection = ref<HTMLElement | null>(null)
const mapArmed = ref(false)
let mapArmObserver: IntersectionObserver | null = null

const layersOpen = ref(false)

const LAYER_GROUPS = [
  { label: 'Roads', ids: ['roads'] },
  { label: 'Wards', ids: ['wards'] },
  { label: 'Water', ids: ['waterways', 'water_areas'] },
  { label: 'Buildings', ids: ['buildings'] },
  { label: 'Land use', ids: ['landuse'] },
  { label: 'Protected areas', ids: ['protected_areas'] },
  { label: 'Places', ids: ['places_points', 'places_areas'] },
  { label: 'Facilities', ids: ['pois_points', 'pois_areas'] },
]

const layerOn = ref<Record<string, boolean>>(
  Object.fromEntries(LAYER_GROUPS.flatMap((g) => g.ids.map((id) => [id, true]))),
)

const groupOn = (ids: string[]) => ids.every((id) => layerOn.value[id] !== false)

function toggleGroup(ids: string[], on: boolean) {
  for (const id of ids) {
    layerOn.value[id] = on
    homeMapRef.value?.setLayerVisible(id, on)
  }
}

/**
 * The map arms on scroll, so it can mount after a layer has already been
 * switched off here. Re-apply anything that is off, or the checkboxes and
 * the map would disagree from the moment it appears.
 */
watch(mapArmed, async (armed) => {
  if (!armed) return
  await nextTick()
  for (const [id, on] of Object.entries(layerOn.value)) {
    if (!on) homeMapRef.value?.setLayerVisible(id, false)
  }
})

// ── Hero pointer light ──────────────────────────────────────────────────
//
// A soft highlight that tracks the pointer across the hero. Written to two
// CSS custom properties and read by a radial-gradient in the stylesheet, so
// the only per-frame JavaScript is two `setProperty` calls — no layout, no
// paint the compositor cannot absorb. Off entirely under reduced motion and
// on coarse pointers, where there is no hovering pointer to follow.

const hero = ref<HTMLElement | null>(null)
let pointerFrame = 0

function onPointerMove(e: PointerEvent) {
  if (pointerFrame) return
  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = 0
    const el = hero.value
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--px', `${((e.clientX - r.left) / r.width) * 100}%`)
    el.style.setProperty('--py', `${((e.clientY - r.top) / r.height) * 100}%`)
  })
}

// ── Hero parallax ───────────────────────────────────────────────────────
// One passive scroll listener writing one custom property. The stylesheet
// decides what moves and by how much, so the depth can be retuned without
// touching this file.
const scrollDepth = ref(0)
let scrollFrame = 0

function onScroll() {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    const h = window.innerHeight || 1
    scrollDepth.value = Math.min(1, window.scrollY / h)
  })
}

const reduced = ref(false)

onMounted(() => {
  // Arm the map panel when its section is within one viewport of the fold.
  if (mapSection.value && 'IntersectionObserver' in window) {
    mapArmObserver = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      mapArmed.value = true
      mapArmObserver?.disconnect()
      mapArmObserver = null
    }, { rootMargin: '100% 0px' })
    mapArmObserver.observe(mapSection.value)
  } else {
    // No observer: mount it rather than leave an empty frame for ever.
    mapArmed.value = true
  }

  reduced.value = prefersReducedMotion()
  if (reduced.value) return
  window.addEventListener('scroll', onScroll, { passive: true })
  if (window.matchMedia?.('(pointer: fine)').matches) {
    hero.value?.addEventListener('pointermove', onPointerMove, { passive: true })
  }
})

onUnmounted(() => {
  mapArmObserver?.disconnect()
  window.removeEventListener('scroll', onScroll)
  hero.value?.removeEventListener('pointermove', onPointerMove)
  cancelAnimationFrame(pointerFrame)
  cancelAnimationFrame(scrollFrame)
})

// ── Static content ──────────────────────────────────────────────────────
// These are the council's own published facts (vungurdc.org.zw), not live
// readings, and they are not dressed up as live ones. Anything that changes
// with the data lives in `figures` above.

const SERVICES = [
  {
    to: { path: '/citizen', query: { section: 'new' } },
    icon: FileText,
    title: 'Apply for a development permit',
    desc: 'Lodge a development application on Form TPD.1 and follow it from registration to decision.',
    meta: 'Planning & Environment',
    action: 'Apply',
  },
  {
    to: '/council/stand-application',
    icon: Building2,
    title: 'Apply for a stand',
    desc: 'Residential, commercial and industrial stands at the district growth points.',
    meta: 'Rural District Development',
    action: 'How to apply',
  },
  {
    to: '/plan-review',
    icon: ClipboardList,
    title: 'Submit building plans',
    desc: 'Lodge plans for scrutiny, then book the stage inspections as the work proceeds.',
    meta: 'Building control',
    action: 'Submit',
  },
  {
    to: '/payments',
    icon: CreditCard,
    title: 'Pay council fees',
    desc: 'Settle rates, application fees and other council charges, and download the receipt.',
    meta: 'Finance',
    action: 'Pay',
  },
  {
    to: '/explorer',
    icon: MapIcon,
    title: 'Explore the district map',
    desc: 'Wards, zoning, roads, water points, land use and facilities on the live council basemap.',
    meta: 'Spatial explorer',
    action: 'Open the map',
  },
  {
    to: '/council/publications',
    icon: ScrollText,
    title: 'Read council publications',
    desc: 'The strategic plan, the master plan, the annual plan and the budget notices.',
    meta: 'Public documents',
    action: 'Browse',
  },
]

const DEPARTMENTS = [
  { icon: Landmark, name: 'Planning & Environment', desc: 'Land-use planning, development permits and environmental scrutiny.', to: '/council/planning-environment' },
  { icon: RouteIcon, name: 'Roads & Works', desc: 'Roads, bridges, council buildings, plant and works.', to: '/council/roads-works' },
  { icon: Activity, name: 'Social Services', desc: 'Health, education, social welfare and emergency assistance.', to: '/council/social-services' },
  { icon: Droplets, name: 'Water & Sanitation (DSSWC)', desc: 'Rural water supply and sanitation across the district.', to: '/council/dsswc' },
  { icon: BarChart3, name: 'Finance', desc: 'Budgets, rates, billing and the council’s financial management.', to: '/council/finance' },
  { icon: Briefcase, name: 'Local Economic Development', desc: 'Investment promotion, value addition and local enterprise.', to: '/council/led' },
  { icon: Users, name: 'Human Resources & Administration', desc: 'Staffing, conditions of service and council administration.', to: '/council/hr-admin' },
  { icon: Building2, name: 'Rural District Development', desc: 'The district development plan and long-term planning.', to: '/council/rddc' },
  { icon: TreePine, name: 'Insukamini Area Committee', desc: 'Local governance for the Insukamini growth point and surrounds.', to: '/council/insukamini' },
]

const INVESTMENT = [
  { icon: Sprout, title: 'Agriculture', desc: 'Natural farming regions 3 and 4, with commercial and smallholder opportunities across the district’s arable land.' },
  { icon: Pickaxe, title: 'Mining', desc: 'An active mining corridor — gold, chrome and other minerals, with road and power infrastructure already in place.' },
  { icon: Sun, title: 'Solar energy', desc: 'Council-supported solar development for off-grid and grid-tied generation across the nineteen wards.' },
  { icon: Store, title: 'Retail & commerce', desc: 'Commercial sites at the Muchakatata, Maboleni and Insukamini growth points.' },
  { icon: Binoculars, title: 'Tourism', desc: 'Linton Safari Park, Antelope Park and four intensive conservation areas with ecotourism potential.' },
]

const GOVERNANCE = [
  { count: '19', label: 'elected ward councillors' },
  { count: '6', label: 'women’s quota councillors' },
  { count: '4', label: 'traditional chiefs' },
  { count: '9', label: 'headmen' },
  { count: '215', label: 'village heads' },
  { count: '9', label: 'deliberative committees' },
]
</script>

<template>
  <div class="home-view">
    <SiteHeader />

    <main id="main" class="main-stage">
      <!-- ═══ 1. Hero ═══════════════════════════════════════════════ -->
      <section
        ref="hero"
        class="hero"
        :style="{ '--scroll-depth': scrollDepth }"
        aria-labelledby="hero-title"
      >
        <DistrictMap class="hero-backdrop" scrim :drift="true" />

        <div class="hero-inner">
          <p class="hero-eyebrow" v-reveal>
            <span class="council-badge-dot" aria-hidden="true"></span>
            Midlands Province · Zimbabwe
          </p>

          <h1 id="hero-title" class="hero-title">
            <span class="hero-line" v-reveal.up="0">Vungu Rural</span>
            <span class="hero-line" v-reveal.up="90">District Council</span>
          </h1>

          <p class="hero-motto" v-reveal.up="180">For Sustainable Development</p>

          <p class="hero-lede" v-reveal.up="250">
            Planning permission, building plans, stands, rates and the district
            spatial register — handled online, from wherever you are. The map
            behind this page is the council’s own, drawn live from its records.
          </p>

          <div class="hero-actions" v-reveal.up="320">
            <RouterLink :to="{ path: '/citizen', query: { section: 'new' } }" class="hero-btn-primary hero-btn-lg">
              Apply for a permit
              <ArrowRight :size="17" aria-hidden="true" />
            </RouterLink>
            <RouterLink to="/explorer" class="hero-btn-secondary hero-btn-lg">
              <MapIcon :size="17" aria-hidden="true" />
              Explore the district map
            </RouterLink>
          </div>

          <p class="hero-visitor-note" v-reveal.up="380">
            Browsing is open to everyone — no account needed.
            <RouterLink v-if="!auth.isAuthenticated" to="/login">Council staff sign in here.</RouterLink>
          </p>

          <!-- Live figure strip -->
          <dl class="hero-strip" v-reveal.up="440">
            <div v-for="f in heroFigures" :key="f.key" class="hero-stat">
              <dt class="hero-stat-label">{{ f.label }}</dt>
              <dd class="hero-stat-value">
                <span v-if="figuresLoading && !figuresReady" class="figure-skeleton figure-skeleton--sm"></span>
                <template v-else>{{ compactFigure(f.value) }}</template>
              </dd>
            </div>
          </dl>
        </div>

        <a class="hero-scroll-cue" href="#register" aria-label="Skip to the district register">
          <ChevronDown :size="18" aria-hidden="true" />
        </a>
      </section>

      <!-- ═══ 2. The district, from the register ════════════════════ -->
      <section id="register" class="section section--register" aria-labelledby="register-title">
        <div class="section-inner">
          <header class="section-head" v-reveal>
            <p class="ds-eyebrow">Live from the spatial register</p>
            <h2 id="register-title" class="ds-heading">The district, as the data holds it</h2>
            <p class="ds-subtext">
              Every figure below is read from the council’s PostGIS database when
              this page loads. None of them is typed in, and a figure the database
              cannot supply is shown as a dash rather than a zero.
            </p>
          </header>

          <!-- Error: the page is fine, the figures are not. Say only that. -->
          <div v-if="figuresError" class="register-error" role="status">
            <AlertCircle :size="18" aria-hidden="true" />
            <p>{{ figuresError }}</p>
            <button type="button" class="hero-btn-secondary btn-sm" @click="refreshFigures(true)">
              <RotateCw :size="14" aria-hidden="true" />
              Try again
            </button>
          </div>

          <div v-else class="figure-grid" v-stagger="60">
            <FigureTile
              v-for="f in registerFigures"
              :key="f.key"
              v-reveal.up
              :label="f.label"
              :value="f.value"
              :unit="f.unit"
              :source="f.source"
              :loading="figuresLoading"
            />
          </div>

          <p v-if="asOfPhrase && !figuresError" class="register-asof" v-reveal>
            {{ asOfPhrase }}. Figures cover the Vungu Rural District Council area
            (Gweru district, ZW1704).
          </p>
        </div>
      </section>

      <!-- ═══ 3. Council services ══════════════════════════════════ -->
      <section class="section section--services" aria-labelledby="services-title">
        <div class="section-inner">
          <header class="section-head" v-reveal>
            <p class="ds-eyebrow">Online services</p>
            <h2 id="services-title" class="ds-heading">What would you like to do?</h2>
            <p class="ds-subtext">
              Six council processes that run end to end in this portal, without a
              trip to the offices in Gweru.
            </p>
          </header>

          <div class="ds-grid" v-stagger="70">
            <RouterLink
              v-for="service in SERVICES"
              :key="service.title"
              v-reveal.up
              :to="service.to"
              class="dataset-card ds-card-link"
            >
              <span class="ds-card-accent" aria-hidden="true"></span>
              <span class="ds-card-body">
                <span class="ds-card-icon" aria-hidden="true">
                  <component :is="service.icon" :size="22" />
                </span>
                <span class="ds-card-text">
                  <span class="ds-card-title">{{ service.title }}</span>
                  <span class="ds-card-desc">{{ service.desc }}</span>
                </span>
              </span>
              <span class="ds-card-footer">
                <span class="ds-card-meta">{{ service.meta }}</span>
                <span class="ds-card-cta">{{ service.action }} <ArrowRight :size="13" aria-hidden="true" /></span>
              </span>
            </RouterLink>
          </div>
        </div>
      </section>

      <!-- ═══ 4. Map + gazetteer ═══════════════════════════════════ -->
      <section ref="mapSection" class="section section--map" aria-labelledby="map-title">
        <div class="section-inner">
          <header class="section-head" v-reveal>
            <p class="ds-eyebrow">District map</p>
            <h2 id="map-title" class="ds-heading">Find a place in Vungu</h2>
            <p class="ds-subtext">
              Search the council gazetteer — wards, growth points, farms, parcels,
              stands, roads and facilities — and the map moves to it.
            </p>
          </header>

          <div class="map-layout" v-reveal>
            <!-- Search rail -->
            <div class="map-rail">
              <div class="map-search">
                <label class="sr-only" for="gazetteer">Search the district gazetteer</label>
                <span class="map-search-icon" aria-hidden="true"><Search :size="16" /></span>
                <input
                  id="gazetteer"
                  v-model="query"
                  type="search"
                  class="map-search-input"
                  placeholder="Ward, farm, growth point, stand number…"
                  autocomplete="off"
                  spellcheck="false"
                  :maxlength="MAX_QUERY"
                  :aria-describedby="searchNotice || searchError ? 'gazetteer-note' : undefined"
                  @input="onInput"
                  @keydown.enter.prevent="submitSearch"
                  @keydown.escape="clearSearch"
                />
                <button
                  v-if="query"
                  type="button"
                  class="map-search-clear"
                  aria-label="Clear the search"
                  @click="clearSearch"
                >
                  <X :size="15" aria-hidden="true" />
                </button>
              </div>

              <p v-if="searchNotice || searchError" id="gazetteer-note" class="map-note" role="status">
                {{ searchError || searchNotice }}
              </p>

              <div v-if="!query" class="map-examples">
                <span class="map-examples-label">Try</span>
                <button
                  v-for="term in EXAMPLES"
                  :key="term"
                  type="button"
                  class="map-chip"
                  @click="runExample(term)"
                >{{ term }}</button>
              </div>

              <!-- Results / states -->
              <p v-if="searching" class="map-note" role="status">Searching the gazetteer…</p>

              <ul v-else-if="hits.length" class="map-hits">
                <li v-for="hit in hits" :key="hit.id">
                  <button type="button" class="map-hit" @click="flyTo(hit)">
                    <span class="map-hit-dot" :data-type="hit.type" aria-hidden="true"></span>
                    <span class="map-hit-text">
                      <span class="map-hit-label">{{ hit.label }}</span>
                      <span v-if="hit.subtitle" class="map-hit-sub">{{ hit.subtitle }}</span>
                    </span>
                    <span v-if="hit.inDistrict === false" class="map-hit-flag">outside Vungu</span>
                  </button>
                </li>
              </ul>

              <p v-else-if="searched && !searchError" class="map-note" role="status">
                Nothing in the gazetteer matches “{{ query.trim() }}”. Try a ward
                number, a growth point, or a farm name.
              </p>

              <!-- Layers -->
              <div class="map-layers">
                <button
                  type="button"
                  class="map-layers-toggle"
                  :aria-expanded="layersOpen"
                  @click="layersOpen = !layersOpen"
                >
                  <Layers :size="14" aria-hidden="true" />
                  <span>Map layers</span>
                  <ChevronDown :size="14" :class="{ 'is-flipped': layersOpen }" aria-hidden="true" />
                </button>
                <div v-show="layersOpen" class="map-layers-grid">
                  <label v-for="group in LAYER_GROUPS" :key="group.label" class="map-layer-chip">
                    <input
                      type="checkbox"
                      :checked="groupOn(group.ids)"
                      @change="toggleGroup(group.ids, ($event.target as HTMLInputElement).checked)"
                    />
                    <span>{{ group.label }}</span>
                  </label>
                </div>
              </div>

              <RouterLink to="/explorer" class="map-rail-link">
                Open the full explorer
                <ArrowRight :size="14" aria-hidden="true" />
              </RouterLink>
            </div>

            <!-- Map -->
            <div class="map-frame">
              <div class="map-frame-bar">
                <span class="map-frame-label">Vungu Rural District Council — live basemap</span>
                <span class="map-frame-live">
                  <span class="council-badge-dot" aria-hidden="true"></span> PostGIS
                </span>
              </div>
              <div class="map-frame-body">
                <DistrictMap v-if="mapArmed" ref="homeMapRef" interactive :drift="false" :zoom="9.6" />
                <p v-else class="map-frame-placeholder">Loading the district basemap…</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ═══ 5. Departments ═══════════════════════════════════════ -->
      <section class="section section--depts" aria-labelledby="depts-title">
        <div class="section-inner">
          <header class="section-head" v-reveal>
            <p class="ds-eyebrow">How the council is organised</p>
            <h2 id="depts-title" class="ds-heading">Departments &amp; committees</h2>
            <p class="ds-subtext">
              Nine departments and committees serving all nineteen wards. Each one
              has a page setting out what it does and who to contact.
            </p>
          </header>

          <div class="dept-grid" v-stagger="55">
            <RouterLink
              v-for="dept in DEPARTMENTS"
              :key="dept.name"
              v-reveal.up
              :to="dept.to"
              class="dept-card"
            >
              <span class="dept-icon" aria-hidden="true"><component :is="dept.icon" :size="19" /></span>
              <span class="dept-text">
                <span class="dept-name">{{ dept.name }}</span>
                <span class="dept-desc">{{ dept.desc }}</span>
              </span>
              <ArrowRight :size="15" class="dept-arrow" aria-hidden="true" />
            </RouterLink>
          </div>
        </div>
      </section>

      <!-- ═══ 6. Investment ════════════════════════════════════════ -->
      <section class="section section--invest" aria-labelledby="invest-title">
        <div class="section-inner">
          <header class="section-head section-head--light" v-reveal>
            <p class="ds-eyebrow">Investor friendly environment</p>
            <h2 id="invest-title" class="ds-heading">Invest in Vungu District</h2>
            <p class="ds-subtext">
              Five sectors the council actively supports, across a district of
              {{ figuresReady ? formatFigure(figures.hectares) : '—' }} mapped hectares
              between the Gwai and Sanyati catchments.
            </p>
          </header>

          <div class="invest-grid" v-stagger="80">
            <article v-for="item in INVESTMENT" :key="item.title" v-reveal.up class="invest-card">
              <span class="invest-icon" aria-hidden="true"><component :is="item.icon" :size="20" /></span>
              <h3 class="invest-title">{{ item.title }}</h3>
              <p class="invest-desc">{{ item.desc }}</p>
            </article>
          </div>

          <div class="invest-cta" v-reveal>
            <p>Enquiries about investing or developing in the district</p>
            <a :href="`mailto:${COUNCIL_CONTACT.email}`" class="hero-btn-primary">
              <Mail :size="16" aria-hidden="true" />
              {{ COUNCIL_CONTACT.email }}
            </a>
          </div>
        </div>
      </section>

      <!-- ═══ 7. Governance ════════════════════════════════════════ -->
      <section class="section section--gov" aria-labelledby="gov-title">
        <div class="section-inner gov-layout">
          <div class="gov-copy" v-reveal>
            <p class="ds-eyebrow">Accountability</p>
            <h2 id="gov-title" class="ds-heading">Who governs Vungu</h2>
            <p class="ds-subtext">
              The council runs on a deliberative and an executive arm: elected ward
              councillors and traditional leadership set policy, and a professional
              management team carries it out.
            </p>

            <dl class="gov-grid" v-stagger="50">
              <div v-for="row in GOVERNANCE" :key="row.label" v-reveal.up class="gov-stat">
                <dt class="gov-stat-num">{{ row.count }}</dt>
                <dd class="gov-stat-label">{{ row.label }}</dd>
              </div>
            </dl>

            <div class="gov-links">
              <RouterLink to="/council/deliberative-arm" class="hero-btn-secondary btn-sm">Deliberative arm</RouterLink>
              <RouterLink to="/council/executive-arm" class="hero-btn-secondary btn-sm">Executive arm</RouterLink>
              <RouterLink to="/council/publications" class="hero-btn-secondary btn-sm">Publications</RouterLink>
            </div>
          </div>

          <!-- ═══ 8. Contact ═════════════════════════════════════════ -->
          <aside class="gov-contact" v-reveal.up="120" aria-labelledby="contact-title">
            <h3 id="contact-title" class="gov-contact-title">Reach the council</h3>
            <ul class="gov-contact-list">
              <li>
                <MapPin :size="16" aria-hidden="true" />
                <span>
                  <span class="gov-contact-label">Council offices</span>
                  <a
                    href="https://maps.google.com/?q=19+Lincoln+Road+Light+Industrial+Site+Gweru"
                    target="_blank"
                    rel="noopener noreferrer"
                  >{{ COUNCIL_CONTACT.address }}</a>
                </span>
              </li>
              <li>
                <Phone :size="16" aria-hidden="true" />
                <span>
                  <span class="gov-contact-label">Telephone</span>
                  <a :href="COUNCIL_CONTACT.phoneHref">{{ COUNCIL_CONTACT.phone }}</a>
                </span>
              </li>
              <li>
                <Mail :size="16" aria-hidden="true" />
                <span>
                  <span class="gov-contact-label">Email</span>
                  <a :href="`mailto:${COUNCIL_CONTACT.email}`">{{ COUNCIL_CONTACT.email }}</a>
                </span>
              </li>
              <li>
                <Clock :size="16" aria-hidden="true" />
                <span>
                  <span class="gov-contact-label">Office hours</span>
                  <span>{{ COUNCIL_CONTACT.hours }}</span>
                </span>
              </li>
              <li>
                <Globe :size="16" aria-hidden="true" />
                <span>
                  <span class="gov-contact-label">Council website</span>
                  <a href="https://vungurdc.org.zw" target="_blank" rel="noopener noreferrer">
                    vungurdc.org.zw <ExternalLink :size="12" aria-hidden="true" />
                  </a>
                </span>
              </li>
            </ul>
            <RouterLink to="/contact" class="hero-btn-primary gov-contact-cta">
              Send the council a message
              <ArrowRight :size="15" aria-hidden="true" />
            </RouterLink>
          </aside>
        </div>
      </section>
    </main>

    <SiteFooter />
  </div>
</template>
