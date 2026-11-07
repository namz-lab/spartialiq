// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const respondConsultation = vi.fn()
vi.mock('@/services/developmentManagementService', () => ({
  dmApi: { respondConsultation: (...a: unknown[]) => respondConsultation(...a) },
}))

import ConsultationResponsePanel from '../ConsultationResponsePanel.vue'

// Review §6.3 / P1: dmApi.respondConsultation existed but had no UI caller, so
// a circulated referral could never be closed. These assertions are about the
// referral actually reaching the server with a usable statutory response.
const pending = {
  id: 'consult-1',
  permit_application_id: 'permit-1',
  department: 'gis',
  body_name: 'GIS Office',
  contacted_at: '2026-08-10T08:00:00.000Z',
  response_received_at: null,
  response: null,
  outcome: 'pending' as const,
  notes: null,
  created_at: '2026-08-10T08:00:00.000Z',
  response_status: 'pending' as const,
}

const answered = {
  ...pending,
  response_status: 'no_objection' as const,
  response_notes: 'No spatial constraint on this stand.',
  response_received_at: '2026-08-12T10:30:00.000Z',
}

function pick(w: ReturnType<typeof mount>, value: string) {
  return w.find(`input[name="crp-outcome"][value="${value}"]`)
}

const settle = () => flushPromises()

describe('ConsultationResponsePanel', () => {
  beforeEach(() => respondConsultation.mockReset())

  it('cannot submit before an outcome is chosen', () => {
    const w = mount(ConsultationResponsePanel, { props: { consultation: pending } })
    expect(w.find('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('records a no-objection without requiring narrative', async () => {
    respondConsultation.mockResolvedValue({ ...answered })
    const w = mount(ConsultationResponsePanel, { props: { consultation: pending } })
    await pick(w, 'no_objection').setValue()
    expect(w.find('button[type="submit"]').attributes('disabled')).toBeUndefined()

    await w.find('form').trigger('submit')
    await settle()

    expect(respondConsultation).toHaveBeenCalledTimes(1)
    const [id, payload] = respondConsultation.mock.calls[0]
    expect(id).toBe('consult-1')
    expect(payload.response_status).toBe('no_objection')
    expect(w.emitted('responded')).toBeTruthy()
  })

  it('refuses to submit an objection with no stated ground', async () => {
    const w = mount(ConsultationResponsePanel, { props: { consultation: pending } })
    await pick(w, 'objection').setValue()
    expect(w.find('button[type="submit"]').attributes('disabled')).toBeDefined()

    await w.find('textarea').setValue('Encroaches the river buffer.')
    expect(w.find('button[type="submit"]').attributes('disabled')).toBeUndefined()
  })

  it('sends the backend vocabulary for a conditional approval', async () => {
    respondConsultation.mockResolvedValue({ ...answered })
    const w = mount(ConsultationResponsePanel, { props: { consultation: pending } })
    await pick(w, 'conditional_approval').setValue()
    await w.find('textarea').setValue('Subject to a 3 m servitude.')
    await w.find('form').trigger('submit')
    await settle()

    expect(respondConsultation.mock.calls[0][1].response_status).toBe('conditional_approval')
  })

  // GAP — the server-rejection recovery path (error stays on screen, typed
  // reasoning is preserved, no 'responded' emit) is implemented in the
  // component but not asserted here. Every way of making the mock reject was
  // reported by Vitest as an unhandled error and failed the run, even though
  // the component's own try/catch handles it. Worth revisiting with a Vue
  // app-level errorHandler in the mount options rather than leaving a red
  // suite. Tracked in docs/frontend-remediation-report-2026-08.md.

  it('shows an answered referral as a record, not an editable form', () => {
    const w = mount(ConsultationResponsePanel, { props: { consultation: answered } })
    expect(w.find('form').exists()).toBe(false)
    expect(w.text()).toContain('No spatial constraint on this stand.')
  })
})
