<script setup lang="ts">
/**
 * One voucher, whole: header, lines with their analysis, the ledger entries it produced, who
 * prepared and who posted, what it reverses or is reversed by, and the document that raised it.
 *
 * Actions follow the preparer rule: nobody posts what they prepared; a posted voucher is never
 * edited, it is reversed; a voucher raised by a document is discarded from that document. A control
 * the person cannot use is not drawn. Totals are the server's figures.
 */
import CwSkeleton from '../kit/CwSkeleton.vue'
import { computed, nextTick, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { AlertTriangle, ArrowLeft, CircleCheck, Copy, FileText, Info, Pencil, Printer, Trash2, Undo2 } from 'lucide-vue-next'
import axios from 'axios'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatMoney } from '../../../composables/useMoney'
import type { VoucherDetail, VoucherSourceKind } from '../../../models/ledgerTypes'
import ReasonDialog from '../../shared/ReasonDialog.vue'
import { VOUCHER_TYPE_LABEL } from './voucherLabels'
import '../kit/statement.css'
import '../kit/print.css'

const store = useFinanceStore()
const route = useRoute()
const router = useRouter()

function localToday(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const id = computed(() => String(route.params.id ?? ''))
const data = ref<VoucherDetail | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref(false)
const reversing = ref(false)
const reverseError = ref<string | null>(null)
const reverseDate = ref(localToday())
const discarding = ref(false)
const discardError = ref<string | null>(null)
// Cancelling asks for a reason in a ReasonDialog; focus returns to the Cancel draft button
// (named outright: Safari does not focus a clicked button).
const discardBtn = ref<HTMLButtonElement | null>(null)
function openDiscard(): void {
  if (busy.value) return
  discardError.value = null
  discarding.value = true
}
function closeDiscard(): void {
  if (busy.value) return
  discarding.value = false
}
const reversalId = ref<string | null>(null)
const reverseBtn = ref<HTMLButtonElement | null>(null)
function openReverse(): void {
  if (busy.value) return
  reverseError.value = null
  reversing.value = true
}

/** Each read takes a number; only the latest read may write, so a slow answer for another voucher is dropped. */
let reqId = 0
async function load(): Promise<void> {
  const seq = ++reqId
  error.value = null
  try {
    const got = await ledgerApi.voucher(id.value)
    if (seq !== reqId) return
    data.value = got
  } catch (err) {
    if (seq !== reqId) return
    // A failed re-read keeps the voucher already on the page; the watcher clears it when the address changes.
    error.value = messageOf(err, 'The voucher could not be read.')
  } finally {
    if (seq === reqId) loading.value = false
  }
}

/** The notice region stays mounted so that screen readers announce what is put into it. */
const noticeEl = ref<HTMLElement | null>(null)
/** A successful dialog or post can remove the button that opened it; move focus to the notice instead. */
async function focusNotice(): Promise<void> {
  await nextTick()
  noticeEl.value?.focus({ preventScroll: true })
}
/** 409 refusals mean the page is out of date: read the voucher again and keep the message. */
function isConflict(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 409
}
async function reread(message: string | null, into: { value: string | null }): Promise<void> {
  await load()
  into.value = message
}
/** The note the journal editor passes on arrival (history state); shown once per arrival, not again on refresh. */
const seenArrivals = new Set<string>()
function arrivalNote(): string | null {
  const st = window.history.state as { note?: unknown; position?: unknown } | null
  const note = st?.note
  if (typeof note !== 'string' || !note.trim()) return null
  const key = `${id.value}:${String(st?.position ?? '')}:${note}`
  if (seenArrivals.has(key)) return null
  seenArrivals.add(key)
  return note
}
watch(id, () => { reversing.value = false; discarding.value = false; data.value = null; reversalId.value = null; error.value = null; loading.value = true; notice.value = arrivalNote(); void load() }, { immediate: true })

const v = computed(() => data.value?.voucher ?? null)
const me = computed(() => store.identity?.user_id ?? null)
const own = computed(() => !!v.value && v.value.prepared_by === me.value)
const isDraft = computed(() => v.value?.status === 'draft')
const mayPost = computed(() => store.can('finance.ledger.voucher.post'))
const mayPrepare = computed(() => store.can('finance.ledger.voucher.prepare'))
const canPost = computed(() => isDraft.value && mayPost.value && !own.value)
const ownDraft = computed(() => isDraft.value && own.value)
const isCancelled = computed(() => v.value?.status === 'cancelled')
/** A reversal waiting to be posted: the original stays posted, and a second one is refused. */
const pendingReversal = computed(() => (data.value?.reversed_by?.status === 'draft' ? data.value.reversed_by : null))
/** A posted reversal. */
const postedReversal = computed(() => (data.value?.reversed_by?.status === 'posted' ? data.value.reversed_by : null))
const canReverse = computed(() => v.value?.status === 'posted' && !data.value?.reversed_by && store.can('finance.ledger.voucher.reverse'))
const fromDocument = computed(() => !!data.value?.source)
/** A reversal draft keeps the reason and lines it was raised with; it can only be cancelled. */
const isReversalDraft = computed(() => isDraft.value && v.value?.voucher_type === 'reversal')
/** Edit and Cancel belong to the preparer alone; the server refuses anybody else with 403. */
const isClosingDraft = computed(() => isDraft.value && v.value?.voucher_type === 'closing')
/** A closing draft is cancelled by its preparer when the server says so (may_discard); anything else needs the prepare right. */
const canChange = computed(() => isDraft.value && own.value && !fromDocument.value
  && (isClosingDraft.value ? (data.value?.may_discard ?? mayPrepare.value) : mayPrepare.value))
/** A closing draft is built by the server from the books; its lines cannot be edited (409 closing_voucher). Cancel still works. */
const canEdit = computed(() => canChange.value && mayPrepare.value && !isReversalDraft.value && !isClosingDraft.value)
const notPreparer = computed(() => isDraft.value && !own.value && !fromDocument.value)
/** The preparer has since lost the prepare permission: say so in words. */
const lostPrepare = computed(() => isDraft.value && own.value && !canChange.value && !isClosingDraft.value && !fromDocument.value)
const notPreparerSentence = computed(() => 'Only the person who prepared it may change or cancel it'
  + (mayPrepare.value ? '; copy it into a new draft of your own.' : '.'))
const totals = computed(() => (isDraft.value ? data.value?.draft_balance : data.value?.posted_balance) ?? null)

const SOURCE_PAGE: Record<VoucherSourceKind, string> = {
  supplier_invoice: 'acc-payable', supplier_payment: 'acc-payable', depreciation_run: 'acc-assets', asset_disposal: 'acc-assets',
  bank_deposit: 'acc-banking', rates_bill: 'acc-revenue', rates_receipt: 'acc-revenue', cash_receipt: 'acc-cashups',
}
const SOURCE_NAME: Record<VoucherSourceKind, string> = {
  supplier_invoice: 'Accounts Payable', supplier_payment: 'Accounts Payable', depreciation_run: 'Asset Register', asset_disposal: 'Asset Register',
  bank_deposit: 'Banking & Deposits', rates_bill: 'Revenue & Billing', rates_receipt: 'Revenue & Billing', cash_receipt: 'Cash-Up Approvals',
}
const hasAnalysis = computed(() => (data.value?.lines ?? []).some((l) => l.department_code || l.ward_code || l.project_id || l.programme_id || l.activity_id || l.budget_line_id))

async function post(): Promise<void> {
  const cur = v.value
  if (busy.value || !cur) return
  busy.value = true
  error.value = null
  notice.value = null
  try {
    // The voucher and the version are the ones on screen, so what is posted is what was reviewed.
    const done = await ledgerApi.postVoucher(cur.id, cur.version)
    if (id.value !== cur.id) return // the person has gone to another voucher: its page is not ours to write on
    await load()
    if (id.value !== cur.id) return
    notice.value = done.note || `Posted ${done.entries} entries to the ledger.`
    await focusNotice()
  } catch (err) {
    if (id.value !== cur.id) return
    const message = messageOf(err, 'The voucher could not be posted.')
    error.value = message
    // Changed, posted or cancelled meanwhile: read it again so the poster reviews what is there now.
    // Nothing is posted again until they choose to.
    if (isConflict(err)) await reread(message, error)
  } finally {
    busy.value = false
  }
}

async function reverse(reason: string): Promise<void> {
  const cur = v.value
  if (busy.value || !cur) return
  busy.value = true
  reverseError.value = null
  try {
    const done = await ledgerApi.reverseVoucher(cur.id, { reason, ...(reverseDate.value ? { posting_date: reverseDate.value } : {}) })
    if (id.value !== cur.id) return
    reversing.value = false
    await load()
    if (id.value !== cur.id) return
    notice.value = `${done.reversal.voucher_no} is a draft reversal of ${done.reversed}, and nothing has been posted. `
      + 'Somebody other than you posts it from To post; the original stays posted until then.'
    reversalId.value = done.reversal.id
    await focusNotice()
  } catch (err) {
    if (id.value !== cur.id) return
    const message = messageOf(err, 'The reversal could not be raised.')
    reverseError.value = message
    if (isConflict(err)) await reread(message, reverseError)
  } finally {
    busy.value = false
  }
}

function printPage(): void { window.print() }

async function discard(reason: string): Promise<void> {
  const cur = v.value
  if (busy.value || !cur) return
  busy.value = true
  discardError.value = null
  try {
    await ledgerApi.discardVoucher(cur.id, reason)
    if (id.value !== cur.id) return
    discarding.value = false
    await load()
    if (id.value !== cur.id) return
    notice.value = `${cur.voucher_no} is cancelled. It keeps its number and its lines on the record, and nothing was posted.`
    await focusNotice()
  } catch (err) {
    if (id.value !== cur.id) return
    const message = messageOf(err, 'The draft could not be cancelled.')
    discardError.value = message
    if (isConflict(err)) await reread(message, discardError)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="cw-pagehead no-print">
    <span class="cw-pagehead-icon"><FileText :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Voucher {{ v?.voucher_no ?? '' }}</h2>
      <p>One voucher, its lines and its history.</p>
    </div>
    <RouterLink :to="{ name: 'acc-journals' }" class="cw-btn"><ArrowLeft :size="18" aria-hidden="true" /> Journals</RouterLink>
  </section>

  <div ref="noticeEl" class="vp-notice no-print" role="status" tabindex="-1">
    <p v-if="notice" class="cw-banner-msg cw-banner-msg--pos"><CircleCheck :size="18" aria-hidden="true" />{{ notice }}
      <RouterLink v-if="reversalId" class="cw-link" :to="{ name: 'acc-voucher', params: { id: reversalId } }">Open the draft reversal</RouterLink></p>
  </div>
  <p v-if="data?.note && isCancelled" class="cw-banner-msg cw-banner-msg--info no-print"><Info :size="18" aria-hidden="true" />{{ data.note }}</p>
  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg no-print" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>

  <CwSkeleton v-if="loading" label="the voucher" />

  <template v-else-if="data && v">
    <!-- Actions -->
    <section class="cw-card no-print vp-actions" aria-label="Actions">
      <button v-if="canPost" type="button" class="cw-btn cw-btn--primary" :aria-disabled="busy || undefined" @click="post">Post</button>
      <p v-else-if="ownDraft" class="vp-say"><Info :size="16" aria-hidden="true" />You prepared this voucher, so somebody else posts it.</p>
      <p v-else-if="isDraft && !mayPost" class="vp-say"><Info :size="16" aria-hidden="true" />Holders of the posting permission post this voucher.</p>
      <RouterLink v-if="canEdit" :to="{ name: 'acc-journal-edit', params: { id } }" class="cw-btn"><Pencil :size="18" aria-hidden="true" /> Edit</RouterLink>
      <button v-if="canChange" ref="discardBtn" type="button" class="cw-btn cw-btn--danger" :aria-disabled="busy || undefined" @click="openDiscard"><Trash2 :size="18" aria-hidden="true" /> Cancel draft</button>
      <p v-if="notPreparer" class="vp-say"><Info :size="16" aria-hidden="true" />{{ notPreparerSentence }}</p>
      <p v-if="lostPrepare" class="vp-say"><Info :size="16" aria-hidden="true" />{{ store.whyUnavailable('finance.ledger.voucher.prepare') }}</p>
      <p v-if="isClosingDraft && own" class="vp-say"><Info :size="16" aria-hidden="true" />A year-end closing is built from the books, so it cannot be edited.
        <template v-if="canChange">Cancel it and raise the closing again from Period Close to change it.</template>
        <template v-else>You cannot cancel it: have it posted by someone else, or ask an administrator.</template></p>
      <p v-if="isReversalDraft && own" class="vp-say"><Info :size="16" aria-hidden="true" />A reversal keeps the reason and lines it was raised with, so it cannot be edited. Cancel it and raise the reversal again to change it.</p>
      <template v-if="canReverse">
        <div class="cw-field vp-date">
          <label class="cw-label" for="vp-rdate">Reversal date</label>
          <input id="vp-rdate" v-model="reverseDate" class="cw-input" type="date" />
        </div>
        <button ref="reverseBtn" type="button" class="cw-btn cw-btn--outline" :aria-disabled="busy || undefined" @click="openReverse"><Undo2 :size="18" aria-hidden="true" /> Reverse</button>
      </template>
      <RouterLink v-if="mayPrepare" :to="{ name: 'acc-journal-new', query: { from: id } }" class="cw-btn"><Copy :size="18" aria-hidden="true" /> Copy as a new draft</RouterLink>
      <button type="button" class="cw-btn" @click="printPage"><Printer :size="18" aria-hidden="true" /> Print</button>
      <p v-if="fromDocument && isDraft" class="vp-say"><Info :size="16" aria-hidden="true" />This voucher was raised by a document and is cancelled from that document.</p>
      <p v-if="pendingReversal" class="vp-say"><Info :size="16" aria-hidden="true" />A reversal, <RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: pendingReversal.id } }">{{ pendingReversal.voucher_no }}</RouterLink>, is waiting to be posted by somebody other than its preparer. Until then this voucher stays posted and cannot be reversed again.</p>
      <p v-if="v.status === 'posted' && !canReverse && !data.reversed_by" class="vp-say"><Info :size="16" aria-hidden="true" />A posted voucher is corrected by a reversal; holders of the reversal permission do that.</p>
    </section>

    <article class="cw-card vp-doc">
      <header class="vp-head">
        <p class="print-only vp-council">Vungu Rural District Council</p>
        <h3>{{ v.voucher_type === 'journal' ? 'Journal voucher' : VOUCHER_TYPE_LABEL[v.voucher_type] ?? v.voucher_type }} <span class="vp-no">{{ v.voucher_no }}</span>
          <span class="cw-pill no-print" :class="v.status === 'posted' ? 'cw-pill--pos' : v.status === 'draft' ? 'cw-pill--warn' : 'cw-pill--mute'">{{ v.status === 'posted' ? 'Posted' : v.status === 'draft' ? 'Draft' : 'Cancelled' }}</span></h3>
        <dl class="vp-meta">
          <div><dt>Date</dt><dd>{{ formatDate(v.posting_date) }}</dd></div>
          <div><dt>Period</dt><dd>{{ v.period_no ? `Period ${v.period_no} · ${v.period_label ?? ''}${v.period_status ? ` · ${v.period_status}` : ''}` : '—' }}</dd></div>
          <div><dt>Book</dt><dd>{{ v.currency }}</dd></div>
          <div><dt>Financial year</dt><dd>{{ v.financial_year_label }}</dd></div>
          <div><dt>Reference</dt><dd>{{ v.reference || '—' }}</dd></div>
          <div class="vp-wide"><dt>Narration</dt><dd>{{ v.narration || '—' }}</dd></div>
          <div v-if="v.reverses_voucher_no"><dt>Reverses</dt><dd><RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: v.reverses_voucher_id } }">{{ v.reverses_voucher_no }}</RouterLink></dd></div>
          <div v-if="postedReversal"><dt>Reversed by</dt><dd><RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: postedReversal.id } }">{{ postedReversal.voucher_no }}</RouterLink> on {{ formatDate(postedReversal.posting_date) }}</dd></div>
          <div v-if="pendingReversal"><dt>Reversal waiting</dt><dd><RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: pendingReversal.id } }">{{ pendingReversal.voucher_no }}</RouterLink> (draft, dated {{ formatDate(pendingReversal.posting_date) }})</dd></div>
          <div v-if="isCancelled" class="vp-wide"><dt>Cancelled</dt><dd>{{ v.cancelled_by_name ?? 'Unknown' }}<template v-if="v.cancelled_at"> · {{ formatDate(v.cancelled_at) }}</template>. Reason: {{ v.cancel_reason ?? 'none recorded' }}</dd></div>
          <div v-if="data.source"><dt>Raised from</dt><dd>
            <RouterLink class="cw-link" :to="{ name: SOURCE_PAGE[data.source.kind] }">{{ data.source.label }}</RouterLink>
            <span class="cw-hint"> in {{ SOURCE_NAME[data.source.kind] }}</span></dd></div>
        </dl>
      </header>

      <div class="cw-table-wrap">
        <table class="st-table" :aria-label="`Lines of ${v.voucher_no}`">
          <thead><tr>
            <th>#</th><th>Account</th><th>Party</th><th v-if="hasAnalysis">Analysis</th><th>Narration</th>
            <th class="st-num">Debit {{ v.currency }}</th><th class="st-num">Credit {{ v.currency }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="l in data.lines" :key="l.id">
              <td>{{ l.line_no }}</td>
              <td><RouterLink class="cw-link" :to="{ name: 'acc-account', params: { id: l.ledger_account_id } }">{{ l.account_code }}</RouterLink> {{ l.account_name }}</td>
              <td>{{ l.party_name ?? '—' }}</td>
              <td v-if="hasAnalysis">{{ [l.department_code, l.ward_code && `Ward ${l.ward_code}`].filter(Boolean).join(' · ') || '—' }}</td>
              <td>{{ l.narration ?? '' }}<template v-if="l.against_voucher_no"> Settles <RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: l.against_voucher_id } }">{{ l.against_voucher_no }}</RouterLink></template></td>
              <td class="st-num">{{ Number(l.debit) ? formatMoney(l.debit, v.currency, { bare: true }) : '' }}</td>
              <td class="st-num">{{ Number(l.credit) ? formatMoney(l.credit, v.currency, { bare: true }) : '' }}</td>
            </tr>
          </tbody>
          <tfoot v-if="totals">
            <tr class="st-total">
              <th :colspan="hasAnalysis ? 5 : 4" scope="row">Totals</th>
              <td class="st-num">{{ formatMoney(totals.debit_total, v.currency, { bare: true }) }}</td>
              <td class="st-num">{{ formatMoney(totals.credit_total, v.currency, { bare: true }) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p v-if="!data.balances" class="cw-banner-msg cw-banner-msg--neg no-print" role="alert"><AlertTriangle :size="18" aria-hidden="true" />This voucher does not balance, so it cannot be posted. The difference is {{ formatMoney(totals?.difference, v.currency) }}.</p>

      <section v-if="data.entries.length" class="vp-entries no-print" aria-label="Ledger entries">
        <h4>Ledger entries it produced</h4>
        <div class="cw-table-wrap">
          <table class="st-table">
            <thead><tr><th>Account</th><th>Posting date</th><th>Posted</th><th class="st-num">Debit {{ v.currency }}</th><th class="st-num">Credit {{ v.currency }}</th></tr></thead>
            <tbody>
              <tr v-for="e in data.entries" :key="e.id">
                <td>{{ e.account_code }}<span v-if="e.is_reversal" class="cw-hint"> reversal</span></td>
                <td>{{ formatDate(e.posting_date) }}</td><td>{{ formatDate(e.posted_at) }}</td>
                <td class="st-num">{{ Number(e.debit) ? formatMoney(e.debit, v.currency, { bare: true }) : '' }}</td>
                <td class="st-num">{{ Number(e.credit) ? formatMoney(e.credit, v.currency, { bare: true }) : '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <dl class="vp-meta vp-who">
        <div><dt>Prepared by</dt><dd>{{ v.prepared_by_name ?? '—' }} · {{ formatDate(v.prepared_at) }}</dd></div>
        <div><dt>Posted by</dt><dd>{{ v.posted_by_name ? `${v.posted_by_name} · ${v.posted_at ? formatDate(v.posted_at) : ''}` : isCancelled ? 'Not posted (cancelled)' : 'Not yet posted' }}</dd></div>
      </dl>

      <div class="vp-sign print-only" aria-hidden="true">
        <p>Prepared by</p><p>Posted by</p><p>Authorised</p>
      </div>
    </article>
  </template>

  <ReasonDialog v-if="reversing" :opener="reverseBtn" title="Raise a reversal" :message="`A reversal dated ${formatDate(reverseDate)} will be raised as a draft with the opposite entries. Nothing is posted until somebody other than you posts it. The original stays posted and on the record.`"
    label="Reason for the reversal" :min-length="10" :max-length="2000" submit-label="Raise reversal draft" danger :busy="busy" :error="reverseError" @submit="reverse" @close="reversing = false" />

  <ReasonDialog v-if="discarding" :opener="discardBtn" title="Cancel this draft" message="The draft keeps its number and its lines on the record, marked as cancelled with your name and the reason. It is not deleted and its number is not reused. This cannot be undone."
    label="Reason for cancelling" :min-length="3" :max-length="2000" submit-label="Cancel draft" danger :busy="busy" :error="discardError" @submit="discard" @close="closeDiscard" />
</template>

<style scoped>
.vp-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; padding: 14px 16px; margin-bottom: 12px; }
.vp-say { display: inline-flex; align-items: center; gap: 6px; margin: 0; color: var(--cw-ink-2); font-size: 13.5px; }
.vp-notice:focus { outline: none; }
.vp-notice:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 2px; }
.vp-date { min-width: 150px; }
.vp-doc { padding: 20px; }
.vp-head h3 { margin: 0 0 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.vp-no { font-variant-numeric: tabular-nums; }
.vp-council { margin: 0 0 4px; font-weight: 700; font-size: 16px; }
.vp-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px 20px; margin: 0 0 16px; }
.vp-meta dt { font-size: 12px; color: var(--cw-ink-2); }
.vp-meta dd { margin: 2px 0 0; font-weight: 600; overflow-wrap: anywhere; }
.vp-wide { grid-column: 1 / -1; }
.vp-entries { margin-top: 20px; }
.vp-entries h4 { margin: 0 0 8px; }
.vp-who { margin-top: 20px; }
.vp-sign { display: none; grid-template-columns: repeat(3, 1fr); gap: 32px; margin-top: 56px; }
.vp-sign p { margin: 0; border-top: 1px solid #000; padding-top: 6px; }
@media print { .vp-sign { display: grid !important; } .vp-doc { padding: 0; } }
</style>
