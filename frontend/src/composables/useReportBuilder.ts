// ─── useReportBuilder ────────────────────────────────────────────────────
// Pure filtering + CSV export for the ad-hoc report builder (CityView-style
// "ad hoc reports using virtually any field as criteria"). Operates over the
// real permit register (dmApi.listPermits) — no backend report engine needed.
// ───────────────────────────────────────────────────────────────────────────
import type { PermitApplication } from '@/services/developmentManagementService'
import { normalizeStatus } from '@/composables/useApplicationPipeline'

export interface ReportCriteria {
  status?: string
  development_type?: string
  ward?: string
  from?: string   // YYYY-MM-DD
  to?: string
  search?: string
}

export function filterPermits(permits: PermitApplication[], c: ReportCriteria): PermitApplication[] {
  const ward = (c.ward || '').trim().toLowerCase()
  const q = (c.search || '').trim().toLowerCase()
  const from = c.from ? new Date(c.from).getTime() : null
  const to = c.to ? new Date(c.to).getTime() : null
  return permits.filter(p => {
    if (c.status && c.status !== 'all' && normalizeStatus(p.status) !== c.status) return false
    if (c.development_type && c.development_type !== 'all' && p.development_type !== c.development_type) return false
    if (ward && !(p.suburb_ward || '').toLowerCase().includes(ward)) return false
    const recv = p.received_at || p.created_at
    const t = recv ? new Date(recv).getTime() : null
    if (from != null && (t == null || t < from)) return false
    if (to != null && (t == null || t > to)) return false
    if (q) {
      const hay = [p.dev_register_no, p.tpd_reference, p.stand_number, p.applicant_name]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export interface ReportColumn {
  key: string
  label: string
  get: (p: PermitApplication) => string
}

function escapeCsv(s: string): string {
  // Applicant-typed text opens in Excel: a cell starting =, +, @ (or - not
  // followed by a digit) would run as a formula. Prefix it so it stays text.
  if (/^([=+@\t\r]|-(?!\d))/.test(s)) s = `'${s}`
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Save CSV text as a file, with a BOM so Excel reads UTF-8 names correctly. */
export function downloadCsv(csv: string, filename: string): void {
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function toCsv(rows: PermitApplication[], cols: ReportColumn[]): string {
  const head = cols.map(c => escapeCsv(c.label)).join(',')
  const body = rows.map(r => cols.map(c => escapeCsv(c.get(r) ?? '')).join(',')).join('\n')
  return body ? `${head}\n${body}` : head
}
