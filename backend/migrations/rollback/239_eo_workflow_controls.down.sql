-- Rollback of 239. Drops the four tables and the permit columns; the EO queue view returns to its 170 definition (days to deemed ignore extensions).
CREATE OR REPLACE VIEW spatial_planning.v_eo_decision_queue AS
  SELECT pa.id, pa.dev_register_no, pa.tpd_reference, pa.stand_number, pa.suburb_ward, pa.applicant_name, pa.development_type, pa.description, pa.status,
         (pa.fee_paid_at IS NOT NULL) AS fee_paid, pa.received_at, pa.statutory_due_date, pa.recommendation, pa.created_at, pa.updated_at,
         ST_X(pa.location) AS lng, ST_Y(pa.location) AS lat,
         hp.id AS handoff_id, hp.status AS handoff_status, hp.recommendation AS handoff_recommendation, hp.submitted_by AS handoff_submitted_by,
         hp.created_at AS handoff_submitted_at, hp.returned_to_role,
         (spatial_planning.determination_deadline(pa.acknowledged_at, pa.development_type) - CURRENT_DATE)::int AS days_to_deemed,
         pa.acknowledged_at,
         CASE WHEN pa.acknowledged_at IS NULL AND pa.received_at IS NOT NULL THEN (pa.received_at::date + 14 - CURRENT_DATE)::int END AS ack_due_in_days
    FROM spatial_planning.permit_application pa
    LEFT JOIN LATERAL (SELECT * FROM spatial_planning.eo_handoff_package h WHERE h.permit_app_id = pa.id ORDER BY h.created_at DESC LIMIT 1) hp ON TRUE
   WHERE pa.status IN ('awaiting_eo_decision', 'under_review', 'circulation', 'objection_period', 'deferred');
ALTER VIEW spatial_planning.v_eo_decision_queue SET (security_invoker = true);

DELETE FROM tenancy.relation_class WHERE relation IN ('spatial_planning.delegation_switch', 'spatial_planning.delegation_switch_event', 'spatial_planning.case_referral', 'spatial_planning.ministerial_direction');
DROP TABLE IF EXISTS spatial_planning.case_referral;
DROP TABLE IF EXISTS spatial_planning.ministerial_direction;
DROP TABLE IF EXISTS spatial_planning.delegation_switch_event;
DROP TABLE IF EXISTS spatial_planning.delegation_switch;
ALTER TABLE spatial_planning.permit_application
  DROP COLUMN IF EXISTS extension_until, DROP COLUMN IF EXISTS extension_evidence, DROP COLUMN IF EXISTS extension_recorded_by,
  DROP COLUMN IF EXISTS direction_checked_at, DROP COLUMN IF EXISTS direction_checked_by, DROP COLUMN IF EXISTS delegation_basis;
