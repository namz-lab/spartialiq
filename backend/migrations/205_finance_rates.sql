-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 205 — RATES BILLING, DEBTORS AND ARREARS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Design: docs/superpowers/specs/2026-11-10-general-ledger-architecture.md §5 (frontend repo), and
-- decisions D17, D18 and D19 in docs/finance/COUNCIL-DECISIONS.md.
--
-- WHAT THIS MIGRATION IS FOR
-- The client selected rates billing, debtors and arrears as the functional scope (spec §1 row 4).
-- A rates bill recognises revenue when it is BILLED, not when it is received (full accrual, spec
-- decision 2), so it raises a receivable, and a receipt settles that receivable through
-- `against_voucher_id`, which is what makes `finance.v_debtor_ageing` (203:1066) possible at all.
--
-- THE MACHINERY CAN BE BUILT. THE DATA CANNOT, AND THAT IS THE FINDING.
-- Verified in this database on 2026-11-10:
--   * `land.parcel` holds 731 rows. Rates bill against that register; this migration adds no
--     second property register and every table here points at `land.parcel.parcel_id`.
--   * `spatial_planning.parcel_owner` holds 0 rows. There is no ratepayer of record for any
--     parcel (decision D19).
--   * No valuation table existed anywhere before this migration (decision D17).
--   * No tariff table existed anywhere before this migration (decision D18).
--   * `revenue_link.account_link` (parcel_id -> erp_account_no) holds 0 rows and is the existing
--     seam to Promun/Pastel, which is where rates are billed today.
--
-- So the valuation roll, the tariff schedule and the rates accounts are created as TABLES PLUS AN
-- IMPORT PATH, SEEDED EMPTY — exactly as `finance.account` was left empty pending decision D2
-- (188:28). Nothing here guesses a rateable value, a rate in the dollar or an owner. Section 7
-- states what is not seeded and why.
--
-- THE ACCEPTANCE CHECK THIS MIGRATION EXISTS TO SATISFY IS G9: a billing run REFUSES a property
-- with no rateable value, and says so, rather than billing nil. The refusal is a first-class
-- record (`finance.rates_billing_refusal`) naming which of D17/D18/D19 it is waiting on, so a
-- blocked billing run is a work list for the Council rather than a dead end. The same discipline
-- sends an import citing an unknown account code to the exception queue instead of inferring its
-- classification.
--
-- ── THE LEDGER IS NOT WRITTEN HERE ───────────────────────────────────────────────────────────
-- `finance.post_voucher()` (203:720) is the only writer of `finance.ledger_entry`, and it stays
-- the only writer. `finance.raise_rates_billing()` in section 5 below creates DRAFT vouchers and
-- posts nothing: posting is a separate act by a different person, because
-- `voucher_prepared_and_posted_differ` (203:313) and acceptance check G7 require it. A run of 700
-- bills prepared by an officer is posted by the Director, and neither can do both to one bill.
--
-- ── MONEY IS COMPUTED BY POSTGRES, NOT BY A ROUTE ────────────────────────────────────────────
-- `finance.rates_bill.amount` is a GENERATED STORED column over
-- `finance.rates_bill_amount()`, and the eligibility function in section 4 calls the same
-- function. The bill amount therefore has exactly one definition, it is NUMERIC throughout, and
-- there is no arrangement of this schema in which a route could compute it differently. See the
-- header of src/lib/finance.js for why that matters.
--
-- ── CURRENCY ─────────────────────────────────────────────────────────────────────────────────
-- A rateable value is denominated and a tariff is denominated, and a billing run takes one
-- currency. Where the two disagree the run REFUSES rather than converting: the Council has
-- approved no conversion basis (decision D4) and there are two separate books (spec decision 1).
--
-- Conventions follow migration 188: `tenancy.make_tenant()` (167) for the authority column, the
-- row-level security policies and the application role's privileges; `security_invoker` views;
-- the `finance.money` and `finance.currency_code` domains; named CHECK constraints; soft delete on
-- every register; and idempotent throughout.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET search_path = finance, public;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. THE PROPERTY CATEGORY — THE KEY THE ROLL AND THE TARIFF SHARE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A tariff is a rate in the dollar PER PROPERTY CATEGORY (decision D18) and a valuation records
-- the category the property was valued as. If both carried the category as free text, one would
-- eventually read 'Residential' and the other 'residential', and a billing run would refuse every
-- property for a reason that was a typing difference. So the category is a row, both tables point
-- at it, and the list of categories is Council data.
--
-- SEEDED EMPTY. The categories a council rates by are part of decisions D17 and D18; a plausible
-- list (residential / commercial / industrial / agricultural) is exactly the kind of guess this
-- schema refuses to make, because an officer could not tell it from the Council's own list.
CREATE TABLE IF NOT EXISTS finance.property_category (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  code         text NOT NULL,
  name         text NOT NULL,
  description  text,
  status       text NOT NULL DEFAULT 'active' CONSTRAINT property_category_status_known
               CHECK (status IN ('active', 'inactive')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES public.users (id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  deleted_by   uuid REFERENCES public.users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_category_code
  ON finance.property_category (authority_id, code) WHERE deleted_at IS NULL;

COMMENT ON TABLE finance.property_category IS
  'The property categories a council rates by. The shared key between finance.valuation_roll and '
  'finance.rates_tariff, so the two cannot disagree about a category by spelling. Seeded empty: '
  'the list is Council data (decisions D17 and D18).';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. THE VALUATION ROLL (DECISION D17)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- One row per property per valuation period: what the property is worth for rating purposes, from
-- when, as valued by whom and under what authority. D17 asks for three things and all three are
-- columns here: the source, the effective date and the rateable value.
--
-- `effective_to` IS NULLABLE AND NULL MEANS STILL IN FORCE, not "unknown". A superseding valuation
-- closes the previous row by setting it, which is why the overlap trigger below exists: two values
-- in force for one property on one day would make a billing run choose, and a billing run must
-- never choose between two Council figures. It refuses instead.
--
-- THE VALUE IS DENOMINATED. A rateable value in USD and a rate in the dollar set in ZWG do not
-- combine (decision D4), and `finance.rates_billable()` refuses that pair rather than converting.
CREATE TABLE IF NOT EXISTS finance.valuation_roll (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id         integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  -- The property register is land.parcel (731 rows). This migration adds no second one.
  parcel_id            character varying(24) NOT NULL REFERENCES land.parcel (parcel_id),
  property_category_id uuid NOT NULL REFERENCES finance.property_category (id),
  rateable_value       finance.money NOT NULL,
  currency             finance.currency_code NOT NULL,
  effective_from       date NOT NULL,
  effective_to         date,
  -- D17's "source": the roll this value came from, and its own reference within it. Free text
  -- because it names a document the Council holds, not a value this system can enumerate.
  source               text NOT NULL,
  source_reference     text,
  valuation_date       date,
  valuer_name          text,
  -- A draft valuation is data entry in progress and is invisible to a billing run.
  status               text NOT NULL DEFAULT 'draft' CONSTRAINT valuation_roll_status_known
                       CHECK (status IN ('draft', 'active', 'superseded')),
  notes                text,
  recorded_by          uuid REFERENCES public.users (id),
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES public.users (id),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  deleted_by           uuid REFERENCES public.users (id),
  CONSTRAINT valuation_roll_value_not_negative CHECK (rateable_value >= 0),
  CONSTRAINT valuation_roll_dates_ordered CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_valuation_roll_parcel
  ON finance.valuation_roll (parcel_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_valuation_roll_active
  ON finance.valuation_roll (authority_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_valuation_roll_category
  ON finance.valuation_roll (property_category_id);

COMMENT ON TABLE finance.valuation_roll IS
  'The rateable value of each property, per valuation period (decision D17). Seeded empty: 731 '
  'parcels exist in land.parcel and none has a value. A billing run refuses a property with no '
  'active valuation rather than billing nil (acceptance check G9). effective_to NULL means still '
  'in force.';

-- Two values in force for one property on one day is a question with no answer, so it is refused
-- at write time rather than resolved at billing time. Expressed as a trigger rather than an
-- EXCLUDE constraint so the migration needs no btree_gist extension, which is the same choice
-- finance.assert_ledger_periods_do_not_overlap() made (203:231).
CREATE OR REPLACE FUNCTION finance.assert_valuation_periods_do_not_overlap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
DECLARE clash record;
BEGIN
  IF NEW.status <> 'active' OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT v.id, v.effective_from, v.effective_to INTO clash
    FROM finance.valuation_roll v
   WHERE v.parcel_id = NEW.parcel_id
     AND v.id <> NEW.id
     AND v.status = 'active'
     AND v.deleted_at IS NULL
     AND daterange(v.effective_from, v.effective_to, '[]')
         && daterange(NEW.effective_from, NEW.effective_to, '[]')
   LIMIT 1;
  IF clash.id IS NOT NULL THEN
    RAISE EXCEPTION 'parcel % already has an active rateable value in force from % to %',
      NEW.parcel_id, clash.effective_from, COALESCE(clash.effective_to::text, 'further notice')
      USING ERRCODE = '23514',
            HINT = 'Close the earlier valuation by setting its effective_to, or supersede it.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_valuation_roll_no_overlap ON finance.valuation_roll;
CREATE TRIGGER trg_valuation_roll_no_overlap
  BEFORE INSERT OR UPDATE OF parcel_id, effective_from, effective_to, status
  ON finance.valuation_roll
  FOR EACH ROW EXECUTE FUNCTION finance.assert_valuation_periods_do_not_overlap();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3. THE TARIFF SCHEDULE (DECISION D18)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The rate in the dollar, per property category, per financial year, and who approved it. D18 asks
-- for exactly those four things.
--
-- `rate_in_dollar` IS NOT `finance.money`, DELIBERATELY. finance.money is numeric(18,2) and a rate
-- in the dollar is a small fraction — a cent and a half in the dollar is 0.015. Rounded to two
-- places that becomes 0.02, which is a third more rates than the Council resolved. So the rate is
-- numeric(18,8) and only the PRODUCT is money, rounded once, by
-- finance.rates_bill_amount().
--
-- `minimum_charge` AND `fixed_charge` ARE NULLABLE AND NULL IS NOT ZERO. A council that has set no
-- minimum charge is a different fact from one that has set a minimum of nil, and a billing run
-- must not read the first as the second. COALESCE in the amount function treats an unrecorded
-- component as not applying, which is the only reading of "not recorded" that produces a bill.
--
-- A DRAFT TARIFF BILLS NOTHING. `finance.rates_billable()` admits `status = 'approved'` only, so a
-- rate somebody typed in is not a rate the Council resolved.
CREATE TABLE IF NOT EXISTS finance.rates_tariff (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id              integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  financial_year_id         uuid NOT NULL REFERENCES finance.financial_year (id),
  property_category_id      uuid NOT NULL REFERENCES finance.property_category (id),
  currency                  finance.currency_code NOT NULL,
  rate_in_dollar            numeric(18, 8) NOT NULL,
  -- Optional components of the charge. NULL means the Council recorded none.
  fixed_charge              finance.money,
  minimum_charge            finance.money,
  -- Where the rates revenue is recognised. NULL means the billing run's own revenue account is
  -- used, which is how a council with one rates revenue account avoids repeating it per category.
  revenue_ledger_account_id uuid REFERENCES finance.ledger_account (id),
  -- D18's "who approves it". The minute reference is the Council's own record of the resolution;
  -- approved_by is the person in this system who entered that the resolution exists.
  status                    text NOT NULL DEFAULT 'draft' CONSTRAINT rates_tariff_status_known
                            CHECK (status IN ('draft', 'approved', 'superseded')),
  resolution_reference      text,
  resolution_date           date,
  approved_by               uuid REFERENCES public.users (id),
  approved_at               timestamptz,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid REFERENCES public.users (id),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz,
  deleted_by                uuid REFERENCES public.users (id),
  CONSTRAINT rates_tariff_rate_not_negative CHECK (rate_in_dollar >= 0),
  CONSTRAINT rates_tariff_charges_not_negative CHECK (
    (fixed_charge IS NULL OR fixed_charge >= 0) AND (minimum_charge IS NULL OR minimum_charge >= 0)),
  -- An approved tariff names who approved it and when, the same shape
  -- finance.budget_line's `budget_line_approval_recorded` uses (188).
  CONSTRAINT rates_tariff_approval_recorded CHECK (
    status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
-- One approved rate per category per year per currency. Two would make a billing run choose.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rates_tariff_approved
  ON finance.rates_tariff (financial_year_id, property_category_id, currency)
  WHERE deleted_at IS NULL AND status = 'approved';
CREATE INDEX IF NOT EXISTS idx_rates_tariff_year
  ON finance.rates_tariff (financial_year_id, status);

COMMENT ON TABLE finance.rates_tariff IS
  'The rate in the dollar per property category per financial year, with the Council resolution '
  'that approved it (decision D18). Seeded empty; no rate is assumed and none is inferred from any '
  'other figure. rate_in_dollar is numeric(18,8), not finance.money, because a rate of 0.015 '
  'rounded to two places would bill a third too much.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4. THE RATES ACCOUNT (DECISION D19) AND THE BILLING RECORDS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- What ties a property to the person who pays for it. The ratepayer is a `finance.party` (203:158)
-- — the general ledger's own subledger register — and NOT a second party table, because the
-- receivable control account's balance has to reconcile to a list of names and there can only be
-- one such list.
--
-- EMPTY, AND THIS IS THE BINDING BLOCKER. `spatial_planning.parcel_owner` holds 0 rows against 731
-- parcels, so there is no ratepayer of record to create these from (decision D19). Rates billing
-- cannot run at all until this register is populated, and
-- `finance.rates_billable()` reports a parcel with no rates account as refused and waiting on D19
-- rather than quietly skipping it.
CREATE TABLE IF NOT EXISTS finance.rates_account (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id  integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  -- The council's own rates account number, as printed on a statement.
  account_no    text NOT NULL,
  parcel_id     character varying(24) NOT NULL REFERENCES land.parcel (parcel_id),
  -- The ratepayer of record. The GL's party register, reused (203:158).
  party_id      uuid NOT NULL REFERENCES finance.party (id),
  -- The seam to Promun/Pastel. revenue_link.account_link already maps parcel_id to erp_account_no
  -- and holds 0 rows; carrying it here keeps a migrated account's external number with it, which
  -- is what the parallel run of spec decision 3 reconciles against.
  erp_account_no text,
  opened_on     date NOT NULL DEFAULT CURRENT_DATE,
  closed_on     date,
  status        text NOT NULL DEFAULT 'active' CONSTRAINT rates_account_status_known
                CHECK (status IN ('active', 'closed')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.users (id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  deleted_by    uuid REFERENCES public.users (id),
  CONSTRAINT rates_account_dates_ordered CHECK (closed_on IS NULL OR closed_on >= opened_on),
  CONSTRAINT rates_account_closed_is_dated CHECK ((status = 'closed') = (closed_on IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rates_account_no
  ON finance.rates_account (authority_id, account_no) WHERE deleted_at IS NULL;
-- One ACTIVE account per parcel. Two would bill the same property twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rates_account_parcel_active
  ON finance.rates_account (parcel_id) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_rates_account_party ON finance.rates_account (party_id);

COMMENT ON TABLE finance.rates_account IS
  'Ties a land.parcel to the finance.party who is the ratepayer of record (decision D19). Seeded '
  'empty: spatial_planning.parcel_owner holds 0 rows against 731 parcels, so rates billing cannot '
  'run until this register is populated. One active account per parcel, so no property is billed '
  'twice.';

-- ── The amount, defined once ─────────────────────────────────────────────────────────────────
-- IMMUTABLE so that `finance.rates_bill.amount` can be a GENERATED STORED column over it. That is
-- the point: the bill's amount and the amount the eligibility function previews come from one
-- expression, so a preview and a bill cannot differ, and no route can compute either.
--
-- The rounding happens ONCE, on the product. Rounding the rate first is what turns 0.015 into 0.02.
CREATE OR REPLACE FUNCTION finance.rates_bill_amount(
  p_rateable_value numeric,
  p_rate_in_dollar numeric,
  p_fixed_charge   numeric,
  p_minimum_charge numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT GREATEST(
           round(p_rateable_value * p_rate_in_dollar, 2) + COALESCE(p_fixed_charge, 0),
           COALESCE(p_minimum_charge, 0)
         )
$$;

COMMENT ON FUNCTION finance.rates_bill_amount(numeric, numeric, numeric, numeric) IS
  'The rates charge: the rateable value at the rate in the dollar, plus any fixed charge, floored '
  'at any minimum charge. IMMUTABLE so finance.rates_bill.amount can be generated from it, which '
  'is what gives the amount exactly one definition. NULL fixed or minimum means the Council '
  'recorded none, which is not the same as nil.';

-- ── The billing run ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.rates_billing_run (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id              integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  run_reference             text NOT NULL,
  financial_year_id         uuid NOT NULL REFERENCES finance.financial_year (id),
  period_from               date NOT NULL,
  period_to                 date NOT NULL,
  posting_date              date NOT NULL,
  currency                  finance.currency_code NOT NULL,
  receivable_ledger_account_id uuid NOT NULL REFERENCES finance.ledger_account (id),
  revenue_ledger_account_id    uuid NOT NULL REFERENCES finance.ledger_account (id),
  -- `raised` means the drafts exist and nothing is posted. `committed` means every draft was
  -- posted by somebody other than whoever prepared it.
  status                    text NOT NULL DEFAULT 'raised' CONSTRAINT rates_billing_run_status_known
                            CHECK (status IN ('raised', 'committed', 'cancelled')),
  properties_considered     integer NOT NULL DEFAULT 0,
  bills_raised              integer NOT NULL DEFAULT 0,
  properties_refused        integer NOT NULL DEFAULT 0,
  prepared_by               uuid NOT NULL REFERENCES public.users (id),
  prepared_at               timestamptz NOT NULL DEFAULT now(),
  committed_by              uuid REFERENCES public.users (id),
  committed_at              timestamptz,
  cancelled_by              uuid REFERENCES public.users (id),
  cancelled_at              timestamptz,
  cancel_reason             text,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz,
  deleted_by                uuid REFERENCES public.users (id),
  CONSTRAINT rates_billing_run_period_ordered CHECK (period_to >= period_from),
  CONSTRAINT rates_billing_run_committed_is_attributed CHECK (
    (status = 'committed') = (committed_by IS NOT NULL AND committed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rates_billing_run_reference
  ON finance.rates_billing_run (authority_id, run_reference) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rates_billing_run_year
  ON finance.rates_billing_run (financial_year_id, period_from);

COMMENT ON TABLE finance.rates_billing_run IS
  'One rates billing run: the period billed, the two ledger accounts it posts between, and how '
  'many properties it billed and refused. A run in `raised` status has created draft vouchers and '
  'posted nothing; committing it posts them, and whoever prepared a voucher cannot post it '
  '(acceptance check G7).';

-- ── The bill ─────────────────────────────────────────────────────────────────────────────────
-- A bill is a document AND a voucher: one voucher per bill, because a receipt settles a particular
-- bill through `voucher_line.against_voucher_id` (203:357) and that is what makes ageing work. A
-- bill with no voucher would be a charge that never reached the book of account, so voucher_id is
-- NOT NULL from the moment the bill exists — as a draft voucher, which posts nothing.
--
-- EVERY INPUT IS SNAPSHOT ON THE BILL. The rateable value, the rate, the fixed and minimum charges
-- and the roll and tariff rows they came from. A bill reprinted in three years must show what was
-- charged and on what basis, not what the roll says today.
CREATE TABLE IF NOT EXISTS finance.rates_bill (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id         integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  bill_no              text NOT NULL,
  rates_account_id     uuid NOT NULL REFERENCES finance.rates_account (id),
  billing_run_id       uuid REFERENCES finance.rates_billing_run (id),
  financial_year_id    uuid NOT NULL REFERENCES finance.financial_year (id),
  period_from          date NOT NULL,
  period_to            date NOT NULL,
  -- Provenance, snapshot: which roll row and which tariff row produced this charge.
  valuation_roll_id    uuid NOT NULL REFERENCES finance.valuation_roll (id),
  rates_tariff_id      uuid NOT NULL REFERENCES finance.rates_tariff (id),
  rateable_value       finance.money NOT NULL,
  rate_in_dollar       numeric(18, 8) NOT NULL,
  fixed_charge         finance.money,
  minimum_charge       finance.money,
  currency             finance.currency_code NOT NULL,
  -- Computed by Postgres, from one definition, and not writable at all.
  amount               finance.money GENERATED ALWAYS AS (
                         finance.rates_bill_amount(rateable_value, rate_in_dollar,
                                                   fixed_charge, minimum_charge)) STORED,
  -- The double entry this bill is. One voucher per bill (see the table comment).
  voucher_id           uuid NOT NULL REFERENCES finance.voucher (id),
  issued_on            date NOT NULL DEFAULT CURRENT_DATE,
  due_on               date,
  narration            text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES public.users (id),
  deleted_at           timestamptz,
  deleted_by           uuid REFERENCES public.users (id),
  CONSTRAINT rates_bill_period_ordered CHECK (period_to >= period_from),
  CONSTRAINT rates_bill_value_not_negative CHECK (rateable_value >= 0),
  CONSTRAINT rates_bill_rate_not_negative CHECK (rate_in_dollar >= 0),
  CONSTRAINT rates_bill_due_after_issue CHECK (due_on IS NULL OR due_on >= issued_on)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rates_bill_no
  ON finance.rates_bill (authority_id, bill_no) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rates_bill_voucher
  ON finance.rates_bill (voucher_id);
-- One bill per account per billed period. The guard against a run being repeated by mistake; the
-- eligibility function reads this index's columns and refuses a duplicate rather than raising it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rates_bill_account_period
  ON finance.rates_bill (rates_account_id, period_from, period_to) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rates_bill_run ON finance.rates_bill (billing_run_id);
CREATE INDEX IF NOT EXISTS idx_rates_bill_account ON finance.rates_bill (rates_account_id, period_from);

COMMENT ON TABLE finance.rates_bill IS
  'A rates bill: the charge, every input it was computed from, and the voucher that is its double '
  'entry (Dr receivable control / Cr rates revenue — full accrual, spec decision 2). `amount` is a '
  'GENERATED column over finance.rates_bill_amount(), so it has one definition and no route can '
  'compute it. One bill per account per period, so a repeated run cannot double-bill.';

-- ── The receipt ──────────────────────────────────────────────────────────────────────────────
-- The receipt document. WHICH BILLS IT SETTLES IS NOT RECORDED HERE: that is
-- `voucher_line.against_voucher_id` on the receipt's own voucher, which is the single source the
-- ageing view reads (203:1066). A second allocation table would be a second answer to the same
-- question and the two would drift.
CREATE TABLE IF NOT EXISTS finance.rates_receipt (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id     integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  receipt_no       text NOT NULL,
  rates_account_id uuid NOT NULL REFERENCES finance.rates_account (id),
  party_id         uuid NOT NULL REFERENCES finance.party (id),
  financial_year_id uuid NOT NULL REFERENCES finance.financial_year (id),
  amount           finance.money NOT NULL,
  currency         finance.currency_code NOT NULL,
  received_on      date NOT NULL,
  -- NULL means the method was not recorded, which is not the same as cash.
  method           text CONSTRAINT rates_receipt_method_known
                   CHECK (method IS NULL OR method IN (
                     'cash', 'bank_transfer', 'mobile_money', 'cheque', 'card', 'other')),
  reference        text,
  voucher_id       uuid NOT NULL REFERENCES finance.voucher (id),
  narration        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES public.users (id),
  deleted_at       timestamptz,
  deleted_by       uuid REFERENCES public.users (id),
  CONSTRAINT rates_receipt_amount_positive CHECK (amount > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rates_receipt_no
  ON finance.rates_receipt (authority_id, receipt_no) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rates_receipt_voucher
  ON finance.rates_receipt (voucher_id);
CREATE INDEX IF NOT EXISTS idx_rates_receipt_account
  ON finance.rates_receipt (rates_account_id, received_on);

COMMENT ON TABLE finance.rates_receipt IS
  'A rates receipt: Dr bank / Cr receivable control, settling one or more bills through '
  'voucher_line.against_voucher_id on its own voucher. The allocation is NOT duplicated here; '
  'finance.v_debtor_ageing reads it from the ledger, which is the only place it exists.';

-- ── The refusals: G9 as a record, not a message ──────────────────────────────────────────────
-- This table is the point of the whole migration. A billing run that cannot bill 731 properties
-- because no owner, no value and no rate exist must leave behind something the Council can act on,
-- naming WHICH decision each property is waiting on. A log line or an HTTP error would leave a
-- blocked run as a dead end; a row per property per reason makes it a work list.
CREATE TABLE IF NOT EXISTS finance.rates_billing_refusal (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id     integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  billing_run_id   uuid NOT NULL REFERENCES finance.rates_billing_run (id) ON DELETE CASCADE,
  parcel_id        character varying(24) NOT NULL REFERENCES land.parcel (parcel_id),
  rates_account_id uuid REFERENCES finance.rates_account (id),
  reason_code      text NOT NULL CONSTRAINT rates_billing_refusal_reason_known CHECK (reason_code IN (
                     'no_rates_account', 'ratepayer_inactive', 'no_rateable_value',
                     'no_property_category', 'no_approved_tariff', 'currency_mismatch',
                     'already_billed', 'nil_charge')),
  -- Which Council decision this property is waiting on, or NULL where the refusal is not waiting
  -- on a decision at all (a duplicate bill is a duplicate, not a governance gap).
  waiting_on       text CONSTRAINT rates_billing_refusal_decision_known
                   CHECK (waiting_on IS NULL OR waiting_on IN ('D17', 'D18', 'D19')),
  message          text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rates_billing_refusal_run
  ON finance.rates_billing_refusal (billing_run_id, reason_code);
CREATE INDEX IF NOT EXISTS idx_rates_billing_refusal_parcel
  ON finance.rates_billing_refusal (parcel_id);

COMMENT ON TABLE finance.rates_billing_refusal IS
  'Why a property was not billed, one row per property per run (acceptance check G9). Each row '
  'names which of decisions D17, D18 and D19 it is waiting on, so a blocked billing run is a work '
  'list for the Council rather than a dead end. A property with no rateable value is refused here; '
  'it is never billed nil.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5. ELIGIBILITY — ONE DECISION, READ BY BOTH THE PREVIEW AND THE RUN
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- `finance.rates_billable()` decides, for one billing period, whether each property can be billed
-- and if not why not. A FUNCTION rather than a view because the answer depends on the period, and a
-- view would have forced the period into a WHERE clause written separately by every caller.
--
-- THE PREVIEW AND THE COMMIT CALL THIS SAME FUNCTION. That is the whole reason it exists: a
-- "billing run that shows what it would refuse" is only trustworthy if what it shows is what the
-- run then does. `finance.raise_rates_billing()` below reads it, and so does
-- GET /finance/rates/billing/preview.
--
-- IT ITERATES OVER `land.parcel`, NOT OVER RATES ACCOUNTS. A parcel with no rates account is the
-- most important refusal there is — it is decision D19, which blocks everything — and iterating
-- over accounts would have made 731 blocked properties invisible by returning nothing at all.
-- Superseded parcels are excluded: `land.parcel.status` is the custodian register's own currency
-- flag and a parcel that is no longer current is not a property the council rates.
--
-- EXACTLY ONE REASON PER PROPERTY, in a fixed order of fundamentality: no ratepayer before no
-- value, no value before no rate. A property waiting on three decisions is reported against the
-- first one that has to be answered, so the work list does not triple-count.
CREATE OR REPLACE FUNCTION finance.rates_billable(
  p_financial_year_id uuid,
  p_period_from       date,
  p_period_to         date,
  p_currency          finance.currency_code
) RETURNS TABLE (
  parcel_id            character varying(24),
  stand_no             character varying(24),
  ward_code            character varying(24),
  rates_account_id     uuid,
  account_no           text,
  party_id             uuid,
  party_name           text,
  party_status         text,
  property_category_id uuid,
  category_code        text,
  category_name        text,
  valuation_roll_id    uuid,
  rateable_value       finance.money,
  valuation_currency   finance.currency_code,
  rates_tariff_id      uuid,
  rate_in_dollar       numeric,
  fixed_charge         finance.money,
  minimum_charge       finance.money,
  revenue_ledger_account_id uuid,
  bill_amount          finance.money,
  billable             boolean,
  reason_code          text,
  waiting_on           text,
  message              text
) LANGUAGE sql STABLE AS $$
  WITH candidate AS (
    SELECT pa.parcel_id, pa.stand_no, pa.ward_code,
           ra.id AS rates_account_id, ra.account_no,
           pt.id AS party_id, pt.name AS party_name, pt.status AS party_status,
           v.id AS valuation_roll_id, v.rateable_value, v.currency AS valuation_currency,
           v.property_category_id,
           pc.code AS category_code, pc.name AS category_name, pc.status AS category_status,
           t.id AS rates_tariff_id, t.rate_in_dollar, t.fixed_charge, t.minimum_charge,
           t.revenue_ledger_account_id,
           EXISTS (
             SELECT 1 FROM finance.rates_bill rb
              WHERE rb.rates_account_id = ra.id
                AND rb.period_from = p_period_from
                AND rb.period_to = p_period_to
                AND rb.deleted_at IS NULL
           ) AS already_billed
      FROM land.parcel pa
      -- One active account per parcel is a unique index, so this cannot fan out.
      LEFT JOIN finance.rates_account ra
             ON ra.parcel_id = pa.parcel_id AND ra.deleted_at IS NULL AND ra.status = 'active'
      LEFT JOIN finance.party pt
             ON pt.id = ra.party_id AND pt.deleted_at IS NULL
      -- The value IN FORCE AT THE START of the billed period. Rates are levied on the value the
      -- property carried when the period opened, not on one that arrived during it.
      LEFT JOIN LATERAL (
        SELECT vr.* FROM finance.valuation_roll vr
         WHERE vr.parcel_id = pa.parcel_id
           AND vr.deleted_at IS NULL
           AND vr.status = 'active'
           AND vr.effective_from <= p_period_from
           AND (vr.effective_to IS NULL OR vr.effective_to >= p_period_from)
         ORDER BY vr.effective_from DESC
         LIMIT 1
      ) v ON true
      LEFT JOIN finance.property_category pc
             ON pc.id = v.property_category_id AND pc.deleted_at IS NULL
      LEFT JOIN finance.rates_tariff t
             ON t.financial_year_id = p_financial_year_id
            AND t.property_category_id = v.property_category_id
            AND t.currency = p_currency
            AND t.status = 'approved'
            AND t.deleted_at IS NULL
     WHERE pa.status = 'current'
  ), judged AS (
    SELECT c.*,
           CASE
             WHEN c.rates_account_id IS NULL      THEN 'no_rates_account'
             WHEN c.party_id IS NULL
               OR c.party_status <> 'active'      THEN 'ratepayer_inactive'
             WHEN c.valuation_roll_id IS NULL     THEN 'no_rateable_value'
             WHEN c.category_status IS DISTINCT FROM 'active' THEN 'no_property_category'
             WHEN c.valuation_currency <> p_currency THEN 'currency_mismatch'
             WHEN c.rates_tariff_id IS NULL       THEN 'no_approved_tariff'
             WHEN c.already_billed                THEN 'already_billed'
             -- A charge that computes to nil raises no double entry: finance.voucher_line's
             -- `voucher_line_one_side_only` requires a non-zero amount, and a voucher of two zero
             -- lines is not a posting. It is reported rather than skipped, because a property the
             -- Council valued at nil with no minimum charge is a fact somebody should see.
             WHEN finance.rates_bill_amount(c.rateable_value, c.rate_in_dollar,
                                            c.fixed_charge, c.minimum_charge) = 0
                                                  THEN 'nil_charge'
           END AS reason_code
      FROM candidate c
  )
  SELECT j.parcel_id, j.stand_no, j.ward_code,
         j.rates_account_id, j.account_no,
         j.party_id, j.party_name, j.party_status,
         j.property_category_id, j.category_code, j.category_name,
         j.valuation_roll_id, j.rateable_value, j.valuation_currency,
         j.rates_tariff_id, j.rate_in_dollar, j.fixed_charge, j.minimum_charge,
         j.revenue_ledger_account_id,
         CASE WHEN j.reason_code IS NULL
              THEN finance.rates_bill_amount(j.rateable_value, j.rate_in_dollar,
                                             j.fixed_charge, j.minimum_charge)::finance.money
         END AS bill_amount,
         (j.reason_code IS NULL) AS billable,
         j.reason_code,
         CASE j.reason_code
           WHEN 'no_rates_account'     THEN 'D19'
           WHEN 'ratepayer_inactive'   THEN 'D19'
           WHEN 'no_rateable_value'    THEN 'D17'
           WHEN 'no_property_category' THEN 'D17'
           WHEN 'currency_mismatch'    THEN 'D17'
           WHEN 'no_approved_tariff'   THEN 'D18'
         END AS waiting_on,
         CASE j.reason_code
           WHEN 'no_rates_account' THEN
             'No rates account ties this property to a ratepayer of record, so there is nobody to '
             || 'bill. The owner register holds no rows (decision D19).'
           WHEN 'ratepayer_inactive' THEN
             'The rates account names a ratepayer who is not active, so the bill would be addressed '
             || 'to nobody (decision D19).'
           WHEN 'no_rateable_value' THEN
             'No rateable value is in force for this property on ' || p_period_from::text
             || ', so the charge cannot be computed. It is not billed nil (decision D17).'
           WHEN 'no_property_category' THEN
             'The valuation names a property category that is not active, so no rate in the dollar '
             || 'can be matched to it (decision D17).'
           WHEN 'currency_mismatch' THEN
             'The rateable value is stated in ' || j.valuation_currency || ' and this run bills in '
             || p_currency || '. No conversion is applied, because the Council has approved no rate '
             || '(decision D4, raised against the roll under D17).'
           WHEN 'no_approved_tariff' THEN
             'No approved rate in the dollar exists for category ' || COALESCE(j.category_code, '?')
             || ' in ' || p_currency || ' for this financial year (decision D18).'
           WHEN 'already_billed' THEN
             'This account already has a bill covering ' || p_period_from::text || ' to '
             || p_period_to::text || '. A run is not repeated over a period it has already billed.'
           WHEN 'nil_charge' THEN
             'The rateable value and the approved rate compute a charge of nil, and no minimum '
             || 'charge is recorded, so there is no double entry to raise. Nothing is wrong with '
             || 'the data; the property is simply not chargeable this period.'
           ELSE
             'Billable: ' || j.rateable_value::text || ' ' || j.valuation_currency || ' at '
             || j.rate_in_dollar::text || ' in the dollar.'
         END AS message
    FROM judged j
$$;

COMMENT ON FUNCTION finance.rates_billable(uuid, date, date, finance.currency_code) IS
  'For one billing period, whether each current land.parcel can be billed and if not why not, with '
  'the Council decision (D17/D18/D19) each refusal is waiting on. Read by BOTH the billing preview '
  'and finance.raise_rates_billing(), so what a preview shows is what the run does. Exactly one '
  'reason per property, most fundamental first. Acceptance check G9.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 6. ARREARS, AND THE CURRENT ROLL — AS VIEWS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Arrears are NOT recomputed here. finance.v_debtor_ageing (203:1066) already ages a receivable
-- debit against the receivable credits that name it in `against_voucher_id`, including the
-- unallocated-receipt case that makes most ageing reports disagree with their control account.
-- This view only attaches the rates account, the property and the ratepayer to those rows, so the
-- rates screens and the ledger's debtor ageing cannot report different arrears.
DROP VIEW IF EXISTS finance.v_rates_arrears CASCADE;
CREATE VIEW finance.v_rates_arrears WITH (security_invoker = true) AS
SELECT a.authority_id,
       a.currency,
       COALESCE(rb.rates_account_id, rc.rates_account_id) AS rates_account_id,
       ra.account_no,
       ra.parcel_id,
       pa.stand_no,
       pa.ward_code,
       a.party_id,
       a.party_name,
       a.party_reference,
       a.voucher_id,
       a.voucher_no,
       a.voucher_type,
       rb.id      AS rates_bill_id,
       rb.bill_no,
       rb.period_from,
       rb.period_to,
       rc.id      AS rates_receipt_id,
       rc.receipt_no,
       a.posting_date,
       a.billed_amount,
       a.settled_amount,
       a.outstanding_amount,
       a.last_settled_on,
       a.days_outstanding,
       a.ageing_bucket
  FROM finance.v_debtor_ageing a
  LEFT JOIN finance.rates_bill rb    ON rb.voucher_id = a.voucher_id AND rb.deleted_at IS NULL
  LEFT JOIN finance.rates_receipt rc ON rc.voucher_id = a.voucher_id AND rc.deleted_at IS NULL
  LEFT JOIN finance.rates_account ra
         ON ra.id = COALESCE(rb.rates_account_id, rc.rates_account_id) AND ra.deleted_at IS NULL
  LEFT JOIN land.parcel pa ON pa.parcel_id = ra.parcel_id
 WHERE rb.id IS NOT NULL OR rc.id IS NOT NULL;

COMMENT ON VIEW finance.v_rates_arrears IS
  'Rates arrears: finance.v_debtor_ageing with the rates account, property and ratepayer attached. '
  'Nothing is recomputed, so the rates arrears and the ledger debtor ageing are the same figures. '
  'An unallocated receipt keeps its negative outstanding figure, so a ratepayer''s total still '
  'reconciles to the receivable control account. Never combines currencies.';

-- The roll as it stands today, which is what a maintenance screen lists. A parcel with no active
-- value appears with NULLs rather than being dropped: 731 parcels and no values is the finding, and
-- an inner join would have hidden it.
DROP VIEW IF EXISTS finance.v_valuation_roll_current CASCADE;
CREATE VIEW finance.v_valuation_roll_current WITH (security_invoker = true) AS
SELECT pa.parcel_id,
       pa.stand_no,
       pa.ward_code,
       pa.township_code,
       pa.area_m2,
       v.id                   AS valuation_roll_id,
       v.rateable_value,
       v.currency,
       v.effective_from,
       v.effective_to,
       v.source,
       v.source_reference,
       v.valuation_date,
       v.status               AS valuation_status,
       pc.id                  AS property_category_id,
       pc.code                AS category_code,
       pc.name                AS category_name,
       ra.id                  AS rates_account_id,
       ra.account_no,
       ra.party_id,
       pt.name                AS party_name,
       (v.id IS NOT NULL)     AS has_rateable_value,
       (ra.id IS NOT NULL)    AS has_rates_account
  FROM land.parcel pa
  LEFT JOIN LATERAL (
    SELECT vr.* FROM finance.valuation_roll vr
     WHERE vr.parcel_id = pa.parcel_id
       AND vr.deleted_at IS NULL
       AND vr.status = 'active'
       AND vr.effective_from <= CURRENT_DATE
       AND (vr.effective_to IS NULL OR vr.effective_to >= CURRENT_DATE)
     ORDER BY vr.effective_from DESC
     LIMIT 1
  ) v ON true
  LEFT JOIN finance.property_category pc ON pc.id = v.property_category_id AND pc.deleted_at IS NULL
  LEFT JOIN finance.rates_account ra
         ON ra.parcel_id = pa.parcel_id AND ra.deleted_at IS NULL AND ra.status = 'active'
  LEFT JOIN finance.party pt ON pt.id = ra.party_id AND pt.deleted_at IS NULL
 WHERE pa.status = 'current';

COMMENT ON VIEW finance.v_valuation_roll_current IS
  'Every current land.parcel with the rateable value in force today, its category, and its rates '
  'account if it has one. A parcel with neither appears with NULLs and has_rateable_value false '
  'rather than being dropped — 731 properties and no valuations is the finding, and an inner join '
  'would hide it.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 7. THE BILLING RUN — DRAFTS AND REFUSALS, AND NOT ONE LEDGER ROW
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Creates one draft voucher and one bill per billable property, and one refusal row per property
-- that cannot be billed. IT POSTS NOTHING. `finance.post_voucher()` (203:720) remains the only
-- writer of finance.ledger_entry, and committing the run calls it once per draft — from a
-- different person, because `voucher_prepared_and_posted_differ` (203:313) and acceptance check G7
-- require it. An officer prepares 700 bills and the Director posts them.
--
-- WHY THE WHOLE RUN IS ONE FUNCTION AND NOT A LOOP IN A ROUTE
-- Partly atomicity: a run that created 300 bills and then failed would leave a period half billed,
-- and the only honest repair is for none of it to have happened. Mostly, though, because the
-- refusals and the bills have to come from ONE pass over `finance.rates_billable()`. Two passes —
-- one to count, one to write — could disagree if a valuation were entered between them, and the
-- figure a council acts on would be neither.
--
-- EVERY REFUSAL IS WRITTEN DOWN. A property that is not billed produces a row in
-- finance.rates_billing_refusal naming the decision it waits on. Nothing is skipped silently; the
-- counts on the run reconcile exactly (considered = raised + refused).
CREATE OR REPLACE FUNCTION finance.raise_rates_billing(
  p_financial_year_id     uuid,
  p_period_from           date,
  p_period_to             date,
  p_posting_date          date,
  p_currency              finance.currency_code,
  p_receivable_account_id uuid,
  p_revenue_account_id    uuid,
  p_prepared_by           uuid,
  p_run_reference         text,
  p_due_on                date DEFAULT NULL,
  p_narration             text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  y            record;
  acct         record;
  per          record;
  r            record;
  v_run        uuid;
  v_voucher    uuid;
  v_authority  integer;
  v_bill_no    text;
  v_seq        integer := 0;
  v_considered integer := 0;
  v_refused    integer := 0;
  v_narration  text;
  v_bad_tariff text;
BEGIN
  IF p_prepared_by IS NULL THEN
    RAISE EXCEPTION 'a billing run records who prepared it' USING ERRCODE = '23502';
  END IF;

  SELECT id, authority_id, label, start_date, end_date, status INTO y
    FROM finance.financial_year WHERE id = p_financial_year_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'financial year % does not exist', p_financial_year_id USING ERRCODE = '23503';
  END IF;
  v_authority := y.authority_id;

  IF p_period_to < p_period_from THEN
    RAISE EXCEPTION 'the billed period ends (%) before it begins (%)', p_period_to, p_period_from
      USING ERRCODE = '23514';
  END IF;
  -- A bill for a period outside the year it is filed under would put revenue in the wrong year.
  IF p_period_from < y.start_date OR p_period_to > y.end_date THEN
    RAISE EXCEPTION 'the billed period % to % is not inside financial year % (% to %)',
      p_period_from, p_period_to, y.label, y.start_date, y.end_date USING ERRCODE = '23514';
  END IF;

  -- The receivable control. Ageing reads `account_type = 'receivable'` (203:1068), so a bill posted
  -- to anything else would be invisible to the arrears report and the debt would not exist.
  SELECT id, code, name, root_type, account_type, is_postable, status INTO acct
    FROM finance.ledger_account WHERE id = p_receivable_account_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'receivable account % does not exist', p_receivable_account_id USING ERRCODE = '23503';
  END IF;
  IF acct.account_type IS DISTINCT FROM 'receivable' THEN
    RAISE EXCEPTION 'account % (%) is not a receivable control account, so a bill posted to it would never appear in the arrears',
      acct.code, acct.name USING ERRCODE = '23514',
      HINT = 'Set its account_type to receivable, or choose the account that carries rates debtors.';
  END IF;
  IF NOT acct.is_postable OR acct.status <> 'active' THEN
    RAISE EXCEPTION 'account % (%) cannot be posted to', acct.code, acct.name USING ERRCODE = '23514';
  END IF;

  SELECT id, code, name, root_type, is_postable, status INTO acct
    FROM finance.ledger_account WHERE id = p_revenue_account_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revenue account % does not exist', p_revenue_account_id USING ERRCODE = '23503';
  END IF;
  IF acct.root_type <> 'revenue' THEN
    RAISE EXCEPTION 'account % (%) is a % account, not revenue; rates billed are revenue recognised when billed',
      acct.code, acct.name, acct.root_type USING ERRCODE = '23514';
  END IF;
  IF NOT acct.is_postable OR acct.status <> 'active' THEN
    RAISE EXCEPTION 'account % (%) cannot be posted to', acct.code, acct.name USING ERRCODE = '23514';
  END IF;

  -- A tariff may name its own revenue account. Checked here, over the whole year's approved
  -- tariffs, rather than per bill: a run that failed on property 400 because one category pointed
  -- at an expense account would have to be unwound, and the refusal is more useful before it starts.
  SELECT t.id::text || ' (category ' || pc.code || ')' INTO v_bad_tariff
    FROM finance.rates_tariff t
    JOIN finance.property_category pc ON pc.id = t.property_category_id
    JOIN finance.ledger_account la ON la.id = t.revenue_ledger_account_id
   WHERE t.financial_year_id = p_financial_year_id
     AND t.currency = p_currency
     AND t.status = 'approved'
     AND t.deleted_at IS NULL
     AND (la.root_type <> 'revenue' OR NOT la.is_postable OR la.status <> 'active')
   LIMIT 1;
  IF v_bad_tariff IS NOT NULL THEN
    RAISE EXCEPTION 'tariff % names a revenue account that is not a postable revenue account', v_bad_tariff
      USING ERRCODE = '23514';
  END IF;

  -- An open accounting period containing the posting date. post_voucher() refuses without one
  -- (203:757), so a run prepared into a closed period would produce drafts nobody could ever post.
  SELECT lp.id, lp.period_no, lp.status INTO per
    FROM finance.ledger_period lp
   WHERE lp.financial_year_id = p_financial_year_id
     AND p_posting_date BETWEEN lp.from_date AND lp.to_date
   ORDER BY lp.period_no
   LIMIT 1;
  IF per.id IS NULL THEN
    RAISE EXCEPTION 'no accounting period of financial year % contains %', y.label, p_posting_date
      USING ERRCODE = '23514',
            HINT = 'Open the periods for the year first; they must tile it exactly.';
  END IF;
  IF per.status <> 'open' THEN
    RAISE EXCEPTION 'accounting period % is % and accepts no postings, so these bills could never be posted',
      per.period_no, per.status USING ERRCODE = '23514';
  END IF;

  INSERT INTO finance.rates_billing_run
    (authority_id, run_reference, financial_year_id, period_from, period_to, posting_date, currency,
     receivable_ledger_account_id, revenue_ledger_account_id, status, prepared_by, notes)
  VALUES (v_authority, p_run_reference, p_financial_year_id, p_period_from, p_period_to,
          p_posting_date, p_currency, p_receivable_account_id, p_revenue_account_id,
          'raised', p_prepared_by, p_narration)
  RETURNING id INTO v_run;

  v_narration := COALESCE(p_narration,
    'Rates ' || p_period_from::text || ' to ' || p_period_to::text);

  -- ONE pass. Bills and refusals come from the same rows, so the counts reconcile by construction.
  FOR r IN SELECT * FROM finance.rates_billable(p_financial_year_id, p_period_from, p_period_to, p_currency)
           ORDER BY parcel_id
  LOOP
    v_considered := v_considered + 1;

    IF NOT r.billable THEN
      v_refused := v_refused + 1;
      INSERT INTO finance.rates_billing_refusal
        (authority_id, billing_run_id, parcel_id, rates_account_id, reason_code, waiting_on, message)
      VALUES (v_authority, v_run, r.parcel_id, r.rates_account_id, r.reason_code, r.waiting_on, r.message);
      CONTINUE;
    END IF;

    v_seq := v_seq + 1;
    v_bill_no := p_run_reference || '-' || lpad(v_seq::text, 5, '0');

    -- The bill's own voucher. voucher_no IS the bill number: one voucher per bill, so a receipt
    -- settling this bill names it in against_voucher_id and the ageing follows it.
    INSERT INTO finance.voucher
      (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
       narration, reference, status, prepared_by)
    VALUES (v_authority, v_bill_no, 'rates_bill', p_currency, p_financial_year_id, p_posting_date,
            v_narration, v_bill_no, 'draft', p_prepared_by)
    RETURNING id INTO v_voucher;

    -- Dr receivable control, against the ratepayer. The party is what makes the control account
    -- reconcilable to a list of names.
    INSERT INTO finance.voucher_line
      (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, party_id, ward_code, narration)
    VALUES (v_authority, v_voucher, 1, p_receivable_account_id, r.bill_amount, 0,
            r.party_id, r.ward_code,
            'Rates billed, stand ' || COALESCE(r.stand_no, r.parcel_id));

    -- Cr rates revenue. Recognised when billed, not when received (full accrual, spec decision 2).
    INSERT INTO finance.voucher_line
      (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, ward_code, narration)
    VALUES (v_authority, v_voucher, 2,
            COALESCE(r.revenue_ledger_account_id, p_revenue_account_id), 0, r.bill_amount,
            r.ward_code,
            'Rates revenue, stand ' || COALESCE(r.stand_no, r.parcel_id));

    INSERT INTO finance.rates_bill
      (authority_id, bill_no, rates_account_id, billing_run_id, financial_year_id,
       period_from, period_to, valuation_roll_id, rates_tariff_id,
       rateable_value, rate_in_dollar, fixed_charge, minimum_charge, currency,
       voucher_id, issued_on, due_on, narration, created_by)
    VALUES (v_authority, v_bill_no, r.rates_account_id, v_run, p_financial_year_id,
            p_period_from, p_period_to, r.valuation_roll_id, r.rates_tariff_id,
            r.rateable_value, r.rate_in_dollar, r.fixed_charge, r.minimum_charge, p_currency,
            v_voucher, p_posting_date, p_due_on, v_narration, p_prepared_by);
  END LOOP;

  UPDATE finance.rates_billing_run
     SET properties_considered = v_considered,
         bills_raised = v_seq,
         properties_refused = v_refused
   WHERE id = v_run;

  RETURN v_run;
END $$;

COMMENT ON FUNCTION finance.raise_rates_billing(uuid, date, date, date, finance.currency_code, uuid, uuid, uuid, text, date, text) IS
  'Raises one DRAFT voucher and one finance.rates_bill per billable property, and one '
  'finance.rates_billing_refusal per property that cannot be billed, from a single pass over '
  'finance.rates_billable(). Writes no ledger entry: finance.post_voucher() stays the only writer, '
  'and committing the run posts the drafts from a different person (acceptance check G7). Refuses '
  'before it starts if the receivable account is not a receivable control, the revenue account is '
  'not revenue, the period is outside the year, or no open accounting period contains the posting '
  'date.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 8. THE PERMISSION CATALOGUE ADDITIONS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Same catalogue, same flags, same resolution as 188:1054 and 203:1149.
--
-- TWO CODES ARE FLAGGED is_approval. `finance.rates.tariff.approve` is the rate in the dollar
-- becoming the Council's rate, which is a resolution and belongs to the committee.
-- `finance.rates.bill.post` is a draft run becoming part of the book of account, which is the same
-- act `finance.ledger.voucher.post` is flagged for and must be subject to the same separation of
-- duties. Flagging them means finance.resolve_effective_permissions (200:194) covers them without
-- knowing they exist, and the technical administrator cannot hold either.
INSERT INTO finance.permission (code, label, category, is_approval, is_publication, is_restricted, description) VALUES
  ('finance.rates.view',             'View rates, debtors and arrears',  'rates', false, false, false, 'The valuation roll, the tariff schedule, rates accounts, bills, receipts and arrears.'),
  ('finance.rates.valuation.manage', 'Maintain the valuation roll',      'rates', false, false, false, 'Record and supersede rateable values. The roll is Council data (decision D17); this maintains it, it does not decide it.'),
  ('finance.rates.tariff.manage',    'Maintain the tariff schedule',     'rates', false, false, false, 'Draft a rate in the dollar per property category. A draft tariff bills nothing.'),
  ('finance.rates.tariff.approve',   'Approve a rates tariff',           'rates', true,  false, false, 'Record that Council has resolved the rate in the dollar (decision D18). Only an approved tariff is used by a billing run.'),
  ('finance.rates.account.manage',   'Maintain rates accounts',          'rates', false, false, false, 'Tie a property to the ratepayer of record (decision D19).'),
  ('finance.rates.bill.prepare',     'Raise a rates billing run',        'rates', false, false, false, 'Compute a billing run and raise its draft bills. A draft posts nothing and changes no balance.'),
  ('finance.rates.bill.post',        'Commit a rates billing run',       'rates', true,  false, false, 'Post a run''s draft bills to the book of account. Never the person who raised the run (acceptance check G7).'),
  ('finance.rates.receipt.record',   'Record a rates receipt',           'rates', false, false, false, 'Receipt a payment against a ratepayer''s bills.')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category,
      is_approval = EXCLUDED.is_approval, is_publication = EXCLUDED.is_publication,
      is_restricted = EXCLUDED.is_restricted, description = EXCLUDED.description;

-- ── Default grants ────────────────────────────────────────────────────────────────────────────
-- The same departure 203 stated and for the same reason: a billing run happens monthly or
-- quarterly and the committee does not sit to post it, so the Director of Finance holds
-- `finance.rates.bill.post` and the control that binds is per-voucher and in the database. The
-- committee holds the tariff approval, which is an annual resolution and is exactly what a
-- committee is for.
INSERT INTO finance.role_permission (role_name, permission_code) VALUES
  ('finance_admin',     'finance.rates.view'),
  ('finance_admin',     'finance.rates.valuation.manage'),
  ('finance_admin',     'finance.rates.tariff.manage'),
  ('finance_admin',     'finance.rates.account.manage'),
  ('finance_admin',     'finance.rates.bill.prepare'),
  ('finance_admin',     'finance.rates.bill.post'),
  ('finance_admin',     'finance.rates.receipt.record'),
  -- The officer maintains the registers, raises the run, and never posts it.
  ('finance_officer',   'finance.rates.view'),
  ('finance_officer',   'finance.rates.valuation.manage'),
  ('finance_officer',   'finance.rates.account.manage'),
  ('finance_officer',   'finance.rates.bill.prepare'),
  ('finance_officer',   'finance.rates.receipt.record'),
  -- The committee resolves the rate and reads the arrears.
  ('finance_committee', 'finance.rates.view'),
  ('finance_committee', 'finance.rates.tariff.approve'),
  -- The auditor reads and writes nothing.
  ('auditor',           'finance.rates.view'),
  -- The technical administrator reads, and holds nothing here that bills or approves.
  ('admin',             'finance.rates.view')
ON CONFLICT (role_name, permission_code) DO NOTHING;

-- Migration 188 section 11's assertions, re-run over the grants as they now stand, exactly as 203
-- re-ran them. If this block ever gives one role both an approval and the publication permission,
-- or gives the technical administrator financial authority, the migration fails rather than
-- quietly weakening the control.
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
-- 9. TENANCY AND GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- tenancy.make_tenant() (migration 167) adds the authority column where it is missing, the
-- row-level security policies and the application role's privileges, exactly as it did for the 188
-- and 203 tables.
DO $$
DECLARE r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    RAISE NOTICE 'no VUNGU authority here: the rates tables stay pending until converted by hand';
    FOREACH r IN ARRAY ARRAY['finance.property_category', 'finance.valuation_roll',
                             'finance.rates_tariff', 'finance.rates_account',
                             'finance.rates_billing_run', 'finance.rates_bill',
                             'finance.rates_receipt', 'finance.rates_billing_refusal'] LOOP
      PERFORM tenancy.classify(r, 'pending', 'rates data awaiting the authority it belongs to');
    END LOOP;
    RETURN;
  END IF;

  FOREACH r IN ARRAY ARRAY['finance.property_category', 'finance.valuation_roll',
                           'finance.rates_tariff', 'finance.rates_account',
                           'finance.rates_billing_run', 'finance.rates_bill',
                           'finance.rates_receipt', 'finance.rates_billing_refusal'] LOOP
    PERFORM tenancy.make_tenant(r::regclass, 'VUNGU');
  END LOOP;

  FOREACH r IN ARRAY ARRAY['finance.v_rates_arrears', 'finance.v_valuation_roll_current'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
      EXECUTE format('GRANT SELECT ON %s TO vungu_app', r);
    END IF;
    PERFORM tenancy.classify(r, 'tenant_view',
      'runs as the caller (security_invoker); the underlying policies decide the rows');
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 10. WHAT IS DELIBERATELY NOT SEEDED
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- No property category, no rateable value, no tariff, no rates account, no bill and no receipt.
--
-- This is the same position `finance.account` has held since migration 188 under decision D2, and
-- it is a finding rather than an omission:
--
--   D17  731 parcels exist in land.parcel and not one has a rateable value. The roll's source and
--        effective date are Council data. A billing run refuses a property with no value and says
--        which decision it is waiting on; it never bills nil.
--   D18  No rate in the dollar exists for any category or any year, and none is inferred from any
--        other figure in this database.
--   D19  spatial_planning.parcel_owner holds 0 rows. There is no ratepayer of record for any
--        parcel, so a rates account cannot be created for one, so rates billing cannot run at all.
--        This is the binding blocker and no amount of code removes it.
--
-- A billing run against this database today therefore considers 731 properties, raises 0 bills and
-- writes 731 refusals, every one of them waiting on D19. That is the correct output, and it is
-- the artefact the Council needs in order to see what populating the owner register would unblock.
--
-- `revenue_link.account_link` is left alone. It is the existing seam to Promun/Pastel and
-- `finance.rates_account.erp_account_no` carries the same number, so a migrated account keeps its
-- external identity for the parallel run of spec decision 3 without this migration writing to
-- another workstream's table.
