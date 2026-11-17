#!/usr/bin/env bash
# Copy the Planning register's real stand and ward records from the LIVE database into the LOCAL
# demo database (Docker container lamis-db), so the finance GIS demonstration draws real geometry.
#
#   bash backend/scripts/copy-planning-register-to-local.sh
#
# LIVE IS ONLY READ. Every live query runs inside `BEGIN READ ONLY`, and nothing is written there.
# What is copied, unchanged and with the same keys:
#   gis_ops.crs_registry   the survey CRS the Hertfordshire general plan was captured in (2053)
#   land.general_plan      the DXF-HERTS import record
#   admin.ward             the 19 Vungu wards (ZEC 2023 delimitation) and the wards the layout stands name
#   admin.authority_ward   the council's ward links
#   land.parcel            every current stand (parcel_kind = 'stand'): 1,589 HERTS + the layout stands
#   land.stand_offer       the stands the council has put on offer (live labels these as demonstration offers)
# Rows already present locally are left as they are (ON CONFLICT DO NOTHING), so it can be re-run.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LIVE="$(grep '^DATABASE_URL=' "$ROOT/backend/.env" | cut -d= -f2-)"
case "$LIVE" in *neon.tech*) ;; *) echo "backend/.env does not point at the live database; nothing copied."; exit 1;; esac
LOCAL=(docker exec -i lamis-db psql -U postgres -d vungu_master_db_v1 -X -v ON_ERROR_STOP=1 -q)

# Each table goes through a binary COPY file placed in the container, then an INSERT from it.
xfer() { # $1 = name, $2 = live SELECT, $3 = local table, $4 = columns, $5 = conflict clause
  local f="/tmp/plan-copy-$1.bin"
  psql "$LIVE" -X -q -v ON_ERROR_STOP=1 -c "\\copy ($2) TO STDOUT WITH (FORMAT binary)" \
    | docker exec -i lamis-db sh -c "cat > $f"
  "${LOCAL[@]}" <<SQL
BEGIN;
CREATE TEMP TABLE _in AS SELECT $4 FROM $3 WITH NO DATA;
COPY _in ($4) FROM '$f' WITH (FORMAT binary);
INSERT INTO $3 ($4) SELECT $4 FROM _in $5;
SELECT '$3: ' || count(*) || ' read from live' FROM _in;
COMMIT;
SQL
  docker exec lamis-db rm -f "$f"
}

export PGOPTIONS="-c default_transaction_read_only=on"

xfer crs "SELECT srid, code, name, datum, proj4text, is_survey FROM gis_ops.crs_registry WHERE srid = 2053" \
  gis_ops.crs_registry "srid, code, name, datum, proj4text, is_survey" "ON CONFLICT DO NOTHING"

xfer plan "SELECT import_id, sg_ref, township_code, source_srid, feature_count, imported_at FROM land.general_plan WHERE import_id IN (SELECT DISTINCT general_plan_id FROM land.parcel WHERE parcel_kind = 'stand' AND general_plan_id IS NOT NULL)" \
  land.general_plan "import_id, sg_ref, township_code, source_srid, feature_count, imported_at" "ON CONFLICT (import_id) DO UPDATE SET feature_count = EXCLUDED.feature_count"

WARDS="SELECT ward_code FROM admin.authority_ward UNION SELECT ward_code FROM land.parcel WHERE parcel_kind = 'stand' AND ward_code IS NOT NULL"
xfer ward "SELECT ward_code, name, source, geom, parent_pcode, delimitation, valid_from, valid_to FROM admin.ward WHERE ward_code IN ($WARDS)" \
  admin.ward "ward_code, name, source, geom, parent_pcode, delimitation, valid_from, valid_to" "ON CONFLICT (ward_code) DO NOTHING"

xfer authward "SELECT authority_id, ward_code, valid_from, valid_to, basis, instrument_ref, note, geom, conformed_at FROM admin.authority_ward" \
  admin.authority_ward "authority_id, ward_code, valid_from, valid_to, basis, instrument_ref, note, geom, conformed_at" "ON CONFLICT DO NOTHING"

PCOLS="parcel_id, stand_no, township_code, ward_code, geom_source, source_srid, geom_wgs84, transform_method, transform_accuracy_m, area_m2, sg_ref, general_plan_id, accuracy_class, source, custodian_dept, status, allocation_status, valid_from, valid_to, created_at, updated_at, accuracy_basis, parcel_kind, cadastre_ref, tenure_class, authority_id, origin, source_relation, source_key, survey_class, estimated_accuracy_m"
xfer parcel "SELECT $PCOLS FROM land.parcel WHERE parcel_kind = 'stand' AND status = 'current'" \
  land.parcel "$PCOLS" "ON CONFLICT (parcel_id) DO NOTHING"

OCOLS="parcel_id, authority_id, status, use_scale, price_usd, frontage_m, depth_m, description, reserved_until, requires_minister_approval, created_at, updated_at"
xfer offer "SELECT $OCOLS FROM land.stand_offer" land.stand_offer "$OCOLS" "ON CONFLICT (parcel_id) DO NOTHING"

# Keep the parcel id sequence ahead of the copied ids.
"${LOCAL[@]}" -c "SELECT setval('land.parcel_id_seq', GREATEST((SELECT max(substring(parcel_id from 3)::int) FROM land.parcel WHERE parcel_id ~ '^P-[0-9]+$'), 1))" >/dev/null
echo "Planning register copied to the local database."
