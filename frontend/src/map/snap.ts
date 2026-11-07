// src/map/snap.ts
// ---------------------------------------------------------------------------
// Vertex and edge snapping for the GMS editor, applied when a drawing is
// finished. Each vertex moves to the nearest existing vertex within the
// tolerance, or failing that onto the nearest edge. Tolerance is in screen
// pixels, so it means the same thing at every zoom.
//
// Candidates are exact GeoJSON (not tile geometry, which is quantised), so a
// snapped road end lies on the other road to floating-point precision and
// passes the backend's "roads meet at nodes" rule.
// ---------------------------------------------------------------------------

type XY = [number, number]
type Project = (lngLat: XY) => XY
type Unproject = (xy: XY) => XY

function* segments(g: GeoJSON.Geometry): Generator<XY[]> {
  switch (g.type) {
    case 'Point': yield [g.coordinates as XY]; break
    case 'MultiPoint': for (const c of g.coordinates) yield [c as XY]; break
    case 'LineString': yield g.coordinates as XY[]; break
    case 'MultiLineString': case 'Polygon': for (const l of g.coordinates) yield l as XY[]; break
    case 'MultiPolygon': for (const p of g.coordinates) for (const r of p) yield r as XY[]; break
    case 'GeometryCollection': for (const x of g.geometries) yield* segments(x); break
  }
}

const d2 = (a: XY, b: XY) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2

/** Closest point to p on segment ab, all in screen space; t is the ratio along ab. */
function onSegment(p: XY, a: XY, b: XY): { pt: XY; t: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0
  return { pt: [a[0] + t * dx, a[1] + t * dy], t }
}

/** Snap one coordinate. Returns it unchanged when nothing is within tolPx. */
export function snapCoord(c: XY, candidates: GeoJSON.Geometry[], project: Project, tolPx: number): XY {
  const p = project(c)
  const tol2 = tolPx * tolPx
  let best: XY | null = null
  let bestD = tol2
  // Vertices first: they win whenever one is in range.
  for (const g of candidates) for (const line of segments(g)) for (const v of line) {
    const d = d2(project(v), p)
    if (d <= bestD && d > 0) { bestD = d; best = v }
  }
  if (best) return best
  let edge: XY | null = null
  for (const g of candidates) for (const line of segments(g)) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    const { t, pt } = onSegment(p, project(a), project(b))
    const d = d2(pt, p)
    if (d <= bestD) {
      bestD = d
      // Interpolate in lon/lat, not by unprojecting pixels: exact on the edge.
      edge = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
    }
  }
  return edge ?? c
}

/** Snap every vertex of a geometry. */
export function snapGeometry(g: GeoJSON.Geometry, candidates: GeoJSON.Geometry[], project: Project, tolPx = 10): GeoJSON.Geometry {
  const s = (c: XY) => snapCoord(c, candidates, project, tolPx)
  switch (g.type) {
    case 'Point': return { ...g, coordinates: s(g.coordinates as XY) }
    case 'LineString': return { ...g, coordinates: (g.coordinates as XY[]).map(s) }
    case 'Polygon': return { ...g, coordinates: (g.coordinates as XY[][]).map((r) => r.map(s)) }
    default: return g
  }
}

export type { Project, Unproject }
