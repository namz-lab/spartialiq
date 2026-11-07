import { describe, it, expect } from 'vitest'
import { filterPermits, toCsv, type ReportColumn } from '@/composables/useReportBuilder'
import type { PermitApplication } from '@/services/developmentManagementService'

function p(over: Partial<PermitApplication>): PermitApplication {
  return {
    id: '1', status: 'registered', development_type: 'new_building', suburb_ward: 'Ward 5',
    applicant_name: 'A', stand_number: '1234', received_at: '2026-06-01', created_at: '2026-06-01T00:00:00Z',
    ...over,
  } as unknown as PermitApplication
}

describe('useReportBuilder.filterPermits', () => {
  const rows = [
    p({ id: 'a', status: 'approved', development_type: 'rezoning', suburb_ward: 'Ward 5', stand_number: '100', received_at: '2026-06-01' }),
    p({ id: 'b', status: 'registered', development_type: 'new_building', suburb_ward: 'Ward 7', stand_number: '200', received_at: '2026-01-01' }),
    p({ id: 'c', status: 'refused', development_type: 'new_building', suburb_ward: 'Ward 5', stand_number: '300', received_at: '2026-06-05' }),
  ]

  it('filters by status', () => {
    expect(filterPermits(rows, { status: 'approved' }).map(r => r.id)).toEqual(['a'])
  })
  it('filters by development type', () => {
    expect(filterPermits(rows, { development_type: 'new_building' }).map(r => r.id)).toEqual(['b', 'c'])
  })
  it('filters by ward (contains, case-insensitive)', () => {
    expect(filterPermits(rows, { ward: 'ward 5' }).map(r => r.id)).toEqual(['a', 'c'])
  })
  it('filters by received date range', () => {
    expect(filterPermits(rows, { from: '2026-06-01', to: '2026-06-30' }).map(r => r.id)).toEqual(['a', 'c'])
  })
  it('filters by free-text search across ref/stand/applicant', () => {
    expect(filterPermits(rows, { search: '300' }).map(r => r.id)).toEqual(['c'])
  })
  it('treats "all" as no filter', () => {
    expect(filterPermits(rows, { status: 'all', development_type: 'all' }).length).toBe(3)
  })
})

describe('useReportBuilder.toCsv', () => {
  const cols: ReportColumn[] = [
    { key: 'stand', label: 'Stand', get: r => r.stand_number || '' },
    { key: 'app', label: 'Applicant', get: r => r.applicant_name || '' },
  ]
  it('builds header + rows', () => {
    expect(toCsv([p({ stand_number: '1', applicant_name: 'Jo' })], cols)).toBe('Stand,Applicant\n1,Jo')
  })
  it('escapes commas and quotes', () => {
    expect(toCsv([p({ stand_number: '1', applicant_name: 'Doe, "J"' })], cols)).toContain('"Doe, ""J"""')
  })
  it('returns header only for empty rows', () => {
    expect(toCsv([], cols)).toBe('Stand,Applicant')
  })
})
