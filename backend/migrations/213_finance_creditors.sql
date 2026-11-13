-- 213: creditors — supplier invoices and payment vouchers.
--
-- Design: docs/superpowers/specs/2026-11-13-accountant-full-system-design.md §5 and
-- docs/superpowers/specs/2026-11-11-finance-enterprise-reengineering-design.md §5.5 (frontend repo).
-- Routes: src/routes/finance-payables.js. Rollback: migrations/rollback/213_finance_creditors.down.sql.
--
-- WHAT EACH DOCUMENT POSTS
--   supplier invoice   Dr each expense (or asset) line, net of tax
--                      Dr the input-tax account, when the invoice carries tax
--                      Cr the payable control account, for the supplier, dated the INVOICE's date
--                      (finance.voucher.document_date), so it ages from when it was raised.
--   payment voucher    Dr the payable control account, for the supplier, against each document paid
--                      Cr the bank account
-- Both are drafts until somebody OTHER than whoever prepared them approves, which posts the voucher
-- through finance.post_voucher(): the same control, and the same constraint, as every journal.
--
-- WHAT IS OWED IS READ FROM THE LEDGER, NOT KEPT BESIDE IT
-- finance.v_creditor_open derives every open payable from finance.ledger_entry, so a supplier
-- invoice, an opening item brought across at cut-over (migration 211) and a journal to a payable
-- account are all payable the same way, and a reversal releases what it reversed. A payment is
-- allocated to the voucher that raised the debt and cannot exceed what is still open on it,
-- counting payments already drafted and awaiting approval.
--
-- A DOCUMENT'S VOUCHER IS NOT EDITED AS A JOURNAL
-- The lines of a supplier-invoice or payment voucher are written only by the functions below.
-- Editing them through the journal screen would make the book disagree with the document.
--
-- NOT HERE: amount thresholds for who may approve a payment (Council decision D6 — the table
-- finance.approval_threshold is still empty), remittance advices, and the creditors-clerk role of
-- the enterprise design, which is the Council's establishment to fill (D21).
--
-- IDEMPOTENT. Safe to re-run.

-- ── Voucher types and document numbers ────────────────────────────────────────────────────────
ALTER TABLE finance.voucher DROP CONSTRAINT IF EXISTS voucher_type_known;
ALTER TABLE finance.voucher ADD CONSTRAINT voucher_type_known CHECK (voucher_type IN (
  'opening', 'journal', 'rates_bill', 'receipt', 'credit_note', 'write_off', 'closing', 'reversal',
  'supplier_invoice', 'payment', 'depreciation', 'asset_disposal'));

ALTER TABLE finance.document_sequence DROP CONSTRAINT IF EXISTS document_sequence_kind_known;
ALTER TABLE finance.document_sequence ADD CONSTRAINT document_sequence_kind_known
  CHECK (kind IN ('receipt', 'cashier_session', 'bank_deposit', 'opening',
                  'supplier_invoice', 'payment', 'asset', 'depreciation', 'asset_disposal'));

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

-- ── The documents ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.supplier_invoice (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id       integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  invoice_no         text NOT NULL,
  -- The number on the supplier's own invoice.
  supplier_ref       text NOT NULL CONSTRAINT supplier_invoice_ref_given CHECK (length(btrim(supplier_ref)) >= 1),
  party_id           uuid NOT NULL REFERENCES finance.party (id),
  currency           finance.currency_code NOT NULL,
  invoice_date       date NOT NULL,
  due_date           date NOT NULL,
  financial_year_id  uuid NOT NULL REFERENCES finance.financial_year (id),
  payable_account_id uuid NOT NULL REFERENCES finance.ledger_account (id),
  tax_account_id     uuid REFERENCES finance.ledger_account (id),
  net_total          numeric(18,2) NOT NULL CONSTRAINT supplier_invoice_net_positive CHECK (net_total > 0),
  tax_total          numeric(18,2) NOT NULL DEFAULT 0 CONSTRAINT supplier_invoice_tax_not_negative CHECK (tax_total >= 0),
  total              numeric(18,2) GENERATED ALWAYS AS (net_total + tax_total) STORED,
  narration          text,
  voucher_id         uuid NOT NULL REFERENCES finance.voucher (id),
  prepared_by        uuid NOT NULL REFERENCES public.users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_invoice_due_not_before_invoice CHECK (due_date >= invoice_date),
  CONSTRAINT supplier_invoice_tax_names_its_account CHECK (tax_total = 0 OR tax_account_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_invoice_no ON finance.supplier_invoice (authority_id, invoice_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_invoice_voucher ON finance.supplier_invoice (voucher_id);
-- The same supplier invoice is not captured twice. This is the commonest way a creditor is paid twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_invoice_ref ON finance.supplier_invoice (party_id, upper(btrim(supplier_ref)));
CREATE INDEX IF NOT EXISTS idx_supplier_invoice_party ON finance.supplier_invoice (party_id, invoice_date);

CREATE TABLE IF NOT EXISTS finance.supplier_invoice_line (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  invoice_id        uuid NOT NULL REFERENCES finance.supplier_invoice (id) ON DELETE CASCADE,
  line_no           integer NOT NULL,
  ledger_account_id uuid NOT NULL REFERENCES finance.ledger_account (id),
  description       text,
  net_amount        numeric(18,2) NOT NULL CONSTRAINT supplier_invoice_line_net_positive CHECK (net_amount > 0),
  tax_amount        numeric(18,2) NOT NULL DEFAULT 0 CONSTRAINT supplier_invoice_line_tax_not_negative CHECK (tax_amount >= 0),
  department_id     uuid REFERENCES finance.department (id),
  budget_line_id    uuid REFERENCES finance.budget_line (id),
  project_id        uuid REFERENCES finance.project (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_invoice_line_no ON finance.supplier_invoice_line (invoice_id, line_no);

CREATE TABLE IF NOT EXISTS finance.supplier_payment (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  payment_no        text NOT NULL,
  party_id          uuid NOT NULL REFERENCES finance.party (id),
  currency          finance.currency_code NOT NULL,
  payment_date      date NOT NULL,
  financial_year_id uuid NOT NULL REFERENCES finance.financial_year (id),
  bank_account_id   uuid NOT NULL REFERENCES finance.ledger_account (id),
  payable_account_id uuid NOT NULL REFERENCES finance.ledger_account (id),
  method            text NOT NULL CONSTRAINT supplier_payment_method_known
                    CHECK (method IN ('bank_transfer', 'cheque', 'rtgs', 'mobile_money', 'cash', 'other')),
  -- The bank's or the cheque's own reference: what the statement line will carry.
  reference         text,
  total             numeric(18,2) NOT NULL CONSTRAINT supplier_payment_total_positive CHECK (total > 0),
  narration         text,
  voucher_id        uuid NOT NULL REFERENCES finance.voucher (id),
  prepared_by       uuid NOT NULL REFERENCES public.users (id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_payment_no ON finance.supplier_payment (authority_id, payment_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_payment_voucher ON finance.supplier_payment (voucher_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payment_party ON finance.supplier_payment (party_id, payment_date);

CREATE TABLE IF NOT EXISTS finance.supplier_payment_allocation (
  authority_id       integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  payment_id         uuid NOT NULL REFERENCES finance.supplier_payment (id) ON DELETE CASCADE,
  -- The voucher that raised the debt: a supplier invoice, an opening item, or a journal.
  against_voucher_id uuid NOT NULL REFERENCES finance.voucher (id),
  amount             numeric(18,2) NOT NULL CONSTRAINT supplier_payment_allocation_positive CHECK (amount > 0),
  PRIMARY KEY (payment_id, against_voucher_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_payment_allocation_against ON finance.supplier_payment_allocation (against_voucher_id);

-- ── What is owed, from the ledger ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW finance.v_creditor_open WITH (security_invoker = true) AS
WITH payable AS (
  SELECT e.authority_id, e.currency, e.party_id, e.ledger_account_id, e.voucher_id, e.voucher_no, e.voucher_type,
         e.posting_date, e.debit, e.credit,
         COALESCE(e.against_voucher_id, v.reverses_voucher_id) AS acts_on,
         COALESCE(v.document_date, e.posting_date) AS document_date, v.reference
    FROM finance.ledger_entry e
    JOIN finance.voucher v ON v.id = e.voucher_id
   WHERE EXISTS (SELECT 1 FROM finance.ledger_account la WHERE la.id = e.ledger_account_id AND la.account_type = 'payable')
), raised AS (
  SELECT authority_id, currency, party_id, ledger_account_id, voucher_id, voucher_no, voucher_type, document_date,
         max(reference) AS reference, sum(credit) AS raised
    FROM payable WHERE acts_on IS NULL AND credit > 0
   GROUP BY authority_id, currency, party_id, ledger_account_id, voucher_id, voucher_no, voucher_type, document_date
), settled AS (
  SELECT acts_on AS voucher_id, party_id, sum(debit - credit) AS settled, max(posting_date) FILTER (WHERE debit > 0) AS last_paid_on
    FROM payable WHERE acts_on IS NOT NULL GROUP BY acts_on, party_id
), pending AS (
  -- Payments drafted against this document and not yet approved: already spoken for.
  SELECT a.against_voucher_id AS voucher_id, p.party_id, sum(a.amount) AS pending
    FROM finance.supplier_payment_allocation a
    JOIN finance.supplier_payment p ON p.id = a.payment_id
    JOIN finance.voucher pv ON pv.id = p.voucher_id AND pv.status = 'draft'
   GROUP BY a.against_voucher_id, p.party_id
)
SELECT r.authority_id, r.currency, r.party_id, pt.name AS party_name, pt.reference AS party_reference,
       r.ledger_account_id, r.voucher_id, r.voucher_no, r.voucher_type, r.document_date,
       si.id AS supplier_invoice_id, COALESCE(si.supplier_ref, r.reference) AS document_ref, si.due_date,
       r.raised::numeric(18,2) AS raised_amount,
       COALESCE(s.settled, 0)::numeric(18,2) AS settled_amount,
       (r.raised - COALESCE(s.settled, 0))::numeric(18,2) AS outstanding_amount,
       COALESCE(pd.pending, 0)::numeric(18,2) AS pending_amount,
       (r.raised - COALESCE(s.settled, 0) - COALESCE(pd.pending, 0))::numeric(18,2) AS payable_amount,
       s.last_paid_on,
       CURRENT_DATE - r.document_date AS days_outstanding,
       GREATEST(CURRENT_DATE - COALESCE(si.due_date, r.document_date), 0) AS days_overdue
  FROM raised r
  LEFT JOIN settled s ON s.voucher_id = r.voucher_id AND NOT s.party_id IS DISTINCT FROM r.party_id
  LEFT JOIN pending pd ON pd.voucher_id = r.voucher_id AND NOT pd.party_id IS DISTINCT FROM r.party_id
  LEFT JOIN finance.party pt ON pt.id = r.party_id
  LEFT JOIN finance.supplier_invoice si ON si.voucher_id = r.voucher_id;

COMMENT ON VIEW finance.v_creditor_open IS
  'Every payable raised in the ledger with what has been paid against it, what is still outstanding, '
  'and what draft payments already claim. Rows with outstanding_amount = 0 are settled. Read by '
  'the creditors screens and by finance.create_supplier_payment(), so they cannot disagree.';

-- ── A document's voucher lines are written by its function only ───────────────────────────────
CREATE OR REPLACE FUNCTION finance.guard_document_voucher_lines() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
DECLARE v_type text;
BEGIN
  IF COALESCE(current_setting('finance.document_write', true), '') = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT v.voucher_type INTO v_type FROM finance.voucher v WHERE v.id = COALESCE(NEW.voucher_id, OLD.voucher_id);
  IF FOUND AND v_type IN ('supplier_invoice', 'payment', 'depreciation', 'asset_disposal') THEN
    RAISE EXCEPTION 'the lines of a % voucher are written by its document and cannot be edited as a journal', replace(v_type, '_', ' ')
      USING ERRCODE = '23514', HINT = 'Discard the draft document and capture it again, or reverse it once posted.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'finance.voucher_line'::regclass AND tgname = 'trg_voucher_line_document_guard') THEN
    CREATE TRIGGER trg_voucher_line_document_guard
      BEFORE INSERT OR UPDATE OR DELETE ON finance.voucher_line
      FOR EACH ROW EXECUTE FUNCTION finance.guard_document_voucher_lines();
  END IF;
END $$;

-- ── Capturing a supplier invoice ──────────────────────────────────────────────────────────────
-- p_lines: [{ ledger_account_id, description?, net_amount, tax_amount?, department_id?, budget_line_id?, project_id? }]
CREATE OR REPLACE FUNCTION finance.create_supplier_invoice(
  p_party_id uuid, p_currency text, p_financial_year_id uuid, p_posting_date date, p_invoice_date date,
  p_due_date date, p_supplier_ref text, p_payable_account_id uuid, p_tax_account_id uuid,
  p_narration text, p_lines jsonb, p_user uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  pt record; pa record; ta record;
  v_net numeric; v_tax numeric; v_count integer;
  v_no text; v_voucher uuid; v_invoice uuid; v_authority integer;
BEGIN
  SELECT id, name, party_type, status, authority_id INTO pt FROM finance.party WHERE id = p_party_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'that supplier is not in the party register' USING ERRCODE = '23503'; END IF;
  IF pt.status <> 'active' THEN RAISE EXCEPTION 'supplier % is inactive', pt.name USING ERRCODE = '23514'; END IF;
  v_authority := pt.authority_id;

  SELECT code, name, account_type INTO pa FROM finance.ledger_account WHERE id = p_payable_account_id AND deleted_at IS NULL;
  IF NOT FOUND OR pa.account_type IS DISTINCT FROM 'payable' THEN
    RAISE EXCEPTION 'the account credited by a supplier invoice must be a payable control account' USING ERRCODE = '23514',
      HINT = 'Mark the creditors control account as payable in the chart of accounts.';
  END IF;

  SELECT COALESCE(sum((l->>'net_amount')::numeric), 0), COALESCE(sum(COALESCE((l->>'tax_amount')::numeric, 0)), 0), count(*)
    INTO v_net, v_tax, v_count FROM jsonb_array_elements(p_lines) l;
  IF v_count = 0 THEN RAISE EXCEPTION 'a supplier invoice needs at least one line' USING ERRCODE = '23514'; END IF;
  IF v_tax > 0 THEN
    SELECT code, account_type INTO ta FROM finance.ledger_account WHERE id = p_tax_account_id AND deleted_at IS NULL;
    IF NOT FOUND OR ta.account_type IS DISTINCT FROM 'tax' THEN
      RAISE EXCEPTION 'an invoice carrying tax must name the tax account the input tax is posted to' USING ERRCODE = '23514',
        HINT = 'Mark the VAT control account as a tax account in the chart of accounts.';
    END IF;
  END IF;
  IF p_invoice_date > p_posting_date THEN
    RAISE EXCEPTION 'an invoice dated % cannot be posted on %, before it was raised', p_invoice_date, p_posting_date USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('finance.document_write', 'on', true);
  v_no := finance.next_document_no(v_authority, 'supplier_invoice');
  INSERT INTO finance.voucher
    (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date, document_date,
     narration, reference, status, prepared_by)
  VALUES (v_authority, v_no, 'supplier_invoice', p_currency::finance.currency_code, p_financial_year_id, p_posting_date,
          p_invoice_date, COALESCE(NULLIF(btrim(p_narration), ''), 'Invoice ' || btrim(p_supplier_ref) || ' from ' || pt.name),
          left(btrim(p_supplier_ref), 120), 'draft', p_user)
  RETURNING id INTO v_voucher;

  INSERT INTO finance.supplier_invoice
    (authority_id, invoice_no, supplier_ref, party_id, currency, invoice_date, due_date, financial_year_id,
     payable_account_id, tax_account_id, net_total, tax_total, narration, voucher_id, prepared_by)
  VALUES (v_authority, v_no, btrim(p_supplier_ref), p_party_id, p_currency::finance.currency_code, p_invoice_date, p_due_date,
          p_financial_year_id, p_payable_account_id, CASE WHEN v_tax > 0 THEN p_tax_account_id END, v_net, v_tax,
          NULLIF(btrim(p_narration), ''), v_voucher, p_user)
  RETURNING id INTO v_invoice;

  INSERT INTO finance.supplier_invoice_line
    (authority_id, invoice_id, line_no, ledger_account_id, description, net_amount, tax_amount, department_id, budget_line_id, project_id)
  SELECT v_authority, v_invoice, l.ordinality, (l.value->>'ledger_account_id')::uuid, NULLIF(btrim(l.value->>'description'), ''),
         (l.value->>'net_amount')::numeric, COALESCE((l.value->>'tax_amount')::numeric, 0),
         NULLIF(l.value->>'department_id', '')::uuid, NULLIF(l.value->>'budget_line_id', '')::uuid, NULLIF(l.value->>'project_id', '')::uuid
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY l;

  INSERT INTO finance.voucher_line
    (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, department_id, budget_line_id, project_id, narration)
  SELECT v_authority, v_voucher, il.line_no, il.ledger_account_id, il.net_amount, 0, il.department_id, il.budget_line_id, il.project_id,
         left(COALESCE(il.description, 'Invoice ' || btrim(p_supplier_ref)), 500)
    FROM finance.supplier_invoice_line il WHERE il.invoice_id = v_invoice;
  IF v_tax > 0 THEN
    INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
    VALUES (v_authority, v_voucher, v_count + 1, p_tax_account_id, v_tax, 0, 'Input tax on invoice ' || btrim(p_supplier_ref));
  END IF;
  INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, party_id, narration)
  VALUES (v_authority, v_voucher, v_count + 2, p_payable_account_id, 0, v_net + v_tax, p_party_id,
          'Invoice ' || btrim(p_supplier_ref) || ' from ' || pt.name);
  PERFORM set_config('finance.document_write', 'off', true);
  RETURN v_invoice;
END $$;

-- ── Preparing a payment ───────────────────────────────────────────────────────────────────────
-- p_allocations: [{ against_voucher_id, amount }]. Every document paid is the same supplier's, in
-- the same currency and on the same payable account, and none is paid beyond what is still open.
CREATE OR REPLACE FUNCTION finance.create_supplier_payment(
  p_party_id uuid, p_currency text, p_financial_year_id uuid, p_payment_date date, p_bank_account_id uuid,
  p_method text, p_reference text, p_narration text, p_allocations jsonb, p_user uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  pt record; ba record; a record; o record;
  v_total numeric := 0; v_count integer := 0;
  v_payable uuid; v_no text; v_voucher uuid; v_payment uuid; v_line integer := 0;
BEGIN
  SELECT id, name, authority_id INTO pt FROM finance.party WHERE id = p_party_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'that supplier is not in the party register' USING ERRCODE = '23503'; END IF;
  SELECT code, name, account_type, is_postable, status INTO ba FROM finance.ledger_account WHERE id = p_bank_account_id AND deleted_at IS NULL;
  IF NOT FOUND OR ba.account_type NOT IN ('bank', 'cash') THEN
    RAISE EXCEPTION 'a payment is made from a bank or cash account' USING ERRCODE = '23514';
  END IF;

  -- Serialise payments to one supplier, so two people cannot each draft a payment for the same invoice.
  PERFORM pg_advisory_xact_lock(hashtext('finance.supplier_payment'), hashtext(p_party_id::text));

  FOR a IN SELECT (x->>'against_voucher_id')::uuid AS voucher_id, (x->>'amount')::numeric AS amount
             FROM jsonb_array_elements(p_allocations) x LOOP
    IF a.amount IS NULL OR a.amount <= 0 THEN RAISE EXCEPTION 'each amount paid must be positive' USING ERRCODE = '23514'; END IF;
    SELECT * INTO o FROM finance.v_creditor_open c
     WHERE c.voucher_id = a.voucher_id AND c.party_id = p_party_id AND c.currency::text = p_currency;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'a document chosen for payment is not owed to % in %', pt.name, p_currency USING ERRCODE = '23514';
    END IF;
    IF a.amount > o.payable_amount THEN
      RAISE EXCEPTION '% % is being paid against % and only % is still open on it', p_currency, a.amount, o.voucher_no, o.payable_amount
        USING ERRCODE = '23514',
              HINT = 'What is open counts payments already drafted and awaiting approval. A supplier is never paid beyond what is owed.';
    END IF;
    IF v_payable IS NOT NULL AND v_payable <> o.ledger_account_id THEN
      RAISE EXCEPTION 'the documents chosen sit on two different payable accounts; pay them with separate vouchers' USING ERRCODE = '23514';
    END IF;
    v_payable := o.ledger_account_id;
    v_total := v_total + a.amount; v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN RAISE EXCEPTION 'choose at least one document to pay' USING ERRCODE = '23514'; END IF;

  PERFORM set_config('finance.document_write', 'on', true);
  v_no := finance.next_document_no(pt.authority_id, 'payment');
  INSERT INTO finance.voucher
    (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date, narration, reference, status, prepared_by)
  VALUES (pt.authority_id, v_no, 'payment', p_currency::finance.currency_code, p_financial_year_id, p_payment_date,
          COALESCE(NULLIF(btrim(p_narration), ''), 'Payment to ' || pt.name), NULLIF(left(btrim(p_reference), 120), ''), 'draft', p_user)
  RETURNING id INTO v_voucher;

  INSERT INTO finance.supplier_payment
    (authority_id, payment_no, party_id, currency, payment_date, financial_year_id, bank_account_id, payable_account_id,
     method, reference, total, narration, voucher_id, prepared_by)
  VALUES (pt.authority_id, v_no, p_party_id, p_currency::finance.currency_code, p_payment_date, p_financial_year_id,
          p_bank_account_id, v_payable, p_method, NULLIF(btrim(p_reference), ''), v_total, NULLIF(btrim(p_narration), ''), v_voucher, p_user)
  RETURNING id INTO v_payment;

  FOR a IN SELECT (x->>'against_voucher_id')::uuid AS voucher_id, (x->>'amount')::numeric AS amount
             FROM jsonb_array_elements(p_allocations) x LOOP
    v_line := v_line + 1;
    INSERT INTO finance.supplier_payment_allocation (authority_id, payment_id, against_voucher_id, amount)
    VALUES (pt.authority_id, v_payment, a.voucher_id, a.amount);
    INSERT INTO finance.voucher_line
      (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, party_id, against_voucher_id, narration)
    VALUES (pt.authority_id, v_voucher, v_line, v_payable, a.amount, 0, p_party_id, a.voucher_id, 'Payment ' || v_no || ' to ' || pt.name);
  END LOOP;
  INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
  VALUES (pt.authority_id, v_voucher, v_line + 1, p_bank_account_id, 0, v_total,
          'Payment ' || v_no || ' to ' || pt.name || COALESCE(', ' || NULLIF(btrim(p_reference), ''), ''));
  PERFORM set_config('finance.document_write', 'off', true);
  RETURN v_payment;
END $$;

-- Discard a draft document with its voucher. A posted one is corrected by a reversal.
CREATE OR REPLACE FUNCTION finance.discard_payables_document(p_kind text, p_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_voucher uuid; v_status text; v_no text;
BEGIN
  IF p_kind = 'invoice' THEN
    SELECT i.voucher_id, i.invoice_no INTO v_voucher, v_no FROM finance.supplier_invoice i WHERE i.id = p_id FOR UPDATE;
  ELSE
    SELECT p.voucher_id, p.payment_no INTO v_voucher, v_no FROM finance.supplier_payment p WHERE p.id = p_id FOR UPDATE;
  END IF;
  IF v_voucher IS NULL THEN RAISE EXCEPTION 'no such document' USING ERRCODE = '23503'; END IF;
  SELECT status INTO v_status FROM finance.voucher WHERE id = v_voucher FOR UPDATE;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION '% is % and can no longer be discarded', v_no, v_status USING ERRCODE = '23514',
      HINT = 'A posted document is corrected by a reversal, and both stay on the record.';
  END IF;
  PERFORM set_config('finance.document_write', 'on', true);
  IF p_kind = 'invoice' THEN DELETE FROM finance.supplier_invoice WHERE id = p_id;
  ELSE DELETE FROM finance.supplier_payment WHERE id = p_id; END IF;
  DELETE FROM finance.voucher WHERE id = v_voucher;
  PERFORM set_config('finance.document_write', 'off', true);
  RETURN v_no;
END $$;

-- ── Permissions ───────────────────────────────────────────────────────────────────────────────
INSERT INTO finance.permission (code, label, category, is_approval, is_publication, is_restricted, description) VALUES
  ('finance.payables.view',            'View creditors',              'payables', false, false, false, 'Supplier invoices, payment vouchers and what is owed to each supplier.'),
  ('finance.payables.invoice.prepare', 'Capture supplier invoices',   'payables', false, false, false, 'Capture a supplier''s invoice as a draft. It posts nothing until somebody else approves it.'),
  ('finance.payables.invoice.approve', 'Approve supplier invoices',   'payables', true,  false, false, 'Approve a captured invoice, which posts it to the book of account. Never the person who captured it.'),
  ('finance.payables.payment.prepare', 'Prepare payment vouchers',    'payables', false, false, false, 'Prepare a payment against what is owed to a supplier. It pays nothing until somebody else approves it.'),
  ('finance.payables.payment.approve', 'Approve payment vouchers',    'payables', true,  false, false, 'Approve a payment voucher, which posts it. Never the person who prepared it.')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, is_approval = EXCLUDED.is_approval,
      is_publication = EXCLUDED.is_publication, is_restricted = EXCLUDED.is_restricted, description = EXCLUDED.description;

INSERT INTO finance.role_permission (role_name, permission_code)
SELECT r, c FROM (VALUES
  ('accountant', 'finance.payables.view'), ('accountant', 'finance.payables.invoice.prepare'),
  ('accountant', 'finance.payables.invoice.approve'), ('accountant', 'finance.payables.payment.prepare'),
  ('accountant', 'finance.payables.payment.approve'),
  ('finance_admin', 'finance.payables.view'), ('finance_admin', 'finance.payables.invoice.prepare'),
  ('finance_admin', 'finance.payables.invoice.approve'), ('finance_admin', 'finance.payables.payment.prepare'),
  ('finance_admin', 'finance.payables.payment.approve'),
  ('finance_officer', 'finance.payables.view'), ('finance_officer', 'finance.payables.invoice.prepare'),
  ('finance_officer', 'finance.payables.payment.prepare'),
  ('finance_committee', 'finance.payables.view'), ('accounting_officer', 'finance.payables.view'), ('auditor', 'finance.payables.view')
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

DO $$
DECLARE r text;
  tables text[] := ARRAY['finance.supplier_invoice', 'finance.supplier_invoice_line', 'finance.supplier_payment', 'finance.supplier_payment_allocation'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    FOREACH r IN ARRAY tables LOOP PERFORM tenancy.classify(r, 'pending', 'creditors data awaiting the authority it belongs to'); END LOOP;
    RETURN;
  END IF;
  FOREACH r IN ARRAY tables LOOP PERFORM tenancy.make_tenant(r::regclass, 'VUNGU'); END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT SELECT ON finance.v_creditor_open TO vungu_app;
  END IF;
  PERFORM tenancy.classify('finance.v_creditor_open', 'tenant_view', 'runs as the caller (security_invoker); the underlying policies decide the rows');
END $$;
