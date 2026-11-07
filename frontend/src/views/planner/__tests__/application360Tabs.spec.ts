import { describe, it, expect } from 'vitest'
import { APPLICATION_360_TABS, isApplication360Tab, tabForStep } from '@/views/planner/application360Tabs'

describe('Application 360 tabs', () => {
  it('keeps the planner inside one case workspace', () => {
    expect(APPLICATION_360_TABS).toEqual([
      'overview', 'gis', 'assessment', 'documents', 'clock',
      'referrals', 'objections', 'inspections', 'history',
      'committee', 'decision', 'conditions', 'appeals', 'enforcement', 'audit',
    ])
  })

  it('rejects unknown tab keys', () => {
    expect(isApplication360Tab('overview')).toBe(true)
    expect(isApplication360Tab('billing')).toBe(false)
  })

  it('maps statutory steps onto the matching tab', () => {
    expect(tabForStep(1)).toBe('overview')
    expect(tabForStep(2)).toBe('assessment')
    expect(tabForStep(3)).toBe('committee')
    expect(tabForStep(4)).toBe('decision')
    expect(tabForStep(5)).toBe('objections')
  })
})
