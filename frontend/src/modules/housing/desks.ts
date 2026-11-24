/** Which Housing pages each post may open. Mirrors GET /housing/desk. */
export type HousingCan = Record<string, boolean>

export interface HousingDesk {
  role: string
  title: string
  sections: string[]
  can: HousingCan
  queues?: Record<string, number>
}

export const HOUSING_PAGES: { path: string; label: string; section: string; need?: string }[] = [
  { path: '/housing', label: 'My desk', section: 'overview' },
  { path: '/housing/waiting', label: 'Waiting list', section: 'waiting' },
  { path: '/housing/research', label: 'Research & interviews', section: 'interviews' },
  { path: '/housing/committee', label: 'Allocations committee', section: 'allocations', need: 'committee' },
  { path: '/housing/map', label: 'Stands map', section: 'map' },
  { path: '/housing/allocations', label: 'Allocations & sale', section: 'allocations' },
  { path: '/housing/offers', label: 'Offers & clocks', section: 'allocations' },
  { path: '/housing/cessions', label: 'Cessions', section: 'cessions' },
  { path: '/housing/title', label: 'Title & Deeds', section: 'cessions' },
  { path: '/housing/leases', label: 'Leases', section: 'estates' },
  { path: '/housing/cooperatives', label: 'Cooperatives', section: 'estates' },
  { path: '/housing/servicing', label: 'Servicing', section: 'map', need: 'servicing' },
  { path: '/housing/standards', label: 'HSC Act orders', section: 'standards' },
  { path: '/housing/occupation', label: 'Occupation', section: 'standards' },
  { path: '/housing/repossessions', label: 'Repossessions', section: 'standards' },
  { path: '/housing/notices', label: 'Public notices', section: 'announce' },
  { path: '/housing/schemes', label: 'Schemes', section: 'overview' },
]

export function pagesFor(desk: HousingDesk | null) {
  const sections = desk?.sections || []
  const can = desk?.can || {}
  return HOUSING_PAGES.filter((p) => {
    if (p.need) return !!can[p.need]
    return sections.includes(p.section)
  })
}
