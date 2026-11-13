// @vitest-environment happy-dom
//
// Two officers, one workstation. This is the normal shape of a council office: a single browser on
// a shared desk, staff taking turns at it. A sign-out there is not a page load — it is a route
// change inside one long-lived tab — so everything held in memory survives it unless something
// deliberately drops it.
//
// These tests pin the session boundary: after a sign-out, nothing the first officer loaded is
// readable by the second, and nothing a new store adds next year escapes the boundary by default.
//
// This is NOT the security control. The server revokes the session row on logout and re-checks it
// on every request, so stale browser state cannot read anything. What it prevents is the second
// officer being shown the first officer's permissions and figures as if they were their own.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia, defineStore } from 'pinia'
import { ref } from 'vue'

// Hoisted so the module factory below can close over it — vi.mock is lifted above the imports.
const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('../../services/api', () => ({
  default: { post, get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

import { resetSessionScope, onSessionEnd } from '../../services/sessionScope'
import { useAuthStore } from '../auth'
import { usePlanningWorkflowStore } from '../planningWorkflow'
import { useCouncilStore } from '../council'


beforeEach(() => {
  vi.clearAllMocks()
  post.mockResolvedValue({ data: { success: true } })
  try { localStorage.clear() } catch { /* private mode */ }
  setActivePinia(createPinia())
})

describe('the session boundary', () => {
  it('ends the server session rather than only forgetting the user locally', async () => {
    const auth = useAuthStore()
    await auth.logout()
    // The access and refresh cookies are httpOnly, so the client cannot clear them and must ask:
    // POST /auth/logout revokes the user_session row, which is what makes the access token stop
    // working immediately instead of drifting on until its natural 12h expiry.
    expect(post).toHaveBeenCalledWith('/auth/logout')
  })

  it('clears a signed-in officer\'s loaded records when the next person signs in', async () => {
    const board = usePlanningWorkflowStore()
    board.addItem({
      id: 'DEV/2026/114', type: 'residential_plot', title: 'Stand 4412 — dwelling',
      ward: 'Ward 7', applicant: 'Tendai Chirwa', area_sqm: 600,
      submittedBy: 'Tendai Chirwa', submittedAt: '2026-10-02T08:00:00Z',
      status: 'draft', envClearance: null, eoApproval: null,
      buildingInspections: [], notifications: [], history: [],
    })
    expect(board.items.length).toBe(1)

    await useAuthStore().logout()

    // The applicant's name and the stand they applied over are gone from memory. Without this the
    // next officer at the machine opened the board on the previous officer's caseload.
    expect(board.items).toEqual([])
  })

  it('leaves alone the stores that hold nothing about the person', async () => {
    const council = useCouncilStore()
    expect(council.selectedCouncil?.shortName).toBe('Vungu RDC')

    await useAuthStore().logout()

    // The authority's own name is the same for an anonymous visitor as for the Chief Executive.
    // Clearing it would cost a refetch to show identical data.
    expect(council.selectedCouncil?.shortName).toBe('Vungu RDC')
  })

  it('resets a store nobody remembered to think about', () => {
    // The default direction matters more than the current list: a store added next year is
    // session-scoped until someone argues otherwise, rather than leaking until someone notices.
    const useLater = defineStore('a-store-added-later', () => {
      const held = ref('something about the officer')
      function reset(): void { held.value = '' }
      return { held, reset }
    })
    const later = useLater()
    resetSessionScope()
    expect(later.held).toBe('')
  })

  it('clears module-level caches that are not stores at all', () => {
    // A composable holding shared state at module scope is a singleton for the life of the tab
    // exactly as a store is; it just cannot be found by walking Pinia.
    const cache = { counts: 3 }
    onSessionEnd(() => { cache.counts = 0 })
    resetSessionScope()
    expect(cache.counts).toBe(0)
  })

  it('keeps clearing after one store throws', () => {
    // A half-cleared session is worse than the error: what is left behind is what nobody looks at.
    const useAngry = defineStore('throws-on-reset', () => ({
      reset: () => { throw new Error('no') },
    }))
    const useCalm = defineStore('resets-cleanly', () => {
      const held = ref('x')
      return { held, reset: () => { held.value = '' } }
    })
    useAngry()
    const calm = useCalm()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    resetSessionScope()

    expect(calm.held).toBe('')
    spy.mockRestore()
  })

  it('forgets the reporting period the previous officer was looking at', async () => {
    localStorage.setItem('vungu.finance.lastFinancialYear', 'year-2026')
    localStorage.setItem('citizen_language', 'sn')

    await useAuthStore().logout()

    // A remembered year is a convenience, and it belongs to one person: the second officer must
    // land on the current open year, not on whichever period the first was reconciling.
    expect(localStorage.getItem('vungu.finance.lastFinancialYear')).toBeNull()
    // A chosen language is a setting, not case data, and survives.
    expect(localStorage.getItem('citizen_language')).toBe('sn')
  })
})
