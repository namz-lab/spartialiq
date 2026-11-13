<script setup lang="ts">
/**
 * Banking: what each till holds, and the takings carried to the bank.
 *
 * The till position is shown three ways because they are three different facts and the gap between
 * them is where money goes missing: what the BOOK says the till holds, what is in the drawer from
 * sessions nobody has verified, and what has been carried to the bank but not yet posted. Only the
 * first can be banked — the server refuses anything more — so the form says how much that is.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { AlertTriangle, Landmark } from 'lucide-vue-next'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { cashApi } from '../../api/cashApi'
import { formatMoney, formatDate, type Currency } from '../../composables/useMoney'
import { centsToText, toCents } from '../../composables/cashMath'
import type { BankDeposit, CashDesk } from '../../models/cashTypes'

const props = defineProps<{ desk: CashDesk }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const store = useFinanceStore()
const canBank = computed(() => store.can('finance.cash.deposit.prepare'))
const canPost = computed(() => store.can('finance.ledger.voucher.post'))
const me = computed(() => store.identity?.user_id ?? null)

const deposits = ref<BankDeposit[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const form = reactive({ cash_point_id: '', currency: 'USD' as Currency, amount: '', bank_account_id: '', slip_reference: '', financial_year_id: '' })

const signed = (text: string): bigint => {
  const negative = text.startsWith('-')
  const cents = toCents(negative ? text.slice(1) : text) ?? 0n
  return negative ? -cents : cents
}
/** What the server will accept: in the book, less what is already on its way to the bank. */
const bankable = computed<string | null>(() => {
  const row = props.desk.till_position.find((p) => p.cash_point_id === form.cash_point_id && p.currency === form.currency)
  if (!row) return form.cash_point_id ? '0.00' : null
  return centsToText(signed(row.ledger_balance) - signed(row.deposits_awaiting_posting))
})

watch(() => props.desk.cash_points, (points) => {
  if (!points.some((p) => p.id === form.cash_point_id)) form.cash_point_id = points.find((p) => p.status === 'active')?.id ?? ''
}, { immediate: true })
watch(() => props.desk.bank_accounts, (banks) => {
  if (!banks.some((b) => b.id === form.bank_account_id)) form.bank_account_id = banks.length === 1 ? banks[0].id : ''
}, { immediate: true })
watch(() => props.desk.financial_years, (years) => {
  if (!years.some((y) => y.id === form.financial_year_id)) form.financial_year_id = years.length === 1 ? years[0].id : ''
}, { immediate: true })

async function load(): Promise<void> {
  loading.value = true
  try {
    deposits.value = (await cashApi.deposits({ limit: 50 })).deposits
  } catch (err) {
    error.value = messageOf(err, 'The bankings could not be read.')
  } finally {
    loading.value = false
  }
}

async function prepare(): Promise<void> {
  if (busy.value) return
  if (toCents(form.amount.trim()) === null || toCents(form.amount.trim()) === 0n) { error.value = 'A banking is for an amount such as 412.50.'; return }
  if (form.slip_reference.trim().length < 3) { error.value = 'Enter the reference stamped on the bank\'s deposit slip.'; return }
  busy.value = true
  error.value = null
  notice.value = null
  try {
    const result = await cashApi.prepareDeposit({
      cash_point_id: form.cash_point_id, currency: form.currency, amount: form.amount.trim(),
      bank_account_id: form.bank_account_id, slip_reference: form.slip_reference.trim(),
      ...(form.financial_year_id ? { financial_year_id: form.financial_year_id } : {}),
    })
    notice.value = `${result.deposit.deposit_no}: ${result.note}`
    form.amount = ''
    form.slip_reference = ''
    await load()
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, 'The banking could not be recorded.')
  } finally {
    busy.value = false
  }
}

async function post(deposit: BankDeposit): Promise<void> {
  busy.value = true
  error.value = null
  notice.value = null
  try {
    const result = await cashApi.postDeposit(deposit.id)
    notice.value = `${result.posted}: ${result.note}`
    await load()
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, 'The banking could not be posted.')
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="cash-banking">
    <p v-if="error" class="ins-banner t-negative" role="alert"><AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span></p>
    <p v-if="notice" class="ins-banner t-positive" role="status"><span>{{ notice }}</span></p>

    <div class="cash-bank-layout" :class="{ 'is-formless': !canBank }">
      <div class="cash-bank-main">
        <section class="ins-card" aria-labelledby="cash-pos">
          <div class="ins-card-head">
            <h3 id="cash-pos">What each till holds <span class="ins-count">{{ desk.till_position.length }}</span></h3>
            <span class="ins-hint">Book, drawer and bank are three different facts.</span>
          </div>
          <div v-if="desk.till_position.length === 0" class="ins-card-body">
            <p class="ins-hint">No till holds anything: no session has takings waiting to be verified, and nothing verified is waiting to be banked.</p>
          </div>
          <div v-else class="fin-table-wrap">
            <table class="fin-table">
              <caption>Per cash point and currency. Only what the book of account holds can be banked.</caption>
              <thead><tr>
                <th scope="col">Cash point</th><th scope="col">Currency</th>
                <th scope="col" class="num">In the book of account</th>
                <th scope="col" class="num">In the drawer, not yet verified</th>
                <th scope="col" class="num">On its way to the bank</th>
              </tr></thead>
              <tbody>
                <tr v-for="p in desk.till_position" :key="`${p.cash_point_id}-${p.currency}`">
                  <td>{{ p.name }}</td><td class="ccy">{{ p.currency }}</td>
                  <td class="num emphasis">{{ formatMoney(p.ledger_balance, p.currency, { bare: true }) }}</td>
                  <td class="num">{{ formatMoney(p.unverified_takings, p.currency, { bare: true }) }}</td>
                  <td class="num">{{ formatMoney(p.deposits_awaiting_posting, p.currency, { bare: true }) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="ins-card" aria-labelledby="cash-deps">
          <div class="ins-card-head"><h3 id="cash-deps">Bankings <span class="ins-count">{{ deposits.length }}</span></h3></div>
          <div v-if="!loading && deposits.length === 0" class="ins-card-body">
            <p class="ins-hint">No banking has been recorded. A banking moves takings from a till to the bank account, against the bank's deposit slip, and is posted by somebody other than whoever prepared it.</p>
          </div>
          <div v-else class="fin-table-wrap">
            <table class="fin-table">
              <thead><tr>
                <th scope="col">Banking</th><th scope="col">Date</th><th scope="col">From</th><th scope="col">Into</th><th scope="col">Slip</th>
                <th scope="col">Currency</th><th scope="col" class="num">Amount</th><th scope="col">Prepared by</th><th scope="col">In the book</th>
              </tr></thead>
              <tbody>
                <tr v-for="d in deposits" :key="d.id">
                  <td class="cash-mono">{{ d.deposit_no }}</td>
                  <td>{{ formatDate(d.deposited_on) }}</td>
                  <td>{{ d.cash_point_name }}</td>
                  <td>{{ d.bank_account_name }}</td>
                  <td>{{ d.slip_reference }}</td>
                  <td class="ccy">{{ d.currency }}</td>
                  <td class="num">{{ formatMoney(d.amount, d.currency, { bare: true }) }}</td>
                  <td>{{ d.prepared_by_name }}</td>
                  <td>
                    <template v-if="d.voucher_status === 'posted'">Posted by {{ d.posted_by_name }}</template>
                    <template v-else-if="canPost && d.prepared_by !== me">
                      <button type="button" class="fin-btn small primary" :disabled="busy" @click="post(d)">Post</button>
                    </template>
                    <template v-else-if="d.prepared_by === me">Awaiting somebody else</template>
                    <template v-else>Not yet</template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <form v-if="canBank" class="ins-card cash-bank-card" @submit.prevent="prepare">
        <div class="ins-card-head"><h3><Landmark :size="16" aria-hidden="true" /> Record a banking</h3></div>
        <div class="cash-bank-body">
          <section class="cash-bank-section">
            <h4 class="cash-bank-section-title">From the till</h4>
            <label class="ins-field">
              <span class="ins-label">Cash point</span>
              <select v-model="form.cash_point_id" class="ins-input" required>
                <option v-for="p in desk.cash_points.filter((x) => x.status === 'active')" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </label>
            <div class="ins-field">
              <span id="cash-bank-ccy" class="ins-label">Currency</span>
              <div class="ins-seg" role="radiogroup" aria-labelledby="cash-bank-ccy">
                <button type="button" role="radio" :aria-checked="form.currency === 'USD'" @click="form.currency = 'USD'">US$</button>
                <button type="button" role="radio" :aria-checked="form.currency === 'ZWG'" @click="form.currency = 'ZWG'">ZWG</button>
              </div>
            </div>
          </section>

          <section class="cash-bank-section">
            <h4 class="cash-bank-section-title">Amount and account</h4>
            <label class="ins-field">
              <span class="ins-label">Amount banked ({{ form.currency }})</span>
              <input v-model="form.amount" class="ins-input cash-num" inputmode="decimal" placeholder="0.00" autocomplete="off" required />
              <span v-if="bankable !== null" class="ins-hint cash-bankable">Up to <strong>{{ formatMoney(bankable, form.currency) }}</strong> can be banked from this till. Takings count once their cash-up is verified.</span>
            </label>
            <label class="ins-field">
              <span class="ins-label">Into bank account</span>
              <select v-model="form.bank_account_id" class="ins-input" required>
                <option value="" disabled>Choose the bank account</option>
                <option v-for="b in desk.bank_accounts" :key="b.id" :value="b.id">{{ b.code }} — {{ b.name }}</option>
              </select>
            </label>
          </section>

          <section class="cash-bank-section">
            <h4 class="cash-bank-section-title">The bank's record</h4>
            <label class="ins-field">
              <span class="ins-label">Deposit slip reference</span>
              <input v-model="form.slip_reference" class="ins-input" autocomplete="off" placeholder="As stamped by the bank" required />
            </label>
            <label v-if="desk.financial_years.length > 1" class="ins-field">
              <span class="ins-label">Financial year</span>
              <select v-model="form.financial_year_id" class="ins-input" required>
                <option value="" disabled>Choose the year</option>
                <option v-for="y in desk.financial_years" :key="y.id" :value="y.id">{{ y.label }}</option>
              </select>
            </label>
          </section>
        </div>
        <div class="ins-card-foot">
          <button type="submit" class="fin-btn primary" :disabled="busy || !form.cash_point_id || !form.bank_account_id">{{ busy ? 'Recording…' : 'Record banking' }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.cash-banking { display: flex; flex-direction: column; gap: var(--ent-s4); }

.cash-bank-layout {
  display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(18rem, 24rem);
  gap: var(--ent-s4); align-items: start;
}
.cash-bank-layout.is-formless { grid-template-columns: minmax(0, 1fr); }
.cash-bank-main { display: flex; flex-direction: column; gap: var(--ent-s4); min-width: 0; }

.cash-bank-card { display: flex; flex-direction: column; position: sticky; top: var(--ent-s4); }
.cash-bank-body { display: flex; flex-direction: column; gap: var(--ent-s4); padding: var(--ent-s4); }
.cash-bank-section { display: flex; flex-direction: column; gap: var(--ent-s2); }
.cash-bank-section + .cash-bank-section { padding-top: var(--ent-s4); border-top: 1px solid var(--ent-line); }
.cash-bank-section-title {
  margin: 0; font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--ent-text-3);
}
.cash-bankable strong { font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums; color: var(--ent-text); }

.cash-num { font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums; text-align: right; }
.cash-mono { font-family: var(--ent-font-mono); font-size: 0.95em; white-space: nowrap; }

@media (max-width: 1100px) {
  .cash-bank-layout { grid-template-columns: minmax(0, 1fr); }
  .cash-bank-card { position: static; }
}
</style>
