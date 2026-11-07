/**
 * The periodic environmental health return — pure aggregation.
 *
 * Every figure in the Council and Ministry of Health return is computed here
 * from the records, for a closed date window, so the number on the PDF is the
 * number the test checks. No Vue, no network.
 *
 * WINDOW RULE
 * A record belongs to the period of the date that makes it that kind of event:
 * an inspection by when it was carried out, a notice by when it was served, an
 * outbreak by when it was first reported, a programme round by its schedule, a
 * certificate by its issue. Both ends of the window are inclusive.
 */

export interface ReportInput {
  inspections: { inspectedAt: string; verdict: string; scope: string }[]
  notices: { servedAt: string; status: string; noticeType: string; escalation: string | null }[]
  outbreaks: { firstReportedAt: string; disease: string; casesCount: number; status: string }[]
  samples: { sampledAt: string; result: string }[]
  complaints: { receivedAt: string; status: string; category: string }[]
  programmes: {
    scheduledFor: string; status: string; programmeType: string
    targetQuantity: number | null; achievedQuantity: number | null; quantityUnit: string | null
  }[]
  handlers: { issuedAt: string; revokedAt: string | null }[]
  burials: { issuedAt: string; cancelledAt: string | null; permitKind: string }[]
  clearances: { decidedAt: string | null; status: string }[]
}

export interface ReportLine { label: string; value: string | number; emphasis?: boolean }
export interface ReportBlock { title: string; lines: ReportLine[] }

export interface Period { from: Date; to: Date; label: string }

export type PeriodKey = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year'

export function periodFor(key: PeriodKey, now = new Date()): Period {
  const y = now.getFullYear()
  const m = now.getMonth()
  const end = (yy: number, mm: number) => new Date(yy, mm + 1, 0, 23, 59, 59, 999)
  const monthLabel = (yy: number, mm: number) => new Date(yy, mm, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  switch (key) {
    case 'this_month': return { from: new Date(y, m, 1), to: end(y, m), label: monthLabel(y, m) }
    case 'last_month': return { from: new Date(y, m - 1, 1), to: end(y, m - 1), label: monthLabel(y, m - 1) }
    case 'this_quarter': {
      const q = Math.floor(m / 3)
      return { from: new Date(y, q * 3, 1), to: end(y, q * 3 + 2), label: `Q${q + 1} ${y}` }
    }
    case 'last_quarter': {
      const q = Math.floor(m / 3) - 1
      const qy = q < 0 ? y - 1 : y
      const qq = (q + 4) % 4
      return { from: new Date(qy, qq * 3, 1), to: end(qy, qq * 3 + 2), label: `Q${qq + 1} ${qy}` }
    }
    default: return { from: new Date(y, 0, 1), to: new Date(y, 11, 31, 23, 59, 59, 999), label: `Year ${y}` }
  }
}

export function inWindow(iso: string | null | undefined, p: Period): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return !Number.isNaN(t) && t >= p.from.getTime() && t <= p.to.getTime()
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—')
const human = (k: string) => { const s = k.replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1) }

function tally<T>(items: T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>()
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

export function buildReport(input: ReportInput, p: Period): ReportBlock[] {
  const insp = input.inspections.filter(i => inWindow(i.inspectedAt, p))
  const decided = insp.filter(i => i.verdict !== 'pending')
  const passed = decided.filter(i => i.verdict === 'pass').length
  const notices = input.notices.filter(n => inWindow(n.servedAt, p))
  const outbreaks = input.outbreaks.filter(o => inWindow(o.firstReportedAt, p))
  const samples = input.samples.filter(s => inWindow(s.sampledAt, p))
  const tested = samples.filter(s => s.result !== 'pending')
  const complaints = input.complaints.filter(c => inWindow(c.receivedAt, p))
  const rounds = input.programmes.filter(r => inWindow(r.scheduledFor, p))
  const handlers = input.handlers.filter(h => inWindow(h.issuedAt, p))
  const burials = input.burials.filter(b => inWindow(b.issuedAt, p))
  const clearances = input.clearances.filter(c => inWindow(c.decidedAt, p))

  const blocks: ReportBlock[] = [
    { title: 'Premises inspections', lines: [
      { label: 'Inspections carried out', value: insp.length, emphasis: true },
      { label: 'Passed', value: passed },
      { label: 'Conditional', value: decided.filter(i => i.verdict === 'conditional').length },
      { label: 'Failed', value: decided.filter(i => i.verdict === 'fail').length },
      // Compliance is over decided inspections: a pending result is not a failure.
      { label: 'Compliance rate', value: pct(passed, decided.length), emphasis: true },
      ...tally(insp, i => i.scope).map(([k, v]) => ({ label: `— ${human(k)}`, value: v })),
    ] },
    { title: 'Enforcement', lines: [
      { label: 'Notices served', value: notices.length, emphasis: true },
      ...tally(notices, n => n.noticeType).map(([k, v]) => ({ label: `— ${human(k)}`, value: v })),
      { label: 'Complied with', value: notices.filter(n => n.status === 'complied').length },
      { label: 'Escalated to prosecution', value: notices.filter(n => n.escalation === 'prosecution').length },
      { label: 'Still open', value: notices.filter(n => ['served', 'extended', 'non_complied'].includes(n.status)).length },
    ] },
    { title: 'Disease surveillance', lines: [
      { label: 'Outbreaks reported', value: outbreaks.length, emphasis: true },
      { label: 'Cases', value: outbreaks.reduce((s, o) => s + o.casesCount, 0) },
      ...tally(outbreaks, o => o.disease).map(([k, v]) => ({ label: `— ${human(k)}`, value: v })),
      { label: 'Closed within the period', value: outbreaks.filter(o => o.status === 'closed').length },
    ] },
    { title: 'Water quality', lines: [
      { label: 'Samples taken', value: samples.length, emphasis: true },
      { label: 'Potable', value: tested.filter(s => s.result === 'potable').length },
      { label: 'Borderline', value: tested.filter(s => s.result === 'borderline').length },
      { label: 'Not potable', value: tested.filter(s => s.result === 'not_potable').length },
      { label: 'Failure rate (of tested)', value: pct(tested.filter(s => s.result === 'not_potable').length, tested.length), emphasis: true },
    ] },
    { title: 'Nuisance complaints', lines: [
      { label: 'Received', value: complaints.length, emphasis: true },
      { label: 'Abated or closed', value: complaints.filter(c => c.status === 'abated' || c.status === 'closed').length },
      ...tally(complaints, c => c.category).map(([k, v]) => ({ label: `— ${human(k)}`, value: v })),
    ] },
    { title: 'Field programmes', lines: [
      { label: 'Rounds scheduled', value: rounds.length, emphasis: true },
      { label: 'Completed', value: rounds.filter(r => r.status === 'completed').length },
      { label: 'Cancelled', value: rounds.filter(r => r.status === 'cancelled').length },
      ...programmeCoverage(rounds),
    ] },
    { title: 'Certificates, permits and clearances', lines: [
      { label: 'Food-handler certificates issued', value: handlers.length },
      { label: 'Burial / exhumation permits issued', value: burials.filter(b => !b.cancelledAt).length },
      { label: 'Licence clearances decided', value: clearances.length },
      { label: '— cleared or conditional', value: clearances.filter(c => c.status === 'cleared' || c.status === 'conditional').length },
      { label: '— refused', value: clearances.filter(c => c.status === 'refused').length },
    ] },
  ]
  return blocks
}

/** Achieved over target per programme type, only within one stated unit. */
function programmeCoverage(rounds: ReportInput['programmes']): ReportLine[] {
  const byType = new Map<string, ReportInput['programmes']>()
  for (const r of rounds) byType.set(r.programmeType, [...(byType.get(r.programmeType) ?? []), r])
  const lines: ReportLine[] = []
  for (const [type, rs] of byType) {
    const unit = rs.find(r => r.quantityUnit)?.quantityUnit
    if (!unit) continue
    const same = rs.filter(r => r.quantityUnit === unit && r.status !== 'cancelled')
    const target = same.reduce((s, r) => s + (r.targetQuantity ?? 0), 0)
    const achieved = same.filter(r => r.status === 'completed').reduce((s, r) => s + (r.achievedQuantity ?? 0), 0)
    lines.push({ label: `— ${human(type)}`, value: target ? `${achieved} of ${target} ${unit} (${pct(achieved, target)})` : `${achieved} ${unit}` })
  }
  return lines
}

/** CSV with every value quoted — ward names and categories contain commas. */
export function reportCsv(blocks: ReportBlock[], p: Period): string {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const out = [[q('Period'), q(p.label)].join(','), [q('Section'), q('Indicator'), q('Value')].join(',')]
  for (const b of blocks) for (const l of b.lines) out.push([q(b.title), q(l.label.replace(/^— /, '  ')), q(l.value)].join(','))
  return out.join('\r\n')
}
