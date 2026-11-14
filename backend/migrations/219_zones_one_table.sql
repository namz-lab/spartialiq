-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 219 — ONE ZONES TABLE: THE BEYOND LAYER READS IT, A COMPATIBILITY VIEW, A PUBLIC-PREVIEW SWITCH
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/219_zones_one_table.down.sql.
-- Follows docs/SPATIAL-NAMING-CONVENTION.md ("How a move is made"). Zones now live in ONE table,
-- public.proposed_peri_urban_zones (scripts/load-zones.js): the peri-urban zones, and the areas beyond them marked
-- scale_category = 'Beyond the peri-urban area'.
--
--   1. public.zones_master (the peri-urban map layer and the QGIS project's source) shows the peri-urban zones only,
--      so the beyond areas are not drawn twice.
--   2. public.vungu_beyond_peri_urban_zones, a RAW import table, becomes a VIEW of that name over the one table, with the
--      columns its readers use (fid, settlement, zone_code, adm3_en, adm2_en). The tile config, the QGIS project and the
--      portal catalogue keep reading the old name and now read the same rows as everything else, under the same
--      row-level security. The raw table is kept, renamed ..._retired, until someone drops it.
--   3. spatial_planning.zone is the convention's name for the concept, as a view with the new column names.
--   4. plan_instrument.public_preview: a plan's zones are visible to the public only when the plan is gazetted. This
--      adds an explicit, reversible switch for showing a DRAFT plan in a demonstration. It is off by default; the
--      script scripts/publish-zones-preview.js turns it on and records that the plan is not gazetted.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ── 4. The public-preview switch (first, because the policy below uses it) ─────────────────
ALTER TABLE public.plan_instrument ADD COLUMN IF NOT EXISTS public_preview boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.plan_instrument.public_preview IS
  'True shows this plan''s zones to the public although the plan is not gazetted. For a demonstration of a draft only; set with scripts/publish-zones-preview.js, which says so on the layer publication record.';

ALTER POLICY tenant_select ON public.plan_instrument USING (
  app.is_platform() OR (authority_id IS NULL) OR (status = 'gazetted'::text) OR public_preview
  OR (authority_id = ANY (app.visible_authorities())));

-- ── 1. The peri-urban layer shows the peri-urban zones only ────────────────────────────────
CREATE OR REPLACE VIEW public.zones_master WITH (security_invoker = true) AS
SELECT id, zone, zone_code, is_active, display_order, geom, area_ha
  FROM public.proposed_peri_urban_zones
 WHERE scale_category IS DISTINCT FROM 'Beyond the peri-urban area';

-- ── 2. The beyond layer: the old name, now a view over the one table ───────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = 'vungu_beyond_peri_urban_zones' AND c.relkind = 'r') THEN
    ALTER TABLE public.vungu_beyond_peri_urban_zones RENAME TO vungu_beyond_peri_urban_zones_retired;
    COMMENT ON TABLE public.vungu_beyond_peri_urban_zones_retired IS
      'Raw import copy of the beyond-peri-urban polygons, retired by migration 219: the zones now live in proposed_peri_urban_zones. Safe to drop once nothing needs the original ADM3 attributes.';
  END IF;
END $$;

CREATE OR REPLACE VIEW public.vungu_beyond_peri_urban_zones WITH (security_invoker = true) AS
SELECT z.id::integer AS fid,
       z.zone AS settlement,
       z.zone_code,
       z.ward AS adm3_en,
       NULL::varchar(50) AS adm2_en,
       z.zone,
       z.zone_description AS description,
       z.area_ha,
       z.geom
  FROM public.proposed_peri_urban_zones z
 WHERE z.scale_category = 'Beyond the peri-urban area';
COMMENT ON VIEW public.vungu_beyond_peri_urban_zones IS
  'The areas beyond the peri-urban zones, from the one zones table (scale_category = Beyond the peri-urban area). settlement is the planning zone name. adm2_en is not held and is NULL.';

-- ── 3. The convention's name for the concept ───────────────────────────────────────────────
CREATE OR REPLACE VIEW spatial_planning.zone WITH (security_invoker = true) AS
SELECT z.id,
       z.plan_instrument_id AS plan_id,
       z.plan_zone_type_id  AS zone_type_id,
       z.zone               AS name,
       z.zone_code          AS code,
       z.scale_category     AS category,
       z.ward,
       z.zone_description   AS description,
       z.is_active          AS active,
       z.area_ha,
       z.geom,
       z.created_at,
       z.updated_at
  FROM public.proposed_peri_urban_zones z;
COMMENT ON VIEW spatial_planning.zone IS
  'The planning_zone concept (docs/SPATIAL-NAMING-CONVENTION.md): every zone of every plan. A compatibility view over public.proposed_peri_urban_zones, which readers move off in steps.';

-- ── Tenancy, grants, publication ───────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM tenancy.classify('public.vungu_beyond_peri_urban_zones', 'tenant_view', 'view over the one zones table, under its row-level security');
  PERFORM tenancy.classify('spatial_planning.zone', 'tenant_view', 'view over the one zones table, under its row-level security');
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT SELECT ON public.vungu_beyond_peri_urban_zones, spatial_planning.zone TO vungu_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN
    GRANT SELECT ON public.vungu_beyond_peri_urban_zones, spatial_planning.zone TO vungu_system;
  END IF;
END $$;

-- The portal may expose a table only if the server has approved it, and to whom (default deny). Staff first.
INSERT INTO public.layer_publication (table_name, audience, approved_by, note)
VALUES ('vungu_beyond_peri_urban_zones', 'staff', 'migration 219',
        'The beyond-peri-urban areas, now a view over the one zones table.')
ON CONFLICT (table_name) DO NOTHING;
