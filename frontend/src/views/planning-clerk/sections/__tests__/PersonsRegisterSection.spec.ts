// @vitest-environment happy-dom
//
// The register of persons on the clerk's desk (migration 257). Pins: the level ladder reads the evidence; only the
// registrar's desks are offered "Confirm at the counter"; recording the original raises the level and re-reads the record;
// a Registrar-General answer that blocks is said in words; the work list links a text-only applicant to a person.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  get: vi.fn(), raise: vi.fn(), registrarGeneralCheck: vi.fn(), registrarGeneralStatus: vi.fn(), unlinked: vi.fn(), linkApplicant: vi.fn(), linkObjector: vi.fn(),
}))
vi.mock('@/services/persons', async (orig) => ({ ...(await orig<object>()), personsApi: api }))
const auth = vi.hoisted(() => ({ user: { role: 'planning_clerk' } as { role: string } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))
// The picker has its own spec: here it hands back whoever the test chooses.
vi.mock('@/components/shared/PersonPicker.vue', () => ({
  default: { name: 'PersonPicker', props: ['modelValue', 'role'], emits: ['update:modelValue'], template: '<div class="picker-stub" />' },
}))

import PersonsRegisterSection from '../PersonsRegisterSection.vue'
import type { Person, PersonRecord } from '@/services/persons'

const person = (over: Partial<Person> = {}): Person => ({
  id: 'p1', kind: 'individual', title: 'Mr', surname: 'Khumalo', first_names: 'Jabulani', organisation_name: null, display_name: 'Mr Jabulani Khumalo',
  phone: null, alt_phone: null, email: null, physical_address: 'Stand 1380', postal_address: null, ward_no: null, preferred_channel: 'post',
  source: 'counter', verified: false, verified_at: null, verified_how: null, date_of_birth: '1962-01-20', assurance_level: 0, level_label: 'Recorded',
  resident: false, identity_method: null, original_sighted_at: null, residency_verified_at: null, residency_evidence: null,
  registrar_general: null, status: 'active', identifiers: [{ kind: 'national_id', value: '63-•••••••Q63', masked: true }],
  appears_as: { applications: 0, objections: 1, receipts: 0 }, ...over,
})
const recordOf = (p: Person, over: Partial<PersonRecord> = {}): PersonRecord => ({
  person: p, applications: [], objections: [], receipts: [], history: [], registrar_general_checks: [], ...over,
})

const mountDesk = async () => {
  const w = mount(PersonsRegisterSection)
  await flushPromises()
  return w
}
const choose = async (w: ReturnType<typeof mount>, p: Person) => {
  w.findComponent({ name: 'PersonPicker' }).vm.$emit('update:modelValue', p)
  await flushPromises()
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset())
  auth.user = { role: 'planning_clerk' }
  api.unlinked.mockResolvedValue({ total: 0, records: [] })
  api.registrarGeneralStatus.mockResolvedValue({ available: true, mode: 'prototype', prototype: true, label: 'Prototype' })
})

describe('PersonsRegisterSection', () => {
  it('reads the level ladder from the evidence, and the clerk records the original seen', async () => {
    const p = person()
    api.get.mockResolvedValueOnce(recordOf(p))
      .mockResolvedValueOnce(recordOf(person({ verified_at: '2026-11-19T08:00:00Z', identity_method: 'original_sighted', original_sighted_at: '2026-11-19T08:00:00Z', assurance_level: 3, level_label: 'Original sighted' })))
    api.raise.mockResolvedValue(p)
    const w = await mountDesk()
    await choose(w, p)
    expect(w.get('[data-testid=prs-ladder]').findAll('li.done')).toHaveLength(1)
    await w.get('[data-testid=prs-original]').trigger('click')
    await flushPromises()
    expect(api.raise).toHaveBeenCalledWith('p1', { step: 'original_sighted', how: 'National ID card, original' })
    expect(w.get('[data-testid=prs-ladder]').text()).toContain('level 3, Original sighted')
    expect(w.get('[data-testid=prs-ladder]').findAll('li.done')).toHaveLength(3) // 0, 1 and 3; not resident
  })

  it('offers "Confirm at the counter" to the registrar\'s desks only', async () => {
    auth.user = { role: 'cashier' }
    api.get.mockResolvedValue(recordOf(person()))
    const w = await mountDesk()
    await choose(w, person())
    expect(w.find('[data-testid=prs-raise]').exists()).toBe(false)
    expect(w.text()).toContain('The planning clerk confirms their identity')
  })

  it('records residence with the proof seen', async () => {
    api.get.mockResolvedValue(recordOf(person()))
    api.raise.mockResolvedValue(person())
    const w = await mountDesk()
    await choose(w, person())
    await w.get('[data-testid=prs-evidence]').setValue('chiefs_letter')
    await w.get('[data-testid=prs-residency-how]').setValue('Headman Ndlovu, letter of 3 November')
    await w.get('[data-testid=prs-residency]').trigger('click')
    expect(api.raise).toHaveBeenCalledWith('p1', { step: 'residency', evidence: 'chiefs_letter', how: 'Headman Ndlovu, letter of 3 November' })
  })

  it('says in words when the Registrar-General\'s answer stops the document verifying anyone', async () => {
    api.get.mockResolvedValue(recordOf(person(), {
      registrar_general_checks: [{ document_type: 'national_id', outcome: 'match', document_status: 'holder_deceased', fields: { surname: 'match' },
        rg_reference: 'RGV-2026-000009', service: 'prototype', requested_at: '2026-11-19T08:00:00Z', blocks: 'The Registrar-General records the holder as deceased.' }],
    }))
    const w = await mountDesk()
    await choose(w, person())
    const rg = w.get('[data-testid=prs-rg]').text()
    expect(rg).toContain('Holder deceased')
    expect(rg).toContain('cannot verify their identity')
    expect(rg).toContain('RGV-2026-000009')
  })

  it('links a text-only applicant from the work list', async () => {
    api.unlinked.mockResolvedValue({ total: 1, records: [{ role: 'applicant', record_id: 'a1', name_as_written: 'B. Phiri', has_id_number: false, phone_as_written: null, reference: 'TPD/VUN/2026/0911', recorded_at: '2026-11-01' }] })
    api.linkApplicant.mockResolvedValue(undefined)
    const w = await mountDesk()
    await w.get('[data-testid=prs-tab-unlinked]').trigger('click')
    expect(w.get('[data-testid=prs-unlinked]').text()).toContain('B. Phiri')
    await w.findAll('[data-testid=prs-unlinked] button').find((b) => b.text() === 'Link')!.trigger('click')
    await choose(w, person({ id: 'p7', display_name: 'Mr Bernard Phiri' }))
    expect(api.linkApplicant).toHaveBeenCalledWith('a1', 'p7')
    expect(w.get('[data-testid=prs-unlinked]').text()).toContain('Every applicant and objector is linked')
  })
})
