// Pure helpers for the OpenLayers editor: which features changed, and how to
// turn those changes into per-layer payloads for POST /api/ogc/wfs/transaction.
// Kept free of OpenLayers so the bookkeeping is unit-testable.

export type FeatureKey = string | number

export interface GeoJsonGeometry {
  type: string
  coordinates: unknown
}

export interface EditedFeature {
  layer: string
  key?: FeatureKey
  properties: Record<string, unknown>
  geometry: GeoJsonGeometry
}

export interface DeletedFeature {
  layer: string
  key?: FeatureKey
}

export interface PendingEdits {
  created: EditedFeature[]
  modified: EditedFeature[]
  deleted: DeletedFeature[]
}

export interface LayerTransaction {
  typeName: string
  insert: { type: 'Feature'; geometry: GeoJsonGeometry; properties: Record<string, unknown> }[]
  update: { type: 'Feature'; id: FeatureKey; geometry: GeoJsonGeometry; properties: Record<string, unknown> }[]
  delete: { id: FeatureKey }[]
}

// Same order the backend uses to pick a table's key column.
export const KEY_PROPERTIES = ['id', 'fid', 'gid'] as const

/** The row key of a loaded feature, read from its own attributes. The
 * collection's positional/synthetic ids are deliberately not used: they do not
 * identify a database row. */
export function featureKey(props: Record<string, unknown>): FeatureKey | undefined {
  for (const k of KEY_PROPERTIES) {
    const v = props[k]
    if ((typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v !== '')) return v
  }
  return undefined
}

/** Attributes worth sending: primitives (and null, to clear a value). Drops the
 * geometry, internal `_`-prefixed bookkeeping and nested objects. */
export function editableProperties(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    if (k === 'geometry' || k.startsWith('_')) continue
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v
  }
  return out
}

/** Number of edits that update/delete an existing row but have no key to
 * identify it — these cannot be saved. */
export function countKeylessEdits(p: PendingEdits): number {
  return [...p.modified, ...p.deleted].filter((e) => e.key === undefined).length
}

/** One transaction per layer, in first-seen order; layers with nothing to do
 * and keyless update/delete entries are left out. */
export function buildTransactions(p: PendingEdits): LayerTransaction[] {
  const byLayer = new Map<string, LayerTransaction>()
  const tx = (layer: string): LayerTransaction => {
    let t = byLayer.get(layer)
    if (!t) {
      t = { typeName: layer, insert: [], update: [], delete: [] }
      byLayer.set(layer, t)
    }
    return t
  }
  for (const f of p.created) {
    tx(f.layer).insert.push({ type: 'Feature', geometry: f.geometry, properties: f.properties })
  }
  for (const f of p.modified) {
    if (f.key === undefined) continue
    tx(f.layer).update.push({ type: 'Feature', id: f.key, geometry: f.geometry, properties: f.properties })
  }
  for (const d of p.deleted) {
    if (d.key === undefined) continue
    tx(d.layer).delete.push({ id: d.key })
  }
  return [...byLayer.values()]
}

/** Tracks which features (by an opaque uid) have been drawn, changed or
 * removed since the last save. */
export class EditTracker {
  private created = new Map<string, string>()
  private modified = new Map<string, string>()
  private deleted = new Map<string, DeletedFeature>()

  markCreated(uid: string, layer: string) {
    this.created.set(uid, layer)
  }

  /** A new feature stays an insert however often it is edited. */
  markModified(uid: string, layer: string) {
    if (this.created.has(uid) || this.deleted.has(uid)) return
    this.modified.set(uid, layer)
  }

  /** Deleting a feature that was never saved just forgets it. */
  markDeleted(uid: string, layer: string, key?: FeatureKey) {
    if (this.created.delete(uid)) return
    this.modified.delete(uid)
    this.deleted.set(uid, { layer, key })
  }

  clearLayer(layer: string) {
    for (const m of [this.created, this.modified]) {
      for (const [uid, l] of m) if (l === layer) m.delete(uid)
    }
    for (const [uid, d] of this.deleted) if (d.layer === layer) this.deleted.delete(uid)
  }

  clear() {
    this.created.clear()
    this.modified.clear()
    this.deleted.clear()
  }

  get count() {
    return this.created.size + this.modified.size + this.deleted.size
  }

  isCreated(uid: string) {
    return this.created.has(uid)
  }

  createdUids() {
    return [...this.created.keys()]
  }

  modifiedUids() {
    return [...this.modified.keys()]
  }

  deletedEntries() {
    return [...this.deleted.values()]
  }
}
