// src/planning/cad/useCadDocument.ts
// ─────────────────────────────────────────────────────────────────────────
// Reactive CAD document for the Planning Studio (CAD-1). Holds entities + layers
// + selection, exposes the AutoCAD-style edit ops (move/copy/rotate/scale/mirror/
// array/offset/delete + layer & property edits), keeps a snapshot undo/redo stack,
// and emits a GeoJSON FeatureCollection for MapLibre rendering. Geometry math is
// delegated to the metre-frame kernel (cadGeometry.ts) so edits are survey-accurate.
// ─────────────────────────────────────────────────────────────────────────
import { ref, computed } from 'vue'
import type { Geometry, Position, FeatureCollection } from 'geojson'
import {
  type CadEntity, type CadLayer, type CadStyle, type CadDocumentSnapshot, type CadEntityType,
  DEFAULT_CAD_LAYERS,
} from './cadModel'
import {
  frameForGeom, translate, rotate, scale, mirror, offsetLine, lengthM, areaM2,
} from './cadGeometry'
import {
  polygonOffset, trimLine, extendLine, chamferPolyline, filletPolyline,
} from './cadGeometry2'
import { stretchGeom } from './cadGrips'
import { computeDimension, resolveAnchor } from './cadDimension'
import { expandSymbol, SYMBOL_LIBRARY } from './cadSymbols'
import { generateHatch } from './cadHatch'
import { joinLineStrings, explodeToSegments } from './cadJoin'
import type { DimAnchor, DimMode, SymbolSpec, HatchSpec } from './cadModel'

let uid = 0
const newId = (p = 'ent') => `${p}-${Date.now().toString(36)}-${(uid++).toString(36)}`
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

export function useCadDocument() {
  const entities = ref<CadEntity[]>([])
  const layers = ref<CadLayer[]>(clone(DEFAULT_CAD_LAYERS))
  const selection = ref<string[]>([])

  // ── undo/redo (snapshot stack) ──────────────────────────────────────────
  const past: CadDocumentSnapshot[] = []
  const future: CadDocumentSnapshot[] = []
  function take(): CadDocumentSnapshot { return { entities: clone(entities.value), layers: clone(layers.value) } }
  function commit() { past.push(take()); if (past.length > 100) past.shift(); future.length = 0 }
  const canUndo = computed(() => past.length > 0)
  const canRedo = computed(() => future.length > 0)
  function apply(s: CadDocumentSnapshot) { entities.value = clone(s.entities); layers.value = clone(s.layers) }
  function undo() { if (!past.length) return; future.push(take()); apply(past.pop()!) }
  function redo() { if (!future.length) return; past.push(take()); apply(future.pop()!) }

  // ── selection ───────────────────────────────────────────────────────────
  function select(ids: string[]) { selection.value = [...ids] }
  function toggleSelect(id: string) {
    selection.value = selection.value.includes(id)
      ? selection.value.filter(x => x !== id) : [...selection.value, id]
  }
  function clearSelection() { selection.value = [] }
  const selectedEntities = computed(() => entities.value.filter(e => selection.value.includes(e.id)))

  function byId(id: string) { return entities.value.find(e => e.id === id) }
  function targets(ids?: string[]): CadEntity[] {
    const set = new Set(ids && ids.length ? ids : selection.value)
    return entities.value.filter(e => set.has(e.id) && !e.locked)
  }
  function frameFromTargets(list: CadEntity[]) {
    return list.length ? frameForGeom(list[0].geom) : frameForGeom({ type: 'Point', coordinates: [29.82, -19.48] } as Geometry)
  }

  // ── create / delete ───────────────────────────────────────────────────────
  function addEntity(type: CadEntityType, geom: Geometry, opts: Partial<CadEntity> = {}): CadEntity {
    commit()
    const e: CadEntity = {
      id: newId(type), type, geom, layerId: opts.layerId || layers.value[0]?.id || 'roads',
      style: opts.style, locked: false, visible: true, text: opts.text, meta: opts.meta,
    }
    entities.value = [...entities.value, e]
    return e
  }
  /** Batch insert (one undo step) — used by DXF import of CAD linework. */
  function addEntities(items: Array<{ type: CadEntityType; geom: Geometry; layerId?: string; text?: string }>): CadEntity[] {
    if (!items.length) return []
    commit()
    const made: CadEntity[] = items.map((it) => ({
      id: newId(it.type),
      type: it.type,
      geom: it.geom,
      layerId: it.layerId || layers.value[0]?.id || 'roads',
      text: it.text,
      locked: false,
      visible: true,
    }))
    entities.value = [...entities.value, ...made]
    return made
  }
  function deleteEntities(ids?: string[]) {
    const set = new Set(ids && ids.length ? ids : selection.value)
    if (!set.size) return
    commit()
    entities.value = entities.value.filter(e => !set.has(e.id))
    selection.value = selection.value.filter(id => !set.has(id))
  }

  // ── transforms (dx/dy in metres; pivots/axes in lng/lat) ────────────────────
  function mutate(list: CadEntity[], fn: (g: Geometry) => Geometry) {
    const ids = new Set(list.map(e => e.id))
    entities.value = entities.value.map(e => (ids.has(e.id) ? { ...e, geom: fn(e.geom) } : e))
  }
  function move(dx: number, dy: number, ids?: string[]) {
    const list = targets(ids); if (!list.length) return
    commit(); const f = frameFromTargets(list)
    mutate(list, g => translate(g, f, dx, dy))
  }
  function rotateBy(deg: number, pivotLngLat: Position, ids?: string[]) {
    const list = targets(ids); if (!list.length) return
    commit(); const f = frameFromTargets(list)
    mutate(list, g => rotate(g, f, deg, pivotLngLat))
  }
  function scaleBy(k: number, originLngLat: Position, ids?: string[]) {
    const list = targets(ids); if (!list.length || k <= 0) return
    commit(); const f = frameFromTargets(list)
    mutate(list, g => scale(g, f, k, originLngLat))
  }
  /** Copy selection, offset by dx/dy metres; returns the new ids (and selects them). */
  function copy(dx: number, dy: number, ids?: string[]): string[] {
    const list = targets(ids); if (!list.length) return []
    commit(); const f = frameFromTargets(list)
    const made = list.map(e => ({ ...clone(e), id: newId(e.type), geom: translate(e.geom, f, dx, dy) }))
    entities.value = [...entities.value, ...made]
    const newIds = made.map(e => e.id); selection.value = newIds
    return newIds
  }
  /** Linear array: `count` total instances spaced dx/dy metres apart. */
  function array(count: number, dx: number, dy: number, ids?: string[]): string[] {
    const list = targets(ids); if (!list.length || count < 2) return []
    commit(); const f = frameFromTargets(list)
    const made: CadEntity[] = []
    for (let i = 1; i < count; i++) {
      for (const e of list) made.push({ ...clone(e), id: newId(e.type), geom: translate(e.geom, f, dx * i, dy * i) })
    }
    entities.value = [...entities.value, ...made]
    return made.map(e => e.id)
  }
  /** Mirror across a lng/lat axis. keepOriginal=true adds mirrored copies. */
  function mirrorAcross(aLngLat: Position, bLngLat: Position, keepOriginal = true, ids?: string[]): string[] {
    const list = targets(ids); if (!list.length) return []
    commit(); const f = frameFromTargets(list)
    if (keepOriginal) {
      const made = list.map(e => ({ ...clone(e), id: newId(e.type), geom: mirror(e.geom, f, aLngLat, bLngLat) }))
      entities.value = [...entities.value, ...made]
      return made.map(e => e.id)
    }
    mutate(list, g => mirror(g, f, aLngLat, bLngLat))
    return list.map(e => e.id)
  }
  /** Offset a single line/polyline by distM metres into a new entity. */
  function offset(id: string, distM: number): string | null {
    const e = byId(id); if (!e) return null
    const g = offsetLine(e.geom, distM); if (!g) return null
    commit()
    const made: CadEntity = { ...clone(e), id: newId(e.type), geom: g }
    entities.value = [...entities.value, made]
    return made.id
  }

  // ── CAD-2 editing (trim / extend / fillet / chamfer / polygon offset) ──────
  function replaceGeom(id: string, geom: any) {
    commit()
    entities.value = entities.value.map(e => (e.id === id ? { ...e, geom } : e))
  }
  /** New entity = polygon offset/setback of `id` by distM metres (− = inward). */
  function offsetPolygon(id: string, distM: number): string | null {
    const e = byId(id); if (!e) return null
    const g = polygonOffset(e.geom, distM); if (!g) return null
    commit()
    const made: CadEntity = { ...clone(e), id: newId(e.type), geom: g as any }
    entities.value = [...entities.value, made]
    return made.id
  }
  function trim(id: string, cutterId: string, removeLngLat: [number, number]): boolean {
    const e = byId(id), c = byId(cutterId); if (!e || !c) return false
    const g = trimLine(e.geom, c.geom, removeLngLat); if (!g) return false
    replaceGeom(id, g); return true
  }
  function extend(id: string, targetId: string, end: 'start' | 'end'): boolean {
    const e = byId(id), t = byId(targetId); if (!e || !t) return false
    const g = extendLine(e.geom, t.geom, end); if (!g) return false
    replaceGeom(id, g); return true
  }
  function chamfer(id: string, vertexIdx: number, distM: number): boolean {
    const e = byId(id); if (!e) return false
    const g = chamferPolyline(e.geom, vertexIdx, distM); if (!g) return false
    replaceGeom(id, g); return true
  }
  function fillet(id: string, vertexIdx: number, radiusM: number): boolean {
    const e = byId(id); if (!e) return false
    const g = filletPolyline(e.geom, vertexIdx, radiusM); if (!g) return false
    replaceGeom(id, g); return true
  }

  // ── grips / stretch ──────────────────────────────────────────────────────────
  /**
   * Expose the internal commit so grip drag can push the pre-drag snapshot before
   * the first mousemove — giving undo a single clean step back per drag.
   */
  function pushUndo() { commit() }
  /**
   * Move one vertex in-place without touching the undo stack. Call pushUndo() once
   * on drag-start, then previewStretch() on every mousemove, then nothing on
   * mouseup — the committed state is already the final stretched geometry.
   */
  function previewStretch(id: string, gripPath: number[], newLngLat: [number, number]) {
    const e = byId(id); if (!e) return
    const g = stretchGeom(e.geom, gripPath, newLngLat)
    entities.value = entities.value.map(ent => (ent.id === id ? { ...ent, geom: g } : ent))
  }

  // ── dimensions (associative annotations) ──────────────────────────────────────
  /**
   * Add a linear/aligned dimension between two anchors.  Anchors carrying
   * entityId+gripPath are associative (track the vertex); anchors with only a
   * lngLat are fixed.  Stored as a `type:'dimension'` entity; its geom is a Point
   * at the label (rendering uses dimensionsGeoJSON, which resolves anchors live).
   */
  function addDimension(a: DimAnchor, b: DimAnchor, offsetM: number, mode: DimMode = 'aligned'): CadEntity | null {
    const pa = resolveAnchor(a, entities.value)
    const pb = resolveAnchor(b, entities.value)
    if (!pa || !pb) return null
    const dr = computeDimension(pa, pb, offsetM, mode)
    if (!dr) return null
    commit()
    const e: CadEntity = {
      id: newId('dim'), type: 'dimension',
      geom: { type: 'Point', coordinates: dr.textLngLat },
      layerId: 'annotation', text: dr.label, dim: { a, b, offsetM, mode },
      locked: false, visible: true,
    }
    entities.value = [...entities.value, e]
    return e
  }

  // ── annotations: free text + leader (callout) ─────────────────────────────────
  /** Place a free text label at a point. */
  function addText(lngLat: [number, number], text: string, layerId = 'annotation'): CadEntity | null {
    const t = (text || '').trim()
    if (!t) return null
    commit()
    const e: CadEntity = {
      id: newId('text'), type: 'text', geom: { type: 'Point', coordinates: lngLat },
      layerId, text: t, locked: false, visible: true,
    }
    entities.value = [...entities.value, e]
    return e
  }
  /**
   * Leader / callout: a pointer line from `targetLngLat` (the feature) to
   * `textLngLat`, plus a text label at `textLngLat`. Both entities are created in
   * ONE undo step so a single undo removes the whole callout.
   */
  function addLeader(
    targetLngLat: [number, number], textLngLat: [number, number], text: string, layerId = 'annotation',
  ): { line: CadEntity; label: CadEntity } | null {
    const t = (text || '').trim()
    if (!t) return null
    commit()
    const line: CadEntity = {
      id: newId('leader'), type: 'polyline',
      geom: { type: 'LineString', coordinates: [targetLngLat, textLngLat] },
      layerId, style: { color: '#1f2933', weight: 1 }, locked: false, visible: true,
    }
    const label: CadEntity = {
      id: newId('text'), type: 'text', geom: { type: 'Point', coordinates: textLngLat },
      layerId, text: t, locked: false, visible: true,
    }
    entities.value = [...entities.value, line, label]
    return { line, label }
  }

  // ── layers & properties ─────────────────────────────────────────────────
  function setEntityLayer(ids: string[], layerId: string) {
    const set = new Set(ids); commit()
    entities.value = entities.value.map(e => (set.has(e.id) ? { ...e, layerId } : e))
  }
  function setEntityStyle(ids: string[], style: CadStyle) {
    const set = new Set(ids); commit()
    entities.value = entities.value.map(e => (set.has(e.id) ? { ...e, style: { ...e.style, ...style } } : e))
  }
  /** Match Properties: copy layer+style from one entity onto others. */
  function matchProperties(sourceId: string, targetIds: string[]) {
    const src = byId(sourceId); if (!src) return
    const set = new Set(targetIds); commit()
    entities.value = entities.value.map(e => (set.has(e.id) ? { ...e, layerId: src.layerId, style: clone(src.style) } : e))
  }
  function setLayerVisible(layerId: string, visible: boolean) {
    layers.value = layers.value.map(l => (l.id === layerId ? { ...l, visible } : l))
  }
  function setLayerLocked(layerId: string, locked: boolean) {
    layers.value = layers.value.map(l => (l.id === layerId ? { ...l, locked } : l))
  }
  function addLayer(name: string, color = '#65727f'): CadLayer {
    const l: CadLayer = { id: newId('lyr'), name, color, visible: true, locked: false }
    layers.value = [...layers.value, l]; return l
  }

  // ── measurement helpers ───────────────────────────────────────────────────
  function measure(id: string): { lengthM: number; areaM2: number } {
    const e = byId(id); if (!e) return { lengthM: 0, areaM2: 0 }
    return { lengthM: lengthM(e.geom), areaM2: areaM2(e.geom) }
  }

  // ── render + persistence ──────────────────────────────────────────────────
  const toGeoJSON = computed<FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: entities.value
      // dimensions + symbols + hatches render through their own live-expanded overlays, not here
      .filter(e => e.type !== 'dimension' && e.type !== 'symbol' && e.type !== 'hatch' && e.visible !== false && (layers.value.find(l => l.id === e.layerId)?.visible !== false))
      .map(e => {
        const layer = layers.value.find(l => l.id === e.layerId)
        return {
          type: 'Feature' as const, id: e.id, geometry: e.geom,
          properties: {
            id: e.id, type: e.type, layerId: e.layerId, text: e.text || '',
            // resolved render props: entity style wins, else the layer's colour
            color: e.style?.color || layer?.color || '#1a73e8',
            weight: e.style?.weight ?? 1.5,
            fillOpacity: e.style?.fillOpacity ?? 0.12,
            ...(e.style || {}),
          },
        }
      }),
  }))

  // Dimensions resolved against LIVE geometry → associative: when an anchored
  // vertex moves (e.g. a grip Stretch) this recomputes and the dimension follows.
  const dimensionsGeoJSON = computed<FeatureCollection>(() => {
    const feats: any[] = []
    for (const e of entities.value) {
      if (e.type !== 'dimension' || !e.dim) continue
      if (e.visible === false) continue
      if (layers.value.find(l => l.id === e.layerId)?.visible === false) continue
      const pa = resolveAnchor(e.dim.a, entities.value)
      const pb = resolveAnchor(e.dim.b, entities.value)
      if (!pa || !pb) continue
      const dr = computeDimension(pa, pb, e.dim.offsetM, e.dim.mode)
      if (!dr) continue
      const selected = selection.value.includes(e.id)
      for (const path of dr.paths) {
        feats.push({
          type: 'Feature', geometry: { type: 'LineString', coordinates: path },
          properties: { id: e.id, dim: true, selected },
        })
      }
      feats.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: dr.textLngLat },
        properties: { id: e.id, dimLabel: dr.label, angle: dr.textAngleDeg, selected },
      })
    }
    return { type: 'FeatureCollection', features: feats }
  })

  // Symbols expanded live into scale-true geometry (so re-theming / size changes
  // and Export round-trip cleanly). Mirrors the dimensions overlay.
  const symbolsGeoJSON = computed<FeatureCollection>(() => {
    const feats: any[] = []
    for (const e of entities.value) {
      if (e.type !== 'symbol' || !e.symbol) continue
      if (e.visible === false) continue
      if (layers.value.find(l => l.id === e.layerId)?.visible === false) continue
      const insert = (e.geom as any)?.coordinates as [number, number]
      if (!insert) continue
      const selected = selection.value.includes(e.id)
      const colour = e.style?.color || layers.value.find(l => l.id === e.layerId)?.color || '#1f2933'
      for (const part of expandSymbol(e.symbol, insert)) {
        feats.push({
          type: 'Feature', geometry: part.geom,
          properties: { id: e.id, role: part.role, text: part.text || '', color: colour, selected },
        })
      }
    }
    return { type: 'FeatureCollection', features: feats }
  })

  // Hatches expanded live into fill + pattern geometry (scale-true). Mirrors the
  // dimensions/symbols overlays; excluded from the main toGeoJSON.
  const hatchGeoJSON = computed<FeatureCollection>(() => {
    const feats: any[] = []
    for (const e of entities.value) {
      if (e.type !== 'hatch' || !e.hatch) continue
      if (e.visible === false) continue
      if (layers.value.find(l => l.id === e.layerId)?.visible === false) continue
      const selected = selection.value.includes(e.id)
      const col = e.hatch.color || e.style?.color || '#94a3b8'
      const solid = e.hatch.pattern === 'solid'
      // boundary fill: strong for solid, a light tint under a pattern
      feats.push({
        type: 'Feature', geometry: e.geom,
        properties: { id: e.id, role: 'fill', color: col, fillOpacity: solid ? 0.5 : 0.08, selected },
      })
      if (!solid) {
        const hg = generateHatch(e.geom, e.hatch)
        for (const seg of hg.lines) {
          feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: seg }, properties: { id: e.id, role: 'line', color: col, selected } })
        }
        for (const d of hg.dots) {
          feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: d }, properties: { id: e.id, role: 'dot', color: col, selected } })
        }
      }
    }
    return { type: 'FeatureCollection', features: feats }
  })

  /** Fill a closed polygon boundary with a hatch pattern (land-use fill). */
  function addHatch(geom: Geometry, spec: HatchSpec): CadEntity | null {
    if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') return null
    commit()
    const e: CadEntity = {
      id: newId('hatch'), type: 'hatch', geom, layerId: 'annotation',
      hatch: { ...spec }, style: { color: spec.color }, text: spec.landuse,
      locked: false, visible: true,
    }
    entities.value = [...entities.value, e]
    return e
  }

  // ── join / explode ────────────────────────────────────────────────────────────
  const mk = (type: CadEntityType, geom: Geometry, opts: Partial<CadEntity> = {}): CadEntity => ({
    id: newId(type), type, geom, layerId: opts.layerId || 'annotation',
    style: opts.style, text: opts.text, locked: false, visible: true,
  })

  /**
   * Join selected LineString entities into merged polylines where their endpoints
   * meet (within `tolM` metres). Fixes broken polylines. Returns the number of
   * merged polylines produced (0 = nothing connected).
   */
  function joinSelected(tolM = 0.5): number {
    const lineEnts = selectedEntities.value.filter(e => !e.locked && e.geom.type === 'LineString')
    if (lineEnts.length < 2) return 0
    const merged = joinLineStrings(lineEnts.map(e => e.geom as any), tolM)
    if (merged.length >= lineEnts.length) return 0   // nothing actually joined
    commit()
    const drop = new Set(lineEnts.map(e => e.id))
    const layerId = lineEnts[0].layerId, style = lineEnts[0].style
    const added = merged.map(g => mk('polyline', g, { layerId, style }))
    entities.value = [...entities.value.filter(e => !drop.has(e.id)), ...added]
    selection.value = added.map(a => a.id)
    return added.length
  }

  /**
   * Explode selected entities into their primitives: polylines/polygons → segments;
   * symbols/hatches/dimensions → their expanded lines/fills/text. Replaces the
   * originals in one undo step. Returns the number of new entities created.
   */
  function explodeSelected(): number {
    const sel = selectedEntities.value.filter(e => !e.locked)
    if (!sel.length) return 0
    const drop = new Set(sel.map(e => e.id))
    const added: CadEntity[] = []
    for (const e of sel) {
      const col = e.style?.color
      if (e.type === 'symbol' && e.symbol) {
        const insert = (e.geom as any).coordinates as [number, number]
        for (const part of expandSymbol(e.symbol, insert)) {
          if (part.role === 'text') added.push(mk('text', part.geom, { layerId: e.layerId, text: part.text, style: e.style }))
          else added.push(mk(part.geom.type === 'Polygon' ? 'polygon' : 'polyline', part.geom, { layerId: e.layerId, style: { color: e.hatch?.color || e.style?.color, fillOpacity: part.role === 'fill' ? 0.9 : undefined } }))
        }
      } else if (e.type === 'hatch' && e.hatch) {
        added.push(mk('polygon', e.geom, { layerId: e.layerId, style: { color: e.hatch.color } }))
        for (const seg of generateHatch(e.geom, e.hatch).lines)
          added.push(mk('line', { type: 'LineString', coordinates: seg }, { layerId: e.layerId, style: { color: e.hatch.color } }))
      } else if (e.type === 'dimension' && e.dim) {
        const pa = resolveAnchor(e.dim.a, entities.value), pb = resolveAnchor(e.dim.b, entities.value)
        const dr = pa && pb ? computeDimension(pa, pb, e.dim.offsetM, e.dim.mode) : null
        if (dr) {
          for (const path of dr.paths) added.push(mk('line', { type: 'LineString', coordinates: path }, { layerId: e.layerId }))
          added.push(mk('text', { type: 'Point', coordinates: dr.textLngLat }, { layerId: e.layerId, text: dr.label }))
        }
      } else {
        for (const s of explodeToSegments(e.geom)) added.push(mk('line', s, { layerId: e.layerId, style: e.style ? { color: col } : undefined }))
      }
    }
    if (!added.length) return 0
    commit()
    entities.value = [...entities.value.filter(e => !drop.has(e.id)), ...added]
    selection.value = added.map(a => a.id)
    return added.length
  }

  /** Insert a symbol/block at a point (size + rotation default from the library). */
  function addSymbol(symbolId: string, lngLat: [number, number], opts: { sizeM?: number; rotationDeg?: number; layerId?: string } = {}): CadEntity | null {
    const def = SYMBOL_LIBRARY[symbolId]
    if (!def) return null
    commit()
    const spec: SymbolSpec = {
      symbolId,
      sizeM: opts.sizeM && opts.sizeM > 0 ? opts.sizeM : def.defaultSizeM,
      rotationDeg: opts.rotationDeg ?? 0,
    }
    const e: CadEntity = {
      id: newId('sym'), type: 'symbol', geom: { type: 'Point', coordinates: lngLat },
      layerId: opts.layerId || 'annotation', symbol: spec, text: def.name,
      locked: false, visible: true,
    }
    entities.value = [...entities.value, e]
    return e
  }

  function snapshot(): CadDocumentSnapshot { return take() }
  function load(s?: CadDocumentSnapshot | null) {
    entities.value = s?.entities ? clone(s.entities) : []
    const loaded = s?.layers?.length ? clone(s.layers) : clone(DEFAULT_CAD_LAYERS)
    const have = new Set(loaded.map(l => l.id))
    layers.value = [...loaded, ...DEFAULT_CAD_LAYERS.filter(l => !have.has(l.id))]
    selection.value = []; past.length = 0; future.length = 0
  }

  return {
    entities, layers, selection, selectedEntities, canUndo, canRedo,
    select, toggleSelect, clearSelection, byId,
    addEntity, addEntities, deleteEntities,
    move, rotateBy, scaleBy, copy, array, mirrorAcross, offset,
    offsetPolygon, trim, extend, chamfer, fillet,
    pushUndo, previewStretch, addDimension, addText, addLeader, addSymbol, addHatch,
    joinSelected, explodeSelected,
    setEntityLayer, setEntityStyle, matchProperties, setLayerVisible, setLayerLocked, addLayer,
    measure, undo, redo, toGeoJSON, dimensionsGeoJSON, symbolsGeoJSON, hatchGeoJSON, snapshot, load,
  }
}

export type CadDocumentApi = ReturnType<typeof useCadDocument>
