<script setup lang="ts">
/**
 * Bank reconciliation: import the bank's statement, match each line to the cashbook, and complete
 * the reconciliation when the two balances agree.
 *
 * The cashbook is the ledger's entries on the bank account. A line the cashbook does not have (a
 * bank charge, interest) is journalled and posted by somebody else, then matched. Whether a match
 * is equal and whether the reconciliation may be completed are the server's rules; the running
 * totals of what is ticked are shown here only as a guide.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { AlertTriangle, CircleCheck, Landmark, Link2, Sparkles, Undo2, Upload } from 'lucide-vue-next'
import ReasonDialog from '../../shared/ReasonDialog.vue'
import { bankApi, type BankOverview, type BankStatement, type BankStatementDetail, type CashbookEntry } from '../../../api/bankApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney, formatDate, formatDateTime } from '../../../composables/useMoney'
import type { Currency } from '../../../models/types'

const store = useFinanceStore()
const canReconcile = computed(() => store.can('finance.bank.reconcile'))

const overview = ref<BankOverview | null>(null)
const statements = ref<BankStatement[]>([])
const detail = ref<BankStatementDetail | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref<string | null>(null)
const cancelling = ref(false)
const pickedLines = ref<string[]>([])
const pickedEntries = ref<string[]>([])
const showMatched = ref(false)

async function loadAll(): Promise<void> {
  error.value = null
  try {
    [overview.value, statements.value] = await Promise.all([bankApi.overview(), bankApi.statements()])
  } catch (err) {
    error.value = messageOf(err, 'The bank accounts could not be read.')
  }
}
async function open(id: string): Promise<void> {
  error.value = null
  try {
    detail.value = await bankApi.statement(id)
    pickedLines.value = []
    pickedEntries.value = []
  } catch (err) {
    error.value = messageOf(err, 'The statement could not be read.')
  }
}
onMounted(async () => { await loadAll(); loading.value = false })

async function act(name: string, work: () => Promise<string | void>, fallback: string): Promise<void> {
  if (busy.value) return
  busy.value = name
  error.value = null
  notice.value = null
  try {
    const said = await work()
    if (said) notice.value = said
    if (detail.value) await open(detail.value.statement.id)
    await loadAll()
  } catch (err) {
    error.value = messageOf(err, fallback)
  } finally {
    busy.value = null
  }
}

// ── Import ────────────────────────────────────────────────────────────────────────────────────
const importing = ref(false)
const form = reactive({ file: null as File | null, bank_account_id: '', currency: 'USD' as Currency, opening_balance: '', closing_balance: '', statement_ref: '' })
const mapping = ref<{ headers: string[]; map: Record<string, string> } | null>(null)
const importError = ref<string | null>(null)
function startImport(): void {
  Object.assign(form, { file: null, opening_balance: '', closing_balance: '', statement_ref: '' })
  if (!form.bank_account_id && overview.value?.bank_accounts.length === 1) form.bank_account_id = overview.value.bank_accounts[0].id
  mapping.value = null
  importError.value = null
  importing.value = true
}
/** Where the last reconciled statement of this account and currency closed: the next one opens there. */
const expectedOpening = computed(() => overview.value?.positions.find((p) => p.id === form.bank_account_id && p.currency === form.currency)?.reconciled_balance ?? null)
async function doImport(): Promise<void> {
  if (!form.file || busy.value) return
  busy.value = 'import'
  importError.value = null
  try {
    const made = await bankApi.importStatement(form.file, {
      bank_account_id: form.bank_account_id, currency: form.currency, opening_balance: form.opening_balance.trim(),
      closing_balance: form.closing_balance.trim(), statement_ref: form.statement_ref.trim(),
      ...(mapping.value ? { column_map: Object.fromEntries(Object.entries(mapping.value.map).filter(([, v]) => v)) } : {}),
    })
    importing.value = false
    await loadAll()
    await open(made.id)
    notice.value = `${made.lines} statement line(s) imported. Match them to the cashbook below.`
  } catch (err) {
    const data = (err as { response?: { data?: { error?: string; headers?: string[]; column_map?: Record<string, string> } } }).response?.data
    if (data?.error === 'columns_not_mapped' && data.headers) {
      mapping.value = { headers: data.headers, map: Object.fromEntries((overview.value?.fields ?? []).map((f) => [f.key, data.column_map?.[f.key] ?? ''])) }
    }
    importError.value = messageOf(err, 'The statement could not be imported.')
  } finally {
    busy.value = null
  }
}

// ── Matching ──────────────────────────────────────────────────────────────────────────────────
const s = computed(() => detail.value?.statement ?? null)
const isOpen = computed(() => s.value?.status === 'open')
const openLines = computed(() => detail.value?.lines.filter((l) => !l.match_id) ?? [])
const money = (v: string | null | undefined) => formatMoney(v ?? '0', s.value?.currency ?? 'USD')
// Exact, in whole cents: a guide to what is ticked. The server decides whether a match is equal.
const cents = (v: string) => BigInt(v.replace('.', ''))
const show = (n: bigint) => { const neg = n < 0n; const d = (neg ? -n : n).toString().padStart(3, '0'); return `${neg ? '-' : ''}${d.slice(0, -2)}.${d.slice(-2)}` }
const lineTotal = computed(() => openLines.value.filter((l) => pickedLines.value.includes(l.id)).reduce((t, l) => t + cents(l.amount), 0n))
const entryTotal = computed(() => (detail.value?.cashbook ?? []).filter((e) => pickedEntries.value.includes(e.id)).reduce((t, e) => t + cents(e.amount), 0n))
const pickedEqual = computed(() => pickedEntries.value.length > 0 && lineTotal.value === entryTotal.value)

const match = () => act('match', () => bankApi.match(s.value!.id, pickedLines.value, pickedEntries.value), 'The match could not be recorded.')
const autoMatch = () => act('auto', async () => (await bankApi.autoMatch(s.value!.id)).note, 'The statement could not be matched.')
const unmatch = (id: string) => act(`un-${id}`, () => bankApi.unmatch(id), 'The match could not be undone.')
const complete = () => act('complete', async () => (await bankApi.complete(s.value!.id)).note, 'The reconciliation could not be completed.')
const cancel = (reason: string) => act('cancel', async () => { await bankApi.cancel(s.value!.id, reason); cancelling.value = false; detail.value = null }, 'The statement could not be cancelled.')

/** Matches as groups: the statement lines and the cashbook entries each one ties together. */
const matches = computed(() => {
  const groups = new Map<string, { id: string; method: string; by: string | null; lines: BankStatementDetail['lines']; entries: CashbookEntry[] }>()
  for (const e of detail.value?.matched_entries ?? []) {
    const g = groups.get(e.match_id!) ?? { id: e.match_id!, method: e.method ?? 'manual', by: e.matched_by_name ?? null, lines: [], entries: [] }
    g.entries.push(e)
    groups.set(e.match_id!, g)
  }
  for (const l of detail.value?.lines ?? []) if (l.match_id) groups.get(l.match_id)?.lines.push(l)
  return [...groups.values()]
})
const blockers = computed<string[]>(() => {
  const sum = detail.value?.summary
  if (!sum) return []
  const out: string[] = []
  if (!sum.file_adds_up) out.push(`The statement does not add up: opening balance plus its lines differs from the closing balance by ${money(sum.file_difference)}.`)
  if (sum.lines_unmatched > 0) out.push(`${sum.lines_unmatched} statement line(s) are not yet matched.`)
  else if (!sum.agrees) out.push(`The balances differ by ${money(sum.difference)}. Usually an earlier statement is missing, or the opening balance does not follow the last reconciled one.`)
  return out
})
</script>

<template>
  <section class="cw-pagehead br-noprint">
    <span class="cw-pagehead-icon"><Landmark :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Bank Reconciliation</h2>
      <p>Match the bank's statement to the cashbook, line by line, and prove the two balances agree.</p>
    </div>
    <button v-if="canReconcile" type="button" class="cw-btn cw-btn--primary" @click="startImport"><Upload :size="18" aria-hidden="true" /> Import a statement</button>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
  <p v-if="notice" class="cw-banner-msg cw-banner-msg--pos" role="status"><CircleCheck :size="18" aria-hidden="true" />{{ notice }}</p>

  <template v-if="!detail">
    <section class="cw-card" aria-labelledby="br-pos">
      <div class="cw-card-head"><h3 id="br-pos">Bank accounts</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /></div>
        <p v-else-if="!overview?.positions.length" class="cw-empty"><strong>No bank account has entries.</strong>A bank account is a ledger account marked as a bank in the <RouterLink :to="{ name: 'acc-ledger' }" class="cw-link">chart of accounts</RouterLink>.</p>
        <table v-else class="cw-table">
          <thead><tr><th>Account</th><th>Currency</th><th class="num">Cashbook balance</th><th>Reconciled to</th><th class="num">Statement balance then</th><th class="num">Entries not ticked off</th></tr></thead>
          <tbody>
            <tr v-for="p in overview.positions" :key="p.id + p.currency">
              <td><strong>{{ p.code }}</strong> {{ p.name }}</td><td>{{ p.currency }}</td>
              <td class="num">{{ formatMoney(p.cashbook_balance, p.currency) }}</td>
              <td><template v-if="p.reconciled_to">{{ formatDate(p.reconciled_to) }}</template><span v-else class="cw-pill cw-pill--warn">Never reconciled</span></td>
              <td class="num">{{ p.reconciled_balance ? formatMoney(p.reconciled_balance, p.currency) : '—' }}</td>
              <td class="num">{{ p.unmatched_entries }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="cw-card" aria-labelledby="br-st">
      <div class="cw-card-head"><h3 id="br-st">Statements</h3><span class="cw-spacer" /><RouterLink :to="{ name: 'acc-banking' }" class="cw-link">Deposits carried to the bank</RouterLink></div>
      <div class="cw-card-body cw-table-wrap">
        <p v-if="!loading && !statements.length" class="cw-empty"><strong>No statement has been imported.</strong><template v-if="canReconcile">Export the statement from internet banking as CSV or Excel and import it.</template></p>
        <table v-else-if="statements.length" class="cw-table">
          <thead><tr><th>Account</th><th>Period</th><th class="num">Closing balance</th><th>Lines</th><th>Status</th><th><span class="sr-only">Open</span></th></tr></thead>
          <tbody>
            <tr v-for="st in statements" :key="st.id">
              <td><strong>{{ st.account_code }}</strong> {{ st.account_name }}<div v-if="st.statement_ref" class="cw-hint">{{ st.statement_ref }}</div></td>
              <td>{{ formatDate(st.from_date) }} to {{ formatDate(st.to_date) }}</td>
              <td class="num">{{ formatMoney(st.closing_balance, st.currency) }}</td>
              <td>{{ st.lines_total }}<template v-if="st.status === 'open' && st.lines_unmatched"> ({{ st.lines_unmatched }} to match)</template></td>
              <td><span class="cw-pill" :class="st.status === 'reconciled' ? 'cw-pill--pos' : st.status === 'open' ? 'cw-pill--info' : 'cw-pill--mute'">{{ st.status === 'open' ? 'In progress' : st.status === 'reconciled' ? 'Reconciled' : 'Cancelled' }}</span></td>
              <td><button type="button" class="cw-btn cw-btn--small" @click="open(st.id)">{{ st.status === 'open' && canReconcile ? 'Reconcile' : 'View' }}</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

  <!-- One statement -->
  <template v-else-if="s && detail">
    <section class="cw-card" aria-labelledby="br-one">
      <div class="cw-card-head">
        <h3 id="br-one">{{ s.account_code }} {{ s.account_name }}, {{ s.currency }}<small>{{ formatDate(s.from_date) }} to {{ formatDate(s.to_date) }}</small></h3>
        <span class="cw-spacer" />
        <span class="cw-pill" :class="s.status === 'reconciled' ? 'cw-pill--pos' : s.status === 'open' ? 'cw-pill--info' : 'cw-pill--mute'">{{ s.status === 'open' ? 'In progress' : s.status === 'reconciled' ? 'Reconciled' : 'Cancelled' }}</span>
        <button type="button" class="cw-btn cw-btn--small br-noprint" @click="detail = null">Back to statements</button>
      </div>
      <div class="cw-card-body br-summary">
        <dl class="cw-kv">
          <div><dt>Statement opening balance</dt><dd>{{ money(s.opening_balance) }}</dd></div>
          <div><dt>Movement on the statement ({{ detail.summary.lines_total }} lines)</dt><dd>{{ money(detail.summary.statement_movement) }}</dd></div>
          <div><dt><strong>Statement closing balance</strong></dt><dd>{{ money(s.closing_balance) }}</dd></div>
        </dl>
        <dl class="cw-kv">
          <div><dt>Cashbook balance at {{ formatDate(s.to_date) }}</dt><dd>{{ money(detail.summary.cashbook_balance) }}</dd></div>
          <div><dt>Less deposits the bank has not yet received</dt><dd>{{ money(detail.summary.deposits_in_transit) }}</dd></div>
          <div><dt>Add payments the bank has not yet paid</dt><dd>{{ money(detail.summary.unpresented_payments) }}</dd></div>
          <div><dt><strong>Cashbook as the bank should show it</strong></dt><dd>{{ money(detail.summary.adjusted_cashbook) }}</dd></div>
          <div><dt><strong>Difference</strong></dt><dd :class="detail.summary.agrees ? 'cw-pos' : 'cw-neg'">{{ money(detail.summary.difference) }}</dd></div>
        </dl>
      </div>
      <div class="cw-card-body">
        <p v-if="s.status === 'reconciled'" class="cw-banner-msg cw-banner-msg--pos"><CircleCheck :size="18" aria-hidden="true" />Reconciled by {{ s.reconciled_by_name ?? 'somebody' }}, {{ formatDateTime(s.reconciled_at) }}. The statement and its matches are closed.</p>
        <p v-else-if="s.status === 'cancelled'" class="cw-banner-msg cw-banner-msg--warn">Cancelled: {{ s.cancel_reason }}</p>
        <template v-else>
          <p v-for="b in blockers" :key="b" class="cw-banner-msg cw-banner-msg--info" role="status">{{ b }}</p>
          <div v-if="canReconcile" class="br-actions br-noprint">
            <button type="button" class="cw-btn cw-btn--outline" :disabled="!!busy || !openLines.length" @click="autoMatch"><Sparkles :size="16" aria-hidden="true" /> {{ busy === 'auto' ? 'Matching…' : 'Match the obvious ones' }}</button>
            <button type="button" class="cw-btn cw-btn--primary" :disabled="!!busy || blockers.length > 0" @click="complete">{{ busy === 'complete' ? 'Completing…' : 'Complete the reconciliation' }}</button>
            <button type="button" class="cw-btn" :disabled="!!busy" @click="cancelling = true">Cancel this statement</button>
          </div>
        </template>
      </div>
    </section>

    <div v-if="isOpen" class="br-two">
      <section class="cw-card" aria-labelledby="br-l">
        <div class="cw-card-head"><h3 id="br-l">On the statement, not yet matched<small>{{ openLines.length }}</small></h3></div>
        <div class="cw-card-body cw-table-wrap">
          <p v-if="!openLines.length" class="cw-empty"><strong>Every statement line is matched.</strong></p>
          <table v-else class="cw-table">
            <thead><tr><th v-if="canReconcile"><span class="sr-only">Tick</span></th><th>Date</th><th>Details</th><th class="num">Amount</th></tr></thead>
            <tbody>
              <tr v-for="l in openLines" :key="l.id">
                <td v-if="canReconcile"><input v-model="pickedLines" type="checkbox" class="cw-check" :value="l.id" :aria-label="`Statement line ${l.line_no}, ${l.amount}`" /></td>
                <td>{{ formatDate(l.txn_date) }}</td>
                <td>{{ l.description ?? '—' }}<div v-if="l.reference" class="cw-hint">{{ l.reference }}</div></td>
                <td class="num" :class="{ 'cw-neg': l.amount.startsWith('-') }">{{ money(l.amount) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="openLines.length" class="cw-hint br-noprint" style="margin-top: 10px">
            A line with nothing to match in the cashbook (a bank charge, interest) is recorded first:
            <RouterLink :to="{ name: 'acc-journals' }" class="cw-link">raise a journal</RouterLink>, have somebody else post it, then match it here.
          </p>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="br-c">
        <div class="cw-card-head"><h3 id="br-c">In the cashbook, not yet ticked off<small>{{ detail.cashbook.length }}</small></h3></div>
        <div class="cw-card-body cw-table-wrap">
          <p v-if="!detail.cashbook.length" class="cw-empty"><strong>Every cashbook entry is ticked off.</strong></p>
          <table v-else class="cw-table">
            <thead><tr><th v-if="canReconcile"><span class="sr-only">Tick</span></th><th>Date</th><th>Voucher</th><th class="num">Amount</th></tr></thead>
            <tbody>
              <tr v-for="e in detail.cashbook" :key="e.id">
                <td v-if="canReconcile"><input v-model="pickedEntries" type="checkbox" class="cw-check" :value="e.id" :aria-label="`Cashbook entry ${e.voucher_no}, ${e.amount}`" /></td>
                <td>{{ formatDate(e.posting_date) }}<div v-if="e.after_statement" class="cw-hint">after the statement</div></td>
                <td><strong>{{ e.voucher_no }}</strong><div class="cw-hint">{{ [e.reference, e.party_name, e.narration].filter(Boolean).join(' · ') }}</div></td>
                <td class="num" :class="{ 'cw-neg': e.amount.startsWith('-') }">{{ money(e.amount) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <div v-if="isOpen && canReconcile && (pickedLines.length || pickedEntries.length)" class="br-bar br-noprint" role="status">
      <span>Statement side <strong>{{ money(show(lineTotal)) }}</strong> ({{ pickedLines.length }})</span>
      <span>Cashbook side <strong>{{ money(show(entryTotal)) }}</strong> ({{ pickedEntries.length }})</span>
      <span v-if="!pickedEqual && pickedEntries.length" class="cw-neg">Differ by {{ money(show(lineTotal - entryTotal)) }}</span>
      <span class="cw-spacer" />
      <button type="button" class="cw-btn" @click="pickedLines = []; pickedEntries = []">Clear</button>
      <button type="button" class="cw-btn cw-btn--primary" :disabled="!!busy || !pickedEqual" @click="match"><Link2 :size="16" aria-hidden="true" /> Match</button>
    </div>

    <section class="cw-card" aria-labelledby="br-m">
      <div class="cw-card-head">
        <h3 id="br-m">Matched<small>{{ matches.length }}</small></h3><span class="cw-spacer" />
        <button v-if="matches.length && isOpen" type="button" class="cw-link" :aria-expanded="showMatched" @click="showMatched = !showMatched">{{ showMatched ? 'Hide' : 'Show' }}</button>
      </div>
      <div v-if="(showMatched || !isOpen) && matches.length" class="cw-card-body cw-table-wrap">
        <table class="cw-table">
          <thead><tr><th>On the statement</th><th>In the cashbook</th><th>How</th><th v-if="isOpen && canReconcile"><span class="sr-only">Undo</span></th></tr></thead>
          <tbody>
            <tr v-for="m in matches" :key="m.id">
              <td><div v-for="l in m.lines" :key="l.id">{{ formatDate(l.txn_date) }} · {{ l.description ?? l.reference ?? '—' }} · <strong>{{ money(l.amount) }}</strong></div><em v-if="!m.lines.length">Nothing: entries that cancel each other</em></td>
              <td><div v-for="e in m.entries" :key="e.id">{{ formatDate(e.posting_date) }} · {{ e.voucher_no }} · <strong>{{ money(e.amount) }}</strong></div></td>
              <td>{{ m.method === 'auto' ? 'Matched automatically' : `By ${m.by ?? 'somebody'}` }}</td>
              <td v-if="isOpen && canReconcile"><button type="button" class="cw-icon-btn" aria-label="Undo this match" :disabled="!!busy" @click="unmatch(m.id)"><Undo2 :size="17" /></button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

  <!-- Import -->
  <div v-if="importing && overview" class="cw-dialog-backdrop" @click.self="importing = false" @keydown.esc="importing = false">
    <form class="cw-dialog" role="dialog" aria-modal="true" aria-label="Import a bank statement" @submit.prevent="doImport">
      <header><h3>Import a bank statement</h3></header>
      <div class="cw-dialog-body">
        <label class="cw-field"><span class="cw-label">Bank account <span class="req">*</span></span>
          <select v-model="form.bank_account_id" class="cw-select" required>
            <option value="">Choose the bank account</option>
            <option v-for="a in overview.bank_accounts" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option>
          </select></label>
        <label class="cw-field"><span class="cw-label">Currency <span class="req">*</span></span>
          <select v-model="form.currency" class="cw-select"><option value="USD">USD</option><option value="ZWG">ZWG</option></select></label>
        <label class="cw-field"><span class="cw-label">Statement file <span class="req">*</span></span>
          <input type="file" class="cw-input" accept=".csv,.txt,.xlsx" required @change="form.file = ($event.target as HTMLInputElement).files?.[0] ?? null" />
          <span class="cw-hint">The CSV or Excel download from internet banking, with a heading row.</span></label>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
          <label class="cw-field"><span class="cw-label">Opening balance <span class="req">*</span></span><input v-model="form.opening_balance" class="cw-input" inputmode="decimal" required />
            <span v-if="expectedOpening" class="cw-hint">The last reconciled statement closed at {{ formatMoney(expectedOpening, form.currency) }}.</span></label>
          <label class="cw-field"><span class="cw-label">Closing balance <span class="req">*</span></span><input v-model="form.closing_balance" class="cw-input" inputmode="decimal" required /></label>
        </div>
        <span class="cw-hint">As printed on the statement. An overdrawn balance is negative.</span>
        <label class="cw-field"><span class="cw-label">Statement number</span><input v-model="form.statement_ref" class="cw-input" /></label>
        <template v-if="mapping">
          <p class="cw-banner-msg cw-banner-msg--warn" role="alert">The columns of this file were not recognised. Say which column holds what, then import again.</p>
          <label v-for="f in overview.fields" :key="f.key" class="cw-field"><span class="cw-label">{{ f.label }}</span>
            <select v-model="mapping.map[f.key]" class="cw-select"><option value="">Not in this file</option><option v-for="h in mapping.headers" :key="h" :value="h">{{ h }}</option></select></label>
        </template>
        <p v-if="importError && !mapping" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ importError }}</p>
      </div>
      <footer>
        <button type="button" class="cw-btn" @click="importing = false">Cancel</button>
        <button type="submit" class="cw-btn cw-btn--primary" :disabled="!!busy || !form.file || !form.bank_account_id">{{ busy === 'import' ? 'Importing…' : 'Import' }}</button>
      </footer>
    </form>
  </div>

  <ReasonDialog
    v-if="cancelling" title="Cancel this statement" label="Reason" :min-length="3" submit-label="Cancel the statement" danger :busy="busy === 'cancel'" :error="error"
    message="Its matches are undone, so the cashbook entries can be matched to a corrected statement."
    @submit="cancel" @close="cancelling = false"
  />
</template>

<style scoped>
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.br-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 8px 28px; }
.br-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; align-items: start; }
.br-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
.br-bar { position: sticky; bottom: 12px; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; padding: 10px 14px; border-radius: 10px; background: #fff; border: 1px solid #c9d8ee; box-shadow: 0 8px 24px rgba(15, 25, 45, 0.16); font-size: 13.5px; }
.br-bar .cw-spacer { flex: 1; }
@media print { .br-noprint { display: none !important; } }
</style>
