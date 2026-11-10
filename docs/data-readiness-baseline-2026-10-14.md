# Data readiness

Generated 2026-10-14 from `vungu_master_db_v1` (232 tables). Produced by `app-backend/scripts/data-readiness.js`; the plan it measures is [DATA-POPULATION-PLAN.md](DATA-POPULATION-PLAN.md).

**11 of 16 domains block go-live.** 50 of the 134 tables that must hold real data hold none. 7,792 rows are demonstration or test data.

"Real" means "not identified as demonstration or test by a rule" (listed below). A row no rule names counts as real, so a person still has to confirm it is.

## By domain

| Wave | Domain | Status | Real rows | Demo or test rows | Tables to load with data | Owner | Blocks go-live |
|---:|---|---|---:|---:|---:|---|:-:|
| 0 | The council as an organisation | **PARTLY LOADED** | 26 | 1 | 3 of 6 | IT administrator, executive officer | yes |
| 0 | Staff accounts and access | **LOADED** | 34 | 2,625 | 5 of 5 | IT administrator | yes |
| 0 | Fees and payments | **NOT LOADED** | 0 | 1 | 0 of 1 | Finance, executive officer | yes |
| 0 | Committee | **NOT LOADED** | 0 | 6 | 0 of 1 | Executive officer | yes |
| 1 | Geography: wards, boundaries, the basemap | **PARTLY LOADED** | 145,613 | 0 | 30 of 35 | GIS Branch | yes |
| 1 | The plan and the zoning matrix | **PARTLY LOADED** | 1,508 | 356 | 32 of 35 | Planning officer, executive officer | yes |
| 2 | The land register | **PARTLY LOADED** | 3,500 | 74 | 6 of 24 | GIS Branch, Survey Section | yes |
| 2 | Survey work | **HAS DATA** | 2 | 3 |  | Head surveyor | yes |
| 3 | Council assets: roads, water, livestock | **PARTLY LOADED** | 6 | 0 | 1 of 5 | Works, water and livestock departments |  |
| 3 | Environmental health registers | **NOT LOADED** | 0 | 0 | 0 of 10 | Environmental health officer |  |
| 3 | Development control: applications and inspections | **HAS DATA** | 1 | 107 |  | Planning clerk, planner, inspector | yes |
| 3 | Complaints and enforcement, including section 73 notices | **BY USE** | 0 | 0 |  | Building inspector, planner |  |
| 4 | Finance link and integrations | **NOT LOADED** | 0 | 0 | 0 of 2 | Finance, IT administrator |  |
| 1 | Map publishing and layer configuration | **PARTLY LOADED** | 270 | 201 | 7 of 10 | GIS Branch | yes |
|  | Activity logs | **BY USE** | 0 | 4,418 |  | (none: fills by use) | yes |
|  | Platform tables | **N/A** | 8,522 | 0 |  | (none) |  |

Statuses: **NOT LOADED** (nothing real in any table that must be loaded), **PARTLY LOADED**, **LOADED** or **LOADED, CHECKS FAIL** (data is there but a check below fails), **BY USE** (fills once the system is live; should hold no test rows at go-live), **N/A**.

## The checks

### The council as an organisation

- **FAIL**: address: 2 different value(s) across the three places that hold it; blank in settings
- **FAIL**: telephone: 2 different value(s) across the three places that hold it; blank in settings
- **FAIL**: email: 3 different value(s) across the three places that hold it
- **FAIL**: application fee is not set

### Staff accounts and access

- OK: 5 real staff account(s); 15 demonstration account(s); 7 citizen account(s) of unrecorded origin

### Geography: wards, boundaries, the basemap

- **FAIL**: 1961 wards, from COD-AB (OCHA/ZIMSTAT): the pre-2023 delimitation. The Electoral Commission's 2022 set has 1,970
- **FAIL**: 0 villages loaded; 19 wards assigned to an authority

### The plan and the zoning matrix

- **FAIL**: plan "Vungu RDC peri-urban local plan (as mapped)": status draft, no gazette reference
- OK: plan "Vungu RDC peri-urban local plan (as mapped)": 352 matrix decisions, 0 copied from a template, 0 carrying a condition
- **FAIL**: plan "Vungu RDC peri-urban local plan (as mapped)": 0 sign-off(s) recorded

### The land register

- **FAIL**: 0 of 731 real parcels have a land category recorded
- **FAIL**: 0 of 731 real parcels carry a Surveyor-General reference
- OK: 0 parcel area(s) disagree with their boundary (enforced by the database)
- **FAIL**: 0 owner record(s); the Deeds Registry link is a simulation
- **FAIL**: 0 parcel(s) linked to a finance account

## Tables that must be loaded and hold nothing real

- **The council as an organisation** (3): `public.admin_announcement`, `public.authority_member`, `public.site_content`
- **Fees and payments** (1): `public.exchange_rates`
- **Committee** (1): `spatial_planning.committee_member`
- **Geography: wards, boundaries, the basemap** (5): `admin.village`, `public.gweru_health_centres`, `public.natural_areas`, `public.places`, `public.places_areas`
- **The plan and the zoning matrix** (3): `public.plan_signoff`, `public.plan_zone_standard`, `spatial_planning.statutory_plan`
- **The land register** (18): `land.building`, `land.general_plan`, `land.parcel_event`, `land.parcel_lineage`, `land.stand_layout`, `public.lands_registry_checks`, `public.lands_registry_deeds`, `public.parcel_zoning`, `public.stand_allocation`, `public.stands_pre_register`, `spatial_planning.available_stand`, `spatial_planning.control_point`, `spatial_planning.existing_use`, `spatial_planning.parcel_lineage`, `spatial_planning.parcel_owner`, `spatial_planning.property`, `spatial_planning.property_assessment`, `spatial_planning.zoning_designation`
- **Council assets: roads, water, livestock** (4): `council_ops.council_asset`, `council_ops.livestock_facility`, `council_ops.road_asset`, `council_ops.road_structure`
- **Environmental health registers** (10): `spatial_planning.health_abatement_notice`, `spatial_planning.health_burial_permit`, `spatial_planning.health_field_programme`, `spatial_planning.health_food_handler_cert`, `spatial_planning.health_licence_clearance`, `spatial_planning.health_nuisance_complaint`, `spatial_planning.health_outbreak`, `spatial_planning.health_premises`, `spatial_planning.health_premises_inspection`, `spatial_planning.health_water_sample`
- **Finance link and integrations** (2): `revenue_link.account_link`, `revenue_link.billing_status`
- **Map publishing and layer configuration** (3): `public.layer_data`, `spatial_planning.gis_feature`, `spatial_planning.gis_feature_history`

## Demonstration or test data to remove before go-live

| Table | Rows | What it is |
|---|---:|---|
| `council_ops.service_desk_ticket` | 1 of 1 | unconfirmed: no recorded provenance; the development database has only demonstration activity |
| `land.parcel` | 20 of 751 | parcels of the development layout stands |
| `land.stand_layout` | 20 of 20 | the 20 development layout stands (EC-, HDR-, MDR- numbers) |
| `public.admin_audit_event` | 1,824 of 1,824 | activity recorded by development and testing |
| `public.admin_login_attempt` | 1,905 of 1,905 | activity recorded by development and testing |
| `public.citizen_documents` | 2 of 2 | unconfirmed: no recorded provenance; the development database has only demonstration activity |
| `public.gis_style_audit` | 201 of 201 | activity recorded by development and testing |
| `public.lands_registry_checks` | 2 of 2 | checks against the simulated Deeds Registry |
| `public.lands_registry_deeds` | 10 of 10 | the simulated Deeds Registry |
| `public.local_authorities` | 1 of 2 | the test authority |
| `public.notifications_outbox` | 582 of 582 | activity recorded by development and testing |
| `public.page_view` | 107 of 107 | activity recorded by development and testing |
| `public.payments` | 1 of 1 | payments by demonstration accounts |
| `public.plan_event` | 6 of 14 | events of the test plan |
| `public.plan_instrument` | 1 of 5 | the test plan ("delete me") |
| `public.plan_signoff` | 1 of 1 | the sign-off of the test plan |
| `public.plan_zone_type` | 11 of 64 | zone types of the test plan |
| `public.stands_pre_register` | 20 of 20 | the rollback copy of the development layout stands |
| `public.user_session` | 2,610 of 2,610 | activity recorded by development and testing |
| `public.users` | 15 of 27 | demonstration accounts (@vungu.test, @example.test) |
| `public.zone_land_use_controls` | 337 of 1,026 | matrix decisions of the test plan |
| `spatial_planning.agenda_item` | 1 of 1 | unconfirmed: items of the one meeting with no recorded provenance |
| `spatial_planning.available_stand` | 2 of 2 | the two seeded demonstration stands (AVL-001, AVL-002) |
| `spatial_planning.committee_meeting` | 1 of 1 | unconfirmed: the one meeting has no recorded provenance |
| `spatial_planning.committee_member` | 2 of 2 | unconfirmed: the two members have no recorded provenance |
| `spatial_planning.generated_document` | 2 of 2 | unconfirmed: no recorded provenance; generated for demonstration applications |
| `spatial_planning.meeting_attendance` | 2 of 2 | unconfirmed: attendance at the one meeting with no recorded provenance |
| `spatial_planning.permit_application` | 50 of 50 | smoke-test applications and applications by demonstration accounts |
| `spatial_planning.permit_event` | 52 of 52 | events of smoke-test and demonstration applications |
| `spatial_planning.survey_task` | 3 of 3 | smoke-test survey tasks, the cut-over test job and the July demonstration tasks |

A production database built fresh from the migrations has none of these. This list is for a development copy that is to be reused, and for checking that nothing leaked.
