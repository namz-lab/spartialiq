-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 210 — INTERNAL AUDIT: THE AUDIT PLAN AND ITS FINDINGS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Design: the Internal Auditor Dashboard (docs/superpowers/specs/2026-11-12-finance-role-workspaces-
-- design.md, frontend repository): audit plan progress, findings by risk, overdue actions.
-- Rollback: migrations/rollback/210_finance_internal_audit.down.sql.
--
-- WHAT IT IS
-- The auditor's own working record. An ENGAGEMENT is one audit on the year's plan (an area, its
-- dates, who leads it and where it stands). A FINDING is what an engagement found: its risk, the
-- action management agreed, who owns it and by when. A finding is closed with a note, never
-- deleted, so the register keeps every finding the council was told about.
--
-- WHAT IT IS NOT
-- It moves no money and changes no finance record. The trail of who did what in finance stays in
-- public.admin_audit_event; these tables hold the auditor's conclusions about it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
SET search_path = finance, public;

CREATE TABLE IF NOT EXISTS finance.audit_engagement (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  financial_year_id uuid REFERENCES finance.financial_year (id),
  title             text NOT NULL CONSTRAINT audit_engagement_title_length CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  area              text NOT NULL CONSTRAINT audit_engagement_area_length CHECK (length(btrim(area)) BETWEEN 2 AND 120),
  phase             text NOT NULL DEFAULT 'planning'
                      CONSTRAINT audit_engagement_phase_known CHECK (phase IN ('planning', 'fieldwork', 'reporting', 'follow_up')),
  status            text NOT NULL DEFAULT 'not_started'
                      CONSTRAINT audit_engagement_status_known CHECK (status IN ('not_started', 'in_progress', 'completed', 'cancelled')),
  planned_start     date,
  planned_end       date,
  lead_user_id      uuid REFERENCES public.users (id),
  notes             text,
  completed_at      timestamptz,
  created_by        uuid NOT NULL REFERENCES public.users (id),
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT audit_engagement_dates_ordered CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end >= planned_start),
  CONSTRAINT audit_engagement_completed_is_dated CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS finance.audit_finding (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id    integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  engagement_id   uuid NOT NULL REFERENCES finance.audit_engagement (id),
  title           text NOT NULL CONSTRAINT audit_finding_title_length CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  detail          text,
  risk            text NOT NULL CONSTRAINT audit_finding_risk_known CHECK (risk IN ('high', 'medium', 'low')),
  status          text NOT NULL DEFAULT 'open' CONSTRAINT audit_finding_status_known CHECK (status IN ('open', 'closed')),
  action          text,
  action_owner    text,
  due_date        date,
  closed_at       timestamptz,
  closed_by       uuid REFERENCES public.users (id),
  closure_note    text,
  created_by      uuid NOT NULL REFERENCES public.users (id),
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT audit_finding_closed_is_signed
    CHECK ((status = 'closed') = (closed_at IS NOT NULL AND closed_by IS NOT NULL)),
  CONSTRAINT audit_finding_closure_is_explained
    CHECK (status <> 'closed' OR length(btrim(COALESCE(closure_note, ''))) >= 3)
);

CREATE INDEX IF NOT EXISTS idx_audit_engagement_year ON finance.audit_engagement (authority_id, financial_year_id);
CREATE INDEX IF NOT EXISTS idx_audit_finding_engagement ON finance.audit_finding (engagement_id);
CREATE INDEX IF NOT EXISTS idx_audit_finding_open ON finance.audit_finding (authority_id, due_date) WHERE status = 'open';

COMMENT ON TABLE finance.audit_engagement IS
  'One audit on the internal audit plan: area, dates, lead, phase and status. Changes no finance record.';
COMMENT ON TABLE finance.audit_finding IS
  'What an audit found: risk, agreed action, owner, due date. Closed with a note, never deleted.';

INSERT INTO finance.permission (code, label, category, is_approval, is_publication, is_restricted, description) VALUES
  ('finance.audit.manage', 'Keep the internal audit plan and findings', 'audit', false, false, false,
   'Add audits to the plan, move them through their phases, record findings and close them with a note. Changes no finance record.')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, is_approval = EXCLUDED.is_approval,
      is_publication = EXCLUDED.is_publication, is_restricted = EXCLUDED.is_restricted,
      description = EXCLUDED.description;

-- Internal audit keeps its own plan. Nobody else writes to it; everyone with the trail can read it.
INSERT INTO finance.role_permission (role_name, permission_code) VALUES
  ('auditor', 'finance.audit.manage')
ON CONFLICT DO NOTHING;

-- Tenancy and grants, as every finance table: each row belongs to its council. A finding is closed,
-- never deleted, so the application role cannot delete from either table.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    PERFORM tenancy.classify('finance.audit_engagement', 'pending', 'internal audit data awaiting the authority it belongs to');
    PERFORM tenancy.classify('finance.audit_finding', 'pending', 'internal audit data awaiting the authority it belongs to');
    RETURN;
  END IF;
  PERFORM tenancy.make_tenant('finance.audit_engagement'::regclass, 'VUNGU');
  PERFORM tenancy.make_tenant('finance.audit_finding'::regclass, 'VUNGU');
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    REVOKE DELETE, TRUNCATE ON finance.audit_engagement, finance.audit_finding FROM vungu_app;
  END IF;
END $$;
