# Data model

The system has three levels of model, as database design has always asked for.

| Level | Question it answers | Where |
|---|---|---|
| **Conceptual** | What things does the council care about, and how do they relate, whatever the technology? | [CONCEPTUAL.md](CONCEPTUAL.md), written by hand |
| **Logical** | For the parcel family: the entities, attributes and keys the system needs, in third normal form, and how today's tables map onto them | [LOGICAL-PARCEL.md](LOGICAL-PARCEL.md), written by hand |
| **Physical** | What tables, columns, types and keys the database actually has | [`physical/`](physical), **generated** from the live database |

Regenerate the physical level with `node app-backend/scripts/generate-data-model.js`. Last generated 2026-10-13 from `vungu_master_db_v1`.

## Schemas

| Schema | Tables | Views | Tables with no relationships | Rows | Purpose |
|---|---:|---:|---:|---:|---|
| [`admin`](physical/admin.md) | 3 | 1 | 0 | 1,980 | Wards, villages, authority areas (national administrative geography) |
| [`council_ops`](physical/council_ops.md) | 6 | 0 | 0 | 7 | Council asset registers: roads, livestock, WASH |
| [`gis_ops`](physical/gis_ops.md) | 2 | 0 | 1 | 11 | Editable GIS features, history, coordinate reference registry |
| [`integration`](physical/integration.md) | 4 | 1 | 3 | 0 | Outbox and inbound logs, reconciliation, SurveyPro import runs |
| [`land`](physical/land.md) | 7 | 3 | 0 | 776 | The designed parcel register: parcels, lineage, buildings, events, land categories |
| [`planning_clerk`](physical/planning_clerk.md) | 7 | 0 | 7 | 0 | The clerk's statutory registers |
| [`public`](physical/public.md) | 118 | 17 | 50 | 164,446 | Users, plans and zones, the matrix, imported basemap and Vungu layers, stands, fees, content. The oldest and widest schema |
| [`revenue_link`](physical/revenue_link.md) | 2 | 0 | 0 | 0 | Parcel to ERP account keys and status bands (no amounts) |
| [`spatial_planning`](physical/spatial_planning.md) | 70 | 9 | 0 | 189 | Permits and their workflow, inspections, complaints, notices (incl. section 73), property register, committee, clerk registers |
| [`survey`](physical/survey.md) | 16 | 4 | 2 | 4 | The embedded survey workspace (legacy of SurveyPro) |
| [`tenancy`](physical/tenancy.md) | 3 | 3 | 2 | 293 | Row-level security classification of every table |

Per-surveyor schemas (`surveyor_*`) are a legacy copy of `survey` and are not documented here.

Across 238 tables there are 337 foreign keys; 2 tables have no primary key and 65 have no relationships at all.

## Review list

Each item is a question for a modeller, found by a simple rule. A rule cannot tell a deliberate choice from a mistake.

### Tables without a primary key (2)

- `public.places`
- `survey.migrations_history`

### Tables wider than 40 columns (2)

A wide table often mixes several entities (a shape, an owner, a title deed, a compliance state). Check whether it should be split.

- `public.gweru_health_centres (42)`
- `spatial_planning.permit_application (52)`

### Measurements stored as text (15)

A derived or numeric value held as text cannot be checked against the geometry or summed.

- `public.vungu_beyond_peri_urban_zones.shape_leng`
- `public.vungu_beyond_peri_urban_zones.shape_area`
- `public.vungu_farm_cadastre.area_km2`
- `public.vungu_farm_cadastre.area_ha`
- `public.vungu_farm_cadastre.area_acre`
- `public.vungu_farm_cadastre.area_km`
- `public.vungu_farm_cadastre.shape_leng`
- `public.vungu_farm_cadastre.shape_area`
- `public.vungu_parcels.area_km2`
- `public.vungu_parcels.area_ha`
- `public.vungu_parcels.area_acre`
- `public.vungu_parcels.area_km`
- `public.vungu_parcels.shape_leng`
- `public.vungu_parcels.shape_area`
- `survey.zim_control_points.area_nm`

### Column pairs that look like the same fact twice (8)

A name with a `_cache`, `_int`, `_code` or `_fid` twin. Often a migration in progress; each pair should name its master.

- `land.stand_layout: zone_id / zone_id_int`
- `public.gweru_peri_urban_zone: zone / zone_code`
- `public.proposed_peri_urban_zones: zone / zone_code`
- `public.stands_pre_register: ward / ward_fid`
- `public.stands_pre_register: use_scale / use_scale_code`
- `public.stands_pre_register: status / status_code`
- `public.stands_pre_register: zone_type / zone_type_cache`
- `public.stands_pre_register: zone_id / zone_id_int`

### Descriptive text where a key is expected (27)

Columns named zone, ward, status or authority that hold text, reference nothing and are not limited by a CHECK to a fixed list.

- `council_ops.council_asset.ward`
- `council_ops.livestock_facility.ward`
- `council_ops.road_asset.authority`
- `council_ops.road_asset.ward`
- `council_ops.road_structure.ward`
- `council_ops.wash_asset.ward`
- `land.stand_layout.zone_type`
- `public.gweru_peri_urban_zone.zone`
- `public.gweru_peri_urban_zone.zone_type`
- `public.ingestion_jobs.status`
- `public.local_authorities.authority_name`
- `public.local_authorities.authority_type`
- `public.planning_assistant_templates.ward`
- `public.proposed_peri_urban_zones.zone`
- `public.proposed_peri_urban_zones.zone_type`
- `public.proposed_peri_urban_zones.authority`
- `public.proposed_peri_urban_zones.ward`
- `public.stands_pre_register.ward`
- `public.stands_pre_register.zone_type`
- `public.vungu_farm_cadastre.status`
- `public.vungu_parcels.status`
- `public.zone_land_use_controls.authority`
- `spatial_planning.available_stand.zone`
- `spatial_planning.health_burial_permit.ward`
- `spatial_planning.planning_revision.status`
- `spatial_planning.survey_layout.ward`
- `survey.survey_projects.status`

### Tables with three or more JSON columns (6)

JSON hides structure from the database. Check whether the keys are stable enough to be columns.

- `public.development_applications (4)`
- `public.gis_style (3)`
- `public.ingestion_jobs (4)`
- `spatial_planning.eo_handoff_package (3)`
- `spatial_planning.permit_application (4)`
- `survey.features (3)`
