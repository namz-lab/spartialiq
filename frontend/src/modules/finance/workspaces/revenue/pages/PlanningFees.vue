<script setup lang="ts">
/**
 * Planning fees (migration 246): every fee the council received for a planning application, at the
 * cash office or online, and where each stands on its way to the ledger.
 *
 *   awaiting a voucher   paid online; a revenue officer prepares its voucher here
 *   awaiting posting     a draft: a counter receipt waits for its cash-up to be verified, an online
 *                        fee's voucher waits for somebody else to post it
 *   posted               in the ledger
 *   cancelled            a counter receipt cancelled with a reason
 *
 * "Prepare vouchers" raises drafts in the caller's name; the database refuses to let the same person
 * post them. A fee that cannot be prepared stays waiting, and the reason is shown.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { Landmark, RefreshCw, FilePlus2, AlertTriangle, CircleCheck } from 'lucide-vue-next'
import { planningFeesApi, type PlanningFee, type PlanningFeeState, type PlanningFeeSummary } from '../../../api/planningFeesApi'
import { planningFeeLabel } from '../../../models/cashTypes'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney } from '../../../composables/useMoney'

const store = useFinanceStore()
const canPrepare = computed(() => store.can('finance.planning_fees.prepare'))

const STATES: { value: PlanningFeeState | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'awaiting_voucher', label: 'Awaiting a voucher' },
  { value: 'awaiting_posting', label: 'Awaiting posting' },
  { value: 'posted', label: 'Posted' },
  { value: 'cancelled', label: 'Cancelled' },
]
const stateLabel = (s: string) => STATES.find((x) => x.value === s)?.label ?? s
const stateTone = (s: string) => ({ awaiting_voucher: 'cw-pill--neg', awaiting_posting: 'cw-pill--warn', posted: 'cw-pill--pos', cancelled: 'cw-pill--mute' } as Record<string, string>)[s] ?? ''

const state = ref<PlanningFeeState | ''>('')
const q = ref('')
const fees = ref<PlanningFee[]>([])
const total = ref(0)
const summary = ref<PlanningFeeSummary[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const waiting = ref<{ planning_fee_id: string; reason: string }[]>([])

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const r = await planningFeesApi.list({ ...(state.value ? { state: state.value } : {}), ...(q.value.trim() ? { q: q.value.trim() } : {}), limit: 100 })
    fees.value = r.fees
    total.value = r.total
    summary.value = r.summary
  } catch (err) {
    error.value = messageOf(err, 'The planning fees could not be read.')
  } finally {
    loading.value = false
  }
}
let timer: ReturnType<typeof setTimeout> | undefined
watch(q, () => { clearTimeout(timer); timer = setTimeout(load, 300) })
watch(state, load)
onMounted(load)

const awaitingVoucher = computed(() => summary.value.filter((s) => s.state === 'awaiting_voucher').reduce((n, s) => n + s.n, 0))
/** The head's figures: per state and currency, never summed across currencies (D4). */
const tiles = computed(() => ['awaiting_voucher', 'awaiting_posting', 'posted'].map((s) => ({
  state: s,
  label: stateLabel(s),
  rows: summary.value.filter((x) => x.state === s),
})))

async function prepare(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  notice.value = null
  try {
    const r = await planningFeesApi.prepare()
    waiting.value = r.waiting
    notice.value = r.prepared.length
      ? `${r.prepared.length} voucher${r.prepared.length === 1 ? '' : 's'} prepared (${r.prepared.map((p) => p.voucher_no).join(', ')}). They reach the ledger when somebody else posts them.`
      : 'No voucher could be prepared.'
    await load()
  } catch (err) {
    error.value = messageOf(err, 'The vouchers could not be prepared.')
  } finally {
    busy.value = false
  }
}
const reasonFor = (id: string) => waiting.value.find((w) => w.planning_fee_id === id)?.reason
const appRef = (f: PlanningFee) => f.tpd_reference || f.dev_register_no || (f.stand_number ? `Stand ${f.stand_number}` : null)
const DRIVER_LABEL: Record<string, string> = { manual: 'Manual (test)', paynow: 'Paynow', stripe: 'Stripe', ecocash: 'EcoCash', onemoney: 'OneMoney' }
const sourceText = (f: PlanningFee) => (f.source === 'counter' ? `Cash office · ${f.method?.replace(/_/g, ' ') ?? ''}` : `Online · ${DRIVER_LABEL[f.driver ?? ''] ?? f.driver ?? ''}`)
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Landmark :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Planning Fees</h2>
      <p>Fees paid for planning applications, at the cash office or online, and where each stands on its way to the ledger.</p>
    </div>
    <button type="button" class="cw-btn cw-btn--outline" :disabled="loading" @click="load"><RefreshCw :size="18" aria-hidden="true" /> Refresh</button>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
  <p v-if="notice" class="cw-banner-msg cw-banner-msg--pos" role="status"><CircleCheck :size="18" aria-hidden="true" />{{ notice }}</p>

  <div class="pf-tiles">
    <button v-for="t in tiles" :key="t.state" type="button" class="cw-card pf-tile" :aria-pressed="state === t.state" @click="state = state === t.state ? '' : (t.state as PlanningFeeState)">
      <span class="pf-tile-label">{{ t.label }}</span>
      <span v-if="!t.rows.length" class="pf-tile-value">None</span>
      <span v-for="r in t.rows" :key="r.currency" class="pf-tile-value num">{{ formatMoney(r.amount, r.currency) }} <small>· {{ r.n }}</small></span>
    </button>
  </div>

  <section v-if="canPrepare && awaitingVoucher" class="cw-card pf-prepare" aria-labelledby="pf-p">
    <div class="cw-card-body">
      <div>
        <h3 id="pf-p">{{ awaitingVoucher }} online fee{{ awaitingVoucher === 1 ? '' : 's' }} awaiting a voucher</h3>
        <p>Each becomes a draft voucher in your name: the provider's bank account debited, the planning fee income credited. Somebody else posts it.</p>
      </div>
      <button type="button" class="cw-btn cw-btn--primary" :disabled="busy" data-testid="pf-prepare" @click="prepare">
        <FilePlus2 :size="18" aria-hidden="true" /> {{ busy ? 'Preparing…' : 'Prepare vouchers' }}
      </button>
    </div>
  </section>

  <section class="cw-card">
    <div class="cw-card-head">
      <h3>Fees <span class="pf-count">{{ total }}</span></h3>
      <span class="cw-spacer" />
      <div class="cw-seg" role="group" aria-label="Show">
        <button v-for="s in STATES" :key="s.value" type="button" :aria-pressed="state === s.value" @click="state = s.value">{{ s.label }}</button>
      </div>
    </div>
    <div class="cw-card-body">
      <input v-model="q" class="cw-input pf-search" type="search" placeholder="Reference, stand, payer, receipt or voucher" aria-label="Search planning fees" />
    </div>
    <div class="cw-card-body cw-table-wrap">
      <div v-if="loading && !fees.length"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!fees.length" class="cw-empty">No planning fee {{ state ? 'is ' + stateLabel(state).toLowerCase() : 'has been received yet' }}.</p>
      <table v-else class="cw-table dx-compact">
        <thead><tr><th>Received</th><th>Application</th><th>For</th><th>Paid by</th><th>How</th><th class="r">Amount</th><th>Receipt / reference</th><th>Voucher</th><th>Stands</th></tr></thead>
        <tbody>
          <tr v-for="f in fees" :key="f.id">
            <td class="num">{{ f.received_on }}</td>
            <td class="dx-wrap">
              <strong v-if="appRef(f)">{{ appRef(f) }}</strong><span v-else class="pf-muted">Not linked</span>
              <span v-if="f.applicant_name" class="pf-sub">{{ f.applicant_name }}</span>
            </td>
            <td>{{ planningFeeLabel(f.fee_kind) }}</td>
            <td class="dx-wrap">{{ f.payer_name || '—' }}</td>
            <td>{{ sourceText(f) }}</td>
            <td class="r num">{{ formatMoney(f.amount, f.currency) }}</td>
            <td class="num">{{ f.receipt_no || f.reference || '—' }}</td>
            <td class="num">{{ f.voucher_no || '—' }}</td>
            <td>
              <span class="cw-pill" :class="stateTone(f.state)">{{ stateLabel(f.state) }}</span>
              <span v-if="reasonFor(f.id)" class="pf-reason">{{ reasonFor(f.id) }}</span>
              <span v-else-if="f.state === 'awaiting_posting' && f.source === 'counter'" class="pf-reason">Posts when the cash-up is verified.</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.pf-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 14px; margin-bottom: 16px; }
.pf-tile { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; text-align: left; font: inherit; color: inherit; cursor: pointer; }
.pf-tile[aria-pressed='true'] { outline: 2px solid var(--cw-accent, #1a73e8); }
.pf-tile-label { font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; opacity: 0.7; }
.pf-tile-value { font-size: 18px; font-weight: 800; }
.pf-tile-value small { font-size: 13px; font-weight: 600; opacity: 0.7; }
.pf-prepare { margin-bottom: 16px; }
.pf-prepare .cw-card-body { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
.pf-prepare h3 { margin: 0 0 4px; font-size: 16px; }
.pf-prepare p { margin: 0; max-width: 44rem; }
.pf-count { font-size: 13px; font-weight: 700; opacity: 0.6; margin-left: 6px; }
.pf-search { width: 100%; max-width: 28rem; }
.pf-sub, .pf-reason { display: block; font-size: 13px; opacity: 0.75; }
.pf-reason { margin-top: 4px; max-width: 22rem; white-space: normal; }
.pf-muted { opacity: 0.6; }
</style>
