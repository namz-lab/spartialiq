// src/services/gisStyles.ts
// ---------------------------------------------------------------------------
// Client for the enterprise GIS symbology registry (/api/gis/styles).
//
// This module is how the web map learns what colour anything is. It holds NO
// cartographic values of its own -- not one hex code, width or opacity. Every
// paint property arrives already compiled by the backend from the same style
// document QGIS Server renders from, so "QGIS colour != web colour" cannot
// happen without the same server function returning two different answers.
//
// Cache keys are VERSIONED (`roads:v3`). Publishing v4 populates `roads:v4` and
// leaves `roads:v3` untouched, so a session that already rendered v3 keeps
// rendering v3 until it deliberately re-resolves -- symbology never changes
// underneath a user mid-session.
// ---------------------------------------------------------------------------
import api from './api'

/** MapLibre layer spec, compiled server-side. Opaque to the frontend by design. */
export interface CompiledMapLayer {
  id: string
  type: 'fill' | 'line' | 'circle' | 'symbol'
  source: string
  'source-layer': string
  minzoom?: number
  maxzoom?: number
  paint: Record<string, unknown>
  layout?: Record<string, unknown>
}

/**
 * How the layer must be drawn.
 *  'vector' — draw the compiled MapLibre layers from vector tiles
 *  'wms'    — the QGIS symbology cannot be expressed in MapLibre; request a
 *             QGIS Server WMS raster instead. `maplibre` is then empty.
 *  'none'   — cannot be rendered faithfully anywhere; do not draw.
 */
export type RenderStrategy = 'vector' | 'wms' | 'none'

/** How faithfully MapLibre reproduces the authored QGIS cartography. */
export type Fidelity = 'direct' | 'converted' | 'server' | 'unsupported'

export type StyleStatus =
  | 'draft' | 'review' | 'approved' | 'published' | 'deprecated' | 'archived'

export interface PublishedStyle {
  layerId: string
  displayName: string
  geometry: 'polygon' | 'line' | 'point' | 'raster'
  styleId: string
  styleName: string
  styleVersion: number
  status: StyleStatus
  /** Which authority authored this cartography. */
  source: 'qgis' | 'statutory_schedule' | 'manual' | 'imported_sld'
  sourcePath: string | null
  rendererType: 'single' | 'categorized' | 'graduated' | 'rule_based'
  classificationAttribute: string | null
  fidelity: Fidelity
  fidelityNotes: Array<{ level: string; note: string }>
  checksum: string
  opacity: number
  minZoom: number | null
  maxZoom: number | null
  approvedBy: string | null
  publishedBy: string | null
  /** When the STYLE was published. Independent of the data clock below. */
  stylePublishedAt: string | null
  /** When the spatial DATA last synced. A style change never moves this. */
  dataSyncedAt: string | null
  dataSource: string | null
  qgisProject: string | null
  qgisLayer: string | null
  maplibre: CompiledMapLayer[]
  renderStrategy: RenderStrategy
  renderNotes: string[]
  /** The renderer-neutral source document, for the admin preview/diff UI. */
  definition: Record<string, any>
}

export interface StyleVersionSummary {
  style_id: string
  style_version: number
  status: StyleStatus
  source: string
  source_path: string | null
  style_name: string
  renderer_type: string
  classification_attribute: string | null
  fidelity: Fidelity
  fidelity_notes: Array<{ level: string; note: string }>
  checksum: string
  change_summary: string | null
  created_by: string | null
  approved_by: string | null
  published_by: string | null
  created_at: string
  approved_at: string | null
  published_at: string | null
  class_count: number
}

export interface GovernedLayer {
  layer_id: string
  display_name: string
  description: string | null
  geometry: string
  data_source: string | null
  data_srid: number | null
  data_synced_at: string | null
  qgis_project: string | null
  qgis_layer: string | null
  owner: string | null
  steward: string | null
  access_roles: string[]
  min_zoom: number | null
  max_zoom: number | null
  is_active: boolean
  style_id: string | null
  style_version: number | null
  source: string | null
  renderer_type: string | null
  fidelity: Fidelity | null
  checksum: string | null
  style_published_at: string | null
  approved_by: string | null
  published_by: string | null
  version_count: number
  latest_version: number | null
}

export interface StyleDiff {
  layerId: string
  from: { version: number; status: string; checksum: string; fidelity: string }
  to: { version: number; status: string; checksum: string; fidelity: string }
  identical: boolean
  changes: Array<{ kind: string; property: string; from: unknown; to: unknown }>
  validation: { valid: boolean; errors: string[]; warnings: string[] }
}

export interface FidelityReport {
  generatedAt: string
  total: number
  matched: number
  mismatched: number
  byStrategy: Record<string, number>
  byFidelity: Record<string, number>
  unstyledLayers: Array<{ layer_id: string; display_name: string }>
  layers: Array<{
    layerId: string
    displayName: string
    styleVersion: number
    rendererType: string
    source: string
    sourcePath: string | null
    checksum: string
    fidelity: Fidelity
    strategy: RenderStrategy
    status: 'MATCH' | 'MISMATCH'
    checkCount: number
    failed: Array<{ property: string; qgis: string; web: string }>
    checks: Array<{ property: string; qgis: string; web: string; match: boolean; note?: string }>
  }>
}

export interface QgisCandidates {
  layerId: string
  qgisLayer: string
  /** Set when several authoring sources exist -- a human must choose. */
  conflict: string | null
  recommendedRole: string | null
  candidates: Array<{
    role: 'qml_sidecar' | 'qgs_project' | 'generated'
    precedence: number
    sourcePath: string
    error: string | null
    rendererType: string | null
    classCount: number | null
    fidelity: Fidelity | null
    checksum: string | null
    valid: boolean | null
    validationErrors: string[]
    definition: Record<string, any> | null
  }>
}

// ── Versioned cache ────────────────────────────────────────────────────────
// Keyed `<layerId>:v<version>`. A published version is immutable (enforced by
// the database), so a hit can be trusted indefinitely and never needs eviction
// for staleness -- only the "which version is current" pointer can move.
const styleCache = new Map<string, PublishedStyle>()
const cacheKey = (layerId: string, version: number) => `${layerId}:v${version}`

/** Which version each layer is currently resolved to in this session. */
const resolvedVersion = new Map<string, number>()

/** The whole-stylesheet fetch, deduplicated across concurrent callers. */
let stylesheetPromise: Promise<PublishedStyle[]> | null = null
let stylesheetVersion: string | null = null

function remember(style: PublishedStyle): PublishedStyle {
  styleCache.set(cacheKey(style.layerId, style.styleVersion), style)
  resolvedVersion.set(style.layerId, style.styleVersion)
  return style
}

/**
 * Fetches every published style in one request.
 *
 * The map needs ~31 layers to draw one frame; individually that is 31 round
 * trips, which matters on a Zimbabwean connection. The server ETags the whole
 * set, so repeat calls revalidate in a single conditional request.
 *
 * Returns [] on failure — callers fall back to their offline default rather
 * than rendering an unstyled map.
 */
export function getPublishedStylesheet(): Promise<PublishedStyle[]> {
  if (!stylesheetPromise) {
    stylesheetPromise = api.get('/gis/styles')
      .then((res) => {
        const styles: PublishedStyle[] = res.data?.data ?? []
        stylesheetVersion = res.data?.stylesheetVersion ?? null
        styles.forEach(remember)
        return styles
      })
      .catch((error) => {
        stylesheetPromise = null   // allow retry on the next call
        console.error('[gis-styles] failed to load published stylesheet:', error)
        return [] as PublishedStyle[]
      })
  }
  return stylesheetPromise
}

/** Start the stylesheet fetch immediately, before the WebGL context is ready. */
export function prefetchPublishedStylesheet(): void {
  void getPublishedStylesheet()
}

/**
 * The published style for one layer.
 *
 * Pass `version` to pin: a pinned request is served from the immutable cache
 * and, on a miss, from a year-cacheable endpoint. Without a version this
 * resolves whatever is published now.
 */
export async function getPublishedStyle(
  layerId: string,
  version?: number,
): Promise<PublishedStyle | null> {
  const known = version ?? resolvedVersion.get(layerId)
  if (known !== undefined) {
    const hit = styleCache.get(cacheKey(layerId, known))
    if (hit) return hit
  }

  try {
    const res = await api.get(`/gis/styles/${encodeURIComponent(layerId)}`, {
      params: version !== undefined ? { version } : undefined,
    })
    const style: PublishedStyle | null = res.data?.data ?? null
    return style ? remember(style) : null
  } catch (error: any) {
    // A layer with no published style is a legitimate state, not a fault: the
    // caller falls back rather than inventing a colour.
    if (error?.response?.status !== 404) {
      console.error(`[gis-styles] failed to load style for "${layerId}":`, error)
    }
    return null
  }
}

/** Cached style for a layer, if this session already resolved one. */
export function peekPublishedStyle(layerId: string, version?: number): PublishedStyle | null {
  const v = version ?? resolvedVersion.get(layerId)
  return v === undefined ? null : styleCache.get(cacheKey(layerId, v)) ?? null
}

/** The stylesheet identity this session is rendering — shown in the admin UI. */
export function currentStylesheetVersion(): string | null {
  return stylesheetVersion
}

/**
 * Drops the "current version" pointers so the next resolve picks up newly
 * published styles. Cached version payloads are KEPT — they are immutable, so
 * discarding them would only cost a refetch of identical bytes.
 */
export function refreshPublishedStyles(): void {
  stylesheetPromise = null
  stylesheetVersion = null
  resolvedVersion.clear()
}

/** Full reset, including the immutable payload cache. For tests. */
export function resetGisStyleCache(): void {
  refreshPublishedStyles()
  styleCache.clear()
}

// ── Governed catalogue + admin reads ───────────────────────────────────────

/**
 * The governed layer catalogue, for the admin console.
 *
 * THROWS on failure, deliberately. The map-path readers above swallow errors and
 * fall back so a citizen map still renders; an administrator needs the opposite.
 * Returning [] here made a 404 (backend not restarted) indistinguishable from an
 * empty registry, and the console reported it as a permission problem.
 */
export async function getGovernedLayers(includeInactive = false): Promise<GovernedLayer[]> {
  const res = await api.get('/gis/layers', {
    params: includeInactive ? { includeInactive: 'true' } : undefined,
  })
  return res.data?.data ?? []
}

export async function getStyleVersions(layerId: string): Promise<StyleVersionSummary[]> {
  const res = await api.get(`/gis/styles/${encodeURIComponent(layerId)}/versions`)
  return res.data?.data ?? []
}

export async function getStyleVersion(layerId: string, version: number): Promise<PublishedStyle> {
  const res = await api.get(`/gis/styles/${encodeURIComponent(layerId)}/version/${version}`)
  return res.data?.data
}

export async function getStyleAudit(layerId: string, limit = 100) {
  const res = await api.get(`/gis/styles/${encodeURIComponent(layerId)}/audit`, { params: { limit } })
  return res.data?.data ?? []
}

export async function getStyleDiff(layerId: string, from: number, to: number): Promise<StyleDiff> {
  const res = await api.get(`/gis/styles/${encodeURIComponent(layerId)}/diff`, { params: { from, to } })
  return res.data?.data
}

export async function getQgisCandidates(layerId: string): Promise<QgisCandidates> {
  const res = await api.get(`/gis/styles/${encodeURIComponent(layerId)}/qgis-candidates`)
  return res.data?.data
}

export async function getFidelityReport(): Promise<FidelityReport> {
  const res = await api.get('/gis/fidelity-report')
  return res.data?.data
}

/** QML for QGIS Desktop — the same document, compiled for the other renderer. */
export function qmlDownloadUrl(layerId: string, version?: number): string {
  const v = version !== undefined ? `&version=${version}` : ''
  return `/api/gis/styles/${encodeURIComponent(layerId)}?target=qml${v}`
}

// ── Write operations (admin / gis_officer) ────────────────────────────────
// Each returns the server's message so the UI reports what actually happened
// rather than assuming success.

export interface DraftResult {
  layerId: string
  styleVersion: number
  status: StyleStatus
  checksum: string
  fidelity: Fidelity
  fidelityNotes?: Array<{ level: string; note: string }>
  validationWarnings: string[]
  unchanged: string | null
}

export async function importStyleFromQgis(
  layerId: string, changeSummary?: string,
): Promise<{ data: DraftResult; message: string }> {
  const res = await api.post(
    `/gis/styles/${encodeURIComponent(layerId)}/import-from-qgis`,
    { changeSummary },
  )
  return { data: res.data?.data, message: res.data?.message ?? '' }
}

export async function createStyleDraft(
  layerId: string,
  definition: Record<string, any>,
  opts: { styleName?: string; changeSummary?: string; source?: string } = {},
): Promise<{ data: DraftResult; message: string }> {
  const res = await api.post(`/gis/styles/${encodeURIComponent(layerId)}/draft`, {
    definition, ...opts,
  })
  return { data: res.data?.data, message: res.data?.message ?? '' }
}

export type LifecycleVerb = 'submit' | 'approve' | 'publish' | 'deprecate' | 'archive'

export async function transitionStyle(
  layerId: string, version: number, verb: LifecycleVerb, reason?: string,
) {
  const res = await api.post(
    `/gis/styles/${encodeURIComponent(layerId)}/version/${version}/${verb}`,
    { reason },
  )
  // A publish moves which version is current; drop the pointer so the map
  // re-resolves rather than continuing to draw the displaced version.
  if (verb === 'publish' || verb === 'deprecate') refreshPublishedStyles()
  return { data: res.data?.data, message: res.data?.message ?? '' }
}

export async function rollbackStyle(layerId: string, toVersion: number, reason?: string) {
  const res = await api.post(`/gis/styles/${encodeURIComponent(layerId)}/rollback`, {
    toVersion, reason,
  })
  refreshPublishedStyles()
  return { data: res.data?.data, message: res.data?.message ?? '' }
}

/** Outcome of pushing a published style back out to QGIS. */
export interface PushReport {
  layerId: string
  styleVersion: number
  checksum: string
  /** The QGIS `<layername>` written, or null when the layer is not in the project. */
  qgisLayer: string | null
  qmlPath: string
  projectPath: string
  wroteQml: boolean
  /** True when the .qgs renderer was rewritten — that is what QGIS Server serves. */
  wroteProject: boolean
  /** The .qgs copy taken before the write, for rollback. */
  backupPath: string | null
  dryRun: boolean
  warnings: string[]
}

/**
 * Pushes a layer's PUBLISHED style out to QGIS: rewrites the renderer inside the
 * project (QGIS Server) and writes the QML sidecar (QGIS Desktop).
 *
 * Pass `dryRun` to see what would be written without touching anything — worth
 * offering before a write to a 380 KB production project file.
 */
export async function pushStyleToQgis(
  layerId: string, opts: { dryRun?: boolean } = {},
): Promise<{ data: PushReport; message: string }> {
  const res = await api.post(
    `/gis/styles/${encodeURIComponent(layerId)}/push-to-qgis`,
    { dryRun: opts.dryRun === true },
  )
  return { data: res.data?.data, message: res.data?.message ?? '' }
}

/** Pushes every layer that has a published style. */
export async function pushAllStylesToQgis(opts: { dryRun?: boolean } = {}) {
  const res = await api.post('/gis/styles/push-all', { dryRun: opts.dryRun === true })
  return { data: res.data?.data, message: res.data?.message ?? '' }
}

/** Records a spatial DATA sync. Explicitly NOT a style operation. */
export async function markDataSynced(layerId: string, syncedAt?: string) {
  const res = await api.post(`/gis/layers/${encodeURIComponent(layerId)}/data-synced`, { syncedAt })
  return { data: res.data?.data, message: res.data?.message ?? '' }
}
