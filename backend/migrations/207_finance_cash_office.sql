-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 207 — THE ENTERPRISE ROLE MODEL (PHASE 1) AND THE CASH OFFICE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Design: docs/superpowers/specs/2026-11-11-finance-enterprise-reengineering-design.md (frontend
-- repository), §4 (roles), §5.3 (cash office), §9 (acceptance checks P1-P11).
--
-- WHAT THIS ADDS
--   1. Four roles, each released WITH work to do: `cashier`, `accountant`, `revenue_officer`,
--      `accounting_officer`. The other five roles of the design (creditors, procurement, stores,
--      assets, payroll) are NOT created here: a role that can sign in and cannot do its job is the
--      design's first anti-goal, and their modules do not exist yet.
--   2. The cash office: cash points, the Council's income codes, cashier sessions, the general
--      receipt, the cash-up and the banking.
--
-- THE RISK THIS IS ARRANGED AROUND
-- Cash taken at a counter and never banked. So: a receipt exists only inside a session that names
-- its cashier (C1); its number is issued by the database and never reused (C2); it is never edited
-- or deleted (C3); the cashier does not verify their own cash-up (C4); the session reaches the
-- ledger all at once, when a second person has agreed the count (C5); and a difference between the
-- count and the receipts is posted, never absorbed (C6).
--
-- NOTHING HERE WRITES finance.ledger_entry. Every receipt, every cash difference and every banking
-- is a voucher, and finance.post_voucher() (203:720) stays the only writer of the ledger. That is
-- also what makes C5 fall out of an existing rule rather than a new one: the cashier PREPARES the
-- vouchers, so `voucher_prepared_and_posted_differ` (203:313) already forbids the cashier posting
-- them, and the verifier is the poster.
--
-- SEEDED EMPTY. No cash point, no income code, no tariff and no float. Which counters exist, what
-- the Council charges for hall hire and which account a shortage is written to are decision D22.
--
-- Conventions follow 188/203/205: tenancy.make_tenant(), security_invoker views, the finance.money
-- and finance.currency_code domains, named CHECK constraints, idempotent throughout.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET search_path = finance, public;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. THE ROLES
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Rebuilt additively from whatever the constraint holds today, so this migration cannot drop a
-- role some other migration added after 188.
DO $$
DECLARE
  n text;
  roles text[];
  added text[] := ARRAY['accountant', 'cashier', 'revenue_officer', 'accounting_officer'];
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO roles
    FROM pg_constraint c,
         LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conrelid = 'public.users'::regclass AND c.conname = 'users_role_check';
  IF roles IS NULL THEN
    RAISE EXCEPTION 'users_role_check is missing; migration 188 must run before 207';
  END IF;
  roles := ARRAY(SELECT DISTINCT unnest(roles || added) ORDER BY 1);
  FOR n IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.users'::regclass AND conname LIKE '%role_check%'
  LOOP EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', n); END LOOP;
  EXECUTE format('ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN (%s))',
    (SELECT string_agg(quote_literal(r), ', ') FROM unnest(roles) r));

  IF to_regclass('public.invites') IS NOT NULL THEN
    SELECT array_agg(DISTINCT m[1]) INTO roles
      FROM pg_constraint c,
           LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
     WHERE c.conrelid = 'public.invites'::regclass AND c.conname = 'invites_role_check';
    IF roles IS NOT NULL THEN
      roles := ARRAY(SELECT DISTINCT unnest(roles || added) ORDER BY 1);
      ALTER TABLE public.invites DROP CONSTRAINT IF EXISTS invites_role_check;
      EXECUTE format('ALTER TABLE public.invites ADD CONSTRAINT invites_role_check CHECK (role IN (%s))',
        (SELECT string_agg(quote_literal(r), ', ') FROM unnest(roles) r));
    END IF;
  END IF;
END $$;

-- A staff member with no authority cannot write a single finance row (188:1004). The trigger's
-- role list is replaced additively: every role 154 and 188 named is still in it.
CREATE OR REPLACE FUNCTION public.users_default_authority() RETURNS trigger AS $fn$
BEGIN
  IF NEW.authority_id IS NULL AND NEW.role IN (
    'admin', 'planner', 'planning_clerk', 'building_inspector', 'eo', 'env_officer',
    'surveyor', 'gis_officer',
    'finance_admin', 'finance_officer', 'budget_officer', 'dept_head',
    'finance_committee', 'publisher', 'auditor',
    -- migration 207
    'accountant', 'cashier', 'revenue_officer', 'accounting_officer'
  ) THEN
    SELECT id INTO NEW.authority_id FROM public.local_authorities WHERE code = 'VUNGU';
  END IF;
  RETURN NEW;
END $fn$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. DOCUMENT NUMBERS — ISSUED, NEVER TYPED (C2)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A receipt book has consecutive numbers so that a missing one is a question somebody must answer.
-- A Postgres SEQUENCE does not give that: it is not transactional, so a receipt that failed to
-- save would burn a number and leave a gap nobody can explain. This counter is a ROW, updated in
-- the same transaction as the document it numbers: if the document is not written, the number was
-- never issued. The row lock serialises two cashiers taking a payment in the same instant.
CREATE TABLE IF NOT EXISTS finance.document_sequence (
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  kind         text NOT NULL CONSTRAINT document_sequence_kind_known
               CHECK (kind IN ('receipt', 'cashier_session', 'bank_deposit')),
  last_no      bigint NOT NULL DEFAULT 0 CONSTRAINT document_sequence_not_negative CHECK (last_no >= 0),
  PRIMARY KEY (authority_id, kind)
);

COMMENT ON TABLE finance.document_sequence IS
  'Gapless per-council document counters (receipts, cashier sessions, bank deposits). A row, not a '
  'SEQUENCE, so a number is issued in the transaction that writes its document and is never '
  'burned by a rollback (control C2).';

CREATE OR REPLACE FUNCTION finance.next_document_no(p_authority_id integer, p_kind text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_no bigint;
  v_prefix text;
BEGIN
  v_prefix := CASE p_kind WHEN 'receipt' THEN 'RC' WHEN 'cashier_session' THEN 'CS'
                          WHEN 'bank_deposit' THEN 'BD' END;
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
-- 3. THE CASH POINT AND THE INCOME CODE — THE COUNCIL'S, SEEDED EMPTY (D22)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS finance.cash_point (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id          integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  code                  text NOT NULL,
  name                  text NOT NULL,
  location              text,
  -- Where this counter's physical takings sit until they are banked. Never guessed from the chart.
  till_account_id       uuid NOT NULL REFERENCES finance.ledger_account (id),
  -- Where an over or a short is written at cash-up. NULL is allowed and means "not decided": a
  -- session with a difference then cannot be verified, rather than posting it nowhere (C6).
  difference_account_id uuid REFERENCES finance.ledger_account (id),
  status                text NOT NULL DEFAULT 'active' CONSTRAINT cash_point_status_known
                        CHECK (status IN ('active', 'inactive')),
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES public.users (id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  deleted_by            uuid REFERENCES public.users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_point_code
  ON finance.cash_point (authority_id, code) WHERE deleted_at IS NULL;

COMMENT ON TABLE finance.cash_point IS
  'A till or counter. Names the till-cash ledger account its takings sit in until banked and, '
  'optionally, the account a cash difference is posted to. Seeded empty (decision D22).';

CREATE OR REPLACE FUNCTION finance.assert_cash_point_accounts() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE a record;
BEGIN
  SELECT code, name, account_type, is_postable, status, deleted_at INTO a
    FROM finance.ledger_account WHERE id = NEW.till_account_id;
  IF a.account_type IS DISTINCT FROM 'cash' THEN
    RAISE EXCEPTION 'account % (%) is not a cash account, so a till cannot hold its takings in it', a.code, a.name
      USING ERRCODE = '23514',
            HINT = 'Choose a ledger account of type "cash". A bank account is where takings go when they are banked.';
  END IF;
  IF NOT a.is_postable OR a.status <> 'active' OR a.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'account % (%) cannot be posted to', a.code, a.name USING ERRCODE = '23514';
  END IF;
  IF NEW.difference_account_id IS NOT NULL THEN
    SELECT code, name, root_type, is_postable, status, deleted_at INTO a
      FROM finance.ledger_account WHERE id = NEW.difference_account_id;
    IF a.root_type NOT IN ('revenue', 'expense') THEN
      RAISE EXCEPTION 'account % (%) is a % account; a cash difference is a gain or a loss and is posted to revenue or expenditure',
        a.code, a.name, a.root_type USING ERRCODE = '23514';
    END IF;
    IF NOT a.is_postable OR a.status <> 'active' OR a.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'account % (%) cannot be posted to', a.code, a.name USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cash_point_accounts ON finance.cash_point;
CREATE TRIGGER trg_cash_point_accounts
  BEFORE INSERT OR UPDATE ON finance.cash_point
  FOR EACH ROW EXECUTE FUNCTION finance.assert_cash_point_accounts();

-- The cashier picks "Hall hire", never a ledger account: which revenue account hall hire belongs
-- to is decided once, by whoever keeps this list, and not afresh at the counter for every payment.
CREATE TABLE IF NOT EXISTS finance.income_code (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  code              text NOT NULL,
  name              text NOT NULL,
  ledger_account_id uuid NOT NULL REFERENCES finance.ledger_account (id),
  -- The vote the income belongs to, carried onto the ledger line as its dimension.
  department_id     uuid REFERENCES finance.department (id),
  -- `fixed`: the Council has resolved the charge and the counter may not vary it.
  -- `variable`: the amount is assessed per case (a plan fee, a market stall by the day).
  pricing           text NOT NULL DEFAULT 'variable' CONSTRAINT income_code_pricing_known
                    CHECK (pricing IN ('fixed', 'variable')),
  -- One column per currency, as public.payments does: there is no conversion basis (D4), so a USD
  -- charge says nothing about the ZWG one. NULL means "not chargeable in this currency".
  unit_amount_usd   finance.money CONSTRAINT income_code_usd_positive CHECK (unit_amount_usd IS NULL OR unit_amount_usd > 0),
  unit_amount_zwg   finance.money CONSTRAINT income_code_zwg_positive CHECK (unit_amount_zwg IS NULL OR unit_amount_zwg > 0),
  status            text NOT NULL DEFAULT 'active' CONSTRAINT income_code_status_known
                    CHECK (status IN ('active', 'inactive')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES public.users (id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  deleted_by        uuid REFERENCES public.users (id),
  CONSTRAINT income_code_fixed_has_a_charge CHECK (
    pricing <> 'fixed' OR unit_amount_usd IS NOT NULL OR unit_amount_zwg IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_income_code_code
  ON finance.income_code (authority_id, code) WHERE deleted_at IS NULL;

COMMENT ON TABLE finance.income_code IS
  'The Council''s list of income a cashier may receipt other than rates, each tied to a revenue '
  'ledger account and optionally a fixed charge per currency. Seeded empty (decision D22).';

CREATE OR REPLACE FUNCTION finance.assert_income_code_account() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE a record;
BEGIN
  SELECT code, name, root_type, is_postable, status, deleted_at INTO a
    FROM finance.ledger_account WHERE id = NEW.ledger_account_id;
  IF a.root_type IS DISTINCT FROM 'revenue' THEN
    RAISE EXCEPTION 'account % (%) is a % account; an income code credits a revenue account',
      a.code, a.name, a.root_type USING ERRCODE = '23514';
  END IF;
  IF NOT a.is_postable OR a.status <> 'active' OR a.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'account % (%) cannot be posted to', a.code, a.name USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_income_code_account ON finance.income_code;
CREATE TRIGGER trg_income_code_account
  BEFORE INSERT OR UPDATE ON finance.income_code
  FOR EACH ROW EXECUTE FUNCTION finance.assert_income_code_account();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4. THE CASHIER SESSION
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS finance.cashier_session (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  session_no        text NOT NULL,
  cash_point_id     uuid NOT NULL REFERENCES finance.cash_point (id),
  cashier_id        uuid NOT NULL REFERENCES public.users (id),
  financial_year_id uuid NOT NULL REFERENCES finance.financial_year (id),
  -- The day the takings belong to. Every receipt of the session carries it as its posting date, so
  -- a session cannot straddle two accounting periods.
  business_date     date NOT NULL,
  status            text NOT NULL DEFAULT 'open' CONSTRAINT cashier_session_status_known
                    CHECK (status IN ('open', 'closed', 'verified')),
  opened_at         timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz,
  verified_by       uuid REFERENCES public.users (id),
  verified_at       timestamptz,
  verify_note       text,
  -- A count sent back for recounting says who sent it and why; the cashier reads this.
  returned_by       uuid REFERENCES public.users (id),
  returned_at       timestamptz,
  return_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Control C4, on the record. The function refuses first so the message is legible.
  CONSTRAINT cashier_session_verified_by_another CHECK (
    verified_by IS NULL OR verified_by <> cashier_id),
  CONSTRAINT cashier_session_verified_is_attributed CHECK (
    (status = 'verified') = (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT cashier_session_closed_is_dated CHECK (
    status = 'open' OR closed_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cashier_session_no
  ON finance.cashier_session (authority_id, session_no);
-- One drawer, one person: a cashier has one open session and a cash point has one open session.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cashier_session_open_cashier
  ON finance.cashier_session (cashier_id) WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS uq_cashier_session_open_point
  ON finance.cashier_session (cash_point_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_cashier_session_status
  ON finance.cashier_session (authority_id, status, business_date);

COMMENT ON TABLE finance.cashier_session IS
  'One cashier, one cash point, one day''s takings: open, then closed when the cashier declares '
  'the count, then verified by a different person, which posts the session to the ledger.';

-- The count, per currency. Currencies are counted, totalled and banked separately (C8).
CREATE TABLE IF NOT EXISTS finance.cashier_session_count (
  cashier_session_id uuid NOT NULL REFERENCES finance.cashier_session (id),
  authority_id       integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  currency           finance.currency_code NOT NULL,
  -- Cash the drawer started with. It is the Council's money already in the till account, not
  -- takings, so it is taken off the count before the count is compared with the receipts.
  opening_float      finance.money NOT NULL DEFAULT 0 CONSTRAINT session_count_float_not_negative CHECK (opening_float >= 0),
  -- Set at close, by the database, from the session's own receipts (C7: the cashier declares the
  -- count without being shown this first).
  expected_takings   finance.money,
  declared_total     finance.money CONSTRAINT session_count_declared_not_negative CHECK (declared_total IS NULL OR declared_total >= 0),
  variance           numeric(18,2) GENERATED ALWAYS AS (declared_total - opening_float - expected_takings) STORED,
  explanation        text,
  difference_voucher_id uuid REFERENCES finance.voucher (id),
  PRIMARY KEY (cashier_session_id, currency),
  -- Control C6, first half: a difference is explained in writing by the person who counted.
  CONSTRAINT session_count_difference_is_explained CHECK (
    declared_total IS NULL OR expected_takings IS NULL
    OR declared_total - opening_float - expected_takings = 0
    OR length(btrim(COALESCE(explanation, ''))) >= 5)
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5. THE RECEIPT
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS finance.cash_receipt (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id       integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  receipt_no         text NOT NULL,
  cashier_session_id uuid NOT NULL REFERENCES finance.cashier_session (id),
  payer_name         text NOT NULL CONSTRAINT cash_receipt_payer_named CHECK (length(btrim(payer_name)) >= 2),
  party_id           uuid REFERENCES finance.party (id),
  currency           finance.currency_code NOT NULL,
  amount             finance.money NOT NULL CONSTRAINT cash_receipt_amount_positive CHECK (amount > 0),
  -- NOT NULL here, unlike finance.rates_receipt.method: a cashier at a counter always knows how
  -- they were paid, and the cash-up cannot be computed without it.
  method             text NOT NULL CONSTRAINT cash_receipt_method_known
                     CHECK (method IN ('cash', 'cheque', 'mobile_money', 'card', 'bank_transfer')),
  method_reference   text,
  -- The account debited: the till for cash and cheques, the bank or wallet account otherwise (C9).
  deposit_account_id uuid NOT NULL REFERENCES finance.ledger_account (id),
  received_on        date NOT NULL,
  voucher_id         uuid NOT NULL REFERENCES finance.voucher (id),
  narration          text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES public.users (id),
  cancelled_at       timestamptz,
  cancelled_by       uuid REFERENCES public.users (id),
  cancel_reason      text,
  CONSTRAINT cash_receipt_cancel_is_attributed CHECK (
    (cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL)
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND length(btrim(cancel_reason)) >= 5)),
  -- Money that is not in the drawer names the transaction that moved it.
  CONSTRAINT cash_receipt_electronic_is_referenced CHECK (
    method IN ('cash', 'cheque') OR length(btrim(COALESCE(method_reference, ''))) >= 3)
);
-- NOT partial: a cancelled receipt keeps its number, and nobody else ever gets it (C2).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_receipt_no ON finance.cash_receipt (authority_id, receipt_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_receipt_voucher ON finance.cash_receipt (voucher_id);
CREATE INDEX IF NOT EXISTS idx_cash_receipt_session ON finance.cash_receipt (cashier_session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cash_receipt_party ON finance.cash_receipt (party_id);

COMMENT ON TABLE finance.cash_receipt IS
  'The general receipt: sundry income taken at a counter inside a cashier session. Never edited or '
  'deleted; cancelled with a reason while its session is open, reversed through the ledger after.';

CREATE TABLE IF NOT EXISTS finance.cash_receipt_line (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id    integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  cash_receipt_id uuid NOT NULL REFERENCES finance.cash_receipt (id),
  line_no         integer NOT NULL CONSTRAINT cash_receipt_line_no_positive CHECK (line_no > 0),
  income_code_id  uuid NOT NULL REFERENCES finance.income_code (id),
  quantity        numeric(12,3) NOT NULL DEFAULT 1 CONSTRAINT cash_receipt_line_quantity_positive CHECK (quantity > 0),
  unit_amount     finance.money NOT NULL CONSTRAINT cash_receipt_line_unit_positive CHECK (unit_amount > 0),
  -- Rounded once, on the product, as finance.rates_bill_amount() does.
  amount          numeric(18,2) GENERATED ALWAYS AS (round(quantity * unit_amount, 2)) STORED,
  narration       text,
  UNIQUE (cash_receipt_id, line_no)
);

-- Control C3. The only change a receipt ever accepts is being cancelled, once.
CREATE OR REPLACE FUNCTION finance.refuse_cash_receipt_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a receipt is never deleted: it is cancelled with a reason, and stays on the record'
      USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'cash_receipt_line' THEN
    RAISE EXCEPTION 'a receipt''s lines are never amended; cancel the receipt and issue another'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'receipt % is cancelled and accepts no further change', OLD.receipt_no
      USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['cancelled_at', 'cancelled_by', 'cancel_reason'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['cancelled_at', 'cancelled_by', 'cancel_reason']) THEN
    RAISE EXCEPTION 'receipt % cannot be amended; cancel it with a reason and issue another', OLD.receipt_no
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cash_receipt_immutable ON finance.cash_receipt;
CREATE TRIGGER trg_cash_receipt_immutable
  BEFORE UPDATE OR DELETE ON finance.cash_receipt
  FOR EACH ROW EXECUTE FUNCTION finance.refuse_cash_receipt_change();
DROP TRIGGER IF EXISTS trg_cash_receipt_line_immutable ON finance.cash_receipt_line;
CREATE TRIGGER trg_cash_receipt_line_immutable
  BEFORE UPDATE OR DELETE ON finance.cash_receipt_line
  FOR EACH ROW EXECUTE FUNCTION finance.refuse_cash_receipt_change();

-- A rates payment taken at the counter belongs to the same cash-up as everything else.
ALTER TABLE finance.rates_receipt
  ADD COLUMN IF NOT EXISTS cashier_session_id uuid REFERENCES finance.cashier_session (id);
CREATE INDEX IF NOT EXISTS idx_rates_receipt_session
  ON finance.rates_receipt (cashier_session_id) WHERE cashier_session_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 6. THE BANKING
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS finance.bank_deposit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  deposit_no        text NOT NULL,
  cash_point_id     uuid NOT NULL REFERENCES finance.cash_point (id),
  currency          finance.currency_code NOT NULL,
  amount            finance.money NOT NULL CONSTRAINT bank_deposit_amount_positive CHECK (amount > 0),
  bank_account_id   uuid NOT NULL REFERENCES finance.ledger_account (id),
  financial_year_id uuid NOT NULL REFERENCES finance.financial_year (id),
  deposited_on      date NOT NULL,
  -- The bank's own stamp. A banking with no slip is a claim, not a deposit.
  slip_reference    text NOT NULL CONSTRAINT bank_deposit_slip_given CHECK (length(btrim(slip_reference)) >= 3),
  voucher_id        uuid NOT NULL REFERENCES finance.voucher (id),
  narration         text,
  prepared_by       uuid NOT NULL REFERENCES public.users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  cancelled_at      timestamptz,
  cancelled_by      uuid REFERENCES public.users (id),
  cancel_reason     text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_deposit_no ON finance.bank_deposit (authority_id, deposit_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_deposit_voucher ON finance.bank_deposit (voucher_id);
CREATE INDEX IF NOT EXISTS idx_bank_deposit_point ON finance.bank_deposit (cash_point_id, deposited_on);

COMMENT ON TABLE finance.bank_deposit IS
  'Takings carried to the bank: Dr bank / Cr till cash, with the deposit slip reference. Prepared '
  'by the cash office and posted by somebody else.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 7. THE VIEWS — ONE DEFINITION OF "THE SESSION'S RECEIPTS" AND "WHAT THE TILL HOLDS"
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS finance.v_till_position;
DROP VIEW IF EXISTS finance.v_cashier_session_total;
DROP VIEW IF EXISTS finance.v_cashier_session_receipt;

-- Sundry and rates receipts of a session as one list. `is_physical` is the definition the cash-up
-- uses: cash and cheques are in the drawer, everything else went straight to a bank or wallet.
CREATE VIEW finance.v_cashier_session_receipt WITH (security_invoker = true) AS
SELECT r.cashier_session_id, r.authority_id, 'sundry'::text AS source, r.id AS receipt_id,
       r.receipt_no, r.payer_name, r.party_id, r.currency, r.amount::numeric(18,2) AS amount,
       r.method, r.method_reference, r.deposit_account_id, r.voucher_id, v.status AS voucher_status,
       (r.cancelled_at IS NOT NULL) AS is_cancelled, r.cancel_reason,
       (r.method IN ('cash', 'cheque')) AS is_physical,
       r.received_on, r.created_at, r.created_by, r.narration
  FROM finance.cash_receipt r
  JOIN finance.voucher v ON v.id = r.voucher_id
UNION ALL
SELECT rr.cashier_session_id, rr.authority_id, 'rates'::text, rr.id,
       rr.receipt_no, p.name, rr.party_id, rr.currency, rr.amount::numeric(18,2),
       rr.method, rr.reference,
       (SELECT l.ledger_account_id FROM finance.voucher_line l
         WHERE l.voucher_id = rr.voucher_id AND l.debit > 0 ORDER BY l.line_no LIMIT 1),
       rr.voucher_id, v.status,
       (rr.deleted_at IS NOT NULL OR v.status = 'cancelled'), v.cancel_reason,
       (rr.method IN ('cash', 'cheque')),
       rr.received_on, rr.created_at, rr.created_by, rr.narration
  FROM finance.rates_receipt rr
  JOIN finance.voucher v ON v.id = rr.voucher_id
  JOIN finance.party p ON p.id = rr.party_id
 WHERE rr.cashier_session_id IS NOT NULL;

CREATE VIEW finance.v_cashier_session_total WITH (security_invoker = true) AS
SELECT cashier_session_id, authority_id, currency, method,
       count(*)::integer AS receipts, sum(amount)::numeric(18,2) AS amount,
       bool_or(is_physical) AS is_physical
  FROM finance.v_cashier_session_receipt
 WHERE NOT is_cancelled
 GROUP BY cashier_session_id, authority_id, currency, method;

-- What each till holds, per currency, three ways: what the LEDGER says it holds (posted), what is
-- in the drawer and not yet in the ledger (receipts of sessions not yet verified), and what has
-- been carried to the bank but not yet posted. The first is the control account; the other two are
-- why it does not yet equal the drawer.
CREATE VIEW finance.v_till_position WITH (security_invoker = true) AS
WITH cur AS (SELECT unnest(ARRAY['USD', 'ZWG'])::finance.currency_code AS currency)
SELECT cp.id AS cash_point_id, cp.authority_id, cp.code, cp.name, cur.currency,
       COALESCE((SELECT sum(e.debit - e.credit) FROM finance.ledger_entry e
                  WHERE e.ledger_account_id = cp.till_account_id AND e.currency = cur.currency), 0)::numeric(18,2) AS ledger_balance,
       COALESCE((SELECT sum(r.amount) FROM finance.v_cashier_session_receipt r
                  JOIN finance.cashier_session s ON s.id = r.cashier_session_id
                 WHERE s.cash_point_id = cp.id AND s.status <> 'verified' AND r.currency = cur.currency
                   AND r.is_physical AND NOT r.is_cancelled AND r.voucher_status = 'draft'), 0)::numeric(18,2) AS unverified_takings,
       COALESCE((SELECT sum(d.amount) FROM finance.bank_deposit d
                  JOIN finance.voucher v ON v.id = d.voucher_id
                 WHERE d.cash_point_id = cp.id AND d.currency = cur.currency
                   AND d.cancelled_at IS NULL AND v.status = 'draft'), 0)::numeric(18,2) AS deposits_awaiting_posting
  FROM finance.cash_point cp CROSS JOIN cur
 WHERE cp.deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 8. THE ACTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── Open a session ───────────────────────────────────────────────────────────────────────────
-- p_floats: [{ "currency": "USD", "amount": "50.00" }]. A currency with no float row starts at nil.
CREATE OR REPLACE FUNCTION finance.open_cashier_session(
  p_cash_point_id uuid, p_cashier_id uuid, p_financial_year_id uuid, p_business_date date,
  p_floats jsonb DEFAULT '[]'::jsonb)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  cp record; y record; per record; f record;
  v_id uuid;
BEGIN
  IF p_cashier_id IS NULL THEN
    RAISE EXCEPTION 'a session names its cashier' USING ERRCODE = '23502';
  END IF;
  SELECT id, authority_id, code, name, status INTO cp
    FROM finance.cash_point WHERE id = p_cash_point_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cash point % does not exist', p_cash_point_id USING ERRCODE = '23503';
  END IF;
  IF cp.status <> 'active' THEN
    RAISE EXCEPTION 'cash point % is not in use', cp.name USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM finance.cashier_session WHERE cashier_id = p_cashier_id AND status = 'open') THEN
    RAISE EXCEPTION 'you already have a session open; cash it up before opening another'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM finance.cashier_session WHERE cash_point_id = p_cash_point_id AND status = 'open') THEN
    RAISE EXCEPTION 'cash point % already has a session open; one drawer has one cashier at a time', cp.name
      USING ERRCODE = '23514';
  END IF;

  SELECT id, label, start_date, end_date, status INTO y
    FROM finance.financial_year WHERE id = p_financial_year_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'financial year % does not exist', p_financial_year_id USING ERRCODE = '23503';
  END IF;
  IF p_business_date < y.start_date OR p_business_date > y.end_date THEN
    RAISE EXCEPTION 'the business date % is not inside financial year % (% to %)',
      p_business_date, y.label, y.start_date, y.end_date USING ERRCODE = '23514';
  END IF;
  -- Refused at opening rather than at cash-up: a day's takings that can never be posted is a far
  -- worse discovery at five o'clock than at eight.
  SELECT lp.period_no, lp.status INTO per
    FROM finance.ledger_period lp
   WHERE lp.financial_year_id = p_financial_year_id
     AND p_business_date BETWEEN lp.from_date AND lp.to_date
   ORDER BY lp.period_no LIMIT 1;
  IF per.period_no IS NULL THEN
    RAISE EXCEPTION 'no accounting period of financial year % contains %', y.label, p_business_date
      USING ERRCODE = '23514', HINT = 'The accountant opens the periods for the year first.';
  END IF;
  IF per.status <> 'open' THEN
    RAISE EXCEPTION 'accounting period % is % and accepts no postings, so takings dated % could never be posted',
      per.period_no, per.status, p_business_date USING ERRCODE = '23514';
  END IF;

  INSERT INTO finance.cashier_session
    (authority_id, session_no, cash_point_id, cashier_id, financial_year_id, business_date)
  VALUES (cp.authority_id, finance.next_document_no(cp.authority_id, 'cashier_session'),
          p_cash_point_id, p_cashier_id, p_financial_year_id, p_business_date)
  RETURNING id INTO v_id;

  FOR f IN SELECT (x->>'currency') AS currency, (x->>'amount')::numeric AS amount
             FROM jsonb_array_elements(COALESCE(p_floats, '[]'::jsonb)) x
  LOOP
    IF f.amount IS NULL OR f.amount < 0 THEN
      RAISE EXCEPTION 'a float is nil or more' USING ERRCODE = '23514';
    END IF;
    INSERT INTO finance.cashier_session_count (cashier_session_id, authority_id, currency, opening_float)
    VALUES (v_id, cp.authority_id, f.currency, f.amount);
  END LOOP;
  RETURN v_id;
END $$;

-- ── The session a receipt may be taken in (control C1), and the account it debits (C9) ───────
-- One function read by both kinds of receipt, so sundry and rates payments cannot come to follow
-- different rules about whose session it is or where non-cash money goes.
CREATE OR REPLACE FUNCTION finance.cashier_session_for_receipt(
  p_session_id uuid, p_cashier_id uuid, p_method text, p_deposit_account_id uuid,
  OUT authority_id integer, OUT financial_year_id uuid, OUT business_date date,
  OUT session_no text, OUT debit_account_id uuid)
LANGUAGE plpgsql AS $$
DECLARE s record; a record;
BEGIN
  SELECT cs.id, cs.authority_id, cs.session_no, cs.cashier_id, cs.status, cs.financial_year_id,
         cs.business_date, cp.till_account_id, cp.name AS point_name
    INTO s
    FROM finance.cashier_session cs JOIN finance.cash_point cp ON cp.id = cs.cash_point_id
   WHERE cs.id = p_session_id
     FOR UPDATE OF cs;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cashier session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;
  IF s.cashier_id IS DISTINCT FROM p_cashier_id THEN
    RAISE EXCEPTION 'session % belongs to another cashier, and a receipt is taken only in your own session', s.session_no
      USING ERRCODE = '23514';
  END IF;
  IF s.status <> 'open' THEN
    RAISE EXCEPTION 'session % is % and takes no more receipts', s.session_no, s.status
      USING ERRCODE = '23514', HINT = 'Open a new session to take this payment.';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash', 'cheque', 'mobile_money', 'card', 'bank_transfer') THEN
    RAISE EXCEPTION 'a receipt records how it was paid' USING ERRCODE = '23514';
  END IF;

  IF p_method IN ('cash', 'cheque') THEN
    IF p_deposit_account_id IS NOT NULL AND p_deposit_account_id <> s.till_account_id THEN
      RAISE EXCEPTION 'cash and cheques go into the till of %; they cannot be receipted into another account', s.point_name
        USING ERRCODE = '23514';
    END IF;
    debit_account_id := s.till_account_id;
  ELSE
    IF p_deposit_account_id IS NULL THEN
      RAISE EXCEPTION 'a % payment names the bank or wallet account it was paid into', replace(p_method, '_', ' ')
        USING ERRCODE = '23514';
    END IF;
    SELECT la.code, la.name, la.account_type, la.is_postable, la.status, la.deleted_at INTO a
      FROM finance.ledger_account la WHERE la.id = p_deposit_account_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'account % does not exist', p_deposit_account_id USING ERRCODE = '23503';
    END IF;
    IF a.account_type IS DISTINCT FROM 'bank' THEN
      RAISE EXCEPTION 'account % (%) is not a bank account; money that is not in the drawer is never receipted into the till', a.code, a.name
        USING ERRCODE = '23514';
    END IF;
    IF NOT a.is_postable OR a.status <> 'active' OR a.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'account % (%) cannot be posted to', a.code, a.name USING ERRCODE = '23514';
    END IF;
    debit_account_id := p_deposit_account_id;
  END IF;

  authority_id := s.authority_id;
  financial_year_id := s.financial_year_id;
  business_date := s.business_date;
  session_no := s.session_no;
END $$;

-- ── A sundry receipt ─────────────────────────────────────────────────────────────────────────
-- p_lines: [{ "income_code_id": uuid, "quantity": "1", "unit_amount": "25.00", "narration": "…" }].
-- Amounts are text and are cast to NUMERIC here; no figure in this function has ever been a float.
CREATE OR REPLACE FUNCTION finance.record_cash_receipt(
  p_session_id uuid, p_cashier_id uuid, p_payer_name text, p_currency finance.currency_code,
  p_method text, p_lines jsonb,
  p_deposit_account_id uuid DEFAULT NULL, p_party_id uuid DEFAULT NULL,
  p_method_reference text DEFAULT NULL, p_narration text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  s record; l record; ic record;
  v_no text; v_voucher uuid; v_receipt uuid;
  v_line integer := 0; v_total numeric(18,2) := 0;
  v_fixed numeric; v_unit numeric; v_amount numeric(18,2);
  v_costed jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO s FROM finance.cashier_session_for_receipt(p_session_id, p_cashier_id, p_method, p_deposit_account_id);
  IF length(btrim(COALESCE(p_payer_name, ''))) < 2 THEN
    RAISE EXCEPTION 'a receipt names who paid' USING ERRCODE = '23502';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'a receipt is for at least one thing' USING ERRCODE = '23514';
  END IF;

  v_no := finance.next_document_no(s.authority_id, 'receipt');

  INSERT INTO finance.voucher
    (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
     narration, reference, status, prepared_by)
  VALUES (s.authority_id, v_no, 'receipt', p_currency, s.financial_year_id, s.business_date,
          COALESCE(p_narration, 'Received from ' || btrim(p_payer_name)),
          COALESCE(p_method_reference, s.session_no), 'draft', p_cashier_id)
  RETURNING id INTO v_voucher;

  -- The receipt header needs the total, and the total is the sum of lines the database computes,
  -- so the lines are costed first (into v_costed) and the header written after.
  FOR l IN
    SELECT (x->>'income_code_id')::uuid AS income_code_id,
           COALESCE((x->>'quantity')::numeric, 1) AS quantity,
           (x->>'unit_amount')::numeric AS unit_amount,
           NULLIF(btrim(x->>'narration'), '') AS narration
      FROM jsonb_array_elements(p_lines) x
  LOOP
    SELECT i.id, i.code, i.name, i.ledger_account_id, i.department_id, i.pricing, i.status,
           i.unit_amount_usd, i.unit_amount_zwg INTO ic
      FROM finance.income_code i WHERE i.id = l.income_code_id AND i.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'income code % does not exist', l.income_code_id USING ERRCODE = '23503';
    END IF;
    IF ic.status <> 'active' THEN
      RAISE EXCEPTION 'income code % (%) is no longer in use', ic.code, ic.name USING ERRCODE = '23514';
    END IF;
    IF l.quantity IS NULL OR l.quantity <= 0 THEN
      RAISE EXCEPTION 'a quantity is greater than nil' USING ERRCODE = '23514';
    END IF;
    v_fixed := CASE p_currency::text WHEN 'USD' THEN ic.unit_amount_usd ELSE ic.unit_amount_zwg END;
    IF ic.pricing = 'fixed' THEN
      IF v_fixed IS NULL THEN
        RAISE EXCEPTION '% (%) has no charge set in %, so it cannot be receipted in that currency', ic.name, ic.code, p_currency
          USING ERRCODE = '23514',
                HINT = 'The charge is the Council''s to set (decision D22). No conversion from the other currency is made.';
      END IF;
      IF l.unit_amount IS NOT NULL AND l.unit_amount <> v_fixed THEN
        RAISE EXCEPTION 'the charge for % is % % and the counter may not vary it; this receipt says %',
          ic.name, p_currency, v_fixed, l.unit_amount USING ERRCODE = '23514';
      END IF;
      v_unit := v_fixed;
    ELSIF l.unit_amount IS NULL OR l.unit_amount <= 0 THEN
      RAISE EXCEPTION 'the amount for % is greater than nil', ic.name USING ERRCODE = '23514';
    ELSE
      v_unit := round(l.unit_amount, 2);
    END IF;

    v_line := v_line + 1;
    v_amount := round(l.quantity * v_unit, 2);
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'the amount for % rounds to nil', ic.name USING ERRCODE = '23514';
    END IF;
    v_total := v_total + v_amount;
    v_costed := v_costed || jsonb_build_object(
      'line_no', v_line, 'income_code_id', ic.id, 'quantity', l.quantity::text,
      'unit_amount', v_unit::text, 'amount', v_amount::text,
      'ledger_account_id', ic.ledger_account_id, 'department_id', ic.department_id,
      'narration', COALESCE(l.narration, ic.name));
  END LOOP;

  -- Dr the till (or the bank, for money that never entered the drawer), the whole payment.
  INSERT INTO finance.voucher_line
    (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, party_id, narration)
  VALUES (s.authority_id, v_voucher, 1, s.debit_account_id, v_total, 0, p_party_id,
          'Receipt ' || v_no || ', ' || btrim(p_payer_name));
  -- Cr revenue, one line per thing paid for, carrying its vote.
  INSERT INTO finance.voucher_line
    (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, party_id, department_id, narration)
  SELECT s.authority_id, v_voucher, d.line_no + 1, d.ledger_account_id, 0, d.amount, p_party_id,
         d.department_id, d.narration
    FROM jsonb_to_recordset(v_costed) AS d(line_no integer, income_code_id uuid, quantity numeric,
           unit_amount numeric, amount numeric, ledger_account_id uuid, department_id uuid, narration text)
   ORDER BY d.line_no;

  INSERT INTO finance.cash_receipt
    (authority_id, receipt_no, cashier_session_id, payer_name, party_id, currency, amount, method,
     method_reference, deposit_account_id, received_on, voucher_id, narration, created_by)
  VALUES (s.authority_id, v_no, p_session_id, btrim(p_payer_name), p_party_id, p_currency, v_total,
          p_method, NULLIF(btrim(p_method_reference), ''), s.debit_account_id, s.business_date,
          v_voucher, p_narration, p_cashier_id)
  RETURNING id INTO v_receipt;

  INSERT INTO finance.cash_receipt_line
    (authority_id, cash_receipt_id, line_no, income_code_id, quantity, unit_amount, narration)
  SELECT s.authority_id, v_receipt, d.line_no, d.income_code_id, d.quantity, d.unit_amount, d.narration
    FROM jsonb_to_recordset(v_costed) AS d(line_no integer, income_code_id uuid, quantity numeric,
           unit_amount numeric, amount numeric, ledger_account_id uuid, department_id uuid, narration text)
   ORDER BY d.line_no;

  RETURN v_receipt;
END $$;

COMMENT ON FUNCTION finance.record_cash_receipt(uuid, uuid, text, finance.currency_code, text, jsonb, uuid, uuid, text, text) IS
  'Raises a sundry receipt and its DRAFT voucher inside the caller''s own open session: Dr till (or '
  'bank, for non-cash) / Cr revenue per income code. Issues the receipt number. Refuses a session '
  'that is not open or not the caller''s, a fixed charge varied at the counter, and non-cash money '
  'aimed at the till. Posts nothing.';

-- ── A rates payment at the counter ───────────────────────────────────────────────────────────
-- finance.record_rates_receipt() (206:246) does the work and keeps every rule it had. What this
-- adds is the session (C1), the till (C9), the issued number (C2) and the link to the cash-up.
CREATE OR REPLACE FUNCTION finance.record_counter_rates_receipt(
  p_session_id uuid, p_cashier_id uuid, p_rates_account_id uuid, p_amount numeric,
  p_currency finance.currency_code, p_method text, p_allocations jsonb DEFAULT '[]'::jsonb,
  p_deposit_account_id uuid DEFAULT NULL, p_method_reference text DEFAULT NULL,
  p_narration text DEFAULT NULL, p_receivable_account_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE s record; v_no text; v_receipt uuid;
BEGIN
  SELECT * INTO s FROM finance.cashier_session_for_receipt(p_session_id, p_cashier_id, p_method, p_deposit_account_id);
  IF p_method NOT IN ('cash', 'cheque') AND length(btrim(COALESCE(p_method_reference, ''))) < 3 THEN
    RAISE EXCEPTION 'a % payment names the transaction reference', replace(p_method, '_', ' ')
      USING ERRCODE = '23514';
  END IF;
  v_no := finance.next_document_no(s.authority_id, 'receipt');
  v_receipt := finance.record_rates_receipt(
    p_rates_account_id, s.financial_year_id, v_no, p_amount, p_currency, s.business_date,
    s.debit_account_id, p_cashier_id, p_allocations, p_receivable_account_id, p_method,
    NULLIF(btrim(p_method_reference), ''), p_narration);
  UPDATE finance.rates_receipt SET cashier_session_id = p_session_id WHERE id = v_receipt;
  RETURN v_receipt;
END $$;

-- ── Cancel a sundry receipt (control C3) ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION finance.cancel_cash_receipt(p_receipt_id uuid, p_by uuid, p_reason text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT cr.id, cr.receipt_no, cr.cancelled_at, cr.voucher_id, v.status AS voucher_status,
         cs.status AS session_status, cs.session_no, cs.cashier_id
    INTO r
    FROM finance.cash_receipt cr
    JOIN finance.voucher v ON v.id = cr.voucher_id
    JOIN finance.cashier_session cs ON cs.id = cr.cashier_session_id
   WHERE cr.id = p_receipt_id
     FOR UPDATE OF cr, v;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'receipt % does not exist', p_receipt_id USING ERRCODE = '23503';
  END IF;
  IF r.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'receipt % is already cancelled', r.receipt_no USING ERRCODE = '23514';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'cancelling a receipt needs a reason, which goes on the record' USING ERRCODE = '23502';
  END IF;
  IF r.cashier_id IS DISTINCT FROM p_by THEN
    RAISE EXCEPTION 'receipt % was taken in another cashier''s session, and only they can cancel it while it is open', r.receipt_no
      USING ERRCODE = '23514';
  END IF;
  IF r.session_status <> 'open' THEN
    RAISE EXCEPTION 'session % is % and its receipts can no longer be cancelled at the counter', r.session_no, r.session_status
      USING ERRCODE = '23514',
            HINT = 'Once the count is declared, a receipt is corrected by the verifier returning the session, or after posting by a reversal in the general ledger.';
  END IF;
  IF r.voucher_status <> 'draft' THEN
    RAISE EXCEPTION 'receipt % is % in the ledger; it is reversed there, not cancelled', r.receipt_no, r.voucher_status
      USING ERRCODE = '23514';
  END IF;
  UPDATE finance.voucher
     SET status = 'cancelled', cancelled_by = p_by, cancelled_at = now(), cancel_reason = btrim(p_reason)
   WHERE id = r.voucher_id;
  UPDATE finance.cash_receipt
     SET cancelled_at = now(), cancelled_by = p_by, cancel_reason = btrim(p_reason)
   WHERE id = p_receipt_id;
END $$;

-- ── Cash up: the cashier declares the count (controls C6, C7, C8) ────────────────────────────
-- p_counts: [{ "currency": "USD", "declared_total": "412.50", "explanation": "…" }].
-- The expected figure is computed HERE, from the session's own receipts, and is not an input.
CREATE OR REPLACE FUNCTION finance.close_cashier_session(p_session_id uuid, p_cashier_id uuid, p_counts jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE s record; c record; d record;
BEGIN
  SELECT * INTO s FROM finance.cashier_session WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cashier session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;
  IF s.cashier_id IS DISTINCT FROM p_cashier_id THEN
    RAISE EXCEPTION 'session % belongs to another cashier; the count is declared by whoever took the money', s.session_no
      USING ERRCODE = '23514';
  END IF;
  IF s.status <> 'open' THEN
    RAISE EXCEPTION 'session % is already %', s.session_no, s.status USING ERRCODE = '23514';
  END IF;

  -- Every currency the drawer could hold: one with a float, or one a physical receipt was taken in.
  FOR c IN
    SELECT cur.currency,
           COALESCE((SELECT sc.opening_float FROM finance.cashier_session_count sc
                      WHERE sc.cashier_session_id = p_session_id AND sc.currency = cur.currency), 0) AS opening_float,
           COALESCE((SELECT sum(r.amount) FROM finance.v_cashier_session_receipt r
                      WHERE r.cashier_session_id = p_session_id AND r.currency = cur.currency
                        AND r.is_physical AND NOT r.is_cancelled), 0)::numeric(18,2) AS expected
      FROM (SELECT unnest(ARRAY['USD', 'ZWG'])::finance.currency_code AS currency) cur
  LOOP
    SELECT (x->>'declared_total')::numeric AS declared_total, NULLIF(btrim(x->>'explanation'), '') AS explanation
      INTO d
      FROM jsonb_array_elements(COALESCE(p_counts, '[]'::jsonb)) x
     WHERE x->>'currency' = c.currency::text
     LIMIT 1;
    IF d.declared_total IS NULL THEN
      IF c.opening_float = 0 AND c.expected = 0 THEN CONTINUE; END IF;
      RAISE EXCEPTION 'the % count has not been declared', c.currency
        USING ERRCODE = '23514', HINT = 'Count the drawer in each currency it holds, including the float.';
    END IF;
    IF d.declared_total < 0 THEN
      RAISE EXCEPTION 'a count is nil or more' USING ERRCODE = '23514';
    END IF;
    IF d.declared_total - c.opening_float - c.expected <> 0 AND length(COALESCE(d.explanation, '')) < 5 THEN
      RAISE EXCEPTION 'the % count differs from the receipts by %, and a difference is explained in writing before the session can be closed',
        c.currency, (d.declared_total - c.opening_float - c.expected)::numeric(18,2)
        USING ERRCODE = '23514';
    END IF;
    INSERT INTO finance.cashier_session_count AS sc
      (cashier_session_id, authority_id, currency, opening_float, expected_takings, declared_total, explanation)
    VALUES (p_session_id, s.authority_id, c.currency, c.opening_float, c.expected, d.declared_total, d.explanation)
    ON CONFLICT (cashier_session_id, currency) DO UPDATE
      SET expected_takings = EXCLUDED.expected_takings, declared_total = EXCLUDED.declared_total,
          explanation = EXCLUDED.explanation;
  END LOOP;

  UPDATE finance.cashier_session SET status = 'closed', closed_at = now() WHERE id = p_session_id;
END $$;

-- ── Send a count back ────────────────────────────────────────────────────────────────────────
-- A mistyped count has to have a remedy that is not "post a difference that never happened".
CREATE OR REPLACE FUNCTION finance.return_cashier_session(p_session_id uuid, p_by uuid, p_reason text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM finance.cashier_session WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cashier session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;
  IF s.status <> 'closed' THEN
    RAISE EXCEPTION 'session % is % and only a closed, unverified session can be returned', s.session_no, s.status
      USING ERRCODE = '23514';
  END IF;
  IF s.cashier_id = p_by THEN
    RAISE EXCEPTION 'session % is yours; returning a count for recounting is the verifier''s act', s.session_no
      USING ERRCODE = '23514';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'returning a session needs a reason the cashier can act on' USING ERRCODE = '23502';
  END IF;
  UPDATE finance.cashier_session_count
     SET declared_total = NULL, expected_takings = NULL, explanation = NULL
   WHERE cashier_session_id = p_session_id;
  UPDATE finance.cashier_session
     SET status = 'open', closed_at = NULL, returned_by = p_by, returned_at = now(), return_reason = btrim(p_reason)
   WHERE id = p_session_id;
END $$;

-- ── Verify: a second person agrees the count, and the session reaches the ledger (C4, C5, C6) ─
CREATE OR REPLACE FUNCTION finance.verify_cashier_session(p_session_id uuid, p_verifier uuid, p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  s record; c record; r record;
  v_voucher uuid; v_posted integer := 0; v_abs numeric(18,2);
BEGIN
  SELECT cs.*, cp.till_account_id, cp.difference_account_id, cp.name AS point_name
    INTO s
    FROM finance.cashier_session cs JOIN finance.cash_point cp ON cp.id = cs.cash_point_id
   WHERE cs.id = p_session_id
     FOR UPDATE OF cs;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cashier session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;
  IF p_verifier IS NULL THEN
    RAISE EXCEPTION 'verifying a session requires the person verifying it' USING ERRCODE = '23502';
  END IF;
  IF s.cashier_id = p_verifier THEN
    RAISE EXCEPTION 'session % is your own cash-up and must be verified by somebody else', s.session_no
      USING ERRCODE = '23514', HINT = 'Separation of duties: whoever takes the money does not agree the count.';
  END IF;
  IF s.status <> 'closed' THEN
    RAISE EXCEPTION 'session % is % and only a closed session can be verified', s.session_no, s.status
      USING ERRCODE = '23514';
  END IF;

  -- The receipts are re-totalled NOW. A rates receipt can be cancelled through its own route after
  -- the count was declared, and verifying against a stale expectation would post a wrong difference.
  FOR c IN
    SELECT sc.currency, sc.opening_float, sc.declared_total, sc.explanation,
           COALESCE((SELECT sum(x.amount) FROM finance.v_cashier_session_receipt x
                      WHERE x.cashier_session_id = p_session_id AND x.currency = sc.currency
                        AND x.is_physical AND NOT x.is_cancelled), 0)::numeric(18,2) AS expected_now,
           sc.expected_takings
      FROM finance.cashier_session_count sc
     WHERE sc.cashier_session_id = p_session_id AND sc.declared_total IS NOT NULL
  LOOP
    IF c.expected_now <> c.expected_takings THEN
      RAISE EXCEPTION 'the % receipts of session % have changed since the count was declared (% then, % now); return the session for a recount',
        c.currency, s.session_no, c.expected_takings, c.expected_now USING ERRCODE = '23514';
    END IF;
    v_abs := abs(c.declared_total - c.opening_float - c.expected_takings);
    IF v_abs = 0 THEN CONTINUE; END IF;
    IF s.difference_account_id IS NULL THEN
      RAISE EXCEPTION 'session % has a % difference of % and cash point % has no cash-difference account, so it cannot be posted',
        s.session_no, c.currency, v_abs, s.point_name
        USING ERRCODE = '23514',
              HINT = 'Name the account on the cash point (decision D22). A difference is posted, never absorbed.';
    END IF;

    INSERT INTO finance.voucher
      (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
       narration, reference, status, prepared_by)
    VALUES (s.authority_id, s.session_no || '-D-' || c.currency, 'journal', c.currency,
            s.financial_year_id, s.business_date,
            'Cash ' || CASE WHEN c.declared_total - c.opening_float - c.expected_takings < 0 THEN 'shortage' ELSE 'surplus' END
              || ' at cash-up, session ' || s.session_no || ': ' || c.explanation,
            s.session_no, 'draft', s.cashier_id)
    RETURNING id INTO v_voucher;
    IF c.declared_total - c.opening_float - c.expected_takings < 0 THEN
      -- Short: the drawer holds less than the receipts say. Dr the difference, Cr the till.
      INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
      VALUES (s.authority_id, v_voucher, 1, s.difference_account_id, v_abs, 0, 'Cash shortage, session ' || s.session_no),
             (s.authority_id, v_voucher, 2, s.till_account_id, 0, v_abs, 'Cash shortage, session ' || s.session_no);
    ELSE
      INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
      VALUES (s.authority_id, v_voucher, 1, s.till_account_id, v_abs, 0, 'Cash surplus, session ' || s.session_no),
             (s.authority_id, v_voucher, 2, s.difference_account_id, 0, v_abs, 'Cash surplus, session ' || s.session_no);
    END IF;
    UPDATE finance.cashier_session_count SET difference_voucher_id = v_voucher
     WHERE cashier_session_id = p_session_id AND currency = c.currency;
    PERFORM finance.post_voucher(v_voucher, p_verifier);
    v_posted := v_posted + 1;
  END LOOP;

  -- Every receipt of the session, in the order it was taken. One that somebody already posted on
  -- its own (a rates receipt, through the rates screen) is left as it is.
  FOR r IN
    SELECT x.voucher_id FROM finance.v_cashier_session_receipt x
     WHERE x.cashier_session_id = p_session_id AND NOT x.is_cancelled AND x.voucher_status = 'draft'
     ORDER BY x.created_at, x.receipt_no
  LOOP
    PERFORM finance.post_voucher(r.voucher_id, p_verifier);
    v_posted := v_posted + 1;
  END LOOP;

  UPDATE finance.cashier_session
     SET status = 'verified', verified_by = p_verifier, verified_at = now(), verify_note = NULLIF(btrim(p_note), '')
   WHERE id = p_session_id;
  RETURN v_posted;
END $$;

COMMENT ON FUNCTION finance.verify_cashier_session(uuid, uuid, text) IS
  'A second person agrees a closed session''s count. Posts every draft receipt voucher of the '
  'session and one cash-difference journal per currency that needs one, all in the caller''s '
  'transaction, with the verifier as poster. Refuses the cashier verifying their own session, and '
  'a difference with no account to post it to.';

-- ── The banking ──────────────────────────────────────────────────────────────────────────────
-- Only money the LEDGER says the till holds can be banked: takings of a session nobody has
-- verified are not yet the till account's, and banking them would credit the till below nil.
CREATE OR REPLACE FUNCTION finance.prepare_bank_deposit(
  p_cash_point_id uuid, p_prepared_by uuid, p_currency finance.currency_code, p_amount numeric,
  p_bank_account_id uuid, p_financial_year_id uuid, p_deposited_on date, p_slip_reference text,
  p_narration text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE cp record; a record; pos record; v_no text; v_voucher uuid; v_id uuid; v_available numeric(18,2);
BEGIN
  IF p_prepared_by IS NULL THEN
    RAISE EXCEPTION 'a banking records who prepared it' USING ERRCODE = '23502';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'a banking is for an amount greater than nil' USING ERRCODE = '23514';
  END IF;
  IF length(btrim(COALESCE(p_slip_reference, ''))) < 3 THEN
    RAISE EXCEPTION 'a banking carries the bank''s deposit slip reference' USING ERRCODE = '23502';
  END IF;
  SELECT id, authority_id, name, till_account_id INTO cp
    FROM finance.cash_point WHERE id = p_cash_point_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cash point % does not exist', p_cash_point_id USING ERRCODE = '23503';
  END IF;
  SELECT code, name, account_type, is_postable, status, deleted_at INTO a
    FROM finance.ledger_account WHERE id = p_bank_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank account % does not exist', p_bank_account_id USING ERRCODE = '23503';
  END IF;
  IF a.account_type IS DISTINCT FROM 'bank' THEN
    RAISE EXCEPTION 'account % (%) is not a bank account, so takings cannot be banked into it', a.code, a.name
      USING ERRCODE = '23514';
  END IF;
  IF NOT a.is_postable OR a.status <> 'active' OR a.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'account % (%) cannot be posted to', a.code, a.name USING ERRCODE = '23514';
  END IF;

  SELECT ledger_balance, deposits_awaiting_posting INTO pos
    FROM finance.v_till_position WHERE cash_point_id = p_cash_point_id AND currency = p_currency;
  v_available := pos.ledger_balance - pos.deposits_awaiting_posting;
  IF p_amount > v_available THEN
    RAISE EXCEPTION 'the till of % holds % % in the ledger that is not already on its way to the bank, and this banking is for %',
      cp.name, p_currency, v_available, p_amount
      USING ERRCODE = '23514',
            HINT = 'Takings reach the till account when their session is verified. Verify the cash-up first.';
  END IF;

  v_no := finance.next_document_no(cp.authority_id, 'bank_deposit');
  INSERT INTO finance.voucher
    (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
     narration, reference, status, prepared_by)
  VALUES (cp.authority_id, v_no, 'journal', p_currency, p_financial_year_id, p_deposited_on,
          COALESCE(p_narration, 'Takings banked from ' || cp.name), btrim(p_slip_reference), 'draft', p_prepared_by)
  RETURNING id INTO v_voucher;
  INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
  VALUES (cp.authority_id, v_voucher, 1, p_bank_account_id, p_amount, 0, 'Banking ' || v_no || ', slip ' || btrim(p_slip_reference)),
         (cp.authority_id, v_voucher, 2, cp.till_account_id, 0, p_amount, 'Banking ' || v_no || ', slip ' || btrim(p_slip_reference));

  INSERT INTO finance.bank_deposit
    (authority_id, deposit_no, cash_point_id, currency, amount, bank_account_id, financial_year_id,
     deposited_on, slip_reference, voucher_id, narration, prepared_by)
  VALUES (cp.authority_id, v_no, p_cash_point_id, p_currency, p_amount, p_bank_account_id,
          p_financial_year_id, p_deposited_on, btrim(p_slip_reference), v_voucher, p_narration, p_prepared_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 9. THE PERMISSION CATALOGUE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ONE CODE IS FLAGGED is_approval: `finance.cash.session.verify` is the act that puts a day's
-- takings into the book of account, the same act `finance.ledger.voucher.post` is flagged for.
INSERT INTO finance.permission (code, label, category, is_approval, is_publication, is_restricted, description) VALUES
  ('finance.cash.view',            'View the cash office',          'cash', false, false, false, 'Cash points, income codes, cashier sessions, receipts, cash-ups and bankings.'),
  ('finance.cash.setup.manage',    'Maintain cash points and income codes', 'cash', false, false, false, 'The counters, the list of income a cashier may receipt and its charges. Council data (decision D22); this maintains it.'),
  ('finance.cash.session.operate', 'Open and cash up a till',       'cash', false, false, false, 'Open a cashier session at a cash point and declare its count. One open session per cashier.'),
  ('finance.cash.receipt.record',  'Issue a receipt',               'cash', false, false, false, 'Receipt a payment inside your own open session. The number is issued by the system.'),
  ('finance.cash.receipt.cancel',  'Cancel a receipt',              'cash', false, false, false, 'Cancel a receipt taken in your own open session, with a reason. The receipt and its number stay on the record.'),
  ('finance.cash.deposit.prepare', 'Prepare a banking',             'cash', false, false, false, 'Record takings carried to the bank against the deposit slip. Posted by somebody else.'),
  ('finance.cash.session.verify',  'Verify a cash-up',              'cash', true,  false, false, 'Agree a cashier''s declared count and post the session to the book of account. Never the cashier whose session it is.')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category,
      is_approval = EXCLUDED.is_approval, is_publication = EXCLUDED.is_publication,
      is_restricted = EXCLUDED.is_restricted, description = EXCLUDED.description;

-- ── Default grants ────────────────────────────────────────────────────────────────────────────
-- Design §4. Each new role's bundle is what its desk needs (§4.1) and nothing it "cannot" do.
INSERT INTO finance.role_permission (role_name, permission_code) VALUES
  -- THE CASHIER. Takes money, counts it, carries it to the bank. Reads the rates register because
  -- finding a ratepayer's open bills is how a rates payment is taken. Holds no budget, ledger or
  -- report permission: a counter is not a place to browse the council's accounts.
  ('cashier', 'finance.cash.view'),
  ('cashier', 'finance.cash.session.operate'),
  ('cashier', 'finance.cash.receipt.record'),
  ('cashier', 'finance.cash.receipt.cancel'),
  ('cashier', 'finance.cash.deposit.prepare'),
  ('cashier', 'finance.rates.view'),
  ('cashier', 'finance.rates.receipt.record'),

  -- THE ACCOUNTANT. Keeps the book and is the second person on everything the offices prepare.
  ('accountant', 'finance.budget.view'),
  ('accountant', 'finance.actuals.view'),
  ('accountant', 'finance.transaction.view'),
  ('accountant', 'finance.transaction.view_counterparty'),
  ('accountant', 'finance.ledger.view'),
  ('accountant', 'finance.ledger.voucher.prepare'),
  ('accountant', 'finance.ledger.voucher.post'),
  ('accountant', 'finance.ledger.voucher.reverse'),
  ('accountant', 'finance.ledger.period.manage'),
  ('accountant', 'finance.ledger.party.manage'),
  ('accountant', 'finance.rates.view'),
  ('accountant', 'finance.rates.bill.post'),
  ('accountant', 'finance.cash.view'),
  ('accountant', 'finance.cash.setup.manage'),
  ('accountant', 'finance.cash.session.verify'),
  ('accountant', 'finance.project.view'),
  ('accountant', 'finance.document.view'),
  ('accountant', 'finance.document.upload'),
  ('accountant', 'finance.report.view'),
  ('accountant', 'finance.report.export'),
  ('accountant', 'finance.variance.explain'),
  ('accountant', 'finance.map.view'),

  -- THE REVENUE OFFICER. Keeps the registers billing depends on, raises the run, follows arrears.
  -- Drafts a tariff and never approves one; raises a run and never commits it.
  ('revenue_officer', 'finance.budget.view'),
  ('revenue_officer', 'finance.actuals.view'),
  ('revenue_officer', 'finance.ledger.view'),
  ('revenue_officer', 'finance.ledger.party.manage'),
  ('revenue_officer', 'finance.rates.view'),
  ('revenue_officer', 'finance.rates.valuation.manage'),
  ('revenue_officer', 'finance.rates.tariff.manage'),
  ('revenue_officer', 'finance.rates.account.manage'),
  ('revenue_officer', 'finance.rates.bill.prepare'),
  ('revenue_officer', 'finance.rates.receipt.record'),
  ('revenue_officer', 'finance.cash.view'),
  ('revenue_officer', 'finance.document.view'),
  ('revenue_officer', 'finance.document.upload'),
  ('revenue_officer', 'finance.report.view'),
  ('revenue_officer', 'finance.report.export'),
  ('revenue_officer', 'finance.map.view'),

  -- THE ACCOUNTING OFFICER (chief executive). Reads the whole position and, in this phase, writes
  -- nothing. Payment authorisation arrives with creditors (design §9, Phase 3).
  ('accounting_officer', 'finance.budget.view'),
  ('accounting_officer', 'finance.actuals.view'),
  ('accounting_officer', 'finance.transaction.view'),
  ('accounting_officer', 'finance.ledger.view'),
  ('accounting_officer', 'finance.rates.view'),
  ('accounting_officer', 'finance.cash.view'),
  ('accounting_officer', 'finance.project.view'),
  ('accounting_officer', 'finance.document.view'),
  ('accounting_officer', 'finance.report.view'),
  ('accounting_officer', 'finance.report.export'),
  ('accounting_officer', 'finance.audit.view'),
  ('accounting_officer', 'finance.map.view'),

  -- THE EXISTING ROLES. The Director sets the cash office up and may verify a cash-up when the
  -- accountant is away; the officer, the committee, the auditor and the technical administrator read.
  ('finance_admin',     'finance.cash.view'),
  ('finance_admin',     'finance.cash.setup.manage'),
  ('finance_admin',     'finance.cash.session.verify'),
  ('finance_officer',   'finance.cash.view'),
  ('finance_committee', 'finance.cash.view'),
  ('auditor',           'finance.cash.view'),
  ('admin',             'finance.cash.view')
ON CONFLICT (role_name, permission_code) DO NOTHING;

-- Migration 188 section 11's assertions, re-run over the grants as they now stand.
DO $$
DECLARE offender text;
BEGIN
  SELECT rp.role_name INTO offender
    FROM finance.role_permission rp JOIN finance.permission p ON p.code = rp.permission_code
   GROUP BY rp.role_name
  HAVING bool_or(p.is_approval) AND bool_or(p.is_publication)
   LIMIT 1;
  IF offender IS NOT NULL THEN
    RAISE EXCEPTION 'role % would hold both an approval and a publication permission; separation of duties forbids it', offender;
  END IF;
  IF EXISTS (
    SELECT 1 FROM finance.role_permission rp JOIN finance.permission p ON p.code = rp.permission_code
     WHERE rp.role_name = 'admin' AND (p.is_approval OR p.is_publication OR p.is_restricted)
  ) THEN
    RAISE EXCEPTION 'the technical administrator must not hold approval, publication or restricted-data permissions by default';
  END IF;
  -- New in 207: the cashier takes money and must hold nothing that puts it in the book.
  IF EXISTS (
    SELECT 1 FROM finance.role_permission rp JOIN finance.permission p ON p.code = rp.permission_code
     WHERE rp.role_name = 'cashier' AND p.is_approval
  ) THEN
    RAISE EXCEPTION 'the cashier must not hold an approval permission by default';
  END IF;
  -- And the accounting officer writes nothing in this phase.
  IF EXISTS (
    SELECT 1 FROM finance.role_permission rp
     WHERE rp.role_name = 'accounting_officer'
       AND rp.permission_code !~ '\.(view|export)$'
  ) THEN
    RAISE EXCEPTION 'the accounting officer holds read and export permissions only in this phase';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 10. TENANCY AND GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r text;
  tables text[] := ARRAY['finance.document_sequence', 'finance.cash_point', 'finance.income_code',
                         'finance.cashier_session', 'finance.cashier_session_count',
                         'finance.cash_receipt', 'finance.cash_receipt_line', 'finance.bank_deposit'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    RAISE NOTICE 'no VUNGU authority here: the cash office tables stay pending until converted by hand';
    FOREACH r IN ARRAY tables LOOP
      PERFORM tenancy.classify(r, 'pending', 'cash office data awaiting the authority it belongs to');
    END LOOP;
    RETURN;
  END IF;

  FOREACH r IN ARRAY tables LOOP
    PERFORM tenancy.make_tenant(r::regclass, 'VUNGU');
  END LOOP;

  FOREACH r IN ARRAY ARRAY['finance.v_cashier_session_receipt', 'finance.v_cashier_session_total',
                           'finance.v_till_position'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
      EXECUTE format('GRANT SELECT ON %s TO vungu_app', r);
    END IF;
    PERFORM tenancy.classify(r, 'tenant_view',
      'runs as the caller (security_invoker); the underlying policies decide the rows');
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 11. WHAT IS DELIBERATELY NOT SEEDED
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- No cash point, no income code, no charge, no float and no session (decision D22). A cashier who
-- signs in on a database fresh from this migration is told the cash office has not been set up and
-- by whom it is; they are not handed a counter called "Main" and a hall-hire fee nobody resolved.
-- No user account is created for any of the four roles (decision D21); the demonstration logins
-- are added by scripts/seed-demo-users.js, not here.
