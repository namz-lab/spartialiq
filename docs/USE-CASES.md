# VunGIS: actors and use cases

**Status:** 13 October 2026. Written from the code as it stands (role registry `app-backend/src/config/permissions.js`, routes, migrations to 180, the citizen portal's sections) and from the Rural District Councils Act and Regional, Town and Country Planning Act provisions the application implements. Each use case carries a status: **built** (in the application and tested), **partial**, **simulated** (a stand-in for a system we do not control), or **not built**.

## 1. The shape of the system, and where I would sharpen it

The two-in-one description is right about the *audiences*: an enterprise-wide geographic management system for the council's staff, and a citizen-centred portal for the people the council serves. I would change one thing about the framing and add a second.

**It is one system with three kinds of user, not two systems.** A citizen's application, the planner's file on it and the inspector's visit are the same record in the same database. The portal is not a separate product bolted to the GMS: it is the same case seen through a narrower window (a citizen sees only their own case, a planner sees the register). The separation that matters is the **trust boundary**, not the codebase. There are three tiers:

| Tier | Who | What they see |
|---|---|---|
| Public | Anyone, no sign-in | The map explorer, the public plan lookup ("what can I build here"), the public parcel lookup, published notices |
| Citizen | A registered person | Their own applications, payments, notices, inspections, certificates, appeals, complaints |
| Council | Staff, by role | The registers and workflows their role allows; the GIS Branch sees the whole parcel register |

**The Surveyor-General and the Deeds Registry are not users, and the council does not "extend to" them. It exchanges with them.** They are national custodians of two different kinds of truth, and the design should say so:

- The **Surveyor-General** is the custodian of *boundaries*. A parcel's boundary changes only through an approved general plan or diagram. VunGIS already honours this: the register refuses any other edit to a boundary, and an approved plan is imported through a validated, all-or-nothing import that adopts the council's own earlier survey in place. The link is **inbound and file-based** (the Survey Section's approved plan is imported by a GIS officer). There is no live connection to the Surveyor-General's office, and I would not promise one until that office offers an interface.
- The **Deeds Registry** is the custodian of *title and ownership*. The council needs it for questions (is this person the holder of this deed? are the charges paid before transfer?) and the Registry needs the council for one answer (the section 109 certificate that charges are paid). Today the Deeds Registry in the application is a **labelled simulation** (`/api/lands-registry`, used to verify a citizen's title-deed number as proof of residence). The section 109 certificate is **not built**. A real integration depends entirely on what the Ministry of Lands will expose.

The principle that follows: **each custodian owns its truth, and the council keeps a reference to it plus a record of what the council itself did.** The council does not copy ownership, and it does not edit boundaries. That is also the answer to a likely question from either office: the system cannot alter what they hold.

**One addition: the authority itself is an actor with a legal personality.** The Rural District Councils Act makes the council a body corporate with duties (enforce conditions of title, make by-laws, levy charges) that the planning Act does not. Several of the gaps in section 6 below are those duties. And a fourth group sits beside the two custodians: the **Minister of Local Government**, whose approval the Act requires for by-laws, estate development and some resolutions, and the **Administrative Court**, which hears appeals against enforcement under section 73. They are actors in the use cases even though no one from either signs in.

## 2. Actors

### 2.1 Public and citizen

| Actor | Role in the system | Notes |
|---|---|---|
| **Visitor** | `public`, anonymous | Explores the map, looks up a plan or parcel, reads published notices |
| **Applicant** (registered citizen) | `registered` (and legacy `viewer`) | Applies, pays, tracks, appeals, reports. Sees only their own records |
| **Objector or neighbour** | Visitor or applicant | Responds to a statutory public notice. Not a separate account type |
| **Owner or occupier served with a notice** | *Not a user* | Receives a section 73 notice on paper or by post. The application records service on them; they do not need an account |
| **Complainant** | Applicant, or anonymous | Reports unauthorised building. An anonymous report carries no contact details, enforced in the database |

### 2.2 Council staff

| Actor | Role | Responsibility |
|---|---|---|
| **Planning clerk** | `planning_clerk` | Intake, fees, acknowledgement, dispatch, notice certificates, file movement |
| **Town planning officer** | `planner` | Applications end to end, from lodgement to permit |
| **Executive officer** | `eo` | Determination, committee, public notice, oversight |
| **Committee** | Members recorded in the register | Quorum, attendance, resolutions |
| **Building inspector** | `building_inspector` | Stage inspections, complaints, enforcement, occupation certificates, serving section 73 notices |
| **Environmental health officer** | `env_officer` | Premises, outbreaks, water samples, abatement notices, burial permits |
| **GIS Branch** (nine roles) | `gis_head`, `gis_data`, `gis_dev`, `gis_analyst`, `gis_tech`, `gis_clerk`, legacy `gis_officer`, `dept_editor`, `dept_viewer` | The parcel register, edits and QA, survey imports, the ERP link, map production, departmental focal points |
| **Council surveyor** (employed or contracted) | `surveyor` and SurveyPro | Survey jobs, check, deliver |
| **Head surveyor, reviewer** | SurveyPro roles | Appoint surveyors; accept or return delivered work |
| **IT administrator** | `admin` | Staff accounts, security, settings, public website, zone configuration. Holds no planning record |

### 2.3 External parties

| Actor | What they hold or decide | Link to VunGIS today |
|---|---|---|
| **Surveyor-General's office** | Approved general plans and diagrams: the boundary | Inbound, file-based import by a GIS officer. **Built.** No live link |
| **Deeds Registry** (Ministry of Lands) | Registered title; the transfer | Citizen deed check against a **simulation**. Section 109 certificate **not built** |
| **Minister of Local Government** | Approves by-laws, estate development and certain resolutions; classifies land by Gazette notice | **Not modelled** (recorded only as a basis reference for land category) |
| **Administrative Court** | Hears appeals against planning decisions and section 73 notices | Appeals and their outcomes are **recorded** by staff. No court interface |
| **Private-practice surveyor** | Their own projects; contracted work for a council | Through SurveyPro; their private projects are invisible to any council |
| **Finance system (ERP)** | Money: accounts, balances, bills | Signed events out, status bands in. VunGIS holds no amounts. **Built** |
| **Payment gateway** (Paynow) | Card and mobile payments | **Built**, with a webhook |

## 3. Use cases: public and citizen

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| C1 | Explore the map and its layers | Visitor | built | Vector tiles; the council's QGIS styling |
| C2 | Look up "what can I build here" for a place | Visitor | built | From the plan's zoning decisions. Returns "not decided" where the council has not decided |
| C3 | Look up a parcel (public identify) | Visitor | built | Stand, township, ward, area, land category. No personal data |
| C4 | Register an account; verify residency | Applicant | built | Residency by title deed (instant, against the simulated registry), lodger's permit, settlement letter, rates statement, or a chief's letter, decided by staff |
| C5 | Lodge a development application | Applicant | built | Includes plan upload and automatic plan pre-review |
| C6 | Pay application and inspection fees | Applicant | built | Quote, pay, confirm, receipt |
| C7 | Track an application and read notices about it | Applicant | built | Statutory clocks (acknowledgement within 2 weeks; deemed refusal after 3 months, 4 for a subdivision) |
| C8 | Respond to a public notice | Objector | partial | The notice is published and certified; an objection route for the public is not described in this note and should be confirmed |
| C9 | Appeal a determination | Applicant | built | RTCP Act appeals, within one month of notification |
| C10 | Request an inspection; see its result | Applicant | built | Stage inspections |
| C11 | Receive certificates (permit, occupation) | Applicant | built | |
| C12 | Report unauthorised building | Complainant | built | Anonymous allowed, as a first-class record |
| C13 | Raise a service-desk request | Applicant | built | |
| C14 | Receive a section 73 notice | Owner or occupier | built, on paper | The council records service. The person served appeals to the Administrative Court, not through the portal |
| C15 | Request a rates clearance for a transfer (section 109) | Owner | built | Citizen portal → Rates clearance; staff issue on `/statutory-registers` |

## 4. Use cases: council

### 4.1 Planning and development control

| ID | Use case | Actor | Status |
|---|---|---|---|
| P1 | Receive, register and acknowledge an application | Clerk | built |
| P2 | Check an application against the zoning matrix (P, SC, X) | Planner | built (mechanism; the council's matrix content is not yet decided) |
| P3 | Circulate to departments; consult | Planner | built |
| P4 | Publish a statutory public notice and certify it | EO, clerk | built |
| P5 | Take an application to committee and record the resolution, with quorum | EO, planner | built |
| P6 | Determine an application (permit, special consent, refusal) | EO, planner | built, with deemed-refusal dates |
| P7 | Issue a permit; record fees and rule snapshots | Planner, clerk | built |
| P8 | Record and track an appeal | Planner, clerk | built |
| P9 | Maintain statutory plans and the plan workbench | Planner, admin | built |
| P10 | Prepare and approve the annual district development plan (RDC Act s74) | EO | built | `/statutory-registers?tab=plans` |

### 4.2 Field enforcement

| ID | Use case | Actor | Status |
|---|---|---|---|
| F1 | Take in and triage a complaint; record the site finding | Clerk, inspector | built |
| F2 | Carry out and score stage inspections, with photos and geofence | Inspector | built |
| F3 | Issue a planning enforcement or stop-works order | Inspector, planner, EO | built. It cites a "UDC Act"; check that it cites the right Act |
| F4 | **Draft, issue and serve a section 73 notice; track service on owner and occupier; track the 28 days** | Inspector, planner, EO, clerk | **built** |
| F5 | **Record an appeal against a notice and its outcome** | Clerk, planner | **built** |
| F6 | **Record the council's action on a notice, which the database refuses until the Act allows it** | Inspector, planner, EO | **built** |
| F7 | Recover the expenses of action (section 151) | Council | built | `/statutory-registers?tab=expenses` |
| F8 | Keep the public-health registers; serve abatement notices; issue burial permits | EHO | built |

### 4.3 The GIS Branch and the parcel register

| ID | Use case | Actor | Status |
|---|---|---|---|
| G1 | Find a parcel; open its profile | Any GIS Branch role | built |
| G2 | Edit a layer in a session; submit; approve after QA | GIS tech, GIS data | built |
| G3 | Import an approved general plan from the Survey Section | GIS data, GIS head | built, with validation report and adoption in place |
| G4 | **Record a parcel's land category with its basis and instrument** | GIS roles that may edit layers | **built** |
| G5 | Propose land categories from imported tenure labels | Administrator | built (dry run by default) |
| G6 | Link a parcel to ERP accounts; reconcile structures with no account | GIS data, GIS dev | built |
| G7 | Read accepted survey work into the register (SurveyPro importer) | GIS data, GIS dev | built, scheduled |
| G8 | Issue maps; produce ward summaries and profiles | GIS analyst, GIS clerk | built |
| G9 | Publish symbology from QGIS to the web; push and pull layers with the plugin | GIS head | built |
| G10 | Allocate a stand; revoke an allocation | Planner, administrator | built. The Minister's approval of estate development (s86) is not modelled |
| G11 | Register compulsory acquisition (s78) | EO | built | `/statutory-registers?tab=acquisitions` |

### 4.4 Survey work

| ID | Use case | Actor | Status |
|---|---|---|---|
| S1 | Assign a survey job from the council system | Planner, EO | built (through the API) |
| S2 | Open the job in SurveyPro; see the register around it | Surveyor | built |
| S3 | Declare the SI 727 survey class; check the layout against the register | Surveyor | built |
| S4 | Deliver; accept or return with a note | Surveyor, reviewer | built |
| S5 | Appoint surveyors and reviewers | Head surveyor | built |

### 4.5 Administration

| ID | Use case | Actor | Status |
|---|---|---|---|
| A1 | Provision, suspend and re-role staff | Administrator | built |
| A2 | Read the audit trail; revoke sessions | Administrator | built |
| A3 | Configure zones, controls and the district matrix | Administrator, planner | built |
| A4 | Edit the public website | Administrator | built |
| A5 | Keep a register of by-laws, adopted model-building chapters, tariffs and the resolutions that set them (RDC Act ss76, 88 to 94) | Council, Minister | built | `/statutory-registers?tab=bylaws` |

## 5. Use cases at the boundary with the custodians

| ID | Use case | Direction | Surveyor-General | Deeds Registry | Status |
|---|---|---|---|---|---|
| X1 | Approved plan reaches the register; the council's earlier survey is adopted in place and keeps its identifier | into VunGIS | yes | | built |
| X2 | A boundary disagrees with the plan beyond tolerance; an officer resolves the conflict | into VunGIS | yes | | built |
| X3 | A council survey awaits approval; the register shows its status honestly (origin, SG reference) | within VunGIS | yes | | built |
| X4 | The council sends a diagram or layout to the Surveyor-General for approval | out of VunGIS | yes | | partial — council register `/api/custodian/sg-submissions`; hand courier until SG API |
| X5 | Verify a title-deed number and holder for residency | out and back | | simulation | simulated |
| X6 | Issue the section 109 certificate that all charges for five years are paid, so a transfer can be registered | out of VunGIS | | yes | built (council side); Deeds Registry hand-off remains paper |
| X7 | Notify the council of a sale or subdivision lease (section 116), and its cancellation | into VunGIS | | yes | partial — `/api/custodian/deeds-notices` (manual/CSV); live Deeds feed not available |
| X8 | Record a parcel's land category against a Gazette notice | within VunGIS | | | built; the Minister's declaration itself is outside |
| X9 | A transfer or subdivision changes parcel identity; lineage is kept | within VunGIS | yes | yes | partial (lineage for subdivision and consolidation exists; transfer is not modelled) |

## 6. What this changes, and what is missing

1. **The custodian boundary is the strongest idea in the design and should stay explicit.** The register refuses boundary edits except by an approved plan import. Ownership should be handled the same way: the council should hold a reference to the Registry's record and what the council did, never a copy it can edit.
2. **The Deeds Registry side needs a decision before it needs code.** What will the Ministry of Lands expose, if anything? Until then X5 stays a simulation and X6 and X7 are paper processes the system can only describe. Building X6 first would be a finance feature (a charges ledger), not a Registry feature.
3. **The charges ledger is the biggest missing piece.** C15, X6, F7 and the levies in the Act (Part XII) all hang off one thing: what a stand owes. The council may already run this in its ERP. The right first step is to read a paid-up status from it, as the register already reads a status band, not to build a second ledger.
4. **Two staff actors are under-served.** The Minister's approvals and the by-law and tariff register (A5) are what stop the council acting beyond its powers, and nothing records them. This is a smaller build than the ledger and removes a real legal risk.
5. **Service to the citizen is stronger than service to the owner served with a notice.** The person on the receiving end of a section 73 notice has the most at stake and the least access. Whether they should get a read-only view of their own notice and its 28-day window, with a record that they have seen it, is a design question for the council's legal officer.
6. **A residents' and public-objection use case (C8) should be confirmed against the RTCP Act's notice and objection provisions** before it is described to the public.

## 7. How to read this alongside the rest

- The Act-by-Act mapping is in [architecture/03-rural-district-councils-act.md](architecture/03-rural-district-councils-act.md). The planning anchor is in [architecture/01-standards-review.md](architecture/01-standards-review.md).
- Operating guides by role are in [`../manuals`](../manuals): the administrator (A), the council (B), the surveyor (C) and troubleshooting (D).
- Role permissions are defined in one table, `app-backend/src/config/permissions.js`, and the screens hide what the server would refuse.
- This note describes use cases that exist or are missing. It does not describe what the Surveyor-General's office or the Deeds Registry would agree to; that needs their input.
