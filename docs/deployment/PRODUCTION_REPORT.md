# SpartialIQ / Vungu — Full Council Production Report

**Date:** 2026-09-21  
**Product:** Spatial Operations & Planning Platform  
**Verdict:** **ALL 9 COUNCIL DEMO ROLES + CITIZEN DESK VERIFIED** — module loop **49 / 49 PASS**; production `frontend/dist/` rebuilt.

Evidence: `PRODUCTION_MODULE_RESULTS.json` · Artefact: `frontend/dist/`

---

## 1. Every council entity covered

| Entity | Demo login | Portal / pages | Loop | Status |
|--------|------------|----------------|------|--------|
| **Admin / ICT** | `demo.admin@vungu.test` | `/admin` users, platform status, security, land-use, content, symbology | M11 | **PASS** |
| **Town Planner** | `demo.planner@vungu.test` | `/planner` shell (map+console), studio, statutory | M3 | **PASS** |
| **EO Planning** | `demo.eo@vungu.test` | `/eo-planner-portal` (decision gate, complaints live) | M5/M7 | **PASS** |
| **Planning Clerk** | `demo.clerk@vungu.test` | `/planning-clerk-portal` — 12 sections on **Postgres SSOT** (`/api/clerk/*`) | M8 | **PASS** |
| **GIS Officer** | `demo.gis@vungu.test` | `/gis-officer-portal` — roads, WASH, **livestock**, themes, import, … | M4 | **PASS** |
| **Building Inspector** | `demo.inspector@vungu.test` | `/inspector-workspace` | M5 | **PASS** |
| **Environmental Health (EHO)** | `demo.envoffice@vungu.test` | `/env-officer-workspace` — `/api/eho/*` | M9 | **PASS** |
| **Surveyor** | `demo.surveyor@vungu.test` | `/surveyor` + `/surveyor-workspace/jobs` (Planned modules = empty state, no crash) | M10 | **PASS** |
| **Citizen / Viewer** | `demo.viewer@vungu.test` + self-register | `/citizen` — **all catalogue services live** (incl. service-desk tickets) | M2/M13 | **PASS** |

Password (local/demo only): `demo1234`

**M12 All-roles matrix:** all 9 demos login with expected roles — **PASS**.

---

## 2. What was completed this pass (beyond the earlier spine)

### Planning Clerk → server SSOT
- Migration **124** → schema `planning_clerk.*` (correspondence, fees, acks, dispatch, refusals, notice certs, abutters)
- API `/api/clerk/...` · frontend `planningClerkApi` + rewritten `usePlanningClerkCase` (no localStorage)

### Citizen — every counter service
- Migration **125** → `council_ops.service_desk_ticket`
- API `/api/service-desk/tickets` (+ `/mine`, staff list)
- Former `coming_soon` (rates, trading licence, nuisance, road works, social welfare, survey) → **live** ticket form (`service_desk` section)

### GIS
- Livestock GIS section + `/api/ops/livestock`
- Map-search kept on `tilesRoutes` (duplicate register removed; degraded search no longer 500s)

### Portal hardening
- Property File → live parcels/stands APIs, honest empty states (no fake deeds)
- Ministry Lands → Simulation labelled + error-safe
- Video tutorials → no external placeholder CDN
- EO map → live building complaints
- Surveyor Planned modules → empty state instead of white-screen

---

## 3. Automated loop results

```
Passed: 49  Failed: 0  Total: 49
M1 Auth · M2 Citizen · M3 Planner/DC · M4 GIS · M5 Inspect
M7 Cross · M8 Clerk · M9 EHO · M10 Surveyor · M11 Admin
M12 AllRoles (9) · M13 Service desk + map-search · M14 Documents/Payments
```

Re-run: `node scripts/production-module-loop.js`

---

## 4. Deployment readiness (full council)

| Item | Ready? |
|------|--------|
| Migrations through **125** | Yes (apply on target via `migrate-render.js`) |
| All staff role portals load + API-backed | Yes |
| Citizen full service catalogue | Yes (service desk for non-permit counters) |
| Production frontend build | Yes (`npm run build:fast`) |
| Secrets / TLS / public host | **Pending cutover** (`DEPLOYMENT.md`) |
| Import real Roads/WASH/livestock GeoJSON | Pending Council data |
| Paynow / card gateways | Manual/Paynow env; Card/Apple/Google still coming-soon UI |
| Surveyor mining/topo “Planned” compute toys | Intentionally deferred — jobs path is production |
| Committee / Director / Minister RBAC | Not in DB role enum yet |
| Ministry Lands | Simulation only — not national Deeds SSOT |

### Prod env minimum
```env
NODE_ENV=production
DATABASE_URL=...
JWT_SECRET=...
CAPTCHA_SECRET=...
ALLOWED_ORIGINS=https://your.domain
DEMO_SEED_ENABLED=false
```

---

## 5. Honest remaining gaps

1. Staff **service-desk inbox UI** (API list exists; clerk/EHO can consume later).  
2. Some EO KPI tiles still show `—` where no billing API exists.  
3. Building-plan annexure checklist draft may still use browser storage until a server draft field ships.  
4. QGIS Server atlas / offline field sync remain optional Phase items.  
5. Governance roles (committee/director) need a future migration + statutory action assignment.

---

## 6. Sign-off

| Criterion | Met? |
|-----------|------|
| Every demo council role logs in | **Yes (9/9)** |
| Clerk / EHO / Surveyor / Admin in automated loop | **Yes** |
| Every citizen catalogue service has a live path | **Yes** |
| Production UI build | **Yes** |
| Public cloud cutover | **Ops pending** |

**Bottom line:** The platform now covers **every council staff entity and every citizen counter path** with live APIs or honest empty states — not only the planner/GIS spine. Deploy with migrations **124–125**, rotate secrets, then re-run the 49-check loop against the live URL.
