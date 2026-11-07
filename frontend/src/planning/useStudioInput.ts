// src/planning/useStudioInput.ts
// ─────────────────────────────────────────────────────────────────────────
// Precision drafting for the Planning Studio: the difference between a mouse
// sketch and a professional plan. Owns the ORTHO / POLAR / grid-step toggles and
// the pure math for:
//   • dynamic dimensional entry — type an exact length (and optional bearing)
//     to place the next vertex (AutoCAD "@40<90" or "40,90" or just "40"),
//   • direction constraint — snap the live bearing to 90° (ortho) or a polar step,
//   • grid snap — round a point to a metre grid.
// All math is turf on lng/lat (bearings are survey bearings: 0°=N, 90°=E, clockwise)
// so geometry stays georeferenced and Export to Map round-trips exactly.
// ─────────────────────────────────────────────────────────────────────────
import { reactive } from 'vue'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'

export interface DynamicInput { lengthM: number; bearingDeg?: number }

/**
 * Parse a dynamic-input string into a length + optional bearing.
 * Accepts:  "40"  ·  "40,90"  ·  "40 90"  ·  "@40<90"  ·  "40<90"
 * Bearing is a survey bearing in degrees (0=N, 90=E, clockwise). Returns null
 * if there is no positive length.
 */
export function parseDynamic(raw: string): DynamicInput | null {
  if (!raw) return null
  const s = raw.trim().replace(/^@/, '')
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:[,<\s]\s*(-?\d+(?:\.\d+)?))?$/)
  if (!m) return null
  const lengthM = parseFloat(m[1])
  if (!(lengthM > 0)) return null
  const bearingDeg = m[2] != null ? ((parseFloat(m[2]) % 360) + 360) % 360 : undefined
  return { lengthM, bearingDeg }
}

/** Snap `deg` (survey bearing) to the nearest multiple of `stepDeg`. */
export function snapAngle(deg: number, stepDeg: number): number {
  const n = ((deg % 360) + 360) % 360
  return (Math.round(n / stepDeg) * stepDeg) % 360
}

export interface ConstrainOpts { ortho: boolean; polar: boolean; stepDeg: number }

/**
 * Constrain the direction from `from` to `to` to an ortho/polar increment while
 * preserving the distance. Ortho wins if both are on. Returns the adjusted point;
 * when no constraint is active it returns `to` unchanged.
 */
export function constrainBearing(
  from: [number, number], to: [number, number], opts: ConstrainOpts,
): [number, number] {
  const step = opts.ortho ? 90 : opts.polar ? (opts.stepDeg || 15) : 0
  if (!step) return to
  const distM = turf.distance(from, to, { units: 'meters' })
  if (distM < 1e-6) return to
  const brg = snapAngle(turf.bearing(from, to), step)
  return turf.destination(from, distM / 1000, brg, { units: 'kilometers' }).geometry.coordinates as [number, number]
}

/**
 * Resolve the next vertex from typed dynamic input. Bearing is taken from the
 * input if given, else from the (already constrained, if you pass a constrained
 * cursor) `cursor` direction. Length always comes from the input.
 */
export function resolveDynamic(
  from: [number, number], cursor: [number, number], input: DynamicInput,
): [number, number] {
  const brg = input.bearingDeg != null ? input.bearingDeg : turf.bearing(from, cursor)
  return turf.destination(from, input.lengthM / 1000, brg, { units: 'kilometers' }).geometry.coordinates as [number, number]
}

/**
 * Round a point to a `stepM` metre grid, referenced to `ref` (the parcel origin).
 * Local equirectangular around `ref` — accurate to sub-mm over one parcel and far
 * cheaper than a proj4 round-trip per mouse move.
 */
export function gridSnap(
  lngLat: [number, number], ref: [number, number], stepM: number,
): [number, number] {
  if (!(stepM > 0)) return lngLat
  const mPerDegLat = 111_320
  const mPerDegLng = 111_320 * Math.cos((ref[1] * Math.PI) / 180)
  const ex = (lngLat[0] - ref[0]) * mPerDegLng
  const ny = (lngLat[1] - ref[1]) * mPerDegLat
  const sx = Math.round(ex / stepM) * stepM
  const sy = Math.round(ny / stepM) * stepM
  return [ref[0] + sx / mPerDegLng, ref[1] + sy / mPerDegLat]
}

/** Reactive precision state for the Studio status bar + draw loop. */
export function useStudioInput() {
  const state = reactive({
    ortho: false,
    polar: false,
    polarStepDeg: 15,
    gridStepM: 5,
  })
  return { state, parseDynamic, snapAngle, constrainBearing, resolveDynamic, gridSnap }
}
