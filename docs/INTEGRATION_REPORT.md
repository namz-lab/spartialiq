# SpartialIQ Planning Portal
## System Integration Report
### MVT Pipeline, API Architecture & Front-to-Back-End Integration

**Version:** 1.0 — June 2026  
**Stack:** Vue 3 + Pinia + MapLibre GL 4.7.1 (frontend) | Fastify 5.7.1 + PostgreSQL/PostGIS (backend)  
**Prepared by:** SpartialIQ Engineering

---

## 1. System Architecture Overview

SpartialIQ is a multi-tier web application serving a Zimbabwe multi-council digital planning portal. It replaces paper-based development control with a fully digital workflow from citizen intake through stage inspections to certificate of occupation.

### 1.1 Tier Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│  TIER 1 — CLIENT (Browser)                                          │
│  Vue 3 + Composition API + Pinia + MapLibre GL 4.7.1                │
│  Vite 5 dev server (port 5174) / Static build in production         │
│  Axios API client → /api/* proxy → backend                         │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ HTTP/HTTPS (REST + PBF tiles)
┌────────────────────────────────▼────────────────────────────────────┐
│  TIER 2 — APPLICATION SERVER (Node.js)                              │
│  Fastify 5.7.1 on port 3000                                         │
│  JWT HS256 auth | @fastify/cors | @fastify/helmet                   │
│  @fastify/rate-limit | @fastify/compress | @fastify/multipart       │
│  LRU HTTP cache (httpCache.js) | Audit log middleware               │
│  In-process email worker (optional, MAIL_WORKER_INPROC=1)          │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ @fastify/postgres (connection pool)
┌────────────────────────────────▼────────────────────────────────────┐
│  TIER 3 — DATA (PostgreSQL 14+ / PostGIS 3.3+)                      │
│  Database: vungu_master_db_v1 (local) / DATABASE_URL (production)   │
│  Schemas: public (app tables) + spatial_planning (DM Handbook)      │
│  24 spatial tables from zimbabwe.gpkg (SRID 900914)                 │
│  ST_AsMVT for vector tile generation                                │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Communication Protocols

| Path | Protocol | Format | Auth |
|---|---|---|---|
| /api/auth/* | HTTPS REST | JSON | None (public) |
| /api/payments/webhook/:driver | HTTPS POST | JSON | HMAC signature |
| /api/tiles/:layer/:z/:x/:y.pbf | HTTPS GET | PBF (binary) | None (public) |
| /api/tiles/layers | HTTPS GET | JSON | None (public) |
| All other /api/* | HTTPS REST | JSON | JWT Bearer token |
| /uploads/* | HTTPS GET | Binary (static) | None (served by @fastify/static) |

---

## 2. MVT (MapBox Vector Tile) Pipeline

The map system is the most technically complex integration in SpartialIQ. It serves 24 PostGIS spatial layers as binary Protocol Buffer tiles to MapLibre GL on the frontend.

### 2.1 Why MVT over GeoJSON or TopoJSON

The tile route file documents this decision explicitly:

| Format | Pros | Cons | Used for |
|---|---|---|---|
| GeoJSON | Human-readable, universal | Large file size, no zoom awareness, unsuitable for 100k+ features | Single-feature popups, search results |
| TopoJSON | 20–80% smaller than GeoJSON via topology | Not natively supported by MapLibre; requires client JS conversion | /api/tiles/topo/:layer — choropleth/D3 views |
| MVT/PBF | Binary, 80–95% smaller than GeoJSON; GPU rendering; zoom-aware; 100k+ features | Requires PostGIS 3.3+ ST_AsMVT | All interactive map layers |

### 2.2 Server-Side: PostGIS ST_AsMVT Query

The tile generation path is: `GET /api/tiles/:layer/:z/:x/:y.pbf`

**Step 1 — Tile bounds calculation** (in `src/lib/tileQuery.js`):
```
For tile (z, x, y):
  - Convert tile XYZ to Web Mercator bbox using standard formula
  - Expand bbox by buffer pixels (256px tile → ~4px buffer) to prevent edge artefacts
  - Build SQL using ST_TileEnvelope(z, x, y) for precise tile bounds
```

**Step 2 — SQL query built per layer:**
```sql
SELECT ST_AsMVT(q, '<layer_id>', 4096, 'geom')
FROM (
  SELECT
    ST_AsMVTGeom(
      ST_Transform(t.geom, 3857),
      ST_TileEnvelope($z, $x, $y),
      4096,        -- tile extent (pixels)
      64,          -- buffer (pixels)
      true         -- clip geometries
    ) AS geom,
    <attribute columns from LAYERS config>
  FROM <table_name> t
  WHERE t.geom && ST_Transform(
      ST_Expand(ST_TileEnvelope($z, $x, $y), buffer),
      900914        -- source SRID
  )
  <AND lowZoomFilter.where IF z < lowZoomFilter.maxZoom>
) q
WHERE q.geom IS NOT NULL
```

**Step 3 — Coordinate system handling:**

The zimbabwe.gpkg import used SRID 900914 (a non-standard EPSG assigned by ogr2ogr because the source GeoPackage lacked a standard EPSG code). SRID 900914 is mathematically identical to EPSG:4326 (WGS84 CRS84 — same longitude/latitude coordinates). The tile query transforms geometries to EPSG:3857 (Web Mercator) for MVT packaging because MapLibre GL expects Web Mercator tiles.

Transform chain: `SRID:900914 → ST_Transform → EPSG:3857 → ST_AsMVTGeom`

**Step 4 — Caching:**
```
LRU tile cache: 4,000 tiles, 128 MB max, 24-hour TTL
Cache key: "<layer>/<z>/<x>/<y>"
ETag: base64("<key>:<YYYY-MM-DD>") — daily rotation, conditional requests → 304 Not Modified
Empty tiles (204): outside zoom range → 7-day Cache-Control, no DB hit
```

**Step 5 — Response:**
```
Content-Type: application/vnd.mapbox-vector-tile
Content-Encoding: gzip
Cache-Control: public, max-age=86400, stale-while-revalidate=3600
ETag: "<daily-hash>"
Body: gzip-compressed PBF binary
```

### 2.3 Low-Zoom Filter for Roads

The roads layer applies a low-zoom filter to avoid sending thousands of minor road features at zoom levels where they would be invisible:

```javascript
lowZoomFilter: { maxZoom: 12, where: "fclass IN ('motorway','trunk','primary','secondary')" }
```

Below zoom 12, only national highways, trunk roads, primary and secondary roads are included. At zoom 12+, all roads appear. This reduces tile payload by ~90% at country-level zoom.

### 2.4 Client-Side: MapLibre GL Integration

**File: `frontend/src/map/vunguBasemap.ts`**

```typescript
// addVunguBasemap(map) registers all 24 source + layer pairs
export async function addVunguBasemap(map: MapLibreMap) {
  const layers = await getTileLayerCatalog()  // GET /api/tiles/layers

  for (const layer of layers) {
    // 1. Add tile source
    map.addSource(layer.id, {
      type: 'vector',
      tiles: [`/api/tiles/${layer.id}/{z}/{x}/{y}.pbf`],
      minzoom: layer.minzoom,
      maxzoom: layer.maxzoom,
    })

    // 2. Add paint layer using style from vunguBasemapStyle.ts
    const style = styleLayerFor(layer)
    map.addLayer({
      id: layer.id,
      type: style.type,           // fill / line / circle / symbol
      source: layer.id,
      'source-layer': layer.id,  // matches MVT layer name from ST_AsMVT
      paint: style.paint,
      layout: style.layout,
      minzoom: layer.minzoom,
    })
  }
}
```

**File: `frontend/src/map/vunguBasemapStyle.ts`**

Single source of truth for all map paint and layout styles. The same `chipColorFor(id, geomType)` function drives both the map layer colours and the filter chip swatches in `MapLayerFilters.vue` — so map and UI are always in sync.

**File: `frontend/src/services/vectorTiles.ts`**

```typescript
getTileLayerCatalog()              // GET /api/tiles/layers → SpatialLayer[]
tileUrlTemplate(layerId)           // → /api/tiles/{id}/{z}/{x}/{y}.pbf
getFeature(layer, fid)             // GET /api/tiles/{layer}/{fid} → GeoJSON popup
```

### 2.5 Single-Feature GeoJSON Popup

When a user clicks a map feature, the frontend calls:

```
GET /api/tiles/:layer/:id
```

The server executes:
```sql
SELECT ST_AsGeoJSON(ST_Transform(geom, 4326)) AS geometry,
       <attribute columns>
FROM <table>
WHERE fid = $1
```

Returns a GeoJSON Feature with properties, displayed as a popup overlay in the map view.

### 2.6 Admin Layer Cache Management

```
GET  /api/tiles/cache/stats      → { tiles, bytes, hitRate }   (admin only)
DELETE /api/tiles/cache/:layer   → invalidates all tiles for that layer (admin only)
```

Used after bulk spatial data imports to force fresh tile generation without server restart.

---

## 3. Authentication & Session Integration

### 3.1 JWT Flow

```
CLIENT                           SERVER
  │                                │
  │  POST /api/auth/register       │
  │  { email, password, name }     │
  ├────────────────────────────────▶│  bcrypt.hash(password, 12)
  │                                │  INSERT INTO users
  │  { user, token, refreshToken } │
  ◀────────────────────────────────┤
  │                                │
  │  POST /api/auth/login          │
  │  { email, password }           │
  ├────────────────────────────────▶│  bcrypt.compare
  │                                │  Issue JWT (HS256, 12h expiry)
  │  { user, token, refreshToken } │  INSERT INTO user_sessions (14d refresh)
  ◀────────────────────────────────┤
  │                                │
  │  GET /api/* (authenticated)    │
  │  Authorization: Bearer <token> │
  ├────────────────────────────────▶│  requireAuth() middleware
  │                                │  jwt.verify(token, JWT_SECRET)
  │                                │  Attach req.user = { id, email, role }
  │  Response                      │
  ◀────────────────────────────────┤
```

### 3.2 Role-Based Access Control

The `requireRole(allowedRoles)` middleware is applied per route:

```javascript
fastify.post('/permit-applications', 
  { preHandler: requireRole(fastify, ['planner', 'planning_clerk', 'eo', 'admin']) },
  async handler
)
```

Frontend role gates in the Vue router (`frontend/src/router/index.ts`):

```typescript
function roleHome(role: string) {
  if (role === 'admin')              return '/admin/users'
  if (role === 'planner')            return '/planner'
  if (role === 'eo')                 return '/eo-planner-portal'
  if (role === 'env_officer')        return '/env-officer'
  if (role === 'building_inspector') return '/building-inspector'
  if (role === 'planning_clerk')     return '/planning-clerk-portal'
  if (role === 'surveyor')           return '/surveyor'
  if (role === 'gis_officer')        return '/gis-officer-portal'
  return '/citizen'
}
```

Staff are redirected on login to their role-specific portal. Citizens go to `/citizen`. The admin IT role is explicitly blocked from planning/analytics routes.

### 3.3 Pinia Auth Store (Frontend)

`frontend/src/stores/auth.ts` — persists to `localStorage`:
- `auth_token` → JWT access token
- `auth_user` → user object (id, email, role, name)

On every route change, the router guard checks `localStorage` and syncs to Pinia if the store is empty (handles hard refresh scenarios).

### 3.4 Council Selection Gate

`frontend/src/stores/council.ts` persists to `spartialiq_council` in localStorage. Before any route renders, the router checks:

```typescript
if (!councilStore.hasCouncil && !bypassCouncil) {
  next('/welcome')  // force council selection
}
```

This means every citizen, staff member, and planner must select a council (from 10 Zimbabwe councils) before accessing the system. Bypassed for: `/welcome`, `/invite`, `/admin/*`.

---

## 4. API Endpoint Catalogue

### 4.1 Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/auth/register | None | Citizen self-registration |
| POST | /api/auth/login | None | Login — returns JWT + refresh token |
| POST | /api/auth/logout | Bearer | Revoke session |
| POST | /api/auth/refresh | Refresh token | Issue new access token |
| POST | /api/auth/invite | admin | Issue staff invite |
| POST | /api/auth/invite/accept | None (token) | Staff claims invite, sets password |

### 4.2 Spatial Tiles

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/tiles/layers | None | Layer catalogue (24 layers) |
| GET | /api/tiles/:layer/:z/:x/:y.pbf | None | MVT binary tile |
| GET | /api/tiles/:layer/:id | None | Single feature as GeoJSON |
| GET | /api/tiles/topo/:layer | None | Full layer as TopoJSON |
| GET | /api/tiles/cache/stats | admin | Cache diagnostics |
| DELETE | /api/tiles/cache/:layer | admin | Invalidate layer cache |

### 4.3 Development Applications (Citizen)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/development-applications | Bearer | Submit new application |
| GET | /api/development-applications | Bearer | List own applications (citizen) or all (staff) |
| GET | /api/development-applications/:id | Bearer | Application detail |
| PATCH | /api/development-applications/:id | Bearer (staff) | Update application fields |
| DELETE | /api/development-applications/:id | Bearer (admin) | Archive application |
| GET | /api/development-applications/:id/status | Bearer | Current status + history |
| POST | /api/applications/:appId/status | Bearer (staff) | Trigger status transition |
| GET | /api/applications/:appId/status-history | Bearer | Timeline of status changes |

### 4.4 Statutory Permit Applications (Staff)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/permit-applications | planner/clerk/eo | Create statutory permit record |
| GET | /api/permit-applications | planner/clerk/eo | List (filterable by status, type, search) |
| GET | /api/permit-applications/:id | planner/clerk/eo | Detail including consultations + objections |
| PATCH | /api/permit-applications/:id/status | planner/eo | Status transition |
| POST | /api/permit-applications/:id/consultations | planner | Circulate to statutory body |
| GET | /api/permit-applications/:id/consultations | planner/clerk | List consultations |
| PATCH | /api/consultations/:cid/response | planner | Record body response |
| POST | /api/permit-applications/:id/objections | clerk | Record public objection |
| GET | /api/permit-applications/:id/objections | planner/clerk | List objections |
| PATCH | /api/objections/:oid/consideration | planner | Record consideration outcome |

### 4.5 Inspections

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/inspection-stages | None | Public catalogue of 9 stages |
| POST | /api/applications/:appId/inspections | Bearer (citizen) | Book stage inspection |
| POST | /api/inspections/:id/pay | Bearer (citizen) | Mark fee paid → waitlisted |
| POST | /api/inspections/:id/schedule | building_inspector | Set date, assign self |
| POST | /api/inspections/:id/reschedule | building_inspector | Move date |
| POST | /api/inspections/:id/complete | building_inspector | Mark passed/failed |
| POST | /api/inspections/:id/cancel | Bearer | Cancel booking |
| GET | /api/inspections/:id | Bearer | Inspection detail |
| GET | /api/applications/:appId/inspections | Bearer | All stages for application |
| GET | /api/inspector/queue | building_inspector | Inspector's assigned + waitlist |
| POST | /api/inspections/:id/photos | building_inspector | Upload site photo (multipart) |
| GET | /api/inspections/:id/photos | Bearer | Photo list |
| DELETE | /api/inspections/:id/photos/:photoId | building_inspector/admin | Remove photo |

### 4.6 Plan Review

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/applications/:appId/plan-reviews | Bearer (citizen) | Upload plan (PDF/DWG/DXF, max 60 MB) |
| GET | /api/applications/:appId/plan-reviews | Bearer | List reviews |
| GET | /api/plan-reviews/:id | Bearer | Review detail + findings |
| POST | /api/plan-reviews/:id/decide | planner/building_inspector | Staff decision |

### 4.7 Payments

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/payments/quote | None | Quote in USD + ZWG |
| GET | /api/payments/rate | None | Current exchange rate |
| GET | /api/payments/methods | None | Available payment drivers |
| POST | /api/payments | Bearer | Initiate payment |
| GET | /api/payments | Bearer | List own payments |
| GET | /api/payments/:id | Bearer | Payment detail |
| POST | /api/payments/:id/confirm | Bearer (dev) | Manual driver confirm |
| POST | /api/payments/:id/cancel | Bearer | Cancel pending payment |
| POST | /api/payments/webhook/:driver | None (HMAC) | Provider webhook |
| POST | /api/payments/admin/rates | admin | Insert exchange rate |

### 4.8 Documents & KYC

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/documents | Bearer (citizen) | Upload document (max 12 MB) |
| GET | /api/documents/mine | Bearer (citizen) | Own documents |
| GET | /api/documents/queue | planning_clerk/admin | Pending verification queue |
| GET | /api/documents/:id | Bearer | Document detail |
| POST | /api/documents/:id/verify | planning_clerk/admin | Verify or reject |
| DELETE | /api/documents/:id | Bearer | Delete (pending only for citizen) |
| POST | /api/kyc | Bearer (citizen) | Submit KYC details |
| GET | /api/kyc/my | Bearer (citizen) | Own KYC status |
| GET | /api/kyc | admin/planning_clerk | All submissions |
| PATCH | /api/kyc/:id/approve | admin | Approve |
| PATCH | /api/kyc/:id/reject | admin | Reject with notes |

### 4.9 Notifications

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/notifications | Bearer | Unread notifications |
| GET | /api/notifications/unread-count | Bearer | Unread count badge |
| POST | /api/notifications | Bearer (staff) | Create notification |
| PATCH | /api/notifications/:id/read | Bearer | Mark single read |
| PATCH | /api/notifications/read-all | Bearer | Mark all read |

---

## 5. Workflow Data Flow — Complete Application Lifecycle

The following traces a complete development application from citizen submission to occupation certificate:

### Stage 1: Citizen Submits Application

```
CitizenPortalView.vue → DevelopmentApplicationView.vue
  ├─ POST /api/development-applications
  │    Writes: development_applications (status=submitted)
  │            application_documents
  │            application_timeline
  │
  └─ Confirmation → ApplicationSuccessView.vue
```

### Stage 2: Planning Clerk Receives

```
PlanningClerkPortalView.vue
  ├─ GET /api/development-applications?status=submitted
  ├─ POST /api/applications/:id/status  { to: 'under_review' }
  │    Writes: application_status_history
  │            application_timeline
  │            notifications_outbox (email to citizen)
  │
  └─ POST /api/permit-applications  (creates statutory record)
       Writes: spatial_planning.permit_application (tpd_reference issued)
```

### Stage 3: Circulation to Statutory Bodies

```
PlannerWorkspaceView.vue
  ├─ POST /api/permit-applications/:id/consultations
  │    Writes: spatial_planning.application_consultation
  │
  └─ POST /api/applications/:id/status  { to: 'env_review' }
       Writes: application_status_history
               notifications_outbox (email to citizen + env_officer)
```

### Stage 4: Environmental Officer Review

```
EnvironmentOfficerWorkspaceView.vue
  ├─ GET /api/permit-applications?status=env_review
  ├─ PATCH /api/consultations/:id/response  { response_status: 'no_objection' }
  │
  └─ POST /api/applications/:id/status  { to: 'survey_review' }
       (or pending_decision if no survey needed)
```

### Stage 5: Planner Recommendation & EO Decision

```
PlannerWorkspaceView.vue → EOPlannerPortalView.vue
  ├─ PATCH /api/permit-applications/:id/status  { status: 'approved' }
  │    Writes: spatial_planning.permit_application (decision_at, decision_officer)
  │
  └─ POST /api/applications/:id/status  { to: 'approved' }
       Writes: application_status_history
               notifications_outbox (email to citizen: APPROVED)
               workflow_notifications (broadcast to staff)
```

### Stage 6: Citizen Pays Application Fee

```
CitizenPortalView.vue → PaymentsView.vue
  ├─ GET /api/payments/quote?priceUsd=50&walletCcy=ZWG
  ├─ GET /api/payments/methods
  ├─ POST /api/payments  { purpose:'application_fee', driver:'paynow', ... }
  │    Writes: payments (status=pending)
  │    Calls: paymentDriver.initPayment() → Paynow redirect URL
  │
  └─ Provider callback: POST /api/payments/webhook/paynow
       Reads: payments WHERE provider_ref=?
       Writes: payments (status=paid, paid_at, issued_receipt_no)
               notifications_outbox (receipt email)
```

### Stage 7: Citizen Uploads Building Plans

```
CitizenPortalView.vue → PlanReviewView.vue
  ├─ POST /api/applications/:id/plan-reviews  (multipart PDF, max 60 MB)
  │    Writes: plan_reviews (status=pending)
  │    Triggers: planReview.runDeterministicChecks()
  │      Writes: plan_review_findings (severity: info/warn/error)
  │      Updates: plan_reviews.status → auto_passed/auto_warnings/auto_failed
  │
  └─ Planner reviews findings:
       POST /api/plan-reviews/:id/decide  { status:'staff_approved' }
       Writes: plan_reviews (status=staff_approved)
       POST /api/applications/:id/status  { to:'building_permit_issued' }
```

### Stage 8: Building Inspections (9 Stages)

```
CitizenPortalView.vue → BuildingInspectorView.vue
  ├─ POST /api/applications/:id/inspections  { stage_number: 1 }
  │    Writes: inspection_bookings (status=pending_payment)
  │
  ├─ Citizen pays: POST /api/inspections/:id/pay
  │    Writes: payments (purpose=inspection_fee)
  │    On payment confirmation:
  │      Writes: inspection_bookings (status=waitlisted, fee_paid_at)
  │              inspection_status_events
  │              notifications_outbox (fee confirmed email)
  │
  ├─ Inspector schedules: POST /api/inspections/:id/schedule
  │    Writes: inspection_bookings (status=scheduled, scheduled_for)
  │            inspection_status_events
  │            notifications_outbox (schedule confirmation email to citizen)
  │
  ├─ Inspector completes: POST /api/inspections/:id/complete
  │    Writes: inspection_bookings (status=passed/failed, passed, inspector_notes)
  │            inspection_status_events
  │            notifications_outbox (result email to citizen)
  │
  └─ Photo evidence: POST /api/inspections/:id/photos  (multipart)
       Writes: inspection_photos
```

### Stage 9: Certificate of Occupation

```
BuildingInspectorView.vue
  └─ POST /api/applications/:id/status  { to:'occupation_issued' }
       Writes: application_status_history
               application_timeline
               notifications_outbox (occupation certificate email)
               workflow_notifications (broadcast: application complete)
```

---

## 6. Frontend View — Backend Route Mapping

| Frontend View | Backend Routes Called | DB Tables Touched |
|---|---|---|
| WelcomeView.vue | None (council selection only) | localStorage |
| HomeView.vue | GET /api/tiles/layers, GET /api/tiles/* .pbf | 24 spatial tables |
| GISMapView.vue | GET /api/tiles/*, GET /api/tiles/:layer/:id | 24 spatial tables |
| CitizenPortalView.vue | GET /api/development-applications, GET /api/payments, GET /api/notifications/unread-count | development_applications, payments, workflow_notifications |
| DevelopmentApplicationView.vue | POST /api/development-applications | development_applications, application_documents |
| ApplicationTrackingView.vue | GET /api/applications/:id/status-history | application_status_history, application_timeline |
| OnlineApplicationsView.vue | GET /api/development-applications | development_applications |
| PaymentsView.vue | GET /api/payments/quote, GET /api/payments/methods, POST /api/payments | payments, exchange_rates |
| PaymentGatewayView.vue | GET /api/payments/:id (polling) | payments |
| PaymentReceiptView.vue | GET /api/payments/:id | payments |
| BuildingInspectorView.vue | GET /api/applications/:id/inspections, POST /api/inspections/:id/* | inspection_bookings, inspection_photos |
| InspectorWorkspaceView.vue | GET /api/inspector/queue, POST /api/inspections/:id/complete | inspection_bookings, inspection_status_events |
| PlanReviewView.vue | POST /api/applications/:id/plan-reviews, GET /api/plan-reviews/:id | plan_reviews, plan_review_findings |
| DocumentsView.vue | GET /api/documents/mine, POST /api/documents | citizen_documents |
| PlanningClerkPortalView.vue | GET /api/development-applications, POST /api/permit-applications | development_applications, spatial_planning.permit_application |
| PlanningClerkView.vue | GET /api/documents/queue, POST /api/documents/:id/verify, GET /api/kyc | citizen_documents, kyc_verifications |
| PlannerWorkspaceView.vue | GET /api/permit-applications, POST /api/permit-applications/:id/consultations | spatial_planning.permit_application, application_consultation |
| EOPlannerPortalView.vue | GET /api/permit-applications?status=under_review, PATCH /api/permit-applications/:id/status | spatial_planning.permit_application |
| EnvironmentOfficerWorkspaceView.vue | GET /api/permit-applications?status=env_review, PATCH /api/consultations/:id/response | application_consultation |
| SurveyorWorkspaceView.vue | GET /api/permit-applications?status=survey_review | spatial_planning.permit_application |
| GISOfficerPortalView.vue | GET /api/tiles/*, DELETE /api/tiles/cache/:layer | 24 spatial tables, tile cache |
| WorkflowDashboardView.vue | GET /api/development-applications, GET /api/notifications, GET /api/payments (summary) | All workflow tables |
| AdminView.vue | GET /api/users, POST /api/users, GET /api/stats | users, security_audit_log |
| AnalyticsView.vue | GET /api/development-applications (aggregated), GET /api/payments | development_applications, payments |

---

## 7. Middleware Stack & Request Lifecycle

Every API request passes through this middleware chain:

```
Request arrives at port 3000
  │
  ├─ @fastify/helmet       — sets X-Content-Type-Options, X-Frame-Options,
  │                          Referrer-Policy, CSP headers
  │
  ├─ @fastify/cors         — validates Origin against allowed list
  │                          (localOrigins in dev, ALLOWED_ORIGINS in prod)
  │
  ├─ @fastify/compress     — gzip/deflate responses > 1 KB
  │
  ├─ @fastify/rate-limit   — 100 req/min global (10 req/min for /auth/*)
  │                          key: X-Forwarded-For or req.ip
  │
  ├─ HTTP Cache Plugin     — LRU server-side cache + Cache-Control headers
  │   (httpCache.js)         per-route tiers (tiles: 24h, API: 5min–1h)
  │
  ├─ Route handler runs    — requireAuth() checks JWT, requireRole() checks role
  │
  └─ Audit Log Plugin      — onResponse hook for all authenticated mutations
     (auditLog.js)           Writes to: security_audit_log
                             Categories: AUTH, USER_MGMT, PERMIT, PAYMENT,
                             INSPECTION, CERTIFICATE, DOCUMENT, KYC, ENFORCEMENT
```

---

## 8. Payment Integration Deep Dive

### 8.1 Payment State Machine

```
Initial state: pending
  │
  ├── Driver initPayment() ────────────────── awaiting_provider
  │                                               │
  │         [Paynow redirect / EcoCash USSD]      │
  │                                               │
  │         Provider webhook arrives:             │
  │         POST /api/payments/webhook/:driver    │
  │                                               ▼
  │                                            paid ──── side effects:
  │                                                       inspection_bookings.fee_paid_at
  │                                                       notifications_outbox enqueue
  │
  ├── Driver initPayment() fails ─────────── failed
  │
  └── Citizen cancels ────────────────────── cancelled
```

### 8.2 Exchange Rate Resolution

When the frontend requests a quote:
1. `GET /api/payments/quote?priceUsd=50&walletCcy=ZWG`
2. Backend calls `exchangeRate.getLatestRate(pg)`:
   - Checks exchange_rates for today's RBZ rate
   - Falls back to most recent rate within 72 hours
   - Falls back to `FALLBACK_RATE` env variable (default: 36.0)
3. Returns `{ amountUsd: 50, amountZwg: 1800.00, rate: 36.0, rateDate: '2026-06-04', isStale: false }`
4. Rate is locked at payment creation time — stored in `payments.rate_used` and `payments.rate_id`

### 8.3 USSD Payment Flow (EcoCash / OneMoney)

```
Frontend: POST /api/payments { driver: 'ecocash', walletCcy: 'ZWG', ... }
Backend:
  1. INSERT payments (status=pending)
  2. ecocashDriver.initPayment({ payment }) → pushes USSD to citizen's phone
  3. Returns { ussdCode: '*151*1*1*<ref>#', ussdInstructions: 'Dial on your phone' }
  4. UPDATE payments (status=awaiting_provider, metadata.ussdCode)
Frontend: displays USSD code + polling spinner
  │
  │  (citizen dials on phone)
  │
Backend webhook: POST /api/payments/webhook/ecocash
  1. Verify HMAC signature (ECOCASH_HASH_SECRET)
  2. SELECT payments WHERE provider_ref = webhook.reference
  3. applyPaid() transaction:
     - UPDATE payments SET status=paid, paid_at, issued_receipt_no
     - IF purpose=inspection_fee:
         UPDATE inspection_bookings SET status=waitlisted, fee_paid_at
     - INSERT inspection_status_events
     - INSERT notifications_outbox (inspection_waitlisted email)
  4. COMMIT
```

---

## 9. Notification System

### 9.1 Outbox Pattern

All notifications go via `notifications_outbox` — an outbox table that decouples the API from delivery:

```
API writes → notifications_outbox (status=pending)
                      │
              Email Worker reads queue
              (in-process if MAIL_WORKER_INPROC=1,
               or separate process: node src/workers/emailWorker.js)
                      │
              SMTP send → status=sent / failed
```

This ensures notifications are never lost even if the email server is temporarily unavailable, and means API response times are not blocked by SMTP.

### 9.2 Notification Templates (kind field)

| kind | Trigger | Recipient |
|---|---|---|
| application_submitted | Application created | Citizen |
| application_status_change | Any status transition | Citizen |
| inspection_scheduled | Inspector sets date | Citizen |
| inspection_rescheduled | Inspector moves date | Citizen |
| inspection_result | Inspector completes | Citizen |
| inspection_waitlisted | Fee paid confirmed | Citizen |
| plan_review_complete | Auto-review finishes | Citizen |
| payment_receipt | Payment confirmed | Citizen |
| kyc_approved | KYC approved | Citizen |
| kyc_rejected | KYC rejected | Citizen |
| document_verified | Document verified | Citizen |

### 9.3 In-App Notifications (Workflow Layer)

`workflow_notifications` is a separate table for cross-department staff notifications — e.g., when a new application arrives in a planner's queue, or when an objection is lodged against a circulated application.

Frontend `WorkflowDashboardView.vue` polls `GET /api/notifications/unread-count` to display the notification badge.

---

## 10. File Storage Architecture

All uploaded files are stored on the filesystem under `/uploads/` (configured via `@fastify/static`):

| Path | Contents | Max size | Who uploads |
|---|---|---|---|
| /uploads/citizen-documents/:userId/ | KYC documents (ID, passport, deeds) | 12 MB | Citizens |
| /uploads/plan-reviews/:appId/ | Building plans (PDF/DWG/DXF) | 60 MB | Citizens |
| /uploads/inspection-photos/:bookingId/ | Site inspection evidence | 10 MB | Inspectors |
| /uploads/stage-photos/:appId/:stage/ | Stage-specific inspection photos | 10 MB | Inspectors |

**Deduplication:** Every upload computes SHA-256 of the file content. Duplicate hashes are rejected with HTTP 409 Conflict (using `UNIQUE (user_id, sha256_hex)` constraints).

**Storage quotas:** `users.doc_quota_bytes` = 100 MB per citizen. `users.doc_used_bytes` is incremented on upload and decremented on deletion.

---

## 11. Security Architecture

### 11.1 Authentication Security
- Passwords: bcrypt with cost factor 12 (approximately 300ms hash time)
- Access tokens: JWT HS256, 12-hour expiry
- Refresh tokens: 14-day expiry, stored hashed in `user_sessions`
- Auth route rate limit: 10 requests/minute per IP (separate from global 100/min)

### 11.2 Input Validation
- All route bodies validated before DB access; invalid inputs return 400
- SQL parameters always use `$1, $2` placeholders — no string concatenation in queries
- File uploads: MIME type validated; size hard-capped at @fastify/multipart limits
- Payment amounts: NUMERIC type server-side; client must not multiply

### 11.3 Audit Trail
The `auditLog.js` middleware writes every authenticated POST/PUT/PATCH/DELETE to `security_audit_log` with:
- Severity categorised by endpoint (PAYMENT=high, AUTH=medium, NOTIF=low)
- Client IP, user agent, role, response time, HTTP status
- Never delays the response (runs in `onResponse` hook, not `preHandler`)

### 11.4 Security Headers (@fastify/helmet)
- `Content-Security-Policy`: self + inline scripts (Vue requires), blob/data for MapLibre workers
- `X-Frame-Options`: DENY (clickjacking protection)
- `X-Content-Type-Options`: nosniff
- `crossOriginEmbedderPolicy: false` — required for MapLibre GL WebGL workers

---

## 12. Production Deployment Notes

### 12.1 Environment Variables Required

| Variable | Purpose |
|---|---|
| DATABASE_URL | PostgreSQL connection string |
| JWT_SECRET | JWT signing secret (min 256-bit entropy) |
| PORT | Server port (default 3000) |
| ALLOWED_ORIGINS | Comma-separated CORS origins |
| FRONTEND_URL | Primary frontend URL |
| PAYNOW_ID / PAYNOW_KEY | Paynow integration |
| ECOCASH_MERCHANT_CODE / ECOCASH_API_KEY / ECOCASH_HASH_SECRET | EcoCash integration |
| ONEMONEY_MERCHANT_CODE / ONEMONEY_API_KEY | OneMoney integration |
| STRIPE_SECRET_KEY | Stripe integration |
| PAYNOW_RETURN_URL / PAYNOW_RESULT_URL | Paynow callback URLs |
| FALLBACK_RATE | Fallback ZWG/USD rate (e.g. 36.0) |
| MAIL_WORKER_INPROC | 1 = run email worker in-process |
| SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS | SMTP for email notifications |

### 12.2 Migration Order

Run all migrations in sequence:
```
000_multi_tenant_schema.sql
001_initial_schema.sql
001_admin_schema.sql
002_phase2_schema.sql
041_security_audit.sql
042_development_applications.sql
050_land_use_* (variants)
060_invite_system_and_roles.sql
061_applicant_type_and_invite_roles.sql
062_stands_and_planning_templates.sql
063_notifications_and_inspections.sql
064_payments_and_documents.sql
065_plan_review.sql
070_development_management_handbook_v1_2.sql
071_stage_inspection_photos_and_flags.sql
072_per_item_inspection_scoring.sql
073_score_includes_na_as_zero.sql
074_spatial_tile_indexes.sql
075_notifications_and_kyc.sql
076_production_hardening.sql
```

### 12.3 Vector Tile Data Import

The 24 spatial layers are loaded from `zimbabwe.gpkg`:
```bash
ogr2ogr -f PostgreSQL \
  PG:"host=... dbname=vungu_master_db_v1" \
  zimbabwe.gpkg \
  -overwrite -progress
```

Migration 074 adds GiST spatial indexes on all 24 geometry columns. After bulk import, invalidate tile cache via admin API.

---

*SpartialIQ System Integration Report v1.0 | June 2026*  
*SpartialIQ GIS & Planning Unit*
