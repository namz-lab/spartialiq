"""
Munyaradzi Namailinga — LEVEL 3.2 STUDENT REPORT 2
MSU Faculty of Science and Technology guidelines.
Times New Roman; headings 14; body 12; 1.5 spacing; justify; in-text citations.
"""
from docx import Document
from docx.shared import Pt, Inches, Twips
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import shutil

OUT = r"c:\Users\munya\Desktop\finale\WRL 2\WRL\Munyaradzi_Namailinga_WRL_Level32_Report2_R243100H.docx"

doc = Document()
for sec in doc.sections:
    sec.top_margin = Inches(1.0)
    sec.bottom_margin = Inches(1.0)
    sec.left_margin = Inches(1.25)
    sec.right_margin = Inches(1.0)


def set_run(run, size=12, bold=False, italic=False):
    run.font.name = "Times New Roman"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Times New Roman")
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic


def para(text, size=12, bold=False, italic=False, align=WD_ALIGN_PARAGRAPH.JUSTIFY,
         space_after=6, space_before=0, first_indent=True, center=False):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER if center else align
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    pf.space_before = Pt(space_before)
    pf.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    if first_indent and not center and align == WD_ALIGN_PARAGRAPH.JUSTIFY:
        pf.first_line_indent = Inches(0.5)
    r = p.add_run(text)
    set_run(r, size=size, bold=bold, italic=italic)
    return p


def heading(text, center=False):
    """Guideline: Font Size 14 for Headings and Sub-headings."""
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER if center else WD_ALIGN_PARAGRAPH.LEFT
    pf = p.paragraph_format
    pf.space_before = Pt(14)
    pf.space_after = Pt(8)
    pf.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    pf.first_line_indent = Inches(0)
    r = p.add_run(text)
    set_run(r, size=14, bold=True)
    return p


def subheading(text):
    heading(text, center=False)


def body(text):
    return para(text, size=12, first_indent=True)


def body_no_indent(text):
    return para(text, size=12, first_indent=False)


def bullet_like(text):
    """Numbered-style line without Word list (stable formatting)."""
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    pf = p.paragraph_format
    pf.space_after = Pt(4)
    pf.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    pf.left_indent = Inches(0.4)
    pf.first_line_indent = Inches(0)
    r = p.add_run(text)
    set_run(r, size=12)


def page_break():
    doc.add_page_break()


def toc_line(text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    pf = p.paragraph_format
    pf.space_after = Pt(2)
    pf.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    r = p.add_run(text)
    set_run(r, size=12)


def add_table(headers, rows):
    t = doc.add_table(rows=1 + len(rows), cols=len(headers))
    t.style = "Table Grid"
    for i, h in enumerate(headers):
        cell = t.rows[0].cells[i]
        cell.text = ""
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(h)
        set_run(r, size=12, bold=True)
    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            cell = t.rows[ri + 1].cells[ci]
            cell.text = ""
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            r = p.add_run(str(val))
            set_run(r, size=11)
    doc.add_paragraph()


# ═══════════════════════════════════════════════════════════════════════════
# COVER / LETTERHEAD (as supplied)
# ═══════════════════════════════════════════════════════════════════════════
para("MIDLANDS STATE UNIVERSITY", size=14, bold=True, center=True, first_indent=False, space_after=2)
para("P. BAG 9055                    Tel. (263) 54 260450/260464", size=11, center=True, first_indent=False, space_after=0)
para("Gweru.                              260404/260525 260632/260596", size=11, center=True, first_indent=False, space_after=0)
para("Zimbabwe                         FAX: (263) 54 260233", size=11, center=True, first_indent=False, space_after=10)

para("FACULTY OF SCIENCE AND TECHNOLOGY", size=14, bold=True, center=True, first_indent=False, space_after=4)
para("Department of Computer Science", size=14, bold=True, center=True, first_indent=False, space_after=12)

para("WORK RELATED LEARNING STUDENT’S REPORT", size=14, bold=True, center=True, first_indent=False, space_after=4)
para("LEVEL 3.2: STUDENT REPORT 2", size=14, bold=True, center=True, first_indent=False, space_after=12)

para("Industrial Attachment at the Midlands State University", size=12, center=True, first_indent=False, space_after=2)
para("Research and Innovation Hub", size=12, bold=True, center=True, first_indent=False, space_after=2)
para("Vungu Rural District Council GIS Project (SpartialIQ)", size=12, bold=True, center=True, first_indent=False, space_after=14)

para("Munyaradzi Namailinga", size=12, bold=True, center=True, first_indent=False, space_after=2)
para("R243100H", size=12, center=True, first_indent=False, space_after=2)
para("Bachelor of Science Honours Degree in Computer Science", size=12, center=True, first_indent=False, space_after=2)
para("Period of attachment: 23 February 2026 to 18 October 2026", size=12, center=True, first_indent=False, space_after=2)
para("Industrial Supervisor: Dr Paradzayi", size=12, center=True, first_indent=False, space_after=2)
para("Report Date: October 2026", size=12, center=True, first_indent=False, space_after=8)

page_break()

# ═══════════════════════════════════════════════════════════════════════════
# i. ABSTRACT
# ═══════════════════════════════════════════════════════════════════════════
heading("ABSTRACT", center=True)
body(
    "This Work-Related Learning (WRL) Report 2 presents an evaluation of the industrial "
    "attachment undertaken by Munyaradzi Namailinga (R243100H) at the Midlands State "
    "University Research and Innovation Hub, working on the Vungu Rural District Council "
    "Geographic Information System (GIS) project, also known in the development repositories "
    "as SpartialIQ. The report follows the Level 3.2 Student Report 2 guidelines issued by "
    "the Department of Computer Science, Faculty of Science and Technology (Midlands State "
    "University, n.d.)."
)
body(
    "The placement period covered in this reflective report is 23 February 2026 to "
    "18 October 2026. The first report (Level 3.1) introduced the host organisation, the "
    "Vungu GIS system context, and the early technical work. This second report reflects on "
    "expectations versus workplace reality, the relevance of assignments to the Bachelor of "
    "Science Honours Degree in Computer Science, personal and professional development, "
    "conflict between personal and organisational objectives, re-entry to the university, "
    "and recommendations to both the university and the host organisation."
)
body(
    "The main product work was backend and database engineering for a municipal planning "
    "information system: security remediation, PostgreSQL with PostGIS, Fastify application "
    "programming interfaces (APIs), Handbook-aligned schema design, statutory registers, "
    "automated deploy checks, an Acua sub-plot layer, and a Windows desktop installer for "
    "Hub demonstrations. Shared Hub calendar activities such as the Zimbabwe International "
    "Trade Fair (ZITF) pitching support, MSU Expo exhibition, pitching afternoons, workshops "
    "and day-to-day information and communication technology (ICT) support (including printer "
    "faults) formed part of the learning environment, while product ownership remained on "
    "the Vungu GIS system (Ngulube, 2026; Midlands State University Research and Innovation "
    "Hub, 2026)."
)
body(
    "Keywords: Work-Related Learning; Level 3.2 Report; MSU Research and Innovation Hub; "
    "Vungu RDC; GIS; SpartialIQ; PostGIS; professional development; Zimbabwe."
)
page_break()

# ═══════════════════════════════════════════════════════════════════════════
# ii. ACKNOWLEDGEMENTS
# ═══════════════════════════════════════════════════════════════════════════
heading("ACKNOWLEDGEMENTS", center=True)
body(
    "I would like to express my sincere appreciation to everyone who supported me during "
    "my Work-Related Learning at the Midlands State University Research and Innovation Hub."
)
body(
    "My special thanks go to my industrial supervisor, Dr Paradzayi, Project Manager for "
    "the Vungu Rural District Council GIS project, for his guidance, high standards and "
    "willingness to review both code and documentation in detail. His insistence that "
    "claimed use cases must exist in the running system shaped the honesty of this "
    "attachment."
)
body(
    "I am also grateful to Rafiq, the project research assistant, for setting clear research "
    "briefs and for thorough feedback on schema, normalisation and verification notes. "
    "Thanks go to Theophelos Madzinga for consistent collaboration on the frontend and map "
    "interfaces, and to planning officers at Vungu Rural District Council for their time "
    "during the site visit and the formal system demonstration."
)
body(
    "Appreciation is extended to Hub staff and fellow Hub students who shared workshop, "
    "pitching and expo weeks, and to the Department of Computer Science at Midlands State "
    "University for organising the WRL programme and for the academic foundation in "
    "databases, security, web systems and networks. Finally, I thank my family and friends "
    "for continuous support throughout the attachment and academic journey."
)
page_break()

# ═══════════════════════════════════════════════════════════════════════════
# iii. DEDICATION
# ═══════════════════════════════════════════════════════════════════════════
heading("DEDICATION", center=True)
body(
    "This report is dedicated to my family, whose support, encouragement and belief have "
    "been a constant source of strength throughout my academic and professional journey."
)
body(
    "Special dedication is also extended to Dr Paradzayi, Rafiq, Theophelos Madzinga and "
    "the MSU Research and Innovation Hub team for mentorship and for the opportunity to "
    "contribute to a live municipal GIS system that serves a real local authority."
)
page_break()

# ═══════════════════════════════════════════════════════════════════════════
# iv. TABLE OF CONTENTS
# ═══════════════════════════════════════════════════════════════════════════
heading("TABLE OF CONTENTS", center=True)
for line in [
    "Abstract",
    "Acknowledgements",
    "Dedication",
    "Table of Contents",
    "1. Preamble",
    "2. Expectations vs Reality",
    "    2.1 Expectations vs Reality",
    "    2.2 WRL assignments and relevance to degree programme",
    "3. Personal and professional development",
    "    3.1 Key skills developed",
    "    3.2 Personal development",
    "    3.3 Handling conflict between personal and organisational objectives",
    "4. Evaluation and Recommendations",
    "    4.1 Re-entry into the university",
    "    4.2 Recommendations to the university",
    "    4.3 Recommendations to the company",
    "5. Conclusion",
    "6. References",
]:
    toc_line(line)
page_break()

# ═══════════════════════════════════════════════════════════════════════════
# 1. PREAMBLE
# ═══════════════════════════════════════════════════════════════════════════
heading("1. PREAMBLE")
body(
    "This report is the second in the Work-Related Learning series and builds on the "
    "Level 3.1 Report (Report 1), which introduced the host organisation and provided an "
    "overview of the industrial attachment (Midlands State University, n.d.). Report 1 "
    "presented the Midlands State University Research and Innovation Hub as the day-to-day "
    "placement organisation and described the Vungu Rural District Council GIS engagement "
    "as the live client project. It outlined Education 5.0 expectations, the role of the "
    "Hub in hosting student innovators, and the project team structure under Dr Paradzayi, "
    "with backend responsibilities assigned to the author and frontend responsibilities "
    "assigned to Theophelos Madzinga."
)
body(
    "The first report also examined the technical context of the Vungu system: a "
    "web-based municipal planning information system intended to support ward maps, stand "
    "identification, development permit workflows and related council registers. It "
    "summarised early work on security remediation of the prototype, provisioning of "
    "PostgreSQL with PostGIS, initial REST API development, Docker-based local stacks, "
    "the March site visit to Vungu planning offices, and the April demonstration to "
    "council officers. Research and documentation outputs from the first phase, including "
    "Handbook study, schema refinement and normalisation notes, were recorded as foundations "
    "for later implementation (Government of Zimbabwe, 2021a)."
)
body(
    "In addition, Report 1 discussed the industry setting in which rural district councils "
    "operate, the importance of spatial data integrity, and the link between statutory "
    "planning procedures and database design. Several challenges were noted at that stage, "
    "including unfamiliar PostGIS concepts, the density of statutory language in the "
    "Development Management (Control) Handbook, and the need to keep documentation aligned "
    "with working code."
)
body(
    "Building on that foundation, this Level 3.2 report provides a reflective evaluation "
    "of the full attachment experience through to October 2026. It compares initial "
    "expectations with workplace reality, maps assignments to the Computer Science degree "
    "programme, examines personal and professional growth, discusses conflict between "
    "personal learning goals and organisational priorities, and sets out re-entry plans "
    "and recommendations. Technical detail is retained where it explains learning; the "
    "emphasis of Report 2 is evaluation rather than a second full systems specification."
)
body(
    "For completeness, the later attachment months that fell after Report 1 should be "
    "summarised briefly here. From June 2026 onward the team closed gaps that officers "
    "had named after the April demonstration: tenancy-aware staff login repairs, stand "
    "identify with allottee names, a deploy-readiness gate, statutory register APIs and "
    "screens, citizen rates-clearance lodging, Acua sub-plot mapping, property-owner "
    "import preparation, database restore tooling, and a Windows installer for local Hub "
    "demonstrations. Those deliverables are evaluated in the sections that follow rather "
    "than re-specified table by table as in Report 1 (Namailinga, 2026)."
)
body(
    "The logbook that accompanies this report records thirty-four independent working "
    "weeks plus a short October catch-up entry. Shared Hub calendar items—ZITF pitching "
    "support, Tourism Scholastica logistics, robotics challenge packing support, InsurTech "
    "hackathon hosting support, and MSU Expo exhibition—are recorded there with an "
    "explicit GIS role statement so that Report 2 and the logbook remain consistent "
    "(Ngulube, 2026)."
)
page_break()

# ═══════════════════════════════════════════════════════════════════════════
# 2. EXPECTATIONS VS REALITY
# ═══════════════════════════════════════════════════════════════════════════
heading("2. EXPECTATIONS VS REALITY")
subheading("2.1 Expectations vs Reality")
body(
    "At the commencement of my attachment, my expectations were shaped mainly by coursework "
    "and by a general picture of software internships. I expected to spend most days writing "
    "backend code for one clear product, with occasional meetings. I expected that once "
    "features were coded, the hard part would be over. I also expected documentation to be "
    "secondary to programming."
)
body(
    "The reality at the MSU Research and Innovation Hub was broader and more demanding. "
    "The Hub hosts several student tracks at the same time. Peers worked on health platforms, "
    "research assistants, competition products and robotics, and they shared pitching weeks, "
    "expo deadlines and monthly readiness reporting (Ngulube, 2026). My product ownership "
    "remained the Vungu GIS system, but my week often included Hub service: printer faults, "
    "workshop room setup, pitching afternoon support, and exhibition logistics. Engineering "
    "therefore extended beyond programming into requirements honesty, deployment checks, "
    "security, restore drills and public demonstration (Billett, 2011)."
)
body(
    "My exposure to spatial databases exceeded my expectations. Before the placement, "
    "PostGIS, spatial reference identifiers and map vector tiles were largely theoretical. "
    "In practice I designed and repaired stand identify behaviour, parcel locate queries, "
    "MVT layer grants and later an Acua stand_subunit layer for plots of about three hundred "
    "square metres. These tasks showed that a municipal GIS fails quietly when grants, "
    "geometry or tenancy columns drift (PostGIS Development Group, 2024)."
)
body(
    "Security work also differed from my early expectations. I had assumed login was already "
    "acceptable. The prototype stored passwords unsafely and kept database secrets in source "
    "files. Remediation using bcrypt, environment configuration and input validation consumed "
    "early weeks, but it was necessary before trustworthy council demonstrations (OWASP "
    "Foundation, 2021). Later, enabling strict tenancy without matching user columns broke "
    "staff login entirely. That incident taught me that security features and schema must "
    "ship together."
)
body(
    "Client contact exceeded what I imagined for a student attachment. The Vungu site visit "
    "and the formal April demonstration placed real officers in front of the system. Their "
    "requests for sold versus free stands and digital registers became the backbone of the "
    "June to October hardening phase, including statutory registers under the Rural District "
    "Councils Act framework (Government of Zimbabwe, 2021a; Government of Zimbabwe, n.d.)."
)
body(
    "Hub public events also changed my expectations. I had not planned to spend attachment "
    "days on ZITF stand power checks, MSU Expo exhibition, or InsurTech hackathon room "
    "support. Those weeks were real. I treated them as Hub service and GIS demonstration "
    "practice, not as a licence to claim other students’ products as my own."
)
body(
    "Another surprise was how much documentation and testing gatekept “finished” work. "
    "In class, a feature can earn marks from a screenshot or a short viva. At the Hub, "
    "Dr Paradzayi treated unfinished register modules as unfinished even if the use-case "
    "document already named them. Converting skipped checks into required passes on the "
    "deploy harness was therefore not bureaucracy; it was how organisational quality "
    "control worked in practice."
)
body(
    "I also underestimated stakeholder communication. Officers care whether a stand shows "
    "as sold or free, whether a rates clearance request leaves an audit trail, and whether "
    "a demo survives without the developer present. That is why the Windows installer and "
    "restore notes mattered as much as new endpoints. Overall, the attachment exceeded my "
    "initial expectations by combining deep GIS engineering with professional service in a "
    "multi-project innovation environment."
)

add_table(
    ["Area", "Expectation before placement", "Workplace reality", "Lesson"],
    [
        ["Daily work", "One product, mostly coding", "GIS build plus Hub expos, workshops and ICT support", "Prioritise by deadline and consequence"],
        ["Software", "Coding is the main difficulty", "Security, data, tests, docs and demos take equal time", "Engineering is wider than programming"],
        ["GIS", "Maps are mainly a frontend concern", "PostGIS, grants and identify APIs decide map truth", "Spatial data needs backend ownership"],
        ["Security", "Standard login would be enough", "Prototype flaws and tenancy breaks blocked staff", "Use known controls; keep schema aligned"],
        ["Clients", "Supervisors mainly review code", "Council officers judge demos in person", "Listen and write feedback into the backlog"],
        ["Hub events", "Optional side activities", "ZITF, Expo, pitching and hackathon hosting are scheduled", "Support the Hub; keep product claims honest"],
        ["Documentation", "Optional after coding", "Use cases must match running tests", "Undocumented or overstated work is not ready"],
    ],
)

subheading("2.2 WRL assignments and relevance to degree programme")
body(
    "The assignments undertaken during the attachment aligned closely with modules in the "
    "Bachelor of Science Honours Degree in Computer Science. Database systems knowledge "
    "was applied directly when designing PostGIS tables, verifying third normal form, "
    "normalising the Development Control Matrix from a spreadsheet into relations, and "
    "writing data dictionary comments (Codd, 1970; Date, 2015)."
)
body(
    "Software security modules provided the base for the prototype audit, password hashing, "
    "secret handling, production demo-login blocking, and awareness of logging and access "
    "control on statutory registers (OWASP Foundation, 2021; Government of Zimbabwe, 2021b). "
    "Web systems and internet programming concepts underpinned Fastify route design, JSON "
    "validation, JWT authentication and clear API contracts with the frontend developer."
)
body(
    "Operating systems and networks knowledge supported Ubuntu server work, reverse proxy "
    "awareness, local Docker composition, disk-space incidents that stopped PostgreSQL, and "
    "practical ICT support such as printer drivers and shared print queues. Software "
    "engineering and systems analysis were reinforced through Handbook-to-schema translation, "
    "use-case honesty, deploy-readiness scripts and Playwright button crawls across demo roles."
)
body(
    "Geographic information ideas, whether met through elective study or self-directed "
    "reading, became daily practice through ward geometry, stand identify, MVT layers and "
    "QGIS-related pipeline checks with Theophelos. Technical writing skills were exercised "
    "in monthly Hub readiness notes, research notes on SQL versus NoSQL for GIS workloads, "
    "document verification reading for permit uploads, and this Report 2 itself."
)

add_table(
    ["WRL assignment / activity", "Degree area", "Relevance in practice"],
    [
        ["Security remediation and JWT login", "Software Security", "Protected staff and citizen access before demos"],
        ["PostGIS schema, 3NF, DCM normalisation", "Advanced Databases", "Kept planning data consistent and queryable"],
        ["Fastify APIs and stand identify", "Web Systems", "Connected map UI to authoritative data"],
        ["Docker, restore drills, runtime role", "OS / Distributed systems", "Made Hub demos repeatable and safer"],
        ["Handbook and RDC register mapping", "Systems Analysis", "Turned statute into tables and screens"],
        ["Deploy gate and button crawl", "Software Engineering", "Stopped silent regressions before Expo"],
        ["Expo, pitching, workshops, printers", "Professional practice", "Communication and service under pressure"],
        ["SQL/NoSQL and verification notes", "Research methods", "Justified technology choices to supervisors"],
    ],
)
body(
    "Overall, the attachment showed that the first years of the Computer Science programme "
    "are highly applicable when a student is placed on a live system. The main gaps were "
    "domain-specific: PostGIS depth and Zimbabwean planning statutes. Those gaps were closed "
    "through supervised practice rather than through lectures alone."
)
page_break()

# ═══════════════════════════════════════════════════════════════════════════
# 3. PERSONAL AND PROFESSIONAL DEVELOPMENT
# ═══════════════════════════════════════════════════════════════════════════
heading("3. PERSONAL AND PROFESSIONAL DEVELOPMENT")
subheading("3.1 Key skills developed")
body(
    "The Work-Related Learning period enabled me to develop technical and professional "
    "competencies through continuous delivery on the Vungu GIS system and through Hub "
    "service weeks."
)
body(
    "In backend development I became comfortable designing and repairing Fastify routes, "
    "shaping JSON responses for the map portal, and keeping API contracts stable for "
    "Theophelos. In database work I practised PostGIS geometry storage, GiST-related "
    "thinking for spatial lookup, migration discipline, grants to application roles, and "
    "child-table design for Acua sub-units so parent stands were not overloaded (PostGIS "
    "Development Group, 2024)."
)
body(
    "In quality assurance I wrote and expanded an end-to-end deploy readiness harness and "
    "supported Playwright crawls that exercised demo roles, statutory register screens and "
    "citizen rates clearance. These skills turned “it works on my machine” into evidence "
    "suitable for Hub and council demonstrations."
)
body(
    "In operations I learnt restore drills, property-owner import preparation, production "
    "environment examples, blocking of demo accounts in production mode, and packaging of "
    "a Tauri-based Windows installer (SpartialIQ Local) so Dr Paradzayi could run a local "
    "stack without installing Node.js manually."
)
body(
    "Beyond product engineering, I developed ICT service skills common in Hub and office "
    "environments: printer driver installation, paper jam clearing, duplex settings, toner "
    "support, shared printer troubleshooting, and basic AV help before presentations. I also "
    "strengthened presentation skills through Friday reviews, a longer Hub progress talk, "
    "ZITF support days and MSU Expo exhibition of the GIS system."
)
body(
    "Requirements and stakeholder analysis skills grew during the Vungu site visit and "
    "later feedback loops. Observing ward-based paper handling changed how we prioritised "
    "identify behaviour and registers. Similar to peers who met external stakeholders in "
    "other Hub tracks, I learnt to write requirements in the language of the workplace, "
    "then translate them into schema and API changes (Ngulube, 2026)."
)
body(
    "Research and comparative analysis skills were practised in the SQL versus NoSQL note "
    "for GIS workloads and in document verification reading for identity and title deed "
    "uploads linked to applications. Those exercises were not separate from the product; "
    "they justified why PostgreSQL with PostGIS remained the core store for authoritative "
    "spatial and statutory records (Date, 2015; PostGIS Development Group, 2024)."
)

add_table(
    ["Skill", "Evidence from placement", "Development achieved"],
    [
        ["Backend / API development", "Fastify routes, stand identify, registers APIs", "From isolated endpoints to coherent GIS services"],
        ["Spatial databases", "PostGIS stands, MVT grants, Acua subunits", "Geometry and tenancy treated as first-class concerns"],
        ["Security engineering", "bcrypt, env secrets, production demo blocks", "Moved from ad-hoc login to explainable controls"],
        ["Testing and release checks", "Deploy gate; Playwright crawl", "Learnt to refuse fake PASS results"],
        ["Statutory systems analysis", "Handbook and RDC registers to schema/UI", "Linked law-like procedures to data fields"],
        ["Desktop packaging", "SpartialIQ Local installer", "Reduced demo friction for supervisors"],
        ["Pitching and exhibition", "Hub pitches; MSU Expo GIS stand", "Short problem–solution answers under questions"],
        ["ICT service support", "Printers, workshops, room setup", "Service calmness under event pressure"],
        ["Documentation honesty", "USE-CASES and readiness notes vs code", "Claims tied to running tests"],
        ["Time management", "GIS sprints during Expo/hackathon weeks", "Ranked work by deadline and consequence"],
    ],
)

subheading("3.2 Personal development")
body(
    "Beyond technical skills, the attachment contributed strongly to personal growth. "
    "Communication improved because I had to explain stands, wards and rates clearance to "
    "council officers, Hub visitors and non-technical staff without hiding behind jargon. "
    "Expo days in particular forced short, clear answers."
)
body(
    "Time management improved under competing demands. GIS register deadlines, monthly "
    "readiness notes, and Hub event logistics often arrived in the same week. I learnt to "
    "finish the consequence-heavy item first—usually a broken login or a demo path—before "
    "optional exploration."
)
body(
    "Problem-solving matured from “change code until it works” to structured checks: "
    "reproduce, inspect logs, verify schema, re-run the deploy gate, then demonstrate. The "
    "October disk-full outage, which caused PostgreSQL connection failures, reinforced "
    "operational thinking: the application layer cannot succeed if the host is unhealthy."
)
body(
    "Attention to detail became non-negotiable in migrations, grants and identify edge "
    "cases. A missing privilege or a wrong stand number looks like a map bug to a user. "
    "Integrity and honesty were reinforced by Dr Paradzayi’s standard that undocumented or "
    "untested features must not be presented as complete. That standard now guides how I "
    "describe my own work."
)

subheading("3.3 Handling conflict between personal and organisational objectives")
body(
    "During the attachment I met several situations where personal learning goals did not "
    "fully match organisational priorities. Managing those differences was part of "
    "professional development (Billett, 2011)."
)
body(
    "One conflict involved my desire to explore new frameworks quickly versus the Hub and "
    "council need for a stable, demonstrable GIS stack. I wanted to experiment widely; the "
    "organisation needed reliable identify, login and registers. I resolved this by "
    "confining experiments to branches and local spikes, while mainline work stayed on "
    "agreed deliverables."
)
body(
    "Another conflict involved deep technical tasks versus routine Hub support. Fixing "
    "printers or packing Expo cables felt distant from Computer Science at first. The "
    "organisational priority was that Hub events must run. I learnt that refusing service "
    "work would damage the same demos that showcase the GIS system. The compromise was to "
    "time-box support and return to product tasks the same day."
)
body(
    "A further conflict concerned ambition versus honesty. After reading the Handbook it "
    "was tempting to list many registers as complete in documentation. Organisational "
    "priority, enforced by the supervisor, was that only tested features count. I aligned "
    "by converting unfinished items into an explicit backlog and by making the deploy gate "
    "fail when register checks still skipped."
)
body(
    "There was also tension between personal interest in other Hub products visible during "
    "shared events and my assigned ownership of Vungu GIS. Peers advanced health, AI and "
    "competition systems (Ngulube, 2026). Curiosity was useful for learning how the Hub "
    "works; claiming those products as my assignments would have been dishonest. I kept "
    "event participation in a support or GIS-exhibitor role."
)
body(
    "Overall, these conflicts taught me to negotiate scope politely, to document trade-offs, "
    "and to accept that organisational deadlines sometimes outrank personal curiosity—while "
    "still protecting learning through short, controlled experiments."
)

add_table(
    ["Potential conflict", "Organisational priority", "Response used", "Outcome"],
    [
        ["Explore many new tools", "Stable GIS demos for council/Hub", "Spike on branches; keep mainline stable", "Learning without breaking demos"],
        ["Prefer coding only", "Expo/pitching/printer support needed", "Time-boxed Hub service same day", "Events ran; GIS still progressed"],
        ["Document features early", "Only tested use cases count", "Backlog + deploy gate honesty", "Trust maintained with supervisor"],
        ["Interest in other Hub apps", "Assigned Vungu GIS ownership", "Support role at shared events only", "Clear, honest personal portfolio"],
    ],
)
page_break()

# ═══════════════════════════════════════════════════════════════════════════
# 4. EVALUATION AND RECOMMENDATIONS
# ═══════════════════════════════════════════════════════════════════════════
heading("4. EVALUATION AND RECOMMENDATIONS")
subheading("4.1 Re-entry into the university")
body(
    "As the attachment period moves toward full return to campus study, I have reflected "
    "on how the experience will influence Level 3.2 and later learning. I return with "
    "stronger habits in databases, security, API design and evidence-based demonstration. "
    "I also return with clearer career interest in spatial systems, public-sector digital "
    "services and backend engineering."
)
body(
    "Professional habits developed at the Hub—weekly readiness notes, issue lists, joint "
    "reviews with a frontend partner, and refusing to claim untested work—will transfer to "
    "group projects and individual assignments. I expect academic writing to improve because "
    "I have practised explaining technical work to mixed audiences."
)
body(
    "I am aware that re-entry has challenges. After months in a delivery environment, "
    "lecture pacing and examination formats feel different from demo deadlines. I plan to "
    "keep a personal study schedule, form peer review groups, and continue reading PostGIS "
    "and local government systems material so the attachment knowledge does not fade."
)
body(
    "I also intend to maintain professional relationships with Dr Paradzayi, Rafiq, "
    "Theophelos and Hub contacts, and to follow the Vungu GIS project’s go-live leftovers "
    "such as real property-owner data import and production secrets management. Those "
    "links support both mentoring and future project references."
)

add_table(
    ["Re-entry action", "Purpose", "Evidence of progress"],
    [
        ["Map attachment skills to remaining modules", "Close theory–practice gaps deliberately", "Module–skill table in this report"],
        ["Weekly study schedule on campus", "Adjust from demo pace to exam pace", "Personal calendar after return"],
        ["Continue PostGIS / planning reading", "Keep spatial skills sharp", "Reading notes and small lab scripts"],
        ["Maintain Hub and supervisor contact", "Mentorship and references", "Email or scheduled check-ins"],
        ["Portfolio of GIS artefacts", "Show honest evidence of work", "Installer notes, register demos, readiness docs"],
    ],
)

subheading("4.2 Recommendations to the university")
body(
    "Based on this Work-Related Learning period, I make the following recommendations to "
    "Midlands State University and the Department of Computer Science."
)
body(
    "Firstly, the curriculum should increase structured exposure to spatial databases and "
    "open geospatial standards for students who may enter GIS or smart-government projects. "
    "Even a short practical unit on PostGIS would reduce the cold start many students face "
    "(PostGIS Development Group, 2024)."
)
body(
    "Secondly, software security teaching should continue to emphasise password storage, "
    "secret management and dependency hygiene using hands-on labs that resemble broken "
    "prototypes, because those defects appear in real attachments (OWASP Foundation, 2021)."
)
body(
    "Thirdly, professional skills—technical documentation, short presentations, and honest "
    "progress reporting—should be assessed more visibly. Hub supervisors judge students on "
    "these skills as much as on code."
)
body(
    "Finally, the university should keep clarifying how Hub multi-project environments "
    "interact with WRL assessment. Students need guidance on recording shared expo and "
    "hackathon weeks without claiming products outside their assigned ownership. Clear "
    "guidance protects academic integrity while still valuing Hub service learning."
)

subheading("4.3 Recommendations to the company")
body(
    "In this placement the “company” is the MSU Research and Innovation Hub as host, with "
    "Vungu Rural District Council as the client of the GIS system. Recommendations are "
    "offered to both where relevant."
)
body(
    "Firstly, the Hub should continue the rule that use cases are complete only when "
    "automated checks pass. That rule protected client trust on the Vungu project and "
    "should remain standard for student teams."
)
body(
    "Secondly, the Hub should maintain a simple event checklist for power, printers, spare "
    "laptops and demo users before ZITF, Expo and pitching days. Many failures on those "
    "days are logistical, not algorithmic."
)
body(
    "Thirdly, for the Vungu GIS engagement, the next priority should be replacing seed "
    "property owners with the real Property File from council finance, completing "
    "production secrets (including bot-protection keys where required), and keeping the "
    "desktop installer plus database restore path documented for officers who cannot "
    "install developer toolchains."
)
body(
    "Finally, I recommend continued structured mentorship for WRL students through joint "
    "backend–frontend reviews and monthly readiness notes. The combination of real client "
    "demos and Hub supervision is a strong learning model when scope remains honest."
)
page_break()

# ═══════════════════════════════════════════════════════════════════════════
# 5. CONCLUSION
# ═══════════════════════════════════════════════════════════════════════════
heading("5. CONCLUSION")
body(
    "The Work-Related Learning period at the Midlands State University Research and "
    "Innovation Hub, on the Vungu Rural District Council GIS project, was a valuable and "
    "demanding experience. It combined deep technical work on a municipal planning system "
    "with the realities of a multi-project innovation host: workshops, pitching, exhibition "
    "and ICT support."
)
body(
    "The experience exceeded my initial expectation that attachment would be coding alone. "
    "I gained practical competence in secure APIs, PostGIS data, statutory registers, "
    "release checks and desktop packaging, and I learnt to present the system clearly to "
    "officers and Hub visitors. Personal growth in communication, time management, "
    "integrity and conflict handling was as important as the technical skill list."
)
body(
    "The attachment also confirmed that Computer Science modules transfer into professional "
    "practice when supervision is strict and clients are real. Remaining gaps—especially "
    "production data handoff and deeper cloud operations—are clear targets for re-entry "
    "study and for the project’s next phase."
)
body(
    "Compared with my Level 3.1 report, this document is less a catalogue of every table "
    "and more an account of judgement: when to support a Hub event, when to refuse a false "
    "completion claim, when to pause feature work for restore drills, and how to carry "
    "those habits back into university assessment."
)
body(
    "Overall, Level 3.2 Report 2 records not only what was built, but how expectations "
    "changed, how degree knowledge was applied, and how I intend to return to university "
    "as a more careful engineer and a more honest reporter of my own work. The Vungu GIS "
    "system remains the centre of my WRL evidence; the Hub calendar provided the "
    "professional setting in which that evidence was tested."
)
page_break()

# ═══════════════════════════════════════════════════════════════════════════
# 6. REFERENCES
# ═══════════════════════════════════════════════════════════════════════════
heading("6. REFERENCES", center=True)
refs = [
    "[1]\tBillett, S. (2011). Learning in the circumstances of practice. International Journal of Lifelong Education, 30(5), 35–47.",
    "[2]\tCodd, E.F. (1970). A relational model of data for large shared data banks. Communications of the ACM, 13(6), 377–387.",
    "[3]\tDate, C.J. (2015). SQL and relational theory: How to write accurate SQL code (3rd ed.). O’Reilly Media.",
    "[4]\tGovernment of Zimbabwe. (2021a). Development Management (Control) Handbook. Ministry of Local Government and Public Works.",
    "[5]\tGovernment of Zimbabwe. (2021b). Data Protection Act [Chapter 11:12]. Government Printer.",
    "[6]\tGovernment of Zimbabwe. (n.d.). Rural District Councils Act [Chapter 29:13]. Government Printer.",
    "[7]\tMidlands State University. (n.d.). Work Related Learning Student’s Report Guidelines, Level 3.2: Student Report 2. Faculty of Science and Technology, Department of Computer Science.",
    "[8]\tMidlands State University Research and Innovation Hub. (2026). Student project guidance and Hub activity notes. Gweru: Midlands State University.",
    "[9]\tNgulube, M.B.J. (2026). INFO342 Work Related Learning Report. Midlands State University Research and Innovation Hub. (Shared Hub event calendar used for alignment only.)",
    "[10]\tOWASP Foundation. (2021). OWASP Top Ten web application security risks. https://owasp.org/",
    "[11]\tPostGIS Development Group. (2024). PostGIS documentation. https://postgis.net/docs",
    "[12]\tNamailinga, M. (2026). Work Related Learning Level 3.1 Report (Report 1): MSU Research and Innovation Hub / Vungu RDC GIS Project. Midlands State University.",
]
for ref in refs:
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    pf = p.paragraph_format
    pf.space_after = Pt(6)
    pf.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    pf.left_indent = Inches(0.5)
    pf.first_line_indent = Inches(-0.5)
    r = p.add_run(ref)
    set_run(r, size=12)

doc.save(OUT)
for dest in [
    r"c:\Users\munya\Desktop\finale\WRL 2\Munyaradzi_Namailinga_WRL_Level32_Report2_R243100H.docx",
    r"c:\Users\munya\Desktop\Munyaradzi_Namailinga_WRL_Level32_Report2_R243100H.docx",
]:
    try:
        shutil.copy2(OUT, dest)
        print("Copied:", dest)
    except Exception as e:
        print("Copy skipped", dest, e)
print("Saved:", OUT)
