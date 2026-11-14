// The Executive Arm's five units as the browser knows them: which role heads which unit, and what to call each.
// Mirrors backend src/config/units.js; the server decides who may open what, so this is only for routing and wording.
import type { UnitKey } from '@/services/units'

/** The role that heads each unit. The chief executive (accounting_officer) is above all of them. */
export const UNIT_OF_ROLE: Record<string, UnitKey | undefined> = {
  eo: 'planning',
  finance_admin: 'finance',
  engineer: 'engineering',
  hr_social_officer: 'social_admin',
  auditor: 'audit',
}

export const UNIT_LABEL: Record<UnitKey, string> = {
  finance: 'Finance',
  planning: 'Planning and Environment',
  engineering: 'Engineering and Works',
  social_admin: 'Human Resources, Social Services and Administration',
  audit: 'Internal Audit',
}

export const unitPath = (key: UnitKey | string) => `/units/${key}`
