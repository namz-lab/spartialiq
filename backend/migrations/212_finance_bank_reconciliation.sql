-- 212: bank reconciliation — the bank's statement matched against the cashbook.
--
-- Design: docs/superpowers/specs/2026-11-13-accountant-full-system-design.md §4 (frontend repo).
-- Routes: src/routes/finance-bank.js. Rollback: migrations/rollback/212_finance_bank_reconciliation.down.sql.
--
-- THE CASHBOOK IS THE LEDGER. There is no second cashbook table: the cashbook of a bank account is
-- finance.ledger_entry on a ledger account typed `bank`, in one currency. A statement line is
-- matched to the ledger entries it is the bank's record of, and the two sides of a match must be
-- equal to the cent.
--
-- SIGNS. A statement line's `amount` is signed from the Council's side: money INTO the account is
-- positive. A ledger entry's effect on the account is debit − credit. A match balances when
-- sum(line.amount) = sum(entry.debit − entry.credit).
--
-- WHAT A RECONCILIATION PROVES, AND THE REFUSAL
--   1. the file is whole:      opening balance + every line = closing balance
--   2. nothing on the statement is missing from the cashbook: every line is matched. A bank charge
--      the Council never recorded is journalled first (prepared by one person, posted by another),
--      then matched. It is never ticked off against nothing.
--   3. the two balances agree: closing balance = cashbook balance at the statement date, less the
--      cashbook entries the bank has not yet seen (deposits in transit, unpresented payments).
-- finance.complete_bank_reconciliation() refuses unless all three hold. A reconciled statement and
-- its matches are frozen.
--
-- IDEMPOTENT. Safe to re-run.

CREATE TABLE IF NOT EXISTS finance.bank_statement (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  bank_account_id   uuid NOT NULL REFERENCES finance.ledger_account (id),
  currency          finance.currency_code NOT NULL,
  statement_ref     text,
  from_date         date NOT NULL,
  to_date           date NOT NULL,
  opening_balance   numeric(18,2) NOT NULL,
  closing_balance   numeric(18,2) NOT NULL,
  original_filename text,
  file_hash         text,
  status            text NOT NULL DEFAULT 'open' CONSTRAINT bank_statement_status_known
                    CHECK (status IN ('open', 'reconciled', 'cancelled')),
  imported_by       uuid NOT NULL REFERENCES public.users (id),
  imported_at       timestamptz NOT NULL DEFAULT now(),
  reconciled_by     uuid REFERENCES public.users (id),
  reconciled_at     timestamptz,
  -- The figures the reconciliation was completed on, kept as they stood that day.
  summary           jsonb,
  cancelled_by      uuid REFERENCES public.users (id),
  cancelled_at      timestamptz,
  cancel_reason     text,
  CONSTRAINT bank_statement_dates_ordered CHECK (to_date >= from_date),
  CONSTRAINT bank_statement_reconciled_is_attributed CHECK (
    (status = 'reconciled') = (reconciled_by IS NOT NULL AND reconciled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_bank_statement_account ON finance.bank_statement (bank_account_id, currency, to_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_statement_file
  ON finance.bank_statement (bank_account_id, currency, file_hash) WHERE status <> 'cancelled' AND file_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS finance.bank_match (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  statement_id uuid NOT NULL REFERENCES finance.bank_statement (id) ON DELETE CASCADE,
  method       text NOT NULL DEFAULT 'manual' CONSTRAINT bank_match_method_known CHECK (method IN ('auto', 'manual')),
  matched_by   uuid NOT NULL REFERENCES public.users (id),
  matched_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_match_statement ON finance.bank_match (statement_id);

CREATE TABLE IF NOT EXISTS finance.bank_statement_line (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  statement_id uuid NOT NULL REFERENCES finance.bank_statement (id) ON DELETE CASCADE,
  line_no      integer NOT NULL CONSTRAINT bank_statement_line_no_positive CHECK (line_no > 0),
  txn_date     date NOT NULL,
  description  text,
  reference    text,
  -- Signed from the Council's side: money into the account is positive.
  amount       numeric(18,2) NOT NULL CONSTRAINT bank_statement_line_not_nil CHECK (amount <> 0),
  match_id     uuid REFERENCES finance.bank_match (id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_statement_line_no ON finance.bank_statement_line (statement_id, line_no);
CREATE INDEX IF NOT EXISTS idx_bank_statement_line_match ON finance.bank_statement_line (match_id);

CREATE TABLE IF NOT EXISTS finance.bank_match_entry (
  authority_id    integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  match_id        uuid NOT NULL REFERENCES finance.bank_match (id) ON DELETE CASCADE,
  ledger_entry_id uuid NOT NULL REFERENCES finance.ledger_entry (id),
  PRIMARY KEY (match_id, ledger_entry_id)
);
-- A cashbook entry is the bank's record of one thing: it is ticked off once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_match_entry_once ON finance.bank_match_entry (ledger_entry_id);

COMMENT ON TABLE finance.bank_statement IS
  'A bank statement for one bank ledger account in one currency. Reconciled when every line is '
  'matched to the cashbook (finance.ledger_entry) and the balances agree; then frozen.';

-- A reconciled or cancelled statement, its lines and its matches are closed.
CREATE OR REPLACE FUNCTION finance.assert_bank_statement_open() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
DECLARE v_statement uuid; v_status text;
BEGIN
  IF TG_TABLE_NAME = 'bank_match_entry' THEN
    SELECT m.statement_id INTO v_statement FROM finance.bank_match m WHERE m.id = COALESCE(NEW.match_id, OLD.match_id);
  ELSE
    v_statement := COALESCE(NEW.statement_id, OLD.statement_id);
  END IF;
  SELECT s.status INTO v_status FROM finance.bank_statement s WHERE s.id = v_statement;
  -- The statement itself has gone (a cascade from removing an open statement).
  IF NOT FOUND THEN RETURN COALESCE(NEW, OLD); END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'this bank statement is % and can no longer be changed', v_status
      USING ERRCODE = '23514', HINT = 'A reconciled statement is evidence. Corrections go through the next statement.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_statement_line', 'bank_match', 'bank_match_entry'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = ('finance.' || t)::regclass AND tgname = 'trg_' || t || '_open') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON finance.%I
                        FOR EACH ROW EXECUTE FUNCTION finance.assert_bank_statement_open()', 'trg_' || t || '_open', t);
    END IF;
  END LOOP;
END $$;

-- Match statement lines to cashbook entries. Either side may be several; the two must be equal.
-- With no lines, the entries must net to nil (a posting and its reversal, which the bank never saw).
CREATE OR REPLACE FUNCTION finance.match_bank_items(
  p_statement_id uuid, p_line_ids uuid[], p_entry_ids uuid[], p_user uuid, p_method text DEFAULT 'manual')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  s finance.bank_statement;
  v_lines numeric; v_line_count integer;
  v_entries numeric; v_entry_count integer;
  v_match uuid;
BEGIN
  SELECT * INTO s FROM finance.bank_statement WHERE id = p_statement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank statement % does not exist', p_statement_id USING ERRCODE = '23503'; END IF;
  IF s.status <> 'open' THEN
    RAISE EXCEPTION 'this bank statement is % and can no longer be changed', s.status USING ERRCODE = '23514';
  END IF;
  p_line_ids := COALESCE(p_line_ids, '{}'); p_entry_ids := COALESCE(p_entry_ids, '{}');
  IF cardinality(p_entry_ids) = 0 THEN
    RAISE EXCEPTION 'choose the cashbook entries this matches' USING ERRCODE = '23514',
      HINT = 'A statement line with nothing in the cashbook is journalled first, then matched.';
  END IF;

  SELECT COALESCE(sum(l.amount), 0), count(*) INTO v_lines, v_line_count
    FROM finance.bank_statement_line l
   WHERE l.id = ANY (p_line_ids) AND l.statement_id = p_statement_id AND l.match_id IS NULL;
  IF v_line_count <> cardinality(p_line_ids) THEN
    RAISE EXCEPTION 'a chosen statement line is already matched or is not on this statement' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(sum(e.debit - e.credit), 0), count(*) INTO v_entries, v_entry_count
    FROM finance.ledger_entry e
   WHERE e.id = ANY (p_entry_ids) AND e.ledger_account_id = s.bank_account_id AND e.currency = s.currency
     AND NOT EXISTS (SELECT 1 FROM finance.bank_match_entry x WHERE x.ledger_entry_id = e.id);
  IF v_entry_count <> cardinality(p_entry_ids) THEN
    RAISE EXCEPTION 'a chosen cashbook entry is already matched, or is not in this bank account and currency'
      USING ERRCODE = '23514';
  END IF;

  IF v_lines <> v_entries THEN
    RAISE EXCEPTION 'the statement side is % and the cashbook side is %: a match must be equal (difference %)',
      v_lines, v_entries, v_lines - v_entries
      USING ERRCODE = '23514', HINT = 'Journal the difference (a bank charge, for instance) and include that entry in the match.';
  END IF;

  INSERT INTO finance.bank_match (authority_id, statement_id, method, matched_by)
  VALUES (s.authority_id, s.id, p_method, p_user) RETURNING id INTO v_match;
  UPDATE finance.bank_statement_line SET match_id = v_match WHERE id = ANY (p_line_ids);
  INSERT INTO finance.bank_match_entry (authority_id, match_id, ledger_entry_id)
  SELECT s.authority_id, v_match, x FROM unnest(p_entry_ids) x;
  RETURN v_match;
END $$;

-- Match what can only be one thing: a line and an entry of the same amount where the entry's
-- voucher number or reference appears on the line, or else the ONLY unmatched entry of that amount
-- within seven days either side — and the only unmatched line that could claim it. Anything with
-- two candidates is left for a person.
CREATE OR REPLACE FUNCTION finance.auto_match_bank_statement(p_statement_id uuid, p_user uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE s finance.bank_statement; r record; v_done integer := 0;
BEGIN
  SELECT * INTO s FROM finance.bank_statement WHERE id = p_statement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank statement % does not exist', p_statement_id USING ERRCODE = '23503'; END IF;
  FOR r IN
    WITH open_entry AS (
      SELECT e.id, e.debit - e.credit AS amount, e.posting_date, e.voucher_no, v.reference
        FROM finance.ledger_entry e JOIN finance.voucher v ON v.id = e.voucher_id
       WHERE e.ledger_account_id = s.bank_account_id AND e.currency = s.currency
         AND e.posting_date <= s.to_date + 7
         AND NOT EXISTS (SELECT 1 FROM finance.bank_match_entry x WHERE x.ledger_entry_id = e.id)
    ), pair AS (
      SELECT l.id AS line_id, e.id AS entry_id,
             (position(upper(e.voucher_no) IN upper(COALESCE(l.reference, '') || ' ' || COALESCE(l.description, ''))) > 0
              OR (length(btrim(COALESCE(e.reference, ''))) >= 3
                  AND position(upper(btrim(e.reference)) IN upper(COALESCE(l.reference, '') || ' ' || COALESCE(l.description, ''))) > 0)) AS by_reference
        FROM finance.bank_statement_line l
        JOIN open_entry e ON e.amount = l.amount AND abs(e.posting_date - l.txn_date) <= 7
       WHERE l.statement_id = p_statement_id AND l.match_id IS NULL
    ), ranked AS (
      SELECT p.*,
             count(*) OVER (PARTITION BY p.line_id, p.by_reference) AS per_line,
             count(*) OVER (PARTITION BY p.entry_id, p.by_reference) AS per_entry,
             bool_or(p.by_reference) OVER (PARTITION BY p.line_id) AS line_has_ref,
             bool_or(p.by_reference) OVER (PARTITION BY p.entry_id) AS entry_has_ref
        FROM pair p
    )
    SELECT line_id, entry_id FROM ranked
     WHERE per_line = 1 AND per_entry = 1
       AND (by_reference OR (NOT line_has_ref AND NOT entry_has_ref))
  LOOP
    BEGIN
      PERFORM finance.match_bank_items(p_statement_id, ARRAY[r.line_id], ARRAY[r.entry_id], p_user, 'auto');
      v_done := v_done + 1;
    EXCEPTION WHEN check_violation THEN
      -- Claimed by an earlier pair in this same pass. Left for a person.
      NULL;
    END;
  END LOOP;
  RETURN v_done;
END $$;

-- ONE definition of the reconciliation's figures, read by the screen and by the completion.
CREATE OR REPLACE FUNCTION finance.bank_reconciliation_summary(p_statement_id uuid)
RETURNS TABLE (
  lines_total integer, lines_unmatched integer, statement_movement numeric, file_difference numeric,
  cashbook_balance numeric, deposits_in_transit numeric, unpresented_payments numeric,
  adjusted_cashbook numeric, difference numeric)
LANGUAGE sql STABLE AS $$
  WITH s AS (SELECT * FROM finance.bank_statement WHERE id = p_statement_id),
  l AS (
    SELECT count(*)::int AS total, count(*) FILTER (WHERE x.match_id IS NULL)::int AS unmatched,
           COALESCE(sum(x.amount), 0) AS movement
      FROM finance.bank_statement_line x WHERE x.statement_id = p_statement_id),
  book AS (
    SELECT COALESCE(sum(e.debit - e.credit), 0) AS balance,
           -- Not yet seen by the bank at this statement's date: unmatched, or matched on a LATER statement.
           COALESCE(sum(e.debit) FILTER (WHERE o.outstanding), 0) AS in_transit,
           COALESCE(sum(e.credit) FILTER (WHERE o.outstanding), 0) AS unpresented
      FROM s
      JOIN finance.ledger_entry e ON e.ledger_account_id = s.bank_account_id AND e.currency = s.currency
                                 AND e.posting_date <= s.to_date
      CROSS JOIN LATERAL (
        SELECT NOT EXISTS (
          SELECT 1 FROM finance.bank_match_entry me
            JOIN finance.bank_match m ON m.id = me.match_id
            JOIN finance.bank_statement ms ON ms.id = m.statement_id
           WHERE me.ledger_entry_id = e.id AND ms.to_date <= s.to_date) AS outstanding) o)
  SELECT l.total, l.unmatched, l.movement,
         s.opening_balance + l.movement - s.closing_balance,
         book.balance, book.in_transit, book.unpresented,
         book.balance - book.in_transit + book.unpresented,
         s.closing_balance - (book.balance - book.in_transit + book.unpresented)
    FROM s, l, book
$$;

CREATE OR REPLACE FUNCTION finance.complete_bank_reconciliation(p_statement_id uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s finance.bank_statement; f record; v_summary jsonb;
BEGIN
  SELECT * INTO s FROM finance.bank_statement WHERE id = p_statement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank statement % does not exist', p_statement_id USING ERRCODE = '23503'; END IF;
  IF s.status <> 'open' THEN RAISE EXCEPTION 'this bank statement is already %', s.status USING ERRCODE = '23514'; END IF;
  SELECT * INTO f FROM finance.bank_reconciliation_summary(p_statement_id);
  IF f.file_difference <> 0 THEN
    RAISE EXCEPTION 'the statement does not add up: opening balance plus its lines differs from the closing balance by %', f.file_difference
      USING ERRCODE = '23514', HINT = 'Lines are missing from the file, or a balance was typed wrongly.';
  END IF;
  IF f.lines_unmatched > 0 THEN
    RAISE EXCEPTION '% statement line(s) are not matched to the cashbook', f.lines_unmatched
      USING ERRCODE = '23514', HINT = 'Journal what the cashbook is missing, have it posted, and match it.';
  END IF;
  IF f.difference <> 0 THEN
    RAISE EXCEPTION 'the statement closes at % and the cashbook, less what the bank has not yet seen, stands at % (difference %)',
      s.closing_balance, f.adjusted_cashbook, f.difference
      USING ERRCODE = '23514',
            HINT = 'Usually an earlier statement is missing, or the opening balance does not follow the last reconciled statement.';
  END IF;
  v_summary := to_jsonb(f);
  UPDATE finance.bank_statement
     SET status = 'reconciled', reconciled_by = p_user, reconciled_at = now(), summary = v_summary
   WHERE id = p_statement_id;
  RETURN v_summary;
END $$;

-- Permissions
INSERT INTO finance.permission (code, label, category, is_approval, is_publication, is_restricted, description) VALUES
  ('finance.bank.view',      'View bank reconciliations', 'bank', false, false, false, 'Bank statements, their matching to the cashbook and the reconciliation figures.'),
  ('finance.bank.reconcile', 'Reconcile the bank',        'bank', false, false, false, 'Import a statement, match it to the cashbook and complete the reconciliation. Posts nothing: a missing entry is journalled and posted by somebody else.')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, is_approval = EXCLUDED.is_approval,
      is_publication = EXCLUDED.is_publication, is_restricted = EXCLUDED.is_restricted, description = EXCLUDED.description;

INSERT INTO finance.role_permission (role_name, permission_code) VALUES
  ('accountant', 'finance.bank.view'), ('accountant', 'finance.bank.reconcile'),
  ('finance_admin', 'finance.bank.view'), ('finance_admin', 'finance.bank.reconcile'),
  ('finance_officer', 'finance.bank.view'), ('finance_committee', 'finance.bank.view'),
  ('accounting_officer', 'finance.bank.view'), ('auditor', 'finance.bank.view')
ON CONFLICT (role_name, permission_code) DO NOTHING;

DO $$
DECLARE r text;
  tables text[] := ARRAY['finance.bank_statement', 'finance.bank_match', 'finance.bank_statement_line', 'finance.bank_match_entry'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    FOREACH r IN ARRAY tables LOOP
      PERFORM tenancy.classify(r, 'pending', 'bank reconciliation data awaiting the authority it belongs to');
    END LOOP;
    RETURN;
  END IF;
  FOREACH r IN ARRAY tables LOOP PERFORM tenancy.make_tenant(r::regclass, 'VUNGU'); END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    REVOKE DELETE, TRUNCATE ON finance.bank_statement FROM vungu_app;
  END IF;
END $$;
