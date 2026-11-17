<script setup lang="ts">
/**
 * Period Close and the year end. The periods of the selected year are listed; choosing one reads its
 * readiness (what still stands in the way of closing it), all computed by the server. Closing a period
 * that is not ready asks first and lists what is outstanding; locking is final and always asks.
 * Once every period is closed the year-end card raises the closing of each book as a DRAFT; someone
 * other than its preparer posts it, and only a posted closing closes the book.
 * Figures are shown as the server sent them; the two books are never combined.
 */
import CwSkeleton from '../kit/CwSkeleton.vue'
import { computed, nextTick, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { AlertTriangle, CheckCircle2, CalendarCheck, Info, Lock, LockOpen } from 'lucide-vue-next'
import { ledgerApi } from '../../../api/ledgerApi'
import CwDialog from '../../shared/CwDialog.vue'
import { accountingApi } from '../../../api/accountingApi'
import type { PeriodReadiness, YearEnd } from '../../../api/accountingApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatMoney } from '../../../composables/useMoney'
import type { LedgerPeriod, LedgerPeriodStatus } from '../../../models/ledgerTypes'

const store = useFinanceStore()
const router = useRouter()

const periods = ref<LedgerPeriod[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const selectedId = ref<string | null>(null)
const readiness = ref<PeriodReadiness | null>(null)
const readyLoading = ref(false)
const readyError = ref<string | null>(null)
const yearEnd = ref<YearEnd | null>(null)
const yearLoading = ref(false)
const yearError = ref<string | null>(null)
const busy = ref(false)
const actionError = ref<string | null>(null)
const notice = ref<string | null>(null)
/** The draft a year-end close has just raised, linked from the notice. */
const raised = ref<{ id: string; voucher_no: string } | null>(null)
const noticeEl = ref<HTMLElement | null>(null)

const mayManage = computed(() => store.can('finance.ledger.period.manage'))
const mayCloseYear = computed(() => store.can('finance.ledger.close_year'))
const selected = computed(() => periods.value.find((p) => p.id === selectedId.value) ?? null)

const PILL: Record<LedgerPeriodStatus, [string, string]> = {
  open: ['cw-pill--pos', 'Open'], closed: ['cw-pill--warn', 'Closed'], locked: ['cw-pill--mute', 'Locked'],
}
const periodName = (p: { period_no: number; label: string | null }) => p.label || `Period ${p.period_no}`

let periodsSeq = 0
async function loadPeriods(): Promise<void> {
  const seq = ++periodsSeq
  if (!store.selectedYearId) { periods.value = []; loading.value = false; return }
  loading.value = true
  error.value = null
  try {
    const r = await ledgerApi.periods({ financial_year_id: store.selectedYearId })
    if (seq !== periodsSeq) return
    periods.value = r.periods
    if (!r.periods.some((p) => p.id === selectedId.value)) {
      // Default to the first period still open, else the first.
      selectedId.value = (r.periods.find((p) => p.status === 'open') ?? r.periods[0])?.id ?? null
    }
  } catch (err) {
    if (seq === periodsSeq) error.value = messageOf(err, 'The periods could not be loaded.')
  } finally {
    if (seq === periodsSeq) loading.value = false
  }
}

let readySeq = 0
async function loadReadiness(): Promise<void> {
  const seq = ++readySeq
  readiness.value = null
  readyError.value = null
  const id = selectedId.value
  if (!id) { readyLoading.value = false; return }
  readyLoading.value = true
  try {
    const r = await accountingApi.periodReadiness(id)
    if (seq === readySeq) readiness.value = r
  } catch (err) {
    if (seq === readySeq) readyError.value = messageOf(err, 'The readiness checks could not be loaded.')
  } finally {
    if (seq === readySeq) readyLoading.value = false
  }
}

let yearSeq = 0
async function loadYearEnd(): Promise<void> {
  const seq = ++yearSeq
  yearError.value = null
  if (!store.selectedYearId) { yearEnd.value = null; yearLoading.value = false; return }
  yearLoading.value = true
  try {
    const r = await accountingApi.yearEnd(store.selectedYearId)
    if (seq === yearSeq) yearEnd.value = r
  } catch (err) {
    if (seq === yearSeq) yearError.value = messageOf(err, 'The year-end position could not be loaded.')
  } finally {
    if (seq === yearSeq) yearLoading.value = false
  }
}

function loadAll(): void {
  selectedId.value = null
  yearEnd.value = null
  readiness.value = null
  void loadPeriods()
  void loadYearEnd()
}
watch(() => store.selectedYearId, loadAll, { immediate: true })
watch(selectedId, () => { void loadReadiness() })

function select(id: string): void { selectedId.value = id }

// ── Opening the periods ────────────────────────────────────────────────────────────────────────
async function openTwelve(): Promise<void> {
  if (busy.value || !store.selectedYearId) return
  busy.value = true
  actionError.value = null
  notice.value = null
  raised.value = null
  try {
    const r = await ledgerApi.openPeriods({ financial_year_id: store.selectedYearId, periodicity: 'monthly' })
    notice.value = r.note || 'The monthly periods are open.'
    await Promise.all([loadPeriods(), loadYearEnd()])
  } catch (err) {
    actionError.value = messageOf(err, 'The periods could not be opened.')
  } finally {
    busy.value = false
  }
}

// ── Status changes, with the confirmation dialog ───────────────────────────────────────────────
type Pending = 'close' | 'lock'
const pending = ref<Pending | null>(null)
// The confirmation is a CwDialog (alertdialog): focus starts on Back, stays inside, Esc is ignored
// while the change is in flight, and focus goes back to the button that asked.
const opener = ref<HTMLElement | null>(null)

/** What stands in the way, in words, for the confirmation. */
const outstanding = computed<string[]>(() => {
  const r = readiness.value
  if (!r) return ['The readiness checks could not be read, so nothing is known to be clear.']
  const out = r.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.count}`)
  for (const b of r.books) if (!b.balances) out.push(`The ${b.currency} book is out of balance by ${formatMoney(b.difference, b.currency)}`)
  return out
})

function openDialog(kind: Pending, e?: Event): void {
  if (busy.value) return
  opener.value = e?.currentTarget instanceof HTMLElement ? e.currentTarget : null
  actionError.value = null
  pending.value = kind
}
function closeDialog(): void {
  if (busy.value) return
  pending.value = null
}

async function setStatus(status: LedgerPeriodStatus): Promise<void> {
  const p = selected.value
  if (!p || busy.value) return
  busy.value = true
  actionError.value = null
  notice.value = null
  raised.value = null
  try {
    await ledgerApi.setPeriodStatus(p.id, status)
    pending.value = null
    const verb = status === 'open' ? 'reopened' : status === 'closed' ? 'closed' : 'locked'
    notice.value = `${periodName(p)} is ${verb}.`
    await Promise.all([loadPeriods(), loadReadiness(), loadYearEnd()])
  } catch (err) {
    actionError.value = messageOf(err, 'The period could not be changed.')
  } finally {
    busy.value = false
  }
}
function requestClose(e: Event): void {
  if (busy.value || readyLoading.value) return
  // A ready period closes at once; anything else is confirmed first.
  if (readiness.value?.ready) void setStatus('closed')
  else openDialog('close', e)
}
const confirm = () => setStatus(pending.value === 'lock' ? 'locked' : 'closed')

// ── Year end ───────────────────────────────────────────────────────────────────────────────────
const yearOpen = computed(() => !!yearEnd.value && yearEnd.value.periods_open > 0)
const showYearCard = computed(() => !!yearEnd.value && yearEnd.value.periods_open === 0 && periods.value.length > 0)
const closingBook = ref<string | null>(null)
async function closeBook(currency: 'USD' | 'ZWG'): Promise<void> {
  if (busy.value || !store.selectedYearId) return
  busy.value = true
  closingBook.value = currency
  actionError.value = null
  notice.value = null
  raised.value = null
  try {
    const r = await ledgerApi.closeYear({ financial_year_id: store.selectedYearId, currency })
    const v = r.closing_voucher
    raised.value = { id: v.id, voucher_no: v.voucher_no }
    notice.value = r.note || `Closing voucher ${v.voucher_no} is a draft, waiting to be posted by someone other than you.`
    await loadYearEnd()
    // Move focus to the notice (always mounted, tabindex -1) so the next step is read out.
    await nextTick()
    noticeEl.value?.focus({ preventScroll: true })
  } catch (err) {
    actionError.value = messageOf(err, `The ${currency} book could not be closed.`)
    // The page may be stale (someone else raised or posted a closing): read it again.
    void loadYearEnd()
    void loadPeriods()
  } finally {
    busy.value = false
    closingBook.value = null
  }
}
const has = (name: string) => router.hasRoute(name)
const posterCount = computed(() => yearEnd.value?.posters.length ?? 0)

/** A closing raised and waiting to be posted, by book. Shown even while a period is open again. */
const pendingBooks = computed(() => (yearEnd.value?.books ?? []).filter((b) => b.pending_closing))
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><CalendarCheck :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Period Close</h2>
      <p>Open and close the accounting periods. Nothing posts into a closed period.</p>
    </div>
  </section>

  <p v-if="!store.selectedYearId" class="cw-empty"><strong>Choose a financial year in the banner above.</strong>Periods belong to a financial year.</p>

  <template v-else>
    <p ref="noticeEl" tabindex="-1" role="status" :class="notice ? 'cw-banner-msg cw-banner-msg--pos' : 'sr-only'">
      <template v-if="notice"><CheckCircle2 :size="18" aria-hidden="true" />
        <span>{{ notice }}
          <template v-if="raised">
            <RouterLink v-if="has('acc-voucher')" :to="{ name: 'acc-voucher', params: { id: raised.id } }">Open {{ raised.voucher_no }}</RouterLink>
            <template v-else>{{ raised.voucher_no }}</template>
          </template></span></template></p>
    <p v-if="actionError && !pending" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ actionError }}</p>

    <CwSkeleton v-if="loading && !periods.length" label="the periods" />
    <p v-else-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
      <button type="button" class="cw-btn cw-btn--small" @click="loadPeriods">Retry</button></p>

    <section v-else-if="!periods.length" class="cw-card">
      <div class="cw-card-body" style="padding-top: 16px">
        <p class="cw-empty"><strong>This year has no accounting periods yet.</strong>
          <template v-if="mayManage">Nothing can post until they are open.</template>
          <template v-else>Nothing can post until they are open. Opening them is reserved to roles holding "Manage accounting periods"; ask your finance director.</template>
        </p>
        <button v-if="mayManage" type="button" class="cw-btn cw-btn--primary" :aria-disabled="busy || undefined" @click="openTwelve">Open the twelve monthly periods</button>
      </div>
    </section>

    <template v-else>
      <section class="cw-card">
        <header class="cw-card-head"><h3>Periods <small>{{ store.selectedYear?.label }}</small></h3></header>
        <div class="cw-card-body">
          <div class="cw-table-wrap">
            <table class="cw-table">
              <caption class="sr-only">Accounting periods of the selected year</caption>
              <thead><tr><th scope="col">No.</th><th scope="col">Period</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Status</th><th scope="col" class="r">Entries</th><th scope="col"><span class="sr-only">Select</span></th></tr></thead>
              <tbody>
                <tr v-for="p in periods" :key="p.id" :class="{ 'is-selected': p.id === selectedId }">
                  <td>{{ p.period_no }}</td>
                  <td>{{ periodName(p) }}</td>
                  <td>{{ formatDate(p.from_date) }}</td>
                  <td>{{ formatDate(p.to_date) }}</td>
                  <td><span class="cw-pill" :class="PILL[p.status][0]">{{ PILL[p.status][1] }}</span></td>
                  <td class="r">{{ p.entry_count }}</td>
                  <td><button type="button" class="cw-btn cw-btn--small" :aria-pressed="p.id === selectedId" :aria-label="`Check ${periodName(p)}`" @click="select(p.id)">Check</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section v-if="selected" class="cw-card" aria-labelledby="pc-ready-h">
        <header class="cw-card-head"><h3 id="pc-ready-h">{{ periodName(selected) }} <small>{{ formatDate(selected.from_date) }} to {{ formatDate(selected.to_date) }}</small></h3></header>
        <div class="cw-card-body">
          <div v-if="readyLoading" aria-busy="true"><span class="cw-skel" /><span class="cw-skel" /></div>
          <p v-else-if="readyError" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ readyError }}
            <button type="button" class="cw-btn cw-btn--small" @click="loadReadiness">Retry</button></p>
          <template v-else-if="readiness">
            <p v-if="readiness.ready" class="cw-banner-msg cw-banner-msg--pos"><CheckCircle2 :size="18" aria-hidden="true" />Ready to close. Every check is clear and the books balance.</p>
            <p v-else class="cw-banner-msg cw-banner-msg--warn"><AlertTriangle :size="18" aria-hidden="true" />Not ready to close. Something is outstanding below.</p>
            <p v-if="readiness.as_at" class="pc-detail">Debtor and creditor control checks compare the whole book as at {{ formatDate(readiness.as_at) }}.</p>
            <ul class="pc-checks">
              <li v-for="c in readiness.checks" :key="c.key">
                <span class="cw-pill" :class="c.ok ? 'cw-pill--pos' : 'cw-pill--warn'">{{ c.ok ? 'Clear' : 'Outstanding' }}</span>
                <span class="pc-label">{{ c.label }}</span>
                <strong class="pc-count">{{ c.count }}</strong>
                <span v-if="c.detail" class="pc-detail">{{ c.detail }}</span>
                <template v-if="c.target && !c.ok">
                  <RouterLink v-if="has(c.target)" :to="{ name: c.target }">Go and clear it</RouterLink>
                </template>
              </li>
            </ul>
            <ul class="pc-checks">
              <li v-for="b in readiness.books" :key="b.currency">
                <span class="cw-pill" :class="b.balances ? 'cw-pill--pos' : 'cw-pill--neg'">{{ b.balances ? 'In balance' : 'Out of balance' }}</span>
                <span class="pc-label">{{ b.currency }} book</span>
                <span v-if="!b.balances" class="pc-detail">Difference {{ formatMoney(b.difference, b.currency) }}</span>
              </li>
            </ul>
          </template>

          <div v-if="mayManage" class="pc-actions">
            <button v-if="selected.status === 'open'" type="button" class="cw-btn cw-btn--primary" :aria-disabled="busy || readyLoading || undefined" @click="requestClose"><Lock :size="16" aria-hidden="true" /> Close period</button>
            <template v-if="selected.status === 'closed'">
              <button v-if="!selected.reopen_refusal" type="button" class="cw-btn" :aria-disabled="busy || undefined" @click="setStatus('open')"><LockOpen :size="16" aria-hidden="true" /> Reopen period</button>
              <button v-if="!selected.lock_refusal" type="button" class="cw-btn cw-btn--danger" :aria-disabled="busy || undefined" @click="openDialog('lock', $event)"><Lock :size="16" aria-hidden="true" /> Lock period</button>
            </template>
            <p v-if="selected.status === 'closed' && selected.reopen_refusal" class="pc-say"><Info :size="16" aria-hidden="true" />{{ selected.reopen_refusal.message }}</p>
            <p v-if="selected.status === 'closed' && selected.lock_refusal" class="pc-say"><Info :size="16" aria-hidden="true" />{{ selected.lock_refusal.message }}</p>
            <p v-if="selected.status === 'locked'" class="pc-say"><Info :size="16" aria-hidden="true" />This period is locked. A locked period is final and cannot be reopened.</p>
          </div>
          <p v-else class="pc-say"><Info :size="16" aria-hidden="true" />Closing, reopening and locking periods is reserved to roles holding "Manage accounting periods".</p>
        </div>
      </section>

      <p v-if="yearLoading && !yearEnd" aria-busy="true"><span class="cw-skel" /></p>
      <p v-else-if="yearError" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ yearError }}
        <button type="button" class="cw-btn cw-btn--small" @click="loadYearEnd">Retry</button></p>
      <p v-else-if="yearOpen" class="pc-say"><Info :size="16" aria-hidden="true" />Close every period first. The year end can be raised once none is open.</p>
      <p v-for="b in (yearOpen ? pendingBooks : [])" :key="`pend-${b.currency}`" class="pc-say"><Info :size="16" aria-hidden="true" /><span>
        <RouterLink v-if="b.pending_closing && has('acc-voucher')" :to="{ name: 'acc-voucher', params: { id: b.pending_closing.id } }">{{ b.pending_closing.voucher_no }}</RouterLink>
        <template v-else>{{ b.pending_closing?.voucher_no }}</template>
        is a year-end closing of the {{ b.currency }} book waiting to be posted. It can be posted only once every period is closed again.</span></p>

      <section v-if="showYearCard && yearEnd" class="cw-card" aria-labelledby="pc-year-h">
        <header class="cw-card-head"><h3 id="pc-year-h">Year end <small>{{ yearEnd.year.label }}</small></h3></header>
        <div class="cw-card-body">
          <p v-if="!mayCloseYear" class="pc-say"><Info :size="16" aria-hidden="true" />Closing the year is reserved to roles holding "Close the financial year". {{ store.whyUnavailable('finance.ledger.close_year') }}</p>
          <template v-else>
            <p v-if="!yearEnd.surplus_account" class="cw-banner-msg cw-banner-msg--warn"><AlertTriangle :size="18" aria-hidden="true" />
              <span>Mark the equity account that carries accumulated surplus.
                <RouterLink v-if="has('acc-ledger')" :to="{ name: 'acc-ledger' }">Open the Chart of Accounts</RouterLink></span></p>
            <p v-else class="pc-say">The result of each book is carried to {{ yearEnd.surplus_account.code }} {{ yearEnd.surplus_account.name }}.</p>
            <p v-if="!posterCount" class="pc-say"><Info :size="16" aria-hidden="true" />There is nobody else who may post, so nobody could post a closing you raise. Ask for a second person to be given the right to post vouchers.</p>
            <p v-else class="pc-say"><Info :size="16" aria-hidden="true" />Closing a book raises a draft. Someone other than you must post it: {{ posterCount }} {{ posterCount === 1 ? 'person' : 'people' }} may.</p>
          </template>

          <ul class="pc-books">
            <li v-for="b in yearEnd.books" :key="b.currency">
              <h4>{{ b.currency }} book</h4>
              <dl>
                <div><dt>Revenue</dt><dd>{{ formatMoney(b.revenue, b.currency) }}</dd></div>
                <div><dt>Expenditure</dt><dd>{{ formatMoney(b.expenditure, b.currency) }}</dd></div>
                <div><dt>{{ b.side === 'surplus' ? 'Surplus' : 'Deficit' }}</dt><dd>{{ formatMoney(b.surplus, b.currency) }}</dd></div>
              </dl>
              <p v-if="b.closed" class="cw-pill cw-pill--pos"><CheckCircle2 :size="14" aria-hidden="true" />Closed
                <template v-if="b.closing_voucher">by
                  <RouterLink v-if="has('acc-voucher')" :to="{ name: 'acc-voucher', params: { id: b.closing_voucher.id } }">{{ b.closing_voucher.voucher_no }}</RouterLink>
                  <template v-else>{{ b.closing_voucher.voucher_no }}</template></template></p>
              <p v-else-if="b.pending_closing" class="pc-say"><Info :size="16" aria-hidden="true" /><span>
                <RouterLink v-if="has('acc-voucher')" :to="{ name: 'acc-voucher', params: { id: b.pending_closing.id } }">{{ b.pending_closing.voucher_no }}</RouterLink>
                <template v-else>{{ b.pending_closing.voucher_no }}</template><template v-if="b.pending_closing.prepared_by_name">, prepared by {{ b.pending_closing.prepared_by_name }},</template>
                is waiting to be posted by someone else. The book is not closed until it is posted.</span></p>
              <template v-else>
                <p v-if="b.closing_voucher && b.to_close" class="pc-say"><Info :size="16" aria-hidden="true" /><span>A remainder is left after
                  <RouterLink v-if="has('acc-voucher')" :to="{ name: 'acc-voucher', params: { id: b.closing_voucher.id } }">{{ b.closing_voucher.voucher_no }}</RouterLink>
                  <template v-else>{{ b.closing_voucher.voucher_no }}</template>: {{ b.side === 'surplus' ? 'surplus' : 'deficit' }} {{ formatMoney(b.surplus, b.currency) }}.</span></p>
                <p v-else-if="!b.to_close" class="pc-say"><Info :size="16" aria-hidden="true" />Nothing is left to close in this book.</p>
                <button v-if="b.to_close && mayCloseYear && yearEnd.surplus_account && posterCount" type="button" class="cw-btn cw-btn--primary" :aria-disabled="busy || undefined" @click="closeBook(b.currency)">{{ b.closing_voucher ? 'Close the remainder' : `Close the ${b.currency} book` }}</button>
              </template>
            </li>
          </ul>
        </div>
      </section>
    </template>
  </template>

  <CwDialog v-if="pending" role="alertdialog" :title="pending === 'lock' ? 'Lock this period' : 'This period is not ready'" :busy="busy" :opener="opener" @close="closeDialog">
    <template #describe>
      <p v-if="pending === 'lock'">Locking is final. A locked period can never be reopened.</p>
      <template v-else>
        <p>These are outstanding. You can still close the period and clear them later by reopening it.</p>
        <ul style="margin: 0"><li v-for="o in outstanding" :key="o">{{ o }}</li></ul>
      </template>
    </template>
    <p v-if="actionError" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ actionError }}</p>
    <template #footer>
      <button type="button" class="cw-btn" data-autofocus :aria-disabled="busy || undefined" @click="closeDialog">Back</button>
      <button type="button" class="cw-btn cw-btn--danger" :aria-disabled="busy || undefined" @click="confirm">{{ pending === 'lock' ? 'Lock period' : 'Close anyway' }}</button>
    </template>
  </CwDialog>
</template>

<style scoped>
.pc-checks { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
.pc-checks li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.pc-label { flex: 1; min-width: 12rem; }
.pc-count { font-variant-numeric: tabular-nums; min-width: 2ch; text-align: right; }
.pc-detail { color: var(--cw-ink-2); font-size: 13px; }
.pc-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 16px; }
.pc-say { display: flex; align-items: flex-start; gap: 6px; margin: 12px 0 0; color: var(--cw-ink-2); font-size: 13.5px; }
.pc-say svg { flex: none; margin-top: 2px; }
.pc-books { list-style: none; margin: 14px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
.pc-books li { border: 1px solid var(--cw-card-line); border-radius: 8px; padding: 12px; display: grid; gap: 10px; align-content: start; }
.pc-books h4 { margin: 0; }
.pc-books dl { margin: 0; display: grid; gap: 4px; }
.pc-books dl div { display: flex; justify-content: space-between; gap: 10px; }
.pc-books dt { color: var(--cw-ink-2); }
.pc-books dd { margin: 0; font-weight: 700; font-variant-numeric: tabular-nums; }
</style>
