/**
 * seed-executive-demo.js
 *
 * The Chief Executive's overview reads five departments, and three of their registers are empty on
 * a database built from the migrations alone: the road, water and council-asset registers
 * (council_ops.*) and the internal-audit plan and findings (finance.audit_*). This seeds a small,
 * plainly labelled set of each so the engineering and audit cards have something to show.
 *
 * Human resources is deliberately not seeded: the system has no staff or payroll tables, and the
 * overview says so rather than showing invented headcount.
 *
 * Everything is tagged in public.seed_demo_ledger (migration 123), so --undo removes exactly what
 * this script created. Idempotent via seedkit's `ensure`.
 *
 *     node scripts/seed-executive-demo.js
 *     node scripts/seed-executive-demo.js --undo
 */

try { require('dotenv').config({ quiet: true }) } catch (_) { /* optional */ }
const { Pool } = require('pg')
const { forget, ensure } = require('./lib/seedkit')

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/Vungu_spatial334'

const TAG = 'VUNGU-EXECUTIVE-DEMO'

const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

async function userId (db, email) {
  const { rows } = await db.query('SELECT id FROM public.users WHERE email = $1', [email])
  if (!rows.length) throw new Error(`No user ${email}. Run: node scripts/seed-demo-users.js`)
  return rows[0].id
}

async function seed (db) {
  const auditor = await userId(db, 'demo.auditor@vungu.test')

  // ── Engineering and Works: roads, water points, council assets ──────────
  const roads = [
    ['DEMO-RD-001', 'Gweru - Insukamini access road (demo)', 'secondary', 'gravel', 'fair', 18400, '12'],
    ['DEMO-RD-002', 'Somabhula - Maboleni road (demo)', 'secondary', 'gravel', 'poor', 22100, '15'],
    ['DEMO-RD-003', 'Lower Gweru - Gambiza link (demo)', 'tertiary', 'earth', 'poor', 14700, '9'],
    ['DEMO-RD-004', 'Makepesi clinic road (demo)', 'tertiary', 'gravel', 'good', 6200, '8'],
    ['DEMO-RD-005', 'Muchakata - Gunde road (demo)', 'tertiary', 'earth', 'fair', 11800, '17'],
  ]
  // Real roads (scripts/load-reference-layers.js) supersede the demonstration ones: with them in the register the demo adds none.
  const { rows: [real] } = await db.query("SELECT count(*)::int AS n FROM council_ops.road_asset WHERE asset_code NOT LIKE 'DEMO-RD-%'")
  if (real.n > 0) console.log(`[executive-demo] ${real.n} real roads are loaded; no demonstration roads added`)
  for (const [code, name, hierarchy, surface, condition, length, ward] of (real.n > 0 ? [] : roads)) {
    await ensure(db, TAG, 'council_ops.road_asset', {
      asset_code: code, name, hierarchy, surface, condition, length_m: length, ward,
      status: 'active', data_quality: 'unverified', source: 'Demonstration data (not the Council register)',
      responsible_dept: 'Engineering',
    }, 'asset_code = $1', [code])
  }

  // The ward map for road density needs geometry. Where the real ward polygons are loaded, give each demonstration
  // road a short line inside the ward it is labelled with (a stand-in, like everything here, not a surveyed route);
  // where they are not, the roads stay without geometry and the map says "no data" rather than inventing a figure.
  const { rowCount: drawn } = await db.query(
    `UPDATE council_ops.road_asset r
        SET geom = ST_Multi(ST_MakeLine(ST_PointOnSurface(w.geom), ST_Translate(ST_PointOnSurface(w.geom), 0.03, 0)))
       FROM admin.ward w
      WHERE r.asset_code LIKE 'DEMO-RD-%' AND r.geom IS NULL
        AND w.ward_code = 'ZEC23-VUNGU-' || lpad(r.ward, 2, '0') AND w.geom IS NOT NULL`)
  if (drawn) console.log(`[executive-demo] drew ${drawn} demonstration roads inside their wards`)

  const water = [
    ['DEMO-WP-001', 'borehole', 'Madigane borehole (demo)', '2', 'working'],
    ['DEMO-WP-002', 'borehole', 'Nyama borehole (demo)', '3', 'working'],
    ['DEMO-WP-003', 'borehole', 'Makepesi borehole (demo)', '8', 'broken'],
    ['DEMO-WP-004', 'well', 'Somabhula deep well (demo)', '15', 'working'],
    ['DEMO-WP-005', 'tank', 'Ruby storage tank (demo)', '19', 'working'],
    ['DEMO-WP-006', 'borehole', 'Mangwande borehole (demo)', '5', 'seasonal'],
  ]
  // Real boreholes (scripts/load-reference-layers.js) supersede the demonstration water points: with them in the register the demo adds none.
  const { rows: [realWater] } = await db.query("SELECT count(*)::int AS n FROM council_ops.wash_asset WHERE asset_code NOT LIKE 'DEMO-WP-%'")
  if (realWater.n > 0) console.log(`[executive-demo] ${realWater.n} real water points are loaded; no demonstration water points added`)
  for (const [code, type, name, ward, operational] of (realWater.n > 0 ? [] : water)) {
    await ensure(db, TAG, 'council_ops.wash_asset', {
      asset_code: code, asset_type: type, name, ward, operational,
      responsible_party: 'Vungu RDC', data_quality: 'unverified',
      source: 'Demonstration data (not the Council register)', responsible_dept: 'Engineering',
    }, 'asset_code = $1', [code])
  }

  const assets = [
    ['DEMO-CA-001', 'Council offices, Lincoln Road (demo)', 'office'],
    ['DEMO-CA-002', 'Somabhula clinic (demo)', 'clinic'],
    ['DEMO-CA-003', 'Maboleni business centre (demo)', 'market'],
  ]
  for (const [code, name, assetClass] of assets) {
    await ensure(db, TAG, 'council_ops.council_asset', {
      asset_code: code, name, asset_class: assetClass, data_quality: 'unverified',
      source: 'Demonstration data (not the Council register)',
    }, 'asset_code = $1', [code])
  }

  // ── Internal Audit: a plan and its findings ─────────────────────────────
  const rates = await ensure(db, TAG, 'finance.audit_engagement', {
    title: 'Rates billing and collection controls (demo)',
    area: 'Revenue',
    phase: 'fieldwork',
    status: 'in_progress',
    planned_start: daysFromNow(-30),
    planned_end: daysFromNow(30),
    notes: 'Demonstration engagement.',
    created_by: auditor,
  }, 'title = $1', ['Rates billing and collection controls (demo)'])

  const stores = await ensure(db, TAG, 'finance.audit_engagement', {
    title: 'Stores and procurement (demo)',
    area: 'Procurement',
    phase: 'planning',
    status: 'not_started',
    planned_start: daysFromNow(15),
    planned_end: daysFromNow(60),
    notes: 'Demonstration engagement.',
    created_by: auditor,
  }, 'title = $1', ['Stores and procurement (demo)'])
  void stores

  const findings = [
    ['Receipts not banked within 24 hours on three days (demo)', 'high', 'Bank each day\'s receipts before close of business.', -10],
    ['Valuation roll not reconciled to the rates ledger (demo)', 'medium', 'Reconcile the roll to the ledger each quarter.', 20],
    ['Cash-up variances not explained in writing (demo)', 'low', 'Record the reason for every difference at cash-up.', 45],
  ]
  for (const [title, risk, action, due] of findings) {
    await ensure(db, TAG, 'finance.audit_finding', {
      engagement_id: rates, title, detail: 'Demonstration finding.', risk, status: 'open',
      action, due_date: daysFromNow(due), created_by: auditor,
    }, 'title = $1', [title])
  }
}

;(async () => {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = await pool.connect()
  const undoing = process.argv.includes('--undo')
  try {
    await db.query('BEGIN')
    if (undoing) {
      const n = await forget(db, TAG)
      await db.query('COMMIT')
      console.log(`Removed ${n} row(s) created by ${TAG}.`)
    } else {
      await seed(db)
      await db.query('COMMIT')
      const { rows } = await db.query(
        'SELECT count(*)::int n FROM public.seed_demo_ledger WHERE tag = $1', [TAG])
      console.log(`Seeded the executive demo registers (${rows[0].n} rows tracked).`)
    }
  } catch (e) {
    await db.query('ROLLBACK')
    console.error('FAILED (rolled back):', e.message)
    process.exitCode = 1
  } finally {
    db.release()
    await pool.end()
  }
})()
