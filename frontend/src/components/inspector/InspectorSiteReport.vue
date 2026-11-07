<script setup lang="ts">
// The inspector's site checks for one permit (GET /inspector/permits/:id/site-report):
// position and its precision, jurisdiction, zoning and land-use controls,
// constraints with distances, road access, mapped structures and coverage,
// adjoining stands, and nearby cases.
//
// Nothing here is a legal finding. Statutory figures are labelled as such;
// every other distance is a council review distance. Missing layers read
// "No data", never "Clear".
import { computed, ref, watch } from 'vue'
import {
  AlertTriangle, Building2, Landmark, LocateFixed, Map as MapIcon, RefreshCw,
  Route, ShieldAlert, SquareStack, Users,
} from 'lucide-vue-next'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { inspectorGis, type SiteReport } from '@/services/inspectorGis'
import {
  constraintCopy, formatMetres, formatSqm, humanize, isPositioned,
  positionSourceLabel, precisionCopy, sortConstraints, sourceLabel,
} from '@/inspector/siteGeo'

const props = defineProps<{
  permitId: string | null
  /** Bump to rerun after the site position changes. */
  reloadKey?: number
  /** Whether this user may record the site position. */
  canRecordPosition?: boolean
}>()

const emit = defineEmits<{
  loaded: [report: SiteReport | null]
  'record-position': []
  'open-permit': [permitId: string]
}>()

const report = ref<SiteReport | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

let seq = 0
async function load() {
  const id = props.permitId
  if (!id) { report.value = null; emit('loaded', null); return }
  const mine = ++seq
  loading.value = true
  error.value = null
  try {
    const r = await inspectorGis.siteReport(id)
    if (mine !== seq) return
    report.value = r
    emit('loaded', r)
  } catch (e: unknown) {
    if (mine !== seq) return
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    error.value = msg || 'The site checks could not be run.'
    report.value = null
    emit('loaded', null)
  } finally {
    if (mine === seq) loading.value = false
  }
}

watch(() => [props.permitId, props.reloadKey], load, { immediate: true })

const precision = computed(() => report.value
  ? precisionCopy(report.value.site.precision, report.value.site.coarseArea)
  : null)

const constraints = computed(() => sortConstraints(report.value?.constraints ?? []))
const flagged = computed(() => constraints.value.filter(c => c.status === 'conflict' || c.status === 'review').length)

const controlsByType = computed(() => {
  const groups: Record<string, string[]> = {}
  for (const c of report.value?.zoning?.controls ?? []) {
    const key = humanize(c.controlType)
    ;(groups[key] ||= []).push([c.landUse, c.conditions].filter(Boolean).join(' — ') || '—')
  }
  return groups
})

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <div class="isr" aria-live="polite">
    <p v-if="!permitId" class="isr-muted">Select a site to run its checks.</p>

    <div v-else-if="loading && !report" class="isr-loading" role="status">
      <RefreshCw :size="14" class="spin" aria-hidden="true" /> Running site checks…
    </div>

    <div v-else-if="error" class="isr-error" role="alert">
      <p>{{ error }}</p>
      <UiButton size="sm" @click="load">Try again</UiButton>
    </div>

    <template v-else-if="report">
      <!-- Position -->
      <section class="isr-sec" aria-labelledby="isr-pos">
        <h4 id="isr-pos"><LocateFixed :size="13" aria-hidden="true" /> Site position</h4>
        <div class="isr-row-badge">
          <UiStatusBadge :tone="precision!.tone" :label="precision!.label" />
          <button type="button" class="isr-link" :disabled="loading" @click="load">
            <RefreshCw :size="11" aria-hidden="true" :class="{ spin: loading }" /> Rerun
          </button>
        </div>
        <p class="isr-detail">{{ precision!.detail }}</p>
        <dl class="isr-dl">
          <div><dt>Resolved from</dt><dd>{{ sourceLabel(report.site.source) }}<template v-if="report.site.label"> · {{ report.site.label }}</template></dd></div>
          <div v-if="report.site.areaSqm != null"><dt>Site area</dt><dd>{{ formatSqm(report.site.areaSqm) }}</dd></div>
          <div v-if="report.site.position.source">
            <dt>Position recorded</dt>
            <dd>
              {{ positionSourceLabel(report.site.position.source) }}
              <template v-if="report.site.position.accuracyM != null"> · ±{{ Math.round(report.site.position.accuracyM) }} m</template>
              <template v-if="report.site.position.setAt"> · {{ fmtDate(report.site.position.setAt) }}</template>
            </dd>
          </div>
          <div v-if="report.site.center && isPositioned(report.site.precision)"><dt>Coordinates</dt><dd class="mono">{{ report.site.center[1].toFixed(6) }}, {{ report.site.center[0].toFixed(6) }}</dd></div>
        </dl>
        <UiButton
          v-if="canRecordPosition"
          size="sm"
          :variant="isPositioned(report.site.precision) ? 'ghost' : 'primary'"
          @click="emit('record-position')"
        >
          <template #icon><LocateFixed :size="13" /></template>
          {{ isPositioned(report.site.precision) ? 'Correct site position' : 'Record site position' }}
        </UiButton>
      </section>

      <template v-if="isPositioned(report.site.precision)">
        <!-- Jurisdiction -->
        <section v-if="report.jurisdiction" class="isr-sec" aria-labelledby="isr-jur">
          <h4 id="isr-jur"><Landmark :size="13" aria-hidden="true" /> Jurisdiction</h4>
          <dl class="isr-dl">
            <div>
              <dt>Council area</dt>
              <dd>
                <UiStatusBadge v-if="report.jurisdiction.inJurisdiction" tone="positive" label="Inside" :dot="false" />
                <UiStatusBadge v-else tone="negative" label="Outside" :dot="false" />
              </dd>
            </div>
            <div><dt>District</dt><dd>{{ report.jurisdiction.district || '—' }}</dd></div>
            <div>
              <dt>Ward (mapped)</dt>
              <dd>
                {{ report.jurisdiction.ward || '—' }}
                <span v-if="report.jurisdiction.wardMatchesRecord === false" class="isr-warn">
                  · permit records ward {{ report.jurisdiction.recordedWard }}
                </span>
              </dd>
            </div>
          </dl>
        </section>

        <!-- Zoning -->
        <section v-if="report.zoning" class="isr-sec" aria-labelledby="isr-zone">
          <h4 id="isr-zone"><MapIcon :size="13" aria-hidden="true" /> Zoning</h4>
          <p v-if="!report.zoning.available" class="isr-muted">The zoning layer is not available.</p>
          <p v-else-if="!report.zoning.zones.length" class="isr-muted">No master-plan zone covers this site.</p>
          <ul v-else class="isr-list">
            <li v-for="z in report.zoning.zones" :key="z.id">
              <strong>{{ z.zone }}</strong>
              <span v-if="z.zoneCode" class="isr-num">zone {{ z.zoneCode }}</span>
              <span v-if="z.coveragePct != null && z.coveragePct < 99.5" class="isr-num">{{ z.coveragePct }}% of site</span>
            </li>
          </ul>
          <details v-if="Object.keys(controlsByType).length" class="isr-details">
            <summary>Land-use controls for {{ report.zoning.zones[0]?.zone }}</summary>
            <div v-for="(uses, type) in controlsByType" :key="type" class="isr-controls">
              <span class="isr-ctl-type">{{ type }}</span>
              <ul><li v-for="(u, i) in uses" :key="i">{{ u }}</li></ul>
            </div>
          </details>
          <p class="isr-detail">Compare with the permitted use: {{ humanize(report.permit.developmentType) }}.</p>
        </section>

        <!-- Constraints -->
        <section class="isr-sec" aria-labelledby="isr-con">
          <h4 id="isr-con">
            <ShieldAlert :size="13" aria-hidden="true" /> Constraints
            <span v-if="flagged" class="isr-count">{{ flagged }} to check</span>
          </h4>
          <ul class="isr-cons">
            <li v-for="c in constraints" :key="c.key" :class="`st-${c.status}`">
              <div class="isr-con-main">
                <span class="isr-con-label">{{ c.label }}</span>
                <UiStatusBadge :tone="constraintCopy(c.status).tone" :label="constraintCopy(c.status).label" :dot="false" />
              </div>
              <div class="isr-con-meta">
                <template v-if="c.distanceM != null">
                  {{ c.distanceM < 1 ? 'On site' : `${formatMetres(c.distanceM)} away` }}
                  <template v-if="c.feature?.name || c.feature?.fclass"> · {{ c.feature?.name || humanize(c.feature?.fclass) }}</template>
                </template>
                <template v-else-if="c.status !== 'no_data'">None nearby</template>
                <span class="isr-basis">
                  {{ c.basis === 'statutory' ? 'Statutory' : 'Review' }}<template v-if="c.thresholdM"> · {{ c.thresholdM }} m</template>
                </span>
              </div>
            </li>
          </ul>
        </section>

        <!-- Access -->
        <section v-if="report.access" class="isr-sec" aria-labelledby="isr-acc">
          <h4 id="isr-acc"><Route :size="13" aria-hidden="true" /> Road access</h4>
          <p v-if="!report.access.available" class="isr-muted">The roads layer is not available.</p>
          <p v-else-if="!report.access.nearestRoad" class="isr-warn">No mapped road within {{ report.access.searchedM }} m.</p>
          <dl v-else class="isr-dl">
            <div>
              <dt>Nearest road</dt>
              <dd>{{ report.access.nearestRoad.name || humanize(report.access.nearestRoad.fclass) }}<template v-if="report.access.nearestRoad.ref"> ({{ report.access.nearestRoad.ref }})</template></dd>
            </div>
            <div><dt>Distance</dt><dd>{{ formatMetres(report.access.nearestRoad.distanceM) }}<template v-if="report.access.abutsRoad"> · abuts the site</template></dd></div>
          </dl>
        </section>

        <!-- Structures -->
        <section v-if="report.structures?.available" class="isr-sec" aria-labelledby="isr-str">
          <h4 id="isr-str"><Building2 :size="13" aria-hidden="true" /> Mapped structures</h4>
          <p v-if="!report.structures.count" class="isr-muted">No structures are mapped on this stand.</p>
          <template v-else>
            <dl class="isr-grid">
              <div><dt>Structures</dt><dd>{{ report.structures.count }}</dd></div>
              <div><dt>Footprint</dt><dd>{{ formatSqm(report.structures.footprintSqm) }}</dd></div>
              <div><dt>Coverage</dt><dd>{{ report.structures.coveragePct != null ? `${report.structures.coveragePct}%` : '—' }}</dd></div>
              <div><dt>Nearest to boundary</dt><dd>{{ formatMetres(report.structures.minBoundaryClearanceM) }}</dd></div>
            </dl>
            <p v-if="report.structures.crossingBoundary" class="isr-warn">
              <AlertTriangle :size="12" aria-hidden="true" />
              {{ report.structures.crossingBoundary }} mapped structure{{ report.structures.crossingBoundary === 1 ? '' : 's' }}
              cross{{ report.structures.crossingBoundary === 1 ? 'es' : '' }} the stand boundary. Check for encroachment.
            </p>
            <p v-if="report.structures.exceedsApprovedPlinth" class="isr-warn">
              <AlertTriangle :size="12" aria-hidden="true" />
              Mapped footprint is more than 10% above the approved plinth area of {{ formatSqm(report.structures.approvedPlinthSqm) }}.
            </p>
            <p v-else-if="report.structures.approvedPlinthSqm != null" class="isr-detail">
              Approved plinth area {{ formatSqm(report.structures.approvedPlinthSqm) }}.
            </p>
          </template>
          <p class="isr-detail">{{ report.structures.source }}. Recent construction may not be mapped.</p>
        </section>

        <!-- Neighbours -->
        <section v-if="report.site.precision === 'boundary'" class="isr-sec" aria-labelledby="isr-nb">
          <h4 id="isr-nb"><Users :size="13" aria-hidden="true" /> Adjoining {{ report.site.source === 'stands_register' ? 'stands' : 'parcels' }}</h4>
          <p v-if="!report.neighbours.length" class="isr-muted">None registered.</p>
          <ul v-else class="isr-list">
            <li v-for="n in report.neighbours" :key="n.label">
              <strong>{{ n.label }}</strong>
              <span class="isr-num">{{ n.sharedBoundaryM != null && n.sharedBoundaryM >= 1 ? `${formatMetres(n.sharedBoundaryM)} shared edge` : 'corner' }}</span>
              <span v-if="n.status" class="isr-num">{{ humanize(n.status) }}</span>
            </li>
          </ul>
        </section>

        <!-- Nearby cases -->
        <section v-if="report.nearbyCases" class="isr-sec" aria-labelledby="isr-cases">
          <h4 id="isr-cases"><SquareStack :size="13" aria-hidden="true" /> Within {{ report.nearbyCases.radiusM }} m</h4>
          <p v-if="!report.nearbyCases.permits.length && !report.nearbyCases.enforcement.length" class="isr-muted">
            No other positioned permits or enforcement orders.
          </p>
          <ul v-if="report.nearbyCases.enforcement.length" class="isr-list">
            <li v-for="o in report.nearbyCases.enforcement" :key="o.orderId">
              <strong>{{ o.reference || humanize(o.orderType) }}</strong>
              <UiStatusBadge :tone="o.open ? 'negative' : 'neutral'" :label="humanize(o.status)" :dot="false" />
              <span class="isr-num">{{ o.onThisPermit ? 'this permit' : formatMetres(o.distanceM) }}</span>
            </li>
          </ul>
          <ul v-if="report.nearbyCases.permits.length" class="isr-list">
            <li v-for="p in report.nearbyCases.permits" :key="p.permitId">
              <button type="button" class="isr-link" @click="emit('open-permit', p.permitId)">{{ p.ref }}</button>
              <UiStatusBadge :status="p.status" :dot="false" />
              <span class="isr-num">{{ formatMetres(p.distanceM) }}</span>
            </li>
          </ul>
        </section>
      </template>

      <ul v-if="report.limitations.length" class="isr-limits" aria-label="Limitations of these checks">
        <li v-for="(l, i) in report.limitations" :key="i">{{ l }}</li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.isr { display: flex; flex-direction: column; gap: var(--ent-s3); font-size: var(--ent-fs-sm); color: var(--ent-text); }
.isr-sec { display: flex; flex-direction: column; gap: var(--ent-s2); padding-bottom: var(--ent-s3); border-bottom: 1px solid var(--ent-line); }
.isr-sec h4 {
  margin: 0; display: flex; align-items: center; gap: var(--ent-s2);
  font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold);
  color: var(--ent-text-2); text-transform: uppercase; letter-spacing: 0.04em;
}
.isr-count { margin-left: auto; text-transform: none; letter-spacing: 0; color: var(--ent-warning); font-weight: var(--ent-fw-semibold); }
.isr-row-badge { display: flex; align-items: center; justify-content: space-between; gap: var(--ent-s2); }
.isr-detail, .isr-muted { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
.isr-warn { margin: 0; display: flex; align-items: flex-start; gap: var(--ent-s1); font-size: var(--ent-fs-xs); color: var(--ent-tone-warning-fg); }
.isr-dl { margin: 0; display: grid; gap: var(--ent-s1); }
.isr-dl > div { display: grid; grid-template-columns: 7.5rem minmax(0, 1fr); gap: var(--ent-s2); }
.isr-dl dt { color: var(--ent-text-3); }
.isr-dl dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.isr-grid { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ent-s2); }
.isr-grid div { padding: var(--ent-s2); background: var(--ent-surface-2); border-radius: var(--ent-r-sm); }
.isr-grid dt { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.isr-grid dd { margin: 0; font-weight: var(--ent-fw-semibold); font-variant-numeric: tabular-nums; }
.isr-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--ent-s1); }
.isr-list li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ent-s2); }
.isr-num { color: var(--ent-text-3); font-size: var(--ent-fs-xs); font-variant-numeric: tabular-nums; }
.isr-cons { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.isr-cons li { padding: var(--ent-s2) 0; border-top: 1px solid var(--ent-line); }
.isr-cons li:first-child { border-top: none; }
.isr-con-main { display: flex; align-items: center; justify-content: space-between; gap: var(--ent-s2); }
.isr-con-label { font-weight: var(--ent-fw-medium); }
.isr-cons li.st-clear .isr-con-label, .isr-cons li.st-no_data .isr-con-label { font-weight: var(--ent-fw-normal); color: var(--ent-text-2); }
.isr-con-meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--ent-s2); font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.isr-basis { color: var(--ent-text-3); }
.isr-details summary { cursor: pointer; font-size: var(--ent-fs-xs); color: var(--ent-accent); }
.isr-details summary:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); border-radius: var(--ent-r-sm); }
.isr-controls { margin-top: var(--ent-s2); font-size: var(--ent-fs-xs); }
.isr-controls ul { margin: var(--ent-s1) 0 0; padding-left: var(--ent-s4); color: var(--ent-text-2); }
.isr-ctl-type { font-weight: var(--ent-fw-semibold); }
.isr-link {
  display: inline-flex; align-items: center; gap: var(--ent-s1);
  padding: 0; border: none; background: none; cursor: pointer;
  font: inherit; font-size: var(--ent-fs-xs); color: var(--ent-accent);
}
.isr-link:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); border-radius: var(--ent-r-sm); }
.isr-link:disabled { color: var(--ent-text-3); cursor: progress; }
.isr-limits {
  margin: 0; padding: var(--ent-s2) var(--ent-s3) var(--ent-s2) var(--ent-s5);
  background: var(--ent-surface-2); border-radius: var(--ent-r-sm);
  font-size: var(--ent-fs-xs); color: var(--ent-text-2);
}
.isr-loading { display: flex; align-items: center; gap: var(--ent-s2); color: var(--ent-text-2); }
.isr-error { display: flex; flex-direction: column; align-items: flex-start; gap: var(--ent-s2); color: var(--ent-danger); }
.isr-error p { margin: 0; }
.mono { font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); }
.spin { animation: isr-spin 0.9s linear infinite; }
@keyframes isr-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
