"""Munyaradzi Namailinga WRL logbook — Neil Choeni format (plain, no colours)."""
from docx import Document
from docx.shared import Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
import shutil

doc = Document()
for sec in doc.sections:
    sec.top_margin = Cm(2.0)
    sec.bottom_margin = Cm(2.0)
    sec.left_margin = Cm(2.5)
    sec.right_margin = Cm(2.0)

def sf(run, size=11, bold=False, italic=False):
    run.font.name = "Times New Roman"
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic

def set_cell(cell, text, bold=False, size=11, center=False):
    cell.text = ""
    p = cell.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER if center else WD_ALIGN_PARAGRAPH.LEFT
    # split on newlines into paragraphs inside cell
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if i == 0:
            r = p.add_run(line)
            sf(r, size=size, bold=bold)
        else:
            np = cell.add_paragraph()
            np.alignment = p.alignment
            r = np.add_run(line)
            sf(r, size=size, bold=bold)

def info_table(rows):
    t = doc.add_table(rows=len(rows), cols=2)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, (a, b) in enumerate(rows):
        set_cell(t.rows[i].cells[0], a, bold=True, size=11)
        set_cell(t.rows[i].cells[1], b, size=11)
        t.rows[i].cells[0].width = Cm(5)
        t.rows[i].cells[1].width = Cm(12)
    doc.add_paragraph()
    return t

def week_table(date_label, work, learnt):
    """One week block like Neil: header row + one data row. No colours."""
    t = doc.add_table(rows=2, cols=3)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_cell(t.rows[0].cells[0], "DATE", bold=True, size=11, center=True)
    set_cell(t.rows[0].cells[1], "DESCRIPTION OF WORK DONE", bold=True, size=11, center=True)
    set_cell(t.rows[0].cells[2], "Applied/Learnt Skills", bold=True, size=11, center=True)
    set_cell(t.rows[1].cells[0], date_label, bold=True, size=10, center=True)
    set_cell(t.rows[1].cells[1], work, size=10)
    set_cell(t.rows[1].cells[2], learnt, size=10)
    for row in t.rows:
        row.cells[0].width = Cm(3.0)
        row.cells[1].width = Cm(8.5)
        row.cells[2].width = Cm(6.0)
    # supervisor lines
    for label in ["Supervisor's Comments:", "Supervisor's Signature:", "Date:"]:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(2)
        r = p.add_run(label)
        sf(r, bold=True, size=11)
        p2 = doc.add_paragraph("........................................................................")
        sf(p2.runs[0], size=10)
    doc.add_paragraph()

# ── COVER ────────────────────────────────────────────────────────────────────
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("LOGBOOK")
sf(r, size=18, bold=True)

doc.add_paragraph()

info_table([
    ("Name", "MUNYARADZI NAMAILINGA"),
    ("Supervisor Name", "Dr Paradzayi"),
    ("Reg Number", "R243100H"),
    ("Program", "Computer Science"),
    ("Level", "3.1"),
    ("Company Name", "Midlands State University Research and Innovation Hub\n(Vungu RDC GIS / SpartialIQ project)"),
    ("Address", "Senga Road Campus, Gweru"),
    ("Attachment Period", "23 February 2026 to 18 October 2026"),
])

# ── WEEKS ────────────────────────────────────────────────────────────────────
weeks = [
(
"Week 1\n23/02/26-\n27/02/26",
"""Met the team at the MSU Research and Innovation Hub. Dr Paradzayi explained the Vungu Rural District Council GIS project.

Attended Hub orientation on Education 5.0, Hub rules and how student projects are supervised.

Set up my laptop with Node.js, PostgreSQL and Git for the planning system.

Helped a Hub staff member fix a printer that would not print from Windows. Reinstalled the driver and tested a page.

Joined a short workshop on how the Hub presents projects to visitors.""",
"""I learnt how the Innovation Hub works day to day and how the Vungu project fits under MSU.

I learnt basic printer driver fixing and that small support jobs are part of Hub life, not only coding.

I learnt what the GIS planning system is meant to do for the council."""
),
(
"Week 2\n02/03/26-\n06/03/26",
"""Read through the old prototype code for the Vungu system with Theophelos.

Listed security problems (weak passwords, secrets in code) for Dr Paradzayi.

Attended a Hub presentation practice session where other students pitched their projects.

Helped set up chairs and network cable for a small support expo stand at the Hub for visiting lecturers.

Fixed another printer jam and showed a user how to select the right printer.""",
"""I learnt how to review code for simple security mistakes.

I learnt that Hub expos need both the demo and practical help (cables, printer, stand).

I practised explaining technical work in plain words during presentation practice."""
),
(
"Week 3\n09/03/26-\n13/03/26",
"""Worked on server setup for the project (Ubuntu, PostgreSQL with PostGIS, Nginx).

Started fixing login so passwords use bcrypt instead of plain text.

Attended an ICT support workshop at the Hub on common Windows and printer problems.

Took Freshdesk-style support notes when Hub users reported slow Wi-Fi and a stuck print queue.

Helped Theophelos test the map page on a spare Hub laptop.""",
"""I learnt how PostGIS stores map shapes in a database.

I learnt more printer and print-queue fixing from the workshop.

I learnt that testing on a real Hub laptop catches problems you miss on your own machine."""
),
(
"Week 4\n16/03/26-\n20/03/26",
"""Finished clearing known package security issues on the backend.

Moved database passwords out of the code into an env file.

Site visit planning with Rafiq for Vungu RDC.

Helped at a Hub open afternoon: showed visitors a simple map demo and answered questions.

Fixed a Hub reception printer that had wrong paper size settings.""",
"""I learnt why secrets should not sit in Git.

I learnt how to talk to non-technical visitors at a support expo style open day.

I learnt simple printer settings (paper size, default tray)."""
),
(
"Week 5\n23/03/26-\n27/03/26",
"""Site visit to Vungu RDC planning offices. Listened to how officers handle permits on paper.

Took notes on ward maps and what they want on a digital system.

Back at the Hub: wrote API routes for applications and wards.

Attended a Friday project presentation to Dr Paradzayi with Theophelos.

Helped a student reconnect a network printer after Windows update.""",
"""I learnt how council planning work actually happens, not only from books.

I learnt to write short meeting notes that Dr Paradzayi can use.

I practised team presentations and fixing printers after Windows updates."""
),
(
"Week 6\n30/03/26-\n03/04/26",
"""Docker compose for database and API so the team can start the stack the same way.

Wrote BACKEND_GUIDE notes in simple steps.

Hub workshop on Git branches and pull requests.

Supported a Hub printer sharing problem between two offices.

Prepared slides for the next demo.""",
"""I learnt how Docker helps the whole team run the same setup.

I learnt clearer Git habits from the workshop.

I learnt shared printer troubleshooting between offices."""
),
(
"Week 7\n06/04/26-\n10/04/26",
"""Wrote API tests and checked HTTPS on the server.

Joined ZITF Innovation Hackathon support from the Hub side (stand help, laptop charging, demo checks).

Practised the Vungu system demo for council officers.

Helped fix a label printer used for Hub visitor badges.""",
"""I learnt how demos fail if power, printer or Wi-Fi is not ready.

I learnt to keep a short demo script so officers are not lost.

I learnt badge/label printer basics."""
),
(
"Week 8\n13/04/26-\n17/04/26",
"""Formal demo of the planning system to Vungu officers. Demo was accepted as ready for further work.

Collected feedback: stand names on the map, sold vs free stands, paper registers still missing.

Attended Hub debrief presentation after the demo.

Helped clean up the meeting room AV and a stuck projector cable.""",
"""I learnt to listen to client feedback without arguing.

I learnt that AV and projector fixing is part of Hub presentation support.

I learnt which features officers care about most."""
),
(
"Week 9\n20/04/26-\n24/04/26",
"""Started reading the Zimbabwe Development Management Handbook 2021.

Compared the Handbook to our database tables and listed missing ones.

Hub writing workshop on how to write simple technical reports.

Helped at a student support expo: directed visitors and restarted a dead display laptop.""",
"""I learnt how a law/handbook document drives what tables we need.

I learnt to write reports in plain English from the workshop.

I learnt expo floor support (crowd flow, dead laptops)."""
),
(
"Week 10\n27/04/26-\n01/05/26",
"""Designed new database tables for inspections and certificates.

Wrote SQL create scripts and showed them to Dr Paradzayi.

Attended a Hub research presentation by another student (good example for my own slides).

Fixed Hub boardroom printer duplex settings before a meeting.""",
"""I learnt to check table design with my supervisor before coding everything.

I learnt presentation structure by watching others.

I learnt duplex/printer meeting prep."""
),
(
"Week 11\n04/05/26-\n08/05/26",
"""Checked new tables for normal form (3NF) in simple steps.

Started Development Control Matrix work from the council spreadsheet.

Hub workshop on Excel to database thinking.

Supported printer driver install on a new staff PC.""",
"""I learnt what 3NF means on a real table, not only in class.

I learnt how spreadsheets become database rows.

I practised clean driver installs on new PCs."""
),
(
"Week 12\n11/05/26-\n15/05/26",
"""Finished DCM data dictionary and SQL vs NoSQL short research note.

Document verification research for IDs and title deeds.

Presented progress to Dr Paradzayi and Rafiq.

Helped set up a small Hub workshop room (extension leads, printer test page).""",
"""I learnt to explain SQL vs NoSQL in simple words for Hub reviews.

I learnt what documents the council asks applicants to bring.

I learnt room setup for workshops."""
),
(
"Week 13\n01/06/26-\n05/06/26",
"""Reviewed with Dr Paradzayi what is still missing for go-live (rates clearance, by-law register, and other paper registers).

Fixed staff login after tenancy changes broke it.

Stand identify API: show sold/available and owner name on map click.

Attended MSU support expo prep meeting. Listed what our stand needs (power, demo user, printed flyer).

Fixed a Hub corridor printer offline error.""",
"""I learnt not to claim a feature if it is not in the code.

I learnt how login and database columns must match.

I learnt expo prep checklists."""
),
(
"Week 14\n08/06/26-\n12/06/26",
"""Seeded test owner data so the map is not empty.

Wrote a simple deploy check script that logs in as demo users and hits main APIs.

Synced with Theophelos on portal screens.

Helped during Hub visitor day: printed visitor slips and cleared a paper jam.

Short presentation of the deploy check to the team.""",
"""I learnt to write checks other students can re-run.

I learnt printer paper jam clearing under time pressure.

I practised short technical talks."""
),
(
"Week 15–16\nJuly 2026\n(summary)",
"""Database clean-up docs and lookup tables.

Helped Theophelos with GIS layer list and tile checks.

Attended Hub mid-year project presentations.

IT support: printers, one scanner install, Wi-Fi password reset for a visiting student.

Workshop on backup and restore of PostgreSQL.""",
"""I learnt that quiet months are for docs and clean data.

I learnt scanner install and basic Wi-Fi user support.

I learnt pg_dump / restore in the workshop."""
),
(
"Week 17–18\nAugust 2026\n(summary)",
"""Planned statutory register tables for Vungu (by-laws, district plan, rates clearance, etc.).

QGIS to web map checks with Theophelos.

Attended a Hub innovation pitching afternoon as support (timer, slides clicker, spare laptop).

Fixed two printers before the pitching session.""",
"""I learnt to design tables from the Rural District Councils Act in plain language.

I learnt event support roles at pitching sessions.

I learnt to test printers the day before an event."""
),
(
"Week 19\n14/09/26-\n18/09/26",
"""Restored the local Vungu database after a bad laptop shutdown.

Documented restore steps for the Hub team.

Started packaging SpartialIQ Local desktop app for Dr Paradzayi.

Helped at MSU Expo stand packing: banners, power strips, printed handouts.

Printer fix on the Expo practice laptop.""",
"""I learnt restore drills matter before demos.

I learnt desktop packaging basics (Tauri installer).

I learnt Expo stand packing and printer checks."""
),
(
"Week 20\n21/09/26-\n25/09/26",
"""More API and map tests with Theophelos (HDR stands sold vs free).

Drafted migration for council registers.

Hub workshop on speaking to council and community visitors.

Supported a small printer networking issue in the Hub admin office.""",
"""I learnt to test with real stand numbers from seed data.

I learnt simpler language for community visitors.

I learnt office printer network sharing."""
),
(
"Week 21\n12/10/26-\n16/10/26",
"""Built statutory registers in the database and API (by-laws, annual district plan, compulsory acquisition, rates clearance, expense recovery).

Staff page for registers. Citizen page to request rates clearance.

Ran button crawl tests for all demo roles.

Built Windows installer for SpartialIQ Local and copied it for Dr Paradzayi.

Presented October progress at Hub review. Helped fix the meeting room printer before the session.""",
"""I learnt how council paper registers become screens and APIs.

I learnt automated click tests save demo day stress.

I learnt to ship an installer so others do not install Node by hand.

I practised Hub review presentations under a real deadline."""
),
(
"Week 22\n18/10/26",
"""Production prep: sample env file, block demo logins in production mode, runtime database user, owner import script, database restore script.

Acua ~300 m² sub-plots inside bigger stands on the map.

Fixed login failure caused by full disk (cleared old backups, restarted Postgres).

Supported Hub printer after the review (toner/replace cartridge help with admin staff).""",
"""I learnt production checklist items (env, roles, restore).

I learnt sub-plots can sit in a child table without breaking parent stands.

I learnt disk space can take the whole system down.

I learnt basic toner/cartridge support for Hub printers."""
),
]

for date_label, work, learnt in weeks:
    week_table(date_label, work, learnt)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("END OF LOGBOOK")
sf(r, size=12, bold=True)
p2 = doc.add_paragraph()
p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
r2 = p2.add_run("Period: 23 February 2026 to 18 October 2026\nMSU Research and Innovation Hub — Vungu RDC GIS / SpartialIQ")
sf(r2, size=10, italic=True)

out = r"c:\Users\munya\Desktop\finale\WRL 2\WRL\Munyaradzi_Namailinga_Logbook_v6.docx"
doc.save(out)
for dest in [
    r"c:\Users\munya\Desktop\finale\WRL 2\Munyaradzi_Namailinga_Logbook_v6.docx",
    r"c:\Users\munya\Desktop\Munyaradzi_Namailinga_Logbook_v6.docx",
]:
    try:
        shutil.copy2(out, dest)
        print("Copied:", dest)
    except Exception as e:
        print("Copy skipped", dest, e)
print("Saved:", out)
