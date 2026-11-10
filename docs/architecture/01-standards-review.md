# Zoning and land-use data: a review of standards and practice

**Status:** draft v0.2 for discussion · **Date:** 2026-10-07
**Purpose:** decide how the portal should model development-control rules (the "zoning
matrix") for 92 local authorities, not just the two we have samples from. This review
looks at how other jurisdictions solved the same problem. The companion document,
[`02-data-model-proposal.md`](02-data-model-proposal.md), turns it into a design.

## How to read this

Every claim is tagged.

- **[confirmed]**: read in a source during this review (linked at the end).
- **[unverified]**: from my general knowledge, or from a secondary source. It is probably
  right, but check it before relying on it. Some primary sources refused automated access
  (NSW legislation site, ZimLII, the NZ standards PDF), so those details are the weakest.

## 1. What problem are we solving?

Each authority has (or will have) its own plans and its own table saying which land uses
are allowed in which zones. We hold two sample tables, both from rural authorities. They
use different vocabularies, and 62 rural and 32 urban authorities remain. Three questions
follow:

1. **Vocabulary.** Should all authorities share one list of zones and land uses?
2. **Decisions.** Is "permitted / special consent / prohibited" enough?
3. **Evolution.** Plans change. How do we keep the rule that applied on the day an
   application was lodged?

## 2. The frameworks, side by side

| Framework | What is **national** | What is **local** | Takeaway for us |
|---|---|---|---|
| **NSW Standard Instrument LEP** (Australia) | The template, the zone catalogue, the land-use definitions | Which zones apply where; each zone's use table; local additions | Closest to P / SC / X, and a proven way to mix a standard vocabulary with local decisions |
| **NZ National Planning Standards** | Zone framework, definitions, mapping and data formats | Plan content within the framework | Standardise the *shape and vocabulary*, not the rules |
| **Queensland Planning Act 2016** | Categories of development and assessment | Each scheme's table of assessment | A "decision" has two parts: whether it is allowed, and what process applies |
| **England**: Use Classes Order, GPDO, planning.data.gov.uk | Use classes, permitted-development rights, data standards | Local plan policies | A national use-class list lets rules say "change within a class is not development" |
| **EU INSPIRE Planned Land Use** | Data model, HILUCS land-use classification | The plans themselves | Separate the zone as drawn from the land-use class; overlays are their own object; plans have validity dates |
| **US APA LBCS** | Multi-dimensional land-use classification | Local codes mapped onto it | One code can't carry activity, function, structure and ownership at once |
| **ISO 19152 LADM** | Conceptual model of parties, rights, restrictions and spatial units | National profiles | Zoning is a *restriction* on a spatial unit; parcels need a proper model |
| **South Africa SPLUMA** | Duty: one land use scheme covering the whole municipality | Each municipality's scheme | "Wall-to-wall" coverage, including rural and traditional areas, with incremental introduction |
| **Kenya PLUPA 2019** | A hierarchy of plans (national to local) | County plans and development control | Plans nest; permission is needed for change of user |
| **Ghana Act 925 + LI 2384** | Zoning regulations for the whole country | Local zoning plans | National regulations plus local zoning plans, the nearest regional analogue to ours |
| **Zimbabwe RTCP Act [Ch 29:12]** | The Act: plans, permits, special consent | Each authority's plans and tables | Our legal anchor. See §4 |

## 3. Frameworks in detail

### 3.1 NSW Standard Instrument LEP: a standard template with local decisions
- Every council's plan follows one template. **[unverified]** Councils pick zones from a
  fixed catalogue rather than inventing their own.
- Zones are grouped into Business (B), Environment (E), Industrial (IN), Residential (R),
  Recreation (RE), Rural (RU), Special purpose (SP) and Waterways (W). **[confirmed]**
- Each zone has a **land use table**: uses *permitted without consent*, *permitted with
  consent*, and *prohibited*. **[confirmed]** Anything not listed as permitted is
  prohibited. **[unverified]**
- Development that needs no consent still faces separate environmental assessment.
  **[confirmed]**
- Land-use terms come from a defined **dictionary** with groups (for example "agriculture"
  containing sub-types). **[unverified]** Councils can add site-specific permitted uses in
  a schedule. **[unverified]**

**Why it matters:** this is the model the sample matrices most resemble. It shows the
national standard can be the *vocabulary and structure*, while each council fills in its
own decisions.

### 3.2 New Zealand National Planning Standards: standardise the shape
- Introduced by the Resource Legislation Amendment Act 2017; first set published
  November 2019, updated 2022. **[confirmed]**
- Includes a **Zone Framework Standard** (the range of zones plans may use), a
  **Definitions Standard**, and standards for spatial layers, mapping and electronic
  functionality. **[confirmed]**
- Zones with the same intent can differ in specifics (site sizes, setbacks, heights)
  between councils. **[confirmed]**
- Whether councils *must* use a framework zone when their land fits one, and the rule for
  adding zones outside the framework, I could not confirm: the PDF was unreadable to the
  tools. **[unverified]**

**Why it matters:** a national authority can fix zone names, definitions and data
formats without dictating what any council permits.

### 3.3 Queensland: two questions in one cell
- Development is **prohibited**, **accepted** (no application) or **assessable**.
  **[confirmed]**
- Assessable development is either **code assessable** (checked against benchmarks, no
  public notification) or **impact assessable** (assessed against the whole scheme, with
  public notification). **[confirmed]**
- Each planning scheme has a **table of assessment** giving the category per use and
  zone. **[confirmed]**

**Why it matters:** "special consent" hides two things: *that* it is allowed with
conditions, and *which process* applies (notice, objections, who decides). Queensland
keeps them apart. Our matrix can start with three values and still record the process.

### 3.4 England: use classes and a national data platform
- A **Use Classes Order** groups uses into classes. A change of use *within* a class is
  not development. Permitted-development rights sit in a separate order. **[confirmed]**
- Class E (commercial, business and service) was introduced on 1 September 2020 to ease
  town-centre change. **[confirmed]**
- The **planning data platform** gathers datasets from hundreds of organisations under
  published **data standards**: conservation areas, listed buildings, article 4
  directions, tree preservation orders, plans including local plans, and more.
  **[confirmed]**

**Why it matters:** a published, versioned data standard lets many small organisations
contribute consistent data, which is exactly our onboarding problem.

### 3.5 EU INSPIRE Planned Land Use and HILUCS
- **SpatialPlan**: the plan as a document. **ZoningElement**: a spatial object
  homogeneous in permitted uses. **SupplementaryRegulation**: rules that *overlap* the
  zoning and add limits. **[confirmed]**
- A ZoningElement carries one or more **HILUCS** land-use values, one or more specific
  (local) land-use values, a **regulation nature** (how binding), optional **valid-from /
  valid-to** dates, and a **dimensioning indication** (heights, coverage and so on).
  **[confirmed]**
- **HILUCS** is a three-level land-use classification with six top-level classes: primary
  production, secondary production, tertiary production (services), transport networks and
  logistics, residential use, and other uses. **[confirmed]**

**Why it matters:** it separates the *zone as drawn*, the *standard land-use class* and
the *local land-use value*, with dates and bindingness. Overlays are first-class.

### 3.6 US APA Land-Based Classification Standards (LBCS)
- Five dimensions: **activity**, **function**, **structure type**, **site development
  character** and **ownership**. It updated the 1965 SLUCM. **[confirmed]**

**Why it matters:** a single letter code (our A, B, D...) conflates "what happens" with
"what building it is". We need not model all five, but we should not pretend one code is
a universal classification.

### 3.7 ISO 19152 LADM: parties, rights, restrictions, spatial units
- A conceptual model with packages for **parties**, **basic administrative units and
  rights / responsibilities / restrictions (RRR)**, and **spatial units**, plus sources and
  versioned objects. It aims to be profiled nationally and to combine land information from
  different sources. Parts 1 (2024), 2 (2025) and 3 (marine, 2024) exist. **[confirmed]**
- Reading zoning as a *restriction* attached to a spatial unit is my interpretation, not a
  quotation. **[interpretation]**

**Why it matters:** parcels, owners and zoning restrictions already live in our database
loosely. LADM is the vocabulary to align to as that grows, not something to adopt now.

### 3.8 Africa: the closest comparators
- **South Africa, SPLUMA 2013.** Each municipality adopts *one* land use scheme for its
  *entire* area within five years. It must contain zoning categories and regulations for
  all land, including rural and informal areas, and must allow the *incremental
  introduction* of land-use management in traditional and rural areas. **[confirmed]**
- **Kenya, PLUPA 2019** (in force 5 August 2019): national, county, inter-county and local
  plans are integrated. Subdivision, amalgamation, change of user and building plans need
  development permission, issued by the county. **[confirmed]**
- **Ghana, Act 925 (2016) and the Zoning and Land Use Regulations 2019 (LI 2384):** a
  national act plus detailed national zoning regulations that districts apply in their
  zoning plans. I could not find the permit categories in the results. **[partly
  confirmed]**

### 3.9 Zimbabwe: the legal anchor
- The Regional, Town and Country Planning Act [Chapter 29:12] commenced 1 November 1976,
  with 75 sections in 11 Parts, including Master and Local Plans, Control of Development,
  and Subdivision and Consolidations. It provides plans and a permit system.
  **[confirmed]**
- **Section 26:** a person intending to alter the character of the use of land or a
  building applies to the local planning authority for a permit; the authority may refuse
  or grant it with conditions. **26(3)** is the **special consent** route for development
  not normally permitted in a zone. **[confirmed from secondary sources; check the Act
  text]**
- In this repository, the council letter in the *Development Management/Control Manual
  2021* describes the 26(3) process: **public notice at the applicant's expense, with
  adjacent and possibly other landowners notified**. **[confirmed, from the repo]**
- Reported, not verified: the model building by-laws in use have not been updated since
  1977.
- **The Rural District Councils Act [Chapter 29:13] is the second anchor.** It was not in
  this review at first. It supplies what the RTCP Act assumes: the council as a body
  corporate, the five land categories (s2, s3), enforcement of conditions of title (s73),
  by-laws (ss88 to 94), levies, rates and charges (Part XII) and the clearance certificate
  before a transfer (s109). **[confirmed from the Act text; see
  [03-rural-district-councils-act.md](03-rural-district-councils-act.md)]**
- **Combination authorities.** The project lead states that when two local authorities
  overlap, a combination authority is created. I could not confirm this in the Act (Part III,
  "Local Planning Authorities", is where I would expect it, but the text was not readable by
  the tools). Treat the term and the mechanism as **[unverified]**. The comparison is
  SPLUMA's single whole-municipality scheme and Kenya's inter-county plans, both ways of
  planning across a boundary.

## 4. Lessons, and what each means for us

| # | Lesson | Seen in | Implication |
|---|---|---|---|
| 1 | **Standardise vocabulary and structure; leave decisions local.** | NSW, NZ, Ghana | Keep each authority's own matrix. Add a shared land-use dictionary and map codes to it. |
| 2 | **Zone, land use and process are different things.** | Queensland, INSPIRE | Do not store "special consent" as a bare value. Link it to a defined process. |
| 3 | **A plan is a dated legal document, with versions.** | INSPIRE (valid dates), England | Version every matrix. Keep the rules that applied on the lodgement date. |
| 4 | **Overlays are their own layer with their own rules.** | INSPIRE (SupplementaryRegulation) | Model constraints (wetlands, heritage, flood) separately. They modify a zone's outcome. |
| 5 | **Publish a data standard and validation tooling.** | England, NZ | The import validator we built is the seed. Publish the format. |
| 6 | **One code cannot classify everything.** | LBCS | Keep local codes. Map them to a standard class. Do not force uniform codes. |
| 7 | **Cover the whole area, including rural land, incrementally.** | SPLUMA | Our rural authorities match this. Allow partial coverage, with blanks meaning "not decided". |
| 8 | **Plans nest (national, region, district, local).** | Kenya, Zimbabwe | A district matrix and a local-plan table can both exist for the same land. Model the level. |
| 9 | **Let authorities share a template, then override.** | NSW standard instrument | 60 rural authorities may adopt one district matrix and change a few cells. |

## 5. What our two samples tell us, and what they do not

- **They show:** a real district-level matrix (11 zones × 32 coded uses, P / X / SC, with
  blanks) and a local-plan zone set (peri-urban zones). The project lead says one sample
  belongs to Vungu RDC and the other to Chipinge RDC. The matrix's own footnote says
  *each local plan proposes its own table for its plan area*. That matches lessons 3 and 8.
- **They do not show:** how an **urban** authority works (use classes, density, floor-area
  ratio, parking, precincts). Both samples are rural. Urban needs cannot be inferred.
- **Settled:** "P" means *permitted*, as the matrix legend says. Whether the s26(1) permit
  process still runs for a permitted use is a process question, not a property of the
  matrix. Compare NSW "without consent" and "with consent".
- **Possibly relevant:** the repo's master-plan symbology already lists "Zones 1A to 11".
  If that is a national standard zone set, lesson 1 changes shape. Needs confirming with
  the Department of Physical Planning.

## 6. What this review did not cover

- The primary text of NSW SI LEP, NZ standards and the Zimbabwe Act (access blocked or
  unreadable). Items tagged unverified need checking against them.
- Urban-specific frameworks (form-based codes, density and parking regimes).
- Data-governance experience: who maintains a national dictionary, and how councils
  request changes.
- Any Zimbabwean national standard for use classes or model zoning. I found none online;
  that is not proof none exists.

## Sources

- NSW: [Standard Instrument Principal LEP (EPI 2006/155a)](https://legislation.nsw.gov.au/view/whole/html/inforce/2008-01-01/epi-2006-155a)
- NZ: [National Planning Standards, November 2019 (updated 2022)](https://environment.govt.nz/assets/publications/national-planning-standards-november-2019-updated-2022.pdf) · [Zone framework standard](https://www.mfe.govt.nz/assets/Publications/Files/2G-zone-framework-standard.pdf)
- Queensland: [Planning Act 2016](https://www.legislation.qld.gov.au/view/whole/pdf/current/act-2016-025/lh) · [categories of assessment (Diamantina fact sheet)](https://www.diamantina.qld.gov.au/downloads/file/627/fact-sheet-categories-of-assessment-development)
- England: [planning data platform](https://planning.data.gov.uk/about) · [Use Classes Order reference guide](https://cms.law/en/gbr/legal-updates/use-class-order-reference-guide)
- EU: [INSPIRE Planned Land Use (Norwegian object catalogue)](https://objektkatalog.geonorge.no/Pakke/Index/EAPK_F4311AC6_9188_4d1a_BCCC_E8AB484DF103) · [ZoningElement attributes](https://objektkatalog.geonorge.no/Objekttype/Index/EAID_B434F50A_427F_40c6_97A7_2F00B24D70B0) · [HILUCS (Beaumont et al. 2021)](https://geoportail.wallonie.be/files/documents/Beaumont_etal_2021.pdf)
- US: [APA LBCS](https://planning.org/lbcs/standards)
- ISO: [ISO 19152-1:2024](https://www.iso.org/standard/81264.html) · [LADM (ISO 19152:2012)](https://iteh.es/catalog/standards/iso/87ac75db-bd46-45ce-9e63-65786efa13e6/iso-19152-2012)
- South Africa: [SPLUMA s24 Land use scheme](https://www.acts.co.za/spatial-planning-and-land-use-management-act-2013/24__land_use_scheme.php)
- Kenya: [Physical and Land Use Planning Act 2019](https://new.kenyalaw.org/akn/ke/act/2019/13)
- Ghana: [Land Use and Spatial Planning Act 2016 (Act 925)](https://leap.unep.org/en/countries/gh/national-legislation/land-use-and-spatial-planning-act-2016-no-925-2016)
- Zimbabwe: [Regional Town and Country Planning Act [Chapter 29:12] on ZimLII](https://zimlii.org/akn/zw/act/1976/22/eng@2016-12-31) (the full text was not readable by the tools, so section 26 below is from secondary sources). Secondary sources seen in search results, not read in full: [Mukamba, Understanding development control in Zimbabwe](https://mukamba.co.zw/2025/05/30/understanding-development-control-in-zimbabwe-your-first-steps/) · [a Scribd copy of the Act](https://www.scribd.com/document/617799776/ZIMBABWE-REGIONAL-TOWN-AND-COUNTRY-PLANNING-ACT-CHAPTER-29-12) · [an evaluation of development control 1976 to 1996](https://www.academia.edu/65437445/Parameter_and_practice_of_development_control_in_Zimbabwe_An_evaluation_of_the_System_of_Development_Control_with_emphasis_on_the_Determination_of_Planning_Permission_Applications_and_Appeals_1976_to_1996)
