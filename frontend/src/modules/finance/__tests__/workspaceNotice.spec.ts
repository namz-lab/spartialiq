// @vitest-environment happy-dom
//
// The sentence that explains a redirect. Shown by the workspace frame AND the previous console:
// during the migration most people are redirected into the console, and a redirect without a
// reason reads as a fault.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const replace = vi.fn()
const route = { query: {} as Record<string, string> }
vi.mock('vue-router', () => ({ useRouter: () => ({ replace }), useRoute: () => route }))

import WorkspaceNotice from '../shell/WorkspaceNotice.vue'

beforeEach(() => { route.query = {}; replace.mockReset() })

describe('WorkspaceNotice', () => {
  it.each([
    ['not-yours', 'That workspace is not one of yours. You have been returned to your own work.'],
    ['not-built', 'That workspace is not available yet.'],
    ['unavailable', 'The page in that link is not part of your finance workspaces.'],
  ])('explains %s', (notice, sentence) => {
    route.query = { notice }
    expect(mount(WorkspaceNotice).get('[role="status"]').text()).toContain(sentence)
  })

  it('renders nothing without a notice, or with one it does not know', () => {
    expect(mount(WorkspaceNotice).html()).not.toContain('role="status"')
    route.query = { notice: 'made-up' }
    expect(mount(WorkspaceNotice).html()).not.toContain('role="status"')
  })

  it('dismisses by dropping the notice and keeping the rest of the address', async () => {
    route.query = { notice: 'not-yours', section: 'ledger' }
    await mount(WorkspaceNotice).get('button').trigger('click')
    expect(replace).toHaveBeenCalledWith({ query: { section: 'ledger' } })
  })
})
