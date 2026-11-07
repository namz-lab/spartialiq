<script setup lang="ts">
/**
 * Finance workspace — Chegutu Water-GIS finance component, rebuilt for Vungu.
 *
 * Sections mirror the technical report:
 *   Overview · Accounts · Balance map · Districts · Trends · Clearances ·
 *   Receipts · Tariff · Workflows
 *
 * Cadastre-linked: every account sits on a land.parcel / stand. Payments,
 * section 109 clearances and permit fees surface in the same console.
 */
import {
  computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  LayoutDashboard, Search, Map as MapIcon, Building2, TrendingUp,
  FileBadge, Receipt, ScrollText, GitBranch, RefreshCw, Landmark,
  ArrowLeft, Check, X, Smartphone,
} from 'lucide-vue-next'
import { financeApi } from '@/services/financeApi'
import './finance/finance-workspace.css'
import 'maplibre-gl/dist/maplibre-gl.css'

type Section =
  | 'overview' | 'accounts' | 'map' | 'districts'
  | 'trends' | 'rails' | 'clearances' | 'receipts' | 'tariff' | 'workflows'

const SECTIONS: { key: Section; label: string; icon: typeof LayoutDashboard; hint: string }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, hint: 'KPIs' },
  { key: 'accounts', label: 'Accounts', icon: Search, hint: 'Search' },
  { key: 'map', label: 'Balance map', icon: MapIcon, hint: 'Cadastre' },
  { key: 'districts', label: 'Districts', icon: Building2, hint: 'Areas' },
  { key: 'trends', label: 'Trends', icon: TrendingUp, hint: '6 mo' },
  { key: 'rails', label: 'Zimbabwe rails', icon: Smartphone, hint: 'ZWG' },
  { key: 'clearances', label: 'Clearances', icon: FileBadge, hint: 's109' },
  { key: 'receipts', label: 'Receipts', icon: Receipt, hint: 'Paid' },
  { key: 'tariff', label: 'Tariff', icon: ScrollText, hint: 'Fees' },
  { key: 'workflows', label: 'Workflows', icon: GitBranch, hint: 'Links' },
]

const route = useRoute()
const router = useRouter()

const section = ref<Section>((route.query.section as Section) || 'overview')
const loading = ref(false)
const error = ref('')
const flash = ref('')

const overview = ref<any>(null)
const districts = ref<any[]>([])
const accounts = ref<any[]>([])
const accountsTotal = ref(0)
const selectedAccount = ref<any>(null)
const accountDetail = ref<any>(null)
const trends = ref<any[]>([])
const clearances = ref<any[]>([])
const receipts = ref<any[]>([])
const tariff = ref<any[]>([])
const tariffNote = ref('')
const workflows = ref<any>(null)
const rails = ref<any>(null)

const q = ref('')
const filterDistrict = ref('')
const filterStatus = ref('')
const owingOnly = ref(false)

const mapHost = ref<HTMLDivElement | null>(null)
const mapRef = shallowRef<any>(null)
let maplibreglMod: any = null
const mapMode = ref<'stands' | 'districts' | 'accounts'>('stands')
let orbitFrame = 0
let orbitPaused = false
let orbitResume: ReturnType<typeof setTimeout> | null = null

function motionAllowed() {
  return typeof window === 'undefined'
    || !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function stopOrbit() {
  if (orbitFrame) cancelAnimationFrame(orbitFrame)
  orbitFrame = 0
  if (orbitResume) clearTimeout(orbitResume)
  orbitResume = null
}

function startOrbit() {
  stopOrbit()
  if (!motionAllowed()) return
  orbitPaused = false
  let last = performance.now()
  const step = (now: number) => {
    orbitFrame = requestAnimationFrame(step)
    const map = mapRef.value
    if (!map || orbitPaused) {
      last = now
      return
    }
    const dt = Math.min(48, now - last)
    last = now
    map.setBearing(map.getBearing() + dt * 0.012)
  }
  orbitFrame = requestAnimationFrame(step)
}

function pauseOrbit() {
  orbitPaused = true
  if (orbitResume) clearTimeout(orbitResume)
}

function resumeOrbitSoon() {
  if (orbitResume) clearTimeout(orbitResume)
  orbitResume = setTimeout(() => { orbitPaused = false }, 2200)
}

const usd = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n))
    ? '—'
    : `USD ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const maxDistrictBalance = computed(() =>
  Math.max(1, ...districts.value.map((d) => Number(d.balanceUsd) || 0)),
)
const maxTrend = computed(() =>
  Math.max(1, ...trends.value.flatMap((t) => [Number(t.billedUsd) || 0, Number(t.collectedUsd) || 0])),
)
const maxArrearsBar = computed(() =>
  Math.max(1, ...(overview.value?.topArrears || []).map((a: any) => Number(a.balanceUsd) || 0)),
)
const maxRate = computed(() =>
  Math.max(1, ...(rails.value?.series || []).map((r: any) => Number(r.rate) || 0)),
)
const zwg = (usdAmount: number | null | undefined) => {
  const rate = Number(rails.value?.rate?.rate)
  if (!rate || usdAmount == null) return '—'
  return `ZWG ${(Number(usdAmount) * rate).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

watch(section, (s) => {
  if (s !== 'map') {
    stopOrbit()
    destroyMap()
  }
  router.replace({ query: { ...route.query, section: s } })
  loadSection()
})

onMounted(async () => {
  await loadCore()
  await loadSection()
})

onBeforeUnmount(() => {
  stopOrbit()
  destroyMap()
})

async function loadCore() {
  loading.value = true
  error.value = ''
  try {
    const [ov, dist, rl] = await Promise.all([
      financeApi.overview(),
      financeApi.districts(),
      financeApi.rails(),
    ])
    overview.value = ov.data?.data || null
    districts.value = dist.data?.data || []
    rails.value = rl.data?.data || null
  } catch (e: any) {
    error.value = e?.response?.data?.error || e?.message || 'Failed to load finance overview'
  } finally {
    loading.value = false
  }
}

async function loadSection() {
  error.value = ''
  flash.value = ''
  loading.value = true
  try {
    if (section.value === 'overview') {
      await loadCore()
      const tr = await financeApi.trends()
      trends.value = tr.data?.data || []
    } else if (section.value === 'accounts') {
      await searchAccounts()
    } else if (section.value === 'map') {
      await nextTick()
      await ensureMap()
    } else if (section.value === 'districts') {
      const dist = await financeApi.districts()
      districts.value = dist.data?.data || []
    } else if (section.value === 'rails') {
      const rl = await financeApi.rails()
      rails.value = rl.data?.data || null
    } else if (section.value === 'trends') {
      const tr = await financeApi.trends(
        filterDistrict.value ? { district: filterDistrict.value } : undefined,
      )
      trends.value = tr.data?.data || []
    } else if (section.value === 'clearances') {
      const cl = await financeApi.clearances()
      clearances.value = cl.data?.data || []
    } else if (section.value === 'receipts') {
      const rc = await financeApi.receipts({ limit: 80 })
      receipts.value = rc.data?.data || []
    } else if (section.value === 'tariff') {
      const tf = await financeApi.tariff()
      tariff.value = tf.data?.data || []
      tariffNote.value = tf.data?.note || ''
    } else if (section.value === 'workflows') {
      const wf = await financeApi.workflows()
      workflows.value = wf.data?.data || null
    }
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Load failed'
  } finally {
    loading.value = false
  }
}

async function searchAccounts() {
  loading.value = true
  error.value = ''
  try {
    const res = await financeApi.accounts({
      q: q.value || undefined,
      district: filterDistrict.value || undefined,
      status: filterStatus.value || undefined,
      owing: owingOnly.value ? '1' : undefined,
      limit: 80,
    })
    accounts.value = res.data?.data?.accounts || []
    accountsTotal.value = res.data?.data?.total || 0
  } catch (e: any) {
    error.value = e?.response?.data?.error || e?.message || 'Account search failed'
  } finally {
    loading.value = false
  }
}

async function openAccount(accountNo: string) {
  loading.value = true
  error.value = ''
  try {
    const res = await financeApi.account(accountNo)
    accountDetail.value = res.data?.data || null
    selectedAccount.value = accountDetail.value?.account || null
    section.value = 'accounts'
  } catch (e: any) {
    error.value = e?.response?.data?.error || e?.message || 'Account not found'
  } finally {
    loading.value = false
  }
}

function closeAccount() {
  accountDetail.value = null
  selectedAccount.value = null
}

async function decideClearance(id: string, decision: 'clear' | 'refuse') {
  error.value = ''
  flash.value = ''
  try {
    await financeApi.decideClearance(id, {
      decision,
      refusal_reason: decision === 'refuse' ? 'Charges outstanding on the rates account' : undefined,
    })
    flash.value = decision === 'clear' ? 'Section 109 certificate issued' : 'Clearance refused'
    const cl = await financeApi.clearances()
    clearances.value = cl.data?.data || []
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Decision failed'
  }
}

function boundsOf(fc: { features?: { geometry?: { coordinates?: unknown } }[] }) {
  let minX = 180, minY = 90, maxX = -180, maxY = -90
  let seen = false
  const walk = (coords: unknown) => {
    if (!Array.isArray(coords)) return
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      seen = true
      minX = Math.min(minX, coords[0]); maxX = Math.max(maxX, coords[0])
      minY = Math.min(minY, coords[1]); maxY = Math.max(maxY, coords[1])
      return
    }
    coords.forEach(walk)
  }
  for (const f of fc.features || []) walk(f.geometry?.coordinates)
  return seen ? [[minX, minY], [maxX, maxY]] as [[number, number], [number, number]] : null
}

function destroyMap() {
  stopOrbit()
  if (mapRef.value) {
    try { mapRef.value.remove() } catch { /* already gone */ }
    mapRef.value = null
  }
}

async function ensureMap() {
  if (!mapHost.value) return
  if (!maplibreglMod) {
    maplibreglMod = (await import('maplibre-gl')).default
  }
  destroyMap()
  const map = new maplibreglMod.Map({
    container: mapHost.value,
    style: {
      version: 8,
      sources: {},
      layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ebe6da' } }],
      glyphs: '/fonts/{fontstack}/{range}.pbf',
    },
    center: [29.82765, -19.5108],
    zoom: 14.1,
    pitch: 58,
    bearing: -24,
    attributionControl: false,
  })
  map.addControl(new maplibreglMod.NavigationControl({ showCompass: false }), 'top-right')
  map.addControl(new maplibreglMod.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')
  map.on('mousedown', pauseOrbit)
  map.on('touchstart', pauseOrbit)
  map.on('wheel', pauseOrbit)
  map.on('mouseup', resumeOrbitSoon)
  map.on('touchend', resumeOrbitSoon)
  map.on('zoomend', resumeOrbitSoon)
  map.on('rotatestart', (e: { originalEvent?: Event }) => { if (e.originalEvent) pauseOrbit() })
  map.on('rotateend', (e: { originalEvent?: Event }) => { if (e.originalEvent) resumeOrbitSoon() })
  map.on('click', (e: { point: unknown; lngLat: unknown }) => {
    const layers = ['fx-stand-extrude', 'fx-district-extrude', 'fx-account-circles']
      .filter((id) => map.getLayer(id))
    if (!layers.length) return
    const f = map.queryRenderedFeatures(e.point, { layers })[0]
    if (!f) return
    const p = f.properties || {}
    const html = f.layer.id === 'fx-district-extrude'
      ? `<strong>${p.name || p.code}</strong><br/>Accounts: ${p.accounts}<br/>Owing: USD ${Number(p.balanceUsd || 0).toFixed(2)}<br/>In arrears: ${p.arrearsCount}`
      : `<strong>${p.standNo}</strong><br/>${p.holder || ''}<br/>${p.accountNo}<br/>Balance USD ${Number(p.balanceUsd || 0).toFixed(2)}`
    new maplibreglMod.Popup({ closeButton: true, maxWidth: '280px' })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(map)
    if (p.accountNo) openAccount(String(p.accountNo))
  })
  map.on('mousemove', (e: { point: unknown }) => {
    const layers = ['fx-stand-extrude', 'fx-district-extrude', 'fx-account-circles']
      .filter((id) => map.getLayer(id))
    const hit = layers.length && map.queryRenderedFeatures(e.point, { layers }).length
    map.getCanvas().style.cursor = hit ? 'pointer' : ''
  })
  mapRef.value = map

  map.on('load', async () => {
    try {
      const { addVunguBasemap } = await import('@/map/vunguBasemap')
      await addVunguBasemap(map, { interactive: false, autoTilt: false })
    } catch { /* basemap optional */ }
    await paintFinanceLayers()
  })
}

async function paintFinanceLayers() {
  const map = mapRef.value
  if (!map) return
  // Clear previous finance layers
  for (const id of ['fx-district-fill', 'fx-district-line', 'fx-district-extrude', 'fx-stand-extrude', 'fx-account-circles']) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  for (const id of ['fx-districts', 'fx-accounts', 'fx-stands']) {
    if (map.getSource(id)) map.removeSource(id)
  }

  if (mapMode.value === 'stands') {
    const res = await financeApi.mapExtrude({ scope: owingOnly.value ? 'owing' : 'layout' })
    const fc = res.data?.data || { type: 'FeatureCollection', features: [] }
    const cam = res.data?.camera
    map.addSource('fx-stands', { type: 'geojson', data: fc })
    map.addLayer({
      id: 'fx-stand-extrude',
      type: 'fill-extrusion',
      source: 'fx-stands',
      paint: {
        'fill-extrusion-height': ['get', 'heightM'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.9,
        'fill-extrusion-color': [
          'case',
          ['==', ['get', 'statusBand'], 'in_arrears'], '#bd2f28',
          ['>', ['get', 'balanceUsd'], 0], '#a8620a',
          '#1f5aa8',
        ],
      },
    })
    const features = fc.features || []
    const peak = features.reduce((best: { properties?: { heightM?: number } } | null, f: { properties?: { heightM?: number } }) => {
      const h = Number(f.properties?.heightM) || 0
      return h > (Number(best?.properties?.heightM) || 0) ? f : best
    }, null)
    const peakBox = peak ? boundsOf({ features: [peak] }) : null
    if (peakBox) {
      const center: [number, number] = [(peakBox[0][0] + peakBox[1][0]) / 2, (peakBox[0][1] + peakBox[1][1]) / 2]
      map.jumpTo({ center, zoom: 16.7, pitch: 64, bearing: -38 })
    } else if (cam?.center) {
      map.jumpTo({ center: cam.center, zoom: 16.4, pitch: 64, bearing: -38 })
    }
    startOrbit()
  } else if (mapMode.value === 'districts') {
    const res = await financeApi.mapDistricts()
    const fc = res.data?.data || { type: 'FeatureCollection', features: [] }
    map.addSource('fx-districts', { type: 'geojson', data: fc })
    map.addLayer({
      id: 'fx-district-extrude',
      type: 'fill-extrusion',
      source: 'fx-districts',
      paint: {
        'fill-extrusion-height': ['*', ['ln', ['+', 1, ['to-number', ['get', 'balanceUsd']]]], 90],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.82,
        'fill-extrusion-color': [
          'interpolate', ['linear'], ['to-number', ['get', 'balanceUsd']],
          0, '#b9d1ec',
          80, '#1f5aa8',
          250, '#a8620a',
          600, '#bd2f28',
        ],
      },
    })
    map.jumpTo({ center: [29.7, -19.45], zoom: 9.2, pitch: 52, bearing: -18 })
    startOrbit()
  } else {
    const res = await financeApi.mapAccounts({
      owing: owingOnly.value ? '1' : undefined,
      district: filterDistrict.value || undefined,
      limit: 800,
    })
    const fc = res.data?.data || { type: 'FeatureCollection', features: [] }
    map.addSource('fx-accounts', { type: 'geojson', data: fc })
    map.addLayer({
      id: 'fx-account-circles',
      type: 'circle',
      source: 'fx-accounts',
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['get', 'balanceUsd'],
          0, 4,
          50, 7,
          200, 11,
          800, 16,
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'statusBand'], 'in_arrears'], '#bd2f28',
          ['>', ['get', 'balanceUsd'], 0], '#a8620a',
          '#1f5aa8',
        ],
        'circle-opacity': 0.85,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#fff',
      },
    })
    startOrbit()
  }
}

watch(mapMode, async () => {
  if (section.value === 'map' && mapRef.value) {
    loading.value = true
    try { await paintFinanceLayers() }
    finally { loading.value = false }
  }
})

async function refreshAll() {
  await loadCore()
  await loadSection()
}
</script>

<template>
  <div class="fx-root" data-testid="finance-workspace">
    <div class="fx-shell">
      <aside class="fx-rail" aria-label="Finance sections">
        <div class="fx-brand">
          <span class="fx-brand-kicker">Vungu RDC · Finance</span>
          <strong>Revenue console</strong>
          <span class="sub">Cadastre-linked accounts, balances and clearances</span>
        </div>

        <button
          v-for="s in SECTIONS"
          :key="s.key"
          type="button"
          class="fx-nav-btn"
          :class="{ 'is-active': section === s.key }"
          :data-testid="`fx-nav-${s.key}`"
          :aria-current="section === s.key ? 'page' : undefined"
          @click="section = s.key; closeAccount()"
        >
          <component :is="s.icon" :size="16" />
          <span>{{ s.label }}</span>
          <em>{{ s.hint }}</em>
        </button>

        <div class="fx-rail-foot">
          Demonstration roll linked to {{ overview?.accounts ?? '…' }} parcels.
          <router-link to="/payments">Take a payment</router-link>
          ·
          <router-link to="/statutory-registers?tab=clearances">Statutory registers</router-link>
        </div>
      </aside>

      <main class="fx-main">
        <header class="fx-head">
          <div>
            <span class="fx-eyebrow">Finance · GIS-linked billing</span>
            <h1>{{ SECTIONS.find(s => s.key === section)?.label }}</h1>
            <p class="lede">
              Chegutu pattern for Vungu: search an account, read the balance on the stand,
              summarise by billing district, and see payments, clearances and permit fees on the same file.
            </p>
          </div>
          <div class="fx-actions">
            <button type="button" class="fx-btn" :disabled="loading" data-testid="fx-refresh" @click="refreshAll">
              <RefreshCw :size="15" /> Refresh
            </button>
            <router-link class="fx-btn primary" to="/payments">
              <Landmark :size="15" /> Payment counter
            </router-link>
          </div>
        </header>

        <p v-if="error" class="fx-err" role="alert" data-testid="fx-error">{{ error }}</p>
        <p v-if="flash" class="fx-okmsg" role="status">{{ flash }}</p>
        <p class="fx-note">
          {{ overview?.note || 'Balances are a working demonstration roll. Finance replaces figures when Council adopts a gazetted tariff or an ERP extract.' }}
        </p>

        <!-- ═══ OVERVIEW ═══ -->
        <template v-if="section === 'overview' && overview">
          <div class="fx-kpis">
            <div class="fx-kpi">
              <div class="label">Accounts</div>
              <div class="value">{{ overview.accounts.toLocaleString() }}</div>
              <div class="hint">{{ overview.districts }} billing districts</div>
            </div>
            <div class="fx-kpi owe">
              <div class="label">Total owing</div>
              <div class="value">{{ usd(overview.totalOwingUsd) }}</div>
              <div class="hint">{{ zwg(overview.totalOwingUsd) }} · {{ overview.owingAccounts }} stands</div>
            </div>
            <div class="fx-kpi owe">
              <div class="label">In arrears</div>
              <div class="value">{{ overview.arrearsCount }}</div>
              <div class="hint">{{ usd(overview.arrearsUsd) }}</div>
            </div>
            <div class="fx-kpi ok">
              <div class="label">Current</div>
              <div class="value">{{ overview.currentCount }}</div>
              <div class="hint">{{ overview.closedCount }} closed</div>
            </div>
            <div class="fx-kpi gold">
              <div class="label">Valuation roll</div>
              <div class="value">{{ usd(overview.totalValuationUsd) }}</div>
              <div class="hint">Working site values</div>
            </div>
            <div class="fx-kpi">
              <div class="label">Receipts this month</div>
              <div class="value">{{ usd(overview.payments.paidThisMonthUsd) }}</div>
              <div class="hint">{{ overview.payments.paidThisMonth }} paid · {{ overview.clearances.queued }} clearances waiting</div>
            </div>
          </div>

          <div class="fx-grid-2">
            <section class="fx-card">
              <div class="fx-card-head"><h2>Balances by billing district</h2></div>
              <div class="fx-card-body">
                <div class="fx-bars">
                  <div v-for="d in districts.slice(0, 12)" :key="d.code" class="fx-bar-row">
                    <span class="name" :title="d.name">{{ d.name }}</span>
                    <div class="fx-bar-track">
                      <div
                        class="fx-bar-fill"
                        :class="{ owe: d.balanceUsd > 100 }"
                        :style="{ width: `${Math.max(4, (d.balanceUsd / maxDistrictBalance) * 100)}%` }"
                      />
                    </div>
                    <span class="amt">{{ usd(d.balanceUsd) }}</span>
                  </div>
                </div>
              </div>
            </section>

            <section class="fx-card">
              <div class="fx-card-head"><h2>Largest balances in 3D</h2></div>
              <div class="fx-card-body">
                <div class="fx-stage" aria-label="Account balances as a 3D stage">
                  <div class="fx-stage-floor">
                    <div
                      v-for="a in (overview.topArrears || [])"
                      :key="a.accountNo"
                      class="fx-prism"
                      :class="{ owe: a.statusBand === 'in_arrears' }"
                      :style="{ height: `${Math.max(12, (a.balanceUsd / maxArrearsBar) * 140)}px` }"
                      :title="`${a.standNo}: ${usd(a.balanceUsd)}`"
                    />
                  </div>
                  <span class="fx-stage-label">Open the balance map for the same stands on the cadastre</span>
                </div>
              </div>
            </section>
          </div>

          <section class="fx-card">
            <div class="fx-card-head"><h2>Collection trend — last six months</h2></div>
            <div class="fx-card-body">
              <div class="fx-trend">
                <div v-for="t in trends" :key="String(t.month)" class="fx-trend-col">
                  <div class="fx-trend-pair">
                    <div class="fx-trend-billed" :style="{ height: `${(t.billedUsd / maxTrend) * 100}%` }" />
                    <div class="fx-trend-collected" :style="{ height: `${(t.collectedUsd / maxTrend) * 100}%` }" />
                  </div>
                  <span>{{ String(t.month).slice(0, 7) }}</span>
                </div>
              </div>
              <p style="margin:0.75rem 0 0;font-size:0.8rem;color:rgba(16,36,31,0.55)">
                Pale = billed · solid = collected. Arrears and collections update when Finance posts the ledger.
              </p>
            </div>
          </section>
        </template>

        <!-- ═══ ACCOUNTS ═══ -->
        <template v-else-if="section === 'accounts'">
          <div v-if="!accountDetail" class="fx-search">
            <input
              v-model="q"
              class="fx-input"
              data-testid="fx-account-q"
              placeholder="Account no, stand, holder…"
              @keydown.enter="searchAccounts"
            />
            <select v-model="filterDistrict" class="fx-select" @change="searchAccounts">
              <option value="">All districts</option>
              <option v-for="d in districts" :key="d.code" :value="d.code">{{ d.name }}</option>
            </select>
            <select v-model="filterStatus" class="fx-select" @change="searchAccounts">
              <option value="">Any status</option>
              <option value="current">Current</option>
              <option value="in_arrears">In arrears</option>
              <option value="closed">Closed</option>
            </select>
            <button type="button" class="fx-btn primary" data-testid="fx-account-search" @click="searchAccounts">
              <Search :size="15" /> Search
            </button>
          </div>

          <label v-if="!accountDetail" style="display:inline-flex;gap:0.4rem;align-items:center;margin-bottom:0.75rem;font-size:0.86rem">
            <input v-model="owingOnly" type="checkbox" @change="searchAccounts" />
            Owing only
          </label>

          <div v-if="accountDetail" class="fx-card" style="margin-bottom:1rem">
            <div class="fx-card-head">
              <button type="button" class="fx-btn" @click="closeAccount"><ArrowLeft :size="15" /> Back</button>
              <h2>{{ accountDetail.account.standNo }} · {{ accountDetail.account.accountNo }}</h2>
              <span class="fx-pill" :class="accountDetail.account.statusBand">{{ accountDetail.account.statusBand }}</span>
            </div>
            <div class="fx-card-body">
              <dl class="fx-detail-grid">
                <div><dt>Account holder</dt><dd>{{ accountDetail.account.accountHolder }}</dd></div>
                <div><dt>District</dt><dd>{{ accountDetail.account.districtName }}</dd></div>
                <div><dt>Category</dt><dd>{{ accountDetail.account.accountCategory }}</dd></div>
                <div><dt>Balance</dt><dd class="fx-mono">{{ usd(accountDetail.account.balanceUsd) }}</dd></div>
                <div><dt>Valuation</dt><dd>{{ usd(accountDetail.account.valuationUsd) }}</dd></div>
                <div><dt>Annual rates</dt><dd>{{ usd(accountDetail.account.annualRatesUsd) }}</dd></div>
                <div><dt>Last payment</dt><dd>{{ accountDetail.account.lastPaymentAt ? usd(accountDetail.account.lastPaymentUsd) : '—' }}</dd></div>
                <div><dt>Parcel</dt><dd class="fx-mono">{{ accountDetail.account.parcelId }}</dd></div>
              </dl>

              <h3 style="margin:0 0 0.5rem;font-size:0.95rem">Ledger</h3>
              <div class="fx-table-wrap" style="max-height:220px;margin-bottom:1rem">
                <table class="fx-table">
                  <thead>
                    <tr><th>Date</th><th>Type</th><th>Purpose</th><th>Description</th><th class="fx-num">Amount</th><th class="fx-num">Balance</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="e in accountDetail.ledger" :key="e.id">
                      <td>{{ String(e.entryDate).slice(0, 10) }}</td>
                      <td>{{ e.entryType }}</td>
                      <td>{{ e.purpose }}</td>
                      <td>{{ e.description }}</td>
                      <td class="fx-num">{{ usd(e.amountUsd) }}</td>
                      <td class="fx-num">{{ usd(e.balanceAfterUsd) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="fx-grid-2">
                <div>
                  <h3 style="margin:0 0 0.5rem;font-size:0.95rem">Linked payments</h3>
                  <ul v-if="accountDetail.payments?.length" style="margin:0;padding-left:1.1rem;font-size:0.86rem">
                    <li v-for="p in accountDetail.payments" :key="p.id">
                      <router-link v-if="p.receiptNo" :to="`/receipt/${p.receiptNo}`">{{ p.receiptNo }}</router-link>
                      <span v-else>{{ p.id.slice(0, 8) }}</span>
                      — {{ p.purpose }} · {{ usd(p.amountUsd) }}
                    </li>
                  </ul>
                  <p v-else style="margin:0;font-size:0.86rem;color:rgba(16,36,31,0.55)">No linked council receipts yet.</p>
                </div>
                <div>
                  <h3 style="margin:0 0 0.5rem;font-size:0.95rem">Rates clearances</h3>
                  <ul v-if="accountDetail.clearances?.length" style="margin:0;padding-left:1.1rem;font-size:0.86rem">
                    <li v-for="c in accountDetail.clearances" :key="c.id">
                      <span class="fx-pill" :class="c.status">{{ c.status }}</span>
                      {{ c.certificate_no || 'pending' }} · {{ c.applicant_name }}
                    </li>
                  </ul>
                  <p v-else style="margin:0;font-size:0.86rem;color:rgba(16,36,31,0.55)">No section 109 requests on this stand.</p>
                </div>
              </div>

              <div v-if="accountDetail.permits?.length" style="margin-top:1rem">
                <h3 style="margin:0 0 0.5rem;font-size:0.95rem">Planning files on this stand</h3>
                <div class="fx-table-wrap" style="max-height:160px">
                  <table class="fx-table">
                    <thead><tr><th>Stand</th><th>Applicant</th><th>Type</th><th>Status</th><th>Fee paid</th></tr></thead>
                    <tbody>
                      <tr v-for="p in accountDetail.permits" :key="p.id">
                        <td>{{ p.stand_number }}</td>
                        <td>{{ p.applicant_name }}</td>
                        <td>{{ p.development_type }}</td>
                        <td>{{ p.status }}</td>
                        <td>{{ p.fee_paid_at ? String(p.fee_paid_at).slice(0, 10) : '—' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <section v-else class="fx-card">
            <div class="fx-card-head">
              <h2>Accounts</h2>
              <span style="font-size:0.8rem;color:rgba(16,36,31,0.55)">{{ accountsTotal }} matches</span>
            </div>
            <div class="fx-card-body tight">
              <div class="fx-table-wrap">
                <table class="fx-table" data-testid="fx-accounts-table">
                  <thead>
                    <tr>
                      <th>Stand</th><th>Account</th><th>Holder</th><th>District</th>
                      <th>Status</th><th class="fx-num">Balance</th><th class="fx-num">Valuation</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="a in accounts"
                      :key="a.accountNo"
                      :class="{ 'is-selected': selectedAccount?.accountNo === a.accountNo }"
                      @click="openAccount(a.accountNo)"
                    >
                      <td class="fx-mono">{{ a.standNo }}</td>
                      <td class="fx-mono">{{ a.accountNo }}</td>
                      <td>{{ a.accountHolder }}</td>
                      <td>{{ a.districtName }}</td>
                      <td><span class="fx-pill" :class="a.statusBand">{{ a.statusBand }}</span></td>
                      <td class="fx-num">{{ usd(a.balanceUsd) }}</td>
                      <td class="fx-num">{{ usd(a.valuationUsd) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </template>

        <!-- ═══ MAP ═══ -->
        <template v-else-if="section === 'map'">
          <div class="fx-actions" style="margin:0 0 0.75rem;margin-left:0">
            <button type="button" class="fx-btn" :class="{ primary: mapMode === 'stands' }" @click="mapMode = 'stands'">3D stands</button>
            <button type="button" class="fx-btn" :class="{ primary: mapMode === 'districts' }" @click="mapMode = 'districts'">3D districts</button>
            <button type="button" class="fx-btn" :class="{ primary: mapMode === 'accounts' }" @click="mapMode = 'accounts'">Account points</button>
            <label style="display:inline-flex;gap:0.35rem;align-items:center;font-size:0.86rem;margin-left:0.5rem">
              <input v-model="owingOnly" type="checkbox" @change="paintFinanceLayers" /> Owing only
            </label>
          </div>
          <section class="fx-card">
            <div class="fx-card-head">
              <h2>Financial topography over the cadastre</h2>
            </div>
            <div class="fx-map-host" ref="mapHost" data-testid="fx-map" />
            <div class="fx-map-legend">
              <span class="fx-swatch"><i style="background:#1f5aa8" /> Current</span>
              <span class="fx-swatch"><i style="background:#a8620a" /> A balance</span>
              <span class="fx-swatch"><i style="background:#bd2f28" /> In arrears</span>
              <span>The view turns on its own. Drag to look around. Scroll to zoom. Height is the balance.</span>
            </div>
          </section>
        </template>

        <!-- ═══ DISTRICTS ═══ -->
        <template v-else-if="section === 'districts'">
          <section class="fx-card">
            <div class="fx-card-head"><h2>Billing districts</h2></div>
            <div class="fx-card-body tight">
              <div class="fx-table-wrap">
                <table class="fx-table">
                  <thead>
                    <tr>
                      <th>District</th><th>Group</th><th class="fx-num">Accounts</th>
                      <th class="fx-num">Arrears</th><th class="fx-num">Balance</th>
                      <th class="fx-num">Valuation</th><th class="fx-num">Annual rates</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="d in districts"
                      :key="d.code"
                      @click="filterDistrict = d.code; section = 'accounts'"
                    >
                      <td>{{ d.name }}</td>
                      <td>{{ d.townshipGroup }}</td>
                      <td class="fx-num">{{ d.accounts }}</td>
                      <td class="fx-num">{{ d.arrearsCount }}</td>
                      <td class="fx-num">{{ usd(d.balanceUsd) }}</td>
                      <td class="fx-num">{{ usd(d.valuationUsd) }}</td>
                      <td class="fx-num">{{ usd(d.annualRatesUsd) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </template>

        <!-- ═══ ZIMBABWE RAILS ═══ -->
        <template v-else-if="section === 'rails' && rails">
          <div class="fx-kpis">
            <div class="fx-kpi gold">
              <div class="label">USD → ZWG</div>
              <div class="value">{{ Number(rails.rate.rate).toFixed(4) }}</div>
              <div class="hint">{{ rails.rate.source }} · {{ rails.rate.asOf ? String(rails.rate.asOf).slice(0, 10) : 'working rate' }}</div>
            </div>
            <div class="fx-kpi owe">
              <div class="label">Book in ZWG</div>
              <div class="value">{{ zwg(rails.book.owingUsd) }}</div>
              <div class="hint">{{ usd(rails.book.owingUsd) }} at this rate</div>
            </div>
          </div>
          <p class="fx-note">{{ rails.note }}</p>
          <section class="fx-card" style="margin-bottom:1rem">
            <div class="fx-card-head"><h2>Fourteen-day rate stage</h2></div>
            <div class="fx-card-body">
              <div class="fx-stage" aria-label="USD to ZWG rate as a 3D stage">
                <div class="fx-stage-floor">
                  <div
                    v-for="r in rails.series"
                    :key="String(r.date)"
                    class="fx-prism rate"
                    :style="{ height: `${Math.max(16, (r.rate / maxRate) * 120)}px` }"
                    :title="`${String(r.date).slice(0, 10)} · ${r.rate}`"
                  />
                </div>
                <span class="fx-stage-label">Working demonstration series — replace with the interbank rate</span>
              </div>
            </div>
          </section>
          <div class="fx-rails">
            <article v-for="rail in rails.rails" :key="rail.id" class="fx-rail-card">
              <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
                <h3>{{ rail.name }}</h3>
                <span class="fx-pill" :class="rail.live ? 'live' : 'awaiting'">{{ rail.live ? 'Ready' : 'Awaiting keys' }}</span>
              </div>
              <div class="op">{{ rail.operator }} · {{ rail.kind }} · {{ rail.currency }}</div>
              <p>{{ rail.note }}</p>
              <span v-if="rail.ussd" class="fx-ussd">{{ rail.ussd }}</span>
            </article>
          </div>
        </template>

        <!-- ═══ TRENDS ═══ -->
        <template v-else-if="section === 'trends'">
          <div class="fx-search" style="grid-template-columns: minmax(0,1fr) auto">
            <select v-model="filterDistrict" class="fx-select" @change="loadSection">
              <option value="">All districts</option>
              <option v-for="d in districts" :key="d.code" :value="d.code">{{ d.name }}</option>
            </select>
            <button type="button" class="fx-btn" @click="loadSection"><RefreshCw :size="15" /> Update</button>
          </div>
          <section class="fx-card">
            <div class="fx-card-head"><h2>Payment and owing trends</h2></div>
            <div class="fx-card-body">
              <div class="fx-trend" style="min-height:14rem">
                <div v-for="t in trends" :key="String(t.month)" class="fx-trend-col">
                  <div class="fx-trend-pair" style="height:12rem">
                    <div class="fx-trend-billed" :style="{ height: `${(t.billedUsd / maxTrend) * 100}%` }" :title="`Billed ${usd(t.billedUsd)}`" />
                    <div class="fx-trend-collected" :style="{ height: `${(t.collectedUsd / maxTrend) * 100}%` }" :title="`Collected ${usd(t.collectedUsd)}`" />
                  </div>
                  <span>{{ String(t.month).slice(0, 7) }}</span>
                </div>
              </div>
              <div class="fx-table-wrap" style="margin-top:1rem;max-height:240px">
                <table class="fx-table">
                  <thead><tr><th>Month</th><th class="fx-num">Billed</th><th class="fx-num">Collected</th><th class="fx-num">Arrears stock</th></tr></thead>
                  <tbody>
                    <tr v-for="t in trends" :key="'r'+String(t.month)">
                      <td>{{ String(t.month).slice(0, 10) }}</td>
                      <td class="fx-num">{{ usd(t.billedUsd) }}</td>
                      <td class="fx-num">{{ usd(t.collectedUsd) }}</td>
                      <td class="fx-num">{{ usd(t.arrearsUsd) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </template>

        <!-- ═══ CLEARANCES ═══ -->
        <template v-else-if="section === 'clearances'">
          <section class="fx-card">
            <div class="fx-card-head">
              <h2>Section 109 rates clearance</h2>
              <router-link class="fx-btn" to="/statutory-registers?tab=clearances">Full register</router-link>
            </div>
            <div class="fx-card-body tight">
              <div class="fx-table-wrap">
                <table class="fx-table" data-testid="fx-clearances-table">
                  <thead>
                    <tr>
                      <th>Stand</th><th>Applicant</th><th>Status</th>
                      <th class="fx-num">Recorded</th><th class="fx-num">Live balance</th>
                      <th>Certificate</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="c in clearances" :key="c.id">
                      <td class="fx-mono">{{ c.standNumber }}</td>
                      <td>{{ c.applicantName }}</td>
                      <td><span class="fx-pill" :class="c.status">{{ c.status }}</span></td>
                      <td class="fx-num">{{ c.chargesOutstandingUsd != null ? usd(c.chargesOutstandingUsd) : '—' }}</td>
                      <td class="fx-num">{{ c.liveBalanceUsd != null ? usd(c.liveBalanceUsd) : '—' }}</td>
                      <td class="fx-mono">{{ c.certificateNo || '—' }}</td>
                      <td>
                        <template v-if="c.status === 'requested' || c.status === 'under_review'">
                          <button type="button" class="fx-btn primary" style="margin-right:0.25rem" @click="decideClearance(c.id, 'clear')">
                            <Check :size="14" /> Issue
                          </button>
                          <button type="button" class="fx-btn danger" @click="decideClearance(c.id, 'refuse')">
                            <X :size="14" /> Refuse
                          </button>
                        </template>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </template>

        <!-- ═══ RECEIPTS ═══ -->
        <template v-else-if="section === 'receipts'">
          <section class="fx-card">
            <div class="fx-card-head">
              <h2>Council receipts</h2>
              <router-link class="fx-btn primary" to="/payments">New payment</router-link>
            </div>
            <div class="fx-card-body tight">
              <div class="fx-table-wrap">
                <table class="fx-table">
                  <thead>
                    <tr><th>Receipt</th><th>Purpose</th><th>Account / stand</th><th class="fx-num">Amount</th><th>Paid</th><th>Driver</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in receipts" :key="r.id">
                      <td class="fx-mono">
                        <router-link v-if="r.receiptNo" :to="`/receipt/${r.receiptNo}`">{{ r.receiptNo }}</router-link>
                        <span v-else>{{ r.id.slice(0, 8) }}</span>
                      </td>
                      <td>{{ r.purpose }}</td>
                      <td>{{ r.accountRef || r.relatedId || '—' }}</td>
                      <td class="fx-num">{{ usd(r.amountUsd) }}</td>
                      <td>{{ r.paidAt ? String(r.paidAt).slice(0, 10) : '—' }}</td>
                      <td>{{ r.driver }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </template>

        <!-- ═══ TARIFF ═══ -->
        <template v-else-if="section === 'tariff'">
          <p v-if="tariffNote" class="fx-note">{{ tariffNote }}</p>
          <section class="fx-card">
            <div class="fx-card-head"><h2>Working fee schedule</h2></div>
            <div class="fx-card-body tight">
              <div class="fx-table-wrap">
                <table class="fx-table">
                  <thead>
                    <tr><th>Code</th><th>Department</th><th>Title</th><th>Priced</th><th class="fx-num">Amount</th><th>Unit</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="t in tariff" :key="t.code">
                      <td class="fx-mono">{{ t.code }}</td>
                      <td>{{ t.department }}</td>
                      <td>
                        <strong>{{ t.title }}</strong>
                        <div style="font-size:0.78rem;color:rgba(16,36,31,0.55);margin-top:0.15rem">{{ t.detail }}</div>
                      </td>
                      <td>{{ t.pricedBy }}</td>
                      <td class="fx-num">{{ t.amountUsd != null ? usd(t.amountUsd) : 'Bill' }}</td>
                      <td>{{ t.unitLabel }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </template>

        <!-- ═══ WORKFLOWS ═══ -->
        <template v-else-if="section === 'workflows' && workflows">
          <div class="fx-kpis">
            <div class="fx-kpi">
              <div class="label">Parcels without account</div>
              <div class="value">{{ workflows.cadastreLink.parcelsWithoutAccount }}</div>
              <div class="hint">Should stay near zero after a match exercise</div>
            </div>
            <div class="fx-kpi ok">
              <div class="label">Linked accounts</div>
              <div class="value">{{ workflows.cadastreLink.accountsLinked }}</div>
              <div class="hint">Cadastre ↔ revenue</div>
            </div>
          </div>

          <div class="fx-split">
            <section class="fx-card">
              <div class="fx-card-head"><h2>Planning application fees</h2></div>
              <div class="fx-card-body tight">
                <div class="fx-table-wrap">
                  <table class="fx-table">
                    <thead>
                      <tr><th>Stand</th><th>Applicant</th><th>Status</th><th>Receipt</th><th class="fx-num">Fee</th></tr>
                    </thead>
                    <tbody>
                      <tr v-for="p in workflows.permitFees" :key="p.id">
                        <td class="fx-mono">{{ p.standNumber }}</td>
                        <td>{{ p.applicantName }}</td>
                        <td>{{ p.status }}</td>
                        <td class="fx-mono">
                          <router-link v-if="p.receiptNo" :to="`/receipt/${p.receiptNo}`">{{ p.receiptNo }}</router-link>
                          <span v-else>{{ p.feePaidAt ? 'paid' : 'unpaid' }}</span>
                        </td>
                        <td class="fx-num">{{ p.feeAmountUsd != null ? usd(p.feeAmountUsd) : '—' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section class="fx-card">
              <div class="fx-card-head"><h2>Recent account payments</h2></div>
              <div class="fx-card-body tight">
                <div class="fx-table-wrap">
                  <table class="fx-table">
                    <thead>
                      <tr><th>Stand</th><th>Holder</th><th>Purpose</th><th class="fx-num">Amount</th></tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(e, i) in workflows.recentAccountPayments"
                        :key="e.accountNo + String(i)"
                        @click="openAccount(e.accountNo)"
                      >
                        <td class="fx-mono">{{ e.standNo }}</td>
                        <td>{{ e.holder }}</td>
                        <td>{{ e.purpose }}</td>
                        <td class="fx-num">{{ usd(Math.abs(e.amountUsd)) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </div>
        </template>
      </main>
    </div>
  </div>
</template>
