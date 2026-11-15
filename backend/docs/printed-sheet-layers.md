# The printed sheet's layers: what the database holds

Loaded by `node scripts/load-reference-layers.js` from `data/reference/vungu/*.geojson` (migrations 233 and 234). Every row names its source; a value the source lacks stays NULL.

| On the sheet | Where it is held | Rows | Source |
|---|---|---|---|
| Schools of every level (Primary, Secondary, Technical and Vocational, University; grant class) | `admin.community_facility` kind `school` | 102 | council file, 15 Nov 2026 |
| Quarries; sand workings | `admin.land_feature` kinds `quarry`, `sand_working` (use as the source says) | 2; 2 | council file, 15 Nov 2026 |
| Mines (Gold where the source says; artisanal workings named as supplied) | kind `mine` | 41 | council file, 15 Nov 2026 |
| Proposed New City | kind `proposed_new_city` | 1 | council file, 15 Nov 2026 |
| Railway lines | `admin.railway_line` (the national basemap's railways stay as they are) | 7 | council file, 15 Nov 2026 |
| Police posts, stations, prisons | kind `police_post` | 7 | Geo Package, Oct 2024 |
| Dip tanks; network boosters | kinds `dip_tank`, `network_booster` | 15; 14 | Geo Package, Oct 2024 |
| Irrigation schemes (functional or not); recreational sites | kinds `irrigation_scheme`, `recreational_site` | 6; 7 | Geo Package, Oct 2024 |
| Business centres, rural service centres, growth points | `admin.business_centre` (BC / RSC / GP) | 66 | earlier VunGIS legacy layer |

The October 2024 Geo Package is out of date. The council's files replace it for schools, quarries and the rest above; **the layers still from the package need updated files**.
Anything wholly outside the planning boundary is left out of the council's files and counted in the loader's report (none was). One police post (Holy Cross prison) lies outside every ward.

## Still not held, and why
- **Business-centre levels 1 to 3.** No file gives them; the sources have only the broad type (BC, RSC, GP). They have to be read off the sheet by the council.
- **RLU / PLU codes** printed on the zones: on the sheet, not in the data.
- **Targeted farms.** The farm cadastre is loaded (687 farms); which are "targeted" is the council's list.
- **Styling.** These layers are not yet published as map tiles or given symbols in the symbology registry.
