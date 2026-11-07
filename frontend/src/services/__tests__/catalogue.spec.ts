import { describe, it, expect, vi, beforeEach } from 'vitest'

const get = vi.fn()
vi.mock('@/services/api', () => ({ default: { get: (...a: any[]) => get(...a) } }))

import { defaultTileLayers, startsCollapsed, NOT_IN_PROJECT, type Catalogue } from '@/services/catalogue'

const layer = (id: string, over: Record<string, unknown> = {}) => ({
  id, table: id, title: id, projectName: null, group: ['G'], geometryType: 'polygon',
  source: 'project', inProject: true, defaultVisible: true, tile: true, audience: 'staff', ...over,
})
const cat = (layers: any[]): Catalogue => ({ project: { title: 'T', savedAt: null, savedBy: null, extent: null }, groups: [], layers })

describe('which tile layers are drawn on arrival', () => {
  it('only layers the catalogue marks on AND that are served as tiles', () => {
    const s = defaultTileLayers(cat([
      layer('zones'),
      layer('rivers', { tile: false }),                 // on, but not a tile layer: loads when switched on
      layer('buildings', { defaultVisible: false }),    // off
    ]))
    expect([...s!]).toEqual(['zones'])
  })

  it('is null when there is no catalogue, so the caller uses its built-in fallback', () => {
    expect(defaultTileLayers(null)).toBeNull()
  })
})

describe('groups the planner should not meet expanded', () => {
  it('layers the project has not adopted, and other authorities', () => {
    expect(startsCollapsed(NOT_IN_PROJECT)).toBe(true)
    expect(startsCollapsed('Other authorities / Gweru')).toBe(true)
    expect(startsCollapsed('Other Authorities')).toBe(true)
  })
  it('not the planner\'s own groups', () => {
    for (const g of ['Vungu planning', 'Boundaries', 'Base map', 'Layers']) expect(startsCollapsed(g)).toBe(false)
  })
})

describe('getCatalogue', () => {
  beforeEach(() => { get.mockReset(); vi.resetModules() })

  it('fetches once however many callers ask', async () => {
    get.mockResolvedValue({ data: { data: cat([]) } })
    const { getCatalogue } = await import('@/services/catalogue')
    await Promise.all([getCatalogue(), getCatalogue(), getCatalogue()])
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('/catalogue')
  })

  it('does not cache a failure: the next caller tries again', async () => {
    get.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ data: { data: cat([]) } })
    const { getCatalogue } = await import('@/services/catalogue')
    await expect(getCatalogue()).rejects.toThrow('down')
    await expect(getCatalogue()).resolves.toBeTruthy()
    expect(get).toHaveBeenCalledTimes(2)
  })
})
