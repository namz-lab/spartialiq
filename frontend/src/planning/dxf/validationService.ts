// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Feature, Geometry, MultiPolygon, Polygon } from 'geojson'
import { resolveLayer } from './layerRegistry'
import type { DxfInspection } from '@/map/tools/dxfImport'
import { metresScaleForInsunits } from '@/map/tools/dxfImport'
import type { CrsStatus, UnitsStatus, ValidationIssue, ValidationReport } from './types'

export interface ValidateArgs {
  inspection: DxfInspection
  features: Feature[]
  expectedEpsg: string
  confirmedEpsg: string | null
  sidecarEpsg: string | null
  fileEpsg: string | null
  applyUnitTransform: boolean
  acceptUnmappedAsCad: boolean
  // A planning area may be a MultiPolygon (PlanningArea.geom), and the only
  // use below is turf.bbox, which handles both.
  parcelGeom: Polygon | MultiPolygon | null
}

function ringClosed(coords: number[][]): boolean {
  if (!coords.length) return false
  const a = coords[0], b = coords[coords.length - 1]
  return a[0] === b[0] && a[1] === b[1]
}

function geomIssues(g: Geometry | null): { invalid: boolean; open: boolean; zero: boolean; kink: boolean } {
  const out = { invalid: false, open: false, zero: false, kink: false }
  if (!g) return { ...out, invalid: true }
  try {
    if (g.type === 'LineString') {
      const c = g.coordinates
      if (c.length < 2) return { ...out, invalid: true }
      const len = turf.length(turf.lineString(c), { units: 'meters' })
      if (len < 0.02) out.zero = true
    } else if (g.type === 'Polygon') {
      const ring = g.coordinates[0] || []
      if (ring.length < 4) return { ...out, invalid: true }
      if (!ringClosed(ring as number[][])) out.open = true
      const area = turf.area(turf.polygon(g.coordinates as any))
      if (area < 0.05) out.zero = true
      try {
        const k = turf.kinks(turf.polygon(g.coordinates as any))
        if (k.features.length) out.kink = true
      } catch { /* kinks unavailable */ }
    } else if (g.type === 'Point') {
      /* ok */
    } else {
      out.invalid = true
    }
  } catch {
    out.invalid = true
  }
  return out
}

function centroidOf(g: Geometry): [number, number] | null {
  try {
    const c = turf.centroid(turf.feature(g as any) as any)
    return c.geometry.coordinates as [number, number]
  } catch { return null }
}

function hashGeom(g: Geometry | null): string {
  if (!g) return ''
  return JSON.stringify(g).replace(/(\d+\.\d{6})\d+/g, '$1')
}

export function validateImport(args: ValidateArgs): ValidationReport {
  const issues: ValidationIssue[] = []
  const insp = args.inspection

  if (!insp.readable) {
    issues.push({ code: 'unreadable', severity: 'block', title: 'IMPORT BLOCKED', detail: insp.error || 'File is not a readable DXF.' })
  }
  if (insp.hasBinaryDwg) {
    issues.push({ code: 'dwg', severity: 'block', title: 'IMPORT BLOCKED', detail: 'Binary DWG is not supported. Save as DXF from AutoCAD.' })
  }

  const sidecar = args.sidecarEpsg
  const fileCrs = args.fileEpsg || insp.crsFromFile
  const confirmed = args.confirmedEpsg
  const expected = args.expectedEpsg
  let crsStatus: CrsStatus = 'unknown'
  let crsDetail = 'The DXF does not carry a reliable CRS. Confirm the coordinate system before merge.'

  const candidate = sidecar || confirmed || fileCrs
  if (sidecar && sidecar !== expected) {
    crsStatus = 'mismatch'
    crsDetail = 'Coordinate reference system does not match the source planning project.'
    issues.push({ code: 'crs-mismatch', severity: 'block', title: 'CRS mismatch', detail: crsDetail })
  } else if (sidecar && sidecar === expected) {
    crsStatus = 'match'
    crsDetail = `Sidecar CRS ${sidecar} matches the project (${expected}).`
  } else if (fileCrs && fileCrs !== expected && !confirmed) {
    crsStatus = 'mismatch'
    crsDetail = 'Coordinate reference system does not match the source planning project.'
    issues.push({ code: 'crs-mismatch', severity: 'block', title: 'CRS mismatch', detail: crsDetail })
  } else if (confirmed && confirmed === expected) {
    crsStatus = 'confirmed'
    crsDetail = `Planner confirmed ${confirmed}.`
  } else if (confirmed && confirmed !== expected) {
    crsStatus = 'mismatch'
    crsDetail = 'Coordinate reference system does not match the source planning project.'
    issues.push({ code: 'crs-mismatch', severity: 'block', title: 'CRS mismatch', detail: `${crsDetail} File ${confirmed}, project ${expected}.` })
  } else if (!candidate) {
    crsStatus = 'unknown'
    issues.push({ code: 'crs-unknown', severity: 'block', title: 'CRS not identified', detail: crsDetail })
  }

  const sourceUnits = insp.unitsLabel
  const scale = metresScaleForInsunits(insp.insunits)
  const unitsStatus: UnitsStatus = insp.insunits == null ? 'unknown' : (insp.insunits === 6 ? 'match' : 'mismatch')
  if (unitsStatus === 'unknown') {
    issues.push({ code: 'units-unknown', severity: 'block', title: 'UNIT MISMATCH', detail: 'Source units are unspecified. Confirm metres or apply a transform. Geometry will not be scaled silently.' })
  } else if (unitsStatus === 'mismatch' && !args.applyUnitTransform) {
    issues.push({
      code: 'units-mismatch',
      severity: 'block',
      title: 'UNIT MISMATCH',
      detail: `Source: ${sourceUnits}. Expected: metres. Geometry will not be scaled until you choose Transform.`,
    })
  } else if (unitsStatus === 'mismatch' && args.applyUnitTransform && scale == null) {
    issues.push({ code: 'units-no-scale', severity: 'block', title: 'UNIT MISMATCH', detail: `No controlled transform is available for ${sourceUnits}.` })
  }

  const mapped: string[] = []
  const unmapped: string[] = []
  for (const layer of insp.layers) {
    if (resolveLayer(layer)) mapped.push(layer)
    else unmapped.push(layer)
  }
  if (unmapped.length && !args.acceptUnmappedAsCad) {
    issues.push({
      code: 'unmapped-layer',
      severity: 'block',
      title: 'Unmapped layer',
      detail: `${unmapped.join(', ')} ${unmapped.length === 1 ? 'is' : 'are'} not in the Vungu layer registry. Accept as CAD annotation or fix the DXF. Unmapped names never become GIS layers.`,
    })
  } else if (unmapped.length) {
    issues.push({
      code: 'unmapped-accepted',
      severity: 'warn',
      title: 'Unmapped layers as CAD annotation',
      detail: unmapped.join(', '),
    })
  }

  let supported = 0, convertible = 0, unsupported = 0
  for (const [type, n] of Object.entries(insp.entityCounts)) {
    const s = insp.entitySupport[type]
    if (s === 'SUPPORTED') supported += n
    else if (s === 'CONVERTIBLE') convertible += n
    else unsupported += n
  }
  if (unsupported > 0) {
    const types = Object.entries(insp.entitySupport).filter(([, s]) => s === 'UNSUPPORTED').map(([t]) => t)
    issues.push({
      code: 'unsupported-entities',
      severity: 'block',
      title: 'Unsupported geometry',
      detail: `${unsupported} entit${unsupported === 1 ? 'y' : 'ies'} cannot be represented safely (${types.join(', ')}). They were not discarded silently.`,
    })
  }
  if (convertible > 0) {
    const types = Object.entries(insp.entitySupport).filter(([, s]) => s === 'CONVERTIBLE').map(([t]) => t)
    issues.push({
      code: 'convertible-entities',
      severity: 'warn',
      title: 'Convertible entities',
      detail: `${convertible} entit${convertible === 1 ? 'y' : 'ies'} (${types.join(', ')}) are listed and not imported as native planning objects.`,
    })
  }
  if (insp.xrefs.length) {
    issues.push({
      code: 'xref',
      severity: 'block',
      title: 'EXTERNAL REFERENCES DETECTED',
      detail: `The drawing is not self-contained: ${insp.xrefs.join(', ')}. Bind or insert the references in AutoCAD, then export a standalone DXF.`,
    })
  }

  const geom = { valid: 0, invalid: 0, zeroLength: 0, openRings: 0, duplicates: 0, selfIntersections: 0, outsideExtent: 0 }
  const seen = new Set<string>()
  let cadastralConflict = false
  let parcelBbox: number[] | null = null
  if (args.parcelGeom) {
    try { parcelBbox = turf.bbox(turf.feature(args.parcelGeom as any) as any) } catch { parcelBbox = null }
  }
  const pad = 0.002

  for (const f of args.features) {
    const g = f.geometry
    const flags = geomIssues(g)
    if (flags.invalid) geom.invalid++
    else if (flags.zero) geom.zeroLength++
    else if (flags.open) geom.openRings++
    else if (flags.kink) geom.selfIntersections++
    else geom.valid++

    const h = hashGeom(g)
    if (h && seen.has(h)) geom.duplicates++
    else if (h) seen.add(h)

    const role = (f.properties as any)?.gisRole
    if (role === 'cadastral-read-only' || String((f.properties as any)?.objectType) === 'BOUNDARY') {
      cadastralConflict = true
    }
    if (parcelBbox && g) {
      const c = centroidOf(g)
      if (c && (c[0] < parcelBbox[0] - pad || c[0] > parcelBbox[2] + pad || c[1] < parcelBbox[1] - pad || c[1] > parcelBbox[3] + pad)) {
        geom.outsideExtent++
      }
    }
  }
  if (geom.invalid) issues.push({ code: 'invalid-polygon', severity: 'block', title: 'Invalid polygon', detail: `${geom.invalid} geometr${geom.invalid === 1 ? 'y is' : 'ies are'} invalid.` })
  if (geom.selfIntersections) issues.push({ code: 'self-intersection', severity: 'block', title: 'Self-intersection', detail: `${geom.selfIntersections} polygon(s) self-intersect.` })
  if (geom.openRings) issues.push({ code: 'open-ring', severity: 'warn', title: 'Open ring', detail: `${geom.openRings} polygon(s) were not closed.` })
  if (geom.zeroLength) issues.push({ code: 'zero-length', severity: 'warn', title: 'Zero-length geometry', detail: `${geom.zeroLength} object(s) have near-zero length or area.` })
  if (geom.duplicates) issues.push({ code: 'duplicate', severity: 'warn', title: 'Duplicate geometry', detail: `${geom.duplicates} duplicate object(s).` })
  if (geom.outsideExtent) issues.push({ code: 'outside-extent', severity: 'warn', title: 'Outside parcel extent', detail: `${geom.outsideExtent} object(s) sit outside the planning parcel.` })
  if (cadastralConflict) {
    issues.push({
      code: 'cadastral-conflict',
      severity: 'warn',
      title: 'CAD / CADASTRAL CONFLICT',
      detail: 'The DXF contains boundary geometry. Authoritative parcel boundaries will not be overwritten. Resolve cadastral change through the cadastral workflow.',
    })
  }

  const blocked = issues.some(i => i.severity === 'block')
  return {
    ok: !blocked,
    blocked,
    issues,
    geometry: geom,
    layers: { mapped, unmapped },
    entities: { supported, convertible, unsupported },
    xrefs: insp.xrefs,
    crs: { status: crsStatus, source: candidate, expected, detail: crsDetail },
    units: { status: unitsStatus, source: sourceUnits, expected: 'metres', scaleToMetres: scale },
    cadastralConflict,
  }
}

export function validationReportText(report: ValidationReport, fileName: string): string {
  const lines = [
    'Vungu Planning Studio — DXF validation report',
    `File: ${fileName}`,
    `Result: ${report.blocked ? 'IMPORT BLOCKED' : 'PASSED'}`,
    `CRS: ${report.crs.status.toUpperCase()} · source ${report.crs.source || '—'} · expected ${report.crs.expected}`,
    `Units: ${report.units.status.toUpperCase()} · source ${report.units.source} · expected ${report.units.expected}`,
    `Geometry valid ${report.geometry.valid} / invalid ${report.geometry.invalid} / self-intersections ${report.geometry.selfIntersections}`,
    `Entities supported ${report.entities.supported} / convertible ${report.entities.convertible} / unsupported ${report.entities.unsupported}`,
    `Mapped layers: ${report.layers.mapped.join(', ') || '—'}`,
    `Unmapped layers: ${report.layers.unmapped.join(', ') || '—'}`,
    report.xrefs.length ? `XREFs: ${report.xrefs.join(', ')}` : 'XREFs: none',
    '',
    'Issues',
    ...report.issues.map(i => `- [${i.severity}] ${i.title}: ${i.detail}`),
  ]
  return lines.join('\n')
}
