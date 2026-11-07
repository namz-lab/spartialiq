<script setup lang="ts">
// "What is here" for a clicked map point (GET /inspector/identify): the stand,
// parcel, zone and mapped structure under it, and any building-control case or
// enforcement order linked to the spot. The assessment is a prompt to look,
// never a finding that work is unauthorised.
import { X, MapPinned, ExternalLink } from 'lucide-vue-next'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import { computed } from 'vue'
import type { IdentifyResult } from '@/services/inspectorGis'
import { assessmentCopy, formatMetres, formatSqm, humanize } from '@/inspector/siteGeo'

interface MapFeature {
  /** Catalog layer id, e.g. 'roads'. */
  layer: string
  /** Human title from the tile catalog; falls back to the id. */
  layerTitle?: string | null
  fid?: number | string | null
  properties: Record<string, unknown>
}

// Attributes are whatever the layer's allowlist carries, so this formats rather
// than assumes: blanks are dropped, fractions are rounded to two places, and
// identifiers are left exactly as stored so an officer can quote them in a file.
const ID_KEYS = new Set(['fid', 'osm_id', 'gid', 'id', 'code', 'ref', 'pcode', 'stand_id', 'stand_number', 'zone_code'])

// Column names an officer should not have to translate. Everything else is
// readable once the underscores are gone, so it is left to humanize().
const LABELS: Record<string, string> = {
  adm2_en: 'District', adm3_en: 'Ward', area_ha: 'Area (ha)', area_sqm_int: 'Area (m²)',
  fclass: 'Class', name_cfu: 'Name (CFU)', name_en: 'Name', oneway: 'One way',
  pcode: 'P-code', price_usd_cents: 'Price', use_scale: 'Use scale',
  zone_type_cache: 'Zone type',
}

// The heading already carries the feature id.
const SKIP_KEYS = new Set(['fid'])

const featureRows = computed<Array<[string, string]>>(() => {
  const attrs = props.mapFeature?.properties
  if (!attrs) return []
  const rows: Array<[string, string]> = []
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === '') continue
    if (typeof value === 'object' || SKIP_KEYS.has(key)) continue
    let text: string
    if (key === 'price_usd_cents') {
      // Stored in cents; printed as money, because a stand priced 4500000 reads
      // as forty-five thousand dollars, not four and a half million.
      const cents = Number(value)
      if (!Number.isFinite(cents)) continue
      text = `USD ${(cents / 100).toLocaleString('en-ZW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    } else if (typeof value === 'number') {
      text = Number.isInteger(value) || ID_KEYS.has(key) ? String(value) : value.toFixed(2)
    } else if (typeof value === 'boolean') {
      text = value ? 'Yes' : 'No'
    } else {
      text = ID_KEYS.has(key) ? String(value) : humanize(String(value))
    }
    rows.push([LABELS[key] ?? humanize(key), text])
  }
  return rows
})

const props = defineProps<{
  result: IdentifyResult | null
  loading: boolean
  error: string | null
  point: [number, number] | null
  /** The basemap feature under the same click, when the host passes one: the
   *  road, parcel, landuse polygon or POI as the tile itself holds it. The
   *  registers answer "what case is here"; this answers "what is this thing".
   *  Optional — hosts that do not listen for it lose nothing. */
  mapFeature?: MapFeature | null
}>()

const emit = defineEmits<{
  close: []
  'open-case': [permitId: string]
}>()
</script>

<template>
  <section class="iic" aria-labelledby="iic-title" aria-live="polite">
    <header class="iic-head">
      <MapPinned :size="14" aria-hidden="true" />
      <h3 id="iic-title">What is here</h3>
      <button type="button" class="iic-close" @click="emit('close')">
        <X :size="14" aria-hidden="true" /><span class="ent-sr-only">Close</span>
      </button>
    </header>
    <p v-if="point" class="iic-coords">{{ point[1].toFixed(6) }}, {{ point[0].toFixed(6) }}</p>

    <p v-if="loading" class="iic-muted" role="status">Querying the registers…</p>
    <p v-else-if="error" class="iic-error" role="alert">{{ error }}</p>

    <template v-else-if="result">
      <div class="iic-assess" :class="`t-${assessmentCopy(result.assessment).tone}`">
        <UiStatusBadge :tone="assessmentCopy(result.assessment).tone" :label="assessmentCopy(result.assessment).label" />
        <p>{{ assessmentCopy(result.assessment).detail }}</p>
      </div>

      <dl class="iic-dl">
        <div><dt>Council area</dt><dd>{{ result.jurisdiction.inJurisdiction ? 'Inside' : 'Outside' }}<template v-if="result.jurisdiction.district"> · {{ result.jurisdiction.district }}</template></dd></div>
        <div><dt>Ward</dt><dd>{{ result.jurisdiction.ward || '—' }}</dd></div>
        <div>
          <dt>Stand</dt>
          <dd v-if="result.stand">
            {{ result.stand.standNumber }}<template v-if="result.stand.ward"> · {{ result.stand.ward }}</template>
            · {{ formatSqm(result.stand.areaSqm) }}<template v-if="result.stand.status"> · {{ humanize(result.stand.status) }}</template>
          </dd>
          <dd v-else>Not in the Stands Register</dd>
        </div>
        <div v-if="result.parcel"><dt>Cadastre</dt><dd>{{ result.parcel.name }} · {{ formatSqm(result.parcel.areaSqm) }}</dd></div>
        <div><dt>Zone</dt><dd>{{ result.zone ? result.zone.zone : 'No master-plan zone' }}</dd></div>
        <div>
          <dt>Structure</dt>
          <dd v-if="result.building">Mapped · {{ formatSqm(result.building.areaSqm) }}<template v-if="result.building.type"> · {{ humanize(result.building.type) }}</template></dd>
          <dd v-else>None mapped</dd>
        </div>
      </dl>

      <div v-if="result.cases.length" class="iic-block">
        <h4>Cases within {{ result.radiusM }} m</h4>
        <ul>
          <li v-for="c in result.cases" :key="c.permitId">
            <button type="button" class="iic-case" @click="emit('open-case', c.permitId)">
              <span class="iic-case-ref">{{ c.ref }}</span>
              <span class="iic-case-title">{{ c.title }}</span>
              <ExternalLink :size="12" aria-hidden="true" />
            </button>
            <span class="iic-case-meta">
              <UiStatusBadge :status="c.status" :dot="false" />
              {{ c.match === 'on_site' ? 'on this spot' : formatMetres(c.distanceM) }}
              <template v-if="c.hasOccupationCertificate"> · occupation certificate</template>
            </span>
          </li>
        </ul>
      </div>

      <div v-if="result.enforcement.length" class="iic-block">
        <h4>Open enforcement</h4>
        <ul>
          <li v-for="o in result.enforcement" :key="o.orderId" class="iic-enf">
            <strong>{{ o.reference || humanize(o.orderType) }}</strong>
            <UiStatusBadge tone="negative" :label="humanize(o.status)" :dot="false" />
          </li>
        </ul>
      </div>
    </template>

    <div v-if="props.mapFeature" class="iic-block iic-feature">
      <h4>
        {{ props.mapFeature.layerTitle || humanize(props.mapFeature.layer) }}
        <template v-if="props.mapFeature.fid != null"> · #{{ props.mapFeature.fid }}</template>
      </h4>
      <dl v-if="featureRows.length" class="iic-dl">
        <div v-for="[label, value] in featureRows" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></div>
      </dl>
      <p v-else class="iic-muted">This feature publishes no attributes.</p>
    </div>
  </section>
</template>

<style scoped>
.iic { display: flex; flex-direction: column; gap: var(--ent-s2); font-size: var(--ent-fs-sm); color: var(--ent-text); }
.iic-head { display: flex; align-items: center; gap: var(--ent-s2); color: var(--ent-text-2); }
.iic-head h3 { margin: 0; flex: 1; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.iic-close {
  display: inline-flex; align-items: center; justify-content: center;
  width: var(--ent-control-h-sm); height: var(--ent-control-h-sm);
  border: 1px solid transparent; border-radius: var(--ent-r-sm);
  background: none; color: var(--ent-text-2); cursor: pointer;
}
.iic-close:hover { background: var(--ent-surface-2); }
.iic-close:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.iic-coords { margin: 0; font-family: var(--ent-font-mono); font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.iic-muted { margin: 0; color: var(--ent-text-3); font-size: var(--ent-fs-xs); }
.iic-error { margin: 0; color: var(--ent-danger); font-size: var(--ent-fs-xs); }
.iic-assess { display: flex; flex-direction: column; align-items: flex-start; gap: var(--ent-s1); padding: var(--ent-s2); border-radius: var(--ent-r-sm); background: var(--ent-surface-2); }
.iic-assess.t-negative { background: var(--ent-tone-negative-bg); }
.iic-assess.t-warning { background: var(--ent-tone-warning-bg); }
.iic-assess p { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.iic-dl { margin: 0; display: grid; gap: var(--ent-s1); }
.iic-dl > div { display: grid; grid-template-columns: 6.5rem minmax(0, 1fr); gap: var(--ent-s2); }
.iic-dl dt { color: var(--ent-text-3); }
.iic-dl dd { margin: 0; overflow-wrap: anywhere; }
.iic-block h4 { margin: 0 0 var(--ent-s1); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); color: var(--ent-text-2); }
.iic-block ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--ent-s2); }
.iic-case {
  display: flex; align-items: center; gap: var(--ent-s2); width: 100%;
  padding: var(--ent-s1) 0; border: none; background: none; cursor: pointer;
  font: inherit; color: var(--ent-accent); text-align: left;
}
.iic-case:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); border-radius: var(--ent-r-sm); }
.iic-case-ref { font-weight: var(--ent-fw-semibold); white-space: nowrap; }
.iic-case-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ent-text-2); }
.iic-case-meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ent-s2); font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
.iic-enf { display: flex; align-items: center; gap: var(--ent-s2); }
.iic-feature { border-top: 1px solid var(--ent-line); padding-top: var(--ent-s2); }
.iic-feature .iic-dl { margin-top: var(--ent-s1); }
</style>
