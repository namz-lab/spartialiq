/**
 * Generate docs/manuals/SpartialIQ_User_Manual.docx — full end-user manual.
 * Run: node scripts/generate-user-manual.mjs
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, PageNumber,
  Header, Footer, PageBreak, LevelFormat,
} from '../backend/node_modules/docx/dist/index.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'docs', 'manuals', 'SpartialIQ_User_Manual.docx')

const thin = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' }
const borders = { top: thin, bottom: thin, left: thin, right: thin }
const headerFill = '0F3D68'
const altFill = 'F1F5F9'

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 160, before: opts.before ?? 0, line: 276 },
    alignment: opts.align,
    ...opts,
    children: [
      new TextRun({
        text,
        font: 'Calibri',
        size: opts.size ?? 22,
        bold: opts.bold,
        italics: opts.italics,
        color: opts.color ?? '1E293B',
      }),
    ],
  })
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 200 },
    children: [new TextRun({ text, font: 'Calibri', size: 32, bold: true, color: '0F3D68' })],
  })
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 140 },
    children: [new TextRun({ text, font: 'Calibri', size: 26, bold: true, color: '1E3A5F' })],
  })
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, font: 'Calibri', size: 24, bold: true, color: '334155' })],
  })
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 80, line: 276 },
    children: [new TextRun({ text, font: 'Calibri', size: 22, color: '1E293B' })],
  })
}

function step(n, text) {
  return new Paragraph({
    numbering: { reference: 'steps', level: 0 },
    spacing: { after: 80, line: 276 },
    children: [new TextRun({ text, font: 'Calibri', size: 22, color: '1E293B' })],
  })
}

function note(text) {
  return new Paragraph({
    spacing: { before: 80, after: 160, line: 276 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 24, color: '0F3D68', space: 8 },
    },
    indent: { left: 200 },
    children: [
      new TextRun({ text: 'Note: ', font: 'Calibri', size: 20, bold: true, color: '0F3D68' }),
      new TextRun({ text, font: 'Calibri', size: 20, italics: true, color: '475569' }),
    ],
  })
}

function warn(text) {
  return new Paragraph({
    spacing: { before: 80, after: 160, line: 276 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 24, color: 'B45309', space: 8 },
    },
    indent: { left: 200 },
    children: [
      new TextRun({ text: 'Important: ', font: 'Calibri', size: 20, bold: true, color: 'B45309' }),
      new TextRun({ text, font: 'Calibri', size: 20, italics: true, color: '475569' }),
    ],
  })
}

function cell(text, opts = {}) {
  return new TableCell({
    borders,
    width: { size: opts.width ?? 2400, type: WidthType.DXA },
    shading: opts.header ? { fill: headerFill } : opts.alt ? { fill: altFill } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: String(text ?? ''),
            font: 'Calibri',
            size: opts.header ? 18 : 18,
            bold: opts.header || opts.bold,
            color: opts.header ? 'FFFFFF' : '1E293B',
          }),
        ],
      }),
    ],
  })
}

function table(headers, rows, widths) {
  const w = widths || headers.map(() => Math.floor(9000 / headers.length))
  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: w,
    rows: [
      new TableRow({
        children: headers.map((h, i) => cell(h, { header: true, width: w[i] })),
      }),
      ...rows.map((r, ri) =>
        new TableRow({
          children: r.map((c, i) => cell(c, { width: w[i], alt: ri % 2 === 1 })),
        }),
      ),
    ],
  })
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] })
}

const children = []

// ── Cover ──────────────────────────────────────────────────────────────
children.push(
  new Paragraph({ spacing: { before: 1200 }, children: [] }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: 'VUNGU RURAL DISTRICT COUNCIL', font: 'Calibri', size: 28, color: '64748B', bold: true })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [new TextRun({ text: 'SpartialIQ', font: 'Calibri', size: 56, bold: true, color: '0F3D68' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: 'Spatial Planning & Development Control Portal', font: 'Calibri', size: 28, color: '334155' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
    children: [new TextRun({ text: 'USER MANUAL', font: 'Calibri', size: 36, bold: true, color: '0F3D68' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Complete guide for citizens, council staff, and administrators', font: 'Calibri', size: 22, italics: true, color: '64748B' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 800, after: 80 },
    children: [new TextRun({ text: `Version 2.0  ·  ${new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}`, font: 'Calibri', size: 20, color: '64748B' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Local app: http://localhost:5174  ·  API: http://localhost:3000', font: 'Calibri', size: 18, color: '94A3B8' })],
  }),
  pageBreak(),
)

// ── TOC-ish intro ──────────────────────────────────────────────────────
children.push(
  h1('1. Introduction'),
  p('SpartialIQ (also styled SpatialIQ) is Vungu Rural District Council’s digital platform for spatial planning, development control, land information, surveys, and citizen services. It connects residents, ratepayers, and council officers on one shared system backed by PostGIS and QGIS.'),
  h2('1.1 What this manual covers'),
  bullet('Getting started: access, browsers, accounts, and passwords'),
  bullet('Public website and map explorer (no login required)'),
  bullet('Citizen portal: residency proof, applications, payments, documents, tracking'),
  bullet('Every staff role: Planning Clerk, Planner, EO, Environmental Officer, Building Inspector, Surveyor, GIS Officer, Admin'),
  bullet('GIS / QGIS interoperability, payments, notifications, and troubleshooting'),
  h2('1.2 Who should read which chapters'),
  table(
    ['Reader', 'Start here', 'Also read'],
    [
      ['Citizen / applicant', '§3 Public site, §4 Accounts, §5 Citizen portal', '§11 Payments, §13 Troubleshooting'],
      ['Planning Clerk', '§6 Planning Clerk', '§5 Citizen (to assist applicants), §11 Payments'],
      ['Planner', '§7 Planner', '§9 Surveyor, §10 GIS, §12 QGIS'],
      ['Executive Officer (EO)', '§8 EO portal', '§7 Planner (case context)'],
      ['Env. Officer / Inspector', '§8 specialised workspaces', '§5 Citizen tracking'],
      ['Surveyor / GIS Officer', '§9–§10, §12 QGIS', '§7 Planner studio'],
      ['IT Admin', '§10 Admin, §12–§14', 'All role chapters for support'],
    ],
    [2200, 3400, 3400],
  ),
  pageBreak(),
)

// ── Getting started ────────────────────────────────────────────────────
children.push(
  h1('2. Getting started'),
  h2('2.1 System requirements'),
  bullet('Modern browser: Microsoft Edge, Google Chrome, or Firefox (latest two versions)'),
  bullet('Internet connection for live map tiles and API calls'),
  bullet('For staff map editing: QGIS Desktop where your role requires it (GIS Officer / Surveyor)'),
  bullet('Mobile phones and tablets: citizen flows are designed mobile-first; staff consoles work best on desktop'),
  h2('2.2 Opening the portal'),
  step(1, 'On this council machine: open http://localhost:5174/'),
  step(2, 'On the same Wi‑Fi / LAN: open http://<host-ip>:5174/ (ask IT for the current LAN address)'),
  step(3, 'In production: use the council’s published HTTPS address (e.g. the council portal domain)'),
  note('The backend API listens on port 3000. Ordinary users only need the website URL; the browser talks to the API automatically.'),
  h2('2.3 Demo accounts (training / UAT only)'),
  p('Password for all demo accounts: demo1234'),
  table(
    ['Role', 'Email', 'Lands at'],
    [
      ['Citizen / Viewer', 'demo.viewer@vungu.test', '/citizen or /residency if unverified'],
      ['Planner', 'demo.planner@vungu.test', '/planner'],
      ['Executive Officer', 'demo.eo@vungu.test', '/eo-planner-portal'],
      ['Environmental Officer', 'demo.envoffice@vungu.test', '/env-officer-workspace'],
      ['Building Inspector', 'demo.inspector@vungu.test', '/inspector-workspace'],
      ['Planning Clerk', 'demo.clerk@vungu.test', '/planning-clerk-portal'],
      ['Surveyor', 'demo.surveyor@vungu.test', '/surveyor-workspace'],
      ['GIS Officer', 'demo.gis@vungu.test', '/gis-officer-portal'],
      ['Admin (IT)', 'demo.admin@vungu.test', '/admin'],
    ],
    [2400, 3600, 3000],
  ),
  warn('Demo accounts and the shared password must never be used in live production. Change all passwords immediately after go-live.'),
  pageBreak(),
)

// ── Public site ────────────────────────────────────────────────────────
children.push(
  h1('3. Public website (no login)'),
  h2('3.1 Home'),
  p('The home page is an app-style shell (not a long marketing scroll). Use the header, hamburger menu (mobile), or bottom navigation to switch panels:'),
  bullet('Home — welcome, key stats, call to action'),
  bullet('About — council profile, mission, district facts'),
  bullet('Map — interactive district map with search and quick filters'),
  bullet('Data — public datasets catalogue'),
  bullet('Departments / Services — how the council serves you'),
  bullet('Invest — investment opportunities'),
  bullet('Governance — leadership and contact'),
  bullet('Statistics — district indicators'),
  note('Longer panels (About, Departments, Invest, Governance) scroll inside the panel. Home, Map, Data, and Statistics stay on one screen where possible.'),
  h2('3.2 Map explorer'),
  bullet('Open Map from the home navigation or go to /explorer'),
  bullet('Search places, stands, and wards'),
  bullet('Toggle layers; click features for attributes'),
  bullet('Basemap and council layers are served from PostGIS / QGIS Server'),
  h2('3.3 Other public pages'),
  bullet('/about, /services, /contact'),
  bullet('/council/:slug — profile, committees, departments, publications'),
  bullet('/privacy and /terms — legal notices'),
  pageBreak(),
)

// ── Accounts ───────────────────────────────────────────────────────────
children.push(
  h1('4. Accounts, login, and security'),
  h2('4.1 Register (citizens)'),
  step(1, 'Open Sign in → Register, or go to /register'),
  step(2, 'Enter full name, email, password (minimum 8 characters), phone, and address'),
  step(3, 'Choose applicant type: resident, landowner, business, consultant, or visitor'),
  step(4, 'Optionally enter National ID (required later for instant title-deed verification)'),
  step(5, 'Submit — you are signed in and may be sent to residency verification'),
  note('Self-registration only creates citizen roles (registered / public). Staff accounts are created only by Admin invitation.'),
  h2('4.2 Sign in'),
  step(1, 'Go to /login'),
  step(2, 'Enter email and password'),
  step(3, 'On success you land on your role home (citizen portal, planner, etc.)'),
  h2('4.3 Session behaviour'),
  bullet('Access and refresh tokens are stored in httpOnly cookies (not visible to page scripts)'),
  bullet('Idle timeout signs you out after about 45 minutes of inactivity (server setting)'),
  bullet('Use Sign out from the profile menu when finished on a shared PC'),
  bullet('Change password from the profile dropdown'),
  h2('4.4 Staff invites'),
  step(1, 'Admin invites a colleague with role, department, and job title'),
  step(2, 'Invitee opens the email link → /invite/accept'),
  step(3, 'Sets name and password once; account becomes active'),
  pageBreak(),
)

// ── Citizen ────────────────────────────────────────────────────────────
children.push(
  h1('5. Citizen portal'),
  p('URL: /citizen  ·  Roles: registered, public, viewer (citizen-tier)'),
  h2('5.1 Residency verification (required for district services)'),
  p('URL: /residency. New citizen accounts are redirected here until residency is verified. Statutory proofs follow SI 85/2017 s.5 practice:'),
  table(
    ['Proof', 'How it works', 'Typical result'],
    [
      ['Title deed', 'Enter deed number — checked against Deeds Registry', 'Instant verify if national ID matches holder'],
      ['Certificate of occupation', 'Upload document', 'Staff review'],
      ["Lodger's permit", 'Upload document', 'Staff review'],
      ['Settlement / offer letter', 'Upload document', 'Staff review'],
      ['Rates / utility statement', 'Upload as proof of residence', 'Staff review'],
      ['Chief / councillor letter', 'Upload confirmation letter', 'Staff review'],
    ],
    [2600, 3600, 2800],
  ),
  h3('Instant deed check'),
  step(1, 'Ensure your profile National ID matches the deed holder’s ID'),
  step(2, 'On /residency enter the deed number (e.g. DT-4410/2023 for demo)'),
  step(3, 'If found and holder matches → residency status becomes verified'),
  step(4, 'If not matched → update National ID or upload the deed for manual review'),
  note('Demo deed for demo.viewer: DT-4410/2023 with national ID 63-1111111-G-63.'),
  h2('5.2 My applications'),
  bullet('List and open applications from the citizen portal'),
  bullet('Use “Where your application is — office by office” (Application Pipeline) to see the current office'),
  bullet('Statuses move through: submitted → acknowledged → circulation → objection period → under review → approved / conditions / refused'),
  h2('5.3 New development application'),
  step(1, 'Citizen portal → New application (or /citizen?section=new)'),
  step(2, 'Select stand / site (map picker where available)'),
  step(3, 'Complete Form TPD.1 style particulars and development type'),
  step(4, 'Upload plans and supporting documents'),
  step(5, 'Submit — Planning Clerk receives it for acknowledgement'),
  h2('5.4 Documents'),
  bullet('/documents — upload and view your identity and residency files'),
  bullet('Allowed types: JPEG, PNG, WebP, HEIC, PDF (size limits apply)'),
  bullet('Staff verify in a queue; you see pending / under review / verified / rejected'),
  h2('5.5 Payments & receipts'),
  bullet('/payments and /payment/new — pay application or inspection fees'),
  bullet('Methods (when configured): Paynow, EcoCash, OneMoney, Stripe; Manual is for training only'),
  bullet('After success open /receipt/:refNo for the council receipt number'),
  h2('5.6 Profile'),
  bullet('/profile — keep name, phone, address, and National ID up to date'),
  bullet('National ID must match deeds for instant residency verification'),
  pageBreak(),
)

// ── Planning Clerk ─────────────────────────────────────────────────────
children.push(
  h1('6. Planning Clerk portal'),
  p('URL: /planning-clerk-portal  ·  Role: planning_clerk'),
  p('You are the front desk of development control: receive applications, collect fees, publish notices, maintain the register, and dispatch permits.'),
  h2('6.1 Typical daily tasks'),
  bullet('Acknowledgements — mark new submissions as received / acknowledged'),
  bullet('Application receipt — issue references and capture intake particulars'),
  bullet('Fees — track fee status; reconcile with payment receipts'),
  bullet('Public notices — publish statutory notices; manage objection windows'),
  bullet('Development register — authoritative list of live cases'),
  bullet('Permit dispatch — issue approved permits to applicants'),
  bullet('Enforcement records — keep enforcement file entries current'),
  bullet('Document verification queue — verify citizen residency / ID uploads'),
  h2('6.2 Document verification'),
  step(1, 'Open the documents queue (staff)'),
  step(2, 'Review the file and any AI triage recommendation (if enabled)'),
  step(3, 'Decide verified or rejected; add notes and extracted ID details'),
  step(4, 'Verified residency documents flip the citizen to verified residency'),
  pageBreak(),
)

// ── Planner ────────────────────────────────────────────────────────────
children.push(
  h1('7. Planner workspace'),
  p('URL: /planner  ·  Studio: /planner/studio/:layer/:fid  ·  Role: planner'),
  h2('7.1 Case work'),
  bullet('Open cases from the planner console'),
  bullet('Perform due diligence against zoning and constraints on the live map'),
  bullet('Circulate for technical comment (Env Officer, Surveyor, GIS, Building Inspector)'),
  bullet('Record assessment and recommendation for committee / EO'),
  bullet('Manage public notice and objection stages with the clerk'),
  h2('7.2 Planning Studio (subdivision)'),
  step(1, 'Open a parcel from the map into Planning Studio'),
  step(2, 'Design lots, roads, and open space (or export DXF for AutoCAD / QGIS)'),
  step(3, 'Re-import DXF if edited externally; IDs preserve lot matching'),
  step(4, 'Validate and save — stands update through the shared allocation API'),
  h2('7.3 Planning Assistant'),
  bullet('Use “what can be developed here?” suggestions based on zone controls and templates'),
  bullet('Treat suggestions as decision support — statutory judgement remains yours'),
  pageBreak(),
)

// ── EO / Env / Inspector ───────────────────────────────────────────────
children.push(
  h1('8. Executive Officer, Environment & Building Control'),
  h2('8.1 Executive Officer (EO)'),
  p('URL: /eo-planner-portal  ·  Role: eo'),
  bullet('Review due diligence packages and committee resolutions'),
  bullet('Make the statutory determination: approve, approve with conditions, or refuse'),
  bullet('Oversee technical circulation and committee reports'),
  warn('EO decision endpoints enforce committee / quorum gates where configured. Do not bypass statutory process.'),
  h2('8.2 Environmental Officer'),
  p('URL: /env-officer-workspace  ·  Role: env_officer'),
  bullet('Plan appraisal on circulated applications'),
  bullet('Environmental inspections and surveillance'),
  bullet('Certificates and consultation responses back to the case'),
  h2('8.3 Building Inspector'),
  p('URL: /inspector-workspace  ·  Role: building_inspector'),
  bullet('Pre-construction checks'),
  bullet('Nine DM Handbook stage inspections (schedule, photos, pass/fail)'),
  bullet('Enforcement orders and compliance checks'),
  bullet('Occupation certificate — only after prior stages have passed (server-enforced)'),
  table(
    ['Stage focus (indicative)', 'Typical action'],
    [
      ['Foundation / substructure', 'Inspect and record outcome + photos'],
      ['Superstructure / roofing', 'Inspect and record outcome + photos'],
      ['Final / occupation', 'Confirm compliance → occupation certificate path'],
    ],
    [4500, 4500],
  ),
  pageBreak(),
)

// ── Surveyor ───────────────────────────────────────────────────────────
children.push(
  h1('9. Surveyor'),
  p('URLs: /surveyor (console), /surveyor-workspace (full Survey Task Manager)  ·  Role: surveyor'),
  h2('9.1 Jobs'),
  bullet('Receive survey tasks assigned by Planner / EO / Clerk'),
  bullet('Capture beacons, control points, coordinates, and parcels'),
  bullet('Compute polar, intersections, and areas as required'),
  bullet('Produce Report on Survey, diagrams (GeoPDF / DXF), and findings'),
  bullet('Submit findings for planner acceptance'),
  h2('9.2 Field practice tips'),
  bullet('Keep projects organised under Survey Task Manager'),
  bullet('Use the map console for spatial context before field work'),
  bullet('Upload scanned plans as PDF where required'),
  pageBreak(),
)

// ── GIS & Admin ────────────────────────────────────────────────────────
children.push(
  h1('10. GIS Officer and IT Admin'),
  h2('10.1 GIS Officer portal'),
  p('URL: /gis-officer-portal  ·  Map tools: /gis-map, /property/:standNo, /admin/gis-symbology  ·  Role: gis_officer'),
  bullet('Maintain stands editor and zoning maps'),
  bullet('Environmental constraints and abutting-owner analysis'),
  bullet('Spatial database integrity (PostGIS is the source of truth)'),
  bullet('Symbology registry: draft → review → approve → publish (one published style per layer)'),
  bullet('QGIS Desktop ↔ web bridge: styles and layers stay synchronised'),
  note('Published styles are immutable. To change cartography, create a new version and publish it.'),
  h2('10.2 Ministry of Lands (simulation)'),
  p('URL: /mock/ministry-lands  ·  Staff roles only'),
  bullet('Browse seeded deeds and incoming deed-check requests'),
  bullet('Used for training and UAT of residency title-deed verification'),
  bullet('In production this is replaced by a real Deeds Registry integration'),
  h2('10.3 IT Admin'),
  p('URL: /admin/*  ·  Role: admin'),
  bullet('Invite, suspend, and reset staff users'),
  bullet('Site content CMS (public pages)'),
  bullet('GIS symbology registry and QGIS plugin management'),
  bullet('Security / video tutorial admin tools where enabled'),
  warn('Admin is intentionally not a planning role. Admins should not open planning cases or applicant PII workspaces as part of IT duties.'),
  pageBreak(),
)

// ── Payments ───────────────────────────────────────────────────────────
children.push(
  h1('11. Payments'),
  h2('11.1 Citizen flow'),
  step(1, 'From the application or /payment/new choose purpose (application fee, inspection fee, etc.)'),
  step(2, 'Select wallet currency (USD or ZWG) and payment method'),
  step(3, 'Complete provider steps (USSD / redirect / card)'),
  step(4, 'Wait for confirmation; open receipt when status is paid'),
  h2('11.2 What staff see'),
  bullet('Clerk fees ledger and payment records against the case'),
  bullet('Paid inspection fees move bookings from pending payment onto the waitlist'),
  bullet('Paid application fees can unblock registration of the permit'),
  h2('11.3 Training mode'),
  note('The Manual payment driver is for development and UAT only. Confirming a manual payment marks it paid without a real gateway.'),
  pageBreak(),
)

// ── QGIS ───────────────────────────────────────────────────────────────
children.push(
  h1('12. QGIS and desktop GIS'),
  p('SpartialIQ treats PostGIS as the single source of truth for geometry. QGIS Desktop and QGIS Server render from the same published symbology registry.'),
  h2('12.1 Typical GIS Officer workflow'),
  step(1, 'Edit layers in QGIS connected to the council PostGIS database'),
  step(2, 'Save — spatial change notifications refresh open web maps'),
  step(3, 'Publish styles through the web symbology registry when cartography changes'),
  step(4, 'Verify web map and WMS look identical for the same zone / layer'),
  h2('12.2 Planner / Surveyor exchange'),
  bullet('Export georeferenced DXF from Planning Studio or survey tools'),
  bullet('Edit in AutoCAD / QGIS; re-import preserving embedded IDs'),
  bullet('Survey diagrams: GeoPDF / DXF from Survey Task Manager'),
  pageBreak(),
)

// ── Pipeline overview ──────────────────────────────────────────────────
children.push(
  h1('13. End-to-end development permit journey'),
  p('This is the main council use case. Everyone sees the same office-to-office progress via the Application Pipeline.'),
  table(
    ['Step', 'Actor', 'What happens'],
    [
      ['1', 'Citizen', 'Submits application + plans + fee'],
      ['2', 'Planning Clerk', 'Receipts and acknowledges; reference issued'],
      ['3', 'Planner', 'Due diligence; circulates to technical officers'],
      ['4', 'Env / Survey / GIS / BI', 'Parallel technical responses'],
      ['5', 'Clerk', 'Public notice; objections recorded'],
      ['6', 'Planner', 'Assessment and recommendation'],
      ['7', 'Committee', 'Quorum and resolution (where required)'],
      ['8', 'EO', 'Statutory determination'],
      ['9', 'Citizen', 'Pays remaining fees; receives permit'],
      ['10', 'Building Inspector', 'Stage inspections'],
      ['11', 'Citizen / Inspector', 'Occupation certificate; case closed'],
    ],
    [900, 2400, 5700],
  ),
  pageBreak(),
)

// ── Troubleshooting ────────────────────────────────────────────────────
children.push(
  h1('14. Troubleshooting & FAQ'),
  h2('14.1 Common issues'),
  table(
    ['Symptom', 'Likely cause', 'What to try'],
    [
      ['Cannot sign in', 'Wrong password / suspended account', 'Reset via Admin; check Caps Lock'],
      ['Sent to /residency every time', 'Residency not verified', 'Complete deed check or upload proof'],
      ['Deed check fails', 'National ID mismatch or wrong deed no.', 'Fix profile NID; try upload path'],
      ['Map blank / layers missing', 'Backend or QGIS Server down', 'Ask IT to check API :3000 and QGIS'],
      ['Payment stuck pending', 'Gateway delay / webhook', 'Use Poll status; contact clerk'],
      ['Signed out suddenly', 'Idle timeout (≈45 min)', 'Sign in again'],
      ['Staff page forbidden', 'Wrong role for that portal', 'Use your assigned portal only'],
      ['Upload rejected', 'Wrong file type / too large / scan fail', 'Use PDF/JPG/PNG under size limit'],
    ],
    [2400, 3000, 3600],
  ),
  h2('14.2 Getting help'),
  bullet('Citizens: contact Planning Clerk / front desk with your application reference'),
  bullet('Staff: contact IT Admin for access issues; Planner / EO for case process questions'),
  bullet('IT: check backend health at /health, database connectivity, and PM2 / service status'),
  pageBreak(),
)

// ── Glossary ───────────────────────────────────────────────────────────
children.push(
  h1('15. Glossary'),
  table(
    ['Term', 'Meaning'],
    [
      ['SpartialIQ / SpatialIQ', 'This planning portal product'],
      ['PostGIS', 'PostgreSQL spatial database — source of truth for parcels and layers'],
      ['QGIS', 'Desktop / server GIS used with council spatial data'],
      ['TPD.1', 'Town planning development application form family'],
      ['RTCP Act', 'Regional Town and Country Planning Act (statutory decisions)'],
      ['DM Handbook', 'Development Management Handbook — inspection stages'],
      ['EO', 'Executive Officer — issues the statutory determination'],
      ['Residency status', 'Whether the citizen has proved they belong to the district'],
      ['Application Pipeline', 'Office-by-office progress view shared by citizen and staff'],
      ['Symbology registry', 'Governed colour / style versions for map layers'],
      ['Deeds Registry (sim)', 'Training stand-in for Ministry of Lands title checks'],
    ],
    [2800, 6200],
  ),
  pageBreak(),
)

// ── Appendix ───────────────────────────────────────────────────────────
children.push(
  h1('16. Appendix — quick URL reference'),
  table(
    ['Path', 'Audience', 'Purpose'],
    [
      ['/', 'Public', 'Home shell'],
      ['/login', 'All', 'Sign in'],
      ['/register', 'Citizen', 'Create account'],
      ['/residency', 'Citizen', 'Prove residence'],
      ['/citizen', 'Citizen', 'Services portal'],
      ['/documents', 'Citizen', 'My documents'],
      ['/payments', 'Citizen', 'My payments'],
      ['/planning-clerk-portal', 'Clerk', 'Front desk'],
      ['/planner', 'Planner', 'Workspace'],
      ['/eo-planner-portal', 'EO', 'Decisions'],
      ['/env-officer-workspace', 'Env', 'Appraisal'],
      ['/inspector-workspace', 'Inspector', 'Inspections'],
      ['/surveyor-workspace', 'Surveyor', 'Survey tasks'],
      ['/gis-officer-portal', 'GIS', 'Spatial ops'],
      ['/admin', 'Admin', 'IT console'],
      ['/mock/ministry-lands', 'Staff', 'Deeds simulation'],
      ['/health (API)', 'IT', 'Backend health'],
    ],
    [3200, 1800, 4000],
  ),
  new Paragraph({ spacing: { before: 400 }, children: [] }),
  p('— End of User Manual —', { align: AlignmentType.CENTER, italics: true, color: '64748B' }),
  p('Prepared for Vungu Rural District Council · SpartialIQ platform', { align: AlignmentType.CENTER, size: 18, color: '94A3B8' }),
)

const doc = new Document({
  creator: 'SpartialIQ',
  title: 'SpartialIQ User Manual — Vungu Rural District Council',
  description: 'Complete end-user manual for citizens and council staff',
  styles: {
    default: {
      document: {
        styles: [{ id: 'Normal', run: { font: 'Calibri', size: 22 } }],
      },
    },
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '○', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 360 } } } },
        ],
      },
      {
        reference: 'steps',
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 900, bottom: 900, left: 900, right: 900 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({ text: 'Vungu RDC · SpartialIQ User Manual', font: 'Calibri', size: 16, color: '94A3B8' }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: 'Page ', font: 'Calibri', size: 16, color: '94A3B8' }),
                new TextRun({ children: [PageNumber.CURRENT], font: 'Calibri', size: 16, color: '94A3B8' }),
                new TextRun({ text: ' of ', font: 'Calibri', size: 16, color: '94A3B8' }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Calibri', size: 16, color: '94A3B8' }),
              ],
            }),
          ],
        }),
      },
      children,
    },
  ],
})

mkdirSync(dirname(OUT), { recursive: true })
const buffer = await Packer.toBuffer(doc)
writeFileSync(OUT, buffer)
console.log('Wrote', OUT)
console.log('Size', buffer.length, 'bytes')
