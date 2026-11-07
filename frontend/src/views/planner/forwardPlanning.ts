// Forward-planning rules: the study of the planning area and the master /
// local plan lifecycle (RTCP Act [Ch. 29:12] ss.13-19). Pure.
import type { AnyPlan, PlanStatus, StudyTopic } from '@/statutory/types/plans'

/** Topics of the study of the planning area (ss.13, 17). */
export const STUDY_TOPICS = [
  'Population and households',
  'Economy and employment',
  'Land use and land tenure',
  'Physical environment and natural resources',
  'Water, sanitation and energy',
  'Roads and transport',
  'Social facilities (schools, clinics, markets)',
  'Housing and settlement pattern',
  'Mining and agriculture',
] as const

/** A topic not reviewed for a year is out of date. */
export const STUDY_STALE_DAYS = 365

export function studyTopics(plan: Pick<AnyPlan, 'study'>): StudyTopic[] {
  const have = new Map((plan.study ?? []).map(t => [t.topic, t]))
  const base = STUDY_TOPICS.map(topic => have.get(topic) ?? { topic, findings: '' })
  const extra = (plan.study ?? []).filter(t => !(STUDY_TOPICS as readonly string[]).includes(t.topic))
  return [...base, ...extra]
}

export function isStale(t: StudyTopic, now = new Date()): boolean {
  if (!t.findings.trim() || !t.reviewedAt) return true
  return (now.getTime() - new Date(t.reviewedAt).getTime()) / 86_400_000 > STUDY_STALE_DAYS
}

/** Minimum exhibition period, in days (one month). */
export const EXHIBITION_DAYS = 30

export interface PlanGate { next: PlanStatus | null; label: string; missing: string[] }

/** What the planner must have done before moving the plan on. Approval and
 *  operation are the committee's / Minister's (plan.determine), never offered. */
export function planGate(p: AnyPlan, now = new Date()): PlanGate {
  const studyDone = studyTopics(p).filter(t => t.findings.trim()).length
  switch (p.status) {
    case 'draft': {
      const missing: string[] = []
      if (studyDone < STUDY_TOPICS.length) missing.push(`Study of the planning area: ${STUDY_TOPICS.length - studyDone} topic(s) not written`)
      if (!p.writtenStatement.sections.some(s => s.body.trim())) missing.push('Written statement has no content')
      if (!(p.consultations ?? []).length) missing.push('No consultation recorded during preparation')
      if (!p.exhibition?.from || !p.exhibition?.to || !p.exhibition?.place) missing.push('Exhibition dates and place not set')
      else if ((new Date(p.exhibition.to).getTime() - new Date(p.exhibition.from).getTime()) / 86_400_000 < EXHIBITION_DAYS - 1) {
        missing.push('Exhibition must run for at least one month')
      }
      return { next: 'exhibition', label: 'Place on public exhibition', missing }
    }
    case 'exhibition': {
      const missing = p.exhibition?.to && new Date(p.exhibition.to).getTime() > now.getTime()
        ? [`Exhibition runs until ${new Date(p.exhibition.to).toLocaleDateString('en-GB')}`] : []
      return { next: 'objections', label: 'Close exhibition and consider objections', missing }
    }
    case 'objections': {
      const open = p.objections.filter(o => !o.representation && !o.response?.trim())
      const missing: string[] = []
      if (open.length) missing.push(`${open.length} objection(s) without a planning response`)
      if (!p.objectionsReportAt) missing.push('Report on objections not produced')
      return { next: 'submitted', label: 'Submit for approval', missing }
    }
    case 'submitted':
      return { next: null, label: 'Awaiting approval by the authority', missing: [] }
    default:
      return { next: null, label: p.status === 'operative' ? 'In force' : p.status, missing: [] }
  }
}
