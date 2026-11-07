<script setup lang="ts">
// Permits — drafting one, and the register of those already issued.
//
// Two tabs, because a permit has two lives:
//   drafting  the conditions and the wording for the OPEN case, before issue
//             (the existing Step4 workspace, with its five-test gating)
//   register  every determined application, its decision letter, and the
//             occupation certificate that closes the file
//
// The occupation certificate is the end of the development-control cycle and
// the one document a citizen comes back to the counter for. It had a table, a
// route and a service method, and no screen an EO could reach it from.

import { computed, ref, watch } from 'vue'
import {
  dmApi,
  type PermitApplication, type OccupationCertificate, type GeneratedDocumentRef,
} from '@/services/developmentManagementService'
import { statusLabel } from '@/composables/useApplicationPipeline'
import { useStaleRefresh } from '@/composables/useStaleRefresh'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { useEoNav } from '@/eo-planner/useEoNav'
import { useEoCase } from '@/eo-planner/useEoCase'
import { fmtDate, humanise, isoDay } from '@/utils/dates'
import UiFeedback from '@/components/UiFeedback.vue'
import Step4PermitDrafting from '@/views/planner/Step4PermitDrafting.vue'
import CaseRequired from './CaseRequired.vue'
import {
  FileCheck2, FilePlus, Search, RefreshCw, BadgeCheck, FileText, Loader2,
  AlertTriangle, ExternalLink,
} from 'lucide-vue-next'
import '@/views/inspector/inspector.css'

const fb = useUiFeedback()
const nav = useEoNav()
const eoCase = useEoCase()

type Tab = 'drafting' | 'register'
const tab = computed<Tab>(() => (nav.param('tab') === 'register' ? 'register' : 'drafting'))
function setTab(t: Tab) { nav.setParam('tab', t === 'drafting' ? null : t) }

// ── The register of determined applications ───────────────────────────
const permits = ref<PermitApplication[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const search = ref('')

async function refresh() {
  loading.value = true
  loadError.value = null
  try {
    // Three statuses, three queries: the list endpoint filters on one status
    // at a time, and asking for everything and filtering here would carry the
    // whole register over a rural link to show a tenth of it.
    const pages = await Promise.all(
      (['approved', 'approved_with_conditions', 'refused'] as const).map(status =>
        dmApi.listPermits({ status, limit: 200, offset: 0 }).then(r => r.data).catch(() => [])),
    )
    permits.value = pages.flat()
      .sort((a, b) => (b.decision_at ?? b.updated_at ?? '').localeCompare(a.decision_at ?? a.updated_at ?? ''))
  } catch (err: unknown) {
    loadError.value = fb.parseApiError(err, 'Could not read the permit register.')
  } finally {
    loading.value = false
  }
}
const { refreshNow } = useStaleRefresh(refresh)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return permits.value
  return permits.value.filter(p =>
    [p.dev_register_no, p.tpd_reference, p.stand_number, p.applicant_name, p.suburb_ward]
      .some(v => (v ?? '').toLowerCase().includes(q)))
})

function permitRef(p: PermitApplication): string {
  return p.dev_register_no || p.tpd_reference || p.id.slice(0, 8).toUpperCase()
}

// ── One permit ────────────────────────────────────────────────────────
const selectedId = ref<string | null>(null)
const selected = computed(() => permits.value.find(p => p.id === selectedId.value) ?? null)
const certificate = ref<OccupationCertificate | null>(null)
const documents = ref<GeneratedDocumentRef[]>([])
const detailLoading = ref(false)
const busy = ref<string | null>(null)

async function select(p: PermitApplication) {
  selectedId.value = p.id
  // Opening a permit here opens the case for the whole console: the officer
  // who looks up a permit usually wants the file.
  eoCase.open(p.id)
  certificate.value = null
  documents.value = []
  detailLoading.value = true
  try {
    const [cert, docs] = await Promise.all([
      dmApi.getCertificate(p.id).catch(() => null),
      dmApi.listGeneratedDocuments(p.id).catch(() => [] as GeneratedDocumentRef[]),
    ])
    certificate.value = cert
    documents.value = docs
  } finally {
    detailLoading.value = false
  }
}

/** Conditions as stored on the permit (migration 082), whatever their shape. */
const conditions = computed<string[]>(() => {
  const raw = selected.value?.permit_conditions
  if (!Array.isArray(raw)) return []
  return raw
    .map(c => typeof c === 'string' ? c : String((c as Record<string, unknown>)?.text ?? ''))
    .filter(Boolean)
})

// ── Occupation certificate ────────────────────────────────────────────
const certForm = ref({
  issued_at: isoDay(),
  certificate_no: '',
  occupant_name: '',
  building_use: '',
  notes: '',
})

watch(selected, (p) => {
  certForm.value = {
    issued_at: isoDay(),
    certificate_no: '',
    occupant_name: p?.applicant_name ?? '',
    building_use: p ? humanise(p.development_type) : '',
    notes: '',
  }
})

async function issueCertificate() {
  const p = selected.value
  if (!p) return
  busy.value = 'cert'
  try {
    certificate.value = await dmApi.issueCertificate(p.id, {
      issued_at: certForm.value.issued_at,
      certificate_no: certForm.value.certificate_no.trim() || undefined,
      occupant_name: certForm.value.occupant_name.trim() || undefined,
      building_use: certForm.value.building_use.trim() || undefined,
      notes: certForm.value.notes.trim() || undefined,
    })
    fb.showToast('Certificate of occupation issued.', 'success')
  } catch (err: unknown) {
    // The server refuses where the statutory inspections are not complete;
    // that refusal is the point of the endpoint, so it is shown as written.
    fb.showToast(fb.parseApiError(err, 'The certificate could not be issued.'), 'error')
  } finally {
    busy.value = null
  }
}

/** Open a server-generated document (decision letter, map evidence). */
async function viewDocument(docId: string) {
  busy.value = docId
  try {
    const doc = await dmApi.getGeneratedDocument(docId)
    if (!doc.content) { fb.showToast('That document has no stored content.', 'error'); return }
    const mime = doc.mime_type || 'text/html'
    const blob = (mime.startsWith('image') && doc.content.startsWith('data:'))
      ? await (await fetch(doc.content)).blob()
      : new Blob([doc.content], { type: mime })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not open the document.'), 'error')
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="ins-page pm">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Development permits</span>
        <h2 class="ins-title"><FileCheck2 :size="18" aria-hidden="true" /> Permits</h2>
        <p class="ins-lede">
          Draft the permit for the case you have open, and keep the register of what the
          council has issued — including the certificate of occupation that closes each file.
        </p>
      </div>
      <div class="ins-actions">
        <button v-if="tab === 'register'" type="button" class="ins-iconbtn" :disabled="loading"
                title="Reload the register" @click="refreshNow">
          <RefreshCw :size="15" aria-hidden="true" :class="{ 'ins-spin': loading }" />
          <span class="ent-sr-only">Reload the register</span>
        </button>
      </div>
    </header>

    <div class="ins-seg pm-tabs" role="tablist" aria-label="Permit views">
      <button type="button" role="tab" :aria-selected="tab === 'drafting'" @click="setTab('drafting')">
        <FilePlus :size="14" aria-hidden="true" /> Drafting
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'register'" @click="setTab('register')">
        <FileCheck2 :size="14" aria-hidden="true" /> Issued register
      </button>
    </div>

    <!-- ── Drafting ─────────────────────────────────────────────── -->
    <template v-if="tab === 'drafting'">
      <CaseRequired v-if="!eoCase.caseId.value"
                    what="Permit drafting — conditions, the five tests and the Annexure 7 notes —" />
      <Step4PermitDrafting v-else />
    </template>

    <!-- ── Issued register ──────────────────────────────────────── -->
    <template v-else>
      <div v-if="loadError" class="ins-banner t-negative" role="alert">
        <AlertTriangle :size="16" aria-hidden="true" />
        <div><strong>The register could not be read.</strong><p>{{ loadError }}</p></div>
        <button type="button" class="pm-btn" @click="refreshNow">Try again</button>
      </div>

      <label class="ins-search pm-search">
        <Search :size="15" aria-hidden="true" />
        <span class="ent-sr-only">Search determined applications</span>
        <input v-model="search" type="search" placeholder="Register number, stand, applicant or ward" />
      </label>

      <div class="ins-split">
        <section class="ins-card">
          <header class="ins-card-head">
            <h3>Determined</h3>
            <span class="ins-count">{{ filtered.length }}</span>
          </header>
          <p v-if="loading && !permits.length" class="pm-msg">Reading the register…</p>
          <p v-else-if="!filtered.length" class="pm-msg">
            Nothing determined matches this search. A permit appears here once the application
            has been approved, approved with conditions, or refused.
          </p>
          <ul v-else class="ins-rows pm-list">
            <li v-for="p in filtered" :key="p.id">
              <button type="button" class="ins-row pm-row" :class="{ on: p.id === selectedId }"
                      @click="select(p)">
                <span class="ins-row-main">
                  <span class="ins-row-title">
                    <span class="ins-mono">{{ permitRef(p) }}</span> · {{ p.applicant_name }}
                  </span>
                  <span class="ins-row-meta">
                    Stand {{ p.stand_number }}<template v-if="p.suburb_ward"> · {{ p.suburb_ward }}</template>
                    · determined {{ fmtDate(p.decision_at) }}
                  </span>
                </span>
                <span class="pm-pill" :class="p.status === 'refused' ? 't-negative' : 't-positive'">
                  {{ statusLabel(p.status) }}
                </span>
              </button>
            </li>
          </ul>
        </section>

        <section class="ins-card ins-sticky">
          <template v-if="selected">
            <header class="ins-card-head">
              <h3 class="ins-mono">{{ permitRef(selected) }}</h3>
              <span class="ins-count">{{ statusLabel(selected.status) }}</span>
            </header>
            <div class="ins-card-body pm-detail">
              <dl class="ins-dl">
                <div><dt>Applicant</dt><dd>{{ selected.applicant_name }}</dd></div>
                <div><dt>Stand</dt><dd>{{ selected.stand_number }}</dd></div>
                <div><dt>Type</dt><dd>{{ humanise(selected.development_type) }}</dd></div>
                <div><dt>Determined</dt><dd>{{ fmtDate(selected.decision_at) }}</dd></div>
              </dl>

              <section v-if="conditions.length" class="pm-block">
                <h4>Conditions on the permit</h4>
                <ol class="pm-conditions">
                  <li v-for="(c, i) in conditions" :key="i">{{ c }}</li>
                </ol>
              </section>

              <section class="pm-block">
                <h4><FileText :size="14" aria-hidden="true" /> Council documents</h4>
                <p v-if="detailLoading" class="pm-msg-sm">Loading…</p>
                <p v-else-if="!documents.length" class="pm-msg-sm">
                  No generated document on file. A decision letter is written when the
                  determination is recorded in Determination.
                </p>
                <ul v-else class="pm-docs">
                  <li v-for="d in documents" :key="d.id">
                    <button type="button" class="pm-link" :disabled="busy === d.id"
                            @click="viewDocument(d.id)">
                      <component :is="busy === d.id ? Loader2 : ExternalLink" :size="13" aria-hidden="true"
                                 :class="{ 'ins-spin': busy === d.id }" />
                      {{ d.title || humanise(d.doc_type) }}
                    </button>
                    <small>v{{ d.version }} · {{ fmtDate(d.created_at) }}</small>
                  </li>
                </ul>
              </section>

              <!-- Certificate of occupation -->
              <section v-if="selected.status !== 'refused'" class="pm-block">
                <h4><BadgeCheck :size="14" aria-hidden="true" /> Certificate of occupation</h4>

                <p v-if="certificate" class="ins-banner t-positive">
                  <BadgeCheck :size="16" aria-hidden="true" />
                  <span>
                    <strong>Issued {{ fmtDate(certificate.issued_at) }}</strong>
                    — number <span class="ins-mono">{{ certificate.certificate_no }}</span>.
                    <template v-if="certificate.notes"><br>{{ certificate.notes }}</template>
                  </span>
                </p>

                <template v-else>
                  <p class="ins-hint">
                    The certificate is issued after the final inspection. The server refuses to
                    issue one while a statutory stage inspection is outstanding — that check is
                    not repeated here, so what you see is what the record actually allows.
                  </p>
                  <form class="ins-form" @submit.prevent="issueCertificate">
                    <label class="ins-field">
                      <span class="ins-label">Issued on</span>
                      <input v-model="certForm.issued_at" type="date" class="ins-input" :max="isoDay()" />
                    </label>
                    <label class="ins-field">
                      <span class="ins-label">Certificate number</span>
                      <input v-model="certForm.certificate_no" class="ins-input"
                             placeholder="Left blank, the council's sequence is used" />
                    </label>
                    <label class="ins-field">
                      <span class="ins-label">Occupant</span>
                      <input v-model="certForm.occupant_name" class="ins-input" />
                    </label>
                    <label class="ins-field">
                      <span class="ins-label">Use of the building</span>
                      <input v-model="certForm.building_use" class="ins-input" />
                    </label>
                    <label class="ins-field full">
                      <span class="ins-label">Notes and conditions of occupation</span>
                      <textarea v-model="certForm.notes" rows="3" class="ins-input"
                                placeholder="Joint inspection reference, any conditions of occupation…"></textarea>
                    </label>
                    <div class="pm-actions full">
                      <button type="submit" class="pm-btn primary" :disabled="busy === 'cert'">
                        <component :is="busy === 'cert' ? Loader2 : BadgeCheck" :size="14" aria-hidden="true"
                                   :class="{ 'ins-spin': busy === 'cert' }" />
                        {{ busy === 'cert' ? 'Issuing…' : 'Issue the certificate' }}
                      </button>
                    </div>
                  </form>
                </template>
              </section>
            </div>
          </template>
          <div v-else class="pm-empty">
            <FileCheck2 :size="22" aria-hidden="true" />
            <p>Choose a determined application to see its permit, its letters and its certificate.</p>
          </div>
        </section>
      </div>
    </template>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.pm-tabs { align-self:flex-start; }
.pm-search { max-width:32rem; }
.pm-list { max-height:min(60vh, 34rem); overflow-y:auto; }
.pm-row { width:100%; background:none; border:0; text-align:left; cursor:pointer; font-family:var(--ent-font); }
.pm-row:hover { background:var(--ent-surface-2); }
.pm-row:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.pm-row.on { background:var(--ent-accent-soft); }

.pm-pill { flex-shrink:0; padding:1px 8px; border-radius:var(--ent-r-pill);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); white-space:nowrap; }
.pm-pill.t-positive { background:var(--ent-tone-positive-bg); color:var(--ent-tone-positive-fg); }
.pm-pill.t-negative { background:var(--ent-tone-negative-bg); color:var(--ent-tone-negative-fg); }

.pm-detail { display:flex; flex-direction:column; gap:var(--ent-s5); }
.pm-block h4 { display:flex; align-items:center; gap:var(--ent-s2); margin:0 0 var(--ent-s2);
  font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.pm-conditions { margin:0; padding-left:1.2rem; display:flex; flex-direction:column; gap:var(--ent-s2);
  font-size:var(--ent-fs-sm); color:var(--ent-text-2); line-height:var(--ent-lh); }
.pm-docs { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s2); }
.pm-docs li { display:flex; align-items:baseline; justify-content:space-between; gap:var(--ent-s2); }
.pm-docs small { font-size:var(--ent-fs-micro); color:var(--ent-text-3); white-space:nowrap; }
.pm-link { display:inline-flex; align-items:center; gap:var(--ent-s2); background:none; border:0;
  padding:0; cursor:pointer; font-family:var(--ent-font); font-size:var(--ent-fs-sm); color:var(--ent-accent); }
.pm-link:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.pm-actions { display:flex; justify-content:flex-end; }
.pm-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r); cursor:pointer; }
.pm-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.pm-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.pm-btn:disabled { opacity:0.55; cursor:not-allowed; }
.pm-btn.primary { background:var(--ent-accent); border-color:var(--ent-accent); color:var(--ent-text-on-accent); }
.pm-btn.primary:hover:not(:disabled) { background:var(--ent-accent-hover); }

.pm-msg { margin:0; padding:var(--ent-s6) var(--ent-s4); text-align:center;
  font-size:var(--ent-fs-sm); color:var(--ent-text-3); line-height:var(--ent-lh); }
.pm-msg-sm { margin:0; font-size:var(--ent-fs-xs); color:var(--ent-text-3); line-height:var(--ent-lh); }
.pm-empty { display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:var(--ent-s3); padding:var(--ent-s8) var(--ent-s4); color:var(--ent-text-3);
  text-align:center; font-size:var(--ent-fs-sm); }

@media (max-width: 1023px) {
  .ins-split { grid-template-columns: minmax(0, 1fr); }
  .ins-split > .ins-sticky { position:static; }
}
</style>
