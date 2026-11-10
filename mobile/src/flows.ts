export type Audience = 'everyone' | string[]

export type Field = {
  key: string
  label: string
  placeholder?: string
  default?: string
}

export type FlowForm = {
  legend: string
  roles: Audience
  fields: Field[]
  needsRow?: boolean
  submit: (values: Record<string, string>, row: Record<string, unknown> | null) => {
    method: 'POST' | 'PATCH'
    path: string
    body: Record<string, unknown>
  }
}

export type Flow = {
  id: string
  group: string
  title: string
  about: string
  roles: Audience
  list: (role: string) => string
  form?: FlowForm
}

const PLAN = ['admin', 'planner', 'eo', 'planning_clerk']
const FIELD = ['admin', 'planner', 'eo', 'building_inspector', 'planning_clerk', 'env_officer']
const GIS = ['admin', 'gis_officer', 'gis_head', 'gis_data', 'gis_dev', 'gis_analyst', 'gis_tech', 'gis_clerk']
const SURVEY = ['admin', 'surveyor', 'planner', 'eo', 'planning_clerk']
const CUSTODIAN = ['admin', 'planner', 'planning_clerk', 'eo', 'gis_officer', 'surveyor']
const CUSTODIAN_WRITE = ['admin', 'planner', 'planning_clerk', 'eo', 'gis_officer']
const EHO = ['admin', 'env_officer', 'eo']
const CLERK = ['admin', 'planning_clerk', 'planner', 'eo']

export const DEMO_ACCOUNTS: { label: string; email: string }[] = [
  { label: 'Citizen', email: 'demo.viewer@vungu.test' },
  { label: 'Planner', email: 'demo.planner@vungu.test' },
  { label: 'Officer', email: 'demo.eo@vungu.test' },
  { label: 'Clerk', email: 'demo.clerk@vungu.test' },
  { label: 'Inspector', email: 'demo.inspector@vungu.test' },
  { label: 'Environment', email: 'demo.envoffice@vungu.test' },
  { label: 'Surveyor', email: 'demo.surveyor@vungu.test' },
  { label: 'GIS', email: 'demo.gis@vungu.test' },
  { label: 'Admin', email: 'demo.admin@vungu.test' },
]

export const FLOWS: Flow[] = [
  {
    id: 'C1', group: 'Public and citizen', title: 'Find land',
    about: 'Stands the council is offering. Search starts from the stand number and ward.',
    roles: 'everyone', list: () => '/api/available-stands',
  },
  {
    id: 'C2', group: 'Public and citizen', title: 'What can I build here',
    about: 'Zoning at a point in the high-density residential area. The matrix is the working local fill, not a gazetted resolution.',
    roles: 'everyone',
    list: () => '/api/development-control/zoning-at?lng=29.73029&lat=-19.48663',
  },
  {
    id: 'C3', group: 'Public and citizen', title: 'Council zones',
    about: 'The zone polygons published for Vungu.',
    roles: 'everyone', list: () => '/api/development-control/zones',
  },
  {
    id: 'C4', group: 'Public and citizen', title: 'Residency',
    about: 'Whether this account is verified to deal with the council, and which proof it used.',
    roles: 'everyone', list: () => '/api/residency/status',
  },
  {
    id: 'C5', group: 'Public and citizen', title: 'Lodge a development application',
    about: 'Form TPD.1. A registered file is opened on the stand you name.',
    roles: 'everyone', list: () => '/api/permit-applications',
    form: {
      legend: 'New application',
      roles: ['admin', 'planner', 'planning_clerk', 'viewer', 'public', 'registered'],
      fields: [
        { key: 'applicant_name', label: 'Applicant name', placeholder: 'Full name' },
        { key: 'stand_number', label: 'Stand number', placeholder: 'HDR-001' },
        { key: 'development_type', label: 'Type', default: 'new_building', placeholder: 'new_building, alteration, extension, subdivision…' },
        { key: 'description', label: 'What is proposed', placeholder: 'House, shop, wall…' },
      ],
      submit: (v) => ({
        method: 'POST', path: '/api/permit-applications',
        body: {
          applicant_name: v.applicant_name, stand_number: v.stand_number,
          development_type: v.development_type || 'new_building', description: v.description,
        },
      }),
    },
  },
  {
    id: 'C6', group: 'Public and citizen', title: 'Pay council fees',
    about: 'Quotes and receipts already on your account.',
    roles: 'everyone', list: () => '/api/payments',
  },
  {
    id: 'C7', group: 'Public and citizen', title: 'Track an application',
    about: 'Status, stand and type for every file you can see.',
    roles: 'everyone', list: () => '/api/permit-applications',
  },
  {
    id: 'C8', group: 'Public and citizen', title: 'Public notices and objections',
    about: 'Notices whose objection period is still open. Select one and write the grounds.',
    roles: 'everyone', list: () => '/api/public-notices',
    form: {
      legend: 'Lodge an objection',
      roles: 'everyone', needsRow: true,
      fields: [{ key: 'grounds_detail', label: 'Grounds', placeholder: 'Why you object' }],
      submit: (v, row) => ({
        method: 'POST',
        path: `/api/public-notices/${row?.permit_app_id}/objections`,
        body: { grounds_detail: v.grounds_detail },
      }),
    },
  },
  {
    id: 'C9', group: 'Public and citizen', title: 'Appeals',
    about: 'Appeals against a planning determination. Staff see the register. You see your own.',
    roles: 'everyone', list: () => '/api/appeals',
  },
  {
    id: 'C10', group: 'Public and citizen', title: 'Stage inspections',
    about: 'The inspection stages a builder can ask for. Inspectors open their queue from Field enforcement.',
    roles: 'everyone', list: () => '/api/inspection-stages',
  },
  {
    id: 'C11', group: 'Public and citizen', title: 'Certificates',
    about: 'Occupation and permit certificates sit on the application file. This is the file list.',
    roles: 'everyone', list: () => '/api/permit-applications',
  },
  {
    id: 'C12', group: 'Public and citizen', title: 'Report unauthorised building',
    about: 'A report of work without a permit, a dangerous structure, or occupation without a certificate.',
    roles: 'everyone',
    list: (role) => (
      ['admin', 'planner', 'planning_clerk', 'building_inspector', 'eo', 'env_officer', 'surveyor', 'gis_officer'].includes(role)
        ? '/api/building-complaints' : ''
    ),
    form: {
      legend: 'New report',
      roles: ['admin', 'planner', 'planning_clerk', 'building_inspector', 'eo', 'env_officer', 'viewer', 'public', 'registered'],
      fields: [
        { key: 'stand_number', label: 'Stand number', placeholder: 'HDR-004' },
        { key: 'category', label: 'Category', default: 'building_without_permit' },
        { key: 'description', label: 'What you saw', placeholder: 'Work underway, no permit board' },
      ],
      submit: (v) => ({
        method: 'POST', path: '/api/building-complaints',
        body: {
          stand_number: v.stand_number, category: v.category || 'building_without_permit',
          description: v.description, severity: 'routine',
        },
      }),
    },
  },
  {
    id: 'C13', group: 'Public and citizen', title: 'Service desk',
    about: 'Rates, a trading licence request, a nuisance, road works, social welfare, or a survey request.',
    roles: 'everyone',
    list: (role) => (role === 'viewer' || role === 'public' || role === 'registered' ? '/api/service-desk/tickets/mine' : '/api/service-desk/tickets'),
    form: {
      legend: 'New request', roles: 'everyone',
      fields: [
        { key: 'service_id', label: 'Counter', default: 'rates-enquiry', placeholder: 'rates-enquiry, trading-licence, nuisance, road-works, social-welfare, survey-request' },
        { key: 'department', label: 'Department', default: 'Finance' },
        { key: 'title', label: 'Subject', placeholder: 'Rates balance on my stand' },
        { key: 'details', label: 'Details', placeholder: 'What you need the council to do' },
      ],
      submit: (v) => ({
        method: 'POST', path: '/api/service-desk/tickets',
        body: { service_id: v.service_id, department: v.department, title: v.title, details: v.details },
      }),
    },
  },
  {
    id: 'C14', group: 'Public and citizen', title: 'Section 73 notice served on you',
    about: 'A notice under the Rural District Councils Act. Mark it seen. An appeal goes to the Administrative Court. Staff record the outcome.',
    roles: 'everyone',
    list: (role) => (PLAN.includes(role) || role === 'building_inspector' ? '/api/title-notices' : '/api/title-notices/mine'),
    form: {
      legend: 'I have seen this notice', roles: 'everyone', needsRow: true, fields: [],
      submit: (_v, row) => ({ method: 'POST', path: `/api/title-notices/${row?.id}/seen`, body: {} }),
    },
  },
  {
    id: 'C15', group: 'Public and citizen', title: 'Rates clearance',
    about: 'Ask for the section 109 certificate that charges are clear, so a transfer can go to the Deeds Registry.',
    roles: 'everyone',
    list: (role) => (PLAN.includes(role) ? '/api/registers/rates-clearances' : '/api/registers/rates-clearances/mine'),
    form: {
      legend: 'Request a clearance', roles: 'everyone',
      fields: [
        { key: 'stand_number', label: 'Stand number', placeholder: 'HDR-001' },
        { key: 'applicant_name', label: 'Applicant name' },
      ],
      submit: (v) => ({
        method: 'POST', path: '/api/registers/rates-clearances',
        body: { stand_number: v.stand_number, applicant_name: v.applicant_name },
      }),
    },
  },
  {
    id: 'P1', group: 'Planning', title: 'Receive and register',
    about: 'The clerk’s counter: files waiting, clocks, and what arrived today.',
    roles: CLERK, list: () => '/api/planning-clerk/overview',
  },
  {
    id: 'P2', group: 'Planning', title: 'Check the zoning matrix',
    about: 'Zones and the working permitted, consent and prohibited uses.',
    roles: PLAN, list: () => '/api/development-control/zones',
  },
  {
    id: 'P3', group: 'Planning', title: 'Circulate and consult',
    about: 'Applications on the register. Consultation is recorded on each file.',
    roles: PLAN, list: () => '/api/permit-applications?includePendingPayment=true',
  },
  {
    id: 'P4', group: 'Planning', title: 'Publish a public notice',
    about: 'Notices that are open for objection.',
    roles: PLAN, list: () => '/api/public-notices',
  },
  {
    id: 'P5', group: 'Planning', title: 'Committee',
    about: 'Meetings at which the council records a resolution.',
    roles: PLAN, list: () => '/api/committee-meetings',
  },
  {
    id: 'P6', group: 'Planning', title: 'Determine an application',
    about: 'The executive officer’s queue, ordered by the deemed-refusal date.',
    roles: PLAN, list: () => '/api/eo-planner/cases',
  },
  {
    id: 'P7', group: 'Planning', title: 'Issue a permit',
    about: 'Applications ready to carry a permit, a fee and the rule snapshot.',
    roles: PLAN, list: () => '/api/permit-applications',
  },
  {
    id: 'P8', group: 'Planning', title: 'Track an appeal',
    about: 'Appeals the planning office is holding.',
    roles: PLAN, list: () => '/api/appeals',
  },
  {
    id: 'P9', group: 'Planning', title: 'Statutory plans',
    about: 'Master, local and regional plans on the plan register.',
    roles: ['admin', 'planner', 'planning_clerk', 'eo', 'gis_officer'],
    list: () => '/api/statutory/plans',
  },
  {
    id: 'P10', group: 'Planning', title: 'Annual district plan',
    about: 'The plan the council prepares under section 74.',
    roles: PLAN, list: () => '/api/registers/annual-plans',
  },
  {
    id: 'F1', group: 'Field enforcement', title: 'Building complaints',
    about: 'Reports waiting to be triaged and visited.',
    roles: FIELD, list: () => '/api/building-complaints',
  },
  {
    id: 'F2', group: 'Field enforcement', title: 'Inspection queue',
    about: 'Stage inspections assigned to the inspector.',
    roles: ['admin', 'building_inspector'], list: () => '/api/inspector/queue',
  },
  {
    id: 'F3', group: 'Field enforcement', title: 'Enforcement orders',
    about: 'Stop-works and planning enforcement orders on the register.',
    roles: ['admin', 'planner', 'eo', 'building_inspector'], list: () => '/api/enforcement-orders',
  },
  {
    id: 'F4', group: 'Field enforcement', title: 'Section 73 notice',
    about: 'Draft a notice, then issue it. The database will not let the council act until the Act allows it.',
    roles: ['admin', 'planner', 'eo', 'building_inspector', 'planning_clerk'],
    list: () => '/api/title-notices',
    form: {
      legend: 'Draft a notice',
      roles: ['admin', 'planner', 'eo', 'building_inspector'],
      fields: [
        { key: 'stand_number', label: 'Stand', placeholder: 'HDR-004' },
        { key: 'condition_class', label: 'Class', default: 'use_restriction', placeholder: 'use_restriction, building_requirements, scheme_or_plan, other' },
        { key: 'proposed_action', label: 'Proposed action', default: 'prohibit_use', placeholder: 'prohibit_use, execute_work, demolish' },
        { key: 'condition_text', label: 'Condition', placeholder: 'Stop the use that breaches the scheme' },
        { key: 'grounds', label: 'Grounds', placeholder: 'Why the notice is served' },
      ],
      submit: (v) => ({
        method: 'POST', path: '/api/title-notices',
        body: {
          stand_number: v.stand_number, condition_class: v.condition_class || 'use_restriction',
          proposed_action: v.proposed_action || 'prohibit_use',
          condition_text: v.condition_text, grounds: v.grounds,
        },
      }),
    },
  },
  {
    id: 'F5', group: 'Field enforcement', title: 'Notice appeal',
    about: 'Select a notice that has already been served and record that an appeal was lodged at the Administrative Court.',
    roles: ['admin', 'planner', 'eo', 'planning_clerk', 'building_inspector'],
    list: () => '/api/title-notices',
    form: {
      legend: 'Record an appeal', roles: ['admin', 'planner', 'planning_clerk', 'eo', 'building_inspector'],
      needsRow: true,
      fields: [
        { key: 'lodged_at', label: 'Date lodged', placeholder: '2026-10-21' },
        { key: 'notes', label: 'Notes', placeholder: 'Court reference or what the owner said' },
      ],
      submit: (v, row) => ({
        method: 'POST', path: `/api/title-notices/${row?.id}/appeals`,
        body: { lodged_at: v.lodged_at, notes: v.notes },
      }),
    },
  },
  {
    id: 'F6', group: 'Field enforcement', title: 'Act on a notice',
    about: 'Select a notice whose stage is may act. The server refuses anything earlier.',
    roles: ['admin', 'planner', 'eo', 'building_inspector'],
    list: () => '/api/title-notices',
    form: {
      legend: 'Record the council’s action', roles: ['admin', 'planner', 'eo', 'building_inspector'],
      needsRow: true, fields: [],
      submit: (_v, row) => ({
        method: 'POST', path: `/api/title-notices/${row?.id}/actions`,
        body: { action: row?.proposed_action },
      }),
    },
  },
  {
    id: 'F7', group: 'Field enforcement', title: 'Recover expenses',
    about: 'Section 151 expense recovery after the council has done the work.',
    roles: PLAN, list: () => '/api/registers/expense-recoveries',
  },
  {
    id: 'F8', group: 'Field enforcement', title: 'Public health',
    about: 'Environmental health complaints, premises and the abatement work.',
    roles: EHO, list: () => '/api/eho/complaints',
  },
  {
    id: 'G1', group: 'GIS and the parcel register', title: 'Parcel register',
    about: 'Layout stands loaded into the land register, with ward and account band.',
    roles: GIS, list: () => '/api/parcels?township=LAYOUT&limit=40',
  },
  {
    id: 'G6', group: 'GIS and the parcel register', title: 'Accounts and reconciliation',
    about: 'The branch dashboard: parcels, accounts, and what still does not match.',
    roles: GIS, list: () => '/api/gms/dashboard',
  },
  {
    id: 'G8', group: 'GIS and the parcel register', title: 'Farm parcels',
    about: 'A page of the farm extract in the same register.',
    roles: GIS, list: () => '/api/parcels?township=VUNGU&limit=40',
  },
  {
    id: 'G10', group: 'GIS and the parcel register', title: 'Estate development approval',
    about: 'Minister’s approval before a flagged estate stand can be allocated. Section 86.',
    roles: ['admin', 'planner', 'eo', 'planning_clerk'], list: () => '/api/registers/estate-approvals',
  },
  {
    id: 'G11', group: 'GIS and the parcel register', title: 'Compulsory acquisition',
    about: 'The section 78 register.',
    roles: PLAN, list: () => '/api/registers/acquisitions',
  },
  {
    id: 'S1', group: 'Survey', title: 'Assign a survey job',
    about: 'Planner or executive officer sends a job to the survey section.',
    roles: SURVEY, list: () => '/api/surveyor/jobs',
    form: {
      legend: 'New job', roles: ['admin', 'planner', 'eo', 'planning_clerk'],
      fields: [
        { key: 'stand_number', label: 'Stand', placeholder: 'HDR-004' },
        { key: 'task_type', label: 'Task', default: 'verification', placeholder: 'verification, setting_out, pegging, layout, beacon_check' },
        { key: 'instructions', label: 'Instructions', placeholder: 'What the surveyor should check' },
      ],
      submit: (v) => ({
        method: 'POST', path: '/api/surveyor/jobs',
        body: { stand_number: v.stand_number, task_type: v.task_type || 'verification', instructions: v.instructions },
      }),
    },
  },
  {
    id: 'S2', group: 'Survey', title: 'Open survey jobs',
    about: 'The surveyor’s queue, including jobs not yet claimed.',
    roles: SURVEY, list: () => '/api/surveyor/jobs',
  },
  {
    id: 'S3', group: 'Survey', title: 'Layouts',
    about: 'Layouts declared against the register.',
    roles: ['admin', 'surveyor'], list: () => '/api/surveyor/layouts',
  },
  {
    id: 'S4', group: 'Survey', title: 'Deliver or return a job',
    about: 'Accept the work or send it back with a note. Open the job, then record the finding on the desk.',
    roles: SURVEY, list: () => '/api/surveyor/jobs',
  },
  {
    id: 'A1', group: 'Administration', title: 'Council overview',
    about: 'Staff, sessions and the health of this authority.',
    roles: ['admin'], list: () => '/api/admin/overview',
  },
  {
    id: 'A2', group: 'Administration', title: 'Audit trail',
    about: 'Who signed in and what the console recorded.',
    roles: ['admin'], list: () => '/api/admin/audit',
  },
  {
    id: 'A5', group: 'Administration', title: 'By-laws and tariffs',
    about: 'The register of by-laws, adopted chapters and the resolutions that set them.',
    roles: PLAN, list: () => '/api/registers/bylaws',
  },
  {
    id: 'X4', group: 'Custodians', title: 'Send a plan to the Surveyor-General',
    about: 'A courier record until the Surveyor-General has an API. Mark it sent from the desk when it leaves.',
    roles: CUSTODIAN, list: () => '/api/custodian/sg-submissions',
    form: {
      legend: 'New submission', roles: CUSTODIAN_WRITE,
      fields: [
        { key: 'title', label: 'Title', placeholder: 'Diagram for HDR-004' },
        { key: 'plan_type', label: 'Plan type', default: 'diagram' },
        { key: 'stand_number', label: 'Stand', placeholder: 'HDR-004' },
      ],
      submit: (v) => ({
        method: 'POST', path: '/api/custodian/sg-submissions',
        body: { title: v.title, plan_type: v.plan_type || 'diagram', stand_number: v.stand_number },
      }),
    },
  },
  {
    id: 'X5', group: 'Custodians', title: 'Deeds on the simulated registry',
    about: 'The ten title deeds this system can check. It is a labelled stand-in, not the Deeds Registry.',
    roles: ['admin', 'planner', 'eo', 'planning_clerk'], list: () => '/api/lands-registry/deeds',
  },
  {
    id: 'X6', group: 'Custodians', title: 'Hand a clearance to Deeds',
    about: 'Select a cleared certificate and type the Deeds receipt reference.',
    roles: PLAN, list: () => '/api/registers/rates-clearances',
    form: {
      legend: 'Record the hand-off', roles: PLAN, needsRow: true,
      fields: [{ key: 'deeds_handoff_ref', label: 'Deeds receipt', placeholder: 'DEEDS-COVER-1' }],
      submit: (v, row) => ({
        method: 'POST', path: `/api/registers/rates-clearances/${row?.id}/handoff`,
        body: { deeds_handoff_ref: v.deeds_handoff_ref },
      }),
    },
  },
  {
    id: 'X7', group: 'Custodians', title: 'Deeds transfer notice',
    about: 'A sale or subdivision lease notified under section 116, typed in until the registry sends them.',
    roles: CUSTODIAN, list: () => '/api/custodian/deeds-notices',
    form: {
      legend: 'Record a notice', roles: CUSTODIAN_WRITE,
      fields: [
        { key: 'notice_kind', label: 'Kind', default: 'sale', placeholder: 'sale, subdivision_lease, cancellation' },
        { key: 'stand_number', label: 'Stand' },
        { key: 'deed_number', label: 'Deed number' },
        { key: 'transferee_name', label: 'Transferee' },
      ],
      submit: (v) => ({
        method: 'POST', path: '/api/custodian/deeds-notices',
        body: {
          notice_kind: v.notice_kind || 'sale', stand_number: v.stand_number,
          deed_number: v.deed_number, transferee_name: v.transferee_name,
        },
      }),
    },
  },
  {
    id: 'X9', group: 'Custodians', title: 'Parcel lineage',
    about: 'Transfers and subdivisions that changed a parcel’s identity.',
    roles: CUSTODIAN, list: () => '/api/custodian/lineage',
  },
]

export function flowsFor(role: string): Flow[] {
  return FLOWS.filter((flow) => flow.roles === 'everyone' || flow.roles.includes(role) || role === 'admin')
}

export function formAllowed(form: FlowForm, role: string): boolean {
  return form.roles === 'everyone' || form.roles.includes(role) || role === 'admin'
}

export function roleLabel(role: string): string {
  const names: Record<string, string> = {
    admin: 'Administrator',
    planner: 'Town planning officer',
    eo: 'Executive officer',
    env_officer: 'Environmental health',
    building_inspector: 'Building inspector',
    planning_clerk: 'Planning clerk',
    surveyor: 'Surveyor',
    gis_officer: 'GIS officer',
    viewer: 'Citizen',
    public: 'Citizen',
    registered: 'Resident',
  }
  return names[role] ?? role.replaceAll('_', ' ')
}
