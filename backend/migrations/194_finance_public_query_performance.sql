-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 194 — Public portal query performance: make the publication policies set-based
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE SYMPTOM. At 20,000 transactions and concurrency 30 the public portal returned HTTP 500
-- with SQLSTATE 57014 (statement timeout). Under vungu_app a count over
-- finance.v_published_transaction took ~3.1 s and touched ~990,000 shared buffers; the same
-- query as the owner took ~20 ms.
--
-- THE CAUSE. The published_select policy on finance.transaction was a correlated EXISTS:
--
--   EXISTS (SELECT 1 FROM finance.account a JOIN finance.publication p
--            WHERE a.id = transaction.account_id
--              AND p.financial_year_id = transaction.financial_year_id
--              AND p.dataset = CASE a.kind WHEN 'revenue' THEN 'revenue' ELSE 'expenditure' END
--              AND p.state = 'published')
--
-- PostgreSQL evaluated it once per candidate row. Because the policy references finance.account,
-- the account policy ran inside it too, and that policy in turn ran its own publication lookup.
-- At 20,000 rows that is ~40,000 correlated publication scans. The tenant policies made it worse:
-- both tenant_select and the FOR ALL tenant_write policy (which also applies to SELECT) called
-- app.is_platform(), app.visible_authorities() and app.authority_id() for every row, and each of
-- those calls performs a table/catalog lookup. The plan showed loops=20000 on those subplans.
--
-- THE FIX, in two parts. Neither part changes which rows are visible.
--
-- 1. Every publication test becomes an UNCORRELATED set membership, e.g.
--
--      (financial_year_id, account_id) IN (
--        SELECT p.financial_year_id, a.id FROM finance.account a JOIN finance.publication p ...)
--
--    The subquery does not reference the outer row, so PostgreSQL evaluates it once and hashes it.
--    It still joins the same tables, so row-level security on finance.account (deleted_at IS NULL
--    and a live publication for the authority) and the live publication row are still enforced.
--    Withdraw a publication and the row leaves the set in the same instant: nothing is
--    denormalised, materialised or cached.
--
-- 2. The tenant policies short-circuit for the public session. tenancy.js sets app.authority_id
--    to '' for an anonymous request and to the authority for staff. When it is '' the tenant
--    branch is false without calling any session function. A direct database client (migration
--    166) never sets app.authority_id, so current_setting(..., true) is NULL, not '', and it
--    still takes the original role-mapping path. The platform branch is guarded by
--    app.is_platform(), not by the setting alone, so a direct client cannot claim platform access
--    by setting app.platform.
--
-- WHY NOT DENORMALISE, DISABLE RLS, OR CACHE THE PUBLICATION STATE. A flag on the transaction
-- would need a trigger on publication and on account, could drift, and would make withdrawal
-- non-atomic. Disabling RLS or granting the public role direct table access would remove the
-- control the audit relies on. This migration keeps both the publication model and the tenant
-- model intact; it changes only the shape of the predicate, not its meaning.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- 1. Make the platform check cheap for the public and staff sessions ---------------------------------
-- The original is `role_authority_of(current_user) IS NULL AND app.platform = 'on'`. When the
-- platform setting is not 'on' the answer is false regardless of the role mapping, so test the
-- setting first and avoid the lookup. This is logically identical, and it is the hot path for
-- every staff request that is not a platform administrator.
CREATE OR REPLACE FUNCTION app.is_platform()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN COALESCE(current_setting('app.platform', true), '') <> 'on' THEN false
    ELSE tenancy.role_authority_of(current_user) IS NULL
  END
$$;

-- 2. Tenant policies: no session-function calls for an anonymous request ----------------------------
-- The expression is the original `app.is_platform() OR ...` with two guards:
--   * COALESCE(setting, 'x') <> '' is true for staff (non-empty) and for a direct client (NULL,
--     because it never sets the GUC), and false only for the public session (''). So direct
--     clients keep the role-mapping behaviour of migration 166.
--   * the platform branch repeats the setting check before calling app.is_platform(), so the
--     public session does not call it at all. It is not `platform = 'on'` alone: app.is_platform()
--     still refuses a mapped direct-client role.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'finance'
       AND c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM pg_policy p
                    WHERE p.polrelid = c.oid AND p.polname = 'tenant_select')
     ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_select ON finance.%I', r.relname);
    EXECUTE format($policy$
      CREATE POLICY tenant_select ON finance.%I FOR SELECT USING (
        (
          COALESCE(current_setting('app.authority_id', true), 'x') <> ''
          AND (app.is_platform() OR authority_id = ANY (app.visible_authorities()))
        )
        OR (
          COALESCE(current_setting('app.platform', true), '') = 'on'
          AND app.is_platform()
        )
      )
    $policy$, r.relname);
  END LOOP;

  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'finance'
       AND c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM pg_policy p
                    WHERE p.polrelid = c.oid AND p.polname = 'tenant_write')
     ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_write ON finance.%I', r.relname);
    EXECUTE format($policy$
      CREATE POLICY tenant_write ON finance.%I FOR ALL
        USING (
          (
            COALESCE(current_setting('app.authority_id', true), 'x') <> ''
            AND (app.is_platform() OR authority_id = app.authority_id())
          )
          OR (
            COALESCE(current_setting('app.platform', true), '') = 'on'
            AND app.is_platform()
          )
        )
        WITH CHECK (
          (
            COALESCE(current_setting('app.authority_id', true), 'x') <> ''
            AND (app.is_platform() OR authority_id = app.authority_id())
          )
          OR (
            COALESCE(current_setting('app.platform', true), '') = 'on'
            AND app.is_platform()
          )
        )
    $policy$, r.relname);
  END LOOP;
END $$;

-- 3. Publication policies: one uncorrelated lookup per query, not one per row ----------------------
-- Each policy below is the original predicate with the outer-row reference moved out of the
-- subquery. Referenced tables keep their own row-level security, so the effective rules are
-- unchanged. `EXPLAIN` after this migration shows a hashed SubPlan with loops=1 where it used to
-- show loops=<row count>.

-- A financial year is public while something of it is published.
DROP POLICY IF EXISTS published_select ON finance.financial_year;
CREATE POLICY published_select ON finance.financial_year FOR SELECT USING (
  id IN (SELECT p.financial_year_id FROM finance.publication p WHERE p.state = 'published'));

-- Classifications: public while the authority has anything published at all.
DROP POLICY IF EXISTS published_select ON finance.department;
CREATE POLICY published_select ON finance.department FOR SELECT USING (
  deleted_at IS NULL
  AND authority_id IN (SELECT p.authority_id FROM finance.publication p WHERE p.state = 'published'));

DROP POLICY IF EXISTS published_select ON finance.programme;
CREATE POLICY published_select ON finance.programme FOR SELECT USING (
  deleted_at IS NULL
  AND authority_id IN (SELECT p.authority_id FROM finance.publication p WHERE p.state = 'published'));

DROP POLICY IF EXISTS published_select ON finance.activity;
CREATE POLICY published_select ON finance.activity FOR SELECT USING (
  deleted_at IS NULL
  AND authority_id IN (SELECT p.authority_id FROM finance.publication p WHERE p.state = 'published'));

DROP POLICY IF EXISTS published_select ON finance.account;
CREATE POLICY published_select ON finance.account FOR SELECT USING (
  deleted_at IS NULL
  AND authority_id IN (SELECT p.authority_id FROM finance.publication p WHERE p.state = 'published'));

-- A budget line is public when the budget for its year is published AND the line itself has
-- reached 'published'. Both conditions, exactly as before.
DROP POLICY IF EXISTS published_select ON finance.budget_line;
CREATE POLICY published_select ON finance.budget_line FOR SELECT USING (
  deleted_at IS NULL
  AND status = 'published'
  AND financial_year_id IN (
        SELECT p.financial_year_id FROM finance.publication p
         WHERE p.dataset = 'budget' AND p.state = 'published'));

-- An approved revision is public with the budget it revises.
DROP POLICY IF EXISTS published_select ON finance.budget_revision;
CREATE POLICY published_select ON finance.budget_revision FOR SELECT USING (
  deleted_at IS NULL
  AND state = 'approved'
  AND budget_line_id IN (
        SELECT l.id
          FROM finance.budget_line l
          JOIN finance.publication p ON p.financial_year_id = l.financial_year_id
         WHERE l.status = 'published'
           AND p.dataset = 'budget' AND p.state = 'published'));

-- A transaction is public when the dataset matching its account's kind is published for its year.
-- This is the policy that caused the timeout; it is now a hashed membership test.
DROP POLICY IF EXISTS published_select ON finance.transaction;
CREATE POLICY published_select ON finance.transaction FOR SELECT USING (
  deleted_at IS NULL
  AND (financial_year_id, account_id) IN (
        SELECT p.financial_year_id, a.id
          FROM finance.account a
          JOIN finance.publication p
            ON p.dataset = CASE a.kind WHEN 'revenue' THEN 'revenue' ELSE 'expenditure' END
           AND p.state = 'published'));

-- A project summary is public only after approval and while the projects dataset is published.
DROP POLICY IF EXISTS published_select ON finance.project;
CREATE POLICY published_select ON finance.project FOR SELECT USING (
  deleted_at IS NULL
  AND status IN ('approved', 'in_progress', 'suspended', 'completed')
  AND authority_id IN (
        SELECT p.authority_id FROM finance.publication p
         WHERE p.dataset = 'projects' AND p.state = 'published'));

DROP POLICY IF EXISTS published_select ON finance.project_allocation;
CREATE POLICY published_select ON finance.project_allocation FOR SELECT USING (
  deleted_at IS NULL
  AND project_id IN (
        SELECT pr.id
          FROM finance.project pr
          JOIN finance.publication p ON p.authority_id = pr.authority_id
         WHERE pr.status IN ('approved', 'in_progress', 'suspended', 'completed')
           AND p.dataset = 'projects' AND p.state = 'published'));

DROP POLICY IF EXISTS published_select ON finance.project_transaction;
CREATE POLICY published_select ON finance.project_transaction FOR SELECT USING (
  deleted_at IS NULL
  AND project_id IN (
        SELECT pr.id
          FROM finance.project pr
          JOIN finance.publication p ON p.authority_id = pr.authority_id
         WHERE pr.status IN ('approved', 'in_progress', 'suspended', 'completed')
           AND p.dataset = 'projects' AND p.state = 'published'));

-- A document reaches the public only by being classified 'public' by hand (decision D5).
DROP POLICY IF EXISTS published_select ON finance.document;
CREATE POLICY published_select ON finance.document FOR SELECT USING (
  deleted_at IS NULL
  AND visibility = 'public'
  AND authority_id IN (
        SELECT p.authority_id FROM finance.publication p
         WHERE p.dataset = 'documents' AND p.state = 'published'));

-- 4. Statistics ------------------------------------------------------------------------------------
-- The policies above are only cheap if the planner knows how small finance.publication and the
-- classification tables are. They already are, but an explicit ANALYZE keeps the first query
-- after the migration from planning against stale estimates.
ANALYZE finance.publication;
ANALYZE finance.account;
ANALYZE finance.department;
ANALYZE finance.programme;
ANALYZE finance.activity;
ANALYZE finance.financial_year;
ANALYZE finance.budget_line;
ANALYZE finance.budget_revision;
ANALYZE finance.transaction;
ANALYZE finance.project;
ANALYZE finance.project_allocation;
ANALYZE finance.project_transaction;
ANALYZE finance.document;
