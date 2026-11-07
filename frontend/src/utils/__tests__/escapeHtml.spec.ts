import { describe, it, expect } from 'vitest'
import { escapeHtml } from '../escapeHtml'

describe('escapeHtml', () => {
  it('neutralises a script-injection payload', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    )
  })

  it('escapes all five significant characters', () => {
    expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;')
  })

  it('breaks out of neither text nor attribute context', () => {
    // A would-be `"><script>` attribute breakout becomes inert text.
    expect(escapeHtml('"><script>alert(1)</script>')).toBe(
      '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
    )
  })

  it('collapses null/undefined to an empty string, not the literal word', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })

  it('stringifies non-string values', () => {
    expect(escapeHtml(42)).toBe('42')
  })

  it('leaves a plain name untouched', () => {
    expect(escapeHtml('Tendai Moyo')).toBe('Tendai Moyo')
  })
})
