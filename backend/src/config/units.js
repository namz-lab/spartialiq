/**
 * The Executive Arm's units: the single source for which unit exists, who heads it, and what it opens.
 * Follows the Council's own Executive Arm (https://vungurdc.org.zw/our-team/) and migration 216.
 *
 * Visibility: the Chief Executive (accounting_officer) sees every unit; a unit's head sees that unit only.
 * `canSeeUnit` is the one rule; routes and tests use it so they cannot drift.
 */
const CHIEF_EXECUTIVE_ROLE = 'accounting_officer'

const UNITS = [
  { key: 'finance', label: 'Finance', post: 'Executive Officer — Finance', headRole: 'finance_admin', section: null,
    desks: [{ label: 'Finance workspaces', path: '/finance' }] },
  { key: 'planning', label: 'Planning and Environment', post: 'Executive Officer — Planning & Environment', headRole: 'eo', section: 'planning',
    sections: ['planning', 'land'],
    desks: [{ label: 'Executive Officer desk', path: '/eo-planner-portal' }] },
  { key: 'engineering', label: 'Engineering and Works', post: 'Engineer', headRole: 'engineer', section: 'engineering',
    sections: ['engineering'],
    desks: [{ label: 'Parcel and asset map', path: '/gis-officer-portal' }] },
  { key: 'social_admin', label: 'Human Resources, Social Services and Administration', post: 'Human Resources, Social Services & Administration Officer',
    headRole: 'hr_social_officer', section: 'social_services', sections: ['social_services', 'hr'], desks: [] },
  { key: 'audit', label: 'Internal Audit', post: 'Internal Auditor', headRole: 'auditor', section: 'audit', sections: ['audit'],
    desks: [{ label: 'Audit workspace', path: '/finance' }] },
]

const UNIT_KEYS = UNITS.map((u) => u.key)
const unitByKey = (key) => UNITS.find((u) => u.key === key) ?? null
const unitOfRole = (role) => UNITS.find((u) => u.headRole === role)?.key ?? null
const UNIT_ROLES_ALL = [CHIEF_EXECUTIVE_ROLE, ...UNITS.map((u) => u.headRole)]

/** The chief executive sees every unit; a head sees their own; nobody else sees any. */
function canSeeUnit(user, key) {
  if (!user || !unitByKey(key)) return false
  if (user.role === CHIEF_EXECUTIVE_ROLE) return true
  return unitOfRole(user.role) === key
}

const visibleUnits = (user) => UNITS.filter((u) => canSeeUnit(user, u.key))

module.exports = { UNITS, UNIT_KEYS, UNIT_ROLES_ALL, CHIEF_EXECUTIVE_ROLE, unitByKey, unitOfRole, canSeeUnit, visibleUnits }
