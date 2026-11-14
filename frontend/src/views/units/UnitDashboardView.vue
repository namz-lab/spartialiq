<script setup lang="ts">
// A unit's dashboard: the Executive Arm's one page per unit (Planning, Finance, Engineering, HR / Social Services /
// Administration, Internal Audit). The Chief Executive opens each from the overview; a unit's head opens only their own.
// The server decides who may read what; this page only draws what it is given.
//
// Rules it keeps (the same as the Chief Executive's overview):
//   - A register with nothing in it says so and says what is missing; it is never a row of zeros.
//   - Staff posts come from the organisation chart. A post with no holder is shown as vacant, never filled in.
//   - A unit with no ward measure says so, rather than drawing an empty map.
//   - Read-only: nothing here changes a figure or a post.
import { computed, onMounted, ref, watch, type Component } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Banknote, Building2, HardHat, HeartPulse, Info, ShieldCheck, TriangleAlert } from 'lucide-vue-next'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import ExecutiveWardMap from '@/views/executive/ExecutiveWardMap.vue'
import { useAuthStore } from '@/stores/auth'
import { unitsApi, type UnitDashboard, type UnitKey } from '@/services/units'
import { UNIT_LABEL } from '@/views/units/unitCatalogue'
import {
  auditGroup, engineeringGroup, hrGroup, landGroup, missing, planningGroup, socialGroup, type Group,
} from '@/views/units/unitStats'

const props = defineProps<{ unit: string }>()
const router = useRouter()
const auth = useAuthStore()

const dash = ref<UnitDashboard | null>(null)
const error = ref<string | null>(null)
const forbidden = ref(false)
const loading = ref(true)

async function load() {
  loading.value = true
  error.value = null
  forbidden.value = false
  dash.value = null
  try {
    dash.value = await unitsApi.get(props.unit)
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status
    if (status === 403) forbidden.value = true
    else if (status === 404) error.value = 'There is no such unit.'
    else error.value = 'This unit could not be read. Try again in a moment.'
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => props.unit, load)

const isChief = computed(() => auth.user?.role === 'accounting_officer')
const roleLabel = computed(() => (isChief.value ? 'Chief Executive' : (dash.value?.unit.post ?? 'Unit head')))

function handleLogout() {
  auth.logout()
  router.push('/login')
}

const ICONS: Record<UnitKey, Component> = {
  finance: Banknote, planning: Building2, engineering: HardHat, social_admin: HeartPulse, audit: ShieldCheck,
}
const icon = computed(() => ICONS[props.unit as UnitKey] ?? Building2)
const title = computed(() => dash.value?.unit.label ?? UNIT_LABEL[props.unit as UnitKey] ?? 'Unit')

// ── The figures ────────────────────────────────────────────────────────
const groups = computed<Group[]>(() => {
  const s = dash.value?.sections
  if (!s) return []
  const fail = (note: string, heading?: string) => () => missing(note, true, heading)
  const out: Group[] = []
  if ('planning' in s) out.push(planningGroup(s.planning, fail('Development control could not be read.', 'Development control')))
  if ('land' in s) out.push(landGroup(s.land, fail('The land register could not be read.', 'Land register')))
  if ('engineering' in s) out.push(engineeringGroup(s.engineering, fail('Engineering could not be read.')))
  if ('social_services' in s) out.push({ ...socialGroup(s.social_services, fail('Social services could not be read.')), heading: 'Social services' })
  if ('hr' in s) out.push({ ...hrGroup(s.hr, fail('Human resources could not be read.')), heading: 'Human resources and administration' })
  if ('audit' in s) out.push(auditGroup(s.audit, fail('Internal audit could not be read.')))
  return out
})

/** Finance keeps its figures in the finance workspaces; this page says where, instead of repeating or inventing them. */
const keptElsewhere = computed(() => props.unit === 'finance'
  ? "The financial position is kept in the finance workspaces. Open them from the links below; this page does not repeat it."
  : '')

const asOf = computed(() => {
  const t = dash.value?.as_of
  return t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
})

const noMapText = computed(() => props.unit === 'audit'
  ? 'Audit findings are not tied to a ward, so this unit has no ward map.'
  : 'This unit has no ward-level measure yet.')

/** The desks this unit's head already works from: the CEO is offered them too, for the detail behind a figure. */
const desks = computed(() => dash.value?.unit.desks ?? [])
</script>

<template>
  <div class="ud-root">
    <a class="ud-skip" href="#ud-main">Skip to content</a>
    <header class="ud-header">
      <div class="ud-brand">
        <span class="ud-council">Vungu Rural District Council</span>
        <h1 class="ud-title"><component :is="icon" :size="20" class="ud-title-icon" aria-hidden="true" />{{ title }}</h1>
        <p v-if="dash" class="ud-post">
          {{ dash.unit.post }}:
          <template v-if="dash.head && !dash.head.vacant">{{ dash.head.holder_name }}</template>
          <span v-else class="ud-vacant">post vacant</span>
        </p>
      </div>
      <p v-if="asOf" class="ud-asof">As at {{ asOf }}</p>
      <ProfileDropdown :role-label="roleLabel" avatar-key="unit_avatar" @logout="handleLogout" />
    </header>

    <main id="ud-main" class="ud-main" tabindex="-1">
      <RouterLink v-if="isChief" to="/executive" class="ud-back"><ArrowLeft :size="14" aria-hidden="true" /> Chief Executive's overview</RouterLink>

      <p v-if="loading" class="ud-quiet">Reading this unit…</p>
      <p v-else-if="forbidden" class="ud-alert" role="alert">
        <TriangleAlert :size="16" aria-hidden="true" />This unit's dashboard is not yours to open.
      </p>
      <p v-else-if="error" class="ud-alert" role="alert">
        <TriangleAlert :size="16" aria-hidden="true" />{{ error }}
        <button type="button" class="ud-retry" @click="load">Try again</button>
      </p>

      <template v-else-if="dash">
        <div class="ud-grid">
          <section class="ud-card" aria-labelledby="ud-figures">
            <h2 id="ud-figures" class="ud-card-title">Where the unit stands</h2>
            <p v-if="keptElsewhere" class="ud-missing"><Info :size="16" aria-hidden="true" /><span>{{ keptElsewhere }}</span></p>
            <div v-for="(g, i) in groups" :key="i" class="ud-group">
              <h3 v-if="g.heading" class="ud-group-title">{{ g.heading }}</h3>
              <dl v-if="g.loaded" class="ud-stats">
                <div v-for="s in g.stats" :key="s.label" class="ud-stat">
                  <dt>{{ s.label }}</dt>
                  <dd :class="s.tone ? `is-${s.tone}` : undefined">{{ s.value }}</dd>
                </div>
              </dl>
              <p v-if="g.loaded && g.footnote" class="ud-foot">{{ g.footnote }}</p>
              <p v-else-if="!g.loaded" class="ud-missing" :class="{ 'is-error': g.unavailable }">
                <component :is="g.unavailable ? TriangleAlert : Info" :size="16" aria-hidden="true" />
                <span>{{ g.note }}</span>
              </p>
            </div>
            <ul v-if="desks.length" class="ud-desks" aria-label="Open the unit's working desks">
              <li v-for="d in desks" :key="d.path + d.label">
                <RouterLink :to="d.path" class="ud-link">{{ d.label }} <ArrowRight :size="14" aria-hidden="true" /></RouterLink>
              </li>
            </ul>
          </section>

          <section class="ud-card" aria-labelledby="ud-establishment">
            <h2 id="ud-establishment" class="ud-card-title">Establishment</h2>
            <p class="ud-sub">
              From the organisation chart:
              {{ dash.establishment.total }} {{ dash.establishment.total === 1 ? 'post' : 'posts' }},
              {{ dash.establishment.vacant }} vacant.
            </p>
            <p v-if="dash.establishment.total === 0" class="ud-missing">
              <Info :size="16" aria-hidden="true" /><span>No posts are recorded for this unit in the organisation chart.</span>
            </p>
            <table v-else class="ud-table">
              <caption class="ud-sr">Posts in this unit</caption>
              <thead><tr><th scope="col">Post</th><th scope="col">Holder</th></tr></thead>
              <tbody>
                <tr v-for="p in dash.establishment.posts" :key="p.id" :class="{ 'is-head': p.is_head }">
                  <th scope="row">{{ p.title }}</th>
                  <td><span v-if="p.vacant" class="ud-tag">Vacant</span><template v-else>{{ p.holder_name }}</template></td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>

        <ExecutiveWardMap v-if="dash.maps.has_measures" :key="unit" :unit-key="(unit as UnitKey)" />
        <p v-else class="ud-missing ud-nomap"><Info :size="16" aria-hidden="true" /><span>{{ noMapText }}</span></p>
      </template>
    </main>
  </div>
</template>

<style scoped>
.ud-root { min-height: var(--ent-vh, 100vh); background: var(--ent-canvas); color: var(--ent-text); font-family: var(--ent-font); }
.ud-skip { position: absolute; left: 8px; top: -48px; z-index: 80; padding: 0.5rem 0.75rem; background: var(--ent-surface); color: var(--ent-accent); border-radius: 4px; }
.ud-skip:focus { top: 8px; }
.ud-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.ud-header { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 1.25rem; background: var(--ent-surface); border-bottom: 1px solid var(--ent-line); flex-wrap: wrap; }
.ud-brand { display: flex; flex-direction: column; flex: 1 1 14rem; min-width: 0; }
.ud-council { font-size: var(--ent-fs-micro, 0.6875rem); text-transform: uppercase; letter-spacing: 0.06em; color: var(--ent-text-3); }
.ud-title { margin: 0; font-size: 1.25rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; }
.ud-title-icon { color: var(--ent-accent); flex: none; }
.ud-post { margin: 0.125rem 0 0; font-size: 0.8125rem; color: var(--ent-text-2); }
.ud-vacant { color: var(--ent-warning); font-weight: 600; }
.ud-asof { margin: 0; color: var(--ent-text-3); font-size: 0.8125rem; }

.ud-main { max-width: 76rem; margin: 0 auto; padding: 1.25rem; }
.ud-main:focus { outline: none; }
.ud-back { display: inline-flex; align-items: center; gap: 0.25rem; margin-bottom: 0.75rem; color: var(--ent-accent); font-size: 0.875rem; text-decoration: none; }
.ud-back:hover { text-decoration: underline; }
.ud-quiet { color: var(--ent-text-2); }
.ud-alert { display: flex; align-items: center; gap: 0.5rem; margin: 0 0 1rem; padding: 0.625rem 0.875rem; background: var(--ent-danger-soft); color: var(--ent-danger); border-radius: 6px; }
.ud-retry { margin-left: auto; padding: 0.25rem 0.625rem; border: 1px solid var(--ent-danger); background: var(--ent-surface); color: var(--ent-danger); border-radius: 4px; cursor: pointer; }

.ud-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); gap: 1rem; align-items: start; }
.ud-card { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: 8px; padding: 1rem 1.125rem; }
.ud-card-title { margin: 0 0 0.75rem; font-size: 1rem; font-weight: 600; }
.ud-sub { margin: -0.25rem 0 0.5rem; font-size: 0.8125rem; color: var(--ent-text-3); }

.ud-group + .ud-group { margin-top: 0.875rem; padding-top: 0.75rem; border-top: 1px solid var(--ent-line); }
.ud-group-title { margin: 0 0 0.375rem; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ent-text-2); }
.ud-stats { margin: 0; display: grid; gap: 0.25rem; }
.ud-stat { display: flex; justify-content: space-between; gap: 1rem; padding: 0.3125rem 0; border-bottom: 1px solid var(--ent-surface-2); }
.ud-stat:last-child { border-bottom: 0; }
.ud-stat dt { color: var(--ent-text-2); font-size: 0.875rem; }
.ud-stat dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
.ud-stat dd.is-warn { color: var(--ent-warning); }
.ud-stat dd.is-bad { color: var(--ent-danger); }
.ud-stat dd.is-good { color: var(--ent-success); }

.ud-foot { margin: 0.375rem 0 0; font-size: 0.8125rem; color: var(--ent-text-3); }
.ud-missing { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0; padding: 0.625rem 0.75rem; background: var(--ent-surface-2); border-radius: 6px; color: var(--ent-text-2); font-size: 0.875rem; }
.ud-missing svg { flex: none; margin-top: 0.125rem; }
.ud-missing.is-error { background: var(--ent-warning-soft); color: var(--ent-warning); }
.ud-nomap { margin-top: 1.5rem; }

.ud-desks { list-style: none; margin: 0.875rem 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.25rem 1.25rem; }
.ud-link { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--ent-accent); font-size: 0.875rem; text-decoration: none; }
.ud-link:hover { text-decoration: underline; }

.ud-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.ud-table th, .ud-table td { padding: 0.4375rem 0.5rem; border-top: 1px solid var(--ent-surface-2); text-align: left; font-weight: 400; }
.ud-table thead th { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ent-text-2); border-top: 0; }
.ud-table tr.is-head th { font-weight: 600; }
.ud-tag { display: inline-block; padding: 0.0625rem 0.5rem; border-radius: 999px; background: var(--ent-warning-soft); color: var(--ent-warning); font-size: 0.75rem; font-weight: 600; }
</style>
