import { describe, it, expect } from 'vitest'
import { buildReport, periodFor, inWindow, reportCsv, type ReportInput } from '../report'

const empty: ReportInput = {
  inspections: [], notices: [], outbreaks: [], samples: [], complaints: [],
  programmes: [], handlers: [], burials: [], clearances: [],
}
const line = (blocks: ReturnType<typeof buildReport>, title: string, label: string) =>
  blocks.find(b => b.title === title)!.lines.find(l => l.label === label)!.value

describe('periodFor', () => {
  const now = new Date(2026, 0, 15) // 15 Jan 2026
  it('wraps last quarter into the previous year', () => {
    const p = periodFor('last_quarter', now)
    expect(p.label).toBe('Q4 2025')
    expect(p.from).toEqual(new Date(2025, 9, 1))
    expect(p.to.getMonth()).toBe(11)
  })
  it('wraps last month into the previous year', () => {
    expect(periodFor('last_month', now).from).toEqual(new Date(2025, 11, 1))
  })
  it('includes the whole last day of the window', () => {
    const p = periodFor('this_month', now)
    expect(inWindow(new Date(2026, 0, 31, 23, 30).toISOString(), p)).toBe(true)
    expect(inWindow(new Date(2026, 1, 1, 0, 0).toISOString(), p)).toBe(false)
  })
})

describe('buildReport', () => {
  const p = periodFor('this_month', new Date(2026, 8, 14))
  const inSep = new Date(2026, 8, 10).toISOString()
  const inAug = new Date(2026, 7, 10).toISOString()

  it('counts only records inside the window', () => {
    const r = buildReport({
      ...empty,
      inspections: [
        { inspectedAt: inSep, verdict: 'pass', scope: 'food_hygiene' },
        { inspectedAt: inAug, verdict: 'fail', scope: 'food_hygiene' },
      ],
    }, p)
    expect(line(r, 'Premises inspections', 'Inspections carried out')).toBe(1)
  })

  it('computes compliance over decided inspections, not pending ones', () => {
    const r = buildReport({
      ...empty,
      inspections: [
        { inspectedAt: inSep, verdict: 'pass', scope: 'general' },
        { inspectedAt: inSep, verdict: 'fail', scope: 'general' },
        { inspectedAt: inSep, verdict: 'pending', scope: 'general' },
      ],
    }, p)
    expect(line(r, 'Premises inspections', 'Compliance rate')).toBe('50%')
  })

  it('shows a dash rather than 0% when nothing was tested', () => {
    const r = buildReport({ ...empty, samples: [{ sampledAt: inSep, result: 'pending' }] }, p)
    expect(line(r, 'Water quality', 'Failure rate (of tested)')).toBe('—')
    expect(line(r, 'Water quality', 'Samples taken')).toBe(1)
  })

  it('sums cases and never adds programme quantities across units', () => {
    const r = buildReport({
      ...empty,
      outbreaks: [
        { firstReportedAt: inSep, disease: 'cholera', casesCount: 4, status: 'investigating' },
        { firstReportedAt: inSep, disease: 'typhoid', casesCount: 2, status: 'closed' },
      ],
      programmes: [
        { scheduledFor: inSep, status: 'completed', programmeType: 'indoor_residual_spray', targetQuantity: 100, achievedQuantity: 80, quantityUnit: 'households' },
        { scheduledFor: inSep, status: 'completed', programmeType: 'indoor_residual_spray', targetQuantity: 5, achievedQuantity: 5, quantityUnit: 'villages' },
      ],
    }, p)
    expect(line(r, 'Disease surveillance', 'Cases')).toBe(6)
    expect(line(r, 'Field programmes', '— Indoor residual spray')).toBe('80 of 100 households (80%)')
  })
})

describe('reportCsv', () => {
  it('quotes values so commas and quotes survive', () => {
    const csv = reportCsv([{ title: 'A, "B"', lines: [{ label: 'x', value: 1 }] }], periodFor('this_year', new Date(2026, 0, 1)))
    expect(csv).toContain('"A, ""B"""')
  })
})
