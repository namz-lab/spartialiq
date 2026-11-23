// Tables out of the system, for the people who report upward: the council's officials asked for the figures "as a table, with totals" and "in Excel
// and PDF" (the Chegutu review), because they are copied into reports and read outside the system. Client-side: the data is what the screen already
// holds for a signed-in reader, so nothing new is exposed.
//
// Every export says what it is: a title, "as at", where the figures come from, and the caveats that apply (provisional wards, decisions affirmed for
// testing). A missing figure is written "not recorded", never as zero or a blank, so a spreadsheet cannot read a gap as a nought.

export type Cell = string | number | null

export interface ExportTable {
  title: string
  /** When the figures were read, as the screen shows it. */
  asAt: string
  /** Where they come from, in a line. */
  source?: string
  /** Caveats that travel with the figures. */
  notes?: string[]
  columns: string[]
  rows: Cell[][]
  /** A total row, written after the rows; null cells are written "not recorded" unless `blankTotals` marks them as having no total. */
  totals?: { label: string; cells: Cell[] }
  /** Extra lines after the totals (for example "Not in any ward"). */
  extra?: Array<{ label: string; cells: Cell[] }>
}

export const NOT_RECORDED = 'not recorded'

const show = (c: Cell): string | number => (c === null || c === undefined ? NOT_RECORDED : c)

/** The rows of the sheet: heading block, the table, totals and extra lines. */
export function toRows(t: ExportTable): Array<Array<string | number>> {
  const out: Array<Array<string | number>> = [[t.title], [`As at ${t.asAt}`]]
  if (t.source) out.push([`Source: ${t.source}`])
  for (const n of t.notes ?? []) out.push([n])
  out.push([], t.columns.slice())
  for (const r of t.rows) out.push(r.map(show))
  if (t.totals) out.push([t.totals.label, ...t.totals.cells.map(show)])
  for (const e of t.extra ?? []) out.push([e.label, ...e.cells.map(show)])
  return out
}

const csvCell = (v: string | number): string => {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV with a byte-order mark so Excel reads the accents and the "·" correctly. */
export function toCsv(t: ExportTable): string {
  return '﻿' + toRows(t).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** "ward-table-2026-11-15" from a base name. */
export function stamped(base: string, now = new Date()): string {
  return `${base}-${now.toISOString().slice(0, 10)}`
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCsv(t: ExportTable, base: string) {
  save(new Blob([toCsv(t)], { type: 'text/csv;charset=utf-8' }), `${stamped(base)}.csv`)
}

/** An Excel sheet name: at most 31 characters, none of \ / ? * [ ] : */
export const sheetName = (title: string): string => title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Table'

/** Excel (.xlsx). The library is loaded on demand: it is large and most pages never export. */
export async function downloadExcel(t: ExportTable, base: string) {
  // exceljs, not SheetJS: the npm `xlsx` package stopped at 0.18.5, which carries unfixed advisories.
  // A CommonJS package: the bundler hands it over as `default`, while its types declare named exports.
  const mod = await import('exceljs')
  const { Workbook } = (mod as unknown as { default?: typeof mod }).default ?? mod
  const wb = new Workbook()
  const ws = wb.addWorksheet(sheetName(t.title))
  ws.addRows(toRows(t))
  // the title row wide enough to read, the first column wide for the names
  ws.columns = [{ width: 34 }, ...t.columns.slice(1).map(() => ({ width: 18 }))]
  const data = await wb.xlsx.writeBuffer()
  save(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${stamped(base)}.xlsx`)
}
