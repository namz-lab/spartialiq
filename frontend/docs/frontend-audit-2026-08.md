# Vungu RDC — Frontend Audit & Enterprise Improvement Roadmap

**Date:** 2026-08-09
**Scope:** frontend only (`app-frontend`). No backend or schema changes proposed.
**Baseline:** `npm run type-check` (vue-tsc) passes clean, exit 0. 56 spec files.

## Progress

| Module | Status | Notes |
|---|---|---|
| **M0.1 · Auth hardening** | ✅ done (2026-08-10) | See §7. Closes F1 and F16. |
| **M0.2 · Unified authorisation** | ✅ done (2026-08-10) | See §8. Closes F2 and F3. |
| **M0.3 · Dead code removal** | ✅ done (2026-08-10) | See §9. Closes F8. **Uncovered F17 — see §9.1.** |
| **M1.1 · Shell consolidation** | ✅ done (2026-08-10) | See §10. Closes F17. 3 workspaces reconnected. |
| M1.2 · Sections become routes | ☐ next | |
| M1.1–M1.4 · Design system | ☐ | |
| M2.1–M2.4 · Enterprise UX | ☐ | |
| M3.1–M3.5 · Coverage | ☐ | |

---

## 1. Inventory

| Metric | Value |
|---|---|
| Vue SFCs | 299 |
| TypeScript modules | 266 |
| Total LOC (`.vue`) | ~113,900 |
| Routes declared | 72 (in a single 641-line `src/router/index.ts`) |
| Role workspaces | 9 |
| Pinia stores | 7 |
| Domain composables | 18 (~4,200 LOC) |
| Service clients | 23 |
| Design tokens (`--ent-*`) | 76, in a 142-line SSOT |
| Reusable UI primitives | 6 |

**Distribution is heavily skewed.** The surveyor module alone is **77,135 LOC — 68% of the frontend**. The nine role workspaces that carry the actual development-control process total ~19,500 LOC of section code combined. The five largest files are all ≥ 3,900 lines:

| File | LOC |
|---|---|
| [SurveyPlanMapView.vue](src/views/surveyor/views/modules/cadastral-standard/SurveyPlanMapView.vue) | 7,222 |
| [MapLibreAreaView.vue](src/views/surveyor/views/modules/cadastral-standard/MapLibreAreaView.vue) | 6,711 |
| [CadastralStandardView.vue](src/views/surveyor/views/modules/cadastral-standard/CadastralStandardView.vue) | 4,061 |
| [VunguPlannerView.vue](src/views/planner/VunguPlannerView.vue) | 3,985 |
| [HomeView.vue](src/views/HomeView.vue) | 3,052 |

---

## 2. What is genuinely strong

Stated up front so the roadmap is read as *consolidation*, not demolition.

1. **The design system itself is excellent.** [enterprise.css](src/styles/enterprise.css) is a properly reasoned enterprise token set — four surface elevations, three text ranks, a single controlled accent explicitly capped at ≤10% of any surface, a five-tone workflow status taxonomy, 8pt spacing with 4px half-steps, restrained radii, ink-tinted (not coloured) elevation, and explicit control/row heights for data density. It correctly rejects consumer-SaaS aesthetics. **The system is not the problem; adoption is.**
2. **Workflow decomposition is real and domain-correct.** The section breakdowns per role read like they were written by someone who knows the RTCP Act — `AbuttingOwnersSection` cites s.26(3), `EnforcementMappingSection` cites ss.32/34, the planner has a genuine five-step statutory workflow (`Step1Intake` → `Step5Notices`).
3. **Technical circulation is real, not a mock.** [TechnicalCirculationSection.vue](src/views/eo-planner/sections/TechnicalCirculationSection.vue) is backed by `application_consultation` (migrations 085/090) with priority, due date, blocking flags, escalation and stance capture.
4. **The map module has a single source of truth.** `styleLayerFor()` / `chipColorFor()` in `vunguBasemapStyle.ts` guarantees UI swatches and map paint agree. Reduced motion is honoured in `fitBounds`.
5. **Intake was already unified.** The router comments document a completed consolidation of five competing application flows into one canonical citizen path. That discipline should be the template for the rest of this roadmap.

---

## 3. Findings

Ranked by severity. Each carries the evidence that produced it.

### P0 — Security / correctness

**F1. Auth transport has drifted from the backend contract.**
[auth.ts](src/stores/auth.ts) persists the access token, the refresh token *and* the full `AuthUser` object to `localStorage` (`TOKEN_KEY`/`REFRESH_TOKEN_KEY`/`USER_KEY`, lines 10–12, 77–89). [api.ts](src/services/api.ts) reads it back into an `Authorization: Bearer` header on every request and never sets `withCredentials`.

The backend has already moved on: `../app-backend/src/routes/auth.js:311` issues `vungu_at` as `httpOnly, sameSite:'lax'`. The frontend's own [AdminView.vue:720](src/views/AdminView.vue#L720) *advertises* "Auth Mode: httpOnly cookies · vungu_at / vungu_rt" — a label describing a mechanism the client does not use.

Consequence: any XSS anywhere in 299 components exfiltrates a live 12-hour access token, a refresh token, and a serialised user record containing name, email, phone, national ID and address. This is the single highest-severity item in the audit.

**F2. Two disjoint, non-overlapping role systems.**
`Role` in [types.ts](src/services/types.ts) declares 12 identifiers (`admin`, `planner`, `eo`, `env_officer`, `building_inspector`, `planning_clerk`, `surveyor`, `gis_officer`, `viewer`, `user`, `registered`, `public`). `RoleId` in [statutory/roles.ts](src/statutory/roles.ts) declares six (`planner`, `lpa_staff`, `lpa_committee`, `director`, `minister`, `admin`). Only `planner` and `admin` appear in both.

Consequence: `can()` returns `false` for every real non-planner user, so the entire statutory permission matrix — plan determination, order creation, evidence generation — is unreachable in production. The committee and director powers modelled in that matrix have no user who can exercise them.

**F3. Route authorisation is 10 hand-written `if` blocks.**
[router/index.ts:568–631](src/router/index.ts#L568-L631) encodes role access as a sequence of path-string comparisons, each listing its allowed roles inline. `ADMIN_BLOCKED` is a separate prefix array. Adding a role means editing ten places; adding a route means remembering to add an eleventh block. Three routes (`/gis-map`, `/qgis-map`, `/statutory/planner`) have no role guard at all.

### P1 — Design system and consistency

**F4. The design system is written but not adopted.**

| Signal | Count |
|---|---|
| Files consuming `--ent-*` | **20 / 299** |
| Files importing a `components/ui/Ui*` primitive | **6 / 299** (all in `views/planner/sections/`) |
| Hardcoded hex colours | **6,082 occurrences across 169 files** |
| Files still on the deprecated `--login-*` set | 2 |

[GISOfficerPortalView.vue:132–176](src/views/GISOfficerPortalView.vue#L132-L176) is representative: `#f1f5f9`, `#0e7490`, `#e2e8f0`, `#475569`, `0.75rem`, `0.375rem` — an entire parallel design system inlined into one component's scoped block, with a teal accent that exists nowhere in the token file.

**F5. Every role portal re-implements the same shell with a different CSS prefix.**
`gis-` (GIS Officer), `clk-` (Planning Clerk), `cp-` (Citizen), `ps-` (Planner). Each independently declares: a topbar with brand block, a collapse toggle, a `sidebarCollapsed` ref, an `<aside>` nav rendering `v-for` over a `sections` array, an active-section `ref`, a `handleLogout`, and a `<main>` containing a 10-deep `v-if`/`v-else-if` chain. Six copies. Only `PlannerShell` has been migrated to tokens; the others have not.

The section-switch chain is also a missed capability: because active section is component-local state and not a route, **no section in any staff workspace is linkable, bookmarkable, or restorable on refresh** — for users who live in this app 8 hours a day.

**F6. 62 files hand-roll `<table>`; one of them is the primitive.**
[UiDataTable.vue](src/components/ui/UiDataTable.vue) exists and is sound (sticky header, client sort, mono columns, loading/empty rows, per-column slots). It is used by 6 files. The other 61 tables — the Development Register, Fees, Permit Dispatch, Public Notices, Refusals, Appeals, Certificates, Surveillance, Spatial Database — are bespoke markup.

Against the enterprise table requirement, even the primitive is missing: column selection, filtering, saved filters, bulk actions, export, pagination, resizable columns, keyboard navigation, context menus, and row selection.

**F7. 237 native `alert()` / `confirm()` calls across 25+ files.**
Including [StandsEditorSection.vue](src/views/gis-officer/sections/StandsEditorSection.vue), [PaymentGatewayView.vue](src/views/PaymentGatewayView.vue) and [VunguPlannerView.vue](src/views/planner/VunguPlannerView.vue). Browser-modal dialogs block the event loop, cannot be styled, cannot be tested, are unusable on a second monitor, and read as a prototype. Meanwhile [useUiFeedback.ts](src/composables/useUiFeedback.ts) — the correct mechanism — already has 43 consumers.

**F8. Dead code with live-looking names.**
- [stores/notification.ts](src/stores/notification.ts) has **zero consumers** outside itself. `useUiFeedback` won; the store was never removed.
- Three modern shells are orphaned: [EOPlannerPortalView.vue](src/views/EOPlannerPortalView.vue), [EnvironmentOfficerWorkspaceView.vue](src/views/EnvironmentOfficerWorkspaceView.vue), [InspectorWorkspaceView.vue](src/views/InspectorWorkspaceView.vue). The router deliberately re-points those *const names* at the legacy map-bearing views ([router/index.ts:31–39](src/router/index.ts#L31-L39)) because the modern shells dropped the per-role map. So the codebase carries two generations of three workspaces, and the const names actively lie about which one renders.

### P2 — Enterprise UX gaps

**F9. No keyboard layer.** Two files in the entire codebase handle `ctrlKey`/`metaKey` ([PlanningStudio.vue](src/views/planner/PlanningStudio.vue), [useUndoRedo.ts](src/views/surveyor/composables/useUndoRedo.ts)). There is no command palette, no global search, no quick-switch, no shortcut registry, no shortcuts help. For a stated 8–10 h/day tool this is the largest single productivity gap in the audit.

**F10. Accessibility is partial.** 100 `aria-label`s and 51 `role=` attributes across 299 components. `:focus-visible` appears in 7 files. `prefers-reduced-motion` in 6. No `prefers-color-scheme` support anywhere — a problem for planners on backlit workstations and for field inspectors on tablets outdoors. WCAG 2.2 AA is not currently demonstrable.

**F11. The GIS workspace is a map with five tools, not a GIS workspace.**
[MapToolbar.vue](src/components/map/MapToolbar.vue) declares `type Tool = 'none' | 'search' | 'measure' | 'radius' | 'imagery'` plus a print button.

| Capability | State |
|---|---|
| Large map, search, measure, coordinate readout, basemap selector, print/PDF export | ✅ present |
| Buffer | ⚠️ partial — `radius` is notification-radius only |
| Layer tree, legend, attribute table, feature inspector | ⚠️ components exist (`MapLayerFilters` is a flat chip list, not a tree; `MapLegend`, `AttributeTable`) but are not composed into one workspace |
| Resizable panels, scale selector, bookmarks, drawing tools, selection tools, spatial queries, overlay analysis, nearby applications, planning history, linked documents, timeline, comments, version history, workflow panel, task panel | ❌ absent |

**F12. Forms lack enterprise behaviour.** 23 components contain a `<form>`; 11 mention autosave. There is no shared form primitive, no validation contract, no draft/resume model, no conditional-field engine, no progress tracking. Each form re-invents its own state.

**F13. Statutory module is a stub presented as a feature.**
[statutory/](src/statutory/) is 706 LOC. [statutoryApi.ts](src/statutory/services/statutoryApi.ts) is explicitly "TODO STUBS ONLY" — every call `console.warn`s and discards the payload. Plans, development applications, orders, registrar/deeds endorsement and material-particulars certificates all persist nowhere. Yet `/statutory/planner` is a live, linked route reachable from the planner topbar ([PlannerShell.vue:124](src/views/planner/PlannerShell.vue#L124)). A planner can complete a statutory determination and lose it. 43 TODO markers cluster here.

### P3 — Role and workflow coverage

**F14. Nine of the twenty-two named roles have a workspace.**

| Role | Workspace | Notes |
|---|---|---|
| Planning Clerk | ✅ `/planning-clerk-portal` | 12 sections |
| Town Planner | ✅ `/planner` | map + console panes, 7 sections |
| EO Planner | ✅ `/eo-planner-portal` | 11 sections |
| GIS Officer | ✅ `/gis-officer-portal` | 11 sections |
| Surveyor | ✅ `/surveyor` + `/surveyor-workspace` | largest module |
| Building Inspector | ✅ `/inspector-workspace` | 7 sections |
| Environmental Officer | ✅ `/env-officer-workspace` | 8 sections |
| System Administrator | ✅ `/admin/*` | 7 views |
| Applicants / Public | ✅ `/citizen` | 12 sections |
| **Chief Planner** | ❌ | no role, no route |
| **Director of Planning** | ❌ | modelled in `statutory/roles.ts`, no auth role, no route |
| **Committee Members** | ❌ | modelled as `lpa_committee`, no auth role, no route |
| **Health Inspector** | ❌ | receives circulation, cannot log in to respond |
| **Roads / Water / Sewer Engineers** | ❌ | as above |
| **Fire Department** | ❌ | as above |
| **Housing Officer** | ❌ | as above |
| **Finance Officer** | ❌ | fees exist under the clerk, no finance surface |
| **Records Officer** | ❌ | no records/archive surface |
| **Consultants / Architects / Developers** | ❌ | collapse into the generic citizen portal |

The consultee gap is structural, not cosmetic: circulation is **one-sided**. The EO dispatches referrals to Health, Survey, Engineering, Fire, Traffic, Housing, Electricity, Water/Sewer and Environment — then must key in their responses on their behalf, because none of those officers has a login. That is the paper process with an extra transcription step.

**F15. Workflow coverage by term frequency** (files mentioning each concept):

| Well covered | Thin | Absent |
|---|---|---|
| conditions (91), subdivision (54), inspections (52), objections (47), enforcement (47), committee (33), appeals (31) | public notices (18), consolidation (14), rezoning (13), special consent (10), occupation certificates (10), change of use (9) | stop orders (0), audit trail (2 files) |

**Stop orders returning zero hits is a genuine functional gap** — the RTCP Act enforcement chain is incomplete without them. **Audit trail at two files** is the compliance gap: statutory decisions affecting property rights need a defensible, queryable record of who changed what and when, and there is exactly one `CaseAuditTrail.vue`.

**F16. localStorage carries PII with inconsistent lifecycle.** 26 distinct keys. `purgePlannerCaseCaches()` in [auth.ts:24](src/stores/auth.ts#L24) clears `planner_case_*` on logout — and its own docstring concedes that the clerk, citizen, GIS officer, inspection, health and surveyor caches store the same class of data under their own keys and are **not** purged. On a shared council workstation, the next user inherits them.

---

## 4. Roadmap

Nine modules. Each is independently shippable, ends with a green type-check and passing specs, and is ordered so later modules build on earlier ones rather than colliding.

### Phase 0 — Foundation (highest leverage, lowest risk)

**M0.1 · Auth hardening** — F1, F16
Move to the cookie session the backend already issues: `withCredentials: true` on the axios instance, drop `Authorization` header injection, replace the localStorage token/user with the `auth_present` hint plus a `/auth/me` hydrate on boot. Generalise `purgePlannerCaseCaches` into one keyed registry of role caches so logout clears all of them. No backend change required — the endpoint already sets the cookie.

**M0.2 · Unified authorisation** — F2, F3
One `Role` union. Reconcile `RoleId` into it (`lpa_committee` → `committee`, `director`, and drop or map `minister`/`lpa_staff`). Replace the ten guard blocks with `meta: { roles: [...] }` on each route and a single generic guard. Add the missing guards on `/gis-map`, `/qgis-map`, `/statutory/planner`. Frontend gating stays advisory — the backend remains the enforcement point.

**M0.3 · Dead code removal** — F8
Delete `stores/notification.ts` (verified zero consumers). Resolve the two-generation workspace duplication: keep the legacy map-bearing views the router actually renders, delete the three orphaned shells, and rename the consts to match what they import so the file stops lying.

### Phase 1 — Design system enforcement

**M1.1 · Shell consolidation** — F5
One `WorkspaceShell.vue` taking `{ title, subtitle, icon, accent, sections[], roleLabel, avatarKey }`. Migrate all six portals onto it. Estimated net deletion: ~700 LOC of duplicated markup and CSS.

**M1.2 · Sections become routes** — F5
Child routes per workspace section, replacing the local `activeSection` ref and the `v-if` chains. Delivers linkable, bookmarkable, refresh-surviving, back-button-correct sections — and makes multi-monitor use possible, since a planner can finally open the register in one window and the map in another.

**M1.3 · Token migration** — F4
Systematic replacement of the 6,082 hardcoded hex values with `--ent-*`. Per-portal, verified visually as each lands. Add a lint rule rejecting raw hex in `<style scoped>` so it cannot regress.

**M1.4 · Primitive expansion** — F6, F7
Extend `UiDataTable` to the enterprise contract: column selection, filter row, saved views, row selection with bulk actions, CSV export, pagination, resizable columns, keyboard navigation, context menu. Add `UiModal`, `UiConfirm`, `UiField`, `UiToolbar`, `UiDrawer`, `UiTabs`. Replace all 237 `alert()`/`confirm()` calls with `UiConfirm` and `useUiFeedback`.

### Phase 2 — Enterprise UX

**M2.1 · Keyboard and command layer** — F9
A shortcut registry, a `⌘K`/`Ctrl+K` command palette (jump to any application by reference, any stand by number, any section, any role workspace), a global search, and a `?` shortcuts sheet. Highest measured productivity return of anything in this roadmap.

**M2.2 · GIS workspace** — F11
Compose the existing pieces — `MapLayerFilters`, `MapLegend`, `AttributeTable`, `MapToolbar`, `MapContextMenu` — into one resizable-panel workspace. Add the missing tools: layer *tree* (grouped, with opacity and ordering), scale selector, bookmarks, draw, select-by-rectangle/polygon, buffer, spatial query, and a feature inspector that drives the context panels. Bind map selection to the workflow panel so selecting an application highlights it on the map and selecting a parcel updates every panel.

**M2.3 · Accessibility to WCAG 2.2 AA** — F10
Global `:focus-visible`, landmark and heading audit, keyboard traps, contrast verification against the token palette, `prefers-reduced-motion` completion, and a dark theme derived from the existing tokens (the token file is already structured for it — surfaces and text ranks are named, not hardcoded).

**M2.4 · Form system** — F12
`UiForm` with a validation contract, autosave with a visible sync state (the `PlannerShell` sync chip is the right pattern — generalise it), draft/resume, attachments, conditional fields, progress, and map-picker integration.

### Phase 3 — Coverage

**M3.1 · Consultee workspace** — F14
One parameterised workspace serving Health, Roads, Water, Sewer, Fire and Housing officers. My-referrals queue, application context, stance capture (no objection / objection / conditional), attachment, due-date tracking. Backend support already exists (`application_consultation`) — this is a frontend surface over an API that is already there. Turns circulation from one-sided into a real workflow.

**M3.2 · Governance workspaces** — F14
Committee member (agenda, papers, per-item voting, minutes), Chief Planner / Director (oversight, workload, delegated-decision review, statutory deadline exposure). These are the roles the statutory matrix already models with nobody able to occupy them.

**M3.3 · Records, Finance, and the audit trail** — F15, F16
Records Officer surface (document register, retention, archive search). Finance Officer surface (fees, receipts, reconciliation) lifted out of the clerk portal. A queryable audit trail across every statutory decision — currently one component.

**M3.4 · Workflow completion** — F15
Stop orders (zero coverage today). Deepen the thin paths: consolidation, rezoning, change of use, special consent, occupation certificates, public notices.

**M3.5 · Statutory module** — F13
Either wire `statutoryApi` to real endpoints, or gate `/statutory/planner` behind a feature flag until it persists. Shipping a determination workflow that silently discards its output is worse than not shipping it. **Requires a backend decision** — flagged, not assumed.

---

## 5. Sequencing rationale

Phase 0 first because M0.2 (one role model) is a prerequisite for every new role workspace in Phase 3, and M0.1 is the only P0 security item.

Phase 1 before Phase 2 because building a command palette or a GIS workspace on six divergent shells means building it six times.

M1.2 (sections as routes) is deliberately placed before M2.1 (command palette) — a palette that jumps to a section requires sections to be addressable.

Phase 3 last because each new role workspace is cheap once `WorkspaceShell` exists and expensive before it.

---

## 6. Out of scope / needs a decision

- **Surveyor module (77k LOC, 68% of the frontend).** Not touched by this roadmap. Its four largest files are 4,000–7,200 lines each and it maintains its own store, types, utils and routing. It warrants its own audit; folding it into this one would swamp everything else.
- **M3.5** needs a backend answer on statutory persistence before frontend work is worth doing.
- **F14 role list** assumes all 22 named roles are actually wanted as logins. Some (Consultants, Architects, Developers) may be better served as *applicant types* on the existing citizen portal than as separate workspaces — that is a product call, not an engineering one.

---

## 7. M0.1 — Auth hardening (done 2026-08-10)

Closes **F1** (session + PII in localStorage) and **F16** (inconsistent cache lifecycle).

### What changed

The frontend now uses the httpOnly cookie session the backend was already
issuing. Verified before touching anything: `authenticate()` in
`backend/src/middleware/jwtAuth.js:153` reads `request.cookies.vungu_at`
first and only falls back to `Authorization: Bearer` for non-browser clients
(the QGIS plugin's long-lived API token); `@fastify/cors` is registered with
`credentials: true`; `@fastify/cookie` is registered. **No backend change was
required.**

| File | Change |
|---|---|
| `src/services/session.ts` | **New.** Owns the `auth_present` hint and the case-cache purge. Imports nothing, so `api.ts` can use it without a cycle. |
| `src/services/api.ts` | `withCredentials: true`; request interceptor deleted; 401 → `clearSession()` + redirect, exempting the `/auth/me` boot probe. |
| `src/stores/auth.ts` | `token` state removed. User held in memory only. `login`/`register` adopt the user; `refreshToken()` posts with no body (the backend reads `vungu_rt` and returns a user, not a token); `initializeAuth()` gated on the hint. |
| `src/router/index.ts` | Guard reads `authStore.isAuthenticated` after an awaited hydrate, instead of parsing `auth_token`/`auth_user` out of localStorage. |
| `src/views/LoginView.vue` | Was re-implementing the login POST and writing localStorage itself. Now delegates to `authStore.login()`. |
| `src/components/shared/ProfileDropdown.vue` | Optimistic profile edit is in-memory; no longer round-trips through `auth_user`. |
| `src/views/surveyor/services/api.ts` | `withCredentials: true`; request interceptor deleted. |
| `src/views/surveyor/stores/auth.ts` | `token` state → `authed` boolean from the hint. |
| `src/views/surveyor/views/DashboardView.vue` | Readiness signal `auth.token` → `auth.isSurveyor` (the profile is now what arrives async). |
| `ProjectSetupView.vue`, `QGISExportView.vue` | 4 raw `fetch()` Bearer headers → `credentials: 'include'`. |

### Why the surveyor module was touched despite being out of scope

It maintains a **second axios client and a second auth store**, both reading
the same `auth_token` key. Removing the key without migrating them would have
broken every survey API call. The fix was applied at the two clients rather
than at each of their 28 call sites.

### Verification

Measured against a real backend (`demo.planner@vungu.test`), through the Vite
`/api` proxy — i.e. the same path the SPA takes.

| Check | Result |
|---|---|
| `vue-tsc --noEmit` | 52 errors, **all pre-existing, all inside `src/views/surveyor`**. Zero errors in any file outside that module, including every auth file rewritten here. The 3 errors in the two surveyor files touched are byte-identical to baseline (line numbers shifted by 2 where an edit removed two lines). |
| `vitest run --no-file-parallelism` | **57 files / 320 tests passed**, 1 skipped. One unhandled rejection in `NewApplicationSection.standpicker.spec.ts` — pre-existing cross-file ordering flake (the spec never mocks `vue-router`, so `useRoute()` is undefined unless another file installed one). Passes exit 0 in isolation. |
| `session.spec.ts` (new) | 4 passing: hint stores no credential; every role prefix purged; UI preferences survive; unrelated keys untouched. |
| POST `/api/auth/login` via proxy | 200. `Set-Cookie` survives the proxy: `vungu_at` (`Path=/`) and `vungu_rt` (`Path=/api/auth`), both `HttpOnly; SameSite=Lax`. |
| GET `/api/auth/me` with cookie only, **no** `Authorization` header | 200 + user. This is the change working end to end. |
| POST `/api/auth/logout` | 200, then `/auth/me` → 401. Session genuinely revoked server-side. |

> **Correction to an earlier claim in this document.** The original baseline line
> said type-check "passes clean, exit 0". That was wrong: the exit code came from
> `tail` at the end of a pipe, not from `vue-tsc`. The true baseline was **22+
> pre-existing errors**, all in the surveyor module. The conclusion that M0.1
> introduced none still holds, and is now verified per-file rather than by exit code.

### Backend bug found during verification (not fixed — frontend-only scope)

**`POST /api/auth/refresh` can never succeed, for any user.**

`src/routes/auth.js:78` defines `const isString = (v, max = 255) => …` and line 277
validates the refresh token with the default cap:

```js
const refreshToken = request.cookies?.vungu_rt || request.body?.refreshToken
if (!isString(refreshToken)) return reply.code(400).send({ message: 'No refresh token' })
```

The refresh JWT measures **299 characters** (the access token, 365). Both exceed
255, so the guard rejects a perfectly valid token and returns
`400 {"message":"No refresh token"}`. Confirmed by request: the `Cookie:
vungu_rt=…` header *is* received; the handler discards it.

Effect: sessions hard-expire at the 12-hour access-token TTL with no renewal.
This is **pre-existing, not a regression** — the previous frontend sent the token
in the request body, which hit the same 255-char cap on the `request.body`
branch. The frontend degrades gracefully either way (`refreshToken()` falls
through to a `/auth/me` probe), so nothing is broken by M0.1.

One-line backend fix, for whoever owns that repo: `isString(refreshToken, 1024)`.

---

## 8. M0.2 — Unified authorisation (done 2026-08-10)

Closes **F2** (two disjoint role systems) and **F3** (ten hand-written guard blocks).

### The finding that shaped this module

F3's original write-up repeated a claim from the code: *"The backend enforces
the same boundary on every API call."* **That is not true.** The backend's
`requireRole()` allow-lists include `'admin'` on essentially every planning
route:

```
10 ×  requireRole(fastify, ['building_inspector', 'admin'])
 7 ×  requireRole(fastify, ['eo', 'planner', 'planning_clerk', 'admin'])
 6 ×  requireRole(fastify, ['planner', 'gis_officer', 'admin'])
 …
```

So blocking the IT admin in the router buys **no** security — an admin calling
the API directly is not stopped — and would only break the UI. M0.2 was
therefore scoped as a **behaviour-preserving refactor**: identical effective
authorisation, expressed once. `ADMIN_BLOCKED` is unchanged, and its comment
now states the caveat honestly instead of overclaiming.

Real separation of duties needs the *backend* allow-lists narrowed first. Until
then the front-end boundary only keeps the screens out of the IT desk's browser.

### What changed

| File | Change |
|---|---|
| `src/services/types.ts` | `Role` reduced to the 11 values the DB `users_role_check` constraint permits. Removed `'user'` — a phantom no row could hold, so every check against it was dead. |
| `src/router/index.ts` | Typed `RouteMeta` (a bad role string is now a compile error). Ten `if (to.path === … && !['a','b'].includes(role))` blocks replaced by one generic `meta.roles` check. `roleHome` exported. |
| `src/statutory/roles.ts` | Matrix re-keyed from the invented vocabulary onto real roles. `lpa_staff` → `eo` + `planning_clerk`. |
| `src/views/LoginView.vue` | Deleted its private `ROLE_HOMES` copy — which had drifted onto legacy paths (`/eo-planner`, `/portal`) that only redirect — in favour of the router's map. Demo `viewer` account's role corrected from `'user'` to `'viewer'` (matches `seed-demo-users.js:27`). |
| `src/views/AdminView.vue` | Removed the phantom `'user'` role from the reference catalogue; `registered` now carries the citizen description, since `auth.js:117` assigns `registered`/`public` at signup. |

### Routes that had no role guard at all

| Route | Before | Now |
|---|---|---|
| `/statutory/planner` | any authenticated user, incl. a citizen — relied on the in-view `can()` alone | `['planner','admin']` |
| `/gis-map` | any authenticated user | `COUNCIL_STAFF` |
| `/qgis-map` | unauthenticated | **left public — deliberate.** It renders only published WMS/WFS basemap layers; no permits, no PII. Publishing spatial data to citizens is a stated product goal, and it sits alongside `/explorer` and `/layers`. My original F3 write-up wrongly listed it as a gap. |

### Verification

- `vue-tsc --noEmit` — 52 errors, byte-identical to the M0.1 baseline, **all pre-existing and all inside `src/views/surveyor`**. Zero outside it.
- `vitest run --no-file-parallelism` — **59 files / 335 tests passed**, 1 skipped. The single unhandled rejection is the same pre-existing `NewApplicationSection.standpicker` ordering flake (same file, line and cause as before M0.2).
- `route-roles.spec.ts` (new, 16 assertions) — encodes the **pre-refactor** allow-lists as expected values, so any future drift in who-can-reach-what fails the build. Also asserts no route lists a role the backend cannot issue.
- `guard-behaviour.spec.ts` (new) — proves the guard *consumes* the metadata: the owning role is admitted, a citizen is redirected to their own home.

Two things the tests caught that assumption would have missed:

1. **`getRoutes()` records carry unmerged `meta`.** A record's own `.meta` does
   not include its parent's, so the first version of the spec read `undefined`
   for `/surveyor-workspace`. `router.resolve(path).meta` *is* merged — and is
   what the guard reads as `to.meta`. That merge is exactly what lets one
   `roles` on the parent cover every `/surveyor-workspace/*` child.
2. **Duplicate navigations skip guards.** Pushing the path the router is already
   on resolves without running `beforeEach`, so a deny-case test can silently
   "pass" the navigation it exists to block. The spec now parks on a public
   route first.

---

## 9. M0.3 — Dead code removal (done 2026-08-10)

Closes **F8**. Every candidate was traced to its consumers before deletion, per
the standing instruction to remove dead code *only* after confirming it is
unused. Two of the four candidates turned out **not** to be dead — see §9.1
and §9.2. That is the main result of this module.

### Deleted — 1,221 LOC, verified unreachable

A single closed chain, plus one orphan store:

```
/admin/login route → views/admin/LoginView.vue → stores/admin.ts
                   → services/adminService.ts  → types/admin.ts
```

- `POST /api/admin/auth/login` **does not exist** in the backend. Only
  `/api/auth/login` does. The screen could never succeed; its refresh
  interceptor targeted an equally absent `/api/admin/auth/refresh`.
- Every one of `adminService`'s eight exports (`authService`, `ingestionService`,
  `styleService`, `validationService`, `auditService`, `monitoringService`,
  `portalAdminService`) had **zero** consumers; only `adminService` itself was
  referenced, and only by `stores/admin.ts`, which only `admin/LoginView.vue`
  used. `AdminView.vue` — despite a comment in `adminService.ts` claiming
  otherwise — imports `api` directly and never touched it.
- `/admin/login` was linked from no UI. It is now a **redirect to `/login`** so
  old bookmarks resolve rather than 404. Council IT signs in like every other
  role; `roleHome()` lands `admin` on `/admin/users`.
- `stores/notification.ts` (27 LOC): zero consumers. `useUiFeedback` (43
  consumers) had already won; the store was never removed.

### 9.1 F17 — NOT dead: three role workspaces are disconnected

The three "orphaned" shells flagged in F8 are the **only** components that
render their role's sections. The legacy views the router actually serves
render **none** of them:

| Shell (never imported) | Sections it alone renders | LOC | Legacy view the router serves instead |
|---|---|---|---|
| `EOPlannerPortalView.vue` | 11 × `eo-planner/sections/*` | 1,974 | `EOPlannerView.vue` — MapLibre command centre, 0 sections |
| `EnvironmentOfficerWorkspaceView.vue` | 8 × `environment-officer/sections/*` | 2,793 | `EnvironmentalOfficerView.vue` — 0 sections |
| `InspectorWorkspaceView.vue` | 7 × `inspector/sections/*` | 2,254 | `BuildingInspectorView.vue` — 0 sections |

**≈7,000 LOC across 26 section components is unreachable in the running app.**

This is not junk. The sections make real, distinct `dmApi` calls —
`considerObjection`, `getDecisionPackage`, `getPublicNotice`,
`createComplianceCheck`, `createStageInspection`, `createProhibitionOrder`,
`getCertificate`, `getInspectionChecklist`, `getStageScoring`. It includes
`TechnicalCirculationSection`, the genuinely API-backed circulation workflow
praised in §2.

**How it happened** is recorded in the router's own comment: the newer
workspace shells "dropped the per-role map", so the routes were repointed at
the older map-bearing views. That restored the map and silently stranded every
section built for those three roles.

**The fix already exists in this codebase.** `PlannerShell.vue` solves exactly
this problem for the planner: it hosts `VunguPlannerView` (the map) and
`PlannerWorkspaceView` (the 8 sections) as kept-alive panes behind a
Map/Console tab switch, sharing one case-file context. Applying that shape to
the other three roles restores all 26 sections **without** losing the map that
caused the revert. This is M1.1, and F17 makes it urgent rather than cosmetic.

Deleting these files — the original M0.3 plan — would have destroyed the
frontend half of three role workspaces.

### 9.2 NOT dead: Phase2View is an unmounted backend, not a prototype

`views/admin/Phase2View.vue` (1,346 LOC, linked from the AdminView sidebar as
"Phase 2 Tools") calls five `/api/admin/*` statistics endpoints. A first pass
over `src/routes/` found none of them and it looked like a prototype.

It is not. They are implemented in `src/admin/routes/*.ts`
(`batchProcessing.ts`, `dataCleaning.ts`, `qmlParser.ts`,
`approvalWorkflows.ts`) — but **that directory is never registered in
`server.js`**, so every call 404s. The frontend is the working half of a real
feature whose backend was written and never wired up. Kept, not deleted.

Three defects fixed in place:

1. **Five `Authorization: Bearer mock-jwt-token` headers** — literal fake
   credentials — replaced with `credentials: 'include'`, consistent with M0.1.
2. **A hardcoded banner reading "✅ 100% API Success Rate - All Systems
   Operational"**, rendered unconditionally while every endpoint 404s. Now
   derived from the actual refresh result ("2/4 services responding", or "No
   Phase 2 service is responding — the admin routes are not mounted on the
   API"), with the badge colour following the measured state. A status claim in
   a council system has to be measured, not asserted.
3. **Three of four loaders never checked `response.ok`**, so an error body
   parsed cleanly and `data.data` landed as `undefined` — wiping the stats
   instead of using the zero fallback beside it. All four now check.

Backend follow-up (not actioned, frontend-only scope): register
`src/admin/routes/*` in `server.js` to make the feature live.

---

## 10. M1.1 — Shell consolidation / F17 reconnection (done 2026-08-10)

Closes **F17**. Three role workspaces now serve both halves that were built for
them, instead of one at the expense of the other.

### Approach

`PlannerShell.vue` had already solved this for the planner: map view and
section console as kept-alive panes behind a tab switch. That shape was
generalised into `components/shared/RoleWorkspaceShell.vue` and applied to the
three affected roles — reusing the codebase's own answer rather than inventing
a new one.

| Route | Map pane | Console pane (was unreachable) |
|---|---|---|
| `/eo-planner-portal` | `EOPlannerView` — command centre | `EOPlannerPortalView` — 11 sections |
| `/env-officer-workspace` | `EnvironmentalOfficerView` — environmental map | `EnvironmentOfficerWorkspaceView` — 8 sections |
| `/inspector-workspace` | `BuildingInspectorView` — site map, search, tools | `InspectorWorkspaceView` — 7 sections |

### Files

| File | Change |
|---|---|
| `components/shared/RoleWorkspaceShell.vue` | **New.** Owns only the chrome every pane duplicated: brand, Map/Console tab switch, profile menu. Console mounts lazily; map stays alive via `v-show`. |
| `views/EOPlannerWorkspace.vue`, `EnvOfficerWorkspace.vue`, `InspectorWorkspace.vue` | **New**, ~30 lines each. Compose one map + one console into the shell. |
| The 3 console panes | Gained `embedded?: boolean`. When set, they hide their own brand block and profile menu (the shell supplies both) and drop `height:100vh` to `100%`. Section rail, collapse toggle and section title stay — those are working controls, not chrome. |
| The 3 legacy map panes | Same `embedded` prop. Also hides each one's navigate-to-workspace button, which had become self-referential. |
| `router/index.ts` | The three routes now resolve to the composed workspaces. Paths, names and `meta.roles` are unchanged. |

`embedded` defaults to `false` throughout, so every pane renders exactly as
before when mounted on its own.

### A symptom worth recording

`EOPlannerView`'s header carried a button labelled *"Open the new 10-section EO
Planner Portal"* pointing at `/eo-planner-portal` — the very route that resolved
back to `EOPlannerView`. Clicking it returned the officer to the page they were
already on. That button is the disconnection made visible, and it is why the
fix is a reconnection rather than a redesign.

### Verification

- `vue-tsc --noEmit` — 52 errors, all pre-existing and all inside `src/views/surveyor`. Zero outside it.
- `vite build` — exit 0, **zero unresolved imports**.
- `vitest run --no-file-parallelism` — **62 files / 340 tests passed**, 1 skipped; same single pre-existing `NewApplicationSection.standpicker` ordering flake.

Three new specs close the chain from route to rendered section, because
asserting the wiring alone would not prove the sections came back:

1. `f17-reconnection.spec.ts` — each route resolves to its composed workspace component.
2. `f17-render.spec.ts` — the shell shows the map first, mounts the console only on demand, and keeps the map alive across a switch (`v-show`, not `v-if`, so the MapLibre instance is not rebuilt).
3. `f17-sections.spec.ts` — mounts the EO console pane exactly as the workspace does and asserts **all 11 section entries render**, including Technical circulation, Decision review and Permit drafting, with brand + profile suppressed and the section rail intact.

### Not done here

The panes still carry their own `--login-*`/hardcoded-hex styling; only the new
shell is on `--ent-*` tokens. Unifying that is M1.3, and it is now a
presentation-only change because the structure is settled.

### Verification

- `vue-tsc --noEmit` — 52 errors, all pre-existing and all inside `src/views/surveyor`. Zero outside it.
- `vite build` — **exit 0, zero unresolved imports**, confirming nothing still references the five deleted modules.
- `vitest run --no-file-parallelism` — 59 files / 335 tests passed, 1 skipped; same single pre-existing flake.
- Dev server boots clean.

### Follow-ups this uncovered

1. **`/admin/login` is a dead second auth path.** `stores/admin.ts` → `adminService.authService.login()` POSTs to `/api/admin/auth/login`, which **does not exist** in the backend — so `admin_token` can never be populated. Its refresh interceptor targets an equally absent `/api/admin/auth/refresh`. Real admins sign in at `/login`. → **M0.3**.
2. **`Phase2View.vue` sends `Bearer mock-jwt-token`** on 5 raw fetches — a prototype left wired into an admin route. → **M0.3**.
3. **MFA is unreachable from the UI.** The backend returns `{mfaRequired, mfaToken}` for MFA-enabled accounts and exposes `POST /auth/mfa/challenge`, but no frontend screen completes the challenge. Login now fails with an accurate message instead of a misleading "Invalid login response"; the actual second-factor UI is unbuilt. → needs its own module.
4. **Cross-origin deployment caveat.** Dev is same-origin via the Vite `/api` proxy, so `sameSite: 'lax'` is fine. If production serves the API from a *different* origin (`VITE_API_BASE_URL` pointing off-site), lax cookies will not be sent and the backend must switch to `sameSite: 'none'; secure: true`. That is a backend/deployment decision — flagged, not changed.
