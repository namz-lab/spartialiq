-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 239 — THE CONTROLS THE EO PLANNING WORKING WORKFLOW CALLS FOR
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/239_eo_workflow_controls.down.sql.
-- Depends on: 167 (tenancy.make_tenant), 170 and 171 (the statutory clock), 083 (committee agenda).
-- Read with: docs/workflows/eo-planning-working-workflow.md (the rules and switches S1 to S8) and docs/workflows/eo-planning-code-gap-report.md.
--
--   delegation_switch        the switches S1 to S8 of the working workflow: what the council has confirmed in writing, the evidence for it, who
--                            confirmed it. A switch with no row is OFF. Nothing here lets the EO decide alone; it records whether the
--                            council has said she may.
--   delegation_switch_event  every change to a switch, kept.
--   case_referral            the referral log: what the council sent to the Department, the Minister or another body (on a case or on a topic),
--                            when, the reply-by date, what came back and what the council did with it ("no reply" is recorded, not assumed).
--   ministerial_direction    the register of directions under ss.29, 69 and 70, with whether each refers cases to the Minister or restricts them.
--   permit_application       + the written extension the APPLICANT granted (s.26(7)), the recorded direction check (step 5), and the
--                            delegation relied on for a decision.
--   v_eo_decision_queue      counts the days to deemed refusal to the extended date, when there is one.
--
-- Idempotent: IF NOT EXISTS throughout; make_tenant is repeatable.

ALTER TABLE spatial_planning.permit_application
  ADD COLUMN IF NOT EXISTS extension_until        date,
  ADD COLUMN IF NOT EXISTS extension_evidence     text,
  ADD COLUMN IF NOT EXISTS extension_recorded_by  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS direction_checked_at   timestamptz,
  ADD COLUMN IF NOT EXISTS direction_checked_by   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delegation_basis       text;

COMMENT ON COLUMN spatial_planning.permit_application.extension_until IS
  'A later date the applicant agreed IN WRITING (s.26(7)); the application is deemed refused only after it. extension_evidence says where the writing is.';
COMMENT ON COLUMN spatial_planning.permit_application.direction_checked_at IS
  'When the EO checked this case against the ministerial directions in force (working workflow, step 5). A decision needs it.';
COMMENT ON COLUMN spatial_planning.permit_application.delegation_basis IS
  'The council resolution or delegation the EO relied on when deciding alone (lane L2). Free text is no longer accepted; the switches must be on.';

-- ── the switches ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spatial_planning.delegation_switch (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  switch_key    text NOT NULL CHECK (switch_key IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8')),
  is_on         boolean NOT NULL DEFAULT false,
  evidence      text,
  confirmed_by  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  confirmed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delegation_switch_on_needs_evidence CHECK (NOT is_on OR (evidence IS NOT NULL AND length(btrim(evidence)) >= 5))
);
COMMENT ON TABLE spatial_planning.delegation_switch IS
  'The switches S1 to S8 of the EO Planning working workflow. A switch with no row is off. Turning one on needs the written confirmation named in evidence.';

CREATE TABLE IF NOT EXISTS spatial_planning.delegation_switch_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  switch_key  text NOT NULL,
  is_on       boolean NOT NULL,
  evidence    text,
  changed_by  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

-- ── the referral log ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spatial_planning.case_referral (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_app_id   uuid REFERENCES spatial_planning.permit_application (id) ON DELETE CASCADE,
  topic           text,
  kind            text NOT NULL CHECK (kind IN ('department', 'minister', 'statutory', 'other')),
  tier            text NOT NULL DEFAULT 'precautionary' CHECK (tier IN ('mandatory', 'precautionary', 'routine')),
  body            text NOT NULL,
  legal_basis     text,
  question        text NOT NULL,
  sent_on         date NOT NULL DEFAULT CURRENT_DATE,
  reply_by        date,
  answered_on     date,
  advice          text,
  council_action  text,
  no_reply        boolean NOT NULL DEFAULT false,
  created_by      uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  deleted_by      uuid REFERENCES public.users (id) ON DELETE SET NULL,
  CONSTRAINT case_referral_answer_has_advice CHECK (answered_on IS NULL OR advice IS NOT NULL),
  CONSTRAINT case_referral_case_or_topic CHECK (permit_app_id IS NOT NULL OR topic IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_case_referral_permit ON spatial_planning.case_referral (permit_app_id) WHERE deleted_at IS NULL;
COMMENT ON TABLE spatial_planning.case_referral IS
  'The referral log of the EO Planning working workflow (sections 3 and 4): the Department, the Minister and the statutory consultees; sent, reply-by, answered, what the council did, or "no reply".';

-- ── the register of ministerial directions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spatial_planning.ministerial_direction (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference           text,
  section             text NOT NULL CHECK (section IN ('s29', 's69', 's70', 'other')),
  received_on         date NOT NULL,
  summary             text NOT NULL,
  refers_to_minister  boolean NOT NULL DEFAULT false,
  restricts           boolean NOT NULL DEFAULT false,
  applies_to_dev_types text[],
  in_force            boolean NOT NULL DEFAULT true,
  ended_on            date,
  ceo_informed_on     date,
  recorded_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  deleted_by          uuid REFERENCES public.users (id) ON DELETE SET NULL
);
COMMENT ON TABLE spatial_planning.ministerial_direction IS
  'Directions and guides received under ss.29, 69 and 70 of the RTCP Act. applies_to_dev_types NULL means every class of case. While one that refers cases to the Minister or restricts them is in force, a decision of that class is stopped.';

-- the standard tenancy treatment: each row belongs to an authority; existing rows (there are none) would be Vungu's
SELECT tenancy.make_tenant('spatial_planning.delegation_switch'::regclass,       'VUNGU');
SELECT tenancy.make_tenant('spatial_planning.delegation_switch_event'::regclass, 'VUNGU');
SELECT tenancy.make_tenant('spatial_planning.case_referral'::regclass,           'VUNGU');
SELECT tenancy.make_tenant('spatial_planning.ministerial_direction'::regclass,   'VUNGU');
CREATE UNIQUE INDEX IF NOT EXISTS uq_delegation_switch_key ON spatial_planning.delegation_switch (authority_id, switch_key);

-- ── the EO inbox counts to the extended date ───────────────────────────────────────────────
CREATE OR REPLACE VIEW spatial_planning.v_eo_decision_queue AS
  SELECT
    pa.id,
    pa.dev_register_no,
    pa.tpd_reference,
    pa.stand_number,
    pa.suburb_ward,
    pa.applicant_name,
    pa.development_type,
    pa.description,
    pa.status,
    (pa.fee_paid_at IS NOT NULL) AS fee_paid,
    pa.received_at,
    pa.statutory_due_date,
    pa.recommendation,
    pa.created_at,
    pa.updated_at,
    ST_X(pa.location) AS lng,
    ST_Y(pa.location) AS lat,
    hp.id             AS handoff_id,
    hp.status         AS handoff_status,
    hp.recommendation AS handoff_recommendation,
    hp.submitted_by   AS handoff_submitted_by,
    hp.created_at     AS handoff_submitted_at,
    hp.returned_to_role,
    (GREATEST(spatial_planning.determination_deadline(pa.acknowledged_at, pa.development_type), pa.extension_until) - CURRENT_DATE)::int AS days_to_deemed,
    pa.acknowledged_at,
    CASE WHEN pa.acknowledged_at IS NULL AND pa.received_at IS NOT NULL
         THEN (pa.received_at::date + 14 - CURRENT_DATE)::int END AS ack_due_in_days
  FROM spatial_planning.permit_application pa
  LEFT JOIN LATERAL (
    SELECT * FROM spatial_planning.eo_handoff_package h
     WHERE h.permit_app_id = pa.id
     ORDER BY h.created_at DESC
     LIMIT 1
  ) hp ON TRUE
  WHERE pa.status IN (
    'awaiting_eo_decision', 'under_review', 'circulation',
    'objection_period', 'deferred'
  );
ALTER VIEW spatial_planning.v_eo_decision_queue SET (security_invoker = true);
