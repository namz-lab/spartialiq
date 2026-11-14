# The EO Planning development matrix for Vungu

Source: the docx "Gweru Rural Master Plan Use Groups" from the Executive Officer for Planning: 31 land and building uses by 14 zone columns (434 cells).
Loaded into the plan "Vungu RDC peri-urban local plan (as mapped)" by `node scripts/load-eo-matrix.js` (dry run by default, `--apply` to keep; re-running changes nothing).
Code: `src/utils/eoMatrix.js`. Data: `data/reference/vungu/` (`eo-matrix.csv` the EO's cells; `eo-use-mapping.csv`; `eo-combine-conflicts.csv`).

## Two kinds of decision
| Authority on the decision | Meaning |
|---|---|
| `EO Planning (Vungu matrix)` | the EO's own cell, translated to our codes. The notes carry the EO's letter, name and any footnote number. |
| `PROPOSED: best practice, for EO review` | ours, from international practice or derived from the EO's closest column; to be agreed with the EO after the MVP is presented. |

## Use codes
Our codes are kept. The EO's uses are matched **by description**, not letter (16 letters mean a different use in the two lists). Six EO uses we lacked were added at the end of our list:
C1 Crèches, D2 Equipment/furniture/ICT showrooms, D3 Restaurants, L2 Service industrial building, U1 Surface car park, W Special buildings and uses.
Our uses with no EO counterpart (D1 farm stores, F institutions, L1 general industrial buildings, P agricultural small holdings, X game park, Z horticulture, UF urban forestry) have no EO decision: they are undecided for the EO's columns, not prohibited.

## Zone columns
- "Light and" + "General Industry" are one zone, **Light and General Industry** (renamed from "Light Industry"). Where the two columns disagree (17 of 31 uses) the **most restrictive** applies (X over SC over P); the 17 are in `eo-combine-conflicts.csv` for the EO to settle.
- EO columns with no mapped polygon (Central Business District, Local Shopping Centre, Neighbourhood Shopping, Markets, Flats, Zone 4 Public, Zone 1B(iii) Mixed) are zone types with the EO's decisions, ready for when the council maps them.
- Resettlement, Communal: the EO has P for every use in both columns; to confirm.

## Proposals for zones the EO's matrix does not cover
- Farm zones (Model A2, Large Scale Commercial Farms, Model A1, Small Scale Commercial Farms; about 70% of the mapped area): agriculture, farm stores, the homestead and horticulture permitted; urban uses prohibited; schools, worship, assembly, fuel and similar by consent. The two large types may also process produce and park lorries by consent.
- Residential Agricultural Plots: a dwelling and small-scale farming permitted, the rest mostly prohibited or by consent. Cemetery: burial ground, chapel and planting only.
- Derived from the EO's closest column, with listed differences: Economic Corridor [Mixed Business] (Local Shopping Centre), Densification [LDR] (Low Density Residential, attached/cluster housing permitted), Densification [MDR] (Medium Density, flats too), Mixed Density Residential (Medium Density; **unclear whether this is the EO's "Zone 1B(iii) Mixed"**), Institutional (Zone 4 Public), Railways Common User Facilities (the industrial column).
Zone types stay `unreviewed`.

## To settle with the EO
The 17 combine conflicts; the text of the 15 footnote/asterisk marks (no footnote text was supplied); cut-off headers ("Light and", "Zone 4 Public"); whether Zone 1B(iii) Mixed is our Mixed Density Residential; the proposals above.
