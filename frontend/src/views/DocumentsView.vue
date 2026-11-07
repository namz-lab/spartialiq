<template>
  <div class="docs-page">
    <header class="page-topbar">
      <router-link to="/" class="page-back" aria-label="Back to home">
        <ArrowLeft :size="14" aria-hidden="true" />
        <span>Vungu Portal</span>
      </router-link>
    </header>

    <main class="page-stage">
      <header class="page-head">
        <p class="eyebrow">Identity & ownership</p>
        <h1 class="page-title">Verifiable documents</h1>
        <p class="page-lede">
          Upload your ID, proof of residence and title deeds. The council
          checks each document; once verified, you can attach it to any
          application without re-uploading.
        </p>
      </header>

      <!-- ── Upload form ─────────────────────────────────────────── -->
      <section class="card" aria-labelledby="up-h">
        <h2 id="up-h" class="card-title">Upload a document</h2>

        <div class="form-grid">
          <div class="field">
            <label for="doc-kind">Document type</label>
            <select id="doc-kind" v-model="docKind" class="input" required>
              <option value="national_id">National ID</option>
              <option value="passport">Passport</option>
              <option value="drivers_licence">Driver's licence</option>
              <option value="proof_of_residence">Proof of residence</option>
              <option value="title_deed">Title deed</option>
              <option value="company_registration">Company registration</option>
              <option value="tax_clearance">Tax clearance</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div class="field">
            <label for="doc-file">File</label>
            <input
              id="doc-file"
              ref="fileInput"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/heic,image/webp"
              class="input file"
              @change="onFileChange"
            />
            <p class="hint">PDF, JPG, PNG or HEIC. Max 12 MB.</p>
          </div>

          <p v-if="uploadError" class="banner banner-error" role="alert">
            {{ uploadError }}
          </p>
          <p v-if="uploadSuccess" class="banner banner-info" role="status" aria-live="polite">
            {{ uploadSuccess }}
          </p>

          <div class="actions">
            <button
              type="button"
              class="btn-solid"
              :disabled="busy || !file"
              :aria-busy="busy || undefined"
              @click="upload"
            >
              {{ busy ? 'Uploading…' : 'Upload' }}
            </button>
          </div>
        </div>
      </section>

      <!-- ── My documents ────────────────────────────────────────── -->
      <section class="card" aria-labelledby="mine-h">
        <header class="card-head-row">
          <h2 id="mine-h" class="card-title">My documents</h2>
          <button
            type="button"
            class="btn-ghost btn-sm"
            :disabled="loadingList"
            @click="load"
          >
            {{ loadingList ? 'Loading…' : 'Refresh' }}
          </button>
        </header>

        <div v-if="!loadingList && docs.length === 0" class="empty">
          You haven't uploaded any documents yet.
        </div>

        <ul v-else class="doc-list">
          <li
            v-for="d in docs"
            :key="d.id"
            class="doc-row"
          >
            <div class="doc-row-main">
              <p class="doc-kind">{{ kindLabel(d.docKind) }}</p>
              <p class="doc-meta mono">
                {{ d.mimeType.split('/').pop()?.toUpperCase() }} ·
                {{ formatBytes(d.bytes) }} ·
                {{ formatDate(d.createdAt) }}
              </p>
              <p v-if="d.extractedName" class="doc-extract">
                {{ d.extractedName }}
                <span v-if="d.extractedIdNumber" class="mono">— {{ d.extractedIdNumber }}</span>
              </p>
              <p v-if="d.verificationNotes" class="doc-notes">{{ d.verificationNotes }}</p>
            </div>
            <div class="doc-row-side">
              <span :class="['pill', `pill-${d.verificationStatus}`]">
                {{ statusLabel(d.verificationStatus) }}
              </span>
              <a
                :href="d.storageUrl"
                target="_blank"
                rel="noopener"
                class="link-quiet"
                :aria-label="`View ${kindLabel(d.docKind)}`"
              >View</a>
              <button
                v-if="['pending','under_review'].includes(d.verificationStatus)"
                type="button"
                class="btn-ghost btn-sm"
                :disabled="busy"
                @click="remove(d.id)"
              >
                Delete
              </button>
            </div>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'
import {
  documentsService,
  type CitizenDocument,
  type DocKind,
  type VerificationStatus,
} from '../services/documentsService'

const docKind = ref<DocKind>('national_id')
const fileInput = ref<HTMLInputElement | null>(null)
const file = ref<File | null>(null)

const busy          = ref(false)
const uploadError   = ref('')
const uploadSuccess = ref('')

const loadingList = ref(false)
const docs        = ref<CitizenDocument[]>([])

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  file.value = target.files?.[0] ?? null
  uploadError.value = ''
  uploadSuccess.value = ''
}

async function upload() {
  if (!file.value) return
  uploadError.value = ''
  uploadSuccess.value = ''
  busy.value = true
  try {
    const created = await documentsService.upload(file.value, docKind.value)
    uploadSuccess.value = `Uploaded — status ${statusLabel(created.verificationStatus)}.`
    file.value = null
    if (fileInput.value) fileInput.value.value = ''
    await load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string; message?: string } } }
    uploadError.value =
      e.response?.data?.message ||
      e.response?.data?.error ||
      'Upload failed.'
  } finally {
    busy.value = false
  }
}

async function load() {
  loadingList.value = true
  try {
    docs.value = await documentsService.listMine()
  } catch {
    docs.value = []
  } finally {
    loadingList.value = false
  }
}

async function remove(id: string) {
  busy.value = true
  try {
    await documentsService.remove(id)
    await load()
  } catch {
    // No-op: list reload below makes UI consistent.
  } finally {
    busy.value = false
  }
}

function statusLabel(s: VerificationStatus): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const kindLabels: Record<DocKind, string> = {
  national_id:          'National ID',
  passport:             'Passport',
  drivers_licence:      "Driver's licence",
  proof_of_residence:   'Proof of residence',
  title_deed:           'Title deed',
  // Residency proofs. Wording matches ResidencyVerificationView so a citizen
  // sees the same name for a document in both places.
  settlement_letter:      'Settlement / offer letter',
  lodgers_permit:         "Lodger's permit",
  occupation_certificate: 'Certificate of occupation',
  chiefs_letter:          'Chief / councillor letter',
  company_registration: 'Company registration',
  tax_clearance:        'Tax clearance',
  other:                'Other',
}
function kindLabel(k: DocKind): string { return kindLabels[k] ?? k }

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(2)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit',
  })
}

onMounted(load)
</script>

<style scoped>
/* Mirrors PaymentsView's page chrome — same tokens, same shadows. */
.docs-page {
  min-height: 100dvh;
  background:
    radial-gradient(900px 500px at 10% -10%, rgba(30, 107, 74, 0.06), transparent 60%),
    #fbfbf8;
  font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
  color: #0b1220;
  display: flex;
  flex-direction: column;
}
.page-topbar { padding: 1rem 1.5rem; }
.page-back {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: #404a59;
  text-decoration: none;
  transition: color 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.page-back:hover { color: #0b1220; }
.page-stage {
  flex: 1;
  max-width: 56rem;
  margin: 0 auto;
  padding: clamp(1rem, 4vw, 3rem) clamp(1rem, 4vw, 2rem) 4rem;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.page-head { padding-bottom: 0.5rem; }
.eyebrow {
  font-size: 0.7rem; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: #5b6473;
  margin: 0 0 0.75rem;
}
.page-title {
  font-family: 'Fraunces', ui-serif, Georgia, serif;
  font-weight: 600;
  font-size: clamp(1.75rem, 3vw + 0.5rem, 2.5rem);
  letter-spacing: -0.02em;
  margin: 0 0 0.5rem;
  line-height: 1.1;
}
.page-lede {
  margin: 0; font-size: 1rem; line-height: 1.55; color: #5b6473;
  max-width: 56ch;
}

.card {
  background: #ffffff;
  border: 1px solid #e2e6ec;
  border-radius: 12px;
  padding: 1.25rem;
  box-shadow: 0 12px 28px -22px rgba(11, 18, 32, 0.18);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.card-title {
  font-family: 'Fraunces', ui-serif, Georgia, serif;
  font-weight: 600; font-size: 1.15rem; letter-spacing: -0.01em;
  margin: 0;
}
.card-head-row {
  display: flex; align-items: baseline; justify-content: space-between; gap: 1rem;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem 1rem;
}
@media (max-width: 540px) { .form-grid { grid-template-columns: 1fr; } }

.field { display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; }
.field label {
  font-size: 0.78rem; font-weight: 500; letter-spacing: 0.01em; color: #404a59;
}
.input {
  width: 100%;
  padding: 0.6rem 0.85rem;
  border: 1px solid #dde1e8;
  border-radius: 8px;
  background: #fbfbf8;
  font: 500 0.9375rem/1.4 inherit;
  color: #0b1220;
  font-family: inherit;
  transition: border-color 160ms cubic-bezier(0.23, 1, 0.32, 1),
              box-shadow 160ms cubic-bezier(0.23, 1, 0.32, 1);
  box-sizing: border-box;
}
.input:focus {
  outline: none;
  border-color: #1e6b4a;
  box-shadow: 0 0 0 3px rgba(30, 107, 74, 0.18);
  background: #fff;
}
.input.file { padding: 0.4rem 0.5rem; cursor: pointer; }
.hint { margin: 0; font-size: 0.74rem; color: #8e96a4; }

.actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; }

.btn-solid {
  display: inline-flex; align-items: center; justify-content: center;
  height: 2.5rem; padding: 0 1rem;
  background: #0b1220; color: #fff;
  font: 600 0.9375rem/1 inherit;
  border-radius: 8px; border: 1px solid #0b1220; cursor: pointer;
  transition: background-color 160ms cubic-bezier(0.23, 1, 0.32, 1),
              transform 100ms cubic-bezier(0.23, 1, 0.32, 1),
              box-shadow 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.btn-solid:hover:not(:disabled)  { background: #1a1f29; box-shadow: 0 6px 16px -8px rgba(11, 18, 32, 0.4); }
.btn-solid:active:not(:disabled) { transform: scale(0.985); }
.btn-solid:disabled              { opacity: 0.55; cursor: not-allowed; }

.btn-ghost {
  display: inline-flex; align-items: center; justify-content: center;
  height: 2.25rem; padding: 0 0.85rem;
  background: transparent; color: #404a59;
  font: 500 0.875rem/1 inherit;
  border-radius: 8px; border: 1px solid #dde1e8; cursor: pointer;
  transition: background-color 160ms cubic-bezier(0.23, 1, 0.32, 1),
              border-color 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.btn-ghost:hover:not(:disabled) { background: #f7f8fa; border-color: #c0c6d1; color: #0b1220; }
.btn-ghost:active:not(:disabled) { transform: scale(0.985); }
.btn-sm { height: 2rem; padding: 0 0.65rem; font-size: 0.78rem; }

.banner {
  grid-column: 1 / -1;
  font-size: 0.85rem;
  padding: 0.55rem 0.75rem;
  border-radius: 8px;
}
.banner-info  { background: #eef6f1; color: #0d3624; border: 1px solid #aed5be; }
.banner-error { background: #fef3f2; color: #9a1c12; border: 1px solid #fcd9d4; }

.empty { font-size: 0.875rem; color: #5b6473; font-style: italic; }
.mono  { font-family: 'Geist Mono', ui-monospace, monospace; }

.doc-list {
  list-style: none;
  margin: 0; padding: 0;
  display: flex; flex-direction: column;
}
.doc-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0;
  border-top: 1px solid #eef0f4;
}
.doc-row:first-child { border-top: 0; }

.doc-row-main { min-width: 0; }
.doc-kind   { margin: 0; font-size: 0.95rem; font-weight: 600; color: #0b1220; }
.doc-meta   { margin: 0.15rem 0 0; font-size: 0.74rem; color: #8e96a4; }
.doc-extract { margin: 0.4rem 0 0; font-size: 0.85rem; color: #404a59; }
.doc-notes  { margin: 0.25rem 0 0; font-size: 0.8rem; color: #5b6473; font-style: italic; }

.doc-row-side {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.link-quiet {
  font-size: 0.78rem;
  color: #404a59;
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: color 160ms cubic-bezier(0.23, 1, 0.32, 1),
              border-color 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.link-quiet:hover { color: #0b1220; border-bottom-color: #c0c6d1; }

.pill {
  display: inline-flex;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  font-weight: 600;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: #f7f8fa;
  color: #404a59;
  border: 1px solid #eef0f4;
}
.pill-verified     { background: #eef6f1; color: #0d3624; border-color: #aed5be; }
.pill-pending,
.pill-under_review { background: #fef7e6; color: #93390a; border-color: #fdecc4; }
.pill-rejected     { background: #fef3f2; color: #9a1c12; border-color: #fcd9d4; }
.pill-expired      { background: #f7f8fa; color: #5b6473; border-color: #dde1e8; }
</style>
