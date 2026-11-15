// @vitest-environment happy-dom
//
// The survey import screen with a stand-change proposal (migrations 229 and 230): the Survey Section may name an accepted proposal the plan
// closes; the import then carries its id, and the report shows each surveyed feature against the boundary it matched and the stands that
// will be retired. An ordinary import sends no proposal.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const gms = vi.hoisted(() => ({ importGeneralPlan: vi.fn() }))
const changes = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/services/gms', async (orig) => {
  const real = await orig<typeof import('@/services/gms')>()
  return { ...real, gmsApi: { ...real.gmsApi, importGeneralPlan: gms.importGeneralPlan } }
})
vi.mock('@/services/parcelChangeService', async (orig) => {
  const real = await orig<typeof import('@/services/parcelChangeService')>()
  return { ...real, parcelChangeApi: { ...real.parcelChangeApi, list: changes.list, get: changes.get } }
})

import SurveyImportSection from '../SurveyImportSection.vue'

const PROPOSAL = { id: 'p1', kind: 'split', status: 'accepted', reason: null, requested_by: 'u1', requested_by_name: 'Pat', submitted_at: null, decided_at: null,
  survey_task_id: null, general_plan_id: null, created_at: '2026-11-15', stands: ['1228'], items: 2 }

async function mountWithFile() {
  const w = mount(SurveyImportSection)
  await flushPromises()
  const file = new File([JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { stand_no: '1228A' }, geometry: null }] })], 'plan.geojson')
  const input = w.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file] })
  await input.trigger('change')
  await flushPromises()
  await w.find('input[placeholder="General plan or diagram number"]').setValue('SG 1')
  await w.find('input[placeholder="TSAMBA-GP"]').setValue('HERTS')
  return w
}

beforeEach(() => {
  gms.importGeneralPlan.mockReset()
  changes.list.mockReset()
  changes.get.mockReset()
})

describe('SurveyImportSection with a proposal', () => {
  it('offers accepted proposals, sends the chosen one, and shows what the import matched and will retire', async () => {
    changes.list.mockResolvedValue([PROPOSAL])
    changes.get.mockResolvedValue({ ...PROPOSAL, parents: [{ parcel_id: 'P-1', stand_no: '1228', township_code: 'HERTS' }], items: [], problems: [] })
    gms.importGeneralPlan.mockResolvedValue({
      ok: true, committed: false,
      report: {
        source_crs: 'Lo29', feature_count: 1, transform_method: 'x', transform_accuracy_m: 0.5, errors: [],
        summary: { new: 2, adopt: 0, conflicts: 0, orphans: 0, revised: 0, retired: 1 },
        change_request: {
          change_request_id: 'p1', kind: 'split', match_threshold: 0.8,
          matches: [{ seq: 1, role: 'child', label: 'A', feature: 0, stand_no: '1228A', agreement: 0.9731 }],
          retire: [{ parcel_id: 'P-1', stand_no: '1228' }], revise: [],
        },
      },
    })
    const w = await mountWithFile()
    expect(changes.list).toHaveBeenCalledWith({ status: ['accepted'] })
    await w.findAll('select')[1].setValue('p1')
    await flushPromises()
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(gms.importGeneralPlan).toHaveBeenCalledWith(expect.objectContaining({ change_request_id: 'p1', commit: false }))
    expect(w.text()).toContain('97.3%')
    expect(w.text()).toContain('Retired when committed: 1228')
    expect(w.text()).toContain('Stands retired')
  })

  it('says in words why a proposal cannot be closed by this plan', async () => {
    changes.list.mockResolvedValue([PROPOSAL])
    changes.get.mockResolvedValue({ ...PROPOSAL, parents: [], items: [], problems: [] })
    gms.importGeneralPlan.mockResolvedValue({
      ok: false, committed: false,
      errors: [
        { code: 'proposal_item_unmatched', seq: 2, label: 'B', needed_iou: 0.8 },
        { code: 'overlaps_register_parcel', feature: 1, stand_no: '1229', parcel_id: 'P-2', overlap_m2: 30 },
      ],
    })
    const w = await mountWithFile()
    await w.findAll('select')[1].setValue('p1')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.text()).toContain('No surveyed boundary agrees with the proposed boundary B')
    expect(w.text()).toContain('overlaps stand 1229')
  })

  it('sends no proposal for an ordinary import, and shows no proposal picker when none is accepted', async () => {
    changes.list.mockResolvedValue([])
    gms.importGeneralPlan.mockResolvedValue({ ok: true, committed: false, report: { source_crs: 'Lo29', feature_count: 1, transform_method: 'x', transform_accuracy_m: 0.5, errors: [] } })
    const w = await mountWithFile()
    expect(w.text()).not.toContain('Closes a stand-change proposal')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(gms.importGeneralPlan.mock.calls[0][0]).not.toHaveProperty('change_request_id')
  })
})
