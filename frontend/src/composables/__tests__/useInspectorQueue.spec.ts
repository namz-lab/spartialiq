import { describe, it, expect } from 'vitest'
import {
  bookingToRow, permitToRow, classifyQueue, filterQueue, sortQueue, isSameLocalDay, isOverdue,
  type InspectorQueueRow,
} from '../useInspectorQueue'
import type { InspectionBooking } from '@/services/inspectionsService'
import type { PermitApplication } from '@/services/developmentManagementService'

const NOW = new Date('2026-09-09T10:00:00')

function booking(over: Partial<InspectionBooking> = {}): InspectionBooking {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    applicationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    stageNumber: 2,
    stageName: 'Foundation trenches and footing levels',
    citizenId: null,
    inspectorId: 'insp-1',
    status: 'scheduled',
    feePaidAt: '2026-09-01T00:00:00.000Z',
    scheduledFor: '2026-09-09T08:00:00.000Z',
    completedAt: null,
    passed: null,
    citizenNotes: null,
    inspectorNotes: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

function permit(over: Partial<PermitApplication> = {}): PermitApplication {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    tpd_reference: 'TPD/2026/1',
    dev_register_no: 'DEV/2026/0001',
    stand_number: '1824',
    suburb_ward: 'Ward 4',
    applicant_name: 'A. Moyo',
    applicant_id_number: '00-000000A00',
    applicant_phone: null,
    applicant_email: null,
    development_type: 'new_building',
    description: 'Dwelling',
    status: 'approved',
    fee_paid: true,
    received_at: '2026-08-01T00:00:00.000Z',
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-09-08T00:00:00.000Z',
    lat: -19.45,
    lng: 29.82,
    ...over,
  }
}

describe('isSameLocalDay / isOverdue', () => {
  it('treats a scheduled-for today as today', () => {
    expect(isSameLocalDay('2026-09-09T08:00:00', NOW)).toBe(true)
    expect(isOverdue('2026-09-09T08:00:00', NOW)).toBe(false)
  })
  it('marks yesterday as overdue', () => {
    expect(isOverdue('2026-09-08T08:00:00', NOW)).toBe(true)
    expect(isSameLocalDay('2026-09-08T08:00:00', NOW)).toBe(false)
  })
})

describe('bookingToRow / permitToRow', () => {
  it('maps a scheduled booking to travel-to-site', () => {
    const row = bookingToRow(booking())
    expect(row.source).toBe('booking')
    expect(row.nextAction).toBe('Travel to site')
    expect(row.stageNumber).toBe(2)
  })
  it('maps an approved permit to an inspectable row with coordinates', () => {
    const row = permitToRow(permit())
    expect(row.stand).toBe('1824')
    expect(row.lat).toBe(-19.45)
    expect(row.nextAction).toBe('Open inspection')
  })
})

describe('classifyQueue', () => {
  it('splits today, overdue, failed follow-ups and occupation', () => {
    const rows: InspectorQueueRow[] = [
      bookingToRow(booking()),
      bookingToRow(booking({ id: '33333333-3333-3333-3333-333333333333', scheduledFor: '2026-09-01T00:00:00.000Z' })),
      bookingToRow(booking({ id: '44444444-4444-4444-4444-444444444444', status: 'failed', passed: false, scheduledFor: '2026-09-02T00:00:00.000Z' })),
      permitToRow(permit({ has_occupation_certificate: true })),
    ]
    const b = classifyQueue(rows, NOW)
    expect(b.today.length).toBeGreaterThanOrEqual(1)
    expect(b.overdue.length).toBeGreaterThanOrEqual(1)
    expect(b.followUps.some(r => r.status === 'failed')).toBe(true)
    expect(b.occupation.length).toBeGreaterThanOrEqual(1)
  })
})

describe('filterQueue / sortQueue', () => {
  it('filters by search and status without loading thousands of rows', () => {
    const rows = [
      permitToRow(permit()),
      permitToRow(permit({ id: '55555555-5555-5555-5555-555555555555', stand_number: '99', suburb_ward: 'Ward 1', status: 'approved_with_conditions' })),
    ]
    expect(filterQueue(rows, { search: '1824' })).toHaveLength(1)
    expect(filterQueue(rows, { status: 'approved' })).toHaveLength(1)
  })
  it('sorts by stand', () => {
    const rows = [
      permitToRow(permit({ stand_number: '20' })),
      permitToRow(permit({ id: '66655555-5555-5555-5555-555555555555', stand_number: '3' })),
    ]
    expect(sortQueue(rows, 'stand', 'asc')[0].stand).toBe('3')
  })
})
