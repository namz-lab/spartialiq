import { dashboardsApi } from '../../api/dashboardsApi'
import { defineDashboard } from '../shared/useDashboard'

export const executiveDash = defineDashboard((year) => dashboardsApi.executive(year), 'The executive dashboard could not be read.')
