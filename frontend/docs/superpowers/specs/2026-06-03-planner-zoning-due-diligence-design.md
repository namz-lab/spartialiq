# Spatial Zoning Auto-Check in Step 2 Due Diligence

**Date:** 2026-06-03
**Status:** Design (awaiting review)
**Scope:** Frontend only · Planner role · Step 2 Due Diligence
**Repo:** `app-frontend`

## 1. Problem

Step 2 Due Diligence ([Step2DueDiligence.vue](../../../src/views/planner/Step2DueDiligence.vue)) assesses planning conformity through a **manual checklist** — the officer eyeballs the map and ticks Pass / Fail / N-A for items like "Land-use zoning conformity" and "Conflict of use". Meanwhile the backend already owns authoritative zoning logic: a `development_matrix` keyed by `(zone, use-group)` returning **Permitted / Special Consent / Prohibited** with conditions and bulk limits, exposed via `/development-control` endpoints over `proposed_peri_urban_zones` (Vungu's zone polygons). That capability is never surfaced to the planning officer. This feature connects the two: it reads the stand's zone and permitted uses and lets the officer apply the authoritative zoning verdict into the due-diligence checklist.

## 2. Goals

1. In Step 2, show the **zone** the selected stand falls in and the **full permitted-uses table** for that zone (every use group → Permitted / Special Consent / Prohibited, with conditions and bulk limits).
2. Let the officer pick the proposal's **use group** and **apply** the resulting verdict into the existing `compatibility.zoning` checklist item with one click — fully overridable, nothing ticked silently.
3. Persist the assessment on the case so it survives reload and appears in the record.
4. **Degrade gracefully** wherever the backend has no zone/matrix data for a stand — never block the manual checklist.

## 3. Non-goals

- **No backend changes of any kind.** No new/edited routes, SQL, migrations, or seed data. This slice only *consumes* the existing `/development-control` endpoints. Seeding Vungu zoning data (if absent) is a separate, later effort the user validates live.
- No proximity/constraint analysis (distance to watercourses, road access, adjacent-use conflict). Zoning conformity only this slice.
- No auto-ticking of any checklist item without an explicit officer "Apply" click.
- No changes to Steps 1, 3, 4, 5 beyond the shared case-state field added in §6.
- No new visual/brand system; reuse existing Step 2 card styles.

## 4. Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Scope of the check | **Zoning conformity only** (matrix-backed Permitted / Special Consent / Prohibited + conditions + bulk limits). |
| How the result appears in Step 2 | **Findings card + one-click "Apply to checklist"** — overridable; nothing ticked silently. |
| How the proposed use is determined | **Officer picks the use group**; the card shows the **full permitted-uses table** for the zone for context. |
| Backend data dependency | **Frontend slice + graceful degradation.** No backend work; show "data unavailable" when the matrix/zone is missing. |
| Implementation approach | **A — reuse `/development-control` endpoints via a thin service + a Step 2 card.** Keeps zoning logic authoritative in the DB. |

## 5. Existing backend contracts consumed (read-only)

- `GET /api/parcels/locate?lng=&lat=` → `StandLocation { stand: StandDetail | null, ... }`, where `StandDetail` has a numeric `fid` and `centroid`. (Frontend client: `locateStand(lng, lat)` in [parcels.ts](../../../src/services/parcels.ts).)
- `GET /api/development-control/parcels/:parcelId/permitted-uses` — `:parcelId` is the numeric parcel id (`fid`); optional `?zone_name=`/`?zone_code=`. Resolves the parcel's zone (via `proposed_peri_urban_zones`) and returns the permitted-uses rows from `development_matrix`, each carrying `permission_code` (`P` | `SC` | `X`/prohibited), `conditions`, and bulk limits (`max_height_meters`, `min_lot_size_sqm`, `max_units`), plus group identity (`group_id`, group name, use code).

> The exact JSON envelope/field names are confirmed against the route during the implementation-plan phase; the service layer (§6) isolates and normalises them so the card depends on a stable typed shape, not the raw response.

## 6. Architecture

### 6.1 New service — `src/services/developmentControl.ts`
A thin, typed wrapper over the endpoint. Single responsibility: fetch + normalise.

```ts
export type Permission = 'permitted' | 'special_consent' | 'prohibited' | 'unknown'

export interface PermittedUse {
  groupId: number
  groupName: string
  useCode: string | null
  permission: Permission        // mapped from permission_code P/SC/X
  conditions: string | null
  maxHeightM: number | null
  minLotSqm: number | null
  maxUnits: number | null
}

export interface ZoneAssessment {
  zoneName: string | null
  zoneCode: string | null
  parcelFid: number
  uses: PermittedUse[]
}

// Resolves the permitted-uses table for a parcel fid. Returns null for a
// typed "no data" result the card renders as graceful degradation.
export async function getPermittedUses(parcelFid: number): Promise<ZoneAssessment | null>
```

`permission_code` → `Permission` mapping: `P`→`permitted`, `SC`→`special_consent`, `X`/prohibited→`prohibited`, anything else→`unknown`.

### 6.2 New component — `src/views/planner/ZoningAssessmentCard.vue`
- Props: none beyond what it reads from `usePlannerCase().current` (centroid, any cached `parcelFid`, and the existing saved `zoningAssessment`).
- On mount (or on a "Run zoning check" action): resolve `parcelFid` (use `property.parcelFid` if cached, else `locateStand(centroid)` → `fid`, cache it), then `getPermittedUses(fid)`.
- Renders: zone name/code, the full permitted-uses table (group → coloured Permitted/Special Consent/Prohibited chip + conditions + bulk limits), and a **use-group selector**.
- Emits `apply(payload)` when the officer clicks "Apply to checklist" for the selected group, where payload carries the chosen group's verdict, conditions, and bulk limits.
- Owns its **loading / empty / error / no-data** states. The card never throws into Step 2.

### 6.3 Case-state extension — `src/composables/usePlannerCase.ts`
Add to the `CaseFile` type and `emptyCase()`:
- `property.parcelFid?: number` — cached parcel id from the first locate, so reruns skip the round-trip.
- `dueDiligence.zoningAssessment?: { parcelFid: number; zoneName: string | null; zoneCode: string | null; selectedUseCode: string | null; selectedGroupName: string | null; permission: Permission; conditions: string | null; maxHeightM: number | null; minLotSqm: number | null; maxUnits: number | null; assessedAt: string }` — the applied snapshot, for the record and to rehydrate the card.

### 6.4 Step 2 wiring — `src/views/planner/Step2DueDiligence.vue`
- Mount `<ZoningAssessmentCard @apply="onApplyZoning" />` within (or just above) the **Compatibility checks** card.
- `onApplyZoning(payload)`:
  - Set `compatibility.zoning.result`: `permitted`→`pass`, `prohibited`→`fail`, `special_consent`→`pass` (with a "Special consent required" note).
  - Set `compatibility.zoning.notes` to a concise summary: zone, verdict, conditions, and bulk limits (height/lot/units).
  - Persist `dueDiligence.zoningAssessment` snapshot (+ `property.parcelFid`).
  - `save()`.
- The existing `setResult`/`updateNotes` logic and the live summary verdict are unchanged; the officer can still override the `zoning` item afterward.

## 7. Data flow

```
Step 2 card mount / "Run zoning check"
  └─ parcelFid = property.parcelFid ?? locateStand(property.centroid).stand.fid   (cache on case)
       └─ getPermittedUses(parcelFid)
            ├─ ok  → render zone + full permitted-uses table → officer picks use group
            │         └─ "Apply" → emit → Step2.onApplyZoning → set compatibility.zoning + notes
            │                              + persist dueDiligence.zoningAssessment → save()
            └─ no zone / empty matrix / 404 / no centroid → "Zoning data unavailable — record manually"
```

## 8. Error & edge handling

- **No `centroid` and no `parcelFid`:** card shows "Confirm the stand location on the map first" with no error; manual checklist stays usable.
- **`locateStand` returns no stand / `permitted-uses` 404 / empty `uses` / null zone:** "Zoning data unavailable for this stand — record manually."
- **Network/5xx:** inline error state with a "Retry" affordance; never blocks Step 2.
- **Special Consent:** mapped to `pass` plus a prominent "Special consent required" note (so the DD summary surfaces it as a concern, consistent with the existing `pass_with_concerns` path); officer may downgrade.
- **Re-apply:** applying again overwrites the `zoning` item and the snapshot; officer override after apply is preserved until they re-apply.

## 9. Testing

- **Unit (Vitest):** `developmentControl.getPermittedUses` maps `permission_code` → `Permission`, normalises bulk-limit fields, and returns the typed "no data" result for 404/empty (axios mocked).
- **Component (happy-dom):** `ZoningAssessmentCard` renders the uses table from a mocked service, the group-picker + Apply emits the correct payload, and the no-data / error states render. (Specs use `// @vitest-environment happy-dom`.)
- **Integration (happy-dom):** in a mounted Step 2 (or via the handler), applying a `permitted` result sets `compatibility.zoning.result==='pass'` and persists `dueDiligence.zoningAssessment`; a `prohibited` result sets `fail`.
- Existing Step 2 / planner specs stay green.

## 10. Files

**New**
- `src/services/developmentControl.ts`
- `src/views/planner/ZoningAssessmentCard.vue`
- Test specs alongside, under `src/**/__tests__/`.

**Modified**
- `src/composables/usePlannerCase.ts` — `CaseFile` + `emptyCase()` additions (`property.parcelFid?`, `dueDiligence.zoningAssessment?`), and the `Permission` type import.
- `src/views/planner/Step2DueDiligence.vue` — mount the card + `onApplyZoning` handler.

**Unchanged (consumed only)**
- Backend `/development-control` routes, `development_matrix`, zone tables — read-only via HTTP. No backend files touched.

## 11. Open questions

None blocking. The one dependency — whether `proposed_peri_urban_zones` + `development_matrix` are populated for the Vungu stands being assessed — is handled by graceful degradation and validated in the live walkthrough; it does not change this frontend design.
