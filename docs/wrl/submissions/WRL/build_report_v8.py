"""
Munyaradzi Namailinga WRL report v8 — Theophelos cover/chapter format.
Hub events aligned with Musawenkosi's calendar; product work is Vungu GIS only.
Simple language, no coloured cells.
"""
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
import shutil

OUT = r"c:\Users\munya\Desktop\finale\WRL 2\WRL\Munyaradzi_Namailinga_WRL_Preliminary_Report_R243100H_v8.docx"
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


def body(text, size=10, after=4):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(size)
    run.font.name = "Times New Roman"
    p.paragraph_format.space_after = Pt(after)
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY


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
center("GIS-Based Municipal Planning Information System for Vungu RDC (SpartialIQ)", 10)
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
    "This report covers my Work Related Learning at the Midlands State University Research "
    "and Innovation Hub from 23 February 2026 to 18 October 2026. My assigned product work "
    "was the Vungu Rural District Council GIS planning system (SpartialIQ). I worked on the "
    "backend, database, tests, statutory registers, Acua sub-plots and a Windows installer. "
    "Theophelos Madzinga worked on the screens and map. Dr Paradzayi supervised the project."
)
body(
    "The Hub calendar also included shared events that appear in other students' records, "
    "for example the ZITF Pitching Challenge, Tourism Scholastica week, Bulawayo Robotics "
    "Challenge logistics, the MSU SRC InsurTech Hackathon hosting period, and MSU Expo in "
    "Gweru. I took part in those weeks as Hub support or as a GIS exhibitor. I did not build "
    "health, tourism, robotics or insurtech products. My build work stayed on the Vungu GIS system."
)
body(
    "Thirty-four full weeks are recorded in the logbook, plus a short catch-up on 18 October. "
    "Public holidays are marked. The report explains the Hub, the GIS work, Hub events, skills "
    "learnt, problems and recommendations."
)
body(
    "Keywords: Work-Related Learning, MSU Innovation Hub, Vungu RDC, GIS, SpartialIQ, "
    "PostGIS, MSU Expo, ZITF, Workshops, Zimbabwe."
)
page_break()

h("ACKNOWLEDGEMENTS")
body(
    "I thank Dr Paradzayi for supervising the Vungu GIS project and for checking that claims "
    "match the code. I thank Rafiq for research feedback. I thank Theophelos for daily frontend "
    "and map work. I thank Hub staff and fellow Hub students for shared expo, pitching and "
    "workshop weeks. I thank the Department of Computer Science and my family for support."
)
page_break()

h("TABLE OF CONTENTS")
for item in [
    "Abstract",
    "Acknowledgements",
    "Table of Contents",
    "List of Abbreviations",
    "CHAPTER 1: INTRODUCTION",
    "CHAPTER 2: DESCRIPTION OF THE WRL ORGANISATION",
    "CHAPTER 3: WORK PLAN AND WEEKLY COVERAGE",
    "CHAPTER 4: WORK ACCOMPLISHED",
    "   4.1  GIS system work",
    "   4.2  Hub events shared with other Hub students",
    "   4.3  Workshops, presentations and support tasks",
    "   4.4  Things I learnt",
    "CHAPTER 5: SUMMARY, CONCLUSIONS, AND RECOMMENDATIONS",
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
        ["GIS", "Geographic Information System"],
        ["Hub", "MSU Research and Innovation Hub"],
        ["MSU", "Midlands State University"],
        ["PostGIS", "Spatial extension for PostgreSQL"],
        ["RDC", "Rural District Council"],
        ["WRL", "Work-Related Learning"],
        ["ZITF", "Zimbabwe International Trade Fair"],
    ],
)
page_break()

h("CHAPTER 1: INTRODUCTION")
h("1.1  Background", 2)
body(
    "Work Related Learning places Computer Science students in real workplaces. My placement "
    "was at the MSU Research and Innovation Hub. The Hub hosts many student projects at once. "
    "Some students work on health systems, AI tools, robotics or competition products. My "
    "assigned project was the GIS planning system for Vungu Rural District Council."
)
h("1.2  Purpose", 2)
body(
    "The purpose was to meet the WRL requirement, to learn real backend and database work on "
    "a live GIS system, and to take part in normal Hub service during expos, pitching weeks "
    "and workshops without losing focus on the Vungu product."
)
h("1.3  Objectives", 2)
numbered([
    "Build and harden the Vungu GIS backend and database under Hub supervision.",
    "Turn Handbook and council register needs into working GIS tables and APIs.",
    "Test the system before demos and keep use-case notes honest.",
    "Support shared Hub events while keeping product work on GIS only.",
    "Record every independent week in the logbook from February to October 2026.",
])
page_break()

h("CHAPTER 2: DESCRIPTION OF THE WRL ORGANISATION")
h("2.1  Midlands State University and the Hub", 2)
body(
    "Midlands State University is in Gweru. The Research and Innovation Hub sits under the "
    "university's innovation work. Students are placed on projects with supervisors. The Hub "
    "also runs pitching briefings, IP reminders, monthly readiness reporting, workshops and "
    "public expos. That shared calendar is why different students mention the same events even "
    "when their products differ."
)
h("2.2  Vungu RDC GIS project", 2)
body(
    "Vungu Rural District Council needs digital support for wards, stands, permits and "
    "registers. The system uses PostgreSQL with PostGIS, a Fastify API and a Vue map portal. "
    "In the repositories it is called SpartialIQ. I owned backend and database work. "
    "Theophelos owned screens and map UI. Dr Paradzayi was project manager."
)
add_grid(
    ["Role", "Person", "Focus"],
    [
        ["Project manager", "Dr Paradzayi", "Direction and reviews"],
        ["Research support", "Rafiq", "Research briefs"],
        ["Backend / database", "Munyaradzi Namailinga", "GIS API, data, tests, installer"],
        ["Frontend / map", "Theophelos Madzinga", "Portal and map"],
        ["Client", "Vungu RDC Planning", "Needs and demo feedback"],
    ],
)
page_break()

h("CHAPTER 3: WORK PLAN AND WEEKLY COVERAGE")
body(
    "The logbook covers thirty-four independent Monday to Friday weeks from 23 February 2026 "
    "to 16 October 2026, plus a catch-up entry on 18 October. There are no month summary "
    "blocks in place of weeks. Public holidays are marked inside the week (Good Friday, Easter "
    "Monday, Workers Day, Africa Day, Heroes Day and Defence Forces Day)."
)
add_grid(
    ["Phase", "Weeks (approx.)", "GIS focus"],
    [
        ["Orientation and security", "Weeks 1–5", "Onboarding, PostGIS setup, security clean-up"],
        ["Demo and Handbook", "Weeks 6–14", "ZITF support, Vungu demo, Handbook, DCM"],
        ["Hardening and registers", "Weeks 15–27", "Login fix, deploy checks, statutory registers"],
        ["Expo and go-live prep", "Weeks 28–34", "MSU Expo, Acua layer, installer, production gates"],
    ],
)
page_break()

h("CHAPTER 4: WORK ACCOMPLISHED")
h("4.1  GIS system work", 2)
body(
    "GIS product work included security fixes on the old prototype, PostGIS and API setup, "
    "ward and application routes, stand identify with allottee names, Handbook-driven table "
    "design, Development Control Matrix normalisation, statutory registers (by-laws, annual "
    "district plan, compulsory acquisition, rates clearance, expense recovery), Acua "
    "stand_subunit plots of about 300 square metres, deploy readiness checks, Playwright "
    "button crawls, property-owner import and restore scripts, and the SpartialIQ Local "
    "Windows installer for Hub demos."
)
body(
    "A formal demo to Vungu officers in April accepted the system for further work. Later "
    "weeks closed register gaps that the Rural District Councils Act expects councils to keep."
)

h("4.2  Hub events shared with other Hub students", 2)
body(
    "The Hub event list below matches events recorded by fellow Hub student Musawenkosi "
    "Ngulube. My role at each event is stated so it is clear I stayed on the GIS system."
)
add_grid(
    ["Event", "My role", "GIS link"],
    [
        ["Hub pitching and IP briefing", "Attended", "How we present GIS honestly"],
        ["ZITF Pitching Challenge", "Hub stand support; GIS demo readiness", "Power, printer, map check"],
        ["Tourism Scholastica week", "Logistics and GIS laptop ready", "No TourLink coding"],
        ["Bulawayo Robotics Challenge", "Packing and power-bank support", "No robot coding"],
        ["MSU SRC InsurTech Hackathon", "Room and printer hosting support", "No insurtech product"],
        ["MSU Expo, Gweru", "Exhibitor for Vungu GIS / SpartialIQ", "Visitor questions to backlog"],
        ["Monthly Hub readiness reports", "Submitted for GIS project", "Progress for management"],
        ["Hub pitching afternoons", "Timer, clicker, printers; GIS pitch practice", "Three-minute GIS pitch"],
    ],
)

h("4.3  Workshops, presentations and support tasks", 2)
body(
    "Across the thirty-four weeks I also did ICT printer workshops, Git workshop, report "
    "writing workshop, Postgres backup workshop, visitor-language workshop, Friday GIS "
    "presentations, meeting-room AV help, and day-to-day printer fixing. These tasks appear "
    "week by week in the logbook."
)

h("4.4  Things I learnt", 2)
numbered([
    "How to build and test a PostGIS-backed planning API for a real council.",
    "How to keep Hub expo and hackathon weeks from stealing the GIS product focus.",
    "How to explain stands, wards and rates clearance in plain words at Expo.",
    "How restore drills and disk space protect demos.",
    "How honest deploy checks protect Hub and client trust.",
    "How printer and room support keeps Hub events running.",
])
page_break()

h("CHAPTER 5: SUMMARY, CONCLUSIONS, AND RECOMMENDATIONS")
h("5.1  Summary", 2)
add_grid(
    ["Area", "Status"],
    [
        ["34 independent logbook weeks + 18 Oct catch-up", "Complete"],
        ["Vungu GIS backend, registers, Acua, installer", "Complete"],
        ["Hub shared events supported or exhibited as GIS", "Complete"],
        ["Workshops, presentations, printer support", "Complete"],
    ],
)

h("5.2  Problems", 2)
add_grid(
    ["Problem", "Learning"],
    [
        ["Weak old security", "Fix before new GIS features"],
        ["Login broke after tenancy change", "Ship schema and auth together"],
        ["Busy Hub event weeks", "Support the Hub but keep coding on GIS"],
        ["Disk full in October", "Backups need disk hygiene"],
        ["Docs ahead of code", "Only mark GIS use cases done when tests pass"],
    ],
)

h("5.3  Recommendations", 2)
numbered([
    "Keep one clear product owner per Hub student so event weeks do not create fake multi-product claims.",
    "Keep shared Hub event checklists for power, printers and spare laptops.",
    "Keep GIS use-case notes tied to the deploy gate.",
    "Replace seed owners with the real Vungu Property File before production.",
    "Continue joint backend and frontend reviews for the GIS team.",
])
body(
    "In conclusion, the placement was a GIS engineering attachment inside a busy Innovation "
    "Hub. Shared Hub events from the wider student calendar were real, but my system work "
    "was the Vungu planning GIS. That split is what the logbook and this report both show."
)
page_break()

h("REFERENCES")
for ref in [
    "Government of Zimbabwe (2021). Development Management (Control) Handbook. Ministry of Local Government and Public Works.",
    "Government of Zimbabwe. Rural District Councils Act, Chapter 29:13.",
    "Midlands State University Research and Innovation Hub (2026). Student project guidance and event calendar notes. Gweru: MSU.",
    "Ngulube, M.B.J. (2026). INFO342 Work Related Learning Report (Hub event record used for shared calendar alignment). Midlands State University.",
    "PostGIS Development Group (2024). PostGIS documentation. https://postgis.net/docs",
]:
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.3)
    p.paragraph_format.first_line_indent = Inches(-0.3)
    run = p.add_run(ref)
    run.font.size = Pt(10)
    run.font.name = "Times New Roman"

doc.save(OUT)
for dest in [
    r"c:\Users\munya\Desktop\finale\WRL 2\Munyaradzi_Namailinga_WRL_Preliminary_Report_R243100H_v8.docx",
    r"c:\Users\munya\Desktop\Munyaradzi_Namailinga_WRL_Preliminary_Report_R243100H_v8.docx",
]:
    try:
        shutil.copy2(OUT, dest)
        print("Copied:", dest)
    except Exception as e:
        print("Copy skipped", dest, e)
print("Saved:", OUT)
