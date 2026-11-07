import { describe, it, expect } from 'vitest'
import {
  priorityRank, sortTasks, deriveKpis, recommendationLabel,
} from '../useSurveyorTasks'
import type { SurveyTask } from '@/services/surveyor'

const NOW = new Date('2026-06-08T00:00:00.000Z').getTime()
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

function task(over: Partial<SurveyTask> = {}): SurveyTask {
  return {
    id: 't-' + Math.random().toString(36).slice(2),
    permit_app_id: 'p1',
    task_type: 'verification',
    stand_number: '100', suburb_ward: 'Ward 4 — Lalapanzi',
    gauss_lo: 31,
    lng: 29.8, lat: -19.4,
    instructions: null, priority: 'normal', due_date: null,
    status: 'assigned', assigned_by: 'u1', assigned_to: null,
    created_at: daysAgo(1), updated_at: daysAgo(1),
    applicant_name: 'Tendai Moyo', applicant_phone: null, applicant_email: null,
    development_type: 'subdivision', application_description: null,
    application_status: 'circulation', site_plan_url: null,
    dev_register_no: null, tpd_reference: null, finding_count: 0,
    ...over,
  }
}

describe('priorityRank', () => {
  it('orders urgent < high < normal < low/unknown', () => {
    expect(priorityRank('urgent')).toBeLessThan(priorityRank('high'))
    expect(priorityRank('high')).toBeLessThan(priorityRank('normal'))
    expect(priorityRank('normal')).toBeLessThan(priorityRank('low'))
    expect(priorityRank(undefined)).toBe(3)
  })
})

describe('sortTasks', () => {
  it('sorts by priority, then nearest due date, then newest', () => {
    const a = task({ priority: 'normal', due_date: '2026-06-20' })
    const b = task({ priority: 'urgent', due_date: '2026-06-30' })
    const c = task({ priority: 'normal', due_date: '2026-06-10' })
    const out = sortTasks([a, b, c])
    expect(out[0]).toBe(b)          // urgent first regardless of due date
    expect(out[1]).toBe(c)          // earlier due date before later among normals
    expect(out[2]).toBe(a)
  })
})

describe('deriveKpis', () => {
  it('counts open, in-progress, submitted, urgent, unclaimed', () => {
    const tasks = [
      task({ status: 'assigned', assigned_to: null, priority: 'urgent' }),  // open + unclaimed + urgent
      task({ status: 'in_progress', assigned_to: 'me' }),                    // open + inProgress
      task({ status: 'submitted', assigned_to: 'me' }),                      // submitted (not open)
      task({ status: 'accepted', assigned_to: 'me' }),                       // closed
      task({ status: 'returned', assigned_to: null }),                       // open + unclaimed
    ]
    const k = deriveKpis(tasks)
    expect(k.open).toBe(3)         // assigned + in_progress + returned
    expect(k.inProgress).toBe(1)
    expect(k.submitted).toBe(1)
    expect(k.urgent).toBe(1)
    expect(k.unclaimed).toBe(2)
  })
})

describe('recommendationLabel', () => {
  it('maps codes to readable labels and handles null', () => {
    expect(recommendationLabel('no_objection')).toBe('No objection')
    expect(recommendationLabel('approve_conditions')).toBe('Approve with conditions')
    expect(recommendationLabel(null)).toBe('—')
  })
})
