// Shared API response shapes.
// The backend wraps payloads as `{ success, data, message, meta? }`.
// `unwrapData` and the typed services below expose `data` directly to callers.

/**
 * Backend role taxonomy — the single source of truth for the whole frontend.
 *
 * These are exactly the values permitted by the `users_role_check` constraint
 * in backend migration 061_applicant_type_and_invite_roles.sql. A role absent
 * from that constraint cannot exist on any user row, so gating on one is dead
 * code: the check can never pass. ('user' was such a phantom — removed.)
 *
 * Council staff:  admin · planner · eo · env_officer · building_inspector ·
 *                 planning_clerk · finance_officer · surveyor · gis_officer
 * Outside users:  viewer · registered · public
 *
 * `admin` is the council *IT* role (accounts + system configuration), not a
 * planning role — see ADMIN_BLOCKED in router/index.ts.
 *
 * Deliberately absent: the governance roles the statutory workflow models
 * (committee member, Director of Planning). Adding them here without the
 * matching backend constraint would recreate the unreachable-permission bug
 * this taxonomy exists to prevent. See statutory/roles.ts and
 * docs/frontend-audit-2026-08.md §M3.2.
 */
export type Role =
  | 'admin'
  | 'planner'
  | 'eo'
  | 'env_officer'
  | 'building_inspector'
  | 'planning_clerk'
  | 'finance_officer'
  | 'surveyor'
  | 'gis_officer'
  // GIS Branch (backend migration 132; permission matrix in
  // src/services/gms.ts GMS_CAN). gis_officer is the legacy single GIS role.
  | 'gis_head'
  | 'gis_data'
  | 'gis_dev'
  | 'gis_analyst'
  | 'gis_tech'
  | 'gis_clerk'
  | 'dept_editor'
  | 'dept_viewer'
  | 'viewer'
  | 'registered'
  | 'public'

/**
 * Council clients (citizens). They are never staff: they land in the Citizen
 * Portal and see only their own records. `viewer` is a legacy client role,
 * not a read-only employee — mirrors CLIENT_ROLES in the backend's
 * src/config/permissions.js.
 */
export const CLIENT_ROLES: readonly Role[] = ['registered', 'viewer', 'public']

export function isClientRole(role: string | null | undefined): boolean {
  return (CLIENT_ROLES as readonly string[]).includes(String(role ?? ''))
}

export interface AuthUser {
  id: string | number
  email: string
  name?: string
  role: Role
  phone?: string
  organization?: string
  /** Applicant identity, captured once and reused to prefill applications. */
  applicantType?: string | null
  nationalId?: string | null
  address?: string | null
  /** District residency verdict (migration 115): unverified | pending | verified | rejected. */
  residencyStatus?: string | null
  jobTitle?: string | null
  department?: string | null
  active?: boolean
  created_at?: string
  last_login?: string
}

export interface LoginPayload {
  token: string
  user: AuthUser
}

/** Generic envelope. Most successful responses use this shape. */
export interface ApiEnvelope<T> {
  success?: boolean
  data: T
  message?: string
  meta?: ApiMeta | null
  pagination?: ApiMeta | null
}

export interface ApiMeta {
  page?: number
  per_page?: number
  total?: number
  total_pages?: number
}

/** Public layer descriptor (subset — extend as backend stabilises). */
export interface PublicLayer {
  id: string
  name: string
  category?: string
  description?: string
  feature_count?: number
  geometry_type?: string
}

export interface PublicStats {
  layers?: number
  places?: number
  downloads?: number
  users?: number
}

export interface PlaceSearchHit {
  id: string
  name: string
  type?: string
  latitude?: number
  longitude?: number
}
