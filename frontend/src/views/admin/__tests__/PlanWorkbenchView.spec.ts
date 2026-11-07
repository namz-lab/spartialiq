// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ role: 'planner', name: 'Pat Planner' }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: { role: h.role }, userName: h.name }) }))

const api = vi.hoisted(() => ({
  listPlans: vi.fn(), getPlan: vi.fn(), listAuthorities: vi.fn(), addAuthority: vi.fn(), adopt: vi.fn(),
  importSheet: vi.fn(), signOff: vi.fn(), setStatus: vi.fn(), newVersion: vi.fn(), audit: vi.fn(), reviewZone: vi.fn(),
}))
vi.mock('@/services/planWorkbench', async (orig) => {
  const actual = await (orig as any)()
  return { ...actual, wb: api }
})

import PlanWorkbenchView from '@/views/admin/PlanWorkbenchView.vue'

const base = {
  id: 'p1', title: 'Chipinge district plan', plan_type: 'district_master', version: 1, status: 'draft', is_template: false,
  is_default_template: false, authority_id: 2, authority_name: 'Chipinge RDC', profile_code: 'rural',
  zone_types: 11, land_uses: 32, decisions: 0, gazette_ref: null, effective_from: null, effective_to: null,
  supersedes_id: null, derived_from_id: 't1', signoff_current: false, last_signoff: null, frozen: false,
}
const template = { ...base, id: 't1', title: 'Rural template', is_template: true, authority_id: null, authority_name: null }

const detail = (over: any = {}, next: string[] = ['public_notice'], events: any[] = []) =>
  ({ plan: { ...base, ...over }, next_statuses: next, events })

const sheetClean = {
  applied: false, errors: [], coverage: [],
  summary: { rows: 4, cells: 3, inserts: 3, updates: 0, unchanged: 0, undecided: 1, errors: 0 },
}

async function mountOpen(d = detail()) {
  api.listPlans.mockResolvedValue([template, base])
  api.listAuthorities.mockResolvedValue([{ id: 2, code: 'CHIP', name: 'Chipinge RDC', kind: 'rural' }])
  api.getPlan.mockResolvedValue(d)
  const w = mount(PlanWorkbenchView)
  await flushPromises()
  const row = w.findAll('tbody tr').find((r) => r.text().includes('Chipinge district plan'))!
  await row.trigger('click')
  await flushPromises()
  return w
}

beforeEach(() => {
  h.role = 'planner'
  h.name = 'Pat Planner'
  Object.values(api).forEach((f) => f.mockReset())
  api.audit.mockResolvedValue({ errors: 0, warnings: 0, reviews: 0, findings: [] })
})

const column = (over: any = {}) => ({
  code: 'Cemetery', name: 'Cemetery', category: 'open_space', review_status: 'unreviewed', reviewed_by: null, reviewed_at: null,
  permitted: 2, special_consent: 3, prohibited: 27, ...over,
})
const withColumns = (cols: any[], over: any = {}, next: string[] = []) => ({ ...detail(over, next), zone_types: cols })
const buttonsIn = (w: any, zone: string) => w.find(`tr[data-zone="${zone}"]`).findAll('button').map((b: any) => b.text())

describe('PlanWorkbenchView', () => {
  it('lists the plans, marks templates as having no authority, and opens one', async () => {
    const w = await mountOpen()
    expect(w.text()).toContain('Rural template')
    expect(w.text()).toContain('Template (no authority)')
    expect(api.getPlan).toHaveBeenCalledWith('p1')
    expect(w.text()).toContain('Version 1 · Chipinge RDC')
  })

  it('offers only the next steps the server allowed, and says a sign-off is needed', async () => {
    const w = await mountOpen(detail({}, ['public_notice']))
    const buttons = w.findAll('button').map((b) => b.text())
    expect(buttons).toContain('Move to public notice')
    expect(buttons).not.toContain('Move to approved')
    expect(buttons).not.toContain('Move to gazetted')
    expect(w.text()).toContain('Not signed off')
  })

  it('shows the server\'s own sentence when a rule refuses a step', async () => {
    api.setStatus.mockRejectedValue({ response: { status: 409, data: { message: 'approval needs a current sign-off' } } })
    const w = await mountOpen(detail({}, ['approved']))
    await w.findAll('button').find((b) => b.text() === 'Move to approved')!.trigger('click')
    await flushPromises()
    expect(w.find('.wb-notice').text()).toBe('approval needs a current sign-off')
  })

  it('does not show the server\'s fault details for any other failure', async () => {
    api.setStatus.mockRejectedValue({ response: { status: 500, data: { message: 'connection to 10.0.0.5 failed' } } })
    const w = await mountOpen(detail({}, ['approved']))
    await w.findAll('button').find((b) => b.text() === 'Move to approved')!.trigger('click')
    await flushPromises()
    expect(w.find('.wb-notice').text()).not.toContain('10.0.0.5')
  })

  it('asks for a gazette reference and sends it with the gazetting step', async () => {
    api.setStatus.mockResolvedValue(undefined)
    const w = await mountOpen(detail({ status: 'approved', signoff_current: true }, ['gazetted']))
    await w.find('input[aria-label="Gazette reference"]').setValue('SI 12 of 2026')
    await w.find('input[aria-label="Effective from"]').setValue('2026-06-01')
    await w.findAll('button').find((b) => b.text() === 'Move to gazetted')!.trigger('click')
    await flushPromises()
    expect(api.setStatus).toHaveBeenCalledWith('p1', 'gazetted', { gazette_ref: 'SI 12 of 2026', effective_from: '2026-06-01' })
  })

  it('a sheet is checked first; apply is only offered for the text that checked clean', async () => {
    api.importSheet.mockResolvedValue(sheetClean)
    const w = await mountOpen()
    const apply = () => w.findAll('button').find((b) => b.text() === 'Apply to this plan')!
    expect(apply().attributes('disabled')).toBeDefined()                         // nothing checked yet

    await w.find('textarea').setValue('zone,group_code,control_type\nA,B,P')
    await w.findAll('button').find((b) => b.text() === 'Check the sheet')!.trigger('click')
    await flushPromises()
    expect(api.importSheet).toHaveBeenCalledWith('p1', 'zone,group_code,control_type\nA,B,P', false)   // a dry run
    expect(w.text()).toContain('3 decisions would be written')
    expect(apply().attributes('disabled')).toBeUndefined()

    await w.find('textarea').setValue('zone,group_code,control_type\nA,B,X')       // edited after the check
    expect(apply().attributes('disabled')).toBeDefined()
  })

  it('a sheet with errors lists them and cannot be applied', async () => {
    api.importSheet.mockResolvedValue({ ...sheetClean, errors: ['row 3: unknown land-use group "ZZ"'], summary: { ...sheetClean.summary, errors: 1 } })
    const w = await mountOpen()
    await w.find('textarea').setValue('x')
    await w.findAll('button').find((b) => b.text() === 'Check the sheet')!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('unknown land-use group "ZZ"')
    expect(w.findAll('button').find((b) => b.text() === 'Apply to this plan')!.attributes('disabled')).toBeDefined()
  })

  it('applying writes with apply true, once, for the checked text', async () => {
    api.importSheet.mockResolvedValue(sheetClean)
    const w = await mountOpen()
    await w.find('textarea').setValue('sheet')
    await w.findAll('button').find((b) => b.text() === 'Check the sheet')!.trigger('click')
    await flushPromises()
    await w.findAll('button').find((b) => b.text() === 'Apply to this plan')!.trigger('click')
    await flushPromises()
    expect(api.importSheet).toHaveBeenLastCalledWith('p1', 'sheet', true)
    expect(api.importSheet).toHaveBeenCalledTimes(2)
    expect(w.find('.wb-notice').text()).toContain('3 decisions were written')
  })

  it('an approved plan is fixed: no sheet import, but a new version can be started', async () => {
    const w = await mountOpen(detail({ status: 'approved', frozen: true, signoff_current: true }, ['gazetted']))
    expect(w.text()).not.toContain('Check the sheet')
    expect(w.text()).toContain('A change needs a new version')
    expect(w.findAll('button').map((b) => b.text())).toContain('Start a new version')
  })

  it('a template shows no steps or sheet import', async () => {
    api.listPlans.mockResolvedValue([template])
    api.listAuthorities.mockResolvedValue([])
    api.getPlan.mockResolvedValue({ plan: template, next_statuses: [], events: [] })
    const w = mount(PlanWorkbenchView)
    await flushPromises()
    await w.findAll('tbody tr')[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('A template')
    expect(w.text()).not.toContain('Next step')
    expect(w.text()).not.toContain('Check the sheet')
  })

  it('describes the history in plain words', async () => {
    const w = await mountOpen(detail({}, [], [
      { event_type: 'status_changed', actor_role: 'planner', actor_email: 'p@x', at: '2026-10-07T10:00:00Z', detail: { from: 'draft', to: 'public_notice' } },
      { event_type: 'matrix_imported', actor_role: 'planner', actor_email: 'p@x', at: '2026-10-07T09:00:00Z', detail: { inserts: 3, updates: 1, unchanged: 5 } },
    ]))
    expect(w.text()).toContain('Status changed: Draft to Public notice')
    expect(w.text()).toContain('Decisions imported: 4 written, 5 unchanged')
  })

  describe('review by zone', () => {
    const two = [column(), column({ code: 'Light Industry', name: 'Light Industry', category: 'industrial', review_status: 'reviewed', reviewed_by: 'A. Council Planner', reviewed_at: '2026-10-09T08:00:00Z' })]

    it('lists each zone column with its decisions and where its review stands', async () => {
      const w = await mountOpen(withColumns(two))
      expect(w.find('[data-testid="review-summary"]').text()).toContain('1 of 2 zone columns reviewed')
      const row = w.find('tr[data-zone="Cemetery"]').text()
      expect(row).toContain('2 P · 3 SC · 27 X')
      expect(row).toContain('Not reviewed')
      const done = w.find('tr[data-zone="Light Industry"]').text()
      expect(done).toContain('Reviewed')
      expect(done).toContain('A. Council Planner, 2026-10-09')
    })

    it('says plainly that reviewing does not make the plan final', async () => {
      const w = await mountOpen(withColumns(two))
      expect(w.find('[data-testid="review-summary"]').text()).toContain('draft rules, not council policy')
    })

    it('offers only the moves that make sense for each state', async () => {
      const w = await mountOpen(withColumns([column(), column({ code: 'B', name: 'B', review_status: 'in_review' }), two[1]]))
      expect(buttonsIn(w, 'Cemetery')).toEqual(['Start review of Cemetery', 'Mark reviewed for Cemetery'])
      expect(buttonsIn(w, 'B')).toEqual(['Mark reviewed for B', 'Set aside review of B'])
      expect(buttonsIn(w, 'Light Industry')).toEqual(['Reopen review of Light Industry'])
    })

    it('marking reviewed sends the reviewer, defaulting to the signed-in person', async () => {
      api.reviewZone.mockResolvedValue(undefined)
      const w = await mountOpen(withColumns(two))
      expect((w.find('input[aria-label="Name of the reviewer"]').element as HTMLInputElement).value).toBe('Pat Planner')
      await w.find('tr[data-zone="Cemetery"]').findAll('button')[1].trigger('click')
      await flushPromises()
      expect(api.reviewZone).toHaveBeenCalledWith('p1', 'Cemetery', 'reviewed', 'Pat Planner')
      expect(w.find('.wb-notice').text()).toContain('Cemetery was marked reviewed by Pat Planner')
      expect(w.find('.wb-notice').text()).toContain('still draft rules')
    })

    it('a different reviewer can be named, and a review without a name is not sent', async () => {
      api.reviewZone.mockResolvedValue(undefined)
      const w = await mountOpen(withColumns(two))
      const input = w.find('input[aria-label="Name of the reviewer"]')
      await input.setValue('')
      await w.find('tr[data-zone="Cemetery"]').findAll('button')[1].trigger('click')
      expect(api.reviewZone).not.toHaveBeenCalled()
      expect(w.find('.wb-notice').text()).toContain('Enter the name of the person')
      await input.setValue('  T. Dube  ')
      await w.find('tr[data-zone="Cemetery"]').findAll('button')[1].trigger('click')
      await flushPromises()
      expect(api.reviewZone).toHaveBeenCalledWith('p1', 'Cemetery', 'reviewed', 'T. Dube')
    })

    it('starting a review or setting it aside sends no reviewer name', async () => {
      api.reviewZone.mockResolvedValue(undefined)
      const w = await mountOpen(withColumns(two))
      await w.find('tr[data-zone="Cemetery"]').findAll('button')[0].trigger('click')
      await flushPromises()
      expect(api.reviewZone).toHaveBeenCalledWith('p1', 'Cemetery', 'in_review', undefined)
    })

    it('shows what the audit found against each zone, and what concerns the whole plan', async () => {
      api.audit.mockResolvedValue({
        errors: 1, warnings: 0, reviews: 2,
        findings: [
          { severity: 'error', kind: 'residential_zone_without_dwellings', zone_code: 'Cemetery', group_code: null, detail: 'a residential zone that permits no dwelling outright' },
          { severity: 'review', kind: 'special_consent_without_condition', zone_code: 'Cemetery', group_code: null, detail: '3 special-consent decisions state no condition' },
          { severity: 'review', kind: 'sub_class_without_class', zone_code: null, group_code: 'L1', detail: 'L1 is a sub-class of L, but this plan has no L' },
        ],
      })
      const w = await mountOpen(withColumns(two))
      const cell = w.find('tr[data-zone="Cemetery"]').text()
      expect(cell).toContain('1 error, 1 to review')
      expect(cell).toContain('3 special-consent decisions state no condition')
      expect(w.find('tr[data-zone="Light Industry"]').text()).toContain('Nothing to settle')
      expect(w.find('.wb-planwide').text()).toContain('L1 is a sub-class of L')
    })

    it('still works when the audit cannot be read', async () => {
      api.audit.mockRejectedValue(new Error('down'))
      const w = await mountOpen(withColumns(two))
      expect(w.find('tr[data-zone="Cemetery"]').text()).toContain('Not checked')
      expect(buttonsIn(w, 'Cemetery').length).toBe(2)
    })

    it('shows the server\'s own sentence when a rule refuses a review', async () => {
      api.reviewZone.mockRejectedValue({ response: { status: 409, data: { message: 'a review needs the name of the reviewer' } } })
      const w = await mountOpen(withColumns(two))
      await w.find('tr[data-zone="Cemetery"]').findAll('button')[1].trigger('click')
      await flushPromises()
      expect(w.find('.wb-notice').text()).toBe('a review needs the name of the reviewer')
    })

    it('is read only once the plan is fixed, and has no draft warning when it is in force', async () => {
      const w = await mountOpen(withColumns(two, { status: 'gazetted', frozen: true }, []))
      expect(w.find('tr[data-zone="Cemetery"]').findAll('button').length).toBe(0)
      expect(w.find('input[aria-label="Name of the reviewer"]').exists()).toBe(false)
      expect(w.find('[data-testid="review-summary"]').text()).not.toContain('draft rules')
      expect(w.text()).toContain('review state can no longer change')
    })

    it('links to the audit view of the open plan', async () => {
      const w = await mountOpen(withColumns(two))
      expect(w.find('a.wb-link').attributes('href')).toBe('/admin/plan-audit/p1')
      expect(w.find('a.wb-link').text()).toBe('Open the audit view')
    })

    it('is not shown for a template, or when the server sends no zone columns', async () => {
      api.listPlans.mockResolvedValue([template, base])
      api.listAuthorities.mockResolvedValue([])
      api.getPlan.mockResolvedValue({ ...detail({ ...template }), zone_types: two })
      const w = mount(PlanWorkbenchView)
      await flushPromises()
      await w.findAll('tbody tr').find((r) => r.text().includes('Rural template'))!.trigger('click')
      await flushPromises()
      expect(w.text()).not.toContain('Review by zone')
      const older = await mountOpen(detail())
      expect(older.text()).not.toContain('Review by zone')
    })

    it('describes a review in the history', async () => {
      const w = await mountOpen({ ...withColumns(two), events: [
        { event_type: 'zone_review', actor_role: 'planner', actor_email: 'p@x', at: '2026-10-09T08:00:00Z', detail: { zone_type: 'Cemetery', from: 'in_review', to: 'reviewed', reviewer: 'T. Dube' } },
      ] })
      expect(w.text()).toContain('Zone review: Cemetery is now reviewed (T. Dube)')
    })
  })

  it('adding an authority is for the administrator only', async () => {
    let w = await mountOpen()
    expect(w.text()).not.toContain('Add an authority')
    h.role = 'admin'
    w = await mountOpen()
    expect(w.text()).toContain('Add an authority')
  })

  it('creating a plan needs an authority and a title, then sends the chosen template profile', async () => {
    api.adopt.mockResolvedValue({ id: 'new' })
    const w = await mountOpen()
    const create = () => w.findAll('button').find((b) => b.text() === 'Create the plan')!
    await create().trigger('click')
    expect(api.adopt).not.toHaveBeenCalled()
    expect(w.find('.wb-notice').text()).toContain('Choose an authority')

    const selects = w.findAll('.wb-form select')
    await selects[0].setValue('2')
    await selects[1].setValue('urban')
    await w.find('.wb-form input[type="text"]').setValue('Chipinge RDC district master plan')
    await create().trigger('click')
    await flushPromises()
    expect(api.adopt).toHaveBeenCalledWith({ authority_id: 2, profile: 'urban', title: 'Chipinge RDC district master plan', plan_type: 'local' })
  })
})
