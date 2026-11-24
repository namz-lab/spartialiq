// The sibling seed scripts all load .env; this one did not, so running it
// directly failed on an undefined password while the others worked.
try { require('dotenv').config({ quiet: true }) } catch (_) { /* optional */ }

const { Pool } = require('pg')
const bcrypt = require('bcryptjs')

const VALID_ROLES = new Set([
  'public',
  'registered',
  'viewer',
  'admin',
  'planner',
  'eo',
  'env_officer',
  'building_inspector',
  'planning_clerk',
  'surveyor',
  'gis_officer',
  'gis_head',
  'gis_data',
  'gis_dev',
  'gis_analyst',
  'gis_tech',
  'gis_clerk',
  'dept_editor',
  'dept_viewer',
  // Finance (migration 188). Seven roles, and the separation between them is the point: no single
  // one of these accounts can prepare a budget, approve it and publish it.
  'finance_admin',
  'finance_officer',
  'budget_officer',
  'dept_head',
  'finance_committee',
  'publisher',
  'auditor',
  // Finance (migration 207).
  'accountant',
  'cashier',
  'revenue_officer',
  'accounting_officer',
  // Migration 208.
  'cash_supervisor',
  // Migration 216: heads of the Executive Arm's other units.
  'engineer',
  'hr_social_officer',
  // Migration 250: engineering staff under the Engineer.
  'civil_technician',
  'roads_foreman',
  'water_technician',
  'housing_officer',
  'housing_clerk',
])

const DEFAULT_DEMO_USERS = [
  { email: 'demo.admin@vungu.test', name: 'Demo Admin', role: 'admin' },
  { email: 'demo.planner@vungu.test', name: 'Demo Planner', role: 'planner' },
  { email: 'demo.eo@vungu.test', name: 'Demo EO Planner', role: 'eo' },
  { email: 'demo.envoffice@vungu.test', name: 'Demo Environmental Officer', role: 'env_officer' },
  { email: 'demo.inspector@vungu.test', name: 'Demo Building Inspector', role: 'building_inspector' },
  { email: 'demo.clerk@vungu.test', name: 'Demo Planning Clerk', role: 'planning_clerk' },
  { email: 'demo.surveyor@vungu.test', name: 'Demo Surveyor', role: 'surveyor' },
  { email: 'demo.gis@vungu.test', name: 'Demo GIS Officer', role: 'gis_officer' },
  { email: 'demo.viewer@vungu.test', name: 'Demo Viewer', role: 'viewer' },
  // GIS Branch (migration 132). dept_* accounts need a department: they see
  // and edit only what their department is custodian of.
  { email: 'demo.gis-head@vungu.test', name: 'Demo Principal GIS Officer', role: 'gis_head' },
  { email: 'demo.gis-data@vungu.test', name: 'Demo Senior GIS Officer (Data)', role: 'gis_data' },
  { email: 'demo.gis-dev@vungu.test', name: 'Demo GIS Systems Developer', role: 'gis_dev' },
  { email: 'demo.gis-analyst@vungu.test', name: 'Demo GIS Analyst', role: 'gis_analyst' },
  { email: 'demo.gis-tech@vungu.test', name: 'Demo GIS Technician', role: 'gis_tech' },
  { email: 'demo.gis-clerk@vungu.test', name: 'Demo GIS Data Clerk', role: 'gis_clerk' },
  { email: 'demo.dept-editor@vungu.test', name: 'Demo Planning GIS Focal Point', role: 'dept_editor', department: 'Planning' },
  { email: 'demo.dept-viewer@vungu.test', name: 'Demo Engineering Viewer', role: 'dept_viewer', department: 'Engineering' },
  // The applicant. Every staff role had an account and the citizen did not,
  // so the one journey that begins outside the council could not be walked.
  { email: 'demo.citizen@vungu.test', name: 'Demo Citizen', role: 'registered' },
  // Finance (migration 188). Walking the budget journey end to end needs all of these, because
  // each step is deliberately barred to the person who took the previous one: the officer who
  // uploads cannot commit, the administrator who prepares cannot approve, the committee that
  // approves cannot publish, and the technical administrator can do none of it.
  { email: 'demo.finance-admin@vungu.test', name: 'Demo Finance Administrator', role: 'finance_admin', department: 'Finance' },
  { email: 'demo.finance-officer@vungu.test', name: 'Demo Finance Officer', role: 'finance_officer', department: 'Finance' },
  { email: 'demo.budget-officer@vungu.test', name: 'Demo Budget Officer', role: 'budget_officer', department: 'Finance' },
  { email: 'demo.dept-head@vungu.test', name: 'Demo Departmental Head', role: 'dept_head', department: 'Engineering' },
  { email: 'demo.treasurer@vungu.test', name: 'Demo Finance Committee Member', role: 'finance_committee' },
  { email: 'demo.publisher@vungu.test', name: 'Demo Publisher', role: 'publisher' },
  { email: 'demo.auditor@vungu.test', name: 'Demo Auditor', role: 'auditor' },
  // Finance (migration 207). The cash-up cannot be walked with fewer than two of these: the
  // cashier who declares the count is barred from verifying it, and the accountant does.
  { email: 'demo.accountant@vungu.test', name: 'Demo Accountant', role: 'accountant', department: 'Finance' },
  { email: 'demo.cashier@vungu.test', name: 'Demo Cashier', role: 'cashier', department: 'Finance' },
  { email: 'demo.cashier2@vungu.test', name: 'Demo Relief Cashier', role: 'cashier', department: 'Finance' },
  { email: 'demo.revenue@vungu.test', name: 'Demo Revenue Officer', role: 'revenue_officer', department: 'Finance' },
  { email: 'demo.ceo@vungu.test', name: 'Demo Accounting Officer', role: 'accounting_officer' },
  // Migration 208. Recovers an abandoned drawer with a witness; never the cashier or the verifier.
  { email: 'demo.supervisor@vungu.test', name: 'Demo Cash Supervisor', role: 'cash_supervisor', department: 'Finance' },
  // Migration 216. Heads of Engineering and of HR / Social Services / Administration; each lands on their own unit dashboard.
  { email: 'demo.engineer@vungu.test', name: 'Demo District Engineer', role: 'engineer', department: 'Roads and Works' },
  { email: 'demo.civil-tech@vungu.test', name: 'Demo Civil Engineering Technician', role: 'civil_technician', department: 'Roads and Works' },
  { email: 'demo.roads-foreman@vungu.test', name: 'Demo Roads and Works Foreman', role: 'roads_foreman', department: 'Roads and Works' },
  { email: 'demo.water-tech@vungu.test', name: 'Demo Water and Sanitation Technician', role: 'water_technician', department: 'Roads and Works' },
  { email: 'demo.hr-social@vungu.test', name: 'Demo HR and Social Services Officer', role: 'hr_social_officer', department: 'Human Resources' },
  { email: 'demo.housing@vungu.test', name: 'Demo Housing and Estates Officer', role: 'housing_officer', department: 'Housing and Estates' },
  { email: 'demo.housing-clerk@vungu.test', name: 'Demo Housing Clerk', role: 'housing_clerk', department: 'Housing and Estates' },
]

function normalizeEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function parseDemoUsers(env = process.env) {
  // Never fall back to a well-known password. If someone wants the demo
  // accounts they must set an explicit password, otherwise seeding fails.
  const defaultPassword = env.DEMO_DEFAULT_PASSWORD
  if (!defaultPassword) {
    throw new Error('[demo-seed] DEMO_DEFAULT_PASSWORD is required. Set it explicitly to run the demo seed.')
  }
  const organization = env.DEMO_ORGANIZATION || 'Vungu Rural District Council'
  const source = env.DEMO_USERS
    ? env.DEMO_USERS.split(',').map(item => item.trim()).filter(Boolean)
    : DEFAULT_DEMO_USERS.map(user => `${user.email}:${user.name}:${user.role}`)
  const departments = new Map(DEFAULT_DEMO_USERS.map(u => [u.email, u.department ?? null]))

  return source.map((entry) => {
    const [email, name, role, password] = entry.split(':').map(part => part.trim())
    if (!email || !name || !role) {
      throw new Error(`Invalid DEMO_USERS entry "${entry}". Use email:name:role[:password].`)
    }
    if (!VALID_ROLES.has(role)) {
      throw new Error(`Invalid demo role "${role}" for ${email}.`)
    }
    return {
      email,
      name,
      role,
      password: password || defaultPassword,
      organization,
      ...(departments.get(email) ? { department: departments.get(email) } : {}),
    }
  })
}

function createPool(env = process.env) {
  return new Pool({
    connectionString: env.DATABASE_URL,
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 5432),
    database: env.DB_NAME || 'vungu_master_db_v1',
    user: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD || '',
  })
}

async function upsertDemoUser(pool, user) {
  const passwordHash = await bcrypt.hash(user.password, 10)
  const { rows } = await pool.query(
    `INSERT INTO users (
       email, password_hash, name, full_name, role, status, active,
       organization, department, created_at
     )
     VALUES ($1, $2, $3, $3, $4, 'active', true, $5, $6, NOW())
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       name = EXCLUDED.name,
       full_name = EXCLUDED.full_name,
       role = EXCLUDED.role,
       status = 'active',
       active = true,
       organization = EXCLUDED.organization,
       department = COALESCE(EXCLUDED.department, users.department)
     RETURNING id, email, role`,
    [user.email, passwordHash, user.name, user.role, user.organization, user.department ?? null],
  )
  return rows[0]
}

/**
 * Seats the demo accounts in the Executive Arm posts of the organisation chart, so a unit dashboard shows a
 * named head instead of a vacancy. Only posts with no holder are filled, except the Chief Executive's post,
 * which migration 190 may have given to the IT administrator. Nothing is invented: a post with no demo
 * account stays vacant.
 */
async function seatDemoPostHolders(pool, seeded) {
  const byRole = new Map()
  for (const u of seeded) if (!byRole.has(u.role)) byRole.set(u.role, u)
  let seated = 0
  for (const [role, u] of byRole) {
    const { rowCount } = await pool.query(
      `UPDATE public.admin_org_position p SET holder_id = $2, updated_at = now()
          WHERE p.system_role = $1
            AND (p.holder_id IS NULL
                 OR (p.reports_to IS NULL AND p.holder_id IN (SELECT id FROM public.users WHERE role = 'admin')))`,
      [role, u.id])
    seated += rowCount
  }
  return seated
}

async function seedDemoUsers(env = process.env) {
  if (!normalizeEnabled(env.DEMO_SEED_ENABLED)) {
    console.log('[demo-seed] skipped: DEMO_SEED_ENABLED is not true')
    return []
  }

  const users = parseDemoUsers(env)
  const pool = createPool(env)
  try {
    const seeded = []
    for (const user of users) {
      seeded.push(await upsertDemoUser(pool, user))
    }
    console.log(`[demo-seed] seeded ${seeded.length} demo users`)
    try {
      const seated = await seatDemoPostHolders(pool, seeded)
      if (seated) console.log(`[demo-seed] seated ${seated} organisation-chart posts`)
    } catch (err) {
      // An older database without migration 216 has no unit_key; the accounts are still seeded.
      console.warn(`[demo-seed] organisation chart not updated: ${err.message}`)
    }
    return seeded
  } finally {
    await pool.end()
  }
}

if (require.main === module) {
  seedDemoUsers().catch((error) => {
    console.error('[demo-seed] failed:', error)
    process.exit(1)
  })
}

module.exports = {
  DEFAULT_DEMO_USERS,
  VALID_ROLES,
  parseDemoUsers,
  seedDemoUsers,
  upsertDemoUser,
}
