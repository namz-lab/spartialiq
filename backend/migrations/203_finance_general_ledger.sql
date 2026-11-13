-- 203: the general ledger — Vungu RDC becomes the book of account.
--
-- Design: docs/superpowers/specs/2026-11-10-general-ledger-architecture.md (frontend repo).
-- Routes that depend on this: src/routes/finance-ledger.js.
--
-- WHAT THIS IS, AND WHAT IT IS NOT
-- Migration 188 built a REGISTER of imported actuals: `finance.transaction` carries figures that
-- some other system originated, with `source_system`, `source_ref`, an import batch and a file
-- hash (188:589). Its header is explicit that the council's general ledger lives elsewhere. This
-- migration adds the ledger itself, so the system begins to ORIGINATE figures rather than only
-- restate them. The two coexist on purpose and neither replaces the other: the register remains the
-- record of what Promun/Pastel holds, which is what the parallel run of decision 3 reconciles
-- against.
--
-- `finance.transaction` is NOT altered by this migration, in any way.
--
-- THE GOVERNANCE ITEM THAT IS NOT A DEVELOPER'S TO SETTLE
-- docs/finance/COUNCIL-DECISIONS.md still closes with "It does not replace the Council's general
-- ledger and cannot be used as a book of account". Retracting that sentence is a COUNCIL act — the
-- Auditor-General audits local authorities against what Council resolved — and it is raised as
-- D16. This migration builds the machinery; it does not claim the resolution has been passed, and
-- it claims compliance with no Zimbabwean statute and with no IPSAS standard. "IPSAS-aligned"
-- describes a presentation target and whether it is met is for Council and the Auditor-General.
--
-- FOUR DECISIONS THE CLIENT HAS TAKEN, AND WHAT EACH ONE FORCED HERE
--
-- 1. TWO PARALLEL SETS OF BOOKS, one per currency, each self-balancing.
--    A trial balance must balance. With two currencies and no Council-approved conversion basis
--    (decision D4, and `finance.exchange_rate_policy` still empty and still read by nothing), a
--    single balancing trial balance is arithmetically impossible without inventing a rate. So
--    `finance.voucher.currency` is ONE column on the header: there is nowhere to put a second
--    currency, and `finance.validate_ledger_entry()` refuses an entry whose currency disagrees
--    with its voucher or with the voucher it settles. `finance.v_trial_balance` groups by
--    currency, and there are two of them. No exchange rate is applied anywhere in this file.
--
-- 2. FULL ACCRUAL. A rates bill will recognise revenue when billed and raise a receivable, which
--    is why `finance.ledger_account.account_type` distinguishes a receivable control account and
--    why `against_voucher_id` exists: without the settlement link, ageing cannot be computed and
--    decision D13 stays blocked. The rates/debtors module itself is a later workstream; the ledger
--    primitives it needs are here.
--
-- 3. PARALLEL RUN, THEN CUT OVER. An `opening` voucher loads the opening trial balance per
--    currency and must balance like any other. `finance.cutover_reconciliation` is NOT in this
--    migration — it belongs with the cut-over workstream, and a half-built reconciliation table
--    nobody writes to would look like evidence and be none.
--
-- 4. SCOPE. Ledger core here. Creditors, cashbook/bank reconciliation and fixed assets are
--    deferred (spec §7), which means the statement of financial position this schema can produce
--    shows receivables and NO payables, and the bank balance is unreconciled. Those are stated
--    consequences of the client's scope choice, not defects in what is built, and they are why this
--    is not yet a complete replacement for Promun/Pastel.
--
-- DEBIT AND CREDIT ARE SEPARATE COLUMNS, ONE OF THEM ZERO.
-- The ledger does not use signed amounts. `finance.transaction` does — a reversal there carries the
-- negative of what it reverses (188:794) — and that is a different table with a different job. Here
-- a CHECK constraint requires exactly one of `debit`/`credit` to be non-zero, because "which side
-- of the account" is the primary fact of a double entry and inferring it from a sign loses the
-- distinction between a credit to an asset and a debit to a liability.
--
-- THE THREE INVARIANTS ARE IN THE DATABASE, NOT IN A ROUTE
-- src/routes/finance-budget.js's header says of separation of duties that the CHECK constraint "is
-- the one that holds if the other two are ever edited carelessly". For a book of account the
-- Auditor-General will examine, that is not a preference:
--
--   BALANCE          `finance.assert_voucher_balanced()`, a DEFERRABLE INITIALLY DEFERRED
--                    constraint trigger on finance.ledger_entry. Deferred to COMMIT because a
--                    voucher's entries are inserted one row at a time and every intermediate state
--                    of a legitimate posting is unbalanced; what the invariant is about is the
--                    result. Same reasoning, and the same mechanism, as
--                    `trg_user_permission_override_sod` (200:299).
--   ONE CURRENCY     structural (one column on the header) plus
--                    `finance.validate_ledger_entry()` and the same deferred trigger.
--   IMMUTABILITY     `finance.ledger_entry` takes INSERT only. UPDATE, DELETE and TRUNCATE are
--                    refused by trigger and the privileges are revoked from the application role.
--                    THE SOFT-DELETE CONVENTION USED EVERYWHERE ELSE IN THIS SCHEMA DELIBERATELY
--                    DOES NOT APPLY: there is no `deleted_at` column on finance.ledger_entry,
--                    because a posted ledger line is never amended, flagged or hidden. A correction
--                    is a reversal voucher and both halves stay visible, which is the rule
--                    `finance.transaction.reverses_id` already follows.
--
-- WHY A POSTING FUNCTION AND NOT POSTING SQL IN THE ROUTE
-- `finance.post_voucher()` is the only thing that writes finance.ledger_entry. Period status,
-- separation of duties, balance and account postability are checked in one place, so a second
-- route, a script or a hand-written statement cannot post by a different set of rules. The route
-- calls it and translates its errors; it does not restate its logic.
--
-- IDEMPOTENT: every statement is IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT DO NOTHING, and
-- the tenancy conversion at the foot is guarded on the VUNGU authority existing. Safe to re-run.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. THE GL CHART OF ACCOUNTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CURRENCY-NEUTRAL, deliberately (decision 1c). One chart, two books, and the book an entry
-- belongs to is decided by the entry's own currency. Two parallel charts would drift within a year.
--
-- This is NOT `finance.account` (188:204). That table classifies a BUDGET line as revenue or
-- expenditure, which is a budgeting question with two answers. A ledger account additionally needs
-- assets, liabilities and equity, and a bank account is none of revenue or expenditure. The two
-- charts are related by the council's own numbering and are joined where a report needs both; they
-- are not merged, because merging them would force `finance.account.kind` to grow three values
-- that mean nothing to a budget.
CREATE TABLE IF NOT EXISTS finance.ledger_account (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  code         text NOT NULL,
  name         text NOT NULL,
  -- The five roots of a double-entry chart. Set from the Council-approved chart, never inferred
  -- from the code range — the same rule as `finance.account.kind` (decision D2, 188:28).
  root_type    text NOT NULL CONSTRAINT ledger_account_root_type_known
               CHECK (root_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  -- Which statement the account appears on. DERIVED, so it cannot contradict root_type.
  report_type  text GENERATED ALWAYS AS (
                 CASE WHEN root_type IN ('asset', 'liability', 'equity')
                      THEN 'balance_sheet' ELSE 'performance' END) STORED,
  -- The behaviour the ledger needs to know about: which account is the receivable control (ageing
  -- reads it), which is the bank, which carries the accumulated surplus that year-end closes into.
  account_type text CONSTRAINT ledger_account_type_known
               CHECK (account_type IS NULL OR account_type IN (
                 'receivable', 'payable', 'bank', 'cash', 'accumulated_surplus',
                 'current_surplus', 'tax', 'fixed_asset', 'inventory', 'provision', 'other')),
  parent_id    uuid REFERENCES finance.ledger_account (id),
  -- A group is a heading in the chart. Nothing posts to a heading.
  is_group     boolean NOT NULL DEFAULT false,
  is_postable  boolean NOT NULL DEFAULT true,
  status       text NOT NULL DEFAULT 'active' CONSTRAINT ledger_account_status_known
               CHECK (status IN ('active', 'inactive')),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES public.users (id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  deleted_by   uuid REFERENCES public.users (id),
  CONSTRAINT ledger_account_group_is_not_postable CHECK (NOT (is_group AND is_postable)),
  CONSTRAINT ledger_account_not_its_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_account_code
  ON finance.ledger_account (authority_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_account_root ON finance.ledger_account (authority_id, root_type);
CREATE INDEX IF NOT EXISTS idx_ledger_account_parent ON finance.ledger_account (parent_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account_type ON finance.ledger_account (authority_id, account_type);

COMMENT ON TABLE finance.ledger_account IS
  'The general ledger chart of accounts. Currency-neutral: one chart serves both books and the '
  'entry''s own currency decides which book it falls in (design decision 1c). root_type is Council '
  'data and is never inferred from the account code range.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. THE PARTY REGISTER
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The ratepayer, debtor or supplier a posting is against. The control account carries the total and
-- this register carries the subledger, which is the standard arrangement and the only one in which
-- a receivable control account can be reconciled to a list of names.
--
-- EMPTY ON PURPOSE. `spatial_planning.parcel_owner` holds 0 rows against 731 parcels in
-- `land.parcel`, so there is no ratepayer of record to seed from (spec §5, raised as D19). Rates
-- billing cannot run at all until that register is populated, and inventing a party row here would
-- produce a bill addressed to nobody.
CREATE TABLE IF NOT EXISTS finance.party (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id  integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  party_type    text NOT NULL CONSTRAINT party_type_known
                CHECK (party_type IN ('ratepayer', 'debtor', 'supplier', 'employee', 'other')),
  name          text NOT NULL,
  -- The council's own account number for this party, as printed on its statements.
  reference     text,
  contact_name  text,
  contact_phone text,
  contact_email text,
  address_text  text,
  status        text NOT NULL DEFAULT 'active' CONSTRAINT party_status_known
                CHECK (status IN ('active', 'inactive')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.users (id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  deleted_by    uuid REFERENCES public.users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_party_reference
  ON finance.party (authority_id, reference)
  WHERE deleted_at IS NULL AND reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_party_name ON finance.party (authority_id, lower(name));

COMMENT ON TABLE finance.party IS
  'Ratepayers, debtors and suppliers. The subledger behind a control account. Seeded empty: the '
  'ratepayer of record for each parcel is decision D19 and spatial_planning.parcel_owner holds no '
  'rows.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3. PERIOD CONTROL
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- One row per accounting period per financial year. `open` accepts postings; `closed` does not, and
-- can be reopened by a holder of finance.ledger.period.manage; `locked` is final and is what a
-- council sets after the audit.
--
-- Period 13 is conventional: the year-end adjustment period, whose dates are the last day of the
-- year, so an audit adjustment does not have to be back-dated into a month that was already
-- reported.
CREATE TABLE IF NOT EXISTS finance.ledger_period (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  financial_year_id uuid NOT NULL REFERENCES finance.financial_year (id),
  period_no         integer NOT NULL CONSTRAINT ledger_period_no_in_range
                    CHECK (period_no BETWEEN 1 AND 13),
  label             text,
  from_date         date NOT NULL,
  to_date           date NOT NULL,
  status            text NOT NULL DEFAULT 'open' CONSTRAINT ledger_period_status_known
                    CHECK (status IN ('open', 'closed', 'locked')),
  closed_at         timestamptz,
  closed_by         uuid REFERENCES public.users (id),
  locked_at         timestamptz,
  locked_by         uuid REFERENCES public.users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES public.users (id),
  CONSTRAINT ledger_period_dates_ordered CHECK (to_date >= from_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_period_no
  ON finance.ledger_period (financial_year_id, period_no);
CREATE INDEX IF NOT EXISTS idx_ledger_period_dates
  ON finance.ledger_period (financial_year_id, from_date, to_date);

COMMENT ON TABLE finance.ledger_period IS
  'Accounting periods per financial year, with open/closed/locked status. Posting into anything but '
  'an open period is refused by finance.validate_ledger_entry(), so the refusal holds when the '
  'route is bypassed (acceptance check G5).';

-- Two periods of one year may not overlap, because a posting that falls in two periods would be
-- reported twice and a posting that falls in none could not be posted at all. Expressed as a
-- trigger rather than an EXCLUDE constraint so the migration needs no extension.
CREATE OR REPLACE FUNCTION finance.assert_ledger_periods_do_not_overlap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
DECLARE clash record;
BEGIN
  SELECT p.period_no, p.from_date, p.to_date INTO clash
    FROM finance.ledger_period p
   WHERE p.financial_year_id = NEW.financial_year_id
     AND p.id <> NEW.id
     AND daterange(p.from_date, p.to_date, '[]') && daterange(NEW.from_date, NEW.to_date, '[]')
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'period % (% to %) overlaps period % (% to %) in the same financial year',
      NEW.period_no, NEW.from_date, NEW.to_date, clash.period_no, clash.from_date, clash.to_date
      USING ERRCODE = '23514',
            HINT = 'Periods must tile the financial year exactly: no gap and no overlap.';
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'finance.ledger_period'::regclass AND tgname = 'trg_ledger_period_no_overlap'
  ) THEN
    CREATE TRIGGER trg_ledger_period_no_overlap
      BEFORE INSERT OR UPDATE OF from_date, to_date, financial_year_id ON finance.ledger_period
      FOR EACH ROW EXECUTE FUNCTION finance.assert_ledger_periods_do_not_overlap();
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4. THE VOUCHER — THE BUSINESS DOCUMENT
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The separation of the business document from the ledger line is the one load-bearing accounting
-- idea taken from ERPNext (`erpnext/accounts/general_ledger.py`): an invoice, receipt or journal is
-- a voucher; posting it emits ledger rows; the rows are never edited. A voucher is editable while
-- it is a draft and frozen once posted.
--
-- ONE CURRENCY, ON THE HEADER. There is no per-line currency column, so "a voucher containing two
-- currencies" has nowhere to exist (acceptance check G2). The entry-level trigger then refuses an
-- entry that disagrees with its header, which is the only remaining way the two books could mix.
--
-- SEPARATION OF DUTIES is a CHECK constraint, `voucher_prepared_and_posted_differ`, mirroring
-- `budget_revision`'s `decided_by <> requested_by` (188). The route refuses it first so the message
-- is legible; the constraint is what holds if the route is ever edited carelessly.
CREATE TABLE IF NOT EXISTS finance.voucher (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id        integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  -- The council's own voucher number, as it appears on the document.
  voucher_no          text NOT NULL,
  voucher_type        text NOT NULL CONSTRAINT voucher_type_known CHECK (voucher_type IN (
                        'opening', 'journal', 'rates_bill', 'receipt', 'credit_note',
                        'write_off', 'closing', 'reversal')),
  -- ONE currency per voucher (decision 1). All its lines share it; see the triggers below.
  currency            finance.currency_code NOT NULL,
  financial_year_id   uuid NOT NULL REFERENCES finance.financial_year (id),
  ledger_period_id    uuid REFERENCES finance.ledger_period (id),
  posting_date        date NOT NULL,
  narration           text,
  reference           text,
  status              text NOT NULL DEFAULT 'draft' CONSTRAINT voucher_status_known
                      CHECK (status IN ('draft', 'posted', 'cancelled')),
  -- A correction is a reversal voucher. Both halves stay visible; neither is hidden or flagged
  -- away, which is the same rule finance.transaction.reverses_id follows.
  reverses_voucher_id uuid REFERENCES finance.voucher (id),
  is_opening          boolean NOT NULL DEFAULT false,
  prepared_by         uuid NOT NULL REFERENCES public.users (id),
  prepared_at         timestamptz NOT NULL DEFAULT now(),
  posted_by           uuid REFERENCES public.users (id),
  posted_at           timestamptz,
  cancelled_by        uuid REFERENCES public.users (id),
  cancelled_at        timestamptz,
  cancel_reason       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- A posted voucher names who posted it and when, and an unposted one names neither. Stated as a
  -- constraint so "posted" cannot mean two different things in two different queries.
  CONSTRAINT voucher_posted_is_attributed CHECK (
    (status = 'posted') = (posted_by IS NOT NULL AND posted_at IS NOT NULL)),
  -- Acceptance check G7.
  CONSTRAINT voucher_prepared_and_posted_differ CHECK (
    posted_by IS NULL OR posted_by <> prepared_by),
  CONSTRAINT voucher_reversal_names_its_original CHECK (
    (voucher_type = 'reversal') = (reverses_voucher_id IS NOT NULL)),
  CONSTRAINT voucher_not_its_own_reversal CHECK (
    reverses_voucher_id IS NULL OR reverses_voucher_id <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_voucher_no ON finance.voucher (authority_id, voucher_no);
CREATE INDEX IF NOT EXISTS idx_voucher_year_date
  ON finance.voucher (financial_year_id, posting_date);
CREATE INDEX IF NOT EXISTS idx_voucher_status ON finance.voucher (authority_id, status);
CREATE INDEX IF NOT EXISTS idx_voucher_reverses ON finance.voucher (reverses_voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_period ON finance.voucher (ledger_period_id);

COMMENT ON TABLE finance.voucher IS
  'The business document: journal, rates bill, receipt, opening or closing entry. Carries exactly '
  'one currency (design decision 1) and names a preparer and, once posted, a different poster '
  '(acceptance check G7).';

-- ── The voucher's lines ───────────────────────────────────────────────────────────────────────
-- Explicit debit and credit, one of them zero. `voucher_line_one_side_only` is the constraint that
-- makes a line a double-entry line rather than a signed amount.
--
-- `against_voucher_id` IS ON THE LINE, and the design document lists it only on finance.ledger_entry.
-- The deviation is deliberate: which bill a receipt line settles is decided when the receipt is
-- drafted, by the officer allocating the payment, so it has to be recordable before posting. The
-- posting function carries it through to the entry unchanged, which is what the design asked for.
CREATE TABLE IF NOT EXISTS finance.voucher_line (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id       integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  voucher_id         uuid NOT NULL REFERENCES finance.voucher (id) ON DELETE CASCADE,
  line_no            integer NOT NULL CONSTRAINT voucher_line_no_positive CHECK (line_no > 0),
  ledger_account_id  uuid NOT NULL REFERENCES finance.ledger_account (id),
  debit              finance.money NOT NULL DEFAULT 0,
  credit             finance.money NOT NULL DEFAULT 0,
  party_id           uuid REFERENCES finance.party (id),
  -- The analysis dimensions, the same ones the budget and the register already carry, so a ledger
  -- figure can be reported against a vote without a second mapping table.
  department_id      uuid REFERENCES finance.department (id),
  programme_id       uuid REFERENCES finance.programme (id),
  activity_id        uuid REFERENCES finance.activity (id),
  ward_code          text,
  project_id         uuid REFERENCES finance.project (id),
  budget_line_id     uuid REFERENCES finance.budget_line (id),
  -- Which voucher this line settles. A receipt line points at the bill it pays, which is what
  -- makes finance.v_debtor_ageing possible (and what decision D13 said could not exist).
  against_voucher_id uuid REFERENCES finance.voucher (id),
  narration          text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voucher_line_non_negative CHECK (debit >= 0 AND credit >= 0),
  CONSTRAINT voucher_line_one_side_only CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_voucher_line_no ON finance.voucher_line (voucher_id, line_no);
CREATE INDEX IF NOT EXISTS idx_voucher_line_voucher ON finance.voucher_line (voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_line_account ON finance.voucher_line (ledger_account_id);
CREATE INDEX IF NOT EXISTS idx_voucher_line_against ON finance.voucher_line (against_voucher_id);

COMMENT ON TABLE finance.voucher_line IS
  'A voucher''s double-entry lines. Exactly one of debit/credit is non-zero: the ledger does not '
  'use signed amounts, unlike finance.transaction, which does. Editable only while the voucher is '
  'a draft (trg_voucher_line_draft_only).';

-- A posted voucher's lines are frozen. Without this, a line added after posting would leave the
-- voucher and the ledger disagreeing, and the ledger — which is immutable — would be the one that
-- could not be corrected.
CREATE OR REPLACE FUNCTION finance.refuse_posted_voucher_line_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
DECLARE v_status text; v_voucher uuid := COALESCE(NEW.voucher_id, OLD.voucher_id);
BEGIN
  SELECT v.status INTO v_status FROM finance.voucher v WHERE v.id = v_voucher;
  -- The parent has already gone: this is the ON DELETE CASCADE from deleting a DRAFT voucher, which
  -- is allowed. A POSTED voucher cannot be deleted at all — finance.ledger_entry references both
  -- the voucher and the line, with no cascade — so this branch cannot reach a posted document.
  IF NOT FOUND THEN RETURN COALESCE(NEW, OLD); END IF;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'voucher % is % and its lines can no longer be changed', v_voucher, v_status
      USING ERRCODE = '23514',
            HINT = 'Correct a posted voucher with a reversal voucher, not by editing its lines.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- The account a line cites must be one that can be posted to. A heading in the chart carries no
-- balance of its own and an inactive account is one the council has withdrawn.
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'finance.voucher_line'::regclass
                    AND tgname = 'trg_voucher_line_draft_only') THEN
    CREATE TRIGGER trg_voucher_line_draft_only
      BEFORE INSERT OR UPDATE OR DELETE ON finance.voucher_line
      FOR EACH ROW EXECUTE FUNCTION finance.refuse_posted_voucher_line_change();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'finance.voucher_line'::regclass
                    AND tgname = 'trg_voucher_line_account_postable') THEN
    CREATE TRIGGER trg_voucher_line_account_postable
      BEFORE INSERT OR UPDATE OF ledger_account_id ON finance.voucher_line
      FOR EACH ROW EXECUTE FUNCTION finance.assert_voucher_line_account_postable();
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5. THE IMMUTABLE LEDGER
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- INSERT ONLY. There is no `deleted_at` column, and its absence is the point: the soft-delete
-- convention this schema uses everywhere else would let a posted ledger line be hidden, and a book
-- of account in which a line can be hidden is not one.
--
-- The entry denormalises its voucher's header (type, number, currency, posting date, period) on
-- purpose. A trial balance must not depend on a join to a table whose rows can still change
-- status, and the Auditor-General reads the ledger, not the ledger joined to whatever the voucher
-- table says today.
CREATE TABLE IF NOT EXISTS finance.ledger_entry (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id       integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  voucher_id         uuid NOT NULL REFERENCES finance.voucher (id),
  voucher_line_id    uuid NOT NULL REFERENCES finance.voucher_line (id),
  voucher_no         text NOT NULL,
  voucher_type       text NOT NULL,
  ledger_account_id  uuid NOT NULL REFERENCES finance.ledger_account (id),
  debit              finance.money NOT NULL DEFAULT 0,
  credit             finance.money NOT NULL DEFAULT 0,
  currency           finance.currency_code NOT NULL,
  posting_date       date NOT NULL,
  financial_year_id  uuid NOT NULL REFERENCES finance.financial_year (id),
  ledger_period_id   uuid NOT NULL REFERENCES finance.ledger_period (id),
  party_id           uuid REFERENCES finance.party (id),
  department_id      uuid REFERENCES finance.department (id),
  programme_id       uuid REFERENCES finance.programme (id),
  activity_id        uuid REFERENCES finance.activity (id),
  ward_code          text,
  project_id         uuid REFERENCES finance.project (id),
  budget_line_id     uuid REFERENCES finance.budget_line (id),
  against_voucher_id uuid REFERENCES finance.voucher (id),
  -- True on the entries of a reversal voucher. Presentation only: both halves are returned by
  -- every query either way, and nothing filters on this to make a figure look tidier.
  is_reversal        boolean NOT NULL DEFAULT false,
  narration          text,
  posted_at          timestamptz NOT NULL DEFAULT now(),
  posted_by          uuid NOT NULL REFERENCES public.users (id),
  CONSTRAINT ledger_entry_non_negative CHECK (debit >= 0 AND credit >= 0),
  CONSTRAINT ledger_entry_one_side_only CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  CONSTRAINT ledger_entry_line_posted_once UNIQUE (voucher_line_id)
);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_account_date
  ON finance.ledger_entry (ledger_account_id, posting_date);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_currency_date
  ON finance.ledger_entry (currency, posting_date);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_party_date
  ON finance.ledger_entry (party_id, posting_date);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_voucher ON finance.ledger_entry (voucher_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_against ON finance.ledger_entry (against_voucher_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_year
  ON finance.ledger_entry (financial_year_id, currency);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_period ON finance.ledger_entry (ledger_period_id);

COMMENT ON TABLE finance.ledger_entry IS
  'The posted general ledger. INSERT ONLY: UPDATE, DELETE and TRUNCATE are refused by trigger and '
  'revoked from the application role, and there is deliberately no deleted_at column. A correction '
  'is a reversal voucher and both halves stay visible (acceptance checks G3 and G6).';

-- ── INVARIANT 1 and 2: balance, and one currency ──────────────────────────────────────────────
-- Deferred to COMMIT. A voucher's entries are inserted row by row and every intermediate state of
-- a legitimate two-line posting is unbalanced, so checking per statement would refuse every
-- posting. What the invariant is about is the result at COMMIT. This is the reasoning, and the
-- mechanism, of `trg_user_permission_override_sod` (200:299).
--
-- SECURITY DEFINER so the check sees every row of the voucher regardless of the caller's
-- row-level security: an integrity assertion that could be narrowed by RLS would not be one.
CREATE OR REPLACE FUNCTION finance.voucher_imbalance(p_voucher_id uuid)
RETURNS TABLE (entry_count bigint, currencies bigint, lowest_currency text, highest_currency text,
               debit_total numeric, credit_total numeric, difference numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
  SELECT count(*),
         count(DISTINCT e.currency::text),
         min(e.currency::text),
         max(e.currency::text),
         COALESCE(sum(e.debit), 0),
         COALESCE(sum(e.credit), 0),
         COALESCE(sum(e.debit), 0) - COALESCE(sum(e.credit), 0)
    FROM finance.ledger_entry e
   WHERE e.voucher_id = p_voucher_id;
$$;

COMMENT ON FUNCTION finance.voucher_imbalance(uuid) IS
  'The balance and currency facts about one voucher''s posted entries, summed in NUMERIC. Read by '
  'the constraint trigger and by src/routes/finance-ledger.js, so the route and the database cannot '
  'disagree about whether a voucher balances.';

CREATE OR REPLACE FUNCTION finance.assert_voucher_balanced() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
DECLARE
  v_voucher uuid := NEW.voucher_id;
  f record;
  v_header finance.currency_code;
BEGIN
  SELECT * INTO f FROM finance.voucher_imbalance(v_voucher);

  -- Nothing left to judge: the entries were never inserted, or the voucher's rows have gone (which
  -- cannot happen, the ledger being insert-only).
  IF f.entry_count = 0 THEN RETURN NULL; END IF;

  -- INVARIANT 2. One currency per voucher. Structurally the header holds a single currency, so
  -- this can only fire if an entry was written with a currency of its own.
  IF f.currencies > 1 THEN
    RAISE EXCEPTION 'voucher % posts in more than one currency (% and %)',
      v_voucher, f.lowest_currency, f.highest_currency
      USING ERRCODE = '23514',
            HINT = 'A voucher carries exactly one currency. The Council has approved no conversion basis (D4), so one journal cannot span the two books. Raise a separate voucher per currency.';
  END IF;

  SELECT v.currency INTO v_header FROM finance.voucher v WHERE v.id = v_voucher;
  IF v_header IS NOT NULL AND f.lowest_currency <> v_header::text THEN
    RAISE EXCEPTION 'voucher % is denominated in % and its entries are in %',
      v_voucher, v_header, f.lowest_currency
      USING ERRCODE = '23514';
  END IF;

  -- INVARIANT 1. Debits equal credits. Acceptance check G1.
  IF f.difference <> 0 THEN
    RAISE EXCEPTION 'voucher % does not balance: debits %, credits %, difference %',
      v_voucher, f.debit_total, f.credit_total, f.difference
      USING ERRCODE = '23514',
            HINT = 'A general ledger voucher must have equal debits and credits. Nothing is posted until it does.';
  END IF;

  RETURN NULL;
END $$;

COMMENT ON FUNCTION finance.assert_voucher_balanced() IS
  'Refuses, at COMMIT, any transaction that leaves a voucher''s ledger entries unbalanced or '
  'spanning two currencies. Deferred because a posting is inserted row by row and every '
  'intermediate state is legitimately unbalanced (acceptance checks G1 and G2).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'finance.ledger_entry'::regclass
                    AND tgname = 'trg_ledger_entry_balanced') THEN
    CREATE CONSTRAINT TRIGGER trg_ledger_entry_balanced
      AFTER INSERT ON finance.ledger_entry
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION finance.assert_voucher_balanced();
  END IF;
END $$;

-- ── The entry-level checks that can fail immediately ──────────────────────────────────────────
-- These do not need deferring: each is a fact about the single row being written. Failing fast
-- gives a legible error at the statement rather than at COMMIT.
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

COMMENT ON FUNCTION finance.validate_ledger_entry() IS
  'The row-level ledger checks: the entry agrees with its voucher''s currency and year, its period '
  'is open and contains its posting date, its account is postable, and anything it settles is in '
  'the same currency and already posted. Immediate rather than deferred, because each is a fact '
  'about one row (acceptance checks G2 and G5).';

-- ── INVARIANT 3: immutability ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION finance.refuse_ledger_amendment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'finance.ledger_entry is insert-only: a posted ledger line is never amended, deleted or hidden'
    USING ERRCODE = '42501',
          HINT = 'Correct a posting with a reversal voucher (finance.reverse_voucher). Both the original and the reversal stay visible.';
END $$;

COMMENT ON FUNCTION finance.refuse_ledger_amendment() IS
  'Refuses UPDATE, DELETE and TRUNCATE on finance.ledger_entry. Belt and braces with the REVOKE '
  'below: the revoke stops the application role, the trigger stops everyone else including the '
  'owner (acceptance check G3).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'finance.ledger_entry'::regclass
                    AND tgname = 'trg_ledger_entry_validate') THEN
    CREATE TRIGGER trg_ledger_entry_validate
      BEFORE INSERT ON finance.ledger_entry
      FOR EACH ROW EXECUTE FUNCTION finance.validate_ledger_entry();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'finance.ledger_entry'::regclass
                    AND tgname = 'trg_ledger_entry_immutable') THEN
    CREATE TRIGGER trg_ledger_entry_immutable
      BEFORE UPDATE OR DELETE ON finance.ledger_entry
      FOR EACH ROW EXECUTE FUNCTION finance.refuse_ledger_amendment();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'finance.ledger_entry'::regclass
                    AND tgname = 'trg_ledger_entry_no_truncate') THEN
    CREATE TRIGGER trg_ledger_entry_no_truncate
      BEFORE TRUNCATE ON finance.ledger_entry
      FOR EACH STATEMENT EXECUTE FUNCTION finance.refuse_ledger_amendment();
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 6. POSTING, REVERSAL AND YEAR-END
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- `finance.post_voucher()` is the ONLY thing that writes finance.ledger_entry. Every rule about
-- posting lives here once, so a second route, a migration or a hand-written statement cannot post
-- by a different set of rules. src/routes/finance-ledger.js calls it and translates its errors; it
-- does not restate its logic.
--
-- SECURITY INVOKER (the default), on purpose: the caller's row-level security applies, so posting
-- cannot reach another authority's voucher. The integrity triggers above are SECURITY DEFINER
-- because an assertion must see the whole voucher; writing is a different question from asserting.
CREATE OR REPLACE FUNCTION finance.post_voucher(p_voucher_id uuid, p_posted_by uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v record;
  v_period uuid;
  v_lines integer;
  v_written integer;
  f record;
BEGIN
  SELECT * INTO v FROM finance.voucher WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'voucher % does not exist', p_voucher_id USING ERRCODE = '23503';
  END IF;
  IF v.status <> 'draft' THEN
    RAISE EXCEPTION 'voucher % is already % and cannot be posted again', v.voucher_no, v.status
      USING ERRCODE = '23514';
  END IF;
  IF p_posted_by IS NULL THEN
    RAISE EXCEPTION 'posting a voucher requires the person posting it' USING ERRCODE = '23502';
  END IF;
  -- G7, refused here with a legible message as well as by the CHECK constraint.
  IF p_posted_by = v.prepared_by THEN
    RAISE EXCEPTION 'voucher % was prepared by this person and must be posted by somebody else', v.voucher_no
      USING ERRCODE = '23514',
            HINT = 'Separation of duties: whoever prepares a voucher does not post it.';
  END IF;

  SELECT count(*) INTO v_lines FROM finance.voucher_line WHERE voucher_id = p_voucher_id;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'voucher % has no lines', v.voucher_no USING ERRCODE = '23514';
  END IF;
  IF v_lines < 2 THEN
    RAISE EXCEPTION 'voucher % has one line; a double entry needs at least two', v.voucher_no
      USING ERRCODE = '23514';
  END IF;

  -- The period the posting date falls in, chosen rather than supplied, so a voucher cannot be
  -- filed under a period its own date is not in.
  SELECT lp.id INTO v_period
    FROM finance.ledger_period lp
   WHERE lp.financial_year_id = v.financial_year_id
     AND v.posting_date BETWEEN lp.from_date AND lp.to_date
   ORDER BY lp.period_no
   LIMIT 1;
  IF v_period IS NULL THEN
    RAISE EXCEPTION 'no accounting period of this financial year contains %', v.posting_date
      USING ERRCODE = '23514',
            HINT = 'Open the periods for the year first; they must tile it exactly.';
  END IF;

  INSERT INTO finance.ledger_entry (
    authority_id, voucher_id, voucher_line_id, voucher_no, voucher_type, ledger_account_id,
    debit, credit, currency, posting_date, financial_year_id, ledger_period_id,
    party_id, department_id, programme_id, activity_id, ward_code, project_id, budget_line_id,
    against_voucher_id, is_reversal, narration, posted_by)
  SELECT v.authority_id, v.id, l.id, v.voucher_no, v.voucher_type, l.ledger_account_id,
         l.debit, l.credit, v.currency, v.posting_date, v.financial_year_id, v_period,
         l.party_id, l.department_id, l.programme_id, l.activity_id, l.ward_code, l.project_id,
         l.budget_line_id, l.against_voucher_id, (v.voucher_type = 'reversal'),
         COALESCE(l.narration, v.narration), p_posted_by
    FROM finance.voucher_line l
   WHERE l.voucher_id = v.id
   ORDER BY l.line_no;
  GET DIAGNOSTICS v_written = ROW_COUNT;

  -- Said here as well, with the voucher number in it, because the deferred trigger fires at COMMIT
  -- and names only the id. The trigger is still what HOLDS; this is what the officer reads.
  SELECT * INTO f FROM finance.voucher_imbalance(v.id);
  IF f.difference <> 0 THEN
    RAISE EXCEPTION 'voucher % does not balance: debits %, credits %, difference %',
      v.voucher_no, f.debit_total, f.credit_total, f.difference
      USING ERRCODE = '23514';
  END IF;

  UPDATE finance.voucher
     SET status = 'posted', posted_by = p_posted_by, posted_at = now(), ledger_period_id = v_period
   WHERE id = p_voucher_id;

  RETURN v_written;
END $$;

COMMENT ON FUNCTION finance.post_voucher(uuid, uuid) IS
  'The only writer of finance.ledger_entry. Checks draft status, separation of duties, at least two '
  'lines, an open period containing the posting date, and balance; then emits the entries and marks '
  'the voucher posted.';

-- A correction is a reversal voucher. The original is NOT cancelled, flagged or hidden: it stays
-- `posted` and the reversal points at it, which is the same shape finance.transaction.reverses_id
-- already has, so the register and the ledger behave alike (acceptance check G6).
CREATE OR REPLACE FUNCTION finance.reverse_voucher(
  p_voucher_id uuid, p_prepared_by uuid, p_posted_by uuid,
  p_reason text, p_posting_date date DEFAULT NULL, p_voucher_no text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v record;
  v_new uuid;
  v_no text;
  v_date date;
BEGIN
  SELECT * INTO v FROM finance.voucher WHERE id = p_voucher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'voucher % does not exist', p_voucher_id USING ERRCODE = '23503';
  END IF;
  IF v.status <> 'posted' THEN
    RAISE EXCEPTION 'voucher % is % and only a posted voucher can be reversed', v.voucher_no, v.status
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM finance.voucher r
              WHERE r.reverses_voucher_id = p_voucher_id AND r.status = 'posted') THEN
    RAISE EXCEPTION 'voucher % has already been reversed', v.voucher_no
      USING ERRCODE = '23514',
            HINT = 'Reversing a reversal would restore the original. Raise a fresh voucher instead.';
  END IF;
  IF COALESCE(p_reason, '') = '' THEN
    RAISE EXCEPTION 'a reversal needs a reason, which goes on the record' USING ERRCODE = '23502';
  END IF;

  v_date := COALESCE(p_posting_date, v.posting_date);
  v_no := COALESCE(p_voucher_no, v.voucher_no || '-R');

  INSERT INTO finance.voucher (
    authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
    narration, reference, status, reverses_voucher_id, prepared_by)
  VALUES (v.authority_id, v_no, 'reversal', v.currency, v.financial_year_id, v_date,
          p_reason, v.reference, 'draft', v.id, p_prepared_by)
  RETURNING id INTO v_new;

  -- Debit and credit swapped. Every other column is carried over unchanged, including the
  -- settlement link, so a reversed receipt stops settling the bill it was allocated to.
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

  PERFORM finance.post_voucher(v_new, p_posted_by);
  RETURN v_new;
END $$;

COMMENT ON FUNCTION finance.reverse_voucher(uuid, uuid, uuid, text, date, text) IS
  'Raises and posts a reversal voucher with debit and credit swapped. The original stays posted and '
  'visible; the net effect on every account is nil (acceptance check G6).';

-- Year-end. The surplus or deficit is transferred to accumulated surplus so the statement of
-- financial performance opens the next year at nil (acceptance check G10). ONE CLOSING VOUCHER PER
-- CURRENCY, because the two books close independently and a single closing entry across them would
-- need a rate.
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

COMMENT ON FUNCTION finance.close_ledger_year(uuid, text, uuid, uuid, text, date) IS
  'Year-end closing for ONE currency''s book: brings every revenue and expense account to nil and '
  'transfers the net to the accumulated-surplus account, so the performance statement opens the '
  'next year at nil (acceptance check G10). The two books close separately; no rate is applied.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 7. THE STATEMENTS, AS VIEWS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Every statement reads these. There is no hand-rolled statement SQL per report, for the same
-- reason finance.v_budget_line_performance exists (188:795): two reports that compute "the balance"
-- separately will eventually disagree, and a council cannot tell which one is wrong.
--
-- `security_invoker = true` on all three, so the tenant policies on finance.ledger_entry decide
-- which rows each person sees. GROUP BY includes `currency` everywhere, so no view here can produce
-- a figure spanning USD and ZWG (acceptance check G11).

DROP VIEW IF EXISTS finance.v_trial_balance CASCADE;
CREATE VIEW finance.v_trial_balance WITH (security_invoker = true) AS
SELECT e.authority_id,
       e.financial_year_id,
       e.currency,
       e.ledger_account_id,
       la.code                     AS account_code,
       la.name                     AS account_name,
       la.root_type,
       la.report_type,
       la.account_type,
       count(*)::int               AS entry_count,
       sum(e.debit)::finance.money  AS debit_total,
       sum(e.credit)::finance.money AS credit_total,
       -- The closing balance, presented on the side it falls: a trial balance has two columns and
       -- an account appears in exactly one of them.
       CASE WHEN sum(e.debit) - sum(e.credit) > 0
            THEN sum(e.debit) - sum(e.credit) ELSE 0 END::finance.money AS debit_balance,
       CASE WHEN sum(e.debit) - sum(e.credit) < 0
            THEN sum(e.credit) - sum(e.debit) ELSE 0 END::finance.money AS credit_balance,
       min(e.posting_date)         AS first_posting_date,
       max(e.posting_date)         AS last_posting_date
  FROM finance.ledger_entry e
  JOIN finance.ledger_account la ON la.id = e.ledger_account_id
 GROUP BY e.authority_id, e.financial_year_id, e.currency, e.ledger_account_id,
          la.code, la.name, la.root_type, la.report_type, la.account_type;

COMMENT ON VIEW finance.v_trial_balance IS
  'The trial balance, per financial year and PER CURRENCY. There are two of them and they are never '
  'added together (design decision 1, Council decision D4). Each must balance: sum(debit_balance) = '
  'sum(credit_balance) within one currency, and a trial balance that does not is a defect rather '
  'than a presentation choice (acceptance check G4).';

-- The carrying balance of an account across every year, which is what a balance-sheet figure is.
-- Distinct from v_trial_balance on purpose: that one is per year (a year's movement plus its
-- brought-forward postings), this one is the life of the account.
DROP VIEW IF EXISTS finance.v_account_balance CASCADE;
CREATE VIEW finance.v_account_balance WITH (security_invoker = true) AS
SELECT e.authority_id,
       e.currency,
       e.ledger_account_id,
       la.code                     AS account_code,
       la.name                     AS account_name,
       la.root_type,
       la.report_type,
       la.account_type,
       count(*)::int               AS entry_count,
       sum(e.debit)::finance.money  AS debit_total,
       sum(e.credit)::finance.money AS credit_total,
       -- Signed, debit-positive. A reader needs to know which side it is on, which `root_type`
       -- says: an asset with a credit balance is a fact worth seeing, not an error to hide.
       (sum(e.debit) - sum(e.credit))::finance.money AS net_debit,
       max(e.posting_date)         AS last_posting_date
  FROM finance.ledger_entry e
  JOIN finance.ledger_account la ON la.id = e.ledger_account_id
 GROUP BY e.authority_id, e.currency, e.ledger_account_id,
          la.code, la.name, la.root_type, la.report_type, la.account_type;

COMMENT ON VIEW finance.v_account_balance IS
  'The carrying balance of each ledger account, per currency, across every financial year. '
  '`net_debit` is signed debit-positive; the side it belongs on is read from root_type rather than '
  'presented as an absolute figure, so an asset carrying a credit balance stays visible.';

-- Debtor ageing. THIS IS WHAT DECISION D13 SAID COULD NOT EXIST, and what full accrual (decision 2)
-- plus the settlement link make possible.
--
-- A bill is a DEBIT to a receivable control account. What has been collected against it is the sum
-- of the CREDITS to a receivable account that name it in `against_voucher_id`. The difference is
-- outstanding, and its age is measured from the bill's own posting date.
--
-- AN UNALLOCATED RECEIPT IS NOT DROPPED. A credit to a receivable account with no
-- `against_voucher_id` is money received and not yet matched to a bill. It appears here as its own
-- row in the `unallocated` bucket with a negative outstanding figure, so a party's ageing total
-- reconciles to its control-account balance in v_account_balance. Leaving it out would have made
-- the two disagree silently, which is the failure mode of most ageing reports.
DROP VIEW IF EXISTS finance.v_debtor_ageing CASCADE;
CREATE VIEW finance.v_debtor_ageing WITH (security_invoker = true) AS
WITH receivable AS (
  SELECT e.* FROM finance.ledger_entry e
   WHERE EXISTS (SELECT 1 FROM finance.ledger_account la
                  WHERE la.id = e.ledger_account_id AND la.account_type = 'receivable')
), billed AS (
  SELECT r.authority_id, r.currency, r.party_id, r.ledger_account_id,
         r.voucher_id, r.voucher_no, r.voucher_type, r.posting_date,
         sum(r.debit)::finance.money AS billed_amount
    FROM receivable r
   WHERE r.debit > 0
   GROUP BY r.authority_id, r.currency, r.party_id, r.ledger_account_id,
            r.voucher_id, r.voucher_no, r.voucher_type, r.posting_date
), settled AS (
  SELECT r.against_voucher_id AS voucher_id, r.currency,
         sum(r.credit)::finance.money AS settled_amount,
         max(r.posting_date) AS last_settled_on
    FROM receivable r
   WHERE r.credit > 0 AND r.against_voucher_id IS NOT NULL
   GROUP BY r.against_voucher_id, r.currency
), unallocated AS (
  SELECT r.authority_id, r.currency, r.party_id, r.ledger_account_id,
         r.voucher_id, r.voucher_no, r.voucher_type, r.posting_date,
         sum(r.credit)::finance.money AS credit_amount
    FROM receivable r
   WHERE r.credit > 0 AND r.against_voucher_id IS NULL
   GROUP BY r.authority_id, r.currency, r.party_id, r.ledger_account_id,
            r.voucher_id, r.voucher_no, r.voucher_type, r.posting_date
)
SELECT b.authority_id, b.currency, b.party_id,
       p.name      AS party_name,
       p.reference AS party_reference,
       b.ledger_account_id, b.voucher_id, b.voucher_no, b.voucher_type,
       b.posting_date,
       b.billed_amount,
       COALESCE(s.settled_amount, 0)::finance.money AS settled_amount,
       (b.billed_amount - COALESCE(s.settled_amount, 0))::finance.money AS outstanding_amount,
       s.last_settled_on,
       (CURRENT_DATE - b.posting_date)::int AS days_outstanding,
       CASE
         WHEN b.billed_amount - COALESCE(s.settled_amount, 0) = 0 THEN 'settled'
         WHEN CURRENT_DATE - b.posting_date <= 30  THEN 'current'
         WHEN CURRENT_DATE - b.posting_date <= 60  THEN '31_60'
         WHEN CURRENT_DATE - b.posting_date <= 90  THEN '61_90'
         WHEN CURRENT_DATE - b.posting_date <= 180 THEN '91_180'
         WHEN CURRENT_DATE - b.posting_date <= 365 THEN '181_365'
         ELSE 'over_365'
       END AS ageing_bucket
  FROM billed b
  LEFT JOIN settled s ON s.voucher_id = b.voucher_id AND s.currency = b.currency
  LEFT JOIN finance.party p ON p.id = b.party_id
UNION ALL
SELECT u.authority_id, u.currency, u.party_id,
       p.name, p.reference,
       u.ledger_account_id, u.voucher_id, u.voucher_no, u.voucher_type,
       u.posting_date,
       0::finance.money                 AS billed_amount,
       u.credit_amount                  AS settled_amount,
       (-u.credit_amount)::finance.money AS outstanding_amount,
       NULL::date                       AS last_settled_on,
       (CURRENT_DATE - u.posting_date)::int AS days_outstanding,
       'unallocated'::text              AS ageing_bucket
  FROM unallocated u
  LEFT JOIN finance.party p ON p.id = u.party_id;

COMMENT ON VIEW finance.v_debtor_ageing IS
  'Debtor ageing from the ledger: a receivable debit is a bill, the receivable credits naming it in '
  'against_voucher_id are what was collected, and the age runs from the bill''s posting date. '
  'Buckets: current, 31_60, 61_90, 91_180, 181_365, over_365, settled, and `unallocated` for a '
  'receipt not yet matched to a bill, which carries a NEGATIVE outstanding figure so a party''s '
  'ageing total reconciles to its control-account balance. Ages against CURRENT_DATE. Never '
  'combines currencies.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 8. THE PERMISSION CATALOGUE ADDITIONS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Same catalogue, same flags, same resolution (188:1054, and finance.resolve_effective_permissions
-- at 200:194 reads is_approval/is_publication without needing to know these codes exist).
--
-- `finance.ledger.voucher.post` IS AN APPROVAL. Posting is the act that turns a draft document into
-- part of the book of account; nothing after it can be amended. Flagging it so means the
-- separation-of-duties assertion covers it automatically: no role may hold it together with a
-- publication permission, and the technical administrator may not hold it at all.
INSERT INTO finance.permission (code, label, category, is_approval, is_publication, is_restricted, description) VALUES
  ('finance.ledger.view',            'View the general ledger',        'ledger', false, false, false, 'The GL chart of accounts, vouchers, the trial balance and the statements.'),
  ('finance.ledger.account.manage',  'Maintain the GL chart',          'ledger', false, false, false, 'Create and amend ledger accounts. The chart is Council-approved data; this maintains it, it does not decide it.'),
  ('finance.ledger.party.manage',    'Maintain the party register',    'ledger', false, false, false, 'Ratepayers, debtors and suppliers.'),
  ('finance.ledger.period.manage',   'Open, close and lock periods',   'ledger', false, false, false, 'A closed period accepts no postings. Locking is final and is what a council sets after the audit.'),
  ('finance.ledger.voucher.prepare', 'Prepare ledger vouchers',        'ledger', false, false, false, 'Create and edit draft vouchers. A draft posts nothing.'),
  ('finance.ledger.voucher.post',    'Post ledger vouchers',           'ledger', true,  false, false, 'Commit a voucher to the book of account. Never the person who prepared it (acceptance check G7).'),
  ('finance.ledger.voucher.reverse', 'Reverse a posted voucher',       'ledger', true,  false, false, 'Raise and post a reversal. The original stays visible; nothing is amended or hidden.'),
  ('finance.ledger.close_year',      'Run the year-end closing',       'ledger', true,  false, false, 'Transfer the surplus or deficit of one currency''s book to accumulated surplus.')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category,
      is_approval = EXCLUDED.is_approval, is_publication = EXCLUDED.is_publication,
      is_restricted = EXCLUDED.is_restricted, description = EXCLUDED.description;

-- ── Default grants ────────────────────────────────────────────────────────────────────────────
-- A DEPARTURE FROM MIGRATION 188'S DOCTRINE, STATED RATHER THAN SLIPPED IN.
-- 188's header says "finance_admin prepares everything, approves nothing". That holds for budgets,
-- where the Council's committee approves. It cannot hold for a general ledger: journals are posted
-- daily and the finance committee does not sit daily, so a ledger whose only poster is the
-- committee would either not be posted or would be posted by somebody borrowing a login — which is
-- worse than the control it was meant to provide. So the Director of Finance (finance_admin) holds
-- `finance.ledger.voucher.post`, and the control that actually binds is per-voucher and in the
-- database: `voucher_prepared_and_posted_differ`. An officer prepares, the Director posts, and
-- neither can do both to the same voucher.
--
-- The committee keeps the year-end closing, which is an annual act and is exactly the kind of thing
-- a committee should hold.
INSERT INTO finance.role_permission (role_name, permission_code) VALUES
  -- The Director of Finance: maintains the chart and the periods, prepares, posts and reverses.
  ('finance_admin', 'finance.ledger.view'),
  ('finance_admin', 'finance.ledger.account.manage'),
  ('finance_admin', 'finance.ledger.party.manage'),
  ('finance_admin', 'finance.ledger.period.manage'),
  ('finance_admin', 'finance.ledger.voucher.prepare'),
  ('finance_admin', 'finance.ledger.voucher.post'),
  ('finance_admin', 'finance.ledger.voucher.reverse'),
  -- The finance officer prepares and never posts, which is the handover that makes G7 meaningful.
  ('finance_officer', 'finance.ledger.view'),
  ('finance_officer', 'finance.ledger.party.manage'),
  ('finance_officer', 'finance.ledger.voucher.prepare'),
  -- The committee reads the statements and runs the year-end closing.
  ('finance_committee', 'finance.ledger.view'),
  ('finance_committee', 'finance.ledger.close_year'),
  -- The auditor reads the book of account and writes nothing in it.
  ('auditor', 'finance.ledger.view'),
  -- The technical administrator reads it, as it already reads budgets and the audit trail, and
  -- holds nothing here that posts.
  ('admin', 'finance.ledger.view')
ON CONFLICT (role_name, permission_code) DO NOTHING;

-- Migration 188 section 11's assertions, re-run over the grants as they now stand. If the block
-- above ever gives one role both an approval and the publication permission, or gives the technical
-- administrator financial authority, this migration fails rather than quietly weakening the control.
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
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 9. TENANCY, GRANTS, AND THE REVOKE THAT MAKES THE LEDGER INSERT-ONLY
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- tenancy.make_tenant() (migration 167) adds the authority column, the row-level security policies
-- and the application role's privileges, exactly as it did for the 188 tables. It grants INSERT,
-- UPDATE and DELETE, so the revoke on finance.ledger_entry comes AFTER it and is the last word.
DO $$
DECLARE r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    RAISE NOTICE 'no VUNGU authority here: the ledger tables stay pending until converted by hand';
    FOREACH r IN ARRAY ARRAY['finance.ledger_account', 'finance.party', 'finance.ledger_period',
                             'finance.voucher', 'finance.voucher_line', 'finance.ledger_entry'] LOOP
      PERFORM tenancy.classify(r, 'pending', 'general ledger data awaiting the authority it belongs to');
    END LOOP;
    RETURN;
  END IF;

  FOREACH r IN ARRAY ARRAY['finance.ledger_account', 'finance.party', 'finance.ledger_period',
                           'finance.voucher', 'finance.voucher_line', 'finance.ledger_entry'] LOOP
    PERFORM tenancy.make_tenant(r::regclass, 'VUNGU');
  END LOOP;

  FOREACH r IN ARRAY ARRAY['finance.v_trial_balance', 'finance.v_account_balance',
                           'finance.v_debtor_ageing'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
      EXECUTE format('GRANT SELECT ON %s TO vungu_app', r);
    END IF;
    PERFORM tenancy.classify(r, 'tenant_view',
      'runs as the caller (security_invoker); the underlying policies decide the rows');
  END LOOP;
END $$;

-- INVARIANT 3, the privilege half. The trigger refuses an amendment from anybody; this makes the
-- application role unable to attempt one at all, which is what acceptance check G3 asks for.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON finance.ledger_entry FROM vungu_app;
    -- The posting function is the only intended writer, and it runs as the caller, so the role
    -- keeps INSERT and SELECT and nothing else.
    GRANT SELECT, INSERT ON finance.ledger_entry TO vungu_app;
  END IF;
END $$;

-- Row-level security's tenant_write policy is FOR ALL, which would permit an UPDATE at the policy
-- layer. It never gets that far: the privilege is revoked above and the trigger refuses. A reader
-- of the policies alone should not be left thinking otherwise, so it is said here.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 10. WHAT IS DELIBERATELY NOT SEEDED
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- No ledger account, no party, no period and no voucher. The chart of accounts is a Council
-- resolution (the same reason finance.account is empty, decision D2), the ratepayer of record is
-- decision D19, and a plausible-looking placeholder in a book of account is worse than an empty
-- table: an officer cannot tell it from real data.
--
-- `finance.cutover_reconciliation` (spec §6) is NOT here. It belongs with the cut-over workstream
-- and an empty table nobody writes to would look like audit evidence and be none.
--
-- The valuation roll and the tariff schedule (spec §5, decisions D17 and D18) are NOT here. They
-- belong to the rates workstream, and the finding that matters is already recorded: 731 parcels,
-- 0 owner rows, and no valuation or tariff table anywhere in this database.
