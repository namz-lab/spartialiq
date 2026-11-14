# The spatial engine: ward measures for the Chief Executive's maps

Migration `215_spatial_engine.sql`, schema `spatial_engine`. It turns the council's registers into comparable
ward measures. A map is a read of `spatial_engine.ward_value`; nothing is computed on request.

## How it works

1. **Wards.** The council's current wards are the rows of `admin.authority_ward` joined to `admin.ward`
   (view `spatial_engine.v_authority_ward`). Load them with `scripts/load-wards.js --file <wards file>`; they are
   linked as basis `interim` while decision D11 (the Council's official ward list) is open, and every screen
   says so. No wards, no map: the API returns no features and a reason.
2. **Measures.** Each is a row in `spatial_engine.measure` plus a function `spatial_engine.m_<key>()` returning
   `(ward_code, numerator, denominator, facts)`. A `NULL` ward_code row is facts that could not be placed.
3. **Refresh.** `spatial_engine.refresh()` (or `node scripts/refresh-spatial-engine.js`, or
   `POST /api/spatial-engine/refresh` for `admin`, `gis_officer`, `gis_head`) recomputes every enabled measure for
   the calling council, replaces its `current` values and records a `run`: when, against which ward list, and how
   many facts were placed and unlocated.
4. **Maps.** `GET /api/executive/maps` and `/api/executive/maps/:measure` (accounting officer) return the wards as
   GeoJSON with value, rank, class and reliability, plus the classification method and breaks, the ward register's
   basis, and what could not be placed.

## Rules that are in the data, not left to the screen

- A ward with no figure is `NULL` / `no_data`. It is never 0 and never in a class (a database constraint
  refuses a number marked `no_data`, and `no_data` with a number).
- A rate over a base below `min_denominator` is `small_base`: shown in the list, left unclassified on the map.
- Counts are not shaded. Measures are shares, densities or rates. A count belongs in a table or on symbols.
- Facts that cannot be placed in a ward are counted as `unlocated`, never spread over the wards. Custodian rows
  (a parcel with no council of its own) count for the council whose wards hold them.
- Nothing here uses arrears or status bands (decision D13).

## Adding a measure

1. Write `spatial_engine.m_<key>()` returning `(ward_code text, numerator numeric, denominator numeric, facts bigint)`.
   Read only the calling council's rows (`authority_id = app.authority_id()`), place facts with a point-in-ward
   join to `spatial_engine.v_authority_ward` (or `spatial_engine.ward_of_label()` for a register that carries only a
   ward number), and return a `NULL` ward_code row for what cannot be placed.
2. Insert a row in `spatial_engine.measure`: label, plain-language description, unit, kind (`share`, `density`,
   `rate`), direction, denominator kind, `min_denominator`, `value_scale` (100 for a percentage), classes, and
   either `quantile` or `fixed` with its thresholds. Fixed thresholds keep maps comparable over time; say in the
   source note that they are a policy default.
3. Add it in a migration, run the refresh, and add a case to `src/routes/__tests__/spatial-engine.sql.test.js`.
   No route or screen changes: the page lists whatever the catalogue enables.

## Not yet built

- **Population-based rates** (`kind = 'rate'`, denominator `population` or `households`) need ward populations in
  `spatial_engine.ward_denominator`. It is empty: nothing is estimated. Source: the ZIMSTAT 2022 census, ward level.
- **Smoothing** of rates over small populations (empirical Bayes), **accessibility** (distance to the nearest clinic
  or water point), **hot spots** and trends.
- A **public** ward map (decision D14 governs what may be published).
- History: only the `current` period is kept.
