<script setup lang="ts">
// GisSymbologyRegistryView — the GIS officer's control surface for the
// enterprise symbology registry.
//
// Answers, for every governed layer: which style is active, where it came from,
// who approved it, when it was published, and how faithfully the web reproduces
// the authored QGIS cartography. Publishing runs the full lifecycle
// (draft -> review -> approved -> published) with a diff before the decision and
// rollback after it.
//
// TWO COLOUR SYSTEMS, KEPT APART:
//   * the interface chrome uses --ent-* design tokens only
//   * every cartographic swatch shown comes from a PUBLISHED style document
// A swatch is data here, never decoration — there is no hard-coded GIS colour
// anywhere in this file.
import { ref, computed, onMounted } from 'vue'
import {
  Layers, GitBranch, ShieldCheck, History, RotateCcw, Download,
  DownloadCloud, AlertTriangle, CircleCheck, Database, Palette, RefreshCw,
  Pencil, UploadCloud, Save, X,
} from 'lucide-vue-next'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import {
  getGovernedLayers, getStyleVersions, getStyleAudit, getStyleDiff,
  getQgisCandidates, getFidelityReport, importStyleFromQgis, transitionStyle,
  rollbackStyle, qmlDownloadUrl, createStyleDraft, pushStyleToQgis,
  type GovernedLayer, type StyleVersionSummary, type StyleDiff,
  type FidelityReport, type QgisCandidates, type LifecycleVerb,
} from '@/services/gisStyles'

type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'negative'

const layers = ref<GovernedLayer[]>([])
const selected = ref<string | null>(null)
const versions = ref<StyleVersionSummary[]>([])
const audit = ref<any[]>([])
const diff = ref<StyleDiff | null>(null)
const candidates = ref<QgisCandidates | null>(null)
const report = ref<FidelityReport | null>(null)

const loading = ref(true)
const busy = ref(false)
const notice = ref<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null)

// ── Presentation lookups ───────────────────────────────────────────────────
const STATUS_TONE: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  review: { tone: 'info', label: 'In review' },
  approved: { tone: 'info', label: 'Approved' },
  published: { tone: 'positive', label: 'Published' },
  deprecated: { tone: 'warning', label: 'Deprecated' },
  archived: { tone: 'neutral', label: 'Archived' },
}
const statusOf = (s: string) => STATUS_TONE[s] ?? { tone: 'neutral' as Tone, label: s }

// Fidelity is a technical classification, not a pass/fail grade: `converted`
// and `server` are correct outcomes for symbology MapLibre cannot draw natively.
const FIDELITY_NOTE: Record<string, string> = {
  direct: 'MapLibre paint properties express this exactly.',
  converted: 'Expressible after a documented transformation.',
  server: 'Rasterised by QGIS Server so it looks right.',
  unsupported: 'Cannot render faithfully; blocked from publication.',
}
const FIDELITY_TONE: Record<string, Tone> = {
  direct: 'positive', converted: 'info', server: 'warning', unsupported: 'negative',
}

const SOURCE_LABEL: Record<string, string> = {
  qgis: 'QGIS project',
  statutory_schedule: 'Statutory schedule',
  manual: 'Manual',
  imported_sld: 'SLD import',
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')
const short = (sum: string | null) => (sum ? sum.replace(/^sha256:/, '').slice(0, 12) : '—')

const current = computed(() => layers.value.find((l) => l.layer_id === selected.value) ?? null)
const unstyled = computed(() => layers.value.filter((l) => !l.style_id))
const publishedVersion = computed(() => versions.value.find((v) => v.status === 'published') ?? null)

/** Cartographic swatches for a version, read from its style document. */
function swatchesOf(definition: any): Array<{ label: string; color: string }> {
  const r = definition?.renderer
  if (!r) return []
  const pick = (sym: any) => sym?.fill ?? sym?.stroke ?? null
  if (r.type === 'single') {
    const c = pick(r.symbol)
    return c ? [{ label: 'All features', color: c }] : []
  }
  const entries = (r.categories ?? r.ranges ?? r.rules ?? []) as any[]
  return entries
    .map((e) => ({
      label: String(e.label ?? e.value ?? `${e.lower}–${e.upper}`),
      color: pick(e.symbol),
    }))
    .filter((e): e is { label: string; color: string } => Boolean(e.color))
}

/**
 * Turns a failed registry call into an honest diagnosis.
 *
 * A 404 on /api/gis/* means the endpoint is not mounted — almost always a
 * backend still running from before the symbology routes were registered. The
 * first version of this view reported every failure as "sign in as an
 * administrator", which misdiagnosed exactly that case for a signed-in GIS
 * officer. Distinguish the causes rather than guessing at one.
 */
function explain(e: any, what: string): string {
  const status = e?.response?.status
  if (status === 404) {
    return `${what}: the /api/gis endpoints are not mounted (404). The backend is `
      + 'likely running from before the symbology registry was added — restart it '
      + '(cd ../app-backend && npm run dev).'
  }
  if (status === 401) return `${what}: your session has expired — sign in again.`
  if (status === 403) {
    return `${what}: your role may not view the registry. Publishing is limited to `
      + 'administrators and GIS officers.'
  }
  if (status >= 500) return `${what}: the server failed (${status}). Check the backend log.`
  return `${what}: ${e?.message || 'the request failed'}.`
}

// ── Loading ────────────────────────────────────────────────────────────────
async function loadCatalogue() {
  loading.value = true
  try {
    layers.value = await getGovernedLayers(true)
    if (!layers.value.length) {
      notice.value = {
        tone: 'warn',
        text: 'The registry has no governed layers yet. Seed it from the two authoring '
          + 'sources: npm run gis:symbology:seed (report first with gis:symbology:report).',
      }
    }
  } catch (e) {
    notice.value = { tone: 'err', text: explain(e, 'Could not load the layer catalogue') }
  } finally {
    loading.value = false
  }
  if (!selected.value && layers.value.length) await select(layers.value[0].layer_id)
}

async function select(layerId: string) {
  selected.value = layerId
  diff.value = null
  candidates.value = null
  notice.value = null
  const [v, a] = await Promise.all([
    getStyleVersions(layerId).catch(() => []),
    getStyleAudit(layerId, 40).catch(() => []),
  ])
  versions.value = v
  audit.value = a
}

async function loadReport() {
  try {
    report.value = await getFidelityReport()
  } catch (e) {
    // Only report this if the catalogue call has not already said the same thing
    // — two banners for one restart is noise.
    if (!notice.value) {
      notice.value = { tone: 'err', text: explain(e, 'Fidelity report unavailable') }
    }
  }
}

async function loadCandidates() {
  if (!selected.value) return
  try {
    candidates.value = await getQgisCandidates(selected.value)
  } catch {
    notice.value = { tone: 'err', text: 'Could not read the QGIS authoring sources for this layer.' }
  }
}

async function showDiff(from: number, to: number) {
  if (!selected.value) return
  try {
    diff.value = await getStyleDiff(selected.value, from, to)
  } catch {
    notice.value = { tone: 'err', text: `Could not compare v${from} with v${to}.` }
  }
}

// ── Editing ────────────────────────────────────────────────────────────────
// A GIS officer can author a change here instead of in QGIS Desktop. Saving does
// NOT alter the live style — published versions are immutable — it creates a new
// DRAFT that still has to be submitted, approved and published. `source` is
// recorded as `manual` so the provenance of a web-authored change is visible
// next to the QGIS-authored ones.
interface EditRow {
  /** Path back into the document: category index, or -1 for a single symbol. */
  index: number
  label: string
  fill: string
  strokeWidth: number
}

const editing = ref(false)
const editRows = ref<EditRow[]>([])
const editOpacity = ref(1)
const editSummary = ref('')
const pushReport = ref<Awaited<ReturnType<typeof pushStyleToQgis>>['data'] | null>(null)

/** Colour inputs need #rrggbb; a line symbol carries its colour in `stroke`. */
const colourOf = (sym: any): string => sym?.fill ?? sym?.stroke ?? '#cccccc'

function startEdit() {
  const source = peekDefinition()
  if (!source) {
    notice.value = { tone: 'err', text: 'No published style to edit for this layer.' }
    return
  }
  const r = source.renderer
  editOpacity.value = Number(source.opacity ?? 1)
  editRows.value = r.type === 'single'
    ? [{ index: -1, label: 'All features', fill: colourOf(r.symbol), strokeWidth: Number(r.symbol?.strokeWidth ?? 0.26) }]
    : (r.categories ?? []).map((c: any, i: number) => ({
        index: i,
        label: String(c.label ?? c.value),
        fill: colourOf(c.symbol),
        strokeWidth: Number(c.symbol?.strokeWidth ?? 0.26),
      }))
  editSummary.value = ''
  editing.value = true
}

/** The published definition for the selected layer, from the versions list. */
function peekDefinition(): any {
  const v = versions.value.find((x) => x.status === 'published') as any
  return v?.definition ?? null
}

function cancelEdit() {
  editing.value = false
  editRows.value = []
}

/** Applies the edits onto a copy of the published document. */
function editedDefinition(): any {
  const base = JSON.parse(JSON.stringify(peekDefinition()))
  base.opacity = Number(editOpacity.value)
  const r = base.renderer
  const put = (sym: any, row: EditRow) => {
    // Write the colour back to whichever field the symbol actually uses, so a
    // line symbol does not silently gain a meaningless `fill`.
    if (sym.kind === 'line') sym.stroke = row.fill
    else sym.fill = row.fill
    sym.strokeWidth = Number(row.strokeWidth)
  }
  for (const row of editRows.value) {
    if (row.index === -1) put(r.symbol, row)
    else if (r.categories?.[row.index]) put(r.categories[row.index].symbol, row)
  }
  return base
}

const editChanged = computed(() => {
  const def = peekDefinition()
  if (!def || !editing.value) return false
  if (Number(def.opacity ?? 1) !== Number(editOpacity.value)) return true
  const r = def.renderer
  return editRows.value.some((row) => {
    const sym = row.index === -1 ? r.symbol : r.categories?.[row.index]?.symbol
    return !sym || colourOf(sym) !== row.fill
      || Number(sym.strokeWidth ?? 0.26) !== Number(row.strokeWidth)
  })
})

// ── Write actions ──────────────────────────────────────────────────────────
async function run(fn: () => Promise<{ message: string }>) {
  if (!selected.value) return
  busy.value = true
  notice.value = null
  try {
    const { message } = await fn()
    notice.value = { tone: 'ok', text: message }
    await Promise.all([select(selected.value), loadCatalogue()])
  } catch (e: any) {
    notice.value = {
      tone: 'err',
      text: e?.response?.data?.message || e?.message || 'The registry rejected that operation.',
    }
  } finally {
    busy.value = false
  }
}

const importFromQgis = () => run(
  () => importStyleFromQgis(selected.value!, 'Re-imported from the QGIS project'),
)
const advance = (version: number, verb: LifecycleVerb) => run(
  () => transitionStyle(selected.value!, version, verb),
)
const doRollback = (toVersion: number) => run(
  () => rollbackStyle(selected.value!, toVersion, `Rolled back to v${toVersion} from the GIS admin area`),
)

/** Saves the edits as a new DRAFT. The live style is untouched. */
async function saveEdit() {
  if (!selected.value || !editChanged.value) return
  const definition = editedDefinition()
  const summary = editSummary.value.trim()
    || 'Edited in the GIS admin console (colour / stroke width)'
  await run(async () => {
    const r = await createStyleDraft(selected.value!, definition, {
      source: 'manual',
      changeSummary: summary,
    })
    editing.value = false
    editRows.value = []
    return {
      message: r.data.unchanged
        || `Draft v${r.data.styleVersion} created (fidelity ${r.data.fidelity}). `
          + 'Submit it for approval, then publish — the live style is unchanged until you do.',
    }
  })
}

/**
 * Pushes the published style out to QGIS. `dryRun` first shows what would be
 * written, because the real run rewrites a 380 KB production project file.
 */
async function doPush(dryRun: boolean) {
  if (!selected.value) return
  busy.value = true
  notice.value = null
  pushReport.value = null
  try {
    const { data, message } = await pushStyleToQgis(selected.value, { dryRun })
    pushReport.value = data
    notice.value = {
      tone: data.warnings.length ? 'warn' : 'ok',
      text: message + (data.warnings.length ? ` — ${data.warnings.join(' ')}` : ''),
    }
    if (!dryRun) await select(selected.value)
  } catch (e: any) {
    notice.value = { tone: 'err', text: explain(e, 'Push to QGIS failed') }
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await loadCatalogue()
  await loadReport()
})
</script>

<template>
  <div class="gr">
    <!-- ── Header ──────────────────────────────────────────────────────── -->
    <header class="gr-head">
      <div>
        <p class="gr-eyebrow">Enterprise GIS</p>
        <h1 class="gr-title">Symbology registry</h1>
        <p class="gr-lede">
          One approved production style per layer. QGIS authors the cartography, the
          registry versions and publishes it, and every client — the web map, QGIS
          Server, QGIS Desktop — renders that same published version.
        </p>
      </div>
      <div class="gr-head-meta">
        <div class="gr-meta">
          <span class="gr-meta-k">Governed layers</span>
          <span class="gr-meta-v mono">{{ layers.length }}</span>
        </div>
        <div class="gr-meta">
          <span class="gr-meta-k">Fidelity</span>
          <span class="gr-meta-v mono">{{ report ? `${report.matched}/${report.total}` : '—' }}</span>
        </div>
        <UiButton variant="secondary" :disabled="loading" @click="loadCatalogue(); loadReport()">
          <RefreshCw :size="14" :stroke-width="1.75" /> Refresh
        </UiButton>
      </div>
    </header>

    <p v-if="notice" class="gr-notice" :class="`is-${notice.tone}`" role="status">
      <CircleCheck v-if="notice.tone === 'ok'" :size="15" :stroke-width="1.75" />
      <AlertTriangle v-else :size="15" :stroke-width="1.75" />
      <span>{{ notice.text }}</span>
    </p>

    <p v-if="unstyled.length" class="gr-notice is-warn">
      <AlertTriangle :size="15" :stroke-width="1.75" />
      <span>
        {{ unstyled.length }} layer(s) have no published style and will render unstyled:
        <span class="mono">{{ unstyled.map(l => l.layer_id).join(', ') }}</span>
      </span>
    </p>

    <div class="gr-body">
      <!-- ── Layer catalogue ───────────────────────────────────────────── -->
      <UiPanel class="gr-list-panel" title="Layers" subtitle="Governed catalogue" flush>
        <template #icon><Layers :size="16" :stroke-width="1.75" /></template>

        <UiEmptyState v-if="!loading && !layers.length" message="No governed layers." />
        <ul v-else class="gr-list">
          <li
            v-for="l in layers"
            :key="l.layer_id"
            class="gr-list-item"
            :class="{ 'is-on': l.layer_id === selected }"
          >
            <button type="button" class="gr-list-btn" @click="select(l.layer_id)">
              <span class="gr-list-top">
                <span class="gr-list-name mono">{{ l.layer_id }}</span>
                <span v-if="l.style_version" class="gr-ver mono">v{{ l.style_version }}</span>
                <span v-else class="gr-ver is-none">none</span>
              </span>
              <span class="gr-list-sub">
                {{ l.geometry }} ·
                {{ l.source ? SOURCE_LABEL[l.source] ?? l.source : 'unstyled' }}
                <template v-if="l.version_count > 1"> · {{ l.version_count }} versions</template>
              </span>
            </button>
          </li>
        </ul>
      </UiPanel>

      <!-- ── Selected layer ────────────────────────────────────────────── -->
      <div v-if="current" class="gr-detail">
        <UiPanel :title="current.display_name" subtitle="Active production style">
          <template #icon><Palette :size="16" :stroke-width="1.75" /></template>

          <dl class="gr-facts">
            <div>
              <dt>Style version</dt>
              <dd>
                <span v-if="current.style_version" class="mono">v{{ current.style_version }}</span>
                <span v-else class="is-empty">no published style</span>
              </dd>
            </div>
            <div>
              <dt>Authored by</dt>
              <dd>{{ current.source ? SOURCE_LABEL[current.source] ?? current.source : '—' }}</dd>
            </div>
            <div><dt>Approved by</dt><dd>{{ current.approved_by || '—' }}</dd></div>
            <div><dt>Style published</dt><dd>{{ fmt(current.style_published_at) }}</dd></div>
            <div><dt>Data synced</dt><dd>{{ fmt(current.data_synced_at) }}</dd></div>
            <div><dt>Checksum</dt><dd class="mono">{{ short(current.checksum) }}</dd></div>
            <div><dt>Renderer</dt><dd>{{ current.renderer_type || '—' }}</dd></div>
            <div>
              <dt>Fidelity</dt>
              <dd>
                <UiStatusBadge
                  v-if="current.fidelity"
                  :tone="FIDELITY_TONE[current.fidelity] ?? 'neutral'"
                  :label="current.fidelity"
                />
                <span v-else class="is-empty">—</span>
              </dd>
            </div>
          </dl>

          <p v-if="current.fidelity" class="gr-fid-note">{{ FIDELITY_NOTE[current.fidelity] }}</p>

          <!-- Data and style are separate assets with separate clocks. -->
          <div class="gr-provenance">
            <p class="gr-prov-row">
              <Database :size="13" :stroke-width="1.75" />
              <span>Data</span>
              <span class="mono">{{ current.data_source || '—' }}</span>
              <span class="gr-prov-sep">SRID {{ current.data_srid ?? '—' }}</span>
            </p>
            <p class="gr-prov-row">
              <Palette :size="13" :stroke-width="1.75" />
              <span>Style source</span>
              <span class="mono">{{ current.qgis_layer || current.source || '—' }}</span>
              <span v-if="current.qgis_project" class="gr-prov-sep mono">{{ current.qgis_project }}</span>
            </p>
          </div>

          <template #footer>
            <div class="gr-actions">
              <UiButton
                variant="primary" :disabled="busy || !current.style_version || editing"
                @click="startEdit"
              >
                <Pencil :size="14" :stroke-width="1.75" /> Edit symbology
              </UiButton>
              <UiButton variant="secondary" :disabled="busy" @click="importFromQgis">
                <DownloadCloud :size="14" :stroke-width="1.75" /> Import from QGIS
              </UiButton>
              <!-- Push writes a production project file, so a dry run sits next to
                   the real one rather than behind it. -->
              <UiButton
                variant="secondary" :disabled="busy || !current.style_version"
                @click="doPush(true)"
              >
                Preview push
              </UiButton>
              <UiButton
                variant="secondary" :disabled="busy || !current.style_version"
                @click="doPush(false)"
              >
                <UploadCloud :size="14" :stroke-width="1.75" /> Push to QGIS
              </UiButton>
              <UiButton variant="secondary" :disabled="busy" @click="loadCandidates">
                <GitBranch :size="14" :stroke-width="1.75" /> QGIS sources
              </UiButton>
              <a
                v-if="current.style_version"
                :href="qmlDownloadUrl(current.layer_id, current.style_version)"
                class="gr-link"
              >
                <UiButton variant="secondary">
                  <Download :size="14" :stroke-width="1.75" /> Download QML
                </UiButton>
              </a>
            </div>
          </template>
        </UiPanel>

        <!-- ── Editor: authors a NEW DRAFT, never touches the live style ──── -->
        <UiPanel
          v-if="editing"
          title="Edit symbology"
          :subtitle="`based on v${current.style_version} — saves as a new draft`"
        >
          <template #icon><Pencil :size="16" :stroke-width="1.75" /></template>

          <p class="gr-edit-note">
            The published version is immutable, so saving creates a new draft. It has
            to be submitted, approved and published before anything renders
            differently — and pushed to QGIS if the project should match.
          </p>

          <table class="gr-table gr-edit-table">
            <thead>
              <tr><th>Class</th><th>Colour</th><th>Hex</th><th>Stroke (mm)</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in editRows" :key="row.index">
                <td class="gr-edit-label">{{ row.label }}</td>
                <td>
                  <!-- type=color yields lowercase #rrggbb, which is exactly the
                       schema's required colour form — no conversion needed. -->
                  <input v-model="row.fill" type="color" class="gr-color" :aria-label="`Colour for ${row.label}`" />
                </td>
                <td><span class="mono">{{ row.fill }}</span></td>
                <td>
                  <input
                    v-model.number="row.strokeWidth" type="number"
                    min="0" max="10" step="0.05" class="gr-num"
                    :aria-label="`Stroke width for ${row.label}`"
                  />
                </td>
              </tr>
            </tbody>
          </table>

          <div class="gr-edit-meta">
            <label class="gr-edit-field">
              <span class="gr-edit-k">Layer opacity</span>
              <input v-model.number="editOpacity" type="number" min="0" max="1" step="0.05" class="gr-num" />
            </label>
            <label class="gr-edit-field gr-edit-grow">
              <span class="gr-edit-k">Reason for the change</span>
              <input
                v-model="editSummary" type="text" class="gr-text"
                placeholder="e.g. Council resolution 2026/14 — darken High Density Residential"
              />
            </label>
          </div>

          <template #footer>
            <div class="gr-actions">
              <UiButton variant="primary" :disabled="busy || !editChanged" @click="saveEdit">
                <Save :size="14" :stroke-width="1.75" /> Save as new draft
              </UiButton>
              <UiButton variant="secondary" :disabled="busy" @click="cancelEdit">
                <X :size="14" :stroke-width="1.75" /> Cancel
              </UiButton>
              <span v-if="!editChanged" class="gr-edit-hint">No changes yet.</span>
            </div>
          </template>
        </UiPanel>

        <!-- ── Push outcome ───────────────────────────────────────────────── -->
        <UiPanel
          v-if="pushReport"
          :title="pushReport.dryRun ? 'Push preview' : 'Pushed to QGIS'"
          :subtitle="`v${pushReport.styleVersion} · ${pushReport.qgisLayer || 'no QGIS layer mapping'}`"
        >
          <template #icon><UploadCloud :size="16" :stroke-width="1.75" /></template>

          <dl class="gr-facts">
            <div>
              <dt>QGIS project</dt>
              <dd>
                <span v-if="pushReport.wroteProject" class="gr-good">rewritten</span>
                <span v-else class="is-empty">not written</span>
              </dd>
            </div>
            <div>
              <dt>QML sidecar</dt>
              <dd>
                <span v-if="pushReport.wroteQml" class="gr-good">written</span>
                <span v-else class="is-empty">not written</span>
              </dd>
            </div>
            <div><dt>QML path</dt><dd class="mono gr-path">{{ pushReport.qmlPath }}</dd></div>
            <div v-if="pushReport.backupPath">
              <dt>Backup</dt>
              <dd class="mono gr-path">{{ pushReport.backupPath }}</dd>
            </div>
          </dl>

          <p v-for="(w, i) in pushReport.warnings" :key="i" class="gr-conflict">
            <AlertTriangle :size="15" :stroke-width="1.75" />
            <span>{{ w }}</span>
          </p>

          <template #footer>
            <p class="gr-foot-note">
              <template v-if="pushReport.dryRun">
                Nothing was written. Use “Push to QGIS” to apply it.
              </template>
              <template v-else-if="pushReport.wroteProject">
                QGIS Server reloads on the project change. QGIS Desktop users should
                reload the project, or Load Style from the QML above. The previous
                project file is kept at the backup path for rollback.
              </template>
              <template v-else>
                Only the QML sidecar was written — QGIS Desktop can load it, but QGIS
                Server will not render this layer until it exists in the project.
              </template>
            </p>
          </template>
        </UiPanel>

        <!-- QGIS authoring sources + conflict -->
        <UiPanel
          v-if="candidates"
          title="QGIS authoring sources"
          subtitle="Every candidate, never reduced to one automatically"
        >
          <template #icon><GitBranch :size="16" :stroke-width="1.75" /></template>

          <p v-if="candidates.conflict" class="gr-conflict">
            <AlertTriangle :size="15" :stroke-width="1.75" />
            <span>{{ candidates.conflict }}</span>
          </p>

          <UiEmptyState
            v-if="!candidates.candidates.length"
            message="No QGIS style found for this layer."
            sub="Its cartography comes from the statutory schedule instead."
          />
          <table v-else class="gr-table">
            <thead>
              <tr>
                <th>Role</th><th>Source</th><th>Renderer</th>
                <th>Classes</th><th>Fidelity</th><th>Valid</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in candidates.candidates" :key="c.role + c.sourcePath">
                <td>
                  {{ c.role.replace('_', ' ') }}
                  <span v-if="c.role === candidates.recommendedRole" class="gr-rec">recommended</span>
                </td>
                <td class="mono gr-path">{{ c.sourcePath }}</td>
                <td>{{ c.rendererType || '—' }}</td>
                <td class="mono">{{ c.classCount ?? '—' }}</td>
                <td>{{ c.fidelity || '—' }}</td>
                <td>
                  <span v-if="c.error" class="gr-bad">{{ c.error }}</span>
                  <span v-else-if="c.valid" class="gr-good">yes</span>
                  <span v-else class="gr-bad">{{ c.validationErrors[0] || 'no' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </UiPanel>

        <!-- Version history -->
        <UiPanel title="Style versions" :subtitle="`${versions.length} on record`" flush>
          <template #icon><History :size="16" :stroke-width="1.75" /></template>

          <UiEmptyState v-if="!versions.length" message="No versions recorded." />
          <ol v-else class="gr-versions">
            <li v-for="v in versions" :key="v.style_id" class="gr-version">
              <div class="gr-version-head">
                <span class="gr-version-no mono">v{{ v.style_version }}</span>
                <UiStatusBadge :tone="statusOf(v.status).tone" :label="statusOf(v.status).label" />
                <span class="gr-version-meta">
                  {{ v.renderer_type }}<template v-if="v.class_count"> · {{ v.class_count }} classes</template>
                  · {{ SOURCE_LABEL[v.source] ?? v.source }}
                </span>
                <span class="gr-version-sum mono">{{ short(v.checksum) }}</span>
              </div>

              <p v-if="v.change_summary" class="gr-version-note">{{ v.change_summary }}</p>

              <!-- Cartographic preview: colours straight from this version's
                   document, so the officer compares real symbology. -->
              <div v-if="swatchesOf((v as any).definition).length" class="gr-swatches">
                <span
                  v-for="s in swatchesOf((v as any).definition)"
                  :key="s.label"
                  class="gr-swatch"
                  :title="`${s.label} — ${s.color}`"
                >
                  <span class="gr-swatch-chip" :style="{ background: s.color }" />
                  <span class="gr-swatch-label">{{ s.label }}</span>
                </span>
              </div>

              <dl class="gr-version-who">
                <div><dt>Created</dt><dd>{{ v.created_by || '—' }} · {{ fmt(v.created_at) }}</dd></div>
                <div><dt>Approved</dt><dd>{{ v.approved_by || '—' }} · {{ fmt(v.approved_at) }}</dd></div>
                <div><dt>Published</dt><dd>{{ v.published_by || '—' }} · {{ fmt(v.published_at) }}</dd></div>
              </dl>

              <div class="gr-version-actions">
                <UiButton
                  v-if="v.status === 'draft'" variant="secondary" :disabled="busy"
                  @click="advance(v.style_version, 'submit')"
                >Submit for review</UiButton>
                <UiButton
                  v-if="v.status === 'review'" variant="secondary" :disabled="busy"
                  @click="advance(v.style_version, 'approve')"
                >
                  <ShieldCheck :size="14" :stroke-width="1.75" /> Approve
                </UiButton>
                <UiButton
                  v-if="v.status === 'approved'" variant="primary" :disabled="busy"
                  @click="advance(v.style_version, 'publish')"
                >Publish</UiButton>
                <UiButton
                  v-if="v.status === 'deprecated' && v.approved_by" variant="secondary" :disabled="busy"
                  @click="doRollback(v.style_version)"
                >
                  <RotateCcw :size="14" :stroke-width="1.75" /> Roll back to this
                </UiButton>
                <UiButton
                  v-if="publishedVersion && v.style_version !== publishedVersion.style_version"
                  variant="ghost" :disabled="busy"
                  @click="showDiff(v.style_version, publishedVersion!.style_version)"
                >Compare with live</UiButton>
                <a :href="qmlDownloadUrl(current.layer_id, v.style_version)" class="gr-link">
                  <UiButton variant="ghost">QML</UiButton>
                </a>
              </div>
            </li>
          </ol>

          <template #footer>
            <p class="gr-foot-note">
              A published version is immutable. Changing cartography always creates a new
              version, so a rollback restores an exact earlier appearance and never alters
              spatial data.
            </p>
          </template>
        </UiPanel>

        <!-- Diff -->
        <UiPanel
          v-if="diff"
          title="Version comparison"
          :subtitle="`v${diff.from.version} → v${diff.to.version}`"
        >
          <template #icon><GitBranch :size="16" :stroke-width="1.75" /></template>

          <p v-if="diff.identical" class="gr-good">
            These two versions are identical (same checksum).
          </p>
          <template v-else>
            <table class="gr-table">
              <thead><tr><th>Change</th><th>Property</th><th>From</th><th>To</th></tr></thead>
              <tbody>
                <tr v-for="(c, i) in diff.changes" :key="i">
                  <td>{{ c.kind.replace('_', ' ') }}</td>
                  <td>{{ c.property }}</td>
                  <td>
                    <span v-if="String(c.from).startsWith('#')" class="gr-inline-swatch">
                      <span class="gr-swatch-chip" :style="{ background: String(c.from) }" />
                      <span class="mono">{{ c.from }}</span>
                    </span>
                    <span v-else class="mono">{{ c.from ?? '—' }}</span>
                  </td>
                  <td>
                    <span v-if="String(c.to).startsWith('#')" class="gr-inline-swatch">
                      <span class="gr-swatch-chip" :style="{ background: String(c.to) }" />
                      <span class="mono">{{ c.to }}</span>
                    </span>
                    <span v-else class="mono">{{ c.to ?? '—' }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="diff.validation.warnings.length" class="gr-warn-list">
              <span v-for="(w, i) in diff.validation.warnings" :key="i">{{ w }}</span>
            </p>
          </template>
        </UiPanel>

        <!-- Audit -->
        <UiPanel title="Audit trail" subtitle="Every publication and rollback" flush>
          <template #icon><History :size="16" :stroke-width="1.75" /></template>

          <UiEmptyState v-if="!audit.length" message="No recorded events." />
          <table v-else class="gr-table">
            <thead>
              <tr><th>Event</th><th>Versions</th><th>Actor</th><th>Reason</th><th>When</th></tr>
            </thead>
            <tbody>
              <tr v-for="a in audit" :key="a.audit_id">
                <td>{{ String(a.event).replace('_', ' ') }}</td>
                <td class="mono">
                  <template v-if="a.from_version">v{{ a.from_version }} → </template>v{{ a.to_version }}
                </td>
                <td>
                  {{ a.actor || '—' }}
                  <span v-if="a.actor_role" class="gr-role">{{ a.actor_role }}</span>
                </td>
                <td class="gr-reason">{{ a.reason || a.change_summary || '—' }}</td>
                <td class="gr-when">{{ fmt(a.created_at) }}</td>
              </tr>
            </tbody>
          </table>
        </UiPanel>
      </div>
    </div>

    <!-- ── Fidelity report ───────────────────────────────────────────────── -->
    <UiPanel
      v-if="report"
      title="Style fidelity report"
      :subtitle="`QGIS vs web · generated ${fmt(report.generatedAt)}`"
      flush
    >
      <template #icon><ShieldCheck :size="16" :stroke-width="1.75" /></template>

      <div class="gr-report-summary">
        <span class="gr-rs" :class="report.mismatched ? 'is-bad' : 'is-good'">
          {{ report.matched }} of {{ report.total }} layers match
        </span>
        <span v-for="(n, k) in report.byFidelity" :key="k" class="gr-rs-pill">{{ k }}: {{ n }}</span>
        <span v-for="(n, k) in report.byStrategy" :key="`s-${k}`" class="gr-rs-pill">{{ k }}: {{ n }}</span>
      </div>

      <table class="gr-table">
        <thead>
          <tr>
            <th>Layer</th><th>Version</th><th>Renderer</th><th>Source</th>
            <th>Fidelity</th><th>Strategy</th><th>Checks</th><th>Result</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="l in report.layers"
            :key="l.layerId"
            :class="{ 'is-mismatch': l.status === 'MISMATCH' }"
          >
            <td class="mono">{{ l.layerId }}</td>
            <td class="mono">v{{ l.styleVersion }}</td>
            <td>{{ l.rendererType }}</td>
            <td>{{ SOURCE_LABEL[l.source] ?? l.source }}</td>
            <td>{{ l.fidelity }}</td>
            <td>{{ l.strategy }}</td>
            <td class="mono">{{ l.checkCount }}</td>
            <td>
              <span v-if="l.status === 'MATCH'" class="gr-good">MATCH</span>
              <span v-else class="gr-bad">
                {{ l.failed.length }} mismatched: {{ l.failed.map(f => f.property).join(', ') }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </UiPanel>
  </div>
</template>

<style scoped>
.gr {
  max-width: 1280px;
  margin: 0 auto;
  padding: var(--ent-s6) var(--ent-s5) var(--ent-s8);
  display: flex;
  flex-direction: column;
  gap: var(--ent-s5);
  font-family: var(--ent-font);
  color: var(--ent-text);
}
.mono { font-family: var(--ent-font-mono); font-variant-ligatures: none; }
.is-empty { color: var(--ent-text-3); }

/* Header */
.gr-eyebrow {
  margin: 0; font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.09em; text-transform: uppercase; color: var(--ent-text-3);
}
.gr-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: var(--ent-s6); flex-wrap: wrap;
  padding-bottom: var(--ent-s4); border-bottom: 1px solid var(--ent-line-strong);
}
.gr-title {
  margin: var(--ent-s1) 0 0; font-size: var(--ent-fs-xl);
  font-weight: var(--ent-fw-semibold); line-height: var(--ent-lh-tight); letter-spacing: -0.01em;
}
.gr-lede {
  margin: var(--ent-s2) 0 0; font-size: var(--ent-fs-sm);
  color: var(--ent-text-2); max-width: 72ch; line-height: var(--ent-lh);
}
.gr-head-meta { display: flex; align-items: flex-end; gap: var(--ent-s5); flex-shrink: 0; }
.gr-meta { display: flex; flex-direction: column; gap: 2px; }
.gr-meta-k {
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--ent-text-3);
}
.gr-meta-v { font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); }

/* Notices */
.gr-notice {
  display: flex; align-items: flex-start; gap: var(--ent-s2);
  margin: 0; padding: var(--ent-s3) var(--ent-s4);
  font-size: var(--ent-fs-sm); line-height: var(--ent-lh);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r);
  background: var(--ent-surface-2);
}
.gr-notice.is-ok { background: var(--ent-success-soft); border-color: var(--ent-tone-positive-line); }
.gr-notice.is-warn { background: var(--ent-warning-soft); border-color: var(--ent-line-strong); }
.gr-notice.is-err { background: var(--ent-danger-soft); border-color: var(--ent-line-strong); }
.gr-notice svg { flex-shrink: 0; margin-top: 2px; }

/* Layout */
.gr-body {
  display: grid; grid-template-columns: minmax(0, 280px) minmax(0, 1fr);
  gap: var(--ent-s4); align-items: start;
}
.gr-detail { display: flex; flex-direction: column; gap: var(--ent-s4); min-width: 0; }

/* Layer list */
.gr-list-panel { position: sticky; top: var(--ent-s4); }
.gr-list { list-style: none; margin: 0; padding: 0; max-height: 70vh; overflow-y: auto; }
.gr-list-item { border-bottom: 1px solid var(--ent-line); }
.gr-list-item:last-child { border-bottom: none; }
.gr-list-btn {
  display: flex; flex-direction: column; gap: 2px; width: 100%;
  padding: var(--ent-s3) var(--ent-s4); border: none; background: none;
  text-align: left; cursor: pointer; color: inherit;
}
.gr-list-btn:hover { background: var(--ent-surface-2); }
.gr-list-item.is-on .gr-list-btn {
  background: var(--ent-accent-soft); box-shadow: inset 2px 0 0 var(--ent-accent);
}
.gr-list-btn:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.gr-list-top { display: flex; align-items: baseline; gap: var(--ent-s2); }
.gr-list-name {
  font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-medium);
  min-width: 0; overflow-wrap: anywhere;
}
.gr-ver { margin-left: auto; font-size: var(--ent-fs-micro); color: var(--ent-text-3); flex-shrink: 0; }
.gr-ver.is-none { color: var(--ent-danger); }
.gr-list-sub { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }

/* Facts */
.gr-facts {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--ent-s3) var(--ent-s4); margin: 0;
}
.gr-facts dt {
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.07em; text-transform: uppercase; color: var(--ent-text-3);
}
.gr-facts dd { margin: 2px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text); }
.gr-fid-note { margin: var(--ent-s3) 0 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2); }

/* Provenance */
.gr-provenance {
  margin-top: var(--ent-s4); padding-top: var(--ent-s3);
  border-top: 1px solid var(--ent-line);
  display: flex; flex-direction: column; gap: var(--ent-s2);
}
.gr-prov-row {
  display: flex; align-items: center; gap: var(--ent-s2); margin: 0;
  font-size: var(--ent-fs-xs); color: var(--ent-text-2); flex-wrap: wrap;
}
.gr-prov-row > span:first-of-type {
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.07em; text-transform: uppercase; color: var(--ent-text-3); min-width: 6.5rem;
}
.gr-prov-sep { color: var(--ent-text-3); }

/* Actions */
.gr-actions { display: flex; gap: var(--ent-s2); flex-wrap: wrap; }
.gr-link { text-decoration: none; }

/* Tables */
.gr-table {
  width: 100%; border-collapse: collapse; font-size: var(--ent-fs-xs);
  display: block; overflow-x: auto;
}
.gr-table thead th {
  text-align: left; padding: var(--ent-s2) var(--ent-s3);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.07em; text-transform: uppercase; color: var(--ent-text-3);
  border-bottom: 1px solid var(--ent-line-strong); white-space: nowrap;
}
.gr-table tbody td {
  padding: var(--ent-s2) var(--ent-s3); border-bottom: 1px solid var(--ent-line);
  vertical-align: top;
}
.gr-table tbody tr:hover { background: var(--ent-surface-2); }
.gr-table tbody tr.is-mismatch { background: var(--ent-danger-soft); }
.gr-path { overflow-wrap: anywhere; max-width: 22rem; }
.gr-reason { max-width: 24rem; }
.gr-when { white-space: nowrap; color: var(--ent-text-3); }
.gr-role { display: block; font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.gr-rec {
  display: inline-block; margin-left: var(--ent-s2); padding: 0 6px;
  font-size: var(--ent-fs-micro); border-radius: var(--ent-r-pill);
  background: var(--ent-accent-soft); color: var(--ent-accent);
}
.gr-good { color: var(--ent-success); font-weight: var(--ent-fw-medium); }
.gr-bad { color: var(--ent-danger); }

/* Conflict banner */
.gr-conflict {
  display: flex; align-items: flex-start; gap: var(--ent-s2);
  margin: 0 0 var(--ent-s3); padding: var(--ent-s3);
  font-size: var(--ent-fs-xs); line-height: var(--ent-lh);
  background: var(--ent-danger-soft); border: 1px solid var(--ent-line-strong);
  border-radius: var(--ent-r);
}
.gr-conflict svg { flex-shrink: 0; margin-top: 1px; }

/* Versions */
.gr-versions { list-style: none; margin: 0; padding: 0; }
.gr-version {
  padding: var(--ent-s4); border-bottom: 1px solid var(--ent-line);
  display: flex; flex-direction: column; gap: var(--ent-s3);
}
.gr-version:last-child { border-bottom: none; }
.gr-version-head { display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap; }
.gr-version-no { font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); }
.gr-version-meta { font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.gr-version-sum { margin-left: auto; font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.gr-version-note { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2); line-height: var(--ent-lh); }
.gr-version-who { display: flex; gap: var(--ent-s5); flex-wrap: wrap; margin: 0; }
.gr-version-who dt {
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.07em; text-transform: uppercase; color: var(--ent-text-3);
}
.gr-version-who dd { margin: 1px 0 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.gr-version-actions { display: flex; gap: var(--ent-s2); flex-wrap: wrap; align-items: center; }

/* ── Editor ─────────────────────────────────────────────────────────────── */
.gr-edit-note {
  margin: 0 0 var(--ent-s3); font-size: var(--ent-fs-xs);
  color: var(--ent-text-2); line-height: var(--ent-lh); max-width: 74ch;
}
.gr-edit-table tbody td { vertical-align: middle; }
.gr-edit-label { max-width: 20rem; }

/* A colour input IS the cartography being edited, so it is shown at swatch size
   with the same border treatment as the read-only swatches below. */
.gr-color {
  width: 40px; height: 24px; padding: 0; cursor: pointer;
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm);
  background: none;
}
.gr-color:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }

.gr-num, .gr-text {
  height: var(--ent-control-h-sm); padding: 0 var(--ent-s2);
  font-family: var(--ent-font); font-size: var(--ent-fs-xs); color: var(--ent-text);
  background: var(--ent-surface);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm);
}
.gr-num { width: 5.5rem; font-family: var(--ent-font-mono); }
.gr-text { width: 100%; }
.gr-num:focus, .gr-text:focus {
  outline: none; border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring);
}

.gr-edit-meta {
  display: flex; gap: var(--ent-s4); flex-wrap: wrap; align-items: flex-end;
  margin-top: var(--ent-s4); padding-top: var(--ent-s3);
  border-top: 1px solid var(--ent-line);
}
.gr-edit-field { display: flex; flex-direction: column; gap: 4px; }
.gr-edit-grow { flex: 1; min-width: 18rem; }
.gr-edit-k {
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.07em; text-transform: uppercase; color: var(--ent-text-3);
}
.gr-edit-hint { font-size: var(--ent-fs-xs); color: var(--ent-text-3); }

/* Cartographic swatches — the only colours here that are DATA, not chrome. */
.gr-swatches { display: flex; flex-wrap: wrap; gap: var(--ent-s2); }
.gr-swatch {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: var(--ent-fs-micro); color: var(--ent-text-2);
}
.gr-swatch-chip {
  width: 13px; height: 13px; flex-shrink: 0;
  border-radius: 3px; border: 1px solid var(--ent-line-strong);
}
.gr-swatch-label { max-width: 12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gr-inline-swatch { display: inline-flex; align-items: center; gap: 5px; }

.gr-foot-note {
  margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-3);
  line-height: var(--ent-lh); max-width: 76ch;
}
.gr-warn-list {
  display: flex; flex-direction: column; gap: 4px; margin: var(--ent-s3) 0 0;
  font-size: var(--ent-fs-xs); color: var(--ent-text-2);
}

/* Fidelity report */
.gr-report-summary {
  display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap;
  padding: var(--ent-s3) var(--ent-s4); border-bottom: 1px solid var(--ent-line);
}
.gr-rs { font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); }
.gr-rs.is-good { color: var(--ent-success); }
.gr-rs.is-bad { color: var(--ent-danger); }
.gr-rs-pill {
  padding: 2px 8px; font-size: var(--ent-fs-micro);
  border-radius: var(--ent-r-pill); background: var(--ent-surface-sunken); color: var(--ent-text-2);
}

@media (max-width: 1000px) {
  .gr-body { grid-template-columns: minmax(0, 1fr); }
  .gr-list-panel { position: static; }
  .gr-list { max-height: 320px; }
}
@media (max-width: 560px) {
  .gr { padding: var(--ent-s4) var(--ent-s3) var(--ent-s7); }
  .gr-head-meta { gap: var(--ent-s4); }
}
</style>
