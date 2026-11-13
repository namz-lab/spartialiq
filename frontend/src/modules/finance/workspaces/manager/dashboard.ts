import { dashboardsApi } from '../../api/dashboardsApi'
import { defineDashboard } from '../shared/useDashboard'

export const managerDash = defineDashboard(() => dashboardsApi.manager(), 'The finance administration dashboard could not be read.')
