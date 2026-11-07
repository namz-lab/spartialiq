// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import StatutoryStepper from '@/views/planner/StatutoryStepper.vue'
import type { StatutoryStep } from '@/composables/useStatutorySteps'

const steps: StatutoryStep[] = [
  { id: 1, key: 'intake', title: 'Intake', status: 'done', progressDone: 3, progressTotal: 3, nextAction: null, lockedReason: null, subtasks: [] },
  { id: 2, key: 'due_diligence', title: 'Due Diligence', status: 'available', progressDone: 5, progressTotal: 21, nextAction: '16 checks outstanding', lockedReason: null,
    subtasks: [{ label: 'File checks', done: true }, { label: 'Compatibility', done: false }] },
  { id: 3, key: 'committee_report', title: 'Committee Report', status: 'locked', progressDone: 0, progressTotal: 2, nextAction: null, lockedReason: 'Complete due diligence first', subtasks: [] },
]

describe('StatutoryStepper', () => {
  it('renders steps with status, next-action, progress and locked reason', () => {
    const w = mount(StatutoryStepper, { props: { steps, activeId: 2 } })
    expect(w.findAll('.sx-step').length).toBe(3)
    expect(w.text()).toContain('16 checks outstanding')
    expect(w.text()).toContain('5/21')
    expect(w.text()).toContain('Complete due diligence first')
  })

  it('expands the active step to show subtasks', () => {
    const w = mount(StatutoryStepper, { props: { steps, activeId: 2 } })
    const active = w.find('.sx-step.active')
    expect(active.exists()).toBe(true)
    expect(active.findAll('.sx-subtask').length).toBe(2)
  })

  it('emits select for an unlocked step but not a locked one', async () => {
    const w = mount(StatutoryStepper, { props: { steps, activeId: 2 } })
    await w.findAll('.sx-step')[0].trigger('click')   // intake (done, unlocked)
    expect(w.emitted('select')![0]).toEqual([1])
    await w.findAll('.sx-step')[2].trigger('click')   // report (locked)
    expect(w.emitted('select')!.length).toBe(1)       // no new emit
  })
})
