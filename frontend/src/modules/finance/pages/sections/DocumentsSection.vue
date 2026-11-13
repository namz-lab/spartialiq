<script setup lang="ts">
/**
 * Supporting documents: the invoice, voucher, contract, statement or approved budget behind a
 * figure.
 *
 * WHY THIS SECTION EXISTS
 * A council officer asked "what is this payment for?" answers with a document, not a number. The
 * backend has carried `finance.document` since migration 188 — upload, per-document authorisation,
 * visibility control and withdrawal — and the only surface that read any of it was the project
 * trace, which could list documents but never add one. So `finance.document.upload` was a
 * permission no screen could exercise, and the specification's §3.8 document association was
 * reachable only through the API.
 *
 * THE THREE CONTROLS, AND WHERE EACH ONE LIVES
 *   1. A document arrives PRIVATE. Nothing on this screen uploads something public.
 *   2. Making one public is a publisher's act with a written reason, through
 *      PATCH /finance/documents/:id/visibility. The reason is required by the server for `public`
 *      and demanded by this screen before the request is sent, so the refusal is legible.
 *   3. Withdrawal is a soft delete. The row and the stored file are retained; the document stops
 *      being listed and stops being served. Finance records are never hard-deleted.
 *
 * A DOCUMENT IS ATTACHED TO A RECORD THAT EXISTS, and the server checks that it does. Rather than
 * ask an officer to paste a UUID, the form resolves the subject from the records already on the
 * system — the year, the line, the revision, the project, the batch, the release. `transaction` is
 * the one kind with no staff-side register to pick from (there is no list endpoint for the actuals
 * register), so it takes the identifier the project trace and the public register both show.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { financeApi } from '../../api/financeApi'
import { formatBytes, formatDateTime, formatMoney } from '../../composables/useMoney'
import { useFinancePrompt } from '../../composables/useFinancePrompt'
import type { FinanceDocument } from '../../models/types'
import FinanceGuard from '../../components/FinanceGuard.vue'
import FinancePromptDialog from '../../components/FinancePromptDialog.vue'
import {
  AlertTriangle, CheckCircle2, RefreshCw, Info, Upload, Download, Trash2,
  Eye, EyeOff, Globe2, Paperclip, Lock,
} from 'lucide-vue-next'

const store = useFinanceStore()
/** A workspace page opens the list on one visibility (Public Disclosures: public). */
const props = defineProps<{ visibility?: 'private' | 'internal' | 'public' }>()
const prompt = useFinancePrompt()

/** The subject kinds the server accepts, with the sentence that says what each one is for. */
const SUBJECT_KINDS = [
  { value: 'financial_year', label: 'Financial year', hint: 'The approved budget book, the audited statements for a period.' },
  { value: 'budget_line', label: 'Budget line', hint: 'The schedule or committee minute behind one allocation.' },
  { value: 'budget_revision', label: 'Budget revision', hint: 'The resolution authorising a supplementary allocation or a reduction.' },
  { value: 'transaction', label: 'Transaction', hint: 'The invoice, voucher or receipt behind one posting.' },
  { value: 'project', label: 'Project', hint: 'The contract, certificate or completion report for a project.' },
  { value: 'import_batch', label: 'Data import', hint: 'The source export as the accounting system produced it.' },
  { value: 'publication', label: 'Publication', hint: 'What was released to the public, as released.' },
  { value: 'report', label: 'Report', hint: 'A generated report kept for the record.' },
] as const

type SubjectKind = typeof SUBJECT_KINDS[number]['value']

/** Visibility, in the words the council uses rather than the column's. */
const VISIBILITY = {
  private: { label: 'Restricted', tone: 'tone-negative', icon: Lock, says: 'Visible only to staff holding the restricted-document permission.' },
  internal: { label: 'Internal', tone: 'tone-info', icon: EyeOff, says: 'Visible to finance staff. Not on the public portal.' },
  public: { label: 'Public', tone: 'tone-positive', icon: Globe2, says: 'On the public portal, while the documents dataset is published.' },
} as const

const documents = ref<FinanceDocument[]>([])
const restrictedVisible = ref(false)
const loading = ref(false)
const busy = ref<string | null>(null)
const error = ref<string | null>(null)
const note = ref<string | null>(null)

const filter = ref<{ subject_kind: '' | SubjectKind; visibility: '' | 'private' | 'internal' | 'public'; q: string }>(
  { subject_kind: '', visibility: props.visibility ?? '', q: '' },
)

const canUpload = computed(() => store.can('finance.document.upload'))
const canSetVisibility = computed(() => store.can('finance.publication.publish'))
// Withdrawing a document is a WRITE, and the backend now gates it on its own write permission
// (migration 200). This used to read `finance.document.view` — a READ permission held by the
// read-only auditor, the publisher and the committee — so the screen offered a destructive
// button to three roles that hold no authority over documents at all.
const canWithdraw = computed(() => store.can('finance.document.withdraw'))

// ── Reading ───────────────────────────────────────────────────────────────────────────────────
async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await financeApi.documents({
      subject_kind: filter.value.subject_kind || undefined,
      visibility: filter.value.visibility || undefined,
    })
    documents.value = result.documents
    restrictedVisible.value = result.restricted_visible
  } catch (err) {
    error.value = messageOf(err, 'The document register could not be read.')
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load(); void loadSubjects() })
watch([() => filter.value.subject_kind, () => filter.value.visibility], load)

/** The filename search is local: the list is already in hand and the endpoint takes no `q`. */
const visible = computed(() => {
  const q = filter.value.q.trim().toLowerCase()
  if (!q) return documents.value
  return documents.value.filter((d) =>
    d.filename.toLowerCase().includes(q) || (d.document_type ?? '').toLowerCase().includes(q))
})

const subjectLabel = (kind: string): string =>
  SUBJECT_KINDS.find((k) => k.value === kind)?.label ?? kind.replace(/_/g, ' ')

// ── The upload form ───────────────────────────────────────────────────────────────────────────
const form = ref<{ subject_kind: SubjectKind; subject_id: string; document_type: string }>(
  { subject_kind: 'financial_year', subject_id: '', document_type: '' },
)
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const progress = ref(0)
const showForm = ref(false)

/**
 * What can be attached to, per kind, read from the records that exist.
 *
 * Loaded once and refreshed with the list, because an officer who has just created a budget line
 * expects to attach its schedule without reloading the console. Each lookup is independent: a
 * council with no projects yet must still be able to attach a document to its year.
 */
const subjects = ref<Record<string, Array<{ id: string; label: string }>>>({})
const subjectsLoading = ref(false)

async function loadSubjects(): Promise<void> {
  subjectsLoading.value = true
  const yearId = store.selectedYearId ?? undefined
  const next: Record<string, Array<{ id: string; label: string }>> = {
    financial_year: store.years.map((y) => ({ id: y.id, label: `${y.label} — ${y.status}` })),
  }
  const settled = await Promise.allSettled([
    yearId ? financeApi.budgetLines({ financial_year_id: yearId, limit: 200 }) : Promise.resolve(null),
    yearId ? financeApi.revisions({ financial_year_id: yearId, limit: 200 }) : Promise.resolve(null),
    financeApi.projects({ limit: 200 }),
    yearId ? financeApi.imports({ financial_year_id: yearId, limit: 100 }) : Promise.resolve(null),
    yearId ? financeApi.publications({ financial_year_id: yearId }) : Promise.resolve(null),
  ])
  if (settled[0].status === 'fulfilled' && settled[0].value) {
    next.budget_line = settled[0].value.lines.map((l) => ({
      id: l.budget_line_id,
      label: `${l.code} — ${l.description} (${formatMoney(l.revised_amount, l.currency, { bare: true })} ${l.currency})`,
    }))
  }
  if (settled[1].status === 'fulfilled' && settled[1].value) {
    next.budget_revision = settled[1].value.map((r) => ({
      id: r.id,
      label: `${r.budget_line_code ?? 'revision'} no. ${r.revision_no} — ${r.state}`,
    }))
  }
  if (settled[2].status === 'fulfilled' && settled[2].value) {
    next.project = settled[2].value.map((p) => ({ id: p.project_id, label: `${p.reference} — ${p.name}` }))
  }
  if (settled[3].status === 'fulfilled' && settled[3].value) {
    next.import_batch = settled[3].value.map((b) => ({
      id: b.id, label: `${b.original_filename} — ${b.dataset}, ${b.status}`,
    }))
  }
  if (settled[4].status === 'fulfilled' && settled[4].value) {
    next.publication = settled[4].value.map((p) => ({
      id: p.id, label: `${p.dataset} v${p.version} — ${p.state}`,
    }))
  }
  subjects.value = next
  subjectsLoading.value = false
}

watch(() => store.selectedYearId, () => { void loadSubjects() })

/** A kind we can offer a picker for. The others take the identifier from elsewhere. */
const pickable = computed(() => (subjects.value[form.value.subject_kind] ?? []))
const hasPicker = computed(() => !['transaction', 'report'].includes(form.value.subject_kind))

const activeKindHint = computed(() =>
  SUBJECT_KINDS.find((k) => k.value === form.value.subject_kind)?.hint ?? '')

function pickFile(event: Event): void {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

function resetForm(): void {
  form.value = { subject_kind: 'financial_year', subject_id: '', document_type: '' }
  file.value = null
  progress.value = 0
  if (fileInput.value) fileInput.value.value = ''
}

// Clearing the chosen record when the kind changes stops a budget-line id being sent as a project.
watch(() => form.value.subject_kind, () => { form.value.subject_id = '' })

async function send(): Promise<void> {
  error.value = null; note.value = null
  if (!file.value) { error.value = 'Choose a file first.'; return }
  if (!form.value.subject_id.trim()) {
    error.value = 'Choose the record this document supports. A document attached to nothing cannot be found again.'
    return
  }
  busy.value = 'upload'
  progress.value = 0
  try {
    const result = await financeApi.uploadDocument({
      file: file.value,
      subjectKind: form.value.subject_kind,
      subjectId: form.value.subject_id.trim(),
      documentType: form.value.document_type.trim() || undefined,
      onProgress: (percent) => { progress.value = percent },
    })
    note.value = `${result.document.filename} attached to the ${subjectLabel(form.value.subject_kind).toLowerCase()}. `
      + 'It is restricted until a publisher releases it.'
    showForm.value = false
    resetForm()
    await load()
  } catch (err) {
    error.value = messageOf(err, 'The document could not be uploaded.')
  } finally {
    busy.value = null
  }
}

// ── Visibility and withdrawal ─────────────────────────────────────────────────────────────────
async function setVisibility(doc: FinanceDocument, visibility: 'private' | 'internal' | 'public'): Promise<void> {
  error.value = null; note.value = null
  let reason: string | null = ''
  if (visibility === 'public') {
    reason = await prompt.ask({
      title: `Publish ${doc.filename}`,
      message: 'A public document is served to anyone, without a sign-in, while the documents '
        + 'dataset is published. Check it carries no personal, supplier or commercially sensitive '
        + 'detail before releasing it. The reason is kept in the audit trail.',
      label: 'Why is this document being made public?',
      kind: 'textarea',
      minLength: 10,
      submitLabel: 'Make it public',
    })
    if (!reason) return
  } else {
    reason = await prompt.ask({
      title: visibility === 'internal' ? `Make ${doc.filename} internal` : `Restrict ${doc.filename}`,
      message: visibility === 'internal'
        ? 'Finance staff will see it. It leaves the public portal.'
        : 'Only staff holding the restricted-document permission will see it.',
      label: 'A note for the record (optional)',
      kind: 'textarea',
      submitLabel: 'Change visibility',
    })
    if (reason === null) return
  }
  busy.value = doc.id
  try {
    await financeApi.setDocumentVisibility(doc.id, visibility, reason || undefined)
    note.value = `${doc.filename} is now ${VISIBILITY[visibility].label.toLowerCase()}.`
    await load()
  } catch (err) {
    error.value = messageOf(err, 'The visibility could not be changed.')
  } finally {
    busy.value = null
  }
}

async function withdraw(doc: FinanceDocument): Promise<void> {
  error.value = null; note.value = null
  const reason = await prompt.ask({
    title: `Withdraw ${doc.filename}`,
    message: 'The record and the stored file are retained — financial documents are never deleted. '
      + 'The document stops being listed and stops being served.',
    label: 'Why is it being withdrawn?',
    kind: 'textarea',
    minLength: 5,
    submitLabel: 'Withdraw it',
    danger: true,
  })
  if (!reason) return
  busy.value = doc.id
  try {
    await financeApi.withdrawDocument(doc.id, reason)
    note.value = `${doc.filename} withdrawn. It is retained on the record and no longer served.`
    await load()
  } catch (err) {
    error.value = messageOf(err, 'The document could not be withdrawn.')
  } finally {
    busy.value = null
  }
}

const publicCount = computed(() => documents.value.filter((d) => d.visibility === 'public').length)
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
        <input v-model="filter.q" class="ins-input" type="search" placeholder="Search filename or type" />
      </label>
      <select v-model="filter.subject_kind" class="ins-input fin-filter" aria-label="Attached to">
        <option value="">Attached to anything</option>
        <option v-for="k in SUBJECT_KINDS" :key="k.value" :value="k.value">{{ k.label }}</option>
      </select>
      <select v-model="filter.visibility" class="ins-input fin-filter" aria-label="Visibility">
        <option value="">Any visibility</option>
        <option value="private">Restricted</option>
        <option value="internal">Internal</option>
        <option value="public">Public</option>
      </select>
      <button v-if="canUpload" type="button" class="fin-btn primary" @click="showForm = !showForm">
        <Upload :size="14" aria-hidden="true" /> Attach a document
      </button>
      <button type="button" class="fin-btn small" :disabled="loading" @click="load(); loadSubjects()">
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
      </button>
    </div>

    <p v-if="!restrictedVisible" class="fin-ccy-note">
      <Info :size="14" aria-hidden="true" />
      Restricted documents are not listed for your role. What you see here is the internal and
      public material; a document you cannot see is absent from this list rather than shown as a
      blocked row.
    </p>

    <!-- ── Attach ─────────────────────────────────────────────────────────────────────────── -->
    <FinanceGuard v-if="showForm" requires="finance.document.upload" surface="Attaching a document">
      <form class="ins-card" @submit.prevent="send">
        <div class="ins-card-head"><h3>Attach a supporting document</h3></div>
        <div class="ins-card-body">
          <p class="fin-ccy-note" style="margin-top: 0">
            <Info :size="14" aria-hidden="true" />
            Every document arrives restricted. Making one public is a separate act by a publisher,
            with a stated reason — so an invoice cannot reach the portal by being uploaded.
            PDF, JPEG, PNG, WebP, CSV and XLSX, up to 25 MB. The file is checked by its contents,
            not by its extension, and scanned before it is stored.
          </p>

          <div class="ins-form">
            <div class="ins-field">
              <label class="ins-label" for="doc-kind">What does it support?</label>
              <select id="doc-kind" v-model="form.subject_kind" class="ins-input">
                <option v-for="k in SUBJECT_KINDS" :key="k.value" :value="k.value">{{ k.label }}</option>
              </select>
              <p class="ins-hint">{{ activeKindHint }}</p>
            </div>

            <div class="ins-field">
              <label class="ins-label" for="doc-subject">Which one?</label>
              <select v-if="hasPicker" id="doc-subject" v-model="form.subject_id" class="ins-input" required>
                <option value="">{{ subjectsLoading ? 'Reading records…' : 'Choose…' }}</option>
                <option v-for="s in pickable" :key="s.id" :value="s.id">{{ s.label }}</option>
              </select>
              <input v-else id="doc-subject" v-model="form.subject_id" class="ins-input" maxlength="200" required
                     placeholder="Identifier of the record" />
              <p v-if="hasPicker && pickable.length === 0 && !subjectsLoading" class="ins-hint">
                No {{ subjectLabel(form.subject_kind).toLowerCase() }} exists for the selected year yet.
              </p>
              <p v-else-if="!hasPicker" class="ins-hint">
                There is no staff register of individual postings to pick from, so this takes the
                identifier shown on the project trace or the public transaction page.
              </p>
            </div>

            <div class="ins-field">
              <label class="ins-label" for="doc-type">Document type</label>
              <input id="doc-type" v-model="form.document_type" class="ins-input" maxlength="80"
                     list="doc-type-suggestions" placeholder="e.g. invoice" />
              <datalist id="doc-type-suggestions">
                <option value="invoice" />
                <option value="voucher" />
                <option value="receipt" />
                <option value="purchase_order" />
                <option value="contract" />
                <option value="approved_budget" />
                <option value="bank_statement" />
                <option value="committee_minute" />
                <option value="completion_certificate" />
              </datalist>
              <p class="ins-hint">How the council files it. Used to group documents in reports and on the portal.</p>
            </div>

            <div class="ins-field">
              <label class="ins-label" for="doc-file">File</label>
              <input id="doc-file" ref="fileInput" class="ins-input" type="file" required
                     accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,.xlsx" @change="pickFile" />
              <p v-if="file" class="ins-hint">{{ file.name }} · {{ formatBytes(file.size) }}</p>
            </div>
          </div>

          <p v-if="busy === 'upload' && progress > 0" class="ins-hint" role="status">Uploading… {{ progress }}%</p>
        </div>
        <div class="ins-card-foot">
          <button type="button" class="fin-btn" @click="showForm = false; resetForm()">Cancel</button>
          <button type="submit" class="fin-btn primary" :disabled="busy === 'upload'">
            <Upload :size="14" aria-hidden="true" />
            {{ busy === 'upload' ? 'Uploading…' : 'Attach' }}
          </button>
        </div>
      </form>
    </FinanceGuard>

    <!-- ── The register ───────────────────────────────────────────────────────────────────── -->
    <p v-if="loading && documents.length === 0" class="fin-loading" role="status">Reading the document register…</p>

    <div v-else-if="visible.length === 0" class="fin-empty">
      <strong>No documents match.</strong>
      <p>
        A figure with a document behind it can be checked; one without it has to be taken on trust.
        Attach the invoice, voucher, contract or approved budget to the record it belongs to and it
        becomes part of that record's trail.
      </p>
    </div>

    <section v-else class="ins-card">
      <div class="ins-card-head">
        <h3>
          <Paperclip :size="15" aria-hidden="true" /> Documents
          <span class="ins-count">{{ visible.length }}</span>
        </h3>
        <span class="fin-asat">{{ publicCount }} on the public portal</span>
      </div>
      <div class="ins-card-body">
        <div class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr>
                <th scope="col">Document</th>
                <th scope="col">Type</th>
                <th scope="col">Attached to</th>
                <th scope="col">Visibility</th>
                <th scope="col" class="num">Size</th>
                <th scope="col">Uploaded</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in visible" :key="d.id">
                <td>
                  <a :href="financeApi.documentDownloadUrl(d.id)" class="fin-doclink"
                     target="_blank" rel="noopener">
                    <Download :size="12" aria-hidden="true" />{{ d.filename }}
                  </a>
                  <br /><small class="fin-sub">{{ d.mime_type }}</small>
                </td>
                <td>{{ (d.document_type ?? '—').replace(/_/g, ' ') }}</td>
                <td>
                  {{ subjectLabel(d.subject_kind) }}<br />
                  <small class="fin-sub ins-mono">{{ d.subject_id }}</small>
                </td>
                <td>
                  <span class="fin-pill" :class="VISIBILITY[d.visibility].tone">
                    <component :is="VISIBILITY[d.visibility].icon" :size="11" aria-hidden="true" />
                    {{ VISIBILITY[d.visibility].label }}
                  </span>
                </td>
                <td class="num">{{ formatBytes(d.size_bytes) }}</td>
                <td>
                  {{ formatDateTime(d.uploaded_at) }}<br />
                  <small class="fin-sub">{{ d.uploaded_by_name ?? 'unknown' }}</small>
                </td>
                <td>
                  <div class="fin-row-actions">
                    <template v-if="canSetVisibility">
                      <button v-if="d.visibility !== 'public'" type="button" class="fin-btn small"
                              :disabled="busy === d.id" @click="setVisibility(d, 'public')">
                        <Globe2 :size="12" aria-hidden="true" /> Publish
                      </button>
                      <button v-if="d.visibility !== 'internal'" type="button" class="fin-btn small"
                              :disabled="busy === d.id" @click="setVisibility(d, 'internal')">
                        <Eye :size="12" aria-hidden="true" /> Internal
                      </button>
                      <button v-if="d.visibility !== 'private'" type="button" class="fin-btn small"
                              :disabled="busy === d.id" @click="setVisibility(d, 'private')">
                        <Lock :size="12" aria-hidden="true" /> Restrict
                      </button>
                    </template>
                    <button v-if="canWithdraw" type="button" class="fin-btn small danger"
                            :disabled="busy === d.id" @click="withdraw(d)">
                      <Trash2 :size="12" aria-hidden="true" /> Withdraw
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="fin-ccy-note">
          A document's visibility is what decides who may download it, per document, each time —
          the address is not a permission. Changing a document to public does not put it on the
          portal by itself: the documents dataset must also be published, under Publication.
        </p>
        <p v-if="!canSetVisibility" class="fin-ccy-note">
          <Info :size="14" aria-hidden="true" />
          {{ store.whyUnavailable('finance.publication.publish') }}
        </p>
        <!--
          Explain rather than offer a button that would only 403. Reading a document and removing
          it from the register are different acts: the auditor, the publisher and the committee
          read here and write nothing.
        -->
        <p v-if="!canWithdraw" class="fin-ccy-note">
          <Info :size="14" aria-hidden="true" />
          Withdrawing a document needs
          <strong>finance.document.withdraw</strong>, which your role does not hold.
          {{ store.whyUnavailable('finance.document.withdraw') }}
          A withdrawal is never a deletion: the record and the stored file are retained and the
          stated reason is kept on the record and in the audit trail.
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); }
.fin-filter { max-width: 14rem; }
.fin-row-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.fin-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.fin-loading { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.fin-asat { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.fin-ccy-note { display: flex; align-items: flex-start; gap: var(--ent-s2); }
.fin-doclink {
  display: inline-flex; align-items: center; gap: 4px;
  color: var(--ent-accent); text-decoration: underline; text-underline-offset: 2px;
  overflow-wrap: anywhere;
}
.fin-doclink:focus-visible { outline: var(--ent-focus-ring); outline-offset: 2px; }
.ins-card-head h3 { display: inline-flex; align-items: center; gap: var(--ent-s2); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
