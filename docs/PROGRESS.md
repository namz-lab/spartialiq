# SpartialIQ — Progress Report

**Multi-council digital planning platform for Zimbabwe local authorities.**
Citizens apply online; the application flows through every council office — planning, environmental, survey, inspection, committee — with real-time tracking, statutory gates, and a live PostGIS map under everything.

*Pilot council: Vungu RDC · Stack: Vue 3 + MapLibre / Fastify + PostgreSQL/PostGIS · Updated 3 August 2026*

---

## What we shipped in the past weeks

### Subdivision via QGIS/AutoCAD round-trip (August)
- Planners are no longer limited to the in-browser CAD tool: **export a subdivision as
  georeferenced DXF, lay it out or edit it in QGIS Desktop or AutoCAD/Civil3D/Bricscad, then
  re-import** — lots match back to themselves by an embedded id (keeping use type/status,
  taking fresh geometry), new lots are added, dropped ones are removed, roads replace wholesale
  if the file has any. Entirely client-side (no new backend endpoint, no GDAL dependency — see
  ADR 0007), goes through the same validation/save/undo path as the web tool. Full detail:
  `docs/QGIS_WEB_INTEGRATION.md` §5a.
- New canonical **`docs/COUNCIL_OPERATIONS_FLOW.md`**: every statutory stage, which role acts,
  which view/endpoint, cross-referenced against a role capability matrix — and a reconciliation
  of the three different "status" concepts in this codebase (the DB column is free-form
  `VARCHAR`, not the declared-but-unused enum; the frontend pipeline is the real governing
  vocabulary; the post-permit inspection tracker is a separate sub-machine).

### Planning Studio (June → July)
- Full statutory planning shell: intake → due-diligence → zoning verdict → committee → determination, with a stepper rail that mirrors the RTCP Act workflow.
- **Precise CAD drafting**: arcs, annotations, dimensions, symbols, hatch, join/explode, xref — a real drawing tool inside the browser.
- **Road templates + one-click "Generate Neighbourhood"**: the drafter proposes structure, the engine lays the streets and cuts the stands.
- Grounded AI layout suggestions (NVIDIA NIM proxy): PostGIS facts → model brief → draft layout; falls back to the offline deterministic generator without a key.

### Survey (July — the big one)
- **A full professional survey suite built into the platform** as the *Survey Task Manager*: 20 backend route modules under `/api/survey` — projects, control points, coordinate lists, least-squares (Helmert + W-test data snooping), CSV import with live validation, QGIS export, GeoPDF/DXF generation, DSG certificates, Reports on Survey.
- **Planner ↔ Surveyor loop**: planners assign survey tasks against permit applications, surveyors submit findings, planners accept / return / cancel.
- **Survey Console re-engineered (today)**: a dark field-instrument workspace — live grid readout (cursor position in Lo-zone Y/X **and** WGS84 simultaneously), centre reticle, instrument status bar (zone · zoom · clock · link LED), and a full **COGO toolkit**: join/inverse, polar, **traverse with Bowditch adjustment and misclosure precision ratio**, zone converter (Lo25–33 ↔ WGS84), bearing–bearing intersection, parcel area & closure with save-to-task, control-point attachment, DSG/RoS document generation. Bearings accept DMS (`123°45'30"`) or decimal. All geometry math is unit-tested (21 tests) and runs client-side, so the tools work in the field offline.
- Emoji-free professional UI across the entire survey module (500+ removed).

### Governance & statutory hardening (July)
- Statutory transition matrix enforced on **every** permit status write.
- Committee gates: quorum, attendance, and resolution required before determinations.
- Stand number allocation authority with an auditable register; transactional stand merge/split.
- Server-side geometry validation on every polygon writer + topology rule rejecting overlapping stands.
- Soft delete for statutory records, DB backup script, malware scanning on uploads, OpenAPI docs at `/api/docs`, MFA + session management.

### Platform & GIS engine (June)
- Vector tile pipeline with two-tier (LRU + Redis) cache and GiST indexes; pg pool sized for tile bursts.
- CAD-style stands editor for the GIS Officer; NL map search; Vungu boundary mask; EO command centre with client-side PDF/CSV report generation.
- Council selector + gate (multi-council layer), Vungu RDC home redesign, payments (Paynow/EcoCash/OneMoney/Stripe), citizen tracking with 8-stage pipeline.

---

## Where we are

| Area | State |
|---|---|
| Citizen intake → tracking | Working end to end |
| Planner statutory workflow | Working; Planning Studio in active refinement |
| Survey (tasks + console + Task Manager) | Working; console re-engineered today |
| Committee / determinations | Gated + auditable |
| Payments | Drivers wired; sandbox credentials |
| GIS / tiles / editing | Working; QGIS project file not wired on this machine (OGC WMS/WFS preview degraded) |

## What's left

1. **QGIS Server wiring** — point `QGIS_SERVER_URL`/project at a real instance so WMS/WFS legends and styled layers light up.
2. **Production payments** — swap sandbox Paynow/Stripe credentials, verify webhooks on the public URL.
3. **Planning Studio review roadmap** — compliance polish, stand schedule exports, statutory document templates. Native GeoPackage round-trip and a live QGIS-plugin sync for planning projects specifically are deliberately deferred (see `docs/QGIS_WEB_INTEGRATION.md` §5a) — DXF round-trip covers the QGIS/AutoCAD use case without a server-side GDAL dependency.
4. **Survey Task Manager depth** — wire the remaining "Planned" modules (data traverse, setting-out sheets, Helmert UI) to the already-merged backend.
5. **Deployment** — follow `docs/deployment/DEPLOYMENT.md` (NGINX, SSL, PM2, Render migrations are allow-listed and idempotent).
6. **User acceptance** — council staff walkthrough per role; demo accounts below.

## Objectives (unchanged)

Replace paper-based development control with a single, auditable, map-first system every Zimbabwe council can adopt — statutory by construction, offline-tolerant in the field, and cheap to operate.

---

*Demo accounts (`demo1234`): `demo.admin` / `demo.planner` / `demo.eo` / `demo.surveyor` / `demo.inspector` / `demo.clerk` / `demo.gis` — all `@vungu.test`.*
*Run the stack: see `.claude/skills/run-stack/SKILL.md`.*
