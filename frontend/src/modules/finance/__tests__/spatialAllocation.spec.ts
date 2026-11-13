/**
 * Pure rules for the spatial-allocation register (M5-7): what the form may accept, and how a
 * recorded draft's status is presented. The server remains the control for caps and SoD; these
 * tests pin the statements the screen makes before a request is sent.
 */
import { describe, expect, it } from 'vitest'
import {
  ALLOCATION_STATUS_LABELS, MIN_METHODOLOGY_LENGTH, allocationStatusTone, isValidDraft,
  validateAllocationDraft,
} from '../composables/useSpatialAllocation'

const draft = (over: Partial<{ targetCode: string; amount: string; methodology: string }> = {}) => ({
  targetCode: 'W01',
  amount: '1250.00',
  methodology: 'Metres of gravel road rebuilt in each ward, from the approved works schedule.',
  ...over,
})

describe('spatial allocation draft', () => {
  it('accepts a ward, a positive decimal amount and a stated methodology', () => {
    expect(validateAllocationDraft(draft())).toEqual({})
    expect(isValidDraft(validateAllocationDraft(draft()))).toBe(true)
  })

  it('demands a target ward — a split with no ward attributes nothing', () => {
    expect(validateAllocationDraft(draft({ targetCode: '  ' })).targetCode).toBeTruthy()
  })

  it('accepts a plain decimal with at most two places and refuses everything else', () => {
    expect(validateAllocationDraft(draft({ amount: '0.01' })).amount).toBeUndefined()
    expect(validateAllocationDraft(draft({ amount: '1' })).amount).toBeUndefined()
    for (const amount of ['', '0', '0.00', '-5.00', '1.234', '1,250.00', 'US$ 12', '1e3']) {
      expect(validateAllocationDraft(draft({ amount })).amount, amount).toBeTruthy()
    }
  })

  it('requires a methodology of at least the schema minimum', () => {
    const short = 'too short'
    expect(MIN_METHODOLOGY_LENGTH).toBe(10)
    expect(validateAllocationDraft(draft({ methodology: short })).methodology).toBeTruthy()
    expect(validateAllocationDraft(draft({ methodology: ' '.repeat(20) })).methodology).toBeTruthy()
  })

  it('reports every problem at once, so the form is not revealed one error at a time', () => {
    const errors = validateAllocationDraft({ targetCode: '', amount: '', methodology: '' })
    expect(Object.keys(errors).sort()).toEqual(['amount', 'methodology', 'targetCode'])
  })
})

describe('spatial allocation status', () => {
  it('names every state the register can carry', () => {
    expect(Object.keys(ALLOCATION_STATUS_LABELS).sort()).toEqual([
      'approved', 'draft', 'rejected', 'withdrawn',
    ])
    expect(ALLOCATION_STATUS_LABELS.draft).toContain('not yet attributed')
    expect(ALLOCATION_STATUS_LABELS.rejected).toBe('Refused')
  })

  it('gives each state a tone, and the draft is not shown as positive', () => {
    expect(allocationStatusTone('approved')).toBe('tone-positive')
    expect(allocationStatusTone('rejected')).toBe('tone-negative')
    expect(allocationStatusTone('withdrawn')).toBe('tone-neutral')
    expect(allocationStatusTone('draft')).toBe('tone-info')
  })
})
