-- 199_finance_ward_performance.sql
-- GIS–finance integration, Milestone 2 (docs/gis-finance/ARCHITECTURE-ASSESSMENT.md §6.2 in the
-- frontend repository).
--
-- THE WARD ROLL-UPS, COMPUTED WHERE EVERY OTHER FINANCE FIGURE IS COMPUTED. Nothing here
-- re-implements a measure: budget figures come from finance.v_budget_line_performance (which owns
-- original/revised/commitments in NUMERIC), actuals come from finance.transaction by each
-- transaction's own ward_code, and splits come from finance.spatial_allocation (migration 198).
-- A map that renders these views cannot drift from the consoles on what "revised" or "available"
-- means, which is the entire point.
--
-- ATTRIBUTION RULES (binding, documented here because they are policy):
--   * A line/project WITH approved spatial allocations attributes budget ONLY through them, one
--     row per target; the un-attributed remainder is its own bucket, never spread. Original vs
--     adjusted history is not re-split by assumption, so split rows carry the recorded allocation
--     amount only (original_amount is NULL on those rows).
--   * A line WITHOUT allocations attributes its full original/revised/commitments to its own
--     ward_code — or to the unlocated bucket when it has none.
--   * Actuals follow the transaction's own ward_code (a receipt or payment happens where it
--     happens), in the transaction's own currency. Ward execution % compares same-currency
--     budget and actuals; it is NULL, never zero, where there is no expenditure budget.
--   * Ward linkage is reported, not invented: ward_status is 'linked' only when the code is one
--     of the council's CURRENT wards in admin.authority_ward; until decision D11 loads that
--     register every coded ward reports 'unlinked' and the map must say so.
--
-- Projects are deliberately NOT folded into these rows: project measures span financial years
-- (finance.v_project_performance), and year-scoped rows would misstate them. Projects reach the
-- map through the existing ward filter on /finance/projects (Milestone 5 adds the layer).

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. BUDGET ATTRIBUTION — one row per (budget line, geographic target | unlocated | remainder)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

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
-- Split lines: one row per recorded target. original_amount and open_commitments are NULL (not
-- zero): re-splitting them across targets without a recorded methodology would be assumption.
SELECT p.budget_line_id, p.authority_id, p.financial_year_id, p.department_id,
       p.currency, p.account_kind, approved.ward_code,
       'spatial_allocation'::text AS basis,
       NULL::finance.money AS original_amount,
       approved.allocated_amount AS budget_amount,
       NULL::finance.money AS open_commitments,
       approved.allocation_rows
  FROM finance.v_budget_line_performance p
  JOIN split_total USING (budget_line_id)
  JOIN approved USING (budget_line_id)
UNION ALL
-- Unsplit lines: the whole line to its own ward code, or to the unlocated bucket.
SELECT p.budget_line_id, p.authority_id, p.financial_year_id, p.department_id,
       p.currency, p.account_kind, p.ward_code,
       CASE WHEN p.ward_code IS NULL THEN 'unlocated' ELSE 'line_ward_code' END,
       p.original_amount,
       p.revised_amount,
       p.open_commitments,
       0::int
  FROM finance.v_budget_line_performance p
  LEFT JOIN split_total USING (budget_line_id)
 WHERE split_total.budget_line_id IS NULL
UNION ALL
-- Split lines: the recorded remainder that no methodology has attributed yet.
SELECT p.budget_line_id, p.authority_id, p.financial_year_id, p.department_id,
       p.currency, p.account_kind, NULL,
       'unallocated_remainder',
       NULL::finance.money,
       (p.revised_amount - split_total.split_total)::finance.money,
       NULL::finance.money,
       0::int
  FROM finance.v_budget_line_performance p
  JOIN split_total USING (budget_line_id);

COMMENT ON VIEW finance.v_budget_ward_attribution IS
  'Budget geography, one row per attribution: spatial_allocation rows for split lines (with an '
  'unallocated_remainder row for what no methodology covered), whole-line attribution via '
  'ward_code otherwise, and an unlocated row for lines with no geography at all. All-or-nothing '
  'per line: a split line never also attributes through its ward_code.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. WARD PERFORMANCE — the row the choropleth and the ward panel read
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS finance.v_ward_performance CASCADE;
CREATE VIEW finance.v_ward_performance WITH (security_invoker = true) AS
WITH budget AS (
  SELECT b.authority_id, b.financial_year_id, b.currency,
         b.ward_code,
         -- Only the geography-less rows keep their reason; ward rows merge across bases.
         CASE WHEN b.ward_code IS NULL THEN b.basis ELSE NULL END AS unlocated_reason,
         sum(b.budget_amount) FILTER (WHERE b.account_kind = 'revenue')::finance.money
           AS revenue_budget,
         sum(b.budget_amount) FILTER (WHERE b.account_kind = 'expenditure')::finance.money
           AS expenditure_budget,
         sum(b.open_commitments)::finance.money AS open_commitments,
         count(*) FILTER (WHERE b.basis = 'line_ward_code')::int AS attributed_lines,
         count(*) FILTER (WHERE b.basis = 'spatial_allocation')::int AS allocation_rows
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
       b.revenue_budget,
       a.revenue_actual,
       CASE WHEN b.revenue_budget IS NULL THEN NULL
            ELSE (coalesce(a.revenue_actual, 0) - b.revenue_budget)::finance.money
       END AS revenue_variance,
       b.expenditure_budget,
       a.expenditure_actual,
       b.open_commitments,
       CASE WHEN b.expenditure_budget IS NULL OR b.expenditure_budget = 0 THEN NULL
            ELSE round(coalesce(a.expenditure_actual, 0) * 100 / b.expenditure_budget, 2)
       END AS expenditure_execution_percentage,
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
  'unlocated_reason instead. Budget figures come from v_budget_ward_attribution, actuals from the '
  'transactions'' own ward codes, both in their own currency (never converted, never summed '
  'across currencies). ward_status reports linkage to admin.authority_ward honestly: ''unlinked'' '
  'means the code is not (yet) one of the council''s current wards. Project measures are '
  'intentionally absent — they span years and reach the map through /finance/projects?ward_code=.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3. THE UNLOCATED REGISTER — what the map must admit it cannot place
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS finance.v_unlocated_finance CASCADE;
CREATE VIEW finance.v_unlocated_finance WITH (security_invoker = true) AS
SELECT p.authority_id, p.financial_year_id, p.currency,
       'budget'::text AS dataset,
       count(*)::int AS unlocated_rows,
       sum(p.revised_amount)::finance.money AS unlocated_amount
  FROM finance.v_budget_line_performance p
  LEFT JOIN (SELECT DISTINCT subject_id FROM finance.spatial_allocation
              WHERE subject_kind = 'budget_line' AND status = 'approved' AND deleted_at IS NULL) sa
         ON sa.subject_id = p.budget_line_id
 WHERE p.ward_code IS NULL AND sa.subject_id IS NULL
 GROUP BY 1, 2, 3
UNION ALL
SELECT t.authority_id, t.financial_year_id, t.currency,
       'transactions', count(*)::int, sum(t.amount)::finance.money
  FROM finance.transaction t
 WHERE t.deleted_at IS NULL AND t.ward_code IS NULL
 GROUP BY 1, 2, 3
UNION ALL
SELECT pr.authority_id, NULL::uuid, pr.currency,
       'projects', count(*)::int, sum(pr.approved_budget)::finance.money
  FROM finance.project pr
 WHERE pr.deleted_at IS NULL
   AND pr.ward_code IS NULL
   AND pr.location IS NULL
 GROUP BY 1, 2, 3;

COMMENT ON VIEW finance.v_unlocated_finance IS
  'Records the map cannot place: budget lines with neither a ward nor approved allocations, '
  'transactions without a ward code, projects with neither a ward nor a location. Reported as an '
  'explicit bucket (assessment §6.1 rule 4) — never silently dropped and never mapped to an '
  'invented location. Project rows are not year-scoped (financial_year_id is NULL).';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4. THE MAP PERMISSION
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- One read-only code for every GIS-finance surface. It confers no power over records: the same
-- person could already read these figures from the consoles, the map is another rendering of
-- them. Read for every finance role including the auditor (read-only by catalogue).

INSERT INTO finance.permission (code, label, category, is_approval, is_publication, is_restricted, description) VALUES
  ('finance.map.view', 'View the finance map', 'reporting', false, false, false,
   'GIS-integrated finance surfaces: ward choropleths, geographic drill-downs and the unlocated '
   'register. Reads the same performance views as the consoles; confers no write or approval power.')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category,
      is_approval = EXCLUDED.is_approval, is_publication = EXCLUDED.is_publication,
      is_restricted = EXCLUDED.is_restricted, description = EXCLUDED.description;

INSERT INTO finance.role_permission (role_name, permission_code)
SELECT r, 'finance.map.view'
  FROM unnest(ARRAY['finance_admin', 'finance_officer', 'budget_officer', 'dept_head',
                    'finance_committee', 'publisher', 'auditor']) AS r
ON CONFLICT (role_name, permission_code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5. TENANCY AND GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    -- ward_status resolves the council's current wards; the reference register is readable by the
    -- app role (national reference data, no tenant rows).
    GRANT SELECT ON admin.authority_ward TO vungu_app;
    GRANT SELECT ON finance.v_budget_ward_attribution TO vungu_app;
    GRANT SELECT ON finance.v_ward_performance TO vungu_app;
    GRANT SELECT ON finance.v_unlocated_finance TO vungu_app;
  END IF;

  PERFORM tenancy.classify('finance.v_budget_ward_attribution', 'tenant_view',
    'runs as the caller (security_invoker); the underlying policies decide the rows');
  PERFORM tenancy.classify('finance.v_ward_performance', 'tenant_view',
    'runs as the caller (security_invoker); the underlying policies decide the rows');
  PERFORM tenancy.classify('finance.v_unlocated_finance', 'tenant_view',
    'runs as the caller (security_invoker); the underlying policies decide the rows');
END $$;
