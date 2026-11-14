<script setup lang="ts">
// The Chief Executive's overview. One page that follows the council's Executive Arm
// (vungurdc.org.zw/our-team): Finance, Planning, Engineering, Social Services, Human Resources and
// Administration, and Internal Audit. Read-only: nothing here changes a figure, and every approval
// stays with the person whose duty it is.
//
// A department whose register is empty says so and says what is missing; it is never shown as a
// row of zeros. Human resources has no data in the system at all and says that. Finance is read from
// the existing executive finance dashboard (the same role may read it), not recomputed here.
import { computed, onMounted, ref, type Component } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { Banknote, Building2, HardHat, HeartPulse, Users, ShieldCheck, Info, TriangleAlert, ArrowRight } from 'lucide-vue-next'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import ExecutiveWardMap from '@/views/executive/ExecutiveWardMap.vue'
import { useAuthStore } from '@/stores/auth'
import { executiveApi, type ExecutiveOverview } from '@/services/executiveOverview'
import { executiveDash } from '@/modules/finance/workspaces/executive/dashboard'
import { byCurrency, pctText } from '@/modules/finance/workspaces/shared/useDashboard'
import { formatMoney, type Currency } from '@/modules/finance/composables/useMoney'

const router = useRouter()
const auth = useAuthStore()

const overview = ref<ExecutiveOverview | null>(null)
const overviewError = ref<string | null>(null)
const loading = ref(true)

async function load() {
  loading.value = true
  overviewError.value = null
  await Promise.all([
    executiveApi.overview().then((o) => { overview.value = o }).catch(() => {
      overviewError.value = 'The overview could not be read. Try again in a moment.'
    }),
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
type Tone = 'warn' | 'bad' | 'good'
interface Stat { label: string; value: string; tone?: Tone }
interface Group { heading?: string; loaded: boolean; unavailable?: boolean; note?: string; stats: Stat[] }
interface Card { key: string; title: string; post: string; icon: Component; groups: Group[]; link?: { to: string; label: string } }

const n = (v: number | undefined) => (v ?? 0).toLocaleString('en-GB')
const share = (part: number | undefined, whole: number | undefined) =>
  whole ? `${Math.round(((part ?? 0) * 100) / whole)}%` : '—'
const flag = (v: number | undefined, tone: Tone): Tone | undefined => ((v ?? 0) > 0 ? tone : undefined)

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

const cards = computed<Card[]>(() => {
  const o = overview.value
  const missing = (note: string): Group => ({ loaded: false, unavailable: !!overviewError.value, note: overviewError.value ?? note, stats: [] })
  const pl = o?.planning
  const ld = o?.land
  const en = o?.engineering
  const ss = o?.social_services
  const au = o?.audit
  const hr = o?.hr

  return [
    {
      key: 'finance', title: 'Finance', post: 'Executive Officer, Finance', icon: Banknote,
      groups: [financeGroup.value],
      link: { to: '/finance/accounting', label: 'Finance in detail' },
    },
    {
      key: 'planning', title: 'Planning and Environment', post: 'Executive Officer, Planner', icon: Building2,
      groups: [
        pl ? {
          heading: 'Development control', loaded: pl.loaded, unavailable: pl.unavailable, note: pl.note,
          stats: [
            { label: 'Applications in progress', value: n(pl.in_progress) },
            { label: 'Past statutory due date', value: n(pl.overdue), tone: flag(pl.overdue, 'bad') },
            { label: 'Awaiting a decision', value: n(pl.awaiting_decision), tone: flag(pl.awaiting_decision, 'warn') },
            { label: 'Approved this year', value: n(pl.approved_this_year) },
            { label: 'Open building complaints', value: n(pl.open_building_complaints), tone: flag(pl.open_building_complaints, 'warn') },
          ],
        } : { heading: 'Development control', ...missing('Development control could not be read.') },
        ld ? {
          heading: 'Land register', loaded: ld.loaded, unavailable: ld.unavailable, note: ld.note,
          stats: [
            { label: 'Parcels on the register', value: n(ld.parcels) },
            { label: 'With a rates account', value: share(ld.parcels_with_account, ld.parcels) },
            { label: 'Outlines estimated, not surveyed', value: n(ld.estimated_boundaries), tone: flag(ld.estimated_boundaries, 'warn') },
          ],
        } : { heading: 'Land register', ...missing('The land register could not be read.') },
      ],
    },
    {
      key: 'engineering', title: 'Engineering and Works', post: 'Engineer', icon: HardHat,
      groups: [en ? {
        loaded: en.loaded, unavailable: en.unavailable, note: en.note,
        stats: [
          { label: 'District roads', value: `${n(en.roads)} (${(en.road_km ?? 0).toLocaleString('en-GB')} km)` },
          { label: 'Water points working', value: `${n(en.water_points_working)} of ${n(en.water_points)}`, tone: en.water_points && en.water_points_working! < en.water_points ? 'warn' : undefined },
          { label: 'Council assets', value: n(en.council_assets) },
          { label: 'Capital projects in progress', value: n(en.projects_in_progress) },
        ],
      } : missing('Engineering could not be read.')],
    },
    {
      key: 'social', title: 'Social Services', post: 'Human Resources, Social Services and Administration Officer', icon: HeartPulse,
      groups: [ss ? {
        loaded: ss.loaded, unavailable: ss.unavailable, note: ss.note,
        stats: [
          { label: 'Health premises registered', value: n(ss.premises) },
          { label: 'Fitness certificates due or expired', value: n(ss.certificates_due_or_expired), tone: flag(ss.certificates_due_or_expired, 'warn') },
          { label: 'Open nuisance complaints', value: n(ss.open_nuisance_complaints), tone: flag(ss.open_nuisance_complaints, 'warn') },
        ],
      } : missing('Social services could not be read.')],
    },
    {
      key: 'hr', title: 'Human Resources and Administration', post: 'Human Resources, Social Services and Administration Officer', icon: Users,
      groups: [hr ? { loaded: hr.loaded, unavailable: hr.unavailable, note: hr.note, stats: [] } : missing('Human resources could not be read.')],
    },
    {
      key: 'audit', title: 'Internal Audit', post: 'Internal Auditor', icon: ShieldCheck,
      groups: [au ? {
        loaded: au.loaded, unavailable: au.unavailable, note: au.note,
        stats: [
          { label: 'Engagements open', value: `${n(au.engagements_open)} of ${n(au.engagements)}` },
          { label: 'Findings open', value: n(au.findings_open), tone: flag(au.findings_open, 'warn') },
          { label: 'High-risk findings', value: n(au.findings_high_risk), tone: flag(au.findings_high_risk, 'bad') },
          { label: 'Actions past their date', value: n(au.actions_overdue), tone: flag(au.actions_overdue, 'bad') },
        ],
      } : missing('Internal audit could not be read.')],
    },
  ]
})

const asOf = computed(() => {
  const t = overview.value?.as_of
  return t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
})
</script>

<template>
  <div class="xo-root">
    <a class="xo-skip" href="#xo-main">Skip to content</a>
    <header class="xo-header">
      <div class="xo-brand">
        <span class="xo-council">Vungu Rural District Council</span>
        <h1 class="xo-title">Chief Executive's Overview</h1>
      </div>
      <p v-if="asOf" class="xo-asof">As at {{ asOf }}</p>
      <ProfileDropdown role-label="Chief Executive" avatar-key="executive_avatar" @logout="handleLogout" />
    </header>

    <main id="xo-main" class="xo-main" tabindex="-1">
      <p class="xo-lede">
        The six areas of the Executive Arm, read from the council's own registers. Nothing here can be changed from this page.
      </p>
      <p v-if="overviewError" class="xo-alert" role="alert">
        <TriangleAlert :size="16" aria-hidden="true" />{{ overviewError }}
        <button type="button" class="xo-retry" @click="load">Try again</button>
      </p>

      <div class="xo-grid">
        <section v-for="c in cards" :key="c.key" class="xo-card" :aria-labelledby="`xo-${c.key}`">
          <header class="xo-card-head">
            <component :is="c.icon" :size="20" class="xo-card-icon" aria-hidden="true" />
            <div>
              <h2 :id="`xo-${c.key}`" class="xo-card-title">{{ c.title }}</h2>
              <p class="xo-card-post">{{ c.post }}</p>
            </div>
          </header>

          <div v-for="(g, i) in c.groups" :key="i" class="xo-group">
            <h3 v-if="g.heading" class="xo-group-title">{{ g.heading }}</h3>
            <dl v-if="g.loaded" class="xo-stats">
              <div v-for="s in g.stats" :key="s.label" class="xo-stat">
                <dt>{{ s.label }}</dt>
                <dd :class="s.tone ? `is-${s.tone}` : undefined">{{ s.value }}</dd>
              </div>
            </dl>
            <p v-else class="xo-missing" :class="{ 'is-error': g.unavailable }">
              <component :is="g.unavailable ? TriangleAlert : Info" :size="16" aria-hidden="true" />
              <span>{{ g.note }}</span>
            </p>
          </div>

          <RouterLink v-if="c.link" :to="c.link.to" class="xo-link">
            {{ c.link.label }} <ArrowRight :size="14" aria-hidden="true" />
          </RouterLink>
        </section>
      </div>

      <ExecutiveWardMap />
    </main>
  </div>
</template>

<style scoped>
.xo-root { min-height: var(--ent-vh, 100vh); background: var(--ent-canvas); color: var(--ent-text); font-family: var(--ent-font); }
.xo-skip { position: absolute; left: 8px; top: -48px; z-index: 80; padding: 0.5rem 0.75rem; background: var(--ent-surface); color: var(--ent-accent); border-radius: 4px; }
.xo-skip:focus { top: 8px; }

.xo-header { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 1.25rem; background: var(--ent-surface); border-bottom: 1px solid var(--ent-line); flex-wrap: wrap; }
.xo-brand { display: flex; flex-direction: column; flex: 1 1 14rem; min-width: 0; }
.xo-council { font-size: var(--ent-fs-micro, 0.6875rem); text-transform: uppercase; letter-spacing: 0.06em; color: var(--ent-text-3); }
.xo-title { margin: 0; font-size: 1.25rem; font-weight: 600; }
.xo-asof { margin: 0; color: var(--ent-text-3); font-size: 0.8125rem; }

.xo-main { max-width: 76rem; margin: 0 auto; padding: 1.25rem; }
.xo-main:focus { outline: none; }
.xo-lede { margin: 0 0 1rem; color: var(--ent-text-2); max-width: 46rem; }

.xo-alert { display: flex; align-items: center; gap: 0.5rem; margin: 0 0 1rem; padding: 0.625rem 0.875rem; background: var(--ent-danger-soft); color: var(--ent-danger); border-radius: 6px; }
.xo-retry { margin-left: auto; padding: 0.25rem 0.625rem; border: 1px solid var(--ent-danger); background: var(--ent-surface); color: var(--ent-danger); border-radius: 4px; cursor: pointer; }

.xo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr)); gap: 1rem; align-items: start; }
.xo-card { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: 8px; padding: 1rem 1.125rem; }
.xo-card-head { display: flex; gap: 0.75rem; align-items: flex-start; margin-bottom: 0.75rem; }
.xo-card-icon { color: var(--ent-accent); margin-top: 0.125rem; flex: none; }
.xo-card-title { margin: 0; font-size: 1rem; font-weight: 600; }
.xo-card-post { margin: 0.125rem 0 0; font-size: 0.8125rem; color: var(--ent-text-3); }

.xo-group + .xo-group { margin-top: 0.875rem; padding-top: 0.75rem; border-top: 1px solid var(--ent-line); }
.xo-group-title { margin: 0 0 0.375rem; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ent-text-2); }

.xo-stats { margin: 0; display: grid; gap: 0.25rem; }
.xo-stat { display: flex; justify-content: space-between; gap: 1rem; padding: 0.3125rem 0; border-bottom: 1px solid var(--ent-surface-2); }
.xo-stat:last-child { border-bottom: 0; }
.xo-stat dt { color: var(--ent-text-2); font-size: 0.875rem; }
.xo-stat dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
.xo-stat dd.is-warn { color: var(--ent-warning); }
.xo-stat dd.is-bad { color: var(--ent-danger); }
.xo-stat dd.is-good { color: var(--ent-success); }

.xo-missing { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0; padding: 0.625rem 0.75rem; background: var(--ent-surface-2); border-radius: 6px; color: var(--ent-text-2); font-size: 0.875rem; }
.xo-missing svg { flex: none; margin-top: 0.125rem; }
.xo-missing.is-error { background: var(--ent-warning-soft); color: var(--ent-warning); }

.xo-link { display: inline-flex; align-items: center; gap: 0.25rem; margin-top: 0.875rem; color: var(--ent-accent); font-size: 0.875rem; text-decoration: none; }
.xo-link:hover { text-decoration: underline; }
</style>
