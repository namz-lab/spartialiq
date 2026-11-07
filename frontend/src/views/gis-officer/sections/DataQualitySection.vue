<script setup lang="ts">
// Data Quality — log per-layer quality checks (metadata, completeness,
// staleness, coordinate system, topology, attribute integrity, backup).
// Findings feed the Dashboard's data-quality score and surface on the
// "open findings" list.

import { ref, computed } from 'vue'
import {
  useGISOfficerWorkspace, LAYER_CATEGORY_LABELS,
  type QualityCheckType,
} from '@/composables/useGISOfficerWorkspace'
import { isPersonName } from '@/utils/citizenValidation'
import { useUiFeedback, parseApiError } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import { getTileLayerCatalog } from '@/services/vectorTiles'
import {
  BarChart3, Plus, CheckCircle2, AlertTriangle, XCircle, Save, Database,
} from 'lucide-vue-next'

const gis = useGISOfficerWorkspace()
const fb = useUiFeedback()

const QUALITY_TYPES: { value: QualityCheckType; label: string }[] = [
  { value:'metadata',          label:'Metadata completeness' },
  { value:'completeness',      label:'Feature completeness' },
  { value:'staleness',         label:'Staleness (last-update age)' },
  { value:'coordinate_system', label:'Coordinate system' },
  { value:'topology',          label:'Topology (gaps / overlaps)' },
  { value:'attribute',         label:'Attribute integrity' },
  { value:'backup',            label:'Backup' },
  { value:'other',             label:'Other' },
]

const filter = ref<'open' | 'all' | 'resolved'>('open')

const filtered = computed(() => {
  if (filter.value === 'open')     return gis.qualityLog.value.filter(q => !q.resolved_at)
  if (filter.value === 'resolved') return gis.qualityLog.value.filter(q => !!q.resolved_at)
  return gis.qualityLog.value
})

const draft = ref<{ layer_id: string; check_type: QualityCheckType; checked_by: string;
  result: 'pass'|'warn'|'fail'; finding: string; remediation: string }>({
  layer_id:'', check_type:'metadata', checked_by:'', result:'pass',
  finding:'', remediation:'',
})
const formOpen = ref(false)

function startNew() {
  if (!gis.layers.value.length) {
    fb.showToast('Register at least one layer in Spatial database before logging a check.', 'warning')
    return
  }
  formOpen.value = true
  draft.value = { layer_id: gis.layers.value[0]?.id || '', check_type:'metadata',
    checked_by:'', result:'pass', finding:'', remediation:'' }
}

const catalogBusy = ref(false)
async function verifyCatalog() {
  catalogBusy.value = true
  try {
    const layers = await getTileLayerCatalog()
    const target = gis.layers.value[0]
    if (!target) {
      fb.showToast('Register a layer first, then verify the catalog against it.', 'warning')
      return
    }
    gis.logQuality({
      layer_id: target.id,
      check_type: 'completeness',
      checked_at: new Date().toISOString(),
      checked_by: 'tile catalog',
      result: layers.length ? 'pass' : 'fail',
      finding: layers.length
        ? `PostGIS tile catalog reachable with ${layers.length} published layer(s).`
        : 'Tile catalog returned no layers. The tile service may be down.',
      remediation: layers.length ? '' : 'Confirm the backend is running and GET /api/tiles/layers succeeds.',
      resolved_at: layers.length ? new Date().toISOString() : null,
    })
    fb.showToast(layers.length
      ? `Catalog reachable: ${layers.length} published layer(s).`
      : 'Tile catalog is empty or unreachable.', layers.length ? 'success' : 'error')
  } catch (e: any) {
    fb.showToast(parseApiError(e, 'Could not reach the tile catalog.'), 'error')
  } finally {
    catalogBusy.value = false
  }
}

function submit() {
  if (!draft.value.layer_id || !draft.value.finding.trim()) {
    fb.showToast('Layer and finding are required.', 'warning')
    return
  }
  if (!isPersonName(draft.value.checked_by)) {
    fb.showToast('Checker name must be a person’s name.', 'warning')
    return
  }
  gis.logQuality({
    layer_id: draft.value.layer_id,
    check_type: draft.value.check_type,
    checked_at: new Date().toISOString(),
    checked_by: draft.value.checked_by,
    result: draft.value.result,
    finding: draft.value.finding,
    remediation: draft.value.remediation,
    resolved_at: null,
  })
  fb.showToast('Quality check logged.', 'success')
  formOpen.value = false
}

function resolveOne(id: string) {
  gis.resolveQuality(id)
  fb.showToast('Finding marked resolved.', 'success')
}

function layerName(id: string): string {
  const l = gis.layers.value.find(x => x.id === id)
  return l ? l.layer_name : '—'
}
function layerCat(id: string): string {
  const l = gis.layers.value.find(x => x.id === id)
  return l ? LAYER_CATEGORY_LABELS[l.category] : '—'
}

function fmtDate(iso: string|null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
}

const openCount = computed(() => gis.qualityLog.value.filter(q => !q.resolved_at).length)
const failCount = computed(() => gis.qualityLog.value.filter(q => q.result === 'fail' && !q.resolved_at).length)
</script>

<template>
  <div class="dq">
    <header class="dq-head">
      <BarChart3 :size="14" />
      <h2>Data quality</h2>
      <span class="dq-sub">Score: <strong>{{ gis.dataQualityScore.value }}</strong> · {{ openCount }} open ({{ failCount }} fail)</span>
      <button class="dq-add ghost" @click="verifyCatalog" :disabled="catalogBusy">
        <Database :size="12" /> {{ catalogBusy ? 'Checking…' : 'Verify tile catalog' }}
      </button>
      <button class="dq-add" @click="startNew">
        <Plus :size="12" /> Log check
      </button>
    </header>

    <div class="dq-filters">
      <button :class="{ active: filter === 'open' }"     @click="filter = 'open'">Open</button>
      <button :class="{ active: filter === 'resolved' }" @click="filter = 'resolved'">Resolved</button>
      <button :class="{ active: filter === 'all' }"      @click="filter = 'all'">All</button>
    </div>

    <div v-if="formOpen" class="dq-form">
      <h3>Log quality check</h3>
      <div class="dq-grid">
        <label><span>Layer *</span>
          <select v-model="draft.layer_id">
            <option v-for="l in gis.layers.value" :key="l.id" :value="l.id">{{ l.layer_name }}</option>
          </select>
        </label>
        <label><span>Check type</span>
          <select v-model="draft.check_type">
            <option v-for="t in QUALITY_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </label>
        <label><span>Result</span>
          <select v-model="draft.result">
            <option value="pass">Pass</option>
            <option value="warn">Warn</option>
            <option value="fail">Fail</option>
          </select>
        </label>
        <label><span>Checked by *</span><input v-model="draft.checked_by" /></label>
        <label class="full"><span>Finding *</span>
          <textarea v-model="draft.finding" rows="2" placeholder="What was observed."></textarea>
        </label>
        <label class="full"><span>Remediation</span>
          <textarea v-model="draft.remediation" rows="2" placeholder="What to do about it."></textarea>
        </label>
      </div>
      <div class="dq-form-actions">
        <button class="dq-btn ghost" @click="formOpen = false">Cancel</button>
        <button class="dq-btn primary" @click="submit"><Save :size="11" /> Log check</button>
      </div>
    </div>

    <div v-if="!filtered.length" class="dq-empty">No findings match this filter.</div>
    <ul v-else class="dq-list">
      <li v-for="q in filtered" :key="q.id" :class="[q.result, { resolved: !!q.resolved_at }]">
        <header>
          <span class="dq-res" :class="q.result">
            <CheckCircle2 v-if="q.result === 'pass'" :size="11" />
            <AlertTriangle v-else-if="q.result === 'warn'" :size="11" />
            <XCircle v-else :size="11" />
            {{ q.result }}
          </span>
          <span class="dq-type">{{ q.check_type.replace(/_/g, ' ') }}</span>
          <span class="dq-layer">{{ layerName(q.layer_id) }}</span>
          <span class="dq-cat">{{ layerCat(q.layer_id) }}</span>
          <span class="dq-when">{{ fmtDate(q.checked_at) }} · {{ q.checked_by }}</span>
        </header>
        <p><strong>Finding:</strong> {{ q.finding }}</p>
        <p v-if="q.remediation"><strong>Remediation:</strong> {{ q.remediation }}</p>
        <p v-if="q.resolved_at" class="dq-done">Resolved {{ fmtDate(q.resolved_at) }}.</p>
        <footer v-else>
          <button class="dq-btn small primary" @click="resolveOne(q.id)">Mark resolved</button>
        </footer>
      </li>
    </ul>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.dq { padding:1rem 1.25rem; display:flex; flex-direction:column; gap:0.85rem; height:100%; overflow-y:auto; }
.dq-head { display:flex; align-items:center; gap:0.4rem; }
.dq-head h2 { margin:0; font-size:0.95rem; font-weight:700; }
.dq-sub { color:#94a3b8; font-size:0.7rem; }
.dq-sub strong { color:#0e7490; font-family: ui-monospace, monospace; }
.dq-add { margin-left:auto; display:inline-flex; align-items:center; gap:0.3rem;
  padding:0.4rem 0.7rem; background:#0e7490; color:#fff; border:none;
  border-radius:0.35rem; font-size:0.7rem; font-weight:600; cursor:pointer; }
.dq-add:hover { background:#155e75; }
.dq-add.ghost { margin-left:0.4rem; background:#fff; color:#475569; border:1px solid #e2e8f0; }
.dq-add.ghost:hover { background:#f8fafc; }
.dq-add:disabled { opacity:0.6; cursor:not-allowed; }

.dq-filters { display:flex; gap:0.25rem; }
.dq-filters button { padding:0.3rem 0.7rem; background:#fff; border:1px solid #e2e8f0;
  border-radius:1rem; font-size:0.65rem; color:#475569; cursor:pointer; }
.dq-filters button.active { background:#0e7490; color:#fff; border-color:#0e7490; }

.dq-form { background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; padding:0.85rem 1rem; }
.dq-form h3 { margin:0 0 0.5rem; font-size:0.78rem; color:#0e7490; }
.dq-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:0.45rem; }
.dq-grid label { display:flex; flex-direction:column; gap:0.2rem; font-size:0.62rem; color:#64748b; }
.dq-grid label.full { grid-column:1 / -1; }
.dq-grid input, .dq-grid select, .dq-grid textarea {
  padding:0.4rem 0.55rem; border:1px solid #e2e8f0; border-radius:0.3rem;
  font-size:0.72rem; color:#0f172a; font-family:inherit; resize:vertical; }
.dq-form-actions { display:flex; justify-content:flex-end; gap:0.4rem; margin-top:0.6rem; }

.dq-empty { padding:2rem; text-align:center; color:#94a3b8; font-size:0.78rem;
  background:#fff; border:1px dashed #e2e8f0; border-radius:0.45rem; }

.dq-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.5rem; }
.dq-list li { background:#fff; border:1px solid #e2e8f0; border-radius:0.4rem; padding:0.7rem 0.85rem; }
.dq-list li.fail { border-color:#fecaca; background:#fff7f7; }
.dq-list li.warn { border-color:#fde68a; background:#fffbeb; }
.dq-list li.pass { border-color:#bbf7d0; background:#f0fdf4; }
.dq-list li.resolved { opacity:0.6; }
.dq-list > li > header { display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap; margin-bottom:0.35rem; }
.dq-res { display:inline-flex; align-items:center; gap:0.2rem; padding:0.15rem 0.4rem; border-radius:0.25rem;
  font-size:0.55rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;
  background:#f1f5f9; color:#64748b; }
.dq-res.fail { background:#fee2e2; color:#991b1b; }
.dq-res.warn { background:#fef3c7; color:#92400e; }
.dq-res.pass { background:#dcfce7; color:#166534; }
.dq-type  { color:#475569; font-size:0.65rem; text-transform:capitalize; }
.dq-layer { color:#0f172a; font-weight:600; font-size:0.7rem; }
.dq-cat   { color:#94a3b8; font-size:0.6rem; }
.dq-when  { color:#94a3b8; font-size:0.6rem; margin-left:auto; }
.dq-list p { margin:0.2rem 0; font-size:0.7rem; color:#475569; line-height:1.5; }
.dq-done { color:#16a34a; font-weight:600; }
.dq-list footer { display:flex; justify-content:flex-end; margin-top:0.4rem; }

.dq-btn { display:inline-flex; align-items:center; gap:0.3rem;
  padding:0.4rem 0.75rem; border:1px solid #e2e8f0; border-radius:0.3rem;
  background:#fff; color:#475569; font-size:0.66rem; font-weight:600; cursor:pointer; }
.dq-btn.small { padding:0.3rem 0.55rem; font-size:0.6rem; }
.dq-btn.primary { background:#0e7490; color:#fff; border-color:#0e7490; }
.dq-btn.primary:hover { background:#155e75; }
.dq-btn.ghost   { background:#fff; }
</style>
