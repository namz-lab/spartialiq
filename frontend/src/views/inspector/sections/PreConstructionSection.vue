<script setup lang="ts">
// Pre-construction verification — the inspector's first duty under the Model
// Building By-Laws (1977): before any ground is broken, confirm the approved
// plan, permit validity (12-month commencement window), cadastral pegs,
// building lines and orientation.
//
// The verification is written to the permit case file first; the device only
// shows it as verified once the server has accepted it. The recording officer
// is the signed-in user, not a free-text name anyone could type.
import { computed, ref, watch } from 'vue'
import { ClipboardCheck, CheckCircle2, AlertTriangle, ShieldAlert, FileCheck, CalendarClock } from 'lucide-vue-next'
import { useInspectionCase, type PreConstructionCheck } from '@/composables/useInspectionCase'
import { useAuthStore } from '@/stores/auth'
import { dmApi, type StageInspection } from '@/services/developmentManagementService'
import { permitValidity } from '@/inspector/caseFile'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import InspectorCasePicker from '@/components/inspector/InspectorCasePicker.vue'

const emit = defineEmits<{ 'open-section': [key: 'enforcement'] }>()

const ic = useInspectionCase()
const auth = useAuthStore()
const fb = useUiFeedback()

const permit = computed(() => ic.current.value?.permit ?? null)
const pre = computed(() => ic.current.value?.preConstruction ?? null)
const saving = ref(false)

watch(pre, () => { ic.save() }, { deep: true })

type CheckKey = keyof Pick<PreConstructionCheck,
  'approvedPlanOnSite' | 'developmentPermitHeld' | 'permitWithinValidity'
  | 'cadastralPegsIntact' | 'buildingLinesRespected' | 'orientationCorrect'>

const CHECKS: ReadonlyArray<{ key: CheckKey; title: string; detail: string }> = [
  { key: 'approvedPlanOnSite',     title: 'Approved building plan held on site',
    detail: 'A stamped and signed copy is available for inspection (Sec 7).' },
  { key: 'developmentPermitHeld',  title: 'Development permit held by the owner',
    detail: 'RTCP Act Section 26 permit issued for this stand.' },
  { key: 'permitWithinValidity',   title: 'Permit within its 12-month commencement window',
    detail: 'The permit lapses if work does not commence within 12 months of the decision.' },
  { key: 'cadastralPegsIntact',    title: 'Cadastral pegs intact and correctly placed',
    detail: 'All corner pegs match the Surveyor-General diagram.' },
  { key: 'buildingLinesRespected', title: 'Building lines and setbacks respected',
    detail: 'Front, side and rear distances match the approved plan and zoning.' },
  { key: 'orientationCorrect',     title: 'Building orientation matches the approved plan',
    detail: 'Facade, frontage and access points as drawn.' },
]

const confirmed = computed(() => (pre.value ? CHECKS.filter(c => pre.value![c.key]).length : 0))

// The validity check is the one condition the council's own record can answer.
const inspections = ref<StageInspection[]>([])
// A failed read is NOT "no stages on record". permitValidity answers
// 'commenced' only when some inspection carries an inspected_at, so swallowing
// the failure into an empty array turns a dropped request into a date
// computation that can print "this permit lapsed — do not confirm" about a
// permit whose work started months ago. The failure is kept and disclosed.
const inspectionsError = ref(false)
watch(() => permit.value?.id, async (id) => {
  inspections.value = []
  inspectionsError.value = false
  if (!id) return
  try {
    inspections.value = await dmApi.listStageInspections(id)
  } catch {
    inspectionsError.value = true
  }
}, { immediate: true })
const validity = computed(() => permitValidity(permit.value?.decision_at, inspections.value))
const validityText = computed(() => {
  if (inspectionsError.value) {
    return {
      tone: 'warning',
      text: 'The stage register could not be read, so whether this permit is still live is unknown. '
        + 'Check the permit document before confirming.',
    }
  }
  const v = validity.value
  const on = v.lapsesOn?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  if (v.state === 'commenced') return { tone: 'positive', text: 'Work has commenced: a stage is already on record.' }
  if (v.state === 'lapsed') return { tone: 'negative', text: `The register shows this permit lapsed on ${on}. Do not confirm.` }
  if (v.state === 'expiring') return { tone: 'warning', text: `Lapses on ${on} — ${v.daysLeft} days left.` }
  if (v.state === 'valid') return { tone: 'positive', text: `Valid until ${on} (${v.daysLeft} days).` }
  return { tone: 'neutral', text: 'No decision date on the register. Check the permit document.' }
})

async function record() {
  const c = ic.current.value
  if (!c || saving.value) return
  if (!ic.preConstructionPassed.value) {
    fb.openMessageBox({
      kind: 'warn',
      title: 'Verification incomplete',
      message: 'All six conditions must be confirmed before recording. If a condition fails on site, stop and refer the case for enforcement.',
    })
    return
  }
  saving.value = true
  try {
    const result = await ic.recordPreConstruction(auth.userName || auth.userEmail || 'Building inspector')
    if (!result.ok) { fb.showToast(result.error, 'error'); return }
    fb.showToast('Pre-construction verification recorded on the case file.', 'success')
  } finally {
    saving.value = false
  }
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="ins-page pc">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Field work</span>
        <h2 class="ins-title">Pre-construction verification</h2>
        <p class="ins-lede">Confirm on site, before any earthworks, that the build can lawfully start where and how it was approved.</p>
      </div>
    </header>

    <div class="ins-split">
      <div class="ins-sticky">
        <InspectorCasePicker heading="Approved permits" />
      </div>

      <div v-if="!pre || !permit" class="ins-card pc-none">
        <FileCheck :size="28" aria-hidden="true" />
        <h3>Choose a permit to begin</h3>
        <p>The checks are recorded against the permit's case file and shown to the planner.</p>
      </div>

      <section v-else class="ins-card" aria-labelledby="pc-h">
        <header class="ins-card-head">
          <h3 id="pc-h"><ClipboardCheck :size="16" aria-hidden="true" />
            Stand {{ permit.stand_number }} <span class="ins-count">{{ permit.applicant_name }}</span></h3>
          <UiStatusBadge v-if="pre.verifiedAt && ic.preConstructionPassed.value" tone="positive" label="Verified" />
          <UiStatusBadge v-else-if="ic.preConstructionPassed.value" tone="info" label="Ready to record" />
          <UiStatusBadge v-else tone="neutral" :label="`${confirmed} of 6 confirmed`" />
        </header>

        <div class="ins-card-body pc-body">
          <div class="ins-bar t-positive" role="progressbar" :aria-valuenow="confirmed" aria-valuemin="0" aria-valuemax="6"
               aria-label="Conditions confirmed">
            <span :style="{ '--fill': confirmed / 6 }" />
          </div>

          <ul class="ins-checks">
            <li v-for="c in CHECKS" :key="c.key">
              <label class="ins-check" :class="{ on: pre[c.key] }">
                <input v-model="pre[c.key]" type="checkbox" />
                <span>
                  <strong>{{ c.title }}</strong>
                  <small>{{ c.detail }}</small>
                  <small v-if="c.key === 'permitWithinValidity'" class="pc-validity" :class="`t-${validityText.tone}`">
                    <CalendarClock :size="13" aria-hidden="true" /> {{ validityText.text }}
                  </small>
                </span>
              </label>
            </li>
          </ul>

          <label class="ins-field">
            <span class="ins-label">Site notes</span>
            <textarea v-model="pre.notes" class="ins-input" rows="3"
                      placeholder="Soil conditions, neighbour concerns, earthworks already started"></textarea>
          </label>

          <!-- Only when the register actually answered. An unread register
               must never be shown as a lapsed permit. -->
          <div v-if="validity.state === 'lapsed' && !inspectionsError" class="ins-banner t-negative" role="status">
            <ShieldAlert :size="16" aria-hidden="true" />
            <div><strong>Building on a lapsed permit is unauthorised work.</strong>
              <p>If work has started, record what you saw in the notes and refer the case.</p></div>
            <UiButton size="sm" @click="emit('open-section', 'enforcement')">Refer</UiButton>
          </div>
        </div>

        <footer class="ins-card-foot pc-foot">
          <span class="pc-stamp">
            <CheckCircle2 v-if="pre.verifiedAt" :size="14" aria-hidden="true" />
            <AlertTriangle v-else :size="14" aria-hidden="true" />
            {{ pre.verifiedAt ? `Recorded ${fmt(pre.verifiedAt)} by ${pre.verifiedBy}` : `Will be recorded as ${auth.userName || 'you'}` }}
          </span>
          <UiButton variant="ghost" @click="emit('open-section', 'enforcement')">
            <template #icon><ShieldAlert :size="14" /></template>
            A condition fails
          </UiButton>
          <UiButton variant="primary" :loading="saving" :disabled="!ic.preConstructionPassed.value" @click="record">
            <template #icon><CheckCircle2 :size="15" /></template>
            Record verification
          </UiButton>
        </footer>
      </section>
    </div>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.pc-none { display: flex; flex-direction: column; align-items: center; gap: var(--ent-s2); padding: var(--ent-s8) var(--ent-s5); text-align: center; color: var(--ent-text-3); }
.pc-none h3 { margin: 0; font-size: var(--ent-fs-md); color: var(--ent-text); }
.pc-none p { margin: 0; font-size: var(--ent-fs-sm); max-width: 40ch; }
.pc-body { display: flex; flex-direction: column; gap: var(--ent-s4); }
.pc-validity { display: inline-flex; align-items: center; gap: var(--ent-s1); margin-top: var(--ent-s2); font-weight: var(--ent-fw-semibold); }
.pc-validity.t-positive { color: var(--ent-success); }
.pc-validity.t-warning { color: var(--ent-warning); }
.pc-validity.t-negative { color: var(--ent-danger); }
.pc-foot { position: sticky; bottom: 0; z-index: var(--ent-z-sticky); }
.pc-stamp { display: inline-flex; align-items: center; gap: var(--ent-s2); margin-right: auto; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
@media (max-width: 767px) {
  .pc-foot { flex-direction: column; align-items: stretch; }
  .pc-stamp { margin: 0; }
}
</style>
