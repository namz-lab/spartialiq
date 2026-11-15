# The printed sheet's layers: what the database holds

Source of the facilities: the Vungu Master Plan Geo Package of 16 October 2024. Loaded by `node scripts/load-reference-layers.js` from `data/reference/vungu/*.geojson` (migration 233). Every row names its source; a value the source lacks stays NULL.

| On the sheet | Where it is held | Rows |
|---|---|---|
| Schools of every level | `admin.community_facility` kind `school` (subtype Primary / Secondary / Technical and Vocational, grade = the Ministry's grant class) | 98 |
| Police posts, stations, prisons | kind `police_post` | 7 |
| Dip tanks | kind `dip_tank` | 15 |
| Network boosters | kind `network_booster` (operator) | 14 |
| Quarries, sand workings | `admin.land_feature` kinds `quarry`, `sand_working` | 3 |
| Irrigation schemes (functional or not) | kind `irrigation_scheme` | 6 |
| Recreational sites | kind `recreational_site` | 7 |
| Railway | already in the national basemap (`railways`) | |
| Business centres, rural service centres, growth points | `admin.business_centre` (BC / RSC / GP) | 66 |

One police post (Holy Cross prison) lies outside every ward; the loader reports it.

## Still not held, and why
These are on the printed sheet but in no data file supplied, so none has been invented:
- **Business-centre levels 1 to 3.** The sources give only the broad type (BC, RSC, GP) or nothing. The levels have to be read off the sheet by the council.
- **Mines.** The package has quarries and sand workings only.
- **Proposed New City.** No polygon in any file.
- **RLU / PLU codes** printed on the zones: the codes are on the sheet, not in the data.
- **Targeted farms.** The farm cadastre is loaded (687 farms); which are "targeted" is the council's list.
- **Styling.** These layers are not yet published as map tiles or given symbols in the symbology registry.
