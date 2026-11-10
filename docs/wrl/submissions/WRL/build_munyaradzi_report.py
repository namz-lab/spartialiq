"""
Build Munyaradzi WRL Preliminary Report from scratch.
Tailored to Computer Science / Backend Engineering / GIS systems.
No dash bullets: uses Word ListBullet style or clean prose.
"""
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUT = "Munyaradzi_Namailinga_WRL_Preliminary_Report_R243100H.docx"
doc = Document()

# ─── page margins ───
from docx.oxml.ns import qn
section = doc.sections[0]
section.left_margin = Inches(1.2)
section.right_margin = Inches(1.0)
section.top_margin = Inches(1.0)
section.bottom_margin = Inches(1.0)

# ─── style helpers ───
def h(text, level=1, align=WD_ALIGN_PARAGRAPH.LEFT):
    """Heading paragraph."""
    p = doc.add_paragraph(style=f'Heading {level}')
    run = p.add_run(text)
    run.font.size = Pt(12 if level == 1 else 11 if level == 2 else 10)
    p.alignment = align
    return p

def body(text, size=10, indent=None, space_before=0, space_after=4):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(size)
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(space_before)
    if indent:
        p.paragraph_format.left_indent = Inches(indent)
    return p

def bullet(text, size=10):
    """Bullet using left indent + paragraph marker, no dash character."""
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.3)
    p.paragraph_format.first_line_indent = Inches(-0.2)
    p.paragraph_format.space_after = Pt(2)
    run = p.add_run(text)
    run.font.size = Pt(size)
    # prepend a proper bullet character
    run2 = p.runs[0]
    p.runs[0].text = "•  " + text
    return p

def center(text, size=12, bold=False):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    run.font.size = Pt(size)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    return p

def page_break():
    doc.add_page_break()

def section_line():
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(2)

# ═══════════════════════════════════════════════
# COVER PAGE
# ═══════════════════════════════════════════════
center("MIDLANDS STATE UNIVERSITY", 13, bold=True)
center("FACULTY OF INFORMATION SCIENCE AND TECHNOLOGY", 11, bold=True)
center("DEPARTMENT OF COMPUTER SCIENCE", 11, bold=True)
doc.add_paragraph()
center("WRL PRELIMINARY REPORT", 14, bold=True)
doc.add_paragraph()
center("Work-Related Learning Placement at", 10)
center("MSU RESEARCH AND INNOVATION HUB AND VUNGU RURAL DISTRICT COUNCIL", 11, bold=True)
center("GIS-Based Municipal Planning Information System for Vungu RDC", 10)
doc.add_paragraph()
center(
    "Submitted in partial fulfilment of the requirements of the\n"
    "Bachelor of Science Honours Degree in Computer Science",
    10
)
center("Midlands State University", 10)
doc.add_paragraph()

# cover info table
tbl = doc.add_table(rows=8, cols=2)
tbl.style = 'Table Grid'
info = [
    ("Student Name", "Munyaradzi Namailinga"),
    ("Student ID", "R243100H"),
    ("Programme", "Bachelor of Science Honours Degree in Computer Science"),
    ("Level", "3.1"),
    ("Organisation",
     "MSU Research and Innovation Hub / Faculty of Built Environment, Vungu RDC GIS Project"),
    ("Supervisor", "Dr Paradzayi, Project Manager"),
    ("WRL Period", "23 February 2026 to 10 May 2026"),
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

# ═══════════════════════════════════════════════
# ABSTRACT
# ═══════════════════════════════════════════════
h("ABSTRACT")
body(
    "This preliminary work-related learning (WRL) report documents the activities carried out by "
    "Munyaradzi Namailinga (Student ID: R243100H), a Level 3.1 Computer Science student at Midlands "
    "State University, during an industrial attachment at the MSU Research and Innovation Hub and in "
    "collaboration with the Faculty of Built Environment on a project commissioned by Vungu Rural District "
    "Council. The placement covers the period 23 February 2026 to 10 May 2026."
)
body(
    "The placement project involved the design, development, security hardening, testing, and deployment "
    "of a GIS-based Municipal Planning Information System. The system is built on a technology stack "
    "comprising Node.js with the Fastify framework, PostgreSQL with the PostGIS spatial extension, QGIS "
    "Server for OGC-compliant map tile serving, Nginx as a reverse proxy, and Leaflet.js on the frontend. "
    "The system manages land-use planning, development applications, inspections, and spatial compliance "
    "checks across 19 wards in the Vungu RDC jurisdiction, with a five-tier user hierarchy covering public "
    "access, applicants, planning officers, senior planners, and administrators."
)
body(
    "Key technical activities included a full security audit and remediation of the prototype codebase, "
    "production server provisioning on Ubuntu 24.04 LTS, PostGIS spatial schema design, RESTful API "
    "development with schema-based request validation, authentication implementation using bcrypt and "
    "signed JWTs, Docker containerisation, GitHub Actions CI/CD pipeline creation, HTTPS implementation "
    "via Let's Encrypt, Redis-backed distributed rate limiting, email notification integration, load "
    "testing, and comprehensive API integration testing using Jest and Supertest. The student also "
    "contributed several design innovations not specified in the original brief, including an application "
    "status history audit trail, a ward-level application statistics endpoint, a spatial boundary "
    "validation check on application submission, and an administrative CSV export endpoint."
)
body(
    "The system was formally demonstrated to Vungu RDC planning officers in April 2026 and approved as "
    "demonstration-ready by the project supervisor. The planning department subsequently began using the "
    "system for live application processing."
)
body(
    "Keywords: Work-Related Learning, Computer Science, GIS, PostGIS, Node.js, Fastify, Vungu RDC, "
    "Municipal Planning, Security Engineering, RESTful API, Midlands State University."
)

page_break()

# ═══════════════════════════════════════════════
# ACKNOWLEDGEMENTS
# ═══════════════════════════════════════════════
h("ACKNOWLEDGEMENTS")
body(
    "The completion of this placement and the preparation of this report would not have been possible "
    "without the guidance and support of a number of people."
)
body(
    "Sincere thanks go to Dr Paradzayi, Project Manager for the Vungu RDC GIS project, whose technical "
    "mentorship and clear supervision framework enabled meaningful progress throughout the placement. His "
    "insistence on professional standards for security, documentation, and code quality shaped the "
    "approach taken at every stage of the work."
)
body(
    "Appreciation is extended to Rafiq, the project research assistant, whose structured documentation "
    "requirements pushed the team to produce output of a standard appropriate for a system entering "
    "production use. Thanks also go to the planning officers at Vungu Rural District Council for their "
    "engagement during the site visit and the final demonstration, particularly for sharing operational "
    "insights that improved the system in ways the written brief had not anticipated."
)
body(
    "Thanks go to Theophelos, the frontend team member, for a productive working relationship throughout "
    "the placement. The backend and frontend integration proceeded smoothly because of early agreement on "
    "API contracts and consistent communication throughout the development process."
)
body(
    "Finally, gratitude is owed to the Department of Computer Science at Midlands State University for "
    "the academic foundation in software engineering, databases, networking, and security that made it "
    "possible to contribute substantively to the project from the first day of the placement."
)

page_break()

# ═══════════════════════════════════════════════
# TABLE OF CONTENTS (static)
# ═══════════════════════════════════════════════
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
    "   4.1  System Analysis and Requirements Review",
    "   4.2  Security Audit and Remediation",
    "   4.3  Infrastructure Provisioning and DevOps",
    "   4.4  Backend API Development",
    "   4.5  GIS Integration",
    "   4.6  Testing and Quality Assurance",
    "   4.7  Email Notifications, Redis Rate Limiting, and CI/CD",
    "   4.8  Stakeholder Engagement",
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

# ═══════════════════════════════════════════════
# LIST OF ABBREVIATIONS
# ═══════════════════════════════════════════════
h("LIST OF ABBREVIATIONS")
abbrev_tbl = doc.add_table(rows=1, cols=2)
abbrev_tbl.style = 'Table Grid'
abbrev_tbl.rows[0].cells[0].text = "Abbreviation"
abbrev_tbl.rows[0].cells[1].text = "Meaning"
for cell in abbrev_tbl.rows[0].cells:
    cell.paragraphs[0].runs[0].bold = True
    cell.paragraphs[0].runs[0].font.size = Pt(10)

abbrevs = [
    ("AOF", "Append-Only File (Redis persistence mode)"),
    ("API", "Application Programming Interface"),
    ("CI/CD", "Continuous Integration / Continuous Deployment"),
    ("CSV", "Comma-Separated Values"),
    ("GIS", "Geographic Information System"),
    ("GeoJSON", "Geographic JavaScript Object Notation (RFC 7946)"),
    ("GiST", "Generalized Search Tree (PostgreSQL spatial index type)"),
    ("HSTS", "HTTP Strict Transport Security"),
    ("HTTP", "Hypertext Transfer Protocol"),
    ("HTTPS", "Hypertext Transfer Protocol Secure"),
    ("ICP-MS", "Inductively Coupled Plasma Mass Spectrometry"),
    ("IP", "Internet Protocol"),
    ("JWT", "JSON Web Token"),
    ("MSU", "Midlands State University"),
    ("Nginx", "Engine-X (web server and reverse proxy)"),
    ("OGC", "Open Geospatial Consortium"),
    ("ORP", "Oxidation-Reduction Potential"),
    ("P95", "95th Percentile Response Time"),
    ("PM2", "Process Manager 2 (Node.js process manager)"),
    ("PPE", "Personal Protective Equipment"),
    ("PostGIS", "Spatial database extension for PostgreSQL"),
    ("REST", "Representational State Transfer"),
    ("RDC", "Rural District Council"),
    ("SCP", "Secure Copy Protocol"),
    ("SMTP", "Simple Mail Transfer Protocol"),
    ("SOP", "Standard Operating Procedure"),
    ("SQL", "Structured Query Language"),
    ("SRID", "Spatial Reference Identifier"),
    ("SSH", "Secure Shell"),
    ("SSL", "Secure Sockets Layer"),
    ("TLS", "Transport Layer Security"),
    ("UFW", "Uncomplicated Firewall"),
    ("VM", "Virtual Machine"),
    ("VCC", "Value Creation Challenge"),
    ("WFS", "Web Feature Service"),
    ("WMS", "Web Map Service"),
    ("WRL", "Work-Related Learning"),
    ("XSS", "Cross-Site Scripting"),
    ("ZITF", "Zimbabwe International Trade Fair"),
]
for abbr, meaning in abbrevs:
    row = abbrev_tbl.add_row()
    row.cells[0].text = abbr
    row.cells[1].text = meaning
    for cell in row.cells:
        cell.paragraphs[0].runs[0].font.size = Pt(10)

page_break()

# ═══════════════════════════════════════════════
# CHAPTER 1: INTRODUCTION
# ═══════════════════════════════════════════════
h("CHAPTER 1: INTRODUCTION")

h("1.1  Background", level=2)
body(
    "Work-Related Learning (WRL) is a structured component of undergraduate degree programmes at "
    "Midlands State University (MSU) that places students in professional environments relevant to their "
    "field of study for a defined period. For Computer Science students, this exposure bridges the gap "
    "between the theoretical foundations of algorithms, data structures, and systems design taught in "
    "lecture rooms and the realities of building, securing, testing, and deploying software that real "
    "users depend on."
)
body(
    "MSU operates under the Education 5.0 philosophy promoted by the Government of Zimbabwe, which "
    "requires universities to contribute directly to national industrialisation and innovation alongside "
    "teaching and research. The MSU Research and Innovation Hub was established as the operational "
    "expression of this mandate, bringing together student innovators, academic staff, and external "
    "partners to work on projects with genuine commercial and social value."
)
body(
    "This report documents the preliminary phase of the author's WRL placement, during which the student "
    "was assigned to the development of a GIS-based Municipal Planning Information System commissioned by "
    "Vungu Rural District Council. The system manages land-use planning, development applications, "
    "spatial inspections, and compliance checking across 19 wards in the Vungu RDC jurisdiction. The "
    "project is hosted and managed through the Faculty of Built Environment at MSU and coordinated with "
    "the MSU Research and Innovation Hub."
)

h("1.2  Purpose of the Placement", level=2)
body(
    "The placement serves three connected purposes. The first is academic: to fulfil the WRL requirement "
    "for the Bachelor of Science Honours Degree in Computer Science at Midlands State University. The "
    "second is professional: to give the student firsthand experience of building and deploying a "
    "production-grade software system in a real organisational setting. The third is practical and "
    "social: to contribute a working system to a local government body that currently manages planning "
    "processes manually, with the direct goal of improving administrative efficiency and planning data "
    "integrity for communities in the Vungu RDC area."
)

h("1.3  Objectives of the Placement", level=3)
body("The specific objectives of this placement are as follows:")
for obj in [
    "To apply software engineering skills acquired through academic training in the design, "
    "implementation, and deployment of a production-grade backend API and spatial data system.",
    "To develop a working understanding of security engineering principles in the context of a "
    "real system handling personal data and government planning records.",
    "To gain practical experience with GIS technologies including PostGIS, QGIS Server, "
    "OGC-standard web services, and the Leaflet.js map library.",
    "To apply DevOps practices including server provisioning, process management, containerisation "
    "with Docker, continuous integration and deployment via GitHub Actions, and HTTPS configuration.",
    "To contribute to the design and implementation of a tested, documented system that meets the "
    "functional requirements of a real client organisation.",
    "To identify gaps between the knowledge acquired in undergraduate coursework and the demands of "
    "professional software engineering practice.",
]:
    bullet(obj)

h("1.4  Scope of Work", level=2)
body(
    "The scope of this placement covers software engineering activities carried out between "
    "23 February 2026 and 10 May 2026. The work includes prototype code review and security audit, "
    "production server provisioning, PostGIS spatial database schema design, RESTful API development, "
    "authentication system implementation, Docker containerisation, automated testing, HTTPS setup, "
    "Redis-backed rate limiting, email notification integration, CI/CD pipeline creation, and a formal "
    "system demonstration to Vungu RDC planning officers. This preliminary report covers the full eleven "
    "weeks of the placement to date."
)

h("1.5  Significance of the Work", level=2)
body(
    "Local government planning processes in many Zimbabwean rural district councils are still managed "
    "predominantly through paper-based workflows and manual records. The system developed during this "
    "placement digitises the full development application lifecycle, including submission, status "
    "tracking, spatial compliance checking against ward boundaries, officer assignment, inspection "
    "scheduling, and administrative reporting. By building this system locally at MSU using open-source "
    "technologies, the project demonstrates that capable, secure, and maintainable government software "
    "can be produced within the university without dependence on expensive proprietary platforms."
)
body(
    "For the student, the significance of the placement lies in the opportunity to be solely responsible "
    "for the backend architecture of a system that entered production use during the attachment period. "
    "That level of ownership and accountability is difficult to replicate in any academic setting."
)

page_break()

# ═══════════════════════════════════════════════
# CHAPTER 2: DESCRIPTION OF THE WRL ORGANISATION
# ═══════════════════════════════════════════════
h("CHAPTER 2: DESCRIPTION OF THE WRL ORGANISATION")

h("2.1  Overview of Midlands State University", level=2)
body(
    "Midlands State University was established in 1999 and became a fully independent institution in "
    "2000. It is located in Gweru in the Midlands Province of Zimbabwe and operates across multiple "
    "faculties. The university enrols approximately 20,000 students across undergraduate and postgraduate "
    "programmes. MSU adopted the Education 5.0 philosophy, which extends the traditional university "
    "mandate of teaching and research to include community service, innovation, and industrialisation. "
    "Work-Related Learning is a core expression of this philosophy."
)

h("2.2  The MSU Research and Innovation Hub", level=2)
body(
    "The MSU Research and Innovation Hub is located on the Senga Road campus in Gweru. It provides "
    "incubation support, laboratory and computing facilities, mentorship, and access to seed funding "
    "pathways for student innovators, staff researchers, and early-stage start-up companies. The Hub "
    "hosts multiple resident innovation projects at any given time, including technology projects, "
    "chemical and physical sciences projects, agribusiness ventures, and light manufacturing initiatives. "
    "Students working at the Hub are expected to function as active project team members rather than "
    "observers, and are held accountable for the quality of their contributions."
)

h("2.3  The Vungu RDC GIS Project", level=2)
body(
    "The Vungu Rural District Council GIS project is a commissioned system development engagement "
    "between the Faculty of Built Environment at MSU and Vungu RDC, facilitated through the Innovation "
    "Hub. The project's objective is to replace manual planning workflows with a web-based GIS system "
    "that manages all aspects of land-use planning, development applications, spatial inspections, and "
    "administrative reporting across the council's 19 wards. The system is intended to serve "
    "approximately five categories of users: members of the public accessing planning maps, applicants "
    "submitting and tracking development applications, planning officers processing and reviewing "
    "applications, senior planners overseeing compliance, and system administrators managing users and "
    "producing reports. The student was assigned to all backend engineering responsibilities on this "
    "project."
)

h("2.4  Organisational Structure", level=2)
body(
    "The project is managed by Dr Paradzayi as Project Manager, who reports through the Faculty of "
    "Built Environment and interfaces with the MSU Innovation Hub. A research assistant, Rafiq, manages "
    "documentation deliverables and coordinates with external stakeholders at Vungu RDC. The development "
    "team consists of two student developers: the author, responsible for backend engineering and "
    "infrastructure, and Theophelos, responsible for frontend development. Day-to-day work is organised "
    "through weekly sprint reviews with Dr Paradzayi."
)

page_break()

# ═══════════════════════════════════════════════
# CHAPTER 3: WORK PLAN
# ═══════════════════════════════════════════════
h("CHAPTER 3: WORK PLAN")

h("3.1  Planned Activities", level=2)
body(
    "At the start of the placement, the supervisor and the student agreed on a phased work plan. The "
    "following table summarises the planned activities across the eleven weeks covered by this report."
)

plan_tbl = doc.add_table(rows=1, cols=3)
plan_tbl.style = 'Table Grid'
for i, hdr in enumerate(["Phase", "Weeks", "Planned Activities"]):
    plan_tbl.rows[0].cells[i].text = hdr
    plan_tbl.rows[0].cells[i].paragraphs[0].runs[0].bold = True
    plan_tbl.rows[0].cells[i].paragraphs[0].runs[0].font.size = Pt(10)

plan_rows = [
    ("1 - Orientation and Codebase Review",
     "Week 1 (Feb)",
     "Project briefing, prototype code review, security findings documentation, GIS technology research, development environment setup"),
    ("2 - Research and Server Preparation",
     "Weeks 1-2 (Mar)",
     "PostGIS schema research, GeoJSON specification study, Fastify deep dive, server provisioning, full stack installation, repository setup"),
    ("3 - Security Hardening",
     "Week 3 (Mar)",
     "Dependency audit and CVE remediation, authentication system overhaul, credential removal, Git history rewrite, input sanitiser rewrite, site visit to Vungu RDC"),
    ("4 - API Refinement",
     "Week 4 (Mar)",
     "Public route improvements, development control module cleanup, land use module fixes, Docker configuration, architecture documentation"),
    ("5 - Deployment and Integration",
     "Week 1 (Apr)",
     "VM deployment exercise, Nginx configuration, UFW firewall setup, code review, spatial boundary validation innovation, end-to-end integration test"),
    ("6 - Testing and HTTPS",
     "Week 2 (Apr)",
     "Integration test suite with Jest/Supertest, HTTPS with Certbot, ZITF hackathon participation, load testing, final system demonstration to Vungu RDC"),
    ("7 - Notifications and Redis",
     "Weeks 3-4 (Apr)",
     "Email notification system, Redis rate limiting, CI/CD pipeline via GitHub Actions, Innovation Hub open exhibition"),
    ("8 - CI/CD and Monitoring",
     "Week 5 (Apr/May)",
     "Auto-deploy pipeline completion, branch protection, system health monitoring, code consistency review, Workers Day observation"),
    ("9 - Testing and Documentation",
     "Week 1 (May)",
     "Frontend integration testing, full performance benchmark, documentation update, second-phase planning meeting"),
]
for phase, weeks, activities in plan_rows:
    row = plan_tbl.add_row()
    row.cells[0].text = phase
    row.cells[1].text = weeks
    row.cells[2].text = activities
    for cell in row.cells:
        for para in cell.paragraphs:
            for run in para.runs:
                run.font.size = Pt(10)

doc.add_paragraph()

h("3.2  Links to Programme of Study", level=2)
body(
    "The work undertaken during this placement connects directly to several units in the Bachelor of "
    "Science Honours Degree in Computer Science at MSU. The security hardening work, including "
    "authentication implementation, dependency vulnerability remediation, and input sanitisation, draws "
    "on content from the Software Security module studied in second year. The PostGIS schema design and "
    "spatial query writing connect to the Advanced Databases module. The API design, HTTP status code "
    "handling, and RESTful architecture connect to the Web Systems and Distributed Computing modules. "
    "The server provisioning, process management, and firewall configuration connect to the Computer "
    "Networks and Operating Systems modules. The Git workflow, CI/CD pipeline, and documentation "
    "practices connect to the Software Engineering module. The GIS integration work, including WMS, "
    "WFS, and the PostGIS spatial data model, was entirely new territory beyond the programme curriculum "
    "and represents one of the most significant knowledge gains of the placement."
)

page_break()

# ═══════════════════════════════════════════════
# CHAPTER 4: WORK ACCOMPLISHED
# ═══════════════════════════════════════════════
h("CHAPTER 4: WORK ACCOMPLISHED")

h("4.1  System Analysis and Requirements Review", level=2)
body(
    "The placement began with a formal project orientation conducted by Dr Paradzayi. The project brief "
    "described a GIS-based Municipal Planning Information System covering 19 wards and five user tiers. "
    "On Day 2, the prototype codebase was reviewed systematically. Three categories of security defects "
    "were identified immediately: password storage implemented as a plaintext prefix rather than a hash "
    "function, database credentials hardcoded directly in source files, and missing input validation on "
    "public-facing endpoints. These findings were documented and presented to the supervisor, who "
    "confirmed that they needed to be addressed before any new features were built on top of the prototype."
)
body(
    "The remainder of the first week was spent on GIS technology research. PostGIS, the spatial "
    "extension for PostgreSQL, was entirely new. Understanding that geographic shapes such as polygons "
    "and points can be stored as typed columns in a relational database, indexed using a GiST spatial "
    "index, and queried with spatial predicates such as ST_Within and ST_Intersects required a shift in "
    "thinking from standard tabular data management. WMS (Web Map Service) and WFS (Web Feature Service) "
    "were studied as the OGC standards that govern how the Nginx and QGIS Server components in the "
    "architecture serve map tiles and vector data respectively. The technology stack was agreed upon: "
    "Node.js v22 LTS with Fastify, PostgreSQL 16 with PostGIS 3.4, QGIS Server for OGC services, Nginx "
    "as the reverse proxy, and Leaflet.js on the frontend."
)

h("4.2  Security Audit and Remediation", level=2)
body(
    "The security hardening sprint in Week 3 of March addressed all identified vulnerabilities "
    "systematically. The first task was a dependency audit using npm audit, which identified ten "
    "vulnerabilities including two rated critical, traced to abandoned or outdated packages. The "
    "abandoned xmldom package was replaced with its maintained fork, and transitive CVEs in "
    "node-pg-migrate were resolved by upgrading to a patched version. The audit was cleared to zero "
    "vulnerabilities before any other development work proceeded."
)
body(
    "The authentication system was rebuilt from the prototype implementation. The plaintext prefix "
    "approach was replaced with bcrypt hashing at cost factor 12. Session tokens were replaced with "
    "cryptographically signed JWTs generated using the jsonwebtoken library. A backdoor registration "
    "endpoint that bypassed role validation was removed. Token generation was switched from Math.random() "
    "to crypto.randomBytes(32), which is suitable for cryptographic use whereas Math.random() is not."
)
body(
    "Hardcoded database credentials were located in two source files and removed. Since these had been "
    "committed to the Git history, deleting them from current code was insufficient: the supervisor "
    "walked the student through using git filter-branch to rewrite the history and purge the commit "
    "entirely. The database password was rotated immediately across all environments after the history "
    "rewrite. The experience demonstrated a practical point that the software security module had covered "
    "theoretically: in a version-controlled codebase, the history is part of the attack surface."
)
body(
    "The input sanitiser was rewritten as a Fastify onRequest hook. The original implementation was "
    "incorrectly blocking legitimate requests containing ordinary SQL keywords such as SELECT and ORDER, "
    "which appear in normal text. The rewrite targeted only actual attack patterns including XSS vectors "
    "and path traversal sequences. The in-memory rate limiter was replaced with the @fastify/rate-limit "
    "plugin for consistency with the Fastify ecosystem."
)

h("4.3  Infrastructure Provisioning and DevOps", level=2)
body(
    "The Ubuntu 24.04 LTS virtual machine was provisioned during Week 2 of March. SSH hardening was "
    "applied immediately: password authentication was disabled in favour of key-based authentication, "
    "root login was disabled, and MaxAuthTries was set to 3. The full backend stack was installed in "
    "dependency order: Node.js v22 LTS, PostgreSQL 16 with PostGIS 3.4, Nginx 1.24, PM2 process "
    "manager, and Git. PM2 was new at this stage: running node app.js directly in a terminal stops the "
    "application when the session ends; PM2 supervises the process, restarts it on crash, and starts it "
    "automatically on server reboot."
)
body(
    "A shared team project directory was configured with chmod 2775 (setgid) permissions so that all "
    "new files created by either team member automatically inherit the shared group, preventing "
    "inaccessible files across team boundaries. Git repositories were initialised with a clean commit "
    "history produced using git rebase -i to ensure each commit represented one atomic change."
)
body(
    "Docker containerisation was completed in Week 4 of March. A docker-compose.yml file defined three "
    "services: database, API, and QGIS Server, with health check ordering so the API waits for "
    "PostgreSQL readiness before starting. A development-specific compose file added an anonymous "
    "node_modules volume to prevent Windows-compiled native binaries from being copied into the Linux "
    "container and causing incompatibility failures. The .env.example file was expanded from 9 to 50 "
    "documented lines covering every required environment variable with explanations."
)
body(
    "HTTPS was implemented in Week 2 of April using Certbot with Let's Encrypt. Nginx was configured to "
    "serve on port 443 with HSTS headers and to redirect all HTTP traffic to HTTPS automatically. "
    "Certificate auto-renewal was configured via a cron job because Let's Encrypt certificates expire "
    "after 90 days and a lapsed certificate causes browser security warnings without any other visible "
    "error. The GitHub Actions CI/CD pipeline was created in Week 4 of April, automating dependency "
    "auditing, integration testing, and deployment on every successful merge to the main branch."
)

h("4.4  Backend API Development", level=2)
body(
    "The backend API was developed progressively across the placement period, with each sprint building "
    "on the security and infrastructure foundation laid in the earlier weeks. Fastify's schema-based "
    "routing was used throughout: each endpoint is defined with a JSON Schema specifying the expected "
    "request body, query parameters, and response shape. This provides automatic request validation and "
    "faster JSON serialisation via pre-compiled serialisers, eliminating the need for manual validation "
    "code in route handlers."
)
body(
    "A personal contribution made during the Week 3 security sprint was the addition of an "
    "application_status_history table that records every status transition for every development "
    "application, including the application ID, the old status, the new status, the user ID of the "
    "officer who made the change, and a timestamp. This audit trail was absent from the original design "
    "and addresses an accountability requirement that would be essential for any dispute between an "
    "applicant and a planning officer. The supervisor approved the addition immediately when it was "
    "proposed."
)
body(
    "In Week 4 of March, the land use management module was refactored to correct a critical runtime "
    "error caused by attempting to reassign a const variable using the += operator, which does not "
    "appear during static analysis but throws a TypeError at runtime on any filtered query. Paginated "
    "queries across the module were parallelised using Promise.all, reducing response time on paginated "
    "endpoints by approximately 50 percent. A ward-level statistics endpoint was added in Week 4, "
    "returning application counts per ward broken down by status using a single aggregated SQL query, "
    "responding to a planning officer comment during the site visit that ward-level backlog visibility "
    "was a frequently needed view that they had previously been compiling manually."
)
body(
    "A spatial boundary validation check was implemented during Week 1 of April. On development "
    "application submission, a PostGIS ST_Within query verifies that the property coordinates submitted "
    "by the applicant actually fall within the ward boundary they have declared. Prior to this check, an "
    "applicant could file an application under the wrong ward without any automatic detection, creating "
    "data integrity problems in the planning records. The check adds negligible overhead to the "
    "submission handler and was approved for inclusion in the production build."
)
body(
    "An administrative CSV export endpoint was added in Week 2 of April, allowing administrators to "
    "download filtered reports of development applications by ward, status, and date range as a "
    "properly formatted CSV file with headers. The planning department had previously been producing "
    "these reports by asking the system administrator to run manual database queries. The endpoint "
    "accepts query parameters, builds a safe parameterised SQL query, and streams the result directly "
    "to the response, which introduced the student to Node.js streaming responses as a practical "
    "technique for large result sets."
)

h("4.5  GIS Integration", level=2)
body(
    "The GIS integration layer connects the Node.js API to QGIS Server for OGC-compliant map tile "
    "serving and to PostGIS for spatial data storage and querying. The architecture separates rendered "
    "tile requests, handled via WMS through Nginx to QGIS Server, from raw vector data requests, "
    "handled via WFS directly to PostGIS and serialised as GeoJSON by the API. This separation keeps "
    "map rendering and data access on distinct paths, which is both more performant and more maintainable "
    "than routing all spatial requests through a single channel."
)
body(
    "All ward boundaries, land parcel geometries, and application submission coordinates are stored as "
    "PostGIS geometry columns with SRID 4326 (WGS 84), which is the coordinate system used by GPS and "
    "by all major consumer mapping platforms. GiST spatial indexes are applied to all geometry columns "
    "to enable fast spatial queries without full table scans. The GeoJSON specification (RFC 7946) was "
    "studied in detail early in the placement because Leaflet.js expects GeoJSON FeatureCollection "
    "format and will fail silently with no error output if the format deviates from the specification."
)
body(
    "A representative staging dataset was loaded for the final demonstration: 19 ward polygons "
    "inserted using ST_GeomFromText with SRID 4326, 847 land parcel geometries, 34 sample development "
    "applications across all workflow states, and 5 user accounts covering all role tiers."
)

h("4.6  Testing and Quality Assurance", level=2)
body(
    "A comprehensive API integration test suite was written using Jest and Supertest in Week 2 of April. "
    "Integration tests differ from unit tests in that they fire real HTTP requests against a running "
    "server connected to a real database, testing the complete middleware chain rather than isolated "
    "functions. The test suite covered the health endpoint, user registration and login flows, public "
    "ward boundary responses, protected development control endpoints, and the ward statistics endpoint. "
    "During test writing, a previously undetected security gap was found: the /api/admin/users endpoint "
    "was missing its requireAuth middleware guard, making all user management data accessible without "
    "a valid login. The guard was added immediately and a regression test was written to prevent "
    "recurrence."
)
body(
    "Load testing was conducted using a staged profile at 10, 25, 50, and 100 concurrent virtual users. "
    "The /api/public/wards endpoint maintained a P95 response time below 200ms at all load levels. "
    "The development control endpoints maintained acceptable performance up to 50 concurrent users. "
    "No errors were recorded at any load level tested."
)
body(
    "The complete end-to-end integration test in Week 1 of April verified the full request chain: user "
    "registration, JWT issuance, authenticated API request, PostGIS spatial query execution, GeoJSON "
    "serialisation, and Leaflet map layer rendering. All stages passed. The frontend integration "
    "testing in Week 1 of May identified and fixed two remaining edge cases in the admin reporting "
    "dashboard and the public map zoom-level behaviour."
)

h("4.7  Email Notifications, Redis Rate Limiting, and CI/CD", level=2)
body(
    "The email notification system was implemented in Week 3 of April in response to the planning "
    "officers' request at the final demonstration for automated status change notifications. The system "
    "uses Nodemailer with connection pooling and sends responsive HTML email notifications on every "
    "status transition recorded in the application_status_history table. The notification service is "
    "wired into the status update handler so notifications fire without additional code at the point of "
    "status change."
)
body(
    "Redis-backed rate limiting was implemented in Week 4 of April, replacing the in-memory rate "
    "limiting used previously. The critical advantage of the Redis-backed approach is that rate limit "
    "state is maintained independently of the Node.js process: it survives application restarts and "
    "coordinates correctly across multiple instances if the service is scaled horizontally. Limits were "
    "tuned by endpoint type, with stricter limits on authentication endpoints and higher limits on "
    "public read endpoints."
)
body(
    "The GitHub Actions CI/CD pipeline was created during the same sprint. The pipeline triggers on "
    "push and pull request events to the main branch and runs: dependency audit, integration tests, "
    "coverage reporting, and a scan for accidentally committed environment files. A deployment stage "
    "was added in Week 5 of April that automatically updates the production server on successful merge, "
    "reducing the deployment process from a manual multi-step procedure to a fully automated event."
)

h("4.8  Stakeholder Engagement", level=2)
body(
    "A site visit to the Vungu RDC Department of Planning was conducted in Week 3 of March. Structured "
    "interviews with planning officers revealed that the 19-ward hierarchy is the fundamental organising "
    "principle of all council planning data, a detail entirely absent from the written project brief. "
    "The interviews also provided direct information about the development application lifecycle, "
    "inspection workflows, and the compliance requirements that officers apply daily. This visit "
    "directly shaped several subsequent development decisions, including the ward statistics endpoint "
    "and the spatial boundary validation check."
)
body(
    "The formal final demonstration was conducted in Week 2 of April to Dr Paradzayi and two Vungu "
    "RDC planning officers via video conference. All five user journeys were demonstrated successfully: "
    "public map browsing, application submission, planning officer review, spatial compliance checking, "
    "and administrative reporting. The planning officers gave positive feedback and requested email "
    "notifications as the priority enhancement, which was implemented in the following sprint."
)
body(
    "In Week 4 of April, the team participated in the MSU Innovation Hub open exhibition, demonstrating "
    "the live system to university management, faculty representatives, and external guests. Interest "
    "from the Faculty of Built Environment in extending the system to additional rural district councils "
    "was noted. This was an institute-wide event bringing together projects from multiple disciplines "
    "including chemical technology, engineering, and information technology."
)
body(
    "Workers Day, a public holiday in Zimbabwe, was observed on 1 May 2026. The MSU campus and "
    "Innovation Hub were closed for the day."
)
body(
    "Participation in the ZITF 2026 Innovation Hackathon was undertaken in parallel during Week 2 of "
    "April. The team developed the APEX NEXUS financial services architecture covering five modules "
    "designed around the ZB SmileCash API, and submitted all materials ahead of the competition "
    "deadline."
)

page_break()

# ═══════════════════════════════════════════════
# CHAPTER 5: SUMMARY, CONCLUSIONS, RECOMMENDATIONS
# ═══════════════════════════════════════════════
h("CHAPTER 5: SUMMARY, CONCLUSIONS, AND RECOMMENDATIONS")

h("5.1  Summary of Activities Carried Out", level=2)
body("Over the eleven weeks covered by this report, the following key activities were completed:")
for item in [
    "Project orientation and prototype codebase security review at the MSU Research and Innovation Hub.",
    "GIS technology research covering PostGIS, GeoJSON, WMS, WFS, QGIS Server, and Leaflet.js.",
    "Production server provisioning on Ubuntu 24.04 LTS including SSH hardening, full stack installation, and deployment verification.",
    "Dependency audit clearing ten vulnerabilities including two critical CVEs.",
    "Complete authentication system rebuild using bcrypt, signed JWTs, and crypto.randomBytes.",
    "Removal of hardcoded database credentials and full Git history rewrite to purge the commit containing them.",
    "Input sanitiser rewrite targeting only genuine attack patterns.",
    "PostGIS spatial database schema design and GiST index configuration.",
    "RESTful API development using Fastify with schema-based request validation across all endpoints.",
    "Personal innovation: application status history audit trail added to the production schema.",
    "Personal innovation: ward-level application statistics endpoint derived from planning officer feedback.",
    "Personal innovation: PostGIS ST_Within spatial boundary validation on development application submission.",
    "Personal innovation: administrative CSV export endpoint for filtered application reports.",
    "Docker containerisation with three-service compose configuration and health check ordering.",
    "Full architecture documentation including BACKEND_GUIDE.md and Mermaid architecture diagrams.",
    "Site visit to Vungu RDC Department of Planning with structured user interviews.",
    "VM deployment exercise confirming independent deployment capability.",
    "API integration test suite written with Jest and Supertest covering 15+ test cases.",
    "HTTPS implementation using Certbot and Let's Encrypt with HSTS and auto-renewal.",
    "Formal final system demonstration to Vungu RDC planning officers, approved as demonstration-ready.",
    "Participation in the MSU Innovation Hub open exhibition and the ZITF 2026 Innovation Hackathon.",
    "Email notification system implementation using Nodemailer.",
    "Redis-backed distributed rate limiting replacing in-memory rate limiting.",
    "GitHub Actions CI/CD pipeline with automated testing and auto-deploy on merge.",
    "Full performance benchmark across all major endpoints at four load levels.",
    "Workers Day public holiday observation on 1 May 2026.",
    "Second-phase work plan agreed with supervisor, covering document management module, mobile responsiveness, and spatial performance optimisation.",
]:
    bullet(item)

h("5.2  Problems Encountered", level=2)
body(
    "The most significant technical challenge of the placement was the security state of the prototype "
    "codebase. The combination of insecure password storage, hardcoded credentials, missing input "
    "validation, and a backdoor registration endpoint meant that a full week had to be dedicated to "
    "remediation before any new functionality could be built safely. While the supervisor confirmed this "
    "was expected and planned, it demonstrated how much accumulated technical debt can exist in a "
    "codebase that has not been built with security as a primary concern from the start."
)
body(
    "The Git history rewrite required to remove the hardcoded password commit was a stressful procedure "
    "because it changes the commit hashes of all subsequent commits, requiring all team members to "
    "force-pull the rewritten history. Had this been a larger team with active feature branches, the "
    "coordination cost would have been significantly higher. The experience reinforced the importance "
    "of never committing credentials in the first place rather than relying on the ability to clean "
    "up afterward."
)
body(
    "Silent failure modes in the GIS layer were consistently difficult to debug. Both the GeoJSON "
    "format deviation and the bounding box coordinate type error caused the map to render incorrectly "
    "without any error output from the client-side library. Establishing the habit of validating "
    "response schemas explicitly before relying on visual map output was the correct solution but took "
    "time to recognise as the right approach."
)
body(
    "Server credential delays in February meant that initial research weeks could not be accompanied "
    "by hands-on server work. This was managed by using the research time productively, but the "
    "planning of future projects should account for provisioning lead times more explicitly in the "
    "initial schedule."
)

h("5.3  Recommendations", level=2)
body("Based on the experience gained during this placement, the following recommendations are offered:")
for rec in [
    "Prototype codebases used as the starting point for student attachment projects should undergo a "
    "minimum security review before handover, covering password storage, credential handling, and "
    "input validation. Discovering these issues at the start of an attachment delays productive work "
    "and adds pressure to the student to fix problems they did not create.",
    "A structured onboarding document covering the current project state, what has been built, what "
    "has been tried, what has not worked, and what the next priorities are would significantly reduce "
    "the orientation time at the start of a placement.",
    "Future placements on GIS system projects should include an introductory session on PostGIS, "
    "OGC standards, and spatial indexing before the student begins database design work. GIS is not "
    "covered in the current Computer Science curriculum and the self-directed learning required is "
    "substantial.",
    "The habit of writing integration tests for every new endpoint before moving to the next feature "
    "should be established as a team norm from the start of the project. The missing authentication "
    "guard on the admin user endpoint was only discovered because of the integration test suite, and "
    "it could have been a serious data exposure in production.",
    "Redis for rate limiting and background job queues should be included in the standard MSU project "
    "stack for web systems attachments, as in-memory rate limiting is inadequate for any production "
    "system and the upgrade is straightforward once Redis is installed.",
]:
    bullet(rec)

page_break()

# ═══════════════════════════════════════════════
# REFERENCES
# ═══════════════════════════════════════════════
h("REFERENCES")
refs = [
    "Beck, K. et al. (2001). Manifesto for Agile Software Development. [online] Available at: https://agilemanifesto.org [Accessed May 2026].",
    "Fielding, R.T. (2000). Architectural Styles and the Design of Network-based Software Architectures. PhD Dissertation. University of California, Irvine.",
    "Government of Zimbabwe (2018). Education 5.0 Policy Framework. Ministry of Higher and Tertiary Education, Innovation, Science and Technology Development. Harare: Government Printer.",
    "Internet Engineering Task Force (2016). RFC 7946: The GeoJSON Format. IETF.",
    "Krawczyk, H., Canetti, R. and Bellare, M. (1997). HMAC: Keyed-Hashing for Message Authentication. IETF RFC 2104.",
    "Let's Encrypt (2024). Let's Encrypt Certificate Lifecycle and Renewal. Available at: https://letsencrypt.org/docs [Accessed May 2026].",
    "MSU Research and Innovation Hub (2025). Hub Profile and Services Overview. Gweru: Midlands State University.",
    "OWASP Foundation (2021). OWASP Top Ten Web Application Security Risks. Available at: https://owasp.org/www-project-top-ten [Accessed May 2026].",
    "PostgreSQL Global Development Group (2024). PostgreSQL 16 Documentation. Available at: https://www.postgresql.org/docs/16 [Accessed May 2026].",
    "PostGIS Development Group (2024). PostGIS 3.4 Documentation. Available at: https://postgis.net/docs [Accessed May 2026].",
    "Provos, N. and Mazieres, D. (1999). A Future-Adaptable Password Scheme. Proceedings of the 1999 USENIX Annual Technical Conference, pp. 81-91.",
    "QGIS Development Team (2024). QGIS Server Documentation. Available at: https://docs.qgis.org [Accessed May 2026].",
    "Ristic, I. (2021). OpenSSL Cookbook: A Guide to the Most Frequently Used OpenSSL Features and Commands. 3rd ed. Feisty Duck.",
    "Standards Association of Zimbabwe (2020). SAZ 229: Specification for Water Treatment Chemicals. Harare: SAZ.",
    "Urban and Regional Planners Institute of Zimbabwe (2021). Guidelines for Digital Planning Management Systems in Local Authorities. Harare: URPIZ.",
]
for ref in refs:
    p = doc.add_paragraph()
    run = p.add_run(ref)
    run.font.size = Pt(10)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.left_indent = Inches(0.3)
    p.paragraph_format.first_line_indent = Inches(-0.3)

doc.save(OUT)
print(f"Saved: {OUT}")
