// @vitest-environment happy-dom
//
// The Accounting workspace kit: exact-cents journal arithmetic, the pickers, the pager and the CSV
// helpers every later page builds on.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../api/ledgerApi', () => ({
  ledgerApi: { accounts: vi.fn(), parties: vi.fn(), periods: vi.fn() },
}))

import { ledgerApi } from '../api/ledgerApi'
import { parseAmount, lineState, guide, balancingAmount } from '../workspaces/accountant/kit/journalMath'
import { saveBlob, csvName } from '../workspaces/accountant/kit/csv'
import { useLedgerLists, resetLedgerLists } from '../workspaces/accountant/kit/useLedgerLists'
import AccountPicker from '../workspaces/accountant/kit/AccountPicker.vue'
import PartyPicker from '../workspaces/accountant/kit/PartyPicker.vue'
import BookSwitch from '../workspaces/accountant/kit/BookSwitch.vue'
import CwSkeleton from '../workspaces/accountant/kit/CwSkeleton.vue'
import Pager from '../workspaces/accountant/kit/Pager.vue'
import DateRange from '../workspaces/accountant/kit/DateRange.vue'
import type { LedgerAccount, LedgerParty } from '../models/ledgerTypes'

const acct = (code: string, name: string, over: Partial<LedgerAccount> = {}): LedgerAccount => ({
  id: `id-${code}`, code, name, root_type: 'asset', report_type: 'balance_sheet', account_type: null,
  parent_id: null, is_group: false, is_postable: true, status: 'active', ...over,
})
const ACCOUNTS = [
  acct('1000', 'Cash at hand'), acct('1200', 'Debtors control'), acct('1210', 'Rates debtors'),
  acct('2100', 'Creditors 12 months'), acct('4000', 'Rates income', { root_type: 'revenue' }),
  acct('5000', 'Salaries', { root_type: 'expense' }),
]

describe('parseAmount', () => {
  it('reads plain amounts as exact cents', () => {
    expect(parseAmount('12')).toBe(1200n)
    expect(parseAmount('12.5')).toBe(1250n)
    expect(parseAmount('12.50')).toBe(1250n)
    expect(parseAmount(' 7 ')).toBe(700n)
    expect(parseAmount('0.07')).toBe(7n)
  })
  it('rejects commas, three decimals, signs and junk', () => {
    for (const bad of ['1,250.50', '12.345', '-5', '+5', '', '  ', 'abc', '1e3', '.5', '5.']) {
      expect(parseAmount(bad)).toBeNull()
    }
  })
})

describe('lineState', () => {
  it('names what a line carries', () => {
    expect(lineState({ debit: '', credit: '' })).toBe('empty')
    expect(lineState({ debit: '5', credit: '' })).toBe('debit')
    expect(lineState({ debit: '', credit: '5' })).toBe('credit')
    expect(lineState({ debit: '5', credit: '5' })).toBe('both')
    expect(lineState({ debit: 'x', credit: '' })).toBe('unreadable')
    expect(lineState({ debit: '', credit: '1,0' })).toBe('unreadable')
  })
})

describe('guide', () => {
  it('totals exactly and reports balance', () => {
    expect(guide([{ debit: '450.00', credit: '' }, { debit: '', credit: '450' }]))
      .toEqual({ debit: '450.00', credit: '450.00', difference: '0.00', inBalance: true, unreadable: 0 })
  })
  it('does not fall into the floating point trap', () => {
    const g = guide([{ debit: '0.10', credit: '' }, { debit: '0.20', credit: '' }, { debit: '', credit: '0.30' }])
    expect(g.inBalance).toBe(true)
    expect(g.difference).toBe('0.00')
  })
  it('states a difference of debits less credits', () => {
    expect(guide([{ debit: '100', credit: '' }, { debit: '', credit: '40.50' }]))
      .toEqual({ debit: '100.00', credit: '40.50', difference: '59.50', inBalance: false, unreadable: 0 })
  })
  it('counts unreadable lines and is never in balance with one', () => {
    expect(guide([{ debit: '10', credit: '' }, { debit: '1,0', credit: '' }]))
      .toMatchObject({ unreadable: 1, inBalance: false })
  })
  it('is not in balance when the totals are nil', () => {
    expect(guide([{ debit: '', credit: '' }])).toMatchObject({ debit: '0.00', credit: '0.00', inBalance: false })
  })
})

describe('balancingAmount', () => {
  const lines = [{ debit: '100', credit: '' }, { debit: '', credit: '40' }, { debit: '', credit: '' }]
  it('says what an empty line must carry', () => {
    expect(balancingAmount(lines, 2)).toEqual({ side: 'credit', amount: '60.00' })
    expect(balancingAmount([{ debit: '', credit: '25.5' }, { debit: '', credit: '' }], 1))
      .toEqual({ side: 'debit', amount: '25.50' })
  })
  it('is null when already in balance or a line is unreadable', () => {
    expect(balancingAmount([{ debit: '5', credit: '' }, { debit: '', credit: '5' }, { debit: '', credit: '' }], 2)).toBeNull()
    expect(balancingAmount([{ debit: 'x', credit: '' }, { debit: '', credit: '' }], 1)).toBeNull()
  })
})

describe('csv helpers', () => {
  it('names a file from its parts', () => {
    expect(csvName(['Trial balance', 'USD', '2026-09-30'])).toBe('trial-balance-usd-2026-09-30.csv')
    expect(csvName(['General ledger', null, undefined, '', 'ZWG'])).toBe('general-ledger-zwg.csv')
  })
  it('saves a blob through a temporary anchor and revokes the URL', () => {
    const create = vi.fn(() => 'blob:x')
    const revoke = vi.fn()
    ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = create
    ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revoke
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('a.csv')
      expect(this.href).toContain('blob:x')
    })
    saveBlob(new Blob(['a,b']), 'a.csv')
    expect(create).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:x')
    expect(document.querySelector('a[download]')).toBeNull()
    click.mockRestore()
  })
})

describe('useLedgerLists', () => {
  beforeEach(() => {
    resetLedgerLists()
    vi.mocked(ledgerApi.accounts).mockReset()
    vi.mocked(ledgerApi.parties).mockReset()
    vi.mocked(ledgerApi.periods).mockReset()
  })
  it('caches accounts until forced or reset', async () => {
    vi.mocked(ledgerApi.accounts).mockResolvedValue({ accounts: ACCOUNTS, total: 6 } as never)
    const a = useLedgerLists()
    await a.loadAccounts()
    await useLedgerLists().loadAccounts()
    expect(ledgerApi.accounts).toHaveBeenCalledTimes(1)
    expect(a.accounts.value).toHaveLength(6)
    await a.loadAccounts(true)
    expect(ledgerApi.accounts).toHaveBeenCalledTimes(2)
    resetLedgerLists()
    expect(a.accounts.value).toHaveLength(0)
  })
  it('keeps the error text when a read fails', async () => {
    vi.mocked(ledgerApi.parties).mockRejectedValue(new Error('down'))
    const l = useLedgerLists()
    await l.loadParties()
    expect(l.error.value).toBeTruthy()
    expect(l.parties.value).toEqual([])
  })
  it('finds the period holding a date', async () => {
    vi.mocked(ledgerApi.periods).mockResolvedValue({ periods: [
      { id: 'p1', financial_year_id: 'y', period_no: 1, label: 'Jul', from_date: '2026-07-01', to_date: '2026-07-31', status: 'open' },
      { id: 'p2', financial_year_id: 'y', period_no: 2, label: 'Aug', from_date: '2026-08-01', to_date: '2026-08-31', status: 'closed' },
    ] } as never)
    const l = useLedgerLists()
    await l.loadPeriods('y')
    expect(l.periodFor('2026-08-31')?.id).toBe('p2')
    expect(l.periodFor('2026-07-01')?.id).toBe('p1')
    expect(l.periodFor('2026-09-01')).toBeNull()
  })
})

describe('AccountPicker', () => {
  const mountIt = (props: Record<string, unknown> = {}) =>
    mount(AccountPicker, { props: { modelValue: '', accounts: ACCOUNTS, label: 'Account', ...props }, attachTo: document.body })

  it('lists codes starting with the typed digits first, then name matches', async () => {
    const w = mountIt()
    const input = w.get('input')
    await input.setValue('12')
    const options = w.findAll('[role="option"]').map(o => o.text())
    expect(options[0]).toContain('1200')
    expect(options[1]).toContain('1210')
    expect(options[2]).toContain('Creditors 12 months')
    expect(options).toHaveLength(3)
    w.unmount()
  })
  it('chooses with ArrowDown and Enter, and exposes combobox semantics', async () => {
    const w = mountIt()
    const input = w.get('input')
    expect(input.attributes('role')).toBe('combobox')
    expect(input.attributes('aria-expanded')).toBe('false')
    await input.setValue('12')
    expect(input.attributes('aria-expanded')).toBe('true')
    expect(w.get('[role="listbox"]').attributes('id')).toBe(input.attributes('aria-controls'))
    await input.trigger('keydown', { key: 'ArrowDown' })
    const active = input.attributes('aria-activedescendant')
    expect(active).toBeTruthy()
    expect(w.get(`#${active}`).attributes('role')).toBe('option')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['id-1210'])
    expect(input.attributes('aria-expanded')).toBe('false')
    w.unmount()
  })
  it('closes on Escape and keeps the previous value', async () => {
    const w = mountIt({ modelValue: 'id-4000' })
    const input = w.get('input')
    expect((input.element as HTMLInputElement).value).toContain('4000')
    await input.setValue('zzz')
    await input.trigger('keydown', { key: 'Escape' })
    expect(input.attributes('aria-expanded')).toBe('false')
    expect((input.element as HTMLInputElement).value).toContain('4000')
    expect(w.emitted('update:modelValue')).toBeUndefined()
    w.unmount()
  })
  it('honours the filter, shows at most 50, and has a label', async () => {
    const many = Array.from({ length: 80 }, (_, i) => acct(String(3000 + i), `Item ${i}`))
    const w = mountIt({ accounts: many })
    await w.get('input').trigger('focus')
    await w.get('input').setValue('3')
    expect(w.findAll('[role="option"]')).toHaveLength(50)
    expect(w.get('label').text()).toBe('Account')
    await w.setProps({ accounts: ACCOUNTS, filter: (a: LedgerAccount) => a.root_type === 'revenue' })
    await w.get('input').setValue('')
    await w.get('input').trigger('focus')
    expect(w.findAll('[role="option"]').map(o => o.text())).toEqual([expect.stringContaining('4000')])
    w.unmount()
  })
})

describe('PartyPicker', () => {
  const party = (id: string, name: string, party_type: LedgerParty['party_type']): LedgerParty =>
    ({ id, name, party_type, reference: `R-${id}`, status: 'active' })
  const PARTIES = [party('1', 'Acme Supplies', 'supplier'), party('2', 'Moyo, T', 'ratepayer'), party('3', 'Acme Rates', 'debtor')]
  it('limits to the types asked for and chooses by keyboard', async () => {
    const w = mount(PartyPicker, { props: { modelValue: '', parties: PARTIES, types: ['supplier', 'debtor'], label: 'Party' }, attachTo: document.body })
    const input = w.get('input')
    expect(input.attributes('role')).toBe('combobox')
    await input.setValue('acme')
    expect(w.findAll('[role="option"]')).toHaveLength(2)
    await input.setValue('moyo')
    expect(w.findAll('[role="option"]')).toHaveLength(0)
    await input.setValue('acme r')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['3'])
    w.unmount()
  })
})

describe('BookSwitch', () => {
  it('is a radiogroup that switches book', async () => {
    const w = mount(BookSwitch, { props: { modelValue: 'USD' } })
    expect(w.get('[role="radiogroup"]').exists()).toBe(true)
    const radios = w.findAll('[role="radio"]')
    expect(radios.map(r => r.text())).toEqual(['USD', 'ZWG'])
    expect(radios[0].attributes('aria-checked')).toBe('true')
    expect(radios[1].attributes('aria-checked')).toBe('false')
    await radios[1].trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['ZWG'])
  })
  it('moves focus with the arrow keys, Home and End', async () => {
    const w = mount(BookSwitch, { props: { modelValue: 'USD' }, attachTo: document.body })
    const radios = w.findAll('[role="radio"]')
    radios[0].element.focus()
    await radios[0].trigger('keydown', { key: 'ArrowRight' })
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['ZWG'])
    expect(document.activeElement).toBe(radios[1].element)
    await w.setProps({ modelValue: 'ZWG' })
    await radios[1].trigger('keydown', { key: 'Home' })
    expect(w.emitted('update:modelValue')?.[1]).toEqual(['USD'])
    expect(document.activeElement).toBe(radios[0].element)
    await radios[0].trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(radios[1].element)
    w.unmount()
  })
})

describe('CwSkeleton and pickers', () => {
  it('CwSkeleton is a busy card with a status line a screen reader hears', () => {
    const w = mount(CwSkeleton, { props: { label: 'the journals' } })
    expect(w.attributes('aria-busy')).toBe('true')
    expect(w.get('[role="status"]').text()).toBe('Loading the journals…')
  })
  it('a picker passes describedby and invalid to its combobox', () => {
    const w = mount(AccountPicker, { props: { modelValue: '', accounts: [], label: 'Account', describedby: 'hint-1', invalid: true } })
    const input = w.get('input[role="combobox"]')
    expect(input.attributes('aria-describedby')).toBe('hint-1')
    expect(input.attributes('aria-invalid')).toBe('true')
  })
})

describe('Pager', () => {
  it('says where the page sits and steps by the limit', async () => {
    const w = mount(Pager, { props: { total: 340, limit: 100, offset: 100 } })
    expect(w.text()).toContain('101–200 of 340')
    const [prev, next] = w.findAll('button')
    expect(prev.text()).toBe('Previous')
    await next.trigger('click')
    expect(w.emitted('update:offset')?.[0]).toEqual([200])
    await prev.trigger('click')
    expect(w.emitted('update:offset')?.[1]).toEqual([0])
  })
  it('while `disabled`, marks both buttons aria-disabled and emits nothing', async () => {
    const w = mount(Pager, { props: { total: 340, limit: 100, offset: 100, disabled: true } })
    const [prev, next] = w.findAll('button')
    expect(prev.attributes('aria-disabled')).toBe('true')
    expect(next.attributes('aria-disabled')).toBe('true')
    expect(prev.attributes('disabled')).toBeUndefined()
    await prev.trigger('click')
    await next.trigger('click')
    expect(w.emitted('update:offset')).toBeUndefined()
    await w.setProps({ disabled: false })
    expect(next.attributes('aria-disabled')).toBeUndefined()
    await next.trigger('click')
    expect(w.emitted('update:offset')?.[0]).toEqual([200])
  })
  it('marks Previous at the start and Next at the end aria-disabled, emits nothing, and never uses `disabled`', async () => {
    const start = mount(Pager, { props: { total: 340, limit: 100, offset: 0 } })
    const [sp, sn] = start.findAll('button')
    expect(sp.attributes('aria-disabled')).toBe('true')
    expect(sp.attributes('disabled')).toBeUndefined()
    expect(sn.attributes('aria-disabled')).toBeUndefined()
    await sp.trigger('click')
    expect(start.emitted('update:offset')).toBeUndefined()
    expect(start.text()).toContain('1–100 of 340')
    const end = mount(Pager, { props: { total: 340, limit: 100, offset: 300 } })
    const [ep, en] = end.findAll('button')
    expect(en.attributes('aria-disabled')).toBe('true')
    expect(en.attributes('disabled')).toBeUndefined()
    expect(ep.attributes('aria-disabled')).toBeUndefined()
    await en.trigger('click')
    expect(end.emitted('update:offset')).toBeUndefined()
    expect(end.text()).toContain('301–340 of 340')
    const none = mount(Pager, { props: { total: 0, limit: 100, offset: 0 } })
    expect(none.text()).toContain('0 of 0')
  })
  it('keeps focus on Next when it is pressed onto the last page', async () => {
    const w = mount(Pager, { props: { total: 340, limit: 100, offset: 200 }, attachTo: document.body })
    const next = w.findAll('button')[1]
    next.element.focus()
    await next.trigger('click')
    await w.setProps({ offset: 300 })
    expect(next.attributes('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(next.element)
    w.unmount()
  })
})

describe('DateRange', () => {
  it('emits each end and passes min and max through', async () => {
    const w = mount(DateRange, { props: { from: '2026-07-01', to: '2026-07-31', min: '2026-07-01', max: '2027-06-30' } })
    const [from, to] = w.findAll('input[type="date"]')
    expect(from.attributes('min')).toBe('2026-07-01')
    expect(to.attributes('max')).toBe('2027-06-30')
    await from.setValue('2026-07-05')
    await to.setValue('2026-07-20')
    expect(w.emitted('update:from')?.[0]).toEqual(['2026-07-05'])
    expect(w.emitted('update:to')?.[0]).toEqual(['2026-07-20'])
  })
})
