<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Smartphone, Wallet, Coins, CreditCard, Circle } from 'lucide-vue-next'

type ActiveWallet = 'ecocash' | 'onemoney' | 'innbucks'

interface Props {
  priceUsd: number
  council:  { name: string }
  title?: string
  defaultWalletCcy?: 'USD' | 'ZWG'
  /**
   * True while the parent has a submit/payment request in flight. The parent
   * owns this because only it knows when the network call has settled — the
   * picker cannot see past its own emit.
   */
  busy?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  title: 'Pay application fee',
  defaultWalletCcy: 'USD',
  busy: false,
})
const emit = defineEmits<{
  (e: 'submit', payload: { wallet: ActiveWallet; phone: string; walletCcy: 'USD'|'ZWG' }): void
  (e: 'cancel'): void
}>()

// Lucide icons, not emoji: emoji render differently per platform, are read out
// verbatim by screen readers, and the brand rules ban them in the UI.
const ACTIVE: Array<{ id: ActiveWallet; name: string; icon: unknown; prefixHint: string }> = [
  { id: 'ecocash',  name: 'EcoCash',  icon: Smartphone, prefixHint: '077 / 078' },
  { id: 'onemoney', name: 'OneMoney', icon: Wallet,     prefixHint: '071' },
  { id: 'innbucks', name: 'InnBucks', icon: Coins,      prefixHint: '086' },
]
const COMING: Array<{ id: string; name: string; icon: unknown }> = [
  { id: 'card',      name: 'Card',       icon: CreditCard },
  { id: 'googlepay', name: 'Google Pay', icon: Circle },
  { id: 'applepay',  name: 'Apple Pay',  icon: Circle },
]

const PREFIX_RE: Record<ActiveWallet, RegExp> = {
  ecocash:  /^(?:\+?263|0)?(77|78)\d{7}$/,
  onemoney: /^(?:\+?263|0)?71\d{7}$/,
  innbucks: /^(?:\+?263|0)?86\d{7}$/,
}
const PREFIX_LABEL: Record<ActiveWallet, string> = {
  ecocash:  'EcoCash numbers start with 077 or 078',
  onemoney: 'OneMoney numbers start with 071',
  innbucks: 'InnBucks numbers start with 086',
}

const wallet    = ref<ActiveWallet | null>(null)
const phone     = ref('')
const walletCcy = ref<'USD' | 'ZWG'>(props.defaultWalletCcy)

const prefixError = computed(() => {
  if (!wallet.value || !phone.value) return ''
  return PREFIX_RE[wallet.value].test(phone.value.replace(/\s/g, ''))
    ? ''
    : PREFIX_LABEL[wallet.value]
})

// Local latch. `busy` only turns true after the parent's handler starts, which
// is one microtask later than a second click on the same tick — so a
// double-click (or Enter held down) could fire two `submit` events before the
// prop ever flips. This closes that window synchronously; the parent's `busy`
// then keeps the button disabled for the whole request.
const emitted = ref(false)
watch(() => props.busy, (isBusy) => {
  // Parent finished (success or failure). Releasing the latch here — and only
  // here — is what makes retry-after-error possible without allowing a retry
  // while the first attempt is still running.
  if (!isBusy) emitted.value = false
})

const canPay = computed(() => Boolean(
  wallet.value
    && phone.value
    && !prefixError.value
    && walletCcy.value
    && !props.busy
    && !emitted.value,
))

function normalisedPhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.startsWith('263')) return '+' + digits
  if (digits.startsWith('0'))   return '+263' + digits.slice(1)
  return '+263' + digits
}

function onPay() {
  if (!canPay.value || !wallet.value) return
  emitted.value = true
  // Hand the lock over to the parent's `busy`. If a caller does not manage
  // `busy` at all, release on the next tick rather than latching the button
  // shut forever — that still blocks the same-tick double-click, which is the
  // race that duplicates a payment.
  nextTick(() => { if (!props.busy) emitted.value = false })
  emit('submit', {
    wallet:    wallet.value,
    phone:     normalisedPhone(phone.value),
    walletCcy: walletCcy.value,
  })
}

function fmtAmount(): string {
  const amt = Number(props.priceUsd)
  return walletCcy.value === 'USD'
    ? `USD ${amt.toFixed(2)}`
    : `ZWG ${amt.toFixed(2)} (quoted at submit)`
}
</script>

<template>
  <div class="pmp">
    <header class="pmp-head">
      <div>
        <h3>{{ title }}</h3>
        <p class="pmp-sub">{{ council.name }} · {{ fmtAmount() }}</p>
      </div>
      <button class="pmp-close" data-test="pmp-close" @click="emit('cancel')" aria-label="Close">✕</button>
    </header>

    <p class="pmp-section">Pay with</p>
    <div class="pmp-grid">
      <button
        v-for="m in ACTIVE" :key="m.id"
        :data-tile="m.id"
        :class="['pmp-tile', { selected: wallet === m.id }]"
        @click="wallet = m.id"
      >
        <component :is="m.icon" class="pmp-ic" :size="20" aria-hidden="true" />
        <span class="pmp-name">{{ m.name }}</span>
        <span class="pmp-hint">{{ m.prefixHint }}</span>
      </button>
    </div>
    <div class="pmp-grid">
      <button
        v-for="m in COMING" :key="m.id"
        :data-tile="m.id"
        class="pmp-tile pmp-tile--coming"
        disabled
        title="Available once card payments are enabled"
      >
        <component :is="m.icon" class="pmp-ic" :size="20" aria-hidden="true" />
        <span class="pmp-name">{{ m.name }}</span>
        <span class="pmp-hint">Coming soon</span>
      </button>
    </div>

    <div v-if="wallet" class="pmp-fields">
      <label class="pmp-label" for="pmp-phone">Phone (+263)</label>
      <input
        id="pmp-phone" name="pmp-phone"
        :value="phone"
        class="pmp-input"
        placeholder="0771234567"
        type="tel"
        inputmode="tel"
        autocomplete="tel-national"
        @input="phone = ($event.target as HTMLInputElement).value.replace(/[^\d+]/g, '')"
      />
      <p v-if="prefixError" class="pmp-error">{{ prefixError }}</p>

      <label class="pmp-label" style="margin-top:0.6rem">Currency</label>
      <div class="pmp-currency">
        <label><input type="radio" name="pmp-ccy" value="USD" v-model="walletCcy" /> USD</label>
        <label><input type="radio" name="pmp-ccy" value="ZWG" v-model="walletCcy" /> ZWG</label>
      </div>
    </div>

    <div class="pmp-actions">
      <button
        class="pmp-pay" data-test="pmp-pay"
        :disabled="!canPay" :aria-busy="busy || emitted" @click="onPay"
      >{{ (busy || emitted) ? 'Processing payment…' : `Pay ${fmtAmount()}` }}</button>
      <p v-if="busy || emitted" class="pmp-busy" role="status">
        Do not close this page or press Pay again.
      </p>
    </div>
  </div>
</template>

<style scoped>
.pmp { background:#fff; border:1px solid #e2e8f0; border-radius:0.75rem; padding:1.25rem; display:flex; flex-direction:column; gap:0.75rem; max-width:520px; }
.pmp-head { display:flex; align-items:flex-start; justify-content:space-between; }
.pmp-head h3 { margin:0; font-size:1rem; font-weight:700; color:#0f172a; }
.pmp-sub { margin:0; color:#64748b; font-size:0.75rem; }
.pmp-close { background:none; border:none; cursor:pointer; font-size:1rem; color:#64748b; }
.pmp-section { margin:0.25rem 0 -0.25rem; font-size:0.65rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#94a3b8; }
.pmp-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:0.5rem; }
.pmp-tile { display:flex; flex-direction:column; align-items:center; gap:0.15rem; padding:0.65rem 0.45rem; border:1.5px solid #e2e8f0; border-radius:0.6rem; background:#f8fafc; cursor:pointer; font:inherit; }
.pmp-tile:hover { border-color:#cbd5e1; background:#fff; }
.pmp-tile.selected { border-color:#0f172a; box-shadow:0 0 0 3px rgba(15,23,42,0.08); background:#fff; }
.pmp-tile--coming { opacity:0.55; cursor:not-allowed; }
.pmp-tile--coming:hover { border-color:#e2e8f0; background:#f8fafc; }
.pmp-ic { color:#0f172a; }
.pmp-busy { margin:0.4rem 0 0; font-size:0.7rem; color:#64748b; text-align:center; }
.pmp-name { font-size:0.78rem; font-weight:600; color:#0f172a; }
.pmp-hint { font-size:0.6rem; color:#64748b; }
.pmp-fields { display:flex; flex-direction:column; gap:0.35rem; margin-top:0.25rem; }
.pmp-label { font-size:0.72rem; color:#475569; font-weight:600; }
.pmp-input { padding:0.55rem 0.75rem; border:1.5px solid #e2e8f0; border-radius:0.5rem; font-size:0.85rem; font:inherit; background:#f8fafc; }
.pmp-input:focus { outline:none; border-color:#0f172a; background:#fff; }
.pmp-error { margin:0; color:#b91c1c; font-size:0.7rem; }
.pmp-currency { display:flex; gap:1rem; font-size:0.78rem; color:#374151; }
.pmp-actions { margin-top:0.4rem; }
.pmp-pay { width:100%; padding:0.75rem 1rem; background:#0f172a; color:#fff; border:none; border-radius:0.6rem; font-weight:700; font-size:0.85rem; cursor:pointer; font:inherit; }
.pmp-pay:disabled { background:#cbd5e1; cursor:not-allowed; }
</style>
