-- 243: the salaries journal — a `payroll` voucher type and its SJ- number series.
--
-- Design: client direction K6 (frontend/docs/finance/COUNCIL-DECISIONS.md, 2026-11-17). A council
-- pays its staff every month, and the ledger must hold the double entry: gross salaries and the
-- employer's statutory contributions debited to the salary and contribution expense accounts, the
-- deductions (PAYE, NSSA) credited to their tax control accounts, and the net paid credited to the
-- bank. Decision D21 keeps a payroll module deliberately unbuilt; this is NOT one. The screen takes
-- the month's totals from whatever computes the salaries and raises ONE draft voucher, which a
-- second person posts. It keeps no employee, no bank-standing-order and no leave record.
--
-- Rollback: migrations/rollback/243_finance_payroll_journal.down.sql.
--
-- NOTHING ELSE CHANGES. No table gains a column and no posted entry is touched. Three things move:
--   1. finance.voucher admits one more type, `payroll`, raised only by the salaries journal route
--      (src/routes/finance-ledger.js), never typed by hand — a hand-typed payroll journal would
--      bypass the screen that makes its shape legible, exactly why `closing` and `receipt` are
--      system types (accounting audit M5, security audit H4).
--   2. finance.document_sequence keeps a `payroll` kind, and finance.next_document_no() issues it
--      as SJ-0000001, SJ-0000002, … so every salaries journal is numbered gaplessly like every
--      other document the council raises.
--   3. A payroll draft is EDITABLE and DISCARDABLE by its preparer like a journal draft. It is NOT
--      a document voucher (finance-ledger.js DOCUMENT_VOUCHER_TYPES): supplier invoices, payments,
--      depreciation and disposals are withdrawn through the document that raised them, but the
--      salaries journal has no document behind it — the month's totals are the document — so its
--      draft is corrected the way a journal draft is, and a posted one is reversed, never edited.
--
-- IDEMPOTENT. Safe to re-run.

-- ── 1. The voucher type ───────────────────────────────────────────────────────────────────────
ALTER TABLE finance.voucher DROP CONSTRAINT IF EXISTS voucher_type_known;
ALTER TABLE finance.voucher ADD CONSTRAINT voucher_type_known CHECK (voucher_type IN (
  'opening', 'journal', 'rates_bill', 'receipt', 'credit_note', 'write_off', 'closing', 'reversal',
  'supplier_invoice', 'payment', 'depreciation', 'asset_disposal', 'payroll'));

-- ── 2. The SJ- number series ──────────────────────────────────────────────────────────────────
ALTER TABLE finance.document_sequence DROP CONSTRAINT IF EXISTS document_sequence_kind_known;
ALTER TABLE finance.document_sequence ADD CONSTRAINT document_sequence_kind_known
  CHECK (kind IN ('receipt', 'cashier_session', 'bank_deposit', 'opening',
                  'supplier_invoice', 'payment', 'asset', 'depreciation', 'asset_disposal',
                  'journal', 'credit_note', 'write_off', 'closing', 'payroll'));

-- Every prefix of 242's CASE, unchanged, with the salaries journal's SJ added.
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
                          WHEN 'write_off' THEN 'WO' WHEN 'closing' THEN 'YC'
                          WHEN 'payroll' THEN 'SJ' END;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'no document sequence is kept for %', p_kind USING ERRCODE = '23514';
  END IF;
  INSERT INTO finance.document_sequence AS s (authority_id, kind, last_no)
  VALUES (p_authority_id, p_kind, 1)
  ON CONFLICT (authority_id, kind) DO UPDATE SET last_no = s.last_no + 1
  RETURNING s.last_no INTO v_no;
  RETURN v_prefix || '-' || lpad(v_no::text, 7, '0');
END $$;

-- ── 3. What this migration promises, checked ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'finance.voucher'::regclass
                  AND conname = 'voucher_type_known'
                  AND pg_get_constraintdef(oid) LIKE '%payroll%') THEN
    RAISE EXCEPTION '243: the payroll voucher type is not admitted';
  END IF;
  -- The function is inspected, not called: a call issues a number, and this migration issues none.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = 'finance.next_document_no(integer, text)'::regprocedure
                    AND position('WHEN ''payroll'' THEN ''SJ''' IN pg_get_functiondef(p.oid)) > 0) THEN
    RAISE EXCEPTION '243: finance.next_document_no does not issue SJ- numbers';
  END IF;
END $$;

-- No number is issued here; a council's own series starts fresh at SJ-0000001. No privilege is
-- GRANTED or REVOKED.
