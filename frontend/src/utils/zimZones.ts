// Multi-zone Zimbabwe cadastral coordinate conversion (Lo 25/27/29/31/33).
//
// Self-contained: registers its own proj4 zone defs and handles the
// westing/southing (P(Y,X)) convention explicitly by negating
// easting/northing. proj4-js silently ignores `+axis=wsu` for tmerc, so
// relying on that PROJ flag gives a point in the wrong hemisphere —
// verified empirically that negating both axes is the correct mapping.
//
// ponytail: meters only, no Cape/International Foot unit conversion —
// nothing in vungu's surveyor data uses feet today. Add convertToMeters
// (Cape Foot = 0.3047972654 m) if a feet-sourced import ever appears.

import proj4 from 'proj4'

export type ZimZone = 25 | 27 | 29 | 31 | 33

const ZONES: ZimZone[] = [25, 27, 29, 31, 33]
const WGS84 = 'EPSG:4326'

for (const zone of ZONES) {
  proj4.defs(
    `ZIM_TM_${zone}`,
    `+proj=tmerc +lat_0=0 +lon_0=${zone} +k=1 +x_0=0 +y_0=0 +ellps=clrk80 +towgs84=-136,-108,-292,0,0,0,0 +units=m +no_defs`,
  )
}

/** P(Y,X) — Y=westing, X=southing — for the given Lo zone -> WGS84 {lng, lat}. */
export function pyxToWgs84(y: number, x: number, zone: ZimZone): { lng: number; lat: number } {
  const [lng, lat] = proj4(`ZIM_TM_${zone}`, WGS84, [-y, -x])
  return { lng, lat }
}

/** WGS84 {lng, lat} -> P(Y,X) — Y=westing, X=southing — for the given Lo zone. */
export function wgs84ToPyx(lng: number, lat: number, zone: ZimZone): { y: number; x: number } {
  const [easting, northing] = proj4(WGS84, `ZIM_TM_${zone}`, [lng, lat])
  return { y: -easting, x: -northing }
}

export const ZIM_ZONES = ZONES
