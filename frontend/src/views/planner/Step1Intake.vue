<script setup lang="ts">
import { caseRef } from '@/composables/useApplicationPipeline'
import { ref, computed, onMounted } from 'vue'
import { dmApi, type PermitApplication } from '@/services/developmentManagementService'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import FieldError from './FieldError.vue'
import ApplicationTrackCard from './ApplicationTrackCard.vue'
import PermitDocumentsPanel from '@/components/workflow/PermitDocumentsPanel.vue'
import {
  Search, FileText, RefreshCw, ClipboardCheck, UserRound, MapPin, Building2,
} from 'lucide-vue-next'

// Intake is review-only. Applicants lodge the application (with all its
// details) through the citizen portal; the clerk here verifies completeness
// and classifies it — they never re-key the applicant's particulars.

// The queue below is this component's own picker, used by the planner's
// statutory workflow. The EO console picks the case for the whole console and
// keeps it in the URL, so it passes `hide-queue`: two pickers would let an
// officer open one file in the case bar and a different one here.
const props = withDefaults(defineProps<{ hideQueue?: boolean }>(), { hideQueue: false })

const { current, loadFromPermit, save, syncPending } = usePlannerCase()
const fb = useUiFeedback()

const queue = ref<PermitApplication[]>([])
const loading = ref(false)
const search = ref('')

async function refreshQueue() {
  loading.value = true
  try {
    const res = await dmApi.listPermits({ status: 'registered', search: search.value.trim(), limit: 50, offset: 0 })
    queue.value = res.data
  } catch (e: any) {
    fb.showToast(fb.parseApiError(e, 'Could not load intake queue'), 'error')
  } finally {
    loading.value = false
  }
}

onMounted(refreshQueue)

// "≥3 copies of plans received" reads/writes the underlying count, so the
// completeness checklist stays a pure set of confirmations.
const copiesOk = computed({
  get: () => (current.value?.intake.copiesSubmitted ?? 0) >= 3,
  set: (v: boolean) => {
    if (!current.value) return
    current.value.intake.copiesSubmitted = v ? 3 : 0
    save()
  },
})

const isPreliminary = computed(() => current.value?.classification === 'preliminary')

const errors = ref<Record<string, string>>({})
const confirming = ref(false)

function validate(): boolean {
  const c = current.value
  if (!c) return false
  const e: Record<string, string> = {}
  if (!c.intake.feePaid)        e.feePaid        = 'Confirm the application fee was received'
  if (!copiesOk.value)          e.copies         = 'At least 3 copies of plans are required'
  if (!isPreliminary.value && !c.intake.titleDeedAttached) {
    e.titleDeedAttached = 'Title deed must be attached for non-preliminary applications'
  }
  if (!isPreliminary.value && !c.intake.proofOfFunding) {
    e.proofOfFunding = 'Proof of funding is required for a complete application (§2.3)'
  }
  errors.value = e
  return Object.keys(e).length === 0
}

async function confirmIntake() {
  if (!current.value) return
  if (!validate()) {
    fb.openMessageBox({ kind: 'error', title: 'Checks incomplete',
      message: 'Resolve the highlighted completeness checks before accepting the application for processing.' })
    return
  }
  confirming.value = true
  try {
    save()
    if (syncPending.value) {
      fb.showToast('Intake checks saved locally — sync pending', 'warn')
    } else {
      fb.showToast('Intake verified — proceed to due diligence (Step 2)', 'success')
    }
  } finally {
    confirming.value = false
  }
}

const devTypeLabel = computed(() =>
  (current.value?.proposal.devType ?? '').replace(/_/g, ' '))
</script>

<template>
  <div class="step1">
    <section v-if="!props.hideQueue" class="iq-card">
      <header class="iq-head">
        <h3>Intake queue</h3>
        <div class="iq-search">
          <Search :size="12" />
          <input name="s1-queue-search" v-model="search" placeholder="Filter by ref, stand, applicant" @keyup.enter="refreshQueue" />
        </div>
        <button class="iq-refresh" @click="refreshQueue" :disabled="loading">
          <RefreshCw :size="12" :class="{ spinning: loading }" /> Refresh
        </button>
      </header>
      <div v-if="loading" class="iq-empty">Loading…</div>
      <div v-else-if="!queue.length" class="iq-empty">No pending applications.</div>
      <div v-else class="iq-list">
        <button v-for="p in queue" :key="p.id" class="iq-row" :class="{ active: current?.permitId === p.id }" @click="loadFromPermit(p.id)">
          <FileText :size="12" />
          <span class="iq-row-id">{{ caseRef(p) }}</span>
          <span class="iq-row-app">{{ p.applicant_name }}</span>
          <span class="iq-row-ward">{{ p.suburb_ward }}</span>
        </button>
      </div>
    </section>

    <!-- Nothing selected — guide the clerk to pick an application to verify. -->
    <section v-if="!current" class="empty-card">
      <span class="empty-ic"><ClipboardCheck :size="22" /></span>
      <h3>Select an application to review</h3>
      <p v-if="props.hideQueue">Open an application from Applications, or with Ctrl K, and its
        intake checks appear here. Applicants lodge through the citizen portal; officers verify
        completeness and classify — the applicant's particulars are never re-keyed.</p>
      <p v-else>Applications are lodged by applicants through the citizen portal. Pick one from the
        intake queue above to verify its completeness and classify it. Officers review and
        confirm — the applicant's particulars are entered by the applicant, never re-keyed here.</p>
    </section>

    <!-- An application is open — show it read-only, then the completeness checks. -->
    <template v-else>
      <section class="rv-card">
        <header class="rv-head"><UserRound :size="14" /> Applicant — as submitted</header>
        <div class="rv-grid">
          <div><span class="rv-lbl">Name</span><p>{{ current.applicant.name || '—' }}</p></div>
          <div><span class="rv-lbl">ID number</span><p>{{ current.applicant.idNumber || '—' }}</p></div>
          <div><span class="rv-lbl">Phone</span><p>{{ current.applicant.phone || '—' }}</p></div>
          <div><span class="rv-lbl">Email</span><p>{{ current.applicant.email || '—' }}</p></div>
        </div>
      </section>

      <section class="rv-card">
        <header class="rv-head"><MapPin :size="14" /> Property — as submitted</header>
        <div class="rv-grid">
          <div><span class="rv-lbl">Stand no.</span><p>{{ current.property.standNo || '—' }}</p></div>
          <div><span class="rv-lbl">Ward</span><p>{{ current.property.ward || '—' }}</p></div>
          <div class="rv-wide"><span class="rv-lbl">Description</span><p>{{ current.property.description || '—' }}</p></div>
          <div class="rv-wide"><span class="rv-lbl">Title deed no.</span><p>{{ current.property.titleDeedNo || '—' }}</p></div>
        </div>
      </section>

      <section class="rv-card">
        <header class="rv-head"><Building2 :size="14" /> Proposal — as submitted</header>
        <div class="rv-grid">
          <div><span class="rv-lbl">Type</span><p class="rv-cap">{{ devTypeLabel }}</p></div>
          <div><span class="rv-lbl">Estimated cost</span><p>USD {{ Number(current.proposal.estimatedCost || 0).toLocaleString() }}</p></div>
          <div><span class="rv-lbl">Plinth area</span><p>{{ current.proposal.plinthArea || 0 }} m²</p></div>
          <div><span class="rv-lbl">Floors</span><p>{{ current.proposal.floors }}</p></div>
          <div><span class="rv-lbl">Parking bays</span><p>{{ current.proposal.parkingBays }}</p></div>
          <div class="rv-wide"><span class="rv-lbl">Description</span><p>{{ current.proposal.description || '—' }}</p></div>
        </div>
      </section>

      <!-- CityView-style auto-generated approval track for the submitted type. -->
      <ApplicationTrackCard
        :dev-type="current.proposal.devType"
        :satisfied="{ title_deed: current.intake.titleDeedAttached, fee_receipt: current.intake.feePaid }"
      />

      <!-- Real documents the applicant uploaded, pulled from the backend so
           completeness can be verified against actual files (audit C3). -->
      <PermitDocumentsPanel :permit-id="current.permitId" />

      <section class="rf-card">
        <header class="rf-head">
          <ClipboardCheck :size="13" />
          <h3>Completeness checks — confirm all is in order</h3>
        </header>
        <div class="rf-body">
          <fieldset>
            <legend>Verify against the lodged application</legend>
            <div class="rf-grid">
              <label class="rf-check"><input name="s1-fee-paid" type="checkbox" v-model="current.intake.feePaid" @change="save" /> Application fee received</label>
              <FieldError :message="errors.feePaid" />
              <label class="rf-check"><input name="s1-copies-ok" type="checkbox" v-model="copiesOk" /> At least 3 copies of plans received</label>
              <FieldError :message="errors.copies" />
              <label class="rf-check"><input name="s1-title-deed-attached" type="checkbox" v-model="current.intake.titleDeedAttached" @change="save" /> Title deed attached</label>
              <FieldError :message="errors.titleDeedAttached" />
              <label class="rf-check"><input name="s1-bondholder-consent" type="checkbox" v-model="current.intake.bondholderConsent" @change="save" /> Bondholder consent attached (if title is bonded)</label>
              <label class="rf-check"><input name="s1-proof-funding" type="checkbox" v-model="current.intake.proofOfFunding" @change="save" /> Proof of funding attached</label>
              <FieldError :message="errors.proofOfFunding" />
            </div>
          </fieldset>
          <fieldset>
            <legend>Classification (Section 26)</legend>
            <div class="rf-radios">
              <label><input name="s1-classification" type="radio" v-model="current.classification" value="routine_26_1" @change="save" /> Routine permit (26(1))</label>
              <label><input name="s1-classification" type="radio" v-model="current.classification" value="special_consent_26_3" @change="save" /> Special Consent (26(3))</label>
              <label><input name="s1-classification" type="radio" v-model="current.classification" value="preliminary" @change="save" /> Preliminary planning inquiry</label>
              <label><input name="s1-classification" type="radio" v-model="current.classification" value="change_of_use" @change="save" /> Change of use</label>
              <label><input name="s1-classification" type="radio" v-model="current.classification" value="building_ops" @change="save" /> Building operations / additions</label>
              <label><input name="s1-classification" type="radio" v-model="current.classification" value="mining" @change="save" /> Mining / quarrying</label>
            </div>
          </fieldset>
          <button type="button" class="rf-submit" :disabled="confirming" @click="confirmIntake">
            {{ confirming ? 'Saving…' : 'Confirm intake checks → proceed to due diligence' }}
          </button>
        </div>
      </section>
    </template>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.step1 { display:flex; flex-direction:column; gap:0.75rem; padding:0.75rem; flex-shrink:0; min-height:min-content; }
.step1 > * { flex-shrink: 0; min-height: min-content; }
.iq-card, .rf-card, .rv-card { border:1px solid #e2e8f0; border-radius:0.5rem; background:#fff; }
.iq-head, .rf-head, .rv-head { display:flex; align-items:center; gap:0.5rem;
  padding:0.5rem 0.75rem; border-bottom:1px solid #e2e8f0; background:#f8fafc; }
.iq-head h3, .rf-head h3 { margin:0; font-size:0.8125rem; flex:1; }
.iq-search { display:inline-flex; align-items:center; gap:0.3rem;
  border:1px solid #e2e8f0; border-radius:0.375rem; padding:0.2rem 0.4rem; background:#fff; }
.iq-search input { border:none; outline:none; font-size:0.75rem; width:11rem; }
.iq-refresh { display:inline-flex; align-items:center; gap:0.25rem;
  border:1px solid #e2e8f0; background:#fff; border-radius:0.375rem;
  padding:0.25rem 0.5rem; font-size:0.7rem; cursor:pointer; }
.spinning { animation:spin 0.8s linear infinite; }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
.iq-empty { padding:0.75rem; font-size:0.75rem; color:#64748b; }
.iq-list { max-height:180px; overflow-y:auto; }
.iq-row { display:grid; grid-template-columns:auto 6.5rem 1fr 5rem; gap:0.4rem;
  align-items:center; width:100%; padding:0.4rem 0.6rem; background:#fff; border:none;
  border-top:1px solid #f1f5f9; font-size:0.7rem; text-align:left; cursor:pointer; }
.iq-row:hover { background:#f8fafc; }
.iq-row.active { background:#eef2ff; }
.iq-row-id { font-family: ui-monospace, monospace; font-weight:600; color:#0f172a; }
.iq-row-app { color:#475569; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.iq-row-ward { color:#94a3b8; }

/* Empty state */
.empty-card { display:flex; flex-direction:column; align-items:center; text-align:center;
  gap:0.4rem; padding:2rem 1.5rem; border:1px dashed #cbd5e1; border-radius:0.5rem; background:#fff; }
.empty-ic { display:inline-flex; align-items:center; justify-content:center; width:44px; height:44px;
  border-radius:0.5rem; background:#eef2ff; color:#4338ca; }
.empty-card h3 { margin:0.2rem 0 0; font-size:0.875rem; color:#0f172a; }
.empty-card p { margin:0; max-width:34rem; font-size:0.75rem; line-height:1.55; color:#64748b; }

/* Read-only review cards */
.rv-grid { display:grid; grid-template-columns:repeat(2, 1fr); gap:0.6rem 0.75rem; padding:0.75rem; }
.rv-grid > div { display:flex; flex-direction:column; gap:0.15rem; }
.rv-grid > div.rv-wide { grid-column:1 / -1; }
.rv-lbl { font-size:0.64rem; text-transform:uppercase; letter-spacing:0.04em; color:#94a3b8; }
.rv-grid p { margin:0; font-size:0.8rem; color:#0f172a; }
.rv-grid p.rv-cap { text-transform:capitalize; }

/* Checks form */
.rf-body { padding:0.75rem; display:flex; flex-direction:column; gap:0.75rem; }
.rf-body fieldset { border:1px solid #e2e8f0; border-radius:0.375rem;
  padding:0.5rem 0.75rem 0.75rem; }
.rf-body legend { font-size:0.7rem; color:#64748b; font-weight:600; padding:0 0.25rem; }
.rf-grid { display:grid; grid-template-columns: repeat(2, 1fr); gap:0.4rem 0.75rem; }
.rf-grid label { display:flex; flex-direction:column; gap:0.2rem; font-size:0.7rem; color:#475569; }
.rf-grid label.rf-check { flex-direction:row; align-items:center; gap:0.35rem; }
.rf-radios { display:flex; flex-direction:column; gap:0.25rem; font-size:0.7rem; color:#475569; }
.rf-radios label { display:flex; align-items:center; gap:0.4rem; }
.rf-submit { margin-top:0.25rem; padding:0.5rem 0.75rem; border:none; border-radius:0.375rem;
  background:#1d4ed8; color:#fff; font-size:0.75rem; font-weight:700; cursor:pointer; }
.rf-submit:disabled { opacity:0.5; cursor:not-allowed; }

/* Indigo statutory design system polish (--sw-* from StatutoryShell) */
.step1 { padding:1rem; gap:1rem; }
.iq-card, .rf-card, .rv-card { border-radius:var(--sw-radius); box-shadow:var(--sw-shadow); border-color:var(--sw-border-soft); }
.iq-head, .rf-head, .rv-head { background:var(--sw-surface-2); border-color:var(--sw-border-soft); }
.rf-body fieldset { border-color:var(--sw-border-soft); border-radius:var(--sw-radius-sm); }
.rf-submit { background:var(--sw-primary-container); border-radius:var(--sw-radius-sm); }
.rf-submit:hover:not(:disabled) { background:var(--sw-primary); }
</style>
