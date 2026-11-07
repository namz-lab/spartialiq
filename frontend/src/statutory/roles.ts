// src/statutory/roles.ts
// ─────────────────────────────────────────────────────────────────────────
// Role-based access for the statutory workspaces implementing the Regional,
// Town and Country Planning Act [Chapter 29:12]. Pure logic — no Vue, no I/O.
// Used by views to gate access; mirrors the existing auth-store role strings.
// ─────────────────────────────────────────────────────────────────────────

// ── Reconciled with the real role taxonomy (audit F2) ───────────────────
// This matrix was previously keyed by an invented role vocabulary —
// 'lpa_staff', 'lpa_committee', 'director', 'minister' — none of which the
// backend can issue (see users_role_check in migration 061, mirrored by Role
// in services/types.ts). Only 'planner' and 'admin' existed in both, so every
// other entry was unreachable: can() returned false for all real users and the
// whole Part V determination/order model was dead code.
//
// It is now keyed by Role. The statutory *vocabulary* is unchanged; only the
// subjects are real.
import type { Role } from '@/services/types'

export type StatutoryAction =
  | 'plan.view' | 'plan.edit' | 'plan.determine'
  | 'devapp.view' | 'devapp.lodge' | 'devapp.acknowledge' | 'devapp.determine'
  | 'devapp.issue_permit'
  | 'order.view' | 'order.create'
  | 'evidence.generate'
  | 'view.planner-statutory' | 'view.lpa-workspace' | 'view.director' | 'view.minister'

/**
 * What each role may do under the RTCP Act [Chapter 29:12].
 *
 * Mapping applied:
 *   lpa_staff → 'eo' + 'planning_clerk' — the council officers who in
 *               practice acknowledge applications and prepare orders
 *   planner   → unchanged
 *   admin     → unchanged ('*', the council IT superuser)
 *
 * NOT mapped, because no backend role can hold them:
 *   lpa_committee → the determination power (plan.determine /
 *                   devapp.determine) belongs to committee members
 *   director      → Director of Planning (Parts IV/XI)
 *   minister      → outside the council entirely
 *
 * Those actions are deliberately assigned to nobody rather than quietly
 * folded into 'planner' or 'admin'. A determination recorded against the
 * wrong office is a worse failure than one the UI declines to offer. Wiring
 * them up needs the backend role constraint widened first — see
 * docs/frontend-audit-2026-08.md §M3.2 (governance workspaces).
 *
 * ── 'devapp.determine' vs 'devapp.issue_permit' ────────────────────────
 * These are NOT the same power, and conflating them was a live divergence
 * between this matrix and what the backend actually allows.
 *
 *   devapp.determine    — the power to DECIDE an application. Reserved for the
 *                         committee office above, still assigned to nobody.
 *   devapp.issue_permit — the power to RECORD an already-taken decision and
 *                         issue the resulting permit document.
 *
 * The backend grants the second to ['eo','planner','planning_clerk','admin']
 * (requireRole on PATCH /permit-applications/:id/status). The permit-issuance
 * workspace gates on it, so the frontend and backend now agree, and Step 4 no
 * longer needs its own private role list. The reservation above is untouched:
 * issuing a permit records who decided, it does not confer the decision power.
 */
const MATRIX: Partial<Record<Role, StatutoryAction[] | '*'>> = {
  admin: '*',
  // plan.edit: forward planning (study, master/local plan preparation,
  // exhibition, objections) is the planner's duty, and POST /statutory/plans
  // already grants 'planner' (WRITE_ROLES in routes/statutory-plans.js).
  planner: [
    'plan.view', 'plan.edit', 'devapp.view', 'devapp.lodge', 'devapp.issue_permit',
    'evidence.generate', 'view.planner-statutory',
  ],
  // Former 'lpa_staff'.
  eo: [
    'plan.view', 'plan.edit', 'devapp.view', 'devapp.acknowledge', 'devapp.issue_permit',
    'order.view', 'order.create', 'evidence.generate', 'view.lpa-workspace',
  ],
  planning_clerk: [
    'plan.view', 'plan.edit', 'devapp.view', 'devapp.acknowledge', 'devapp.issue_permit',
    'order.view', 'order.create', 'evidence.generate', 'view.lpa-workspace',
  ],
}

/** True if `role` may perform `action`. Unknown roles get nothing. */
export function can(role: Role | string | null | undefined, action: StatutoryAction): boolean {
  if (!role) return false
  const allowed = MATRIX[role as Role]
  if (!allowed) return false
  return allowed === '*' || allowed.includes(action)
}

/** Roles carrying any statutory power today. */
export const STATUTORY_ROLES: Role[] = ['planner', 'eo', 'planning_clerk', 'admin']

/**
 * Actions the Act assigns to an office that cannot yet log in. Exported so a
 * view can explain *why* a control is unavailable instead of silently hiding
 * it, and so a test can assert this set shrinks as governance roles land.
 */
export const UNASSIGNED_ACTIONS: StatutoryAction[] = [
  'plan.determine', 'devapp.determine', 'view.director', 'view.minister',
]
