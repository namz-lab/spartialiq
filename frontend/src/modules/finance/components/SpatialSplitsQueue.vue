<script setup lang="ts">
/**
 * The ward-split register across every subject — the decision queue for GAP-2.
 *
 * WHY A SECOND VIEW OF THE SAME ROWS
 * `SpatialAllocationPanel` answers "how is THIS line's money divided", which is what a preparer
 * needs. An approver has the opposite question: "what is waiting on me". Without this list a draft
 * split was only reachable by guessing which budget line or project carried it, so a split could sit
 * indefinitely with nobody informed — the same failure the work-queue composable exists to end. The
 * counts come from `useFinanceQueues`; this is where the work is done.
 *
 * WHAT IT REFUSES
 * It does not offer a decision the server would refuse. A draft the viewer recorded shows the
 * "awaiting another approver" sentence instead of buttons, which is the `RevisionsSection` pattern
 * verbatim: the honest statement is that the work exists and is not theirs to finish. The
 * per-subject-kind permission is re-checked by the route, and this screen mirrors it.
 *
 * It computes nothing. Amounts are the recorded decimal strings; no total is formed over them,
 * because the cap is SQL's and a client-side sum could disagree with it.
 */
import { computed, onMounted, ref } from 'vue'
import {
  AlertTriangle, Check, CheckCircle2, Layers, RefreshCw, ShieldAlert, X,
} from 'lucide-vue-next'
import { financeApi } from '../api/financeApi'
import type { SpatialAllocation, SpatialAllocationStatus } from '../api/financeApi'
import { useFinanceStore, messageOf } from '../stores/finance'
import { formatDateTime, formatMoney } from '../composables/useMoney'
import { useFinancePrompt } from '../composables/useFinancePrompt'
import FinancePromptDialog from './FinancePromptDialog.vue'
import { ALLOCATION_STATUS_LABELS, allocationStatusTone } from '../composables/useSpatialAllocation'

const props = withDefaults(defineProps<{
  /** Which states to list. 'draft' is the decision queue; '' lists the whole register. */
  status?: SpatialAllocationStatus | ''
}>(), { status: 'draft' })

const emit = defineEmits<{
  changed: []
  /** Open the subject's own panel, where the split sits beside the money it divides. */
  'open-subject': [{ kind: 'budget_line' | 'project'; id: string; label: string }]
}>()

const store = useFinanceStore()
const prompt = useFinancePrompt()

const allocations = ref<SpatialAllocation[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref<string | null>(null)
const filter = ref<SpatialAllocationStatus | ''>(props.status)
/** Subject id → what to call it. Resolved from the registers that already serve these lists. */
const labels = ref<Map<string, string>>(new Map())

const me = computed(() => store.identity?.user_id ?? null)
const isOwn = (a: SpatialAllocation) => me.value !== null && a.requested_by === me.value
const mayDecideKind = (a: SpatialAllocation) =>
  store.can(a.subject_kind === 'budget_line' ? 'finance.budget.approve' : 'finance.project.approve')
const canDecide = (a: SpatialAllocation) =>
  a.status === 'draft' && mayDecideKind(a) && !isOwn(a)
const canWithdraw = (a: SpatialAllocation) =>
  (a.status === 'draft' && isOwn(a)) || (a.status === 'approved' && mayDecideKind(a))

/** Drafts the viewer recorded: listed apart, with the reason they are not theirs to decide. */
const mine = computed(() =>
  allocations.value.filter((a) => a.status === 'draft' && isOwn(a) && mayDecideKind(a)))
const others = computed(() => allocations.value.filter((a) => !mine.value.includes(a)))

function label(a: SpatialAllocation): string {
  return labels.value.get(a.subject_id)
    ?? `${a.subject_kind === 'budget_line' ? 'Budget line' : 'Project'} ${a.subject_id.slice(0, 8)}`
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const page = await financeApi.spatialAllocations({
      status: filter.value || undefined, limit: 200,
    })
    allocations.value = page.allocations
    await resolveLabels()
  } catch (err) {
    error.value = messageOf(err, 'The ward splits could not be read.')
  } finally {
    loading.value = false
  }
}

/**
 * Name the subjects from the registers that already list them.
 *
 * The allocation row carries only `subject_kind` and `subject_id`, and an approver cannot decide a
 * split of "budget line 3f1c9a2e". Both reads are best-effort: a permission the viewer lacks costs
 * the label, not the queue.
 */
async function resolveLabels(): Promise<void> {
  const map = new Map(labels.value)
  const year = store.selectedYearId
  const wantsLines = allocations.value.some((a) => a.subject_kind === 'budget_line')
  const wantsProjects = allocations.value.some((a) => a.subject_kind === 'project')
  const reads = await Promise.allSettled([
    wantsLines && year && store.can('finance.budget.view')
      ? financeApi.budgetLines({ financial_year_id: year, limit: 500 })
      : null,
    wantsProjects && store.can('finance.project.view')
      ? financeApi.projects({ limit: 500 })
      : null,
  ])
  if (reads[0].status === 'fulfilled' && reads[0].value) {
    for (const line of reads[0].value.lines) {
      map.set(line.budget_line_id, `Budget line ${line.code} — ${line.description}`)
    }
  }
  if (reads[1].status === 'fulfilled' && reads[1].value) {
    for (const project of reads[1].value) {
      map.set(project.project_id, `Project ${project.reference} — ${project.name}`)
    }
  }
  labels.value = map
}

onMounted(load)

async function decide(a: SpatialAllocation, action: 'approve' | 'reject'): Promise<void> {
  error.value = null
  note.value = null
  if (action === 'approve') {
    const decision = await prompt.ask({
      title: 'Approve this ward split',
      message: `${formatMoney(a.amount, a.currency)} will be attributed to ward ${a.target_code} on `
        + `${label(a)}. The methodology is kept with the decision; the amount is capped against the `
        + 'subject\'s own total and an overrun is refused.',
      label: 'A note for the record (optional)',
      kind: 'textarea',
      submitLabel: 'Approve',
    })
    if (decision === null) return
    busy.value = a.id
    try {
      await financeApi.approveSpatialAllocation(a.id, decision || undefined)
      note.value = `The split to ward ${a.target_code} is approved and now attributes that figure.`
      await load()
      emit('changed')
    } catch (err) {
      error.value = messageOf(err, 'That split could not be approved.')
    } finally {
      busy.value = null
    }
    return
  }
  const reason = await prompt.ask({
    title: 'Refuse this ward split',
    message: 'The refusal and its reason stay on the register beside the request.',
    label: 'Why is this split refused?',
    kind: 'textarea',
    minLength: 3,
    submitLabel: 'Refuse it',
    danger: true,
  })
  if (!reason) return
  busy.value = a.id
  try {
    await financeApi.rejectSpatialAllocation(a.id, reason)
    note.value = `The split to ward ${a.target_code} is refused and stays on the register.`
    await load()
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, 'That split could not be refused.')
  } finally {
    busy.value = null
  }
}

async function withdraw(a: SpatialAllocation): Promise<void> {
  error.value = null
  note.value = null
  const reason = await prompt.ask({
    title: a.status === 'approved' ? 'Withdraw an approved split' : 'Withdraw this draft',
    message: a.status === 'approved'
      ? 'The split stops attributing money to that ward. Its record, methodology and approver stay '
        + 'on the register — this is a revocation, not a deletion.'
      : 'The draft will be withdrawn; it never attributed any figure.',
    label: 'Why is it withdrawn? (optional)',
    kind: 'textarea',
    submitLabel: 'Withdraw',
    danger: true,
  })
  if (reason === null) return
  busy.value = a.id
  try {
    await financeApi.withdrawSpatialAllocation(a.id, reason || undefined)
    note.value = `The split to ward ${a.target_code} is withdrawn.`
    await load()
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, 'That split could not be withdrawn.')
  } finally {
    busy.value = null
  }
}

function targetStatusLabel(a: SpatialAllocation): string {
  if (a.target_status === 'unlinked') return 'code not linked to this council'
  if (a.target_status === 'ward_register_empty') return 'ward register not linked (D11)'
  if (a.target_status === 'linked') return 'linked ward'
  return 'ward register status not reported'
}
</script>

<template>
  <div class="ssq">
    <FinancePromptDialog :controller="prompt" />
    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="15" aria-hidden="true" /><span>{{ error }}</span>
    </div>
    <p v-if="note" class="ins-banner t-positive" role="status">
      <CheckCircle2 :size="15" aria-hidden="true" /><span>{{ note }}</span>
    </p>

    <div class="ssq-bar">
      <label>
        <span class="ins-label">Show</span>
        <select v-model="filter" class="ins-input" @change="load">
          <option value="draft">Awaiting a decision</option>
          <option value="approved">Approved splits</option>
          <option value="rejected">Refused</option>
          <option value="withdrawn">Withdrawn</option>
          <option value="">The whole register</option>
        </select>
      </label>
      <button type="button" class="fin-btn small" :disabled="loading" @click="load">
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
      </button>
    </div>

    <p v-if="mine.length" class="ins-banner t-warning" role="status">
      <ShieldAlert :size="15" aria-hidden="true" />
      <span>
        {{ mine.length }} of these {{ mine.length === 1 ? 'is' : 'are' }} your own draft and
        {{ mine.length === 1 ? 'is' : 'are' }} awaiting another approver. You hold the deciding
        permission but may not decide a split you recorded — the route refuses it
        (<code>self_approval</code>).
      </span>
    </p>

    <p v-if="loading && allocations.length === 0" class="ins-hint" role="status">Loading splits…</p>

    <p v-else-if="allocations.length === 0" class="ins-hint">
      <template v-if="filter === 'draft'">
        No ward split is waiting on a decision. A split is how a budget line or project that serves
        several wards is attributed; until one is recorded, the whole amount belongs to the subject's
        own ward code, or to none.
      </template>
      <template v-else>Nothing on the register in that state.</template>
    </p>

    <ul v-else class="ssq-list">
      <li v-for="a in others.concat(mine)" :key="a.id" class="ssq-row">
        <div class="ssq-row-head">
          <strong>Ward {{ a.target_code }}</strong>
          <span class="fin-pill" :class="allocationStatusTone(a.status)">
            {{ ALLOCATION_STATUS_LABELS[a.status] }}
          </span>
          <span class="ssq-amount">{{ formatMoney(a.amount, a.currency) }}</span>
        </div>
        <p class="ssq-subject">
          <button type="button" class="ssq-link"
                  @click="emit('open-subject', { kind: a.subject_kind, id: a.subject_id, label: label(a) })">
            <Layers :size="12" aria-hidden="true" /> {{ label(a) }}
          </button>
        </p>
        <p class="ins-hint">{{ a.methodology }}</p>
        <p class="ins-hint ssq-meta">
          {{ targetStatusLabel(a) }} · recorded {{ formatDateTime(a.requested_at) }}
          <template v-if="a.decided_at"> · decided {{ formatDateTime(a.decided_at) }}</template>
        </p>
        <p v-if="a.decision_note" class="ssq-note">Decision note: {{ a.decision_note }}</p>

        <div class="ssq-actions">
          <template v-if="a.status === 'draft' && isOwn(a)">
            <span class="ins-hint">
              <ShieldAlert :size="12" aria-hidden="true" />
              You recorded this draft. Another officer must decide it.
            </span>
          </template>
          <template v-else-if="canDecide(a)">
            <button type="button" class="fin-btn small" :disabled="busy === a.id"
                    @click="decide(a, 'approve')">
              <Check :size="13" aria-hidden="true" /> Approve
            </button>
            <button type="button" class="fin-btn small" :disabled="busy === a.id"
                    @click="decide(a, 'reject')">
              <X :size="13" aria-hidden="true" /> Refuse
            </button>
          </template>
          <span v-else-if="a.status === 'draft'" class="ins-hint">
            {{ store.whyUnavailable(a.subject_kind === 'budget_line'
              ? 'finance.budget.approve' : 'finance.project.approve') }}
          </span>
          <button v-if="canWithdraw(a)" type="button" class="fin-btn small"
                  :disabled="busy === a.id" @click="withdraw(a)">
            Withdraw
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ssq { display: flex; flex-direction: column; gap: 10px; }
.ssq-bar { display: flex; align-items: end; gap: 10px; }
.ssq-bar label { display: inline-flex; flex-direction: column; gap: 2px; }
.ssq-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ssq-row {
  padding: 9px 10px; border: 1px solid var(--ent-line, #d7dde5); border-radius: 7px;
  background: var(--ent-surface, #fff);
}
.ssq-row-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ssq-amount {
  margin-left: auto; font-family: var(--ent-font-mono, monospace);
  font-variant-numeric: tabular-nums;
}
.ssq-row p { margin: 4px 0 0; }
.ssq-subject { font-size: 12.5px; }
.ssq-link {
  border: 0; background: none; padding: 0; font: inherit; color: var(--ent-accent);
  text-decoration: underline; text-underline-offset: 2px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
}
.ssq-link:focus-visible { outline: var(--ent-focus-ring); outline-offset: 2px; }
.ssq-meta { font-size: 11.5px; }
.ssq-note { font-size: 12px; color: var(--ent-text-2, #334155); }
.ssq-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.ssq-actions .ins-hint { display: inline-flex; align-items: center; gap: 4px; }
</style>
