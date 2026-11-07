<template>
  <div class="pr-page">
    <header class="page-topbar">
      <router-link to="/" class="page-back" aria-label="Back to home">
        <ArrowLeft :size="14" aria-hidden="true" />
        <span>Vungu Portal</span>
      </router-link>
    </header>

    <main class="page-stage">
      <header class="page-head">
        <p class="eyebrow">Plan auto-review</p>
        <h1 class="page-title">Submit your building plan</h1>
        <p class="page-lede">
          Upload your plan as a PDF or CAD file. The system runs an
          automatic check against the
          <em>Development Management/Control Manual&nbsp;2021</em> and lists
          anything missing before a planner reviews it.
        </p>
      </header>

      <!-- ── Application reference -------------------------------------- -->
      <section class="card">
        <div class="form-grid">
          <div class="field">
            <label for="app-id">Application reference</label>
            <input
              id="app-id"
              v-model.trim="applicationId"
              class="input mono"
              placeholder="DEV-12345"
              required
            />
            <p class="hint">
              Find this on your application confirmation. Don't have one?
              <router-link :to="{ path: '/citizen', query: { section: 'new' } }" class="link">Start an application</router-link>.
            </p>
          </div>
        </div>
      </section>

      <!-- ── Reference figures (Manual 2021) ---------------------------- -->
      <section class="card refs" aria-label="Reference figures from the Manual">
        <h2 class="card-title">What a typical site plan looks like</h2>
        <p class="refs-lede">
          From the Development Management/Control Manual&nbsp;2021, §4.3.7.
          Your plan should include similar elements: parcel boundary,
          dimensions, road frontage, sewer connection, north arrow,
          scale.
        </p>
        <figure class="ref-fig">
          <img
            src="/manual/typical-site-plan.png"
            alt="Typical site plan from Manual 2021 — parcel with road frontage, sewer line, septic tank, building footprint and dimensions"
            loading="lazy"
          />
          <figcaption>Manual 2021, Fig 10 — Typical site plan</figcaption>
        </figure>
      </section>

      <!-- ── Upload ----------------------------------------------------- -->
      <section class="card" aria-labelledby="upload-h">
        <h2 id="upload-h" class="card-title">Upload your plan</h2>

        <div class="form-grid">
          <div class="field">
            <label for="plan-file">Plan file</label>
            <input
              id="plan-file"
              ref="fileInput"
              type="file"
              accept="application/pdf,application/acad,application/x-dwg,application/dxf,application/octet-stream"
              class="input file"
              @change="onFileChange"
            />
            <p class="hint">PDF preferred. DWG/DXF accepted. Max 60 MB.</p>
          </div>

          <p v-if="uploadError" class="banner banner-error" role="alert">
            {{ uploadError }}
          </p>

          <div class="actions">
            <button
              type="button"
              class="btn-solid"
              :disabled="busy || !file || !applicationId"
              :aria-busy="busy || undefined"
              @click="upload"
            >
              {{ busy ? 'Running checks…' : 'Upload & auto-review' }}
            </button>
          </div>
        </div>
      </section>

      <!-- ── Latest result ------------------------------------------------ -->
      <section v-if="latest" class="card" aria-label="Auto-review result">
        <header class="card-head-row">
          <h2 class="card-title">Auto-review result</h2>
          <span :class="['pill', `pill-${latest.status}`]">{{ statusLabel(latest.status) }}</span>
        </header>

        <p v-if="latest.status === 'auto_passed'" class="banner banner-info">
          Looks good. Your plan passed the automated checks. A planner
          will review and respond.
        </p>
        <p v-else-if="latest.status === 'auto_warnings'" class="banner banner-warn">
          Plan was accepted with warnings. Review them below — most are
          missing labels you may want to add before the planner sees it.
        </p>
        <p v-else-if="latest.status === 'auto_failed'" class="banner banner-error">
          Plan did not pass the automated checks. Fix the errors below and
          upload a new version.
        </p>

        <div v-if="latest.findings.length === 0" class="empty">
          No findings.
        </div>
        <ul v-else class="findings">
          <li
            v-for="(f, i) in latest.findings"
            :key="i"
            :class="['finding', `finding-${f.severity}`]"
          >
            <span class="finding-tag">{{ severityLabel(f.severity) }}</span>
            <span class="finding-msg">
              {{ f.message }}
              <small v-if="f.source?.manualSection" class="finding-cite">
                Manual 2021, §{{ f.source.manualSection }}
              </small>
            </span>
          </li>
        </ul>
      </section>

      <!-- ── History --------------------------------------------------- -->
      <section v-if="applicationId" class="card" aria-labelledby="hist-h">
        <header class="card-head-row">
          <h2 id="hist-h" class="card-title">Previous uploads</h2>
          <button
            type="button"
            class="btn-ghost btn-sm"
            :disabled="loadingList"
            @click="loadHistory"
          >
            {{ loadingList ? 'Loading…' : 'Refresh' }}
          </button>
        </header>

        <div v-if="!loadingList && history.length === 0" class="empty">
          No uploads yet for this application.
        </div>
        <ul v-else class="history">
          <li
            v-for="r in history"
            :key="r.id"
            class="history-row"
          >
            <div>
              <p class="history-title mono">{{ r.id.slice(0, 8) }}…</p>
              <p class="history-meta mono">
                {{ r.mimeType.split('/').pop()?.toUpperCase() }} ·
                {{ formatDate(r.createdAt) }}
              </p>
            </div>
            <span :class="['pill', `pill-${r.status}`]">{{ statusLabel(r.status) }}</span>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import {
  planReviewService,
  type PlanReview,
  type PlanReviewWithFindings,
  type PlanReviewStatus,
  type FindingSeverity,
} from '../services/planReviewService'

const route = useRoute()

const applicationId = ref<string>(
  String(route.query?.app ?? route.query?.application ?? ''),
)

const fileInput   = ref<HTMLInputElement | null>(null)
const file        = ref<File | null>(null)
const latest      = ref<PlanReviewWithFindings | null>(null)
const history     = ref<PlanReview[]>([])
const busy        = ref(false)
const uploadError = ref('')
const loadingList = ref(false)

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  file.value = target.files?.[0] ?? null
  uploadError.value = ''
}

async function upload() {
  if (!file.value || !applicationId.value) return
  busy.value = true
  uploadError.value = ''
  try {
    latest.value = await planReviewService.upload(applicationId.value, file.value)
    file.value = null
    if (fileInput.value) fileInput.value.value = ''
    await loadHistory()
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

async function loadHistory() {
  if (!applicationId.value) {
    history.value = []
    return
  }
  loadingList.value = true
  try {
    history.value = await planReviewService.list(applicationId.value)
  } catch {
    history.value = []
  } finally {
    loadingList.value = false
  }
}

watch(applicationId, () => { loadHistory() })

function statusLabel(s: PlanReviewStatus): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
function severityLabel(s: FindingSeverity): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit',
  })
}

onMounted(loadHistory)
</script>

<style scoped>
.pr-page {
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
.page-lede { margin: 0; font-size: 1rem; line-height: 1.55; color: #5b6473; max-width: 56ch; }

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

/* ── Reference figure card ──────────────────────────────────────── */
.refs { background: #fbfbf8; }
.refs-lede {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.55;
  color: #5b6473;
  max-width: 56ch;
}
.ref-fig {
  margin: 0;
  background: #ffffff;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  padding: 0.75rem;
}
.ref-fig img {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 4px;
}
.ref-fig figcaption {
  margin-top: 0.5rem;
  font-size: 0.74rem;
  color: #8e96a4;
  font-style: italic;
}

/* ── Form ─────────────────────────────────────────────────────────── */
.form-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem 1rem;
}
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
.input.mono { font-family: 'Geist Mono', ui-monospace, monospace; }
.input.file { padding: 0.4rem 0.5rem; cursor: pointer; }
.hint  { margin: 0; font-size: 0.74rem; color: #8e96a4; }
.link  { color: #1e6b4a; text-decoration: none; }
.link:hover { text-decoration: underline; }

.actions { display: flex; justify-content: flex-end; }

/* ── Buttons (shared with PaymentsView/DocumentsView vocabulary) ─── */
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

/* ── Banners ──────────────────────────────────────────────────────── */
.banner {
  font-size: 0.85rem;
  padding: 0.55rem 0.75rem;
  border-radius: 8px;
}
.banner-info  { background: #eef6f1; color: #0d3624; border: 1px solid #aed5be; }
.banner-warn  { background: #fef7e6; color: #93390a; border: 1px solid #fdecc4; }
.banner-error { background: #fef3f2; color: #9a1c12; border: 1px solid #fcd9d4; }

/* ── Findings ────────────────────────────────────────────────────── */
.findings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.finding {
  display: grid;
  grid-template-columns: 5rem 1fr;
  align-items: start;
  gap: 0.6rem;
  padding: 0.55rem 0.7rem;
  border-radius: 8px;
  border: 1px solid #eef0f4;
  background: #fbfbf8;
}
.finding-tag {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #5b6473;
}
.finding-msg { font-size: 0.875rem; line-height: 1.5; color: #0b1220; }
.finding-cite { display: block; font-size: 0.74rem; color: #8e96a4; font-style: italic; margin-top: 0.15rem; }
.finding-info  { background: #f7f8fa; }
.finding-warn  { background: #fef7e6; border-color: #fdecc4; }
.finding-warn  .finding-tag { color: #93390a; }
.finding-error { background: #fef3f2; border-color: #fcd9d4; }
.finding-error .finding-tag { color: #9a1c12; }

/* ── History ─────────────────────────────────────────────────────── */
.history {
  list-style: none;
  margin: 0;
  padding: 0;
}
.history-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.6rem 0;
  border-top: 1px solid #eef0f4;
}
.history-row:first-child { border-top: 0; }
.history-title { margin: 0; font-size: 0.85rem; }
.history-meta  { margin: 0.1rem 0 0; font-size: 0.74rem; color: #8e96a4; }

.empty { font-size: 0.875rem; color: #5b6473; font-style: italic; }
.mono  { font-family: 'Geist Mono', ui-monospace, monospace; }

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
.pill-auto_passed,
.pill-staff_approved { background: #eef6f1; color: #0d3624; border-color: #aed5be; }
.pill-pending,
.pill-auto_warnings  { background: #fef7e6; color: #93390a; border-color: #fdecc4; }
.pill-auto_failed,
.pill-staff_rejected { background: #fef3f2; color: #9a1c12; border-color: #fcd9d4; }
</style>
