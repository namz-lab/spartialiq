<script setup lang="ts">
// Identity document upload + AI verification.
//
// The citizen uploads their national ID once. The backend runs the configured
// verifier (the Claude vision model when enabled) which checks the image
// is legible ("is it visible or not") and that it is the right kind of
// document, then extracts the ID number. The result — verified / under review
// / rejected, with a plain-language reason — is shown here immediately, and
// the verified document is reused across every application.

import { ref, computed, onMounted, watch } from 'vue'
import { documentsService, type CitizenDocument } from '@/services/documentsService'
import {
  ShieldCheck, ShieldAlert, ShieldQuestion, UploadCloud, Loader2, RefreshCw,
} from 'lucide-vue-next'

const emit = defineEmits<{
  /** Fired when the AI extracts an ID number (even before staff sign-off),
   *  so the form can adopt it. */
  (e: 'extracted', idNumber: string | null): void
}>()

const current = ref<CitizenDocument | null>(null)
const loading = ref(false)
const uploading = ref(false)
const error = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const status = computed(() => current.value?.verificationStatus ?? null)

const badge = computed(() => {
  switch (status.value) {
    case 'verified':     return { label: 'Identity verified',     cls: 'ok',   icon: ShieldCheck }
    case 'rejected':     return { label: 'Not accepted',          cls: 'bad',  icon: ShieldAlert }
    case 'under_review': return { label: 'With officer for review', cls: 'wait', icon: ShieldQuestion }
    case 'pending':      return { label: 'Received',              cls: 'wait', icon: ShieldQuestion }
    default:             return null
  }
})

async function loadExisting() {
  loading.value = true
  error.value = null
  try {
    const mine = await documentsService.listMine()
    // Most recent national_id document wins (listMine returns newest first).
    current.value = mine.find(d => d.docKind === 'national_id') ?? null
    if (current.value?.extractedIdNumber) {
      emit('extracted', current.value.extractedIdNumber)
    }
  } catch {
    // Not signed in yet, or the endpoint is unreachable — stay quiet and let
    // the citizen upload; the upload call surfaces a real error if needed.
    current.value = null
  } finally {
    loading.value = false
  }
}

function pick() { fileInput.value?.click() }

async function onFileChosen(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploading.value = true
  error.value = null
  try {
    const doc = await documentsService.upload(file, 'national_id')
    current.value = doc
    // The AI extracts the number during triage, before staff sign-off — adopt
    // it now so the form is filled while the officer reviews.
    if (doc.extractedIdNumber) {
      emit('extracted', doc.extractedIdNumber)
    }
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: { error?: string; message?: string } } }
    if (e.response?.status === 409) {
      error.value = 'You have already uploaded this exact file.'
    } else if (e.response?.status === 415 || e.response?.status === 413) {
      error.value = 'Use a clear JPG, PNG or PDF under 12 MB.'
    } else {
      error.value = e.response?.data?.message || 'Upload failed — please try again.'
    }
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

onMounted(loadExisting)
// Re-emit the extracted ID once it lands after the parent has mounted.
watch(() => current.value?.extractedIdNumber, id => {
  if (id) emit('extracted', id)
})
</script>

<template>
  <div class="idv">
    <header class="idv-head">
      <ShieldCheck :size="13" />
      <strong>Identity document</strong>
      <span v-if="badge" class="idv-badge" :class="badge.cls">
        <component :is="badge.icon" :size="11" /> {{ badge.label }}
      </span>
    </header>

    <div v-if="loading" class="idv-row muted">
      <Loader2 :size="13" class="spin" /> Checking your verified documents…
    </div>

    <template v-else>
      <!-- Verified by a council officer -->
      <div v-if="status === 'verified'" class="idv-state ok">
        <p>
          A council officer has verified your national ID. It will be reused for
          every application — you do not need to upload it again.
        </p>
        <p v-if="current?.extractedIdNumber" class="idv-extract">
          ID number on file: <strong>{{ current.extractedIdNumber }}</strong>
        </p>
        <button type="button" class="idv-link" @click="pick" :disabled="uploading">
          <RefreshCw :size="11" /> Replace document
        </button>
      </div>

      <!-- Rejected by a council officer -->
      <div v-else-if="status === 'rejected'" class="idv-state bad">
        <p>{{ current?.verificationNotes || 'A council officer could not accept this document. Please upload a clearer copy.' }}</p>
        <button type="button" class="idv-btn" @click="pick" :disabled="uploading">
          <UploadCloud :size="13" /> Upload a clearer copy
        </button>
      </div>

      <!-- AI checked → with a council officer for the final decision -->
      <div v-else-if="status === 'under_review' || status === 'pending'" class="idv-state wait">
        <p>{{ current?.verificationNotes || 'Your document has been received. Our automatic check has run and a council officer will confirm it. You can continue your application.' }}</p>
        <p v-if="current?.extractedIdNumber" class="idv-extract">
          ID number read: <strong>{{ current.extractedIdNumber }}</strong>
        </p>
        <button type="button" class="idv-link" @click="pick" :disabled="uploading">
          <RefreshCw :size="11" /> Upload a different copy
        </button>
      </div>

      <!-- Nothing uploaded yet -->
      <div v-else class="idv-state empty">
        <p>
          Upload a photo or scan of your national ID. An automatic check runs
          first, then a council officer confirms it. Once accepted it is reused
          for all your applications.
        </p>
        <button type="button" class="idv-btn" @click="pick" :disabled="uploading">
          <UploadCloud :size="13" /> Upload national ID
        </button>
      </div>

      <div v-if="uploading" class="idv-row muted">
        <Loader2 :size="13" class="spin" /> Uploading and verifying…
      </div>
      <p v-if="error" class="idv-error">{{ error }}</p>
    </template>

    <input
      ref="fileInput" type="file"
      accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
      style="display:none" @change="onFileChosen"
    />
  </div>
</template>

<style scoped>
.idv { border:1px solid #e2e8f0; border-radius:0.45rem; background:#f8fafc; padding:0.6rem 0.75rem;
  display:flex; flex-direction:column; gap:0.5rem; }
.idv-head { display:flex; align-items:center; gap:0.4rem; font-size:0.72rem; color:#0f172a; }
.idv-head svg { color:#0284c7; }
.idv-badge { margin-left:auto; display:inline-flex; align-items:center; gap:0.25rem;
  font-size:0.58rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;
  padding:0.15rem 0.4rem; border-radius:999px; }
.idv-badge.ok   { background:#dcfce7; color:#166534; }
.idv-badge.bad  { background:#fee2e2; color:#991b1b; }
.idv-badge.wait { background:#fef9c3; color:#854d0e; }

.idv-state { font-size:0.7rem; color:#475569; display:flex; flex-direction:column; gap:0.45rem; }
.idv-state p { margin:0; line-height:1.5; }
.idv-state.ok  { color:#166534; }
.idv-state.bad { color:#991b1b; }
.idv-extract { color:#0f172a !important; }

.idv-btn { align-self:flex-start; display:inline-flex; align-items:center; gap:0.35rem;
  padding:0.4rem 0.7rem; background:#0284c7; color:#fff; border:none; border-radius:0.3rem;
  font-size:0.68rem; font-weight:600; cursor:pointer; }
.idv-btn:hover:not(:disabled) { background:#0369a1; }
.idv-btn:disabled { background:#cbd5e1; cursor:not-allowed; }

.idv-link { align-self:flex-start; display:inline-flex; align-items:center; gap:0.3rem;
  background:none; border:none; color:#0284c7; font-size:0.64rem; font-weight:600; cursor:pointer; padding:0; }
.idv-link:hover:not(:disabled) { text-decoration:underline; }
.idv-link:disabled { color:#94a3b8; cursor:not-allowed; }

.idv-row { display:flex; align-items:center; gap:0.4rem; font-size:0.68rem; }
.idv-row.muted { color:#64748b; }
.idv-error { margin:0; font-size:0.66rem; color:#dc2626; }

.spin { animation: idv-spin 0.8s linear infinite; }
@keyframes idv-spin { to { transform: rotate(360deg); } }
</style>
