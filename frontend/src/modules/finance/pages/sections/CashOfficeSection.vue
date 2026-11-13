<script setup lang="ts">
/**
 * The cash office.
 *
 * Four views of one office, each shown only to whoever has work or reading in it:
 *   Counter    the cashier's till: open it, take payments, suspend, cash up
 *   Drawers    the cash supervisor's board: who holds each drawer, abandoned sessions counted with a
 *              witness, and which cashiers are assigned where (migration 208)
 *   Cash-ups   every session; the second person verifies a declared count here
 *   Banking    what each till holds and the takings carried to the bank
 *   Setup      the counters and the Council's income list (decision D22)
 *
 * A cashier lands on Counter and an accountant on Cash-ups, because that is where each one's work
 * is. The view is in the URL (`?view=`) so a link to "the cash-ups awaiting verification" opens on
 * them.
 *
 * THE PRINTED RECEIPT is rendered here, once, for all four views. It is a plain document teleported
 * to <body> and shown only to the printer: no PDF library, and nothing a slow sub-office link has
 * to download.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, RefreshCw } from 'lucide-vue-next'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { cashApi } from '../../api/cashApi'
import { formatMoney, formatDate } from '../../composables/useMoney'
import { amountInWords, CURRENCY_WORDS } from '../../composables/cashMath'
import { methodLabel, type CashDesk, type PrintableReceipt } from '../../models/cashTypes'
import CashCounter from '../../components/cash/CashCounter.vue'
import CashSessions from '../../components/cash/CashSessions.vue'
import CashBanking from '../../components/cash/CashBanking.vue'
import CashSetup from '../../components/cash/CashSetup.vue'
import CashDrawers from '../../components/cash/CashDrawers.vue'

type View = 'counter' | 'drawers' | 'sessions' | 'banking' | 'setup'

const store = useFinanceStore()
const route = useRoute()
const router = useRouter()

const desk = ref<CashDesk | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const worksCounter = computed(() => store.canAny('finance.cash.session.operate', 'finance.cash.receipt.record'))
const views = computed<{ key: View; label: string; count?: number }[]>(() => [
  ...(worksCounter.value ? [{ key: 'counter' as View, label: 'Counter' }] : []),
  ...(store.canAny('finance.cash.session.supervise', 'finance.cash.assignment.manage')
    ? [{ key: 'drawers' as View, label: 'Drawers' }] : []),
  { key: 'sessions', label: 'Cash-ups', count: desk.value?.awaiting_verification || undefined },
  { key: 'banking', label: 'Banking' },
  ...(store.can('finance.cash.setup.manage') ? [{ key: 'setup' as View, label: 'Setup' }] : []),
])

const view = computed<View>(() => {
  const asked = typeof route.query.view === 'string' ? route.query.view : ''
  const found = views.value.find((v) => v.key === asked)
  return found ? found.key : views.value[0].key
})
function show(key: View): void {
  if (key === view.value) return
  void router.replace({ query: { ...route.query, view: key } })
}

/** Arrow keys move between the tabs, as a tablist is expected to. */
function onTabKey(event: KeyboardEvent): void {
  const keys = views.value.map((v) => v.key)
  const at = keys.indexOf(view.value)
  const to = event.key === 'ArrowRight' ? at + 1
    : event.key === 'ArrowLeft' ? at - 1
      : event.key === 'Home' ? 0
        : event.key === 'End' ? keys.length - 1
          : -1
  if (to < 0 || to >= keys.length) return
  event.preventDefault()
  show(keys[to])
  void nextTick(() => document.getElementById(`cash-tab-${keys[to]}`)?.focus())
}

const sessionsEl = ref<{ load: () => Promise<void> } | null>(null)
const drawersEl = ref<{ load: () => Promise<void> } | null>(null)

/** The one Refresh on the screen: the desk, and the list under it if that is what is showing. */
async function refresh(): Promise<void> {
  await Promise.all([load(), sessionsEl.value?.load(), drawersEl.value?.load()])
}

async function load(quiet = false): Promise<void> {
  if (!quiet) loading.value = true
  error.value = null
  try {
    desk.value = await cashApi.desk()
  } catch (err) {
    error.value = messageOf(err, 'The cash office could not be read.')
  } finally {
    loading.value = false
  }
}

/** The book of account's state for today, which decides whether a till can open at all. */
const dayStatus = computed<{ label: string; tone: string } | null>(() => {
  const r = desk.value?.readiness
  if (!r) return null
  if (!r.year_open_today) return { label: 'Financial year closed', tone: 'tone-negative' }
  if (!r.period_open_today) return { label: 'Accounting period closed', tone: 'tone-negative' }
  return { label: 'Year and period open', tone: 'tone-positive' }
})

/** Only a person who works a till is shown the state of their own drawer. */
const tillStatus = computed<{ label: string; tone: string } | null>(() => {
  if (!desk.value || !worksCounter.value) return null
  const session = desk.value.my_session
  if (!session) return { label: 'No till open', tone: '' }
  if (session.status === 'open') return { label: `Open · ${session.session_no}`, tone: 'tone-info' }
  if (session.status === 'suspended') return { label: `Suspended · ${session.session_no}`, tone: '' }
  if (session.status === 'abandoned') return { label: 'Found abandoned', tone: 'tone-negative' }
  if (session.status === 'closed') return { label: 'Count awaiting verification', tone: 'tone-warning' }
  return { label: `Verified · ${session.session_no}`, tone: 'tone-positive' }
})

/** Whoever sets the office up is told what is missing; everyone else is told who to ask. */
const setupGaps = computed<string[]>(() => {
  const r = desk.value?.readiness
  if (!r) return []
  const gaps: string[] = []
  if (r.cash_points === 0) gaps.push('no cash point')
  if (r.income_codes === 0) gaps.push('no income code')
  if (r.bank_accounts === 0) gaps.push('no bank account in the ledger')
  return gaps
})

// ── The printed receipt ───────────────────────────────────────────────────────────────────────
const printing = ref<PrintableReceipt | null>(null)

async function print(receiptId: string): Promise<void> {
  error.value = null
  try {
    printing.value = (await cashApi.receipt(receiptId)).receipt
    await nextTick()
    window.print()
  } catch (err) {
    error.value = messageOf(err, 'The receipt could not be prepared for printing.')
  }
}

const words = computed(() => (printing.value
  ? amountInWords(printing.value.amount, CURRENCY_WORDS[printing.value.currency])
  : ''))

watch(() => store.identity, () => { void load() })
onMounted(load)
</script>

<template>
  <div class="cash-office">
    <div class="cash-nav">
      <div class="cash-tablist" role="tablist" aria-label="Cash office views">
        <button
          v-for="v in views" :key="v.key" :id="`cash-tab-${v.key}`" type="button" role="tab"
          :aria-selected="view === v.key" :aria-controls="`cash-panel-${v.key}`"
          :tabindex="view === v.key ? 0 : -1" :class="{ 'is-active': view === v.key }"
          @click="show(v.key)" @keydown="onTabKey"
        >
          {{ v.label }}<span v-if="v.count" class="cash-tab-count">{{ v.count }}<span class="sr-only"> awaiting verification</span></span>
        </button>
      </div>
      <button type="button" class="fin-btn small" :disabled="loading" @click="refresh()"><RefreshCw :size="13" aria-hidden="true" /> Refresh</button>
    </div>

    <!-- The counter carries these facts in its own POS ribbon; repeating them above it would
         print the same status twice on one screen. -->
    <header v-if="desk && view !== 'counter'" class="cash-console" aria-label="Cash office status">
      <div class="cash-console-cell">
        <span class="cash-console-label">Business date</span>
        <strong>{{ formatDate(desk.today) }}</strong>
      </div>
      <div v-if="dayStatus" class="cash-console-cell">
        <span class="cash-console-label">Book of account</span>
        <span class="fin-pill" :class="dayStatus.tone">{{ dayStatus.label }}</span>
      </div>
      <div v-if="tillStatus" class="cash-console-cell">
        <span class="cash-console-label">Your till</span>
        <span class="fin-pill" :class="tillStatus.tone">{{ tillStatus.label }}</span>
      </div>
      <div class="cash-console-cell">
        <span class="cash-console-label">Awaiting verification</span>
        <button v-if="desk.awaiting_verification" type="button" class="cash-console-link" @click="show('sessions')">
          {{ desk.awaiting_verification }} session{{ desk.awaiting_verification === 1 ? '' : 's' }}
        </button>
        <span v-else class="cash-console-value">None</span>
      </div>
    </header>

    <p v-if="error" class="ins-banner t-negative" role="alert"><AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span></p>

    <div v-if="!desk && loading" aria-busy="true" class="cash-loading">
      <span class="ins-skel" style="width: 40%" /><span class="ins-skel" /><span class="ins-skel" style="width: 75%" />
    </div>

    <template v-else-if="desk">
      <!-- Not on the counter when there is no cash point at all: the counter says so itself, with
           who to ask, and saying it twice on one screen is how a notice stops being read. -->
      <p v-if="setupGaps.length && view !== 'setup' && !(view === 'counter' && desk.readiness.cash_points === 0)" class="ins-banner t-warning" role="status">
        <AlertTriangle :size="16" aria-hidden="true" />
        <span>
          <strong>The cash office is not fully set up:</strong> {{ setupGaps.join(', ') }}.
          <template v-if="store.can('finance.cash.setup.manage')">
            These are the Council's to decide (D22) and are entered under
            <button type="button" class="cash-link" @click="show('setup')">Setup</button>; nothing is assumed in their place.
          </template>
          <template v-else>They are entered by the accountant or the Director of Finance (Council decision D22); nothing is assumed in their place.</template>
        </span>
      </p>

      <div
        :id="`cash-panel-${view}`" role="tabpanel" :aria-labelledby="`cash-tab-${view}`"
        tabindex="0" class="cash-panel"
      >
        <CashCounter v-if="view === 'counter'" :desk="desk" @changed="load(true)" @print="print" />
        <CashDrawers v-else-if="view === 'drawers'" ref="drawersEl" :desk="desk" @changed="load(true)" />
        <CashSessions v-else-if="view === 'sessions'" ref="sessionsEl" @changed="load(true)" @print="print" />
        <CashBanking v-else-if="view === 'banking'" :desk="desk" @changed="load(true)" />
        <CashSetup v-else :desk="desk" @changed="load(true)" />
      </div>
    </template>

    <Teleport to="body">
      <article v-if="printing" class="cash-print" aria-hidden="true">
        <header>
          <h1>{{ printing.council_name }}</h1>
          <p>Official receipt</p>
        </header>
        <p v-if="printing.is_cancelled" class="cash-print-void">CANCELLED — {{ printing.cancel_reason }}</p>
        <dl>
          <div><dt>Receipt no.</dt><dd>{{ printing.receipt_no }}</dd></div>
          <div><dt>Date</dt><dd>{{ formatDate(printing.received_on) }}</dd></div>
          <div><dt>Received from</dt><dd>{{ printing.payer_name }}</dd></div>
          <div><dt>Paid by</dt><dd>{{ methodLabel(printing.method) }}<template v-if="printing.method_reference"> ({{ printing.method_reference }})</template></dd></div>
        </dl>
        <table>
          <thead><tr><th>For</th><th>Qty</th><th>Each</th><th>Amount</th></tr></thead>
          <tbody>
            <tr v-for="l in printing.lines" :key="l.line_no">
              <td>{{ l.description }}</td><td>{{ l.quantity }}</td>
              <td>{{ formatMoney(l.unit_amount, printing.currency, { bare: true }) }}</td>
              <td>{{ formatMoney(l.amount, printing.currency, { bare: true }) }}</td>
            </tr>
          </tbody>
          <tfoot><tr><th colspan="3">Total</th><td>{{ formatMoney(printing.amount, printing.currency) }}</td></tr></tfoot>
        </table>
        <p class="cash-print-words">{{ words }}</p>
        <footer>
          <p>Cashier: {{ printing.cashier_name }} · {{ printing.cash_point_name }} · Session {{ printing.session_no }}</p>
          <p>This receipt is valid only with its number. Keep it as your proof of payment.</p>
        </footer>
      </article>
    </Teleport>
  </div>
</template>

<style scoped>
.cash-office { display: flex; flex-direction: column; gap: var(--ent-s4); }

/* ── View tabs — an underline bar, so four views read as one office ──────────────────────── */
.cash-nav {
  display: flex; align-items: center; justify-content: space-between; gap: var(--ent-s3);
  flex-wrap: wrap; border-bottom: 1px solid var(--ent-line);
}
.cash-tablist { display: flex; align-items: stretch; gap: var(--ent-s1); flex-wrap: wrap; }
.cash-tablist button {
  position: relative; display: inline-flex; align-items: center;
  min-height: 38px; padding: 0 var(--ent-s3); margin-bottom: -1px;
  border: 0; border-bottom: 2px solid transparent; background: none;
  font: inherit; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-medium);
  color: var(--ent-text-2); white-space: nowrap; cursor: pointer;
  transition: color var(--ent-dur) var(--ent-ease), border-color var(--ent-dur) var(--ent-ease);
}
.cash-tablist button:hover { color: var(--ent-text); }
.cash-tablist button.is-active { color: var(--ent-text); font-weight: var(--ent-fw-semibold); border-bottom-color: var(--ent-accent); }
.cash-tablist button:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); border-radius: var(--ent-r-sm) var(--ent-r-sm) 0 0; }

/* ── Status strip — the same four facts on every view ───────────────────────────────────── */
.cash-console {
  display: flex; align-items: stretch; flex-wrap: wrap; overflow: hidden;
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-md);
  background: var(--ent-surface); box-shadow: var(--ent-e1);
}
.cash-console-cell {
  display: flex; flex-direction: column; justify-content: center; gap: 3px;
  min-width: 10rem; padding: var(--ent-s2) var(--ent-s4);
  border-right: 1px solid var(--ent-line);
}
.cash-console-cell:last-child { border-right: 0; }
.cash-console-label {
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.05em; text-transform: uppercase; color: var(--ent-text-3);
}
.cash-console-cell strong { font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.cash-console-value { font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.cash-console-link {
  align-self: flex-start; border: 0; background: none; padding: 0;
  font: inherit; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold);
  color: var(--ent-accent); text-decoration: underline; text-underline-offset: 2px; cursor: pointer;
}
.cash-console-link:focus-visible { outline: var(--ent-focus-ring); outline-offset: 2px; }

.cash-loading { display: flex; flex-direction: column; gap: var(--ent-s2); }
.cash-panel:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); border-radius: var(--ent-r-md); }
.cash-tab-count {
  margin-left: var(--ent-s2); padding: 0 6px; border-radius: var(--ent-r-pill);
  background: var(--ent-tone-warning-bg); color: var(--ent-text);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); font-variant-numeric: tabular-nums;
}
.cash-link { border: 0; background: none; padding: 0; font: inherit; color: var(--ent-accent); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.cash-link:focus-visible { outline: var(--ent-focus-ring); outline-offset: 2px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>

<!-- Not scoped: the receipt is teleported to <body>, and print has to hide the application. -->
<style>
.cash-print { display: none; }
@media print {
  body > *:not(.cash-print) { display: none !important; }
  .cash-print {
    display: block; width: 100%; max-width: 148mm; margin: 0 auto; padding: 6mm;
    color: #000; background: #fff; font: 11pt/1.4 'Geist', system-ui, sans-serif;
  }
  .cash-print header { text-align: center; border-bottom: 1px solid #000; padding-bottom: 3mm; margin-bottom: 4mm; }
  .cash-print h1 { margin: 0; font-size: 14pt; font-weight: 700; }
  .cash-print header p { margin: 1mm 0 0; font-size: 10pt; letter-spacing: 0.08em; text-transform: uppercase; }
  .cash-print-void { margin: 0 0 4mm; padding: 2mm; border: 2px solid #000; font-weight: 700; text-align: center; }
  .cash-print dl { margin: 0 0 4mm; }
  .cash-print dl div { display: flex; justify-content: space-between; gap: 4mm; padding: 0.5mm 0; }
  .cash-print dt { color: #333; }
  .cash-print dd { margin: 0; font-weight: 600; text-align: right; }
  .cash-print table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .cash-print th, .cash-print td { padding: 1.5mm 1mm; border-bottom: 1px solid #999; text-align: right; }
  .cash-print th:first-child, .cash-print td:first-child { text-align: left; }
  .cash-print tfoot th, .cash-print tfoot td { border-bottom: 2px solid #000; border-top: 1px solid #000; font-weight: 700; }
  .cash-print-words { margin: 3mm 0 6mm; font-style: italic; }
  .cash-print footer { border-top: 1px solid #000; padding-top: 2mm; font-size: 9pt; }
  .cash-print footer p { margin: 0 0 1mm; }
}
</style>
