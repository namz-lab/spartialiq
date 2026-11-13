<script setup lang="ts">
/**
 * The project register, its allocations, and the trace from a planning record to actual spend.
 *
 * WHAT MAKES THIS AN INTEGRATION RATHER THAN A SECOND REGISTER
 * A finance project points at the existing record by ITS OWN id — a development application, a
 * planning project, a survey project, a council asset — so the application a planner is already
 * looking at keeps one identity across both domains. This screen does not copy any of them, and a
 * link that points at nothing is refused by the server: a trace that looks complete and is not is
 * worse than no trace.
 *
 * THE TRACE PANEL answers the specification's integration requirement in one view: the approved
 * allocation, the revisions that changed the funding line, the transactions posted against the
 * project, the documents, and the actual spend.
 *
 * SUPPLIER NAMES ARE ABSENT, NOT BLANK, for a caller without that permission. The panel says which
 * it is, so a reader never takes an empty cell for a fact.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { financeApi } from '../../api/financeApi'
import { formatMoney, formatPercentage, formatDate } from '../../composables/useMoney'
import type { Currency, FinanceProject, LinkedSubjectKind, ProjectTrace } from '../../models/types'
import { useFinancePrompt } from '../../composables/useFinancePrompt'
import FinanceGuard from '../../components/FinanceGuard.vue'
import FinancePromptDialog from '../../components/FinancePromptDialog.vue'
import LinkedFinancePanel from '../../components/LinkedFinancePanel.vue'
import WardPicker from '../../components/WardPicker.vue'
import ProjectLocationPickerModal from '../../components/ProjectLocationPickerModal.vue'
import ProjectProgressControl from '../../components/ProjectProgressControl.vue'
import SpatialAllocationPanel from '../../components/SpatialAllocationPanel.vue'
import { describeProgress } from '../../composables/useProjectProgress'
import {
  AlertTriangle, CheckCircle2, Plus, RefreshCw, Info, Send, Check, X, Link2, MapPin, EyeOff,
  Pencil, Paperclip, Unlink, Upload,
} from 'lucide-vue-next'

const store = useFinanceStore()
const prompt = useFinancePrompt()

const projects = ref<FinanceProject[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref<string | null>(null)
const search = ref('')

/**
 * Which projects this register opens on.
 *
 * `awaiting_approval` has always been one of the filter's options and never its default, so the
 * committee — which holds `finance.project.approve` and not `finance.project.manage`, and therefore
 * sees the Approve control only on rows already in that state — had no list of them. An explicit
 * `?status=` link wins; then the role preset; then every project, as before.
 */
const route = useRoute()
const statusFilter = ref(
  typeof route.query.status === 'string' && route.query.status
    ? route.query.status
    : (store.rolePreset.defaultFilters.projectStatus ?? ''),
)

/**
 * The ward this register is confined to (audit GAP-10 and X-2).
 *
 * The map writes `?ward=` and the store's `mapWardCode`; both are read here so that "Projects" from
 * a selected ward opens that ward's projects rather than every project the council has.
 */
const wardFilter = ref(
  typeof route.query.ward === 'string' && route.query.ward
    ? route.query.ward
    : (store.mapWardCode ?? ''),
)

const trace = ref<ProjectTrace | null>(null)
const showForm = ref(false)
/** The map picker for the project's point (audit M5-5). The two numeric inputs stay beside it. */
const pickingLocation = ref(false)

/**
 * The project being edited, or null when the form is preparing a new one.
 *
 * Three of the form's fields are absent from the server's PATCH body and so are fixed here too:
 * the REFERENCE, because every allocation, document and report already cites it; the CURRENCY,
 * because a project's allocations and spend are denominated in it and this module never converts;
 * and the APPROVED BUDGET, because changing what the council approved is a decision with its own
 * record, not a correction. A project whose approved figure was wrong gets a revision on the line
 * that funds it.
 */
const editing = ref<FinanceProject | null>(null)

/** The states a project may be moved to by editing. Approval itself is a separate act. */
const EDITABLE_STATUSES = [
  { value: 'awaiting_approval', label: 'Awaiting approval' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const
const editStatus = ref<string>('')

const canManage = computed(() => store.can('finance.project.manage'))
const canApprove = computed(() => store.can('finance.project.approve'))

const LINK_KINDS: Array<{ id: LinkedSubjectKind; label: string }> = [
  { id: 'development_application', label: 'Development application' },
  { id: 'planning_project', label: 'Planning project (subdivision layout)' },
  { id: 'survey_project', label: 'Survey project' },
  { id: 'council_asset', label: 'Council asset' },
  { id: 'service_desk_ticket', label: 'Service desk ticket' },
  { id: 'environmental_review', label: 'Environmental review' },
  { id: 'other', label: 'No digital antecedent' },
]

const form = ref<{
  reference: string; name: string; description: string; department_id: string
  ward_code: string; location_text: string; longitude: string; latitude: string
  currency: Currency; approved_budget: string; start_date: string; end_date: string
  linked_subject_kind: '' | LinkedSubjectKind; linked_subject_id: string
}>({
  reference: '', name: '', description: '', department_id: '', ward_code: '', location_text: '',
  longitude: '', latitude: '', currency: 'USD', approved_budget: '', start_date: '', end_date: '',
  linked_subject_kind: '', linked_subject_id: '',
})

const statusTone: Record<string, string> = {
  proposed: '', awaiting_approval: 'tone-info', approved: 'tone-positive',
  in_progress: 'tone-positive', suspended: 'tone-warning',
  completed: 'tone-neutral', cancelled: 'tone-negative',
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    projects.value = await financeApi.projects({
      q: search.value.trim() || undefined,
      status: statusFilter.value || undefined,
      ward_code: wardFilter.value.trim() || undefined,
      limit: 200,
    })
  } catch (err) {
    error.value = messageOf(err, 'The project register could not be read.')
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(statusFilter, load)
watch(wardFilter, () => { void load() })

// A queue link arriving while this section is already mounted must still apply (see BudgetSection).
watch(() => route.query.status, (status) => {
  if (typeof status === 'string' && status && status !== statusFilter.value) statusFilter.value = status
})
// Audit X-2: a ward chosen on the map, or carried in the URL, filters this register too. The map's
// "Projects" button used to drop the ward entirely and open the register unfiltered.
watch(() => route.query.ward, (ward) => {
  const value = typeof ward === 'string' ? ward : ''
  if (value !== wardFilter.value) wardFilter.value = value
})
watch(() => store.mapWardCode, (code) => {
  if (code && code !== wardFilter.value) wardFilter.value = code
})
let timer: ReturnType<typeof setTimeout> | undefined
watch(search, () => { clearTimeout(timer); timer = setTimeout(load, 300) })

async function open(id: string): Promise<void> {
  error.value = null
  try { trace.value = await financeApi.projectTrace(id) } catch (err) {
    error.value = messageOf(err, 'That project could not be read.')
  }
}

async function create(): Promise<void> {
  error.value = null; note.value = null
  const f = form.value
  if (!f.reference.trim() || !f.name.trim()) { error.value = 'A reference and a name are required.'; return }
  if ((f.longitude === '') !== (f.latitude === '')) { error.value = 'Give both longitude and latitude, or neither.'; return }
  if ((f.linked_subject_kind === '') !== (f.linked_subject_id.trim() === '')) {
    error.value = 'Give both the kind of linked record and its id, or neither.'
    return
  }
  busy.value = 'create'
  try {
    await financeApi.createProject({
      reference: f.reference.trim(), name: f.name.trim(),
      description: f.description.trim() || undefined,
      department_id: f.department_id || undefined,
      ward_code: f.ward_code.trim() || undefined,
      location_text: f.location_text.trim() || undefined,
      longitude: f.longitude ? Number(f.longitude) : undefined,
      latitude: f.latitude ? Number(f.latitude) : undefined,
      currency: f.currency,
      approved_budget: f.approved_budget.trim() || undefined,
      start_date: f.start_date || undefined,
      end_date: f.end_date || undefined,
      linked_subject_kind: f.linked_subject_kind || undefined,
      linked_subject_id: f.linked_subject_id.trim() || undefined,
    })
    note.value = 'Project created as a proposal. Approval and publication are separate decisions.'
    showForm.value = false
    form.value = { ...form.value, reference: '', name: '', description: '', approved_budget: '', linked_subject_id: '' }
    await load()
  } catch (err) {
    error.value = messageOf(err, 'The project could not be created.')
  } finally {
    busy.value = null
  }
}

/**
 * The picker's answer, written into the same two fields the officer could have typed (M5-5).
 *
 * The ward the point falls in is OFFERED, not imposed: it fills the ward field only when none is
 * recorded. Overwriting a ward an officer entered because a provisional polygon disagrees would let
 * an unconfirmed boundary list (decision D11) silently re-classify the money.
 */
function applyPickedLocation(picked: {
  longitude: string; latitude: string; wardCode: string | null
}): void {
  form.value.longitude = picked.longitude
  form.value.latitude = picked.latitude
  if (picked.wardCode && !form.value.ward_code.trim()) form.value.ward_code = picked.wardCode
  pickingLocation.value = false
  note.value = picked.wardCode && picked.wardCode === form.value.ward_code
    ? `Point set to ${picked.longitude}, ${picked.latitude} — in ward ${picked.wardCode}. Save the project to record it.`
    : `Point set to ${picked.longitude}, ${picked.latitude}. Save the project to record it.`
}

function edit(p: FinanceProject): void {
  error.value = null; note.value = null
  editing.value = p
  editStatus.value = ''
  form.value = {
    reference: p.reference,
    name: p.name,
    description: p.description ?? '',
    department_id: p.department_id ?? '',
    ward_code: p.ward_code ?? '',
    location_text: p.location_text ?? '',
    longitude: p.longitude === null || p.longitude === undefined ? '' : String(p.longitude),
    latitude: p.latitude === null || p.latitude === undefined ? '' : String(p.latitude),
    currency: p.currency,
    approved_budget: p.approved_budget,
    start_date: p.start_date ?? '',
    end_date: p.end_date ?? '',
    linked_subject_kind: p.linked_subject_kind ?? '',
    linked_subject_id: p.linked_subject_id ?? '',
  }
  showForm.value = true
}

function closeForm(): void {
  showForm.value = false
  editing.value = null
  editStatus.value = ''
  form.value = {
    reference: '', name: '', description: '', department_id: '', ward_code: '', location_text: '',
    longitude: '', latitude: '', currency: 'USD', approved_budget: '', start_date: '', end_date: '',
    linked_subject_kind: '', linked_subject_id: '',
  }
}

async function save(): Promise<void> {
  const project = editing.value
  if (!project) return
  error.value = null; note.value = null
  const f = form.value
  if (!f.name.trim()) { error.value = 'A project needs a name.'; return }
  if ((f.longitude === '') !== (f.latitude === '')) { error.value = 'Give both longitude and latitude, or neither.'; return }
  if ((f.linked_subject_kind === '') !== (f.linked_subject_id.trim() === '')) {
    error.value = 'Give both the kind of linked record and its id, or neither.'
    return
  }
  busy.value = 'create'
  try {
    await financeApi.updateProject(project.project_id, {
      name: f.name.trim(),
      description: f.description.trim() || undefined,
      department_id: f.department_id || undefined,
      ward_code: f.ward_code.trim() || undefined,
      location_text: f.location_text.trim() || undefined,
      longitude: f.longitude ? Number(f.longitude) : undefined,
      latitude: f.latitude ? Number(f.latitude) : undefined,
      start_date: f.start_date || undefined,
      end_date: f.end_date || undefined,
      status: editStatus.value || undefined,
      linked_subject_kind: f.linked_subject_kind || undefined,
      linked_subject_id: f.linked_subject_id.trim() || undefined,
    })
    note.value = `${project.reference} updated.`
    closeForm()
    await load()
    if (trace.value?.project.project_id === project.project_id) await open(project.project_id)
  } catch (err) {
    // The server refuses a state that skips approval, and says which state the project is in. That
    // sentence is more use than anything this screen could invent.
    error.value = messageOf(err, 'The project could not be updated.')
  } finally {
    busy.value = null
  }
}

async function act(p: FinanceProject, action: 'submit' | 'approve'): Promise<void> {
  error.value = null; note.value = null
  busy.value = p.project_id
  try {
    if (action === 'submit') {
      await financeApi.submitProject(p.project_id)
      note.value = 'Submitted for approval. Approval must come from someone else.'
    } else {
      await financeApi.approveProject(p.project_id)
      note.value = 'Approved. It can now be put in progress, and published once the projects dataset is released.'
    }
    await load()
    if (trace.value?.project.project_id === p.project_id) await open(p.project_id)
  } catch (err) {
    error.value = messageOf(err, 'That could not be done.')
  } finally { busy.value = null }
}

async function allocate(p: FinanceProject): Promise<void> {
  error.value = null; note.value = null
  if (!store.selectedYearId) { error.value = 'Choose a financial year first.'; return }
  let lines: Awaited<ReturnType<typeof financeApi.budgetLines>>
  try {
    lines = await financeApi.budgetLines({
      financial_year_id: store.selectedYearId, status: 'approved', kind: 'expenditure', limit: 200,
    })
  } catch (err) { error.value = messageOf(err, 'The budget lines could not be read.'); return }

  const candidates = lines.lines.filter((l) => l.currency === p.currency)
  if (candidates.length === 0) {
    error.value = `No approved expenditure line in ${p.currency} exists for ${store.selectedYear?.label}. `
      + 'A project can only draw on an approved allocation in its own currency — the two are not converted.'
    return
  }
  const lineId = await prompt.ask({
    title: 'Which line funds this project?',
    message: `Only approved expenditure lines in ${p.currency} are offered — an allocation is never converted between currencies.`,
    label: 'Funding budget line',
    kind: 'select',
    options: candidates.map((l) => ({
      value: l.budget_line_id,
      label: `${l.code} — ${l.description} (available ${l.available_excluding_commitments} ${l.currency})`,
    })),
  })
  if (!lineId) return
  const chosen = candidates.find((l) => l.budget_line_id === lineId)
  if (!chosen) return
  const amount = await prompt.ask({
    title: `Allocate to ${chosen.code}`,
    message: 'The allocation draws on the line\u2019s available balance in its own currency.',
    label: `Amount to allocate (${p.currency})`,
    kind: 'amount',
    allowNegative: false,
    placeholder: '10000.00',
  })
  if (!amount) return

  busy.value = p.project_id
  try {
    await financeApi.allocateToProject(p.project_id, {
      budget_line_id: chosen.budget_line_id, amount,
    })
    note.value = 'Allocation recorded against the budget line.'
    await load()
    if (trace.value?.project.project_id === p.project_id) await open(p.project_id)
  } catch (err) {
    error.value = messageOf(err, 'The allocation could not be recorded.')
  } finally { busy.value = null }
}

/** A uuid, checked here so a mistyped identifier is refused with a sentence rather than a 400. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Attach a posting from the actuals register to this project.
 *
 * `apportioned` exists because one invoice often covers several projects: a grader hired for a
 * month and used on three roads. The share is the part that belongs to THIS project, and the
 * server keeps the association rather than splitting the transaction — the figure the accounting
 * system recorded stays exactly as it recorded it.
 *
 * The identifier is typed rather than picked because there is no staff-side register of individual
 * postings to pick from: the transaction's id comes from the project trace, the public register, or
 * the accounting system's own export.
 */
async function associate(p: FinanceProject): Promise<void> {
  error.value = null; note.value = null
  const transactionId = await prompt.ask({
    title: `Attach a transaction to ${p.reference}`,
    message: 'The identifier of the posting as the register holds it. It is shown on the public '
      + 'transaction page and in the project trace.',
    label: 'Transaction identifier',
    placeholder: '00000000-0000-0000-0000-000000000000',
    minLength: 36,
  })
  if (!transactionId) return
  if (!UUID.test(transactionId.trim())) {
    error.value = 'That is not a transaction identifier. It is a 36-character id, not a voucher or invoice number.'
    return
  }
  const how = await prompt.ask({
    title: 'How much of it belongs to this project?',
    message: 'A transaction covering several projects is apportioned rather than split: the '
      + 'posting keeps the amount the accounting system recorded.',
    label: 'Association',
    kind: 'select',
    options: [
      { value: 'direct', label: 'The whole transaction belongs to this project' },
      { value: 'apportioned', label: 'Part of it belongs to this project' },
    ],
  })
  if (!how) return
  let share: number | undefined
  if (how === 'apportioned') {
    const answer = await prompt.ask({
      title: 'What share belongs to this project?',
      message: 'A decimal fraction above 0 and up to 1 — 0.25 is a quarter of the posting.',
      label: 'Share',
      kind: 'amount',
      allowNegative: false,
      placeholder: '0.25',
    })
    if (!answer) return
    share = Number(answer)
    if (!(share > 0) || share > 1) {
      error.value = 'The share must be above 0 and no more than 1.'
      return
    }
  }
  const noteText = await prompt.ask({
    title: 'Why is it attached to this project?',
    message: 'Optional, and kept on the association.',
    label: 'Note',
    kind: 'textarea',
    submitLabel: 'Attach',
  })
  if (noteText === null) return

  busy.value = p.project_id
  try {
    await financeApi.associateTransaction(p.project_id, {
      transaction_id: transactionId.trim(),
      association: how === 'apportioned' ? 'apportioned' : 'direct',
      ...(share !== undefined ? { share } : {}),
      ...(noteText ? { note: noteText } : {}),
    })
    note.value = 'Transaction attached. It now counts towards this project\u2019s actual spend.'
    await load()
    if (trace.value?.project.project_id === p.project_id) await open(p.project_id)
  } catch (err) {
    error.value = messageOf(err, 'The transaction could not be attached.')
  } finally { busy.value = null }
}

/** Withdraw an association. The posting itself stays in the register; only the link is withdrawn. */
async function unlink(projectId: string, transactionId: string, reference: string | null): Promise<void> {
  error.value = null; note.value = null
  const confirmed = await prompt.ask({
    title: 'Detach this transaction',
    message: `${reference ?? 'The posting'} will stop counting towards this project's actual spend. `
      + 'The transaction stays in the register — this module does not delete what the accounting '
      + 'system recorded — and the withdrawn association stays on the record.',
    label: 'Type DETACH to confirm',
    submitLabel: 'Detach it',
    danger: true,
  })
  if (!confirmed) return
  if (confirmed.trim().toUpperCase() !== 'DETACH') {
    error.value = 'Not confirmed, so nothing was changed.'
    return
  }
  busy.value = projectId
  try {
    await financeApi.unlinkProjectTransaction(projectId, transactionId)
    note.value = 'Transaction detached from the project.'
    await load()
    await open(projectId)
  } catch (err) {
    error.value = messageOf(err, 'The transaction could not be detached.')
  } finally { busy.value = null }
}

// ── Documents on a project ────────────────────────────────────────────────────────────────────
/**
 * The contract, the completion certificate, the retention release. A project's documents were
 * readable here from the start and could only be added through the API; this is the other half.
 * Every upload arrives restricted — releasing one is a publisher's separate act, under Documents.
 */
const docInput = ref<HTMLInputElement | null>(null)
const docType = ref('')
const uploadingDoc = ref(false)

function chooseDoc(): void {
  docInput.value?.click()
}

async function attachDocument(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const project = trace.value?.project
  if (!file || !project) return
  error.value = null; note.value = null
  uploadingDoc.value = true
  try {
    const result = await financeApi.uploadDocument({
      file,
      subjectKind: 'project',
      subjectId: project.project_id,
      documentType: docType.value.trim() || undefined,
    })
    note.value = `${result.document.filename} attached to ${project.reference}. `
      + 'It is restricted until a publisher releases it.'
    docType.value = ''
    await open(project.project_id)
  } catch (err) {
    error.value = messageOf(err, 'The document could not be attached.')
  } finally {
    uploadingDoc.value = false
    input.value = ''
  }
}

const canUploadDocs = computed(() => store.can('finance.document.upload'))

/**
 * The kinds whose register this council can be asked about by record id.
 *
 * `other` and `environmental_review` are excluded because neither resolves to a single register —
 * the server answers `{ exists: 'unknown' }` for them rather than pretending one exists — so there
 * is nothing to look up. Opened from the trace, the panel answers the question the trace cannot:
 * is this the ONLY council project citing this record, or one of several?
 */
const LOOKUP_KINDS = ['development_application', 'planning_project', 'survey_project',
  'council_asset', 'service_desk_ticket'] as const

type LookupKind = typeof LOOKUP_KINDS[number]

const linkedLookup = computed<{ kind: LookupKind; id: string } | null>(() => {
  const record = trace.value?.linked_record
  if (!record) return null
  if (!LOOKUP_KINDS.includes(record.kind as LookupKind)) return null
  return { kind: record.kind as LookupKind, id: record.id }
})

const linkLabel = (kind: string | null): string =>
  LINK_KINDS.find((k) => k.id === kind)?.label ?? (kind ?? '—')
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

    <div class="fin-bar">
      <label class="ins-search">
        <input v-model="search" class="ins-input" type="search" placeholder="Search reference or name" />
      </label>
      <select v-model="statusFilter" class="ins-input fin-filter" aria-label="Status">
        <option value="">Any status</option>
        <option value="proposed">Proposed</option>
        <option value="awaiting_approval">Awaiting approval</option>
        <option value="approved">Approved</option>
        <option value="in_progress">In progress</option>
        <option value="suspended">Suspended</option>
        <option value="completed">Completed</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <div class="fin-filter fin-filter-ward">
        <WardPicker id="pr-ward-filter" v-model="wardFilter" compact empty-label="Every ward" />
      </div>
      <button v-if="canManage" type="button" class="fin-btn primary"
              @click="editing ? (closeForm(), showForm = true) : (showForm = !showForm)">
        <Plus :size="14" aria-hidden="true" /> New project
      </button>
      <button type="button" class="fin-btn small" :disabled="loading" @click="load">
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
      </button>
    </div>

    <FinanceGuard v-if="showForm" requires="finance.project.manage" surface="Creating a project">
      <form class="ins-card" @submit.prevent="editing ? save() : create()">
        <div class="ins-card-head">
          <h3 v-if="editing">Edit {{ editing.reference }}</h3>
          <h3 v-else>New project</h3>
        </div>
        <div class="ins-card-body">
          <p class="fin-ccy-note" style="margin-top: 0">
            <Info :size="14" aria-hidden="true" />
            Linking the project to a record this council already holds — an application, a planning
            layout, an asset — lets authorised staff follow one undertaking from the planning file
            through to what was spent on it. A link that points at nothing is refused.
          </p>
          <div class="ins-form">
            <div class="ins-field">
              <label class="ins-label" for="pr-ref">Reference</label>
              <input id="pr-ref" v-model="form.reference" class="ins-input" maxlength="60" required
                     :disabled="!!editing" />
              <p v-if="editing" class="ins-hint">
                Fixed: allocations, documents and reports already cite it.
              </p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="pr-name">Name</label>
              <input id="pr-name" v-model="form.name" class="ins-input" maxlength="300" required />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="pr-dept">Department</label>
              <select id="pr-dept" v-model="form.department_id" class="ins-input">
                <option value="">Not stated</option>
                <option v-for="d in store.activeDepartments" :key="d.id" :value="d.id">{{ d.code }} {{ d.name }}</option>
              </select>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="pr-ccy">Currency</label>
              <select id="pr-ccy" v-model="form.currency" class="ins-input" :disabled="!!editing">
                <option value="USD">USD</option><option value="ZWG">ZWG</option>
              </select>
              <p class="ins-hint">
                A project is funded from budget lines in its own currency; the two are never
                converted.<template v-if="editing"> It is fixed once the project exists, because its
                allocations and its spend are denominated in it.</template>
              </p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="pr-budget">Approved budget</label>
              <input id="pr-budget" v-model="form.approved_budget" class="ins-input" inputmode="decimal"
                     placeholder="40000.00" :disabled="!!editing" />
              <p v-if="editing" class="ins-hint">
                What the council approved is not edited here. A project that needs more money needs
                a revision on the line that funds it, which carries its own approval.
              </p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="pr-ward">Ward</label>
              <WardPicker id="pr-ward" v-model="form.ward_code" />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="pr-start">Starts</label>
              <input id="pr-start" v-model="form.start_date" class="ins-input" type="date" />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="pr-end">Ends</label>
              <input id="pr-end" v-model="form.end_date" class="ins-input" type="date" />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="pr-lng">Longitude</label>
              <input id="pr-lng" v-model="form.longitude" class="ins-input" inputmode="decimal" placeholder="29.8" />
              <p class="ins-hint">
                With latitude, puts the project on the council's map. Typed coordinates and the map
                picker write the same two fields — one record, two ways of entering it.
              </p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="pr-lat">Latitude</label>
              <input id="pr-lat" v-model="form.latitude" class="ins-input" inputmode="decimal" placeholder="-19.45" />
            </div>
            <!--
              M5-5. The numeric inputs stay: they are the audit record, and a surveyor reading a GPS
              fix should not have to find the spot on a screen. The picker is the second editor, not
              a replacement, and it never fills them from the map centre.
            -->
            <div class="ins-field">
              <span class="ins-label">Location on the map</span>
              <div class="fin-row-actions">
                <button type="button" class="fin-btn small" @click="pickingLocation = true">
                  <MapPin :size="13" aria-hidden="true" /> Pick on map
                </button>
                <button v-if="form.longitude || form.latitude" type="button" class="fin-btn small"
                        @click="form.longitude = ''; form.latitude = ''">
                  Remove the point
                </button>
              </div>
              <p class="ins-hint">
                {{ form.longitude && form.latitude
                  ? `Recorded at ${form.longitude}, ${form.latitude}.`
                  : 'No point recorded. A project with no point is listed on the map as unplaced, never nudged to a ward centroid.' }}
              </p>
            </div>
            <div v-if="editing" class="ins-field">
              <label class="ins-label" for="pr-status">Move to state</label>
              <select id="pr-status" v-model="editStatus" class="ins-input">
                <option value="">Leave as {{ editing.status.replace('_', ' ') }}</option>
                <option v-for="st in EDITABLE_STATUSES" :key="st.value" :value="st.value">{{ st.label }}</option>
              </select>
              <p class="ins-hint">
                Approval is not here: it is a separate act by someone who holds it. A project that
                has not been approved cannot be put in progress, and the server says so.
              </p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="pr-kind">Linked record</label>
              <select id="pr-kind" v-model="form.linked_subject_kind" class="ins-input">
                <option value="">Not linked</option>
                <option v-for="k in LINK_KINDS" :key="k.id" :value="k.id">{{ k.label }}</option>
              </select>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="pr-linkid">Linked record id</label>
              <input id="pr-linkid" v-model="form.linked_subject_id" class="ins-input" maxlength="200"
                     :disabled="!form.linked_subject_kind" />
            </div>
            <div class="ins-field full">
              <label class="ins-label" for="pr-loc">Location in words</label>
              <input id="pr-loc" v-model="form.location_text" class="ins-input" maxlength="500" />
            </div>
            <div class="ins-field full">
              <label class="ins-label" for="pr-desc">Scope</label>
              <textarea id="pr-desc" v-model="form.description" class="ins-input" rows="2" maxlength="4000"></textarea>
            </div>
          </div>
        </div>
        <div class="ins-card-foot">
          <button type="button" class="fin-btn" @click="closeForm">Cancel</button>
          <button type="submit" class="fin-btn primary" :disabled="busy === 'create'">
            <template v-if="editing">{{ busy === 'create' ? 'Saving…' : 'Save changes' }}</template>
            <template v-else>{{ busy === 'create' ? 'Creating…' : 'Create as a proposal' }}</template>
          </button>
        </div>
      </form>
    </FinanceGuard>

    <p v-if="loading && projects.length === 0" class="fin-loading" role="status">Reading the project register…</p>

    <div v-else-if="projects.length === 0" class="fin-empty">
      <strong>No projects are registered.</strong>
      <p>
        A project here is a council undertaking with money attached. It can be keyed in, imported in
        bulk, or linked to an application or planning layout the council already holds — so the
        money can be followed from the planning file through to the spend.
      </p>
    </div>

    <section v-else class="ins-card">
      <div class="ins-card-head">
        <h3>Projects <span class="ins-count">{{ projects.length }}</span></h3>
      </div>
      <div class="ins-card-body">
        <div class="fin-table-wrap">
          <table class="fin-table sticky-actions">
            <thead>
              <tr>
                <th scope="col">Reference</th><th scope="col">Project</th><th scope="col">Status</th>
                <th scope="col">Department</th><th scope="col" class="ccy">Ccy</th>
                <th scope="col" class="num">Approved</th><th scope="col" class="num">Allocated</th>
                <th scope="col" class="num">Spent</th><th scope="col" class="num">Remaining</th>
                <th scope="col" class="num">Execution</th>
                <th scope="col" class="num">Progress</th><th scope="col">Linked to</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in projects" :key="p.project_id">
                <td><button type="button" class="fin-link ins-mono" @click="open(p.project_id)">{{ p.reference }}</button></td>
                <td>{{ p.name }}<br v-if="p.ward_code" /><small v-if="p.ward_code" class="fin-sub">ward {{ p.ward_code }}</small></td>
                <td><span class="fin-pill" :class="statusTone[p.status]">{{ p.status.replace(/_/g, ' ') }}</span></td>
                <td>{{ p.department_name ?? '—' }}</td>
                <td class="ccy">{{ p.currency }}</td>
                <td class="num">{{ formatMoney(p.approved_budget, p.currency, { bare: true }) }}</td>
                <td class="num">{{ formatMoney(p.allocated_total, p.currency, { bare: true }) }}</td>
                <td class="num emphasis">{{ formatMoney(p.actual_spend, p.currency, { bare: true }) }}</td>
                <td class="num">{{ formatMoney(p.remaining_allocation, p.currency, { bare: true }) }}</td>
                <td class="num" :class="{ 'undefined-value': p.execution_percentage === null }">
                  {{ formatPercentage(p.execution_percentage) }}
                </td>
                <!-- Physical delivery, worded by the one helper the whole module uses: a null is
                     "not recorded" and a recorded 0 says so in words (decision D12). -->
                <td class="num" :class="{ 'undefined-value': (p.physical_progress_percent ?? null) === null }">
                  {{ describeProgress(p.physical_progress_percent ?? null) }}
                </td>
                <td>
                  <span v-if="p.linked_subject_kind" class="fin-pill tone-info">
                    <Link2 :size="11" aria-hidden="true" /> {{ linkLabel(p.linked_subject_kind) }}
                  </span>
                  <span v-else class="fin-sub">—</span>
                </td>
                <td>
                  <div class="fin-row-actions">
                    <button v-if="canManage && p.status === 'proposed'" type="button" class="fin-btn small"
                            :disabled="busy === p.project_id" @click="act(p, 'submit')">
                      <Send :size="12" aria-hidden="true" /> Submit
                    </button>
                    <button v-if="canApprove && p.status === 'awaiting_approval'" type="button" class="fin-btn small primary"
                            :disabled="busy === p.project_id" @click="act(p, 'approve')">
                      <Check :size="12" aria-hidden="true" /> Approve
                    </button>
                    <button v-if="canManage && ['approved', 'in_progress'].includes(p.status)" type="button"
                            class="fin-btn small" :disabled="busy === p.project_id" @click="allocate(p)">
                      Allocate
                    </button>
                    <button v-if="canManage" type="button" class="fin-btn small"
                            :disabled="busy === p.project_id" @click="edit(p)">
                      <Pencil :size="12" aria-hidden="true" /> Edit
                    </button>
                    <button v-if="canManage && ['approved', 'in_progress', 'completed'].includes(p.status)"
                            type="button" class="fin-btn small" :disabled="busy === p.project_id"
                            @click="associate(p)">
                      <Link2 :size="12" aria-hidden="true" /> Attach posting
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- ── The trace ───────────────────────────────────────────────────────────────────────── -->
    <section v-if="trace" class="ins-card">
      <div class="ins-card-head">
        <h3>{{ trace.project.reference }} — {{ trace.project.name }}</h3>
        <button type="button" class="ins-iconbtn" @click="trace = null">
          <X :size="16" aria-hidden="true" /><span class="sr-only">Close</span>
        </button>
      </div>
      <div class="ins-card-body">
        <p class="fin-ccy-note" style="margin-top: 0">
          <Info :size="14" aria-hidden="true" />
          Approved allocation, through the revisions that changed the funding line, to the
          transactions posted and the actual spend — the whole chain for one undertaking.
        </p>

        <dl class="fin-figures">
          <div class="fin-figure"><dt>Approved budget</dt><dd>{{ formatMoney(trace.project.approved_budget, trace.project.currency, { bare: true }) }}<span class="fin-figure-note">{{ trace.project.currency }}</span></dd></div>
          <div class="fin-figure"><dt>Allocated (original)</dt><dd>{{ formatMoney(trace.project.allocated_original, trace.project.currency, { bare: true }) }}</dd></div>
          <div class="fin-figure"><dt>Allocated (revisions)</dt><dd>{{ formatMoney(trace.project.allocated_revisions, trace.project.currency, { bare: true }) }}</dd></div>
          <div class="fin-figure"><dt>Actual spend</dt><dd>{{ formatMoney(trace.project.actual_spend, trace.project.currency, { bare: true }) }}<span class="fin-figure-note">{{ trace.project.transaction_rows }} transaction(s)</span></dd></div>
          <div class="fin-figure" :class="{ 'is-negative': trace.project.remaining_allocation.startsWith('-') }">
            <dt>Remaining</dt><dd>{{ formatMoney(trace.project.remaining_allocation, trace.project.currency, { bare: true }) }}</dd>
          </div>
          <div class="fin-figure"><dt>Execution</dt><dd>{{ formatPercentage(trace.project.execution_percentage) }}</dd></div>
        </dl>

        <dl class="ins-dl fin-project-facts">
          <div v-if="trace.project.description"><dt>Scope</dt><dd>{{ trace.project.description }}</dd></div>
          <div v-if="trace.project.location_text"><dt>Location</dt><dd>{{ trace.project.location_text }}</dd></div>
          <div v-if="trace.project.longitude != null">
            <dt>On the map</dt>
            <dd><MapPin :size="13" aria-hidden="true" /> {{ trace.project.latitude?.toFixed(5) }}, {{ trace.project.longitude?.toFixed(5) }}</dd>
          </div>
          <div v-else><dt>On the map</dt><dd>no recorded location — listed as unplaced, never placed</dd></div>
          <div><dt>Ward</dt>
            <dd>{{ trace.project.ward_code || 'not recorded' }}</dd>
          </div>
          <div><dt>Period</dt><dd>{{ formatDate(trace.project.start_date) }} — {{ formatDate(trace.project.end_date) }}</dd></div>
          <div v-if="trace.linked_record">
            <dt>Linked record</dt>
            <dd>
              {{ linkLabel(trace.linked_record.kind) }}<br />
              <small class="ins-mono fin-sub">{{ trace.linked_record.id }}</small>
              <span v-if="trace.linked_record.exists === true" class="fin-pill tone-positive">found</span>
              <span v-else-if="trace.linked_record.exists === false" class="fin-pill tone-negative">not found</span>
              <span v-else class="fin-pill tone-warning">register not readable from here</span>
            </dd>
          </div>
        </dl>

        <!--
          Physical delivery beside financial execution (decision D12, audit M5-6/M8-8). The figure
          is reported by the responsible officer with evidence; it is never derived from elapsed
          schedule, and a project with no report reads "not recorded", never 0 %.
        -->
        <h4 class="fin-sub-head">Physical progress</h4>
        <ProjectProgressControl
          :key="`progress:${trace.project.project_id}`"
          :project-id="trace.project.project_id"
          :reference="trace.project.reference"
          :physical-progress-percent="trace.project.physical_progress_percent ?? null"
          :progress-recorded-at="trace.project.progress_recorded_at ?? null"
          :progress-evidence-document-id="trace.project.progress_evidence_document_id ?? null"
          :execution-percentage="trace.project.execution_percentage"
          :spend-vs-progress-gap-points="trace.project.spend_vs_progress_gap_points ?? null"
          :spend-ahead-of-progress="trace.project.spend_ahead_of_progress ?? null"
          :spend-ahead-of-progress-threshold-points="trace.project.spend_ahead_of_progress_threshold_points ?? null"
          @recorded="open(trace.project.project_id)"
        />

        <!--
          GAP-2. A clinic or a road that serves five wards is the normal rural-district case, and
          until a split is recorded the whole project's money is attributed to one ward code or to
          none. The register lives beside the project because the split belongs to the subject.
        -->
        <h4 class="fin-sub-head">Ward allocations</h4>
        <SpatialAllocationPanel
          :key="`splits:${trace.project.project_id}`"
          subject-kind="project"
          :subject-id="trace.project.project_id"
          :subject-label="`${trace.project.reference} — ${trace.project.name}`"
          :currency="trace.project.currency"
          :subject-cap="trace.project.allocated_total"
          subject-cap-label="allocated total"
          @changed="open(trace.project.project_id)"
        />

        <!-- Everything the council has attached to the SAME record, not only this project. A
             development application can carry several projects over several years, and a trace
             that shows one of them reads as though it showed all of them. -->
        <LinkedFinancePanel
          v-if="linkedLookup"
          class="fin-linked-panel"
          :kind="linkedLookup.kind"
          :subject-id="linkedLookup.id"
          :record-label="linkLabel(linkedLookup.kind).toLowerCase()"
        />

        <h4 class="fin-sub-head">Allocations <span class="ins-count">{{ trace.allocations.length }}</span></h4>
        <p v-if="trace.allocations.length === 0" class="fin-sub">No budget line has been allocated to this project yet.</p>
        <div v-else class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr><th scope="col">Year</th><th scope="col">Budget line</th><th scope="col">Type</th>
                  <th scope="col" class="ccy">Ccy</th><th scope="col" class="num">Amount</th>
                  <th scope="col">Effective</th><th scope="col">Note</th></tr>
            </thead>
            <tbody>
              <tr v-for="a in trace.allocations" :key="a.id">
                <td>{{ a.financial_year_label }}</td>
                <td class="ins-mono">{{ a.budget_line_code }}<br /><small class="fin-sub">{{ a.budget_line_description }}</small></td>
                <td>{{ a.allocation_type }}<template v-if="a.revision_no"> #{{ a.revision_no }}</template></td>
                <td class="ccy">{{ a.currency }}</td>
                <td class="num">{{ formatMoney(a.amount, a.currency, { bare: true }) }}</td>
                <td>{{ formatDate(a.effective_date) }}</td>
                <td>{{ a.note ?? a.revision_reason ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 class="fin-sub-head">Revisions to the funding lines <span class="ins-count">{{ trace.revisions.length }}</span></h4>
        <p v-if="trace.revisions.length === 0" class="fin-sub">The lines funding this project have not been revised.</p>
        <div v-else class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr><th scope="col">Line</th><th scope="col" class="num">No.</th><th scope="col" class="num">Change</th>
                  <th scope="col">State</th><th scope="col">Reason</th><th scope="col">Decided by</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in trace.revisions" :key="r.id">
                <td class="ins-mono">{{ r.budget_line_code }}</td>
                <td class="num">{{ r.revision_no }}</td>
                <td class="num">{{ formatMoney(r.amount_delta, r.currency, { bare: true }) }}</td>
                <td><span class="fin-pill" :class="r.state === 'approved' ? 'tone-positive' : ''">{{ r.state }}</span></td>
                <td>{{ r.reason }}</td>
                <td>{{ r.decided_by_name ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 class="fin-sub-head">
          Transactions <span class="ins-count">{{ trace.transactions.length }}</span>
        </h4>
        <p v-if="!trace.counterparty_visible" class="fin-ccy-note" style="margin-top: 0">
          <EyeOff :size="14" aria-hidden="true" />
          Supplier and beneficiary identities are not shown: that needs the “View counterparty
          identity” permission, which your role does not hold. The columns are absent rather than
          blank, so an empty cell is never mistaken for an absent supplier.
        </p>
        <p v-if="trace.transactions.length === 0" class="fin-sub">No transaction has been associated with this project.</p>
        <div v-else class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr>
                <th scope="col">Date</th><th scope="col">Account</th><th scope="col">Description</th>
                <th scope="col">Reference</th><th scope="col" class="ccy">Ccy</th>
                <th scope="col" class="num">Amount</th><th scope="col">Share</th>
                <th v-if="trace.counterparty_visible" scope="col">Counterparty</th>
                <th v-if="canManage" scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in trace.transactions" :key="t.id">
                <td>{{ formatDate(t.txn_date) }}</td>
                <td class="ins-mono">{{ t.account_code }}<br /><small class="fin-sub">{{ t.account_name }}</small></td>
                <td>{{ t.description ?? '—' }}</td>
                <td class="ins-mono">{{ t.reference ?? '—' }}</td>
                <td class="ccy">{{ t.currency }}</td>
                <td class="num">{{ formatMoney(t.amount, t.currency, { bare: true }) }}</td>
                <td>{{ t.association === 'apportioned' ? `${(Number(t.share) * 100).toFixed(1)}%` : 'whole' }}</td>
                <td v-if="trace.counterparty_visible">{{ t.counterparty_name ?? '—' }}</td>
                <td v-if="canManage">
                  <button type="button" class="fin-btn small danger"
                          :disabled="busy === trace.project.project_id"
                          @click="unlink(trace.project.project_id, t.id, t.reference)">
                    <Unlink :size="12" aria-hidden="true" /> Detach
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 class="fin-sub-head">Documents <span class="ins-count">{{ trace.documents.length }}</span></h4>
        <div v-if="canUploadDocs" class="fin-doc-attach">
          <div class="ins-field">
            <label class="ins-label" for="pr-doctype">Document type</label>
            <input id="pr-doctype" v-model="docType" class="ins-input" maxlength="80"
                   list="pr-doctype-list" placeholder="e.g. contract" />
            <datalist id="pr-doctype-list">
              <option value="contract" />
              <option value="completion_certificate" />
              <option value="interim_certificate" />
              <option value="invoice" />
              <option value="retention_release" />
              <option value="progress_report" />
            </datalist>
          </div>
          <button type="button" class="fin-btn" :disabled="uploadingDoc" @click="chooseDoc">
            <Upload :size="14" aria-hidden="true" />
            {{ uploadingDoc ? 'Attaching…' : 'Attach a document' }}
          </button>
          <input ref="docInput" type="file" class="fin-hidden-file"
                 accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,.xlsx" @change="attachDocument" />
          <p class="ins-hint">
            PDF, image, CSV or XLSX up to 25 MB. It arrives restricted; releasing it to the portal
            is a publisher's separate act, under Documents.
          </p>
        </div>
        <p v-if="trace.documents.length === 0" class="fin-sub">
          <Paperclip :size="12" aria-hidden="true" /> No documents are attached.
        </p>
        <ul v-else class="fin-docs">
          <li v-for="d in trace.documents" :key="d.id">
            <a :href="financeApi.documentDownloadUrl(d.id)" rel="noopener">{{ d.filename }}</a>
            <span class="fin-pill" :class="d.visibility === 'public' ? 'tone-positive' : ''">{{ d.visibility }}</span>
            <small class="fin-sub">{{ d.document_type ?? 'unclassified' }} · {{ formatDate(d.uploaded_at) }}</small>
          </li>
        </ul>
      </div>
    </section>

    <!-- M5-5: the second editor of the same two fields. It writes them; it never guesses them. -->
    <ProjectLocationPickerModal
      :open="pickingLocation"
      :longitude="form.longitude"
      :latitude="form.latitude"
      :reference="form.reference || null"
      @close="pickingLocation = false"
      @pick="applyPickedLocation"
    />
  </div>
</template>

<style scoped>
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); }
.fin-filter { max-width: 13rem; }
/* The ward filter is a picker: it needs room for "ZW170401 — Vungu Ward 4". */
.fin-filter-ward { max-width: 18rem; }
/* Five acts fit on a project row. Without a floor on the column an auto-layout table squeezes
   it until the labels are clipped; with one, the table scrolls, which is what a wide table should
   do. */
.fin-row-actions { display: flex; gap: 4px; flex-wrap: wrap; min-width: 10.5rem; }
.fin-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.fin-sub-head { margin: var(--ent-s4) 0 var(--ent-s2); font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); color: var(--ent-text); display: flex; align-items: baseline; gap: var(--ent-s2); }
.fin-loading { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.fin-project-facts { margin-top: var(--ent-s4); }
.fin-docs { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--ent-s2); }
.fin-docs li { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; font-size: var(--ent-fs-sm); }
.fin-linked-panel { margin-top: var(--ent-s4); }
.fin-doc-attach {
  display: flex; align-items: flex-end; gap: var(--ent-s3); flex-wrap: wrap;
  margin-bottom: var(--ent-s3); padding: var(--ent-s3);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-sm); background: var(--ent-surface-2);
}
.fin-doc-attach .ins-field { min-width: 12rem; }
.fin-doc-attach .ins-hint { flex-basis: 100%; margin: 0; }
.fin-hidden-file { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.fin-ccy-note { display: flex; align-items: flex-start; gap: var(--ent-s2); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
