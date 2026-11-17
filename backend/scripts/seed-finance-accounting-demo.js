#!/usr/bin/env node
/**
 * The Accounting workspace's demo dataset: creditors, journals and the fixed-asset register of a
 * council five months into its July-to-June year (Vungu RDC, 2026/27, today 17 November 2026).
 *
 *   DATABASE_URL=postgres://...@127.0.0.1:5434/db node scripts/seed-finance-accounting-demo.js
 *   ... --report    counts, trial balance per currency, creditor ageing
 *   ... --clean     remove everything it created (local database only; see below)
 *   ... --clean --dry-run   do every delete, then roll back (proves --clean works)
 *
 * WHAT IT CREATES (every code/reference starts ACC-, so --clean can find it)
 *  - Chart additions (ACC-xxxx): creditors control (payable), VAT input (tax), salaries and
 *    statutory-deductions payable, PPE cost and accumulated-depreciation accounts per class,
 *    utilities/telecoms/fuel/vehicle/stationery/security/bank-charges/audit/depreciation/disposal
 *    expense accounts and a Devolution Fund grant revenue account.
 *  - 14 suppliers (party_type supplier, reference ACC-SP-nn): ZESA, ZINWA, TelOne, NSSA, ZIMRA and
 *    Gweru/Midlands trade suppliers, some billing in USD and some in ZWG.
 * *  - 36 supplier invoices, Jul–Nov 2026: paid, part-paid, unpaid across every ageing bucket
 *    (0-30 / 31-60 / 61-90 / 90+), and 3 awaiting approval. 21 payment vouchers with allocations,
 *    2 of them awaiting approval (one paying two invoices). VAT input on some invoices and a 30%
 *    withholding-tax deduction (ACC-2230) remitted to ZIMRA, so Tax Control has figures.
 *  - Journal vouchers (ACC-JV-nnnn): Devolution Fund tranches, monthly payroll accruals and
 *    payments, monthly bank charges in both books, a reclassification, a voucher posted in error
 *    and its reversal plus the correct posting, and 4 drafts left in the accountant's queue.
 *  - Fixed assets: 6 categories (ACC-LAND/BLDG/MV/PLANT/IT/FURN), 27 assets (24 USD, 3 ZWG). The
 *    pre-July assets come onto the ledger through one opening voucher (ACC-OB-ASSETS) so the
 *    register agrees with the ledger; in-year assets come in through the supplier invoices that
 *    bought them. Depreciation runs: USD Jul–Oct approved, ZWG Jul–Sep approved, ZWG Oct awaiting
 *    approval. One disposal (Nissan NP300, sold at auction) awaiting approval.
 *
 * HOW: through the real API (default http://127.0.0.1:3011, override with SEED_API), logged in as
 * the demo users, so numbering, posting, separation of duties and the audit trail are genuine.
 *   preparer  demo.finance-officer  (invoices, payments, journals, assets, runs, disposal)
 *   approver  demo.accountant       (most approvals and postings; can approve the queue in the demo)
 *   approver  demo.finance-admin    (some postings, and posts the reversal the accountant raised)
 * Items left awaiting approval were prepared by the finance officer, so the accountant can approve
 * them live during the demo.
 *
 * IDEMPOTENT: every item is keyed (account code, party reference, supplier invoice number, payment
 * reference, voucher number, asset tag in the description, run per period+currency) and skipped
 * when it already exists, so a re-run tops up and never duplicates.
 *
 * --clean deletes, it does not reverse: the ledger is insert-only, so (like
 * seed-general-ledger-demo.js) it sets session_replication_role = replica for one transaction to
 * suspend the immutability triggers, deletes only rows it can identify as its own, and restores
 * the role. That is why it refuses any host other than localhost/127.0.0.1.
 *
 * Two books, USD and ZWG, each balancing on its own; nothing is converted (decision D4).
 */
const { Client } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error('Set DATABASE_URL to the LOCAL database.'); process.exit(1) }
const dbUrl = new URL(DATABASE_URL)
if (!['127.0.0.1', 'localhost'].includes(dbUrl.hostname)) {
  console.error(`Refusing to run against ${dbUrl.hostname}: this demo seed only runs against a local database.`)
  process.exit(1)
}
const API = (process.env.SEED_API || 'http://127.0.0.1:3011').replace(/\/$/, '')
const apiHost = new URL(API).hostname
if (!['127.0.0.1', 'localhost'].includes(apiHost)) {
  console.error(`Refusing to drive ${API}: only a local backend.`)
  process.exit(1)
}
const PASSWORD = process.env.DEMO_PASSWORD || 'demo1234'
const YEAR_LABEL = 'DD 2026/27 (synthetic demo — July to June, not a Council year)'
const TODAY = '2026-11-17'

// ── Chart additions ─────────────────────────────────────────────────────────────────────────────
// code, name, root_type, account_type, parent code, is_group
const CHART = [
  ['ACC-1410', 'VAT input tax', 'asset', 'tax', 'GL-1000', false],
  ['ACC-1500', 'Property, plant and equipment — cost', 'asset', null, 'GL-1000', true],
  ['ACC-1510', 'Land', 'asset', 'fixed_asset', 'ACC-1500', false],
  ['ACC-1520', 'Buildings', 'asset', 'fixed_asset', 'ACC-1500', false],
  ['ACC-1530', 'Motor vehicles', 'asset', 'fixed_asset', 'ACC-1500', false],
  ['ACC-1540', 'Plant and equipment (graders, earthmoving)', 'asset', 'fixed_asset', 'ACC-1500', false],
  ['ACC-1550', 'Computer equipment', 'asset', 'fixed_asset', 'ACC-1500', false],
  ['ACC-1560', 'Furniture and fittings', 'asset', 'fixed_asset', 'ACC-1500', false],
  ['ACC-1600', 'Property, plant and equipment — accumulated depreciation', 'asset', null, 'GL-1000', true],
  ['ACC-1620', 'Accumulated depreciation — buildings', 'asset', 'fixed_asset', 'ACC-1600', false],
  ['ACC-1630', 'Accumulated depreciation — motor vehicles', 'asset', 'fixed_asset', 'ACC-1600', false],
  ['ACC-1640', 'Accumulated depreciation — plant and equipment', 'asset', 'fixed_asset', 'ACC-1600', false],
  ['ACC-1650', 'Accumulated depreciation — computer equipment', 'asset', 'fixed_asset', 'ACC-1600', false],
  ['ACC-1660', 'Accumulated depreciation — furniture and fittings', 'asset', 'fixed_asset', 'ACC-1600', false],
  ['ACC-2200', 'Trade creditors control', 'liability', 'payable', 'GL-2000', false],
  ['ACC-2210', 'Net salaries payable', 'liability', 'other', 'GL-2000', false],
  ['ACC-2220', 'PAYE and NSSA deductions payable', 'liability', 'other', 'GL-2000', false],
  ['ACC-2230', 'Withholding tax payable (ZIMRA)', 'liability', 'tax', 'GL-2000', false],
  ['ACC-4300', 'Devolution Fund grant', 'revenue', null, 'GL-4000', false],
  ['ACC-5300', 'Electricity and water', 'expense', null, 'GL-5000', false],
  ['ACC-5310', 'Telephone and internet', 'expense', null, 'GL-5000', false],
  ['ACC-5400', 'Fuel and lubricants', 'expense', null, 'GL-5000', false],
  ['ACC-5410', 'Vehicle and plant repairs', 'expense', null, 'GL-5000', false],
  ['ACC-5500', 'Printing and stationery', 'expense', null, 'GL-5000', false],
  ['ACC-5510', 'Security services', 'expense', null, 'GL-5000', false],
  ['ACC-5600', 'Bank charges', 'expense', null, 'GL-5000', false],
  ['ACC-5700', 'Depreciation', 'expense', null, 'GL-5000', false],
  ['ACC-5800', 'Audit fees', 'expense', null, 'GL-5000', false],
  ['ACC-5900', 'Loss / (gain) on disposal of assets', 'expense', null, 'GL-5000', false],
]

// ── Suppliers ───────────────────────────────────────────────────────────────────────────────────
// key, name, contact, phone, email, address
const SUPPLIERS = [
  ['SP01', 'ZESA Holdings — Gweru Area', 'Accounts, Gweru Area Office', '+263 54 222 1450', 'gweru.accounts@zesa.example', 'Electricity House, Robert Mugabe Way, Gweru'],
  ['SP02', 'ZINWA — Gweru Catchment', 'Revenue Section', '+263 54 222 3871', 'gweru@zinwa.example', 'ZINWA Offices, Lobengula Avenue, Gweru'],
  ['SP03', 'TelOne (Pvt) Ltd — Gweru', 'Business Accounts', '+263 54 222 0100', 'gweru.business@telone.example', 'Telecomms House, 5th Street, Gweru'],
  ['SP04', 'Gweru Hardware & Building Supplies (Pvt) Ltd', 'T. Ncube', '+263 77 341 2290', 'sales@gweruhardware.example', '14 Main Street, Gweru'],
  ['SP05', 'Midlands Fuel Distributors (Pvt) Ltd', 'R. Chikwanha', '+263 71 556 0042', 'orders@midlandsfuel.example', 'Plot 7, Bristol Road Industrial, Gweru'],
  ['SP06', 'Shurugwi Road Contractors (Pvt) Ltd', 'Eng. P. Mudzingwa', '+263 77 802 1133', 'tenders@shurugwiroads.example', 'Stand 221, Shurugwi Road, Gweru'],
  ['SP07', 'Kudzai Stationers & Printers', 'K. Moyo', '+263 78 220 9014', 'kudzai.print@example.com', '33 Fifth Street, Gweru'],
  ['SP08', 'Lion Eye Security Services (Pvt) Ltd', 'Operations Manager', '+263 77 415 6600', 'ops@lioneyesecurity.example', '9 Livingstone Avenue, Gweru'],
  ['SP09', 'Midlands Motor Spares (Pvt) Ltd', 'S. Dube', '+263 71 990 4410', 'parts@midlandsmotorspares.example', '22 Bulawayo Road, Gweru'],
  ['SP10', 'National Social Security Authority (NSSA)', 'Contributions, Gweru', '+263 54 222 5560', 'gweru@nssa.example', 'NSSA House, Gweru'],
  ['SP11', 'Zimbabwe Revenue Authority (ZIMRA)', 'Gweru Region', '+263 54 222 7701', 'gweru@zimra.example', 'ZIMRA Region 3, Gweru'],
  ['SP12', 'Mkoba Motors (Pvt) Ltd', 'Fleet Sales', '+263 77 233 7800', 'fleet@mkobamotors.example', '1 Robert Mugabe Way, Gweru'],
  ['SP13', 'Gweru Computer Centre', 'B. Sibanda', '+263 78 455 2290', 'sales@gwerucomputers.example', '41 R. Tangwena Avenue, Gweru'],
  ['SP14', 'Mvuma Furniture Manufacturers', 'J. Hove', '+263 77 609 3381', 'mvumafurniture@example.com', 'Stand 18, Mvuma'],
]

const D = { ENG: 'DD-ENG', FIN: 'DD-FIN', HLT: 'DD-HLT', SOC: 'DD-SOC' }

// ── Supplier invoices ───────────────────────────────────────────────────────────────────────────
// key: supplier_ref (unique per supplier). lines: [account, description, net, tax, dept]
// state: posted (approved) or draft (left awaiting approval). Payment pattern is in PAYMENTS.
const INVOICES = [
  // July
  { ref: 'ZESA/GW/26-0712', sp: 'SP01', cur: 'ZWG', date: '2026-07-08', due: '2026-07-22', lines: [['ACC-5300', 'Electricity, June 2026 — head office and Mvuma road depot', '168450.00', 0, D.FIN]] },
  { ref: 'ZINWA/GC/26-4471', sp: 'SP02', cur: 'ZWG', date: '2026-07-10', due: '2026-07-31', lines: [['ACC-5300', 'Raw water and sewerage, June 2026', '42800.00', 0, D.HLT]] },
  { ref: 'MFD-INV-10822', sp: 'SP05', cur: 'USD', date: '2026-07-15', due: '2026-08-14', lines: [['ACC-5400', 'Diesel 50, 4 000 L delivered to Mvuma road depot', '6480.00', 0, D.ENG]] },
  { ref: 'SRC-2026-031', sp: 'SP06', cur: 'USD', date: '2026-07-20', due: '2026-08-19', lines: [['GL-5200', 'Grading and reshaping, Vungu–Lower Gweru road, 18 km (Cert. 1)', '24600.00', 0, D.ENG]] },
  { ref: 'GHB-77120', sp: 'SP04', cur: 'USD', date: '2026-07-24', due: '2026-08-23', lines: [['GL-5200', 'Cement 50 kg x 120, 600 mm culvert pipes x 8 — delivery quantity disputed', '3870.00', '599.85', D.ENG]] },
  { ref: 'GCC-Q2611', sp: 'SP13', cur: 'ZWG', date: '2026-07-28', due: '2026-08-27', lines: [['ACC-1550', 'Canon imageRUNNER ADVANCE photocopier, installed at head office', '142000.00', 0, D.FIN]] },
  // August
  { ref: 'ZESA/GW/26-0809', sp: 'SP01', cur: 'ZWG', date: '2026-08-07', due: '2026-08-21', lines: [['ACC-5300', 'Electricity, July 2026 — head office and Mvuma road depot', '171920.00', 0, D.FIN]] },
  { ref: 'TO-GW-8812-07', sp: 'SP03', cur: 'ZWG', date: '2026-08-09', due: '2026-08-30', lines: [['ACC-5310', 'Fixed lines and fibre internet, July 2026', '38600.00', 0, D.FIN]] },
  { ref: 'LES-2026-0705', sp: 'SP08', cur: 'USD', date: '2026-08-05', due: '2026-08-20', lines: [['ACC-5510', 'Guarding, head office and works depot, July 2026', '4350.00', '674.25', D.FIN]] },
  { ref: 'MM-FS-2026-114', sp: 'SP12', cur: 'USD', date: '2026-08-14', due: '2026-08-28', lines: [['ACC-1530', 'Toyota Hilux 2.4 GD-6 double cab 4x4 (AGK 4410) — works supervisor', '52900.00', 0, D.ENG]] },
  { ref: 'MFD-INV-10957', sp: 'SP05', cur: 'USD', date: '2026-08-16', due: '2026-09-15', lines: [['ACC-5400', 'Diesel 50, 5 000 L — grader fleet, Shurugwi road', '8100.00', 0, D.ENG]] },
  { ref: 'GCC-INV-2687', sp: 'SP13', cur: 'ZWG', date: '2026-08-20', due: '2026-09-19', lines: [['ACC-1550', 'Dell OptiPlex desktop computers x 6, revenue hall', '186000.00', 0, D.FIN]] },
  { ref: 'MMS-55102', sp: 'SP09', cur: 'USD', date: '2026-08-26', due: '2026-09-25', lines: [['ACC-5410', 'Hydraulic pump assembly, CAT 140K grader', '3240.00', '502.20', D.ENG]] },
  { ref: 'NSSA-C-2026-08', sp: 'SP10', cur: 'USD', date: '2026-08-31', due: '2026-09-10', lines: [['ACC-2220', 'NSSA contributions, August 2026 payroll', '3100.00', 0, D.FIN]] },
  { ref: 'ZIMRA-P2-2026-08', sp: 'SP11', cur: 'USD', date: '2026-08-31', due: '2026-09-10', lines: [['ACC-2220', 'PAYE and AIDS levy, August 2026 payroll', '5800.00', 0, D.FIN]] },
  // September
  { ref: 'LES-2026-0806', sp: 'SP08', cur: 'USD', date: '2026-09-05', due: '2026-09-20', lines: [['ACC-5510', 'Guarding, head office and works depot, August 2026', '4350.00', '674.25', D.FIN]] },
  { ref: 'ZESA/GW/26-0908', sp: 'SP01', cur: 'ZWG', date: '2026-09-08', due: '2026-09-22', lines: [['ACC-5300', 'Electricity, August 2026 — head office and Mvuma road depot', '166300.00', 0, D.FIN]] },
  { ref: 'KSP-2026-1180', sp: 'SP07', cur: 'ZWG', date: '2026-09-12', due: '2026-10-12', lines: [['ACC-5500', 'Printing of 2026/27 rates notices (6 500) and envelopes', '58750.00', '9106.25', D.FIN]] },
  { ref: 'MFM-0412', sp: 'SP14', cur: 'ZWG', date: '2026-09-15', due: '2026-10-15', lines: [['ACC-1560', 'Office desks x 8 and chairs x 16, Lower Gweru district office', '94500.00', 0, D.SOC]] },
  { ref: 'SRC-2026-044', sp: 'SP06', cur: 'USD', date: '2026-09-22', due: '2026-10-22', lines: [['GL-5200', 'Gravel resurfacing, Shurugwi road, 7 km (Cert. 2)', '31750.00', 0, D.ENG]] },
  { ref: 'ZINWA/GC/26-5120', sp: 'SP02', cur: 'ZWG', date: '2026-09-25', due: '2026-10-16', lines: [['ACC-5300', 'Raw water and sewerage, August 2026', '44150.00', 0, D.HLT]] },
  { ref: 'NSSA-C-2026-09', sp: 'SP10', cur: 'USD', date: '2026-09-30', due: '2026-10-10', lines: [['ACC-2220', 'NSSA contributions, September 2026 payroll', '3100.00', 0, D.FIN]] },
  { ref: 'ZIMRA-P2-2026-09', sp: 'SP11', cur: 'USD', date: '2026-09-30', due: '2026-10-10', lines: [['ACC-2220', 'PAYE and AIDS levy, September 2026 payroll', '5800.00', 0, D.FIN]] },
  // October
  { ref: 'MFD-INV-11203', sp: 'SP05', cur: 'USD', date: '2026-10-03', due: '2026-11-02', lines: [['ACC-5400', 'Diesel 50, 4 500 L — grader fleet and tipper', '7290.00', 0, D.ENG]] },
  { ref: 'LES-2026-0907', sp: 'SP08', cur: 'USD', date: '2026-10-05', due: '2026-10-20', lines: [['ACC-5510', 'Guarding, head office and works depot, September 2026', '4350.00', '674.25', D.FIN]] },
  { ref: 'TO-GW-8812-09', sp: 'SP03', cur: 'ZWG', date: '2026-10-09', due: '2026-10-30', lines: [['ACC-5310', 'Fixed lines and fibre internet, September 2026', '39200.00', 0, D.FIN]] },
  { ref: 'GHB-78544', sp: 'SP04', cur: 'USD', date: '2026-10-21', due: '2026-11-20', lines: [['GL-5200', 'Borehole repair materials, Ward 7 (pipes, cylinders, rods)', '2145.00', '332.48', D.ENG]] },
  { ref: 'MMS-56390', sp: 'SP09', cur: 'USD', date: '2026-10-28', due: '2026-11-27', lines: [['ACC-5410', 'Service kit and tyres, Land Cruiser AEZ 8841', '1860.00', '288.30', D.ENG]] },
  { ref: 'NSSA-C-2026-10', sp: 'SP10', cur: 'USD', date: '2026-10-31', due: '2026-11-10', lines: [['ACC-2220', 'NSSA contributions, October 2026 payroll', '3100.00', 0, D.FIN]] },
  { ref: 'ZIMRA-P2-2026-10', sp: 'SP11', cur: 'USD', date: '2026-10-31', due: '2026-11-10', lines: [['ACC-2220', 'PAYE and AIDS levy, October 2026 payroll', '5800.00', 0, D.FIN]] },
  { ref: 'ZIMRA-WHT-2026-10', sp: 'SP11', cur: 'USD', date: '2026-10-31', due: '2026-11-10', afterWht: true, lines: [['ACC-2230', 'Withholding tax (30%) remitted, October 2026 — Shurugwi Road Contractors SRC-2026-044, no ITF263', '9525.00', 0, D.FIN]] },
  // November
  { ref: 'LES-2026-1008', sp: 'SP08', cur: 'USD', date: '2026-11-05', due: '2026-11-20', lines: [['ACC-5510', 'Guarding, head office and works depot, October 2026', '4350.00', '674.25', D.FIN]] },
  { ref: 'ZESA/GW/26-1106', sp: 'SP01', cur: 'ZWG', date: '2026-11-06', due: '2026-11-20', lines: [['ACC-5300', 'Electricity, October 2026 — head office and Mvuma road depot', '174880.00', 0, D.FIN]] },
  // Awaiting approval (prepared by the finance officer, for the accountant to approve)
  { ref: 'MFD-INV-11415', sp: 'SP05', cur: 'USD', date: '2026-11-12', due: '2026-12-12', draft: true, lines: [['ACC-5400', 'Diesel 50, 3 000 L — Mvuma road depot', '4860.00', 0, D.ENG]] },
  { ref: 'SRC-2026-051', sp: 'SP06', cur: 'USD', date: '2026-11-14', due: '2026-12-14', draft: true, lines: [['GL-5200', 'Culvert installation, Mvuma road crossing (Cert. 3)', '12480.00', 0, D.ENG]] },
  { ref: 'KSP-2026-1342', sp: 'SP07', cur: 'ZWG', date: '2026-11-13', due: '2026-12-13', draft: true, lines: [['ACC-5500', 'Receipt books (50) and general stationery, cash office', '23400.00', 0, D.FIN]] },
]

// Invoices approved by the finance administrator rather than the accountant (variety in the trail).
const ADMIN_APPROVES = new Set(['ZINWA/GC/26-4471', 'MM-FS-2026-114', 'KSP-2026-1180', 'TO-GW-8812-09'])

// ── Payment vouchers ────────────────────────────────────────────────────────────────────────────
// ref is the key (bank reference). pays: [[supplier_ref, amount]]. draft: left awaiting approval.
const PAYMENTS = [
  { ref: 'ACC-RTGS-260725-01', sp: 'SP01', cur: 'ZWG', date: '2026-07-25', method: 'rtgs', pays: [['ZESA/GW/26-0712', '168450.00']] },
  { ref: 'ACC-RTGS-260728-01', sp: 'SP02', cur: 'ZWG', date: '2026-07-28', method: 'rtgs', pays: [['ZINWA/GC/26-4471', '42800.00']] },
  { ref: 'ACC-EFT-260730-01', sp: 'SP05', cur: 'USD', date: '2026-07-30', method: 'bank_transfer', pays: [['MFD-INV-10822', '6480.00']] },
  { ref: 'ACC-RTGS-260805-01', sp: 'SP13', cur: 'ZWG', date: '2026-08-05', method: 'rtgs', pays: [['GCC-Q2611', '142000.00']] },
  { ref: 'ACC-EFT-260812-01', sp: 'SP06', cur: 'USD', date: '2026-08-12', method: 'bank_transfer', pays: [['SRC-2026-031', '15000.00']] },
  { ref: 'ACC-EFT-260820-01', sp: 'SP08', cur: 'USD', date: '2026-08-20', method: 'bank_transfer', pays: [['LES-2026-0705', '5024.25']] },
  { ref: 'ACC-RTGS-260824-01', sp: 'SP01', cur: 'ZWG', date: '2026-08-24', method: 'rtgs', pays: [['ZESA/GW/26-0809', '171920.00']] },
  { ref: 'ACC-RTGS-260827-01', sp: 'SP03', cur: 'ZWG', date: '2026-08-27', method: 'rtgs', pays: [['TO-GW-8812-07', '38600.00']] },
  { ref: 'ACC-EFT-260828-01', sp: 'SP12', cur: 'USD', date: '2026-08-28', method: 'bank_transfer', pays: [['MM-FS-2026-114', '52900.00']] },
  { ref: 'ACC-EFT-260902-01', sp: 'SP05', cur: 'USD', date: '2026-09-02', method: 'bank_transfer', pays: [['MFD-INV-10957', '5000.00']] },
  { ref: 'ACC-RTGS-260904-01', sp: 'SP13', cur: 'ZWG', date: '2026-09-04', method: 'rtgs', pays: [['GCC-INV-2687', '186000.00']] },
  { ref: 'ACC-EFT-260910-01', sp: 'SP10', cur: 'USD', date: '2026-09-10', method: 'bank_transfer', pays: [['NSSA-C-2026-08', '3100.00']] },
  { ref: 'ACC-EFT-260910-02', sp: 'SP11', cur: 'USD', date: '2026-09-10', method: 'bank_transfer', pays: [['ZIMRA-P2-2026-08', '5800.00']] },
  { ref: 'ACC-EFT-260918-01', sp: 'SP08', cur: 'USD', date: '2026-09-18', method: 'bank_transfer', pays: [['LES-2026-0806', '5024.25']] },
  { ref: 'ACC-RTGS-260929-01', sp: 'SP14', cur: 'ZWG', date: '2026-09-29', method: 'rtgs', pays: [['MFM-0412', '94500.00']] },
  { ref: 'ACC-RTGS-261002-01', sp: 'SP01', cur: 'ZWG', date: '2026-10-02', method: 'rtgs', pays: [['ZESA/GW/26-0908', '100000.00']] },
  { ref: 'ACC-EFT-261009-01', sp: 'SP10', cur: 'USD', date: '2026-10-09', method: 'bank_transfer', pays: [['NSSA-C-2026-09', '3100.00']] },
  { ref: 'ACC-EFT-261009-02', sp: 'SP11', cur: 'USD', date: '2026-10-09', method: 'bank_transfer', pays: [['ZIMRA-P2-2026-09', '5800.00']] },
  { ref: 'ACC-CHQ-261020-01', sp: 'SP08', cur: 'USD', date: '2026-10-20', method: 'cheque', pays: [['LES-2026-0907', '2000.00']] },
  { ref: 'ACC-EFT-261110-01', sp: 'SP11', cur: 'USD', date: '2026-11-10', method: 'bank_transfer', pays: [['ZIMRA-WHT-2026-10', '9525.00']] },
  // Awaiting approval
  { ref: 'ACC-EFT-261116-01', sp: 'SP08', cur: 'USD', date: '2026-11-16', method: 'bank_transfer', draft: true, pays: [['LES-2026-0907', '3024.25'], ['LES-2026-1008', '5024.25']] },
  { ref: 'ACC-EFT-261116-02', sp: 'SP06', cur: 'USD', date: '2026-11-16', method: 'bank_transfer', draft: true, pays: [['SRC-2026-031', '9600.00']] },
]
const ADMIN_APPROVES_PAYMENT = new Set(['ACC-EFT-260828-01', 'ACC-RTGS-260929-01'])

// ── Journal vouchers ────────────────────────────────────────────────────────────────────────────
// lines: [account, debit, credit, dept]. poster: 'accountant' | 'admin' | null (left in draft).
const JOURNALS = [
  { no: 'ACC-JV-0001', cur: 'USD', date: '2026-07-31', poster: 'accountant', narration: 'Bank charges, July 2026 — CBZ current account (USD)', lines: [['ACC-5600', '186.40', null, D.FIN], ['GL-1100', null, '186.40']] },
  { no: 'ACC-JV-0002', cur: 'ZWG', date: '2026-07-31', poster: 'accountant', narration: 'Bank charges, July 2026 — CBZ current account (ZWG)', lines: [['ACC-5600', '4850.00', null, D.FIN], ['GL-1100', null, '4850.00']] },
  { no: 'ACC-JV-0003', cur: 'USD', date: '2026-08-10', poster: 'admin', narration: 'Devolution Fund 2026, first tranche received from Ministry of Local Government', lines: [['GL-1100', '180000.00', null], ['ACC-4300', null, '180000.00']] },
  { no: 'ACC-JV-0004', cur: 'USD', date: '2026-08-24', poster: 'accountant', narration: 'Payroll accrual, August 2026 (gross pay, PAYE and NSSA)', lines: [['GL-5100', '41200.00', null, D.FIN], ['ACC-2210', null, '32300.00'], ['ACC-2220', null, '8900.00']] },
  { no: 'ACC-JV-0005', cur: 'USD', date: '2026-08-26', poster: 'accountant', narration: 'Net salaries paid, August 2026', lines: [['ACC-2210', '32300.00', null], ['GL-1100', null, '32300.00']] },
  { no: 'ACC-JV-0006', cur: 'USD', date: '2026-08-31', poster: 'accountant', narration: 'Bank charges, August 2026 — CBZ current account (USD)', lines: [['ACC-5600', '212.75', null, D.FIN], ['GL-1100', null, '212.75']] },
  { no: 'ACC-JV-0007', cur: 'ZWG', date: '2026-08-31', poster: 'accountant', narration: 'Bank charges, August 2026 — CBZ current account (ZWG)', lines: [['ACC-5600', '5120.00', null, D.FIN], ['GL-1100', null, '5120.00']] },
  { no: 'ACC-JV-0008', cur: 'ZWG', date: '2026-08-31', poster: 'admin', narration: 'Reclassify fibre internet charged to electricity in July (TelOne, not ZESA)', lines: [['ACC-5310', '12400.00', null, D.FIN], ['ACC-5300', null, '12400.00', D.FIN]] },
  { no: 'ACC-JV-0009', cur: 'USD', date: '2026-09-24', poster: 'accountant', narration: 'Payroll accrual, September 2026 (gross pay, PAYE and NSSA)', lines: [['GL-5100', '41200.00', null, D.FIN], ['ACC-2210', null, '32300.00'], ['ACC-2220', null, '8900.00']] },
  { no: 'ACC-JV-0010', cur: 'USD', date: '2026-09-25', poster: 'accountant', narration: 'Net salaries paid, September 2026', lines: [['ACC-2210', '32300.00', null], ['GL-1100', null, '32300.00']] },
  { no: 'ACC-JV-0011', cur: 'USD', date: '2026-09-30', poster: 'accountant', narration: 'Petty cash reimbursement, vehicle repairs (posted to stationery in error)', lines: [['ACC-5500', '640.00', null, D.ENG], ['GL-1100', null, '640.00']], reverse: 'Charged to printing and stationery in error; these were vehicle repairs (receipts MMS-CS-118 to 121).' },
  { no: 'ACC-JV-0012', cur: 'USD', date: '2026-09-30', poster: 'accountant', narration: 'Bank charges, September 2026 — CBZ current account (USD)', lines: [['ACC-5600', '198.10', null, D.FIN], ['GL-1100', null, '198.10']] },
  { no: 'ACC-JV-0013', cur: 'ZWG', date: '2026-09-30', poster: 'accountant', narration: 'Bank charges, September 2026 — CBZ current account (ZWG)', lines: [['ACC-5600', '4980.00', null, D.FIN], ['GL-1100', null, '4980.00']] },
  { no: 'ACC-JV-0014', cur: 'USD', date: '2026-10-06', poster: 'admin', narration: 'Petty cash reimbursement, vehicle repairs — correct posting (replaces ACC-JV-0011)', lines: [['ACC-5410', '640.00', null, D.ENG], ['GL-1100', null, '640.00']] },
  { no: 'ACC-JV-0015', cur: 'USD', date: '2026-10-14', poster: 'admin', narration: 'Devolution Fund 2026, second tranche received from Ministry of Local Government', lines: [['GL-1100', '120000.00', null], ['ACC-4300', null, '120000.00']] },
  { no: 'ACC-JV-0016', cur: 'USD', date: '2026-10-23', poster: 'accountant', narration: 'Payroll accrual, October 2026 (gross pay, PAYE and NSSA)', lines: [['GL-5100', '41200.00', null, D.FIN], ['ACC-2210', null, '32300.00'], ['ACC-2220', null, '8900.00']] },
  { no: 'ACC-JV-0017', cur: 'USD', date: '2026-10-26', poster: 'accountant', narration: 'Net salaries paid, October 2026', lines: [['ACC-2210', '32300.00', null], ['GL-1100', null, '32300.00']] },
  { no: 'ACC-JV-0018', cur: 'USD', date: '2026-10-31', poster: 'accountant', narration: 'Bank charges, October 2026 — CBZ current account (USD)', lines: [['ACC-5600', '224.60', null, D.FIN], ['GL-1100', null, '224.60']] },
  { no: 'ACC-JV-0019', cur: 'ZWG', date: '2026-10-31', poster: 'accountant', narration: 'Bank charges, October 2026 — CBZ current account (ZWG)', lines: [['ACC-5600', '5310.00', null, D.FIN], ['GL-1100', null, '5310.00']] },
  // Drafts for the accountant's queue
  { no: 'ACC-JV-0020', cur: 'USD', date: '2026-11-10', poster: null, narration: 'Accrue external audit fee, 2025/26 financial statements (Office of the Auditor-General)', lines: [['ACC-5800', '6500.00', null, D.FIN], ['GL-2100', null, '6500.00']] },
  { no: 'ACC-JV-0021', cur: 'ZWG', date: '2026-11-12', poster: null, narration: 'Accrue estimated electricity, Lower Gweru office, October (meter not read)', lines: [['ACC-5300', '21500.00', null, D.SOC], ['GL-2100', null, '21500.00']] },
  { no: 'ACC-JV-0022', cur: 'USD', date: '2026-11-13', poster: null, narration: 'Transfer grader hydraulic pump (MMS-55102) to roads maintenance programme', lines: [['GL-5200', '3240.00', null, D.ENG], ['ACC-5410', null, '3240.00', D.ENG]] },
  { no: 'ACC-JV-0023', cur: 'USD', date: '2026-11-16', poster: null, narration: 'Payroll accrual, November 2026 (gross pay, PAYE and NSSA)', lines: [['GL-5100', '41200.00', null, D.FIN], ['ACC-2210', null, '32300.00'], ['ACC-2220', null, '8900.00']] },
]
const REVERSAL_DATE = '2026-10-06'
// Raised after the supplier invoices exist: withholding tax settles part of an invoice (party + against).
const WHT_JOURNAL = { no: 'ACC-JV-0024', cur: 'USD', date: '2026-10-15', poster: 'accountant',
  narration: 'Withholding tax 30% on SRC-2026-044, Shurugwi Road Contractors (no valid ITF263 tax clearance)',
  lines: [['ACC-2200', '9525.00', null, null, { sp: 'SP06', against: 'SRC-2026-044' }], ['ACC-2230', null, '9525.00']] }

// ── Fixed assets ────────────────────────────────────────────────────────────────────────────────
// code, name, asset account, accumulated, method, life months, residual %
const CATEGORIES = [
  ['ACC-LAND', 'Land', 'ACC-1510', null, 'none', null, 0],
  ['ACC-BLDG', 'Buildings', 'ACC-1520', 'ACC-1620', 'straight_line', 600, 0],
  ['ACC-MV', 'Motor vehicles', 'ACC-1530', 'ACC-1630', 'straight_line', 60, 10],
  ['ACC-PLANT', 'Plant and equipment (graders, earthmoving)', 'ACC-1540', 'ACC-1640', 'straight_line', 120, 10],
  ['ACC-IT', 'Computer equipment', 'ACC-1550', 'ACC-1650', 'straight_line', 36, 0],
  ['ACC-FURN', 'Furniture and fittings', 'ACC-1560', 'ACC-1660', 'straight_line', 120, 5],
]
// tag, category, name, currency, cost, acquired, serial, location, custodian, dept, cutover?
const ASSETS = [
  ['ACC-FA-01', 'ACC-LAND', 'Head office stand 1147, Gweru', 'USD', '85000.00', '1998-06-01', 'Deed 1147/98', 'Gweru', 'Chief Executive Officer', D.FIN],
  ['ACC-FA-02', 'ACC-LAND', 'Lower Gweru district office stand', 'USD', '25000.00', '2004-03-01', 'Deed 3302/04', 'Lower Gweru', 'District Officer', D.SOC],
  ['ACC-FA-03', 'ACC-LAND', 'Mvuma road works depot land', 'USD', '40000.00', '2010-09-01', 'Deed 0871/10', 'Mvuma road', 'Works Manager', D.ENG],
  ['ACC-FA-04', 'ACC-BLDG', 'Head office block, Gweru', 'USD', '420000.00', '2009-03-01', null, 'Gweru', 'Chief Executive Officer', D.FIN],
  ['ACC-FA-05', 'ACC-BLDG', 'Lower Gweru district office', 'USD', '165000.00', '2012-07-01', null, 'Lower Gweru', 'District Officer', D.SOC],
  ['ACC-FA-06', 'ACC-BLDG', 'Works depot workshop and stores', 'USD', '98000.00', '2014-02-01', null, 'Mvuma road depot', 'Works Manager', D.ENG],
  ['ACC-FA-07', 'ACC-BLDG', 'Staff houses, Vungu (4 units)', 'USD', '120000.00', '2016-05-01', null, 'Vungu', 'Human Resources Officer', D.FIN],
  ['ACC-FA-08', 'ACC-MV', 'Toyota Hilux 2.4 GD-6 double cab (AFG 2317)', 'USD', '48500.00', '2022-02-01', 'AFG 2317', 'Head office pool', 'Transport Officer', D.FIN],
  ['ACC-FA-09', 'ACC-MV', 'Toyota Land Cruiser 79 single cab (AEZ 8841)', 'USD', '62000.00', '2023-06-01', 'AEZ 8841', 'Works depot', 'Works Manager', D.ENG],
  ['ACC-FA-10', 'ACC-MV', 'Isuzu D-Max 2.5 (ADX 5520)', 'USD', '38000.00', '2021-11-01', 'ADX 5520', 'Lower Gweru', 'District Officer', D.SOC],
  ['ACC-FA-11', 'ACC-MV', 'Nissan NP300 single cab (ACB 1904)', 'USD', '24000.00', '2017-04-01', 'ACB 1904', 'Works depot', 'Transport Officer', D.ENG],
  ['ACC-FA-12', 'ACC-MV', 'Tata LPT 1518 7-tonne tipper truck (AEB 3306)', 'USD', '55000.00', '2022-10-01', 'AEB 3306', 'Works depot', 'Works Manager', D.ENG],
  ['ACC-FA-13', 'ACC-MV', 'Toyota Hilux 2.4 GD-6 double cab 4x4 (AGK 4410)', 'USD', '52900.00', '2026-08-14', 'AGK 4410', 'Works depot', 'Works Supervisor', D.ENG, 'invoice'],
  ['ACC-FA-14', 'ACC-PLANT', 'CAT 140K motor grader', 'USD', '285000.00', '2015-05-01', 'CAT0140KJSZM01988', 'Shurugwi road camp', 'Plant Superintendent', D.ENG],
  ['ACC-FA-15', 'ACC-PLANT', 'Komatsu GD555-5 motor grader', 'USD', '240000.00', '2018-09-01', 'KMTGD555C52011', 'Vungu–Lower Gweru road', 'Plant Superintendent', D.ENG],
  ['ACC-FA-16', 'ACC-PLANT', 'JCB 3CX backhoe loader', 'USD', '95000.00', '2019-11-01', 'JCB3CX4T2840561', 'Works depot', 'Plant Superintendent', D.ENG],
  ['ACC-FA-17', 'ACC-PLANT', 'Bomag BW 211 D-5 road roller', 'USD', '78000.00', '2016-03-01', '101583421117', 'Works depot', 'Plant Superintendent', D.ENG],
  ['ACC-FA-18', 'ACC-PLANT', 'Water bowser trailer, 10 000 L', 'USD', '18000.00', '2020-06-01', 'WB-10K-0620', 'Works depot', 'Works Manager', D.ENG],
  ['ACC-FA-19', 'ACC-IT', 'Dell PowerEdge T350 server (finance system)', 'USD', '7800.00', '2024-05-01', 'DELL-T350-8HQ2X', 'Head office server room', 'IT Officer', D.FIN],
  ['ACC-FA-20', 'ACC-IT', 'HP ProBook laptops x 12', 'USD', '10800.00', '2024-09-01', 'HP-PB450-LOT12', 'Head office', 'IT Officer', D.FIN],
  ['ACC-FA-21', 'ACC-IT', 'Network switches and firewall', 'USD', '4200.00', '2023-04-01', 'FG-60F-FGT60FTK', 'Head office server room', 'IT Officer', D.FIN],
  ['ACC-FA-22', 'ACC-IT', 'HP DesignJet T650 plotter (planning)', 'USD', '6500.00', '2025-02-01', 'HP-T650-CN52P1', 'Planning office', 'Physical Planner', D.ENG],
  ['ACC-FA-23', 'ACC-FURN', 'Council chamber furniture', 'USD', '14500.00', '2018-07-01', null, 'Head office, council chamber', 'Committee Clerk', D.FIN],
  ['ACC-FA-24', 'ACC-FURN', 'Head office furniture (finance and administration)', 'USD', '9800.00', '2021-03-01', null, 'Head office', 'Administration Officer', D.FIN],
  ['ACC-FA-25', 'ACC-IT', 'Canon imageRUNNER ADVANCE photocopier', 'ZWG', '142000.00', '2026-07-28', 'CANON-IRA-2T4471', 'Head office', 'Administration Officer', D.FIN, 'invoice'],
  ['ACC-FA-26', 'ACC-IT', 'Dell OptiPlex desktop computers x 6 (revenue hall)', 'ZWG', '186000.00', '2026-08-20', 'DELL-OPX-LOT6', 'Head office revenue hall', 'Revenue Officer', D.FIN, 'invoice'],
  ['ACC-FA-27', 'ACC-FURN', 'Office desks and chairs, Lower Gweru district office', 'ZWG', '94500.00', '2026-09-15', null, 'Lower Gweru', 'District Officer', D.SOC, 'invoice'],
]
const DISPOSE = { tag: 'ACC-FA-11', on: '2026-11-12', proceeds: '3500.00', note: 'Sold at the council vehicle auction of 12 November 2026 (lot 4), beyond economic repair.' }
const RUNS = [
  ...['Jul', 'Aug', 'Sep', 'Oct'].map((m, i) => ({ period_no: i + 1, cur: 'USD', approve: 'accountant' })),
  { period_no: 1, cur: 'ZWG', approve: 'admin' },
  { period_no: 2, cur: 'ZWG', approve: 'admin' },
  { period_no: 3, cur: 'ZWG', approve: 'accountant' },
  { period_no: 4, cur: 'ZWG', approve: null },
]

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────
const cents = (s) => Math.round(Number(s) * 100)
const money = (c) => (c / 100).toFixed(2)

/** Months of depreciation charged before 1 July 2026 (start month inclusive). */
function monthsBeforeCutover(acquired) {
  const [y, m] = acquired.split('-').map(Number)
  return Math.max(0, (2026 - y) * 12 + (6 - m) + 1)
}

const tokens = {}
async function login(who, email) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${await res.text()}`)
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || '']
  const access = cookies.find((c) => c.startsWith('vungu_at='))
  if (!access) throw new Error(`login ${email} returned no vungu_at cookie`)
  await res.arrayBuffer()
  tokens[who] = access.split(';')[0]
}

async function call(who, method, path, body) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { cookie: tokens[who], ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (res.status >= 300) throw new Error(`${who} ${method} ${path} -> ${res.status}: ${json.message || json.error || text}`)
  return json.data
}

// ── Clean and report ────────────────────────────────────────────────────────────────────────────
const MINE = {
  parties: `SELECT id FROM finance.party WHERE reference LIKE 'ACC-%'`,
  assets: `SELECT a.id FROM finance.fixed_asset a JOIN finance.asset_category c ON c.id = a.category_id WHERE c.code LIKE 'ACC-%'`,
}
const MY_VOUCHERS = `
  WITH base AS (
    SELECT id FROM finance.voucher WHERE voucher_no LIKE 'ACC-%'
    UNION SELECT voucher_id FROM finance.supplier_invoice WHERE party_id IN (${MINE.parties})
    UNION SELECT voucher_id FROM finance.supplier_payment WHERE party_id IN (${MINE.parties})
    UNION SELECT r.voucher_id FROM finance.depreciation_run r
           WHERE EXISTS (SELECT 1 FROM finance.depreciation_charge dc WHERE dc.run_id = r.id AND dc.asset_id IN (${MINE.assets}))
    UNION SELECT disposal_voucher_id FROM finance.fixed_asset WHERE id IN (${MINE.assets}) AND disposal_voucher_id IS NOT NULL
  )
  SELECT id FROM base WHERE id IS NOT NULL
  UNION SELECT v.id FROM finance.voucher v WHERE v.reverses_voucher_id IN (SELECT id FROM base)`

async function clean(db) {
  console.log('The ledger is insert-only. --clean sets session_replication_role = replica for ONE transaction')
  console.log('(suspending the immutability triggers), deletes only rows this script created (ACC- prefix,')
  console.log('ACC- suppliers and asset categories, and the documents raised on them), and restores it.')
  await db.query('BEGIN')
  try {
    await db.query('SET LOCAL session_replication_role = replica')
    await db.query(`CREATE TEMP TABLE acc_v ON COMMIT DROP AS ${MY_VOUCHERS}`)
    await db.query(`DELETE FROM finance.supplier_payment_allocation WHERE payment_id IN (SELECT id FROM finance.supplier_payment WHERE voucher_id IN (SELECT id FROM acc_v))`)
    await db.query(`DELETE FROM finance.supplier_payment WHERE voucher_id IN (SELECT id FROM acc_v)`)
    await db.query(`DELETE FROM finance.supplier_invoice_line WHERE invoice_id IN (SELECT id FROM finance.supplier_invoice WHERE voucher_id IN (SELECT id FROM acc_v))`)
    await db.query(`DELETE FROM finance.supplier_invoice WHERE voucher_id IN (SELECT id FROM acc_v)`)
    await db.query(`DELETE FROM finance.depreciation_charge WHERE run_id IN (SELECT id FROM finance.depreciation_run WHERE voucher_id IN (SELECT id FROM acc_v))`)
    await db.query(`DELETE FROM finance.depreciation_run WHERE voucher_id IN (SELECT id FROM acc_v)`)
    await db.query(`DELETE FROM finance.fixed_asset WHERE id IN (${MINE.assets})`)
    await db.query(`DELETE FROM finance.asset_category WHERE code LIKE 'ACC-%'`)
    await db.query(`DELETE FROM finance.ledger_entry WHERE voucher_id IN (SELECT id FROM acc_v)`)
    await db.query(`DELETE FROM finance.voucher_line WHERE voucher_id IN (SELECT id FROM acc_v)`)
    await db.query(`DELETE FROM finance.voucher WHERE id IN (SELECT id FROM acc_v)`)
    await db.query(`DELETE FROM finance.party WHERE reference LIKE 'ACC-%'`)
    // Children before parents.
    await db.query(`DELETE FROM finance.ledger_account WHERE code LIKE 'ACC-%' AND NOT is_group`)
    await db.query(`DELETE FROM finance.ledger_account WHERE code LIKE 'ACC-%'`)
    if (process.argv.includes('--dry-run')) {
      const { rows } = await db.query(`SELECT (SELECT count(*) FROM finance.party WHERE reference LIKE 'ACC-%')::int AS parties,
        (SELECT count(*) FROM finance.voucher WHERE voucher_no LIKE 'ACC-%')::int AS vouchers`)
      await db.query('ROLLBACK')
      console.log('--dry-run: every delete succeeded and was rolled back; left after delete:', rows[0])
      return
    }
    await db.query('COMMIT')
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  }
  console.log('Removed the accounting demo dataset.')
}

async function report(db) {
  const { rows: counts } = await db.query(`
    SELECT 'ledger accounts (ACC-)' AS what, count(*)::int AS n FROM finance.ledger_account WHERE code LIKE 'ACC-%'
    UNION ALL SELECT 'suppliers', count(*)::int FROM finance.party WHERE reference LIKE 'ACC-%'
    UNION ALL SELECT 'supplier invoices: ' || CASE WHEN v.status = 'draft' THEN 'awaiting approval' ELSE 'approved' END, count(*)::int
      FROM finance.supplier_invoice i JOIN finance.voucher v ON v.id = i.voucher_id WHERE i.party_id IN (${MINE.parties}) GROUP BY v.status
    UNION ALL SELECT 'payments: ' || CASE WHEN v.status = 'draft' THEN 'awaiting approval' ELSE 'approved' END, count(*)::int
      FROM finance.supplier_payment p JOIN finance.voucher v ON v.id = p.voucher_id WHERE p.party_id IN (${MINE.parties}) GROUP BY v.status
    UNION ALL SELECT 'payment allocations', count(*)::int FROM finance.supplier_payment_allocation a
      JOIN finance.supplier_payment p ON p.id = a.payment_id WHERE p.party_id IN (${MINE.parties})
    UNION ALL SELECT 'journal/opening vouchers ACC-: ' || status, count(*)::int FROM finance.voucher WHERE voucher_no LIKE 'ACC-%' GROUP BY status
    UNION ALL SELECT 'reversals of ACC- vouchers: ' || status, count(*)::int FROM finance.voucher
      WHERE reverses_voucher_id IN (SELECT id FROM finance.voucher WHERE voucher_no LIKE 'ACC-%') GROUP BY status
    UNION ALL SELECT 'asset categories', count(*)::int FROM finance.asset_category WHERE code LIKE 'ACC-%'
    UNION ALL SELECT 'assets: ' || status, count(*)::int FROM finance.v_asset_register WHERE category_code LIKE 'ACC-%' GROUP BY status
    UNION ALL SELECT 'depreciation runs: ' || r.currency || ' ' || v.status, count(*)::int FROM finance.depreciation_run r
      JOIN finance.voucher v ON v.id = r.voucher_id GROUP BY r.currency, v.status`)
  console.log('\nAccounting demo rows:')
  for (const r of counts) console.log(`  ${r.what.padEnd(44)} ${String(r.n).padStart(5)}`)

  const { rows: books } = await db.query(
    `SELECT tb.currency, sum(tb.debit_balance)::text AS dr, sum(tb.credit_balance)::text AS cr,
            (sum(tb.debit_balance) - sum(tb.credit_balance))::text AS diff
       FROM finance.v_trial_balance tb
      WHERE tb.financial_year_id IN (SELECT id FROM finance.financial_year WHERE label = $1)
      GROUP BY tb.currency ORDER BY tb.currency`, [YEAR_LABEL])
  console.log('\nTrial balance per currency (whole ledger):')
  for (const b of books) console.log(`  ${b.currency}  Dr ${b.dr}  Cr ${b.cr}  ${Number(b.diff) === 0 ? 'BALANCES' : `OUT BY ${b.diff}`}`)

  const { rows: ageing } = await db.query(
    `SELECT currency, CASE WHEN days_outstanding <= 30 THEN '0-30' WHEN days_outstanding <= 60 THEN '31-60'
                           WHEN days_outstanding <= 90 THEN '61-90' ELSE '90+' END AS bucket,
            count(*)::int AS docs, sum(outstanding_amount)::text AS outstanding
       FROM finance.v_creditor_open WHERE outstanding_amount <> 0 AND party_reference LIKE 'ACC-%'
      GROUP BY 1, 2 ORDER BY 1, 2`)
  console.log('\nCreditor ageing (ACC- suppliers):')
  for (const a of ageing) console.log(`  ${a.currency}  ${a.bucket.padEnd(6)} ${String(a.docs).padStart(3)} doc(s)  ${a.outstanding}`)
}

// ── Seed ────────────────────────────────────────────────────────────────────────────────────────
async function seed(db) {
  const one = async (sql, params) => (await db.query(sql, params)).rows[0]
  const year = await one('SELECT id FROM finance.financial_year WHERE label = $1', [YEAR_LABEL])
  if (!year) throw new Error('The DD 2026/27 demo year is missing. Run seed-finance-director-demo.js and seed-general-ledger-demo.js first.')
  const yearId = year.id

  await login('officer', 'demo.finance-officer@vungu.test')
  await login('accountant', 'demo.accountant@vungu.test')
  await login('admin', 'demo.finance-admin@vungu.test')
  const counters = {}
  const bump = (k) => { counters[k] = (counters[k] || 0) + 1 }

  // Chart
  const acct = {}
  const loadAccounts = async () => {
    const { rows } = await db.query(`SELECT id, code FROM finance.ledger_account WHERE deleted_at IS NULL AND (code LIKE 'ACC-%' OR code LIKE 'GL-%')`)
    for (const r of rows) acct[r.code] = r.id
  }
  await loadAccounts()
  for (const [code, name, rootType, accountType, parent, isGroup] of CHART) {
    if (acct[code]) continue
    if (!acct[parent]) throw new Error(`parent account ${parent} missing — run seed-general-ledger-demo.js first`)
    const body = { code, name, root_type: rootType, parent_id: acct[parent], is_group: isGroup, is_postable: !isGroup }
    if (accountType) body.account_type = accountType
    const created = await call('accountant', 'POST', '/finance/ledger/accounts', body)
    acct[code] = created.id
    bump('accounts created')
  }

  // Departments
  const dept = {}
  for (const r of (await db.query(`SELECT id, code FROM finance.department WHERE deleted_at IS NULL AND code LIKE 'DD-%'`)).rows) dept[r.code] = r.id

  // Suppliers
  const party = {}
  for (const r of (await db.query(`SELECT id, reference FROM finance.party WHERE reference LIKE 'ACC-SP%'`)).rows) party[r.reference.slice(4)] = r.id
  for (const [key, name, contact, phone, email, address] of SUPPLIERS) {
    if (party[key]) continue
    const created = await call('officer', 'POST', '/finance/ledger/parties', {
      party_type: 'supplier', name, reference: `ACC-${key}`, contact_name: contact, contact_phone: phone,
      contact_email: email, address_text: address, notes: 'Synthetic demo supplier (accounting workspace demo).',
    })
    party[key] = created.id
    bump('suppliers created')
  }

  const invoiceVoucher = {}
  // Journal posting helper
  const postVoucher = async (who, id) => {
    const v = await one('SELECT version FROM finance.voucher WHERE id = $1', [id])
    return call(who, 'POST', `/finance/ledger/vouchers/${id}/post`, { expected_version: v.version })
  }
  const voucherByNo = async (no) => one('SELECT id, status FROM finance.voucher WHERE voucher_no = $1', [no])
  const makeJournal = async (j, type = 'journal') => {
    let v = await voucherByNo(j.no)
    if (!v) {
      const created = await call('officer', 'POST', '/finance/ledger/vouchers', {
        voucher_no: j.no, voucher_type: type, currency: j.cur, financial_year_id: yearId, posting_date: j.date,
        narration: j.narration, reference: j.reference || j.no,
        lines: j.lines.map(([code, debit, credit, d, link]) => {
          if (!acct[code]) throw new Error(`account ${code} missing`)
          const line = { ledger_account_id: acct[code], ...(debit ? { debit } : { credit }), narration: j.narration.slice(0, 500) }
          if (d && dept[d]) line.department_id = dept[d]
          if (link) { line.party_id = party[link.sp]; line.against_voucher_id = invoiceVoucher[link.against] }
          return line
        }),
      })
      v = { id: created.voucher.id, status: 'draft' }
      bump(`journals drafted`)
    }
    if (v.status === 'draft' && j.poster) {
      await postVoucher(j.poster, v.id)
      bump('journals posted')
    }
    return v.id
  }

  // Fixed-asset cut-over figures (computed once, used by the opening voucher and the register)
  const catByCode = Object.fromEntries(CATEGORIES.map((c) => [c[0], c]))
  const figures = ASSETS.map((a) => {
    const [tag, cat, , , cost, acquired, , , , , via] = a
    const [, , , , method, life, pct] = catByCode[cat]
    const residual = method === 'none' ? 0 : Math.round(cents(cost) * pct / 100)
    let opening = 0
    if (method !== 'none' && !via) {
      const monthly = (cents(cost) - residual) / life
      opening = Math.min(cents(cost) - residual, Math.round(monthly * monthsBeforeCutover(acquired)))
    }
    return { tag, cat, cost: cents(cost), residual, opening, via }
  })

  // Opening voucher bringing the pre-July register onto the USD book.
  {
    const dr = {}; const cr = {}
    let equity = 0
    for (const f of figures) {
      if (f.via) continue
      const c = catByCode[f.cat]
      dr[c[2]] = (dr[c[2]] || 0) + f.cost
      equity += f.cost
      if (f.opening > 0) { cr[c[3]] = (cr[c[3]] || 0) + f.opening; equity -= f.opening }
    }
    const lines = [
      ...Object.entries(dr).map(([code, c]) => [code, money(c), null]),
      ...Object.entries(cr).map(([code, c]) => [code, null, money(c)]),
      ['GL-3100', null, money(equity)],
    ]
    await makeJournal({
      no: 'ACC-OB-ASSETS', cur: 'USD', date: '2026-07-01', poster: 'accountant', reference: 'Asset register cut-over',
      narration: 'Opening balances: property, plant and equipment taken onto the asset register at cut-over (cost less accumulated depreciation)',
      lines,
    }, 'opening')
  }

  // Journals before invoices (the grant funds the payments); the reversal is handled after.
  for (const j of JOURNALS) await makeJournal(j)
  {
    const wrong = await voucherByNo('ACC-JV-0011')
    let rev = await one('SELECT id, status FROM finance.voucher WHERE reverses_voucher_id = $1', [wrong.id])
    if (!rev) {
      const out = await call('accountant', 'POST', `/finance/ledger/vouchers/${wrong.id}/reverse`, {
        reason: JOURNALS.find((j) => j.no === 'ACC-JV-0011').reverse, posting_date: REVERSAL_DATE,
      })
      rev = { id: out.reversal.id, status: 'draft' }
      bump('reversals raised')
    }
    if (rev.status === 'draft') { await postVoucher('admin', rev.id); bump('reversals posted') }
  }

  // Supplier invoices
  const captureInvoice = async (inv) => {
    const partyId = party[inv.sp]
    let row = await one(
      `SELECT i.id, i.voucher_id, v.status FROM finance.supplier_invoice i JOIN finance.voucher v ON v.id = i.voucher_id
        WHERE i.party_id = $1 AND i.supplier_ref = $2`, [partyId, inv.ref])
    if (!row) {
      const hasTax = inv.lines.some((l) => l[3] && Number(l[3]) > 0)
      const created = await call('officer', 'POST', '/finance/payables/invoices', {
        party_id: partyId, currency: inv.cur, financial_year_id: yearId, posting_date: inv.date, invoice_date: inv.date,
        due_date: inv.due, supplier_ref: inv.ref, payable_account_id: acct['ACC-2200'],
        ...(hasTax ? { tax_account_id: acct['ACC-1410'] } : {}),
        lines: inv.lines.map(([code, description, net, tax, d]) => ({
          ledger_account_id: acct[code], description, net_amount: net, tax_amount: tax ? String(tax) : '0',
          ...(d && dept[d] ? { department_id: dept[d] } : {}),
        })),
      })
      row = await one('SELECT i.id, i.voucher_id, v.status FROM finance.supplier_invoice i JOIN finance.voucher v ON v.id = i.voucher_id WHERE i.id = $1', [created.id])
      bump('invoices captured')
    }
    if (row.status === 'draft' && !inv.draft) {
      await call(ADMIN_APPROVES.has(inv.ref) ? 'admin' : 'accountant', 'POST', `/finance/payables/invoices/${row.id}/approve`)
      bump('invoices approved')
    }
    invoiceVoucher[inv.ref] = row.voucher_id
  }
  for (const inv of INVOICES.filter((i) => !i.afterWht)) await captureInvoice(inv)
  await makeJournal(WHT_JOURNAL)
  for (const inv of INVOICES.filter((i) => i.afterWht)) await captureInvoice(inv)

  // Payments
  for (const p of PAYMENTS) {
    let row = await one(
      `SELECT sp.id, v.status FROM finance.supplier_payment sp JOIN finance.voucher v ON v.id = sp.voucher_id
        WHERE sp.party_id = $1 AND sp.reference = $2`, [party[p.sp], p.ref])
    if (!row) {
      const created = await call('officer', 'POST', '/finance/payables/payments', {
        party_id: party[p.sp], currency: p.cur, financial_year_id: yearId, payment_date: p.date,
        bank_account_id: acct['GL-1100'], method: p.method, reference: p.ref,
        allocations: p.pays.map(([ref, amount]) => ({ against_voucher_id: invoiceVoucher[ref], amount })),
      })
      row = { id: created.id, status: 'draft' }
      bump('payments prepared')
    }
    if (row.status === 'draft' && !p.draft) {
      await call(ADMIN_APPROVES_PAYMENT.has(p.ref) ? 'admin' : 'accountant', 'POST', `/finance/payables/payments/${row.id}/approve`)
      bump('payments approved')
    }
  }

  // Asset categories
  const cat = {}
  for (const r of (await db.query(`SELECT id, code FROM finance.asset_category WHERE code LIKE 'ACC-%'`)).rows) cat[r.code] = r.id
  for (const [code, name, assetAcc, accumAcc, method, life, pct] of CATEGORIES) {
    if (cat[code]) continue
    const body = { code, name, asset_account_id: acct[assetAcc], method }
    if (method === 'straight_line') Object.assign(body, { accumulated_account_id: acct[accumAcc], expense_account_id: acct['ACC-5700'], useful_life_months: life, residual_pct: pct })
    const created = await call('accountant', 'POST', '/finance/assets/categories', body)
    cat[code] = created.id
    bump('asset categories created')
  }

  // Assets
  const assetId = {}
  for (const r of (await db.query(`SELECT id, substring(description from '\\[(ACC-FA-\\d+)\\]') AS tag FROM finance.fixed_asset WHERE description LIKE '%[ACC-FA-%'`)).rows) assetId[r.tag] = r.id
  for (let i = 0; i < ASSETS.length; i += 1) {
    const [tag, catCode, name, cur, cost, acquired, serial, location, custodian, d, via] = ASSETS[i]
    if (assetId[tag]) continue
    const f = figures[i]
    const created = await call('officer', 'POST', '/finance/assets', {
      name, category_id: cat[catCode], currency: cur, cost, acquired_on: acquired,
      residual_value: money(f.residual), accumulated_opening: money(f.opening),
      description: `${via ? 'Bought in 2026/27; cost posted by the supplier invoice.' : 'Brought onto the register at cut-over, 1 July 2026.'} [${tag}]`,
      ...(serial ? { serial_no: serial } : {}), location, custodian, ...(dept[d] ? { department_id: dept[d] } : {}),
    })
    assetId[tag] = created.id
    bump('assets registered')
  }

  // Depreciation runs, in period order
  const periods = {}
  for (const r of (await db.query('SELECT id, period_no FROM finance.ledger_period WHERE financial_year_id = $1', [yearId])).rows) periods[r.period_no] = r.id
  for (const cur of ['USD', 'ZWG']) {
    for (const r of RUNS.filter((x) => x.cur === cur).sort((a, b) => a.period_no - b.period_no)) {
      let run = await one(
        `SELECT r.id, v.status FROM finance.depreciation_run r JOIN finance.voucher v ON v.id = r.voucher_id
          WHERE r.ledger_period_id = $1 AND r.currency = $2 AND finance.voucher_stands(r.voucher_id)`, [periods[r.period_no], cur])
      if (!run) {
        const created = await call('officer', 'POST', '/finance/assets/runs', { ledger_period_id: periods[r.period_no], currency: cur })
        run = { id: created.id, status: 'draft' }
        bump('depreciation runs raised')
      }
      if (run.status === 'draft' && r.approve) {
        await call(r.approve, 'POST', `/finance/assets/runs/${run.id}/approve`)
        bump('depreciation runs approved')
      }
    }
  }

  // Disposal awaiting approval
  {
    const a = await one('SELECT disposal_voucher_id FROM finance.fixed_asset WHERE id = $1', [assetId[DISPOSE.tag]])
    if (!a.disposal_voucher_id) {
      await call('officer', 'POST', `/finance/assets/${assetId[DISPOSE.tag]}/dispose`, {
        disposed_on: DISPOSE.on, proceeds: DISPOSE.proceeds, proceeds_account_id: acct['GL-1100'],
        gain_loss_account_id: acct['ACC-5900'], note: DISPOSE.note,
      })
      bump('disposals raised')
    }
  }

  console.log('\nThis run:')
  if (!Object.keys(counters).length) console.log('  nothing to do — already seeded')
  for (const [k, n] of Object.entries(counters)) console.log(`  ${k.padEnd(28)} ${n}`)
}

async function main() {
  const mode = process.argv.includes('--clean') || process.argv.includes('--undo') ? 'clean'
    : process.argv.includes('--report') ? 'report' : 'create'
  if (TODAY > new Date().toISOString().slice(0, 10)) {
    console.warn(`Note: the dataset is dated up to ${TODAY}; the clock reads ${new Date().toISOString().slice(0, 10)}.`)
  }
  const db = new Client({ connectionString: DATABASE_URL })
  await db.connect()
  try {
    if (mode === 'clean') return await clean(db)
    if (mode === 'create') await seed(db)
    await report(db)
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err.message); process.exit(1) })
