import { describe, it, expect } from 'vitest'
import { councilDoc } from '../documents'

function textOf(d: { doc: unknown }): string {
  // @ts-expect-error - internal, but stable
  return d.doc.internal.pages.flat().join(' ')
}

describe('councilDoc', () => {
  it('renders the shared council letterhead', () => {
    const d = councilDoc('Abatement notice', 'REF/001')
    const text = textOf(d)
    expect(text).toContain('VUNGU RURAL DISTRICT COUNCIL')
    expect(text).toContain('Department of Environmental Health')
  })

  it('renders the address, which the old hand-drawn header omitted', () => {
    expect(textOf(councilDoc('Abatement notice', 'REF/001')))
      .toContain('Stand 1, Gweru Road, Gweru, Zimbabwe')
  })

  it('still renders the title and subtitle it was given', () => {
    const text = textOf(councilDoc('Abatement notice', 'REF/001'))
    expect(text).toContain('ABATEMENT NOTICE')
    expect(text).toContain('REF/001')
  })

  it('leaves the cursor clear of the letterhead', () => {
    expect(councilDoc('Abatement notice', 'REF/001').y).toBeGreaterThan(45)
  })
})
