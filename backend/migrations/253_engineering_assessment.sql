-- 253: the Department of Roads and Works' assessment of a planning application.
--
-- Engineering is on the planning office's standing circulation list (application_consultation.body_name = 'engineering'),
-- but until now nobody in Roads and Works could answer it. This is what the District Engineer (or a Civil Engineering
-- Technician) records when they do, alongside the department's reply on the consultation itself:
--
--   1. THE INFRASTRUCTURE-COST TEST. Regional, Town and Country Planning Act [Chapter 29:12] s.26(5): in considering an
--      application the local planning authority examines whether the development would result in additional or premature
--      expenditure by the local authority on new roads or the improvement of existing roads, parking, sewerage or drainage
--      services, or the supply of water; and may, if it grants the application, make it a condition of the permit that the
--      applicant meets or assists in meeting that cost, on or off the site. Roads and Works answers each of those heads,
--      estimates the cost, and proposes the condition for the EO.
--
--   2. SUBDIVISION ROADS. s.41(1)(a): a subdivision permit may require land to be set aside for road purposes, which the
--      council acquires free of cost on approval of the survey (s.41(2)); s.41(3): land for a road wider than 24 metres is
--      acquired only up to 24 metres free of cost, the excess as land for public purposes or under s.45. Roads and Works
--      records whether the layout's road reserves are adequate, the widest reserve, and the length of new road.
--
--   3. ACCESS ONTO A COUNCIL ROAD. Under the Roads Act [Chapter 13:18] the council is the road authority for the tertiary
--      roads of its area; an access onto one is the council's to allow, on conditions. (Access to a State road is the
--      roads minister's, through the s.26(2)(c) / s.40(2)(c) referral the system already records.)
--
-- One assessment per engineering consultation. A tenant table (tenancy.make_tenant). Idempotent.

CREATE TABLE IF NOT EXISTS spatial_planning.engineering_assessment (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id        uuid NOT NULL UNIQUE REFERENCES spatial_planning.application_consultation (id) ON DELETE CASCADE,
  permit_app_id          uuid NOT NULL REFERENCES spatial_planning.permit_application (id) ON DELETE CASCADE,

  -- 1. s.26(5): would the development cause additional or premature spending on ...
  cost_roads             boolean,
  cost_parking           boolean,
  cost_drainage          boolean,
  cost_sewerage          boolean,
  cost_water             boolean,
  estimated_cost         numeric(14,2) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  cost_currency          varchar(3) CHECK (cost_currency IS NULL OR cost_currency IN ('USD', 'ZWG')),
  cost_condition         text,          -- the condition Roads and Works proposes under s.26(5)

  -- 2. s.41: a subdivision's roads
  road_reserves_adequate boolean,
  widest_road_reserve_m  numeric(6,2) CHECK (widest_road_reserve_m IS NULL OR widest_road_reserve_m > 0),
  new_road_length_m      numeric(10,1) CHECK (new_road_length_m IS NULL OR new_road_length_m >= 0),

  -- 3. Roads Act: access onto a council road
  access_road_asset_id   uuid REFERENCES council_ops.road_asset (id) ON DELETE SET NULL,
  access_approved        boolean,
  access_conditions      text,

  assessed_by            uuid REFERENCES public.users (id) ON DELETE SET NULL,
  assessed_role          varchar(40),
  assessed_at            timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- s.26(5): a cost found must come with the condition that recovers it
  CONSTRAINT engineering_cost_has_condition CHECK (
    NOT (COALESCE(cost_roads, false) OR COALESCE(cost_parking, false) OR COALESCE(cost_drainage, false)
         OR COALESCE(cost_sewerage, false) OR COALESCE(cost_water, false))
    OR (cost_condition IS NOT NULL AND length(trim(cost_condition)) >= 10)),
  -- an access allowed or refused names the road
  CONSTRAINT engineering_access_names_road CHECK (access_approved IS NULL OR access_road_asset_id IS NOT NULL)
);
COMMENT ON TABLE spatial_planning.engineering_assessment IS
  'Roads and Works'' assessment of a planning application: the s.26(5) infrastructure-cost test, a subdivision''s roads (s.41) and access onto a council road (Roads Act). One per engineering consultation (migration 253).';
CREATE INDEX IF NOT EXISTS idx_engineering_assessment_permit ON spatial_planning.engineering_assessment (permit_app_id);

SELECT tenancy.make_tenant('spatial_planning.engineering_assessment', 'VUNGU');
