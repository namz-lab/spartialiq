<script setup lang="ts">
/**
 * Data imports: upload → map → validate → resolve exceptions → reconcile → commit.
 *
 * This is the screen the council's finance office will spend most of its time in, and the one
 * where a quiet mistake becomes a wrong published figure. Five things are therefore deliberate.
 *
 * 1. THE MAPPING IS SHOWN BEFORE ANYTHING IS VALIDATED. An officer sees which column of their file
 *    fed which field, which columns went unused, and which required fields nothing matched. A file
 *    whose "Amount" column was never found should be visible as that, not as four thousand
 *    identical row errors.
 *
 * 2. THE EXCEPTIONS ARE ROW-LEVEL AND NAMED. Each one carries the row number as the officer's own
 *    spreadsheet numbers it (row 1 is the header), the field, and a sentence. "Row 2817 is invalid"
 *    is useless; "row 2817: account code 9910 is not in the chart of accounts" is a task.
 *
 * 3. RECONCILIATION IS AGAINST WHAT THE COUNCIL DECLARES, not against the file. The upload form
 *    asks for the control count and total from the council's own report, because comparing a file
 *    with itself proves nothing and a truncated export looks perfectly valid on its own terms.
 *
 * 4. COMMITTING AN UNRECONCILED BATCH IS POSSIBLE AND COSTS A WRITTEN REASON, which is kept on the
 *    batch and in the audit trail. Refusing outright would leave a council stuck when its own
 *    control totals are wrong; doing it silently would defeat the control.
 *
 * 5. THE IDEMPOTENCY KEY IS GENERATED ONCE PER ATTEMPT AND REUSED ON RETRY, so a timeout on a
 *    rural connection cannot leave the council with two copies of its expenditure.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { financeApi } from '../../api/financeApi'
import { formatMoney, formatDate, formatDateTime, formatBytes } from '../../composables/useMoney'
import type {
  Currency, ImportBatch, ImportDataset, ImportException, ImportReconciliation,
  ImportStatus, ImportUploadResult, ImportValidationResult,
} from '../../models/types'
import { useFinancePrompt } from '../../composables/useFinancePrompt'
import FinanceGuard from '../../components/FinanceGuard.vue'
import FinancePromptDialog from '../../components/FinancePromptDialog.vue'
import {
  AlertTriangle, CheckCircle2, RefreshCw, Upload, FileCheck2, Ban, Info,
  ListChecks, Scale, PlayCircle, X, FileWarning, Table2,
} from 'lucide-vue-next'

const store = useFinanceStore()
const prompt = useFinancePrompt()

const batches = ref<ImportBatch[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref<string | null>(null)

const datasetFilter = ref<ImportDataset | ''>('')

/**
 * Which batches the history opens on.
 *
 * `finance.import.commit` is granted to the finance administrator alone — the second-pair-of-eyes
 * rule — and until now the only role that could act on a validated batch had no way of being told
 * one was waiting: the history had no status filter, no default and no count, so a validated batch
 * could sit indefinitely with nobody informed and the actuals pipeline stalled in silence. An
 * explicit `?status=` link wins; then the preset, which sets `validated` for the committer.
 */
const route = useRoute()
const STATUSES: Array<{ id: ImportStatus | ''; label: string }> = [
  { id: '', label: 'All statuses' },
  { id: 'uploaded', label: 'Uploaded' },
  { id: 'mapped', label: 'Mapped' },
  { id: 'validated', label: 'Validated' },
  { id: 'committed', label: 'Committed' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Cancelled' },
]
const linkedStatus = typeof route.query.status === 'string' ? route.query.status : ''
const statusFilter = ref<ImportStatus | ''>(
  STATUSES.some((s) => s.id === linkedStatus && s.id !== '')
    ? linkedStatus as ImportStatus
    : (store.rolePreset.defaultFilters.importStatus ?? ''),
)

const yearId = computed(() => store.selectedYearId)
const writable = computed(() => store.selectedYearAcceptsWrites)

const canUpload = computed(() => store.can('finance.import.upload'))
// Validation is guarded by FinanceGuard around its own control, so there is no `canValidate`
// computed here — one place per decision.
const canCommit = computed(() => store.can('finance.import.commit'))
const canResolve = computed(() => store.can('finance.import.exception.resolve'))

const DATASETS: Array<{ id: ImportDataset; label: string; help: string }> = [
  { id: 'actuals', label: 'Actuals', help: 'Posted revenue and expenditure transactions from the accounting system.' },
  { id: 'budget', label: 'Budget', help: 'Budget lines. They arrive as drafts — an import is not an approval.' },
  { id: 'commitments', label: 'Commitments', help: 'Outstanding orders and contracts that encumber a budget line.' },
  { id: 'projects', label: 'Projects', help: 'The project register. Imported projects arrive as proposals.' },
]

// ── Upload ────────────────────────────────────────────────────────────────────────────────────
const upload = ref<{
  file: File | null; dataset: ImportDataset; declaredCount: string
  declaredTotal: string; declaredCurrency: Currency; mappingId: string
  idempotencyKey: string; progress: number
}>({
  file: null, dataset: 'actuals', declaredCount: '', declaredTotal: '',
  declaredCurrency: 'USD', mappingId: '', idempotencyKey: '', progress: 0,
})
const uploadResult = ref<ImportUploadResult | null>(null)
const mappings = ref<Array<{ id: string; name: string; dataset: ImportDataset; is_default: boolean }>>([])

function newKey(): string {
  // One key per attempt. Reusing it on retry is what makes the retry safe; a fresh one on a real
  // second upload is what keeps two genuine uploads apart.
  return (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

function pickFile(event: Event): void {
  const input = event.target as HTMLInputElement
  upload.value.file = input.files?.[0] ?? null
  upload.value.idempotencyKey = newKey()
  uploadResult.value = null
}

async function send(): Promise<void> {
  error.value = null; note.value = null
  if (!upload.value.file || !yearId.value) { error.value = 'Choose a file and a financial year first.'; return }
  if (!upload.value.idempotencyKey) upload.value.idempotencyKey = newKey()
  busy.value = 'upload'
  upload.value.progress = 0
  try {
    uploadResult.value = await financeApi.uploadImport({
      file: upload.value.file,
      dataset: upload.value.dataset,
      financialYearId: yearId.value,
      idempotencyKey: upload.value.idempotencyKey,
      mappingId: upload.value.mappingId || undefined,
      declaredControlCount: upload.value.declaredCount ? Number(upload.value.declaredCount) : undefined,
      declaredControlTotal: upload.value.declaredTotal.trim() || undefined,
      declaredControlCurrency: upload.value.declaredTotal.trim() ? upload.value.declaredCurrency : undefined,
      onProgress: (p) => { upload.value.progress = p },
    })
    note.value = uploadResult.value.already_existed
      ? 'This upload had already been received — the same batch is shown, not a second copy.'
      : 'File received and preserved. Check the mapping below, then validate.'
    await load()
  } catch (err) {
    error.value = messageOf(err, 'The file could not be uploaded.')
  } finally {
    busy.value = null
  }
}

// ── The working batch ─────────────────────────────────────────────────────────────────────────
const active = ref<ImportBatch | null>(null)
const validation = ref<ImportValidationResult | null>(null)
const exceptions = ref<ImportException[]>([])
const reconciliation = ref<ImportReconciliation | null>(null)
const mappingReport = computed(() => uploadResult.value?.mapping ?? null)
/**
 * TELLING THE SYSTEM WHICH COLUMN IS WHICH.
 *
 * The alias table matches most councils' exports, but not an export whose heading reads "Vote" for
 * the department or "Amt (USD)" for the amount. When nothing matches a required field the server
 * reports it as ONE fault about the file rather than one per row — and until these controls
 * existed there was no way to answer it, so a file with one unrecognised heading could not be
 * imported through this console at all, only through the API.
 *
 * The mapping is per target field, taken from the headings the file actually has, and it is sent
 * with validation rather than saved: a wrong guess is corrected by validating again, and nothing
 * has been posted.
 */
const columnOverrides = ref<Record<string, string>>({})
const dateOrder = ref<'day_first' | 'month_first'>('day_first')

/**
 * The target fields the profile that read this batch knows about, kept when a batch is REOPENED
 * from the list rather than just uploaded.
 *
 * Without it the mapping controls would exist only in the minutes after an upload: an officer who
 * uploaded a file on Friday, saw it fail on an unrecognised heading and came back on Monday would
 * find nothing to answer it with. The file's own headings are not recoverable at that point — only
 * the upload response carries them — so that case takes a typed heading rather than a list.
 */
const batchMapping = ref<Record<string, string[]> | null>(null)

/** The headings of the uploaded file, where this batch is the one just uploaded. */
const fileHeaders = computed<string[]>(() =>
  (uploadResult.value?.file.header_row ?? []).filter((h) => h && h.trim() !== ''))

/**
 * The fields worth offering a mapping for: the ones nothing matched, required first. A field the
 * alias table already resolved is listed too, so a column matched to the WRONG target — the fault
 * no error message can report, because the file reads perfectly — can be corrected.
 */
const mappableFields = computed<Array<{ field: string; required: boolean; matched: string | null }>>(() => {
  const report = mappingReport.value
  if (!report) {
    return Object.keys(batchMapping.value ?? {}).map((field) => ({ field, required: false, matched: null }))
  }
  const required = new Set(report.missing_required ?? [])
  const rows: Array<{ field: string; required: boolean; matched: string | null }> = []
  for (const field of report.missing_required ?? []) rows.push({ field, required: true, matched: null })
  for (const field of report.unmatched_targets ?? []) {
    if (!required.has(field)) rows.push({ field, required: false, matched: null })
  }
  for (const [field, header] of Object.entries(report.resolved ?? {})) {
    rows.push({ field, required: false, matched: header })
  }
  return rows
})

/** Saving the overrides as a profile so the next month's export needs none of this again. */
const savingMapping = ref(false)

async function saveMappingProfile(): Promise<void> {
  if (!active.value) return
  error.value = null; note.value = null
  const entries = Object.entries(columnOverrides.value).filter(([, header]) => header)
  if (entries.length === 0) {
    error.value = 'Map at least one column before saving a profile.'
    return
  }
  const name = await prompt.ask({
    title: 'Save this mapping for next time',
    message: `It becomes a named profile for ${active.value.dataset} imports, selectable on the `
      + 'upload form. The council\u2019s existing profiles are left alone.',
    label: 'What is this profile called?',
    placeholder: 'e.g. PROMUN expenditure export',
    minLength: 3,
    submitLabel: 'Save profile',
  })
  if (!name) return

  // The server stores target field → a LIST of acceptable headings, because one profile serves a
  // system whose heading changed between releases. A profile saved here starts with the one
  // heading this file used.
  const mapping: Record<string, string[]> = {}
  for (const [field, header] of entries) mapping[field] = [header]

  savingMapping.value = true
  try {
    const saved = await financeApi.createColumnMapping({
      name, dataset: active.value.dataset, mapping,
    })
    mappings.value = await financeApi.columnMappings()
    note.value = `Saved as “${saved.name}”. Choose it on the upload form for the next ${active.value.dataset} file.`
  } catch (err) {
    error.value = messageOf(err, 'The mapping profile could not be saved.')
  } finally {
    savingMapping.value = false
  }
}

async function openBatch(batch: ImportBatch): Promise<void> {
  error.value = null
  active.value = batch
  validation.value = null
  exceptions.value = []
  reconciliation.value = null
  rows.value = []
  rowOffset.value = 0
  columnOverrides.value = {}
  batchMapping.value = null
  if (batch.id !== uploadResult.value?.batch.id) uploadResult.value = null
  try {
    const [detail, rows] = await Promise.all([
      financeApi.importBatch(batch.id),
      financeApi.importExceptions(batch.id, { open_only: true, limit: 500 }),
    ])
    active.value = detail.batch
    batchMapping.value = detail.batch.mapping ?? null
    exceptions.value = rows
    if (batch.status === 'committed' || batch.reconciliation_status !== 'not_checked') {
      reconciliation.value = await financeApi.importReconciliation(batch.id)
    }
  } catch (err) {
    error.value = messageOf(err, 'That batch could not be read.')
  }
}

/**
 * THE ROWS, AS THE SYSTEM READ THEM — the other half of a preview.
 *
 * The upload step already shows the first rows "as the file has them". This shows what each row
 * BECAME after the mapping and the lookups ran: which department and account it resolved to, the
 * amount as a decimal, the date as a date. The two together are what makes a mapping mistake
 * visible before anything is committed, because a column mapped to the wrong target produces a
 * file that is perfectly readable and a register that is wrong.
 *
 * It is loaded on demand and paged. A council's monthly export runs to thousands of rows and
 * nobody reads them all; what an officer does is check the first page, then filter to `rejected`
 * and read every one of those.
 */
type RowStatus = '' | 'pending' | 'valid' | 'rejected' | 'committed' | 'skipped_duplicate'

const ROW_STATUSES: Array<{ value: RowStatus; label: string }> = [
  { value: '', label: 'Every row' },
  { value: 'valid', label: 'Valid' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'skipped_duplicate', label: 'Already in the register' },
  { value: 'committed', label: 'Committed' },
  { value: 'pending', label: 'Not yet validated' },
]

const rows = ref<Array<{
  row_number: number; status: string
  raw: Record<string, unknown>; normalised: Record<string, unknown>
  issues: Array<{ field: string | null; error_code: string; message: string }>
}>>([])
const rowsOpen = ref(false)
const rowStatus = ref<RowStatus>('')
const rowOffset = ref(0)
const rowsLoading = ref(false)
const ROW_PAGE = 25

async function loadRows(): Promise<void> {
  if (!active.value) return
  rowsLoading.value = true
  error.value = null
  try {
    rows.value = await financeApi.importRows(active.value.id, {
      status: rowStatus.value || undefined,
      limit: ROW_PAGE,
      offset: rowOffset.value,
    })
  } catch (err) {
    error.value = messageOf(err, 'The rows of this batch could not be read.')
  } finally {
    rowsLoading.value = false
  }
}

function toggleRows(): void {
  rowsOpen.value = !rowsOpen.value
  if (rowsOpen.value && rows.value.length === 0) void loadRows()
}

watch([rowStatus, rowOffset], () => { if (rowsOpen.value) void loadRows() })

/** The columns to show, taken from the rows themselves: a dataset's fields differ per dataset. */
const rowColumns = computed(() => {
  const seen = new Set<string>()
  for (const r of rows.value) for (const k of Object.keys(r.normalised ?? {})) seen.add(k)
  return [...seen]
})

function cell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const ROW_TONE: Record<string, string> = {
  valid: 'tone-positive', rejected: 'tone-negative',
  skipped_duplicate: 'tone-warning', committed: 'tone-positive', pending: '',
}

async function validate(): Promise<void> {
  if (!active.value) return
  error.value = null; note.value = null
  busy.value = 'validate'
  try {
    validation.value = await financeApi.validateImport(active.value.id, {
      column_overrides: Object.keys(columnOverrides.value).length ? columnOverrides.value : undefined,
      date_order: dateOrder.value,
    })
    active.value = validation.value.batch
    exceptions.value = await financeApi.importExceptions(active.value.id, { open_only: true, limit: 500 })
    reconciliation.value = await financeApi.importReconciliation(active.value.id)
    const c = validation.value.counts
    if (rowsOpen.value) await loadRows()
    note.value = `${c.valid} row(s) valid, ${c.rejected} rejected, ${c.duplicates} already in the register. Nothing has been posted yet.`
    await load()
  } catch (err) {
    error.value = messageOf(err, 'Validation could not be run.')
  } finally {
    busy.value = null
  }
}

async function commit(): Promise<void> {
  if (!active.value) return
  error.value = null; note.value = null
  const needsOverride = active.value.reconciliation_status !== 'matched'
  let reason: string | undefined
  if (needsOverride) {
    const typed = await prompt.ask({
      title: 'Commit against the control totals',
      message: `This batch is ${active.value.reconciliation_status.replace(/_/g, ' ')} against the declared control totals. `
        + 'Committing it anyway needs a written reason, kept on the batch and in the audit trail.',
      label: 'Reason for the override',
      kind: 'textarea',
      minLength: 10,
      submitLabel: 'Commit anyway',
      danger: true,
    })
    if (!typed) return
    reason = typed
  }
  busy.value = 'commit'
  try {
    const result = await financeApi.commitImport(active.value.id, needsOverride
      ? { override_reconciliation: true, override_reason: reason }
      : {})
    active.value = result.batch
    note.value = result.already_committed
      ? 'This batch was already committed; nothing was written a second time.'
      : `${result.written} row(s) written, ${result.skipped_as_duplicate} skipped as already in the register.`
      + (result.note ? ` ${result.note}` : '')
    reconciliation.value = await financeApi.importReconciliation(active.value.id)
    await load()
  } catch (err) {
    error.value = messageOf(err, 'The batch could not be committed. Nothing was written.')
  } finally {
    busy.value = null
  }
}

async function cancel(): Promise<void> {
  if (!active.value) return
  const reason = await prompt.ask({
    title: 'Abandon this batch',
    message: 'The record and the preserved source file are kept.',
    label: 'Why is this batch being abandoned?',
    kind: 'textarea',
    submitLabel: 'Abandon batch',
    danger: true,
  })
  if (reason === null) return
  busy.value = 'cancel'
  try {
    active.value = await financeApi.cancelImport(active.value.id, reason || undefined)
    note.value = 'Batch cancelled. The record and the preserved source file are kept.'
    await load()
  } catch (err) {
    error.value = messageOf(err, 'The batch could not be cancelled.')
  } finally {
    busy.value = null
  }
}

async function resolve(exception: ImportException): Promise<void> {
  if (!active.value) return
  const resolution = await prompt.ask({
    title: 'Resolve this exception',
    message: 'Resolving an exception does not make the row valid — fix the cause and validate again.',
    label: 'How was this resolved?',
    kind: 'select',
    options: [
      { value: 'corrected_at_source', label: 'Corrected at source — the source system now sends the right value' },
      { value: 'mapping_added', label: 'Mapping added — the column or code is now mapped' },
      { value: 'row_excluded', label: 'Row excluded — this row is not the council\u2019s data' },
      { value: 'accepted_as_is', label: 'Accepted as is — the value is correct despite the warning' },
    ],
  })
  if (!resolution) return
  const noteText = await prompt.ask({
    title: 'A note for the record',
    message: 'Optional, but the resolution is stronger with one.',
    label: 'Note',
    kind: 'textarea',
    submitLabel: 'Record resolution',
  })
  if (noteText === null) return
  busy.value = exception.id
  try {
    await financeApi.resolveImportException(active.value.id, exception.id, {
      resolution: resolution as 'corrected_at_source',
      note: noteText || undefined,
    })
    exceptions.value = await financeApi.importExceptions(active.value.id, { open_only: true, limit: 500 })
    note.value = 'Recorded. Resolving an exception does not make the row valid — fix the cause and validate again.'
  } catch (err) {
    error.value = messageOf(err, 'That could not be recorded.')
  } finally {
    busy.value = null
  }
}

async function load(): Promise<void> {
  if (!yearId.value) { batches.value = []; return }
  loading.value = true
  try {
    batches.value = await financeApi.imports({
      financial_year_id: yearId.value,
      dataset: datasetFilter.value || undefined,
      status: statusFilter.value || undefined,
      limit: 100,
    })
  } catch (err) {
    error.value = messageOf(err, 'The import history could not be read.')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  try { mappings.value = await financeApi.columnMappings() } catch { /* the default is used */ }
})
watch([yearId, datasetFilter, statusFilter], load)

// A queue link arriving while this section is already mounted must still apply (see BudgetSection).
watch(() => route.query.status, (status) => {
  if (typeof status === 'string' && STATUSES.some((s) => s.id === status && s.id !== '')) {
    statusFilter.value = status as ImportStatus
  }
})

/** Where the working batch is in the flow, for the stepper. */
const step = computed(() => {
  const s = active.value?.status
  if (!s || s === 'uploaded' || s === 'mapped') return 1
  if (s === 'validating' || s === 'failed') return 2
  if (s === 'validated') return exceptions.value.length > 0 ? 3 : 4
  if (s === 'committing') return 5
  return 5
})

const statusTone: Record<string, string> = {
  uploaded: 'tone-info', mapped: 'tone-info', validating: 'tone-info',
  validated: 'tone-warning', committing: 'tone-info', committed: 'tone-positive',
  failed: 'tone-negative', cancelled: '', superseded: '',
}
const reconTone: Record<string, string> = {
  matched: 'tone-positive', mismatched: 'tone-negative',
  not_declared: 'tone-warning', not_checked: '',
}
const datasetHelp = computed(() => DATASETS.find((d) => d.id === upload.value.dataset)?.help ?? '')

/** Batches validated and waiting for the one role that may commit them. */
const awaitingCommit = computed(() => batches.value.filter((b) => b.status === 'validated'))
</script>

<template>
  <div class="fin-section">
    <FinancePromptDialog :controller="prompt" />
    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span>
    </div>
    <p v-if="note" class="ins-banner t-positive" role="status">
      <CheckCircle2 :size="16" aria-hidden="true" /><span>{{ note }}</span>
    </p>

    <!-- The handover that had no visible side. Validation is done by one role and the commit by
         another; this is the only place the committer learns that a batch is waiting. -->
    <p v-if="canCommit && awaitingCommit.length" class="ins-banner t-info" role="status">
      <Info :size="16" aria-hidden="true" />
      <span>
        {{ awaitingCommit.length }} validated
        {{ awaitingCommit.length === 1 ? 'batch is' : 'batches are' }} waiting for your commit.
        Nothing in {{ awaitingCommit.length === 1 ? 'it' : 'them' }} is in the register until you
        commit it, and the commit is yours alone.
      </span>
    </p>

    <p v-if="!writable && yearId" class="fin-readonly" role="status">
      <Ban :size="15" aria-hidden="true" />
      <span>
        <strong>{{ store.selectedYear?.label }} is {{ store.selectedYear?.status }}.</strong>
        Only an open financial year accepts imports. The history below can still be read and
        reconciled.
      </span>
    </p>

    <!-- ── Upload ──────────────────────────────────────────────────────────────────────────── -->
    <FinanceGuard v-if="writable" requires="finance.import.upload" surface="Uploading a source file">
      <form class="ins-card" @submit.prevent="send">
        <div class="ins-card-head">
          <h3><Upload :size="15" aria-hidden="true" /> Upload a source file</h3>
        </div>
        <div class="ins-card-body">
          <p class="fin-ccy-note" style="margin-top: 0">
            <Info :size="14" aria-hidden="true" />
            CSV or XLSX, as the council's accounting system exports it. The file is kept
            unchanged and its checksum recorded; everything downstream is derived from it and can be
            traced back to it.
          </p>

          <div class="ins-form">
            <div class="ins-field">
              <label class="ins-label" for="imp-dataset">What is in the file</label>
              <select id="imp-dataset" v-model="upload.dataset" class="ins-input">
                <option v-for="d in DATASETS" :key="d.id" :value="d.id">{{ d.label }}</option>
              </select>
              <p class="ins-hint">{{ datasetHelp }}</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="imp-file">File</label>
              <input id="imp-file" class="ins-input" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                     @change="pickFile" />
              <p v-if="upload.file" class="ins-hint">{{ upload.file.name }} · {{ formatBytes(upload.file.size) }}</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="imp-mapping">Column mapping</label>
              <select id="imp-mapping" v-model="upload.mappingId" class="ins-input">
                <option value="">The council's default for this dataset</option>
                <option v-for="m in mappings.filter((m) => m.dataset === upload.dataset)" :key="m.id" :value="m.id">
                  {{ m.name }}
                </option>
              </select>
              <p class="ins-hint">
                Which column feeds which field. A file whose headings this does not recognise is
                mapped by hand at the validation step below, and that mapping can be saved as a
                profile from there.
              </p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="imp-count">Control count</label>
              <input id="imp-count" v-model="upload.declaredCount" class="ins-input" type="number" min="0"
                     placeholder="rows on the council's report" />
              <p class="ins-hint">From the council's own report, not from the file.</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="imp-total">Control total</label>
              <input id="imp-total" v-model="upload.declaredTotal" class="ins-input" inputmode="decimal"
                     placeholder="95500.50" />
              <p class="ins-hint">Comparing the file with itself proves nothing; this is what catches a truncated export.</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="imp-ccy">Control total currency</label>
              <select id="imp-ccy" v-model="upload.declaredCurrency" class="ins-input">
                <option value="USD">USD</option>
                <option value="ZWG">ZWG</option>
              </select>
              <p class="ins-hint">A file mixing currencies needs one declared total per currency; one total cannot reconcile both.</p>
            </div>
          </div>

          <p v-if="busy === 'upload' && upload.progress > 0" class="fin-progress" role="status">
            Uploading… {{ upload.progress }}%
            <span class="fin-meter" aria-hidden="true"><span :style="{ width: `${upload.progress}%` }"></span></span>
          </p>
        </div>
        <div class="ins-card-foot">
          <button type="submit" class="fin-btn primary" :disabled="busy === 'upload' || !upload.file">
            <Upload :size="14" aria-hidden="true" /> {{ busy === 'upload' ? 'Uploading…' : 'Upload' }}
          </button>
        </div>
      </form>
    </FinanceGuard>

    <!-- ── Mapping preview ─────────────────────────────────────────────────────────────────── -->
    <section v-if="uploadResult" class="ins-card">
      <div class="ins-card-head">
        <h3><ListChecks :size="15" aria-hidden="true" /> How the file was read</h3>
      </div>
      <div class="ins-card-body">
        <dl class="ins-dl">
          <div><dt>Format</dt><dd>{{ uploadResult.file.format.toUpperCase() }}<template v-if="uploadResult.file.delimiter"> · delimiter “{{ uploadResult.file.delimiter === '\t' ? 'tab' : uploadResult.file.delimiter }}”</template></dd></div>
          <div v-if="uploadResult.file.sheet_name"><dt>Worksheet</dt><dd>{{ uploadResult.file.sheet_name }}</dd></div>
          <div><dt>Rows in file</dt><dd>{{ uploadResult.file.row_count }}</dd></div>
          <div><dt>Checksum</dt><dd class="ins-mono fin-hash">{{ uploadResult.batch.file_hash }}</dd></div>
        </dl>

        <p v-if="uploadResult.file.truncated" class="ins-banner t-warning">
          <AlertTriangle :size="15" aria-hidden="true" />
          <span>The file is longer than the council's row limit and was read only up to it. Split it, or raise the limit under Settings.</span>
        </p>

        <h4 class="fin-sub-head">Column mapping</h4>
        <dl class="fin-map">
          <template v-for="(header, field) in mappingReport?.resolved ?? {}" :key="field">
            <dt>{{ String(field).replace(/_/g, ' ') }}</dt>
            <dd class="ins-mono">{{ header }}</dd>
          </template>
          <template v-for="field in mappingReport?.unmatched_targets ?? []" :key="`u-${field}`">
            <dt>{{ field.replace(/_/g, ' ') }}</dt>
            <dd class="unmapped">no column matched</dd>
          </template>
        </dl>

        <p v-if="(mappingReport?.missing_required?.length ?? 0) > 0" class="ins-banner t-negative">
          <FileWarning :size="15" aria-hidden="true" />
          <span>
            Nothing in the file matched these required fields:
            <strong>{{ mappingReport!.missing_required.join(', ') }}</strong>.
            This is one fault about the file, not one per row — map them below and validate.
          </span>
        </p>

        <p v-if="(mappingReport?.unused_headers?.length ?? 0) > 0" class="fin-ccy-note">
          Columns not used: {{ mappingReport!.unused_headers.join(', ') }}.
          They are kept with each row verbatim, so nothing from the file is lost.
        </p>

        <h4 class="fin-sub-head">First rows, as the file has them</h4>
        <div class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr><th v-for="(h, i) in uploadResult.file.header_row" :key="i" scope="col">{{ h || `column ${i + 1}` }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in uploadResult.sample_rows" :key="i">
                <td v-for="(cell, j) in uploadResult.file.header_row.map((_, idx) => row[idx])" :key="j" class="ins-mono">
                  {{ cell ?? '' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="ins-card-foot" style="padding-left: 0; padding-right: 0; border: 0; background: none">
          <button type="button" class="fin-btn" @click="openBatch(uploadResult!.batch)">
            Work on this batch
          </button>
        </div>
      </div>
    </section>

    <!-- ── The working batch ───────────────────────────────────────────────────────────────── -->
    <section v-if="active" class="ins-card">
      <div class="ins-card-head">
        <h3>
          <FileCheck2 :size="15" aria-hidden="true" />
          {{ active.original_filename }}
          <span class="fin-pill" :class="statusTone[active.status]">{{ active.status }}</span>
        </h3>
        <button type="button" class="ins-iconbtn" @click="active = null">
          <X :size="16" aria-hidden="true" /><span class="sr-only">Close</span>
        </button>
      </div>
      <div class="ins-card-body">
        <ol class="fin-steps">
          <li class="fin-step" :class="{ 'is-done': step > 1, 'is-current': step === 1 }">
            <span class="fin-step-index">1</span> Uploaded and preserved
          </li>
          <li class="fin-step" :class="{ 'is-done': step > 2, 'is-current': step === 2 }">
            <span class="fin-step-index">2</span> Validated row by row
          </li>
          <li class="fin-step" :class="{ 'is-done': step > 3, 'is-current': step === 3 }">
            <span class="fin-step-index">3</span> Exceptions resolved
          </li>
          <li class="fin-step" :class="{ 'is-done': step > 4, 'is-current': step === 4 }">
            <span class="fin-step-index">4</span> Reconciled to the council's totals
          </li>
          <li class="fin-step" :class="{ 'is-done': active.status === 'committed', 'is-current': step === 5 && active.status !== 'committed' }">
            <span class="fin-step-index">5</span> Committed to the register
          </li>
        </ol>

        <dl class="ins-dl fin-batch-facts">
          <div><dt>Dataset</dt><dd>{{ active.dataset }}</dd></div>
          <div><dt>Uploaded</dt><dd>{{ formatDateTime(active.uploaded_at) }}<br /><small class="fin-sub">{{ active.uploaded_by_name }}</small></dd></div>
          <div><dt>Size</dt><dd>{{ formatBytes(active.file_size_bytes) }}</dd></div>
          <div><dt>Rows</dt><dd>{{ active.rows_total }} in file · {{ active.rows_valid }} valid · {{ active.rows_rejected }} rejected</dd></div>
          <div>
            <dt>Reconciliation</dt>
            <dd><span class="fin-pill" :class="reconTone[active.reconciliation_status]">{{ active.reconciliation_status.replace(/_/g, ' ') }}</span></dd>
          </div>
          <div v-if="active.committed_at"><dt>Committed</dt><dd>{{ formatDateTime(active.committed_at) }}<br /><small class="fin-sub">{{ active.committed_by_name }}</small></dd></div>
        </dl>

        <p v-if="active.error_summary" class="ins-banner t-warning">
          <AlertTriangle :size="15" aria-hidden="true" /><span>{{ active.error_summary }}</span>
        </p>

        <!-- Validate -->
        <FinanceGuard v-if="['uploaded', 'mapped', 'validated', 'failed'].includes(active.status) && writable"
                      requires="finance.import.validate" surface="Validating a batch">
          <div class="fin-validate">
            <div class="ins-field">
              <label class="ins-label" for="imp-dates">How dates are written in this file</label>
              <select id="imp-dates" v-model="dateOrder" class="ins-input">
                <option value="day_first">Day first — 31/03/2031 (Zimbabwean and Excel en-ZW convention)</option>
                <option value="month_first">Month first — 03/31/2031</option>
              </select>
              <p class="ins-hint">
                An ISO date (2031-03-31) is read the same either way. This choice is recorded on the
                batch, so a later reader can see which interpretation produced the figures.
              </p>
            </div>
            <div v-if="mappableFields.length" class="fin-override">
              <h4 class="fin-sub-head" style="margin-top: 0">Which column is which</h4>
              <p class="ins-hint">
                Only needed where the file's heading is not one the council's mapping recognises.
                Leave a field alone to keep what matched. Nothing is posted by validating.
                <template v-if="!fileHeaders.length">
                  This batch was reopened rather than just uploaded, so the file's own headings are
                  no longer in hand — type the heading exactly as the file spells it.
                </template>
              </p>
              <div class="fin-override-grid">
                <div v-for="f in mappableFields" :key="f.field" class="ins-field">
                  <label class="ins-label" :for="`ovr-${f.field}`">
                    {{ f.field.replace(/_/g, ' ') }}
                    <span v-if="f.required" class="fin-required">required</span>
                  </label>
                  <select v-if="fileHeaders.length" :id="`ovr-${f.field}`"
                          v-model="columnOverrides[f.field]" class="ins-input">
                    <option value="">
                      {{ f.matched ? `Keep “${f.matched}”` : 'Not mapped' }}
                    </option>
                    <option v-for="h in fileHeaders" :key="h" :value="h">{{ h }}</option>
                  </select>
                  <input v-else :id="`ovr-${f.field}`" v-model="columnOverrides[f.field]"
                         class="ins-input" maxlength="200"
                         :placeholder="f.matched ? `Keep ${f.matched}` : 'Heading in the file'" />
                </div>
              </div>
              <FinanceGuard requires="finance.config.manage" surface="Saving a mapping profile">
                <button type="button" class="fin-btn small" :disabled="savingMapping"
                        @click="saveMappingProfile">
                  {{ savingMapping ? 'Saving…' : 'Save this mapping for next time' }}
                </button>
              </FinanceGuard>
            </div>

            <button type="button" class="fin-btn primary" :disabled="busy === 'validate'" @click="validate">
              <PlayCircle :size="14" aria-hidden="true" />
              {{ busy === 'validate' ? 'Validating…' : active.status === 'validated' ? 'Validate again' : 'Validate' }}
            </button>
          </div>
        </FinanceGuard>

        <!-- Validation result -->
        <template v-if="validation">
          <h4 class="fin-sub-head">Validation result</h4>
          <dl class="fin-figures">
            <div class="fin-figure"><dt>Valid</dt><dd>{{ validation.counts.valid }}</dd></div>
            <div class="fin-figure" :class="{ 'is-negative': validation.counts.rejected > 0 }">
              <dt>Rejected</dt><dd>{{ validation.counts.rejected }}</dd>
            </div>
            <div class="fin-figure"><dt>Already in register</dt><dd>{{ validation.counts.duplicates }}</dd></div>
            <div class="fin-figure"><dt>Currencies in file</dt><dd>{{ validation.currencies_in_file.join(', ') || '—' }}</dd></div>
          </dl>
          <p v-if="validation.reconciliation.notes.length" class="ins-banner"
             :class="validation.reconciliation.status === 'matched' ? 't-positive' : 't-warning'">
            <Scale :size="15" aria-hidden="true" />
            <span>{{ validation.reconciliation.notes.join(' ') }}</span>
          </p>
        </template>

        <!-- Reconciliation statement -->
        <template v-if="reconciliation">
          <h4 class="fin-sub-head"><Scale :size="14" aria-hidden="true" /> Reconciliation</h4>
          <div class="fin-table-wrap">
            <table class="fin-table">
              <caption>
                Three figures, not two: what the council declared, what the file yielded, and what
                actually reached the register. The third can differ from the second when rows were
                skipped as already recorded — and that difference is what a reconciliation is for.
              </caption>
              <thead>
                <tr><th scope="col">Source</th><th scope="col" class="num">Rows</th><th scope="col" class="ccy">Ccy</th><th scope="col" class="num">Total</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Declared by the council</td>
                  <td class="num">{{ reconciliation.declared_by_council.count ?? '—' }}</td>
                  <td class="ccy">{{ reconciliation.declared_by_council.currency ?? '—' }}</td>
                  <td class="num">{{ formatMoney(reconciliation.declared_by_council.total, reconciliation.declared_by_council.currency, { bare: true }) }}</td>
                </tr>
                <tr>
                  <td>Yielded by the file</td>
                  <td class="num">{{ reconciliation.yielded_by_file.count ?? '—' }}</td>
                  <td class="ccy">—</td>
                  <td class="num">{{ formatMoney(reconciliation.yielded_by_file.total, null, { bare: true }) }}</td>
                </tr>
                <tr v-for="p in reconciliation.posted_to_register" :key="p.currency">
                  <td class="emphasis">Posted to the register</td>
                  <td class="num">{{ p.rows }}</td>
                  <td class="ccy">{{ p.currency }}</td>
                  <td class="num emphasis">{{ formatMoney(p.total, p.currency, { bare: true }) }}</td>
                </tr>
                <tr v-if="reconciliation.posted_to_register.length === 0">
                  <td class="emphasis">Posted to the register</td>
                  <td class="num">0</td><td class="ccy">—</td><td class="num">—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="fin-ccy-note">
            Source file: <span class="ins-mono">{{ reconciliation.source_file.filename }}</span>,
            SHA-256 <span class="ins-mono fin-hash">{{ reconciliation.source_file.sha256 }}</span>.
          </p>
        </template>

        <!-- The rows, as the system read them -->
        <h4 class="fin-sub-head">
          <Table2 :size="14" aria-hidden="true" /> Rows, as the system read them
          <button type="button" class="fin-btn small" :aria-expanded="rowsOpen"
                  aria-controls="fin-import-rows" @click="toggleRows">
            {{ rowsOpen ? 'Hide' : 'Show' }}
          </button>
        </h4>
        <div v-if="rowsOpen" id="fin-import-rows">
          <p class="fin-ccy-note" style="margin-top: 0">
            <Info :size="14" aria-hidden="true" />
            What each row became after the mapping and the lookups ran — the department and account
            it resolved to, the amount as a decimal, the date as a date. Read beside “first rows, as
            the file has them” above, this is what makes a column mapped to the wrong target visible
            before anything is posted.
          </p>

          <div class="fin-bar">
            <select v-model="rowStatus" class="ins-input fin-filter" aria-label="Row state"
                    @change="rowOffset = 0">
              <option v-for="st in ROW_STATUSES" :key="st.value" :value="st.value">{{ st.label }}</option>
            </select>
            <button type="button" class="fin-btn small" :disabled="rowsLoading" @click="loadRows">
              <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': rowsLoading }" /> Refresh
            </button>
          </div>

          <p v-if="rowsLoading && rows.length === 0" class="fin-sub" role="status">Reading rows…</p>

          <div v-else-if="rows.length === 0" class="fin-empty">
            <strong>No rows to show.</strong>
            <p>
              Either the batch has not been validated yet, or no row is in the state selected above.
            </p>
          </div>

          <template v-else>
            <div class="fin-table-wrap">
              <table class="fin-table">
                <thead>
                  <tr>
                    <th scope="col" class="num">Row</th>
                    <th scope="col">State</th>
                    <th v-for="c in rowColumns" :key="c" scope="col">{{ c.replace(/_/g, ' ') }}</th>
                    <th scope="col">Problems</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in rows" :key="r.row_number">
                    <td class="num">{{ r.row_number }}</td>
                    <td>
                      <span class="fin-pill" :class="ROW_TONE[r.status] ?? ''">
                        {{ r.status.replace(/_/g, ' ') }}
                      </span>
                    </td>
                    <td v-for="c in rowColumns" :key="c" class="fin-cell">{{ cell(r.normalised?.[c]) }}</td>
                    <td>
                      <template v-if="r.issues.length === 0">—</template>
                      <ul v-else class="fin-issues">
                        <li v-for="(iss, i) in r.issues" :key="i">
                          <span v-if="iss.field" class="ins-mono">{{ iss.field }}: </span>{{ iss.message }}
                        </li>
                      </ul>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="fin-pager">
              <button type="button" class="fin-btn small" :disabled="rowOffset === 0"
                      @click="rowOffset = Math.max(0, rowOffset - ROW_PAGE)">Previous</button>
              <span>Rows {{ rowOffset + 1 }}–{{ rowOffset + rows.length }}</span>
              <button type="button" class="fin-btn small" :disabled="rows.length < ROW_PAGE"
                      @click="rowOffset = rowOffset + ROW_PAGE">Next</button>
            </div>
          </template>
        </div>

        <!-- Exceptions -->
        <template v-if="exceptions.length">
          <h4 class="fin-sub-head">
            Exception queue <span class="ins-count">{{ exceptions.length }} open</span>
          </h4>
          <p class="fin-ccy-note" style="margin-top: 0">
            <Info :size="14" aria-hidden="true" />
            A row that cannot be mapped reliably stays here. It is never assigned to a default
            department or account, and recording a resolution does not make the row valid — fix the
            cause, then validate again.
          </p>
          <div class="fin-table-wrap">
            <table class="fin-table">
              <thead>
                <tr>
                  <th scope="col" class="num">Row</th><th scope="col">Field</th>
                  <th scope="col">Problem</th><th scope="col">Code</th>
                  <th scope="col"><span class="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in exceptions" :key="e.id">
                  <td class="num">{{ e.row_number }}</td>
                  <td class="ins-mono">{{ e.field ?? '—' }}</td>
                  <td>{{ e.message }}</td>
                  <td class="ins-mono fin-sub">{{ e.error_code }}</td>
                  <td>
                    <button v-if="canResolve" type="button" class="fin-btn small"
                            :disabled="busy === e.id" @click="resolve(e)">
                      Record a resolution
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="fin-sub">
            Row numbers are as the officer's own spreadsheet numbers them — row 1 is the header.
          </p>
        </template>

        <div class="ins-card-foot" style="padding-left: 0; padding-right: 0; background: none">
          <button v-if="writable && canUpload && !['committed', 'cancelled'].includes(active.status)"
                  type="button" class="fin-btn danger" :disabled="busy === 'cancel'" @click="cancel">
            <Ban :size="14" aria-hidden="true" /> Abandon batch
          </button>
          <FinanceGuard v-if="active.status === 'validated' && writable"
                        requires="finance.import.commit" surface="Committing a batch">
            <button type="button" class="fin-btn primary" :disabled="busy === 'commit'" @click="commit">
              <FileCheck2 :size="14" aria-hidden="true" />
              {{ busy === 'commit' ? 'Committing…' : 'Commit to the register' }}
            </button>
          </FinanceGuard>
        </div>

        <p v-if="active.status === 'validated' && !canCommit" class="fin-ccy-note">
          Validation and commit are separate duties. You have validated this batch; committing it
          needs the “Commit an import batch” permission, which the preparing roles do not hold.
        </p>
      </div>
    </section>

    <!-- ── History ─────────────────────────────────────────────────────────────────────────── -->
    <section class="ins-card">
      <div class="ins-card-head">
        <h3>Import history <span class="ins-count">{{ batches.length }}</span></h3>
        <select v-model="datasetFilter" class="ins-input fin-filter" aria-label="Dataset">
          <option value="">All datasets</option>
          <option v-for="d in DATASETS" :key="d.id" :value="d.id">{{ d.label }}</option>
        </select>
        <select v-model="statusFilter" class="ins-input fin-filter" aria-label="Batch status">
          <option v-for="s in STATUSES" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
        <button type="button" class="fin-btn small" :disabled="loading" @click="load">
          <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
        </button>
      </div>
      <div class="ins-card-body">
        <div v-if="batches.length === 0" class="fin-empty">
          <strong>Nothing has been imported for {{ store.selectedYear?.label ?? 'this year' }}.</strong>
          <p>
            Each import keeps its source file, the file's checksum, the row-level outcome and the
            reconciliation against the council's declared totals — so a figure questioned months
            later can be traced to the export that produced it.
          </p>
        </div>

        <div v-else class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr>
                <th scope="col">File</th><th scope="col">Dataset</th><th scope="col">State</th>
                <th scope="col" class="num">Valid</th><th scope="col" class="num">Rejected</th>
                <th scope="col" class="num">Open exceptions</th>
                <th scope="col">Reconciliation</th><th scope="col">Uploaded</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in batches" :key="b.id">
                <td>
                  <button type="button" class="fin-link" @click="openBatch(b)">{{ b.original_filename }}</button>
                  <br /><small class="fin-sub ins-mono">{{ b.file_hash.slice(0, 12) }}…</small>
                </td>
                <td>{{ b.dataset }}</td>
                <td><span class="fin-pill" :class="statusTone[b.status]">{{ b.status }}</span></td>
                <td class="num">{{ b.rows_valid }}</td>
                <td class="num">{{ b.rows_rejected }}</td>
                <td class="num">{{ b.open_exceptions ?? '0' }}</td>
                <td><span class="fin-pill" :class="reconTone[b.reconciliation_status]">{{ b.reconciliation_status.replace(/_/g, ' ') }}</span></td>
                <td>{{ formatDate(b.uploaded_at) }}<br /><small class="fin-sub">{{ b.uploaded_by_name }}</small></td>
                <td><button type="button" class="fin-btn small" @click="openBatch(b)">Open</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); }
.fin-filter { max-width: 12rem; }
.fin-override { margin-bottom: var(--ent-s3); padding: var(--ent-s3); border: 1px solid var(--ent-line); border-radius: var(--ent-r-sm); background: var(--ent-surface-2); }
.fin-override-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--ent-s3); margin: var(--ent-s3) 0; }
.fin-required { margin-left: 4px; font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); color: var(--ent-danger); text-transform: uppercase; letter-spacing: 0.04em; }
.fin-pager { display: flex; align-items: center; justify-content: center; gap: var(--ent-s3); margin-top: var(--ent-s3); font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.fin-cell { max-width: 16rem; overflow-wrap: anywhere; font-size: var(--ent-fs-xs); }
.fin-issues { margin: 0; padding-left: var(--ent-s4); font-size: var(--ent-fs-micro); color: var(--ent-danger); }
.fin-sub-head .fin-btn { margin-left: auto; }
.fin-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.fin-sub-head { margin: var(--ent-s4) 0 var(--ent-s2); font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); color: var(--ent-text); display: flex; align-items: center; gap: var(--ent-s2); }
.fin-hash { word-break: break-all; font-size: 0.8em; }
.fin-batch-facts { margin-top: var(--ent-s4); }
.fin-validate { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--ent-s3); align-items: end; margin-top: var(--ent-s4); padding-top: var(--ent-s4); border-top: 1px solid var(--ent-line); }
.fin-progress { margin: var(--ent-s3) 0 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.fin-progress .fin-meter { margin-top: 4px; }
.fin-ccy-note { display: flex; align-items: flex-start; gap: var(--ent-s2); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 767px) { .fin-validate { grid-template-columns: 1fr; } }
</style>
