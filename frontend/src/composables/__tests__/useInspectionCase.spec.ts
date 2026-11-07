// @vitest-environment happy-dom
//
// Option A invariant, at the composable boundary:
// spatial_planning.stage_inspection (and the permit case file) is the official
// record. A rejected write must NOT leave a "verified" case behind on the
// device, and the offline latch must not stick once the server answers.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp } from 'vue'

vi.mock('@/services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    defaults: { headers: { common: {} } },
  },
}))

import { dmApi } from '@/services/developmentManagementService'
import { provideInspectionCase, type InspectionCaseContext } from '@/composables/useInspectionCase'

const PERMIT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

/** Run a provide-based composable inside a real component instance. */
function withCase(): { ctx: InspectionCaseContext; unmount: () => void } {
  let ctx!: InspectionCaseContext
  const app = createApp({
    setup() {
      ctx = provideInspectionCase()
      return () => null
    },
  })
  app.mount(document.createElement('div'))
  return { ctx, unmount: () => app.unmount() }
}

function allSix(ctx: InspectionCaseContext) {
  const p = ctx.current.value!.preConstruction
  p.approvedPlanOnSite = true
  p.developmentPermitHeld = true
  p.permitWithinValidity = true
  p.cadastralPegsIntact = true
  p.buildingLinesRespected = true
  p.orientationCorrect = true
}

describe('useInspectionCase — pre-construction verification fails closed', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('does not stamp the case when the case-file write is rejected', async () => {
    vi.spyOn(dmApi, 'listStageInspections').mockResolvedValue([])
    vi.spyOn(dmApi, 'getPermit').mockResolvedValue({ id: PERMIT_ID } as never)
    vi.spyOn(dmApi, 'postMessage').mockRejectedValue(new Error('Network unreachable'))

    const { ctx, unmount } = withCase()
    await ctx.loadPermit(PERMIT_ID)
    allSix(ctx)

    const result = await ctx.recordPreConstruction('T. Ncube')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Network unreachable')
    // The decisive assertion: no local "verified" state survives a failed write.
    expect(ctx.current.value!.preConstruction.verifiedAt).toBeNull()
    unmount()
  })

  it('stamps the case only after the case file accepts the note', async () => {
    vi.spyOn(dmApi, 'listStageInspections').mockResolvedValue([])
    vi.spyOn(dmApi, 'getPermit').mockResolvedValue({ id: PERMIT_ID } as never)
    const post = vi.spyOn(dmApi, 'postMessage').mockResolvedValue(undefined as never)

    const { ctx, unmount } = withCase()
    await ctx.loadPermit(PERMIT_ID)
    allSix(ctx)

    const result = await ctx.recordPreConstruction('T. Ncube')

    expect(result.ok).toBe(true)
    expect(post).toHaveBeenCalledTimes(1)
    expect(ctx.current.value!.preConstruction.verifiedAt).not.toBeNull()
    expect(ctx.current.value!.preConstruction.verifiedBy).toBe('T. Ncube')
    unmount()
  })

  it('clears the offline latch once the case file answers', async () => {
    vi.spyOn(dmApi, 'getPermit').mockRejectedValue(new Error('offline'))
    vi.spyOn(dmApi, 'listStageInspections').mockRejectedValue(new Error('offline'))
    const { ctx, unmount } = withCase()

    await ctx.loadPermit(PERMIT_ID)
    expect(ctx.syncPending.value).toBe(true)

    vi.spyOn(dmApi, 'listStageInspections').mockResolvedValue([])
    vi.spyOn(dmApi, 'getPermit').mockResolvedValue({ id: PERMIT_ID } as never)
    await ctx.loadPermit(PERMIT_ID)

    // Latch must not stick — the UI reports sync state from this flag.
    expect(ctx.syncPending.value).toBe(false)
    unmount()
  })
})

describe('useInspectionCase — the certificate is shared, not re-fetched per section', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('reads the certificate once with the case, for every section to share', async () => {
    vi.spyOn(dmApi, 'getPermit').mockResolvedValue({ id: PERMIT_ID } as never)
    vi.spyOn(dmApi, 'listStageInspections').mockResolvedValue([])
    const get = vi.spyOn(dmApi, 'getCertificate').mockResolvedValue(null)

    const { ctx, unmount } = withCase()
    await ctx.loadPermit(PERMIT_ID)

    expect(get).toHaveBeenCalledTimes(1)
    // No certificate is the normal state of an unfinished building — and it is
    // distinguishable from "not looked yet".
    expect(ctx.certificate.value).toBeNull()
    expect(ctx.certificateLoaded.value).toBe(true)
    unmount()
  })

  it('reflects a newly issued certificate without reopening the permit', async () => {
    vi.spyOn(dmApi, 'getPermit').mockResolvedValue({ id: PERMIT_ID } as never)
    vi.spyOn(dmApi, 'listStageInspections').mockResolvedValue([])
    const get = vi.spyOn(dmApi, 'getCertificate').mockResolvedValue(null)

    const { ctx, unmount } = withCase()
    await ctx.loadPermit(PERMIT_ID)
    expect(ctx.certificate.value).toBeNull()

    // The certificates desk issues one; the case band must stop saying "none".
    get.mockResolvedValue({ id: 'c1', certificate_no: 'OC/2026/1824' } as never)
    await ctx.refreshCertificate()

    expect(ctx.certificate.value?.certificate_no).toBe('OC/2026/1824')
    unmount()
  })

  it('reports an unreadable certificate register as unknown, never as "not issued"', async () => {
    vi.spyOn(dmApi, 'getPermit').mockResolvedValue({ id: PERMIT_ID } as never)
    vi.spyOn(dmApi, 'listStageInspections').mockResolvedValue([])
    // Not a 404 ("none issued") — the server could not answer at all.
    vi.spyOn(dmApi, 'getCertificate').mockRejectedValue(new Error('Network unreachable'))

    const { ctx, unmount } = withCase()
    await ctx.loadPermit(PERMIT_ID)

    // A building that HAS a certificate must never be presented as uncertified
    // because the request failed: the desk shows "not confirmed" off this flag.
    expect(ctx.certificate.value).toBeNull()
    expect(ctx.certificateLoaded.value).toBe(false)
    unmount()
  })

  it('drops the certificate when the case is closed, so it cannot bleed onto the next permit', async () => {
    vi.spyOn(dmApi, 'getPermit').mockResolvedValue({ id: PERMIT_ID } as never)
    vi.spyOn(dmApi, 'listStageInspections').mockResolvedValue([])
    vi.spyOn(dmApi, 'getCertificate').mockResolvedValue({ id: 'c1', certificate_no: 'OC/2026/1824' } as never)

    const { ctx, unmount } = withCase()
    await ctx.loadPermit(PERMIT_ID)
    expect(ctx.certificate.value).not.toBeNull()

    ctx.clear()
    expect(ctx.certificate.value).toBeNull()
    expect(ctx.certificateLoaded.value).toBe(false)
    unmount()
  })
})
