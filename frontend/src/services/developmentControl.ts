// Development Control service for parcel permitted uses
import api, { unwrapData } from './api'

export interface PermittedUse {
  group_code: string
  description: string
  category: string
  conditions?: string
  max_units?: number
  max_height_meters?: number
  min_lot_size_sqm?: number
}

export interface DevelopmentSummary {
  permitted_count: number
  prohibited_count: number
  consent_required_count: number
}

export interface ParcelPermittedUses {
  parcel: {
    parcel_id: number
    stand_number: string
    township_name: string
    zone_id?: number
    zone_code?: string
    zone_name?: string
  }
  zone: {
    zone_id?: number
    zone_code?: string
    zone_name?: string
  } | null
  development_summary: DevelopmentSummary
  permitted_uses: PermittedUse[]
  prohibited_uses: PermittedUse[]
  consent_required_uses: PermittedUse[]
}

export interface APIResponse<T> {
  success: boolean
  data: T
  error?: string
  details?: string
}

export async function getParcelPermittedUses(parcelId: string | number, eligibleZone?: { zoneName: string, zoneCode?: string }): Promise<APIResponse<ParcelPermittedUses> | null> {
  try {
    const params: any = {}
    if (eligibleZone) {
      params.zone_name = eligibleZone.zoneName
      params.zone_code = eligibleZone.zoneCode
    }
    
    const response = await api.get(`/development-control/parcels/${parcelId}/permitted-uses`, { params })
    return response.data
  } catch (error) {
    console.error('Failed to fetch permitted uses:', error)
    return null
  }
}

export async function checkDevelopmentPermission(parcelId: string | number, proposedUseCode: string) {
  try {
    const response = await api.post('/development-control/compliance-check', {
      parcelId: parcelId.toString(),
      proposedUseCode
    })
    return unwrapData(response)
  } catch (error) {
    console.error('Error checking development permission:', error)
    return null
  }
}

export async function getLocalAuthorities() {
  const response = await api.get('/development-control/local-authorities')
  return unwrapData<any[]>(response)
}

export async function getLandUseGroups() {
  const response = await api.get('/development-control/groups')
  return unwrapData<any[]>(response)
}

export async function createApplicant(payload: Record<string, any>) {
  const response = await api.post('/development-control/applicants', payload)
  return unwrapData<any>(response)
}

export async function createOwner(payload: Record<string, any>) {
  const response = await api.post('/development-control/owners', payload)
  return unwrapData<any>(response)
}

export async function submitTpd1Application(payload: Record<string, any>) {
  const response = await api.post('/development-control/tpd1-applications', payload)
  return unwrapData<any>(response)
}

// ---------------------------------------------------------------------------
// Zoning assessment types and helpers (Task 1: Step 2 Due Diligence)
// ---------------------------------------------------------------------------

export type Permission = 'permitted' | 'special_consent' | 'prohibited'

export interface PermittedUseEntry {
  groupCode: string
  groupName: string
  category: string | null
  permission: Permission
  conditions: string | null
  maxHeightM: number | null
  minLotSqm: number | null
  maxUnits: number | null
}

/** Where the rules behind an assessment stand: is the plan in force, and has the council reviewed this zone's decisions? */
export interface RulesStatus {
  planTitle: string | null
  planStatus: string | null
  /** True while the plan is not approved or gazetted: what it decides is a draft, not council policy. */
  provisional: boolean
  reviewStatus: 'unreviewed' | 'in_review' | 'reviewed' | null
  reviewedBy: string | null
}

export interface ZoneAssessment {
  parcelFid: number
  standNumber: string | null
  zoneName: string | null
  zoneCode: string | null
  uses: PermittedUseEntry[]
  rulesStatus: RulesStatus | null
}

export interface ProvisionalNotice { headline: string; detail: string }

const PLAN_STATUS_WORDS: Record<string, string> = {
  unknown: 'its legal status has not been confirmed',
  draft: 'it is still a draft',
  public_notice: 'it is out for public notice',
}

/**
 * What to tell an officer about rules that are not yet council policy. Null when the plan is in force
 * (or nothing is known): in that case there is nothing to qualify. Never softens the headline: a reviewed
 * column in a plan that is not in force is still a draft.
 */
export function provisionalNotice(status: RulesStatus | null | undefined): ProvisionalNotice | null {
  if (!status || !status.provisional) return null
  const plan = status.planTitle ? `"${status.planTitle}"` : 'this plan'
  const why = PLAN_STATUS_WORDS[status.planStatus ?? ''] ?? 'it is not yet in force'
  let review: string
  if (status.reviewStatus === 'reviewed') review = `The council reviewed this zone's decisions${status.reviewedBy ? ` (${status.reviewedBy})` : ''}, but`
  else if (status.reviewStatus === 'in_review') review = "This zone's decisions are being reviewed, and"
  else review = "The council has not reviewed this zone's decisions, and"
  return {
    headline: 'Draft rules, not council policy.',
    detail: `${review} ${plan} is not in force: ${why}. Treat the result as guidance and confirm it with the Planner.`,
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function mapUse(row: any, permission: Permission): PermittedUseEntry {
  return {
    groupCode: String(row?.group_code ?? ''),
    groupName: str(row?.description) ?? String(row?.group_code ?? '—'),
    category: str(row?.category),
    permission,
    conditions: str(row?.conditions),
    maxHeightM: num(row?.max_height_meters),
    minLotSqm: num(row?.min_lot_size_sqm),
    maxUnits: num(row?.max_units),
  }
}

// Returns null when the stand has no resolvable zoning data (404, no zone, or
// an empty matrix) — the card renders that as graceful degradation.
export async function getPermittedUses(parcelFid: number): Promise<ZoneAssessment | null> {
  let env: any
  try {
    const res = await api.get(`/development-control/parcels/${parcelFid}/permitted-uses`)
    env = res.data?.data ?? res.data
  } catch (e: any) {
    if (e?.response?.status === 404) return null
    throw e
  }
  return toAssessment(env, parcelFid)
}

/** Zone + permitted uses at a map point (the zone polygon that contains it).
 *  Null when the point is in no zone or the zone has no matrix rules. */
export async function getZoningAt(lng: number, lat: number, parcelFid = 0): Promise<ZoneAssessment | null> {
  const res = await api.get('/development-control/zoning-at', { params: { lng, lat } })
  return toAssessment(res.data?.data ?? res.data, parcelFid)
}

function toRulesStatus(r: any): RulesStatus | null {
  if (!r || typeof r !== 'object') return null
  const rs = r.review_status
  return {
    planTitle: str(r.plan_title),
    planStatus: str(r.plan_status),
    provisional: r.provisional === true,
    reviewStatus: rs === 'unreviewed' || rs === 'in_review' || rs === 'reviewed' ? rs : null,
    reviewedBy: str(r.reviewed_by),
  }
}

function toAssessment(env: any, parcelFid: number): ZoneAssessment | null {
  if (!env) return null
  const permitted = Array.isArray(env.permitted_uses) ? env.permitted_uses : []
  const consent = Array.isArray(env.consent_required_uses) ? env.consent_required_uses : []
  const prohibited = Array.isArray(env.prohibited_uses) ? env.prohibited_uses : []
  const uses: PermittedUseEntry[] = [
    ...permitted.map((r: any) => mapUse(r, 'permitted')),
    ...consent.map((r: any) => mapUse(r, 'special_consent')),
    ...prohibited.map((r: any) => mapUse(r, 'prohibited')),
  ]
  if (uses.length === 0) return null // no zone / empty matrix
  return {
    parcelFid,
    standNumber: str(env.parcel?.stand_number),
    zoneName: str(env.zone?.zone_name),
    zoneCode: str(env.zone?.zone_code),
    uses,
    rulesStatus: toRulesStatus(env.rules_status),
  }
}

export interface ZoningApplyPayload {
  parcelFid: number
  zoneName: string | null
  zoneCode: string | null
  selectedGroupCode: string
  selectedGroupName: string
  permission: Permission
  conditions: string | null
  maxHeightM: number | null
  minLotSqm: number | null
  maxUnits: number | null
  /** The rules were a draft when this was applied. Absent on older records. */
  provisional?: boolean
}

export interface ZoningSnapshot extends ZoningApplyPayload {
  assessedAt: string
}

export interface ZoningChecklistEntry {
  result: 'pass' | 'fail'
  notes: string
  snapshot: ZoningSnapshot
}

const PERMISSION_LABEL: Record<Permission, string> = {
  permitted: 'Permitted',
  special_consent: 'Special consent required',
  prohibited: 'Prohibited',
}

// Pure mapping from a chosen use verdict to the Step 2 checklist entry.
export function buildZoningEntry(
  payload: ZoningApplyPayload,
  now: Date = new Date(),
): ZoningChecklistEntry {
  const result: 'pass' | 'fail' = payload.permission === 'prohibited' ? 'fail' : 'pass'
  const limits = [
    payload.maxHeightM != null ? `max height ${payload.maxHeightM} m` : null,
    payload.minLotSqm != null ? `min lot ${payload.minLotSqm} m²` : null,
    payload.maxUnits != null ? `max units ${payload.maxUnits}` : null,
  ].filter(Boolean).join(', ')
  const parts = [
    `Zone ${payload.zoneName ?? payload.zoneCode ?? '—'}: ${payload.selectedGroupName} — ${PERMISSION_LABEL[payload.permission]}.`,
    payload.permission === 'special_consent' ? 'Special consent required.' : '',
    payload.conditions ? `Conditions: ${payload.conditions}` : '',
    limits ? `Limits: ${limits}.` : '',
    payload.provisional ? 'DRAFT RULES, not council policy: confirm with the Planner.' : '',
    `(Auto from zoning check ${now.toISOString().slice(0, 10)}.)`,
  ].filter(Boolean)
  return {
    result,
    notes: parts.join(' '),
    snapshot: { ...payload, assessedAt: now.toISOString() },
  }
}

// ---------------------------------------------------------------------------
// Development control matrix: zone × land-use group → P / SC / X
// ---------------------------------------------------------------------------

export type PermissionCode = 'P' | 'SC' | 'X'

export const PERMISSION_CODE_LABEL: Record<PermissionCode, string> = {
  P: 'Permitted',
  SC: 'Special consent',
  X: 'Prohibited',
}

export interface MatrixZone {
  id: number
  zone_code: string | null
  zone_name: string
  zone_type: string | null
}

export interface MatrixGroup {
  group_id: string
  group_code: string
  description: string
  group_category: string | null
}

export interface MatrixRule {
  matrix_id: string
  zone_id: number
  group_id: string
  group_code: string
  permission_code: PermissionCode
  conditions: string | null
  max_units: number | null
  max_height_meters: number | null
  min_lot_size_sqm: number | null
  legal_reference: string | null
}

export interface MatrixRuleInput {
  zone_id: number
  group_code: string
  permission_code: PermissionCode
  conditions?: string
  max_units?: number
  max_height_meters?: number
  min_lot_size_sqm?: number
  legal_reference?: string
}

export async function getMatrixZones() {
  return unwrapData<MatrixZone[]>(await api.get('/development-control/zones'))
}

export async function getMatrixRules() {
  const rows = unwrapData<any[]>(await api.get('/development-control/matrix'))
  // numeric columns arrive as strings from pg
  return rows.map((r): MatrixRule => ({
    ...r,
    max_units: num(r.max_units),
    max_height_meters: num(r.max_height_meters),
    min_lot_size_sqm: num(r.min_lot_size_sqm),
  }))
}

export async function saveMatrixRule(input: MatrixRuleInput) {
  return unwrapData<{ matrix_id: string }>(await api.post('/development-control/matrix', input))
}

export async function clearMatrixRule(matrixId: string) {
  await api.delete(`/development-control/matrix/${matrixId}`)
}

/** Lookup key for a matrix cell. */
export const cellKey = (zoneId: number, groupId: string) => `${zoneId}:${groupId}`

/** The matrix as a CSV sheet: one row per use group, one column per zone.
 *  Unscheduled cells are blank (prohibited by default). */
export function matrixCsv(zones: MatrixZone[], groups: MatrixGroup[], rules: MatrixRule[]): string {
  const byCell = new Map(rules.map(r => [cellKey(r.zone_id, r.group_id), r.permission_code]))
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const header = ['Group', 'Description', ...zones.map(z => z.zone_code || z.zone_name)]
  const lines = groups.map(g => [
    g.group_code, g.description, ...zones.map(z => byCell.get(cellKey(z.id, g.group_id)) ?? ''),
  ])
  return [header, ...lines].map(row => row.map(q).join(',')).join('\n')
}

export interface MatrixChange {
  zone_id: number
  group_code: string
  /** null clears the cell */
  permission_code: PermissionCode | null
}

export async function importMatrixChanges(changes: MatrixChange[]) {
  return unwrapData<{ set: number; cleared: number }>(
    await api.post('/development-control/matrix/import', { changes }))
}

export interface MatrixHistoryEntry {
  history_id: number
  action: 'created' | 'updated' | 'cleared'
  permission_code: PermissionCode | null
  conditions: string | null
  changed_at: string
  changed_by_name: string | null
}

/** Change history of one cell. `unavailable` until migration 134 is applied. */
export async function getMatrixHistory(zoneId: number, groupId: string) {
  const res = await api.get('/development-control/matrix/history', { params: { zone_id: zoneId, group_id: groupId } })
  return { entries: (res.data?.data ?? []) as MatrixHistoryEntry[], unavailable: !!res.data?.unavailable }
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF, a leading BOM from Excel. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

export interface MatrixImportPlan {
  changes: MatrixChange[]
  /** header cells that name no zone (ignored) */
  unknownZones: string[]
  /** group codes that match no land-use group (ignored) */
  unknownGroups: string[]
  /** cells holding something other than P, SC, X or blank, and repeated group
   *  rows (zone '—'); these block the import */
  invalid: { group: string; zone: string; value: string }[]
}

/**
 * Reads a sheet in the export layout (group code first, optional Description,
 * one column per zone, headed by code or name) and returns only the cells that
 * differ from the current matrix. A blank cell means "not scheduled" and clears.
 */
export function planMatrixImport(
  text: string, zones: MatrixZone[], groups: MatrixGroup[], rules: MatrixRule[],
): MatrixImportPlan {
  const [header = [], ...body] = parseCsv(text)
  const norm = (v: string) => v.trim().toLowerCase()
  const zoneBy = new Map<string, MatrixZone>()
  for (const z of zones) {
    zoneBy.set(norm(z.zone_name), z)
    if (z.zone_code) zoneBy.set(norm(z.zone_code), z)
  }
  const groupBy = new Map(groups.map(g => [norm(g.group_code), g]))
  const current = new Map(rules.map(r => [cellKey(r.zone_id, r.group_id), r.permission_code]))

  const plan: MatrixImportPlan = { changes: [], unknownZones: [], unknownGroups: [], invalid: [] }
  const cols: { i: number; zone: MatrixZone }[] = []
  header.forEach((h, i) => {
    if (i === 0 || norm(h) === 'description' || !h.trim()) return
    const zone = zoneBy.get(norm(h))
    if (zone) cols.push({ i, zone })
    else plan.unknownZones.push(h.trim())
  })

  const seen = new Set<string>()
  for (const row of body) {
    const code = (row[0] ?? '').trim()
    if (!code) continue
    const group = groupBy.get(norm(code))
    if (!group) { plan.unknownGroups.push(code); continue }
    if (seen.has(group.group_id)) {
      plan.invalid.push({ group: code, zone: '—', value: 'listed more than once' })
      continue
    }
    seen.add(group.group_id)
    for (const { i, zone } of cols) {
      const raw = (row[i] ?? '').trim().toUpperCase()
      const next = raw === '' || raw === '·' ? null : raw
      if (next !== null && next !== 'P' && next !== 'SC' && next !== 'X') {
        plan.invalid.push({ group: code, zone: zone.zone_code || zone.zone_name, value: row[i].trim() })
        continue
      }
      if ((current.get(cellKey(zone.id, group.group_id)) ?? null) !== next) {
        plan.changes.push({ zone_id: zone.id, group_code: group.group_code, permission_code: next as PermissionCode | null })
      }
    }
  }
  return plan
}

/** Roles that may amend the matrix. Mirrors MATRIX_EDITORS in the backend's
 *  src/lib/developmentMatrix.js, which every write route enforces. */
export const MATRIX_EDITORS = ['admin', 'planner', 'eo'] as const
