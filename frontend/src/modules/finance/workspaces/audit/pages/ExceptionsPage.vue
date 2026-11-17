<script setup lang="ts">
/**
 * Exceptions and segregation of duties: tests the internal auditor re-performs over the council's
 * own records, each with the population it read and what it found.
 *
 *   Duties    a posted voucher's poster against its preparer (ledger, selected year); a verified
 *             cash-up's verifier against its cashier; a published release's publisher against its
 *             approver. The first two are enforced by the database, so an exception is a control
 *             failure; "none found" is evidence over the population read.
 *   Cash-ups  verified or closed cash-ups whose declared total differs from the system total.
 *   Trail     refused attempts by person and module, and changes made outside the working day,
 *             in the chosen window.
 *
 * Every test compares people, times or the server's own variance text; none adds money. Nothing
 * here writes.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ShieldAlert, Users, Banknote, Clock, AlertTriangle, CircleCheck } from 'lucide-vue-next'
import { ledgerApi } from '../../../api/ledgerApi'
import { cashApi } from '../../../api/cashApi'
import { auditApi, TRAIL_MODULES, type TrailEvent } from '../../../api/auditApi'
import { publicationApi, type PublicationRecord } from '../../../api/publicationApi'
import type { VoucherSummary } from '../../../models/ledgerTypes'
import type { CashierSession } from '../../../models/cashTypes'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatDateTime, formatMoney } from '../../../composables/useMoney'
import { DATASET } from '../../publisher/dashboard'
import { cashUpsWithVariance, changesOutsideHours, refusalsByPerson, sameCashUpHands, samePublicationHands, sameVoucherHands } from '../exceptions'

const store = useFinanceStore()
const PAGE = 200
const MAX_PAGES = 10
const TRAIL_CAP = 1000

interface Test<T> { loading: boolean; error: string | null; read: number; capped: boolean; rows: T[]; ran: boolean }
const blank = <T,>(): Test<T> => ({ loading: false, error: null, read: 0, capped: false, rows: [], ran: false })

const vouchers = reactive(blank<VoucherSummary>())
const cashups = reactive(blank<CashierSession>())
const releases = reactive(blank<PublicationRecord>())
const trail = reactive(blank<TrailEvent>())

const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const windowDays = ref(30)

async function run<T>(t: Test<T>, read: () => Promise<{ rows: T[]; capped: boolean }>, message: string): Promise<void> {
  t.loading = true
  t.error = null
  try {
    const r = await read()
    t.rows = r.rows as never
    t.read = r.rows.length
    t.capped = r.capped
    t.ran = true
  } catch (err) { t.error = messageOf(err, message) } finally { t.loading = false }
}

async function readVouchers() {
  const rows: VoucherSummary[] = []
  for (let p = 0; p < MAX_PAGES; p++) {
    const r = await ledgerApi.vouchers({ financial_year_id: store.selectedYearId ?? undefined, status: 'posted', limit: PAGE, offset: p * PAGE })
    rows.push(...r.vouchers)
    if (rows.length >= r.total || r.vouchers.length < PAGE) return { rows, capped: false }
  }
  return { rows, capped: true }
}
async function readCashups() {
  const rows: CashierSession[] = []
  for (const status of ['verified', 'closed'] as const) {
    for (let p = 0; p < MAX_PAGES; p++) {
      const r = await cashApi.sessions({ status, limit: PAGE, offset: p * PAGE })
      rows.push(...r.sessions)
      if (r.sessions.length < PAGE) break
      if (p === MAX_PAGES - 1) return { rows, capped: true }
    }
  }
  return { rows, capped: false }
}
async function readReleases() {
  const r = await publicationApi.all()
  return { rows: r.rows.filter((p) => p.published_at), capped: r.truncated }
}
async function readTrail() {
  const r = await auditApi.trail({ from: daysAgo(windowDays.value), limit: TRAIL_CAP })
  return { rows: r.events, capped: r.events.length >= TRAIL_CAP }
}

const canLedger = computed(() => store.can('finance.ledger.view'))
const canCash = computed(() => store.can('finance.cash.view'))
const canTrail = computed(() => store.can('finance.audit.view'))

function loadYearTests(): void {
  if (canLedger.value && store.selectedYearId) void run(vouchers, readVouchers, 'The posted vouchers could not be read.')
}
onMounted(() => {
  loadYearTests()
  if (canCash.value) void run(cashups, readCashups, 'The cash-ups could not be read.')
  void run(releases, readReleases, 'The publication record could not be read.')
  if (canTrail.value) void run(trail, readTrail, 'The audit trail could not be read.')
})
watch(() => store.selectedYearId, loadYearTests)
watch(windowDays, () => { if (canTrail.value) void run(trail, readTrail, 'The audit trail could not be read.') })

const voucherEx = computed(() => sameVoucherHands(vouchers.rows))
const cashEx = computed(() => sameCashUpHands(cashups.rows.filter((s) => s.status === 'verified')))
const cashVerified = computed(() => cashups.rows.filter((s) => s.status === 'verified').length)
const variances = computed(() => cashUpsWithVariance(cashups.rows))
const releaseEx = computed(() => samePublicationHands(releases.rows))
const refusals = computed(() => refusalsByPerson(trail.rows))
const afterHours = computed(() => changesOutsideHours(trail.rows))
const moduleName = (id: string) => TRAIL_MODULES.find((m) => m.id === id)?.label ?? id
const capNote = (t: Test<unknown>) => (t.capped ? ` The read stopped at ${t.read}; the population is larger.` : '')
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><ShieldAlert :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Exceptions and Duties</h2>
      <p>Tests re-performed over the council's own records. Each states the population it read and what it found.</p>
    </div>
  </section>

  <!-- Segregation of duties -->
  <section class="cw-card" aria-labelledby="ex-sod">
    <div class="cw-card-head"><h3 id="ex-sod"><Users :size="24" class="cw-head-icon" aria-hidden="true" /> Segregation of duties</h3></div>
    <div class="cw-card-body">
      <table class="cw-table dx-compact">
        <caption class="sr-only">Segregation of duties tests</caption>
        <thead><tr><th scope="col">Test</th><th scope="col" class="r">Read</th><th scope="col" class="r">Exceptions</th><th scope="col">Result</th></tr></thead>
        <tbody>
          <tr>
            <td class="dx-wrap">Posted vouchers posted by the person who prepared them<div class="cw-hint">{{ store.selectedYear?.label ?? 'Selected year' }}. Enforced by the database.</div></td>
            <template v-if="!canLedger"><td colspan="3" class="cw-hint">Needs finance.ledger.view.</td></template>
            <template v-else-if="!store.selectedYearId"><td colspan="3" class="cw-hint">Choose a financial year.</td></template>
            <template v-else-if="vouchers.loading"><td colspan="3"><span class="cw-skel" /></td></template>
            <template v-else-if="vouchers.error"><td colspan="3" class="cw-neg" role="alert">{{ vouchers.error }}</td></template>
            <template v-else>
              <td class="r num">{{ vouchers.read }}</td><td class="r num">{{ voucherEx.length }}</td>
              <td><span class="cw-pill" :class="voucherEx.length ? 'cw-pill--neg' : 'cw-pill--pos'">{{ voucherEx.length ? 'Control failed' : 'None found' }}</span><span class="cw-hint">{{ capNote(vouchers) }}</span></td>
            </template>
          </tr>
          <tr>
            <td class="dx-wrap">Verified cash-ups verified by their own cashier<div class="cw-hint">All years. Enforced by the database.</div></td>
            <template v-if="!canCash"><td colspan="3" class="cw-hint">Needs finance.cash.view.</td></template>
            <template v-else-if="cashups.loading"><td colspan="3"><span class="cw-skel" /></td></template>
            <template v-else-if="cashups.error"><td colspan="3" class="cw-neg" role="alert">{{ cashups.error }}</td></template>
            <template v-else>
              <td class="r num">{{ cashVerified }}</td><td class="r num">{{ cashEx.length }}</td>
              <td><span class="cw-pill" :class="cashEx.length ? 'cw-pill--neg' : 'cw-pill--pos'">{{ cashEx.length ? 'Control failed' : 'None found' }}</span><span class="cw-hint">{{ capNote(cashups) }}</span></td>
            </template>
          </tr>
          <tr>
            <td class="dx-wrap">Releases published by the person who approved them<div class="cw-hint">All years. Separated only when the council's setting requires it.</div></td>
            <template v-if="releases.loading"><td colspan="3"><span class="cw-skel" /></td></template>
            <template v-else-if="releases.error"><td colspan="3" class="cw-neg" role="alert">{{ releases.error }}</td></template>
            <template v-else>
              <td class="r num">{{ releases.read }}</td><td class="r num">{{ releaseEx.length }}</td>
              <td><span class="cw-pill" :class="releaseEx.length ? 'cw-pill--warn' : 'cw-pill--pos'">{{ releaseEx.length ? 'Review' : 'None found' }}</span><span class="cw-hint">{{ capNote(releases) }}</span></td>
            </template>
          </tr>
        </tbody>
      </table>

      <div v-if="voucherEx.length" class="ex-list">
        <h4>Vouchers posted by their preparer</h4>
        <ul><li v-for="v in voucherEx" :key="v.id">{{ v.voucher_no }} · {{ formatDate(v.posting_date) }} · {{ v.prepared_by_name ?? v.prepared_by }}
          <RouterLink :to="{ name: 'aud-trail', query: { entity_id: v.id, from: '' } }" class="cw-link">Trail</RouterLink></li></ul>
      </div>
      <div v-if="cashEx.length" class="ex-list">
        <h4>Cash-ups verified by their cashier</h4>
        <ul><li v-for="s in cashEx" :key="s.id">{{ s.session_no }} · {{ formatDate(s.business_date) }} · {{ s.cashier_name }}
          <RouterLink :to="{ name: 'aud-trail', query: { entity_id: s.id, from: '' } }" class="cw-link">Trail</RouterLink></li></ul>
      </div>
      <div v-if="releaseEx.length" class="ex-list">
        <h4>Releases approved and published by one person</h4>
        <ul><li v-for="p in releaseEx" :key="p.id">{{ DATASET[p.dataset] ?? p.dataset }} v{{ p.version }} · {{ (p.financial_year_label ?? '').split(' (')[0] }} · {{ p.published_by_name ?? '—' }} on {{ formatDate(p.published_at) }}
          <RouterLink :to="{ name: 'aud-trail', query: { entity_id: p.id, from: '' } }" class="cw-link">Trail</RouterLink></li></ul>
      </div>
    </div>
  </section>

  <!-- Cash-up variances -->
  <section v-if="canCash" class="cw-card" aria-labelledby="ex-var">
    <div class="cw-card-head"><h3 id="ex-var"><Banknote :size="24" class="cw-head-icon" aria-hidden="true" /> Cash-ups with a difference</h3></div>
    <div class="cw-card-body cw-table-wrap">
      <div v-if="cashups.loading"><span class="cw-skel" /></div>
      <p v-else-if="cashups.error" class="cw-empty">The cash-ups could not be read.</p>
      <p v-else-if="!variances.length" class="cw-empty">No closed or verified cash-up declared a total different from the system's ({{ cashups.read }} read).</p>
      <table v-else class="cw-table dx-compact">
        <caption class="sr-only">Cash-ups whose declared total differs from the system total</caption>
        <thead><tr><th scope="col">Session</th><th scope="col">Date</th><th scope="col">Cashier</th><th scope="col">Status</th><th scope="col" class="r">Difference</th><th scope="col">Explanation</th><th scope="col">Verified by</th></tr></thead>
        <tbody>
          <template v-for="s in variances" :key="s.id">
            <tr v-for="c in s.counts.filter((x) => x.variance && !/^[-+]?0*(\.0*)?$/.test(x.variance))" :key="s.id + c.currency">
              <td>{{ s.session_no }}</td><td>{{ formatDate(s.business_date) }}</td><td>{{ s.cashier_name }}</td>
              <td>{{ s.status === 'verified' ? 'Verified' : 'Awaiting verification' }}</td>
              <td class="r num">{{ formatMoney(c.variance, c.currency) }}</td>
              <td class="dx-wrap">{{ c.explanation ?? '—' }}</td><td>{{ s.verified_by_name ?? '—' }}</td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </section>

  <!-- Trail analytics -->
  <section v-if="canTrail" class="cw-card" aria-labelledby="ex-tr">
    <div class="cw-card-head"><h3 id="ex-tr"><Clock :size="24" class="cw-head-icon" aria-hidden="true" /> From the audit trail</h3><span class="cw-spacer" />
      <label class="ex-window"><span>Window</span>
        <select v-model.number="windowDays" class="cw-input"><option :value="7">7 days</option><option :value="30">30 days</option><option :value="90">90 days</option></select></label>
    </div>
    <div class="cw-card-body cw-table-wrap">
      <div v-if="trail.loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="trail.error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ trail.error }}</p>
      <template v-else-if="trail.ran">
        <p class="dx-note">{{ trail.read }} trail entries read for the last {{ windowDays }} days.{{ trail.capped ? ' The read stopped at the server limit; narrow the window or use the Audit Trail for the rest.' : '' }}</p>
        <h4 class="ex-h">Refused attempts by person</h4>
        <p v-if="!refusals.length" class="cw-empty"><CircleCheck :size="16" aria-hidden="true" /> No refused attempt in the window.</p>
        <table v-else class="cw-table dx-compact">
          <caption class="sr-only">Refused attempts grouped by person and module</caption>
          <thead><tr><th scope="col">Person</th><th scope="col">Module</th><th scope="col" class="r">Refusals</th><th scope="col">Latest</th><th scope="col"><span class="sr-only">Open</span></th></tr></thead>
          <tbody><tr v-for="g in refusals" :key="g.actor + g.event">
            <td class="dx-wrap">{{ g.actor }}<div v-if="g.role" class="cw-hint">{{ g.role }}</div></td><td>{{ moduleName(g.event) }}</td>
            <td class="r num">{{ g.count }}</td><td>{{ formatDateTime(g.last) }}</td>
            <td><RouterLink :to="{ name: 'aud-trail', query: { ...(g.actor_id ? { actor: g.actor_id } : {}), module: g.event, outcome: 'refused', from: daysAgo(windowDays) } }" class="cw-link">Open in trail</RouterLink></td>
          </tr></tbody>
        </table>

        <h4 class="ex-h">Changes outside the working day</h4>
        <p class="cw-hint">Weekends, and before 07:00 or from 18:00 local time. Not wrong in itself; worth a look.</p>
        <p v-if="!afterHours.length" class="cw-empty">No change was made outside the working day in the window.</p>
        <table v-else class="cw-table dx-compact">
          <caption class="sr-only">Changes made outside the working day</caption>
          <thead><tr><th scope="col">When</th><th scope="col">Person</th><th scope="col">Module</th><th scope="col">Request</th></tr></thead>
          <tbody><tr v-for="e in afterHours.slice(0, 100)" :key="e.id">
            <td>{{ formatDateTime(e.occurred_at) }}</td><td>{{ e.actor_email ?? '—' }}</td><td>{{ moduleName(e.event) }}</td>
            <td class="dx-wrap ex-mono">{{ e.method }} {{ e.path }}</td>
          </tr></tbody>
        </table>
        <p v-if="afterHours.length > 100" class="dx-note">The first 100 of {{ afterHours.length }} are listed.</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.ex-list { margin-top: 14px; }
.ex-list h4, .ex-h { margin: 16px 0 6px; font-size: 14.5px; }
.ex-list ul { margin: 0; padding-left: 18px; }
.ex-list li { margin: 3px 0; }
.ex-list .cw-link { margin-left: 8px; }
.ex-window { display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
.ex-window .cw-input { padding-top: 4px; padding-bottom: 4px; }
.ex-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
</style>
