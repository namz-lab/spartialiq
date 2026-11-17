/**
 * Small helpers the Revenue and Rates pages share: the ageing buckets as a statement prints them,
 * reading every page of a list for an export, and writing a CSV the way a spreadsheet opens it.
 *
 * Money stays as the server's strings throughout: an export carries `"1234.50"`, never a float.
 */
import type { AgeingBucket } from '../../models/ledgerTypes'

/** The owing buckets, oldest last, with the ledger's own labels (backend AGEING_LABELS). */
export const OWING_BUCKETS: ReadonlyArray<{ value: AgeingBucket; label: string }> = [
  { value: 'current', label: 'Not yet 30 days' },
  { value: '31_60', label: '31 to 60 days' },
  { value: '61_90', label: '61 to 90 days' },
  { value: '91_180', label: '91 to 180 days' },
  { value: '181_365', label: '181 to 365 days' },
  { value: 'over_365', label: 'Over a year' },
]

const BUCKET_LABEL: Record<string, string> = {
  ...Object.fromEntries(OWING_BUCKETS.map((b) => [b.value, b.label])),
  settled: 'Settled in full',
  unallocated: 'Received, not yet matched to a bill',
}
export const bucketLabel = (b: string | null | undefined): string => (b ? BUCKET_LABEL[b] ?? b : '—')

/** The server's page size ceiling (`paging.limit.maximum` in finance-rates.js). */
export const PAGE_MAX = 200

/**
 * Every row of a paged list, a page at a time, up to `cap` rows. Returns the rows and whether the
 * cap cut the list short, so an export can say so rather than pass a part off as the whole.
 */
export async function readAll<T>(
  page: (limit: number, offset: number) => Promise<{ rows: T[]; total: number }>,
  cap = 5000,
): Promise<{ rows: T[]; total: number; truncated: boolean }> {
  const rows: T[] = []
  let total = 0
  for (let offset = 0; offset < cap; offset += PAGE_MAX) {
    const r = await page(Math.min(PAGE_MAX, cap - offset), offset)
    total = r.total
    rows.push(...r.rows)
    if (!r.rows.length || rows.length >= total) break
  }
  return { rows, total, truncated: rows.length < total }
}

export function csvCell(v: string | number | null | undefined): string {
  const s = String(v ?? '')
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(head: string[], rows: Array<Array<string | number | null | undefined>>): string {
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function downloadCsv(filename: string, text: string): void {
  // The byte-order mark makes Excel read the file as UTF-8 (names with accents, the ZiG sign).
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
