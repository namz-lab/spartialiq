<script setup lang="ts">
/**
 * Budget revisions — every supplementary allocation and reduction, and who decided it.
 *
 * WHY THE REJECTED ONES ARE HERE TOO
 * The specification asks for "a versioned history of all approved budget changes" (§3.3). Showing
 * only the approved ones would answer that and still leave an auditor unable to see what was asked
 * for and refused, which is the more interesting question. Rejected and withdrawn revisions are
 * kept and listed.
 *
 * SELF-APPROVAL IS REFUSED IN THREE PLACES and this screen is the first: the Approve button does
 * not appear on your own request. The route refuses it too, and a CHECK constraint on
 * finance.budget_revision refuses it whatever the route does — which is the one that holds if the
 * other two are ever edited carelessly.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { financeApi } from '../../api/financeApi'
import { formatMoney, formatDate, formatDateTime } from '../../composables/useMoney'
import { useFinancePrompt } from '../../composables/useFinancePrompt'
import type { BudgetRevision, Currency, RevisionState } from '../../models/types'
import FinancePromptDialog from '../../components/FinancePromptDialog.vue'
import {
  allocationOverrunConflict, conflictSplits, type AllocationOverrunConflict,
} from '../../composables/useSpatialAllocation'
import { AlertTriangle, CheckCircle2, Layers, RefreshCw, Send, Check, X, Info, ShieldAlert } from 'lucide-vue-next'

const store = useFinanceStore()
const prompt = useFinancePrompt()
const route = useRoute()

const revisions = ref<BudgetRevision[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref<string | null>(null)

/** An explicit `?state=` link wins; then the role preset; then everything, as before. */
const STATES: RevisionState[] = ['draft', 'submitted', 'approved', 'rejected', 'withdrawn']
const linkedState = typeof route.query.state === 'string' ? route.query.state as RevisionState : null
const stateFilter = ref<RevisionState | ''>(
  linkedState && STATES.includes(linkedState)
    ? linkedState
    : (store.rolePreset.defaultFilters.revisionState ?? ''),
)

const yearId = computed(() => store.selectedYearId)
const canSubmit = computed(() => store.can('finance.revision.submit'))
const canApprove = computed(() => store.can('finance.revision.approve'))
const writable = computed(() => store.selectedYearAcceptsWrites)
const me = computed(() => store.identity?.user_id ?? null)

const stateTone: Record<RevisionState, string> = {
  draft: '', submitted: 'tone-info', approved: 'tone-positive',
  rejected: 'tone-negative', withdrawn: 'tone-neutral',
}

async function load(): Promise<void> {
  if (!yearId.value) { revisions.value = []; return }
  loading.value = true
  error.value = null
  try {
    revisions.value = await financeApi.revisions({
      financial_year_id: yearId.value,
      state: stateFilter.value || undefined,
      limit: 200,
    })
  } catch (err) {
    error.value = messageOf(err, 'The revisions could not be read.')
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([yearId, stateFilter], load)

// A queue link arriving while this section is already mounted must still apply (see BudgetSection).
watch(() => route.query.state, (state) => {
  if (typeof state === 'string' && STATES.includes(state as RevisionState)) {
    stateFilter.value = state as RevisionState
  }
})

async function act(r: BudgetRevision, action: 'submit' | 'approve' | 'reject'): Promise<void> {
  error.value = null; note.value = null
  busy.value = r.id
  try {
    if (action === 'submit') {
      await financeApi.submitRevision(r.id)
      note.value = `Revision ${r.revision_no} on ${r.budget_line_code} submitted. Approval must come from someone else.`
    } else if (action === 'approve') {
      const decision = await prompt.ask({
        title: `Approve revision ${r.revision_no}`,
        message: `The revised allocation on ${r.budget_line_code} will reflect it; the original approved figure is unchanged.`,
        label: 'A note for the record (optional)',
        kind: 'textarea',
        submitLabel: 'Approve',
      })
      if (decision === null) return
      await financeApi.approveRevision(r.id, decision || undefined)
      note.value = `Revision ${r.revision_no} approved. The revised allocation now reflects it; the original is unchanged.`
    } else {
      const reason = await prompt.ask({
        title: `Refuse revision ${r.revision_no}`,
        message: 'The refusal and its reason are kept on the record beside the request.',
        label: 'Why is this revision refused?',
        kind: 'textarea',
        minLength: 5,
        submitLabel: 'Refuse it',
        danger: true,
      })
      if (!reason) return
      await financeApi.rejectRevision(r.id, reason)
      note.value = `Revision ${r.revision_no} refused. It stays on the record with your reason.`
    }
    await load()
  } catch (err) {
    // D16. A reduction blocked by its own approved geography is not an error the officer can only
    // read: it is a sequence they can complete. The panel names the splits and offers withdrawal
    // on each, then the approval again.
    const overrun = allocationOverrunConflict(err)
    if (overrun && action === 'approve') {
      conflict.value = { revision: r, detail: overrun }
    } else {
      error.value = messageOf(err, 'That could not be done.')
    }
  } finally {
    busy.value = null
  }
}

/**
 * The refusal in force, with the revision it refused, so "Approve again" retries the same decision.
 */
const conflict = ref<{ revision: BudgetRevision; detail: AllocationOverrunConflict } | null>(null)
const conflictRows = computed(() =>
  conflict.value ? conflictSplits(conflict.value.detail) : [])
/**
 * The currency the refused figures are in. The payload's `currency` is a plain string, so it is
 * trusted only when it is one of the two this module recognises; otherwise the revision's own
 * currency stands. A money figure labelled with a currency nobody can name is not a figure.
 */
const conflictCurrency = computed<Currency>(() => {
  const named = conflict.value?.detail.currency
  if (named === 'USD' || named === 'ZWG') return named
  return conflict.value?.revision.currency ?? 'USD'
})
const withdrawn = ref<Set<string>>(new Set())

/** Withdrawing an approved split is itself an audited decision; it asks for a reason and records it. */
async function withdrawSplit(id: string | null, targetCode: string): Promise<void> {
  if (!id) return
  error.value = null
  const reason = await prompt.ask({
    title: `Withdraw the approved split on ward ${targetCode}`,
    message: 'The split stops attributing money to that ward. The record, its methodology and its '
      + 'approver stay on the register — this is a revocation, not a deletion.',
    label: 'Why is it withdrawn? (kept with the record)',
    kind: 'textarea',
    submitLabel: 'Withdraw it',
    danger: true,
  })
  if (reason === null) return
  busy.value = id
  try {
    await financeApi.withdrawSpatialAllocation(id, reason || undefined)
    withdrawn.value = new Set([...withdrawn.value, id])
    note.value = `The split on ward ${targetCode} is withdrawn. Approve the revision again when the `
      + 'remaining splits fit.'
  } catch (err) {
    error.value = messageOf(err, 'That split could not be withdrawn.')
  } finally {
    busy.value = null
  }
}

/** Retry the approval the splits blocked. A second refusal simply replaces the panel's figures. */
async function retryApproval(): Promise<void> {
  const pendingConflict = conflict.value
  if (!pendingConflict) return
  conflict.value = null
  withdrawn.value = new Set()
  await act(pendingConflict.revision, 'approve')
}

const isOwn = (r: BudgetRevision): boolean => me.value !== null && r.requested_by === me.value

const pending = computed(() => revisions.value.filter((r) => r.state === 'submitted'))
const awaitingMe = computed(() => canApprove.value ? pending.value.filter((r) => !isOwn(r)) : [])
const myOwnPending = computed(() => canApprove.value ? pending.value.filter((r) => isOwn(r)) : [])
</script>

<template>
  <div class="fin-section">
    <FinancePromptDialog :controller="prompt" />
    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span>
    </div>
    <p v-if="note" class="ins-banner t-positive" role="status">
      <CheckCircle2 :size="16" aria-hidden="true" /><span>{{ note }}</span>
    </p>

    <!--
      D16 — the reduction the line's own geography refuses, and the way out of it.

      This is not an error banner. The approved splits that no longer fit are named, each with a
      withdrawal (an audited decision, with its reason), and the approval can then be retried. The
      system will not revoke an approved split on the officer's behalf: it carries a recorded
      methodology and a named approver, and taking that back is a decision, not a side effect.
    -->
    <section v-if="conflict" class="ins-card fin-overrun" role="alert">
      <div class="ins-card-head">
        <h3><Layers :size="15" aria-hidden="true" />
          Revision {{ conflict.revision.revision_no }} on {{ conflict.revision.budget_line_code }}
          cannot be approved yet</h3>
        <button type="button" class="fin-btn small" @click="conflict = null">Dismiss</button>
      </div>
      <div class="ins-card-body">
        <p>{{ conflict.detail.message }}</p>
        <dl class="fin-overrun-facts">
          <dt>Approved splits total</dt>
          <dd>{{ conflict.detail.approvedSplitTotal === null ? '—'
            : formatMoney(conflict.detail.approvedSplitTotal, conflictCurrency) }}</dd>
          <dt>Revised total now</dt>
          <dd>{{ conflict.detail.revisedAmount === null ? '—'
            : formatMoney(conflict.detail.revisedAmount, conflictCurrency) }}</dd>
          <dt>Revised total after this reduction</dt>
          <dd>{{ conflict.detail.revisedAfter === null ? '—'
            : formatMoney(conflict.detail.revisedAfter, conflictCurrency) }}</dd>
        </dl>
        <h4>The approved splits in the way</h4>
        <ul class="fin-overrun-splits">
          <li v-for="(split, i) in conflictRows" :key="split.id ?? `row-${i}`">
            <span>Ward <strong>{{ split.targetCode }}</strong></span>
            <span v-if="split.id && withdrawn.has(split.id)" class="fin-pill tone-neutral">withdrawn</span>
            <button v-else-if="split.id" type="button" class="fin-btn small"
                    :disabled="busy === split.id"
                    @click="withdrawSplit(split.id, split.targetCode)">
              Withdraw this split
            </button>
            <span v-else class="ins-hint">
              This ward's split was not identified in the refusal; open it from the budget line's
              ward allocations.
            </span>
          </li>
        </ul>
        <div class="fin-overrun-actions">
          <button type="button" class="fin-btn" :disabled="!!busy" @click="retryApproval">
            <Check :size="14" aria-hidden="true" /> Approve the revision again
          </button>
          <span class="ins-hint">
            Nothing is lost by the order: both decisions are yours, and each is recorded.
          </span>
        </div>
      </div>
    </section>

    <div class="fin-bar">
      <div class="ins-seg" role="group" aria-label="State">
        <button type="button" :class="{ 'is-on': stateFilter === '' }" @click="stateFilter = ''">All</button>
        <button type="button" :class="{ 'is-on': stateFilter === 'draft' }" @click="stateFilter = 'draft'">Draft</button>
        <button type="button" :class="{ 'is-on': stateFilter === 'submitted' }" @click="stateFilter = 'submitted'">Submitted</button>
        <button type="button" :class="{ 'is-on': stateFilter === 'approved' }" @click="stateFilter = 'approved'">Approved</button>
        <button type="button" :class="{ 'is-on': stateFilter === 'rejected' }" @click="stateFilter = 'rejected'">Refused</button>
      </div>
      <button type="button" class="fin-btn small" :disabled="loading" @click="load">
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
      </button>
    </div>

    <p v-if="canApprove && awaitingMe.length" class="ins-banner t-info" role="status">
      <Info :size="16" aria-hidden="true" />
      <span>{{ awaitingMe.length }} revision{{ awaitingMe.length === 1 ? '' : 's' }} awaiting your decision.</span>
    </p>

    <p v-if="myOwnPending.length" class="ins-banner t-warning" role="status">
      <ShieldAlert :size="16" aria-hidden="true" />
      <span>
        {{ myOwnPending.length }} submitted revision{{ myOwnPending.length === 1 ? ' is' : 's are' }}
        your own request. You hold the approval permission but cannot approve your own revision —
        that is the separation of duties, and the database refuses it independently of this screen.
      </span>
    </p>

    <p v-if="loading && revisions.length === 0" class="fin-loading" role="status">Reading revisions…</p>

    <div v-else-if="!yearId" class="fin-empty">
      <strong>No financial year is selected.</strong>
      <p>Choose a reporting period above.</p>
    </div>

    <div v-else-if="revisions.length === 0" class="fin-empty">
      <strong>No revisions have been raised for {{ store.selectedYear?.label }}.</strong>
      <p>
        A revision adjusts an approved allocation. Raise one from a line under Budget; the original
        approved figure is never overwritten, so both remain visible for the life of the record.
      </p>
    </div>

    <section v-else class="ins-card">
      <div class="ins-card-head">
        <h3>Revisions <span class="ins-count">{{ revisions.length }}</span></h3>
      </div>
      <div class="ins-card-body">
        <div class="fin-table-wrap">
          <table class="fin-table">
            <caption>
              A positive change is a supplementary allocation; a negative one a reduction. The
              revised allocation is the original plus the approved changes only.
            </caption>
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Department</th>
                <th scope="col" class="num">No.</th>
                <th scope="col" class="ccy">Ccy</th>
                <th scope="col" class="num">Original</th>
                <th scope="col" class="num">Change</th>
                <th scope="col">State</th>
                <th scope="col">Reason</th>
                <th scope="col">Requested</th>
                <th scope="col">Decided</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in revisions" :key="r.id">
                <td class="ins-mono">{{ r.budget_line_code }}<br /><small class="fin-sub">{{ r.budget_line_description }}</small></td>
                <td>{{ r.department_name }}</td>
                <td class="num">{{ r.revision_no }}</td>
                <td class="ccy">{{ r.currency }}</td>
                <td class="num">{{ formatMoney(r.original_amount ?? null, r.currency, { bare: true }) }}</td>
                <td class="num emphasis" :class="{ 'is-reduction': r.amount_delta.startsWith('-') }">
                  {{ formatMoney(r.amount_delta, r.currency, { bare: true }) }}
                </td>
                <td><span class="fin-pill" :class="stateTone[r.state]">{{ r.state === 'rejected' ? 'refused' : r.state }}</span></td>
                <td class="fin-reason">
                  {{ r.reason }}
                  <template v-if="r.decision_note"><br /><small class="fin-sub">Decision: {{ r.decision_note }}</small></template>
                </td>
                <td>
                  {{ r.requested_by_name ?? '—' }}<br />
                  <small class="fin-sub">{{ formatDateTime(r.requested_at) }}</small>
                  <span v-if="isOwn(r)" class="fin-pill tone-info">yours</span>
                </td>
                <td>
                  <template v-if="r.decided_at">
                    {{ r.decided_by_name ?? '—' }}<br />
                    <small class="fin-sub">{{ formatDateTime(r.decided_at) }}</small>
                  </template>
                  <template v-else>—</template>
                </td>
                <td>
                  <div class="fin-row-actions">
                    <button v-if="canSubmit && writable && r.state === 'draft'" type="button" class="fin-btn small"
                            :disabled="busy === r.id" @click="act(r, 'submit')">
                      <Send :size="12" aria-hidden="true" /> Submit
                    </button>
                    <template v-if="canApprove && writable && r.state === 'submitted'">
                      <template v-if="isOwn(r)">
                        <span class="fin-hint-inline">Your own request. Someone else must decide it.</span>
                      </template>
                      <template v-else>
                        <button type="button" class="fin-btn small primary" :disabled="busy === r.id" @click="act(r, 'approve')">
                          <Check :size="12" aria-hidden="true" /> Approve
                        </button>
                        <button type="button" class="fin-btn small danger" :disabled="busy === r.id" @click="act(r, 'reject')">
                          <X :size="12" aria-hidden="true" /> Refuse
                        </button>
                      </template>
                    </template>
                    <span v-if="r.state === 'approved'" class="fin-hint-inline">
                      Effective {{ formatDate(r.effective_date) }}
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); }
/* The D16 refusal panel. It is a task, not a toast: it stays until the officer finishes the
   sequence or dismisses it, and the border is accompanied by a heading and words. */
.fin-overrun { border-left: 3px solid var(--ent-tone-warning-fg, #b45309); }
.fin-overrun-facts {
  display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 10px 0; font-size: 13px;
}
.fin-overrun-facts dt { color: var(--ent-text-2, #334155); }
.fin-overrun-facts dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.fin-overrun h4 { margin: 10px 0 6px; font-size: 13px; }
.fin-overrun-splits { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.fin-overrun-splits li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fin-overrun-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
.fin-row-actions { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.fin-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.fin-reason { max-width: 28ch; }
.fin-hint-inline { font-size: var(--ent-fs-micro); color: var(--ent-text-3); max-width: 20ch; line-height: 1.3; }
.fin-loading { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.is-reduction { color: var(--ent-danger); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
