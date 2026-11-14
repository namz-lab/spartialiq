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
import type { UnitKey } from '@/services/units'
import { auditGroup, engineeringGroup, hrGroup, landGroup, missing, planningGroup, socialGroup, type Group } from '@/views/units/unitStats'
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

const cards = computed<Card[]>(() => {
  const o = overview.value
  const miss = (note: string, heading?: string) => () => missing(overviewError.value ?? note, !!overviewError.value, heading)

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
        landGroup(o?.land, miss('The land register could not be read.', 'Land register')),
      ],
    },
    {
      key: 'engineering', unit: 'engineering', title: 'Engineering and Works', post: 'Engineer', icon: HardHat,
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
            <p v-if="g.loaded && g.footnote" class="xo-foot">{{ g.footnote }}</p>
            <p v-else-if="!g.loaded" class="xo-missing" :class="{ 'is-error': g.unavailable }">
              <component :is="g.unavailable ? TriangleAlert : Info" :size="16" aria-hidden="true" />
              <span>{{ g.note }}</span>
            </p>
          </div>

          <div class="xo-links">
            <RouterLink :to="`/units/${c.unit}`" class="xo-link">
              Unit dashboard <ArrowRight :size="14" aria-hidden="true" />
            </RouterLink>
            <RouterLink v-if="c.link" :to="c.link.to" class="xo-link">
              {{ c.link.label }} <ArrowRight :size="14" aria-hidden="true" />
            </RouterLink>
          </div>
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

.xo-links { display: flex; flex-wrap: wrap; gap: 0.25rem 1.25rem; margin-top: 0.875rem; }
.xo-foot { margin: 0.375rem 0 0; font-size: 0.8125rem; color: var(--ent-text-3); }
.xo-link { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--ent-accent); font-size: 0.875rem; text-decoration: none; }
.xo-link:hover { text-decoration: underline; }
</style>
