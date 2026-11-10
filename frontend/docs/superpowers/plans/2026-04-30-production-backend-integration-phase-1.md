# Production Backend Integration Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the core open-tab workflows use `new_backend-main` as the real production backend: TPD1 applications, citizen service catalogue/applications, and surveyor workstation data.

**Architecture:** Add idempotent PostgreSQL migrations and focused Fastify route domains in `C:\Users\theop\OneDrive\Desktop\new_backend-main`, then update frontend services/views in `C:\Users\theop\OneDrive\Desktop\app-frontend` to call those domains through the shared Axios API client. Keep localStorage only for unsent drafts.

**Tech Stack:** Vue 3, Vite, Pinia, Axios, Fastify, PostgreSQL/PostGIS, Node 20.

---

## File Structure

Backend files to create or modify:

- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\db\migrations\011_development_control_services_surveyor.sql`
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\development-control\development-control.routes.js`
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\development-control\development-control.controller.js`
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\development-control\development-control.service.js`
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\services\services.routes.js`
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\services\services.controller.js`
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\services\services.service.js`
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\surveyor\surveyor.routes.js`
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\surveyor\surveyor.controller.js`
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\surveyor\surveyor.service.js`
- Modify: `C:\Users\theop\OneDrive\Desktop\new_backend-main\app.js`

Frontend files to create or modify:

- Modify: `C:\Users\theop\OneDrive\Desktop\app-frontend\src\services\api.ts`
- Modify: `C:\Users\theop\OneDrive\Desktop\app-frontend\src\services\developmentControl.ts`
- Create: `C:\Users\theop\OneDrive\Desktop\app-frontend\src\services\serviceCatalogue.ts`
- Create: `C:\Users\theop\OneDrive\Desktop\app-frontend\src\services\surveyor.ts`
- Modify: `C:\Users\theop\OneDrive\Desktop\app-frontend\src\views\TPD1ApplicationView.vue`
- Modify: `C:\Users\theop\OneDrive\Desktop\app-frontend\src\views\OnlineApplicationsView.vue`
- Modify: `C:\Users\theop\OneDrive\Desktop\app-frontend\src\views\OnlineApplicationFormView.vue`
- Modify: `C:\Users\theop\OneDrive\Desktop\app-frontend\src\views\SurveyorView.vue`

No commits are made in this phase.

---

### Task 1: Backend Schema For Phase 1

**Files:**
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\db\migrations\011_development_control_services_surveyor.sql`

- [ ] **Step 1: Add idempotent migration**

Create tables for local authorities, development-control parties, TPD1 applications, TPD1 documents, service catalogue records, surveyor jobs, surveyor coordinates, surveyor beacons, and surveyor layouts.

Key table names:

```sql
local_planning_authorities
development_control_applicants
development_control_owners
tpd1_applications
tpd1_application_documents
service_catalogue
surveyor_jobs
surveyor_coordinates
surveyor_beacons
surveyor_layouts
```

- [ ] **Step 2: Verify migration syntax**

Run in backend folder:

```powershell
npm run migrate
```

Expected: migration runner finishes without SQL errors.

---

### Task 2: Development-Control Backend Domain

**Files:**
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\development-control\development-control.service.js`
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\development-control\development-control.controller.js`
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\development-control\development-control.routes.js`
- Modify: `C:\Users\theop\OneDrive\Desktop\new_backend-main\app.js`

- [ ] **Step 1: Add service methods**

Service methods:

```js
listAuthorities()
listGroups()
getParcelPermittedUses(parcelId, query)
checkCompliance({ parcelId, proposedUseCode })
createApplicant(payload, userId)
createOwner(payload, userId)
createTpd1Application(payload, userId)
listTpd1Applications({ userId, role, page, limit, status })
getTpd1Application(id, { userId, role })
```

- [ ] **Step 2: Add controller methods**

Controller methods map one-to-one to service methods and respond through `sendSuccess` or `sendPaginated`.

- [ ] **Step 3: Add routes**

Routes:

```txt
GET  /api/development-control/local-authorities
GET  /api/development-control/groups
GET  /api/development-control/parcels/:parcelId/permitted-uses
POST /api/development-control/compliance-check
POST /api/development-control/applicants
POST /api/development-control/owners
POST /api/development-control/tpd1-applications
GET  /api/development-control/tpd1-applications
GET  /api/development-control/tpd1-applications/:id
```

- [ ] **Step 4: Register route domain**

In `app.js`, import and register:

```js
import developmentControlRoutes from "./src/domains/development-control/development-control.routes.js";
await app.register(developmentControlRoutes, { prefix: "/api/development-control" });
```

- [ ] **Step 5: Smoke test**

Run:

```powershell
node -e "import('./app.js').then(async ({ buildApp }) => { const app = await buildApp(); const r = await app.inject({ method: 'GET', url: '/api/development-control/local-authorities' }); console.log(r.statusCode, r.body); await app.close(); })"
```

Expected: `200` with `{ "success": true, "data": [...] }`.

---

### Task 3: Service Catalogue Backend Domain

**Files:**
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\services\services.service.js`
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\services\services.controller.js`
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\services\services.routes.js`
- Modify: `C:\Users\theop\OneDrive\Desktop\new_backend-main\app.js`

- [ ] **Step 1: Add list and get service methods**

Expose:

```js
listServices({ category, active })
getServiceById(serviceId)
```

- [ ] **Step 2: Register routes**

Routes:

```txt
GET /api/services
GET /api/services/:id
```

- [ ] **Step 3: Register route domain in app**

```js
import servicesRoutes from "./src/domains/services/services.routes.js";
await app.register(servicesRoutes, { prefix: "/api/services" });
```

- [ ] **Step 4: Smoke test**

Run:

```powershell
node -e "import('./app.js').then(async ({ buildApp }) => { const app = await buildApp(); const r = await app.inject({ method: 'GET', url: '/api/services' }); console.log(r.statusCode, JSON.parse(r.body).data.length); await app.close(); })"
```

Expected: `200` and a service count greater than zero.

---

### Task 4: Surveyor Backend Domain

**Files:**
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\surveyor\surveyor.service.js`
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\surveyor\surveyor.controller.js`
- Create: `C:\Users\theop\OneDrive\Desktop\new_backend-main\src\domains\surveyor\surveyor.routes.js`
- Modify: `C:\Users\theop\OneDrive\Desktop\new_backend-main\app.js`

- [ ] **Step 1: Add authenticated surveyor routes**

Allowed roles: `planner`, `admin`, `surveyor` if the enum exists later. For phase 1, use `planner` and `admin` because the current role enum does not include `surveyor`.

Routes:

```txt
GET   /api/surveyor/jobs
PATCH /api/surveyor/jobs/:id
GET   /api/surveyor/coordinates
POST  /api/surveyor/coordinates
GET   /api/surveyor/beacons
POST  /api/surveyor/beacons
GET   /api/surveyor/layouts
POST  /api/surveyor/layouts
```

- [ ] **Step 2: Register route domain in app**

```js
import surveyorRoutes from "./src/domains/surveyor/surveyor.routes.js";
await app.register(surveyorRoutes, { prefix: "/api/surveyor" });
```

- [ ] **Step 3: Smoke test auth protection**

Run:

```powershell
node -e "import('./app.js').then(async ({ buildApp }) => { const app = await buildApp(); const r = await app.inject({ method: 'GET', url: '/api/surveyor/jobs' }); console.log(r.statusCode); await app.close(); })"
```

Expected: `401`.

---

### Task 5: Frontend API Helpers

**Files:**
- Modify: `C:\Users\theop\OneDrive\Desktop\app-frontend\src\services\api.ts`

- [ ] **Step 1: Add envelope helper exports**

Add:

```ts
export function unwrapData<T = any>(response: { data: any }): T {
  return response.data?.data ?? response.data
}

export function unwrapPagination(response: { data: any }) {
  return response.data?.pagination ?? null
}
```

- [ ] **Step 2: Run type-check**

Run:

```powershell
npm run type-check
```

Expected: no new errors from `src/services/api.ts`.

---

### Task 6: Frontend Development-Control Service And TPD1 View

**Files:**
- Modify: `C:\Users\theop\OneDrive\Desktop\app-frontend\src\services\developmentControl.ts`
- Modify: `C:\Users\theop\OneDrive\Desktop\app-frontend\src\views\TPD1ApplicationView.vue`

- [ ] **Step 1: Add service methods**

Methods:

```ts
getLocalAuthorities()
getLandUseGroups()
getParcelPermittedUses(parcelId, eligibleZone)
checkDevelopmentPermission(parcelId, proposedUseCode)
createApplicant(payload)
createOwner(payload)
submitTpd1Application(payload)
```

- [ ] **Step 2: Replace direct fetch calls in TPD1 view**

Use the service for authorities, groups, compliance checks, applicant creation, owner creation, and TPD1 submission.

- [ ] **Step 3: Run frontend type-check**

Run:

```powershell
npm run type-check
```

Expected: no TypeScript errors introduced by the service/view changes.

---

### Task 7: Frontend Service Catalogue And Online Applications

**Files:**
- Create: `C:\Users\theop\OneDrive\Desktop\app-frontend\src\services\serviceCatalogue.ts`
- Modify: `C:\Users\theop\OneDrive\Desktop\app-frontend\src\views\OnlineApplicationsView.vue`
- Modify: `C:\Users\theop\OneDrive\Desktop\app-frontend\src\views\OnlineApplicationFormView.vue`

- [ ] **Step 1: Add service catalogue frontend service**

Methods:

```ts
getServices()
getService(serviceId)
submitPortalApplication(payload)
getMyPortalApplications()
```

- [ ] **Step 2: Replace hardcoded-only catalogue flow**

Load services from `/api/services`; keep local fallback only for display if backend is unavailable during development.

- [ ] **Step 3: Replace submitted application localStorage counts**

Use `/api/portal/applications` for submitted counts and history.

- [ ] **Step 4: Run frontend type-check**

Run:

```powershell
npm run type-check
```

Expected: no TypeScript errors introduced by online application changes.

---

### Task 8: Frontend Surveyor Service And View

**Files:**
- Create: `C:\Users\theop\OneDrive\Desktop\app-frontend\src\services\surveyor.ts`
- Modify: `C:\Users\theop\OneDrive\Desktop\app-frontend\src\views\SurveyorView.vue`

- [ ] **Step 1: Add surveyor frontend service**

Methods:

```ts
getJobs()
updateJob(id, payload)
getCoordinates()
createCoordinate(payload)
getBeacons()
createBeacon(payload)
getLayouts()
createLayout(payload)
```

- [ ] **Step 2: Load queue, coordinates, beacons, and layouts from backend**

Replace hardcoded initialization arrays with service calls. Keep in-memory edits for map interaction, then persist important actions through service methods.

- [ ] **Step 3: Run frontend type-check**

Run:

```powershell
npm run type-check
```

Expected: no TypeScript errors introduced by surveyor changes.

---

### Task 9: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Backend migration verification**

Run:

```powershell
npm run migrate
```

Expected: all migrations complete.

- [ ] **Step 2: Backend route smoke tests**

Run route injection smoke tests for:

```txt
/api/development-control/local-authorities
/api/services
/api/surveyor/jobs
```

Expected: public endpoints return `200`; protected endpoint returns `401` without a token.

- [ ] **Step 3: Frontend type-check**

Run:

```powershell
npm run type-check
```

Expected: command exits `0`.

- [ ] **Step 4: Frontend production build**

Run:

```powershell
npm run build
```

Expected: command exits `0` and writes `dist`.

- [ ] **Step 5: Manual smoke test**

Start backend and frontend dev servers, then test:

```txt
Login
Online service catalogue
Submit a service application
Open TPD1 form and load authorities/groups
Submit a TPD1 application
Open Surveyor workstation and load jobs/coordinates
```

Expected: all tested screens use backend data and do not require demo/localStorage records for submitted items.
