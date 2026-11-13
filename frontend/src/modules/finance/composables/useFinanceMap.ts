/**
 * Pure logic for the finance map (GIS–finance Milestone 3): measure selection, the
 * ward-code join between geometry and roll-up rows, choropleth breaks and paint expressions.
 *
 * Deliberately free of maplibre, the API client and the store so every rule here is
 * unit-testable without a browser:
 *
 *   * a measure that has no value for a ward is NULL — never zero, never imputed
 *     (a ward with no expenditure budget must not shade as "spent nothing");
 *   * breaks are quantiles over the wards that HAVE a value, and collapse to nothing
 *     when there are fewer than two distinct values (one value is not a scale);
 *   * the join is by ward_code within one currency, so a ZWG figure can never shade
 *     a USD choropleth.
 */
import type { Currency } from '../models/types'
import type { PublicWardMapRow, WardPerformanceRow } from '../api/financeApi'
import { FINANCE_CHOROPLETH, FINANCE_NO_DATA, FINANCE_PROJECT_STATUS } from '@/map/vunguBasemapStyle'
import { formatDateTime, formatMoney, formatPercentage } from './useMoney'

export type MeasureKey =
  | 'expenditure_original' | 'expenditure_adjustments' | 'expenditure_budget'
  | 'expenditure_actual' | 'expenditure_actual_via_line' | 'execution'
  | 'commitments' | 'available_excluding_commitments' | 'available_including_commitments'
  | 'expenditure_variance'
  | 'revenue_original' | 'revenue_adjustments' | 'revenue_budget' | 'revenue_actual'
  | 'revenue_actual_via_line' | 'revenue_collection_percentage' | 'revenue_variance'
  | 'split_coverage_amount' | 'unallocated_remainder_amount' | 'attribution_exception_rows'

export interface MeasureDef {
  key: MeasureKey
  label: string
  kind: 'money' | 'percent' | 'count'
  /** The raw figure the row carries (string money as it came from SQL, or a percent number). */
  raw(row: WardPerformanceRow): string | number | null
}

export const MEASURES: readonly MeasureDef[] = [
  // Expenditure
  { key: 'expenditure_budget', label: 'Expenditure budget', kind: 'money',
    raw: (r) => r.expenditure_budget },
  { key: 'expenditure_original', label: 'Expenditure — original budget', kind: 'money',
    raw: (r) => r.original_expenditure },
  { key: 'expenditure_adjustments', label: 'Expenditure — approved adjustments', kind: 'money',
    raw: (r) => r.adjustments_expenditure },
  { key: 'expenditure_actual', label: 'Actual expenditure', kind: 'money',
    raw: (r) => r.expenditure_actual },
  { key: 'expenditure_actual_via_line', label: 'Actual expenditure (via budget line)', kind: 'money',
    raw: (r) => r.expenditure_actual_via_line },
  { key: 'execution', label: 'Budget execution', kind: 'percent',
    raw: (r) => r.expenditure_execution_percentage },
  { key: 'commitments', label: 'Open commitments', kind: 'money',
    raw: (r) => r.open_commitments },
  { key: 'available_excluding_commitments', label: 'Available (excl. commitments)', kind: 'money',
    raw: (r) => r.available_excluding_commitments },
  { key: 'available_including_commitments', label: 'Available (incl. commitments)', kind: 'money',
    raw: (r) => r.available_including_commitments },
  { key: 'expenditure_variance', label: 'Expenditure variance', kind: 'money',
    raw: (r) => r.expenditure_variance },
  // Revenue
  { key: 'revenue_budget', label: 'Revenue budget', kind: 'money',
    raw: (r) => r.revenue_budget },
  { key: 'revenue_original', label: 'Revenue — original budget', kind: 'money',
    raw: (r) => r.original_revenue },
  { key: 'revenue_adjustments', label: 'Revenue — approved adjustments', kind: 'money',
    raw: (r) => r.adjustments_revenue },
  { key: 'revenue_actual', label: 'Revenue collected', kind: 'money',
    raw: (r) => r.revenue_actual },
  { key: 'revenue_actual_via_line', label: 'Revenue collected (via budget line)', kind: 'money',
    raw: (r) => r.revenue_actual_via_line },
  { key: 'revenue_collection_percentage', label: 'Revenue collection rate', kind: 'percent',
    raw: (r) => r.revenue_collection_percentage },
  { key: 'revenue_variance', label: 'Revenue variance', kind: 'money',
    raw: (r) => r.revenue_variance },
  // Attribution — how much of the ward's money the splits place, and what they cannot.
  { key: 'split_coverage_amount', label: 'Attributed by approved splits', kind: 'money',
    raw: (r) => r.split_coverage_amount },
  { key: 'unallocated_remainder_amount', label: 'Unallocated remainder', kind: 'money',
    raw: (r) => r.unallocated_remainder_amount },
  { key: 'attribution_exception_rows', label: 'Attribution exceptions (rows)', kind: 'count',
    raw: (r) => r.attribution_exception_rows },
]

export interface MeasureGroup {
  id: 'expenditure' | 'revenue' | 'attribution'
  label: string
  measures: readonly MeasureDef[]
}

/** The selector offers named groups; it is one list of figures, not fourteen flat labels. */
export const MEASURE_GROUPS: readonly MeasureGroup[] = [
  {
    id: 'expenditure', label: 'Expenditure',
    measures: MEASURES.filter((m) => m.key.startsWith('expenditure') || [
      'execution', 'commitments', 'available_excluding_commitments',
      'available_including_commitments',
    ].includes(m.key)),
  },
  {
    id: 'revenue', label: 'Revenue',
    measures: MEASURES.filter((m) => m.key.startsWith('revenue')),
  },
  {
    id: 'attribution', label: 'Attribution',
    measures: MEASURES.filter((m) => [
      'split_coverage_amount', 'unallocated_remainder_amount', 'attribution_exception_rows',
    ].includes(m.key)),
  },
]

/** The basis is stated on the map because "actual" has two legitimate definitions. */
export const ACTUALS_BASIS_LABELS: Readonly<Record<string, string>> = {
  transaction_ward_code: 'Actuals are attributed by each transaction’s own ward code.',
  budget_line_ward_code:
    'Actuals are attributed by the ward of the budget line the transaction posts to.',
}

export function measureDef(key: MeasureKey): MeasureDef {
  return MEASURES.find((m) => m.key === key) ?? MEASURES[0]
}

/** Numeric value for breaks and paint; NULL stays NULL so "no data" is distinct from zero. */
export function measureValue(row: WardPerformanceRow | null | undefined, key: MeasureKey): number | null {
  if (!row) return null
  const raw = measureDef(key).raw(row)
  return raw === null || raw === undefined ? null : Number(raw)
}

/** Display string: money renders through the module's money formatter, percent its own. */
export function formatMeasure(
  row: WardPerformanceRow | null | undefined, key: MeasureKey, currency?: Currency,
): string {
  if (!row) return '—'
  const def = measureDef(key)
  const raw = def.raw(row)
  if (raw === null || raw === undefined) {
    return def.kind === 'percent' ? 'not defined' : def.kind === 'count' ? 'none' : '—'
  }
  if (def.kind === 'percent') return formatPercentage(raw)
  if (def.kind === 'count') return String(raw)
  return formatMoney(String(raw), currency ?? row.currency)
}

/** Index the roll-up rows for one currency by ward code — the join the choropleth renders. */
export function rowsByWard(rows: readonly WardPerformanceRow[], currency: Currency): Map<string, WardPerformanceRow> {
  const map = new Map<string, WardPerformanceRow>()
  for (const row of rows) {
    if (row.currency === currency && row.ward_code && !row.unlocated_reason) {
      map.set(row.ward_code, row)
    }
  }
  return map
}

/**
 * Quantile breaks over the values that exist. Fewer than two DISTINCT values is not a scale,
 * so the result is empty and the map shades everything in the base colour. Returns the upper
 * edges for a maplibre `step` expression (length = classes - 1).
 */
export function computeBreaks(values: readonly number[], classes = 5): number[] {
  const distinct = [...new Set(values.filter((v) => Number.isFinite(v)))].sort((a, b) => a - b)
  if (distinct.length < 2 || classes < 2) return []
  const breaks: number[] = []
  for (let i = 1; i < classes; i++) {
    // Nearest-rank quantile over distinct values; deduped so a skewed distribution cannot
    // produce the same edge twice (a repeated edge would render an empty class).
    const rank = Math.round((i / classes) * (distinct.length - 1))
    const edge = distinct[rank]
    if (edge !== undefined && (breaks.length === 0 || edge > breaks[breaks.length - 1])) {
      breaks.push(edge)
    }
  }
  return breaks
}

/**
 * Sequential single-hue ramp, light → dark. Length matches computeBreaks(classes) + 1.
 * Declared in the map style module (DESIGN.md, "Finance overlay") and imported here, so the
 * paint and the legend swatch can never disagree.
 */
export const CHOROPLETH_COLORS = FINANCE_CHOROPLETH

/**
 * The maplibre fill-colour expression: wards without a value get the "no data" grey, never
 * the bottom class — a ward with no expenditure budget did not spend zero.
 */
export function fillExpression(breaks: readonly number[], noDataColor = FINANCE_NO_DATA): unknown[] {
  // DEGENERATE CASE FIRST — and it is the NORMAL case, not an edge one.
  //
  // `computeBreaks` returns [] whenever fewer than two distinct values exist, which with no
  // ward-tagged figure anywhere is every measure on every ward. A `step` with no stop pair is
  // ['step', input, output], and MapLibre refuses it:
  //
  //   layers.fin-wards-fill.paint.fill-color[3]: Expected at least 4 arguments, but found only 2.
  //
  // (index 3 of the enclosing `case` is this sub-expression.) The refusal left the layer on its
  // previous paint, so the map LOOKED right — grey wards — while every repaint logged an error and
  // the measure selector silently did nothing. A scale over one value is not a scale, so the
  // honest answer is a flat colour and a legend that says "all wards with a figure", which is what
  // the legend already renders for an empty break list.
  if (breaks.length === 0) {
    return ['case',
      ['==', ['get', 'value'], null], noDataColor,
      CHOROPLETH_COLORS[0]]
  }
  const colors = CHOROPLETH_COLORS.slice(0, breaks.length + 1)
  const step: unknown[] = ['step', ['get', 'value'], colors[0] ?? CHOROPLETH_COLORS[0]]
  for (let i = 0; i < breaks.length; i++) {
    step.push(breaks[i], colors[i + 1] ?? CHOROPLETH_COLORS[CHOROPLETH_COLORS.length - 1])
  }
  return ['case',
    ['==', ['get', 'value'], null], noDataColor,
    step]
}

// ── What the surface shows when the canvas cannot draw ───────────────────────────────────────
//
// A blank canvas beside a populated legend is the most dangerous state a choropleth has: it reads
// as "nothing here" rather than "nothing drawn". So a lost WebGL context is named in words, the
// canvas is replaced rather than left empty, and the ward TABLE stays — the figures are still
// valid when the picture is not, and the table is already the keyboard and screen-reader
// equivalent of the map.

export const WEBGL_LOST_MESSAGE =
  'The map lost its graphics context and cannot draw. This is a display failure, not a finding: '
  + 'the figures below are unaffected, and a ward with no shading here is not a ward with no '
  + 'money. Reload the map to try again.'

export interface CanvasState {
  /** Whether the map canvas should be shown at all. */
  showCanvas: boolean
  /** Whether the ward table must be rendered. It is the honest fallback as well as the a11y one. */
  showTable: boolean
  /** The sentence to render in place of the canvas, or null when the canvas is fine. */
  message: string | null
  /** Whether to offer a manual retry — the browser may never restore the context by itself. */
  offerRetry: boolean
}

/**
 * What to render, given the canvas's health and what the data says.
 *
 * Pure, so "a lost context keeps the table and states the reason" is a test rather than a claim.
 */
export function canvasState(input: {
  contextLost: boolean
  wardRegisterLinked: boolean
  wardCount: number
}): CanvasState {
  if (input.contextLost) {
    return {
      showCanvas: false,
      showTable: input.wardCount > 0,
      message: WEBGL_LOST_MESSAGE,
      offerRetry: true,
    }
  }
  return {
    showCanvas: input.wardRegisterLinked,
    showTable: input.wardCount > 0,
    message: null,
    offerRetry: false,
  }
}

/** Smallest circle for a project with no figure — invisible is not "no money". */
export const MIN_PROJECT_RADIUS = 5
export const MAX_PROJECT_RADIUS = 22

/**
 * Radius classes for the capital map, built on the SAME quantile edges as the choropleth so a
 * circle and a ward cannot disagree about what a class is. Radius grows with the square root of
 * the class edge: area, not diameter, then reads as the figure.
 */
export function circleRadii(breaks: readonly number[], min = MIN_PROJECT_RADIUS, max = MAX_PROJECT_RADIUS): number[] {
  const classes = breaks.length + 1
  if (classes <= 1) return [min]
  const top = breaks[breaks.length - 1] || 1
  const radii: number[] = []
  for (let i = 0; i < classes; i++) {
    // The first class is the floor; the last reaches max. The square root keeps the growth
    // sub-linear, matching the area encoding.
    const edge = i === 0 ? Math.max(top / classes, Number.EPSILON) : breaks[i - 1] || top
    const t = Math.sqrt(Math.max(edge, 0) / Math.max(top, Number.EPSILON))
    radii.push(Math.round((min + (max - min) * Math.min(1, Math.max(0, t))) * 100) / 100)
  }
  return radii
}

/**
 * The maplibre circle-radius expression; a null figure gets the minimum, never 0.
 *
 * Same degenerate guard as `fillExpression`, and for the same reason: one located project is the
 * state this map is in, `computeBreaks` returns [] for it, and a `step` with no stop pair is an
 * expression MapLibre refuses. With no classes every circle is the same size, which is the honest
 * rendering — one project cannot be large or small relative to anything.
 */
export function circleRadiusExpression(breaks: readonly number[], min = MIN_PROJECT_RADIUS): unknown[] {
  const radii = circleRadii(breaks, min, MAX_PROJECT_RADIUS)
  if (breaks.length === 0) {
    return ['case',
      ['==', ['get', 'value'], null], min,
      radii[0] ?? min]
  }
  const step: unknown[] = ['step', ['get', 'value'], radii[0] ?? min]
  for (let i = 0; i < breaks.length; i++) {
    step.push(breaks[i], radii[i + 1] ?? radii[radii.length - 1] ?? min)
  }
  return ['case',
    ['==', ['get', 'value'], null], min,
    step]
}

/** A named status scale from the map style module — never a second ad-hoc palette. */
export function projectStatusColor(status: string | null | undefined): string {
  return FINANCE_PROJECT_STATUS[status ?? ''] ?? FINANCE_NO_DATA
}

// ── Permission-derived map presets (M6-1) ───────────────────────────────────────────────────
//
// The map opens on the measure its reader is most likely to need, derived from permissions the
// server already sent. This is DEFAULTS ONLY: every control stays available to anyone holding
// `finance.map.view`, because that permission already says they may read these figures. Nothing
// here gates, hides or changes a number, and the same permission set always yields the same preset.
//
// Precedence is deliberate and tested:
//   1. money approver      → where is execution against budget (the committee/manager shape)
//   2. project manager     → the capital layer, sized by allocated total
//   3. read-only auditor   → actual expenditure, export already available
//   4. budget preparer     → the budget by department, where allocation is done
//   5. revenue-leaning     → collection rate, the measure a revenue officer acts on
//   6. everyone else       → expenditure budget, ward totals
//
// "Higher privilege wins" is not enough on its own: a departmental head both prepares a budget and
// manages projects, and its map is the allocation view. A person who prepares is therefore treated
// as a preparer even if they also manage projects; the project layer remains one checkbox away.

export type MapProjectMeasure = 'approved_budget' | 'allocated_total' | 'actual_spend'

export interface FinanceMapPreset {
  measure: MeasureKey
  dimension: 'total' | 'department' | 'programme'
  /** `null` means "leave the server's first currency carrying figures" — never guess USD. */
  currency: Currency | null
  showProjects: boolean
  projectMeasure: MapProjectMeasure
}

/**
 * Codes that change financial content or its presentation. An auditor is read-only: export is a
 * read, so `finance.report.export` is deliberately not in this set.
 */
const MAP_WRITE_PERMISSIONS: readonly string[] = [
  'finance.budget.prepare', 'finance.budget.submit', 'finance.budget.approve',
  'finance.revision.prepare', 'finance.revision.submit', 'finance.revision.approve',
  'finance.project.manage', 'finance.project.approve',
  'finance.import.upload', 'finance.import.validate', 'finance.import.commit',
  'finance.import.exception.resolve',
  'finance.publication.review', 'finance.publication.approve',
  'finance.publication.publish', 'finance.publication.withdraw',
  'finance.variance.explain', 'finance.config.manage', 'finance.year.close',
  'finance.users.manage_finance_roles',
]

const MAP_PRESET_FALLBACK: FinanceMapPreset = {
  measure: 'expenditure_budget',
  dimension: 'total',
  currency: null,
  showProjects: true,
  projectMeasure: 'approved_budget',
}

export function mapPresetFor(permissions: Iterable<string>): FinanceMapPreset {
  const held = permissions instanceof Set ? permissions : new Set<string>(permissions)
  const has = (code: string) => held.has(code)
  const any = (codes: readonly string[]) => codes.some(has)

  const preparesBudget = any([
    'finance.budget.prepare', 'finance.budget.submit',
    'finance.revision.prepare', 'finance.revision.submit',
  ])

  // 1. A money approver reads execution: budget given against money spent.
  if (any(['finance.budget.approve', 'finance.revision.approve'])) {
    return { ...MAP_PRESET_FALLBACK, measure: 'execution', dimension: 'total' }
  }

  // 2. A project manager who does not prepare the budget opens on the capital layer.
  if (!preparesBudget && any(['finance.project.manage', 'finance.project.approve'])) {
    return {
      ...MAP_PRESET_FALLBACK,
      showProjects: true,
      projectMeasure: 'allocated_total',
    }
  }

  // 3. Read-only with an export duty: the auditor starts from actual expenditure.
  const exportsReports = any(['finance.report.export', 'finance.report.export_restricted'])
  if (exportsReports && !any(MAP_WRITE_PERMISSIONS)) {
    return { ...MAP_PRESET_FALLBACK, measure: 'expenditure_actual', dimension: 'total' }
  }

  // 4. A preparer allocates by department, not by an abstract ward total.
  if (preparesBudget) {
    return { ...MAP_PRESET_FALLBACK, measure: 'expenditure_budget', dimension: 'department' }
  }

  // 5. A revenue-leaning reader with no budget write starts on the collection rate.
  if (!has('finance.budget.approve') && any([
    'finance.transaction.view', 'finance.transaction.view_counterparty',
  ])) {
    return { ...MAP_PRESET_FALLBACK, measure: 'revenue_collection_percentage', dimension: 'total' }
  }

  return { ...MAP_PRESET_FALLBACK }
}

// ── Public transparency map (M7) ─────────────────────────────────────────────────────────────
//
// The public map offers a DIFFERENT measure set from the staff map, and it does not decide what
// may be shown: the server derives `available_measures` from live publications, and a client
// that offers anything outside that list would be offering a figure the council has not
// released. Every value is nullable; a blank measure is "not published", never zero.

export type PublicMeasureKey =
  | 'expenditure_budget' | 'expenditure_actual' | 'expenditure_execution_percentage'
  | 'revenue_budget' | 'revenue_actual' | 'revenue_variance' | 'revenue_collection_percentage'
  | 'project_count'

export interface PublicMeasureDef {
  key: PublicMeasureKey
  label: string
  kind: 'money' | 'percent' | 'count'
  group: 'Expenditure' | 'Revenue' | 'Projects'
}

export const PUBLIC_MEASURES: readonly PublicMeasureDef[] = [
  { key: 'expenditure_budget', label: 'Expenditure budget', kind: 'money', group: 'Expenditure' },
  { key: 'expenditure_actual', label: 'Actual expenditure', kind: 'money', group: 'Expenditure' },
  { key: 'expenditure_execution_percentage', label: 'Budget execution', kind: 'percent', group: 'Expenditure' },
  { key: 'revenue_budget', label: 'Revenue budget', kind: 'money', group: 'Revenue' },
  { key: 'revenue_actual', label: 'Revenue collected', kind: 'money', group: 'Revenue' },
  { key: 'revenue_variance', label: 'Revenue variance', kind: 'money', group: 'Revenue' },
  { key: 'revenue_collection_percentage', label: 'Revenue collection rate', kind: 'percent', group: 'Revenue' },
  { key: 'project_count', label: 'Projects in the ward', kind: 'count', group: 'Projects' },
]

/**
 * The measures the screen may offer: exactly those the server named. Publication is per dataset,
 * so a live budget makes the budget measures available but not actual expenditure — offering it
 * anyway would let a citizen read a blank as "0 % executed".
 */
export function availablePublicMeasures(available: readonly string[]): PublicMeasureDef[] {
  return PUBLIC_MEASURES.filter((m) => available.includes(m.key))
}

/** The numeric value for a public ward row; NULL stays NULL, and project count is separate. */
export function publicMeasureValue(
  row: PublicWardMapRow | null,
  key: PublicMeasureKey,
  projectCount: number | null = null,
): number | null {
  if (!row) return null
  if (key === 'project_count') return projectCount
  const raw = row[key]
  return raw === null || raw === undefined ? null : Number(raw)
}

// ── Published project locations (M7-5) ──────────────────────────────────────────────────────
//
// The public projects route is already publication-gated: a proposed or draft project is never
// returned. What remains the client's job is narrower — a project is drawn ONLY where the council
// released a coordinate. A ward code is an area, not a point, and a marker must never be invented
// from it or from the map's centre. The currency filter is the same rule as the choropleth: one
// currency at a time, never converted or combined.

export interface PublishedProjectPoint {
  type: 'Feature'
  properties: { project_id: string; status: string; color: string }
  geometry: { type: 'Point'; coordinates: [number, number] }
}

/** True only for a finite released longitude and latitude; `null` and strings are not a point. */
export function hasReleasedLocation(p: {
  longitude?: number | null
  latitude?: number | null
}): boolean {
  return typeof p.longitude === 'number' && Number.isFinite(p.longitude)
    && typeof p.latitude === 'number' && Number.isFinite(p.latitude)
}

/** The point features for the public project layer, in one currency and only where located. */
export function publishedProjectPoints<T extends {
  project_id: string
  status: string
  currency: string
  longitude?: number | null
  latitude?: number | null
}>(projects: readonly T[], currency: string): PublishedProjectPoint[] {
  return projects
    .filter((p) => p.currency === currency && hasReleasedLocation(p))
    .map((p) => ({
      type: 'Feature' as const,
      properties: {
        project_id: p.project_id,
        status: p.status,
        color: projectStatusColor(p.status),
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [p.longitude as number, p.latitude as number],
      },
    }))
}

/**
 * The provenance an exported map sheet must carry (M6-3). An A4 sheet of shaded wards is easy to
 * paste into a committee report and impossible to interpret three months later, so the year,
 * currency, measure, source view and the view's own `generated_at` travel with it. The footer line
 * is the compact version the PDF prints beneath the map; the subtitle is the full one.
 */
export const MAP_SOURCE_VIEW = 'finance.v_ward_performance'

export interface MapExportMetaInput {
  yearLabel: string | null | undefined
  currency: Currency
  measureLabel: string
  dimension: string
  generatedAt: string | null | undefined
  projectMeasureLabel?: string | null
  hasLocatedProjects?: boolean
  provisionalWardList?: boolean
}

export interface MapExportMeta {
  subtitle: string
  provenance: string
}

export function mapExportMeta(input: MapExportMetaInput): MapExportMeta {
  const year = input.yearLabel || 'No financial year'
  const parts = [
    year,
    input.currency,
    input.measureLabel,
    input.dimension === 'total' ? 'ward totals' : `by ${input.dimension}`,
    `Source: ${MAP_SOURCE_VIEW}`,
    `Data as at ${formatDateTime(input.generatedAt)}`,
  ]
  if (input.hasLocatedProjects && input.projectMeasureLabel) {
    parts.push(`project circles = ${input.projectMeasureLabel}`)
  }
  if (input.provisionalWardList) parts.push('provisional ward list (D11)')
  return {
    subtitle: parts.join(' · '),
    provenance: `${year} · ${input.currency} · Source: ${MAP_SOURCE_VIEW}`,
  }
}

export function useFinanceMap() {
  return {
    MEASURES, MEASURE_GROUPS, measureDef, measureValue, formatMeasure, rowsByWard,
    computeBreaks, fillExpression, circleRadii, circleRadiusExpression, projectStatusColor,
    mapPresetFor,
    PUBLIC_MEASURES, availablePublicMeasures, publicMeasureValue,
    hasReleasedLocation, publishedProjectPoints,
    mapExportMeta, MAP_SOURCE_VIEW,
  }
}
