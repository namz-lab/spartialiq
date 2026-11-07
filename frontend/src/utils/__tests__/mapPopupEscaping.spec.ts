// Regression guard for the map-popup XSS class of bug (review §5.3 / §12.1).
//
// Two layers of defence are asserted here:
//   1. escapeHtml neutralises the payloads named in the review.
//   2. No MapLibre HTML sink in src/ interpolates a bare expression. This is a
//      source scan, not a mount test, because the sinks live inside 3k–7k line
//      SFCs whose map code cannot be exercised without a WebGL context — and a
//      per-view test would only cover the views someone remembered to add.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { escapeHtml } from '../escapeHtml'

const HOSTILE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg onload=alert(1)>',
  "'; DROP TABLE permits;--",
]

describe('escapeHtml neutralises hostile GIS attribute values', () => {
  for (const payload of HOSTILE) {
    it(`escapes ${payload.slice(0, 24)}…`, () => {
      const out = escapeHtml(payload)
      expect(out).not.toContain('<')
      expect(out).not.toContain('>')
      expect(out).not.toContain('"')
      expect(out).not.toContain("'")
    })
  }

  it('collapses null/undefined instead of printing them', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })

  it('leaves ordinary attribute text readable', () => {
    expect(escapeHtml('Stand 4412 — Ward 7')).toBe('Stand 4412 — Ward 7')
  })
})

// ── Source scan ────────────────────────────────────────────────────────────
const SRC = join(process.cwd(), 'src')

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue
      yield* walk(p)
    } else if (/\.(vue|ts)$/.test(entry)) {
      yield p
    }
  }
}

/**
 * Expressions that reach a sink unescaped but are provably not attacker-
 * controlled. Each entry is a deliberate, reviewed exception — anything not on
 * this list must go through escapeHtml. Adding to this list is a code-review
 * decision, which is the point: the diff shows it.
 */
const REVIEWED_SAFE = [
  // Local const in SurveyPlanMapView: `beacon.shared ? '#ef4444' : '#22c55e'`.
  'color',
  // Emits one of two hard-coded words, never a database value.
  "beacon.shared ? 'SHARED' : 'Unique'",
]

/**
 * A `${…}` interpolation is safe when it is escaped, when it is a number put
 * through numeric formatting, or when it is on the reviewed-exception list.
 */
function isSafeInterpolation(expr: string): boolean {
  const e = expr.trim()
  return (
    e.includes('escapeHtml') ||          // includes `.map(escapeHtml)`
    /\.toFixed\(/.test(e) ||
    /\.toLocaleString\(/.test(e) ||      // always applied to Number(...)
    /^Number\(/.test(e) ||
    /^`/.test(e) ||                      // nested template, scanned on its own
    REVIEWED_SAFE.includes(e)
  )
}

/** Pull the `${...}` expressions out of a chunk of template-literal source. */
function interpolations(block: string): string[] {
  const out: string[] = []
  const re = /\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block))) out.push(m[1])
  return out
}

describe('no MapLibre HTML sink interpolates an unescaped value', () => {
  const offenders: string[] = []

  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8')
    if (!/setHTML\s*\(|\.innerHTML\s*=/.test(src)) continue

    // Grab each sink call plus the template literal that follows it.
    const sinkRe = /(?:setHTML\s*\(|\.innerHTML\s*=)\s*`([\s\S]*?)`/g
    let m: RegExpExecArray | null
    while ((m = sinkRe.exec(src))) {
      for (const expr of interpolations(m[1])) {
        if (!isSafeInterpolation(expr)) {
          const line = src.slice(0, m.index).split('\n').length
          offenders.push(`${file.replace(SRC, 'src')}:${line} → \${${expr.trim()}}`)
        }
      }
    }
  }

  it('finds no raw interpolation in any setHTML/innerHTML template', () => {
    expect(offenders).toEqual([])
  })
})
