/**
 * Generate docs/manuals/SpartialIQ_Complete_Use_Cases.docx
 * Very large use-case catalogue: every actor, every major journey,
 * step-by-step "who does this → goes to who".
 *
 * Run: node scripts/generate-use-cases-manual.mjs
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
const OUT = join(__dirname, '..', 'docs', 'manuals', 'SpartialIQ_Complete_Use_Cases.docx')

const thin = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' }
const borders = { top: thin, bottom: thin, left: thin, right: thin }
const headerFill = '0F3D68'
const altFill = 'F1F5F9'
const accentFill = 'E8F0FE'

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 140, before: opts.before ?? 0, line: 276 },
    alignment: opts.align,
    children: [
      new TextRun({
        text: String(text ?? ''),
        font: 'Calibri',
        size: opts.size ?? 21,
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
    spacing: { before: 400, after: 200 },
    children: [new TextRun({ text, font: 'Calibri', size: 32, bold: true, color: '0F3D68' })],
  })
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 140 },
    children: [new TextRun({ text, font: 'Calibri', size: 26, bold: true, color: '1E3A5F' })],
  })
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 220, after: 100 },
    children: [new TextRun({ text, font: 'Calibri', size: 23, bold: true, color: '334155' })],
  })
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 70, line: 276 },
    children: [new TextRun({ text, font: 'Calibri', size: 21, color: '1E293B' })],
  })
}

function step(text) {
  return new Paragraph({
    numbering: { reference: 'steps', level: 0 },
    spacing: { after: 70, line: 276 },
    children: [new TextRun({ text, font: 'Calibri', size: 21, color: '1E293B' })],
  })
}

function callout(label, text, color = '0F3D68') {
  return new Paragraph({
    spacing: { before: 80, after: 140, line: 276 },
    border: { left: { style: BorderStyle.SINGLE, size: 24, color, space: 8 } },
    indent: { left: 160 },
    children: [
      new TextRun({ text: `${label}: `, font: 'Calibri', size: 20, bold: true, color }),
      new TextRun({ text, font: 'Calibri', size: 20, italics: true, color: '475569' }),
    ],
  })
}

function route(from, to, via) {
  return p(`→ ${from}  sends to  ${to}${via ? `  (${via})` : ''}`, {
    size: 20, italics: true, color: '0F3D68', after: 60,
  })
}

function cell(text, opts = {}) {
  return new TableCell({
    borders,
    width: { size: opts.width ?? 2200, type: WidthType.DXA },
    shading: opts.header
      ? { fill: headerFill }
      : opts.accent
        ? { fill: accentFill }
        : opts.alt
          ? { fill: altFill }
          : undefined,
    margins: { top: 50, bottom: 50, left: 70, right: 70 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: String(text ?? ''),
            font: 'Calibri',
            size: 17,
            bold: !!(opts.header || opts.bold),
            color: opts.header ? 'FFFFFF' : '1E293B',
          }),
        ],
      }),
    ],
  })
}

function table(headers, rows, widths) {
  const w = widths || headers.map(() => Math.floor(9360 / headers.length))
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: w,
    rows: [
      new TableRow({ children: headers.map((h, i) => cell(h, { header: true, width: w[i] })) }),
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

/** One detailed journey block */
function journey({ id, title, actor, goal, trigger, portal, steps, goesTo, documents, outcomes, exceptions }) {
  const out = [
    h2(`${id} — ${title}`),
    p(`Primary actor: ${actor}`, { bold: true }),
    p(`Goal: ${goal}`),
    p(`Trigger: ${trigger}`),
    p(`Portal / screen: ${portal}`, { italics: true, color: '475569' }),
    h3('What the user does (step by step)'),
  ]
  for (const s of steps) out.push(step(s))
  out.push(h3('Who it goes to next (routing)'))
  for (const g of goesTo) {
    out.push(bullet(`${g.from} → ${g.to}`))
    if (g.why) out.push(p(`     Why: ${g.why}`, { size: 19, color: '64748B', after: 40 }))
    if (g.does) out.push(p(`     Next office does: ${g.does}`, { size: 19, color: '475569', after: 80 }))
  }
  if (documents?.length) {
    out.push(h3('Documents / records created'))
    for (const d of documents) out.push(bullet(d))
  }
  if (outcomes?.length) {
    out.push(h3('Possible outcomes'))
    for (const o of outcomes) out.push(bullet(o))
  }
  if (exceptions?.length) {
    out.push(h3('Exceptions & what happens then'))
    for (const e of exceptions) out.push(bullet(e))
  }
  out.push(callout('Remember', 'The citizen Application Pipeline shows the same office-to-office position that staff see.'))
  return out
}

const children = []

// ══════════════════════════════════════════════════════════════════════
// COVER
// ══════════════════════════════════════════════════════════════════════
children.push(
  new Paragraph({ spacing: { before: 900 }, children: [] }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'VUNGU RURAL DISTRICT COUNCIL', font: 'Calibri', size: 26, bold: true, color: '64748B' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 200 },
    children: [new TextRun({ text: 'SpartialIQ', font: 'Calibri', size: 52, bold: true, color: '0F3D68' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: 'COMPLETE USE-CASE CATALOGUE', font: 'Calibri', size: 34, bold: true, color: '0F3D68' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [new TextRun({
      text: 'Every user · Every major journey · Who does what · Who receives it next',
      font: 'Calibri', size: 22, italics: true, color: '475569',
    })],
  }),
  p('This document answers questions like:', { align: AlignmentType.CENTER, color: '64748B' }),
  p('“I want to buy land — what do I do, and who do I go to?”', { align: AlignmentType.CENTER, italics: true }),
  p('“I want to build a house — which offices handle my file?”', { align: AlignmentType.CENTER, italics: true }),
  p('“I am the Planning Clerk — what arrives on my desk and where do I send it?”', { align: AlignmentType.CENTER, italics: true }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 600 },
    children: [new TextRun({
      text: `Version 1.0  ·  ${new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}`,
      font: 'Calibri', size: 18, color: '94A3B8',
    })],
  }),
  pageBreak(),
)

// ══════════════════════════════════════════════════════════════════════
// 1. HOW TO READ
// ══════════════════════════════════════════════════════════════════════
children.push(
  h1('1. How to read this catalogue'),
  p('Each use case is written as a real-world story. For every journey you get:'),
  bullet('Who starts it (the actor)'),
  bullet('What they are trying to achieve'),
  bullet('Exact steps they take in SpartialIQ'),
  bullet('Who the work goes to next — office by office'),
  bullet('What the next office must do'),
  bullet('Documents created and possible outcomes'),
  bullet('What happens when something goes wrong'),
  h2('1.1 Actors at a glance'),
  table(
    ['Actor', 'Portal', 'One-line job'],
    [
      ['Citizen / Resident', '/citizen', 'Applies, pays, uploads, tracks'],
      ['Land buyer / investor', '/citizen + Map', 'Finds land, applies, pays allocation fees'],
      ['Landowner / developer', '/citizen', 'Permits, subdivision, building'],
      ['Business applicant', '/citizen', 'Commercial / industrial development'],
      ['Consultant (agent)', '/citizen', 'Acts for a client on applications'],
      ['Visitor', '/ (public)', 'Views map & info; limited services'],
      ['Planning Clerk', '/planning-clerk-portal', 'Front desk: receipt, fees, notices, dispatch'],
      ['Planner', '/planner', 'Due diligence, zoning, circulation, recommend'],
      ['Environmental Officer', '/env-officer-workspace', 'Env appraisal & surveillance'],
      ['Surveyor', '/surveyor-workspace', 'Field survey, beacons, diagrams'],
      ['GIS Officer', '/gis-officer-portal', 'Spatial DB, zoning layers, styles'],
      ['Building Inspector', '/inspector-workspace', '9 stage inspections → occupation'],
      ['Executive Officer (EO)', '/eo-planner-portal', 'Statutory decision (RTCP Act)'],
      ['Committee', '(meetings in system)', 'Quorum + resolution before EO decides'],
      ['Admin (IT)', '/admin', 'Users, invites, content, symbology — not planning'],
      ['Ministry of Lands (sim)', '/mock/ministry-lands', 'Deeds registry check (training/UAT)'],
    ],
    [2400, 2800, 4160],
  ),
  h2('1.2 Universal routing principle'),
  callout(
    'Rule',
    'A citizen never has to guess which office holds their file. Open My applications → “Where your application is — office by office”. Staff see the same pipeline.',
  ),
  pageBreak(),
)

// ══════════════════════════════════════════════════════════════════════
// 2. MASTER MAP — BUY LAND EXAMPLE (user asked specifically)
// ══════════════════════════════════════════════════════════════════════
children.push(
  h1('2. Master example — “I want to buy land”'),
  p('This is the full journey many residents and investors ask about. Buying council land is not a single click: it is a chain of people and offices.'),
  h2('2.1 Plain-English story'),
  p('Tendai wants a residential stand in Insukamini. He registers online, proves he belongs to the district, finds an available stand on the map, applies, pays fees, waits while Planning Clerk → Planner → (sometimes Surveyor / GIS) → Committee → EO decide, then receives allocation / offer documentation. If he later builds, a second journey (building permit + inspections) starts.'),
  h2('2.2 Who Tendai goes to (office chain)'),
  table(
    ['#', 'Tendai does…', 'Goes to…', 'That office does…'],
    [
      ['1', 'Creates account', 'System (auto)', 'Issues citizen login'],
      ['2', 'Proves residency', 'Deeds Registry and/or Planning Clerk', 'Instant deed match OR manual verify'],
      ['3', 'Browses available stands on Map', 'GIS data (Planner/GIS maintain)', 'Sees vacant / allocated stands'],
      ['4', 'Submits stand / land application', 'Planning Clerk', 'Receipts, fees, opens register entry'],
      ['5', 'Pays application / allocation fee', 'Payments + Planning Clerk ledger', 'Unblocks registration'],
      ['6', 'Waits for assessment', 'Planner', 'Zoning check, site suitability, circulation'],
      ['7', 'If boundaries unclear', 'Surveyor (via Planner)', 'Survey / pegging report'],
      ['8', 'If map/zoning conflict', 'GIS Officer (via Planner)', 'Constraint / zone confirmation'],
      ['9', 'Public notice if required', 'Planning Clerk', 'Objections window'],
      ['10', 'Recommendation', 'Planner → Committee', 'Agenda + resolution'],
      ['11', 'Final decision', 'Executive Officer', 'Approve / refuse / conditions'],
      ['12', 'Receives offer / allocation', 'Planning Clerk dispatch', 'Citizen notified; register updated'],
      ['13', 'Later: build house', 'Same chain (UC-C3)', 'Permit + 9 inspections'],
    ],
    [700, 2600, 2800, 3260],
  ),
  h2('2.3 One-page routing diagram (text)'),
  p('CITIZEN (Tendai)', { bold: true }),
  p('   │ register + residency'),
  p('   ▼'),
  p('PLANNING CLERK  ←── receipts, fees, notices, dispatch', { bold: true }),
  p('   │'),
  p('   ▼'),
  p('PLANNER  ←── zoning, suitability, circulation', { bold: true }),
  p('   ├──► ENVIRONMENTAL OFFICER (if env issues)'),
  p('   ├──► SURVEYOR (if boundaries / pegging needed)'),
  p('   ├──► GIS OFFICER (if layer / zone conflict)'),
  p('   └──► BUILDING INSPECTOR (later, when building)'),
  p('   │'),
  p('   ▼'),
  p('COMMITTEE (quorum + resolution)', { bold: true }),
  p('   │'),
  p('   ▼'),
  p('EXECUTIVE OFFICER (statutory determination)', { bold: true }),
  p('   │'),
  p('   ▼'),
  p('BACK TO CITIZEN (offer / refusal / conditions) + CLERK dispatch', { bold: true }),
  pageBreak(),
)

// ══════════════════════════════════════════════════════════════════════
// 3. CITIZEN / PUBLIC ACTORS — many journeys
// ══════════════════════════════════════════════════════════════════════
children.push(
  h1('3. Citizen & public actors — all major use cases'),
  p('Citizen-tier roles in the system: public, registered, viewer. Applicant types at signup: resident, landowner, business, consultant, visitor.'),
)

children.push(...journey({
  id: 'UC-C0',
  title: 'Prove I belong to this district (residency)',
  actor: 'Any new citizen (resident, landowner, business, consultant)',
  goal: 'Become a verified resident/ratepayer so council services unlock.',
  trigger: 'First login when residencyStatus is not verified → redirected to /residency',
  portal: '/residency',
  steps: [
    'Sign up or sign in.',
    'Land on Residency Verification.',
    'Option A — Title deed: enter deed number (and ensure National ID on profile matches deed holder).',
    'Option B — Upload: settlement/offer letter, lodger’s permit, occupation certificate, rates/utility statement, or chief/councillor letter.',
    'Wait for instant verify (deed match) or staff review (uploads).',
    'When verified, proceed to Citizen Portal.',
  ],
  goesTo: [
    { from: 'Citizen (deed number)', to: 'Deeds Registry (Ministry of Lands simulation)', why: 'National title check', does: 'Match holder National ID; log the check; return found/not found' },
    { from: 'Citizen (upload)', to: 'Document verification queue', why: 'Human proof review', does: 'Planning Clerk / Planner / EO / Admin verify or reject' },
    { from: 'Verifier', to: 'Citizen account', why: 'Status flip', does: 'residency_status = verified (or rejected → citizen retries)' },
  ],
  documents: ['citizen_documents row', 'lands_registry_checks log', 'users.residency_status update'],
  outcomes: ['Verified instantly (deed + NID match)', 'Pending / under review (upload)', 'Rejected — upload clearer proof'],
  exceptions: [
    'Deed found but holder NID does not match → update profile National ID or upload deed for manual review',
    'Deed cancelled / transfer pending → cannot use for verification',
  ],
}))

children.push(...journey({
  id: 'UC-C1',
  title: 'I want to BUY / be ALLOCATED a stand (land purchase journey)',
  actor: 'Resident, landowner-to-be, investor, business needing a site',
  goal: 'Obtain an allocated / offered stand from the council land bank.',
  trigger: 'Citizen wants land → browses map → applies via Citizen Portal',
  portal: '/ (Map) then /citizen?section=new  (and /payments)',
  steps: [
    'Complete UC-C0 residency.',
    'Open Map / Explorer; search growth point or ward; filter vacant stands.',
    'Select a stand of interest; note stand number and zone.',
    'Open Citizen Portal → New application (land / stand allocation type as offered by council).',
    'Fill applicant particulars, intended use (residential / commercial / industrial / agricultural).',
    'Attach ID, proof of funds or supporting letters if required.',
    'Submit application.',
    'Pay application / allocation fee when prompted.',
    'Track office-by-office progress in My applications.',
    'If approved: receive offer / allocation letter via Clerk dispatch; accept and pay remaining fees.',
    'If refused: read reasons; may revise and reapply or appeal where allowed.',
  ],
  goesTo: [
    { from: 'Citizen', to: 'Planning Clerk', why: 'Front desk intake', does: 'Acknowledge, receipt, open development register entry, collect fees' },
    { from: 'Planning Clerk', to: 'Planner', why: 'Technical & policy assessment', does: 'Check zoning, availability, conflicts, neighbouring uses' },
    { from: 'Planner', to: 'GIS Officer (if needed)', why: 'Spatial conflict / layer check', does: 'Confirm stand geometry, zone, constraints on live PostGIS map' },
    { from: 'Planner', to: 'Surveyor (if needed)', why: 'Boundaries uncertain', does: 'Field survey / pegging / Report on Survey' },
    { from: 'Planner', to: 'Environmental Officer (if needed)', why: 'Sensitive site', does: 'Environmental appraisal comments' },
    { from: 'Planner / Clerk', to: 'Public notice (if required)', why: 'Statutory transparency', does: 'Clerk publishes; objections recorded' },
    { from: 'Planner', to: 'Committee', why: 'Recommendation', does: 'Agenda item; quorum; resolution' },
    { from: 'Committee', to: 'Executive Officer', why: 'Statutory determination', does: 'Approve / conditions / refuse' },
    { from: 'EO', to: 'Planning Clerk', why: 'Dispatch', does: 'Issue offer/allocation docs; notify citizen; update register' },
    { from: 'Planning Clerk', to: 'Citizen', why: 'Outcome', does: 'Citizen pays remaining fees and proceeds to development if desired' },
  ],
  documents: [
    'Application + attachments',
    'Payment + receipt (VRDC-YYYY-######)',
    'Consultation responses (if circulated)',
    'Committee resolution',
    'EO decision',
    'Offer / allocation letter / register update',
  ],
  outcomes: ['Allocated / offered', 'Approved with conditions', 'Refused', 'Deferred for more information'],
  exceptions: [
    'Stand already reserved/allocated → choose another; Clerk/Planner release only under policy',
    'Fee unpaid → stays pending_payment; pipeline blocked',
    'Objection upheld → Planner reassesses; may refuse or amend',
  ],
}))

children.push(...journey({
  id: 'UC-C2',
  title: 'I already own land and want to SUBDIVIDE / consolidate',
  actor: 'Landowner / developer / consultant acting for owner',
  goal: 'Split or merge stands lawfully with council approval and new stand numbers.',
  trigger: 'Owner opens application + Planner uses Planning Studio / DXF',
  portal: '/citizen (application) + /planner/studio (staff layout)',
  steps: [
    'Citizen/owner submits subdivision or consolidation application with title proof.',
    'Pays fees.',
    'Planner opens parcel in Planning Studio (or exports DXF to AutoCAD/QGIS).',
    'Layout lots, roads, open space; validate standards.',
    'Re-import DXF if edited externally; save to PostGIS / planning project.',
    'Surveyor pegs on ground if required; GIS publishes new stand numbers.',
    'EO decision after committee where required.',
    'Clerk updates register; owner receives new stand references.',
  ],
  goesTo: [
    { from: 'Citizen / Landowner', to: 'Planning Clerk', why: 'Intake', does: 'Receipt application' },
    { from: 'Clerk', to: 'Planner', why: 'Layout & policy', does: 'Design in Studio or CAD round-trip' },
    { from: 'Planner', to: 'Surveyor', why: 'Ground truth', does: 'Beacons, traverse, Report on Survey' },
    { from: 'Planner', to: 'GIS Officer', why: 'Cadastre update', does: 'Write stands to spatial DB; symbology consistency' },
    { from: 'Planner', to: 'Committee → EO', why: 'Approval', does: 'Statutory decision' },
    { from: 'EO', to: 'Clerk → Citizen', why: 'Outcome', does: 'Dispatch new stand numbers / diagrams' },
  ],
  documents: ['Subdivision plans', 'DXF / GeoPDF', 'Report on Survey', 'Updated stands register'],
  outcomes: ['Approved layout with new stands', 'Returned for redesign', 'Refused'],
  exceptions: ['Road standards fail validation → Planner revises before EO', 'ID mismatch on DXF import → reconcile by lot label'],
}))

children.push(...journey({
  id: 'UC-C3',
  title: 'I want to BUILD a house / structure (development permit TPD.1)',
  actor: 'Landowner, resident with allocated stand, business',
  goal: 'Obtain a development / building permit and eventually an occupation certificate.',
  trigger: 'Citizen → New development application with building plans',
  portal: '/citizen → New application; later /inspector-workspace (staff)',
  steps: [
    'Ensure stand is allocated / owned and residency verified.',
    'Submit development application (Form TPD.1 style) with site plans and building plans.',
    'Pay application fee.',
    'Respond to any “more information” requests from Clerk/Planner.',
    'After approval: pay building-related fees; book inspections as stages arise.',
    'Pass all inspection stages; receive occupation certificate.',
  ],
  goesTo: [
    { from: 'Citizen', to: 'Planning Clerk', why: 'Receipt & acknowledge', does: 'Register case; issue TPD reference' },
    { from: 'Clerk', to: 'Planner', why: 'Due diligence', does: 'Zoning verdict; circulate' },
    { from: 'Planner', to: 'Environmental Officer', why: 'Env review', does: 'Plan appraisal / consultation response' },
    { from: 'Planner', to: 'Surveyor (if needed)', why: 'Boundaries', does: 'Survey findings' },
    { from: 'Planner', to: 'GIS Officer', why: 'Spatial check', does: 'Constraints on live map' },
    { from: 'Planner', to: 'Building Inspector (comments)', why: 'Buildability', does: 'Early technical comments' },
    { from: 'Clerk', to: 'Public (notice)', why: 'Objections', does: 'Publish notice; record objections' },
    { from: 'Planner', to: 'Committee → EO', why: 'Decision', does: 'Approve / conditions / refuse' },
    { from: 'EO', to: 'Clerk → Citizen', why: 'Permit dispatch', does: 'Issue permit documents' },
    { from: 'Citizen', to: 'Building Inspector', why: 'Construction stages', does: '9 DM Handbook inspections' },
    { from: 'Building Inspector', to: 'Citizen', why: 'Occupation', does: 'Issue occupation certificate when stages 1–8 passed' },
  ],
  documents: ['Application + plans', 'Consultations', 'Public notice / objections', 'EO decision', 'Permit', 'Inspection bookings + photos', 'Occupation certificate'],
  outcomes: ['Approved', 'Approved with conditions', 'Refused', 'Withdrawn', 'Appealed'],
  exceptions: [
    'Failed inspection → rework + rebook stage',
    'Occupation certificate blocked until all prior stages passed (server-enforced)',
    'Committee quorum not met → resolution cannot be recorded',
  ],
}))

children.push(...journey({
  id: 'UC-C4',
  title: 'I want to CHANGE land use / rezoning request',
  actor: 'Landowner / business',
  goal: 'Change permitted use of a parcel within policy.',
  trigger: 'Application for change of use / special consent where offered',
  portal: '/citizen',
  steps: [
    'Submit change-of-use application with motivation and plans.',
    'Pay fees.',
    'Track circulation and public notice.',
    'Receive EO determination and any conditions.',
  ],
  goesTo: [
    { from: 'Citizen', to: 'Planning Clerk', why: 'Intake', does: 'Receipt' },
    { from: 'Clerk', to: 'Planner', why: 'Policy & matrix check', does: 'Compare against zone land-use controls / development matrix' },
    { from: 'Planner', to: 'Env / GIS / neighbours (notice)', why: 'Impacts', does: 'Technical + public input' },
    { from: 'Planner', to: 'Committee → EO', why: 'Decision', does: 'Approve/refuse with conditions' },
    { from: 'EO', to: 'Clerk → GIS (if approved)', why: 'Update', does: 'Register + spatial attribute updates' },
  ],
  documents: ['Motivation', 'Plans', 'Notice', 'Decision'],
  outcomes: ['Approved with conditions', 'Refused'],
  exceptions: ['Use prohibited in zone → early refusal by Planner'],
}))

children.push(...journey({
  id: 'UC-C5',
  title: 'I want to TRANSFER / sell my stand (council process view)',
  actor: 'Seller (landowner) and buyer (incoming citizen)',
  goal: 'Council records reflect the new holder; buyer can prove residency.',
  trigger: 'Parties present transfer documentation to council channels',
  portal: 'Citizen documents + Clerk register + Deeds (external) + Property File (staff)',
  steps: [
    'Seller and buyer complete external deeds transfer where applicable.',
    'Buyer registers on SpartialIQ and verifies residency (often with new title deed).',
    'Clerk / Planner update property register / owner records on Property File.',
    'Buyer inherits ability to apply for development on that stand.',
  ],
  goesTo: [
    { from: 'Buyer', to: 'Deeds Registry / Ministry of Lands', why: 'Legal title', does: 'Register transfer (external); simulation logs checks in training' },
    { from: 'Buyer', to: 'Residency (/residency)', why: 'Portal access', does: 'Deed check or upload' },
    { from: 'Buyer / Seller docs', to: 'Planning Clerk', why: 'Council records', does: 'Update owners on property register' },
    { from: 'Clerk', to: 'GIS / Property File', why: 'Spatial dossier', does: 'Owner history / lineage notes' },
  ],
  documents: ['Title deed / transfer docs', 'Updated owners on property file', 'Residency verification'],
  outcomes: ['Buyer verified and linked to stand', 'Pending until deed registered'],
  exceptions: ['Transfer pending on deed → residency may not auto-verify'],
}))

children.push(...journey({
  id: 'UC-C6',
  title: 'I am a BUSINESS wanting a commercial / industrial site',
  actor: 'Business applicant (applicant_type = business)',
  goal: 'Secure correctly zoned land and permits for commercial activity.',
  trigger: 'Business registration on portal + land/development applications',
  portal: '/register (business) → /citizen',
  steps: [
    'Register with applicant type Business; upload company registration / tax clearance if required.',
    'Complete residency / local presence proof as required by policy.',
    'Apply for stand in appropriate economic / commercial zone (see Map).',
    'After allocation, apply for development permit with business plans.',
    'Complete inspections before occupation.',
  ],
  goesTo: [
    { from: 'Business', to: 'Planning Clerk', why: 'Document & fee intake', does: 'Verify company docs in queue' },
    { from: 'Clerk', to: 'Planner', why: 'Zoning fit', does: 'Economic corridor / commercial zone checks' },
    { from: 'Planner', to: 'Env Officer', why: 'Pollution / effluent risks', does: 'Appraisal' },
    { from: 'Planner', to: 'Committee → EO', why: 'Decision', does: 'Determination' },
    { from: 'EO', to: 'Clerk → Business', why: 'Outcome', does: 'Dispatch' },
  ],
  documents: ['Company registration', 'Tax clearance', 'Plans', 'Permit', 'Occupation certificate'],
  outcomes: ['Approved in correct zone', 'Refused wrong zone / impacts'],
  exceptions: ['Wrong zone selected → Planner redirects to suitable stands'],
}))

children.push(...journey({
  id: 'UC-C7',
  title: 'I am a CONSULTANT / agent acting for a client',
  actor: 'Consultant (applicant_type = consultant)',
  goal: 'Lodge and track applications on behalf of an owner.',
  trigger: 'Consultant account + client particulars on application forms',
  portal: '/citizen',
  steps: [
    'Register as consultant; keep own residency/ID current if required.',
    'On each application, capture client owner name, NID, stand, and authority to act (letter of appointment).',
    'Upload plans prepared for the client.',
    'Pay fees (client or agent).',
    'Monitor pipeline; respond to RFIs from Clerk/Planner.',
  ],
  goesTo: [
    { from: 'Consultant', to: 'Planning Clerk', why: 'Intake', does: 'Confirm agency letter + owner details' },
    { from: 'Clerk', to: 'Planner … EO', why: 'Same statutory chain as owner-filed cases', does: 'Standard circulation and decision' },
    { from: 'Staff', to: 'Consultant + Owner contacts', why: 'Notifications', does: 'Emails/outbox to listed contacts' },
  ],
  documents: ['Letter of appointment', 'Client ID', 'Plans', 'All standard case docs'],
  outcomes: ['Same as owner-filed applications'],
  exceptions: ['Missing authority letter → Clerk returns for information'],
}))

children.push(...journey({
  id: 'UC-C8',
  title: 'I only want to VIEW maps and council information (visitor)',
  actor: 'Visitor / anonymous public',
  goal: 'Learn about the district and explore spatial data without applying.',
  trigger: 'Open public site',
  portal: '/  /explorer  /about  /services  /council/:slug',
  steps: [
    'Browse Home panels (About, Map, Data, Departments, Invest, Governance, Stats).',
    'Use Map search and layer toggles.',
    'Read contact / council pages.',
    'If ready to apply, Register → UC-C0.',
  ],
  goesTo: [
    { from: 'Visitor', to: '(no office)', why: 'Public content', does: 'Nothing queued' },
    { from: 'Visitor who registers', to: 'UC-C0 Residency', why: 'Start services', does: 'Verification chain' },
  ],
  documents: ['None (unless they register)'],
  outcomes: ['Informed visitor', 'Converts to registered citizen'],
  exceptions: ['Some map overlays require staff login'],
}))

children.push(...journey({
  id: 'UC-C9',
  title: 'I need to PAY fees and get a receipt',
  actor: 'Citizen with an open case',
  goal: 'Clear application / inspection / permit fees so the case can proceed.',
  trigger: 'Case status pending_payment or user opens /payment/new',
  portal: '/payments  /payment/new  /receipt/:refNo',
  steps: [
    'Open Payments; choose purpose (application fee, inspection fee, etc.).',
    'Select USD or ZWG wallet; choose Paynow / EcoCash / OneMoney / Stripe (or Manual in training).',
    'Complete USSD / redirect / card flow.',
    'Poll status if needed; open receipt when paid.',
  ],
  goesTo: [
    { from: 'Citizen', to: 'Payment gateway', why: 'Collect money', does: 'Provider confirms via webhook/poll' },
    { from: 'Gateway', to: 'SpartialIQ payments + Clerk ledger', why: 'Reconcile', does: 'Mark paid; issue VRDC receipt number' },
    { from: 'Payments', to: 'Case pipeline', why: 'Unblock', does: 'pending_payment → registered / inspection waitlisted' },
    { from: 'System', to: 'Citizen (email/outbox)', why: 'Notify', does: 'Fee received / waitlisted messages' },
  ],
  documents: ['payments row', 'receipt number', 'status events'],
  outcomes: ['Paid', 'Failed', 'Cancelled', 'Awaiting provider'],
  exceptions: ['Webhook delay → use Poll; contact Clerk with reference'],
}))

children.push(...journey({
  id: 'UC-C10',
  title: 'I was asked for MORE INFORMATION / my plan failed auto-check',
  actor: 'Citizen',
  goal: 'Supply missing documents or corrected plans so the case continues.',
  trigger: 'Status requires_more_info or plan-review fail/uncertain',
  portal: '/citizen  /documents  /plan-review',
  steps: [
    'Read notification / notes on the application.',
    'Upload missing documents or revised plans.',
    'Optionally run plan auto-review again where offered.',
    'Notify Clerk/Planner that materials are ready (or system flags automatically).',
  ],
  goesTo: [
    { from: 'Citizen', to: 'Planning Clerk / Planner', why: 'RFI response', does: 'Re-check completeness; resume pipeline' },
    { from: 'Plan auto-review', to: 'Planner / EO', why: 'Deterministic checks first', does: 'Human decision after machine checks' },
  ],
  documents: ['Additional uploads', 'Plan review record'],
  outcomes: ['Case resumes', 'Still incomplete → another RFI'],
  exceptions: ['Wrong file type → upload rejected by security scan'],
}))

children.push(...journey({
  id: 'UC-C11',
  title: 'I want to OBJECT to a published development notice',
  actor: 'Affected neighbour / resident',
  goal: 'Lodge a formal objection during the objection period.',
  trigger: 'Public notice published by Planning Clerk',
  portal: 'Public notice channels + Clerk / case objections (staff capture)',
  steps: [
    'Read public notice (ward / stand / period).',
    'Submit objection with grounds within the window (as directed on the notice).',
    'Receive acknowledgement; await consideration in assessment.',
  ],
  goesTo: [
    { from: 'Objector', to: 'Planning Clerk', why: 'Record objection', does: 'Attach to case; mark objection_period activity' },
    { from: 'Clerk', to: 'Planner', why: 'Consideration', does: 'Weigh objection in recommendation' },
    { from: 'Planner', to: 'Committee → EO', why: 'Decision', does: 'May uphold, dismiss, or condition approval' },
  ],
  documents: ['Objection record', 'Consideration notes'],
  outcomes: ['Objection considered in decision package'],
  exceptions: ['Late objection → may be rejected as out of time'],
}))

children.push(...journey({
  id: 'UC-C12',
  title: 'I want to TRACK progress without visiting the office',
  actor: 'Citizen',
  goal: 'Know which office currently holds the file.',
  trigger: 'Any time after submission',
  portal: '/citizen → My applications → Application Pipeline',
  steps: [
    'Sign in.',
    'Open My applications.',
    'Select the case.',
    'Read “Where your application is — office by office”.',
    'Open timeline / messages for notes.',
  ],
  goesTo: [
    { from: 'Citizen (read-only)', to: '(same offices as pipeline)', why: 'Visibility', does: 'No new routing — mirrors staff status' },
  ],
  documents: ['None created by viewing'],
  outcomes: ['Citizen informed'],
  exceptions: ['Not signed in → cannot see personal cases'],
}))

children.push(pageBreak())

// ══════════════════════════════════════════════════════════════════════
// 4. PLANNING CLERK
// ══════════════════════════════════════════════════════════════════════
children.push(
  h1('4. Planning Clerk — all desk use cases'),
  p('Portal: /planning-clerk-portal. You are the front desk of development control.'),
)

children.push(...journey({
  id: 'UC-K1',
  title: 'Receive and acknowledge a new application',
  actor: 'Planning Clerk',
  goal: 'Move submitted applications into the formal register with a reference.',
  trigger: 'Citizen submits → appears in clerk queue',
  portal: '/planning-clerk-portal → Acknowledgements / Receipt',
  steps: [
    'Open new submissions list.',
    'Check mandatory documents and fees status.',
    'Acknowledge / receipt; issue TPD / register reference.',
    'Hand to Planner for due diligence (status advance).',
  ],
  goesTo: [
    { from: 'Citizen', to: 'Planning Clerk', why: 'Intake', does: 'UC-K1' },
    { from: 'Planning Clerk', to: 'Planner', why: 'Technical work starts', does: 'Due diligence & circulation' },
    { from: 'Planning Clerk', to: 'Citizen', why: 'Notify acknowledgement', does: 'Outbox email / in-app notice' },
  ],
  documents: ['Register entry', 'Receipt', 'Status history'],
  outcomes: ['Acknowledged / registered', 'Returned to citizen for missing docs'],
  exceptions: ['Incomplete file → RFI to citizen before Planner'],
}))

children.push(...journey({
  id: 'UC-K2',
  title: 'Collect and reconcile fees',
  actor: 'Planning Clerk',
  goal: 'Ensure money matches the case before statutory clocks run.',
  trigger: 'Payment created or citizen claims payment',
  portal: 'Fees section + payments admin views',
  steps: [
    'Open Fees / ledger for the case.',
    'Confirm gateway receipt number and amount.',
    'Flag discrepancies to Admin/finance process.',
    'Confirm case can leave pending_payment.',
  ],
  goesTo: [
    { from: 'Citizen payment', to: 'Planning Clerk ledger', why: 'Reconcile', does: 'Match VRDC receipt' },
    { from: 'Clerk', to: 'Planner / pipeline', why: 'Unblock', does: 'Allow registration / inspections' },
  ],
  documents: ['Fee records', 'Receipts'],
  outcomes: ['Fees cleared', 'Discrepancy investigation'],
  exceptions: ['Manual (training) payments must not be used in live production'],
}))

children.push(...journey({
  id: 'UC-K3',
  title: 'Publish public notices and capture objections',
  actor: 'Planning Clerk',
  goal: 'Run the statutory publicity window.',
  trigger: 'Planner/Clerk stage reaches objection_period',
  portal: 'Public Notices section',
  steps: [
    'Draft/publish notice for ward/stand.',
    'Set expiry of objection window.',
    'Record incoming objections.',
    'Close window; notify Planner.',
  ],
  goesTo: [
    { from: 'Planning Clerk', to: 'Public / neighbours', why: 'Notice', does: 'Opportunity to object' },
    { from: 'Objector', to: 'Planning Clerk', why: 'Objection', does: 'File on case' },
    { from: 'Planning Clerk', to: 'Planner', why: 'Assessment input', does: 'Include in recommendation' },
  ],
  documents: ['Public notice', 'Objection records'],
  outcomes: ['Window closed with zero or N objections'],
  exceptions: ['Late objections flagged out of time'],
}))

children.push(...journey({
  id: 'UC-K4',
  title: 'Verify citizen residency / identity documents',
  actor: 'Planning Clerk (also Planner/EO/Admin)',
  goal: 'Approve or reject uploaded proofs.',
  trigger: 'Document in pending / under_review queue',
  portal: 'Documents queue',
  steps: [
    'Open queue item; view file.',
    'Read AI triage recommendation if present (advisory only).',
    'Verify or reject with notes; capture extracted ID fields.',
  ],
  goesTo: [
    { from: 'Citizen upload', to: 'Planning Clerk queue', why: 'Review', does: 'Decision' },
    { from: 'Clerk verify', to: 'Citizen residency', why: 'Unlock services', does: 'residency verified' },
    { from: 'Clerk reject', to: 'Citizen', why: 'Retry', does: 'Upload another proof' },
  ],
  documents: ['Verification notes', 'verified_by / verified_at'],
  outcomes: ['Verified', 'Rejected'],
  exceptions: ['Suspicious file → reject; escalate to Admin if malware concerns'],
}))

children.push(...journey({
  id: 'UC-K5',
  title: 'Dispatch approved permits / offer letters',
  actor: 'Planning Clerk',
  goal: 'Deliver decision documents to the citizen.',
  trigger: 'EO approved (or conditions)',
  portal: 'Permit Dispatch / Development Register',
  steps: [
    'Confirm decision package complete.',
    'Generate/dispatch permit or offer letter.',
    'Update register; notify citizen.',
  ],
  goesTo: [
    { from: 'EO', to: 'Planning Clerk', why: 'Dispatch', does: 'Issue docs' },
    { from: 'Clerk', to: 'Citizen', why: 'Delivery', does: 'Download / collect' },
    { from: 'Clerk', to: 'Building Inspector path', why: 'If building follows', does: 'Citizen books inspections later' },
  ],
  documents: ['Permit / offer', 'Register update'],
  outcomes: ['Dispatched'],
  exceptions: ['Conditions unpaid → hold dispatch'],
}))

children.push(...journey({
  id: 'UC-K6',
  title: 'Maintain enforcement records',
  actor: 'Planning Clerk',
  goal: 'Keep enforcement file accurate for illegal development / non-compliance.',
  trigger: 'Inspector or EO raises enforcement order',
  portal: 'Enforcement Records section',
  steps: [
    'Receive enforcement order reference.',
    'File against stand / case.',
    'Track compliance deadlines.',
    'Update when Inspector records compliance check.',
  ],
  goesTo: [
    { from: 'Building Inspector / EO', to: 'Planning Clerk', why: 'Record keeping', does: 'File enforcement' },
    { from: 'Clerk', to: 'Planner (visibility)', why: 'Case awareness', does: 'Seen on case/map' },
    { from: 'Clerk', to: 'Citizen (served notice)', why: 'Compliance', does: 'Respond / remedy' },
  ],
  documents: ['Enforcement / prohibition orders', 'Compliance checks'],
  outcomes: ['Complied', 'Escalated'],
  exceptions: ['Missed deadline → further enforcement'],
}))

children.push(pageBreak())

// ══════════════════════════════════════════════════════════════════════
// 5. PLANNER
// ══════════════════════════════════════════════════════════════════════
children.push(
  h1('5. Planner — all professional use cases'),
  p('Portal: /planner  ·  Studio: /planner/studio/:layer/:fid'),
)

children.push(...journey({
  id: 'UC-P1',
  title: 'Due diligence on a new case',
  actor: 'Planner',
  goal: 'Establish zoning fit, constraints, and completeness before circulation.',
  trigger: 'Clerk hands acknowledged case',
  portal: '/planner',
  steps: [
    'Open case; review application and plans.',
    'Inspect stand on live map (zones_master, constraints).',
    'Note conflicts; request survey/GIS if needed.',
    'Start technical circulation.',
  ],
  goesTo: [
    { from: 'Planning Clerk', to: 'Planner', why: 'Assessment', does: 'UC-P1' },
    { from: 'Planner', to: 'Env / Survey / GIS / BI', why: 'Circulation', does: 'Parallel consultations' },
  ],
  documents: ['Case notes', 'Consultation requests'],
  outcomes: ['Ready for circulation', 'RFI to citizen'],
  exceptions: ['Stand not found in cadastre → GIS repair first'],
}))

children.push(...journey({
  id: 'UC-P2',
  title: 'Circulate for technical comments',
  actor: 'Planner',
  goal: 'Collect specialist input before recommendation.',
  trigger: 'Due diligence complete',
  portal: '/planner consultations',
  steps: [
    'Create consultations for required roles.',
    'Set tasks / deadlines.',
    'Chase outstanding responses.',
    'Collate into assessment.',
  ],
  goesTo: [
    { from: 'Planner', to: 'Environmental Officer', why: 'Env impacts', does: 'Appraisal response' },
    { from: 'Planner', to: 'Surveyor', why: 'Boundaries', does: 'Survey task + findings' },
    { from: 'Planner', to: 'GIS Officer', why: 'Layers', does: 'Spatial confirmation' },
    { from: 'Planner', to: 'Building Inspector', why: 'Buildability', does: 'Comments' },
    { from: 'Specialists', to: 'Planner', why: 'Return', does: 'Responses filed on case' },
  ],
  documents: ['application_consultation rows', 'findings'],
  outcomes: ['All responses in', 'Partial — proceed with noted gaps if policy allows'],
  exceptions: ['Overdue consultation → escalate via EO/Clerk'],
}))

children.push(...journey({
  id: 'UC-P3',
  title: 'Design a subdivision in Planning Studio / CAD',
  actor: 'Planner',
  goal: 'Produce a standards-compliant layout linked to PostGIS.',
  trigger: 'Subdivision application or internal layout task',
  portal: '/planner/studio/:layer/:fid',
  steps: [
    'Open parcel in Studio.',
    'Draw roads/lots or Export DXF to AutoCAD/QGIS.',
    'Import edited DXF; reconcile lot IDs.',
    'Run validation; save project.',
    'Request survey pegging if required.',
  ],
  goesTo: [
    { from: 'Planner', to: 'Surveyor', why: 'Pegging', does: 'Field set-out' },
    { from: 'Planner', to: 'GIS Officer', why: 'Cadastre publish', does: 'Stands/layers update' },
    { from: 'Planner', to: 'Committee → EO', why: 'Approval', does: 'Decision' },
  ],
  documents: ['planning_project', 'DXF', 'validation report'],
  outcomes: ['Layout saved', 'Returned for redesign'],
  exceptions: ['Validation fail → cannot recommend approval'],
}))

children.push(...journey({
  id: 'UC-P4',
  title: 'Recommend to committee and prepare decision package',
  actor: 'Planner',
  goal: 'Move case to a lawful determination.',
  trigger: 'Circulation + notice complete',
  portal: '/planner + committee agenda tools',
  steps: [
    'Write recommendation (approve / conditions / refuse).',
    'Attach map evidence and specialist findings.',
    'Schedule / attach agenda item with Clerk/EO schedulers.',
    'Await resolution; support EO decision package.',
  ],
  goesTo: [
    { from: 'Planner', to: 'Committee', why: 'Resolution', does: 'Quorum + vote/resolution record' },
    { from: 'Committee', to: 'Executive Officer', why: 'Determination', does: 'eo-decision endpoint' },
    { from: 'EO', to: 'Clerk', why: 'Dispatch', does: 'Citizen outcome' },
  ],
  documents: ['Recommendation', 'Agenda item', 'Decision package'],
  outcomes: ['Ready for EO', 'Deferred'],
  exceptions: ['No resolution / no quorum → EO decision blocked by server gates'],
}))

children.push(...journey({
  id: 'UC-P5',
  title: 'Use Planning Assistant (“what can be developed here?”)',
  actor: 'Planner',
  goal: 'Decision support from zone controls and templates.',
  trigger: 'Site enquiry or early assessment',
  portal: '/planner assistant tools',
  steps: [
    'Select site / stand.',
    'Run suggest / site context.',
    'Review permitted uses and controls.',
    'Record advice; do not treat as final approval.',
  ],
  goesTo: [
    { from: 'Planner (tool)', to: 'Planner (human)', why: 'Advice only', does: 'Still requires formal application chain for legal effect' },
  ],
  documents: ['Optional briefing notes'],
  outcomes: ['Guidance captured'],
  exceptions: ['Assistant unavailable → use zone matrix manually'],
}))

children.push(pageBreak())

// ══════════════════════════════════════════════════════════════════════
// 6. EO
// ══════════════════════════════════════════════════════════════════════
children.push(
  h1('6. Executive Officer (EO) — use cases'),
  p('Portal: /eo-planner-portal. You make the statutory determination.'),
)

children.push(...journey({
  id: 'UC-E1',
  title: 'Make a statutory determination on a permit',
  actor: 'Executive Officer',
  goal: 'Approve, approve with conditions, or refuse lawfully.',
  trigger: 'Decision package ready; committee resolution present (or delegated override audited)',
  portal: 'Decision Review / EO decision',
  steps: [
    'Open case decision package.',
    'Confirm committee resolution / quorum satisfied.',
    'Review Planner recommendation and objections.',
    'Record decision and conditions.',
    'Return to Clerk for dispatch.',
  ],
  goesTo: [
    { from: 'Planner / Committee', to: 'EO', why: 'Decision', does: 'UC-E1' },
    { from: 'EO', to: 'Planning Clerk', why: 'Dispatch', does: 'Issue documents' },
    { from: 'EO', to: 'Citizen', why: 'Notify', does: 'Outcome message' },
  ],
  documents: ['EO decision record', 'Conditions schedule'],
  outcomes: ['Approved', 'Approved with conditions', 'Refused'],
  exceptions: [
    'committee_resolution_required → cannot decide',
    'quorum_not_met → fix attendance first',
  ],
}))

children.push(...journey({
  id: 'UC-E2',
  title: 'Oversee due diligence and technical circulation',
  actor: 'EO',
  goal: 'Ensure quality of packages before determination.',
  trigger: 'Complex or high-impact cases',
  portal: 'Due Diligence / Technical Circulation sections',
  steps: [
    'Review outstanding consultations.',
    'Direct Planner to obtain missing specialist input.',
    'Confirm map evidence attached.',
  ],
  goesTo: [
    { from: 'EO', to: 'Planner', why: 'Quality gate', does: 'Complete package' },
    { from: 'EO', to: 'Specialists', why: 'Escalation', does: 'Priority response' },
  ],
  documents: ['Oversight notes'],
  outcomes: ['Package cleared for decision'],
  exceptions: ['Persistent gaps → defer'],
}))

children.push(...journey({
  id: 'UC-E3',
  title: 'Raise or endorse enforcement',
  actor: 'EO (with Inspector)',
  goal: 'Stop unlawful development.',
  trigger: 'Reported illegal building / non-compliance',
  portal: 'EO portal + Inspector enforcement',
  steps: [
    'Review Inspector report / photos.',
    'Endorse enforcement / prohibition order.',
    'Clerk files; citizen served.',
  ],
  goesTo: [
    { from: 'Building Inspector', to: 'EO', why: 'Authority', does: 'Endorse' },
    { from: 'EO', to: 'Clerk', why: 'Record', does: 'Enforcement file' },
    { from: 'Clerk', to: 'Citizen', why: 'Service', does: 'Comply or face escalation' },
  ],
  documents: ['Enforcement order', 'Prohibition order'],
  outcomes: ['Compliance', 'Further legal escalation (outside system)'],
  exceptions: ['Emergency stop-work → Inspector acts then EO endorses'],
}))

children.push(pageBreak())

// ══════════════════════════════════════════════════════════════════════
// 7. ENV OFFICER
// ══════════════════════════════════════════════════════════════════════
children.push(
  h1('7. Environmental Officer — use cases'),
  p('Portal: /env-officer-workspace'),
)

children.push(...journey({
  id: 'UC-V1',
  title: 'Appraise a circulated development plan',
  actor: 'Environmental Officer',
  goal: 'Advise on environmental acceptability.',
  trigger: 'Planner creates consultation',
  portal: 'Plan Appraisal section',
  steps: [
    'Open consultation task.',
    'Review plans and site context on map.',
    'Record response (clear / conditions / object).',
    'Return to Planner.',
  ],
  goesTo: [
    { from: 'Planner', to: 'Environmental Officer', why: 'Consultation', does: 'UC-V1' },
    { from: 'Environmental Officer', to: 'Planner', why: 'Response', does: 'Included in recommendation' },
  ],
  documents: ['Consultation response'],
  outcomes: ['Cleared', 'Cleared with conditions', 'Not supported'],
  exceptions: ['Insufficient info → request more via Planner/Clerk'],
}))

children.push(...journey({
  id: 'UC-V2',
  title: 'Environmental inspection / surveillance',
  actor: 'Environmental Officer',
  goal: 'Monitor ongoing compliance and complaints.',
  trigger: 'Scheduled inspection or citizen/staff report',
  portal: 'Inspections / Surveillance sections',
  steps: [
    'Schedule site visit.',
    'Record findings and photos.',
    'Escalate serious breaches to EO / Inspector.',
  ],
  goesTo: [
    { from: 'Env Officer', to: 'EO / Building Inspector', why: 'Breach', does: 'Enforcement path' },
    { from: 'Env Officer', to: 'Planner', why: 'Live case impact', does: 'Update recommendation if pending' },
  ],
  documents: ['Inspection notes', 'Certificates where applicable'],
  outcomes: ['Compliant', 'Non-compliant → enforcement'],
  exceptions: ['Access denied → record and escalate'],
}))

children.push(pageBreak())

// ══════════════════════════════════════════════════════════════════════
// 8. SURVEYOR
// ══════════════════════════════════════════════════════════════════════
children.push(
  h1('8. Surveyor — use cases'),
  p('Portals: /surveyor , /surveyor-workspace'),
)

children.push(...journey({
  id: 'UC-S1',
  title: 'Execute an assigned survey task',
  actor: 'Surveyor',
  goal: 'Deliver ground truth for a planning case.',
  trigger: 'Planner/EO/Clerk assigns survey job',
  portal: '/surveyor-workspace',
  steps: [
    'Accept job; review site briefing.',
    'Capture control points, beacons, coordinates.',
    'Compute traverse/areas as required.',
    'Produce Report on Survey / GeoPDF / DXF.',
    'Submit findings to Planner.',
  ],
  goesTo: [
    { from: 'Planner (assigner)', to: 'Surveyor', why: 'Field work', does: 'UC-S1' },
    { from: 'Surveyor', to: 'Planner', why: 'Findings', does: 'Accept / return / cancel' },
    { from: 'Accepted findings', to: 'Case + GIS', why: 'Geometry', does: 'Feeds decision and cadastre' },
  ],
  documents: ['Survey project', 'Beacons', 'Report on Survey', 'Diagrams'],
  outcomes: ['Accepted', 'Returned for correction', 'Cancelled'],
  exceptions: ['Site inaccessible → report blockage to assigner'],
}))

children.push(...journey({
  id: 'UC-S2',
  title: 'Support subdivision pegging after Studio layout',
  actor: 'Surveyor',
  goal: 'Mark approved lots on the ground.',
  trigger: 'Approved or pending layout needs pegs',
  portal: '/surveyor-workspace',
  steps: [
    'Import/layout coordinates from planning project.',
    'Set beacons in field.',
    'Return as-built / confirmation to Planner/GIS.',
  ],
  goesTo: [
    { from: 'Planner', to: 'Surveyor', why: 'Pegging', does: 'Field set-out' },
    { from: 'Surveyor', to: 'GIS Officer', why: 'Update', does: 'Confirm geometry in PostGIS' },
  ],
  documents: ['Pegging report', 'Updated coordinates'],
  outcomes: ['Pegged and confirmed'],
  exceptions: ['Conflict with occupation → escalate to Planner/EO'],
}))

children.push(pageBreak())

// ══════════════════════════════════════════════════════════════════════
// 9. GIS OFFICER
// ══════════════════════════════════════════════════════════════════════
children.push(
  h1('9. GIS Officer — use cases'),
  p('Portal: /gis-officer-portal  ·  /gis-map  ·  /admin/gis-symbology'),
)

children.push(...journey({
  id: 'UC-G1',
  title: 'Confirm zoning / constraints for a live case',
  actor: 'GIS Officer',
  goal: 'Give Planner authoritative spatial facts.',
  trigger: 'Planner consultation or map conflict',
  portal: '/gis-map + portal sections',
  steps: [
    'Locate stand on Spatial Intelligence Map.',
    'Check zones_master, constraints, abutting owners.',
    'Respond on consultation / case note.',
  ],
  goesTo: [
    { from: 'Planner', to: 'GIS Officer', why: 'Spatial truth', does: 'UC-G1' },
    { from: 'GIS Officer', to: 'Planner', why: 'Answer', does: 'Proceed with recommendation' },
  ],
  documents: ['Map evidence', 'Consultation response'],
  outcomes: ['Confirmed', 'Conflict flagged'],
  exceptions: ['Corrupt geometry → repair with QGIS/PostGIS'],
}))

children.push(...journey({
  id: 'UC-G2',
  title: 'Edit stands / zoning layers (cadastre hygiene)',
  actor: 'GIS Officer',
  goal: 'Keep PostGIS layers correct for everyone.',
  trigger: 'Survey acceptance, subdivision approval, error report',
  portal: 'Stands Editor / Zoning Maps / Spatial Database',
  steps: [
    'Edit in web tools or QGIS Desktop against PostGIS.',
    'Save; spatial_change notifies web maps.',
    'Verify web + QGIS Server render correctly.',
  ],
  goesTo: [
    { from: 'Surveyor / Planner', to: 'GIS Officer', why: 'Publish geometry', does: 'UC-G2' },
    { from: 'GIS Officer', to: 'All map users', why: 'Live sync', does: 'SEE refresh / tile invalidation' },
  ],
  documents: ['Updated PostGIS features', 'Audit of edits'],
  outcomes: ['Layers current'],
  exceptions: ['Bad edit → rollback via DB/QGIS backup procedures'],
}))

children.push(...journey({
  id: 'UC-G3',
  title: 'Govern symbology (one colour = one meaning)',
  actor: 'GIS Officer (Admin assists)',
  goal: 'Publish one production style per layer for web + QGIS.',
  trigger: 'Cartography change needed',
  portal: '/admin/gis-symbology',
  steps: [
    'Create draft style version from QGIS or statutory schedule.',
    'Submit for review/approval.',
    'Publish (previous published becomes deprecated).',
    'Confirm MapLibre / WMS use new version.',
  ],
  goesTo: [
    { from: 'GIS Officer', to: 'Approver (role policy)', why: 'Governance', does: 'Approve' },
    { from: 'Publisher', to: 'Web + QGIS Server + Desktop', why: 'Single source', does: 'Compile from published definition' },
  ],
  documents: ['gis_style versions', 'gis_style_audit'],
  outcomes: ['Published', 'Rejected', 'Rolled back by publishing older version'],
  exceptions: ['Published styles are immutable — never edit in place'],
}))

children.push(...journey({
  id: 'UC-G4',
  title: 'Open Property File / Report Builder for analysis',
  actor: 'GIS Officer / other council staff',
  goal: 'Inspect land dossier or build ad-hoc reports.',
  trigger: 'Enquiry or management request',
  portal: '/property/:standNo  /report-builder',
  steps: [
    'Search stand number.',
    'Review owners, zoning, uses, lineage.',
    'Build report filters over permit register as needed.',
  ],
  goesTo: [
    { from: 'Staff', to: 'Property File', why: 'Read PII carefully', does: 'Support Planner/Clerk decisions' },
  ],
  documents: ['Generated reports'],
  outcomes: ['Answered enquiry'],
  exceptions: ['No access for pure citizens — staff only'],
}))

children.push(pageBreak())

// ══════════════════════════════════════════════════════════════════════
// 10. BUILDING INSPECTOR
// ══════════════════════════════════════════════════════════════════════
children.push(
  h1('10. Building Inspector — use cases'),
  p('Portal: /inspector-workspace'),
)

children.push(...journey({
  id: 'UC-I1',
  title: 'Run a stage inspection (DM Handbook stages 1–8)',
  actor: 'Building Inspector',
  goal: 'Pass or fail a construction stage with evidence.',
  trigger: 'Citizen booked + paid; job scheduled',
  portal: 'Stage Inspections section',
  steps: [
    'Open waitlisted/scheduled booking.',
    'Visit site; complete checklist.',
    'Attach photos.',
    'Mark pass or fail with notes.',
    'Citizen notified; next stage unlocks if passed.',
  ],
  goesTo: [
    { from: 'Citizen (book+pay)', to: 'Building Inspector', why: 'Inspection', does: 'UC-I1' },
    { from: 'Inspector', to: 'Citizen', why: 'Result', does: 'Pass → continue; Fail → remediate & rebook' },
    { from: 'Inspector', to: 'Case timeline', why: 'Audit', does: 'Status events stored' },
  ],
  documents: ['inspection_bookings', 'photos', 'status events'],
  outcomes: ['Passed', 'Failed', 'Cancelled/rescheduled'],
  exceptions: ['Fee not paid → remains pending_payment'],
}))

children.push(...journey({
  id: 'UC-I2',
  title: 'Issue Certificate of Occupation (stage 9)',
  actor: 'Building Inspector',
  goal: 'Certify lawful occupation.',
  trigger: 'Stages 1–8 all passed',
  portal: 'Certificates section',
  steps: [
    'Confirm all prior stages passed (system enforces).',
    'Final inspection complete.',
    'Issue occupation certificate.',
    'Case moves toward closed / occupation_issued.',
  ],
  goesTo: [
    { from: 'Inspector', to: 'Citizen', why: 'Certificate', does: 'Receive occupation certificate' },
    { from: 'Inspector', to: 'Clerk register', why: 'Close loop', does: 'Record completion' },
  ],
  documents: ['Occupation certificate'],
  outcomes: ['Issued'],
  exceptions: ['Any prior stage not passed → server blocks issuance'],
}))

children.push(...journey({
  id: 'UC-I3',
  title: 'Raise enforcement from the field',
  actor: 'Building Inspector',
  goal: 'Stop illegal works.',
  trigger: 'Unpermitted building observed',
  portal: 'Enforcement section',
  steps: [
    'Create enforcement action with stand, description, deadline.',
    'Attach photos.',
    'Route for EO endorsement if required.',
    'Clerk files; follow compliance checks.',
  ],
  goesTo: [
    { from: 'Inspector', to: 'EO', why: 'Authority', does: 'Endorse' },
    { from: 'Inspector / EO', to: 'Clerk', why: 'Record', does: 'Enforcement file' },
    { from: 'Clerk', to: 'Citizen / offender', why: 'Service', does: 'Comply' },
  ],
  documents: ['Enforcement order', 'Compliance checks'],
  outcomes: ['Complied', 'Escalated'],
  exceptions: ['Immediate danger → stop-work then paperwork'],
}))

children.push(pageBreak())

// ══════════════════════════════════════════════════════════════════════
// 11. ADMIN
// ══════════════════════════════════════════════════════════════════════
children.push(
  h1('11. IT Admin — use cases'),
  p('Portal: /admin/*  ·  Admin is NOT a planning decision-maker.'),
)

children.push(...journey({
  id: 'UC-A1',
  title: 'Invite a new staff member',
  actor: 'Admin',
  goal: 'Create employee accounts with correct roles.',
  trigger: 'HR / HOA request for access',
  portal: '/admin users & invites',
  steps: [
    'Create invite with role (planner, clerk, eo, …), department, job title.',
    'User accepts invite link; sets password.',
    'Verify they land on the correct portal.',
  ],
  goesTo: [
    { from: 'Admin', to: 'Invitee email', why: 'Onboarding', does: 'Accept invite' },
    { from: 'Invitee', to: 'Their role portal', why: 'Work', does: 'Start role use cases' },
  ],
  documents: ['Invite record', 'user row'],
  outcomes: ['Active staff user'],
  exceptions: ['Expired invite → re-issue'],
}))

children.push(...journey({
  id: 'UC-A2',
  title: 'Suspend / reset password / remove user',
  actor: 'Admin',
  goal: 'Protect the system when staff leave or credentials leak.',
  trigger: 'Security or HR event',
  portal: '/admin/users',
  steps: [
    'Locate user.',
    'Suspend or reset password or delete per policy.',
    'Sessions revoke on next request.',
  ],
  goesTo: [
    { from: 'Admin', to: 'User sessions', why: 'Immediate effect', does: 'Authenticate fails if suspended' },
  ],
  documents: ['Audit log entries'],
  outcomes: ['Access removed'],
  exceptions: ['Do not use Admin to alter planning decisions'],
}))

children.push(...journey({
  id: 'UC-A3',
  title: 'Edit public site content',
  actor: 'Admin',
  goal: 'Keep About / services / committee text current.',
  trigger: 'Communications update',
  portal: '/admin/content',
  steps: [
    'Edit slug content.',
    'Save; verify on public pages.',
  ],
  goesTo: [
    { from: 'Admin', to: 'Public visitors', why: 'Published content', does: 'Read updated pages' },
  ],
  documents: ['site_content rows'],
  outcomes: ['Content live'],
  exceptions: ['Wrong slug → page missing'],
}))

children.push(...journey({
  id: 'UC-A4',
  title: 'Support QGIS plugin / symbology admin tools',
  actor: 'Admin with GIS Officer',
  goal: 'Keep desktop bridge and style registry healthy.',
  trigger: 'Plugin install or style publish support',
  portal: '/admin/qgis-plugin  /admin/gis-symbology',
  steps: [
    'Issue API tokens where policy allows.',
    'Assist GIS Officer with publish rights.',
    'Monitor health endpoints.',
  ],
  goesTo: [
    { from: 'Admin', to: 'GIS Officer', why: 'Enable work', does: 'UC-G2/G3' },
  ],
  documents: ['API tokens', 'style audit'],
  outcomes: ['Bridge operational'],
  exceptions: ['Leaked API token → revoke immediately'],
}))

children.push(pageBreak())

// ══════════════════════════════════════════════════════════════════════
// 12. CROSS-CUTTING
// ══════════════════════════════════════════════════════════════════════
children.push(
  h1('12. Cross-cutting & special journeys'),
)

children.push(...journey({
  id: 'UC-X1',
  title: 'Committee meeting with quorum and resolution',
  actor: 'Planner / Clerk / EO (schedulers) + Committee members',
  goal: 'Create a lawful resolution that unlocks EO decision.',
  trigger: 'Case ready for determination',
  portal: 'Committee meetings / agenda (development-management)',
  steps: [
    'Schedule meeting; set quorum.',
    'Attach agenda items (cases).',
    'Record attendance (present_count).',
    'Record resolution text.',
    'EO proceeds only if gates pass.',
  ],
  goesTo: [
    { from: 'Scheduler', to: 'Committee members', why: 'Meeting', does: 'Attend' },
    { from: 'Committee', to: 'EO', why: 'Resolution', does: 'Decide case' },
  ],
  documents: ['Meeting', 'Attendance', 'Agenda', 'Resolution'],
  outcomes: ['Resolution recorded', 'Quorum failed'],
  exceptions: ['present_count < quorum → 409 quorum_not_met'],
}))

children.push(...journey({
  id: 'UC-X2',
  title: 'Deeds Registry simulation (Ministry of Lands dashboard)',
  actor: 'Staff (admin, planner, clerk, eo, gis_officer)',
  goal: 'See incoming deed checks and manage demo deeds in UAT.',
  trigger: 'Citizen runs deed-check OR staff opens simulation',
  portal: '/mock/ministry-lands',
  steps: [
    'Open dashboard.',
    'Review checks log (who looked up which deed).',
    'Add/search deeds for training scenarios.',
  ],
  goesTo: [
    { from: 'Citizen deed-check', to: 'Ministry simulation + log', why: 'Traceability', does: 'Staff can audit lookups' },
    { from: 'In production', to: 'Real Ministry API', why: 'Replace mock', does: 'Same citizen UX, real data' },
  ],
  documents: ['lands_registry_deeds', 'lands_registry_checks'],
  outcomes: ['Training visibility'],
  exceptions: ['Not for live legal title — simulation only'],
}))

children.push(...journey({
  id: 'UC-X3',
  title: 'End-to-end: buy land THEN build (combined life story)',
  actor: 'Citizen progressing from allocation to occupation',
  goal: 'Show the full multi-month journey across offices.',
  trigger: 'Successful UC-C1 then UC-C3',
  portal: 'Entire platform',
  steps: [
    'UC-C0 residency.',
    'UC-C1 land allocation through Clerk→Planner→(specialists)→Committee→EO→Clerk.',
    'Accept offer; pay balance.',
    'UC-C3 development permit through same statutory offices.',
    'UC-I1 stages 1–8 inspections.',
    'UC-I2 occupation certificate.',
    'Property File shows lineage: allocation → permit → occupation.',
  ],
  goesTo: [
    { from: 'Citizen', to: 'All offices in sequence', why: 'Full lifecycle', does: 'See §2 master diagram' },
  ],
  documents: ['Entire case file history'],
  outcomes: ['Lawful occupation of allocated stand'],
  exceptions: ['Any refusal mid-chain stops forward progress until resolved'],
}))

children.push(pageBreak())

// ══════════════════════════════════════════════════════════════════════
// 13. MATRIX
// ══════════════════════════════════════════════════════════════════════
children.push(
  h1('13. Quick matrix — “If I want X, I go to Y”'),
  table(
    ['I want to…', 'I start as…', 'First office / screen', 'Then goes to…'],
    [
      ['Buy / get a stand', 'Citizen', 'Map + /citizen new app', 'Clerk → Planner → (GIS/Survey/Env) → Committee → EO → Clerk'],
      ['Prove I live here', 'Citizen', '/residency', 'Deeds Registry and/or Clerk verify queue'],
      ['Subdivide my land', 'Landowner', '/citizen + Planner Studio', 'Clerk → Planner → Surveyor → GIS → Committee → EO'],
      ['Build a house', 'Landowner', '/citizen development app', 'Clerk → Planner → specialists → notice → Committee → EO → Inspector stages'],
      ['Change land use', 'Landowner', '/citizen', 'Clerk → Planner → notice → Committee → EO → GIS update'],
      ['Pay fees', 'Citizen', '/payments', 'Gateway → Clerk ledger → unblocks case'],
      ['Object to a notice', 'Neighbour', 'Public notice', 'Clerk → Planner → Committee → EO'],
      ['Get occupation certificate', 'Citizen builder', 'Book final stages', 'Building Inspector (after 1–8 pass)'],
      ['Stop illegal building', 'Inspector/EO', 'Enforcement', 'EO endorse → Clerk file → citizen'],
      ['Fix the map colours', 'GIS Officer', 'Symbology registry', 'Approve → publish → web+QGIS'],
      ['Add a new planner', 'Admin', '/admin invite', 'Invitee accepts → /planner'],
      ['See who holds my file', 'Citizen', 'Application Pipeline', '(read-only mirror of offices)'],
    ],
    [2400, 1600, 2400, 2960],
  ),
  pageBreak(),
)

// ══════════════════════════════════════════════════════════════════════
// 14. INSPECTION STAGES APPENDIX
// ══════════════════════════════════════════════════════════════════════
children.push(
  h1('14. Appendix A — Building inspection stages (who/when)'),
  p('Source: DM Handbook 2021 v1.2 Annexure 12 (as implemented). Citizen books/pays; Building Inspector schedules and completes.'),
  table(
    ['Stage', 'Name', 'Citizen does', 'Goes to'],
    [
      ['1', 'Setting out', 'Book + pay', 'Building Inspector'],
      ['2', 'Foundation trenches & footing levels', 'Book + pay after stage 1 pass', 'Building Inspector'],
      ['3', 'Foundation brickwork to floor level', 'Book + pay', 'Building Inspector'],
      ['4', 'Brickwork and window level', 'Book + pay', 'Building Inspector'],
      ['5', 'Brickwork to wall plate', 'Book + pay', 'Building Inspector'],
      ['6', 'Roof trusses', 'Book + pay', 'Building Inspector'],
      ['7', 'Drainage / sewerage work', 'Book + pay', 'Building Inspector'],
      ['8', 'Final inspection', 'Book + pay', 'Building Inspector'],
      ['9', 'Certificate of occupation', 'Request when 1–8 passed', 'Building Inspector → Citizen (+ Clerk record)'],
    ],
    [900, 3200, 2600, 2660],
  ),
  pageBreak(),
)

// ══════════════════════════════════════════════════════════════════════
// 15. STATUS VOCABULARY
// ══════════════════════════════════════════════════════════════════════
children.push(
  h1('15. Appendix B — Status vocabulary (what citizens see)'),
  table(
    ['Pipeline idea', 'Meaning', 'Typical holder'],
    [
      ['submitted', 'Just lodged', 'Planning Clerk'],
      ['acknowledged / registered', 'Receipted; clock may start', 'Planner'],
      ['circulation', 'Specialists commenting', 'Env / Survey / GIS / BI'],
      ['objection_period', 'Public notice open', 'Clerk + public'],
      ['under_review', 'Assessment / recommendation', 'Planner'],
      ['deferred', 'Waiting for info / meeting', 'Citizen or Committee'],
      ['approved / conditions / refused', 'EO decided', 'Clerk dispatch → Citizen'],
      ['pending_payment', 'Money blocking progress', 'Citizen → Payments'],
      ['inspection stages', 'Construction control', 'Building Inspector'],
      ['occupation_issued', 'Complete', 'Closed register'],
    ],
    [2600, 3400, 3360],
  ),
  pageBreak(),
)

children.push(
  h1('16. Closing note'),
  p('This catalogue is written from the product’s enforced routing (roles, portals, Application Pipeline, development-management and residency flows). Where a municipal process also involves paper or external ministries (e.g. real Deeds Registry beyond the simulation), the online system still shows which Vungu office owns the next action.'),
  p('For screen-by-screen button instructions, see SpartialIQ_User_Manual.docx. For code-level traces, see COUNCIL_OPERATIONS_FLOW.md and USE_CASES.md.'),
  p('— End of Complete Use-Case Catalogue —', { align: AlignmentType.CENTER, italics: true, color: '64748B', before: 400 }),
)

const doc = new Document({
  creator: 'SpartialIQ',
  title: 'SpartialIQ Complete Use-Case Catalogue — Vungu RDC',
  description: 'Every user journey with office-to-office routing',
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
      {
        reference: 'steps',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
    ],
  },
  sections: [{
    properties: { page: { margin: { top: 850, bottom: 850, left: 850, right: 850 } } },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'Vungu RDC · SpartialIQ Complete Use Cases', font: 'Calibri', size: 15, color: '94A3B8' })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: 'Page ', font: 'Calibri', size: 15, color: '94A3B8' }),
            new TextRun({ children: [PageNumber.CURRENT], font: 'Calibri', size: 15, color: '94A3B8' }),
            new TextRun({ text: ' of ', font: 'Calibri', size: 15, color: '94A3B8' }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Calibri', size: 15, color: '94A3B8' }),
          ],
        })],
      }),
    },
    children,
  }],
})

mkdirSync(dirname(OUT), { recursive: true })
const buffer = await Packer.toBuffer(doc)
writeFileSync(OUT, buffer)
console.log('Wrote', OUT)
console.log('Bytes', buffer.length)
