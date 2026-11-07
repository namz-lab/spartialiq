// src/planning/planning-types.ts
// ─────────────────────────────────────────────────────────────────────────
// Domain model for the in-browser land-subdivision planner (a web-friendly,
// basic re-implementation of what a planner does with QGIS + GRASS +
// ParcelFlux). Pure data — no Vue, no MapLibre, no turf — so the algorithm
// modules and the UI can both depend on it.
//
// COORDINATE CONVENTION (read once, applies everywhere):
//   • Every `geom` is GeoJSON in WGS84 lng/lat (EPSG:4326), coordinate order
//     [lng, lat]. This is exactly what MapLibre sources consume, so geometry
//     flows engine → map with no conversion.
//   • All metric quantities (areaSqm, widthM, lengthM …) are real ground
//     metres/m², computed geodesically by turf — NOT planar degrees.
//   • Screen ⇄ geographic conversion (map.project / map.unproject) happens
//     ONLY in the interaction layer (drawing tools). Algorithms never see
//     pixels.
//   • For heavy metric maths (slicing) the algorithms may project to UTM
//     internally, but everything stored here is back in lng/lat.
// ─────────────────────────────────────────────────────────────────────────

import type { Polygon, MultiPolygon, LineString } from 'geojson'
import type { CadDocumentSnapshot } from './cad/cadModel'

export type PlanningStatus = 'draft' | 'proposed' | 'approved'
export type RoadHierarchy = 'arterial' | 'collector' | 'local' | 'access'
export type RoadType = 'street' | 'cul_de_sac' | 'boundary'
export type LotUseType =
  | 'single_residential' | 'duplex' | 'townhouse' | 'mixed_use' | 'open_space'
  // Civic / community land uses (allocated to stands). Zero dwelling units so they
  // never inflate housing yield; counted by area in the facility schedule.
  | 'school' | 'health' | 'community_centre' | 'place_of_worship' | 'commercial' | 'recreation'

/** The parcel selected as the area to plan (e.g. a 600 ha farm). */
export interface PlanningArea {
  id: string
  projectId: string
  name: string
  /** id of the cadastral parcel this was selected from, if any */
  sourceParcelId?: string
  zoning?: string
  geom: Polygon | MultiPolygon
  areaSqm: number
  status: PlanningStatus
  createdAt: string
}

/** A buffer / overlay result that marks land as buildable or excluded. */
export interface ConstraintLayer {
  id: string
  kind: 'river_buffer' | 'road_buffer' | 'slope' | 'floodplain' | 'protected' | 'custom' | 'facility'
  label: string
  /** the non-buildable (or, if buildable=true, the suitable) area */
  geom: Polygon | MultiPolygon
  /** false = exclusion mask (removed from buildable land) */
  buildable: boolean
  /** for kind:'facility' — the reserved facility's use, so it renders/labels and
   *  feeds the facility schedule. The site is excluded (buildable:false) so the
   *  subdivision avoids it ("reserve 1 ha for a school"). */
  facilityUse?: LotUseType
  params?: Record<string, number | string>
}

/** A proposed street centre-line drawn by the planner. */
export interface RoadSegment {
  id: string
  geom: LineString
  type: RoadType
  hierarchy: RoadHierarchy
  /** full reserve width in metres (carriageway + verges) */
  widthM: number
  name?: string
}

/** A developable face bounded by streets / boundary / exclusions. */
export interface Block {
  id: string
  geom: Polygon
  /** roads whose reserve touches this block */
  roadIds: string[]
  areaSqm: number
  /** the block edge chosen as primary frontage, if decided */
  frontageRoadId?: string
  /** how this block is loaded with lots (overrides the global rule) */
  frontageMode?: FrontageMode
}

/** Load lots from one (longest/primary) edge, or from both opposite long edges. */
export type FrontageMode = 'longest' | 'both'

/** A single residential lot derived from a block. */
export interface Lot {
  id: string
  blockId: string
  geom: Polygon
  areaSqm: number
  frontageM: number
  depthM: number
  lotNumber?: string
  isCorner?: boolean
  /** intended use (defaults to single_residential) */
  useType?: LotUseType
  /** dwelling units on this lot (defaults to the use type's standard) */
  unitsPerLot?: number
  status: PlanningStatus
}

/** Park / reserve / un-lotted leftover. */
export interface OpenSpace {
  id: string
  geom: Polygon | MultiPolygon
  areaSqm: number
  kind: 'park' | 'reserve' | 'leftover'
  /**
   * True when the engine deliberately left this as a central reserve inside a
   * deep block (it hit `maxInteriorRowsWithoutOppositeEdge`) rather than packing
   * landlocked interior rows. Distinguishes intentional reserve from leftover.
   */
  interiorReserve?: boolean
  /**
   * True when the planner designated this open space (CAD → engine), as opposed
   * to engine-generated leftover. Designated open space SURVIVES a re-run of
   * blocks/subdivision (and is excluded from it); engine output is rebuilt.
   */
  designated?: boolean
}

/** Per-block ParcelFlux-style subdivision rules. */
export interface SubdivisionRules {
  minWidthM: number
  maxWidthM: number
  targetWidthM: number
  minDepthM: number
  maxDepthM: number
  minAreaSqm: number
  targetAreaSqm?: number
  /** single or double row of lots back-to-back */
  rows: 1 | 2
  /** 0..1 — how much lot widths may vary from target */
  widthVariation: number
  /** which block edge to front onto (defaults to the longest edge) */
  frontageRoadId?: string
  /** extra width allowance for corner lots, metres */
  cornerWidenM?: number
  /** load from the longest edge (default) or from both opposite long edges */
  frontageMode?: FrontageMode

  // ── Smart auto-fill (engine v2) policy parameters ──────────────────────────
  // All optional with documented defaults so existing callers are unaffected.
  // These are planning-policy knobs, NOT magic numbers — tune them as zoning or
  // typical farm geometry changes.
  /** Blocks up to ~shallowDepthFactor·maxDepthM deep are one lot deep → a single
   *  row (no needless centre cut). Default 1.3. */
  shallowDepthFactor?: number
  /** Interior blocks with an opposite street up to ~dualFrontageDepthFactor·maxDepthM
   *  deep load both sides → two back-to-back rows so every lot fronts a street.
   *  Default 2.0. */
  dualFrontageDepthFactor?: number
  /** CPU/UX guard on interior rows tiled per band (not arbitrary). Default 8. */
  maxRows?: number
  /** A 'longest' block with no opposite street packs at most this many rows; the
   *  remaining depth becomes a tagged central reserve instead of landlocked rows.
   *  Default 4. */
  maxInteriorRowsWithoutOppositeEdge?: number
  /** Walk-distance-to-street accessibility policy (metres), kept distinct from lot
   *  depth; drives the interior-access validation check. Default = maxDepthM. */
  maxInteriorDistanceFromRoad?: number
  /** Deterministic jitter seed (string or number) → reproducible, tunable layouts.
   *  Default 'vungu'. */
  seed?: string | number
  /** Which subdivision engine to use for this design: 1 = legacy shallow band,
   *  2 = smart auto-fill (default). Resolved via resolveEngineVersion(). */
  engineVersion?: 1 | 2
}

export const DEFAULT_RULES: SubdivisionRules = {
  minWidthM: 12,
  maxWidthM: 25,
  targetWidthM: 18,
  minDepthM: 20,
  maxDepthM: 35,
  minAreaSqm: 250,
  targetAreaSqm: 600,
  rows: 2,
  widthVariation: 0.15,
  cornerWidenM: 3,
  frontageMode: 'longest',
  // Engine-v2 policy defaults (see field comments above for rationale).
  shallowDepthFactor: 1.3,
  dualFrontageDepthFactor: 2.0,
  maxRows: 8,
  maxInteriorRowsWithoutOppositeEdge: 4,
  // maxInteriorDistanceFromRoad defaults to maxDepthM at use-site if unset.
  seed: 'vungu',
}

/** Roll-up numbers shown on the Metrics tab. */
export interface PlanningMetrics {
  lotCount: number
  totalLotAreaSqm: number
  avgLotAreaSqm: number
  roadLengthM: number
  openSpaceSqm: number
  openSpacePct: number
  /** lots per hectare of planning area */
  grossDensityPerHa: number
  /** developable land = planning area − exclusions − open space (hectares) */
  netDevelopableAreaHa: number
  /** lots per net developable hectare */
  netDensityPerHa: number
  /** lot area as % of planning area */
  efficiencyPct: number
  /** dwelling units across all non-open-space lots */
  totalUnits: number
  /** units per net developable hectare */
  unitsPerHa: number
  /** units broken down by lot use type */
  yieldByUseType: Record<string, number>
  /** lot area (m²) grouped by use type — drives the facility schedule */
  areaByUseType: Record<string, number>
  /** parking required by the standard (totalUnits × spaces/unit) */
  requiredParkingSpaces: number
  /** parking assumed provided (geometry-based count is a later phase) */
  providedParkingSpaces: number
}

/** One standards check, with the offending geometry it refers to. */
export interface ValidationCheck {
  key: string
  label: string
  pass: boolean
  detail: string
  lotIds?: string[]
  blockIds?: string[]
  roadIds?: string[]
}
export interface ValidationResult {
  zone: ZoneStandard
  pass: boolean
  checks: ValidationCheck[]
}

/**
 * The whole editable design for one planning area.
 *
 * SNAPSHOT CONTRACT (persisted to spatial_planning.planning_project.data jsonb):
 * the fields below are the stable on-disk contract — lots (geom, id, useType,
 * areaSqm, frontageM, depthM, status), roads (geom, id, type, hierarchy, widthM),
 * constraints, the full `rules` (incl. the engine-v2 params + seed), `zone`, and
 * `subdivisionEngineVersion`. Because everything rides inside the jsonb column,
 * adding optional fields needs NO DB migration; removing/renaming any field above
 * DOES (treat them as a versioned contract). A reloaded project missing
 * `subdivisionEngineVersion` is backfilled as version 1.
 */
export interface PlanningProject {
  id: string
  name: string
  planningArea: PlanningArea
  roads: RoadSegment[]
  constraints: ConstraintLayer[]
  blocks: Block[]
  lots: Lot[]
  openSpace: OpenSpace[]
  /** subdivision rules in force when the project was saved */
  rules?: SubdivisionRules
  /** active zoning category key (into StandardsConfig.zones) */
  zone?: string
  /** planning yield target (lots per net developable hectare) */
  targetDensityPerHa?: number
  /** which subdivision engine produced this layout (missing ⇒ legacy v1) */
  subdivisionEngineVersion?: number
  /** CAD drafting document (lines/stands/annotations drawn in the Studio) */
  cad?: CadDocumentSnapshot

  // ── Project Model (V1: formalize; dashboard/versioning/approval UI is V3) ──
  // A parcel may carry many projects; these fields model a project that lives for
  // years. All optional so existing saved snapshots keep loading.
  /** lifecycle state of the proposal */
  status?: 'draft' | 'in_review' | 'approved' | 'rejected'
  /** users.id of the owning planning officer */
  ownerId?: string
  /** monotonically increasing revision number */
  revision?: number
  /** cadastral parcel this project is for: "<layer>/<fid>" */
  parcelReference?: string
  /** free-form governance metadata (authority, client, application no./date,
   *  scheme, drawing no./scale, CRS…) — kept loose until V3 needs columns. */
  meta?: Record<string, string | number>
  updatedAt: string
}

// ── Planning standards (P2-light) ───────────────────────────────────────────
/** Statutory minimums for one zoning category. */
export interface ZoneStandard {
  zone: string
  label: string
  minLotAreaSqm: number
  minFrontageM: number
  maxDepthM: number
  minOpenSpacePct: number
  /** planning yield target for this zone (lots per net developable hectare) */
  targetDensityPerHa: number
  /** building-line setbacks (metres) for the building envelope */
  frontSetbackM: number
  sideSetbackM: number
  rearSetbackM: number
  /** corner-lot overrides (a corner lot has a street on its side too) */
  cornerFrontSetbackM?: number
  cornerSideSetbackM?: number
  /** cul-de-sac limits */
  maxCulDeSacLengthM: number
  maxCulDeSacLots: number
  /** parking provision */
  parkingSpacesPerUnit: number
}

/** Typical yield + minimum size per lot use type. */
export interface UseStandard {
  use: LotUseType
  label: string
  minLotAreaSqm: number
  defaultUnitsPerLot: number
  /** optional per-use parking override (else the zone value is used) */
  parkingSpacesPerUnit?: number
}

/** Council-wide planning standards. Hard-coded defaults now; backend later. */
export interface StandardsConfig {
  /** road reserve width (m) by hierarchy */
  roadReserveByHierarchy: Record<RoadHierarchy, number>
  zones: Record<string, ZoneStandard>
  /** yield + min-size standards per lot use type */
  uses: Record<LotUseType, UseStandard>
  defaultZone: string
}

export const DEFAULT_STANDARDS: StandardsConfig = {
  roadReserveByHierarchy: { arterial: 30, collector: 20, local: 12, access: 8 },
  defaultZone: 'residential_medium',
  zones: {
    residential_high:   { zone: 'residential_high',   label: 'Residential — high density',   minLotAreaSqm: 200, minFrontageM: 8,  maxDepthM: 30, minOpenSpacePct: 10, targetDensityPerHa: 40, frontSetbackM: 4.5, sideSetbackM: 1.5, rearSetbackM: 3, cornerFrontSetbackM: 4.5, cornerSideSetbackM: 3,   maxCulDeSacLengthM: 150, maxCulDeSacLots: 25, parkingSpacesPerUnit: 1 },
    residential_medium: { zone: 'residential_medium', label: 'Residential — medium density', minLotAreaSqm: 300, minFrontageM: 12, maxDepthM: 35, minOpenSpacePct: 10, targetDensityPerHa: 22, frontSetbackM: 6,   sideSetbackM: 2,   rearSetbackM: 3, cornerFrontSetbackM: 6,   cornerSideSetbackM: 4.5, maxCulDeSacLengthM: 180, maxCulDeSacLots: 22, parkingSpacesPerUnit: 1.5 },
    residential_low:    { zone: 'residential_low',    label: 'Residential — low density',    minLotAreaSqm: 800, minFrontageM: 20, maxDepthM: 50, minOpenSpacePct: 15, targetDensityPerHa: 9,  frontSetbackM: 7.5, sideSetbackM: 3,   rearSetbackM: 6, cornerFrontSetbackM: 7.5, cornerSideSetbackM: 6,   maxCulDeSacLengthM: 200, maxCulDeSacLots: 20, parkingSpacesPerUnit: 2 },
  },
  uses: {
    single_residential: { use: 'single_residential', label: 'Single residential', minLotAreaSqm: 300, defaultUnitsPerLot: 1 },
    duplex:             { use: 'duplex',             label: 'Duplex',             minLotAreaSqm: 450, defaultUnitsPerLot: 2 },
    townhouse:          { use: 'townhouse',          label: 'Townhouse',          minLotAreaSqm: 800, defaultUnitsPerLot: 6, parkingSpacesPerUnit: 1 },
    mixed_use:          { use: 'mixed_use',          label: 'Mixed use',          minLotAreaSqm: 600, defaultUnitsPerLot: 4 },
    open_space:         { use: 'open_space',         label: 'Open space',         minLotAreaSqm: 0,   defaultUnitsPerLot: 0 },
    // Civic / community facilities — 0 dwelling units (excluded from housing yield),
    // sized by typical site minimums for a peri-urban layout.
    school:             { use: 'school',             label: 'School',             minLotAreaSqm: 4000, defaultUnitsPerLot: 0 },
    health:             { use: 'health',             label: 'Clinic / health',    minLotAreaSqm: 2000, defaultUnitsPerLot: 0 },
    community_centre:   { use: 'community_centre',   label: 'Community centre',   minLotAreaSqm: 1500, defaultUnitsPerLot: 0 },
    place_of_worship:   { use: 'place_of_worship',   label: 'Place of worship',   minLotAreaSqm: 1500, defaultUnitsPerLot: 0 },
    commercial:         { use: 'commercial',         label: 'Commercial / market', minLotAreaSqm: 800, defaultUnitsPerLot: 0 },
    recreation:         { use: 'recreation',         label: 'Park / recreation',  minLotAreaSqm: 2000, defaultUnitsPerLot: 0 },
  },
}

/** Active tool in the planning workspace. */
export type PlanningTool =
  | 'idle'
  | 'select-parcel'
  | 'draw-road'
  | 'constraint'
  | 'edit-lot'
  | 'split-lot'
  | 'merge-lots'
