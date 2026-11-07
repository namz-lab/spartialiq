// The SurveyPro importer's tab in the integration console: what it shows, who can run it, and that a busy importer is said in words.
// The API is stubbed; the component, its table and its buttons are real.
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const sp = {
  scheduled: true, interval_minutes: 15, applies: true, councils: ['VUNGU', 'GWERU'], misconfigured: null,
  last_run: { id: 12, started_at: '2026-10-10T08:00:00Z', status: 'attention' }, last_ok_at: '2026-10-10T07:45:00Z',
  runs: [
    { id: 12, started_at: '2026-10-10T08:00:00Z', finished_at: '2026-10-10T08:00:03Z', trigger: 'schedule', applied: true, status: 'attention', councils: 2, totals: { imported: 2, errors: 1 }, error: null },
    { id: 11, started_at: '2026-10-10T07:45:00Z', finished_at: '2026-10-10T07:45:02Z', trigger: 'manual', applied: false, status: 'ok', councils: 2, totals: {}, error: null },
  ],
}
const detail = {
  ...sp.runs[0],
  report: [
    { council: 'VUNGU', projects: [{ project: 7, name: 'Gokwe Road layout', imported: [{ stand: '1', parcel_id: 'P-0000301' }], errors: [{ code: 'stand_no_exists', stand: '9' }] }] },
    { council: 'GWERU', failed: 'connection refused' },
  ],
}

const api = vi.hoisted(() => ({
  status: vi.fn(), events: vi.fn(), event: vi.fn(), retry: vi.fn(), cancel: vi.fn(), reconciliation: vi.fn(), runReconciliation: vi.fn(), assign: vi.fn(), resolve: vi.fn(),
  surveyproImports: vi.fn(), surveyproRun: vi.fn(), runSurveyproImport: vi.fn(),
}))
vi.mock('@/services/gms', async (orig) => ({ ...(await orig<typeof import('@/services/gms')>()), gmsApi: api }))

import IntegrationSection from '../IntegrationSection.vue'
import { useAuthStore } from '@/stores/auth'

const open = async (role: string) => {
  setActivePinia(createPinia())
  ;(useAuthStore() as any).user = { id: 'u1', role, email: 'x@y.z' }
  const w = mount(IntegrationSection, { global: { plugins: [] } })
  await flushPromises()
  await w.get('#tab-surveypro').trigger('click')
  await flushPromises()
  return w
}

describe('the SurveyPro imports tab', () => {
  beforeEach(() => {
    for (const f of Object.values(api)) f.mockReset()
    api.status.mockResolvedValue(null); api.events.mockResolvedValue([]); api.reconciliation.mockResolvedValue([])
    api.surveyproImports.mockResolvedValue(sp); api.surveyproRun.mockResolvedValue(detail)
  })

  it('says whether it is scheduled, for which councils, and lists the runs with what they did', async () => {
    const w = await open('gis_officer')
    const t = w.get('#panel-surveypro').text()
    expect(t).toContain('Runs every 15 minutes')
    expect(t).toContain('VUNGU, GWERU')
    expect(t).toContain('2 imported, 1 refused')
    expect(t).toContain('nothing to do (dry run)')
    expect(t).toContain('needs a look')
  })

  it('opens a run to see what happened, per council, including the one that could not be read', async () => {
    const w = await open('gis_officer')
    await w.findAll('#panel-surveypro tbody tr')[0].trigger('click')
    await flushPromises()
    expect(api.surveyproRun).toHaveBeenCalledWith(12)
    const t = w.get('#panel-surveypro').text()
    expect(t).toContain('Gokwe Road layout')
    expect(t).toContain('+ stand 1 → P-0000301')
    expect(t).toContain('refused: stand_no_exists (stand 9)')
    expect(t).toContain('Could not be read: connection refused')
  })

  it('a dry run and a real run are different buttons, and each asks for what it says', async () => {
    api.runSurveyproImport.mockResolvedValue({ id: 13, status: 'ok', applied: true, totals: { imported: 1 } })
    const w = await open('gis_officer')
    const buttons = w.findAll('#panel-surveypro button')
    await buttons.find((b) => b.text() === 'Dry run')!.trigger('click'); await flushPromises()
    expect(api.runSurveyproImport).toHaveBeenLastCalledWith(false)
    await buttons.find((b) => b.text().includes('Import now'))!.trigger('click'); await flushPromises()
    expect(api.runSurveyproImport).toHaveBeenLastCalledWith(true)
    expect(w.text()).toContain('Imported: ok')
    expect(api.surveyproImports).toHaveBeenCalledTimes(3)          // opened, then refreshed after each run
  })

  it('an importer that is already running is said in words', async () => {
    api.runSurveyproImport.mockRejectedValue({ response: { status: 409, data: { error: 'already_running' } } })
    const w = await open('gis_officer')
    await w.findAll('#panel-surveypro button').find((b) => b.text().includes('Import now'))!.trigger('click'); await flushPromises()
    expect(w.text()).toContain('The importer is running already')
  })

  it('someone who may only look sees the runs and no way to start one', async () => {
    const w = await open('gis_analyst')
    const t = w.get('#panel-surveypro').text()
    expect(t).toContain('Runs every 15 minutes')
    expect(t).not.toContain('Import now')
    expect(t).not.toContain('Dry run')
  })

  it('not scheduled says how to schedule it, and a broken configuration is shown', async () => {
    api.surveyproImports.mockResolvedValue({ ...sp, scheduled: false, interval_minutes: null, councils: [], misconfigured: 'SURVEYPRO_READERS is not valid JSON', runs: [], last_run: null, last_ok_at: null })
    const w = await open('gis_officer')
    const t = w.get('#panel-surveypro').text()
    expect(t).toContain('Not scheduled')
    expect(t).toContain('SURVEYPRO_IMPORT_MINUTES')
    expect(t).toContain('none configured')
    expect(t).toContain('SURVEYPRO_READERS is not valid JSON')
    expect(t).toContain('It has not run yet.')
  })
})
