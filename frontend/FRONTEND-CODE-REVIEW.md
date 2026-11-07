# Vungu Planner Frontend Code Review

**Date:** 17 August 2026  
**Scope:** `app-frontend` only. No files were modified except this report.  
**Method:** Full `src/` inventory (607 files), router/auth/GIS/workflow/security/a11y/perf/toolchain reads, and targeted greps. Prior audit `docs/frontend-audit-2026-08.md` (9 August) was consulted so this review does not re-litigate items already closed.

**Honesty rule:** Every significant claim cites a path. Where runtime, backend, or visual proof was not available, the report says **Unable to verify from the current codebase.**

---

## 1. Executive Summary

This frontend is a capable mid-stage municipal platform, not a finished enterprise product.

The strongest work is real: cookie-based auth (httpOnly, no tokens in JS), a typed `meta.roles` router, a PostGIS vector-tile basemap with a published-style registry contract, a `dmApi` development-management spine, a planner Section 26 console with honest comments about what the server does and does not enforce, and a small but serious enterprise token set in `src/styles/enterprise.css`.

The product still cannot be treated as production-ready as a Local Authority planning system. Role workspaces are siloed. Several statutory registers live in `localStorage`. Statutory step gates are UI-only. Permit issue via `PATCH /status` does not enforce notice/objections/referrals. The GIS officer cannot open the symbology registry they are supposed to own. `/planner` has no role allow-list. The surveyor tree is a second application (231 of 607 `src/` files) with 7,000-line Vue files, a Leaflet stack, and a parallel API. Four design-token systems coexist. There is no CI, and `npm run lint` has no ESLint config.

A previous audit (9 August) closed the worst auth-transport bug (tokens in `localStorage`) and replaced hand-written path `if`s with `meta.roles`. Those wins are real. They did not finish the architecture.

**Overall frontend score: 5 / 10.**

---

## 2. Overall Assessment

| Question | Answer |
|---|---|
| What is good? | Cookie session, `dmApi` types, vector-tile registry contract, `RoleWorkspaceShell` reconnection (F17), planner CAD tests, `escapeHtml` in GIS-officer popups, `usePermitIssuance` honesty about server gaps, `responsive.css` + `useBreakpoint` foundation. |
| What is broken? | GIS officer blocked from `/admin/gis-symbology`. Clerk receipt does not PATCH permit status. `respondConsultation` has no UI caller. Env map `submitReview()` is a stub. `CanonicalStatus` omits `awaiting_eo_decision`. |
| What is fragile? | 25+ independent MapLibre instances. Planner notices in localStorage. Deep watchers on planning layers. `InteractiveMap.setStyle()` can drop the PostGIS stack. |
| What is duplicated? | Four status models. Three spatial stores/files. Leaflet + MapLibre. `masterplanSymbology.ts` vs registry. Parallel EO/inspector/env map+console pairs. Surveyor `auth`/`api`/`spatial`. |
| What is unfinished? | Committee/director roles. Roads/water/finance/records portals. Specialist referral response. Clerk→server wiring. Statutory API (`statutoryApi.ts` is TODO stubs). Document versioning/preview. |
| What is over-engineered? | Surveyor as an embedded CAD product (~38% of `src/`). Dual Turf majors. PWA Google Fonts cache for a self-hosted font stack. `SmartQGISRenderer` imported and unused. |
| What is under-engineered? | Shared map factory. Table virtualization. Form double-submit locks. Focus traps outside `UiSheet`. Skip links. CI. ESLint config. |
| What is inconsistent? | Accents `#1a73e8` / `#1f5aa8` / `#0066cc` / `#0284c7` / emerald Tailwind. Status badges. Empty states. `--sw-*` statutory shell vs `--ent-*`. |
| Production? | Not as a complete planning authority system. Login, citizen lodge (with caveats), and the vector basemap module are the closest to shippable islands. |

---

## 3. Architecture Assessment

### What is coherent

- **Intake unification is done.** Legacy `/development-application`, `/applications/*`, `/apply` redirect into `/citizen` → `useCitizenCase` → `dmApi.createPermit` (`src/router/index.ts:413–571`). That is the right pattern.
- **Role workspaces follow one shell.** `RoleWorkspaceShell.vue` hosts map + console for EO, EHO, and Inspector (`EOPlannerWorkspace.vue`, `EnvOfficerWorkspace.vue`, `InspectorWorkspace.vue`). Planner uses `PlannerShell.vue` the same way. Comments document the F17 reconnection of previously unreachable section trees.
- **Services exist.** `src/services/developmentManagementService.ts` is a real typed client for the DM handbook endpoints, not a mock.

### Architectural smells

| WHAT | WHY | IMPACT | RECOMMENDATION |
|---|---|---|---|
| Two applications in one repo | `src/views/surveyor/` has its own `stores/auth.ts`, `services/api.ts` (`/api/survey`, `VITE_API_BASE` → `localhost:3042`), Leaflet maps, and 7k-line views | Cannot share session, basemap, tokens, or a11y patterns; bundle and cognitive load explode | Treat surveyor as a bounded context: shared auth/api/basemap, isolate CAD modules; stop adding parallel stacks |
| Business state in `localStorage` composables | `usePlanningClerkCase`, `useGISOfficerWorkspace`, `useHealthCase`, `useCadastralCase` persist registers in the browser | Other roles never see clerk acks/fees; statutory clock can start in one browser only; PII on shared workstations until logout purge | Persist through `dmApi`; keep localStorage as draft cache only (planner already documents this tier model) |
| UI-only statutory gates | `StepLockGate.vue` is a presentational slot; `usePlannerCase` unlock flags are computed in the client; `usePermitIssuance.ts:5–22` states `PATCH /status` does not check notice/objections/referrals | A determined officer (or a bug) can issue a permit without the statutory package | Backend must enforce the same readiness `usePermitIssuance` already computes; frontend remains advisory |
| Parallel determination paths | EO `DecisionReviewSection` posts `/eo-decision`; planner Step 3 `setPermitStatus`; Step 4 `issue()` also sets `approved_with_conditions` | Conflicting sources of truth for “who decided” | One determination endpoint; planner drafts, EO/committee records |
| `src/statutory/` is a second product | `statutoryApi.ts:1–41` is TODO stubs that `console.warn` and return mocks; `PlannerStatutoryView` is a separate track from `dmApi` | Officers can believe Part V/VII data is saved | Either wire it or hide the route until the API exists |
| God views | `SurveyPlanMapView.vue` ~7223, `MapLibreAreaView.vue` ~6712, `VunguPlannerView.vue` ~4765, `HomeView.vue` ~3081, `BuildingInspectorView.vue` ~2870 | Unreviewable, untestable, duplicate map init | Split by concern; extract `createPortalMap()`; METRICS.md 300-line ceiling is already exceeded by an order of magnitude |
| Feature boundaries leak | `VunguPlannerView` owns map, register, QGIS overlay, notifications, stand registration, planning tools | Planner map cannot be reused by GIS officer without copying | Shared map host + feature plugins (layers, draw, QGIS panel) |

Component architecture is **not** coherent at the product level. It is coherent inside a few islands (citizen intake, `dmApi`, `src/map/vunguBasemap*.ts`, enterprise tokens).

State management is **appropriate in design** (Pinia for auth/spatial, inject/provide for case files) and **abused in practice** (case registers as localStorage, a unused second Pinia store with the same id `'spatial'`).

API calls are mixed into large views (`VunguPlannerView.vue` imports `@/utils/axios`; AdminView optimistic mutations). Composables are used correctly where they exist (`usePlannerCase`, `useCitizenCase`) and skipped where they should exist (clerk receipt, specialist consultation response).

---

## 4. Frontend Inventory

**`src/` total: 607 files.** Vue 310 · TypeScript 283 · CSS 5 · surveyor legacy JS 5. Tests: 70 Vitest specs + 1 Playwright file.

| Area | Files | Notes |
|---|---|---|
| `views/` | 396 | Dominated by surveyor (231) |
| `views/surveyor/` | 231 | Embedded CAD/survey product |
| `planning/` | 53 | Studio + CAD engine (well tested) |
| `components/` | 41 | Thin shared layer vs view count |
| `composables/` | 30 | 19 source + 11 tests |
| `services/` | 30 | 24 source + 6 tests |
| `map/` | 14 | Best-structured GIS module |
| `statutory/` | 11 | Stub persistence |
| `stores/` | 5 | Plus 9 under surveyor |
| `styles/` | 5 | Four token eras in practice |

**No `src/layouts/`.** Shells: `RoleWorkspaceShell.vue`, `PlannerShell.vue`, `StatutoryShell.vue`, surveyor `ModuleScaffold.vue`.

### Largest Vue files (maintainability risk)

| Lines | File |
|------:|------|
| ~7223 | `src/views/surveyor/views/modules/cadastral-standard/SurveyPlanMapView.vue` |
| ~6712 | `src/views/surveyor/views/modules/cadastral-standard/MapLibreAreaView.vue` |
| ~4765 | `src/views/planner/VunguPlannerView.vue` |
| ~4062 | `src/views/surveyor/views/modules/cadastral-standard/CadastralStandardView.vue` |
| ~3081 | `src/views/HomeView.vue` |
| ~2870 | `src/views/BuildingInspectorView.vue` |
| ~2655 | `src/components/InteractiveMap.vue` |
| ~2027 | `src/views/EOPlannerView.vue` |
| ~1971 | `src/views/planner/PlanningStudio.vue` |

**55 Vue files exceed 500 lines.** METRICS.md sets a ~300 line component ceiling.

### Duplicate / parallel files (verified)

| Pattern | Evidence |
|---|---|
| `spatial-simple.ts` | `src/stores/spatial-simple.ts` defines `defineStore('spatial', …)` and **has zero importers**. Same Pinia id as `stores/spatial.ts`. Dead, collision-risky if ever imported. |
| `topojson-converter.ts` | No importers under `src/`. |
| `SmartQGISRenderer` | Imported in `InteractiveMap.vue:152`; **never called**. |
| Survey plan UIs | `SurveyPlanView.vue` reachable via `SubmenuLoader` glob (`survey-plan` → `SurveyPlanView.vue`); `CadastralStandardView.vue:1077` embeds `SurveyPlanViewNew.vue`. Two implementations. |
| `AreasView2.vue` | Wrapper that only mounts `Areas2View.vue`. |
| MapLibre playgrounds | `MapLibrePlayground.vue` and `MaplibrePlaygroundView.vue`. |
| Env/EO/Inspector | Map view + portal view + workspace wrapper (intentional F17 pattern, still three files per role). |
| `siteContent.ts` | `src/content/siteContent.ts` and `src/services/siteContent.ts`. |
| Surveyor `auth`/`api`/`spatial` | Parallel to app-level stores/services. |

### Naming / organisation

- Role folders kebab-case vs `planner`/`citizen`/`admin`.
- `views/view/` for About/Services.
- Empty `views/surveyor/sections/`.
- Mixed GIS/QGIS/Gis casing.
- `Ui*` primitives exist; most screens do not use them.

---

## 5. GIS Architecture Review

### What is well designed

`src/map/vunguBasemap.ts` + `vunguBasemapStyle.ts` + `src/services/gisStyles.ts` + `src/services/vectorTiles.ts` is the correct enterprise shape:

- Catalogue (which layers) and registry (how they draw) loaded in parallel before paint (`vunguBasemap.ts` `addVunguBasemap`).
- Per-layer try/catch so one bad layer does not blank the map.
- Degraded registry mode is diagnostic grey, not a guessed palette (`vunguBasemapStyle.ts:23–26`).
- Click priority is explicit and tested (`clickPriority`, `src/map/__tests__/clickPriority.spec.ts`).
- SSE live refresh closed on `map.remove`.
- `qgisWmsOverlay.ts` documents WMS as authoritative pixels, WFS as degraded fallback.
- `MapLayerFilters.vue` / `MapLegend.vue` consume `chipColorFor` / `classificationColorsFor`.
- `src/map/tools/camera.ts` honours `prefers-reduced-motion`.

That module should be protected, not rewritten.

### What is wrong

**25+ `new maplibregl.Map(` call sites** (grep count). Each re-inits style, centre, zoom, controls. Only some call `addVunguBasemap`. Surveyor MapLibre views do **not** use `addVunguBasemap`.

**Leaflet still live** in surveyor: `DataMap.vue`, `AreaMap.vue`, `AreaComputationView.vue`, `usePolygonDrawing.ts`, `useParcelManagement.ts`. `package.json` keeps `leaflet` + `proj4leaflet`.

**GIS officer fragments the map:** five separate instances (`ZoningMapsSection`, `StandsEditorSection`, `ApplicationMappingSection`, `EnforcementMappingSection`, `EnvironmentalConstraintsSection`) instead of one map with overlays.

**GeoJSON at scale**

| Location | Pattern |
|---|---|
| `qgisWmsOverlay.ts` | WFS `maxFeatures: 5000` in degraded mode |
| `views/surveyor/services/spatial.ts` | `limit: 10000` |
| `ParcelSelectorMap.vue` | Farm layer as GeoJSON source |
| `InteractiveMap.vue` | Dynamic layers as GeoJSON |
| `stores/spatial.ts` | Comment claims TopoJSON; `feature()` from `topojson-client` is imported and **not used**; object stored then passed to MapLibre as geojson |

**Lifecycle**

- Most views call `map.remove()` on unmount (good).
- `addVunguBasemap` listeners (`zoomend`, `click`, `mouseenter`) are not `map.off`’d; safe if `remove()` always runs, stacked if `addVunguBasemap` is called twice on one instance.
- `InteractiveMap.vue` `setStyle()` cycles external OpenFreeMap styles and drops PostGIS/QGIS/SSE wiring.

**`preserveDrawingBuffer: true`** is set on export maps (`InteractiveMap`, `VunguPlannerView`, `SurveyPlanMapView`) and missing on GIS officer / citizen / inspector maps. Export would capture a blank canvas there; where it is set, GPU memory cost is real.

**Home eager-loads the map.** `HomeView.vue` statically imports `InteractiveMap.vue`, so `/` pulls MapLibre despite route-level lazy import and `manualChunks.maplibre`.

**Unable to verify:** QGIS Server health, registry population in your environment, tile p95, 60 fps pan. Those need a running backend + browser profile.

---

## 6. GIS Symbology / QGIS Synchronisation

**Stated target (correct):** QGIS authors → registry `/api/gis/styles` → `compileMaplibre()` for web and `compileQml()` for QGIS Server. Web is a renderer. `vunguBasemapStyle.ts:1–21` is explicit: this file must not hold colours.

**Current reality: multiple authorities.**

| Source | Claim | Used by |
|---|---|---|
| `/api/gis/styles` | Production contract | `vunguBasemapStyle.ts`, `gisStyles.ts` |
| `masterplanSymbology.ts:1–12` | “single source of truth” for planning colours | `planning-layers.ts`, `qgisWmsOverlay.ts` degraded palette, Planning Studio, `scripts/generate-qgis-symbology.mjs` |
| Hardcoded chrome in `vunguBasemap.ts` | Labels, 3D buildings, shields, province outline | Always-on map chrome, **bypasses registry** (buildings extrusion) |
| `InteractiveMap.vue` | `#27ae60` default, SVG symbol path | Dynamic/QGIS-extracted layers |
| `ParcelSelectorMap.vue` | `#3388ff` fallback | Parcel picker |
| `scripts/seed-gis-style-registry.mjs` | Forward path: seed registry, then stop holding colours in TS | Ops script |
| `scripts/generate-qgis-symbology.mjs` | Reverse path: frontend → `.qgs` | Contradicts registry-first story |

This does **not** yet satisfy “QGIS = authoritative cartographic source; web = renderer.”

It is a **mid-migration**. The registry path is the one to finish. `masterplanSymbology.ts` should become seed input / statutory schedule reference, not a second paint engine. Remaining label/building chrome should live in one `mapChrome.ts` (or registry “sheet” styles), not scattered hex in `vunguBasemap.ts`.

Admin UI: `GisSymbologyRegistryView.vue` (~1146 lines) is the right control surface. Route meta allows `gis_officer` + `admin` (`router/index.ts:247–258`). **The `/admin/*` prefix guard then blocks every non-admin**, so GIS officers cannot open it (`router/index.ts:674–677` runs before `meta.roles`). Tests in `route-roles.spec.ts` only `resolve()` meta; they never navigate. This is a production blocker for the symbology contract.

---

## 7. Planning Workflow Review

Canonical backend status lives in `developmentManagementService.ts:9–15` (`PermitStatus`, including `awaiting_eo_decision`).

### Stage board

| Stage | Status | Evidence |
|---|---|---|
| Application intake (citizen) | **Implemented** | `NewApplicationSection` → `useCitizenCase` → `dmApi.createPermit` |
| Intake (planner verify) | **Partial** | `Step1Intake.vue` loads `registered`; confirm is local completeness |
| Clerk receipt / ack / fees | **Siloed** | `usePlanningClerkCase` localStorage; `ApplicationReceiptSection` pastes permit UUID; no status PATCH |
| Due diligence | **Partial** | 21 checks in `dueDiligenceChecks.ts`; persisted in case JSON; gate is UI (`Step2DueDiligence`) |
| Zoning | **Partial** | `developmentControl.ts` + `ZoningAssessmentCard`; not a hard statutory lock |
| Survey | **Partial** | `SurveyRequestsCard` + surveyor `/surveyor/*` tasks; DD gate UI-only; `useCadastralCase` is a localStorage parallel |
| Environmental | **Partial / stub** | EHO `PlanAppraisalSection` lists permits; map view `EnvironmentalOfficerView.vue:70–72` `submitReview()` sets `'unavailable'` |
| Technical referrals | **Partial** | Create consultation in Step 2 / EO circulate; **`dmApi.respondConsultation` has no view caller** (grep: definition only in `developmentManagementService.ts:708`) |
| Notices | **Partial / duplicated** | Planner Step 5 local + clerk local + `PublicNotice` read in permit readiness |
| Committee | **Partial** | `CommitteeScheduleCard` (meetings API); report text local; resolution can `setPermitStatus` |
| Decision | **Split brain** | EO `/eo-decision` vs planner Step 3 vs Step 4 issue |
| Permit | **Partial** | Strong UI (`usePermitIssuance`); server does not enforce notice/referrals |
| Conditions | **Partial** | Library + 5-test UI; persisted on issue |
| Building plans | **Partial** | `BuildingPlansSection` dmApi; checklist localStorage; filter still mentions `conditionally_approved` |
| Inspections | **Duplicated** | `useInspectionCase` + `inspectionsService` bookings + `planningWorkflow` store in `BuildingInspectorView` |
| Enforcement | **Implemented (dmApi)** | Planner `EnforcementSection`; clerk records still local |
| Appeals | **Partial** | Citizen + clerk via dmApi |
| Documents | **Partial** | `PermitDocumentsPanel` lists; `StatutoryShell.vue:219–222` is a placeholder empty state |
| Audit | **Partial** | `CaseAuditTrail` reads `dmApi.listEvents`; clerk/local actions not in that trail |

### Step order problem

`StatutoryShell.vue:37–43` and `useStatutorySteps.ts` order is:

**Intake → Due Diligence → Committee → Permit → Notices**

Notices (acknowledgement, s.26(3), objections) sit **after** permit drafting. `step5Available` is always true. Chronology in law is the opposite for pre-decision notice/objection.

### `ApplicationPipeline`

`useApplicationPipeline.ts` is the right shared model (backend status → stages). **`ApplicationPipeline.vue` is used** in `citizen/sections/ApplicationsSection.vue`. It is **not** used in clerk register, EO case header, or planner register. `CanonicalStatus` (`useApplicationPipeline.ts:31–35`) **omits `awaiting_eo_decision`**, which EO inbox filters on (`DecisionReviewSection`).

### `planningWorkflow` Pinia store

`src/stores/planningWorkflow.ts` is a different `WorkflowStatus` enum (`pending_env`, `foundation_insp`, …). Used by `BuildingInspectorView.vue`. After `loadFromBackend` it mutates in memory. Duplicate lifecycle.

### `src/statutory/`

`statutoryApi.ts` is mock-only. `statutory/roles.ts` correctly leaves `devapp.determine` / `view.director` unassigned rather than faking committee powers. That honesty is good; the stub API is not.

---

## 8. Role & Permissions Review

### Issuable roles (`src/services/types.ts:26–37`)

`admin`, `planner`, `eo`, `env_officer`, `building_inspector`, `planning_clerk`, `surveyor`, `gis_officer`, `viewer`, `registered`, `public`.

### Mapped workspaces

| Role | Landing (`roleHome`) | Guard quality |
|---|---|---|
| planner | `/planner` | **Auth only — no `meta.roles`** |
| planning_clerk | `/planning-clerk-portal` | `withOversight('planning_clerk')` |
| eo | `/eo-planner-portal` | `eo`, `admin`, `planner`, `planning_clerk` |
| gis_officer | `/gis-officer-portal` | oversight; **cannot open symbology** |
| env_officer | `/env-officer-workspace` | EHO + env folded together |
| building_inspector | `/inspector-workspace` | oversight |
| surveyor | `/surveyor` | `surveyor`, `admin` (workspace children inherit) |
| admin | `/admin` | `requiresAdmin` + `ADMIN_BLOCKED` for `/planner` only |
| citizen-like | `/citizen` | Auth only; **any staff can open it** |

### Missing vs the brief

No backend `Role` and no workspace for: **Health (distinct from EHO)**, **Roads**, **Water**, **Finance**, **Records**, **Committee**, **Directors**. Documented as deliberate in `types.ts:20–24` and `statutory/roles.ts:37–47`. Product requirement and code currently disagree.

### Highest RBAC holes

1. **`/planner` and `/planner/studio/:layer/:fid`** — `requiresAuth` only (`router/index.ts:292–306`). A `registered` citizen who knows the URL loads `PlannerShell` / `PlanningStudio`. `viewer` is specially bounced; citizen is not. `VunguPlannerView` only hides some tools via `isPlanner`.
2. **`/admin/*` prefix vs GIS symbology** — GIS officer never reaches `/admin/gis-symbology`.
3. **IT admin on planning PII screens** — `ADMIN_BLOCKED` is `/planner`, `/analytics`, `/explore`, `/layers`, `/explorer` only. Admin remains in `meta.roles` for EO portal, GIS map, property file, report builder. Router comments admit backend still allows admin on planning APIs (`router/index.ts:604–608`).
4. **Frontend is advisory.** Comment at `router/index.ts:691–693`. Correct. Do not treat UI hiding as authorization.

`RoleWorkspaceShell.vue` does not check role. If a route is under-guarded, the full workspace renders.

---

## 9. Responsive / Mobile Review

**Unable to visually screenshot every major screen at 320×800 … 1440×900 in this pass.** Findings are from CSS, `useBreakpoint`, component structure, and `e2e/responsive.spec.ts`.

### What exists

- `src/styles/responsive.css`: overflow-x clip, 44px coarse-pointer floor, 16px inputs on mobile, type re-pitch, `.ent-autogrid` / `.ent-sheet` utilities.
- `useBreakpoint.ts`: 767 / 768 / 1024 / 1440, shared listeners.
- `UiSheet.vue`: dialog/sheet/drawer by breakpoint, focus trap, scroll lock.
- `UiBottomNav.vue`: used in `PlanningClerkPortalView`, `EOPlannerPortalView`, `GISOfficerPortalView`, `InspectorWorkspaceView`, `EnvironmentOfficerWorkspaceView`, `PlannerWorkspaceView`, `HomeView`.
- `VunguPlannerView.vue` has a real mobile block (bottom sheets, FABs, horizontal tool scroll) — desktop GIS squeezed, not a field-first redesign.

### What fails as UX (not just CSS)

| Surface | Why mobile interaction redesign is required |
|---|---|
| Surveyor CAD (`SurveyPlanMapView`, `MapLibreAreaView`, coordinate tables) | Desktop survey workstation; cannot be “made responsive” |
| `BuildingInspectorView.vue` / `EOPlannerView.vue` | Monoliths, hundreds of hardcoded colours, no `useBreakpoint` discipline |
| `MapExplorer.vue` | Sidebar `min-width: 280px` — ~40px left for map at 320px |
| Clerk `DevelopmentRegisterSection.vue` | 9-column `<table>`, horizontal scroll only |
| `CitizenPortalView.vue` | Custom `.cp-sheet` + custom `--cp-*` nav instead of `UiBottomNav`/`UiSheet` |
| Planning Studio | Dual-monitor subdivision tool |
| GIS officer five maps | Each map + chrome on a phone is unusable; needs one map + sheet |

### E2e gap

`e2e/responsive.spec.ts` tests **unauthenticated** `/`, `/login`, `/register`, `/explorer` only. Comment lists authed routes as out of scope. Overflow/touch-target claims for planner/citizen/GIS are **unverified in CI**.

Legacy 900px breakpoints remain in `public-pages.css`, `HomeView.vue`, `AdminView.vue`, `DocumentsView.vue`, `PaymentsView.vue`, fighting the 768 token.

---

## 10. UI/UX Review

**Works technically, poor UX (separate from bugs):**

- **Cognitive load on planner map.** `VunguPlannerView` combines basemap, QGIS, planning tools, register, notifications, stand dialogs. PRODUCT.md “one job per surface” is violated.
- **Statutory shell map is fake.** `StatutoryShell.vue:230–246` draws a CSS grid + labelled box, not MapLibre. Officers in the case console do not see the parcel they are deciding.
- **Next action is unclear across roles.** Clerk pastes a UUID. Env submit is “unavailable”. Specialists cannot close consultations. Pipeline component is missing from staff headers.
- **Status language drifts.** Citizen 25-stage `APPLICATION_LIFECYCLE` vs seven pipeline stages vs inspector `WorkflowStatus`.
- **Hero anti-reference risk.** KPI-style dashboards exist in role `DashboardSection.vue` files; PRODUCT.md bans generic SaaS metric cards. Not fully audited visually; pattern is present (`UiKpi.vue`).
- **Emoji on payment** (`PaymentGatewayView`) vs brand “no decoration”.
- **Discoverability:** two surveyor entries (`/surveyor` vs `/surveyor-workspace`); two planner tracks (`/planner` vs `/statutory/planner`).

**Good UX islands:** Login labels/`aria-invalid`; citizen 5-step application wizard with draft save; `PermitRegisterSection` using `UiDataTable` + mobile `UiSheet` filters; planner offline banner (`PlannerShell.vue`).

---

## 11. Design System Review

**Four (plus) token authorities:**

| System | Accent | Where |
|---|---|---|
| `DESIGN.md` | `#1a73e8` | Product doc + some map chrome |
| `enterprise.css` `--ent-*` | `#1f5aa8` | Declared SSOT for migrated chrome (`main.ts:6–8`) |
| `main.css` `--login-*` | `#0066cc` + purple gradient | DESIGN-SYSTEM.md / gis-eos-frontend skill; **LoginView does not use these tokens** |
| Citizen `--cp-*` | `#0284c7` | `CitizenPortalView.vue` |
| Tailwind emerald | `#1e6b4a` | `main.css` focus ring still uses `--accent-500` |
| Statutory `--sw-*` | indigo | `StatutoryShell.vue:9` “independent of the citizen portal” |

`enterprise.css:1–19` is a serious, government-correct system (cool neutrals, one accent ≤10%, five status tones, Geist). **Adoption is the failure**, not the tokens.

Hardcoded hex appears throughout large Vue files (Building Inspector, EO Planner, Home, Admin, GIS map, surveyor plans). New code still introduces `#1a73e8` in map toolbars.

Icons: **lucide-vue-next is used; `@heroicons/vue` has zero `src/` imports** (dependency still in `package.json`). Inline SVGs remain on Login and MapExplorer.

`UiButton` / `UiStatusBadge` / `UiEmptyState` / `UiDataTable` are the right primitives and are barely used outside planner statutory + a few admin screens.

---

## 12. Accessibility Review

PRODUCT.md requires WCAG 2.1 AA (request also asked 2.2 AA). The codebase does not meet that as a system.

| Issue | Evidence |
|---|---|
| Skip links styled, never rendered | `.ent-skip-link` in `responsive.css`; **no template** contains skip-to-main |
| Icon-only buttons without names | `GISMapView.vue`, `EOPlannerView` close buttons, `AdminView` `.modal-close`, `StandsEditorSection` |
| Focus trap only in `UiSheet` | Register/edit dialogs in `VunguPlannerView`, `PlanningStudio` draft recovery, `EOPlannerView` zone modal, `CaseFileDrawer`, `CSVReimportDialog` — `role="dialog"` without trap/Escape |
| `outline: none` without replacement | `AnalyticsView.vue` export button |
| Labels without `for` | `AdminView`, `EOPlannerView`, `NewApplicationSection` wrapping labels inconsistently |
| Reduced motion gaps | `InteractiveMap` spinner; `EOPlannerView` `flyTo` duration 1200 without `prefersReducedMotion()`; inspector `.spin` |
| Contrast | `QGISMapView.vue` `.style-preview pre { color: #aaa }` on white |
| Map tools | Keyboard support is title-attribute only on planner tools |

**Good:** `UiSheet` trap; `UiButton` focus ring; login `aria-invalid`; GIS officer `sr-only` on some controls; `vunguBasemap` reduced-motion camera.

No axe/NVDA automation in tests. PRODUCT.md “tested with NVDA” is **Unable to verify from the current codebase.**

---

## 13. Performance Review

Budgets (METRICS.md): load <2s, tiles <100ms, pan 60fps, tables virtualize >500 rows.

| Risk | Evidence |
|---|---|
| God components | 7k-line surveyor maps; 4.7k planner view |
| 25+ WebGL maps | Multiple role maps can be mounted in shells (map pane + console map) |
| Home pulls MapLibre | Eager `InteractiveMap` import |
| Global MapLibre CSS | `main.ts:19` on every page |
| Deep watchers | `usePlanningTools.ts` deep watch on roads/constraints/rules; `VunguPlannerView` `watch(planning.layers, { deep: true })`; surveyor `DataMap` deep watch on items/parcels |
| No table virtualization | `UiDataTable` comment: “≤ a few hundred”; `AttributeTable` caps 1000 rows still in DOM; clerk register renders all rows |
| GeoJSON dumps | WFS 5k, surveyor 10k, farm GeoJSON |
| `preserveDrawingBuffer` | Extra GPU where set |
| Dual Turf | v6 `@turf/turf` everywhere + v7 packages in `MapLibreAreaView` |
| Unused deps still chunked | `gsap` only in HomeView; `matter-js` **zero imports**; still in `package.json` |

**Unable to verify:** actual gzip bundle sizes, LCP, tile timing. Hidden sourcemaps (`vite.config.ts:140`) are a good production choice. `esbuild.drop` console in production (`vite.config.ts:133–135`) is correct given leftover PII logs.

PWA caches vector tiles (good for rural) and **Google Fonts** (`vite.config.ts:74–82`) though `index.html` self-hosts Geist. Dead cache rule.

---

## 14. Security Review

### Strong

- httpOnly cookies `vungu_at` / `vungu_rt`; JS holds only `localStorage.auth_present` (`session.ts`, `auth.ts`, `api.ts` `withCredentials`).
- Logout/401 purge of `planner_*`, `clerk_*`, `eho_*`, `gis_*`, `citizen_*` prefixes (`session.ts:32–40`).
- `escapeHtml` used in GIS-officer application/enforcement popups and `vunguBasemap` admin popups.
- Single `v-html` in `VunguPlannerView.vue:57` goes through `highlightMatch()` which escapes first.
- No `eval` / `new Function` under `src/`.
- Invite token validated server-side (`InviteAcceptView`).

### High

| WHAT | WHERE | WHY |
|---|---|---|
| Unescaped MapLibre HTML | `SurveyPlanMapView.vue` `innerHTML = beacon.name` and popup strings; `useControlPointMap.ts` popups; `GISMapView.vue` search `setHTML`; `MapLibreAreaView.vue` popups; `GeodeticPlaneView.vue` | Stored XSS from GIS/survey attributes. `escapeHtml.ts` exists specifically for this sink and is skipped. |
| PII in localStorage | `usePlannerCase` `planner_case_${id}`; `useCitizenCase` `citizen_drafts_v1`; clerk/GIS/EHO keys | XSS or next user on a shared PC before purge; drafts survive crash without encryption |
| Double payment submit | `NewApplicationSection.handlePay` (no busy flag); `PaymentMethodPicker` emits immediately | Duplicate permits/payments |
| Client RBAC theatre | `/planner` open to any authed user | Screen + any cached case JSON |

Frontend permissions are **not** a security boundary. `usePermitIssuance.ts:5–22` is the model comment every money/permit path should copy.

File uploads: `DocumentsSection` has no `accept`/size check; `DocumentsView` advertises 12 MB without client check; `ProfileDropdown` silently returns on oversized avatar.

Invite token in query string (`InviteAcceptView`) may leak via Referer — document; prefer POST body if backend allows.

**Unable to verify:** backend `requireRole()` lists (commented as still including `admin` on planning routes).

---

## 15. State Management Review

| Kind | Where | Problem |
|---|---|---|
| Global | `stores/auth.ts` | Correct: in-memory user, cookie session |
| Global | `stores/spatial.ts` | Live; error not always bound in UI |
| Global | `stores/spatial-simple.ts` | Dead duplicate, same store id |
| Global | `stores/planningWorkflow.ts` | Legacy inspector board |
| Global | `stores/council.ts` | Content |
| Injected case | `usePlannerCase` | Best model (dmApi + memory + local cache); notices not in `caseToPatch` |
| Injected case | clerk / GIS / EHO / cadastral | localStorage as system of record |
| URL | `?pane=&section=` on planner | Good |
| Map | per-view `map` refs | No shared map store; 25 instances |
| Surveyor | `views/surveyor/stores/*` | Second auth + spatial universe |
| Race | `usePlannerCase` window-focus reload can overwrite newer local draft (`:489–494` area) | Data loss risk |
| Dead code | `PaymentMethodPicker.submit` / `submitting` unused; `NewApplicationSection.submit` unused | Misleading |

Prop drilling is limited where provide/inject is used. Global state abuse is mainly the unused `spatial-simple` and `planningWorkflow` parallel world.

---

## 16. API / Service Layer Review

**Centralised enough for the main app:** `src/services/api.ts` (axios, 30s timeout, 401 interceptor). `src/utils/axios.ts` re-exports it (not a second instance). Surveyor `views/surveyor/services/api.ts` is a **second client** (`VITE_API_BASE`, `/api/survey`).

`developmentManagementService.ts` is the DM spine and is typed. Other services (`paymentsService`, `documentsService`, `gisOfficerService`, `planningClerkService`, `inspectionsService`, `planReviewService`) are separate slices — some overlap inspections/building plans.

**No request cancellation** (AbortController) on map/catalog loads — Unable to confirm widespread use; pattern is generally missing.

**No HTTP cache layer** beyond PWA tile caching. Catalog promise cache exists in `vectorTiles.ts` (good).

Errors: `useUiFeedback.parseApiError` is the right helper; Admin/EO still roll local toasts; GIS dashboard can fail empty.

`publicApi.getStats()` hitting `/admin/analytics` from the home page — **Unable to verify** whether the backend allows anonymous access.

---

## 17. Form Review

| Form | Validation | Draft | Double-submit | A11y | Mobile |
|---|---|---|---|---|---|
| Login | Server + `aria-invalid` | n/a | disabled while loading | Good labels | OK |
| Register | Present | n/a | loading | Good | OK |
| New application | Step `stepValid`; toast not field errors | Auto-save + save for later | **No guard on `handlePay`** | Weak `for`/`id`; one `aria-label` | Wizard usable |
| Planner steps 1–5 | Completeness / DD checks | localStorage + PATCH | Mixed | Custom `.iq-*` not enterprise fields | Dense |
| Payment picker | Wallet prefix | n/a | **No in-flight lock** | Partial | OK |
| Admin user modal | Partial | n/a | **No busy on submit** | Labels without `for` | Poor |
| Env submit review | n/a | n/a | Stub | — | — |

Autosave is appropriate for planner case and citizen draft. Clerk forms save only locally.

---

## 18. Table Review

`UiDataTable.vue`: client sort, mobile card mode, **no pagination, no virtualization**. Comment says server-side for large sets — callers must page. Only ~3 production consumers (`PermitRegisterSection` is the reference).

Tables that will fail on a municipal register:

- `planning-clerk/sections/DevelopmentRegisterSection.vue` — full table, inline hex status map
- `PermitDocumentsPanel.vue` — 5 columns, no card mode
- Surveyor `PointsTable.vue`, `CoordinateListView.vue`
- `components/map/AttributeTable.vue` — 1000-row cap still in DOM
- Admin user lists in `AdminView.vue`

No export/virtualization/keyboard grid pattern except whatever each table reinvented.

---

## 19. Document Management Review

Not a coherent product surface.

| Surface | Upload | Preview | Versioning | Permissions |
|---|---|---|---|---|
| `DocumentsView.vue` | Yes | External `storageUrl` | No | Delete if pending |
| `DocumentsSection.vue` | Stage in memory | List | No | Draft |
| `IdentityDocVerifier.vue` | Yes + AI fields | No | Replace | 409 duplicate |
| `PermitDocumentsPanel.vue` | No (staff read) | New tab | No | dmApi |
| `IdentityReviewSection.vue` | No | Link | No | 403 message |
| `StatutoryShell` docs card | Placeholder | — | — | — |

`documentsService.ts` types include verification/AI hashes, not versions. Large files: UI copy vs missing client size check. Mobile: another emerald/citizen visual system on `DocumentsView`.

---

## 20. Code Quality Review

- TypeScript is used, but **~1,042 `: any` and ~671 `as any`** concentrated in surveyor maps, `InteractiveMap`, `VunguPlannerView`, `cadRender.ts`.
- `tsconfig.json` includes root `env.d.ts` which **does not exist** (surveyor has its own).
- `vite-env.d.ts` declares `VITE_MAP_STYLE` / `VITE_MAP_ACCESS_TOKEN` unused; surveyor uses undeclared `VITE_API_BASE`.
- Five surveyor `.js` files with ambient `.d.ts`.
- Magic values: map centre `[29.82, -19.48]` copied; SLA `plusWorkingDays(..., 5)` in clerk case.
- Comments are often excellent (router ADMIN_BLOCKED, permit issuance, session, vunguBasemapStyle). That documentation quality is a strength.
- Testability of 4k–7k SFCs is poor by construction.
- CSS: scoped per-view plus four global sheets; complexity is duplication, not one huge file.

---

## 21. Testing Review

**~70 Vitest specs. Strength is not uniform.**

**Strong:** planning CAD (`src/planning/cad/__tests__/*`), subdivision/studio, router `meta.roles` snapshots, `vunguBasemapStyle`, DXF import, citizen stand-picker/submit-and-pay unit tests, `usePlannerCase` gating/persistence/seed, payments service unit tests.

**Missing:**

- GIS officer composable/sections
- `usePlanningClerkCase` localStorage behaviour
- Env officer / `useHealthCase`
- `useInspectionCase`
- `respondConsultation` UI (none to test)
- Playwright beyond public marketing/login
- axe/a11y
- Guard tests for `/planner` deny (citizen) and GIS officer → symbology allow
- Map instance leak / `addVunguBasemap` double-call

QA skill notes: `happy-dom` pragma required for mount tests (49/70 have it); full Vitest can flake without `--no-file-parallelism` — **`package.json` `test` script does not pass `--no-file-parallelism`.**

---

## 22. Routing Review

See §8 for the table. Additional:

- **Lazy loading:** all route components use dynamic `import()`. Good.
- **Dead/legacy redirects:** `/portal`, `/eo-planner`, `/env-officer`, `/building-inspector`, `/planning-clerk`, `/gis-officer`, `/planner-workspace`, `/planner/statutory`, `/development-application*`, `/applications*`, `/apply*`, `/admin/login` — intentional bookmarks.
- **Duplicate purpose, not duplicate routes:** `/gis-map` (staff PII) vs `/qgis-map` (**public**, no auth). Public QGIS styled map may be intended; confirm it does not leak permit overlays.
- **`/help` redirects to citizen new application** — odd for staff.
- **`/login` lacks `hideForAuth`** (register has it).
- Deep surveyor URLs `/surveyor-workspace/modules/:module/:submenu` via glob loaders — flexible, untyped, easy to 404 internally (`NotFoundView` inside surveyor).

MUNICIPAL-STANDARDS.md paths (`/citizen-portal`, `/planner-workspace`, …) are stale vs live routes.

---

## 23. Technical Debt

### Critical

| Location | Problem | Why it matters | Risk | Recommendation | Complexity |
|---|---|---|---|---|---|
| `router/index.ts:292–306` | `/planner` and studio unguarded | Citizen/staff can open planner shell | PII / process integrity | `meta.roles: ['planner','admin']` (+ oversight if product requires) | S |
| `router/index.ts:674–677` vs `:247–258` | GIS officer blocked from symbology | Cartographic contract unusable by owner | Wrong styles in production | Exempt `meta.roles` routes or move to `/gis-officer-portal/symbology` | S |
| `usePermitIssuance.ts:5–22` + Step 3/4 | Server does not enforce statutory package; two issue paths | Unlawful permit in the register | Legal | Backend gate; single determination | M (needs backend) |
| MapLibre `setHTML` without `escapeHtml` | Surveyor + GISMapView | Stored XSS | Session/PII | Escape every interpolated field | S–M |
| Clerk localStorage registers | `usePlanningClerkCase` | Intake clock not on server | Statutory SLA fiction | Wire receipt/ack to `dmApi` | M |

### High

| Location | Problem | Why | Risk | Recommendation | Complexity |
|---|---|---|---|---|---|
| Surveyor 7k SFCs + Leaflet | Second app | Unmaintainable | Freeze CAD, extract map factory | L |
| Status enums | Four models | Wrong EO/citizen/inspector state | One `normalizePermitStatus` | M |
| `respondConsultation` unused | Referrals never close in UI | Circulation stall | Specialist response UIs | M |
| `spatial-simple.ts` / unused renderer / topojson converter | Dead code | Collision / confusion | Delete after grep | S |
| `NewApplicationSection.handlePay` | Double submit | Duplicate money | Busy flag | S |
| No CI / no ESLint config | `npm run lint` fails | Quality drift | Add config + workflow | S |
| Token systems | Visual chaos | Brand/a11y | `--ent-*` only for chrome | L |

### Medium

Statutory step order; `CanonicalStatus` missing `awaiting_eo_decision`; `planningWorkflow` store; `StatutoryShell` fake map; `InteractiveMap.setStyle`; Home eager map; `UiDataTable` without virtualize; document preview; skip links; focus traps; 900px breakpoints; `matter-js` unused; Turf v6+v7; surveyor `VITE_API_BASE`.

### Low

Login `hideForAuth`; emoji on payment; naming GIS/QGIS; `AreasView2` wrapper; playground views; empty surveyor `sections/` folder; PWA Google Fonts rule.

---

## 24. Critical Risks

1. **Statutory decision without server-side gates** (`usePermitIssuance` + `PATCH /status`).
2. **XSS in map popups** (surveyor/GIS search).
3. **`/planner` reachable by any authenticated user.**
4. **GIS officer cannot publish symbology** (guard vs meta).
5. **Clerk workflow not on the server** (SLA/ack/fees in the browser).
6. **Split determination** (EO vs planner Step 3 vs Step 4).
7. **Referral loop cannot close** (`respondConsultation` unused).
8. **Surveyor maintainability / memory** (7k-line WebGL views, Leaflet+MapLibre).
9. **PII in localStorage** on shared council PCs (mitigated on logout, not on XSS).
10. **No CI** — type-check/tests/lint not gated on merge.

---

## 25. Recommended Target Architecture

```
QGIS Desktop ──compileQml──► QGIS Server (WMS for unexpressible symbology)
     │
     └── publish ──► GIS style registry (/api/gis/styles)
                         ├── compileMaplibre ──► src/map/vunguBasemapStyle.ts (renderer only)
                         └── version / approve / rollback (GisSymbologyRegistry)

PostGIS ── ST_AsMVT ──► /api/tiles ──► addVunguBasemap(map)  [single map factory]

Auth: httpOnly cookies ── GET /auth/me ── Pinia auth ── router meta.roles (UX) + Fastify requireRole (security)

Case: permit_application (dmApi) = system of record
      localStorage = draft cache only (already the planner comment)

UI:  RoleWorkspaceShell | PlannerShell
       ├── one MapHost (createPortalMap)
       └── section console (routes, not v-if forests)

Chrome: --ent-* only
Cartography: registry only (+ mapChrome for sheet/labels)
```

**Do not** invent a new framework. Finish the contracts already written in `vunguBasemapStyle.ts`, `session.ts`, `usePlannerCase.ts`, and `usePermitIssuance.ts`.

---

## 26. Prioritised Remediation Roadmap

### Phase 0 — Stop the bleeding (1–2 weeks)

1. Guard `/planner` and `/planner/studio/*`.
2. Fix GIS symbology route vs `/admin` prefix; add a **navigation** test.
3. Escape all MapLibre HTML sinks with `escapeHtml`.
4. Busy-flag `handlePay` / PaymentMethodPicker.
5. Add ESLint config; CI: `type-check`, `vitest run --no-file-parallelism`, Playwright public spec.
6. Delete `spatial-simple.ts`, unused `topojson-converter.ts`, dead `SmartQGISRenderer` import (verify glob/dynamic first).

### Phase 1 — Statutory spine (2–4 weeks)

1. Persist clerk receipt/ack/fees via `dmApi`; stop UUID paste as the happy path.
2. Wire `respondConsultation` into GIS / EHO / env / inspector consoles.
3. Reorder notices vs committee; gate Step 4 on EO/committee package.
4. Extend `CanonicalStatus` with `awaiting_eo_decision`; mount `ApplicationPipeline` on staff case headers.
5. Backend: enforce permit readiness (tracked as frontend-documented gap).
6. Hide or disable `/statutory/planner` until `statutoryApi` is real.

### Phase 2 — GIS consolidation (3–5 weeks)

1. `createPortalMap()` used by planner, GIS officer, EO, inspector, citizen map, InteractiveMap.
2. Finish registry migration; demote `masterplanSymbology.ts` to seed/schedule.
3. One GIS-officer map instance; tab overlays.
4. Fix TopoJSON→GeoJSON in `stores/spatial.ts` or delete the path.
5. Remove or guard `InteractiveMap` external `setStyle` cycle.
6. Surveyor: freeze Leaflet; no new Leaflet; plan MapLibre+basemap for new work.

### Phase 3 — Design system + mobile (ongoing)

1. Migrate chrome to `--ent-*`; kill `--cp-*` / `--sw-*` / leftover emerald.
2. `UiBottomNav` on citizen; `UiDataTable` on clerk register; `UiSheet` for remaining dialogs.
3. Skip links; focus traps; Playwright authed overflow tests for `/citizen`, `/planner`.
4. Structural mobile only where the job is field work (inspector, citizen, clerk). Do not pretend CAD is a phone app.

### Phase 4 — Surveyor bounded context

Split 7k views; share auth; document CAD as a workstation product with a desktop breakpoint, not a responsive target.

---

## 27. Files / Components Requiring Action

| File | Action |
|---|---|
| `src/router/index.ts` | Roles on planner; fix admin prefix vs symbology; `hideForAuth` on login |
| `src/composables/usePlanningClerkCase.ts` + `ApplicationReceiptSection.vue` | Server writes |
| `src/composables/useApplicationPipeline.ts` | Add `awaiting_eo_decision` |
| `src/components/workflow/ApplicationPipeline.vue` | Mount on staff case UIs |
| `src/views/planner/StatutoryShell.vue` | Real map or drop fake map; document pane |
| `src/views/planner/permit/usePermitIssuance.ts` | Keep honesty; pair with backend |
| `src/views/planner/VunguPlannerView.vue` | Split; escape popups; reduced-motion |
| `src/components/InteractiveMap.vue` | Remove dead SmartQGIS import; stop destructive `setStyle` |
| `src/stores/spatial.ts` / `spatial-simple.ts` | Fix TopoJSON; delete simple |
| `src/map/masterplanSymbology.ts` | Demote after registry complete |
| `src/views/GISMapView.vue` | Escape search HTML |
| Surveyor map views listed in §12 | `escapeHtml` / `textContent` |
| `src/views/citizen/sections/NewApplicationSection.vue` | Submit lock; labels |
| `src/views/EnvironmentalOfficerView.vue` | Replace unavailable stub or hide CTA |
| `src/statutory/services/statutoryApi.ts` | Do not ship mocks as persistence |
| `src/views/CitizenPortalView.vue` | Adopt UiBottomNav / --ent |
| `DevelopmentRegisterSection.vue` | UiDataTable + server page |
| `package.json` / ESLint / CI | Tooling |
| `docs/frontend-audit-2026-08.md` | Superseded in parts; keep as history |

---

## 28. What Should Be Deleted

**Safe to delete after a final dynamic-import grep (this review already grepped static imports):**

- `src/stores/spatial-simple.ts` (no importers; colliding store id)
- `src/utils/topojson-converter.ts` (no importers)
- `SmartQGISRenderer` usage in `InteractiveMap.vue` (import only) — then the util if unused
- `matter-js` / `@types/matter-js` if confirmed unused
- `@heroicons/vue` if no planned use
- Surveyor playgrounds if not linked from module indices (`MapLibrePlayground.vue`, `MaplibrePlaygroundView.vue`) — **confirm glob slugs first**
- `AreasView2.vue` wrapper once routes point at `Areas2View.vue`

**Do not delete without product decision:**

- `SurveyPlanView.vue` — `SubmenuLoader` glob can resolve `survey-plan` → this file even though `CadastralStandardView` embeds `SurveyPlanViewNew`
- F17 map views (`EOPlannerView`, `BuildingInspectorView`, `EnvironmentalOfficerView`) — they are the map panes
- `masterplanSymbology.ts` until registry seed no longer needs it
- `src/statutory/*` until product drops Phase A stub track

---

## 29. What Should Be Refactored

- Extract `createPortalMap()` from the 25 Map() sites.
- Split `VunguPlannerView.vue`, `HomeView.vue`, surveyor 6k+ views.
- Collapse inspector `planningWorkflow` into `useInspectionCase` + dmApi.
- One status normalizer used by pipeline, citizen lifecycle, EO filters, building-plans filters.
- Move GIS symbology out of `/admin` or special-case the guard.
- Adopt `UiSheet` for remaining dialogs (focus trap).
- Surveyor API base env: `VITE_API_BASE_URL` only.

---

## 30. What Should Be Created

- CI workflow (type-check, unit tests, Playwright smoke).
- ESLint flat/legacy config matching existing Vue/TS plugins.
- `createPortalMap` + `GisOfficerMap` host.
- Specialist `ConsultationResponsePanel.vue` calling `dmApi.respondConsultation`.
- Document preview component (PDF/image) shared staff/citizen.
- Skip-to-main in shells.
- Playwright authed overflow specs (after test users exist).
- Backend work (out of scope here but blocking): permit readiness, admin removed from planning `requireRole`, committee/director roles if those portals are in scope.
- Roads/Water/Finance/Records/Committee/Director workspaces — **only after** backend roles exist (`types.ts` already warns not to gate on phantom roles).

---

## 31. Production Readiness Score

| Dimension | Score | Justification |
|---|---|---|
| FUNCTIONALITY | 6 | Citizen lodge, planner console, EO decision, inspections, survey tasks exist; clerk/referrals/env submit incomplete |
| ARCHITECTURE | 5 | Good islands; surveyor + localStorage + dual statutory tracks |
| GIS | 6 | Registry design excellent; mid-migration; 25 maps; Leaflet remnant |
| UX | 5 | Some calm enterprise screens; fake statutory map; unclear next actions |
| RESPONSIVENESS | 4 | Solid CSS kit; e2e only public; CAD/inspector not field-ready |
| ACCESSIBILITY | 4 | Tokens/focus in Ui*; skip links missing; dialogs untrapped; map XSS aside |
| SECURITY | 6 | Cookies done; XSS sinks; unguarded planner; UI≠auth |
| PERFORMANCE | 4 | Budgets likely missed on god views; unverified runtime |
| TESTING | 5 | CAD/router strong; role portals and a11y empty |
| MAINTAINABILITY | 3 | 7k-line files; four token systems; any-heavy maps |
| SCALABILITY | 4 | GeoJSON dumps and unvirtualized registers will fail at district scale |
| OBSERVABILITY | 2 | No CI; consoles stripped in prod; no frontend error reporting |
| PRODUCTION READINESS | 4 | Islands could pilot; authority-wide go-live is not responsible |

**Weighted overall: 5 / 10.**

---

## Priority matrix

| Priority | Issue | Location | Impact | Recommendation | Complexity |
|---|---|---|---|---|---|
| P0 | `/planner` has no `meta.roles` | `src/router/index.ts:292–306` | Any authed user opens planner | Add roles; guard-behaviour test | S |
| P0 | GIS officer cannot open symbology | `router/index.ts:674–677` vs `:247–258` | Registry unusable by author | Fix guard or move route | S |
| P0 | Permit issue not server-enforced | `usePermitIssuance.ts:5–22` | Unlawful permits | Backend readiness checks | M |
| P0 | Unescaped map HTML | `SurveyPlanMapView.vue`, `GISMapView.vue`, `useControlPointMap.ts` | Stored XSS | `escapeHtml` / `textContent` | S |
| P0 | Clerk registers local-only | `usePlanningClerkCase.ts` | Statutory clock/fees not real | dmApi PATCH | M |
| P1 | `respondConsultation` unused | `developmentManagementService.ts:708` | Circulation never closes | Role UIs | M |
| P1 | Status model split | pipeline vs `PermitStatus` vs citizen vs `planningWorkflow` | Wrong queues | One normalizer | M |
| P1 | Notices after permit in stepper | `StatutoryShell.vue:37–43` | Process inversion | Reorder + gates | M |
| P1 | Double pay/submit | `NewApplicationSection.vue:93–127` | Duplicate applications | Busy flag | S |
| P1 | No CI / lint config missing | `package.json`, repo root | Regressions merge freely | Add both | S |
| P1 | 25 MapLibre inits | grep `new maplibregl.Map` | Memory, style drift | `createPortalMap` | L |
| P1 | `spatial-simple` dead store | `src/stores/spatial-simple.ts` | Pinia id collision | Delete | S |
| P2 | `ApplicationPipeline` not on staff headers | used only in `ApplicationsSection.vue` | Drift | Embed | S |
| P2 | Fake statutory map | `StatutoryShell.vue:230–246` | Officers decide without geography | Use MapHost | M |
| P2 | Env submit stub | `EnvironmentalOfficerView.vue:70–72` | False CTA | Hide or wire | S |
| P2 | UiDataTable not virtualized | `UiDataTable.vue` | Register freeze | Virtualize or force server page | M |
| P2 | Four token systems | `enterprise.css` vs DESIGN.md vs login vs `--cp-*` | Inconsistent UI | `--ent-*` only | L |
| P2 | Home eager InteractiveMap | `HomeView.vue` | Slow first load | Dynamic import | S |
| P2 | Skip links unused | `responsive.css` vs templates | Keyboard UX | Add to shells | S |
| P2 | Dialogs without focus trap | Vungu/EO/Studio/CaseFileDrawer | WCAG 2.4.3 | UiSheet | M |
| P3 | Login missing `hideForAuth` | `router/index.ts:154–159` | Minor UX | Add | S |
| P3 | `matter-js` unused | `package.json` | Weight | Remove | S |
| P3 | Heroicons unused | `package.json` | Weight | Remove | S |
| P3 | PWA Google Fonts cache | `vite.config.ts:74–82` | Confusion | Remove rule | S |
| P3 | Playground MapLibre views | surveyor lite | Noise | Delete if unlinked | S |

---

## Final deliverable checklist

### 1. Overall frontend score

**5 / 10**

### 2. Top 10 risks

1. Server-unenforced permit issue  
2. Map popup XSS  
3. Unguarded `/planner`  
4. GIS officer blocked from symbology  
5. Clerk state not on server  
6. Dual determination paths  
7. Uncloseable consultations  
8. Surveyor 7k-line WebGL  
9. PII localStorage  
10. No CI  

### 3. Top 10 improvements

1. Route guards + symbology access  
2. Escape HTML in maps  
3. Clerk → dmApi  
4. Consultation response UIs  
5. Unify status + pipeline on all roles  
6. Fix stepper order + backend gates  
7. Shared map factory  
8. Finish style registry; demote `masterplanSymbology.ts`  
9. `--ent-*` adoption + Ui primitives  
10. CI + ESLint + authed Playwright  

### 4. Architecture changes required

Single map factory; dmApi as only case SOR; registry-only cartography; surveyor as bounded context sharing auth/basemap; no second statutory mock API in production.

### 5. Recommended implementation order

Phase 0 (guards, XSS, pay lock, CI) → Phase 1 (statutory spine) → Phase 2 (GIS consolidation) → Phase 3 (design/mobile) → Phase 4 (surveyor split).

### 6. What should NOT be changed

- Cookie session model (`session.ts` / `auth.ts` / `api.ts` `withCredentials`)  
- `addVunguBasemap` / registry-first `vunguBasemapStyle.ts` contract  
- Citizen intake unification into `dmApi.createPermit`  
- `RoleWorkspaceShell` map+console pattern  
- Honesty in `usePermitIssuance` comments (fix the server, don’t paper over)  
- `escapeHtml` helper — extend usage, don’t replace with a new util  
- Planner CAD engine tests and `src/planning/cad/*` as the studio core  
- `clickPriority` tests  

### 7. What is already well designed

Enterprise `--ent-*` token file; vector tile + registry architecture; F17 workspace reconnection; typed router roles; DM service types; reduced-motion camera helper; session PII purge prefixes; `UiSheet`/`useBreakpoint`/`responsive.css` foundation; permit issuance readiness UI (advisory, correctly labelled).

### 8. What is production-ready

**Pilot-ready islands:** login/register, cookie auth, public home/council pages, citizen lodge+pay **if** double-submit is fixed, vector basemap **if** registry is populated (runtime unverified), GIS officer mapping sections **as internal tools**.

**Not production-ready as a council-wide planning authority system.**

### 9. What prevents production readiness

Unguarded planner; broken symbology access; UI-only statutory gates; localStorage clerk; open referral loop; XSS; missing department/governance roles; unmaintainable surveyor; no CI; incomplete a11y; unvirtualized registers; four visual systems.

### 10. Estimated phases for remediation

| Phase | Duration | Outcome |
|---|---|---|
| 0 Stop-bleed | 1–2 weeks | Safe enough for a closed staff pilot of planner+citizen |
| 1 Statutory spine | 2–4 weeks | One case record; referrals close; notices ordered |
| 2 GIS consolidation | 3–5 weeks | One renderer contract; fewer map instances |
| 3 Design + a11y + mobile | 4–6 weeks | `--ent-*` on staff chrome; WCAG gaps closed on primary paths |
| 4 Surveyor bounded context | 6–10 weeks | Maintainable CAD; shared auth/basemap |

**Closed staff pilot** is plausible after Phase 0–1. **Public + all-role go-live** needs Phase 1–3 and matching backend authorization. Treating the current frontend as finished enterprise software would be a process and security failure.

---

*End of review. No application source was modified.*
