<script setup lang="ts">
/**
 * Departments (votes), programmes, activities, and the chart of accounts.
 *
 * THE CHART OF ACCOUNTS IS THE PART THAT MATTERS
 * Every account carries `kind` — revenue or expenditure — and it is SET BY THE COUNCIL, account by
 * account. The reference implementation this work drew on inferred it from the numeric range of
 * the code (`item < 5000` is income, 5000–8000 expenditure, a Czech accounting convention). That
 * is a local convention masquerading as a rule and it is wrong for Zimbabwe, so this screen makes
 * the classification an explicit, required choice and the paste-in loader demands it on every row.
 *
 * An import citing a code that is not here lands in the exception queue. It is never guessed at,
 * and it is never posted to a catch-all account.
 *
 * RECLASSIFYING AN ACCOUNT THAT CARRIES HISTORY IS REFUSED, by the server, and reported back in
 * `refused` with the number of transactions already posted. Changing it would restate what the
 * council has already reported; that needs a decision and a new account, not an edit.
 *
 * WHAT CAN BE CHANGED, AND WHAT CANNOT
 * A classification is not a static list: departments are renamed, votes are renumbered, a
 * programme ends, an account becomes a heading. Each row is therefore editable in place — but only
 * in the fields that do not rewrite history:
 *
 *   code      never, on any of the four. Imports match on it and reports cite it, so changing a
 *             code would silently re-point every figure that was ever recorded against it.
 *   kind      never, on an account. See above: that is a restatement, not an edit.
 *   name      always. A renamed department is the same vote.
 *   status    always. `inactive` retires a classification from new entry while every figure
 *             already recorded against it stays readable — which is what a council needs when a
 *             department is wound up mid-year.
 *
 * A DEPARTMENT IS NEVER REMOVED once anything has been posted to it. "Withdraw" asks the server,
 * which retires the vote instead of deleting it where budget lines or transactions reference it,
 * and says so.
 */
import { computed, onMounted, ref } from 'vue'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { financeApi } from '../../api/financeApi'
import type { Account, Activity, Department, Programme } from '../../models/types'
import { useFinancePrompt } from '../../composables/useFinancePrompt'
import FinanceGuard from '../../components/FinanceGuard.vue'
import FinancePromptDialog from '../../components/FinancePromptDialog.vue'
import {
  AlertTriangle, CheckCircle2, Plus, RefreshCw, Info, Upload, Network, Wallet, Layers,
  Pencil, Check, X, Archive, ListTree,
} from 'lucide-vue-next'

const store = useFinanceStore()
const prompt = useFinancePrompt()

type Tab = 'departments' | 'programmes' | 'activities' | 'accounts'
/** A workspace page opens the screen on one tab (the console opens the first). */
const props = defineProps<{ initialTab?: Tab }>()
const tab = ref<Tab>(props.initialTab ?? 'departments')

const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref(false)

// There is no `canManage` here on purpose for the FORMS: every one of them is wrapped in
// FinanceGuard, which reads the same permission from the store. A second copy of the decision in
// this file is a second thing to forget to update. The row-level Edit buttons do read it, because
// a guard cannot wrap a single table cell without breaking the row.
const canManage = computed(() => store.can('finance.config.manage'))

// ── Departments ───────────────────────────────────────────────────────────────────────────────
const deptForm = ref({ code: '', name: '', vote_number: '' })
async function addDepartment(): Promise<void> {
  error.value = null; note.value = null
  if (!deptForm.value.code.trim() || !deptForm.value.name.trim()) {
    error.value = 'A code and a name are required.'
    return
  }
  busy.value = true
  try {
    const d = await financeApi.createDepartment({
      code: deptForm.value.code.trim(),
      name: deptForm.value.name.trim(),
      vote_number: deptForm.value.vote_number ? Number(deptForm.value.vote_number) : undefined,
    })
    await store.refreshDepartments()
    note.value = `${d.code} ${d.name} added.`
    deptForm.value = { code: '', name: '', vote_number: '' }
  } catch (err) {
    error.value = messageOf(err, 'The department could not be added.')
  } finally { busy.value = false }
}

/** The department being edited in place, held as a draft so Cancel really cancels. */
const deptEdit = ref<{ id: string; name: string; vote_number: string; status: 'active' | 'inactive' } | null>(null)

function startDeptEdit(d: Department): void {
  error.value = null; note.value = null
  deptEdit.value = { id: d.id, name: d.name, vote_number: d.vote_number === null ? '' : String(d.vote_number), status: d.status }
}

async function saveDept(): Promise<void> {
  const draft = deptEdit.value
  if (!draft) return
  error.value = null; note.value = null
  if (!draft.name.trim()) { error.value = 'A department needs a name.'; return }
  busy.value = true
  try {
    await financeApi.updateDepartment(draft.id, {
      name: draft.name.trim(),
      vote_number: draft.vote_number === '' ? undefined : Number(draft.vote_number),
      status: draft.status,
    })
    await store.refreshDepartments()
    note.value = 'Department updated.'
    deptEdit.value = null
  } catch (err) {
    error.value = messageOf(err, 'The department could not be updated.')
  } finally { busy.value = false }
}

async function withdrawDepartment(d: Department): Promise<void> {
  error.value = null; note.value = null
  const confirmed = await prompt.ask({
    title: `Withdraw ${d.code} ${d.name}`,
    message: 'A vote that carries budget lines or transactions is retired rather than removed, so '
      + 'every figure recorded against it stays readable. Type the code to confirm.',
    label: `Type ${d.code} to confirm`,
    submitLabel: 'Withdraw the vote',
    danger: true,
  })
  if (!confirmed) return
  if (confirmed.trim().toUpperCase() !== d.code.toUpperCase()) {
    error.value = 'The code did not match, so nothing was changed.'
    return
  }
  busy.value = true
  try {
    const result = await financeApi.deleteDepartment(d.id)
    await store.refreshDepartments()
    note.value = result.retired_instead_of_deleted
      ? `${d.code} was retired rather than removed. ${result.reason ?? ''} It accepts no new entry; its figures stay readable.`
      : `${d.code} withdrawn. Nothing had been posted against it.`
  } catch (err) {
    error.value = messageOf(err, 'The department could not be withdrawn.')
  } finally { busy.value = false }
}

// ── Programmes ────────────────────────────────────────────────────────────────────────────────
const programmes = ref<Programme[]>([])
const progForm = ref({ code: '', name: '', department_id: '', description: '' })
async function loadProgrammes(): Promise<void> {
  try { programmes.value = await financeApi.programmes() } catch { /* shown by the empty state */ }
}
async function addProgramme(): Promise<void> {
  error.value = null; note.value = null
  if (!progForm.value.code.trim() || !progForm.value.name.trim() || !progForm.value.department_id) {
    error.value = 'A code, a name and the department it belongs to are required.'
    return
  }
  busy.value = true
  try {
    await financeApi.createProgramme({
      code: progForm.value.code.trim(), name: progForm.value.name.trim(),
      department_id: progForm.value.department_id,
      description: progForm.value.description.trim() || undefined,
    })
    await loadProgrammes()
    note.value = 'Programme added.'
    progForm.value = { code: '', name: '', department_id: '', description: '' }
  } catch (err) {
    error.value = messageOf(err, 'The programme could not be added.')
  } finally { busy.value = false }
}

const progEdit = ref<{ id: string; name: string; description: string; status: 'active' | 'inactive' } | null>(null)

function startProgEdit(p: Programme): void {
  error.value = null; note.value = null
  progEdit.value = { id: p.id, name: p.name, description: p.description ?? '', status: p.status }
}

async function saveProg(): Promise<void> {
  const draft = progEdit.value
  if (!draft) return
  error.value = null; note.value = null
  if (!draft.name.trim()) { error.value = 'A programme needs a name.'; return }
  busy.value = true
  try {
    await financeApi.updateProgramme(draft.id, {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      status: draft.status,
    })
    await loadProgrammes()
    note.value = 'Programme updated.'
    progEdit.value = null
  } catch (err) {
    error.value = messageOf(err, 'The programme could not be updated.')
  } finally { busy.value = false }
}

// ── Activities ────────────────────────────────────────────────────────────────────────────────
/**
 * The level below a programme. Optional, like programmes: a budget line needs a department and an
 * account, and carries a programme and an activity only where the council classifies that far.
 * Imports match on activity_code, so a council whose source exports carry one needs the codes to
 * exist here or those rows go to the exception queue.
 */
const activities = ref<Activity[]>([])
const activityProgramme = ref('')
const actForm = ref({ code: '', name: '', programme_id: '' })

async function loadActivities(): Promise<void> {
  try {
    activities.value = await financeApi.activities(activityProgramme.value || undefined)
  } catch { /* shown by the empty state */ }
}

async function addActivity(): Promise<void> {
  error.value = null; note.value = null
  if (!actForm.value.code.trim() || !actForm.value.name.trim() || !actForm.value.programme_id) {
    error.value = 'A code, a name and the programme it belongs to are required.'
    return
  }
  busy.value = true
  try {
    await financeApi.createActivity({
      code: actForm.value.code.trim(),
      name: actForm.value.name.trim(),
      programme_id: actForm.value.programme_id,
    })
    await loadActivities()
    note.value = 'Activity added.'
    actForm.value = { code: '', name: '', programme_id: actForm.value.programme_id }
  } catch (err) {
    error.value = messageOf(err, 'The activity could not be added.')
  } finally { busy.value = false }
}

const actEdit = ref<{ id: string; name: string; status: 'active' | 'inactive' } | null>(null)

function startActEdit(a: Activity): void {
  error.value = null; note.value = null
  actEdit.value = { id: a.id, name: a.name, status: a.status }
}

async function saveAct(): Promise<void> {
  const draft = actEdit.value
  if (!draft) return
  error.value = null; note.value = null
  if (!draft.name.trim()) { error.value = 'An activity needs a name.'; return }
  busy.value = true
  try {
    await financeApi.updateActivity(draft.id, { name: draft.name.trim(), status: draft.status })
    await loadActivities()
    note.value = 'Activity updated.'
    actEdit.value = null
  } catch (err) {
    error.value = messageOf(err, 'The activity could not be updated.')
  } finally { busy.value = false }
}

const programmeName = (id: string): string => programmes.value.find((p) => p.id === id)?.name ?? '—'

// ── Accounts ──────────────────────────────────────────────────────────────────────────────────
const accountFilter = ref<'' | 'revenue' | 'expenditure'>('')
const accountSearch = ref('')
const acctForm = ref<{
  code: string; name: string; kind: '' | 'revenue' | 'expenditure'
  revenue_class: string; expenditure_class: string; is_postable: boolean
}>({ code: '', name: '', kind: '', revenue_class: '', expenditure_class: '', is_postable: true })

async function addAccount(): Promise<void> {
  error.value = null; note.value = null
  if (!acctForm.value.code.trim() || !acctForm.value.name.trim() || !acctForm.value.kind) {
    error.value = 'A code, a name and the classification (revenue or expenditure) are all required.'
    return
  }
  busy.value = true
  try {
    await financeApi.createAccount({
      code: acctForm.value.code.trim(),
      name: acctForm.value.name.trim(),
      kind: acctForm.value.kind,
      revenue_class: acctForm.value.kind === 'revenue' ? (acctForm.value.revenue_class || undefined) : undefined,
      expenditure_class: acctForm.value.kind === 'expenditure' ? (acctForm.value.expenditure_class || undefined) : undefined,
      is_postable: acctForm.value.is_postable,
    })
    await store.refreshAccounts()
    note.value = 'Account added to the chart.'
    acctForm.value = { code: '', name: '', kind: '', revenue_class: '', expenditure_class: '', is_postable: true }
  } catch (err) {
    error.value = messageOf(err, 'The account could not be added.')
  } finally { busy.value = false }
}

const acctEdit = ref<{
  id: string; kind: Account['kind']; name: string
  revenue_class: string; expenditure_class: string
  is_postable: boolean; status: 'active' | 'inactive'
} | null>(null)

function startAcctEdit(a: Account): void {
  error.value = null; note.value = null
  acctEdit.value = {
    id: a.id, kind: a.kind, name: a.name,
    revenue_class: a.revenue_class ?? '', expenditure_class: a.expenditure_class ?? '',
    is_postable: a.is_postable, status: a.status,
  }
}

async function saveAcct(): Promise<void> {
  const draft = acctEdit.value
  if (!draft) return
  error.value = null; note.value = null
  if (!draft.name.trim()) { error.value = 'An account needs a name.'; return }
  busy.value = true
  try {
    await financeApi.updateAccount(draft.id, {
      name: draft.name.trim(),
      // Only the class belonging to this account's side is sent. `kind` is not sent at all: the
      // server does not accept it, deliberately.
      ...(draft.kind === 'revenue'
        ? { revenue_class: (draft.revenue_class || undefined) as Account['revenue_class'] }
        : { expenditure_class: (draft.expenditure_class || undefined) as Account['expenditure_class'] }),
      is_postable: draft.is_postable,
      status: draft.status,
    })
    await store.refreshAccounts()
    note.value = 'Account updated. Its revenue/expenditure classification is unchanged — that is not an edit.'
    acctEdit.value = null
  } catch (err) {
    error.value = messageOf(err, 'The account could not be updated.')
  } finally { busy.value = false }
}

// Paste-in loader: a council supplies its chart as a list, not one account at a time.
const bulkText = ref('')
const bulkResult = ref<{ created: number; updated: number; refused: Array<{ code: string; reason: string; detail: string }> } | null>(null)

async function loadChart(): Promise<void> {
  error.value = null; note.value = null; bulkResult.value = null
  const lines = bulkText.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) { error.value = 'Paste the chart first, one account per line.'; return }

  const accounts: Array<Record<string, unknown>> = []
  const bad: string[] = []
  lines.forEach((line, i) => {
    // code,name,kind[,class]  — kind is required on every row, deliberately.
    const parts = line.split(',').map((p) => p.trim())
    const [code, name, kind, klass] = parts
    if (!code || !name || (kind !== 'revenue' && kind !== 'expenditure')) {
      bad.push(`Line ${i + 1}: needs code, name and either "revenue" or "expenditure".`)
      return
    }
    const row: Record<string, unknown> = { code, name, kind }
    if (klass) {
      if (kind === 'revenue') row.revenue_class = klass
      else row.expenditure_class = klass
    }
    accounts.push(row)
  })
  if (bad.length) {
    error.value = `${bad.length} line(s) could not be read, so nothing was loaded. ${bad.slice(0, 3).join(' ')}`
    return
  }

  busy.value = true
  try {
    bulkResult.value = await financeApi.loadChartOfAccounts(accounts)
    await store.refreshAccounts()
    note.value = `${bulkResult.value.created} account(s) created, ${bulkResult.value.updated} updated.`
    if (bulkResult.value.refused.length === 0) bulkText.value = ''
  } catch (err) {
    error.value = messageOf(err, 'The chart could not be loaded. Nothing was changed.')
  } finally { busy.value = false }
}

const visibleAccounts = computed<Account[]>(() => {
  const q = accountSearch.value.trim().toLowerCase()
  return store.accounts.filter((a) => {
    if (accountFilter.value && a.kind !== accountFilter.value) return false
    if (!q) return true
    return a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
  })
})

const departmentName = (id: string): string => store.departmentById.get(id)?.name ?? '—'

onMounted(() => { void loadProgrammes(); void loadActivities() })
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

    <div class="ins-seg" role="tablist" aria-label="Classification">
      <button type="button" role="tab" :aria-selected="tab === 'departments'"
              :class="{ 'is-on': tab === 'departments' }" @click="tab = 'departments'">
        <Network :size="14" aria-hidden="true" /> Departments ({{ store.departments.length }})
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'programmes'"
              :class="{ 'is-on': tab === 'programmes' }" @click="tab = 'programmes'">
        <Layers :size="14" aria-hidden="true" /> Programmes ({{ programmes.length }})
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'activities'"
              :class="{ 'is-on': tab === 'activities' }" @click="tab = 'activities'">
        <ListTree :size="14" aria-hidden="true" /> Activities ({{ activities.length }})
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'accounts'"
              :class="{ 'is-on': tab === 'accounts' }" @click="tab = 'accounts'">
        <Wallet :size="14" aria-hidden="true" /> Chart of accounts ({{ store.accounts.length }})
      </button>
    </div>

    <!-- ── Departments ─────────────────────────────────────────────────────────────────────── -->
    <section v-if="tab === 'departments'" class="ins-card">
      <div class="ins-card-head">
        <h3>Departments (votes) <span class="ins-count">{{ store.departments.length }}</span></h3>
        <button type="button" class="fin-btn small" @click="store.refreshDepartments()">
          <RefreshCw :size="13" aria-hidden="true" /> Refresh
        </button>
      </div>
      <div class="ins-card-body">
        <p class="fin-ccy-note" style="margin-top: 0">
          <Info :size="14" aria-hidden="true" />
          The vote is which arm of the council spends or collects. The code is what source exports
          carry and what imports match on, so it must be the council's own code — not a tidied
          version of it, and it cannot be changed once records cite it.
        </p>

        <div v-if="store.departments.length === 0" class="fin-empty">
          <strong>No departments have been entered.</strong>
          <p>Budget lines, transactions and projects all belong to a department, so this comes first.</p>
        </div>

        <div v-else class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr>
                <th scope="col">Code</th><th scope="col">Department</th>
                <th scope="col" class="num">Vote no.</th><th scope="col">Head</th><th scope="col">State</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in store.departments" :key="d.id">
                <td class="ins-mono emphasis">{{ d.code }}</td>
                <td>
                  <input v-if="deptEdit?.id === d.id" v-model="deptEdit.name" class="ins-input"
                         maxlength="300" :aria-label="`Name of ${d.code}`" />
                  <template v-else>{{ d.name }}</template>
                </td>
                <td class="num">
                  <input v-if="deptEdit?.id === d.id" v-model="deptEdit.vote_number" class="ins-input fin-num-input"
                         type="number" min="0" max="99999" :aria-label="`Vote number of ${d.code}`" />
                  <template v-else>{{ d.vote_number ?? '—' }}</template>
                </td>
                <td>{{ d.head_name ?? '—' }}</td>
                <td>
                  <select v-if="deptEdit?.id === d.id" v-model="deptEdit.status" class="ins-input"
                          :aria-label="`State of ${d.code}`">
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                  <span v-else class="fin-pill" :class="d.status === 'active' ? 'tone-positive' : ''">{{ d.status }}</span>
                </td>
                <td>
                  <div class="fin-row-actions">
                    <template v-if="deptEdit?.id === d.id">
                      <button type="button" class="fin-btn small primary" :disabled="busy" @click="saveDept">
                        <Check :size="12" aria-hidden="true" /> Save
                      </button>
                      <button type="button" class="fin-btn small" @click="deptEdit = null">
                        <X :size="12" aria-hidden="true" /> Cancel
                      </button>
                    </template>
                    <template v-else-if="canManage">
                      <button type="button" class="fin-btn small" @click="startDeptEdit(d)">
                        <Pencil :size="12" aria-hidden="true" /> Edit
                      </button>
                      <button type="button" class="fin-btn small danger" :disabled="busy"
                              @click="withdrawDepartment(d)">
                        <Archive :size="12" aria-hidden="true" /> Withdraw
                      </button>
                    </template>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <FinanceGuard requires="finance.config.manage" surface="Adding a department">
          <form class="fin-inline-form" @submit.prevent="addDepartment">
            <div class="ins-field">
              <label class="ins-label" for="d-code">Code</label>
              <input id="d-code" v-model="deptForm.code" class="ins-input" maxlength="60" required />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="d-name">Name</label>
              <input id="d-name" v-model="deptForm.name" class="ins-input" maxlength="300" required />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="d-vote">Vote number</label>
              <input id="d-vote" v-model="deptForm.vote_number" class="ins-input" type="number" min="0" />
            </div>
            <button type="submit" class="fin-btn primary" :disabled="busy">
              <Plus :size="14" aria-hidden="true" /> Add
            </button>
          </form>
        </FinanceGuard>
      </div>
    </section>

    <!-- ── Programmes ──────────────────────────────────────────────────────────────────────── -->
    <section v-if="tab === 'programmes'" class="ins-card">
      <div class="ins-card-head">
        <h3>Programmes <span class="ins-count">{{ programmes.length }}</span></h3>
        <button type="button" class="fin-btn small" @click="loadProgrammes()">
          <RefreshCw :size="13" aria-hidden="true" /> Refresh
        </button>
      </div>
      <div class="ins-card-body">
        <div v-if="programmes.length === 0" class="fin-empty">
          <strong>No programmes have been entered.</strong>
          <p>
            Programmes are optional: a budget line needs a department and an account, and may
            carry a programme and an activity where the council classifies that far.
          </p>
        </div>

        <div v-else class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr>
                <th scope="col">Code</th><th scope="col">Programme</th><th scope="col">Department</th>
                <th scope="col">State</th><th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in programmes" :key="p.id">
                <td class="ins-mono emphasis">{{ p.code }}</td>
                <td>
                  <template v-if="progEdit?.id === p.id">
                    <input v-model="progEdit.name" class="ins-input" maxlength="300"
                           :aria-label="`Name of ${p.code}`" />
                    <input v-model="progEdit.description" class="ins-input fin-stacked" maxlength="2000"
                           placeholder="Description" :aria-label="`Description of ${p.code}`" />
                  </template>
                  <template v-else>
                    {{ p.name }}<br /><small class="fin-sub">{{ p.description }}</small>
                  </template>
                </td>
                <td>{{ departmentName(p.department_id) }}</td>
                <td>
                  <select v-if="progEdit?.id === p.id" v-model="progEdit.status" class="ins-input"
                          :aria-label="`State of ${p.code}`">
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                  <span v-else class="fin-pill" :class="p.status === 'active' ? 'tone-positive' : ''">{{ p.status }}</span>
                </td>
                <td>
                  <div class="fin-row-actions">
                    <template v-if="progEdit?.id === p.id">
                      <button type="button" class="fin-btn small primary" :disabled="busy" @click="saveProg">
                        <Check :size="12" aria-hidden="true" /> Save
                      </button>
                      <button type="button" class="fin-btn small" @click="progEdit = null">
                        <X :size="12" aria-hidden="true" /> Cancel
                      </button>
                    </template>
                    <button v-else-if="canManage" type="button" class="fin-btn small" @click="startProgEdit(p)">
                      <Pencil :size="12" aria-hidden="true" /> Edit
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <FinanceGuard requires="finance.config.manage" surface="Adding a programme">
          <form class="fin-inline-form" @submit.prevent="addProgramme">
            <div class="ins-field">
              <label class="ins-label" for="p-code">Code</label>
              <input id="p-code" v-model="progForm.code" class="ins-input" maxlength="60" required />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="p-name">Name</label>
              <input id="p-name" v-model="progForm.name" class="ins-input" maxlength="300" required />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="p-dept">Department</label>
              <select id="p-dept" v-model="progForm.department_id" class="ins-input" required>
                <option value="">Choose…</option>
                <option v-for="d in store.activeDepartments" :key="d.id" :value="d.id">{{ d.code }} {{ d.name }}</option>
              </select>
            </div>
            <button type="submit" class="fin-btn primary" :disabled="busy">
              <Plus :size="14" aria-hidden="true" /> Add
            </button>
          </form>
        </FinanceGuard>
      </div>
    </section>

    <!-- ── Activities ──────────────────────────────────────────────────────────────────────── -->
    <section v-if="tab === 'activities'" class="ins-card">
      <div class="ins-card-head">
        <h3>Activities <span class="ins-count">{{ activities.length }}</span></h3>
        <button type="button" class="fin-btn small" @click="loadActivities()">
          <RefreshCw :size="13" aria-hidden="true" /> Refresh
        </button>
      </div>
      <div class="ins-card-body">
        <p class="fin-ccy-note" style="margin-top: 0">
          <Info :size="14" aria-hidden="true" />
          The level below a programme, and the last optional one. A council whose source exports
          carry an activity code needs those codes here: an import citing one that does not exist
          goes to the exception queue rather than being posted without it.
        </p>

        <div class="fin-bar">
          <div class="ins-field fin-filter">
            <label class="ins-label" for="act-filter">Programme</label>
            <select id="act-filter" v-model="activityProgramme" class="ins-input" @change="loadActivities()">
              <option value="">All programmes</option>
              <option v-for="p in programmes" :key="p.id" :value="p.id">{{ p.code }} {{ p.name }}</option>
            </select>
          </div>
        </div>

        <div v-if="programmes.length === 0" class="fin-empty">
          <strong>There are no programmes yet.</strong>
          <p>An activity belongs to a programme, so the programme comes first.</p>
        </div>

        <div v-else-if="activities.length === 0" class="fin-empty">
          <strong>No activities have been entered.</strong>
          <p>
            Activities are optional. Enter them only if the council's budget and its source exports
            classify to that level.
          </p>
        </div>

        <div v-else class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr>
                <th scope="col">Code</th><th scope="col">Activity</th><th scope="col">Programme</th>
                <th scope="col">State</th><th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in activities" :key="a.id">
                <td class="ins-mono emphasis">{{ a.code }}</td>
                <td>
                  <input v-if="actEdit?.id === a.id" v-model="actEdit.name" class="ins-input"
                         maxlength="300" :aria-label="`Name of ${a.code}`" />
                  <template v-else>{{ a.name }}</template>
                </td>
                <td>{{ programmeName(a.programme_id) }}</td>
                <td>
                  <select v-if="actEdit?.id === a.id" v-model="actEdit.status" class="ins-input"
                          :aria-label="`State of ${a.code}`">
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                  <span v-else class="fin-pill" :class="a.status === 'active' ? 'tone-positive' : ''">{{ a.status }}</span>
                </td>
                <td>
                  <div class="fin-row-actions">
                    <template v-if="actEdit?.id === a.id">
                      <button type="button" class="fin-btn small primary" :disabled="busy" @click="saveAct">
                        <Check :size="12" aria-hidden="true" /> Save
                      </button>
                      <button type="button" class="fin-btn small" @click="actEdit = null">
                        <X :size="12" aria-hidden="true" /> Cancel
                      </button>
                    </template>
                    <button v-else-if="canManage" type="button" class="fin-btn small" @click="startActEdit(a)">
                      <Pencil :size="12" aria-hidden="true" /> Edit
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <FinanceGuard v-if="programmes.length > 0" requires="finance.config.manage" surface="Adding an activity">
          <form class="fin-inline-form" @submit.prevent="addActivity">
            <div class="ins-field">
              <label class="ins-label" for="a-act-code">Code</label>
              <input id="a-act-code" v-model="actForm.code" class="ins-input" maxlength="60" required />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="a-act-name">Name</label>
              <input id="a-act-name" v-model="actForm.name" class="ins-input" maxlength="300" required />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="a-act-prog">Programme</label>
              <select id="a-act-prog" v-model="actForm.programme_id" class="ins-input" required>
                <option value="">Choose…</option>
                <option v-for="p in programmes" :key="p.id" :value="p.id">{{ p.code }} {{ p.name }}</option>
              </select>
            </div>
            <button type="submit" class="fin-btn primary" :disabled="busy">
              <Plus :size="14" aria-hidden="true" /> Add
            </button>
          </form>
        </FinanceGuard>
      </div>
    </section>

    <!-- ── Chart of accounts ───────────────────────────────────────────────────────────────── -->
    <section v-if="tab === 'accounts'" class="ins-card">
      <div class="ins-card-head">
        <h3>Chart of accounts <span class="ins-count">{{ visibleAccounts.length }} of {{ store.accounts.length }}</span></h3>
        <button type="button" class="fin-btn small" @click="store.refreshAccounts()">
          <RefreshCw :size="13" aria-hidden="true" /> Refresh
        </button>
      </div>
      <div class="ins-card-body">
        <p class="fin-ccy-note" style="margin-top: 0">
          <Info :size="14" aria-hidden="true" />
          Whether an account is revenue or expenditure is recorded here, per account, from the
          Council-approved chart. Nothing in this system infers it from the shape of the code, and a
          code that is not in this chart cannot be imported against — such a row goes to the
          exception queue instead.
        </p>

        <div class="fin-bar">
          <label class="ins-search">
            <input v-model="accountSearch" class="ins-input" type="search" placeholder="Search code or name" />
          </label>
          <div class="ins-seg">
            <button type="button" :class="{ 'is-on': accountFilter === '' }" @click="accountFilter = ''">All</button>
            <button type="button" :class="{ 'is-on': accountFilter === 'revenue' }" @click="accountFilter = 'revenue'">Revenue</button>
            <button type="button" :class="{ 'is-on': accountFilter === 'expenditure' }" @click="accountFilter = 'expenditure'">Expenditure</button>
          </div>
        </div>

        <div v-if="store.accounts.length === 0" class="fin-empty">
          <strong>The chart of accounts is empty.</strong>
          <p>
            Nothing can be budgeted or imported until the Council's approved chart is loaded, and
            no default chart is supplied: a plausible-looking placeholder chart would mislabel a
            whole budget.
          </p>
        </div>

        <div v-else class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr>
                <th scope="col">Code</th><th scope="col">Account</th><th scope="col">Classification</th>
                <th scope="col">Category</th><th scope="col">Postable</th><th scope="col">State</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in visibleAccounts" :key="a.id">
                <td class="ins-mono emphasis">{{ a.code }}</td>
                <td>
                  <input v-if="acctEdit?.id === a.id" v-model="acctEdit.name" class="ins-input"
                         maxlength="300" :aria-label="`Name of ${a.code}`" />
                  <template v-else>
                    {{ a.name }}<br v-if="a.parent_code" /><small v-if="a.parent_code" class="fin-sub">under {{ a.parent_code }}</small>
                  </template>
                </td>
                <td>
                  <span class="fin-pill" :class="a.kind === 'revenue' ? 'tone-positive' : 'tone-info'">{{ a.kind }}</span>
                  <small v-if="acctEdit?.id === a.id" class="fin-sub fin-stacked">fixed</small>
                </td>
                <td>
                  <template v-if="acctEdit?.id === a.id">
                    <select v-if="acctEdit.kind === 'revenue'" v-model="acctEdit.revenue_class" class="ins-input"
                            :aria-label="`Funding category of ${a.code}`">
                      <option value="">Not stated</option>
                      <option value="internally_generated">Internally generated</option>
                      <option value="grant">Grant</option>
                      <option value="transfer">Transfer</option>
                      <option value="other">Other</option>
                    </select>
                    <select v-else v-model="acctEdit.expenditure_class" class="ins-input"
                            :aria-label="`Expenditure category of ${a.code}`">
                      <option value="">Not stated</option>
                      <option value="recurrent">Recurrent</option>
                      <option value="capital">Capital</option>
                    </select>
                  </template>
                  <template v-else>{{ (a.revenue_class ?? a.expenditure_class ?? '—').replace(/_/g, ' ') }}</template>
                </td>
                <td>
                  <label v-if="acctEdit?.id === a.id" class="ins-check">
                    <input v-model="acctEdit.is_postable" type="checkbox" />
                    <span class="sr-only">Transactions may be posted to {{ a.code }}</span>
                  </label>
                  <template v-else>{{ a.is_postable ? 'Yes' : 'Heading only' }}</template>
                </td>
                <td>
                  <select v-if="acctEdit?.id === a.id" v-model="acctEdit.status" class="ins-input"
                          :aria-label="`State of ${a.code}`">
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                  <span v-else class="fin-pill" :class="a.status === 'active' ? 'tone-positive' : ''">{{ a.status }}</span>
                </td>
                <td>
                  <div class="fin-row-actions">
                    <template v-if="acctEdit?.id === a.id">
                      <button type="button" class="fin-btn small primary" :disabled="busy" @click="saveAcct">
                        <Check :size="12" aria-hidden="true" /> Save
                      </button>
                      <button type="button" class="fin-btn small" @click="acctEdit = null">
                        <X :size="12" aria-hidden="true" /> Cancel
                      </button>
                    </template>
                    <button v-else-if="canManage" type="button" class="fin-btn small" @click="startAcctEdit(a)">
                      <Pencil :size="12" aria-hidden="true" /> Edit
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <FinanceGuard requires="finance.config.manage" surface="Editing the chart of accounts">
          <form class="fin-inline-form wide" @submit.prevent="addAccount">
            <div class="ins-field">
              <label class="ins-label" for="a-code">Code</label>
              <input id="a-code" v-model="acctForm.code" class="ins-input" maxlength="60" required />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="a-name">Name</label>
              <input id="a-name" v-model="acctForm.name" class="ins-input" maxlength="300" required />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="a-kind">Revenue or expenditure</label>
              <select id="a-kind" v-model="acctForm.kind" class="ins-input" required>
                <option value="">Choose — required</option>
                <option value="revenue">Revenue</option>
                <option value="expenditure">Expenditure</option>
              </select>
            </div>
            <div v-if="acctForm.kind === 'revenue'" class="ins-field">
              <label class="ins-label" for="a-rclass">Funding category</label>
              <select id="a-rclass" v-model="acctForm.revenue_class" class="ins-input">
                <option value="">Not stated</option>
                <option value="internally_generated">Internally generated</option>
                <option value="grant">Grant</option>
                <option value="transfer">Transfer</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div v-if="acctForm.kind === 'expenditure'" class="ins-field">
              <label class="ins-label" for="a-eclass">Expenditure category</label>
              <select id="a-eclass" v-model="acctForm.expenditure_class" class="ins-input">
                <option value="">Not stated</option>
                <option value="recurrent">Recurrent</option>
                <option value="capital">Capital</option>
              </select>
            </div>
            <label class="ins-check">
              <input v-model="acctForm.is_postable" type="checkbox" />
              Transactions may be posted to it
            </label>
            <button type="submit" class="fin-btn primary" :disabled="busy">
              <Plus :size="14" aria-hidden="true" /> Add account
            </button>
          </form>

          <details class="fin-bulk">
            <summary>Load the whole chart at once</summary>
            <p class="ins-hint">
              One account per line: <code>code,name,revenue|expenditure[,category]</code>. The
              classification is required on every line. The whole chart loads in one transaction, so
              a half-loaded chart — which would send half of an import to the exception queue —
              cannot happen.
            </p>
            <textarea v-model="bulkText" class="ins-input" rows="7" spellcheck="false"
                      placeholder="1100,Rates and charges,revenue,internally_generated&#10;1200,Devolution grant,revenue,grant&#10;5100,Roads maintenance,expenditure,recurrent"></textarea>
            <div class="fin-bulk-actions">
              <button type="button" class="fin-btn primary" :disabled="busy" @click="loadChart">
                <Upload :size="14" aria-hidden="true" /> {{ busy ? 'Loading…' : 'Load chart' }}
              </button>
            </div>

            <div v-if="bulkResult" class="fin-bulk-result">
              <p>{{ bulkResult.created }} created, {{ bulkResult.updated }} updated.</p>
              <div v-if="bulkResult.refused.length" class="ins-banner t-warning">
                <AlertTriangle :size="15" aria-hidden="true" />
                <div>
                  <p><strong>{{ bulkResult.refused.length }} account(s) were not changed.</strong></p>
                  <ul>
                    <li v-for="r in bulkResult.refused" :key="r.code">
                      <span class="ins-mono">{{ r.code }}</span> — {{ r.detail }}
                      Reclassifying an account that carries history would restate what the council
                      has already reported; that needs a decision and a new account.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </details>
        </FinanceGuard>
      </div>
    </section>
  </div>
</template>

<style scoped>
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); }
.fin-inline-form {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: var(--ent-s3); align-items: end;
  margin-top: var(--ent-s4); padding-top: var(--ent-s4); border-top: 1px solid var(--ent-line);
}
.fin-inline-form.wide { grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); }
.fin-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.fin-stacked { display: block; margin-top: 4px; }
.fin-num-input { max-width: 6rem; text-align: right; }
.fin-filter { max-width: 18rem; }
.fin-row-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.fin-bulk { margin-top: var(--ent-s4); }
.fin-bulk summary { cursor: pointer; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.fin-bulk textarea { font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); }
.fin-bulk-actions { margin-top: var(--ent-s2); }
.fin-bulk-result { margin-top: var(--ent-s3); font-size: var(--ent-fs-sm); }
.fin-bulk-result ul { margin: var(--ent-s1) 0 0 var(--ent-s4); padding: 0; }
.fin-bulk-result li { margin-bottom: var(--ent-s1); }
.fin-ccy-note { display: flex; align-items: flex-start; gap: var(--ent-s2); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
