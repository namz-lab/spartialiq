// @vitest-environment happy-dom
//
// Find or register a person (migration 256). Pins the counter's rules: search first; register only from a search; what
// was searched for is carried into the form; a second record for the same ID is refused and the existing person offered;
// a possible duplicate is shown first and registered as new only when the officer says none of them is the person.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ search: vi.fn(), register: vi.fn() }))
vi.mock('@/services/persons', async (orig) => ({
  ...(await orig<object>()),
  personsApi: { search: api.search, register: api.register },
}))

import PersonPicker from '../PersonPicker.vue'
import type { Person } from '@/services/persons'

const person = (over: Partial<Person> = {}): Person => ({
  id: 'p1', kind: 'individual', title: 'Mr', surname: 'Phiri', first_names: 'Bernard', organisation_name: null,
  display_name: 'Mr Bernard Phiri', phone: '+263 77 123 4567', alt_phone: null, email: null, physical_address: 'Stand 1378',
  postal_address: null, ward_no: null, preferred_channel: 'sms', source: 'counter', verified: true, verified_at: '2026-11-19',
  verified_how: 'National ID card', status: 'active',
  identifiers: [{ kind: 'national_id', value: '63-•••••••X27', masked: true }],
  appears_as: { applications: 1, objections: 0, receipts: 1 }, ...over,
})

const search = async (w: ReturnType<typeof mount>, q: string) => {
  vi.useFakeTimers()
  await w.get('[data-testid=pp-search]').setValue(q)
  vi.advanceTimersByTime(350)
  vi.useRealTimers()
  await flushPromises()
}

beforeEach(() => { api.search.mockReset(); api.register.mockReset() })

describe('PersonPicker', () => {
  it('finds a person and chooses them', async () => {
    api.search.mockResolvedValue([{ ...person(), match: 'national_id' }])
    const w = mount(PersonPicker, { props: { modelValue: null, role: 'applicant' } })
    expect(w.text()).toContain('Find the applicant in the register')
    await search(w, '63-1234567 X 27')
    expect(api.search).toHaveBeenCalledWith('63-1234567 X 27')
    expect(w.get('[data-testid=pp-result]').text()).toContain('same national ID')
    await w.get('[data-testid=pp-result]').trigger('click')
    expect(w.emitted('update:modelValue')![0]).toEqual([expect.objectContaining({ id: 'p1' })])
  })

  it('shows the chosen person with whether their ID was seen, and where they appear', () => {
    const w = mount(PersonPicker, { props: { modelValue: person({ verified: false }) } })
    expect(w.get('[data-testid=pp-chosen]').text()).toContain('ID not yet seen')
    expect(w.text()).toContain('1 application · 1 receipt')
    expect(w.text()).toContain('Letters: SMS')
  })

  it('offers registration only after a search, carrying the name searched for into the form', async () => {
    api.search.mockResolvedValue([])
    const w = mount(PersonPicker, { props: { modelValue: null } })
    expect(w.find('[data-testid=pp-register]').exists()).toBe(false)
    await search(w, 'Lindiwe Hlongwane')
    expect(w.get('[data-testid=pp-none]').text()).toContain('Nobody in the register')
    await w.get('[data-testid=pp-register]').trigger('click')
    expect((w.get('[data-testid=pp-surname]').element as HTMLInputElement).value).toBe('Hlongwane')
  })

  it('a national ID searched for is carried into the ID field', async () => {
    api.search.mockResolvedValue([])
    const w = mount(PersonPicker, { props: { modelValue: null } })
    await search(w, '08-2345678 K 08')
    await w.get('[data-testid=pp-register]').trigger('click')
    expect((w.get('[data-testid=pp-id]').element as HTMLInputElement).value).toBe('08-2345678 K 08')
  })

  it('shows a possible duplicate first, and registers as new only when told none of them is the person', async () => {
    api.search.mockResolvedValue([])
    const moyo = person({ id: 'p9', display_name: 'Mr Moyo', match: 'phone' })
    api.register
      .mockResolvedValueOnce({ error: 'possible_duplicate', message: 'A person with the same phone number…', persons: [moyo] })
      .mockResolvedValueOnce({ person: person({ id: 'p2', display_name: 'Mrs Lindiwe Hlongwane', verified: false }) })
    const w = mount(PersonPicker, { props: { modelValue: null } })
    await search(w, 'Hlongwane')
    await w.get('[data-testid=pp-register]').trigger('click')
    await w.get('[data-testid=pp-form]').trigger('submit')
    await flushPromises()
    expect(w.get('[data-testid=pp-conflict]').text()).toContain('Mr Moyo')
    expect(api.register.mock.calls[0][0]).toMatchObject({ surname: 'Hlongwane', confirm_new: false })
    await w.get('[data-testid=pp-confirm-new]').trigger('click')
    await flushPromises()
    expect(api.register.mock.calls[1][0]).toMatchObject({ confirm_new: true })
    expect(w.emitted('update:modelValue')![0]).toEqual([expect.objectContaining({ id: 'p2' })])
  })

  it('an ID already registered offers that person, and no way to register a second', async () => {
    api.search.mockResolvedValue([])
    api.register.mockResolvedValue({ error: 'already_registered', message: 'That identity number is already registered, to Mr Bernard Phiri.', persons: [person()] })
    const w = mount(PersonPicker, { props: { modelValue: null } })
    await search(w, '63-1234567 X 27')
    await w.get('[data-testid=pp-register]').trigger('click')
    await w.get('[data-testid=pp-surname]').setValue('Phiri')
    await w.get('[data-testid=pp-form]').trigger('submit')
    await flushPromises()
    expect(w.get('[data-testid=pp-conflict]').text()).toContain('already registered')
    expect(w.find('[data-testid=pp-confirm-new]').exists()).toBe(false)
  })

  it('will not say the ID was seen without its number', async () => {
    api.search.mockResolvedValue([])
    const w = mount(PersonPicker, { props: { modelValue: null } })
    await search(w, 'Khumalo')
    await w.get('[data-testid=pp-register]').trigger('click')
    await w.get('[data-testid=pp-verified]').setValue(true)
    await w.get('[data-testid=pp-form]').trigger('submit')
    await flushPromises()
    expect(api.register).not.toHaveBeenCalled()
    expect(w.text()).toContain('Enter the number of the document you saw.')
  })
})
