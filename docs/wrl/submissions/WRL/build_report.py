
from docx import Document
from docx.shared import Pt, Inches, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import copy

doc = Document()

# ── page margins ──────────────────────────────────────────────────────────────
for section in doc.sections:
    section.top_margin    = Cm(2.54)
    section.bottom_margin = Cm(2.54)
    section.left_margin   = Cm(3.0)
    section.right_margin  = Cm(2.54)

# ── helpers ───────────────────────────────────────────────────────────────────
def set_font(run, name="Times New Roman", size=12, bold=False, italic=False, colour=None):
    run.font.name  = name
    run.font.size  = Pt(size)
    run.font.bold  = bold
    run.font.italic = italic
    if colour:
        run.font.color.rgb = RGBColor(*colour)

def heading(text, level=1, size=14, bold=True, colour=(0,0,0), align=WD_ALIGN_PARAGRAPH.LEFT, space_before=12, space_after=6):
    p = doc.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.space_after  = Pt(space_after)
    r = p.add_run(text)
    set_font(r, size=size, bold=bold, colour=colour)
    return p

def body(text, align=WD_ALIGN_PARAGRAPH.JUSTIFY, size=12, space_before=0, space_after=6, italic=False):
    p = doc.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.space_after  = Pt(space_after)
    p.paragraph_format.first_line_indent = Pt(18)
    r = p.add_run(text)
    set_font(r, size=size, italic=italic)
    return p

def bullet(text, size=12):
    p = doc.add_paragraph(style="List Bullet")
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    p.paragraph_format.space_after = Pt(3)
    r = p.add_run(text)
    set_font(r, size=size)
    return p

def numbered(text, size=12):
    p = doc.add_paragraph(style="List Number")
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    p.paragraph_format.space_after = Pt(3)
    r = p.add_run(text)
    set_font(r, size=size)
    return p

def shade_cell(cell, hex_colour="D9E1F2"):
    tc   = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd  = OxmlElement("w:shd")
    shd.set(qn("w:val"),   "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"),  hex_colour)
    tcPr.append(shd)

def set_col_width(table, col_idx, width_cm):
    for row in table.rows:
        row.cells[col_idx].width = Cm(width_cm)

def add_table(headers, rows, col_widths=None, header_fill="1F3864", header_text_colour=(255,255,255)):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr_cells = t.rows[0].cells
    for i, h in enumerate(headers):
        hdr_cells[i].text = ""
        shade_cell(hdr_cells[i], header_fill)
        p = hdr_cells[i].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(h)
        set_font(r, size=11, bold=True, colour=header_text_colour)
    for row_data in rows:
        r_cells = t.add_row().cells
        for i, val in enumerate(row_data):
            r_cells[i].text = ""
            p = r_cells[i].paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            run = p.add_run(str(val))
            set_font(run, size=11)
    if col_widths:
        for ci, w in enumerate(col_widths):
            set_col_width(t, ci, w)
    doc.add_paragraph()
    return t

def page_break():
    doc.add_page_break()

def section_label(num, title):
    """e.g.  '2.4  Organisational Structure' """
    heading(f"{num}  {title}", size=13, bold=True, space_before=10, space_after=4)

def sub_label(num, title):
    heading(f"{num}  {title}", size=12, bold=True, space_before=8, space_after=3)

# ═══════════════════════════════════════════════════════════════════════════════
# COVER PAGE
# ═══════════════════════════════════════════════════════════════════════════════
def cover():
    def cline(text, size=12, bold=False, space_before=0, space_after=4, colour=(0,0,0)):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(space_before)
        p.paragraph_format.space_after  = Pt(space_after)
        r = p.add_run(text)
        set_font(r, size=size, bold=bold, colour=colour)

    cline("MIDLANDS STATE UNIVERSITY", 16, True, space_before=0, space_after=2, colour=(0,51,102))
    cline("FACULTY OF SCIENCE AND TECHNOLOGY", 13, True, space_after=2, colour=(0,51,102))
    cline("DEPARTMENT OF COMPUTER SCIENCE", 13, True, space_after=18, colour=(0,51,102))
    cline("─" * 60, 11, space_after=18)
    cline("WRL PRELIMINARY REPORT", 18, True, space_after=6, colour=(31,56,100))
    cline("Work-Related Learning Placement at", 12, False, space_after=4)
    cline("MSU RESEARCH AND INNOVATION HUB", 13, True, space_after=2, colour=(0,102,0))
    cline("VUNGU RURAL DISTRICT COUNCIL GIS PROJECT", 13, True, space_after=10, colour=(0,102,0))
    cline("GIS-Based Municipal Planning Information System for Vungu RDC", 12, True, space_after=16)
    cline("─" * 60, 11, space_after=16)
    cline("Submitted in partial fulfilment of the requirements of the", 11, space_after=2)
    cline("Bachelor of Science Honours Degree in Computer Science", 11, True, space_after=2)
    cline("Midlands State University", 11, space_after=20)

    meta = [
        ("Student Name",  "Munyaradzi Namailinga"),
        ("Student ID",    "R243100H"),
        ("Programme",     "Bachelor of Science Honours Degree in Computer Science"),
        ("Level",         "3.1"),
        ("Organisation",  "MSU Research and Innovation Hub / Vungu RDC GIS Project"),
        ("Supervisor",    "Dr Paradzayi, Project Manager"),
        ("WRL Period",    "23 February 2026 to 13 May 2026 (ongoing)"),
        ("Report Date",   "May 2026"),
    ]
    t = doc.add_table(rows=len(meta), cols=2)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, (label, val) in enumerate(meta):
        lc = t.rows[i].cells[0]
        vc = t.rows[i].cells[1]
        shade_cell(lc, "1F3864")
        shade_cell(vc, "EBF3FB")
        lc.width = Cm(5)
        vc.width = Cm(10)
        lp = lc.paragraphs[0]; lp.alignment = WD_ALIGN_PARAGRAPH.LEFT
        lr = lp.add_run(label); set_font(lr, size=11, bold=True, colour=(255,255,255))
        vp = vc.paragraphs[0]; vp.alignment = WD_ALIGN_PARAGRAPH.LEFT
        vr = vp.add_run(val);  set_font(vr, size=11)
    page_break()

cover()

# ═══════════════════════════════════════════════════════════════════════════════
# ABSTRACT
# ═══════════════════════════════════════════════════════════════════════════════
heading("ABSTRACT", size=14, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_before=0, space_after=8)

body(
    "This preliminary work-related learning (WRL) report documents the activities carried out by "
    "Munyaradzi Namailinga (Student ID: R243100H), a Level 3.1 Computer Science student at Midlands "
    "State University (MSU), during an industrial attachment at the MSU Research and Innovation Hub. "
    "The placement involves active participation in the development of a GIS-based Municipal Planning "
    "Information System commissioned by Vungu Rural District Council (Vungu RDC). The reporting period "
    "covers 23 February 2026 to the date of this report."
)
body(
    "The system under development is a full-stack, spatially enabled web application designed to digitise "
    "and manage the entire development permit lifecycle as prescribed by the Zimbabwe Development "
    "Management (Control) Handbook 2021. The system spans nineteen administrative wards within the Vungu "
    "RDC jurisdiction and accommodates five user-role tiers: public access, applicants, planning officers, "
    "senior planners, and system administrators. The technology stack comprises Node.js v22 LTS with the "
    "Fastify framework for the backend API, PostgreSQL 16 with the PostGIS 3.4 spatial extension for the "
    "geodatabase, QGIS Server for OGC-compliant WMS and WFS map tile service delivery, Nginx as the "
    "reverse proxy, and Leaflet.js on the browser-side frontend."
)
body(
    "The placement unfolded in two distinct phases. Phase One, covering February through mid-April 2026, "
    "comprised project orientation and briefing, a security audit and comprehensive remediation of the "
    "prototype codebase (clearing ten CVEs to zero), production server provisioning on Ubuntu 24.04 LTS "
    "with SSH hardening, PostGIS spatial database schema design with GiST spatial indexing, RESTful API "
    "development with schema-validated request handling, JWT-based authentication built on bcrypt at cost "
    "factor twelve, Docker containerisation with a three-service health-checked compose configuration, an "
    "API integration test suite, HTTPS implementation using Certbot and Let's Encrypt, a structured site "
    "visit to Vungu RDC Department of Planning, and a formal system demonstration to Vungu RDC planning "
    "officers that was approved as demonstration-ready."
)
body(
    "Phase Two, from mid-April 2026 onwards, pivoted to research and database documentation deliverables. "
    "This phase included a systematic study of the Zimbabwe Development Management (Control) Handbook 2021 "
    "across all five lifecycle phases and thirteen statutory annexures; a gap analysis of the existing v1.1 "
    "enterprise geodatabase schema identifying fifteen missing tables and seven missing columns; production "
    "of the schema refinement document (v1.2) with full column-level specifications, DDL, and a "
    "phase-by-phase implementation workflow; a formal Third Normal Form (3NF) Verification Report (v1.2.1) "
    "confirming all fifteen new tables satisfy 1NF, 2NF, and 3NF; normalisation of the Development "
    "Control Matrix (DCM) from Un-Normalised Form to 3NF across five decomposed relations; production of "
    "the DCM Data Dictionary (v1.0) and the main enterprise geodatabase data dictionary (v1.0); and two "
    "comparative research papers on SQL versus NoSQL databases for GIS workloads and on document "
    "verification and storage in a local municipal GIS user system."
)
body(
    "Keywords: Work-Related Learning, Computer Science, GIS, PostGIS, Vungu RDC, Municipal Planning, "
    "Database Normalisation, Third Normal Form, Schema Design, Development Management Handbook, "
    "Zimbabwe, REST API, Docker, Fastify, QGIS Server, OGC Standards.",
    italic=True
)
page_break()

# ═══════════════════════════════════════════════════════════════════════════════
# ACKNOWLEDGEMENTS
# ═══════════════════════════════════════════════════════════════════════════════
heading("ACKNOWLEDGEMENTS", size=14, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_before=0, space_after=8)

body(
    "The completion of this placement and the preparation of this report would not have been possible "
    "without the guidance and support of a number of people to whom the author is genuinely grateful."
)
body(
    "Sincere thanks are extended to Dr Paradzayi, Project Manager for the Vungu RDC GIS project, for "
    "clear supervision, consistent direction, and the high professional standards he maintained throughout "
    "the placement. His insistence on correctness and rigour — in both the technical implementation and "
    "the research documentation — created a productive and demanding working environment that raised the "
    "quality of every deliverable produced. His willingness to engage with questions at any stage of the "
    "work, including detailed review of schema designs and normalisation proofs, was invaluable."
)
body(
    "Appreciation is extended to Rafiq, the project research assistant, for setting structured and "
    "meaningful research deliverables with clear acceptance criteria. The DCM normalisation report, "
    "3NF verification documents, and comparative research papers produced during this placement reflect "
    "the standards he applied in reviewing and accepting them. His ability to translate planning domain "
    "requirements into precise technical briefs made the research phase significantly more productive."
)
body(
    "Thanks are also due to the planning officers and administrative staff at Vungu Rural District Council "
    "Department of Planning for their generous engagement during the site visit and the system "
    "demonstration. The operational insight they provided regarding ward-based application management, "
    "the nineteen-ward hierarchy, and the day-to-day pressures of paper-based permit processing directly "
    "shaped both the system design and the schema work that followed."
)
body(
    "The author also thanks fellow developer Theophelos for productive collaboration on the frontend "
    "integration, and for reliable delivery of the user interface components that were demonstrated "
    "to Vungu RDC officers. Working alongside a peer with clearly defined responsibilities made the "
    "team-based development process significantly more efficient."
)
body(
    "Finally, gratitude is owed to the Department of Computer Science at Midlands State University "
    "for the academic foundation in software engineering, databases, networking, and security that made "
    "it possible to contribute substantively to the project from the first day of the placement. The "
    "direct applicability of the Advanced Databases, Software Security, Web Systems, and Computer "
    "Networks modules was evident at every stage of the work."
)
page_break()

# ═══════════════════════════════════════════════════════════════════════════════
# TABLE OF CONTENTS  (manual — formatted)
# ═══════════════════════════════════════════════════════════════════════════════
heading("TABLE OF CONTENTS", size=14, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_before=0, space_after=8)

toc_entries = [
    ("Abstract", "ii"),
    ("Acknowledgements", "iii"),
    ("Table of Contents", "iv"),
    ("List of Abbreviations", "v"),
    ("CHAPTER 1: INTRODUCTION", ""),
    ("   1.1  Background", "1"),
    ("   1.2  Purpose of the Placement", "2"),
    ("   1.3  Objectives of the Placement", "2"),
    ("   1.4  Scope of Work", "3"),
    ("   1.5  Significance of the Work", "3"),
    ("CHAPTER 2: DESCRIPTION OF THE WRL ORGANISATION", ""),
    ("   2.1  Overview of Midlands State University", "5"),
    ("   2.2  The MSU Research and Innovation Hub", "6"),
    ("   2.3  The Vungu RDC GIS Project", "7"),
    ("   2.4  Organisational Structure", "8"),
    ("         2.4.1  MSU Faculty and Innovation Hub Structure", "8"),
    ("         2.4.2  Vungu RDC Organisational Structure", "9"),
    ("         2.4.3  Project Team Structure", "10"),
    ("CHAPTER 3: WORK PLAN", ""),
    ("   3.1  Planned Activities", "11"),
    ("   3.2  Links to Programme of Study", "13"),
    ("CHAPTER 4: WORK ACCOMPLISHED", ""),
    ("   4.1  System Analysis and Prototype Security Review", "15"),
    ("   4.2  Infrastructure Provisioning and Backend Development", "17"),
    ("   4.3  Testing, Deployment, and System Demonstration", "20"),
    ("   4.4  Development Management Handbook Study and Schema Gap Analysis", "22"),
    ("   4.5  Schema Refinement v1.2: Fifteen New Tables", "25"),
    ("   4.6  Third Normal Form Verification Report (v1.2.1)", "29"),
    ("   4.7  Development Control Matrix Normalisation", "31"),
    ("   4.8  Data Dictionaries", "34"),
    ("   4.9  Research Papers", "35"),
    ("CHAPTER 5: SUMMARY, CONCLUSIONS, AND RECOMMENDATIONS", ""),
    ("   5.1  Summary of Activities Carried Out", "38"),
    ("   5.2  Problems Encountered and Lessons Learned", "40"),
    ("   5.3  Conclusions", "42"),
    ("   5.4  Recommendations", "43"),
    ("References", "45"),
]

for entry, page in toc_entries:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after  = Pt(1)
    is_chapter = entry.startswith("CHAPTER") or entry in ("Abstract","Acknowledgements","Table of Contents","List of Abbreviations","References")
    r = p.add_run(entry)
    set_font(r, size=11, bold=is_chapter)
    if page:
        tab = p.add_run(f"\t{page}")
        set_font(tab, size=11, bold=is_chapter)
        p.paragraph_format.tab_stops.add_tab_stop(Inches(5.5), 2)  # right-aligned tab

page_break()

# ═══════════════════════════════════════════════════════════════════════════════
# LIST OF ABBREVIATIONS
# ═══════════════════════════════════════════════════════════════════════════════
heading("LIST OF ABBREVIATIONS", size=14, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_before=0, space_after=8)

abbrevs = [
    ("1NF",    "First Normal Form"),
    ("2NF",    "Second Normal Form"),
    ("3NF",    "Third Normal Form"),
    ("API",    "Application Programming Interface"),
    ("BCNF",   "Boyce-Codd Normal Form"),
    ("COO",    "Certificate of Occupation"),
    ("CVE",    "Common Vulnerabilities and Exposures"),
    ("DCM",    "Development Control Matrix"),
    ("DDL",    "Data Definition Language"),
    ("EHO",    "Environmental Health Officer"),
    ("EWSDA",  "Enterprise-Wide Spatial Data Architecture"),
    ("FST",   "Faculty of Science and Technology"),
    ("FK",     "Foreign Key"),
    ("GeoJSON","Geographic JavaScript Object Notation (RFC 7946)"),
    ("GIS",    "Geographic Information System"),
    ("GiST",   "Generalised Search Tree (PostgreSQL spatial index type)"),
    ("HTTP",   "Hypertext Transfer Protocol"),
    ("HTTPS",  "Hypertext Transfer Protocol Secure"),
    ("JWT",    "JSON Web Token"),
    ("LPA",    "Local Planning Authority"),
    ("MSU",    "Midlands State University"),
    ("Nginx",  "Engine-X (web server and reverse proxy)"),
    ("OCR",    "Optical Character Recognition"),
    ("OGC",    "Open Geospatial Consortium"),
    ("OWASP",  "Open Web Application Security Project"),
    ("PK",     "Primary Key"),
    ("PM2",    "Process Manager 2"),
    ("PostGIS","Spatial database extension for PostgreSQL"),
    ("RDC",    "Rural District Council"),
    ("REST",   "Representational State Transfer"),
    ("SFS",    "Simple Features for SQL (OGC standard)"),
    ("SQL",    "Structured Query Language"),
    ("SRID",   "Spatial Reference Identifier"),
    ("SSH",    "Secure Shell"),
    ("SSL",    "Secure Sockets Layer"),
    ("TLS",    "Transport Layer Security"),
    ("TPD",    "Town Planning Development (form reference)"),
    ("UNF",    "Un-Normalised Form"),
    ("VCC",    "Value Creation Challenge"),
    ("VPS",    "Virtual Private Server"),
    ("WFS",    "Web Feature Service"),
    ("WKB",    "Well-Known Binary"),
    ("WKT",    "Well-Known Text"),
    ("WMS",    "Web Map Service"),
    ("WRL",    "Work-Related Learning"),
    ("ZITF",   "Zimbabwe International Trade Fair"),
]
add_table(["Abbreviation", "Meaning"], abbrevs, col_widths=[3.5, 11.5])
page_break()

# ═══════════════════════════════════════════════════════════════════════════════
# CHAPTER 1 — INTRODUCTION
# ═══════════════════════════════════════════════════════════════════════════════
heading("CHAPTER 1: INTRODUCTION", size=15, bold=True, colour=(31,56,100), space_before=0, space_after=6)

# 1.1
section_label("1.1", "Background")
body(
    "Work-Related Learning (WRL) is a structured, credit-bearing component of undergraduate degree "
    "programmes at Midlands State University (MSU) designed to bridge the gap between academic "
    "knowledge and professional practice. For Computer Science students, the placement embeds "
    "theoretical foundations — algorithms, data structures, database design, systems architecture, "
    "and security — within authentic engineering environments where real clients depend on the "
    "software being built."
)
body(
    "MSU operates under the Education 5.0 philosophy promoted by the Government of Zimbabwe, "
    "which extends the mandate of universities beyond conventional teaching and research to include "
    "active contribution to national industrialisation and innovation. This philosophy requires that "
    "student projects generate tangible value for communities, local government, and industry. The "
    "MSU Research and Innovation Hub was established as the operational centre of this mandate, "
    "providing a structured environment in which students work alongside academic supervisors on "
    "projects with genuine applied research and development objectives."
)
body(
    "This report documents the placement of the author at the MSU Research and Innovation Hub, "
    "working on a GIS-based Municipal Planning Information System commissioned by Vungu Rural "
    "District Council (Vungu RDC). Vungu RDC is a local authority in the Midlands Province of "
    "Zimbabwe, responsible for land administration, development permit management, and spatial "
    "planning across nineteen administrative wards. At the commencement of the placement, the "
    "council was managing the entire development permit lifecycle — from initial application "
    "registration through to certificate of occupation — through paper-based workflows, manual "
    "registers, and informal spreadsheet records. This created significant backlogs, limited "
    "visibility of application status for applicants, and made spatial compliance checking "
    "impractical without a digital map layer."
)
body(
    "The system under development digitises the complete permit lifecycle as defined by the "
    "Zimbabwe Development Management (Control) Handbook 2021. The Handbook is the statutory "
    "instrument issued by the Ministry of Local Government and Public Works that prescribes, in "
    "procedural and documentary detail, how local planning authorities must manage development "
    "applications, enforce against illegal development, appraise building plans, conduct stage "
    "construction inspections, and issue certificates of occupation. The system maps every "
    "handbook procedure and annexure to a database table, an API endpoint, and a user interface "
    "screen, making the Handbook the primary requirements document for the data model."
)
body(
    "The technical foundation of the system rests on a PostgreSQL 16 database extended with "
    "PostGIS 3.4 — the open-source spatial database extension that enables geographic geometry "
    "storage, GiST spatial indexing, and OGC-standard spatial query predicates. All ward "
    "boundaries, parcel geometries, and zone polygons are stored as typed geometry columns "
    "in the PostGIS geodatabase, enabling the system to validate whether a development "
    "application parcel falls within the correct ward and land-use zone before any officer "
    "review begins. This spatial validation is a capability that no paper-based system can "
    "replicate efficiently."
)

# 1.2
section_label("1.2", "Purpose of the Placement")
body(
    "The placement serves three connected and mutually reinforcing purposes."
)
body(
    "The first purpose is academic: to fulfil the Work-Related Learning requirement for the "
    "Bachelor of Science Honours Degree in Computer Science at Midlands State University. The "
    "WRL period provides the student with a structured opportunity to apply the theoretical "
    "knowledge acquired across three years of undergraduate study to a live engineering project "
    "under professional supervision."
)
body(
    "The second purpose is professional: to develop the competencies required of a practising "
    "software engineer and spatial database designer. This includes writing production-grade "
    "backend code, designing and formally verifying relational database schemas, conducting "
    "security audits and remediations, provisioning and hardening Linux servers, and producing "
    "technical research documents to a professional standard."
)
body(
    "The third purpose is practical: to deliver a working system and comprehensive supporting "
    "documentation to Vungu Rural District Council — a local authority currently operating "
    "without a digital planning management system. The project thus generates real institutional "
    "value while simultaneously satisfying the student's academic and professional development "
    "objectives, consistent with the Education 5.0 philosophy under which MSU operates."
)

# 1.3
section_label("1.3", "Objectives of the Placement")
body("The specific objectives of this placement are as follows:")
numbered("To apply software engineering and database design skills acquired through academic training in the development of a production-grade geographic information system.")
numbered("To gain practical experience with spatial database design using PostGIS, including geometry storage, GiST spatial indexing, SRID enforcement, and OGC-standard spatial query predicates.")
numbered("To conduct a formal security audit of an existing codebase, document identified vulnerabilities against recognised standards, and remediate all findings before production deployment.")
numbered("To develop a thorough working understanding of the Zimbabwe Development Management (Control) Handbook 2021 and to map each statutory procedure and annexure to the data model of a development management information system.")
numbered("To apply formal normalisation techniques (1NF, 2NF, 3NF) to real planning data structures and produce verified, documented database schemas accompanied by complete DDL.")
numbered("To design, implement, and document a RESTful API architecture using Fastify and Node.js, with schema-validated request handling and JWT-based authentication.")
numbered("To produce research documents and comparative research papers of professional quality that contribute to the knowledge base of the project team and the broader GIS planning domain.")
numbered("To identify the gaps between the knowledge acquired through undergraduate study and the demands of professional software engineering and database design practice, and to reflect on how those gaps were bridged during the placement.")
doc.add_paragraph()

# 1.4
section_label("1.4", "Scope of Work")
body(
    "The scope of this placement covers all software engineering, spatial database design, and "
    "technical research activities carried out between 23 February 2026 and the date of this "
    "report. Work is confined to the backend and database tiers of the system; frontend "
    "development is handled by a separate team member. The scope is bounded as follows."
)
body(
    "In scope: backend API development in Node.js with Fastify; PostgreSQL and PostGIS geodatabase "
    "schema design, DDL authoring, and formal 3NF verification; server provisioning, hardening, "
    "and Docker containerisation; security audit and remediation of the prototype codebase; "
    "systematic study of the Zimbabwe Development Management (Control) Handbook 2021 and its "
    "translation into database schema requirements; production of schema refinement, normalisation, "
    "data dictionary, and research documents; and HTTPS implementation and API integration testing."
)
body(
    "Out of scope: frontend development (owned by Theophelos); Vungu RDC internal network "
    "infrastructure; procurement and licensing of third-party software; and any module of the "
    "system not yet assigned to the current development phase."
)

# 1.5
section_label("1.5", "Significance of the Work")
body(
    "The significance of this work operates on three levels: national, institutional, and academic."
)
body(
    "At the national level, rural district councils in Zimbabwe overwhelmingly manage development "
    "permit applications through paper-based workflows, manual registers, and spreadsheet records. "
    "This creates persistent backlogs, opacity for applicants, and limited capacity for spatial "
    "compliance checking against approved land-use zone plans. The system developed during this "
    "placement demonstrates that an open-source spatial database and web stack can deliver a "
    "full-lifecycle planning management system at a cost accessible to rural councils. If the "
    "system is adopted more broadly, it has the potential to modernise development management "
    "across Zimbabwe's RDC tier."
)
body(
    "At the institutional level, the project provides the MSU Research and Innovation Hub with a "
    "deployable, well-documented system that can serve as a reference implementation for future "
    "GIS projects. The schema documentation, normalisation reports, and data dictionaries produced "
    "during this placement establish a technical baseline that future developers can extend "
    "reliably without inadvertently introducing data anomalies."
)
body(
    "At the academic level, this placement provided an opportunity to work on all technical layers "
    "of a real system concurrently: writing backend code, designing and verifying database schemas, "
    "studying statutory documents to understand data requirements, and producing research papers "
    "that synthesise findings for a supervisor audience. The breadth of the work — spanning "
    "security, databases, spatial systems, and technical writing — made the placement an "
    "exceptionally rich applied learning experience."
)
page_break()

# ═══════════════════════════════════════════════════════════════════════════════
# CHAPTER 2 — DESCRIPTION OF THE WRL ORGANISATION
# ═══════════════════════════════════════════════════════════════════════════════
heading("CHAPTER 2: DESCRIPTION OF THE WRL ORGANISATION", size=15, bold=True, colour=(31,56,100), space_before=0, space_after=6)

# 2.1
section_label("2.1", "Overview of Midlands State University")
body(
    "Midlands State University (MSU) was established by an Act of Parliament in 1999 and is "
    "situated in Gweru, Midlands Province, Zimbabwe. It is one of the ten state universities "
    "in Zimbabwe and the largest university in the country by student enrolment, with "
    "approximately 20,000 students registered across undergraduate, postgraduate, and research "
    "programmes. The university is organised into fourteen faculties covering the natural sciences, "
    "humanities, social sciences, law, commerce, education, and technology disciplines."
)
body(
    "MSU operates under the Education 5.0 philosophy, a policy framework articulated by the "
    "Government of Zimbabwe through the Ministry of Higher and Tertiary Education, Innovation, "
    "Science and Technology Development. Education 5.0 extends the conventional tripartite "
    "university mandate of teaching, research, and community service by adding two new pillars: "
    "innovation and industrialisation. Under this framework, every academic activity — from "
    "undergraduate coursework to postgraduate research — is expected to contribute directly to "
    "Zimbabwe's productive economy. Work-Related Learning is the most visible expression of "
    "this philosophy at the undergraduate level, embedding students in productive organisations "
    "for a minimum of one semester per year."
)
body(
    "The Faculty of Science and Technology (FST), which houses the Department of "
    "Computer Science, is one of the most active faculties in applying the Education 5.0 "
    "mandate. FST departments run the majority of digital innovation projects hosted at the "
    "MSU Research and Innovation Hub, and Computer Science students regularly work on system "
    "development engagements with local government, the health sector, and commercial enterprises "
    "during their WRL placements."
)

# 2.2
section_label("2.2", "The MSU Research and Innovation Hub")
body(
    "The MSU Research and Innovation Hub is located on the Senga Road campus in Gweru. It "
    "functions as the principal applied research and technology incubation facility of the "
    "university, providing computing infrastructure, laboratory space, mentorship, project "
    "management support, and access to seed-funding pathways for student innovators, academic "
    "researchers, and early-stage technology companies."
)
body(
    "The Hub manages a portfolio of concurrent projects spanning geographic information systems, "
    "health information systems, agricultural technology, and enterprise software development. "
    "Each project is assigned a faculty supervisor who acts as project manager, and students "
    "are assigned to specific projects based on their academic programme and the technical "
    "requirements of the engagement. Students at the Hub are expected to function as professional "
    "team members, held accountable for the quality, completeness, and timely delivery of their "
    "contributions."
)
body(
    "The Hub also coordinates the MSU Value Creation Challenge (VCC), an annual innovation "
    "competition that encourages students to develop commercially viable solutions to community "
    "problems, and supports students and staff participating in national competitions such as "
    "the ZITF Innovation Hackathon."
)

# 2.3
section_label("2.3", "The Vungu RDC GIS Project")
body(
    "Vungu Rural District Council is a local authority in the Midlands Province of Zimbabwe, "
    "with its administrative headquarters in Gweru. The council exercises jurisdiction over "
    "nineteen administrative wards encompassing rural, peri-urban, and small commercial areas "
    "within its designated planning boundary. Its functions include land administration, "
    "development permit management, spatial planning, infrastructure maintenance, and public "
    "health regulation."
)
body(
    "The Vungu RDC GIS project is a formal system development engagement between the Faculty "
    "of Built Environment at MSU and Vungu RDC, facilitated through the Innovation Hub. The "
    "project brief requires the development of a web-based, spatially enabled planning "
    "management system that will enable Vungu RDC to: register, track, and adjudicate "
    "development permit applications online; enforce land-use zoning compliance by checking "
    "application parcel locations against PostGIS ward and zone geometry; manage the building "
    "plan appraisal and multi-stage construction inspection workflows defined in the Handbook; "
    "and issue certificates of occupation as terminal documents recorded in the geodatabase."
)
body(
    "The system is designed for five user-role tiers. Public users may browse the ward map and "
    "published land-use zones without authentication. Applicants may register, submit permit "
    "applications, and track their application status. Planning officers process applications, "
    "record inspection results, and generate permit or refusal documents. Senior planners "
    "review cases escalated beyond standard officer authority and manage public notification "
    "periods. Administrators manage the system configuration, user accounts, and the development "
    "control matrix."
)
body(
    "At the commencement of this placement, a version 1.0 prototype of the system existed but "
    "had not been security-reviewed or deployed to a production server. The geodatabase schema "
    "was at version 1.1, covering the core permit application record and a basic inspection "
    "record, but had not been formally verified against the Handbook requirements or normalised "
    "to Third Normal Form."
)

# 2.4
section_label("2.4", "Organisational Structure")
body(
    "This section presents the organisational structures relevant to the placement: the MSU "
    "faculty and Innovation Hub hierarchy, the Vungu RDC departmental structure within which "
    "the client stakeholders operate, and the project team structure for the Vungu RDC GIS "
    "engagement."
)

sub_label("2.4.1", "MSU Faculty and Innovation Hub Structure")
body(
    "The organogram below illustrates the hierarchical relationship between the MSU institutional "
    "leadership, the Faculty of Science and Technology, the Department of Computer "
    "Science, and the Research and Innovation Hub within which this placement was conducted."
)

# ORGANOGRAM 1 — MSU / FST / Innovation Hub
org1_headers = ["Level", "Position / Unit", "Role in WRL Context"]
org1_rows = [
    ["University Level",   "Vice Chancellor",                              "Overall institutional leadership and Education 5.0 mandate"],
    ["University Level",   "Pro Vice Chancellor: Academic Affairs",        "Academic oversight of WRL programme and faculty activities"],
    ["University Level",   "Director: Research and Innovation",            "Oversight of all Hub projects; approves industry engagements"],
    ["Faculty Level",      "Dean: Faculty of Science and Technology (FST)",   "Faculty academic authority; approves WRL placements within FST"],
    ["Faculty Level",      "Dean: Faculty of Built Environment",           "Co-supervising faculty for Vungu RDC GIS engagement"],
    ["Department Level",   "Chairperson: Department of Computer Science",  "Departmental coordination; WRL compliance and student welfare"],
    ["Hub Level",          "Manager: MSU Research and Innovation Hub",     "Hub operations, resource allocation, and project portfolio oversight"],
    ["Project Level",      "Dr Paradzayi — Project Manager, Vungu RDC GIS","Direct academic supervisor; technical direction and quality assurance"],
    ["Project Level",      "Rafiq — Research Assistant",                   "Research deliverable management; documentation standards"],
    ["Project Level",      "Munyaradzi Namailinga — Backend Developer",    "Backend engineering, spatial database design, research papers"],
    ["Project Level",      "Theophelos — Frontend Developer",              "Browser-side UI development, Leaflet.js map integration"],
]
add_table(org1_headers, org1_rows, col_widths=[3.5, 6.5, 5.0])

sub_label("2.4.2", "Vungu RDC Organisational Structure")
body(
    "The organogram below presents the Vungu RDC organisational hierarchy relevant to the "
    "GIS project engagement, showing the client stakeholders who participated in the site "
    "visit and the formal system demonstration."
)

org2_headers = ["Tier", "Post / Unit", "Relevance to GIS Project"]
org2_rows = [
    ["Council Tier",          "Vungu RDC Full Council",                         "Governance body; policy approval for digital systems adoption"],
    ["Executive Management",  "Chief Executive Officer (CEO)",                  "Strategic approval for GIS system deployment and budget"],
    ["Executive Management",  "Director of Technical Services",                 "Oversees planning, engineering, and environmental functions"],
    ["Management Tier",       "Head: Department of Planning",                   "Primary client contact; system requirements authority"],
    ["Management Tier",       "Head: GIS and Mapping Unit",                     "Geodata custodian; spatial data provision and verification"],
    ["Operations",            "Senior Planning Officer",                        "Demonstrated system to; provided ward-level requirements"],
    ["Operations",            "Planning Officer (Permit Processing)",           "End user of permit application and inspection modules"],
    ["Operations",            "Environmental Health Officer (EHO)",             "End user of compliance checking module"],
    ["Operations",            "Administrative Clerk (Records and Document Mgmt)","End user of document upload and verification module"],
]
add_table(org2_headers, org2_rows, col_widths=[3.5, 6.0, 5.5])

sub_label("2.4.3", "Project Team Structure")
body(
    "The immediate project team for the Vungu RDC GIS engagement operates as a flat, task-based "
    "structure within the Innovation Hub. The diagram below shows reporting lines, communication "
    "channels, and role boundaries within the team."
)

org3_headers = ["Role", "Person", "Responsibilities", "Reporting / Communication"]
org3_rows = [
    ["Project Manager",         "Dr Paradzayi",        "Technical direction, quality assurance, client liaison, weekly review meetings",   "Reports to Hub Manager and Dean (Built Environment)"],
    ["Research Assistant",      "Rafiq",               "Research brief setting, documentation review, Vungu RDC stakeholder coordination",  "Reports to Dr Paradzayi; liaises directly with Planning Dept."],
    ["Backend Developer",       "Munyaradzi Namailinga","API development, database design, security, Docker, research papers, testing",     "Reports to Dr Paradzayi; coordinates daily with Theophelos"],
    ["Frontend Developer",      "Theophelos",          "Leaflet.js map UI, application forms, officer dashboard, report views",             "Reports to Dr Paradzayi; API integration with Munyaradzi"],
    ["Client Representative",   "Head of Planning, Vungu RDC","Requirements sign-off, system acceptance, operational feedback",            "Engages through Dr Paradzayi and Rafiq; attends demonstrations"],
]
add_table(org3_headers, org3_rows, col_widths=[3.5, 3.5, 5.5, 4.5])
page_break()

# ═══════════════════════════════════════════════════════════════════════════════
# CHAPTER 3 — WORK PLAN
# ═══════════════════════════════════════════════════════════════════════════════
heading("CHAPTER 3: WORK PLAN", size=15, bold=True, colour=(31,56,100), space_before=0, space_after=6)

section_label("3.1", "Planned Activities")
body(
    "At the commencement of the placement, a phased work plan was agreed between the student "
    "and the project supervisor. The plan was organised to respect the logical dependency "
    "between activities: security remediation must precede new feature development; server "
    "provisioning must precede deployment testing; the Handbook study must precede schema "
    "gap analysis; and schema gap analysis must precede the schema refinement document. The "
    "following table presents the ten phases of work covered by this report, with dates, "
    "objectives, and deliverables for each phase."
)

wp_headers = ["Phase", "Period", "Objectives", "Deliverables"]
wp_rows = [
    ["1 — Orientation & Code Review",
     "Week 1, Feb 2026",
     "Understand project scope; review prototype codebase; identify security defects; research GIS stack",
     "Security defect report; GIS technology research notes; environment setup"],
    ["2 — Server Setup & Research",
     "Weeks 1–2, Mar 2026",
     "Provision Ubuntu 24.04 LTS VPS; install full stack; set up Git repository; research PostGIS and GeoJSON",
     "Provisioned server; installed Node.js, PostgreSQL/PostGIS, QGIS Server, Nginx; repository initialised"],
    ["3 — Security Hardening",
     "Week 3, Mar 2026",
     "Remediate all identified CVEs; rebuild authentication; remove hardcoded credentials; sanitise inputs; site visit",
     "10 CVEs cleared; bcrypt/JWT auth; Git history rewrite; site visit findings report"],
    ["4 — API & Documentation",
     "Week 4, Mar 2026",
     "Refine all API routes; implement Docker containerisation; produce backend architecture documentation",
     "Full API route map; Docker compose file; BACKEND_GUIDE.md; Mermaid architecture diagrams"],
    ["5 — Deployment & Testing",
     "Weeks 1–2, Apr 2026",
     "Deploy to production; write integration tests; implement HTTPS; participate in ZITF hackathon; demonstrate to client",
     "Production deployment; Jest/Supertest test suite; HTTPS via Let's Encrypt; ZITF participation; demonstration approved"],
    ["6 — Handbook Study & Gap Analysis",
     "Week 3, Apr 2026",
     "Read and map Zimbabwe Dev. Mgmt. Handbook 2021; compare to v1.1 schema; identify gaps",
     "Handbook section analysis; gap analysis table; 15 missing tables identified; 7 missing columns identified"],
    ["7 — Schema Refinement v1.2",
     "Week 4, Apr 2026",
     "Design 15 new tables; write full DDL; produce implementation workflow; submit schema refinement document",
     "Schema Refinement Document v1.2 with column specs, DDL, and phase-by-phase implementation workflow"],
    ["8 — 3NF Verification & DCM Normalisation",
     "Week 5, Apr/May 2026",
     "Formally verify all 15 new tables to 3NF; normalise DCM from UNF to 3NF",
     "3NF Verification Report v1.2.1; DCM Normalisation Report with 5 normalised relations"],
    ["9 — DCM Data Dictionary & SQL/NoSQL Research",
     "Week 1, May 2026",
     "Document all DCM tables; complete SQL vs NoSQL research paper",
     "DCM Data Dictionary v1.0; SQL vs NoSQL GIS Research Paper"],
    ["10 — Document Verification Research (ongoing)",
     "Week 2+, May 2026",
     "Research document verification methods; compare manual and automated approaches; cover Zimbabwe DPA 2021",
     "Document Verification and Storage Research Paper (ongoing at report date)"],
]
add_table(wp_headers, wp_rows, col_widths=[4.0, 2.5, 5.0, 5.0])

body(
    "Weekly progress was reviewed in virtual meetings with Dr Paradzayi. Where tasks were "
    "delayed — for example, the server provisioning credential delay in early March — the "
    "schedule was adapted by prioritising research and documentation work that could proceed "
    "without server access, without disrupting the overall delivery timeline."
)

# Risk table
sub_label("3.1.1", "Risk Register")
body(
    "The following table documents the principal risks identified at the start of the placement, "
    "the likelihood and impact assessments, and the mitigation measures applied."
)
risk_headers = ["Risk", "Likelihood", "Impact", "Mitigation"]
risk_rows = [
    ["Prototype codebase contains security vulnerabilities",         "High",   "High",   "Formal security audit in Phase 1 before any new development proceeds"],
    ["Server provisioning credentials delayed",                      "Medium", "Medium", "Use waiting period for research; buffer weeks built into schedule"],
    ["Handbook statutory language ambiguous for schema translation", "Medium", "High",   "Multiple reading passes; cross-reference with annexures; verify with supervisor"],
    ["Git history rewrite disrupts team after credential removal",   "Low",    "High",   "Co-ordinate with all team members before rewrite; immediate password rotation"],
    ["PostGIS/GiST spatial indexing unfamiliar domain",             "High",   "Medium", "Dedicated research sprint in Phase 1–2 before schema design begins"],
    ["Scope creep from Vungu RDC officer requests during demo",     "Medium", "Low",    "Log all requests; prioritise through supervisor; defer non-critical items"],
]
add_table(risk_headers, risk_rows, col_widths=[5.0, 2.0, 2.0, 6.0])

# 3.2
section_label("3.2", "Links to Programme of Study")
body(
    "The work undertaken during this placement connects directly to multiple taught modules in "
    "the Bachelor of Science Honours Degree in Computer Science at Midlands State University. "
    "The table below maps each major area of placement activity to the corresponding academic "
    "module and identifies the specific skills applied."
)

links_headers = ["Placement Activity", "Academic Module", "Skills Applied"]
links_rows = [
    ["Security audit, CVE remediation, bcrypt/JWT auth, input sanitisation",
     "Software Security",
     "OWASP vulnerability classification; hashing and key derivation; input validation; secure HTTP headers"],
    ["PostGIS schema design, 3NF verification, DCM normalisation, data dictionaries",
     "Advanced Databases",
     "Relational theory; functional dependency analysis; normalisation to 3NF; DDL authoring; spatial data types"],
    ["Fastify REST API design, route structuring, request/response schema validation",
     "Web Systems and Internet Programming",
     "REST architectural constraints; HTTP method semantics; JSON schema validation; middleware patterns"],
    ["Docker containerisation, Nginx reverse proxy, PM2 process supervision",
     "Distributed Computing and Cloud Systems",
     "Container orchestration; service health checks; reverse proxy configuration; process management"],
    ["Ubuntu 24.04 LTS provisioning, SSH hardening, firewall configuration",
     "Computer Networks and Operating Systems",
     "Linux administration; network security; SSH key management; UFW firewall rules"],
    ["OGC WMS/WFS standard study, QGIS Server integration, Leaflet.js API consumption",
     "Geographic Information Systems (elective)",
     "OGC service standards; spatial reference systems; map tile protocols; GeoJSON RFC 7946"],
    ["SQL vs NoSQL research paper; Document Verification research paper",
     "Technical Writing and Research Methods",
     "Comparative research methodology; academic citation; structured technical argument; audience-aware writing"],
    ["Handbook study, gap analysis, schema refinement documentation",
     "Systems Analysis and Design",
     "Requirements elicitation from statutory documents; gap analysis; data modelling; specification writing"],
    ["API integration testing with Jest and Supertest",
     "Software Engineering",
     "Test-driven development; integration test design; assertion strategy; CI test suite organisation"],
]
add_table(links_headers, links_rows, col_widths=[5.0, 4.0, 6.0])
page_break()

# ═══════════════════════════════════════════════════════════════════════════════
# CHAPTER 4 — WORK ACCOMPLISHED
# ═══════════════════════════════════════════════════════════════════════════════
heading("CHAPTER 4: WORK ACCOMPLISHED", size=15, bold=True, colour=(31,56,100), space_before=0, space_after=6)

body(
    "This chapter provides a detailed account of all work accomplished during the placement "
    "period, organised by phase. Each section describes the task context, the methods applied, "
    "the tools and technologies used, and the deliverables produced."
)

# 4.1
section_label("4.1", "System Analysis and Prototype Security Review")
body(
    "The placement began with a formal project orientation meeting with Dr Paradzayi, during "
    "which the project brief, the current system state, the client relationship with Vungu RDC, "
    "and the technical objectives for the placement period were discussed in detail. The first "
    "substantive task assigned was a formal review of the existing prototype codebase."
)
body(
    "The security review was conducted by systematically examining the codebase against the "
    "OWASP Top Ten 2021 vulnerability categories. The review identified three categories of "
    "security defect that required immediate remediation before any new development could proceed "
    "on top of the prototype."
)
body(
    "The first category was authentication and credential security. Password storage was "
    "implemented using a plaintext prefix concatenated with the user input rather than a "
    "cryptographic hash function. This means that any attacker with read access to the "
    "database could immediately recover all user passwords. Additionally, the database "
    "connection credentials — host, port, database name, username, and password — were "
    "hardcoded as string literals in the main application source file and committed to the "
    "Git repository. This meant that anyone with access to the repository history had "
    "permanent access to the database credentials, regardless of whether the strings were "
    "subsequently removed from the working tree."
)
body(
    "The second category was missing input validation on public-facing endpoints. Several "
    "API routes accepted user-supplied strings without any sanitisation or schema validation, "
    "creating exposure to SQL injection if input was passed directly to query strings, and "
    "cross-site scripting if input was reflected in responses consumed by the frontend."
)
body(
    "The third category was dependency vulnerabilities. A dependency audit using the Node.js "
    "package audit toolchain identified ten known CVEs across the dependency tree, including "
    "two of medium severity and one of high severity in libraries directly used by the API."
)
body(
    "The findings were documented in a structured security defect report, classified by OWASP "
    "category and severity, and presented to Dr Paradzayi. The supervisor confirmed that all "
    "findings must be resolved before new features were built on the prototype."
)

sec_headers = ["Vulnerability", "OWASP Category", "Severity", "Remediation Applied"]
sec_rows = [
    ["Plaintext password storage",          "A02: Cryptographic Failures",     "Critical", "Rebuilt with bcrypt at cost factor 12; all existing passwords force-reset"],
    ["Hardcoded database credentials",      "A02: Cryptographic Failures",     "High",     "Credentials moved to .env; .env added to .gitignore; Git history rewritten; password rotated"],
    ["Missing input validation",            "A03: Injection",                   "High",     "Fastify JSON Schema validation added to all routes; input sanitiser rewritten"],
    ["10 CVEs in dependency tree",          "A06: Vulnerable Components",       "Mixed",    "npm audit fix applied; 2 packages replaced; 0 CVEs remaining after remediation"],
    ["No application audit trail",          "A09: Security Logging Failures",   "Medium",   "application_status_history table added; every status change logged with officer ID and timestamp"],
    ["Root login enabled on SSH",           "A05: Security Misconfiguration",   "High",     "PermitRootLogin disabled; key-based authentication enforced; MaxAuthTries set to 3"],
]
add_table(sec_headers, sec_rows, col_widths=[4.0, 4.0, 2.0, 5.0])

body(
    "The first week was also devoted to GIS technology research. PostGIS and its spatial data "
    "model were entirely new to the student at the start of the placement. The conceptual shift "
    "required was understanding that geographic geometries — points, lines, polygons — can be "
    "stored as typed columns in a relational database, indexed with a GiST spatial index for "
    "efficient bounding-box queries, and queried with spatial predicates such as ST_Within, "
    "ST_Intersects, and ST_Contains. WMS and WFS were studied as the OGC standards governing "
    "how QGIS Server and Nginx serve raster map tiles and vector feature data respectively. "
    "The RFC 7946 GeoJSON specification was read in full as the wire format for all spatial "
    "data exchanged between the API and the Leaflet.js frontend."
)

# 4.2
section_label("4.2", "Infrastructure Provisioning and Backend Development")
body(
    "Following the security review, the production server was provisioned: an Ubuntu 24.04 LTS "
    "virtual machine. SSH hardening was applied immediately upon first login: password "
    "authentication was disabled in favour of RSA key-based authentication, root login was "
    "disabled by setting PermitRootLogin no in sshd_config, MaxAuthTries was set to 3, and "
    "the UFW firewall was configured to permit only ports 22 (SSH), 80 (HTTP), and 443 (HTTPS), "
    "with all other inbound ports blocked by default."
)

stack_headers = ["Component", "Version", "Role in System", "Configuration Notes"]
stack_rows = [
    ["Node.js",      "22 LTS",   "Backend API runtime",                    "PM2 process manager; auto-restart on crash and reboot"],
    ["Fastify",      "4.x",      "HTTP framework; schema validation; routing", "JSON Schema validation on all request bodies and query params"],
    ["PostgreSQL",   "16",       "Relational database engine",             "Dedicated app user with minimum required privileges; no superuser in app"],
    ["PostGIS",      "3.4",      "Spatial extension; geometry storage; spatial queries", "SRID 4326 (WGS 84) enforced on all geometry columns; GiST indexes"],
    ["QGIS Server",  "3.x",      "OGC WMS and WFS service endpoint",       "Served through Nginx location block; project file references PostGIS layers"],
    ["Nginx",        "1.24",     "Reverse proxy; HTTPS termination; static file serving", "SSL termination; proxy_pass to Node.js; separate location for QGIS WMS/WFS"],
    ["Docker",       "26.x",     "Containerisation of all three services", "Three-service compose: db, api, qgis-server; health check ordering"],
    ["Certbot/ACME", "Latest",   "TLS certificate provisioning",           "Let's Encrypt certificates; auto-renewal cron job"],
    ["Jest + Supertest", "Latest","API integration test suite",            "Tests all route groups; asserts HTTP status codes and response schemas"],
]
add_table(stack_headers, stack_rows, col_widths=[2.5, 1.5, 5.0, 6.0])

body(
    "The security hardening sprint in Week 3 of March addressed all identified vulnerabilities "
    "systematically. The authentication system was rebuilt from first principles using bcrypt "
    "at cost factor 12 for password hashing — a cost factor that results in approximately "
    "300 milliseconds per hash operation, making offline brute-force attacks computationally "
    "prohibitive while remaining imperceptible to legitimate users. JWTs were implemented for "
    "stateless session management, signed with a 256-bit secret key loaded from the environment "
    "file and verified on every protected route using a Fastify authentication plugin."
)
body(
    "Hardcoded credentials were removed from the source tree and the .env file was added to "
    ".gitignore to prevent future accidental commits. The Git history was then rewritten using "
    "git filter-branch to purge the commit containing the hardcoded credentials, removing them "
    "from the repository history entirely. The database password was rotated immediately after "
    "the history rewrite. All team members were notified and required to re-clone the repository, "
    "as the history rewrite changes the SHA-1 hash of every subsequent commit."
)
body(
    "The input sanitiser was rewritten to use Fastify's built-in JSON Schema validation on every "
    "route handler, targeting specific attack patterns (SQL injection sequences, script injection) "
    "rather than the original approach of blocking overly broad character classes that would have "
    "rejected legitimate planning data such as hyphens in applicant names or forward slashes "
    "in address fields."
)
body(
    "Docker containerisation was completed with a three-service compose configuration covering "
    "the PostgreSQL/PostGIS database, the Node.js API, and QGIS Server. Health check ordering "
    "was implemented using Docker Compose depends_on conditions so that the API container waits "
    "for the PostgreSQL container to report healthy — verified by a pg_isready probe — before "
    "the Node.js process attempts its first database connection. This prevents application "
    "startup errors during fresh deployments where database initialisation takes several seconds."
)
body(
    "Comprehensive backend architecture documentation was produced, including a BACKEND_GUIDE.md "
    "file with a complete API route inventory, database schema reference, environment variable "
    "specification, deployment checklist, and Mermaid diagrams for the system architecture "
    "and database entity relationships. An application_status_history table was added to the "
    "schema to create a tamper-evident audit trail: every change to an application's status "
    "is recorded with the officer's user identifier, the new status value, an optional note, "
    "and a server-side timestamp, enabling full forensic reconstruction of the processing "
    "history of any permit application."
)

# 4.3
section_label("4.3", "Testing, Deployment, and System Demonstration")
body(
    "A structured site visit to the Vungu RDC Department of Planning was conducted in Week 3 "
    "of March. The visit served three purposes: to understand the current paper-based workflow "
    "in sufficient detail to validate the system's user journey design; to identify any "
    "requirements not captured in the written project brief; and to build the working "
    "relationship with the planning officers who would be the primary users of the system."
)
body(
    "The interviews with planning officers produced several findings of material importance. "
    "The nineteen-ward hierarchy was identified as the fundamental organising principle of all "
    "council planning data: every application, every inspection, every enforcement order, and "
    "every certificate of occupation is recorded against a specific ward. This detail was not "
    "present in the written project brief but was essential for the schema and API design. "
    "The visiting officers also requested a ward-level application statistics endpoint to give "
    "them visibility of the backlog by ward, which was added to the API in response. "
    "The officers further confirmed that three document types — identity documents, title "
    "deeds, and previous planning approvals — are required at submission time, and that the "
    "system must store scanned copies and record which clerk verified each document."
)

demo_headers = ["User Journey", "Functionality Demonstrated", "Outcome"]
demo_rows = [
    ["Public map browsing",       "Ward boundary layer; land-use zone overlay; parcel search by plot number",         "Demonstrated successfully; officers noted high map load speed"],
    ["Application submission",    "Applicant registration; form submission; document upload; status tracking portal", "Demonstrated successfully; applicant receives email reference number"],
    ["Planning officer review",   "Application queue by ward; document viewer; spatial compliance check display",     "Demonstrated successfully; ward-filter query performance confirmed"],
    ["Senior planner sign-off",   "Escalated case review; permit/refusal document generation",                        "Demonstrated successfully; PDF permit document generated correctly"],
    ["Administrative reporting",  "Monthly application statistics; ward backlog heatmap; export to CSV",              "Demonstrated successfully; officers requested additional filter by use type"],
]
add_table(demo_headers, demo_rows, col_widths=[3.5, 7.0, 4.5])

body(
    "The API integration test suite was written using Jest as the test runner and Supertest as "
    "the HTTP assertion library. Tests covered authentication (registration, login, token "
    "validation, token expiry), permit application CRUD operations, ward-level statistics "
    "endpoints, spatial compliance checking endpoints, and error handling for invalid input. "
    "The test suite executed 47 test cases against the running application instance, with all "
    "47 tests passing at the time of the demonstration."
)
body(
    "HTTPS was implemented using Certbot and a Let's Encrypt certificate, with automatic "
    "renewal configured through a systemd timer. The Nginx configuration was updated to "
    "redirect all HTTP traffic to HTTPS, and the HSTS header was set to enforce secure "
    "connections for subsequent browser visits. The system was also entered in the ZITF "
    "2026 Innovation Hackathon, where it was presented alongside other MSU Innovation Hub "
    "projects to industry judges."
)

# 4.4
section_label("4.4", "Development Management Handbook Study and Schema Gap Analysis")
body(
    "Beginning in Week 3 of April, the focus of the placement shifted entirely to research "
    "and database documentation work. The Zimbabwe Development Management (Control) Handbook "
    "2021 was studied systematically over approximately one week. The Handbook is a statutory "
    "instrument issued by the Ministry of Local Government and Public Works of Zimbabwe. It "
    "prescribes, in procedural and documentary detail, how local planning authorities "
    "(including rural district councils) must manage all aspects of development management "
    "within their jurisdiction."
)
body(
    "The Handbook is organised into five major lifecycle phases, each supported by numbered "
    "statutory annexures that define the specific forms, checklists, and documentary outputs "
    "required at each stage. The table below summarises each phase and its data requirements "
    "as extracted during the study."
)

hb_headers = ["Phase", "Handbook Reference", "Key Data Requirements Identified"]
hb_rows = [
    ["Development Permit Application (8-step process)",
     "Section 2; Annexures 1–10",
     "Applicant details; site location (parcel geometry); land-use category; application type; One-Stop-Shop consultation record; public notification period; objections and representations; planning officer recommendation; appeal to Administrative Court; permit or refusal document"],
    ["Enforcement — Illegal Development",
     "Sections 3.3–3.4; Annexure Forms",
     "Enforcement order issuance; offending development description; remediation timeline; prohibition order for non-compliant structures; enforcement officer identity; legal authority reference"],
    ["Building Plan Appraisal",
     "Sections 4.x; Annexure 11",
     "Building plan submission; five mandatory drawing types (site plan, floor plan, elevations, sections, services layout); appraisal checklist items per drawing type; appraisal officer recommendation"],
    ["Stage Construction Inspections",
     "Annexures 12, 14",
     "Nine sequential inspection stages (foundations, DPC, floor slab, structural frame, roof, external finishes, plumbing, electrical, final); inspection items per stage; pass/fail/partial result per item; inspector identity; date"],
    ["Certificate of Occupation",
     "Section 5.9; Annexure 13",
     "Final inspection clearance; COO reference number; issuing officer; expiry date; link to all prior inspection records; PDF document generation and storage"],
]
add_table(hb_headers, hb_rows, col_widths=[4.0, 3.5, 7.5])

body(
    "Following the Handbook study, a gap analysis compared the existing v1.1 enterprise "
    "geodatabase schema against the full set of Handbook data requirements. The v1.1 schema "
    "implemented only two tables relevant to the development management lifecycle: "
    "permit_application (covering the core application record) and inspection (a single "
    "undifferentiated inspection record). The gap analysis identified fifteen missing tables "
    "and seven missing columns on the existing permit_application table."
)

gap_headers = ["Missing Component", "Handbook Basis", "Gap Severity"]
gap_rows = [
    ["application_consultation table",                      "Section 2 / OSS Step",             "Critical — OSS step is mandatory"],
    ["application_objection table",                         "Public Notification period",        "High — objections are legally binding records"],
    ["application_appeal table",                            "Administrative Court appeals",      "High — appeal record required by statute"],
    ["enforcement_order table",                             "Section 3.3",                       "High — enforcement is a core planning function"],
    ["prohibition_order table",                             "Section 3.4",                       "High — separate legal instrument from enforcement order"],
    ["building_plan table",                                 "Annexure 11",                       "Critical — building plan approval precedes inspections"],
    ["plan_drawing table",                                  "Annexure 11 (5 drawing types)",     "Critical — each drawing type is separately appraised"],
    ["plan_appraisal table",                                "Annexure 11",                       "Critical — appraisal record links plan to officer recommendation"],
    ["plan_appraisal_item table",                           "Annexure 11 checklist",             "High — checklist items are individually assessed"],
    ["inspection_stage lookup table",                       "Annexure 12 (9 stages)",            "Critical — 9-stage sequence must be enforced"],
    ["inspection_category lookup table",                    "Annexure 14",                       "High — category controls which items are checked"],
    ["inspection_item_type lookup table",                   "Annexure 14",                       "High — item types define pass/fail criteria"],
    ["stage_inspection table",                              "Annexures 12, 14",                  "Critical — replaces undifferentiated inspection table"],
    ["stage_inspection_result table",                       "Annexure 14",                       "Critical — per-item result recording"],
    ["occupation_certificate table",                        "Section 5.9 / Annexure 13",         "Critical — terminal document in lifecycle"],
    ["7 columns missing on permit_application",             "Section 2 (full 8-step process)",   "High — missing: land_use_category, zone_code, occ_status, refusal_reason, appeal_status, permit_expiry_date, processing_officer_id"],
]
add_table(gap_headers, gap_rows, col_widths=[5.5, 4.5, 4.0])

# 4.5
section_label("4.5", "Schema Refinement v1.2: Fifteen New Tables")
body(
    "The Vungu GIS Development Management Schema Refinement document (v1.2) was produced over "
    "the course of Week 4 of April. The document is structured in five parts: a Handbook content "
    "analysis mapping each section and annexure to its data requirements; the gap analysis table "
    "(presented above); full column-level specifications for all fifteen new tables and the two "
    "modified existing tables; complete DDL in CREATE TABLE and ALTER TABLE statements ordered to "
    "respect foreign key dependencies; and a phase-by-phase implementation workflow mapping each "
    "Handbook procedure to the specific database tables, API endpoints, and GIS screens involved."
)
body(
    "A key design principle applied throughout the schema refinement was that all legal "
    "constraints from the Handbook must be enforced at the database level through CHECK "
    "constraints, UNIQUE indexes, and NOT NULL requirements, rather than relying on "
    "application-layer validation. This principle ensures that the database remains "
    "internally consistent even if a bug in the application layer attempts to write "
    "invalid data — an important property for a system holding statutory planning records."
)
body(
    "The following table summarises all fifteen new tables introduced in v1.2, grouped by "
    "implementation phase."
)

v12_headers = ["Phase", "Table Name", "Primary Key", "Key Columns", "Handbook Basis"]
v12_rows = [
    ["Phase 1: Development Application",
     "application_consultation",
     "consultation_id (serial)",
     "application_id (FK), consultation_type, consultant_name, consultation_date, outcome, notes",
     "Section 2 One-Stop-Shop step"],
    ["Phase 1",
     "application_objection",
     "objection_id (serial)",
     "application_id (FK), objector_name, objector_contact, objection_date, summary, officer_response, outcome",
     "Public Notification period"],
    ["Phase 1",
     "application_appeal",
     "appeal_id (serial)",
     "application_id (FK), appellant_name, appeal_date, ground_summary, court_reference, appeal_outcome, outcome_date",
     "Administrative Court appeals"],
    ["Phase 2: Enforcement",
     "enforcement_order",
     "order_id (serial)",
     "ward_id (FK), parcel_ref, offending_use, order_date, compliance_deadline, issuing_officer_id (FK), status",
     "Section 3.3"],
    ["Phase 2",
     "prohibition_order",
     "prohibition_id (serial)",
     "enforcement_order_id (FK), prohibition_date, reason, issuing_officer_id (FK), status",
     "Section 3.4"],
    ["Phase 3: Building Plan Appraisal",
     "building_plan",
     "plan_id (serial)",
     "application_id (FK), submission_date, architect_name, architect_reg_no, status, appraised_by (FK), appraisal_date",
     "Annexure 11"],
    ["Phase 3",
     "plan_drawing",
     "drawing_id (serial)",
     "plan_id (FK), drawing_type (CHECK: site/floor/elevation/section/services), drawing_number, file_path, submission_date",
     "Annexure 11 (5 types)"],
    ["Phase 3",
     "plan_appraisal",
     "appraisal_id (serial)",
     "plan_id (FK), officer_id (FK), appraisal_date, overall_result, recommendation, notes",
     "Annexure 11"],
    ["Phase 3",
     "plan_appraisal_item",
     "item_id (serial)",
     "appraisal_id (FK), drawing_type, check_item, result (CHECK: pass/fail/not_applicable), officer_note",
     "Annexure 11 checklist"],
    ["Phase 4: Stage Inspections (lookup)",
     "inspection_stage",
     "stage_id (serial)",
     "stage_code (UNIQUE), stage_name, sequence_no (UNIQUE), description",
     "Annexure 12 (9 stages)"],
    ["Phase 4 (lookup)",
     "inspection_category",
     "category_id (serial)",
     "stage_id (FK), category_code (UNIQUE), category_name",
     "Annexure 14"],
    ["Phase 4 (lookup)",
     "inspection_item_type",
     "item_type_id (serial)",
     "category_id (FK), item_code (UNIQUE), item_description, pass_criteria",
     "Annexure 14"],
    ["Phase 4 (operational)",
     "stage_inspection",
     "inspection_id (serial)",
     "application_id (FK), stage_id (FK), inspector_id (FK), inspection_date, overall_result, UNIQUE(application_id, stage_id)",
     "Annexures 12, 14"],
    ["Phase 4 (operational)",
     "stage_inspection_result",
     "result_id (serial)",
     "inspection_id (FK), item_type_id (FK), result (CHECK: pass/fail/partial), notes, UNIQUE(inspection_id, item_type_id)",
     "Annexure 14"],
    ["Phase 5: Certificate of Occupation",
     "occupation_certificate",
     "certificate_id (serial)",
     "application_id (FK, UNIQUE), issue_date, issuing_officer_id (FK), coo_reference (UNIQUE), expiry_date, file_path, status",
     "Section 5.9 / Annexure 13"],
]
add_table(v12_headers, v12_rows, col_widths=[3.0, 3.5, 2.5, 5.5, 3.0])

# 4.6
section_label("4.6", "Third Normal Form Verification Report (v1.2.1)")
body(
    "Following the completion of the schema refinement v1.2, a formal Third Normal Form (3NF) "
    "Verification Report was produced to demonstrate that every table introduced in v1.2 "
    "satisfies the requirements of First, Second, and Third Normal Form. The report was "
    "produced as a companion document to v1.2 and submitted to Rafiq as v1.2.1."
)
body(
    "The verification methodology applied to each table was as follows. First, the primary key "
    "and all candidate keys are identified. Second, all non-trivial functional dependencies "
    "present in the table are enumerated using the notation X → Y (X determines Y). Third, "
    "First Normal Form is verified by confirming that all attributes are atomic (no repeating "
    "groups, no multi-valued attributes) and that a primary key exists. Fourth, Second Normal "
    "Form is verified by confirming that all non-key attributes depend on the whole primary key, "
    "not on any proper subset — this check is relevant only for tables with composite primary "
    "keys. Fifth, Third Normal Form is verified by confirming that all non-key attributes "
    "depend directly on the primary key, with no transitive dependency passing through a "
    "non-key attribute."
)

nf_headers = ["Table", "PK", "1NF Status", "2NF Status", "3NF Status", "Notes"]
nf_rows = [
    ["inspection_stage",        "stage_id",      "Pass", "Pass (single PK)", "Pass", "stage_code is UNIQUE; no transitive dependencies"],
    ["inspection_category",     "category_id",   "Pass", "Pass (single PK)", "Pass", "category_code UNIQUE; stage_id FK with no chain dependency"],
    ["inspection_item_type",    "item_type_id",  "Pass", "Pass (single PK)", "Pass", "item_code UNIQUE; category_id FK; pass_criteria depends on item"],
    ["stage_inspection",        "inspection_id", "Pass", "Pass (single PK)", "Pass", "UNIQUE(application_id,stage_id); all attrs depend on inspection"],
    ["stage_inspection_result", "result_id",     "Pass", "Pass (single PK)", "Pass", "UNIQUE(inspection_id,item_type_id); result depends on both FK values"],
    ["plan_appraisal_item",     "item_id",       "Pass", "Pass (single PK)", "Pass", "UNIQUE(appraisal_id,drawing_type,check_item); no partial deps"],
    ["application_consultation","consultation_id","Pass","Pass (single PK)", "Pass", "All attrs depend on consultation_id; no transitive chains"],
    ["application_objection",   "objection_id",  "Pass", "Pass (single PK)", "Pass", "Objector data depends on objection event, not application"],
    ["application_appeal",      "appeal_id",     "Pass", "Pass (single PK)", "Pass", "court_reference depends on appeal, not on application FK"],
    ["enforcement_order",       "order_id",      "Pass", "Pass (single PK)", "Pass", "ward_id FK; all order attrs depend on order_id"],
    ["prohibition_order",       "prohibition_id","Pass", "Pass (single PK)", "Pass", "enforcement_order_id FK; prohibition attrs depend on order"],
    ["building_plan",           "plan_id",       "Pass", "Pass (single PK)", "Pass", "application_id FK; architect data depends on plan submission"],
    ["plan_drawing",            "drawing_id",    "Pass", "Pass (single PK)", "Pass", "UNIQUE(plan_id,drawing_type); file_path depends on drawing"],
    ["plan_appraisal",          "appraisal_id",  "Pass", "Pass (single PK)", "Pass", "plan_id FK; recommendation depends on the specific appraisal"],
    ["occupation_certificate",  "certificate_id","Pass", "Pass (single PK)", "Pass", "application_id UNIQUE FK; coo_reference UNIQUE; expiry depends on issue"],
]
add_table(nf_headers, nf_rows, col_widths=[4.0, 2.5, 1.5, 2.0, 1.5, 5.0])

body(
    "All fifteen tables were confirmed in 3NF. No decomposition was required beyond what had "
    "already been applied during the schema design phase. The systematic verification confirmed "
    "that the design decisions taken during v1.2 — placing all lookup data in separate "
    "normalised reference tables, using surrogate primary keys, and enforcing all uniqueness "
    "constraints at the database level — were consistent with sound relational design principles."
)

# 4.7
section_label("4.7", "Development Control Matrix Normalisation")
body(
    "The Development Control Matrix (DCM) is a two-dimensional cross-reference document "
    "received from the Spatial Planning and Development unit of Vungu RDC. It defines "
    "which land uses are permitted outright (P), prohibited (X), or require special "
    "consent (S) in each of the nineteen land-use zones. In its original spreadsheet "
    "form, the DCM contains 32 land-use group rows and 19 zone columns, producing "
    "608 permission values. The matrix needed to be normalised and imported into the "
    "geodatabase so that the system could evaluate zone compliance automatically."
)
body(
    "The normalisation was applied in three formal stages, each of which is documented below."
)

sub_label("4.7.1", "Stage 1: Un-Normalised Form (UNF) to First Normal Form (1NF)")
body(
    "The original matrix is in Un-Normalised Form because the 19 zone columns constitute "
    "a repeating group: each column is a distinct instance of the same attribute "
    "(permission_status) for a different value of the zone dimension. To achieve 1NF, "
    "the 19 zone columns are unpivoted into rows using a relational decomposition. "
    "The resulting 1NF relation is:"
)
p = doc.add_paragraph()
p.paragraph_format.left_indent = Cm(1.5)
r = p.add_run("DCM_1NF(ug_code, ug_description, zone_code, zone_name, permission_status)")
set_font(r, name="Courier New", size=10)
body(
    "with a composite primary key of (ug_code, zone_code). This relation contains 608 rows "
    "(32 use groups × 19 zones), one row per permission value. All attributes are atomic "
    "and there are no repeating groups, satisfying 1NF."
)

sub_label("4.7.2", "Stage 2: First Normal Form (1NF) to Second Normal Form (2NF)")
body(
    "The 2NF check identifies partial dependencies on the composite primary key. Two partial "
    "dependencies are found: ug_description → ug_code (ug_description depends only on ug_code, "
    "not on the full composite key); and zone_name → zone_code (zone_name depends only on "
    "zone_code). These partial dependencies are removed by decomposing DCM_1NF into three "
    "relations:"
)
p = doc.add_paragraph()
p.paragraph_format.left_indent = Cm(1.5)
r = p.add_run(
    "land_use_group(ug_code PK, ug_description)\n"
    "land_use_zone(zone_code PK, zone_name)\n"
    "development_control_permission(ug_code FK, zone_code FK, permission_status)  PK: (ug_code, zone_code)"
)
set_font(r, name="Courier New", size=10)

sub_label("4.7.3", "Stage 3: Second Normal Form (2NF) to Third Normal Form (3NF)")
body(
    "The 3NF check examines each relation for transitive dependencies through non-key "
    "attributes. In land_use_group, ug_description depends only on ug_code (the PK) — "
    "no transitive dependency. In land_use_zone, zone_name depends only on zone_code "
    "(the PK) — no transitive dependency. In development_control_permission, "
    "permission_status depends on (ug_code, zone_code) — no transitive dependency. "
    "All three relations are in 3NF."
)

dcm_headers = ["Normalised Relation", "Primary Key", "Attributes", "Role in System"]
dcm_rows = [
    ["land_use_group",                  "ug_code",                    "ug_code, ug_description",                                    "Reference table for the 32 land-use group categories"],
    ["land_use_zone",                   "zone_code",                  "zone_code, zone_name",                                       "Reference table for the 19 spatial planning zones"],
    ["development_control_permission",  "(ug_code, zone_code)",       "ug_code (FK), zone_code (FK), permission_status (P/X/S)",    "Stores all 608 permission values; queried by zone compliance check"],
    ["zone_spatial_plan (integration)", "zone_id",                    "zone_id, zone_code (FK), zone_geometry (GEOMETRY POLYGON)",  "Links zone_code to PostGIS polygon geometry for spatial queries"],
    ["application_zone_check (integration)", "check_id",             "application_id (FK), zone_code (FK), check_date, result",    "Records the zone compliance check result for each application"],
]
add_table(dcm_headers, dcm_rows, col_widths=[4.0, 3.0, 5.0, 5.0])

body(
    "The normalisation was verified to losslessly preserve all 608 permission values. A natural "
    "join of land_use_group, development_control_permission, and land_use_zone on their shared "
    "keys reproduces the original UNF matrix exactly, confirming that no data was lost "
    "during the decomposition."
)

# 4.8
section_label("4.8", "Data Dictionaries")
body(
    "Two data dictionary documents were produced during the placement. The first is the Vungu "
    "GIS Enterprise Geodatabase Data Dictionary (v1.0), covering the complete schema of the "
    "system database, including all spatial tables, their geometry column specifications, SRID "
    "enforcement, GiST index definitions, and the full foreign key dependency graph. The "
    "dictionary provides column-level documentation for every table: the column name, data type, "
    "nullable status, default value, constraint description, and a plain-language explanation "
    "of the business rule the column enforces."
)
body(
    "The second is the Vungu GIS DCM Data Dictionary (v1.0), a focused companion to the DCM "
    "Normalisation Report, documenting the six tables introduced by the DCM normalisation. "
    "In addition to the standard column documentation, the DCM dictionary includes the "
    "seed data specification for the land_use_group and land_use_zone lookup tables, "
    "allowing a developer to populate these tables from the dictionary alone without "
    "reference to the original spreadsheet."
)

dd_headers = ["Table", "Column", "Data Type", "Nullable", "Constraint", "Business Rule"]
dd_rows = [
    ["development_control_permission", "ug_code",          "VARCHAR(10)",  "NOT NULL", "FK → land_use_group(ug_code)",      "Identifies the land-use group being regulated"],
    ["development_control_permission", "zone_code",        "VARCHAR(10)",  "NOT NULL", "FK → land_use_zone(zone_code)",     "Identifies the zone for which permission is defined"],
    ["development_control_permission", "permission_status","CHAR(1)",      "NOT NULL", "CHECK IN ('P','X','S')",            "P=Permitted; X=Prohibited; S=Special Consent required"],
    ["land_use_group",                 "ug_code",          "VARCHAR(10)",  "NOT NULL", "PRIMARY KEY",                      "Unique code for each of the 32 land-use groups"],
    ["land_use_group",                 "ug_description",   "VARCHAR(200)", "NOT NULL", "—",                                "Full statutory name of the land-use group"],
    ["occupation_certificate",         "coo_reference",    "VARCHAR(30)",  "NOT NULL", "UNIQUE",                           "Council-issued COO reference number; unique per certificate"],
    ["occupation_certificate",         "expiry_date",      "DATE",         "NULL",     "CHECK expiry_date > issue_date",   "COO validity end date; NULL if open-ended"],
]
add_table(dd_headers, dd_rows, col_widths=[3.5, 3.0, 2.0, 1.5, 3.5, 4.5])

# 4.9
section_label("4.9", "Research Papers")
body(
    "Two comparative research papers were assigned as deliverables during the second phase "
    "of the placement. These papers were intended to build the research knowledge base of "
    "the project team and to inform future technical decisions on the Vungu RDC system."
)

sub_label("4.9.1", "SQL versus NoSQL Databases for GIS Systems")
body(
    "The first paper evaluates relational (SQL) and non-relational (NoSQL) database paradigms "
    "across sixteen criteria relevant to GIS workloads. The evaluation was structured around "
    "the specific requirements of a municipal GIS planning system — authoritative spatial data, "
    "complex geometric queries, OGC-standard web service delivery, strict ACID compliance for "
    "statutory records, and long-term data integrity — and was not a generic comparison."
)

sql_headers = ["Criterion", "PostgreSQL + PostGIS", "NoSQL (MongoDB/Elasticsearch)", "Recommendation for Vungu System"]
sql_rows = [
    ["Spatial data support",          "Native geometry types; OGC SFS compliance; WKB/WKT; GeoJSON", "Limited (MongoDB: GeoJSON 2D; no topology)", "PostgreSQL/PostGIS — no equivalent spatial depth in NoSQL"],
    ["Query language",                "SQL: declarative; spatial predicates (ST_Within, ST_Intersects)", "API-based; limited spatial query expressiveness",  "PostgreSQL — complex multi-table spatial joins required"],
    ["ACID compliance",               "Full ACID; serialisable transactions",                          "Eventual consistency in most NoSQL systems",         "PostgreSQL — statutory records must be fully ACID compliant"],
    ["Schema flexibility",            "Rigid schema; migration required for changes",                  "Flexible schema; document model",                    "PostgreSQL — schema rigidity is a feature, not a defect, for planning data"],
    ["Scalability",                   "Vertical + read replicas; Citus for horizontal sharding",       "Horizontal shale-out native",                         "PostgreSQL sufficient for Vungu RDC scale; NoSQL not needed"],
    ["GIS tooling ecosystem",         "QGIS, GeoServer, PostGIS, GDAL — full native support",         "Limited GIS tooling; adapter layers required",        "PostgreSQL — entire OGC toolchain integrates natively"],
    ["Real-time and streaming data",  "Not native; logical replication for CDC",                       "Strong (MongoDB Change Streams; Elasticsearch)",     "NoSQL preferable for real-time sensor/IoT layers if added later"],
    ["Raster data",                   "PostGIS Raster; WMS raster serving via QGIS Server",           "No native raster support",                            "PostgreSQL/PostGIS for all raster requirements"],
]
add_table(sql_headers, sql_rows, col_widths=[3.5, 4.0, 3.5, 5.0])

body(
    "The paper concludes that PostgreSQL with PostGIS is the unambiguously correct choice for "
    "the Vungu RDC system's authoritative spatial dataset and all statutory planning records. "
    "NoSQL databases — specifically MongoDB for document storage and Elasticsearch for "
    "full-text search — are identified as potentially complementary for specific future modules "
    "such as real-time inspection mobile data collection or a document search index, but not "
    "as replacements for the core geodatabase."
)

sub_label("4.9.2", "Document Verification and Storage in a Local Municipal GIS User System")
body(
    "The second research paper addresses document verification and storage for the three "
    "document categories that the Vungu RDC planning system requires applicants to submit: "
    "identity documents (national ID, passport), title deeds (registered by the Deeds "
    "Registry of Zimbabwe), and previous planning approvals (permits or letters issued by "
    "a recognised LPA)."
)
body(
    "The paper examines two approaches to document verification. Manual verification by "
    "council clerks involves physical or scanned document inspection against visual "
    "authenticity indicators: security features (watermarks, holograms), official stamps, "
    "registration numbers, and cross-reference with physical registers or databases accessible "
    "to the council. Automated digital verification uses OCR to extract text fields from "
    "scanned documents, barcode and QR-code reading for electronically issued documents, "
    "facial recognition for identity document matching, and API-based registry lookups "
    "against the Deeds Registry or civil registry (where such APIs are available)."
)

dv_headers = ["Document Type", "Verification Method", "Automation Feasibility", "Storage Requirement"]
dv_rows = [
    ["National ID / Passport",  "Visual check of security features; cross-reference with name on application form",   "Medium — OCR for name/ID extraction; facial recognition for photo match",    "Scanned PDF/JPEG; linked to applicant record by FK; access control: clerk and above"],
    ["Title Deed",              "Verify registration number format; check issuing registry; confirm plot description matches application site",  "Low — Deeds Registry API not publicly accessible in Zimbabwe",  "Scanned PDF; linked to application by FK; immutable once verified"],
    ["Previous Planning Approval","Verify LPA stamp; confirm reference number format; cross-check with council records if issued by same LPA",  "Low — no centralised planning approval registry in Zimbabwe",  "Scanned PDF; linked to application; verification status recorded"],
]
add_table(dv_headers, dv_rows, col_widths=[3.0, 5.0, 4.0, 5.0])

body(
    "The paper also covers file naming conventions, database record linkage, access control "
    "tiers, data protection requirements under Zimbabwe's Data Protection Act Chapter 11:12 "
    "(2021), and a fraud indicator checklist for council clerks performing manual verification. "
    "Work on this paper was ongoing at the time of this report, with the manual versus "
    "automated comparison and the Data Protection Act section complete and the storage "
    "architecture section in draft."
)
page_break()

# ═══════════════════════════════════════════════════════════════════════════════
# CHAPTER 5 — SUMMARY, CONCLUSIONS, RECOMMENDATIONS
# ═══════════════════════════════════════════════════════════════════════════════
heading("CHAPTER 5: SUMMARY, CONCLUSIONS, AND RECOMMENDATIONS", size=15, bold=True, colour=(31,56,100), space_before=0, space_after=6)

section_label("5.1", "Summary of Activities Carried Out")
body(
    "The following table presents a consolidated summary of all key activities completed "
    "during the placement period, organised chronologically and categorised by activity type."
)

sum_headers = ["#", "Activity", "Category", "Period", "Status"]
sum_rows = [
    ["1",  "Project orientation and briefing with Dr Paradzayi",                          "Orientation",    "Feb 2026 Wk 1",  "Complete"],
    ["2",  "GIS technology research: PostGIS, OGC, QGIS Server, Fastify, Leaflet.js",   "Research",       "Feb 2026 Wk 1",  "Complete"],
    ["3",  "Prototype codebase security audit — 3 vulnerability categories identified",  "Security",       "Feb 2026 Wk 1",  "Complete"],
    ["4",  "Production server provisioning on Ubuntu 24.04 LTS with SSH hardening",      "Infrastructure", "Mar 2026 Wk 1",  "Complete"],
    ["5",  "Full backend stack installation (Node.js, PostgreSQL/PostGIS, QGIS, Nginx)", "Infrastructure", "Mar 2026 Wk 2",  "Complete"],
    ["6",  "Dependency audit — 10 CVEs identified and cleared to zero",                  "Security",       "Mar 2026 Wk 3",  "Complete"],
    ["7",  "Authentication system rebuilt: bcrypt (CF 12) + signed JWTs",                "Security",       "Mar 2026 Wk 3",  "Complete"],
    ["8",  "Hardcoded credentials removed; Git history rewritten; DB password rotated",  "Security",       "Mar 2026 Wk 3",  "Complete"],
    ["9",  "Input sanitiser rewritten; Fastify JSON Schema validation on all routes",    "Security",       "Mar 2026 Wk 3",  "Complete"],
    ["10", "Site visit to Vungu RDC Department of Planning; structured officer interviews","Client Liaison","Mar 2026 Wk 3",  "Complete"],
    ["11", "PostGIS spatial database schema design and GiST index configuration",        "Database",       "Mar 2026 Wk 2-3","Complete"],
    ["12", "RESTful API development with Fastify; schema validation; ward statistics endpoint","Backend Dev", "Mar-Apr 2026", "Complete"],
    ["13", "application_status_history audit trail added to production schema",           "Database",       "Mar 2026 Wk 3",  "Complete"],
    ["14", "Docker containerisation: 3-service compose with health check ordering",      "Infrastructure", "Mar 2026 Wk 4",  "Complete"],
    ["15", "BACKEND_GUIDE.md documentation; Mermaid architecture and ER diagrams",       "Documentation",  "Mar 2026 Wk 4",  "Complete"],
    ["16", "API integration test suite: 47 tests using Jest and Supertest",              "Testing",        "Apr 2026 Wk 1",  "Complete"],
    ["17", "HTTPS implementation: Certbot, Let's Encrypt, auto-renewal",                 "Infrastructure", "Apr 2026 Wk 1",  "Complete"],
    ["18", "ZITF 2026 Innovation Hackathon participation",                               "Outreach",       "Apr 2026 Wk 2",  "Complete"],
    ["19", "Formal system demonstration to Vungu RDC officers — approved",               "Client Liaison", "Apr 2026 Wk 2",  "Complete"],
    ["20", "Systematic study of Zimbabwe Dev. Mgmt. (Control) Handbook 2021",            "Research",       "Apr 2026 Wk 3",  "Complete"],
    ["21", "Gap analysis: v1.1 schema vs. Handbook — 15 tables, 7 columns missing",     "Database",       "Apr 2026 Wk 3",  "Complete"],
    ["22", "Schema Refinement Document v1.2: 15 new tables, DDL, implementation workflow","Database/Docs", "Apr 2026 Wk 4",  "Complete"],
    ["23", "3NF Verification Report v1.2.1: all 15 tables formally verified",           "Database/Docs",  "Apr/May 2026",   "Complete"],
    ["24", "DCM Normalisation: UNF → 1NF → 2NF → 3NF; 5 normalised relations",         "Database",       "May 2026 Wk 1",  "Complete"],
    ["25", "DCM Normalisation Report and DCM Data Dictionary v1.0",                      "Documentation",  "May 2026 Wk 1",  "Complete"],
    ["26", "SQL vs NoSQL GIS Research Paper",                                            "Research",       "May 2026 Wk 1",  "Complete"],
    ["27", "Document Verification and Storage Research Paper",                           "Research",       "May 2026 Wk 2",  "Ongoing"],
]
add_table(sum_headers, sum_rows, col_widths=[0.6, 7.5, 2.5, 2.5, 2.0])

# 5.2
section_label("5.2", "Problems Encountered and Lessons Learned")
body(
    "Every significant challenge encountered during the placement produced a corresponding "
    "lesson. This section documents the principal problems and the insights they generated."
)

prob_headers = ["Problem", "Description", "Impact", "Resolution and Lesson Learned"]
prob_rows = [
    ["Prototype security state",
     "The prototype had plaintext password storage, hardcoded DB credentials, and missing input validation — three distinct vulnerability categories requiring remediation before any new development.",
     "One full week consumed on remediation before productive feature work could begin.",
     "Resolved by systematic OWASP-based audit and full remediation sprint. Lesson: credentials should never be committed; the cleanup cost (Git history rewrite, team resync, password rotation) greatly exceeds the initial discipline."],
    ["Git history rewrite coordination",
     "Rewriting the repository history to remove the hardcoded credential commit changes the SHA of every subsequent commit, requiring all team members to re-clone.",
     "Team disruption; risk of divergent histories if any member continues working on old clone.",
     "Communicated clearly to Theophelos; coordinated timing; confirmed all team members re-cloned. Lesson: treat history rewrites as a production deployment — plan, communicate, and execute as a team."],
    ["Server provisioning credential delay",
     "Provisioning credentials for the production server were delayed by approximately one week in early March.",
     "Hands-on PostGIS validation could not begin as planned; schema research progressed in a purely theoretical mode.",
     "Redirected time to additional GIS research and documentation. Lesson: buffer server provisioning lead time into project plans; theoretical research during delays is not wasted if applied immediately once access is available."],
    ["Statutory language in Handbook",
     "The Zimbabwe Development Management Handbook uses legal and procedural language that does not map transparently to database schema attributes. Implicit data requirements must be inferred from procedural steps and annexure cross-references.",
     "Schema gap analysis took significantly longer than expected; several revisits to specific sections required.",
     "Applied a structured reading approach: read section → identify actors → identify actions → identify data objects → map to table/column. Lesson: statutory documents require multiple careful readings; domain knowledge accumulates across readings and the second pass always finds what the first missed."],
    ["PostGIS as unfamiliar domain",
     "Spatial database concepts (geometry types, SRIDs, GiST indexing, OGC predicates) were entirely new at the start of the placement.",
     "Risk of schema design errors if spatial concepts were misunderstood.",
     "Dedicated GIS research sprint in Week 1; OGC SFS documentation studied before any schema was written. Lesson: domain-specific technology requires upfront investment before coding; designing without understanding spatial data models produces incorrect schemas that are costly to fix later."],
]
add_table(prob_headers, prob_rows, col_widths=[3.5, 5.0, 3.5, 5.0])

# 5.3
section_label("5.3", "Conclusions")
body(
    "This placement achieved all objectives stated in Chapter 1. A production-grade, "
    "spatially enabled planning management system was built, security-hardened, deployed, "
    "tested, and demonstrated to the client. The enterprise geodatabase was designed to "
    "Third Normal Form, formally verified, and fully documented. The statutory framework "
    "governing development management in Zimbabwe was studied and translated into a "
    "comprehensive, Handbook-compliant database schema. Research papers of professional "
    "quality were produced on two technically relevant topics."
)
body(
    "The placement confirmed that the academic modules in the Computer Science programme at "
    "MSU provide a sound theoretical foundation for professional practice. Advanced Databases, "
    "Software Security, Web Systems, and Computer Networks were directly applied, with "
    "conceptual knowledge translating efficiently into working implementation once the "
    "domain context was understood. The largest knowledge gaps encountered were in the "
    "GIS domain (PostGIS, OGC standards, spatial indexing) and in the Zimbabwean planning "
    "statutory framework, both of which are beyond the standard Computer Science curriculum "
    "and were acquired entirely through self-directed research during the placement."
)
body(
    "The placement also confirmed the value of rigorous documentation as a professional "
    "discipline. The schema refinement document, normalisation reports, and data dictionaries "
    "produced during this placement represent a durable technical asset for the Vungu RDC "
    "GIS project that will remain useful long after the current team members move on. Writing "
    "documentation to the standard required by Dr Paradzayi and Rafiq — complete, unambiguous, "
    "and verifiable — was a more demanding skill than the associated technical work in several "
    "cases, and one that will transfer directly to professional employment."
)

# 5.4
section_label("5.4", "Recommendations")
body("The following recommendations are made based on the experience of this placement.")
numbered(
    "Prototype codebases handed to attachment students should undergo a minimum security "
    "review before handover, covering at minimum: password storage mechanism, credential "
    "handling, input validation, and dependency vulnerability scan. Discovering these issues "
    "at the start of a placement consumes time that could be directed to productive development, "
    "and creates unnecessary stress for the student and supervisor."
)
numbered(
    "The Zimbabwe Development Management (Control) Handbook 2021 should be treated as required "
    "reading and provided to every student or developer joining the Vungu RDC GIS project "
    "at the start of their engagement. Its data requirements define the entire schema, and "
    "without reading it the system cannot be correctly extended or maintained."
)
numbered(
    "Third Normal Form verification should be performed on every new schema design before "
    "DDL is written. The systematic approach documented in the v1.2.1 report — enumerate "
    "functional dependencies, check for partial and transitive dependencies table by table — "
    "takes a fraction of the time required to debug data anomalies after an unnormalised "
    "schema reaches production."
)
numbered(
    "The Development Control Matrix should be maintained exclusively in the normalised "
    "database form (land_use_group, land_use_zone, development_control_permission). "
    "All future updates to zone permissions should be made through the application "
    "administration interface, with changes logged in an audit table. The original "
    "spreadsheet should be archived and not edited."
)
numbered(
    "Future attachment students working on the document management module should read "
    "the Document Verification and Storage research paper produced during this placement "
    "before designing the document upload and verification workflows. The paper documents "
    "the Zimbabwe Data Protection Act obligations that apply to the storage of identity "
    "documents and title deeds, which have direct implications for the database schema "
    "and access control model."
)
numbered(
    "The API integration test suite should be maintained and expanded with each new "
    "feature added to the system. The existing 47-test suite validates all current "
    "user journeys; as the document management, building plan appraisal, and stage "
    "inspection modules are added in subsequent development phases, corresponding "
    "test cases should be written concurrently rather than retrospectively."
)
numbered(
    "Server provisioning timelines should be included explicitly in WRL work plans "
    "submitted to supervisors at the start of placements involving infrastructure setup. "
    "A one-week buffer beyond the expected provisioning date is a reasonable planning "
    "assumption for institutional server environments."
)
doc.add_paragraph()
page_break()

# ═══════════════════════════════════════════════════════════════════════════════
# REFERENCES
# ═══════════════════════════════════════════════════════════════════════════════
heading("REFERENCES", size=14, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_before=0, space_after=10)

refs = [
    "Billett, S. (2011). Learning in the Circumstances of Practice. International Journal of Lifelong Education, 30(5), pp. 35–47.",
    "Coronel, C., Morris, S. and Rob, P. (2019). Database Systems: Design, Implementation, and Management. 13th edn. Boston: Cengage Learning.",
    "Codd, E.F. (1970). A Relational Model of Data for Large Shared Data Banks. Communications of the ACM, 13(6), pp. 377–387.",
    "Date, C.J. (2015). SQL and Relational Theory: How to Write Accurate SQL Code. 3rd edn. Sebastopol: O'Reilly Media.",
    "Fowler, M. and Sadalage, P.J. (2012). NoSQL Distilled: A Brief Guide to the Emerging World of Polyglot Persistence. Upper Saddle River: Addison-Wesley.",
    "Government of Zimbabwe (2018). Education 5.0 Policy Framework. Ministry of Higher and Tertiary Education, Innovation, Science and Technology Development. Harare: Government Printer.",
    "Government of Zimbabwe (2021). Development Management (Control) Handbook. Ministry of Local Government and Public Works. Harare: Government Printer.",
    "Government of Zimbabwe (2021). Data Protection Act, Chapter 11:12. Harare: Government Printer.",
    "Internet Engineering Task Force (2016). RFC 7946: The GeoJSON Format. IETF. Available at: https://datatracker.ietf.org/doc/html/rfc7946.",
    "Kent, W. (1983). A Simple Guide to Five Normal Forms in Relational Database Theory. Communications of the ACM, 26(2), pp. 120–125.",
    "MSU Research and Innovation Hub (2025). Hub Profile and Services Overview. Gweru: Midlands State University.",
    "Open Geospatial Consortium (2011). OGC Simple Features for SQL. OGC Document 06-104r4. Wayland: OGC.",
    "OWASP Foundation (2021). OWASP Top Ten Web Application Security Risks. OWASP. Available at: https://owasp.org/Top10.",
    "PostGIS Development Group (2024). PostGIS 3.4 Documentation. Available at: https://postgis.net/docs.",
    "PostgreSQL Global Development Group (2024). PostgreSQL 16 Documentation. Available at: https://www.postgresql.org/docs/16.",
    "Provos, N. and Mazieres, D. (1999). A Future-Adaptable Password Scheme. Proceedings of the 1999 USENIX Annual Technical Conference, pp. 81–91.",
    "Ramsey, P. and Blasby, D. (2004). The PostGIS Project. Victoria: Refractions Research.",
    "Zimbabwe Regional, Town and Country Planning Act, Chapter 29:12. Government of Zimbabwe.",
]

for ref in refs:
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after  = Pt(5)
    p.paragraph_format.left_indent  = Cm(1.0)
    p.paragraph_format.first_line_indent = Cm(-1.0)
    r = p.add_run(ref)
    set_font(r, size=11)

# ── Save ──────────────────────────────────────────────────────────────────────
out = r"c:\Users\munya\Desktop\WRL\Munyaradzi_Namailinga_WRL_Preliminary_Report_R243100H_v3.docx"
doc.save(out)
print(f"Saved: {out}")
