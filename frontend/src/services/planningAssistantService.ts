/**
 * Planning Assistant — typed wrapper over /api/planning-assistant/*.
 *
 * Returns the same shapes the backend rules engine produces.
 */

import api from './api'
import type { PlanningTemplate, SuggestedPlan } from './standsService'

export type PlanningDecision =
  | 'permitted'
  | 'special_consent'
  | 'prohibited'
  | 'unknown'

export interface DecisionResult {
  decision:          PlanningDecision
  landUseGroupCode?: string
  landUseGroupName?: string
  conditions:        string | null
  authority?:        string | null
  reason?:           string
}

export interface SuggestRequest {
  /** Either standId, OR (lng + lat). */
  standId?: string
  lng?:     number
  lat?:     number
  /** Optional template purpose hint, e.g. 'residential_low_density'. */
  purpose?: string
}

export interface DecideRequest {
  /** Either zoneId, standId, OR (lng + lat). */
  zoneId?:  string
  standId?: string
  lng?:     number
  lat?:     number
  landUseGroupCode: string
}

export interface TemplateFilters {
  zoneType?:      string
  scaleCategory?: string
  ward?:          string
}

export const planningAssistantService = {
  async suggest(req: SuggestRequest): Promise<SuggestedPlan> {
    const response = await api.post<{ success: boolean; data: SuggestedPlan }>(
      '/planning-assistant/suggest',
      req,
    )
    return response.data.data
  },

  async decide(req: DecideRequest): Promise<DecisionResult> {
    const response = await api.post<{ success: boolean; data: DecisionResult }>(
      '/planning-assistant/decide',
      req,
    )
    return response.data.data
  },

  async listTemplates(filters?: TemplateFilters): Promise<PlanningTemplate[]> {
    const qs = new URLSearchParams()
    if (filters?.zoneType)      qs.set('zoneType',      filters.zoneType)
    if (filters?.scaleCategory) qs.set('scaleCategory', filters.scaleCategory)
    if (filters?.ward)          qs.set('ward',          filters.ward)
    const url = `/planning-assistant/templates${qs.toString() ? `?${qs.toString()}` : ''}`
    const response = await api.get<{ success: boolean; data: PlanningTemplate[] }>(url)
    return response.data.data
  },
}
