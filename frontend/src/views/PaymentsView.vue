<template>
  <div class="payments-page">
    <header class="page-topbar">
      <router-link to="/" class="page-back" aria-label="Back to home">
        <ArrowLeft :size="14" aria-hidden="true" />
        <span>Vungu Portal</span>
      </router-link>
    </header>

    <main class="page-stage">
      <header class="page-head">
        <p class="eyebrow">Payments</p>
        <h1 class="page-title">Settle a council fee</h1>
        <p class="page-lede">
          Pay in US Dollars or Zimbabwe Gold. Conversion uses the
          interbank rate; the receipt records both legs.
        </p>
      </header>

      <!-- ── Init form ───────────────────────────────────────────── -->
      <section class="card" aria-labelledby="pay-init-h">
        <h2 id="pay-init-h" class="card-title">New payment</h2>

        <div v-if="rate" class="rate-strip" role="status">
          <span>1&nbsp;USD = {{ rate.rate.toFixed(2) }} ZWG</span>
          <span class="rate-source">{{ rateSourceLabel }}</span>
          <span v-if="rate.isStale" class="rate-stale">
            <AlertTriangle :size="11" aria-hidden="true" />
            Stale rate — confirm with council before settling.
          </span>
        </div>

        <form class="form-grid" @submit.prevent="initiate" novalidate>
          <div class="field">
            <label for="purpose">Fee type</label>
            <select id="purpose" v-model="form.purpose" class="input" required>
              <option value="application_fee">Development application fee</option>
              <option value="inspection_fee">Inspection fee</option>
              <option value="permit_fee">Permit fee</option>
              <option value="occupation_certificate">Occupation certificate</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div class="field">
            <label for="related-id">Reference (optional)</label>
            <input
              id="related-id"
              v-model.trim="form.relatedId"
              class="input"
              placeholder="e.g. DEV-12345 or booking ID"
            />
          </div>

          <div class="field">
            <label for="price">Amount (US$)</label>
            <input
              id="price"
              v-model.number="form.priceUsd"
              type="number"
              step="0.01"
              min="0"
              required
              class="input mono"
            />
          </div>

          <div class="field">
            <label for="wallet">Pay in</label>
            <select id="wallet" v-model="form.walletCcy" class="input">
              <option value="USD">US Dollars</option>
              <option value="ZWG">Zimbabwe Gold (ZWG)</option>
            </select>
          </div>

          <!-- Live quote -->
          <div v-if="quote" class="quote-row">
            <p>
              Bill in {{ quote.walletCcy }}:
              <strong class="mono">{{ formatAmount(quoteAmount, quote.walletCcy) }}</strong>
            </p>
            <p class="quote-sub mono">
              {{ form.priceUsd }} USD × {{ quote.rate.toFixed(4) }} ZWG/USD
            </p>
          </div>

          <p v-if="error" class="banner banner-error" role="alert">{{ error }}</p>

          <div class="actions">
            <button
              type="submit"
              class="btn-solid"
              :disabled="busy || !form.priceUsd || form.priceUsd <= 0"
              :aria-busy="busy || undefined"
            >
              {{ busy ? 'Processing…' : 'Initiate payment' }}
            </button>
          </div>
        </form>
      </section>

      <!-- ── Most recent created payment ─────────────────────────── -->
      <section v-if="lastInit" class="card" aria-label="Latest payment">
        <h2 class="card-title">Awaiting confirmation</h2>
        <dl class="kv">
          <div><dt>Receipt</dt><dd class="mono">{{ lastInit.issuedReceiptNo || '—' }}</dd></div>
          <div><dt>Amount</dt><dd class="mono">{{ formatAmount(walletAmount(lastInit), lastInit.walletCcy) }}</dd></div>
          <div><dt>Status</dt><dd class="mono">{{ statusLabel(lastInit.status) }}</dd></div>
          <div><dt>Driver</dt><dd class="mono">{{ lastInit.driver }}</dd></div>
        </dl>

        <p v-if="lastInit.redirectUrl" class="banner banner-info">
          Continue to your payment provider:
          <a :href="lastInit.redirectUrl" target="_blank" rel="noopener" class="link">
            {{ lastInit.redirectUrl }}
          </a>
        </p>

        <div v-if="lastInit.driver === 'manual'" class="actions actions-row">
          <button
            type="button"
            class="btn-solid"
            :disabled="busy"
            @click="confirmManual"
          >
            Confirm payment
          </button>
          <button
            type="button"
            class="btn-ghost"
            :disabled="busy"
            @click="cancelInit"
          >
            Cancel
          </button>
        </div>
      </section>

      <!-- ── Payment history ─────────────────────────────────────── -->
      <section class="card" aria-labelledby="pay-list-h">
        <header class="card-head-row">
          <h2 id="pay-list-h" class="card-title">My payments</h2>
          <button
            type="button"
            class="btn-ghost btn-sm"
            :disabled="loadingList"
            @click="loadHistory"
          >
            {{ loadingList ? 'Loading…' : 'Refresh' }}
          </button>
        </header>

        <div v-if="!loadingList && history.length === 0" class="empty">
          No payments yet.
        </div>

        <table v-else class="data-table">
          <thead>
            <tr>
              <th scope="col">Receipt</th>
              <th scope="col">Purpose</th>
              <th scope="col">Amount</th>
              <th scope="col">Status</th>
              <th scope="col">Date</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in history" :key="p.id">
              <td class="mono">{{ p.issuedReceiptNo || '—' }}</td>
              <td>{{ purposeLabel(p.purpose) }}</td>
              <td class="mono">{{ formatAmount(walletAmount(p), p.walletCcy) }}</td>
              <td>
                <span :class="['pill', `pill-${p.status}`]">
                  {{ statusLabel(p.status) }}
                </span>
              </td>
              <td class="mono">{{ formatDate(p.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ArrowLeft, AlertTriangle } from 'lucide-vue-next'
import {
  paymentsService,
  type ExchangeRateMeta,
  type Payment,
  type PaymentQuote,
  type WalletCurrency,
  type InitPaymentInput,
} from '../services/paymentsService'

const form = reactive<InitPaymentInput>({
  purpose:    'application_fee',
  priceUsd:   0,
  walletCcy:  'USD',
  driver:     'manual',
  relatedId:  '',
})

const rate     = ref<ExchangeRateMeta | null>(null)
const quote    = ref<PaymentQuote | null>(null)
const lastInit = ref<Payment | null>(null)
const history  = ref<Payment[]>([])

const busy        = ref(false)
const loadingList = ref(false)
const error       = ref('')

const rateSourceLabel = computed(() => rate.value
  ? `${rate.value.source}${rate.value.rateDate ? ` · ${rate.value.rateDate}` : ''}`
  : '',
)

const quoteAmount = computed(() => {
  if (!quote.value) return 0
  return quote.value.walletCcy === 'USD' ? quote.value.amountUsd : quote.value.amountZwg
})

function walletAmount(p: Payment) {
  return p.walletCcy === 'USD' ? p.amountUsd : p.amountZwg
}

function formatAmount(n: number, ccy: WalletCurrency): string {
  const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  return `${n.toLocaleString('en-GB', opts)} ${ccy}`
}

function statusLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function purposeLabel(s: string): string {
  return statusLabel(s)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit',
  })
}

// ── Quote auto-refresh ────────────────────────────────────────────────
let quoteTimer: number | undefined
async function refreshQuote() {
  if (!form.priceUsd || form.priceUsd <= 0) {
    quote.value = null
    return
  }
  try {
    quote.value = await paymentsService.quote(Number(form.priceUsd), form.walletCcy)
  } catch {
    quote.value = null
  }
}

watch(
  () => [form.priceUsd, form.walletCcy],
  () => {
    if (quoteTimer) clearTimeout(quoteTimer)
    // Debounce — citizen is typing.
    quoteTimer = window.setTimeout(refreshQuote, 250)
  },
)

// ── Init / confirm / cancel ──────────────────────────────────────────
async function initiate() {
  error.value = ''
  if (!form.priceUsd || form.priceUsd <= 0) {
    error.value = 'Enter an amount greater than zero.'
    return
  }
  busy.value = true
  try {
    lastInit.value = await paymentsService.init({
      ...form,
      relatedId: form.relatedId || undefined,
    })
    await loadHistory()
  } catch (err: unknown) {
    error.value = extractError(err) || 'Could not initiate payment.'
  } finally {
    busy.value = false
  }
}

async function confirmManual() {
  if (!lastInit.value) return
  busy.value = true
  error.value = ''
  try {
    lastInit.value = await paymentsService.confirmManual(lastInit.value.id)
    await loadHistory()
  } catch (err: unknown) {
    error.value = extractError(err) || 'Could not confirm payment.'
  } finally {
    busy.value = false
  }
}

async function cancelInit() {
  if (!lastInit.value) return
  busy.value = true
  error.value = ''
  try {
    lastInit.value = await paymentsService.cancel(lastInit.value.id)
    await loadHistory()
  } catch (err: unknown) {
    error.value = extractError(err) || 'Could not cancel payment.'
  } finally {
    busy.value = false
  }
}

async function loadHistory() {
  loadingList.value = true
  try {
    history.value = await paymentsService.listMine()
  } catch {
    history.value = []
  } finally {
    loadingList.value = false
  }
}

function extractError(err: unknown): string {
  const e = err as { response?: { data?: { message?: string; error?: string } } }
  return e.response?.data?.message || e.response?.data?.error || ''
}

onMounted(async () => {
  try { rate.value = await paymentsService.rate() } catch { /* offline */ }
  loadHistory()
})
</script>

<style scoped>
/* ── Page chrome ─────────────────────────────────────────────────── */
.payments-page {
  min-height: 100dvh;
  background:
    radial-gradient(900px 500px at 10% -10%, rgba(30, 107, 74, 0.06), transparent 60%),
    #fbfbf8;
  font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
  color: #0b1220;
  display: flex;
  flex-direction: column;
}

.page-topbar { padding: 1rem 1.5rem; }
.page-back {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: #404a59;
  text-decoration: none;
  transition: color 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.page-back:hover { color: #0b1220; }

.page-stage {
  flex: 1;
  max-width: 56rem;
  margin: 0 auto;
  padding: clamp(1rem, 4vw, 3rem) clamp(1rem, 4vw, 2rem) 4rem;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.page-head { padding-bottom: 0.5rem; }
.eyebrow {
  font-size: 0.7rem; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: #5b6473;
  margin: 0 0 0.75rem;
}
.page-title {
  font-family: 'Fraunces', ui-serif, Georgia, serif;
  font-weight: 600;
  font-size: clamp(1.75rem, 3vw + 0.5rem, 2.5rem);
  letter-spacing: -0.02em;
  color: #0b1220;
  margin: 0 0 0.5rem;
  line-height: 1.1;
}
.page-lede {
  margin: 0;
  font-size: 1rem;
  line-height: 1.55;
  color: #5b6473;
  max-width: 56ch;
}

/* ── Cards ───────────────────────────────────────────────────────── */
.card {
  background: #ffffff;
  border: 1px solid #e2e6ec;
  border-radius: 12px;
  padding: 1.25rem 1.25rem 1.1rem;
  box-shadow: 0 12px 28px -22px rgba(11, 18, 32, 0.18);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.card-title {
  font-family: 'Fraunces', ui-serif, Georgia, serif;
  font-weight: 600;
  font-size: 1.15rem;
  letter-spacing: -0.01em;
  color: #0b1220;
  margin: 0;
}
.card-head-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

/* ── Rate strip ──────────────────────────────────────────────────── */
.rate-strip {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.75rem;
  font-size: 0.8125rem;
  color: #404a59;
  padding: 0.5rem 0.75rem;
  background: #f7f8fa;
  border: 1px solid #eef0f4;
  border-radius: 8px;
}
.rate-source { font-family: 'Geist Mono', ui-monospace, monospace; color: #5b6473; font-size: 0.75rem; }
.rate-stale {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: #93390a;
  font-size: 0.75rem;
}

/* ── Form ────────────────────────────────────────────────────────── */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem 1rem;
}
@media (max-width: 540px) {
  .form-grid { grid-template-columns: 1fr; }
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}
.field label {
  font-size: 0.78rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: #404a59;
}

.input {
  width: 100%;
  padding: 0.6rem 0.85rem;
  border: 1px solid #dde1e8;
  border-radius: 8px;
  background: #fbfbf8;
  font: 500 0.9375rem/1.4 inherit;
  color: #0b1220;
  font-family: inherit;
  transition: border-color 160ms cubic-bezier(0.23, 1, 0.32, 1),
              box-shadow 160ms cubic-bezier(0.23, 1, 0.32, 1);
  box-sizing: border-box;
}
.input:focus {
  outline: none;
  border-color: #1e6b4a;
  box-shadow: 0 0 0 3px rgba(30, 107, 74, 0.18);
  background: #fff;
}
.input.mono { font-family: 'Geist Mono', ui-monospace, monospace; }

.quote-row {
  grid-column: 1 / -1;
  padding: 0.6rem 0.85rem;
  background: #eef6f1;
  border: 1px solid #d6ebde;
  border-radius: 8px;
}
.quote-row p { margin: 0; font-size: 0.875rem; color: #0b1220; }
.quote-row strong { font-family: 'Geist Mono', ui-monospace, monospace; font-weight: 600; }
.quote-sub { color: #5b6473; font-size: 0.75rem; margin-top: 0.15rem !important; }

/* ── Buttons ─────────────────────────────────────────────────────── */
.actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; }
.actions-row { gap: 0.5rem; }

.btn-solid {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 2.5rem;
  padding: 0 1rem;
  background: #0b1220;
  color: #ffffff;
  font: 600 0.9375rem/1 inherit;
  border-radius: 8px;
  border: 1px solid #0b1220;
  cursor: pointer;
  transition: background-color 160ms cubic-bezier(0.23, 1, 0.32, 1),
              transform 100ms cubic-bezier(0.23, 1, 0.32, 1),
              box-shadow 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.btn-solid:hover:not(:disabled)  { background: #1a1f29; box-shadow: 0 6px 16px -8px rgba(11, 18, 32, 0.4); }
.btn-solid:active:not(:disabled) { transform: scale(0.985); }
.btn-solid:disabled              { opacity: 0.55; cursor: not-allowed; }

.btn-ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 2.25rem;
  padding: 0 0.85rem;
  background: transparent;
  color: #404a59;
  font: 500 0.875rem/1 inherit;
  border-radius: 8px;
  border: 1px solid #dde1e8;
  cursor: pointer;
  transition: background-color 160ms cubic-bezier(0.23, 1, 0.32, 1),
              border-color 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.btn-ghost:hover:not(:disabled)  { background: #f7f8fa; border-color: #c0c6d1; color: #0b1220; }
.btn-ghost:active:not(:disabled) { transform: scale(0.985); }
.btn-sm                          { height: 2rem; padding: 0 0.65rem; font-size: 0.78rem; }

/* ── Banners ─────────────────────────────────────────────────────── */
.banner {
  font-size: 0.85rem;
  padding: 0.55rem 0.75rem;
  border-radius: 8px;
  grid-column: 1 / -1;
}
.banner-info  { background: #eef6f1; color: #0d3624; border: 1px solid #aed5be; }
.banner-error { background: #fef3f2; color: #9a1c12; border: 1px solid #fcd9d4; }
.link { color: #1e6b4a; }

/* ── Key/value list ──────────────────────────────────────────────── */
.kv {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.5rem 1rem;
}
.kv div { margin: 0; }
.kv dt {
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8e96a4;
  margin: 0 0 0.15rem;
}
.kv dd {
  margin: 0;
  font-size: 0.875rem;
  color: #0b1220;
}
.mono { font-family: 'Geist Mono', ui-monospace, monospace; }

/* ── Table ───────────────────────────────────────────────────────── */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.data-table th,
.data-table td {
  padding: 0.55rem 0.4rem;
  text-align: left;
  border-bottom: 1px solid #eef0f4;
}
.data-table th {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #5b6473;
}
.empty { font-size: 0.875rem; color: #5b6473; font-style: italic; }

.pill {
  display: inline-flex;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  font-weight: 600;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: #f7f8fa;
  color: #404a59;
  border: 1px solid #eef0f4;
}
.pill-paid              { background: #eef6f1; color: #0d3624; border-color: #aed5be; }
.pill-pending,
.pill-awaiting_provider { background: #fef7e6; color: #93390a; border-color: #fdecc4; }
.pill-failed,
.pill-cancelled         { background: #fef3f2; color: #9a1c12; border-color: #fcd9d4; }
</style>
