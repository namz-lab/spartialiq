// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { clickPriority, pickTopHit } from '../vunguBasemap'

describe('clickPriority', () => {
  it('ranks farms above peri-urban zones', () => {
    expect(clickPriority('vungu_farm_cadastre')).toBeLessThan(
      clickPriority('vungu_proposed_peri_urban_zones'),
    )
  })

  it('ranks farms above gweru_peri_urban_zone (the user-reported bug)', () => {
    expect(clickPriority('gweru_rural_farms')).toBeLessThan(
      clickPriority('gweru_peri_urban_zone'),
    )
  })

  it('ranks parcels above farms (parcels are more specific)', () => {
    expect(clickPriority('vungu_parcels')).toBeLessThan(clickPriority('vungu_farm_cadastre'))
  })

  it('ranks points above zones', () => {
    expect(clickPriority('pois_points')).toBeLessThan(clickPriority('landuse'))
  })

  it('ranks zones above admin polygons', () => {
    expect(clickPriority('vungu_beyond_peri_urban_zones')).toBeLessThan(
      clickPriority('wards'),
    )
    expect(clickPriority('landuse')).toBeLessThan(clickPriority('provinces'))
  })

  it('handles the planner- prefix transparently', () => {
    // Both farms and zones can arrive with either a vungu- prefix (catalog)
    // or a planner- prefix (dynamic toggle). The priority is the same.
    expect(clickPriority('planner-gweru_rural_farms')).toBeLessThan(
      clickPriority('planner-gweru_peri_urban_zone'),
    )
  })
})

describe('pickTopHit', () => {
  const hit = (id: string) => ({ layer: { id } })

  it('picks the farm when a farm and a zone overlap', () => {
    const result = pickTopHit([
      hit('planner-gweru_peri_urban_zone'),
      hit('planner-gweru_rural_farms'),
    ])
    expect(result?.layer?.id).toBe('planner-gweru_rural_farms')
  })

  it('picks the point when point + farm + zone overlap', () => {
    const result = pickTopHit([
      hit('planner-gweru_peri_urban_zone'),
      hit('vungu_farm_cadastre'),
      hit('pois_points'),
    ])
    expect(result?.layer?.id).toBe('pois_points')
  })

  it('respects vungu- and planner- prefixes', () => {
    const result = pickTopHit([
      hit('vungu-vungu_proposed_peri_urban_zones'),
      hit('planner-vungu_farm_cadastre'),
    ])
    expect(result?.layer?.id).toBe('planner-vungu_farm_cadastre')
  })

  it('returns undefined for empty input', () => {
    expect(pickTopHit([])).toBeUndefined()
  })

  it('falls back to the first hit when nothing classifies', () => {
    const result = pickTopHit([
      hit('something_weird'),
      hit('another_unknown'),
    ])
    // Both classify as "3" by default → first wins via the strict-less-than check
    expect(result?.layer?.id).toBe('something_weird')
  })
})
