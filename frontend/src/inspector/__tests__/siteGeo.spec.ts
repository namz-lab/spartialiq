import { describe, it, expect } from 'vitest'
import {
  assessmentCopy,
  distanceM,
  formatMetres,
  formatSqm,
  geoVerdictCopy,
  isPositioned,
  nextStageFor,
  planRun,
  precisionCopy,
  siteStatusClass,
  sortConstraints,
  describeConstraints,
} from '../siteGeo'
import type { ConstraintStatus } from '@/services/inspectorGis'

describe('site precision', () => {
  it('only boundary and point sites can be navigated to and geofenced', () => {
    expect(isPositioned('boundary')).toBe(true)
    expect(isPositioned('point')).toBe(true)
    expect(isPositioned('area')).toBe(false)
    expect(isPositioned('none')).toBe(false)
    expect(isPositioned(null)).toBe(false)
  })

  it('names the farm an unpositioned site lies within, rather than pretending to locate it', () => {
    const c = precisionCopy('area', { label: 'Communal Land', areaHa: 74430.7 })
    expect(c.tone).toBe('warning')
    expect(c.detail).toContain('Communal Land')
    expect(c.detail).toContain('74,431 ha')
    expect(c.detail).toMatch(/Record the site position/)
  })
})

describe('constraint ordering', () => {
  it('puts conflicts and reviews above clear, keeping order within a group', () => {
    const rows = [
      { key: 'a', status: 'clear' as const },
      { key: 'b', status: 'review' as const },
      { key: 'c', status: 'no_data' as const },
      { key: 'd', status: 'conflict' as const },
      { key: 'e', status: 'review' as const },
    ]
    expect(sortConstraints(rows).map(r => r.key)).toEqual(['d', 'b', 'e', 'c', 'a'])
  })
})

describe('identify and verification wording', () => {
  it('flags a structure with no linked case without calling it illegal', () => {
    const c = assessmentCopy('structure_without_case')
    expect(c.tone).toBe('negative')
    expect(c.detail).toMatch(/Check whether it is authorised/)
    expect(c.detail).not.toMatch(/illegal/i)
  })

  it('treats a discrepancy as something to review, not a proven absence', () => {
    expect(geoVerdictCopy('discrepancy').detail).toMatch(/Review/)
    expect(geoVerdictCopy('insufficient').tone).toBe('warning')
  })
})

describe('siteStatusClass', () => {
  const base = {
    openEnforcement: 0, lastResult: null, hasOccupationCertificate: false,
    permitStatus: 'approved', scheduledAt: null, inspectedAt: null,
  }
  const now = new Date(2026, 8, 13, 10, 0)

  it('open enforcement outranks everything', () => {
    expect(siteStatusClass({ ...base, openEnforcement: 1, hasOccupationCertificate: true }, now)).toBe('enforcement')
  })

  it('separates overdue, due today and routine visits by calendar day', () => {
    expect(siteStatusClass({ ...base, scheduledAt: '2026-09-12T15:00:00' }, now)).toBe('overdue')
    expect(siteStatusClass({ ...base, scheduledAt: '2026-09-13T16:00:00' }, now)).toBe('due')
    expect(siteStatusClass({ ...base, scheduledAt: '2026-09-15T08:00:00' }, now)).toBe('active')
    expect(siteStatusClass({ ...base, scheduledAt: '2026-09-12T15:00:00', inspectedAt: '2026-09-12T16:00:00' }, now)).toBe('active')
  })

  it('failed stages, occupied buildings and undecided permits each read differently', () => {
    expect(siteStatusClass({ ...base, lastResult: 'reinspection_required' }, now)).toBe('failed')
    expect(siteStatusClass({ ...base, hasOccupationCertificate: true }, now)).toBe('occupied')
    expect(siteStatusClass({ ...base, permitStatus: 'under_review' }, now)).toBe('awaiting')
  })
})

describe('nextStageFor', () => {
  const none = { lastStage: null, lastResult: null, hasOccupationCertificate: false }
  it('starts at setting out, advances on a pass and repeats on a failure', () => {
    expect(nextStageFor(none)).toEqual({ stage: 1, label: 'Stage 1 · Setting out' })
    expect(nextStageFor({ ...none, lastStage: 2, lastResult: 'pass' }).stage).toBe(3)
    expect(nextStageFor({ ...none, lastStage: 2, lastResult: 'conditional_pass' }).stage).toBe(3)
    expect(nextStageFor({ ...none, lastStage: 4, lastResult: 'fail' }).label).toMatch(/Stage 4 .*re-inspection/)
    expect(nextStageFor({ ...none, lastStage: 5, lastResult: null }).stage).toBe(5)
    expect(nextStageFor({ ...none, lastStage: 9, lastResult: 'pass' }).stage).toBe(9)
    expect(nextStageFor({ ...none, hasOccupationCertificate: true }).stage).toBeNull()
  })
})

describe('planRun', () => {
  const office: [number, number] = [29.80, -19.45]

  it('visits the nearest stop first and accumulates straight-line legs', () => {
    const stops = [
      { id: 'far', center: [29.90, -19.45] as [number, number] },
      { id: 'near', center: [29.81, -19.45] as [number, number] },
      { id: 'mid', center: [29.85, -19.45] as [number, number] },
    ]
    const run = planRun(office, stops)
    expect(run.map(l => l.stop.id)).toEqual(['near', 'mid', 'far'])
    const total = run.reduce((s, l) => s + l.legM, 0)
    expect(run[2].cumulativeM).toBeCloseTo(total, 6)
    expect(run[2].cumulativeM).toBeCloseTo(distanceM(office, [29.90, -19.45]), -1)
  })

  it('skips stops without a usable position and does not mutate the input', () => {
    const stops = [
      { id: 'ok', center: [29.81, -19.45] as [number, number] },
      { id: 'bad', center: [Number.NaN, -19.45] as [number, number] },
    ]
    const run = planRun(office, stops)
    expect(run.map(l => l.stop.id)).toEqual(['ok'])
    expect(stops).toHaveLength(2)
  })
})

describe('formatting', () => {
  it('formats distances and areas for field reading', () => {
    expect(formatMetres(0.2)).toBe('< 1 m')
    expect(formatMetres(27.4)).toBe('27 m')
    expect(formatMetres(1520)).toBe('1.5 km')
    expect(formatMetres(null)).toBe('—')
    expect(formatSqm(1238)).toBe('1,238 m²')
    expect(formatSqm(45496)).toBe('4.55 ha')
  })
})

describe('describeConstraints — screening written as findings', () => {
  const when = () => '1 Jan 2026, 09:00'
  const base = { generatedAt: '2026-01-01T09:00:00Z', site: { precision: 'boundary' as const } }
  type Row = {
    label: string
    basis: 'statutory' | 'council_review'
    reference: string
    thresholdM: number
    status: ConstraintStatus
    distanceM: number | null
    feature: { name: string | null } | null
  }
  const c = (over: Partial<Row> = {}): Row => ({
    label: 'Watercourse', basis: 'statutory', reference: 'EMA stream-bank protection (30 m)',
    thresholdM: 30, status: 'review', distanceM: 12, feature: null, ...over,
  })

  it('reports the measured distance, the threshold and the authority for it', () => {
    const out = describeConstraints({ ...base, constraints: [c({ feature: { name: 'Gweru River' } })] }, when)
    expect(out).toContain('Watercourse (Gweru River)')
    expect(out).toContain('12 m from the site')
    expect(out).toContain('threshold 30 m')
    expect(out).toContain('EMA stream-bank protection (30 m)')
  })

  it('marks a council review distance as such, never as statute', () => {
    const out = describeConstraints({ ...base, constraints: [
      c({ label: 'Cemetery', basis: 'council_review', reference: 'Council review distance', thresholdM: 100 }),
    ] }, when)
    expect(out).toContain('council review distance, Council review distance')
  })

  it('says a constraint overlaps the site when there is no distance to give', () => {
    expect(describeConstraints({ ...base, constraints: [
      c({ label: 'Protected area', status: 'conflict', distanceM: null }),
    ] }, when)).toContain('Protected area: overlaps the site')
  })

  it('reads "not checked" for a missing layer and never "clear"', () => {
    const out = describeConstraints({ ...base, constraints: [
      c({ label: 'Water body or wetland', status: 'no_data', distanceM: null }),
    ] }, when)
    expect(out).toContain('Not checked (layer unavailable): Water body or wetland')
    expect(out).not.toMatch(/clear/i)
  })

  it('counts only the layers that actually had data when nothing is flagged', () => {
    const out = describeConstraints({ ...base, constraints: [
      c({ status: 'clear', distanceM: 900 }),
      c({ label: 'Railway line', status: 'clear', distanceM: 800 }),
      c({ label: 'Cemetery', status: 'no_data', distanceM: null }),
    ] }, when)
    expect(out).toContain('No mapped constraint within its screening distance (2 layers checked)')
    expect(out).toContain('Not checked (layer unavailable): Cemetery')
  })

  it('states when no layer could be checked at all', () => {
    expect(describeConstraints({ ...base, constraints: [
      c({ status: 'no_data', distanceM: null }),
    ] }, when)).toContain('No constraint layers were available for this site.')
  })

  it('never states a verdict — the officer rates the risk, not the tool', () => {
    const out = describeConstraints({ ...base, constraints: [
      c({ status: 'conflict', distanceM: 4 }),
    ] }, when)
    expect(out).not.toMatch(/objection|EIA required|risk|approved|refuse/i)
  })

  it('is empty for no report, so a failed screening cannot prefill findings', () => {
    expect(describeConstraints(null)).toBe('')
  })
})
