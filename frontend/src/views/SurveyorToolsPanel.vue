<script setup lang="ts">
// COGO toolkit for the Survey Console right panel (SurveyorView.vue).
// Stateless calculators (join, polar, traverse, intersection, zone
// conversion) run client-side via utils/cogo + utils/zimZones so they
// work in the field with no backend; parcels, control points and
// documents persist against the selected survey_task through the API.
//
// Bearing inputs accept DMS ("123°45'30\"", "123 45 30") or decimal
// degrees — parsed with dmsToDeg. All bearings are SOUTH azimuths
// (0° = South, clockwise), the Gauss Conform convention.
import { ref, watch } from 'vue'
import {
  surveyorApi, surveyorComputeApi, controlPointsApi,
  type CogoPoint, type CogoAreaResult, type SurveyParcel,
  type ControlPoint, type SurveyDocument,
} from '@/services/surveyor'
import { pyxToWgs84, wgs84ToPyx, ZIM_ZONES, type ZimZone } from '@/utils/zimZones'
import {
  joinYX, polarYX, dmsToDeg, degToDms, traverseBowditch, type TraverseLeg,
} from '@/utils/cogo'
import { surveyPlanDataURL } from '@/utils/surveyPlanSVG'

const props = defineProps<{
  taskId: string
  gaussLo: number
  standNumber: string | null
  suburbWard: string | null
  taskType: string
}>()

const msg = ref('')
function flash(m: string) { msg.value = m; setTimeout(() => { if (msg.value === m) msg.value = '' }, 4000) }

/** Parse a bearing field that may hold DMS or decimal degrees. */
function bearing(input: string): number | null {
  const v = dmsToDeg(input)
  return Number.isNaN(v) ? null : v
}

// ── Join (inverse): two stations → bearing + distance ───────────────
const join = ref({ y1: null as number|null, x1: null as number|null, y2: null as number|null, x2: null as number|null })
const joinResult = ref('')
function runJoin() {
  const { y1, x1, y2, x2 } = join.value
  if ([y1, x1, y2, x2].some(v => v === null)) return flash('Enter both stations fully.')
  const r = joinYX({ y: y1!, x: x1! }, { y: y2!, x: x2! })
  joinResult.value = `brg ${degToDms(r.bearingDeg)} (${r.bearingDeg.toFixed(4)}°) · dist ${r.distance.toFixed(3)} m`
}

// ── Polar: station + bearing/distance → new station ─────────────────
const polar = ref({ y: null as number|null, x: null as number|null, distance: null as number|null, bearingStr: '' })
const polarResult = ref('')
function runPolar() {
  const { y, x, distance, bearingStr } = polar.value
  const brg = bearing(bearingStr)
  if (y === null || x === null || distance === null) return flash('Enter Y, X and distance.')
  if (brg === null) return flash('Bearing not understood — use 123°45\'30", 123 45 30 or decimal.')
  const p = polarYX({ y, x }, brg, distance)
  polarResult.value = `Q = Y ${p.y.toFixed(3)}, X ${p.x.toFixed(3)}`
}

// ── Traverse (Bowditch) ──────────────────────────────────────────────
interface LegRow { bearingStr: string; distance: number | null }
const trav = ref({ y: null as number|null, x: null as number|null })
const travLegs = ref<LegRow[]>([{ bearingStr: '', distance: null }, { bearingStr: '', distance: null }])
const travResult = ref<ReturnType<typeof traverseBowditch> | null>(null)
function addLeg() { travLegs.value.push({ bearingStr: '', distance: null }) }
function removeLeg(i: number) { if (travLegs.value.length > 1) travLegs.value.splice(i, 1) }
function runTraverse() {
  if (trav.value.y === null || trav.value.x === null) return flash('Enter the start station.')
  const legs: TraverseLeg[] = []
  for (const [i, row] of travLegs.value.entries()) {
    const brg = bearing(row.bearingStr)
    if (brg === null || row.distance === null) return flash(`Leg ${i + 1} is incomplete.`)
    legs.push({ bearingDeg: brg, distance: row.distance })
  }
  travResult.value = traverseBowditch({ y: trav.value.y, x: trav.value.x }, legs)
}

// ── Zone converter (stateless) ─────────────────────────────────────
const zc = ref<{ y: number|null; x: number|null; lng: number|null; lat: number|null; zone: ZimZone }>({
  y: null, x: null, lng: null, lat: null, zone: 31,
})
const zcResult = ref<string>('')
function zcToWgs84() {
  if (zc.value.y === null || zc.value.x === null) return flash('Enter Y and X.')
  const r = pyxToWgs84(zc.value.y, zc.value.x, zc.value.zone)
  zcResult.value = `lng ${r.lng.toFixed(6)}, lat ${r.lat.toFixed(6)}`
}
function zcToPyx() {
  if (zc.value.lng === null || zc.value.lat === null) return flash('Enter longitude and latitude.')
  const r = wgs84ToPyx(zc.value.lng, zc.value.lat, zc.value.zone)
  zcResult.value = `Y ${r.y.toFixed(3)}, X ${r.x.toFixed(3)}`
}

// ── Bearing-bearing intersection (server-side) ──────────────────────
const inter = ref({
  p1: { y: null as number|null, x: null as number|null, bearingStr: '' },
  p2: { y: null as number|null, x: null as number|null, bearingStr: '' },
})
const interResult = ref('')
async function runIntersection() {
  const { p1, p2 } = inter.value
  const b1 = bearing(p1.bearingStr)
  const b2 = bearing(p2.bearingStr)
  if ([p1.y, p1.x, p2.y, p2.x].some(v => v === null) || b1 === null || b2 === null) return flash('Enter both rays fully.')
  try {
    const p = await surveyorComputeApi.bearingBearingIntersection(
      { y: p1.y!, x: p1.x!, bearingDeg: b1 },
      { y: p2.y!, x: p2.x!, bearingDeg: b2 },
    )
    interResult.value = `Y ${p.y.toFixed(3)}, X ${p.x.toFixed(3)}`
  } catch { flash('Rays do not intersect.') }
}

// ── Parcel area & closure → save against the task ──────────────────
const areaPoints = ref<Array<{ y: number|null; x: number|null }>>([
  { y: null, x: null }, { y: null, x: null }, { y: null, x: null },
])
const areaResult = ref<CogoAreaResult | null>(null)
function addAreaPoint() { areaPoints.value.push({ y: null, x: null }) }
function removeAreaPoint(i: number) { if (areaPoints.value.length > 3) areaPoints.value.splice(i, 1) }
async function runArea() {
  const pts = areaPoints.value
  if (pts.some(p => p.y === null || p.x === null)) return flash('Enter Y and X for every corner.')
  try {
    areaResult.value = await surveyorComputeApi.area(pts as CogoPoint[])
  } catch { flash('Area calculation failed.') }
}
async function saveAreaAsParcel() {
  if (!props.taskId) return flash('Select a task first to save a parcel.')
  if (!areaResult.value) return flash('Calculate the area first.')
  try {
    const saved = await surveyorApi.addParcel(props.taskId, areaPoints.value as CogoPoint[])
    parcels.value = [saved, ...parcels.value]
    flash('Parcel saved to task.')
  } catch { flash('Failed to save parcel.') }
}

// ── Parcels list + plan preview + QGIS export ──────────────────────
const parcels = ref<SurveyParcel[]>([])
async function previewParcelPlan(parcel: SurveyParcel) {
  try {
    const result = await surveyorComputeApi.area(parcel.points)
    const url = surveyPlanDataURL({
      standNumber: props.standNumber, ward: props.suburbWard, taskType: props.taskType,
      points: parcel.points, edges: result.edges,
      areaM2: parcel.area_m2, perimeterM: parcel.perimeter_m,
      closureErrorM: parcel.closure_error_m, closureRatio: parcel.closure_ratio, status: parcel.status,
    })
    window.open(url, '_blank')
  } catch { flash('Failed to generate plan preview.') }
}
function exportParcelGeoJSON(parcel: SurveyParcel) {
  const ring = parcel.points.map(p => {
    const { lng, lat } = pyxToWgs84(p.y, p.x, (props.gaussLo || 31) as ZimZone)
    return [lng, lat]
  })
  ring.push(ring[0])
  const geojson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {
        survey_task_id: parcel.survey_task_id, area_m2: parcel.area_m2,
        perimeter_m: parcel.perimeter_m, closure_error_m: parcel.closure_error_m,
        closure_ratio: parcel.closure_ratio, status: parcel.status,
      },
    }],
  }
  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `parcel-${parcel.id.slice(0, 8)}.geojson`; a.click()
  URL.revokeObjectURL(url)
}

// ── Reference control points ───────────────────────────────────────
const jobControlPoints = ref<ControlPoint[]>([])
const allControlPoints = ref<ControlPoint[]>([])
const cpToAttach = ref<number | null>(null)
async function loadAllControlPoints() {
  try { allControlPoints.value = await controlPointsApi.list() } catch { /* non-fatal */ }
}
async function attachCp() {
  if (!props.taskId) return flash('Select a task first.')
  if (cpToAttach.value == null) return
  try {
    await surveyorApi.attachControlPoint(props.taskId, cpToAttach.value)
    jobControlPoints.value = await surveyorApi.listJobControlPoints(props.taskId)
    cpToAttach.value = null
  } catch { flash('Failed to attach control point.') }
}

// ── Documents (DSG certificate / Report on Survey) ─────────────────
const documents = ref<SurveyDocument[]>([])
const docForm = ref({ surveyOf: '', certification: '', district: '', assistantSurveyor: '', purpose: '' })
function jobHeaderHtml() {
  return `<h1>Survey Task: ${props.standNumber || props.taskType} — ${props.suburbWard || ''}</h1>
    <p><b>Zone:</b> Lo${props.gaussLo || 31} &nbsp; <b>Date:</b> ${new Date().toLocaleDateString()}</p>`
}
function openDoc(title: string, body: string) {
  const html = `<!DOCTYPE html><html><head><title>${title}</title><style>
    body{font-family:Georgia,serif;max-width:40rem;margin:2rem auto;line-height:1.6;color:#0f172a}
    h1{font-size:1.1rem} h2{font-size:0.95rem;margin-top:1.5rem}</style></head><body>${body}</body></html>`
  window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank')
}
async function genDsg() {
  if (!props.taskId) return flash('Select a task first.')
  const title = `DSG Certificate — ${props.standNumber || ''}`
  const body = `${jobHeaderHtml()}<h2>Survey Of</h2><div>${docForm.value.surveyOf || '—'}</div>
    <h2>Certification</h2><div>${docForm.value.certification || '—'}</div>`
  try {
    const saved = await surveyorApi.addDocument(props.taskId, { doc_type: 'dsg_certificate', title, content: body })
    documents.value = [saved, ...documents.value]; openDoc(title, body)
  } catch { flash('Failed to save certificate.') }
}
async function genRos() {
  if (!props.taskId) return flash('Select a task first.')
  const title = `Report on Survey — ${props.standNumber || ''}`
  const body = `${jobHeaderHtml()}<h2>1. Purpose of Survey</h2><div>${docForm.value.purpose || '—'}</div>
    <h2>Project Details</h2><div><b>District:</b> ${docForm.value.district || '—'}</div>
    <div><b>Assistant Surveyor:</b> ${docForm.value.assistantSurveyor || 'N/A'}</div>`
  try {
    const saved = await surveyorApi.addDocument(props.taskId, { doc_type: 'report_on_survey', title, content: body })
    documents.value = [saved, ...documents.value]; openDoc(title, body)
  } catch { flash('Failed to save report.') }
}
function reopenDoc(d: SurveyDocument) {
  openDoc(d.title, d.content)
}

// ── Load task-scoped data when the selected task changes ───────────
async function loadTaskData(id: string) {
  areaResult.value = null
  parcels.value = []; jobControlPoints.value = []; documents.value = []
  if (!id) return
  try {
    const [p, cp, docs] = await Promise.all([
      surveyorApi.listParcels(id), surveyorApi.listJobControlPoints(id), surveyorApi.listDocuments(id),
    ])
    parcels.value = p; jobControlPoints.value = cp; documents.value = docs
  } catch { /* individual flashes elsewhere */ }
}
watch(() => props.taskId, (id) => loadTaskData(id), { immediate: true })
loadAllControlPoints()
</script>

<template>
  <div class="tp">
    <p v-if="msg" class="tp-msg">{{ msg }}</p>
    <p class="tp-convention">South azimuth · 0° = South, clockwise · P(Y westing, X southing) · bearings accept DMS or decimal</p>

    <details open>
      <summary>Join — inverse (P, Q → bearing + distance)</summary>
      <div class="tp-grid">
        <label>P: Y<input type="number" step="0.001" v-model.number="join.y1" /></label>
        <label>P: X<input type="number" step="0.001" v-model.number="join.x1" /></label>
        <label>Q: Y<input type="number" step="0.001" v-model.number="join.y2" /></label>
        <label>Q: X<input type="number" step="0.001" v-model.number="join.x2" /></label>
      </div>
      <div class="tp-actions"><button class="tp-btn primary" @click="runJoin">Compute join</button></div>
      <div v-if="joinResult" class="tp-result">{{ joinResult }}</div>
    </details>

    <details>
      <summary>Polar — forward (P + bearing/distance → Q)</summary>
      <div class="tp-grid">
        <label>Y<input type="number" step="0.001" v-model.number="polar.y" /></label>
        <label>X<input type="number" step="0.001" v-model.number="polar.x" /></label>
        <label>Distance (m)<input type="number" step="0.001" v-model.number="polar.distance" /></label>
        <label>Bearing<input type="text" v-model="polar.bearingStr" placeholder="123°45'30&quot; or 123.7583" /></label>
      </div>
      <div class="tp-actions"><button class="tp-btn primary" @click="runPolar">Calculate Q</button></div>
      <div v-if="polarResult" class="tp-result">{{ polarResult }}</div>
    </details>

    <details>
      <summary>Traverse — Bowditch adjustment</summary>
      <p class="tp-hint">Closed loop: legs return to the start. The misclosure is distributed by cumulative distance (compass rule).</p>
      <div class="tp-grid">
        <label>Start Y<input type="number" step="0.001" v-model.number="trav.y" /></label>
        <label>Start X<input type="number" step="0.001" v-model.number="trav.x" /></label>
      </div>
      <table class="tp-pts">
        <thead><tr><th>Leg</th><th>Bearing</th><th>Dist (m)</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(leg, i) in travLegs" :key="i">
            <td>{{ i + 1 }}</td>
            <td><input type="text" v-model="leg.bearingStr" placeholder="D°MM'SS&quot;" /></td>
            <td><input type="number" step="0.001" v-model.number="leg.distance" /></td>
            <td><button v-if="travLegs.length > 1" class="tp-x" @click="removeLeg(i)">×</button></td>
          </tr>
        </tbody>
      </table>
      <div class="tp-actions">
        <button class="tp-btn" @click="addLeg">+ Leg</button>
        <button class="tp-btn primary" @click="runTraverse">Run traverse</button>
      </div>
      <div v-if="travResult" class="tp-result">
        <div>misclosure {{ travResult.misclosure.linear.toFixed(3) }} m over {{ travResult.misclosure.totalDistance.toFixed(2) }} m — precision {{ travResult.misclosure.ratioFormatted }}</div>
        <table class="tp-out">
          <thead><tr><th>Stn</th><th>Y (adj)</th><th>X (adj)</th></tr></thead>
          <tbody>
            <tr v-for="s in travResult.adjusted" :key="s.index">
              <td>{{ s.index }}</td><td>{{ s.y.toFixed(3) }}</td><td>{{ s.x.toFixed(3) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>

    <details>
      <summary>Zone converter (P(Y,X) ↔ WGS84)</summary>
      <div class="tp-grid">
        <label>Zone
          <select v-model.number="zc.zone">
            <option v-for="z in ZIM_ZONES" :key="z" :value="z">Lo{{ z }}</option>
          </select>
        </label>
        <label>Y (westing)<input type="number" step="0.01" v-model.number="zc.y" /></label>
        <label>X (southing)<input type="number" step="0.01" v-model.number="zc.x" /></label>
        <label>Longitude<input type="number" step="0.000001" v-model.number="zc.lng" /></label>
        <label>Latitude<input type="number" step="0.000001" v-model.number="zc.lat" /></label>
      </div>
      <div class="tp-actions">
        <button class="tp-btn" @click="zcToWgs84">Y,X → lng,lat</button>
        <button class="tp-btn primary" @click="zcToPyx">lng,lat → Y,X</button>
      </div>
      <div v-if="zcResult" class="tp-result">{{ zcResult }}</div>
    </details>

    <details>
      <summary>Bearing–bearing intersection</summary>
      <div class="tp-grid">
        <label>Ray 1 Y<input type="number" step="0.01" v-model.number="inter.p1.y" /></label>
        <label>Ray 1 X<input type="number" step="0.01" v-model.number="inter.p1.x" /></label>
        <label class="tp-span">Ray 1 bearing<input type="text" v-model="inter.p1.bearingStr" placeholder="D°MM'SS&quot; or decimal" /></label>
        <label>Ray 2 Y<input type="number" step="0.01" v-model.number="inter.p2.y" /></label>
        <label>Ray 2 X<input type="number" step="0.01" v-model.number="inter.p2.x" /></label>
        <label class="tp-span">Ray 2 bearing<input type="text" v-model="inter.p2.bearingStr" placeholder="D°MM'SS&quot; or decimal" /></label>
      </div>
      <div class="tp-actions"><button class="tp-btn primary" @click="runIntersection">Find intersection</button></div>
      <div v-if="interResult" class="tp-result">{{ interResult }}</div>
    </details>

    <details>
      <summary>Parcel area & closure</summary>
      <table class="tp-pts">
        <thead><tr><th>#</th><th>Y</th><th>X</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(p, i) in areaPoints" :key="i">
            <td>{{ i + 1 }}</td>
            <td><input type="number" step="0.01" v-model.number="p.y" /></td>
            <td><input type="number" step="0.01" v-model.number="p.x" /></td>
            <td><button v-if="areaPoints.length > 3" class="tp-x" @click="removeAreaPoint(i)">×</button></td>
          </tr>
        </tbody>
      </table>
      <div class="tp-actions">
        <button class="tp-btn" @click="addAreaPoint">+ Corner</button>
        <button class="tp-btn primary" @click="runArea">Calculate</button>
      </div>
      <div v-if="areaResult" class="tp-result">
        {{ areaResult.area.display.unit === 'ha' ? areaResult.area.display.hectares + ' ha' : areaResult.area.display.square_meters + ' m²' }}
        · perim {{ areaResult.closure.perimeter.toFixed(2) }}m · closure {{ areaResult.closure.error.toFixed(3) }}m ({{ areaResult.closure.ratioFormatted }})
        <button class="tp-btn primary tp-block" @click="saveAreaAsParcel">Save as parcel on this task</button>
      </div>
    </details>

    <details>
      <summary>Parcels on this task ({{ parcels.length }})</summary>
      <div v-if="!parcels.length" class="tp-hint">No parcels yet — capture one above.</div>
      <div v-for="p in parcels" :key="p.id" class="tp-parcel">
        <div>{{ p.area_m2.toFixed(0) }} m² · closure {{ p.closure_error_m.toFixed(3) }}m · {{ p.status }}</div>
        <div class="tp-actions">
          <button class="tp-btn" @click="previewParcelPlan(p)">Plan</button>
          <button class="tp-btn" @click="exportParcelGeoJSON(p)">QGIS</button>
        </div>
      </div>
    </details>

    <details>
      <summary>Reference control points ({{ jobControlPoints.length }})</summary>
      <div class="tp-actions">
        <select v-model.number="cpToAttach" class="tp-grow">
          <option :value="null">Attach monument…</option>
          <option v-for="cp in allControlPoints" :key="cp.id" :value="cp.id">{{ cp.monu_num }} — {{ cp.monu_name }}</option>
        </select>
        <button class="tp-btn" :disabled="cpToAttach == null" @click="attachCp">Attach</button>
      </div>
      <p v-if="jobControlPoints.length" class="tp-chips">
        <span v-for="cp in jobControlPoints" :key="cp.id" class="tp-chip">{{ cp.monu_num }}</span>
      </p>
    </details>

    <details>
      <summary>DSG Certificate / Report on Survey</summary>
      <label class="tp-full">Survey of (DSG)<textarea v-model="docForm.surveyOf" rows="2"></textarea></label>
      <label class="tp-full">Certification (DSG)<textarea v-model="docForm.certification" rows="2"></textarea></label>
      <label class="tp-full">District (RoS)<input v-model="docForm.district" /></label>
      <label class="tp-full">Assistant surveyor (RoS)<input v-model="docForm.assistantSurveyor" /></label>
      <label class="tp-full">Purpose of survey (RoS)<textarea v-model="docForm.purpose" rows="2"></textarea></label>
      <div class="tp-actions">
        <button class="tp-btn" @click="genDsg">DSG Certificate</button>
        <button class="tp-btn primary" @click="genRos">Report on Survey</button>
      </div>
      <div v-for="d in documents" :key="d.id" class="tp-parcel">
        <div>{{ d.doc_type === 'dsg_certificate' ? 'DSG Certificate' : 'Report on Survey' }}</div>
        <button class="tp-btn" @click="reopenDoc(d)">Open</button>
      </div>
    </details>
  </div>
</template>

<style scoped>
/* Instrument-dark styling; tokens mirror SurveyorView.vue. */
.tp {
  --tp-raised: #1a212b;
  --tp-line: #242e3a;
  --tp-line-soft: #1d2530;
  --tp-text: #dbe4ee;
  --tp-dim: #8b98a9;
  --tp-faint: #5c6875;
  --tp-amber: #f0b24a;
  --tp-amber-dim: rgba(240, 178, 74, 0.14);
  --tp-mono: 'Geist Mono', ui-monospace, SFMono-Regular, monospace;
  display: flex; flex-direction: column; gap: 0.5rem; color: var(--tp-text);
}
.tp-msg { margin: 0; padding: 0.4rem 0.6rem; background: var(--tp-amber-dim); color: var(--tp-amber); border: 1px solid rgba(240,178,74,.3); border-radius: 0.35rem; font-size: 0.68rem; }
.tp-convention { margin: 0; font-size: 0.58rem; color: var(--tp-faint); font-family: var(--tp-mono); letter-spacing: 0.02em; }
details { border: 1px solid var(--tp-line); border-radius: 0.5rem; overflow: hidden; background: var(--tp-raised); }
summary {
  padding: 0.45rem 0.7rem; background: var(--tp-line-soft); font-size: 0.64rem; font-weight: 700;
  cursor: pointer; text-transform: uppercase; letter-spacing: 0.06em; color: var(--tp-dim);
}
summary:hover { color: var(--tp-text); }
details[open] summary { border-bottom: 1px solid var(--tp-line); color: var(--tp-amber); }
.tp-hint { margin: 0.4rem 0.7rem; font-size: 0.62rem; color: var(--tp-faint); }
.tp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; padding: 0.5rem 0.7rem; }
.tp-span { grid-column: span 2; }
.tp-grid label, .tp-full { display: flex; flex-direction: column; gap: 0.15rem; font-size: 0.6rem; color: var(--tp-dim); }
.tp-full { padding: 0.35rem 0.7rem; }
.tp-grid input, .tp-grid select, .tp-full input, .tp-full textarea, .tp-full select {
  padding: 0.3rem 0.4rem; border: 1px solid var(--tp-line); border-radius: 0.3rem; font-size: 0.7rem;
  font-family: var(--tp-mono); background: #10151b; color: var(--tp-text);
}
.tp-grid input:focus, .tp-grid select:focus, .tp-full input:focus, .tp-full textarea:focus { outline: none; border-color: var(--tp-amber); }
.tp-actions { display: flex; gap: 0.3rem; padding: 0.4rem 0.7rem; flex-wrap: wrap; align-items: center; }
.tp-btn {
  padding: 0.35rem 0.6rem; border: 1px solid var(--tp-line); border-radius: 0.3rem;
  background: var(--tp-raised); color: var(--tp-text); font-size: 0.66rem; cursor: pointer;
}
.tp-btn:hover { border-color: var(--tp-faint); }
.tp-btn.primary { background: var(--tp-amber); color: #10151b; border-color: var(--tp-amber); font-weight: 600; }
.tp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.tp-btn.tp-block { display: block; width: 100%; margin-top: 0.4rem; }
.tp-grow { flex: 1; min-width: 0; padding: 0.3rem 0.4rem; border: 1px solid var(--tp-line); border-radius: 0.3rem; font-size: 0.66rem; background: #10151b; color: var(--tp-text); }
.tp-result {
  margin: 0 0.7rem 0.5rem; padding: 0.4rem 0.55rem; background: #0b0f14;
  border-left: 3px solid var(--tp-amber); border-radius: 0.3rem; font-size: 0.68rem;
  font-family: var(--tp-mono); color: var(--tp-amber); overflow-x: auto;
}
.tp-pts, .tp-out { width: 100%; border-collapse: collapse; font-size: 0.66rem; }
.tp-pts th, .tp-pts td, .tp-out th, .tp-out td { padding: 0.2rem 0.3rem; text-align: left; }
.tp-pts { padding: 0 0.7rem; }
.tp-pts th, .tp-out th { color: var(--tp-faint); font-weight: 600; font-size: 0.56rem; text-transform: uppercase; letter-spacing: 0.06em; }
.tp-pts input { width: 100%; padding: 0.2rem 0.3rem; border: 1px solid var(--tp-line); border-radius: 0.25rem; font-size: 0.66rem; font-family: var(--tp-mono); background: #10151b; color: var(--tp-text); box-sizing: border-box; }
.tp-pts input:focus { outline: none; border-color: var(--tp-amber); }
.tp-out { margin-top: 0.3rem; }
.tp-out td { font-family: var(--tp-mono); }
.tp-x { border: none; background: none; color: #e5534b; cursor: pointer; font-size: 0.9rem; }
.tp-parcel { display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; padding: 0.35rem 0.7rem; border-top: 1px solid var(--tp-line-soft); font-size: 0.66rem; }
.tp-chips { display: flex; flex-wrap: wrap; gap: 0.25rem; padding: 0 0.7rem 0.5rem; }
.tp-chip { font-size: 0.6rem; font-family: var(--tp-mono); font-weight: 700; color: var(--tp-amber); background: var(--tp-amber-dim); padding: 0.15rem 0.4rem; border-radius: 0.25rem; }
</style>
