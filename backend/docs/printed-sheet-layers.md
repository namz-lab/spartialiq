# The printed sheet's layers: what the database holds

Loaded by `node scripts/load-reference-layers.js` (run with `PGOPTIONS="-c statement_timeout=0"`: linking the targeted farms to the register takes longer than the database's 30-second limit) from `data/reference/vungu/*.geojson` (migrations 233 to 237). Every row names its source; a value the source lacks stays NULL. All of these come from files the council supplied on 15 November 2026. The October 2024 Geo Package is no longer used.

| On the sheet | Where it is held | Rows |
|---|---|---|
| Business centres, graded BC 1 to 3; rural service centres (RSC); growth point (GP) | `admin.business_centre` (`sector`, and `level` for a BC) | 66 (BC 1: 17, BC 2: 31, BC 3: 12; RSC 5; GP 1) |
| Schools (Primary, Secondary, Technical and Vocational, University; grant class) | `admin.community_facility` kind `school` | 102 |
| Police posts, stations, prisons | kind `police_post` | 6 |
| Dip tanks (with the village where given) | kind `dip_tank` | 15 |
| Network boosters (with the operator where given) | kind `network_booster` | 16 |
| Health facilities (every attribute as the Ministry file gives it) | `council_ops.health_facility` | 24 |
| Quarries; sand workings | `admin.land_feature` kinds `quarry`, `sand_working` | 2; 2 |
| Mines (Gold where the source says; artisanal workings) | kind `mine` | 41 |
| Irrigation schemes (functional or not); recreational sites | kinds `irrigation_scheme`, `recreational_site` | 6; 9 |
| Proposed New City | kind `proposed_new_city` | 1 |
| Railway lines | `admin.railway_line` (the national basemap's railways stay as they are) | 7 |
| Targeted farms | `admin.targeted_farm`, each linked to the farm parcel of the register it overlaps by half or more | 283 (278 linked) |
| Retained zones, by ward | `admin.retained_zone` (a separate layer, not on the map) | 16 |

## What the council's files left out, and why
Anything wholly outside the planning boundary is not the council's and the loader drops it (and reports it). Two supplied features fell outside: **Holy Cross prison** (police file) and **Hunters Road** (business-centre file, BC 3). The council chose to keep them out.

## Reconciled
- Business centres replace the legacy layer (spellings corrected, Hunters Road dropped as above, rural service centres 3 to 5).
- Health facilities: the six the council added carry a name and a position only; the Ministry's own latitude and longitude are kept as given, and the position on the map is the file's geometry (they differ for Connemara by more than 100 m). Facilities with no id in the file are numbered from 900001. Ownership is kept as the Ministry's own code.
- Targeted farms: five of the 283 overlap no farm parcel by half and carry no link. The file's status is kept as supplied (Resettlement, Commercial, City, State Land). Some supplied polygons self-intersect; they are stored as supplied and the overlap is worked out on repaired copies.
- **Retained zones differ from the loaded zones** in extent (for example 195,509 ha of Large Scale Commercial Farms against 156,966 ha in `spatial_planning.zone`, and 230,439 ha of Model A2 against 205,113 ha), so they replace nothing; which set the plan should draw is for the council to say.

## Still not held
- **RLU / PLU codes** printed on the zones: on the sheet, not in any file. The sheet's artwork is vector with outlined text, so it cannot be read by machine.

## On the map
Migration 236 adds three tile views (`vungu_facilities`, `vungu_land_features`, `vungu_railway`), registered as tile layers in `src/config/spatialLayers.js`. `scripts/publish-plan-feature-styles.js` publishes their symbology to the registry and the QML sidecars in `qgis-projects/canonical-qml` are exported from those styles, so QGIS draws the same. The citizen map has two toggles and its legend lists the kinds. The targeted farms and retained zones are not on the map yet.
**The colours are a first proposal chosen by the developer, not the council GIS's.** Browsers cache styles for up to five minutes.

## Decisions affirmed for testing
At the council's request the EO Planning's and the GIS team's pending decisions are **treated as affirmed, for testing only**. They have not been made and are to be revisited. `node scripts/affirm-decisions-for-testing.js` (`--status`, `--revert`):
- the 414 matrix cells proposed as best practice become "EO Planning (Vungu matrix; affirmed for testing)" and stop being gated as proposals; the 25 zone columns are marked reviewed by "EO Planning (affirmed for testing)"; a plan event `eo_affirmed_for_testing` records it;
- the GIS team's colours (the Densification Zone [MDR] colour and the symbols of the new layers) are already published and stay as they are;
- the plan's own status does not change: nothing is approved or gazetted;
- `--revert` puts the proposals and the review state back. Tests that pin the behaviour of a proposed rule (`test/application-plan.test.js`) restore the proposals for the length of the file and re-affirm afterwards (`test/helpers/proposedCells.js`).
