-- 198_finance_spatial_allocation.sql
-- GIS–finance integration, Milestone 2 (docs/gis-finance/ARCHITECTURE-ASSESSMENT.md §6.2 in the
-- frontend repository).
--
-- THE EXPLICIT MULTI-AREA SPLIT TABLE. A budget line or project whose money genuinely covers
-- several wards gets one APPROVED row per target ward, carrying the recorded amount and the
-- methodology that produced it. The rule that keeps the map honest:
--
--   ALL-OR-NOTHING PER SUBJECT AND CURRENCY. The moment a subject has approved spatial
--   allocations in its own currency, ward roll-ups use ONLY those rows
--   (finance.v_budget_ward_attribution, migration 199); the subject's ward_code is ignored for
--   budget attribution and the unallocated
--   remainder surfaces as its own unallocated bucket. A record can therefore be counted twice
--   only by writing two allocation rows that together exceed the subject's total — which the
--   approval trigger below refuses.
--
-- Allocations are auditable acts, not tags: a recorded methodology is mandatory, the approver is
-- never the requester (the same constraint shape as finance.budget_revision), and approval checks
-- the sum against the subject's canonical total — revised_amount from
-- finance.v_budget_line_performance for a budget line, the funded project_allocation total for a
-- project. Nothing here divides anything equally or by assumption.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. THE TABLE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE finance.spatial_allocation (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id   integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  -- Polymorphic subject: no FK can express "budget_line OR project", so the guard trigger below
  -- resolves the subject, checks it is alive, and pins currency and authority to it.
  subject_kind   text NOT NULL CHECK (subject_kind IN ('budget_line', 'project')),
  subject_id     uuid NOT NULL,
  -- v1 target is the ward register (admin.ward.ward_code). parcel / stand / council_asset /
  -- village targets arrive with Milestone 8's import work, which is why this is a kind column
  -- rather than a ward FK: the finance register must never be blocked by an unloaded national
  -- cadastre (the same reason budget_line.ward_code is text).
  target_kind    text NOT NULL DEFAULT 'ward' CHECK (target_kind IN ('ward')),
  target_code    text NOT NULL CHECK (btrim(target_code) <> '' AND length(target_code) <= 64),
  amount         finance.money NOT NULL CHECK (amount > 0),
  currency       finance.currency_code NOT NULL,
  -- Optional share of the subject's total (1.00000 = the whole subject). Informational: the
  -- amount is what roll-ups consume, so a share and an amount that disagree are visible, not silent.
  share          numeric(6,5) CHECK (share IS NULL OR (share > 0 AND share <= 1)),
  methodology    text NOT NULL CHECK (btrim(methodology) <> ''),
  evidence_document_id uuid REFERENCES finance.document (id),
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected', 'withdrawn')),
  requested_by   uuid NOT NULL REFERENCES public.users (id),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  decided_by     uuid REFERENCES public.users (id),
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES public.users (id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  deleted_by     uuid REFERENCES public.users (id),
  -- An approved row records who approved it, and the approver is never the requester
  -- (the same overlap of route + constraint used by finance.budget_revision).
  CONSTRAINT spatial_allocation_approved_records_decider CHECK (
    status <> 'approved' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT spatial_allocation_decider_differs CHECK (decided_by IS NULL OR decided_by <> requested_by)
);

-- One live row per (subject, currency, target): a second draft for an already-drafted target is an
-- edit, and a target is approved at most once. Withdrawn/rejected rows free the slot.
CREATE UNIQUE INDEX uq_spatial_allocation_live
  ON finance.spatial_allocation (subject_kind, subject_id, currency, target_code)
  WHERE status IN ('draft', 'approved') AND deleted_at IS NULL;

CREATE INDEX idx_spatial_allocation_subject ON finance.spatial_allocation (subject_kind, subject_id);
CREATE INDEX idx_spatial_allocation_authority
  ON finance.spatial_allocation (authority_id, currency, status);

COMMENT ON TABLE finance.spatial_allocation IS
  'Explicit multi-area splits of a budget line or project across geographic targets. '
  'All-or-nothing per subject+currency: where approved rows exist, roll-ups use only them '
  '(see finance.v_budget_ward_attribution), so a split subject is never double counted and its '
  'unallocated remainder stays visible. Methodology is mandatory; equal division is not a default.';
COMMENT ON COLUMN finance.spatial_allocation.methodology IS
  'How this split was derived (survey, project design, committee resolution...). Recorded so the '
  'geographic attribution is auditable; there is no default methodology and no equal division.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. THE GUARD TRIGGER
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION finance.spatial_allocation_guard() RETURNS trigger AS $$
DECLARE
  v_line   finance.budget_line%ROWTYPE;
  v_project finance.project%ROWTYPE;
  v_year_status text;
  v_total  numeric;
  v_cap    numeric;
BEGIN
  NEW.target_code := btrim(NEW.target_code);
  NEW.methodology := btrim(NEW.methodology);

  -- The subject must exist, be alive, and belong to the same council in the same currency.
  IF NEW.subject_kind = 'budget_line' THEN
    SELECT * INTO v_line FROM finance.budget_line WHERE id = NEW.subject_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'unknown budget line %', NEW.subject_id USING ERRCODE = '23503';
    END IF;
    IF v_line.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'budget line % is deleted; it cannot be spatially allocated', NEW.subject_id
        USING ERRCODE = '23503';
    END IF;
    IF v_line.authority_id IS DISTINCT FROM NEW.authority_id THEN
      RAISE EXCEPTION 'allocation authority does not match the budget line''s council'
        USING ERRCODE = '42501';
    END IF;
    IF v_line.currency <> NEW.currency THEN
      RAISE EXCEPTION 'allocation currency % must match the line''s own currency %; currencies are never converted',
        NEW.currency, v_line.currency USING ERRCODE = '22023';
    END IF;
    SELECT status INTO v_year_status FROM finance.financial_year WHERE id = v_line.financial_year_id;
    IF v_year_status IN ('closed', 'archived') THEN
      RAISE EXCEPTION 'financial year is %; it accepts no further financial records', v_year_status
        USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT * INTO v_project FROM finance.project WHERE id = NEW.subject_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'unknown project %', NEW.subject_id USING ERRCODE = '23503';
    END IF;
    IF v_project.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'project % is deleted; it cannot be spatially allocated', NEW.subject_id
        USING ERRCODE = '23503';
    END IF;
    IF v_project.authority_id IS DISTINCT FROM NEW.authority_id THEN
      RAISE EXCEPTION 'allocation authority does not match the project''s council'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Ward targets are validated against the authority's CURRENT wards when that register is
  -- populated. An empty register (Vungu's live state until decision D11) degrades gracefully:
  -- the row is stored and finance.v_ward_performance reports it as ward_status='unlinked'.
  IF NEW.target_kind = 'ward' AND EXISTS (
       SELECT 1 FROM admin.authority_ward aw
        WHERE aw.authority_id = NEW.authority_id AND aw.valid_to IS NULL) THEN
    IF NOT EXISTS (SELECT 1 FROM admin.authority_ward aw
                    WHERE aw.authority_id = NEW.authority_id
                      AND aw.ward_code = NEW.target_code AND aw.valid_to IS NULL) THEN
      RAISE EXCEPTION 'ward % is not one of this council''s current wards', NEW.target_code
        USING ERRCODE = '23503';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Draft may be decided, and an approved split may be withdrawn (a revocation, so a wrong
    -- geography can be corrected without touching money); rejected/withdrawn are final. The
    -- substance of a decided allocation is immutable either way — a changed split is a new
    -- allocation, not an edit of a decided one.
    IF OLD.status <> 'draft' AND NEW.status <> OLD.status
       AND NOT (OLD.status = 'approved' AND NEW.status = 'withdrawn') THEN
      RAISE EXCEPTION 'spatial allocation is %; its decision is final', OLD.status
        USING ERRCODE = '22023';
    END IF;
    IF OLD.status <> 'draft' AND (
         NEW.subject_kind, NEW.subject_id, NEW.target_kind, NEW.target_code,
         NEW.amount, NEW.currency, NEW.share, NEW.methodology, NEW.requested_by)
       IS DISTINCT FROM (
         OLD.subject_kind, OLD.subject_id, OLD.target_kind, OLD.target_code,
         OLD.amount, OLD.currency, OLD.share, OLD.methodology, OLD.requested_by) THEN
      RAISE EXCEPTION 'a decided spatial allocation is immutable; record a new one instead'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Approval: the cumulative approved total may not exceed the subject's canonical total in this
  -- currency. For a budget line that is revised_amount from the canonical view (original plus
  -- approved revisions); for a project it is the funded project_allocation total. A project with
  -- no funding allocation in this currency has nothing to attribute and is refused.
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status <> 'approved') THEN
    IF NEW.subject_kind = 'budget_line' THEN
      SELECT p.revised_amount INTO v_cap
        FROM finance.v_budget_line_performance p WHERE p.budget_line_id = NEW.subject_id;
      v_total := coalesce((
        SELECT sum(a.amount) FROM finance.spatial_allocation a
         WHERE a.subject_kind = 'budget_line' AND a.subject_id = NEW.subject_id
           AND a.currency = NEW.currency AND a.status = 'approved' AND a.deleted_at IS NULL
           AND a.id <> NEW.id), 0);
    ELSE
      v_cap := coalesce((
        SELECT sum(pa.amount) FROM finance.project_allocation pa
         WHERE pa.project_id = NEW.subject_id AND pa.currency = NEW.currency
           AND pa.deleted_at IS NULL), 0);
      v_total := coalesce((
        SELECT sum(a.amount) FROM finance.spatial_allocation a
         WHERE a.subject_kind = 'project' AND a.subject_id = NEW.subject_id
           AND a.currency = NEW.currency AND a.status = 'approved' AND a.deleted_at IS NULL
           AND a.id <> NEW.id), 0);
    END IF;

    IF v_cap IS NULL THEN
      RAISE EXCEPTION 'the budget line no longer exists to allocate against' USING ERRCODE = '23503';
    END IF;
    IF v_cap = 0 THEN
      RAISE EXCEPTION 'the % has no funded total in % to attribute geographically',
        NEW.subject_kind, NEW.currency USING ERRCODE = '22023';
    END IF;
    IF v_total + NEW.amount > v_cap THEN
      RAISE EXCEPTION 'approved spatial allocations (%) plus this one (%) exceed the subject''s total (%) in %',
        v_total, NEW.amount, v_cap, NEW.currency USING ERRCODE = '22023';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_spatial_allocation_guard
  BEFORE INSERT OR UPDATE ON finance.spatial_allocation
  FOR EACH ROW EXECUTE FUNCTION finance.spatial_allocation_guard();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3. WARD-CODE NORMALISATION
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ward_code stays text on budget_line / transaction / project by design (a budget must not be
-- blocked by an unloaded national register), but whitespace-only codes are noise that would fork
-- the ward dimension, so they become NULL at the door.

CREATE OR REPLACE FUNCTION finance.normalise_ward_code() RETURNS trigger AS $$
BEGIN
  IF NEW.ward_code IS NOT NULL THEN
    NEW.ward_code := NULLIF(btrim(NEW.ward_code), '');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_budget_line_ward_code
  BEFORE INSERT OR UPDATE OF ward_code ON finance.budget_line
  FOR EACH ROW EXECUTE FUNCTION finance.normalise_ward_code();
CREATE TRIGGER trg_transaction_ward_code
  BEFORE INSERT OR UPDATE OF ward_code ON finance.transaction
  FOR EACH ROW EXECUTE FUNCTION finance.normalise_ward_code();
CREATE TRIGGER trg_project_ward_code
  BEFORE INSERT OR UPDATE OF ward_code ON finance.project
  FOR EACH ROW EXECUTE FUNCTION finance.normalise_ward_code();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4. TENANCY
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The same conversion the rest of the finance register uses (188 §13): tenant data with RLS on
-- authority_id, or pending classification when this database has no VUNGU authority yet.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    PERFORM tenancy.classify('finance.spatial_allocation', 'pending',
      'finance data awaiting the authority it belongs to');
    RETURN;
  END IF;
  PERFORM tenancy.make_tenant('finance.spatial_allocation'::regclass, 'VUNGU');
END $$;
