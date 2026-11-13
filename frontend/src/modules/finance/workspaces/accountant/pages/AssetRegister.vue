<script setup lang="ts">
/**
 * The fixed-asset register: what the council owns, its depreciation, and disposals.
 *
 * Registering an asset posts nothing; its cost is in the ledger through the document that bought
 * it, so each category shows the register beside the ledger and any difference between them. A
 * depreciation run and a disposal are drafts until somebody other than whoever raised them
 * approves. The method and every figure are the server's.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { AlertTriangle, Building2, CircleCheck, Info, Pencil, Plus, Trash2, X } from 'lucide-vue-next'
import { assetsApi, type AssetAccount, type AssetCategory, type AssetStatus, type CategoryComparison, type DepreciationRun, type FixedAsset } from '../../../api/assetsApi'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney, formatDate } from '../../../composables/useMoney'
import type { Currency } from '../../../models/types'
import type { LedgerPeriod } from '../../../models/ledgerTypes'

const store = useFinanceStore()
const me = computed(() => store.identity?.user_id ?? null)
const canManage = computed(() => store.can('finance.assets.manage'))
const canApprove = computed(() => store.can('finance.assets.approve'))

type Tab = 'register' | 'depreciation' | 'categories'
const tab = ref<Tab>('register')
const assets = ref<FixedAsset[]>([])
const totals = ref<{ currency: Currency; assets: number; cost: string; accumulated: string; carrying_amount: string }[]>([])
const categories = ref<AssetCategory[]>([])
const comparison = ref<CategoryComparison[]>([])
const accounts = ref<AssetAccount[]>([])
const runs = ref<DepreciationRun[]>([])
const periods = ref<LedgerPeriod[]>([])
const q = ref('')
const loading = ref(true)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const formError = ref<string | null>(null)
const busy = ref<string | null>(null)
const today = new Date().toISOString().slice(0, 10)

async function load(): Promise<void> {
  error.value = null
  try {
    const [reg, cats, rs] = await Promise.all([
      assetsApi.assets(q.value.trim() ? { q: q.value.trim() } : {}), assetsApi.categories(), assetsApi.runs(store.selectedYearId),
    ])
    assets.value = reg.assets
    totals.value = reg.totals
    categories.value = cats.categories
    comparison.value = cats.comparison
    accounts.value = cats.accounts
    runs.value = rs
  } catch (err) {
    error.value = messageOf(err, 'The asset register could not be read.')
  }
}
async function loadPeriods(): Promise<void> {
  if (!store.selectedYearId) { periods.value = []; return }
  try { periods.value = (await ledgerApi.periods({ financial_year_id: store.selectedYearId })).periods } catch { periods.value = [] }
}
onMounted(async () => { await Promise.all([load(), loadPeriods()]); loading.value = false })
watch(() => store.selectedYearId, () => { void load(); void loadPeriods() })

async function act(name: string, work: () => Promise<string | void>, fallback: string): Promise<void> {
  if (busy.value) return
  busy.value = name
  error.value = null
  notice.value = null
  try {
    const said = await work()
    if (said) notice.value = said
    await load()
  } catch (err) {
    error.value = messageOf(err, fallback)
  } finally {
    busy.value = null
  }
}

const STATUS: Record<AssetStatus, { label: string; tone: string }> = {
  in_use: { label: 'In use', tone: 'cw-pill--pos' }, fully_depreciated: { label: 'Fully depreciated', tone: 'cw-pill--info' },
  not_depreciated: { label: 'Not depreciated', tone: 'cw-pill--mute' }, disposed: { label: 'Disposed', tone: 'cw-pill--mute' },
  disposal_awaiting_approval: { label: 'Disposal awaiting approval', tone: 'cw-pill--warn' },
}
const RUN_STATUS = { awaiting_approval: { label: 'Awaiting approval', tone: 'cw-pill--warn' }, approved: { label: 'Approved', tone: 'cw-pill--pos' }, reversed: { label: 'Reversed', tone: 'cw-pill--mute' } }
const of = (types: string[], roots: string[]) => accounts.value.filter((a) => roots.includes(a.root_type) && (!types.length || types.includes(a.account_type ?? '')))
const categoryName = (id: string) => categories.value.find((c) => c.id === id)?.name ?? ''
const differing = computed(() => comparison.value.filter((c) => !c.agrees))

// ── Register an asset ─────────────────────────────────────────────────────────────────────────
const registering = ref(false)
const editing = ref<FixedAsset | null>(null)
const a = reactive({
  name: '', category_id: '', currency: 'USD' as Currency, cost: '', residual_value: '', accumulated_opening: '', acquired_on: today,
  depreciation_start: '', useful_life_months: '', serial_no: '', location: '', custodian: '',
})
const chosenCategory = computed(() => categories.value.find((c) => c.id === a.category_id) ?? null)
function openRegister(asset?: FixedAsset): void {
  editing.value = asset ?? null
  Object.assign(a, asset
    ? { name: asset.name, category_id: asset.category_id, currency: asset.currency, cost: asset.cost, residual_value: asset.residual_value,
        accumulated_opening: asset.accumulated_opening, acquired_on: asset.acquired_on, depreciation_start: asset.depreciation_start,
        useful_life_months: '', serial_no: asset.serial_no ?? '', location: asset.location ?? '', custodian: asset.custodian ?? '' }
    : { name: '', category_id: '', cost: '', residual_value: '', accumulated_opening: '', acquired_on: today, depreciation_start: '', useful_life_months: '', serial_no: '', location: '', custodian: '' })
  formError.value = null
  registering.value = true
}
async function saveAsset(): Promise<void> {
  if (busy.value) return
  busy.value = 'asset'
  formError.value = null
  try {
    if (editing.value) {
      // Where it is and who holds it. The figures are frozen once depreciation has been charged.
      await assetsApi.update(editing.value.id, { name: a.name.trim(), serial_no: a.serial_no.trim(), location: a.location.trim(), custodian: a.custodian.trim() })
      notice.value = 'Saved.'
    } else {
      const made = await assetsApi.register({
        name: a.name.trim(), category_id: a.category_id, currency: a.currency, cost: a.cost.trim(), acquired_on: a.acquired_on,
        ...(a.residual_value.trim() ? { residual_value: a.residual_value.trim() } : {}),
        ...(a.accumulated_opening.trim() ? { accumulated_opening: a.accumulated_opening.trim() } : {}),
        ...(a.depreciation_start ? { depreciation_start: a.depreciation_start } : {}),
        ...(a.useful_life_months ? { useful_life_months: Number(a.useful_life_months) } : {}),
        ...(a.serial_no.trim() ? { serial_no: a.serial_no.trim() } : {}), ...(a.location.trim() ? { location: a.location.trim() } : {}),
        ...(a.custodian.trim() ? { custodian: a.custodian.trim() } : {}),
      })
      notice.value = `${made.asset_no} registered. ${made.note}`
    }
    registering.value = false
    await load()
  } catch (err) {
    formError.value = messageOf(err, 'The asset could not be saved.')
  } finally {
    busy.value = null
  }
}

// ── Disposal ──────────────────────────────────────────────────────────────────────────────────
const disposing = ref<FixedAsset | null>(null)
const d = reactive({ disposed_on: today, proceeds: '', proceeds_account_id: '', gain_loss_account_id: '', note: '' })
function openDispose(asset: FixedAsset): void {
  disposing.value = asset
  Object.assign(d, { disposed_on: today, proceeds: '', proceeds_account_id: '', gain_loss_account_id: '', note: '' })
  formError.value = null
}
async function dispose(): Promise<void> {
  if (!disposing.value || busy.value) return
  busy.value = 'dispose'
  formError.value = null
  try {
    notice.value = (await assetsApi.dispose(disposing.value.id, {
      disposed_on: d.disposed_on, note: d.note.trim(), ...(d.proceeds.trim() ? { proceeds: d.proceeds.trim() } : {}),
      ...(d.proceeds_account_id ? { proceeds_account_id: d.proceeds_account_id } : {}),
      ...(d.gain_loss_account_id ? { gain_loss_account_id: d.gain_loss_account_id } : {}),
    })).note
    disposing.value = null
    await load()
  } catch (err) {
    formError.value = messageOf(err, 'The disposal could not be raised.')
  } finally {
    busy.value = null
  }
}
const approveDisposal = (x: FixedAsset) => act(`ad-${x.id}`, async () => (await assetsApi.approveDisposal(x.id)).note, 'The disposal could not be approved.')
const withdrawDisposal = (x: FixedAsset) => act(`wd-${x.id}`, () => assetsApi.withdrawDisposal(x.id), 'The disposal could not be withdrawn.')

// ── Depreciation ──────────────────────────────────────────────────────────────────────────────
const runForm = reactive({ ledger_period_id: '', currency: 'USD' as Currency })
const openPeriods = computed(() => periods.value.filter((p) => p.status === 'open'))
const raiseRun = () => act('run', async () => (await assetsApi.run(runForm.ledger_period_id, runForm.currency)).note, 'Depreciation could not be run.')
const approveRun = (r: DepreciationRun) => act(`ar-${r.id}`, async () => (await assetsApi.approveRun(r.id)).note, 'The run could not be approved.')
const discardRun = (r: DepreciationRun) => act(`dr-${r.id}`, () => assetsApi.discardRun(r.id), 'The run could not be discarded.')
const charges = ref<{ run: DepreciationRun; rows: { asset_no: string; name: string; category_name: string; amount: string }[] } | null>(null)
async function showCharges(r: DepreciationRun): Promise<void> {
  try { charges.value = { run: r, rows: await assetsApi.runCharges(r.id) } } catch (err) { error.value = messageOf(err, 'The run could not be read.') }
}

// ── Categories ────────────────────────────────────────────────────────────────────────────────
const addingCategory = ref(false)
const c = reactive({ code: '', name: '', asset_account_id: '', accumulated_account_id: '', expense_account_id: '', method: 'straight_line' as 'straight_line' | 'none', useful_life_years: '', residual_pct: '' })
function openCategory(): void {
  Object.assign(c, { code: '', name: '', asset_account_id: '', accumulated_account_id: '', expense_account_id: '', method: 'straight_line', useful_life_years: '', residual_pct: '' })
  formError.value = null
  addingCategory.value = true
}
async function saveCategory(): Promise<void> {
  if (busy.value) return
  busy.value = 'category'
  formError.value = null
  try {
    await assetsApi.createCategory({
      code: c.code.trim(), name: c.name.trim(), asset_account_id: c.asset_account_id, method: c.method,
      ...(c.accumulated_account_id ? { accumulated_account_id: c.accumulated_account_id } : {}),
      ...(c.method === 'straight_line' ? {
        ...(c.expense_account_id ? { expense_account_id: c.expense_account_id } : {}),
        ...(c.useful_life_years ? { useful_life_months: Math.round(Number(c.useful_life_years) * 12) } : {}),
        ...(c.residual_pct ? { residual_pct: Number(c.residual_pct) } : {}),
      } : {}),
    })
    addingCategory.value = false
    await load()
  } catch (err) {
    formError.value = messageOf(err, 'The category could not be saved.')
  } finally {
    busy.value = null
  }
}
const life = (months: number | null) => (months ? (months % 12 === 0 ? `${months / 12} years` : `${months} months`) : '—')
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Building2 :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Asset Register</h2>
      <p>The council's property, plant and equipment: what each cost, where it is, and its depreciation.</p>
    </div>
    <button v-if="canManage && categories.length" type="button" class="cw-btn cw-btn--primary" @click="openRegister()"><Plus :size="18" aria-hidden="true" /> Register an asset</button>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
  <p v-if="notice" class="cw-banner-msg cw-banner-msg--pos" role="status"><CircleCheck :size="18" aria-hidden="true" />{{ notice }}</p>
  <p v-if="!loading && !categories.length" class="cw-banner-msg cw-banner-msg--info"><Info :size="18" aria-hidden="true" />
    <span>No asset category exists yet. A category names the ledger accounts and the useful life the Council's policy gives that class of asset.
      <button v-if="canManage" type="button" class="cw-link" @click="tab = 'categories'; openCategory()">Add the first category</button></span></p>
  <p v-if="differing.length" class="cw-banner-msg cw-banner-msg--warn" role="status"><AlertTriangle :size="18" aria-hidden="true" />
    <span>The register and the ledger differ on {{ differing.length }} categor{{ differing.length === 1 ? 'y' : 'ies' }}.
      <button type="button" class="cw-link" @click="tab = 'categories'">See the comparison</button></span></p>

  <dl v-if="totals.length" class="ar-totals">
    <div v-for="t in totals" :key="t.currency">
      <dt>{{ t.assets }} asset{{ t.assets === 1 ? '' : 's' }} in {{ t.currency }}, carrying amount</dt>
      <dd>{{ formatMoney(t.carrying_amount, t.currency) }}</dd>
      <span class="cw-hint">Cost {{ formatMoney(t.cost, t.currency) }} less depreciation {{ formatMoney(t.accumulated, t.currency) }}</span>
    </div>
  </dl>

  <div class="cw-seg ar-tabs" role="group" aria-label="View">
    <button type="button" :aria-pressed="tab === 'register'" @click="tab = 'register'">Register</button>
    <button type="button" :aria-pressed="tab === 'depreciation'" @click="tab = 'depreciation'">Depreciation</button>
    <button type="button" :aria-pressed="tab === 'categories'" @click="tab = 'categories'">Categories</button>
  </div>

  <section v-if="loading" class="cw-card"><div class="cw-card-body" style="padding-top: 16px"><span class="cw-skel" /><span class="cw-skel" /></div></section>

  <!-- Register -->
  <section v-else-if="tab === 'register'" class="cw-card">
    <div class="cw-card-body" style="padding-top: 16px; display: flex; flex-direction: column; gap: 12px">
      <form class="cw-search" role="search" style="max-width: 520px" @submit.prevent="load">
        <input v-model="q" class="cw-input" placeholder="Name, asset number, serial number, location or custodian" aria-label="Search the register" />
        <button v-if="q" type="button" class="cw-search-clear" aria-label="Clear" @click="q = ''; load()"><X :size="20" /></button>
      </form>
      <div class="cw-table-wrap">
        <p v-if="!assets.length" class="cw-empty"><strong>No asset is registered.</strong></p>
        <table v-else class="cw-table">
          <thead><tr><th>Asset</th><th>Category</th><th>Acquired</th><th class="num">Cost</th><th class="num">Depreciation</th><th class="num">Carrying amount</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            <tr v-for="x in assets" :key="x.id">
              <td><strong>{{ x.name }}</strong><div class="cw-hint">{{ [x.asset_no, x.serial_no, x.location, x.custodian].filter(Boolean).join(' · ') }}</div></td>
              <td>{{ x.category_name }}</td><td>{{ formatDate(x.acquired_on) }}</td>
              <td class="num">{{ formatMoney(x.cost, x.currency) }}</td>
              <td class="num">{{ formatMoney(x.accumulated, x.currency) }}<div v-if="Number(x.charged_in_draft)" class="cw-hint">+ {{ formatMoney(x.charged_in_draft, x.currency) }} awaiting approval</div></td>
              <td class="num">{{ x.status === 'disposed' ? '—' : formatMoney(x.carrying_amount, x.currency) }}</td>
              <td><span class="cw-pill" :class="STATUS[x.status].tone">{{ STATUS[x.status].label }}</span>
                <div v-if="x.disposed_on" class="cw-hint">{{ formatDate(x.disposed_on) }}: {{ x.disposal_note }}</div></td>
              <td class="ar-acts">
                <template v-if="x.status === 'disposal_awaiting_approval'">
                  <button v-if="canApprove && x.disposal_prepared_by !== me" type="button" class="cw-btn cw-btn--small cw-btn--primary" :disabled="!!busy" @click="approveDisposal(x)">Approve disposal</button>
                  <button v-if="canManage" type="button" class="cw-btn cw-btn--small" :disabled="!!busy" @click="withdrawDisposal(x)">Withdraw</button>
                </template>
                <template v-else-if="x.status !== 'disposed' && canManage">
                  <button type="button" class="cw-icon-btn" :aria-label="`Edit ${x.name}`" @click="openRegister(x)"><Pencil :size="17" /></button>
                  <button type="button" class="cw-btn cw-btn--small" @click="openDispose(x)">Dispose</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <!-- Depreciation -->
  <template v-else-if="tab === 'depreciation'">
    <section v-if="canManage" class="cw-card" aria-labelledby="ar-run">
      <div class="cw-card-head"><h3 id="ar-run">Run depreciation for a period</h3></div>
      <div class="cw-card-body">
        <p class="cw-hint">Straight line: cost less residual value, spread over the useful life, for each month the period covers. The run is a draft until somebody other than you approves it.</p>
        <form class="ar-runform" @submit.prevent="raiseRun">
          <label class="cw-field"><span class="cw-label">Accounting period</span>
            <select v-model="runForm.ledger_period_id" class="cw-select" required>
              <option value="">Choose an open period</option>
              <option v-for="p in openPeriods" :key="p.id" :value="p.id">{{ p.label ?? `Period ${p.period_no}` }} ({{ formatDate(p.from_date) }} to {{ formatDate(p.to_date) }})</option>
            </select>
            <span v-if="!openPeriods.length" class="cw-hint">No period of this financial year is open. <RouterLink :to="{ name: 'acc-close' }" class="cw-link">Close Period</RouterLink></span></label>
          <label class="cw-field"><span class="cw-label">Currency</span><select v-model="runForm.currency" class="cw-select"><option value="USD">USD</option><option value="ZWG">ZWG</option></select></label>
          <button type="submit" class="cw-btn cw-btn--primary" :disabled="!!busy || !runForm.ledger_period_id">{{ busy === 'run' ? 'Running…' : 'Run depreciation' }}</button>
        </form>
      </div>
    </section>
    <section class="cw-card">
      <div class="cw-card-body cw-table-wrap" style="padding-top: 16px">
        <p v-if="!runs.length" class="cw-empty"><strong>No depreciation has been run in this financial year.</strong></p>
        <table v-else class="cw-table">
          <thead><tr><th>Run</th><th>Period</th><th>Assets</th><th class="num">Charge</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            <tr v-for="r in runs" :key="r.id">
              <td><button type="button" class="cw-link" @click="showCharges(r)">{{ r.run_no }}</button></td>
              <td>{{ r.period_label ?? `Period ${r.period_no}` }}<div class="cw-hint">to {{ formatDate(r.period_to) }}</div></td>
              <td>{{ r.assets }}</td><td class="num">{{ formatMoney(r.total, r.currency) }}</td>
              <td><span class="cw-pill" :class="RUN_STATUS[r.status].tone">{{ RUN_STATUS[r.status].label }}</span>
                <div class="cw-hint">{{ r.status === 'awaiting_approval' ? `Raised by ${r.prepared_by_name ?? 'somebody'}` : `Approved by ${r.approved_by_name ?? 'somebody'}` }}</div></td>
              <td class="ar-acts">
                <template v-if="r.status === 'awaiting_approval'">
                  <button v-if="canApprove && r.prepared_by !== me" type="button" class="cw-btn cw-btn--small cw-btn--primary" :disabled="!!busy" @click="approveRun(r)">Approve</button>
                  <span v-else-if="r.prepared_by === me" class="cw-hint">Somebody else approves</span>
                  <button v-if="canManage" type="button" class="cw-icon-btn" :aria-label="`Discard ${r.run_no}`" :disabled="!!busy" @click="discardRun(r)"><Trash2 :size="17" /></button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

  <!-- Categories -->
  <template v-else>
    <section class="cw-card" aria-labelledby="ar-cat">
      <div class="cw-card-head"><h3 id="ar-cat">Categories</h3><span class="cw-spacer" />
        <button v-if="canManage" type="button" class="cw-btn cw-btn--small cw-btn--outline" @click="openCategory"><Plus :size="15" aria-hidden="true" /> Add a category</button></div>
      <div class="cw-card-body cw-table-wrap">
        <p v-if="!categories.length" class="cw-empty"><strong>No category yet.</strong>Useful lives and residual values are the Council's accounting policy; none is assumed.</p>
        <table v-else class="cw-table">
          <thead><tr><th>Category</th><th>Asset account</th><th>Accumulated depreciation</th><th>Depreciation expense</th><th>Useful life</th><th>Residual</th></tr></thead>
          <tbody>
            <tr v-for="k in categories" :key="k.id">
              <td><strong>{{ k.code }}</strong> {{ k.name }}</td><td>{{ k.asset_account_code }} {{ k.asset_account_name }}</td>
              <td>{{ k.accumulated_account_code ?? '—' }}</td><td>{{ k.expense_account_code ?? '—' }}</td>
              <td>{{ k.method === 'none' ? 'Not depreciated' : life(k.useful_life_months) }}</td><td>{{ k.method === 'none' ? '—' : `${Number(k.residual_pct)} %` }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <section v-if="comparison.length" class="cw-card" aria-labelledby="ar-cmp">
      <div class="cw-card-head"><h3 id="ar-cmp">The register against the ledger</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <p class="cw-hint">The register is kept here; the ledger balance comes from the invoices, journals and opening balances that bought the assets. A difference means an asset is registered and not in the ledger, or the other way round.</p>
        <table class="cw-table">
          <thead><tr><th>Category</th><th class="num">Cost: register</th><th class="num">Cost: ledger</th><th class="num">Depreciation: register</th><th class="num">Depreciation: ledger</th><th>Result</th></tr></thead>
          <tbody>
            <tr v-for="k in comparison" :key="k.category_id + k.currency">
              <td>{{ categoryName(k.category_id) }}<div class="cw-hint">{{ k.currency }} · {{ k.assets }} asset(s)</div></td>
              <td class="num">{{ formatMoney(k.register_cost, k.currency) }}</td><td class="num">{{ formatMoney(k.ledger_cost, k.currency) }}</td>
              <td class="num">{{ formatMoney(k.register_accumulated, k.currency) }}</td><td class="num">{{ formatMoney(k.ledger_accumulated, k.currency) }}</td>
              <td><span v-if="k.agrees" class="cw-pill cw-pill--pos">Agrees</span>
                <span v-else class="cw-pill cw-pill--warn">Differs: cost {{ formatMoney(k.cost_difference, k.currency) }}, depreciation {{ formatMoney(k.accumulated_difference, k.currency) }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

  <!-- Register / edit -->
  <div v-if="registering" class="cw-dialog-backdrop" @click.self="registering = false" @keydown.esc="registering = false">
    <form class="cw-dialog cw-dialog--wide" role="dialog" aria-modal="true" :aria-label="editing ? 'Edit asset' : 'Register an asset'" @submit.prevent="saveAsset">
      <header><h3>{{ editing ? `${editing.asset_no} ${editing.name}` : 'Register an asset' }}</h3><button type="button" class="cw-icon-btn" aria-label="Close" @click="registering = false"><X :size="20" /></button></header>
      <div class="cw-dialog-body">
        <div class="ar-grid">
          <label class="cw-field"><span class="cw-label">Name <span class="req">*</span></span><input v-model="a.name" class="cw-input" required minlength="2" /></label>
          <template v-if="!editing">
            <label class="cw-field"><span class="cw-label">Category <span class="req">*</span></span>
              <select v-model="a.category_id" class="cw-select" required><option value="">Choose a category</option><option v-for="k in categories.filter((k) => k.status === 'active')" :key="k.id" :value="k.id">{{ k.name }}</option></select></label>
            <label class="cw-field"><span class="cw-label">Currency</span><select v-model="a.currency" class="cw-select"><option value="USD">USD</option><option value="ZWG">ZWG</option></select></label>
            <label class="cw-field"><span class="cw-label">Cost <span class="req">*</span></span><input v-model="a.cost" class="cw-input" inputmode="decimal" required /></label>
            <label class="cw-field"><span class="cw-label">Acquired on <span class="req">*</span></span><input v-model="a.acquired_on" type="date" class="cw-input" required /></label>
            <template v-if="chosenCategory?.method === 'straight_line'">
              <label class="cw-field"><span class="cw-label">Residual value</span><input v-model="a.residual_value" class="cw-input" inputmode="decimal" />
                <span class="cw-hint">Left blank, the category's {{ Number(chosenCategory.residual_pct) }} % of cost applies.</span></label>
              <label class="cw-field"><span class="cw-label">Useful life in months</span><input v-model="a.useful_life_months" class="cw-input" inputmode="numeric" />
                <span class="cw-hint">Left blank, the category's {{ life(chosenCategory.useful_life_months) }} applies.</span></label>
              <label class="cw-field"><span class="cw-label">Depreciation starts</span><input v-model="a.depreciation_start" type="date" class="cw-input" :min="a.acquired_on" />
                <span class="cw-hint">Left blank, the day it was acquired.</span></label>
              <label class="cw-field"><span class="cw-label">Depreciation already charged</span><input v-model="a.accumulated_opening" class="cw-input" inputmode="decimal" />
                <span class="cw-hint">For an asset brought across from the previous package.</span></label>
            </template>
          </template>
          <label class="cw-field"><span class="cw-label">Serial or registration number</span><input v-model="a.serial_no" class="cw-input" /></label>
          <label class="cw-field"><span class="cw-label">Location</span><input v-model="a.location" class="cw-input" /></label>
          <label class="cw-field"><span class="cw-label">Custodian</span><input v-model="a.custodian" class="cw-input" /></label>
        </div>
        <p v-if="!editing" class="cw-hint">Registering posts nothing. The cost is in the ledger through the invoice or journal that bought the asset.</p>
        <p v-if="formError" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ formError }}</p>
      </div>
      <footer>
        <button type="button" class="cw-btn" @click="registering = false">Cancel</button>
        <button type="submit" class="cw-btn cw-btn--primary" :disabled="!!busy || a.name.trim().length < 2 || (!editing && (!a.category_id || !a.cost.trim()))">{{ busy === 'asset' ? 'Saving…' : editing ? 'Save' : 'Register' }}</button>
      </footer>
    </form>
  </div>

  <!-- Dispose -->
  <div v-if="disposing" class="cw-dialog-backdrop" @click.self="disposing = null" @keydown.esc="disposing = null">
    <form class="cw-dialog" role="dialog" aria-modal="true" aria-label="Dispose of an asset" @submit.prevent="dispose">
      <header><h3>Dispose of {{ disposing.asset_no }} {{ disposing.name }}</h3><button type="button" class="cw-icon-btn" aria-label="Close" @click="disposing = null"><X :size="20" /></button></header>
      <div class="cw-dialog-body">
        <dl class="cw-kv">
          <div><dt>Cost</dt><dd>{{ formatMoney(disposing.cost, disposing.currency) }}</dd></div>
          <div><dt>Depreciation charged</dt><dd>{{ formatMoney(disposing.accumulated, disposing.currency) }}</dd></div>
          <div><dt>Carrying amount</dt><dd>{{ formatMoney(disposing.carrying_amount, disposing.currency) }}</dd></div>
        </dl>
        <label class="cw-field"><span class="cw-label">Disposed on <span class="req">*</span></span><input v-model="d.disposed_on" type="date" class="cw-input" required /></label>
        <label class="cw-field"><span class="cw-label">How it left the council <span class="req">*</span></span><input v-model="d.note" class="cw-input" required minlength="3" placeholder="Sold at auction, scrapped, stolen…" /></label>
        <label class="cw-field"><span class="cw-label">Proceeds</span><input v-model="d.proceeds" class="cw-input" inputmode="decimal" placeholder="0.00 if none" /></label>
        <label v-if="d.proceeds.trim() && Number(d.proceeds) !== 0" class="cw-field"><span class="cw-label">Proceeds received into <span class="req">*</span></span>
          <select v-model="d.proceeds_account_id" class="cw-select"><option value="">Choose an account</option><option v-for="x in of(['bank', 'cash', 'receivable'], ['asset'])" :key="x.id" :value="x.id">{{ x.code }} {{ x.name }}</option></select></label>
        <label class="cw-field"><span class="cw-label">Gain or loss posted to</span>
          <select v-model="d.gain_loss_account_id" class="cw-select"><option value="">Choose an account</option><option v-for="x in of([], ['revenue', 'expense'])" :key="x.id" :value="x.id">{{ x.code }} {{ x.name }}</option></select>
          <span class="cw-hint">Needed unless the proceeds equal the carrying amount exactly. The server works out the gain or loss.</span></label>
        <p v-if="formError" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ formError }}</p>
      </div>
      <footer>
        <button type="button" class="cw-btn" @click="disposing = null">Cancel</button>
        <button type="submit" class="cw-btn cw-btn--primary" :disabled="!!busy || d.note.trim().length < 3">{{ busy === 'dispose' ? 'Saving…' : 'Raise the disposal' }}</button>
      </footer>
    </form>
  </div>

  <!-- Category -->
  <div v-if="addingCategory" class="cw-dialog-backdrop" @click.self="addingCategory = false" @keydown.esc="addingCategory = false">
    <form class="cw-dialog" role="dialog" aria-modal="true" aria-label="Add an asset category" @submit.prevent="saveCategory">
      <header><h3>Add an asset category</h3><button type="button" class="cw-icon-btn" aria-label="Close" @click="addingCategory = false"><X :size="20" /></button></header>
      <div class="cw-dialog-body">
        <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 12px">
          <label class="cw-field"><span class="cw-label">Code <span class="req">*</span></span><input v-model="c.code" class="cw-input" required /></label>
          <label class="cw-field"><span class="cw-label">Name <span class="req">*</span></span><input v-model="c.name" class="cw-input" required minlength="2" placeholder="Motor vehicles" /></label>
        </div>
        <label class="cw-field"><span class="cw-label">Asset account (cost) <span class="req">*</span></span>
          <select v-model="c.asset_account_id" class="cw-select" required><option value="">Choose an account</option><option v-for="x in of(['fixed_asset'], ['asset'])" :key="x.id" :value="x.id">{{ x.code }} {{ x.name }}</option></select>
          <span v-if="!of(['fixed_asset'], ['asset']).length" class="cw-hint">No account in the chart is marked as a fixed asset.</span></label>
        <label class="cw-field"><span class="cw-label">Depreciation</span>
          <select v-model="c.method" class="cw-select"><option value="straight_line">Straight line</option><option value="none">Not depreciated (land)</option></select></label>
        <template v-if="c.method === 'straight_line'">
          <label class="cw-field"><span class="cw-label">Accumulated depreciation account <span class="req">*</span></span>
            <select v-model="c.accumulated_account_id" class="cw-select" required><option value="">Choose an account</option><option v-for="x in of([], ['asset'])" :key="x.id" :value="x.id">{{ x.code }} {{ x.name }}</option></select></label>
          <label class="cw-field"><span class="cw-label">Depreciation expense account <span class="req">*</span></span>
            <select v-model="c.expense_account_id" class="cw-select" required><option value="">Choose an account</option><option v-for="x in of([], ['expense'])" :key="x.id" :value="x.id">{{ x.code }} {{ x.name }}</option></select></label>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
            <label class="cw-field"><span class="cw-label">Useful life in years <span class="req">*</span></span><input v-model="c.useful_life_years" class="cw-input" inputmode="decimal" required /></label>
            <label class="cw-field"><span class="cw-label">Residual value, % of cost</span><input v-model="c.residual_pct" class="cw-input" inputmode="decimal" placeholder="0" /></label>
          </div>
          <span class="cw-hint">From the Council's accounting policy. An individual asset can carry its own life and residual value.</span>
        </template>
        <p v-if="formError" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ formError }}</p>
      </div>
      <footer>
        <button type="button" class="cw-btn" @click="addingCategory = false">Cancel</button>
        <button type="submit" class="cw-btn cw-btn--primary" :disabled="!!busy || !c.code.trim() || !c.asset_account_id">{{ busy === 'category' ? 'Saving…' : 'Save' }}</button>
      </footer>
    </form>
  </div>

  <!-- A run's charges -->
  <div v-if="charges" class="cw-dialog-backdrop" @click.self="charges = null" @keydown.esc="charges = null">
    <div class="cw-dialog" role="dialog" aria-modal="true" :aria-label="`Charges of ${charges.run.run_no}`">
      <header><h3>{{ charges.run.run_no }}, {{ charges.run.period_label ?? `period ${charges.run.period_no}` }}</h3><button type="button" class="cw-icon-btn" aria-label="Close" @click="charges = null"><X :size="20" /></button></header>
      <div class="cw-dialog-body cw-table-wrap">
        <table class="cw-table">
          <thead><tr><th>Asset</th><th>Category</th><th class="num">Charge</th></tr></thead>
          <tbody><tr v-for="row in charges.rows" :key="row.asset_no"><td><strong>{{ row.asset_no }}</strong> {{ row.name }}</td><td>{{ row.category_name }}</td><td class="num">{{ formatMoney(row.amount, charges.run.currency) }}</td></tr></tbody>
        </table>
      </div>
      <footer><button type="button" class="cw-btn" @click="charges = null">Close</button></footer>
    </div>
  </div>
</template>

<style scoped>
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ar-totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin: 0; }
.ar-totals > div { padding: 12px 14px; border: 1px solid #e3e8ee; border-radius: var(--cw-r); background: var(--cw-surface); }
.ar-totals dt { font-size: 12.5px; color: var(--cw-ink-2); }
.ar-totals dd { margin: 2px 0; font-size: 20px; font-weight: 650; font-variant-numeric: tabular-nums; }
.ar-tabs { max-width: 460px; }
.ar-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.ar-acts { white-space: nowrap; }
.ar-acts > * { vertical-align: middle; margin-left: 6px; }
.ar-runform { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-top: 10px; }
.ar-runform .cw-field:first-child { flex: 1 1 320px; }
</style>
