<script setup lang="ts">
// The EO Planning's team at a glance: the Chief Executive's overview, applied to the desks under the EO.
//
//   ?section=team            one tile per desk, the figures to look at first; the whole tile opens the desk
//   ?section=team&tab=clerk  that desk in full, and the screens of this console where its work is seen
//
// Read-only: nothing here changes a figure. The figures come from GET /api/units/planning/team, which only the
// EO and the Chief Executive may read; anyone else who opens the console is told so instead of seeing zeros.
// A desk whose registers are empty says so, and says what is missing.
import { computed, onMounted, ref } from 'vue'
import { ArrowLeft, ArrowRight, Info, LayoutGrid, RefreshCw, TriangleAlert } from 'lucide-vue-next'
import GlanceGrid from '@/components/shared/GlanceGrid.vue'
import { unbroken } from '@/components/shared/glance'
import ExportMenu from '@/components/shared/ExportMenu.vue'
import type { ExportTable } from '@/utils/tableExport'
import { groupsToTable } from '@/views/units/unitStats'
import { planningTeamApi, type PlanningTeam } from '@/services/planningTeam'
import { useEoNav } from '@/eo-planner/useEoNav'
import { isDeskKey, teamCards } from '@/eo-planner/teamDesks'
import '@/views/inspector/inspector.css'

const nav = useEoNav()

const team = ref<PlanningTeam | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const refused = ref(false)

async function load() {
  loading.value = true
  error.value = null
  try {
    team.value = await planningTeamApi.read()
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status
    if (status === 403) refused.value = true
    else error.value = 'The team could not be read. Try again in a moment.'
  } finally {
    loading.value = false
  }
}
onMounted(load)

const cards = computed(() => teamCards(team.value, { loading: loading.value, error: error.value }))
const desk = computed(() => {
  const t = nav.param('tab')
  return isDeskKey(t) ? cards.value.find((c) => c.key === t) ?? null : null
})

const asOf = computed(() => {
  const t = team.value?.as_of
  return t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
})

function build(): ExportTable {
  return groupsToTable('The planning team at a glance', asOf.value || 'now', cards.value.map((c) => ({ area: c.title, groups: c.groups })))
}
</script>

<template>
  <div class="ins-page tm">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Executive Officer — Planning<template v-if="asOf"> · As at {{ asOf }}</template></span>
        <h2 class="ins-title"><LayoutGrid :size="18" aria-hidden="true" /> {{ desk ? desk.title : 'At a glance' }}</h2>
        <p v-if="!desk" class="ins-lede">
          The desks under you, read from the council's own registers. Figures to look at come first. Nothing here can be changed from this page.
        </p>
        <p v-else class="ins-lede">{{ desk.post }}</p>
      </div>
      <div class="ins-actions">
        <ExportMenu v-if="!refused" :build="build" filename="planning-team-at-a-glance" print />
        <button type="button" class="ins-iconbtn" :disabled="loading" title="Re-read the team" @click="load">
          <RefreshCw :size="15" aria-hidden="true" :class="{ 'ins-spin': loading }" />
          <span class="ent-sr-only">Re-read the team</span>
        </button>
      </div>
    </header>

    <p v-if="refused" class="tm-note" role="status">
      <Info :size="16" aria-hidden="true" /> This overview is the EO Planning's own. Your work is in your own console.
    </p>

    <template v-else>
      <p v-if="error" class="tm-alert" role="alert">
        <TriangleAlert :size="16" aria-hidden="true" />{{ error }}
        <button type="button" class="tm-retry" @click="load">Try again</button>
      </p>

      <section v-if="!desk" aria-label="The desks under the EO Planning" data-testid="tm-summary">
        <GlanceGrid :cards="cards" testid="tm" @open="(k) => nav.setParam('tab', k)" />
      </section>

      <section v-else class="tm-desk" :data-testid="`tm-desk-${desk.key}`">
        <button type="button" class="tm-back" @click="nav.setParam('tab', null)">
          <ArrowLeft :size="14" aria-hidden="true" /> All desks
        </button>
        <div class="tm-groups">
          <div v-for="(g, i) in desk.groups" :key="i" class="tm-group">
            <h3 v-if="g.heading" class="tm-group-title">{{ g.heading }}</h3>
            <dl v-if="g.loaded" class="tm-stats">
              <div v-for="s in g.stats" :key="s.label" class="tm-stat">
                <dt>{{ s.label }}</dt>
                <dd :class="s.tone ? `is-${s.tone}` : undefined">{{ unbroken(s.value) }}</dd>
              </div>
            </dl>
            <p v-else class="tm-missing" :class="{ 'is-error': g.unavailable }">
              <component :is="g.unavailable ? TriangleAlert : Info" :size="16" aria-hidden="true" />
              <span>{{ g.note }}</span>
            </p>
          </div>
        </div>
        <div class="tm-links">
          <span class="tm-links-head">Where you see this work</span>
          <button v-for="l in desk.links" :key="l.section" type="button" class="tm-link" @click="nav.go(l.section)">
            {{ l.label }} <ArrowRight :size="14" aria-hidden="true" />
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.tm-alert, .tm-note { display: flex; align-items: center; gap: 0.5rem; margin: 0; padding: 0.625rem 0.875rem; border-radius: 6px; }
.tm-alert { background: var(--ent-danger-soft); color: var(--ent-danger); }
.tm-note { background: var(--ent-surface-2); color: var(--ent-text-2); }
.tm-retry { margin-left: auto; padding: 0.25rem 0.625rem; border: 1px solid var(--ent-danger); background: var(--ent-surface); color: var(--ent-danger); border-radius: 4px; cursor: pointer; }

.tm-desk { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: 8px; padding: 1.25rem 1.5rem; max-width: 64rem; }
.tm-back { display: inline-flex; align-items: center; gap: 0.25rem; margin-bottom: 0.75rem; padding: 0; border: 0; background: none; color: var(--ent-accent); font: inherit; font-size: 0.875rem; cursor: pointer; }
.tm-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: 0.5rem 2rem; align-items: start; }
.tm-group-title { margin: 0.5rem 0 0.375rem; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ent-text-2); }
.tm-stats { margin: 0; display: grid; gap: 0.25rem; }
.tm-stat { display: flex; justify-content: space-between; gap: 1rem; padding: 0.3125rem 0; border-bottom: 1px solid var(--ent-surface-2); }
.tm-stat:last-child { border-bottom: 0; }
.tm-stat dt { color: var(--ent-text-2); font-size: 0.875rem; }
.tm-stat dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
.tm-stat dd.is-warn { color: var(--ent-warning); }
.tm-stat dd.is-bad { color: var(--ent-danger); }
.tm-stat dd.is-good { color: var(--ent-success); }
.tm-missing { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0.25rem 0 0; padding: 0.625rem 0.75rem; background: var(--ent-surface-2); border-radius: 6px; color: var(--ent-text-2); font-size: 0.875rem; }
.tm-missing.is-error { background: var(--ent-warning-soft); color: var(--ent-warning); }
.tm-links { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 1.25rem; margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--ent-surface-2); }
.tm-links-head { font-size: 0.8125rem; color: var(--ent-text-3); }
.tm-link { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0; border: 0; background: none; color: var(--ent-accent); font: inherit; font-size: 0.875rem; cursor: pointer; }
.tm-link:hover, .tm-back:hover { text-decoration: underline; }

@media print {
  .ins-actions, .tm-back, .tm-links { display: none !important; }
}
</style>
