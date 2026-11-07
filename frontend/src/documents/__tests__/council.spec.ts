import { describe, it, expect } from 'vitest'
import { COUNCIL, LETTERHEAD_ASSET } from '../council'

describe('council identity', () => {
  it('carries the registered council name in upper case', () => {
    expect(COUNCIL.name).toBe('VUNGU RURAL DISTRICT COUNCIL')
  })

  it('carries a postal address, telephone and email', () => {
    expect(COUNCIL.address).toBe('Stand 1, Gweru Road, Gweru, Zimbabwe')
    expect(COUNCIL.telephone).toBe('+263 54 123 456')
    expect(COUNCIL.email).toBe('admin@vungu.gov.zw')
  })

  it('exposes one artwork path so the asset can be swapped without code changes', () => {
    expect(LETTERHEAD_ASSET).toBe('/letterhead/council-letterhead.png')
  })

  it('offers a contact line that joins telephone and email', () => {
    expect(COUNCIL.contactLine()).toBe('Tel: +263 54 123 456  |  admin@vungu.gov.zw')
  })
})
