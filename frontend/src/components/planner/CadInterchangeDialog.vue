<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ArrowLeftRight, CircleAlert, Download, FileInput, Plus, Pencil, Trash2, Move, Maximize2, Layers, X,
} from 'lucide-vue-next'
import type { PlanningArea, Lot, RoadSegment, OpenSpace, ConstraintLayer, ValidationResult } from '@/planning/planning-types'
import type { CadEntity, CadLayer } from '@/planning/cad/cadModel'
import { cadDraftFromDxfFeatures } from '@/planning/studio-dxf'
import {
  previewExportSheet,
  exportDrawingPackage,
  readImportFiles,
  parseConfirmed,
  runValidation,
  runCompare,
  expectedCrsForParcel,
  logImportReceived,
  createPendingRevision,
  markMerged,
  markRejected,
  listRevisions,
  listAudit,
  listArtifacts,
  getArtifact,
  validationReportText,
  changeReportText,
  downloadTextFile,
  recordAudit,
} from '@/planning/dxf'
import type { PreparedImport, ParsedImport } from '@/planning/dxf'
import type { CadRevisionRecord, ChangeSet, ExportDrawingSheet, ValidationReport, ArtifactRecord, InterchangeAuditEvent, MergePayload } from '@/planning/dxf/types'
import { DXF_VERSION } from '@/planning/dxf/layerRegistry'

const props = defineProps<{
  open: boolean
  projectId: string
  projectName: string
  caseId: string | null
  applicationRef: string | null
  parcelId: string | null
  parcelName: string | null
  gisRevision: number
  scaleDenom: number
  exportedBy: string
  canExport: boolean
  canImport: boolean
  planningArea: PlanningArea | null
  lots: Lot[]
  roads: RoadSegment[]
  openSpace: OpenSpace[]
  constraints: ConstraintLayer[]
  cadEntities: CadEntity[]
  cadLayers: CadLayer[]
  currentLayerId: string
  planningChecks: ValidationResult | null
  compliancePct: number
}>()

const emit = defineEmits<{
  close: []
  merge: [payload: MergePayload]
}>()

type Pane = 'export' | 'import' | 'history'
type ImportStep = 'select' | 'validate' | 'preview' | 'compare' | 'confirm' | 'blocked' | 'success'

const pane = ref<Pane>('export')
const importStep = ref<ImportStep>('select')
const busy = ref(false)
const error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const sheet = ref<ExportDrawingSheet | null>(null)
const lastExport = ref<string>('')

const prepared = ref<PreparedImport | null>(null)
const parsed = ref<ParsedImport | null>(null)
const report = ref<ValidationReport | null>(null)
const changes = ref<ChangeSet | null>(null)
const pending = ref<CadRevisionRecord | null>(null)
const confirmedEpsg = ref<string | null>(null)
const applyUnitTransform = ref(false)
const acceptUnmappedAsCad = ref(false)
const dropMissingLots = ref(false)
const postMerge = ref<{ geometry: string; topology: string; planning: string; gis: string; revision: string } | null>(null)

const revisions = ref<CadRevisionRecord[]>([])
const audit = ref<InterchangeAuditEvent[]>([])
const artifacts = ref<ArtifactRecord[]>([])

const expectedEpsg = computed(() => expectedCrsForParcel(props.planningArea))
const centroid = computed((): [number, number] => {
  const g = props.planningArea?.geom as any
  const ring = g?.coordinates?.[0]
  if (!Array.isArray(ring) || !ring.length) return [29.82, -19.48]
  const lngs = ring.map((p: number[]) => p[0])
  const lats = ring.map((p: number[]) => p[1])
  return [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2]
})

function exportCtx() {
  return {
    planningArea: props.planningArea,
    constraints: props.constraints,
    roads: props.roads,
    openSpace: props.openSpace,
    lots: props.lots,
    cadEntities: props.cadEntities,
    cadLayers: props.cadLayers,
    projectId: props.projectId,
    projectName: props.projectName,
    caseId: props.caseId,
    applicationRef: props.applicationRef,
    parcelId: props.parcelId,
    parcelName: props.parcelName,
    gisRevision: props.gisRevision,
    scaleDenom: props.scaleDenom,
    exportedBy: props.exportedBy,
  }
}

function refreshHistory() {
  revisions.value = listRevisions(props.projectId)
  audit.value = listAudit()
  void listArtifacts(props.projectId).then(r => { artifacts.value = r })
}

watch(() => props.open, (v) => {
  if (!v) return
  error.value = ''
  pane.value = 'export'
  importStep.value = 'select'
  const prev = previewExportSheet(exportCtx())
  sheet.value = 'empty' in prev ? null : prev
  if (sheet.value) {
    sheet.value.crs = expectedEpsg.value
    sheet.value.crsName = `WGS 84 / UTM (${expectedEpsg.value}) — confirmed at export from the drawing centroid`
  }
  refreshHistory()
})

async function doExport() {
  error.value = ''
  busy.value = true
  try {
    const res = await exportDrawingPackage(exportCtx())
    sheet.value = res.sheet
    lastExport.value = res.zipName
    refreshHistory()
  } catch (e: any) {
    error.value = e?.message || 'Export failed'
  } finally { busy.value = false }
}

function pickFiles() { fileInput.value?.click() }

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  if (!files.length) return
  error.value = ''
  busy.value = true
  try {
    const prep = await readImportFiles(files)
    prepared.value = prep
    parsed.value = null
    changes.value = null
    postMerge.value = null
    confirmedEpsg.value = prep.sidecar?.crs || prep.inspection.crsFromFile
    applyUnitTransform.value = false
    acceptUnmappedAsCad.value = false
    dropMissingLots.value = false
    await logImportReceived(prep, props.exportedBy, { caseId: props.caseId, parcelId: props.parcelId, projectId: props.projectId })
    await recordAudit({ at: new Date().toISOString(), actor: props.exportedBy, action: 'validation_run', detail: prep.fileName })
    importStep.value = 'validate'
    pane.value = 'import'
    runValidate()
  } catch (err: any) {
    error.value = err?.message || 'Could not read that file'
  } finally { busy.value = false }
}

function runValidate() {
  if (!prepared.value) return
  error.value = ''
  const unitsMismatch = prepared.value.inspection.insunits != null && prepared.value.inspection.insunits !== 6
  const unitsUnknown = prepared.value.inspection.insunits == null
  const canParse = !!confirmedEpsg.value && (!unitsMismatch && !unitsUnknown || applyUnitTransform.value)
  if (canParse) {
    try {
      parsed.value = parseConfirmed({
        prepared: prepared.value,
        referenceLngLat: centroid.value,
        confirmedEpsg: confirmedEpsg.value!,
        applyUnitTransform: applyUnitTransform.value,
      })
    } catch (e: any) {
      parsed.value = null
      error.value = e?.message || 'Parse failed'
    }
  } else {
    parsed.value = null
  }
  const v = runValidation({
    prepared: prepared.value,
    parsed: parsed.value,
    parcel: props.planningArea,
    expectedEpsg: expectedEpsg.value,
    confirmedEpsg: confirmedEpsg.value,
    applyUnitTransform: applyUnitTransform.value,
    acceptUnmappedAsCad: acceptUnmappedAsCad.value,
  })
  report.value = v
  if (parsed.value) {
    changes.value = runCompare({ lots: props.lots, roads: props.roads, cadEntities: props.cadEntities, parsed: parsed.value })
    pending.value = createPendingRevision({
      projectId: props.projectId,
      gisRevision: props.gisRevision,
      createdBy: props.exportedBy,
      fileName: prepared.value.fileName,
      sha256: prepared.value.sha256,
      exportId: prepared.value.sidecar?.exportId || prepared.value.inspection.exportIdFromFile,
      changes: changes.value.totals,
      validationOk: v.ok,
    })
  }
  void recordAudit({
    at: new Date().toISOString(),
    actor: props.exportedBy,
    action: v.ok ? 'validation_passed' : 'validation_failed',
    detail: v.ok ? 'Validation passed' : (v.issues.find(i => i.severity === 'block')?.title || 'Blocked'),
  })
  if (v.blocked) importStep.value = 'blocked'
  else if (importStep.value === 'blocked' || importStep.value === 'select') importStep.value = 'validate'
}

function goPreview() {
  if (!report.value || report.value.blocked || !parsed.value) { importStep.value = 'blocked'; return }
  importStep.value = 'preview'
}
function goCompare() {
  importStep.value = 'compare'
  void recordAudit({ at: new Date().toISOString(), actor: props.exportedBy, action: 'changes_reviewed', detail: pending.value?.label || '' })
}
function goConfirm() { importStep.value = 'confirm' }

async function downloadValidation() {
  if (!report.value || !prepared.value) return
  downloadTextFile(
    `validation-${prepared.value.fileName.replace(/\.dxf$/i, '')}.txt`,
    validationReportText(report.value, prepared.value.fileName),
    'text/plain',
  )
}
async function downloadChanges() {
  if (!changes.value) return
  downloadTextFile('dxf-change-report.txt', changeReportText(changes.value), 'text/plain')
}

async function downloadArtifact(id: string) {
  const a = await getArtifact(id)
  if (!a?.text) return
  downloadTextFile(a.fileName, a.text, a.kind.includes('dxf') ? 'application/dxf' : 'text/plain')
}

function applyMerge() {
  if (!parsed.value || !pending.value || !report.value || report.value.blocked) return
  const planningFeatures = [...parsed.value.lots, ...parsed.value.roads]
  const cadKeep = parsed.value.cad.filter(f => (f.properties as any)?.objectType !== 'OPEN_SPACE')
  const cadItems = cadDraftFromDxfFeatures(cadKeep as any, props.cadLayers, props.currentLayerId || 'roads')
  emit('merge', {
    planningFeatures,
    cadItems,
    openSpace: parsed.value.openSpace,
    dropMissingLots: dropMissingLots.value,
    revision: pending.value,
  })
}

function completeSuccess(gis: { ok: boolean; revision?: number; conflict?: boolean }) {
  if (!pending.value) return
  const checks = props.planningChecks?.checks || []
  const fail = checks.filter(c => !c.pass).length
  postMerge.value = {
    geometry: report.value && !report.value.geometry.invalid ? 'Valid' : 'Issues',
    topology: report.value && !report.value.geometry.selfIntersections ? 'Valid' : 'Issues',
    planning: fail ? `${fail} issue${fail === 1 ? '' : 's'}` : 'Passed',
    gis: gis.conflict ? 'Conflict (HTTP 409)' : gis.ok ? 'Successful' : 'Not saved',
    revision: gis.revision != null ? `R${String(gis.revision).padStart(2, '0')}` : pending.value.label,
  }
  void markMerged(pending.value, props.exportedBy, gis.revision ?? null)
  importStep.value = 'success'
  refreshHistory()
}

async function rejectImport() {
  if (pending.value) await markRejected(pending.value, props.exportedBy)
  importStep.value = 'select'
  prepared.value = null
  parsed.value = null
  emit('close')
}

function fmt(iso: string) {
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

defineExpose({ completeSuccess })

const steps: ImportStep[] = ['select', 'validate', 'preview', 'compare', 'confirm']
const timeline = ['Export', 'Edit in AutoCAD', 'Import', 'Validate', 'Review changes', 'Merge', 'Save revision']
</script>

<template>
  <div v-if="open" class="cadx-scrim" @click.self="emit('close')">
    <div class="cadx" role="dialog" aria-modal="true" aria-labelledby="cadx-h">
      <header class="cadx-h">
        <ArrowLeftRight :size="16" aria-hidden="true" />
        <div>
          <h2 id="cadx-h">CAD Interchange</h2>
          <p>DXF is an interchange format. PostGIS remains the system of record.</p>
        </div>
        <button class="cadx-x" type="button" aria-label="Close" @click="emit('close')"><X :size="16" /></button>
      </header>

      <ol class="cadx-tl" aria-label="Round-trip workflow">
        <li v-for="(t, i) in timeline" :key="t"><span>{{ i + 1 }}</span>{{ t }}</li>
      </ol>

      <nav class="cadx-tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="pane === 'export'" :class="{ 'is-on': pane === 'export' }" @click="pane = 'export'">Export drawing</button>
        <button type="button" role="tab" :aria-selected="pane === 'import'" :class="{ 'is-on': pane === 'import' }" @click="pane = 'import'">Import CAD drawing</button>
        <button type="button" role="tab" :aria-selected="pane === 'history'" :class="{ 'is-on': pane === 'history' }" @click="pane = 'history'; refreshHistory()">Revision history</button>
      </nav>

      <p v-if="error" class="cadx-err" role="alert"><CircleAlert :size="14" /> {{ error }}</p>

      <div class="cadx-b">
        <!-- EXPORT -->
        <div v-show="pane === 'export'">
          <p v-if="!sheet" class="cadx-note">Nothing to export. Draw or generate stands first.</p>
          <template v-else>
            <dl class="cadx-props">
              <div><dt>Case</dt><dd class="mono">{{ sheet.caseId || 'Not linked' }}</dd></div>
              <div><dt>Application</dt><dd class="mono">{{ sheet.applicationRef || '—' }}</dd></div>
              <div><dt>Parcel / stand</dt><dd>{{ sheet.parcelName || sheet.parcelId || '—' }}</dd></div>
              <div><dt>Project</dt><dd>{{ sheet.projectName }}</dd></div>
              <div><dt>Drawing revision</dt><dd class="mono">R{{ sheet.drawingRevision }}</dd></div>
              <div><dt>Current GIS revision</dt><dd class="mono">R{{ sheet.gisRevision }}</dd></div>
              <div><dt>Coordinate reference system</dt><dd class="mono">{{ sheet.crsName }}</dd></div>
              <div><dt>Units</dt><dd>metres</dd></div>
              <div><dt>Scale</dt><dd class="mono">{{ sheet.scale }}</dd></div>
              <div><dt>Export date</dt><dd class="mono">{{ fmt(sheet.exportDate) }}</dd></div>
              <div><dt>Exported by</dt><dd>{{ sheet.exportedBy }}</dd></div>
              <div><dt>DXF version</dt><dd class="mono">{{ sheet.dxfVersion || DXF_VERSION }}</dd></div>
              <div><dt>Layer count</dt><dd class="mono">{{ sheet.layerCount }}</dd></div>
              <div><dt>Object count</dt><dd class="mono">{{ sheet.objectCount }}</dd></div>
            </dl>
            <p class="cadx-note">{{ sheet.checkout.note }} Provenance is stored in a sidecar manifest, not the filename.</p>
            <p v-if="lastExport" class="cadx-ok">Package downloaded: {{ lastExport }} (ZIP with DXF + manifest, and a standalone DXF for AutoCAD).</p>
          </template>
        </div>

        <!-- IMPORT -->
        <div v-show="pane === 'import'">
          <ol class="cadx-steps">
            <li v-for="s in steps" :key="s" :class="{ 'is-on': importStep === s, 'is-done': steps.indexOf(importStep) > steps.indexOf(s) }">{{ s }}</li>
          </ol>

          <div v-if="importStep === 'select' || importStep === 'validate' || importStep === 'blocked'">
            <p class="cadx-note">Select a DXF, an export ZIP, or a DXF plus its <span class="mono">.vungu.json</span> sidecar. The live parcel is not modified until you confirm merge.</p>
            <input ref="fileInput" type="file" multiple accept=".dxf,.zip,.json,application/dxf,application/zip" class="cadx-hidden" aria-label="Select DXF or export package" @change="onFiles" />
            <button class="cadx-btn" type="button" :disabled="!canImport || busy" @click="pickFiles"><FileInput :size="14" /> Select DXF</button>
          </div>

          <div v-if="prepared && (importStep === 'validate' || importStep === 'blocked')" class="cadx-block">
            <p><strong>{{ prepared.fileName }}</strong> · {{ prepared.bytes.toLocaleString() }} bytes · {{ prepared.inspection.acadVer || 'version unknown' }}</p>
            <p v-if="prepared.inspection.xrefs.length" class="cadx-warn"><strong>EXTERNAL REFERENCES DETECTED</strong> — {{ prepared.inspection.xrefs.join(', ') }}</p>
            <label class="cadx-field">Coordinate reference system
              <select v-model="confirmedEpsg" @change="runValidate()">
                <option :value="null">Confirm CRS — do not assume</option>
                <option :value="expectedEpsg">{{ expectedEpsg }} (project)</option>
                <option value="EPSG:32735">EPSG:32735 UTM 35S</option>
                <option value="EPSG:32736">EPSG:32736 UTM 36S</option>
                <option value="EPSG:32737">EPSG:32737 UTM 37S</option>
                <option value="EPSG:32636">EPSG:32636 UTM 36N</option>
              </select>
            </label>
            <p class="cadx-note">Source units: {{ prepared.inspection.unitsLabel }}. Expected: metres.</p>
            <label v-if="prepared.inspection.insunits !== 6" class="cadx-check">
              <input type="checkbox" v-model="applyUnitTransform" @change="runValidate()" />
              Transform source units to metres
            </label>
            <label v-if="report && report.layers.unmapped.length" class="cadx-check">
              <input type="checkbox" v-model="acceptUnmappedAsCad" @change="runValidate()" />
              Accept unmapped layers as CAD annotation (they will not become GIS layers)
            </label>
            <ul v-if="report" class="cadx-issues">
              <li v-for="i in report.issues" :key="i.code" :class="'is-' + i.severity">
                <b>{{ i.title }}</b> {{ i.detail }}
              </li>
            </ul>
            <div v-if="importStep === 'blocked'" class="cadx-blocked">
              <h3>IMPORT BLOCKED</h3>
              <p>{{ report?.issues.find(i => i.severity === 'block')?.detail }}</p>
            </div>
          </div>

          <div v-if="importStep === 'preview' && changes && report" class="cadx-preview">
            <p class="cadx-note">Original vs imported. Colour is not the only signal.</p>
            <ul class="cadx-cats">
              <li class="is-exist"><Layers :size="14" /> <span>Existing</span> <b>{{ lots.length + roads.length }}</b></li>
              <li class="is-add"><Plus :size="14" /> <span>New</span> <b>{{ changes.totals.added }}</b></li>
              <li class="is-mod"><Pencil :size="14" /> <span>Modified</span> <b>{{ changes.totals.modified }}</b></li>
              <li class="is-del"><Trash2 :size="14" /> <span>Deleted</span> <b>{{ changes.totals.deleted }}</b></li>
            </ul>
          </div>

          <div v-if="importStep === 'compare' && changes">
            <p class="cadx-note">{{ changes.note }}</p>
            <ul class="cadx-chg">
              <li v-for="i in changes.added" :key="i.id" class="is-add"><Plus :size="12" /> {{ i.label }} <em>{{ i.confidence }}</em></li>
              <li v-for="i in changes.modified" :key="i.id" class="is-mod"><Pencil :size="12" /> {{ i.label }} <em>{{ i.confidence }}</em></li>
              <li v-for="i in changes.moved" :key="i.id" class="is-mod"><Move :size="12" /> {{ i.label }}</li>
              <li v-for="i in changes.resized" :key="i.id" class="is-mod"><Maximize2 :size="12" /> {{ i.label }}</li>
              <li v-for="i in changes.deleted" :key="i.id" class="is-del"><Trash2 :size="12" /> {{ i.label }}</li>
            </ul>
          </div>

          <div v-if="importStep === 'confirm' && pending && changes && report">
            <h3>You are about to merge</h3>
            <dl class="cadx-props">
              <div><dt>Case</dt><dd class="mono">{{ applicationRef || caseId || 'Not linked' }}</dd></div>
              <div><dt>Original revision</dt><dd class="mono">R{{ gisRevision }}</dd></div>
              <div><dt>Imported revision</dt><dd>{{ pending.label }} · {{ pending.status.replace('_', ' ') }}</dd></div>
              <div><dt>Changes</dt><dd>+ {{ changes.totals.added }}</dd></div>
              <div><dt>Modified</dt><dd>{{ changes.totals.modified }}</dd></div>
              <div><dt>Removed</dt><dd>{{ changes.totals.deleted }}</dd></div>
              <div><dt>Planning conflicts</dt><dd>{{ (planningChecks?.checks || []).filter(c => !c.pass).length }} (score {{ compliancePct }}/100)</dd></div>
              <div><dt>Topology errors</dt><dd>{{ report.geometry.selfIntersections }}</dd></div>
              <div><dt>CRS</dt><dd>{{ report.crs.status.toUpperCase() }}</dd></div>
              <div><dt>Units</dt><dd>{{ report.units.status.toUpperCase() }}</dd></div>
            </dl>
            <label class="cadx-check">
              <input type="checkbox" v-model="dropMissingLots" />
              Also remove stands that are not in the DXF (off by default)
            </label>
            <p v-if="report.cadastralConflict" class="cadx-warn"><strong>CAD / CADASTRAL CONFLICT</strong> — parcel identity and legal boundaries will not be overwritten.</p>
          </div>

          <div v-if="importStep === 'success' && postMerge" class="cadx-ok">
            <h3>IMPORT SUCCESSFUL</h3>
            <dl class="cadx-props">
              <div><dt>Geometry</dt><dd>{{ postMerge.geometry }}</dd></div>
              <div><dt>Topology</dt><dd>{{ postMerge.topology }}</dd></div>
              <div><dt>Planning checks</dt><dd>{{ postMerge.planning }}</dd></div>
              <div><dt>GIS save</dt><dd>{{ postMerge.gis }}</dd></div>
              <div><dt>Revision</dt><dd class="mono">{{ postMerge.revision }}</dd></div>
            </dl>
          </div>
        </div>

        <!-- HISTORY -->
        <div v-show="pane === 'history'">
          <h3>Revisions</h3>
          <ul v-if="revisions.length" class="cadx-list">
            <li v-for="r in revisions" :key="r.id">
              <b>{{ r.label }}</b>
              <span>{{ r.status.replace('_', ' ') }} · {{ r.source }} · {{ r.createdBy }} · {{ fmt(r.createdAt) }}</span>
            </li>
          </ul>
          <p v-else class="cadx-note">No CAD import revisions on this workstation yet. GIS revisions are created with Save to GIS.</p>
          <h3>Files</h3>
          <ul v-if="artifacts.length" class="cadx-list">
            <li v-for="a in artifacts" :key="a.id">
              <button type="button" class="cadx-link" :disabled="!a.text" @click="downloadArtifact(a.id)">{{ a.fileName }}</button>
              <span>{{ a.kind }} · {{ a.revisionLabel }} · {{ a.sha256.slice(0, 12) }}</span>
            </li>
          </ul>
          <h3>Audit</h3>
          <ul class="cadx-list">
            <li v-for="(e, i) in audit" :key="i"><b>{{ e.action.replace(/_/g, ' ') }}</b> <span>{{ e.actor }} · {{ fmt(e.at) }} · {{ e.detail }}</span></li>
          </ul>
        </div>
      </div>

      <footer class="cadx-f">
        <button v-if="pane === 'export'" class="cadx-btn cadx-btn--quiet" type="button" @click="emit('close')">Close</button>
        <button v-if="pane === 'export'" class="cadx-btn cadx-btn--primary" type="button" :disabled="!sheet || !canExport || busy" @click="doExport"><Download :size="14" /> Export package</button>

        <template v-if="pane === 'import'">
          <button class="cadx-btn cadx-btn--quiet" type="button" @click="importStep === 'success' ? emit('close') : rejectImport()">{{ importStep === 'success' ? 'Open in Planning Studio' : 'Cancel' }}</button>
          <button v-if="importStep === 'blocked'" class="cadx-btn" type="button" @click="downloadValidation">Download validation report</button>
          <button v-if="importStep === 'validate' && report && !report.blocked" class="cadx-btn cadx-btn--primary" type="button" @click="goPreview">Preview</button>
          <button v-if="importStep === 'preview'" class="cadx-btn cadx-btn--primary" type="button" @click="goCompare">Compare</button>
          <button v-if="importStep === 'compare'" class="cadx-btn" type="button" @click="downloadChanges">Change report</button>
          <button v-if="importStep === 'compare'" class="cadx-btn cadx-btn--primary" type="button" @click="goConfirm">Review merge</button>
          <button v-if="importStep === 'confirm'" class="cadx-btn" type="button" @click="importStep = 'compare'">Review changes</button>
          <button v-if="importStep === 'confirm'" class="cadx-btn cadx-btn--primary" type="button" @click="applyMerge">Merge revision</button>
          <button v-if="importStep === 'success'" class="cadx-btn" type="button" @click="pane = 'history'">View changes</button>
        </template>
        <button v-if="pane === 'history'" class="cadx-btn cadx-btn--primary" type="button" @click="emit('close')">Close</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.cadx-scrim { position: absolute; inset: 0; z-index: var(--ent-z-modal); display: grid; place-items: center; background: rgba(17, 29, 45, .42); padding: var(--ent-s4); }
.cadx { width: min(720px, 100%); max-height: calc(100vh - 72px); display: flex; flex-direction: column; background: var(--ent-surface); border-radius: var(--ent-r-lg); box-shadow: var(--ent-e4); overflow: hidden; color: var(--ent-text); font-family: var(--ent-font); }
.cadx-h { display: flex; align-items: flex-start; gap: var(--ent-s2); padding: var(--ent-s3) var(--ent-s4); border-bottom: 1px solid var(--ent-line); color: var(--ent-accent); }
.cadx-h h2 { margin: 0; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.cadx-h p { margin: 2px 0 0; font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
.cadx-x { margin-left: auto; border: 0; background: transparent; color: var(--ent-text-2); cursor: pointer; }
.cadx-tl { display: flex; flex-wrap: wrap; gap: 6px 10px; margin: 0; padding: 8px var(--ent-s4); list-style: none; border-bottom: 1px solid var(--ent-line); background: var(--ent-surface-2); }
.cadx-tl li { display: inline-flex; align-items: center; gap: 6px; font-size: var(--ent-fs-micro); letter-spacing: .04em; text-transform: uppercase; color: var(--ent-text-3); }
.cadx-tl span { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; background: var(--ent-accent-soft); color: var(--ent-accent); font-weight: var(--ent-fw-semibold); }
.cadx-tabs { display: flex; gap: 2px; padding: 6px var(--ent-s4) 0; border-bottom: 1px solid var(--ent-line); }
.cadx-tabs button { height: 32px; padding: 0 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--ent-text-2); font: inherit; font-size: var(--ent-fs-xs); cursor: pointer; }
.cadx-tabs button.is-on { color: var(--ent-accent); border-bottom-color: var(--ent-accent); font-weight: var(--ent-fw-semibold); }
.cadx-b { padding: var(--ent-s4); overflow-y: auto; font-size: var(--ent-fs-sm); line-height: var(--ent-lh); color: var(--ent-text-2); min-height: 220px; }
.cadx-f { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: var(--ent-s2); padding: var(--ent-s3) var(--ent-s4); background: var(--ent-surface-2); border-top: 1px solid var(--ent-line); }
.cadx-props { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin: 0 0 var(--ent-s3); }
.cadx-props dt { font-size: var(--ent-fs-micro); letter-spacing: .06em; text-transform: uppercase; color: var(--ent-text-3); }
.cadx-props dd { margin: 1px 0 0; color: var(--ent-text); }
.cadx-note { margin: 0 0 var(--ent-s3); font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
.cadx-err, .cadx-warn, .cadx-ok, .cadx-blocked { margin: 0 0 var(--ent-s3); padding: 8px 10px; border-radius: var(--ent-r); font-size: var(--ent-fs-xs); }
.cadx-err { background: color-mix(in oklch, var(--ent-danger) 12%, var(--ent-surface)); color: var(--ent-danger); display: flex; gap: 6px; align-items: flex-start; }
.cadx-warn { background: color-mix(in oklch, var(--ent-warning) 14%, var(--ent-surface)); color: var(--ent-text); }
.cadx-ok { background: color-mix(in oklch, var(--ent-success) 12%, var(--ent-surface)); color: var(--ent-text); }
.cadx-blocked h3, .cadx-ok h3 { margin: 0 0 6px; font-size: var(--ent-fs-sm); }
.cadx-btn { display: inline-flex; align-items: center; gap: 6px; height: var(--ent-control-h); padding: 0 var(--ent-s4); border-radius: var(--ent-r); border: 1px solid var(--ent-line-strong); background: var(--ent-surface); color: var(--ent-text); font: inherit; font-size: var(--ent-fs-sm); cursor: pointer; }
.cadx-btn:disabled { opacity: .45; cursor: not-allowed; }
.cadx-btn--quiet { background: transparent; }
.cadx-btn--primary { background: var(--ent-accent); border-color: var(--ent-accent); color: #fff; }
.cadx-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.cadx-field { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; font-size: var(--ent-fs-xs); }
.cadx-field select { height: 32px; border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm); background: var(--ent-surface); color: var(--ent-text); font: inherit; }
.cadx-check { display: flex; align-items: flex-start; gap: 8px; margin: 8px 0; font-size: var(--ent-fs-xs); }
.cadx-issues { margin: 8px 0; padding: 0; list-style: none; }
.cadx-issues li { padding: 4px 0; font-size: var(--ent-fs-xs); }
.cadx-issues .is-block { color: var(--ent-danger); }
.cadx-issues .is-warn { color: var(--ent-text); }
.cadx-steps { display: flex; gap: 8px; list-style: none; margin: 0 0 12px; padding: 0; text-transform: capitalize; font-size: var(--ent-fs-micro); }
.cadx-steps li { color: var(--ent-text-3); }
.cadx-steps .is-on { color: var(--ent-accent); font-weight: var(--ent-fw-semibold); }
.cadx-cats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; list-style: none; margin: 0; padding: 0; }
.cadx-cats li, .cadx-chg li { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: var(--ent-r-sm); font-size: var(--ent-fs-xs); }
.cadx-cats b { margin-left: auto; font-family: var(--ent-font-mono); }
.is-exist { background: var(--ent-surface-2); color: var(--ent-text-2); }
.is-add { background: color-mix(in oklch, #1a73e8 14%, var(--ent-surface)); color: var(--ent-text); }
.is-mod { background: color-mix(in oklch, var(--ent-warning) 16%, var(--ent-surface)); }
.is-del { background: color-mix(in oklch, var(--ent-danger) 12%, var(--ent-surface)); }
.cadx-chg { list-style: none; margin: 0; padding: 0; max-height: 240px; overflow: auto; }
.cadx-chg em { margin-left: auto; font-style: normal; color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.cadx-list { list-style: none; margin: 0 0 16px; padding: 0; }
.cadx-list li { display: flex; flex-direction: column; gap: 2px; padding: 6px 0; border-bottom: 1px solid var(--ent-line); font-size: var(--ent-fs-xs); }
.cadx-list span { color: var(--ent-text-3); }
.cadx-link { border: 0; background: none; color: var(--ent-accent); text-align: left; cursor: pointer; font: inherit; padding: 0; }
.mono { font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums; }
h3 { margin: 0 0 8px; font-size: var(--ent-fs-sm); color: var(--ent-text); font-weight: var(--ent-fw-semibold); }
</style>
