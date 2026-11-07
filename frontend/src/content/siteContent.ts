/**
 * Bundled default ("seed") content for the public council pages.
 *
 * This is the content migrated out of the old static WordPress site
 * (vungurdc.org.zw) so the portal can replace it. Every page renders from
 * this module immediately — so the public site works even when the backend
 * is offline — and the IT Admin can override any page at runtime through the
 * /admin/content editor (stored in the backend `site_content` table). The
 * override is layered on top of these defaults by `services/siteContent.ts`.
 *
 * To render a page, `views/council/CouncilPageView.vue` looks up the slug
 * here, then merges any saved override.
 */

export type Block =
  | { type: 'prose'; heading?: string; eyebrow?: string; paragraphs: string[] }
  | { type: 'numbered'; heading?: string; items: string[] }
  | { type: 'bullets'; heading?: string; items: string[] }
  | { type: 'staff'; heading?: string; members: { name: string; role: string }[] }
  | { type: 'table'; heading?: string; note?: string; columns: string[]; rows: string[][] }
  | {
      type: 'cards'
      heading?: string
      eyebrow?: string
      items: { title: string; desc?: string; to?: string; meta?: string }[]
    }
  | {
      type: 'attachments'
      heading?: string
      items: { name: string; fileType?: string; size?: string; url?: string }[]
    }
  | { type: 'stats'; heading?: string; note?: string; items: { label: string; value: string }[] }
  | {
      type: 'cta'
      heading?: string
      text?: string
      primary?: { label: string; to: string }
      secondary?: { label: string; to: string }
    }

export type BlockType = Block['type']

export interface CouncilPage {
  /** URL key, e.g. 'finance' → /council/finance. */
  slug: string
  title: string
  /** Small uppercase label above the page title. */
  eyebrow?: string
  /** Lead paragraph under the page title. */
  intro?: string
  blocks: Block[]
}

// Shared contact constants (used by the contact page + footer references).
export const COUNCIL_CONTACT = {
  phone: '(+263) 54 226515/6',
  phoneHref: 'tel:+26354226515',
  email: 'admin@vungurdc.org.zw',
  address: '19 Lincoln Road, Light Industrial Site, Gweru',
  hours: '8am – 5pm, Monday to Friday',
}

// The nine deliberative-arm committees — used by the Deliberative Arm index
// card grid and by the committee detail pages.
const COMMITTEE_INDEX: { title: string; desc: string; slug: string }[] = [
  { title: 'Insukamini Area Committee', slug: 'insukamini', desc: 'Local governance and economic development for the Insukamini area.' },
  { title: 'Local Economic Development (LED)', slug: 'led', desc: 'Investment promotion, value addition and support for local enterprise.' },
  { title: 'District Water Supply & Sanitation (DSSWC)', slug: 'dsswc', desc: 'Co-ordinates rural water supply and sanitation (WASH) across the district.' },
  { title: 'Rural District Development (RDDC)', slug: 'rddc', desc: 'Prepares the Annual District Development Plan and long-term plans.' },
  { title: 'Planning & Environment', slug: 'planning-environment', desc: 'Land use planning, natural-resource conservation and environmental scrutiny.' },
  { title: 'Social Services', slug: 'social-services', desc: 'Health, education, social welfare and emergency assistance.' },
  { title: 'Human Resources Development & Administration', slug: 'hr-admin', desc: 'Staffing, conditions of service and council administration.' },
  { title: 'Finance', slug: 'finance', desc: 'Budgets, rates, billing and the council’s financial management.' },
  { title: 'Roads & Works Department', slug: 'roads-works', desc: 'Roads, bridges, buildings, plant and council works.' },
]

const DEPARTMENT_INDEX: { title: string; desc: string; slug: string }[] = [
  { title: 'Your Council', slug: 'your-council', desc: 'District profile, location and the executive team that runs the council.' },
  { title: 'Health Facilities', slug: 'health-facilities', desc: 'The clinics and mobile health services serving the 19 wards.' },
  { title: 'Roads', slug: 'roads', desc: 'The primary, secondary and farm road network across the district.' },
  { title: 'Environment & Agriculture', slug: 'environment-agriculture', desc: 'Irrigation schemes, livelihood zones and natural-resource stewardship.' },
]

export const SITE_CONTENT: Record<string, CouncilPage> = {
  // ── Our Profile ─────────────────────────────────────────────────────────
  'our-profile': {
    slug: 'our-profile',
    title: 'Our Profile',
    eyebrow: 'About Vungu',
    intro:
      'Vungu Rural District Council is the local authority for 609,588.88 hectares of Zimbabwe’s Midlands Province, divided into 19 wards across natural farming regions 3 and 4.',
    blocks: [
      {
        type: 'prose',
        heading: 'Council Area',
        paragraphs: [
          'Vungu RDC is located in the Midlands Province. It shares its boundaries with Kwekwe (on the northern side), Chirumanzu (on the eastern side), Shurugwi (on the southern side), Insiza (on the western boundary) and Inyati (Northwest side). The district is divided into 19 wards. The Council covers a total area of 609,588.88 hectares. Only two safaris are present in the district, namely Linton Safari and Antelope Park.',
          'The Council lies in natural farming regions 3 and 4 which are perennially characterised by poor rainfall. Two catchment areas lie within Vungu — Gwai and Sanyati. Gweru District is made up of four intensive conservation areas, namely Gweru East, Vungu, Gweru and Upper Ngezi. The main rural/communal areas are Chiwundura and Lower Gweru.',
          'The main business centres in the district are Insukamini, Makepesi, Maboleni, Ntabamhlope, Lower Gweru, Somabhula, Gambiza, Muchakata, Gunde, Mabodza and Treetop. At Maboleni business centre the main activities are selling agricultural produce (horticultural produce), retailing, petty trading, SMEs (value addition of maize grain), welding, and provision of accommodation. The main mine in the district is SINO, which produces quarry and cement.',
          'There are 4 chiefs, 9 headmen, 215 village heads and 19 councillors for the 19 rural wards. Chiefs presiding over the Gweru area are Chief Bunina (whose chieftainship covers most parts of Lower Gweru), Chief Sogwala in Lower Gweru, Chief Chiwundura in Chiwundura and Chief Gambiza in Chiwundura.',
        ],
      },
      {
        type: 'stats',
        heading: 'Vungu District at a Glance',
        note: 'Figures from the Vungu RDC profile. Natural farming regions 3 and 4; catchment areas Gwai and Sanyati.',
        items: [
          { label: 'Administrative Wards', value: '19' },
          { label: 'Hectares of Land', value: '609,589' },
          { label: 'Households Served', value: '24,127' },
          { label: 'Health Facilities', value: '22' },
          { label: 'Water Points', value: '360' },
          { label: 'Kilometres of Roads', value: '1,521' },
        ],
      },
      {
        type: 'table',
        heading: 'Know Your Councillors',
        columns: ['Ward', 'Councillor', 'Political Party', 'Constituency'],
        rows: [
          ['1', 'Mbusi Ndlovu', 'ZANU PF', 'Vungu'],
          ['2', 'Elias Mbiba', 'ZANU PF', 'Vungu'],
          ['3', 'Edmond Gangarabwe', 'CCC', 'Vungu'],
          ['4', 'Thomas Machaya', 'ZANU PF', 'Vungu'],
          ['5', 'Nyika Parirenyatwa', 'CCC', 'Vungu'],
          ['6', 'Ngema Another Sibanda', 'ZANU PF', 'Vungu'],
          ['7', 'Bhekhimpilo Sibanda', 'ZANU PF', 'Vungu'],
          ['8', 'Magama Venencia', 'CCC', 'Vungu'],
          ['9', 'Saliston Paradza', 'ZANU PF', 'Chiwundura'],
          ['10', 'Sonny Chitarata', 'ZANU PF', 'Chiwundura'],
          ['11', 'Justin Mushonga', 'ZANU PF', 'Chiwundura'],
          ['12', 'Yeukai Paradza', 'ZANU PF', 'Chiwundura'],
          ['13', 'Norbert Makechi', 'ZANU PF', 'Chiwundura'],
          ['14', 'Aaron Muchemwa', 'ZANU PF', 'Chiwundura'],
          ['15', 'Sindani Mpofu', 'ZANU PF', 'Vungu'],
          ['16', 'Macmillan Bhepe', 'ZANU PF', 'Chiwundura'],
          ['17', 'Angeline Muganyi', 'ZANU PF', 'Chiwundura'],
          ['18', 'Nyaradzo Dapu', 'ZANU PF', 'Chiwundura'],
          ['19', 'Albert Mahapa', 'ZANU PF', 'Vungu'],
        ],
      },
      {
        type: 'table',
        heading: 'Women’s Quota Councillors',
        columns: ['Councillor', 'Political Party', 'Constituency'],
        rows: [
          ['Petronella Mpala', 'ZANU-PF', 'Vungu'],
          ['Rosemary Shupi Murwisi', 'ZANU-PF', 'Vungu'],
          ['Clara Ngwenya', 'ZANU-PF', 'Vungu'],
          ['Enesta Nhongo', 'ZANU-PF', 'Vungu'],
          ['Flatah Nyama', 'ZANU-PF', 'Vungu'],
          ['Elizabeth Kudzai Zinja', 'ZANU-PF', 'Vungu'],
        ],
      },
      {
        type: 'table',
        heading: 'Chieftainships',
        columns: ['Ward', 'Ward Name', 'Chief / Headman'],
        rows: [
          ['1', 'Woodend', 'Sogwala (Chief)'],
          ['2', 'Madigane', 'Madigane (Headman)'],
          ['3', 'Nyama', 'Nyama (Headman)'],
          ['4', 'Nkawana', 'Nkawana (Headman)'],
          ['5', 'Chisadza', 'Chisadza (Chief)'],
          ['6', 'Sikombingo', 'Skombingo (Headman)'],
          ['7', 'Mdubiwa', 'Mdubiwa (Headman)'],
          ['8', 'Bafana', 'Mkombo (Headman)'],
          ['9', 'Riverdale', 'Gambiza (Chief)'],
          ['10', 'Gambiza', 'Gambiza (Chief)'],
          ['11', 'Mtengwa', 'Mtengwa (Headman)'],
          ['12', 'Gangira', 'Gangira (Headman)'],
          ['13', 'Masvori', 'Chiwundura (Chief)'],
          ['14', 'Sino', 'Gambiza (Chief)'],
          ['15', 'Somabhula', 'Bunina (Chief)'],
          ['16', 'Bhudha & Bambanani', 'Bunina (Chief)'],
          ['17', 'Ghogo Plains', 'Bunina (Chief)'],
          ['18', 'Guinea Fowl & Plasworth', 'Gambiza (Chief)'],
          ['19', 'Ruby', 'Bunina (Chief)'],
        ],
      },
      {
        type: 'prose',
        heading: 'Our Location in the Midlands',
        paragraphs: [
          'Vungu Rural District Council shares boundaries with Chirumanzu Rural District Council to the East, Tongogara Rural District Council to the South East, Insiza Rural District Council to the South West, Bubi District to the West, Nkayi District to the North West and Zibagwe Rural District Council to the North.',
        ],
      },
    ],
  },

  // ── Executive Arm (Our Team) ───────────────────────────────────────────
  'executive-arm': {
    slug: 'executive-arm',
    title: 'Executive Arm',
    eyebrow: 'Council Staff',
    intro:
      'The executive arm carries out the day-to-day administration of Vungu Rural District Council under the direction of the elected council.',
    blocks: [
      {
        type: 'staff',
        heading: 'Council Staff',
        members: [
          { name: 'Mr. A. Magura', role: 'Chief Executive Officer' },
          { name: 'Mrs. Grace Kembo', role: 'Executive Officer — Finance' },
          { name: 'Ms. L.T. Maheru', role: 'Human Resources, Social Services & Administration Officer' },
          { name: 'Mr. Kudzai Njodzi', role: 'Engineer' },
          { name: 'Mr. Lawrence Chikwira', role: 'Internal Auditor' },
          { name: 'Mr. C. Maramwidze', role: 'Executive Officer — Planner' },
        ],
      },
    ],
  },

  // ── Deliberative Arm (committees index) ────────────────────────────────
  'deliberative-arm': {
    slug: 'deliberative-arm',
    title: 'Deliberative Arm',
    eyebrow: 'Board Structures',
    intro:
      'The deliberative arm of Vungu Rural District Council works through committees, each responsible for a portfolio of the council’s mandate. Select a committee to read its objectives and duties.',
    blocks: [
      {
        type: 'cards',
        heading: 'Committees',
        items: COMMITTEE_INDEX.map((c) => ({
          title: c.title,
          desc: c.desc,
          to: `/council/${c.slug}`,
          meta: 'Committee',
        })),
      },
    ],
  },

  // ── Departments index ──────────────────────────────────────────────────
  departments: {
    slug: 'departments',
    title: 'Departments',
    eyebrow: 'Inside the Council',
    intro: 'The teams and services that keep Vungu district running.',
    blocks: [
      {
        type: 'cards',
        heading: 'Departments & Services',
        items: DEPARTMENT_INDEX.map((d) => ({
          title: d.title,
          desc: d.desc,
          to: `/council/${d.slug}`,
          meta: 'Department',
        })),
      },
    ],
  },

  // ── Publications / documents ───────────────────────────────────────────
  publications: {
    slug: 'publications',
    title: 'Publications & Documents',
    eyebrow: 'Downloads',
    intro:
      'Official council plans and notices. Download the documents below. The IT Admin can replace these with updated files at any time.',
    blocks: [
      {
        type: 'attachments',
        heading: 'Council Documents',
        items: [
          {
            name: 'Vungu RDC Strategic Plan 2026–2030',
            fileType: 'DOCX',
            size: '338 KB',
            url: 'https://vungurdc.org.zw/ova_doc/strategic-plan-2026-2030/',
          },
          {
            name: 'Vungu RDC 2026 Annual Plan',
            fileType: 'DOCX',
            size: '8.16 MB',
            url: 'https://vungurdc.org.zw/ova_doc/vungu-rdc-2026-annual-plan/',
          },
          {
            name: 'Master Plan — Draft Report of Study 2025',
            fileType: 'DOCX',
            size: '3.87 MB',
            url: 'https://vungurdc.org.zw/ova_doc/master-plan/',
          },
          {
            name: '2026 Budget Approval Notice',
            fileType: 'DOCX',
            size: '72 KB',
            url: 'https://vungurdc.org.zw/ova_doc/budget-approval-notice-2026/',
          },
        ],
      },
    ],
  },

  // ── Stand application (residential / commercial) ───────────────────────
  'stand-application': {
    slug: 'stand-application',
    title: 'Stand Application',
    eyebrow: 'Stand Applications',
    intro:
      'Interested in securing a residential or commercial stand in Vungu? You can now apply online through this portal, or follow the procedure below to submit a paper application to the Council.',
    blocks: [
      {
        type: 'cta',
        heading: 'Apply online',
        text: 'The fastest way to apply is to create an account and submit your stand application online. You can pay the application fee and track progress from your citizen portal.',
        primary: { label: 'Start an online application', to: '/register' },
        secondary: { label: 'Sign in', to: '/login' },
      },
      {
        type: 'numbered',
        heading: 'Application Requirements',
        items: [
          'Completed Application Form — fill in all sections legibly and attach certified copies of the required documents (e.g. national ID, proof of residence).',
          'Non-refundable application fee of USD $46.00 must accompany your application. This fee is valid for 12 months; if no stand is allocated within this period, applicants must renew their application to remain on the waiting list.',
          'Submission — submit the completed form and payment to 19 Lincoln Road, Light Industrial Site, Gweru.',
        ],
      },
    ],
  },

  // ── Committees ──────────────────────────────────────────────────────────
  insukamini: {
    slug: 'insukamini',
    title: 'Insukamini Area Committee',
    eyebrow: 'Deliberative Arm',
    intro:
      'The Insukamini Area Committee is a key local governance body under Vungu Rural District Council, dedicated to fostering development and addressing community needs within the Insukamini area.',
    blocks: [
      {
        type: 'prose',
        paragraphs: [
          'The committee plays an active role in Local Economic Development (LED), working closely with residents, businesses and government agencies to promote sustainable growth and improve livelihoods. It serves as a vital link between the community and the Vungu Rural District Council, ensuring that development efforts align with the needs and aspirations of local residents.',
        ],
      },
      {
        type: 'bullets',
        heading: 'Key Functions & Responsibilities',
        items: [
          'Advising and supporting local entrepreneurship initiatives to stimulate economic activity.',
          'Developing and maintaining an LED database to track economic opportunities and resources in the area.',
          'Facilitating training programmes for stakeholders, including small business owners and community members.',
          'Collaborating with government agencies and NGOs to implement LED programmes and projects.',
          'Supporting existing businesses and resolving challenges affecting local enterprises.',
          'Mediating and addressing conflicts related to governance roles, including coordination with local councillors.',
        ],
      },
    ],
  },

  led: {
    slug: 'led',
    title: 'Local Economic Development (LED)',
    eyebrow: 'Deliberative Arm',
    intro:
      'A multi-stakeholder committee made up of resident property owners with relevant experience, serving a five-year term without remuneration on a voluntary basis.',
    blocks: [
      {
        type: 'numbered',
        heading: 'Duties',
        items: [
          'Recommends adoption of the LED strategy and related policies.',
          'Facilitate development of the annual LED plan and implement council-approved programmes.',
          'Receive and consider new investment proposals for recommendation to council.',
          'Advise council on local investment issues.',
          'Monitor, evaluate and report progress of LED programmes.',
          'Facilitate broader public involvement in local economic development.',
          'Provide educational opportunities to support LED programmes.',
          'Recommend programmes to recognise and reward achievements.',
        ],
      },
      {
        type: 'numbered',
        heading: 'Economic Development Officer — Key Result Areas',
        items: [
          'Conducts research and stakeholder consultation to formulate an LED strategy.',
          'Provide / facilitate advice to local entrepreneurship.',
          'Develop an appropriate LED database.',
          'Preparation of appropriate periodic reports.',
          'Facilitate training for stakeholder groups.',
          'Promotion of private-sector development with a focus on SMEs.',
          'Provide technical advice to the LED committee on growth and development of the council economy.',
          'Liaise with other government agencies to facilitate LED programmes.',
          'Support existing businesses to survive, grow and expand operations.',
        ],
      },
    ],
  },

  dsswc: {
    slug: 'dsswc',
    title: 'District Water Supply & Sanitation (DSSWC)',
    eyebrow: 'Deliberative Arm',
    intro:
      'To co-ordinate planning and assist in the management of rural water supply and sanitation (WASH) activities in the district.',
    blocks: [
      {
        type: 'prose',
        heading: 'Membership',
        paragraphs: [
          'The committee shall comprise all relevant sector agencies represented in the district. The sub-committee has the power to co-opt representatives from NGOs involved in water supply and sanitation project implementation in the district, and other members as required.',
          'The sub-committee reports to a committee of Council responsible for water and sanitation service provision and to the Provincial Water and Sanitation Subcommittee.',
        ],
      },
      {
        type: 'numbered',
        heading: 'Duties',
        items: [
          'Co-ordinate and monitor the activities of all agencies involved in rural water supply and sanitation (WASH) project implementation in the district, including NGOs.',
          'Ensure that planning and implementation of district rural WASH projects are in accordance with provincial and national policies and procedures.',
          'Co-ordinate the preparation of district plans for rural water supply and sanitation development.',
          'Periodic monitoring of rural WASH project activities.',
          'Regularly report to appropriate provincial authorities on district progress in water and sanitation projects.',
          'Co-ordinate the maintenance of updated inventories of all water and sanitation facilities in the district.',
        ],
      },
    ],
  },

  rddc: {
    slug: 'rddc',
    title: 'Rural District Development Committee (RDDC)',
    eyebrow: 'Deliberative Arm',
    intro:
      'For each council area there shall be a committee, known as the Rural District Development Committee, that prepares the Annual District Development Plan and assists with long-term plans.',
    blocks: [
      {
        type: 'bullets',
        heading: 'Composition / Membership',
        items: [
          'The District Administrator.',
          'The Chairman of every other committee established by the council.',
          'The Chief Executive Officer of the council and such other officers as the council may determine.',
          'The senior officer in the district of the Zimbabwe Republic Police, the Zimbabwe National Army and the President’s Department.',
          'The District Head of each Ministry and department designated by the Minister.',
          'Such further persons representing other organisations and interests as the Minister, on the recommendation of the District Administrator, may permit.',
        ],
      },
      {
        type: 'numbered',
        heading: 'Duties & Functions',
        items: [
          'To consider Ward Development Plans submitted to it in terms of section fifty-nine.',
          'To make recommendations to the council on matters to be included in the annual development and other long-term plans for the district.',
          'To prepare the Annual District Development Plan for approval by the council and assist in the preparation of other long-term plans for the council area.',
          'When instructed by the council, to investigate the implementation of the annual development and other long-term plans.',
          'To exercise such other functions in relation to the development plans as may be assigned from time to time by the council.',
          'A District Development Plan shall be prepared and presented to the council before the 31st of May every year.',
          'The District Administrator shall fix the times and places of all meetings of the committee.',
          'A majority of the members shall form a quorum at any meeting of the committee.',
        ],
      },
    ],
  },

  'planning-environment': {
    slug: 'planning-environment',
    title: 'Planning & Environment',
    eyebrow: 'Deliberative Arm',
    intro:
      'Responsible for land-use planning, natural-resource conservation, environmental scrutiny and agricultural support across the district.',
    blocks: [
      {
        type: 'numbered',
        heading: 'Duties',
        items: [
          'To identify and establish woodlots, consolidated gardens, irrigation schemes and grazing schemes.',
          'To consider siting of dams and recommend issuing of water permits to council.',
          'To take responsibility for reclamation of degraded natural resources.',
          'To consider resettlement lists and recommend to council.',
          'To take measures for conservation through issuing of permits and monitoring the use of natural resources including soil, water, trees, grass and wildlife, and to control pollution.',
          'To provide and prescribe means for the control, prevention and extinguishing of bush fires.',
          'To establish, promote and maintain fisheries and fish dams.',
          'To provide and maintain dip tanks, fencing, stock pens, slaughter facilities and watering points for livestock.',
          'To provide facilities for marketing of agricultural produce.',
          'To control the grazing of stock on land under council.',
          'To cultivate and farm land owned or controlled by council.',
          'To take measures to control and suppress outbreaks of insects, pests and vermin that affect agricultural produce.',
          'To formulate by-laws governing the operations of Lands, Agriculture and Natural Resources.',
          'To ensure environmental impact assessments are done on new projects.',
          'To support farmers’ groups especially during shows and field days.',
          'To implement land-use plans and control illegal settlements.',
          'To consider land disputes.',
          'To promote and encourage eco-tourism.',
          'Preparation, implementation and monitoring of committee budgets.',
        ],
      },
    ],
  },

  'social-services': {
    slug: 'social-services',
    title: 'Social Services',
    eyebrow: 'Deliberative Arm',
    intro:
      'Considers all matters relating to the provision of health, education and social services across the district.',
    blocks: [
      {
        type: 'numbered',
        heading: 'Duties',
        items: [
          'To consider all matters relating to the provision of health, education and social services.',
          'To prepare short- to long-term plans.',
          'To facilitate the provision of public health education.',
          'To prevent pollution in any form and require any person to take the necessary steps at their expense.',
          'To monitor and inspect services for removal and treatment of effluent, refuse and waste.',
          'To provide, operate and maintain health facilities.',
          'To establish, equip and maintain fire brigades for the protection and saving of life and property.',
          'To hold meetings with School Development Committees.',
          'To provide and operate services for family planning and child spacing.',
          'To provide public assistance in emergencies such as drought or other local and national disasters.',
          'To provide, operate and maintain schools, crèches, libraries, recreational facilities and amenities, and to levy and collect fees.',
          'To consider youth development, gender and employment creation within the council area.',
          'To provide and maintain an orchestra and band and to hire them out.',
          'To provide for pauper burials.',
          'Preparation, implementation and monitoring of committee budgets.',
        ],
      },
    ],
  },

  'hr-admin': {
    slug: 'hr-admin',
    title: 'Human Resources Development & Administration',
    eyebrow: 'Deliberative Arm',
    intro:
      'Designs and implements the council’s organisational structure and promotes human-resources development in pursuance of the council’s aims and objectives.',
    blocks: [
      {
        type: 'numbered',
        heading: 'Duties',
        items: [
          'To design and implement the organisational structure of council and promote human-resources development.',
          'Subject to the approval of the Minister, recruit council staff in terms of the RDC Act Chapter 29:13.',
          'Subject to section 67 of the RDC Act, formulate conditions of service of council staff and consider employment contracts of officers and employees.',
          'To design job specifications and job descriptions.',
          'To design and implement performance-management systems and award bonuses for deserving officers and employees.',
          'To carry out disciplinary measures and grievance-handling procedures in accordance with the Vungu RDC Employment Code of Conduct.',
          'To formulate, implement and review policies on administration and human-resources development.',
          'To consider staff applications for loans.',
          'To present mementoes to past councillors and members of committees.',
          'To design the coat of arms and logo for council.',
          'Prepare, implement and monitor committee budget.',
        ],
      },
    ],
  },

  finance: {
    slug: 'finance',
    title: 'Finance',
    eyebrow: 'Deliberative Arm',
    intro:
      'Regulates the overall financial affairs of council and its committees, including budgeting, rates, billing and financial management.',
    blocks: [
      {
        type: 'numbered',
        heading: 'Duties',
        items: [
          'To consider and report on annual estimates of income and expenditure submitted by all committees and draw up the consolidated annual estimates for council approval.',
          'To consider and report on supplementary estimates and virements for all committees and recommend to council.',
          'To regulate the collection of all income and the expenditure of all monies as authorised in the confirmed or supplementary estimates.',
          'To ensure regulations on the collection of income and expenditure are followed to maintain acceptable standards of financial management.',
          'To recommend to council the fixing of all charges, fees, rates and licences, and recommend rebates to ratepayers.',
          'To consider and recommend applications for and servicing of loans from external and internal sources.',
          'To consider and report on the collection of debts and recommend the writing off of bad debts.',
          'To ensure that council’s debts are paid off as and when they fall due.',
          'To consider exemptions of certain persons / organisations from paying rates and levies.',
          'To consider and recommend the operation of viable income-generating projects and other investments.',
          'To ensure the sound management of council’s income-generating projects and funds.',
          'To consider and report on council’s financial statements and financial status.',
          'To ensure all books of accounts are audited within the legislated time and scrutinise audit reports.',
          'To establish a CDF account and ensure its proper management.',
          'To ensure the proper acquisition, maintenance and disposal of all council assets.',
          'To produce and enforce regulations and procedures for financial management, including procurement and payment systems.',
          'To ensure proper custody of money, securities and other properties of council.',
          'To consider and report on tenders and contracts to be engaged in by council.',
          'To consider and report on grants in aid to council and proposals for donations out of council revenue.',
          'Generally to regulate the overall financial affairs of council and its committees.',
        ],
      },
    ],
  },

  'roads-works': {
    slug: 'roads-works',
    title: 'Roads & Works Department',
    eyebrow: 'Deliberative Arm',
    intro:
      'Responsible for roads, bridges, buildings, plant and the planning of residential and industrial development.',
    blocks: [
      {
        type: 'numbered',
        heading: 'Duties',
        items: [
          'To recommend construction and maintenance of roads, causeways, bridges, culverts, footbridges, dams and water reticulation.',
          'To recommend the purchase, maintenance and disposal of plant and equipment including council vehicles, land and buildings.',
          'To prepare and implement short- to long-term plans.',
          'To provide policies on the planning, construction and use of buildings.',
          'To establish new business centres and prepare and develop new residential and industrial layout plans.',
          'To consider residential and industrial applications.',
          'To facilitate the provision of omnibus services for the carriage of passengers and parcels within the council area.',
          'To provide the lighting of streets and illumination of roads and buildings.',
          'To provide and regulate advertising hoardings on property under the control of council and hire out space on such hoardings.',
          'To provide, maintain or extend any scheme of sewage or drainage for the collection, conveyance and disposal of sewage or storm water.',
          'Preparation, implementation and monitoring of committee budgets.',
        ],
      },
    ],
  },

  // ── Departments ─────────────────────────────────────────────────────────
  'your-council': {
    slug: 'your-council',
    title: 'Your Council',
    eyebrow: 'Department',
    intro:
      'Vungu RDC is located in the Midlands Province and divided into 19 wards, covering a total area of 609,588.88 hectares.',
    blocks: [
      {
        type: 'prose',
        paragraphs: [
          'Vungu RDC shares its boundaries with Kwekwe (northern side), Chirumanzu (eastern side), Shurugwi (southern side), Insiza (western boundary) and Inyati (Northwest side). Only two safaris are present in the district, namely Linton Safari and Antelope Park.',
          'The Council lies in natural farming regions 3 and 4 which are perennially characterised by poor rainfall. Two catchment areas lie within Vungu — Gwai and Sanyati. The main rural / communal areas are Chiwundura and Lower Gweru.',
          'There are 4 chiefs, 9 headmen, 215 village heads and 19 councillors for the 19 rural wards.',
        ],
      },
      {
        type: 'staff',
        heading: 'Executive Team',
        members: [
          { name: 'Mr. A. Magura', role: 'Chief Executive Officer' },
          { name: 'Mrs. Grace Kembo', role: 'Executive Officer — Finance' },
          { name: 'Ms. L.T. Maheru', role: 'Human Resources, Social Services & Administration Officer' },
          { name: 'Mr. C. Maramwidze', role: 'Executive Officer — Planner' },
          { name: 'Mr. Lawrence Chikwira', role: 'Internal Auditor' },
          { name: 'Mr. Kudzai Njodzi', role: 'Engineer' },
        ],
      },
    ],
  },

  'health-facilities': {
    slug: 'health-facilities',
    title: 'Health Facilities',
    eyebrow: 'Department',
    intro:
      'Vungu RDC operates and supports a network of clinics and a mobile clinic serving the 19 wards. A new mobile clinic van was acquired in 2022 with devolution funds.',
    blocks: [
      {
        type: 'table',
        heading: 'Health Facilities',
        columns: ['Facility', 'Responsible Authority', 'Status'],
        rows: [
          ['Vungu Mobile Clinic', 'Vungu RDC', 'Functional — new van acquired in 2022 (devolution funds)'],
          ['Madigane', 'Vungu RDC', 'Functional'],
          ['Nyama', 'Vungu RDC', 'Functional'],
          ['Ntabamhlope', 'Government', 'Functional'],
          ['Ruby', 'Vungu RDC', 'Functional'],
          ['Vungu', 'Vungu RDC', 'Functional'],
          ['Mangwande', 'Government', 'Functional'],
          ['Somabhula', 'Vungu RDC', 'Functional'],
          ['Makepesi', 'Vungu RDC', 'Functional'],
          ['Lower Gweru Mission', 'SDA', 'Functional'],
          ['Riverdale Clinic', 'JHWO', 'Functional'],
          ['Tumbire', 'Vungu RDC', 'Functional'],
          ['Maboleni', 'Vungu RDC', 'Functional'],
          ['St. Patricks', 'Anglican', 'Functional'],
          ['Chinamasa', 'Vungu RDC', 'Functional'],
          ['Connemara Prison', 'ZPCS', 'Functional'],
          ['Whawha Clinic', 'ZPCS', 'Functional'],
          ['Hozheri Clinic', 'Roman Catholic Church', 'Functional'],
          ['Chiwundura', 'Vungu RDC', 'Functional'],
          ['Kabanga', 'Vungu RDC', 'Functional'],
          ['Gunde', 'Government', 'Functional'],
          ['Masvori', 'Government', 'Functional'],
          ['Impala', 'Vungu RDC', 'Functional'],
        ],
      },
      {
        type: 'prose',
        heading: 'Comment',
        paragraphs: [
          'More clinics are required in the resettlement areas. Ruby Clinic operates from temporary structures and it is the intention of council to build proper structures in the future. There are no health facilities in wards 16, 17 and 18.',
        ],
      },
    ],
  },

  roads: {
    slug: 'roads',
    title: 'Roads',
    eyebrow: 'Department',
    intro:
      'Vungu RDC has primary and secondary roads that link rural service centres across the district.',
    blocks: [
      {
        type: 'prose',
        paragraphs: [
          'Primary and secondary roads link rural service centres such as the Gweru–Chiundura Road, Gweru–Gwenhoro Road (Fair View turnoff) and the Treetop–Dorset Road. The District Development Fund (DDF) is one of the road authorities and oversees a total of 40 dust roads.',
          'The length of these roads is approximately 413 km (Lower Gweru Road 266 km and Chiwundura Road 187 km). On the Chiwundura road infrastructure there are 32 bridges and 300 culverts. Some of the roads in Vungu are being developed and rehabilitated by Council and the Ministry of Transport, while farm roads link to the main road and are serviced by farm owners.',
          'The district is also linked to the railway line: Bulawayo–Somabhula–Rutenga, Harare–Gweru–Bulawayo and Gweru–Masvingo.',
        ],
      },
    ],
  },

  'environment-agriculture': {
    slug: 'environment-agriculture',
    title: 'Environment & Agriculture',
    eyebrow: 'Department',
    intro:
      'Vungu rural lies in livelihood zone 4, which specialises in cattle and cereal farming. Agriculture — growing crops and keeping livestock — is the main livelihood option.',
    blocks: [
      {
        type: 'table',
        heading: 'Irrigation Schemes & Water Sources',
        columns: ['Ward', 'Name', 'Water Source', 'Status'],
        rows: [
          ['16', 'London Farm', 'Borehole', 'Functional'],
          ['16', 'Insukamini Lot Youth Farm', 'Borehole', 'Not functional'],
          ['—', 'Insukamini Farm', 'Insukamini Dam', 'Functional'],
          ['—', 'Mkoba', 'Mkoba Dam', 'Functional'],
          ['—', 'Mambanjeni', 'Gweru River', 'Not functional'],
          ['—', 'Shagari', 'Shagari Dam', 'Not functional'],
          ['11', 'Mutorahuku', 'Mutorahuku Dam', 'Functional'],
          ['12', 'Mabodza', 'Mabodza Dam', 'Functional'],
        ],
        note: 'Mambanjeni Irrigation Scheme is being rehabilitated under a government programme and is expected to be functional soon. The irrigation schemes have the potential to ensure food security in the district and can be the nuclei of local economic-development activities.',
      },
      {
        type: 'prose',
        heading: 'Main Livelihood Sources',
        paragraphs: [
          'Vungu rural lies in livelihood zone 4, which specialises in cattle and cereal farming. This zone is characterised by old resettlement, small-scale farmers and a few large-scale commercial farm (LSCF) holders, with the majority of farmers being A1 and A2 holders. The main livelihood option over the past five years has been agriculture — growing crops and keeping livestock.',
          'Most production is rain-fed, which makes production difficult due to erratic rainfall, so livestock production is a viable enterprise in the district. The main source of food for farm owners in all wealth groups is own production. Farm workers rely mainly on purchasing food. Very poor, poor and some middle households hunt animals and collect wild foods including mopane worms (Lower Gweru area), which contribute to improved quality of diets.',
        ],
      },
      {
        type: 'table',
        heading: 'Summary of Livelihood Zones',
        columns: ['Livelihood Zone', 'Description', 'Wards'],
        rows: [
          ['Cattle production zone', 'Ranching, pen fattening, auction sales.', 'All wards'],
          [
            'Crop production zone',
            'Cereals including maize, millet and sorghum, with groundnuts, cowpeas and sweet potatoes. Market gardening where there are irrigation schemes (winter wheat, vegetables, green maize). Cash crops include tobacco, cotton, sunflower and Irish potatoes.',
            'All wards (sunflower); 15,19,16,7,8,11,12,9 (wheat); 14,18,16 (tobacco); 1 (cotton)',
          ],
          [
            'Eastern Kalahari Sandveld Communal',
            'Livelihoods built around agriculture, animal husbandry and labour. Sorghum and maize farming is widespread but unreliable as the zone is semi-arid. Livestock and remittances are a key safety net; for the poor, local work, forest products and/or gold panning is the mainstay.',
            '2,3,4,5,6,7,8,10,11,13,14,15',
          ],
        ],
      },
    ],
  },
}

/** All page slugs, used by the admin editor and nav. */
export const COUNCIL_SLUGS = Object.keys(SITE_CONTENT)

/** Deep clone so callers can edit a page without mutating the seed. */
export function seedPage(slug: string): CouncilPage | null {
  const page = SITE_CONTENT[slug]
  return page ? structuredClone(page) : null
}
