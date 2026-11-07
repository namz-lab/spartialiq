// src/map/coordinateReadout.ts
// ---------------------------------------------------------------------------
// The pointer readout: WGS84 degrees, UTM (35S / 36S) and the Lo belt, all at
// once. Belt definitions come from the backend CRS registry (/api/gms/crs) so
// a change of adopted transformation reaches the readout without a release.
//
// proj4js ignores +axis=wsu, so its Lo output has both signs flipped relative
// to PostGIS (which honours it). Negating both gives the surveyor's Y
// (positive west) and X (positive south), matching the stored survey
// geometry exactly; see the test.
// ---------------------------------------------------------------------------
import proj4 from 'proj4'

export interface Readout {
  wgs84: { lat: number; lng: number }
  utm: { zone: number; e: number; n: number }
  lo: { belt: number; y: number; x: number } | null
}

const UTM = (zone: number) => `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`

/** Lo belts are 2° wide, centred on odd meridians: 28–30°E is Lo29. */
export const loBelt = (lng: number) => 2 * Math.round((lng - 1) / 2) + 1
export const utmZone = (lng: number) => Math.floor((lng + 180) / 6) + 1

/** @param loDefs proj4 strings by belt meridian, e.g. { 29: '+proj=tmerc +lon_0=29 ...' } */
export function readout(lng: number, lat: number, loDefs: Record<number, string>): Readout {
  const zone = utmZone(lng)
  const [e, n] = proj4('EPSG:4326', UTM(zone), [lng, lat])
  const belt = loBelt(lng)
  const def = loDefs[belt]
  let lo: Readout['lo'] = null
  if (def) {
    const [a, b] = proj4('EPSG:4326', def, [lng, lat])
    lo = { belt, y: -a, x: -b }
  }
  return { wgs84: { lat, lng }, utm: { zone, e, n }, lo }
}

/** Belt meridian -> proj4 string, from /api/gms/crs rows. */
export function loDefsFrom(crs: { code: string; proj4text: string; is_survey: boolean }[]) {
  const out: Record<number, string> = {}
  for (const c of crs) {
    const m = c.is_survey && c.code.match(/^Lo(\d+)$/)
    if (m) out[Number(m[1])] = c.proj4text
  }
  return out
}
