<script setup lang="ts">
/**
 * Budget lines: preparation, the approval chain, and performance against actuals.
 *
 * THE ORIGINAL AND THE REVISED FIGURE ARE ALWAYS SHOWN TOGETHER. The specification requires them
 * to remain separately visible (§3.3) and a critical test scenario checks it (§13.1); showing only
 * the revised figure is how a council loses sight of what it originally approved. Every table and
 * every detail panel here carries both.
 *
 * THE CHAIN IS draft → submitted → (returned | approved) → published, and the person who submitted
 * a line cannot approve it. That is checked here so the refusal is legible, and again by the
 * server, which is what actually holds.
 *
 * EDITING STOPS AT APPROVAL. An approved allocation moves only by revision, which is the whole
 * control; the Edit button disappears and says where to go instead.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { financeApi, type BudgetLineQuery } from '../../api/financeApi'
import { formatMoney, formatPercentage, formatDate } from '../../composables/useMoney'
import { useFinancePrompt } from '../../composables/useFinancePrompt'
import type { BudgetLinePerformance, BudgetRevision, Commitment, Currency, VarianceExplanation } from '../../models/types'
import FinanceGuard from '../../components/FinanceGuard.vue'
import FinancePromptDialog from '../../components/FinancePromptDialog.vue'
import WardPicker from '../../components/WardPicker.vue'
import {
  AlertTriangle, CheckCircle2, Plus, RefreshCw, Info, Send, Undo2, Check, X, FileDiff, MessageSquare,
  Pencil, Handshake,
} from 'lucide-vue-next'

const store = useFinanceStore()
const prompt = useFinancePrompt()

const lines = ref<BudgetLinePerformance[]>([])
const total = ref(0)
const includesCommitments = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref<string | null>(null)

const route = useRoute()
const router = useRouter()
const query = ref<BudgetLineQuery>({ limit: 50, offset: 0, sort: 'code', direction: 'asc' })

/**
 * WHICH LINES THIS REGISTER OPENS ON.
 *
 * It used to open on all of them, which meant a committee member arriving here saw draft, submitted,
 * returned, approved and published lines in one list and had to know to choose "Submitted" from the
 * filter — so the submit→approve handover had no visible side at all. The status now comes from
 * three places in order of authority: an explicit `?status=` in the link (a work queue links here,
 * and so does a colleague sending "look at this"), then the role preset — `submitted` for an
 * approver, `draft` for a preparer, nothing for the finance administrator whose register must stay
 * whole — and then, as before, nothing.
 *
 * The filter control below is bound to the same value, so the default is visible and one click on
 * "All" undoes it. A default nobody can see is a trap.
 */
if (typeof route.query.status === 'string' && route.query.status) {
  query.value.status = route.query.status
} else if (store.rolePreset.defaultFilters.budgetStatus) {
  query.value.status = store.rolePreset.defaultFilters.budgetStatus
}

// The finance map (and ?section=budget&ward=… links) pre-filter the register. Audit X-2: the sync
// is now two-way — choosing a ward here publishes it to the store and the URL, so switching to the
// map opens on the same ward and the link in a committee paper survives a reload.
if (typeof route.query.ward === 'string' && route.query.ward) query.value.ward_code = route.query.ward
else if (store.mapWardCode) query.value.ward_code = store.mapWardCode
watch(() => store.mapWardCode, (code) => {
  if (code && code !== query.value.ward_code) {
    query.value.ward_code = code
    query.value.offset = 0
    load()
  }
})
watch(() => route.query.ward, (code) => {
  const value = typeof code === 'string' ? code : ''
  if (value !== (query.value.ward_code ?? '')) {
    query.value.ward_code = value || undefined
    query.value.offset = 0
    load()
  }
})

/**
 * The ward filter, as the picker writes it. Setting it is the outbound half of X-2: the register's
 * ward becomes the map's ward, so the two surfaces cannot show different geography at once.
 */
const wardFilter = computed<string>({
  get: () => query.value.ward_code ?? '',
  set: (value: string) => {
    const code = value.trim()
    query.value.ward_code = code || undefined
    query.value.offset = 0
    store.setMapWard(code || null)
    const next = { ...route.query, section: 'budget' } as Record<string, string | undefined>
    if (code) next.ward = code
    else delete next.ward
    void router.replace({ query: next })
    load()
  },
})

const selected = ref<{
  line: BudgetLinePerformance & { financial_year_label: string; financial_year_status: string }
  revisions: BudgetRevision[]
  commitments: Commitment[]
  explanations: VarianceExplanation[]
} | null>(null)

/**
 * The line being edited, or null when the form is preparing a new one.
 *
 * The same form serves both, because the fields are the same ones — except that an existing line's
 * department, account, code and currency are NOT among them. Those four are what the line IS: a
 * budget line that changes its vote or its currency is a different line, and moving a figure
 * between votes by editing it would leave no trace of where it came from. The server's PATCH body
 * accepts only the four fields this form offers, so the shape here is the shape it allows.
 */
const editing = ref<BudgetLinePerformance | null>(null)

const showForm = ref(false)
const form = ref<{
  department_id: string; account_id: string; code: string; description: string
  currency: Currency; original_amount: string; programme_id: string; ward_code: string
}>({ department_id: '', account_id: '', code: '', description: '', currency: 'USD', original_amount: '', programme_id: '', ward_code: '' })

const yearId = computed(() => store.selectedYearId)
const canPrepare = computed(() => store.can('finance.budget.prepare'))
const canSubmit = computed(() => store.can('finance.budget.submit'))
const canApprove = computed(() => store.can('finance.budget.approve'))
const canRevise = computed(() => store.can('finance.revision.prepare'))
const canExplain = computed(() => store.can('finance.variance.explain'))
const writable = computed(() => store.selectedYearAcceptsWrites)
const me = computed(() => store.identity?.user_id ?? null)

/**
 * A line this person submitted themselves.
 *
 * The route refuses the approval ("You submitted this line. Approval must come from someone else",
 * specification §2.3) and so the Approve and Return controls are not offered on it — the workspace
 * documents that it does not put a button on a surface whose only outcome is a 403. The refusal is
 * said in words on the row instead, which is what the Revisions screen has always done.
 */
const isOwnSubmission = (l: BudgetLinePerformance): boolean =>
  me.value !== null && l.submitted_by === me.value

const statusTone: Record<string, string> = {
  draft: '', submitted: 'tone-info', returned: 'tone-warning',
  approved: 'tone-positive', published: 'tone-positive',
}

async function load(): Promise<void> {
  if (!yearId.value) { lines.value = []; total.value = 0; return }
  loading.value = true
  error.value = null
  try {
    const result = await financeApi.budgetLines({ ...query.value, financial_year_id: yearId.value })
    lines.value = result.lines
    total.value = result.total
    includesCommitments.value = result.available_balance_includes_commitments
  } catch (err) {
    error.value = messageOf(err, 'The budget lines could not be read.')
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([yearId, () => query.value.status, () => query.value.kind, () => query.value.department_id,
  () => query.value.sort, () => query.value.direction, () => query.value.offset], load)

// A work-queue link can arrive while this section is already on screen — a departmental head
// lands on Budget and then opens "Lines returned to you" from the panel above it. The component is
// not remounted in that case, so the status in the address has to be watched, not only read once.
watch(() => route.query.status, (status) => {
  if (typeof status === 'string' && status && status !== query.value.status) {
    query.value.status = status
    query.value.offset = 0
  }
})

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(() => query.value.q, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { query.value.offset = 0; void load() }, 300)
})

async function openLine(id: string): Promise<void> {
  error.value = null
  try {
    selected.value = await financeApi.budgetLine(id)
  } catch (err) {
    error.value = messageOf(err, 'That budget line could not be read.')
  }
}

async function create(): Promise<void> {
  error.value = null; note.value = null
  if (!yearId.value) return
  const f = form.value
  if (!f.department_id || !f.account_id || !f.code.trim() || !f.description.trim() || !f.original_amount.trim()) {
    error.value = 'Department, account, code, description and amount are all required.'
    return
  }
  busy.value = 'create'
  try {
    await financeApi.createBudgetLine({
      financial_year_id: yearId.value,
      department_id: f.department_id, account_id: f.account_id,
      code: f.code.trim(), description: f.description.trim(),
      currency: f.currency, original_amount: f.original_amount.trim(),
      programme_id: f.programme_id || undefined,
      ward_code: f.ward_code.trim() || undefined,
    })
    note.value = 'Budget line created as a draft. It becomes the approved allocation through submission and approval.'
    showForm.value = false
    form.value = { department_id: '', account_id: '', code: '', description: '', currency: 'USD', original_amount: '', programme_id: '', ward_code: '' }
    await load()
  } catch (err) {
    error.value = messageOf(err, 'The budget line could not be created.')
  } finally {
    busy.value = null
  }
}

/** Open the form on an existing draft, pre-filled. */
function edit(line: BudgetLinePerformance): void {
  error.value = null; note.value = null
  editing.value = line
  form.value = {
    department_id: line.department_id,
    account_id: line.account_id,
    code: line.code,
    description: line.description,
    currency: line.currency,
    original_amount: line.original_amount,
    programme_id: line.programme_id ?? '',
    ward_code: line.ward_code ?? '',
  }
  showForm.value = true
}

function closeForm(): void {
  showForm.value = false
  editing.value = null
  form.value = { department_id: '', account_id: '', code: '', description: '', currency: 'USD', original_amount: '', programme_id: '', ward_code: '' }
}

async function save(): Promise<void> {
  const line = editing.value
  if (!line) return
  error.value = null; note.value = null
  const f = form.value
  if (!f.description.trim() || !f.original_amount.trim()) {
    error.value = 'A description and an amount are both required.'
    return
  }
  busy.value = 'create'
  try {
    await financeApi.updateBudgetLine(line.budget_line_id, {
      description: f.description.trim(),
      original_amount: f.original_amount.trim(),
      programme_id: f.programme_id || undefined,
      ward_code: f.ward_code.trim() || undefined,
    })
    note.value = `${line.code} updated. It is still a draft until it is submitted and approved.`
    closeForm()
    await load()
    if (selected.value?.line.budget_line_id === line.budget_line_id) await openLine(line.budget_line_id)
  } catch (err) {
    // 409 not_editable is the one worth repeating in words: the line was approved between the
    // officer opening this form and pressing Save, and from there it moves only by revision.
    error.value = messageOf(err, 'The budget line could not be updated.')
  } finally {
    busy.value = null
  }
}

async function act(id: string, action: 'submit' | 'approve' | 'return'): Promise<void> {
  error.value = null; note.value = null
  busy.value = id
  try {
    if (action === 'submit') {
      await financeApi.submitBudgetLine(id)
      note.value = 'Submitted for review. Approval must come from someone else.'
    } else if (action === 'approve') {
      await financeApi.approveBudgetLine(id)
      note.value = 'Approved. From here the allocation changes only by an approved revision.'
    } else {
      const reason = await prompt.ask({
        title: 'Return this line',
        message: 'The note goes to the preparer and onto the record.',
        label: 'Why is this being returned?',
        kind: 'textarea',
        minLength: 5,
        submitLabel: 'Return it',
      })
      if (!reason) return
      await financeApi.returnBudgetLine(id, reason)
      note.value = 'Returned to the preparer with your note.'
    }
    await load()
    if (selected.value?.line.budget_line_id === id) await openLine(id)
  } catch (err) {
    error.value = messageOf(err, 'That could not be done.')
  } finally {
    busy.value = null
  }
}

async function raiseRevision(line: BudgetLinePerformance): Promise<void> {
  error.value = null; note.value = null
  const amount = await prompt.ask({
    title: `Revise ${line.code}`,
    message: `A positive figure is a supplementary allocation, a negative one a reduction. The line is denominated in ${line.currency} and the revision stays in it.`,
    label: `Change to the allocation (${line.currency})`,
    kind: 'amount',
    placeholder: '25000.00',
  })
  if (!amount) return
  const reason = await prompt.ask({
    title: 'Reason for the revision',
    message: 'It goes on the record and stays readable beside the original approved figure.',
    label: 'Reason',
    kind: 'textarea',
    minLength: 10,
    submitLabel: 'Raise revision',
  })
  if (!reason) return
  busy.value = line.budget_line_id
  try {
    const revision = await financeApi.createRevision(line.budget_line_id, {
      amount_delta: amount, reason,
    })
    note.value = `Revision ${revision.revision_no} raised as a draft. Submit it, then someone else approves it — you cannot approve your own.`
    if (selected.value?.line.budget_line_id === line.budget_line_id) await openLine(line.budget_line_id)
  } catch (err) {
    error.value = messageOf(err, 'The revision could not be raised.')
  } finally {
    busy.value = null
  }
}

async function explain(line: BudgetLinePerformance): Promise<void> {
  error.value = null; note.value = null
  const text = await prompt.ask({
    title: 'Explain the variance',
    message: 'The explanation is recorded against the line and read beside its figures.',
    label: 'Explanation for the variance on this line',
    kind: 'textarea',
    minLength: 10,
    submitLabel: 'Record explanation',
  })
  if (!text) return
  busy.value = line.budget_line_id
  try {
    await financeApi.explainVariance({
      financial_year_id: line.financial_year_id,
      budget_line_id: line.budget_line_id,
      explanation: text,
    })
    note.value = 'Explanation recorded against the line.'
    if (selected.value?.line.budget_line_id === line.budget_line_id) await openLine(line.budget_line_id)
  } catch (err) {
    error.value = messageOf(err, 'The explanation could not be recorded.')
  } finally {
    busy.value = null
  }
}

/**
 * The year's open commitments.
 *
 * A commitment is money already promised — an order placed, a contract signed — that has not yet
 * been paid. It matters here because it is the difference between the two "available" figures every
 * row above carries: a line with 40 000 unspent and 35 000 committed has 5 000 genuinely free, and
 * a council that reads the first figure orders twice. The register is loaded on demand rather than
 * with the page, because a council whose accounting system supplies no commitment data has none
 * and should not pay for the query.
 *
 * Nothing here writes. Commitments arrive through the commitments import dataset; this module does
 * not raise them, because raising one is a procurement act and procurement is out of scope (§1.3).
 */
const commitments = ref<Commitment[]>([])
const commitmentsOpen = ref(false)
const commitmentsLoaded = ref(false)
const loadingCommitments = ref(false)

async function loadCommitments(): Promise<void> {
  if (!yearId.value) return
  loadingCommitments.value = true
  error.value = null
  try {
    commitments.value = await financeApi.commitments({ financial_year_id: yearId.value, status: 'open' })
    commitmentsLoaded.value = true
  } catch (err) {
    error.value = messageOf(err, 'The commitment register could not be read.')
  } finally {
    loadingCommitments.value = false
  }
}

function toggleCommitments(): void {
  commitmentsOpen.value = !commitmentsOpen.value
  if (commitmentsOpen.value && !commitmentsLoaded.value) void loadCommitments()
}

// A commitment belongs to a year, so the loaded set is dropped when the year changes rather than
// left on screen under the wrong period.
watch(yearId, () => { commitments.value = []; commitmentsLoaded.value = false })

const commitmentsByCurrency = computed(() => {
  const groups = new Map<Currency, Commitment[]>()
  for (const c of commitments.value) {
    const list = groups.get(c.currency) ?? []
    list.push(c)
    groups.set(c.currency, list)
  }
  return [...groups.entries()].map(([currency, rows]) => ({ currency, rows }))
})

/** Accounts offered in the form follow the chosen side, so a revenue line cannot cite an expenditure code. */
const offeredAccounts = computed(() => store.postableAccounts)
const pages = computed(() => Math.max(1, Math.ceil(total.value / (query.value.limit ?? 50))))
const page = computed(() => Math.floor((query.value.offset ?? 0) / (query.value.limit ?? 50)) + 1)
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
        <input v-model="query.q" class="ins-input" type="search" placeholder="Search code or description" />
      </label>
      <div class="fin-filter fin-filter-ward">
        <WardPicker id="bl-ward-filter" v-model="wardFilter" compact
                    empty-label="Every ward" />
      </div>
      <select v-model="query.kind" class="ins-input fin-filter" aria-label="Revenue or expenditure">
        <option :value="undefined">Revenue and expenditure</option>
        <option value="revenue">Revenue only</option>
        <option value="expenditure">Expenditure only</option>
      </select>
      <select v-model="query.department_id" class="ins-input fin-filter" aria-label="Department">
        <option :value="undefined">All departments</option>
        <option v-for="d in store.departments" :key="d.id" :value="d.id">{{ d.code }} {{ d.name }}</option>
      </select>
      <select v-model="query.status" class="ins-input fin-filter" aria-label="Approval state">
        <option :value="undefined">Any state</option>
        <option value="draft">Draft</option>
        <option value="submitted">Submitted</option>
        <option value="returned">Returned</option>
        <option value="approved">Approved</option>
        <option value="published">Published</option>
      </select>
      <button v-if="canPrepare && writable" type="button" class="fin-btn primary"
              @click="editing ? (closeForm(), showForm = true) : (showForm = !showForm)">
        <Plus :size="14" aria-hidden="true" /> New line
      </button>
      <button type="button" class="fin-btn small" :disabled="loading" @click="load">
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
      </button>
    </div>

    <FinanceGuard v-if="showForm" requires="finance.budget.prepare" surface="Preparing a budget line">
      <form class="ins-card" @submit.prevent="editing ? save() : create()">
        <div class="ins-card-head">
          <h3 v-if="editing">Edit {{ editing.code }} — {{ store.selectedYear?.label }}</h3>
          <h3 v-else>New budget line — {{ store.selectedYear?.label }}</h3>
        </div>
        <div class="ins-card-body">
          <div class="ins-form">
            <div class="ins-field">
              <label class="ins-label" for="bl-dept">Department (vote)</label>
              <select id="bl-dept" v-model="form.department_id" class="ins-input" required :disabled="!!editing">
                <option value="">Choose…</option>
                <option v-for="d in store.activeDepartments" :key="d.id" :value="d.id">{{ d.code }} {{ d.name }}</option>
              </select>
              <p v-if="editing" class="ins-hint">
                The vote cannot be changed by editing. Moving an allocation between votes is a
                reduction on one and a supplementary allocation on the other, each with its own
                approval.
              </p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="bl-acct">Account (economic line)</label>
              <select id="bl-acct" v-model="form.account_id" class="ins-input" required :disabled="!!editing">
                <option value="">Choose…</option>
                <option v-for="a in offeredAccounts" :key="a.id" :value="a.id">
                  {{ a.code }} — {{ a.name }} ({{ a.kind }})
                </option>
              </select>
              <p class="ins-hint">Only postable accounts appear. A heading cannot carry a budget.</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="bl-code">Line code</label>
              <input id="bl-code" v-model="form.code" class="ins-input" maxlength="60" required :disabled="!!editing" />
              <p class="ins-hint">
                Unique within the financial year. Use the council's own line code so imports match
                it.<template v-if="editing"> It is fixed once the line exists, because imports and
                reports already cite it.</template>
              </p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="bl-ccy">Currency</label>
              <select id="bl-ccy" v-model="form.currency" class="ins-input" :disabled="!!editing">
                <option value="USD">USD</option>
                <option value="ZWG">ZWG</option>
              </select>
              <p class="ins-hint">A line is denominated in one currency. Actuals posted to it in another are excluded from its totals and reported as a fault.</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="bl-amount">Original allocation</label>
              <input id="bl-amount" v-model="form.original_amount" class="ins-input" inputmode="decimal"
                     placeholder="100000.00" required />
              <p class="ins-hint">A reduction is recorded later as a revision, not as a negative allocation.</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="bl-prog">Programme</label>
              <select id="bl-prog" v-model="form.programme_id" class="ins-input">
                <option value="">None</option>
                <option v-for="p in store.programmes" :key="p.id" :value="p.id">{{ p.code }} {{ p.name }}</option>
              </select>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="bl-ward">Ward</label>
              <WardPicker id="bl-ward" v-model="form.ward_code" />
            </div>
            <div class="ins-field full">
              <label class="ins-label" for="bl-desc">Description</label>
              <input id="bl-desc" v-model="form.description" class="ins-input" maxlength="500" required />
            </div>
          </div>
        </div>
        <div class="ins-card-foot">
          <button type="button" class="fin-btn" @click="closeForm">Cancel</button>
          <button type="submit" class="fin-btn primary" :disabled="busy === 'create'">
            <template v-if="editing">{{ busy === 'create' ? 'Saving…' : 'Save changes' }}</template>
            <template v-else>{{ busy === 'create' ? 'Creating…' : 'Create as draft' }}</template>
          </button>
        </div>
      </form>
    </FinanceGuard>

    <p v-if="loading && lines.length === 0" class="fin-loading" role="status">Reading budget lines…</p>

    <div v-else-if="!yearId" class="fin-empty">
      <strong>No financial year is selected.</strong>
      <p>Choose a reporting period above.</p>
    </div>

    <div v-else-if="lines.length === 0" class="fin-empty">
      <strong>No budget lines match.</strong>
      <p>
        Budget lines can be keyed in here, or imported in bulk under Data imports — an imported
        line arrives as a draft, because an import is not an approval.
      </p>
    </div>

    <section v-else class="ins-card">
      <div class="ins-card-head">
        <h3>Budget lines <span class="ins-count">{{ total }}</span></h3>
        <span class="fin-asat">
          Available
          {{ includesCommitments ? 'includes' : 'excludes' }}
          open commitments — the Council sets which, under Settings.
        </span>
      </div>
      <div class="ins-card-body">
        <div class="fin-table-wrap">
          <table class="fin-table sticky-actions">
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Department / account</th>
                <th scope="col">State</th>
                <th scope="col" class="ccy">Ccy</th>
                <th scope="col" class="num">Original</th>
                <th scope="col" class="num">Adjustments</th>
                <th scope="col" class="num">Revised</th>
                <th scope="col" class="num">Actual</th>
                <th scope="col" class="num">Available</th>
                <th scope="col" class="num">Execution</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in lines" :key="l.budget_line_id">
                <td>
                  <button type="button" class="fin-link ins-mono" @click="openLine(l.budget_line_id)">{{ l.code }}</button>
                  <br /><small class="fin-sub">{{ l.description }}</small>
                </td>
                <td>
                  {{ l.department_name }}<br />
                  <small class="fin-sub">{{ l.account_code }} {{ l.account_name }} · {{ l.account_kind }}</small>
                </td>
                <td><span class="fin-pill" :class="statusTone[l.status]">{{ l.status }}</span></td>
                <td class="ccy">{{ l.currency }}</td>
                <td class="num">{{ formatMoney(l.original_amount, l.currency, { bare: true }) }}</td>
                <td class="num">{{ formatMoney(l.approved_adjustments, l.currency, { bare: true }) }}</td>
                <td class="num emphasis">{{ formatMoney(l.revised_amount, l.currency, { bare: true }) }}</td>
                <td class="num">{{ formatMoney(l.actual_amount, l.currency, { bare: true }) }}</td>
                <td class="num">
                  {{ formatMoney(includesCommitments ? l.available_including_commitments : l.available_excluding_commitments, l.currency, { bare: true }) }}
                </td>
                <td class="num" :class="{ 'undefined-value': l.execution_percentage === null }">
                  {{ formatPercentage(l.execution_percentage) }}
                </td>
                <td>
                  <div class="fin-row-actions">
                    <button v-if="canPrepare && writable && ['draft', 'returned'].includes(l.status)"
                            type="button" class="fin-btn small" :disabled="busy === l.budget_line_id"
                            @click="edit(l)">
                      <Pencil :size="12" aria-hidden="true" /> Edit
                    </button>
                    <button v-if="canSubmit && writable && ['draft', 'returned'].includes(l.status)"
                            type="button" class="fin-btn small" :disabled="busy === l.budget_line_id"
                            @click="act(l.budget_line_id, 'submit')">
                      <Send :size="12" aria-hidden="true" /> Submit
                    </button>
                    <button v-if="canApprove && writable && l.status === 'submitted' && !isOwnSubmission(l)"
                            type="button" class="fin-btn small primary" :disabled="busy === l.budget_line_id"
                            @click="act(l.budget_line_id, 'approve')">
                      <Check :size="12" aria-hidden="true" /> Approve
                    </button>
                    <button v-if="canApprove && writable && l.status === 'submitted' && !isOwnSubmission(l)"
                            type="button" class="fin-btn small" :disabled="busy === l.budget_line_id"
                            @click="act(l.budget_line_id, 'return')">
                      <Undo2 :size="12" aria-hidden="true" /> Return
                    </button>
                    <button v-if="canRevise && writable && ['approved', 'published'].includes(l.status)"
                            type="button" class="fin-btn small" :disabled="busy === l.budget_line_id"
                            @click="raiseRevision(l)">
                      <FileDiff :size="12" aria-hidden="true" /> Revise
                    </button>
                    <button v-if="canExplain" type="button" class="fin-btn small" :disabled="busy === l.budget_line_id"
                            @click="explain(l)">
                      <MessageSquare :size="12" aria-hidden="true" /> Explain
                    </button>
                  </div>
                  <p v-if="canApprove && l.status === 'submitted' && isOwnSubmission(l)" class="fin-fault">
                    <Info :size="12" aria-hidden="true" />
                    You submitted this line, so approving it is not yours to do. It is awaiting
                    another approver.
                  </p>
                  <p v-if="l.status === 'returned' && l.returned_note" class="fin-fault">
                    <Undo2 :size="12" aria-hidden="true" />
                    Returned: {{ l.returned_note }}
                  </p>
                  <p v-if="l.actual_currency_mismatch_rows > 0" class="fin-fault">
                    <AlertTriangle :size="12" aria-hidden="true" />
                    {{ l.actual_currency_mismatch_rows }} posting(s) in another currency, excluded
                  </p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="pages > 1" class="fin-pager">
          <button type="button" class="fin-btn small" :disabled="(query.offset ?? 0) === 0"
                  @click="query.offset = Math.max(0, (query.offset ?? 0) - (query.limit ?? 50))">Previous</button>
          <span>Page {{ page }} of {{ pages }}</span>
          <button type="button" class="fin-btn small" :disabled="page >= pages"
                  @click="query.offset = (query.offset ?? 0) + (query.limit ?? 50)">Next</button>
        </div>
      </div>
    </section>

    <!-- ── Open commitments for the year ───────────────────────────────────────────────────── -->
    <section v-if="yearId" class="ins-card">
      <div class="ins-card-head">
        <h3>Open commitments</h3>
        <button type="button" class="fin-btn small" :aria-expanded="commitmentsOpen"
                aria-controls="fin-commitments" @click="toggleCommitments">
          <Handshake :size="13" aria-hidden="true" />
          {{ commitmentsOpen ? 'Hide' : 'Show' }}
        </button>
      </div>
      <div v-if="commitmentsOpen" id="fin-commitments" class="ins-card-body">
        <p v-if="loadingCommitments" class="fin-loading" role="status">Reading the commitment register…</p>

        <div v-else-if="commitments.length === 0" class="fin-empty">
          <strong>No open commitments are recorded for {{ store.selectedYear?.label }}.</strong>
          <p>
            Commitments arrive through the commitments import dataset, where the council's system
            supplies them. A council with none simply has none, and the available figure that
            excludes commitments is the one to read.
          </p>
        </div>

        <template v-else>
          <div v-for="group in commitmentsByCurrency" :key="group.currency" class="fin-ccy-group">
            <h4 class="fin-ccy-head">
              {{ group.currency }} <small>{{ group.rows.length }} commitment(s)</small>
            </h4>
            <div class="fin-table-wrap">
              <table class="fin-table">
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Against</th>
                    <th scope="col">Committed</th>
                    <th scope="col" class="num">Amount</th>
                    <th scope="col" class="num">Liquidated</th>
                    <th scope="col" class="num">Outstanding</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="c in group.rows" :key="c.id">
                    <td class="ins-mono">{{ c.reference }}</td>
                    <td>
                      <button type="button" class="fin-link ins-mono" @click="openLine(c.budget_line_id)">
                        {{ c.budget_line_code ?? 'line' }}
                      </button>
                      <br v-if="c.description" /><small v-if="c.description" class="fin-sub">{{ c.description }}</small>
                    </td>
                    <td>{{ formatDate(c.committed_on) }}</td>
                    <td class="num">{{ formatMoney(c.amount, c.currency, { bare: true }) }}</td>
                    <td class="num">{{ formatMoney(c.liquidated_amount, c.currency, { bare: true }) }}</td>
                    <td class="num emphasis">{{ formatMoney(c.outstanding_amount ?? null, c.currency, { bare: true }) }}</td>
                    <td><span class="fin-pill">{{ c.status.replace(/_/g, ' ') }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <p class="fin-ccy-note">
            Each currency is listed separately and no total spans them. Outstanding is the committed
            amount less what has been liquidated against it — the part that is still a claim on the
            budget.
          </p>
        </template>
      </div>
    </section>

    <!-- ── One line, in full ───────────────────────────────────────────────────────────────── -->
    <section v-if="selected" class="ins-card">
      <div class="ins-card-head">
        <h3>{{ selected.line.code }} — {{ selected.line.description }}</h3>
        <button type="button" class="ins-iconbtn" @click="selected = null">
          <X :size="16" aria-hidden="true" /><span class="sr-only">Close</span>
        </button>
      </div>
      <div class="ins-card-body">
        <dl class="fin-figures">
          <div class="fin-figure">
            <dt>Original approved</dt>
            <dd>{{ formatMoney(selected.line.original_amount, selected.line.currency, { bare: true }) }}
              <span class="fin-figure-note">{{ selected.line.currency }} · never changed after approval</span></dd>
          </div>
          <div class="fin-figure">
            <dt>Approved adjustments</dt>
            <dd>{{ formatMoney(selected.line.approved_adjustments, selected.line.currency, { bare: true }) }}
              <span class="fin-figure-note">{{ selected.revisions.filter((r) => r.state === 'approved').length }} approved revision(s)</span></dd>
          </div>
          <div class="fin-figure">
            <dt>Revised budget</dt>
            <dd>{{ formatMoney(selected.line.revised_amount, selected.line.currency, { bare: true }) }}</dd>
          </div>
          <div class="fin-figure">
            <dt>Actual</dt>
            <dd>{{ formatMoney(selected.line.actual_amount, selected.line.currency, { bare: true }) }}
              <span class="fin-figure-note">{{ selected.line.transaction_rows }} transaction(s)</span></dd>
          </div>
          <div class="fin-figure">
            <dt>Open commitments</dt>
            <dd>{{ formatMoney(selected.line.open_commitments, selected.line.currency, { bare: true }) }}</dd>
          </div>
          <div class="fin-figure" :class="{ 'is-negative': selected.line.available_excluding_commitments.startsWith('-') }">
            <dt>Available</dt>
            <dd>
              {{ formatMoney(selected.line.available_excluding_commitments, selected.line.currency, { bare: true }) }}
              <span class="fin-figure-note">
                excluding commitments · including:
                {{ formatMoney(selected.line.available_including_commitments, selected.line.currency, { bare: true }) }}
              </span>
            </dd>
          </div>
        </dl>

        <p class="fin-ccy-note">
          <Info :size="14" aria-hidden="true" />
          Both definitions of “available” are shown so the figure cannot be read as the other one.
          Revised budget = original approved + approved adjustments. Execution =
          actual ÷ revised × 100, undefined where the revised budget is zero.
        </p>

        <h4 class="fin-sub-head">Revision history <span class="ins-count">{{ selected.revisions.length }}</span></h4>
        <p v-if="selected.revisions.length === 0" class="fin-sub">No revisions have been raised on this line.</p>
        <div v-else class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr>
                <th scope="col" class="num">No.</th><th scope="col" class="num">Change</th>
                <th scope="col">State</th><th scope="col">Reason</th>
                <th scope="col">Requested by</th><th scope="col">Decided by</th><th scope="col">Effective</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in selected.revisions" :key="r.id">
                <td class="num">{{ r.revision_no }}</td>
                <td class="num" :class="{ emphasis: r.state === 'approved' }">
                  {{ formatMoney(r.amount_delta, r.currency, { bare: true }) }}
                </td>
                <td>
                  <span class="fin-pill" :class="r.state === 'approved' ? 'tone-positive' : r.state === 'rejected' ? 'tone-negative' : 'tone-info'">
                    {{ r.state }}
                  </span>
                </td>
                <td>{{ r.reason }}<br v-if="r.decision_note" /><small v-if="r.decision_note" class="fin-sub">{{ r.decision_note }}</small></td>
                <td>{{ r.requested_by_name ?? '—' }}</td>
                <td>{{ r.decided_by_name ?? '—' }}</td>
                <td>{{ formatDate(r.effective_date) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 class="fin-sub-head">Commitments <span class="ins-count">{{ selected.commitments.length }}</span></h4>
        <p v-if="selected.commitments.length === 0" class="fin-sub">
          No commitments recorded. Commitments are imported where the council's system supplies
          them; a council with no commitment data simply has none, and the available figure that
          excludes them is the one to read.
        </p>
        <div v-else class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr><th scope="col">Reference</th><th scope="col">Committed</th><th scope="col" class="ccy">Ccy</th>
                  <th scope="col" class="num">Amount</th><th scope="col" class="num">Outstanding</th><th scope="col">State</th></tr>
            </thead>
            <tbody>
              <tr v-for="c in selected.commitments" :key="c.id">
                <td class="ins-mono">{{ c.reference }}</td>
                <td>{{ formatDate(c.committed_on) }}</td>
                <td class="ccy">{{ c.currency }}</td>
                <td class="num">{{ formatMoney(c.amount, c.currency, { bare: true }) }}</td>
                <td class="num">{{ formatMoney(c.outstanding_amount ?? null, c.currency, { bare: true }) }}</td>
                <td><span class="fin-pill">{{ c.status.replace(/_/g, ' ') }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 class="fin-sub-head">Variance explanations <span class="ins-count">{{ selected.explanations.length }}</span></h4>
        <p v-if="selected.explanations.length === 0" class="fin-sub">None recorded.</p>
        <ul v-else class="fin-notes">
          <li v-for="e in selected.explanations" :key="e.id">
            <p>{{ e.explanation }}</p>
            <small class="fin-sub">{{ e.recorded_by_name ?? 'unknown' }} · {{ formatDate(e.recorded_at) }}</small>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<style scoped>
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); }
.fin-filter { max-width: 14rem; }
/* The ward filter is a picker, not an input: it needs room for "ZW170401 — Vungu Ward 4". */
.fin-filter-ward { max-width: 18rem; }
/* A budget row can carry five acts — edit, submit, approve, return, revise, explain — and an
   auto-layout table will squeeze the last column until their labels are cut off mid-word rather
   than let the table scroll. Claiming a floor for the column makes the table scroll instead, which
   is the behaviour a wide finance table wants anyway. */
.fin-row-actions { display: flex; gap: 4px; flex-wrap: wrap; min-width: 10.5rem; }
.fin-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.fin-sub-head { margin: var(--ent-s4) 0 var(--ent-s2); font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); color: var(--ent-text); display: flex; align-items: baseline; gap: var(--ent-s2); }
.fin-loading { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.fin-pager { display: flex; align-items: center; justify-content: center; gap: var(--ent-s3); margin-top: var(--ent-s3); font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.fin-fault { margin: 4px 0 0; display: flex; align-items: center; gap: 4px; font-size: var(--ent-fs-micro); color: var(--ent-warning); }
.fin-asat { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.fin-notes { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--ent-s2); }
.fin-notes li { padding: var(--ent-s2) var(--ent-s3); border-left: 2px solid var(--ent-line-strong); background: var(--ent-surface-2); }
.fin-notes p { margin: 0; font-size: var(--ent-fs-sm); }
.fin-ccy-note { display: flex; align-items: flex-start; gap: var(--ent-s2); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
