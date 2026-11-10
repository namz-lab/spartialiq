# OWNERSHIP — modules

Owner: `gis-eos-tpm`. One row per module/capability (not per file). Update when a module is
added or materially changed.

| Module / area | Purpose | Used by | Capability | Status |
|---|---|---|---|---|
| `src/map` | basemap + layer styling (single source) | all map views | Spatial rendering | active |
| `src/stores/spatial` | tile layer load/toggle + OGC fallback | map views | Spatial state | active |
| `src/services` | api client + tile helpers | app-wide | Data access | active |
| `src/views/planner` | statutory workflow, assessment, permits, Planning Studio (CAD subdivision) | planner role | Planning | active |
| `src/planning` | subdivision engine, standards, CAD model; DXF round-trip via `importDxf()` | Planning Studio, PlanningPanel | Planning | active |
| `src/views/eo-planner` | due diligence, circulation, committee, drafting | EO-planner | Planning | active |
| `src/views/gis-officer` | spatial DB, zoning, mapping, constraints | GIS officer | GIS ops | active |
| `src/views/planning-clerk` | intake, fees, notices, dispatch, register | clerk | Intake/registry | active |
| `src/views/inspector` | stage inspections, enforcement, certificates | inspector | Inspections | active |
| `src/views/environment-officer` | plan appraisal, inspections | EO | Environment | active |
| `src/views/admin` | data/content/style management | admin | Administration | active |
| `src/components/workflow` | application pipeline UI | multiple roles | Workflow UI | active |
| payments (`PaymentsView`, `PaymentMethodPicker`, …) | fees + receipts | citizen/clerk | Payments | active |
| surveyor (`src/views/surveyor`) | merged Survey Task Manager | surveyor | Survey | active |

> Seed — extend as modules evolve. Deprecated modules move to Status: deprecated, then archived.
