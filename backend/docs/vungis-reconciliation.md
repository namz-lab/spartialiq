# Reconciling `C:\vungis` with this repository (lamis)

Written 14 November 2026 from a read-only look at `C:\vungis` (remote `cparadzayi/vungis`, branch `main`). Nothing in
`C:\vungis` was changed. This is a reconciliation of **what each side has** and of **the spatial data**; it is not a
code merge (see "The code lines", below).

## 1. The code lines have diverged

Both trees share an origin up to migration 176. After that:

| | `C:\vungis\app-backend` (Dr Paradzayi's line) | `lamis/backend` (the developers' line) |
|---|---|---|
| Migrations | 177 to 199: parcel geometry index, land category, title condition notice, stands folded into the parcel register, **data-load register** (188), fee schedule (189), district / ward adoption / ward retirement / planning boundary (191 to 196), survey plans (197 to 199) | 181 to 218: council statutory registers, fee tariff, **finance** (188 to 214), parcel accuracy, authority-ward provisional register (201), cash office, spatial engine (215), units (216 to 217), reference layers (218) |
| Numbers 181 to 199 | **different content on each side** | different content on each side |
| Scripts only here | `load.js` (loader framework with dry run, apply, reverse), `adopt-delimitation.js`, `retire-superseded-wards.js`, `clear-demo-data.js`, `data-readiness.js`, `suggest-land-category.js`, `stand-attribute-review.js`, `generate-data-model.js` | `demo-setup.js`, `load-wards.js`, `load-master-plan.js`, `import-township-dxf.js`, `refresh-spatial-engine.js`, finance seeds, `seed-executive-demo.js` |
| Docs only here | `DATA-POPULATION-PLAN.md`, data-readiness reports (14, 15, 17 Oct), nine data-request letters and memoranda, intake templates, data model, use cases | spatial-engine, units-and-roles |

The migration-number collision is the real obstacle. Bringing the vungis line in means renumbering its 177 to 199 (for
example to 219 onward), checking each for overlap with what the finance migrations created (the fee schedule is the
visible case: vungis 189 `fee_schedule` against lamis 188 `council_fee_tariff`), and re-running the test suites. That is a project of its own and was **not attempted**. Recommended order if wanted: data-load register
(188), then the ward adoption / retirement scripts, then survey plans.

`C:\vungis` itself has uncommitted work: modified `docs/data-model`, two deleted manuscript PDFs, and the untracked
shapefiles and zips listed below. The `app-frontend` was not compared.

## 2. The spatial data in `C:\vungis`, and what was done with it

| Dataset | Where | Already in this database? | Action |
|---|---|---|---|
| Electoral Commission **polling areas** (1,594 Midlands; 115 Vungu RDC) | `Midlands_Shapefiles_UTM_35K-20_04_2023` | No | **Loaded** (`admin.polling_area`, migration 218). 115 of 115 fall inside the council ward with the same number: independent corroboration of the 19 provisional wards (D11 stays open). |
| ZEC **polling stations** (115 Vungu) | same | No | **Loaded** (`admin.polling_station`), 115 named stations (mostly schools and clinics). |
| **Registered voters** per polling area (50,062 in Vungu) | `VOTER_POP` in the polling areas | No | **Loaded as a ward denominator** of kind `registered_voters`, 19 wards, 2,164 to 3,093 each. New measure: working water points per 10,000 registered voters. |
| **Chiefdoms** (5: Bunina, Chiwundura, Gambiza, Lukuluva, Sogwala) | `app-backend/data/seed/gweru_legacy.sql` | No | **Loaded** (`admin.chiefdom`). |
| **Business centres** (67; 66 inside Vungu): BC, RSC, GP | same | No | **Loaded** (`admin.business_centre`), 66. |
| **Rivers** (260; 249 usable in Vungu) | same | No | **Loaded** (`admin.river`). 74 of the 260 have invalid (NaN) coordinates in the source and were left out. Most carry no name or type. |
| Farm cadastre (672 farms) | same (`gweru_rural_farms`) | **Yes**, `vungu_farm_cadastre` (687), 627 matched by `row_id` | Not loaded. See decision 1. |
| Peri-urban zones (43), beyond-peri-urban zones (16), planning boundary | same | Yes (`vungu_proposed_peri_urban_zones` 42, `vungu_beyond_peri_urban_zones` 16) | Not loaded (superseded). |
| National admin boundaries (adm0 to adm3, GeoJSON and shapefile) | `zwe_admin_boundaries.*` | Wards only (as the 19 Vungu wards) | Not loaded: Vungu is the scope; provinces and districts add nothing the screens use. |
| **Census** district and ward tables | `zwe_boundaries.census_*` in the backups | No | **Deliberately not loaded as ward figures.** `census_ward` is the district total divided among wards ("ward estimate derived from district total"), so it is not a ward population. The one real figure is the district: Gweru district 135,800 (2022 census, 22 wards); it is not Vungu's. |
| Backups (`vungu_spatial-20260515`, `zwe_boundaries-20261002`, 77 MB each) | `app-backend/backups` | n/a | Not restored: whole-database dumps from PostgreSQL 18 of the older schema. |

Files cut from these sources are in `backend/data/reference/vungu/` and are loaded by
`node scripts/load-reference-layers.js` (part of `npm run demo:setup` when `--wards` is given).

## 3. Decisions for the Council or the project owner

1. **32 farms** in the legacy layer lie mostly inside Vungu's wards but are absent from the developers' farm cadastre
   because the source labels them district **Kwekwe** (for example Langton Ranch, Junita, Melrose). They were *not*
   added to the parcel register: it would change the Chief Executive's parcel counts on the strength of a label
   disagreement. Whether they belong to Vungu is for the Survey Section.
2. **Voters are not population.** The voter-rate measure says so. ZIMSTAT ward populations are still needed for
   population rates.
3. Which code line is authoritative, and whether to renumber and bring in the vungis migrations (section 1).
4. The polling shapefile is in Arc 1950 / UTM 35S. GDAL offered several transformations to WGS 84 and used the best
   available; positions can differ from a surveyed transformation by tens of metres. Ward placement was unaffected
   (115 of 115), but do not use these layers for parcel-level work.

## 4. What was not done

No code from `C:\vungis` was merged; its dumps were not restored; the legacy farm and zone layers were not loaded; no
ward population was loaded. The scratch tables and the temporary `legacy_tmp` database used for the comparison have been dropped.
