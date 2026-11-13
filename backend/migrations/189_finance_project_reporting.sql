-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 189 — Project reporting correctness (audit findings F-03 and F-04)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- TWO DEFECTS, ONE VIEW.
--
-- F-04. `finance.v_project_performance` grouped allocations by (project_id, currency), so a project
-- with both a USD and a ZWG allocation produced two rows with the same `project_id`. The spend
-- join then matched only the allocation's currency (`sp.currency = al.currency`), so spend in the
-- other currency disappeared without a trace. A duplicate project in a register is a visible
-- error; silently missing spend is a worse one.
--
-- The replacement returns EXACTLY ONE ROW PER PROJECT. Amounts are reported in the project's own
-- denomination (`finance.project.currency`), which is the currency its approved budget is stated
-- in. Allocations and spend in another currency are NOT converted and NOT added to that total:
-- they are returned separately as `other_currency_allocations` / `other_currency_spend` (a JSON
-- object keyed by currency) and counted in `allocation_currency_mismatch_rows` /
-- `actual_currency_mismatch_rows`. This mirrors the rule already used by
-- `finance.v_budget_line_performance`: a mismatched row is a data fault to surface, never a number
-- to quietly convert or drop.
--
-- F-03. `finance.project` has no financial-year column, so the public portal could not scope its
-- project panel to the selected year. A project's financial life is expressed by its allocations
-- and its associated transactions. The view now exposes `financial_year_ids`, the distinct years in
-- which the project has either an allocation or a linked transaction. The public API filters on that
-- array, so a project with no financial activity in the selected year is absent from that year's
-- panel rather than contradicting it.
--
-- WHY THE ALLOCATION CARRIES ITS YEAR. Deriving an allocation's year by joining
-- `finance.budget_line` works for staff, but the public role can only read a budget line after it
-- has been individually published. A project published through the projects dataset could therefore
-- lose the year of an allocation whose budget line was not also released — the project would vanish
-- from every year. `finance.project_allocation.financial_year_id` is populated from the line by a
-- trigger and protected by a composite foreign key, so the year is available wherever the
-- allocation itself is, and cannot disagree with the line it draws on.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── The year an allocation belongs to ──────────────────────────────────────────────────────────
ALTER TABLE finance.project_allocation
  ADD COLUMN IF NOT EXISTS financial_year_id uuid;

UPDATE finance.project_allocation a
   SET financial_year_id = l.financial_year_id
  FROM finance.budget_line l
 WHERE l.id = a.budget_line_id
   AND a.financial_year_id IS NULL;

-- The composite foreign key below needs a unique key to point at. `id` alone is already unique;
-- pairing it with the year lets the allocation's year be checked against the line's own year.
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_line_id_year
  ON finance.budget_line (id, financial_year_id);

CREATE OR REPLACE FUNCTION finance.set_project_allocation_year() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT l.financial_year_id INTO NEW.financial_year_id
    FROM finance.budget_line l
   WHERE l.id = NEW.budget_line_id;
  IF NEW.financial_year_id IS NULL THEN
    RAISE EXCEPTION 'project allocation % references a budget line with no financial year', NEW.id
      USING ERRCODE = '23502';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_project_allocation_year ON finance.project_allocation;
CREATE TRIGGER trg_project_allocation_year
  BEFORE INSERT OR UPDATE ON finance.project_allocation
  FOR EACH ROW EXECUTE FUNCTION finance.set_project_allocation_year();

ALTER TABLE finance.project_allocation
  ALTER COLUMN financial_year_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_allocation_line_year_fkey') THEN
    ALTER TABLE finance.project_allocation
      ADD CONSTRAINT project_allocation_line_year_fkey
      FOREIGN KEY (budget_line_id, financial_year_id)
      REFERENCES finance.budget_line (id, financial_year_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_allocation_year
  ON finance.project_allocation (financial_year_id);

DROP VIEW IF EXISTS finance.v_project_performance CASCADE;

CREATE VIEW finance.v_project_performance WITH (security_invoker = true) AS
WITH live_project AS (
  SELECT id, authority_id, reference, name, department_id, ward_code, status,
         linked_subject_kind, linked_subject_id, currency, approved_budget
    FROM finance.project
   WHERE deleted_at IS NULL
), alloc_by_currency AS (
  -- One row per (project, currency) BEFORE joining the project's denomination, so a mismatch can
  -- be measured rather than made to disappear through the join.
  SELECT a.project_id, a.currency,
         sum(a.amount) FILTER (WHERE a.allocation_type = 'original') AS original_amount,
         sum(a.amount) FILTER (WHERE a.allocation_type = 'revision') AS revision_amount
    FROM finance.project_allocation a
   WHERE a.deleted_at IS NULL
   GROUP BY a.project_id, a.currency
), alloc AS (
  SELECT abc.project_id,
         sum(abc.original_amount) FILTER (WHERE abc.currency = p.currency) AS allocated_original,
         sum(abc.revision_amount) FILTER (WHERE abc.currency = p.currency) AS allocated_revisions,
         count(*) FILTER (WHERE abc.currency <> p.currency)::int      AS allocation_currency_mismatch_rows,
         jsonb_object_agg(
           abc.currency,
           (COALESCE(abc.original_amount, 0) + COALESCE(abc.revision_amount, 0))::text
         ) FILTER (WHERE abc.currency <> p.currency)                  AS other_currency_allocations
    FROM alloc_by_currency abc
    JOIN live_project p ON p.id = abc.project_id
   GROUP BY abc.project_id
), alloc_years AS (
  -- The year is stored on the allocation (see the header), so this does not depend on the caller
  -- being able to read the budget line itself.
  SELECT a.project_id, array_agg(DISTINCT a.financial_year_id) AS financial_year_ids
    FROM finance.project_allocation a
   WHERE a.deleted_at IS NULL
   GROUP BY a.project_id
), spend_by_currency AS (
  SELECT pt.project_id, t.currency,
         sum(t.amount * pt.share)::finance.money AS actual_spend,
         count(*)::int AS transaction_rows,
         max(t.txn_date) AS last_transaction_date
    FROM finance.project_transaction pt
    JOIN finance.transaction t ON t.id = pt.transaction_id AND t.deleted_at IS NULL
   WHERE pt.deleted_at IS NULL
   GROUP BY pt.project_id, t.currency
), spend AS (
  SELECT sbc.project_id,
         sum(sbc.actual_spend) FILTER (WHERE sbc.currency = p.currency) AS actual_spend,
         sum(sbc.transaction_rows) FILTER (WHERE sbc.currency = p.currency)::int AS matched_transaction_rows,
         sum(sbc.transaction_rows)::int                               AS transaction_rows,
         max(sbc.last_transaction_date)                               AS last_transaction_date,
         count(*) FILTER (WHERE sbc.currency <> p.currency)::int      AS actual_currency_mismatch_rows,
         jsonb_object_agg(sbc.currency, sbc.actual_spend::text)
           FILTER (WHERE sbc.currency <> p.currency)                  AS other_currency_spend
    FROM spend_by_currency sbc
    JOIN live_project p ON p.id = sbc.project_id
   GROUP BY sbc.project_id
), spend_years AS (
  SELECT pt.project_id, array_agg(DISTINCT t.financial_year_id) AS financial_year_ids
    FROM finance.project_transaction pt
    JOIN finance.transaction t ON t.id = pt.transaction_id AND t.deleted_at IS NULL
   WHERE pt.deleted_at IS NULL
   GROUP BY pt.project_id
)
SELECT p.id                AS project_id,
       p.authority_id,
       p.reference,
       p.name,
       p.department_id,
       p.ward_code,
       p.status,
       p.linked_subject_kind,
       p.linked_subject_id,
       p.currency,
       p.approved_budget,
       COALESCE(al.allocated_original, 0)::finance.money  AS allocated_original,
       COALESCE(al.allocated_revisions, 0)::finance.money AS allocated_revisions,
       (COALESCE(al.allocated_original, 0) + COALESCE(al.allocated_revisions, 0))::finance.money AS allocated_total,
       COALESCE(sp.actual_spend, 0)::finance.money        AS actual_spend,
       (COALESCE(al.allocated_original, 0) + COALESCE(al.allocated_revisions, 0)
          - COALESCE(sp.actual_spend, 0))::finance.money  AS remaining_allocation,
       -- Undefined, not zero and not infinity, where nothing has been allocated (§6.1).
       CASE WHEN COALESCE(al.allocated_original, 0) + COALESCE(al.allocated_revisions, 0) = 0 THEN NULL
            ELSE round(COALESCE(sp.actual_spend, 0) * 100
                 / (COALESCE(al.allocated_original, 0) + COALESCE(al.allocated_revisions, 0)), 2)
       END AS execution_percentage,
       COALESCE(sp.transaction_rows, 0)::int        AS transaction_rows,
       COALESCE(sp.matched_transaction_rows, 0)::int AS matched_transaction_rows,
       sp.last_transaction_date,
       -- Explicit, per-currency amounts that are NOT part of the totals above, and their counts.
       COALESCE(al.other_currency_allocations, '{}'::jsonb) AS other_currency_allocations,
       COALESCE(sp.other_currency_spend, '{}'::jsonb)       AS other_currency_spend,
       COALESCE(al.allocation_currency_mismatch_rows, 0)::int AS allocation_currency_mismatch_rows,
       COALESCE(sp.actual_currency_mismatch_rows, 0)::int     AS actual_currency_mismatch_rows,
       -- F-03: the years in which this project has financial activity. Used by the public API to
       -- keep the project panel inside the selected reporting period.
       ARRAY(
         SELECT DISTINCT y
           FROM unnest(COALESCE(ay.financial_year_ids, '{}'::uuid[])
                       || COALESCE(sy.financial_year_ids, '{}'::uuid[])) AS u(y)
          ORDER BY y
       ) AS financial_year_ids
  FROM live_project p
  LEFT JOIN alloc al      ON al.project_id = p.id
  LEFT JOIN alloc_years ay ON ay.project_id = p.id
  LEFT JOIN spend sp      ON sp.project_id = p.id
  LEFT JOIN spend_years sy ON sy.project_id = p.id;

COMMENT ON VIEW finance.v_project_performance IS
  'One row per project (audit F-04). Amounts are in the project''s own currency; allocations and '
  'spend in another currency are returned as JSON objects and mismatch counts, never converted or '
  'added. `financial_year_ids` lists the years in which the project has an allocation or a linked '
  'transaction, so a caller can scope a project panel to a reporting period (audit F-03).';

-- A view recreated by DROP/CREATE is a new object: the grant and the tenancy classification that
-- migration 188 attached to the old one do not follow it. Re-apply both, or the application role
-- is refused (42501) the moment it reads a project.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT SELECT ON finance.v_project_performance TO vungu_app;
  END IF;
  PERFORM tenancy.classify('finance.v_project_performance', 'tenant_view',
    'runs as the caller (security_invoker); the underlying policies decide the rows');
END $$;
