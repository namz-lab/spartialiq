import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tileUrlTemplate, getTileLayerCatalog, getFeature, resetTileLayerCatalog } from '../vectorTiles'

vi.mock('../api', () => ({
  default: { get: vi.fn() },
}))
import api from '../api'

describe('vectorTiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The catalog promise is cached per session by design — reset it so each
    // test exercises a fresh fetch.
    resetTileLayerCatalog()
  })

  it('builds an absolute tile URL template with z/x/y placeholders', () => {
    expect(tileUrlTemplate('roads')).toMatch(/\/api\/tiles\/roads\/\{z\}\/\{x\}\/\{y\}\.pbf$/)
  })

  it('returns the catalog data array', async () => {
    ;(api.get as any).mockResolvedValue({ data: { success: true, data: [{ id: 'roads' }] } })
    const layers = await getTileLayerCatalog()
    expect(layers).toEqual([{ id: 'roads' }])
    expect(api.get).toHaveBeenCalledWith('/tiles/layers')
  })

  it('returns an empty catalog when the request fails', async () => {
    ;(api.get as any).mockRejectedValue(new Error('network'))
    expect(await getTileLayerCatalog()).toEqual([])
  })

  it('fetches a single feature by id', async () => {
    const feature = { type: 'Feature', properties: { fid: 5 } }
    ;(api.get as any).mockResolvedValue({ data: feature })
    expect(await getFeature('roads', 5)).toEqual(feature)
    // Single-feature lookups carry a timeout so a stalled tile backend cannot
    // hang a drill-down click indefinitely.
    expect(api.get).toHaveBeenCalledWith('/tiles/roads/5', { timeout: 8000 })
  })
})
