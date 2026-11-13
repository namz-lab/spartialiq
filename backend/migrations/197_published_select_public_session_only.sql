-- 197: published_select serves the PUBLIC session, not other councils' staff.
--
-- Migration 194 made the published_select policies set-based to fix the public-portal timeout.
-- What they did not carry is any notion of WHO is asking: any session -- including an
-- authenticated staff session of a DIFFERENT council -- matched them. Verified live on
-- 2026-11-07: a finance officer of a second authority sees Vungu's published financial year
-- in their own workspace's year picker, and the classifications referenced by published data
-- (department, account) in their filters. The published FIGURES are public by design -- the
-- anonymous portal serves them -- but the staff surface must not list another council's rows.
--
-- The rule this installs, per policy:
--
--     ( the same published condition as 194 )
--     AND ( app.authority_id() IS NULL        -- the public session: published rows are public
--        OR app.is_platform()                 -- platform staff
--        OR authority_id = ANY (app.visible_authorities()) )  -- a session: only its own council
--
-- What changes, concretely:
--   * anonymous portal requests: nothing. The public session has no authority, so the guard
--     passes exactly as before. (finance-public.js reads through the scoped pool, so an
--     anonymous request's app.authority_id is empty -- verified.)
--   * a council's own staff: nothing. They already see their council's rows through
--     tenant_select; the published path adds nothing new.
--   * another council's staff: they lose the cross-council rows. This is the fix. It fails
--     closed: in a future multi-council deployment, a signed-in council B officer browsing
--     council A's transparency pages sees nothing -- they use the anonymous view, or such
--     cross-reading is designed deliberately then.
--   * citizens: with no authority set they are the public session (all published rows); with
--     their council set they see their own council's published rows. Both correct.
--
-- No tenant policy is weakened; this narrows one.

BEGIN;

-- ── The year itself ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS published_select ON finance.financial_year;
CREATE POLICY published_select ON finance.financial_year FOR SELECT USING (
  id IN (SELECT p.financial_year_id FROM finance.publication p WHERE p.state = 'published')
  AND (app.authority_id() IS NULL OR app.is_platform()
       OR authority_id = ANY (app.visible_authorities())));

-- ── Classifications ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS published_select ON finance.department;
CREATE POLICY published_select ON finance.department FOR SELECT USING (
  deleted_at IS NULL
  AND authority_id IN (SELECT p.authority_id FROM finance.publication p WHERE p.state = 'published')
  AND (app.authority_id() IS NULL OR app.is_platform()
       OR authority_id = ANY (app.visible_authorities())));

DROP POLICY IF EXISTS published_select ON finance.programme;
CREATE POLICY published_select ON finance.programme FOR SELECT USING (
  deleted_at IS NULL
  AND authority_id IN (SELECT p.authority_id FROM finance.publication p WHERE p.state = 'published')
  AND (app.authority_id() IS NULL OR app.is_platform()
       OR authority_id = ANY (app.visible_authorities())));

DROP POLICY IF EXISTS published_select ON finance.activity;
CREATE POLICY published_select ON finance.activity FOR SELECT USING (
  deleted_at IS NULL
  AND authority_id IN (SELECT p.authority_id FROM finance.publication p WHERE p.state = 'published')
  AND (app.authority_id() IS NULL OR app.is_platform()
       OR authority_id = ANY (app.visible_authorities())));

DROP POLICY IF EXISTS published_select ON finance.account;
CREATE POLICY published_select ON finance.account FOR SELECT USING (
  deleted_at IS NULL
  AND authority_id IN (SELECT p.authority_id FROM finance.publication p WHERE p.state = 'published')
  AND (app.authority_id() IS NULL OR app.is_platform()
       OR authority_id = ANY (app.visible_authorities())));

-- ── Budget lines and revisions ──────────────────────────────────────────────
DROP POLICY IF EXISTS published_select ON finance.budget_line;
CREATE POLICY published_select ON finance.budget_line FOR SELECT USING (
  deleted_at IS NULL
  AND status = 'published'
  AND financial_year_id IN (
        SELECT p.financial_year_id FROM finance.publication p
         WHERE p.dataset = 'budget' AND p.state = 'published')
  AND (app.authority_id() IS NULL OR app.is_platform()
       OR authority_id = ANY (app.visible_authorities())));

DROP POLICY IF EXISTS published_select ON finance.budget_revision;
CREATE POLICY published_select ON finance.budget_revision FOR SELECT USING (
  deleted_at IS NULL
  AND state = 'approved'
  AND budget_line_id IN (
        SELECT l.id
          FROM finance.budget_line l
          JOIN finance.publication p ON p.financial_year_id = l.financial_year_id
         WHERE l.status = 'published'
           AND p.dataset = 'budget' AND p.state = 'published')
  AND (app.authority_id() IS NULL OR app.is_platform()
       OR authority_id = ANY (app.visible_authorities())));

-- ── Transactions ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS published_select ON finance.transaction;
CREATE POLICY published_select ON finance.transaction FOR SELECT USING (
  deleted_at IS NULL
  AND (financial_year_id, account_id) IN (
        SELECT p.financial_year_id, a.id
          FROM finance.account a
          JOIN finance.publication p
            ON p.dataset = CASE a.kind WHEN 'revenue' THEN 'revenue' ELSE 'expenditure' END
           AND p.state = 'published')
  AND (app.authority_id() IS NULL OR app.is_platform()
       OR authority_id = ANY (app.visible_authorities())));

-- ── Projects ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS published_select ON finance.project;
CREATE POLICY published_select ON finance.project FOR SELECT USING (
  deleted_at IS NULL
  AND status IN ('approved', 'in_progress', 'suspended', 'completed')
  AND authority_id IN (
        SELECT p.authority_id FROM finance.publication p
         WHERE p.dataset = 'projects' AND p.state = 'published')
  AND (app.authority_id() IS NULL OR app.is_platform()
       OR authority_id = ANY (app.visible_authorities())));

DROP POLICY IF EXISTS published_select ON finance.project_allocation;
CREATE POLICY published_select ON finance.project_allocation FOR SELECT USING (
  deleted_at IS NULL
  AND project_id IN (
        SELECT pr.id
          FROM finance.project pr
          JOIN finance.publication p ON p.authority_id = pr.authority_id
         WHERE pr.status IN ('approved', 'in_progress', 'suspended', 'completed')
           AND p.dataset = 'projects' AND p.state = 'published')
  AND (app.authority_id() IS NULL OR app.is_platform()
       OR authority_id = ANY (app.visible_authorities())));

DROP POLICY IF EXISTS published_select ON finance.project_transaction;
CREATE POLICY published_select ON finance.project_transaction FOR SELECT USING (
  deleted_at IS NULL
  AND project_id IN (
        SELECT pr.id
          FROM finance.project pr
          JOIN finance.publication p ON p.authority_id = pr.authority_id
         WHERE pr.status IN ('approved', 'in_progress', 'suspended', 'completed')
           AND p.dataset = 'projects' AND p.state = 'published')
  AND (app.authority_id() IS NULL OR app.is_platform()
       OR authority_id = ANY (app.visible_authorities())));

-- ── Documents (public only by hand classification, decision D5) ────────────
DROP POLICY IF EXISTS published_select ON finance.document;
CREATE POLICY published_select ON finance.document FOR SELECT USING (
  deleted_at IS NULL
  AND visibility = 'public'
  AND authority_id IN (
        SELECT p.authority_id FROM finance.publication p
         WHERE p.dataset = 'documents' AND p.state = 'published')
  AND (app.authority_id() IS NULL OR app.is_platform()
       OR authority_id = ANY (app.visible_authorities())));

-- ── Publication records and the two public settings keys ───────────────────
DROP POLICY IF EXISTS published_select ON finance.publication;
CREATE POLICY published_select ON finance.publication FOR SELECT USING (
  state = 'published'
  AND (app.authority_id() IS NULL OR app.is_platform()
       OR authority_id = ANY (app.visible_authorities())));

DROP POLICY IF EXISTS published_select ON finance.setting;
CREATE POLICY published_select ON finance.setting FOR SELECT USING (
  key = ANY (ARRAY['reporting.default_currency', 'available_balance.include_commitments'])
  AND (app.authority_id() IS NULL OR app.is_platform()
       OR authority_id = ANY (app.visible_authorities())));

COMMIT;
