import { describe, it, expect } from 'vitest'
import { NOT_RECORDED, stamped, toCsv, toRows, type ExportTable } from '../tableExport'

const T: ExportTable = {
  title: 'Ward table',
  asAt: '15 Nov 2026, 10:00',
  source: 'The spatial engine',
  notes: ['The ward list is provisional.'],
  columns: ['Ward', 'Stands', 'Share'],
  rows: [['1', 0, null], ['2, north', 12, 83.3], ['3 "east"', 5, 1.5]],
  totals: { label: 'Total', cells: [17, 'no total (rate)'] },
  extra: [{ label: 'Not in any ward', cells: [0, ''] }],
}

describe('tableExport', () => {
  it('says what the table is before the table: title, as at, source and caveats', () => {
    const rows = toRows(T)
    expect(rows.slice(0, 4)).toEqual([['Ward table'], ['As at 15 Nov 2026, 10:00'], ['Source: The spatial engine'], ['The ward list is provisional.']])
    expect(rows).toContainEqual(['Ward', 'Stands', 'Share'])
  })

  it('writes a missing figure "not recorded", never zero or blank, and keeps a real zero', () => {
    const rows = toRows(T)
    expect(rows).toContainEqual(['1', 0, NOT_RECORDED])
    expect(rows).toContainEqual(['Total', 17, 'no total (rate)'])
    expect(rows).toContainEqual(['Not in any ward', 0, ''])
  })

  it('makes a CSV that Excel reads: a byte-order mark, quoted commas and doubled quotes, CRLF lines', () => {
    const csv = toCsv(T)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('"2, north",12,83.3')
    expect(csv).toContain('"3 ""east""",5,1.5')
    expect(csv).toContain('\r\n')
    expect(csv.split('\r\n')).toContain('1,0,not recorded')
  })

  it('stamps the file name with the date', () => {
    expect(stamped('ward-table', new Date('2026-11-15T10:00:00Z'))).toBe('ward-table-2026-11-15')
  })
})
