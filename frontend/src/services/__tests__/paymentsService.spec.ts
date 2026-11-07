import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api', () => ({
  default: {
    get:  vi.fn(),
    post: vi.fn(),
  },
}))

import api from '../api'
import { paymentsService } from '../paymentsService'

describe('paymentsService.poll', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('POSTs /payments/:id/poll and returns the data', async () => {
    ;(api.post as any).mockResolvedValue({ data: { success: true, data: { id: 'P1', status: 'paid' } } })
    const r = await paymentsService.poll('P1')
    expect(api.post).toHaveBeenCalledWith('/payments/P1/poll')
    expect(r).toEqual({ id: 'P1', status: 'paid' })
  })
})

describe('paymentsService.listForRelated', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('GETs with relatedKind/relatedId query', async () => {
    ;(api.get as any).mockResolvedValue({ data: { success: true, data: [{ id: 'P2' }] } })
    const r = await paymentsService.listForRelated('permit', 'abc')
    expect(api.get).toHaveBeenCalledWith('/payments?relatedKind=permit&relatedId=abc')
    expect(r).toEqual([{ id: 'P2' }])
  })
})
