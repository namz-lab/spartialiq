// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mergeHeld, isServerId } from '../useHealthCase'

const SERVER_A = '11111111-1111-4111-8111-111111111111'
const SERVER_B = '22222222-2222-4222-8222-222222222222'

describe('mergeHeld', () => {
  it('replaces the cache with the server list when nothing is held', () => {
    const cached = [{ id: SERVER_A, v: 'stale' }]
    const fresh = [{ id: SERVER_A, v: 'fresh' }, { id: SERVER_B, v: 'new' }]
    expect(mergeHeld(cached, fresh)).toEqual(fresh)
  })

  it('keeps a row written offline that the server has not seen', () => {
    const held = { id: 'ob_local1', v: 'offline', pendingSync: true }
    expect(mergeHeld([held], [{ id: SERVER_A, v: 'x' }])).toEqual([held, { id: SERVER_A, v: 'x' }])
  })

  it('shows a failed edit to a synced row once, as the held edit', () => {
    // The duplicate this guards against: an outbreak closed offline is held
    // under its real id, and the server still returns it as open.
    const heldEdit = { id: SERVER_A, v: 'closed', pendingSync: true }
    const merged = mergeHeld([heldEdit], [{ id: SERVER_A, v: 'open' }, { id: SERVER_B, v: 'b' }])
    expect(merged).toEqual([heldEdit, { id: SERVER_B, v: 'b' }])
  })
})

describe('isServerId', () => {
  it('tells a server UUID from a local offline id', () => {
    expect(isServerId(SERVER_A)).toBe(true)
    expect(isServerId('prem_ab12cd34')).toBe(false)
    expect(isServerId('insp_x')).toBe(false)
  })
})
