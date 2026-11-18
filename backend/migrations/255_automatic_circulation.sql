-- 255: circulation is automatic. The departments an application goes to follow from what it is, not from a planner's pick.
--
-- Until now the planner chose, case by case, which departments to circulate an application to (the EO console's
-- Circulation screen, the planner's due-diligence step and the case's Referrals panel). A department could be left out,
-- a blocking one sent as non-blocking, or nothing sent at all: five cases on the live system were under review with no
-- referral. Now:
--
--   * spatial_planning.circulation_rule says which departments each kind of development goes to, whether the case waits
--     for the reply (blocking), how many days the department has, and why it is asked (the rule's `ask`, which the
--     screens show beside the referral). A rule with no development_type applies to every application.
--   * spatial_planning.circulate_case(case, reason) creates each referral the rules require and the case does not yet
--     have, logs each one ('referral_created', automatic, with the rule), and moves an acknowledged case into circulation.
--     It never removes or changes a referral already made, and never duplicates one.
--   * A trigger runs it when a case becomes 'acknowledged' (the acknowledgement letter sent, migration 248), and again
--     when an open case's development type is corrected, so a department the new type needs is added.
--   * Cases already acknowledged or in circulation are circulated now. Cases further on (under review and after) are
--     not touched: the planning office can apply the rules to one of them (POST /permit-applications/:id/circulate).
--
-- The rules (14 days to reply unless said otherwise):
--   every application   Roads and Works (engineering), blocking: the infrastructure-cost test, RTCP Act s.26(5), and
--                       roads, stormwater, water and sewer; access onto a council road (Roads Act)
--   new building        Environmental health (sanitation, Public Health Act); Fire (fire safety, building by-laws)
--   extension,
--   alteration          Environmental health (sanitation)
--   change of use       Environmental health, blocking (a new use, often trade or food, Public Health Act); Fire
--   subdivision         Survey, blocking (layout, survey and road reserves, s.40 and s.41); Environmental health;
--                       Housing; Electricity; Environment (EMA Act: whether an EIA is required)
--   consolidation       Survey, blocking
--   rezoning            Environment; Housing
-- Idempotent. A tenant table: each council can change its own rules.

CREATE TABLE IF NOT EXISTS spatial_planning.circulation_rule (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL REFERENCES public.local_authorities (id),
  development_type  text REFERENCES public.development_activity (code) ON UPDATE CASCADE,   -- NULL: every application
  body_name         varchar(120) NOT NULL,
  blocking          boolean NOT NULL DEFAULT false,
  reply_days        integer NOT NULL DEFAULT 14 CHECK (reply_days BETWEEN 1 AND 90),
  ask               text NOT NULL CHECK (length(trim(ask)) >= 10),
  active            boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 100,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS circulation_rule_one_per_body
  ON spatial_planning.circulation_rule (authority_id, COALESCE(development_type, '*'), lower(body_name));
COMMENT ON TABLE spatial_planning.circulation_rule IS
  'Which departments each kind of development is circulated to, blocking or not, the days to reply, and why (migration 255).';

INSERT INTO spatial_planning.circulation_rule (authority_id, development_type, body_name, blocking, reply_days, ask, sort_order)
SELECT la.id, r.development_type, r.body_name, r.blocking, 14, r.ask, r.sort_order
  FROM public.local_authorities la
 CROSS JOIN (VALUES
  (NULL,            'engineering',          true,  'The infrastructure-cost test (RTCP Act s.26(5)): would the development cause the council additional or premature spending on roads, parking, drainage, sewerage or water? Roads, stormwater, water and sewer, and any access onto a council road (Roads Act).', 10),
  ('new_building',  'environmental_health', false, 'Sanitation, drainage and the health of the occupants (Public Health Act).', 20),
  ('new_building',  'fire',                 false, 'Fire safety: access for the fire tender, escape and fire-fighting water (building by-laws).', 30),
  ('extension',     'environmental_health', false, 'Sanitation and drainage for the enlarged building (Public Health Act).', 20),
  ('alteration',    'environmental_health', false, 'Sanitation and drainage for the altered building (Public Health Act).', 20),
  ('change_of_use', 'environmental_health', true,  'The new use: trade, food or other premises the Public Health Act regulates, and their sanitation.', 20),
  ('change_of_use', 'fire',                 false, 'Fire safety for the new use: access, escape and fire-fighting water.', 30),
  ('subdivision',   'survey',               true,  'The layout: survey, stand sizes and road reserves (RTCP Act s.40 and s.41; Land Survey Act).', 15),
  ('subdivision',   'environmental_health', false, 'Sanitation for the new stands: sewer or on-site systems, and their spacing (Public Health Act).', 20),
  ('subdivision',   'housing',              false, 'The housing the layout provides, against the council''s housing needs and waiting list.', 40),
  ('subdivision',   'electricity',          false, 'Power supply to the new stands, and wayleaves.', 50),
  ('subdivision',   'environment',          false, 'Whether an environmental impact assessment is required (Environmental Management Act), and the effect on wetlands and streams.', 60),
  ('consolidation', 'survey',               true,  'The consolidated parcel: survey and the new diagram (Land Survey Act).', 15),
  ('rezoning',      'environment',          false, 'The environmental effect of the change of zone (Environmental Management Act).', 60),
  ('rezoning',      'housing',              false, 'The effect of the change of zone on land for housing.', 40)
 ) AS r (development_type, body_name, blocking, ask, sort_order)
 WHERE la.code = 'VUNGU'
ON CONFLICT DO NOTHING;

SELECT tenancy.make_tenant('spatial_planning.circulation_rule', 'VUNGU');

-- ── Applying the rules to a case ───────────────────────────────────────────────────────────
-- Roads and Works answers referrals under several names (src/routes/roads-works-referrals.js): one of them already on
-- the case counts as the engineering referral.
CREATE OR REPLACE FUNCTION spatial_planning.same_department(p_rule text, p_body text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(p_rule) = lower(p_body)
      OR (lower(p_rule) = 'engineering'
          AND (lower(p_body) IN ('roads and works', 'roads_and_works', 'traffic', 'water_sewer') OR lower(p_body) LIKE 'engineering%'))
$$;

CREATE OR REPLACE FUNCTION spatial_planning.circulate_case(p_permit uuid, p_reason text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  actor  uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  c      record;
  r      record;
  cid    uuid;
  made   integer := 0;
  moved  integer;
BEGIN
  SELECT id, status, development_type, authority_id INTO c FROM spatial_planning.permit_application WHERE id = p_permit;
  IF NOT FOUND THEN RETURN 0; END IF;
  FOR r IN
    SELECT * FROM spatial_planning.circulation_rule
     WHERE active AND authority_id = c.authority_id
       AND (development_type IS NULL OR development_type = c.development_type)
     ORDER BY sort_order, body_name
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM spatial_planning.application_consultation x
       WHERE x.permit_app_id = c.id AND x.task_status <> 'cancelled' AND spatial_planning.same_department(r.body_name, x.body_name));
    INSERT INTO spatial_planning.application_consultation
      (permit_app_id, body_name, circulated_at, response_due_at, priority, task_type, blocking, created_by)
    VALUES (c.id, r.body_name, current_date, current_date + r.reply_days, 'normal', 'circulation', r.blocking, actor)
    RETURNING id INTO cid;
    INSERT INTO spatial_planning.permit_event (permit_app_id, event_type, actor_id, actor_role, detail)
    VALUES (c.id, 'referral_created', actor, NULL,
            jsonb_build_object('consultation_id', cid, 'body_name', r.body_name, 'blocking', r.blocking,
                               'automatic', true, 'rule_id', r.id, 'reason', p_reason));
    made := made + 1;
  END LOOP;
  IF made > 0 THEN
    UPDATE spatial_planning.permit_application
       SET status = 'circulation', revision = revision + 1, updated_at = now()
     WHERE id = c.id AND status = 'acknowledged';
    GET DIAGNOSTICS moved = ROW_COUNT;
    IF moved > 0 THEN
      INSERT INTO spatial_planning.permit_event (permit_app_id, event_type, actor_id, actor_role, detail)
      VALUES (c.id, 'status_changed', actor, NULL,
              jsonb_build_object('status', 'circulation', 'from_status', 'acknowledged', 'automatic', true,
                                 'reason', 'Circulated automatically to ' || made || ' department(s): ' || p_reason));
    END IF;
  END IF;
  RETURN made;
END $$;

COMMENT ON FUNCTION spatial_planning.circulate_case(uuid, text) IS
  'Creates the referrals the circulation rules require and the case does not have; moves an acknowledged case into circulation (migration 255).';

-- ── When it runs ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION spatial_planning.circulate_on_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'acknowledged' AND OLD.status IS DISTINCT FROM 'acknowledged' THEN
    PERFORM spatial_planning.circulate_case(NEW.id, 'the case was acknowledged.');
  ELSIF NEW.development_type IS DISTINCT FROM OLD.development_type
        AND NEW.status IN ('circulation', 'objection_period', 'under_review', 'awaiting_eo_decision', 'deferred') THEN
    PERFORM spatial_planning.circulate_case(NEW.id, 'the development type was corrected to ' || NEW.development_type || '.');
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_permit_circulate ON spatial_planning.permit_application;
CREATE TRIGGER trg_permit_circulate AFTER UPDATE OF status, development_type ON spatial_planning.permit_application
  FOR EACH ROW EXECUTE FUNCTION spatial_planning.circulate_on_change();

-- ── The cases already acknowledged or in circulation ──────────────────────────────────────
SELECT spatial_planning.circulate_case(id, 'migration 255: circulation became automatic.')
  FROM spatial_planning.permit_application
 WHERE status IN ('acknowledged', 'circulation');
