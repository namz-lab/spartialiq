<script setup lang="ts">
// Documents — stage uploads against a draft. Layout matches the Stitch
// "Document Upload" design: status bento, a required-document checklist,
// a stage-a-new-document panel with a drag-and-drop zone, and (desktop)
// a submission-summary / help / activity sidebar. Tracks required
// documents per development type and warns when mandatory items are
// missing. The chosen file's bytes are retained in memory (via
// cc.stageDocument) and uploaded to the permit automatically when the
// application is submitted from the "New application" tab.

import { ref, computed } from 'vue'
import {
  useCitizenCase, REQUIRED_DOCS_BY_TYPE, DOC_TYPE_LABELS, isAttached,
  type CitizenDocType, type ApplicationCategory,
} from '@/composables/useCitizenCase'
import { documentFileError } from '@/utils/citizenValidation'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import {
  Upload, UploadCloud, Trash2, CheckCircle2, AlertTriangle, FileText,
  Plus, Info, HelpCircle, Check,
} from 'lucide-vue-next'

const cc = useCitizenCase()
const fb = useUiFeedback()
const emit = defineEmits<{ 'open-section': [key: 'new'] }>()

const docType = ref<CitizenDocType>('title_deed')
const fileInput = ref<HTMLInputElement | null>(null)

const drafts = computed(() => cc.drafts.value.filter(d => !d.submitted_at))
const draft = computed(() => cc.currentDraft.value ?? drafts.value[0] ?? null)

function triggerPicker() { fileInput.value?.click() }

function stageFiles(files: FileList | File[]) {
  const d = draft.value
  if (!d) { fb.showToast('Start a draft application first.', 'warning'); return }
  if (cc.currentDraftId.value !== d.id) cc.selectDraft(d.id)
  const arr = Array.from(files)
  if (!arr.length) return
  let staged = 0
  for (const f of arr) {
    const err = documentFileError(f)
    if (err) { fb.showToast(err, 'warning'); continue }
    cc.stageDocument(d.id, { doc_type: docType.value, filename: f.name, size_bytes: f.size }, f)
    staged += 1
  }
  if (staged) fb.showToast(`${staged} document(s) attached — they upload when you submit.`, 'success')
}

function onFilesChosen(ev: Event) {
  const files = (ev.target as HTMLInputElement).files
  if (files?.length) stageFiles(files)
  if (fileInput.value) fileInput.value.value = ''
}

const dragOver = ref(false)
function onDrop(ev: DragEvent) {
  dragOver.value = false
  if (ev.dataTransfer?.files?.length) stageFiles(ev.dataTransfer.files)
}

function uploadFor(type: CitizenDocType) { docType.value = type; triggerPicker() }

const requiredDocs = computed(() => {
  const t = draft.value?.development_type
  if (!t) return []
  return REQUIRED_DOCS_BY_TYPE[t as ApplicationCategory] ?? []
})
const stagedTypes = computed(() => new Set((draft.value?.documents ?? []).filter(isAttached).map(d => d.doc_type)))

const mandatoryReqs = computed(() => requiredDocs.value.filter(r => r.mandatory))
const optionalReqs  = computed(() => requiredDocs.value.filter(r => !r.mandatory))
const missingMandatory = computed(() => mandatoryReqs.value.filter(r => !stagedTypes.value.has(r.type)))
const uploadedReq = computed(() => requiredDocs.value.filter(r => stagedTypes.value.has(r.type)).length)
const progressPct = computed(() => requiredDocs.value.length
  ? Math.round((uploadedReq.value / requiredDocs.value.length) * 100) : 0)
const stagedCount = computed(() => draft.value?.documents.length ?? 0)
const complete = computed(() => requiredDocs.value.length > 0 && missingMandatory.value.length === 0)

const activity = computed(() =>
  [...(draft.value?.documents ?? [])]
    .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())
    .slice(0, 5))

function reqStatus(r: { type: CitizenDocType; mandatory: boolean }): 'staged' | 'missing' | 'optional' {
  if (stagedTypes.value.has(r.type)) return 'staged'
  return r.mandatory ? 'missing' : 'optional'
}

function finalize() {
  if (!complete.value) return
  fb.showToast('All required documents staged. Open the “New application” tab to submit.', 'success')
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}
function fmtDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB',
    { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
}
</script>

<template>
  <div class="dc">
    <!-- Header -->
    <header class="dc-header">
      <nav class="dc-crumbs">
        <span>My applications</span><span class="sep">/</span>
        <span>{{ draft?.stand_number ? 'Stand ' + draft.stand_number : 'Draft' }}</span>
        <span class="sep">/</span><span class="cur">Document upload</span>
      </nav>
      <div class="dc-title-row">
        <div>
          <h1>Document upload<template v-if="draft?.stand_number"> — Stand {{ draft.stand_number }}</template></h1>
          <p>Stage the documents required for your development application.</p>
        </div>
        <div class="dc-deadline"><Info :size="16" /> Keep this tab open until you submit</div>
      </div>
    </header>

    <!-- Active application -->
    <div class="dc-active">
      <label>Active application</label>
      <select v-if="drafts.length" :value="cc.currentDraftId.value ?? draft?.id ?? ''"
              @change="cc.selectDraft(($event.target as HTMLSelectElement).value)">
        <option v-for="d in drafts" :key="d.id" :value="d.id">
          {{ d.applicant_name || 'Unnamed' }} — {{ d.stand_number ? 'Stand ' + d.stand_number : 'no stand' }}
        </option>
      </select>
      <span v-else class="dc-warn">No open drafts. Start one from New application.</span>
    </div>

    <div v-if="!draft" class="cp-card dc-empty">
      <FileText :size="26" />
      <h3>No active draft</h3>
      <p>Start an application, then attach its documents here. The form saves on this device; attached files are held in this tab and upload when you submit.</p>
      <button type="button" class="dc-btn primary" @click="emit('open-section', 'new')">Start a new application</button>
    </div>

    <div v-else class="dc-grid">
      <!-- Main column -->
      <div class="dc-main">
        <div class="dc-progress">
          <p>
            <strong>{{ uploadedReq }} of {{ mandatoryReqs.length || 0 }} required documents</strong>
            staged.
            <template v-if="complete">Ready to submit.</template>
            <template v-else-if="missingMandatory.length">{{ missingMandatory.length }} still missing.</template>
          </p>
          <div class="dc-bar"><div class="dc-bar-fill" :style="{ transform: `scaleX(${progressPct / 100})` }" /></div>
        </div>

        <!-- Checklist -->
        <div class="cp-card">
          <div class="cp-card-head between">
            <h2>Application document checklist</h2>
            <span>{{ requiredDocs.length }} item(s)</span>
          </div>
          <div v-if="!draft.development_type" class="dc-empty-line">
            Select a development type in the New application wizard to see required documents.
          </div>
          <div v-else class="dc-checklist">
            <div v-for="r in requiredDocs" :key="r.type" class="dc-check-row" :class="reqStatus(r)">
              <span class="dc-check-ic">
                <CheckCircle2 v-if="reqStatus(r) === 'staged'" :size="20" />
                <AlertTriangle v-else-if="reqStatus(r) === 'missing'" :size="20" />
                <FileText v-else :size="20" />
              </span>
              <div class="dc-check-body">
                <h4>{{ DOC_TYPE_LABELS[r.type] }}</h4>
                <p>{{ reqStatus(r) === 'staged' ? 'Staged for submission' : (r.notes || (r.mandatory ? 'Required for review' : 'Optional')) }}</p>
              </div>
              <div class="dc-check-actions">
                <span v-if="reqStatus(r) === 'staged'" class="pill pill-green">Staged</span>
                <template v-else-if="reqStatus(r) === 'missing'">
                  <span class="pill pill-red">Missing</span>
                  <button class="dc-mini-btn" @click="uploadFor(r.type)">Upload now</button>
                </template>
                <template v-else>
                  <span class="pill pill-gray">Optional</span>
                  <button class="dc-icon-btn" @click="uploadFor(r.type)" title="Add"><Plus :size="18" /></button>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- Stage a new document -->
        <div class="cp-card">
          <div class="cp-card-head"><h2>Stage a new document</h2></div>
          <div class="dc-stage">
            <label class="dc-field"><span>Document type</span>
              <select v-model="docType">
                <option v-for="(label, key) in DOC_TYPE_LABELS" :key="key" :value="key">{{ label }}</option>
              </select>
            </label>
            <input ref="fileInput" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" class="dc-hidden" @change="onFilesChosen" />
            <div class="dc-drop" :class="{ over: dragOver }"
                 @click="triggerPicker"
                 @dragover.prevent="dragOver = true" @dragleave="dragOver = false" @drop.prevent="onDrop">
              <span class="dc-drop-ic"><UploadCloud :size="30" /></span>
              <p class="dc-drop-t">Tap to select, take a photo, or drag &amp; drop</p>
              <p class="dc-drop-s">PDF, JPG, PNG · max 10 MB per file</p>
            </div>
            <div class="dc-stage-actions">
              <button class="dc-btn primary" @click="triggerPicker" :disabled="!draft">
                <Upload :size="16" /> Upload file
              </button>
            </div>
          </div>
        </div>

        <!-- Staged files -->
        <div class="cp-card">
          <div class="cp-card-head between">
            <h2>Ready to submit</h2>
            <span class="pill pill-primary" v-if="stagedCount">{{ stagedCount }} file{{ stagedCount === 1 ? '' : 's' }}</span>
          </div>
          <div v-if="!stagedCount" class="dc-empty-line">No files staged yet. Use the checklist or the drop zone above.</div>
          <ul v-else class="dc-files">
            <li v-for="d in draft.documents" :key="d.id">
              <span class="dc-file-ic"><FileText :size="18" /></span>
              <div class="dc-file-body">
                <p class="dc-file-name mono">{{ d.filename }}</p>
                <p class="dc-file-meta">{{ DOC_TYPE_LABELS[d.doc_type] }} · {{ fmtSize(d.size_bytes) }}</p>
                <p v-if="!isAttached(d)" class="dc-file-stale">Re-attach this file. It was not kept after the page reloaded.</p>
              </div>
              <button class="dc-trash" @click="cc.removeDocument(draft.id, d.id)" title="Remove"><Trash2 :size="16" /></button>
            </li>
          </ul>
        </div>
      </div>

      <!-- Sidebar -->
      <div class="dc-side">
        <!-- Submission summary -->
        <div class="cp-card dc-summary">
          <div class="dc-summary-head">
            <h3>{{ complete ? 'Ready to submit' : 'Documents still required' }}</h3>
            <p class="dc-summary-sub">Stage every required file before you pay and submit.</p>
          </div>
          <div class="dc-summary-body">
            <div class="dc-sum-row"><span>Required documents</span><strong>{{ uploadedReq }} / {{ mandatoryReqs.length }}</strong></div>
            <div class="dc-sum-row"><span>Optional documents</span><strong>{{ optionalReqs.filter(r => stagedTypes.has(r.type)).length }} / {{ optionalReqs.length }}</strong></div>
            <div class="dc-sum-row"><span>Staged for upload</span><strong class="hl">{{ stagedCount }} files</strong></div>
            <div v-if="missingMandatory.length" class="dc-sum-warn">
              <AlertTriangle :size="16" />
              <p>A mandatory document is missing. You cannot submit until every required file is staged.</p>
            </div>
            <button class="dc-btn primary full" :disabled="!complete" @click="finalize">Finalize &amp; submit</button>
            <button class="dc-btn ghost full" @click="cc.save()">Save progress</button>
          </div>
        </div>

        <!-- Help -->
        <div class="cp-card dc-help dc-side-extra">
          <h4><HelpCircle :size="18" /> Help &amp; guidelines</h4>
          <div class="dc-help-item">
            <p class="q">How to scan multiple pages?</p>
            <p class="a">Combine all survey documents into a single PDF for faster processing.</p>
          </div>
          <div class="dc-help-item">
            <p class="q">Accepted technical formats</p>
            <p class="a">Architectural drawings should be clear, scaled 1:100, and high-resolution PDF.</p>
          </div>
        </div>

        <!-- Activity -->
        <div class="cp-card dc-activity dc-side-extra">
          <div class="cp-card-head"><h2>Recent upload activity</h2></div>
          <div v-if="!activity.length" class="dc-empty-line">Uploads you stage will list here.</div>
          <ul v-else class="dc-act-list">
            <li v-for="a in activity" :key="a.id">
              <span class="dc-act-node"><Check :size="13" /></span>
              <div>
                <p class="dc-act-text">{{ a.filename }} staged</p>
                <p class="dc-act-when">{{ fmtDateTime(a.uploaded_at) }}</p>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
/* Tokens (--cp-*) inherited from .cp-root */
.dc { padding:1rem; display:flex; flex-direction:column; gap:1rem; max-width:1200px; margin:0 auto; width:100%; }
.mono { font-family:var(--cp-mono); }

/* Header */
.dc-crumbs { display:flex; align-items:center; gap:0.4rem; font-size:0.74rem; color:var(--cp-muted); margin-bottom:0.5rem; }
.dc-crumbs .sep { color:var(--cp-faint); }
.dc-crumbs .cur { color:var(--cp-text); font-weight:600; }
.dc-title-row { display:flex; align-items:flex-end; justify-content:space-between; gap:1rem; flex-wrap:wrap; }
.dc-title-row h1 { margin:0; font-size:1.25rem; font-weight:700; letter-spacing:-0.01em; color:var(--cp-text); }
.dc-title-row p { margin:0.2rem 0 0; font-size:0.85rem; color:var(--cp-text-2); }
.dc-deadline { display:inline-flex; align-items:center; gap:0.4rem; padding:0.4rem 0.75rem;
  background:var(--cp-primary-tint); border:1px solid var(--cp-primary-tint-border); border-radius:var(--cp-radius-sm);
  font-size:0.76rem; font-weight:600; color:var(--cp-primary); }

/* Active application */
.dc-active { display:flex; align-items:center; gap:0.6rem; padding:0.65rem 0.85rem;
  background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius); box-shadow:var(--cp-shadow); }
.dc-active label { font-size:0.66rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--cp-muted); }
.dc-active select { flex:1; max-width:24rem; padding:0.4rem 0.6rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm);
  background:var(--cp-surface); font-size:0.82rem; color:var(--cp-text); }
.dc-warn { color:var(--cp-amber-fg); font-size:0.8rem; }

/* Cards / pills */
.cp-card { background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius); box-shadow:var(--cp-shadow); overflow:hidden; }
.cp-card-head { display:flex; align-items:center; padding:0.85rem 1.1rem; border-bottom:1px solid var(--cp-border); }
.cp-card-head.between { justify-content:space-between; }
.cp-card-head h2 { margin:0; font-size:0.95rem; font-weight:600; color:var(--cp-text); }
.cp-card-head span { font-size:0.74rem; color:var(--cp-muted); }
.between { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; }
.pill { display:inline-flex; align-items:center; padding:0.15rem 0.55rem; border-radius:var(--cp-radius-pill);
  font-size:0.64rem; font-weight:700; letter-spacing:0.03em; text-transform:uppercase; white-space:nowrap; }
.pill-green   { background:var(--cp-green-bg); color:var(--cp-green-fg); }
.pill-red     { background:var(--cp-red-bg);   color:var(--cp-red-fg); }
.pill-gray    { background:var(--cp-surface-2); color:var(--cp-muted); border:1px solid var(--cp-border); }
.pill-primary { background:var(--cp-primary-tint); color:var(--cp-primary); }

.dc-empty { padding:3rem 1.5rem; text-align:center; display:flex; flex-direction:column; align-items:center; gap:0.5rem; }
.dc-empty :deep(svg) { color:var(--cp-faint); }
.dc-empty h3 { margin:0; font-size:1rem; color:var(--cp-text); }
.dc-empty p { margin:0; max-width:30rem; font-size:0.84rem; color:var(--cp-text-2); }
.dc-empty .dc-btn { margin-top:0.75rem; }
.dc-empty-line { padding:1.5rem; text-align:center; color:var(--cp-faint); font-size:0.82rem; }

/* Grid */
.dc-grid { display:flex; flex-direction:column; gap:1rem; }
.dc-main, .dc-side { display:flex; flex-direction:column; gap:1rem; min-width:0; }

.dc-progress {
  padding:0.85rem 0 0.25rem;
}
.dc-progress p { margin:0 0 0.55rem; font-size:0.88rem; color:var(--cp-text-2); }
.dc-progress strong { color:var(--cp-text); }
.dc-bar { height:6px; background:var(--cp-surface-2); border-radius:var(--cp-radius-pill); overflow:hidden; }
.dc-bar-fill { height:100%; background:var(--cp-primary); transform-origin:left; transition:transform 160ms cubic-bezier(0.16, 1, 0.3, 1); }

/* Checklist */
.dc-checklist { display:flex; flex-direction:column; }
.dc-check-row { display:flex; align-items:center; gap:1rem; padding:0.85rem 1.1rem; border-bottom:1px solid var(--cp-border); }
.dc-check-row:last-child { border-bottom:0; }
.dc-check-row.missing { background:#fef6f6; }
.dc-check-ic { display:inline-flex; align-items:center; justify-content:center; width:40px; height:40px; flex-shrink:0;
  border-radius:var(--cp-radius-sm); border:1px solid var(--cp-border); background:var(--cp-surface-2); color:var(--cp-muted); }
.dc-check-row.staged .dc-check-ic { background:var(--cp-green-bg); color:var(--cp-green-fg); border-color:transparent; }
.dc-check-row.missing .dc-check-ic { background:var(--cp-red-bg); color:var(--cp-red-fg); border-color:transparent; }
.dc-check-body { flex:1; min-width:0; }
.dc-check-body h4 { margin:0; font-size:0.88rem; font-weight:600; color:var(--cp-text); }
.dc-check-body p { margin:0.1rem 0 0; font-size:0.76rem; color:var(--cp-muted); }
.dc-check-actions { display:flex; align-items:center; gap:0.6rem; flex-shrink:0; }
.dc-mini-btn { padding:0.35rem 0.7rem; background:var(--cp-primary); color:var(--cp-on-primary); border:0; border-radius:var(--cp-radius-sm); font-size:0.74rem; font-weight:600; cursor:pointer; }
.dc-mini-btn:hover { background:var(--cp-primary-hover); }
.dc-icon-btn { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); background:var(--cp-surface); color:var(--cp-muted); cursor:pointer; }
.dc-icon-btn:hover { color:var(--cp-primary); border-color:var(--cp-primary-tint-border); }

/* Stage new document */
.dc-stage { padding:1.1rem; display:flex; flex-direction:column; gap:0.85rem; }
.dc-field { display:flex; flex-direction:column; gap:0.3rem; }
.dc-field > span { font-size:0.66rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--cp-muted); }
.dc-field select { padding:0.5rem 0.65rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); background:var(--cp-surface); font-size:0.82rem; color:var(--cp-text); }
.dc-field select:focus { outline:2px solid var(--cp-primary); outline-offset:-2px; border-color:var(--cp-primary); }
.dc-hidden { display:none; }
.dc-drop { display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; gap:0.3rem;
  padding:2rem 1rem; border:2px dashed var(--cp-border-strong); border-radius:var(--cp-radius); background:var(--cp-surface-2); cursor:pointer;
  transition:border-color 160ms cubic-bezier(0.16, 1, 0.3, 1), background 160ms cubic-bezier(0.16, 1, 0.3, 1); }
.dc-drop:hover, .dc-drop.over { border-color:var(--cp-primary); background:var(--cp-primary-tint); }
.dc-drop-ic { display:inline-flex; align-items:center; justify-content:center; width:56px; height:56px; border-radius:50%;
  background:var(--cp-surface); box-shadow:var(--cp-shadow); color:var(--cp-primary); margin-bottom:0.5rem; }
.dc-drop-t { margin:0; font-size:0.9rem; font-weight:600; color:var(--cp-text); }
.dc-drop-s { margin:0; font-size:0.76rem; color:var(--cp-muted); }
.dc-stage-actions { display:flex; justify-content:flex-end; }

/* Buttons */
.dc-btn { display:inline-flex; align-items:center; justify-content:center; gap:0.4rem; padding:0.55rem 1rem;
  border:1px solid transparent; border-radius:var(--cp-radius-sm); font-size:0.82rem; font-weight:600; cursor:pointer; }
.dc-btn.primary { background:var(--cp-primary); color:var(--cp-on-primary); }
.dc-btn.primary:hover:not(:disabled) { background:var(--cp-primary-hover); }
.dc-btn.primary:disabled { background:var(--cp-border-strong); cursor:not-allowed; }
.dc-btn.ghost { background:transparent; border-color:var(--cp-border); color:var(--cp-text-2); }
.dc-btn.ghost:hover { background:var(--cp-surface-2); }
.dc-btn.full { width:100%; }

/* Staged files */
.dc-files { list-style:none; margin:0; padding:0; }
.dc-files li { display:flex; align-items:center; gap:0.75rem; padding:0.75rem 1.1rem; border-bottom:1px solid var(--cp-border); }
.dc-files li:last-child { border-bottom:0; }
.dc-file-ic { display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; flex-shrink:0;
  border-radius:var(--cp-radius-sm); background:var(--cp-surface-2); color:var(--cp-muted); }
.dc-file-body { flex:1; min-width:0; }
.dc-file-name { margin:0; font-size:0.8rem; color:var(--cp-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dc-file-meta { margin:0.1rem 0 0; font-size:0.72rem; color:var(--cp-muted); }
.dc-file-stale { margin:0.15rem 0 0; font-size:0.72rem; color:var(--cp-amber-fg); }
.dc-trash { background:none; border:0; color:var(--cp-faint); cursor:pointer; padding:0.3rem; flex-shrink:0; }
.dc-trash:hover { color:var(--cp-red-fg); }

/* Summary */
.dc-summary-head { padding:1.1rem 1.25rem; border-bottom:1px solid var(--cp-border); background:var(--cp-surface); }
.dc-summary-head h3 { margin:0; font-size:1.05rem; font-weight:700; color:var(--cp-text); }
.dc-summary-sub { margin:0.35rem 0 0; font-size:0.8rem; line-height:1.5; color:var(--cp-text-2); }
.dc-summary-body { padding:1.1rem; display:flex; flex-direction:column; gap:0.75rem; }
.dc-sum-row { display:flex; align-items:center; justify-content:space-between; font-size:0.82rem; color:var(--cp-text-2); }
.dc-sum-row strong { color:var(--cp-text); }
.dc-sum-row strong.hl { color:var(--cp-primary); }
.dc-sum-warn { display:flex; gap:0.5rem; padding:0.7rem; border-radius:var(--cp-radius-sm); background:var(--cp-red-bg); }
.dc-sum-warn :deep(svg) { color:var(--cp-red-fg); flex-shrink:0; }
.dc-sum-warn p { margin:0; font-size:0.74rem; color:var(--cp-red-fg); line-height:1.45; }

/* Help */
.dc-help { padding:1.25rem; }
.dc-help h4 { display:flex; align-items:center; gap:0.4rem; margin:0 0 1rem; font-size:0.95rem; font-weight:600; color:var(--cp-text); }
.dc-help h4 :deep(svg) { color:var(--cp-primary); }
.dc-help-item { margin-bottom:0.85rem; }
.dc-help-item .q { margin:0; font-size:0.82rem; font-weight:600; color:var(--cp-text); }
.dc-help-item .a { margin:0.2rem 0 0; font-size:0.74rem; color:var(--cp-muted); line-height:1.5; }

/* Activity */
.dc-act-list { list-style:none; margin:0; padding:1rem 1.1rem; display:flex; flex-direction:column; gap:1rem; position:relative; }
.dc-act-list::before { content:''; position:absolute; left:calc(1.1rem + 11px); top:1.4rem; bottom:1.4rem; width:1px; background:var(--cp-border); }
.dc-act-list li { display:flex; gap:0.7rem; position:relative; }
.dc-act-node { position:relative; z-index:1; display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; flex-shrink:0; background:var(--cp-primary); color:#fff; }
.dc-act-text { margin:0; font-size:0.78rem; font-weight:500; color:var(--cp-text); }
.dc-act-when { margin:0.1rem 0 0; font-size:0.7rem; color:var(--cp-muted); }

/* ── Responsive ───────────────────────────────────────────────────── */
@media (max-width: 1023px) {
  .dc-side-extra { display:none; }
}
@media (min-width: 1024px) {
  .dc { padding:1.5rem; }
  .dc-grid { display:grid; grid-template-columns:2fr 1fr; align-items:start; }
  .dc-side .dc-summary { position:sticky; top:1rem; }
}
</style>
