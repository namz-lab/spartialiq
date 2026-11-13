// @vitest-environment happy-dom
//
// A planning case has two identities: the statutory permit case
// (`spatial_planning.permit_application.id`, a uuid) and the citizen-portal application it was
// raised from (`public.development_applications.id`, recorded on the permit as `dev_app_id`).
// Finance keys a project's link on the second one.
//
// The failure these tests exist to prevent is quiet: pass the permit's id and the lookup succeeds
// and finds nothing, which renders as "no council project is attached" — a statement about the
// council's spending, produced by a mistake about an identifier. Nothing in the UI would show it
// was wrong, and a planner would reasonably read it as fact.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { financeForLinkedRecord } = vi.hoisted(() => ({ financeForLinkedRecord: vi.fn() }))
vi.mock('@/modules/finance/api/financeApi', () => ({
  financeApi: { financeForLinkedRecord },
  financePublicApi: {},
}))

import CaseFinancePanel from '../case/CaseFinancePanel.vue'

/**
 * The finance panel is loaded on demand, and resolving that import is real work (module
 * transform), not a microtask — so it is warmed first and only then are the pending ticks
 * drained. Draining alone leaves the async component unresolved and the panel never mounts.
 */
async function settle(): Promise<void> {
  await import('@/modules/finance/components/LinkedFinancePanel.vue')
  for (let i = 0; i < 4; i++) await flushPromises()
}

const PERMIT_ID = '8f14e45f-ceea-467a-9c2b-1a4f3c9d5e6b'   // permit_application.id — the wrong one
const DEV_APP_ID = 'VRDC-APP-2026-001'                     // development_applications.id

beforeEach(() => {
  vi.clearAllMocks()
  financeForLinkedRecord.mockResolvedValue({
    subject: { kind: 'development_application', id: DEV_APP_ID },
    projects: [], recent_transactions: [], counterparty_visible: false, totals_by_currency: [],
  })
})

describe('council finance on a planning case', () => {
  it('asks the finance register for the portal application, not the permit case', async () => {
    const wrapper = mount(CaseFinancePanel, {
      props: { devAppId: DEV_APP_ID, caseReference: 'TPD/VRDC/2026/0004' },
    })
    await settle()   // the finance panel is loaded on demand

    expect(financeForLinkedRecord).toHaveBeenCalledWith('development_application', DEV_APP_ID)
    expect(financeForLinkedRecord).not.toHaveBeenCalledWith('development_application', PERMIT_ID)
    wrapper.unmount()
  })

  it('does not look the case up at all when it has no portal application', async () => {
    const wrapper = mount(CaseFinancePanel, {
      props: { devAppId: null, caseReference: 'TPD/VRDC/2026/0004' },
    })
    await flushPromises()

    // No request is made, because there is no id this register could be searched by. Searching
    // with the permit's id would answer "nothing attached", which is not the same answer.
    expect(financeForLinkedRecord).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('says the lookup cannot be made, rather than that nothing was spent', async () => {
    const wrapper = mount(CaseFinancePanel, { props: { devAppId: null } })
    await flushPromises()

    expect(wrapper.text()).toContain('no citizen-portal application')
    expect(wrapper.text()).toContain('This is not a statement that nothing was spent')
    // The wording a reader must not be given when the question was never asked.
    expect(wrapper.text()).not.toContain('No council project is attached')
    wrapper.unmount()
  })

  it('never downloads the finance module for a case that has no link', async () => {
    // The absent case is the common one — most applications are captured at the counter. Loading
    // the finance module to render a sentence would put it in every planner's bundle.
    const wrapper = mount(CaseFinancePanel, { props: { devAppId: null } })
    await flushPromises()
    expect(wrapper.find('.lfp').exists()).toBe(false)
    wrapper.unmount()
  })
})
