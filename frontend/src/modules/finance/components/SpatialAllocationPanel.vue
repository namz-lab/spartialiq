<script setup lang="ts">
/**
 * The spatial-allocation register (audit M5-7).
 *
 * WHY THIS IS A REGISTER AND NOT A FORM
 * Whether a budget line's money belongs to one ward or five is a RECORDED, methodology-backed,
 * approved act. The ward choropleth attributes only APPROVED splits; a draft moves no figure. So
 * this panel lists every attempt — draft, approved, refused, withdrawn — rather than hiding the
 * ones that did not succeed.
 *
 * WHAT IT WILL NOT DO
 * - It offers no "divide equally" control. Equal division is not a neutral default; it is an
 *   assertion about where money was spent, and the Council has to record its basis.
 * - It does not decide who may approve. The server enforces SoD (`self_approval`) and the
 *   allocation cap; the screen merely does not offer a decision the server would refuse.
 * - It does not sum allocations or compare them to the subject total in the client. The figures it
 *   shows are the recorded rows; the roll-up is SQL's job.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { AlertTriangle, Check, CheckCircle2, Info, Plus, RefreshCw, ShieldAlert, X } from 'lucide-vue-next'
import { financeApi } from '../api/financeApi'
import type { SpatialAllocation } from '../api/financeApi'
import { useFinanceStore, messageOf } from '../stores/finance'
import { formatDateTime, formatMoney } from '../composables/useMoney'
import { useFinancePrompt } from '../composables/useFinancePrompt'
import {
  ALLOCATION_STATUS_LABELS, allocationStatusTone, isValidDraft, validateAllocationDraft,
} from '../composables/useSpatialAllocation'
import type { Currency } from '../models/types'
import FinancePromptDialog from './FinancePromptDialog.vue'
import WardPicker from './WardPicker.vue'

const props = withDefaults(defineProps<{
  subjectKind: 'budget_line' | 'project'
  subjectId: string
  subjectLabel: string
  currency: Currency
  /**
   * The cap the approved splits are measured against, EXACTLY as the view serves it (a decimal
   * string): a budget line's revised amount, a project's allocated total. It is displayed, never
   * used in arithmetic — §6.1 rule 2 keeps every sum in SQL, and the server refuses an overrun with
   * the figures that made it refuse.
   */
  subjectCap?: string | null
  subjectCapLabel?: string
}>(), {
  subjectCap: null,
  subjectCapLabel: 'revised total',
})

const emit = defineEmits<{ changed: [] }>()

const store = useFinanceStore()
const prompt = useFinancePrompt()

const allocations = ref<SpatialAllocation[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref<string | null>(null)
const attempted = ref(false)

const form = ref({ targetCode: '', amount: '', methodology: '' })
const errors = computed(() => validateAllocationDraft(form.value))

const prepareCode = computed(() =>
  props.subjectKind === 'budget_line' ? 'finance.budget.prepare' : 'finance.project.manage')
const approveCode = computed(() =>
  props.subjectKind === 'budget_line' ? 'finance.budget.approve' : 'finance.project.approve')
const canPrepare = computed(() => store.can(prepareCode.value))
const canApprove = computed(() => store.can(approveCode.value))
// A project split is not tied to a reporting period; a budget-line split is, and the server
// refuses one in a closed year. The button is disabled rather than letting the request fail.
const writesAllowed = computed(() =>
  props.subjectKind === 'project' || store.selectedYearAcceptsWrites)
const me = computed(() => store.identity?.user_id ?? null)
const isOwn = (a: SpatialAllocation): boolean => me.value !== null && a.requested_by === me.value
const canRecord = computed(() =>
  canPrepare.value && writesAllowed.value && isValidDraft(errors.value))
const canDecide = (a: SpatialAllocation): boolean =>
  a.status === 'draft' && canApprove.value && !isOwn(a)
const canWithdraw = (a: SpatialAllocation): boolean =>
  (a.status === 'draft' && isOwn(a))
  || (a.status === 'approved' && canApprove.value)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const page = await financeApi.spatialAllocations({
      subject_kind: props.subjectKind, subject_id: props.subjectId, limit: 200,
    })
    allocations.value = page.allocations
  } catch (err) {
    error.value = messageOf(err, 'The spatial allocations could not be read.')
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => [props.subjectKind, props.subjectId], () => { form.value = { targetCode: '', amount: '', methodology: '' }; void load() })

async function record(): Promise<void> {
  attempted.value = true
  error.value = null
  note.value = null
  if (!canRecord.value) return
  busy.value = 'new'
  try {
    await financeApi.createSpatialAllocation({
      subject_kind: props.subjectKind,
      subject_id: props.subjectId,
      target_code: form.value.targetCode.trim(),
      amount: form.value.amount.trim(),
      currency: props.currency,
      methodology: form.value.methodology.trim(),
    })
    form.value = { targetCode: '', amount: '', methodology: '' }
    attempted.value = false
    note.value = 'Draft recorded. It moves no figure until a different officer approves it.'
    await load()
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, 'The draft could not be recorded.')
  } finally {
    busy.value = null
  }
}

async function decide(a: SpatialAllocation, action: 'approve' | 'reject'): Promise<void> {
  error.value = null
  note.value = null
  if (action === 'approve') {
    const decision = await prompt.ask({
      title: 'Approve this spatial allocation',
      message: `${formatMoney(a.amount, a.currency)} will be attributed to ward ${a.target_code}`
        + ' as recorded. The methodology is kept with the decision.',
      label: 'A note for the record (optional)',
      kind: 'textarea',
      submitLabel: 'Approve',
    })
    if (decision === null) return
    busy.value = a.id
    try {
      await financeApi.approveSpatialAllocation(a.id, decision || undefined)
      note.value = `Allocation to ward ${a.target_code} approved.`
      await load()
      emit('changed')
    } catch (err) {
      error.value = messageOf(err, 'That allocation could not be approved.')
    } finally {
      busy.value = null
    }
  } else {
    const reason = await prompt.ask({
      title: 'Refuse this spatial allocation',
      message: 'The refusal and its reason stay on the register beside the request.',
      label: 'Why is this allocation refused?',
      kind: 'textarea',
      minLength: 3,
      submitLabel: 'Refuse it',
      danger: true,
    })
    if (!reason) return
    busy.value = a.id
    try {
      await financeApi.rejectSpatialAllocation(a.id, reason)
      note.value = `Allocation to ward ${a.target_code} refused.`
      await load()
      emit('changed')
    } catch (err) {
      error.value = messageOf(err, 'That allocation could not be refused.')
    } finally {
      busy.value = null
    }
  }
}

async function withdraw(a: SpatialAllocation): Promise<void> {
  error.value = null
  note.value = null
  const reason = await prompt.ask({
    title: a.status === 'approved' ? 'Withdraw an approved allocation' : 'Withdraw this draft',
    message: a.status === 'approved'
      ? 'Withdrawing an approved split removes it from the ward attribution. The record and its '
        + 'history stay on the register.'
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
    note.value = `Allocation to ward ${a.target_code} withdrawn.`
    await load()
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, 'That allocation could not be withdrawn.')
  } finally {
    busy.value = null
  }
}

/**
 * The splits already approved against this subject — the headroom, stated as the recorded rows that
 * consume it rather than as a client-side subtraction.
 *
 * The panel deliberately does NOT compute "remaining = cap − Σ approved". Summing decimal strings in
 * JavaScript is exactly the arithmetic §6.1 rule 2 forbids, and a figure computed here could
 * disagree with the cap the trigger applies at approval time. What the officer gets instead is
 * complete: the cap as the view serves it, every approved amount as recorded, and the server's own
 * refusal — which names the total, the cap and the allocations that exceed it — if a split does not
 * fit.
 */
const approved = computed(() => allocations.value.filter((a) => a.status === 'approved'))
const drafts = computed(() => allocations.value.filter((a) => a.status === 'draft'))

function targetStatusLabel(a: SpatialAllocation): string {
  if (a.target_status === 'unlinked') return 'code not linked to this council'
  if (a.target_status === 'ward_register_empty') return 'ward register not linked (D11)'
  if (a.target_status === 'linked') return 'linked ward'
  return 'ward register status not reported'
}
</script>

<template>
  <div class="fin-spatial">
    <FinancePromptDialog :controller="prompt" />
    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span>
    </div>
    <p v-if="note" class="ins-banner t-positive" role="status">
      <CheckCircle2 :size="16" aria-hidden="true" /><span>{{ note }}</span>
    </p>

    <header class="fin-spatial-head">
      <div>
        <h4>Ward allocations</h4>
        <p class="ins-hint">
          {{ subjectLabel }} · amounts in {{ currency }}. Only an approved split changes the ward
          figures; a draft does not.
        </p>
      </div>
      <button type="button" class="fin-btn small" :disabled="loading" @click="load">
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
      </button>
    </header>

    <!--
      THE HEADROOM, STATED WITHOUT ARITHMETIC. The cap is the view's own figure; the approved rows
      are what consume it. No remaining balance is computed here: a JavaScript subtraction over
      decimal strings is the calculation §6.1 rule 2 forbids, and if it disagreed with the trigger
      by a cent the screen would be contradicting the control.
    -->
    <dl class="fin-spatial-cap">
      <dt>Cap on approved splits</dt>
      <dd>
        <template v-if="subjectCap !== null && subjectCap !== undefined">
          {{ formatMoney(subjectCap, currency) }}
          <span class="ins-hint">· the subject's {{ subjectCapLabel }}</span>
        </template>
        <template v-else>not read on this screen</template>
      </dd>
      <dt>Approved splits</dt>
      <dd>
        {{ approved.length }} row{{ approved.length === 1 ? '' : 's' }}
        <span v-if="drafts.length" class="ins-hint">· {{ drafts.length }} draft awaiting a decision</span>
      </dd>
    </dl>
    <p class="ins-hint">
      Approved splits may not exceed the cap. The sum is kept in SQL and checked when a split is
      approved: an overrun is refused, and the refusal names the total, the cap and the wards
      involved rather than leaving you to work it out.
    </p>

    <p v-if="loading && allocations.length === 0" class="ins-hint" role="status">Loading allocations…</p>

    <p v-else-if="allocations.length === 0" class="ins-hint">
      No ward allocation has been recorded for this {{ subjectKind === 'project' ? 'project' : 'budget line' }}.
      Its full amount is attributed by its own ward code, if it has one.
    </p>

    <ul v-else class="fin-spatial-list">
      <li v-for="a in allocations" :key="a.id" class="fin-spatial-row">
        <div class="fin-spatial-row-head">
          <strong>Ward {{ a.target_code }}</strong>
          <span class="fin-pill" :class="allocationStatusTone(a.status)">
            {{ ALLOCATION_STATUS_LABELS[a.status] }}
          </span>
          <span class="fin-spatial-amount">{{ formatMoney(a.amount, a.currency) }}</span>
        </div>
        <p class="ins-hint">{{ a.methodology }}</p>
        <p class="ins-hint fin-spatial-meta">
          {{ targetStatusLabel(a) }}
          · recorded {{ formatDateTime(a.requested_at) }}
          <template v-if="a.decided_at"> · decided {{ formatDateTime(a.decided_at) }}</template>
        </p>
        <p v-if="a.decision_note" class="fin-spatial-note">Decision note: {{ a.decision_note }}</p>

        <div class="fin-spatial-actions">
          <template v-if="a.status === 'draft'">
            <span v-if="isOwn(a)" class="ins-hint">
              <ShieldAlert :size="13" aria-hidden="true" />
              You recorded this draft. A different officer must approve or refuse it.
            </span>
            <template v-else-if="canDecide(a)">
              <button type="button" class="fin-btn small" :disabled="busy === a.id" @click="decide(a, 'approve')">
                <Check :size="13" aria-hidden="true" /> Approve
              </button>
              <button type="button" class="fin-btn small" :disabled="busy === a.id" @click="decide(a, 'reject')">
                <X :size="13" aria-hidden="true" /> Refuse
              </button>
            </template>
          </template>
          <button v-if="canWithdraw(a)" type="button" class="fin-btn small"
                  :disabled="busy === a.id" @click="withdraw(a)">
            Withdraw
          </button>
        </div>
      </li>
    </ul>

    <form v-if="canPrepare" class="fin-spatial-form" @submit.prevent="record">
      <h4>Record a draft split</h4>
      <p class="ins-hint">
        State the ward and the methodology. There is deliberately no equal-division control: how
        the money divides is a recorded decision, not a default.
      </p>
      <p v-if="!writesAllowed" class="ins-banner t-warning" role="status">
        <Info :size="15" aria-hidden="true" />
        <span>This financial year is closed and accepts no new financial records.</span>
      </p>

      <div class="fin-spatial-fields">
        <label>
          <span class="ins-label" for="alloc-ward">Ward</span>
          <WardPicker id="alloc-ward" v-model="form.targetCode" empty-label="Choose a ward…" />
          <span v-if="attempted && errors.targetCode" class="fin-field-error">{{ errors.targetCode }}</span>
        </label>

        <label>
          <span class="ins-label">Amount ({{ currency }})</span>
          <input v-model="form.amount" class="ins-input" type="text" inputmode="decimal"
                 placeholder="0.00" />
          <span class="ins-hint">A plain decimal; the subject's own currency. Never converted.</span>
          <span v-if="attempted && errors.amount" class="fin-field-error">{{ errors.amount }}</span>
        </label>

        <label class="fin-spatial-methodology">
          <span class="ins-label">Methodology</span>
          <textarea v-model="form.methodology" class="ins-input" rows="3"
                    placeholder="How was this share determined? e.g. metres of road in each ward, or household count from the approved survey."></textarea>
          <span v-if="attempted && errors.methodology" class="fin-field-error">{{ errors.methodology }}</span>
        </label>
      </div>

      <div class="fin-spatial-actions">
        <button type="submit" class="fin-btn" :disabled="busy === 'new' || !writesAllowed">
          <Plus :size="14" aria-hidden="true" />
          {{ busy === 'new' ? 'Recording…' : 'Record draft' }}
        </button>
        <span class="ins-hint">Approval must come from an officer who did not record it.</span>
      </div>
    </form>
  </div>
</template>

<style scoped>
.fin-spatial { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--ent-line, #d7dde5); border-radius: 8px; background: var(--ent-surface-2, #f7f9fb); }
.fin-spatial-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.fin-spatial-head h4, .fin-spatial-form h4 { margin: 0 0 2px; font-size: 13.5px; }
.fin-spatial-head p { margin: 0; }
.fin-spatial-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.fin-spatial-row { padding: 9px 10px; border: 1px solid var(--ent-line, #d7dde5); border-radius: 7px; background: var(--ent-surface, #fff); }
.fin-spatial-row-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fin-spatial-amount { margin-left: auto; font-family: var(--ent-font-mono, monospace); font-variant-numeric: tabular-nums; }
.fin-spatial-row p { margin: 4px 0 0; }
.fin-spatial-meta { font-size: 11.5px; }
.fin-spatial-note { font-size: 12px; color: var(--ent-text-2, #334155); }
.fin-spatial-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.fin-spatial-actions .ins-hint { display: inline-flex; align-items: center; gap: 4px; }
.fin-spatial-form { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 1px solid var(--ent-line, #d7dde5); }
.fin-spatial-form p { margin: 0; }
.fin-spatial-fields { display: grid; grid-template-columns: minmax(140px, 1fr) minmax(140px, 1fr); gap: 10px; }
.fin-spatial-fields label { display: flex; flex-direction: column; gap: 3px; }
.fin-spatial-methodology { grid-column: 1 / -1; }
.fin-field-error { font-size: 11.5px; color: var(--ent-tone-negative-fg, #9b2c2c); }
.fin-spatial-cap {
  display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 0; font-size: 13px;
  padding: 8px 10px; border: 1px solid var(--ent-line, #d7dde5); border-radius: 7px;
  background: var(--ent-surface, #fff);
}
.fin-spatial-cap dt { color: var(--ent-text-2, #334155); }
.fin-spatial-cap dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
@media (max-width: 720px) {
  .fin-spatial-fields { grid-template-columns: 1fr; }
  .fin-spatial-methodology { grid-column: auto; }
}
</style>
