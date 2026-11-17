/**
 * The ledger's read side for the Accounting workspace: the chart with each account's balance, one
 * account's ledger with what it brought forward, a running balance and what it carries forward, and
 * the bank and cash accounts with where each one's reconciliation stands (the Cashbook).
 *
 * Design: docs/superpowers/specs/2026-11-16-accounting-workspace-design.md §6.3 and §7.2 (frontend
 * repo). Balances come from finance.ledger_balances() (migration 242); entries from
 * finance.ledger_entry (migration 203); the reconciled flag and the reconciliation position from
 * finance.bank_match_entry, finance.bank_match and finance.bank_statement (migration 212).
 *
 * EVERY FIGURE IS COMPUTED IN SQL. A balance leaves the database as three strings: `net_debit`
 * signed debit-positive, `amount` its absolute value, `side` 'Cr' only when it is below nil (a nil
 * balance reads 'Dr'). No JavaScript here derives a side or adds an amount, so an account in credit
 * against its nature is shown in credit wherever it appears.
 *
 * TENANCY. Every query runs on the scoped connection (row-level security) AND names the caller's
 * own authority explicitly, so a read can never combine two councils' books even on a connection
 * that bypasses row-level security.
 */

const { requirePermission } = require('../middleware/financePermissions')
const { naturalSide } = require('./finance-ledger')
const { toCsv } = require('../lib/financeCsv')

const uuid = { type: 'string', format: 'uuid' }
const isoDate = { type: 'string', format: 'date' }
const currency = { type: 'string', enum: ['USD', 'ZWG'] }
const closing = { type: 'string', enum: ['before', 'after'], default: 'after' }

/** The most lines one CSV export carries. Beyond it the reader is asked to narrow the dates. */
const CSV_LINE_CAP = 50000

const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message, extra = {}) =>
  reply.code(status).send({ success: false, error, message, ...extra })

/**
 * A balance as a JSON object, built in SQL from a NUMERIC expression. `expr` is SQL text written in
 * this file, never a value from the request.
 */
const balSql = (expr) => `json_build_object(
    'net_debit', (${expr})::numeric(18,2)::text,
    'amount', abs(${expr})::numeric(18,2)::text,
    'side', CASE WHEN (${expr}) < 0 THEN 'Cr' ELSE 'Dr' END)`

/** A file name made only of characters every system accepts. */
const safeName = (parts) => `${parts.filter(Boolean).join('-').replace(/[^A-Za-z0-9._-]+/g, '_')}.csv`

const sendCsv = (reply, filename, text) => reply
  .code(200)
  .header('content-type', 'text/csv; charset=utf-8')
  .header('content-disposition', `attachment; filename="${filename}"`)
  .send(text)

async function financeLedgerReadRoutes(fastify) {
  const pg = fastify.pg
  const canView = { preHandler: requirePermission(fastify, 'finance.ledger.view') }

  /** The financial year, if it is the caller's council's. */
  const yearOf = async (yearId, authorityId, asAt = null) => {
    const { rows } = await pg.query(
      `SELECT fy.id, fy.start_date::text AS start_date, fy.end_date::text AS end_date,
              LEAST(COALESCE($3::date, fy.end_date), fy.end_date)::text AS as_at
         FROM finance.financial_year fy
        WHERE fy.id = $1 AND fy.authority_id = $2 AND fy.deleted_at IS NULL`,
      [yearId, authorityId, asAt],
    )
    return rows[0] || null
  }

  // ═══ The chart with each account's balance ══════════════════════════════════════════════════

  /**
   * Every account of the chart in code order, each with its balance in each book as at a date. A
   * heading carries the sum of every account beneath it, at any depth, summed by a recursive query.
   * Nil balances are left out of `balances`.
   */
  fastify.get('/finance/ledger/chart-balances', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: { financial_year_id: uuid, as_at: isoDate, closing },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const authorityId = request.user.authority_id
    const year = await yearOf(q.financial_year_id, authorityId, q.as_at || null)
    if (!year) return fail(reply, 404, 'not_found', 'No such financial year.')

    const [accounts, books] = await Promise.all([
      pg.query(
        `WITH RECURSIVE
         lb AS (
           SELECT b.currency, b.ledger_account_id, b.net_debit
             FROM finance.ledger_balances($1, $2::date, $3) b
            WHERE b.ledger_account_id IS NOT NULL
         ),
         chart AS (
           SELECT la.id, la.parent_id FROM finance.ledger_account la
            WHERE la.authority_id = $4 AND la.deleted_at IS NULL
         ),
         -- Each account paired with itself and with everything beneath it. The path stops a
         -- parent cycle from recursing for ever.
         tree (ancestor, id, path) AS (
           SELECT c.id, c.id, ARRAY[c.id] FROM chart c
           UNION ALL
           SELECT t.ancestor, c.id, t.path || c.id
             FROM tree t JOIN chart c ON c.parent_id = t.id
            WHERE NOT c.id = ANY (t.path)
         ),
         sums AS (
           SELECT t.ancestor, lb.currency, sum(lb.net_debit) AS net
             FROM tree t JOIN lb ON lb.ledger_account_id = t.id
            GROUP BY t.ancestor, lb.currency
           HAVING sum(lb.net_debit) <> 0
         )
         SELECT la.id, la.code, la.name, la.root_type, la.report_type, la.account_type, la.parent_id,
                la.is_group, la.is_postable, la.status, la.notes,
                COALESCE((
                  SELECT json_agg(json_build_object(
                           'currency', s.currency,
                           'net_debit', s.net::numeric(18,2)::text,
                           'amount', abs(s.net)::numeric(18,2)::text,
                           'side', CASE WHEN s.net < 0 THEN 'Cr' ELSE 'Dr' END) ORDER BY s.currency)
                    FROM sums s WHERE s.ancestor = la.id), '[]'::json) AS balances
           FROM finance.ledger_account la
          WHERE la.authority_id = $4 AND la.deleted_at IS NULL
          ORDER BY la.code, la.id`,
        [year.id, year.as_at, q.closing, authorityId],
      ),
      pg.query(
        `SELECT DISTINCT b.currency FROM finance.ledger_balances($1, $2::date, $3) b ORDER BY b.currency`,
        [year.id, year.as_at, q.closing],
      ),
    ])
    return ok(reply, {
      accounts: accounts.rows,
      currencies: books.rows.map((r) => r.currency),
      as_at: year.as_at,
      closing: q.closing,
    })
  })

  // ═══ One account's ledger ═══════════════════════════════════════════════════════════════════

  /**
   * One account in one book over a range: brought forward, the entries with a running balance,
   * the range's totals and what is carried forward.
   *
   * Brought forward: a balance-sheet account carries every entry before `from` in any year; a
   * revenue or expense account carries only the entries of the year asked for that fall before
   * `from`. The running balance is a window sum over the WHOLE range, ordered posting_date,
   * posted_at, id, and is paged only afterwards, so the first line of page two continues from the
   * last line of page one. `format=csv` ignores limit and offset and exports the whole range.
   */
  fastify.get('/finance/ledger/accounts/:id/ledger', {
    ...canView,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: uuid } },
      querystring: {
        type: 'object', required: ['financial_year_id', 'currency'], additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          currency,
          from: isoDate,
          to: isoDate,
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const authorityId = request.user.authority_id
    const year = await yearOf(q.financial_year_id, authorityId)
    if (!year) return fail(reply, 404, 'not_found', 'No such financial year.')

    const { rows: found } = await pg.query(
      `SELECT la.id, la.code, la.name, la.root_type, la.report_type, la.account_type, la.parent_id,
              parent.code AS parent_code, la.is_group, la.is_postable, la.status, la.notes,
              la.created_at::text AS created_at
         FROM finance.ledger_account la
         LEFT JOIN finance.ledger_account parent ON parent.id = la.parent_id
        WHERE la.id = $1 AND la.authority_id = $2 AND la.deleted_at IS NULL`,
      [request.params.id, authorityId],
    )
    const account = found[0]
    if (!account) return fail(reply, 404, 'not_found', 'No such ledger account.')
    if (account.is_group) {
      return fail(reply, 409, 'is_group',
        `${account.code} is a heading. Nothing is posted to a heading; open an account beneath it.`)
    }

    const from = q.from || year.start_date
    const to = q.to || year.end_date
    // ISO dates compare as text; this is a date, not an amount.
    if (from > to) {
      return fail(reply, 400, 'bad_range', `The range starts on ${from}, after it ends on ${to}.`)
    }

    // $1 account, $2 currency, $3 authority, $4 year, $5 from, $6 to. The entries query adds $7 is-bank,
    // $8 limit, $9 offset and $10 the year end: an entry counts as reconciled only under a statement
    // dated on or before the year end, the same rule the cash-accounts read applies, so the
    // cashbook's head and its body agree.
    const ranged = `
      WITH scope AS (
        SELECT e.id, e.voucher_id, e.voucher_no, e.voucher_type, e.posting_date, e.narration,
               e.party_id, e.debit, e.credit, e.posted_at
          FROM finance.ledger_entry e
          JOIN finance.ledger_account la ON la.id = e.ledger_account_id
         WHERE e.ledger_account_id = $1 AND e.currency::text = $2 AND e.authority_id = $3
           AND (la.root_type IN ('asset', 'liability', 'equity') OR e.financial_year_id = $4)
      ),
      bf AS (
        SELECT COALESCE(sum(s.debit - s.credit), 0)::numeric AS net FROM scope s WHERE s.posting_date < $5::date
      ),
      ranged AS (
        SELECT s.*,
               row_number() OVER w AS seq,
               (SELECT net FROM bf) + sum(s.debit - s.credit) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
          FROM scope s
         WHERE s.posting_date >= $5::date AND s.posting_date <= $6::date
        WINDOW w AS (ORDER BY s.posting_date, s.posted_at, s.id)
      )`
    const base = [account.id, q.currency, authorityId, year.id, from, to]

    const { rows: [summary] } = await pg.query(
      `${ranged}
       SELECT count(*)::int AS total,
              ${balSql('(SELECT net FROM bf)')} AS brought_forward,
              COALESCE(sum(r.debit), 0)::numeric(18,2)::text AS debit,
              COALESCE(sum(r.credit), 0)::numeric(18,2)::text AS credit,
              ${balSql('(SELECT net FROM bf) + COALESCE(sum(r.debit - r.credit), 0)')} AS carried_forward
         FROM ranged r`, base,
    )

    const csv = q.format === 'csv'
    if (csv && summary.total > CSV_LINE_CAP) {
      return fail(reply, 413, 'too_large',
        `This range holds ${summary.total} entries, more than the ${CSV_LINE_CAP} one export carries. `
        + 'Narrow the dates and export it in parts.')
    }

    const { rows: entries } = await pg.query(
      `${ranged}
       SELECT r.id, r.voucher_id, r.voucher_no, r.voucher_type, r.posting_date::text AS posting_date,
              r.narration, r.party_id, p.name AS party_name,
              r.debit::numeric(18,2)::text AS debit, r.credit::numeric(18,2)::text AS credit,
              ${balSql('r.running')} AS balance,
              CASE WHEN $7::boolean THEN EXISTS (
                     SELECT 1 FROM finance.bank_match_entry me
                       JOIN finance.bank_match m ON m.id = me.match_id
                       JOIN finance.bank_statement st ON st.id = m.statement_id
                      WHERE me.ledger_entry_id = r.id AND st.status = 'reconciled'
                        AND st.to_date <= $10::date AND st.authority_id = $3)
              END AS reconciled
         FROM ranged r
         LEFT JOIN finance.party p ON p.id = r.party_id
        ORDER BY r.seq
        LIMIT $8 OFFSET $9`,
      [...base, account.account_type === 'bank', csv ? CSV_LINE_CAP : q.limit, csv ? 0 : q.offset, year.end_date],
    )

    if (csv) {
      const columns = [
        { header: 'Date', key: 'date' }, { header: 'Voucher', key: 'voucher' }, { header: 'Type', key: 'type' },
        { header: 'Narration', key: 'narration' }, { header: 'Party', key: 'party' },
        { header: 'Debit', key: 'debit', type: 'amount' }, { header: 'Credit', key: 'credit', type: 'amount' },
        { header: 'Balance', key: 'balance', type: 'amount' }, { header: 'Side', key: 'side' },
      ]
      const lines = [
        { narration: 'Brought forward', balance: summary.brought_forward.amount, side: summary.brought_forward.side },
        ...entries.map((e) => ({
          date: e.posting_date, voucher: e.voucher_no, type: e.voucher_type, narration: e.narration,
          party: e.party_name, debit: e.debit, credit: e.credit, balance: e.balance.amount, side: e.balance.side,
        })),
        { narration: 'Period totals', debit: summary.debit, credit: summary.credit },
        { narration: 'Carried forward', balance: summary.carried_forward.amount, side: summary.carried_forward.side },
      ]
      return sendCsv(reply, safeName(['ledger', account.code, q.currency, from, to]), toCsv(columns, lines))
    }

    return ok(reply, {
      account,
      natural_side: naturalSide(account.root_type),
      currency: q.currency,
      from,
      to,
      brought_forward: summary.brought_forward,
      entries,
      totals: { debit: summary.debit, credit: summary.credit },
      carried_forward: summary.carried_forward,
      total: summary.total,
      limit: q.limit,
      offset: q.offset,
    })
  })

  // ═══ The cash and bank accounts, for the Cashbook ═══════════════════════════════════════════

  /**
   * Every bank and cash account with entries, one row per account and book, each with its balance,
   * its last entry and (bank accounts only) where reconciliation stands. Everything is AS AT THE
   * YEAR END, the way the bank reconciliation reads a statement's date (migration 212,
   * bank_reconciliation_summary):
   *   - balance: every entry dated on or before the year end, in any year (a bank or cash account
   *     is a balance-sheet account, so this is what finance.ledger_balances returns for it);
   *   - reconciled_to / reconciled_balance: the to_date and closing balance of the latest
   *     reconciled statement for that account and book whose to_date falls on or before the year
   *     end; null when there is none;
   *   - unreconciled: the entries dated on or before the year end that are not in a match under a
   *     reconciled statement dated on or before it. Null for a cash account, which has no statement.
   */
  fastify.get('/finance/ledger/cash-accounts', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: { financial_year_id: uuid },
      },
    },
  }, async (request, reply) => {
    const authorityId = request.user.authority_id
    const year = await yearOf(request.query.financial_year_id, authorityId)
    if (!year) return fail(reply, 404, 'not_found', 'No such financial year.')

    // $1 authority, $2 the year end.
    const { rows } = await pg.query(
      `WITH book AS (
         SELECT e.ledger_account_id AS account_id, e.currency::text AS currency,
                sum(e.debit - e.credit) AS net,
                max(e.posting_date) AS last_entry,
                count(*) FILTER (WHERE NOT x.reconciled)::int AS open_entries,
                COALESCE(sum(e.debit) FILTER (WHERE NOT x.reconciled), 0) AS open_debit,
                COALESCE(sum(e.credit) FILTER (WHERE NOT x.reconciled), 0) AS open_credit
           FROM finance.ledger_entry e
           JOIN finance.ledger_account la ON la.id = e.ledger_account_id
          CROSS JOIN LATERAL (
            SELECT EXISTS (
              SELECT 1 FROM finance.bank_match_entry me
                JOIN finance.bank_match m ON m.id = me.match_id
                JOIN finance.bank_statement st ON st.id = m.statement_id
               WHERE me.ledger_entry_id = e.id AND st.status = 'reconciled'
                 AND st.to_date <= $2::date AND st.authority_id = $1) AS reconciled) x
          WHERE e.authority_id = $1 AND e.posting_date <= $2::date
            AND la.authority_id = $1 AND la.deleted_at IS NULL AND la.account_type IN ('bank', 'cash')
          GROUP BY e.ledger_account_id, e.currency
       ),
       last_reconciled AS (
         SELECT DISTINCT ON (st.bank_account_id, st.currency)
                st.bank_account_id, st.currency::text AS currency, st.to_date, st.closing_balance
           FROM finance.bank_statement st
          WHERE st.authority_id = $1 AND st.status = 'reconciled' AND st.to_date <= $2::date
          ORDER BY st.bank_account_id, st.currency, st.to_date DESC, st.reconciled_at DESC, st.id
       )
       SELECT la.id, la.code, la.name, la.account_type, b.currency,
              ${balSql('b.net')} AS balance,
              b.last_entry::text AS last_entry,
              r.to_date::text AS reconciled_to,
              r.closing_balance::numeric(18,2)::text AS reconciled_balance,
              CASE WHEN la.account_type = 'bank' THEN json_build_object(
                     'entries', b.open_entries,
                     'debit', b.open_debit::numeric(18,2)::text,
                     'credit', b.open_credit::numeric(18,2)::text)
              END AS unreconciled
         FROM book b
         JOIN finance.ledger_account la ON la.id = b.account_id
         LEFT JOIN last_reconciled r
                ON la.account_type = 'bank' AND r.bank_account_id = b.account_id AND r.currency = b.currency
        ORDER BY la.code, la.id, b.currency`,
      [authorityId, year.end_date],
    )
    return ok(reply, { accounts: rows })
  })

  // ═══ Ledger reports ═════════════════════════════════════════════════════════════════════════

  /**
   * The general ledger for one book: every postable account with a brought-forward balance or an
   * entry in the range, each with its entries and running balance. Brought forward follows the
   * account-ledger rule above (balance-sheet accounts carry every earlier entry in any year; revenue
   * and expense accounts only this year's). Paged by ACCOUNT, not by line; `format=csv` exports the
   * whole range as one flat file with the account on every line.
   */
  fastify.get('/finance/ledger/reports/general-ledger', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id', 'currency'], additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          currency,
          from: isoDate,
          to: isoDate,
          root_type: { type: 'string', enum: ['asset', 'liability', 'equity', 'revenue', 'expense'] },
          account_from: { type: 'string', maxLength: 40 },
          account_to: { type: 'string', maxLength: 40 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const authorityId = request.user.authority_id
    const year = await yearOf(q.financial_year_id, authorityId)
    if (!year) return fail(reply, 404, 'not_found', 'No such financial year.')
    const from = q.from || year.start_date
    const to = q.to || year.end_date
    if (from > to) return fail(reply, 400, 'bad_range', `The range starts on ${from}, after it ends on ${to}.`)

    // $1 authority, $2 currency, $3 year, $4 from, $5 to, $6 root type, $7 code from, $8 code to.
    const scoped = `
      WITH scope AS (
        SELECT e.id, e.ledger_account_id, e.voucher_id, e.voucher_no, e.voucher_type, e.posting_date,
               e.narration, e.party_id, e.debit, e.credit, e.posted_at
          FROM finance.ledger_entry e
          JOIN finance.ledger_account la ON la.id = e.ledger_account_id
         WHERE e.authority_id = $1 AND e.currency::text = $2
           AND la.authority_id = $1 AND la.deleted_at IS NULL
           AND (la.root_type IN ('asset', 'liability', 'equity') OR e.financial_year_id = $3)
           AND ($6::text IS NULL OR la.root_type = $6)
           AND ($7::text IS NULL OR la.code >= $7)
           AND ($8::text IS NULL OR la.code <= $8)
           AND e.posting_date <= $5::date
      ),
      per_account AS (
        SELECT s.ledger_account_id AS id,
               COALESCE(sum(s.debit - s.credit) FILTER (WHERE s.posting_date < $4::date), 0) AS bf,
               COALESCE(sum(s.debit) FILTER (WHERE s.posting_date >= $4::date), 0) AS dr,
               COALESCE(sum(s.credit) FILTER (WHERE s.posting_date >= $4::date), 0) AS cr,
               count(*) FILTER (WHERE s.posting_date >= $4::date) AS n
          FROM scope s GROUP BY s.ledger_account_id
      ),
      listed AS (
        SELECT la.id, la.code, la.name, la.root_type, pa.bf, pa.dr, pa.cr
          FROM per_account pa JOIN finance.ledger_account la ON la.id = pa.id
         WHERE pa.bf <> 0 OR pa.n > 0
      )`
    const base = [authorityId, q.currency, year.id, from, to, q.root_type || null, q.account_from || null, q.account_to || null]
    const csv = q.format === 'csv'

    const { rows: [{ total }] } = await pg.query(`${scoped} SELECT count(*)::int AS total FROM listed`, base)
    const { rows: accounts } = await pg.query(
      `${scoped}
       SELECT l.id, l.code, l.name, l.root_type,
              ${balSql('l.bf')} AS brought_forward,
              l.dr::numeric(18,2)::text AS debit, l.cr::numeric(18,2)::text AS credit,
              ${balSql('l.bf + l.dr - l.cr')} AS carried_forward
         FROM listed l ORDER BY l.code, l.id LIMIT $9 OFFSET $10`,
      [...base, csv ? 100000 : q.limit, csv ? 0 : q.offset],
    )

    const ids = accounts.map((a) => a.id)
    const { rows: lines } = ids.length ? await pg.query(
      `${scoped}
       SELECT r.* FROM (
         SELECT s.id, s.ledger_account_id, s.voucher_id, s.voucher_no, s.voucher_type,
                s.posting_date::text AS posting_date, s.narration, s.party_id, p.name AS party_name,
                s.debit::numeric(18,2)::text AS debit, s.credit::numeric(18,2)::text AS credit,
                ${balSql(`(SELECT bf FROM per_account pa WHERE pa.id = s.ledger_account_id)
                  + sum(s.debit - s.credit) OVER (PARTITION BY s.ledger_account_id
                      ORDER BY s.posting_date, s.posted_at, s.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`)} AS balance,
                s.posting_date AS d, s.posted_at AS t
           FROM scope s LEFT JOIN finance.party p ON p.id = s.party_id
          WHERE s.posting_date >= $4::date AND s.ledger_account_id = ANY($9::uuid[])
       ) r ORDER BY r.d, r.t, r.id`,
      [...base, ids],
    ) : { rows: [] }
    if (csv && lines.length > CSV_LINE_CAP) {
      return fail(reply, 413, 'too_large',
        `This range holds ${lines.length} entries, more than the ${CSV_LINE_CAP} one export carries. Narrow the dates.`)
    }

    const byAccount = new Map(accounts.map((a) => [a.id, []]))
    for (const l of lines) {
      const { ledger_account_id: acc, d, t, ...line } = l
      byAccount.get(acc).push({ ...line, reconciled: null })
    }

    if (csv) {
      const columns = [
        { header: 'Account', key: 'code' }, { header: 'Account name', key: 'name' },
        { header: 'Date', key: 'date' }, { header: 'Voucher', key: 'voucher' }, { header: 'Type', key: 'type' },
        { header: 'Narration', key: 'narration' }, { header: 'Party', key: 'party' },
        { header: 'Debit', key: 'debit', type: 'amount' }, { header: 'Credit', key: 'credit', type: 'amount' },
        { header: 'Balance', key: 'balance', type: 'amount' }, { header: 'Side', key: 'side' },
      ]
      const out = []
      for (const a of accounts) {
        const head = { code: a.code, name: a.name }
        out.push({ ...head, narration: 'Brought forward', balance: a.brought_forward.amount, side: a.brought_forward.side })
        for (const e of byAccount.get(a.id)) {
          out.push({ ...head, date: e.posting_date, voucher: e.voucher_no, type: e.voucher_type, narration: e.narration,
            party: e.party_name, debit: e.debit, credit: e.credit, balance: e.balance.amount, side: e.balance.side })
        }
        out.push({ ...head, narration: 'Carried forward', debit: a.debit, credit: a.credit,
          balance: a.carried_forward.amount, side: a.carried_forward.side })
      }
      return sendCsv(reply, safeName(['general-ledger', q.currency, from, to]), toCsv(columns, out))
    }

    return ok(reply, {
      accounts: accounts.map((a) => ({
        account: { id: a.id, code: a.code, name: a.name, root_type: a.root_type },
        brought_forward: a.brought_forward,
        entries: byAccount.get(a.id),
        totals: { debit: a.debit, credit: a.credit },
        carried_forward: a.carried_forward,
      })),
      total_accounts: total,
      limit: q.limit,
      offset: q.offset,
    })
  })

  /**
   * Vouchers in a range with their lines, newest last, and debit and credit totals per currency
   * over the WHOLE filtered set (not just the page). Draft and cancelled vouchers are listed only
   * when `status` asks for them; by default the listing is what is in the books: posted vouchers.
   */
  fastify.get('/finance/ledger/reports/journal-listing', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          from: isoDate,
          to: isoDate,
          voucher_type: { type: 'string', maxLength: 40 },
          status: { type: 'string', enum: ['draft', 'posted', 'cancelled'] },
          currency,
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const authorityId = request.user.authority_id
    const year = await yearOf(q.financial_year_id, authorityId)
    if (!year) return fail(reply, 404, 'not_found', 'No such financial year.')
    const from = q.from || year.start_date
    const to = q.to || year.end_date
    if (from > to) return fail(reply, 400, 'bad_range', `The range starts on ${from}, after it ends on ${to}.`)

    // $1 authority, $2 year, $3 from, $4 to, $5 type, $6 status, $7 currency.
    const where = `
      FROM finance.voucher v
     WHERE v.authority_id = $1 AND v.financial_year_id = $2
       AND v.posting_date BETWEEN $3::date AND $4::date
       AND ($5::text IS NULL OR v.voucher_type = $5)
       AND v.status = COALESCE($6::text, 'posted')
       AND ($7::text IS NULL OR v.currency = $7)`
    const base = [authorityId, year.id, from, to, q.voucher_type || null, q.status || null, q.currency || null]
    const csv = q.format === 'csv'

    const [{ rows: [{ total }] }, { rows: totals }] = await Promise.all([
      pg.query(`SELECT count(*)::int AS total ${where}`, base),
      pg.query(
        `SELECT v.currency,
                COALESCE(sum(vl.debit), 0)::numeric(18,2)::text AS debit_total,
                COALESCE(sum(vl.credit), 0)::numeric(18,2)::text AS credit_total
           ${where.replace('FROM finance.voucher v', 'FROM finance.voucher v JOIN finance.voucher_line vl ON vl.voucher_id = v.id')}
          GROUP BY v.currency ORDER BY v.currency`, base),
    ])
    if (csv && total > 20000) {
      return fail(reply, 413, 'too_large', `This range holds ${total} vouchers; narrow the dates and export it in parts.`)
    }

    const { rows: vouchers } = await pg.query(
      `SELECT v.id, v.voucher_no, v.voucher_type, v.currency, v.posting_date::text AS posting_date, v.status,
              v.narration, v.reference,
              COALESCE(pu.full_name, pu.name) AS prepared_by_name, COALESCE(qu.full_name, qu.name) AS posted_by_name,
              COALESCE((SELECT json_agg(json_build_object(
                         'line_no', vl.line_no, 'account_code', la.code, 'account_name', la.name,
                         'party_name', p.name,
                         'debit', vl.debit::numeric(18,2)::text, 'credit', vl.credit::numeric(18,2)::text,
                         'narration', vl.narration) ORDER BY vl.line_no)
                  FROM finance.voucher_line vl
                  JOIN finance.ledger_account la ON la.id = vl.ledger_account_id
                  LEFT JOIN finance.party p ON p.id = vl.party_id
                 WHERE vl.voucher_id = v.id), '[]'::json) AS lines,
              (SELECT COALESCE(sum(vl.debit), 0)::numeric(18,2)::text FROM finance.voucher_line vl WHERE vl.voucher_id = v.id) AS debit_total,
              (SELECT COALESCE(sum(vl.credit), 0)::numeric(18,2)::text FROM finance.voucher_line vl WHERE vl.voucher_id = v.id) AS credit_total
         ${where.replace('FROM finance.voucher v', `FROM finance.voucher v
           LEFT JOIN public.users pu ON pu.id = v.prepared_by
           LEFT JOIN public.users qu ON qu.id = v.posted_by`)}
        ORDER BY v.posting_date, v.voucher_no, v.id
        LIMIT $8 OFFSET $9`,
      [...base, csv ? 20000 : q.limit, csv ? 0 : q.offset],
    )

    if (csv) {
      const columns = [
        { header: 'Date', key: 'date' }, { header: 'Voucher', key: 'voucher' }, { header: 'Type', key: 'type' },
        { header: 'Currency', key: 'currency' }, { header: 'Status', key: 'status' }, { header: 'Line', key: 'line' },
        { header: 'Account', key: 'account' }, { header: 'Account name', key: 'account_name' },
        { header: 'Party', key: 'party' }, { header: 'Narration', key: 'narration' },
        { header: 'Debit', key: 'debit', type: 'amount' }, { header: 'Credit', key: 'credit', type: 'amount' },
      ]
      const out = vouchers.flatMap((v) => v.lines.map((l) => ({
        date: v.posting_date, voucher: v.voucher_no, type: v.voucher_type, currency: v.currency, status: v.status,
        line: l.line_no, account: l.account_code, account_name: l.account_name, party: l.party_name,
        narration: l.narration || v.narration, debit: l.debit, credit: l.credit,
      })))
      return sendCsv(reply, safeName(['journal-listing', from, to]), toCsv(columns, out))
    }
    return ok(reply, { vouchers, total, totals })
  })
}

module.exports = { financeLedgerReadRoutes, CSV_LINE_CAP, safeName }
