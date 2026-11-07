import { describe, it, expect } from 'vitest'
import { CLIENT_ROLES, isClientRole } from '../types'

describe('client roles', () => {
  it('counts every citizen role, including the legacy viewer, as a client', () => {
    expect([...CLIENT_ROLES].sort()).toEqual(['public', 'registered', 'viewer'])
    for (const r of CLIENT_ROLES) expect(isClientRole(r)).toBe(true)
  })

  it('never counts a council role as a client', () => {
    for (const r of ['admin', 'planner', 'eo', 'env_officer', 'building_inspector', 'planning_clerk', 'surveyor', 'gis_officer']) {
      expect(isClientRole(r), r).toBe(false)
    }
    expect(isClientRole(undefined)).toBe(false)
  })
})
