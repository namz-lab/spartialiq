// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import CouncilLetterhead from '../CouncilLetterhead.vue'

describe('CouncilLetterhead', () => {
  it('renders the council name and address as text', () => {
    const w = mount(CouncilLetterhead, { props: { docType: 'OFFICIAL RECEIPT' } })
    expect(w.text()).toContain('VUNGU RURAL DISTRICT COUNCIL')
    expect(w.text()).toContain('Stand 1, Gweru Road, Gweru, Zimbabwe')
  })

  it('renders the document type and reference it was given', () => {
    const w = mount(CouncilLetterhead, {
      props: { docType: 'OFFICIAL RECEIPT', reference: 'RCP-0042' },
    })
    expect(w.text()).toContain('OFFICIAL RECEIPT')
    expect(w.text()).toContain('RCP-0042')
  })

  it('attempts the artwork', () => {
    const w = mount(CouncilLetterhead, { props: { docType: 'NOTICE' } })
    expect(w.find('img').attributes('src')).toBe('/letterhead/council-letterhead.png')
  })

  it('falls back to the typographic mark when the artwork fails to load', async () => {
    const w = mount(CouncilLetterhead, { props: { docType: 'NOTICE' } })
    await w.find('img').trigger('error')
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).toContain('VUNGU RURAL DISTRICT COUNCIL')
  })

  it('never renders an emoji as the coat of arms', () => {
    const w = mount(CouncilLetterhead, { props: { docType: 'NOTICE' } })
    expect(w.text()).not.toContain('\u{1F6E1}')
  })
})

/*
 * The receipt asserts it SETS these hooks. Without the matching assertion
 * that the component READS them, renaming one here would leave both suites
 * green while the host document silently lost its theme.
 */
describe('CouncilLetterhead theming contract', () => {
  const source = readFileSync(
    resolve(__dirname, '../CouncilLetterhead.vue'), 'utf8',
  )

  it.each([
    '--lh-name-color',
    '--lh-sub-color',
    '--lh-doctype-color',
    '--lh-ref-color',
    '--lh-name-font',
    '--lh-ref-size',
  ])('reads %s, with a fallback', (hook) => {
    // `var(<hook>,` — the comma proves a fallback follows, so an unthemed
    // host still renders the council's own ink.
    expect(source).toContain(`var(${hook},`)
  })
})
