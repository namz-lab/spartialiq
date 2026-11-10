"""Munyaradzi Namailinga WRL report — plain Neil/Ogo style, no colours."""
from docx import Document
from docx.shared import Pt, Cm, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
import shutil

doc = Document()
for sec in doc.sections:
    sec.top_margin = Cm(2.54)
    sec.bottom_margin = Cm(2.54)
    sec.left_margin = Cm(3.0)
    sec.right_margin = Cm(2.54)

def sf(run, size=12, bold=False, italic=False):
    run.font.name = "Times New Roman"
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic

def center(text, size=12, bold=False, sb=0, sa=4):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(sb)
    p.paragraph_format.space_after = Pt(sa)
    r = p.add_run(text)
    sf(r, size=size, bold=bold)

def body(text, indent=True):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    p.paragraph_format.space_after = Pt(6)
    if indent:
        p.paragraph_format.first_line_indent = Pt(18)
    r = p.add_run(text)
    sf(r, size=12)
    return p

def heading(text, size=14):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run(text)
    sf(r, size=size, bold=True)

def sub(text):
    heading(text, size=12)

def bullet(text):
    p = doc.add_paragraph(style="List Bullet")
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    r = p.add_run(text)
    sf(r, size=12)

def plain_table(headers, rows):
    t = doc.add_table(rows=1 + len(rows), cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(headers):
        c = t.rows[0].cells[i]
        c.text = ""
        p = c.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(h)
        sf(r, size=11, bold=True)
    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            c = t.rows[ri + 1].cells[ci]
            c.text = ""
            p = c.paragraphs[0]
            r = p.add_run(str(val))
            sf(r, size=10)
    doc.add_paragraph()

def pb():
    doc.add_page_break()

# ── COVER ────────────────────────────────────────────────────────────────────
center("MIDLANDS STATE UNIVERSITY", 16, True, sa=2)
center("FACULTY OF SCIENCE AND TECHNOLOGY", 13, True, sa=2)
center("DEPARTMENT OF COMPUTER SCIENCE", 13, True, sa=16)
center("WORK RELATED LEARNING REPORT", 16, True, sa=8)
center("Placement at the Midlands State University", 12, sa=2)
center("Research and Innovation Hub", 13, True, sa=2)
center("Vungu Rural District Council GIS Project (SpartialIQ)", 12, True, sa=16)
center("Munyaradzi Namailinga", 12, True, sa=2)
center("R243100H", 12, sa=2)
center("BSc Honours Degree in Computer Science — Level 3.1", 11, sa=2)
center("Period: 23 February 2026 to 18 October 2026", 11, sa=2)
center("Supervisor: Dr Paradzayi", 11, sa=20)

plain_table(
    ["Detail", "Information"],
    [
        ["Student name", "Munyaradzi Namailinga"],
        ["Registration number", "R243100H"],
        ["Programme", "BSc Honours Degree in Computer Science"],
        ["Level", "3.1"],
        ["Host organisation", "MSU Research and Innovation Hub"],
        ["Main project", "Vungu RDC GIS / SpartialIQ planning system"],
        ["Industrial supervisor", "Dr Paradzayi"],
        ["Report date", "October 2026"],
    ],
)
pb()

# ── ABSTRACT ─────────────────────────────────────────────────────────────────
heading("ABSTRACT")
body("This report covers my Work Related Learning at the Midlands State University Research and Innovation Hub in Gweru from 23 February 2026 to 18 October 2026. My main project was the Vungu Rural District Council GIS planning system, also called SpartialIQ. I worked on the backend, the database, testing, and helping to package a Windows installer.")
body("I also did normal Hub support work. This included printer fixing, helping at workshops and presentations, and supporting expos and pitching days. Those small jobs taught me as much about real work as the coding did.")
body("The report explains the Hub, what I expected, what I actually did, how the work links to my Computer Science degree, what I learnt, and what I recommend for the next student.")
body("Keywords: Work Related Learning, MSU Innovation Hub, Vungu RDC, GIS, SpartialIQ, printers, workshops, expos.", indent=False)
pb()

# ── ACKNOWLEDGEMENTS ─────────────────────────────────────────────────────────
heading("ACKNOWLEDGEMENTS")
body("I thank Dr Paradzayi for guiding the Vungu project and for checking that our work matched what we claimed. I thank Rafiq for research feedback. I thank Theophelos for working with me on the frontend and map. I thank Hub staff who let me help with printers, workshops and expos. I also thank the Department of Computer Science at MSU for the WRL programme, and my family for support.")
pb()

# ── TOC (simple) ─────────────────────────────────────────────────────────────
heading("TABLE OF CONTENTS")
for line in [
    "1. Introduction",
    "2. The host organisation",
    "3. Expectations versus reality",
    "4. Work done and link to my degree",
    "5. Workshops, expos, presentations and support work",
    "6. Things I learnt",
    "7. Problems I faced",
    "8. Conclusion and recommendations",
    "References",
]:
    p = doc.add_paragraph()
    r = p.add_run(line)
    sf(r, size=12)
pb()

# ── 1 ────────────────────────────────────────────────────────────────────────
heading("1. INTRODUCTION")
body("Work Related Learning puts class work into a real place with real deadlines. My placement was at the MSU Research and Innovation Hub. The Hub hosts student and staff projects under Education 5.0. My assigned project was a web GIS system for Vungu Rural District Council so planning and stand information can move off paper.")
body("This report is written in simple language. It covers the organisation, my work on SpartialIQ, Hub support tasks (printers, workshops, expos), and what I learnt.")

# ── 2 ────────────────────────────────────────────────────────────────────────
heading("2. THE HOST ORGANISATION")
sub("2.1 Midlands State University Research and Innovation Hub")
body("The Research and Innovation Hub is on the Senga Road campus in Gweru. It is part of MSU. Students work there on software, research and innovation projects. Supervisors like Dr Paradzayi run project reviews. The Hub also runs workshops, pitching days and expos where visitors see student work.")
body("My day-to-day organisation for WRL is the Hub. Vungu RDC is the client for the GIS project. So I report to Hub supervision, but the product is for the council.")

sub("2.2 The Vungu GIS / SpartialIQ project")
body("Vungu Rural District Council looks after land and development permits in its wards. The project builds a map and permit system using PostgreSQL with PostGIS, a Node.js Fastify API, and a Vue map portal. I mainly worked on the API, database, tests, registers, and the local Windows installer. Theophelos worked on the screens and map UI.")

plain_table(
    ["Role", "Person", "What they do"],
    [
        ["Project manager", "Dr Paradzayi", "Direction, reviews, client link"],
        ["Research support", "Rafiq", "Research briefs and document checks"],
        ["Backend / database", "Munyaradzi Namailinga", "API, database, tests, installer"],
        ["Frontend / map", "Theophelos", "Portal screens and map"],
        ["Client", "Vungu RDC Planning", "Needs and demo feedback"],
    ],
)

# ── 3 ────────────────────────────────────────────────────────────────────────
heading("3. EXPECTATIONS VERSUS REALITY")
body("Before I started I expected to code every day on one system. That was only part of the truth.")
plain_table(
    ["What I expected", "What actually happened"],
    [
        ["Only write project code", "Also fixed printers, helped workshops and expos"],
        ["Finish features quickly", "Security and login fixes came first"],
        ["Docs are optional", "Dr Paradzayi checks that claims match the code"],
        ["Work alone on backend", "Daily sync with Theophelos on APIs and map"],
        ["Class SQL is enough", "Needed PostGIS, restores, and real stand data"],
        ["Demos are just slides", "Demos need power, printer, Wi-Fi and a script"],
    ],
)
body("Like other Hub students, I learnt that support work and presentation days are part of the job. Neil’s logbook style of listing support tickets and printer jobs matches what I also did at the Hub, even though my main project was GIS.")

# ── 4 ────────────────────────────────────────────────────────────────────────
heading("4. WORK DONE AND LINK TO MY DEGREE")
sub("4.1 Main project tasks")
bullet("Checked the old code for security problems and fixed weak password storage.")
bullet("Set up server pieces: PostgreSQL/PostGIS, API, reverse proxy.")
bullet("Built and fixed API routes for stands, parcels, applications and later registers.")
bullet("Studied the Development Management Handbook and improved the database design.")
bullet("Normalised the development control matrix from a spreadsheet into proper tables.")
bullet("Wrote deploy checks and button tests so demos do not break quietly.")
bullet("Added statutory registers (by-laws, district plan, rates clearance, and related registers).")
bullet("Added Acua ~300 m² sub-plots on the map and a Windows installer for local demos.")

sub("4.2 How this links to Computer Science modules")
plain_table(
    ["Work I did", "Module link", "What I used from class"],
    [
        ["Password and security fixes", "Software Security", "Hashing, not storing plain passwords"],
        ["Tables, 3NF, PostGIS", "Advanced Databases", "Keys, normal form, SQL"],
        ["Fastify API routes", "Web Systems", "REST, JSON, HTTP"],
        ["Docker / server basics", "Networks / OS", "Linux, services, ports"],
        ["Tests and installer checks", "Software Engineering", "Test before demo"],
        ["Handbook to tables", "Systems Analysis", "Turn rules into data fields"],
    ],
)

sub("4.3 Other Hub tasks (not only coding)")
body("Besides SpartialIQ I did support and Hub service work:")
bullet("Printer fixing: drivers, paper jams, offline printers, duplex settings, toner help.")
bullet("Helping users after Windows updates when printers disappeared.")
bullet("Workshop room setup: extension leads, test print pages, spare laptop.")
bullet("Support at expos and pitching days: stand packing, power strips, handouts, timer, clicker.")
bullet("Short presentations of my own progress to Dr Paradzayi and the team.")
bullet("Visitor days: simple demo of the map and answering basic questions.")

# ── 5 ────────────────────────────────────────────────────────────────────────
heading("5. WORKSHOPS, EXPOS, PRESENTATIONS AND SUPPORT WORK")
body("This section is important because a lot of Hub learning happens outside the editor.")

plain_table(
    ["Activity", "When (approx.)", "What I did", "What I learnt"],
    [
        ["Hub orientation workshop", "Feb 2026", "Attended rules and Education 5.0 talk", "How the Hub expects students to work"],
        ["ICT / printer workshop", "Mar 2026", "Practised drivers and print queues", "Common Windows printer faults"],
        ["Git workshop", "Mar/Apr 2026", "Branches and pull requests", "Safer team Git habits"],
        ["ZITF hackathon support", "Apr 2026", "Stand help, charging, demo checks", "Events fail on power and Wi-Fi"],
        ["Vungu council demo", "Apr 2026", "Presented system with the team", "Listen to officers; write feedback"],
        ["Report writing workshop", "Apr 2026", "Plain English technical writing", "Simple words are clearer"],
        ["MSU / Hub support expo", "Jun–Sep 2026", "Stand prep, visitor help, printers", "Expo checklists and calm support"],
        ["Pitching afternoon support", "Aug 2026", "Timer, slides, spare laptop, printers", "Support roles matter as much as pitching"],
        ["MSU Expo packing", "Sep 2026", "Banners, power, handouts, test print", "Pack and test the day before"],
        ["Hub review presentations", "Monthly", "Progress slides on SpartialIQ", "Short demos beat long speeches"],
        ["Postgres backup workshop", "Jul 2026", "Dump and restore practice", "Restore before you need it"],
    ],
)

# ── 6 ────────────────────────────────────────────────────────────────────────
heading("6. THINGS I LEARNT")
sub("6.1 Technical skills")
bullet("Building and fixing a Fastify API against a real PostGIS database.")
bullet("Reading a handbook and turning it into tables and screens.")
bullet("Writing simple automated checks before a demo.")
bullet("Making a Windows installer so a supervisor can run the app without Node.")
bullet("Database restore when a laptop or disk fails.")

sub("6.2 Support and soft skills")
bullet("Fixing printers and explaining the fix in plain words.")
bullet("Helping at workshops and expos without being the main speaker.")
bullet("Presenting progress clearly to Dr Paradzayi.")
bullet("Working with Theophelos daily so API and UI stay matched.")
bullet("Time management when support tickets and project work arrive on the same day.")

sub("6.3 Personal growth")
body("I became more careful. At the Hub a wrong claim in a demo can waste the client’s time. I also became more patient with small jobs. A jammed printer before a presentation is not “not my work” — if the meeting cannot print handouts, the project looks bad too.")

# ── 7 ────────────────────────────────────────────────────────────────────────
heading("7. PROBLEMS I FACED")
plain_table(
    ["Problem", "What happened", "What I did / learnt"],
    [
        ["Weak old prototype security", "Passwords and secrets were unsafe", "Fixed first; learnt not to commit secrets"],
        ["Login broke after tenancy change", "Staff could not sign in", "Fixed columns and auth together"],
        ["Handbook hard to read", "Legal wording was heavy", "Broke it into actors, actions, data"],
        ["Disk full in October", "Database stopped; login failed", "Cleared old backups; keep disk space"],
        ["Printer before a review", "Meeting room printer offline", "Fix early on review day"],
        ["Feature list longer than code", "Docs claimed registers too early", "Only mark done when tests pass"],
    ],
)

# ── 8 ────────────────────────────────────────────────────────────────────────
heading("8. CONCLUSION AND RECOMMENDATIONS")
sub("8.1 Conclusion")
body("My WRL at the MSU Research and Innovation Hub mixed real product work on the Vungu GIS / SpartialIQ system with normal Hub support: printers, workshops, presentations and expos. That mix is what made the placement feel real. I used Computer Science modules every week, and I also learnt skills class does not mark — calm support, simple talking, and honest demos.")

sub("8.2 Recommendations to the Hub")
bullet("Keep a small printer and expo checklist for students on presentation days.")
bullet("Keep the rule: do not claim a use case until the test passes.")
bullet("Give new students the Handbook and a short PostGIS starter in week one.")
bullet("Keep the Windows installer and database restore notes up to date.")

sub("8.3 Recommendations to the university")
bullet("Allow Hub support work (printers, expos, workshops) to count clearly in the logbook, because that is real learning.")
bullet("Encourage joint reviews where backend and frontend students present together.")

sub("8.4 Re-entry to campus")
body("When I return to full campus classes I will bring clearer database and security habits, and better confidence speaking about my work. I still need deeper practice on production cloud deploy and on real council data imports once Vungu sends the property file.")
pb()

heading("REFERENCES")
refs = [
    "Government of Zimbabwe (2021). Development Management (Control) Handbook. Ministry of Local Government and Public Works.",
    "Government of Zimbabwe. Rural District Councils Act, Chapter 29:13.",
    "Midlands State University Research and Innovation Hub (2026). Student project guidance notes. Gweru: MSU.",
    "PostGIS Development Group (2024). PostGIS documentation. https://postgis.net/docs",
    "OWASP Foundation (2021). OWASP Top Ten.",
]
for ref in refs:
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(1.0)
    p.paragraph_format.first_line_indent = Cm(-1.0)
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(ref)
    sf(r, size=11)

out = r"c:\Users\munya\Desktop\finale\WRL 2\WRL\Munyaradzi_Namailinga_WRL_Report_R243100H_v6.docx"
doc.save(out)
for dest in [
    r"c:\Users\munya\Desktop\finale\WRL 2\Munyaradzi_Namailinga_WRL_Report_R243100H_v6.docx",
    r"c:\Users\munya\Desktop\Munyaradzi_Namailinga_WRL_Report_R243100H_v6.docx",
]:
    try:
        shutil.copy2(out, dest)
        print("Copied:", dest)
    except Exception as e:
        print("Copy skipped", dest, e)
print("Saved:", out)
