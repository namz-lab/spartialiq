-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 220 — SPATIAL TABLE NAMES: ZONES AND COUNCIL POINTS MOVE TO THEIR CONVENTION NAMES
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/220_spatial_table_names.down.sql.
-- Follows docs/SPATIAL-NAMING-CONVENTION.md: no authority or source in a name, singular names, a schema for the domain.
--
--   public.proposed_peri_urban_zones   ->  spatial_planning.zone       (planning_zone)
--   public.vungu_cemeteries            ->  council_ops.cemetery        (cemetery)
--   public.vungu_waste_management      ->  council_ops.waste_facility  (waste_facility)
--   public.gweru_health_centres        ->  council_ops.health_facility (health_facility, a new concept)
--
-- Each OLD NAME stays, as a view over the new table with the same columns in the same order. The tile config, the QGIS
-- project, the portal catalogue and every query keep working, and a write through the old name still reaches the new
-- table (a simple, auto-updatable view; security_invoker, so row-level security still applies to the caller). Foreign
-- keys, triggers, policies, indexes and the views that depend on a table follow it (they bind by object id). Columns keep
-- their names: renaming `zone` to `name` or `fid` to `id` is a separate step.
--
-- Also: the raw import copy of the peri-urban zones is retired (renamed, not dropped), and the registry
-- (spatial_concept, spatial_concept_source) classifies every spatial relation again, so scripts/verify-spatial-registry.js passes.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ── Helper: move a table and leave a compatibility view at the old name ────────────────────
CREATE FUNCTION pg_temp.move_with_view(p_old_schema text, p_old text, p_new_schema text, p_new text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  v_old   regclass := to_regclass(format('%I.%I', p_old_schema, p_old));
  v_cols  text;
  v_grant record;
  v_grants jsonb := '[]'::jsonb;
  v_class text;
  v_note  text;
  r record;
BEGIN
  IF v_old IS NULL OR (SELECT relkind FROM pg_class WHERE oid = v_old) <> 'r' THEN
    RAISE NOTICE '% . % is not a table here (already moved, or not built): skipped', p_old_schema, p_old;
    RETURN;
  END IF;

  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_cols
    FROM pg_attribute WHERE attrelid = v_old AND attnum > 0 AND NOT attisdropped;

  FOR v_grant IN
    SELECT grantee, privilege_type FROM information_schema.role_table_grants
     WHERE table_schema = p_old_schema AND table_name = p_old
       AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE') AND grantee <> 'postgres'
  LOOP
    v_grants := v_grants || jsonb_build_array(jsonb_build_array(v_grant.grantee, v_grant.privilege_type));
  END LOOP;

  SELECT class, note INTO v_class, v_note FROM tenancy.relation_class WHERE relation = format('%s.%s', p_old_schema, p_old);

  IF p_old_schema <> p_new_schema THEN
    EXECUTE format('ALTER TABLE %I.%I SET SCHEMA %I', p_old_schema, p_old, p_new_schema);
  END IF;
  EXECUTE format('ALTER TABLE %I.%I RENAME TO %I', p_new_schema, p_old, p_new);

  -- Tidy the names the table owns: its sequences and indexes.
  FOR r IN
    SELECT s.relname FROM pg_class s
      JOIN pg_depend d ON d.objid = s.oid AND d.deptype IN ('a', 'i')
     WHERE s.relkind = 'S' AND d.refobjid = to_regclass(format('%I.%I', p_new_schema, p_new))
  LOOP
    IF position(p_old IN r.relname) > 0 THEN
      EXECUTE format('ALTER SEQUENCE %I.%I RENAME TO %I', p_new_schema, r.relname, replace(r.relname, p_old, p_new));
    END IF;
  END LOOP;
  FOR r IN SELECT indexname FROM pg_indexes WHERE schemaname = p_new_schema AND tablename = p_new AND position(p_old IN indexname) > 0
  LOOP
    EXECUTE format('ALTER INDEX %I.%I RENAME TO %I', p_new_schema, r.indexname, replace(r.indexname, p_old, p_new));
  END LOOP;

  EXECUTE format('CREATE VIEW %I.%I WITH (security_invoker = true) AS SELECT %s FROM %I.%I',
                 p_old_schema, p_old, v_cols, p_new_schema, p_new);
  EXECUTE format('COMMENT ON VIEW %I.%I IS %L', p_old_schema, p_old,
                 format('Compatibility view: this table is now %s.%s (docs/SPATIAL-NAMING-CONVENTION.md). Readers move to the new name in steps.', p_new_schema, p_new));

  FOR r IN SELECT value ->> 0 AS grantee, value ->> 1 AS priv FROM jsonb_array_elements(v_grants)
  LOOP
    EXECUTE format('GRANT %s ON %I.%I TO %s', r.priv, p_old_schema, p_old,
                   CASE WHEN r.grantee = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(r.grantee) END);
  END LOOP;

  -- Tenancy: the table's classification moves with it; the view is classified like a tenant view if the table is tenant data.
  IF v_class IS NOT NULL THEN
    DELETE FROM tenancy.relation_class WHERE relation = format('%s.%s', p_new_schema, p_new);  -- a view of that name (migration 219) was classified
    UPDATE tenancy.relation_class SET relation = format('%s.%s', p_new_schema, p_new) WHERE relation = format('%s.%s', p_old_schema, p_old);
    PERFORM tenancy.classify(format('%s.%s', p_old_schema, p_old),
                             CASE WHEN v_class IN ('tenant', 'tenant_child') THEN 'tenant_view' ELSE v_class END,
                             format('compatibility view over %s.%s', p_new_schema, p_new));
  END IF;
END $fn$;

-- ── 1. Zones ───────────────────────────────────────────────────────────────────────────────
-- The view 219 made under the new name gives way to the real table.
DROP VIEW IF EXISTS spatial_planning.zone;
SELECT pg_temp.move_with_view('public', 'proposed_peri_urban_zones', 'spatial_planning', 'zone');

-- ── 2. Council points ──────────────────────────────────────────────────────────────────────
-- On a database built from the migrations alone the cemetery and waste layers are loaded afterwards (scripts/load-master-plan.js), so
-- their tables may not exist yet: create them empty, under the old names, so they move like the rest. The columns are the ones the
-- GeoPackage layers carry.
DO $$
BEGIN
  IF to_regclass('public.vungu_cemeteries') IS NULL AND to_regclass('council_ops.cemetery') IS NULL THEN
    CREATE TABLE public.vungu_cemeteries (fid serial PRIMARY KEY, id bigint, name varchar(255), geom geometry(MultiPolygon, 4326));
    CREATE INDEX vungu_cemeteries_geom_geom_idx ON public.vungu_cemeteries USING gist (geom);
  END IF;
  IF to_regclass('public.vungu_waste_management') IS NULL AND to_regclass('council_ops.waste_facility') IS NULL THEN
    CREATE TABLE public.vungu_waste_management (fid serial PRIMARY KEY, geom geometry(MultiPolygon, 4326), id bigint, use varchar(80));
    CREATE INDEX vungu_waste_management_geom_geom_idx ON public.vungu_waste_management USING gist (geom);
  END IF;
END $$;

SELECT pg_temp.move_with_view('public', 'vungu_cemeteries', 'council_ops', 'cemetery');
SELECT pg_temp.move_with_view('public', 'vungu_waste_management', 'council_ops', 'waste_facility');
SELECT pg_temp.move_with_view('public', 'gweru_health_centres', 'council_ops', 'health_facility');

-- Read access for the roles the API runs as, on the tables and on the compatibility views (a no-op where the move already carried it).
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['council_ops.cemetery', 'public.vungu_cemeteries', 'council_ops.waste_facility', 'public.vungu_waste_management',
                           'council_ops.health_facility', 'public.gweru_health_centres']
  LOOP
    IF to_regclass(r) IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN EXECUTE format('GRANT SELECT ON %s TO vungu_app', r); END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO vungu_system', r); END IF;
    END IF;
  END LOOP;
  PERFORM tenancy.classify('council_ops.cemetery', 'pending', 'authority-owned data with no row-level security yet: a gap to close')
    WHERE NOT EXISTS (SELECT 1 FROM tenancy.relation_class WHERE relation = 'council_ops.cemetery');
  PERFORM tenancy.classify('council_ops.waste_facility', 'pending', 'authority-owned data with no row-level security yet: a gap to close')
    WHERE NOT EXISTS (SELECT 1 FROM tenancy.relation_class WHERE relation = 'council_ops.waste_facility');
END $$;

-- ── 3. Retire the raw copy of the peri-urban zones (kept, renamed) ─────────────────────────
DO $$
BEGIN
  IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.vungu_proposed_peri_urban_zones')) = 'r' THEN
    ALTER TABLE public.vungu_proposed_peri_urban_zones RENAME TO vungu_proposed_peri_urban_zones_retired;
    COMMENT ON TABLE public.vungu_proposed_peri_urban_zones_retired IS
      'Raw import copy of the peri-urban zones, retired by migration 220: the zones live in spatial_planning.zone. Safe to drop.';
  END IF;
END $$;

-- ── 4. The registry ────────────────────────────────────────────────────────────────────────
INSERT INTO public.spatial_concept (code, name, domain, geometry_kind, status, authority_scoped, target_relation, description) VALUES
  ('health_facility',  'Health facility',  'infrastructure', 'point',   'partial', false, 'council_ops.health_facility', 'A clinic or health centre and what it offers.'),
  ('polling_area',     'Polling area',     'admin',          'polygon', 'partial', false, 'admin.polling_area',          'An Electoral Commission polling area, with its registered voters.'),
  ('polling_station',  'Polling station',  'admin',          'point',   'partial', false, 'admin.polling_station',       'The place where a polling area votes (often a school or clinic).'),
  ('capital_project',  'Capital project',  'infrastructure', 'point',   'partial', true,  'finance.project',             'A council capital project, with its place.')
ON CONFLICT (code) DO NOTHING;

-- (relation, concept, role, note): the one canonical source per concept, and what each old name now is.
INSERT INTO public.spatial_concept_source (relation, concept_code, role, note) VALUES
  ('spatial_planning.zone',                      'planning_zone',   'canonical', 'the one zones table: the peri-urban zones and the areas beyond them (scale_category), filed under a plan'),
  ('public.proposed_peri_urban_zones',           'planning_zone',   'derived',   'compatibility view over spatial_planning.zone (migration 220)'),
  ('public.vungu_proposed_peri_urban_zones_retired', 'planning_zone', 'legacy',  'raw import copy, retired'),
  ('public.vungu_beyond_peri_urban_zones',       'planning_zone',   'derived',   'view of the beyond-peri-urban areas in spatial_planning.zone'),
  ('public.vungu_beyond_peri_urban_zones_retired', 'planning_zone', 'legacy',    'raw import copy, retired'),
  ('council_ops.cemetery',                       'cemetery',        'canonical', ''),
  ('public.vungu_cemeteries',                    'cemetery',        'derived',   'compatibility view over council_ops.cemetery'),
  ('council_ops.waste_facility',                 'waste_facility',  'canonical', ''),
  ('public.vungu_waste_management',              'waste_facility',  'derived',   'compatibility view over council_ops.waste_facility'),
  ('council_ops.health_facility',                'health_facility', 'canonical', 'the facilities list from the Ministry of Health file, as loaded'),
  ('public.gweru_health_centres',                'health_facility', 'derived',   'compatibility view over council_ops.health_facility'),
  ('admin.chiefdom',                             'chiefdom',        'canonical', 'the five chiefs'' areas of Vungu (migration 218)'),
  ('admin.business_centre',                      'place',           'source',    'business centres, rural service centres and growth points of Vungu'),
  ('admin.river',                                'watercourse',     'source',    'river lines of Vungu from the legacy layer; most carry no name'),
  ('admin.polling_area',                         'polling_area',    'canonical', 'Electoral Commission polling areas of Vungu RDC, with voters'),
  ('admin.polling_station',                      'polling_station', 'canonical', 'Electoral Commission polling stations of Vungu RDC'),
  ('finance.project',                            'capital_project', 'canonical', 'capital projects with a place, for the ward maps'),
  ('gis_ops.feature',                            'managed_feature', 'source',    'features edited through an edit session'),
  ('gis_ops.feature_version',                    'managed_feature', 'source',    'append-only history of edited features'),
  ('land.parcel_event',                          'cadastral_parcel','source',    'parcel history'),
  ('public.stand_subunit',                       'cadastral_parcel','source',    'Acua sub-units of larger stands'),
  ('public.acua_stands_tile_view',               'cadastral_parcel','derived',   'view over stand_subunit for the tile server'),
  ('spatial_engine.v_authority_ward',            'admin_ward',      'derived',   'the council''s current wards, with area')
ON CONFLICT (relation) DO UPDATE SET concept_code = EXCLUDED.concept_code, role = EXCLUDED.role,
  note = COALESCE(NULLIF(EXCLUDED.note, ''), public.spatial_concept_source.note);

-- Rows that named the old tables as the canonical or legacy source now say so under the new names; one canonical per concept.
UPDATE public.spatial_concept_source SET role = 'legacy', note = 'superseded by admin.chiefdom' WHERE relation = 'public.gweru_chiefdoms';
DELETE FROM public.spatial_concept_source WHERE relation = 'public.vungu_proposed_peri_urban_zones';

-- Tenancy: the retired copies and the new relations.
DELETE FROM tenancy.relation_class WHERE relation = 'public.vungu_proposed_peri_urban_zones';
DO $$
BEGIN
  PERFORM tenancy.classify('public.vungu_proposed_peri_urban_zones_retired', 'pending', 'retired raw copy; safe to drop');
  PERFORM tenancy.classify('public.vungu_beyond_peri_urban_zones_retired', 'pending', 'retired raw copy; safe to drop');
END $$;
