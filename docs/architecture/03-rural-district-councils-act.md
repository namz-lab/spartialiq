# The Rural District Councils Act and this application

**Status:** working note, 13 October 2026. It maps the provisions of the Rural District Councils Act [Chapter 29:13] that bear on land administration to what VunGIS holds. Provisions were read from an amended consolidation of the Act (Acts 8/1988 to 3/2009, 7,000 lines of extracted text). Section numbers and wording should be checked against the Gazetted version before anything here goes into a user-facing document or a published paper. The text was read with automated extraction, so the sections quoted below are checked against it, and sections that are not quoted were not.

## 1. Why a second Act

Until now the application's legal anchor has been the Regional, Town and Country Planning Act [Chapter 29:12] ("the RTCP Act"): plans, permits, special consent, subdivision, appeals. That Act says what may be built and how permission is given. It does not say who the council is, what land it administers, what it may charge, or how it enforces the conditions on a title. The Rural District Councils Act ("the RDC Act") does, and a system built for a rural council needs both.

| | RTCP Act [Ch 29:12] | RDC Act [Ch 29:13] |
|---|---|---|
| Subject | Land-use planning and permission | The council as an institution and its powers over land and money |
| Gives the council | Master and local plans, the permit and special-consent process, subdivision, appeals | Corporate existence, wards and committees, by-laws, levies and rates, charges, enforcement of title conditions, estate development, compulsory acquisition |
| In the application | Permits, the decision pathways, statutory clocks (migration 170), the plan register (101), appeals | Land category (migration 179), committee meetings (83, 104), stand allocation (105). Little else yet |
| Acts it points to | The Land Survey Act | The Communal Land Act, the Land Acquisition Act, the Urban Councils Act (model building by-laws), the Deeds Registries Act (via s109) |

The RDC Act is rural. Urban authorities fall under the Urban Councils Act [Chapter 29:15]. The profile design in [02-data-model-proposal.md](02-data-model-proposal.md) already separates rural and urban plans, so anything built from the RDC Act belongs in the rural profile and must not be assumed for an urban authority.

## 2. What the Act provides, and where the application stands

Status: **built** = in the application and tested; **partial** = something exists but does not carry the Act's rule; **not built** = nothing yet.

| Provision | What the Act says | Where it would live | Status |
|---|---|---|---|
| **s2, s3** land categories | Five categories: Communal Land, large-scale commercial, small-scale commercial, resettlement, urban. The Minister may declare the last four by Gazette notice, after consulting the council. | `land.parcel.land_category`, with basis and reference (migration 179) | **built** (see §3) |
| **s73** enforcement of conditions of title | The council must see that township conditions and title conditions are observed. It may demolish without compensation a building wilfully erected in breach, prohibit the use of a building or land, or do the work and recover the cost. It must first serve notice on the owner and the occupier. Where the condition restricts use or building and is controlled by a scheme or plan under the RTCP Act, the person served has 28 days to appeal to the Administrative Court, and the council may not act until the appeal is decided or withdrawn. | The complaints register (migration 120) finds the contravention; `title_notice` and its service, appeal and action records serve and gate it (migration 180) | **built** (see §4) |
| **s74, s60** development functions | The council prepares an annual district development plan, drafted by its rural district development committee; council approves it before 1 August and sends it to the provincial development committee with its latest estimates. | Planning projects (095), statutory plans (101) | **not built**: no annual cycle or 1 August deadline |
| **s76** charges by resolution | Fees and tariffs for certificates, licences, permits and inspections are fixed by council resolution; the proposal must be posted and published for at least 30 days; if 30 or more voters object, it needs a majority of the full membership. | Fees (migration 064) | **not built**: fees are configured, not tied to a resolution or the notice period |
| **s77** entry and inspection | Authorised officers may enter premises at reasonable times; without consent only so far as necessary in the interests of public safety, public health or town planning, for enforcement, or for levies. | Inspector workflow (116, 117) | **partial**: inspections exist; authorisation and notice of entry are not recorded |
| **s78** compulsory acquisition | With the Minister's written consent, for public health, planning or public benefit; the Land Acquisition Act applies. | Parcel lifecycle | **not built** |
| **s86, s87** estate development | The council may lay out, service and dispose of land for housing, commerce and industry, subject to the Minister's approval; where no plan or scheme is operative the proposal must first be advertised in two issues of a newspaper with at least 21 days for objections. | Stand allocation (105), available stands (076) | **partial**: allocation exists; the Minister's approval and the advertised-objections step do not |
| **ss88 to 94** by-laws | By-laws are exhibited, objections heard within 14 days, passed by the council and approved by the Minister (deemed approved after 6 months' silence). A council may adopt the model building by-laws, in whole chapters, for part of its area, phased in. | Plan review (065) | **not built**: no register of by-laws in force or of which model-building chapters are adopted |
| **ss96 to 107** levies and rates | Rural land bears land development levies (s96); urban land bears rates and levies (ss98 to 102); notice, abatements and interest are prescribed. | Property register (084) | **not built** |
| **s109** certificate before transfer | A Deeds Registry may not register a transfer of land in a council area unless the council certifies that all charges for the last five years are paid. | Property register, public lookup | **not built** |
| **s116** sales and leases reported | The registered owner must tell the council of an agreement of sale or a subdivision lease, and of its cancellation. | Parcel events (175) | **not built** |
| **s150** common property | Roads and other common-right land in urban land vest in the council. | Parcels, roads | **not built** |
| **ss46 to 52** meetings | Quorum, open meetings, minutes, rescission of resolutions. | Committee meetings (083, 104) | **partial**; not checked against these sections |
| **ss56, 59, 76(5)** area and ward committees | Charges and by-laws in an area are first considered by its committee. | The ward layer | **not built** |
| **s53, s90** Minister's approval | Certain resolutions and by-laws take effect only when the Minister approves. | Planning revisions (096) | **partial**: no "awaiting the Minister" state |

## 3. Land category (built)

**What it is.** A legal classification of land in the council's area, set out in section 2 and extended by Gazette notice under section 3. It is not a zone (which says what may be done on the land), and not the tenure word an import supplied (migration 164's `tenure_class`: Commercial, Purchase, City, State Land and so on, which are evidence for a category but not the category and not all categories).

**What was built** (migration 179, `src/services/gms/landCategory.js`, `src/routes/gms.js`, the Land category panel on the parcel profile):

- `land.land_category` holds the five categories with the Act's definitions. `land.parcel.land_category` is **never defaulted**: blank means not recorded.
- A recorded category carries a **basis** (`gazette`, `statutory_definition`, `council_record`) and a **reference** (the notice or instrument), required for the first two. The database enforces this, plus the rule that Communal Land cannot rest on a Gazette declaration (section 3 lists four categories and Communal Land is not among them).
- Every change is an append-only `land.parcel_event` row (`category_set`) holding what the parcel held before and who changed it.
- `GET /api/gms/land-categories`, `PUT /api/gms/parcels/:id/land-category`, and the category on the parcel profile, the register search (`?category=`, with `unrecorded`), the ward summary (counts by category) and the public identify. Roles that may edit layers can set it.
- `scripts/suggest-land-category.js` proposes categories from `tenure_class` and records them, if told to, as council records. It is a dry run by default.

**State of the register (13 October 2026):** 731 current parcels, none recorded. A proposal from the tenure words: 59 Purchase, 6 Resettlement and 2 Communal are strong matches; 533 Commercial are probable large-scale commercial; 95 City, 29 State Land and 7 blank have no proposal. The script has been run in dry-run mode only.

**Why it matters for what comes next.** The category is the key that selects the rest of the Act: whether the rural levy (s96) or the urban rates (ss98 to 102) apply, how a ward is classed (communal, commercial, resettlement or urban ward, s2), and whether the title-condition enforcement of s73 has a condition to enforce at all. Communal Land is occupied under permits (the Act mentions permits under section 9 of the Communal Land Act in its levy provisions), so a notice about a title condition probably does not arise there. That is an inference, not something the Act says, and it should be confirmed.

**Open questions for the council.**

1. Is the Gazette reference for each reclassification available, or will most categories rest on `council_record` for now?
2. Is "Commercial" on the farm map large-scale commercial throughout, or does it include land the Minister has re-declared?
3. Should an urban authority's parcels be given the same field? The Urban Councils Act has its own scheme, so this should not be assumed.

## 4. Section 73: notice before action (built)

**What the Act requires.** The council must see that the conditions of a township's establishment and of title are observed. It may demolish without compensation a building wilfully erected in breach, prohibit the use of a building or land that breaches a condition, or do the work a condition requires and recover the expense (s73(1)). Before any of that it serves notice on the owner and on the occupier, specifying the action proposed and the grounds (s73(2)). Where the condition restricts use, sets requirements for erecting a building, or is controlled under an approved scheme or plan, the person aggrieved has 28 days after service to appeal to the Administrative Court and the council may take no action until the appeal is determined, withdrawn or abandoned (s73(3)). The court dismisses the appeal if the council is entitled to act on the grounds in the notice, and allows it if not (s73(4)).

**What was built** (migration 180, `src/services/titleNotice.js`, `src/routes/title-notices.js`, `/title-notices` in the frontend):

- `title_notice`: the condition, its class, the action proposed (demolish, prohibit use, execute work), the grounds, and where. A demolition must say the building was wilful; work must be described; no occupier needs a recorded reason. A notice may follow a **substantiated** complaint. It is **frozen once issued**, because what was served is what the council is held to, and is withdrawn, never deleted.
- `title_notice_service`: each service on the owner, the occupier, or one person who is both, with date, method and proof. Kept as made.
- `title_notice_appeal`: an appeal and its outcome (dismissed, allowed, withdrawn, abandoned). An appeal needs a prior service and cannot predate it; once decided the outcome stands.
- `title_notice_action`: what the council did. Append-only, and **the insert is refused** unless the notice allows it.
- `title_notice_stage()` is the one place the rules are computed: `draft`, `awaiting_service`, `window_open`, `appeal_pending`, `appeal_allowed`, `may_act`, `actioned`, `withdrawn`. The database gate and every screen read it, so they cannot disagree. The council may act only at `may_act`, and only as the notice said it would.
- Routes under `/api/title-notices` and a staff screen at `/title-notices` (linked from a parcel's profile). The notice text to serve is generated from the issued record. Its wording is a **draft for the council's legal officer**.
- Tests: 21 unit tests of validation and the notice text; 19 live-database tests that walk each rule (both parties served, the 28 days from the last service, appeals in each outcome, the action matching the notice, the gate holding against a direct insert, and tenancy).

**Decisions made that the council's legal officer should confirm.**

1. *The 28 days.* Counted as calendar days from the day after service, from the **last** service when the owner and occupier were served on different days (so serving the occupier late restarts the wait). The Interpretation Act's treatment of a last day that falls on a weekend or public holiday is **not** applied. It is one function, `title_notice_window_closes()`.
2. *Conditions without the appeal right.* Section 73(3) gives the appeal only for the three classes above. For any other condition the gate needs service only, and the Act sets no waiting period. Whether natural justice requires more is a legal question.
3. *An appeal recorded late.* An appeal lodged after the window is still recorded and still blocks action until the council records its outcome; whether it is out of time is for the court.
4. *Who may do what.* Drafting: planner, building inspector, EO, admin. Issuing and withdrawing: planner, EO, admin. Recording service and appeals: those plus the planning clerk. Acting: planner, building inspector, EO, admin. These are defaults.
5. *Existing enforcement orders.* `spatial_planning.enforcement_order` (migration 070) is a separate planning-enforcement instrument. Its comments cite a "UDC Act" section 34 and it uses a 30-day compliance period; it was left untouched. Whether it cites the right Act should be checked.

**Not here.** Recovery of the expenses (s151, by action in the magistrate's court) and any ledger: the amount is only recorded. Entry to inspect (s77) is not modelled.

## 5. Order of work

1. Land category (done).
2. Section 73 notice workflow (done). Manuscript, manuals and this note updated.
3. Charges ledger and the section 109 certificate. This is a finance system. The council may already run one; a certificate could read a status from it instead of duplicating it. To be decided with the council.
4. A register of by-laws, adopted model-building chapters and tariffs (ss76, 88 to 94), so that plan review and fees cite a record.
5. The section 116 notification and the section 86 approval steps, as small state additions to the parcel and stand flows.

## 6. Cautions

- The Act's text was extracted from a PDF: some sentences are out of order and some words are missing in the extraction. Quote it only after checking the Gazetted version.
- The Act has been amended many times (the consolidation lists amendments to 2009). A later amendment could have moved or changed a provision here.
- A claim that a provision is "not built" means nothing in this repository implements it. It does not mean the council does not do it on paper.
