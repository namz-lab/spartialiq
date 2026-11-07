import { describe, it, expect } from 'vitest'
import { classifyWater } from '../waterQuality'

const clean = { ecoliCount: 0, faecalColiform: 0, freeChlorine: 0.5, ph: 7.2 }

describe('classifyWater', () => {
  it('calls clean microbiology with in-range chemistry potable', () => {
    expect(classifyWater(clean)).toEqual({ result: 'potable', reasons: [] })
  })

  it('makes any faecal indicator decisive, whatever the chemistry', () => {
    const c = classifyWater({ ...clean, ecoliCount: 3 })
    expect(c.result).toBe('not_potable')
    expect(c.reasons[0]).toMatch(/E\. coli 3/)
    expect(classifyWater({ ...clean, faecalColiform: 1, ph: 4 }).result).toBe('not_potable')
  })

  it('marks chemistry out of range as borderline, not unsafe', () => {
    expect(classifyWater({ ...clean, freeChlorine: 0.1 }).result).toBe('borderline')
    expect(classifyWater({ ...clean, ph: 9.1 }).result).toBe('borderline')
  })

  it('refuses to call water potable with no microbial reading', () => {
    expect(classifyWater({ ecoliCount: null, faecalColiform: null, freeChlorine: 0.5, ph: 7 }).result)
      .toBe('pending')
  })
})
