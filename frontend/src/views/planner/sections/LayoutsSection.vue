<script setup lang="ts">
// Layouts — layout plans, land budgets and stand schedules.
//
//   Council layouts    Planning Studio projects (planning_project). Review the
//                      land budget against norms and the stand schedule;
//                      approve a technician's layout or return it with comments.
//   Submitted layouts  Subdivision / consolidation applications from
//                      developers, co-operatives and mining companies. These
//                      are assessed as applications, in Application 360.
import { caseRef } from '@/composables/useApplicationPipeline'
import { computed, inject, onMounted, ref } from 'vue'
import { planningApi } from '@/services/api'
import { dmApi, type PermitApplication } from '@/services/developmentManagementService'
import { PLANNER_SHELL_KEY } from '@/composables/usePlannerShell'
import { useAuthStore } from '@/stores/auth'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { exportLotScheduleCsv } from '@/planning/planning-exports'
import type { PlanningProject } from '@/planning/planning-types'
import { landBudget, standSchedule, CATEGORY_LABEL, NORMS } from '../layoutBudget'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import { RefreshCw, FileDown, ArrowRight, Map as MapIcon, PenTool } from 'lucide-vue-next'

interface ProjectRow { id: string; name: string; area_sqm: number | null; lot_count: number; road_length_m: number | null; updated_at: string }

const shell = inject(PLANNER_SHELL_KEY, null)
const auth = useAuthStore()
const fb = useUiFeedback()
const officer = computed(() => auth.user?.name || auth.user?.email || 'Town Planning Officer')

const tab = ref<'council' | 'submitted'>('council')
const projects = ref<ProjectRow[]>([])
const submitted = ref<PermitApplication[]>([])
const loading = ref(false)

async function refresh() {
  loading.value = true
  try {
    const [p, s] = await Promise.allSettled([
      planningApi.listProjects(),
      Promise.all([
        dmApi.listAllPermits({ development_type: 'subdivision' }),
        dmApi.listAllPermits({ development_type: 'consolidation' }),
      ]),
    ])
    if (p.status === 'fulfilled') projects.value = (p.value.data?.data ?? []) as ProjectRow[]
    else fb.showToast(fb.parseApiError(p.reason, 'Could not load layouts'), 'error')
    if (s.status === 'fulfilled') submitted.value = [...s.value[0], ...s.value[1]]
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

// ── Selected council layout ──────────────────────────────────────────────
const selected = ref<(PlanningProject & { revision?: number }) | null>(null)
const opening = ref<string | null>(null)
async function open(id: string) {
  opening.value = id
  try {
    const r = await planningApi.getProject(id)
    selected.value = r.data?.data ?? r.data
    comments.value = String(selected.value?.meta?.reviewComments ?? '')
  } catch (e) {
    fb.showToast(fb.parseApiError(e, 'Could not open the layout'), 'error')
  } finally {
    opening.value = null
  }
}

const budget = computed(() => selected.value ? landBudget(selected.value) : [])
const schedule = computed(() => selected.value ? standSchedule(selected.value.lots ?? []) : [])
const studioLink = computed(() => {
  const ref = selected.value?.parcelReference
  return ref && ref.includes('/') ? `/planner/studio/${ref}` : null
})

const comments = ref('')
const reviewing = ref(false)
async function review(status: 'approved' | 'draft') {
  const p = selected.value
  if (!p) return
  if (status === 'draft' && !comments.value.trim()) {
    fb.openMessageBox({ kind: 'warn', title: 'Comments required', message: 'Say what the technician must change.' })
    return
  }
  const ok = await fb.confirmAction(status === 'approved' ? 'Approve this layout?' : 'Return this layout for amendment?',
    `${p.name} · ${p.lots?.length ?? 0} stands.`, { confirmLabel: status === 'approved' ? 'Approve' : 'Return' })
  if (!ok) return
  reviewing.value = true
  try {
    const meta = { ...(p.meta ?? {}), reviewComments: comments.value.trim(), reviewedBy: officer.value, reviewedAt: new Date().toISOString() }
    await planningApi.saveProject({ ...p, status: status === 'approved' ? 'approved' : 'draft', meta, baseRevision: p.revision ?? null })
    fb.showToast(status === 'approved' ? 'Layout approved' : 'Returned with comments', 'success')
    await open(p.id)
  } catch (e) {
    const conflict = (e as { response?: { status?: number } })?.response?.status === 409
    fb.openMessageBox({ kind: 'error', title: 'Could not record the review',
      message: conflict ? 'The layout was changed since you opened it. Reopen it and review the latest version.'
        : fb.parseApiError(e, 'The server rejected the review.') })
  } finally {
    reviewing.value = false
  }
}

const fmtHa = (m2?: number | null) => m2 == null ? '—' : `${(m2 / 10_000).toLocaleString('en-GB', { maximumFractionDigits: 2 })} ha`
const fmtDate = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const VERDICT_TONE = { within: 'positive', below: 'warning', above: 'warning', 'n/a': 'neutral' } as const
</script>

<template>
  <div class="ly">
    <header class="ly-head">
      <div>
        <h2>Layouts</h2>
        <p>Layout plans, land budgets and stand schedules</p>
      </div>
      <UiButton size="sm" :loading="loading" @click="refresh"><template #icon><RefreshCw :size="13" /></template>Refresh</UiButton>
      <UiButton v-if="shell" size="sm" variant="primary" @click="shell.showMap()"><template #icon><PenTool :size="13" /></template>Prepare a layout</UiButton>
    </header>

    <nav class="ly-tabs" role="tablist" aria-label="Layouts">
      <button role="tab" :aria-selected="tab === 'council'" :class="{ active: tab === 'council' }" @click="tab = 'council'">Council layouts ({{ projects.length }})</button>
      <button role="tab" :aria-selected="tab === 'submitted'" :class="{ active: tab === 'submitted' }" @click="tab = 'submitted'">Submitted by developers ({{ submitted.length }})</button>
    </nav>

    <div v-if="tab === 'council'" class="ly-split">
      <div class="ly-list">
        <UiEmptyState v-if="!projects.length && !loading" message="No layouts saved yet."
                      sub="Select a parcel on the map and open it in the Planning Studio to draw one." />
        <button v-for="p in projects" :key="p.id" type="button" class="ly-row" :class="{ active: selected?.id === p.id }"
                :aria-current="selected?.id === p.id ? 'true' : undefined" @click="open(p.id)">
          <span class="ly-name">{{ p.name }}</span>
          <span class="ly-meta">{{ p.lot_count }} stands · {{ fmtHa(p.area_sqm) }} · {{ fmtDate(p.updated_at) }}</span>
        </button>
      </div>

      <section v-if="selected" class="ly-detail" aria-live="polite">
        <div class="ly-title">
          <h3>{{ selected.name }}</h3>
          <UiStatusBadge :status="selected.status === 'in_review' ? 'under_review' : (selected.status ?? 'draft')" />
        </div>
        <p class="ly-meta">{{ fmtHa(selected.planningArea?.areaSqm) }} · {{ selected.lots?.length ?? 0 }} stands · revision {{ selected.revision ?? '—' }}
          <template v-if="selected.meta?.reviewedBy"> · last reviewed by {{ selected.meta.reviewedBy }} {{ fmtDate(String(selected.meta.reviewedAt ?? '')) }}</template>
        </p>

        <h4>Land budget</h4>
        <div class="ly-scroll"><table class="ly-table">
          <thead><tr><th scope="col">Use</th><th scope="col">Area</th><th scope="col">Share</th><th scope="col">Norm</th><th scope="col"><span class="ent-sr-only">Check</span></th></tr></thead>
          <tbody>
            <tr v-for="r in budget" :key="r.category">
              <td>{{ CATEGORY_LABEL[r.category] }}</td>
              <td>{{ fmtHa(r.areaSqm) }}</td>
              <td>{{ r.pct }}%</td>
              <td>{{ NORMS[r.category] ? `${NORMS[r.category]!.min}–${NORMS[r.category]!.max}%` : '—' }}</td>
              <td><UiStatusBadge v-if="r.verdict !== 'n/a'" :tone="VERDICT_TONE[r.verdict]" :label="r.verdict === 'within' ? 'Within' : r.verdict === 'below' ? 'Below norm' : 'Above norm'" /></td>
            </tr>
          </tbody>
        </table></div>
        <p class="ly-note">Norms are advisory. A departure needs a planning justification in the report.</p>

        <h4>Stand schedule</h4>
        <div v-if="schedule.length" class="ly-scroll"><table class="ly-table">
          <thead><tr><th scope="col">Use</th><th scope="col">Stands</th><th scope="col">Smallest</th><th scope="col">Average</th><th scope="col">Largest</th><th scope="col">Total</th></tr></thead>
          <tbody>
            <tr v-for="s in schedule" :key="s.use">
              <td class="ly-cap">{{ s.use }}</td><td>{{ s.count }}</td>
              <td>{{ s.minSqm.toLocaleString() }} m²</td><td>{{ s.avgSqm.toLocaleString() }} m²</td>
              <td>{{ s.maxSqm.toLocaleString() }} m²</td><td>{{ fmtHa(s.totalSqm) }}</td>
            </tr>
          </tbody>
        </table></div>
        <p v-else class="ly-note">No stands have been cut on this layout yet.</p>

        <div class="ly-actions">
          <UiButton size="sm" :disabled="!selected.lots?.length" @click="exportLotScheduleCsv(selected.lots, selected.name)">
            <template #icon><FileDown :size="12" /></template>Stand schedule (CSV)
          </UiButton>
          <router-link v-if="studioLink" :to="studioLink" class="ly-link"><MapIcon :size="12" aria-hidden="true" /> Open in Planning Studio</router-link>
        </div>

        <h4>Review</h4>
        <label class="ly-label">Comments to the technician
          <textarea v-model="comments" rows="3" placeholder="e.g. Widen the collector road reserve to 20 m; reserve a clinic site near the market" />
        </label>
        <div class="ly-actions">
          <UiButton size="sm" variant="primary" :loading="reviewing" :disabled="selected.status === 'approved'" @click="review('approved')">Approve layout</UiButton>
          <UiButton size="sm" :loading="reviewing" @click="review('draft')">Return for amendment</UiButton>
        </div>
      </section>
      <p v-else-if="projects.length" class="ly-note ly-pick">{{ opening ? 'Opening…' : 'Choose a layout to review its land budget and stand schedule.' }}</p>
    </div>

    <div v-else class="ly-sub">
      <p class="ly-note">Layouts and settlement plans lodged as subdivision or consolidation applications. Assess them as applications: site checks, referrals to roads, EMA and the surveyor, then a report.</p>
      <UiEmptyState v-if="!submitted.length && !loading" message="No subdivision or consolidation applications." />
      <ul v-else class="ly-apps">
        <li v-for="a in submitted" :key="a.id">
          <span class="ly-ref">{{ caseRef(a) }}</span>
          <span class="ly-app">{{ a.applicant_name }} · {{ a.development_type }} · Stand {{ a.stand_number }}</span>
          <UiStatusBadge :status="a.status" />
          <UiButton v-if="shell" size="sm" @click="shell.openCaseForStand(a.id, 'assessment')">Assess <ArrowRight :size="12" aria-hidden="true" /></UiButton>
        </li>
      </ul>
    </div>
    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.ly { padding: var(--ent-s4) var(--ent-s5); display: flex; flex-direction: column; gap: var(--ent-s3); height: 100%; min-height: 0; }
.ly-head { display: flex; align-items: flex-start; gap: var(--ent-s2); flex-wrap: wrap; }
.ly-head > div { flex: 1; min-width: 12rem; }
.ly-head h2 { margin: 0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); }
.ly-head p { margin: 4px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.ly-tabs { display: flex; gap: var(--ent-s1); border-bottom: 1px solid var(--ent-line); overflow-x: auto; overflow-y: hidden; }
.ly-tabs button { white-space: nowrap; min-height: var(--ent-touch-min); padding: var(--ent-s2) var(--ent-s3); font: inherit; font-size: var(--ent-fs-sm); color: var(--ent-text-2);
  background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; cursor: pointer; }
.ly-tabs button.active { color: var(--ent-accent); border-bottom-color: var(--ent-accent); font-weight: var(--ent-fw-semibold); }
.ly-tabs button:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.ly-split { display: grid; grid-template-columns: 17rem minmax(0, 1fr); gap: var(--ent-s4); flex: 1; min-height: 0; }
.ly-list { display: flex; flex-direction: column; gap: var(--ent-s1); overflow-y: auto; }
.ly-row { display: flex; flex-direction: column; gap: 2px; text-align: left; padding: var(--ent-s2) var(--ent-s3); font: inherit; color: var(--ent-text);
  background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); cursor: pointer; }
.ly-row.active { border-color: var(--ent-accent); box-shadow: inset 3px 0 0 var(--ent-accent); }
.ly-row:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.ly-name { font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); }
.ly-meta { font-size: var(--ent-fs-micro); color: var(--ent-text-3); margin: 0; }
.ly-detail { overflow-y: auto; min-height: 0; display: flex; flex-direction: column; gap: var(--ent-s2); }
.ly-detail h4 { margin: var(--ent-s3) 0 0; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); }
.ly-title { display: flex; align-items: center; gap: var(--ent-s2); }
.ly-title h3 { margin: 0; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-bold); }
.ly-table { width: 100%; border-collapse: collapse; font-size: var(--ent-fs-sm); background: var(--ent-surface); border: 1px solid var(--ent-line); }
.ly-table th { text-align: left; font-size: var(--ent-fs-xs); color: var(--ent-text-3); font-weight: var(--ent-fw-semibold); padding: var(--ent-s2); border-bottom: 1px solid var(--ent-line); }
.ly-table td { padding: var(--ent-s2); border-bottom: 1px solid var(--ent-line); font-variant-numeric: tabular-nums; }
.ly-scroll { overflow-x: auto; }
.ly-detail > * { flex-shrink: 0; }
.ly-cap { text-transform: capitalize; }
.ly-note { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
.ly-pick { align-self: center; justify-self: center; }
.ly-actions { display: flex; gap: var(--ent-s2); align-items: center; flex-wrap: wrap; }
.ly-link { display: inline-flex; align-items: center; gap: var(--ent-s1); font-size: var(--ent-fs-sm); color: var(--ent-accent); }
.ly-label { display: flex; flex-direction: column; gap: var(--ent-s1); font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.ly-label textarea { font: inherit; font-size: var(--ent-fs-sm); padding: var(--ent-s2); border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm); color: var(--ent-text); background: var(--ent-surface); }
.ly-label textarea:focus { outline: none; border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring); }
.ly-sub { display: flex; flex-direction: column; gap: var(--ent-s3); overflow-y: auto; }
.ly-apps { list-style: none; margin: 0; padding: 0; background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); }
.ly-apps li { display: flex; align-items: center; gap: var(--ent-s2); padding: var(--ent-s2) var(--ent-s3); border-top: 1px solid var(--ent-line); flex-wrap: wrap; }
.ly-apps li:first-child { border-top: none; }
.ly-ref { font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); }
.ly-app { flex: 1; font-size: var(--ent-fs-sm); min-width: 10rem; }
@media (max-width: 1023px) { .ly-split { grid-template-columns: 1fr; } .ly-list { max-height: 14rem; } }
@media (max-width: 767px) { .ly { padding: var(--ent-s3); } .ly-table { font-size: var(--ent-fs-xs); } }
</style>
