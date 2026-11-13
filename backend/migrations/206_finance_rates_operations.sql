-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 206 — RATES OPERATIONS: A CORRECT AGEING UNDER REVERSAL, RECEIPTS, AND COMMITTING A RUN
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Follows 203 (the general ledger) and 205 (rates billing). Design:
-- docs/superpowers/specs/2026-11-10-general-ledger-architecture.md §5 (frontend repo).
--
-- 205 built the registers, the eligibility decision and the billing run, and stopped at the point
-- where a run has raised its drafts. Nothing could yet take a payment, post a run or undo one, so
-- the module had a database and no way to operate it. This migration supplies the three acts that
-- were missing, each as ONE function for the same reason finance.raise_rates_billing() is one
-- function: the act is atomic, and a route that looped over it could leave it half done.
--
-- IT ALSO CORRECTS A DEFECT IN finance.v_debtor_ageing (203:1066), FOUND BY PROOF.
-- finance.reverse_voucher() carries `against_voucher_id` onto the reversal and says why: "so a
-- reversed receipt stops settling the bill it was allocated to" (203:849). The ageing view did not
-- honour it. It counted only the CREDITS that name a bill, so:
--
--   * a receipt that was reversed (a dishonoured cheque, a payment keyed to the wrong account)
--     left its bill reading `settled`, with nothing outstanding;
--   * the debt reappeared as a row for the REVERSAL voucher, aged from the day the payment failed
--     rather than the day the rates were billed;
--   * that row is neither a rates bill nor a rates receipt, so finance.v_rates_arrears (205:695)
--     dropped it, and the rates arrears fell short of the receivable control account by exactly
--     the dishonoured amount. Measured: 2 137.00 billed, paid, reversed -> arrears 0.00 against a
--     control balance of 2 137.00.
--   * a reversed BILL stayed outstanding in full, with an equal "unallocated receipt" beside it.
--
-- The ledger was always right; the report drawn from it was not. Section 1 rewrites the view so a
-- reversal acts on the voucher it reverses. scripts/verify-rates-invariants.js carries the
-- regression (it failed 4 checks before this migration and passes after it).
--
-- Idempotent throughout. Seeds no data.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET search_path = finance, public;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. DEBTOR AGEING THAT FOLLOWS A REVERSAL
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The bucket, said once. IMMUTABLE over a number of days so the two branches of the view below
-- cannot age the same debt differently.
CREATE OR REPLACE FUNCTION finance.ageing_bucket(p_days integer) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
           WHEN p_days <= 30  THEN 'current'
           WHEN p_days <= 60  THEN '31_60'
           WHEN p_days <= 90  THEN '61_90'
           WHEN p_days <= 180 THEN '91_180'
           WHEN p_days <= 365 THEN '181_365'
           ELSE 'over_365'
         END
$$;

COMMENT ON FUNCTION finance.ageing_bucket(integer) IS
  'The ageing bucket for a debt that many days old. One definition, read by every branch of '
  'finance.v_debtor_ageing.';

-- EVERY RECEIVABLE ENTRY EITHER STANDS ON ITS OWN OR ACTS ON ANOTHER VOUCHER.
--
--   stands on its own   a debit is a BILL; a credit is money received and NOT YET MATCHED to one.
--   acts on a voucher   it names a bill in `against_voucher_id` (a settlement, or the reversal of
--                       one), or it belongs to a reversal voucher and so acts on the voucher that
--                       reversal reverses.
--
-- What has been settled on a bill is then the NET of everything acting on it: credits less debits.
-- A receipt credits the bill; that receipt's reversal debits the same bill and takes the
-- settlement away again; the bill's own reversal credits it and leaves nothing owing. The age is
-- still measured from the bill's own posting date, because a payment that failed does not make the
-- debt any younger.
--
-- MATCHED BY VOUCHER, CURRENCY AND PARTY. The party is part of the key so a voucher that bills two
-- ratepayers cannot have one ratepayer's payment applied to both.
--
-- NOTHING IS DROPPED. An entry that acts on a voucher with no matching bill or unmatched receipt
-- (a settlement keyed against the wrong document, or against a different party) is reported as its
-- own row rather than vanishing, so the ageing ALWAYS sums to the receivable control account. That
-- identity is the test of this view and it is proven in scripts/verify-rates-invariants.js.
--
-- CREATE OR REPLACE, not DROP ... CASCADE: finance.v_rates_arrears (205) reads this view and a
-- cascade would silently remove it. The column list and types are unchanged.
CREATE OR REPLACE VIEW finance.v_debtor_ageing WITH (security_invoker = true) AS
WITH receivable AS (
  SELECT e.authority_id, e.currency, e.party_id, e.ledger_account_id,
         e.voucher_id, e.voucher_no, e.voucher_type, e.posting_date, e.debit, e.credit,
         COALESCE(e.against_voucher_id, v.reverses_voucher_id) AS acts_on
    FROM finance.ledger_entry e
    JOIN finance.voucher v ON v.id = e.voucher_id
   WHERE EXISTS (SELECT 1 FROM finance.ledger_account la
                  WHERE la.id = e.ledger_account_id AND la.account_type = 'receivable')
), billed AS (
  SELECT r.authority_id, r.currency, r.party_id, r.ledger_account_id,
         r.voucher_id, r.voucher_no, r.voucher_type, r.posting_date,
         sum(r.debit)::finance.money AS billed_amount
    FROM receivable r
   WHERE r.acts_on IS NULL AND r.debit > 0
   GROUP BY r.authority_id, r.currency, r.party_id, r.ledger_account_id,
            r.voucher_id, r.voucher_no, r.voucher_type, r.posting_date
), unmatched AS (
  SELECT r.authority_id, r.currency, r.party_id, r.ledger_account_id,
         r.voucher_id, r.voucher_no, r.voucher_type, r.posting_date,
         sum(r.credit)::finance.money AS credit_amount
    FROM receivable r
   WHERE r.acts_on IS NULL AND r.credit > 0
   GROUP BY r.authority_id, r.currency, r.party_id, r.ledger_account_id,
            r.voucher_id, r.voucher_no, r.voucher_type, r.posting_date
), movement AS (
  -- Credit-positive: what everything acting on a voucher has taken off it, net.
  SELECT r.acts_on AS voucher_id, r.currency, r.party_id,
         sum(r.credit - r.debit) AS net_credit,
         max(r.posting_date) FILTER (WHERE r.credit > 0) AS last_credit_on
    FROM receivable r
   WHERE r.acts_on IS NOT NULL
   GROUP BY r.acts_on, r.currency, r.party_id
), stray AS (
  -- Acts on a voucher that has neither a bill nor an unmatched receipt for this party. Kept, as
  -- its own row under its own voucher, so the total still reconciles.
  SELECT r.authority_id, r.currency, r.party_id, r.ledger_account_id,
         r.voucher_id, r.voucher_no, r.voucher_type, r.posting_date,
         sum(r.debit) AS debit_amount, sum(r.credit) AS credit_amount
    FROM receivable r
   WHERE r.acts_on IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM billed b
                      WHERE b.voucher_id = r.acts_on AND b.currency = r.currency
                        AND b.party_id IS NOT DISTINCT FROM r.party_id)
     AND NOT EXISTS (SELECT 1 FROM unmatched u
                      WHERE u.voucher_id = r.acts_on AND u.currency = r.currency
                        AND u.party_id IS NOT DISTINCT FROM r.party_id)
   GROUP BY r.authority_id, r.currency, r.party_id, r.ledger_account_id,
            r.voucher_id, r.voucher_no, r.voucher_type, r.posting_date
)
-- A bill, less the net of everything that acts on it.
SELECT b.authority_id, b.currency, b.party_id,
       p.name      AS party_name,
       p.reference AS party_reference,
       b.ledger_account_id, b.voucher_id, b.voucher_no, b.voucher_type,
       b.posting_date,
       b.billed_amount,
       COALESCE(m.net_credit, 0)::finance.money AS settled_amount,
       (b.billed_amount - COALESCE(m.net_credit, 0))::finance.money AS outstanding_amount,
       m.last_credit_on AS last_settled_on,
       (CURRENT_DATE - b.posting_date)::int AS days_outstanding,
       CASE WHEN b.billed_amount - COALESCE(m.net_credit, 0) = 0 THEN 'settled'
            ELSE finance.ageing_bucket((CURRENT_DATE - b.posting_date)::int)
       END AS ageing_bucket
  FROM billed b
  LEFT JOIN movement m ON m.voucher_id = b.voucher_id AND m.currency = b.currency
                      AND m.party_id IS NOT DISTINCT FROM b.party_id
  LEFT JOIN finance.party p ON p.id = b.party_id
UNION ALL
-- Money received and not yet matched to a bill, less whatever has since reversed it. A receipt
-- reversed in full is no longer money held, so it leaves no row.
SELECT u.authority_id, u.currency, u.party_id,
       p.name, p.reference,
       u.ledger_account_id, u.voucher_id, u.voucher_no, u.voucher_type,
       u.posting_date,
       0::finance.money AS billed_amount,
       (u.credit_amount + COALESCE(m.net_credit, 0))::finance.money AS settled_amount,
       (-(u.credit_amount + COALESCE(m.net_credit, 0)))::finance.money AS outstanding_amount,
       NULL::date AS last_settled_on,
       (CURRENT_DATE - u.posting_date)::int AS days_outstanding,
       'unallocated'::text AS ageing_bucket
  FROM unmatched u
  LEFT JOIN movement m ON m.voucher_id = u.voucher_id AND m.currency = u.currency
                      AND m.party_id IS NOT DISTINCT FROM u.party_id
                      -- A voucher that both bills and receives for one party has its movement
                      -- applied to the bill above, and only there.
                      AND NOT EXISTS (SELECT 1 FROM billed b
                                       WHERE b.voucher_id = u.voucher_id AND b.currency = u.currency
                                         AND b.party_id IS NOT DISTINCT FROM u.party_id)
  LEFT JOIN finance.party p ON p.id = u.party_id
 WHERE u.credit_amount + COALESCE(m.net_credit, 0) <> 0
UNION ALL
SELECT s.authority_id, s.currency, s.party_id,
       p.name, p.reference,
       s.ledger_account_id, s.voucher_id, s.voucher_no, s.voucher_type,
       s.posting_date,
       s.debit_amount::finance.money AS billed_amount,
       s.credit_amount::finance.money AS settled_amount,
       (s.debit_amount - s.credit_amount)::finance.money AS outstanding_amount,
       NULL::date AS last_settled_on,
       (CURRENT_DATE - s.posting_date)::int AS days_outstanding,
       CASE WHEN s.debit_amount - s.credit_amount > 0
            THEN finance.ageing_bucket((CURRENT_DATE - s.posting_date)::int)
            ELSE 'unallocated'
       END AS ageing_bucket
  FROM stray s
  LEFT JOIN finance.party p ON p.id = s.party_id
 WHERE s.debit_amount - s.credit_amount <> 0;

COMMENT ON VIEW finance.v_debtor_ageing IS
  'Debtor ageing from the ledger. A receivable debit that stands on its own is a bill; everything '
  'that acts on it — a receipt naming it in against_voucher_id, the reversal of such a receipt, or '
  'the bill''s own reversal — is netted off it, so a dishonoured payment puts the debt back on the '
  'bill and a reversed bill owes nothing (migration 206). The age runs from the bill''s own posting '
  'date. Buckets: current, 31_60, 61_90, 91_180, 181_365, over_365, settled, and `unallocated` for '
  'money received and not yet matched to a bill, which carries a NEGATIVE outstanding figure. The '
  'rows always sum to the receivable control account balance. Ages against CURRENT_DATE. Never '
  'combines currencies.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. WHAT IS STILL OWED ON ONE BILL, COUNTING WHAT IS ALREADY IN HAND
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The ageing view reads the POSTED ledger, which is right for a statement and wrong for a cashier:
-- a receipt drafted this morning and not yet posted is not in the ledger, and a second receipt
-- taken against the same bill this afternoon would settle it twice. So the figure a receipt is
-- checked against counts draft lines as well as posted ones.
CREATE OR REPLACE FUNCTION finance.rates_bill_unsettled(p_rates_bill_id uuid) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT rb.amount
         - COALESCE((
             SELECT sum(l.credit - l.debit)
               FROM finance.voucher_line l
               JOIN finance.voucher v ON v.id = l.voucher_id
              WHERE v.status IN ('draft', 'posted')
                AND (l.against_voucher_id = rb.voucher_id
                     OR (l.against_voucher_id IS NULL AND v.reverses_voucher_id = rb.voucher_id))
                AND EXISTS (SELECT 1 FROM finance.ledger_account la
                             WHERE la.id = l.ledger_account_id AND la.account_type = 'receivable')
           ), 0)
    FROM finance.rates_bill rb
   WHERE rb.id = p_rates_bill_id
$$;

COMMENT ON FUNCTION finance.rates_bill_unsettled(uuid) IS
  'What a rates bill still has open to be settled: its amount, less every receivable line that acts '
  'on it in a DRAFT or posted voucher. Drafts count, so two receipts taken before either is posted '
  'cannot settle the same bill twice. The arrears a statement reports come from the posted ledger '
  '(finance.v_rates_arrears); this is the cashier''s figure, not the statement''s.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3. TAKING A PAYMENT
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Raises the receipt document and its DRAFT voucher: Dr bank, Cr receivable control — one credit
-- line per bill settled, each naming that bill in `against_voucher_id`, and one further credit
-- line for any part of the payment not matched to a bill. Posts nothing. Whoever takes the money
-- does not also put it in the book of account (`voucher_prepared_and_posted_differ`, 203:313).
--
-- p_allocations is a JSON array of { "rates_bill_id": uuid, "amount": "123.45" }. Amounts are text
-- and are cast to NUMERIC here; no figure in this function has ever been a float.
--
-- REFUSED, each by name: an amount that is not positive; a bill that belongs to another rates
-- account, is in another currency, is not yet posted or has been reversed; the same bill named
-- twice; an allocation larger than what the bill still has open (finance.rates_bill_unsettled);
-- allocations that add up to more than the payment; a bank account that is not a bank or cash
-- account; and a receipt date with no open accounting period, which could never be posted.
CREATE OR REPLACE FUNCTION finance.record_rates_receipt(
  p_rates_account_id      uuid,
  p_financial_year_id     uuid,
  p_receipt_no            text,
  p_amount                numeric,
  p_currency              finance.currency_code,
  p_received_on           date,
  p_bank_account_id       uuid,
  p_prepared_by           uuid,
  p_allocations           jsonb DEFAULT '[]'::jsonb,
  p_receivable_account_id uuid DEFAULT NULL,
  p_method                text DEFAULT NULL,
  p_reference             text DEFAULT NULL,
  p_narration             text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  ra          record;
  y           record;
  acct        record;
  per         record;
  a           record;
  bill        record;
  v_voucher   uuid;
  v_receipt   uuid;
  v_line      integer := 1;
  v_allocated numeric := 0;
  v_open      numeric;
  v_remainder numeric;
  v_recv      uuid;
BEGIN
  IF p_prepared_by IS NULL THEN
    RAISE EXCEPTION 'a receipt records who took it' USING ERRCODE = '23502';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'a receipt is for an amount greater than nil' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(btrim(p_receipt_no), '') = '' THEN
    RAISE EXCEPTION 'a receipt carries its receipt number' USING ERRCODE = '23502';
  END IF;

  SELECT r.id, r.authority_id, r.account_no, r.party_id INTO ra
    FROM finance.rates_account r WHERE r.id = p_rates_account_id AND r.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rates account % does not exist', p_rates_account_id USING ERRCODE = '23503';
  END IF;

  SELECT id, label, start_date, end_date INTO y
    FROM finance.financial_year WHERE id = p_financial_year_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'financial year % does not exist', p_financial_year_id USING ERRCODE = '23503';
  END IF;
  IF p_received_on < y.start_date OR p_received_on > y.end_date THEN
    RAISE EXCEPTION 'the receipt date % is not inside financial year % (% to %)',
      p_received_on, y.label, y.start_date, y.end_date USING ERRCODE = '23514';
  END IF;

  SELECT lp.period_no, lp.status INTO per
    FROM finance.ledger_period lp
   WHERE lp.financial_year_id = p_financial_year_id
     AND p_received_on BETWEEN lp.from_date AND lp.to_date
   ORDER BY lp.period_no LIMIT 1;
  IF per.period_no IS NULL THEN
    RAISE EXCEPTION 'no accounting period of financial year % contains %', y.label, p_received_on
      USING ERRCODE = '23514',
            HINT = 'Open the periods for the year first; they must tile it exactly.';
  END IF;
  IF per.status <> 'open' THEN
    RAISE EXCEPTION 'accounting period % is % and accepts no postings, so this receipt could never be posted',
      per.period_no, per.status USING ERRCODE = '23514';
  END IF;

  SELECT id, code, name, account_type, is_postable, status INTO acct
    FROM finance.ledger_account WHERE id = p_bank_account_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank account % does not exist', p_bank_account_id USING ERRCODE = '23503';
  END IF;
  IF acct.account_type IS NULL OR acct.account_type NOT IN ('bank', 'cash') THEN
    RAISE EXCEPTION 'account % (%) is not a bank or cash account, so money cannot be receipted into it',
      acct.code, acct.name USING ERRCODE = '23514';
  END IF;
  IF NOT acct.is_postable OR acct.status <> 'active' THEN
    RAISE EXCEPTION 'account % (%) cannot be posted to', acct.code, acct.name USING ERRCODE = '23514';
  END IF;

  IF p_receivable_account_id IS NOT NULL THEN
    SELECT id, code, name, account_type, is_postable, status INTO acct
      FROM finance.ledger_account WHERE id = p_receivable_account_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'receivable account % does not exist', p_receivable_account_id USING ERRCODE = '23503';
    END IF;
    IF acct.account_type IS DISTINCT FROM 'receivable' THEN
      RAISE EXCEPTION 'account % (%) is not a receivable control account, so a payment credited to it would never reduce the arrears',
        acct.code, acct.name USING ERRCODE = '23514';
    END IF;
    IF NOT acct.is_postable OR acct.status <> 'active' THEN
      RAISE EXCEPTION 'account % (%) cannot be posted to', acct.code, acct.name USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO finance.voucher
    (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
     narration, reference, status, prepared_by)
  VALUES (ra.authority_id, btrim(p_receipt_no), 'receipt', p_currency, p_financial_year_id,
          p_received_on,
          COALESCE(p_narration, 'Rates received, account ' || ra.account_no),
          p_reference, 'draft', p_prepared_by)
  RETURNING id INTO v_voucher;

  -- Dr bank, the whole payment.
  INSERT INTO finance.voucher_line
    (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
  VALUES (ra.authority_id, v_voucher, v_line, p_bank_account_id, p_amount, 0,
          'Rates received, account ' || ra.account_no);

  FOR a IN
    SELECT (x->>'rates_bill_id')::uuid AS rates_bill_id, (x->>'amount')::numeric AS amount
      FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) x
  LOOP
    IF a.amount IS NULL OR a.amount <= 0 THEN
      RAISE EXCEPTION 'an allocation is for an amount greater than nil' USING ERRCODE = '23514';
    END IF;

    SELECT rb.id, rb.bill_no, rb.rates_account_id, rb.currency, rb.voucher_id, v.status AS voucher_status,
           (SELECT l.ledger_account_id FROM finance.voucher_line l
             WHERE l.voucher_id = rb.voucher_id AND l.debit > 0 ORDER BY l.line_no LIMIT 1) AS receivable_id,
           EXISTS (SELECT 1 FROM finance.voucher r
                    WHERE r.reverses_voucher_id = rb.voucher_id AND r.status = 'posted') AS reversed
      INTO bill
      FROM finance.rates_bill rb JOIN finance.voucher v ON v.id = rb.voucher_id
     WHERE rb.id = a.rates_bill_id AND rb.deleted_at IS NULL
       FOR UPDATE OF rb;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'rates bill % does not exist', a.rates_bill_id USING ERRCODE = '23503';
    END IF;
    IF bill.rates_account_id <> p_rates_account_id THEN
      RAISE EXCEPTION 'bill % belongs to a different rates account, and a payment settles only the payer''s own bills',
        bill.bill_no USING ERRCODE = '23514';
    END IF;
    IF bill.currency::text <> p_currency::text THEN
      RAISE EXCEPTION 'a % receipt cannot settle bill %, which is denominated in %',
        p_currency, bill.bill_no, bill.currency
        USING ERRCODE = '23514',
              HINT = 'Settlement happens within one book. There is no approved conversion basis (D4).';
    END IF;
    IF bill.voucher_status <> 'posted' THEN
      RAISE EXCEPTION 'bill % is % and cannot be settled until its billing run is committed',
        bill.bill_no, bill.voucher_status USING ERRCODE = '23514';
    END IF;
    IF bill.reversed THEN
      RAISE EXCEPTION 'bill % has been reversed and has nothing to settle', bill.bill_no
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM finance.voucher_line l
                WHERE l.voucher_id = v_voucher AND l.against_voucher_id = bill.voucher_id) THEN
      RAISE EXCEPTION 'bill % is named twice on this receipt', bill.bill_no USING ERRCODE = '23514';
    END IF;

    v_open := finance.rates_bill_unsettled(bill.id);
    IF a.amount > v_open THEN
      RAISE EXCEPTION 'bill % has % still open and this receipt allocates % to it',
        bill.bill_no, v_open, a.amount
        USING ERRCODE = '23514',
              HINT = 'Allocate no more than is open; leave the rest unallocated and it stays on the ratepayer''s account as a credit.';
    END IF;

    v_line := v_line + 1;
    v_allocated := v_allocated + a.amount;
    -- Cr the bill's own receivable control, naming the bill. This line IS the allocation: there is
    -- no second table recording it (205:437).
    INSERT INTO finance.voucher_line
      (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, party_id,
       against_voucher_id, narration)
    VALUES (ra.authority_id, v_voucher, v_line, bill.receivable_id, 0, a.amount, ra.party_id,
            bill.voucher_id, 'Settles bill ' || bill.bill_no);
  END LOOP;

  IF v_allocated > p_amount THEN
    RAISE EXCEPTION 'the allocations add up to % and the receipt is for %', v_allocated, p_amount
      USING ERRCODE = '23514';
  END IF;

  v_remainder := p_amount - v_allocated;
  IF v_remainder > 0 THEN
    -- Money taken and not matched to a bill. It still credits the ratepayer, so it needs a
    -- receivable control account to sit in: the one named, or failing that the one this ratepayer's
    -- bills are raised against. It is never guessed from the chart.
    v_recv := p_receivable_account_id;
    IF v_recv IS NULL THEN
      SELECT l.ledger_account_id INTO v_recv
        FROM finance.rates_bill rb
        JOIN finance.voucher_line l ON l.voucher_id = rb.voucher_id AND l.debit > 0
       WHERE rb.rates_account_id = p_rates_account_id AND rb.deleted_at IS NULL
       ORDER BY rb.period_from DESC, l.line_no LIMIT 1;
    END IF;
    IF v_recv IS NULL THEN
      RAISE EXCEPTION '% of this receipt is not allocated to a bill, and account % has no bill to say which receivable control account holds it',
        v_remainder, ra.account_no
        USING ERRCODE = '23514',
              HINT = 'Name the receivable control account for the unallocated part.';
    END IF;
    v_line := v_line + 1;
    INSERT INTO finance.voucher_line
      (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, party_id, narration)
    VALUES (ra.authority_id, v_voucher, v_line, v_recv, 0, v_remainder, ra.party_id,
            'Received and not yet matched to a bill');
  END IF;

  INSERT INTO finance.rates_receipt
    (authority_id, receipt_no, rates_account_id, party_id, financial_year_id, amount, currency,
     received_on, method, reference, voucher_id, narration, created_by)
  VALUES (ra.authority_id, btrim(p_receipt_no), p_rates_account_id, ra.party_id, p_financial_year_id,
          p_amount, p_currency, p_received_on, p_method, p_reference, v_voucher, p_narration,
          p_prepared_by)
  RETURNING id INTO v_receipt;

  RETURN v_receipt;
END $$;

COMMENT ON FUNCTION finance.record_rates_receipt(uuid, uuid, text, numeric, finance.currency_code, date, uuid, uuid, jsonb, uuid, text, text, text) IS
  'Raises a rates receipt and its DRAFT voucher: Dr bank, Cr receivable control, one credit line '
  'per bill settled (naming it in against_voucher_id) and one for any unallocated remainder. Posts '
  'nothing; finance.post_voucher() stays the only writer of the ledger and the poster is a '
  'different person. Refuses an over-allocation, a bill of another account or currency, an '
  'unposted or reversed bill, and a date with no open accounting period.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4. COMMITTING A BILLING RUN, AND CANCELLING ONE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Posts every draft bill of a run and marks the run committed, or does none of it. A run of 700
-- bills of which 300 posted would leave a period half billed and a receivable nobody could
-- reconcile to a run, so the whole commit is one transaction in one function.
--
-- THE POSTER IS NOT THE PREPARER. finance.post_voucher() refuses per voucher and
-- `voucher_prepared_and_posted_differ` holds per row; this function says it once up front, for the
-- run, so the refusal names the run rather than its first bill.
CREATE OR REPLACE FUNCTION finance.commit_rates_billing_run(p_run_id uuid, p_posted_by uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  run      record;
  b        record;
  v_posted integer := 0;
BEGIN
  IF p_posted_by IS NULL THEN
    RAISE EXCEPTION 'committing a billing run requires the person committing it' USING ERRCODE = '23502';
  END IF;
  SELECT * INTO run FROM finance.rates_billing_run
   WHERE id = p_run_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing run % does not exist', p_run_id USING ERRCODE = '23503';
  END IF;
  IF run.status <> 'raised' THEN
    RAISE EXCEPTION 'billing run % is already % and cannot be committed again', run.run_reference, run.status
      USING ERRCODE = '23514';
  END IF;
  IF run.prepared_by = p_posted_by THEN
    RAISE EXCEPTION 'billing run % was prepared by this person and must be posted by somebody else', run.run_reference
      USING ERRCODE = '23514',
            HINT = 'Separation of duties: whoever raises a run does not commit it.';
  END IF;

  -- A bill somebody already posted on its own through the ledger is in the book of account and is
  -- counted, not posted again: refusing here would leave the run unable ever to be committed.
  FOR b IN SELECT rb.voucher_id, v.status FROM finance.rates_bill rb
             JOIN finance.voucher v ON v.id = rb.voucher_id
            WHERE rb.billing_run_id = p_run_id AND rb.deleted_at IS NULL
            ORDER BY rb.bill_no
  LOOP
    IF b.status = 'draft' THEN
      PERFORM finance.post_voucher(b.voucher_id, p_posted_by);
    ELSIF b.status <> 'posted' THEN
      RAISE EXCEPTION 'billing run % holds a bill whose voucher is %, so the run cannot be committed as raised',
        run.run_reference, b.status USING ERRCODE = '23514',
        HINT = 'Cancel the run and raise it again.';
    END IF;
    v_posted := v_posted + 1;
  END LOOP;

  IF v_posted = 0 THEN
    RAISE EXCEPTION 'billing run % raised no bills, so there is nothing to commit', run.run_reference
      USING ERRCODE = '23514',
            HINT = 'Its refusals are the work list: each names the Council decision the property waits on.';
  END IF;

  UPDATE finance.rates_billing_run
     SET status = 'committed', committed_by = p_posted_by, committed_at = now()
   WHERE id = p_run_id;

  RETURN v_posted;
END $$;

COMMENT ON FUNCTION finance.commit_rates_billing_run(uuid, uuid) IS
  'Posts every draft bill of a raised run through finance.post_voucher() and marks the run '
  'committed, atomically. Refuses the person who prepared the run (acceptance check G7), a run '
  'that is not `raised`, and a run that raised no bills.';

-- Cancelling is for a run that was RAISED and should not be posted: the wrong period, the wrong
-- accounts, a tariff found to be wrong. Its draft vouchers are cancelled (never deleted — a draft
-- that existed is part of the record of what was prepared) and its bills are soft-deleted, which
-- frees the period to be billed again. The refusals are kept: they are still the work list.
--
-- A COMMITTED run is not cancelled. Its bills are in the book of account, and a posted voucher is
-- corrected by reversal, one bill at a time, with both halves staying visible.
CREATE OR REPLACE FUNCTION finance.cancel_rates_billing_run(
  p_run_id uuid, p_cancelled_by uuid, p_reason text
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  run         record;
  v_cancelled integer;
BEGIN
  IF p_cancelled_by IS NULL THEN
    RAISE EXCEPTION 'cancelling a billing run requires the person cancelling it' USING ERRCODE = '23502';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'cancelling a billing run needs a reason, which goes on the record' USING ERRCODE = '23502';
  END IF;
  SELECT * INTO run FROM finance.rates_billing_run
   WHERE id = p_run_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing run % does not exist', p_run_id USING ERRCODE = '23503';
  END IF;
  IF run.status <> 'raised' THEN
    RAISE EXCEPTION 'billing run % is % and cannot be cancelled', run.run_reference, run.status
      USING ERRCODE = '23514',
            HINT = 'A committed run is in the book of account. Reverse the bills that are wrong; both halves stay visible.';
  END IF;

  UPDATE finance.voucher v
     SET status = 'cancelled', cancelled_by = p_cancelled_by, cancelled_at = now(),
         cancel_reason = btrim(p_reason)
    FROM finance.rates_bill rb
   WHERE rb.billing_run_id = p_run_id AND rb.deleted_at IS NULL
     AND v.id = rb.voucher_id AND v.status = 'draft';
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  UPDATE finance.rates_bill
     SET deleted_at = now(), deleted_by = p_cancelled_by
   WHERE billing_run_id = p_run_id AND deleted_at IS NULL;

  UPDATE finance.rates_billing_run
     SET status = 'cancelled', cancelled_by = p_cancelled_by, cancelled_at = now(),
         cancel_reason = btrim(p_reason)
   WHERE id = p_run_id;

  RETURN v_cancelled;
END $$;

COMMENT ON FUNCTION finance.cancel_rates_billing_run(uuid, uuid, text) IS
  'Cancels a RAISED billing run: its draft vouchers are marked cancelled, its bills soft-deleted so '
  'the period can be billed again, and the reason recorded. A committed run cannot be cancelled; '
  'posted bills are corrected by reversal.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5. WHOEVER DRAFTS A TARIFF DOES NOT APPROVE IT
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 205 flagged `finance.rates.tariff.approve` as an approval and granted it to the committee, but
-- nothing on the row stopped one person who held both permissions (by an override) from typing a
-- rate in the dollar and approving it themselves — and an approved tariff is what every bill is
-- computed from. Same shape as `voucher_prepared_and_posted_differ` and the budget revision's
-- `decided_by <> requested_by`: the constraint is what holds if the route is edited carelessly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'rates_tariff_drafted_and_approved_differ'
                    AND conrelid = 'finance.rates_tariff'::regclass) THEN
    ALTER TABLE finance.rates_tariff
      ADD CONSTRAINT rates_tariff_drafted_and_approved_differ CHECK (
        approved_by IS NULL OR created_by IS NULL OR approved_by <> created_by);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 6. A RATES VOUCHER POSTS WHAT ITS DOCUMENT SAYS, OR IT DOES NOT POST
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A bill's amount is a generated column nobody can write (205:402), and a receipt's amount is on
-- the receipt. But each is posted through a DRAFT VOUCHER, and a draft voucher's lines can be
-- replaced by anyone who may prepare vouchers (PATCH /finance/ledger/vouchers/:id). Without this
-- section a bill for 2 137.00 could be edited to debit 137.00 before the run was committed: the
-- bill would still print 2 137.00 and the book of account would hold 137.00, each of them
-- individually valid and balanced.
--
-- So the moment a voucher becomes `posted`, if a rates bill or a rates receipt stands behind it,
-- what it debits must equal what that document says — checked here, in the database, whichever
-- route or function is doing the posting.
--
-- A VOUCHER WITH NO RATES DOCUMENT BEHIND IT IS LEFT ALONE. Migration 203 allows a voucher of type
-- `rates_bill` or `receipt` to be raised by hand as an ordinary journal, the ledger's own proofs
-- and demo data do exactly that, and there is no document for such a voucher to disagree with.
CREATE OR REPLACE FUNCTION finance.assert_rates_voucher_agrees() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
DECLARE
  doc     record;
  v_debit numeric;
BEGIN
  IF NEW.status <> 'posted' OR OLD.status = 'posted' THEN RETURN NEW; END IF;

  SELECT COALESCE(sum(l.debit), 0) INTO v_debit
    FROM finance.voucher_line l WHERE l.voucher_id = NEW.id;

  SELECT rb.bill_no, rb.amount INTO doc
    FROM finance.rates_bill rb WHERE rb.voucher_id = NEW.id AND rb.deleted_at IS NULL;
  IF FOUND AND v_debit <> doc.amount THEN
    RAISE EXCEPTION 'voucher % no longer agrees with rates bill %: the bill is for % and the voucher debits %',
      NEW.voucher_no, doc.bill_no, doc.amount, v_debit
      USING ERRCODE = '23514',
            HINT = 'The bill''s amount is computed from the roll and the tariff. Cancel the run and raise it again.';
  END IF;

  SELECT rc.receipt_no, rc.amount INTO doc
    FROM finance.rates_receipt rc WHERE rc.voucher_id = NEW.id AND rc.deleted_at IS NULL;
  IF FOUND AND v_debit <> doc.amount THEN
    RAISE EXCEPTION 'voucher % no longer agrees with rates receipt %: the receipt is for % and the voucher debits %',
      NEW.voucher_no, doc.receipt_no, doc.amount, v_debit
      USING ERRCODE = '23514',
            HINT = 'Cancel the receipt and record it again.';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION finance.assert_rates_voucher_agrees() IS
  'At the moment a voucher is posted: one that stands behind a rates bill must debit exactly the '
  'bill''s generated amount, and one that stands behind a rates receipt exactly the receipt''s. Holds '
  'whichever route posts, so editing a draft''s lines cannot make the book of account disagree '
  'with the document.';

DROP TRIGGER IF EXISTS trg_voucher_rates_document_agrees ON finance.voucher;
CREATE TRIGGER trg_voucher_rates_document_agrees
  BEFORE UPDATE OF status ON finance.voucher
  FOR EACH ROW EXECUTE FUNCTION finance.assert_rates_voucher_agrees();
