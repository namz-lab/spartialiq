/**
 * The general ledger's pure logic: the sort whitelists, which side of which statement a root type
 * belongs on, the statement grouping, the chart tree, the period generation, the line validator,
 * and the translation of a database refusal into an HTTP answer.
 *
 * NO DATABASE AND NO HTTP. These are the functions where a quiet mistake becomes a wrong figure in
 * a council's published accounts or an unchecked identifier in SQL, and they are tested on their
 * own, the same way src/lib/finance.js is in test/finance-primitives.test.js.
 *
 * The invariants that live in the DATABASE — a voucher that does not balance, two currencies in one
 * voucher, a posted line that cannot be amended — cannot be demonstrated without Postgres and are
 * proven by scripts/verify-ledger-invariants.js instead. Nothing here duplicates them, because a
 * JavaScript test asserting that JavaScript refuses an unbalanced voucher would prove the wrong
 * thing: the point of migration 203 is that the refusal does not depend on this code at all.
 */
const {
  SORT_COLUMNS, orderBy, naturalSide, statementSections, chartTree, periodsForYear,
  validateVoucherLines, ledgerRefusal, AGEING_BUCKETS, AGEING_LABELS,
  POSITION_ROOTS, PERFORMANCE_ROOTS, ROOT_TYPES, VOUCHER_TYPES,
  ISSUED_VOUCHER_PREFIXES, reservedNumberRefusal,
  SYSTEM_VOUCHER_TYPES, CREATABLE_VOUCHER_TYPES, systemTypeRefusal, LINE_REFERENCES,
  periodChangeRefusal, periodRefusals,
  COUNTER_GROUPS, counterGroupOf, counterGroupSql, CASH_STATEMENT_NOTE, UNCLOSED_SURPLUS_LABEL,
  longDate, incompleteSentences, closingReversalDateRefusal,
} = require('../src/routes/finance-ledger')
const { READINESS_CHECKS, assembleReadiness, outstandingOf } = require('../src/routes/finance-accounting')

describe('the sort whitelists', () => {
  test('every listing maps its keys to qualified columns, never to the key itself', () => {
    for (const [listing, columns] of Object.entries(SORT_COLUMNS)) {
      for (const [key, column] of Object.entries(columns)) {
        expect(column).toMatch(/^[a-z]+\.[a-z_]+$/)
        expect(`${listing}:${key}:${column}`).not.toMatch(/;|--|\s/)
      }
    }
  })

  test('maps a known key to its column and always breaks the tie', () => {
    expect(orderBy('vouchers', 'posting_date', 'desc', 'v.id')).toBe('v.posting_date DESC, v.id')
    expect(orderBy('accounts', 'code', 'asc', 'la.id')).toBe('la.code ASC, la.id')
    expect(orderBy('entries', 'account_code', 'asc', 'e.id')).toBe('la.code ASC, e.id')
    expect(orderBy('parties', 'reference', 'desc', 'p.id')).toBe('p.reference DESC, p.id')
  })

  test('an unknown sort key falls back to the listing\'s first column and is never interpolated', () => {
    expect(orderBy('vouchers', 'debit; DROP TABLE finance.ledger_entry', 'asc', 'v.id'))
      .toBe('v.posting_date ASC, v.id')
    expect(orderBy('accounts', undefined, undefined, 'la.id')).toBe('la.code ASC, la.id')
    // A column name from another listing is still not a key of this one.
    expect(orderBy('accounts', 'posting_date', 'asc', 'la.id')).toBe('la.code ASC, la.id')
  })

  test('the direction is one of two words, whatever arrives', () => {
    expect(orderBy('vouchers', 'voucher_no', 'desc', 'v.id')).toContain(' DESC,')
    expect(orderBy('vouchers', 'voucher_no', 'DESC', 'v.id')).toContain(' ASC,')
    expect(orderBy('vouchers', 'voucher_no', 'desc; --', 'v.id')).toContain(' ASC,')
  })

  test('an unknown listing throws rather than producing a clause', () => {
    expect(() => orderBy('ledger_entry', 'posting_date', 'asc', 'e.id')).toThrow(/not a known listing/)
  })

  test('nothing is sortable by an amount on the vouchers listing, where the amount is a subquery', () => {
    // A voucher's totals are computed per row by a correlated subquery, so sorting by one would
    // order by a column that does not exist in the FROM clause. Pinned so a later edit notices.
    expect(SORT_COLUMNS.vouchers).not.toHaveProperty('debit_total')
    expect(SORT_COLUMNS.vouchers).not.toHaveProperty('credit_total')
  })
})

describe('naturalSide', () => {
  test('assets and expenses are debit-natured; liabilities, equity and revenue are credit-natured', () => {
    expect(naturalSide('asset')).toBe('debit')
    expect(naturalSide('expense')).toBe('debit')
    expect(naturalSide('liability')).toBe('credit')
    expect(naturalSide('equity')).toBe('credit')
    expect(naturalSide('revenue')).toBe('credit')
  })

  test('covers every root type the schema allows, so no account can land without a side', () => {
    for (const root of ROOT_TYPES) {
      expect(['debit', 'credit']).toContain(naturalSide(root))
    }
  })

  test('refuses anything that is not a root type rather than guessing a side', () => {
    expect(() => naturalSide('income')).toThrow(/not a ledger root type/)
    expect(() => naturalSide(undefined)).toThrow(/not a ledger root type/)
  })

  test('the two statements between them cover the five roots exactly once', () => {
    expect([...POSITION_ROOTS, ...PERFORMANCE_ROOTS].sort()).toEqual([...ROOT_TYPES].sort())
    expect(POSITION_ROOTS.filter((r) => PERFORMANCE_ROOTS.includes(r))).toEqual([])
  })
})

describe('statementSections', () => {
  const rows = [
    { currency: 'USD', root_type: 'asset', account_code: '1000', balance: '8750.00' },
    { currency: 'USD', root_type: 'liability', account_code: '2000', balance: '1200.00' },
    { currency: 'USD', root_type: 'equity', account_code: '3000', balance: '7550.00' },
    { currency: 'ZWG', root_type: 'asset', account_code: '1000', balance: '4000000.00' },
    { currency: 'USD', root_type: 'revenue', account_code: '4000', balance: '500.00' },
  ]

  test('returns one book per currency, and never puts two currencies in one section', () => {
    const books = statementSections(rows, POSITION_ROOTS)
    expect(books.map((b) => b.currency)).toEqual(['USD', 'ZWG'])
    for (const book of books) {
      for (const section of book.sections) {
        for (const account of section.accounts) {
          expect(account.currency).toBe(book.currency)
        }
      }
    }
  })

  test('keeps only the roots of the statement asked for', () => {
    const position = statementSections(rows, POSITION_ROOTS)
    const usd = position.find((b) => b.currency === 'USD')
    expect(usd.sections.map((s) => s.root_type)).toEqual(['asset', 'liability', 'equity'])
    // The revenue row belongs on the other statement and is not smuggled in.
    const codes = usd.sections.flatMap((s) => s.accounts.map((a) => a.account_code))
    expect(codes).not.toContain('4000')

    const performance = statementSections(rows, PERFORMANCE_ROOTS)
    expect(performance.map((b) => b.currency)).toEqual(['USD'])
    expect(performance[0].sections.flatMap((s) => s.accounts.map((a) => a.account_code)))
      .toEqual(['4000'])
  })

  test('gives every section of the statement a heading, including the empty ones', () => {
    // A statement of financial position with no liabilities must still show the heading, because
    // "no liabilities" is a fact and a missing heading looks like an oversight.
    const books = statementSections(
      [{ currency: 'USD', root_type: 'asset', account_code: '1000', balance: '1.00' }],
      POSITION_ROOTS,
    )
    expect(books[0].sections.map((s) => s.root_type)).toEqual(['asset', 'liability', 'equity'])
    expect(books[0].sections.find((s) => s.root_type === 'liability').accounts).toEqual([])
  })

  test('carries the natural side onto each section, so a figure cannot be read on the wrong one', () => {
    const books = statementSections(rows, POSITION_ROOTS)
    const sides = Object.fromEntries(
      books[0].sections.map((s) => [s.root_type, s.natural_side]),
    )
    expect(sides).toEqual({ asset: 'debit', liability: 'credit', equity: 'credit' })
  })

  test('alters no amount: every figure comes out the decimal string it went in as', () => {
    // The function regroups and nothing else. If it ever starts computing a subtotal, this fails.
    const books = statementSections(rows, POSITION_ROOTS)
    const out = books.flatMap((b) => b.sections.flatMap((s) => s.accounts))
    for (const account of out) {
      const original = rows.find(
        (r) => r.currency === account.currency && r.account_code === account.account_code
          && r.root_type === account.root_type,
      )
      expect(account.balance).toBe(original.balance)
      expect(typeof account.balance).toBe('string')
    }
    // And no section carries a total of its own.
    for (const book of books) {
      expect(book).not.toHaveProperty('total')
      for (const section of book.sections) expect(section).not.toHaveProperty('subtotal')
    }
  })

  test('an empty set of rows yields no books rather than an empty USD book', () => {
    expect(statementSections([], POSITION_ROOTS)).toEqual([])
  })
})

describe('chartTree', () => {
  const flat = [
    { id: 'c', code: '1100', name: 'Receivable', parent_id: 'a' },
    { id: 'a', code: '1000', name: 'Assets', parent_id: null },
    { id: 'b', code: '1050', name: 'Bank', parent_id: 'a' },
    { id: 'd', code: '2000', name: 'Liabilities', parent_id: null },
  ]

  test('nests by parent and sorts each level by code', () => {
    const tree = chartTree(flat)
    expect(tree.map((n) => n.code)).toEqual(['1000', '2000'])
    expect(tree[0].children.map((n) => n.code)).toEqual(['1050', '1100'])
    expect(tree[1].children).toEqual([])
  })

  test('an account whose parent is outside the set becomes a root rather than disappearing', () => {
    // A filtered listing must still show every account it matched. An account silently absent from
    // a chart of accounts is the worst kind of missing.
    const tree = chartTree([{ id: 'x', code: '1100', name: 'Receivable', parent_id: 'not-here' }])
    expect(tree).toHaveLength(1)
    expect(tree[0].code).toBe('1100')
  })

  test('does not mutate the rows it was given', () => {
    const before = JSON.stringify(flat)
    chartTree(flat)
    expect(JSON.stringify(flat)).toBe(before)
  })

  test('an empty chart is an empty tree, not a crash', () => {
    expect(chartTree([])).toEqual([])
  })
})

describe('periodsForYear', () => {
  test('a July–June council gets period 1 = July, not January', () => {
    const periods = periodsForYear({ start: '2026-07-01', end: '2027-06-30', periodicity: 'monthly' })
    expect(periods).toHaveLength(12)
    expect(periods[0]).toMatchObject({ period_no: 1, from_date: '2026-07-01', to_date: '2026-07-31' })
    expect(periods[0].label).toMatch(/Jul 2026/)
    expect(periods[11]).toMatchObject({ period_no: 12, from_date: '2027-06-01', to_date: '2027-06-30' })
  })

  test('the quarters of a July–June year are Jul-Sep first, not Jan-Mar', () => {
    const periods = periodsForYear({ start: '2026-07-01', end: '2027-06-30', periodicity: 'quarterly' })
    expect(periods).toHaveLength(4)
    expect(periods[0]).toMatchObject({ period_no: 1, from_date: '2026-07-01', to_date: '2026-09-30' })
    expect(periods[3].to_date).toBe('2027-06-30')
  })

  test('the periods tile the year exactly: no gap, no overlap, last one clipped to the year end', () => {
    for (const periodicity of ['monthly', 'quarterly', 'half_yearly', 'yearly']) {
      const periods = periodsForYear({ start: '2026-07-01', end: '2027-06-30', periodicity })
      expect(periods[0].from_date).toBe('2026-07-01')
      expect(periods[periods.length - 1].to_date).toBe('2027-06-30')
      for (let i = 1; i < periods.length; i += 1) {
        const previousEnd = new Date(`${periods[i - 1].to_date}T00:00:00Z`)
        const thisStart = new Date(`${periods[i].from_date}T00:00:00Z`)
        // Exactly one day apart: a posting on a boundary belongs to exactly one period.
        expect(thisStart - previousEnd).toBe(24 * 60 * 60 * 1000)
      }
    }
  })

  test('period_no is the ordinal, so it is usable as the schema\'s period_no directly', () => {
    const periods = periodsForYear({ start: '2026-01-01', end: '2026-12-31', periodicity: 'monthly' })
    expect(periods.map((p) => p.period_no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    // And within the CHECK constraint `period_no BETWEEN 1 AND 13`.
    for (const p of periods) expect(p.period_no).toBeLessThanOrEqual(13)
  })

  test('a monthly year never needs more than 13 periods, which is what the constraint allows', () => {
    const periods = periodsForYear({ start: '2026-07-01', end: '2027-06-30', periodicity: 'monthly' })
    expect(periods.length).toBeLessThanOrEqual(13)
  })
})

describe('validateVoucherLines', () => {
  const line = (over) => ({ ledger_account_id: 'acct-1', ...over })

  test('accepts a two-sided entry and normalises both amounts to decimal strings', () => {
    const r = validateVoucherLines([
      line({ debit: '1 250,50' }), line({ ledger_account_id: 'acct-2', credit: '1250.50' }),
    ])
    expect(r.ok).toBe(true)
    expect(r.lines[0]).toMatchObject({ debit: '1250.50', credit: '0.00' })
    expect(r.lines[1]).toMatchObject({ debit: '0.00', credit: '1250.50' })
    expect(typeof r.lines[0].debit).toBe('string')
  })

  test('refuses a single-line voucher: a double entry has two sides', () => {
    const r = validateVoucherLines([line({ debit: '10.00' })])
    expect(r).toMatchObject({ ok: false, error: 'single_line' })
    expect(r.message).toMatch(/at least two lines/)
  })

  test('refuses no lines at all', () => {
    expect(validateVoucherLines([])).toMatchObject({ ok: false, error: 'no_lines' })
    expect(validateVoucherLines(undefined)).toMatchObject({ ok: false, error: 'no_lines' })
    expect(validateVoucherLines(null)).toMatchObject({ ok: false, error: 'no_lines' })
  })

  test('refuses a line carrying both a debit and a credit, and one carrying neither', () => {
    const both = validateVoucherLines([
      line({ debit: '5.00', credit: '5.00' }), line({ ledger_account_id: 'acct-2', credit: '5.00' }),
    ])
    expect(both).toMatchObject({ ok: false, error: 'line_needs_one_side' })
    expect(both.message).toMatch(/Line 1/)
    expect(both.message).toMatch(/does not use signed amounts/)

    const neither = validateVoucherLines([
      line({}), line({ ledger_account_id: 'acct-2', credit: '5.00' }),
    ])
    expect(neither).toMatchObject({ ok: false, error: 'line_needs_one_side' })
  })

  test('refuses a negative amount, because the other side of the entry is not a minus sign', () => {
    const r = validateVoucherLines([
      line({ debit: '-10.00' }), line({ ledger_account_id: 'acct-2', credit: '10.00' }),
    ])
    expect(r).toMatchObject({ ok: false, error: 'line_amount_not_positive' })
    expect(r.message).toMatch(/not a minus sign/)
  })

  test('refuses a nil line: a posting of nothing is not a posting', () => {
    expect(validateVoucherLines([
      line({ debit: '0.00' }), line({ ledger_account_id: 'acct-2', credit: '0.00' }),
    ])).toMatchObject({ ok: false, error: 'line_amount_not_positive' })
  })

  test('refuses an amount it cannot read rather than coercing it to a number', () => {
    const r = validateVoucherLines([
      line({ debit: 'n/a' }), line({ ledger_account_id: 'acct-2', credit: '10.00' }),
    ])
    expect(r).toMatchObject({ ok: false, error: 'line_amount_unreadable' })
    expect(r.message).toMatch(/Line 1/)
  })

  test('refuses a line that cites no ledger account', () => {
    expect(validateVoucherLines([
      { debit: '10.00' }, line({ ledger_account_id: 'acct-2', credit: '10.00' }),
    ])).toMatchObject({ ok: false, error: 'line_without_account' })
  })

  test('does NOT check the balance: that is money arithmetic and belongs in SQL', () => {
    // Debits 100, credits 60. Accepted here on purpose — the database refuses it at posting, over
    // NUMERIC, and duplicating the check in JavaScript would invite the two to disagree.
    const r = validateVoucherLines([
      line({ debit: '100.00' }), line({ ledger_account_id: 'acct-2', credit: '60.00' }),
    ])
    expect(r.ok).toBe(true)
    expect(r.lines).toHaveLength(2)
  })

  test('carries every analysis dimension through, and nulls the ones not given', () => {
    const r = validateVoucherLines([
      line({ debit: '10.00', party_id: 'p1', department_id: 'd1', ward_code: ' ZW170402 ', narration: 'x' }),
      line({ ledger_account_id: 'acct-2', credit: '10.00' }),
    ])
    expect(r.lines[0]).toMatchObject({
      party_id: 'p1', department_id: 'd1', ward_code: 'ZW170402', narration: 'x',
    })
    expect(r.lines[1]).toMatchObject({
      party_id: null, department_id: null, programme_id: null, activity_id: null,
      ward_code: null, project_id: null, budget_line_id: null, against_voucher_id: null,
      narration: null,
    })
  })

  test('trims a ward code but does not change its case, as the rest of this schema does not', () => {
    // `normaliseCode` (src/lib/finance.js:136) trims and strips whitespace and deliberately leaves
    // the case alone, which is what finance-projects.js:289 does with a ward code too. Worth
    // pinning, because the ward register's codes are upper case ('ZW170402') and a lower-case code
    // would be an `unlinked` ward the choropleth cannot shade (audit GAP-10). The ward picker
    // supplies the register's own spelling; this function does not invent one.
    const r = validateVoucherLines([
      line({ debit: '10.00', ward_code: ' zw170402 ' }),
      line({ ledger_account_id: 'acct-2', credit: '10.00' }),
    ])
    expect(r.lines[0].ward_code).toBe('zw170402')
  })

  test('preserves a figure that a JavaScript number would lose', () => {
    const big = '99999999999999.99'
    const r = validateVoucherLines([
      line({ debit: big }), line({ ledger_account_id: 'acct-2', credit: big }),
    ])
    expect(r.lines[0].debit).toBe(big)
    expect(String(Number(big))).not.toBe(big)
  })
})

describe('ledgerRefusal', () => {
  test('separation of duties, from the constraint name or from the function\'s message', () => {
    expect(ledgerRefusal({ constraint: 'voucher_prepared_and_posted_differ', message: 'x' }))
      .toMatchObject({ status: 409, error: 'separation_of_duties' })
    expect(ledgerRefusal({ message: 'voucher V1 was prepared by this person and must be posted by somebody else' }))
      .toMatchObject({ status: 409, error: 'separation_of_duties' })
  })

  test('an unbalanced voucher keeps the database\'s own figures in the message', () => {
    const r = ledgerRefusal({
      message: 'voucher V1 does not balance: debits 100.00, credits 60.00, difference 40.00',
    })
    expect(r).toMatchObject({ status: 409, error: 'voucher_does_not_balance' })
    // The figures are passed through, not replaced with something vaguer.
    expect(r.message).toContain('debits 100.00, credits 60.00, difference 40.00')
  })

  test('a currency collision is its own error, whichever way it was hit', () => {
    for (const message of [
      'voucher X posts in more than one currency (USD and ZWG)',
      'entry currency ZWG does not match voucher V1\'s currency USD',
      'a USD entry cannot settle voucher V2, which is denominated in ZWG',
    ]) {
      expect(ledgerRefusal({ message })).toMatchObject({ status: 409, error: 'currency_mismatch' })
    }
  })

  test('a closed period, an immutable ledger and a heading each map to their own answer', () => {
    expect(ledgerRefusal({ message: 'accounting period 2 is closed and accepts no postings' }))
      .toMatchObject({ status: 409, error: 'period_not_open' })
    expect(ledgerRefusal({ message: 'posting date 2026-08-10 falls outside period 1 (2026-07-01 to 2026-07-31)' }))
      .toMatchObject({ status: 409, error: 'period_not_open' })
    expect(ledgerRefusal({ message: 'finance.ledger_entry is insert-only: a posted ledger line is never amended' }))
      .toMatchObject({ status: 409, error: 'ledger_is_immutable' })
    expect(ledgerRefusal({ message: 'ledger account 1000 is a heading and cannot be posted to' }))
      .toMatchObject({ status: 400, error: 'account_not_postable' })
  })

  test('a repeat act says so rather than failing twice over', () => {
    expect(ledgerRefusal({ message: 'voucher V1 has already been reversed' }))
      .toMatchObject({ status: 409, error: 'already_done' })
    expect(ledgerRefusal({ message: 'voucher V1 is already posted and cannot be posted again' }))
      .toMatchObject({ status: 409, error: 'already_done' })
    expect(ledgerRefusal({ message: 'the USD book of 2026/27 has already been closed' }))
      .toMatchObject({ status: 409, error: 'already_done' })
  })

  test('a line with two sides, caught by the CHECK constraint, is a 400 and says what is wrong', () => {
    const r = ledgerRefusal({
      constraint: 'voucher_line_one_side_only',
      message: 'new row for relation "voucher_line" violates check constraint "voucher_line_one_side_only"',
    })
    expect(r).toMatchObject({ status: 400, error: 'line_needs_one_side' })
    // The officer is told the rule, not the constraint name.
    expect(r.message).not.toMatch(/voucher_line_one_side_only/)
    expect(r.message).toMatch(/either a debit or a credit/)
  })

  test('a duplicate key becomes a 409 about the voucher number', () => {
    expect(ledgerRefusal({ code: '23505', message: 'duplicate key value violates unique constraint' }))
      .toMatchObject({ status: 409, error: 'duplicate' })
  })

  test('returns null for anything it does not recognise, so a real fault is not dressed up as a 409', () => {
    expect(ledgerRefusal({ message: 'connection terminated unexpectedly' })).toBeNull()
    expect(ledgerRefusal({})).toBeNull()
    expect(ledgerRefusal(null)).toBeNull()
    expect(ledgerRefusal(undefined)).toBeNull()
  })

  test('never maps a refusal to a 200 or a 500', () => {
    const messages = [
      'voucher V1 does not balance: debits 1, credits 2, difference -1',
      'accounting period 2 is closed and accepts no postings',
      'finance.ledger_entry is insert-only',
      'voucher X posts in more than one currency (USD and ZWG)',
      'voucher V1 has already been reversed',
      'two accounting periods overlaps period 1',
      'voucher V1 is posted and its lines can no longer be changed',
    ]
    for (const message of messages) {
      const r = ledgerRefusal({ message })
      expect(r).not.toBeNull()
      expect(r.status).toBeGreaterThanOrEqual(400)
      expect(r.status).toBeLessThan(500)
    }
  })
})

describe('the ageing buckets', () => {
  test('every bucket has a label, so none is shown to an officer as a raw key', () => {
    for (const bucket of AGEING_BUCKETS) {
      expect(typeof AGEING_LABELS[bucket]).toBe('string')
      expect(AGEING_LABELS[bucket].length).toBeGreaterThan(3)
    }
    expect(Object.keys(AGEING_LABELS).sort()).toEqual([...AGEING_BUCKETS].sort())
  })

  test('`unallocated` is one of them, and is not an age', () => {
    // A receipt not yet matched to a bill is money received. Dropping it would make a party's
    // ageing total disagree with its control-account balance, silently.
    expect(AGEING_BUCKETS).toContain('unallocated')
    expect(AGEING_LABELS.unallocated).toMatch(/not yet matched/i)
  })

  test('the age buckets are in ascending order of age, with the two non-ages last', () => {
    expect(AGEING_BUCKETS.slice(0, 6))
      .toEqual(['current', '31_60', '61_90', '91_180', '181_365', 'over_365'])
    expect(AGEING_BUCKETS.slice(6)).toEqual(['settled', 'unallocated'])
  })
})

describe('the voucher types', () => {
  test('are the thirteen the schema allows (migrations 213 and 243)', () => {
    expect([...VOUCHER_TYPES].sort()).toEqual([
      'asset_disposal', 'closing', 'credit_note', 'depreciation', 'journal', 'opening', 'payment',
      'payroll', 'rates_bill', 'receipt', 'reversal', 'supplier_invoice', 'write_off',
    ])
  })

  test('a reversal is not among the types a caller may create by hand', () => {
    // A reversal's lines must mirror an original exactly. One written by hand that did not would be
    // a correction nobody could follow, so it is raised only by POST /vouchers/:id/reverse.
    const creatable = VOUCHER_TYPES.filter((t) => t !== 'reversal')
    expect(creatable).not.toContain('reversal')
    expect(creatable).toHaveLength(12)
  })
})

// A typed number in the shape of an issued one would take that number before its series reached
// it. When the series did reach it, the insert would hit uq_voucher_no, the transaction would roll
// the counter back, and every later attempt would draw the same number again: the series would be
// jammed for good. So a typed voucher number may never look like one the ledger issues itself.
describe('numbers the ledger issues itself (migrations 242 and 243)', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  // The LAST definition wins in the database: 243 redefines the function with the salaries
  // journal's SJ added, so both files are read and the final one is the function under test.
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8')
  const sql = `${read('242_finance_ledger_reporting.sql')}\n${read('243_finance_payroll_journal.sql')}`
  const body = sql.slice(sql.lastIndexOf('CREATE OR REPLACE FUNCTION finance.next_document_no'))
  const fn = body.slice(0, body.indexOf('END $$;'))

  test('the prefixes are those of finance.next_document_no whose numbers land on a voucher', () => {
    const prefixes = [...fn.matchAll(/WHEN '([a-z_]+)' THEN '([A-Z]{2})'/g)].map((m) => [m[1], m[2]])
    expect(prefixes).toHaveLength(14)
    // A cashier session (CS) and an asset (FA) are numbered from a series too, but their numbers
    // are never a voucher's, so they cannot collide on uq_voucher_no.
    const onVouchers = prefixes.filter(([kind]) => !['cashier_session', 'asset'].includes(kind)).map(([, p]) => p)
    expect([...ISSUED_VOUCHER_PREFIXES].sort()).toEqual(onVouchers.sort())
    expect([...ISSUED_VOUCHER_PREFIXES].sort()).toEqual(
      ['AD', 'BD', 'CN', 'DP', 'JV', 'OB', 'PV', 'RC', 'SI', 'SJ', 'WO', 'YC'])
    // Seven digits, as the function pads them.
    expect(fn).toContain("lpad(v_no::text, 7, '0')")
  })

  test.each([
    'JV-0000012', 'jv-0000012', ' JV-0000012 ', 'CN-0000001', 'WO-0000001', 'OB-0000003',
    'YC-0000001', 'RC-0000011', 'BD-0000002', 'SI-0000004', 'PV-0000005', 'DP-0000006', 'AD-0000007',
    'SJ-0000001',
  ])('%p is refused', (typed) => {
    const refusal = reservedNumberRefusal(typed)
    expect(refusal).toEqual({
      status: 400, error: 'number_reserved',
      message: `${typed.trim().toUpperCase()} is in the form of a number the ledger issues from its own `
        + 'series, and typing it would block that series when it reaches the same number. Type the '
        + 'number of the document instead.',
    })
  })

  test('where a number can be left blank, the refusal says so', () => {
    expect(reservedNumberRefusal('JV-0000012', { blankIssues: true }).message).toBe(
      'JV-0000012 is in the form of a number the ledger issues from its own series, and typing it '
      + 'would block that series when it reaches the same number. Leave the number blank to have one '
      + 'issued, or type the number of the document.')
  })

  test.each([
    'JV-000012', 'JV-00000123', 'JV-0000012-R', 'CS-0000001', 'FA-0000001', 'GL-JV-001',
    'AC1A2B3C-TYPED', 'JV0000012', 'XJV-0000012', '', undefined, null,
  ])('%p is allowed', (typed) => {
    expect(reservedNumberRefusal(typed)).toBeNull()
  })
})

describe('B-SOD: what a person may type, and the refusals the database adds (migration 242)', () => {
  test('only a journal, an opening, a credit note and a write-off may be raised by hand', () => {
    expect([...CREATABLE_VOUCHER_TYPES].sort()).toEqual(['credit_note', 'journal', 'opening', 'write_off'])
    // Every type is either creatable or named as a system type, never neither.
    expect([...CREATABLE_VOUCHER_TYPES, ...Object.keys(SYSTEM_VOUCHER_TYPES)].sort()).toEqual([...VOUCHER_TYPES].sort())
  })

  test.each([
    ['closing', 'A year-end closing voucher is raised by the year-end close under Period Close; it cannot be typed.'],
    ['receipt', 'A receipt is raised by the cash office, or by Rates, when the money is received; it cannot be typed.'],
    ['rates_bill', 'A rates bill is raised by a billing run under Rates; it cannot be typed.'],
    ['reversal', 'A reversal is raised by reversing a posted voucher; it cannot be typed.'],
    ['supplier_invoice', 'A supplier invoice voucher is raised by Creditors when the invoice is captured; it cannot be typed.'],
    ['payment', 'A payment voucher is raised by Creditors when the payment is prepared; it cannot be typed.'],
    ['depreciation', 'A depreciation voucher is raised by a depreciation run in the Asset Register; it cannot be typed.'],
    ['asset_disposal', 'An asset disposal voucher is raised by a disposal in the Asset Register; it cannot be typed.'],
    ['payroll', "A salaries journal is raised by the salaries journal screen, from the month's totals; it cannot be typed."],
  ])('a hand-made %s is refused with a sentence saying where it is raised', (type, message) => {
    expect(systemTypeRefusal(type)).toEqual({ status: 400, error: 'system_type', message })
  })

  test.each(['journal', 'opening', 'credit_note', 'write_off'])('%s is not refused', (type) => {
    expect(systemTypeRefusal(type)).toBeNull()
  })

  test('every line reference names a finance table from a fixed list, never the request', () => {
    expect(LINE_REFERENCES.map(([column]) => column)).toEqual([
      'ledger_account_id', 'party_id', 'against_voucher_id', 'department_id', 'programme_id',
      'activity_id', 'project_id', 'budget_line_id'])
    for (const [, table] of LINE_REFERENCES) expect(table).toMatch(/^finance\.[a-z_]+$/)
  })

  test('a row of another council is refused as a foreign reference, with the database sentence', () => {
    expect(ledgerRefusal({ message: "line 2 names a party that is not in this council's records" })).toEqual({
      status: 400, error: 'foreign_reference', message: "Line 2 names a party that is not in this council's records.",
    })
    expect(ledgerRefusal({ message: "voucher JV-1 names a financial year that is not in this council's records" }).error)
      .toBe('foreign_reference')
  })

  test('a hand-inserted closing voucher, and a second live reversal, are translated', () => {
    expect(ledgerRefusal({ message: 'a year-end closing voucher is raised only by the year-end close' })).toMatchObject({
      status: 400, error: 'system_type',
    })
    expect(ledgerRefusal({ message: 'voucher JV-0000003 already has a reversal, JV-0000003-R, waiting to be posted' })).toEqual({
      status: 409, error: 'reversal_pending',
      message: 'Voucher JV-0000003 already has a reversal, JV-0000003-R, waiting to be posted. Have it posted '
        + 'from the To post queue, or discard it and raise the reversal again.',
    })
    expect(ledgerRefusal({ code: '23505', constraint: 'uq_voucher_one_live_reversal', message: 'duplicate key' }).error)
      .toBe('reversal_pending')
    // An ordinary duplicate number is still a duplicate.
    expect(ledgerRefusal({ code: '23505', constraint: 'uq_voucher_no', message: 'duplicate key' }).error).toBe('duplicate')
  })
})

describe('B11: period changes, the year-end close and the readiness checks', () => {
  const period = (status, no = 12) => ({ period_no: no, status })
  const refuse = (args) => periodChangeRefusal({ yearLabel: 'FY 1992', ...args })

  test('a locked period is final, whatever is asked', () => {
    for (const next of ['open', 'closed', 'locked']) {
      expect(refuse({ period: period('locked', 4), next })).toEqual({
        status: 409, error: 'period_locked',
        message: 'Period 4 is locked, which is final. A locked period is what a council sets after the '
          + 'audit; an adjustment after it belongs in a later period.',
      })
    }
  })

  test('asking for the status a period already has changes nothing and says so', () => {
    expect(refuse({ period: period('open', 3), next: 'open' })).toEqual({ status: 409, error: 'no_change', message: 'Period 3 is already open.' })
    expect(refuse({ period: period('closed', 3), next: 'closed' })).toEqual({ status: 409, error: 'no_change', message: 'Period 3 is already closed.' })
  })

  test('a period is locked only from closed (S11a)', () => {
    expect(refuse({ period: period('open', 4), next: 'locked' })).toEqual({
      status: 409, error: 'lock_needs_close',
      message: 'Period 4 is open. Close it first: a period is locked only once it is closed, so what was '
        + 'outstanding when it closed is on the record.',
    })
    expect(refuse({ period: period('closed', 4), next: 'locked' })).toBeNull()
  })

  test('the final period is not locked while a book has revenue or expenditure to close (S11c, M1)', () => {
    expect(refuse({ period: period('closed'), next: 'locked', isFinal: true, unclosedBooks: ['USD'] })).toEqual({
      status: 409, error: 'year_not_closed',
      message: 'Period 12 is the last of FY 1992, and the USD book still has revenue or expenditure to close. '
        + 'Close the year first: once the last period is locked, no closing can be posted into it.',
    })
    expect(refuse({ period: period('closed'), next: 'locked', isFinal: true, unclosedBooks: ['USD', 'ZWG'] }).message)
      .toMatch(/^Period 12 is the last of FY 1992, and the USD and ZWG books still have revenue or expenditure to close\./)
    // Every book closed, or a period that is not the last: the lock is allowed.
    expect(refuse({ period: period('closed'), next: 'locked', isFinal: true, unclosedBooks: [] })).toBeNull()
    expect(refuse({ period: period('closed', 11), next: 'locked', isFinal: false, unclosedBooks: ['USD'] })).toBeNull()
  })

  test('the last period is not locked while a reversal of its closing waits (review M8)', () => {
    expect(refuse({ period: period('closed'), next: 'locked', isFinal: true, closingReversalPending: true })).toEqual({
      status: 409, error: 'closing_reversal_pending',
      message: 'Period 12 is the last of FY 1992, and a reversal of its year-end closing is waiting to be posted. '
        + 'Have it posted, or discard it, first: once the last period is locked it could never be posted.',
    })
    // Another period may be locked meanwhile; the reversal posts into the last one only.
    expect(refuse({ period: period('closed', 11), next: 'locked', isFinal: false, closingReversalPending: true })).toBeNull()
  })

  test('a remainder after a closing is worded as a remainder, not as closed (frontend review ask 3)', () => {
    expect(refuse({ period: period('closed', 5), next: 'open', unclosedBooks: ['USD'],
      standingClosings: [{ currency: 'USD', voucher_no: 'YC-0000003' }] }).message)
      .toBe('A remainder is left in the USD book of FY 1992 after YC-0000003. Reverse the year-end closing first.')
  })

  test('the periods list sends what a lock and a reopen would be told, from the same rule', () => {
    const facts = { yearLabel: 'FY 1992', unclosedBooks: ['USD'], standingClosings: [], closingReversalPending: false }
    expect(periodRefusals({ ...facts, period: period('closed'), isFinal: true })).toEqual({
      lock_refusal: { error: 'year_not_closed', message: refuse({ ...facts, period: period('closed'), next: 'locked', isFinal: true }).message },
      reopen_refusal: null,
    })
    expect(periodRefusals({ ...facts, period: period('open', 3), isFinal: false })).toEqual({
      lock_refusal: { error: 'lock_needs_close', message: expect.stringMatching(/^Period 3 is open\. Close it first/) },
      reopen_refusal: { error: 'no_change', message: 'Period 3 is already open.' },
    })
    expect(periodRefusals({ ...facts, period: period('locked', 4), isFinal: false })).toMatchObject({
      lock_refusal: { error: 'period_locked' }, reopen_refusal: { error: 'period_locked' },
    })
    expect(periodRefusals({ ...facts, unclosedBooks: [], period: period('closed'), isFinal: true })).toEqual({
      lock_refusal: null, reopen_refusal: null,
    })
  })

  test('no period of a closed year is reopened until the closing is reversed (the ruling)', () => {
    expect(refuse({ period: period('closed', 5), next: 'open', standingClosings: [{ currency: 'USD', voucher_no: 'YC-0000003' }] })).toEqual({
      status: 409, error: 'year_closed',
      message: 'The USD book of FY 1992 is closed by YC-0000003. Reverse the year-end closing first.',
    })
    expect(refuse({ period: period('closed', 5), next: 'open', standingClosings: [
      { currency: 'USD', voucher_no: 'YC-0000003' }, { currency: 'USD', voucher_no: 'YC-0000004' },
      { currency: 'ZWG', voucher_no: 'YC-0000005' }] }).message).toBe(
      'The USD book of FY 1992 is closed by YC-0000003 and YC-0000004. The ZWG book of FY 1992 is closed by '
      + 'YC-0000005. Reverse the year-end closing first.')
    expect(refuse({ period: period('closed', 5), next: 'open', standingClosings: [] })).toBeNull()
    expect(refuse({ period: period('open', 5), next: 'closed' })).toBeNull()
  })

  test('the year-end close\'s refusals are translated, each with its own key', () => {
    expect(ledgerRefusal({ message: 'a year-end closing is dated the last day of the year, 1992-12-31, not 1992-06-30' })).toEqual({
      status: 400, error: 'bad_date', message: 'A year-end closing is dated the last day of the year, 1992-12-31, not 1992-06-30.',
    })
    expect(ledgerRefusal({ message: 'every period of FY 1992 must be closed before its year end; still open: 3, 11' })).toEqual({
      status: 409, error: 'periods_open', message: 'Every period of FY 1992 must be closed before its year end; still open: 3, 11.',
    })
    expect(ledgerRefusal({ message: 'period 12 of FY 1992 is locked, so no year-end closing can be posted into it' })).toEqual({
      status: 409, error: 'final_period_locked',
      message: 'Period 12 of FY 1992 is locked, so no year-end closing can be posted into it. A locked period is '
        + 'final: correct this book in the next year.',
    })
    expect(ledgerRefusal({ message: 'the USD book of FY 1992 already has a closing, YC-0000004, waiting to be posted' })).toEqual({
      status: 409, error: 'closing_pending',
      message: 'The USD book of FY 1992 already has a closing, YC-0000004, waiting to be posted. Have it posted '
        + 'from the To post queue, or discard it and raise the close again.',
    })
    expect(ledgerRefusal({ message: 'the USD book of FY 1992 has no revenue or expense balance to close' })).toEqual({
      status: 409, error: 'nothing_to_close', message: 'The USD book of FY 1992 has no revenue or expense balance to close.',
    })
    expect(ledgerRefusal({ message: 'no postable accumulated-surplus account exists in the chart' }).error).toBe('no_surplus_account')
    // A closed or locked period refusing an ordinary posting is still period_not_open.
    expect(ledgerRefusal({ message: 'accounting period 12 is locked and accepts no postings' }).error).toBe('period_not_open')
    // The legacy one-call close's refusal is unchanged.
    expect(ledgerRefusal({ message: 'the USD book of FY 1991 has already been closed' }).error).toBe('already_done')
  })

  const none = { draft_vouchers: 0, cashups_unverified: 0, deposits_unposted: 0, payables_awaiting: 0, bank_statements_open: 0 }
  const facts = (over = {}) => ({
    counts: none, depreciation: [], unreconciled: [], debtors: [], creditors: [],
    books: [{ currency: 'USD', balances: true, difference: '0.00' }], ...over,
  })
  const P = { id: 'p', period_no: 3, label: 'March', from_date: '1992-03-01', to_date: '1992-03-31', status: 'open' }

  test('the checks come in the brief\'s order, then the two control reconciliations; depreciation only with an asset in use', () => {
    expect(READINESS_CHECKS.map((c) => c.key)).toEqual([
      'draft_vouchers', 'cashups_unverified', 'deposits_unposted', 'payables_awaiting', 'depreciation_not_run',
      'bank_statements_open', 'bank_not_reconciled', 'debtors_control', 'creditors_control'])
    expect(READINESS_CHECKS.map((c) => c.target)).toEqual([
      'acc-journals', 'acc-cashups', 'acc-banking', 'acc-payable', 'acc-assets', 'acc-bank', 'acc-bank',
      'acc-receivable', 'acc-payable'])
    const clear = assembleReadiness(P, facts())
    expect(clear.checks.map((c) => c.key)).not.toContain('depreciation_not_run')
    expect(clear.checks).toHaveLength(8)
    expect(clear.checks.every((c) => c.ok && c.count === 0 && c.detail === null)).toBe(true)
    expect(clear).toMatchObject({ period: P, ready: true })
    const withAsset = assembleReadiness(P, facts({ depreciation: [{ currency: 'USD', run: true }] }))
    expect(withAsset.checks.map((c) => c.key)[4]).toBe('depreciation_not_run')
    expect(withAsset.checks[4]).toMatchObject({ count: 0, ok: true })
  })

  test('each count comes from the data, and anything outstanding makes the period not ready', () => {
    const r = assembleReadiness(P, facts({
      counts: { ...none, draft_vouchers: 1, cashups_unverified: 2 },
      depreciation: [{ currency: 'USD', run: false }, { currency: 'ZWG', run: true }],
      unreconciled: [{ code: '1100', currency: 'USD', entries: 3 }],
      debtors: [{ currency: 'USD', difference: '10.00' }],
      creditors: [{ currency: 'ZWG', difference: '-4.50' }],
      asAt: '2026-11-17',
    }))
    const byKey = Object.fromEntries(r.checks.map((c) => [c.key, c]))
    expect(byKey.draft_vouchers).toEqual({
      key: 'draft_vouchers', label: 'Draft vouchers dated in the period', count: 1, ok: false,
      detail: '1 draft is dated in the period and not posted.', target: 'acc-journals',
    })
    expect(byKey.cashups_unverified).toMatchObject({ count: 2, ok: false, detail: '2 cash-ups of the period are open or awaiting verification.' })
    expect(byKey.depreciation_not_run).toMatchObject({ count: 1, ok: false, detail: 'Not run in USD.' })
    expect(byKey.bank_not_reconciled).toMatchObject({ count: 1, ok: false, detail: '1100 (USD): 3 entries' })
    expect(byKey.debtors_control).toMatchObject({
      count: 1, ok: false, detail: 'USD: the ageing less the control is 10.00',
      label: 'Debtors ageing differs from the receivable control account (whole book, as at today)',
    })
    expect(byKey.creditors_control).toMatchObject({ count: 1, ok: false, detail: 'ZWG: the open items less the control is -4.50' })
    expect(byKey.deposits_unposted).toMatchObject({ count: 0, ok: true, detail: null })
    expect(r.ready).toBe(false)
    expect(outstandingOf(r)).toEqual([
      { key: 'draft_vouchers', count: 1 }, { key: 'cashups_unverified', count: 2 },
      { key: 'depreciation_not_run', count: 1 }, { key: 'bank_not_reconciled', count: 1 },
      // The two whole-book reconciliations say so, with the day they were read (review M1).
      { key: 'debtors_control', count: 1, scope: 'whole_book', as_at: '2026-11-17' },
      { key: 'creditors_control', count: 1, scope: 'whole_book', as_at: '2026-11-17' }])
    expect(r.as_at).toBe('2026-11-17')
  })

  test('a book out of balance alone makes the period not ready, and every check can still be clear', () => {
    const r = assembleReadiness(P, facts({ books: [{ currency: 'USD', balances: false, difference: '0.01' }] }))
    expect(r.checks.every((c) => c.ok)).toBe(true)
    expect(r.ready).toBe(false)
    expect(outstandingOf(r)).toEqual([])
  })
})

describe('B12: the statements (accounting audit M7, S13, S14)', () => {
  test('a date is written out in words, with no time zone involved', () => {
    expect(longDate('1993-12-31')).toBe('31 December 1993')
    expect(longDate('1992-01-05')).toBe('5 January 1992')
    expect(longDate('2026-02-28')).toBe('28 February 2026')
    expect(() => longDate('31/12/1993')).toThrow(/not an ISO date/)
  })

  test('the earlier-years row carries the label the statement prints', () => {
    expect(UNCLOSED_SURPLUS_LABEL).toBe('Surplus or deficit of earlier years not yet closed')
  })

  test('a position row with no account is grouped under equity, after the accounts, and passes through untouched', () => {
    const rows = [
      { currency: 'USD', ledger_account_id: 'a', account_code: '3000', account_name: 'Accumulated surplus', root_type: 'equity', balance: '1500.00' },
      { currency: 'USD', ledger_account_id: null, account_code: null, account_name: UNCLOSED_SURPLUS_LABEL, root_type: 'equity', balance: '-104.00' },
    ]
    const [book] = statementSections(rows, POSITION_ROOTS)
    const equity = book.sections.find((s) => s.root_type === 'equity')
    expect(equity.accounts.map((a) => a.ledger_account_id)).toEqual(['a', null])
    expect(equity.accounts[1]).toBe(rows[1])
  })

  describe('the counter-side groups of the cash statement', () => {
    test('revenue and expense by root; then the control and asset types; then what is left by root', () => {
      expect(counterGroupOf('revenue', null)).toBe('revenue')
      expect(counterGroupOf('revenue', 'tax')).toBe('revenue')
      expect(counterGroupOf('expense', 'other')).toBe('expense')
      expect(counterGroupOf('asset', 'receivable')).toBe('receivable')
      expect(counterGroupOf('liability', 'payable')).toBe('payable')
      expect(counterGroupOf('liability', 'tax')).toBe('tax')
      expect(counterGroupOf('asset', 'tax')).toBe('tax')
      expect(counterGroupOf('asset', 'fixed_asset')).toBe('fixed_asset')
      expect(counterGroupOf('asset', 'inventory')).toBe('other_asset')
      expect(counterGroupOf('asset', null)).toBe('other_asset')
      expect(counterGroupOf('liability', 'provision')).toBe('liability')
      expect(counterGroupOf('equity', 'accumulated_surplus')).toBe('equity')
    })

    test('there is no cash group: a bank or cash account is never a counter-side', () => {
      expect(COUNTER_GROUPS.map((g) => g.group)).toEqual(
        ['revenue', 'expense', 'receivable', 'payable', 'tax', 'fixed_asset', 'other_asset', 'liability', 'equity'])
      expect(() => counterGroupOf('asset', 'bank')).toThrow(/cash/)
      expect(() => counterGroupOf('asset', 'cash')).toThrow(/cash/)
      for (const g of COUNTER_GROUPS) expect(g.label).toMatch(/^[A-Z][a-z ,()]+$/)
    })

    test('the SQL CASE is built from the same table, and nothing in it comes from a request', () => {
      const sql = counterGroupSql('la')
      expect(sql).toBe("CASE WHEN la.root_type = 'revenue' THEN 'revenue' "
        + "WHEN la.root_type = 'expense' THEN 'expense' "
        + "WHEN la.account_type = 'receivable' THEN 'receivable' "
        + "WHEN la.account_type = 'payable' THEN 'payable' "
        + "WHEN la.account_type = 'tax' THEN 'tax' "
        + "WHEN la.account_type = 'fixed_asset' THEN 'fixed_asset' "
        + "WHEN la.root_type = 'asset' THEN 'other_asset' "
        + "WHEN la.root_type = 'liability' THEN 'liability' "
        + "ELSE 'equity' END")
      expect(() => counterGroupSql('la; DROP')).toThrow(/alias/)
    })

    test('the note says it is not an IPSAS 2 cash flow statement, and states the rules', () => {
      expect(CASH_STATEMENT_NOTE).toMatch(/^This is a statement of cash receipts and payments\. It is not a cash flow statement under IPSAS 2/)
      expect(CASH_STATEMENT_NOTE).toMatch(/between the council's own bank and cash accounts/)
      expect(CASH_STATEMENT_NOTE).toMatch(/Opening-balance and year-end closing vouchers are not receipts or payments/)
      expect(CASH_STATEMENT_NOTE).toMatch(/nothing is apportioned or rounded/)
      // Review I1: the columns tie to the receipts and payments, and a line against its voucher is negative.
      expect(CASH_STATEMENT_NOTE).toMatch(/the inflows add up to the receipts and the outflows to the payments exactly/)
      expect(CASH_STATEMENT_NOTE).toMatch(/tax withheld from a payment .* shows as a negative figure/)
      expect(CASH_STATEMENT_NOTE).not.toMatch(/!/)
    })
  })

  describe('what a statement does not yet contain, in sentences', () => {
    const base = {
      payableAccounts: 1, unreconciledBanks: [], ppeWithoutAssets: [], asAt: '1993-12-31',
      yearLabel: 'FY 1993', openPeriods: null,
    }

    test('nothing missing: no sentence at all', () => {
      expect(incompleteSentences(base)).toEqual([])
      expect(incompleteSentences({ ...base, openPeriods: [] })).toEqual([])
    })

    test('each gap is its own sentence, in a fixed order', () => {
      expect(incompleteSentences({
        ...base,
        payableAccounts: 0,
        unreconciledBanks: [
          { code: '1100', name: 'Main bank', currency: 'USD', reconciled_to: null },
          { code: '1300', name: 'Second bank', currency: 'ZWG', reconciled_to: '1993-03-31' },
        ],
        ppeWithoutAssets: ['USD'],
        openPeriods: [3],
      })).toEqual([
        'The chart has no creditors (payable) control account, so this statement shows what the council is owed and not what it owes.',
        'The USD balance of bank account 1100 Main bank has never been reconciled to a bank statement.',
        'The ZWG balance of bank account 1300 Second bank is reconciled only to 31 March 1993; later entries are not yet agreed to a bank statement.',
        'The property, plant and equipment accounts carry a balance in the USD book, but the asset register holds no USD asset acquired by 31 December 1993, so no depreciation has been charged against it.',
        'Period 3 of FY 1993 is still open, so these year-end figures may still change.',
      ])
    })

    test('the payables sentence is worded for the statement it is printed on (review m6)', () => {
      expect(incompleteSentences({ ...base, payableAccounts: 0 })).toEqual([
        'The chart has no creditors (payable) control account, so this statement shows what the council is owed and not what it owes.'])
      expect(incompleteSentences({ ...base, payableAccounts: 0, statement: 'performance' })).toEqual([
        'The chart has no creditors (payable) control account, so expenditure is recorded only when it is paid: '
          + 'goods and services received and not yet paid for are missing from this statement.'])
    })

    test('several open periods are listed in one sentence', () => {
      expect(incompleteSentences({ ...base, openPeriods: [3, 5, 7] }))
        .toEqual(['Periods 3, 5 and 7 of FY 1993 are still open, so these year-end figures may still change.'])
      expect(incompleteSentences({ ...base, openPeriods: [11, 12] }))
        .toEqual(['Periods 11 and 12 of FY 1993 are still open, so these year-end figures may still change.'])
    })
  })

  describe('the reversal of a year-end closing keeps the closing\'s date (B11 review N1)', () => {
    const closing = { voucher_no: 'YC-0000002', voucher_type: 'closing', posting_date: '1992-12-31' }

    test('another date is refused, with a sentence', () => {
      expect(closingReversalDateRefusal(closing, '1992-12-30')).toEqual({
        status: 400, error: 'bad_date',
        message: 'A reversal of the year-end closing YC-0000002 is dated the same day as the closing, 1992-12-31, not 1992-12-30. '
          + 'Leave the date out, or give 1992-12-31.',
      })
    })

    test('the same date, or none, is accepted', () => {
      expect(closingReversalDateRefusal(closing, '1992-12-31')).toBeNull()
      expect(closingReversalDateRefusal(closing, undefined)).toBeNull()
      expect(closingReversalDateRefusal(closing, null)).toBeNull()
    })

    test('the database\'s own refusal (finance.raise_reversal, migration 242) is translated the same way (review m1)', () => {
      expect(ledgerRefusal({
        code: '22023',
        message: 'a reversal of the year-end closing YC-0000002 is dated the same day as the closing, 1992-12-31, not 1992-12-30',
      })).toEqual({
        status: 400, error: 'bad_date',
        message: 'A reversal of the year-end closing YC-0000002 is dated the same day as the closing, 1992-12-31, not 1992-12-30.',
      })
    })

    test('any other voucher may be reversed on another date', () => {
      expect(closingReversalDateRefusal({ ...closing, voucher_type: 'journal' }, '1993-01-15')).toBeNull()
    })
  })
})
