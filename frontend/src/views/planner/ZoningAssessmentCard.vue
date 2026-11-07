<script setup lang="ts">
defineOptions({ name: 'ZoningAssessmentCard' })
// Step 2 zoning assessment. Resolves the selected stand's parcel fid (from the
// persisted centroid), fetches the authoritative permitted-uses table from the
// development-control matrix, and lets the officer apply the verdict to the
// due-diligence checklist. Degrades gracefully where no zoning data exists.
//
// Presentation only below the service line: the verdict mapping lives in
// `buildZoningEntry` (services/developmentControl) and is applied by Step 2.
// This card resolves, displays and emits — it never decides.
import { ref, computed, onMounted } from 'vue'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { dmApi, type RuleSnapshot } from '@/services/developmentManagementService'
import { locateStand } from '@/services/parcels'
import CaseSection from './case/CaseSection.vue'
import CaseFact from './case/CaseFact.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import {
  getPermittedUses, getZoningAt, provisionalNotice,
  type ZoneAssessment, type PermittedUseEntry, type Permission, type ZoningApplyPayload,
} from '@/services/developmentControl'
import {
  Layers, CheckCircle2, AlertTriangle, XCircle, RefreshCw, MapPinned, HelpCircle,
} from 'lucide-vue-next'

const emit = defineEmits<{ apply: [ZoningApplyPayload] }>()
const { current, save } = usePlannerCase()

type State = 'idle' | 'loading' | 'loaded' | 'nodata' | 'error'
const state = ref<State>('idle')
const assessment = ref<ZoneAssessment | null>(null)
const selectedGroupCode = ref<string>('')

// The rules the server recorded for the applied use (migration 146). Computed from the
// application's parcel and the plan recorded for it, not from what this page shows.
const ruleSnapshot = ref<RuleSnapshot | null>(null)
const ruleNote = ref<string>('')

async function recordRules(code: string) {
  ruleSnapshot.value = null
  ruleNote.value = ''
  const id = current.value?.permitId
  if (!id) return
  try {
    ruleSnapshot.value = await dmApi.takeRuleSnapshot(id, code)
  } catch (e: any) {
    ruleNote.value = e?.response?.status === 409
      ? 'The rules were not recorded: this application is not linked to a parcel yet. Set the parcel first.'
      : 'The rules could not be recorded on the application. Try again.'
  }
}

const ruleResult = computed(() => ruleSnapshot.value?.results.find(r => r.governing) ?? ruleSnapshot.value?.results[0] ?? null)

const saved = computed(() => current.value?.dueDiligence?.zoningAssessment ?? null)

onMounted(() => { if (saved.value) state.value = 'loaded' })

async function run() {
  if (!current.value) return
  state.value = 'loading'
  try {
    let fid = current.value.property.parcelFid ?? null
    if (fid == null) {
      const c = current.value.property.centroid
      if (!c) { state.value = 'nodata'; return }
      const loc = await locateStand(c[0], c[1])
      fid = loc.stand?.fid ?? null
      if (fid == null) { state.value = 'nodata'; return }
      current.value.property.parcelFid = fid
      save()
    }
    // permitted-uses/:id is keyed on gweru_rural_farms, not vungu_parcels, so
    // look the zone up by point whenever the case has one.
    const c = current.value.property.centroid
    const res = c ? await getZoningAt(c[0], c[1], fid) : await getPermittedUses(fid)
    if (!res || res.uses.length === 0) { state.value = 'nodata'; return }
    assessment.value = res
    selectedGroupCode.value =
      res.uses.find(u => u.permission !== 'prohibited')?.groupCode ?? res.uses[0].groupCode
    state.value = 'loaded'
  } catch {
    state.value = 'error'
  }
}

// Rules from a plan that is not in force are a draft. Say so wherever the verdict is shown or kept.
const notice = computed(() => provisionalNotice(assessment.value?.rulesStatus))
const isDraft = computed(() => notice.value !== null)

const selectedUse = computed<PermittedUseEntry | null>(() =>
  assessment.value?.uses.find(u => u.groupCode === selectedGroupCode.value) ?? null)

function apply() {
  const a = assessment.value, u = selectedUse.value
  if (!a || !u) return
  emit('apply', {
    parcelFid: a.parcelFid,
    zoneName: a.zoneName,
    zoneCode: a.zoneCode,
    selectedGroupCode: u.groupCode,
    selectedGroupName: u.groupName,
    permission: u.permission,
    conditions: u.conditions,
    maxHeightM: u.maxHeightM,
    minLotSqm: u.minLotSqm,
    maxUnits: u.maxUnits,
    provisional: isDraft.value,
  })
  void recordRules(u.groupCode)
}

// ── Presentation maps ──────────────────────────────────────────────────────
// Statutory vocabulary, not generic severity words: "special consent" is the
// term of art in the RTCP Act and in buildZoningEntry()'s persisted notes.
type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'negative'
const permMeta: Record<Permission, { label: string; tone: Tone }> = {
  permitted:       { label: 'Permitted',       tone: 'positive' },
  special_consent: { label: 'Special consent', tone: 'warning' },
  prohibited:      { label: 'Prohibited',      tone: 'negative' },
}

// Header status reflects what the case currently holds: the verdict the officer
// has applied, otherwise the verdict currently selected in the table.
const headerStatus = computed(() => {
  if (saved.value) return permMeta[saved.value.permission]
  if (state.value === 'loaded' && selectedUse.value) return permMeta[selectedUse.value.permission]
  return null
})

const zoneLine = computed(() => {
  const a = assessment.value
  if (!a) return null
  return a.zoneName ?? a.zoneCode ?? null
})

// Limits are optional per use — render only what the matrix actually returned.
function limitsOf(u: PermittedUseEntry): string[] {
  const out: string[] = []
  if (u.maxHeightM != null) out.push(`≤ ${u.maxHeightM} m`)
  if (u.minLotSqm != null) out.push(`≥ ${u.minLotSqm} m²`)
  if (u.maxUnits != null) out.push(`≤ ${u.maxUnits} units`)
  return out
}
</script>

<template>
  <CaseSection
    boxed
    title="Zoning assessment"
    subtitle="Land-use conformity from the development-control matrix"
    class="zac"
  >
    <template #icon><Layers :size="14" /></template>
    <template #status>
      <UiStatusBadge
        v-if="headerStatus"
        :tone="headerStatus.tone"
        :label="headerStatus.label"
      />
      <UiStatusBadge v-else-if="state === 'nodata'" tone="neutral" label="Unavailable" />
    </template>
    <template v-if="state === 'loaded' && assessment" #actions>
      <button class="zac-run zac-icon-btn" type="button" aria-label="Re-run the zoning check" @click="run">
        <RefreshCw :size="13" aria-hidden="true" />
      </button>
    </template>

    <!-- ── Prior applied verdict (persisted on the case) ─────────────────── -->
    <div v-if="saved && !assessment" class="zac-saved">
      <div class="zac-saved-facts">
        <CaseFact label="Applied use" :value="saved!.selectedGroupName" />
        <CaseFact label="Zone" :value="saved!.zoneName ?? saved!.zoneCode" mono />
        <CaseFact label="Assessed" :value="saved!.assessedAt.slice(0, 10)" mono />
        <CaseFact v-if="saved!.provisional" label="Rules" value="Draft, not council policy" />
      </div>
      <UiButton class="zac-run" size="sm" variant="secondary" @click="run">
        <template #icon><RefreshCw :size="13" /></template>
        Re-run check
      </UiButton>
    </div>

    <!-- ── Idle ─────────────────────────────────────────────────────────── -->
    <div v-else-if="state === 'idle'" class="zac-empty">
      <p class="zac-empty-t">No zoning assessment</p>
      <p class="zac-empty-b">
        Run a zoning check to resolve this stand's zone and the permitted uses
        recorded against it in the development-control matrix.
      </p>
      <UiButton class="zac-run" size="sm" variant="primary" @click="run">
        <template #icon><MapPinned :size="13" /></template>
        Run zoning check
      </UiButton>
    </div>

    <!-- ── Loading (layout-stable skeleton, same rhythm as the table) ────── -->
    <div v-else-if="state === 'loading'" class="zac-skel" aria-busy="true">
      <p class="zac-skel-msg">Resolving stand and permitted uses…</p>
      <div v-for="n in 3" :key="n" class="zac-skel-row">
        <span class="sk sk-a" /><span class="sk sk-b" /><span class="sk sk-c" />
      </div>
    </div>

    <!-- ── No zoning data for this stand ────────────────────────────────── -->
    <div v-else-if="state === 'nodata'" class="zac-note warn" role="status">
      <AlertTriangle :size="14" aria-hidden="true" />
      <div class="zac-note-text">
        <strong>Zoning data unavailable for this stand.</strong>
        No zone is recorded against the parcel, so conformity must be assessed
        manually and recorded in the compatibility checks below.
      </div>
      <UiButton class="zac-run" size="sm" variant="secondary" @click="run">
        <template #icon><RefreshCw :size="13" /></template>
        Retry
      </UiButton>
    </div>

    <!-- ── Service error ────────────────────────────────────────────────── -->
    <div v-else-if="state === 'error'" class="zac-note err" role="alert">
      <XCircle :size="14" aria-hidden="true" />
      <div class="zac-note-text">
        <strong>Zoning service unavailable.</strong>
        The development-control matrix could not be reached. Try again, or record
        the conformity assessment manually.
      </div>
      <UiButton class="zac-run" size="sm" variant="secondary" @click="run">
        <template #icon><RefreshCw :size="13" /></template>
        Retry
      </UiButton>
    </div>

    <!-- ── Loaded assessment ────────────────────────────────────────────── -->
    <div v-else-if="state === 'loaded' && assessment" class="zac-body">
      <!-- Zone identity — the authority behind everything in the table. -->
      <div class="zac-zone">
        <CaseFact label="Zone">
          <strong v-if="zoneLine">{{ zoneLine }}</strong>
          <span v-else class="zac-unknown"><HelpCircle :size="12" /> Zone name unavailable</span>
        </CaseFact>
        <CaseFact label="Zone code" :value="assessment.zoneCode" mono />
        <CaseFact label="Parcel" :value="assessment.standNumber ?? assessment.parcelFid" mono />
      </div>

      <div v-if="notice" class="zac-note warn zac-provisional" role="status" data-testid="provisional-notice">
        <AlertTriangle :size="14" aria-hidden="true" />
        <div class="zac-note-text"><strong>{{ notice.headline }}</strong> {{ notice.detail }}</div>
      </div>

      <fieldset class="zac-uses">
        <legend class="zac-legend">Permitted uses — select the use applied for</legend>
        <table class="zac-table">
          <thead>
            <tr>
              <th scope="col" class="zac-th-use">Use group</th>
              <th scope="col">Permission</th>
              <th scope="col" class="zac-th-lim">Limits</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="u in assessment.uses"
              :key="u.groupCode"
              class="zac-row"
              :class="{ selected: u.groupCode === selectedGroupCode }"
            >
              <td class="zac-td-use">
                <label class="zac-pick">
                  <input
                    type="radio" name="zac-group" :value="u.groupCode"
                    v-model="selectedGroupCode"
                  />
                  <span class="zac-pick-text">
                    <span class="zac-use-name">{{ u.groupName }}</span>
                    <span v-if="u.category" class="zac-use-cat">{{ u.category }}</span>
                    <span v-if="u.conditions" class="zac-use-cond">{{ u.conditions }}</span>
                  </span>
                </label>
              </td>
              <td>
                <UiStatusBadge :tone="permMeta[u.permission].tone" :label="permMeta[u.permission].label" />
              </td>
              <td class="zac-limits">
                <span v-for="l in limitsOf(u)" :key="l" class="zac-lim">{{ l }}</span>
                <span v-if="!limitsOf(u).length" class="zac-lim-none">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </fieldset>
    </div>

    <div v-if="state === 'loaded' && (ruleSnapshot || ruleNote)" class="zac-rules" role="status">
      <template v-if="ruleSnapshot">
        <strong>Recorded on the application<template v-if="ruleSnapshot.provisional"> (draft rules, not council policy)</template>:</strong>
        <template v-if="ruleSnapshot.unzoned">the parcel is in no zone, so no rules apply to record.</template>
        <template v-else-if="ruleResult">
          {{ ruleResult.plan.title }} (v{{ ruleResult.plan.version }}, {{ ruleResult.plan.status }}) ·
          {{ ruleResult.zone.name }} ·
          <template v-if="ruleResult.decision">{{ permMeta[ruleResult.decision].label }}</template>
          <template v-else>not decided in this plan</template>
          <template v-if="ruleResult.pathway"> · pathway: {{ ruleResult.pathway.name }}</template>
        </template>
        <template v-if="ruleSnapshot.results.filter(r => r.governing).length > 1">
          · more than one plan covers this parcel; all are recorded.
        </template>
      </template>
      <template v-else>{{ ruleNote }}</template>
    </div>

    <template v-if="state === 'loaded' && assessment" #footer>
      <div class="zac-foot">
        <p class="zac-foot-text">
          <template v-if="selectedUse">
            Applying <strong>{{ selectedUse.groupName }}</strong> records
            <strong>{{ permMeta[selectedUse.permission].label }}</strong>
            against the land-use zoning check.
          </template>
          <template v-else>Select the use applied for to continue.</template>
        </p>
        <UiButton class="zac-apply" size="sm" variant="primary" :disabled="!selectedUse" @click="apply">
          <template #icon><CheckCircle2 :size="13" /></template>
          Apply to checklist
        </UiButton>
      </div>
    </template>
  </CaseSection>
</template>

<style scoped>
/* Enterprise tokens only — see src/styles/enterprise.css. */
.zac { font-family: var(--ent-font); color: var(--ent-text); }

.zac-rules {
  margin-top: var(--ent-s3); padding: var(--ent-s2) var(--ent-s3);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-sm);
  background: var(--ent-surface); font-size: var(--ent-fs-sm); color: var(--ent-text-2);
}
.zac-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-sm); background: var(--ent-surface);
  color: var(--ent-text-2); cursor: pointer;
}
.zac-icon-btn:hover { color: var(--ent-text); border-color: var(--ent-line-strong); }
.zac-icon-btn:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }

/* Saved verdict */
.zac-saved { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--ent-s3); }
.zac-saved-facts {
  flex: 1 1 220px;
  display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--ent-s3);
}

/* Empty */
.zac-empty { display: flex; flex-direction: column; align-items: flex-start; gap: var(--ent-s2); }
.zac-empty-t { margin: 0; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); }
.zac-empty-b { margin: 0; max-width: 52ch; font-size: var(--ent-fs-xs); color: var(--ent-text-2); line-height: var(--ent-lh); }

/* Notes */
.zac-note {
  display: flex; gap: var(--ent-s2); align-items: flex-start; flex-wrap: wrap;
  border-radius: var(--ent-r-sm); padding: var(--ent-s2) var(--ent-s3);
  border-width: 1px 1px 1px 3px; border-style: solid;
}
.zac-note.warn { background: var(--ent-warning-soft); border-color: var(--ent-warning); color: var(--ent-warning); }
.zac-note.err  { background: var(--ent-danger-soft);  border-color: var(--ent-danger);  color: var(--ent-danger); }
.zac-note-text {
  flex: 1 1 220px; font-size: var(--ent-fs-xs);
  line-height: var(--ent-lh); color: var(--ent-text);
}
.zac-note-text strong { display: block; color: inherit; }
.zac-note > svg { flex: none; margin-top: 1px; }

/* Loading skeleton — same three-column rhythm as the table it replaces. */
.zac-skel { display: flex; flex-direction: column; gap: var(--ent-s2); }
.zac-skel-msg { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
.zac-skel-row { display: grid; grid-template-columns: 1fr 100px 120px; gap: var(--ent-s3); align-items: center; }
.sk { height: 10px; border-radius: var(--ent-r-sm); background: var(--ent-surface-2); animation: zac-pulse 1.4s ease-in-out infinite; }
.sk-a { width: 70%; } .sk-b { width: 100%; } .sk-c { width: 80%; }
@keyframes zac-pulse { 50% { opacity: 0.45; } }

/* Loaded */
.zac-body { display: flex; flex-direction: column; gap: var(--ent-s3); }
.zac-zone {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: var(--ent-s3);
  background: var(--ent-surface-2); border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-sm); padding: var(--ent-s2) var(--ent-s3);
}
.zac-zone strong { font-size: var(--ent-fs-base); font-weight: var(--ent-fw-semibold); }
.zac-unknown { display: inline-flex; align-items: center; gap: 4px; color: var(--ent-text-3); font-size: var(--ent-fs-xs); }

.zac-uses { border: 0; margin: 0; padding: 0; min-width: 0; }
.zac-legend {
  padding: 0 0 var(--ent-s2);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold);
  text-transform: uppercase; letter-spacing: 0.05em; color: var(--ent-text-3);
}

/* Enterprise table: hairline rows, no inner card, clear selected state. */
.zac-table { width: 100%; border-collapse: collapse; }
.zac-table th {
  padding: 0 var(--ent-s2) 5px; text-align: left;
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold);
  text-transform: uppercase; letter-spacing: 0.05em; color: var(--ent-text-3);
  border-bottom: 1px solid var(--ent-line-strong); white-space: nowrap;
}
.zac-table th:first-child, .zac-table td:first-child { padding-left: 0; }
.zac-th-lim { text-align: right; }
.zac-table td {
  padding: var(--ent-s2); border-bottom: 1px solid var(--ent-line);
  vertical-align: top; font-size: var(--ent-fs-sm);
}
.zac-row { transition: background var(--ent-dur) var(--ent-ease); }
.zac-row:hover { background: var(--ent-surface-2); }
.zac-row.selected { background: var(--ent-accent-soft); }
.zac-row.selected .zac-use-name { font-weight: var(--ent-fw-semibold); color: var(--ent-accent); }

.zac-pick { display: flex; align-items: flex-start; gap: var(--ent-s2); cursor: pointer; min-width: 0; }
.zac-pick input { margin: 2px 0 0; flex: none; accent-color: var(--ent-accent); }
.zac-pick input:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.zac-pick-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.zac-use-name { font-size: var(--ent-fs-sm); color: var(--ent-text); }
.zac-use-cat {
  font-size: var(--ent-fs-micro); text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--ent-text-3);
}
.zac-use-cond { font-size: var(--ent-fs-micro); color: var(--ent-text-2); line-height: var(--ent-lh); }

.zac-limits { text-align: right; white-space: nowrap; }
.zac-lim {
  display: inline-block; margin-left: 4px;
  font-family: var(--ent-font-mono); font-size: var(--ent-fs-micro);
  font-variant-numeric: tabular-nums; color: var(--ent-text-2);
}
.zac-lim-none { color: var(--ent-text-3); }

/* Footer action bar */
.zac-foot { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ent-s3); }
.zac-foot-text {
  flex: 1 1 220px; margin: 0;
  font-size: var(--ent-fs-xs); color: var(--ent-text-2); line-height: var(--ent-lh);
}
.zac-foot-text strong { color: var(--ent-text); font-weight: var(--ent-fw-semibold); }

@media (prefers-reduced-motion: reduce) {
  .sk { animation: none; }
  .zac-row { transition: none; }
}
</style>
