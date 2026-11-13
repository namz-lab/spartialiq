-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 204. BUDGET PHASING PROFILES
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS
--
-- The management account (report `management_accounts`, src/routes/finance-reports.js) buckets
-- ACTUALS by reporting period and compares them with the ANNUAL revised allocation, because until
-- now nothing in this schema recorded when in the year a budget was expected to be spent.
-- `finance.budget_line` carries an amount and no date. That makes a monthly budget-versus-actual
-- variance — the figure a Director of Finance actually reads a management account for —
-- impossible: a line 40 % spent by October is on course if the work is scheduled for the first
-- half of the year and badly behind if it is scheduled for the last.
--
-- The alternative that was NOT taken is dividing the annual allocation by twelve. An even twelfth
-- is a plausible-looking number that no Council ever approved, and printing it under the heading
-- "budget" on a statutory return would be a fabrication of exactly the kind decision D4 forbids
-- for currency conversion. So phasing is RECORDED or it is ABSENT, and the report says which.
--
-- WHAT IS ADAPTED FROM ERPNEXT
--
-- ERPNext's `Monthly Distribution`
-- (~/Downloads/erpnext-develop/erpnext/accounts/doctype/monthly_distribution/) is a named profile
-- of percentage rows tied to a fiscal year, applied to a Budget through a link field, with a
-- `get_months()` helper that fills twelve equal rows and a `validate()` that refuses a profile
-- whose percentages do not total 100. `get_periodwise_distribution_data()` turns those rows into
-- one percentage per reporting period.
--
-- Three things are deliberately done differently:
--
-- 1. THE TOTAL IS ENFORCED BY THE DATABASE, NOT BY A MODEL. ERPNext's check is `validate()` in
--    Python, so a profile written by an import, a script or psql bypasses it. A profile that
--    totals 97 % silently under-states every phased budget it touches, and nothing on the report
--    would look wrong. Here it is a deferred constraint trigger: the INSERT can be attempted
--    directly against the database with the route bypassed and it still fails, at COMMIT.
--
-- 2. THE PERIOD KEYS ARE THE REPORT'S OWN PERIOD KEYS. ERPNext stores twelve named calendar
--    months and derives a quarter by matching month names. That assumes the twelve months of a
--    fiscal year are the twelve months of a calendar year. A Vungu financial year may run July to
--    June (migration 188, `finance.financial_year.start_date`), so the keys stored here are the
--    ordinal keys `periodList()` generates from the council's OWN year start — `m01` is the
--    first month of the council's year, and `q1` is Jul–Sep on a July–June year. The profile's
--    periods and the report's columns are then the same objects by construction.
--
-- 3. `distribute_equally` IS A RECORDED CHOICE, NOT A FLAG THAT SKIPS THE DATA. ERPNext's Budget
--    has a `distribute_equally` boolean that means "no profile, spread it". Here an even spread
--    is a profile like any other, with real rows that total 100 and `basis = 'distribute_equally'`
--    recording that the Council chose an even spread rather than a shaped one. The distinction
--    matters: "Council resolved to spread this evenly" and "nobody said" are different facts, and
--    the second one must not be rendered as the first.
--
-- THE RULE THE REPORT ENFORCES, WHICH IS THE POINT OF ALL OF THIS
--
-- `finance.budget_line.distribution_id` IS NULLABLE, AND NULL MEANS THE PHASING HAS NOT BEEN
-- RECORDED. The management account then reports that line's ANNUAL revised allocation, states that
-- its phasing is not recorded, and shows NO per-period budget and NO per-period variance for it.
-- It does not fall back to an even spread, and it does not carry a figure forward.
--
-- This is the same discipline as `finance.project.physical_progress_percent` under decision D12
-- (migration 202): NULL means no report was made; 0 means a report was made and the figure was
-- nil. It is also why `finance.account.expenditure_class` is never inferred from a code range
-- (decision D2).
--
-- WHAT THIS MIGRATION SEEDS: NOTHING.
--
-- No profile, not even an even one. Which lines are phased, on what profile, and whether an even
-- spread is an approved default are Council's to decide — raised as decision D20 in
-- docs/finance/COUNCIL-DECISIONS.md. Until Council decides, `finance.budget_distribution` is
-- empty, every budget line's `distribution_id` is NULL, and the management account behaves exactly
-- as it did before this migration: annual allocation, actuals by period, and a cover that says the
-- phasing is not recorded. An empty table telling the truth is the intended state.
--
-- Not added here: a route or a screen to create and assign a profile. Who may record a line's
-- phasing, and who approves it, is the open half of D20; seeding a permission now would answer it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. THE PROFILE ────────────────────────────────────────────────────────────────────────────
-- A named phasing profile belongs to one financial year. It cannot be shared across years: the
-- period keys are ordinals of a particular year's start date, and a year that is not twelve whole
-- months has a different number of them.
CREATE TABLE IF NOT EXISTS finance.budget_distribution (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  financial_year_id uuid NOT NULL REFERENCES finance.financial_year (id),
  name              text NOT NULL,

  -- The periodicity the profile is RECORDED at, and therefore the finest report it can phase.
  -- A quarterly profile cannot produce a monthly budget: splitting a quarter into three months
  -- would be inventing two figures nobody approved. The report refuses rather than divides.
  periodicity       text NOT NULL CHECK (periodicity IN ('monthly', 'quarterly', 'half_yearly', 'yearly')),

  -- Why the percentages are what they are. 'distribute_equally' records a deliberate Council
  -- choice of an even spread; it is NOT a flag that makes the code invent one. The rows are still
  -- real rows and still have to total 100.
  basis             text NOT NULL DEFAULT 'council_profile'
                      CHECK (basis IN ('council_profile', 'distribute_equally')),

  -- Only an 'active' profile phases anything, and only an 'active' profile is held to the
  -- total-100 rule: a draft is a profile being built and is allowed to be incomplete.
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'active', 'inactive')),

  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES public.users (id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  deleted_by        uuid REFERENCES public.users (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_distribution_name
  ON finance.budget_distribution (authority_id, financial_year_id, name)
  WHERE deleted_at IS NULL;

-- The composite target a budget line's foreign key points at, so the database — not a route —
-- refuses to attach a 2027 profile to a 2026 line. The same device as `uq_budget_line_id_year`
-- in migration 188.
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_distribution_id_year
  ON finance.budget_distribution (id, financial_year_id);

CREATE INDEX IF NOT EXISTS idx_budget_distribution_year
  ON finance.budget_distribution (financial_year_id) WHERE deleted_at IS NULL;

COMMENT ON TABLE finance.budget_distribution IS
  'A named profile saying how a budget line''s annual allocation is expected to fall across the '
  'financial year. Ships empty: which lines are phased and whether an even spread is approved is '
  'decision D20. A budget line with no profile is reported as "phasing not recorded", never as an '
  'even twelfth.';

-- ── 2. THE PERIODS ────────────────────────────────────────────────────────────────────────────
-- One row per reporting period of the profile's own periodicity, keyed by the key
-- src/lib/financePeriods.js generates for that period of this financial year.
CREATE TABLE IF NOT EXISTS finance.budget_distribution_period (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id    integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  distribution_id uuid NOT NULL REFERENCES finance.budget_distribution (id) ON DELETE CASCADE,

  -- 'm01'…'m12', 'q1'…'q4', 'h1', 'h2', 'y1'. The pattern is the same one
  -- financePeriods.assertPeriodKey() enforces before a key becomes a SQL alias; it is repeated
  -- here because a row written by psql never passes through that function.
  period_key      text NOT NULL CHECK (period_key ~ '^[mqhy][0-9]{1,3}$'),
  period_ordinal  integer NOT NULL CHECK (period_ordinal >= 1),

  -- A share of the annual allocation, in percent. NUMERIC, like every other figure in this
  -- schema: the phased budget is `revised_amount * percentage / 100` computed by Postgres, and no
  -- JavaScript float stands between the Council's allocation and the column it is printed in.
  percentage      numeric(9, 6) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.users (id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  deleted_by      uuid REFERENCES public.users (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_distribution_period_key
  ON finance.budget_distribution_period (distribution_id, period_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_distribution_period_ordinal
  ON finance.budget_distribution_period (distribution_id, period_ordinal);
CREATE INDEX IF NOT EXISTS idx_budget_distribution_period_parent
  ON finance.budget_distribution_period (distribution_id);

COMMENT ON COLUMN finance.budget_distribution_period.period_key IS
  'The key src/lib/financePeriods.js periodList() generates for this period of this financial '
  'year, counted from the council''s own year start. On a July-June year q1 is Jul-Sep.';

-- ── 3. THE LINK, AND THE NULL THAT MEANS "NOT RECORDED" ───────────────────────────────────────
ALTER TABLE finance.budget_line
  ADD COLUMN IF NOT EXISTS distribution_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budget_line_distribution_same_year'
  ) THEN
    -- Composite, so a profile from another financial year cannot be attached at all. The year is
    -- part of the key rather than something a route remembers to check.
    ALTER TABLE finance.budget_line
      ADD CONSTRAINT budget_line_distribution_same_year
      FOREIGN KEY (distribution_id, financial_year_id)
      REFERENCES finance.budget_distribution (id, financial_year_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_budget_line_distribution
  ON finance.budget_line (distribution_id) WHERE distribution_id IS NOT NULL;

COMMENT ON COLUMN finance.budget_line.distribution_id IS
  'The phasing profile for this line, or NULL meaning the phasing HAS NOT BEEN RECORDED. NULL is '
  'not an instruction to spread evenly: the management account reports the annual allocation and '
  'states that the phasing is not recorded. Same rule as project.physical_progress_percent (D12).';

-- ── 4. THE TOTAL-100 RULE, IN THE DATABASE ────────────────────────────────────────────────────
--
-- A profile summing to 97 is a DATA ERROR, not a presentational one: every line it phases would
-- quietly report 97 % of its own budget as its budget, and no column on the report would look
-- wrong. So the rule is a constraint trigger rather than a model validation.
--
-- DEFERRABLE INITIALLY DEFERRED, and this is essential rather than a nicety: a profile is built by
-- inserting twelve rows, and eleven of those twelve inserts leave the total below 100. The
-- assertion is made once, at COMMIT, over the finished profile — the same device migration 203
-- uses for a voucher's debits equalling its credits, and migration 200 for separation of duties.
--
-- It binds only an ACTIVE profile. A draft is allowed to be half-built; making it active is the
-- act that has to be answered for, and that UPDATE fires this trigger.
CREATE OR REPLACE FUNCTION finance.assert_budget_distribution_total() RETURNS trigger AS $$
DECLARE
  target  uuid;
  profile record;
  total   numeric;
  periods integer;
  wrong   integer;
  prefix  text;
BEGIN
  -- One function for both tables: the period rows name their parent, the parent names itself.
  IF TG_TABLE_NAME = 'budget_distribution' THEN
    target := COALESCE(NEW.id, OLD.id);
  ELSE
    target := COALESCE(NEW.distribution_id, OLD.distribution_id);
  END IF;

  SELECT d.* INTO profile FROM finance.budget_distribution d WHERE d.id = target;
  -- The profile itself was removed in this transaction. There is nothing left to be wrong.
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF profile.deleted_at IS NOT NULL OR profile.status <> 'active' THEN RETURN NULL; END IF;

  SELECT COALESCE(sum(p.percentage), 0), count(*)
    INTO total, periods
    FROM finance.budget_distribution_period p
   WHERE p.distribution_id = target AND p.deleted_at IS NULL;

  IF periods = 0 THEN
    RAISE EXCEPTION
      'budget distribution "%" is active and has no periods: an active profile must carry the periods it phases',
      profile.name USING ERRCODE = '23514';
  END IF;

  IF total <> 100 THEN
    RAISE EXCEPTION
      'budget distribution "%" is active and its % period percentages total %, not 100: a profile that does not total 100 would under- or over-state every budget line it phases',
      profile.name, periods, total USING ERRCODE = '23514';
  END IF;

  -- The keys must belong to the periodicity the profile declares, or the report would look for
  -- 'q1' on a profile that stored 'm01' and find a budget of nothing.
  prefix := CASE profile.periodicity
              WHEN 'monthly' THEN 'm' WHEN 'quarterly' THEN 'q'
              WHEN 'half_yearly' THEN 'h' ELSE 'y' END;
  SELECT count(*) INTO wrong
    FROM finance.budget_distribution_period p
   WHERE p.distribution_id = target AND p.deleted_at IS NULL
     AND left(p.period_key, 1) <> prefix;
  IF wrong > 0 THEN
    RAISE EXCEPTION
      'budget distribution "%" is % but % of its period keys do not begin with "%"',
      profile.name, profile.periodicity, wrong, prefix USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_budget_distribution_period_total ON finance.budget_distribution_period;
CREATE CONSTRAINT TRIGGER trg_budget_distribution_period_total
  AFTER INSERT OR UPDATE OR DELETE ON finance.budget_distribution_period
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION finance.assert_budget_distribution_total();

DROP TRIGGER IF EXISTS trg_budget_distribution_total ON finance.budget_distribution;
CREATE CONSTRAINT TRIGGER trg_budget_distribution_total
  AFTER INSERT OR UPDATE ON finance.budget_distribution
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION finance.assert_budget_distribution_total();

-- The standard updated_at touch, as migration 188 applies to every finance table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget_distribution', 'budget_distribution_period'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_touch ON finance.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON finance.%I
                      FOR EACH ROW EXECUTE FUNCTION finance.touch_updated_at()', t, t);
  END LOOP;
END $$;

-- ── 5. A READING AID ──────────────────────────────────────────────────────────────────────────
-- One row per profile with its keys and its total, so a reader — and the report, which uses this
-- to decide whether a profile may be honoured — can see at a glance which profiles are usable and
-- which are drafts. It computes no money.
--
-- THE TWO AGGREGATES ARE COMPUTED SEPARATELY, AND THAT IS NOT A STYLE CHOICE. Joining the period
-- rows and the budget lines in one FROM multiplies them: a profile with four periods used by two
-- budget lines produces eight rows, `sum(percentage)` reports 200 rather than 100, and
-- `array_agg(period_key)` reports every key twice. The report compares that key list against the
-- financial year's own keys to decide whether a profile fits the year, so the fan-out made a
-- perfectly good profile fail that comparison AS SOON AS A SECOND LINE USED IT — the phasing
-- silently stopped applying at the moment it became worth having. Caught by
-- test/finance-budget-phasing.test.js, which seeds exactly that shape.
DROP VIEW IF EXISTS finance.v_budget_distribution_summary CASCADE;
CREATE VIEW finance.v_budget_distribution_summary WITH (security_invoker = true) AS
SELECT d.id                AS distribution_id,
       d.authority_id,
       d.financial_year_id,
       d.name,
       d.periodicity,
       d.basis,
       d.status,
       p.period_count,
       p.total_percentage,
       p.period_keys,
       (SELECT count(*)::int FROM finance.budget_line bl
         WHERE bl.distribution_id = d.id AND bl.deleted_at IS NULL) AS budget_lines_using
  FROM finance.budget_distribution d
  LEFT JOIN LATERAL (
    SELECT count(*)::int                  AS period_count,
           COALESCE(sum(x.percentage), 0) AS total_percentage,
           array_agg(x.period_key ORDER BY x.period_ordinal) AS period_keys
      FROM finance.budget_distribution_period x
     WHERE x.distribution_id = d.id AND x.deleted_at IS NULL
  ) p ON true
 WHERE d.deleted_at IS NULL;

COMMENT ON VIEW finance.v_budget_distribution_summary IS
  'Which phasing profiles exist, whether they total 100, and how many budget lines use each. '
  'Empty until Council decides D20.';

-- ── 6. TENANCY AND GRANTS ─────────────────────────────────────────────────────────────────────
-- tenancy.make_tenant() (migration 167) attaches the row-level security policies and the
-- application role's privileges, exactly as migrations 188 and 203 do for their tables.
DO $$
DECLARE r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    RAISE NOTICE 'no VUNGU authority here: the phasing tables stay pending until converted by hand';
    FOREACH r IN ARRAY ARRAY['finance.budget_distribution', 'finance.budget_distribution_period'] LOOP
      PERFORM tenancy.classify(r, 'pending', 'budget phasing awaiting the authority it belongs to');
    END LOOP;
    RETURN;
  END IF;

  FOREACH r IN ARRAY ARRAY['finance.budget_distribution', 'finance.budget_distribution_period'] LOOP
    PERFORM tenancy.make_tenant(r::regclass, 'VUNGU');
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT SELECT ON finance.v_budget_distribution_summary TO vungu_app;
  END IF;
  PERFORM tenancy.classify('finance.v_budget_distribution_summary', 'tenant_view',
    'runs as the caller (security_invoker); the underlying policies decide the rows');
END $$;

COMMIT;
