import type { PermitApplication, PermitStatus } from '@/services/developmentManagementService'
import { normalizeStatus } from '@/composables/useApplicationPipeline'

export function filterPermitsForQueue(
  permits: PermitApplication[],
  statuses: readonly PermitStatus[],
): PermitApplication[] {
  const allow = new Set(statuses.map(s => normalizeStatus(s)))
  return permits.filter(p => allow.has(normalizeStatus(p.status)))
}
