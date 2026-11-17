-- 242: the ledger's read side — journal number series, balances carried across financial years,
-- a year-end close that can be raised again after a reversal, and the accountant's two grants.
--
-- Design: docs/superpowers/specs/2026-11-16-accounting-workspace-design.md §2, §7.1 and §13
-- (frontend repo). Routes: src/routes/finance-ledger.js.
-- Rollback: migrations/rollback/242_finance_ledger_reporting.down.sql.
--
-- B-SOD (2026-11-17) adds the voucher-integrity section at the end of this file: finance.voucher
-- gains a `version` column, reversals are raised as drafts, a closing voucher can be raised only by
-- the close, and every voucher reference must be the voucher's own council's. See that section.
--
-- B11 (2026-11-17) adds the year-end close as a DRAFT in section 7, before the closing assertions:
-- finance.raise_year_closing(), a closing voucher prepared by one person and posted by another into
-- the year's final period once it is closed, and the one-call finance.close_ledger_year() taken
-- from the application. See that section.
--
-- NOTHING ELSE STORED CHANGES. No other column is added and no posted entry is touched. Two defects in how
-- balances are READ were latent while the ledger held one financial year:
--
--   1. BALANCES WERE NOT BROUGHT FORWARD. finance.v_trial_balance sums one financial year's
--      entries, and the year-end close posts inside the year it closes. In a second year the bank,
--      the debtors and every other balance-sheet account would restart at nil.
--   2. A CLOSED YEAR'S PERFORMANCE READ NIL. The closing voucher brings revenue and expenditure to
--      nil in the year it closes, so once a year was closed its income and expenditure could no
--      longer be printed.
--
-- finance.ledger_balances() is the answer to both, and every statement is to read it:
--
--   asset, liability, equity   every entry dated on or before the date asked for, IN ANY YEAR:
--                              a balance-sheet account is the life of the account.
--   revenue, expense           the entries of the year asked for, dated on or before that date.
--   closing = 'before'         leaves out that year's closing vouchers, and any reversal of one,
--                              ENTIRELY (the accumulated-surplus line as well as the lines that
--                              bring revenue and expenditure to nil), so the year's performance
--                              reads as it stood before the close. 'after' includes them.
--   earlier years              revenue and expenditure of earlier years that no closing voucher has
--                              brought to nil appear as ONE further row per currency, "Surplus of
--                              earlier years not yet closed". The trial balance still balances and
--                              the omission is visible rather than silent.
--
-- IT BALANCES BY CONSTRUCTION. What is read is a set of whole vouchers: every entry of the council
-- dated on or before the date, less (for 'before') whole closing vouchers. Each voucher balances in
-- its own currency (migration 203, invariants 1 and 2), so each currency's rows net to nil.
-- An account, or the earlier-years row, whose balance is nil is not returned.
--
-- finance.v_trial_balance IS LEFT EXACTLY AS IT IS for its other readers.
--
-- THE YEAR-END CLOSE AFTER A REVERSAL. finance.close_ledger_year() (migration 203) refused a second
-- close whenever a posted closing voucher existed, even one that had since been reversed, so a
-- closing raised too early could be reversed and then never raised again. The test is now
-- finance.year_closed(): a posted closing voucher that no posted reversal has undone. Nothing else
-- in that function changes.
--
-- THE GRANTS ARE A CLIENT DIRECTION OF 2026-11-16, NOT A COUNCIL RESOLUTION (COUNCIL-DECISIONS.md,
-- K5, awaiting confirmation under D21). The accountant maintains the chart and raises the year-end
-- close. Until now the chart was the Director's alone and the close the committee's alone. The
-- second-person rule is untouched: whoever raises a closing voucher cannot post it.
--
-- IDEMPOTENT. Safe to re-run.

-- ── Document numbers for the journals an accountant raises ────────────────────────────────────
-- Every kind and prefix of migration 213 is kept as it was. New: journal JV, credit note CN,
-- write-off WO and the year-end closing YC.
ALTER TABLE finance.document_sequence DROP CONSTRAINT IF EXISTS document_sequence_kind_known;
ALTER TABLE finance.document_sequence ADD CONSTRAINT document_sequence_kind_known
  CHECK (kind IN ('receipt', 'cashier_session', 'bank_deposit', 'opening',
                  'supplier_invoice', 'payment', 'asset', 'depreciation', 'asset_disposal',
                  'journal', 'credit_note', 'write_off', 'closing'));

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
                          WHEN 'asset_disposal' THEN 'AD'
                          WHEN 'journal' THEN 'JV' WHEN 'credit_note' THEN 'CN'
                          WHEN 'write_off' THEN 'WO' WHEN 'closing' THEN 'YC' END;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'no document sequence is kept for %', p_kind USING ERRCODE = '23514';
  END IF;
  INSERT INTO finance.document_sequence AS s (authority_id, kind, last_no)
  VALUES (p_authority_id, p_kind, 1)
  ON CONFLICT (authority_id, kind) DO UPDATE SET last_no = s.last_no + 1
  RETURNING s.last_no INTO v_no;
  RETURN v_prefix || '-' || lpad(v_no::text, 7, '0');
END $$;

-- ── Is this book of this year closed? ─────────────────────────────────────────────────────────
-- A posted closing voucher exists for the year and the currency, and no posted reversal has undone
-- it. The same reading of "stands" as finance.voucher_stands() (migration 214). Runs as the caller,
-- so the tenant policies on finance.voucher decide which vouchers are seen.
CREATE OR REPLACE FUNCTION finance.year_closed(p_financial_year_id uuid, p_currency text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM finance.voucher c
     WHERE c.financial_year_id = p_financial_year_id AND c.voucher_type = 'closing'
       AND c.currency::text = p_currency AND c.status = 'posted'
       AND NOT EXISTS (SELECT 1 FROM finance.voucher r
                        WHERE r.reverses_voucher_id = c.id AND r.status = 'posted'))
$$;

COMMENT ON FUNCTION finance.year_closed(uuid, text) IS
  'True when one currency''s book of a financial year is closed: a posted closing voucher exists '
  'for it and no posted reversal of that voucher does. A closing that was reversed reads as not '
  'closed, and the year can be closed again.';

-- ── The balances every statement reads ────────────────────────────────────────────────────────
-- STABLE, and SECURITY INVOKER on purpose (the same choice as finance.post_voucher and the views of
-- migration 203): the caller's row-level security decides which rows are read. The explicit test
-- on the year's own authority is there for a caller that bypasses row-level security (the owner, a
-- background job), so a balance can never combine two councils' books.
--
-- Financial years do not overlap (the route that creates one refuses it), so an entry dated on or
-- before this year's end belongs to this year or to an earlier one.
CREATE OR REPLACE FUNCTION finance.ledger_balances(
  p_financial_year_id uuid, p_as_at date DEFAULT NULL, p_closing text DEFAULT 'after')
RETURNS TABLE (currency text, ledger_account_id uuid, account_code text, account_name text,
               root_type text, report_type text, account_type text, entry_count int,
               debit_total numeric, credit_total numeric, net_debit numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
  y record;
  v_as_at date;
BEGIN
  IF p_closing IS NULL OR p_closing NOT IN ('before', 'after') THEN
    RAISE EXCEPTION 'closing must be ''before'' or ''after'', not %', COALESCE(quote_literal(p_closing), 'NULL')
      USING ERRCODE = '22023';
  END IF;

  SELECT fy.id, fy.authority_id, fy.start_date, fy.end_date
    INTO y FROM finance.financial_year fy WHERE fy.id = p_financial_year_id;
  -- A year that does not exist, or that the caller may not see, has no balances.
  IF NOT FOUND THEN RETURN; END IF;

  -- No date, or a date beyond the year, reads as the year end.
  v_as_at := LEAST(COALESCE(p_as_at, y.end_date), y.end_date);

  RETURN QUERY
  WITH left_out AS (
    -- 'before': this year's closing vouchers, and the reversals of them. Whole vouchers, so what
    -- remains still balances.
    SELECT c.id
      FROM finance.voucher c
     WHERE p_closing = 'before' AND c.financial_year_id = y.id AND c.voucher_type = 'closing'
    UNION ALL
    SELECT r.id
      FROM finance.voucher r
      JOIN finance.voucher c ON c.id = r.reverses_voucher_id
     WHERE p_closing = 'before' AND r.voucher_type = 'reversal'
       AND c.financial_year_id = y.id AND c.voucher_type = 'closing'
  ),
  kept AS (
    SELECT e.currency::text AS book, e.ledger_account_id AS account_id,
           e.debit::numeric AS debit, e.credit::numeric AS credit,
           la.code, la.name, la.root_type AS root, la.report_type AS report, la.account_type AS behaviour,
           CASE WHEN la.root_type IN ('asset', 'liability', 'equity') THEN 'carried'
                WHEN e.financial_year_id = y.id THEN 'this_year'
                WHEN ey.start_date < y.start_date THEN 'earlier_year' END AS part
      FROM finance.ledger_entry e
      JOIN finance.ledger_account la ON la.id = e.ledger_account_id
      JOIN finance.financial_year ey ON ey.id = e.financial_year_id
     WHERE e.authority_id = y.authority_id
       AND e.posting_date <= v_as_at
       AND NOT EXISTS (SELECT 1 FROM left_out x WHERE x.id = e.voucher_id)
  )
  SELECT k.book, k.account_id, k.code, k.name, k.root, k.report, k.behaviour,
         count(*)::int, sum(k.debit), sum(k.credit), sum(k.debit) - sum(k.credit)
    FROM kept k
   WHERE k.part IN ('carried', 'this_year')
   GROUP BY k.book, k.account_id, k.code, k.name, k.root, k.report, k.behaviour
  HAVING sum(k.debit) <> sum(k.credit)
  UNION ALL
  -- Revenue and expenditure of earlier years that nothing has closed. Once each of those years is
  -- closed this nets to nil and the row is gone.
  SELECT k.book, NULL::uuid, NULL::text, 'Surplus of earlier years not yet closed'::text,
         'equity'::text, 'balance_sheet'::text, 'unclosed_surplus'::text,
         count(*)::int, sum(k.debit), sum(k.credit), sum(k.debit) - sum(k.credit)
    FROM kept k
   WHERE k.part = 'earlier_year'
   GROUP BY k.book
  HAVING sum(k.debit) <> sum(k.credit)
   ORDER BY 1, 3 NULLS LAST;
END $$;

COMMENT ON FUNCTION finance.ledger_balances(uuid, date, text) IS
  'The balance of each ledger account that a statement of one financial year needs, per currency '
  'and never across them. Balance-sheet accounts carry every entry to the date in any year; revenue '
  'and expense carry that year''s entries to the date. closing = ''before'' leaves out the year''s '
  'closing vouchers and their reversals, ''after'' includes them. Revenue and expense of earlier '
  'years not yet closed appear as one row per currency with no account (account_type '
  '''unclosed_surplus''). net_debit is signed debit-positive; nil balances are not returned. Each '
  'currency''s rows net to nil. Runs with the caller''s rights.';

-- ── The year-end close: the same function as migration 203, with one test changed ─────────────
-- "Already closed" is now finance.year_closed(), so a closing that was reversed can be raised
-- again. B-SOD adds the two set_config lines around the INSERT, which let the closing voucher past
-- finance.refuse_hand_closing_voucher(). B11 adds the IF around the balancing line (review I1).
-- Every other line is migration 203's.
-- B11: this one-call close (raise AND post in a named person's name) is no longer the
-- application's. The route raises a draft with finance.raise_year_closing() (section 7 below), and
-- EXECUTE on this function is revoked from the application role there. It is kept, unchanged, for
-- scripts/verify-ledger-invariants.js (G10), which runs as the schema owner.
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

  IF finance.year_closed(p_financial_year_id, p_currency) THEN
    RAISE EXCEPTION 'the % book of % has already been closed', p_currency, y.label
      USING ERRCODE = '23514';
  END IF;

  -- B-SOD: a closing voucher may be inserted only here (finance.refuse_hand_closing_voucher below).
  -- Set for this one INSERT and cleared at once; a RAISE later rolls the setting back with it.
  PERFORM set_config('finance.closing_write', 'on', true);
  INSERT INTO finance.voucher (
    authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
    narration, status, prepared_by)
  VALUES (y.authority_id, p_voucher_no, 'closing', p_currency::finance.currency_code,
          p_financial_year_id, v_date,
          'Year-end closing of the ' || p_currency || ' book for ' || y.label, 'draft', p_prepared_by)
  RETURNING id INTO v_new;
  PERFORM set_config('finance.closing_write', 'off', true);

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
  -- B11 review I1: no balancing line when revenue and expense net to nil (a 0/0 line breaks
  -- voucher_line_one_side_only).
  IF v_net <> 0 THEN
    v_line := v_line + 1;
    INSERT INTO finance.voucher_line (
      authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
    VALUES (y.authority_id, v_new, v_line, v_surplus_account,
            CASE WHEN v_net > 0 THEN  v_net ELSE 0 END,
            CASE WHEN v_net < 0 THEN -v_net ELSE 0 END,
            CASE WHEN v_net < 0 THEN 'Surplus for ' || y.label
                 ELSE 'Deficit for ' || y.label END);
  END IF;

  PERFORM finance.post_voucher(v_new, p_posted_by);
  RETURN v_new;
END $$;

-- ── Grants: the accountant keeps the chart and raises the year-end close ──────────────────────
-- Both permissions exist since migration 203; no new code is seeded. finance.ledger.close_year is
-- an approval, so the assertion below is what confirms the accountant holds nothing that publishes.
INSERT INTO finance.role_permission (role_name, permission_code)
SELECT r, c FROM (VALUES
  ('accountant', 'finance.ledger.account.manage'), ('accountant', 'finance.ledger.close_year')
) AS t(r, c)
ON CONFLICT (role_name, permission_code) DO NOTHING;

DO $$
DECLARE offender text;
BEGIN
  SELECT rp.role_name INTO offender
    FROM finance.role_permission rp JOIN finance.permission p ON p.code = rp.permission_code
   GROUP BY rp.role_name HAVING bool_or(p.is_approval) AND bool_or(p.is_publication) LIMIT 1;
  IF offender IS NOT NULL THEN
    RAISE EXCEPTION 'role % would hold both an approval and a publication permission; separation of duties forbids it', offender;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- B-SOD: SEGREGATION OF DUTIES AND VOUCHER INTEGRITY (2026-11-17)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- From the accounting audit (M3, M4, M5, M8) and the security audit (C1, H1 to H4, Medium M3) of
-- 2026-11-16. The route half is in src/routes/finance-ledger.js. What changes here:
--
--   1. finance.voucher.version, the version a poster reviewed. PATCH bumps it; the post route
--      refuses a posting whose expected_version, when sent, is not the current one (H3).
--   2. A cancelled voucher names who cancelled it and when (M8: a discarded draft is now kept,
--      marked cancelled, with its number and lines; it is no longer deleted).
--   3. A reversal is raised as a DRAFT by finance.raise_reversal() and posted by somebody else
--      through finance.post_voucher(), like any other voucher (C1, M3). finance.reverse_voucher()
--      of migration 203 is kept, unchanged, for the scripts that call it
--      (verify-ledger-invariants.js, verify-rates-invariants.js, seed-general-ledger-demo.js).
--      At most one reversal of a voucher may be live (draft or posted) at a time.
--   4. A 'closing' voucher can be inserted only by finance.close_ledger_year() (H4).
--   5. A voucher, and each of its lines, may cite only rows of its own council: year, period,
--      reversed voucher, ledger account, party, settled voucher, department, programme, activity,
--      project and budget line (H2). The two SECURITY DEFINER integrity triggers of migration 203
--      that looked rows up past row-level security now name the authority as well.
--   6. finance.reverse_voucher() is no longer executable by the application role (fix round 1).
--
-- A refusal for a row of another council says it "is not in this council's records", and the
-- same sentence is used for a row that does not exist at all, so a refusal cannot be used to learn
-- what another council holds (security audit L6).

-- ── 1. The version a poster reviewed ──────────────────────────────────────────────────────────
ALTER TABLE finance.voucher ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE finance.voucher DROP CONSTRAINT IF EXISTS voucher_version_positive;
ALTER TABLE finance.voucher ADD CONSTRAINT voucher_version_positive CHECK (version >= 1);
COMMENT ON COLUMN finance.voucher.version IS
  'Raised by one on every edit of a draft. The post route is sent the version the poster reviewed '
  'and refuses the posting if the draft has changed since (security audit H3).';

-- ── 2. A cancelled voucher is attributed ──────────────────────────────────────────────────────
-- The columns exist since migration 203 and were never written by the ledger route. NOT VALID: the
-- rule binds every row written from now on without judging old rows (there should be none: the
-- only earlier writers, 206/207 and finance-rates.js, set all three columns).
ALTER TABLE finance.voucher DROP CONSTRAINT IF EXISTS voucher_cancelled_is_attributed;
ALTER TABLE finance.voucher ADD CONSTRAINT voucher_cancelled_is_attributed CHECK (
  status <> 'cancelled' OR (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL)) NOT VALID;

-- ── 3. One live reversal per voucher, and a reversal raised as a draft ───────────────────────
-- Until now a reversal was raised and posted in one call, so "already reversed" could be tested
-- on posted reversals alone. A draft reversal waits for a second person; two drafts of the same
-- reversal could otherwise both be posted. Hence uq_voucher_one_live_reversal below.
--
-- WHAT A DATABASE MAY ALREADY HOLD (fix round 1, review I-2). Before 242 a duplicate can only be
-- two POSTED reversals of one voucher, from two finance.reverse_voucher() calls racing (it tests
-- for a posted reversal without a lock). A DRAFT duplicate needs a hand-inserted draft reversal.
--   * Draft duplicates: the migration stops and names every one ("cancel draft N"). Cancelling a
--     draft is a person's act with a reason, so the migration does not do it for them.
--   * Posted duplicates: posted entries cannot be undone here, and refusing would leave 242
--     unappliable for good. Each later posted reversal of a voucher is marked
--     legacy_duplicate_reversal = true and named in a NOTICE; the index leaves marked rows out, so
--     they stand, stay visible, and every NEW duplicate is refused. Each needs a correcting
--     journal (its effect is the original's entries reversed a second time).
ALTER TABLE finance.voucher ADD COLUMN IF NOT EXISTS legacy_duplicate_reversal boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN finance.voucher.legacy_duplicate_reversal IS
  'True on a posted reversal that migration 242 found to be the second (or later) posted reversal '
  'of the same voucher, made before reversals were limited to one. It stands in the ledger and '
  'needs a correcting journal; it is left out of uq_voucher_one_live_reversal.';

DO $$
DECLARE
  drafts text;
  posted text;
BEGIN
  -- Every draft reversal that has another live reversal of the same voucher beside it.
  SELECT string_agg(format('cancel draft %s (authority %s), a second reversal of %s', r.voucher_no, r.authority_id, o.voucher_no),
                    '; ' ORDER BY r.authority_id, r.voucher_no)
    INTO drafts
    FROM finance.voucher r
    JOIN finance.voucher o ON o.id = r.reverses_voucher_id
   WHERE r.status = 'draft'
     AND EXISTS (SELECT 1 FROM finance.voucher x
                  WHERE x.reverses_voucher_id = r.reverses_voucher_id AND x.id <> r.id
                    AND x.status IN ('draft', 'posted') AND NOT x.legacy_duplicate_reversal);
  IF drafts IS NOT NULL THEN
    RAISE EXCEPTION '242 cannot limit reversals to one per voucher while duplicate draft reversals exist: %', drafts
      USING HINT = 'Cancel each draft named (status cancelled, with cancelled_by, cancelled_at and a reason), then apply 242 again.';
  END IF;

  -- Every posted reversal after the first of the same voucher: marked, and named with the one kept.
  WITH ranked AS (
    SELECT r.id, r.voucher_no, r.authority_id, r.reverses_voucher_id,
           first_value(r.voucher_no) OVER w AS kept_no,
           row_number() OVER w AS rn
      FROM finance.voucher r
     WHERE r.status = 'posted' AND r.reverses_voucher_id IS NOT NULL AND NOT r.legacy_duplicate_reversal
    WINDOW w AS (PARTITION BY r.reverses_voucher_id ORDER BY r.posted_at, r.created_at, r.id)
  ), marked AS (
    UPDATE finance.voucher v SET legacy_duplicate_reversal = true
      FROM ranked k WHERE k.id = v.id AND k.rn > 1
    RETURNING v.id
  )
  SELECT string_agg(format('%s and %s both reverse %s (authority %s): %s is marked legacy_duplicate_reversal and needs a correcting journal',
                           k.kept_no, k.voucher_no, o.voucher_no, k.authority_id, k.voucher_no),
                    '; ' ORDER BY k.authority_id, k.voucher_no)
    INTO posted
    FROM ranked k JOIN marked m ON m.id = k.id JOIN finance.voucher o ON o.id = k.reverses_voucher_id;
  IF posted IS NOT NULL THEN
    RAISE NOTICE '242: posted duplicate reversals found and left standing: %', posted;
  END IF;
END $$;

-- Re-created on every run so its predicate is always this one (it once had no legacy exclusion).
DROP INDEX IF EXISTS finance.uq_voucher_one_live_reversal;
CREATE UNIQUE INDEX uq_voucher_one_live_reversal ON finance.voucher (reverses_voucher_id)
  WHERE reverses_voucher_id IS NOT NULL AND status IN ('draft', 'posted') AND NOT legacy_duplicate_reversal;

-- Only a POSTED reversal is ever marked (the DO block above marks posted rows alone), and a posted
-- voucher never changes status again, so the mark can never stand on a draft that the index would
-- then let a second live reversal sit beside (B-SOD review N2). Every row satisfies it when it is added.
ALTER TABLE finance.voucher DROP CONSTRAINT IF EXISTS voucher_legacy_duplicate_is_posted;
ALTER TABLE finance.voucher ADD CONSTRAINT voucher_legacy_duplicate_is_posted
  CHECK (NOT legacy_duplicate_reversal OR status = 'posted');

-- The same reversal as finance.reverse_voucher() (migration 203), stopping at the draft. SECURITY
-- INVOKER: the caller's row-level security decides which voucher can be reversed, and the FOR
-- UPDATE needs the write policy, so another council's voucher reads as not existing.
-- Left blank, the number is `<original>-R`, or `-R2`, `-R3`, … when that is taken (a cancelled
-- earlier reversal keeps its number; security audit L4: a typed `<original>-R` cannot block it).
CREATE OR REPLACE FUNCTION finance.raise_reversal(
  p_voucher_id uuid, p_prepared_by uuid, p_reason text,
  p_posting_date date DEFAULT NULL, p_voucher_no text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v record;
  live record;
  v_new uuid;
  v_no text;
  v_n integer := 1;
BEGIN
  SELECT * INTO v FROM finance.voucher WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'voucher % does not exist', p_voucher_id USING ERRCODE = '23503';
  END IF;
  IF v.status <> 'posted' THEN
    RAISE EXCEPTION 'voucher % is % and only a posted voucher can be reversed', v.voucher_no, v.status
      USING ERRCODE = '23514';
  END IF;
  SELECT r.voucher_no, r.status INTO live FROM finance.voucher r
   WHERE r.reverses_voucher_id = p_voucher_id AND r.status IN ('draft', 'posted') LIMIT 1;
  IF FOUND AND live.status = 'posted' THEN
    RAISE EXCEPTION 'voucher % has already been reversed', v.voucher_no
      USING ERRCODE = '23514',
            HINT = 'Reversing a reversal would restore the original. Raise a fresh voucher instead.';
  END IF;
  IF FOUND THEN
    RAISE EXCEPTION 'voucher % already has a reversal, %, waiting to be posted', v.voucher_no, live.voucher_no
      USING ERRCODE = '23514',
            HINT = 'Have it posted from the To post queue, or discard it and raise the reversal again.';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'a reversal needs a reason, which goes on the record' USING ERRCODE = '23502';
  END IF;
  -- B12 (B11 review N1): a reversal of a year-end closing is dated the closing's own day, so every
  -- closing-kind posting touches only the year's final period. The route refuses it first; this is
  -- the same rule for any other caller.
  IF v.voucher_type = 'closing' AND p_posting_date IS NOT NULL AND p_posting_date <> v.posting_date THEN
    RAISE EXCEPTION 'a reversal of the year-end closing % is dated the same day as the closing, %, not %',
      v.voucher_no, v.posting_date, p_posting_date
      USING ERRCODE = '22023', HINT = 'Leave the date out, or give the closing''s own date.';
  END IF;

  IF p_voucher_no IS NOT NULL THEN
    v_no := p_voucher_no;
  ELSE
    v_no := v.voucher_no || '-R';
    WHILE EXISTS (SELECT 1 FROM finance.voucher x WHERE x.authority_id = v.authority_id AND x.voucher_no = v_no) LOOP
      v_n := v_n + 1;
      v_no := v.voucher_no || '-R' || v_n;
    END LOOP;
  END IF;

  INSERT INTO finance.voucher (
    authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
    narration, reference, status, reverses_voucher_id, prepared_by)
  VALUES (v.authority_id, v_no, 'reversal', v.currency, v.financial_year_id,
          COALESCE(p_posting_date, v.posting_date), btrim(p_reason), v.reference, 'draft', v.id, p_prepared_by)
  RETURNING id INTO v_new;

  -- Debit and credit swapped; every other column carried over, as in finance.reverse_voucher().
  INSERT INTO finance.voucher_line (
    authority_id, voucher_id, line_no, ledger_account_id, debit, credit, party_id,
    department_id, programme_id, activity_id, ward_code, project_id, budget_line_id,
    against_voucher_id, narration)
  SELECT v.authority_id, v_new, l.line_no, l.ledger_account_id, l.credit, l.debit, l.party_id,
         l.department_id, l.programme_id, l.activity_id, l.ward_code, l.project_id,
         l.budget_line_id, l.against_voucher_id,
         'Reversal of ' || v.voucher_no || COALESCE(': ' || l.narration, '')
    FROM finance.voucher_line l
   WHERE l.voucher_id = v.id
   ORDER BY l.line_no;

  RETURN v_new;
END $$;

COMMENT ON FUNCTION finance.raise_reversal(uuid, uuid, text, date, text) IS
  'Raises a DRAFT reversal of a posted voucher, prepared by the caller, with debit and credit '
  'swapped. It posts nothing: somebody other than the preparer posts it with finance.post_voucher() '
  '(accounting audit M3, security audit C1). At most one reversal of a voucher may be live.';

-- ── 4. A closing voucher is raised only by the year-end close ────────────────────────────────
-- A hand-typed 'closing' journal would make finance.year_closed() true and drop out of every
-- 'before' statement (accounting audit M5, security audit H4). finance.close_ledger_year() above,
-- and finance.raise_year_closing() (section 7), set finance.closing_write for their one INSERT, as
-- 213's functions set finance.document_write.
CREATE OR REPLACE FUNCTION finance.refuse_hand_closing_voucher() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.voucher_type = 'closing'
     AND COALESCE(current_setting('finance.closing_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'a year-end closing voucher is raised only by the year-end close'
      USING ERRCODE = '23514', HINT = 'Close the year under Period Close; a closing voucher cannot be typed.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_voucher_closing_by_close_only ON finance.voucher;
CREATE TRIGGER trg_voucher_closing_by_close_only
  BEFORE INSERT OR UPDATE OF voucher_type ON finance.voucher
  FOR EACH ROW EXECUTE FUNCTION finance.refuse_hand_closing_voucher();

-- ── 5. Every reference stays inside the voucher's own council ────────────────────────────────
-- Plain foreign keys are checked without row-level security, so until now a line could cite
-- another council's account, party, bill or budget line, and a voucher another council's year
-- (security audit H2). SECURITY DEFINER so the test sees the row wherever it is, and every lookup
-- names NEW.authority_id explicitly.
CREATE OR REPLACE FUNCTION finance.assert_voucher_same_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM finance.financial_year y
                  WHERE y.id = NEW.financial_year_id AND y.authority_id = NEW.authority_id) THEN
    RAISE EXCEPTION 'voucher % names a financial year that is not in this council''s records', NEW.voucher_no
      USING ERRCODE = '23503';
  END IF;
  IF NEW.ledger_period_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM finance.ledger_period p WHERE p.id = NEW.ledger_period_id AND p.authority_id = NEW.authority_id) THEN
    RAISE EXCEPTION 'voucher % names an accounting period that is not in this council''s records', NEW.voucher_no
      USING ERRCODE = '23503';
  END IF;
  IF NEW.reverses_voucher_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM finance.voucher o WHERE o.id = NEW.reverses_voucher_id AND o.authority_id = NEW.authority_id) THEN
    RAISE EXCEPTION 'voucher % reverses a voucher that is not in this council''s records', NEW.voucher_no
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_voucher_same_authority ON finance.voucher;
CREATE TRIGGER trg_voucher_same_authority
  BEFORE INSERT OR UPDATE OF financial_year_id, ledger_period_id, reverses_voucher_id, authority_id ON finance.voucher
  FOR EACH ROW EXECUTE FUNCTION finance.assert_voucher_same_authority();

CREATE OR REPLACE FUNCTION finance.assert_voucher_line_same_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
DECLARE
  v_what text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM finance.voucher v WHERE v.id = NEW.voucher_id AND v.authority_id = NEW.authority_id) THEN
    v_what := 'voucher';
  ELSIF NOT EXISTS (SELECT 1 FROM finance.ledger_account x
                     WHERE x.id = NEW.ledger_account_id AND x.authority_id = NEW.authority_id) THEN
    v_what := 'ledger account';
  ELSIF NEW.party_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM finance.party x WHERE x.id = NEW.party_id AND x.authority_id = NEW.authority_id) THEN
    v_what := 'party';
  ELSIF NEW.against_voucher_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM finance.voucher x WHERE x.id = NEW.against_voucher_id AND x.authority_id = NEW.authority_id) THEN
    v_what := 'voucher to settle';
  ELSIF NEW.department_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM finance.department x WHERE x.id = NEW.department_id AND x.authority_id = NEW.authority_id) THEN
    v_what := 'department';
  ELSIF NEW.programme_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM finance.programme x WHERE x.id = NEW.programme_id AND x.authority_id = NEW.authority_id) THEN
    v_what := 'programme';
  ELSIF NEW.activity_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM finance.activity x WHERE x.id = NEW.activity_id AND x.authority_id = NEW.authority_id) THEN
    v_what := 'activity';
  ELSIF NEW.project_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM finance.project x WHERE x.id = NEW.project_id AND x.authority_id = NEW.authority_id) THEN
    v_what := 'project';
  ELSIF NEW.budget_line_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM finance.budget_line x WHERE x.id = NEW.budget_line_id AND x.authority_id = NEW.authority_id) THEN
    v_what := 'budget line';
  END IF;
  IF v_what IS NOT NULL THEN
    RAISE EXCEPTION 'line % names % % that is not in this council''s records', NEW.line_no,
      CASE WHEN v_what ~ '^[aeiou]' THEN 'an' ELSE 'a' END, v_what
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;

-- Named to sort FIRST among the line triggers (Postgres fires same-timing triggers in name order:
-- "aa" before "account_postable", "document_guard", "draft_only"), so a foreign row is refused
-- here before any of those triggers can name its code, type or status (security audit L6).
DROP TRIGGER IF EXISTS trg_voucher_line_aa_same_authority ON finance.voucher_line;
CREATE TRIGGER trg_voucher_line_aa_same_authority
  BEFORE INSERT OR UPDATE ON finance.voucher_line
  FOR EACH ROW EXECUTE FUNCTION finance.assert_voucher_line_same_authority();

-- Migration 203's two SECURITY DEFINER lookups, with the authority named. Only the WHERE clauses
-- change; every message is 203's.
CREATE OR REPLACE FUNCTION finance.assert_voucher_line_account_postable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
DECLARE a record;
BEGIN
  SELECT la.code, la.is_group, la.is_postable, la.status, la.deleted_at INTO a
    FROM finance.ledger_account la WHERE la.id = NEW.ledger_account_id AND la.authority_id = NEW.authority_id;
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
DECLARE v record; p record; a record; g record; v_what text; v_closing_kind boolean;
BEGIN
  SELECT vv.currency, vv.status, vv.voucher_no, vv.voucher_type, vv.financial_year_id, vv.reverses_voucher_id
    INTO v FROM finance.voucher vv WHERE vv.id = NEW.voucher_id AND vv.authority_id = NEW.authority_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'voucher % does not exist', NEW.voucher_id USING ERRCODE = '23503';
  END IF;

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

  -- A closing, or the reversal of one (B11).
  v_closing_kind := v.voucher_type = 'closing'
    OR (v.voucher_type = 'reversal' AND EXISTS (
          SELECT 1 FROM finance.voucher o
           WHERE o.id = v.reverses_voucher_id AND o.authority_id = NEW.authority_id
             AND o.voucher_type = 'closing'));
  -- For those, the period row is read FOR SHARE (B11 review I2), so a concurrent lock or reopen of
  -- the period (the PATCH takes it FOR UPDATE) waits for this posting, or this posting waits for it
  -- and reads the status it left. Other postings read it as before.
  IF v_closing_kind THEN
    SELECT lp.status, lp.period_no, lp.from_date, lp.to_date, lp.financial_year_id
      INTO p FROM finance.ledger_period lp WHERE lp.id = NEW.ledger_period_id AND lp.authority_id = NEW.authority_id
      FOR SHARE;
  ELSE
    SELECT lp.status, lp.period_no, lp.from_date, lp.to_date, lp.financial_year_id
      INTO p FROM finance.ledger_period lp WHERE lp.id = NEW.ledger_period_id AND lp.authority_id = NEW.authority_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'accounting period % does not exist', NEW.ledger_period_id USING ERRCODE = '23503';
  END IF;
  -- B11: the one exception. A year-end closing, or the reversal of one, posts into the year's FINAL
  -- period (the one holding its last day, which is the closing's date) once that period is CLOSED,
  -- while the post route has finance.closing_write on. A locked period takes nothing, and no other
  -- voucher enters a closed period.
  IF p.status <> 'open' AND NOT (
       p.status = 'closed'
       AND COALESCE(current_setting('finance.closing_write', true), '') = 'on'
       AND v_closing_kind
       AND EXISTS (SELECT 1 FROM finance.financial_year fy
                    WHERE fy.id = NEW.financial_year_id AND fy.authority_id = NEW.authority_id
                      AND fy.end_date = NEW.posting_date AND p.to_date = fy.end_date)) THEN
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

  SELECT la.code, la.is_group, la.is_postable, la.status INTO a
    FROM finance.ledger_account la
   WHERE la.id = NEW.ledger_account_id AND la.deleted_at IS NULL AND la.authority_id = NEW.authority_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ledger account % does not exist', NEW.ledger_account_id USING ERRCODE = '23503';
  END IF;
  IF a.is_group OR NOT a.is_postable THEN
    RAISE EXCEPTION 'ledger account % is a heading and cannot be posted to', a.code
      USING ERRCODE = '23514';
  END IF;

  -- B-SOD fix round 1 (review I-3): the entry's own line is a line of its own voucher, and every
  -- analysis reference is the entry's own council's. post_voucher copies these from the line,
  -- which the line trigger already holds to; this holds the ledger itself to it on any path.
  IF NOT EXISTS (SELECT 1 FROM finance.voucher_line vl
                  WHERE vl.id = NEW.voucher_line_id AND vl.voucher_id = NEW.voucher_id
                    AND vl.authority_id = NEW.authority_id) THEN
    RAISE EXCEPTION 'entry of voucher % names a voucher line that is not a line of that voucher', v.voucher_no
      USING ERRCODE = '23514';
  END IF;
  IF NEW.party_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM finance.party x WHERE x.id = NEW.party_id AND x.authority_id = NEW.authority_id) THEN
    v_what := 'party';
  ELSIF NEW.department_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM finance.department x WHERE x.id = NEW.department_id AND x.authority_id = NEW.authority_id) THEN
    v_what := 'department';
  ELSIF NEW.programme_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM finance.programme x WHERE x.id = NEW.programme_id AND x.authority_id = NEW.authority_id) THEN
    v_what := 'programme';
  ELSIF NEW.activity_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM finance.activity x WHERE x.id = NEW.activity_id AND x.authority_id = NEW.authority_id) THEN
    v_what := 'activity';
  ELSIF NEW.project_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM finance.project x WHERE x.id = NEW.project_id AND x.authority_id = NEW.authority_id) THEN
    v_what := 'project';
  ELSIF NEW.budget_line_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM finance.budget_line x WHERE x.id = NEW.budget_line_id AND x.authority_id = NEW.authority_id) THEN
    v_what := 'budget line';
  END IF;
  IF v_what IS NOT NULL THEN
    RAISE EXCEPTION 'entry of voucher % names % % that is not in this council''s records', v.voucher_no,
      CASE WHEN v_what ~ '^[aeiou]' THEN 'an' ELSE 'a' END, v_what
      USING ERRCODE = '23503';
  END IF;

  IF NEW.against_voucher_id IS NOT NULL THEN
    SELECT gg.currency, gg.voucher_no, gg.status INTO g
      FROM finance.voucher gg WHERE gg.id = NEW.against_voucher_id AND gg.authority_id = NEW.authority_id;
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

-- ── 6. The one-call reversal is no longer the application's (fix round 1, review M-2) ─────────
-- finance.reverse_voucher() (203) raises AND posts a reversal in one call, naming the poster as an
-- argument: exactly the single-handed reversal C1 removed from the route. No route calls it any
-- more (src/routes/finance-ledger.js uses finance.raise_reversal). Its remaining callers are
-- scripts/verify-ledger-invariants.js, verify-rates-invariants.js and seed-general-ledger-demo.js,
-- which connect with DATABASE_URL as the schema owner (the role that runs these migrations); an
-- owner keeps EXECUTE whatever is revoked. Nothing in this schema grants finance functions
-- explicitly: the application role held it through PUBLIC, so the revoke is from PUBLIC, and from
-- vungu_app in case it was ever granted by hand.
REVOKE EXECUTE ON FUNCTION finance.reverse_voucher(uuid, uuid, uuid, text, date, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    REVOKE EXECUTE ON FUNCTION finance.reverse_voucher(uuid, uuid, uuid, text, date, text) FROM vungu_app;
  END IF;
END $$;

-- ── 7. The year-end close is a draft that somebody else posts (B11, 2026-11-17) ──────────────
-- From the accounting audit (M1, M2, M6, S10) and the security audit (C2, M1). The ruling "B11
-- design" of 2026-11-17:
--   * finance.raise_year_closing() writes the closing of one book as a DRAFT prepared by the caller,
--     numbered from the YC series when no number is given. It posts nothing. Somebody else posts it
--     through finance.post_voucher(), which refuses its preparer: nobody is named as poster, and no
--     posting is made in the name of somebody who did not act (M2, C2).
--   * It is dated the year's last day and nothing else (S10), and raised only when every period of
--     the year is closed. The closing then posts into the FINAL period although that period is
--     closed: finance.validate_ledger_entry() (section 5) admits a closing, or the reversal of one,
--     into the closed final period while finance.closing_write is on, which the post route sets for
--     those two kinds only. A locked final period takes nothing, so the close is refused there (M1).
--   * It closes what is LEFT: the year's revenue and expense net of every closing posted so far. A
--     book already closed may be closed again when a remainder is left, and the second closing takes
--     the remainder only; with nothing left the close is refused (M6). A closing of the book already
--     waiting to be posted is refused, so two drafts cannot both post.
--   * Every row it reads is the year's own council's, named explicitly: under row-level security a
--     member council can read a combination authority's rows (security audit M1).
CREATE OR REPLACE FUNCTION finance.raise_year_closing(
  p_financial_year_id uuid, p_currency text, p_prepared_by uuid,
  p_voucher_no text DEFAULT NULL, p_posting_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  y record;
  fp record;
  v_open text;
  v_pending text;
  v_surplus_account uuid;
  v_no text;
  v_new uuid;
  v_line integer := 0;
  v_net numeric := 0;
  r record;
BEGIN
  SELECT fy.id, fy.label, fy.start_date, fy.end_date, fy.authority_id
    INTO y FROM finance.financial_year fy WHERE fy.id = p_financial_year_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'financial year % does not exist', p_financial_year_id USING ERRCODE = '23503';
  END IF;

  -- S10: the closing is dated the year's last day, the date every 'after' statement reads it at.
  IF p_posting_date IS NOT NULL AND p_posting_date <> y.end_date THEN
    RAISE EXCEPTION 'a year-end closing is dated the last day of the year, %, not %', y.end_date, p_posting_date
      USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(lp.period_no::text, ', ' ORDER BY lp.period_no) INTO v_open
    FROM finance.ledger_period lp
   WHERE lp.financial_year_id = y.id AND lp.authority_id = y.authority_id AND lp.status = 'open';
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'every period of % must be closed before its year end; still open: %', y.label, v_open
      USING ERRCODE = '23514', HINT = 'Close each period under Period Close, then raise the year end.';
  END IF;

  -- The period the closing will post into: the one finance.post_voucher() chooses for the last day.
  SELECT lp.period_no, lp.status INTO fp
    FROM finance.ledger_period lp
   WHERE lp.financial_year_id = y.id AND lp.authority_id = y.authority_id
     AND y.end_date BETWEEN lp.from_date AND lp.to_date
   ORDER BY lp.period_no
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no accounting period of this financial year contains %', y.end_date
      USING ERRCODE = '23514', HINT = 'Open the periods for the year first; they must tile it exactly.';
  END IF;
  IF fp.status = 'locked' THEN
    RAISE EXCEPTION 'period % of % is locked, so no year-end closing can be posted into it', fp.period_no, y.label
      USING ERRCODE = '23514';
  END IF;

  SELECT la.id INTO v_surplus_account
    FROM finance.ledger_account la
   WHERE la.authority_id = y.authority_id
     AND la.account_type = 'accumulated_surplus' AND la.deleted_at IS NULL
     AND la.is_postable AND NOT la.is_group AND la.status = 'active'
   ORDER BY la.code
   LIMIT 1;
  IF v_surplus_account IS NULL THEN
    RAISE EXCEPTION 'no postable accumulated-surplus account exists in the chart'
      USING ERRCODE = '23503',
            HINT = 'Mark the equity account that carries accumulated surplus with account_type = ''accumulated_surplus''.';
  END IF;

  -- One closing of a book waiting at a time. Two raised at once wait for each other here.
  PERFORM pg_advisory_xact_lock(hashtext('finance.year_closing'), hashtext(y.id::text || ':' || p_currency));
  SELECT c.voucher_no INTO v_pending
    FROM finance.voucher c
   WHERE c.financial_year_id = y.id AND c.authority_id = y.authority_id AND c.voucher_type = 'closing'
     AND c.currency::text = p_currency AND c.status = 'draft'
   ORDER BY c.created_at
   LIMIT 1;
  IF v_pending IS NOT NULL THEN
    RAISE EXCEPTION 'the % book of % already has a closing, %, waiting to be posted', p_currency, y.label, v_pending
      USING ERRCODE = '23514';
  END IF;

  v_no := COALESCE(p_voucher_no, finance.next_document_no(y.authority_id, 'closing'));

  -- A closing voucher may be inserted only by a close (finance.refuse_hand_closing_voucher, section 4).
  PERFORM set_config('finance.closing_write', 'on', true);
  INSERT INTO finance.voucher (
    authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
    narration, status, prepared_by)
  VALUES (y.authority_id, v_no, 'closing', p_currency::finance.currency_code,
          y.id, y.end_date,
          'Year-end closing of the ' || p_currency || ' book for ' || y.label, 'draft', p_prepared_by)
  RETURNING id INTO v_new;
  PERFORM set_config('finance.closing_write', 'off', true);

  -- What is left: each revenue and expense account's balance in the year, net of every closing
  -- already posted. Brought to nil by its opposite.
  FOR r IN
    SELECT e.ledger_account_id,
           sum(e.debit) - sum(e.credit) AS net_debit
      FROM finance.ledger_entry e
      JOIN finance.ledger_account la ON la.id = e.ledger_account_id
     WHERE e.financial_year_id = y.id
       AND e.authority_id = y.authority_id AND la.authority_id = y.authority_id
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
    -- Nothing (left) to close. The RAISE rolls the whole transaction back, the draft and the number
    -- issued for it with it.
    RAISE EXCEPTION 'the % book of % has no revenue or expense balance to close', p_currency, y.label
      USING ERRCODE = '23514';
  END IF;

  -- The balancing line, on the opposite side of v_net: a NEGATIVE v_net (revenue above expenditure)
  -- is a surplus and CREDITS accumulated surplus; a positive one is a deficit and debits it. The
  -- reasoning is set out in finance.close_ledger_year() above.
  -- Only when there is a net (B11 review I1): a remainder whose revenue and expense net to nil (a
  -- reclassification posted after the first closing) balances on its own lines, and a line of
  -- debit 0 and credit 0 would break voucher_line_one_side_only (203).
  IF v_net <> 0 THEN
    v_line := v_line + 1;
    INSERT INTO finance.voucher_line (
      authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
    VALUES (y.authority_id, v_new, v_line, v_surplus_account,
            CASE WHEN v_net > 0 THEN  v_net ELSE 0 END,
            CASE WHEN v_net < 0 THEN -v_net ELSE 0 END,
            CASE WHEN v_net < 0 THEN 'Surplus for ' || y.label
                 ELSE 'Deficit for ' || y.label END);
  END IF;

  RETURN v_new;
END $$;

COMMENT ON FUNCTION finance.raise_year_closing(uuid, text, uuid, text, date) IS
  'Raises the year-end closing of one currency''s book as a DRAFT prepared by the caller, dated the '
  'year''s last day, when every period of the year is closed and the final one is not locked. It '
  'brings what is left of each revenue and expense account to nil against accumulated surplus. It '
  'posts nothing: somebody other than the preparer posts it with finance.post_voucher(), into the '
  'closed final period (accounting audit M2, security audit C2; ruling "B11 design").';

-- The one-call close posts in a named person's name: not the application's any more (C2). The
-- schema owner keeps it, for scripts/verify-ledger-invariants.js.
REVOKE EXECUTE ON FUNCTION finance.close_ledger_year(uuid, text, uuid, uuid, text, date) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    REVOKE EXECUTE ON FUNCTION finance.close_ledger_year(uuid, text, uuid, uuid, text, date) FROM vungu_app;
  END IF;
END $$;

-- ── Closing assertions ────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'finance.voucher_line'::regclass
                  AND tgname = 'trg_voucher_line_aa_same_authority') THEN
    RAISE EXCEPTION '242: the voucher-line authority trigger is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'finance.voucher'::regclass
                  AND tgname = 'trg_voucher_same_authority')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'finance.voucher'::regclass
                     AND tgname = 'trg_voucher_closing_by_close_only') THEN
    RAISE EXCEPTION '242: a voucher trigger is missing';
  END IF;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'finance.raise_reversal(uuid, uuid, text, date, text)'::regprocedure) THEN
    RAISE EXCEPTION '242: finance.raise_reversal must run with the caller''s rights';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app')
     AND has_function_privilege('vungu_app', 'finance.reverse_voucher(uuid, uuid, uuid, text, date, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '242: the application role can still call finance.reverse_voucher';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app')
     AND has_function_privilege('vungu_app', 'finance.close_ledger_year(uuid, text, uuid, uuid, text, date)', 'EXECUTE') THEN
    RAISE EXCEPTION '242: the application role can still call finance.close_ledger_year';
  END IF;
  IF (SELECT p.prosecdef FROM pg_proc p
       WHERE p.oid = 'finance.raise_year_closing(uuid, text, uuid, text, date)'::regprocedure) THEN
    RAISE EXCEPTION '242: finance.raise_year_closing must run with the caller''s rights';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'finance.voucher'::regclass
                  AND conname = 'voucher_legacy_duplicate_is_posted') THEN
    RAISE EXCEPTION '242: the legacy-duplicate constraint is missing';
  END IF;
END $$;

-- No privilege is GRANTED here. The new functions above are executable by the application's own
-- database role as every function of migrations 203 to 214 is, through PUBLIC, and
-- finance.ledger_balances reads only tables that role already reads. Two functions are REVOKED
-- from PUBLIC: finance.reverse_voucher() (section 6) and finance.close_ledger_year() (section 7),
-- both of which post in a named person's name in one call.
