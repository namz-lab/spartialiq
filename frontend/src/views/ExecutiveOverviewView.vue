<script setup lang="ts">
// The Chief Executive's overview. One page that follows the council's Executive Arm
// (vungurdc.org.zw/our-team): Finance, Planning, Engineering, Social Services, Human Resources and
// Administration, and Internal Audit. Read-only: nothing here changes a figure, and every approval
// stays with the person whose duty it is.
//
// A department whose register is empty says so and says what is missing; it is never shown as a
// row of zeros. Human resources has no data in the system at all and says that. Finance is read from
// the existing executive finance dashboard (the same role may read it), not recomputed here.
//
// LAYOUT (the app shell): the header and a side menu stay put and only the work area changes, so the
// page is one screen, not a long column. "At a glance" shows each unit's headline figures, flagged
// ones first; a unit opens its full figures; the wards have the map and the two tables as views of
// their own. The view is in the address (?view=planning), so it can be shared and Back works. Print
// prints every unit and both ward tables, whichever view is on screen. Below 64rem the menu becomes a
// strip across the top and the page scrolls as an ordinary page.
import { computed, nextTick, onMounted, ref, type Component } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { Banknote, Building2, HardHat, HeartPulse, Users, ShieldCheck, Info, TriangleAlert, ArrowRight, LayoutGrid, Map as MapIcon, Table2, ChartColumn } from 'lucide-vue-next'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import ExecutiveWardMap from '@/views/executive/ExecutiveWardMap.vue'
import WardTable from '@/components/executive/WardTable.vue'
import ExportMenu from '@/components/shared/ExportMenu.vue'
import GlanceGrid from '@/components/shared/GlanceGrid.vue'
import { headline, unbroken } from '@/components/shared/glance'
import type { ExportTable } from '@/utils/tableExport'
import { useAuthStore } from '@/stores/auth'
import type { UnitKey } from '@/services/units'
import { auditGroup, engineeringGroup, groupsToTable, hrGroup, landGroup, missing, planningGroup, socialGroup, type Group } from '@/views/units/unitStats'
import { executiveApi, type ExecutiveOverview, type MasterPlan } from '@/services/executiveOverview'
import { identityLine } from '@/services/planLegend'
import { executiveDash } from '@/modules/finance/workspaces/executive/dashboard'
import { byCurrency, pctText } from '@/modules/finance/workspaces/shared/useDashboard'
import { formatMoney, type Currency } from '@/modules/finance/composables/useMoney'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const overview = ref<ExecutiveOverview | null>(null)
const masterPlan = ref<MasterPlan | null>(null)
const overviewError = ref<string | null>(null)
const loading = ref(true)

async function load() {
  loading.value = true
  overviewError.value = null
  await Promise.all([
    executiveApi.overview().then((o) => { overview.value = o }).catch(() => {
      overviewError.value = 'The overview could not be read. Try again in a moment.'
    }),
    // the master plan's standing is an extra on the Planning card: if it cannot be read the card simply does without it
    Promise.resolve().then(() => executiveApi.masterPlan()).then((m) => { masterPlan.value = m }).catch(() => { masterPlan.value = null }),
    executiveDash.load(),
  ])
  loading.value = false
}
onMounted(load)

function handleLogout() {
  auth.logout()
  router.push('/login')
}

// ── Cards ──────────────────────────────────────────────────────────────
// The figures themselves are built in views/units/unitStats.ts, so a card and its unit dashboard show the same words.
interface Card {
  key: string; title: string; post: string; icon: Component; groups: Group[]
  /** The Executive Arm unit whose dashboard this card opens: the drill-down from this page. */
  unit: UnitKey
  link?: { to: string; label: string }
}

const fd = computed(() => executiveDash.state.data)
const ccy = computed<Currency>(() => fd.value?.year.reporting_currency ?? 'USD')
const kind = (k: 'revenue' | 'expenditure') =>
  byCurrency((fd.value?.totals ?? []).filter((t) => t.account_kind === k), ccy.value)[0]

const financeGroup = computed<Group>(() => {
  const d = fd.value
  if (!d) {
    return {
      loaded: false,
      unavailable: !!executiveDash.state.error,
      note: executiveDash.state.error ?? (loading.value ? 'Reading the finance position…' : 'No finance figures yet.'),
      stats: [],
    }
  }
  const rev = kind('revenue')
  const exp = kind('expenditure')
  return {
    loaded: true,
    stats: [
      { label: 'Revenue this year', value: formatMoney(rev?.actual ?? '0', (rev?.currency ?? ccy.value) as Currency) },
      { label: 'Expenditure this year', value: formatMoney(exp?.actual ?? '0', (exp?.currency ?? ccy.value) as Currency) },
      { label: 'Spending budget used', value: pctText(exp?.execution) },
      { label: 'Projects on track', value: `${d.projects.on_track} of ${d.projects.active}`, tone: d.projects.active && d.projects.on_track < d.projects.active ? 'warn' : undefined },
    ],
  }
})

// The master plan on the Planning card: which plan, whether it is in force, how far its adoption has got, and how much of the register it covers.
const planGroup = computed<Group | null>(() => {
  const m = masterPlan.value
  if (!m?.plan) return null
  const cov = m.coverage
  const ad = m.adoption
  const stats: Group['stats'] = [
    { label: 'Plan', value: [m.plan.revision_label, identityLine({ revision_label: null, revision_date: m.plan.revision_date, map_scale: m.plan.map_scale })].filter(Boolean).join(' · ') || m.plan.title },
    { label: 'Standing', value: m.plan.in_force ? 'In force' : 'Not in force', tone: m.plan.in_force ? 'good' : 'warn' },
  ]
  if (ad) stats.push({ label: 'Adoption steps done', value: `${ad.done} of ${ad.of}`, tone: ad.done < ad.of ? 'warn' : 'good' })
  if (cov) stats.push({ label: 'Parcels under a zone of the plan', value: `${cov.zoned.toLocaleString('en-GB')} of ${cov.parcels.toLocaleString('en-GB')}`, tone: cov.unzoned ? 'warn' : undefined })
  return {
    heading: 'Master plan', loaded: true, stats,
    footnote: m.decisions?.tested_on_affirmation ? 'Some decisions in the plan are affirmed for testing only, not agreed by the council.' : undefined,
  }
})

const cards = computed<Card[]>(() => {
  const o = overview.value
  // before the overview has arrived a unit is being read, not unreadable
  const miss = (note: string, heading?: string) => () =>
    missing(overviewError.value ?? (o || !loading.value ? note : 'Reading the registers…'), !!overviewError.value, heading)

  return [
    {
      key: 'finance', unit: 'finance', title: 'Finance', post: 'Executive Officer, Finance', icon: Banknote,
      groups: [financeGroup.value],
      link: { to: '/finance/accounting', label: 'Finance in detail' },
    },
    {
      key: 'planning', unit: 'planning', title: 'Planning and Environment', post: 'Executive Officer, Planner', icon: Building2,
      groups: [
        planningGroup(o?.planning, miss('Development control could not be read.', 'Development control')),
        ...(planGroup.value ? [planGroup.value] : []),
        landGroup(o?.land, miss('The land register could not be read.', 'Land register')),
      ],
      link: { to: '/executive/master-plan', label: 'Master plan: map and detail' },
    },
    {
      key: 'engineering', unit: 'engineering', title: 'Roads and Works', post: 'District Engineer', icon: HardHat,
      groups: [engineeringGroup(o?.engineering, miss('Engineering could not be read.'))],
    },
    {
      key: 'social', unit: 'social_admin', title: 'Social Services', post: 'Human Resources, Social Services and Administration Officer', icon: HeartPulse,
      groups: [socialGroup(o?.social_services, miss('Social services could not be read.'))],
    },
    {
      key: 'hr', unit: 'social_admin', title: 'Human Resources and Administration', post: 'Human Resources, Social Services and Administration Officer', icon: Users,
      groups: [hrGroup(o?.hr, miss('Human resources could not be read.'))],
    },
    {
      key: 'audit', unit: 'audit', title: 'Internal Audit', post: 'Internal Auditor', icon: ShieldCheck,
      groups: [auditGroup(o?.audit, miss('Internal audit could not be read.'))],
    },
  ]
})

function buildOverview(): ExportTable {
  return groupsToTable("Chief Executive's overview", asOf.value || 'now', cards.value.map((c) => ({ area: c.title, groups: c.groups })),
    masterPlan.value?.decisions?.tested_on_affirmation ? ['Some master plan decisions are affirmed for testing only, not agreed by the council.'] : [])
}

const asOf = computed(() => {
  const t = overview.value?.as_of
  return t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
})

// ── The shell: which view the work area shows ────────────────────────────
const WARD_VIEWS = [
  { key: 'wards-map', label: 'Ward map', icon: MapIcon },
  { key: 'wards-registers', label: 'What the registers hold', icon: Table2 },
  { key: 'wards-measures', label: 'Ward measures', icon: ChartColumn },
] as const
const VIEWS = new Set<string>(['summary', 'finance', 'planning', 'engineering', 'social', 'hr', 'audit', ...WARD_VIEWS.map((w) => w.key)])
const view = computed(() => {
  const v = route.query.view
  return typeof v === 'string' && VIEWS.has(v) ? v : 'summary'
})
const work = ref<HTMLElement | null>(null)
async function go(v: string) {
  if (v === view.value) return
  await router.push({ query: { ...route.query, view: v === 'summary' ? undefined : v } })
  await nextTick()
  // the work area starts at its top, and a keyboard or screen-reader user lands on the new view
  if (work.value) { work.value.scrollTop = 0; work.value.focus({ preventScroll: true }) }
}
const wardTableOnly = computed(() => (view.value === 'wards-measures' ? 'measures' : 'counts'))

// A tile's headline figures and the wrapping rule are shared with the planning overviews (components/shared/glance.ts).
</script>

<template>
  <div class="xo-root">
    <a class="xo-skip" href="#xo-main">Skip to content</a>
    <header class="xo-header">
      <div class="xo-brand">
        <span class="xo-council">Vungu Rural District Council<span v-if="asOf" class="xo-asof"> · As at {{ asOf }}</span></span>
        <h1 class="xo-title">Chief Executive's Overview</h1>
      </div>
      <ExportMenu :build="buildOverview" filename="chief-executive-overview" print />
      <ProfileDropdown role-label="Chief Executive" avatar-key="executive_avatar" @logout="handleLogout" />
    </header>

    <div class="xo-shell">
      <nav class="xo-nav" aria-label="Sections of the overview">
        <ul class="xo-nav-list">
          <li>
            <button type="button" class="xo-nav-item" :aria-current="view === 'summary' ? 'page' : undefined" @click="go('summary')">
              <LayoutGrid :size="16" aria-hidden="true" /> At a glance
            </button>
          </li>
        </ul>
        <p class="xo-nav-head">Units</p>
        <ul class="xo-nav-list">
          <li v-for="c in cards" :key="c.key">
            <button type="button" class="xo-nav-item" :aria-current="view === c.key ? 'page' : undefined" @click="go(c.key)">
              <component :is="c.icon" :size="16" aria-hidden="true" />
              <span class="xo-nav-label">{{ c.title }}</span>
              <span v-if="headline(c).flagged" class="xo-nav-flag" :title="`${headline(c).flagged} to look at`">{{ headline(c).flagged }}<span class="xo-sr"> to look at</span></span>
            </button>
          </li>
        </ul>
        <p class="xo-nav-head">Wards</p>
        <ul class="xo-nav-list">
          <li v-for="w in WARD_VIEWS" :key="w.key">
            <button type="button" class="xo-nav-item" :aria-current="view === w.key ? 'page' : undefined" @click="go(w.key)">
              <component :is="w.icon" :size="16" aria-hidden="true" /> {{ w.label }}
            </button>
          </li>
        </ul>
      </nav>

      <main id="xo-main" ref="work" class="xo-work" tabindex="-1">
        <p v-if="overviewError" class="xo-alert" role="alert">
          <TriangleAlert :size="16" aria-hidden="true" />{{ overviewError }}
          <button type="button" class="xo-retry" @click="load">Try again</button>
        </p>

        <!-- At a glance: one tile per unit with its headline figures; the whole tile opens the unit -->
        <section v-show="view === 'summary'" class="xo-panel xo-summary" aria-labelledby="xo-summary-h" data-testid="xo-summary">
          <div class="xo-panel-head">
            <h2 id="xo-summary-h" class="xo-panel-title">At a glance</h2>
            <p class="xo-lede">The six areas of the Executive Arm, read from the council's own registers. Figures to look at come first. Nothing here can be changed from this page.</p>
          </div>
          <GlanceGrid :cards="cards" @open="go" />
        </section>

        <!-- Each unit in full -->
        <section v-for="c in cards" v-show="view === c.key" :key="c.key" class="xo-panel xo-unit" :aria-labelledby="`xo-${c.key}`" :data-testid="`xo-unit-${c.key}`">
          <header class="xo-card-head">
            <component :is="c.icon" :size="22" class="xo-card-icon" aria-hidden="true" />
            <div>
              <h2 :id="`xo-${c.key}`" class="xo-panel-title">{{ c.title }}</h2>
              <p class="xo-card-post">{{ c.post }}</p>
            </div>
          </header>
          <div class="xo-groups">
            <div v-for="(g, i) in c.groups" :key="i" class="xo-group">
              <h3 v-if="g.heading" class="xo-group-title">{{ g.heading }}</h3>
              <dl v-if="g.loaded" class="xo-stats">
                <div v-for="s in g.stats" :key="s.label" class="xo-stat">
                  <dt>{{ s.label }}</dt>
                  <dd :class="s.tone ? `is-${s.tone}` : undefined">{{ unbroken(s.value) }}</dd>
                </div>
              </dl>
              <p v-if="g.loaded && g.footnote" class="xo-foot">{{ g.footnote }}</p>
              <p v-else-if="!g.loaded" class="xo-missing" :class="{ 'is-error': g.unavailable }">
                <component :is="g.unavailable ? TriangleAlert : Info" :size="16" aria-hidden="true" />
                <span>{{ g.note }}</span>
              </p>
            </div>
          </div>
          <div class="xo-links">
            <RouterLink :to="`/units/${c.unit}`" class="xo-link">Unit dashboard <ArrowRight :size="14" aria-hidden="true" /></RouterLink>
            <RouterLink v-if="c.link" :to="c.link.to" class="xo-link">{{ c.link.label }} <ArrowRight :size="14" aria-hidden="true" /></RouterLink>
          </div>
        </section>

        <!-- The wards. The map fills the work area and is not printed: the tables carry the same figures. -->
        <div v-if="view === 'wards-map'" class="xo-panel xo-wardmap"><ExecutiveWardMap /></div>
        <div v-show="view === 'wards-registers' || view === 'wards-measures'" class="xo-panel xo-wardtable">
          <WardTable :only="wardTableOnly" />
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.xo-root { min-height: var(--ent-vh, 100vh); background: var(--ent-canvas); color: var(--ent-text); font-family: var(--ent-font); }
.xo-skip { position: absolute; left: 8px; top: -48px; z-index: 80; padding: 0.5rem 0.75rem; background: var(--ent-surface); color: var(--ent-accent); border-radius: 4px; }
.xo-skip:focus { top: 8px; }
.xo-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.xo-header { display: flex; align-items: center; gap: 1rem; padding: 0.625rem 1.25rem; background: var(--ent-surface); border-bottom: 1px solid var(--ent-line); flex-wrap: wrap; }
.xo-brand { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
.xo-council { font-size: var(--ent-fs-micro, 0.6875rem); text-transform: uppercase; letter-spacing: 0.06em; color: var(--ent-text-3); }
.xo-title { margin: 0; font-size: 1.25rem; font-weight: 600; }
.xo-asof { text-transform: none; letter-spacing: 0; }

/* The menu. On a narrow screen it is a strip across the top. */
.xo-nav { display: flex; gap: 0.25rem; padding: 0.5rem 0.75rem; overflow-x: auto; background: var(--ent-surface); border-bottom: 1px solid var(--ent-line); }
.xo-nav-list { display: flex; flex: none; gap: 0.25rem; margin: 0; padding: 0; list-style: none; }
.xo-nav-list > li { flex: none; }
.xo-nav-head { display: none; }
.xo-nav-item { display: flex; align-items: center; gap: 0.5rem; width: 100%; padding: 0.5rem 0.625rem; border: 0; border-radius: 6px; background: none; color: var(--ent-text-2); font: inherit; font-size: 0.875rem; text-align: left; white-space: nowrap; cursor: pointer; }
.xo-nav-item:hover { background: var(--ent-surface-2); color: var(--ent-text); }
.xo-nav-item:focus-visible { outline: 2px solid var(--ent-accent); outline-offset: -2px; }
.xo-nav-item[aria-current='page'] { background: var(--ent-accent-soft); color: var(--ent-accent); font-weight: 600; }
.xo-nav-label { flex: 1; }
.xo-nav-flag { flex: none; min-width: 1.25rem; padding: 0 0.375rem; border-radius: 999px; background: var(--ent-warning-soft); color: var(--ent-warning); font-size: 0.75rem; font-weight: 600; text-align: center; }

.xo-work { padding: 1.25rem; }
.xo-work:focus { outline: none; }
.xo-panel-head { margin-bottom: 1rem; }
.xo-panel-title { margin: 0; font-size: 1.125rem; font-weight: 600; }
.xo-lede { margin: 0.25rem 0 0; color: var(--ent-text-2); max-width: 52rem; font-size: 0.9375rem; }

.xo-alert { display: flex; align-items: center; gap: 0.5rem; margin: 0 0 1rem; padding: 0.625rem 0.875rem; background: var(--ent-danger-soft); color: var(--ent-danger); border-radius: 6px; }
.xo-retry { margin-left: auto; padding: 0.25rem 0.625rem; border: 1px solid var(--ent-danger); background: var(--ent-surface); color: var(--ent-danger); border-radius: 4px; cursor: pointer; }

/* At a glance: the tiles are components/shared/GlanceGrid.vue */

/* A unit in full */
.xo-unit { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: 8px; padding: 1.25rem 1.5rem; max-width: 64rem; }
.xo-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: 0.5rem 2rem; align-items: start; }

.xo-card-head { display: flex; gap: 0.75rem; align-items: flex-start; margin-bottom: 0.75rem; }
.xo-card-icon { color: var(--ent-accent); margin-top: 0.125rem; flex: none; }
.xo-card-post { margin: 0.125rem 0 0; font-size: 0.8125rem; color: var(--ent-text-3); }
.xo-group-title { margin: 0.5rem 0 0.375rem; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ent-text-2); }

.xo-stats { margin: 0; display: grid; gap: 0.25rem; }
.xo-stat { display: flex; justify-content: space-between; gap: 1rem; padding: 0.3125rem 0; border-bottom: 1px solid var(--ent-surface-2); }
.xo-stat:last-child { border-bottom: 0; }
.xo-stat dt { color: var(--ent-text-2); font-size: 0.875rem; }
.xo-stat dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; overflow-wrap: normal; word-break: normal; }
.xo-stat dd.is-warn { color: var(--ent-warning); }
.xo-stat dd.is-bad { color: var(--ent-danger); }
.xo-stat dd.is-good { color: var(--ent-success); }

.xo-missing { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0.25rem 0 0; padding: 0.625rem 0.75rem; background: var(--ent-surface-2); border-radius: 6px; color: var(--ent-text-2); font-size: 0.875rem; }
.xo-missing svg { flex: none; margin-top: 0.125rem; }
.xo-missing.is-error { background: var(--ent-warning-soft); color: var(--ent-warning); }

.xo-links { display: flex; flex-wrap: wrap; gap: 0.25rem 1.25rem; margin-top: 1rem; }
.xo-foot { margin: 0.375rem 0 0; font-size: 0.8125rem; color: var(--ent-text-3); }
.xo-link { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--ent-accent); font-size: 0.875rem; text-decoration: none; }
.xo-link:hover { text-decoration: underline; }

.xo-wardmap :deep(.wm), .xo-wardtable :deep(.wt-root) { margin-top: 0; }

/* The app shell. On a desktop the page is one screen: the header and the menu stay put, and only the
   work area scrolls, and only when a view is taller than the window (the ward tables, a short screen). */
@media (min-width: 64rem) {
  .xo-root { height: 100dvh; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .xo-header { flex-wrap: nowrap; }
  .xo-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .xo-shell { flex: 1; min-height: 0; display: grid; grid-template-columns: 15.5rem minmax(0, 1fr); }
  .xo-nav { flex-direction: column; gap: 0; padding: 0.75rem 0.625rem; overflow-x: hidden; overflow-y: auto; border-bottom: 0; border-right: 1px solid var(--ent-line); }
  .xo-nav-list { flex-direction: column; gap: 0.125rem; }
  .xo-nav-head { display: block; margin: 1rem 0.625rem 0.25rem; font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ent-text-3); }
  .xo-nav-item { white-space: normal; }
  .xo-work { overflow-y: auto; padding: 1.25rem 1.5rem; }
  .xo-summary { display: flex; flex-direction: column; min-height: 100%; }
  /* The ward map takes the height of the window, its ranked list beside it. */
  .xo-wardmap { height: 100%; }
  .xo-wardmap :deep(.wm) { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; }
  .xo-wardmap :deep(.wm-body) { flex: 1; min-height: 22rem; align-items: stretch; }
  .xo-wardmap :deep(.wm-map-col) { display: flex; flex-direction: column; min-height: 0; }
  .xo-wardmap :deep(.wm-canvas) { flex: 1; height: auto; min-height: 18rem; }
  .xo-wardmap :deep(.wm-list-col) { max-height: none; min-height: 0; }
}

/* Print (the browser's "Save as PDF"): every unit in full and both ward tables, black on white, no menu, no map. */
@media print {
  .xo-root { height: auto; overflow: visible; display: block; background: #fff; color: #000; }
  .xo-shell { display: block; }
  .xo-header :deep(.profile-dropdown), .xo-skip, .xo-retry, .xo-links, .xo-nav, .xo-summary, .xo-wardmap { display: none !important; }
  .xo-work { overflow: visible; padding: 0; }
  .xo-unit, .xo-wardtable { display: block !important; }
  .xo-unit { break-inside: avoid; border-color: #999; margin-bottom: 0.75rem; max-width: none; }
  .xo-stat dd, .xo-stat dt { color: #000; }
}
</style>
