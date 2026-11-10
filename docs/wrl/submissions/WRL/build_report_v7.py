"""
Munyaradzi Namailinga WRL report — same format as Theophelos Madzinga.
No coloured cells. Simple language. Hub support + Vungu backend work.
"""
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
import shutil

OUT = r"c:\Users\munya\Desktop\finale\WRL 2\WRL\Munyaradzi_Namailinga_WRL_Preliminary_Report_R243100H_v7.docx"
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
    run.font.name = "Times New Roman"
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    return p


def body(text, size=10, after=4):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(size)
    run.font.name = "Times New Roman"
    p.paragraph_format.space_after = Pt(after)
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    return p


def numbered(items, size=10):
    for i, item in enumerate(items, 1):
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Inches(0.5)
        p.paragraph_format.first_line_indent = Inches(-0.3)
        p.paragraph_format.space_after = Pt(2)
        run = p.add_run(f"{i}.  {item}")
        run.font.size = Pt(size)
        run.font.name = "Times New Roman"


def h(text, level=1):
    sizes = {1: 12, 2: 11, 3: 10}
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(sizes.get(level, 10))
    run.font.name = "Times New Roman"
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(3)
    return p


def page_break():
    doc.add_page_break()


def add_info_table(rows):
    tbl = doc.add_table(rows=len(rows), cols=2)
    tbl.style = "Table Grid"
    for i, (label, value) in enumerate(rows):
        tbl.rows[i].cells[0].text = label
        tbl.rows[i].cells[1].text = value
        for cell in tbl.rows[i].cells:
            for para in cell.paragraphs:
                for run in para.runs:
                    run.font.size = Pt(10)
                    run.font.name = "Times New Roman"
        tbl.rows[i].cells[0].paragraphs[0].runs[0].bold = True
    doc.add_paragraph()


def add_grid(headers, rows):
    tbl = doc.add_table(rows=1 + len(rows), cols=len(headers))
    tbl.style = "Table Grid"
    for i, header in enumerate(headers):
        tbl.rows[0].cells[i].text = header
        for run in tbl.rows[0].cells[i].paragraphs[0].runs:
            run.bold = True
            run.font.size = Pt(10)
            run.font.name = "Times New Roman"
    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            tbl.rows[ri + 1].cells[ci].text = str(val)
            for run in tbl.rows[ri + 1].cells[ci].paragraphs[0].runs:
                run.font.size = Pt(9)
                run.font.name = "Times New Roman"
    doc.add_paragraph()


# COVER
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

add_info_table([
    ("Student Name", "Munyaradzi Namailinga"),
    ("Student ID", "R243100H"),
    ("Programme", "Bachelor of Science Honours Degree in Computer Science"),
    ("Level", "3.1"),
    ("Organisation", "MSU Research and Innovation Hub / Vungu RDC GIS Project"),
    ("Supervisor", "Dr Paradzayi, Project Manager"),
    ("WRL Period", "23 February 2026 to 18 October 2026"),
    ("Report Date", "October 2026"),
])
page_break()

h("ABSTRACT")
body(
    "This preliminary work-related learning (WRL) report covers work done by Munyaradzi "
    "Namailinga (Student ID: R243100H), a Level 3.1 Computer Science student at Midlands "
    "State University. The placement was at the MSU Research and Innovation Hub on the "
    "Vungu Rural District Council GIS project (also called SpartialIQ). The period is "
    "23 February 2026 to 18 October 2026."
)
body(
    "My main role was backend and database work: the API, PostgreSQL with PostGIS, "
    "security fixes, tests, statutory registers, and a Windows installer for local demos. "
    "Theophelos Madzinga worked on the screens and map. We both report to Dr Paradzayi at the Hub."
)
body(
    "The first phase (February to mid-April) covered orientation, security clean-up, server "
    "setup, API work, a site visit to Vungu RDC, and a formal demo. The second phase "
    "(mid-April to May) covered Handbook study, database design, normal form checks, and "
    "short research notes. The third phase (June to October) covered login fixes, deploy "
    "checks, council registers, the Acua sub-plot layer, and the desktop installer."
)
body(
    "Besides coding I also did Hub support work. This included printer fixing, helping at "
    "workshops and presentations, and support at expos and pitching days. Those tasks are "
    "part of real Hub life and they are included in this report."
)
body(
    "Keywords: Work-Related Learning, Computer Science, GIS, Backend Development, PostGIS, "
    "Vungu RDC, MSU Innovation Hub, Workshops, Expos, Zimbabwe."
)
page_break()

h("ACKNOWLEDGEMENTS")
body(
    "This placement and this report would not have been possible without help from several people."
)
body(
    "Thanks go to Dr Paradzayi, Project Manager for the Vungu RDC GIS project, for clear "
    "supervision and for checking that what we claim matches what is in the code."
)
body(
    "Thanks also go to Rafiq for research feedback, to Theophelos for daily work on the "
    "frontend and map, and to Hub staff who let me help with printers, workshops and expos."
)
body(
    "I also thank the Department of Computer Science at Midlands State University for the "
    "WRL programme, and my family for support during the attachment."
)
page_break()

h("TABLE OF CONTENTS")
for item in [
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
    "   4.1  Orientation, Security and Server Setup",
    "   4.2  API Work, Site Visit and System Demo",
    "   4.3  Handbook Study and Database Design",
    "   4.4  Registers, Installer and Production Prep",
    "   4.5  Workshops, Expos, Presentations and Hub Support",
    "   4.6  Things I Learnt",
    "CHAPTER 5: SUMMARY, CONCLUSIONS, AND RECOMMENDATIONS",
    "   5.1  Summary of Activities Carried Out",
    "   5.2  Problems Encountered",
    "   5.3  Recommendations",
    "References",
]:
    p = doc.add_paragraph()
    run = p.add_run(item)
    run.font.size = Pt(10)
    run.font.name = "Times New Roman"
page_break()

h("LIST OF ABBREVIATIONS")
add_grid(
    ["Abbreviation", "Meaning"],
    [
        ["API", "Application Programming Interface"],
        ["DCM", "Development Control Matrix"],
        ["GIS", "Geographic Information System"],
        ["JWT", "JSON Web Token"],
        ["MSU", "Midlands State University"],
        ["PostGIS", "Spatial database extension for PostgreSQL"],
        ["RDC", "Rural District Council"],
        ["SQL", "Structured Query Language"],
        ["WRL", "Work-Related Learning"],
        ["ZITF", "Zimbabwe International Trade Fair"],
    ],
)
page_break()

h("CHAPTER 1: INTRODUCTION")
h("1.1  Background", 2)
body(
    "Work-Related Learning at Midlands State University places Computer Science students in "
    "real work places for a full attachment period. The idea is to use class knowledge on a "
    "live project with real deadlines and real users."
)
body(
    "This report covers my placement at the MSU Research and Innovation Hub. The main project "
    "is a GIS planning system for Vungu Rural District Council. Before this project the council "
    "handled many planning tasks on paper. The Hub hosts the student team and the supervisor."
)

h("1.2  Purpose of the Placement", 2)
body(
    "The academic purpose is to meet the WRL requirement for the BSc Honours in Computer "
    "Science. The professional purpose is to learn how backend systems, databases and Hub "
    "support work are done in practice. The practical purpose is to help deliver a usable "
    "system for Vungu RDC under Hub supervision."
)

h("1.3  Objectives of the Placement", 3)
numbered([
    "Apply database and software skills from class to a live GIS system.",
    "Fix security problems in the old prototype before new features.",
    "Build and maintain the backend API used by the frontend.",
    "Turn Handbook and council register needs into database tables and APIs.",
    "Write simple tests and deploy checks before demos.",
    "Take part in Hub workshops, presentations, expos and day-to-day support.",
    "Reflect on what I learnt for both project work and Hub service work.",
])

h("1.4  Scope of Work", 2)
body(
    "In scope: backend API, database design, security fixes, tests, statutory registers, "
    "desktop installer support, and Hub support tasks such as printers, workshops and expos. "
    "Out of scope as main owner: full frontend UI (Theophelos), Vungu internal networks, and "
    "real Property File data until the council supplies it."
)

h("1.5  Significance of the Work", 2)
body(
    "For the council the work moves permit and stand information toward a digital system. "
    "For the Hub it leaves tested APIs, register screens, an installer and restore notes. "
    "For me it linked class modules to real product work and real support work."
)
page_break()

h("CHAPTER 2: DESCRIPTION OF THE WRL ORGANISATION")
h("2.1  Overview of Midlands State University", 2)
body(
    "Midlands State University is a public university in Gweru. It runs teaching, research "
    "and innovation under Education 5.0. The Faculty of Information Science and Technology "
    "houses the Department of Computer Science, which places students on WRL attachments."
)

h("2.2  The MSU Research and Innovation Hub", 2)
body(
    "The Research and Innovation Hub is on the Senga Road campus. It hosts student and staff "
    "projects. Supervisors run weekly reviews. The Hub also runs workshops, pitching days and "
    "expos. Students are expected to help with those events, not only sit on one project."
)

h("2.3  The Vungu RDC GIS Project", 2)
body(
    "Vungu Rural District Council is the client. The project builds a web map and permit "
    "system using PostgreSQL with PostGIS, a Node.js Fastify API, and a Vue map portal. "
    "In the repositories the product is called SpartialIQ. My day-to-day organisation for "
    "WRL is the Hub. Vungu is the council we build for."
)

h("2.4  Organisational Structure", 2)
add_grid(
    ["Role", "Person", "Responsibility"],
    [
        ["Project Manager", "Dr Paradzayi", "Direction, reviews, client link"],
        ["Research support", "Rafiq", "Research briefs and document checks"],
        ["Backend / database", "Munyaradzi Namailinga", "API, database, tests, installer"],
        ["Frontend / map", "Theophelos Madzinga", "Portal screens and map"],
        ["Client", "Vungu RDC Planning", "Needs and demo feedback"],
    ],
)
page_break()

h("CHAPTER 3: WORK PLAN")
h("3.1  Planned Activities", 2)
body(
    "The work plan was agreed with Dr Paradzayi. Early phases put security before new "
    "features. Later phases closed council register gaps and prepared local demos."
)
add_grid(
    ["Phase", "Period", "Main work"],
    [
        ["1 Orientation and security", "Feb–Mar 2026", "Onboarding, CVE clean-up, server setup"],
        ["2 API, visit and demo", "Mar–Apr 2026", "Routes, site visit, council demo"],
        ["3 Handbook and database", "Apr–May 2026", "Tables, 3NF, DCM, research notes"],
        ["4 Hardening and registers", "Jun–Oct 2026", "Login fix, registers, installer, Acua"],
        ["5 Hub service work", "All period", "Printers, workshops, expos, presentations"],
    ],
)

h("3.2  Links to Programme of Study", 2)
add_grid(
    ["Work done", "Module link", "What I used"],
    [
        ["Password and security fixes", "Software Security", "Hashing, secret handling"],
        ["Tables and PostGIS", "Advanced Databases", "Keys, normal form, SQL"],
        ["Fastify API routes", "Web Systems", "REST and JSON"],
        ["Docker and server basics", "Networks / OS", "Linux services and ports"],
        ["Tests and installer checks", "Software Engineering", "Test before demo"],
        ["Handbook to tables", "Systems Analysis", "Turn rules into fields"],
    ],
)
page_break()

h("CHAPTER 4: WORK ACCOMPLISHED")
h("4.1  Orientation, Security and Server Setup", 2)
body(
    "The placement began with Hub orientation and a review of the old prototype. Passwords "
    "were weak and secrets were in the code. Those issues were fixed before major new "
    "features. PostgreSQL with PostGIS and the API stack were set up for team use."
)

h("4.2  API Work, Site Visit and System Demo", 2)
body(
    "I built and fixed API routes for wards, applications and later stand identify. In March "
    "we visited Vungu planning offices and listened to how officers work on paper. In April "
    "we gave a formal demo. Officers accepted the demo and asked for clearer stand status "
    "and register support."
)

h("4.3  Handbook Study and Database Design", 2)
body(
    "From mid-April I studied the Development Management Handbook and compared it to our "
    "tables. Missing tables were designed and checked in simple 3NF steps. The Development "
    "Control Matrix spreadsheet was turned into proper database tables. Short research notes "
    "on SQL versus NoSQL and document verification were written for Hub review."
)

h("4.4  Registers, Installer and Production Prep", 2)
body(
    "From June to October the focus moved to production readiness. Staff login was fixed "
    "after tenancy changes. A deploy check script was written. Statutory registers were "
    "added for by-laws, annual district plan, compulsory acquisition, rates clearance and "
    "expense recovery. Acua sub-plots of about 300 square metres were added under parent "
    "stands. A Windows installer for SpartialIQ Local was built for Hub demos."
)

h("4.5  Workshops, Expos, Presentations and Hub Support", 2)
body(
    "Like other Hub students, I did service work around the main project. This section "
    "records that work because it was a real part of the attachment."
)
add_grid(
    ["Activity", "When", "What I did", "What I learnt"],
    [
        ["Hub orientation workshop", "Feb 2026", "Attended Hub rules talk", "How Hub students are expected to work"],
        ["ICT / printer workshop", "Mar 2026", "Drivers and print queues", "Common Windows printer faults"],
        ["Git workshop", "Mar 2026", "Branches and pull requests", "Safer team Git habits"],
        ["ZITF stand support", "Apr 2026", "Power, charging, badge printer", "Events fail on power and printers"],
        ["Vungu council demo", "Apr 2026", "Presented with the team", "Listen and write feedback"],
        ["Report writing workshop", "Apr 2026", "Plain English writing", "Simple words are clearer"],
        ["Support expo help", "Jun–Sep 2026", "Stand prep and visitor help", "Expo checklists"],
        ["Pitching afternoon support", "Aug 2026", "Timer, clicker, spare laptop", "Support roles matter"],
        ["MSU Expo packing", "Sep 2026", "Banners, power, handouts", "Pack and test the day before"],
        ["Hub review presentations", "Monthly", "Progress talks on SpartialIQ", "Short demos beat long talks"],
        ["Postgres backup workshop", "Jul 2026", "Dump and restore practice", "Restore before you need it"],
        ["Day-to-day printer fixes", "All period", "Jams, drivers, duplex, toner", "Support is part of Hub work"],
    ],
)

h("4.6  Things I Learnt", 2)
h("Technical skills", 3)
numbered([
    "Building and fixing a Fastify API against a PostGIS database.",
    "Reading a handbook and turning it into tables and screens.",
    "Writing simple automated checks before a demo.",
    "Making a Windows installer for Hub use.",
    "Restoring a database after a laptop or disk failure.",
])
h("Support and soft skills", 3)
numbered([
    "Fixing printers and explaining the fix in plain words.",
    "Helping at workshops and expos without being the main speaker.",
    "Presenting progress clearly to Dr Paradzayi.",
    "Working daily with Theophelos so API and UI stay matched.",
    "Balancing support tickets and project work on the same day.",
])
page_break()

h("CHAPTER 5: SUMMARY, CONCLUSIONS, AND RECOMMENDATIONS")
h("5.1  Summary of Activities Carried Out", 2)
add_grid(
    ["No.", "Activity", "Status"],
    [
        ["1", "Orientation and prototype security review", "Complete"],
        ["2", "Server and PostGIS setup", "Complete"],
        ["3", "API development and stand identify", "Complete"],
        ["4", "Vungu site visit and formal demo", "Complete"],
        ["5", "Handbook study and database design", "Complete"],
        ["6", "Statutory registers and rates clearance", "Complete"],
        ["7", "Deploy checks, installer, Acua layer", "Complete"],
        ["8", "Hub workshops, expos, presentations, printer support", "Complete"],
    ],
)

h("5.2  Problems Encountered", 2)
add_grid(
    ["Problem", "What happened", "What I learnt"],
    [
        ["Weak old security", "Passwords and secrets were unsafe", "Fix security before new features"],
        ["Login broke after tenancy change", "Staff could not sign in", "Ship schema and auth together"],
        ["Handbook hard to read", "Legal wording was heavy", "Break it into actors and data"],
        ["Disk full in October", "Database stopped", "Keep disk space and restore notes"],
        ["Printer before a review", "Meeting room printer offline", "Fix early on review day"],
        ["Docs ahead of code", "Registers claimed too early", "Only mark done when tests pass"],
    ],
)

h("5.3  Recommendations", 2)
numbered([
    "Keep a printer and expo checklist for Hub presentation days.",
    "Do not claim a use case until the deploy check passes.",
    "Give new students the Handbook and a short PostGIS starter in week one.",
    "Keep the Windows installer and restore notes up to date.",
    "Count Hub support work clearly in the logbook, because it is real learning.",
    "Keep joint reviews where backend and frontend students present together.",
])
body(
    "In conclusion, the attachment at the MSU Research and Innovation Hub mixed real product "
    "work on the Vungu GIS system with normal Hub support. That mix is what made the placement "
    "feel real. I used Computer Science modules every week, and I also learnt calm support, "
    "simple talking, and honest demos."
)
page_break()

h("REFERENCES")
refs = [
    "Government of Zimbabwe (2021). Development Management (Control) Handbook. Ministry of Local Government and Public Works.",
    "Government of Zimbabwe. Rural District Councils Act, Chapter 29:13.",
    "Midlands State University Research and Innovation Hub (2026). Student project guidance notes. Gweru: MSU.",
    "PostGIS Development Group (2024). PostGIS documentation. Available at: https://postgis.net/docs",
    "OWASP Foundation (2021). OWASP Top Ten.",
]
for ref in refs:
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.3)
    p.paragraph_format.first_line_indent = Inches(-0.3)
    p.paragraph_format.space_after = Pt(4)
    run = p.add_run(ref)
    run.font.size = Pt(10)
    run.font.name = "Times New Roman"

doc.save(OUT)
for dest in [
    r"c:\Users\munya\Desktop\finale\WRL 2\Munyaradzi_Namailinga_WRL_Preliminary_Report_R243100H_v7.docx",
    r"c:\Users\munya\Desktop\Munyaradzi_Namailinga_WRL_Preliminary_Report_R243100H_v7.docx",
]:
    try:
        shutil.copy2(OUT, dest)
        print("Copied:", dest)
    except Exception as e:
        print("Copy skipped", dest, e)
print("Saved:", OUT)
