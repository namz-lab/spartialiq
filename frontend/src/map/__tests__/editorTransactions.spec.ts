// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import {
  EditTracker,
  buildTransactions,
  countKeylessEdits,
  editableProperties,
  featureKey,
  type PendingEdits,
} from '../editorTransactions'

const pt = { type: 'Point', coordinates: [30, -19] }

describe('featureKey', () => {
  it('prefers id, then fid, then gid, from the attributes', () => {
    expect(featureKey({ gid: 3, fid: 2, id: 1 })).toBe(1)
    expect(featureKey({ gid: 3, fid: 2 })).toBe(2)
    expect(featureKey({ gid: 3 })).toBe(3)
  })

  it('returns undefined when no usable key exists', () => {
    expect(featureKey({ name: 'x' })).toBeUndefined()
    expect(featureKey({ id: null, fid: '' })).toBeUndefined()
  })
})

describe('editableProperties', () => {
  it('keeps primitives and null, drops geometry, _internal and nested values', () => {
    expect(
      editableProperties({ name: 'a', n: 2, ok: true, cleared: null, geometry: {}, _layer: 'l', nested: { a: 1 } }),
    ).toEqual({ name: 'a', n: 2, ok: true, cleared: null })
  })
})

describe('EditTracker', () => {
  it('forgets a feature that is created and then deleted', () => {
    const t = new EditTracker()
    t.markCreated('a', 'wards')
    t.markDeleted('a', 'wards')
    expect(t.count).toBe(0)
  })

  it('keeps a created feature as an insert when it is edited again', () => {
    const t = new EditTracker()
    t.markCreated('a', 'wards')
    t.markModified('a', 'wards')
    expect(t.createdUids()).toEqual(['a'])
    expect(t.modifiedUids()).toEqual([])
  })

  it('turns a modified feature into a delete when it is removed', () => {
    const t = new EditTracker()
    t.markModified('b', 'wards')
    t.markDeleted('b', 'wards', 9)
    expect(t.modifiedUids()).toEqual([])
    expect(t.deletedEntries()).toEqual([{ layer: 'wards', key: 9 }])
  })

  it('clears one layer without touching another', () => {
    const t = new EditTracker()
    t.markCreated('a', 'wards')
    t.markModified('b', 'roads')
    t.markDeleted('c', 'wards', 1)
    t.clearLayer('wards')
    expect(t.count).toBe(1)
    expect(t.modifiedUids()).toEqual(['b'])
  })
})

describe('buildTransactions', () => {
  const pending: PendingEdits = {
    created: [{ layer: 'wards', properties: { name: 'new' }, geometry: pt }],
    modified: [
      { layer: 'wards', key: 5, properties: { name: 'edited' }, geometry: pt },
      { layer: 'roads', key: 8, properties: {}, geometry: pt },
    ],
    deleted: [{ layer: 'wards', key: 6 }],
  }

  it('groups operations per layer', () => {
    const txs = buildTransactions(pending)
    expect(txs.map((t) => t.typeName)).toEqual(['wards', 'roads'])
    const wards = txs[0]
    expect(wards.insert).toHaveLength(1)
    expect(wards.update).toEqual([{ type: 'Feature', id: 5, geometry: pt, properties: { name: 'edited' } }])
    expect(wards.delete).toEqual([{ id: 6 }])
  })

  it('leaves out keyless updates and deletes, and counts them', () => {
    const keyless: PendingEdits = {
      created: [],
      modified: [{ layer: 'wards', properties: {}, geometry: pt }],
      deleted: [{ layer: 'wards' }],
    }
    expect(countKeylessEdits(keyless)).toBe(2)
    expect(buildTransactions(keyless)).toEqual([])
  })
})
