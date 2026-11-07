import { describe, it, expect } from 'vitest'
import { readout, loBelt, utmZone, loDefsFrom } from '../coordinateReadout'

// The exact proj4 string in gis_ops.crs_registry (migration 132).
const LO29 = '+proj=tmerc +lat_0=0 +lon_0=29 +k=1 +x_0=0 +y_0=0 +axis=wsu +a=6378249.145 +rf=293.466307656 +towgs84=-142,-96,-293,0,0,0,0 +units=m +no_defs'

describe('coordinate readout', () => {
  it('matches PostGIS for WGS84 -> UTM 35S and Lo29 (acceptance 13)', () => {
    // PostGIS: ST_Transform(POINT(29.8 -19.45), 922029) = POINT(-84021.98 2151376.55)
    //          ST_Transform(POINT(29.8 -19.45), 32735)  = POINT(793990.15 7846986.48)
    const r = readout(29.8, -19.45, { 29: LO29 })
    expect(r.utm.zone).toBe(35)
    expect(r.utm.e).toBeCloseTo(793990.15, 1)
    expect(r.utm.n).toBeCloseTo(7846986.48, 1)
    expect(r.lo?.belt).toBe(29)
    expect(r.lo?.y).toBeCloseTo(-84021.98, 1)
    expect(r.lo?.x).toBeCloseTo(2151376.55, 1)
  })

  it('picks the belt and zone from longitude', () => {
    expect([loBelt(27.9), loBelt(28.1), loBelt(29.99), loBelt(30.01), loBelt(32.5)]).toEqual([27, 29, 29, 31, 33])
    expect([utmZone(29.99), utmZone(30.01)]).toEqual([35, 36])
  })

  it('shows no Lo reading where no belt is registered', () => {
    expect(readout(31.2, -18, { 29: LO29 }).lo).toBeNull()
  })

  it('reads belt definitions from the CRS registry rows', () => {
    const defs = loDefsFrom([
      { code: 'Lo29', proj4text: LO29, is_survey: true },
      { code: 'UTM35S', proj4text: 'x', is_survey: false },
    ])
    expect(Object.keys(defs)).toEqual(['29'])
  })
})
