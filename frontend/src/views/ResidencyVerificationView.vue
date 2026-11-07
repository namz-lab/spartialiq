<template>
  <div class="resv-page">
    <!-- App bar -->
    <header class="resv-bar">
      <router-link to="/citizen" class="resv-back" aria-label="Back to citizen portal">
        <ArrowLeft :size="20" />
      </router-link>
      <h1 class="resv-bar-title">Residency verification</h1>
      <span class="resv-bar-spacer"></span>
    </header>

    <main class="resv-main">
      <!-- Status card -->
      <section class="resv-status" :class="`resv-status--${state?.status ?? 'unverified'}`" aria-live="polite">
        <component :is="statusIcon" :size="22" aria-hidden="true" />
        <div class="resv-status-text">
          <p class="resv-status-title">{{ statusTitle }}</p>
          <p class="resv-status-sub">{{ statusSub }}</p>
        </div>
      </section>

      <!-- Instant title deed check -->
      <section class="resv-card">
        <h2 class="resv-card-title">
          <Zap :size="16" aria-hidden="true" />
          Instant check — title deed
        </h2>
        <p class="resv-card-sub">
          If you hold a registered title deed in {{ councilName }}, enter the deed number.
          It is checked against the national Deeds Registry and, when the registered holder
          matches your national ID ({{ userNationalId || 'not on your profile yet' }}), your
          residency is verified immediately.
        </p>
        <form class="resv-deed-form" @submit.prevent="runDeedCheck">
          <input
            v-model="deedNumber"
            type="text"
            class="resv-input"
            placeholder="e.g. DT-1123/2019"
            autocomplete="off"
            spellcheck="false"
            :disabled="checking"
          />
          <button type="submit" class="resv-btn-primary" :disabled="checking || !deedNumber.trim()">
            {{ checking ? 'Checking…' : 'Check deed' }}
          </button>
        </form>
        <div
          v-if="deedResult"
          class="resv-deed-result"
          :class="deedResult.residencyVerified ? 'ok' : deedResult.found ? 'warn' : 'bad'"
        >
          <p class="resv-deed-msg">{{ deedResult.message }}</p>
          <dl v-if="deedResult.deed" class="resv-deed-facts">
            <div><dt>Holder</dt><dd>{{ deedResult.deed.holderName }}</dd></div>
            <div><dt>Property</dt><dd>{{ deedResult.deed.propertyDescription || deedResult.deed.standNo }}</dd></div>
            <div><dt>Status</dt><dd>{{ deedResult.deed.status }}</dd></div>
          </dl>
        </div>
        <p v-if="!userNationalId" class="resv-nid-hint">
          Add your national ID under
          <router-link to="/citizen?section=profile">your profile</router-link>
          before checking, so the registry can match you as the holder.
        </p>
      </section>

      <!-- Upload evidence -->
      <section class="resv-card">
        <h2 class="resv-card-title">
          <FileUp :size="16" aria-hidden="true" />
          Or upload a residency document
        </h2>
        <p class="resv-card-sub">
          Any one of these proves residence in the district. A council officer reviews
          uploads, usually within one working day.
        </p>

        <div class="resv-kinds" role="radiogroup" aria-label="Document type">
          <button
            v-for="req in uploadableRequirements"
            :key="req.kind"
            type="button"
            class="resv-kind"
            role="radio"
            :aria-checked="selectedKind === req.kind"
            :class="{ active: selectedKind === req.kind }"
            @click="selectedKind = req.kind"
          >
            <span class="resv-kind-label">{{ req.label }}</span>
            <span class="resv-kind-detail">{{ req.detail }}</span>
          </button>
        </div>

        <label class="resv-file">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            :disabled="uploading || !selectedKind"
            @change="onFilePicked"
          />
          <span class="resv-file-cta">
            <Upload :size="16" aria-hidden="true" />
            {{ uploading ? 'Uploading…' : selectedKind ? 'Choose photo or PDF' : 'Pick a document type first' }}
          </span>
        </label>
        <p v-if="uploadError" class="resv-error" role="alert">{{ uploadError }}</p>
        <p v-if="uploadOk" class="resv-ok" role="status">{{ uploadOk }}</p>
      </section>

      <!-- Evidence already submitted -->
      <section v-if="state && state.evidence.length" class="resv-card">
        <h2 class="resv-card-title">
          <History :size="16" aria-hidden="true" />
          Your submitted evidence
        </h2>
        <ul class="resv-evidence">
          <li v-for="ev in state.evidence" :key="ev.id" class="resv-evidence-row">
            <span class="resv-evidence-kind">{{ kindLabel(ev.docKind) }}</span>
            <span class="resv-evidence-status" :class="`st-${ev.verificationStatus}`">
              {{ statusLabel(ev.verificationStatus) }}
            </span>
          </li>
        </ul>
      </section>

      <div class="resv-continue">
        <router-link to="/citizen" class="resv-btn-secondary">
          {{ state?.status === 'verified' ? 'Continue to the portal' : 'Skip for now — browse only' }}
        </router-link>
        <p v-if="state?.status !== 'verified'" class="resv-continue-note">
          You can browse public maps and data without verification, but permit
          applications require verified residency.
        </p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  ArrowLeft, BadgeCheck, Clock3, FileUp, History, ShieldAlert,
  ShieldQuestion, Upload, Zap,
} from 'lucide-vue-next'
import {
  residencyService,
  type DeedCheckResult,
  type ResidencyRequirement,
  type ResidencyState,
} from '../services/residencyService'
import { documentsService, type DocKind, type VerificationStatus } from '../services/documentsService'
import { useAuthStore } from '../stores/auth'
import { useCouncilStore } from '../stores/council'

const authStore = useAuthStore()
const councilStore = useCouncilStore()

const councilName = computed(() => councilStore.selectedCouncil?.name ?? 'the district')
const userNationalId = computed(() => authStore.user?.nationalId ?? '')

const state = ref<ResidencyState | null>(null)
const requirements = ref<ResidencyRequirement[]>([])

// Everything is uploadable for manual review — including the title deed,
// which is the fallback when the registry holder does not match the citizen
// (inheritance, marriage, deed not yet transferred).
const uploadableRequirements = computed(() => requirements.value)

const deedNumber = ref('')
const checking = ref(false)
const deedResult = ref<DeedCheckResult | null>(null)

const selectedKind = ref<DocKind | null>(null)
const uploading = ref(false)
const uploadError = ref('')
const uploadOk = ref('')

const statusIcon = computed(() => {
  switch (state.value?.status) {
    case 'verified': return BadgeCheck
    case 'pending':  return Clock3
    case 'rejected': return ShieldAlert
    default:         return ShieldQuestion
  }
})

const statusTitle = computed(() => {
  switch (state.value?.status) {
    case 'verified': return 'Residency verified'
    case 'pending':  return 'Verification pending'
    case 'rejected': return 'Evidence rejected'
    default:         return 'Not yet verified'
  }
})

const statusSub = computed(() => {
  switch (state.value?.status) {
    case 'verified':
      return state.value?.method === 'deeds_registry'
        ? 'Confirmed against the national Deeds Registry.'
        : 'Confirmed by a council officer.'
    case 'pending':  return 'A council officer is reviewing your document.'
    case 'rejected': return 'Your last document was rejected — submit a different proof below.'
    default:         return `Prove you live or hold property in ${councilName.value} to use council services.`
  }
})

const KIND_LABELS: Record<string, string> = {
  title_deed: 'Title deed',
  settlement_letter: 'Settlement / offer letter',
  lodgers_permit: "Lodger's permit",
  occupation_certificate: 'Certificate of occupation',
  chiefs_letter: 'Chief / councillor letter',
  proof_of_residence: 'Rates or utility statement',
}
const kindLabel = (k: string) => KIND_LABELS[k] ?? k

const STATUS_LABELS: Record<VerificationStatus, string> = {
  pending: 'Awaiting review',
  under_review: 'Under review',
  verified: 'Verified',
  rejected: 'Rejected',
  expired: 'Expired',
}
const statusLabel = (s: VerificationStatus) => STATUS_LABELS[s] ?? s

async function refresh() {
  state.value = await residencyService.status()
}

async function runDeedCheck() {
  const n = deedNumber.value.trim()
  if (!n || checking.value) return
  checking.value = true
  deedResult.value = null
  try {
    deedResult.value = await residencyService.deedCheck(n)
    if (deedResult.value.residencyVerified) {
      // Refresh both the page state and the in-memory user, so the router
      // and portal banners see residencyStatus === 'verified' immediately.
      await Promise.all([refresh(), authStore.fetchProfile()])
    }
  } catch {
    deedResult.value = {
      found: false, deed: null, holderMatch: false, residencyVerified: false,
      message: 'Registry unavailable — try again shortly.',
    }
  } finally {
    checking.value = false
  }
}

async function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !selectedKind.value || uploading.value) return
  uploading.value = true
  uploadError.value = ''
  uploadOk.value = ''
  try {
    await documentsService.upload(file, selectedKind.value)
    uploadOk.value = `${kindLabel(selectedKind.value)} submitted — a council officer will review it.`
    await refresh()
  } catch (err: unknown) {
    const er = err as { response?: { data?: { error?: string } } }
    uploadError.value = ({
      too_large: 'File is larger than 12 MB.',
      bad_mime: 'Use a JPEG, PNG, WEBP, HEIC photo or a PDF.',
      duplicate: 'You have already uploaded this exact file.',
      infected_file: 'The file failed the malware scan.',
    } as Record<string, string>)[er.response?.data?.error ?? ''] ?? 'Upload failed — try again.'
  } finally {
    uploading.value = false
  }
}

onMounted(async () => {
  const [st, reqs] = await Promise.all([
    residencyService.status().catch(() => null),
    residencyService.requirements().catch(() => []),
  ])
  state.value = st
  requirements.value = reqs
})
</script>

<style scoped>
.resv-page {
  min-height: 100vh;
  background: #f8fafc;
}

/* App bar */
.resv-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 3.5rem;
  padding: 0 0.75rem;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid #eef2f6;
}
.resv-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 0.625rem;
  color: #111827;
}
.resv-back:active { background: #f1f5f9; }
.resv-bar-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: #111827;
}
.resv-bar-spacer { width: 44px; }

.resv-main {
  max-width: 40rem;
  margin: 0 auto;
  padding: 1rem 1rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Status card */
.resv-status {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: 0.875rem;
  border: 1px solid #e2e8f0;
  background: #fff;
}
.resv-status--verified { border-color: #bbf7d0; background: #f0fdf4; color: #15803d; }
.resv-status--pending  { border-color: #fde68a; background: #fffbeb; color: #b45309; }
.resv-status--rejected { border-color: #fecaca; background: #fef2f2; color: #b91c1c; }
.resv-status--unverified { color: #475569; }
.resv-status-text { min-width: 0; }
.resv-status-title { margin: 0 0 0.15rem; font-weight: 700; font-size: 0.95rem; color: inherit; }
.resv-status-sub { margin: 0; font-size: 0.85rem; color: #475569; }

/* Cards */
.resv-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 0.875rem;
  padding: 1rem;
}
.resv-card-title {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  font-weight: 700;
  color: #111827;
}
.resv-card-sub { margin: 0 0 0.85rem; font-size: 0.85rem; line-height: 1.5; color: #475569; }

/* Deed check */
.resv-deed-form { display: flex; gap: 0.5rem; }
.resv-input {
  flex: 1;
  min-width: 0;
  min-height: 48px;
  padding: 0 0.85rem;
  border: 1px solid #cbd5e1;
  border-radius: 0.625rem;
  font-size: 0.95rem;
  color: #111827;
  background: #fff;
}
.resv-input:focus { outline: 2px solid #1a73e8; outline-offset: 1px; border-color: #1a73e8; }
.resv-btn-primary {
  min-height: 48px;
  padding: 0 1.1rem;
  border: none;
  border-radius: 0.625rem;
  background: #111827;
  color: #fff;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.resv-btn-primary:disabled { opacity: 0.5; cursor: default; }

.resv-deed-result {
  margin-top: 0.75rem;
  padding: 0.75rem;
  border-radius: 0.625rem;
  border: 1px solid #e2e8f0;
  font-size: 0.85rem;
}
.resv-deed-result.ok   { border-color: #bbf7d0; background: #f0fdf4; }
.resv-deed-result.warn { border-color: #fde68a; background: #fffbeb; }
.resv-deed-result.bad  { border-color: #fecaca; background: #fef2f2; }
.resv-deed-msg { margin: 0; font-weight: 600; color: #111827; }
.resv-deed-facts { margin: 0.5rem 0 0; display: flex; flex-direction: column; gap: 0.25rem; }
.resv-deed-facts div { display: flex; gap: 0.5rem; }
.resv-deed-facts dt { flex: 0 0 5rem; color: #64748b; }
.resv-deed-facts dd { margin: 0; color: #111827; }

.resv-nid-hint { margin: 0.6rem 0 0; font-size: 0.8rem; color: #b45309; }
.resv-nid-hint a { color: #1a73e8; }

/* Kind picker */
.resv-kinds { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.85rem; }
.resv-kind {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.625rem;
  background: #fff;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  -webkit-tap-highlight-color: transparent;
}
.resv-kind.active { border-color: #1a73e8; background: #eff6ff; }
.resv-kind-label { font-size: 0.9rem; font-weight: 600; color: #111827; }
.resv-kind-detail { font-size: 0.78rem; color: #64748b; line-height: 1.4; }

/* File picker */
.resv-file input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.resv-file-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
  min-height: 48px;
  border: 1.5px dashed #94a3b8;
  border-radius: 0.625rem;
  color: #334155;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}
.resv-file input:disabled + .resv-file-cta { opacity: 0.5; cursor: default; }
.resv-file input:focus-visible + .resv-file-cta { outline: 2px solid #1a73e8; outline-offset: 2px; }

.resv-error { margin: 0.6rem 0 0; font-size: 0.85rem; color: #b91c1c; }
.resv-ok    { margin: 0.6rem 0 0; font-size: 0.85rem; color: #15803d; }

/* Evidence list */
.resv-evidence { list-style: none; margin: 0; padding: 0; }
.resv-evidence-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid #f1f5f9;
}
.resv-evidence-row:last-child { border-bottom: none; }
.resv-evidence-kind { font-size: 0.88rem; font-weight: 500; color: #111827; }
.resv-evidence-status {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.2rem 0.6rem;
  border-radius: 9999px;
}
.st-verified     { background: #f0fdf4; color: #15803d; }
.st-pending,
.st-under_review { background: #fffbeb; color: #b45309; }
.st-rejected,
.st-expired      { background: #fef2f2; color: #b91c1c; }

/* Continue */
.resv-continue { text-align: center; }
.resv-btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 1.5rem;
  border: 1px solid #cbd5e1;
  border-radius: 0.625rem;
  background: #fff;
  color: #111827;
  font-size: 0.9rem;
  font-weight: 600;
  text-decoration: none;
}
.resv-continue-note { margin: 0.6rem 0 0; font-size: 0.78rem; color: #64748b; }

@media (min-width: 768px) {
  .resv-main { padding-top: 2rem; }
  .resv-kinds { display: grid; grid-template-columns: 1fr 1fr; }
}
</style>
