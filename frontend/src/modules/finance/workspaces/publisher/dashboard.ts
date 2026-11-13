import { dashboardsApi } from '../../api/dashboardsApi'
import { defineDashboard } from '../shared/useDashboard'

export const publisherDash = defineDashboard(() => dashboardsApi.publisher(), 'The publication dashboard could not be read.')

export const DATASET: Record<string, string> = {
  budget: 'Budget', revenue: 'Revenue', expenditure: 'Expenditure', projects: 'Capital projects', documents: 'Documents', reports: 'Financial reports',
}
export const STATE: Record<string, string> = {
  pending: 'Pending approval', approved: 'Ready to publish', published: 'Published', rejected: 'Refused', withdrawn: 'Withdrawn',
}
