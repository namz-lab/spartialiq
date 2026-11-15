// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const current = ref<any>(null)
vi.mock('@/composables/usePlannerCase', () => ({ usePlannerCase: () => ({ current, save: vi.fn() }) }))

const locateStand = vi.fn()
vi.mock('@/services/parcels', () => ({ locateStand: (...a: any[]) => locateStand(...a) }))

const getZoningAt = vi.fn()
vi.mock('@/services/developmentControl', async (orig) => {
  const actual = await (orig as any)()
  return { ...actual, getZoningAt: (...a: any[]) => getZoningAt(...a) }
})

const takeRuleSnapshot = vi.fn()
const getZoning = vi.fn()
const relodge = vi.fn()
vi.mock('@/services/developmentManagementService', async (orig) => {
  const actual = await (orig as any)()
  return { ...actual, dmApi: { ...actual.dmApi, takeRuleSnapshot: (...a: any[]) => takeRuleSnapshot(...a), getZoning: (...a: any[]) => getZoning(...a), relodge: (...a: any[]) => relodge(...a) } }
})

import ZoningAssessmentCard from '@/views/planner/ZoningAssessmentCard.vue'

const assessment = {
  parcelFid: 42, standNumber: 'Farm 12', zoneName: 'Residential 1', zoneCode: 'PU-R1',
  uses: [
    { groupCode: 'RES1', groupName: 'Dwelling house', category: 'Residential', permission: 'permitted',
      conditions: 'Single dwelling only', maxHeightM: 8, minLotSqm: 300, maxUnits: 1 },
    { groupCode: 'IND', groupName: 'Heavy industry', category: 'Industrial', permission: 'prohibited',
      conditions: null, maxHeightM: null, minLotSqm: null, maxUnits: null },
  ],
}

/** What GET /permit-applications/:id/zoning returns for the plan's decisions of `a` (every use decided by the council). */
const zoningOf = (a: any, extra: any[] = []) => ({
  match: 'matched', parcel: { layer: 'land.parcel', id: 'P-1', stand_no: a.standNumber, kind: 'stand' },
  plans: [{ chosen: true, plan: { id: 'p', title: 'Vungu plan', status: 'unknown', provisional: true },
    governing_zone: { id: 1, name: a.zoneName, type_code: a.zoneCode, review_status: 'unreviewed' },
    uses: [...a.uses.map((u: any) => ({ code: u.groupCode, description: u.groupName, category: u.category, decision: u.permission, authority: 'EO Planning (Vungu matrix)', conditions: u.conditions, decided_by: 'council' })), ...extra] }],
})

beforeEach(() => {
  locateStand.mockReset(); getZoningAt.mockReset(); takeRuleSnapshot.mockReset(); getZoning.mockReset(); relodge.mockReset()
  current.value = { property: { centroid: [29.8, -19.4] }, dueDiligence: {} }
})

describe('ZoningAssessmentCard', () => {
  it('runs the check, renders the table, and emits apply for the selected group', async () => {
    locateStand.mockResolvedValue({ stand: { fid: 42 } })
    getZoningAt.mockResolvedValue(assessment)

    const wrapper = mount(ZoningAssessmentCard)
    await wrapper.find('.zac-run').trigger('click')
    await flushPromises()

    expect(getZoningAt).toHaveBeenCalledWith(29.8, -19.4, 42)   // by point, not the farm-keyed fid
    expect(current.value.property.parcelFid).toBe(42)       // cached
    expect(wrapper.findAll('.zac-row').length).toBe(2)

    await wrapper.find('.zac-apply').trigger('click')        // default-selects first non-prohibited (RES1)
    const payload = wrapper.emitted('apply')![0][0] as any
    expect(payload.selectedGroupCode).toBe('RES1')
    expect(payload.permission).toBe('permitted')
    expect(payload.parcelFid).toBe(42)
  })

  it('marks the result as draft rules when the plan is not in force, and passes that on when applied', async () => {
    locateStand.mockResolvedValue({ stand: { fid: 42 } })
    getZoningAt.mockResolvedValue({ ...assessment, rulesStatus: {
      planTitle: 'Vungu RDC peri-urban local plan', planStatus: 'unknown', provisional: true, reviewStatus: 'unreviewed', reviewedBy: null } })
    const wrapper = mount(ZoningAssessmentCard)
    await wrapper.find('.zac-run').trigger('click')
    await flushPromises()
    const notice = wrapper.find('[data-testid="provisional-notice"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('Draft rules, not council policy')
    await wrapper.find('.zac-apply').trigger('click')
    expect((wrapper.emitted('apply')![0][0] as any).provisional).toBe(true)
  })

  it('shows no draft notice for rules that are in force', async () => {
    locateStand.mockResolvedValue({ stand: { fid: 42 } })
    getZoningAt.mockResolvedValue({ ...assessment, rulesStatus: {
      planTitle: 'A gazetted plan', planStatus: 'gazetted', provisional: false, reviewStatus: 'reviewed', reviewedBy: 'X' } })
    const wrapper = mount(ZoningAssessmentCard)
    await wrapper.find('.zac-run').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="provisional-notice"]').exists()).toBe(false)
    await wrapper.find('.zac-apply').trigger('click')
    expect((wrapper.emitted('apply')![0][0] as any).provisional).toBe(false)
  })

  it('shows a graceful no-data state when the service returns null', async () => {
    locateStand.mockResolvedValue({ stand: { fid: 7 } })
    getZoningAt.mockResolvedValue(null)
    const wrapper = mount(ZoningAssessmentCard)
    await wrapper.find('.zac-run').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Zoning data unavailable')
    expect(wrapper.find('.zac-apply').exists()).toBe(false)
  })


  const loadedCard = async () => {
    locateStand.mockResolvedValue({ stand: { fid: 42 } })
    getZoningAt.mockResolvedValue(assessment)
    const wrapper = mount(ZoningAssessmentCard)
    await wrapper.find('.zac-run').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('on apply, asks the server to record the rules for the chosen use and shows what it recorded', async () => {
    current.value.permitId = 'permit-1'
    takeRuleSnapshot.mockResolvedValue({
      computed_at: 'now', parcel: { layer: 'stands', id: 's1' }, land_use_code: 'RES1', unzoned: false,
      results: [{ governing: true, plan: { id: 'p', title: 'Vungu plan', version: 1, status: 'draft', authority: 'Vungu' },
        zone: { id: 1, name: 'Residential 1', type_code: 'R1' }, decision: null, pathway: null, standards: [] }],
    })
    getZoning.mockResolvedValue(zoningOf(assessment))
    const wrapper = await loadedCard()
    await wrapper.find('.zac-apply').trigger('click')
    await flushPromises()
    expect(getZoning).toHaveBeenCalledWith('permit-1')
    expect(takeRuleSnapshot).toHaveBeenCalledWith('permit-1', 'RES1')
    expect(wrapper.find('.zac-rules').text()).toContain('Vungu plan')
    expect(wrapper.find('.zac-rules').text()).toContain('not decided in this plan')   // null is never shown as allowed
  })

  it('says so when the application is not linked to a parcel (409)', async () => {
    current.value.permitId = 'permit-1'
    takeRuleSnapshot.mockRejectedValue({ response: { status: 409 } })
    getZoning.mockResolvedValue(zoningOf(assessment))
    const wrapper = await loadedCard()
    await wrapper.find('.zac-apply').trigger('click')
    await flushPromises()
    expect(wrapper.find('.zac-rules').text()).toContain('not linked to a parcel')
  })

  it('records nothing when the case has no permit yet', async () => {
    const wrapper = await loadedCard()
    await wrapper.find('.zac-apply').trigger('click')
    await flushPromises()
    expect(takeRuleSnapshot).not.toHaveBeenCalled()
    expect(wrapper.find('.zac-rules').exists()).toBe(false)
  })

  it("reads the application's own zoning: labels a proposed rule, and says how many uses the plan has not decided", async () => {
    current.value.permitId = 'permit-1'
    getZoning.mockResolvedValue(zoningOf(assessment, [
      { code: 'D', description: 'Shops', category: 'commercial', decision: 'prohibited', authority: 'PROPOSED: best practice, for EO review', conditions: null, decided_by: 'proposed' },
      { code: 'Z', description: 'Horticulture', category: 'agricultural', decision: null, authority: null, conditions: null, decided_by: 'not_decided' },
    ]))
    const wrapper = mount(ZoningAssessmentCard)
    await wrapper.find('.zac-run').trigger('click')
    await flushPromises()
    expect(getZoningAt).not.toHaveBeenCalled()                // not the point lookup, not the farm table
    expect(wrapper.findAll('.zac-row').length).toBe(3)        // the undecided use is not a row: it is never shown as allowed
    expect(wrapper.text()).toContain('Proposed, not yet agreed by the EO')
    expect(wrapper.findAll('.zac-proposed').length).toBe(1)
    expect(wrapper.find('[data-testid="undecided"]').text()).toContain('1 use(s)')
  })

  it('says the application is not linked to a parcel, and looks for the parcel again on request', async () => {
    current.value.permitId = 'permit-1'
    getZoning.mockResolvedValueOnce({ match: 'unmatched', parcel: null, plans: [] })
    relodge.mockResolvedValue({ parcel_layer: 'land.parcel', parcel_id: 'P-1', parcel_match: 'matched' })
    getZoning.mockResolvedValue(zoningOf(assessment))
    const wrapper = mount(ZoningAssessmentCard)
    await wrapper.find('.zac-run').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="unlinked"]').exists()).toBe(true)
    await wrapper.find('[data-testid="unlinked"] button').trigger('click')
    await flushPromises()
    expect(relodge).toHaveBeenCalledWith('permit-1')
    expect(wrapper.findAll('.zac-row').length).toBe(2)
  })
})
