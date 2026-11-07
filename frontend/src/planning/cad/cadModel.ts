// src/planning/cad/cadModel.ts
// ─────────────────────────────────────────────────────────────────────────
// CAD document model for the Planning Studio (CAD-1). Pure data — no Vue, no
// turf — so the geometry kernel, the reactive document, and the UI can all depend
// on it. Geometry is stored in lng/lat (georeferenced → Export to Map round-trips);
// editing math runs in a local metre frame (see cadGeometry.ts).
// ─────────────────────────────────────────────────────────────────────────
import type { Geometry } from 'geojson'

export type CadEntityType =
  | 'line' | 'polyline' | 'polygon' | 'rectangle' | 'circle' | 'arc'
  | 'text' | 'dimension' | 'hatch' | 'symbol'

export type CadLineType = 'solid' | 'dashed' | 'dotted'

export interface CadStyle {
  /** stroke/fill colour (hex). Falls back to the layer colour when unset. */
  color?: string
  /** line weight in px (screen) */
  weight?: number
  lineType?: CadLineType
  /** fill opacity for polygon/hatch (0..1) */
  fillOpacity?: number
}

/** How a dimension measures the span between its two anchors. */
export type DimMode = 'aligned' | 'horizontal' | 'vertical'

/**
 * One end of a dimension.  When `entityId` + `gripPath` are set the anchor is
 * ASSOCIATIVE — it tracks that entity's vertex live, so editing the geometry (or
 * dragging its grip) re-measures the dimension automatically.  `lngLat` alone is
 * a fixed anchor (and doubles as a fallback if the referenced vertex is gone).
 */
export interface DimAnchor {
  lngLat?: [number, number]
  entityId?: string
  gripPath?: number[]
}

/** Dimension definition stored on a `type:'dimension'` entity (in `dim`). */
export interface DimensionSpec {
  a: DimAnchor
  b: DimAnchor
  /** signed perpendicular offset (metres) of the dimension line from the span. */
  offsetM: number
  mode: DimMode
}

/**
 * Symbol/block placement stored on a `type:'symbol'` entity (in `symbol`). The
 * insertion point is the entity geom (a Point); the symbol is expanded live into
 * scale-true geometry at render time (see cadSymbols.ts). `sizeM` is the symbol's
 * nominal ground size in metres; `rotationDeg` is clockwise from north.
 */
export interface SymbolSpec {
  symbolId: string
  sizeM: number
  rotationDeg: number
}

/** Hatch pattern kind (for `type:'hatch'` entities — land-use fills). */
export type HatchPattern = 'solid' | 'lines' | 'cross' | 'dots'

/**
 * Hatch fill stored on a `type:'hatch'` entity (in `hatch`). The boundary is the
 * entity geom (a Polygon); the pattern is generated live at render time
 * (see cadHatch.ts) so it stays scale-true. `spacingM`/`angleDeg` are ground
 * metres/degrees; `landuse` is an optional tag for the plot legend.
 */
export interface HatchSpec {
  pattern: HatchPattern
  angleDeg: number
  spacingM: number
  color: string
  landuse?: string
}

export interface CadEntity {
  id: string
  type: CadEntityType
  /** geometry in WGS84 lng/lat */
  geom: Geometry
  layerId: string
  style?: CadStyle
  locked?: boolean
  visible?: boolean
  /** for text/dimension entities */
  text?: string
  /** dimension definition (for `type:'dimension'` entities) */
  dim?: DimensionSpec
  /** symbol/block placement (for `type:'symbol'` entities) */
  symbol?: SymbolSpec
  /** hatch fill (for `type:'hatch'` entities) */
  hatch?: HatchSpec
  meta?: Record<string, unknown>
}

export interface CadLayer {
  id: string
  name: string
  color: string
  visible: boolean
  locked: boolean
}

/** Serializable document state (persisted inside the PlanningProject snapshot). */
export interface CadDocumentSnapshot {
  entities: CadEntity[]
  layers: CadLayer[]
}

export const DEFAULT_CAD_LAYERS: CadLayer[] = [
  { id: 'roads-arterial', name: 'Arterial', color: '#7f1d1d', visible: true, locked: false },
  { id: 'roads-collector', name: 'Collector', color: '#b91c1c', visible: true, locked: false },
  { id: 'roads', name: 'Local street', color: '#1f2933', visible: true, locked: false },
  { id: 'roads-access', name: 'Access', color: '#78716c', visible: true, locked: false },
  { id: 'stands', name: 'Stands', color: '#1a73e8', visible: true, locked: false },
  { id: 'facilities', name: 'Facilities', color: '#f59e0b', visible: true, locked: false },
  { id: 'annotation', name: 'Annotation', color: '#65727f', visible: true, locked: false },
]
