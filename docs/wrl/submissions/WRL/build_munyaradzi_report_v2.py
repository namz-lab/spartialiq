"""
Rebuild Munyaradzi WRL Preliminary Report v2.
Reflects actual work: Development Management Handbook analysis, schema refinement v1.2,
3NF verification, DCM normalisation, data dictionaries, and research papers.
No dash bullets. Clean prose throughout.
"""
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH

OUT = "Munyaradzi_Namailinga_WRL_Preliminary_Report_R243100H_v2.docx"
doc = Document()

section = doc.sections[0]
section.left_margin = Inches(1.2)
section.right_margin = Inches(1.0)
section.top_margin = Inches(1.0)
section.bottom_margin = Inches(1.0)


def center(text, size=12, bold=False):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    run.font.size = Pt(size)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    return p


def body(text, size=10, indent=None, after=4):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(size)
    p.paragraph_format.space_after = Pt(after)
    if indent:
        p.paragraph_format.left_indent = Inches(indent)
        p.paragraph_format.first_line_indent = Inches(-0.2)
    return p


def numbered(items, size=10):
    for i, item in enumerate(items, 1):
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Inches(0.5)
        p.paragraph_format.first_line_indent = Inches(-0.3)
        p.paragraph_format.space_after = Pt(2)
        run = p.add_run(f"{i}.  {item}")
        run.font.size = Pt(size)


def h(text, level=1):
    sizes = {1: 12, 2: 11, 3: 10}
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(sizes.get(level, 10))
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(3)
    return p


def page_break():
    doc.add_page_break()


# ═══════════════════════════════════════
# COVER PAGE
# ═══════════════════════════════════════
center("MIDLANDS STATE UNIVERSITY", 13, bold=True)
center("FACULTY OF INFORMATION SCIENCE AND TECHNOLOGY", 11, bold=True)
center("DEPARTMENT OF COMPUTER SCIENCE", 11, bold=True)
doc.add_paragraph()
center("WRL PRELIMINARY REPORT", 14, bold=True)
doc.add_paragraph()
center("Work-Related Learning Placement at", 10)
center("MSU RESEARCH AND INNOVATION HUB / VUNGU RURAL DISTRICT COUNCIL GIS PROJECT", 11, bold=True)
center("GIS-Based Municipal Planning Information System for Vungu RDC", 10)
doc.add_paragraph()
center("Submitted in partial fulfilment of the requirements of the", 10)
center("Bachelor of Science Honours Degree in Computer Science", 10)
center("Midlands State University", 10)
doc.add_paragraph()

tbl = doc.add_table(rows=8, cols=2)
tbl.style = 'Table Grid'
info = [
    ("Student Name", "Munyaradzi Namailinga"),
    ("Student ID", "R243100H"),
    ("Programme", "Bachelor of Science Honours Degree in Computer Science"),
    ("Level", "3.1"),
    ("Organisation", "MSU Research and Innovation Hub / Vungu RDC GIS Project"),
    ("Supervisor", "Dr Paradzayi, Project Manager"),
    ("WRL Period", "23 February 2026 to 13 May 2026 (ongoing)"),
    ("Report Date", "May 2026"),
]
for i, (label, value) in enumerate(info):
    tbl.rows[i].cells[0].text = label
    tbl.rows[i].cells[1].text = value
    for cell in tbl.rows[i].cells:
        for para in cell.paragraphs:
            for run in para.runs:
                run.font.size = Pt(10)
    tbl.rows[i].cells[0].paragraphs[0].runs[0].bold = True

page_break()

# ═══════════════════════════════════════
# ABSTRACT
# ═══════════════════════════════════════
h("ABSTRACT")
body(
    "This preliminary work-related learning (WRL) report documents the activities carried out by "
    "Munyaradzi Namailinga (Student ID: R243100H), a Level 3.1 Computer Science student at Midlands "
    "State University, during an industrial attachment at the MSU Research and Innovation Hub, "
    "working on a GIS-based Municipal Planning Information System commissioned by Vungu Rural District "
    "Council. The placement covers the period 23 February 2026 to the date of this report."
)
body(
    "The project involves the development of a web-based system to manage land-use planning, "
    "development permit applications, spatial inspections, and compliance checking across nineteen "
    "wards in the Vungu RDC jurisdiction. The system is built on a technology stack comprising "
    "Node.js with the Fastify framework, PostgreSQL with the PostGIS spatial extension, QGIS Server "
    "for OGC-compliant map tile serving, and Leaflet.js on the frontend."
)
body(
    "The first phase of the placement, covering February to mid-April, involved project orientation, "
    "security audit and remediation of the prototype codebase, production server provisioning, "
    "PostGIS spatial database schema design, RESTful API development, authentication implementation, "
    "Docker containerisation, API integration testing, HTTPS implementation, and a formal system "
    "demonstration to Vungu RDC planning officers. The second phase, from mid-April onwards, "
    "shifted focus to research and documentation deliverables. Work in this phase included a "
    "systematic study of the Zimbabwe Development Management (Control) Handbook 2021, a gap analysis "
    "of the existing v1.1 enterprise geodatabase schema against the handbook requirements, production "
    "of the schema refinement document (v1.2) adding fifteen new tables across five implementation "
    "phases, a Third Normal Form (3NF) verification report for the refined schema (v1.2.1), "
    "normalisation of the Development Control Matrix from Un-Normalised Form to 3NF, production of "
    "the DCM data dictionary, and research papers on SQL versus NoSQL databases for GIS systems and "
    "on document verification and storage in a local municipal GIS user system."
)
body(
    "Keywords: Work-Related Learning, Computer Science, GIS, PostGIS, Vungu RDC, Municipal "
    "Planning, Database Normalisation, Schema Design, Development Management Handbook, Zimbabwe."
)

page_break()

# ═══════════════════════════════════════
# ACKNOWLEDGEMENTS
# ═══════════════════════════════════════
h("ACKNOWLEDGEMENTS")
body(
    "The completion of this placement and the preparation of this report would not have been possible "
    "without the guidance and support of a number of people."
)
body(
    "Sincere thanks go to Dr Paradzayi, Project Manager for the Vungu RDC GIS project, for clear "
    "supervision, consistent direction, and high professional standards that shaped the approach taken "
    "at every stage of the work. His emphasis on correctness and rigour in both the technical and "
    "the documentation work created a productive and demanding environment."
)
body(
    "Appreciation is extended to Rafiq, the project research assistant, for setting structured and "
    "meaningful research deliverables that gave the documentation phase of the attachment clear "
    "purpose and measurable outputs. The quality of the research documents produced during this "
    "placement is in large part a result of the standards he applied in reviewing and accepting them."
)
body(
    "Thanks also go to the planning officers at Vungu Rural District Council for their engagement "
    "during the site visit and the system demonstration, particularly for the operational insight "
    "they provided that improved both the system design and the understanding of the planning "
    "domain reflected in the schema work."
)
body(
    "Finally, gratitude is owed to the Department of Computer Science at Midlands State University "
    "for the academic foundation in software engineering, databases, networking, and security that "
    "made it possible to contribute substantively to the project from the first day of the placement."
)

page_break()

# ═══════════════════════════════════════
# TABLE OF CONTENTS
# ═══════════════════════════════════════
h("TABLE OF CONTENTS")
toc_items = [
    "Abstract",
    "Acknowledgements",
    "Table of Contents",
    "List of Abbreviations",
    "CHAPTER 1: INTRODUCTION",
    "   1.1  Background",
    "   1.2  Purpose of the Placement",
    "   1.3  Objectives of the Placement",
    "   1.4  Scope of Work",
    "   1.5  Significance of the Work",
    "CHAPTER 2: DESCRIPTION OF THE WRL ORGANISATION",
    "   2.1  Overview of Midlands State University",
    "   2.2  The MSU Research and Innovation Hub",
    "   2.3  The Vungu RDC GIS Project",
    "   2.4  Organisational Structure",
    "CHAPTER 3: WORK PLAN",
    "   3.1  Planned Activities",
    "   3.2  Links to Programme of Study",
    "CHAPTER 4: WORK ACCOMPLISHED",
    "   4.1  System Analysis and Prototype Security Review",
    "   4.2  Infrastructure Provisioning and Backend Development",
    "   4.3  Testing, Deployment, and System Demonstration",
    "   4.4  Development Management Handbook Study and Schema Gap Analysis",
    "   4.5  Schema Refinement v1.2: Fifteen New Tables",
    "   4.6  3NF Verification Report (v1.2.1)",
    "   4.7  Development Control Matrix Normalisation",
    "   4.8  Data Dictionaries",
    "   4.9  Research Papers",
    "CHAPTER 5: SUMMARY, CONCLUSIONS, AND RECOMMENDATIONS",
    "   5.1  Summary of Activities",
    "   5.2  Problems Encountered",
    "   5.3  Recommendations",
    "References",
]
for item in toc_items:
    p = doc.add_paragraph()
    run = p.add_run(item)
    run.font.size = Pt(10)
    p.paragraph_format.space_after = Pt(1)

page_break()

# ═══════════════════════════════════════
# LIST OF ABBREVIATIONS
# ═══════════════════════════════════════
h("LIST OF ABBREVIATIONS")
abbrev_tbl = doc.add_table(rows=1, cols=2)
abbrev_tbl.style = 'Table Grid'
abbrev_tbl.rows[0].cells[0].paragraphs[0].add_run("Abbreviation").bold = True
abbrev_tbl.rows[0].cells[1].paragraphs[0].add_run("Meaning").bold = True
for cell in abbrev_tbl.rows[0].cells:
    cell.paragraphs[0].runs[0].font.size = Pt(10)

abbrevs = [
    ("3NF", "Third Normal Form"),
    ("1NF", "First Normal Form"),
    ("2NF", "Second Normal Form"),
    ("API", "Application Programming Interface"),
    ("COO", "Certificate of Occupation"),
    ("DCM", "Development Control Matrix"),
    ("DDL", "Data Definition Language"),
    ("EHO", "Environmental Health Officer"),
    ("EWSDA", "Enterprise-Wide Spatial Data Architecture"),
    ("GeoJSON", "Geographic JavaScript Object Notation (RFC 7946)"),
    ("GIS", "Geographic Information System"),
    ("GiST", "Generalised Search Tree (PostgreSQL spatial index type)"),
    ("HTTP", "Hypertext Transfer Protocol"),
    ("HTTPS", "Hypertext Transfer Protocol Secure"),
    ("JWT", "JSON Web Token"),
    ("LPA", "Local Planning Authority"),
    ("MSU", "Midlands State University"),
    ("Nginx", "Engine-X (web server and reverse proxy)"),
    ("OGC", "Open Geospatial Consortium"),
    ("PM2", "Process Manager 2"),
    ("PostGIS", "Spatial database extension for PostgreSQL"),
    ("RDC", "Rural District Council"),
    ("REST", "Representational State Transfer"),
    ("SFS", "Simple Features for SQL (OGC standard)"),
    ("SQL", "Structured Query Language"),
    ("SRID", "Spatial Reference Identifier"),
    ("SSH", "Secure Shell"),
    ("SSL", "Secure Sockets Layer"),
    ("TPD", "Town Planning Development (form reference)"),
    ("UNF", "Un-Normalised Form"),
    ("VCC", "Value Creation Challenge"),
    ("WFS", "Web Feature Service"),
    ("WKB", "Well-Known Binary"),
    ("WKT", "Well-Known Text"),
    ("WMS", "Web Map Service"),
    ("WRL", "Work-Related Learning"),
    ("ZITF", "Zimbabwe International Trade Fair"),
]
for abbr, meaning in abbrevs:
    row = abbrev_tbl.add_row()
    row.cells[0].text = abbr
    row.cells[1].text = meaning
    for cell in row.cells:
        cell.paragraphs[0].runs[0].font.size = Pt(10)

page_break()

# ═══════════════════════════════════════
# CHAPTER 1: INTRODUCTION
# ═══════════════════════════════════════
h("CHAPTER 1: INTRODUCTION")

h("1.1  Background", 2)
body(
    "Work-Related Learning (WRL) is a structured component of undergraduate degree programmes at "
    "Midlands State University (MSU) that places students in professional environments relevant to "
    "their field of study. For Computer Science students, the placement bridges the gap between the "
    "theoretical foundations of algorithms, data structures, database design, and systems architecture "
    "taught in lecture rooms and the realities of building, documenting, and deploying software that "
    "real clients depend on."
)
body(
    "MSU operates under the Education 5.0 philosophy promoted by the Government of Zimbabwe, which "
    "requires universities to contribute directly to national industrialisation and innovation. "
    "The MSU Research and Innovation Hub was established as the operational centre of this mandate, "
    "hosting projects that combine student development with genuine applied research value."
)
body(
    "This report documents the placement of the author at the MSU Research and Innovation Hub, "
    "working on a GIS-based Municipal Planning Information System commissioned by Vungu Rural "
    "District Council. The system manages the full development permit lifecycle across nineteen "
    "wards, incorporating land-use planning, spatial compliance checking, building plan appraisal, "
    "nine-stage construction inspections, and certificate of occupation records, all underpinned "
    "by an enterprise geodatabase designed to Third Normal Form."
)

h("1.2  Purpose of the Placement", 2)
body(
    "The placement serves three connected purposes. The first is academic: to fulfil the WRL "
    "requirement for the Bachelor of Science Honours Degree in Computer Science at Midlands State "
    "University. The second is professional: to give the student experience of building and "
    "documenting a production-grade spatial information system. The third is practical: to contribute "
    "a working system and supporting research documentation to a local government body currently "
    "managing planning processes without a digital system."
)

h("1.3  Objectives of the Placement", 3)
body("The objectives of this placement are as follows:")
numbered([
    "To apply software engineering and database design skills acquired through academic training "
    "in the development of a production-grade GIS system.",
    "To gain practical experience with spatial database design using PostGIS, including geometry "
    "storage, GiST indexing, and OGC-standard spatial queries.",
    "To develop a working understanding of the Zimbabwe Development Management (Control) Handbook "
    "2021 and its implications for the data model of a development management information system.",
    "To apply formal normalisation techniques (1NF, 2NF, 3NF) to real planning data structures "
    "and produce verified, documented database schemas.",
    "To produce research documents of professional quality that contribute to the knowledge base "
    "of the project team.",
    "To identify gaps between the knowledge acquired through undergraduate study and the demands "
    "of professional software engineering and database design practice.",
])

h("1.4  Scope of Work", 2)
body(
    "The scope of this placement covers software engineering and database research activities "
    "carried out between 23 February 2026 and the date of this report. The first phase covered "
    "prototype code review, security remediation, server provisioning, database schema design, "
    "API development, system testing, and a formal demonstration to Vungu RDC planning officers. "
    "The second phase covers development management handbook analysis, schema refinement, 3NF "
    "verification, DCM normalisation, data dictionary production, and comparative research papers."
)

h("1.5  Significance of the Work", 2)
body(
    "Rural district councils in Zimbabwe typically manage development permit applications through "
    "paper-based workflows with manual registers. The system developed during this placement "
    "digitises the complete permit lifecycle, from initial application registration to certificate "
    "of occupation, with spatial data validation linking each application to verified ward and "
    "parcel geometry in the PostGIS database. The schema documentation and normalisation work "
    "produced during this placement provides the technical foundation for the database to be "
    "maintained and extended reliably as the system grows."
)
body(
    "For the student, the significance lies in the opportunity to work on all layers of a real "
    "system simultaneously: writing backend code, designing and verifying database schemas, "
    "studying statutory documents to understand data requirements, and producing research papers "
    "that synthesise findings for a supervisor audience."
)

page_break()

# ═══════════════════════════════════════
# CHAPTER 2: DESCRIPTION OF THE ORGANISATION
# ═══════════════════════════════════════
h("CHAPTER 2: DESCRIPTION OF THE WRL ORGANISATION")

h("2.1  Overview of Midlands State University", 2)
body(
    "Midlands State University was established in 1999 and is located in Gweru, Midlands Province, "
    "Zimbabwe. It operates under the Education 5.0 philosophy, which extends the university mandate "
    "to include innovation and industrialisation alongside teaching and research. The university "
    "enrols approximately 20,000 students across undergraduate and postgraduate programmes, with "
    "a strong emphasis on applied research and community engagement. Work-Related Learning is a "
    "core expression of the Education 5.0 framework."
)

h("2.2  The MSU Research and Innovation Hub", 2)
body(
    "The MSU Research and Innovation Hub is located on the Senga Road campus in Gweru. It provides "
    "incubation support, laboratory and computing facilities, mentorship, and access to seed funding "
    "pathways for student innovators, staff researchers, and early-stage start-up companies. "
    "Students working at the Hub are expected to function as active project team members, held "
    "accountable for the quality and completeness of their contributions."
)

h("2.3  The Vungu RDC GIS Project", 2)
body(
    "The Vungu Rural District Council GIS project is a commissioned system development engagement "
    "between the Faculty of Built Environment at MSU and Vungu RDC, facilitated through the "
    "Innovation Hub. The project builds a web-based GIS planning management system covering "
    "nineteen wards and five user tiers: public access, applicants, planning officers, senior "
    "planners, and administrators. The system manages the full development permit lifecycle as "
    "defined by the Zimbabwe Development Management (Control) Handbook 2021, and integrates "
    "spatial data from the enterprise geodatabase to support map-based planning decisions and "
    "spatial compliance checking."
)

h("2.4  Organisational Structure", 2)
body(
    "The project is managed by Dr Paradzayi as Project Manager, working through the Faculty of "
    "Built Environment and the MSU Innovation Hub. Rafiq, the project research assistant, manages "
    "documentation deliverables and coordinates with Vungu RDC stakeholders. The development team "
    "consists of two student developers: the author, responsible for backend engineering, database "
    "design, and research documentation, and Theophelos, responsible for frontend development. "
    "Progress is reviewed in weekly virtual meetings with the project supervisor."
)

page_break()

# ═══════════════════════════════════════
# CHAPTER 3: WORK PLAN
# ═══════════════════════════════════════
h("CHAPTER 3: WORK PLAN")

h("3.1  Planned Activities", 2)
body(
    "At the start of the placement, the supervisor and the student agreed on a phased work plan. "
    "The table below summarises the activities across the two phases covered by this report."
)

plan_tbl = doc.add_table(rows=1, cols=3)
plan_tbl.style = 'Table Grid'
for i, hdr in enumerate(["Phase", "Period", "Activities"]):
    plan_tbl.rows[0].cells[i].paragraphs[0].add_run(hdr).bold = True
    plan_tbl.rows[0].cells[i].paragraphs[0].runs[0].font.size = Pt(10)

plan_rows = [
    ("1 - Orientation and Code Review",
     "Week 1 (Feb)",
     "Project briefing, prototype security review, GIS technology research, environment setup"),
    ("2 - Server Setup and Research",
     "Weeks 1-2 (Mar)",
     "PostGIS schema research, server provisioning, full stack installation, repository setup"),
    ("3 - Security Hardening",
     "Week 3 (Mar)",
     "Dependency audit, authentication rebuild, credential removal, input sanitiser, site visit"),
    ("4 - API and Documentation",
     "Week 4 (Mar)",
     "API refinement, Docker configuration, backend architecture documentation"),
    ("5 - Deployment and Testing",
     "Weeks 1-2 (Apr)",
     "Deployment exercise, integration tests, HTTPS, ZITF hackathon, final demonstration"),
    ("6 - Handbook Study and Gap Analysis",
     "Week 3 (Apr)",
     "Zimbabwe Development Management Handbook 2021 study, v1.1 schema gap analysis"),
    ("7 - Schema Refinement v1.2",
     "Week 4 (Apr)",
     "15 new tables, DDL, implementation workflow, submission of schema refinement document"),
    ("8 - 3NF Verification and DCM Normalisation",
     "Week 5 (Apr/May)",
     "3NF verification of v1.2 tables, UNF-to-3NF DCM normalisation, Workers Day observation"),
    ("9 - DCM Data Dictionary and Research Papers",
     "Week 1 (May)",
     "DCM data dictionary, SQL vs NoSQL research paper"),
    ("10 - Research Papers (ongoing)",
     "Week 2 (May)",
     "SQL vs NoSQL paper completion, document verification research papers"),
]
for phase, period, activities in plan_rows:
    row = plan_tbl.add_row()
    row.cells[0].text = phase
    row.cells[1].text = period
    row.cells[2].text = activities
    for cell in row.cells:
        for para in cell.paragraphs:
            for run in para.runs:
                run.font.size = Pt(10)
doc.add_paragraph()

h("3.2  Links to Programme of Study", 2)
body(
    "The work undertaken during this placement connects directly to multiple units in the Bachelor "
    "of Science Honours Degree in Computer Science at MSU. The security hardening work draws on "
    "the Software Security module. The PostGIS schema design and 3NF normalisation work connect "
    "directly to the Advanced Databases module, where relational theory, normal forms, and "
    "indexing strategies are taught. The API development and server architecture connect to the "
    "Web Systems and Distributed Computing modules. The server provisioning and firewall "
    "configuration connect to the Computer Networks and Operating Systems modules. The research "
    "papers produced align with the Technical Writing and Research Methods components of the "
    "programme. The GIS integration work, including spatial indexing, OGC standards, and the "
    "Development Management Handbook data model, represents substantial new domain knowledge "
    "acquired beyond the programme curriculum."
)

page_break()

# ═══════════════════════════════════════
# CHAPTER 4: WORK ACCOMPLISHED
# ═══════════════════════════════════════
h("CHAPTER 4: WORK ACCOMPLISHED")

h("4.1  System Analysis and Prototype Security Review", 2)
body(
    "The placement began with a formal project orientation with Dr Paradzayi, who described the "
    "GIS-based Municipal Planning Information System being developed for Vungu RDC. The first "
    "technical task was a review of the existing prototype codebase. The review immediately "
    "identified three categories of security defects: password storage implemented as a plaintext "
    "prefix rather than a hash function, database credentials hardcoded in source files, and "
    "missing input validation on public-facing endpoints. These findings were documented and "
    "presented to the supervisor, who confirmed they needed to be resolved before any new "
    "features were built on the prototype."
)
body(
    "The first week was also used for GIS technology research. PostGIS and its spatial data model "
    "were new: understanding that geographic shapes can be stored as typed geometry columns in a "
    "relational database, indexed with a GiST spatial index, and queried with spatial predicates "
    "such as ST_Within and ST_Intersects required a shift in thinking from standard tabular data. "
    "WMS and WFS were studied as the OGC standards governing how QGIS Server and Nginx serve "
    "map tiles and vector data respectively. The technology stack was confirmed: Node.js v22 LTS "
    "with Fastify, PostgreSQL 16 with PostGIS 3.4, QGIS Server, Nginx, and Leaflet.js."
)

h("4.2  Infrastructure Provisioning and Backend Development", 2)
body(
    "The Ubuntu 24.04 LTS virtual machine was provisioned with SSH hardening applied immediately: "
    "password authentication disabled in favour of key-based authentication, root login disabled, "
    "and MaxAuthTries set to 3. The full backend stack was installed in dependency order, with PM2 "
    "configured to supervise the Node.js process and restart it automatically on crash or reboot."
)
body(
    "The security hardening sprint in Week 3 of March addressed all identified vulnerabilities "
    "systematically. The authentication system was rebuilt using bcrypt hashing at cost factor 12 "
    "and cryptographically signed JWTs. Hardcoded credentials were removed and the Git history was "
    "rewritten to purge the commit containing them. The database password was rotated immediately "
    "after the history rewrite. The input sanitiser was rewritten to target only genuine attack "
    "patterns rather than blocking legitimate inputs. An application_status_history table was "
    "added to the schema to record every status transition with the officer's identity and a "
    "timestamp, creating an audit trail absent from the original design."
)
body(
    "Docker containerisation was completed with a three-service compose configuration for the "
    "database, API, and QGIS Server, with health check ordering ensuring the API waits for "
    "PostgreSQL readiness before starting. Comprehensive backend architecture documentation was "
    "produced, including a full API route map, database schema reference, and deployment "
    "checklist."
)

h("4.3  Testing, Deployment, and System Demonstration", 2)
body(
    "A site visit to the Vungu RDC Department of Planning was conducted in Week 3 of March. "
    "Structured interviews with planning officers revealed that the nineteen-ward hierarchy is "
    "the fundamental organising principle of all council planning data, a detail not present in "
    "the written project brief. This finding directly informed subsequent schema and API design "
    "decisions, including a ward-level application statistics endpoint added in response to an "
    "officer request for backlog visibility by ward."
)
body(
    "A formal system demonstration was conducted to Dr Paradzayi and two Vungu RDC planning "
    "officers in Week 2 of April. All five user journeys were demonstrated successfully: public "
    "map browsing, application submission, planning officer review, spatial compliance checking, "
    "and administrative reporting. The system was approved as demonstration-ready. The planning "
    "department subsequently began using the system for live application processing."
)

h("4.4  Development Management Handbook Study and Schema Gap Analysis", 2)
body(
    "Beginning in Week 3 of April, the focus of the placement shifted to research and database "
    "documentation work. The Zimbabwe Development Management (Control) Handbook 2021 was studied "
    "systematically. The handbook defines the statutory framework for development management in "
    "Zimbabwean local authorities, prescribing a comprehensive four-phase lifecycle: the "
    "development permit application process (eight steps from registration to permit issuance or "
    "refusal, as defined in Section 2 and Annexures 1 to 10), the enforcement framework for "
    "illegal development (enforcement orders and prohibition orders under Sections 3.3 and 3.4), "
    "building plan appraisal procedures (five mandatory drawing types per Annexure 11), nine "
    "sequential construction inspection stages (Annexure 12), and the Certificate of Occupation "
    "as the terminal document (Section 5.9 and Annexure 13)."
)
body(
    "A gap analysis compared the existing v1.1 enterprise geodatabase schema against all handbook "
    "requirements. The current schema implemented only the core permit application record and a "
    "basic inspection record. The gap analysis identified fifteen missing tables across five "
    "phases and seven additional columns needed on the existing permit_application table. "
    "The findings were presented to Dr Paradzayi and Rafiq in a virtual progress meeting, "
    "and the supervisor approved proceeding with a full schema refinement document."
)

h("4.5  Schema Refinement v1.2: Fifteen New Tables", 2)
body(
    "The Vungu GIS Development Management Schema Refinement document (v1.2) was produced over "
    "the course of Week 4 of April. The document covers five parts: a handbook content analysis "
    "mapping each handbook section and annexure to its data requirements, a gap analysis table "
    "comparing existing tables to what the handbook requires, full column-level specifications "
    "for all fifteen new tables and the two modified existing tables, complete DDL (CREATE TABLE "
    "and ALTER TABLE statements) ordered to respect foreign key dependencies, and a "
    "phase-by-phase implementation workflow mapping each handbook step to specific database "
    "operations and GIS screens."
)
body(
    "Phase 1 (Development Application) adds three tables: application_consultation for the "
    "One-Stop-Shop consultation step, application_objection for objections and representations "
    "received during the public notification period, and application_appeal for appeals to "
    "the Administrative Court. Phase 2 (Enforcement) adds enforcement_order and "
    "prohibition_order. Phase 3 (Building Plan Appraisal) adds building_plan, plan_drawing, "
    "plan_appraisal, and plan_appraisal_item. Phase 4 (Stage Inspections) adds four lookup "
    "tables with complete seed data matching Annexures 12 and 14, plus stage_inspection "
    "and stage_inspection_result. Phase 5 adds the occupation_certificate table. "
    "A key design principle applied throughout was that all legal constraints from the "
    "handbook are enforced at the database level through CHECK constraints, UNIQUE indexes, "
    "and NOT NULL requirements rather than relying on application-layer validation alone."
)

h("4.6  3NF Verification Report (v1.2.1)", 2)
body(
    "Following the completion of the schema refinement v1.2, a Third Normal Form (3NF) "
    "Verification Report was produced to formally verify that every table introduced in v1.2 "
    "satisfies the requirements of First, Second, and Third Normal Form. The verification "
    "methodology applied to each table: identify the primary key and all candidate keys, "
    "enumerate all non-trivial functional dependencies, check for repeating groups (1NF), "
    "check that all non-key attributes depend on the whole primary key and not a proper subset "
    "(2NF), and check that all non-key attributes depend directly on the primary key without "
    "any transitive dependency through another non-key attribute (3NF)."
)
body(
    "The lookup tables (inspection_stage, inspection_category, inspection_item_type) were "
    "straightforward to verify because their simple structure (surrogate PK, natural code as "
    "UNIQUE, description) is 3NF by design. The operational tables with composite unique "
    "constraints required more careful analysis. For plan_appraisal_item, the composite "
    "unique constraint on (appraisal_id, drawing_type, check_item) was verified to be the "
    "determining key for all other attributes in the table with no partial or transitive "
    "dependencies. All fifteen new tables were confirmed in 3NF and the report was submitted "
    "to Rafiq as a companion to the schema refinement v1.2 document."
)

h("4.7  Development Control Matrix Normalisation", 2)
body(
    "The Development Control Matrix (DCM) is a two-dimensional cross-reference document received "
    "from the Spatial Planning and Development unit showing which land uses are permitted, "
    "prohibited, or require special consent in each of the nineteen land use zones. In "
    "spreadsheet form the matrix has 32 use group rows and 19 zone columns, producing 608 "
    "permission values. The matrix was in Un-Normalised Form (UNF) because the 19 zone columns "
    "constitute a repeating group: they are all instances of the same attribute "
    "(permission_status) for different values of the zone dimension."
)
body(
    "The normalisation was applied in three stages. To achieve First Normal Form, the 19 zone "
    "columns were unpivoted into rows, producing the 1NF relation DCM_1NF(ug_code, "
    "ug_description, zone_code, zone_name, permission_status) with a composite primary key of "
    "(ug_code, zone_code). The 2NF check identified two partial dependencies: ug_description "
    "depends only on ug_code, and zone_name depends only on zone_code. These were removed by "
    "decomposing into three relations: land_use_group(ug_code, ug_description), "
    "land_use_zone(zone_code, zone_name), and "
    "development_control_permission(ug_code, zone_code, permission_status). The 3NF check on "
    "all three tables confirmed no transitive dependencies. The normalised schema was verified to "
    "preserve all 608 permission values through the decomposition and two integration tables "
    "were defined to link the DCM tables into the existing spatial_planning schema. The full "
    "normalisation process was documented in the DCM Normalisation Report."
)

h("4.8  Data Dictionaries", 2)
body(
    "The Vungu GIS DCM Data Dictionary (v1.0) was produced as a companion to the DCM "
    "Normalisation Report. It documents the six tables introduced by the DCM normalisation: "
    "column names, data types, nullable status, default values, constraint descriptions, and "
    "plain-language explanations of the business rule each column enforces. The document "
    "supplements the main Vungu GIS Data Dictionary (v1.0), which covers the full enterprise "
    "geodatabase schema including all spatial tables, their geometry column specifications, "
    "SRID enforcement, index definitions, and the foreign key dependency graph."
)

h("4.9  Research Papers", 2)
body(
    "Two comparative research papers were produced as assigned deliverables. The first paper, "
    "SQL versus NoSQL Databases for GIS Systems, evaluates both database paradigms across "
    "sixteen criteria relevant to GIS workloads: spatial data support, query language, ACID "
    "compliance, scalability, schema flexibility, indexing and performance, raster data handling, "
    "topology and network analysis, real-time and streaming data, replication, tooling and "
    "ecosystem, and typical use cases. The paper concludes that PostgreSQL with PostGIS remains "
    "the recommended backend for authoritative spatial datasets, complex geometric analysis, "
    "and OGC-compliant web service deployments, and describes the specific workload scenarios "
    "where NoSQL databases provide a complementary or superior capability."
)
body(
    "The second assigned research area covers document verification and storage in a local "
    "municipal GIS user system. This topic is directly applicable to the planned document "
    "management module for the Vungu RDC system. The research examines the verification process "
    "for the three document categories handled by the municipal system (identity documents, "
    "title deeds, and permits and approvals), comparing manual verification by council clerks "
    "with automated digital verification using OCR, barcode reading, facial recognition, and "
    "API-based registry lookups. The study also covers document storage structures, file naming "
    "conventions, database record linkage, access control, data protection requirements under "
    "Zimbabwe's Data Protection Act 2021, and fraud indicator recognition for council clerks. "
    "Work on this research paper was ongoing at the time of this report."
)

page_break()

# ═══════════════════════════════════════
# CHAPTER 5: SUMMARY, CONCLUSIONS, RECOMMENDATIONS
# ═══════════════════════════════════════
h("CHAPTER 5: SUMMARY, CONCLUSIONS, AND RECOMMENDATIONS")

h("5.1  Summary of Activities Carried Out", 2)
body("The following key activities were completed during the period covered by this report:")
numbered([
    "Project orientation and prototype codebase security review.",
    "GIS technology research: PostGIS, OGC standards, QGIS Server, Leaflet.js, Fastify.",
    "Production server provisioning on Ubuntu 24.04 LTS with SSH hardening.",
    "Dependency audit and vulnerability remediation (10 CVEs cleared to zero).",
    "Authentication system rebuild using bcrypt and signed JWTs.",
    "Removal of hardcoded database credentials and full Git history rewrite.",
    "PostGIS spatial database schema design and GiST index configuration.",
    "RESTful API development using Fastify with schema-based request validation.",
    "Addition of application status history audit trail to the production schema.",
    "Docker containerisation with three-service compose and health check ordering.",
    "Backend architecture documentation including BACKEND_GUIDE.md and Mermaid diagrams.",
    "Site visit to Vungu RDC Department of Planning with planning officer interviews.",
    "API integration test suite using Jest and Supertest.",
    "HTTPS implementation using Certbot and Let's Encrypt.",
    "Formal system demonstration to Vungu RDC planning officers, approved as demonstration-ready.",
    "Participation in the ZITF 2026 Innovation Hackathon.",
    "Systematic study of the Zimbabwe Development Management (Control) Handbook 2021.",
    "Gap analysis of the v1.1 enterprise geodatabase schema against all handbook requirements.",
    "Production of the schema refinement document v1.2 with 15 new tables, DDL, and implementation workflow.",
    "3NF verification of all 15 new tables, documented in the v1.2.1 verification report.",
    "Normalisation of the Development Control Matrix from UNF to 3NF, producing 5 normalised tables.",
    "DCM Normalisation Report and DCM Data Dictionary v1.0.",
    "SQL versus NoSQL research paper for GIS systems.",
    "Workers Day public holiday observation on 1 May 2026.",
    "Ongoing research into document verification and storage for the municipal GIS system.",
])

h("5.2  Problems Encountered", 2)
body(
    "The most significant technical challenge of the placement was the security state of the "
    "prototype codebase. The combination of insecure password storage, hardcoded credentials, "
    "and missing input validation required a full week of remediation before safe development "
    "could proceed. The Git history rewrite to remove the hardcoded credential commit was "
    "stressful because it changes the hash of every subsequent commit, requiring all team "
    "members to synchronise. The episode reinforced the principle that credentials must never "
    "be committed in the first place, because the cleanup is far more disruptive than the "
    "initial discipline would have been."
)
body(
    "Translating the Zimbabwe Development Management Handbook from a statutory and procedural "
    "document into a database schema required careful and repeated reading. The handbook uses "
    "legal language and references annexures without always making their data structure "
    "explicit. Identifying the implicit data requirements took more time than reading the "
    "document straightforwardly, and several revisits to specific sections were needed to "
    "confirm that all attributes had been captured correctly in the table definitions."
)
body(
    "Server provisioning credentials were delayed in the first weeks of March, which meant "
    "that the research weeks on PostGIS and GeoJSON could not be immediately validated with "
    "hands-on database work. The delay was managed productively by using the waiting period "
    "for additional research and documentation, but planning future projects should account "
    "for provisioning lead times more explicitly."
)

h("5.3  Recommendations", 2)
numbered([
    "Prototype codebases handed to attachment students should undergo a minimum security "
    "review before handover, covering at least password storage, credential handling, and "
    "input validation. Discovering these issues at the start of a placement consumes time "
    "that could be directed to productive development.",
    "The Zimbabwe Development Management Handbook 2021 should be treated as required reading "
    "for any student or developer joining the Vungu RDC GIS project. Its data requirements "
    "define the schema, and without reading it the system's data model cannot be fully "
    "understood or correctly extended.",
    "3NF verification should be performed on every new schema design before DDL is written. "
    "Verifying normal forms systematically takes less time than debugging data anomalies "
    "caused by unnormalised storage after the system is in production.",
    "The development control matrix should be maintained in the normalised database form "
    "rather than as a spreadsheet, with any future updates to zone permissions made through "
    "the application layer rather than by editing the spreadsheet and re-importing.",
    "Future attachment students working on the document management module should study the "
    "Municipal Document Verification and Storage report and the Manual vs Automated "
    "Document Verification paper produced during this placement, as these documents "
    "establish the verification requirements and storage architecture for that module.",
])

page_break()

h("REFERENCES")
refs = [
    "[1]  S. Billett, \"Learning in the Circumstances of Practice,\" Int. J. Lifelong Educ., vol. 30, no. 5, pp. 35–47, 2011.",
    "[2]  M. Fowler and P. J. Sadalage, NoSQL Distilled: A Brief Guide to the Emerging World of Polyglot Persistence. Boston, MA, USA: Addison-Wesley, 2012.",
    "[3]  Government of Zimbabwe, Education 5.0 Policy Framework. Harare, Zimbabwe: Government Printer, 2018.",
    "[4]  Government of Zimbabwe, Development Management (Control) Handbook. Harare, Zimbabwe: Government Printer, 2021.",
    "[5]  Government of Zimbabwe, Data Protection Act, Chapter 11:12. Harare, Zimbabwe: Government Printer, 2021.",
    "[6]  H. Butler, M. Daly, A. Doyle, S. Gillies, S. Hagen, and T. Schaub, \"The GeoJSON Format,\" IETF, RFC 7946, Aug. 2016. [Online]. Available: https://tools.ietf.org/html/rfc7946",
    "[7]  MSU Research and Innovation Hub, Hub Profile and Services Overview. Gweru, Zimbabwe: Midlands State University, 2025.",
    "[8]  Open Geospatial Consortium, \"OGC Simple Features for SQL,\" OGC Standard 06-104r4, 2011.",
    "[9]  OWASP Foundation, \"OWASP Top Ten Web Application Security Risks,\" OWASP, 2021. [Online]. Available: https://owasp.org/www-project-top-ten/",
    "[10] PostGIS Development Group, \"PostGIS 3.4 Documentation,\" 2024. [Online]. Available: https://postgis.net/docs. [Accessed: May 2026].",
    "[11] PostgreSQL Global Development Group, \"PostgreSQL 16 Documentation,\" 2024. [Online]. Available: https://www.postgresql.org/docs/16. [Accessed: May 2026].",
    "[12] N. Provos and D. Mazieres, \"A Future-Adaptable Password Scheme,\" in Proc. 1999 USENIX Annual Technical Conf., Monterey, CA, USA, Jun. 1999, pp. 81–91.",
    "[13] P. Ramsey and D. Blasby, \"The PostGIS Project,\" Refractions Research, 2004.",
    "[14] Government of Zimbabwe, Regional, Town and Country Planning Act, Chapter 29:12. Harare, Zimbabwe: Government Printer.",
]
for ref in refs:
    p = doc.add_paragraph()
    run = p.add_run(ref)
    run.font.size = Pt(10)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.left_indent = Inches(0.35)
    p.paragraph_format.first_line_indent = Inches(-0.35)

doc.save(OUT)
print(f"Saved: {OUT}")
