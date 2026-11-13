import { dashboardsApi } from '../../api/dashboardsApi'
import { defineDashboard } from '../shared/useDashboard'

export const revenueDash = defineDashboard((year) => dashboardsApi.revenue(year), 'The revenue dashboard could not be read.')
