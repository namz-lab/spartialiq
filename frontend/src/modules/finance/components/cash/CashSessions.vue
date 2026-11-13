<script setup lang="ts">
/**
 * Cash-ups: every cashier session, and the second person's half of the control.
 *
 * A closed session is a count somebody declared and nobody has yet agreed. Verifying it is the act
 * that puts the day's takings into the book of account, so the row shows what is being agreed —
 * float, receipts in the drawer, what was counted, the difference and its explanation — before
 * the button, and the server refuses the cashier's own session whatever this screen offers.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Printer, RotateCcw } from 'lucide-vue-next'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { cashApi } from '../../api/cashApi'
import { formatMoney, formatDate, formatDateTime } from '../../composables/useMoney'
import { toCents } from '../../composables/cashMath'
import { methodLabel, type CashierSession, type CashierSessionDetail, type SessionStatus } from '../../models/cashTypes'
import { useFinancePrompt } from '../../composables/useFinancePrompt'
import FinancePromptDialog from '../FinancePromptDialog.vue'
import CashSessionHistory from './CashSessionHistory.vue'

const emit = defineEmits<{ (e: 'changed'): void; (e: 'print', receiptId: string): void }>()

const store = useFinanceStore()
const prompt = useFinancePrompt()
const canVerify = computed(() => store.can('finance.cash.session.verify'))
const me = computed(() => store.identity?.user_id ?? null)

type Filter = SessionStatus | 'all'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'closed', label: 'Awaiting verification' },
  { value: 'open', label: 'Open now' },
  { value: 'abandoned', label: 'Abandoned' },
  { value: 'verified', label: 'Verified' },
  { value: 'all', label: 'All' },
]
const filter = ref<Filter>('closed')
const sessions = ref<CashierSession[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref<string | null>(null)

const openId = ref<string | null>(null)
const detail = ref<CashierSessionDetail | null>(null)
const detailLoading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const page = await cashApi.sessions({ ...(filter.value === 'all' ? {} : { status: filter.value }), limit: 100 })
    sessions.value = page.sessions
    total.value = page.total
  } catch (err) {
    error.value = messageOf(err, 'The sessions could not be read.')
  } finally {
    loading.value = false
  }
}

async function toggle(session: CashierSession): Promise<void> {
  if (openId.value === session.id) { openId.value = null; detail.value = null; return }
  openId.value = session.id
  detail.value = null
  detailLoading.value = true
  try {
    detail.value = (await cashApi.session(session.id)).session
  } catch (err) {
    error.value = messageOf(err, 'The session could not be read.')
    openId.value = null
  } finally {
    detailLoading.value = false
  }
}

const hasDifference = (s: CashierSession) => s.counts.some((c) => c.variance !== null && (toCents(c.variance.replace('-', '')) ?? 0n) !== 0n)
const isMine = (s: CashierSession) => me.value !== null && s.cashier_id === me.value
const varianceTone = (variance: string | null) => {
  if (variance === null || (toCents(variance.replace('-', '')) ?? 0n) === 0n) return ''
  return variance.startsWith('-') ? 'is-short' : 'is-over'
}
const STATUS_LABEL: Record<SessionStatus, string> = {
  open: 'Open', suspended: 'Suspended', abandoned: 'Abandoned', closed: 'Awaiting verification', verified: 'Verified',
}
const STATUS_TONE: Record<SessionStatus, string> = {
  open: 'tone-info', suspended: '', abandoned: 'tone-negative', closed: 'tone-warning', verified: 'tone-positive',
}
/** Still holding a drawer: the count, not a status, frees it. */
const isHolding = (s: CashierSession) => ['open', 'suspended', 'abandoned'].includes(s.status)
/** Whoever counted or witnessed a drawer does not agree the count (C4, extended by migration 208). */
const tookPart = (s: CashierSession) => me.value !== null && (s.closed_by === me.value || s.witness_id === me.value)

async function verify(session: CashierSession): Promise<void> {
  const note = await prompt.ask({
    title: `Verify ${session.session_no}`,
    message: `You are agreeing ${session.cashier_name}'s count for ${session.cash_point_name}. Every receipt of the session is posted to the book of account${hasDifference(session) ? ', and the difference is posted to the cash point\'s cash-difference account' : ''}. A posted entry is never amended; it is corrected by a reversal.`,
    label: 'Note (optional)', kind: 'text', submitLabel: 'Verify and post',
  })
  if (note === null) return
  busy.value = session.id
  error.value = null
  notice.value = null
  try {
    const result = await cashApi.verifySession(session.id, note || undefined)
    notice.value = `${session.session_no}: ${result.note}`
    openId.value = null
    await load()
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, 'The session could not be verified.')
  } finally {
    busy.value = null
  }
}

async function sendBack(session: CashierSession): Promise<void> {
  const reason = await prompt.ask({
    title: `Return ${session.session_no} for a recount`,
    message: session.closed_by
      ? `This count was made under supervision by ${session.closed_by_name}. It goes back to the supervisors to count again with a witness; ${session.cashier_name} does not get the drawer back. Nothing is posted.`
      : `The session opens again for ${session.cashier_name}, who can cancel a receipt taken in error and declare the count afresh. Nothing is posted.`,
    label: 'What should they check?', kind: 'textarea', minLength: 5,
    submitLabel: session.closed_by ? 'Return for supervised recount' : 'Return to cashier',
  })
  if (!reason) return
  busy.value = session.id
  error.value = null
  notice.value = null
  try {
    const result = await cashApi.returnSession(session.id, reason)
    notice.value = `${session.session_no}: ${result.note}`
    openId.value = null
    await load()
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, 'The session could not be returned.')
  } finally {
    busy.value = null
  }
}

watch(filter, () => { openId.value = null; void load() })
onMounted(load)
defineExpose({ load })
</script>

<template>
  <div class="cash-sessions">
    <div class="fin-bar cash-sessions-bar">
      <div class="ins-seg" role="radiogroup" aria-label="Which sessions">
        <button v-for="f in FILTERS" :key="f.value" type="button" role="radio" :aria-checked="filter === f.value" @click="filter = f.value">{{ f.label }}</button>
      </div>
      <span class="ins-hint">One cashier, one cash point, one day.</span>
    </div>

    <p v-if="error" class="ins-banner t-negative" role="alert"><AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span></p>
    <p v-if="notice" class="ins-banner t-positive" role="status"><span>{{ notice }}</span></p>

    <div v-if="loading && sessions.length === 0" aria-busy="true"><span class="ins-skel" /><span class="ins-skel" style="margin-top: 8px; width: 70%" /></div>

    <div v-else-if="sessions.length === 0" class="fin-empty" role="status">
      <strong v-if="filter === 'closed'">No cash-up is waiting to be verified.</strong>
      <strong v-else-if="filter === 'open'">No till is open.</strong>
      <strong v-else-if="filter === 'abandoned'">No session is waiting for a supervised count.</strong>
      <strong v-else>No session to show.</strong>
      <p v-if="filter === 'closed'">A session appears here when its cashier declares the count. Until somebody else verifies it, its receipts are not in the book of account.</p>
      <p v-else>A session is one cashier, one cash point and one day's takings.</p>
    </div>

    <ul v-else class="cash-session-list">
      <li v-for="s in sessions" :key="s.id" class="ins-card cash-session-card" :class="`is-${s.status}`">
        <div class="cash-srow">
          <button type="button" class="cash-srow-toggle" :aria-expanded="openId === s.id" :aria-controls="`cash-s-${s.id}`" @click="toggle(s)">
            <component :is="openId === s.id ? ChevronDown : ChevronRight" :size="16" class="cash-srow-chev" aria-hidden="true" />
            <span class="cash-srow-id">
              <span class="cash-srow-heading">
                <strong>{{ s.session_no }}</strong>
                <span class="fin-pill" :class="STATUS_TONE[s.status]">{{ STATUS_LABEL[s.status] }}</span>
              </span>
              <span class="cash-srow-meta">{{ s.cash_point_name }} · {{ s.cashier_name }} · {{ formatDate(s.business_date) }}</span>
              <span v-if="s.closed_by_name" class="cash-srow-meta">Counted under supervision by {{ s.closed_by_name }}, witnessed by {{ s.witness_name }}</span>
              <span v-else-if="s.status === 'abandoned'" class="cash-srow-meta">Found abandoned by {{ s.abandoned_by_name }} — waiting for a supervised count</span>
            </span>
          </button>
          <div class="cash-srow-figures">
            <template v-if="isHolding(s)">
              <span class="cash-figure">
                <span class="cash-figure-label">Receipts so far</span>
                <span class="cash-figure-value">{{ s.receipt_count }}</span>
              </span>
            </template>
            <template v-else>
              <span v-for="c in s.counts.filter((x) => x.declared_total !== null)" :key="c.currency" class="cash-figure">
                <span class="cash-figure-label">{{ c.currency }}</span>
                <span class="cash-figure-value">{{ formatMoney(c.declared_total, c.currency, { bare: true }) }}</span>
                <em class="cash-figure-var" :class="varianceTone(c.variance)">{{ varianceTone(c.variance) === '' ? 'agrees' : `${varianceTone(c.variance) === 'is-short' ? 'short' : 'over'} ${formatMoney(c.variance!.replace('-', ''), c.currency, { bare: true })}` }}</em>
              </span>
              <span v-if="!s.counts.some((x) => x.declared_total !== null)" class="cash-figure-label">Nothing in the drawer</span>
            </template>
          </div>
          <div v-if="s.status === 'closed' && canVerify" class="cash-srow-acts">
            <template v-if="isMine(s)"><span class="cash-mine">Your own cash-up — somebody else verifies it</span></template>
            <template v-else-if="tookPart(s)"><span class="cash-mine">You counted or witnessed this drawer — somebody else verifies it</span></template>
            <template v-else>
              <button type="button" class="fin-btn small" :disabled="busy === s.id" @click="sendBack(s)"><RotateCcw :size="12" aria-hidden="true" /> Return</button>
              <button type="button" class="fin-btn small primary" :disabled="busy === s.id" @click="verify(s)"><Check :size="12" aria-hidden="true" /> {{ busy === s.id ? 'Working…' : 'Verify' }}</button>
            </template>
          </div>
        </div>

        <p v-if="s.status === 'closed' && hasDifference(s) && !s.difference_account_set" class="cash-warn" role="status">
          <AlertTriangle :size="14" aria-hidden="true" />
          This cash-up has a difference and {{ s.cash_point_name }} has no cash-difference account, so it cannot be verified yet. Name the account under Setup: a difference is posted, never absorbed.
        </p>

        <div v-if="openId === s.id" :id="`cash-s-${s.id}`" class="cash-detail">
          <p v-if="detailLoading" class="ins-hint" role="status">Reading the session…</p>
          <template v-else-if="detail">
            <div v-if="detail.counts.some((c) => c.declared_total !== null)" class="fin-table-wrap">
              <table class="fin-table">
                <caption>The count against the receipts, per currency.</caption>
                <thead><tr>
                  <th scope="col">Currency</th><th scope="col" class="num">Float</th><th scope="col" class="num">Receipts in the drawer</th>
                  <th scope="col" class="num">Counted</th><th scope="col" class="num">Difference</th><th scope="col">Explanation</th>
                </tr></thead>
                <tbody>
                  <tr v-for="c in detail.counts.filter((x) => x.declared_total !== null)" :key="c.currency">
                    <td class="ccy">{{ c.currency }}</td>
                    <td class="num">{{ formatMoney(c.opening_float, c.currency, { bare: true }) }}</td>
                    <td class="num">{{ formatMoney(c.expected_takings, c.currency, { bare: true }) }}</td>
                    <td class="num emphasis">{{ formatMoney(c.declared_total, c.currency, { bare: true }) }}</td>
                    <td class="num" :class="varianceTone(c.variance)">{{ formatMoney(c.variance, c.currency, { bare: true }) }}</td>
                    <td>{{ c.explanation || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p v-if="detail.totals_withheld" class="ins-hint">This is your own session and its drawer has not been counted, so its totals are not shown until the count is declared.</p>
            <div v-else-if="detail.totals.length" class="fin-table-wrap">
              <table class="fin-table">
                <caption>Takings by how they were paid. Only cash and cheques are in the drawer.</caption>
                <thead><tr><th scope="col">Currency</th><th scope="col">Paid by</th><th scope="col" class="num">Receipts</th><th scope="col" class="num">Amount</th><th scope="col">Where it is</th></tr></thead>
                <tbody>
                  <tr v-for="t in detail.totals" :key="`${t.currency}-${t.method}`">
                    <td class="ccy">{{ t.currency }}</td><td>{{ methodLabel(t.method) }}</td>
                    <td class="num">{{ t.receipts }}</td>
                    <td class="num">{{ formatMoney(t.amount, t.currency, { bare: true }) }}</td>
                    <td>{{ t.is_physical ? 'In the drawer' : 'Paid straight into the bank' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="fin-table-wrap">
              <table class="fin-table">
                <caption>{{ detail.receipts.length }} receipt{{ detail.receipts.length === 1 ? '' : 's' }}, newest first. A cancelled receipt stays listed with its reason.</caption>
                <thead><tr><th scope="col">Receipt</th><th scope="col">From</th><th scope="col">For</th><th scope="col">Paid by</th><th scope="col">Currency</th><th scope="col" class="num">Amount</th><th scope="col">In the book</th><th scope="col"><span class="sr-only">Print</span></th></tr></thead>
                <tbody>
                  <tr v-for="r in detail.receipts" :key="r.id" :class="{ 'is-cancelled': r.is_cancelled }">
                    <td class="cash-mono">{{ r.receipt_no }}</td>
                    <td>{{ r.payer_name }}</td>
                    <td>{{ r.source === 'rates' ? 'Rates' : 'Other income' }}</td>
                    <td>{{ methodLabel(r.method) }}<template v-if="r.method_reference"> · {{ r.method_reference }}</template></td>
                    <td class="ccy">{{ r.currency }}</td>
                    <td class="num">{{ formatMoney(r.amount, r.currency, { bare: true }) }}</td>
                    <td>{{ r.is_cancelled ? `Cancelled: ${r.cancel_reason ?? ''}` : r.voucher_status === 'posted' ? 'Posted' : 'Not yet' }}</td>
                    <td><button type="button" class="ins-iconbtn" @click="emit('print', r.id)"><Printer :size="14" aria-hidden="true" /><span class="sr-only">Print {{ r.receipt_no }}</span></button></td>
                  </tr>
                  <tr v-if="detail.receipts.length === 0"><td colspan="8">No receipt was issued in this session.</td></tr>
                </tbody>
              </table>
            </div>

            <p v-if="detail.status === 'verified'" class="ins-hint">
              Verified by {{ detail.verified_by_name }} on {{ formatDateTime(detail.verified_at) }}<template v-if="detail.verify_note"> — “{{ detail.verify_note }}”</template>.
            </p>

            <CashSessionHistory v-if="detail.events" :events="detail.events" />
          </template>
        </div>
      </li>
    </ul>

    <p v-if="total > sessions.length" class="ins-hint">Showing the first {{ sessions.length }} of {{ total }} sessions.</p>
    <FinancePromptDialog :controller="prompt" />
  </div>
</template>

<style scoped>
.cash-sessions { display: flex; flex-direction: column; gap: var(--ent-s3); }
.cash-sessions-bar { justify-content: space-between; }
.cash-session-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ent-s3); }

/* A status rail down the left edge, so a row's place in the control reads before its text. */
.cash-session-card { position: relative; overflow: hidden; }
.cash-session-card.is-open { border-left: 3px solid var(--ent-accent); }
.cash-session-card.is-closed { border-left: 3px solid var(--ent-warning); }
.cash-session-card.is-verified { border-left: 3px solid var(--ent-success); }
.cash-session-card.is-suspended { border-left: 3px solid var(--ent-text-3); }
.cash-session-card.is-abandoned { border-left: 3px solid var(--ent-danger); }

.cash-srow {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto;
  gap: var(--ent-s3) var(--ent-s4); align-items: center;
  padding: var(--ent-s3) var(--ent-s4);
}
.cash-srow-toggle {
  display: flex; align-items: flex-start; gap: var(--ent-s2); min-width: 0;
  border: 0; background: none; padding: 0; font: inherit; text-align: left; color: var(--ent-text); cursor: pointer;
}
.cash-srow-toggle:focus-visible { outline: var(--ent-focus-ring); outline-offset: 4px; border-radius: var(--ent-r-sm); }
.cash-srow-chev { flex-shrink: 0; margin-top: 2px; color: var(--ent-text-3); }
.cash-srow-id { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.cash-srow-heading { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; }
.cash-srow-heading strong { font-family: var(--ent-font-mono); font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); }
.cash-srow-meta { font-size: var(--ent-fs-xs); color: var(--ent-text-3); }

.cash-srow-figures { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; justify-content: flex-end; }
.cash-figure {
  display: inline-flex; align-items: baseline; gap: 6px;
  padding: 3px var(--ent-s2); border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-sm); background: var(--ent-surface-2);
}
.cash-figure-label {
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.04em; text-transform: uppercase; color: var(--ent-text-3);
}
.cash-figure-value {
  font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums;
  font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text);
}
.cash-figure-var { font-style: normal; font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.cash-figure-var.is-short { color: var(--ent-danger); font-weight: var(--ent-fw-semibold); }
.cash-figure-var.is-over { color: var(--ent-warning); font-weight: var(--ent-fw-semibold); }

.cash-srow-acts { display: flex; align-items: center; gap: var(--ent-s2); justify-content: flex-end; }
.cash-mine { max-width: 12rem; font-size: var(--ent-fs-xs); color: var(--ent-text-3); line-height: var(--ent-lh); }

.cash-warn {
  display: flex; gap: var(--ent-s2); align-items: flex-start; margin: 0; padding: var(--ent-s2) var(--ent-s4);
  border-top: 1px solid var(--ent-tone-warning-line); background: var(--ent-tone-warning-bg);
  font-size: var(--ent-fs-xs); color: var(--ent-text); line-height: var(--ent-lh);
}
.cash-warn svg { color: var(--ent-warning); flex-shrink: 0; margin-top: 1px; }
.cash-detail {
  display: flex; flex-direction: column; gap: var(--ent-s4);
  padding: var(--ent-s4); border-top: 1px solid var(--ent-line);
  background: var(--ent-surface-2); border-radius: 0 0 var(--ent-r-md) var(--ent-r-md);
}
.cash-mono { font-family: var(--ent-font-mono); font-size: 0.95em; white-space: nowrap; }
.is-short, .cash-figure-var.is-short { color: var(--ent-danger); font-weight: var(--ent-fw-semibold); }
.is-over, .cash-figure-var.is-over { color: var(--ent-warning); font-weight: var(--ent-fw-semibold); }
tr.is-cancelled td { color: var(--ent-text-3); }
tr.is-cancelled td.num { text-decoration: line-through; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@media (max-width: 900px) {
  .cash-srow { grid-template-columns: minmax(0, 1fr); align-items: start; }
  .cash-srow-figures, .cash-srow-acts { justify-content: flex-start; }
}
</style>
