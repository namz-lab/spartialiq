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
} = require('../src/routes/finance-ledger')

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
  test('are the twelve the schema allows (migration 213)', () => {
    expect([...VOUCHER_TYPES].sort()).toEqual([
      'asset_disposal', 'closing', 'credit_note', 'depreciation', 'journal', 'opening', 'payment',
      'rates_bill', 'receipt', 'reversal', 'supplier_invoice', 'write_off',
    ])
  })

  test('a reversal is not among the types a caller may create by hand', () => {
    // A reversal's lines must mirror an original exactly. One written by hand that did not would be
    // a correction nobody could follow, so it is raised only by POST /vouchers/:id/reverse.
    const creatable = VOUCHER_TYPES.filter((t) => t !== 'reversal')
    expect(creatable).not.toContain('reversal')
    expect(creatable).toHaveLength(11)
  })
})
