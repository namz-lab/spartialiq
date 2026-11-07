import { describe, it, expect } from 'vitest'
import { FILE_CHECKS, COMPAT_CHECKS, STATUTE_CHECKS, DD_CHECK_TOTAL } from '@/views/planner/dueDiligenceChecks'

describe('dueDiligenceChecks', () => {
  it('has the expected counts', () => {
    expect(FILE_CHECKS).toHaveLength(4)
    expect(COMPAT_CHECKS).toHaveLength(8)
    expect(STATUTE_CHECKS).toHaveLength(9)
    expect(DD_CHECK_TOTAL).toBe(21)
  })
  it('entries are [key, label] tuples with non-empty keys', () => {
    for (const list of [FILE_CHECKS, COMPAT_CHECKS, STATUTE_CHECKS]) {
      for (const [key, label] of list) {
        expect(typeof key).toBe('string'); expect(key.length).toBeGreaterThan(0)
        expect(typeof label).toBe('string'); expect(label.length).toBeGreaterThan(0)
      }
    }
  })
})
