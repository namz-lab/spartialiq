# Plan: populating VunGIS with live data

**Status:** 14 October 2026. A plan, not yet started. It is written from the development database as it stands, the project's own audits (`app-backend/docs/DATA-AUDIT-2026-10-08.md`, `ADMIN-DATA-CUSTODIANS-ZIMBABWE.md`, `DEVELOPMENT-CONTROL-MATRIX-DERIVATION.md`) and the loaders already in `app-backend/scripts`. What the council actually holds, in what form, I cannot see from the code; Step 1 of the plan is to find out.

## 1. Where things stand

The development database has 233 tables:

| | Tables | What they are |
|---|---:|---|
| Empty | 119 | Almost every transactional and operational register: complaints, enforcement, notices, inspections, health premises, assets, correspondence, ERP links, the property register, parcel lineage, the survey workspace |
| 1 to 99 rows | 92 | Reference lists, the plan and its zones, the 20 council layout stands, 27 users, 50 permit applications, settings |
| 100 rows or more | 22 | National and basemap layers (139,619 buildings, 2,876 roads, 1,961 wards), the 731 farm parcels, the matrix decisions, logs |

What is real, what is draft, and what is demonstration:

| Real, from a custodian | Real but needs checking | Draft, awaiting a council decision | Demonstration or test, to be removed |
|---|---|---|---|
| Roads, buildings, rivers, railways (OSM extract); wards, districts, provinces (OCHA/ZIMSTAT COD-AB, the pre-2023 delimitation); the farm cadastre extract | 731 farm parcels in the register (areas in the source disagree with their shapes: 52 of 733 differ by over 5%); the 36 Vungu plan zones; the council's contact details (but see Wave 0: three places hold them and they disagree) | The zoning matrix (Vungu's plan holds 352 decisions, status `draft`, no gazette reference, no sign-off, none carrying a condition; the draft's rural columns repeat the urban ones); land category (none recorded); wards for the layout stands | The test authority `TESTCO` ("delete me"); 15 of the 27 users are demo accounts (`@vungu.test` or `@example.test`; the 7 registered citizens are not); 46 of the 50 permit applications are smoke tests; the 20 layout stands (their ward, area and zone disagree with their own boundaries); the 10 "deeds" in the simulated Deeds Registry; the 2 committee members and 1 meeting (to confirm) |

So the work is not "fill 119 empty tables". Roughly a third are *transactional*: they fill by use once the system is live and must stay empty at go-live. The rest need either a custodian's data, a council decision, or an integration.

## 2. Principles

1. **Never invent data.** The system already says so where it matters ("do not invent boreholes", `council-ops.js`). A blank is correct; a plausible guess is a defect nobody finds.
2. **Every loaded row says where it came from.** Source, custodian, date, and who loaded it. The register already does this for parcels (`source`, `source_relation`, `source_key`, `origin`); the rest should follow one pattern (Section 5).
3. **Load into a clean production database, don't clean the development one.** Build production from the migrations (`scripts/verify-fresh-database.js` already proves a fresh build), then load. The development database keeps its demonstration data for tests. This removes the question "did we clear every demo row?" because they were never there.
4. **Dry run, validate, report, apply in one transaction, and be able to undo.** Every loader reports what it would do first (the SurveyPro importer and the matrix loader already do), refuses a bad batch whole, and records a load id so a load can be reversed.
5. **The council decides what is true; the system holds it.** Where two values disagree (the stand areas, the matrix, the ward numbering), a named officer decides and the decision is recorded.
6. **Custodians keep their truth.** Boundaries come from the Surveyor-General, title from the Deeds Registry, wards from the Electoral Commission. The council loads a reference and its own records, never an editable copy.

## 3. What to load, from whom, and in what order

Each wave depends on the one before. "Loader" says what exists today.

### Wave 0: the council as an organisation (the council's administrator, 1 to 2 weeks)
| Data | Tables | Source | Loader | Owner |
|---|---|---|---|---|
| **One** council identity: name, address, telephone, email, application fee | `local_authorities`, `admin_setting`, `src/config/council.js` | The council. Today three places hold it and disagree: the letterhead in the code says *Stand 1, Gweru Road*, +263 54 123 456, `admin@vungu.gov.zw`; the authority table says *Stand 1246, Hertfordshire*, +263 54 222 741; the settings hold `info@vungurdc.gov.zw` with the address and phone blank. The application fee is empty | Admin console; the letterhead should read the settings, not a constant | IT administrator, executive officer |
| Real staff accounts and roles, in place of the demo accounts | `users`, `user_profiles` | HR list of who holds which post | The invite flow; `seed-demo-users.js` is for development only | IT administrator |
| Committee members and standing rules (quorum) | `committee_member` | Council minutes book | Admin screen | Executive officer |
| The fee schedule | the authority's `application_fee`, the payment rates and `exchange_rates` | A council resolution (RDC Act s76: posted 30 days, objections heard) | Admin; **needs the resolution first** | Finance, executive officer |
| The public website content | `site_content` | Council communications | Admin console | Planning clerk |

### Wave 1: geography and the plan (GIS Branch and planning, 2 to 4 weeks, one external dependency)
| Data | Tables | Source | Loader | Blocker |
|---|---|---|---|---|
| Wards for the authority; villages; chiefdoms | `admin.ward`, `admin.authority_ward`, `admin.village`, `gweru_chiefdoms` | **Electoral Commission** (2022 delimitation, 1,970 wards) | The existing spatial import scripts (`download-spatial-source.mjs`) for the COD-AB stand-in, marked pre-2023 | ZEC must be asked for GIS files; none found online. Interim: keep the COD-AB, labelled |
| The council's area and boundary | `authority_area` | The Ministry's proclamation; derive as the union of its wards (do not draw it) | To build, small | Proclamation reference |
| The plan instrument and its zones | `plan_instrument`, `proposed_peri_urban_zones`, `plan_zone_type` | The gazetted local plan (the 36 zones are loaded; confirm they are the gazetted ones) | `import_vungu_proposed_peri_urban_zones.sql`, plan workbench | Confirm the gazetted version |
| **The zoning matrix** | `zone_land_use_controls` and the decisions | **The council's planners**, zone by zone and use by use | `load-zoning-matrix.js` (blank template per plan, then CSV), workbench import | **The largest single blocker.** The draft in the database is not usable; until it is decided, "what can I build here" answers "not decided" |

### Wave 2: land (GIS Branch with the Surveyor-General and the Deeds Registry, 4 to 12 weeks)
| Data | Tables | Source | Loader | Blocker |
|---|---|---|---|---|
| Farm parcels, with boundaries the Survey Section vouches for | `land.parcel` | **Surveyor-General** (the e-Cadastre or approved diagrams); the 731 loaded are an extract with unreliable stored areas | `load-parcels-into-land.js`; boundaries only via the general-plan import | Whether the Surveyor-General will supply a digital feed |
| Township stands | `land.parcel`, `land.general_plan` | **Approved general plans** from the Survey Section | `POST /gms/imports/general-plan` (validates and adopts in place) | The plans themselves, in digital form |
| Council survey work | `survey_*`, `land.parcel` | **SurveyPro**, live | `import-surveypro.js` on its schedule | None; starts empty |
| **Land category** for every parcel | `land.parcel.land_category` | Gazette notices and the Act's definitions; start with the tenure word as a proposal | `suggest-land-category.js` (proposes 67 strong, 533 probable) | Gazette references |
| **Owners and title** | `parcel_owner`, rights (to be created) | **Deeds Registry**; today only a simulation | Not built; depends on what the Ministry will expose | **The Registry's answer** |
| The layout stands' ward, area and zone | `land.stand_layout` | A planner's decisions on the review sheet (`docs/data-model/stand-attribute-review.xlsx`) | One migration after the sheet returns | Planner's decisions |
| Buildings tied to parcels | `land.building`, `public.buildings` | The 139,619 footprints exist; the parcel link is derived by overlay | To build (overlay, then review) | Needs real stands loaded first |
| The valuation roll and property records | `property`, `property_assessment` | The council's rates roll | CSV loader to build | Finance's roll, in some digital form |

### Wave 3: the registers the departments already keep (each department, 4 to 8 weeks, in parallel)
| Register | Tables | Source | Loader | Note |
|---|---|---|---|---|
| Roads, structures, WASH, livestock facilities | `council_ops.*` | The works, water and livestock inventories | `POST /ops/import/:register` (validated GeoJSON, no silent overwrite) | Empty today by design: "import the authoritative inventory" |
| Health premises, licences, food-handler certificates, burial permits | `health_*` | The EHO's registers | To build (CSV per register) | Paper or Excel today? Ask |
| **Open applications and cases that predate the system** | `permit_application` and children | The clerk's register | To build, **only for cases still open**; history stays on paper | Decide a cut-off date |
| Open complaints and enforcement files, **section 73 notices already served** | `building_complaint`, `title_notice`, `enforcement_order` | The inspector's files | Through the screens, not a bulk load | Each carries legal dates; load by hand so each is checked |
| The ERP link: parcel to account, status band | `revenue_link.*` | The finance system | The ERP integration inbound events and the reconciliation queue | Needs real parcels first |

### Wave 4: integrations switched on (IT administrator and the external bodies, alongside Wave 3)
Payment gateway live keys; ERP events live; email and SMS; the SurveyPro importer scheduled; the Deeds Registry link when available. These move no data of their own, but they fail loudly if Waves 1 and 2 were skipped.

## 4. What stays empty, on purpose
Applications from the public, payments, inspections, notices, correspondence, audit logs, sessions, survey jobs, and the history tables fill only through use. Loading history into them would forge the audit trail. Back-capture is limited to **cases still open on the day of cut-over**.

## 5. How each load is run

1. **A data-load register: built** (migration 188, `public.data_load` and `public.data_load_row`). Every load records what the data is, who holds the truth, the file and its SHA-256, rows read, loaded and rejected, the validation report, who ran it and the outcome (applied, failed, reversed, partly reversed), and the key of every row it wrote, so a load can be found in the data and taken out again. It is append-only and tenant-scoped. A refused or rolled-back attempt is recorded too, as `failed`; a dry run is not.
2. **Staging first.** Raw file into a staging table, never straight into the register.
3. **Validate** (every loader's own rules; the service refuses the whole batch on any error). Geometry validity, coordinate system known, keys resolvable, duplicates, the derived-column rule (`scripts/check-derived-columns.js`), tenancy (`verify-tenancy.js`, `verify-rls.js`).
4. **Report, then a person approves.** The dry-run report is read and signed by the department's officer.
5. **Apply in one transaction**, refusing a batch with any error (the existing importers' rule).
6. **Reconcile.** Counts against the source; a sample checked on the map; the audit view for stand-number links.

## 6. The decisions the council has to make
1. Who is the named data owner for each department's register? (Without one, nobody signs the dry-run report.)
2. The zoning matrix: who decides it, and by what date?
3. The fee schedule: has a resolution been passed and notice given (s76)?
4. The cut-off date for back-capturing open applications and cases.
5. The ward and area decisions on the review sheet.
6. Which ward dataset is authoritative until the Electoral Commission's arrives?
7. How much of the rates roll is digital, and who may release it?

## 7. What can be built now, without waiting for data
- A **readiness report**: **built** (14 October 2026). `node app-backend/scripts/data-readiness.js` (add `--md file` for a document, `--json file` for data, `--strict` to fail when anything blocks go-live). Per domain: what is loaded, what is identified as demonstration or test by an explicit rule, what is empty, and which fact-checks fail. The first baseline is [data-readiness-baseline-2026-10-14.md](data-readiness-baseline-2026-10-14.md). Run it on the production database before go-live: `--strict` is the gate.
- The **data-load register and the loader skeleton: built** (14 October 2026). `src/services/dataLoad.js` runs every load the same way: parse, validate, dry run, apply in one transaction, record, reverse. `node app-backend/scripts/load.js --kinds` lists the loaders; `load.js <kind> --file F --authority CODE --source "..." --custodian "..."` is a dry run, and `--apply` loads; `--list` shows the record; `--reverse <id>` takes a load out. Two loaders exist so far (`committee-members`, a CSV; `council-identity`, a JSON object), written to the pattern the rest should follow: a loader supplies `parse`, `validate`, `apply` and `undo`, and never writes a value that is not in its file. `data-load.test.js` (16 tests) covers dry run, refusal, provenance, reversal (including a reversal that must keep a row), append-only protection and isolation between authorities.
- Loaders for the registers that have none, written to the same pattern: valuation roll, health premises, open cases, fee schedule, wards and villages, land categories from Gazette references. Each needs the council's file format settled first.
- A **go-live clean-up script** for development copies: removes demonstration accounts, the test authority, smoke permits and the simulated deeds, so a copy of development can be used for training safely.
- ~~A data request letter pack~~ **Drafted** (14 October 2026): five letters and a tracker in [data-requests/](data-requests/README.md) (Electoral Commission, Surveyor-General, Registrar of Deeds, Ministry of Local Government, finance office and supplier). None sent; each needs the CEO's signature after legal review.

## 8. External dependencies and risks
| Dependency | Why it matters | If it does not arrive |
|---|---|---|
| Electoral Commission ward GIS files | Wards decide which authority sees which parcels, and the stand-number rule | Keep the COD-AB set, labelled pre-2023; ward counts will be approximate |
| Surveyor-General digital cadastre or approved diagrams | The register's boundaries | Load only what the Survey Section hands over file by file through the plan import |
| Deeds Registry interface | Owners and the s109 certificate | Owners stay unrecorded; the system says "not recorded", never guesses |
| The council's own decisions (matrix, fees) | Core answers to the public | The system answers "not decided" |
| Finance's rates roll | Rates, levies and clearance | Out of scope until released |

The main risk is not technical. It is a plausible-looking database that nobody trusts: the cure is provenance on every row, a named owner per register, and the readiness report published to the council.

## 9. Definition of "live"
- No demonstration account, test authority, smoke permit or simulated deed in the production database.
- Every loaded row traceable to a data-load record.
- Wards, plan zones and the matrix loaded, and the matrix signed by the planning officer.
- Every parcel has a land category with its basis, or is explicitly "not recorded".
- `check-derived-columns.js`, `verify-tenancy.js`, `verify-rls.js`, `verify-spatial-registry.js` all pass on the production database.
- Each department's register has a named owner and has been reconciled once against its paper or spreadsheet source.
- Backups taken and a restore tested.

## 10. Order of work, in short
1. Run the data inventory with each department (what exists, in what form, who owns it): 1 week.
2. Wave 0, and start the requests to the external custodians the same day: 1 to 2 weeks.
3. Build the readiness report, data-load register and loader skeleton while Wave 0 runs.
4. Waves 1 to 3 in parallel by department, each ending in a signed reconciliation.
5. Wave 4, then a rehearsal cut-over on a copy, then the real one.

Durations are estimates and depend on what the departments turn out to hold and on how quickly the external bodies answer.
