import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/services/api', () => ({ default: { get: vi.fn() } }))
import api from '@/services/api'
import { getPermittedUses, getZoningAt, buildZoningEntry, provisionalNotice } from '@/services/developmentControl'

const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>

const envelope = {
  success: true,
  data: {
    parcel: { parcel_id: 42, stand_number: 'Farm 12', township_name: 'Vungu' },
    zone: { zone_id: 3, zone_code: 'PU-R1', zone_name: 'Residential 1' },
    permitted_uses: [
      { group_code: 'RES1', description: 'Dwelling house', category: 'Residential',
        conditions: 'Single dwelling only', max_units: 1, max_height_meters: 8, min_lot_size_sqm: 300 },
    ],
    consent_required_uses: [
      { group_code: 'SHOP', description: 'Tuck shop', category: 'Commercial',
        conditions: null, max_units: null, max_height_meters: null, min_lot_size_sqm: null },
    ],
    prohibited_uses: [
      { group_code: 'IND', description: 'Heavy industry', category: 'Industrial',
        conditions: null, max_units: null, max_height_meters: null, min_lot_size_sqm: null },
    ],
  },
}

describe('getPermittedUses', () => {
  beforeEach(() => { mockedGet.mockReset() })

  it('flattens the 3 arrays and tags permission', async () => {
    mockedGet.mockResolvedValue({ data: envelope })
    const res = await getPermittedUses(42)
    expect(mockedGet).toHaveBeenCalledWith('/development-control/parcels/42/permitted-uses')
    expect(res!.zoneName).toBe('Residential 1')
    expect(res!.uses).toHaveLength(3)
    const res1 = res!.uses.find(u => u.groupCode === 'RES1')!
    expect(res1.permission).toBe('permitted')
    expect(res1.groupName).toBe('Dwelling house')
    expect(res1.maxHeightM).toBe(8)
    expect(res!.uses.find(u => u.groupCode === 'SHOP')!.permission).toBe('special_consent')
    expect(res!.uses.find(u => u.groupCode === 'IND')!.permission).toBe('prohibited')
  })

  it('returns null when the matrix is empty (no zone)', async () => {
    mockedGet.mockResolvedValue({ data: { success: true, data: {
      parcel: {}, zone: null, permitted_uses: [], consent_required_uses: [], prohibited_uses: [] } } })
    expect(await getPermittedUses(42)).toBeNull()
  })

  it('returns null on 404', async () => {
    mockedGet.mockRejectedValue({ response: { status: 404 } })
    expect(await getPermittedUses(99)).toBeNull()
  })
})

describe('buildZoningEntry', () => {
  const base = {
    parcelFid: 42, zoneName: 'Residential 1', zoneCode: 'PU-R1',
    selectedGroupCode: 'RES1', selectedGroupName: 'Dwelling house',
    conditions: 'Single dwelling only', maxHeightM: 8, minLotSqm: 300, maxUnits: 1,
  }
  const at = new Date('2026-06-03T10:00:00Z')

  it('maps permitted → pass with a summary note + snapshot', () => {
    const e = buildZoningEntry({ ...base, permission: 'permitted' }, at)
    expect(e.result).toBe('pass')
    expect(e.notes).toContain('Residential 1')
    expect(e.notes).toContain('Permitted')
    expect(e.notes).toContain('max height 8 m')
    expect(e.snapshot.assessedAt).toBe('2026-06-03T10:00:00.000Z')
    expect(e.snapshot.permission).toBe('permitted')
  })

  it('maps prohibited → fail', () => {
    expect(buildZoningEntry({ ...base, permission: 'prohibited' }, at).result).toBe('fail')
  })

  it('maps special_consent → pass with a "Special consent required" note', () => {
    const e = buildZoningEntry({ ...base, permission: 'special_consent' }, at)
    expect(e.result).toBe('pass')
    expect(e.notes).toContain('Special consent required')
  })
})

describe('getZoningAt', () => {
  beforeEach(() => { mockedGet.mockReset() })

  it('looks the zone up by point and keeps its name', async () => {
    mockedGet.mockResolvedValue({ data: envelope })
    const res = await getZoningAt(29.77, -19.52)
    expect(mockedGet).toHaveBeenCalledWith('/development-control/zoning-at', { params: { lng: 29.77, lat: -19.52 } })
    expect(res!.zoneName).toBe('Residential 1')
    expect(res!.uses.map(u => u.permission)).toEqual(['permitted', 'special_consent', 'prohibited'])
  })

  it('returns null when the point is in no zone', async () => {
    mockedGet.mockResolvedValue({ data: { success: true, data: { zone: null, permitted_uses: [], prohibited_uses: [], consent_required_uses: [] } } })
    expect(await getZoningAt(0, 0)).toBeNull()
  })
})

describe('provisional rules', () => {
  beforeEach(() => { mockedGet.mockReset() })
  const status = (over: Record<string, unknown> = {}) => ({
    planTitle: 'Vungu RDC peri-urban local plan', planStatus: 'unknown', provisional: true, reviewStatus: 'unreviewed' as const, reviewedBy: null, ...over,
  })

  it('says nothing when the plan is in force or nothing is known', () => {
    expect(provisionalNotice(null)).toBeNull()
    expect(provisionalNotice(undefined)).toBeNull()
    expect(provisionalNotice(status({ provisional: false, planStatus: 'gazetted' }))).toBeNull()
  })

  it('calls an unreviewed column in an unconfirmed plan a draft, and names why', () => {
    const n = provisionalNotice(status())!
    expect(n.headline).toBe('Draft rules, not council policy.')
    expect(n.detail).toContain('has not reviewed')
    expect(n.detail).toContain('legal status has not been confirmed')
    expect(n.detail).toContain('Vungu RDC peri-urban local plan')
  })

  it('never softens the headline: a reviewed column in a plan not in force is still a draft', () => {
    const n = provisionalNotice(status({ reviewStatus: 'reviewed', reviewedBy: 'A. Planner', planStatus: 'public_notice' }))!
    expect(n.headline).toBe('Draft rules, not council policy.')
    expect(n.detail).toContain('A. Planner')
    expect(n.detail).toContain('out for public notice')
  })

  it('reads rules_status from the API into the assessment', async () => {
    mockedGet.mockResolvedValue({ data: { success: true, data: { ...envelope.data, rules_status: {
      plan_title: 'Vungu plan', plan_status: 'unknown', provisional: true, review_status: 'unreviewed', reviewed_by: null } } } })
    const res = await getZoningAt(29.8, -19.4, 1)
    expect(res!.rulesStatus).toEqual({ planTitle: 'Vungu plan', planStatus: 'unknown', provisional: true, reviewStatus: 'unreviewed', reviewedBy: null })
  })

  it('has no status when the API sends none (older servers)', async () => {
    mockedGet.mockResolvedValue({ data: envelope })
    expect((await getZoningAt(29.8, -19.4, 1))!.rulesStatus).toBeNull()
  })

  it('writes the draft warning into the note kept on the case, and only then', () => {
    const base = { parcelFid: 1, zoneName: 'Z', zoneCode: null, selectedGroupCode: 'A', selectedGroupName: 'Dwelling', permission: 'permitted' as const,
      conditions: null, maxHeightM: null, minLotSqm: null, maxUnits: null }
    expect(buildZoningEntry({ ...base, provisional: true }).notes).toContain('DRAFT RULES, not council policy')
    expect(buildZoningEntry(base).notes).not.toContain('DRAFT RULES')
    expect(buildZoningEntry({ ...base, provisional: false }).notes).not.toContain('DRAFT RULES')
  })
})

describe('matrixCsv', () => {
  it('lays groups down and zones across, blank where unscheduled', async () => {
    const { matrixCsv } = await import('@/services/developmentControl')
    const zones = [
      { id: 1, zone_code: 'R1', zone_name: 'Residential', zone_type: null },
      { id: 2, zone_code: null, zone_name: 'Farm, small', zone_type: null },
    ]
    const groups = [{ group_id: 'g1', group_code: 'A1', description: 'House "detached"', group_category: null }]
    const rules = [{ matrix_id: 'm', zone_id: 2, group_id: 'g1', group_code: 'A1', permission_code: 'SC' as const,
      conditions: null, max_units: null, max_height_meters: null, min_lot_size_sqm: null, legal_reference: null }]
    expect(matrixCsv(zones, groups, rules)).toBe(
      'Group,Description,R1,"Farm, small"\nA1,"House ""detached""",,SC',
    )
  })
})

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, CRLF and a BOM', async () => {
    const { parseCsv } = await import('@/services/developmentControl')
    expect(parseCsv('﻿a,"b, c"\r\n"say ""hi""",\n')).toEqual([['a', 'b, c'], ['say "hi"', '']])
  })
})

describe('planMatrixImport', () => {
  it('returns only changed cells, and reports what it could not read', async () => {
    const { planMatrixImport, matrixCsv } = await import('@/services/developmentControl')
    const zones = [
      { id: 1, zone_code: 'R1', zone_name: 'Residential', zone_type: null },
      { id: 2, zone_code: 'AG', zone_name: 'Agriculture', zone_type: null },
    ]
    const groups = [
      { group_id: 'g1', group_code: 'A1', description: 'House', group_category: null },
      { group_id: 'g2', group_code: 'B1', description: 'Shop', group_category: null },
    ]
    const rule = (zone_id: number, group_id: string, permission_code: 'P' | 'SC' | 'X') => ({
      matrix_id: `${zone_id}${group_id}`, zone_id, group_id, group_code: '', permission_code,
      conditions: null, max_units: null, max_height_meters: null, min_lot_size_sqm: null, legal_reference: null,
    })
    const rules = [rule(1, 'g1', 'P'), rule(2, 'g2', 'X')]

    // an unedited export round-trips to no changes
    expect(planMatrixImport(matrixCsv(zones, groups, rules), zones, groups, rules).changes).toEqual([])

    const csv = 'Group,Description,R1,Agriculture,Nowhere\na1,House,p,SC,\nB1,Shop,,,\nZZ9,Ghost,P,P,\nA1,House,maybe,P,'
    const plan = planMatrixImport(csv, zones, groups, rules)
    expect(plan.changes).toEqual([
      { zone_id: 2, group_code: 'A1', permission_code: 'SC' },
      { zone_id: 2, group_code: 'B1', permission_code: null },
    ])
    expect(plan.unknownZones).toEqual(['Nowhere'])
    expect(plan.unknownGroups).toEqual(['ZZ9'])
    expect(plan.invalid).toEqual([{ group: 'A1', zone: '—', value: 'listed more than once' }])
    expect(planMatrixImport('Group,R1\nA1,maybe', zones, groups, rules).invalid)
      .toEqual([{ group: 'A1', zone: 'R1', value: 'maybe' }])
  })
})
