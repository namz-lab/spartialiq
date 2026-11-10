export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`
}

export function todayIso(): string {
  return new Date().toISOString()
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

export function money(n: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n || 0)
}

export function lineTotal(qty: number, unit: number): number {
  return Math.round(qty * unit * 100) / 100
}

export function docTotal(lines: { qty: number; unitPrice: number }[]): number {
  return Math.round(lines.reduce((s, l) => s + lineTotal(l.qty, l.unitPrice), 0) * 100) / 100
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function daysBetween(fromIso: string, to = new Date()): number {
  return Math.floor((to.getTime() - new Date(fromIso).getTime()) / 86_400_000)
}
