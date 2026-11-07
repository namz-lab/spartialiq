<script setup lang="ts">
// My Applications — master-detail of every submitted permit. Layout
// matches the Stitch "My Applications" design: a list pane (search +
// filter chips + status cards) and a bento detail pane (lifecycle
// tracker, upcoming actions, technical feedback, property details,
// attached documents). On mobile the list is shown as cards and the
// detail opens full-screen with a back control.

import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { downloadCitizenPdf, openCouncilLetter } from '@/views/citizen/citizenDocuments'
import {
  useCitizenCase, lifecycleStage, DOC_TYPE_LABELS,
  type LifecycleStatus, type CitizenDocType,
} from '@/composables/useCitizenCase'
import { dmApi } from '@/services/developmentManagementService'
import { documentFileError } from '@/utils/citizenValidation'
import {
  citizenPortalService, permitStatusToLifecycle,
  type CitizenCaseSnapshot,
} from '@/services/citizenPortalService'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import ApplicationPipeline from '@/components/workflow/ApplicationPipeline.vue'
import {
  FolderOpen, RefreshCw, Search, MapPin, ChevronRight, Download,
  Check, Loader, Gavel, Award, AlertTriangle, CreditCard, FileText, Upload,
  Calendar, History, User, Building2, ArrowLeft, MessageSquare, Mail, Plus,
} from 'lucide-vue-next'

const emit = defineEmits<{ 'open-section': [key: 'new' | 'certificates' | 'notices'] }>()
const router = useRouter()
const cc = useCitizenCase()
const fb = useUiFeedback()

const search = ref('')
const tab = ref<'all' | 'action' | 'recent'>('all')
const selectedId = ref<string | null>(null)
const snapshot = ref<CitizenCaseSnapshot | null>(null)
const loadingSnapshot = ref(false)

const filtered = computed(() => {
  let arr = [...cc.applications.value]
  if (tab.value === 'action') {
    arr = arr.filter(p => lifecycleStage(permitStatusToLifecycle(p)).actor === 'citizen')
  }
  const q = search.value.trim().toLowerCase()
  if (q) arr = arr.filter(p =>
    (p.dev_register_no || '').toLowerCase().includes(q) ||
    (p.applicant_name  || '').toLowerCase().includes(q) ||
    (p.stand_number    || '').toLowerCase().includes(q))
  const key = tab.value === 'recent' ? 'updated_at' : 'created_at'
  return arr.sort((a, b) =>
    new Date((b as any)[key] || b.created_at).getTime() - new Date((a as any)[key] || a.created_at).getTime())
})

const activeCount = computed(() => cc.applications.value.length)

async function pick(id: string) {
  selectedId.value = id
  snapshot.value = null
  loadingSnapshot.value = true
  try {
    snapshot.value = await citizenPortalService.getCaseSnapshot(id)
  } catch (err: any) {
    fb.showToast(fb.parseApiError(err, 'Could not load case detail'), 'error')
  } finally {
    loadingSnapshot.value = false
  }
}

async function refresh() {
  await cc.refreshApplications()
  if (selectedId.value) await pick(selectedId.value)
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
}
function timeAgo(iso: string | null) {
  if (!iso) return '—'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  const d = Math.floor(s / 86400)
  return d < 30 ? d + 'd ago' : fmtDate(iso)
}

// ── Status mapping ────────────────────────────────────────────────────
interface Meta { label: string; cls: string; action: 'pay' | 'download' | 'view' }
function statusMeta(p: any): Meta {
  const lc = permitStatusToLifecycle(p)
  if (lc === 'permit_issued' || lc === 'occupation_certificate_issued')
    return { label: 'Approved', cls: 'pill-green', action: 'download' }
  if (lc === 'refused' || lc === 'lapsed')
    return { label: lc === 'refused' ? 'Refused' : 'Lapsed', cls: 'pill-red', action: 'view' }
  if (!p.fee_paid) return { label: 'Awaiting payment', cls: 'pill-amber', action: 'pay' }
  if (lifecycleStage(lc).actor === 'citizen') return { label: 'Action required', cls: 'pill-red', action: 'view' }
  return { label: 'In review', cls: 'pill-blue', action: 'view' }
}
function caseTitle(p: any) {
  return `${(p.development_type || 'Development').replace(/_/g, ' ')} — Stand ${p.stand_number}`
}

// ── 4-phase lifecycle tracker ────────────────────────────────────────
const PHASES = [
  { label: 'Submission',      icon: Check },
  { label: 'Technical review', icon: Loader },
  { label: 'Board decision',  icon: Gavel },
  { label: 'Certificate',     icon: Award },
]
const PHASE_OF: Record<LifecycleStatus, number> = {
  draft: 0, submitted: 0, received: 0, incomplete: 0, complete: 0, acknowledged: 0,
  due_diligence: 1, gis_mapping: 1, technical_circulation: 1, public_notice: 1,
  objection_response: 1, committee_report: 1, committee_review: 1,
  council_decision: 2, permit_drafting: 2, refused: 2, appealed: 2,
  permit_issued: 3, under_construction: 3, inspection_required: 3, inspection_failed: 3,
  final_inspection: 3, occupation_certificate_issued: 3, lapsed: 3, enforcement: 3,
}
function phaseState(i: number, lc: LifecycleStatus): 'done' | 'active' | 'pending' {
  const cur = PHASE_OF[lc] ?? 0
  const allDone = lc === 'occupation_certificate_issued'
  if (i < cur) return 'done'
  if (i === cur) return allDone ? 'done' : 'active'
  return 'pending'
}
const phaseIndex = computed(() => snapshot.value ? (PHASE_OF[snapshot.value.lifecycle] ?? 0) : 0)

function outcomeCls(o: string) {
  const v = String(o || '').toLowerCase()
  if (v === 'no_objection' || v === 'approved') return 'pill-green'
  if (v === 'objection') return 'pill-red'
  if (v === 'conditional') return 'pill-amber'
  return 'pill-gray'
}

function manageAction(p: any) {
  const m = statusMeta(p)
  if (m.action === 'pay') {
    router.push({ path: '/payment/new', query: { relatedKind: 'permit', relatedId: p.id } })
  } else if (m.action === 'download') {
    emit('open-section', 'certificates')
  } else {
    pick(p.id)
  }
}
// Outstanding requests from Council: an unpaid fee, missing documents, or a
// staff message asking for documents. Each maps to one concrete control.
const documentRequests = computed(() =>
  (snapshot.value?.messages ?? []).filter(m => m.message_type === 'document_request'))
const needsDocuments = computed(() =>
  !!snapshot.value && (snapshot.value.lifecycle === 'incomplete' || documentRequests.value.length > 0))

function completeActions() {
  const p = snapshot.value?.permit
  if (!p) return
  if (!p.fee_paid) {
    router.push({ path: '/payment/new', query: { relatedKind: 'permit', relatedId: p.id } })
    return
  }
  if (needsDocuments.value) { pickUpload(); return }
  if (snapshot.value?.lifecycle === 'public_notice') { emit('open-section', 'notices'); return }
  fb.showToast('Nothing is waiting on you. Council will message you here if that changes.', 'info')
}

// ── Upload to a submitted case ────────────────────────────────────────
const uploadType = ref<CitizenDocType>('other')
const uploadInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
function pickUpload() { uploadInput.value?.click() }
async function onUploadChosen(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const p = snapshot.value?.permit
  if (!file || !p) return
  const err = documentFileError(file)
  if (err) { fb.showToast(err, 'warning'); return }
  uploading.value = true
  try {
    const doc = await dmApi.uploadPermitDocument(p.id, file, uploadType.value)
    snapshot.value?.documents.unshift(doc)
    fb.showToast(`${file.name} is now on your case file.`, 'success')
  } catch (e) {
    fb.showToast(fb.parseApiError(e, 'Upload failed. Check the file and try again.'), 'error')
  } finally {
    uploading.value = false
  }
}

const openingLetter = ref<string | null>(null)
async function viewLetter(id: string) {
  openingLetter.value = id
  try { await openCouncilLetter(id) }
  catch (e) { fb.showToast(fb.parseApiError(e, 'Could not open the letter.'), 'error') }
  finally { openingLetter.value = null }
}

function docLabel(t: string) {
  return DOC_TYPE_LABELS[t as CitizenDocType] ?? t.replace(/_/g, ' ')
}
function fmtBytes(n: number | null) {
  if (!n) return ''
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`
}

function downloadCasePdf() {
  const snap = snapshot.value
  if (!snap) return
  const p = snap.permit
  const refNo = p.dev_register_no || p.id.slice(0, 12)
  const lines = [
    `Reference: ${refNo}`,
    `Applicant: ${p.applicant_name || '—'}`,
    `Stand: ${p.stand_number || '—'}, ${p.suburb_ward || '—'}`,
    `Development type: ${(p.development_type || '—').replace(/_/g, ' ')}`,
    `Status: ${permitStatusToLifecycle(p).replace(/_/g, ' ')}`,
    `Submitted: ${fmtDate(p.received_at || p.created_at)}`,
    `Fee: ${p.fee_paid ? 'Paid' : 'Outstanding'}`,
    '',
    'Technical reviews',
    ...(snap.consultations.length
      ? snap.consultations.map(c => `• ${c.department}: ${c.outcome || 'pending'}${c.notes ? ' — ' + c.notes : ''}`)
      : ['• None on file yet.']),
    '',
    'Objections',
    ...(snap.objections.length
      ? snap.objections.map(o => `• ${o.objector_name}: ${o.grounds || '—'}`)
      : ['• None on file.']),
    '',
    `Next action: ${lifecycleStage(snap.lifecycle).citizenAction}`,
  ]
  downloadCitizenPdf(
    `vungu-application-${refNo.replace(/[^\w-]+/g, '_')}.pdf`,
    'Development application record',
    lines,
  )
  fb.showToast('Application PDF downloaded.', 'success')
}
</script>

<template>
  <div class="apps" :class="{ 'has-sel': selectedId }">
    <!-- List pane -->
    <section class="apps-list">
      <div class="apps-list-head">
        <div class="apps-list-title">
          <h2>Applications</h2>
          <span class="apps-count">{{ activeCount }} active</span>
          <button class="apps-refresh" @click="refresh" :disabled="cc.applicationsLoading.value" title="Refresh">
            <RefreshCw :size="14" :class="{ spin: cc.applicationsLoading.value }" />
          </button>
        </div>
        <div class="apps-search">
          <Search :size="16" />
          <input v-model="search" type="text" placeholder="Search applications…" />
        </div>
        <div class="apps-tabs">
          <button :class="{ active: tab === 'all' }" @click="tab = 'all'">All</button>
          <button :class="{ active: tab === 'action' }" @click="tab = 'action'">Action required</button>
          <button :class="{ active: tab === 'recent' }" @click="tab = 'recent'">Recent</button>
        </div>
      </div>

      <div v-if="!filtered.length" class="apps-empty">
        <template v-if="cc.applicationsLoading.value">Loading applications…</template>
        <template v-else>
          <p>No applications match this view. Submit a development application to track it here.</p>
          <button type="button" class="apps-empty-cta" @click="emit('open-section', 'new')">Start a new application</button>
        </template>
      </div>
      <div v-else class="apps-items">
        <button v-for="p in filtered" :key="p.id" type="button"
                class="apps-item" :class="{ active: selectedId === p.id }" @click="pick(p.id)">
          <div class="apps-item-top">
            <span class="apps-ref mono">{{ p.dev_register_no || p.id.slice(0, 12) }}</span>
            <span class="pill" :class="statusMeta(p).cls">{{ statusMeta(p).label }}</span>
          </div>
          <h3 class="apps-item-title">{{ caseTitle(p) }}</h3>
          <p class="apps-item-loc"><MapPin :size="14" /> Stand {{ p.stand_number }} · {{ p.suburb_ward }}</p>
          <div class="apps-item-foot">
            <span class="apps-item-meta"><Calendar :size="13" /> {{ fmtDate(p.created_at) }}</span>
            <span class="apps-item-meta"><History :size="13" /> {{ timeAgo((p as any).updated_at || p.created_at) }}</span>
            <button class="apps-item-action" :class="statusMeta(p).action" @click.stop="manageAction(p)">
              {{ statusMeta(p).action === 'pay' ? 'Pay now' : statusMeta(p).action === 'download' ? 'Download' : 'View details' }}
            </button>
          </div>
        </button>
      </div>

      <button class="apps-fab" @click="emit('open-section', 'new')" title="New application">
        <Plus :size="26" />
      </button>
    </section>

    <!-- Detail pane -->
    <section class="apps-detail">
      <button class="apps-back" @click="selectedId = null"><ArrowLeft :size="16" /> Back to applications</button>

      <div v-if="!selectedId" class="apps-noselect">
        <FolderOpen :size="26" />
        <h3>Select an application</h3>
        <p>Every case shows its lifecycle, outstanding actions, technical feedback and documents.</p>
      </div>

      <div v-else-if="loadingSnapshot" class="apps-loading">Loading case detail…</div>

      <template v-else-if="snapshot">
        <!-- Detail header -->
        <div class="apps-d-head">
          <div>
            <nav class="apps-crumbs"><span>My applications</span><ChevronRight :size="13" /><span class="cur">{{ snapshot.permit.dev_register_no || snapshot.permit.id.slice(0, 12) }}</span></nav>
            <h1>{{ caseTitle(snapshot.permit) }}</h1>
            <p>Submitted {{ fmtDate(snapshot.permit.received_at || snapshot.permit.created_at) }} by {{ snapshot.permit.applicant_name }}</p>
          </div>
          <div class="apps-d-actions">
            <button type="button" class="apps-btn ghost" @click="downloadCasePdf"><Download :size="16" /> Case summary PDF</button>
          </div>
        </div>

        <!-- Bento -->
        <div class="apps-bento">
          <!-- Lifecycle tracker -->
          <div class="cp-card apps-lifecycle span2">
            <span class="apps-card-label">Application lifecycle</span>
            <div class="apps-track">
              <div class="apps-track-line"><div class="apps-track-fill" :style="{ transform: `scaleX(${phaseIndex / (PHASES.length - 1)})` }" /></div>
              <div v-for="(ph, i) in PHASES" :key="i" class="apps-step" :class="phaseState(i, snapshot.lifecycle)">
                <span class="apps-step-node"><component :is="ph.icon" :size="18" /></span>
                <span class="apps-step-label">{{ ph.label }}</span>
                <span class="apps-step-sub">{{ phaseState(i, snapshot.lifecycle) === 'active' ? 'In progress' : phaseState(i, snapshot.lifecycle) === 'done' ? 'Done' : 'Pending' }}</span>
              </div>
            </div>
          </div>

          <!-- Document journey: which office holds the file right now.
               Same backend-driven pipeline every staff role sees, so the
               citizen's view of "where is my document" is the same truth. -->
          <div class="span3">
            <ApplicationPipeline
              :permit="snapshot.permit"
              :consultations="snapshot.consultations"
              title="Where your application is — office by office"
            />
          </div>

          <!-- Upcoming actions -->
          <div class="apps-actions span1">
            <div class="apps-actions-top">
              <div class="apps-actions-head"><AlertTriangle :size="18" /><h3>Upcoming actions</h3></div>
              <p class="apps-actions-lead">{{ lifecycleStage(snapshot.lifecycle).citizenAction }}</p>
              <div v-if="!snapshot.permit.fee_paid" class="apps-action-item">
                <CreditCard :size="18" />
                <div><p class="t">Application fee outstanding</p><p class="s">Pay to keep your case moving</p></div>
              </div>
              <div v-if="needsDocuments" class="apps-action-item">
                <Upload :size="18" />
                <div>
                  <p class="t">Documents requested</p>
                  <p class="s">{{ documentRequests.length ? 'See the Council message below' : 'The Planning Clerk marked this file incomplete' }}</p>
                </div>
              </div>
            </div>
            <button type="button" class="apps-btn primary full" @click="completeActions">
              {{ !snapshot.permit.fee_paid ? 'Pay the fee' : needsDocuments ? 'Upload a document' : 'Check for actions' }}
            </button>
          </div>

          <!-- Messages from Council (staff-authored, citizen-visible only) -->
          <div class="cp-card span3">
            <div class="cp-card-head between"><h3>Messages from Council</h3><span>{{ snapshot.messages.length }}</span></div>
            <div v-if="!snapshot.messages.length" class="apps-empty-line">
              No messages yet. If an officer needs something from you, it appears here.
            </div>
            <ul v-else class="apps-msgs">
              <li v-for="m in snapshot.messages" :key="m.id" class="apps-msg" :class="{ req: m.message_type === 'document_request' }">
                <span class="apps-fb-ic" :class="{ warn: m.message_type === 'document_request' }">
                  <Upload v-if="m.message_type === 'document_request'" :size="16" />
                  <MessageSquare v-else :size="16" />
                </span>
                <div class="apps-fb-body">
                  <div class="between">
                    <h4>{{ m.message_type === 'document_request' ? 'Documents requested' : (m.author_name || 'Council officer') }}</h4>
                    <span class="apps-fb-when">{{ fmtDate(m.created_at) }}</span>
                  </div>
                  <p class="apps-msg-body">{{ m.body }}</p>
                </div>
              </li>
            </ul>
            <p class="apps-msg-note">To reply, visit the Planning Clerk counter or phone the council quoting
              <span class="mono">{{ snapshot.permit.dev_register_no || snapshot.permit.id.slice(0, 12) }}</span>.</p>
          </div>

          <!-- Technical feedback -->
          <div class="cp-card apps-feedback span2">
            <div class="cp-card-head between"><h3>Technical feedback</h3><span>{{ snapshot.consultations.length }} review(s)</span></div>
            <div v-if="!snapshot.consultations.length && !snapshot.objections.length" class="apps-empty-line">No reviewer responses on file yet.</div>
            <div v-else class="apps-fb-list">
              <div v-for="c in snapshot.consultations" :key="c.id" class="apps-fb">
                <span class="apps-fb-ic"><Building2 :size="18" /></span>
                <div class="apps-fb-body">
                  <div class="between"><h4>{{ c.department }}</h4><span class="pill" :class="outcomeCls(c.outcome)">{{ c.outcome || 'pending' }}</span></div>
                  <p v-if="c.response" class="apps-fb-quote">“{{ c.response }}”</p>
                  <p class="apps-fb-when">{{ fmtDate(c.contacted_at) }}</p>
                </div>
              </div>
              <div v-for="o in snapshot.objections" :key="o.id" class="apps-fb">
                <span class="apps-fb-ic warn"><AlertTriangle :size="18" /></span>
                <div class="apps-fb-body">
                  <div class="between"><h4>Objection — {{ o.objector_name }}</h4><span class="pill pill-red">Objection</span></div>
                  <p class="apps-fb-quote">{{ o.grounds }}</p>
                  <p class="apps-fb-when">{{ fmtDate(o.received_at) }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Property details -->
          <div class="cp-card apps-prop span1">
            <span class="apps-card-label">Property details</span>
            <div class="apps-prop-grid">
              <div><label>Stand number</label><p>{{ snapshot.permit.stand_number }}</p></div>
              <div><label>Ward / area</label><p>{{ snapshot.permit.suburb_ward }}</p></div>
              <div><label>Type</label><p class="cap">{{ (snapshot.permit.development_type || '—').replace(/_/g, ' ') }}</p></div>
              <div><label>Fee status</label><p :class="snapshot.permit.fee_paid ? 'ok' : 'warn'">{{ snapshot.permit.fee_paid ? 'Paid' : 'Outstanding' }}</p></div>
            </div>
            <div class="apps-contact">
              <span class="apps-card-label">Primary contact</span>
              <div class="apps-contact-row">
                <span class="apps-contact-ic"><User :size="16" /></span>
                <div><p class="t">{{ snapshot.permit.applicant_name }}</p><p class="s">{{ snapshot.permit.applicant_phone || '—' }}</p></div>
              </div>
            </div>
          </div>

          <!-- Council letters -->
          <div v-if="snapshot.letters.length" class="cp-card span3">
            <div class="cp-card-head between"><h3>Letters from Council</h3><span>{{ snapshot.letters.length }}</span></div>
            <ul class="apps-letters">
              <li v-for="l in snapshot.letters" :key="l.id">
                <Mail :size="18" />
                <div class="apps-letter-body">
                  <p class="t">{{ l.title || docLabel(l.doc_type) }}</p>
                  <p class="s">{{ fmtDate(l.created_at) }}<template v-if="l.version > 1"> · version {{ l.version }}</template></p>
                </div>
                <button type="button" class="apps-mini" :disabled="openingLetter === l.id" @click="viewLetter(l.id)">
                  {{ openingLetter === l.id ? 'Opening…' : 'Open' }}
                </button>
              </li>
            </ul>
          </div>

          <!-- Documents on the case file -->
          <div class="cp-card apps-docs span3">
            <div class="cp-card-head between">
              <h3>Documents on file</h3>
              <div class="apps-upload">
                <label class="sr-only" for="apps-upload-type">Document type</label>
                <select id="apps-upload-type" v-model="uploadType">
                  <option v-for="(label, key) in DOC_TYPE_LABELS" :key="key" :value="key">{{ label }}</option>
                </select>
                <button type="button" class="apps-mini" :disabled="uploading" @click="pickUpload">
                  <Upload :size="14" /> {{ uploading ? 'Uploading…' : 'Upload' }}
                </button>
                <input ref="uploadInput" type="file" class="sr-only" tabindex="-1" aria-hidden="true"
                       accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" @change="onUploadChosen" />
              </div>
            </div>
            <div v-if="!snapshot.documents.length" class="apps-empty-line">No documents on this case file yet.</div>
            <div v-else class="apps-doc-grid">
              <div v-for="d in snapshot.documents" :key="d.id" class="apps-doc">
                <FileText :size="20" />
                <p class="apps-doc-name" :title="d.file_name">{{ d.file_name || 'Document' }}</p>
                <p class="apps-doc-meta">{{ docLabel(d.doc_type) }}<template v-if="d.bytes"> · {{ fmtBytes(d.bytes) }}</template></p>
                <p class="apps-doc-meta">{{ fmtDate(d.uploaded_at) }}</p>
              </div>
            </div>
            <p class="apps-msg-note">PDF, JPG or PNG, up to 10 MB each. Uploads go straight to your case file.</p>
          </div>
        </div>
      </template>
    </section>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
/* Tokens (--cp-*) inherited from .cp-root */
.apps { display:flex; flex-direction:column; height:100%; min-height:0; }
.mono { font-family:var(--cp-mono); }

/* ── List pane ────────────────────────────────────────────────────── */
.apps-list { display:flex; flex-direction:column; min-height:0; position:relative; }
.apps-list-head { padding:1rem; border-bottom:1px solid var(--cp-border); background:var(--cp-surface); }
.apps-list-title { display:flex; align-items:center; gap:0.5rem; margin-bottom:0.75rem; }
.apps-list-title h2 { margin:0; font-size:1.05rem; font-weight:700; color:var(--cp-text); }
.apps-count { padding:0.1rem 0.5rem; border-radius:var(--cp-radius-pill); background:var(--cp-primary-tint); color:var(--cp-primary); font-size:0.66rem; font-weight:700; }
.apps-refresh { margin-left:auto; background:none; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); padding:0.3rem; color:var(--cp-muted); cursor:pointer; }
.spin { animation: appspin 0.8s linear infinite; }
@keyframes appspin { to { transform: rotate(360deg); } }
.apps-search { display:flex; align-items:center; gap:0.5rem; padding:0.45rem 0.7rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); background:var(--cp-surface); }
.apps-search :deep(svg) { color:var(--cp-faint); }
.apps-search:focus-within { outline:2px solid var(--cp-primary); outline-offset:2px; }
.apps-search input { flex:1; border:0; outline:none; background:transparent; font-size:0.85rem; color:var(--cp-text); }
.apps-tabs { display:flex; gap:0.4rem; margin-top:0.6rem; overflow-x:auto; }
.apps-tabs button { padding:0.35rem 0.7rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-pill);
  background:var(--cp-surface); font-size:0.74rem; font-weight:600; color:var(--cp-text-2); cursor:pointer; white-space:nowrap; }
.apps-tabs button.active { background:var(--cp-primary); color:var(--cp-on-primary); border-color:var(--cp-primary); }

.apps-empty, .apps-empty-line { padding:1.75rem 1rem; text-align:center; color:var(--cp-faint); font-size:0.82rem; }
.apps-empty p { margin:0 0 0.85rem; color:var(--cp-text-2); }
.apps-empty-cta {
  display:inline-flex; padding:0.55rem 1rem; background:var(--cp-primary); color:var(--cp-on-primary);
  border:0; border-radius:var(--cp-radius-sm); font-size:0.85rem; font-weight:600; cursor:pointer;
}
.apps-items { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:0.75rem; padding:1rem; }

/* Pills */
.pill { display:inline-flex; align-items:center; padding:0.15rem 0.55rem; border-radius:var(--cp-radius-pill);
  font-size:0.62rem; font-weight:700; letter-spacing:0.03em; text-transform:uppercase; white-space:nowrap; }
.pill-blue  { background:var(--cp-blue-bg);  color:var(--cp-blue-fg); }
.pill-green { background:var(--cp-green-bg); color:var(--cp-green-fg); }
.pill-amber { background:var(--cp-amber-bg); color:var(--cp-amber-fg); }
.pill-red   { background:var(--cp-red-bg);   color:var(--cp-red-fg); }
.pill-gray  { background:var(--cp-surface-2); color:var(--cp-muted); border:1px solid var(--cp-border); }

/* List item (card on mobile / row on desktop) */
.apps-item { display:block; width:100%; text-align:left; cursor:pointer;
  background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius); box-shadow:var(--cp-shadow);
  padding:1rem; transition:border-color .15s; }
.apps-item:hover { border-color:var(--cp-border-strong); }
.apps-item.active { border-color:var(--cp-primary); }
.apps-item-top { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; margin-bottom:0.5rem; }
.apps-ref { font-size:0.72rem; color:var(--cp-primary); font-weight:600; }
.apps-item-title { margin:0; font-size:0.92rem; font-weight:600; color:var(--cp-text); text-transform:capitalize; }
.apps-item-loc { display:flex; align-items:center; gap:0.3rem; margin:0.3rem 0 0; font-size:0.78rem; color:var(--cp-muted); }
.apps-item-foot { display:flex; align-items:center; gap:0.85rem; margin-top:0.75rem; padding-top:0.65rem; border-top:1px solid var(--cp-border); }
.apps-item-meta { display:inline-flex; align-items:center; gap:0.25rem; font-size:0.7rem; color:var(--cp-faint); }
.apps-item-action { margin-left:auto; padding:0.35rem 0.7rem; border:0; border-radius:var(--cp-radius-sm); font-size:0.74rem; font-weight:700; cursor:pointer;
  background:var(--cp-primary); color:var(--cp-on-primary); }
.apps-item-action.view { background:transparent; color:var(--cp-primary); }
.apps-item-action.download { background:var(--cp-surface-2); color:var(--cp-text-2); }

/* FAB (mobile) */
.apps-fab { position:fixed; bottom:calc(var(--cp-bottomnav-h) + 14px); right:18px; z-index:30;
  width:54px; height:54px; border-radius:50%; border:0; background:var(--cp-primary); color:#fff;
  box-shadow:var(--cp-shadow-pop); cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }

/* ── Detail pane ──────────────────────────────────────────────────── */
.apps-detail { display:none; flex-direction:column; min-height:0; overflow-y:auto; padding:1rem; gap:1rem; }
/* The detail pane scrolls; its children must never shrink to fit it.
   responsive.css sets a global min-height:0 which would otherwise let these
   flex children collapse below their content and paint over each other. */
.apps-detail > * { flex-shrink: 0; }
.apps-bento > * { min-height: fit-content; }
.apps-back { display:none; align-items:center; gap:0.4rem; align-self:flex-start; background:none; border:0; color:var(--cp-primary); font-size:0.82rem; font-weight:600; cursor:pointer; padding:0; }
.apps-noselect { margin:auto; text-align:center; color:var(--cp-faint); max-width:26rem; padding:3rem 1rem; }
.apps-noselect :deep(svg) { color:var(--cp-faint); }
.apps-noselect h3 { margin:0.5rem 0 0.25rem; font-size:1rem; color:var(--cp-text); }
.apps-noselect p { margin:0; font-size:0.84rem; line-height:1.5; }
.apps-loading { padding:2.5rem; text-align:center; color:var(--cp-faint); font-size:0.84rem; }

.apps-d-head { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; flex-wrap:wrap; }
.apps-crumbs { display:flex; align-items:center; gap:0.35rem; font-size:0.72rem; color:var(--cp-muted); margin-bottom:0.4rem; }
.apps-crumbs .cur { color:var(--cp-primary); font-weight:600; }
.apps-d-head h1 { margin:0; font-size:1.2rem; font-weight:700; letter-spacing:-0.01em; color:var(--cp-text); text-transform:capitalize; }
.apps-d-head p { margin:0.2rem 0 0; font-size:0.8rem; color:var(--cp-text-2); }
.apps-d-actions { display:flex; gap:0.5rem; }

.apps-btn { display:inline-flex; align-items:center; justify-content:center; gap:0.4rem; padding:0.5rem 0.9rem;
  border:1px solid transparent; border-radius:var(--cp-radius-sm); font-size:0.8rem; font-weight:600; cursor:pointer; }
.apps-btn.primary { background:var(--cp-primary); color:var(--cp-on-primary); }
.apps-btn.primary:hover { background:var(--cp-primary-hover); }
.apps-btn.ghost { background:var(--cp-surface); border-color:var(--cp-border); color:var(--cp-text-2); }
.apps-btn.ghost:hover { background:var(--cp-surface-2); }
.apps-btn.full { width:100%; }

/* Cards */
.cp-card { background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius); box-shadow:var(--cp-shadow); overflow:hidden; }
.cp-card-head { display:flex; align-items:center; padding:0.85rem 1.1rem; border-bottom:1px solid var(--cp-border); }
.cp-card-head.between { justify-content:space-between; }
.cp-card-head h3 { margin:0; font-size:0.92rem; font-weight:600; color:var(--cp-text); }
.cp-card-head span { font-size:0.72rem; color:var(--cp-muted); }
.apps-card-label { display:block; padding:1rem 1.1rem 0; font-size:0.64rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--cp-muted); }
.between { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; }

/* Bento */
.apps-bento { display:flex; flex-direction:column; gap:1rem; }

/* Lifecycle tracker */
.apps-lifecycle { padding-bottom:1.25rem; }
.apps-track { position:relative; display:flex; justify-content:space-between; padding:1.25rem 1.1rem 0; }
.apps-track-line { position:absolute; top:calc(1.25rem + 18px); left:2.5rem; right:2.5rem; height:2px; background:var(--cp-border); }
.apps-track-fill { height:100%; background:var(--cp-primary); transform-origin:left; transition:transform .4s var(--cp-ease); }
.apps-step { position:relative; z-index:1; display:flex; flex-direction:column; align-items:center; gap:0.35rem; text-align:center; width:5rem; }
.apps-step-node { display:inline-flex; align-items:center; justify-content:center; width:38px; height:38px; border-radius:50%;
  border:4px solid var(--cp-surface); background:var(--cp-surface-2); color:var(--cp-faint); }
.apps-step.done .apps-step-node { background:var(--cp-primary); color:#fff; }
.apps-step.active .apps-step-node { background:var(--cp-primary); color:#fff; animation:apspulse 1.6s ease-in-out infinite; }
@keyframes apspulse { 0%,100%{ box-shadow:0 0 0 0 var(--cp-primary-tint);} 50%{ box-shadow:0 0 0 6px var(--cp-primary-tint);} }
.apps-step-label { font-size:0.74rem; font-weight:600; color:var(--cp-text-2); }
.apps-step.done .apps-step-label, .apps-step.active .apps-step-label { color:var(--cp-text); }
.apps-step-sub { font-size:0.62rem; color:var(--cp-faint); }

/* Upcoming actions (dark) */
.apps-actions { display:flex; flex-direction:column; justify-content:space-between; gap:1rem;
  background:var(--cp-text); color:#fff; border-radius:var(--cp-radius); box-shadow:var(--cp-shadow); padding:1.1rem; }
.apps-actions-head { display:flex; align-items:center; gap:0.5rem; }
.apps-actions-head :deep(svg) { color:#fca5a5; }
.apps-actions-head h3 { margin:0; font-size:0.95rem; font-weight:700; }
.apps-actions-lead { margin:0.5rem 0 0.85rem; font-size:0.8rem; line-height:1.5; opacity:0.85; }
.apps-action-item { display:flex; gap:0.6rem; padding:0.7rem; border-radius:var(--cp-radius-sm); background:rgba(255,255,255,0.08); }
.apps-action-item :deep(svg) { color:#93ccff; flex-shrink:0; }
.apps-action-item .t { margin:0; font-size:0.78rem; font-weight:700; }
.apps-action-item .s { margin:0.1rem 0 0; font-size:0.7rem; opacity:0.7; }

/* Technical feedback */
.apps-fb-list { padding:1rem 1.1rem; display:flex; flex-direction:column; gap:0.75rem; }
.apps-fb { display:flex; gap:0.85rem; padding:0.85rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); background:var(--cp-surface-2); }
.apps-fb-ic { display:inline-flex; align-items:center; justify-content:center; width:38px; height:38px; flex-shrink:0;
  border-radius:50%; background:var(--cp-blue-bg); color:var(--cp-blue-fg); }
.apps-fb-ic.warn { background:var(--cp-red-bg); color:var(--cp-red-fg); }
.apps-fb-body { flex:1; min-width:0; }
.apps-fb-body h4 { margin:0; font-size:0.85rem; font-weight:700; color:var(--cp-text); text-transform:capitalize; }
.apps-fb-quote { margin:0.4rem 0; font-size:0.8rem; color:var(--cp-text-2); line-height:1.5; font-style:italic; }
.apps-fb-when { margin:0; font-size:0.7rem; color:var(--cp-faint); }

/* Property */
.apps-prop-grid { display:grid; grid-template-columns:1fr 1fr; gap:0.85rem; padding:0.85rem 1.1rem; }
.apps-prop-grid label { display:block; font-size:0.6rem; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:var(--cp-faint); }
.apps-prop-grid p { margin:0.15rem 0 0; font-size:0.84rem; font-weight:600; color:var(--cp-text); }
.apps-prop-grid p.cap { text-transform:capitalize; }
.apps-prop-grid p.ok { color:var(--cp-green-fg); }
.apps-prop-grid p.warn { color:var(--cp-amber-fg); }
.apps-contact { padding:0 1.1rem 1.1rem; }
.apps-contact-row { display:flex; align-items:center; gap:0.6rem; margin-top:0.5rem; }
.apps-contact-ic { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:var(--cp-radius-sm); background:var(--cp-surface-2); color:var(--cp-muted); }
.apps-contact-row .t { margin:0; font-size:0.82rem; font-weight:600; color:var(--cp-text); }
.apps-contact-row .s { margin:0; font-size:0.72rem; color:var(--cp-muted); }

/* Documents */
.apps-mini { display:inline-flex; align-items:center; gap:0.3rem; padding:0.3rem 0.6rem; border:0; border-radius:var(--cp-radius-sm);
  background:var(--cp-primary-tint); color:var(--cp-primary); font-size:0.72rem; font-weight:600; cursor:pointer; }
.apps-doc-grid { padding:1rem 1.1rem; display:grid; grid-template-columns:repeat(2, 1fr); gap:0.75rem; }
.apps-doc { padding:0.85rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); background:var(--cp-surface); }
.apps-doc :deep(svg) { color:var(--cp-primary); }
.apps-doc-name { margin:0.4rem 0 0; font-size:0.8rem; font-weight:600; color:var(--cp-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.apps-doc-meta { margin:0.1rem 0 0; font-size:0.66rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--cp-faint); }

.apps-mini:disabled { opacity:0.6; cursor:default; }
.apps-upload { display:flex; align-items:center; gap:0.4rem; }
.apps-upload select { max-width:12rem; padding:0.28rem 0.45rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm);
  background:var(--cp-surface); font-size:0.74rem; color:var(--cp-text); }

/* Messages + letters */
.apps-msgs { list-style:none; margin:0; padding:1rem 1.1rem 0; display:flex; flex-direction:column; gap:0.75rem; }
.apps-msg { display:flex; gap:0.85rem; padding:0.85rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); background:var(--cp-surface); }
.apps-msg.req { border-color:var(--cp-amber-fg); background:var(--cp-amber-bg); }
.apps-msg-body { margin:0.35rem 0 0; font-size:0.84rem; line-height:1.55; color:var(--cp-text); white-space:pre-line; }
.apps-msg-note { margin:0; padding:0.75rem 1.1rem 1rem; font-size:0.74rem; color:var(--cp-muted); }
.apps-letters { list-style:none; margin:0; padding:0; }
.apps-letters li { display:flex; align-items:center; gap:0.75rem; padding:0.75rem 1.1rem; border-bottom:1px solid var(--cp-border); }
.apps-letters li:last-child { border-bottom:0; }
.apps-letters li > :deep(svg) { color:var(--cp-primary); flex-shrink:0; }
.apps-letter-body { flex:1; min-width:0; }
.apps-letter-body .t { margin:0; font-size:0.84rem; font-weight:600; color:var(--cp-text); }
.apps-letter-body .s { margin:0.1rem 0 0; font-size:0.72rem; color:var(--cp-muted); }

/* ── Mobile master-detail switching ───────────────────────────────── */
@media (max-width: 1023px) {
  .apps.has-sel .apps-list { display:none; }
  .apps.has-sel .apps-detail { display:flex; }
  .apps-back { display:inline-flex; }
}

/* ── Desktop: both panes ──────────────────────────────────────────── */
@media (min-width: 1024px) {
  .apps { flex-direction:row; }
  .apps-list { width:34%; max-width:26rem; border-right:1px solid var(--cp-border); }
  .apps-fab { display:none; }
  .apps-detail { display:flex; flex:1; }
  .apps-bento { display:grid; grid-template-columns:repeat(3, 1fr); }
  .span1 { grid-column:span 1; }
  .span2 { grid-column:span 2; }
  .span3 { grid-column:span 3; }
  .apps-doc-grid { grid-template-columns:repeat(4, 1fr); }
}
</style>
