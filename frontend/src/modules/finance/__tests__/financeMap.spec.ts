/**
 * Pure-logic specs for the finance map helpers (GIS–finance Milestones 3–5 and 7): the join, the
 * breaks, the capital-map radii and the "no data is not zero" rule that the choropleth and the
 * public map both depend on.
 */
import { describe, expect, it } from 'vitest'
import type { PublicWardMapRow, WardPerformanceRow } from '../api/financeApi'
import { FINANCE_NO_DATA, FINANCE_PROJECT_STATUS } from '@/map/vunguBasemapStyle'
import {
  MEASURES, MEASURE_GROUPS, MAP_SOURCE_VIEW, PUBLIC_MEASURES, availablePublicMeasures,
  circleRadii, circleRadiusExpression, computeBreaks, fillExpression, formatMeasure,
  hasReleasedLocation, mapExportMeta, mapPresetFor, measureValue, projectStatusColor,
  publicMeasureValue, publishedProjectPoints, rowsByWard,
} from '../composables/useFinanceMap'
import { formatDateTime } from '../composables/useMoney'

const row = (over: Partial<WardPerformanceRow>): WardPerformanceRow => ({
  authority_id: 'a', financial_year_id: 'y', currency: 'USD', ward_code: 'W1',
  unlocated_reason: null, ward_status: 'linked', ward_register_basis: null,
  original_revenue: null, adjustments_revenue: null, revenue_budget: null,
  revenue_actual: null, revenue_actual_via_line: null, revenue_variance: null,
  revenue_collection_percentage: null,
  original_expenditure: null, adjustments_expenditure: null, expenditure_budget: null,
  expenditure_actual: null, expenditure_actual_via_line: null, open_commitments: null,
  available_excluding_commitments: null, available_including_commitments: null,
  expenditure_variance: null, expenditure_execution_percentage: null,
  split_coverage_amount: null, unallocated_remainder_amount: null,
  attribution_exception_rows: 0, attributed_lines: 0, allocation_rows: 0, transaction_rows: 0,
  ...over,
})

const publicRow = (over: Partial<PublicWardMapRow>): PublicWardMapRow => ({
  ward_code: 'W1', ward_status: 'linked', currency: 'USD', ward_register_basis: null,
  revenue_budget: null, revenue_actual: null, revenue_variance: null,
  revenue_collection_percentage: null, expenditure_budget: null, expenditure_actual: null,
  expenditure_execution_percentage: null,
  ...over,
})

describe('finance map helpers', () => {
  it('every measure reads its own figure and leaves NULL alone', () => {
    const r = row({ expenditure_budget: '600.00', expenditure_actual: '200.00',
      expenditure_execution_percentage: 33.33 })
    expect(measureValue(r, 'expenditure_budget')).toBe(600)
    expect(measureValue(r, 'execution')).toBe(33.33)
    expect(measureValue(r, 'revenue_budget')).toBeNull()
    expect(measureValue(null, 'expenditure_budget')).toBeNull()
  })

  it('the join is by ward code within ONE currency — ZWG never shades a USD map', () => {
    const rows = [
      row({ ward_code: 'W1', expenditure_budget: '100.00' }),
      row({ ward_code: 'W1', currency: 'ZWG', expenditure_budget: '999999.00' }),
      row({ ward_code: 'W2', expenditure_budget: '50.00' }),
    ]
    const joined = rowsByWard(rows, 'USD')
    expect(joined.size).toBe(2)
    expect(measureValue(joined.get('W1'), 'expenditure_budget')).toBe(100)
  })

  it('unlocated rows never join geometry', () => {
    const rows = [row({ ward_code: 'W9', unlocated_reason: 'unallocated_remainder' })]
    expect(rowsByWard(rows, 'USD').size).toBe(0)
  })

  it('breaks are quantiles that refuse to invent a scale', () => {
    expect(computeBreaks([5])).toEqual([])
    expect(computeBreaks([7, 7, 7])).toEqual([])
    const breaks = computeBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)
    expect(breaks).toHaveLength(4)
    // strictly increasing edges within the value range
    for (let i = 1; i < breaks.length; i++) expect(breaks[i]).toBeGreaterThan(breaks[i - 1])
    expect(breaks[0]).toBeGreaterThanOrEqual(1)
    expect(breaks[breaks.length - 1]).toBeLessThanOrEqual(10)
  })

  it('the paint expression keeps “no data” grey and distinct from the lowest class', () => {
    const expr = fillExpression([20, 40, 60, 80]) as unknown[]
    expect(expr[0]).toBe('case')
    expect(JSON.stringify(expr)).toContain(FINANCE_NO_DATA)
    expect(JSON.stringify(expr)).toContain('null')
  })

  it('display keeps the module’s money discipline: null money is a dash, undefined percent says so', () => {
    expect(formatMeasure(row({ expenditure_budget: '1250.00' }), 'expenditure_budget')).toBe('US$ 1 250.00')
    expect(formatMeasure(row({}), 'revenue_actual')).toBe('—')
    expect(formatMeasure(row({}), 'execution')).toBe('not defined')
    expect(formatMeasure(row({}), 'attribution_exception_rows')).toBe('0')
  })

  it('offers the twenty measures of the staff ward panel', () => {
    expect(MEASURES.map((m) => m.key)).toEqual([
      'expenditure_budget', 'expenditure_original', 'expenditure_adjustments',
      'expenditure_actual', 'expenditure_actual_via_line', 'execution',
      'commitments', 'available_excluding_commitments', 'available_including_commitments',
      'expenditure_variance',
      'revenue_budget', 'revenue_original', 'revenue_adjustments', 'revenue_actual',
      'revenue_actual_via_line', 'revenue_collection_percentage', 'revenue_variance',
      'split_coverage_amount', 'unallocated_remainder_amount', 'attribution_exception_rows',
    ])
  })

  it('groups every measure exactly once, under the heading that owns it', () => {
    const grouped = MEASURE_GROUPS.flatMap((g) => g.measures)
    expect(grouped).toHaveLength(MEASURES.length)
    expect(new Set(grouped.map((m) => m.key)).size).toBe(MEASURES.length)
    expect(MEASURE_GROUPS.map((g) => [g.id, g.measures.length])).toEqual([
      ['expenditure', 10], ['revenue', 7], ['attribution', 3],
    ])
  })

  it('capital radii grow with the class and a null figure keeps the minimum, never zero', () => {
    const radii = circleRadii([20, 40, 60, 80])
    expect(radii).toHaveLength(5)
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1])
    expect(radii[0]).toBeGreaterThan(0)
    expect(radii[radii.length - 1]).toBe(22)
    expect(circleRadii([])).toEqual([5])

    const expr = JSON.stringify(circleRadiusExpression([20, 40, 60, 80]))
    expect(expr).toContain('"case"')
    expect(expr).toContain('null')
    expect(expr).toContain('5')
  })

  it('project status colour comes from the shared scale, never a private palette', () => {
    expect(projectStatusColor('in_progress')).toBe(FINANCE_PROJECT_STATUS.in_progress)
    expect(projectStatusColor(null)).toBe(FINANCE_NO_DATA)
    expect(projectStatusColor('not_a_status')).toBe(FINANCE_NO_DATA)
  })
})

describe('auditor map export provenance (M6-3)', () => {
  const generatedAt = '2026-11-09T08:15:00.000Z'

  it('a printed sheet always names the year, currency, source view and the data cut-off', () => {
    const meta = mapExportMeta({
      yearLabel: 'FY 2027', currency: 'USD', measureLabel: 'Expenditure budget',
      dimension: 'total', generatedAt,
    })
    expect(meta.subtitle).toContain('FY 2027')
    expect(meta.subtitle).toContain('USD')
    expect(meta.subtitle).toContain('Expenditure budget')
    expect(meta.subtitle).toContain('ward totals')
    expect(meta.subtitle).toContain(MAP_SOURCE_VIEW)
    // The view's own generated_at, not the browser's clock when the PDF was pressed.
    expect(meta.subtitle).toContain(`Data as at ${formatDateTime(generatedAt)}`)
    // The footer is the compact provenance the PDF prints beside the coordinates.
    expect(meta.provenance).toBe(`FY 2027 · USD · Source: ${MAP_SOURCE_VIEW}`)
  })

  it('names a missing year rather than printing an empty provenance', () => {
    const meta = mapExportMeta({
      yearLabel: null, currency: 'ZWG', measureLabel: 'Revenue collected',
      dimension: 'total', generatedAt: null,
    })
    expect(meta.provenance).toBe(`No financial year · ZWG · Source: ${MAP_SOURCE_VIEW}`)
    expect(meta.subtitle).toContain('No financial year')
  })

  it('carries the breakdown, the provisional-ward caveat and the project-circle measure', () => {
    const meta = mapExportMeta({
      yearLabel: 'FY 2027', currency: 'USD', measureLabel: 'Budget execution',
      dimension: 'department', generatedAt, projectMeasureLabel: 'Allocated total',
      hasLocatedProjects: true, provisionalWardList: true,
    })
    expect(meta.subtitle).toContain('by department')
    expect(meta.subtitle).toContain('project circles = Allocated total')
    expect(meta.subtitle).toContain('provisional ward list (D11)')
  })
})

describe('permission-derived map presets (M6-1)', () => {
  const preset = (codes: string[]) => mapPresetFor(new Set(codes))

  it('a money approver opens on execution, ward totals', () => {
    const p = preset(['finance.map.view', 'finance.budget.view', 'finance.budget.approve'])
    expect(p.measure).toBe('execution')
    expect(p.dimension).toBe('total')
    expect(p.currency).toBeNull()
  })

  it('a preparer who is not an approver opens on the budget by department', () => {
    const p = preset(['finance.map.view', 'finance.budget.view', 'finance.budget.prepare'])
    expect(p.measure).toBe('expenditure_budget')
    expect(p.dimension).toBe('department')
  })

  it('a revenue-leaning reader opens on the collection rate', () => {
    const p = preset(['finance.map.view', 'finance.budget.view', 'finance.transaction.view'])
    expect(p.measure).toBe('revenue_collection_percentage')
    expect(p.dimension).toBe('total')
  })

  it('a read-only auditor opens on actual expenditure; export alone is not a write code', () => {
    const p = preset([
      'finance.map.view', 'finance.report.export', 'finance.transaction.view', 'finance.audit.view',
    ])
    expect(p.measure).toBe('expenditure_actual')
    // The same export permission plus a write is a preparer, not the read-only audit shape.
    expect(preset(['finance.map.view', 'finance.report.export', 'finance.budget.prepare']).measure)
      .toBe('expenditure_budget')
  })

  it('a project manager without budget preparation opens the capital layer on allocated total', () => {
    const p = preset(['finance.map.view', 'finance.project.manage'])
    expect(p.showProjects).toBe(true)
    expect(p.projectMeasure).toBe('allocated_total')
    expect(p.measure).toBe('expenditure_budget')
  })

  it('resolves several role shapes deterministically, highest authority first', () => {
    const codes = [
      'finance.map.view', 'finance.budget.approve', 'finance.budget.prepare',
      'finance.project.manage', 'finance.report.export',
    ]
    const first = mapPresetFor(new Set(codes))
    const second = mapPresetFor(new Set(codes))
    expect(first).toEqual(second)
    expect(first.measure).toBe('execution')
  })

  it('treats a person who prepares a budget as a preparer even when they manage projects', () => {
    // A departmental head both prepares and manages projects; its map is the allocation view. The
    // project layer is still one checkbox away, so nothing is withheld.
    const p = preset(['finance.map.view', 'finance.budget.prepare', 'finance.project.manage'])
    expect(p.dimension).toBe('department')
    expect(p.showProjects).toBe(true)
  })

  it('falls back to expenditure budget for a read-only viewer and never guesses a currency', () => {
    expect(preset(['finance.map.view', 'finance.budget.view'])).toEqual({
      measure: 'expenditure_budget', dimension: 'total', currency: null,
      showProjects: true, projectMeasure: 'approved_budget',
    })
  })
})

describe('published project locations (M7-5)', () => {
  const project = (over: Partial<{
    project_id: string; status: string; currency: string
    longitude: number | null; latitude: number | null
  }> = {}) => ({
    project_id: 'p1', status: 'in_progress', currency: 'USD',
    longitude: 29.9, latitude: -19.1, ...over,
  })

  it('accepts only a finite released coordinate, never a ward code or a string', () => {
    expect(hasReleasedLocation(project())).toBe(true)
    expect(hasReleasedLocation(project({ longitude: null }))).toBe(false)
    expect(hasReleasedLocation(project({ latitude: undefined }))).toBe(false)
    expect(hasReleasedLocation(project({ longitude: Number.NaN }))).toBe(false)
    expect(hasReleasedLocation(project({ longitude: '29.9' }))).toBe(false)
  })

  it('keeps currencies separate and drops unlocated projects instead of inventing a point', () => {
    const points = publishedProjectPoints([
      project({ project_id: 'usd' }),
      project({ project_id: 'zwg', currency: 'ZWG', longitude: 31, latitude: -20 }),
      project({ project_id: 'unlocated', longitude: null, latitude: null }),
    ], 'USD')
    expect(points.map((p) => p.properties.project_id)).toEqual(['usd'])
  })

  it('carries the released coordinate and the shared status palette into the feature', () => {
    const points = publishedProjectPoints([project()], 'USD')
    expect(points[0]?.geometry.coordinates).toEqual([29.9, -19.1])
    expect(points[0]?.properties.color).toBe(FINANCE_PROJECT_STATUS.in_progress)
    expect(points[0]?.properties.status).toBe('in_progress')
  })
})

describe('public transparency map helpers (M7)', () => {
  it('offers ONLY the measures the server derived from live publications', () => {
    // A live budget makes the budget measures available, but not actual expenditure.
    const offered = availablePublicMeasures(['revenue_budget', 'expenditure_budget'])
    expect(offered.map((m) => m.key)).toEqual(['expenditure_budget', 'revenue_budget'])
    expect(offered.some((m) => m.key === 'expenditure_actual')).toBe(false)

    expect(availablePublicMeasures([])).toEqual([])
    expect(availablePublicMeasures(['not_a_measure'])).toEqual([])
    expect(availablePublicMeasures(PUBLIC_MEASURES.map((m) => m.key))).toHaveLength(PUBLIC_MEASURES.length)
  })

  it('a blank published figure is NULL, not zero', () => {
    const published = publicRow({ expenditure_budget: '0.00', revenue_budget: null })
    expect(publicMeasureValue(published, 'expenditure_budget')).toBe(0)
    expect(publicMeasureValue(published, 'revenue_budget')).toBeNull()
    // A ward with no row at all is unknown, not an empty ward.
    expect(publicMeasureValue(null, 'expenditure_budget')).toBeNull()
  })

  it('project count is a separate server aggregate and is never inferred from a ward row', () => {
    const published = publicRow({})
    expect(publicMeasureValue(published, 'project_count')).toBeNull()
    expect(publicMeasureValue(published, 'project_count', 4)).toBe(4)
    expect(publicMeasureValue(null, 'project_count', 4)).toBeNull()
  })

  it('percentages stay numeric and NULL where the ratio is undefined', () => {
    const published = publicRow({ expenditure_execution_percentage: 0 })
    expect(publicMeasureValue(published, 'expenditure_execution_percentage')).toBe(0)
    expect(publicMeasureValue(publicRow({}), 'expenditure_execution_percentage')).toBeNull()
  })
})
