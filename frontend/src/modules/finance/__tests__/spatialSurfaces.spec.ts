// @vitest-environment happy-dom
//
// The spatial surfaces, pinned at the places where an honest answer and a convenient one differ.
//
// These are the rules the GIS–finance audit treats as binding, each one expressed as a test
// rather than as a comment in a template:
//
//   * NULL IS NOT ZERO, and it is not a pass. A ward with no budget has no figure, a project with
//     no progress report has no percentage, and a spend-versus-progress flag that could not be
//     evaluated is "not compared" — never "within tolerance".
//   * A SCALE OVER ONE VALUE IS NOT A SCALE. With no ward-tagged figure anywhere — the live state
//     of this database — the choropleth has no classes, and the paint expression must still be one
//     MapLibre will accept. It was not: a stop-less `step` was refused on every repaint.
//   * AN UNLOCATED RECORD IS LISTED, NEVER PLACED, and an unregistered ward code is flagged, never
//     dropped.
//   * THE PUBLIC MAP OFFERS ONLY WHAT IS PUBLISHED, and infers nothing from a neighbouring dataset.
//   * A SPLIT IS DECIDED BY SOMEONE OTHER THAN ITS AUTHOR, and a reduction that its own approved
//     geography refuses (decision D16) hands the officer the splits in the way.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../api/financeApi', () => ({
  financeApi: {
    budgetLines: vi.fn(),
    revisions: vi.fn(),
    projects: vi.fn(),
    imports: vi.fn(),
    publications: vi.fn(),
    budgetExceptions: vi.fn(),
    audit: vi.fn(),
    spatialAllocations: vi.fn(),
  },
}))

import { financeApi } from '../api/financeApi'
import { collectFinanceQueues } from '../composables/useFinanceQueues'
import { useFinanceStore } from '../stores/finance'
import type { FinancialYear } from '../models/types'
import type { PublicWardMapRow, SpatialAllocation, WardPerformanceRow } from '../api/financeApi'
import {
  WEBGL_LOST_MESSAGE, availablePublicMeasures, canvasState, circleRadiusExpression, computeBreaks,
  fillExpression, formatMeasure, measureValue, publicMeasureValue, publishedProjectPoints,
  rowsByWard,
} from '../composables/useFinanceMap'
import { describeProgress, describeSpendVsProgress } from '../composables/useProjectProgress'
import {
  allocationOverrunConflict, conflictSplits, validateAllocationDraft,
} from '../composables/useSpatialAllocation'
import { wardCodeStatus, wardOptionsWith } from '../composables/useWardRegister'
import { FINANCE_NO_DATA } from '@/map/vunguBasemapStyle'
import { baseMapStyle } from '@/map/vunguBasemapStyle'

const api = financeApi as unknown as Record<string, ReturnType<typeof vi.fn>>

const wardRow = (over: Partial<WardPerformanceRow> = {}): WardPerformanceRow => ({
  authority_id: 'a', financial_year_id: 'y', currency: 'USD', ward_code: 'ZW170401',
  unlocated_reason: null, ward_status: 'linked', ward_register_basis: 'interim',
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

// ── The paint expressions MapLibre has to accept ─────────────────────────────────────────────
//
// `fill-color[3]: Expected at least 4 arguments, but found only 2` was a real refusal in the
// running app, on every repaint, in the state this council is actually in. MapLibre needs
// ['step', input, output0, stop1, output1] — at minimum four elements after the operator — and
// `computeBreaks` correctly returns [] when there is nothing to classify.

/**
 * Minimum arity, as the MapLibre expression grammar states it.
 *
 * A literal arm (a colour, a radius) is a leaf and is accepted as it stands; only a nested array
 * is itself an expression that has to satisfy the grammar.
 */
function assertValidExpression(expr: unknown): void {
  if (!Array.isArray(expr)) return
  const e = expr as unknown[]
  const op = e[0]
  if (op === 'step') {
    // input + output0 + at least one (stop, output) pair.
    expect(e.length, `step: ${JSON.stringify(e)}`).toBeGreaterThanOrEqual(5)
    expect((e.length - 3) % 2).toBe(0)
  }
  if (op === 'case') {
    // at least one (condition, output) pair plus the fallback.
    expect(e.length, `case: ${JSON.stringify(e)}`).toBeGreaterThanOrEqual(4)
    expect(e.length % 2).toBe(0)
  }
  if (op === 'match') {
    expect(e.length, `match: ${JSON.stringify(e)}`).toBeGreaterThanOrEqual(5)
  }
  for (const child of e.slice(1)) assertValidExpression(child)
}

describe('choropleth breaks and the expressions built from them', () => {
  it('refuses to invent a scale: no values, one value and all-equal values give no classes', () => {
    expect(computeBreaks([])).toEqual([])
    expect(computeBreaks([42])).toEqual([])
    expect(computeBreaks([7, 7, 7, 7])).toEqual([])
  })

  it('computes quantile edges from the data once there is something to classify', () => {
    const breaks = computeBreaks([10, 20, 30, 40, 50])
    expect(breaks.length).toBeGreaterThan(0)
    // Every edge is a value that exists, in order, with no repeats — a repeated edge would
    // render a class nothing can fall into.
    expect([...breaks].sort((a, b) => a - b)).toEqual(breaks)
    expect(new Set(breaks).size).toBe(breaks.length)
    for (const edge of breaks) expect([10, 20, 30, 40, 50]).toContain(edge)
  })

  it('emits a MapLibre-valid fill expression with no breaks — the live state of this council', () => {
    const expr = fillExpression([]) as unknown[]
    assertValidExpression(expr)
    expect(expr[0]).toBe('case')
    // The no-data arm, and a flat colour rather than a stop-less step.
    expect(expr[2]).toBe(FINANCE_NO_DATA)
    expect(Array.isArray(expr[3])).toBe(false)
  })

  it('emits a MapLibre-valid fill expression for one, two and five classes', () => {
    for (const values of [[5], [5, 9], [1, 2, 3, 4, 5, 6, 7, 8]]) {
      const expr = fillExpression(computeBreaks(values))
      assertValidExpression(expr)
    }
  })

  it('never shades a ward with no figure in the bottom class', () => {
    const expr = fillExpression(computeBreaks([10, 20, 30])) as unknown[]
    expect(expr[0]).toBe('case')
    expect(expr[1]).toEqual(['==', ['get', 'value'], null])
    expect(expr[2]).toBe(FINANCE_NO_DATA)
  })

  it('gives a project with no figure the minimum radius, never zero, and never an invalid step', () => {
    for (const values of [[], [1000], [1000, 1000], [100, 500, 900, 4000]]) {
      const expr = circleRadiusExpression(computeBreaks(values)) as unknown[]
      assertValidExpression(expr)
      expect(expr[0]).toBe('case')
      expect(expr[2]).toBeGreaterThan(0)
    }
  })
})

// ── A canvas that cannot draw ────────────────────────────────────────────────────────────────
//
// MapLibre does not recover from a lost WebGL context, and a browser drops one under GPU or
// memory pressure — a real condition on the machines this platform targets. A blank choropleth
// beside a populated legend reads as "this ward has no budget", so the surface must say what
// happened and keep the table, whose figures are still valid.

describe('a lost WebGL context', () => {
  it('replaces the canvas with a sentence and keeps the ward table', () => {
    const state = canvasState({ contextLost: true, wardRegisterLinked: true, wardCount: 19 })
    expect(state.showCanvas).toBe(false)
    expect(state.showTable).toBe(true)
    expect(state.message).toBe(WEBGL_LOST_MESSAGE)
    expect(state.offerRetry).toBe(true)
  })

  it('says it is a display failure, not a finding, and that unshaded is not zero', () => {
    expect(WEBGL_LOST_MESSAGE).toContain('display failure, not a finding')
    expect(WEBGL_LOST_MESSAGE).toContain('not a ward with no')
    expect(WEBGL_LOST_MESSAGE).not.toMatch(/\b0\b/)
  })

  it('renders no measure as zero in that state — every absence stays an absence', () => {
    // The table is what the reader falls back to, and it formats from the same helpers. A ward
    // with no figure must read as an absence there too, however the canvas is behaving.
    const row = wardRow()
    expect(formatMeasure(row, 'expenditure_budget')).not.toBe('0')
    expect(formatMeasure(row, 'expenditure_budget')).not.toContain('0.00')
    expect(formatMeasure(row, 'execution')).toBe('not defined')
    expect(measureValue(row, 'expenditure_budget')).not.toBe(0)
  })

  it('still reports a lost context when the register has no wards to table', () => {
    const state = canvasState({ contextLost: true, wardRegisterLinked: false, wardCount: 0 })
    expect(state.message).toBe(WEBGL_LOST_MESSAGE)
    expect(state.showTable).toBe(false)
  })

  it('draws the canvas normally when the context is healthy and the register is linked', () => {
    const state = canvasState({ contextLost: false, wardRegisterLinked: true, wardCount: 19 })
    expect(state.showCanvas).toBe(true)
    expect(state.message).toBeNull()
    expect(state.offerRetry).toBe(false)
  })

  it('draws no canvas at all when the register is not linked', () => {
    // Audit §6.5: an empty grey district is read as "nothing was spent here".
    expect(canvasState({ contextLost: false, wardRegisterLinked: false, wardCount: 0 }).showCanvas)
      .toBe(false)
  })
})

describe('the sheet a finance map is drawn on', () => {
  it('carries a background layer and glyphs, so the map can finish loading', () => {
    // A map created without a style never fires `load`, so the basemap and every overlay layer
    // are never added and the canvas stays transparent. This was measured in the running app.
    const style = baseMapStyle()
    expect(style.version).toBe(8)
    expect(style.glyphs).toContain('{fontstack}')
    expect(style.layers).toHaveLength(1)
    expect(style.layers[0].type).toBe('background')
  })
})

// ── Null is not zero, measure by measure ─────────────────────────────────────────────────────

describe('a ward measure that was not recorded', () => {
  it('stays null through the value path, so it can never be classified', () => {
    expect(measureValue(wardRow(), 'expenditure_budget')).toBeNull()
    expect(measureValue(wardRow(), 'execution')).toBeNull()
    expect(measureValue(wardRow(), 'revenue_collection_percentage')).toBeNull()
    expect(measureValue(wardRow({ expenditure_budget: '0.00' }), 'expenditure_budget')).toBe(0)
  })

  it('renders as an absence, and a recorded zero renders as a zero', () => {
    expect(formatMeasure(wardRow(), 'expenditure_budget')).toBe('—')
    expect(formatMeasure(wardRow(), 'execution')).toBe('not defined')
    expect(formatMeasure(wardRow({ expenditure_execution_percentage: 0 }), 'execution'))
      .not.toBe('not defined')
  })

  it('keeps one currency per map: a ZWG figure cannot shade a USD choropleth', () => {
    const rows = [
      wardRow({ ward_code: 'ZW170401', currency: 'USD', expenditure_budget: '100.00' }),
      wardRow({ ward_code: 'ZW170402', currency: 'ZWG', expenditure_budget: '99999.00' }),
    ]
    const joined = rowsByWard(rows, 'USD')
    expect([...joined.keys()]).toEqual(['ZW170401'])
  })

  it('never lets an unlocated row reach the choropleth', () => {
    const rows = [wardRow({ ward_code: 'ZW170401', unlocated_reason: 'unallocated_remainder' })]
    expect(rowsByWard(rows, 'USD').size).toBe(0)
  })
})

// ── Physical progress (decision D12) ─────────────────────────────────────────────────────────

describe('physical progress and the spend comparison', () => {
  it('distinguishes "not recorded" from a reported nothing-built-yet', () => {
    expect(describeProgress(null)).toBe('not recorded')
    expect(describeProgress(undefined)).toBe('not recorded')
    expect(describeProgress(0)).toContain('nothing built yet')
    expect(describeProgress(0)).not.toBe('not recorded')
    expect(describeProgress(42.5)).not.toContain('not recorded')
  })

  it('reads a null flag as NOT COMPARED, and never as a pass', () => {
    const noProgress = describeSpendVsProgress({
      physicalProgressPercent: null, executionPercentage: 80,
      gapPoints: null, aheadOfProgress: null, thresholdPoints: 15,
    })
    expect(noProgress.label).toBe('not compared')
    expect(noProgress.notCompared).toBe(true)
    expect(noProgress.exception).toBe(false)
    expect(noProgress.why).toContain('not a statement that the spend is in order')
    expect(noProgress.why).toContain('no physical progress has been recorded')
  })

  it('names the reason the comparison could not be made', () => {
    expect(describeSpendVsProgress({
      physicalProgressPercent: 40, executionPercentage: null,
      gapPoints: null, aheadOfProgress: null, thresholdPoints: 15,
    }).why).toContain('nothing has been allocated')

    expect(describeSpendVsProgress({
      physicalProgressPercent: 40, executionPercentage: 80,
      gapPoints: 40, aheadOfProgress: null, thresholdPoints: null,
    }).why).toContain('threshold')
  })

  it('reports an exception only when the view actually raised one', () => {
    const flagged = describeSpendVsProgress({
      physicalProgressPercent: 40, executionPercentage: 80,
      gapPoints: 40, aheadOfProgress: true, thresholdPoints: 15,
    })
    expect(flagged.exception).toBe(true)
    expect(flagged.label).toContain('ahead of recorded progress')
    expect(flagged.why).toContain('40 percentage points')

    const fine = describeSpendVsProgress({
      physicalProgressPercent: 40, executionPercentage: 42,
      gapPoints: 2, aheadOfProgress: false, thresholdPoints: 15,
    })
    expect(fine.exception).toBe(false)
    expect(fine.notCompared).toBe(false)
  })
})

// ── Unlocated is listed, never placed ────────────────────────────────────────────────────────

describe('a project with no released coordinate', () => {
  const project = (over: Record<string, unknown>) => ({
    project_id: 'p', status: 'approved', currency: 'USD',
    longitude: null, latitude: null, ...over,
  })

  it('is not turned into a point by a ward code or by anything else', () => {
    const points = publishedProjectPoints([
      project({ project_id: 'a', longitude: null, latitude: null }),
      project({ project_id: 'b', longitude: 29.9, latitude: null }),
      project({ project_id: 'c', longitude: '29.9', latitude: '-19.1' }),
    ] as never, 'USD')
    expect(points).toHaveLength(0)
  })

  it('is drawn only where both coordinates are finite numbers in the chosen currency', () => {
    const points = publishedProjectPoints([
      project({ project_id: 'a', longitude: 29.9, latitude: -19.1 }),
      project({ project_id: 'b', longitude: 29.8, latitude: -19.2, currency: 'ZWG' }),
    ] as never, 'USD')
    expect(points.map((p) => p.properties.project_id)).toEqual(['a'])
    expect(points[0].geometry.coordinates).toEqual([29.9, -19.1])
  })
})

// ── The ward register (GAP-10) ───────────────────────────────────────────────────────────────

describe('the ward picker', () => {
  const register = [
    { code: 'ZW170401', name: '1' },
    { code: 'ZW170402', name: '2' },
  ]

  it('keeps a code the register does not carry, and flags it rather than dropping it', () => {
    const options = wardOptionsWith(register, 'LEGACY-7')
    expect(options.map((o) => o.code)).toContain('LEGACY-7')
    expect(options.find((o) => o.code === 'LEGACY-7')?.inRegister).toBe(false)
    expect(options.find((o) => o.code === 'ZW170401')?.inRegister).toBe(true)
  })

  it('does not duplicate a code that is already in the register', () => {
    expect(wardOptionsWith(register, 'ZW170401')).toHaveLength(2)
  })

  it('says "unknown" rather than "unlinked" while the register is not loaded', () => {
    expect(wardCodeStatus('ZW170401', [], null)).toBe('unknown')
    expect(wardCodeStatus('ZW170401', [], false)).toBe('unknown')
    expect(wardCodeStatus('', register, true)).toBe('unknown')
    expect(wardCodeStatus('ZW170401', register, true)).toBe('linked')
    expect(wardCodeStatus('LEGACY-7', register, true)).toBe('unlinked')
  })
})

// ── The public map: only what is published ───────────────────────────────────────────────────

describe('the public transparency map', () => {
  it('offers exactly the measures the server named, and never infers one from another', () => {
    // A live budget publication with no expenditure publication: budgets are offered, actual
    // expenditure is not, so a resident cannot read a blank as "0 % executed".
    const offered = availablePublicMeasures(['revenue_budget', 'expenditure_budget'])
    expect(offered.map((m) => m.key).sort()).toEqual(['expenditure_budget', 'revenue_budget'])
    expect(offered.map((m) => m.key)).not.toContain('expenditure_actual')
    expect(offered.map((m) => m.key)).not.toContain('expenditure_execution_percentage')
  })

  it('offers nothing at all when nothing is published', () => {
    expect(availablePublicMeasures([])).toEqual([])
  })

  it('never ranks a measure the council has not published, even if the column exists', () => {
    const row: PublicWardMapRow = {
      ward_code: 'ZW170401', ward_status: 'linked', currency: 'USD', ward_register_basis: 'interim',
      revenue_budget: '100.00', revenue_actual: null, revenue_variance: null,
      revenue_collection_percentage: null, expenditure_budget: '200.00',
      expenditure_actual: null, expenditure_execution_percentage: null,
    }
    expect(publicMeasureValue(row, 'expenditure_actual')).toBeNull()
    expect(publicMeasureValue(row, 'expenditure_budget')).toBe(200)
    // A project count the payload did not carry is absent, not zero.
    expect(publicMeasureValue(row, 'project_count')).toBeNull()
    expect(publicMeasureValue(row, 'project_count', 3)).toBe(3)
  })
})

// ── Spatial allocation: the methodology, and the D16 refusal ─────────────────────────────────

describe('recording a ward split', () => {
  it('will not accept a split with no stated methodology', () => {
    const errors = validateAllocationDraft({
      targetCode: 'ZW170401', amount: '1000.00', methodology: '   ',
    })
    expect(errors.methodology).toBeTruthy()
  })

  it('accepts a methodology once it says something', () => {
    const errors = validateAllocationDraft({
      targetCode: 'ZW170401', amount: '1000.00',
      methodology: 'Kilometres of road rebuilt in each ward, from the works schedule.',
    })
    expect(errors).toEqual({})
  })
})

describe('a reduction refused by its own approved geography (decision D16)', () => {
  const conflictError = {
    response: {
      status: 409,
      data: {
        error: 'spatial_allocations_exceed_revised',
        message: 'Approved geographic splits of 9000.00 USD would exceed the 5000.00 USD this reduction would leave.',
        approved_split_total: '9000.00',
        revised_amount: '12000.00',
        revised_after: '5000.00',
        currency: 'USD',
        allocation_ids: ['alloc-1', 'alloc-2'],
        target_codes: ['ZW170401', 'ZW170402'],
        withdraw_endpoint: '/api/finance/spatial-allocations/:id/withdraw',
      },
    },
  }

  it('is recognised and its figures are carried as decimal strings, never parsed', () => {
    const conflict = allocationOverrunConflict(conflictError)
    expect(conflict).not.toBeNull()
    expect(conflict!.approvedSplitTotal).toBe('9000.00')
    expect(conflict!.revisedAfter).toBe('5000.00')
    expect(typeof conflict!.revisedAmount).toBe('string')
    expect(conflict!.currency).toBe('USD')
  })

  it('names the splits in the way, so each can be withdrawn by its ward', () => {
    const conflict = allocationOverrunConflict(conflictError)!
    expect(conflictSplits(conflict)).toEqual([
      { id: 'alloc-1', targetCode: 'ZW170401' },
      { id: 'alloc-2', targetCode: 'ZW170402' },
    ])
  })

  it('still lists a ward the payload could not identify, rather than hiding it', () => {
    const conflict = allocationOverrunConflict({
      response: {
        status: 409,
        data: {
          error: 'spatial_allocations_exceed_revised',
          message: 'refused',
          allocation_ids: ['alloc-1'],
          target_codes: ['ZW170401', 'ZW170402'],
        },
      },
    })!
    const rows = conflictSplits(conflict)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual({ id: null, targetCode: 'ZW170402' })
  })

  it('is not confused with any other failure', () => {
    expect(allocationOverrunConflict(new Error('network'))).toBeNull()
    expect(allocationOverrunConflict({ response: { status: 409, data: { error: 'already_decided' } } }))
      .toBeNull()
    expect(allocationOverrunConflict({ response: { status: 403, data: { error: 'self_approval' } } }))
      .toBeNull()
  })
})

// ── The split decision queue (GAP-2) ─────────────────────────────────────────────────────────

const YEAR: FinancialYear = {
  id: 'y1', label: '2031', start_date: '2031-01-01', end_date: '2031-12-31',
  status: 'open', reporting_currency: 'USD', notes: null, opened_at: null, closed_at: null,
}

const allocation = (over: Partial<SpatialAllocation>): SpatialAllocation => ({
  id: 'a1', authority_id: 1, subject_kind: 'budget_line', subject_id: 'b1', target_kind: 'ward',
  target_code: 'ZW170401', amount: '1000.00', currency: 'USD', share: null,
  methodology: 'Kilometres of road in each ward.', evidence_document_id: null, status: 'draft',
  requested_by: 'someone-else', requested_at: '2031-03-01T00:00:00Z',
  decided_by: null, decided_at: null, decision_note: null,
  created_at: '2031-03-01T00:00:00Z', updated_at: '2031-03-01T00:00:00Z',
  target_status: 'linked', ...over,
})

function signInCommittee(userId = 'me') {
  const store = useFinanceStore()
  store.identity = {
    user_id: userId,
    role: 'finance_committee',
    authority_id: 1,
    permissions: [
      'finance.budget.view', 'finance.budget.approve', 'finance.revision.approve',
      'finance.project.view', 'finance.project.approve', 'finance.map.view',
    ],
    department_scope: [],
    catalogue: [],
  }
  store.years = [YEAR]
  store.selectYear('y1')
  return store
}

describe('ward splits awaiting a decision', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    api.budgetLines.mockResolvedValue({
      lines: [], total: 0, limit: 1, offset: 0, available_balance_includes_commitments: false,
    })
    api.revisions.mockResolvedValue([])
    api.projects.mockResolvedValue([])
    api.imports.mockResolvedValue([])
    api.publications.mockResolvedValue([])
    api.budgetExceptions.mockResolvedValue({
      rows: [], thresholds: { warn_execution_percentage: 90, flag_execution_percentage: 100 }, note: '',
    })
    api.audit.mockResolvedValue({ events: [], limit: 200, offset: 0, note: '' })
    api.spatialAllocations.mockResolvedValue({ allocations: [], limit: 200, offset: 0 })
  })

  it('counts only the drafts someone else recorded', async () => {
    api.spatialAllocations.mockResolvedValue({
      allocations: [
        allocation({ id: 'a1', requested_by: 'someone-else' }),
        allocation({ id: 'a2', requested_by: 'me' }),
        allocation({ id: 'a3', requested_by: 'another' }),
      ],
      limit: 200, offset: 0,
    })
    const store = signInCommittee('me')
    const { queues } = await collectFinanceQueues(store)
    const queue = queues.find((q) => q.id === 'spatial-splits-awaiting-decision')
    expect(queue).toBeDefined()
    expect(queue!.count).toBe(2)
  })

  it('reports the viewer\'s own drafts as awaiting another approver, not as gone', async () => {
    api.spatialAllocations.mockResolvedValue({
      allocations: [allocation({ id: 'a2', requested_by: 'me' })],
      limit: 200, offset: 0,
    })
    const store = signInCommittee('me')
    const { queues } = await collectFinanceQueues(store)
    const queue = queues.find((q) => q.id === 'spatial-splits-awaiting-decision')!
    expect(queue.count).toBe(0)
    expect(queue.caveat).toContain('awaiting another approver')
    expect(queue.caveat).toContain('self_approval')
  })

  it('counts a split only where the viewer holds that subject kind\'s approval', async () => {
    api.spatialAllocations.mockResolvedValue({
      allocations: [
        allocation({ id: 'a1', subject_kind: 'budget_line' }),
        allocation({ id: 'a2', subject_kind: 'project' }),
      ],
      limit: 200, offset: 0,
    })
    const store = signInCommittee('me')
    store.identity = {
      ...store.identity!,
      // Budget approval only: a project split is somebody else's decision.
      permissions: ['finance.budget.view', 'finance.budget.approve', 'finance.map.view'],
    }
    const { queues } = await collectFinanceQueues(store)
    const queue = queues.find((q) => q.id === 'spatial-splits-awaiting-decision')!
    expect(queue.count).toBe(1)
  })

  it('reports a failed read as unknown, never as zero', async () => {
    api.spatialAllocations.mockRejectedValue(new Error('boom'))
    const store = signInCommittee('me')
    const { queues, failures } = await collectFinanceQueues(store)
    const queue = queues.find((q) => q.id === 'spatial-splits-awaiting-decision')!
    expect(queue.count).toBeNull()
    expect(failures).toContain('ward splits awaiting a decision')
  })

  it('is not offered to someone who may decide neither kind', async () => {
    const store = useFinanceStore()
    store.identity = {
      user_id: 'me', role: 'auditor', authority_id: 1,
      permissions: ['finance.budget.view', 'finance.map.view', 'finance.report.view'],
      department_scope: [], catalogue: [],
    }
    store.years = [YEAR]
    store.selectYear('y1')
    const { queues } = await collectFinanceQueues(store)
    expect(queues.find((q) => q.id === 'spatial-splits-awaiting-decision')).toBeUndefined()
    expect(api.spatialAllocations).not.toHaveBeenCalled()
  })
})
