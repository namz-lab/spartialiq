-- 248: sending the acknowledgement moves the case on from 'registered' to 'acknowledged'.
--
-- Migration 171 made the sent letter record the acknowledgement DATE and start the clock, but left the case's STATUS at
-- 'registered', and no screen moved it on. A case then could not be assessed or decided: the workflow
-- (src/config/permitWorkflow.js) allows only registered -> acknowledged | withdrawn, and the EO's determination was refused
-- ("A case in 'registered' cannot move to 'approved'"). Now, when an acknowledgement letter is SENT (sent_at set, not voided):
--
--   * a case still 'registered' becomes 'acknowledged' (its revision is bumped, as for any status write), and
--   * the change is logged in the case's audit trail as 'status_changed' (automatic, with the reason), by the user the
--     request is made as (app.user_id, set for every tenant connection by src/lib/tenancy.js).
--
-- A case already past 'registered' is not touched. An unsent draft does not move it, as it does not start the clock (171).
-- The rest of the road is moved by the work itself (src/services/caseProgress.js): the first circulation, then the Act's
-- questions.
--
-- Existing cases whose letter was sent but which were left 'registered' are moved now, logged as done by this migration.

CREATE OR REPLACE FUNCTION spatial_planning.clerk_ack_records_date() RETURNS trigger AS $$
DECLARE
  actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  moved int;
BEGIN
  IF NEW.sent_at IS NULL OR NEW.voided_at IS NOT NULL THEN RETURN NULL; END IF;
  UPDATE spatial_planning.permit_application
     SET acknowledged_at = (NEW.sent_at AT TIME ZONE 'Africa/Harare')::date
   WHERE id = NEW.permit_application_id AND acknowledged_at IS NULL;

  UPDATE spatial_planning.permit_application
     SET status = 'acknowledged', revision = revision + 1, updated_at = now()
   WHERE id = NEW.permit_application_id AND status = 'registered';
  GET DIAGNOSTICS moved = ROW_COUNT;
  IF moved > 0 THEN
    INSERT INTO spatial_planning.permit_event (permit_app_id, event_type, actor_id, actor_role, detail)
    VALUES (NEW.permit_application_id, 'status_changed', actor, NULL,
            jsonb_build_object('status', 'acknowledged', 'from_status', 'registered', 'automatic', true,
                               'reason', 'The acknowledgement letter ' || NEW.letter_no || ' was sent.'));
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

-- The cases already acknowledged by a sent letter but left 'registered'.
WITH stuck AS (
  SELECT DISTINCT ON (p.id) p.id, a.letter_no
    FROM spatial_planning.permit_application p
    JOIN spatial_planning.clerk_acknowledgement a
      ON a.permit_application_id = p.id AND a.sent_at IS NOT NULL AND a.voided_at IS NULL
   WHERE p.status = 'registered'
   ORDER BY p.id, a.sent_at
), moved AS (
  UPDATE spatial_planning.permit_application p
     SET status = 'acknowledged', revision = p.revision + 1, updated_at = now()
    FROM stuck
   WHERE p.id = stuck.id
  RETURNING p.id, stuck.letter_no
)
INSERT INTO spatial_planning.permit_event (permit_app_id, event_type, actor_id, actor_role, detail)
SELECT id, 'status_changed', NULL, NULL,
       jsonb_build_object('status', 'acknowledged', 'from_status', 'registered', 'automatic', true,
                          'reason', 'Migration 248: the acknowledgement letter ' || letter_no || ' had been sent.')
  FROM moved;
