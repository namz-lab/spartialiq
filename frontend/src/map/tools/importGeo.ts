// src/map/tools/importGeo.ts
// ─────────────────────────────────────────────────────────────────────────
// Parse an uploaded spatial file into a GeoJSON FeatureCollection (WGS84) so a
// GIS officer can bring data into the web map without QGIS/ogr2ogr.
//
// Supported:
//   .geojson / .json  — parsed natively
//   .kml              — converted with @tmcw/togeojson (browser DOMParser)
//   .zip              — zipped shapefile (.shp/.dbf/.prj) via shpjs, reprojected
//                       to WGS84 when a .prj is present
//   .dxf              — a CAD/QGIS drawing (dxfImport.ts). Unlike the formats
//                       above, DXF carries no reliable CRS tag, so the caller
//                       must supply a WGS84 reference point (`dxfReferenceLngLat`)
//                       to anchor the UTM zone/hemisphere; without one this
//                       falls back to a Zimbabwe-wide default, which is only
//                       right to within the country's own UTM zone split — fine
//                       for a quick map preview, not for a subdivision
//                       reconciliation (that path always passes a real
//                       reference point — see usePlanningTools.ts importDxf()).
//
// Everything runs in the browser; nothing is uploaded until the user chooses to
// save. Returns a normalised FeatureCollection plus a feature count.
// ─────────────────────────────────────────────────────────────────────────

// @ts-ignore — shpjs ships no type declarations
import shp from 'shpjs'
import { kml as kmlToGeoJSON } from '@tmcw/togeojson'
import { parseDxfToGeoJSON } from './dxfImport'

export interface ParseResult {
  featureCollection: any
  count: number
}

// Rough centre of Zimbabwe — only used when a DXF import has no better
// reference point; both of Zimbabwe's UTM zones (35S/36S) are close enough
// here that a preview import still lands in the right neighbourhood.
const ZIMBABWE_CENTRE: [number, number] = [29.15, -19.0]

export async function parseGeoFile(file: File, opts: { dxfReferenceLngLat?: [number, number] } = {}): Promise<ParseResult> {
  const name = file.name.toLowerCase()
  let fc: any

  if (name.endsWith('.dxf')) {
    const text = await file.text()
    const res = parseDxfToGeoJSON(text, opts.dxfReferenceLngLat || ZIMBABWE_CENTRE)
    fc = res.featureCollection
  } else if (name.endsWith('.zip')) {
    const buf = await file.arrayBuffer()
    const out = await shp(buf)
    fc = Array.isArray(out) ? mergeCollections(out) : out
  } else if (name.endsWith('.kml')) {
    const text = await file.text()
    const dom = new DOMParser().parseFromString(text, 'application/xml')
    if (dom.getElementsByTagName('parsererror').length) {
      throw new Error('Could not read the KML — the file may be malformed.')
    }
    fc = kmlToGeoJSON(dom)
  } else if (name.endsWith('.geojson') || name.endsWith('.json')) {
    const text = await file.text()
    let obj: any
    try {
      obj = JSON.parse(text)
    } catch {
      throw new Error('Not valid JSON.')
    }
    fc = normalize(obj)
  } else {
    throw new Error('Unsupported file. Use .geojson, .json, .kml, .dxf, or a zipped shapefile (.zip).')
  }

  fc = sanitize(fc)
  return { featureCollection: fc, count: fc.features.length }
}

/** Wrap a bare geometry or single Feature into a FeatureCollection. */
function normalize(obj: any): any {
  if (!obj || typeof obj !== 'object') throw new Error('Not valid GeoJSON.')
  if (obj.type === 'FeatureCollection') return obj
  if (obj.type === 'Feature') return { type: 'FeatureCollection', features: [obj] }
  if (obj.type && obj.coordinates) {
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: obj }] }
  }
  throw new Error('Unrecognised GeoJSON structure.')
}

/** shpjs can return one FeatureCollection per shapefile inside the zip. */
function mergeCollections(list: any[]): any {
  const features: any[] = []
  for (const c of list) if (c && Array.isArray(c.features)) features.push(...c.features)
  return { type: 'FeatureCollection', features }
}

/** Drop features without usable geometry; fail loudly if none remain. */
function sanitize(fc: any): any {
  if (!fc || !Array.isArray(fc.features)) throw new Error('No features found in the file.')
  const features = fc.features.filter(
    (f: any) => f && f.geometry && f.geometry.type && f.geometry.coordinates,
  )
  if (!features.length) throw new Error('No usable geometry found in the file.')
  return { type: 'FeatureCollection', features }
}
