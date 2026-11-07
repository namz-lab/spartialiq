// src/planning/usePlanningTools.ts
// ─────────────────────────────────────────────────────────────────────────
// The planning-session composable: holds all reactive design state (planning
// area, roads, constraints, blocks, lots, open space, rules), runs the
// algorithms, computes metrics, exposes ready-to-use GeoJSON for MapLibre
// sources, and persists via planningApi. MapLibre-agnostic — the view binds
// `layers` to sources and calls the action functions; no map handle needed
// here. Mirrors the existing composable style (usePlannerShell/usePlannerCase).
// ─────────────────────────────────────────────────────────────────────────

import { ref, reactive, computed, watch } from 'vue'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Feature, Polygon, MultiPolygon, LineString } from 'geojson'
import {
  type PlanningArea, type RoadSegment, type Block, type Lot, type OpenSpace,
  type ConstraintLayer, type SubdivisionRules, type PlanningMetrics,
  type PlanningTool, type PlanningProject, type StandardsConfig,
  type ValidationResult, type ValidationCheck, type LotUseType,
  DEFAULT_RULES, DEFAULT_STANDARDS,
} from './planning-types'
import { generateBlocks, flattenPolys } from './block-generation'
import { subdivideBlock, SUBDIVISION_ENGINE_DEFAULT } from './subdivision'
import { bufferConstraint } from './constraint-tools'
import { buildingEnvelope } from './setbacks'
import { gridRoads, spineRoad, ringRoad, facilitySquareInside } from './road-templates'
import { planningApi } from '@/services/api'

export type RoadTemplateKind = 'grid' | 'spine' | 'ring' | 'perimeter'
export interface NeighbourhoodOptions {
  /** zoning category to plan to (defaults to the active zone) */
  zone?: string
  /** road grid spacing in metres (defaults to ~2 lot-depths + a road, from the zone) */
  spacingM?: number
  /** add a collector spine down the long axis before the local grid */
  spine?: boolean
  /** civic facilities to reserve before subdivision (e.g. ['school']) */
  facilities?: LotUseType[]
  /** clear any existing roads first (default true) */
  clearRoads?: boolean
}

/** Result of importDxf() — the QGIS/AutoCAD round-trip's reconciliation summary. */
export interface DxfImportSummary {
  ok: boolean
  reason?: 'no-area' | 'empty'
  matched: number
  added: number
  removed: number
  roadCount: number
  roadsAdded?: number
}

let uid = 0
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(uid++).toString(36)}`

export function usePlanningTools() {
  const tool = ref<PlanningTool>('idle')
  const projectId = ref(newId('proj'))
  const projectName = ref('Untitled subdivision')
  const planningArea = ref<PlanningArea | null>(null)
  const roads = ref<RoadSegment[]>([])
  const constraints = ref<ConstraintLayer[]>([])
  const blocks = ref<Block[]>([])
  const lots = ref<Lot[]>([])
  const openSpace = ref<OpenSpace[]>([])
  const rules = reactive<SubdivisionRules>({ ...DEFAULT_RULES })
  const busy = ref(false)
  const roadsVisible = ref(true)                  // toggles the pl-road map layer
  const mergeSelection = ref<string[]>([])        // lot ids picked for merging

  // Planning standards (hard-coded defaults now; structured for a backend later).
  const standards = reactive<StandardsConfig>(JSON.parse(JSON.stringify(DEFAULT_STANDARDS)))
  const activeZone = ref<string>(standards.defaultZone)
  const targetDensityPerHa = ref<number>(standards.zones[standards.defaultZone].targetDensityPerHa)
  const showEnvelopes = ref(false)               // compute + show building envelopes
  const colourByUse = ref(false)                 // colour the lots layer by use type

  // Subdivision engine versioning. `loadedEngineVersion` = the version that produced
  // a loaded project's lots (missing ⇒ legacy v1), used only to surface the "this
  // layout will re-run on engine vN" note. `pinnedEngineVersion` pins a re-run to a
  // specific engine — set only when a project was deliberately saved as v1 (rollback);
  // a merely-old (missing-version) project re-runs on the current default engine.
  const loadedEngineVersion = ref<number | undefined>(undefined)
  const pinnedEngineVersion = ref<1 | 2 | undefined>(undefined)
  // Optimistic-lock base: the server revision this session loaded (0 = new project).
  // Sent on save; updated to the server's new revision on success. Undo/redo never
  // touches it — the server revision is independent of in-memory history.
  const baseRevision = ref<number>(0)
  // CAD drafting document snapshot, kept in sync by the Studio so Save/Export and
  // the revision history include the drawing. Loaded back from p.cad.
  const cadSnapshot = ref<any>(undefined)

  // Unsaved-changes flag (for the autosave hint). `loading` suppresses dirty
  // while a project is being loaded from the backend.
  const dirty = ref(false)
  let loading = false
  const markDirty = () => { if (!loading) dirty.value = true }

  /** Adopt a zoning category: drive the default subdivision rules from it. */
  function applyZone(zoneKey: string) {
    const z = standards.zones[zoneKey]
    if (!z) return
    activeZone.value = zoneKey
    rules.minAreaSqm = z.minLotAreaSqm
    rules.minWidthM = z.minFrontageM
    rules.maxDepthM = z.maxDepthM
    rules.targetAreaSqm = Math.round(z.minLotAreaSqm * 1.4)
    targetDensityPerHa.value = z.targetDensityPerHa
    markDirty()
  }
  function setTargetDensity(n: number) { targetDensityPerHa.value = Math.max(0, n) ; markDirty() }

  // ── Step 1: pick the planning parcel ──────────────────────────────────────
  function selectParcel(feature: Feature, name?: string) {
    const geom = feature.geometry as Polygon | MultiPolygon
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) return false
    const props = (feature.properties || {}) as any
    planningArea.value = {
      id: newId('pa'),
      projectId: projectId.value,
      name: name || props.name || 'Planning area',
      sourceParcelId: props.id != null ? String(props.id) : undefined,
      zoning: props.zoning,
      geom,
      areaSqm: Math.round(turf.area(feature as any)),
      status: 'draft',
      createdAt: new Date().toISOString(),
    }
    // Adopt zone standards if the parcel carries a recognised zoning category.
    applyZone(props.zoning && standards.zones[props.zoning] ? String(props.zoning) : standards.defaultZone)
    // reset the derived design
    roads.value = []; blocks.value = []; lots.value = []; openSpace.value = []
    return true
  }

  // ── Streets ───────────────────────────────────────────────────────────────
  function addRoad(geom: LineString, attrs: Partial<RoadSegment> = {}) {
    const hierarchy = attrs.hierarchy || 'local'
    const r: RoadSegment = {
      id: newId('rd'),
      geom,
      type: attrs.type || 'street',
      hierarchy,
      // reserve width from the standards table for this hierarchy (override allowed)
      widthM: attrs.widthM ?? (standards.roadReserveByHierarchy[hierarchy] ?? 12),
      name: attrs.name,
    }
    roads.value.push(r)
    return r
  }
  function removeRoad(id: string) { roads.value = roads.value.filter(r => r.id !== id) }

  function asRoadHierarchy(v: unknown): RoadSegment['hierarchy'] {
    return (v === 'arterial' || v === 'collector' || v === 'access' || v === 'local') ? v : 'local'
  }
  /** True when an existing centre-line already covers the same two ends (within 2 m). */
  function roadAlreadyPresent(geom: LineString): boolean {
    const cs = geom?.coordinates
    if (!cs || cs.length < 2) return false
    const a = cs[0], b = cs[cs.length - 1]
    const close = (p: number[], q: number[]) => {
      try { return turf.distance(p, q, { units: 'meters' }) < 2 } catch { return false }
    }
    return roads.value.some((r) => {
      const rc = r.geom?.coordinates
      if (!rc || rc.length < 2) return false
      const ra = rc[0], rb = rc[rc.length - 1]
      return (close(a, ra) && close(b, rb)) || (close(a, rb) && close(b, ra))
    })
  }

  // ── Road templates (grid / spine / loop / perimeter) ───────────────────────
  /** Generate a road template across the planning area and add the centre-lines.
   *  Returns the number of road segments added. */
  function generateRoadTemplate(kind: RoadTemplateKind, opts: { spacingM?: number; insetM?: number; hierarchy?: RoadSegment['hierarchy'] } = {}): number {
    if (!planningArea.value) return 0
    const area = turf.feature(planningArea.value.geom) as any
    let lines: LineString[] = []
    if (kind === 'grid')           lines = gridRoads(area, opts.spacingM ?? 150)
    else if (kind === 'spine')   { const s = spineRoad(area); if (s) lines = [s] }
    else if (kind === 'ring')      lines = ringRoad(area, opts.insetM ?? 20)
    else if (kind === 'perimeter') lines = ringRoad(area, opts.insetM ?? 8)
    const hierarchy = opts.hierarchy ?? (kind === 'spine' ? 'collector' : 'local')
    const type: RoadSegment['type'] = 'street'
    for (const g of lines) addRoad(g, { hierarchy, type })
    return lines.length
  }

  // ── One-click "Generate Neighbourhood" ─────────────────────────────────────
  /**
   * Produce a complete first-draft neighbourhood from the planning area: optional
   * civic facility reserve → optional collector spine → local street grid (spacing
   * derived from the zone so blocks are ~two lot-depths) → blocks → stands. Open
   * space falls out as engine leftover (counts toward the open-space %); the
   * largest leftover is promoted to a designated park so there is a real reserve.
   * Everything is a normal design edit — fully re-runnable and undoable.
   */
  function generateNeighbourhood(opts: NeighbourhoodOptions = {}) {
    if (!planningArea.value) return
    busy.value = true
    try {
      if (opts.zone) applyZone(opts.zone)
      if (opts.clearRoads !== false) roads.value = []

      const z = standards.zones[activeZone.value] || standards.zones[standards.defaultZone]
      // Block depth ≈ two lot-depths (back-to-back rows); add a road reserve so the
      // grid pitch leaves room for the carriageway between blocks.
      const spacing = opts.spacingM ?? Math.round(z.maxDepthM * 2 + (standards.roadReserveByHierarchy.local || 12))

      // Reserve civic facilities BEFORE blocks so the subdivision flows around them.
      for (const use of (opts.facilities || [])) {
        const minArea = standards.uses[use]?.minLotAreaSqm || 2000
        const geom = facilitySquareInside(turf.feature(planningArea.value.geom) as any, minArea)
        if (geom) addFacilityReserve(geom, use)
      }

      if (opts.spine) generateRoadTemplate('spine', { hierarchy: 'collector' })
      generateRoadTemplate('grid', { spacingM: spacing, hierarchy: 'local' })

      runBlocks()
      runSubdivision()

      // Promote the single largest engine leftover to a designated park so the plan
      // has a clear, surviving open-space reserve (it already counted by area).
      const leftovers = openSpace.value.filter(o => !o.designated && o.areaSqm > 0)
      if (leftovers.length) {
        const biggest = leftovers.reduce((a, b) => (b.areaSqm > a.areaSqm ? b : a))
        biggest.kind = 'park'
        biggest.designated = true
        openSpace.value = [...openSpace.value]
      }
      renumberLots()
    } finally { busy.value = false }
  }

  // ── Constraints (buffer / exclusion) ──────────────────────────────────────
  function addBufferConstraint(features: Feature[], distanceM: number, kind: ConstraintLayer['kind'], label: string) {
    const c = bufferConstraint(features, distanceM, { kind, label })
    if (c) constraints.value.push(c)
    return c
  }
  function removeConstraint(id: string) { constraints.value = constraints.value.filter(c => c.id !== id) }

  // ── Designation inputs (CAD → engine bridge: clean single source, no `as any`) ─
  /** Reserve a closed shape as a non-buildable facility site the subdivision avoids. */
  function addFacilityReserve(geom: Polygon | MultiPolygon, use: LotUseType, label?: string): ConstraintLayer {
    const c: ConstraintLayer = {
      id: newId('fac'),
      kind: 'facility',
      label: label || standards.uses[use]?.label || 'Reserve',
      geom,
      buildable: false,
      facilityUse: use,
    }
    constraints.value.push(c)
    return c
  }
  /** Add a closed shape as open space / park / reserve (counts toward open-space %). */
  function addOpenSpace(geom: Polygon | MultiPolygon, kind: OpenSpace['kind'] = 'park'): OpenSpace {
    const o: OpenSpace = {
      id: newId('os'),
      geom,
      areaSqm: Math.round(turf.area(turf.feature(geom as any) as any)),
      kind,
      designated: true,   // planner-placed → survives & is excluded from re-runs
    }
    openSpace.value.push(o)
    return o
  }

  /** Transient exclusions so generated blocks flow AROUND planner-placed stands /
   *  open space (manual lots live in the synthetic 'manual' block). */
  function designationExclusions(): ConstraintLayer[] {
    const ex: ConstraintLayer[] = []
    for (const l of lots.value) if (l.blockId === 'manual')
      ex.push({ id: `mx-${l.id}`, kind: 'custom', label: 'stand', geom: l.geom, buildable: false })
    for (const o of openSpace.value) if (o.designated)
      ex.push({ id: `ox-${o.id}`, kind: 'custom', label: 'open space', geom: o.geom, buildable: false })
    return ex
  }
  /** Add a drawn polygon as a manual stand/lot (optionally a civic use). Sits in a
   *  synthetic 'manual' block — it is NOT re-subdivided, unlike engine-generated lots. */
  function addManualLot(geom: Polygon, opts: { useType?: LotUseType; status?: Lot['status'] } = {}): Lot {
    const lot = makeLotFromPolygon(turf.feature(geom as any), 'manual', opts.status || 'draft')
    if (opts.useType) {
      lot.useType = opts.useType
      lot.unitsPerLot = useStandardFor(opts.useType).defaultUnitsPerLot
    }
    lots.value.push(lot)
    renumberLots()
    return lot
  }

  // ── Step 3: blocks ────────────────────────────────────────────────────────
  function runBlocks() {
    if (!planningArea.value) return
    busy.value = true
    try {
      blocks.value = generateBlocks(
        turf.feature(planningArea.value.geom) as any,
        roads.value,
        [...constraints.value, ...designationExclusions()],
      )
      // Clear ONLY engine-generated output; keep planner-designated stands/open space.
      lots.value = lots.value.filter(l => l.blockId === 'manual')
      openSpace.value = openSpace.value.filter(o => o.designated)
    } finally { busy.value = false }
  }

  // ── Step 4: subdivision ───────────────────────────────────────────────────
  function runSubdivision() {
    if (!blocks.value.length) runBlocks()
    busy.value = true
    try {
      const allLots: Lot[] = []
      const allOS: OpenSpace[] = []
      const runRules = { ...rules, engineVersion: pinnedEngineVersion.value }
      for (const b of blocks.value) {
        const r = subdivideBlock(b, runRules, { frontageLine: resolveFrontageLine(b) })
        allLots.push(...r.lots); allOS.push(...r.openSpace)
      }
      // This run produced lots on the engine that resolveEngineVersion picked.
      loadedEngineVersion.value = pinnedEngineVersion.value ?? SUBDIVISION_ENGINE_DEFAULT
      // Keep planner-designated stands/open space; append the generated output.
      const manual = lots.value.filter(l => l.blockId === 'manual')
      const designatedOS = openSpace.value.filter(o => o.designated)
      const merged = [...manual, ...allLots]
      merged.forEach((l, i) => (l.lotNumber = String(i + 1)))
      lots.value = merged
      openSpace.value = [...designatedOS, ...allOS]
    } finally { busy.value = false }
  }

  /** Re-run a single block (e.g. after the planner tweaks its rules). */
  function subdivideOne(blockId: string, override?: Partial<SubdivisionRules>) {
    const b = blocks.value.find(x => x.id === blockId)
    if (!b) return
    if (override?.frontageMode) b.frontageMode = override.frontageMode   // persist per-block choice
    const r = subdivideBlock(b, { ...rules, engineVersion: pinnedEngineVersion.value, ...override }, { frontageLine: resolveFrontageLine(b) })
    lots.value = [...lots.value.filter(l => l.blockId !== blockId), ...r.lots]
    openSpace.value = [...openSpace.value, ...r.openSpace]
    lots.value.forEach((l, i) => (l.lotNumber = String(i + 1)))
  }

  function deleteLot(id: string) { lots.value = lots.value.filter(l => l.id !== id) }

  // ── Lot use types ─────────────────────────────────────────────────────────
  function useStandardFor(use: LotUseType) { return standards.uses[use] || standards.uses.single_residential }
  function assignUseToLots(ids: string[], use: LotUseType) {
    const us = useStandardFor(use)
    const set = new Set(ids)
    lots.value = lots.value.map(l => set.has(l.id) ? { ...l, useType: use, unitsPerLot: us.defaultUnitsPerLot } : l)
  }
  function assignUseToAll(use: LotUseType) { assignUseToLots(lots.value.map(l => l.id), use) }

  /** Road centre-line to treat as a block's primary frontage (if set). */
  function resolveFrontageLine(b: Block) {
    if (!b.frontageRoadId) return undefined
    return roads.value.find(r => r.id === b.frontageRoadId)?.geom
  }

  // ── Manual lot editing ────────────────────────────────────────────────────
  function polyDims(poly: any): { frontage: number; depth: number } {
    const bb = turf.bbox(poly) // [minX, minY, maxX, maxY]
    const w = turf.distance([bb[0], bb[1]], [bb[2], bb[1]], { units: 'meters' })
    const h = turf.distance([bb[0], bb[1]], [bb[0], bb[3]], { units: 'meters' })
    return { frontage: Math.round(Math.min(w, h) * 10) / 10, depth: Math.round(Math.max(w, h) * 10) / 10 }
  }
  function makeLotFromPolygon(poly: any, blockId: string, status: Lot['status'] = 'draft'): Lot {
    const dims = polyDims(poly)
    return {
      id: newId('lot'), blockId, geom: poly.geometry, areaSqm: Math.round(turf.area(poly)),
      frontageM: dims.frontage, depthM: dims.depth, status,
    }
  }

  /** Split one lot with a cut line (2+ points). Returns true on success. */
  function splitLot(lotId: string, cutLineGeom: LineString): boolean {
    const idx = lots.value.findIndex(l => l.id === lotId)
    if (idx < 0) return false
    const lot = lots.value[idx]
    try {
      const poly = turf.polygon((lot.geom as any).coordinates)
      const ribbon = turf.buffer(turf.feature(cutLineGeom as any), 0.25, { units: 'meters' })
      if (!ribbon) return false
      const diff = turf.difference(poly as any, ribbon as any)
      if (!diff) return false
      const pieces = flattenPolys(diff).filter(p => turf.area(p) > 1)
      if (pieces.length < 2) return false               // line did not cross the lot
      const newLots = pieces.map(p => makeLotFromPolygon(p, lot.blockId, lot.status))
      lots.value.splice(idx, 1, ...newLots)
      renumberLots()
      return true
    } catch { return false }
  }

  /** Merge 2+ ADJACENT lots into one. Returns false if they are not contiguous. */
  function mergeLots(lotIds: string[]): boolean {
    const sel = lots.value.filter(l => lotIds.includes(l.id))
    if (sel.length < 2) return false
    try {
      let acc: any = turf.polygon((sel[0].geom as any).coordinates)
      for (let i = 1; i < sel.length; i++) {
        acc = turf.union(acc, turf.polygon((sel[i].geom as any).coordinates) as any) || acc
      }
      if (!acc || acc.geometry.type !== 'Polygon') return false   // non-adjacent → MultiPolygon
      const merged = makeLotFromPolygon(turf.polygon(acc.geometry.coordinates), sel[0].blockId, sel[0].status)
      const drop = new Set(lotIds)
      lots.value = [...lots.value.filter(l => !drop.has(l.id)), merged]
      renumberLots()
      return true
    } catch { return false }
  }

  /** Sequential renumber. Per block by default (1…N); flat with optional prefix. */
  function renumberLots(opts?: { prefix?: string; perBlock?: boolean }) {
    const perBlock = opts?.perBlock !== false
    const prefix = opts?.prefix ?? ''
    if (perBlock) {
      const counters: Record<string, number> = {}
      for (const l of lots.value) {
        counters[l.blockId] = (counters[l.blockId] || 0) + 1
        l.lotNumber = `${prefix}${counters[l.blockId]}`
      }
    } else {
      lots.value.forEach((l, i) => { l.lotNumber = `${prefix}${i + 1}` })
    }
    lots.value = [...lots.value]   // nudge reactivity after mutating items
  }

  // ── Merge selection (driven by ctrl-click on the map / the panel) ─────────
  function toggleMergeSelection(id: string) {
    mergeSelection.value = mergeSelection.value.includes(id)
      ? mergeSelection.value.filter(x => x !== id)
      : [...mergeSelection.value, id]
  }
  function clearMergeSelection() { mergeSelection.value = [] }
  function mergeSelected(): boolean {
    const ok = mergeLots(mergeSelection.value)
    if (ok) clearMergeSelection()
    return ok
  }

  // ── Summaries for the Streets & Blocks tab ────────────────────────────────
  const roadSummaries = computed(() => roads.value.map(r => ({
    id: r.id, hierarchy: r.hierarchy, type: r.type, widthM: r.widthM,
    lengthM: Math.round(turf.length(turf.feature(r.geom) as any, { units: 'meters' })),
  })))
  const blockSummaries = computed(() => blocks.value.map(b => ({
    id: b.id, areaSqm: b.areaSqm,
    lotCount: lots.value.filter(l => l.blockId === b.id).length,
  })))

  // ── Metrics ───────────────────────────────────────────────────────────────
  const metrics = computed<PlanningMetrics>(() => {
    const totalLot = lots.value.reduce((s, l) => s + l.areaSqm, 0)
    const os = openSpace.value.reduce((s, o) => s + o.areaSqm, 0)
    const roadLen = roads.value.reduce((s, r) => s + turf.length(turf.feature(r.geom) as any, { units: 'meters' }), 0)
    const pa = planningArea.value?.areaSqm || 0
    // exclusion (non-buildable) constraint area
    const consSqm = constraints.value.filter(c => !c.buildable).reduce((s, c) => {
      try { return s + turf.area(turf.feature(c.geom) as any) } catch { return s }
    }, 0)
    // net developable = planning area − exclusions − open space
    const netSqm = Math.max(0, pa - os - consSqm)
    const netHa = netSqm / 10000
    // dwelling units + yield by use type + parking demand
    const zoneStd = standards.zones[activeZone.value] || standards.zones[standards.defaultZone]
    let totalUnits = 0
    const yieldByUseType: Record<string, number> = {}
    const areaByUseType: Record<string, number> = {}
    for (const l of lots.value) {
      const use = l.useType || 'single_residential'
      // Area schedule covers every use (incl. civic facilities + open space).
      areaByUseType[use] = (areaByUseType[use] || 0) + l.areaSqm
      if (use === 'open_space') continue
      const us = standards.uses[use] || standards.uses.single_residential
      const units = l.unitsPerLot ?? us.defaultUnitsPerLot
      totalUnits += units
      yieldByUseType[use] = (yieldByUseType[use] || 0) + units
    }
    const requiredParkingSpaces = Math.ceil(totalUnits * (zoneStd.parkingSpacesPerUnit || 1))
    return {
      lotCount: lots.value.length,
      totalLotAreaSqm: Math.round(totalLot),
      avgLotAreaSqm: lots.value.length ? Math.round(totalLot / lots.value.length) : 0,
      roadLengthM: Math.round(roadLen),
      openSpaceSqm: Math.round(os),
      openSpacePct: pa ? Math.round((os / pa) * 1000) / 10 : 0,
      grossDensityPerHa: pa ? Math.round((lots.value.length / (pa / 10000)) * 10) / 10 : 0,
      netDevelopableAreaHa: Math.round(netHa * 100) / 100,
      netDensityPerHa: netHa > 0 ? Math.round((lots.value.length / netHa) * 10) / 10 : 0,
      efficiencyPct: pa ? Math.round((totalLot / pa) * 1000) / 10 : 0,
      totalUnits,
      unitsPerHa: netHa > 0 ? Math.round((totalUnits / netHa) * 10) / 10 : 0,
      yieldByUseType,
      areaByUseType,
      requiredParkingSpaces,
      providedParkingSpaces: requiredParkingSpaces,   // assumption until parking geometry exists
    }
  })

  // ── Building envelopes (only computed when the planner asks — can be heavy) ─
  const envelopeData = computed(() => {
    if (!showEnvelopes.value || !lots.value.length) return { features: [] as any[], lotsNoEnvelope: [] as string[], cornerLots: [] as string[] }
    const z = standards.zones[activeZone.value] || standards.zones[standards.defaultZone]
    const s = {
      front: z.frontSetbackM, side: z.sideSetbackM, rear: z.rearSetbackM,
      cornerFront: z.cornerFrontSetbackM, cornerSide: z.cornerSideSetbackM,
    }
    const features: any[] = []
    const none: string[] = []
    const cornerLots: string[] = []
    for (const l of lots.value) {
      const r = buildingEnvelope(l.geom as any, roads.value, s)
      if (r.corner) cornerLots.push(l.id)
      if (r.geom) features.push({ type: 'Feature', id: `env-${l.id}`, geometry: r.geom, properties: { lotId: l.id, corner: r.corner } })
      else none.push(l.id)
    }
    return { features, lotsNoEnvelope: none, cornerLots }
  })

  // ── Cul-de-sac detection (approximate, from the road endpoint graph) ───────
  function lotNearestRoad(lotGeom: any): string | null {
    let best: string | null = null, bestD = Infinity
    try {
      const c = turf.centroid(turf.polygon(lotGeom.coordinates))
      for (const r of roads.value) {
        try { const d = turf.pointToLineDistance(c, turf.feature(r.geom) as any, { units: 'meters' }); if (d < bestD) { bestD = d; best = r.id } } catch { /* skip */ }
      }
    } catch { /* skip */ }
    return best
  }
  const culDeSacs = computed(() => {
    const rs = roads.value
    const out: { roadId: string; lengthM: number; lotCount: number }[] = []
    if (!rs.length) return out
    const key = (c: number[]) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`
    const deg: Record<string, number> = {}
    for (const r of rs) {
      const cs = (r.geom as any).coordinates
      if (!cs || cs.length < 2) continue
      deg[key(cs[0])] = (deg[key(cs[0])] || 0) + 1
      deg[key(cs[cs.length - 1])] = (deg[key(cs[cs.length - 1])] || 0) + 1
    }
    // lots fronting each road (nearest road to lot centroid)
    const lotCountByRoad: Record<string, number> = {}
    for (const l of lots.value) { const rid = lotNearestRoad(l.geom); if (rid) lotCountByRoad[rid] = (lotCountByRoad[rid] || 0) + 1 }
    for (const r of rs) {
      const cs = (r.geom as any).coordinates
      if (!cs || cs.length < 2) continue
      const dA = deg[key(cs[0])] || 0, dB = deg[key(cs[cs.length - 1])] || 0
      if (dA === 1 || dB === 1) {   // at least one free (dead) end ⇒ cul-de-sac
        out.push({
          roadId: r.id,
          lengthM: Math.round(turf.length(turf.feature(r.geom) as any, { units: 'meters' })),
          lotCount: lotCountByRoad[r.id] || 0,
        })
      }
    }
    return out
  })

  // ── Standards compliance (Validation panel) ───────────────────────────────
  const validation = computed<ValidationResult>(() => {
    const z = standards.zones[activeZone.value] || standards.zones[standards.defaultZone]
    const lotsWord = (n: number, word = 'below') =>
      n ? `${n} lot(s) ${word}` : (lots.value.length ? 'all lots comply' : 'no lots yet')

    const underArea = lots.value.filter(l => l.areaSqm < z.minLotAreaSqm)
    const underFront = lots.value.filter(l => l.frontageM < z.minFrontageM)
    const tooDeep = lots.value.filter(l => l.depthM > z.maxDepthM)
    const blocksNoFront = blocks.value.filter(b => !b.roadIds || b.roadIds.length === 0)
    const noFrontSet = new Set(blocksNoFront.map(b => b.id))
    const lotsNoAccess = lots.value.filter(l => noFrontSet.has(l.blockId))
    const reserveBad = roads.value.filter(r => r.widthM < (standards.roadReserveByHierarchy[r.hierarchy] ?? 0))
    const osPct = metrics.value.openSpacePct

    const checks: ValidationCheck[] = [
      { key: 'minArea', label: `Min lot area ≥ ${z.minLotAreaSqm} m²`, pass: underArea.length === 0, detail: lotsWord(underArea.length), lotIds: underArea.map(l => l.id) },
      { key: 'minFront', label: `Min frontage ≥ ${z.minFrontageM} m`, pass: underFront.length === 0, detail: lotsWord(underFront.length), lotIds: underFront.map(l => l.id) },
      { key: 'maxDepth', label: `Max depth ≤ ${z.maxDepthM} m`, pass: tooDeep.length === 0, detail: lotsWord(tooDeep.length, 'too deep'), lotIds: tooDeep.map(l => l.id) },
      { key: 'blockFront', label: 'Blocks have road frontage', pass: blocksNoFront.length === 0, detail: blocksNoFront.length ? `${blocksNoFront.length} block(s) without a road` : (blocks.value.length ? 'all blocks comply' : 'no blocks yet'), blockIds: blocksNoFront.map(b => b.id) },
      { key: 'lotAccess', label: 'Lots have road access', pass: lotsNoAccess.length === 0, detail: lotsNoAccess.length ? `${lotsNoAccess.length} lot(s) without access` : (lots.value.length ? 'all lots comply' : 'no lots yet'), lotIds: lotsNoAccess.map(l => l.id) },
      { key: 'openSpace', label: `Open space ≥ ${z.minOpenSpacePct}%`, pass: osPct >= z.minOpenSpacePct, detail: `${osPct}% provided` },
      { key: 'reserves', label: 'Road reserves meet standard', pass: reserveBad.length === 0, detail: reserveBad.length ? `${reserveBad.length} road(s) too narrow` : (roads.value.length ? 'all roads comply' : 'no roads yet') },
      showEnvelopes.value
        ? { key: 'envelope', label: 'Lots have a buildable envelope', pass: envelopeData.value.lotsNoEnvelope.length === 0, detail: envelopeData.value.lotsNoEnvelope.length ? `${envelopeData.value.lotsNoEnvelope.length} lot(s) too small for setbacks` : (lots.value.length ? 'all lots comply' : 'no lots yet'), lotIds: envelopeData.value.lotsNoEnvelope }
        : { key: 'envelope', label: 'Buildable envelope', pass: true, detail: 'enable “Show building envelopes” to check' },
    ]

    // Cul-de-sac limits.
    const cds = culDeSacs.value
    const cdLong = cds.filter(c => c.lengthM > z.maxCulDeSacLengthM)
    const cdLots = cds.filter(c => c.lotCount > z.maxCulDeSacLots)
    checks.push(
      { key: 'cdsLength', label: `Cul-de-sac length ≤ ${z.maxCulDeSacLengthM} m`, pass: cdLong.length === 0, detail: cdLong.length ? `${cdLong.length} over length` : (cds.length ? 'all comply' : 'none detected'), roadIds: cdLong.map(c => c.roadId) },
      { key: 'cdsLots', label: `Cul-de-sac lots ≤ ${z.maxCulDeSacLots}`, pass: cdLots.length === 0, detail: cdLots.length ? `${cdLots.length} over lot count` : (cds.length ? 'all comply' : 'none detected'), roadIds: cdLots.map(c => c.roadId) },
    )

    // Lot use vs minimum size for that use.
    const useMismatch = lots.value.filter(l => {
      const use = l.useType || 'single_residential'
      if (use === 'open_space') return false
      const us = standards.uses[use]
      return us && l.areaSqm < us.minLotAreaSqm
    })
    checks.push({ key: 'useSize', label: 'Lots meet their use min area', pass: useMismatch.length === 0, detail: useMismatch.length ? `${useMismatch.length} undersized for use` : (lots.value.length ? 'all comply' : 'no lots yet'), lotIds: useMismatch.map(l => l.id) })

    // Parking sufficiency (provided is assumed = required until parking geometry exists).
    const req = metrics.value.requiredParkingSpaces
    const prov = metrics.value.providedParkingSpaces
    checks.push({ key: 'parking', label: 'Parking sufficiency', pass: prov >= req, detail: `${prov}/${req} spaces (assumed)` })

    // Interior access (engine v2): lots whose centroid sits further than the walk-
    // distance policy from any street. Surfaces the deep-block compromise (interior
    // rows / reserves) so planners know where a manual internal street is needed.
    const walkMax = rules.maxInteriorDistanceFromRoad ?? z.maxDepthM
    const farLots = roads.value.length
      ? lots.value.filter(l => {
          try {
            const c = turf.centroid(turf.polygon((l.geom as any).coordinates))
            let best = Infinity
            for (const r of roads.value) {
              try { const d = turf.pointToLineDistance(c, turf.feature(r.geom) as any, { units: 'meters' }); if (d < best) best = d } catch { /* skip */ }
            }
            return best > walkMax
          } catch { return false }
        })
      : []
    checks.push({
      key: 'interiorAccess',
      label: `Lots within ${Math.round(walkMax)} m of a street`,
      pass: farLots.length === 0,
      detail: !roads.value.length
        ? 'no roads yet'
        : (farLots.length ? `${farLots.length} lot(s) far from any street — add an internal street` : 'all lots comply'),
      lotIds: farLots.map(l => l.id),
    })

    return { zone: z, checks, pass: checks.every(c => c.pass) }
  })

  // Headline compliance score (0–100). A passing check earns its weight; weight
  // grows with the number of features it affects, so a failure touching many stands
  // hurts the score more than one touching a single stand. This is the number the
  // planner watches move as they fix the layout.
  const complianceScore = computed(() => {
    const checks = validation.value.checks
    if (!checks.length) return { pct: 0, passed: 0, total: 0 }
    let num = 0, den = 0
    for (const c of checks) {
      const affected = (c.lotIds?.length || 0) + (c.blockIds?.length || 0) + (c.roadIds?.length || 0)
      const w = 1 + affected
      den += w
      if (c.pass) num += w
    }
    return { pct: Math.round((num / den) * 100), passed: checks.filter(c => c.pass).length, total: checks.length }
  })

  // Dirty tracking: any change to the design marks the project unsaved.
  // flush:'sync' so loads (loading=true) are suppressed deterministically.
  watch([roads, constraints, rules, planningArea, activeZone, targetDensityPerHa],
    () => markDirty(), { deep: true, flush: 'sync' })
  watch([() => lots.value, () => blocks.value, () => openSpace.value],
    () => markDirty(), { flush: 'sync' })

  // ── GeoJSON for MapLibre sources ──────────────────────────────────────────
  function fc<T extends { id: string; geom: any }>(items: T[], props?: (t: T) => Record<string, unknown>) {
    return {
      type: 'FeatureCollection' as const,
      features: items.map(i => ({
        type: 'Feature' as const,
        id: i.id,
        geometry: i.geom,
        properties: { id: i.id, ...(props ? props(i) : {}) },
      })),
    }
  }
  const layers = computed(() => ({
    planningArea: planningArea.value
      ? fc([planningArea.value], a => ({ name: a.name, areaSqm: a.areaSqm }))
      : { type: 'FeatureCollection' as const, features: [] },
    constraints: fc(constraints.value, c => ({ kind: c.kind, label: c.label, buildable: c.buildable })),
    roads: fc(roads.value, r => ({ hierarchy: r.hierarchy, widthM: r.widthM, type: r.type, name: r.name || '' })),
    blocks: fc(blocks.value, b => ({ areaSqm: b.areaSqm })),
    openSpace: fc(openSpace.value, o => ({ kind: o.kind, areaSqm: o.areaSqm })),
    lots: fc(lots.value, l => ({ lotNumber: l.lotNumber, areaSqm: l.areaSqm, isCorner: !!l.isCorner, status: l.status, useType: l.useType || 'single_residential', unitsPerLot: l.unitsPerLot ?? 1 })),
    envelopes: { type: 'FeatureCollection' as const, features: envelopeData.value.features },
  }))

  // ── Persistence (PostGIS via planningApi) ─────────────────────────────────
  function snapshot(): PlanningProject {
    return {
      id: projectId.value,
      name: projectName.value,
      planningArea: planningArea.value as PlanningArea,
      roads: roads.value,
      constraints: constraints.value,
      blocks: blocks.value,
      lots: lots.value,
      openSpace: openSpace.value,
      rules: { ...rules },
      zone: activeZone.value,
      targetDensityPerHa: targetDensityPerHa.value,
      // Stamp the engine that produced these lots: a pinned v1 stays 1 (rollback),
      // otherwise the current default. Old projects (no field) load back as v1.
      subdivisionEngineVersion: pinnedEngineVersion.value ?? loadedEngineVersion.value ?? SUBDIVISION_ENGINE_DEFAULT,
      cad: cadSnapshot.value,
      updatedAt: new Date().toISOString(),
    }
  }
  /** Persist a revision. `extra` marks a statutory submission: status 'submitted'
   *  + permitAppId link the revision to the permit case and audit it server-side. */
  async function save(extra?: { status?: 'draft' | 'submitted'; permitAppId?: string }) {
    if (!planningArea.value) return { ok: false as const, reason: 'no-area' as const }
    busy.value = true
    try {
      // Send the optimistic-lock base; the server bumps + returns the new revision.
      const res = await planningApi.saveProject({
        ...snapshot(),
        baseRevision: baseRevision.value,
        metrics: { roadLengthM: metrics.value.roadLengthM },
        ...extra,
      })
      const summary = res?.data?.data
      const rev = summary?.revision
      if (typeof rev === 'number') baseRevision.value = rev
      dirty.value = false
      return { ok: true as const, revision: rev as number | undefined, summary }
    } catch (e: any) {
      // 409 → someone saved a newer revision since we loaded. Never overwrite.
      if (e?.response?.status === 409) {
        return { ok: false as const, reason: 'conflict' as const, currentRevision: e.response?.data?.currentRevision as number | undefined }
      }
      return { ok: false as const, reason: 'network' as const }
    } finally { busy.value = false }
  }
  /**
   * Merge a parsed DXF into the live session. Lots that match by lotId (or a
   * unique lotNumber) take the incoming geometry and keep use/status; new
   * polygons are added as manual lots; existing lots that are not in the file
   * are kept (import adds to the map, it does not wipe the current design).
   * Road centre-lines are appended with the hierarchy recovered from the DXF
   * layer (arterial / collector / local / access) and the matching reserve
   * width from the standards table. Near-duplicate centre-lines are skipped
   * so a second import of the same file does not double the street network.
   */
  function importDxf(fc: { features: Array<{ properties?: any; geometry: any }> }, opts?: { dropMissingLots?: boolean }): DxfImportSummary {
    if (!planningArea.value) return { ok: false, reason: 'no-area', matched: 0, added: 0, removed: 0, roadCount: roads.value.length }
    const feats = fc?.features || []
    if (!feats.length) return { ok: false, reason: 'empty', matched: 0, added: 0, removed: 0, roadCount: roads.value.length }

    const importedLots = feats.filter(f => f.properties?.layer === 'LOTS')
    const importedRoads = feats.filter(f => f.properties?.layer === 'ROADS' || f.properties?.hierarchy)

    const prevById = new Map(lots.value.map(l => [l.id, l] as const))
    const numberCounts = new Map<string, number>()
    for (const l of lots.value) if (l.lotNumber) numberCounts.set(l.lotNumber, (numberCounts.get(l.lotNumber) || 0) + 1)
    const prevByNumber = new Map<string, Lot>()
    for (const l of lots.value) if (l.lotNumber && numberCounts.get(l.lotNumber) === 1) prevByNumber.set(l.lotNumber, l)

    const matchedIds = new Set<string>()
    let added = 0
    const incoming: Lot[] = importedLots.map((f) => {
      const poly = turf.feature(f.geometry as any)
      const lotId = f.properties?.lotId as string | undefined
      const lotNumber = f.properties?.lotNumber as string | undefined
      const byId = lotId ? prevById.get(lotId) : undefined
      const byNumber = (!byId && lotNumber) ? prevByNumber.get(lotNumber) : undefined
      const prev = byId || byNumber
      if (prev && !matchedIds.has(prev.id)) {
        matchedIds.add(prev.id)
        const dims = polyDims(poly)
        return { ...prev, geom: f.geometry, areaSqm: Math.round(turf.area(poly)), frontageM: dims.frontage, depthM: dims.depth }
      }
      added++
      return makeLotFromPolygon(poly, 'manual', 'draft')
    })
    const unmatched = lots.value.filter(l => !matchedIds.has(l.id))
    const kept = opts?.dropMissingLots ? [] : unmatched
    lots.value = [...kept, ...incoming]

    let roadsAdded = 0
    for (const f of importedRoads) {
      const g = f.geometry
      if (!g || (g.type !== 'LineString' && g.type !== 'MultiLineString')) continue
      const parts: LineString[] = g.type === 'LineString'
        ? [g]
        : (g.coordinates as number[][][]).map(c => ({ type: 'LineString' as const, coordinates: c }))
      const hierarchy = asRoadHierarchy(f.properties?.hierarchy)
      for (const lg of parts) {
        if (roadAlreadyPresent(lg)) continue
        addRoad(lg, { hierarchy })
        roadsAdded++
      }
    }
    renumberLots()

    return { ok: true, matched: matchedIds.size, added, removed: opts?.dropMissingLots ? unmatched.length : 0, roadCount: roads.value.length, roadsAdded }
  }

  async function loadProject(id: string) {
    busy.value = true
    loading = true
    try {
      const res = await planningApi.getProject(id)
      const p: PlanningProject = res.data?.data ?? res.data
      if (!p) return false
      projectId.value = p.id
      projectName.value = p.name
      planningArea.value = p.planningArea
      roads.value = p.roads || []
      constraints.value = p.constraints || []
      blocks.value = p.blocks || []
      lots.value = p.lots || []
      openSpace.value = p.openSpace || []
      if (p.rules) Object.assign(rules, p.rules)
      // Engine version: missing ⇒ legacy v1 (backfill-on-read), shown via the panel
      // note. Only an explicit stored v1 PINS a re-run to v1 (deliberate rollback);
      // a merely-old project re-runs on the current default engine and upgrades.
      loadedEngineVersion.value = p.subdivisionEngineVersion ?? 1
      pinnedEngineVersion.value = p.subdivisionEngineVersion === 1 ? 1 : undefined
      baseRevision.value = typeof p.revision === 'number' ? p.revision : 0
      cadSnapshot.value = p.cad
      if (p.zone && standards.zones[p.zone]) activeZone.value = p.zone
      if (typeof p.targetDensityPerHa === 'number') targetDensityPerHa.value = p.targetDensityPerHa
      else targetDensityPerHa.value = standards.zones[activeZone.value]?.targetDensityPerHa ?? targetDensityPerHa.value
      dirty.value = false
      return true
    } catch { return false }
    finally { busy.value = false; loading = false }
  }

  function clearDesign() {
    roads.value = []; constraints.value = []
    blocks.value = []; lots.value = []; openSpace.value = []
  }

  /**
   * Restore design state from an in-memory snapshot (undo/redo). Sibling of
   * loadProject but with no network — deep-clones so the history entry stays
   * immutable. `loading` suppresses the dirty watcher during the swap.
   */
  function restore(snap: PlanningProject) {
    loading = true
    try {
      const p: PlanningProject = JSON.parse(JSON.stringify(snap))
      projectId.value = p.id
      projectName.value = p.name
      planningArea.value = p.planningArea
      roads.value = p.roads || []
      constraints.value = p.constraints || []
      blocks.value = p.blocks || []
      lots.value = p.lots || []
      openSpace.value = p.openSpace || []
      if (p.rules) Object.assign(rules, p.rules)
      if (p.zone && standards.zones[p.zone]) activeZone.value = p.zone
      if (typeof p.targetDensityPerHa === 'number') targetDensityPerHa.value = p.targetDensityPerHa
      loadedEngineVersion.value = p.subdivisionEngineVersion ?? 1
      pinnedEngineVersion.value = p.subdivisionEngineVersion === 1 ? 1 : undefined
    } finally { loading = false }
  }

  return {
    // state
    tool, projectId, projectName, planningArea, roads, constraints,
    blocks, lots, openSpace, rules, busy, roadsVisible, mergeSelection,
    standards, activeZone, targetDensityPerHa, dirty, showEnvelopes, colourByUse,
    loadedEngineVersion, currentEngineVersion: SUBDIVISION_ENGINE_DEFAULT, baseRevision, cadSnapshot,
    // derived
    metrics, layers, roadSummaries, blockSummaries, validation, complianceScore, envelopeData, culDeSacs,
    // actions
    selectParcel, addRoad, removeRoad, addBufferConstraint, removeConstraint,
    addFacilityReserve, addOpenSpace, addManualLot,
    generateRoadTemplate, generateNeighbourhood,
    runBlocks, runSubdivision, subdivideOne, deleteLot,
    splitLot, mergeLots, renumberLots, toggleMergeSelection, clearMergeSelection, mergeSelected,
    assignUseToLots, assignUseToAll, useStandardFor,
    applyZone, setTargetDensity,
    snapshot, save, loadProject, restore, clearDesign, importDxf,
  }
}

export type PlanningToolsApi = ReturnType<typeof usePlanningTools>
