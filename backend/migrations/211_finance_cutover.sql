-- 211: cut-over from the Council's current accounting package (Pastel, Sage, Promun).
--
-- Design: docs/superpowers/specs/2026-11-11-finance-enterprise-reengineering-design.md §7 (loads
-- M1–M4), docs/superpowers/specs/2026-11-10-general-ledger-architecture.md §6 (parallel run, G12),
-- and docs/superpowers/specs/2026-11-13-accountant-full-system-design.md §3 (frontend repo).
-- Routes that depend on this: src/routes/finance-migration.js.
-- Rollback: migrations/rollback/211_finance_cutover.down.sql.
--
-- WHAT A CUT-OVER IS HERE
-- One row of finance.cutover names the package being left, the date the opening position is taken
-- at, and the financial year it falls in. Files from the old package are loaded against it, one
-- finance.migration_batch per file:
--
--   chart              the old chart of accounts. Every old code ends MAPPED to a ledger account
--                      (created here or already in the chart) or RETIRED with a reason, and the
--                      old-code → account table is kept permanently (finance.account_code_map).
--   parties            the customer and supplier masters → finance.party. A possible duplicate is
--                      decided by a person; nothing is merged on a similar name.
--   opening_balance    the trial balance at the cut-over date, ONE CURRENCY PER FILE → one draft
--                      `opening` voucher, which must balance to nil and is posted like any other
--                      voucher, by somebody other than whoever loaded it.
--   open_items         the debtors or creditors age analysis by document → one draft `opening`
--                      voucher per open document, so ageing continues from each document's TRUE
--                      date (finance.voucher.document_date, added below) rather than restarting
--                      at the cut-over. Their total must equal the control account's balance in
--                      the opening trial balance, to the cent, or nothing is written.
--   comparison_balance a trial balance from the old package at a later date, for the parallel run.
--
-- HOW OPEN ITEMS REACH THE LEDGER WITHOUT COUNTING THE DEBT TWICE
-- The opening trial balance already posts the receivable control account as one figure with no
-- party. Each open item then posts WITHIN the control account: Dr control (the debtor, the
-- document) / Cr control (no party, against the opening voucher). The control account's balance is
-- unchanged; finance.v_debtor_ageing sees the party-less opening figure as settled by those
-- transfers and each document as a bill of its own. No suspense account is involved, so there is
-- none to be left carrying a balance.
--
-- RECONCILIATION, AND THE REFUSAL (acceptance check G12)
-- finance.cutover_reconciliation compares, per ledger account and per currency, what the old
-- package says with what this ledger holds at the same date. A difference is either nil or carries
-- a written explanation. finance.sign_off_cutover() refuses while any unexplained difference is
-- non-nil, while any loaded voucher is still a draft, and when the person signing loaded any of the
-- files. The reconciliation is kept as the evidence for the change of book of account (D16, D23).
--
-- WHAT IS NOT DECIDED HERE
-- Which package and version, the cut-over date and who signs are Council decision D23. The grants
-- below give sign-off to the Director of Finance as a default the Council can change; no cut-over
-- row is seeded and nothing is migrated by this file.
--
-- IDEMPOTENT. Safe to re-run.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. THE DOCUMENT'S OWN DATE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- `posting_date` is the day a voucher reaches the book and decides its period. A document can be
-- older than that: an invoice of March brought across in a July cut-over, or a supplier invoice
-- dated last week and captured today. Ageing counts from the document, not from when it was keyed.
ALTER TABLE finance.voucher ADD COLUMN IF NOT EXISTS document_date date;

COMMENT ON COLUMN finance.voucher.document_date IS
  'The date on the document itself, when it differs from the posting date. Ageing is measured from '
  'COALESCE(document_date, posting_date). NULL for every voucher raised before migration 211.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voucher_document_date_not_after_posting') THEN
    ALTER TABLE finance.voucher ADD CONSTRAINT voucher_document_date_not_after_posting
      CHECK (document_date IS NULL OR document_date <= posting_date);
  END IF;
END $$;

-- A posted voucher's document date is part of what was posted: changing it afterwards would move a
-- debt between ageing columns with no entry to show for it.
CREATE OR REPLACE FUNCTION finance.refuse_posted_document_date_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'posted' AND NEW.document_date IS DISTINCT FROM OLD.document_date THEN
    RAISE EXCEPTION 'voucher % is posted and its document date can no longer be changed', OLD.voucher_no
      USING ERRCODE = '23514', HINT = 'Reverse the voucher and raise it again with the right date.';
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'finance.voucher'::regclass
                    AND tgname = 'trg_voucher_document_date_frozen') THEN
    CREATE TRIGGER trg_voucher_document_date_frozen
      BEFORE UPDATE OF document_date ON finance.voucher
      FOR EACH ROW EXECUTE FUNCTION finance.refuse_posted_document_date_change();
  END IF;
END $$;

-- Debtor ageing, unchanged in every respect but one: age runs from the document's own date.
-- `aged_from` is appended (CREATE OR REPLACE VIEW can only add columns at the end), and for every
-- voucher without a document date it equals posting_date, so nothing already posted moves.
CREATE OR REPLACE VIEW finance.v_debtor_ageing WITH (security_invoker = true) AS
WITH receivable AS (
  SELECT e.authority_id, e.currency, e.party_id, e.ledger_account_id, e.voucher_id, e.voucher_no,
         e.voucher_type, e.posting_date, e.debit, e.credit,
         COALESCE(e.against_voucher_id, v.reverses_voucher_id) AS acts_on,
         COALESCE(v.document_date, e.posting_date) AS aged_from
    FROM finance.ledger_entry e
    JOIN finance.voucher v ON v.id = e.voucher_id
   WHERE EXISTS (SELECT 1 FROM finance.ledger_account la
                  WHERE la.id = e.ledger_account_id AND la.account_type = 'receivable')
), billed AS (
  SELECT r.authority_id, r.currency, r.party_id, r.ledger_account_id, r.voucher_id, r.voucher_no,
         r.voucher_type, r.posting_date, r.aged_from, sum(r.debit)::finance.money AS billed_amount
    FROM receivable r
   WHERE r.acts_on IS NULL AND r.debit > 0
   GROUP BY r.authority_id, r.currency, r.party_id, r.ledger_account_id, r.voucher_id, r.voucher_no,
            r.voucher_type, r.posting_date, r.aged_from
), unmatched AS (
  SELECT r.authority_id, r.currency, r.party_id, r.ledger_account_id, r.voucher_id, r.voucher_no,
         r.voucher_type, r.posting_date, r.aged_from, sum(r.credit)::finance.money AS credit_amount
    FROM receivable r
   WHERE r.acts_on IS NULL AND r.credit > 0
   GROUP BY r.authority_id, r.currency, r.party_id, r.ledger_account_id, r.voucher_id, r.voucher_no,
            r.voucher_type, r.posting_date, r.aged_from
), movement AS (
  SELECT r.acts_on AS voucher_id, r.currency, r.party_id,
         sum(r.credit - r.debit) AS net_credit,
         max(r.posting_date) FILTER (WHERE r.credit > 0) AS last_credit_on
    FROM receivable r
   WHERE r.acts_on IS NOT NULL
   GROUP BY r.acts_on, r.currency, r.party_id
), stray AS (
  SELECT r.authority_id, r.currency, r.party_id, r.ledger_account_id, r.voucher_id, r.voucher_no,
         r.voucher_type, r.posting_date, r.aged_from,
         sum(r.debit) AS debit_amount, sum(r.credit) AS credit_amount
    FROM receivable r
   WHERE r.acts_on IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM billed b
                      WHERE b.voucher_id = r.acts_on AND b.currency::text = r.currency::text
                        AND NOT b.party_id IS DISTINCT FROM r.party_id)
     AND NOT EXISTS (SELECT 1 FROM unmatched u
                      WHERE u.voucher_id = r.acts_on AND u.currency::text = r.currency::text
                        AND NOT u.party_id IS DISTINCT FROM r.party_id)
   GROUP BY r.authority_id, r.currency, r.party_id, r.ledger_account_id, r.voucher_id, r.voucher_no,
            r.voucher_type, r.posting_date, r.aged_from
)
SELECT b.authority_id, b.currency, b.party_id, p.name AS party_name, p.reference AS party_reference,
       b.ledger_account_id, b.voucher_id, b.voucher_no, b.voucher_type, b.posting_date,
       b.billed_amount,
       COALESCE(m.net_credit, 0)::finance.money AS settled_amount,
       (b.billed_amount - COALESCE(m.net_credit, 0))::finance.money AS outstanding_amount,
       m.last_credit_on AS last_settled_on,
       CURRENT_DATE - b.aged_from AS days_outstanding,
       CASE WHEN (b.billed_amount - COALESCE(m.net_credit, 0)) = 0 THEN 'settled'
            ELSE finance.ageing_bucket(CURRENT_DATE - b.aged_from) END AS ageing_bucket,
       b.aged_from
  FROM billed b
  LEFT JOIN movement m ON m.voucher_id = b.voucher_id AND m.currency::text = b.currency::text
                      AND NOT m.party_id IS DISTINCT FROM b.party_id
  LEFT JOIN finance.party p ON p.id = b.party_id
UNION ALL
SELECT u.authority_id, u.currency, u.party_id, p.name, p.reference,
       u.ledger_account_id, u.voucher_id, u.voucher_no, u.voucher_type, u.posting_date,
       0::finance.money,
       (u.credit_amount + COALESCE(m.net_credit, 0))::finance.money,
       (-(u.credit_amount + COALESCE(m.net_credit, 0)))::finance.money,
       NULL::date,
       CURRENT_DATE - u.aged_from,
       'unallocated'::text,
       u.aged_from
  FROM unmatched u
  LEFT JOIN movement m ON m.voucher_id = u.voucher_id AND m.currency::text = u.currency::text
                      AND NOT m.party_id IS DISTINCT FROM u.party_id
                      AND NOT EXISTS (SELECT 1 FROM billed b
                                       WHERE b.voucher_id = u.voucher_id
                                         AND b.currency::text = u.currency::text
                                         AND NOT b.party_id IS DISTINCT FROM u.party_id)
  LEFT JOIN finance.party p ON p.id = u.party_id
 WHERE (u.credit_amount + COALESCE(m.net_credit, 0)) <> 0
UNION ALL
SELECT s.authority_id, s.currency, s.party_id, p.name, p.reference,
       s.ledger_account_id, s.voucher_id, s.voucher_no, s.voucher_type, s.posting_date,
       s.debit_amount::finance.money,
       s.credit_amount::finance.money,
       (s.debit_amount - s.credit_amount)::finance.money,
       NULL::date,
       CURRENT_DATE - s.aged_from,
       CASE WHEN (s.debit_amount - s.credit_amount) > 0
            THEN finance.ageing_bucket(CURRENT_DATE - s.aged_from) ELSE 'unallocated' END,
       s.aged_from
  FROM stray s
  LEFT JOIN finance.party p ON p.id = s.party_id
 WHERE (s.debit_amount - s.credit_amount) <> 0;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. OPENING VOUCHER NUMBERS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE finance.document_sequence DROP CONSTRAINT IF EXISTS document_sequence_kind_known;
ALTER TABLE finance.document_sequence ADD CONSTRAINT document_sequence_kind_known
  CHECK (kind IN ('receipt', 'cashier_session', 'bank_deposit', 'opening'));

CREATE OR REPLACE FUNCTION finance.next_document_no(p_authority_id integer, p_kind text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_no bigint;
  v_prefix text;
BEGIN
  v_prefix := CASE p_kind WHEN 'receipt' THEN 'RC' WHEN 'cashier_session' THEN 'CS'
                          WHEN 'bank_deposit' THEN 'BD' WHEN 'opening' THEN 'OB' END;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'no document sequence is kept for %', p_kind USING ERRCODE = '23514';
  END IF;
  INSERT INTO finance.document_sequence AS s (authority_id, kind, last_no)
  VALUES (p_authority_id, p_kind, 1)
  ON CONFLICT (authority_id, kind) DO UPDATE SET last_no = s.last_no + 1
  RETURNING s.last_no INTO v_no;
  RETURN v_prefix || '-' || lpad(v_no::text, 7, '0');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3. THE CUT-OVER AND ITS FILES
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS finance.cutover (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  name              text NOT NULL CONSTRAINT cutover_name_length CHECK (length(btrim(name)) BETWEEN 3 AND 160),
  source_system     text NOT NULL CONSTRAINT cutover_source_known
                    CHECK (source_system IN ('pastel_partner', 'pastel_xpress', 'sage_evolution',
                                             'promun', 'spreadsheet', 'other')),
  source_version    text,
  -- The opening position is posted ON this date: it is the first day kept in this ledger, and the
  -- balances are the old package's closing balances of the day before.
  cutover_date      date NOT NULL,
  financial_year_id uuid NOT NULL REFERENCES finance.financial_year (id),
  status            text NOT NULL DEFAULT 'preparing' CONSTRAINT cutover_status_known
                    CHECK (status IN ('preparing', 'signed_off', 'abandoned')),
  signed_off_by     uuid REFERENCES public.users (id),
  signed_off_at     timestamptz,
  sign_off_note     text,
  abandoned_by      uuid REFERENCES public.users (id),
  abandoned_at      timestamptz,
  abandon_reason    text,
  created_by        uuid NOT NULL REFERENCES public.users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cutover_signed_is_attributed CHECK (
    (status = 'signed_off') = (signed_off_by IS NOT NULL AND signed_off_at IS NOT NULL)),
  CONSTRAINT cutover_signer_is_not_its_author CHECK (signed_off_by IS NULL OR signed_off_by <> created_by),
  CONSTRAINT cutover_abandoned_is_explained CHECK (
    status <> 'abandoned' OR length(btrim(COALESCE(abandon_reason, ''))) >= 3)
);
-- One cut-over in progress at a time: two would each claim the opening position.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cutover_in_progress
  ON finance.cutover (authority_id) WHERE status = 'preparing';

COMMENT ON TABLE finance.cutover IS
  'A cut-over from the Council''s previous accounting package: the package, the date the opening '
  'position is taken at, and its sign-off. Which package, which date and who signs are Council '
  'decision D23.';

CREATE TABLE IF NOT EXISTS finance.migration_batch (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  cutover_id        uuid NOT NULL REFERENCES finance.cutover (id),
  load_kind         text NOT NULL CONSTRAINT migration_batch_kind_known
                    CHECK (load_kind IN ('chart', 'parties', 'opening_balance', 'open_items',
                                         'comparison_balance')),
  -- The balance loads are per currency, because the ledger is (two books, decision 1).
  currency          finance.currency_code,
  -- open_items: which side, and which control account the documents sit in.
  item_side         text CONSTRAINT migration_batch_side_known CHECK (item_side IN ('debtors', 'creditors')),
  control_account_id uuid REFERENCES finance.ledger_account (id),
  -- comparison_balance: the date the old package's figures are at.
  as_at             date,
  original_filename text NOT NULL,
  stored_object_key text NOT NULL,
  file_hash         text NOT NULL,
  file_size_bytes   bigint NOT NULL,
  headers           jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- target field → the file's column heading, as a person confirmed it.
  column_map        jsonb NOT NULL DEFAULT '{}'::jsonb,
  options           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'uploaded' CONSTRAINT migration_batch_status_known
                    CHECK (status IN ('uploaded', 'validated', 'committed', 'cancelled', 'withdrawn')),
  rows_total        integer NOT NULL DEFAULT 0,
  rows_ready        integer NOT NULL DEFAULT 0,
  rows_problem      integer NOT NULL DEFAULT 0,
  rows_set_aside    integer NOT NULL DEFAULT 0,
  total_debit       finance.money,
  total_credit      finance.money,
  -- What the Council says the file should total, from the old package's own printed report.
  declared_total    finance.money,
  uploaded_by       uuid NOT NULL REFERENCES public.users (id),
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  validated_at      timestamptz,
  committed_by      uuid REFERENCES public.users (id),
  committed_at      timestamptz,
  withdrawn_by      uuid REFERENCES public.users (id),
  withdrawn_at      timestamptz,
  withdraw_reason   text,
  result            jsonb,
  CONSTRAINT migration_batch_balance_names_currency CHECK (
    load_kind NOT IN ('opening_balance', 'open_items', 'comparison_balance') OR currency IS NOT NULL),
  CONSTRAINT migration_batch_items_name_their_account CHECK (
    load_kind <> 'open_items' OR (item_side IS NOT NULL AND control_account_id IS NOT NULL)),
  CONSTRAINT migration_batch_comparison_is_dated CHECK (load_kind <> 'comparison_balance' OR as_at IS NOT NULL),
  CONSTRAINT migration_batch_committed_is_attributed CHECK (
    status NOT IN ('committed', 'withdrawn') OR (committed_by IS NOT NULL AND committed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_migration_batch_cutover ON finance.migration_batch (cutover_id, load_kind);
-- The same bytes are not committed twice for the same load.
CREATE UNIQUE INDEX IF NOT EXISTS uq_migration_batch_committed_file
  ON finance.migration_batch (cutover_id, load_kind, file_hash) WHERE status = 'committed';
-- One opening trial balance per currency: a second would double the opening position.
CREATE UNIQUE INDEX IF NOT EXISTS uq_migration_batch_one_opening
  ON finance.migration_batch (cutover_id, currency)
  WHERE status = 'committed' AND load_kind = 'opening_balance';
-- One open-item list per control account and currency, for the same reason.
CREATE UNIQUE INDEX IF NOT EXISTS uq_migration_batch_one_item_list
  ON finance.migration_batch (cutover_id, currency, control_account_id)
  WHERE status = 'committed' AND load_kind = 'open_items';

COMMENT ON TABLE finance.migration_batch IS
  'One file from the previous accounting package, loaded against a cut-over. The original bytes '
  'are kept on disk under stored_object_key with their SHA-256 here.';

CREATE TABLE IF NOT EXISTS finance.migration_row (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id  integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  batch_id      uuid NOT NULL REFERENCES finance.migration_batch (id) ON DELETE CASCADE,
  row_no        integer NOT NULL,
  raw           jsonb NOT NULL,
  -- What the row means once read: the fields the commit function consumes.
  parsed        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- ready: will be written. problem: needs a person. set_aside: deliberately not written, with why.
  status        text NOT NULL DEFAULT 'problem' CONSTRAINT migration_row_status_known
                CHECK (status IN ('ready', 'problem', 'set_aside')),
  problems      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- A person's decision about this row, kept across re-validation.
  decision      jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by    uuid REFERENCES public.users (id),
  decided_at    timestamptz,
  CONSTRAINT migration_row_no_positive CHECK (row_no > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_migration_row_no ON finance.migration_row (batch_id, row_no);
CREATE INDEX IF NOT EXISTS idx_migration_row_status ON finance.migration_row (batch_id, status);

-- The permanent record of where every old account code went. Kept after sign-off: it is how a
-- figure in an old report is found in this ledger years later.
CREATE TABLE IF NOT EXISTS finance.account_code_map (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  cutover_id        uuid NOT NULL REFERENCES finance.cutover (id),
  source_code       text NOT NULL,
  source_name       text,
  source_category   text,
  disposition       text NOT NULL CONSTRAINT account_code_map_disposition_known
                    CHECK (disposition IN ('mapped', 'retired')),
  ledger_account_id uuid REFERENCES finance.ledger_account (id),
  note              text,
  batch_id          uuid REFERENCES finance.migration_batch (id),
  created_by        uuid NOT NULL REFERENCES public.users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES public.users (id),
  updated_at        timestamptz,
  CONSTRAINT account_code_map_mapped_names_account CHECK (
    (disposition = 'mapped') = (ledger_account_id IS NOT NULL)),
  CONSTRAINT account_code_map_retired_is_explained CHECK (
    disposition <> 'retired' OR length(btrim(COALESCE(note, ''))) >= 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_code_map_code
  ON finance.account_code_map (cutover_id, upper(source_code));
CREATE INDEX IF NOT EXISTS idx_account_code_map_account ON finance.account_code_map (ledger_account_id);

CREATE TABLE IF NOT EXISTS finance.party_source_map (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id  integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  cutover_id    uuid NOT NULL REFERENCES finance.cutover (id),
  source_kind   text NOT NULL CONSTRAINT party_source_map_kind_known CHECK (source_kind IN ('customer', 'supplier')),
  source_code   text NOT NULL,
  source_name   text,
  party_id      uuid NOT NULL REFERENCES finance.party (id),
  batch_id      uuid REFERENCES finance.migration_batch (id),
  created_by    uuid NOT NULL REFERENCES public.users (id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_party_source_map_code
  ON finance.party_source_map (cutover_id, source_kind, upper(source_code));

-- Which vouchers a batch raised, so they can be posted together and withdrawn together.
CREATE TABLE IF NOT EXISTS finance.migration_voucher (
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  batch_id     uuid NOT NULL REFERENCES finance.migration_batch (id),
  voucher_id   uuid NOT NULL REFERENCES finance.voucher (id) ON DELETE CASCADE,
  row_id       uuid REFERENCES finance.migration_row (id) ON DELETE SET NULL,
  PRIMARY KEY (batch_id, voucher_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_migration_voucher_voucher ON finance.migration_voucher (voucher_id);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4. THE RECONCILIATION
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS finance.cutover_reconciliation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id  integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  cutover_id    uuid NOT NULL REFERENCES finance.cutover (id),
  batch_id      uuid NOT NULL REFERENCES finance.migration_batch (id),
  -- opening: the opening trial balance against the ledger on the cut-over date.
  -- parallel_run: a later trial balance from the old package against the ledger at that date.
  kind          text NOT NULL CONSTRAINT cutover_reconciliation_kind_known CHECK (kind IN ('opening', 'parallel_run')),
  currency      finance.currency_code NOT NULL,
  as_at         date NOT NULL,
  refreshed_at  timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL REFERENCES public.users (id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cutover_reconciliation_batch ON finance.cutover_reconciliation (batch_id);
CREATE INDEX IF NOT EXISTS idx_cutover_reconciliation_cutover
  ON finance.cutover_reconciliation (cutover_id, currency, as_at);

CREATE TABLE IF NOT EXISTS finance.cutover_reconciliation_line (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  reconciliation_id uuid NOT NULL REFERENCES finance.cutover_reconciliation (id) ON DELETE CASCADE,
  -- NULL when the old package carries a balance on a code that was retired or never mapped: the
  -- figure has nowhere to be in this ledger, which is itself the difference to explain.
  ledger_account_id uuid REFERENCES finance.ledger_account (id),
  source_codes      text,
  -- Both signed debit-positive, like finance.v_account_balance.net_debit.
  source_net_debit  numeric(18,2) NOT NULL DEFAULT 0,
  ledger_net_debit  numeric(18,2) NOT NULL DEFAULT 0,
  difference        numeric(18,2) GENERATED ALWAYS AS (source_net_debit - ledger_net_debit) STORED,
  explanation       text,
  explained_by      uuid REFERENCES public.users (id),
  explained_at      timestamptz,
  CONSTRAINT cutover_reconciliation_line_explained_is_attributed CHECK (
    (explanation IS NULL) = (explained_by IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_cutover_reconciliation_line_run
  ON finance.cutover_reconciliation_line (reconciliation_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cutover_reconciliation_line_account
  ON finance.cutover_reconciliation_line (reconciliation_id, ledger_account_id)
  WHERE ledger_account_id IS NOT NULL;

COMMENT ON TABLE finance.cutover_reconciliation_line IS
  'One ledger account in one reconciliation: the old package''s balance, this ledger''s balance at '
  'the same date, and the difference. A non-nil difference needs a written explanation before the '
  'cut-over can be signed off (acceptance check G12). Kept permanently as audit evidence.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5. A SIGNED-OFF OR ABANDONED CUT-OVER IS CLOSED
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION finance.assert_cutover_open() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
DECLARE v_cutover uuid; v_status text;
BEGIN
  IF TG_TABLE_NAME = 'migration_row' THEN
    SELECT b.cutover_id INTO v_cutover FROM finance.migration_batch b
     WHERE b.id = COALESCE(NEW.batch_id, OLD.batch_id);
  ELSIF TG_TABLE_NAME = 'cutover_reconciliation_line' THEN
    SELECT r.cutover_id INTO v_cutover FROM finance.cutover_reconciliation r
     WHERE r.id = COALESCE(NEW.reconciliation_id, OLD.reconciliation_id);
  ELSE
    v_cutover := COALESCE(NEW.cutover_id, OLD.cutover_id);
  END IF;
  SELECT c.status INTO v_status FROM finance.cutover c WHERE c.id = v_cutover;
  IF v_status IS DISTINCT FROM 'preparing' THEN
    RAISE EXCEPTION 'this cut-over is % and its records can no longer be changed', replace(v_status, '_', ' ')
      USING ERRCODE = '23514',
            HINT = 'A signed-off cut-over is audit evidence. Start a new cut-over if another load is needed.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['migration_batch', 'migration_row', 'account_code_map', 'party_source_map',
                           'cutover_reconciliation', 'cutover_reconciliation_line'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = ('finance.' || t)::regclass
                      AND tgname = 'trg_' || t || '_cutover_open') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON finance.%I
                        FOR EACH ROW EXECUTE FUNCTION finance.assert_cutover_open()',
                     'trg_' || t || '_cutover_open', t);
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 6. THE COMMIT FUNCTIONS — THE ONLY WRITERS OF MIGRATED DATA
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The route reads the file and records what each row means in migration_row.parsed. What may then
-- be written, and the gates, are here, so a second route or a script cannot load by other rules.

CREATE OR REPLACE FUNCTION finance.lock_migration_batch(p_batch_id uuid, p_kind text)
RETURNS finance.migration_batch LANGUAGE plpgsql AS $$
DECLARE b finance.migration_batch; v_problems integer;
BEGIN
  SELECT * INTO b FROM finance.migration_batch WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'migration batch % does not exist', p_batch_id USING ERRCODE = '23503';
  END IF;
  IF b.load_kind <> p_kind THEN
    RAISE EXCEPTION 'batch % is a % load, not %', b.original_filename, b.load_kind, p_kind USING ERRCODE = '23514';
  END IF;
  IF b.status <> 'validated' THEN
    RAISE EXCEPTION 'file % is % and cannot be committed', b.original_filename, b.status
      USING ERRCODE = '23514', HINT = 'Check the file first; only a checked file can be committed.';
  END IF;
  SELECT count(*) INTO v_problems FROM finance.migration_row WHERE batch_id = p_batch_id AND status = 'problem';
  IF v_problems > 0 THEN
    RAISE EXCEPTION '% row(s) of % still need a decision', v_problems, b.original_filename
      USING ERRCODE = '23514',
            HINT = 'Every row is either loaded or set aside with a reason. Nothing is guessed.';
  END IF;
  RETURN b;
END $$;

-- ── M1: the chart of accounts ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION finance.commit_chart_batch(p_batch_id uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  b finance.migration_batch;
  r record;
  v_account uuid;
  v_created integer := 0; v_mapped integer := 0; v_retired integer := 0;
BEGIN
  b := finance.lock_migration_batch(p_batch_id, 'chart');

  FOR r IN SELECT * FROM finance.migration_row WHERE batch_id = p_batch_id ORDER BY row_no LOOP
    IF r.status = 'set_aside' AND r.parsed->>'action' = 'skip' THEN
      -- Already mapped by an earlier file of this cut-over; that mapping stands.
      CONTINUE;
    ELSIF r.status = 'set_aside' THEN
      INSERT INTO finance.account_code_map
        (authority_id, cutover_id, source_code, source_name, source_category, disposition, note, batch_id, created_by)
      VALUES (b.authority_id, b.cutover_id, r.parsed->>'code', r.parsed->>'name', r.parsed->>'category',
              'retired', COALESCE(NULLIF(btrim(r.decision->>'note'), ''), 'Not brought across'), b.id, p_user);
      v_retired := v_retired + 1;
    ELSIF r.parsed->>'action' = 'map' THEN
      INSERT INTO finance.account_code_map
        (authority_id, cutover_id, source_code, source_name, source_category, disposition,
         ledger_account_id, note, batch_id, created_by)
      VALUES (b.authority_id, b.cutover_id, r.parsed->>'code', r.parsed->>'name', r.parsed->>'category',
              'mapped', (r.parsed->>'ledger_account_id')::uuid, r.decision->>'note', b.id, p_user);
      v_mapped := v_mapped + 1;
    ELSE
      INSERT INTO finance.ledger_account
        (authority_id, code, name, root_type, account_type, is_group, is_postable, notes, created_by)
      VALUES (b.authority_id, COALESCE(NULLIF(r.parsed->>'new_code', ''), r.parsed->>'code'), r.parsed->>'name',
              r.parsed->>'root_type', NULLIF(r.parsed->>'account_type', ''),
              COALESCE((r.parsed->>'is_group')::boolean, false),
              NOT COALESCE((r.parsed->>'is_group')::boolean, false),
              'Brought across from ' || b.original_filename, p_user)
      RETURNING id INTO v_account;
      INSERT INTO finance.account_code_map
        (authority_id, cutover_id, source_code, source_name, source_category, disposition,
         ledger_account_id, batch_id, created_by)
      VALUES (b.authority_id, b.cutover_id, r.parsed->>'code', r.parsed->>'name', r.parsed->>'category',
              'mapped', v_account, b.id, p_user);
      v_created := v_created + 1;
    END IF;
  END LOOP;

  -- Headings, once every account of the file exists. A parent code that is not in this council's
  -- chart leaves the account at the top level rather than under a guessed heading.
  UPDATE finance.ledger_account la
     SET parent_id = parent.id
    FROM finance.migration_row mr
    JOIN finance.account_code_map m
      ON m.cutover_id = b.cutover_id AND upper(m.source_code) = upper(mr.parsed->>'code')
    JOIN finance.account_code_map pm
      ON pm.cutover_id = b.cutover_id AND upper(pm.source_code) = upper(mr.parsed->>'parent_code')
    JOIN finance.ledger_account parent ON parent.id = pm.ledger_account_id AND parent.is_group
   WHERE mr.batch_id = p_batch_id AND mr.status = 'ready' AND COALESCE(mr.parsed->>'action', 'create') = 'create'
     AND la.id = m.ledger_account_id AND la.id <> parent.id AND la.parent_id IS NULL;

  UPDATE finance.migration_batch
     SET status = 'committed', committed_by = p_user, committed_at = now(),
         result = jsonb_build_object('accounts_created', v_created, 'codes_mapped', v_mapped, 'codes_retired', v_retired)
   WHERE id = p_batch_id;
  RETURN jsonb_build_object('accounts_created', v_created, 'codes_mapped', v_mapped, 'codes_retired', v_retired);
END $$;

-- ── M2: customers and suppliers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION finance.commit_party_batch(p_batch_id uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  b finance.migration_batch;
  r record;
  v_party uuid;
  v_created integer := 0; v_matched integer := 0; v_aside integer := 0;
BEGIN
  b := finance.lock_migration_batch(p_batch_id, 'parties');

  FOR r IN SELECT * FROM finance.migration_row WHERE batch_id = p_batch_id ORDER BY row_no LOOP
    IF r.status = 'set_aside' THEN
      v_aside := v_aside + 1;
      CONTINUE;
    END IF;
    IF r.parsed->>'action' = 'map' THEN
      v_party := (r.parsed->>'party_id')::uuid;
      v_matched := v_matched + 1;
    ELSE
      INSERT INTO finance.party
        (authority_id, party_type, name, reference, contact_name, contact_phone, contact_email,
         address_text, notes, created_by)
      VALUES (b.authority_id, r.parsed->>'party_type', r.parsed->>'name', NULLIF(r.parsed->>'reference', ''),
              NULLIF(r.parsed->>'contact_name', ''), NULLIF(r.parsed->>'contact_phone', ''),
              NULLIF(r.parsed->>'contact_email', ''), NULLIF(r.parsed->>'address_text', ''),
              'Brought across from ' || b.original_filename, p_user)
      RETURNING id INTO v_party;
      v_created := v_created + 1;
    END IF;
    INSERT INTO finance.party_source_map
      (authority_id, cutover_id, source_kind, source_code, source_name, party_id, batch_id, created_by)
    VALUES (b.authority_id, b.cutover_id, r.parsed->>'source_kind', r.parsed->>'code', r.parsed->>'name',
            v_party, b.id, p_user);
  END LOOP;

  UPDATE finance.migration_batch
     SET status = 'committed', committed_by = p_user, committed_at = now(),
         result = jsonb_build_object('parties_created', v_created, 'parties_matched', v_matched, 'rows_set_aside', v_aside)
   WHERE id = p_batch_id;
  RETURN jsonb_build_object('parties_created', v_created, 'parties_matched', v_matched, 'rows_set_aside', v_aside);
END $$;

-- ── M3: the opening trial balance ─────────────────────────────────────────────────────────────
-- ONE draft opening voucher. It is not posted here: posting is finance.post_voucher(), by somebody
-- other than whoever loaded the file. A trial balance that does not balance is refused whole; no
-- balancing figure is ever supplied.
CREATE OR REPLACE FUNCTION finance.commit_opening_balance_batch(p_batch_id uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  b finance.migration_batch;
  c finance.cutover;
  t record;
  v_voucher uuid;
  v_no text;
  v_lines integer;
BEGIN
  b := finance.lock_migration_batch(p_batch_id, 'opening_balance');
  SELECT * INTO c FROM finance.cutover WHERE id = b.cutover_id;

  SELECT COALESCE(sum((r.parsed->>'debit')::numeric), 0) AS debit,
         COALESCE(sum((r.parsed->>'credit')::numeric), 0) AS credit,
         count(*) AS lines
    INTO t FROM finance.migration_row r WHERE r.batch_id = p_batch_id AND r.status = 'ready';
  IF t.lines < 2 THEN
    RAISE EXCEPTION 'the trial balance in % has fewer than two balances to load', b.original_filename
      USING ERRCODE = '23514';
  END IF;
  IF t.debit <> t.credit THEN
    RAISE EXCEPTION 'the % trial balance in % does not balance: debits %, credits %, difference %',
      b.currency, b.original_filename, t.debit, t.credit, t.debit - t.credit
      USING ERRCODE = '23514',
            HINT = 'An opening position must balance to nil. Find the missing account in the old package; no balancing figure is added here.';
  END IF;
  IF b.declared_total IS NOT NULL AND b.declared_total <> t.debit THEN
    RAISE EXCEPTION 'the file totals % and the control total given for it is %', t.debit, b.declared_total
      USING ERRCODE = '23514',
            HINT = 'The control total comes from the old package''s own printed trial balance. A difference usually means a truncated export.';
  END IF;

  v_no := finance.next_document_no(b.authority_id, 'opening');
  INSERT INTO finance.voucher
    (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date, narration,
     reference, status, is_opening, prepared_by)
  VALUES (b.authority_id, v_no, 'opening', b.currency, c.financial_year_id, c.cutover_date,
          'Opening balances at ' || c.cutover_date || ' brought across from ' || c.name,
          left(b.original_filename, 120), 'draft', true, p_user)
  RETURNING id INTO v_voucher;

  INSERT INTO finance.voucher_line
    (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
  SELECT b.authority_id, v_voucher, row_number() OVER (ORDER BY r.row_no),
         (r.parsed->>'ledger_account_id')::uuid,
         (r.parsed->>'debit')::numeric, (r.parsed->>'credit')::numeric,
         left('Opening balance of ' || (r.parsed->>'code') || COALESCE(' ' || NULLIF(r.parsed->>'name', ''), ''), 500)
    FROM finance.migration_row r
   WHERE r.batch_id = p_batch_id AND r.status = 'ready';
  GET DIAGNOSTICS v_lines = ROW_COUNT;

  INSERT INTO finance.migration_voucher (authority_id, batch_id, voucher_id)
  VALUES (b.authority_id, b.id, v_voucher);

  UPDATE finance.migration_batch
     SET status = 'committed', committed_by = p_user, committed_at = now(),
         total_debit = t.debit, total_credit = t.credit,
         result = jsonb_build_object('voucher_id', v_voucher, 'voucher_no', v_no, 'lines', v_lines,
                                     'debit_total', t.debit::text, 'credit_total', t.credit::text)
   WHERE id = p_batch_id;
  RETURN jsonb_build_object('voucher_id', v_voucher, 'voucher_no', v_no, 'lines', v_lines,
                            'debit_total', t.debit::text, 'credit_total', t.credit::text);
END $$;

-- ── M4: open items ────────────────────────────────────────────────────────────────────────────
-- One draft voucher per open document, inside the control account (see the header). `amount` is
-- what is owed: positive for an unpaid invoice, negative for a credit balance or a payment not yet
-- matched to anything.
CREATE OR REPLACE FUNCTION finance.commit_open_items_batch(p_batch_id uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  b finance.migration_batch;
  c finance.cutover;
  a record;
  v_opening uuid;
  v_opening_no text;
  v_control numeric;
  v_items numeric;
  r record;
  v_voucher uuid;
  v_no text;
  v_count integer := 0;
  v_amount numeric;
  v_party_debit boolean;
BEGIN
  b := finance.lock_migration_batch(p_batch_id, 'open_items');
  SELECT * INTO c FROM finance.cutover WHERE id = b.cutover_id;

  SELECT la.code, la.name, la.account_type INTO a FROM finance.ledger_account la WHERE la.id = b.control_account_id;
  IF (b.item_side = 'debtors' AND a.account_type IS DISTINCT FROM 'receivable')
     OR (b.item_side = 'creditors' AND a.account_type IS DISTINCT FROM 'payable') THEN
    RAISE EXCEPTION 'account % (%) is not a % control account', a.code, a.name,
      CASE b.item_side WHEN 'debtors' THEN 'receivable' ELSE 'payable' END
      USING ERRCODE = '23514',
            HINT = 'Mark the control account as receivable or payable in the chart of accounts first.';
  END IF;

  -- The opening voucher of this cut-over and currency that carries the control account's balance.
  SELECT v.id, v.voucher_no,
         sum(CASE WHEN b.item_side = 'debtors' THEN l.debit - l.credit ELSE l.credit - l.debit END)
    INTO v_opening, v_opening_no, v_control
    FROM finance.migration_batch ob
    JOIN finance.migration_voucher mv ON mv.batch_id = ob.id
    JOIN finance.voucher v ON v.id = mv.voucher_id AND v.status <> 'cancelled'
    JOIN finance.voucher_line l ON l.voucher_id = v.id AND l.ledger_account_id = b.control_account_id
                               AND l.party_id IS NULL
   WHERE ob.cutover_id = b.cutover_id AND ob.load_kind = 'opening_balance'
     AND ob.status = 'committed' AND ob.currency = b.currency
   GROUP BY v.id, v.voucher_no;
  IF v_opening IS NULL THEN
    RAISE EXCEPTION 'the % opening trial balance carries no balance on % (%)', b.currency, a.code, a.name
      USING ERRCODE = '23514',
            HINT = 'Load the opening trial balance for this currency first. The open items are checked against its control account.';
  END IF;

  -- A row carries one or more items: one per document, or one per ageing column when the old
  -- package can only print a summary age analysis.
  SELECT COALESCE(sum((i->>'amount')::numeric), 0) INTO v_items
    FROM finance.migration_row r2, jsonb_array_elements(r2.parsed->'items') i
   WHERE r2.batch_id = p_batch_id AND r2.status = 'ready';
  IF v_items <> v_control THEN
    RAISE EXCEPTION 'the open items total % % and the control account % stands at % in the opening trial balance (difference %)',
      b.currency, v_items, a.code, v_control, v_items - v_control
      USING ERRCODE = '23514',
            HINT = 'The age analysis and the trial balance must be printed at the same date. Nothing is loaded until they agree.';
  END IF;

  FOR r IN
    SELECT mr.id, mr.parsed->>'party_id' AS party_id, i.value AS item
      FROM finance.migration_row mr, jsonb_array_elements(mr.parsed->'items') WITH ORDINALITY i
     WHERE mr.batch_id = p_batch_id AND mr.status = 'ready'
     ORDER BY mr.row_no, i.ordinality
  LOOP
    v_amount := (r.item->>'amount')::numeric;
    CONTINUE WHEN v_amount = 0;
    -- Debtors: an invoice debits the party. Creditors: an invoice credits it. A negative amount is
    -- the other way round on both.
    v_party_debit := (b.item_side = 'debtors') = (v_amount > 0);
    v_no := finance.next_document_no(b.authority_id, 'opening');
    INSERT INTO finance.voucher
      (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
       document_date, narration, reference, status, is_opening, prepared_by)
    VALUES (b.authority_id, v_no, 'opening', b.currency, c.financial_year_id, c.cutover_date,
            LEAST((r.item->>'document_date')::date, c.cutover_date),
            left(COALESCE(NULLIF(r.item->>'narration', ''), 'Open item brought across'), 2000),
            NULLIF(left(r.item->>'document_no', 120), ''), 'draft', true, p_user)
    RETURNING id INTO v_voucher;

    INSERT INTO finance.voucher_line
      (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, party_id, against_voucher_id, narration)
    VALUES
      (b.authority_id, v_voucher, 1, b.control_account_id,
       CASE WHEN v_party_debit THEN abs(v_amount) ELSE 0 END,
       CASE WHEN v_party_debit THEN 0 ELSE abs(v_amount) END,
       r.party_id::uuid, NULL,
       left('Open item ' || COALESCE(r.item->>'document_no', ''), 500)),
      (b.authority_id, v_voucher, 2, b.control_account_id,
       CASE WHEN v_party_debit THEN 0 ELSE abs(v_amount) END,
       CASE WHEN v_party_debit THEN abs(v_amount) ELSE 0 END,
       NULL, v_opening,
       'Transferred from the opening balance in ' || v_opening_no);

    INSERT INTO finance.migration_voucher (authority_id, batch_id, voucher_id, row_id)
    VALUES (b.authority_id, b.id, v_voucher, r.id);
    v_count := v_count + 1;
  END LOOP;

  UPDATE finance.migration_batch
     SET status = 'committed', committed_by = p_user, committed_at = now(),
         result = jsonb_build_object('vouchers', v_count, 'items_total', v_items::text,
                                     'control_balance', v_control::text, 'opening_voucher_no', v_opening_no)
   WHERE id = p_batch_id;
  RETURN jsonb_build_object('vouchers', v_count, 'items_total', v_items::text,
                            'control_balance', v_control::text, 'opening_voucher_no', v_opening_no);
END $$;

-- Withdraw a committed balance load. Drafts are discarded; a load whose vouchers were posted can be
-- withdrawn only after each has been reversed, which leaves both halves on the record.
CREATE OR REPLACE FUNCTION finance.withdraw_migration_batch(p_batch_id uuid, p_user uuid, p_reason text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE b finance.migration_batch; v_live integer; v_dropped integer;
BEGIN
  SELECT * INTO b FROM finance.migration_batch WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'migration batch % does not exist', p_batch_id USING ERRCODE = '23503'; END IF;
  IF b.status <> 'committed' OR b.load_kind NOT IN ('opening_balance', 'open_items') THEN
    RAISE EXCEPTION 'only a committed balance load can be withdrawn' USING ERRCODE = '23514';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'withdrawing a load needs a reason, which goes on the record' USING ERRCODE = '23502';
  END IF;
  SELECT count(*) INTO v_live
    FROM finance.migration_voucher mv JOIN finance.voucher v ON v.id = mv.voucher_id
   WHERE mv.batch_id = p_batch_id AND v.status = 'posted'
     AND NOT EXISTS (SELECT 1 FROM finance.voucher x WHERE x.reverses_voucher_id = v.id AND x.status = 'posted');
  IF v_live > 0 THEN
    RAISE EXCEPTION '% voucher(s) of this load are posted and not reversed', v_live
      USING ERRCODE = '23514', HINT = 'Reverse each posted voucher first. A posted entry is never removed.';
  END IF;
  IF b.load_kind = 'opening_balance' AND EXISTS (
       SELECT 1 FROM finance.migration_batch i
        WHERE i.cutover_id = b.cutover_id AND i.load_kind = 'open_items'
          AND i.currency = b.currency AND i.status = 'committed') THEN
    RAISE EXCEPTION 'open items are loaded against this opening balance' USING ERRCODE = '23514',
      HINT = 'Withdraw the open-item loads for this currency first.';
  END IF;
  WITH gone AS (
    DELETE FROM finance.voucher v USING finance.migration_voucher mv
     WHERE mv.batch_id = p_batch_id AND v.id = mv.voucher_id AND v.status = 'draft'
    RETURNING v.id)
  SELECT count(*) INTO v_dropped FROM gone;
  UPDATE finance.migration_batch
     SET status = 'withdrawn', withdrawn_by = p_user, withdrawn_at = now(), withdraw_reason = btrim(p_reason)
   WHERE id = p_batch_id;
  RETURN v_dropped;
END $$;

-- ── Reconciliation ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION finance.refresh_cutover_reconciliation(p_reconciliation_id uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE rc finance.cutover_reconciliation; v_changed integer;
BEGIN
  SELECT * INTO rc FROM finance.cutover_reconciliation WHERE id = p_reconciliation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconciliation % does not exist', p_reconciliation_id USING ERRCODE = '23503';
  END IF;

  -- An account this ledger holds a balance on that the old package's file does not mention at all.
  INSERT INTO finance.cutover_reconciliation_line (authority_id, reconciliation_id, ledger_account_id)
  SELECT DISTINCT rc.authority_id, rc.id, e.ledger_account_id
    FROM finance.ledger_entry e
   WHERE e.currency = rc.currency AND e.posting_date <= rc.as_at
     AND NOT EXISTS (SELECT 1 FROM finance.cutover_reconciliation_line l
                      WHERE l.reconciliation_id = rc.id AND l.ledger_account_id = e.ledger_account_id);

  WITH ledger AS (
    SELECT e.ledger_account_id, sum(e.debit) - sum(e.credit) AS net_debit
      FROM finance.ledger_entry e
     WHERE e.currency = rc.currency AND e.posting_date <= rc.as_at
     GROUP BY e.ledger_account_id)
  UPDATE finance.cutover_reconciliation_line l
     SET ledger_net_debit = COALESCE(g.net_debit, 0)
    FROM finance.cutover_reconciliation_line l2
    LEFT JOIN ledger g ON g.ledger_account_id = l2.ledger_account_id
   WHERE l.id = l2.id AND l2.reconciliation_id = rc.id
     AND l.ledger_net_debit IS DISTINCT FROM COALESCE(g.net_debit, 0);
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  UPDATE finance.cutover_reconciliation SET refreshed_at = now() WHERE id = rc.id;
  RETURN v_changed;
END $$;

CREATE OR REPLACE FUNCTION finance.build_cutover_reconciliation(p_batch_id uuid, p_user uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  b finance.migration_batch;
  c finance.cutover;
  v_id uuid;
  v_kind text;
  v_as_at date;
BEGIN
  SELECT * INTO b FROM finance.migration_batch WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'migration batch % does not exist', p_batch_id USING ERRCODE = '23503'; END IF;
  SELECT * INTO c FROM finance.cutover WHERE id = b.cutover_id;

  IF b.load_kind = 'opening_balance' THEN
    IF b.status <> 'committed' THEN
      RAISE EXCEPTION 'the opening trial balance must be committed before it is reconciled' USING ERRCODE = '23514';
    END IF;
    v_kind := 'opening'; v_as_at := c.cutover_date;
  ELSIF b.load_kind = 'comparison_balance' THEN
    b := finance.lock_migration_batch(p_batch_id, 'comparison_balance');
    v_kind := 'parallel_run'; v_as_at := b.as_at;
    IF v_as_at < c.cutover_date THEN
      RAISE EXCEPTION 'a parallel-run trial balance cannot be dated before the cut-over (%)', c.cutover_date
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'only a trial balance can be reconciled' USING ERRCODE = '23514';
  END IF;

  DELETE FROM finance.cutover_reconciliation WHERE batch_id = p_batch_id;
  INSERT INTO finance.cutover_reconciliation (authority_id, cutover_id, batch_id, kind, currency, as_at, created_by)
  VALUES (b.authority_id, b.cutover_id, b.id, v_kind, b.currency, v_as_at, p_user)
  RETURNING id INTO v_id;

  INSERT INTO finance.cutover_reconciliation_line
    (authority_id, reconciliation_id, ledger_account_id, source_codes, source_net_debit)
  SELECT b.authority_id, v_id, (r.parsed->>'ledger_account_id')::uuid,
         left(string_agg(r.parsed->>'code', ', ' ORDER BY r.row_no), 2000),
         sum((r.parsed->>'debit')::numeric - (r.parsed->>'credit')::numeric)
    FROM finance.migration_row r
   WHERE r.batch_id = p_batch_id AND r.status = 'ready'
   GROUP BY (r.parsed->>'ledger_account_id')::uuid;

  -- A balance on a code that was set aside has no account here. One line each, so each is explained.
  INSERT INTO finance.cutover_reconciliation_line
    (authority_id, reconciliation_id, ledger_account_id, source_codes, source_net_debit)
  SELECT b.authority_id, v_id, NULL, r.parsed->>'code',
         COALESCE((r.parsed->>'debit')::numeric, 0) - COALESCE((r.parsed->>'credit')::numeric, 0)
    FROM finance.migration_row r
   WHERE r.batch_id = p_batch_id AND r.status = 'set_aside'
     AND COALESCE((r.parsed->>'debit')::numeric, 0) - COALESCE((r.parsed->>'credit')::numeric, 0) <> 0;

  IF b.load_kind = 'comparison_balance' THEN
    UPDATE finance.migration_batch
       SET status = 'committed', committed_by = p_user, committed_at = now(),
           result = jsonb_build_object('reconciliation_id', v_id)
     WHERE id = p_batch_id;
  END IF;

  PERFORM finance.refresh_cutover_reconciliation(v_id);
  RETURN v_id;
END $$;

-- ── Readiness and sign-off ────────────────────────────────────────────────────────────────────
-- ONE definition of "ready", read by the screen's checklist and by the sign-off, so the checklist
-- cannot show green while the sign-off refuses.
CREATE OR REPLACE FUNCTION finance.cutover_readiness(p_cutover_id uuid)
RETURNS TABLE (check_key text, passed boolean, blocking boolean, detail text)
LANGUAGE sql STABLE AS $$
  WITH batches AS (
    SELECT * FROM finance.migration_batch WHERE cutover_id = p_cutover_id
  ), vouchers AS (
    SELECT v.status, b.load_kind
      FROM batches b JOIN finance.migration_voucher mv ON mv.batch_id = b.id
      JOIN finance.voucher v ON v.id = mv.voucher_id
     WHERE b.status = 'committed'
  ), latest AS (
    SELECT DISTINCT ON (r.currency) r.id, r.currency, r.kind, r.as_at
      FROM finance.cutover_reconciliation r WHERE r.cutover_id = p_cutover_id
     ORDER BY r.currency, r.as_at DESC, r.created_at DESC
  ), unexplained AS (
    SELECT l.reconciliation_id, count(*) AS n
      FROM finance.cutover_reconciliation_line l JOIN latest t ON t.id = l.reconciliation_id
     WHERE l.difference <> 0 AND length(btrim(COALESCE(l.explanation, ''))) < 3
     GROUP BY l.reconciliation_id
  )
  SELECT 'chart', count(*) FILTER (WHERE load_kind = 'chart' AND status = 'committed') > 0
              OR EXISTS (SELECT 1 FROM finance.account_code_map m WHERE m.cutover_id = p_cutover_id), true,
         (SELECT count(*) FROM finance.account_code_map m WHERE m.cutover_id = p_cutover_id)::text
           || ' old account code(s) mapped or retired'
    FROM batches
  UNION ALL
  SELECT 'parties', count(*) FILTER (WHERE load_kind = 'parties' AND status = 'committed') > 0, false,
         (SELECT count(*) FROM finance.party_source_map m WHERE m.cutover_id = p_cutover_id)::text
           || ' customer and supplier account(s) brought across'
    FROM batches
  UNION ALL
  SELECT 'opening_balance', count(*) FILTER (WHERE load_kind = 'opening_balance' AND status = 'committed') > 0, true,
         COALESCE(string_agg(currency::text, ', ' ORDER BY currency::text)
                    FILTER (WHERE load_kind = 'opening_balance' AND status = 'committed'),
                  'No opening trial balance is loaded')
    FROM batches
  UNION ALL
  SELECT 'open_items', count(*) FILTER (WHERE load_kind = 'open_items' AND status = 'committed') > 0, false,
         count(*) FILTER (WHERE load_kind = 'open_items' AND status = 'committed')::text || ' open-item list(s) loaded'
    FROM batches
  UNION ALL
  SELECT 'nothing_pending', count(*) FILTER (WHERE status IN ('uploaded', 'validated')) = 0, true,
         count(*) FILTER (WHERE status IN ('uploaded', 'validated'))::text || ' file(s) neither committed nor cancelled'
    FROM batches
  UNION ALL
  SELECT 'vouchers_posted', count(*) FILTER (WHERE status = 'draft') = 0, true,
         count(*) FILTER (WHERE status = 'draft')::text || ' opening voucher(s) still to be posted'
    FROM vouchers
  UNION ALL
  SELECT 'reconciled',
         NOT EXISTS (SELECT 1 FROM batches b WHERE b.load_kind = 'opening_balance' AND b.status = 'committed'
                        AND NOT EXISTS (SELECT 1 FROM latest t WHERE t.currency = b.currency))
           AND EXISTS (SELECT 1 FROM latest), true,
         COALESCE((SELECT string_agg(t.currency::text || ' at ' || t.as_at, ', ' ORDER BY t.currency::text) FROM latest t),
                  'No reconciliation has been run')
  UNION ALL
  SELECT 'differences_explained', COALESCE((SELECT sum(n) FROM unexplained), 0) = 0, true,
         COALESCE((SELECT sum(n) FROM unexplained), 0)::text || ' difference(s) with no explanation'
$$;

CREATE OR REPLACE FUNCTION finance.sign_off_cutover(p_cutover_id uuid, p_user uuid, p_note text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c finance.cutover; r record; f record;
BEGIN
  SELECT * INTO c FROM finance.cutover WHERE id = p_cutover_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cut-over % does not exist', p_cutover_id USING ERRCODE = '23503'; END IF;
  IF c.status <> 'preparing' THEN
    RAISE EXCEPTION 'this cut-over is already %', replace(c.status, '_', ' ') USING ERRCODE = '23514';
  END IF;
  IF p_user = c.created_by OR EXISTS (
       SELECT 1 FROM finance.migration_batch b
        WHERE b.cutover_id = p_cutover_id AND p_user IN (b.uploaded_by, b.committed_by)) THEN
    RAISE EXCEPTION 'the cut-over must be signed off by somebody who did not load it'
      USING ERRCODE = '23514', HINT = 'Separation of duties: whoever loads the opening position does not approve it.';
  END IF;

  -- Judge today's ledger, not the ledger as it stood when somebody last pressed refresh.
  FOR r IN SELECT id FROM finance.cutover_reconciliation WHERE cutover_id = p_cutover_id LOOP
    PERFORM finance.refresh_cutover_reconciliation(r.id);
  END LOOP;

  SELECT * INTO f FROM finance.cutover_readiness(p_cutover_id) q WHERE q.blocking AND NOT q.passed LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'the cut-over cannot be signed off: %', f.detail
      USING ERRCODE = '23514',
            HINT = 'Every blocking check on the cut-over checklist must pass. An unexplained difference is never waived.';
  END IF;

  UPDATE finance.cutover
     SET status = 'signed_off', signed_off_by = p_user, signed_off_at = now(), sign_off_note = NULLIF(btrim(p_note), '')
   WHERE id = p_cutover_id;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 7. PERMISSIONS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO finance.permission (code, label, category, is_approval, is_publication, is_restricted, description) VALUES
  ('finance.migration.view',    'View the cut-over',           'migration', false, false, false, 'The files loaded from the previous accounting package, the account mapping and the reconciliation.'),
  ('finance.migration.prepare', 'Load the previous package''s data', 'migration', false, false, false, 'Upload, check and commit the chart, customers, suppliers and opening balances. Opening vouchers are drafts until somebody else posts them.'),
  ('finance.migration.signoff', 'Sign off the cut-over',       'migration', true,  false, false, 'Approve the reconciled opening position. Never somebody who loaded it. Who signs is Council decision D23.')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, is_approval = EXCLUDED.is_approval,
      is_publication = EXCLUDED.is_publication, is_restricted = EXCLUDED.is_restricted,
      description = EXCLUDED.description;

INSERT INTO finance.role_permission (role_name, permission_code) VALUES
  ('accountant',         'finance.migration.view'),
  ('accountant',         'finance.migration.prepare'),
  ('finance_admin',      'finance.migration.view'),
  ('finance_admin',      'finance.migration.prepare'),
  ('finance_admin',      'finance.migration.signoff'),
  ('finance_officer',    'finance.migration.view'),
  ('finance_committee',  'finance.migration.view'),
  ('accounting_officer', 'finance.migration.view'),
  ('auditor',            'finance.migration.view')
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
-- 8. TENANCY AND GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  r text;
  tables text[] := ARRAY['finance.cutover', 'finance.migration_batch', 'finance.migration_row',
                         'finance.account_code_map', 'finance.party_source_map', 'finance.migration_voucher',
                         'finance.cutover_reconciliation', 'finance.cutover_reconciliation_line'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    FOREACH r IN ARRAY tables LOOP
      PERFORM tenancy.classify(r, 'pending', 'cut-over data awaiting the authority it belongs to');
    END LOOP;
    RETURN;
  END IF;
  FOREACH r IN ARRAY tables LOOP
    PERFORM tenancy.make_tenant(r::regclass, 'VUNGU');
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    -- The mapping and the reconciliation are evidence: amended, never deleted.
    REVOKE DELETE, TRUNCATE ON finance.cutover, finance.account_code_map, finance.party_source_map FROM vungu_app;
    GRANT SELECT ON finance.v_debtor_ageing TO vungu_app;
  END IF;
END $$;
