import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/services/api', () => ({ default: { get: vi.fn() } }))

import api from '@/services/api'
import { propertyService } from '@/services/propertyService'

const get = api.get as unknown as ReturnType<typeof vi.fn>

describe('propertyService — land register API contract', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getSummary hits /properties/:standNo and unwraps the {data:{data}} envelope', async () => {
    get.mockResolvedValue({ data: { data: { stand_number: '1234' } } })
    const s = await propertyService.getSummary('1234')
    expect(get).toHaveBeenCalledWith('/properties/1234')
    expect(s.stand_number).toBe('1234')
  })

  it('listOwners returns [] for an empty envelope', async () => {
    get.mockResolvedValue({ data: { data: [] } })
    expect(await propertyService.listOwners('1234')).toEqual([])
  })

  it('url-encodes the stand number for sub-resources', async () => {
    get.mockResolvedValue({ data: { data: [] } })
    await propertyService.listZoningDesignations('A/12 B')
    expect(get).toHaveBeenCalledWith('/properties/A%2F12%20B/zoning')
  })

  it('existing-uses targets the right path', async () => {
    get.mockResolvedValue({ data: { data: [] } })
    await propertyService.listExistingUses('1234')
    expect(get).toHaveBeenCalledWith('/properties/1234/existing-uses')
  })
})
