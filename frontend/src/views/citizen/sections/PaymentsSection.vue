<script setup lang="ts">
// Payments — fees still owed on the citizen's applications and the real
// payment history from /api/payments. Paying hands off to the payment
// page (/payment/:id), which also shows the receipt once paid.

import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCitizenCase } from '@/composables/useCitizenCase'
import { citizenPortalService } from '@/services/citizenPortalService'
import { paymentsService, type Payment, type PaymentStatus, type CouncilCharge } from '@/services/paymentsService'
import PaymentMethodPicker from '@/components/PaymentMethodPicker.vue'
import type { PermitApplication } from '@/services/developmentManagementService'
import { AlertTriangle, Home, Info, ReceiptText, RefreshCw } from 'lucide-vue-next'

const router = useRouter()
const cc = useCitizenCase()

const payments = ref<Payment[]>([])
const charges = ref<CouncilCharge[]>([])
const paynowLive = ref(false)
const loading = ref(false)
const loadError = ref('')
const applicationFee = ref<number | null>(null)
const selected = ref<CouncilCharge | null>(null)
const accountRef = ref('')
const billAmount = ref('')
const paying = ref(false)
const payError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [mine, tariff, methods] = await Promise.all([
      paymentsService.listMine(),
      paymentsService.tariff(),
      paymentsService.methods().catch(() => []),
    ])
    payments.value = mine
    charges.value = tariff
    paynowLive.value = methods.some(m => m.id === 'paynow' && m.live)
  } catch {
    loadError.value = 'Could not load your payment history. Check your connection and try again.'
  } finally {
    loading.value = false
  }
}
onMounted(() => {
  load()
  citizenPortalService.getCouncil()
    .then(c => { applicationFee.value = Number.isFinite(c.application_fee) ? c.application_fee : null })
    .catch(() => { /* fee line shows "confirmed at invoice" */ })
})

const outstanding = computed(() => cc.applications.value.filter(p => !p.fee_paid))
const history = computed(() =>
  [...payments.value].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))

function openPaymentFor(p: PermitApplication): Payment | undefined {
  return payments.value.find(x => x.relatedId === p.id && (x.status === 'pending' || x.status === 'awaiting_provider'))
}
function payNow(p: PermitApplication) {
  const live = openPaymentFor(p)
  if (live) router.push(`/payment/${live.id}`)
  else router.push({ path: '/payment/new', query: { relatedKind: 'permit', relatedId: p.id } })
}

const STATUS: Record<PaymentStatus, { label: string; cls: string }> = {
  pending:           { label: 'Started',       cls: 'pill-amber' },
  awaiting_provider: { label: 'Awaiting wallet', cls: 'pill-amber' },
  paid:              { label: 'Paid',          cls: 'pill-green' },
  failed:            { label: 'Failed',        cls: 'pill-red' },
  cancelled:         { label: 'Cancelled',     cls: 'pill-gray' },
  refunded:          { label: 'Refunded',      cls: 'pill-gray' },
}
const PURPOSE: Record<string, string> = {
  application_fee: 'Development application',
  inspection_fee: 'Stage inspection',
  permit_fee: 'Development permit',
  occupation_certificate: 'Occupation certificate',
  land_rates: 'Land rates',
  supplementary_charge: 'Supplementary charge',
  rates_clearance: 'Rates clearance certificate',
  shop_licence: 'Shop licence',
  vendor_permit: 'Vendor permit',
  refuse_charge: 'Refuse removal',
  water_charge: 'Water',
  sewer_charge: 'Sewerage',
  cemetery_fee: 'Cemetery',
  market_fee: 'Market stall',
  stand_deposit: 'Stand deposit',
  lease_rent: 'Lease rent',
  plan_scrutiny: 'Plan scrutiny',
  advertisement_fee: 'Advertisement permit',
  wayleave_fee: 'Wayleave',
  property_search: 'Property search',
  hall_hire: 'Hall hire',
  dog_licence: 'Dog licence',
  appeal_fee: 'Appeal',
}
function purposeLabel(p: string) {
  return charges.value.find(c => c.code === p)?.title ?? PURPOSE[p] ?? p.replace(/_/g, ' ')
}

const departments = computed(() => {
  const order: string[] = []
  for (const c of charges.value) if (!order.includes(c.department)) order.push(c.department)
  return order.map(name => ({ name, items: charges.value.filter(c => c.department === name) }))
})

function choose(c: CouncilCharge) {
  selected.value = c
  accountRef.value = ''
  billAmount.value = ''
  payError.value = ''
}
function chargePrice(c: CouncilCharge | null): number | null {
  if (!c) return null
  if (c.pricedBy === 'tariff') return c.amountUsd
  const n = Number(billAmount.value)
  return Number.isFinite(n) && n >= 0.01 ? n : null
}

async function onPay(p: { wallet: 'ecocash' | 'onemoney' | 'innbucks'; phone: string; walletCcy: 'USD' | 'ZWG' }) {
  const charge = selected.value
  const price = chargePrice(charge)
  if (!charge || price == null || paying.value) return
  if (charge.pricedBy === 'bill' && accountRef.value.trim().length < 2) {
    payError.value = 'Enter the stand or account number on the statement.'
    return
  }
  paying.value = true
  payError.value = ''
  try {
    const payment = await paymentsService.init({
      purpose: charge.code,
      relatedKind: 'council_charge',
      relatedId: charge.code,
      priceUsd: price,
      walletCcy: p.walletCcy,
      driver: paynowLive.value ? 'paynow' : 'manual',
      metadata: {
        phone: p.phone,
        wallet: p.wallet,
        accountRef: accountRef.value.trim() || undefined,
      },
    })
    selected.value = null
    router.push(`/payment/${payment.id}`)
  } catch {
    payError.value = 'Payment could not start. Check the details and try again.'
  } finally {
    paying.value = false
  }
}
function caseFor(pay: Payment) { return cc.applications.value.find(a => a.id === pay.relatedId) }
function amount(pay: Payment) {
  return pay.walletCcy === 'ZWG'
    ? `ZWG ${pay.amountZwg.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `USD ${pay.amountUsd.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <div class="pay">
    <header class="pay-header">
      <div>
        <h1>Payments &amp; fees</h1>
        <p>Pay rates, licences, permits and the other charges a resident settles with the council.</p>
      </div>
      <button type="button" class="pay-refresh" :disabled="loading" title="Refresh" aria-label="Refresh" @click="load">
        <RefreshCw :size="16" :class="{ spin: loading }" />
      </button>
    </header>

    <div class="pay-grid">
      <section class="pay-main">
        <div class="cp-card">
          <div class="cp-card-head between">
            <h2>Council charges</h2>
            <span>{{ charges.length }}</span>
          </div>
          <p class="pay-intro">Choose a charge. EcoCash, OneMoney and InnBucks go through Paynow. The amount on a fixed charge comes from the working tariff. Rates, water, refuse, sewer and lease rent use the amount on your statement.</p>
          <div v-for="group in departments" :key="group.name" class="pay-dept">
            <h3>{{ group.name }}</h3>
            <div v-for="c in group.items" :key="c.code" class="pay-charge">
              <div>
                <p class="pay-row-title">{{ c.title }}</p>
                <p class="pay-row-sub">{{ c.detail }}</p>
              </div>
              <div class="pay-pending-r">
                <p class="pay-due">{{ c.pricedBy === 'tariff' && c.amountUsd != null ? `USD ${c.amountUsd.toFixed(2)}` : c.unitLabel }}</p>
                <button type="button" class="pay-btn primary" @click="choose(c)">Pay</button>
              </div>
            </div>
          </div>
          <div v-if="selected" class="pay-checkout">
            <h3>Pay {{ selected.title }}</h3>
            <p class="pay-row-sub">{{ selected.detail }}</p>
            <template v-if="selected.pricedBy === 'bill'">
              <label class="pay-field">Stand or account number
                <input v-model="accountRef" type="text" maxlength="64" placeholder="Account or stand number" />
              </label>
              <label class="pay-field">Amount on the statement (USD)
                <input v-model="billAmount" type="number" min="0.01" step="0.01" placeholder="0.00" />
              </label>
            </template>
            <PaymentMethodPicker
              v-if="chargePrice(selected) != null"
              :title="selected.title"
              :price-usd="chargePrice(selected)!"
              :council="{ name: 'Vungu Rural District Council' }"
              :busy="paying"
              @submit="onPay"
              @cancel="selected = null"
            />
            <p v-else class="pay-row-sub">Enter the amount on the statement to continue.</p>
            <p v-if="payError" class="pay-error" role="alert">{{ payError }}</p>
          </div>
        </div>

        <!-- Owed -->
        <div class="cp-card">
          <div class="cp-card-head between">
            <h2><AlertTriangle :size="16" class="ic-err" /> Fees owed</h2>
            <span v-if="outstanding.length" class="pill pill-red">{{ outstanding.length }} to pay</span>
          </div>
          <div v-if="!outstanding.length" class="pay-empty">
            {{ cc.applications.value.length ? 'Nothing owed. All application fees are paid.' : 'Fees appear here after you submit an application.' }}
          </div>
          <div v-else class="pay-pending">
            <div v-for="p in outstanding" :key="p.id" class="pay-pending-row">
              <div class="pay-pending-l">
                <div class="pay-ic"><Home :size="20" /></div>
                <div>
                  <p class="pay-row-title">Stand {{ p.stand_number }}, {{ p.suburb_ward }}</p>
                  <p class="pay-row-sub">Development application fee<template v-if="applicationFee != null"> · USD {{ applicationFee.toFixed(2) }}</template></p>
                  <p class="pay-mono">{{ p.dev_register_no || p.id.slice(0, 12) }}</p>
                </div>
              </div>
              <div class="pay-pending-r">
                <p v-if="openPaymentFor(p)" class="pay-due">A payment is already started</p>
                <button type="button" class="pay-btn primary" @click="payNow(p)">
                  {{ openPaymentFor(p) ? 'Continue payment' : 'Pay now' }}
                </button>
              </div>
            </div>
            <div class="pay-note">
              <Info :size="16" />
              <span>Pay promptly. An unpaid fee holds up processing of your application.</span>
            </div>
          </div>
        </div>

        <!-- History -->
        <div class="cp-card">
          <div class="cp-card-head between"><h2>Payment history</h2><span>{{ history.length }}</span></div>
          <div v-if="loadError" class="pay-error" role="alert">
            {{ loadError }} <button type="button" class="pay-link" @click="load">Retry</button>
          </div>
          <div v-else-if="loading && !history.length" class="pay-empty">Loading payments…</div>
          <div v-else-if="!history.length" class="pay-empty">No payments yet.</div>
          <table v-else class="pay-table">
            <thead><tr><th>Date</th><th>For</th><th>Amount</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>
              <tr v-for="x in history" :key="x.id">
                <td class="pay-nowrap">{{ fmtDate(x.paidAt || x.createdAt) }}</td>
                <td>
                  <span class="pay-svc">{{ purposeLabel(x.purpose) }}</span>
                  <span v-if="caseFor(x)" class="pay-sub">Stand {{ caseFor(x)!.stand_number }} · {{ caseFor(x)!.dev_register_no || '' }}</span>
                </td>
                <td class="pay-amount">{{ amount(x) }}</td>
                <td><span class="pill" :class="STATUS[x.status]?.cls || 'pill-gray'">{{ STATUS[x.status]?.label || x.status }}</span></td>
                <td class="pay-right">
                  <button type="button" class="pay-link" @click="router.push(`/payment/${x.id}`)">
                    <template v-if="x.status === 'paid'"><ReceiptText :size="13" /> Receipt</template>
                    <template v-else-if="x.status === 'pending' || x.status === 'awaiting_provider'">Continue</template>
                    <template v-else>Details</template>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <aside class="pay-side">
        <div class="cp-card">
          <div class="cp-card-head"><h2>Council fees</h2></div>
          <dl class="pay-fees">
            <div v-for="c in charges.filter(x => x.pricedBy === 'tariff')" :key="c.code">
              <dt>{{ c.title }}</dt>
              <dd>{{ c.amountUsd != null ? `USD ${c.amountUsd.toFixed(2)}` : 'As billed' }}</dd>
            </div>
          </dl>
          <p class="pay-fees-note">This is the working tariff in the system. Finance replaces a figure when Council adopts a new one. Account charges are the amount on the statement.</p>
        </div>
        <div class="pay-secure">
          <h3>How payment works</h3>
          <p>Pay by EcoCash, OneMoney or InnBucks. Paynow sends the prompt to your phone when the council Paynow account is connected. Until then, confirming the payment on the next screen issues the council receipt.</p>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* Tokens (--cp-*) inherited from .cp-root */
.pay { padding:1rem; display:flex; flex-direction:column; gap:1rem; max-width:1200px; margin:0 auto; width:100%; }
.pay-header { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; }
.pay-header h1 { margin:0; font-size:1.25rem; font-weight:700; letter-spacing:-0.01em; color:var(--cp-text); }
.pay-header p  { margin:0.2rem 0 0; font-size:0.85rem; color:var(--cp-text-2); }
.pay-refresh { background:none; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); padding:0.4rem; color:var(--cp-muted); cursor:pointer; }
.spin { animation: payspin 0.8s linear infinite; }
@keyframes payspin { to { transform: rotate(360deg); } }

.pay-grid { display:flex; flex-direction:column; gap:1rem; }
.pay-main, .pay-side { display:flex; flex-direction:column; gap:1rem; min-width:0; }

.cp-card { background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius); box-shadow:var(--cp-shadow); overflow:hidden; }
.cp-card-head { display:flex; align-items:center; gap:0.5rem; padding:0.85rem 1rem; border-bottom:1px solid var(--cp-border); }
.cp-card-head.between { justify-content:space-between; }
.cp-card-head h2 { display:flex; align-items:center; gap:0.4rem; margin:0; font-size:0.95rem; font-weight:600; color:var(--cp-text); }
.cp-card-head > span { font-size:0.72rem; color:var(--cp-muted); }
.ic-err { color:var(--cp-red-fg); }

.pay-empty { padding:1.75rem 1rem; text-align:center; color:var(--cp-muted); font-size:0.82rem; }
.pay-error { padding:1rem; font-size:0.82rem; color:var(--cp-red-fg); background:var(--cp-red-bg); }

.pill { display:inline-flex; align-items:center; gap:0.25rem; padding:0.15rem 0.55rem;
  border-radius:var(--cp-radius-pill); font-size:0.66rem; font-weight:700; letter-spacing:0.02em; white-space:nowrap; }
.pill-red   { background:var(--cp-red-bg);   color:var(--cp-red-fg); }
.pill-green { background:var(--cp-green-bg); color:var(--cp-green-fg); }
.pill-amber { background:var(--cp-amber-bg); color:var(--cp-amber-fg); }
.pill-gray  { background:var(--cp-surface-2); color:var(--cp-muted); }

.pay-pending { padding:1rem; display:flex; flex-direction:column; gap:0.85rem; }
.pay-pending-row { display:flex; justify-content:space-between; flex-wrap:wrap; gap:1rem;
  background:var(--cp-surface-2); border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); padding:1rem; }
.pay-pending-l { display:flex; gap:0.85rem; min-width:0; }
.pay-ic { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:40px; height:40px; border-radius:var(--cp-radius-sm); background:var(--cp-surface);
  border:1px solid var(--cp-border); color:var(--cp-primary); }
.pay-row-title { margin:0; font-size:0.92rem; font-weight:600; color:var(--cp-text); }
.pay-row-sub   { margin:0.1rem 0 0; font-size:0.78rem; color:var(--cp-text-2); }
.pay-mono { margin:0.3rem 0 0; font-family:var(--cp-mono); font-size:0.72rem; color:var(--cp-muted); }
.pay-pending-r { display:flex; flex-direction:column; align-items:flex-end; justify-content:center; gap:0.3rem; }
.pay-due { margin:0; font-size:0.72rem; color:var(--cp-muted); }
.pay-btn { display:inline-flex; align-items:center; justify-content:center; gap:0.3rem;
  padding:0.5rem 1rem; border:1px solid transparent; border-radius:var(--cp-radius-sm);
  font-size:0.82rem; font-weight:600; cursor:pointer; min-height:40px; }
.pay-btn.primary { background:var(--cp-primary); color:var(--cp-on-primary); }
.pay-btn.primary:hover { background:var(--cp-primary-hover); }
.pay-note { display:flex; align-items:center; gap:0.5rem; font-size:0.78rem; color:var(--cp-muted); }
.pay-note :deep(svg) { color:var(--cp-primary); flex-shrink:0; }

.pay-table { width:100%; border-collapse:collapse; font-size:0.8rem; }
.pay-table th, .pay-table td { padding:0.65rem 1rem; text-align:left; border-bottom:1px solid var(--cp-border); vertical-align:top; }
.pay-table th { font-size:0.62rem; color:var(--cp-muted); text-transform:uppercase; letter-spacing:0.05em; background:var(--cp-surface-2); }
.pay-table tr:last-child td { border-bottom:0; }
.pay-svc { display:block; font-weight:600; color:var(--cp-text); }
.pay-sub { display:block; font-size:0.72rem; color:var(--cp-muted); }
.pay-amount { font-family:var(--cp-mono); white-space:nowrap; color:var(--cp-text); }
.pay-nowrap { white-space:nowrap; color:var(--cp-text-2); }
.pay-right { text-align:right; }
.pay-link { display:inline-flex; align-items:center; gap:0.25rem; border:0; background:none; padding:0;
  color:var(--cp-primary); font-size:0.78rem; font-weight:600; cursor:pointer; }
.pay-link:hover { text-decoration:underline; }

.pay-fees { margin:0; padding:0.85rem 1rem 0; }
.pay-fees div { display:flex; justify-content:space-between; gap:1rem; font-size:0.84rem; }
.pay-fees dt { color:var(--cp-text-2); }
.pay-fees dd { margin:0; font-family:var(--cp-mono); font-weight:600; color:var(--cp-text); }
.pay-fees-note { margin:0; padding:0.75rem 1rem 1rem; font-size:0.76rem; line-height:1.5; color:var(--cp-muted); }

.pay-secure { padding:1.1rem 1.25rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius); background:var(--cp-surface); }
.pay-secure h3 { margin:0 0 0.35rem; font-size:0.95rem; font-weight:600; color:var(--cp-text); }
.pay-secure p  { margin:0; font-size:0.82rem; line-height:1.5; color:var(--cp-text-2); }

.pay-intro { margin:0; padding:0.85rem 1rem; font-size:0.8rem; line-height:1.5; color:var(--cp-text-2); border-bottom:1px solid var(--cp-border); }
.pay-dept { padding:0.4rem 0 0.2rem; }
.pay-dept h3 { margin:0; padding:0.55rem 1rem 0.2rem; font-size:0.68rem; letter-spacing:0.06em; text-transform:uppercase; color:var(--cp-muted); }
.pay-charge { display:flex; justify-content:space-between; gap:1rem; padding:0.7rem 1rem; border-top:1px solid var(--cp-border); }
.pay-checkout { padding:1rem; border-top:1px solid var(--cp-border); background:var(--cp-surface-2); }
.pay-checkout h3 { margin:0 0 0.25rem; font-size:1rem; }
.pay-field { display:flex; flex-direction:column; gap:0.25rem; margin:0.6rem 0; font-size:0.78rem; font-weight:600; color:var(--cp-text-2); }
.pay-field input { font:inherit; font-weight:500; padding:0.5rem 0.65rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); background:var(--cp-surface); color:var(--cp-text); }

@media (max-width: 640px) {
  .pay-table thead { display:none; }
  .pay-table tr { display:grid; grid-template-columns:1fr auto; gap:0.2rem 0.75rem; padding:0.75rem 1rem; border-bottom:1px solid var(--cp-border); }
  .pay-table td { padding:0; border:0; }
  .pay-table tr:last-child { border-bottom:0; }
}
@media (min-width: 1024px) {
  .pay { padding:1.5rem; }
  .pay-grid { display:grid; grid-template-columns:2fr 1fr; align-items:start; }
}
</style>
