# ARCHITECTURE — boundaries & target layout (GIS-EOS)

## Current reality (do not fight it)
Code is organised by role: `src/views/<role>/sections/*.vue`
(`planner`, `gis-officer`, `eo-planner`, `inspector`, `planning-clerk`,
`environment-officer`, `admin`, `council`). Shared map code lives in `src/map/`,
stores in `src/stores/`, services in `src/services/`, composables in `src/composables/`,
components in `src/components/`. 290 `.vue` files. **No `modules/` folder exists.**

## Target layout — NEW features only (guide, do not migrate)
A new business capability may be built as a self-contained feature module:
```
src/modules/<capability>/
  components/  pages/  services/  api/  stores/  models/  validation/  tests/
```
Rule: **extend an existing capability before adding a module.** Do not restructure the 290
existing files — the migration is explicitly out of scope. When a module and the legacy
`views/<role>/sections` layout both fit, follow the legacy layout unless the user asks otherwise.

## Boundary rules
- A module owns its data access; cross-module calls go through a service, never a direct import
  of another module's internal component/store.
- Shared, cross-capability code (map, api client, ui primitives) stays in `src/map`,
  `src/services`, `src/components` — not duplicated into a module.
- Backend routes stay under `/api`; the frontend never talks to Postgres directly.

## Reuse-first checklist (before creating anything)
1. Does `src/components/*` already have this UI? (`MapLayerFilters`, `ParcelSelectorMap`,
   `StandPickerModal`, `PaymentMethodPicker`, workflow/`ApplicationPipeline`, map/* …)
2. Does `src/composables/*` or `src/services/*` already do this?
3. Is the pattern in PATTERNS.md?
4. Only then write new — at the lowest rung that works.
