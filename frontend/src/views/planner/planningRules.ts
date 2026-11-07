import type { PlanningDecision } from '@/services/planningAssistantService'
import { verdictFromDecision, type PlanningVerdict } from './siteAnalysis'

export { verdictFromDecision }
export type { PlanningVerdict }

export interface RuleRow {
  topic: string
  proposed: string
  maximum: string | null
  verdict: PlanningVerdict
  source: string
  why: string
}

export function envelopeRule(
  topic: string,
  proposed: number | null,
  maximum: number | null,
  unit: string,
  source: string,
): RuleRow {
  if (proposed == null || maximum == null) {
    return {
      topic, proposed: proposed == null ? 'Not stated' : `${proposed} ${unit}`,
      maximum: maximum == null ? 'Not stated' : `${maximum} ${unit}`,
      verdict: 'PLANNER REVIEW REQUIRED',
      source,
      why: 'A figure is missing, so the officer must confirm against the scheme.',
    }
  }
  const over = proposed > maximum
  return {
    topic,
    proposed: `${proposed} ${unit}`,
    maximum: `${maximum} ${unit}`,
    verdict: over ? 'NON-COMPLIANT' : 'COMPLIANT',
    source,
    why: over
      ? `Proposed ${proposed} ${unit} exceeds the maximum ${maximum} ${unit}.`
      : `Proposed ${proposed} ${unit} is within the maximum ${maximum} ${unit}.`,
  }
}

export function useRuleFromDecision(topic: string, decision: PlanningDecision, source: string): RuleRow {
  const { verdict, why } = verdictFromDecision(decision)
  return { topic, proposed: decision.replace(/_/g, ' '), maximum: null, verdict, source, why }
}
