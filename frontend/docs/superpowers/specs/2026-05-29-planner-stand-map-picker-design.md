# Planner Stand Map Picker — Design

**Date:** 2026-05-29
**Status:** Approved (pending spec review)
**Surface:** Planner workspace → Statutory Workflow → Step 1 Intake (`/planner-workspace`)

## Problem

The planner registers a permit application by typing a free-text **Stand no.** in the
Step 1 Intake form. Nothing ties that text to the actual cadastral parcel, so the
remaining property details (ward, description, area, location) are also typed by hand
and can be wrong or inconsistent with the spatial record. The council also needs a
guard: an application must fall within Vungu RDC's jurisdiction, and if it does not,
the planner should be told which authority is responsible instead.

## Goals

- A map-pin icon inside the Stand-no field opens a map picker.
- The planner finds a parcel by searching (country-wide) or clicking on the map.
- Selecting a parcel auto-fills, from spatial data: **Stand no.**, **Ward**,
  **Property description**, **Parcel area**, and stores the **centroid**.
- The map covers all of Zimbabwe and search returns results country-wide.
- If the selected location is outside Vungu RDC, selection is blocked and the
  **responsible council is named** (with contact details).
- The derivation layer is **extensible**: future datasets (e.g. title deed, owner,
  zoning) plug in as additional resolvers without reworking the picker or endpoint.

## Non-goals

- No new country-wide parcel dataset. Selectable stands remain `vungu_parcels`.
- Title-deed / owner derivation is *not* built now (no dataset yet); only the seam is.
- The Stand-no field stays manually editable — the map is an optional aid.

## Data sources (verified)

| Table | Rows | SRID | Used for |
|-------|------|------|----------|
| `vungu_parcels` | 733 | 4326 | Stand polygons. `name` → Stand no.; `province`, `area_ha`; `geom` → centroid. No ward/owner/title columns. (Spans 5 districts — 183 lie outside Vungu, so the jurisdiction check matters even for parcels.) |
| `wards` | 1961 | 900914 | Ward derivation. `name_en` (ward number, e.g. "18"), `level = 3`, `geom`. |
| `districts` | 91 | 900914 | District naming for out-of-Vungu points. `name_en` (e.g. "Gweru", "Harare"), `geom`. |
| `gweru_rural_planning_boundary` | 1 | 4326 | **Vungu RDC jurisdiction polygon.** `adm2_en = "Gweru Rural"` (ZW1704) is Vungu RDC's area. `geom` (ST_Polygon). |
| `local_authorities` | 2 (dup) | — | Vungu RDC contact record. `authority_name`, `telephone`, `email`, `address`. **`jurisdiction_geometry` is NULL** — not usable for containment; boundary comes from `gweru_rural_planning_boundary`. Two identical rows → `DISTINCT … LIMIT 1`. |

Geometry SRIDs differ per table (4326 vs the legacy 900914 ≡ CRS84). Both are lng/lat
degrees, so containment uses `ST_Contains(geom, ST_SetSRID(ST_MakePoint(lng,lat),
ST_SRID(geom)))` — force the point's SRID to the geom's, no transform (avoids issues
with the custom 900914). Centroids: `ST_X/ST_Y(ST_Centroid(ST_Transform(geom, 4326)))`.

## Architecture & data flow

```
Step1Intake "Stand no." field
  └─ [map-pin icon] → opens StandPickerModal.vue
        ├─ renders the Vungu basemap (src/map/vunguBasemap.ts) + country-wide search box
        ├─ planner clicks the map OR searches a place/parcel → clicks a result
        ├─ on select → GET /api/parcels/locate?lng&lat
        │     resolvers compose a bundle:
        │       • jurisdiction → local_authorities containing the point
        │       • parcel       → vungu_parcels containing the point (only in Vungu)
        │       • ward         → wards.name_en (level 3) containing the point
        │       • [future]     → title-deed / owner / zoning resolvers
        ├─ picker renders one of three outcomes (below)
        └─ "Use this stand" → emits StandSelection → Step1Intake maps it to form fields
```

## Backend

### Endpoint

`GET /api/parcels/locate?lng=<number>&lat=<number>` → `{ success, data }`:

```json
{
  "success": true,
  "data": {
    "in_jurisdiction": true,
    "district": "Gweru",
    "authority": {
      "name": "Vungu Rural District Council",
      "telephone": "...",
      "email": "planning@vungurdc.gov.zw",
      "address": "..."
    },
    "stand": {
      "fid": 123,
      "stand_number": "<parcel name>",
      "district": "Gweru",
      "province": "<province>",
      "area_ha": 2.41,
      "centroid": [29.5938, -19.5419],
      "ward": "18",
      "description": "Parcel <name>, Gweru — 2.41 ha"
    }
  }
}
```

- `in_jurisdiction` = the point is inside `gweru_rural_planning_boundary` (Vungu RDC's area).
- `district` = `districts.name_en` (level 2) containing the point; `null` if none. Used to
  tell an out-of-area planner *where* the location falls.
- `authority` = the Vungu RDC `local_authorities` record (name + contacts), de-duplicated.
  Always returned (it's the only council on record); the picker shows it when in-jurisdiction.
- `stand` = present only when `in_jurisdiction` **and** a `vungu_parcels` polygon contains
  the point; otherwise `null`. (A parcel outside the boundary yields `in_jurisdiction:false`
  and `stand:null` — the guard applies to parcels too.)
- `ward` is `null` when no level-3 ward polygon contains the point.

> Data limitation (accepted): there is no nationwide council-boundary dataset, so an
> out-of-Vungu point is named by **district**, not by the specific responsible council.
> The resolver seam lets us name exact councils later if such data is added.

### Resolvers (extensibility seam)

`resolveLocation(pg, lng, lat)` runs a list of resolvers and merges their output:

- `jurisdictionResolver` → `{ in_jurisdiction }` from `gweru_rural_planning_boundary`,
  `{ district }` from `districts`, `{ authority }` from `local_authorities` (DISTINCT … LIMIT 1)
- `parcelResolver` → `{ stand: { fid, stand_number, province, area_ha, centroid } }`
  (run only when `in_jurisdiction`)
- `wardResolver` → `{ stand.ward }`
- `descriptionResolver` → composes `stand.description` ("Parcel <name>, <district> — <area> ha")

A future title-deed dataset is added as `titleDeedResolver` contributing
`stand.title_deed_no`; nothing else changes.

### Implementation notes

- New route module `src/routes/parcels.js`, registered in `server.js` under `/api`.
- Table names are fixed literals; only `lng`/`lat` are user input (parameterized).
- Point built with `ST_SetSRID(ST_MakePoint($lng,$lat), 4326)`; geometries transformed
  to 4326 for the `ST_Contains` checks, matching `tileQuery.js`.

### Country-wide search

Extend `GET /api/map-search` (in `src/routes/tiles.js`) so place/POI results are no
longer restricted to Vungu's district: search `places_points`/`pois_points`
country-wide and add `districts` results, keeping the existing wards and Vungu
parcel/farm/zone results. This lets the planner navigate anywhere in Zimbabwe; the
jurisdiction guard catches out-of-area selections at confirm time.

## Frontend

### New: `src/components/StandPickerModal.vue`

- Modal overlay over the workspace, styled with scoped CSS to match the planner UI.
- Renders the existing `vunguBasemap` + the Google-style search box.
- On map click or search-result click → calls the service with the point.
- Renders one of three outcomes:
  1. **In Vungu + parcel found** → derived details panel + enabled "Use this stand".
  2. **In Vungu + no parcel** → hint "No registered parcel here — click on a parcel."
  3. **Out of Vungu** → error, confirm disabled: *"This location is in {district} district,
     outside Vungu RDC's jurisdiction. Vungu RDC cannot process applications here — contact
     the local authority responsible for {district}."* (If `district` is null → "This
     location is outside Vungu RDC's jurisdiction.")
- Emits a typed `StandSelection` on confirm; `Esc`/backdrop closes; focus-trapped.

### New: `src/services/parcels.ts`

`locateStand(lng, lat): Promise<StandLocation>` wrapping the endpoint (unwraps the
`{success,data}` envelope, matching the established service convention).

### Edit: `Step1Intake.vue`

- Add a map-pin icon button to the right of the Stand-no `<input>`
  (`aria-label="Pick stand on map"`), opening the modal.
- A small **field-mapping config** applies the bundle:
  `{ stand_number→form.standNo, ward→form.ward, description→form.propertyDescription }`.
  Adding a future field (e.g. title deed) is one line here.
- Add a read-only **Parcel area** display (the form has no area field today; this is
  informational, not the Plinth-area building-footprint field).
- Store the **centroid** on the planner case so the permit links to its location.
  (`usePlannerCase` / `CaseFile.property` gains an optional `centroid: [lng,lat]`.)

## Accessibility

- Icon button labelled; modal focus-trapped with `Esc` to close.
- Stand-no remains keyboard-editable; the picker is an optional aid.
- `prefersReducedMotion()` collapses any map `fitBounds` to an instant jump.

## Error handling

- Backend: `400` on missing/non-numeric coordinates; `500` on DB error (logged);
  `ward`, `responsible_authority`, `stand` may each be `null` without erroring.
- Frontend: loading state during lookup; network failure → toast
  "Could not look up that location"; out-of-jurisdiction and no-parcel states block
  confirmation rather than erroring.

## Testing

- **Backend (real DB)** — `locate` for: in-Vungu on a parcel (in_jurisdiction true,
  stand populated, ward + district set), in-Vungu off a parcel (in_jurisdiction true,
  stand null), out-of-Vungu (in_jurisdiction false, district named, stand null), and a
  point with no district (district null). Plus `map-search` returns a country-wide place.
- **Frontend** — `StandPickerModal`: select → emits the bundle; out-of-jurisdiction
  disables confirm and shows the council message. `Step1Intake`: applying a bundle
  fills stand no / ward / description / area and stores the centroid.

## Files

**Add**
- `app-backend/src/routes/parcels.js`
- `app-frontend/src/components/StandPickerModal.vue`
- `app-frontend/src/services/parcels.ts`

**Edit**
- `app-backend/server.js` (register route)
- `app-backend/src/routes/tiles.js` (country-wide `map-search`)
- `app-frontend/src/views/planner/Step1Intake.vue` (icon, modal, field mapping, area display)
- `app-frontend/src/composables/usePlannerCase.ts` (optional `centroid` on the case)
