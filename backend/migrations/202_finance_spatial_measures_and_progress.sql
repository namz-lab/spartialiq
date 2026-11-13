-- 202_finance_spatial_measures_and_progress.sql
--
-- The SQL half of GIS–finance milestones M4 (revenue/expenditure mapping), M5 (projects and the
-- capital map) and M7 (public transparency map), plus the three spatial-integrity MAJORs the
-- production-readiness audit assigned to the database. Specified task-by-task in
-- docs/gis-finance/SPATIAL-VISUALISATION-GAPS.md §4 (frontend repository).
--
--   §1  D12  finance.project.physical_progress_percent + progress evidence, and the configurable
--            spend-versus-progress threshold in the existing finance.setting pattern. NULLABLE and
--            honest: a project with no recorded progress shows "not recorded", never 0 %, and its
--            exception flag is NULL, never false.
--   §2  M4-1 finance.v_budget_ward_attribution gains the missing dimensions (programme, activity,
--            account) and measures (adjustments, actuals, available ±, variance) — on the
--            whole-line branches only. Re-splitting an adjustment or an available balance across
--            targets without a recorded methodology is the assumption §6.1 rule 7 forbids.
--   §3  M4-2 finance.v_ward_performance completes the thirteen-field ward panel, and M4-5 adds the
--            ALTERNATIVE actuals basis (attribution by the budget line's geography) as its own
--            columns beside the existing transaction-ward-code ones. Both bases are legitimate;
--            neither is silently chosen for the reader.
--   §4  M4-3 finance.v_ward_dimension_performance — the department / programme / account-kind
--            breakdown, so "expenditure by department" is a rendering and not a client-side
--            group-by.
--   §5  M5/D12 finance.v_project_performance carries the progress field, the gap in percentage
--            points and the exception flag.
--   §6  MAJOR-8  finance.spatial_allocation joins the closed-year trigger set, with the subject
--            resolution a polymorphic subject needs (budget line → its year; project → the years
--            of its funding allocations).
--   §7  MAJOR-1  an approved reduction revision is re-validated against approved spatial
--            allocations. DECISION: the reduction is REFUSED, naming the splits to withdraw
--            first. Justification in §7's header.
--
-- Idempotent throughout: ADD COLUMN IF NOT EXISTS, DO-guarded constraints, CREATE OR REPLACE
-- FUNCTION, DROP VIEW IF EXISTS … CASCADE before CREATE VIEW, ON CONFLICT upserts.
--
-- NO FIGURE IS SEEDED. The only data written is one behaviour setting per existing council (a
-- threshold, like migration 188's overspend thresholds). No budget line, transaction, project or
-- ward code on a finance row is created here.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. D12 — PHYSICAL PROGRESS ON A PROJECT, AND THE THRESHOLD THAT MAKES IT AN EXCEPTION
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The owner direction of 2026-11-09 approves the field for build; WHO records it and HOW OFTEN
-- remains a Council/management matter, so the column is nullable and nothing defaults it. The
-- distinction that matters for every surface downstream:
--
--     physical_progress_percent IS NULL  →  "not recorded"      (and spend_ahead_of_progress NULL)
--     physical_progress_percent = 0      →  "nothing built yet"  (a recorded fact)
--
-- `progress_recorded_at` / `progress_recorded_by` are here for the same reason: a progress figure
-- whose age nobody knows is a decorative number, which is exactly what decision D12 warns against.
-- The audit event carries the change; these two carry the currency of the figure on the row a
-- report reads six months later.

ALTER TABLE finance.project
  ADD COLUMN IF NOT EXISTS physical_progress_percent     numeric(5,2),
  ADD COLUMN IF NOT EXISTS progress_evidence_document_id uuid,
  ADD COLUMN IF NOT EXISTS progress_recorded_at          timestamptz,
  ADD COLUMN IF NOT EXISTS progress_recorded_by          uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'finance.project'::regclass
                    AND conname = 'project_physical_progress_range') THEN
    ALTER TABLE finance.project ADD CONSTRAINT project_physical_progress_range
      CHECK (physical_progress_percent IS NULL
             OR (physical_progress_percent >= 0 AND physical_progress_percent <= 100));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'finance.project'::regclass
                    AND conname = 'project_progress_evidence_fk') THEN
    ALTER TABLE finance.project ADD CONSTRAINT project_progress_evidence_fk
      FOREIGN KEY (progress_evidence_document_id) REFERENCES finance.document (id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'finance.project'::regclass
                    AND conname = 'project_progress_recorded_by_fk') THEN
    ALTER TABLE finance.project ADD CONSTRAINT project_progress_recorded_by_fk
      FOREIGN KEY (progress_recorded_by) REFERENCES public.users (id);
  END IF;

  -- Evidence of a progress figure that was never recorded is not evidence of anything.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'finance.project'::regclass
                    AND conname = 'project_progress_evidence_needs_progress') THEN
    ALTER TABLE finance.project ADD CONSTRAINT project_progress_evidence_needs_progress
      CHECK (progress_evidence_document_id IS NULL OR physical_progress_percent IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN finance.project.physical_progress_percent IS
  'Physical completion, 0–100, as recorded by the responsible officer (decision D12). NULL means '
  'NOT RECORDED and must be rendered as such — never as 0 %. Nothing in this system derives it: '
  'elapsed schedule is not physical progress (assessment §10 conflict 2).';
COMMENT ON COLUMN finance.project.progress_evidence_document_id IS
  'The progress report that supports physical_progress_percent. Required by procedure, not by the '
  'schema: a council that records a figure before filing the report must still be able to record it.';
COMMENT ON COLUMN finance.project.progress_recorded_at IS
  'When the physical progress figure on this row was last stated. A figure whose age is unknown '
  'cannot be compared with financial execution honestly.';

-- The exception threshold, as CONFIGURATION in the pattern migration 188 §12 established for
-- overspend.warn_execution_percentage. Units: PERCENTAGE POINTS of financial execution above
-- physical progress. 15 is a starting point a finance administrator edits, not a rule.
--
-- A council with no row gets a NULL threshold, and the exception flag is then NULL — "cannot be
-- evaluated" — rather than false. There is no hard-coded fallback anywhere in the view or the
-- routes, deliberately: a silent default would make the flag look evaluated when nobody had set
-- the policy it depends on.
INSERT INTO finance.setting (authority_id, key, value)
SELECT la.id, 'project.spend_ahead_of_progress_points', '15'::jsonb
  FROM public.local_authorities la
 WHERE la.kind IS DISTINCT FROM 'combination'
ON CONFLICT (authority_id, key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. M4-1 — BUDGET ATTRIBUTION GAINS THE MISSING DIMENSIONS AND MEASURES
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Migration 199's view carried nine dimensions and three measures. The ward panel needs five more
-- measures and the department/programme breakdown needs three more dimensions. Everything added is
-- read straight from finance.v_budget_line_performance — this view still computes nothing.
--
-- WHICH BRANCHES CARRY WHICH MEASURE, AND WHY:
--   * line_ward_code / unlocated  — the whole line attributes to one place, so EVERY measure of
--     that line is that place's measure. All of them are carried.
--   * spatial_allocation          — the recorded, approved amount is the only thing a methodology
--     covered. original, adjustments, actuals, available and variance stay NULL exactly as
--     original_amount and open_commitments already did (199:48-59). Splitting an adjustment or an
--     available balance pro rata would be the system inventing an attribution nobody approved.
--   * unallocated_remainder       — a residue, not a line. Only the residual amount is defined.
--
-- NEW: `attribution_exception`. Migration 199 computes the remainder as a bare subtraction, so a
-- reduction revision applied after a split was approved produced a NEGATIVE remainder and nothing
-- said so. §7 below refuses that reduction, but legacy rows may already carry it, and GREATEST(…,0)
-- would hide the fault. It is reported as an exception on the row instead.

DROP VIEW IF EXISTS finance.v_budget_ward_attribution CASCADE;
CREATE VIEW finance.v_budget_ward_attribution WITH (security_invoker = true) AS
WITH approved AS (
  SELECT sa.subject_id AS budget_line_id,
         sa.target_code AS ward_code,
         sum(sa.amount)::finance.money AS allocated_amount,
         count(*)::int AS allocation_rows
    FROM finance.spatial_allocation sa
   WHERE sa.subject_kind = 'budget_line' AND sa.status = 'approved' AND sa.deleted_at IS NULL
   GROUP BY sa.subject_id, sa.target_code
), split_total AS (
  SELECT budget_line_id, sum(allocated_amount)::finance.money AS split_total
    FROM approved GROUP BY budget_line_id
)
-- Split lines: one row per recorded target.
SELECT p.budget_line_id, p.authority_id, p.financial_year_id, p.department_id,
       p.programme_id, p.activity_id, p.account_id,
       p.currency, p.account_kind, approved.ward_code,
       'spatial_allocation'::text AS basis,
       NULL::finance.money AS original_amount,
       NULL::finance.money AS approved_adjustments,
       approved.allocated_amount AS budget_amount,
       NULL::finance.money AS actual_amount,
       NULL::finance.money AS open_commitments,
       NULL::finance.money AS available_excluding_commitments,
       NULL::finance.money AS available_including_commitments,
       NULL::finance.money AS variance,
       approved.allocation_rows,
       NULL::text AS attribution_exception
  FROM finance.v_budget_line_performance p
  JOIN split_total USING (budget_line_id)
  JOIN approved USING (budget_line_id)
UNION ALL
-- Unsplit lines: the whole line to its own ward code, or to the unlocated bucket.
SELECT p.budget_line_id, p.authority_id, p.financial_year_id, p.department_id,
       p.programme_id, p.activity_id, p.account_id,
       p.currency, p.account_kind, p.ward_code,
       CASE WHEN p.ward_code IS NULL THEN 'unlocated' ELSE 'line_ward_code' END,
       p.original_amount,
       p.approved_adjustments,
       p.revised_amount,
       p.actual_amount,
       p.open_commitments,
       p.available_excluding_commitments,
       p.available_including_commitments,
       p.variance,
       0::int,
       NULL::text
  FROM finance.v_budget_line_performance p
  LEFT JOIN split_total USING (budget_line_id)
 WHERE split_total.budget_line_id IS NULL
UNION ALL
-- Split lines: the recorded remainder that no methodology has attributed yet.
SELECT p.budget_line_id, p.authority_id, p.financial_year_id, p.department_id,
       p.programme_id, p.activity_id, p.account_id,
       p.currency, p.account_kind, NULL,
       'unallocated_remainder',
       NULL::finance.money,
       NULL::finance.money,
       (p.revised_amount - split_total.split_total)::finance.money,
       NULL::finance.money,
       NULL::finance.money,
       NULL::finance.money,
       NULL::finance.money,
       NULL::finance.money,
       0::int,
       CASE WHEN p.revised_amount - split_total.split_total < 0
            THEN 'split_exceeds_revised' END
  FROM finance.v_budget_line_performance p
  JOIN split_total USING (budget_line_id);

COMMENT ON VIEW finance.v_budget_ward_attribution IS
  'Budget geography, one row per attribution: spatial_allocation rows for split lines (with an '
  'unallocated_remainder row for what no methodology covered), whole-line attribution via '
  'ward_code otherwise, and an unlocated row for lines with no geography at all. All-or-nothing '
  'per line: a split line never also attributes through its ward_code. original_amount, '
  'approved_adjustments, actual_amount, available_* and variance are NULL on split and remainder '
  'rows BY DESIGN — only the recorded allocation amount was approved, and re-splitting the rest '
  'pro rata would be an attribution nobody authorised. attribution_exception reports a remainder '
  'that has gone negative (approved splits exceeding a reduced revised amount) instead of '
  'clamping it to zero.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3. M4-2 / M4-5 — WARD PERFORMANCE COMPLETES THE PANEL AND NAMES BOTH ACTUALS BASES
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- TWO ATTRIBUTION BASES, BOTH RETURNED, NEITHER CHOSEN FOR THE READER (audit M4-5 / MAJOR-4).
--
--   expenditure_actual / revenue_actual                — the TRANSACTION's own ward_code. A payment
--     happened where it happened. Unaffected by how the budget was attributed.
--   expenditure_actual_via_line / revenue_actual_via_line — the BUDGET LINE's geography. The spend
--     of a ward-tagged line counts for that ward even when the transaction carries no ward code.
--
-- Neither is wrong and they do not generally agree. A ward panel that showed one without naming it
-- would present a numerator and a denominator attributed by different rules as one "execution %"
-- (assessment §10 conflict 3). The endpoints echo `actuals_basis`; the views supply both.
--
-- The *_via_line columns are NULL on any ward whose budget came even partly through an approved
-- split, because the split branch records no actuals (§2 above). That is the honest answer: the
-- alternative basis is not available for a split line without a second, unapproved assumption.
--
-- COMPLETE-OR-NULL. The measures added here are NULL unless EVERY contributing row of that account
-- kind carries them. A ward with one split line and one whole line would otherwise report the whole
-- line's variance as the ward's variance — a partial figure wearing a total's label. The columns
-- migration 199 already published (revenue_budget, expenditure_budget, open_commitments) keep their
-- existing sum-ignoring-NULL behaviour unchanged, so nothing already on screen moves.

DROP VIEW IF EXISTS finance.v_ward_performance CASCADE;
CREATE VIEW finance.v_ward_performance WITH (security_invoker = true) AS
WITH budget AS (
  SELECT b.authority_id, b.financial_year_id, b.currency,
         b.ward_code,
         -- Only the geography-less rows keep their reason; ward rows merge across bases.
         CASE WHEN b.ward_code IS NULL THEN b.basis ELSE NULL END AS unlocated_reason,
         (sum(b.budget_amount) FILTER (WHERE b.account_kind = 'revenue'))::finance.money
           AS revenue_budget,
         (sum(b.budget_amount) FILTER (WHERE b.account_kind = 'expenditure'))::finance.money
           AS expenditure_budget,
         (sum(b.open_commitments))::finance.money AS open_commitments,
         count(*) FILTER (WHERE b.basis = 'line_ward_code')::int AS attributed_lines,
         count(*) FILTER (WHERE b.basis = 'spatial_allocation')::int AS allocation_rows,

         -- M4-2: original and approved adjustments, per account kind, complete-or-NULL.
         CASE WHEN count(*) FILTER (WHERE b.account_kind = 'revenue') > 0
               AND count(*) FILTER (WHERE b.account_kind = 'revenue'
                                      AND b.original_amount IS NULL) = 0
              THEN (sum(b.original_amount) FILTER (WHERE b.account_kind = 'revenue'))::finance.money
         END AS original_revenue,
         CASE WHEN count(*) FILTER (WHERE b.account_kind = 'expenditure') > 0
               AND count(*) FILTER (WHERE b.account_kind = 'expenditure'
                                      AND b.original_amount IS NULL) = 0
              THEN (sum(b.original_amount) FILTER (WHERE b.account_kind = 'expenditure'))::finance.money
         END AS original_expenditure,
         CASE WHEN count(*) FILTER (WHERE b.account_kind = 'revenue') > 0
               AND count(*) FILTER (WHERE b.account_kind = 'revenue'
                                      AND b.approved_adjustments IS NULL) = 0
              THEN (sum(b.approved_adjustments) FILTER (WHERE b.account_kind = 'revenue'))::finance.money
         END AS adjustments_revenue,
         CASE WHEN count(*) FILTER (WHERE b.account_kind = 'expenditure') > 0
               AND count(*) FILTER (WHERE b.account_kind = 'expenditure'
                                      AND b.approved_adjustments IS NULL) = 0
              THEN (sum(b.approved_adjustments) FILTER (WHERE b.account_kind = 'expenditure'))::finance.money
         END AS adjustments_expenditure,

         -- M4-2: the two available-balance definitions, for the EXPENDITURE vote (the one the
         -- panel's "available ±" field is about). Revenue's analogue is revenue_variance.
         CASE WHEN count(*) FILTER (WHERE b.account_kind = 'expenditure') > 0
               AND count(*) FILTER (WHERE b.account_kind = 'expenditure'
                                      AND b.available_excluding_commitments IS NULL) = 0
              THEN (sum(b.available_excluding_commitments)
                      FILTER (WHERE b.account_kind = 'expenditure'))::finance.money
         END AS available_excluding_commitments,
         CASE WHEN count(*) FILTER (WHERE b.account_kind = 'expenditure') > 0
               AND count(*) FILTER (WHERE b.account_kind = 'expenditure'
                                      AND b.available_including_commitments IS NULL) = 0
              THEN (sum(b.available_including_commitments)
                      FILTER (WHERE b.account_kind = 'expenditure'))::finance.money
         END AS available_including_commitments,

         -- M4-2: expenditure variance, taken from the canonical view's own `variance` so the sign
         -- convention (§6.3: revised − actual for expenditure) cannot drift from the consoles.
         CASE WHEN count(*) FILTER (WHERE b.account_kind = 'expenditure') > 0
               AND count(*) FILTER (WHERE b.account_kind = 'expenditure'
                                      AND b.variance IS NULL) = 0
              THEN (sum(b.variance) FILTER (WHERE b.account_kind = 'expenditure'))::finance.money
         END AS expenditure_variance,

         -- M4-5: the ALTERNATIVE actuals basis — attribution by the budget line's geography.
         CASE WHEN count(*) FILTER (WHERE b.account_kind = 'revenue') > 0
               AND count(*) FILTER (WHERE b.account_kind = 'revenue'
                                      AND b.actual_amount IS NULL) = 0
              THEN (sum(b.actual_amount) FILTER (WHERE b.account_kind = 'revenue'))::finance.money
         END AS revenue_actual_via_line,
         CASE WHEN count(*) FILTER (WHERE b.account_kind = 'expenditure') > 0
               AND count(*) FILTER (WHERE b.account_kind = 'expenditure'
                                      AND b.actual_amount IS NULL) = 0
              THEN (sum(b.actual_amount) FILTER (WHERE b.account_kind = 'expenditure'))::finance.money
         END AS expenditure_actual_via_line,

         -- M4-2: how much of this cell's money is attributed by an approved split versus still
         -- unattributed, as AMOUNTS — so the panel states it instead of the user inferring it
         -- from two counts.
         (sum(b.budget_amount) FILTER (WHERE b.basis = 'spatial_allocation'))::finance.money
           AS split_coverage_amount,
         (sum(b.budget_amount) FILTER (WHERE b.basis = 'unallocated_remainder'))::finance.money
           AS unallocated_remainder_amount,
         count(*) FILTER (WHERE b.attribution_exception IS NOT NULL)::int
           AS attribution_exception_rows
    FROM finance.v_budget_ward_attribution b
   GROUP BY 1, 2, 3, 4, 5
), actuals AS (
  SELECT t.authority_id, t.financial_year_id, t.currency,
         NULLIF(btrim(t.ward_code), '') AS ward_code,
         sum(t.amount) FILTER (WHERE a.kind = 'revenue')::finance.money AS revenue_actual,
         sum(t.amount) FILTER (WHERE a.kind = 'expenditure')::finance.money AS expenditure_actual,
         count(*)::int AS transaction_rows
    FROM finance.transaction t
    JOIN finance.account a ON a.id = t.account_id
   WHERE t.deleted_at IS NULL
   GROUP BY 1, 2, 3, 4
), cells AS (
  SELECT authority_id, financial_year_id, currency, ward_code, unlocated_reason FROM budget
  UNION
  -- Ward-less actuals belong to the 'unlocated' bucket, never to 'unallocated_remainder':
  -- a remainder is unattributed BUDGET, while an actual without a ward code happened somewhere
  -- the register simply does not record.
  SELECT authority_id, financial_year_id, currency, ward_code,
         CASE WHEN ward_code IS NULL THEN 'unlocated' END
    FROM actuals
)
SELECT c.authority_id, c.financial_year_id, c.currency, c.ward_code, c.unlocated_reason,
       CASE
         WHEN c.ward_code IS NULL THEN NULL
         WHEN EXISTS (SELECT 1 FROM admin.authority_ward aw
                       WHERE aw.authority_id = c.authority_id
                         AND aw.ward_code = c.ward_code
                         AND aw.valid_to IS NULL) THEN 'linked'
         ELSE 'unlinked'
       END AS ward_status,
       -- The provisional-register signal (decision D11): a surface that names a ward must be able
       -- to say the membership is interim rather than resolved by a Council instrument.
       (SELECT aw.basis FROM admin.authority_ward aw
         WHERE aw.authority_id = c.authority_id AND aw.ward_code = c.ward_code
           AND aw.valid_to IS NULL
         ORDER BY aw.valid_from DESC LIMIT 1) AS ward_register_basis,
       b.original_revenue,
       b.adjustments_revenue,
       b.revenue_budget,
       a.revenue_actual,
       b.revenue_actual_via_line,
       CASE WHEN b.revenue_budget IS NULL THEN NULL
            ELSE (coalesce(a.revenue_actual, 0) - b.revenue_budget)::finance.money
       END AS revenue_variance,
       -- Same NULL guard as the expenditure execution percentage: NULL where there is no revenue
       -- budget, 0.00 where there is a budget and nothing has been collected.
       CASE WHEN b.revenue_budget IS NULL OR b.revenue_budget = 0 THEN NULL
            ELSE round(coalesce(a.revenue_actual, 0) * 100 / b.revenue_budget, 2)
       END AS revenue_collection_percentage,
       b.original_expenditure,
       b.adjustments_expenditure,
       b.expenditure_budget,
       a.expenditure_actual,
       b.expenditure_actual_via_line,
       b.open_commitments,
       b.available_excluding_commitments,
       b.available_including_commitments,
       b.expenditure_variance,
       CASE WHEN b.expenditure_budget IS NULL OR b.expenditure_budget = 0 THEN NULL
            ELSE round(coalesce(a.expenditure_actual, 0) * 100 / b.expenditure_budget, 2)
       END AS expenditure_execution_percentage,
       b.split_coverage_amount,
       b.unallocated_remainder_amount,
       coalesce(b.attribution_exception_rows, 0)::int AS attribution_exception_rows,
       coalesce(b.attributed_lines, 0)::int AS attributed_lines,
       coalesce(b.allocation_rows, 0)::int AS allocation_rows,
       coalesce(a.transaction_rows, 0)::int AS transaction_rows
  FROM cells c
  LEFT JOIN budget b
         ON b.authority_id = c.authority_id AND b.financial_year_id = c.financial_year_id
        AND b.currency = c.currency
        AND b.ward_code IS NOT DISTINCT FROM c.ward_code
        AND b.unlocated_reason IS NOT DISTINCT FROM c.unlocated_reason
  LEFT JOIN actuals a
         ON a.authority_id = c.authority_id AND a.financial_year_id = c.financial_year_id
        AND a.currency = c.currency
        AND a.ward_code IS NOT DISTINCT FROM c.ward_code
        AND (c.ward_code IS NOT NULL OR coalesce(c.unlocated_reason, 'unlocated') = 'unlocated');

COMMENT ON VIEW finance.v_ward_performance IS
  'Ward-level finance per (council, financial year, currency); the geography-less rows carry '
  'unlocated_reason instead. Budget figures come from v_budget_ward_attribution. ACTUALS ARE '
  'RETURNED ON TWO BASES and the caller must state which it shows: expenditure_actual / '
  'revenue_actual are attributed by the TRANSACTION''s own ward_code, while '
  'expenditure_actual_via_line / revenue_actual_via_line are attributed by the BUDGET LINE''s '
  'geography (NULL wherever an approved split means the line has no single geography). '
  'available_excluding_commitments / available_including_commitments are the EXPENDITURE vote''s '
  'two definitions. Measures added in migration 202 are complete-or-NULL: NULL unless every '
  'contributing row of that account kind carries them, so a partial figure is never labelled as a '
  'total. Amounts are in their own currency, never converted and never summed across currencies. '
  'ward_status reports linkage to admin.authority_ward and ward_register_basis reports on what '
  'authority (''interim'' = provisional, decision D11 still open). Project measures are '
  'intentionally absent — they span years and reach the map through /api/finance/map/projects.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4. M4-3 — THE DEPARTMENT / PROGRAMME BREAKDOWN, PER WARD
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- One row per (council, year, currency, ward | unlocated reason, department, programme, account
-- kind). This is what makes "expenditure by department" on the map a RENDERING: the client must
-- not group rows itself, and the department scope a dept_head is confined to is applied as a
-- predicate on department_id here rather than as arithmetic anywhere else.
--
-- Σ over every department/programme/account-kind row of one (ward, year, currency) equals the
-- matching finance.v_ward_performance row exactly, for both the budget and the actuals. The
-- assertion at the end of this migration is not able to prove that over empty data, so the suite
-- does it (src/routes/__tests__/finance.spatial-map.test.js).

DROP VIEW IF EXISTS finance.v_ward_dimension_performance CASCADE;
CREATE VIEW finance.v_ward_dimension_performance WITH (security_invoker = true) AS
WITH budget AS (
  SELECT b.authority_id, b.financial_year_id, b.currency, b.ward_code,
         CASE WHEN b.ward_code IS NULL THEN b.basis ELSE NULL END AS unlocated_reason,
         b.department_id, b.programme_id, b.account_kind,
         (sum(b.budget_amount))::finance.money AS budget_amount,
         (sum(b.open_commitments))::finance.money AS open_commitments,
         CASE WHEN count(*) FILTER (WHERE b.original_amount IS NULL) = 0
              THEN (sum(b.original_amount))::finance.money END AS original_amount,
         CASE WHEN count(*) FILTER (WHERE b.approved_adjustments IS NULL) = 0
              THEN (sum(b.approved_adjustments))::finance.money END AS approved_adjustments,
         CASE WHEN count(*) FILTER (WHERE b.actual_amount IS NULL) = 0
              THEN (sum(b.actual_amount))::finance.money END AS actual_amount_via_line,
         CASE WHEN count(*) FILTER (WHERE b.available_excluding_commitments IS NULL) = 0
              THEN (sum(b.available_excluding_commitments))::finance.money
         END AS available_excluding_commitments,
         CASE WHEN count(*) FILTER (WHERE b.available_including_commitments IS NULL) = 0
              THEN (sum(b.available_including_commitments))::finance.money
         END AS available_including_commitments,
         CASE WHEN count(*) FILTER (WHERE b.variance IS NULL) = 0
              THEN (sum(b.variance))::finance.money END AS variance,
         (sum(b.budget_amount) FILTER (WHERE b.basis = 'spatial_allocation'))::finance.money
           AS split_coverage_amount,
         (sum(b.budget_amount) FILTER (WHERE b.basis = 'unallocated_remainder'))::finance.money
           AS unallocated_remainder_amount,
         count(*) FILTER (WHERE b.attribution_exception IS NOT NULL)::int
           AS attribution_exception_rows,
         count(*) FILTER (WHERE b.basis = 'line_ward_code')::int AS attributed_lines,
         count(*) FILTER (WHERE b.basis = 'spatial_allocation')::int AS allocation_rows
    FROM finance.v_budget_ward_attribution b
   GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
), actuals AS (
  -- The transaction's own ward code and department; its programme comes from the line it posts
  -- to, which is the only place a programme is recorded (a transaction with no line has none).
  SELECT t.authority_id, t.financial_year_id, t.currency,
         NULLIF(btrim(t.ward_code), '') AS ward_code,
         t.department_id, l.programme_id, a.kind AS account_kind,
         (sum(t.amount))::finance.money AS actual_amount,
         count(*)::int AS transaction_rows
    FROM finance.transaction t
    JOIN finance.account a ON a.id = t.account_id
    LEFT JOIN finance.budget_line l ON l.id = t.budget_line_id AND l.deleted_at IS NULL
   WHERE t.deleted_at IS NULL
   GROUP BY 1, 2, 3, 4, 5, 6, 7
), cells AS (
  SELECT authority_id, financial_year_id, currency, ward_code, unlocated_reason,
         department_id, programme_id, account_kind FROM budget
  UNION
  SELECT authority_id, financial_year_id, currency, ward_code,
         CASE WHEN ward_code IS NULL THEN 'unlocated' END,
         department_id, programme_id, account_kind FROM actuals
)
SELECT c.authority_id, c.financial_year_id, c.currency, c.ward_code, c.unlocated_reason,
       c.department_id, c.programme_id, c.account_kind,
       CASE
         WHEN c.ward_code IS NULL THEN NULL
         WHEN EXISTS (SELECT 1 FROM admin.authority_ward aw
                       WHERE aw.authority_id = c.authority_id
                         AND aw.ward_code = c.ward_code
                         AND aw.valid_to IS NULL) THEN 'linked'
         ELSE 'unlinked'
       END AS ward_status,
       b.original_amount,
       b.approved_adjustments,
       b.budget_amount,
       a.actual_amount,
       b.actual_amount_via_line,
       b.open_commitments,
       b.available_excluding_commitments,
       b.available_including_commitments,
       b.variance,
       CASE WHEN b.budget_amount IS NULL OR b.budget_amount = 0 THEN NULL
            ELSE round(coalesce(a.actual_amount, 0) * 100 / b.budget_amount, 2)
       END AS execution_percentage,
       b.split_coverage_amount,
       b.unallocated_remainder_amount,
       coalesce(b.attribution_exception_rows, 0)::int AS attribution_exception_rows,
       coalesce(b.attributed_lines, 0)::int AS attributed_lines,
       coalesce(b.allocation_rows, 0)::int AS allocation_rows,
       coalesce(a.transaction_rows, 0)::int AS transaction_rows
  FROM cells c
  LEFT JOIN budget b
         ON b.authority_id = c.authority_id AND b.financial_year_id = c.financial_year_id
        AND b.currency = c.currency
        AND b.ward_code IS NOT DISTINCT FROM c.ward_code
        AND b.unlocated_reason IS NOT DISTINCT FROM c.unlocated_reason
        AND b.department_id IS NOT DISTINCT FROM c.department_id
        AND b.programme_id IS NOT DISTINCT FROM c.programme_id
        AND b.account_kind = c.account_kind
  LEFT JOIN actuals a
         ON a.authority_id = c.authority_id AND a.financial_year_id = c.financial_year_id
        AND a.currency = c.currency
        AND a.ward_code IS NOT DISTINCT FROM c.ward_code
        AND a.department_id IS NOT DISTINCT FROM c.department_id
        AND a.programme_id IS NOT DISTINCT FROM c.programme_id
        AND a.account_kind = c.account_kind
        AND (c.ward_code IS NOT NULL OR coalesce(c.unlocated_reason, 'unlocated') = 'unlocated');

COMMENT ON VIEW finance.v_ward_dimension_performance IS
  'finance.v_ward_performance broken down by department, programme and account kind, so the map''s '
  '"expenditure by department / programme" is a rendering rather than a client-side group-by, and '
  'so a department-scoped officer''s ward aggregates can be restricted by a predicate on '
  'department_id. Σ over all dimension rows of one (ward, year, currency) equals the matching '
  'v_ward_performance row. actual_amount is attributed by the transaction''s own ward code; '
  'actual_amount_via_line by the budget line''s geography (NULL where an approved split means the '
  'line has no single geography). Currencies are never summed across.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5. M5 / D12 — PROJECT PERFORMANCE CARRIES PROGRESS AND THE SPEND-VERSUS-PROGRESS EXCEPTION
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Migration 189's view, unchanged in every existing column, plus four:
--
--   physical_progress_percent                 as recorded (NULL = not recorded)
--   spend_ahead_of_progress_threshold_points  the council's configured threshold, or NULL
--   spend_vs_progress_gap_points              financial execution % minus physical progress %
--   spend_ahead_of_progress                   TRUE / FALSE / NULL
--
-- THE FLAG IS NULL, NOT FALSE, whenever it cannot be evaluated: no recorded progress, nothing
-- allocated (so execution_percentage is itself NULL), or no configured threshold. "We have not
-- compared these" and "we compared them and found nothing wrong" are different statements and a
-- management exception list must not conflate them.
--
-- The threshold is read from finance.setting, which is tenant-scoped. Under the public session its
-- published_select policy admits only two keys (migration 197), so an anonymous reader gets a NULL
-- threshold and therefore a NULL flag — the exception list is a management surface and fails closed
-- out of it rather than leaking a judgement the Council has not published.

DROP VIEW IF EXISTS finance.v_project_performance CASCADE;
CREATE VIEW finance.v_project_performance WITH (security_invoker = true) AS
WITH live_project AS (
  SELECT id, authority_id, reference, name, department_id, ward_code, status,
         linked_subject_kind, linked_subject_id, currency, approved_budget,
         physical_progress_percent, progress_evidence_document_id, progress_recorded_at
    FROM finance.project
   WHERE deleted_at IS NULL
), alloc_by_currency AS (
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
), threshold AS (
  -- Configuration, not a constant. jsonb_typeof guards a council that has written a string or an
  -- object into the key: an unreadable threshold is NULL, which makes the flag NULL.
  SELECT s.authority_id,
         CASE WHEN jsonb_typeof(s.value) = 'number' THEN (s.value #>> '{}')::numeric END AS points
    FROM finance.setting s
   WHERE s.key = 'project.spend_ahead_of_progress_points'
), base AS (
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
         COALESCE(al.other_currency_allocations, '{}'::jsonb) AS other_currency_allocations,
         COALESCE(sp.other_currency_spend, '{}'::jsonb)       AS other_currency_spend,
         COALESCE(al.allocation_currency_mismatch_rows, 0)::int AS allocation_currency_mismatch_rows,
         COALESCE(sp.actual_currency_mismatch_rows, 0)::int     AS actual_currency_mismatch_rows,
         ARRAY(
           SELECT DISTINCT y
             FROM unnest(COALESCE(ay.financial_year_ids, '{}'::uuid[])
                         || COALESCE(sy.financial_year_ids, '{}'::uuid[])) AS u(y)
            ORDER BY y
         ) AS financial_year_ids,
         -- D12.
         p.physical_progress_percent,
         p.progress_evidence_document_id,
         p.progress_recorded_at,
         th.points AS spend_ahead_of_progress_threshold_points
    FROM live_project p
    LEFT JOIN alloc al       ON al.project_id = p.id
    LEFT JOIN alloc_years ay ON ay.project_id = p.id
    LEFT JOIN spend sp       ON sp.project_id = p.id
    LEFT JOIN spend_years sy ON sy.project_id = p.id
    LEFT JOIN threshold th   ON th.authority_id = p.authority_id
)
SELECT base.*,
       CASE WHEN base.physical_progress_percent IS NULL OR base.execution_percentage IS NULL
            THEN NULL
            ELSE round(base.execution_percentage - base.physical_progress_percent, 2)
       END AS spend_vs_progress_gap_points,
       CASE WHEN base.physical_progress_percent IS NULL THEN NULL
            WHEN base.execution_percentage IS NULL THEN NULL
            WHEN base.spend_ahead_of_progress_threshold_points IS NULL THEN NULL
            ELSE (base.execution_percentage - base.physical_progress_percent)
                 > base.spend_ahead_of_progress_threshold_points
       END AS spend_ahead_of_progress
  FROM base;

COMMENT ON VIEW finance.v_project_performance IS
  'One row per project (audit F-04). Amounts are in the project''s own currency; allocations and '
  'spend in another currency are returned as JSON objects and mismatch counts, never converted or '
  'added. `financial_year_ids` lists the years in which the project has an allocation or a linked '
  'transaction. physical_progress_percent is NULL when no progress has been recorded (decision '
  'D12) and spend_ahead_of_progress is then NULL — never false: the comparison was not made. The '
  'threshold is finance.setting key project.spend_ahead_of_progress_points, in percentage points; '
  'a council that has not set it gets a NULL flag rather than a hard-coded judgement.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 6. MAJOR-8 — A CLOSED YEAR REJECTS SPATIAL-ALLOCATION WRITES LIKE EVERYTHING ELSE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- finance.assert_year_open() covered budget_line, budget_revision, transaction, commitment,
-- import_batch, project_allocation and project_transaction (188, extended by 192).
-- finance.spatial_allocation, added six migrations later, was not in that list: a split of a
-- project's money across wards could be recorded AND approved after the year was closed and the
-- accounts signed, changing the geography of a signed-off year with no database-level refusal.
--
-- The subject is polymorphic, so the year has to be resolved rather than read off a column:
--   * budget_line subject — the line's own financial year. (The allocation guard trigger already
--     refused this case; now the house rule enforces it too, which is what MAJOR-8 asked for.)
--   * project subject     — a project spans years, so there is no single year. Its FUNDING
--     allocations name the years whose figures this split's geography would move, and if any one
--     of them is closed the write is refused. This is the gap: the guard performed no year check
--     at all on the project branch.
--
-- UPDATE is refused as well as INSERT, exactly as on every other table in the set. A split in a
-- closed year therefore cannot be withdrawn either — the same rule the rest of a closed year
-- lives under, and reopening the year is the documented way out.

CREATE OR REPLACE FUNCTION finance.assert_year_open() RETURNS trigger AS $$
DECLARE
  y_id uuid;
  y_status text;
  y_label text;
BEGIN
  IF TG_TABLE_NAME IN ('budget_revision', 'commitment') THEN
    SELECT financial_year_id INTO y_id FROM finance.budget_line WHERE id = NEW.budget_line_id;
  ELSIF TG_TABLE_NAME = 'project_transaction' THEN
    SELECT financial_year_id INTO y_id FROM finance.transaction WHERE id = NEW.transaction_id;
  ELSIF TG_TABLE_NAME = 'spatial_allocation' THEN
    IF NEW.subject_kind = 'budget_line' THEN
      SELECT financial_year_id INTO y_id FROM finance.budget_line WHERE id = NEW.subject_id;
    ELSE
      SELECT y.status, y.label INTO y_status, y_label
        FROM finance.project_allocation pa
        JOIN finance.financial_year y ON y.id = pa.financial_year_id
       WHERE pa.project_id = NEW.subject_id AND pa.deleted_at IS NULL
         AND y.status IN ('closed', 'archived')
       ORDER BY y.end_date
       LIMIT 1;
      IF y_status IS NOT NULL THEN
        RAISE EXCEPTION 'financial year % is %; it accepts no further financial records', y_label, y_status
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      RETURN NEW;
    END IF;
  ELSE
    y_id := NEW.financial_year_id;
  END IF;
  IF y_id IS NULL THEN RETURN NEW; END IF;
  SELECT status, label INTO y_status, y_label FROM finance.financial_year WHERE id = y_id;
  IF y_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'financial year % is %; it accepts no further financial records', y_label, y_status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- The full set, in one place, recreated. 'spatial_allocation' is the addition.
-- Trigger order on finance.spatial_allocation: PostgreSQL fires same-timing triggers in name
-- order, so trg_spatial_allocation_guard (198) runs before trg_spatial_allocation_year_open.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget_line', 'budget_revision', 'transaction', 'commitment',
                           'import_batch', 'project_allocation', 'project_transaction',
                           'spatial_allocation'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_year_open ON finance.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_year_open BEFORE INSERT OR UPDATE ON finance.%I
         FOR EACH ROW EXECUTE FUNCTION finance.assert_year_open()', t, t);
  END LOOP;
END $$;

COMMENT ON FUNCTION finance.assert_year_open() IS
  'Refuses writes into a closed or archived financial year on budget lines, revisions, '
  'transactions, commitments, import batches, project allocations, project transactions and '
  'spatial allocations (audit D-04 and MAJOR-8). A spatial allocation''s year is resolved from '
  'its polymorphic subject: a budget line''s own year, or — a project spanning years — the years '
  'of its funding allocations, any one of which being closed refuses the write.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 7. MAJOR-1 — A REDUCTION IS RE-VALIDATED AGAINST APPROVED SPATIAL ALLOCATIONS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE DEFECT. Migration 198's guard caps the cumulative approved split at the subject's canonical
-- total AT APPROVAL TIME ONLY. Nothing re-checked it when revised_amount later FELL. Line
-- WATER-01 revised 100,000 with approved splits of 60,000 and 40,000, then a −50,000 reduction
-- approved by a second officer: every existing control passes, and the ward map then attributes
-- 100,000 against a 50,000 line plus an unallocated_remainder of −50,000.
--
-- THE DECISION: THE REDUCTION IS REFUSED. Not "flag the splits", not "clamp the remainder".
--
-- WHY REFUSE RATHER THAN FLAG.
--   1. Flagging leaves the database in a state whose arithmetic is wrong. The remainder is a
--      subtraction in a view (199:74-82); a negative remainder is not a warning, it is a figure
--      the choropleth would have to shade and the panel would have to read out. A control that
--      permits an inconsistency and then labels it has moved the problem onto the reader.
--   2. Auto-withdrawing the splits that no longer fit would be the SYSTEM revoking an approved
--      act on an officer's behalf. An approved spatial allocation carries a recorded methodology
--      and a named approver (§6.1 rule 7); only someone holding the deciding permission may
--      revoke it, and that revocation is itself an audited decision.
--   3. Refusing costs nothing and loses nothing. The officer withdraws the splits that no longer
--      fit — one audited act per split, by someone entitled to make it — and then approves the
--      reduction. Only the ORDER of two approved decisions is being enforced.
--   4. It is the same invariant as the approve-time cap, applied in the other direction, so there
--      is ONE rule about splits versus the canonical total rather than two that could disagree.
--
-- WHERE IT IS ENFORCED. Here, as an AFTER trigger, so the rule holds for a script, a hand-written
-- UPDATE or a future route; and in src/routes/finance-budget.js, which pre-checks and answers
-- 409 `spatial_allocations_exceed_revised` listing the allocation ids, so the officer is told what
-- to withdraw instead of being handed a trigger message.
--
-- WHY AN "AFTER" TRIGGER. It reads finance.v_budget_line_performance.revised_amount — the same
-- definition of "revised" the approve-time cap uses — which requires the row to be in its new
-- state. Computing a shadow revised amount in the trigger would be a second definition.
--
-- BOTH PATHS THAT CAN LOWER THE TOTAL ARE COVERED: an approved budget_revision, and a direct edit
-- of budget_line.original_amount (which the budget route permits while a line is still a draft).

CREATE OR REPLACE FUNCTION finance.assert_spatial_allocations_fit() RETURNS trigger AS $$
DECLARE
  v_line_id     uuid;
  v_split_total numeric;
  v_rows        int;
  v_ids         text;
  v_revised     numeric;
  v_currency    text;
BEGIN
  -- An IF rather than a CASE: plpgsql resolves every field reference in one SQL expression, so a
  -- CASE naming NEW.budget_line_id fails on finance.budget_line, which has no such column.
  IF TG_TABLE_NAME = 'budget_revision' THEN
    v_line_id := NEW.budget_line_id;
  ELSE
    v_line_id := NEW.id;
  END IF;

  SELECT sum(a.amount), count(*)::int,
         string_agg(a.id::text, ', ' ORDER BY a.target_code)
    INTO v_split_total, v_rows, v_ids
    FROM finance.spatial_allocation a
   WHERE a.subject_kind = 'budget_line' AND a.subject_id = v_line_id
     AND a.status = 'approved' AND a.deleted_at IS NULL;

  -- No approved split: nothing to re-validate. The overwhelmingly common case, and it costs one
  -- indexed count (idx_spatial_allocation_subject).
  IF COALESCE(v_split_total, 0) = 0 THEN RETURN NULL; END IF;

  SELECT p.revised_amount, p.currency INTO v_revised, v_currency
    FROM finance.v_budget_line_performance p WHERE p.budget_line_id = v_line_id;
  IF v_revised IS NULL THEN RETURN NULL; END IF;

  IF v_split_total > v_revised THEN
    RAISE EXCEPTION
      'approved spatial allocations (% %) exceed the revised amount this change would leave on the budget line (% %); % approved split(s) no longer fit: %',
      v_split_total, v_currency, v_revised, v_currency, v_rows, v_ids
      USING ERRCODE = '22023',
            HINT = 'A geographic split is an approved act and this system will not revoke one on '
                || 'your behalf. Withdraw the splits that no longer fit '
                || '(POST /api/finance/spatial-allocations/:id/withdraw), then approve the reduction.';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION finance.assert_spatial_allocations_fit() IS
  'Refuses a change that would leave approved spatial allocations exceeding a budget line''s '
  'revised amount (audit MAJOR-1). The same invariant as migration 198''s approve-time cap, '
  'applied when the canonical total FALLS. The reduction is refused rather than the splits '
  'silently flagged: a negative unallocated remainder is a figure the map would have to render, '
  'and only a person holding the deciding permission may revoke an approved split.';

DROP TRIGGER IF EXISTS trg_budget_revision_splits_fit ON finance.budget_revision;
CREATE TRIGGER trg_budget_revision_splits_fit
  AFTER INSERT OR UPDATE ON finance.budget_revision
  FOR EACH ROW WHEN (NEW.state = 'approved')
  EXECUTE FUNCTION finance.assert_spatial_allocations_fit();

DROP TRIGGER IF EXISTS trg_budget_line_splits_fit ON finance.budget_line;
CREATE TRIGGER trg_budget_line_splits_fit
  AFTER UPDATE OF original_amount, currency ON finance.budget_line
  FOR EACH ROW EXECUTE FUNCTION finance.assert_spatial_allocations_fit();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 8. GRANTS AND TENANCY CLASSIFICATION
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A view recreated by DROP/CREATE is a new object: the grant and the classification the earlier
-- migration attached do not follow it. Re-applied here, or the application role is refused
-- (42501) the moment it reads a ward or a project.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT SELECT ON finance.v_budget_ward_attribution      TO vungu_app;
    GRANT SELECT ON finance.v_ward_performance             TO vungu_app;
    GRANT SELECT ON finance.v_ward_dimension_performance   TO vungu_app;
    GRANT SELECT ON finance.v_project_performance          TO vungu_app;
  END IF;

  PERFORM tenancy.classify('finance.v_budget_ward_attribution', 'tenant_view',
    'runs as the caller (security_invoker); the underlying policies decide the rows');
  PERFORM tenancy.classify('finance.v_ward_performance', 'tenant_view',
    'runs as the caller (security_invoker); the underlying policies decide the rows');
  PERFORM tenancy.classify('finance.v_ward_dimension_performance', 'tenant_view',
    'runs as the caller (security_invoker); the underlying policies decide the rows');
  PERFORM tenancy.classify('finance.v_project_performance', 'tenant_view',
    'runs as the caller (security_invoker); the underlying policies decide the rows');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 9. ASSERTIONS — this migration fails rather than quietly shipping a half-applied control
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE missing text;
BEGIN
  -- MAJOR-8: the closed-year trigger must now exist on every table in the set, spatial_allocation
  -- included. Iterated so that a table added later and forgotten fails here rather than silently.
  SELECT string_agg(t, ', ') INTO missing
    FROM unnest(ARRAY['budget_line', 'budget_revision', 'transaction', 'commitment',
                      'import_batch', 'project_allocation', 'project_transaction',
                      'spatial_allocation']) AS t
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_trigger tg
      WHERE tg.tgrelid = ('finance.' || t)::regclass
        AND tg.tgname = 'trg_' || t || '_year_open'
        AND NOT tg.tgisinternal);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'the closed-year guard is missing on finance.{%} (audit MAJOR-8)', missing;
  END IF;

  -- MAJOR-1: both reduction paths must carry the re-validation.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_budget_revision_splits_fit'
                   AND tgrelid = 'finance.budget_revision'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_budget_line_splits_fit'
                   AND tgrelid = 'finance.budget_line'::regclass) THEN
    RAISE EXCEPTION 'the spatial-allocation re-validation is not attached to both reduction paths (audit MAJOR-1)';
  END IF;

  -- D12: the field exists, is nullable, and no default has crept in that would turn "not
  -- recorded" into "0 %".
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'finance' AND table_name = 'project'
       AND column_name = 'physical_progress_percent'
       AND is_nullable = 'YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'finance.project.physical_progress_percent must exist, be nullable and have no default (decision D12)';
  END IF;

  -- M4-5: both actuals bases must be present on the ward view, or a surface could show one
  -- believing it was the other.
  SELECT string_agg(c, ', ') INTO missing
    FROM unnest(ARRAY['expenditure_actual', 'expenditure_actual_via_line',
                      'revenue_actual', 'revenue_actual_via_line',
                      'available_excluding_commitments', 'available_including_commitments',
                      'expenditure_variance', 'revenue_collection_percentage',
                      'original_expenditure', 'adjustments_expenditure',
                      'split_coverage_amount', 'unallocated_remainder_amount']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'finance' AND table_name = 'v_ward_performance' AND column_name = c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'finance.v_ward_performance is missing %, so the ward panel cannot be completed (audit M4-2/M4-5)', missing;
  END IF;
END $$;

COMMIT;
