<script setup lang="ts">
// Case file — the whole building file for the open permit on one page.
//
// What an inspector reads before driving to a site, and what they answer an
// owner's "where is my building up to?" from: the permit and its conditions,
// whether the 12-month commencement window is still open, every statutory
// stage judged on its latest attempt, the approved plan, enforcement against
// the stand, the occupation certificate, and the audit trail.
//
// Each block loads independently. A block whose request failed says so; it is
// never rendered as "none".
import { computed, ref, watch, type Ref } from 'vue'
import {
  FolderOpen, Printer, RefreshCw, CheckCircle2, XCircle, Clock, CircleDashed, AlertTriangle,
  ShieldAlert, BadgeCheck, FileText, History, Ruler, CalendarClock, Flag, ArrowRight,
} from 'lucide-vue-next'
import {
  dmApi, type StageInspection, type BuildingPlan, type EnforcementOrder, type ProhibitionOrder,
  type PermitDocument, type PermitEvent, type StageInspectionFlag,
} from '@/services/developmentManagementService'
import { useInspectionCase } from '@/composables/useInspectionCase'
import { stageTimeline, permitValidity, type StageState } from '@/inspector/caseFile'
import { governingPlan } from '@/inspector/caseBrief'
import { officialEnforcementOpen } from '@/inspector/architecture'
import InspectorCasePicker from '@/components/inspector/InspectorCasePicker.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'

const emit = defineEmits<{ 'open-section': [key: 'stages' | 'certificates' | 'enforcement' | 'plans'] }>()

const ic = useInspectionCase()
const permit = computed(() => ic.current.value?.permit ?? null)

type Block<T> = { data: T; error: boolean }
const blank = <T,>(data: T): Block<T> => ({ data, error: false })

const inspections = ref(blank<StageInspection[]>([]))
const plans = ref(blank<BuildingPlan[]>([]))
const orders = ref(blank<EnforcementOrder[]>([]))
const prohibitions = ref(blank<ProhibitionOrder[]>([]))
const documents = ref(blank<PermitDocument[]>([]))
const events = ref(blank<PermitEvent[]>([]))
const flags = ref(blank<StageInspectionFlag[]>([]))
const loading = ref(false)

async function load(permitId: string) {
  loading.value = true
  const p = permit.value
  const [i, pl, o, pr, d, e, f] = await Promise.allSettled([
    dmApi.listStageInspections(permitId),
    dmApi.listBuildingPlans(permitId),
    dmApi.listEnforcement(),
    dmApi.listProhibitionOrders(),
    dmApi.listPermitDocuments(permitId),
    dmApi.listEvents(permitId),
    dmApi.listFlagsForPermit(permitId),
  ])
  if (ic.current.value?.permitId !== permitId) return
  const onStand = <T extends { permit_application_id: string | null; stand_number: string }>(r: T) =>
    r.permit_application_id === permitId || (!!p?.stand_number && r.stand_number === p.stand_number)
  const set = <T,>(target: Ref<Block<T>>, res: PromiseSettledResult<T>, fallback: T) => {
    target.value = res.status === 'fulfilled' ? { data: res.value, error: false } : { data: fallback, error: true }
  }
  set(inspections, i, [])
  set(plans, pl, [])
  // The enforcement list endpoint does not filter by permit or stand, so the
  // match is made here against both.
  orders.value = o.status === 'fulfilled' ? { data: o.value.filter(onStand), error: false } : { data: [], error: true }
  prohibitions.value = pr.status === 'fulfilled' ? { data: pr.value.filter(onStand), error: false } : { data: [], error: true }
  set(documents, d, [])
  set(events, e, [])
  set(flags, f, [])
  loading.value = false
}

watch(() => ic.current.value?.permitId, (id) => { if (id) void load(id) }, { immediate: true })

const timeline = computed(() => stageTimeline(inspections.value.data))
const passedCount = computed(() => timeline.value.filter(s => s.state === 'passed' || s.state === 'conditional').length)
const validity = computed(() => permitValidity(permit.value?.decision_at, inspections.value.data))
const plan = computed(() => governingPlan(plans.value.data))
const openOrders = computed(() => orders.value.data.filter(o => officialEnforcementOpen(o.status)))
const liveProhibitions = computed(() => prohibitions.value.data.filter(p => !p.lifted_at))
const openFlags = computed(() => flags.value.data.filter(f => f.status === 'open' || f.status === 'under_review'))

const STATE_META: Record<StageState, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  passed:      { label: 'Passed',           icon: CheckCircle2, tone: 'positive' },
  conditional: { label: 'Conditional pass', icon: CheckCircle2, tone: 'warning' },
  failed:      { label: 'Failed',           icon: XCircle,      tone: 'negative' },
  booked:      { label: 'Opened, no result', icon: Clock,       tone: 'info' },
  not_started: { label: 'Not inspected',    icon: CircleDashed, tone: 'neutral' },
}

function fmt(iso: string | null | undefined, withTime = false) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return withTime
    ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
const human = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—')
function print() { window.print() }
</script>

<template>
  <div class="ins-page cf2">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Field work</span>
        <h2 class="ins-title">Case file</h2>
        <p class="ins-lede">Everything the council holds on this building, in the order you need it on site.</p>
      </div>
      <div v-if="permit" class="ins-actions">
        <UiButton size="sm" :loading="loading" @click="ic.current.value?.permitId && load(ic.current.value.permitId)">
          <template #icon><RefreshCw :size="14" /></template>
          Refresh
        </UiButton>
        <UiButton size="sm" @click="print">
          <template #icon><Printer :size="14" /></template>
          Print file
        </UiButton>
      </div>
    </header>

    <div class="ins-split">
      <div class="ins-sticky cf2-picker">
        <InspectorCasePicker heading="Open a building file" />
      </div>

      <div v-if="!permit" class="ins-card cf2-none">
        <FolderOpen :size="28" aria-hidden="true" />
        <h3>Open a permit to read its building file</h3>
        <p>Choose a permit from the list, or open one from Today, Bookings or the site map.</p>
      </div>

      <div v-else class="cf2-body">
        <!-- STANDING -->
        <section class="ins-card" aria-labelledby="cf2-permit-h">
          <header class="ins-card-head">
            <h3 id="cf2-permit-h"><FileText :size="16" aria-hidden="true" /> Permit</h3>
            <UiStatusBadge :status="permit.status" />
          </header>
          <div class="ins-card-body">
            <dl class="ins-dl">
              <div><dt>Register no</dt><dd class="ins-mono">{{ permit.dev_register_no || '—' }}</dd></div>
              <div><dt>TPD reference</dt><dd class="ins-mono">{{ permit.tpd_reference || '—' }}</dd></div>
              <div><dt>Owner</dt><dd>{{ permit.applicant_name }}</dd></div>
              <div><dt>Contact</dt><dd>{{ permit.applicant_phone || permit.applicant_email || '—' }}</dd></div>
              <div><dt>Stand</dt><dd class="ins-mono">{{ permit.stand_number }}</dd></div>
              <div><dt>Ward</dt><dd>{{ permit.suburb_ward || '—' }}</dd></div>
              <div v-if="permit.street_address"><dt>Address</dt><dd>{{ permit.street_address }}</dd></div>
              <div><dt>Development</dt><dd class="cf2-cap">{{ human(permit.development_type) }}</dd></div>
              <div v-if="permit.plinth_area"><dt>Plinth area</dt><dd>{{ permit.plinth_area }} m²</dd></div>
              <div v-if="permit.floors"><dt>Floors</dt><dd>{{ permit.floors }}</dd></div>
              <div><dt>Decision</dt><dd>{{ fmt(permit.decision_at) }}</dd></div>
            </dl>
            <p v-if="permit.decision_conditions" class="cf2-conditions">
              <strong>Conditions of approval</strong>{{ permit.decision_conditions }}
            </p>
          </div>
        </section>

        <!-- ALERTS -->
        <div v-if="validity.state === 'lapsed'" class="ins-banner t-negative" role="status">
          <AlertTriangle :size="16" aria-hidden="true" />
          <div><strong>Permit has lapsed.</strong>
            <p>No stage was inspected within 12 months of the decision (lapsed {{ fmt(validity.lapsesOn?.toISOString()) }}). Any building work on this stand is unauthorised until a new permit is granted.</p></div>
        </div>
        <div v-else-if="validity.state === 'expiring'" class="ins-banner t-warning" role="status">
          <CalendarClock :size="16" aria-hidden="true" />
          <div><strong>{{ validity.daysLeft }} days left to commence work.</strong>
            <p>The permit lapses on {{ fmt(validity.lapsesOn?.toISOString()) }} unless a stage is inspected before then.</p></div>
        </div>
        <div v-if="openOrders.length || liveProhibitions.length" class="ins-banner t-negative" role="status">
          <ShieldAlert :size="16" aria-hidden="true" />
          <div><strong>{{ openOrders.length }} open enforcement order{{ openOrders.length === 1 ? '' : 's' }}<template v-if="liveProhibitions.length">, {{ liveProhibitions.length }} live prohibition{{ liveProhibitions.length === 1 ? '' : 's' }}</template> on this stand.</strong>
            <p>Check compliance before recording any stage.</p></div>
          <UiButton size="sm" @click="emit('open-section', 'enforcement')">Enforcement</UiButton>
        </div>
        <div v-if="openFlags.length" class="ins-banner t-warning" role="status">
          <Flag :size="16" aria-hidden="true" />
          <div><strong>{{ openFlags.length }} integrity flag{{ openFlags.length === 1 ? '' : 's' }} under review</strong>
            <p>{{ openFlags.map(f => `Stage ${f.stage_number ?? '?'}: ${human(f.reason_code)}`).join(' · ') }}</p></div>
        </div>

        <!-- CONSTRUCTION PROGRESS -->
        <section class="ins-card" aria-labelledby="cf2-stages-h">
          <header class="ins-card-head">
            <h3 id="cf2-stages-h"><CheckCircle2 :size="16" aria-hidden="true" /> Construction stages
              <span class="ins-count">{{ passedCount }} of 9</span></h3>
            <UiButton size="sm" variant="ghost" @click="emit('open-section', 'stages')">
              Inspect <template #icon><ArrowRight :size="14" /></template>
            </UiButton>
          </header>
          <div class="cf2-progress"><div class="ins-bar t-positive"><span :style="{ '--fill': passedCount / 9 }" /></div></div>
          <p v-if="inspections.error" class="ins-banner t-negative cf2-inset" role="alert">
            <AlertTriangle :size="16" aria-hidden="true" /> The stage record could not be loaded. Stage states below are unknown, not "not inspected".
          </p>
          <ol v-else class="cf2-stages">
            <li v-for="s in timeline" :key="s.n" class="cf2-stage" :class="`t-${STATE_META[s.state].tone}`">
              <span class="cf2-node" aria-hidden="true"><component :is="STATE_META[s.state].icon" :size="15" /></span>
              <div class="cf2-stage-main">
                <strong>{{ s.n }}. {{ s.name }}</strong>
                <span>
                  {{ STATE_META[s.state].label }}
                  <template v-if="s.latest?.inspected_at"> · {{ fmt(s.latest.inspected_at) }}</template>
                  <template v-if="s.latest?.inspector_name"> · {{ s.latest.inspector_name }}</template>
                  <template v-if="s.attempts > 1"> · attempt {{ s.latest?.attempt }} of {{ s.attempts }}</template>
                </span>
              </div>
              <span v-if="s.latest?.stamp_reference" class="cf2-stamp ins-mono">{{ s.latest.stamp_reference }}</span>
            </li>
          </ol>
        </section>

        <div class="cf2-grid">
          <!-- PLAN -->
          <section class="ins-card" aria-labelledby="cf2-plan-h">
            <header class="ins-card-head">
              <h3 id="cf2-plan-h"><Ruler :size="16" aria-hidden="true" /> Approved plan</h3>
              <span class="ins-count">{{ plans.data.length }} revision{{ plans.data.length === 1 ? '' : 's' }}</span>
            </header>
            <div class="ins-card-body">
              <p v-if="plans.error" class="cf2-err">Plans could not be loaded. What was approved is unknown.</p>
              <template v-else-if="plan">
                <p class="cf2-line"><strong>Rev {{ plan.revision }} — {{ plan.revision_label }}</strong> <UiStatusBadge :status="plan.status" /></p>
                <p class="cf2-sub">
                  <template v-if="plan.architect_name">Architect {{ plan.architect_name }}<template v-if="plan.architect_reg_no"> ({{ plan.architect_reg_no }})</template> · </template>
                  Appraised {{ fmt(plan.appraised_at) }}
                </p>
                <p v-if="plan.appraisal_notes" class="cf2-notes">{{ plan.appraisal_notes }}</p>
              </template>
              <p v-else class="cf2-sub">No approved building plan on file. Work cannot be assessed against a plan that does not exist.
                <button type="button" class="cf2-link" @click="emit('open-section', 'plans')">Go to plan examination</button></p>
            </div>
          </section>

          <!-- CERTIFICATE -->
          <section class="ins-card" aria-labelledby="cf2-cert-h">
            <header class="ins-card-head">
              <h3 id="cf2-cert-h"><BadgeCheck :size="16" aria-hidden="true" /> Occupation certificate</h3>
            </header>
            <div class="ins-card-body">
              <template v-if="ic.certificate.value">
                <p class="cf2-line"><strong class="ins-mono">{{ ic.certificate.value.certificate_no }}</strong>
                  <UiStatusBadge tone="positive" label="Issued" /></p>
                <p class="cf2-sub">Issued {{ fmt(ic.certificate.value.issued_at) }}<template v-if="ic.certificate.value.issued_by"> by {{ ic.certificate.value.issued_by }}</template></p>
                <p v-if="ic.certificate.value.conditions" class="cf2-notes">{{ ic.certificate.value.conditions }}</p>
              </template>
              <p v-else-if="!ic.certificateLoaded.value" class="cf2-sub cf2-err">
                Certificate status could not be read from the register. This does not mean none was issued.
              </p>
              <p v-else class="cf2-sub">Not issued. Stages 1–8 must each pass on their latest attempt.
                <button type="button" class="cf2-link" @click="emit('open-section', 'certificates')">Occupation certificates</button></p>
            </div>
          </section>
        </div>

        <!-- ENFORCEMENT -->
        <section class="ins-card" aria-labelledby="cf2-enf-h">
          <header class="ins-card-head">
            <h3 id="cf2-enf-h"><ShieldAlert :size="16" aria-hidden="true" /> Enforcement on this stand
              <span class="ins-count">{{ orders.data.length + prohibitions.data.length }}</span></h3>
          </header>
          <p v-if="orders.error || prohibitions.error" class="ins-banner t-negative cf2-inset" role="alert">
            <AlertTriangle :size="16" aria-hidden="true" /> Enforcement records could not be loaded. Do not treat this stand as clear.
          </p>
          <p v-else-if="!orders.data.length && !prohibitions.data.length" class="cf2-empty">No enforcement orders or prohibitions recorded against this permit or stand.</p>
          <ul v-else class="ins-rows">
            <li v-for="o in orders.data" :key="o.id" class="ins-row">
              <span class="ins-row-main">
                <span class="ins-row-title"><span class="ins-mono">{{ o.order_reference }}</span> · <span class="cf2-cap">{{ human(o.order_type) }}</span></span>
                <span class="ins-row-meta">Issued {{ fmt(o.issued_at) }} · {{ o.breach_description }}</span>
              </span>
              <UiStatusBadge :status="o.status" />
            </li>
            <li v-for="p in prohibitions.data" :key="p.id" class="ins-row">
              <span class="ins-row-main">
                <span class="ins-row-title"><span class="ins-mono">{{ p.order_reference }}</span> · Prohibition</span>
                <span class="ins-row-meta">{{ p.prohibited_activity }} · issued {{ fmt(p.issued_at) }}</span>
              </span>
              <UiStatusBadge :tone="p.lifted_at ? 'neutral' : 'negative'" :label="p.lifted_at ? 'Lifted' : 'In force'" />
            </li>
          </ul>
        </section>

        <div class="cf2-grid">
          <!-- DOCUMENTS -->
          <section class="ins-card" aria-labelledby="cf2-docs-h">
            <header class="ins-card-head">
              <h3 id="cf2-docs-h"><FileText :size="16" aria-hidden="true" /> Documents <span class="ins-count">{{ documents.data.length }}</span></h3>
            </header>
            <p v-if="documents.error" class="cf2-empty cf2-err">Documents could not be loaded.</p>
            <p v-else-if="!documents.data.length" class="cf2-empty">No documents on this permit file.</p>
            <ul v-else class="ins-rows">
              <li v-for="d in documents.data" :key="d.id" class="ins-row">
                <span class="ins-row-main">
                  <a v-if="d.storage_url" class="ins-row-title cf2-doc" :href="d.storage_url" target="_blank" rel="noopener">{{ d.file_name }}</a>
                  <span v-else class="ins-row-title">{{ d.file_name }}</span>
                  <span class="ins-row-meta cf2-cap">{{ human(d.doc_type) }} · {{ fmt(d.uploaded_at) }}</span>
                </span>
              </li>
            </ul>
          </section>

          <!-- AUDIT -->
          <section class="ins-card" aria-labelledby="cf2-audit-h">
            <header class="ins-card-head">
              <h3 id="cf2-audit-h"><History :size="16" aria-hidden="true" /> Audit trail <span class="ins-count">{{ events.data.length }}</span></h3>
            </header>
            <p v-if="events.error" class="cf2-empty cf2-err">The audit trail could not be loaded.</p>
            <p v-else-if="!events.data.length" class="cf2-empty">No recorded events.</p>
            <ol v-else class="cf2-audit">
              <li v-for="e in events.data.slice(0, 25)" :key="e.id">
                <time>{{ fmt(e.created_at, true) }}</time>
                <span class="cf2-cap"><strong>{{ human(e.event_type) }}</strong> · {{ e.actor_name || human(e.actor_role) }}</span>
              </li>
            </ol>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cf2-none { display: flex; flex-direction: column; align-items: center; gap: var(--ent-s2); padding: var(--ent-s8) var(--ent-s5); text-align: center; color: var(--ent-text-3); }
.cf2-none h3 { margin: 0; font-size: var(--ent-fs-md); color: var(--ent-text); }
.cf2-none p { margin: 0; font-size: var(--ent-fs-sm); max-width: 40ch; }
.cf2-body { display: flex; flex-direction: column; gap: var(--ent-s4); min-width: 0; }
.cf2-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: var(--ent-s4); }
.cf2-cap { text-transform: capitalize; }
.cf2-conditions { margin: var(--ent-s4) 0 0; padding: var(--ent-s3); background: var(--ent-surface-2); border-radius: var(--ent-r); font-size: var(--ent-fs-sm); color: var(--ent-text); white-space: pre-line; }
.cf2-conditions strong { display: block; margin-bottom: var(--ent-s1); font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.cf2-inset { margin: var(--ent-s3) var(--ent-s4); }

.cf2-progress { padding: var(--ent-s3) var(--ent-s4) 0; }
.cf2-stages { list-style: none; margin: 0; padding: var(--ent-s3) var(--ent-s4) var(--ent-s4); }
.cf2-stage { position: relative; display: flex; align-items: center; gap: var(--ent-s3); padding: var(--ent-s2) 0; }
.cf2-stage:not(:last-child)::after { content: ''; position: absolute; left: 13px; top: 36px; bottom: -8px; width: 2px; background: var(--ent-line); }
.cf2-stage.t-positive:not(:last-child)::after { background: var(--ent-tone-positive-line); }
.cf2-node {
  position: relative; z-index: 1; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  width: 28px; height: 28px; border-radius: var(--ent-r-pill);
  color: var(--ent-tone-neutral-fg); background: var(--ent-tone-neutral-bg); border: 1px solid var(--ent-tone-neutral-line);
}
.t-positive .cf2-node { color: var(--ent-tone-positive-fg); background: var(--ent-tone-positive-bg); border-color: var(--ent-tone-positive-line); }
.t-warning .cf2-node  { color: var(--ent-tone-warning-fg);  background: var(--ent-tone-warning-bg);  border-color: var(--ent-tone-warning-line); }
.t-negative .cf2-node { color: var(--ent-tone-negative-fg); background: var(--ent-tone-negative-bg); border-color: var(--ent-tone-negative-line); }
.t-info .cf2-node     { color: var(--ent-tone-info-fg);     background: var(--ent-tone-info-bg);     border-color: var(--ent-tone-info-line); }
.cf2-stage-main { flex: 1; min-width: 0; }
.cf2-stage-main strong { display: block; font-size: var(--ent-fs-base); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.cf2-stage.t-neutral .cf2-stage-main strong { color: var(--ent-text-2); font-weight: var(--ent-fw-medium); }
.cf2-stage-main span { display: block; font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.t-negative .cf2-stage-main span { color: var(--ent-danger); }
.cf2-stamp { font-size: var(--ent-fs-xs); color: var(--ent-text-3); }

.cf2-line { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; margin: 0; font-size: var(--ent-fs-base); }
.cf2-sub { margin: var(--ent-s1) 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); line-height: var(--ent-lh); }
.cf2-notes { margin: var(--ent-s3) 0 0; padding: var(--ent-s2) var(--ent-s3); font-size: var(--ent-fs-sm); background: var(--ent-surface-2); border-radius: var(--ent-r); white-space: pre-line; }
.cf2-err { color: var(--ent-danger); }
.cf2-empty { margin: 0; padding: var(--ent-s4); font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.cf2-link { display: inline; padding: 0; margin-left: var(--ent-s1); font: inherit; color: var(--ent-accent); background: none; border: 0; text-decoration: underline; cursor: pointer; }
.cf2-doc { color: var(--ent-accent); text-decoration: none; }
.cf2-doc:hover { text-decoration: underline; }

.cf2-audit { list-style: none; margin: 0; padding: var(--ent-s2) var(--ent-s4) var(--ent-s4); max-height: 20rem; overflow-y: auto; }
.cf2-audit li { display: grid; grid-template-columns: 9.5rem minmax(0, 1fr); gap: var(--ent-s3); padding: var(--ent-s2) 0; border-top: 1px solid var(--ent-line); font-size: var(--ent-fs-sm); }
.cf2-audit li:first-child { border-top: 0; }
.cf2-audit time { color: var(--ent-text-3); font-variant-numeric: tabular-nums; }
.cf2-audit strong { font-weight: var(--ent-fw-semibold); color: var(--ent-text); }

@media (max-width: 767px) { .cf2-audit li { grid-template-columns: minmax(0, 1fr); gap: 0; } }
@media print {
  .cf2-picker { display: none; }
  .ins-split { grid-template-columns: minmax(0, 1fr); }
  .cf2-audit { max-height: none; }
}
</style>
