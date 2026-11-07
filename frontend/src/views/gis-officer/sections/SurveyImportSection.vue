<script setup lang="ts">
// Survey import (GMS 5.5 / business rule 1): the only way a parcel boundary
// enters the register. Validate first; commit only a clean report. Phase 1
// takes GeoJSON in the survey CRS as supplied (a Lo belt); Shapefile, DXF and
// GeoPackage readers come with the full import screen.
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { FileCheck2, Upload } from 'lucide-vue-next'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { gmsApi, SURVEY_CRS, type ImportResult, type ImportIssue } from '@/services/gms'

const router = useRouter()

const sgRef = ref('')
const township = ref('')
const srid = ref<number>(922029)
const fileName = ref('')
const features = ref<unknown[] | null>(null)
const fileError = ref('')
const busy = ref(false)
const result = ref<ImportResult | null>(null)
const error = ref('')

const report = computed(() => result.value?.report ?? null)
const issues = computed<ImportIssue[]>(() => result.value?.report?.errors ?? result.value?.errors ?? [])
const validated = computed(() => !!result.value && !result.value.committed && result.value.ok)
const ready = computed(() => !!features.value && sgRef.value.trim() && township.value.trim())

// Any edit invalidates the last report: commit must follow a validation of
// exactly what will be written.
function reset() { result.value = null; error.value = '' }

async function onFile(e: Event) {
  reset()
  features.value = null
  fileError.value = ''
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  fileName.value = file.name
  try {
    const json = JSON.parse(await file.text())
    const list = json?.type === 'FeatureCollection' ? json.features : Array.isArray(json) ? json : null
    if (!Array.isArray(list) || !list.length) throw new Error('no features')
    features.value = list
  } catch {
    fileError.value = 'Not a GeoJSON FeatureCollection with features. Export the approved plan as GeoJSON in its Lo coordinates, with a stand_no property on each parcel.'
  }
}

async function run(commit: boolean) {
  if (!ready.value) return
  busy.value = true
  error.value = ''
  try {
    result.value = await gmsApi.importGeneralPlan({
      sg_ref: sgRef.value.trim(), township_code: township.value.trim().toUpperCase(),
      source_srid: srid.value, features: features.value!, commit,
    })
  } catch (e: any) {
    error.value = e?.response?.status === 403
      ? 'Only the Principal GIS Officer and the Senior GIS Officer (Data) can import survey data.'
      : 'The import could not be run. Nothing was written.'
  } finally {
    busy.value = false
  }
}

const ISSUE_TEXT: Record<string, (i: ImportIssue) => string> = {
  missing_stand_no: (i) => `Feature ${i.feature}: no stand_no property`,
  not_a_polygon: (i) => `Feature ${i.feature}: not a polygon`,
  invalid_geometry: (i) => `Feature ${i.feature}: invalid geometry (${i.reason})`,
  duplicate_stand_no_in_plan: (i) => `Stand ${i.stand_no} appears more than once in this plan`,
  stand_no_exists: (i) => `Stand ${i.stand_no} is already registered in this township as ${i.parcel_id}`,
  overlap: (i) => `Stands ${i.stand_nos?.join(' and ')} overlap by ${i.overlap_m2?.toFixed(2)} m²`,
  boundary_differs: (i) => `Stand ${i.stand_no}: the approved boundary is ${i.deviation_m?.toFixed(3)} m from the council's survey of it (${i.parcel_id}); more than the ${i.tolerance_m} m that counts as the same. Resolve this before importing`,
  ambiguous_match: (i) => `Stand ${i.stand_no} fits more than one of the council's plots (${i.parcel_ids?.join(', ')}), or one plot fits more than one stand. Nothing is guessed`,
  overlaps_authority_parcel: (i) => `Stand ${i.stand_no} lies on the council's stand ${i.parcel_stand_no} (${i.parcel_id}) by ${i.overlap_m2?.toFixed(2)} m²: the numbering differs`,
  not_a_survey_crs: () => 'The chosen coordinate system is not a registered survey CRS',
}
const describe = (i: ImportIssue) => (ISSUE_TEXT[i.code]?.(i) ?? i.code)
</script>

<template>
  <div class="imp">
    <UiPanel title="Import an approved general plan"
             subtitle="Parcel boundaries enter the register only from approved Survey Section data. Geometry is kept exactly as supplied; a WGS84 copy is derived.">
      <form class="imp-form" @submit.prevent="run(false)">
        <label class="imp-field">
          <span>SG reference</span>
          <input v-model="sgRef" type="text" required placeholder="General plan or diagram number" @input="reset" />
        </label>
        <label class="imp-field">
          <span>Township code</span>
          <input v-model="township" type="text" required placeholder="TSAMBA-GP" @input="reset" />
        </label>
        <label class="imp-field">
          <span>Survey coordinate system</span>
          <select v-model.number="srid" @change="reset">
            <option v-for="c in SURVEY_CRS" :key="c.srid" :value="c.srid">{{ c.code }} (Gauss Conform, Arc 1950)</option>
          </select>
        </label>
        <label class="imp-field imp-file">
          <span>GeoJSON file</span>
          <input type="file" accept=".json,.geojson,application/geo+json,application/json" @change="onFile" />
          <span v-if="features" class="imp-hint">{{ fileName }} · {{ features.length }} features</span>
        </label>
        <p v-if="fileError" class="imp-err" role="alert">{{ fileError }}</p>
        <div class="imp-actions">
          <UiButton type="submit" :disabled="!ready" :loading="busy && !validated">
            <template #icon><FileCheck2 :size="14" aria-hidden="true" /></template>
            Validate
          </UiButton>
          <UiButton variant="primary" :disabled="!validated || busy" :loading="busy && validated" @click="run(true)">
            <template #icon><Upload :size="14" aria-hidden="true" /></template>
            Commit to the register
          </UiButton>
        </div>
      </form>
    </UiPanel>

    <p v-if="error" class="imp-err" role="alert">{{ error }}</p>

    <UiPanel v-if="result" :title="result.committed ? 'Imported' : issues.length ? 'Validation failed' : 'Ready to commit'">
      <div role="status">
        <dl v-if="report" class="imp-dl">
          <dt>Source CRS</dt><dd class="imp-mono">{{ report.source_crs }}</dd>
          <dt>Features</dt><dd class="imp-mono">{{ report.feature_count }}</dd>
          <dt>WGS84 copy</dt><dd>{{ report.transform_method }} · ±{{ report.transform_accuracy_m }} m</dd>
          <template v-if="report.summary">
            <dt>New stands</dt><dd class="imp-mono">{{ report.summary.new }}</dd>
            <dt>Council stands adopted</dt><dd class="imp-mono">{{ report.summary.adopt }}<span v-if="report.summary.adopt" class="imp-hint"> (same parcel, now approved)</span></dd>
            <dt>Conflicts</dt><dd class="imp-mono">{{ report.summary.conflicts }}</dd>
            <dt>Council stands not in this plan</dt><dd class="imp-mono">{{ report.summary.orphans }}</dd>
          </template>
        </dl>
        <p v-if="result.committed" class="imp-ok">
          {{ result.parcel_ids?.length }} parcels created with accuracy class A, and {{ result.parcel_ids?.length }}
          ParcelCreated events queued for the ERP.
          <template v-if="result.adopted_ids?.length">
            {{ result.adopted_ids.length }} of the council's stands were adopted in place and approved; {{ result.adopted_ids.length }} ParcelApproved events queued.
          </template>
          <UiButton size="sm" variant="ghost" @click="router.push({ path: '/gis/parcels' })">Open the register</UiButton>
        </p>
        <p v-else-if="!issues.length" class="imp-ok">No problems found. Commit writes every parcel and its ERP event in one step.</p>
        <ul v-else class="imp-issues">
          <li v-for="(i, n) in issues" :key="n">{{ describe(i) }}</li>
        </ul>
        <div v-if="report?.orphans?.length" class="imp-orphans">
          <p class="imp-hint">The council's own stands this plan does not mention. They stay as they are, awaiting approval:</p>
          <ul>
            <li v-for="o in report.orphans" :key="o.parcel_id">{{ o.stand_no ?? '(no number)' }} · {{ o.parcel_kind }} · {{ o.parcel_id }}</li>
          </ul>
        </div>
      </div>
    </UiPanel>
  </div>
</template>

<style scoped>
.imp { display:flex; flex-direction:column; gap:var(--ent-s4); padding:var(--ent-s4); max-width:880px; }
.imp-form { display:grid; grid-template-columns:1fr 1fr; gap:var(--ent-s3); }
.imp-field { display:flex; flex-direction:column; gap:var(--ent-s1); font-size:var(--ent-fs-xs);
  font-weight:var(--ent-fw-medium); color:var(--ent-text-2); }
.imp-field input[type="text"], .imp-field select { height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font:inherit; font-size:var(--ent-fs-sm); color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r-sm); }
.imp-file input { font:inherit; font-size:var(--ent-fs-sm); }
.imp-hint { font-weight:var(--ent-fw-normal); color:var(--ent-text-3); }
.imp-actions { grid-column:1 / -1; display:flex; gap:var(--ent-s2); }
.imp-err { grid-column:1 / -1; margin:0; padding:var(--ent-s2) var(--ent-s3); border-radius:var(--ent-r-sm);
  background:var(--ent-danger-soft); color:var(--ent-danger); font-size:var(--ent-fs-sm); }
.imp-ok { margin:var(--ent-s3) 0 0; font-size:var(--ent-fs-sm); color:var(--ent-text); display:flex; flex-wrap:wrap; align-items:center; gap:var(--ent-s2); }
.imp-dl { display:grid; grid-template-columns:max-content 1fr; gap:var(--ent-s1) var(--ent-s3); margin:0; font-size:var(--ent-fs-sm); }
.imp-dl dt { color:var(--ent-text-3); }
.imp-dl dd { margin:0; }
.imp-mono { font-family:var(--ent-font-mono); }
.imp-orphans { margin-top:var(--ent-s3); font-size:var(--ent-fs-sm); color:var(--ent-text-2); }
.imp-orphans ul { margin:var(--ent-s1) 0 0; padding-left:1.1rem; }
.imp-issues { margin:var(--ent-s3) 0 0; padding-left:1.1rem; display:flex; flex-direction:column; gap:var(--ent-s1);
  font-size:var(--ent-fs-sm); color:var(--ent-danger); }
@media (max-width: 767px) { .imp-form { grid-template-columns:1fr; } }
</style>
