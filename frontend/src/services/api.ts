import axios, { type AxiosResponse } from 'axios'
import type {
  ApiEnvelope,
  ApiMeta,
  AuthUser,
  LoginPayload,
  PlaceSearchHit,
  PublicLayer,
  PublicStats,
} from './types'

import { clearSession } from './session'
import { apiBaseUrl } from './runtimeOrigin'

// Re-export so call-sites can `import type { … } from '@/services/api'`.
export type { Role, AuthUser, LoginPayload, ApiEnvelope, PublicLayer, PublicStats } from './types'

// Create axios instance.
//
// Auth travels as the httpOnly `vungu_at` cookie the backend sets on login,
// NOT as an Authorization header — so `withCredentials` is mandatory and
// there is no request interceptor attaching a token. The backend's
// authenticate() reads the cookie first and only falls back to Bearer for
// non-browser clients (the QGIS plugin's long-lived API token).
// Desktop (Tauri) must hit 127.0.0.1:3000 — see runtimeOrigin.ts.
const api = axios.create({
  baseURL: apiBaseUrl(),
  timeout: 30000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Response interceptor
api.interceptors.response.use(
  (response) => {
    return response
  },
  async (error) => {
    const originalRequest = error.config

    // Handle 401 Unauthorized — drop the session hint and purge cached case
    // files (they carry applicant PII), then bounce to login. The session
    // cookies are httpOnly, so only the backend can clear them; POST
    // /auth/logout does that, and an expired cookie is inert regardless.
    if (error.response?.status === 401 && !originalRequest?._retry) {
      // `error.config` is absent for errors raised before a request is built;
      // a 401 always carries one, but guard rather than throw inside the
      // interceptor and mask the real error.
      if (originalRequest) originalRequest._retry = true
      clearSession()
      // /auth/me is the boot-time session probe. A 401 there is the expected
      // "not signed in" answer for an anonymous visitor, not an expired
      // session — bouncing on it would eject visitors from public pages.
      const isSessionProbe = String(originalRequest?.url || '').includes('/auth/me')
      if (!isSessionProbe && window.location.pathname !== '/login') {
        // Say why, and remember where. A bare bounce to /login reads as the
        // portal logging you out for no reason and drops whatever page the
        // officer had open; LoginView renders `reason` as a sentence and
        // returns to `redirect` once they are back in.
        const back = window.location.pathname + window.location.search
        const query = new URLSearchParams({ reason: 'expired' })
        if (back && back !== '/') query.set('redirect', back)
        window.location.href = `/login?${query.toString()}`
      }
    }

    return Promise.reject(error)
  }
)

export default api

export function unwrapData<T>(response: AxiosResponse<ApiEnvelope<T> | T>): T {
  const body = response.data as ApiEnvelope<T> | T
  if (body && typeof body === 'object' && 'data' in (body as object)) {
    return (body as ApiEnvelope<T>).data
  }
  return body as T
}

export function unwrapMeta(response: AxiosResponse<ApiEnvelope<unknown>>): ApiMeta | null {
  return response.data?.meta ?? response.data?.pagination ?? null
}

// Public — used by anonymous home page + map explorer.
export const publicApi = {
  getLayers: () =>
    api.get<ApiEnvelope<PublicLayer[]>>('/layers'),

  getLayerData: <T = unknown>(layerId: string, params?: Record<string, unknown>) =>
    api.get<ApiEnvelope<T>>(`/layers/${layerId}`, { params }),

  searchPlaces: (query: string, limit?: number) =>
    api.get<ApiEnvelope<PlaceSearchHit[]>>('/spatial/search', { params: { q: query, limit } }),

  getStats: () =>
    api.get<ApiEnvelope<PublicStats>>('/admin/analytics'),
}

// Auth — types narrowed at the boundary the rest of the app trusts most.
export interface RegisterPayload {
  email: string
  password: string
  name: string
  organization?: string
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<ApiEnvelope<LoginPayload>>('/auth/login', { email, password }),

  register: (userData: RegisterPayload) =>
    api.post<ApiEnvelope<LoginPayload>>('/auth/register', userData),

  logout: () =>
    api.post<ApiEnvelope<null>>('/auth/logout'),

  getProfile: () =>
    api.get<ApiEnvelope<AuthUser>>('/auth/me'),

  updateProfile: (userData: Partial<AuthUser>) =>
    api.put<ApiEnvelope<AuthUser>>('/auth/profile', userData),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<ApiEnvelope<null>>('/auth/change-password', { currentPassword, newPassword }),

  refreshToken: (refreshToken: string) =>
    api.post<ApiEnvelope<{ token: string }>>('/auth/refresh', { refreshToken }),
}

export const spatialApi = {
  queryFeatures: (params: any) => api.get('/spatial/bbox', { params }),
  pointInPolygon: (params: any) => api.get('/spatial/point', { params }),
  bufferAnalysis: (params: any) => api.get('/spatial/buffer', { params }),
  intersectionAnalysis: (params: any) => api.get('/spatial/bbox', { params }),
  aggregateAnalysis: (params: any) => api.get('/spatial/bbox', { params }),
  getSurroundingParcels: (selectedParcelId: string, bufferMeters?: number) =>
    api.get('/spatial/buffer', {
      params: { selected_parcel_id: selectedParcelId, buffer_meters: bufferMeters || 100 }
    })
}

// Land-subdivision planning tool (stores designs in PostGIS without touching
// the permit workflow). Endpoints are stubs the backend can implement; the
// browser holds the interactive design and only persists snapshots here.
export const planningApi = {
  // Projects
  listProjects: () => api.get('/planning/projects'),
  getProject: (projectId: string) => api.get(`/planning/projects/${projectId}`),
  saveProject: (project: any) => api.post('/planning/projects', project),
  deleteProject: (projectId: string) => api.delete(`/planning/projects/${projectId}`),
  // Granular saves (optional — saveProject persists everything at once)
  savePlanningArea: (projectId: string, area: any) =>
    api.post(`/planning/projects/${projectId}/area`, area),
  saveRoadNetwork: (projectId: string, roads: any[]) =>
    api.post(`/planning/projects/${projectId}/roads`, { roads }),
  saveLots: (projectId: string, lots: any[]) =>
    api.post(`/planning/projects/${projectId}/lots`, { lots }),
  listLotsByPlanningArea: (planningAreaId: string) =>
    api.get(`/planning/areas/${planningAreaId}/lots`),
}

export const adminApi = {
  // Layer management
  createLayer: (layerData: any) => api.post('/admin/layers', layerData),
  
  updateLayer: (layerId: string, layerData: any) =>
    api.put(`/admin/layers/${layerId}`, layerData),
  
  deleteLayer: (layerId: string) => api.delete(`/admin/layers/${layerId}`),
  
  // Data management
  uploadLayerData: (layerId: string, formData: FormData) =>
    api.post(`/admin/layers/${layerId}/data`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }),
  
  // User management
  getUsers: (params?: any) => api.get('/admin/users', { params }),
  
  updateUser: (userId: string, userData: any) =>
    api.put(`/admin/users/${userId}`, userData),
  
  deleteUser: (userId: string) => api.delete(`/admin/users/${userId}`),
  
  // Analytics
  getAnalytics: (params?: any) => api.get('/admin/analytics', { params })
}

// ---------------------------------------------------------------------------
// Citizen Portal API  (/api/portal/*)
// Used by ViewerPortalView
// ---------------------------------------------------------------------------
export const citizenPortalApi = {
  submitReport: (data: {
    report_type: string; summary?: string; fields_data?: Record<string, any>
    latitude?: number; longitude?: number; ward?: string; stand_no?: string
  }) => api.post('/portal/reports', data),

  getMyReports: () => api.get('/portal/reports'),

  submitApplication: (data: {
    service_id: string; service_name: string; service_cat?: string
    form_data?: Record<string, any>; docs_submitted?: any[]
    ward?: string; stand_no?: string; latitude?: number; longitude?: number
  }) => api.post('/portal/applications', data),

  getMyApplications: () => api.get('/portal/applications'),

  getPublicNotices: (params?: { ward?: string; type?: string }) =>
    api.get('/portal/public-notices', { params }),
}

// ---------------------------------------------------------------------------
// EO Command Centre API  (/api/eo/*)
// Used by EOPlannerView
// ---------------------------------------------------------------------------
export const eoApi = {
  getStats: () => api.get('/eo/stats'),

  getCitizenReports: (params?: { status?: string; type?: string; limit?: number; offset?: number }) =>
    api.get('/eo/citizen-reports', { params }),

  updateCitizenReport: (id: string, data: {
    status?: string; eo_notes?: string; assigned_to?: string
  }) => api.patch(`/eo/citizen-reports/${id}`, data),

  getPortalApplications: (params?: { status?: string; service_id?: string; limit?: number; offset?: number }) =>
    api.get('/eo/portal-applications', { params }),

  updatePortalApplication: (id: string, data: {
    status?: string; reviewer_notes?: string; conditions?: string; assigned_to?: string
  }) => api.patch(`/eo/portal-applications/${id}`, data),

  getAllNotices: () => api.get('/eo/public-notices'),

  publishNotice: (data: {
    title: string; body: string; notice_type?: string
    ward?: string; priority?: string; expires_at?: string
  }) => api.post('/eo/public-notices', data),

  deactivateNotice: (id: string) => api.delete(`/eo/public-notices/${id}`),

  // Role notifications (cross-department inbox)
  getNotifications: (params?: { unread_only?: boolean; limit?: number }) =>
    api.get('/eo/notif', { params }),
  markNotificationRead: (id: string) => api.patch(`/eo/notif/${id}/read`, {}),
  getUnreadCount: () => api.get('/eo/notif/unread-count'),
}

// ---------------------------------------------------------------------------
// Environmental Officer API  (/api/env/*)
// Used by EnvironmentalOfficerView
// ---------------------------------------------------------------------------
export const envOfficerApi = {
  getCitizenReports: (params?: { status?: string; type?: string; limit?: number; offset?: number }) =>
    api.get('/env/reports', { params }),

  actOnReport: (id: string, data: { status?: string; eo_notes?: string }) =>
    api.patch(`/env/reports/${id}`, data),

  getEiaApplications: (params?: { status?: string; limit?: number; offset?: number }) =>
    api.get('/env/eia-applications', { params }),

  actOnEia: (id: string, data: { status?: string; reviewer_notes?: string }) =>
    api.patch(`/env/eia-applications/${id}`, data),

  getEnforcement: () => api.get('/env/enforcement'),

  issueEnforcement: (data: {
    citizen_report_id?: string; citizen_id?: string; action_type: string
    stand_no?: string; ward?: string; description: string
    amount?: number; deadline?: string
  }) => api.post('/env/enforcement', data),
}

// ---------------------------------------------------------------------------
// Planner API  (/api/planner/*)
// Used by VunguPlannerView
// ---------------------------------------------------------------------------
export const plannerApi = {
  getNotifications: () => api.get('/planner/notifications'),
  markNotificationRead: (id: string) => api.patch(`/planner/notifications/${id}/read`, {}),

  getSubmissions: (params?: { status?: string; limit?: number; offset?: number }) =>
    api.get('/planner/submissions', { params }),

  actOnSubmission: (id: string, data: {
    status?: string; reviewer_notes?: string; conditions?: string
  }) => api.patch(`/planner/submissions/${id}`, data),
}

// ---------------------------------------------------------------------------
// Admin portal overview  (/api/admin/portal/*)
// Used by the IT Admin console / AnalyticsView
// ---------------------------------------------------------------------------
export const adminPortalApi = {
  getOverview: () => api.get('/admin/portal/overview'),
}

// ---------------------------------------------------------------------------
// Citizen portal extensions  (/api/portal/*)
// Enforcement notices and inspection stage timeline visible to citizens
// ---------------------------------------------------------------------------
export const citizenPortalExtApi = {
  getEnforcement: () => api.get('/portal/enforcement'),
  getInspectionStages: (appId: string) => api.get(`/portal/applications/${appId}/stages`),
}

// ---------------------------------------------------------------------------
// Payments API  (/api/payments/*)
// ---------------------------------------------------------------------------
export const paymentsApi = {
  getFeeSchedule: () => api.get('/payments/fees'),
  getServiceFee: (serviceId: string) => api.get(`/payments/fees/${serviceId}`),

  initiate: (data: {
    service_id: string; service_name?: string; portal_app_id?: string
    method: string; phone?: string; amount_override?: number
  }) => api.post('/payments/initiate', data),

  getStatus: (refNo: string) => api.get(`/payments/status/${refNo}`),

  confirm: (refNo: string, data: {
    paynow_ref?: string; amount_paid?: number; method?: string
  }) => api.post(`/payments/confirm/${refNo}`, data),

  getReceipt: (refNo: string) => api.get(`/payments/receipt/${refNo}`),

  getMyPayments: () => api.get('/payments/mine'),
}
