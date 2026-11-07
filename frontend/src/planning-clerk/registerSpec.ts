/**
 * What a section tells ClerkRegister.vue about its register.
 *
 * In their own module rather than exported from the component, for two
 * reasons: `<script setup>` cannot carry ES exports, and a section that only
 * needs the shape of a column should not have to import a component to get it.
 */

/** The five tones the token set defines. Anything else is decoration. */
export type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'negative'

/** One control in a register's "add an entry" form. */
export interface ClerkField {
  name: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'number' | 'date' | 'datetime' | 'checkbox'
  required?: boolean
  options?: readonly { value: string; label: string }[]
  hint?: string
  placeholder?: string
  /** Spans the whole form grid. Use for reasons, addresses and notes. */
  full?: boolean
  step?: string
  /** Seeded when the form opens. A function is called at open time. */
  initial?: string | number | boolean | (() => string | number | boolean)
}

/** One column in a register's table. */
export interface ClerkColumn {
  key: string
  label: string
  /** Machine identifiers — references, receipt numbers, stand numbers. */
  mono?: boolean
  /** Defaults to the raw value; return '—' for nothing. */
  value?: (row: Record<string, unknown>) => string
  /** Renders the cell as a chip in this tone. */
  tone?: (row: Record<string, unknown>) => Tone | null
  /**
   * Never wrap this cell.
   *
   * For dates, amounts and references — values that are a single token to a
   * reader. "21 Sept 2026, 16:45" broken over four lines is not a date any
   * more, it is four things stacked in a column.
   */
  nowrap?: boolean
  /**
   * Dropped below 1024px.
   *
   * Mark everything except the two or three columns that let a clerk tell one
   * row from another. A twelve-column register on a phone is unreadable
   * whether it scrolls or not.
   */
  secondary?: boolean
}

/** Options for a `select`, from the enum a column actually accepts. */
export function options<T extends string>(
  values: readonly T[],
  label: (v: T) => string,
): { value: T; label: string }[] {
  return values.map((value) => ({ value, label: label(value) }))
}
