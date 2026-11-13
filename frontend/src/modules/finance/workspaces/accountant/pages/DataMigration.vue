<script setup lang="ts">
/**
 * Data migration: bring the books across from the previous accounting package (Pastel, Sage,
 * Promun) and prove the opening position before it is signed off.
 *
 * Five loads in order, each a file checked row by row; a reconciliation of the old package's
 * balances against this ledger; and a sign-off by somebody who did not load the data. What may be
 * written and when the sign-off is refused are the database's rules (migration 211), read here
 * from the server's own checklist.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { AlertTriangle, CircleCheck, CircleDashed, DatabaseBackup, Download, Upload } from 'lucide-vue-next'
import MigrationBatch from './migration/MigrationBatch.vue'
import MigrationReconciliation from './migration/MigrationReconciliation.vue'
import ReasonDialog from '../../shared/ReasonDialog.vue'
import { migrationApi, type Cutover, type CutoverDetail, type LoadKind, type MigrationBatch as Batch, type MigrationProfiles, type UploadFields } from '../../../api/migrationApi'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatDateTime } from '../../../composables/useMoney'
import type { Currency } from '../../../models/types'
import type { LedgerAccount } from '../../../models/ledgerTypes'

const store = useFinanceStore()
const canPrepare = computed(() => store.can('finance.migration.prepare'))
const canSignOff = computed(() => store.can('finance.migration.signoff'))
const canPost = computed(() => store.can('finance.ledger.voucher.post'))
const userId = computed(() => store.identity?.user_id ?? null)

const profiles = ref<MigrationProfiles | null>(null)
const cutovers = ref<Cutover[]>([])
const detail = ref<CutoverDetail | null>(null)
const accounts = ref<LedgerAccount[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref<string | null>(null)
const openBatch = ref<string | null>(null)
const openRecon = ref<string | null>(null)
const abandoning = ref(false)
const signNote = ref('')

const current = computed(() => detail.value?.cutover ?? null)
const preparing = computed(() => current.value?.status === 'preparing')
const past = computed(() => cutovers.value.filter((c) => c.id !== current.value?.id))
const sourceLabel = (key: string) => profiles.value?.source_systems.find((s) => s.key === key)?.label ?? key

async function loadAccounts(): Promise<void> {
  try { accounts.value = (await ledgerApi.accounts({ sort: 'code' })).accounts } catch { accounts.value = [] }
}
async function refresh(): Promise<void> {
  error.value = null
  try {
    cutovers.value = await migrationApi.cutovers()
    const pick = cutovers.value.find((c) => c.status === 'preparing') ?? cutovers.value.find((c) => c.id === current.value?.id) ?? cutovers.value.find((c) => c.status === 'signed_off')
    detail.value = pick ? await migrationApi.cutover(pick.id) : null
    await loadAccounts()
  } catch (err) {
    error.value = messageOf(err, 'The cut-over could not be read.')
  }
}
onMounted(async () => {
  try { profiles.value = await migrationApi.profiles() } catch (err) { error.value = messageOf(err, 'The cut-over could not be read.') }
  await refresh()
  loading.value = false
})

// ── Starting a cut-over ───────────────────────────────────────────────────────────────────────
const start = reactive({ name: '', source_system: 'pastel_partner', source_version: '', cutover_date: '' })
async function startCutover(): Promise<void> {
  if (!store.selectedYearId || busy.value) return
  busy.value = 'start'
  error.value = null
  try {
    await migrationApi.createCutover({
      name: start.name.trim(), source_system: start.source_system, cutover_date: start.cutover_date,
      financial_year_id: store.selectedYearId, ...(start.source_version.trim() ? { source_version: start.source_version.trim() } : {}),
    })
    await refresh()
  } catch (err) {
    error.value = messageOf(err, 'The cut-over could not be started.')
  } finally {
    busy.value = null
  }
}

// ── The loads ─────────────────────────────────────────────────────────────────────────────────
interface Step { kind: LoadKind; title: string; lead: string; needs?: string }
const STEPS: Step[] = [
  { kind: 'chart', title: '1. Chart of accounts', lead: 'The old package\'s account list. Every old account number ends mapped to a ledger account or retired with a reason, and that mapping is kept permanently.' },
  { kind: 'parties', title: '2. Customers and suppliers', lead: 'The customer and supplier masters, one file each. A possible duplicate is decided by a person; nothing is merged because two names look alike.' },
  { kind: 'opening_balance', title: '3. Opening trial balance', lead: 'The trial balance at the cut-over date, one file per currency. It must balance to nil. It becomes a draft opening voucher that somebody other than you posts.' },
  { kind: 'open_items', title: '4. Open items', lead: 'The debtors and creditors age analysis, by document or by age column. Its total must equal the control account in the opening trial balance, and each document keeps its own date so ageing continues.' },
  { kind: 'comparison_balance', title: 'Parallel run (optional)', lead: 'A later trial balance from the old package, after a period kept in both systems, compared with this ledger at the same date.' },
]
const batchesOf = (kind: LoadKind): Batch[] => (detail.value?.batches ?? []).filter((b) => b.load_kind === kind)
const STATUS: Record<string, { label: string; tone: string }> = {
  uploaded: { label: 'Not yet checked', tone: 'cw-pill--warn' }, validated: { label: 'Checked', tone: 'cw-pill--info' },
  committed: { label: 'Committed', tone: 'cw-pill--pos' }, cancelled: { label: 'Cancelled', tone: 'cw-pill--mute' },
  withdrawn: { label: 'Withdrawn', tone: 'cw-pill--mute' },
}
const describe = (b: Batch): string => {
  const bits = [b.currency, b.item_side, b.options.party_kind ? `${b.options.party_kind}s` : null, b.as_at ? `at ${formatDate(b.as_at)}` : null].filter(Boolean)
  if (b.status === 'committed' && b.vouchers_draft > 0) bits.push(`${b.vouchers_draft} voucher(s) to post`)
  else if (b.status === 'validated' && b.rows_problem > 0) bits.push(`${b.rows_problem} row(s) need a decision`)
  return bits.join(' · ')
}

const uploading = ref<LoadKind | null>(null)
const form = reactive({
  file: null as File | null, has_header: true, currency: 'USD' as Currency, item_side: 'debtors' as 'debtors' | 'creditors',
  control_account_id: '', as_at: '', declared_total: '', party_kind: 'customer' as 'customer' | 'supplier', party_type: 'debtor' as 'debtor' | 'ratepayer',
})
const controlAccounts = computed(() => accounts.value.filter((a) => a.account_type === (form.item_side === 'debtors' ? 'receivable' : 'payable') && a.is_postable))
function openUpload(kind: LoadKind): void {
  Object.assign(form, { file: null, has_header: true, control_account_id: '', as_at: '', declared_total: '' })
  uploading.value = kind
  error.value = null
}
function pickFile(event: Event): void {
  form.file = (event.target as HTMLInputElement).files?.[0] ?? null
}
const balanceKind = (kind: LoadKind) => ['opening_balance', 'open_items', 'comparison_balance'].includes(kind)
const uploadReady = computed(() => !!form.file && !!uploading.value
  && (uploading.value !== 'open_items' || !!form.control_account_id)
  && (uploading.value !== 'comparison_balance' || !!form.as_at))
async function upload(): Promise<void> {
  const kind = uploading.value
  if (!kind || !form.file || !current.value || busy.value) return
  busy.value = 'upload'
  error.value = null
  try {
    const fields: UploadFields = { load_kind: kind, has_header: form.has_header }
    if (balanceKind(kind)) fields.currency = form.currency
    if (kind === 'open_items') Object.assign(fields, { item_side: form.item_side, control_account_id: form.control_account_id })
    if (kind === 'comparison_balance') fields.as_at = form.as_at
    if (kind === 'opening_balance' || kind === 'comparison_balance') fields.declared_total = form.declared_total.trim()
    if (kind === 'parties') Object.assign(fields, { party_kind: form.party_kind, party_type: form.party_type })
    const made = await migrationApi.upload(current.value.id, form.file, fields)
    uploading.value = null
    await refresh()
    openBatch.value = made.id
  } catch (err) {
    error.value = messageOf(err, 'The file could not be uploaded.')
  } finally {
    busy.value = null
  }
}
async function template(kind: LoadKind): Promise<void> {
  try {
    const url = URL.createObjectURL(await migrationApi.template(kind))
    const a = document.createElement('a')
    a.href = url
    a.download = `cutover-${kind.replace(/_/g, '-')}-template.csv`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    error.value = messageOf(err, 'The template could not be downloaded.')
  }
}

// ── Checklist and sign-off ────────────────────────────────────────────────────────────────────
const CHECK_LABEL: Record<string, string> = {
  chart: 'Chart of accounts mapped', parties: 'Customers and suppliers brought across', opening_balance: 'Opening trial balance loaded',
  open_items: 'Open items loaded', nothing_pending: 'No file left unfinished', vouchers_posted: 'Opening vouchers posted',
  reconciled: 'Reconciled against the ledger', differences_explained: 'Every difference explained',
}
const blockers = computed(() => (detail.value?.readiness ?? []).filter((r) => r.blocking && !r.passed))
const iLoaded = computed(() => !!current.value && (current.value.created_by === userId.value
  || (detail.value?.batches ?? []).some((b) => b.uploaded_by === userId.value || b.committed_by === userId.value)))

async function signOff(): Promise<void> {
  if (!current.value || busy.value) return
  busy.value = 'sign'
  error.value = null
  try {
    notice.value = (await migrationApi.signOff(current.value.id, signNote.value)).note
    await refresh()
  } catch (err) {
    error.value = messageOf(err, 'The cut-over could not be signed off.')
  } finally {
    busy.value = null
  }
}
async function abandon(reason: string): Promise<void> {
  if (!current.value || busy.value) return
  busy.value = 'abandon'
  error.value = null
  try {
    await migrationApi.abandon(current.value.id, reason)
    abandoning.value = false
    detail.value = null
    await refresh()
  } catch (err) {
    error.value = messageOf(err, 'The cut-over could not be abandoned.')
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><DatabaseBackup :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Data Migration</h2>
      <p>Bring the books across from the previous accounting package: accounts, customers, suppliers and opening balances, reconciled before anybody signs them off.</p>
    </div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
  <p v-if="notice" class="cw-banner-msg cw-banner-msg--pos" role="status"><CircleCheck :size="18" aria-hidden="true" />{{ notice }}</p>
  <section v-if="loading" class="cw-card"><div class="cw-card-body" style="padding-top: 16px"><span class="cw-skel" /><span class="cw-skel" /><span class="cw-skel" /></div></section>

  <!-- No cut-over in progress -->
  <section v-else-if="!current || current.status === 'abandoned'" class="cw-card" aria-labelledby="dm-start">
    <div class="cw-card-head"><h3 id="dm-start">Start a cut-over</h3></div>
    <div class="cw-card-body">
      <p v-if="!canPrepare" class="cw-empty"><strong>No cut-over is in progress.</strong>Starting one needs the permission to load the previous package's data.</p>
      <form v-else class="dm-form" @submit.prevent="startCutover">
        <p class="cw-hint" style="grid-column: 1 / -1">
          The opening balances are posted on the cut-over date: it is the first day kept in this ledger, and the figures are the old package's closing balances of the day before.
          The date must fall in the financial year chosen in the banner<template v-if="store.selectedYear"> ({{ store.selectedYear.label }})</template>, and its accounting period must be open.
        </p>
        <label class="cw-field"><span class="cw-label">Name <span class="req">*</span></span><input v-model="start.name" class="cw-input" required minlength="3" placeholder="e.g. Pastel to Vungu ledger, July 2026" /></label>
        <label class="cw-field"><span class="cw-label">Previous package <span class="req">*</span></span>
          <select v-model="start.source_system" class="cw-select"><option v-for="s in profiles?.source_systems ?? []" :key="s.key" :value="s.key">{{ s.label }}</option></select></label>
        <label class="cw-field"><span class="cw-label">Version</span><input v-model="start.source_version" class="cw-input" placeholder="As shown in the package's Help, About" /></label>
        <label class="cw-field"><span class="cw-label">Cut-over date <span class="req">*</span></span><input v-model="start.cutover_date" type="date" class="cw-input" required /></label>
        <div style="grid-column: 1 / -1">
          <button type="submit" class="cw-btn cw-btn--primary" :disabled="!!busy || start.name.trim().length < 3 || !start.cutover_date || !store.selectedYearId">{{ busy === 'start' ? 'Starting…' : 'Start the cut-over' }}</button>
        </div>
      </form>
    </div>
  </section>

  <template v-if="!loading && current && current.status !== 'abandoned' && profiles && detail">
    <!-- The cut-over and its checklist -->
    <div class="dm-top">
      <section class="cw-card" aria-labelledby="dm-co">
        <div class="cw-card-head">
          <h3 id="dm-co">{{ current.name }}</h3><span class="cw-spacer" />
          <span class="cw-pill" :class="preparing ? 'cw-pill--info' : 'cw-pill--pos'">{{ preparing ? 'Being prepared' : 'Signed off' }}</span>
        </div>
        <div class="cw-card-body">
          <dl class="cw-kv">
            <div><dt>Previous package</dt><dd>{{ [sourceLabel(current.source_system), current.source_version].filter(Boolean).join(', ') }}</dd></div>
            <div><dt>Cut-over date</dt><dd>{{ formatDate(current.cutover_date) }}</dd></div>
            <div><dt>Financial year</dt><dd>{{ current.financial_year_label }}</dd></div>
            <div><dt>Started by</dt><dd>{{ current.created_by_name ?? '—' }}</dd></div>
            <div v-if="current.signed_off_at"><dt>Signed off</dt><dd>{{ current.signed_off_by_name }}, {{ formatDateTime(current.signed_off_at) }}</dd></div>
          </dl>
          <p v-if="current.sign_off_note" class="cw-hint">{{ current.sign_off_note }}</p>
          <p v-if="preparing && !detail.opening_period" class="cw-banner-msg cw-banner-msg--warn" role="alert">
            <AlertTriangle :size="18" aria-hidden="true" />
            <span>No accounting period contains the cut-over date, so the opening vouchers cannot be posted. <RouterLink :to="{ name: 'acc-close' }" class="cw-link">Open the periods for the year</RouterLink></span>
          </p>
          <p v-else-if="preparing && detail.opening_period && detail.opening_period.status !== 'open'" class="cw-banner-msg cw-banner-msg--warn" role="alert">
            <AlertTriangle :size="18" aria-hidden="true" />
            <span>Period {{ detail.opening_period.period_no }} is {{ detail.opening_period.status }}, so the opening vouchers cannot be posted into it. <RouterLink :to="{ name: 'acc-close' }" class="cw-link">Close Period</RouterLink></span>
          </p>
          <button v-if="preparing && canPrepare" type="button" class="cw-link" style="margin-top: 8px" @click="abandoning = true">Abandon this cut-over</button>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="dm-ck">
        <div class="cw-card-head"><h3 id="dm-ck">Checklist</h3></div>
        <div class="cw-card-body">
          <ul class="dm-checks">
            <li v-for="c in detail.readiness" :key="c.check_key" :class="{ 'dm-checks--done': c.passed }">
              <CircleCheck v-if="c.passed" :size="19" aria-hidden="true" /><CircleDashed v-else :size="19" aria-hidden="true" />
              <div>
                <strong>{{ CHECK_LABEL[c.check_key] ?? c.check_key }}</strong>
                <span class="sr-only">{{ c.passed ? ', done' : ', outstanding' }}</span>
                <span v-if="!c.blocking" class="cw-pill cw-pill--mute">Optional</span>
                <div class="cw-hint">{{ c.detail }}</div>
              </div>
            </li>
          </ul>
        </div>
      </section>
    </div>

    <!-- The loads -->
    <section v-for="step in STEPS" :key="step.kind" class="cw-card" :aria-labelledby="`dm-${step.kind}`">
      <div class="cw-card-head">
        <h3 :id="`dm-${step.kind}`">{{ step.title }}</h3><span class="cw-spacer" />
        <button type="button" class="cw-link" @click="template(step.kind)"><Download :size="15" aria-hidden="true" /> Blank template</button>
        <button v-if="preparing && canPrepare" type="button" class="cw-btn cw-btn--small cw-btn--outline" @click="openUpload(step.kind)"><Upload :size="15" aria-hidden="true" /> Upload a file</button>
      </div>
      <div class="cw-card-body dm-step">
        <p class="cw-hint">{{ step.lead }}</p>
        <p v-if="!batchesOf(step.kind).length" class="dm-none">No file uploaded yet.</p>
        <ul v-else class="dm-files">
          <li v-for="b in batchesOf(step.kind)" :key="b.id">
            <button v-if="openBatch !== b.id" type="button" class="dm-file" :aria-label="`Open ${b.original_filename}`" @click="openBatch = b.id">
              <strong>{{ b.original_filename }}</strong>
              <span class="cw-hint">{{ describe(b) }}</span>
              <span class="cw-pill" :class="STATUS[b.status].tone">{{ STATUS[b.status].label }}</span>
            </button>
            <MigrationBatch
              v-else :key="`${b.id}-${b.status}`" :batch-id="b.id" :profiles="profiles" :accounts="accounts" :user-id="userId"
              :can-prepare="canPrepare && preparing" :can-post="canPost" open
              @changed="refresh" @close="openBatch = null"
            />
          </li>
        </ul>
      </div>
    </section>

    <!-- Reconciliation -->
    <section class="cw-card" aria-labelledby="dm-rec">
      <div class="cw-card-head"><h3 id="dm-rec">5. Reconciliation</h3></div>
      <div class="cw-card-body dm-step">
        <p class="cw-hint">Each ledger account's balance in the old package against this ledger at the same date. Draw one up from a posted opening trial balance (step 3). A difference needs a written explanation; it is never waived.</p>
        <p v-if="!detail.reconciliations.length" class="dm-none">No reconciliation has been drawn up yet.</p>
        <ul v-else class="dm-files">
          <li v-for="r in detail.reconciliations" :key="r.id">
            <button type="button" class="dm-file" :aria-expanded="openRecon === r.id" @click="openRecon = openRecon === r.id ? null : r.id">
              <strong>{{ r.kind === 'opening' ? 'Opening position' : 'Parallel run' }}, {{ r.currency }}, at {{ formatDate(r.as_at) }}</strong>
              <span class="cw-hint">{{ r.lines }} accounts</span>
              <span class="cw-pill" :class="r.unexplained ? 'cw-pill--warn' : 'cw-pill--pos'">{{ r.differences === 0 ? 'Agrees' : `${r.differences} difference(s), ${r.unexplained} unexplained` }}</span>
            </button>
            <MigrationReconciliation v-if="openRecon === r.id" :reconciliation-id="r.id" :can-prepare="canPrepare" :closed="!preparing" @changed="refresh" />
          </li>
        </ul>
      </div>
    </section>

    <!-- Sign-off -->
    <section v-if="preparing" class="cw-card" aria-labelledby="dm-sign">
      <div class="cw-card-head"><h3 id="dm-sign">6. Sign-off</h3></div>
      <div class="cw-card-body dm-step">
        <p class="cw-hint">Signing off closes the cut-over: its files, account mapping and reconciliation are kept as the evidence for the change of book. It is signed by somebody who did not load the data.</p>
        <p v-if="blockers.length" class="cw-banner-msg cw-banner-msg--info" role="status">Still to do: {{ blockers.map((b) => CHECK_LABEL[b.check_key] ?? b.check_key).join('; ') }}.</p>
        <p v-if="!canSignOff" class="cw-banner-msg cw-banner-msg--info" role="status">The Director of Finance signs off the cut-over. You can prepare everything up to this point.</p>
        <p v-else-if="iLoaded" class="cw-banner-msg cw-banner-msg--info" role="status">You loaded part of this cut-over, so signing it off is not yours to do.</p>
        <form v-else class="dm-sign" @submit.prevent="signOff">
          <label class="cw-field"><span class="cw-label">Note (optional)</span><input v-model="signNote" class="cw-input" placeholder="e.g. Agreed to the Pastel trial balance printed 30 June" /></label>
          <button type="submit" class="cw-btn cw-btn--primary" :disabled="!!busy || blockers.length > 0">{{ busy === 'sign' ? 'Signing off…' : 'Sign off the cut-over' }}</button>
        </form>
      </div>
    </section>
  </template>

  <section v-if="!loading && past.length" class="cw-card" aria-labelledby="dm-past">
    <div class="cw-card-head"><h3 id="dm-past">Earlier cut-overs</h3></div>
    <div class="cw-card-body">
      <div class="cw-table-wrap">
        <table class="cw-table">
          <thead><tr><th>Name</th><th>Package</th><th>Cut-over date</th><th>Outcome</th></tr></thead>
          <tbody>
            <tr v-for="c in past" :key="c.id">
              <td>{{ c.name }}</td><td>{{ sourceLabel(c.source_system) }}</td><td>{{ formatDate(c.cutover_date) }}</td>
              <td>{{ c.status === 'signed_off' ? `Signed off by ${c.signed_off_by_name ?? 'somebody'}` : c.status === 'abandoned' ? `Abandoned: ${c.abandon_reason ?? ''}` : 'Being prepared' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <!-- Upload -->
  <div v-if="uploading && profiles" class="cw-dialog-backdrop" @click.self="uploading = null" @keydown.esc="uploading = null">
    <form class="cw-dialog" role="dialog" aria-modal="true" aria-label="Upload a file" @submit.prevent="upload">
      <header><h3>{{ profiles.loads.find((l) => l.key === uploading)?.label }}</h3></header>
      <div class="cw-dialog-body">
        <label class="cw-field"><span class="cw-label">File <span class="req">*</span></span>
          <input type="file" class="cw-input" accept=".csv,.txt,.xlsx" required @change="pickFile" />
          <span class="cw-hint">A .csv or .xlsx export from the old package. Old .xls files must be saved as .xlsx first.</span></label>
        <label class="dm-inline"><input v-model="form.has_header" type="checkbox" class="cw-check" /> The first row is column headings</label>
        <p v-if="!form.has_header" class="cw-hint">Pastel Partner writes several exports with no heading row. The columns will be named Column 1, Column 2 and so on for you to assign.</p>
        <label v-if="uploading === 'parties'" class="cw-field"><span class="cw-label">This file lists</span>
          <select v-model="form.party_kind" class="cw-select"><option value="customer">Customers</option><option value="supplier">Suppliers</option></select></label>
        <label v-if="uploading === 'parties' && form.party_kind === 'customer'" class="cw-field"><span class="cw-label">Bring them across as</span>
          <select v-model="form.party_type" class="cw-select"><option value="debtor">Sundry debtors</option><option value="ratepayer">Ratepayers</option></select></label>
        <label v-if="balanceKind(uploading)" class="cw-field"><span class="cw-label">Currency of this file <span class="req">*</span></span>
          <select v-model="form.currency" class="cw-select"><option value="USD">USD</option><option value="ZWG">ZWG</option></select>
          <span class="cw-hint">Each currency is its own book and is loaded from its own file.</span></label>
        <template v-if="uploading === 'open_items'">
          <label class="cw-field"><span class="cw-label">These are</span>
            <select v-model="form.item_side" class="cw-select" @change="form.control_account_id = ''"><option value="debtors">Debtors (owed to the council)</option><option value="creditors">Creditors (owed by the council)</option></select></label>
          <label class="cw-field"><span class="cw-label">Control account <span class="req">*</span></span>
            <select v-model="form.control_account_id" class="cw-select" required>
              <option value="">Choose the control account</option>
              <option v-for="a in controlAccounts" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option>
            </select>
            <span v-if="!controlAccounts.length" class="cw-hint">No {{ form.item_side === 'debtors' ? 'receivable' : 'payable' }} control account is in the chart yet. Load the chart of accounts first.</span></label>
        </template>
        <label v-if="uploading === 'comparison_balance'" class="cw-field"><span class="cw-label">Trial balance printed at <span class="req">*</span></span><input v-model="form.as_at" type="date" class="cw-input" required /></label>
        <label v-if="uploading === 'opening_balance' || uploading === 'comparison_balance'" class="cw-field"><span class="cw-label">Control total (optional)</span>
          <input v-model="form.declared_total" class="cw-input" inputmode="decimal" placeholder="Total debits on the printed report" /></label>
        <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ error }}</p>
      </div>
      <footer>
        <button type="button" class="cw-btn" @click="uploading = null">Cancel</button>
        <button type="submit" class="cw-btn cw-btn--primary" :disabled="!!busy || !uploadReady">{{ busy === 'upload' ? 'Uploading…' : 'Upload' }}</button>
      </footer>
    </form>
  </div>

  <ReasonDialog
    v-if="abandoning" title="Abandon this cut-over" label="Reason" :min-length="3" submit-label="Abandon" danger :busy="busy === 'abandon'" :error="error"
    message="The files and mapping are kept on the record. A cut-over that has raised opening vouchers must have each balance load withdrawn first."
    @submit="abandon" @close="abandoning = false"
  />
</template>

<style scoped>
.dm-top { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.dm-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.dm-step { display: flex; flex-direction: column; gap: 10px; }
.dm-none { margin: 0; color: var(--cw-ink-2); font-size: 13.5px; }
.dm-files { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.dm-file { width: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 10px 12px; border: 1px solid var(--cw-line); border-radius: 8px; background: #fff; font: inherit; text-align: left; cursor: pointer; }
.dm-file:hover { background: #f6f9fd; }
.dm-file strong { flex: 1 1 220px; overflow-wrap: anywhere; }
.dm-checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.dm-checks li { display: flex; gap: 10px; align-items: flex-start; color: var(--cw-ink-2); }
.dm-checks li strong { color: var(--cw-ink); font-size: 13.5px; margin-right: 6px; }
.dm-checks--done svg { color: var(--cw-pos); }
.dm-sign { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.dm-sign .cw-field { flex: 1 1 320px; }
.dm-inline { display: inline-flex; align-items: center; gap: 8px; font-size: 13.5px; }
</style>
