/**
 * Reading a cut-over file: the pure row readers of src/lib/financeMigration.js.
 *
 * NO DATABASE AND NO HTTP. What may be WRITTEN, and the gates, live in migration 211 and are
 * proven end to end by src/routes/__tests__/finance.migration.test.js. What is tested here is the
 * one rule these functions exist to keep: a row that cannot be placed becomes a problem for a
 * person, and is never guessed at.
 */
const {
  readChartRow, readPartyRow, readBalanceRow, readOpenItemRow, suggestCategoryMap, daysBefore, cents, fromCents,
} = require('../src/lib/financeMigration')
const { migrationRefusal, TEMPLATES } = require('../src/routes/finance-migration')
const { LOADS } = require('../src/config/migrationProfiles')

const chartLookups = (accounts = []) => ({
  seen: new Set(), mappedCodes: new Set(),
  accountsByCode: new Map(accounts.map((a) => [a.code.toUpperCase(), a])),
  accountsById: new Map(accounts.map((a) => [a.id, a])),
})

describe('chart of accounts rows', () => {
  const headers = ['Account', 'Description', 'Category']
  const columnMap = { code: 'Account', name: 'Description', category: 'Category' }
  const options = { category_map: { Bank: { root_type: 'asset', account_type: 'bank' }, Odd: { root_type: null } } }
  const read = (cells, extra = {}) => readChartRow({ cells, headers, columnMap, options, lookups: chartLookups(), ...extra })

  test('a category a person has classed makes the account ready to create', () => {
    expect(read(['8400', 'CBZ current', 'Bank'])).toMatchObject({
      status: 'ready', parsed: { action: 'create', root_type: 'asset', account_type: 'bank', code: '8400' },
    })
  })

  test('the class is never worked out from the account number', () => {
    const out = read(['1000', 'Land', ''])
    expect(out.status).toBe('problem')
    expect(out.problems[0].field).toBe('root_type')
    expect(read(['1000', 'Land', 'Odd']).status).toBe('problem')
  })

  test('the same number and description as an account already in the chart is that account', () => {
    const lookups = chartLookups([{ id: 'a1', code: '8400', name: 'CBZ  Current', is_group: false }])
    expect(read(['8400', 'cbz current', 'Bank'], { lookups })).toMatchObject({ status: 'ready', parsed: { action: 'map', ledger_account_id: 'a1' } })
  })

  test('the same number with a different description waits for a decision', () => {
    const lookups = () => chartLookups([{ id: 'a1', code: '8400', name: 'Petty cash', is_group: false }])
    expect(read(['8400', 'CBZ current', 'Bank'], { lookups: lookups() }).status).toBe('problem')
    expect(read(['8400', 'CBZ current', 'Bank'], { lookups: lookups(), decision: { action: 'create', new_code: '8401' } }))
      .toMatchObject({ status: 'ready', parsed: { action: 'create', new_code: '8401' } })
  })

  test('retiring a code needs a reason; a repeated code is a problem', () => {
    expect(read(['9999', 'Suspense', 'Odd'], { decision: { action: 'set_aside' } }).status).toBe('problem')
    expect(read(['9999', 'Suspense', 'Odd'], { decision: { action: 'set_aside', note: 'Nil since 2019' } }))
      .toMatchObject({ status: 'set_aside', parsed: { action: 'retire' } })
    const lookups = chartLookups()
    read(['8400', 'CBZ current', 'Bank'], { lookups })
    expect(read(['8400', 'CBZ current', 'Bank'], { lookups }).problems[0].message).toMatch(/more than once/)
  })

  test('category suggestions come from the package\'s own names, and an unknown one is left blank', () => {
    expect(suggestCategoryMap(['Accounts Receivable', 'Retained Income', 'Whatever', '', 'Accounts Receivable'])).toEqual({
      'Accounts Receivable': { root_type: 'asset', account_type: 'receivable', suggested: true },
      'Retained Income': { root_type: 'equity', account_type: 'accumulated_surplus', suggested: true },
      Whatever: { root_type: null, account_type: null, suggested: false },
    })
  })
})

describe('customer and supplier rows', () => {
  const headers = ['Code', 'Name', 'Address 1', 'Address 2']
  const columnMap = { code: 'Code', name: 'Name', address_1: 'Address 1', address_2: 'Address 2' }
  const existing = { id: 'p1', name: 'Ncube Stores', reference: 'NCU001', party_type: 'debtor' }
  const lookups = () => ({
    seen: new Set(), mappedCodes: new Set(), partiesById: new Map([['p1', existing]]),
    partiesByReference: new Map([['NCU001', existing]]), partiesByName: new Map([['ncube stores', [existing]]]),
  })
  const read = (cells, extra = {}) => readPartyRow({ cells, headers, columnMap, options: { party_kind: 'customer' }, lookups: lookups(), ...extra })

  test('a new account is created with its address joined', () => {
    expect(read(['MOY001', 'T Moyo', '12 Main St', 'Gweru'])).toMatchObject({
      status: 'ready', parsed: { action: 'create', party_type: 'debtor', reference: 'MOY001', address_text: '12 Main St, Gweru' },
    })
  })

  test('the same name is put to a person with the candidates, and is not merged', () => {
    const out = read(['X9', 'NCUBE  STORES', '', ''])
    expect(out.status).toBe('problem')
    expect(out.problems[0].candidates).toEqual([{ id: 'p1', name: 'Ncube Stores', reference: 'NCU001' }])
    expect(read(['X9', 'NCUBE STORES', '', ''], { decision: { action: 'create' } }).status).toBe('ready')
    expect(read(['X9', 'NCUBE STORES', '', ''], { decision: { action: 'map', party_id: 'p1' } }))
      .toMatchObject({ status: 'ready', parsed: { action: 'map', party_id: 'p1' } })
  })

  test('a number already used in the register cannot be created again even when confirmed as new', () => {
    expect(read(['NCU001', 'Somebody Else', '', ''], { decision: { action: 'create' } }).status).toBe('problem')
    expect(read(['NCU001', 'Somebody Else', '', ''], { decision: { action: 'create', reference: 'NCU002' } }).status).toBe('ready')
  })

  test('a supplier file makes suppliers', () => {
    expect(read(['S1', 'Gweru Hardware', '', ''], { options: { party_kind: 'supplier' } }).parsed.party_type).toBe('supplier')
  })
})

describe('trial balance rows', () => {
  const headers = ['Account', 'Description', 'Debit', 'Credit', 'Balance']
  const mapped = { disposition: 'mapped', ledger_account_id: 'a1', code: '8400', name: 'Bank', is_postable: true, status: 'active' }
  const lookups = { codeMap: new Map([['8400', mapped], ['9999', { disposition: 'retired' }], ['1', { ...mapped, is_postable: false }]]) }
  const sides = { code: 'Account', name: 'Description', debit: 'Debit', credit: 'Credit' }
  const read = (cells, columnMap = sides, extra = {}) => readBalanceRow({ cells, headers, columnMap, lookups, ...extra })

  test('a debit or a credit lands on its side as a decimal string', () => {
    expect(read(['8400', 'Bank', '1,000.50', ''])).toMatchObject({ status: 'ready', parsed: { debit: '1000.50', credit: '0.00', ledger_account_id: 'a1' } })
    expect(read(['8400', 'Bank', '', '(250.00)']).status).toBe('problem')
    expect(read(['8400', 'Bank', '', '250'])).toMatchObject({ status: 'ready', parsed: { debit: '0.00', credit: '250.00' } })
  })

  test('a single signed balance column: credits are negative', () => {
    const one = { code: 'Account', balance: 'Balance' }
    expect(read(['8400', 'Bank', '', '', '-75.25'], one).parsed).toMatchObject({ debit: '0.00', credit: '75.25' })
    expect(read(['8400', 'Bank', '', '', '(75.25)'], one).parsed).toMatchObject({ credit: '75.25' })
    expect(read(['8400', 'Bank', '', '', '12'], one).parsed).toMatchObject({ debit: '12.00' })
  })

  test('both sides on one line are netted exactly', () => {
    expect(read(['8400', 'Bank', '100.10', '0.30']).parsed).toMatchObject({ debit: '99.80', credit: '0.00' })
    expect(read(['8400', 'Bank', '0.10', '0.30']).parsed).toMatchObject({ debit: '0.00', credit: '0.20' })
    expect(read(['8400', 'Bank', '5.00', '5.00']).status).toBe('set_aside')
  })

  test('a nil balance and a total line are set aside and listed, never loaded', () => {
    expect(read(['8400', 'Bank', '0.00', ''])).toMatchObject({ status: 'set_aside', parsed: { note: 'Nil balance' } })
    const total = read(['', 'Total', '1300.00', '1300.00'].slice(0, 4))
    expect(read(['', 'Total', '1300.00', '']).status).toBe('set_aside')
    expect(read(['', 'Total', '1300.00', '']).parsed).toMatchObject({ debit: '0.00', credit: '0.00' })
    expect(total.status).toBe('set_aside')
  })

  test('an unmapped, retired or heading account with a balance waits; an unreadable figure is not a zero', () => {
    expect(read(['7777', 'Unknown', '10', '']).problems[0].message).toMatch(/not in the account mapping/)
    expect(read(['9999', 'Suspense', '10', '']).problems[0].message).toMatch(/retired/)
    expect(read(['1', 'Heading', '10', '']).problems[0].message).toMatch(/heading or inactive/)
    expect(read(['8400', 'Bank', 'n/a', '']).status).toBe('problem')
  })

  test('only a comparison may set an unmapped balance aside, and only with a reason', () => {
    const decision = { action: 'set_aside', note: 'Closed before cut-over' }
    expect(read(['7777', 'Unknown', '10', ''], sides, { decision }).status).toBe('problem')
    expect(read(['7777', 'Unknown', '10', ''], sides, { decision, allowSetAside: true })).toMatchObject({ status: 'set_aside', parsed: { debit: '10.00' } })
  })
})

describe('open item rows', () => {
  const lookups = { partyMap: new Map([['customer:C1', { party_id: 'p1', name: 'T Moyo' }], ['supplier:S1', { party_id: 'p2', name: 'Hardware' }]]) }
  const cutoverDate = '2026-07-01'

  test('one document per row, dated day first', () => {
    const out = readOpenItemRow({
      cells: ['C1', 'INV-1', '14/03/2026', '120.00'], headers: ['Account', 'Doc', 'Date', 'Outstanding'],
      columnMap: { party_code: 'Account', document_no: 'Doc', document_date: 'Date', amount: 'Outstanding' },
      options: { item_side: 'debtors' }, lookups, cutoverDate,
    })
    expect(out).toMatchObject({ status: 'ready', parsed: { party_id: 'p1', amount: '120.00', items: [{ amount: '120.00', document_date: '2026-03-14', document_no: 'INV-1' }] } })
  })

  test('a document with no date cannot be aged and waits; one dated after the cut-over is held at it and says so', () => {
    const base = { headers: ['Account', 'Date', 'Outstanding'], columnMap: { party_code: 'Account', document_date: 'Date', amount: 'Outstanding' }, options: { item_side: 'debtors' }, lookups, cutoverDate }
    expect(readOpenItemRow({ ...base, cells: ['C1', '', '5.00'] }).status).toBe('problem')
    const late = readOpenItemRow({ ...base, cells: ['C1', '2026-07-09', '5.00'] })
    expect(late.parsed.items[0]).toMatchObject({ document_date: '2026-07-01' })
    expect(late.parsed.items[0].narration).toMatch(/2026-07-09/)
  })

  test('a summary age analysis becomes one item per non-nil age column', () => {
    const out = readOpenItemRow({
      cells: ['S1', '120.00', '0.00', '80.00'], headers: ['Supplier', 'Current', '30 Days', '60 Days'],
      columnMap: { party_code: 'Supplier', age_current: 'Current', age_30: '30 Days', age_60: '60 Days' },
      options: { item_side: 'creditors' }, lookups, cutoverDate,
    })
    expect(out.status).toBe('ready')
    expect(out.parsed.amount).toBe('200.00')
    expect(out.parsed.items.map((i) => [i.amount, i.document_date])).toEqual([['120.00', '2026-07-01'], ['80.00', '2026-05-02']])
  })

  test('an account that was not brought across waits for a person', () => {
    const out = readOpenItemRow({
      cells: ['C7', '1.00'], headers: ['Account', 'Current'], columnMap: { party_code: 'Account', age_current: 'Current' },
      options: { item_side: 'debtors' }, lookups, cutoverDate,
    })
    expect(out.status).toBe('problem')
  })
})

describe('helpers, refusals and templates', () => {
  test('dates and cents are exact', () => {
    expect(daysBefore('2026-03-01', 1)).toBe('2026-02-28')
    expect(fromCents(cents('0.10') + cents('0.20'))).toBe('0.30')
    expect(fromCents(-5n)).toBe('-0.05')
  })

  test('a database refusal becomes an answer with a stable key', () => {
    expect(migrationRefusal({ message: 'the USD trial balance in tb.csv does not balance: debits 1, credits 2, difference -1' }))
      .toMatchObject({ status: 409, error: 'trial_balance_does_not_balance' })
    expect(migrationRefusal({ message: 'the cut-over cannot be signed off: 2 difference(s) with no explanation', hint: 'Never waived.' }))
      .toMatchObject({ error: 'cutover_not_ready', message: expect.stringMatching(/Never waived/) })
    expect(migrationRefusal({ message: 'x', constraint: 'uq_cutover_in_progress' }).error).toBe('cutover_in_progress')
    expect(migrationRefusal({ message: 'connection reset' })).toBeNull()
  })

  test('every template\'s headings are ones the load recognises', () => {
    const { normaliseHeader } = require('../src/lib/finance')
    for (const [kind, lines] of Object.entries(TEMPLATES)) {
      const aliases = new Set(LOADS[kind].fields.flatMap((f) => f.aliases).map(normaliseHeader))
      for (const heading of lines[0]) expect([kind, heading, aliases.has(normaliseHeader(heading))]).toEqual([kind, heading, true])
    }
  })
})
