// @vitest-environment happy-dom
import { mount, flushPromises, RouterLinkStub } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const api = vi.hoisted(() => ({ search: vi.fn(), lookup: vi.fn() }))
vi.mock('@/services/planLookup', async (orig) => {
  const actual = await (orig as any)()
  return { ...actual, planLookup: api }
})

import PlanLookupView from '@/views/PlanLookupView.vue'

const cand = (over: any = {}) => ({ layer: 'vungu_parcels', id: '12', label: 'Dorset Farm 12', place: 'Gweru', area_ha: 12.5, ...over })
const use = (code: string, description: string, conditions: string | null = null) => ({ code, description, category: null, conditions })
const zone = (over: any = {}) => ({
  governing: true, share_pct: 100,
  plan: { id: 'p1', title: 'Vungu local plan', version: 1, status: 'gazetted', authority: 'Vungu Rural District Council', gazette_ref: 'SI 9 of 2027', effective_from: '2027-01-01', provisional: false },
  zone: { id: 7, name: 'Mixed Density Residential', type_code: 'Mixed Density Residential', review_status: 'reviewed', reviewed_by: 'T. Dube' },
  uses: {
    permitted: [use('A', 'Detached dwelling houses'), use('Q', 'Agricultural buildings')],
    special_consent: [use('D', 'Shops', 'Trading hours 6am to 8pm')],
    prohibited: [use('M', 'Industrial buildings')],
  },
  not_decided: 2, ...over,
})
const found = (over: any = {}) => ({
  parcel: { layer: 'vungu_parcels', id: '12', label: 'Dorset Farm 12', place: 'Gweru', area_ha: 12.5 },
  published: true, provisional: false, results: [zone()], notice: 'This is information, not a permit or a decision.', ...over,
})

const mountPage = () => mount(PlanLookupView, { global: { stubs: { 'router-link': RouterLinkStub } } })
async function ask(w: any, text: string) {
  await w.find('#pl-q').setValue(text)
  await w.find('form').trigger('submit')
  await flushPromises()
}

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()) })

describe('PlanLookupView', () => {
  it('asks in plain words and offers a search box labelled for a stand number or farm name', () => {
    const w = mountPage()
    expect(w.find('h1').text()).toBe('What can I build here?')
    expect(w.find('label[for="pl-q"]').text()).toBe('Stand number or farm name')
  })

  it('does not send a search that is too short', async () => {
    const w = mountPage()
    await ask(w, 'a')
    expect(api.search).not.toHaveBeenCalled()
    expect(w.find('[role="alert"]').text()).toContain('at least 2')
  })

  it('goes straight to the result when only one parcel matches', async () => {
    api.search.mockResolvedValue([cand()])
    api.lookup.mockResolvedValue(found())
    const w = mountPage()
    await ask(w, 'Dorset')
    expect(api.lookup).toHaveBeenCalledWith('vungu_parcels', '12')
    expect(w.find('.pl-parcel').text()).toBe('Dorset Farm 12')
    expect(w.find('.pl-meta').text()).toBe('Gweru · 12.5 ha')
  })

  it('lets the visitor choose when several parcels match, then shows the one chosen', async () => {
    api.search.mockResolvedValue([cand(), cand({ id: '13', label: 'Dorset Farm 13', place: 'Vungu', area_ha: 400 })])
    api.lookup.mockResolvedValue(found())
    const w = mountPage()
    await ask(w, 'Dorset')
    expect(api.lookup).not.toHaveBeenCalled()
    expect(w.text()).toContain('Which one do you mean?')
    const buttons = w.findAll('.pl-cand')
    expect(buttons.map((b) => b.text())).toEqual(['Dorset Farm 12Gweru · 12.5 ha', 'Dorset Farm 13Vungu · 400 ha'])
    await buttons[0].trigger('click')
    await flushPromises()
    expect(api.lookup).toHaveBeenCalledWith('vungu_parcels', '12')
    expect(w.find('.pl-pick').exists()).toBe(false)
  })

  it('says so when nothing matches', async () => {
    api.search.mockResolvedValue([])
    const w = mountPage()
    await ask(w, 'Nowhere')
    expect(w.find('[data-testid="none-found"]').text()).toContain('could not find any land')
  })

  it('shows the zone, the plan behind it and the uses in three plain groups, with conditions', async () => {
    api.search.mockResolvedValue([cand()])
    api.lookup.mockResolvedValue(found())
    const w = mountPage()
    await ask(w, 'Dorset')
    const z = w.find('.pl-zone')
    expect(z.find('.pl-zonename').text()).toBe('Mixed Density Residential')
    expect(z.find('.pl-planline').text()).toContain('Vungu local plan, Vungu Rural District Council')
    expect(z.find('.pl-planline').text()).toContain('in force')
    expect(z.find('.pl-planline').text()).toContain('SI 9 of 2027')
    const lists = z.findAll('.pl-list')
    expect(lists[0].text()).toContain('Allowed')
    expect(lists[0].text()).toContain('Detached dwelling houses')
    expect(lists[1].text()).toContain("Allowed only with the council's consent")
    expect(lists[1].text()).toContain('Shops')
    expect(lists[1].text()).toContain('Conditions: Trading hours 6am to 8pm')
    expect(lists[2].text()).toContain('Industrial buildings')
    expect(z.text()).not.toMatch(/\bSC\b|\bP\b|\bX\b/)               // no codes for the public
    expect(w.find('[data-testid="draft-banner"]').exists()).toBe(false)
  })

  it('says how many uses the plan has not decided, and never calls them allowed', async () => {
    api.search.mockResolvedValue([cand()])
    api.lookup.mockResolvedValue(found())
    const w = mountPage()
    await ask(w, 'Dorset')
    expect(w.find('.pl-zone').text()).toContain('has not decided 2 uses')
    expect(w.find('.pl-zone').text()).toContain('ask the planning office')
  })

  it('"not published" is its own plain answer, with no zone or uses shown', async () => {
    api.search.mockResolvedValue([cand()])
    api.lookup.mockResolvedValue(found({ published: false, results: [] }))
    const w = mountPage()
    await ask(w, 'Dorset')
    const card = w.find('[data-testid="not-published"]')
    expect(card.text()).toContain('No plan has been published for this land yet')
    expect(card.text()).toContain("planning office")
    expect(w.find('.pl-zone').exists()).toBe(false)
  })

  it('marks a draft clearly when council staff preview one', async () => {
    api.search.mockResolvedValue([cand()])
    api.lookup.mockResolvedValue(found({
      provisional: true,
      results: [zone({ plan: { ...zone().plan, status: 'draft', gazette_ref: null, effective_from: null, provisional: true } })],
    }))
    const w = mountPage()
    await ask(w, 'Dorset')
    const banner = w.find('[data-testid="draft-banner"]').text()
    expect(banner).toContain('Draft rules, not council policy')
    expect(banner).toContain('signed in as council staff')
    expect(w.find('.pl-planline').text()).toContain('a draft')
  })

  it('finds a use by a word the visitor types, across all three groups', async () => {
    api.search.mockResolvedValue([cand()])
    api.lookup.mockResolvedValue(found())
    const w = mountPage()
    await ask(w, 'Dorset')
    await w.find('#pl-f').setValue('shop')
    const items = w.findAll('.pl-list li').map((l) => l.text())
    expect(items).toHaveLength(1)
    expect(items[0]).toContain('Shops')
    await w.find('#pl-f').setValue('spaceship')
    expect(w.find('[data-testid="no-match"]').text()).toContain('"spaceship"')
  })

  it('land split between two zones of one plan says so, and shows each share', async () => {
    api.search.mockResolvedValue([cand()])
    api.lookup.mockResolvedValue(found({ results: [zone({ share_pct: 80 }), zone({ governing: false, share_pct: 20, zone: { ...zone().zone, id: 8, name: 'Institutional' } })] }))
    const w = mountPage()
    await ask(w, 'Dorset')
    expect(w.findAll('.pl-zonename').map((e) => e.text())).toEqual(['Mixed Density Residential', 'Institutional'])
    expect(w.find('[data-testid="split-note"]').text()).toContain('lies in more than one zone')
    expect(w.find('[data-testid="split-note"]').text()).not.toContain('plan covers')
    expect(w.findAll('.pl-share').map((e) => e.text())).toEqual(['About 80% of this land', 'About 20% of this land'])
    expect(w.findAll('#pl-f')).toHaveLength(1)
  })

  it('land covered by two different plans says that instead', async () => {
    api.search.mockResolvedValue([cand()])
    api.lookup.mockResolvedValue(found({ results: [zone(), zone({ governing: false, share_pct: 20, plan: { ...zone().plan, id: 'p2', title: 'Other plan' }, zone: { ...zone().zone, id: 8 } })] }))
    const w = mountPage()
    await ask(w, 'Dorset')
    expect(w.find('[data-testid="split-note"]').text()).toContain('More than one plan covers this land')
  })

  it('one zone shows no split note and no share', async () => {
    api.search.mockResolvedValue([cand()])
    api.lookup.mockResolvedValue(found())
    const w = mountPage()
    await ask(w, 'Dorset')
    expect(w.find('[data-testid="split-note"]').exists()).toBe(false)
    expect(w.find('.pl-share').exists()).toBe(false)
  })

  it('puts the server\'s plain refusal of a bad search in front of the visitor, and hides faults', async () => {
    api.search.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Enter at least two letters or digits of a stand number or farm name.' } } })
    const w = mountPage()
    await ask(w, 'ab')
    expect(w.find('[role="alert"]').text()).toContain('Enter at least two letters')
    api.search.mockRejectedValueOnce({ response: { status: 500, data: { message: 'connection to 10.0.0.5 failed' } } })
    await ask(w, 'abc')
    expect(w.find('[role="alert"]').text()).toBe('The search did not work. Please try again.')
    api.search.mockRejectedValueOnce({ response: { status: 429 } })
    await ask(w, 'abcd')
    expect(w.find('[role="alert"]').text()).toContain('Too many searches')
  })

  it('says a lookup failed rather than showing a stale result', async () => {
    api.search.mockResolvedValue([cand()])
    api.lookup.mockResolvedValueOnce(found()).mockRejectedValueOnce({ response: { status: 500 } })
    const w = mountPage()
    await ask(w, 'Dorset')
    expect(w.find('.pl-zone').exists()).toBe(true)
    await ask(w, 'Dorset')
    expect(w.find('.pl-zone').exists()).toBe(false)
    expect(w.find('[role="alert"]').text()).toContain('could not look that up')
  })

  it('offers a way to start an application, and repeats that this is information only', async () => {
    api.search.mockResolvedValue([cand()])
    api.lookup.mockResolvedValue(found())
    const w = mountPage()
    await ask(w, 'Dorset')
    expect(w.find('.pl-next').text()).toContain('not a permit or a decision')
    expect(w.findComponent(RouterLinkStub).exists()).toBe(true)
    expect(w.find('.pl-apply').text()).toBe('Start an application')
  })
})
