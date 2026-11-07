<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { paymentsService } from '@/services/paymentsService'
import { ArrowLeft, Shield, Lock, CheckCircle2, AlertCircle, FileText } from 'lucide-vue-next'

const route  = useRoute()
const router = useRouter()
const paymentId = computed(() => String(route.params.refNo || route.params.id || ''))

const payment = ref<any>(null)
const loading = ref(true)
const fatal   = ref('')
const polling = ref(false)
const confirming = ref(false)
const confirmError = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null

const step = computed<'awaiting'|'success'|'cancelled'|'failed'>(() => {
  const s = payment.value?.status
  if (s === 'paid')      return 'success'
  if (s === 'cancelled') return 'cancelled'
  if (s === 'failed')    return 'failed'
  return 'awaiting'
})

async function refresh() {
  try { payment.value = await paymentsService.get(paymentId.value) }
  catch { fatal.value = 'Payment not found.' }
}

async function checkNow() {
  if (polling.value) return
  polling.value = true
  try { payment.value = await paymentsService.poll(paymentId.value) }
  catch { /* keep last good state */ }
  finally { polling.value = false }
}

async function confirmReceipt() {
  if (confirming.value) return
  confirming.value = true
  confirmError.value = ''
  try { payment.value = await paymentsService.confirmManual(paymentId.value) }
  catch { confirmError.value = 'The receipt could not be issued. Try again, or pay at the finance counter.' }
  finally { confirming.value = false }
}

async function cancel() {
  if (!confirm('Cancel this payment? You can pay again from the Payments tab.')) return
  try { payment.value = await paymentsService.cancel(paymentId.value) }
  finally { router.push('/citizen?section=payments') }
}

function startPolling() {
  pollTimer = setInterval(refresh, 5000)
}

onMounted(async () => {
  if (!paymentId.value) {
    fatal.value = 'Payment not found.'
    loading.value = false
    return
  }
  await refresh()
  loading.value = false
  if (step.value === 'awaiting') startPolling()
})
onUnmounted(() => { if (pollTimer) clearInterval(pollTimer) })

function fmtDate(d?: string|null) {
  return d ? new Date(d).toLocaleString('en-ZW', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}
function fmtAmount() {
  const a = payment.value
  if (!a) return ''
  const ccy = a.walletCcy || 'USD'
  const amt = ccy === 'USD' ? a.amountUsd : a.amountZwg
  return `${ccy} ${Number(amt).toFixed(2)}`
}
</script>

<template>
  <div class="pgw-root">
    <header class="pgw-topbar">
      <button class="pgw-back" @click="router.back()"><ArrowLeft :size="14" /> Back</button>
      <div class="pgw-brand">
        <div class="pgw-brand-icon"><Shield :size="14" /></div>
        <span>Vungu Rural District Council</span>
      </div>
      <div class="pgw-secure"><Lock :size="11" /> Secure</div>
    </header>

    <div v-if="loading" class="pgw-state"><div class="pgw-spinner"/><p>Loading…</p></div>

    <div v-else-if="fatal" class="pgw-state">
      <AlertCircle :size="40" class="pgw-state-error" />
      <h2>Payment not found</h2>
      <p>{{ fatal }}</p>
      <button class="pgw-btn-primary" @click="router.push('/citizen?section=payments')">Go to Payments</button>
    </div>

    <div v-else class="pgw-body">

      <div v-if="step === 'awaiting'" class="pgw-center-card">
        <div class="pgw-state-emoji">📱</div>
        <h2 class="pgw-center-heading">Check your phone</h2>
        <p v-if="payment.metadata?.title" class="pgw-center-text">{{ payment.metadata.title }}</p>
        <p class="pgw-center-text">
          A payment prompt has been sent to <strong>{{ payment.metadata?.phone || 'your phone' }}</strong>.
        </p>
        <p class="pgw-hint pgw-hint--center">
          <template v-if="payment.driver === 'paynow'">Accept the prompt to pay {{ fmtAmount() }}.</template>
          <template v-else>Paynow sends this prompt when the council Paynow account is connected. Confirming here issues the council receipt.</template>
        </p>
        <div class="pgw-center-actions">
          <button v-if="payment.driver === 'manual'" class="pgw-btn-primary" data-test="pgw-confirm"
                  :disabled="confirming" @click="confirmReceipt">Confirm and issue receipt</button>
          <button class="pgw-btn-secondary" data-test="pgw-check-now"
                  :disabled="polling" @click="checkNow">Check Now</button>
          <button class="pgw-btn-ghost" @click="cancel">Cancel</button>
        </div>
        <p v-if="confirmError" class="pgw-hint pgw-hint--center">{{ confirmError }}</p>
      </div>

      <div v-else-if="step === 'success'" class="pgw-center-card">
        <div class="pgw-success-stamp">
          <div class="pgw-stamp-ring"/>
          <CheckCircle2 :size="48" class="pgw-stamp-icon" />
        </div>
        <h2 class="pgw-center-heading pgw-center-heading--success">Payment successful</h2>
        <div class="pgw-receipt">
          <div class="pgw-receipt-row"><span>Receipt no.</span><strong>{{ payment.issuedReceiptNo }}</strong></div>
          <div class="pgw-receipt-row"><span>Amount paid</span><strong>{{ fmtAmount() }}</strong></div>
          <div class="pgw-receipt-row"><span>Method</span><strong>{{ payment.driver }}</strong></div>
          <div class="pgw-receipt-row"><span>Date</span><strong>{{ fmtDate(payment.paidAt) }}</strong></div>
        </div>
        <div class="pgw-center-actions">
          <button class="pgw-btn-primary" @click="router.push('/citizen')">
            <FileText :size="15" /> My Applications
          </button>
        </div>
      </div>

      <div v-else class="pgw-center-card">
        <div class="pgw-state-emoji">⚠️</div>
        <h2 class="pgw-center-heading">Payment {{ step }}</h2>
        <p class="pgw-center-text">You can try again from the Payments tab.</p>
        <button class="pgw-btn-primary" @click="router.push('/citizen?section=payments')">Go to Payments</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pgw-root { min-height:var(--ent-vh); background:#f8fafc; font-family:system-ui,-apple-system,sans-serif; color:#0f172a; display:flex; flex-direction:column; }
.pgw-topbar { position:sticky; top:0; background:#fff; border-bottom:1px solid #e2e8f0; padding:0.875rem 1.5rem; display:flex; align-items:center; gap:1rem; }
.pgw-back { display:inline-flex; align-items:center; gap:0.35rem; background:none; border:none; cursor:pointer; font:inherit; color:#374151; }
.pgw-brand { flex:1; display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; font-weight:600; }
.pgw-brand-icon { width:26px; height:26px; background:#111827; color:#fff; border-radius:6px; display:flex; align-items:center; justify-content:center; }
.pgw-secure { display:flex; align-items:center; gap:0.3rem; font-size:0.68rem; font-weight:600; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-radius:999px; padding:0.3rem 0.6rem; text-transform:uppercase; letter-spacing:0.04em; }
.pgw-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:4rem 1.5rem; text-align:center; color:#64748b; gap:0.75rem; }
.pgw-state-error { color:#ef4444; }
.pgw-body { flex:1; max-width:520px; margin:0 auto; width:100%; padding:2rem 1.5rem 4rem; }
.pgw-center-card { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:2.5rem 2rem; display:flex; flex-direction:column; align-items:center; gap:0.75rem; text-align:center; box-shadow:0 2px 12px rgba(0,0,0,0.05); }
.pgw-state-emoji { font-size:3rem; }
.pgw-center-heading { font-size:1.375rem; font-weight:800; color:#0f172a; }
.pgw-center-heading--success { color:#16a34a; }
.pgw-center-text { font-size:0.9rem; color:#374151; }
.pgw-hint { font-size:0.72rem; color:#94a3b8; }
.pgw-hint--center { text-align:center; }
.pgw-center-actions { display:flex; gap:0.75rem; flex-wrap:wrap; justify-content:center; margin-top:0.5rem; }
.pgw-btn-primary { display:inline-flex; align-items:center; gap:0.5rem; padding:0.75rem 1.75rem; background:#111827; color:#fff; border:none; border-radius:9999px; font:inherit; font-weight:600; cursor:pointer; }
.pgw-btn-secondary { display:inline-flex; align-items:center; gap:0.5rem; padding:0.75rem 1.75rem; background:#fff; color:#1e293b; border:1.5px solid #e2e8f0; border-radius:9999px; font:inherit; font-weight:600; cursor:pointer; }
.pgw-btn-secondary:disabled { opacity:0.5; cursor:not-allowed; }
.pgw-btn-ghost { background:none; border:none; color:#64748b; font:inherit; cursor:pointer; padding:0.75rem 0.5rem; }
.pgw-receipt { background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; width:100%; text-align:left; overflow:hidden; }
.pgw-receipt-row { display:flex; justify-content:space-between; align-items:center; padding:0.55rem 1rem; border-bottom:1px solid #e2e8f0; font-size:0.8125rem; gap:1rem; }
.pgw-receipt-row:last-child { border-bottom:none; }
.pgw-receipt-row span { color:#64748b; }
.pgw-receipt-row strong { color:#0f172a; text-align:right; }
.pgw-success-stamp { position:relative; }
.pgw-stamp-ring { position:absolute; inset:-10px; border:2px dashed #d1fae5; border-radius:50%; animation:rotateSlow 8s linear infinite; }
@keyframes rotateSlow { to { transform:rotate(360deg); } }
.pgw-stamp-icon { color:#16a34a; display:block; }
.pgw-spinner { width:36px; height:36px; border:3px solid #e2e8f0; border-top-color:#111827; border-radius:50%; animation:spin 0.7s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
</style>
