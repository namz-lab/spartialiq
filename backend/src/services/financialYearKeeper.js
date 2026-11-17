/**
 * Keeps a financial year open for today.
 *
 * Every finance workspace dates its work against "the open year containing today". When none
 * exists (a fresh database, or the first day of a new year nobody created in advance) the
 * dashboards have nothing to show and the cash office cannot open a till. This job closes that
 * gap: for each authority with no year covering today, it creates and opens the council's
 * July-June year that contains today, labelled e.g. "2026/27".
 *
 * It never touches an existing year. If any year (draft, open or closed) already covers today,
 * or the new period would overlap one, that authority is left alone: those are the Director of
 * Finance's decisions.
 */
const { systemOf } = require('../lib/dbContext')

const ENSURE_SQL = `
  WITH span AS (
    SELECT make_date(y, 7, 1) AS start_date,
           make_date(y + 1, 6, 30) AS end_date,
           format('%s/%s', y, lpad(((y + 1) % 100)::text, 2, '0')) AS label
      FROM (SELECT CASE WHEN extract(month FROM CURRENT_DATE) >= 7
                        THEN extract(year FROM CURRENT_DATE)::int
                        ELSE extract(year FROM CURRENT_DATE)::int - 1 END AS y) t
  )
  INSERT INTO finance.financial_year
         (authority_id, label, start_date, end_date, status, opened_at, notes)
  SELECT a.id, s.label, s.start_date, s.end_date, 'open', now(),
         'Opened automatically: no financial year covered today.'
    FROM public.local_authorities a CROSS JOIN span s
   WHERE NOT EXISTS (
           SELECT 1 FROM finance.financial_year y
            WHERE y.authority_id = a.id AND y.deleted_at IS NULL
              AND (daterange(y.start_date, y.end_date, '[]') && daterange(s.start_date, s.end_date, '[]')
                   OR y.label = s.label))
  RETURNING authority_id, label`

async function ensureCurrentFinancialYear(pg, log) {
  try {
    const { rows } = await systemOf(pg).query(ENSURE_SQL)
    for (const r of rows) log?.info?.({ authority_id: r.authority_id, label: r.label }, 'financial year opened automatically')
    return rows
  } catch (err) {
    // A database without the finance schema yet is not an error worth stopping the server for.
    if (err.code === '42P01' || err.code === '3F000') return []
    log?.warn?.({ err }, 'financial year keeper failed')
    return []
  }
}

/** Run now and then every six hours, so the year rolls over on 1 July without anyone acting. */
function startFinancialYearKeeper(pg, log) {
  ensureCurrentFinancialYear(pg, log)
  const timer = setInterval(() => ensureCurrentFinancialYear(pg, log), 6 * 60 * 60 * 1000)
  timer.unref()
  return () => clearInterval(timer)
}

module.exports = { ensureCurrentFinancialYear, startFinancialYearKeeper, ENSURE_SQL }
