// @vitest-environment happy-dom
//
// Functional completeness (client amendment §13.4).
//
// Every place the previous console could open — each section and each tab that becomes its own
// screen — must be served by some workspace in this build, or be listed below as PENDING with the
// phase that will serve it. A target that is both is a stale list; a target that is neither is
// functionality the migration dropped. Each workspace plan deletes the lines it serves.
import { describe, it, expect } from 'vitest'
import '../workspaces'
import { builtWorkspaces, registrationOf } from '../shell/workspaces'
import { FINANCE_TARGETS, SECTION_TARGETS, type FinanceTarget } from '../shell/targets'
import { targetOf, type FinanceQueue } from '../composables/useFinanceQueues'

const PENDING: Partial<Record<FinanceTarget, string>> = {
  // Every target is now served: the cash office by the Cash Office (workspaces/cashier), the ledger
  // and statements by Accounting, budget work by Budget Management, configuration by Finance
  // Management, transactions and imports by Finance Operations, the trail by Internal Audit, rates
  // by Revenue, the overview and map by Executive Finance, publication and documents by Publication.
}

const served = new Set<FinanceTarget>(
  builtWorkspaces().flatMap((k) => Object.keys(registrationOf(k)?.serves ?? {}) as FinanceTarget[]),
)

describe('every target the previous console could open', () => {
  it.each(FINANCE_TARGETS.map((t) => [t]))('%s is served by a workspace or pending a phase', (target) => {
    const pending = target in PENDING
    expect(served.has(target) || pending, `${target} is neither served nor pending`).toBe(true)
    expect(served.has(target) && pending, `${target} is served but still listed as pending`).toBe(false)
  })

  it('lists every section among the targets', () => {
    for (const t of Object.values(SECTION_TARGETS)) expect(FINANCE_TARGETS).toContain(t)
  })
})

describe('queue targets', () => {
  const q = (section: FinanceQueue['section'], query?: Record<string, string>) =>
    ({ section, query }) as FinanceQueue

  it('opens the cash office on the tab the queue is about', () => {
    expect(targetOf(q('cash', { view: 'sessions' }))).toBe('cash.sessions')
    expect(targetOf(q('cash', { view: 'banking' }))).toBe('cash.banking')
    expect(targetOf(q('cash'))).toBe('cash.counter')
  })

  it('opens every other queue on its section', () => {
    expect(targetOf(q('budget', { status: 'submitted' }))).toBe('budget')
    expect(targetOf(q('revisions', { state: 'draft' }))).toBe('revisions')
    expect(targetOf(q('audit'))).toBe('audit')
  })
})
