import { dashboardsApi } from '../../api/dashboardsApi'
import { defineDashboard } from '../shared/useDashboard'

export const officerDash = defineDashboard((year) => dashboardsApi.officer(year), 'The finance operations dashboard could not be read.')
