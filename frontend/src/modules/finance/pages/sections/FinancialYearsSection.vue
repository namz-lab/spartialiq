<script setup lang="ts">
/**
 * Financial years — the reporting periods everything else hangs on.
 *
 * NOTHING IS SEEDED HERE. The council's financial year dates and its naming convention are a
 * Council decision (D1 in docs/finance/COUNCIL-DECISIONS.md), so this screen is the means of
 * entering them and not a guess at what they are.
 *
 * THE LIFECYCLE IS THE CONTROL
 *   draft    being set up; accepts nothing
 *   open     the only state that accepts budgets, imports or postings
 *   closed   frozen; readable, reportable, exportable, but accepts nothing further
 *   archived closed and withdrawn from routine listings
 *
 * Closing a year is refused while an import batch is still in flight, because committing one
 * afterwards would post into a frozen period. Reopening is possible and demands a written reason,
 * which is kept on the year and in the audit trail — a reopened period is an exceptional event and
 * an auditor should be able to see that it happened and why.
 */
import { computed, ref } from 'vue'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { financeApi } from '../../api/financeApi'
import { formatDate, formatDateTime } from '../../composables/useMoney'
import type { Currency, FinancialYear } from '../../models/types'
import { useFinancePrompt } from '../../composables/useFinancePrompt'
import FinanceGuard from '../../components/FinanceGuard.vue'
import FinancePromptDialog from '../../components/FinancePromptDialog.vue'
import {
  AlertTriangle, CheckCircle2, Plus, Lock, Unlock, PlayCircle, RefreshCw, Info,
  Pencil, Check, X,
} from 'lucide-vue-next'

const store = useFinanceStore()
const prompt = useFinancePrompt()

const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref<string | null>(null)
const showForm = ref(false)

const form = ref<{ label: string; start_date: string; end_date: string; reporting_currency: Currency; notes: string }>({
  label: '', start_date: '', end_date: '', reporting_currency: 'USD', notes: '',
})

const canManage = computed(() => store.can('finance.config.manage'))
const canClose = computed(() => store.can('finance.year.close'))

const stateTone: Record<FinancialYear['status'], string> = {
  draft: 'tone-info', open: 'tone-positive', closed: 'tone-neutral', archived: 'tone-neutral',
}

function resetForm(): void {
  form.value = { label: '', start_date: '', end_date: '', reporting_currency: 'USD', notes: '' }
}

async function create(): Promise<void> {
  error.value = null
  note.value = null
  if (!form.value.label.trim() || !form.value.start_date || !form.value.end_date) {
    error.value = 'A label and both dates are required.'
    return
  }
  busy.value = 'create'
  try {
    const year = await financeApi.createFinancialYear({
      label: form.value.label.trim(),
      start_date: form.value.start_date,
      end_date: form.value.end_date,
      reporting_currency: form.value.reporting_currency,
      notes: form.value.notes.trim() || undefined,
    })
    await store.refreshYears()
    store.selectYear(year.id)
    note.value = `${year.label} created as a draft. Open it when the council is ready to budget against it.`
    showForm.value = false
    resetForm()
  } catch (err) {
    error.value = messageOf(err, 'The financial year could not be created.')
  } finally {
    busy.value = null
  }
}

/**
 * Editing a period, in the two fields that do not move money.
 *
 * The label and the note are presentational; the reporting currency is the default a source row
 * is assumed to be in when its file does not say, so changing it affects what is imported NEXT and
 * nothing already recorded. The DATES are deliberately absent: a period whose start or end moved
 * would silently take transactions into or out of the year they were reported in, which is a
 * restatement and belongs to the Council, not to a text field. The server's PATCH body accepts
 * only these three fields, for the same reason.
 */
const yearEdit = ref<{ id: string; label: string; notes: string; reporting_currency: Currency } | null>(null)

function startEdit(y: FinancialYear): void {
  error.value = null; note.value = null
  yearEdit.value = { id: y.id, label: y.label, notes: y.notes ?? '', reporting_currency: y.reporting_currency }
}

async function saveEdit(): Promise<void> {
  const draft = yearEdit.value
  if (!draft) return
  error.value = null; note.value = null
  if (!draft.label.trim()) { error.value = 'A financial year needs a label.'; return }
  busy.value = draft.id
  try {
    const y = await financeApi.updateFinancialYear(draft.id, {
      label: draft.label.trim(),
      notes: draft.notes.trim() || undefined,
      reporting_currency: draft.reporting_currency,
    })
    await store.refreshYears()
    note.value = `${y.label} updated. Its dates and its records are unchanged.`
    yearEdit.value = null
  } catch (err) {
    error.value = messageOf(err, 'The financial year could not be updated.')
  } finally {
    busy.value = null
  }
}

async function act(id: string, action: 'open' | 'close' | 'reopen'): Promise<void> {
  error.value = null
  note.value = null
  busy.value = id
  try {
    if (action === 'open') {
      const y = await financeApi.openFinancialYear(id)
      note.value = `${y.label} is open. Budgets and imports can now be entered against it.`
    } else if (action === 'close') {
      const reason = await prompt.ask({
        title: 'Close this financial year',
        message: 'A closed year accepts no further financial records.',
        label: 'A note for the record (optional)',
        kind: 'textarea',
        submitLabel: 'Close year',
      })
      if (reason === null) return
      const y = await financeApi.closeFinancialYear(id, reason || undefined)
      note.value = `${y.label} is closed. It accepts no further financial records.`
    } else {
      const reason = await prompt.ask({
        title: 'Reopen a closed period',
        message: 'Reopening is exceptional. The reason is kept on the year and in the audit trail.',
        label: 'Reason for reopening',
        kind: 'textarea',
        minLength: 10,
        submitLabel: 'Reopen',
        danger: true,
      })
      if (!reason) return
      const y = await financeApi.reopenFinancialYear(id, reason)
      note.value = `${y.label} is open again. The reason has been recorded.`
    }
    await store.refreshYears()
  } catch (err) {
    error.value = messageOf(err, 'That could not be done.')
  } finally {
    busy.value = null
  }
}

const sorted = computed(() => [...store.years].sort((a, b) => b.start_date.localeCompare(a.start_date)))
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

    <div class="fin-section-actions">
      <button v-if="canManage" type="button" class="fin-btn primary" @click="showForm = !showForm">
        <Plus :size="14" aria-hidden="true" /> New financial year
      </button>
      <button type="button" class="fin-btn small" @click="store.refreshYears()">
        <RefreshCw :size="13" aria-hidden="true" /> Refresh
      </button>
    </div>

    <FinanceGuard v-if="showForm" requires="finance.config.manage" surface="Creating a financial year">
      <form class="ins-card" @submit.prevent="create">
        <div class="ins-card-head"><h3>New financial year</h3></div>
        <div class="ins-card-body">
          <p class="fin-ccy-note" style="margin-top: 0">
            <Info :size="14" aria-hidden="true" />
            The council's year dates and its naming convention are the Council's to decide. Nothing
            is pre-filled, and a new year starts as a draft: it accepts no records until it is opened.
          </p>
          <div class="ins-form">
            <div class="ins-field">
              <label class="ins-label" for="fy-label">Label</label>
              <input id="fy-label" v-model="form.label" class="ins-input" required maxlength="40"
                     placeholder="e.g. 2026 or 2026/27" />
              <p class="ins-hint">However the council names its years. It must be unique.</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="fy-start">Starts</label>
              <input id="fy-start" v-model="form.start_date" class="ins-input" type="date" required />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="fy-end">Ends</label>
              <input id="fy-end" v-model="form.end_date" class="ins-input" type="date" required />
              <p class="ins-hint">Periods may not overlap: two years covering one day would make "the actuals for this year" ambiguous.</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="fy-ccy">Reporting currency</label>
              <select id="fy-ccy" v-model="form.reporting_currency" class="ins-input">
                <option value="USD">USD — United States dollar</option>
                <option value="ZWG">ZWG — Zimbabwe Gold</option>
              </select>
              <p class="ins-hint">
                The currency a row is assumed to be in when a source file does not say. Both
                currencies can be stored in any year; they are never added together.
              </p>
            </div>
            <div class="ins-field full">
              <label class="ins-label" for="fy-notes">Notes</label>
              <textarea id="fy-notes" v-model="form.notes" class="ins-input" rows="2" maxlength="2000"></textarea>
            </div>
          </div>
        </div>
        <div class="ins-card-foot">
          <button type="button" class="fin-btn" @click="showForm = false; resetForm()">Cancel</button>
          <button type="submit" class="fin-btn primary" :disabled="busy === 'create'">
            {{ busy === 'create' ? 'Creating…' : 'Create as draft' }}
          </button>
        </div>
      </form>
    </FinanceGuard>

    <div v-if="sorted.length === 0" class="fin-empty">
      <strong>No financial year has been created.</strong>
      <p>
        A financial year is the first thing this module needs: budgets, imports, reports and
        publication all hang on one. Its dates and its name are the Council's decision, so nothing
        has been assumed.
      </p>
    </div>

    <div v-else class="ins-card">
      <div class="ins-card-head">
        <h3>Reporting periods <span class="ins-count">{{ sorted.length }}</span></h3>
      </div>
      <div class="ins-card-body">
        <div class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col">Period</th>
                <th scope="col">State</th>
                <th scope="col" class="ccy">Reports in</th>
                <th scope="col" class="num">Budget lines</th>
                <th scope="col" class="num">Transactions</th>
                <th scope="col">Closed</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="y in sorted" :key="y.id">
                <td class="emphasis">
                  <input v-if="yearEdit?.id === y.id" v-model="yearEdit.label" class="ins-input"
                         maxlength="40" :aria-label="`Label of ${y.label}`" />
                  <template v-else>
                    {{ y.label }}
                    <br v-if="y.notes" /><small v-if="y.notes" class="fin-sub">{{ y.notes }}</small>
                  </template>
                </td>
                <td>{{ formatDate(y.start_date) }} — {{ formatDate(y.end_date) }}</td>
                <td><span class="fin-pill" :class="stateTone[y.status]">{{ y.status }}</span></td>
                <td class="ccy">
                  <select v-if="yearEdit?.id === y.id" v-model="yearEdit.reporting_currency" class="ins-input"
                          :aria-label="`Reporting currency of ${y.label}`">
                    <option value="USD">USD</option>
                    <option value="ZWG">ZWG</option>
                  </select>
                  <template v-else>{{ y.reporting_currency }}</template>
                </td>
                <td class="num">{{ y.budget_line_count ?? '—' }}</td>
                <td class="num">{{ y.transaction_count ?? '—' }}</td>
                <td>{{ y.closed_at ? formatDateTime(y.closed_at) : '—' }}</td>
                <td>
                  <div class="fin-row-actions">
                    <template v-if="yearEdit?.id === y.id">
                      <button type="button" class="fin-btn small primary" :disabled="busy === y.id" @click="saveEdit">
                        <Check :size="12" aria-hidden="true" /> Save
                      </button>
                      <button type="button" class="fin-btn small" @click="yearEdit = null">
                        <X :size="12" aria-hidden="true" /> Cancel
                      </button>
                    </template>
                    <button v-else-if="canManage && (y.status === 'draft' || y.status === 'open')"
                            type="button" class="fin-btn small" @click="startEdit(y)">
                      <Pencil :size="13" aria-hidden="true" /> Edit
                    </button>
                    <button v-if="y.status === 'draft' && canManage" type="button" class="fin-btn small"
                            :disabled="busy === y.id" @click="act(y.id, 'open')">
                      <PlayCircle :size="13" aria-hidden="true" /> Open
                    </button>
                    <button v-if="y.status === 'open' && canClose" type="button" class="fin-btn small"
                            :disabled="busy === y.id" @click="act(y.id, 'close')">
                      <Lock :size="13" aria-hidden="true" /> Close
                    </button>
                    <button v-if="y.status === 'closed' && canClose" type="button" class="fin-btn small danger"
                            :disabled="busy === y.id" @click="act(y.id, 'reopen')">
                      <Unlock :size="13" aria-hidden="true" /> Reopen
                    </button>
                    <span v-if="y.status === 'open' && !canClose" class="fin-hint-inline">
                      Closing a period is reserved to the roles holding “Close a financial year”.
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="yearEdit" class="ins-field fin-notes-edit">
          <label class="ins-label" for="fy-edit-notes">Notes on {{ yearEdit.label }}</label>
          <textarea id="fy-edit-notes" v-model="yearEdit.notes" class="ins-input" rows="2" maxlength="2000"></textarea>
          <p class="ins-hint">
            The period's dates are not editable. Moving them would take transactions into or out of
            the year they were reported in; that is a Council decision, not an edit. Clearing this
            box leaves the existing note in place rather than deleting it — only a closed period's
            record is meant to be immutable, and a note is part of the record.
          </p>
        </div>

        <p class="fin-ccy-note">
          A closed year cannot be written to by any route, nor by a direct database statement: the
          refusal is a database trigger, not a check this screen performs.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); }
.fin-section-actions { display: flex; justify-content: flex-end; gap: var(--ent-s2); }
.fin-row-actions { display: flex; gap: var(--ent-s2); flex-wrap: wrap; align-items: center; }
.fin-hint-inline { font-size: var(--ent-fs-micro); color: var(--ent-text-3); max-width: 22ch; line-height: 1.3; }
.fin-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-regular); }
.fin-notes-edit { margin-top: var(--ent-s3); max-width: 42rem; }
.fin-ccy-note { display: flex; align-items: flex-start; gap: var(--ent-s2); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
