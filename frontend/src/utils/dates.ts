/**
 * Dates and small text shapes, as the registers need them.
 *
 * These seven were written twice — once for the EHO console, once for the EO
 * planner console — and a third copy was about to be written for the appeals
 * register. They are here so "overdue", "—" for an empty date, and "Ward 3"
 * mean exactly one thing across the product.
 *
 * en-GB throughout: a Zimbabwean council writes 3 Feb 2026, never Feb 3.
 */

export const DAY_MS = 86_400_000

/** Whole days from `iso` to `now`. Null when there is no usable date. */
export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : Math.floor((now - t) / DAY_MS)
}

/** Days until `iso`, negative once passed. Null when there is no usable date. */
export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : Math.ceil((t - now) / DAY_MS)
}

export function fmtDate(iso: string | null | undefined, empty = '—'): string {
  if (!iso) return empty
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? empty
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateTime(iso: string | null | undefined, empty = '—'): string {
  if (!iso) return empty
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? empty
    : d.toLocaleString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
}

/** `YYYY-MM-DD` in local time, for `<input type="date">` values. */
export function isoDay(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** "food_poisoning" → "Food poisoning". */
export function humanise(key: string | null | undefined): string {
  if (!key) return '—'
  const s = key.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * "3" and "Ward 3" both arrive from the registers — officers type either.
 * Shown as "Ward 3" once, never "Ward Ward 3".
 */
export function wardLabel(ward: string | null | undefined): string {
  const w = (ward ?? '').trim()
  if (!w) return '—'
  return /^ward\b/i.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : `Ward ${w}`
}
