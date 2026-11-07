// src/services/pipelineSync.ts
// ---------------------------------------------------------------------------
// Client for the QGIS -> web pipeline diagnostics (/api/qgis/sync/coverage,
// /api/qgis/health, /api/ogc/health).
//
// WHY THIS MODULE HOLDS NO ANSWERS
// Every value here is computed by the backend from the live database and the
// running server. The frontend holds no table names, no trigger names, no layer
// ids and no verdicts. That is deliberate: the defect this screen exists to
// catch was a mismatch between what the database does and what two different
// hard-coded lists assumed were true. A client keeping its own copy of those
// lists would be a third thing free to drift.
//
// THE CHAIN, AS THE PAGE EXPLAINS IT
//   QGIS Desktop -> PostGIS write -> trg_notify_spatial_change -> LISTEN
//   -> table-to-layer lookup -> tile cache invalidation -> SSE /api/map/events
//   -> map source "vungu-<layerId>" -> repaint
// Every link can fail without raising an error. Coverage names the one that broke.
import api from './api'

export interface SyncLeg {
  table: string
  exists: boolean
  /** The trigger exists in pg_trigger. A DISABLED trigger also exists. */
  triggerAttached: boolean
  /** The trigger exists AND is enabled, so a write actually broadcasts. */
  triggerFires: boolean
  /** pg_trigger.tgenabled, in words: enabled / disabled / replica only. */
  triggerState: string | null
  resolvesToThisLayer: boolean
  resolvesTo: string
  browserSourceId: string
  sourceRegistered: boolean
}

export interface CoverageLayer {
  layerId: string
  title: string
  group: string
  geomType: string
  registryTable: string
  relationKind: string | null
  isView: boolean
  notifyTables: string[]
  legs: SyncLeg[]
  syncs: boolean
  browserSourceId: string | null
  breakStage: string | null
  remedy: string | null
  chain: string
}

interface RelationFinding {
  relation: string
  relationKind: string
  approxRows: number | null
  /** True when approxRows is a real count(*) rather than a planner estimate. */
  exact: boolean
  statsCollected: boolean
  note: string
}

export interface UnroutedRelation extends RelationFinding {
  resolvesTo: string
  browserSourceId: string
}

export interface ShadowedRelation extends RelationFinding {
  claimsLayerId: string
}

export interface ListenerStatus {
  listening: boolean
  notifications: number
  eventsEmitted: number
  reconnects: number
  connectedAt: string | null
  countersSince: string | null
  pendingLayers: string[]
}

export interface SyncCoverage {
  listener: ListenerStatus
  summary: {
    layers: number
    syncing: number
    broken: number
    triggersAttached: number
    /** Triggers present but never firing — invisible to a trigger count. */
    triggersInert: { relation: string; state: string }[]
    unroutedTriggers: number
    shadowedTriggers: number
    wiringProblems: number
    breaks: { layerId: string; title: string; stage: string; remedy: string }[]
  }
  layers: CoverageLayer[]
  unrouted: UnroutedRelation[]
  shadowed: ShadowedRelation[]
}

export interface PipelineHealth {
  realtimeSync: Partial<ListenerStatus> & { listening: boolean }
  timestamp: string
}

export interface OgcHealth {
  status: string
  [k: string]: unknown
}

/**
 * Human phrasing for a break stage. The backend returns a stable machine token
 * (`trigger-missing`) so callers can match on it; the wording lives here so a
 * support conversation can quote the screen.
 */
export const BREAK_STAGE_TEXT: Record<string, string> = {
  'relation-missing': 'Table not in the database',
  'view-without-base-table': 'View reads nothing',
  'base-table-missing': 'Base table not in the database',
  'trigger-missing': 'Change trigger not attached',
  // A trigger that exists but is DISABLED. Worth naming separately: a trigger
  // count says it is there, and every other check says the layer is fine.
  'trigger-disabled': 'Change trigger is disabled',
  'unmapped-notify-table': 'Broadcast goes to the wrong layer',
}

export async function getSyncCoverage(): Promise<SyncCoverage> {
  const res = await api.get('/qgis/sync/coverage')
  return res.data?.data
}

export async function getPipelineHealth(): Promise<PipelineHealth> {
  const res = await api.get('/qgis/health')
  return res.data?.data
}

export async function getOgcHealth(): Promise<OgcHealth> {
  const res = await api.get('/ogc/health')
  return res.data?.data
}