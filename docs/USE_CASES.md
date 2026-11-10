# Council Use Cases — who does what, and where each document goes next

Written 2026-08-17. Companion to `COUNCIL_OPERATIONS_FLOW.md` (the code-level
trace); this document states each use case in plain terms and, for every
document a citizen or officer produces, **the routing loop: which office it
goes to next, and what the reader of each page does with it**. The routing
below is what the software actually enforces — the same
`useApplicationPipeline` model renders "where the document is" identically to
the citizen and to every staff role.

## The actors

| Actor | Portal | One-line mandate |
|---|---|---|
| Citizen (resident / landowner / business) | `/citizen` | Applies, pays, uploads, tracks |
| Planning Clerk | `/planning-clerk-portal` | Front desk: receipts, fees, notices, register, dispatch |
| Planner | `/planner` | Due diligence, zoning verdict, subdivision layout, circulation, recommendation |
| Environmental Officer | `/env-officer-workspace` | Environmental appraisal and surveillance |
| Surveyor | `/surveyor`, `/surveyor-workspace` | Field survey, beacons, diagrams, Reports on Survey |
| GIS Officer | `/gis-officer-portal` | Spatial database, zoning layers, QGIS↔web bridge |
| EO (Executive Officer) | `/eo-planner-portal` | The statutory determination (RTCP Act s.26) |
| Building Inspector | `/inspector-workspace` | 9 stage inspections → occupation certificate |
| Admin (IT) | `/admin/*` | Users, invites, content, symbology registry — no planning access |

## UC-0 · Proving you belong to the district (new, Aug 2026)

**Goal:** the council serves its own residents; a new account proves it.
**Trigger:** first login by any citizen-tier account (`residencyStatus !== 'verified'`) → routed to `/residency`.

Accepted proofs (SI 85/2017 s.5 taxonomy): **title deed** (checked instantly
against the Deeds Registry), certificate of occupation, **lodger's permit**,
**settlement/offer letter**, rates or utility statement, or a
chief/councillor confirmation letter.

Routing loop:

```
Citizen (/residency)
  ├─ deed number ──► Deeds Registry (simulated Ministry of Lands, /mock/ministry-lands)
  │                    ├─ holder national-ID match → residency VERIFIED instantly
  │                    └─ every lookup logged on the ministry dashboard
  └─ document upload ──► citizen_documents (status pending/under_review)
                           └─► Planning Clerk / Planner / EO / Admin — /documents queue
                                 ├─ verify  → user residency VERIFIED
                                 └─ reject  → citizen notified, may submit another proof
```

## UC-1 · Development permit (Form TPD.1) — the main loop

**Goal:** citizen builds lawfully; council decides statutorily.

```
1. CITIZEN            /citizen → New application     writes development_applications (submitted)
        │  document: application + plans + fee
        ▼
2. PLANNING CLERK     Receipt & acknowledge          status → registered/acknowledged; TPD ref issued
        │  document: receipted application
        ▼
3. PLANNER            Due diligence & circulation    consultations created (circulation)
        │  copies routed in parallel to:
        ├──► ENVIRONMENTAL OFFICER   plan appraisal → consultation response
        ├──► SURVEYOR                survey task if boundaries in doubt → findings
        ├──► GIS OFFICER             zoning/constraint check on the live map
        └──► BUILDING INSPECTOR      buildability comments
        ▼
4. PLANNING CLERK     Public notice                  objection_period; objections recorded
        ▼
5. PLANNER            Assessment & recommendation    under_review; committee agenda item
        ▼
6. COMMITTEE          Quorum + resolution gates      (server-enforced before any decision)
        ▼
7. EO                 Determination                  approved | approved_with_conditions | refused
        │  document: permit (drafted by planner, dispatched by clerk)
        ▼
8. CITIZEN            Pays, receives permit          → inspection sub-machine begins
        ▼
9. BUILDING INSPECTOR 9 stage inspections            all 8 prior stages must pass
        ▼
10. CITIZEN           Occupation certificate         case closed in the register
```

Every stage above is visible to the citizen in **My applications → “Where
your application is — office by office”** (`ApplicationPipeline`), driven by
the backend permit status, never by browser state.

## UC-2 · Subdivision of a stand

Planner opens the parcel in **Planning Studio** (`/planner/studio/:layer/:fid`)
or exports **georeferenced DXF** for QGIS/AutoCAD, lays out lots and roads,
re-imports; lots match by embedded id. Validation + save go through the same
stands API; the GIS officer sees the result on the shared PostGIS layers, the
surveyor receives pegging tasks, and new stand numbers come from the
allocation authority (auditable register).

## UC-3 · Survey task loop

```
PLANNER (case needs ground truth)
   └─► assigns survey task ─► SURVEYOR (/surveyor-workspace)
          field capture: beacons, control points, traverse (Bowditch), areas
          documents: Report on Survey, DSG certificate, GeoPDF/DXF diagram
   ◄─ submits findings ─┘
PLANNER accepts / returns / cancels; accepted geometry flows to the case
```

## UC-4 · Enforcement

Inspector or EO raises an enforcement order against a stand; prohibition
orders, compliance checks and status changes are recorded against the
register; the clerk keeps the enforcement record; the planner sees it on the
case and the map.

## UC-5 · Payments

Citizen pays (Paynow / EcoCash / OneMoney / Stripe / manual) → webhook
confirms → receipt issued → clerk's fees ledger reflects it → the permit
pipeline unblocks (`pending_payment → registered`).

## UC-6 · GIS style governance (Aug 2026)

GIS officer edits symbology → versioned in the style registry (migration 114)
→ published → **web map, QGIS Server WMS and QGIS Desktop all compile from
the same published version**. One zone name → one colour → one geometry
(`zones_master`).

## Where each mock/simulated boundary sits

| Simulation | Real counterpart | Where |
|---|---|---|
| Deeds Registry dashboard | Ministry of Lands deeds office | `/mock/ministry-lands` (staff-only) |
| Deed check API | Registry search | `POST /api/residency/deed-check` (logged) |

Everything else in the loops above is production wiring — real tables, real
role gates, real status transitions.
