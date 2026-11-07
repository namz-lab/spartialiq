<script setup lang="ts">
// PlanWorkbenchView — onboarding an authority and taking its plan from draft to gazetted.
//
// ONE JOB: take a plan through the steps in order. List the plans, open one, and the page
// shows where it is, what it needs next and what has been done to it.
//
// THE RULES ARE THE DATABASE'S, NOT THIS PAGE'S
// What a sign-off means, which step may follow which, what freezes a plan: all enforced by
// the database (migration 150). This page offers the buttons the server says are allowed and,
// when a rule refuses, shows the server's own sentence. It never decides.
//
// NOTHING IS WRITTEN BY CHECKING. A sheet is checked first (a dry run). "Apply" is offered only
// for the exact text that was just checked and found free of errors.
import { computed, onMounted, ref } from 'vue'
import { RefreshCw, ShieldCheck } from 'lucide-vue-next'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import { useAuthStore } from '@/stores/auth'
import {
  wb, refusalMessage, STATUS_LABEL, STATUS_CHAIN, REVIEW_LABEL,
  type AuditFinding, type AuthorityOption, type ImportResult, type PlanAudit, type PlanDetail, type PlanStatus,
  type ReviewStatus, type WorkbenchPlan, type ZoneColumn,
} from '@/services/planWorkbench'

type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'negative'

const auth = useAuthStore()
const isAdmin = computed(() => auth.user?.role === 'admin')

const plans = ref<WorkbenchPlan[]>([])
const authorities = ref<AuthorityOption[]>([])
const selectedId = ref<string | null>(null)
const detail = ref<PlanDetail | null>(null)
const audit = ref<PlanAudit | null>(null)
const loading = ref(false)
const busy = ref(false)
const notice = ref<{ tone: Tone; text: string } | null>(null)

const columns = [
  { key: 'title', label: 'Plan', sortable: true },
  { key: 'authority_name', label: 'Authority', sortable: true, hideOnMobile: true },
  { key: 'status', label: 'Status', sortable: true, width: '160px' },
  { key: 'version', label: 'Version', width: '80px', hideOnMobile: true },
  { key: 'decisions', label: 'Decisions', width: '100px', hideOnMobile: true },
]

const STATUS_TONE: Record<PlanStatus, Tone> = {
  unknown: 'neutral', draft: 'info', public_notice: 'warning', approved: 'positive', gazetted: 'positive', superseded: 'neutral',
}
const planRows = computed(() => plans.value.map((p) => ({
  ...p,
  authority_name: p.is_template ? 'Template (no authority)' : p.authority_name,
})))

const plan = computed(() => detail.value?.plan ?? null)
const nextStatuses = computed(() => detail.value?.next_statuses ?? [])

function say(tone: Tone, text: string) { notice.value = { tone, text } }
function fail(err: unknown, fallback?: string) { say('negative', refusalMessage(err, fallback)) }

async function loadPlans() {
  loading.value = true
  try {
    plans.value = await wb.listPlans()
    authorities.value = await wb.listAuthorities()
  } catch (err) {
    fail(err, 'The plans could not be loaded.')
  } finally {
    loading.value = false
  }
}

async function open(id: string) {
  selectedId.value = id
  sheetText.value = ''
  checked.value = null
  audit.value = null
  try {
    detail.value = await wb.getPlan(id)
  } catch (err) {
    detail.value = null
    fail(err, 'That plan could not be opened.')
    return
  }
  // The audit only helps the reviewer; the screen works without it.
  try { audit.value = await wb.audit(id) } catch { audit.value = null }
}

async function refresh() {
  await loadPlans()
  if (selectedId.value) await open(selectedId.value)
}

// ── Steps ────────────────────────────────────────────────────────────────
const gazetteRef = ref('')
const effectiveFrom = ref('')
const signComment = ref('')

async function run(action: () => Promise<unknown>, done: string) {
  busy.value = true
  notice.value = null
  try {
    await action()
    say('positive', done)
    await refresh()
  } catch (err) {
    fail(err)
  } finally {
    busy.value = false
  }
}

const signOff = () => run(() => wb.signOff(plan.value!.id, signComment.value || undefined), 'Signed off. The sign-off holds until the plan is next changed.')
const moveTo = (s: PlanStatus) => run(
  () => wb.setStatus(plan.value!.id, s, s === 'gazetted' ? { gazette_ref: gazetteRef.value, effective_from: effectiveFrom.value || undefined } : {}),
  `The plan is now ${STATUS_LABEL[s].toLowerCase()}.`)
const startVersion = () => run(async () => {
  const v = await wb.newVersion(plan.value!.id)
  selectedId.value = v.id
}, 'A new draft version was created. Edit that one; the current version stays as it is.')

const canStartVersion = computed(() => !!plan.value && !plan.value.is_template && ['approved', 'gazetted'].includes(plan.value.status))
const stepIndex = computed(() => (plan.value ? STATUS_CHAIN.indexOf(plan.value.status) : -1))

// ── Importing a sheet ────────────────────────────────────────────────────
const sheetText = ref('')
const checked = ref<{ text: string; result: ImportResult } | null>(null)

async function readFile(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  sheetText.value = await file.text()
  checked.value = null
}

async function checkSheet() {
  if (!plan.value) return
  busy.value = true
  notice.value = null
  try {
    const result = await wb.importSheet(plan.value.id, sheetText.value, false)
    checked.value = { text: sheetText.value, result }
  } catch (err) {
    fail(err)
  } finally {
    busy.value = false
  }
}

// Apply is offered only for the very text that was checked, and only when it had no errors.
const canApply = computed(() => !!checked.value && checked.value.text === sheetText.value
  && checked.value.result.errors.length === 0 && (checked.value.result.summary.inserts + checked.value.result.summary.updates) > 0)

async function applySheet() {
  if (!plan.value || !canApply.value) return
  const n = checked.value!.result.summary.inserts + checked.value!.result.summary.updates
  await run(async () => { await wb.importSheet(plan.value!.id, sheetText.value, true); checked.value = null; sheetText.value = '' },
    `${n} decisions were written to this plan.`)
}

// ── Reviewing zone columns ──────────────────────────────────────────────
// The council's review is recorded per zone column. Reviewing does not make the plan final: the plan stays
// draft rules until it is approved or gazetted (the status steps above).
const reviewer = ref(auth.userName ?? '')
const zoneColumns = computed<ZoneColumn[]>(() => detail.value?.zone_types ?? [])
const reviewedCount = computed(() => zoneColumns.value.filter((z) => z.review_status === 'reviewed').length)
const inForce = computed(() => !!plan.value && ['approved', 'gazetted'].includes(plan.value.status))
const canReview = computed(() => !!plan.value && !plan.value.is_template && !plan.value.frozen && plan.value.status !== 'superseded')
const REVIEW_TONE: Record<ReviewStatus, Tone> = { unreviewed: 'neutral', in_review: 'warning', reviewed: 'positive' }

const findingsFor = (code: string | null): AuditFinding[] => (audit.value?.findings ?? []).filter((f) => f.zone_code === code)
const planWideFindings = computed(() => findingsFor(null))
function findingSummary(list: AuditFinding[]): string {
  const count = (sev: AuditFinding['severity']) => list.filter((f) => f.severity === sev).length
  const parts: string[] = []
  if (count('error')) parts.push(`${count('error')} ${count('error') > 1 ? 'errors' : 'error'}`)
  if (count('warning')) parts.push(`${count('warning')} ${count('warning') > 1 ? 'warnings' : 'warning'}`)
  if (count('review')) parts.push(`${count('review')} to review`)
  return parts.join(', ')
}

const reviewDone: Record<ReviewStatus, (zone: string, by: string) => string> = {
  unreviewed: (zone) => `${zone} was set back to not reviewed.`,
  in_review: (zone) => `${zone} is now in review.`,
  reviewed: (zone, by) => `${zone} was marked reviewed by ${by}. The plan is still draft rules until it is approved or gazetted.`,
}
async function reviewZone(z: ZoneColumn, status: ReviewStatus) {
  const by = reviewer.value.trim()
  if (status === 'reviewed' && !by) { say('warning', 'Enter the name of the person who reviewed this column.'); return }
  await run(() => wb.reviewZone(plan.value!.id, z.code, status, status === 'reviewed' ? by : undefined), reviewDone[status](z.name, by))
}

// ── Giving an authority a plan ───────────────────────────────────────────
const adopt = ref({ authority_id: 0, profile: 'rural' as 'rural' | 'urban', title: '', plan_type: 'local' })
async function createPlan() {
  const a = adopt.value
  if (!a.authority_id || !a.title.trim()) { say('warning', 'Choose an authority and give the plan a title.'); return }
  await run(async () => {
    const r = await wb.adopt({ authority_id: a.authority_id, profile: a.profile, title: a.title.trim(), plan_type: a.plan_type })
    selectedId.value = r.id
    a.title = ''
  }, 'The plan was created as a copy of the template. Fill in its decisions next.')
}

const newAuthority = ref({ code: '', name: '', kind: 'rural' as 'rural' | 'urban' })
async function createAuthority() {
  const a = newAuthority.value
  if (!a.code.trim() || !a.name.trim()) { say('warning', 'An authority needs a short code and a name.'); return }
  await run(async () => {
    await wb.addAuthority({ code: a.code.trim().toUpperCase(), name: a.name.trim(), kind: a.kind })
    a.code = ''; a.name = ''
  }, 'The authority was added.')
}

// ── Reading the history ──────────────────────────────────────────────────
const EVENT_TEXT: Record<string, string> = {
  adopted: 'Created from a template',
  matrix_imported: 'Decisions imported',
  signed_off: 'Signed off',
  status_changed: 'Status changed',
  version_created: 'Created as a new version',
  new_version_started: 'A new version was started',
  zone_review: 'Zone review',
  superseded: 'Replaced by a newer version',
}
function describeEvent(e: { event_type: string; detail: Record<string, unknown> }): string {
  const d = e.detail || {}
  const base = EVENT_TEXT[e.event_type] ?? e.event_type
  if (e.event_type === 'status_changed') return `${base}: ${STATUS_LABEL[d.from as PlanStatus] ?? d.from} to ${STATUS_LABEL[d.to as PlanStatus] ?? d.to}`
  if (e.event_type === 'matrix_imported') return `${base}: ${Number(d.inserts) + Number(d.updates)} written, ${d.unchanged} unchanged`
  if (e.event_type === 'signed_off') return `${base} by ${d.signer}`
  if (e.event_type === 'zone_review') {
    const to = (REVIEW_LABEL[d.to as ReviewStatus] ?? String(d.to)).toLowerCase()
    return `${base}: ${d.zone_type} is now ${to}${d.to === 'reviewed' && d.reviewer ? ` (${d.reviewer})` : ''}`
  }
  if (e.event_type === 'superseded') return `${base} (${d.polygons_moved} zone polygons moved)`
  return base
}
const when = (iso: string) => new Date(iso).toLocaleString()

onMounted(loadPlans)
</script>

<template>
  <div class="wb-root">
    <header class="wb-head">
      <div>
        <h1 class="wb-title">Plan workbench</h1>
        <p class="wb-sub">
          Take an authority's plan from a copy of a template to a gazetted plan, one step at a time.
          Each step is recorded with who took it. Anything the system refuses is explained here in the
          system's own words.
        </p>
      </div>
      <UiButton :disabled="loading || busy" @click="refresh">
        <template #icon><RefreshCw :size="16" /></template>
        Refresh
      </UiButton>
    </header>

    <div v-if="notice" class="wb-notice" :class="`t-${notice.tone}`" role="status">{{ notice.text }}</div>

    <UiPanel title="Plans" subtitle="Templates and each authority's own plans" flush>
      <UiDataTable
        :columns="columns" :rows="planRows" row-key="id" clickable :loading="loading"
        mobile-primary="title" mobile-status="status" :mobile-meta="['authority_name', 'version']"
        empty-message="No plans yet."
        @row-click="(r: WorkbenchPlan) => open(r.id)"
      >
        <template #cell-status="{ row }">
          <UiStatusBadge :tone="STATUS_TONE[row.status as PlanStatus]" :label="STATUS_LABEL[row.status as PlanStatus]" />
        </template>
        <template #cell-title="{ row }">
          <span :class="{ picked: row.id === selectedId }">{{ row.title }}</span>
        </template>
      </UiDataTable>
    </UiPanel>

    <template v-if="plan">
      <UiPanel :title="plan.title" :subtitle="plan.is_template ? 'A template: copy it for an authority, it has no status of its own' : `Version ${plan.version} · ${plan.authority_name}`">
        <dl class="wb-facts">
          <div><dt>Zone types</dt><dd>{{ plan.zone_types }}</dd></div>
          <div><dt>Land uses</dt><dd>{{ plan.land_uses }}</dd></div>
          <div><dt>Decisions</dt><dd>{{ plan.decisions }}</dd></div>
          <div v-if="plan.gazette_ref"><dt>Gazette reference</dt><dd class="mono">{{ plan.gazette_ref }}</dd></div>
          <div v-if="plan.effective_from"><dt>Effective from</dt><dd class="mono">{{ plan.effective_from.slice(0, 10) }}</dd></div>
        </dl>

        <p class="wb-aside">
          <a class="wb-link" :href="`/admin/plan-audit/${plan.id}`" @click.prevent="$router.push(`/admin/plan-audit/${plan.id}`)">
            Open the audit view
          </a>
          to read the whole matrix and what is still to be settled, or to print it for a meeting.
        </p>

        <template v-if="!plan.is_template">
          <ol class="wb-chain" aria-label="Where the plan is in its steps">
            <li v-for="(s, i) in STATUS_CHAIN" :key="s" :class="{ done: i < stepIndex, now: i === stepIndex }">
              {{ STATUS_LABEL[s] }}
            </li>
          </ol>
          <p v-if="plan.status === 'unknown'" class="wb-aside">
            This plan's status has not been confirmed. Moving it to draft starts its record.
          </p>
          <p v-if="plan.status === 'superseded'" class="wb-aside">A newer version has replaced this plan. It is kept as it was.</p>
          <p v-if="plan.frozen" class="wb-aside">
            This plan's land uses, decisions and standards are fixed. A change needs a new version.
          </p>
        </template>
      </UiPanel>

      <UiPanel v-if="!plan.is_template && plan.status !== 'superseded'" title="Next step" subtitle="What this plan needs, and what the system will accept">
        <div class="wb-signoff">
          <UiStatusBadge
            :tone="plan.signoff_current ? 'positive' : 'warning'"
            :label="plan.signoff_current ? 'Signed off and unchanged since' : (plan.last_signoff ? 'Changed since it was signed off' : 'Not signed off')" />
          <span v-if="plan.last_signoff" class="dim">
            Last signed by {{ plan.last_signoff.signer_name }}, {{ when(plan.last_signoff.signed_at) }}
          </span>
        </div>

        <div v-if="!plan.frozen" class="wb-row">
          <input v-model="signComment" class="wb-input" type="text" placeholder="Comment for the sign-off (optional)" aria-label="Sign-off comment" />
          <UiButton :disabled="busy" @click="signOff">
            <template #icon><ShieldCheck :size="16" /></template>
            Sign off this plan
          </UiButton>
        </div>
        <p v-if="!plan.frozen" class="wb-aside">
          Signing says the planner has checked the decisions as they stand. Any later edit makes the
          sign-off stale, and approval needs a current one.
        </p>

        <div v-if="nextStatuses.includes('gazetted')" class="wb-row">
          <input v-model="gazetteRef" class="wb-input" type="text" placeholder="Gazette reference" aria-label="Gazette reference" />
          <input v-model="effectiveFrom" class="wb-input" type="date" aria-label="Effective from" />
        </div>

        <div class="wb-row">
          <UiButton
            v-for="s in nextStatuses" :key="s" variant="primary" :disabled="busy"
            @click="moveTo(s)">
            {{ s === 'draft' ? 'Return to draft' : `Move to ${STATUS_LABEL[s].toLowerCase()}` }}
          </UiButton>
          <UiButton v-if="canStartVersion" :disabled="busy" @click="startVersion">Start a new version</UiButton>
        </div>
        <p v-if="!nextStatuses.length && !canStartVersion" class="wb-aside">There is no next step for this plan.</p>
      </UiPanel>

      <UiPanel
        v-if="!plan.is_template && zoneColumns.length"
        title="Review by zone"
        subtitle="Record where each zone's decisions stand in the council's review">
        <p class="wb-aside first" data-testid="review-summary">
          <strong>{{ reviewedCount }} of {{ zoneColumns.length }}</strong> zone columns reviewed.
          <template v-if="!inForce">
            Reviewing a column does not make the plan final. Until the plan is approved or gazetted, everything it decides is
            shown to officers as draft rules, not council policy.
          </template>
        </p>
        <div v-if="canReview" class="wb-row">
          <label class="wb-reviewer">Reviewed by
            <input v-model="reviewer" class="wb-input" type="text" maxlength="200" placeholder="Name of the reviewer" aria-label="Name of the reviewer" />
          </label>
        </div>
        <div class="wb-tablewrap">
          <table class="wb-zones">
            <thead>
              <tr>
                <th scope="col">Zone</th><th scope="col">Decisions</th><th scope="col">Audit</th><th scope="col">Review</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="z in zoneColumns" :key="z.code" :data-zone="z.code">
                <th scope="row">
                  {{ z.name }}
                  <span v-if="z.category" class="dim wb-cat">{{ z.category.replace('_', ' ') }}</span>
                </th>
                <td class="mono">{{ z.permitted }} P · {{ z.special_consent }} SC · {{ z.prohibited }} X</td>
                <td>
                  <details v-if="findingsFor(z.code).length" class="wb-findings">
                    <summary>{{ findingSummary(findingsFor(z.code)) }}</summary>
                    <ul>
                      <li v-for="(f, i) in findingsFor(z.code)" :key="i" :class="`sev-${f.severity}`">{{ f.detail }}</li>
                    </ul>
                  </details>
                  <span v-else-if="audit" class="dim">Nothing to settle</span>
                  <span v-else class="dim">Not checked</span>
                </td>
                <td>
                  <UiStatusBadge :tone="REVIEW_TONE[z.review_status]" :label="REVIEW_LABEL[z.review_status]" />
                  <span v-if="z.review_status === 'reviewed' && z.reviewed_by" class="dim wb-by">
                    {{ z.reviewed_by }}<template v-if="z.reviewed_at">, {{ z.reviewed_at.slice(0, 10) }}</template>
                  </span>
                </td>
                <td>
                  <div v-if="canReview" class="wb-actions">
                    <UiButton v-if="z.review_status === 'unreviewed'" size="sm" :disabled="busy" @click="reviewZone(z, 'in_review')">
                      Start review<span class="sr-only"> of {{ z.name }}</span>
                    </UiButton>
                    <UiButton v-if="z.review_status !== 'reviewed'" size="sm" variant="primary" :disabled="busy" @click="reviewZone(z, 'reviewed')">
                      Mark reviewed<span class="sr-only"> for {{ z.name }}</span>
                    </UiButton>
                    <UiButton v-if="z.review_status === 'reviewed'" size="sm" :disabled="busy" @click="reviewZone(z, 'in_review')">
                      Reopen<span class="sr-only"> review of {{ z.name }}</span>
                    </UiButton>
                    <UiButton v-if="z.review_status === 'in_review'" size="sm" :disabled="busy" @click="reviewZone(z, 'unreviewed')">
                      Set aside<span class="sr-only"> review of {{ z.name }}</span>
                    </UiButton>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="planWideFindings.length" class="wb-planwide">
          <p class="wb-aside first"><strong>Points that concern the whole plan</strong></p>
          <ul>
            <li v-for="(f, i) in planWideFindings" :key="i" :class="`sev-${f.severity}`">{{ f.detail }}</li>
          </ul>
        </div>
        <p v-if="!canReview" class="wb-aside">This plan's decisions are fixed, so its review state can no longer change.</p>
        <p v-else class="wb-aside">If a decision in a reviewed column is edited afterwards, the column goes back into review.</p>
      </UiPanel>

      <UiPanel v-if="!plan.is_template && !plan.frozen && plan.status !== 'superseded'" title="Decisions" subtitle="Load what is permitted, needs special consent or is prohibited">
        <p class="wb-aside first">
          Use the sheet for this plan (from the command <span class="mono">load-zoning-matrix.js --template</span>).
          Check it first. Nothing is written until you apply a sheet that checked clean. A blank cell stays
          "not decided".
        </p>
        <div class="wb-row">
          <input type="file" accept=".csv,text/csv" aria-label="Choose a sheet" @change="readFile" />
        </div>
        <textarea v-model="sheetText" class="wb-sheet" rows="5" aria-label="Sheet contents" placeholder="Or paste the sheet here" @input="checked = null" />
        <div class="wb-row">
          <UiButton :disabled="busy || !sheetText.trim()" @click="checkSheet">Check the sheet</UiButton>
          <UiButton variant="primary" :disabled="busy || !canApply" @click="applySheet">Apply to this plan</UiButton>
        </div>

        <div v-if="checked" class="wb-result" aria-live="polite">
          <p class="wb-result-line">
            <strong>{{ checked.result.summary.inserts + checked.result.summary.updates }}</strong> decisions would be written
            ({{ checked.result.summary.inserts }} new, {{ checked.result.summary.updates }} changed),
            {{ checked.result.summary.unchanged }} already match,
            {{ checked.result.summary.undecided }} left undecided.
          </p>
          <ul v-if="checked.result.errors.length" class="wb-errors">
            <li v-for="e in checked.result.errors.slice(0, 15)" :key="e">{{ e }}</li>
            <li v-if="checked.result.errors.length > 15">…and {{ checked.result.errors.length - 15 }} more.</li>
          </ul>
          <p v-else-if="canApply" class="wb-aside first">The sheet is free of errors. You can apply it.</p>
          <p v-else class="wb-aside first">There is nothing to write: every decision in the sheet is already in the plan, or is blank.</p>
        </div>
      </UiPanel>

      <UiPanel title="History" subtitle="Everything done to this plan, newest first">
        <ul v-if="detail?.events.length" class="wb-history">
          <li v-for="(e, i) in detail.events" :key="i">
            <span class="dim mono">{{ when(e.at) }}</span>
            <span>{{ describeEvent(e) }}</span>
            <span class="dim">{{ e.actor_email ?? e.actor_role ?? 'system' }}</span>
          </li>
        </ul>
        <p v-else class="wb-aside first">Nothing has been recorded for this plan yet.</p>
      </UiPanel>
    </template>

    <UiPanel title="Give an authority its own plan" subtitle="A copy of a template: edit the copy, the template stays as it is">
      <div class="wb-form">
        <label>Authority
          <select v-model.number="adopt.authority_id" class="wb-input">
            <option :value="0" disabled>Choose…</option>
            <option v-for="a in authorities" :key="a.id" :value="a.id">{{ a.name }} ({{ a.kind }})</option>
          </select>
        </label>
        <label>Start from
          <select v-model="adopt.profile" class="wb-input">
            <option value="rural">The rural template (with the sample's decisions)</option>
            <option value="urban">The urban starter palette (no decisions)</option>
          </select>
        </label>
        <label>Type
          <select v-model="adopt.plan_type" class="wb-input">
            <option value="district_master">District master plan</option>
            <option value="local">Local plan</option>
            <option value="layout">Layout plan</option>
            <option value="scheme">Scheme</option>
          </select>
        </label>
        <label class="grow">Title
          <input v-model="adopt.title" class="wb-input" type="text" maxlength="255" placeholder="e.g. Chipinge RDC district master plan" />
        </label>
        <UiButton variant="primary" :disabled="busy" @click="createPlan">Create the plan</UiButton>
      </div>
    </UiPanel>

    <UiPanel v-if="isAdmin" title="Add an authority" subtitle="IT administrator only">
      <div class="wb-form">
        <label>Code
          <input v-model="newAuthority.code" class="wb-input" type="text" maxlength="30" placeholder="CHIPINGE" />
        </label>
        <label class="grow">Name
          <input v-model="newAuthority.name" class="wb-input" type="text" maxlength="255" placeholder="Chipinge Rural District Council" />
        </label>
        <label>Kind
          <select v-model="newAuthority.kind" class="wb-input">
            <option value="rural">Rural</option>
            <option value="urban">Urban</option>
          </select>
        </label>
        <UiButton :disabled="busy" @click="createAuthority">Add the authority</UiButton>
      </div>
      <p class="wb-aside">A combination authority is added by the command line for now, because it needs its member authorities.</p>
    </UiPanel>
  </div>
</template>

<style scoped>
.wb-root {
  display: flex; flex-direction: column; gap: var(--ent-s5);
  padding: var(--ent-s6); max-width: 1100px; margin: 0 auto;
  background: var(--ent-canvas); color: var(--ent-text);
  font-family: var(--ent-font-sans, system-ui, sans-serif);
  min-height: var(--ent-vh);
}
@media (max-width: 768px) { .wb-root { padding: var(--ent-s4); gap: var(--ent-s4); } }

.wb-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--ent-s4); flex-wrap: wrap; }
.wb-title { margin: 0; font-size: var(--ent-fs-h2, 1.5rem); line-height: 1.2; }
.wb-sub { margin: var(--ent-s2) 0 0; color: var(--ent-text-muted); font-size: var(--ent-fs-sm); max-width: 64ch; }
.mono { font-family: var(--ent-font-mono, ui-monospace, monospace); font-size: var(--ent-fs-micro, .8125rem); }
.dim { color: var(--ent-text-muted); font-size: var(--ent-fs-sm); }
.picked { font-weight: var(--ent-fw-semibold, 600); }

.wb-notice {
  padding: var(--ent-s3); border-radius: var(--ent-r-md); font-size: var(--ent-fs-sm);
  border: 1px solid var(--ent-tone-info-line); background: var(--ent-tone-info-bg); color: var(--ent-tone-info-fg);
}
.wb-notice.t-positive { border-color: var(--ent-tone-positive-line); background: var(--ent-tone-positive-bg); color: var(--ent-tone-positive-fg); }
.wb-notice.t-warning { border-color: var(--ent-tone-warning-line); background: var(--ent-tone-warning-bg); color: var(--ent-tone-warning-fg); }
.wb-notice.t-negative { border-color: var(--ent-tone-negative-line); background: var(--ent-tone-negative-bg); color: var(--ent-tone-negative-fg); }

.wb-facts { display: flex; flex-wrap: wrap; gap: var(--ent-s6); margin: 0; }
.wb-facts dt { font-size: var(--ent-fs-micro, .8125rem); color: var(--ent-text-muted); text-transform: uppercase; letter-spacing: .04em; }
.wb-facts dd { margin: var(--ent-s1) 0 0; font-size: var(--ent-fs-lg, 1.125rem); font-weight: var(--ent-fw-semibold, 600); }

.wb-chain { list-style: none; display: flex; flex-wrap: wrap; gap: var(--ent-s2); margin: var(--ent-s4) 0 0; padding: 0; }
.wb-chain li {
  padding: var(--ent-s1) var(--ent-s3); border: 1px solid var(--ent-border); border-radius: var(--ent-r-md);
  font-size: var(--ent-fs-sm); color: var(--ent-text-muted);
}
.wb-chain li.done { color: var(--ent-text); border-color: var(--ent-tone-positive-line); }
.wb-chain li.now { color: var(--ent-text); font-weight: var(--ent-fw-semibold, 600); border-color: var(--ent-text); }

.wb-aside { margin: var(--ent-s3) 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-muted); max-width: 80ch; }
.wb-aside.first { margin-top: 0; }
.wb-signoff { display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap; margin-bottom: var(--ent-s3); }
.wb-row { display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap; margin-top: var(--ent-s3); }
.wb-input {
  padding: var(--ent-s2) var(--ent-s3); min-width: 0; flex: 1 1 220px;
  border: 1px solid var(--ent-border); border-radius: var(--ent-r-md);
  background: var(--ent-surface); color: var(--ent-text); font: inherit; font-size: var(--ent-fs-sm);
}
.wb-sheet {
  width: 100%; margin-top: var(--ent-s3); box-sizing: border-box; resize: vertical;
  padding: var(--ent-s3); border: 1px solid var(--ent-border); border-radius: var(--ent-r-md);
  background: var(--ent-surface); color: var(--ent-text);
  font-family: var(--ent-font-mono, ui-monospace, monospace); font-size: var(--ent-fs-micro, .8125rem);
}
.wb-result { margin-top: var(--ent-s4); padding-top: var(--ent-s3); border-top: 1px solid var(--ent-border); }
.wb-result-line { margin: 0; font-size: var(--ent-fs-sm); }
.wb-errors { margin: var(--ent-s3) 0 0; padding-left: var(--ent-s5); color: var(--ent-tone-negative-fg); font-size: var(--ent-fs-sm); }
.wb-history { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ent-s2); }
.wb-history li {
  display: grid; grid-template-columns: 11rem 1fr auto; gap: var(--ent-s3); align-items: baseline;
  padding: var(--ent-s2) 0; border-top: 1px solid var(--ent-border); font-size: var(--ent-fs-sm);
}
.wb-history li:first-child { border-top: 0; }
@media (max-width: 640px) { .wb-history li { grid-template-columns: 1fr; gap: var(--ent-s1); } }

.wb-link { color: var(--ent-accent, inherit); font-weight: var(--ent-fw-medium, 500); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.wb-reviewer { display: flex; flex-direction: column; gap: var(--ent-s1); font-size: var(--ent-fs-sm); color: var(--ent-text-muted); flex: 1 1 280px; }
.wb-reviewer .wb-input { flex: 0 0 auto; }
.wb-tablewrap { overflow-x: auto; margin-top: var(--ent-s3); border: 1px solid var(--ent-border); border-radius: var(--ent-r-md); }
.wb-zones { width: 100%; border-collapse: collapse; font-size: var(--ent-fs-sm); }
.wb-zones th, .wb-zones td { text-align: left; padding: var(--ent-s2) var(--ent-s3); border-top: 1px solid var(--ent-border); vertical-align: top; }
.wb-zones thead th { border-top: 0; font-size: var(--ent-fs-micro, .8125rem); color: var(--ent-text-muted); text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
.wb-zones tbody th { font-weight: var(--ent-fw-semibold, 600); min-width: 12rem; }
.wb-cat { display: block; font-weight: normal; text-transform: capitalize; }
.wb-by { display: block; }
.wb-actions { display: flex; gap: var(--ent-s2); flex-wrap: wrap; }
.wb-findings summary { cursor: pointer; }
.wb-findings ul, .wb-planwide ul { margin: var(--ent-s2) 0 0; padding-left: var(--ent-s5); max-width: 60ch; font-size: var(--ent-fs-sm); }
.wb-planwide { margin-top: var(--ent-s4); }
.sev-error { color: var(--ent-tone-negative-fg); }
.sev-warning { color: var(--ent-tone-warning-fg); }

.wb-form { display: flex; align-items: flex-end; gap: var(--ent-s3); flex-wrap: wrap; }
.wb-form label { display: flex; flex-direction: column; gap: var(--ent-s1); font-size: var(--ent-fs-sm); color: var(--ent-text-muted); }
.wb-form label.grow { flex: 1 1 260px; }
</style>
