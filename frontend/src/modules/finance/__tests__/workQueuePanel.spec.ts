// @vitest-environment happy-dom
//
// The panel that shows a role what is waiting on it.
//
// Three things are pinned here because each of them has gone wrong in this module before:
//   - an empty queue renders a sentence, not a blank panel or a spinner;
//   - a count that could not be read renders as "could not be read", not as 0;
//   - nothing is conveyed by colour alone and every control is a real, focusable button.
//
// And one thing is pinned because it is the point of the panel: the separation-of-duties caveat
// travels with its queue, so a committee member reading "3 awaiting your decision" also reads that
// two more are their own request and are waiting on somebody else.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import FinanceWorkQueue from '../components/FinanceWorkQueue.vue'
import { useFinanceStore } from '../stores/finance'
import type { FinanceQueue } from '../composables/useFinanceQueues'
import type { FinanceIdentity } from '../models/types'

const identity = (role: string, permissions: string[]): FinanceIdentity => ({
  user_id: 'me', role, authority_id: 1, permissions, department_scope: [], catalogue: [],
})

const queue = (over: Partial<FinanceQueue>): FinanceQueue => ({
  id: 'q1', count: 0, label: 'Budget lines awaiting your approval',
  help: 'A submitted line is waiting on a decision.',
  empty: 'No budget line has been submitted for approval in this period.',
  tone: 'action', toneLabel: 'Needs a decision', section: 'budget', ...over,
})

const mountPanel = (queues: FinanceQueue[], loading = false, error: string | null = null) =>
  mount(FinanceWorkQueue, { props: { queues, loading, error } })

beforeEach(() => {
  setActivePinia(createPinia())
  const store = useFinanceStore()
  store.identity = identity('finance_committee', [
    'finance.budget.view', 'finance.budget.approve', 'finance.revision.approve',
  ])
})

describe('the work queue panel', () => {
  it('states what the role is here to do, from the preset', () => {
    const wrapper = mountPanel([])
    expect(wrapper.text()).toMatch(/You decide what the council approves/)
    expect(wrapper.text()).toMatch(/cannot approve your own request/)
  })

  it('shows a count, its label and a way to get to the work', () => {
    const wrapper = mountPanel([queue({ count: 3, query: { status: 'submitted' } })])
    expect(wrapper.find('.fin-queue-number').text()).toBe('3')
    expect(wrapper.text()).toContain('Budget lines awaiting your approval')
    const go = wrapper.find('.fin-queue-go')
    // A real button, not a clickable div: operable by keyboard and in the focus order.
    expect(go.element.tagName).toBe('BUTTON')
    expect(go.attributes('type')).toBe('button')
  })

  it('emits the section and its filter so the queue link opens the work already filtered', async () => {
    const wrapper = mountPanel([queue({ count: 3, query: { status: 'submitted' } })])
    await wrapper.find('.fin-queue-go').trigger('click')
    expect(wrapper.emitted('open')).toEqual([['budget', { status: 'submitted' }]])
  })

  it('names the queue inside the button, so "Open" is not the whole accessible name', () => {
    const wrapper = mountPanel([queue({ count: 1 })])
    expect(wrapper.find('.fin-queue-go').text()).toContain('Budget lines awaiting your approval')
  })

  it('carries a word beside every tone, so state is never colour alone', () => {
    const wrapper = mountPanel([
      queue({ id: 'a', count: 1, tone: 'action', toneLabel: 'Needs a decision' }),
      queue({ id: 'b', count: 2, tone: 'watch', toneLabel: 'Worth a look' }),
    ])
    expect(wrapper.text()).toContain('Needs a decision')
    expect(wrapper.text()).toContain('Worth a look')
  })

  it('keeps the separation-of-duties caveat with the queue it qualifies', () => {
    const wrapper = mountPanel([queue({
      count: 1,
      caveat: '2 further submitted revisions are your own request and are awaiting another approver.',
    })])
    expect(wrapper.text()).toContain('awaiting another approver')
  })

  it('announces the total through one polite live region, not one per row', () => {
    const wrapper = mountPanel([
      queue({ id: 'a', count: 3 }),
      queue({ id: 'b', count: 2, label: 'Revisions awaiting your decision', section: 'revisions' }),
    ])
    const live = wrapper.findAll('[aria-live="polite"]')
    expect(live).toHaveLength(1)
    expect(live[0].text()).toBe('5 items waiting on you, across 2 queues.')
  })

  it('says plainly that nothing is waiting, rather than rendering an empty panel', () => {
    const store = useFinanceStore()
    store.years = [{
      id: 'y1', label: '2031', start_date: '2031-01-01', end_date: '2031-12-31',
      status: 'open', reporting_currency: 'USD', notes: null, opened_at: null, closed_at: null,
    }]
    store.selectYear('y1')
    const wrapper = mountPanel([queue({ count: 0 })])
    expect(wrapper.text()).toContain('Nothing is waiting on you in 2031.')
    // And the per-queue sentence, so "nothing" is specific rather than a shrug.
    expect(wrapper.text()).toContain('No budget line has been submitted for approval in this period.')
    expect(wrapper.find('.fin-queue-number').exists()).toBe(false)
  })

  it('reports an unreadable count as unknown and says it is not the same as nothing', () => {
    const wrapper = mountPanel([queue({ count: null })])
    expect(wrapper.text()).toMatch(/could not be read/)
    expect(wrapper.text()).toMatch(/not the same as\s+nothing being there/)
    // Crucially: no zero anywhere.
    expect(wrapper.find('.fin-queue-number').exists()).toBe(false)
  })

  it('explains itself to a role that is in none of the handovers', () => {
    const store = useFinanceStore()
    store.identity = identity('planner', ['finance.budget.view'])
    const wrapper = mountPanel([])
    expect(wrapper.text()).toMatch(/no queue for your role in this period/)
    expect(wrapper.text()).toMatch(/still open to you/)
  })

  it('states the deliberate absences rather than leaving a gap in the rail', () => {
    const store = useFinanceStore()
    // A finance administrator: twenty-six permissions, and no authority over finance accounts.
    store.identity = identity('finance_admin', [
      'finance.config.manage', 'finance.budget.view', 'finance.import.commit',
    ])
    const wrapper = mountPanel([])
    expect(wrapper.text()).toMatch(/provisioned by the technical administrator/)
  })

  it('shows a loading line while the first read is in flight, and no counts', () => {
    const wrapper = mountPanel([], true)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Reading what is waiting on you')
    expect(wrapper.find('.fin-queue-number').exists()).toBe(false)
  })

  it('reports a total failure as an alert, not as an empty queue', () => {
    const wrapper = mountPanel([], false, 'What is waiting on you could not be read.')
    const alert = wrapper.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('could not be read')
  })
})

describe('the false "setup is incomplete" claim', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('is not made while the reference data is still being read', () => {
    const store = useFinanceStore()
    store.loadingReference = true
    // The three arrays are empty, so needsSetup says yes — and the claim must not be made on it.
    expect(store.needsSetup.any).toBe(true)
    expect(store.setupStatusKnown).toBe(false)
  })

  it('is not made before any read has happened at all', () => {
    const store = useFinanceStore()
    expect(store.needsSetup.any).toBe(true)
    expect(store.setupStatusKnown).toBe(false)
  })

  it('is not made when the read failed, because an empty array is then not a fact', () => {
    const store = useFinanceStore()
    store.referenceLoaded = true
    store.referenceError = 'Could not load departments.'
    expect(store.setupStatusKnown).toBe(false)
  })

  it('is made once a clean read has finished and the council really has nothing', () => {
    const store = useFinanceStore()
    store.referenceLoaded = true
    store.loadingReference = false
    store.referenceError = null
    expect(store.setupStatusKnown).toBe(true)
    expect(store.needsSetup.any).toBe(true)
  })
})
