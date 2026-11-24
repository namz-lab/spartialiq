/**
 * The Executive Arm's units: the single source for which unit exists, who heads it, and what it opens.
 * Follows the Council's own Executive Arm (https://vungurdc.org.zw/our-team/) and migration 216.
 *
 * Visibility: the Chief Executive (accounting_officer) sees every unit; a unit's head, and its members (`memberRoles`,
 * migration 250), see that unit only.
 * `canSeeUnit` is the one rule; routes and tests use it so they cannot drift.
 */
const CHIEF_EXECUTIVE_ROLE = 'accounting_officer'

const UNITS = [
  { key: 'finance', label: 'Finance', post: 'Executive Officer — Finance', headRole: 'finance_admin', section: null,
    desks: [{ label: 'Finance workspaces', path: '/finance' }] },
  { key: 'planning', label: 'Planning and Environment', post: 'Executive Officer — Planning & Environment', headRole: 'eo', section: 'planning',
    sections: ['planning', 'land'],
    desks: [{ label: 'Executive Officer desk', path: '/eo-planner-portal' }] },
  // The Department of Roads and Works, headed by the District Engineer (migration 251). The key stays 'engineering'.
  { key: 'engineering', label: 'Roads and Works', post: 'District Engineer', headRole: 'engineer', section: 'engineering',
    memberRoles: ['civil_technician', 'roads_foreman', 'water_technician'],
    sections: ['engineering'],
    // Its registers, referrals and plant are views of its own dashboard. (The GIS officer's portal, linked here before,
    // is not open to the department or the Chief Executive.)
    desks: [] },
  { key: 'social_admin', label: 'Human Resources, Social Services and Administration', post: 'Human Resources, Social Services & Administration Officer',
    headRole: 'hr_social_officer', section: 'social_services', sections: ['social_services', 'hr'], desks: [] },
  { key: 'housing', label: 'Housing and Estates', post: 'Housing and Estates Officer',
    headRole: 'housing_officer', memberRoles: ['housing_clerk', 'housing_research', 'housing_area', 'housing_legal', 'housing_committee'], section: 'housing', sections: ['housing'],
    desks: [{ label: 'Housing desk', path: '/housing' }] },
  { key: 'audit', label: 'Internal Audit', post: 'Internal Auditor', headRole: 'auditor', section: 'audit', sections: ['audit'],
    desks: [{ label: 'Audit workspace', path: '/finance' }] },
]

const UNIT_KEYS = UNITS.map((u) => u.key)
const unitByKey = (key) => UNITS.find((u) => u.key === key) ?? null
/** The unit a role heads or belongs to (a member: migration 250). */
const unitOfRole = (role) => UNITS.find((u) => u.headRole === role || (u.memberRoles ?? []).includes(role))?.key ?? null
const UNIT_ROLES_ALL = [CHIEF_EXECUTIVE_ROLE, ...UNITS.flatMap((u) => [u.headRole, ...(u.memberRoles ?? [])])]

/** The chief executive sees every unit; a head or member sees their own; nobody else sees any. */
function canSeeUnit(user, key) {
  if (!user || !unitByKey(key)) return false
  if (user.role === CHIEF_EXECUTIVE_ROLE) return true
  return unitOfRole(user.role) === key
}

const visibleUnits = (user) => UNITS.filter((u) => canSeeUnit(user, u.key))

module.exports = { UNITS, UNIT_KEYS, UNIT_ROLES_ALL, CHIEF_EXECUTIVE_ROLE, unitByKey, unitOfRole, canSeeUnit, visibleUnits }
