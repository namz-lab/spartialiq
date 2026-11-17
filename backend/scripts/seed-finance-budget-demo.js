#!/usr/bin/env node
/**
 * Budget, department and committee demo data, built on the DD- director dataset.
 *
 *   DATABASE_URL=postgresql://...@127.0.0.1:5434/... node scripts/seed-finance-budget-demo.js            # create / top up
 *   DATABASE_URL=... node scripts/seed-finance-budget-demo.js --report                                     # count what is there
 *   DATABASE_URL=... node scripts/seed-finance-budget-demo.js --clean                                      # remove what it created
 *
 *   FINANCE_API (default http://127.0.0.1:3011/api) must be a backend wired to the SAME local database.
 *
 * WHAT IT CREATES (everything carries the prefix BUD-)
 *  - Three more votes (Administration, Planning, Water and Sanitation) beside the four DD- votes, with
 *    programmes, activities and fourteen BUD- accounts (fuel, repairs, chemicals, unit tax, plan fees...).
 *  - About 35 budget lines across seven departments, revenue and expenditure, USD and ZWG, in every state:
 *    approved (prepared by the budget officer, approved by the finance committee), submitted and waiting for
 *    the committee, returned with the committee's reason, and draft. Engineering's own lines are prepared by
 *    the head of department, who is scoped to Engineering (DD-ENG) through PUT /finance/users/:id/access.
 *  - Monthly phasing (finance.budget_distribution): an even-twelfths profile, a dry-season capital-works
 *    profile, and a draft quarterly profile. There is no route for phasing, so these rows are written in SQL
 *    exactly as migration 204 defines them. The even profile is also attached to DD- lines that had none, so a
 *    department mixing DD- and BUD- lines is phased completely (the report blanks a partly phased vote).
 *  - July to mid-November actuals, imported the way a council does it: five monthly USD ledger exports and
 *    one ZWG export, uploaded and validated by the finance officer and committed by the finance administrator
 *    against declared control totals (POST /finance/imports, /validate, /commit). Some lines run under, some
 *    over (fuel, council sittings, refuse), revenue both ahead and behind profile.
 *  - Open purchase orders and contracts, imported as a commitments batch.
 *  - Budget revisions: three submitted to the committee, one approved, one rejected, one draft.
 *  - Six capital projects (Vungu-Mvuma road regravelling, borehole drilling, Mabula clinic maternity wing,
 *    refuse compactor truck, Lower Gweru bridge deck, Shurugwi road drainage) with allocations, linked
 *    transactions, physical progress, two awaiting approval and one still proposed.
 *  - Ward splits (finance.spatial_allocation): approved, pending, and one rejected.
 *  - Variance explanations on some over/under-running lines; the rest are deliberately left unexplained.
 *
 * Everything that has a route goes through the route as the right demo role, so separation of duties, scope and
 * audit are genuine. Timestamps the routes stamp as "now" are then backdated in SQL on BUD- rows only, so the
 * estimates read as approved in June and the decisions as taken during the year. Nothing is dated after
 * 2026-11-17 and USD and ZWG are never mixed or converted (decision D4). Nothing here posts to the general
 * ledger: actuals are register transactions (finance.transaction), as the import route writes them.
 *
 * Idempotent: every step looks for its own BUD- row first and only creates or advances what is missing.
 */
const { Client } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error('Set DATABASE_URL to the LOCAL database.'); process.exit(1) }
const dbHost = new URL(DATABASE_URL).hostname
if (!['127.0.0.1', 'localhost', '::1'].includes(dbHost)) {
  console.error(`Refusing to run against ${dbHost}: this demo seed only writes to a local database.`)
  process.exit(1)
}
const API = process.env.FINANCE_API || 'http://127.0.0.1:3011/api'
const apiHost = new URL(API).hostname
if (!['127.0.0.1', 'localhost'].includes(apiHost)) {
  console.error(`Refusing to drive ${API}: the API must be a local server wired to the local database.`)
  process.exit(1)
}

const YEAR_LABEL = 'DD 2026/27 (synthetic demo — July to June, not a Council year)'
const PASSWORD = 'demo1234'
const USERS = {
  admin: 'demo.admin@vungu.test',
  fadmin: 'demo.finance-admin@vungu.test',
  fo: 'demo.finance-officer@vungu.test',
  bo: 'demo.budget-officer@vungu.test',
  dh: 'demo.dept-head@vungu.test',
  fc: 'demo.treasurer@vungu.test',
}

// ── Classification ────────────────────────────────────────────────────────────────────────────
const NEW_DEPARTMENTS = [
  { code: 'BUD-ADM', name: 'Administration and Corporate Services', vote: 5 },
  { code: 'BUD-WSN', name: 'Water and Sanitation', vote: 35 },
  { code: 'BUD-PLN', name: 'Planning and Development', vote: 60 },
]
const PROGRAMMES = [
  { code: 'BUD-P-GOV', name: 'Governance and corporate services', dept: 'BUD-ADM' },
  { code: 'BUD-P-FINMGT', name: 'Financial management and audit', dept: 'DD-FIN' },
  { code: 'BUD-P-PLANT', name: 'Plant and equipment', dept: 'DD-ENG' },
  { code: 'BUD-P-ENVH', name: 'Environmental health and refuse', dept: 'DD-HLT' },
  { code: 'BUD-P-COMM', name: 'Community development', dept: 'DD-SOC' },
  { code: 'BUD-P-PLAN', name: 'Physical planning and development control', dept: 'BUD-PLN' },
  { code: 'BUD-P-WSUP', name: 'Rural water supply', dept: 'BUD-WSN' },
  { code: 'BUD-P-SAN', name: 'Sanitation and hygiene', dept: 'BUD-WSN' },
]
const ACTIVITIES = [
  { code: 'BUD-A-COUNCIL', name: 'Council and committee sittings', prog: 'BUD-P-GOV' },
  { code: 'BUD-A-REFUSE', name: 'Refuse collection — Lower Gweru', prog: 'BUD-P-ENVH' },
  { code: 'BUD-A-LAYOUT', name: 'Layout planning and survey', prog: 'BUD-P-PLAN' },
  { code: 'BUD-A-DRILL', name: 'Borehole drilling', prog: 'BUD-P-WSUP' },
  { code: 'BUD-A-TREAT', name: 'Water treatment', prog: 'BUD-P-WSUP' },
]
const ACCOUNTS = [
  { code: 'BUD-1500', name: 'Water and sewerage charges', kind: 'revenue', revenue_class: 'internally_generated' },
  { code: 'BUD-1600', name: 'Plan approval and development permit fees', kind: 'revenue', revenue_class: 'internally_generated' },
  { code: 'BUD-1650', name: 'Unit tax and land development levy', kind: 'revenue', revenue_class: 'internally_generated' },
  { code: 'BUD-1700', name: 'Clinic and health service fees', kind: 'revenue', revenue_class: 'internally_generated' },
  { code: 'BUD-5400', name: 'Fuel and lubricants', kind: 'expenditure', expenditure_class: 'recurrent' },
  { code: 'BUD-5500', name: 'Vehicle, plant and equipment repairs', kind: 'expenditure', expenditure_class: 'recurrent' },
  { code: 'BUD-5600', name: 'Water treatment chemicals', kind: 'expenditure', expenditure_class: 'recurrent' },
  { code: 'BUD-5650', name: 'Professional and survey services', kind: 'expenditure', expenditure_class: 'recurrent' },
  { code: 'BUD-5700', name: 'Council and committee meeting costs', kind: 'expenditure', expenditure_class: 'recurrent' },
  { code: 'BUD-5800', name: 'Administration, stationery and communications', kind: 'expenditure', expenditure_class: 'recurrent' },
  { code: 'BUD-5900', name: 'Refuse collection and disposal', kind: 'expenditure', expenditure_class: 'recurrent' },
  { code: 'BUD-5950', name: 'Community programmes and grants', kind: 'expenditure', expenditure_class: 'recurrent' },
  { code: 'BUD-7300', name: 'Buildings and structures — capital', kind: 'expenditure', expenditure_class: 'capital' },
  { code: 'BUD-7400', name: 'Vehicles, plant and equipment — capital', kind: 'expenditure', expenditure_class: 'capital' },
]

// Ward codes: the same four placeholders the DD- dataset uses (the ward register is not loaded locally;
// decision D11 is open, so splits report as "ward register not linked" until it is).
const W1 = 'ZW102101'; const W2 = 'ZW102102'; const W3 = 'ZW102103'; const W4 = 'ZW102104'

const SUPPLIERS = {
  fuel: [['SUP-0411', 'Midlands Fuel Depot'], ['SUP-0418', 'Gweru Service Station (Pvt) Ltd']],
  repairs: [['SUP-0522', 'Gweru Motor Spares'], ['SUP-0530', 'Shurugwi Road Plant Hire & Repairs']],
  admin: [['SUP-0610', 'Ruzivo Stationers, Gweru'], ['SUP-0612', 'TelOne Gweru'], ['SUP-0615', 'ZESA Holdings — Gweru']],
  council: [['SUP-0701', 'Councillors\' sitting allowances'], ['SUP-0705', 'Antelope Park Conference Centre']],
  chem: [['SUP-0820', 'Kwekwe Chemicals & Water Treatment']],
  survey: [['SUP-0901', 'Chirumhanzu Land Surveyors']],
  refuse: [['SUP-0950', 'Lower Gweru Waste Contractors'], ['SUP-0411', 'Midlands Fuel Depot']],
  community: [['SUP-0960', 'Vungu Women\'s Savings Groups'], ['SUP-0961', 'Ward 3 Youth Brick Moulding Co-op']],
  road: [['SUP-1001', 'Mvuma Earthmovers (Pvt) Ltd']],
  drill: [['SUP-1010', 'Chirumhanzu Drilling Services']],
  clinic: [['SUP-1020', 'Midlands Civils (Pvt) Ltd']],
  audit: [['SUP-1101', 'Office of the Auditor-General'], ['SUP-1105', 'CBZ Bank — Gweru branch']],
  gravel: [['SUP-1201', 'Lower Gweru Quarry'], ['SUP-1205', 'Vungu Hardware']],
  pumps: [['SUP-1301', 'Gweru Pump & Pipe']],
  payroll: [['PAY-001', 'Payroll — staff salaries']],
}

/**
 * The budget lines. `state` is where the line ends up; `by` who prepares it; `ytd` the share of the original
 * allocation that has actually moved by mid-November; `pattern` how the actuals are spread over July-November.
 */
const LINES = [
  // Administration and Corporate Services
  { code: 'BUD-ADM-01', dept: 'BUD-ADM', prog: 'BUD-P-GOV', acct: 'DD-5200', ccy: 'USD', amount: 286000, descr: 'Salaries and allowances — Administration', state: 'approved', ytd: 0.333, pattern: 'payroll', sup: 'payroll' },
  { code: 'BUD-ADM-02', dept: 'BUD-ADM', prog: 'BUD-P-GOV', act: 'BUD-A-COUNCIL', acct: 'BUD-5700', ccy: 'USD', amount: 64000, descr: 'Council and committee meeting costs', state: 'approved', ytd: 0.93, pattern: 'recurrent', sup: 'council' },
  { code: 'BUD-ADM-03', dept: 'BUD-ADM', prog: 'BUD-P-GOV', acct: 'BUD-5800', ccy: 'USD', amount: 48000, descr: 'Office administration, stationery and communications', state: 'approved', ytd: 0.39, pattern: 'recurrent', sup: 'admin' },
  { code: 'BUD-ADM-04', dept: 'BUD-ADM', prog: 'BUD-P-GOV', acct: 'BUD-5400', ccy: 'USD', amount: 22000, descr: 'Fuel — administration pool vehicles', state: 'approved', ytd: 0.41, pattern: 'recurrent', sup: 'fuel' },
  { code: 'BUD-ADM-05', dept: 'BUD-ADM', prog: 'BUD-P-GOV', acct: 'BUD-1650', ccy: 'USD', amount: 180000, descr: 'Unit tax and land development levy — revenue estimate', state: 'approved', ytd: 0.22, pattern: 'revenue' },
  { code: 'BUD-ADM-06', dept: 'BUD-ADM', prog: 'BUD-P-GOV', acct: 'BUD-7400', ccy: 'USD', amount: 35000, descr: 'ICT equipment replacement — head office', state: 'draft' },
  // Finance (DD-FIN)
  { code: 'BUD-FIN-01', dept: 'DD-FIN', prog: 'BUD-P-FINMGT', acct: 'DD-5200', ccy: 'USD', amount: 198000, descr: 'Salaries and allowances — Finance', state: 'approved', ytd: 0.333, pattern: 'payroll', sup: 'payroll' },
  { code: 'BUD-FIN-02', dept: 'DD-FIN', prog: 'BUD-P-FINMGT', acct: 'BUD-5800', ccy: 'USD', amount: 41000, descr: 'Audit fees and bank charges', state: 'approved', ytd: 0.47, pattern: 'recurrent', sup: 'audit' },
  { code: 'BUD-FIN-03', dept: 'DD-FIN', prog: 'BUD-P-FINMGT', acct: 'BUD-5650', ccy: 'USD', amount: 55000, descr: 'Valuation roll update — Lower Gweru and Vungu farms', state: 'submitted' },
  { code: 'BUD-FIN-04', dept: 'DD-FIN', prog: 'DD-P-REV', act: 'DD-A-BILL', acct: 'DD-1100', ccy: 'ZWG', amount: 9500000, descr: 'Rates and supplementary charges — revenue estimate (ZWG)', state: 'approved', ytd: 0.44, pattern: 'revenue' },
  // Engineering and Works (DD-ENG) — the head of department's own vote
  { code: 'BUD-ENG-01', dept: 'DD-ENG', prog: 'DD-P-ROADS', act: 'DD-A-GRADE', acct: 'DD-7100', fund: 'DD-1300', ccy: 'USD', amount: 410000, descr: 'Vungu–Mvuma road regravelling (32 km) — capital', ward: W1, state: 'approved', ytd: 0.46, pattern: 'capital', weights: [0, 0.28, 0.32, 0.40, 0], sup: 'road', project: 'BUD-PRJ-01' },
  { code: 'BUD-ENG-02', dept: 'DD-ENG', prog: 'BUD-P-PLANT', acct: 'BUD-5400', ccy: 'USD', amount: 120000, descr: 'Fuel and lubricants — road plant', state: 'approved', ytd: 1.04, pattern: 'recurrent', weights: [1, 1.15, 1.35, 1.2, 0.55], sup: 'fuel' },
  { code: 'BUD-ENG-03', dept: 'DD-ENG', prog: 'BUD-P-PLANT', acct: 'BUD-5500', ccy: 'USD', amount: 75000, descr: 'Grader, tipper and TLB repairs', state: 'approved', ytd: 0.52, pattern: 'recurrent', sup: 'repairs' },
  { code: 'BUD-ENG-04', dept: 'DD-ENG', prog: 'DD-P-ROADS', acct: 'DD-5200', ccy: 'USD', amount: 264000, descr: 'Salaries and allowances — Engineering', state: 'approved', ytd: 0.333, pattern: 'payroll', sup: 'payroll' },
  { code: 'BUD-ENG-05', dept: 'DD-ENG', prog: 'DD-P-ROADS', act: 'DD-A-CULV', acct: 'DD-5100', ccy: 'ZWG', amount: 6000000, descr: 'Gravel, culvert rings and local purchases (ZWG)', ward: W4, state: 'approved', ytd: 0.41, pattern: 'recurrent', sup: 'gravel' },
  { code: 'BUD-ENG-06', dept: 'DD-ENG', prog: 'DD-P-ROADS', acct: 'DD-7100', ccy: 'USD', amount: 95000, descr: 'Lower Gweru bridge deck repairs', ward: W2, state: 'draft', by: 'dh' },
  { code: 'BUD-ENG-07', dept: 'DD-ENG', prog: 'DD-P-ROADS', act: 'DD-A-CULV', acct: 'DD-7100', ccy: 'USD', amount: 68000, descr: 'Shurugwi road drainage and culverts', ward: W3, state: 'submitted', by: 'dh' },
  { code: 'BUD-ENG-08', dept: 'DD-ENG', prog: 'DD-P-ROADS', acct: 'BUD-7300', ccy: 'USD', amount: 120000, descr: 'Street lighting — Lower Gweru growth point', ward: W2, state: 'returned', by: 'dh',
    returned: 'No quotation or ZESA connection estimate is attached, and the line does not say how many poles. Resubmit with the engineer\'s estimate and the ward councillor\'s request.' },
  // Health and Environment (DD-HLT)
  { code: 'BUD-HLT-01', dept: 'DD-HLT', prog: 'DD-P-PHC', acct: 'BUD-7300', fund: 'DD-1300', ccy: 'USD', amount: 240000, descr: 'Mabula clinic maternity wing extension — capital', ward: W3, state: 'approved', ytd: 0.35, pattern: 'capital', weights: [0, 0.45, 0, 0.55, 0], sup: 'clinic', project: 'BUD-PRJ-03' },
  { code: 'BUD-HLT-02', dept: 'DD-HLT', prog: 'BUD-P-ENVH', act: 'BUD-A-REFUSE', acct: 'BUD-7400', fund: 'DD-1400', ccy: 'USD', amount: 165000, descr: 'Refuse compactor truck (14 m³) — capital', state: 'approved', ytd: 0 },
  { code: 'BUD-HLT-03', dept: 'DD-HLT', prog: 'BUD-P-ENVH', act: 'BUD-A-REFUSE', acct: 'BUD-5900', ccy: 'USD', amount: 54000, descr: 'Refuse collection and disposal — Lower Gweru', state: 'approved', ytd: 0.97, pattern: 'recurrent', weights: [1, 1.1, 1.2, 1.3, 0.6], sup: 'refuse' },
  { code: 'BUD-HLT-04', dept: 'DD-HLT', prog: 'DD-P-PHC', acct: 'BUD-1700', ccy: 'USD', amount: 72000, descr: 'Clinic and health service fees — revenue estimate', state: 'approved', ytd: 0.40, pattern: 'revenue' },
  { code: 'BUD-HLT-05', dept: 'DD-HLT', prog: 'BUD-P-ENVH', acct: 'BUD-5800', ccy: 'USD', amount: 18000, descr: 'Environmental health inspections and food-handler certification', state: 'submitted' },
  // Social Services (DD-SOC)
  { code: 'BUD-SOC-01', dept: 'DD-SOC', prog: 'BUD-P-COMM', acct: 'BUD-5950', ccy: 'USD', amount: 38000, descr: 'Youth and women empowerment projects', state: 'approved', ytd: 0.08, pattern: 'recurrent', weights: [0, 0, 1, 0, 0], sup: 'community' },
  { code: 'BUD-SOC-02', dept: 'DD-SOC', prog: 'BUD-P-COMM', acct: 'BUD-5950', ccy: 'USD', amount: 12000, descr: 'Vungu sports gala and recreation', state: 'draft' },
  { code: 'BUD-SOC-03', dept: 'DD-SOC', prog: 'BUD-P-COMM', acct: 'DD-5200', ccy: 'USD', amount: 96000, descr: 'Salaries and allowances — Social Services', state: 'approved', ytd: 0.333, pattern: 'payroll', sup: 'payroll' },
  // Planning and Development
  { code: 'BUD-PLN-01', dept: 'BUD-PLN', prog: 'BUD-P-PLAN', acct: 'DD-5200', ccy: 'USD', amount: 132000, descr: 'Salaries and allowances — Planning', state: 'approved', ytd: 0.333, pattern: 'payroll', sup: 'payroll' },
  { code: 'BUD-PLN-02', dept: 'BUD-PLN', prog: 'BUD-P-PLAN', acct: 'BUD-1600', ccy: 'USD', amount: 95000, descr: 'Plan approval and development permit fees — revenue estimate', state: 'approved', ytd: 0.61, pattern: 'revenue', weights: [0.7, 0.9, 1.3, 1.4, 0.7] },
  { code: 'BUD-PLN-03', dept: 'BUD-PLN', prog: 'BUD-P-PLAN', act: 'BUD-A-LAYOUT', acct: 'BUD-5650', ccy: 'USD', amount: 60000, descr: 'Layout planning and survey — Lower Gweru extension', ward: W2, state: 'approved', ytd: 0.12, pattern: 'capital', weights: [0, 0, 1, 0, 0], sup: 'survey' },
  { code: 'BUD-PLN-04', dept: 'BUD-PLN', prog: 'BUD-P-PLAN', acct: 'BUD-5650', ccy: 'USD', amount: 45000, descr: 'Local development plan review', state: 'submitted' },
  // Water and Sanitation
  { code: 'BUD-WSN-01', dept: 'BUD-WSN', prog: 'BUD-P-WSUP', act: 'BUD-A-DRILL', acct: 'DD-7200', fund: 'DD-1400', ccy: 'USD', amount: 180000, descr: 'Borehole drilling — Wards 2, 3 and 4 (12 boreholes)', state: 'approved', ytd: 0.67, pattern: 'capital', weights: [0, 0.3, 0.35, 0.35, 0], sup: 'drill', project: 'BUD-PRJ-02' },
  { code: 'BUD-WSN-02', dept: 'BUD-WSN', prog: 'BUD-P-WSUP', act: 'BUD-A-TREAT', acct: 'BUD-5600', ccy: 'USD', amount: 36000, descr: 'Water treatment chemicals', state: 'approved', ytd: 0.36, pattern: 'recurrent', sup: 'chem' },
  { code: 'BUD-WSN-03', dept: 'BUD-WSN', prog: 'BUD-P-WSUP', acct: 'BUD-1500', ccy: 'USD', amount: 210000, descr: 'Water and sewerage charges — revenue estimate', state: 'approved', ytd: 0.29, pattern: 'revenue', weights: [1.2, 0.6, 0.5, 1.1, 0.6] },
  { code: 'BUD-WSN-04', dept: 'BUD-WSN', prog: 'BUD-P-WSUP', acct: 'BUD-5500', ccy: 'ZWG', amount: 2400000, descr: 'Pump spares and borehole maintenance (ZWG)', state: 'approved', ytd: 0.33, pattern: 'recurrent', sup: 'pumps' },
  { code: 'BUD-WSN-05', dept: 'BUD-WSN', prog: 'BUD-P-SAN', acct: 'BUD-7300', ccy: 'USD', amount: 28000, descr: 'Blair VIP latrines — Ward 3 schools', ward: W3, state: 'returned',
    returned: 'This appears to duplicate the UNICEF-funded WASH programme already running at Ward 3 schools. Confirm the scope with the District Development Coordinator before resubmitting.' },
]

// Revisions. `marker` makes each one findable on a re-run; it is carried at the end of the reason as the
// budget office's own revision reference.
const REVISIONS = [
  { marker: 'BUD-REV-01', line: 'BUD-ENG-02', by: 'dh', delta: '18000.00', state: 'submitted', effective: '2026-11-01',
    reason: 'Supplementary allocation for road-plant fuel: graders were kept on the Vungu–Mvuma regravelling for 14 extra days in September and the diesel pump price rose from $1.52 to $1.61 a litre in August.' },
  { marker: 'BUD-REV-02', line: 'BUD-ADM-02', by: 'bo', delta: '12000.00', state: 'submitted', effective: '2026-11-01',
    reason: 'Supplementary allocation for two special full-council sittings (budget consultation, 12 August; land audit, 23 September) that were not in the approved estimates.' },
  { marker: 'BUD-REV-03', line: 'BUD-ADM-05', by: 'bo', delta: '-40000.00', state: 'submitted', effective: '2026-11-01',
    reason: 'Reduce the unit tax estimate: resettlement-area plots in Wards 1 and 4 were exempted by the Ministry circular of 29 August, removing about 900 plots from the levy roll.' },
  { marker: 'BUD-REV-04', line: 'BUD-WSN-01', by: 'bo', delta: '40000.00', state: 'approved', effective: '2026-09-15',
    reason: 'Supplementary allocation from the devolution fund for two additional boreholes at Mabula and Nyama schools, requested by the Ward 3 and Ward 4 development committees.',
    note: 'Resolution FC/2026/41. Approved: funded from the devolution grant tranche received in September.' },
  { marker: 'BUD-REV-05', line: 'BUD-PLN-03', by: 'bo', delta: '25000.00', state: 'rejected', effective: '2026-10-15',
    reason: 'Supplementary allocation to extend the Lower Gweru layout survey to the 140 hectares north of the railway line.',
    note: 'Resolution FC/2026/47. Not approved: the line has spent 12 % of its allocation; resubmit when the current survey contract is substantially complete.' },
  { marker: 'BUD-REV-06', line: 'BUD-SOC-01', by: 'bo', delta: '-10000.00', state: 'draft', effective: '2026-12-01',
    reason: 'Reduce the youth and women empowerment allocation: the Ward 6 and Ward 9 projects have not started and will not draw funds this year.' },
]

const PROJECTS = [
  { ref: 'BUD-PRJ-01', name: 'Vungu–Mvuma road regravelling (32 km)', dept: 'DD-ENG', ward: W1, by: 'dh', budget: '410000.00', fund: 'DD-1300',
    location: 'Vungu–Mvuma road, km 0 (Gweru turn-off) to km 32 (Ward 4 boundary)', lon: 29.985, lat: -19.612, start: '2026-08-01', end: '2027-03-31',
    target: 'in_progress', progress: 42, alloc: [{ line: 'BUD-ENG-01', amount: '410000.00', date: '2026-08-01' }],
    description: 'Regravelling and reshaping of 32 km of the Vungu–Mvuma district road, with drainage at 11 crossings. Contractor: Mvuma Earthmovers (Pvt) Ltd.' },
  { ref: 'BUD-PRJ-02', name: 'Borehole drilling programme — Wards 2, 3 and 4', dept: 'BUD-WSN', ward: null, by: 'fo', budget: '220000.00', fund: 'DD-1400',
    location: 'Twelve sites across Wards 2, 3 and 4 (schools, clinics and village centres)', lon: 29.79, lat: -19.52, start: '2026-08-15', end: '2027-02-28',
    target: 'in_progress', progress: 55, alloc: [{ line: 'BUD-WSN-01', amount: '180000.00', date: '2026-08-15' }, { line: 'BUD-WSN-01', amount: '40000.00', date: '2026-09-15', revision: 'BUD-REV-04' }],
    description: 'Drilling, casing, pump installation and yield testing of 14 boreholes (12 original plus 2 from the September supplementary). 7 drilled and capped to date.' },
  { ref: 'BUD-PRJ-03', name: 'Mabula clinic maternity wing extension', dept: 'DD-HLT', ward: W3, by: 'fo', budget: '240000.00', fund: 'DD-1300',
    location: 'Mabula Rural Health Centre, Ward 3', lon: 29.712, lat: -19.468, start: '2026-08-01', end: '2027-05-31',
    target: 'in_progress', progress: 18, alloc: [{ line: 'BUD-HLT-01', amount: '240000.00', date: '2026-08-01' }],
    description: 'Six-bed maternity wing, waiting mothers\' shelter and solar back-up. Foundations and slab complete; brickwork to window level.' },
  { ref: 'BUD-PRJ-04', name: 'Refuse compactor truck purchase (14 m³)', dept: 'DD-HLT', ward: null, by: 'fo', budget: '165000.00', fund: 'DD-1400',
    location: 'Lower Gweru growth point depot', lon: 29.62, lat: -19.39, start: '2026-12-01', end: '2027-04-30',
    target: 'awaiting_approval', progress: null, alloc: [{ line: 'BUD-HLT-02', amount: '165000.00', date: '2026-11-10' }],
    description: 'Purchase of one 14 m³ rear-loading compactor to replace the 2009 tipper on the Lower Gweru refuse route. Three quotations received through the procurement committee.' },
  { ref: 'BUD-PRJ-05', name: 'Lower Gweru bridge deck repairs', dept: 'DD-ENG', ward: W2, by: 'dh', budget: '95000.00', fund: null,
    location: 'Lower Gweru bridge over the Gweru River', lon: 29.64, lat: -19.37, start: '2027-01-15', end: '2027-06-15',
    target: 'proposed', progress: null, alloc: [],
    description: 'Replacement of the damaged deck slab and guard rails on the Lower Gweru bridge. Awaiting the budget line\'s approval.' },
  { ref: 'BUD-PRJ-06', name: 'Shurugwi road drainage and culverts', dept: 'DD-ENG', ward: W3, by: 'dh', budget: '68000.00', fund: null,
    location: 'Gweru–Shurugwi district road, km 8–15', lon: 29.93, lat: -19.58, start: '2027-01-10', end: '2027-04-30',
    target: 'awaiting_approval', progress: null, alloc: [],
    description: 'Six ring culverts and mitre drains on the flood-prone section of the Shurugwi road before the next rains.' },
]

const SPLITS = [
  { kind: 'budget_line', subject: 'BUD-ENG-01', ward: W1, amount: '246000.00', state: 'approved',
    methodology: 'Split by road length: km 0 to 19.2 of the Vungu–Mvuma road lies in Ward 1 (60 % of the 32 km).' },
  { kind: 'budget_line', subject: 'BUD-ENG-01', ward: W4, amount: '164000.00', state: 'approved',
    methodology: 'Split by road length: km 19.2 to 32 of the Vungu–Mvuma road lies in Ward 4 (40 % of the 32 km).' },
  { kind: 'project', subject: 'BUD-PRJ-02', ward: W2, amount: '73000.00', state: 'approved',
    methodology: 'Five boreholes of fourteen sited in Ward 2 (Lower Gweru school, clinic and three villages), at the contract rate per hole.' },
  { kind: 'project', subject: 'BUD-PRJ-02', ward: W3, amount: '73000.00', state: 'approved',
    methodology: 'Five boreholes of fourteen sited in Ward 3 (Mabula school and clinic, three villages), at the contract rate per hole.' },
  { kind: 'project', subject: 'BUD-PRJ-02', ward: W4, amount: '74000.00', state: 'draft',
    methodology: 'Four boreholes of fourteen sited in Ward 4, including the two added by the September supplementary (Nyama school).' },
  { kind: 'budget_line', subject: 'BUD-HLT-03', ward: W1, amount: '24000.00', state: 'rejected',
    methodology: 'Share of refuse collection by number of serviced stands: an estimate for Ward 1 based on the 2022 census.',
    note: 'Ward 1 is not on the Lower Gweru refuse route; this line serves the growth point only. Re-split on the route schedule.' },
  { kind: 'budget_line', subject: 'BUD-HLT-03', ward: W3, amount: '30000.00', state: 'draft',
    methodology: 'Refuse collection days on the Lower Gweru route schedule: 3 of 5 weekly runs are in Ward 3.' },
  { kind: 'budget_line', subject: 'BUD-WSN-02', ward: W2, amount: '36000.00', state: 'draft',
    methodology: 'The Lower Gweru treatment works, the only treated scheme, is in Ward 2; all chemicals are dosed there.' },
]

const EXPLANATIONS = [
  { line: 'BUD-ENG-02', by: 'dh', period: 'Oct 2026',
    text: 'Fuel ran ahead of the estimate: council graders worked 14 extra days on the Vungu–Mvuma regravelling in September and the diesel pump price rose from $1.52 to $1.61 a litre in August. A supplementary of $18,000 is before the finance committee.' },
  { line: 'BUD-ADM-02', by: 'bo', period: 'Oct 2026',
    text: 'Two special full-council sittings (budget consultation on 12 August and the land audit on 23 September) were not in the estimate: sitting allowances and transport for 18 councillors. A supplementary of $12,000 has been requested.' },
  { line: 'BUD-PLN-02', by: 'bo', period: 'Oct 2026',
    text: 'Plan approval fees are ahead of profile because 46 residential stands in the Lower Gweru extension were submitted for approval after the layout was approved in August. Not expected to recur in the second half.' },
  { line: 'BUD-WSN-03', by: 'bo', period: 'Oct 2026',
    text: 'Water charges are behind profile: the Lower Gweru scheme pump was down for five weeks in August and September awaiting spares, and billing was suspended for the affected stands.' },
]

// Open purchase orders and contract balances at 14 November, imported as a commitments batch.
const COMMITMENTS = [
  { ref: 'BUD-PO-2026-0412', line: 'BUD-ENG-01', dept: 'DD-ENG', acct: 'DD-7100', amount: '150000.00', date: '2026-08-04', descr: 'Contract balance — Vungu–Mvuma regravelling, Mvuma Earthmovers (Pvt) Ltd' },
  { ref: 'BUD-PO-2026-0431', line: 'BUD-HLT-01', dept: 'DD-HLT', acct: 'BUD-7300', amount: '120000.00', date: '2026-08-11', descr: 'Contract balance — Mabula maternity wing, Midlands Civils (Pvt) Ltd' },
  { ref: 'BUD-PO-2026-0455', line: 'BUD-WSN-01', dept: 'BUD-WSN', acct: 'DD-7200', amount: '60000.00', date: '2026-09-18', descr: 'Drilling contract — boreholes 8 to 14, Chirumhanzu Drilling Services' },
  { ref: 'BUD-PO-2026-0590', line: 'BUD-ENG-02', dept: 'DD-ENG', acct: 'BUD-5400', amount: '9000.00', date: '2026-11-09', descr: 'Diesel — 5,500 litres, Midlands Fuel Depot' },
  { ref: 'BUD-PO-2026-0597', line: 'BUD-ADM-03', dept: 'BUD-ADM', acct: 'BUD-5800', amount: '3200.00', date: '2026-11-11', descr: 'Stationery and printer toner, Ruzivo Stationers' },
  { ref: 'BUD-PO-2026-0601', line: 'BUD-PLN-03', dept: 'BUD-PLN', acct: 'BUD-5650', amount: '22000.00', date: '2026-10-02', descr: 'Survey contract — Lower Gweru extension, Chirumhanzu Land Surveyors' },
  { ref: 'BUD-PO-2026-0603', line: 'BUD-HLT-03', dept: 'DD-HLT', acct: 'BUD-5900', amount: '4500.00', date: '2026-11-12', descr: 'Refuse collection — November, Lower Gweru Waste Contractors' },
]

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────
const log = (...a) => console.log(' ', ...a)
const MONTHS = [
  { key: '2026-07', name: 'July 2026', last: 31 },
  { key: '2026-08', name: 'August 2026', last: 31 },
  { key: '2026-09', name: 'September 2026', last: 30 },
  { key: '2026-10', name: 'October 2026', last: 31 },
  { key: '2026-11', name: 'November 2026', last: 14 }, // the month in progress: nothing after mid-November
]
const DEFAULT_WEIGHTS = {
  payroll: [1, 1, 1, 1, 0],
  recurrent: [1, 1, 1, 1.1, 0.5],
  revenue: [1.2, 1, 0.9, 1, 0.6],
  capital: [0, 0.3, 0.3, 0.4, 0],
}
const cents = (n) => Math.round(n * 100)
const money = (c) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`
const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** Split `total` cents by `weights`, whole dollars except the remainder, which lands on the last part. */
function split(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!sum) return weights.map(() => 0)
  const out = weights.map((w) => Math.round((total * w) / sum / 100) * 100)
  const diff = total - out.reduce((a, b) => a + b, 0)
  const lastIdx = weights.map((w, i) => (w ? i : -1)).filter((i) => i >= 0).pop()
  out[lastIdx] += diff
  return out
}

/** The actual rows for one line over July to mid-November. */
function actualRows(line) {
  if (!line.ytd || !line.pattern) return []
  const total = cents(line.amount * line.ytd)
  const weights = line.weights || DEFAULT_WEIGHTS[line.pattern]
  const perMonth = split(total, weights)
  const rows = []
  const sup = SUPPLIERS[line.sup] || []
  perMonth.forEach((amount, m) => {
    if (!amount) return
    const month = MONTHS[m]
    let parts
    if (line.pattern === 'payroll') parts = [{ day: Math.min(24, month.last), share: 1 }]
    else if (line.pattern === 'capital') parts = [{ day: Math.min(18, month.last), share: 1 }]
    else if (line.pattern === 'revenue') parts = month.last < 20
      ? [{ day: 4, share: 0.45 }, { day: 11, share: 0.55 }]
      : [{ day: 7, share: 0.3 }, { day: 17, share: 0.3 }, { day: 28, share: 0.4 }]
    else parts = month.last < 20 ? [{ day: 6, share: 0.6 }, { day: 12, share: 0.4 }] : [{ day: 9, share: 0.55 }, { day: 22, share: 0.45 }]
    const amounts = split(amount, parts.map((p) => p.share))
    parts.forEach((p, i) => {
      const date = `${month.key}-${String(p.day).padStart(2, '0')}`
      const n = rows.length + 1
      const s = sup.length ? sup[(m + i) % sup.length] : null
      let description
      if (line.pattern === 'payroll') description = `${line.descr.replace(/^Salaries and allowances — /, '')} payroll — ${month.name}`
      else if (line.pattern === 'revenue') description = `${line.descr.replace(/ — revenue estimate.*$/, '')} — receipts batch ${month.name}`
      else if (line.pattern === 'capital') description = `${line.descr.replace(/ — capital$/, '')} — payment certificate ${month.name}`
      else description = `${line.descr} — ${month.name}`
      rows.push({
        date,
        month: month.key,
        line: line.code,
        dept: line.dept,
        acct: line.acct,
        ccy: line.ccy,
        amount: amounts[i],
        ref: `${line.pattern === 'revenue' ? 'RC' : 'PV'}-${line.code.slice(4)}-${month.key.slice(5)}${String.fromCharCode(97 + i)}`,
        sourceRef: `${line.code}-${month.key}-${i + 1}`,
        type: line.pattern === 'revenue' ? 'receipt' : 'payment',
        description,
        supplierRef: line.pattern === 'revenue' ? '' : (s ? s[0] : ''),
        supplierName: line.pattern === 'revenue' ? '' : (s ? s[1] : ''),
        ward: line.ward || '',
        project: line.project || '',
        n,
      })
    })
  })
  return rows
}

const csvCell = (v) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const toCsv = (header, rows) => [header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n'

// ── HTTP ──────────────────────────────────────────────────────────────────────────────────────
const cookies = {}
async function login(who) {
  if (cookies[who]) return cookies[who]
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: USERS[who], password: PASSWORD }),
  })
  if (res.status !== 200) throw new Error(`login ${USERS[who]} failed: ${res.status} ${await res.text()}`)
  const set = res.headers.getSetCookie().find((c) => c.startsWith('vungu_at='))
  if (!set) throw new Error(`login ${USERS[who]} returned no vungu_at cookie`)
  await res.arrayBuffer()
  cookies[who] = set.split(';')[0]
  return cookies[who]
}

async function call(who, method, path, body, { allow = [] } = {}) {
  const cookie = await login(who)
  const isForm = body instanceof FormData
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { cookie, ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (res.status >= 400 && !allow.includes(res.status)) {
    throw new Error(`${who} ${method} ${path} -> ${res.status}: ${text.slice(0, 600)}`)
  }
  return { status: res.status, data: json.data, body: json }
}

// ── Main ──────────────────────────────────────────────────────────────────────────────────────
async function report(db) {
  const { rows } = await db.query(`
    SELECT 'department' AS entity, NULL AS state, count(*)::int AS n FROM finance.department WHERE code LIKE 'BUD-%'
    UNION ALL SELECT 'programme', NULL, count(*)::int FROM finance.programme WHERE code LIKE 'BUD-%'
    UNION ALL SELECT 'activity', NULL, count(*)::int FROM finance.activity WHERE code LIKE 'BUD-%'
    UNION ALL SELECT 'account', NULL, count(*)::int FROM finance.account WHERE code LIKE 'BUD-%'
    UNION ALL SELECT 'budget_line', status, count(*)::int FROM finance.budget_line WHERE code LIKE 'BUD-%' AND deleted_at IS NULL GROUP BY status
    UNION ALL SELECT 'budget_revision', r.state, count(*)::int FROM finance.budget_revision r JOIN finance.budget_line l ON l.id = r.budget_line_id WHERE l.code LIKE 'BUD-%' AND r.reason LIKE '%(BUD-REV-%' GROUP BY r.state
    UNION ALL SELECT 'budget_distribution', status, count(*)::int FROM finance.budget_distribution WHERE name LIKE 'BUD %' GROUP BY status
    UNION ALL SELECT 'lines phased', NULL, count(*)::int FROM finance.budget_line l JOIN finance.budget_distribution d ON d.id = l.distribution_id WHERE d.name LIKE 'BUD %'
    UNION ALL SELECT 'import_batch', dataset || '/' || status, count(*)::int FROM finance.import_batch WHERE idempotency_key LIKE 'BUD-%' GROUP BY dataset, status
    UNION ALL SELECT 'transaction', currency::text, count(*)::int FROM finance.transaction WHERE source_ref LIKE 'BUD-%' AND source_system LIKE 'import:%' GROUP BY currency
    UNION ALL SELECT 'commitment', status, count(*)::int FROM finance.commitment WHERE reference LIKE 'BUD-%' GROUP BY status
    UNION ALL SELECT 'project', status, count(*)::int FROM finance.project WHERE reference LIKE 'BUD-%' GROUP BY status
    UNION ALL SELECT 'project_allocation', NULL, count(*)::int FROM finance.project_allocation a JOIN finance.project p ON p.id = a.project_id WHERE p.reference LIKE 'BUD-%' AND a.deleted_at IS NULL
    UNION ALL SELECT 'project_transaction', NULL, count(*)::int FROM finance.project_transaction a JOIN finance.project p ON p.id = a.project_id WHERE p.reference LIKE 'BUD-%' AND a.deleted_at IS NULL
    UNION ALL SELECT 'spatial_allocation', s.status, count(*)::int FROM finance.spatial_allocation s
       WHERE s.subject_id IN (SELECT id FROM finance.budget_line WHERE code LIKE 'BUD-%' UNION SELECT id FROM finance.project WHERE reference LIKE 'BUD-%') GROUP BY s.status
    UNION ALL SELECT 'variance_explanation', NULL, count(*)::int FROM finance.variance_explanation v JOIN finance.budget_line l ON l.id = v.budget_line_id WHERE l.code LIKE 'BUD-%'
    UNION ALL SELECT 'dept-head scope', d.code, count(*)::int FROM finance.user_scope s JOIN finance.department d ON d.id = s.department_id JOIN public.users u ON u.id = s.user_id WHERE u.email = 'demo.dept-head@vungu.test' GROUP BY d.code
    ORDER BY 1, 2`)
  for (const r of rows) console.log(`  ${r.entity.padEnd(22)} ${String(r.state ?? '').padEnd(28)} ${String(r.n).padStart(5)}`)
}

async function clean(db) {
  const lineIds = `(SELECT id FROM finance.budget_line WHERE code LIKE 'BUD-%')`
  const projectIds = `(SELECT id FROM finance.project WHERE reference LIKE 'BUD-%')`
  const batchIds = `(SELECT id FROM finance.import_batch WHERE idempotency_key LIKE 'BUD-%')`
  const statements = [
    `DELETE FROM finance.spatial_allocation WHERE subject_id IN ${lineIds} OR subject_id IN ${projectIds}`,
    `DELETE FROM finance.variance_explanation WHERE budget_line_id IN ${lineIds}`,
    `DELETE FROM finance.project_transaction WHERE project_id IN ${projectIds}`,
    `DELETE FROM finance.project_allocation WHERE project_id IN ${projectIds}`,
    `DELETE FROM finance.project WHERE reference LIKE 'BUD-%'`,
    `DELETE FROM finance.commitment WHERE import_batch_id IN ${batchIds}`,
    `DELETE FROM finance.transaction WHERE import_batch_id IN ${batchIds}`,
    `DELETE FROM finance.import_batch WHERE idempotency_key LIKE 'BUD-%'`,
    `DELETE FROM finance.budget_revision WHERE budget_line_id IN ${lineIds}`,
    `UPDATE finance.budget_line SET distribution_id = NULL WHERE distribution_id IN (SELECT id FROM finance.budget_distribution WHERE name LIKE 'BUD %')`,
    `DELETE FROM finance.budget_line WHERE code LIKE 'BUD-%'`,
    `DELETE FROM finance.budget_distribution WHERE name LIKE 'BUD %'`,
    `DELETE FROM finance.activity WHERE code LIKE 'BUD-%'`,
    `DELETE FROM finance.programme WHERE code LIKE 'BUD-%'`,
    `DELETE FROM finance.account WHERE code LIKE 'BUD-%'`,
    `DELETE FROM finance.department WHERE code LIKE 'BUD-%'`,
    `DELETE FROM finance.user_scope WHERE user_id = (SELECT id FROM public.users WHERE email = 'demo.dept-head@vungu.test')`,
  ]
  await db.query('BEGIN')
  try {
    for (const sql of statements) {
      const r = await db.query(sql)
      log(`${String(r.rowCount).padStart(4)}  ${sql.slice(0, 90)}`)
    }
    await db.query('COMMIT')
  } catch (err) {
    await db.query('ROLLBACK')
    throw new Error(`clean failed (another seed may reference a BUD- row): ${err.message}`)
  }
}

async function main() {
  const mode = process.argv.includes('--clean') ? 'clean' : process.argv.includes('--report') ? 'report' : 'create'
  const db = new Client({ connectionString: DATABASE_URL })
  await db.connect()
  await db.query('SET statement_timeout = 0')
  try {
    if (mode === 'report') { console.log('Budget demo data (BUD-):'); await report(db); return }
    if (mode === 'clean') { console.log('Removing the BUD- budget demo data:'); await clean(db); return }
    await create(db)
    console.log('\nBudget demo data now:')
    await report(db)
  } finally {
    await db.end()
  }
}

async function create(db) {
  const one = async (sql, params) => (await db.query(sql, params)).rows[0]
  const year = await one('SELECT id, status FROM finance.financial_year WHERE label = $1 AND deleted_at IS NULL', [YEAR_LABEL])
  if (!year) throw new Error('The DD 2026/27 financial year is missing: run scripts/seed-finance-director-demo.js first.')
  if (year.status !== 'open') throw new Error(`The DD year is ${year.status}; it must be open.`)
  const userId = {}
  for (const [k, email] of Object.entries(USERS)) {
    const u = await one('SELECT id FROM public.users WHERE email = $1', [email])
    if (!u) throw new Error(`Missing demo user ${email}`)
    userId[k] = u.id
  }

  // ── 1. The head of department is scoped to Engineering ───────────────────────────────────────
  console.log('1. Department scope for the head of department')
  const eng = await one(`SELECT id FROM finance.department WHERE code = 'DD-ENG' AND deleted_at IS NULL`)
  if (!eng) throw new Error('DD-ENG is missing.')
  const scope = (await db.query('SELECT department_id FROM finance.user_scope WHERE user_id = $1', [userId.dh])).rows
  if (scope.length === 1 && scope[0].department_id === eng.id) log('already scoped to DD-ENG')
  else {
    await call('admin', 'PUT', `/finance/users/${userId.dh}/access`, {
      department_ids: [eng.id],
      reason: 'Head of Engineering and Works: confined to the Engineering vote (demo set-up).',
    })
    log('scoped demo.dept-head to DD-ENG (Engineering and Works)')
  }
  // The scope is cached per session; log in afresh after the change.
  delete cookies.dh

  // ── 2. Classification ─────────────────────────────────────────────────────────────────────────
  console.log('2. Departments, programmes, activities and accounts')
  const dept = {}
  for (const r of (await db.query(`SELECT id, code FROM finance.department WHERE deleted_at IS NULL AND (code LIKE 'DD-%' OR code LIKE 'BUD-%')`)).rows) dept[r.code] = r.id
  for (const d of NEW_DEPARTMENTS) {
    if (dept[d.code]) continue
    const { data } = await call('fadmin', 'POST', '/finance/departments', { code: d.code, name: d.name, vote_number: d.vote })
    dept[d.code] = data.id
    log(`department ${d.code} ${d.name}`)
  }
  const prog = {}
  for (const r of (await db.query(`SELECT id, code FROM finance.programme WHERE deleted_at IS NULL AND (code LIKE 'DD-%' OR code LIKE 'BUD-%')`)).rows) prog[r.code] = r.id
  for (const p of PROGRAMMES) {
    if (prog[p.code]) continue
    const { data } = await call('fadmin', 'POST', '/finance/programmes', { code: p.code, name: p.name, department_id: dept[p.dept] })
    prog[p.code] = data.id
    log(`programme ${p.code}`)
  }
  const act = {}
  for (const r of (await db.query(`SELECT id, code FROM finance.activity WHERE deleted_at IS NULL AND (code LIKE 'DD-%' OR code LIKE 'BUD-%')`)).rows) act[r.code] = r.id
  for (const a of ACTIVITIES) {
    if (act[a.code]) continue
    const { data } = await call('fadmin', 'POST', '/finance/activities', { code: a.code, name: a.name, programme_id: prog[a.prog] })
    act[a.code] = data.id
    log(`activity ${a.code}`)
  }
  const acct = {}
  for (const r of (await db.query(`SELECT id, code FROM finance.account WHERE deleted_at IS NULL AND (code LIKE 'DD-%' OR code LIKE 'BUD-%')`)).rows) acct[r.code] = r.id
  for (const a of ACCOUNTS) {
    if (acct[a.code]) continue
    const { data } = await call('fadmin', 'POST', '/finance/accounts', { ...a, is_postable: true })
    acct[a.code] = data.id
    log(`account ${a.code} ${a.name}`)
  }

  // ── 3. Budget lines, through their workflow ──────────────────────────────────────────────────
  console.log('3. Budget lines')
  const lineRow = async (code) => one(
    'SELECT id, status FROM finance.budget_line WHERE code = $1 AND financial_year_id = $2 AND deleted_at IS NULL', [code, year.id])
  const line = {}
  for (const l of LINES) {
    const preparer = l.by || 'bo'
    let row = await lineRow(l.code)
    if (!row) {
      const body = {
        financial_year_id: year.id, department_id: dept[l.dept], account_id: acct[l.acct],
        code: l.code, description: l.descr, currency: l.ccy, original_amount: `${l.amount}.00`,
      }
      if (l.prog) body.programme_id = prog[l.prog]
      if (l.act) body.activity_id = act[l.act]
      if (l.ward) body.ward_code = l.ward
      if (l.fund) body.funding_source_account_id = acct[l.fund]
      await call(preparer, 'POST', '/finance/budget-lines', body)
      row = await lineRow(l.code)
    }
    line[l.code] = row.id
    if (l.state !== 'draft' && ['draft', 'returned'].includes(row.status) && !(l.state === 'returned' && row.status === 'returned')) {
      await call(preparer, 'POST', `/finance/budget-lines/${row.id}/submit`)
      row.status = 'submitted'
    }
    if (l.state === 'approved' && row.status === 'submitted') {
      await call('fc', 'POST', `/finance/budget-lines/${row.id}/approve`)
      row.status = 'approved'
    }
    if (l.state === 'returned' && row.status === 'submitted') {
      await call('fc', 'POST', `/finance/budget-lines/${row.id}/return`, { note: l.returned })
      row.status = 'returned'
    }
    log(`${l.code.padEnd(11)} ${row.status.padEnd(9)} ${l.ccy} ${String(l.amount).padStart(9)}  ${l.descr}`)
  }

  // ── 4. Phasing (no route; written as migration 204 defines it) ───────────────────────────────
  console.log('4. Monthly phasing profiles')
  const profiles = [
    { name: 'BUD Monthly — even twelfths', periodicity: 'monthly', basis: 'distribute_equally', status: 'active',
      pct: [8.333333, 8.333333, 8.333333, 8.333333, 8.333333, 8.333333, 8.333333, 8.333333, 8.333333, 8.333333, 8.333333, 8.333337],
      notes: 'Recurrent votes: salaries, administration and running costs fall evenly through the year.' },
    { name: 'BUD Monthly — capital works (dry season)', periodicity: 'monthly', basis: 'council_profile', status: 'active',
      pct: [6, 11, 13, 14, 9, 5, 3, 3, 4, 9, 11, 12],
      notes: 'Capital and road works: the rains (December to March) stop earthworks, so the profile loads July–October and April–June.' },
    { name: 'BUD Quarterly — grant tranches (proposed)', periodicity: 'quarterly', basis: 'council_profile', status: 'draft',
      pct: [25, 35, 15, 25],
      notes: 'Proposed by the budget office for the devolution grant tranches; not yet in use.' },
  ]
  const profileId = {}
  for (const p of profiles) {
    let row = await one('SELECT id FROM finance.budget_distribution WHERE financial_year_id = $1 AND name = $2 AND deleted_at IS NULL', [year.id, p.name])
    if (!row) {
      await db.query('BEGIN')
      try {
        await db.query(`SELECT set_config('app.authority_id', '1', true)`)
        row = await one(
          `INSERT INTO finance.budget_distribution (authority_id, financial_year_id, name, periodicity, basis, status, notes, created_by, created_at)
           VALUES (1, $1, $2, $3, $4, $5, $6, $7, '2026-06-20T09:00:00+02') RETURNING id`,
          [year.id, p.name, p.periodicity, p.basis, p.status, p.notes, userId.bo])
        const prefix = p.periodicity === 'monthly' ? 'm' : 'q'
        for (let i = 0; i < p.pct.length; i += 1) {
          await db.query(
            `INSERT INTO finance.budget_distribution_period (authority_id, distribution_id, period_key, period_ordinal, percentage, created_by)
             VALUES (1, $1, $2, $3, $4, $5)`,
            [row.id, `${prefix}${String(i + 1).padStart(prefix === 'm' ? 2 : 1, '0')}`, i + 1, p.pct[i], userId.bo])
        }
        await db.query('COMMIT')
        log(`profile "${p.name}" (${p.status})`)
      } catch (err) { await db.query('ROLLBACK'); throw err }
    }
    profileId[p.name] = row.id
  }
  // Capital lines on the dry-season profile, everything else in the year on even twelfths — including the DD- lines
  // that carry no profile, so no department is left partly phased.
  const capital = await db.query(
    `UPDATE finance.budget_line l SET distribution_id = $1
       FROM finance.account a
      WHERE a.id = l.account_id AND l.financial_year_id = $2 AND l.distribution_id IS NULL AND l.deleted_at IS NULL
        AND a.expenditure_class = 'capital' AND (l.code LIKE 'BUD-%' OR l.code LIKE 'DD-%')`,
    [profileId['BUD Monthly — capital works (dry season)'], year.id])
  const even = await db.query(
    `UPDATE finance.budget_line SET distribution_id = $1
      WHERE financial_year_id = $2 AND distribution_id IS NULL AND deleted_at IS NULL AND (code LIKE 'BUD-%' OR code LIKE 'DD-%')`,
    [profileId['BUD Monthly — even twelfths'], year.id])
  if (capital.rowCount + even.rowCount) log(`phased ${capital.rowCount} capital and ${even.rowCount} other lines`)

  // ── 5. Revisions ──────────────────────────────────────────────────────────────────────────────
  console.log('5. Budget revisions')
  const revisionId = {}
  for (const r of REVISIONS) {
    let row = await one(`SELECT id, state FROM finance.budget_revision WHERE budget_line_id = $1 AND reason LIKE $2 AND deleted_at IS NULL`,
      [line[r.line], `%(${r.marker})`])
    if (!row) {
      const { data } = await call(r.by, 'POST', `/finance/budget-lines/${line[r.line]}/revisions`, {
        amount_delta: r.delta, reason: `${r.reason} (${r.marker})`, effective_date: r.effective,
      })
      row = { id: data.id, state: data.state }
    }
    revisionId[r.marker] = row.id
    if (r.state !== 'draft' && row.state === 'draft') {
      await call(r.by, 'POST', `/finance/budget-revisions/${row.id}/submit`)
      row.state = 'submitted'
    }
    if (r.state === 'approved' && row.state === 'submitted') {
      await call('fc', 'POST', `/finance/budget-revisions/${row.id}/approve`, { note: r.note })
      row.state = 'approved'
    }
    if (r.state === 'rejected' && row.state === 'submitted') {
      await call('fc', 'POST', `/finance/budget-revisions/${row.id}/reject`, { note: r.note })
      row.state = 'rejected'
    }
    log(`${r.marker} ${r.line.padEnd(11)} ${r.delta.padStart(10)}  ${row.state}`)
  }

  // ── 6. Projects ───────────────────────────────────────────────────────────────────────────────
  console.log('6. Capital projects')
  const project = {}
  for (const p of PROJECTS) {
    let row = await one('SELECT id, status, physical_progress_percent FROM finance.project WHERE reference = $1 AND deleted_at IS NULL', [p.ref])
    if (!row) {
      const body = {
        reference: p.ref, name: p.name, description: p.description, department_id: dept[p.dept],
        location_text: p.location, longitude: p.lon, latitude: p.lat, start_date: p.start, end_date: p.end,
        currency: 'USD', approved_budget: p.budget,
      }
      if (p.ward) body.ward_code = p.ward
      if (p.fund) body.funding_source_account_id = acct[p.fund]
      const { data } = await call(p.by, 'POST', '/finance/projects', body)
      row = { id: data.project.id, status: data.project.status, physical_progress_percent: null }
    }
    project[p.ref] = row.id
    if (p.target !== 'proposed' && row.status === 'proposed') {
      await call(p.by, 'POST', `/finance/projects/${row.id}/submit`)
      row.status = 'awaiting_approval'
    }
    if (p.target === 'in_progress' && row.status === 'awaiting_approval') {
      await call('fc', 'POST', `/finance/projects/${row.id}/approve`)
      row.status = 'approved'
    }
    if (p.target === 'in_progress' && row.status === 'approved') {
      await call(p.by, 'PATCH', `/finance/projects/${row.id}`, { status: 'in_progress' })
      row.status = 'in_progress'
    }
    if (p.progress !== null && row.physical_progress_percent === null) {
      await call(p.by, 'PATCH', `/finance/projects/${row.id}/progress`, {
        physical_progress_percent: p.progress, note: 'Site inspection report, 31 October 2026.',
      })
    }
    for (const a of p.alloc) {
      const exists = await one(
        `SELECT 1 FROM finance.project_allocation WHERE project_id = $1 AND budget_line_id = $2 AND allocation_type = $3 AND deleted_at IS NULL`,
        [row.id, line[a.line], a.revision ? 'revision' : 'original'])
      if (exists) continue
      const body = { budget_line_id: line[a.line], amount: a.amount, effective_date: a.date,
        note: a.revision ? 'Supplementary allocation following the approved revision.' : 'Original allocation from the approved estimates.' }
      if (a.revision) { body.allocation_type = 'revision'; body.budget_revision_id = revisionId[a.revision] }
      await call(p.by, 'POST', `/finance/projects/${row.id}/allocations`, body)
    }
    log(`${p.ref} ${row.status.padEnd(17)} ${p.name}`)
  }

  // ── 7. Actuals: monthly ledger exports, imported ──────────────────────────────────────────────
  console.log('7. Actuals, July to mid-November (imports)')
  const allRows = LINES.flatMap(actualRows)
  const header = ['Vote', 'Economic Line', 'Line Code', 'Programme', 'Date', 'Voucher No', 'Source Ref', 'Type', 'Description', 'Supplier ID', 'Supplier Name', 'Ward', 'Project', 'Currency', 'Amount']
  const toRecord = (r) => [r.dept, r.acct, r.line, '', dmy(r.date), r.ref, `BUD-ACT-${r.sourceRef}`, r.type, r.description, r.supplierRef, r.supplierName, r.ward, r.project, r.ccy, money(r.amount)]
  const batches = [
    ...MONTHS.map((m) => ({
      key: `BUD-ACT-${m.key}-USD`, file: `Promun ledger export — ${m.name} (USD).csv`,
      rows: allRows.filter((r) => r.month === m.key && r.ccy === 'USD'), dataset: 'actuals',
    })),
    { key: 'BUD-ACT-2026-07to11-ZWG', file: 'Promun ledger export — July to November 2026 (ZWG).csv',
      rows: allRows.filter((r) => r.ccy === 'ZWG'), dataset: 'actuals' },
  ]
  for (const b of batches) {
    b.csv = toCsv(header, b.rows.map(toRecord))
    b.count = b.rows.length
    b.total = money(b.rows.reduce((s, r) => s + r.amount, 0))
    b.ccy = b.rows[0]?.ccy
  }
  batches.push({
    key: 'BUD-COM-2026-11-USD', file: 'Open purchase orders and contracts at 14 November 2026.csv', dataset: 'commitments',
    csv: toCsv(['Order Number', 'Order Date', 'Line Code', 'Vote', 'Account Code', 'Description', 'Source Ref', 'Currency', 'Amount'],
      COMMITMENTS.map((c) => [c.ref, dmy(c.date), c.line, c.dept, c.acct, c.descr, c.ref, 'USD', c.amount])),
    count: COMMITMENTS.length,
    total: money(COMMITMENTS.reduce((s, c) => s + cents(Number(c.amount)), 0)),
    ccy: 'USD',
  })
  for (const b of batches) {
    let batch = await one('SELECT id, status FROM finance.import_batch WHERE idempotency_key = $1 AND deleted_at IS NULL', [b.key])
    if (batch?.status === 'committed') { log(`${b.file}: already committed`); continue }
    if (!batch) {
      const form = new FormData()
      form.append('dataset', b.dataset)
      form.append('financial_year_id', year.id)
      form.append('idempotency_key', b.key)
      form.append('declared_control_count', String(b.count))
      form.append('declared_control_total', b.total)
      form.append('declared_control_currency', b.ccy)
      form.append('file', new Blob([b.csv], { type: 'text/csv' }), b.file)
      const { data } = await call('fo', 'POST', '/finance/imports', form)
      batch = { id: data.batch.id, status: data.batch.status }
    }
    if (['uploaded', 'mapped', 'validated', 'failed'].includes(batch.status)) {
      const { data } = await call('fo', 'POST', `/finance/imports/${batch.id}/validate`, { date_order: 'day_first' })
      if (data.counts.rejected) {
        const ex = (await db.query('SELECT row_number, field, message FROM finance.import_exception WHERE batch_id = $1 LIMIT 5', [batch.id])).rows
        throw new Error(`${b.file}: ${data.counts.rejected} rows rejected: ${JSON.stringify(ex)}`)
      }
      if (data.reconciliation.status !== 'matched') throw new Error(`${b.file}: ${data.reconciliation.notes.join(' ')}`)
    }
    const { data } = await call('fadmin', 'POST', `/finance/imports/${batch.id}/commit`, {})
    log(`${b.file}: committed ${data.committed_rows ?? data.batch?.rows_valid} rows, ${b.total} ${b.ccy}`)
  }

  // ── 8. Variance explanations ──────────────────────────────────────────────────────────────────
  console.log('8. Variance explanations')
  for (const e of EXPLANATIONS) {
    const exists = await one('SELECT 1 FROM finance.variance_explanation WHERE budget_line_id = $1 AND period_label = $2', [line[e.line], e.period])
    if (exists) continue
    await call(e.by, 'POST', '/finance/variance-explanations', {
      financial_year_id: year.id, budget_line_id: line[e.line], period_label: e.period, explanation: e.text,
    })
    log(`${e.line} explained (${e.by})`)
  }

  // ── 9. Ward splits ────────────────────────────────────────────────────────────────────────────
  console.log('9. Ward splits')
  for (const s of SPLITS) {
    const subjectId = s.kind === 'budget_line' ? line[s.subject] : project[s.subject]
    let row = await one(`SELECT id, status FROM finance.spatial_allocation WHERE subject_id = $1 AND target_code = $2 AND deleted_at IS NULL
                          ORDER BY requested_at DESC LIMIT 1`, [subjectId, s.ward])
    const preparer = s.kind === 'budget_line' ? (s.subject.startsWith('BUD-ENG') ? 'dh' : 'bo') : 'fo'
    if (!row) {
      const { data } = await call(preparer, 'POST', '/finance/spatial-allocations', {
        subject_kind: s.kind, subject_id: subjectId, target_code: s.ward, amount: s.amount, currency: 'USD', methodology: s.methodology,
      })
      row = { id: data.id, status: data.status }
    }
    if (s.state === 'approved' && row.status === 'draft') {
      await call('fc', 'POST', `/finance/spatial-allocations/${row.id}/approve`, { decision_note: 'Agreed by the finance committee.' })
      row.status = 'approved'
    }
    if (s.state === 'rejected' && row.status === 'draft') {
      await call('fc', 'POST', `/finance/spatial-allocations/${row.id}/reject`, { decision_note: s.note })
      row.status = 'rejected'
    }
    log(`${s.subject.padEnd(11)} ${s.ward} ${s.amount.padStart(10)} ${row.status}`)
  }

  // ── 10. Backdate what the routes stamped "now", on BUD- rows only ─────────────────────────────
  console.log('10. Dating the workflow through the year')
  await db.query('BEGIN')
  try {
    // Estimates prepared in May, submitted in June, approved by the committee before the year opened.
    await db.query(`UPDATE finance.budget_line SET created_at = '2026-05-18T10:00:00+02',
                      submitted_at = CASE WHEN submitted_at IS NULL THEN NULL ELSE '2026-06-12T11:00:00+02'::timestamptz END,
                      approved_at = '2026-06-26T15:30:00+02'
                     WHERE code LIKE 'BUD-%' AND status = 'approved'`)
    // Lines still in the workflow: prepared and sent during the year.
    await db.query(`UPDATE finance.budget_line SET created_at = '2026-10-06T09:00:00+02',
                      submitted_at = CASE WHEN status = 'draft' THEN NULL WHEN status = 'returned' THEN '2026-10-21T10:00:00+02'::timestamptz
                                          ELSE '2026-11-05T09:30:00+02'::timestamptz END
                     WHERE code LIKE 'BUD-%' AND status <> 'approved'`)
    await db.query(`UPDATE finance.budget_line SET submitted_at = '2026-11-12T14:00:00+02' WHERE code IN ('BUD-ENG-07', 'BUD-PLN-04')`)
    const revDates = {
      'BUD-REV-01': ['2026-11-03T09:00:00+02', '2026-11-03T16:00:00+02', null],
      'BUD-REV-02': ['2026-10-28T10:00:00+02', '2026-10-29T09:00:00+02', null],
      'BUD-REV-03': ['2026-11-10T11:00:00+02', '2026-11-11T08:30:00+02', null],
      'BUD-REV-04': ['2026-09-08T10:00:00+02', '2026-09-08T15:00:00+02', '2026-09-15T14:00:00+02'],
      'BUD-REV-05': ['2026-10-05T10:00:00+02', '2026-10-06T09:00:00+02', '2026-10-15T14:00:00+02'],
      'BUD-REV-06': ['2026-11-14T15:00:00+02', null, null],
    }
    for (const [marker, [req, sub, dec]] of Object.entries(revDates)) {
      await db.query(`UPDATE finance.budget_revision SET requested_at = $2, created_at = $2, submitted_at = $3,
                        decided_at = CASE WHEN decided_at IS NULL THEN NULL ELSE $4::timestamptz END
                       WHERE id = $1`, [revisionId[marker], req, sub, dec])
    }
    await db.query(`UPDATE finance.project SET created_at = '2026-07-14T10:00:00+02',
                      approved_at = CASE WHEN approved_at IS NULL THEN NULL ELSE '2026-07-29T15:00:00+02'::timestamptz END,
                      progress_recorded_at = CASE WHEN progress_recorded_at IS NULL THEN NULL ELSE '2026-10-31T16:00:00+02'::timestamptz END
                     WHERE reference IN ('BUD-PRJ-01', 'BUD-PRJ-02', 'BUD-PRJ-03')`)
    await db.query(`UPDATE finance.project SET created_at = '2026-11-04T10:00:00+02' WHERE reference IN ('BUD-PRJ-04', 'BUD-PRJ-05', 'BUD-PRJ-06')`)
    await db.query(`UPDATE finance.variance_explanation v SET recorded_at = '2026-11-06T11:00:00+02'
                      FROM finance.budget_line l WHERE l.id = v.budget_line_id AND l.code LIKE 'BUD-%'`)
    await db.query(`UPDATE finance.spatial_allocation SET requested_at = '2026-10-20T10:00:00+02',
                      decided_at = CASE WHEN decided_at IS NULL THEN NULL ELSE '2026-10-29T15:00:00+02'::timestamptz END
                     WHERE subject_id IN (SELECT id FROM finance.budget_line WHERE code LIKE 'BUD-%'
                                          UNION SELECT id FROM finance.project WHERE reference LIKE 'BUD-%')`)
    // Import batches: each month's export came in early the following month.
    for (const m of MONTHS) {
      const next = m.key === '2026-11' ? '2026-11-15' : `${m.key.slice(0, 5)}${String(Number(m.key.slice(5)) + 1).padStart(2, '0')}-06`
      await db.query(`UPDATE finance.import_batch SET uploaded_at = $2::date + time '09:00', validated_at = $2::date + time '10:30',
                        committed_at = CASE WHEN committed_at IS NULL THEN NULL ELSE $2::date + time '15:00' END
                       WHERE idempotency_key = $1`, [`BUD-ACT-${m.key}-USD`, next])
    }
    await db.query(`UPDATE finance.import_batch SET uploaded_at = '2026-11-15 09:00', validated_at = '2026-11-15 10:30',
                      committed_at = '2026-11-15 15:00' WHERE idempotency_key IN ('BUD-ACT-2026-07to11-ZWG', 'BUD-COM-2026-11-USD')`)
    await db.query('COMMIT')
    log('done')
  } catch (err) { await db.query('ROLLBACK'); throw err }
}

main().catch((err) => { console.error(err.message); process.exit(1) })
