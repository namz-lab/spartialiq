// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(__dirname, '../PaymentReceiptView.vue'), 'utf8',
)

describe('PaymentReceiptView letterhead', () => {
  it('uses the shared component', () => {
    expect(source).toContain('<CouncilLetterhead')
  })

  it('no longer uses the shield emoji as a coat of arms', () => {
    expect(source).not.toContain('\u{1F6E1}')
  })

  it('no longer hard-codes the council address', () => {
    expect(source).not.toContain('Stand 1, Gweru Road')
  })

  /*
   * The letterhead component is scoped, so the receipt's Stitch palette cannot
   * reach inside it. Without these hooks the council name silently reverted
   * from the receipt's ink to the component's default green.
   */
  it('maps its own palette onto the letterhead theming hooks', () => {
    expect(source).toMatch(/--lh-name-color:\s*var\(--stitch-primary\)/)
    expect(source).toMatch(/--lh-sub-color:\s*var\(--stitch-on-surface-muted\)/)
    expect(source).toMatch(/--lh-doctype-color:\s*var\(--stitch-secondary\)/)
    expect(source).toMatch(/--lh-name-font:\s*'Public Sans'/)
  })
})
