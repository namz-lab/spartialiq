"""
Munyaradzi Namailinga logbook — same format as Theophelos Madzinga.
White tables, MONTH blocks, DATE | DESCRIPTION | STUDENT'S COMMENTS.
Simple language. Backend role + Hub support (printers, expos, workshops).
"""
from docx import Document
from docx.shared import Pt, Inches
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_ALIGN_PARAGRAPH
import shutil

OUT = r"c:\Users\munya\Desktop\finale\WRL 2\WRL\Munyaradzi_Namailinga_Logbook_v7.docx"
doc = Document()
section = doc.sections[0]
section.left_margin = Inches(1.2)
section.right_margin = Inches(1.0)
section.top_margin = Inches(1.0)
section.bottom_margin = Inches(1.0)


def cen(text, size=12, bold=False):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    run.font.size = Pt(size)
    run.font.name = "Times New Roman"
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    return p


def bold_para(text, size=11):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(size)
    run.font.name = "Times New Roman"
    return p


def dotline():
    p = doc.add_paragraph()
    r = p.add_run(
        "................................................................................................................................................................\n"
        "................................................................................................................................................................"
    )
    r.font.size = Pt(10)
    r.font.name = "Times New Roman"


def month_block(label):
    bold_para(label, 12)
    for heading in ["Supervisor's Comments", "Supervisor's Signature", "Date"]:
        bold_para(heading, 10)
        dotline()


def page_break():
    doc.add_page_break()


def _white_cell(cell):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    for s in tcPr.findall(qn("w:shd")):
        tcPr.remove(s)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), "FFFFFF")
    tcPr.append(shd)


def add_week_table(rows):
    tbl = doc.add_table(rows=1, cols=3)
    tbl.style = "Table Grid"
    tblPr = tbl._tbl.find(qn("w:tblPr"))
    if tblPr is not None:
        lk = OxmlElement("w:tblLook")
        lk.set(qn("w:noHBand"), "1")
        lk.set(qn("w:noVBand"), "1")
        tblPr.append(lk)
    hdr = tbl.rows[0]
    for i, h in enumerate(["DATE", "DESCRIPTION OF WORK DONE", "STUDENT'S COMMENTS"]):
        hdr.cells[i].text = ""
        run = hdr.cells[i].paragraphs[0].add_run(h)
        run.bold = True
        run.font.size = Pt(10)
        run.font.name = "Times New Roman"
        _white_cell(hdr.cells[i])
    for date_text, desc_text, comm_text in rows:
        row = tbl.add_row()
        for i, text in enumerate((date_text, desc_text, comm_text)):
            row.cells[i].text = ""
            run = row.cells[i].paragraphs[0].add_run(text)
            run.font.size = Pt(10)
            run.font.name = "Times New Roman"
            _white_cell(row.cells[i])
    doc.add_paragraph()


# ===== COVER =====
cen("MIDLANDS STATE UNIVERSITY", 13, bold=True)
cen("FACULTY OF INFORMATION SCIENCE AND TECHNOLOGY", 11, bold=True)
cen("DEPARTMENT OF COMPUTER SCIENCE", 11, bold=True)
doc.add_paragraph()
cen("INDUSTRIAL ATTACHMENT LOGBOOK", 13, bold=True)
doc.add_paragraph()

info_tbl = doc.add_table(rows=7, cols=2)
info_tbl.style = "Table Grid"
info_rows = [
    ("Name", "Munyaradzi Namailinga"),
    ("Reg Number", "R243100H"),
    ("Programme", "Bachelor of Science (Honours) in Computer Science"),
    ("Level", "3.1"),
    (
        "Attachment Organisation",
        "Midlands State University (Research and Innovation) / Faculty of Built Environment "
        "- Vungu RDC GIS Project",
    ),
    ("Attachment Period", "23 February 2026 to 18 October 2026"),
    ("Industrial Supervisor", "Dr Paradzayi (Project Manager)"),
]
for i, (lbl, val) in enumerate(info_rows):
    info_tbl.rows[i].cells[0].text = lbl
    info_tbl.rows[i].cells[1].text = val
    info_tbl.rows[i].cells[0].paragraphs[0].runs[0].bold = True
    for cell in info_tbl.rows[i].cells:
        for para in cell.paragraphs:
            for run in para.runs:
                run.font.size = Pt(10)
                run.font.name = "Times New Roman"

doc.add_paragraph()
for m in [
    "MONTH: FEBRUARY 2026",
    "MONTH: MARCH 2026",
    "MONTH: APRIL 2026",
    "MONTH: MAY 2026",
    "MONTH: JUNE 2026",
    "MONTH: JULY 2026",
    "MONTH: AUGUST 2026",
    "MONTH: SEPTEMBER 2026",
    "MONTH: OCTOBER 2026",
]:
    month_block(m)

page_break()

# FEBRUARY
add_week_table([
    (
        "WEEK 1\nMon 23 Feb\nFri 27 Feb 2026",
        (
            "Day 1 (Mon 23 Feb) - Project Orientation\n"
            "Met Dr Paradzayi at the MSU Research and Innovation Hub. He explained the Vungu "
            "Rural District Council GIS project. My role is backend and database. Theophelos "
            "handles the screens and map. I wrote short notes on what the council needs.\n\n"
            "Day 2 (Tue 24 Feb) - Reading the Old Code\n"
            "Looked through the old backend code with Theophelos. Found weak password storage "
            "and database passwords written in the code. Listed the problems for the supervisor.\n\n"
            "Day 3 (Wed 25 Feb) - Hub Support and Printer Fix\n"
            "Helped a Hub staff member whose printer would not print. Reinstalled the driver "
            "and printed a test page. Also set up Node.js, PostgreSQL and Git on my laptop.\n\n"
            "Day 4 (Thu 26 Feb) - Short Workshop\n"
            "Attended a Hub workshop on how projects are shown to visitors. Practised saying "
            "what the Vungu system does in simple words.\n\n"
            "Day 5 (Fri 27 Feb) - Team Meeting\n"
            "Team meeting with Dr Paradzayi and Theophelos. Agreed Git branches and that I own "
            "the API and database. Planned security fixes for March."
        ),
        (
            "I learnt how the Hub runs student projects under one supervisor. Breaking the "
            "work into backend and frontend made the job clear.\n\n"
            "I learnt that small support jobs like printer fixing are normal at the Hub. They "
            "are part of the week, not a distraction.\n\n"
            "I learnt to write problems down before trying to fix everything at once."
        ),
    ),
])
page_break()

# MARCH
add_week_table([
    (
        "WEEK 1\nMon 02 Mar\nFri 06 Mar 2026",
        (
            "Day 1 (Mon 02 Mar) - Server Setup Start\n"
            "Started setting up the project server pieces: PostgreSQL with PostGIS, and the "
            "Node API. Read simple PostGIS notes on storing map shapes.\n\n"
            "Day 2 (Tue 03 Mar) - Password Fix\n"
            "Began changing login so passwords use bcrypt instead of plain text.\n\n"
            "Day 3 (Wed 04 Mar) - ICT Support Workshop\n"
            "Attended a Hub ICT workshop on Windows printers and print queues. Practised "
            "clearing a stuck queue.\n\n"
            "Day 4 (Thu 05 Mar) - Support Tickets\n"
            "Helped two Hub users: one slow Wi-Fi report and one stuck print job.\n\n"
            "Day 5 (Fri 06 Mar) - API Smoke Test\n"
            "Ran the API on my machine and checked health with Theophelos."
        ),
        (
            "I learnt that PostGIS keeps map shapes inside the database. That is why the "
            "council map can answer stand questions.\n\n"
            "I learnt more printer queue fixing from the workshop.\n\n"
            "I learnt to test the API early even when the full system is not ready."
        ),
    ),
    (
        "WEEK 2\nMon 09 Mar\nFri 13 Mar 2026",
        (
            "Day 1 to Day 3 - Security Clean-up\n"
            "Cleared known package security issues. Moved database passwords into an env file. "
            "Rewrote simple input checks on public routes.\n\n"
            "Day 4 (Thu 12 Mar) - Open Afternoon Support\n"
            "Helped at a Hub open afternoon. Showed visitors a simple map demo. Fixed wrong "
            "paper size on the reception printer before handouts were printed.\n\n"
            "Day 5 (Fri 13 Mar) - Site Visit Planning\n"
            "Planned the Vungu RDC visit with Rafiq. Listed questions for planning officers."
        ),
        (
            "I learnt why secrets should not sit in Git. Cleaning that up takes longer than "
            "doing it right the first time.\n\n"
            "I learnt that expo and open-day support needs a working printer as much as a "
            "working demo.\n\n"
            "I practised explaining the project to people who are not developers."
        ),
    ),
    (
        "WEEK 3\nMon 16 Mar\nFri 20 Mar 2026",
        (
            "Day 1 to Day 3 - API Routes\n"
            "Worked on API routes for wards and applications. Added basic status history so "
            "changes are logged.\n\n"
            "Day 4 (Thu 19 Mar) - Site Visit to Vungu RDC\n"
            "Visited Vungu planning offices. Listened to how they handle permits on paper. "
            "Took notes on ward maps and stand questions.\n\n"
            "Day 5 (Fri 20 Mar) - Presentation\n"
            "Presented visit notes to Dr Paradzayi with Theophelos. Helped reconnect a network "
            "printer after a Windows update for a Hub user."
        ),
        (
            "I learnt how council work really happens. Paper registers and ward talk shaped "
            "what we build next.\n\n"
            "I learnt to keep presentation notes short for the supervisor.\n\n"
            "I learnt that Windows updates often break printers."
        ),
    ),
    (
        "WEEK 4\nMon 23 Mar\nFri 27 Mar 2026",
        (
            "Day 1 to Day 3 - Docker and Docs\n"
            "Made a simple Docker setup so the team can start the database and API the same "
            "way. Wrote BACKEND_GUIDE steps in plain English.\n\n"
            "Day 4 (Thu 26 Mar) - Git Workshop\n"
            "Attended a Hub workshop on Git branches and pull requests.\n\n"
            "Day 5 (Fri 27 Mar) - Printer Sharing\n"
            "Helped fix a printer shared between two Hub offices. Prepared slides for the "
            "April demo."
        ),
        (
            "I learnt how Docker helps everyone run the same setup.\n\n"
            "I learnt clearer Git habits from the workshop.\n\n"
            "I learnt shared printer troubleshooting between offices."
        ),
    ),
])
page_break()

# APRIL
add_week_table([
    (
        "WEEK 1\nMon 30 Mar\nFri 03 Apr 2026",
        (
            "Day 1 to Day 3 - Tests and HTTPS\n"
            "Wrote API tests and checked HTTPS on the server.\n\n"
            "Day 4 (Thu 02 Apr) - ZITF Support\n"
            "Helped Hub support for ZITF Innovation Hackathon: stand power, laptop charging, "
            "and demo checks. Fixed a label printer used for visitor badges.\n\n"
            "Day 5 (Fri 03 Apr) - Demo Practice\n"
            "Practised the Vungu system demo for council officers."
        ),
        (
            "I learnt that demos fail when power, printer or Wi-Fi is not ready.\n\n"
            "I learnt to keep a short demo script.\n\n"
            "I learnt basic badge and label printer use."
        ),
    ),
    (
        "WEEK 2\nMon 06 Apr\nFri 10 Apr 2026",
        (
            "Day 1 to Day 3 - Final Demo Prep\n"
            "Fixed small API bugs found in practice runs. Checked stand and ward data with "
            "Theophelos.\n\n"
            "Day 4 (Thu 09 Apr) - Formal Demo to Vungu Officers\n"
            "Presented the system. Officers accepted it as ready for more work. They asked "
            "for sold versus free stands and better register support.\n\n"
            "Day 5 (Fri 10 Apr) - Hub Debrief\n"
            "Hub debrief presentation. Helped clean meeting room AV and a stuck projector cable."
        ),
        (
            "I learnt to listen to client feedback without arguing.\n\n"
            "I learnt that projector and AV fixing is part of Hub presentation support.\n\n"
            "I learnt which features officers care about most."
        ),
    ),
    (
        "WEEK 3\nMon 13 Apr\nFri 17 Apr 2026",
        (
            "Day 1 to Day 4 - Handbook Study\n"
            "Started reading the Zimbabwe Development Management Handbook 2021. Compared it "
            "to our database tables and listed missing ones.\n\n"
            "Day 5 (Fri 17 Apr) - Writing Workshop and Expo Help\n"
            "Attended a Hub writing workshop on simple technical reports. Helped at a student "
            "support expo: directed visitors and restarted a dead display laptop."
        ),
        (
            "I learnt how a handbook drives what tables we need.\n\n"
            "I learnt to write in plain English from the workshop.\n\n"
            "I learnt expo floor support when a laptop dies."
        ),
    ),
    (
        "WEEK 4\nMon 20 Apr\nFri 24 Apr 2026",
        (
            "Day 1 to Day 4 - New Tables\n"
            "Designed new database tables for inspections and certificates. Wrote SQL create "
            "scripts and showed them to Dr Paradzayi.\n\n"
            "Day 5 (Fri 24 Apr) - Research Presentation and Printer\n"
            "Attended another student research presentation at the Hub. Fixed boardroom "
            "printer duplex settings before a meeting."
        ),
        (
            "I learnt to check table design with my supervisor before coding everything.\n\n"
            "I learnt presentation structure by watching others.\n\n"
            "I learnt duplex settings for meeting handouts."
        ),
    ),
])
page_break()

# MAY
add_week_table([
    (
        "WEEK 1\nMon 27 Apr\nFri 01 May 2026",
        (
            "Day 1 to Day 3 - Normal Form Checks\n"
            "Checked new tables in simple 3NF steps. Started Development Control Matrix work "
            "from the council spreadsheet.\n\n"
            "Day 4 (Thu 30 Apr) - Excel to Database Workshop\n"
            "Hub workshop on turning Excel sheets into database rows. Installed a printer "
            "driver on a new staff PC.\n\n"
            "Day 5 (Fri 01 May) - Workers Day\n"
            "Public holiday. No work logged."
        ),
        (
            "I learnt what 3NF means on a real table, not only in class.\n\n"
            "I learnt how spreadsheets become database rows.\n\n"
            "I practised clean driver installs on new PCs."
        ),
    ),
    (
        "WEEK 2\nMon 04 May\nFri 08 May 2026",
        (
            "Day 1 to Day 4 - Dictionary and Research Notes\n"
            "Finished DCM data dictionary and a short SQL versus NoSQL note. Worked on "
            "document verification research for IDs and title deeds.\n\n"
            "Day 5 (Fri 08 May) - Progress Presentation\n"
            "Presented progress to Dr Paradzayi and Rafiq. Helped set up a workshop room "
            "(extension leads and a printer test page)."
        ),
        (
            "I learnt to explain SQL versus NoSQL in simple words.\n\n"
            "I learnt what documents the council asks applicants to bring.\n\n"
            "I learnt room setup for Hub workshops."
        ),
    ),
    (
        "WEEK 3\nMon 11 May\nFri 15 May 2026",
        (
            "Day 1 to Day 5 - Research Wrap and Support\n"
            "Finished document verification notes. Helped Theophelos test API responses for "
            "new screens. Supported two printer jams during a Hub visitor morning."
        ),
        (
            "I learnt that research weeks still include Hub support.\n\n"
            "I learnt to keep API response shapes stable for the frontend."
        ),
    ),
])
page_break()

# JUNE
add_week_table([
    (
        "WEEK 1\nMon 01 Jun\nFri 05 Jun 2026",
        (
            "Day 1 (Mon 01 Jun) - Honest Gap List\n"
            "Reviewed with Dr Paradzayi what is still missing for go-live: rates clearance, "
            "by-law register and other paper registers.\n\n"
            "Day 2 to Day 3 - Login Fix\n"
            "Fixed staff login after tenancy changes broke it. Added missing user columns.\n\n"
            "Day 4 (Thu 04 Jun) - Stand Identify\n"
            "Stand identify API now shows sold or free and the owner name on map click.\n\n"
            "Day 5 (Fri 05 Jun) - Expo Prep Meeting\n"
            "Attended MSU support expo prep. Listed power, demo user and printed flyer needs. "
            "Fixed a corridor printer offline error."
        ),
        (
            "I learnt not to claim a feature if it is not in the code.\n\n"
            "I learnt that login and database columns must match.\n\n"
            "I learnt expo prep checklists."
        ),
    ),
    (
        "WEEK 2\nMon 08 Jun\nFri 12 Jun 2026",
        (
            "Day 1 to Day 3 - Seed Data and Deploy Checks\n"
            "Seeded test owner data so the map is not empty. Wrote a simple deploy check "
            "script that logs in as demo users and hits main APIs.\n\n"
            "Day 4 (Thu 11 Jun) - Visitor Day Support\n"
            "Hub visitor day: printed visitor slips and cleared a paper jam.\n\n"
            "Day 5 (Fri 12 Jun) - Short Talk\n"
            "Short presentation of the deploy check to the team."
        ),
        (
            "I learnt to write checks other students can re-run.\n\n"
            "I learnt paper jam clearing under time pressure.\n\n"
            "I practised short technical talks."
        ),
    ),
])
page_break()

# JULY–AUGUST summary weeks in Theo style
add_week_table([
    (
        "WEEK 1–4\nJuly 2026\n(summary)",
        (
            "Database clean-up docs and lookup tables. Helped Theophelos with GIS layer list "
            "and tile checks. Attended Hub mid-year project presentations. IT support: "
            "printers, one scanner install, Wi-Fi password reset for a visiting student. "
            "Attended a workshop on PostgreSQL backup and restore."
        ),
        (
            "I learnt that quiet months are for docs and clean data.\n\n"
            "I learnt scanner install and basic Wi-Fi user support.\n\n"
            "I learnt dump and restore in the workshop."
        ),
    ),
    (
        "WEEK 1–4\nAugust 2026\n(summary)",
        (
            "Planned statutory register tables for Vungu (by-laws, district plan, rates "
            "clearance and related registers). Did QGIS to web map checks with Theophelos. "
            "Supported a Hub pitching afternoon (timer, slide clicker, spare laptop). Fixed "
            "two printers before the pitching session."
        ),
        (
            "I learnt to design tables from the council Act in plain language.\n\n"
            "I learnt event support roles at pitching sessions.\n\n"
            "I learnt to test printers the day before an event."
        ),
    ),
])
page_break()

# SEPTEMBER
add_week_table([
    (
        "WEEK 1\nMon 14 Sep\nFri 18 Sep 2026",
        (
            "Day 1 to Day 3 - Database Restore\n"
            "Restored the local Vungu database after a bad laptop shutdown. Wrote restore "
            "steps for the Hub team.\n\n"
            "Day 4 (Thu 17 Sep) - Desktop Installer Start\n"
            "Started packaging SpartialIQ Local so Dr Paradzayi can run the app without "
            "installing Node by hand.\n\n"
            "Day 5 (Fri 18 Sep) - MSU Expo Packing\n"
            "Helped pack the Hub expo stand: banners, power strips, printed handouts. Printer "
            "fix on the expo practice laptop."
        ),
        (
            "I learnt that restore drills matter before demos.\n\n"
            "I learnt desktop packaging basics.\n\n"
            "I learnt expo stand packing and printer checks."
        ),
    ),
    (
        "WEEK 2\nMon 21 Sep\nFri 25 Sep 2026",
        (
            "Day 1 to Day 4 - API and Map Tests\n"
            "More API and map tests with Theophelos on sold versus free HDR stands. Drafted "
            "the migration for council registers.\n\n"
            "Day 5 (Fri 25 Sep) - Visitor Talk Workshop\n"
            "Hub workshop on speaking to council and community visitors. Supported a printer "
            "networking issue in the Hub admin office."
        ),
        (
            "I learnt to test with real stand numbers from seed data.\n\n"
            "I learnt simpler language for community visitors.\n\n"
            "I learnt office printer network sharing."
        ),
    ),
])
page_break()

# OCTOBER
add_week_table([
    (
        "WEEK 1\nMon 12 Oct\nFri 16 Oct 2026",
        (
            "Day 1 (Mon 12 Oct) - Statutory Registers\n"
            "Built statutory registers in the database and API: by-laws, annual district plan, "
            "compulsory acquisition, rates clearance and expense recovery.\n\n"
            "Day 2 (Tue 13 Oct) - Staff and Citizen Screens\n"
            "Staff page for registers. Citizen page to request rates clearance. Worked with "
            "Theophelos on the links.\n\n"
            "Day 3 (Wed 14 Oct) - Button Tests\n"
            "Ran button crawl tests for all demo roles.\n\n"
            "Day 4 (Thu 15 Oct) - Windows Installer\n"
            "Built the Windows installer for SpartialIQ Local and copied it for Dr Paradzayi.\n\n"
            "Day 5 (Fri 16 Oct) - Hub Review Presentation\n"
            "Presented October progress at Hub review. Fixed the meeting room printer before "
            "the session."
        ),
        (
            "I learnt how council paper registers become screens and APIs.\n\n"
            "I learnt that automated click tests save stress on demo day.\n\n"
            "I learnt to ship an installer so others do not install Node by hand.\n\n"
            "I practised Hub review presentations under a real deadline."
        ),
    ),
    (
        "WEEK 2\nSat 18 Oct 2026",
        (
            "Day 1 (Sat 18 Oct) - Production Prep and Acua Layer\n"
            "Production prep: sample env file, block demo logins in production mode, runtime "
            "database user, owner import script and database restore script. Added Acua about "
            "300 square metre sub-plots inside bigger stands on the map. Fixed a login failure "
            "caused by a full disk by clearing old backups and restarting Postgres. Helped Hub "
            "admin with toner and cartridge change after the review."
        ),
        (
            "I learnt the production checklist items: env file, roles and restore.\n\n"
            "I learnt that sub-plots can sit in a child table without breaking parent stands.\n\n"
            "I learnt that disk space can take the whole system down.\n\n"
            "I learnt basic toner support for Hub printers."
        ),
    ),
])

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("END OF LOGBOOK")
r.bold = True
r.font.size = Pt(11)
r.font.name = "Times New Roman"

doc.save(OUT)
for dest in [
    r"c:\Users\munya\Desktop\finale\WRL 2\Munyaradzi_Namailinga_Logbook_v7.docx",
    r"c:\Users\munya\Desktop\Munyaradzi_Namailinga_Logbook_v7.docx",
]:
    try:
        shutil.copy2(OUT, dest)
        print("Copied:", dest)
    except Exception as e:
        print("Copy skipped", dest, e)
print("Saved:", OUT)
