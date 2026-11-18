<script setup lang="ts">
/**
 * The Department of Roads and Works records its field survey (backend src/routes/roads-works-registers.js, migration 254;
 * the paper sheets are docs/manuals/roads-works-field-survey.md). One tab per sheet: roads, bridges and culverts, water
 * points, council buildings. Each row opens a form for that record's survey entry, with the record's earlier entries
 * below it. Only the fields an officer changes are sent, so a field left alone stays as it was.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ClipboardCheck, Info, RefreshCw, TriangleAlert } from 'lucide-vue-next'
import {
  roadsWorksApi, surveyApi, type CouncilRoad, type RegisterSummary, type SurveyCouncilAsset, type SurveyLogLine,
  type SurveyRegister, type SurveyRoad, type SurveyStructure, type SurveyWaterPoint, type SurveyWords,
} from '@/services/roadsWorks'

type Tab = 'roads' | 'structures' | 'water' | 'assets'
type Row = SurveyRoad | SurveyStructure | SurveyWaterPoint | SurveyCouncilAsset
type Field = { key: string; label: string; kind: 'words' | 'text' | 'number' | 'date'; words?: keyof SurveyWords; step?: string }

const TABS: { key: Tab; label: string; register: SurveyRegister }[] = [
  { key: 'roads', label: 'Roads', register: 'road' },
  { key: 'structures', label: 'Bridges and culverts', register: 'structure' },
  { key: 'water', label: 'Water points', register: 'water_point' },
  { key: 'assets', label: 'Council buildings', register: 'council_asset' },
]

const FIELDS: Record<SurveyRegister, Field[]> = {
  road: [
    { key: 'surface', label: 'Surface', kind: 'words', words: 'surface' },
    { key: 'condition', label: 'Condition', kind: 'words', words: 'condition' },
    { key: 'council_class', label: 'Council class', kind: 'words', words: 'council_class' },
    { key: 'width_m', label: 'Width (m)', kind: 'number', step: '0.1' },
    { key: 'drainage', label: 'Drainage', kind: 'words', words: 'drainage' },
    { key: 'name', label: 'Road name', kind: 'text' },
  ],
  structure: [
    { key: 'structure_type', label: 'Structure', kind: 'words', words: 'structure_type' },
    { key: 'condition', label: 'Condition', kind: 'words', words: 'condition' },
    { key: 'span_m', label: 'Span or diameter (m)', kind: 'number', step: '0.1' },
    { key: 'name', label: 'Name or location', kind: 'text' },
    { key: 'lng', label: 'GPS longitude', kind: 'number', step: '0.000001' },
    { key: 'lat', label: 'GPS latitude', kind: 'number', step: '0.000001' },
  ],
  water_point: [
    { key: 'operational', label: 'Working?', kind: 'words', words: 'operational' },
    { key: 'pump_type', label: 'Pump', kind: 'words', words: 'pump_type' },
    { key: 'yield_note', label: 'Yield', kind: 'text' },
    { key: 'last_repaired_on', label: 'Last repaired', kind: 'date' },
    { key: 'caretaker', label: 'Caretaker', kind: 'text' },
    { key: 'name', label: 'Name', kind: 'text' },
  ],
  council_asset: [
    { key: 'condition', label: 'Condition', kind: 'words', words: 'building_condition' },
    { key: 'department', label: 'Department using it', kind: 'text' },
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'lng', label: 'GPS longitude', kind: 'number', step: '0.000001' },
    { key: 'lat', label: 'GPS latitude', kind: 'number', step: '0.000001' },
  ],
}

const word = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))
const wardLabel = (w: string | null) => (w ? `Ward ${Number(w.split('-').pop()) || w}` : 'No ward')
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const today = () => new Date().toISOString().slice(0, 10)

const summary = ref<RegisterSummary | null>(null)
const tab = ref<Tab>('roads')
const register = computed(() => TABS.find((t) => t.key === tab.value)!.register)
const canWrite = computed(() => !!summary.value?.can_write[register.value])

const q = ref('')
const ward = ref('')
const state = ref('unsurveyed')
const offset = ref(0)
const LIMIT = 50
const rows = ref<Row[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)

async function loadSummary() {
  try { summary.value = await surveyApi.summary() } catch { error.value = 'The registers could not be read. Try again in a moment.' }
}

async function load() {
  loading.value = true
  error.value = null
  const f = { q: q.value.trim() || undefined, ward: ward.value || undefined, state: state.value, limit: LIMIT, offset: offset.value }
  try {
    if (tab.value === 'roads') { const r = await surveyApi.roads(f); rows.value = r.items; total.value = r.total }
    else if (tab.value === 'water') { const r = await surveyApi.waterPoints(f); rows.value = r.items; total.value = r.total }
    else if (tab.value === 'structures') { const r = await surveyApi.structures(); rows.value = r.items; total.value = r.items.length }
    else { const r = await surveyApi.councilAssets(); rows.value = r.items; total.value = r.items.length }
  } catch { error.value = 'The register could not be read. Try again in a moment.' } finally { loading.value = false }
}

let typing: ReturnType<typeof setTimeout> | null = null
watch(q, () => { if (typing) clearTimeout(typing); typing = setTimeout(() => { offset.value = 0; load() }, 300) })
watch([ward, state], () => { offset.value = 0; load() })
watch(tab, () => { open.value = null; adding.value = false; q.value = ''; offset.value = 0; state.value = tab.value === 'water' ? 'unsurveyed' : tab.value === 'roads' ? 'unsurveyed' : 'all'; load() })
onMounted(async () => { await loadSummary(); await load() })

const paged = computed(() => tab.value === 'roads' || tab.value === 'water')
const STATES = computed(() => tab.value === 'water'
  ? [['unsurveyed', 'State not known'], ['broken', 'Broken'], ['all', 'All']]
  : [['unsurveyed', 'Not yet surveyed'], ['surveyed', 'Surveyed'], ['all', 'All']])

// ── The survey entry form ───────────────────────────────────────────────────────────────────────
const open = ref<Row | null>(null)
const adding = ref(false)
const form = ref<Record<string, string>>({})
const original = ref<Record<string, string>>({})
const entry = ref({ surveyed_on: today(), photo_ref: '', notes: '' })
const busy = ref(false)
const formError = ref<string | null>(null)
const saved = ref<string | null>(null)
const history = ref<SurveyLogLine[]>([])
let savedTimer: ReturnType<typeof setTimeout> | null = null
watch(saved, (v) => { if (savedTimer) clearTimeout(savedTimer); if (v) savedTimer = setTimeout(() => { saved.value = null }, 5000) })

const fields = computed(() => FIELDS[register.value])
const asText = (v: unknown) => (v === null || v === undefined ? '' : String(v))

async function start(r: Row) {
  adding.value = false
  open.value = r
  const values = Object.fromEntries(fields.value.map((f) => [f.key, asText((r as unknown as Record<string, unknown>)[f.key])]))
  form.value = { ...values }
  original.value = { ...values }
  entry.value = { surveyed_on: today(), photo_ref: '', notes: '' }
  formError.value = null
  saved.value = null
  history.value = []
  try { history.value = await surveyApi.log(register.value, r.id) } catch { history.value = [] }
}

function startAdding() {
  open.value = null
  adding.value = true
  form.value = Object.fromEntries(fields.value.map((f) => [f.key, '']))
  original.value = {}
  entry.value = { surveyed_on: today(), photo_ref: '', notes: '' }
  roadPick.value = null
  roadQuery.value = ''
  formError.value = null
  saved.value = null
}

// a new structure names its road from the register
const roadQuery = ref('')
const roadHits = ref<CouncilRoad[]>([])
const roadPick = ref<CouncilRoad | null>(null)
let roadTimer: ReturnType<typeof setTimeout> | null = null
watch(roadQuery, (v) => {
  if (roadTimer) clearTimeout(roadTimer)
  if (v.trim().length < 2) { roadHits.value = []; return }
  roadTimer = setTimeout(async () => { try { roadHits.value = await roadsWorksApi.councilRoads(v.trim()) } catch { roadHits.value = [] } }, 300)
})

async function save() {
  busy.value = true
  formError.value = null
  saved.value = null
  // only what changed is sent; a GPS point goes as a pair
  const changed: Record<string, string | number | null> = {}
  for (const f of fields.value) {
    const now = asText(form.value[f.key]).trim()
    if (adding.value ? now !== '' : now !== asText(original.value[f.key]).trim()) changed[f.key] = now === '' ? null : f.kind === 'number' ? Number(now) : now
  }
  if ('lng' in changed || 'lat' in changed) { changed.lng = Number(form.value.lng); changed.lat = Number(form.value.lat) }
  const body = { ...changed, surveyed_on: entry.value.surveyed_on, photo_ref: entry.value.photo_ref.trim() || undefined, notes: entry.value.notes.trim() || undefined }
  try {
    if (adding.value) {
      await surveyApi.addStructure({ ...body, road_asset_id: roadPick.value?.id ?? null })
      adding.value = false
      saved.value = 'The structure is added to the register.'
    } else if (open.value) {
      const id = open.value.id
      if (register.value === 'road') await surveyApi.saveRoad(id, body)
      else if (register.value === 'structure') await surveyApi.saveStructure(id, body)
      else if (register.value === 'water_point') await surveyApi.saveWaterPoint(id, body)
      else await surveyApi.saveCouncilAsset(id, body)
      open.value = null
      saved.value = 'The survey is recorded.'
    }
    await Promise.all([loadSummary(), load()])
  } catch (e: unknown) {
    formError.value = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'The survey could not be recorded.'
  } finally { busy.value = false }
}

const title = (r: Row) => {
  const x = r as unknown as Record<string, string | null>
  return x.name || x.asset_code || word(x.structure_type)
}
const LOG_LABEL: Record<string, string> = {
  width_m: 'Width (m)', span_m: 'Span (m)', data_quality: 'Record', council_class: 'Council class', lng: 'Longitude', lat: 'Latitude',
  road_asset_id: 'Road', operational: 'Working?', pump_type: 'Pump', yield_note: 'Yield', last_repaired_on: 'Last repaired',
}
const changes = (l: SurveyLogLine) => Object.keys(l.after)
  .filter((k) => JSON.stringify(l.after[k]) !== JSON.stringify(l.before[k]) && k !== 'road_asset_id')
  .map((k) => `${LOG_LABEL[k] ?? word(k)}: ${word(l.before[k])} → ${word(l.after[k])}`)

/** The table's lines: each record, with the survey form under the one being surveyed (or at the top for a new one). */
type Line = { kind: 'row'; r: Row } | { kind: 'form'; id: string }
const lines = computed<Line[]>(() => {
  const out: Line[] = adding.value ? [{ kind: 'form', id: '__new' }] : []
  for (const r of rows.value) {
    out.push({ kind: 'row', r })
    if (open.value?.id === r.id) out.push({ kind: 'form', id: `${r.id}__form` })
  }
  return out
})
const COLS = 8
</script>

<template>
  <section class="rg" aria-labelledby="rg-h" data-testid="registers-panel">
    <header class="rg-head">
      <div>
        <h2 id="rg-h" class="rg-title"><ClipboardCheck :size="18" aria-hidden="true" /> Survey registers</h2>
        <p class="rg-sub">Enter what the field survey finds, sheet by sheet. Each entry is dated and logged with what the register said before.</p>
      </div>
      <button type="button" class="rg-btn" :disabled="loading" @click="loadSummary(); load()"><RefreshCw :size="14" aria-hidden="true" /> Refresh</button>
    </header>

    <dl v-if="summary" class="rg-totals">
      <div><dt>Roads surveyed</dt><dd>{{ summary.roads_surveyed }} <span>of {{ summary.roads }}</span></dd></div>
      <div><dt>Bridges and culverts</dt><dd>{{ summary.structures }}</dd></div>
      <div><dt>Water points with a known state</dt><dd>{{ summary.water_points_known }} <span>of {{ summary.water_points }}</span></dd></div>
      <div><dt>Council buildings located</dt><dd>{{ summary.council_assets_located }} <span>of {{ summary.council_assets }}</span></dd></div>
    </dl>

    <div class="rg-tabs" role="tablist" aria-label="Registers">
      <button v-for="t in TABS" :key="t.key" type="button" role="tab" :aria-selected="tab === t.key" class="rg-tab" :class="{ on: tab === t.key }" @click="tab = t.key">{{ t.label }}</button>
    </div>

    <div class="rg-filters">
      <label v-if="paged" class="rg-grow">Search <input v-model="q" type="search" placeholder="Name or asset code" /></label>
      <label v-if="paged">Ward
        <select v-model="ward"><option value="">All wards</option><option v-for="w in summary?.wards ?? []" :key="w" :value="w">{{ wardLabel(w) }}</option></select>
      </label>
      <label v-if="paged">Show
        <select v-model="state"><option v-for="[k, l] in STATES" :key="k" :value="k">{{ l }}</option></select>
      </label>
      <button v-if="tab === 'structures' && canWrite" type="button" class="rg-btn is-primary" @click="startAdding">Add a structure</button>
    </div>

    <p v-if="saved" class="rg-msg is-ok" role="status">{{ saved }}</p>
    <p v-if="error" class="rg-msg is-error" role="alert"><TriangleAlert :size="16" aria-hidden="true" />{{ error }}</p>
    <p v-else-if="loading && !rows.length" class="rg-msg">Reading the register…</p>
    <p v-else-if="!rows.length && !adding" class="rg-msg"><Info :size="16" aria-hidden="true" />
      <template v-if="tab === 'structures'">No bridge, culvert or drift is recorded yet. Add each one the survey finds, with its GPS point.</template>
      <template v-else>Nothing matches.</template>
    </p>

    <div v-if="rows.length || adding" class="rg-scroll">
      <table class="rg-table">
        <caption class="rg-sr">{{ TABS.find((t) => t.key === tab)!.label }}</caption>
        <thead>
          <tr v-if="tab === 'roads'"><th scope="col">Road</th><th scope="col">Ward</th><th scope="col">Class</th><th scope="col" class="r">Length</th><th scope="col">Surface</th><th scope="col">Condition</th><th scope="col">Surveyed</th><th scope="col"><span class="rg-sr">Actions</span></th></tr>
          <tr v-else-if="tab === 'structures'"><th scope="col">Structure</th><th scope="col">Road</th><th scope="col">Ward</th><th scope="col">Condition</th><th scope="col" class="r">Span</th><th scope="col">Surveyed</th><th scope="col"><span class="rg-sr">Actions</span></th></tr>
          <tr v-else-if="tab === 'water'"><th scope="col">Water point</th><th scope="col">Ward</th><th scope="col">Working?</th><th scope="col">Pump</th><th scope="col">Caretaker</th><th scope="col">Surveyed</th><th scope="col"><span class="rg-sr">Actions</span></th></tr>
          <tr v-else><th scope="col">Building</th><th scope="col">Department</th><th scope="col">Ward</th><th scope="col">Condition</th><th scope="col">Located</th><th scope="col">Surveyed</th><th scope="col"><span class="rg-sr">Actions</span></th></tr>
        </thead>
        <tbody>
          <template v-for="line in lines" :key="line.kind === 'row' ? line.r.id : line.id">
          <template v-if="line.kind === 'row'"><template v-for="r in [line.r]" :key="r.id">
          <tr :class="{ 'is-open': open?.id === r.id }">
            <template v-if="tab === 'roads'">
              <th scope="row"><span class="rg-name">{{ (r as SurveyRoad).name || 'Unnamed road' }}</span><span class="rg-meta">{{ (r as SurveyRoad).asset_code }}</span></th>
              <td>{{ wardLabel((r as SurveyRoad).ward) }}</td>
              <td>{{ word((r as SurveyRoad).council_class) }}</td>
              <td class="r">{{ (r as SurveyRoad).length_m != null ? `${(r as SurveyRoad).length_m!.toLocaleString('en-GB')} m` : '—' }}</td>
              <td>{{ word((r as SurveyRoad).surface) }}</td>
              <td :class="{ 'is-warn': ['poor', 'very_poor', 'impassable'].includes((r as SurveyRoad).condition ?? '') }">{{ word((r as SurveyRoad).condition) }}</td>
              <td>{{ day(r.surveyed_on) }}</td>
            </template>
            <template v-else-if="tab === 'structures'">
              <th scope="row"><span class="rg-name">{{ title(r) }}</span><span class="rg-meta">{{ word((r as SurveyStructure).structure_type) }}</span></th>
              <td>{{ (r as SurveyStructure).road_name || (r as SurveyStructure).road_code || '—' }}</td>
              <td>{{ wardLabel(r.ward) }}</td>
              <td :class="{ 'is-warn': ['poor', 'very_poor', 'impassable'].includes((r as SurveyStructure).condition ?? '') }">{{ word((r as SurveyStructure).condition) }}</td>
              <td class="r">{{ (r as SurveyStructure).span_m != null ? `${(r as SurveyStructure).span_m} m` : '—' }}</td>
              <td>{{ day(r.surveyed_on) }}</td>
            </template>
            <template v-else-if="tab === 'water'">
              <th scope="row"><span class="rg-name">{{ (r as SurveyWaterPoint).name || (r as SurveyWaterPoint).asset_code }}</span><span class="rg-meta">{{ (r as SurveyWaterPoint).asset_code }} · {{ word((r as SurveyWaterPoint).asset_type) }}</span></th>
              <td>{{ wardLabel(r.ward) }}</td>
              <td :class="{ 'is-warn': (r as SurveyWaterPoint).operational === 'broken' }">{{ word((r as SurveyWaterPoint).operational) }}</td>
              <td>{{ word((r as SurveyWaterPoint).pump_type) }}</td>
              <td>{{ (r as SurveyWaterPoint).caretaker || '—' }}</td>
              <td>{{ day(r.surveyed_on) }}</td>
            </template>
            <template v-else>
              <th scope="row"><span class="rg-name">{{ title(r) }}</span><span class="rg-meta">{{ word((r as SurveyCouncilAsset).asset_class) }}</span></th>
              <td>{{ (r as SurveyCouncilAsset).department || '—' }}</td>
              <td>{{ wardLabel(r.ward) }}</td>
              <td>{{ word((r as SurveyCouncilAsset).condition) }}</td>
              <td :class="{ 'is-warn': (r as SurveyCouncilAsset).lng == null }">{{ (r as SurveyCouncilAsset).lng != null ? 'Yes' : 'No GPS point' }}</td>
              <td>{{ day(r.surveyed_on) }}</td>
            </template>
            <td class="r"><button type="button" class="rg-btn" :aria-expanded="open?.id === r.id" @click="open?.id === r.id ? (open = null) : start(r)">{{ open?.id === r.id ? 'Close' : canWrite ? 'Record survey' : 'History' }}</button></td>
          </tr>
          </template></template>
          <tr v-else class="rg-expand"><td :colspan="COLS">
              <form v-if="canWrite" class="rg-form" aria-labelledby="rg-form-h" @submit.prevent="save">
                <h3 id="rg-form-h">{{ adding ? 'Add a bridge, culvert or drift' : `Survey: ${title(open!)}` }}</h3>
                <div class="rg-grid">
                  <label>Day surveyed <input v-model="entry.surveyed_on" type="date" :max="today()" required /></label>
                  <label v-for="f in fields" :key="f.key">{{ f.label }}
                    <select v-if="f.kind === 'words'" v-model="form[f.key]">
                      <option value="">Not recorded</option>
                      <option v-for="w in summary?.words[f.words!] ?? []" :key="w" :value="w">{{ word(w) }}</option>
                    </select>
                    <input v-else-if="f.kind === 'number'" v-model="form[f.key]" type="number" :step="f.step" />
                    <input v-else-if="f.kind === 'date'" v-model="form[f.key]" type="date" :max="today()" />
                    <input v-else v-model="form[f.key]" type="text" maxlength="200" />
                  </label>
                  <label>Photo no. <input v-model="entry.photo_ref" type="text" maxlength="60" placeholder="e.g. IMG-0042" /></label>
                  <template v-if="adding">
                    <label class="wide">Road it carries (name or asset code) <input v-model="roadQuery" type="search" placeholder="Search the road register" /></label>
                    <div v-if="roadPick" class="wide rg-meta">{{ roadPick.name || 'Unnamed road' }} · {{ roadPick.asset_code }} <button type="button" class="rg-link" @click="roadPick = null">Change</button></div>
                    <ul v-else-if="roadHits.length" class="wide rg-hits">
                      <li v-for="h in roadHits" :key="h.id"><button type="button" @click="roadPick = h; roadQuery = ''; roadHits = []">{{ h.name || 'Unnamed road' }} · {{ h.asset_code }} · {{ wardLabel(h.ward) }}</button></li>
                    </ul>
                  </template>
                  <label class="wide">Notes <textarea v-model="entry.notes" rows="2" maxlength="4000" /></label>
                </div>
                <p v-if="formError" class="rg-msg is-error" role="alert">{{ formError }}</p>
                <div class="rg-actions">
                  <button type="button" class="rg-btn" @click="open = null; adding = false">Cancel</button>
                  <button type="submit" class="rg-btn is-primary" :disabled="busy">{{ busy ? 'Recording…' : 'Record the survey' }}</button>
                </div>
              </form>

              <section v-if="open" class="rg-history" aria-label="Earlier survey entries">
                <h3>Earlier entries<template v-if="!canWrite">: {{ title(open) }}</template></h3>
                <p v-if="!history.length" class="rg-meta">No survey entry yet.</p>
                <ol v-else>
                  <li v-for="l in history" :key="l.id">
                    <strong>{{ day(l.surveyed_on) }}</strong> · {{ l.recorded_by_name || l.recorded_role || 'Unknown' }}<template v-if="l.photo_ref"> · photo {{ l.photo_ref }}</template>
                    <span class="rg-meta">{{ changes(l).join('; ') || 'Survey confirmed, nothing changed' }}<template v-if="l.notes"> — {{ l.notes }}</template></span>
                  </li>
                </ol>
                <button v-if="!canWrite" type="button" class="rg-btn" @click="open = null">Close</button>
              </section>
          </td></tr>
          </template>
        </tbody>
      </table>
      <div v-if="paged && total > LIMIT" class="rg-pager">
        <span>{{ offset + 1 }}–{{ Math.min(offset + LIMIT, total) }} of {{ total.toLocaleString('en-GB') }}</span>
        <button type="button" class="rg-btn" :disabled="offset === 0 || loading" @click="offset = Math.max(0, offset - LIMIT); load()">Previous</button>
        <button type="button" class="rg-btn" :disabled="offset + LIMIT >= total || loading" @click="offset += LIMIT; load()">Next</button>
      </div>
    </div>

  </section>
</template>

<style scoped>
.rg { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: 8px; padding: 1.25rem 1.5rem; }
.rg-head { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; margin-bottom: 1rem; }
.rg-title { display: flex; align-items: center; gap: 0.5rem; margin: 0; font-size: 1.125rem; font-weight: 600; }
.rg-sub { margin: 0.25rem 0 0; color: var(--ent-text-2); font-size: 0.875rem; max-width: 60ch; }
.rg-msg { display: flex; gap: 0.5rem; align-items: center; padding: 0.625rem 0.75rem; border-radius: 6px; background: var(--ent-surface-2); color: var(--ent-text-2); font-size: 0.875rem; }
.rg-msg.is-error { background: var(--ent-danger-soft); color: var(--ent-danger); }
.rg-msg.is-ok { position: sticky; top: 0.5rem; z-index: 1; color: var(--ent-text); border: 1px solid var(--ent-line); box-shadow: 0 2px 8px rgb(0 0 0 / 0.08); }
.rg-totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: 0.75rem; margin: 0 0 1rem; }
.rg-totals div { background: var(--ent-surface-2); border-radius: 6px; padding: 0.5rem 0.75rem; }
.rg-totals dt { font-size: 0.75rem; color: var(--ent-text-2); }
.rg-totals dd { margin: 0; font-size: 1.25rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.rg-totals dd span { font-size: 0.8125rem; font-weight: 400; color: var(--ent-text-2); }
.rg-tabs { display: flex; flex-wrap: wrap; gap: 0.25rem; border-bottom: 1px solid var(--ent-line); margin-bottom: 0.75rem; }
.rg-tab { padding: 0.5rem 0.75rem; border: 0; border-bottom: 2px solid transparent; background: none; font: inherit; font-size: 0.875rem; color: var(--ent-text-2); cursor: pointer; }
.rg-tab.on { color: var(--ent-text); border-bottom-color: var(--ent-accent); font-weight: 600; }
.rg-filters { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-end; margin-bottom: 0.75rem; }
.rg-filters label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.75rem; color: var(--ent-text-2); }
.rg-grow { flex: 1 1 14rem; }
.rg-filters input, .rg-filters select, .rg-form input, .rg-form select, .rg-form textarea { font: inherit; font-size: 0.875rem; padding: 0.3125rem 0.5rem; border: 1px solid var(--ent-line); border-radius: 4px; background: var(--ent-surface); color: var(--ent-text); }
.rg-scroll { overflow-x: auto; }
.rg-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.rg-table th, .rg-table td { padding: 0.5rem; border-top: 1px solid var(--ent-surface-2); text-align: left; vertical-align: top; font-weight: 400; }
.rg-table thead th { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ent-text-2); border-top: 0; }
.rg-table .r { text-align: right; font-variant-numeric: tabular-nums; }
.rg-table tr.is-open { background: var(--ent-surface-2); }
.rg-table .is-warn { color: var(--ent-warning); font-weight: 600; }
.rg-name { display: block; font-weight: 600; }
.rg-meta { display: block; font-size: 0.75rem; color: var(--ent-text-3); }
.rg-pager { display: flex; justify-content: flex-end; align-items: center; gap: 0.5rem; padding-top: 0.75rem; font-size: 0.8125rem; color: var(--ent-text-2); }
.rg-btn { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.375rem 0.75rem; border: 1px solid var(--ent-line); border-radius: 6px; background: var(--ent-surface); color: var(--ent-text); font: inherit; font-size: 0.8125rem; cursor: pointer; white-space: nowrap; }
.rg-btn.is-primary { background: var(--ent-accent); border-color: var(--ent-accent); color: #fff; }
.rg-btn:disabled { opacity: 0.6; cursor: default; }
.rg-link { border: 0; background: none; padding: 0; color: var(--ent-accent); text-decoration: underline; font: inherit; cursor: pointer; }
.rg-expand > td { padding: 0 0 0.75rem; border-top: 0; }
.rg-form, .rg-history { margin-top: 0.5rem; padding: 1rem; border: 1px solid var(--ent-line); border-radius: 8px; background: var(--ent-surface-2); }
.rg-form h3, .rg-history h3 { margin: 0 0 0.75rem; font-size: 1rem; }
.rg-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.75rem; }
.rg-grid label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8125rem; color: var(--ent-text-2); }
.rg-grid .wide { grid-column: 1 / -1; }
.rg-hits { list-style: none; margin: 0; padding: 0; border: 1px solid var(--ent-line); border-radius: 4px; background: var(--ent-surface); max-height: 12rem; overflow-y: auto; }
.rg-hits button { display: block; width: 100%; text-align: left; padding: 0.375rem 0.5rem; border: 0; background: none; font: inherit; font-size: 0.8125rem; cursor: pointer; }
.rg-hits button:hover, .rg-hits button:focus-visible { background: var(--ent-surface-2); }
.rg-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.75rem; }
.rg-history ol { margin: 0 0 0.5rem; padding-left: 1.25rem; font-size: 0.8125rem; }
.rg-history li { margin-bottom: 0.375rem; }
.rg-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
