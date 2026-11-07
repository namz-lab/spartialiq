<script setup lang="ts">
// PlanAuditView — the whole of one plan's matrix and everything the audit found in it, written for the council.
//
// ONE JOB: let people who are not system users see, on one page, what the matrix says and what is still to be
// settled before it is trusted. It reads; it never edits and it never decides. Reviews are recorded in the plan
// workbench. The page can be printed for a meeting.
//
// THE AUDIT IS THE SERVER'S: the findings come from the database (migration 160). This page only puts them in
// council wording (FINDING_TEXT) and groups them. A finding kind it does not know is still shown, in the server's words.
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, Printer } from 'lucide-vue-next'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import {
  wb, refusalMessage, STATUS_LABEL, REVIEW_LABEL, FINDING_TEXT,
  type AuditFinding, type FindingSeverity, type MatrixGrid, type PlanAudit, type PlanDetail, type PlanStatus, type ReviewStatus,
} from '@/services/planWorkbench'

type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'negative'

const route = useRoute()
const planId = computed(() => String(route.params.id ?? ''))

const detail = ref<PlanDetail | null>(null)
const audit = ref<PlanAudit | null>(null)
const grid = ref<MatrixGrid | null>(null)
const loading = ref(true)
const problem = ref('')

onMounted(async () => {
  try {
    detail.value = await wb.getPlan(planId.value)
  } catch (err) {
    problem.value = refusalMessage(err, 'That plan could not be opened. It may not exist, or it may belong to another authority.')
    loading.value = false
    return
  }
  // The audit and the grid are what this page is for; say so if either is missing rather than show a partial picture as whole.
  const [a, g] = await Promise.allSettled([wb.audit(planId.value), wb.matrixGrid(planId.value)])
  if (a.status === 'fulfilled') audit.value = a.value
  if (g.status === 'fulfilled') grid.value = g.value
  if (a.status === 'rejected' || g.status === 'rejected') problem.value = 'Part of this page could not be loaded, so what is shown is incomplete.'
  loading.value = false
})

const plan = computed(() => detail.value?.plan ?? null)
const columns = computed(() => detail.value?.zone_types ?? [])
const provisional = computed(() => !!plan.value && !['approved', 'gazetted'].includes(plan.value.status))

const STATUS_WORDS: Record<string, string> = {
  unknown: 'its legal status has not been confirmed',
  draft: 'it is still a draft',
  public_notice: 'it is out for public notice',
  superseded: 'a newer version has replaced it',
}
const REVIEW_TONE: Record<ReviewStatus, Tone> = { unreviewed: 'neutral', in_review: 'warning', reviewed: 'positive' }
const SEV_RANK: Record<FindingSeverity, number> = { error: 0, warning: 1, review: 2 }
const SEV_LABEL: Record<FindingSeverity, string> = { error: 'Error', warning: 'Warning', review: 'To review' }
const SEV_TONE: Record<FindingSeverity, Tone> = { error: 'negative', warning: 'warning', review: 'info' }

const reviewedCount = computed(() => columns.value.filter((z) => z.review_status === 'reviewed').length)
const zoneName = (code: string | null) => columns.value.find((z) => z.code === code)?.name ?? code ?? ''

// ── What the council is asked to settle ─────────────────────────────────
interface Group { kind: string; severity: FindingSeverity; title: string; why: string | null; ask: string | null; items: AuditFinding[] }
const groups = computed<Group[]>(() => {
  const by = new Map<string, Group>()
  for (const f of audit.value?.findings ?? []) {
    let g = by.get(f.kind)
    if (!g) {
      const text = FINDING_TEXT[f.kind]
      g = { kind: f.kind, severity: f.severity, title: text?.title ?? f.kind.replace(/_/g, ' '), why: text?.why ?? null, ask: text?.ask ?? null, items: [] }
      by.set(f.kind, g)
    }
    g.items.push(f)
  }
  return [...by.values()].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.items.length - a.items.length || a.title.localeCompare(b.title))
})
const worstByZone = computed(() => {
  const worst = new Map<string, FindingSeverity>()
  for (const f of audit.value?.findings ?? []) {
    if (!f.zone_code) continue
    const cur = worst.get(f.zone_code)
    if (!cur || SEV_RANK[f.severity] < SEV_RANK[cur]) worst.set(f.zone_code, f.severity)
  }
  return worst
})

// ── The matrix at a glance (zones down, uses across) ────────────────────
const rows = computed(() => {
  const g = grid.value
  if (!g) return []
  return g.zone_types.map((z, i) => {
    const cells = g.land_uses.map((u) => u.cells[i])
    const col = columns.value.find((c) => c.code === z.code)
    return {
      code: z.code, name: z.label, cells,
      blank: cells.filter((c) => !c).length,
      review: (col?.review_status ?? 'unreviewed') as ReviewStatus,
      by: col?.reviewed_by ?? null,
      worst: worstByZone.value.get(z.code) ?? null,
    }
  })
})
const PERM_WORD: Record<string, string> = { P: 'permitted', SC: 'special consent', X: 'prohibited' }
const cellLabel = (use: string, cell: { permission_code: string } | null) => `${use}: ${cell ? PERM_WORD[cell.permission_code] : 'not decided'}`
const decisionCount = computed(() => rows.value.reduce((n, r) => n + r.cells.length - r.blank, 0))
const blankCount = computed(() => rows.value.reduce((n, r) => n + r.blank, 0))
const printPage = () => window.print()
</script>

<template>
  <div class="pa-root">
    <header class="pa-head">
      <div>
        <a class="pa-back" href="/admin/plan-workbench" @click.prevent="$router.push('/admin/plan-workbench')">
          <ArrowLeft :size="14" aria-hidden="true" /> Plan workbench
        </a>
        <h1 class="pa-title">{{ plan?.title ?? 'Plan audit' }}</h1>
        <p v-if="plan" class="pa-sub">
          <template v-if="plan.is_template">A template</template>
          <template v-else>Version {{ plan.version }} · {{ plan.authority_name }}</template>
          · <UiStatusBadge :tone="provisional ? 'warning' : 'positive'" :label="STATUS_LABEL[plan.status as PlanStatus]" />
        </p>
      </div>
      <UiButton class="pa-noprint" @click="printPage">
        <template #icon><Printer :size="16" /></template>
        Print this page
      </UiButton>
    </header>

    <p v-if="loading" class="pa-aside" aria-busy="true">Loading the plan…</p>
    <div v-if="problem" class="pa-problem" role="alert">{{ problem }}</div>

    <template v-if="plan && !loading">
      <div v-if="provisional" class="pa-draft" role="status" data-testid="draft-banner">
        <strong>Draft rules, not council policy.</strong>
        <template v-if="plan.is_template"> This is a template, a starting point for an authority's own plan.</template>
        <template v-else> This plan is not in force: {{ STATUS_WORDS[plan.status] ?? 'it is not yet approved' }}. What it decides is guidance until it is approved or gazetted.</template>
      </div>

      <section class="pa-tiles" aria-label="Summary">
        <div class="pa-tile" :class="{ bad: (audit?.errors ?? 0) > 0 }"><b>{{ audit?.errors ?? '–' }}</b><span>errors</span></div>
        <div class="pa-tile" :class="{ warn: (audit?.warnings ?? 0) > 0 }"><b>{{ audit?.warnings ?? '–' }}</b><span>warnings</span></div>
        <div class="pa-tile"><b>{{ audit?.reviews ?? '–' }}</b><span>points to review</span></div>
        <div class="pa-tile"><b>{{ reviewedCount }} of {{ columns.length }}</b><span>zone columns reviewed</span></div>
        <div class="pa-tile"><b>{{ grid ? decisionCount : '–' }}</b><span>decisions made{{ grid && blankCount ? `, ${blankCount} blank` : '' }}</span></div>
      </section>

      <UiPanel title="For the council to settle" subtitle="Each point says what was found, why it matters and what is asked">
        <p v-if="!audit" class="pa-aside first">The audit could not be read, so nothing can be said about this plan's findings.</p>
        <p v-else-if="!groups.length" class="pa-aside first" data-testid="nothing-to-settle">
          Nothing to settle. The audit found no errors, warnings or points to review in this plan.
        </p>
        <article v-for="g in groups" :key="g.kind" class="pa-group" :data-kind="g.kind">
          <header class="pa-group-head">
            <UiStatusBadge :tone="SEV_TONE[g.severity]" :label="SEV_LABEL[g.severity]" />
            <h3>{{ g.title }}</h3>
            <span class="pa-count">{{ g.items.length }} {{ g.items.length === 1 ? 'place' : 'places' }}</span>
          </header>
          <p v-if="g.why" class="pa-why"><strong>Why it matters.</strong> {{ g.why }}</p>
          <p v-if="g.ask" class="pa-ask"><strong>To decide.</strong> {{ g.ask }}</p>
          <ul class="pa-items">
            <li v-for="(f, i) in g.items" :key="i">
              <strong v-if="f.zone_code">{{ zoneName(f.zone_code) }}.</strong>
              <strong v-else-if="f.group_code">Use {{ f.group_code }}.</strong>
              {{ f.detail }}
            </li>
          </ul>
        </article>
      </UiPanel>

      <UiPanel title="The matrix at a glance" subtitle="Zones down, land use classes across. A blank is a use nobody has decided.">
        <p v-if="!grid" class="pa-aside first">The matrix could not be read.</p>
        <template v-else>
          <ul class="pa-legend" aria-label="Key">
            <li><span class="cell P">P</span> permitted</li>
            <li><span class="cell SC">SC</span> special consent</li>
            <li><span class="cell X">X</span> prohibited</li>
            <li><span class="cell blank">·</span> not decided</li>
          </ul>
          <div class="pa-gridwrap">
            <table class="pa-grid">
              <thead>
                <tr>
                  <th scope="col" class="zone">Zone</th>
                  <th v-for="u in grid.land_uses" :key="u.code" scope="col" class="use" :title="u.description">{{ u.code }}</th>
                  <th scope="col" class="rv">Review</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in rows" :key="r.code" :class="r.worst ? `has-${r.worst}` : ''" :data-zone="r.code">
                  <th scope="row" class="zone">
                    {{ r.name }}
                    <span v-if="r.worst" class="flag" :class="r.worst">{{ SEV_LABEL[r.worst].toLowerCase() }}</span>
                  </th>
                  <td v-for="(c, i) in r.cells" :key="i"
                      class="cell" :class="c ? c.permission_code : 'blank'"
                      :title="cellLabel(grid.land_uses[i].description, c)">{{ c ? c.permission_code : '·' }}</td>
                  <td class="rv">
                    <UiStatusBadge :tone="REVIEW_TONE[r.review]" :label="REVIEW_LABEL[r.review]" />
                    <span v-if="r.review === 'reviewed' && r.by" class="pa-by">{{ r.by }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <h3 class="pa-keyhead">Land use classes</h3>
          <ul class="pa-uses">
            <li v-for="u in grid.land_uses" :key="u.code"><span class="code">{{ u.code }}</span> {{ u.description }}</li>
          </ul>
        </template>
      </UiPanel>

      <section class="pa-sign" aria-label="Council sign-off">
        <div>Reviewed for the council by<br><br>Name, date</div>
        <div>Points above settled<br><br>Name, date</div>
      </section>
      <p class="pa-aside">
        This page reads the plan as it stands. Reviews and edits are made in the plan workbench; this page does not change anything.
      </p>
    </template>
  </div>
</template>

<style scoped>
.pa-root {
  display: flex; flex-direction: column; gap: var(--ent-s5);
  padding: var(--ent-s6); max-width: 1200px; margin: 0 auto;
  background: var(--ent-canvas); color: var(--ent-text);
  font-family: var(--ent-font-sans, system-ui, sans-serif);
  min-height: var(--ent-vh);
}
@media (max-width: 768px) { .pa-root { padding: var(--ent-s4); gap: var(--ent-s4); } }
.pa-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--ent-s4); flex-wrap: wrap; }
.pa-back { display: inline-flex; align-items: center; gap: var(--ent-s1); font-size: var(--ent-fs-sm); color: var(--ent-text-muted); text-decoration: none; }
.pa-back:hover { color: var(--ent-text); }
.pa-title { margin: var(--ent-s2) 0 0; font-size: var(--ent-fs-h2, 1.5rem); line-height: 1.2; text-wrap: balance; }
.pa-sub { margin: var(--ent-s2) 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-muted); display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; }
.pa-aside { margin: var(--ent-s3) 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-muted); max-width: 80ch; }
.pa-aside.first { margin-top: 0; }
.pa-problem {
  padding: var(--ent-s3); border-radius: var(--ent-r-md); font-size: var(--ent-fs-sm);
  border: 1px solid var(--ent-tone-negative-line); background: var(--ent-tone-negative-bg); color: var(--ent-tone-negative-fg);
}
.pa-draft {
  padding: var(--ent-s3) var(--ent-s4); border-radius: var(--ent-r-md); font-size: var(--ent-fs-sm); max-width: 90ch;
  border: 1px solid var(--ent-tone-warning-line); background: var(--ent-tone-warning-bg); color: var(--ent-tone-warning-fg);
}
.pa-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--ent-s3); }
.pa-tile { padding: var(--ent-s3) var(--ent-s4); border: 1px solid var(--ent-border); border-radius: var(--ent-r-md); background: var(--ent-surface); }
.pa-tile b { display: block; font-size: var(--ent-fs-lg, 1.25rem); font-weight: var(--ent-fw-semibold, 600); font-variant-numeric: tabular-nums; }
.pa-tile span { font-size: var(--ent-fs-sm); color: var(--ent-text-muted); }
.pa-tile.bad { border-color: var(--ent-tone-negative-line); }
.pa-tile.warn { border-color: var(--ent-tone-warning-line); }

.pa-group { padding: var(--ent-s4) 0; border-top: 1px solid var(--ent-border); }
.pa-group:first-of-type { border-top: 0; padding-top: 0; }
.pa-group-head { display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap; }
.pa-group-head h3 { margin: 0; font-size: var(--ent-fs-md, 1rem); }
.pa-count { margin-left: auto; font-size: var(--ent-fs-sm); color: var(--ent-text-muted); }
.pa-why, .pa-ask { margin: var(--ent-s2) 0 0; font-size: var(--ent-fs-sm); max-width: 80ch; }
.pa-items { margin: var(--ent-s3) 0 0; padding-left: var(--ent-s5); font-size: var(--ent-fs-sm); max-width: 90ch; display: flex; flex-direction: column; gap: var(--ent-s1); }

.pa-legend { list-style: none; display: flex; gap: var(--ent-s5); flex-wrap: wrap; margin: 0 0 var(--ent-s3); padding: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-muted); }
.pa-legend li { display: flex; align-items: center; gap: var(--ent-s2); }
.pa-gridwrap { overflow-x: auto; border: 1px solid var(--ent-border); border-radius: var(--ent-r-md); }
.pa-grid { border-collapse: separate; border-spacing: 0; font-size: var(--ent-fs-micro, .8125rem); min-width: 100%; }
.pa-grid th, .pa-grid td { padding: 3px 4px; text-align: center; border-bottom: 1px solid var(--ent-border); white-space: nowrap; }
.pa-grid thead th { position: sticky; top: 0; background: var(--ent-surface); font-family: var(--ent-font-mono, ui-monospace, monospace); font-weight: var(--ent-fw-medium, 500); color: var(--ent-text-muted); }
.pa-grid th.zone { position: sticky; left: 0; z-index: 1; text-align: left; background: var(--ent-surface); padding-inline: var(--ent-s3); min-width: 15rem; font-weight: var(--ent-fw-semibold, 600); white-space: normal; }
.pa-grid th.rv, .pa-grid td.rv { text-align: left; padding-inline: var(--ent-s3); min-width: 9rem; }
.pa-grid tr:last-child th, .pa-grid tr:last-child td { border-bottom: 0; }
.pa-by { display: block; font-size: var(--ent-fs-micro, .8125rem); color: var(--ent-text-muted); }
.flag { display: inline-block; margin-left: var(--ent-s2); font-size: var(--ent-fs-micro, .8125rem); font-weight: normal; padding: 0 var(--ent-s2); border-radius: var(--ent-r-sm, 3px); }
.flag.error { background: var(--ent-tone-negative-bg); color: var(--ent-tone-negative-fg); }
.flag.warning { background: var(--ent-tone-warning-bg); color: var(--ent-tone-warning-fg); }
.flag.review { background: var(--ent-tone-info-bg); color: var(--ent-tone-info-fg); }
.cell { font-family: var(--ent-font-mono, ui-monospace, monospace); font-weight: var(--ent-fw-medium, 500); min-width: 2rem; border-radius: var(--ent-r-sm, 3px); }
.cell.P { background: var(--ent-tone-positive-bg); color: var(--ent-tone-positive-fg); }
.cell.SC { background: var(--ent-tone-warning-bg); color: var(--ent-tone-warning-fg); }
.cell.X { background: var(--ent-tone-negative-bg); color: var(--ent-tone-negative-fg); }
.cell.blank { color: var(--ent-text-muted); }
.pa-legend .cell { display: inline-block; padding: 1px 6px; text-align: center; }
.pa-keyhead { margin: var(--ent-s5) 0 var(--ent-s2); font-size: var(--ent-fs-sm); }
.pa-uses { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--ent-s1) var(--ent-s5); font-size: var(--ent-fs-sm); }
.pa-uses .code { font-family: var(--ent-font-mono, ui-monospace, monospace); font-weight: var(--ent-fw-medium, 500); display: inline-block; min-width: 2.2rem; }
.pa-sign { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--ent-s3); }
.pa-sign div { border: 1px dashed var(--ent-border); border-radius: var(--ent-r-md); padding: var(--ent-s3) var(--ent-s4); min-height: 5.5rem; font-size: var(--ent-fs-sm); color: var(--ent-text-muted); }

@media print {
  .pa-noprint, .pa-back { display: none !important; }
  .pa-root { padding: 0; background: #fff; color: #000; max-width: none; }
  .pa-gridwrap { overflow: visible; }
  .pa-grid th.zone { position: static; min-width: 0; }
  .pa-group { break-inside: avoid; }
}
</style>
