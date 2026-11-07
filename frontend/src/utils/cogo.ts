// COGO (coordinate geometry) for Zimbabwe cadastral work.
//
// Conventions (match the backend /api/surveyor/compute/* and the Gauss
// Conform south-oriented Lo system used across the surveyor module):
//   - P(Y,X): Y = westing, X = southing, metres.
//   - Bearings are SOUTH azimuths: 0° = South, increasing clockwise
//     (90° = West). Forward computation in this frame is
//     Y2 = Y1 + d·sin(t), X2 = X1 + d·cos(t) — identical in form to the
//     familiar north-azimuth/NE formula, so all classic COGO identities
//     carry over unchanged.
//
// Everything here is pure and synchronous so the field tools stay usable
// when the backend is unreachable; the server-side equivalents remain the
// authority for anything persisted.

export interface PointYX {
  y: number
  x: number
}

export interface JoinResult {
  /** South azimuth, decimal degrees in [0, 360). */
  bearingDeg: number
  /** Slope-free horizontal distance, metres. */
  distance: number
}

const TWO_PI = Math.PI * 2

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI
}
function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Normalize any angle in degrees into [0, 360). */
export function normalizeDeg(deg: number): number {
  const d = deg % 360
  return d < 0 ? d + 360 : d
}

// ── Join (inverse) ────────────────────────────────────────────────────
/** Bearing and distance from one station to another. */
export function joinYX(from: PointYX, to: PointYX): JoinResult {
  const dY = to.y - from.y
  const dX = to.x - from.x
  const distance = Math.hypot(dY, dX)
  let az = Math.atan2(dY, dX)
  if (az < 0) az += TWO_PI
  return { bearingDeg: toDeg(az), distance }
}

// ── Polar (forward) ───────────────────────────────────────────────────
/** Station computed from a setup point plus bearing and distance. */
export function polarYX(from: PointYX, bearingDeg: number, distance: number): PointYX {
  const t = toRad(bearingDeg)
  return {
    y: from.y + distance * Math.sin(t),
    x: from.x + distance * Math.cos(t),
  }
}

// ── DMS parsing / formatting ──────────────────────────────────────────
/**
 * Parse a bearing written in degrees-minutes-seconds into decimal degrees.
 * Accepts 123°45'30", 123 45 30, 123.4530 (D.MMSS is NOT assumed — a bare
 * decimal is taken at face value), 123°45.5', negative values.
 * Returns NaN for garbage rather than throwing (form-input friendly).
 */
export function dmsToDeg(input: string): number {
  const s = input.trim()
  if (!s) return NaN
  // Bare decimal number → already decimal degrees.
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return parseFloat(s)
  const m = s.match(
    /^([+-])?\s*(\d+(?:\.\d+)?)\s*(?:°|d|\s)\s*(?:(\d+(?:\.\d+)?)\s*(?:'|m|\s))?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|s)?)?\s*$/i,
  )
  if (!m) return NaN
  const sign = m[1] === '-' ? -1 : 1
  const deg = parseFloat(m[2])
  const min = m[3] !== undefined ? parseFloat(m[3]) : 0
  const sec = m[4] !== undefined ? parseFloat(m[4]) : 0
  if (min >= 60 || sec >= 60) return NaN
  return sign * (deg + min / 60 + sec / 3600)
}

/** Format decimal degrees as D°MM'SS.s" (bearing style, no hemisphere). */
export function degToDms(deg: number, secDecimals = 1): string {
  if (!Number.isFinite(deg)) return '—'
  const sign = deg < 0 ? '-' : ''
  const d = Math.abs(deg)
  let whole = Math.floor(d)
  const minF = (d - whole) * 60
  let min = Math.floor(minF)
  let sec = (minF - min) * 60
  // Guard the 59.95 → 60.0 rollover so we never print 12°34'60.0".
  const factor = 10 ** secDecimals
  sec = Math.round(sec * factor) / factor
  if (sec >= 60) { sec -= 60; min += 1 }
  if (min >= 60) { min -= 60; whole += 1 }
  const mm = String(min).padStart(2, '0')
  const ss = sec.toFixed(secDecimals).padStart(secDecimals > 0 ? 3 + secDecimals : 2, '0')
  return `${sign}${whole}°${mm}'${ss}"`
}

// ── Area / perimeter (shoelace) ───────────────────────────────────────
export interface AreaResult {
  /** Absolute enclosed area, m². */
  areaM2: number
  /** Ring perimeter (closing leg included), metres. */
  perimeterM: number
}

/** Shoelace area + perimeter of a closed figure given ≥3 corners (unclosed ring). */
export function shoelaceAreaYX(points: PointYX[]): AreaResult {
  if (points.length < 3) return { areaM2: 0, perimeterM: 0 }
  let twiceArea = 0
  let perimeter = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    twiceArea += a.y * b.x - b.y * a.x
    perimeter += Math.hypot(b.y - a.y, b.x - a.x)
  }
  return { areaM2: Math.abs(twiceArea) / 2, perimeterM: perimeter }
}

// ── Traverse with Bowditch (compass rule) adjustment ──────────────────
export interface TraverseLeg {
  /** South azimuth, decimal degrees. */
  bearingDeg: number
  /** Horizontal distance, metres. */
  distance: number
}

export interface TraverseStation extends PointYX {
  /** 0 = start point; n = after leg n. */
  index: number
}

export interface TraverseResult {
  /** Raw (unadjusted) coordinates, station 0 = start. */
  stations: TraverseStation[]
  /** Bowditch-adjusted coordinates (same indexing). */
  adjusted: TraverseStation[]
  misclosure: {
    dY: number
    dX: number
    /** Linear misclosure, metres. */
    linear: number
    /** Total traversed distance, metres. */
    totalDistance: number
    /** Precision denominator: totalDistance / linear (Infinity when exact). */
    ratio: number
    /** e.g. "1:15000" or "exact". */
    ratioFormatted: string
  }
}

/**
 * Run a traverse from `start` through `legs`. For a closed loop leave
 * `closeTo` undefined (closure back onto the start point is assumed);
 * for a link traverse pass the known closing station.
 *
 * Bowditch: each station's correction is proportional to the cumulative
 * distance run to that station over the total distance.
 */
export function traverseBowditch(
  start: PointYX,
  legs: TraverseLeg[],
  closeTo?: PointYX,
): TraverseResult {
  const stations: TraverseStation[] = [{ index: 0, y: start.y, x: start.x }]
  const cumulative: number[] = [0]
  let total = 0

  for (let i = 0; i < legs.length; i++) {
    const prev = stations[i]
    const next = polarYX(prev, legs[i].bearingDeg, legs[i].distance)
    total += legs[i].distance
    cumulative.push(total)
    stations.push({ index: i + 1, ...next })
  }

  const target = closeTo ?? start
  const last = stations[stations.length - 1]
  const dY = target.y - last.y
  const dX = target.x - last.x
  let linear = Math.hypot(dY, dX)
  // Below a micron is floating-point residue, not a real misclosure.
  if (linear < 1e-6) linear = 0
  const ratio = linear === 0 ? Infinity : total / linear

  const adjusted: TraverseStation[] = stations.map((s, i) => {
    const f = total === 0 ? 0 : cumulative[i] / total
    return { index: s.index, y: s.y + dY * f, x: s.x + dX * f }
  })

  return {
    stations,
    adjusted,
    misclosure: {
      dY,
      dX,
      linear,
      totalDistance: total,
      ratio,
      ratioFormatted: linear === 0 ? 'exact' : `1:${Math.round(ratio)}`,
    },
  }
}
