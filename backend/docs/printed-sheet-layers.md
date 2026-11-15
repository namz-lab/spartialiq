# The printed sheet's layers: what the database holds

Loaded by `node scripts/load-reference-layers.js` from `data/reference/vungu/*.geojson` (migrations 233 to 235). Every row names its source; a value the source lacks stays NULL. "Council file" is a file the council supplied on 15 November 2026.

| On the sheet | Where it is held | Rows | Source |
|---|---|---|---|
| Business centres, graded BC 1 to 3; rural service centres (RSC); growth point (GP) | `admin.business_centre` (`sector`, and `level` for a BC) | 66 (BC 1: 17, BC 2: 31, BC 3: 12; RSC 5; GP 1) | council file |
| Schools (Primary, Secondary, Technical and Vocational, University; grant class) | `admin.community_facility` kind `school` | 102 | council file |
| Police posts, stations, prisons | kind `police_post` | 6 | council file |
| Dip tanks (with the village where given) | kind `dip_tank` | 15 | council file |
| Health facilities (every attribute as the Ministry file gives it) | `council_ops.health_facility` | 24 | council file |
| Quarries; sand workings | `admin.land_feature` kinds `quarry`, `sand_working` | 2; 2 | council file |
| Mines (Gold where the source says; artisanal workings) | kind `mine` | 41 | council file |
| Proposed New City | kind `proposed_new_city` | 1 | council file |
| Railway lines | `admin.railway_line` (the national basemap's railways stay as they are) | 7 | council file |
| Network boosters | kind `network_booster` | 14 | Geo Package, Oct 2024 |
| Irrigation schemes; recreational sites | kinds `irrigation_scheme`, `recreational_site` | 6; 7 | Geo Package, Oct 2024 |

The October 2024 Geo Package is out of date. **Network boosters, irrigation schemes and recreational sites still come from it and need updated files.**

## What the council's files left out, and why
Anything wholly outside the planning boundary is not the council's and the loader drops it (and reports it). Two supplied features fell outside:
- **Holy Cross prison** (police file), at 30.52 E, far east of the district.
- **Hunters Road** (business-centre file, BC 3), north of the boundary.
If either is meant to be on the plan, say so and it is loaded as an exception.

## Reconciled
- Business centres: the council's file replaces the legacy layer. It corrects spellings (Mvumileni, Mankunzane, Chiundura), splits Torvo, adds Zaloba B and Hunters Road, and raises the rural service centres from 3 to 5.
- Health facilities: the six added by the council (Gatawa, Ntabamhlope, Riverdale, Hozheri, Impala, Chinamasa) carry a name and a position only. The Ministry's own latitude and longitude are kept as given; the position drawn on the map is the file's geometry, and for Connemara the two differ by more than 100 m.
- Health facilities with no id in the file are numbered from 900001. Ownership is kept as the Ministry's own code ("3", "5", "6", "7"), not interpreted.

## Still not held, and why
- **RLU / PLU codes** printed on the zones: on the sheet, not in any file.
- **Targeted farms.** The farm cadastre is loaded (687 farms); which are "targeted" is the council's list.
- **Styling.** These layers are not yet published as map tiles or given symbols in the symbology registry.
