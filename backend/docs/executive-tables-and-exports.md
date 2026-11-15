# Tables, exports and honest figures on the CEO and unit screens

Drawn from the Chegutu water-audit report (GISkonsult, 2017), where the council officials' review comments asked for per-area tables with totals, export to Excel and PDF, larger readable figures with nothing hidden behind a scroll bar, and "unknown" counted rather than hidden.

## The ward tables
`GET /api/executive/ward-table` (accounting officer) and `GET /api/units/:key/ward-table` (the unit's head, or the CEO), built by `createWardMaps(pg).table(unitKey)` in `src/lib/wardMaps.js`, shown by `WardTable.vue` under the ward map on the CEO's overview and on each unit dashboard.
- Every ward is a row. Columns: the engine's measures (the unit's own, or all for the CEO), and for the CEO and the planning unit the register counts: stands, farm parcels, parcels under a zone of the plan, schools, health facilities, mines, registered voters (2023).
- A figure a ward does not have is **null, shown "not recorded"**, never zero. A rate or density has **no total**. A count's total is the register's own, and a line **"of which in no ward"** is what the wards do not account for (for example 97 farm parcels), so the rows and that line always add up to the total.
- The wards are provisional while decision D11 is open, and the table says so.

## Honest land figures
All 1,589 stands have a rates account and none of the 731 farm parcels do, so one combined share read 68% and looked like a data gap. The land section now reports stands and farm parcels apart ("Stands with a rates account 1,589 of 1,589", "Farm parcels with a rates account 0 of 731"), and migration 238 makes the ward measure count stands only (relabelled "Stands with a rates account"). Whether farm parcels should carry a rates account is the council's to say. After the migration run `node scripts/refresh-spatial-engine.js` (with `PGOPTIONS="-c statement_timeout=0"`).
The register's reconciliation with the rates system (`integration.reconciliation_item`) is **not** shown here: it is a system table with no council column, closed to the application role (migration 165). Its queues are in the GIS officer's Integration screen.

## Export and print
`ExportMenu.vue` (Excel, CSV, Print) on the ward tables, the Master plan's zone table, and the figures of the overview and each unit dashboard. Client-side, from what the screen already holds (`src/utils/tableExport.ts`; the `xlsx` library loads only when Excel is chosen). Every file says what it is (title, "as at", source, caveats such as provisional wards or decisions affirmed for testing), writes a missing figure "not recorded", and Print gives the PDF through the browser (the pages have print layouts: black on white, tables in full, no map or controls).

## Master plan page
The zone list is a table with a totals row and no inner scroll. "Proposed new city" has its own switch on the map (one layer, filtered by kind), so planned expansion, which the Chegutu reviewers asked to see, is one click.

## Not done
Water-network analytics, 3D balance extrusions (they drew the readability complaints), arrears figures (decision D13), field devices and standard field forms (a later pass over the inspector flows), and a CEO signature action (read-only was chosen).
