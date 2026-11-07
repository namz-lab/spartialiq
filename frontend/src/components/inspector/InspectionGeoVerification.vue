<script setup lang="ts">
// Attendance and evidence positions for one stage inspection, checked by the
// server against the resolved site (GET /stage-inspections/:id/geo-verification).
//
// Arrival verdicts are frozen when the fix was recorded. Photo distances are
// measured against the current site record — the panel says so, because a
// later correction of the site position changes them.
import { ref, watch } from 'vue'
import { Crosshair, RefreshCw } from 'lucide-vue-next'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import { inspectorGis, type GeoVerification } from '@/services/inspectorGis'
import { formatMetres, geofenceCopy, geoVerdictCopy, precisionCopy } from '@/inspector/siteGeo'

const props = defineProps<{
  inspectionId: string | null
  /** Bump to reload after a field event or photo upload. */
  refreshKey?: number
}>()

const data = ref<GeoVerification | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

let seq = 0
async function load() {
  const id = props.inspectionId
  if (!id) { data.value = null; return }
  const mine = ++seq
  loading.value = true
  error.value = null
  try {
    const result = await inspectorGis.geoVerification(id)
    if (mine === seq) data.value = result
  } catch (e: unknown) {
    if (mine !== seq) return
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    error.value = msg || 'Evidence positions could not be checked.'
    data.value = null
  } finally {
    if (mine === seq) loading.value = false
  }
}

watch(() => [props.inspectionId, props.refreshKey], load, { immediate: true })

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <section v-if="inspectionId" class="igv" aria-labelledby="igv-title">
    <header class="igv-head">
      <Crosshair :size="14" aria-hidden="true" />
      <h4 id="igv-title">Position check</h4>
      <button type="button" class="igv-refresh" :disabled="loading" @click="load">
        <RefreshCw :size="12" aria-hidden="true" :class="{ spin: loading }" />
        <span class="ent-sr-only">Recheck positions</span>
      </button>
    </header>

    <p v-if="loading && !data" class="igv-muted" role="status">Checking recorded positions…</p>
    <p v-else-if="error" class="igv-error" role="alert">{{ error }}</p>

    <template v-else-if="data">
      <div class="igv-verdict">
        <UiStatusBadge :tone="geoVerdictCopy(data.summary.verdict).tone" :label="geoVerdictCopy(data.summary.verdict).label" />
        <p>{{ geoVerdictCopy(data.summary.verdict).detail }}</p>
      </div>

      <p v-if="data.site && data.summary.verdict === 'unverifiable'" class="igv-muted">
        {{ precisionCopy(data.site.precision).detail }}
      </p>

      <dl class="igv-facts">
        <div><dt>Arrival fixes</dt><dd>{{ data.summary.arrivalsWithFix }}</dd></div>
        <div><dt>Photos geotagged</dt><dd>{{ data.summary.geotaggedPhotos }} of {{ data.summary.photos }}</dd></div>
        <div><dt>Away from site</dt><dd :class="{ bad: data.summary.offSite > 0 }">{{ data.summary.offSite }}</dd></div>
      </dl>

      <ul v-if="data.arrivals.length" class="igv-list" aria-label="Arrival fixes">
        <li v-for="a in data.arrivals" :key="a.eventId">
          <span class="igv-when">Arrived {{ fmtTime(a.recordedAt) }}</span>
          <UiStatusBadge :tone="geofenceCopy(a.result).tone" :label="geofenceCopy(a.result).label" :dot="false" />
          <span v-if="a.distanceM != null" class="igv-num">{{ formatMetres(a.distanceM) }} from site</span>
          <span v-if="a.accuracyM != null" class="igv-num">±{{ Math.round(a.accuracyM) }} m</span>
        </li>
      </ul>

      <ul v-if="data.photos.some(p => p.result === 'off_site')" class="igv-list" aria-label="Photos away from site">
        <li v-for="p in data.photos.filter(x => x.result === 'off_site')" :key="p.photoId">
          <span class="igv-when">Photo {{ fmtTime(p.takenAt) }}</span>
          <UiStatusBadge tone="negative" label="Away from site" :dot="false" />
          <span class="igv-num">{{ formatMetres(p.distanceM) }} from site</span>
        </li>
      </ul>

      <p class="igv-note">
        Tolerance {{ data.tolerance.boundaryM }} m from a stand boundary, {{ data.tolerance.pointM }} m from a
        position-only site, plus up to {{ data.tolerance.maxAccuracyCreditM }} m of reported GPS accuracy.
        Photo distances use the current site record.
      </p>
    </template>
  </section>
</template>

<style scoped>
.igv {
  display: flex; flex-direction: column; gap: var(--ent-s2);
  padding: var(--ent-s3); border: 1px solid var(--ent-line); border-radius: var(--ent-r);
  background: var(--ent-surface);
}
.igv-head { display: flex; align-items: center; gap: var(--ent-s2); color: var(--ent-text-2); }
.igv-head h4 { margin: 0; flex: 1; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.igv-refresh {
  display: inline-flex; align-items: center; justify-content: center;
  width: var(--ent-control-h-sm); height: var(--ent-control-h-sm);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-sm);
  background: var(--ent-surface); color: var(--ent-text-2); cursor: pointer;
}
.igv-refresh:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.igv-refresh:disabled { cursor: progress; opacity: 0.6; }
.igv-verdict { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ent-s2); }
.igv-verdict p { margin: 0; flex: 1 1 14rem; font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.igv-facts { margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--ent-s2); }
.igv-facts div { padding: var(--ent-s2); background: var(--ent-surface-2); border-radius: var(--ent-r-sm); }
.igv-facts dt { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.igv-facts dd { margin: 0; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); font-variant-numeric: tabular-nums; }
.igv-facts dd.bad { color: var(--ent-danger); }
.igv-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--ent-s1); }
.igv-list li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ent-s2); font-size: var(--ent-fs-xs); }
.igv-when { color: var(--ent-text); min-width: 9rem; }
.igv-num { color: var(--ent-text-2); font-variant-numeric: tabular-nums; }
.igv-muted, .igv-note { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
.igv-error { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-danger); }
.spin { animation: igv-spin 0.9s linear infinite; }
@keyframes igv-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
@media (max-width: 767px) { .igv-facts { grid-template-columns: 1fr 1fr; } }
</style>
