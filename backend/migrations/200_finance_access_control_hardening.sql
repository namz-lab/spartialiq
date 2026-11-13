-- 200_finance_access_control_hardening.sql
--
-- Four confirmed access-control failures from the production-readiness audit
-- (docs/gis-finance/PRODUCTION-READINESS.md §1–§2 and SPATIAL-VISUALISATION-GAPS.md §8/§11 in the
-- frontend repository). Nothing here weakens a policy, adds a role, or seeds a figure.
--
-- §1  BLOCKER B-1  finance.spatial_allocation had no published_select policy. Migration 198 created
--                  it with tenant RLS only, so an anonymous reader of finance.v_ward_performance
--                  (security_invoker) saw ZERO allocation rows and every split line fell through to
--                  the unsplit branch, attributing its whole revised amount to its own ward_code —
--                  the all-or-nothing rule inverted for the public. The policy below is the 194/197
--                  shape: keyed to a LIVE finance.publication row, APPROVED allocations only, and
--                  197's cross-tenant closure so another council's staff do not match it.
--
-- §2  BLOCKER-1    /api/public/finance/* confidentiality depended on the caller being anonymous:
--                  published_select is a second PERMISSIVE policy OR'd with tenant_select, so any
--                  signed-in Vungu session (a building inspector holds no finance permission at
--                  all) read unpublished drafts through the public route. The route fix is defence
--                  in depth — an explicitly anonymous connection AND a publication predicate in
--                  every public handler's own SQL. This migration supplies the view that predicate
--                  needs for budget lines, in the shape finance.v_published_transaction already
--                  established (188 §9).
--
-- §3  BLOCKER-3    DELETE /api/finance/documents/:id was gated by finance.document.view, a READ
--                  permission the read-only auditor holds, and the required reason was discarded.
--                  A new write permission (granted to nobody who only reads) and a column to keep
--                  the reason on the soft-deleted row.
--
-- §4  BLOCKER-2    Separation of duties was asserted over ROLE DEFAULTS only (188 §11), while
--                  PUT /api/finance/users/:id/access writes arbitrary grant overrides. The
--                  deferred constraint trigger below resolves the EFFECTIVE set (role defaults +
--                  grants − denies) and refuses the same combination migration 188 refuses, so the
--                  control survives a future route as well as this one.
--
-- Idempotent throughout: CREATE OR REPLACE, DROP POLICY IF EXISTS before CREATE POLICY,
-- ADD COLUMN IF NOT EXISTS, ON CONFLICT upserts, and DO-guarded trigger creation.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. B-1: finance.spatial_allocation gets a published_select policy
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Shape copied from migration 197's budget_revision and project_allocation policies: the row is
-- admitted only while a live publication covers its SUBJECT's dataset, and only when the
-- allocation is an APPROVED decision. A draft split is a proposal, never public.
--
-- FAILS CLOSED. No publication row → no allocation row. A withdrawn publication (state <>
-- 'published') → no allocation row, with no code change. And because the subject predicate also
-- requires the subject itself to be publicly visible (a published budget line, a project in a
-- released status), a split can never be more public than the money it splits.

DROP POLICY IF EXISTS published_select ON finance.spatial_allocation;
CREATE POLICY published_select ON finance.spatial_allocation FOR SELECT USING (
  deleted_at IS NULL
  AND status = 'approved'
  AND (
    (subject_kind = 'budget_line' AND subject_id IN (
       SELECT l.id
         FROM finance.budget_line l
         JOIN finance.publication p ON p.financial_year_id = l.financial_year_id
        WHERE l.deleted_at IS NULL
          AND l.status = 'published'
          AND p.dataset = 'budget' AND p.state = 'published'))
    OR
    (subject_kind = 'project' AND subject_id IN (
       SELECT pr.id
         FROM finance.project pr
         JOIN finance.publication p ON p.authority_id = pr.authority_id
        WHERE pr.deleted_at IS NULL
          AND pr.status IN ('approved', 'in_progress', 'suspended', 'completed')
          AND p.dataset = 'projects' AND p.state = 'published'))
  )
  -- Migration 197's closure: published rows are public to the PUBLIC session, visible to platform
  -- staff, and otherwise only to the council they belong to. Another council's staff do not match.
  AND (app.authority_id() IS NULL OR app.is_platform()
       OR authority_id = ANY (app.visible_authorities())));

COMMENT ON POLICY published_select ON finance.spatial_allocation IS
  'The public may see an APPROVED geographic split only while a live finance.publication covers '
  'its subject''s dataset and the subject itself is publicly visible. Keeps the all-or-nothing '
  'attribution rule (migration 198) identical for the public and for staff; drafts never appear.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. BLOCKER-1: the published budget-line view
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- finance.v_budget_line_performance is the STAFF view: it carries no publication join, so the
-- public budget page was correct only because of who was (not) asking. This is the same view
-- narrowed by the publication contract, in the shape of finance.v_published_transaction: a row
-- exists only while a live `budget` publication covers its year and the line itself is published.
--
-- Actual/execution/variance columns are carried through unchanged. They are computed by the
-- underlying view under the caller's own policies, which for the public session means actuals
-- appear only while a revenue/expenditure publication is live. (That an unpublished actual reads
-- as 0.00 rather than "not published" is MAJOR-2 in the audit and is NOT fixed here.)

DROP VIEW IF EXISTS finance.v_published_budget_line CASCADE;
CREATE VIEW finance.v_published_budget_line WITH (security_invoker = true) AS
SELECT p.*,
       pub.published_at,
       pub.data_as_at,
       pub.reporting_period_label,
       pub.version AS publication_version
  FROM finance.v_budget_line_performance p
  JOIN finance.publication pub
    ON pub.authority_id = p.authority_id
   AND pub.financial_year_id = p.financial_year_id
   AND pub.state = 'published'
   AND pub.dataset = 'budget'
 WHERE p.status = 'published';

COMMENT ON VIEW finance.v_published_budget_line IS
  'The public budget surface. A line appears only while it is itself published AND a live '
  '`budget` publication covers its financial year — the publication contract stated in the view '
  'rather than left to the route or to the caller being anonymous (audit BLOCKER-1).';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3. BLOCKER-3: withdrawing a finance document is a WRITE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Why a dedicated code rather than re-pointing the route at finance.document.upload: withdrawing
-- evidence that supports a posted transaction is a more consequential act than adding a file, and
-- the two are held by different people in a real finance office. Re-using `upload` would also have
-- silently conferred withdrawal on budget_officer, which no audit asked for. is_approval,
-- is_publication and is_restricted are all false: this permission moves no money and discloses
-- nothing, so it cannot interact with the separation-of-duties invariant below.

INSERT INTO finance.permission (code, label, category, is_approval, is_publication, is_restricted, description) VALUES
  ('finance.document.withdraw', 'Withdraw finance documents', 'documents', false, false, false,
   'Soft-delete a finance document so it is no longer listed or served. The row and the stored '
   'file are retained (§8.1 forbids hard-deleting financial records) and a reason is required and '
   'kept. A WRITE permission: finance.document.view is read-only and must not confer this.')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category,
      is_approval = EXCLUDED.is_approval, is_publication = EXCLUDED.is_publication,
      is_restricted = EXCLUDED.is_restricted, description = EXCLUDED.description;

-- Granted only to the roles that legitimately withdraw a document they or their department own.
-- NOT auditor (read-only, including the audit trail — 188 §11 says it "writes nothing").
-- NOT admin  (the technical administrator holds no authority over financial content).
-- NOT publisher or finance_committee (they release and approve; removing evidence is not theirs).
-- NOT budget_officer (it uploads supporting material; withdrawal stays with finance and the vote
--                     holder, per PRODUCTION-READINESS.md's BLOCKER-3 fix).
INSERT INTO finance.role_permission (role_name, permission_code)
SELECT r, 'finance.document.withdraw'
  FROM unnest(ARRAY['finance_admin', 'finance_officer', 'dept_head']) AS r
ON CONFLICT (role_name, permission_code) DO NOTHING;

-- The stated reason, kept where the withdrawal is. The route also writes it into the audit event's
-- details; both, because the audit trail answers "who did what" and the row answers "why is this
-- document not here" to anyone reading the register six months later.
ALTER TABLE finance.document ADD COLUMN IF NOT EXISTS withdrawn_reason text;

COMMENT ON COLUMN finance.document.withdrawn_reason IS
  'Why this document was withdrawn, as stated by the person who withdrew it (minimum 5 '
  'characters, enforced at the route). Set together with deleted_at/deleted_by; NULL on a live row.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'finance.document'::regclass
       AND conname = 'document_withdrawn_reason_with_deletion'
  ) THEN
    -- A reason without a withdrawal is meaningless; a reason is required on new withdrawals by the
    -- route, but rows withdrawn BEFORE this migration have none and must stay valid, so this
    -- constrains only the other direction.
    ALTER TABLE finance.document
      ADD CONSTRAINT document_withdrawn_reason_with_deletion
      CHECK (withdrawn_reason IS NULL OR deleted_at IS NOT NULL);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4. BLOCKER-2: separation of duties over the EFFECTIVE permission set
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Migration 188 §11 asserts, over finance.role_permission, that no ROLE holds both an approval
-- permission and a publication permission, and that `admin` holds no approval, publication or
-- restricted permission. Both assertions are true and stay true. What they never covered is
-- finance.user_permission_override: one holder of finance.users.manage_finance_roles could grant
-- a single officer finance.budget.approve AND finance.publication.publish.
--
-- finance.resolve_effective_permissions() is the single SQL definition of "what this person holds"
-- — the same resolution as src/middleware/financePermissions.js loadPermissions(): role defaults,
-- plus grants, minus denies, with an expired override counting for nothing.
--
-- finance.assert_separation_of_duties() applies migration 188's own test (bool_or(is_approval) AND
-- bool_or(is_publication)) to that set, so the catalogue's flags remain the one place the rule is
-- expressed: adding a permission with is_publication = true needs no change here.
--
-- The trigger is a DEFERRABLE CONSTRAINT trigger: the access route replaces a person's overrides
-- row by row inside one transaction, so an intermediate state can legitimately look conflicting
-- (a grant inserted before the deny that cancels it). Checking at COMMIT judges the result, which
-- is the thing the invariant is about.

CREATE OR REPLACE FUNCTION finance.resolve_effective_permissions(p_user_id uuid)
RETURNS TABLE (permission_code text, is_approval boolean, is_publication boolean, is_restricted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
  WITH person AS (
    SELECT u.id, COALESCE(u.role, '') AS role FROM public.users u WHERE u.id = p_user_id
  ), granted AS (
    SELECT rp.permission_code AS code
      FROM finance.role_permission rp JOIN person ON rp.role_name = person.role
    UNION
    SELECT o.permission_code
      FROM finance.user_permission_override o
     WHERE o.user_id = p_user_id AND o.effect = 'grant'
       AND (o.expires_at IS NULL OR o.expires_at > now())
  ), denied AS (
    SELECT o.permission_code AS code
      FROM finance.user_permission_override o
     WHERE o.user_id = p_user_id AND o.effect = 'deny'
       AND (o.expires_at IS NULL OR o.expires_at > now())
  )
  SELECT p.code, p.is_approval, p.is_publication, p.is_restricted
    FROM granted g
    JOIN finance.permission p ON p.code = g.code
   WHERE g.code NOT IN (SELECT code FROM denied);
$$;

COMMENT ON FUNCTION finance.resolve_effective_permissions(uuid) IS
  'Role defaults + grant overrides − deny overrides, with expired overrides ignored. The same '
  'resolution as src/middleware/financePermissions.js loadPermissions(); read by the '
  'separation-of-duties assertion so the route and the database cannot disagree.';

-- THE RULE ITSELF, in one place every caller shares. Zero rows means the person's effective set
-- is permissible; one row names exactly what is wrong and which two codes collide. The route
-- (src/routes/finance-users.js) calls this inside its transaction so it can refuse with a
-- specific 409 before anything commits; the trigger below calls the same function at COMMIT so a
-- future route, a script or a hand-written UPDATE cannot bypass it.
CREATE OR REPLACE FUNCTION finance.separation_of_duties_conflict(p_user_id uuid)
RETURNS TABLE (rule text, role_name text, approval_code text, publication_code text, restricted_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
  WITH person AS (
    SELECT u.id, COALESCE(u.role, '') AS role FROM public.users u WHERE u.id = p_user_id
  ), held AS (
    SELECT min(e.permission_code) FILTER (WHERE e.is_approval)    AS approval_code,
           min(e.permission_code) FILTER (WHERE e.is_publication) AS publication_code,
           min(e.permission_code) FILTER (WHERE e.is_restricted)  AS restricted_code
      FROM finance.resolve_effective_permissions(p_user_id) e
  )
  -- Migration 188 section 11's first assertion, over one person's effective set.
  SELECT 'approval_and_publication'::text, person.role,
         held.approval_code, held.publication_code, held.restricted_code
    FROM person, held
   WHERE held.approval_code IS NOT NULL AND held.publication_code IS NOT NULL
  UNION ALL
  -- Migration 188 section 11's second assertion: the TECHNICAL administrator holds no authority
  -- over financial content, however the grant was written.
  SELECT 'technical_administrator_has_financial_authority'::text, person.role,
         held.approval_code, held.publication_code, held.restricted_code
    FROM person, held
   WHERE person.role = 'admin'
     AND COALESCE(held.approval_code, held.publication_code, held.restricted_code) IS NOT NULL;
$$;

COMMENT ON FUNCTION finance.separation_of_duties_conflict(uuid) IS
  'The separation-of-duties rule, as data. Zero rows = permissible. One row names the broken rule '
  'and the colliding permission codes. Read by both the access route (a 409 naming the pair) and '
  'the constraint trigger on finance.user_permission_override, so the two cannot disagree. The '
  'rule reads finance.permission.is_approval / is_publication / is_restricted, so a permission '
  'added later is covered without editing this function.';

CREATE OR REPLACE FUNCTION finance.assert_separation_of_duties() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
DECLARE
  v_user uuid := COALESCE(NEW.user_id, OLD.user_id);
  c record;
BEGIN
  SELECT * INTO c FROM finance.separation_of_duties_conflict(v_user) LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF c.rule = 'approval_and_publication' THEN
    RAISE EXCEPTION
      'separation of duties: this person would hold both the approval permission % and the publication permission %',
      c.approval_code, c.publication_code
      USING ERRCODE = '23514',
            HINT = 'Whoever approves a dataset must not be whoever publishes it. Remove one of the two.';
  END IF;

  RAISE EXCEPTION
    'the technical administrator must not hold approval, publication or restricted-data permissions (would hold %)',
    COALESCE(c.approval_code, c.publication_code, c.restricted_code)
    USING ERRCODE = '23514',
          HINT = 'Give the financial authority to a finance role, not to the account that administers accounts.';
END $$;

COMMENT ON FUNCTION finance.assert_separation_of_duties() IS
  'Refuses any write to finance.user_permission_override whose RESULT breaks '
  'finance.separation_of_duties_conflict(). Deferred to COMMIT so the access route may replace a '
  'person''s overrides row by row and be judged on the result, not on an intermediate state '
  '(audit BLOCKER-2).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'finance.user_permission_override'::regclass
       AND tgname = 'trg_user_permission_override_sod'
  ) THEN
    CREATE CONSTRAINT TRIGGER trg_user_permission_override_sod
      AFTER INSERT OR UPDATE ON finance.user_permission_override
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION finance.assert_separation_of_duties();
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5. GRANTS AND TENANCY CLASSIFICATION
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT SELECT ON finance.v_published_budget_line TO vungu_app;
  END IF;

  IF to_regproc('tenancy.classify') IS NOT NULL THEN
    PERFORM tenancy.classify('finance.v_published_budget_line', 'tenant_view',
      'runs as the caller (security_invoker); the publication join and the underlying policies decide the rows');
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 6. ASSERTIONS — this migration fails rather than quietly weakening a control
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE offender text;
BEGIN
  -- The new permission must not have given any role both duties, and must not have reached a
  -- read-only or technical role.
  SELECT rp.role_name INTO offender
    FROM finance.role_permission rp JOIN finance.permission p ON p.code = rp.permission_code
   GROUP BY rp.role_name
  HAVING bool_or(p.is_approval) AND bool_or(p.is_publication)
   LIMIT 1;
  IF offender IS NOT NULL THEN
    RAISE EXCEPTION 'role % would hold both an approval and a publication permission; separation of duties (§2.3) forbids it', offender;
  END IF;

  IF EXISTS (
    SELECT 1 FROM finance.role_permission
     WHERE permission_code = 'finance.document.withdraw'
       AND role_name IN ('auditor', 'admin', 'publisher', 'finance_committee')
  ) THEN
    RAISE EXCEPTION 'finance.document.withdraw must not be held by a read-only or technical role';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'finance.spatial_allocation'::regclass AND polname = 'published_select'
  ) THEN
    RAISE EXCEPTION 'finance.spatial_allocation still has no published_select policy (audit B-1)';
  END IF;
END $$;

COMMIT;
