from docx import Document
from docx.shared import Pt, Inches, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

doc = Document()
for section in doc.sections:
    section.top_margin    = Cm(2.54)
    section.bottom_margin = Cm(2.54)
    section.left_margin   = Cm(3.0)
    section.right_margin  = Cm(2.54)

def set_font(run, name="Times New Roman", size=12, bold=False, italic=False, colour=None):
    run.font.name = name
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    if colour:
        run.font.color.rgb = RGBColor(*colour)

def shade_cell(cell, hex_colour="D9E1F2"):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"),   "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"),  hex_colour)
    tcPr.append(shd)

def heading(text, size=14, bold=True, colour=(0,0,0), align=WD_ALIGN_PARAGRAPH.LEFT, sb=12, sa=6):
    p = doc.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_before = Pt(sb)
    p.paragraph_format.space_after  = Pt(sa)
    r = p.add_run(text)
    set_font(r, size=size, bold=bold, colour=colour)
    return p

def body(text, align=WD_ALIGN_PARAGRAPH.JUSTIFY, size=12, sb=0, sa=6, italic=False, indent=True):
    p = doc.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_before = Pt(sb)
    p.paragraph_format.space_after  = Pt(sa)
    if indent:
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

def sec(num, title):
    heading(f"{num}  {title}", size=13, bold=True, sb=10, sa=4)

def sub(num, title):
    heading(f"{num}  {title}", size=12, bold=True, sb=8, sa=3)

def add_table(headers, rows, col_widths=None, hfill="1F3864", htc=(255,255,255)):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(headers):
        c = t.rows[0].cells[i]
        c.text = ""
        shade_cell(c, hfill)
        p = c.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(h)
        set_font(r, size=11, bold=True, colour=htc)
    for row_data in rows:
        rc = t.add_row().cells
        for i, val in enumerate(row_data):
            rc[i].text = ""
            p = rc[i].paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            r = p.add_run(str(val))
            set_font(r, size=11)
    if col_widths:
        for ci, w in enumerate(col_widths):
            for row in t.rows:
                row.cells[ci].width = Cm(w)
    doc.add_paragraph()
    return t

def pb(): doc.add_page_break()

# ── COVER PAGE ──────────────────────────────────────────────────────────────
def cline(text, size=12, bold=False, sb=0, sa=4, colour=(0,0,0)):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(sb)
    p.paragraph_format.space_after  = Pt(sa)
    r = p.add_run(text)
    set_font(r, size=size, bold=bold, colour=colour)

cline("MIDLANDS STATE UNIVERSITY", 16, True, sa=2, colour=(0,51,102))
cline("FACULTY OF SCIENCE AND TECHNOLOGY", 13, True, sa=2, colour=(0,51,102))
cline("DEPARTMENT OF COMPUTER SCIENCE", 13, True, sa=18, colour=(0,51,102))
cline("WRL PRELIMINARY REPORT", 18, True, sa=6, colour=(31,56,100))
cline("Work-Related Learning Placement at", 12, sa=4)
cline("MSU RESEARCH AND INNOVATION HUB", 13, True, sa=2, colour=(0,102,0))
cline("VUNGU RURAL DISTRICT COUNCIL GIS PROJECT", 13, True, sa=10, colour=(0,102,0))
cline("GIS-Based Municipal Planning Information System for Vungu RDC", 12, True, sa=16)
cline("Submitted in partial fulfilment of the requirements of the", 11, sa=2)
cline("Bachelor of Science Honours Degree in Computer Science", 11, True, sa=2)
cline("Midlands State University", 11, sa=20)

meta = [
    ("Student Name",  "Munyaradzi Namailinga"),
    ("Student ID",    "R243100H"),
    ("Programme",     "BSc Honours Degree in Computer Science"),
    ("Level",         "3.1"),
    ("Organisation",  "MSU Research and Innovation Hub / Vungu RDC GIS Project"),
    ("Supervisor",    "Dr Paradzayi, Project Manager"),
    ("WRL Period",    "23 February 2026 to 13 May 2026 (ongoing)"),
    ("Report Date",   "May 2026"),
]
t = doc.add_table(rows=len(meta), cols=2)
t.style = "Table Grid"
t.alignment = WD_TABLE_ALIGNMENT.CENTER
for i,(label,val) in enumerate(meta):
    lc = t.rows[i].cells[0]; vc = t.rows[i].cells[1]
    shade_cell(lc,"1F3864"); shade_cell(vc,"EBF3FB")
    lc.width = Cm(5); vc.width = Cm(10)
    lp = lc.paragraphs[0]; lp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    lr = lp.add_run(label); set_font(lr, size=11, bold=True, colour=(255,255,255))
    vp = vc.paragraphs[0]; vp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    vr = vp.add_run(val);  set_font(vr, size=11)
pb()

# ── ABSTRACT ────────────────────────────────────────────────────────────────
heading("ABSTRACT", size=14, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, sb=0, sa=8)
body("This preliminary WRL report covers work done by Munyaradzi Namailinga (R243100H), a Level 3.1 Computer Science student at Midlands State University, during an industrial attachment at the MSU Research and Innovation Hub. The placement involves building a GIS-based Municipal Planning Information System for Vungu Rural District Council and covers the period 23 February 2026 to the date of this report.")
body("The system is a full-stack web application that digitises the complete development permit lifecycle as set out in the Zimbabwe Development Management (Control) Handbook 2021. It covers nineteen administrative wards in the Vungu RDC area and supports five user roles: public access, applicants, planning officers, senior planners, and administrators. The backend runs on Node.js v22 with Fastify, the database is PostgreSQL 16 with the PostGIS 3.4 spatial extension, map tiles are served through QGIS Server using OGC WMS and WFS standards, Nginx handles the reverse proxy and HTTPS, and the frontend uses Leaflet.js.")
body("Work in the first phase, from February through mid-April 2026, included project orientation, a full security audit of the prototype codebase that cleared ten CVEs to zero, production server setup on Ubuntu 24.04 LTS, spatial database schema design with GiST indexing, REST API development, JWT authentication using bcrypt, Docker containerisation, an integration test suite, HTTPS setup, a site visit to Vungu RDC, and a formal system demonstration that was approved by the client.")
body("The second phase, from mid-April 2026 onward, focused on research and database documentation. This included a detailed study of the Zimbabwe Development Management (Control) Handbook 2021, a gap analysis of the v1.1 database schema that identified fifteen missing tables, production of schema refinement document v1.2 with full DDL and an implementation workflow, a Third Normal Form verification report (v1.2.1) for all fifteen new tables, normalisation of the Development Control Matrix from unnormalised form to 3NF, data dictionaries for both the full geodatabase and the DCM tables, and two research papers on SQL vs NoSQL databases for GIS systems and on document verification for a municipal planning system.")
body("Keywords: Work-Related Learning, GIS, PostGIS, Vungu RDC, Municipal Planning, Database Normalisation, Third Normal Form, REST API, Docker, QGIS Server, Zimbabwe.", italic=True)
pb()

# ── ACKNOWLEDGEMENTS ────────────────────────────────────────────────────────
heading("ACKNOWLEDGEMENTS", size=14, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, sb=0, sa=8)
body("The completion of this placement and the preparation of this report would not have been possible without the help and guidance of a number of people.")
body("I owe a great deal to Dr Paradzayi, Project Manager for the Vungu RDC GIS project, for the clear direction and consistently high standards he maintained throughout the placement. He pushed for correctness in both the technical work and the research documentation, which made every deliverable better than it would otherwise have been. His willingness to engage with questions at any stage, including reviewing schema designs and normalisation arguments in detail, was genuinely valuable.")
body("I am grateful to Rafiq, the project research assistant, for setting research deliverables with clear acceptance criteria and for reviewing the submitted documents thoroughly. The quality of the normalisation reports and research papers produced during this placement is largely a result of the standards he set.")
body("Thanks also go to the planning officers and staff at Vungu RDC for their time during the site visit and the system demonstration. The operational details they shared about how ward-based application management actually works in practice shaped both the system design and the schema work that followed.")
body("I also want to thank Theophelos for solid collaboration on the frontend side throughout the placement. Having clear role boundaries and a reliable teammate made the development work significantly more manageable.")
body("Finally, I am grateful to the Department of Computer Science at MSU for the academic grounding in databases, security, web systems, and networking that made it possible to contribute meaningfully from the first week of the placement.")
pb()

# ── TABLE OF CONTENTS ────────────────────────────────────────────────────────
heading("TABLE OF CONTENTS", size=14, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, sb=0, sa=8)
toc = [
    ("Abstract","ii"),("Acknowledgements","iii"),("Table of Contents","iv"),
    ("List of Abbreviations","v"),
    ("CHAPTER 1: INTRODUCTION",""),
    ("   1.1  Background","1"),("   1.2  Purpose of the Placement","2"),
    ("   1.3  Objectives of the Placement","2"),("   1.4  Scope of Work","3"),
    ("   1.5  Significance of the Work","3"),
    ("CHAPTER 2: DESCRIPTION OF THE WRL ORGANISATION",""),
    ("   2.1  Overview of Midlands State University","5"),
    ("   2.2  The MSU Research and Innovation Hub","6"),
    ("   2.3  The Vungu RDC GIS Project","7"),
    ("   2.4  Organisational Structure","8"),
    ("         2.4.1  MSU Faculty and Innovation Hub Structure","8"),
    ("         2.4.2  Vungu RDC Organisational Structure","9"),
    ("         2.4.3  Project Team Structure","10"),
    ("CHAPTER 3: WORK PLAN",""),
    ("   3.1  Planned Activities","11"),("   3.2  Links to Programme of Study","13"),
    ("CHAPTER 4: WORK ACCOMPLISHED",""),
    ("   4.1  System Analysis and Prototype Security Review","15"),
    ("   4.2  Infrastructure Provisioning and Backend Development","17"),
    ("   4.3  Testing, Deployment, and System Demonstration","20"),
    ("   4.4  Development Management Handbook Study and Schema Gap Analysis","22"),
    ("   4.5  Schema Refinement v1.2: Fifteen New Tables","25"),
    ("   4.6  Third Normal Form Verification Report (v1.2.1)","29"),
    ("   4.7  Development Control Matrix Normalisation","31"),
    ("   4.8  Data Dictionaries","34"),("   4.9  Research Papers","35"),
    ("CHAPTER 5: SUMMARY, CONCLUSIONS, AND RECOMMENDATIONS",""),
    ("   5.1  Summary of Activities Carried Out","38"),
    ("   5.2  Problems Encountered and Lessons Learned","40"),
    ("   5.3  Conclusions","42"),("   5.4  Recommendations","43"),
    ("References","45"),
]
for entry, page in toc:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after  = Pt(1)
    bold = entry.startswith("CHAPTER") or entry in ("Abstract","Acknowledgements","Table of Contents","List of Abbreviations","References")
    r = p.add_run(entry); set_font(r, size=11, bold=bold)
    if page:
        tab = p.add_run(f"\t{page}"); set_font(tab, size=11, bold=bold)
        p.paragraph_format.tab_stops.add_tab_stop(Inches(5.5), 2)
pb()

# ── LIST OF ABBREVIATIONS ────────────────────────────────────────────────────
heading("LIST OF ABBREVIATIONS", size=14, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, sb=0, sa=8)
abbrevs = [
    ("1NF","First Normal Form"),("2NF","Second Normal Form"),("3NF","Third Normal Form"),
    ("API","Application Programming Interface"),("COO","Certificate of Occupation"),
    ("CVE","Common Vulnerabilities and Exposures"),("DCM","Development Control Matrix"),
    ("DDL","Data Definition Language"),("EHO","Environmental Health Officer"),
    ("EWSDA","Enterprise-Wide Spatial Data Architecture"),
    ("FST","Faculty of Science and Technology"),
    ("GeoJSON","Geographic JavaScript Object Notation (RFC 7946)"),
    ("GIS","Geographic Information System"),
    ("GiST","Generalised Search Tree (PostgreSQL spatial index type)"),
    ("HTTP","Hypertext Transfer Protocol"),("HTTPS","Hypertext Transfer Protocol Secure"),
    ("JWT","JSON Web Token"),("LPA","Local Planning Authority"),
    ("MSU","Midlands State University"),("Nginx","Engine-X (web server and reverse proxy)"),
    ("OCR","Optical Character Recognition"),
    ("OGC","Open Geospatial Consortium"),("OWASP","Open Web Application Security Project"),
    ("PM2","Process Manager 2"),("PostGIS","Spatial database extension for PostgreSQL"),
    ("RDC","Rural District Council"),("REST","Representational State Transfer"),
    ("SFS","Simple Features for SQL (OGC standard)"),("SQL","Structured Query Language"),
    ("SRID","Spatial Reference Identifier"),("SSH","Secure Shell"),("SSL","Secure Sockets Layer"),
    ("TLS","Transport Layer Security"),("TPD","Town Planning Development (form reference)"),
    ("UNF","Un-Normalised Form"),("VCC","Value Creation Challenge"),
    ("WFS","Web Feature Service"),("WKB","Well-Known Binary"),("WKT","Well-Known Text"),
    ("WMS","Web Map Service"),("WRL","Work-Related Learning"),
    ("ZITF","Zimbabwe International Trade Fair"),
]
add_table(["Abbreviation","Meaning"], abbrevs, col_widths=[3.5,11.5])
pb()

# ── CHAPTER 1 ────────────────────────────────────────────────────────────────
heading("CHAPTER 1: INTRODUCTION", size=15, bold=True, colour=(31,56,100), sb=0, sa=6)

sec("1.1","Background")
body("Work-Related Learning at Midlands State University places Computer Science students in real engineering environments for a full semester each year. The idea is straightforward: the theoretical foundations of databases, algorithms, security, and systems architecture only make complete sense once you have applied them to software that real clients depend on. The WRL programme is also central to the Education 5.0 philosophy that MSU operates under, which requires universities to contribute directly to Zimbabwe's industrialisation and innovation agenda rather than limiting themselves to teaching and research.")
body("This report covers the author's placement at the MSU Research and Innovation Hub, where the work involved building a GIS-based Municipal Planning Information System commissioned by Vungu Rural District Council. Vungu RDC is a local authority in the Midlands Province responsible for land administration and development permit management across nineteen administrative wards. Before this project, the council was running the entire development permit process on paper, with manual registers and informal spreadsheets. That meant backlogs, no real-time visibility for applicants, and no practical way to check spatial compliance without pulling out physical maps.")
body("The system being built digitises the full permit lifecycle as defined by the Zimbabwe Development Management (Control) Handbook 2021, a statutory document from the Ministry of Local Government and Public Works that sets out exactly how local planning authorities must manage development applications, enforce against illegal construction, appraise building plans, conduct stage inspections, and issue certificates of occupation. Every procedure and annexure in the Handbook maps to a database table, an API endpoint, and a screen in the application.")
body("The technical core of the system is PostgreSQL 16 with PostGIS 3.4, which enables geographic geometry to be stored and queried directly in the database. Ward boundaries, land parcels, and zone polygons all live as typed geometry columns, so the system can validate whether an applicant's declared plot actually sits within the ward they have specified before any officer review begins. That kind of spatial check is simply not practical in a paper-based system.")

sec("1.2","Purpose of the Placement")
body("The placement serves three purposes that reinforce each other. The academic purpose is to satisfy the WRL requirement for the BSc Honours in Computer Science at MSU, giving the student a structured opportunity to apply three years of coursework to a live engineering project under professional supervision.")
body("The professional purpose is to develop the skills that a practising software engineer and spatial database designer actually needs: writing production-quality backend code, formally verifying relational schemas, conducting and remediating security audits, provisioning and hardening Linux servers, and producing technical documentation that other developers can work from.")
body("The practical purpose is to deliver a working system and supporting documentation to Vungu RDC, a local authority that currently has no digital planning management tool. The project generates real institutional value for the council while meeting the student's academic and professional development objectives, which is exactly what the Education 5.0 framework is designed to achieve.")

sec("1.3","Objectives of the Placement")
body("The specific objectives for this placement are:")
numbered("Apply software engineering and database design skills from academic training to build a production-grade geographic information system.")
numbered("Gain hands-on experience with PostGIS spatial database design, including geometry storage, GiST spatial indexing, SRID enforcement, and OGC spatial query predicates.")
numbered("Conduct a formal security audit of an existing codebase, document all findings against recognised standards, and remediate everything before production deployment.")
numbered("Develop a thorough understanding of the Zimbabwe Development Management (Control) Handbook 2021 and map each statutory procedure and annexure to the data model.")
numbered("Apply formal normalisation techniques (1NF through 3NF) to real planning data structures and produce verified, fully documented database schemas with complete DDL.")
numbered("Design, implement, and document a RESTful API using Fastify and Node.js, with schema-validated request handling and JWT-based authentication.")
numbered("Produce research documents and comparative papers of professional quality that add to the project team's knowledge base.")
numbered("Identify the gaps between academic knowledge and professional practice, and reflect on how those gaps were addressed during the placement.")
doc.add_paragraph()

sec("1.4","Scope of Work")
body("The scope covers all software engineering, spatial database design, and technical research work done between 23 February 2026 and the date of this report. The work is limited to the backend and database tiers; frontend development is handled by a separate team member.")
body("In scope: backend API development in Node.js with Fastify; PostgreSQL and PostGIS schema design, DDL authoring, and formal 3NF verification; server provisioning, hardening, and Docker containerisation; security audit and remediation; systematic study of the Zimbabwe Development Management (Control) Handbook 2021 and translation of its requirements into a database schema; production of schema refinement, normalisation, data dictionary, and research documents; and HTTPS implementation with API integration testing.")
body("Out of scope: frontend development (owned by Theophelos); Vungu RDC internal network infrastructure; procurement and licensing of third-party software; and any system module not yet assigned to the current phase.")

sec("1.5","Significance of the Work")
body("The significance of this work operates on three levels. At the national level, most rural district councils in Zimbabwe still run development permit processes on paper. This creates backlogs, limits transparency for applicants, and makes land-use compliance checking slow and unreliable. The system being developed shows that an open-source spatial database and web stack can handle the full permit lifecycle at a cost that rural councils can realistically afford. If the approach is adopted more widely, it could modernise development management across Zimbabwe's RDC tier.")
body("At the institutional level, the project gives the MSU Research and Innovation Hub a deployable, well-documented system that can serve as a reference implementation for future GIS engagements. The schema documentation, normalisation reports, and data dictionaries produced here give future developers a solid technical baseline to build on without risking data anomalies.")
body("At the academic level, the placement offered the chance to work across every technical layer of a real system at the same time: writing backend code, designing and verifying database schemas, reading statutory documents to understand data requirements, and producing research papers for a supervisor audience. That breadth made it an unusually rich learning experience.")
pb()

# ── CHAPTER 2 ────────────────────────────────────────────────────────────────
heading("CHAPTER 2: DESCRIPTION OF THE WRL ORGANISATION", size=15, bold=True, colour=(31,56,100), sb=0, sa=6)

sec("2.1","Overview of Midlands State University")
body("Midlands State University was established by an Act of Parliament in 1999 and is located in Gweru, Midlands Province, Zimbabwe. It is one of ten state universities in the country and the largest by student enrolment, with around 20,000 students across undergraduate, postgraduate, and research programmes. The university runs fourteen faculties covering the natural sciences, humanities, social sciences, law, commerce, education, and technology disciplines.")
body("MSU operates under the Education 5.0 framework, which extends the standard university mandate of teaching, research, and community service by adding innovation and industrialisation as core institutional obligations. In practice, this means every academic activity is expected to contribute something tangible to Zimbabwe's productive economy. Work-Related Learning is the most visible expression of this at the undergraduate level, placing students in productive organisations for a full semester each year.")
body("The Faculty of Science and Technology (FST), which houses the Department of Computer Science, is among the most active faculties in pursuing the Education 5.0 mandate. FST departments run the majority of digital innovation projects hosted at the MSU Research and Innovation Hub, and Computer Science students regularly work on system development engagements with local government, the health sector, and commercial organisations during their WRL placements.")

sec("2.2","The MSU Research and Innovation Hub")
body("The MSU Research and Innovation Hub is on the Senga Road campus in Gweru. It serves as the university's main applied research and technology incubation facility, providing computing infrastructure, laboratory space, mentorship, project management support, and access to seed-funding pathways for student innovators, academic researchers, and early-stage technology companies.")
body("The Hub runs a portfolio of concurrent projects covering geographic information systems, health information systems, agricultural technology, and enterprise software development. Each project is assigned a faculty supervisor who acts as project manager, and students are placed on specific projects based on their programme and the technical requirements of the engagement. Students at the Hub are expected to work as professional team members and are held to the same standards of quality, completeness, and delivery that would apply in an industry setting.")
body("The Hub also coordinates the MSU Value Creation Challenge, an annual innovation competition encouraging students to build commercially viable solutions to community problems, and it supports students and staff participating in national events like the ZITF Innovation Hackathon.")

sec("2.3","The Vungu RDC GIS Project")
body("Vungu Rural District Council is a local authority in the Midlands Province, with its administrative offices in Gweru. The council is responsible for nineteen administrative wards covering rural, peri-urban, and small commercial areas within its planning boundary. Its core functions include land administration, development permit management, spatial planning, infrastructure maintenance, and public health regulation.")
body("The Vungu RDC GIS project is a formal system development engagement between MSU's Faculty of Built Environment and Vungu RDC, run through the Innovation Hub. The brief requires a web-based, spatially enabled planning management system that allows the council to register and track development permit applications online, check zone compliance using PostGIS ward and zone geometry, manage building plan appraisal and multi-stage construction inspections as defined in the Handbook, and issue certificates of occupation as terminal records in the geodatabase.")
body("Five user roles are supported. Public users can browse the ward map and zone information without logging in. Applicants can register, submit permit applications, upload supporting documents, and track their application status. Planning officers process applications, record inspection results, and generate permit or refusal documents. Senior planners review escalated cases and manage public notification periods. Administrators manage system configuration, user accounts, and the development control matrix.")
body("At the start of this placement, a version 1.0 prototype existed but had not been security-reviewed or deployed to a production server. The geodatabase schema was at version 1.1, covering only the core permit application record and a basic inspection record, with no formal verification against the Handbook requirements and no 3NF analysis.")

sec("2.4","Organisational Structure")
body("The sections below present the three organisational structures relevant to this placement: the MSU faculty and Innovation Hub hierarchy, the Vungu RDC departmental structure, and the project team.")

sub("2.4.1","MSU Faculty and Innovation Hub Structure")
body("The table below shows the relationship between MSU institutional leadership, the Faculty of Science and Technology, the Department of Computer Science, and the Research and Innovation Hub.")
add_table(
    ["Level","Position / Unit","Role in WRL Context"],
    [
        ["University","Vice Chancellor","Overall institutional leadership; Education 5.0 mandate"],
        ["University","Pro Vice Chancellor: Academic Affairs","Academic oversight of WRL programme"],
        ["University","Director: Research and Innovation","Oversight of all Hub projects; approves industry engagements"],
        ["Faculty","Dean: Faculty of Science and Technology","Faculty academic authority; approves WRL placements within FST"],
        ["Faculty","Dean: Faculty of Built Environment","Co-supervising faculty for the Vungu RDC GIS engagement"],
        ["Department","Chairperson: Department of Computer Science","Departmental coordination; WRL compliance and student welfare"],
        ["Hub","Manager: MSU Research and Innovation Hub","Hub operations, resource allocation, project portfolio"],
        ["Project","Dr Paradzayi, Project Manager","Direct academic supervisor; technical direction; quality assurance"],
        ["Project","Rafiq, Research Assistant","Research brief setting; documentation review; Vungu RDC liaison"],
        ["Project","Munyaradzi Namailinga, Backend Developer","API development, database design, security, research papers"],
        ["Project","Theophelos, Frontend Developer","Browser-side UI, Leaflet.js map integration"],
    ],
    col_widths=[3.0, 6.5, 5.5]
)

sub("2.4.2","Vungu RDC Organisational Structure")
body("The table below shows the Vungu RDC structure relevant to the GIS project, including the client stakeholders who participated in the site visit and system demonstration.")
add_table(
    ["Tier","Post / Unit","Relevance to GIS Project"],
    [
        ["Council","Vungu RDC Full Council","Governance body; policy approval for digital systems"],
        ["Executive","Chief Executive Officer","Strategic approval for GIS deployment and budget"],
        ["Executive","Director of Technical Services","Oversees planning, engineering, and environmental functions"],
        ["Management","Head: Department of Planning","Primary client contact; system requirements authority"],
        ["Management","Head: GIS and Mapping Unit","Geodata custodian; spatial data provision and verification"],
        ["Operations","Senior Planning Officer","Participated in demonstration; provided ward-level requirements"],
        ["Operations","Planning Officer (Permit Processing)","End user of permit application and inspection modules"],
        ["Operations","Environmental Health Officer","End user of compliance checking module"],
        ["Operations","Administrative Clerk","End user of document upload and verification module"],
    ],
    col_widths=[3.0, 6.0, 6.0]
)

sub("2.4.3","Project Team Structure")
body("The project team operates as a flat, task-based structure within the Innovation Hub. The table below shows roles, responsibilities, and reporting lines.")
add_table(
    ["Role","Person","Responsibilities","Reporting / Communication"],
    [
        ["Project Manager","Dr Paradzayi","Technical direction, quality assurance, client liaison, weekly reviews","Reports to Hub Manager and Dean (Built Environment)"],
        ["Research Assistant","Rafiq","Research brief setting, documentation review, stakeholder coordination","Reports to Dr Paradzayi; liaises with Planning Department directly"],
        ["Backend Developer","Munyaradzi Namailinga","API development, database design, security, Docker, research papers, testing","Reports to Dr Paradzayi; daily coordination with Theophelos"],
        ["Frontend Developer","Theophelos","Leaflet.js map UI, application forms, officer dashboard, report views","Reports to Dr Paradzayi; API integration with Munyaradzi"],
        ["Client Representative","Head of Planning, Vungu RDC","Requirements sign-off, system acceptance, operational feedback","Engages through Dr Paradzayi and Rafiq; attends demonstrations"],
    ],
    col_widths=[3.5, 3.5, 5.5, 4.5]
)
pb()

# ── CHAPTER 3 ────────────────────────────────────────────────────────────────
heading("CHAPTER 3: WORK PLAN", size=15, bold=True, colour=(31,56,100), sb=0, sa=6)

sec("3.1","Planned Activities")
body("A phased work plan was agreed with the supervisor at the start of the placement. The phases were ordered to respect logical dependencies: security remediation before new feature development, server provisioning before deployment testing, Handbook study before schema gap analysis, and gap analysis before the schema refinement document. The table below covers all ten phases in this report.")
add_table(
    ["Phase","Period","Objectives","Deliverables"],
    [
        ["1 - Orientation and Code Review","Week 1, Feb 2026","Understand project scope; review prototype codebase; identify security defects; research GIS stack","Security defect report; GIS research notes; development environment set up"],
        ["2 - Server Setup and Research","Weeks 1-2, Mar 2026","Provision Ubuntu 24.04 LTS; install full stack; set up Git repository; research PostGIS and GeoJSON","Provisioned server; installed Node.js, PostgreSQL/PostGIS, QGIS Server, Nginx; repository initialised"],
        ["3 - Security Hardening","Week 3, Mar 2026","Remediate all identified CVEs; rebuild authentication; remove hardcoded credentials; rewrite input sanitiser; site visit","10 CVEs cleared; bcrypt/JWT auth; Git history rewrite; site visit findings report"],
        ["4 - API and Documentation","Week 4, Mar 2026","Refine all API routes; implement Docker containerisation; produce backend architecture documentation","Full API route map; Docker compose file; BACKEND_GUIDE.md; Mermaid architecture diagrams"],
        ["5 - Deployment and Testing","Weeks 1-2, Apr 2026","Deploy to production; write integration tests; implement HTTPS; ZITF hackathon; demonstrate to client","Production deployment; Jest/Supertest test suite; HTTPS via Let's Encrypt; demonstration approved"],
        ["6 - Handbook Study and Gap Analysis","Week 3, Apr 2026","Read and map the Zimbabwe Dev. Mgmt. Handbook 2021; compare to v1.1 schema; identify all gaps","Handbook section analysis; gap analysis table; 15 missing tables, 7 missing columns identified"],
        ["7 - Schema Refinement v1.2","Week 4, Apr 2026","Design 15 new tables; write full DDL; produce implementation workflow; submit schema refinement document","Schema Refinement Document v1.2 with column specs, DDL, and phase-by-phase implementation workflow"],
        ["8 - 3NF Verification and DCM Normalisation","Week 5, Apr/May 2026","Formally verify all 15 new tables to 3NF; normalise DCM from UNF to 3NF","3NF Verification Report v1.2.1; DCM Normalisation Report with 5 normalised relations"],
        ["9 - DCM Data Dictionary and SQL/NoSQL Research","Week 1, May 2026","Document all DCM tables; complete SQL vs NoSQL research paper","DCM Data Dictionary v1.0; SQL vs NoSQL GIS Research Paper"],
        ["10 - Document Verification Research (ongoing)","Week 2+, May 2026","Research document verification methods; compare manual and automated approaches; cover Zimbabwe DPA 2021","Document Verification and Storage Research Paper (ongoing at report date)"],
    ],
    col_widths=[4.0, 2.5, 5.0, 5.0]
)
body("Weekly progress was reviewed in virtual meetings with Dr Paradzayi. Where tasks were delayed, for example the server provisioning credential delay in early March, the schedule was adjusted by prioritising research and documentation work that could proceed without server access, without disrupting the overall delivery timeline.")

sub("3.1.1","Risk Register")
body("The table below documents the main risks identified at the start of the placement, their likelihood and impact, and the mitigations applied.")
add_table(
    ["Risk","Likelihood","Impact","Mitigation"],
    [
        ["Prototype codebase contains security vulnerabilities","High","High","Formal OWASP-based security audit in Phase 1 before any new development proceeds"],
        ["Server provisioning credentials delayed","Medium","Medium","Use waiting period for research; buffer weeks built into schedule"],
        ["Handbook statutory language is ambiguous for schema translation","Medium","High","Multiple reading passes; cross-reference all annexures; verify with supervisor"],
        ["Git history rewrite disrupts team after credential removal","Low","High","Coordinate with all team members before rewrite; rotate password immediately after"],
        ["PostGIS and spatial indexing are unfamiliar domain","High","Medium","Dedicated research sprint in Phases 1 and 2 before any schema design begins"],
        ["Scope creep from Vungu RDC officer requests after demonstration","Medium","Low","Log all requests; prioritise through supervisor; defer non-critical items to next sprint"],
    ],
    col_widths=[5.0, 2.0, 2.0, 6.0]
)

sec("3.2","Links to Programme of Study")
body("The placement work connects directly to multiple taught modules in the BSc Honours Computer Science programme at MSU. The table below maps each major area of work to the relevant module and the specific skills applied.")
add_table(
    ["Placement Activity","Academic Module","Skills Applied"],
    [
        ["Security audit, CVE remediation, bcrypt/JWT authentication, input sanitisation","Software Security","OWASP vulnerability classification; password hashing and key derivation; input validation; secure HTTP headers"],
        ["PostGIS schema design, 3NF verification, DCM normalisation, data dictionaries","Advanced Databases","Relational theory; functional dependency analysis; normalisation; DDL authoring; spatial data types"],
        ["Fastify REST API design, route structuring, request/response schema validation","Web Systems and Internet Programming","REST architectural constraints; HTTP method semantics; JSON schema validation; middleware patterns"],
        ["Docker containerisation, Nginx reverse proxy, PM2 process supervision","Distributed Computing and Cloud Systems","Container orchestration; service health checks; reverse proxy configuration; process management"],
        ["Ubuntu 24.04 LTS provisioning, SSH hardening, UFW firewall configuration","Computer Networks and Operating Systems","Linux administration; network security; SSH key management; UFW rules"],
        ["OGC WMS/WFS study, QGIS Server integration, Leaflet.js map consumption","Geographic Information Systems (elective)","OGC service standards; spatial reference systems; map tile protocols; GeoJSON RFC 7946"],
        ["SQL vs NoSQL research paper; Document Verification research paper","Technical Writing and Research Methods","Comparative research methodology; academic citation; structured technical argument"],
        ["Handbook study, gap analysis, schema refinement documentation","Systems Analysis and Design","Requirements elicitation from statutory documents; gap analysis; data modelling; specification writing"],
        ["API integration testing with Jest and Supertest","Software Engineering","Integration test design; assertion strategy; test-driven development; CI test suite organisation"],
    ],
    col_widths=[5.0, 4.0, 6.0]
)
pb()

# ── CHAPTER 4 ────────────────────────────────────────────────────────────────
heading("CHAPTER 4: WORK ACCOMPLISHED", size=15, bold=True, colour=(31,56,100), sb=0, sa=6)
body("This chapter provides a detailed account of all work done during the placement, organised by phase. Each section describes the context, the methods used, the tools and technologies involved, and the deliverables produced.")

sec("4.1","System Analysis and Prototype Security Review")
body("The placement began with a formal project orientation with Dr Paradzayi, covering the project brief, the current system state, the client relationship with Vungu RDC, and the technical objectives for the placement period. The first substantive task was a security review of the existing prototype codebase.")
body("The review was done by checking the codebase systematically against the OWASP Top Ten 2021 vulnerability categories. Three distinct categories of security defect were found, each serious enough to require full remediation before any new development could proceed.")
body("The first category was authentication and credential security. Passwords were being stored using a plaintext prefix concatenated with the user's input rather than any cryptographic hash function. Anyone with read access to the database could recover all passwords immediately. On top of that, the database connection credentials were hardcoded as string literals in the main application source file and committed to the Git repository, meaning anyone with access to the repository history had permanent access to the database regardless of whether the strings were later removed from the working tree.")
body("The second category was missing input validation. Several API routes accepted user-supplied strings with no sanitisation or schema validation, creating exposure to SQL injection and cross-site scripting.")
body("The third category was dependency vulnerabilities. A package audit found ten known CVEs across the dependency tree, including one of high severity in a library directly used by the API.")
body("All findings were documented in a structured security defect report, classified by OWASP category and severity, and reviewed with Dr Paradzayi before remediation began.")
add_table(
    ["Vulnerability","OWASP Category","Severity","Remediation Applied"],
    [
        ["Plaintext password storage","A02: Cryptographic Failures","Critical","Rebuilt with bcrypt at cost factor 12; all existing passwords force-reset"],
        ["Hardcoded database credentials","A02: Cryptographic Failures","High","Credentials moved to .env; .env added to .gitignore; Git history rewritten; password rotated"],
        ["Missing input validation on public routes","A03: Injection","High","Fastify JSON Schema validation added to all routes; input sanitiser rewritten"],
        ["10 CVEs in dependency tree","A06: Vulnerable Components","Mixed","npm audit fix applied; two packages replaced; 0 CVEs remaining after remediation"],
        ["No application audit trail","A09: Security Logging Failures","Medium","application_status_history table added; every status change logged with officer ID and timestamp"],
        ["Root login enabled on SSH","A05: Security Misconfiguration","High","PermitRootLogin disabled; key-based authentication enforced; MaxAuthTries set to 3"],
    ],
    col_widths=[4.0, 4.0, 2.0, 5.0]
)
body("Week 1 was also used for GIS technology research. PostGIS and its spatial data model were entirely new at the start of the placement. The key conceptual shift was understanding that geographic shapes can be stored as typed geometry columns in a relational database, indexed with a GiST spatial index for efficient bounding-box queries, and queried using spatial predicates like ST_Within and ST_Intersects. WMS and WFS were studied as the OGC standards governing how QGIS Server delivers map tiles and vector feature data. The RFC 7946 GeoJSON specification was read in full as the wire format for all spatial data exchanged between the API and the frontend.")

sec("4.2","Infrastructure Provisioning and Backend Development")
body("After the security review, the production server was provisioned: an Ubuntu 24.04 LTS virtual machine. SSH hardening was applied on first login: password authentication was replaced with RSA key-based authentication, root login was disabled, MaxAuthTries was set to 3, and UFW was configured to permit only ports 22, 80, and 443, blocking everything else by default.")
add_table(
    ["Component","Version","Role in System","Configuration Notes"],
    [
        ["Node.js","22 LTS","Backend API runtime","PM2 process manager; auto-restart on crash and server reboot"],
        ["Fastify","4.x","HTTP framework; schema validation; routing","JSON Schema validation applied to all request bodies and query parameters"],
        ["PostgreSQL","16","Relational database engine","Dedicated app user with minimum required privileges; no superuser access from application"],
        ["PostGIS","3.4","Spatial extension; geometry storage and queries","SRID 4326 (WGS 84) on all geometry columns; GiST indexes for all spatial columns"],
        ["QGIS Server","3.x","OGC WMS and WFS service endpoint","Served through Nginx location block; project file references PostGIS layers"],
        ["Nginx","1.24","Reverse proxy; HTTPS termination; static files","SSL termination; proxy_pass to Node.js; separate location for QGIS WMS/WFS"],
        ["Docker","26.x","Containerisation of all three services","Three-service compose: db, api, qgis-server; health check ordering enforced"],
        ["Certbot / ACME","Latest","TLS certificate provisioning","Let's Encrypt certificates; auto-renewal cron job configured"],
        ["Jest + Supertest","Latest","API integration test suite","Tests all route groups; asserts HTTP status codes and response schemas"],
    ],
    col_widths=[2.5, 1.5, 5.0, 6.0]
)
body("The security hardening sprint in Week 3 of March addressed all identified vulnerabilities. Authentication was rebuilt from scratch using bcrypt at cost factor 12 for password hashing. Cost factor 12 produces roughly 300 milliseconds per hash operation, which is by design: it makes offline brute-force attacks computationally impractical while being invisible to legitimate users. JWTs were implemented for stateless session management, signed with a 256-bit secret loaded from the environment file and verified on every protected route through a Fastify authentication plugin.")
body("Hardcoded credentials were removed from the source tree and the .env file was added to .gitignore. The Git history was then rewritten to purge the commit that had contained the hardcoded credentials. The database password was rotated immediately after, and all team members were notified and required to re-clone the repository because the history rewrite changes the hash of every subsequent commit.")
body("The input sanitiser was rewritten to use Fastify's built-in JSON Schema validation on every route, targeting specific attack patterns like SQL injection sequences and script injection rather than the original approach of blocking broad character classes that would have rejected legitimate planning data such as hyphens in applicant names or forward slashes in address fields.")
body("Docker containerisation was set up as a three-service compose configuration covering PostgreSQL/PostGIS, the Node.js API, and QGIS Server. Health check ordering was implemented so the API container waits for a successful pg_isready probe from the database before the Node.js process attempts its first connection. This prevents startup errors on fresh deployments where the database takes a few seconds to initialise.")
body("Comprehensive backend architecture documentation was produced, including a BACKEND_GUIDE.md file with a full API route inventory, database schema reference, environment variable specification, deployment checklist, and Mermaid diagrams for system architecture and database entity relationships. An application_status_history table was added to the schema to create a tamper-evident audit trail: every status change on a permit application is recorded with the officer's user ID, the old and new status values, an optional note, and a server-side timestamp.")

sec("4.3","Testing, Deployment, and System Demonstration")
body("A structured site visit to the Vungu RDC Department of Planning was conducted in Week 3 of March. Three things came out of it: a detailed understanding of the current paper-based workflow to validate the system's user journey design; several requirements not captured in the written project brief; and a working relationship with the planning officers who would be the primary users.")
body("The interviews with officers produced findings that materially affected the design. The nineteen-ward hierarchy turned out to be the fundamental organising principle of all council planning data. Every application, inspection, enforcement order, and certificate of occupation is recorded against a specific ward, but this was not mentioned anywhere in the written brief. Officers also asked for a ward-level application statistics endpoint to give them visibility of backlog by ward. Additionally, they confirmed that three document types need to be submitted with every application: identity documents, title deeds, and previous planning approvals, each of which needs to be uploaded, stored, and verified by a clerk.")
add_table(
    ["User Journey","Functionality Demonstrated","Outcome"],
    [
        ["Public map browsing","Ward boundary layer; land-use zone overlay; parcel search by plot number","Demonstrated successfully; officers noted the map load speed"],
        ["Application submission","Applicant registration; form submission; document upload; status tracking portal","Demonstrated successfully; applicant receives email reference number on submission"],
        ["Planning officer review","Application queue by ward; document viewer; spatial compliance check display","Demonstrated successfully; ward-filter query performance confirmed acceptable"],
        ["Senior planner sign-off","Escalated case review; permit/refusal document generation","Demonstrated successfully; PDF permit document generated correctly"],
        ["Administrative reporting","Monthly application statistics; ward backlog heatmap; export to CSV","Demonstrated successfully; officers requested additional filter by land use type"],
    ],
    col_widths=[3.5, 7.0, 4.5]
)
body("The API integration test suite was written using Jest and Supertest. Integration tests fire real HTTP requests against a running server connected to a real database, testing the complete middleware chain rather than individual functions in isolation. The suite covered authentication flows, permit application CRUD operations, ward-level statistics, spatial compliance checking, and error handling for invalid inputs. Forty-seven test cases were written and all forty-seven passed at the time of the demonstration.")
body("HTTPS was set up using Certbot and a Let's Encrypt certificate, with auto-renewal configured through a systemd timer. Nginx was updated to redirect all HTTP traffic to HTTPS, and the HSTS header was set to enforce secure connections on subsequent visits. The system was also entered in the ZITF 2026 Innovation Hackathon alongside other MSU Innovation Hub projects.")

sec("4.4","Development Management Handbook Study and Schema Gap Analysis")
body("From Week 3 of April the placement shifted to research and database documentation work. The Zimbabwe Development Management (Control) Handbook 2021 was studied in detail over approximately one week. The Handbook is a statutory instrument from the Ministry of Local Government and Public Works that prescribes exactly how local planning authorities must manage every aspect of development management within their jurisdiction. It covers five lifecycle phases, each supported by numbered statutory annexures that define the specific forms, checklists, and documents required at each stage.")
add_table(
    ["Phase","Handbook Reference","Key Data Requirements Identified"],
    [
        ["Development Permit Application (8-step process)","Section 2; Annexures 1-10","Applicant details; site location (parcel geometry); land-use category; application type; One-Stop-Shop consultation record; public notification period; objections and representations; planning officer recommendation; appeal to Administrative Court; permit or refusal document"],
        ["Enforcement against illegal development","Sections 3.3-3.4","Enforcement order issuance; description of offending development; remediation timeline; prohibition order for non-compliant structures; enforcement officer identity; legal authority reference"],
        ["Building Plan Appraisal","Sections 4.x; Annexure 11","Building plan submission; five mandatory drawing types (site plan, floor plan, elevations, sections, services layout); appraisal checklist items per drawing type; appraisal officer recommendation"],
        ["Stage Construction Inspections","Annexures 12, 14","Nine sequential inspection stages; inspection items per stage; pass/fail/partial result per item; inspector identity and date"],
        ["Certificate of Occupation","Section 5.9; Annexure 13","Final inspection clearance; COO reference number; issuing officer; expiry date; link to all prior inspection records; PDF document generation and storage"],
    ],
    col_widths=[4.0, 3.5, 7.5]
)
body("The gap analysis compared the v1.1 schema against the full set of Handbook requirements. The v1.1 schema had only two tables covering the development management lifecycle: permit_application and a single undifferentiated inspection record. The analysis found fifteen missing tables and seven missing columns on the existing permit_application table.")
add_table(
    ["Missing Component","Handbook Basis","Gap Severity"],
    [
        ["application_consultation table","Section 2 / OSS step","Critical - OSS step is mandatory"],
        ["application_objection table","Public Notification period","High - objections are legally binding records"],
        ["application_appeal table","Administrative Court appeals","High - appeal record required by statute"],
        ["enforcement_order table","Section 3.3","High - enforcement is a core planning function"],
        ["prohibition_order table","Section 3.4","High - separate legal instrument from enforcement order"],
        ["building_plan table","Annexure 11","Critical - building plan approval precedes all inspections"],
        ["plan_drawing table","Annexure 11 (5 drawing types)","Critical - each drawing type is appraised separately"],
        ["plan_appraisal table","Annexure 11","Critical - appraisal record links plan to officer recommendation"],
        ["plan_appraisal_item table","Annexure 11 checklist","High - checklist items are individually assessed"],
        ["inspection_stage lookup table","Annexure 12 (9 stages)","Critical - 9-stage sequence must be enforced in order"],
        ["inspection_category lookup table","Annexure 14","High - category controls which items are checked at each stage"],
        ["inspection_item_type lookup table","Annexure 14","High - item types define the pass/fail criteria"],
        ["stage_inspection table","Annexures 12, 14","Critical - replaces the undifferentiated inspection table"],
        ["stage_inspection_result table","Annexure 14","Critical - per-item result recording required"],
        ["occupation_certificate table","Section 5.9 / Annexure 13","Critical - terminal document in the full lifecycle"],
        ["7 columns missing on permit_application","Section 2 (full 8-step process)","High - missing: land_use_category, zone_code, occ_status, refusal_reason, appeal_status, permit_expiry_date, processing_officer_id"],
    ],
    col_widths=[5.5, 4.5, 4.0]
)

sec("4.5","Schema Refinement v1.2: Fifteen New Tables")
body("The Vungu GIS Development Management Schema Refinement document (v1.2) was produced over the course of Week 4 of April. It is structured in five parts: a Handbook content analysis mapping each section and annexure to its data requirements; the gap analysis findings; full column-level specifications for all fifteen new tables and the two modified existing tables; complete DDL ordered to respect foreign key dependencies; and a phase-by-phase implementation workflow that maps each Handbook procedure to the specific database tables, API endpoints, and GIS screens involved.")
body("A key design principle applied throughout was that all legal constraints from the Handbook must be enforced at the database level through CHECK constraints, UNIQUE indexes, and NOT NULL requirements. Relying solely on application-layer validation is not sufficient for a system that holds statutory planning records, because any bug in the application code could allow invalid data through. Database-level constraints are the last line of defence.")
add_table(
    ["Phase","Table Name","Primary Key","Key Columns","Handbook Basis"],
    [
        ["Phase 1: Development Application","application_consultation","consultation_id (serial)","application_id (FK), consultation_type, consultant_name, consultation_date, outcome, notes","Section 2 One-Stop-Shop step"],
        ["Phase 1","application_objection","objection_id (serial)","application_id (FK), objector_name, objector_contact, objection_date, summary, officer_response, outcome","Public Notification period"],
        ["Phase 1","application_appeal","appeal_id (serial)","application_id (FK), appellant_name, appeal_date, ground_summary, court_reference, appeal_outcome, outcome_date","Administrative Court appeals"],
        ["Phase 2: Enforcement","enforcement_order","order_id (serial)","ward_id (FK), parcel_ref, offending_use, order_date, compliance_deadline, issuing_officer_id (FK), status","Section 3.3"],
        ["Phase 2","prohibition_order","prohibition_id (serial)","enforcement_order_id (FK), prohibition_date, reason, issuing_officer_id (FK), status","Section 3.4"],
        ["Phase 3: Building Plan Appraisal","building_plan","plan_id (serial)","application_id (FK), submission_date, architect_name, architect_reg_no, status, appraised_by (FK), appraisal_date","Annexure 11"],
        ["Phase 3","plan_drawing","drawing_id (serial)","plan_id (FK), drawing_type (CHECK: site/floor/elevation/section/services), drawing_number, file_path, submission_date","Annexure 11 (5 drawing types)"],
        ["Phase 3","plan_appraisal","appraisal_id (serial)","plan_id (FK), officer_id (FK), appraisal_date, overall_result, recommendation, notes","Annexure 11"],
        ["Phase 3","plan_appraisal_item","item_id (serial)","appraisal_id (FK), drawing_type, check_item, result (CHECK: pass/fail/not_applicable), officer_note","Annexure 11 checklist"],
        ["Phase 4: Stage Inspections (lookup)","inspection_stage","stage_id (serial)","stage_code (UNIQUE), stage_name, sequence_no (UNIQUE), description","Annexure 12 (9 stages)"],
        ["Phase 4 (lookup)","inspection_category","category_id (serial)","stage_id (FK), category_code (UNIQUE), category_name","Annexure 14"],
        ["Phase 4 (lookup)","inspection_item_type","item_type_id (serial)","category_id (FK), item_code (UNIQUE), item_description, pass_criteria","Annexure 14"],
        ["Phase 4 (operational)","stage_inspection","inspection_id (serial)","application_id (FK), stage_id (FK), inspector_id (FK), inspection_date, overall_result, UNIQUE(application_id, stage_id)","Annexures 12, 14"],
        ["Phase 4 (operational)","stage_inspection_result","result_id (serial)","inspection_id (FK), item_type_id (FK), result (CHECK: pass/fail/partial), notes, UNIQUE(inspection_id, item_type_id)","Annexure 14"],
        ["Phase 5: Certificate of Occupation","occupation_certificate","certificate_id (serial)","application_id (FK, UNIQUE), issue_date, issuing_officer_id (FK), coo_reference (UNIQUE), expiry_date, file_path, status","Section 5.9 / Annexure 13"],
    ],
    col_widths=[3.0, 3.5, 2.5, 5.5, 3.0]
)

sec("4.6","Third Normal Form Verification Report (v1.2.1)")
body("After completing the schema refinement v1.2, a formal Third Normal Form verification report was produced as a companion document. Its purpose was to demonstrate that every table introduced in v1.2 satisfies 1NF, 2NF, and 3NF. The report was submitted to Rafiq as v1.2.1.")
body("The verification method was applied consistently to each table. First, the primary key and all candidate keys were identified. Second, all non-trivial functional dependencies in the table were listed using the notation X -> Y. Third, 1NF was confirmed by checking that all attributes are atomic, with no repeating groups or multi-valued attributes. Fourth, 2NF was verified by checking that all non-key attributes depend on the whole primary key and not just part of it (relevant only for tables with composite primary keys). Fifth, 3NF was confirmed by checking that no non-key attribute depends transitively on the primary key through another non-key attribute.")
add_table(
    ["Table","PK","1NF","2NF","3NF","Notes"],
    [
        ["inspection_stage","stage_id","Pass","Pass","Pass","stage_code is UNIQUE; no transitive dependencies"],
        ["inspection_category","category_id","Pass","Pass","Pass","category_code UNIQUE; stage_id FK with no dependency chain"],
        ["inspection_item_type","item_type_id","Pass","Pass","Pass","item_code UNIQUE; pass_criteria depends directly on item"],
        ["stage_inspection","inspection_id","Pass","Pass","Pass","UNIQUE(application_id, stage_id); all attributes depend on inspection_id"],
        ["stage_inspection_result","result_id","Pass","Pass","Pass","UNIQUE(inspection_id, item_type_id); result depends on both FK values"],
        ["plan_appraisal_item","item_id","Pass","Pass","Pass","UNIQUE(appraisal_id, drawing_type, check_item); no partial dependencies"],
        ["application_consultation","consultation_id","Pass","Pass","Pass","All attributes depend on consultation_id; no transitive chains"],
        ["application_objection","objection_id","Pass","Pass","Pass","Objector data depends on the objection event, not on the application FK"],
        ["application_appeal","appeal_id","Pass","Pass","Pass","court_reference depends on the appeal record, not on the application FK"],
        ["enforcement_order","order_id","Pass","Pass","Pass","ward_id FK; all order attributes depend on order_id"],
        ["prohibition_order","prohibition_id","Pass","Pass","Pass","enforcement_order_id FK; prohibition attributes depend on this record"],
        ["building_plan","plan_id","Pass","Pass","Pass","application_id FK; architect data depends on the plan submission"],
        ["plan_drawing","drawing_id","Pass","Pass","Pass","UNIQUE(plan_id, drawing_type); file_path depends on the drawing record"],
        ["plan_appraisal","appraisal_id","Pass","Pass","Pass","plan_id FK; recommendation depends on this specific appraisal"],
        ["occupation_certificate","certificate_id","Pass","Pass","Pass","application_id UNIQUE FK; coo_reference UNIQUE; expiry depends on issue date"],
    ],
    col_widths=[4.0, 2.5, 1.2, 1.2, 1.2, 5.9]
)
body("All fifteen tables were confirmed in 3NF with no decomposition required beyond what had already been done during the schema design phase. The verification confirmed that the design decisions taken during v1.2, specifically placing all lookup data in separate normalised reference tables and enforcing all uniqueness constraints at the database level, were consistent with sound relational design principles.")

sec("4.7","Development Control Matrix Normalisation")
body("The Development Control Matrix is a two-dimensional cross-reference document from the Spatial Planning and Development unit of Vungu RDC. It defines which land uses are permitted outright (P), prohibited (X), or require special consent (S) in each of the nineteen land-use zones. In its original spreadsheet form it has 32 land-use group rows and 19 zone columns, producing 608 permission values. It needed to be normalised and loaded into the geodatabase so the system could evaluate zone compliance automatically.")
body("The normalisation was done in three formal stages.")

sub("4.7.1","Stage 1: UNF to First Normal Form")
body("The original matrix is in unnormalised form because the 19 zone columns are a repeating group: each column is an instance of the same attribute (permission_status) for a different zone value. To reach 1NF, the 19 zone columns were unpivoted into rows, producing:")
p = doc.add_paragraph()
p.paragraph_format.left_indent = Cm(1.5)
r = p.add_run("DCM_1NF(ug_code, ug_description, zone_code, zone_name, permission_status)  PK: (ug_code, zone_code)")
set_font(r, name="Courier New", size=10)
body("This gives 608 rows (32 use groups times 19 zones). All attributes are atomic and there are no repeating groups, so 1NF is satisfied.")

sub("4.7.2","Stage 2: First Normal Form to Second Normal Form")
body("The 2NF check identified two partial dependencies on the composite primary key: ug_description depends only on ug_code, and zone_name depends only on zone_code. These were removed by decomposing into three relations:")
p = doc.add_paragraph()
p.paragraph_format.left_indent = Cm(1.5)
r = p.add_run("land_use_group(ug_code PK, ug_description)\nland_use_zone(zone_code PK, zone_name)\ndevelopment_control_permission(ug_code FK, zone_code FK, permission_status)  PK: (ug_code, zone_code)")
set_font(r, name="Courier New", size=10)

sub("4.7.3","Stage 3: Second Normal Form to Third Normal Form")
body("The 3NF check found no transitive dependencies in any of the three relations. In land_use_group, ug_description depends only on ug_code (the primary key). In land_use_zone, zone_name depends only on zone_code. In development_control_permission, permission_status depends directly on the composite primary key (ug_code, zone_code). All three relations are in 3NF.")
add_table(
    ["Normalised Relation","Primary Key","Attributes","Role in System"],
    [
        ["land_use_group","ug_code","ug_code, ug_description","Reference table for the 32 land-use group categories"],
        ["land_use_zone","zone_code","zone_code, zone_name","Reference table for the 19 spatial planning zones"],
        ["development_control_permission","(ug_code, zone_code)","ug_code (FK), zone_code (FK), permission_status (P/X/S)","Stores all 608 permission values; queried at zone compliance check"],
        ["zone_spatial_plan (integration)","zone_id","zone_id, zone_code (FK), zone_geometry (GEOMETRY POLYGON)","Links zone_code to PostGIS polygon geometry for spatial queries"],
        ["application_zone_check (integration)","check_id","application_id (FK), zone_code (FK), check_date, result","Records the zone compliance check result for each application"],
    ],
    col_widths=[4.0, 3.0, 5.0, 5.0]
)
body("The decomposition was verified to be lossless: a natural join of the three normalised tables on their shared keys reproduces the original 608-value matrix exactly, confirming no data was lost during the process.")

sec("4.8","Data Dictionaries")
body("Two data dictionary documents were produced. The Vungu GIS Enterprise Geodatabase Data Dictionary (v1.0) covers the complete system database schema, including all spatial tables, geometry column specifications, SRID enforcement, GiST index definitions, and the full foreign key dependency graph. Every table is documented at column level: name, data type, nullable status, default value, constraint description, and a plain-language explanation of the business rule each column enforces.")
body("The Vungu GIS DCM Data Dictionary (v1.0) is a focused companion to the DCM Normalisation Report, covering the six tables introduced by the DCM normalisation. It includes the seed data specification for the land_use_group and land_use_zone lookup tables, so a developer can populate these tables from the dictionary alone without referring back to the original spreadsheet.")
add_table(
    ["Table","Column","Data Type","Nullable","Constraint","Business Rule"],
    [
        ["development_control_permission","ug_code","VARCHAR(10)","NOT NULL","FK to land_use_group(ug_code)","Identifies the land-use group being regulated"],
        ["development_control_permission","zone_code","VARCHAR(10)","NOT NULL","FK to land_use_zone(zone_code)","Identifies the zone for which permission is defined"],
        ["development_control_permission","permission_status","CHAR(1)","NOT NULL","CHECK IN ('P','X','S')","P=Permitted; X=Prohibited; S=Special Consent required"],
        ["land_use_group","ug_code","VARCHAR(10)","NOT NULL","PRIMARY KEY","Unique code for each of the 32 land-use groups"],
        ["land_use_group","ug_description","VARCHAR(200)","NOT NULL","none","Full statutory name of the land-use group"],
        ["occupation_certificate","coo_reference","VARCHAR(30)","NOT NULL","UNIQUE","Council-issued COO reference number; unique per certificate"],
        ["occupation_certificate","expiry_date","DATE","NULL","CHECK expiry_date > issue_date","COO validity end date; NULL if open-ended"],
    ],
    col_widths=[3.5, 3.0, 2.0, 1.5, 3.5, 4.5]
)

sec("4.9","Research Papers")
body("Two comparative research papers were assigned as deliverables during the second phase of the placement. Both were intended to add to the project team's research knowledge base and inform future technical decisions on the Vungu RDC system.")

sub("4.9.1","SQL versus NoSQL Databases for GIS Systems")
body("The first paper evaluates relational (SQL) and non-relational (NoSQL) database technologies across sixteen criteria relevant to GIS workloads. The evaluation was built around the specific requirements of a municipal GIS planning system: authoritative spatial data, complex geometric queries, OGC-standard web service delivery, strict ACID compliance for statutory records, and long-term data integrity. It was not a generic comparison.")
add_table(
    ["Criterion","PostgreSQL + PostGIS","NoSQL (MongoDB / Elasticsearch)","Recommendation for Vungu System"],
    [
        ["Spatial data support","Native geometry types; OGC SFS compliance; WKB/WKT; GeoJSON","Limited (MongoDB: GeoJSON 2D; no topology)","PostgreSQL/PostGIS - no equivalent spatial depth in NoSQL"],
        ["Query language","SQL with spatial predicates (ST_Within, ST_Intersects, etc.)","API-based; limited spatial query expressiveness","PostgreSQL - complex multi-table spatial joins are required"],
        ["ACID compliance","Full ACID; serialisable transactions","Eventual consistency in most NoSQL systems","PostgreSQL - statutory records must be fully ACID compliant"],
        ["Schema flexibility","Rigid schema; migration required for changes","Flexible schema; document model","PostgreSQL - schema rigidity is a feature for planning data, not a defect"],
        ["Scalability","Vertical scaling plus read replicas; Citus for horizontal sharding","Horizontal scale-out is native","PostgreSQL is more than sufficient for Vungu RDC scale"],
        ["GIS tooling ecosystem","QGIS, GeoServer, PostGIS, GDAL - full native integration","Limited GIS tooling; adapter layers needed","PostgreSQL - the entire OGC toolchain integrates natively"],
        ["Real-time and streaming data","Not native; logical replication for CDC","Strong (MongoDB Change Streams; Elasticsearch)","NoSQL preferable for real-time sensor or IoT layers if added later"],
        ["Raster data","PostGIS Raster; WMS raster serving via QGIS Server","No native raster support","PostgreSQL/PostGIS for all raster requirements"],
    ],
    col_widths=[3.5, 4.0, 3.5, 5.0]
)
body("The paper concludes that PostgreSQL with PostGIS is the right choice for the Vungu RDC system's authoritative spatial dataset and all statutory planning records. NoSQL databases, specifically MongoDB for document storage and Elasticsearch for full-text search, are identified as potentially useful for specific future modules such as real-time mobile inspection data collection or a document search index, but not as replacements for the core geodatabase.")

sub("4.9.2","Document Verification and Storage in a Local Municipal GIS User System")
body("The second research paper covers document verification and storage for the three document categories that Vungu RDC requires applicants to submit: identity documents (national ID or passport), title deeds registered by the Deeds Registry of Zimbabwe, and previous planning approvals issued by a recognised local planning authority.")
body("The paper examines two verification approaches. Manual verification by council clerks means checking physical or scanned documents against visual authenticity indicators: security features like watermarks and holograms, official stamps, registration numbers, and cross-referencing with physical registers or databases the council can access. Automated digital verification uses OCR to extract text from scanned documents, barcode and QR-code reading for electronically issued documents, facial recognition for identity document photo matching, and API-based registry lookups against the Deeds Registry or civil registry where such APIs are available.")
add_table(
    ["Document Type","Verification Method","Automation Feasibility","Storage Requirement"],
    [
        ["National ID / Passport","Visual check of security features; cross-reference with name on application form","Medium - OCR for name/ID extraction; facial recognition for photo match","Scanned PDF or JPEG; linked to applicant record by FK; clerk access and above only"],
        ["Title Deed","Verify registration number format; check issuing registry; confirm plot description matches application site","Low - Deeds Registry API not publicly accessible in Zimbabwe","Scanned PDF; linked to application by FK; immutable once verified"],
        ["Previous Planning Approval","Verify LPA stamp; confirm reference number format; cross-check with council records if issued by same LPA","Low - no centralised planning approval registry in Zimbabwe","Scanned PDF; linked to application; verification status recorded separately"],
    ],
    col_widths=[3.0, 5.0, 4.0, 5.0]
)
body("The paper also covers file naming conventions, database record linkage, access control tiers, data protection requirements under Zimbabwe's Data Protection Act Chapter 11:12 (2021), and a fraud indicator checklist for council clerks doing manual verification. At the time of this report, the manual versus automated comparison and the Data Protection Act section were complete, with the storage architecture section still in draft.")
pb()

# ── CHAPTER 5 ────────────────────────────────────────────────────────────────
heading("CHAPTER 5: SUMMARY, CONCLUSIONS, AND RECOMMENDATIONS", size=15, bold=True, colour=(31,56,100), sb=0, sa=6)

sec("5.1","Summary of Activities Carried Out")
add_table(
    ["No.","Activity","Category","Period","Status"],
    [
        ["1","Project orientation and briefing with Dr Paradzayi","Orientation","Feb 2026 Wk 1","Complete"],
        ["2","GIS technology research: PostGIS, OGC standards, QGIS Server, Fastify, Leaflet.js","Research","Feb 2026 Wk 1","Complete"],
        ["3","Prototype codebase security audit: 3 vulnerability categories identified","Security","Feb 2026 Wk 1","Complete"],
        ["4","Production server provisioning on Ubuntu 24.04 LTS with SSH hardening","Infrastructure","Mar 2026 Wk 1","Complete"],
        ["5","Full backend stack installation: Node.js, PostgreSQL/PostGIS, QGIS Server, Nginx","Infrastructure","Mar 2026 Wk 2","Complete"],
        ["6","Dependency audit: 10 CVEs identified and cleared to zero","Security","Mar 2026 Wk 3","Complete"],
        ["7","Authentication system rebuilt using bcrypt (cost factor 12) and signed JWTs","Security","Mar 2026 Wk 3","Complete"],
        ["8","Hardcoded credentials removed; Git history rewritten; database password rotated","Security","Mar 2026 Wk 3","Complete"],
        ["9","Input sanitiser rewritten; Fastify JSON Schema validation on all routes","Security","Mar 2026 Wk 3","Complete"],
        ["10","Site visit to Vungu RDC Department of Planning with structured officer interviews","Client Liaison","Mar 2026 Wk 3","Complete"],
        ["11","PostGIS spatial database schema design and GiST index configuration","Database","Mar 2026 Wk 2-3","Complete"],
        ["12","REST API development with Fastify; schema validation; ward statistics endpoint","Backend Dev","Mar-Apr 2026","Complete"],
        ["13","application_status_history audit trail added to production schema","Database","Mar 2026 Wk 3","Complete"],
        ["14","Docker containerisation: 3-service compose with health check ordering","Infrastructure","Mar 2026 Wk 4","Complete"],
        ["15","BACKEND_GUIDE.md documentation; Mermaid architecture and ER diagrams","Documentation","Mar 2026 Wk 4","Complete"],
        ["16","API integration test suite: 47 tests using Jest and Supertest","Testing","Apr 2026 Wk 1","Complete"],
        ["17","HTTPS implementation: Certbot, Let's Encrypt, auto-renewal","Infrastructure","Apr 2026 Wk 1","Complete"],
        ["18","ZITF 2026 Innovation Hackathon participation","Outreach","Apr 2026 Wk 2","Complete"],
        ["19","Formal system demonstration to Vungu RDC officers: approved as demonstration-ready","Client Liaison","Apr 2026 Wk 2","Complete"],
        ["20","Systematic study of Zimbabwe Development Management (Control) Handbook 2021","Research","Apr 2026 Wk 3","Complete"],
        ["21","Gap analysis: v1.1 schema vs Handbook: 15 missing tables, 7 missing columns","Database","Apr 2026 Wk 3","Complete"],
        ["22","Schema Refinement Document v1.2: 15 new tables, DDL, implementation workflow","Database","Apr 2026 Wk 4","Complete"],
        ["23","3NF Verification Report v1.2.1: all 15 tables formally verified","Database","Apr/May 2026","Complete"],
        ["24","DCM Normalisation: UNF to 3NF; 5 normalised relations produced","Database","May 2026 Wk 1","Complete"],
        ["25","DCM Normalisation Report and DCM Data Dictionary v1.0","Documentation","May 2026 Wk 1","Complete"],
        ["26","SQL vs NoSQL GIS Research Paper","Research","May 2026 Wk 1","Complete"],
        ["27","Document Verification and Storage Research Paper","Research","May 2026 Wk 2","Ongoing"],
    ],
    col_widths=[0.6, 7.5, 2.5, 2.5, 2.0]
)

sec("5.2","Problems Encountered and Lessons Learned")
add_table(
    ["Problem","Description","Impact","Resolution and Lesson Learned"],
    [
        ["Prototype security state","The prototype had plaintext password storage, hardcoded database credentials, and no input validation: three separate vulnerability categories requiring full remediation before any new development.","One full week consumed on remediation before productive feature work could start.","Resolved through systematic OWASP-based audit and a dedicated hardening sprint. The lesson is that credentials should never be committed in the first place because the cleanup cost is far greater than the initial discipline would have been."],
        ["Git history rewrite coordination","Rewriting the repository history to remove the hardcoded credential commit changes the hash of every subsequent commit, requiring all team members to re-clone.","Team disruption; risk of divergent histories if anyone continued working on the old clone.","Communicated to Theophelos before the rewrite; coordinated timing; confirmed all team members re-cloned. The lesson is to treat history rewrites like a production deployment: plan, communicate, and execute as a team."],
        ["Server provisioning credential delay","Provisioning credentials for the production server were delayed by about one week in early March.","Hands-on PostGIS validation could not begin as planned; schema research was purely theoretical during the delay.","Time was redirected to additional GIS research and documentation. The lesson is to build a provisioning buffer into project plans and treat delay time as research time rather than lost time."],
        ["Statutory language in the Handbook","The Zimbabwe Development Management Handbook uses legal and procedural language that does not map transparently to database schema attributes. Implicit data requirements have to be inferred from procedural steps and annexure cross-references.","Schema gap analysis took significantly longer than expected; several revisits to specific sections were required.","A structured reading approach helped: read section, identify actors, identify actions, identify data objects, then map to tables and columns. The lesson is that statutory documents always reward multiple careful readings."],
        ["PostGIS as unfamiliar domain","Spatial database concepts including geometry types, SRIDs, GiST indexing, and OGC predicates were all new at the start of the placement.","Risk of schema design errors if spatial concepts were misunderstood.","A dedicated GIS research sprint in Week 1 and reading the OGC SFS documentation before any schema was written addressed this. Designing a spatial database without understanding spatial data models produces schemas that are expensive to fix later."],
    ],
    col_widths=[3.5, 5.0, 3.0, 5.5]
)

sec("5.3","Conclusions")
body("This placement met all eight objectives set out in Chapter 1. A production-grade, spatially enabled planning management system was built, security-hardened, deployed, tested, and demonstrated to the client. The enterprise geodatabase was designed to Third Normal Form, formally verified, and fully documented. The statutory framework governing development management in Zimbabwe was studied and translated into a Handbook-compliant database schema. Research papers of professional quality were produced on two technically relevant topics.")
body("The placement confirmed that the Computer Science programme at MSU provides a solid theoretical foundation for professional practice. Advanced Databases, Software Security, Web Systems, and Computer Networks were all applied directly, with coursework knowledge translating efficiently into working implementation once the domain context was in place. The main knowledge gaps encountered were in the GIS domain (PostGIS, OGC standards, spatial indexing) and in the Zimbabwean planning statutory framework. Both are beyond the standard Computer Science curriculum and were acquired through self-directed research during the placement.")
body("The placement also demonstrated that rigorous documentation is a genuine engineering discipline, not an add-on. The schema refinement document, normalisation reports, and data dictionaries produced here are durable technical assets for the Vungu RDC GIS project that will remain useful long after the current team moves on. Writing documentation to the standard required by Dr Paradzayi and Rafiq, where every claim is verifiable and every table is fully specified, was often more demanding than the associated technical work.")

sec("5.4","Recommendations")
numbered("Prototype codebases handed to attachment students should go through a basic security review before handover, covering at minimum password storage, credential handling, input validation, and a dependency vulnerability scan. Finding these issues at the start of a placement wastes time that could go toward productive development.")
numbered("The Zimbabwe Development Management (Control) Handbook 2021 should be treated as required reading and given to every student or developer joining the Vungu RDC GIS project at the start of their engagement. Its data requirements define the entire schema, and without reading it the system cannot be correctly extended or maintained.")
numbered("Third Normal Form verification should be done on every new schema design before DDL is written. The table-by-table approach documented in the v1.2.1 report takes a fraction of the time needed to debug data anomalies once an unnormalised schema is in production.")
numbered("The Development Control Matrix should be maintained exclusively in the normalised database form. All future updates to zone permissions should go through the application administration interface with changes logged in an audit table. The original spreadsheet should be archived and not edited.")
numbered("Future students working on the document management module should read the Document Verification and Storage research paper produced during this placement before designing the document upload and verification workflows. It covers the Zimbabwe Data Protection Act obligations that apply to storing identity documents and title deeds, which have direct implications for the schema and access control model.")
numbered("The API integration test suite should be maintained and expanded alongside each new feature added to the system. The existing forty-seven tests cover all current user journeys; corresponding tests should be written at the same time as new modules are added, not retrospectively.")
numbered("Server provisioning timelines should be included explicitly in WRL work plans submitted to supervisors at the start of placements involving infrastructure setup. A one-week buffer beyond the expected provisioning date is a reasonable assumption for institutional server environments.")
doc.add_paragraph()
pb()

# ── REFERENCES ────────────────────────────────────────────────────────────────
heading("REFERENCES", size=14, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, sb=0, sa=10)
refs = [
    "Billett, S. (2011). Learning in the Circumstances of Practice. International Journal of Lifelong Education, 30(5), pp. 35-47.",
    "Codd, E.F. (1970). A Relational Model of Data for Large Shared Data Banks. Communications of the ACM, 13(6), pp. 377-387.",
    "Coronel, C., Morris, S. and Rob, P. (2019). Database Systems: Design, Implementation, and Management. 13th edn. Boston: Cengage Learning.",
    "Date, C.J. (2015). SQL and Relational Theory: How to Write Accurate SQL Code. 3rd edn. Sebastopol: O'Reilly Media.",
    "Fowler, M. and Sadalage, P.J. (2012). NoSQL Distilled: A Brief Guide to the Emerging World of Polyglot Persistence. Upper Saddle River: Addison-Wesley.",
    "Government of Zimbabwe (2018). Education 5.0 Policy Framework. Ministry of Higher and Tertiary Education, Innovation, Science and Technology Development. Harare: Government Printer.",
    "Government of Zimbabwe (2021). Development Management (Control) Handbook. Ministry of Local Government and Public Works. Harare: Government Printer.",
    "Government of Zimbabwe (2021). Data Protection Act, Chapter 11:12. Harare: Government Printer.",
    "Internet Engineering Task Force (2016). RFC 7946: The GeoJSON Format. IETF.",
    "Kent, W. (1983). A Simple Guide to Five Normal Forms in Relational Database Theory. Communications of the ACM, 26(2), pp. 120-125.",
    "MSU Research and Innovation Hub (2025). Hub Profile and Services Overview. Gweru: Midlands State University.",
    "Open Geospatial Consortium (2011). OGC Simple Features for SQL. OGC Document 06-104r4. Wayland: OGC.",
    "OWASP Foundation (2021). OWASP Top Ten Web Application Security Risks. OWASP.",
    "PostGIS Development Group (2024). PostGIS 3.4 Documentation. Available at: https://postgis.net/docs.",
    "PostgreSQL Global Development Group (2024). PostgreSQL 16 Documentation. Available at: https://www.postgresql.org/docs/16.",
    "Provos, N. and Mazieres, D. (1999). A Future-Adaptable Password Scheme. Proceedings of the 1999 USENIX Annual Technical Conference, pp. 81-91.",
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
    r = p.add_run(ref); set_font(r, size=11)

out = r"c:\Users\munya\Desktop\WRL\Munyaradzi_Namailinga_WRL_Preliminary_Report_R243100H_v4.docx"
doc.save(out)
print(f"Saved: {out}")
