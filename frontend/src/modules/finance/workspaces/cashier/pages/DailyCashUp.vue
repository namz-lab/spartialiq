<script setup lang="ts">
/**
 * The cashier's till from float to count.
 *
 *   no till        open one: a free cash point, the float in each currency
 *   open           suspend when stepping away, or cash up
 *   suspended      resume to take payments or to count
 *   stale          a till from an earlier day: count it before opening today's
 *   abandoned      a supervisor found it left; it is counted under supervision
 *   counted        the count is declared and waits for somebody else to verify it
 *
 * THE COUNT COMES FIRST (control C7): the expected takings are not shown until the cashier has
 * declared what is in the drawer. The variance then comes back from the server.
 */
import { computed, reactive, ref, watch } from 'vue'
import { Layers, Banknote, Pause, Play, Lock, AlertTriangle, CircleCheck, Clock } from 'lucide-vue-next'
import { cashApi } from '../../../api/cashApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney, formatDate, formatDateTime, type Currency } from '../../../composables/useMoney'
import { toCents } from '../../../composables/cashMath'
import { methodLabel } from '../../../models/cashTypes'
import { useCashier } from '../useCashier'

const store = useFinanceStore()
const { state, session, till, loadDesk } = useCashier()
const CURRENCIES: Currency[] = ['USD', 'ZWG']

const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const canOperate = computed(() => store.can('finance.cash.session.operate'))

// ── Opening ───────────────────────────────────────────────────────────────────────────────────
const assignmentRequired = computed(() => state.desk?.policy?.require_assignment.value === true)
const freePoints = computed(() => (state.desk?.cash_points ?? [])
  .filter((p) => p.status === 'active' && !p.open_session_id && (!assignmentRequired.value || p.assigned_to_me))
  .sort((a, b) => Number(Boolean(b.assigned_to_me)) - Number(Boolean(a.assigned_to_me)) || a.code.localeCompare(b.code)))
const heldPoints = computed(() => (state.desk?.cash_points ?? []).filter((p) => p.status === 'active' && p.open_session_id))
const opening = reactive({ cash_point_id: '', financial_year_id: '', float_usd: '', float_zwg: '' })
watch(freePoints, (points) => { if (!points.some((p) => p.id === opening.cash_point_id)) opening.cash_point_id = points[0]?.id ?? '' }, { immediate: true })
watch(() => state.desk?.financial_years, (years) => {
  if (years && !years.some((y) => y.id === opening.financial_year_id)) opening.financial_year_id = years.length === 1 ? years[0].id : ''
}, { immediate: true })

const blocker = computed<string | null>(() => {
  const r = state.desk?.readiness
  if (!r) return null
  if (r.cash_points === 0) return 'No cash point has been set up. The accountant or the Director of Finance sets up the counters.'
  if (!r.year_open_today) return 'No open financial year contains today, so takings could not be dated. The Director of Finance opens the year.'
  if (!r.period_open_today) return 'The accounting period that contains today is not open. The accountant opens the period.'
  if (!freePoints.value.length) {
    return assignmentRequired.value && (state.desk?.cash_points ?? []).some((p) => p.status === 'active' && !p.open_session_id)
      ? 'None of the free cash points is assigned to you. A cash supervisor assigns cashiers to drawers.'
      : 'Every cash point is held by another cashier. A drawer is freed only when it is counted; if one has been left, a cash supervisor can count it with a witness.'
  }
  return null
})

const canOpen = computed(() => ['none', 'counted', 'verified'].includes(till.value))
const floatOk = (t: string) => t.trim() === '' || toCents(t) !== null

async function openTill(): Promise<void> {
  if (!opening.cash_point_id || busy.value) return
  if (!floatOk(opening.float_usd) || !floatOk(opening.float_zwg)) { error.value = 'A float is an amount such as 50.00, or blank for none.'; return }
  busy.value = true
  error.value = null
  try {
    await cashApi.openSession({
      cash_point_id: opening.cash_point_id,
      ...(opening.financial_year_id ? { financial_year_id: opening.financial_year_id } : {}),
      floats: [
        ...(opening.float_usd.trim() ? [{ currency: 'USD' as Currency, amount: opening.float_usd.trim() }] : []),
        ...(opening.float_zwg.trim() ? [{ currency: 'ZWG' as Currency, amount: opening.float_zwg.trim() }] : []),
      ],
    })
    opening.float_usd = ''
    opening.float_zwg = ''
    notice.value = 'Your till is open. You can take payments now.'
    await loadDesk()
  } catch (err) {
    error.value = messageOf(err, 'The till could not be opened.')
  } finally {
    busy.value = false
  }
}

// ── Suspend, resume ───────────────────────────────────────────────────────────────────────────
async function act(kind: 'suspend' | 'resume'): Promise<void> {
  if (!session.value || busy.value) return
  busy.value = true
  error.value = null
  notice.value = null
  try {
    if (kind === 'suspend') await cashApi.suspendSession(session.value.id)
    else await cashApi.resumeSession(session.value.id)
    await loadDesk()
  } catch (err) {
    error.value = messageOf(err, kind === 'suspend' ? 'The till could not be suspended.' : 'The till could not be resumed.')
  } finally {
    busy.value = false
  }
}

// ── Count ─────────────────────────────────────────────────────────────────────────────────────
const counting = ref(false)
const counted = reactive<Record<Currency, { total: string; explanation: string }>>({ USD: { total: '', explanation: '' }, ZWG: { total: '', explanation: '' } })
const needsExplanation = ref(false)

function startCount(): void {
  counting.value = true
  needsExplanation.value = false
  error.value = null
  for (const c of CURRENCIES) { counted[c].total = ''; counted[c].explanation = '' }
}

async function declare(): Promise<void> {
  if (!session.value || busy.value) return
  const counts = CURRENCIES.filter((c) => counted[c].total.trim() !== '').map((c) => ({
    currency: c, declared_total: counted[c].total.trim(),
    ...(counted[c].explanation.trim() ? { explanation: counted[c].explanation.trim() } : {}),
  }))
  if (counts.some((c) => toCents(c.declared_total) === null)) { error.value = 'A count is an amount such as 412.50.'; return }
  busy.value = true
  error.value = null
  try {
    const r = await cashApi.closeSession(session.value.id, counts)
    counting.value = false
    notice.value = r.note
    await loadDesk()
  } catch (err) {
    error.value = messageOf(err, 'The count could not be declared.')
    if (/explained in writing|has not been declared/.test(error.value)) needsExplanation.value = true
  } finally {
    busy.value = false
  }
}

const varianceTone = (v: string | null) => (!v || v === '0.00' ? 'cw-pos' : v.startsWith('-') ? 'cw-neg' : 'cw-accent')
const STATE_PILL: Record<string, { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'cw-pill--pos' },
  suspended: { label: 'Suspended', cls: 'cw-pill--warn' },
  stale: { label: 'From an earlier day', cls: 'cw-pill--neg' },
  abandoned: { label: 'Found abandoned', cls: 'cw-pill--neg' },
  counted: { label: 'Awaiting verification', cls: 'cw-pill--info' },
  verified: { label: 'Verified', cls: 'cw-pill--pos' },
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Layers :size="58" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Daily Cash Up</h2>
      <p>Open your till with a float, step away safely, and count your drawer at the end of the day.</p>
    </div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
  <p v-if="notice" class="cw-banner-msg cw-banner-msg--pos" role="status"><CircleCheck :size="18" aria-hidden="true" />{{ notice }}</p>
  <p v-if="!canOperate" class="cw-banner-msg cw-banner-msg--warn">You do not operate a till. Opening a session and counting a drawer is the cashier's work.</p>

  <div v-if="!state.desk" class="cw-card cw-card-body" style="padding-top: 20px"><span class="cw-skel" /><span class="cw-skel" /></div>

  <div v-else class="cu-grid">
    <!-- ── The current session ────────────────────────────────────────────────────────────── -->
    <section v-if="session" class="cw-card" aria-labelledby="cu-s">
      <div class="cw-card-head">
        <h3 id="cu-s"><Banknote :size="26" class="cw-head-icon" aria-hidden="true" /> Session {{ session.session_no }}</h3>
        <span class="cw-spacer" />
        <span class="cw-pill" :class="STATE_PILL[till]?.cls">{{ STATE_PILL[till]?.label ?? session.status }}</span>
      </div>
      <div class="cw-card-body">
        <dl class="cw-kv">
          <div><dt>Cash point</dt><dd>{{ session.cash_point_name }}</dd></div>
          <div><dt>Business date</dt><dd>{{ formatDate(session.business_date) }}</dd></div>
          <div><dt>Opened</dt><dd>{{ formatDateTime(session.opened_at) }}</dd></div>
          <div><dt>Receipts</dt><dd>{{ session.receipt_count }}<template v-if="session.cancelled_count"> ({{ session.cancelled_count }} cancelled)</template></dd></div>
          <div v-for="c in session.counts" :key="`f-${c.currency}`"><dt>Float ({{ c.currency }})</dt><dd>{{ formatMoney(c.opening_float, c.currency) }}</dd></div>
        </dl>

        <template v-if="till === 'counted' || till === 'verified'">
          <h4 class="cu-sub">Your count</h4>
          <div class="cw-table-wrap">
            <table class="cw-table">
              <thead><tr><th>Currency</th><th class="r">Float</th><th class="r">Expected</th><th class="r">Counted</th><th class="r">Variance</th></tr></thead>
              <tbody>
                <tr v-for="c in session.counts" :key="c.currency">
                  <td>{{ c.currency }}</td>
                  <td class="amt">{{ formatMoney(c.opening_float, c.currency) }}</td>
                  <td class="amt">{{ formatMoney(c.expected_takings, c.currency) }}</td>
                  <td class="amt">{{ formatMoney(c.declared_total, c.currency) }}</td>
                  <td class="amt" :class="varianceTone(c.variance)">{{ formatMoney(c.variance, c.currency) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="session.totals.length" class="cw-table-wrap" style="margin-top: 12px">
            <table class="cw-table">
              <thead><tr><th>Method</th><th class="r">Receipts</th><th class="r">Amount</th></tr></thead>
              <tbody><tr v-for="t in session.totals" :key="t.currency + t.method"><td>{{ methodLabel(t.method) }} ({{ t.currency }})</td><td class="r">{{ t.receipts }}</td><td class="amt">{{ formatMoney(t.amount, t.currency) }}</td></tr></tbody>
            </table>
          </div>
          <p v-if="till === 'counted'" class="cw-banner-msg cw-banner-msg--info" style="margin-top: 12px"><Clock :size="18" aria-hidden="true" />Your count waits for verification by the accountant or a cash supervisor. You can open a new till below.</p>
          <p v-if="session.return_reason" class="cw-banner-msg cw-banner-msg--warn" style="margin-top: 12px">Returned for recount: {{ session.return_reason }}</p>
        </template>

        <p v-else-if="till === 'abandoned'" class="cw-banner-msg cw-banner-msg--neg" style="margin-top: 12px"><Lock :size="18" aria-hidden="true" />
          Found abandoned by {{ session.abandoned_by_name }}: {{ session.abandon_reason }}. It is counted by a supervisor with a witness.</p>

        <div v-else-if="!counting" class="cu-actions">
          <button v-if="till === 'open'" type="button" class="cw-btn" :disabled="busy || !canOperate" @click="act('suspend')"><Pause :size="18" aria-hidden="true" /> Suspend (step away)</button>
          <button v-if="till === 'suspended'" type="button" class="cw-btn cw-btn--outline" :disabled="busy || !canOperate" @click="act('resume')"><Play :size="18" aria-hidden="true" /> Resume</button>
          <button v-if="till === 'open' || till === 'stale'" type="button" class="cw-btn cw-btn--primary" :disabled="busy || !canOperate" @click="startCount"><Layers :size="18" aria-hidden="true" /> Cash up</button>
          <p v-if="till === 'suspended'" class="cw-hint" style="flex-basis: 100%">Resume before counting: you are present at your own count.</p>
        </div>

        <form v-if="counting" class="cu-count" @submit.prevent="declare">
          <h4 class="cu-sub">Count the drawer</h4>
          <p class="cw-hint">Enter everything in the drawer in each currency, the float included. The expected figure is shown after you declare.</p>
          <div v-for="c in CURRENCIES" :key="c" class="cu-count-row">
            <label class="cw-field">
              <span class="cw-label">{{ c }} counted</span>
              <input v-model="counted[c].total" class="cw-input num" inputmode="decimal" placeholder="0.00" autocomplete="off" />
            </label>
            <label v-if="needsExplanation" class="cw-field">
              <span class="cw-label">Explanation of any difference</span>
              <input v-model="counted[c].explanation" class="cw-input" maxlength="500" />
            </label>
          </div>
          <div class="cu-actions">
            <button type="button" class="cw-btn" @click="counting = false">Back</button>
            <button type="submit" class="cw-btn cw-btn--primary" :disabled="busy">{{ busy ? 'Declaring…' : 'Declare count' }}</button>
          </div>
        </form>
      </div>
    </section>

    <!-- ── Open a till ────────────────────────────────────────────────────────────────────── -->
    <section v-if="canOpen && canOperate" class="cw-card" aria-labelledby="cu-o">
      <div class="cw-card-head"><h3 id="cu-o"><Banknote :size="26" class="cw-head-icon" aria-hidden="true" /> Open your till</h3></div>
      <div class="cw-card-body">
        <div v-if="blocker" class="cw-banner-msg cw-banner-msg--warn" role="status">
          <Lock :size="18" aria-hidden="true" />
          <div>
            <p style="margin: 0">{{ blocker }}</p>
            <ul v-if="heldPoints.length" style="margin: 6px 0 0; padding-left: 18px">
              <li v-for="p in heldPoints" :key="p.id">{{ p.name }} — held by {{ p.held_by_name ?? 'another cashier' }}<template v-if="p.held_since"> since {{ formatDateTime(p.held_since) }}</template><template v-if="p.held_stale"> (earlier business day)</template></li>
            </ul>
          </div>
        </div>
        <form v-else class="cu-open" @submit.prevent="openTill">
          <p style="margin: 0">Today is <strong>{{ formatDate(state.desk.today) }}</strong>. Everything you receipt in this session is dated today.</p>
          <label class="cw-field">
            <span class="cw-label">Cash point</span>
            <select v-model="opening.cash_point_id" class="cw-select" required>
              <option v-for="p in freePoints" :key="p.id" :value="p.id">{{ p.name }}<template v-if="p.location"> — {{ p.location }}</template><template v-if="p.assigned_to_me"> (assigned to you)</template></option>
            </select>
          </label>
          <label v-if="state.desk.financial_years.length > 1" class="cw-field">
            <span class="cw-label">Financial year</span>
            <select v-model="opening.financial_year_id" class="cw-select" required>
              <option value="" disabled>Choose the year</option>
              <option v-for="y in state.desk.financial_years" :key="y.id" :value="y.id">{{ y.label }}</option>
            </select>
          </label>
          <div class="cu-floats">
            <label class="cw-field"><span class="cw-label">Float (USD)</span><input v-model="opening.float_usd" class="cw-input num" inputmode="decimal" placeholder="0.00" /></label>
            <label class="cw-field"><span class="cw-label">Float (ZWG)</span><input v-model="opening.float_zwg" class="cw-input num" inputmode="decimal" placeholder="0.00" /></label>
          </div>
          <p class="cw-hint" style="margin: 0">The float is the change you start with. It is taken off your count at cash-up.</p>
          <div class="cu-actions"><button type="submit" class="cw-btn cw-btn--primary" :disabled="busy || !opening.cash_point_id">{{ busy ? 'Opening…' : 'Open till' }}</button></div>
        </form>
      </div>
    </section>
  </div>
</template>

<style scoped>
.cu-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 460px), 1fr)); gap: 18px; align-items: start; }
.cu-actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: flex-end; margin-top: 16px; }
.cu-sub { margin: 16px 0 6px; font-size: 15px; }
.cu-count { display: flex; flex-direction: column; gap: 12px; }
.cu-count-row, .cu-floats { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.cu-open { display: flex; flex-direction: column; gap: 14px; }
@media (max-width: 640px) { .cu-count-row, .cu-floats { grid-template-columns: minmax(0, 1fr); } }
</style>
