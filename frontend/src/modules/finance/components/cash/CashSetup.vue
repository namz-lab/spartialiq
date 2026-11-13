<script setup lang="ts">
/**
 * Cash office setup: the counters and the Council's income list.
 *
 * Both are Council data (decision D22) and both are seeded empty. This screen maintains them; it
 * does not suggest them. There is no default counter and no starter list of fees, because an
 * officer could not tell a plausible default from something the Council resolved.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { AlertTriangle } from 'lucide-vue-next'
import { messageOf } from '../../stores/finance'
import { cashApi } from '../../api/cashApi'
import { formatMoney } from '../../composables/useMoney'
import { toCents } from '../../composables/cashMath'
import type { CashDesk, CashPoint, IncomeCode, SetupAccounts } from '../../models/cashTypes'

defineProps<{ desk: CashDesk }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const accounts = ref<SetupAccounts | null>(null)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref(false)

const point = reactive({ code: '', name: '', location: '', till_account_id: '', difference_account_id: '' })
const code = reactive({ code: '', name: '', ledger_account_id: '', department_id: '', pricing: 'variable' as 'fixed' | 'variable', unit_amount_usd: '', unit_amount_zwg: '' })

const chargeOk = (text: string) => text.trim() === '' || (toCents(text.trim()) ?? 0n) > 0n
const codeProblem = computed<string | null>(() => {
  if (!chargeOk(code.unit_amount_usd) || !chargeOk(code.unit_amount_zwg)) return 'A charge is an amount greater than nil, such as 40.00.'
  if (code.pricing === 'fixed' && !code.unit_amount_usd.trim() && !code.unit_amount_zwg.trim()) return 'A fixed charge needs an amount in at least one currency.'
  return null
})

async function run(work: () => Promise<unknown>, done: string, fallback: string): Promise<boolean> {
  if (busy.value) return false
  busy.value = true
  error.value = null
  notice.value = null
  try {
    await work()
    notice.value = done
    emit('changed')
    return true
  } catch (err) {
    error.value = messageOf(err, fallback)
    return false
  } finally {
    busy.value = false
  }
}

async function addPoint(): Promise<void> {
  const ok = await run(() => cashApi.createCashPoint({
    code: point.code.trim(), name: point.name.trim(), till_account_id: point.till_account_id,
    ...(point.location.trim() ? { location: point.location.trim() } : {}),
    ...(point.difference_account_id ? { difference_account_id: point.difference_account_id } : {}),
  }), `Cash point ${point.name.trim()} created.`, 'The cash point could not be created.')
  if (ok) Object.assign(point, { code: '', name: '', location: '', till_account_id: '', difference_account_id: '' })
}

async function addCode(): Promise<void> {
  if (codeProblem.value) { error.value = codeProblem.value; return }
  const ok = await run(() => cashApi.createIncomeCode({
    code: code.code.trim(), name: code.name.trim(), ledger_account_id: code.ledger_account_id, pricing: code.pricing,
    ...(code.department_id ? { department_id: code.department_id } : {}),
    ...(code.unit_amount_usd.trim() ? { unit_amount_usd: code.unit_amount_usd.trim() } : {}),
    ...(code.unit_amount_zwg.trim() ? { unit_amount_zwg: code.unit_amount_zwg.trim() } : {}),
  }), `Income code ${code.name.trim()} created.`, 'The income code could not be created.')
  if (ok) Object.assign(code, { code: '', name: '', ledger_account_id: '', department_id: '', pricing: 'variable', unit_amount_usd: '', unit_amount_zwg: '' })
}

const setDifference = (p: CashPoint, accountId: string) => run(
  () => cashApi.updateCashPoint(p.id, { difference_account_id: accountId || null }),
  `${p.name}: cash-difference account ${accountId ? 'set' : 'cleared'}.`, 'The cash point could not be changed.')
const togglePoint = (p: CashPoint) => run(
  () => cashApi.updateCashPoint(p.id, { status: p.status === 'active' ? 'inactive' : 'active' }),
  `${p.name} ${p.status === 'active' ? 'taken out of use' : 'brought back into use'}.`, 'The cash point could not be changed.')
const toggleCode = (c: IncomeCode) => run(
  () => cashApi.updateIncomeCode(c.id, { status: c.status === 'active' ? 'inactive' : 'active' }),
  `${c.name} ${c.status === 'active' ? 'taken off the counter' : 'put back on the counter'}.`, 'The income code could not be changed.')

onMounted(async () => {
  try { accounts.value = await cashApi.setupAccounts() } catch (err) { error.value = messageOf(err, 'The ledger accounts could not be read.') }
})
</script>

<template>
  <div class="cash-setup">
    <p v-if="error" class="ins-banner t-negative" role="alert"><AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span></p>
    <p v-if="notice" class="ins-banner t-positive" role="status"><span>{{ notice }}</span></p>

    <div v-if="accounts && accounts.till.length === 0" class="fin-empty" role="status">
      <strong>The ledger has no cash account for a till to use.</strong>
      <p>A cash point keeps its takings in a ledger account of type “cash” until they are banked. Create one in General ledger → Chart of accounts first; a bank account is where takings go afterwards, and cannot stand in for it.</p>
    </div>

    <section class="ins-card" aria-labelledby="cash-pts">
      <div class="ins-card-head">
        <h3 id="cash-pts">Cash points <span class="ins-count">{{ desk.cash_points.length }}</span></h3>
        <span class="ins-hint">Each keeps its takings in its own ledger account.</span>
      </div>
      <div class="cash-setup-body">
        <div class="cash-setup-list">
          <div v-if="desk.cash_points.length" class="fin-table-wrap">
            <table class="fin-table">
              <thead><tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Location</th><th scope="col">Cash-difference account</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
              <tbody>
                <tr v-for="p in desk.cash_points" :key="p.id">
                  <td class="cash-mono">{{ p.code }}</td><td>{{ p.name }}</td><td>{{ p.location || '—' }}</td>
                  <td>
                    <label class="sr-only" :for="`diff-${p.id}`">Cash-difference account for {{ p.name }}</label>
                    <select v-if="accounts" :id="`diff-${p.id}`" class="ins-input cash-inline" :disabled="busy" @change="setDifference(p, ($event.target as HTMLSelectElement).value)">
                      <option value="">{{ p.difference_account_set ? 'Set — choose to change' : 'Not set: a difference cannot be verified' }}</option>
                      <option v-for="a in accounts.difference" :key="a.id" :value="a.id">{{ a.code }} — {{ a.name }}</option>
                    </select>
                  </td>
                  <td><span class="fin-pill" :class="p.status === 'active' ? 'tone-positive' : ''">{{ p.status === 'active' ? 'In use' : 'Not in use' }}</span></td>
                  <td><button type="button" class="fin-btn small" :disabled="busy" @click="togglePoint(p)">{{ p.status === 'active' ? 'Take out of use' : 'Bring into use' }}</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="cash-setup-empty"><p class="ins-hint">No cash point exists. Until one does, no cashier can open a till.</p></div>
        </div>

        <form v-if="accounts" class="cash-setup-add" @submit.prevent="addPoint">
          <h4>Add a cash point</h4>
          <p class="ins-hint">The counter, and the ledger account its takings sit in until banked.</p>
          <div class="cash-grid">
            <label class="ins-field"><span class="ins-label">Code</span><input v-model="point.code" class="ins-input" required maxlength="30" autocomplete="off" /></label>
            <label class="ins-field"><span class="ins-label">Name</span><input v-model="point.name" class="ins-input" required minlength="2" autocomplete="off" placeholder="As the cashier knows it" /></label>
            <label class="ins-field"><span class="ins-label">Location</span><input v-model="point.location" class="ins-input" autocomplete="off" /></label>
            <label class="ins-field">
              <span class="ins-label">Till cash account</span>
              <select v-model="point.till_account_id" class="ins-input" required>
                <option value="" disabled>Where its takings sit until banked</option>
                <option v-for="a in accounts.till" :key="a.id" :value="a.id">{{ a.code }} — {{ a.name }}</option>
              </select>
            </label>
            <label class="ins-field">
              <span class="ins-label">Cash-difference account</span>
              <select v-model="point.difference_account_id" class="ins-input">
                <option value="">Decide later</option>
                <option v-for="a in accounts.difference" :key="a.id" :value="a.id">{{ a.code }} — {{ a.name }}</option>
              </select>
              <span class="ins-hint">Where an over or a short at cash-up is posted.</span>
            </label>
          </div>
          <button type="submit" class="fin-btn primary" :disabled="busy || !point.till_account_id">Add cash point</button>
        </form>
      </div>
    </section>

    <section class="ins-card" aria-labelledby="cash-codes">
      <div class="ins-card-head">
        <h3 id="cash-codes">Income codes <span class="ins-count">{{ desk.income_codes.length }}</span></h3>
        <span class="ins-hint">A fixed charge cannot be varied at the counter.</span>
      </div>
      <div class="cash-setup-body">
        <div class="cash-setup-list">
          <div v-if="desk.income_codes.length" class="fin-table-wrap">
            <table class="fin-table">
              <caption>What a cashier may receipt other than rates. A fixed charge cannot be varied at the counter; a charge in one currency says nothing about the other.</caption>
              <thead><tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Charge</th><th scope="col" class="num">US$</th><th scope="col" class="num">ZWG</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
              <tbody>
                <tr v-for="c in desk.income_codes" :key="c.id">
                  <td class="cash-mono">{{ c.code }}</td><td>{{ c.name }}</td>
                  <td>{{ c.pricing === 'fixed' ? 'Fixed by Council' : 'Assessed per case' }}</td>
                  <td class="num">{{ formatMoney(c.unit_amount_usd, 'USD', { bare: true }) }}</td>
                  <td class="num">{{ formatMoney(c.unit_amount_zwg, 'ZWG', { bare: true }) }}</td>
                  <td><span class="fin-pill" :class="c.status === 'active' ? 'tone-positive' : ''">{{ c.status === 'active' ? 'On the counter' : 'Off the counter' }}</span></td>
                  <td><button type="button" class="fin-btn small" :disabled="busy" @click="toggleCode(c)">{{ c.status === 'active' ? 'Take off' : 'Put back' }}</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="cash-setup-empty"><p class="ins-hint">The income list is empty. A cashier can take rates payments, and nothing else, until it is entered.</p></div>
        </div>

        <form v-if="accounts" class="cash-setup-add" @submit.prevent="addCode">
          <h4>Add an income code</h4>
          <p class="ins-hint">What the payer is charged, and the ledger account it is income of.</p>
          <div class="cash-grid">
            <label class="ins-field"><span class="ins-label">Code</span><input v-model="code.code" class="ins-input" required maxlength="30" autocomplete="off" /></label>
            <label class="ins-field"><span class="ins-label">Name</span><input v-model="code.name" class="ins-input" required minlength="2" autocomplete="off" placeholder="As the cashier and the payer know it" /></label>
            <label class="ins-field">
              <span class="ins-label">Revenue account</span>
              <select v-model="code.ledger_account_id" class="ins-input" required>
                <option value="" disabled>The ledger account it is income of</option>
                <option v-for="a in accounts.revenue" :key="a.id" :value="a.id">{{ a.code }} — {{ a.name }}</option>
              </select>
            </label>
            <label class="ins-field">
              <span class="ins-label">Vote (department)</span>
              <select v-model="code.department_id" class="ins-input">
                <option value="">None</option>
                <option v-for="d in accounts.departments" :key="d.id" :value="d.id">{{ d.code }} — {{ d.name }}</option>
              </select>
            </label>
            <label class="ins-field">
              <span class="ins-label">Charge</span>
              <select v-model="code.pricing" class="ins-input">
                <option value="variable">Assessed per case</option>
                <option value="fixed">Fixed by Council</option>
              </select>
            </label>
            <label class="ins-field"><span class="ins-label">US$ charge</span><input v-model="code.unit_amount_usd" class="ins-input cash-num" inputmode="decimal" placeholder="Not charged in US$" autocomplete="off" /></label>
            <label class="ins-field"><span class="ins-label">ZWG charge</span><input v-model="code.unit_amount_zwg" class="ins-input cash-num" inputmode="decimal" placeholder="Not charged in ZWG" autocomplete="off" /></label>
          </div>
          <button type="submit" class="fin-btn primary" :disabled="busy || !code.ledger_account_id">Add income code</button>
        </form>
      </div>
    </section>
  </div>
</template>

<style scoped>
.cash-setup { display: flex; flex-direction: column; gap: var(--ent-s4); }

/* Each section is a register on the left and the one form that adds to it on the right. */
.cash-setup-body {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(18rem, 22rem);
  align-items: start;
}
.cash-setup-list { min-width: 0; }
.cash-setup-empty { padding: var(--ent-s4); }

.cash-setup-add {
  display: flex; flex-direction: column; gap: var(--ent-s3);
  padding: var(--ent-s4); border-left: 1px solid var(--ent-line);
  background: var(--ent-surface-2);
}
.cash-setup-add h4 {
  margin: 0; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text);
}
.cash-setup-add > .ins-hint { margin: 0; line-height: var(--ent-lh); }
.cash-setup-add .fin-btn { align-self: flex-start; }

.cash-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: var(--ent-s3); align-items: start;
}

.cash-inline { min-height: var(--ent-control-h-sm); padding-block: 2px; font-size: var(--ent-fs-xs); min-width: 13rem; }
.cash-num { font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums; text-align: right; }
.cash-mono { font-family: var(--ent-font-mono); font-size: 0.95em; white-space: nowrap; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@media (max-width: 1100px) {
  .cash-setup-body { grid-template-columns: minmax(0, 1fr); }
  .cash-setup-add { border-left: 0; border-top: 1px solid var(--ent-line); }
}
</style>
