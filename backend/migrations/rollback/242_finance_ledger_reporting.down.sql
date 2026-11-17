-- ROLLBACK OF 242 — THE LEDGER'S READ SIDE
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/242_finance_ledger_reporting.down.sql
-- Nothing posted is touched: vouchers numbered JV-, CN-, WO- or YC- keep their numbers and stay in
-- the ledger. The wider document_sequence constraint and the counters already issued stay, so a
-- later re-apply continues each series where it stopped and never issues a number twice.
-- The accountant loses the chart and the year-end close; the Director and the committee keep them
-- (migration 203). A personal override naming either permission is a person's own grant and stays.
-- The route that issues a journal number (src/routes/finance-ledger.js) must be rolled back with
-- this: once the series is gone, a journal sent without a number is refused by the database.
-- ── B11 (the year-end close as a draft), undone first ──────────────────────────────────────────
-- REFUSED while a closing DRAFT exists: the 203 close it falls back to tests only POSTED closings,
-- so it would raise and post a second closing while the draft could still be posted, closing the
-- book twice. Post or cancel every draft named, then run this again. The route
-- (src/routes/finance-ledger.js: close-year, the post route's closing_write, the period PATCH) and
-- src/routes/finance-accounting.js (period-readiness, year-end) must be rolled back with this file.
-- Closings already posted into a closed final period stay posted. finance.validate_ledger_entry()
-- goes back to 203's below, which admits nothing into a closed period.
DO $$
DECLARE pending text;
BEGIN
  SELECT string_agg(format('%s (authority %s)', c.voucher_no, c.authority_id), '; ' ORDER BY c.authority_id, c.voucher_no)
    INTO pending
    FROM finance.voucher c
   WHERE c.voucher_type = 'closing' AND c.status = 'draft';
  IF pending IS NOT NULL THEN
    RAISE EXCEPTION 'rollback of 242 refused: year-end closing drafts are waiting to be posted: %', pending
      USING HINT = 'Post each one (a second person) or cancel it with a reason, then run the rollback again.';
  END IF;
END $$;
DROP FUNCTION IF EXISTS finance.raise_year_closing(uuid, text, uuid, text, date);
-- 242 revoked it; before 242 the application held it through PUBLIC.
GRANT EXECUTE ON FUNCTION finance.close_ledger_year(uuid, text, uuid, uuid, text, date) TO PUBLIC;
ALTER TABLE finance.voucher DROP CONSTRAINT IF EXISTS voucher_legacy_duplicate_is_posted;

-- ── B-SOD (voucher integrity), undone next ────────────────────────────────────────────────────
-- What cannot be restored exactly:
--   * A draft discarded under B-SOD stays as a CANCELLED voucher with its number and lines. Before
--     B-SOD a discard deleted it; deleting those rows now would destroy the record of an issued
--     number, so they are kept. They post nothing and stay out of every balance.
--   * The `version` and `legacy_duplicate_reversal` columns and their values are dropped. A posted
--     reversal 242 marked as a legacy duplicate stays posted, as it was before 242.
-- REFUSED while a reversal DRAFT exists (fix round 1, review I-1): with the one-live-reversal index
-- gone, the 203 route would raise and post a second reversal of the same voucher while the draft
-- could still be posted, reversing it twice. Post or cancel every draft named, then run this again.
-- The route (src/routes/finance-ledger.js: expected_version, raise_reversal, the cancel) must be
-- rolled back with this file.
DO $$
DECLARE pending text;
BEGIN
  SELECT string_agg(format('%s (authority %s), reversing %s', r.voucher_no, r.authority_id, COALESCE(o.voucher_no, r.reverses_voucher_id::text)),
                    '; ' ORDER BY r.authority_id, r.voucher_no)
    INTO pending
    FROM finance.voucher r LEFT JOIN finance.voucher o ON o.id = r.reverses_voucher_id
   WHERE r.voucher_type = 'reversal' AND r.status = 'draft';
  IF pending IS NOT NULL THEN
    RAISE EXCEPTION 'rollback of 242 refused: reversal drafts are waiting to be posted: %', pending
      USING HINT = 'Post each one (a second person) or cancel it with a reason, then run the rollback again.';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION finance.reverse_voucher(uuid, uuid, uuid, text, date, text) TO PUBLIC;
DROP TRIGGER IF EXISTS trg_voucher_line_aa_same_authority ON finance.voucher_line;
DROP TRIGGER IF EXISTS trg_voucher_same_authority ON finance.voucher;
DROP TRIGGER IF EXISTS trg_voucher_closing_by_close_only ON finance.voucher;
DROP FUNCTION IF EXISTS finance.assert_voucher_line_same_authority();
DROP FUNCTION IF EXISTS finance.assert_voucher_same_authority();
DROP FUNCTION IF EXISTS finance.refuse_hand_closing_voucher();
DROP FUNCTION IF EXISTS finance.raise_reversal(uuid, uuid, text, date, text);
DROP INDEX IF EXISTS finance.uq_voucher_one_live_reversal;
ALTER TABLE finance.voucher DROP COLUMN IF EXISTS legacy_duplicate_reversal;
ALTER TABLE finance.voucher DROP CONSTRAINT IF EXISTS voucher_cancelled_is_attributed;
ALTER TABLE finance.voucher DROP CONSTRAINT IF EXISTS voucher_version_positive;
ALTER TABLE finance.voucher DROP COLUMN IF EXISTS version;

-- Migration 203's two integrity lookups, verbatim (without the authority test).
CREATE OR REPLACE FUNCTION finance.assert_voucher_line_account_postable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
DECLARE a record;
BEGIN
  SELECT la.code, la.is_group, la.is_postable, la.status, la.deleted_at INTO a
    FROM finance.ledger_account la WHERE la.id = NEW.ledger_account_id;
  IF NOT FOUND OR a.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'ledger account % does not exist', NEW.ledger_account_id USING ERRCODE = '23503';
  END IF;
  IF a.is_group OR NOT a.is_postable THEN
    RAISE EXCEPTION 'ledger account % is a heading and cannot be posted to', a.code
      USING ERRCODE = '23514', HINT = 'Post to a leaf account beneath it.';
  END IF;
  IF a.status <> 'active' THEN
    RAISE EXCEPTION 'ledger account % is inactive and cannot be posted to', a.code
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION finance.validate_ledger_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
DECLARE v record; p record; a record; g record;
BEGIN
  SELECT vv.currency, vv.status, vv.voucher_no, vv.voucher_type, vv.financial_year_id
    INTO v FROM finance.voucher vv WHERE vv.id = NEW.voucher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'voucher % does not exist', NEW.voucher_id USING ERRCODE = '23503';
  END IF;

  -- INVARIANT 2, at the row. The entry's currency is its voucher's currency, always.
  IF NEW.currency::text <> v.currency::text THEN
    RAISE EXCEPTION 'entry currency % does not match voucher %''s currency %',
      NEW.currency, v.voucher_no, v.currency
      USING ERRCODE = '23514',
            HINT = 'One currency per voucher (design decision 1). No rate is applied anywhere.';
  END IF;

  IF NEW.financial_year_id <> v.financial_year_id THEN
    RAISE EXCEPTION 'entry is in financial year % and voucher % is in %',
      NEW.financial_year_id, v.voucher_no, v.financial_year_id USING ERRCODE = '23514';
  END IF;

  -- G5. Posting into a closed or locked period is refused here rather than only in the posting
  -- function, so the refusal holds when the route and the function are both bypassed.
  SELECT lp.status, lp.period_no, lp.from_date, lp.to_date, lp.financial_year_id
    INTO p FROM finance.ledger_period lp WHERE lp.id = NEW.ledger_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'accounting period % does not exist', NEW.ledger_period_id USING ERRCODE = '23503';
  END IF;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'accounting period % is % and accepts no postings', p.period_no, p.status
      USING ERRCODE = '23514',
            HINT = 'Reopen the period, or post into the period the posting date falls in.';
  END IF;
  IF NEW.posting_date < p.from_date OR NEW.posting_date > p.to_date THEN
    RAISE EXCEPTION 'posting date % falls outside period % (% to %)',
      NEW.posting_date, p.period_no, p.from_date, p.to_date
      USING ERRCODE = '23514',
            HINT = 'A posting belongs to the period its date falls in. Periods tile the year exactly.';
  END IF;
  IF p.financial_year_id <> NEW.financial_year_id THEN
    RAISE EXCEPTION 'period % belongs to a different financial year than the entry', p.period_no
      USING ERRCODE = '23514';
  END IF;

  -- Nothing posts to a heading.
  SELECT la.code, la.is_group, la.is_postable, la.status INTO a
    FROM finance.ledger_account la WHERE la.id = NEW.ledger_account_id AND la.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ledger account % does not exist', NEW.ledger_account_id USING ERRCODE = '23503';
  END IF;
  IF a.is_group OR NOT a.is_postable THEN
    RAISE EXCEPTION 'ledger account % is a heading and cannot be posted to', a.code
      USING ERRCODE = '23514';
  END IF;

  -- A settlement stays inside one book: a USD receipt cannot settle a ZWG bill, because settling it
  -- would require a rate the Council has not approved.
  IF NEW.against_voucher_id IS NOT NULL THEN
    SELECT gg.currency, gg.voucher_no, gg.status INTO g
      FROM finance.voucher gg WHERE gg.id = NEW.against_voucher_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'the voucher being settled (%) does not exist', NEW.against_voucher_id
        USING ERRCODE = '23503';
    END IF;
    IF g.currency::text <> NEW.currency::text THEN
      RAISE EXCEPTION 'a % entry cannot settle voucher %, which is denominated in %',
        NEW.currency, g.voucher_no, g.currency
        USING ERRCODE = '23514',
              HINT = 'Settlement happens within one book. There is no approved conversion basis (D4).';
    END IF;
    IF g.status <> 'posted' THEN
      RAISE EXCEPTION 'voucher % is % and cannot be settled', g.voucher_no, g.status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DELETE FROM finance.role_permission
 WHERE role_name = 'accountant'
   AND permission_code IN ('finance.ledger.account.manage', 'finance.ledger.close_year');

-- The year-end close as migration 203 wrote it: any posted closing voucher, reversed or not, means
-- "already closed".
CREATE OR REPLACE FUNCTION finance.close_ledger_year(
  p_financial_year_id uuid, p_currency text, p_prepared_by uuid, p_posted_by uuid,
  p_voucher_no text, p_posting_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  y record;
  v_new uuid;
  v_surplus_account uuid;
  v_date date;
  v_line integer := 0;
  v_net numeric := 0;
  r record;
BEGIN
  SELECT fy.id, fy.label, fy.start_date, fy.end_date, fy.authority_id
    INTO y FROM finance.financial_year fy WHERE fy.id = p_financial_year_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'financial year % does not exist', p_financial_year_id USING ERRCODE = '23503';
  END IF;
  v_date := COALESCE(p_posting_date, y.end_date);

  SELECT la.id INTO v_surplus_account
    FROM finance.ledger_account la
   WHERE la.account_type = 'accumulated_surplus' AND la.deleted_at IS NULL
     AND la.is_postable AND NOT la.is_group AND la.status = 'active'
   ORDER BY la.code
   LIMIT 1;
  IF v_surplus_account IS NULL THEN
    RAISE EXCEPTION 'no postable accumulated-surplus account exists in the chart'
      USING ERRCODE = '23503',
            HINT = 'Mark the equity account that carries accumulated surplus with account_type = ''accumulated_surplus''.';
  END IF;

  IF EXISTS (SELECT 1 FROM finance.voucher
              WHERE financial_year_id = p_financial_year_id AND voucher_type = 'closing'
                AND currency::text = p_currency AND status = 'posted') THEN
    RAISE EXCEPTION 'the % book of % has already been closed', p_currency, y.label
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO finance.voucher (
    authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
    narration, status, prepared_by)
  VALUES (y.authority_id, p_voucher_no, 'closing', p_currency::finance.currency_code,
          p_financial_year_id, v_date,
          'Year-end closing of the ' || p_currency || ' book for ' || y.label, 'draft', p_prepared_by)
  RETURNING id INTO v_new;

  -- Every revenue and expense account is brought to nil by posting the opposite of its balance.
  FOR r IN
    SELECT e.ledger_account_id,
           sum(e.debit) - sum(e.credit) AS net_debit
      FROM finance.ledger_entry e
      JOIN finance.ledger_account la ON la.id = e.ledger_account_id
     WHERE e.financial_year_id = p_financial_year_id
       AND e.currency::text = p_currency
       AND la.root_type IN ('revenue', 'expense')
     GROUP BY e.ledger_account_id
    HAVING sum(e.debit) - sum(e.credit) <> 0
     ORDER BY e.ledger_account_id
  LOOP
    v_line := v_line + 1;
    INSERT INTO finance.voucher_line (
      authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
    VALUES (y.authority_id, v_new, v_line, r.ledger_account_id,
            CASE WHEN r.net_debit < 0 THEN -r.net_debit ELSE 0 END,
            CASE WHEN r.net_debit > 0 THEN  r.net_debit ELSE 0 END,
            'Closed to accumulated surplus');
    v_net := v_net + r.net_debit;
  END LOOP;

  IF v_line = 0 THEN
    -- Nothing to close. The RAISE rolls the whole transaction back, so the draft voucher inserted
    -- above goes with it rather than being left as a nil document a later reader must interpret.
    RAISE EXCEPTION 'the % book of % has no revenue or expense balance to close', p_currency, y.label
      USING ERRCODE = '23514';
  END IF;

  -- The balancing line.
  --
  -- READ THE SIGN CAREFULLY. `v_net` is the sum of the per-account NET DEBITS over revenue and
  -- expense. Revenue carries a credit balance, so a year in which revenue exceeded expenditure
  -- gives v_net a NEGATIVE value — and that is a SURPLUS, which CREDITS accumulated surplus. A
  -- positive v_net is a deficit and debits it.
  --
  -- The closing lines above already debit each revenue account and credit each expense account by
  -- its own balance, so this line must take the remaining side: the opposite sign of v_net, not
  -- the same one. Getting it the wrong way round produces a closing voucher out by twice the
  -- surplus, which the deferred balance trigger refuses — which is how this was caught.
  v_line := v_line + 1;
  INSERT INTO finance.voucher_line (
    authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
  VALUES (y.authority_id, v_new, v_line, v_surplus_account,
          CASE WHEN v_net > 0 THEN  v_net ELSE 0 END,
          CASE WHEN v_net < 0 THEN -v_net ELSE 0 END,
          CASE WHEN v_net < 0 THEN 'Surplus for ' || y.label
               ELSE 'Deficit for ' || y.label END);

  PERFORM finance.post_voucher(v_new, p_posted_by);
  RETURN v_new;
END $$;

DROP FUNCTION IF EXISTS finance.ledger_balances(uuid, date, text);
DROP FUNCTION IF EXISTS finance.year_closed(uuid, text);

-- The number series as migration 213 left them.
CREATE OR REPLACE FUNCTION finance.next_document_no(p_authority_id integer, p_kind text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_no bigint;
  v_prefix text;
BEGIN
  v_prefix := CASE p_kind WHEN 'receipt' THEN 'RC' WHEN 'cashier_session' THEN 'CS'
                          WHEN 'bank_deposit' THEN 'BD' WHEN 'opening' THEN 'OB'
                          WHEN 'supplier_invoice' THEN 'SI' WHEN 'payment' THEN 'PV'
                          WHEN 'asset' THEN 'FA' WHEN 'depreciation' THEN 'DP'
                          WHEN 'asset_disposal' THEN 'AD' END;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'no document sequence is kept for %', p_kind USING ERRCODE = '23514';
  END IF;
  INSERT INTO finance.document_sequence AS s (authority_id, kind, last_no)
  VALUES (p_authority_id, p_kind, 1)
  ON CONFLICT (authority_id, kind) DO UPDATE SET last_no = s.last_no + 1
  RETURNING s.last_no INTO v_no;
  RETURN v_prefix || '-' || lpad(v_no::text, 7, '0');
END $$;

DELETE FROM public.schema_migrations WHERE filename = '242_finance_ledger_reporting.sql';
