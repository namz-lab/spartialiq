<script setup lang="ts">
// Application 360 — persistent case workspace. Tabs wrap the existing
// Section 26 step forms so the planner does not leave the application.
import { ref, computed, watch, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useOrProvidePlannerCase, type DevType } from '@/composables/usePlannerCase'
import { useStatutorySteps } from '@/composables/useStatutorySteps'
import { deriveStatutoryState } from '@/composables/useStatutoryClock'
import { PLANNER_SHELL_KEY } from '@/composables/usePlannerShell'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { deriveCaseBlockers } from '@/views/planner/caseBlockers'
import {
  APPLICATION_360_TABS, TAB_LABEL, isApplication360Tab, tabForStep,
  type Application360Tab,
} from '@/views/planner/application360Tabs'
import { analyseSiteAt, downloadSiteAssessmentReport, exactStandMatch, type SiteSummary } from '@/views/planner/siteAnalysis'
import { findParcels, type StandLocation } from '@/services/parcels'
import StandPickerModal from '@/components/StandPickerModal.vue'
import { envelopeRule, useRuleFromDecision, type RuleRow } from '@/views/planner/planningRules'
import { planningAssistantService } from '@/services/planningAssistantService'
import { dmApi, type StageInspection, type EnforcementOrder } from '@/services/developmentManagementService'
import StatutoryClockBanner from './StatutoryClockBanner.vue'
import StatutoryStepper from './StatutoryStepper.vue'
import Step1Intake from './Step1Intake.vue'
import Step2DueDiligence from './Step2DueDiligence.vue'
import Step3CommitteeReport from './Step3CommitteeReport.vue'
import Step4PermitDrafting from './Step4PermitDrafting.vue'
import Step5Notices from './Step5Notices.vue'
import StepLockGate from './StepLockGate.vue'
import CaseFileDrawer from './CaseFileDrawer.vue'
import CaseBlockersPanel from './CaseBlockersPanel.vue'
import CaseAuditTrail from './CaseAuditTrail.vue'
import PermitDocumentsPanel from '@/components/workflow/PermitDocumentsPanel.vue'
import CaseReferralsPanel from './case/CaseReferralsPanel.vue'
import CaseClockPanel from './case/CaseClockPanel.vue'
import CasePicker from './case/CasePicker.vue'
import { statusLabel } from '@/composables/useApplicationPipeline'
import RefusalDrafting from './permit/RefusalDrafting.vue'
import AppealsSection from './sections/AppealsSection.vue'
import {
  Settings, MapPin,
} from 'lucide-vue-next'

const ctx = useOrProvidePlannerCase()
const { steps } = useStatutorySteps(ctx)
const shell = inject(PLANNER_SHELL_KEY, null)
const route = useRoute()
const router = useRouter()
const { isMobile } = useBreakpoint()

const activeStep = ref<1|2|3|4|5>(1)
const activeTab = ref<Application360Tab>('overview')
const drawerOpen = ref(false)

watch(() => ctx.current.value?.permitId, (id) => { if (id) activeStep.value = 2 })
watch(() => route.query.tab, (tab) => {
  if (typeof tab === 'string' && isApplication360Tab(tab)) activeTab.value = tab
}, { immediate: true })

function setTab(tab: Application360Tab) {
  activeTab.value = tab
  void router.replace({ query: { ...route.query, tab, section: 'workflow', pane: 'console' } })
}

function onStepSelect(id: number) {
  const n = id as 1|2|3|4|5
  if (n === 1 || n === 5 || (n === 2 && ctx.step2Unlocked.value)
    || (n === 3 && ctx.step3Unlocked.value) || (n === 4 && ctx.step4Unlocked.value)) {
    activeStep.value = n
    setTab(tabForStep(n))
  }
}

const DEV_TYPE_LABEL: Record<DevType, string> = {
  new_building: 'New Building', alteration: 'Alteration', extension: 'Extension',
  change_of_use: 'Change of Use', subdivision: 'Subdivision',
  consolidation: 'Consolidation', rezoning: 'Rezoning', other: 'Development Application',
}
const c = computed(() => ctx.current.value)
/** A recorded refuse resolution turns the Decision tab into the refusal draft. */
const refusing = computed(() => !!c.value?.committeeReport.resolutionAt && c.value.committeeReport.recommendation === 'refuse')
const proposalTitle = computed(() => {
  const cf = c.value
  if (!cf) return 'No case selected'
  const desc = cf.proposal.description?.trim()
  return desc && desc.length <= 72 ? desc : DEV_TYPE_LABEL[cf.proposal.devType]
})
const caseNo = computed(() => c.value?.registrationNo || '—')
const clock = computed(() => deriveStatutoryState(c.value?.acknowledgedDate ?? null))
const deadlineLabel = computed(() => {
  const d = clock.value.expiryDate
  if (!d) return 'Not started'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
})
const daysLabel = computed(() => {
  if (!c.value?.acknowledgedDate) return 'Clock not started'
  if (clock.value.daysRemaining <= 0) return 'Overdue'
  if (clock.value.daysRemaining === 1) return '1 day'
  return `${clock.value.daysRemaining} days remaining`
})
const blockers = computed(() => c.value ? deriveCaseBlockers(c.value) : { blockers: [], nextAction: 'Open or register an application.' })

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Case location ─────────────────────────────────────────────────────
// Site analysis, planning rules and "show on map" all need the case pinned to
// a parcel. Counter and citizen applications usually arrive with only a stand
// number, and the old message ("pin the property on the map first") offered
// no way to do it. Now: an unambiguous stand-register match pins the case
// silently; otherwise the stand picker opens, and the action the officer
// asked for runs once the site is chosen. The pin is saved to the case.
const pickerOpen = ref(false)
let afterPin: (() => void) | null = null

function pinCase(centroid: [number, number], fid?: number) {
  if (!c.value) return
  c.value.property.centroid = centroid
  if (fid != null) c.value.property.parcelFid = fid
  ctx.save()
}

async function withLocation(action: () => void) {
  if (c.value?.property.centroid) return action()
  const standNo = c.value?.property.standNo ?? ''
  const hit = standNo ? exactStandMatch(await findParcels(standNo).catch(() => []), standNo) : null
  if (hit) { pinCase(hit.centroid, hit.fid); return action() }
  afterPin = action
  pickerOpen.value = true
}

function onStandPicked(loc: StandLocation) {
  pickerOpen.value = false
  if (!loc.stand) return
  pinCase(loc.stand.centroid, loc.stand.fid)
  const next = afterPin
  afterPin = null
  next?.()
}

function showOnMap() {
  void withLocation(() => shell?.flyTo(c.value!.property.centroid!))
}

const siteLoading = ref(false)
const siteError = ref('')
const siteSummary = ref<SiteSummary | null>(null)
const siteLayer = ref('vungu_parcels')
const siteFid = ref<number | null>(null)
const reportLoading = ref(false)
async function analyseSite() {
  siteError.value = ''
  const ctr = c.value?.property.centroid
  if (!ctr) return withLocation(analyseSite)
  siteLoading.value = true
  try {
    const result = await analyseSiteAt(ctr[0], ctr[1])
    if (!result) { siteError.value = 'No parcel found at this location.'; siteSummary.value = null; siteFid.value = null; return }
    siteSummary.value = result.summary
    siteLayer.value = result.layer
    siteFid.value = result.fid
  } catch {
    siteError.value = 'Site analysis could not be completed for this parcel.'
  } finally {
    siteLoading.value = false
  }
}

async function generateSiteReport() {
  if (siteFid.value == null || !siteSummary.value) {
    siteError.value = 'Run site analysis first, then generate the screening report.'
    return
  }
  reportLoading.value = true
  siteError.value = ''
  try {
    await downloadSiteAssessmentReport({
      layer: siteLayer.value,
      fid: siteFid.value,
      applicationRef: c.value?.registrationNo || undefined,
      summary: siteSummary.value,
    })
  } catch {
    siteError.value = 'Could not generate the screening PDF. Check that the API is running.'
  } finally {
    reportLoading.value = false
  }
}

const rules = ref<RuleRow[]>([])
const rulesError = ref('')
const rulesLoading = ref(false)
async function loadRules() {
  rulesError.value = ''
  const ctr = c.value?.property.centroid
  if (!ctr) return withLocation(loadRules)
  rulesLoading.value = true
  try {
    const plan = await planningAssistantService.suggest({ lng: ctr[0], lat: ctr[1] })
    const rows: RuleRow[] = []
    const source = plan.zone?.name ? `Zone ${plan.zone.name}` : 'Planning assistant'
    if (plan.zone) {
      rows.push({
        topic: 'Zoning',
        proposed: c.value?.proposal.devType.replace(/_/g, ' ') ?? '—',
        maximum: plan.zone.zoneType,
        verdict: 'PLANNER REVIEW REQUIRED',
        source,
        why: plan.zone.description || 'Confirm the proposed use against this zone.',
      })
    }
    const env = plan.template?.envelope
    if (env?.minAreaSqm != null) {
      const area = plan.stand?.areaSqm ?? null
      rows.push({
        topic: 'Lot area',
        proposed: area == null ? 'Not stated' : `${area} m²`,
        maximum: `Minimum ${env.minAreaSqm} m²`,
        verdict: area == null ? 'PLANNER REVIEW REQUIRED' : (area >= env.minAreaSqm ? 'COMPLIANT' : 'NON-COMPLIANT'),
        source,
        why: area == null
          ? 'Stand area is not on the record.'
          : area >= env.minAreaSqm
            ? `Stand ${area} m² meets the minimum ${env.minAreaSqm} m².`
            : `Stand ${area} m² is below the minimum ${env.minAreaSqm} m².`,
      })
    }
    if (env?.maxPlotCoveragePct != null) {
      rows.push(envelopeRule('Coverage', null, env.maxPlotCoveragePct, '%', source))
    }
    if (plan.permittedUses?.length) {
      const codes = plan.permittedUses.slice(0, 6).map(u => u.groupName || u.groupCode).join(', ')
      rows.push({
        topic: 'Land use',
        proposed: c.value?.proposal.description || DEV_TYPE_LABEL[c.value?.proposal.devType ?? 'other'],
        maximum: codes,
        verdict: 'PLANNER REVIEW REQUIRED',
        source,
        why: 'Compare the proposal with the permitted uses listed for this zone.',
      })
    }
    if (c.value?.dueDiligence.zoningAssessment) {
      const z = c.value.dueDiligence.zoningAssessment
      rows.unshift(useRuleFromDecision('Proposed use', z.permission, `Zone ${z.zoneName ?? z.zoneCode ?? '—'}`))
    }
    rules.value = rows
    if (!rows.length) rulesError.value = plan.reason || 'No published controls for this location yet.'
  } catch {
    rulesError.value = 'Planning rules could not be loaded.'
  } finally {
    rulesLoading.value = false
  }
}

watch(activeTab, (tab) => {
  if (tab === 'assessment' && c.value?.dueDiligence.zoningAssessment && !rules.value.length) void loadRules()
})

const inspections = ref<StageInspection[]>([])
const inspectionError = ref('')
watch(() => [activeTab.value, c.value?.permitId] as const, async ([tab, id]) => {
  if (tab !== 'inspections' || !id) return
  try { inspections.value = await dmApi.listStageInspections(id) }
  catch { inspectionError.value = 'Could not load stage inspections.'; inspections.value = [] }
}, { immediate: true })

const standEnforcement = ref<EnforcementOrder[]>([])
watch(() => [activeTab.value, c.value?.property.standNo, c.value?.permitId] as const, async ([tab, stand, permitId]) => {
  if (tab !== 'enforcement' || (!stand && !permitId)) return
  try {
    // Server-side match on stand OR permit (trimmed, case-insensitive).
    standEnforcement.value = await dmApi.listEnforcement({
      stand_number: stand || undefined, permit_app_id: permitId || undefined,
    })
  } catch { standEnforcement.value = [] }
}, { immediate: true })
</script>

<template>
  <div class="sw-root">
    <header v-if="c" class="a360-head">
      <div class="a360-id">
        <span class="cf-caseno">{{ caseNo }}</span>
        <h1>{{ proposalTitle }}</h1>
      </div>
      <dl class="a360-facts">
        <div><dt>Property</dt><dd>Stand {{ c.property.standNo || '—' }}</dd></div>
        <div><dt>Applicant</dt><dd>{{ c.applicant.name || '—' }}</dd></div>
        <div><dt>Type</dt><dd>{{ DEV_TYPE_LABEL[c.proposal.devType] }}</dd></div>
        <div><dt>Status</dt><dd>{{ c.status ? statusLabel(c.status) : 'Draft' }}</dd></div>
        <div><dt>Statutory deadline</dt><dd>{{ deadlineLabel }}</dd></div>
        <div><dt>Days remaining</dt><dd :class="'days-' + clock.warningLevel">{{ daysLabel }}</dd></div>
      </dl>
    </header>
    <StatutoryClockBanner />

    <nav v-if="c" class="a360-tabs" aria-label="Application 360">
      <button v-for="tab in APPLICATION_360_TABS" :key="tab" type="button"
              :class="{ active: activeTab === tab }"
              :aria-current="activeTab === tab ? 'page' : undefined"
              @click="setTab(tab)">{{ TAB_LABEL[tab] }}</button>
    </nav>

    <CasePicker v-if="!c" />

    <div v-else class="sw-split">
      <section class="sw-casefile">
        <div class="cf-body">
          <p class="cf-address"><MapPin :size="15" />
            {{ [c.property.standNo ? `Stand ${c.property.standNo}` : '', c.property.ward, c.property.description].filter(Boolean).join(', ') || 'Location not set' }}
          </p>
          <details v-if="isMobile" class="a360-stage-fold">
            <summary>
              Statutory stages
              <span>{{ steps.find(s => s.id === activeStep)?.title }}</span>
            </summary>
            <StatutoryStepper :steps="steps" :active-id="activeStep" @select="onStepSelect" />
          </details>
          <StatutoryStepper v-else :steps="steps" :active-id="activeStep" @select="onStepSelect" />
        </div>
      </section>

      <section class="sw-workpane">
        <div v-if="activeTab === 'overview'" class="sw-formbody a360-pane">
          <CaseBlockersPanel :blockers="blockers.blockers" :next-action="blockers.nextAction" />
          <section class="a360-card">
            <h3>Application</h3>
            <dl class="a360-kv">
              <div><dt>Number</dt><dd>{{ caseNo }}</dd></div>
              <div><dt>Proposal</dt><dd>{{ c.proposal.description || proposalTitle }}</dd></div>
              <div><dt>Workflow</dt><dd>{{ steps.find(s => s.id === activeStep)?.title }}</dd></div>
            </dl>
          </section>
          <section class="a360-card">
            <h3>Timeline</h3>
            <ol class="a360-time">
              <li><span>{{ fmtDate(c.applicationDate) }}</span> Application received</li>
              <li v-if="c.acknowledgedDate"><span>{{ fmtDate(c.acknowledgedDate) }}</span> Application acknowledged</li>
              <li v-if="c.notices.publicNotice?.publishedAt"><span>{{ fmtDate(c.notices.publicNotice.publishedAt) }}</span> Public notice issued</li>
              <li v-for="r in c.dueDiligence.referrals" :key="r.department + r.contactedAt">
                <span>{{ fmtDate(r.contactedAt) }}</span> {{ r.department }} referral {{ r.outcome.replace(/_/g, ' ') }}
              </li>
              <li v-for="o in c.notices.objections" :key="o.id">
                <span>{{ fmtDate(o.receivedAt) }}</span> Objection from {{ o.objector }}
              </li>
              <li v-if="c.dueDiligence.completedAt"><span>{{ fmtDate(c.dueDiligence.completedAt) }}</span> Planner assessment recorded</li>
            </ol>
          </section>
          <Step1Intake />
        </div>

        <div v-else-if="activeTab === 'gis'" class="sw-formbody a360-pane">
          <div class="a360-actions">
            <button type="button" class="cf-btn cf-btn--primary" @click="showOnMap">Show property on map</button>
            <button type="button" class="cf-btn cf-btn--primary" :disabled="siteLoading" @click="analyseSite">
              {{ siteLoading ? 'Analysing…' : 'Analyse site' }}
            </button>
            <button
              type="button"
              class="cf-btn"
              :disabled="reportLoading || siteFid == null"
              @click="generateSiteReport"
            >
              {{ reportLoading ? 'Generating PDF…' : 'Generate complete site report' }}
            </button>
          </div>
          <p v-if="siteError" class="a360-error">{{ siteError }}</p>
          <section v-if="siteSummary" class="a360-card">
            <h3>Planner site analysis</h3>
            <p class="a360-hint">Live PostGIS screening — advisory only; you retain determination authority.</p>
            <dl class="a360-kv">
              <div><dt>Property</dt><dd>{{ siteSummary.areaSqm?.toLocaleString() }} m² · {{ siteSummary.landUse || 'Land use not classified' }}</dd></div>
              <div><dt>Developable</dt><dd>{{ siteSummary.developableSqm?.toLocaleString() ?? '—' }} m²</dd></div>
              <div><dt>Nearby settlements</dt><dd>{{ siteSummary.adjacentCount }} identified</dd></div>
            </dl>
            <h4>Constraints</h4>
            <ul class="cb-list">
              <li v-for="con in siteSummary.constraints" :key="con.label" class="cb-item" :class="con.ok ? 'clear' : 'warning'">
                <span class="cb-mark" /> {{ con.label }}
              </li>
            </ul>
            <h4>Required referrals</h4>
            <p>{{ siteSummary.requiredReferrals.join(', ') }}</p>
          </section>
        </div>

        <div v-else-if="activeTab === 'assessment'" class="sw-formbody">
          <div class="a360-actions">
            <button type="button" class="cf-btn" :disabled="rulesLoading" @click="loadRules">
              {{ rulesLoading ? 'Evaluating…' : 'Evaluate planning rules' }}
            </button>
          </div>
          <p v-if="rulesError" class="a360-error">{{ rulesError }}</p>
          <ul v-if="rules.length" class="a360-rules">
            <li v-for="row in rules" :key="row.topic" :class="'v-' + row.verdict.replace(/\s+/g, '-').toLowerCase()">
              <strong>{{ row.topic }}</strong>
              <span>{{ row.verdict }}</span>
              <p>Proposed: {{ row.proposed }}{{ row.maximum ? ` · Control: ${row.maximum}` : '' }}</p>
              <p>{{ row.why }}</p>
              <small>{{ row.source }}</small>
            </li>
          </ul>
          <StepLockGate :unlocked="ctx.step2Unlocked.value" reason="Register and persist an application in Intake first.">
            <Step2DueDiligence />
          </StepLockGate>
        </div>

        <div v-else-if="activeTab === 'documents'" class="sw-formbody a360-pane">
          <PermitDocumentsPanel :permit-id="c.permitId" />
        </div>

        <div v-else-if="activeTab === 'clock'" class="sw-formbody a360-pane">
          <CaseClockPanel />
        </div>

        <div v-else-if="activeTab === 'referrals'" class="sw-formbody a360-pane">
          <CaseReferralsPanel :permit-id="c.permitId" mode="referrals" />
        </div>

        <div v-else-if="activeTab === 'objections'" class="sw-formbody">
          <Step5Notices />
        </div>

        <div v-else-if="activeTab === 'inspections'" class="sw-formbody a360-pane">
          <CaseReferralsPanel :permit-id="c.permitId" mode="inspection" />
          <h3 class="a360-subhead">Stage inspections on the permit</h3>
          <p v-if="inspectionError" class="a360-error">{{ inspectionError }}</p>
          <ul v-else-if="inspections.length" class="mw-like">
            <li v-for="ins in inspections" :key="ins.id">
              <strong>Stage {{ ins.stage_number }} · {{ ins.stage_name }}</strong>
              {{ ins.result || ins.overall_result || 'Not inspected' }}
              <span>{{ fmtDate(ins.scheduled_at || ins.inspected_at) }}</span>
            </li>
          </ul>
          <p v-else>No stage inspections recorded on this permit yet.</p>
        </div>

        <div v-else-if="activeTab === 'history' || activeTab === 'audit'" class="sw-formbody a360-pane">
          <CaseAuditTrail :permit-id="c.permitId" />
        </div>

        <div v-else-if="activeTab === 'committee'" class="sw-formbody">
          <StepLockGate :unlocked="ctx.step3Unlocked.value" reason="Complete due diligence first.">
            <Step3CommitteeReport />
          </StepLockGate>
        </div>

        <div v-else-if="activeTab === 'decision' && refusing" class="sw-formbody">
          <RefusalDrafting />
        </div>

        <div v-else-if="activeTab === 'decision' || activeTab === 'conditions'" class="sw-formbody">
          <StepLockGate :unlocked="ctx.step4Unlocked.value"
                        reason="Record the committee resolution (or delegated decision) in Committee first. A refusal is drafted here once a refuse resolution is recorded.">
            <Step4PermitDrafting />
          </StepLockGate>
        </div>

        <div v-else-if="activeTab === 'appeals'" class="sw-formbody a360-pane">
          <AppealsSection :permit-id="c.permitId" />
        </div>

        <div v-else-if="activeTab === 'enforcement'" class="sw-formbody a360-pane">
          <ul v-if="standEnforcement.length" class="mw-like">
            <li v-for="e in standEnforcement" :key="e.id">
              <strong>{{ e.order_reference }}</strong> — {{ e.status }}
              <span>{{ e.breach_description }}</span>
            </li>
          </ul>
          <p v-else>No enforcement orders on this stand.</p>
          <button type="button" class="cf-btn" @click="shell?.showConsole('enforcement')">Open enforcement register</button>
        </div>
      </section>
    </div>

    <StandPickerModal :open="pickerOpen" @close="pickerOpen = false" @select="onStandPicked" />

    <button class="sw-drawer-toggle" @click="drawerOpen = !drawerOpen">
      <Settings :size="13" /> Council tools
    </button>
    <Transition name="drawer-slide">
      <CaseFileDrawer v-if="drawerOpen" @close="drawerOpen = false" />
    </Transition>
  </div>
</template>

<style scoped>
.sw-root {
  --sw-primary:var(--ent-accent); --sw-primary-container:var(--ent-accent-hover); --sw-on-primary:var(--ent-text-on-accent);
  --sw-primary-tint:var(--ent-accent-soft); --sw-primary-tint-border:var(--ent-accent-line);
  --sw-page:var(--ent-canvas); --sw-surface:var(--ent-surface); --sw-surface-2:var(--ent-surface-2); --sw-surface-3:var(--ent-surface-sunken);
  --sw-border:var(--ent-line-strong); --sw-border-soft:var(--ent-line);
  --sw-text:var(--ent-text); --sw-text-2:var(--ent-text-2); --sw-muted:var(--ent-text-3);
  --sw-radius:var(--ent-r-md); --sw-radius-sm:var(--ent-r);
  --sw-shadow:var(--ent-e1); --sw-mono:var(--ent-font-mono);
  display:flex; flex-direction:column; height:100%; overflow:hidden; position:relative;
  background:var(--sw-page); color:var(--sw-text); font-family:var(--ent-font);
}
.a360-head { padding: var(--ent-s3) var(--ent-s4); background: var(--ent-surface); border-bottom: 1px solid var(--ent-line); }
.a360-id { display:flex; align-items:baseline; gap: var(--ent-s3); }
.a360-id h1 { margin:0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); }
.cf-caseno { font-family:var(--sw-mono); font-size:0.72rem; background:var(--sw-surface-2); color:var(--sw-text-2);
  border:1px solid var(--sw-border); padding:0.1rem 0.45rem; border-radius:0.25rem; }
.a360-facts { display:grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: var(--ent-s3); margin: var(--ent-s3) 0 0; }
.a360-facts dt { font-size: var(--ent-fs-micro); letter-spacing: 0.06em; text-transform: uppercase; color: var(--ent-text-3); }
.a360-facts dd { margin: 2px 0 0; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); }
.days-critical, .days-urgent { color: var(--ent-danger); }
.days-caution { color: var(--ent-warning); }

.a360-subhead { margin: var(--ent-s4) 0 var(--ent-s2); font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); }
.a360-tabs {
  display:flex; gap: 2px; overflow-x: auto; padding: 0 var(--ent-s3);
  background: var(--ent-surface); border-bottom: 1px solid var(--ent-line); flex-shrink: 0;
  scrollbar-width: thin; /* 15 tabs overflow; the full-height bar read as a divider */
}
.a360-tabs button {
  flex: none; padding: 0.65rem 0.85rem; border: 0; border-bottom: 2px solid transparent;
  background: transparent; color: var(--ent-text-2); font: inherit; font-size: var(--ent-fs-xs);
  font-weight: var(--ent-fw-semibold); cursor: pointer; white-space: nowrap;
}
.a360-tabs button.active { color: var(--ent-accent); border-bottom-color: var(--ent-accent); }
.a360-tabs button:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }

.sw-split { flex:1; min-height:0; display:flex; }
.sw-casefile { width: 22rem; max-width: 40%; min-width: 16rem; flex-shrink:0;
  display:flex; flex-direction:column; background:var(--sw-surface);
  border-right:1px solid var(--sw-border); overflow-y:auto; }
.cf-body { padding:1rem; display:flex; flex-direction:column; gap:1rem; }
.cf-address { margin:0; display:flex; align-items:center; gap:0.35rem; font-size:0.8rem; color:var(--sw-text-2); }

.sw-workpane { flex:1; min-width:0; display:flex; flex-direction:column; background:var(--ent-canvas); }
.sw-formbody { flex:1; min-height:0; overflow-y:auto; padding:1rem 1rem 3.5rem; display:flex; flex-direction:column; gap:1rem; }
.sw-formbody > * { flex-shrink: 0; min-height: min-content; }
.a360-pane { gap: var(--ent-s4); }
.a360-card { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r); padding: var(--ent-s4); }
.a360-card h3, .a360-card h4 {
  margin: 0 0 var(--ent-s2); font-size: var(--ent-fs-micro); letter-spacing: 0.07em;
  text-transform: uppercase; color: var(--ent-text-3);
}
.a360-kv { display:grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--ent-s3); margin: 0; }
.a360-kv dt { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.a360-kv dd { margin: 2px 0 0; font-size: var(--ent-fs-sm); }
.a360-time { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.a360-time li { display: grid; grid-template-columns: 7rem 1fr; gap: var(--ent-s2); font-size: var(--ent-fs-sm); }
.a360-time span { font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
.a360-actions { display: flex; gap: var(--ent-s2); flex-wrap: wrap; }
.a360-error { margin: 0; padding: var(--ent-s3); background: var(--ent-danger-soft); color: var(--ent-danger); border-radius: var(--ent-r); }
.a360-hint { margin: 0 0 0.75rem; font-size: 0.8rem; color: var(--ent-text-2); }
.cf-btn { display:inline-flex; align-items:center; gap:0.35rem; padding:0.4rem 0.75rem;
  border:1px solid var(--sw-border); background:var(--sw-surface); color:var(--sw-text);
  border-radius:0.3rem; font-size:0.75rem; font-weight:600; cursor:pointer; }
.cf-btn--primary { background:var(--sw-primary); border-color:var(--sw-primary); color:var(--sw-on-primary); }
.mw-like { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.mw-like li { display: flex; flex-direction: column; gap: 2px; padding: var(--ent-s2) 0; border-top: 1px solid var(--ent-line); font-size: var(--ent-fs-sm); }
.mw-like span { color: var(--ent-text-3); font-size: var(--ent-fs-xs); }

.cb-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.cb-item { display: flex; align-items: flex-start; gap: var(--ent-s2); font-size: var(--ent-fs-sm); }
.cb-mark { width: 8px; height: 8px; margin-top: 6px; border-radius: 999px; background: var(--ent-text-3); flex-shrink: 0; }
.cb-item.warning .cb-mark { background: var(--ent-warning); }
.cb-item.clear .cb-mark { background: var(--ent-success); }

.a360-rules { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ent-s3); }
.a360-rules li { padding: var(--ent-s3); border: 1px solid var(--ent-line); border-radius: var(--ent-r); background: var(--ent-surface); }
.a360-rules strong { margin-right: var(--ent-s2); }
.a360-rules p { margin: 4px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.a360-rules small { color: var(--ent-text-3); }
.v-non-compliant span { color: var(--ent-danger); font-weight: 700; }
.v-compliant span { color: var(--ent-success); font-weight: 700; }
.v-warning span, .v-planner-review-required span { color: var(--ent-warning); font-weight: 700; }

.sw-drawer-toggle { display:inline-flex; align-items:center; gap:0.3rem; position:absolute;
  right:1rem; bottom:1rem; z-index:5; padding:0.4rem 0.85rem; background:var(--sw-surface);
  border:1px solid var(--sw-border); color:var(--sw-text-2); border-radius:9999px;
  font-size:0.72rem; font-weight:600; cursor:pointer; box-shadow:var(--sw-shadow); }
.drawer-slide-enter-active, .drawer-slide-leave-active { transition:transform 0.2s ease, opacity 0.2s; }
.drawer-slide-enter-from, .drawer-slide-leave-to { transform:translateX(100%); opacity:0; }
@media (prefers-reduced-motion: reduce) {
  .drawer-slide-enter-active, .drawer-slide-leave-active { transition: none; }
}
@media (max-width: 1023px) {
  .sw-split { flex-direction:column; }
  .sw-casefile { width:100%; max-width:none; min-width:0; max-height:40%; border-right:none; border-bottom:1px solid var(--sw-border); }
  .a360-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 767px) {
  .a360-id { flex-wrap: wrap; }
  .a360-id h1 { font-size: var(--ent-fs-md); }
  .a360-tabs button { min-height: var(--ent-touch-min); }
  .a360-actions .cf-btn { min-height: var(--ent-touch-min); }
  .sw-casefile { max-height: none; }
  .a360-stage-fold {
    border: 1px solid var(--ent-line); border-radius: var(--ent-r); background: var(--ent-surface-2);
  }
  .a360-stage-fold > summary {
    display: flex; align-items: center; justify-content: space-between; gap: var(--ent-s2);
    min-height: var(--ent-touch-min); padding: var(--ent-s2) var(--ent-s3);
    font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); cursor: pointer; list-style: none;
  }
  .a360-stage-fold > summary::-webkit-details-marker { display: none; }
  .a360-stage-fold > summary span { font-weight: var(--ent-fw-normal); color: var(--ent-text-3); }
  .a360-time li { grid-template-columns: 1fr; }
}
</style>
