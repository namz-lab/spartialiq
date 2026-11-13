/**
 * The transaction register's two pieces of pure logic: the reversal-mode WHERE fragment and the
 * sort whitelist.
 *
 * They are tested here, with NO DATABASE and NO HTTP, for the same reason the finance primitives
 * are (test/finance-primitives.test.js): these are the functions where a quiet mistake becomes a
 * wrong figure in a council's management account. A register whose `exclude` mode drops a row that
 * `only` also drops has silently lost money; a sort key that reaches SQL unchecked is an injection.
 * Neither failure needs a database to demonstrate, and a test that needs one would not be run.
 *
 * WHAT THE PARTITION TEST IS ACTUALLY ASSERTING
 * `exclude` and `only` are built to be exact logical complements, so that together they account for
 * every row `all` returns, once each. The fragments are evaluated here against a small in-memory
 * register by a tiny interpreter (`matches` below) rather than by Postgres, which is enough to
 * catch the mistake that matters: a row falling into both modes, or into neither.
 */
const {
  reversalFilter, orderBy, SORT_COLUMNS, REVERSAL_MODES,
} = require('../src/routes/finance-transactions')

// ── A register, as the correction model actually leaves it ─────────────────────────────────────
//
// AMOUNTS ARE SIGNED. A reversal is not a positive figure with a flag on it: it carries the
// NEGATIVE of the row it reverses, which is why finance.v_budget_line_performance can net a line
// by plain `sum(t.amount)` (migration 188:794). Verified on the dev data: budget line DD-L02 holds
// nine postings of 38 000 and one reversal of −38 000, and the view reports an actual of 304 000.
//
// So a payment of 100 was wrong. It stands (t1), a reversal of −100 cancels it (t2), and a
// replacement of 120 is the figure that is now true (t3). t4 was never corrected.
const REGISTER = [
  { id: 't1', amount: '100.00', reverses_id: null, deleted: false },
  { id: 't2', amount: '-100.00', reverses_id: 't1', deleted: false },
  { id: 't3', amount: '120.00', reverses_id: null, deleted: false },
  { id: 't4', amount: '40.00', reverses_id: null, deleted: false },
]

/**
 * Evaluate one of the three fragments against a row of REGISTER.
 *
 * The fragments are three fixed shapes, so this reads them by shape rather than parsing SQL: what
 * is under test is which rows each mode claims, not Postgres's expression evaluator.
 */
function matches(fragment, row, register) {
  const reversedBySomething = register.some((r) => r.reverses_id === row.id && !r.deleted)
  if (fragment === 'TRUE') return true
  if (fragment.startsWith('(t.reverses_id IS NOT NULL OR')) {
    return row.reverses_id !== null || reversedBySomething
  }
  if (fragment.startsWith('(t.reverses_id IS NULL AND NOT')) {
    return row.reverses_id === null && !reversedBySomething
  }
  throw new Error(`unrecognised fragment: ${fragment}`)
}

const idsFor = (mode, register = REGISTER) =>
  register.filter((row) => matches(reversalFilter(mode), row, register)).map((row) => row.id)

describe('reversalFilter', () => {
  test('the three modes are the three the contract names, and nothing else', () => {
    expect(REVERSAL_MODES).toEqual(['exclude', 'only', 'all'])
  })

  test('all keeps every row and adds no condition', () => {
    expect(reversalFilter('all')).toBe('TRUE')
    expect(idsFor('all')).toEqual(['t1', 't2', 't3', 't4'])
  })

  test('exclude drops both halves of a cancelled pair, and nothing else', () => {
    // BOTH halves. Dropping the reversal (t2) while keeping the row it reverses (t1) would
    // OVERSTATE the total by the corrected amount, because the reversal is the negative that
    // cancels it — the exact opposite of what the default is for.
    expect(idsFor('exclude')).toEqual(['t3', 't4'])
  })

  test('only keeps exactly the corrections: the reversals and what they reverse', () => {
    expect(idsFor('only')).toEqual(['t1', 't2'])
  })

  test('exclude and only partition all: no row in both, no row in neither', () => {
    const all = idsFor('all')
    const exclude = idsFor('exclude')
    const only = idsFor('only')
    expect([...exclude, ...only].sort()).toEqual([...all].sort())
    expect(exclude.filter((id) => only.includes(id))).toEqual([])
  })

  /**
   * THE PROPERTY THE DEFAULT RESTS ON.
   *
   * A whole pair nets to zero, so `exclude` and `all` must report the SAME total over the same
   * filter while reporting a different number of rows. If the two totals ever differ on a register
   * whose pairs are whole, the implementation is wrong — either it is dropping the reversal and
   * keeping its target (overstating by the corrected amount) or the reverse (understating).
   *
   * The sums here are over integer cents, because this is a test; the application sums in SQL over
   * NUMERIC and never in JavaScript (house rule 1).
   */
  test('exclude and all report the same total, over a different number of rows', () => {
    const cents = (a) => Math.round(Number(a) * 100)
    const sum = (ids) => REGISTER.filter((r) => ids.includes(r.id))
      .reduce((acc, r) => acc + cents(r.amount), 0)

    // all: 100 − 100 + 120 + 40 = 160. exclude: 120 + 40 = 160. The pair contributed nothing but
    // two rows a reader would have had to cancel mentally.
    expect(sum(idsFor('all'))).toBe(16000)
    expect(sum(idsFor('exclude'))).toBe(16000)
    expect(idsFor('all')).toHaveLength(4)
    expect(idsFor('exclude')).toHaveLength(2)

    // And the corrections on their own net to nil, which is what `only` is there to show.
    expect(sum(idsFor('only'))).toBe(0)
    // The three modes are therefore consistent: exclude + only = all, in rows and in money.
    expect(sum(idsFor('exclude')) + sum(idsFor('only'))).toBe(sum(idsFor('all')))
  })

  test('dropping only the reversal would overstate the total, which is the mistake being avoided', () => {
    const cents = (a) => Math.round(Number(a) * 100)
    const naive = REGISTER.filter((r) => r.reverses_id === null)
      .reduce((acc, r) => acc + cents(r.amount), 0)
    // 100 + 120 + 40 = 260 against a true 160: the corrected payment counted twice.
    expect(naive).toBe(26000)
    expect(naive).not.toBe(16000)
  })

  test('a total over `only` that is not nil is a reversal that does not match what it reverses', () => {
    // The register's own integrity check. A reversal whose target is not in the set — because the
    // target was soft-deleted, or because a date filter cut the pair in half — leaves `only` with a
    // non-zero total, and that is the fault worth finding rather than a figure to publish.
    const split = [
      { id: 'a', amount: '-5.00', reverses_id: 'elsewhere', deleted: false },
      { id: 'b', amount: '40.00', reverses_id: null, deleted: false },
    ]
    expect(idsFor('only', split)).toEqual(['a'])
    expect(idsFor('exclude', split)).toEqual(['b'])
  })

  test('a soft-deleted reversal leaves the original standing in the live register', () => {
    const withdrawn = [
      { id: 'a', amount: '100.00', reverses_id: null, deleted: false },
      { id: 'b', amount: '-100.00', reverses_id: 'a', deleted: true },
    ]
    // The reversal was withdrawn, so `a` is live again and `b` is not a correction that counts.
    expect(idsFor('exclude', withdrawn)).toEqual(['a'])
  })

  test('an unrecognised mode falls back to the live register, never to everything', () => {
    // Defence in depth: the Fastify enum already rejects it. If it ever did not, the quiet failure
    // must be the conservative one, because `all` silently double-counts a correction.
    expect(reversalFilter(undefined)).toBe(reversalFilter('exclude'))
    expect(reversalFilter('ALL')).toBe(reversalFilter('exclude'))
    expect(reversalFilter("'; DROP TABLE finance.transaction; --")).toBe(reversalFilter('exclude'))
  })

  test('no fragment carries a caller value, so none can be an injection', () => {
    for (const mode of [...REVERSAL_MODES, 'nonsense', null, 42]) {
      const fragment = reversalFilter(mode)
      expect(fragment).toMatch(/^(TRUE|\(t\.reverses_id )/)
      expect(fragment).not.toContain('nonsense')
      expect(fragment).not.toContain('42')
    }
  })
})

describe('the sort whitelist', () => {
  test('offers exactly the four keys the contract declares', () => {
    expect(Object.keys(SORT_COLUMNS).sort())
      .toEqual(['account_code', 'amount', 'department_code', 'txn_date'])
  })

  test('maps each key to a qualified column, never to the key itself', () => {
    expect(orderBy('txn_date', 'desc')).toBe('t.txn_date DESC, t.id')
    expect(orderBy('amount', 'asc')).toBe('t.amount ASC, t.id')
    expect(orderBy('account_code', 'asc')).toBe('a.code ASC, t.id')
    expect(orderBy('department_code', 'desc')).toBe('d.code DESC, t.id')
  })

  test('always breaks the tie on the id, so pagination cannot repeat or skip a row', () => {
    for (const key of Object.keys(SORT_COLUMNS)) {
      expect(orderBy(key, 'asc').endsWith(', t.id')).toBe(true)
    }
  })

  test('an unknown sort key becomes the transaction date and is never interpolated', () => {
    expect(orderBy('amount; DROP TABLE finance.transaction', 'asc')).toBe('t.txn_date ASC, t.id')
    expect(orderBy('counterparty_name', 'asc')).toBe('t.txn_date ASC, t.id')
    expect(orderBy(undefined, undefined)).toBe('t.txn_date DESC, t.id')
    expect(orderBy('t.amount', 'asc')).toBe('t.txn_date ASC, t.id')
  })

  test('the direction is one of two words, whatever arrives', () => {
    expect(orderBy('amount', 'asc')).toContain(' ASC,')
    expect(orderBy('amount', 'desc')).toContain(' DESC,')
    // Anything that is not the literal 'asc' sorts newest-first, which is the register's default.
    expect(orderBy('amount', 'ASC')).toContain(' DESC,')
    expect(orderBy('amount', 'asc; --')).toContain(' DESC,')
  })

  test('counterparty columns are not sortable, so a sort cannot leak what a column withholds', () => {
    // Ordering by a column a caller may not see would let them infer it; the whitelist is the
    // control and this pins it.
    expect(SORT_COLUMNS).not.toHaveProperty('counterparty_name')
    expect(SORT_COLUMNS).not.toHaveProperty('counterparty_ref')
  })
})
