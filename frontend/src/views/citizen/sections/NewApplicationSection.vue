<script setup lang="ts">
// New Application — multi-step TPD wizard presented as a centred,
// progress-driven card (matching the Stitch "Permit Finder Quiz"
// design): progress header + bar, step content, Back / Save / Next
// footer. Steps: 1) identity 2) site 3) proposal 4) document checklist
// 5) declarations + submit.

import { ref, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  useCitizenCase, REQUIRED_DOCS_BY_TYPE, DOC_TYPE_LABELS, DocumentUploadError, isAttached,
  type ApplicationCategory, type CitizenDocType,
} from '@/composables/useCitizenCase'
import type { PermitApplication } from '@/services/developmentManagementService'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import StandPickerModal from '@/components/StandPickerModal.vue'
import PaymentMethodPicker from '@/components/PaymentMethodPicker.vue'
import type { StandLocation } from '@/services/parcels'
import { paymentsService } from '@/services/paymentsService'
import { citizenPortalService } from '@/services/citizenPortalService'
import { useAuthStore, type User } from '@/stores/auth'
import IdentityDocVerifier from '@/components/IdentityDocVerifier.vue'
import {
  FilePlus, Trash2, CheckCircle2, AlertTriangle, ArrowLeft, ArrowRight, MapPin, Plus, Upload,
} from 'lucide-vue-next'
import {
  sanitizeDecimal, sanitizeInteger, sanitizePhone, sanitizeNationalId,
  isPositiveNumber, isNationalId, isZwPhone, isEmail, isPersonName, documentFileError,
} from '@/utils/citizenValidation'

const cc = useCitizenCase()
const fb = useUiFeedback()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const TOTAL_STEPS = 5
const council = ref<{ name: string; application_fee: number } | null>(null)

// Enter once, use many times: fill empty identity fields from the saved
// profile so the citizen never re-types their details.
function prefillIdentity(d: typeof cc.currentDraft.value) {
  const u = auth.user
  if (!u || !d) return
  if (!d.applicant_name && u.name)            d.applicant_name = u.name
  if (!d.applicant_email && u.email)          d.applicant_email = u.email
  if (!d.applicant_phone && u.phone)          d.applicant_phone = u.phone
  if (!d.applicant_id_number && u.nationalId) d.applicant_id_number = u.nationalId
}

// When the AI verifies the uploaded national ID, adopt the extracted number
// if the citizen has not typed one.
function onIdVerified(idNumber: string | null) {
  const d = draft.value
  if (d && idNumber && !d.applicant_id_number.trim()) {
    d.applicant_id_number = idNumber
    cc.save()
  }
}

// Persist any newly-entered identity back to the profile so the next
// application prefills from it. Best-effort — never blocks submission.
async function persistIdentityToProfile(d: typeof cc.currentDraft.value) {
  if (!d) return
  const u = auth.user
  const patch: Partial<User> = {}
  if (d.applicant_name && d.applicant_name !== u?.name) patch.name = d.applicant_name
  if (d.applicant_phone && d.applicant_phone !== u?.phone) patch.phone = d.applicant_phone
  if (d.applicant_id_number && d.applicant_id_number !== u?.nationalId) patch.nationalId = d.applicant_id_number
  if (Object.keys(patch).length) {
    try { await auth.updateProfile(patch) } catch { /* non-blocking */ }
  }
}

const councilError = ref('')
async function loadCouncil() {
  councilError.value = ''
  try { council.value = await citizenPortalService.getCouncil() }
  catch (e) { councilError.value = fb.parseApiError(e, 'Could not load the application fee.') }
}

onMounted(async () => {
  await loadCouncil()
  // Refresh the profile so prefill uses the latest saved identity.
  try { await auth.fetchProfile() } catch { /* keep cached user */ }
  if (cc.currentDraft.value) prefillIdentity(cc.currentDraft.value)

  // Deep link from a stand CTA (map popup, stand card, /apply?stand=…):
  // open a draft pre-pinned to that stand so "Apply for this stand" carries
  // the parcel straight into the canonical permit application.
  const standQ = typeof route?.query?.stand === 'string' ? route.query.stand.trim() : ''
  if (standQ) {
    if (!cc.currentDraft.value) {
      cc.newDraft()
      prefillIdentity(cc.currentDraft.value)
    }
    const d = cc.currentDraft.value
    if (d && !(d.stand_number || '').trim()) {
      d.stand_number = standQ
      cc.save()
    }
  }
})

// Submit-and-pay creates a permit application AND a payment. Re-entering while
// the first attempt is still in flight lodged the same application twice and
// charged for both, so the whole handler is behind one lock. It is released in
// `finally` (not on success) so a failed attempt is still retryable.
const paying = ref(false)

async function handlePay(p: { wallet: 'ecocash' | 'onemoney' | 'innbucks'; phone: string; walletCcy: 'USD' | 'ZWG' }) {
  if (!draft.value || !council.value || paying.value) return
  attempted.value = true
  if (!stepValid.value) {
    fb.showToast(Object.values(errors.value)[0] || 'Complete the declarations before paying.', 'warning')
    return
  }
  paying.value = true
  try {
    await runPay(p)
  } finally {
    paying.value = false
  }
}

async function runPay(p: { wallet: 'ecocash' | 'onemoney' | 'innbucks'; phone: string; walletCcy: 'USD' | 'ZWG' }) {
  if (!draft.value || !council.value) return
  let permit: PermitApplication | null = null
  try {
    await persistIdentityToProfile(draft.value)
    permit = await cc.submitDraft(draft.value.id, {
      payIntent: { phone: p.phone, walletCcy: p.walletCcy },
    })
  } catch (err) {
    if (err instanceof DocumentUploadError) {
      // Application was submitted; proceed to payment but flag the documents.
      permit = err.permit
      fb.showToast(`Application submitted, but ${err.failures.length} document(s) didn't upload — re-attach them from the Documents tab.`, 'warning')
    } else {
      fb.showToast(fb.parseApiError(err, 'Could not submit application'), 'error')
      return
    }
  }
  if (!permit) return
  try {
    const payment = await paymentsService.init({
      purpose:     'application_fee',
      relatedKind: 'permit',
      relatedId:   permit.id,
      priceUsd:    council.value.application_fee,
      walletCcy:   p.walletCcy,
      driver:      'paynow',
      metadata:    { phone: p.phone, wallet: p.wallet },
    })
    router.push(`/payment/${payment.id}`)
  } catch (err) {
    fb.showToast("Payment couldn't start — try again from the Payments tab.", 'error')
    router.push('/citizen?section=payments')
  }
}

const pickerOpen = ref(false)
function applyStandSelection(loc: StandLocation) {
  const d = cc.currentDraft.value
  const s = loc.stand
  if (!d || !s) return
  d.stand_number = s.stand_number
  if (s.ward) d.suburb_ward = s.ward
  if (!d.description && s.description) d.description = s.description
  cc.save()
  pickerOpen.value = false
}
const step = ref<1 | 2 | 3 | 4 | 5>(1)

defineExpose({ applyStandSelection, step, TOTAL_STEPS })

watch(() => cc.currentDraftId.value, () => { step.value = 1 })

function startNew() {
  cc.newDraft()
  prefillIdentity(cc.currentDraft.value)
  step.value = 1
}

const draft = computed(() => cc.currentDraft.value)

// Auto-save on draft mutation
watch(draft, () => { cc.save() }, { deep: true })

const requiredDocs = computed(() => {
  if (!draft.value || !draft.value.development_type) return []
  const base = [...(REQUIRED_DOCS_BY_TYPE[draft.value.development_type as ApplicationCategory] ?? [])]
  if (draft.value.applicant_capacity === 'agent' && !base.some(r => r.type === 'agent_authority')) {
    base.push({ type: 'agent_authority', mandatory: true, notes: 'Written authority from the registered owner' })
  }
  return base
})
const stagedTypes = computed(() => new Set((draft.value?.documents ?? []).filter(isAttached).map(d => d.doc_type)))
const missingMandatory = computed(() =>
  requiredDocs.value.filter(r => r.mandatory && !stagedTypes.value.has(r.type)))

// Part III of the TPD form applies to anything other than a single detached
// dwelling or agricultural development; industrial adds the effluent/emissions block.
const PART_III_TYPES = ['commercial', 'industrial', 'institutional', 'subdivision', 'change_of_use']
const needsPartIII = computed(() => PART_III_TYPES.includes((draft.value?.development_type as string) || ''))
const isIndustrial = computed(() => (draft.value?.development_type as string) === 'industrial')

const attempted = ref(false)
watch(step, () => { attempted.value = false })

function fieldErrors(): Record<string, string> {
  const d = draft.value
  const err: Record<string, string> = {}
  if (!d) return { form: 'Start a draft first.' }
  if (step.value === 1) {
    if (!isPersonName(d.applicant_name)) err.applicant_name = 'Enter the applicant’s full name (letters only).'
    if (!isNationalId(d.applicant_id_number)) err.applicant_id_number = 'Use a Zimbabwe ID such as 12-345678-X-78.'
    if (!isZwPhone(d.applicant_phone)) err.applicant_phone = 'Enter a Zimbabwe mobile number, e.g. 0771234567.'
    if ((d.applicant_email || '').trim() && !isEmail(d.applicant_email)) err.applicant_email = 'Enter a valid email address.'
    if (!(d.applicant_address || '').trim()) err.applicant_address = 'Postal or physical address is required.'
    if (!d.applicant_capacity) err.applicant_capacity = 'Select the capacity in which you are applying.'
    if (d.applicant_capacity && d.applicant_capacity !== 'owner') {
      if (!isPersonName(d.owner_name)) err.owner_name = 'Enter the registered owner’s name.'
      if ((d.owner_phone || '').trim() && !isZwPhone(d.owner_phone)) err.owner_phone = 'Owner phone must be a Zimbabwe number.'
    }
  }
  if (step.value === 2) {
    if (!(d.stand_number || '').trim()) err.stand_number = 'Stand number is required — pick it on the map or type it.'
    if (!(d.suburb_ward || '').trim()) err.suburb_ward = 'Suburb or ward is required.'
    if (!isPositiveNumber(d.site_area_sqm, { min: 1, max: 50_000_000 })) {
      err.site_area_sqm = 'Site area must be a number of square metres (no letters).'
    }
  }
  if (step.value === 3) {
    if (!d.development_type) err.development_type = 'Select the land-use type.'
    if (!d.works_nature) err.works_nature = 'Select the nature of works.'
    if (!isPositiveNumber(d.estimated_cost, { min: 1, max: 1_000_000_000 })) {
      err.estimated_cost = 'Estimated cost must be a USD amount in numbers only.'
    }
    if ((d.external_floor_area || '').trim() && !isPositiveNumber(d.external_floor_area, { min: 1, max: 1_000_000 })) {
      err.external_floor_area = 'Floor area must be a number of square metres.'
    }
    if (d.new_access && !(d.new_access_detail || '').trim()) {
      err.new_access_detail = 'Describe the new or altered access.'
    }
    if (needsPartIII.value) {
      if (!isPositiveNumber(d.num_floors, { min: 1, max: 80, integer: true })) {
        err.num_floors = 'Number of floors must be a whole number.'
      }
      if (!isPositiveNumber(d.total_floor_area, { min: 1, max: 1_000_000 })) {
        err.total_floor_area = 'Total floor area must be a number of square metres.'
      }
    }
  }
  if (step.value === 4 && missingMandatory.value.length) {
    err.documents = `${missingMandatory.value.length} mandatory document(s) still to stage.`
  }
  if (step.value === 5) {
    if (!d.consent_to_publish) err.consent_to_publish = 'Public-notification consent is required.'
    if (!d.declaration_signed) err.declaration_signed = 'The declaration must be signed.'
    if ((d.applicant_capacity === 'agent' || d.applicant_capacity === 'lessee') && !d.owner_consent_confirmed) {
      err.owner_consent_confirmed = 'Confirm the owner’s written consent.'
    }
  }
  return err
}

const errors = computed(() => fieldErrors())
const stepValid = computed(() => Object.keys(errors.value).length === 0)
function showErr(key: string) { return attempted.value ? (errors.value[key] || '') : '' }

function onDecimal(field: 'site_area_sqm' | 'estimated_cost' | 'external_floor_area' | 'total_floor_area', e: Event) {
  const d = draft.value
  if (d) d[field] = sanitizeDecimal((e.target as HTMLInputElement).value)
}
function onInteger(field: 'num_floors', e: Event) {
  const d = draft.value
  if (d) d[field] = sanitizeInteger((e.target as HTMLInputElement).value)
}

function nextStep() {
  attempted.value = true
  if (!stepValid.value) {
    const first = Object.values(errors.value)[0]
    fb.showToast(first || 'Please fill in the required fields before continuing.', 'warning')
    return
  }
  if (step.value < 5) step.value = (step.value + 1) as 1 | 2 | 3 | 4 | 5
}
function backStep() { if (step.value > 1) step.value = (step.value - 1) as 1 | 2 | 3 | 4 | 5 }

function saveForLater() {
  cc.save()
  fb.showToast('Draft saved. You can return to it any time.', 'success')
}

// ── Step 4: attach files inline (bytes held in memory until submit) ────
function attachFor(type: CitizenDocType, ev: Event) {
  const input = ev.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  const d = draft.value
  if (!d) return
  for (const f of files) {
    const err = documentFileError(f)
    if (err) { fb.showToast(err, 'warning'); continue }
    cc.stageDocument(d.id, { doc_type: type, filename: f.name, size_bytes: f.size }, f)
  }
}
function stagedOf(type: CitizenDocType) {
  return (draft.value?.documents ?? []).filter(x => x.doc_type === type)
}

const openDrafts = computed(() => cc.drafts.value.filter(d => !d.submitted_at))

// Presentational helpers for the progress header.
const STEP_TITLES: Record<number, string> = {
  1: 'Applicant identity',
  2: 'Site of proposed development',
  3: 'The proposal',
  4: 'Required documents',
  5: 'Declarations & submit',
}
const stepTitle = computed(() => STEP_TITLES[step.value])
const pct = computed(() => Math.round((step.value / TOTAL_STEPS) * 100))
</script>

<template>
  <div class="na">
    <!-- Toolbar: draft switcher + new draft -->
    <div class="na-bar">
      <div class="na-bar-l">
        <FilePlus :size="16" class="na-bar-ic" />
        <span class="na-bar-title">New application</span>
        <select v-if="openDrafts.length" class="na-draft-select"
                :value="cc.currentDraftId.value ?? ''"
                @change="cc.selectDraft(($event.target as HTMLSelectElement).value)">
          <option value="" disabled>Switch draft…</option>
          <option v-for="d in openDrafts" :key="d.id" :value="d.id">
            {{ d.applicant_name || 'Unnamed' }} · {{ d.stand_number || '—' }}
          </option>
        </select>
      </div>
      <button class="na-new" @click="startNew"><Plus :size="14" /> New draft</button>
    </div>

    <!-- No draft selected -->
    <div v-if="!draft" class="na-card na-start">
      <div class="na-start-ic"><FilePlus :size="26" /></div>
      <h3>Start a new TPD application</h3>
      <p>Click <strong>New draft</strong> to begin. Drafts auto-save locally — pause and return
         at any time. Submitting creates a Council case with a registration number. The council's
         three-month decision period starts when it acknowledges your application.</p>
      <button class="na-btn primary" @click="startNew"><Plus :size="15" /> New draft</button>
    </div>

    <!-- Wizard card -->
    <div v-else class="na-card">
      <!-- Progress header -->
      <div class="na-prog">
        <div class="na-prog-titles">
          <span class="na-prog-label">Permit application</span>
          <h3 class="na-prog-title">{{ step }}. {{ stepTitle }}</h3>
        </div>
        <div class="na-prog-meta">
          <span class="na-prog-count">Step {{ step }} of {{ TOTAL_STEPS }} ({{ pct }}%)</span>
          <button v-if="openDrafts.length > 1" class="na-trash" @click="cc.removeDraft(draft.id)" title="Discard this draft">
            <Trash2 :size="14" />
          </button>
        </div>
      </div>
      <div class="na-prog-bar"><div class="na-prog-fill" :style="{ transform: `scaleX(${pct / 100})` }" /></div>

      <!-- Content -->
      <div class="na-content">
        <!-- Step 1 — identity -->
        <div v-if="step === 1" class="na-step">
          <p class="na-hint">Saved to your profile on submission and reused automatically next time.</p>
          <div class="na-grid">
            <label class="na-field" :class="{ invalid: showErr('applicant_name') }"><span>Full name *</span>
              <input v-model="draft.applicant_name" autocomplete="name" />
              <em v-if="showErr('applicant_name')" class="na-err">{{ showErr('applicant_name') }}</em>
            </label>
            <label class="na-field" :class="{ invalid: showErr('applicant_id_number') }"><span>National ID *</span>
              <input :value="draft.applicant_id_number" placeholder="e.g. 12-345678-X-78"
                     autocomplete="off" inputmode="text"
                     @input="draft.applicant_id_number = sanitizeNationalId(($event.target as HTMLInputElement).value)" />
              <em v-if="showErr('applicant_id_number')" class="na-err">{{ showErr('applicant_id_number') }}</em>
            </label>
            <label class="na-field" :class="{ invalid: showErr('applicant_phone') }"><span>Phone *</span>
              <input :value="draft.applicant_phone" placeholder="0771234567" type="tel" inputmode="tel" autocomplete="tel"
                     @input="draft.applicant_phone = sanitizePhone(($event.target as HTMLInputElement).value)" />
              <em v-if="showErr('applicant_phone')" class="na-err">{{ showErr('applicant_phone') }}</em>
            </label>
            <label class="na-field" :class="{ invalid: showErr('applicant_email') }"><span>Email</span>
              <input type="email" v-model="draft.applicant_email" autocomplete="email" />
              <em v-if="showErr('applicant_email')" class="na-err">{{ showErr('applicant_email') }}</em>
            </label>
            <label class="na-field full" :class="{ invalid: showErr('applicant_address') }"><span>Postal / physical address *</span>
              <input v-model="draft.applicant_address" placeholder="e.g. 42 Jacaranda Ave, Vungu" autocomplete="street-address" />
              <em v-if="showErr('applicant_address')" class="na-err">{{ showErr('applicant_address') }}</em>
            </label>
            <label class="na-field" :class="{ invalid: showErr('applicant_capacity') }"><span>Applying as *</span>
              <select v-model="draft.applicant_capacity">
                <option value="">— select —</option>
                <option value="owner">Registered owner</option>
                <option value="lessee">Lessee (long lease)</option>
                <option value="agent">Agent (architect / attorney)</option>
              </select>
              <em v-if="showErr('applicant_capacity')" class="na-err">{{ showErr('applicant_capacity') }}</em>
            </label>
          </div>
          <div v-if="draft.applicant_capacity && draft.applicant_capacity !== 'owner'" class="na-grid">
            <label class="na-field" :class="{ invalid: showErr('owner_name') }"><span>Registered owner name *</span>
              <input v-model="draft.owner_name" />
              <em v-if="showErr('owner_name')" class="na-err">{{ showErr('owner_name') }}</em>
            </label>
            <label class="na-field" :class="{ invalid: showErr('owner_phone') }"><span>Owner phone</span>
              <input :value="draft.owner_phone" placeholder="0771234567" type="tel" inputmode="tel"
                     @input="draft.owner_phone = sanitizePhone(($event.target as HTMLInputElement).value)" />
              <em v-if="showErr('owner_phone')" class="na-err">{{ showErr('owner_phone') }}</em>
            </label>
          </div>
          <p v-if="draft.applicant_capacity === 'agent'" class="na-hint">As an agent you must hold the owner’s written consent — confirm it at the declaration step, and stage the authority letter in Documents.</p>
          <IdentityDocVerifier @extracted="onIdVerified" />
        </div>

        <!-- Step 2 — site -->
        <div v-else-if="step === 2" class="na-step">
          <div class="na-grid">
            <label class="na-field" :class="{ invalid: showErr('stand_number') }"><span>Stand number *</span>
              <span class="na-stand-field">
                <button type="button" class="na-pin" aria-label="Pick stand on map" @click="pickerOpen = true"><MapPin :size="14" /></button>
                <input name="na-stand-no" v-model="draft.stand_number" />
              </span>
              <em v-if="showErr('stand_number')" class="na-err">{{ showErr('stand_number') }}</em>
            </label>
            <label class="na-field" :class="{ invalid: showErr('suburb_ward') }"><span>Suburb / Ward *</span>
              <input v-model="draft.suburb_ward" />
              <em v-if="showErr('suburb_ward')" class="na-err">{{ showErr('suburb_ward') }}</em>
            </label>
            <label class="na-field" :class="{ invalid: showErr('site_area_sqm') }"><span>Area of site (m²) *</span>
              <input :value="draft.site_area_sqm" inputmode="decimal" placeholder="e.g. 1200"
                     @input="onDecimal('site_area_sqm', $event)" />
              <em v-if="showErr('site_area_sqm')" class="na-err">{{ showErr('site_area_sqm') }}</em>
            </label>
            <label class="na-field"><span>Title-deed type</span>
              <select v-model="draft.title_deed_type">
                <option value="">— select —</option>
                <option value="deed_of_transfer">Deed of transfer</option>
                <option value="certificate_of_registered_title">Certificate of registered title</option>
                <option value="deed_of_grant">Deed of grant</option>
              </select>
            </label>
            <label class="na-field"><span>Title deed no</span><input v-model="draft.title_deed_no" /></label>
            <label class="na-field"><span>Lease number</span><input v-model="draft.lease_number" /></label>
            <label class="na-field full"><span>Present / last use of the property</span>
              <input v-model="draft.present_use" placeholder="e.g. Vacant since 2019 · single dwelling" />
            </label>
          </div>
          <label class="na-check">
            <input type="checkbox" v-model="draft.title_deed_conflict" />
            <span>The proposed development conflicts with a condition registered against the title deed (Section 26, Q5 — a photostat of the title deed will be required).</span>
          </label>
        </div>

        <!-- Step 3 — proposal -->
        <div v-else-if="step === 3" class="na-step">
          <div class="na-grid">
            <label class="na-field" :class="{ invalid: showErr('development_type') }"><span>Development / land-use type *</span>
              <select v-model="draft.development_type">
                <option value="">— select —</option>
                <option value="residential">Residential</option>
                <option value="commercial">Commercial</option>
                <option value="industrial">Industrial</option>
                <option value="agricultural">Agricultural</option>
                <option value="institutional">Institutional</option>
                <option value="subdivision">Subdivision</option>
                <option value="change_of_use">Change of use</option>
                <option value="advertisement">Advertisement</option>
                <option value="other">Other</option>
              </select>
              <em v-if="showErr('development_type')" class="na-err">{{ showErr('development_type') }}</em>
            </label>
            <label class="na-field" :class="{ invalid: showErr('works_nature') }"><span>Nature of works *</span>
              <select v-model="draft.works_nature">
                <option value="">— select —</option>
                <option value="new_building">New building(s)</option>
                <option value="alteration">Alteration to building(s)</option>
                <option value="addition">Addition to building(s)</option>
                <option value="change_of_use">Change of use only</option>
              </select>
              <em v-if="showErr('works_nature')" class="na-err">{{ showErr('works_nature') }}</em>
            </label>
            <label class="na-field" :class="{ invalid: showErr('estimated_cost') }"><span>Estimated cost (USD) *</span>
              <input :value="draft.estimated_cost" inputmode="decimal" placeholder="e.g. 25000"
                     @input="onDecimal('estimated_cost', $event)" />
              <em v-if="showErr('estimated_cost')" class="na-err">{{ showErr('estimated_cost') }}</em>
            </label>
            <label class="na-field" :class="{ invalid: showErr('external_floor_area') }"><span>External floor area (m²)</span>
              <input :value="draft.external_floor_area" inputmode="decimal" placeholder="e.g. 180"
                     @input="onDecimal('external_floor_area', $event)" />
              <em v-if="showErr('external_floor_area')" class="na-err">{{ showErr('external_floor_area') }}</em>
            </label>
            <label class="na-field full"><span>Description of the proposal</span>
              <textarea v-model="draft.description" rows="3"
                placeholder="Describe the proposed works and the purpose for which the land/buildings will be used (e.g. 3-bedroom dwelling, 120 m² double garage)."></textarea>
            </label>
          </div>
          <label class="na-check">
            <input type="checkbox" v-model="draft.new_access" />
            <span>The development involves a new access, or an alteration to an existing access, to the property (Q8).</span>
          </label>
          <label v-if="draft.new_access" class="na-field full" :class="{ invalid: showErr('new_access_detail') }"><span>Access details</span>
            <input v-model="draft.new_access_detail" placeholder="Describe the new or altered access" />
            <em v-if="showErr('new_access_detail')" class="na-err">{{ showErr('new_access_detail') }}</em>
          </label>

          <div v-if="needsPartIII" class="na-partiii">
            <h4 class="na-sub-h">Additional details — Part III (commercial / industrial / multi-unit)</h4>
            <div class="na-grid">
              <label class="na-field" :class="{ invalid: showErr('num_floors') }"><span>Number of floors *</span>
                <input :value="draft.num_floors" inputmode="numeric" @input="onInteger('num_floors', $event)" />
                <em v-if="showErr('num_floors')" class="na-err">{{ showErr('num_floors') }}</em>
              </label>
              <label class="na-field" :class="{ invalid: showErr('total_floor_area') }"><span>Total floor area (m²) *</span>
                <input :value="draft.total_floor_area" inputmode="decimal" @input="onDecimal('total_floor_area', $event)" />
                <em v-if="showErr('total_floor_area')" class="na-err">{{ showErr('total_floor_area') }}</em>
              </label>
              <label class="na-field full"><span>Parking provision (occupants · visitors · loading)</span>
                <input v-model="draft.parking_detail" placeholder="e.g. 12 bays + 2 loading bays" />
              </label>
            </div>
            <div v-if="isIndustrial" class="na-grid">
              <label class="na-field full"><span>Processes to be carried out</span><textarea v-model="draft.industrial_processes" rows="2"></textarea></label>
              <label class="na-field"><span>Trade effluent / waste water</span><input v-model="draft.industrial_effluent" /></label>
              <label class="na-field"><span>Gas / smoke / dust emissions</span><input v-model="draft.industrial_emissions" /></label>
              <label class="na-field full"><span>Noise to be produced</span><input v-model="draft.industrial_noise" /></label>
              <label class="na-check">
                <input type="checkbox" v-model="draft.retail_on_site" />
                <span>Retail sales will be conducted from the premises.</span>
              </label>
            </div>
          </div>
        </div>

        <!-- Step 4 — documents checklist -->
        <div v-else-if="step === 4" class="na-step">
          <p class="na-hint">Attach each document below (PDF, JPG or PNG, up to 10 MB). Files upload to Council
            when you submit on the next step, so keep this tab open until then.</p>
          <p v-if="showErr('documents')" class="na-err">{{ showErr('documents') }}</p>
          <ul class="na-doc-list">
            <li v-for="d in requiredDocs" :key="d.type"
                :class="{ ok: stagedTypes.has(d.type), missing: d.mandatory && !stagedTypes.has(d.type) }">
              <CheckCircle2 v-if="stagedTypes.has(d.type)" :size="15" />
              <AlertTriangle v-else-if="d.mandatory" :size="15" />
              <span v-else class="na-doc-spacer"></span>
              <div class="na-doc-body">
                <strong>{{ DOC_TYPE_LABELS[d.type] }}</strong>
                <span v-if="d.notes">{{ d.notes }}</span>
                <em v-if="d.mandatory" class="na-mand">mandatory</em>
                <ul v-if="stagedOf(d.type).length" class="na-doc-files">
                  <li v-for="f in stagedOf(d.type)" :key="f.id" :class="{ stale: !isAttached(f) }">
                    <span>{{ f.filename }}<template v-if="!isAttached(f)"> · re-attach (the file was not kept after the page reloaded)</template></span>
                    <button type="button" class="na-doc-remove" :aria-label="`Remove ${f.filename}`"
                            @click="cc.removeDocument(draft.id, f.id)"><Trash2 :size="13" /></button>
                  </li>
                </ul>
              </div>
              <label class="na-attach">
                <Upload :size="14" /> {{ stagedTypes.has(d.type) ? 'Add another' : 'Attach' }}
                <input type="file" class="sr-only" multiple
                       accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                       @change="attachFor(d.type, $event)" />
              </label>
            </li>
          </ul>
        </div>

        <!-- Step 5 — declarations + submit -->
        <div v-else class="na-step">
          <label class="na-check">
            <input type="checkbox" v-model="draft.consent_to_publish" />
            <span>I consent to public notification of this application under Section 26(3) of the RTCP Act.</span>
          </label>
          <label class="na-check">
            <input type="checkbox" v-model="draft.declaration_signed" />
            <span>I declare that the information provided is true and correct, and I authorise Council
              officers to enter the site for inspection purposes.</span>
          </label>
          <label v-if="draft.applicant_capacity && draft.applicant_capacity !== 'owner'" class="na-check">
            <input type="checkbox" v-model="draft.owner_consent_confirmed" />
            <span>I confirm the registered owner’s written consent to this application is held (and bondholder
              consent where the title is bonded), as required by Section 26.</span>
          </label>

          <div class="na-review">
            <h4>Review</h4>
            <div class="na-review-grid">
              <div><label>Applicant</label><span>{{ draft.applicant_name }} · {{ draft.applicant_id_number }}</span></div>
              <div><label>Stand</label><span>{{ draft.stand_number }} · {{ draft.suburb_ward }}</span></div>
              <div><label>Type</label><span>{{ draft.development_type }}</span></div>
              <div><label>Works · cost</label><span>{{ draft.works_nature || '—' }} · USD {{ draft.estimated_cost || '—' }}</span></div>
              <div><label>Applying as</label><span class="na-cap">{{ draft.applicant_capacity || '—' }}</span></div>
              <div><label>Description</label><span>{{ draft.description || '—' }}</span></div>
              <div><label>Documents staged</label><span>{{ draft.documents.length }}</span></div>
              <div><label>Mandatory outstanding</label>
                <span :class="{ 'na-red': missingMandatory.length }">{{ missingMandatory.length }}</span>
              </div>
            </div>
          </div>

          <PaymentMethodPicker
            v-if="council"
            :price-usd="council.application_fee"
            :council="{ name: council.name }"
            :busy="paying"
            @submit="handlePay"
            @cancel="step = (step - 1) as 1 | 2 | 3 | 4 | 5"
          />
          <p v-else-if="councilError" class="na-err" role="alert">
            {{ councilError }} <button type="button" class="na-btn link" @click="loadCouncil">Try again</button>
          </p>
          <p v-else class="na-loading">Loading the application fee…</p>
        </div>
      </div>

      <!-- Footer -->
      <div class="na-foot">
        <button v-if="step > 1 && step < 5" class="na-btn ghost" @click="backStep">
          <ArrowLeft :size="16" /> Back
        </button>
        <span class="na-flex"></span>
        <button v-if="step < 5" class="na-btn link" @click="saveForLater">Save for later</button>
        <button v-if="step < 5" class="na-btn primary" @click="nextStep">
          Next step <ArrowRight :size="16" />
        </button>
      </div>
    </div>

    <UiFeedback :feedback="fb" />
    <StandPickerModal :open="pickerOpen" @close="pickerOpen = false" @select="applyStandSelection" />
  </div>
</template>

<style scoped>
/* Tokens (--cp-*) inherited from .cp-root */
.na { padding:1rem; display:flex; flex-direction:column; gap:1rem; max-width:960px; margin:0 auto; width:100%; }

/* Toolbar */
.na-bar { display:flex; align-items:center; justify-content:space-between; gap:0.75rem; }
.na-bar-l { display:flex; align-items:center; gap:0.6rem; min-width:0; }
.na-bar-ic { color:var(--cp-primary); }
.na-bar-title { font-size:1.05rem; font-weight:700; letter-spacing:-0.01em; color:var(--cp-text); }
.na-draft-select { margin-left:0.4rem; padding:0.35rem 0.6rem; border:1px solid var(--cp-border);
  border-radius:var(--cp-radius-sm); background:var(--cp-surface); font-size:0.78rem; color:var(--cp-text); max-width:14rem; }
.na-new { display:inline-flex; align-items:center; gap:0.35rem; padding:0.5rem 0.85rem;
  background:var(--cp-primary); color:var(--cp-on-primary); border:0; border-radius:var(--cp-radius-sm);
  font-size:0.8rem; font-weight:600; cursor:pointer; }
.na-new:hover { background:var(--cp-primary-hover); }

/* Card */
.na-card { background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius);
  box-shadow:var(--cp-shadow); overflow:hidden; }

/* Start (no draft) */
.na-start { text-align:center; padding:3rem 1.5rem; display:flex; flex-direction:column; align-items:center; gap:0.6rem; }
.na-start-ic { display:inline-flex; align-items:center; justify-content:center; width:64px; height:64px;
  border-radius:var(--cp-radius); background:var(--cp-primary-tint); color:var(--cp-primary); margin-bottom:0.4rem; }
.na-start h3 { margin:0; font-size:1.05rem; font-weight:700; color:var(--cp-text); }
.na-start p { margin:0 0 0.5rem; max-width:34rem; font-size:0.85rem; line-height:1.55; color:var(--cp-text-2); }

/* Progress header */
.na-prog { display:flex; align-items:flex-end; justify-content:space-between; gap:1rem; padding:1.25rem 1.5rem 0.85rem; }
.na-prog-label { font-size:0.72rem; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; color:var(--cp-primary); }
.na-prog-title { margin:0.15rem 0 0; font-size:1.15rem; font-weight:700; letter-spacing:-0.01em; color:var(--cp-text); }
.na-prog-meta { display:flex; align-items:center; gap:0.6rem; flex-shrink:0; }
.na-prog-count { font-family:var(--cp-mono); font-size:0.74rem; color:var(--cp-muted); white-space:nowrap; }
.na-trash { display:inline-flex; background:none; border:0; color:var(--cp-faint); cursor:pointer; padding:0.2rem; }
.na-trash:hover { color:var(--cp-red-fg); }
.na-prog-bar { height:6px; margin:0 1.5rem; background:var(--cp-surface-2); border-radius:var(--cp-radius-pill); overflow:hidden; }
.na-prog-fill { height:100%; background:var(--cp-primary); border-radius:var(--cp-radius-pill); transform-origin:left; transition:transform 160ms cubic-bezier(0.16, 1, 0.3, 1); }

/* Content */
.na-content { padding:1.5rem; }
.na-hint { font-size:0.8rem; color:var(--cp-text-2); line-height:1.5; margin:0 0 1rem; }
.na-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:0.85rem; }
.na-field { display:flex; flex-direction:column; gap:0.3rem; }
.na-field.full { grid-column:1 / -1; }
.na-field > span { font-size:0.74rem; font-weight:600; color:var(--cp-text-2); }
.na-field.invalid input, .na-field.invalid select, .na-field.invalid textarea {
  border-color:var(--cp-red-fg); }
.na-err { font-size:0.72rem; font-style:normal; color:var(--cp-red-fg); }
.na-field input, .na-field select, .na-field textarea {
  padding:0.55rem 0.7rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm);
  font-size:0.85rem; color:var(--cp-text); font-family:inherit; background:var(--cp-surface); resize:vertical; }
.na-field input:focus, .na-field select:focus, .na-field textarea:focus {
  outline:2px solid var(--cp-primary); outline-offset:-2px; border-color:var(--cp-primary); }

.na-stand-field { display:flex; align-items:stretch; }
.na-stand-field input { flex:1; border-top-left-radius:0; border-bottom-left-radius:0; }
.na-pin { display:inline-flex; align-items:center; justify-content:center; width:2.2rem; flex-shrink:0;
  border:1px solid var(--cp-border); border-right:none; border-top-left-radius:var(--cp-radius-sm);
  border-bottom-left-radius:var(--cp-radius-sm); background:var(--cp-surface-2); color:var(--cp-primary); cursor:pointer; }
.na-pin:hover { background:var(--cp-primary-tint); }

/* Document checklist */
.na-doc-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.5rem; }
.na-doc-list > li { display:flex; align-items:flex-start; gap:0.6rem; padding:0.7rem 0.85rem;
  border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); background:var(--cp-surface); }
.na-doc-list > li.ok { background:var(--cp-green-bg); }
.na-doc-list > li.missing { background:var(--cp-red-bg); }
.na-doc-list > li.ok > :deep(svg) { color:var(--cp-green-fg); margin-top:0.1rem; flex-shrink:0; }
.na-doc-list > li.missing > :deep(svg) { color:var(--cp-red-fg); margin-top:0.1rem; flex-shrink:0; }
.na-doc-spacer { width:15px; display:inline-block; flex-shrink:0; }
.na-doc-body { flex:1; min-width:0; }
.na-doc-body > strong { display:block; font-size:0.82rem; color:var(--cp-text); }
.na-doc-body > span { display:block; font-size:0.74rem; color:var(--cp-muted); margin-top:0.1rem; }
.na-doc-files { list-style:none; margin:0.45rem 0 0; padding:0; display:flex; flex-direction:column; gap:0.25rem; }
.na-doc-files li { display:flex; align-items:center; gap:0.4rem; font-size:0.76rem; color:var(--cp-text); }
.na-doc-files li span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.na-doc-files li.stale { color:var(--cp-amber-fg); }
.na-doc-remove { display:inline-flex; border:0; background:none; padding:0.2rem; color:var(--cp-muted); cursor:pointer; flex-shrink:0; }
.na-doc-remove:hover { color:var(--cp-red-fg); }
.na-attach { display:inline-flex; align-items:center; gap:0.3rem; flex-shrink:0; align-self:center; padding:0.4rem 0.7rem;
  border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); background:var(--cp-surface);
  font-size:0.76rem; font-weight:600; color:var(--cp-primary); cursor:pointer; white-space:nowrap; }
.na-attach:hover { border-color:var(--cp-primary); }
.na-attach:focus-within { outline:2px solid var(--cp-primary); outline-offset:2px; }
.na-mand { display:inline-block; margin-top:0.25rem; font-size:0.62rem; font-weight:700; font-style:normal;
  text-transform:uppercase; letter-spacing:0.05em; color:var(--cp-red-fg); }

/* Declarations */
.na-check { display:flex; align-items:flex-start; gap:0.6rem; padding:0.75rem 0.85rem; margin-bottom:0.6rem;
  border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); font-size:0.82rem; line-height:1.45; cursor:pointer; }
.na-check:hover { background:var(--cp-primary-tint); }
.na-check input { margin-top:0.15rem; accent-color:var(--cp-primary); }

.na-review { background:var(--cp-surface-2); border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm);
  padding:0.85rem 1rem; margin:0.6rem 0 1rem; }
.na-review h4 { margin:0 0 0.5rem; font-size:0.72rem; font-weight:700; text-transform:uppercase;
  letter-spacing:0.05em; color:var(--cp-primary); }
.na-review-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:0.6rem; }
.na-review-grid label { display:block; font-size:0.62rem; color:var(--cp-faint); text-transform:uppercase; letter-spacing:0.05em; }
.na-review-grid span { display:block; font-size:0.82rem; color:var(--cp-text); margin-top:0.1rem; }
.na-red { color:var(--cp-red-fg); font-weight:700; }
.na-loading { padding:1.5rem; text-align:center; color:var(--cp-faint); font-size:0.82rem; }

/* Footer */
.na-foot { display:flex; align-items:center; gap:0.6rem; padding:1rem 1.5rem; border-top:1px solid var(--cp-border); background:var(--cp-surface-2); }
.na-flex { flex:1; }
.na-btn { display:inline-flex; align-items:center; gap:0.4rem; padding:0.55rem 1.1rem;
  border:1px solid transparent; border-radius:var(--cp-radius-sm); font-size:0.85rem; font-weight:600; cursor:pointer; }
.na-btn.primary { background:var(--cp-primary); color:var(--cp-on-primary); }
.na-btn.primary:hover { background:var(--cp-primary-hover); }
.na-btn.primary:active { transform:scale(0.98); }
.na-btn.ghost { background:transparent; color:var(--cp-text-2); }
.na-btn.ghost:hover { color:var(--cp-text); }
.na-btn.link { background:none; color:var(--cp-muted); }
.na-btn.link:hover { color:var(--cp-text); }

/* Part III (commercial / industrial) */
.na-partiii { margin-top:0.5rem; padding-top:0.9rem; border-top:1px dashed var(--cp-border); }
.na-sub-h { margin:0 0 0.65rem; font-size:0.72rem; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:var(--cp-primary); }
.na-partiii .na-grid { margin-bottom:0.6rem; }
</style>
