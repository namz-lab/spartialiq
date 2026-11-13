import { dashboardsApi } from '../../api/dashboardsApi'
import { defineDashboard } from '../shared/useDashboard'

export const auditDash = defineDashboard((year) => dashboardsApi.audit(year), 'The internal audit dashboard could not be read.')

export const PHASE: Record<string, string> = { planning: 'Planning', fieldwork: 'Fieldwork', reporting: 'Reporting', follow_up: 'Follow-up' }
export const STATUS: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' }
export const RISK: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }
