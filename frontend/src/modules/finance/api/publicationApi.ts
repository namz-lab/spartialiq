/**
 * The whole publication record, for the publisher's log and version history.
 *
 * `GET /finance/publications` pages at most 200 rows (default 50). `financeApi.publications()` reads
 * one default page, which is right for a queue but wrong for a log: a council with more than fifty
 * releases would have its oldest silently missing. This reads every page.
 *
 * The server sends `p.*`, so each row carries the ids of who requested, approved, published and
 * withdrew it. The log compares them to show whether approving and publishing were done by
 * different people; it never decides anything with them.
 */
import api from '../../../services/api'
import type { Publication, PublicationDataset, PublicationState } from '../models/types'

const unwrap = <T>(r: { data?: { data?: T } }): T => (r.data?.data ?? r.data) as T

export interface PublicationRecord extends Publication {
  created_by?: string | null
  reviewed_by?: string | null
  approved_by?: string | null
  published_by?: string | null
  withdrawn_by?: string | null
}

export interface PublicationFilter {
  financial_year_id?: string
  dataset?: PublicationDataset
  state?: PublicationState
}

const PAGE = 200
/** A guard against an endless read, far above any council's release count. */
const MAX_PAGES = 25

export const publicationApi = {
  async all(filter: PublicationFilter = {}): Promise<{ rows: PublicationRecord[]; truncated: boolean }> {
    const rows: PublicationRecord[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = unwrap<PublicationRecord[]>(await api.get('/finance/publications', { params: { ...filter, limit: PAGE, offset: page * PAGE } }))
      rows.push(...batch)
      if (batch.length < PAGE) return { rows, truncated: false }
    }
    return { rows, truncated: true }
  },
}

/** The releases of one dataset for one year and period, newest version first. */
export interface VersionChain {
  key: string
  dataset: PublicationDataset
  year: string
  period: string | null
  versions: PublicationRecord[]
  live: PublicationRecord | null
}

export function versionChains(rows: PublicationRecord[]): VersionChain[] {
  const map = new Map<string, VersionChain>()
  for (const r of rows) {
    const key = `${r.dataset}|${r.financial_year_id}|${r.reporting_period_label ?? ''}`
    let chain = map.get(key)
    if (!chain) {
      chain = { key, dataset: r.dataset, year: (r.financial_year_label ?? '').split(' (')[0], period: r.reporting_period_label, versions: [], live: null }
      map.set(key, chain)
    }
    chain.versions.push(r)
  }
  for (const c of map.values()) {
    c.versions.sort((a, b) => b.version - a.version)
    c.live = c.versions.find((v) => v.state === 'published') ?? null
  }
  return [...map.values()].sort((a, b) => b.year.localeCompare(a.year) || a.dataset.localeCompare(b.dataset))
}

/** True when one person both approved and published a release. Unknown ids are not a finding. */
export const sameApproverAndPublisher = (p: PublicationRecord): boolean =>
  Boolean(p.approved_by && p.published_by && p.approved_by === p.published_by)
