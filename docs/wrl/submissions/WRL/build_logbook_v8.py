"""
Munyaradzi Namailinga logbook v8 — Theophelos format.
Every week expanded (no summary blocks). Hub events aligned with
Musawenkosi Ngulube's Hub calendar (ZITF, Expo, hackathons, pitching)
but work stays on Vungu GIS / SpartialIQ.
"""
from __future__ import annotations

from datetime import date, timedelta
from docx import Document
from docx.shared import Pt, Inches
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_ALIGN_PARAGRAPH
import shutil

OUT = r"c:\Users\munya\Desktop\finale\WRL 2\WRL\Munyaradzi_Namailinga_Logbook_v8.docx"

HOLIDAYS = {
    date(2026, 4, 3): "Good Friday — public holiday. No work logged.",
    date(2026, 4, 6): "Easter Monday — public holiday. No work logged.",
    date(2026, 4, 18): "Independence Day — public holiday. No work logged.",
    date(2026, 5, 1): "Workers Day — public holiday. No work logged.",
    date(2026, 5, 25): "Africa Day — public holiday. No work logged.",
    date(2026, 8, 10): "Heroes Day — public holiday. No work logged.",
    date(2026, 8, 11): "Defence Forces Day — public holiday. No work logged.",
}

MONTHS = [
    "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER",
]

doc = Document()
section = doc.sections[0]
section.left_margin = Inches(1.2)
section.right_margin = Inches(1.0)
section.top_margin = Inches(1.0)
section.bottom_margin = Inches(1.0)


def font(run, size=10, bold=False):
    run.bold = bold
    run.font.size = Pt(size)
    run.font.name = "Times New Roman"


def cen(text, size=12, bold=False):
    p = doc.add_paragraph()
    run = p.add_run(text)
    font(run, size, bold)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER


def bold_para(text, size=11):
    p = doc.add_paragraph()
    run = p.add_run(text)
    font(run, size, True)


def dotline():
    p = doc.add_paragraph()
    r = p.add_run(
        "................................................................................................................................................................\n"
        "................................................................................................................................................................"
    )
    font(r, 10)


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


def add_week_table(date_text, desc_text, comm_text):
    tbl = doc.add_table(rows=2, cols=3)
    tbl.style = "Table Grid"
    tblPr = tbl._tbl.find(qn("w:tblPr"))
    if tblPr is not None:
        lk = OxmlElement("w:tblLook")
        lk.set(qn("w:noHBand"), "1")
        lk.set(qn("w:noVBand"), "1")
        tblPr.append(lk)
    for i, h in enumerate(["DATE", "DESCRIPTION OF WORK DONE", "STUDENT'S COMMENTS"]):
        cell = tbl.rows[0].cells[i]
        cell.text = ""
        run = cell.paragraphs[0].add_run(h)
        font(run, 10, True)
        _white_cell(cell)
    for i, text in enumerate((date_text, desc_text, comm_text)):
        cell = tbl.rows[1].cells[i]
        cell.text = ""
        run = cell.paragraphs[0].add_run(text)
        font(run, 10)
        _white_cell(cell)
    doc.add_paragraph()


def fmt_day(d: date) -> str:
    return d.strftime("%a %d %b")


def week_label(n: int, mon: date, fri: date) -> str:
    return f"WEEK {n}\n{fmt_day(mon)}\n{fmt_day(fri)} {fri.year}"


# ── Week content: (work_lines_by_weekday_or_None, comments)
# Keys 0=Mon .. 4=Fri. Holiday days omitted / replaced at build time.
# Extra Hub events from Musawenkosi calendar noted in titles.

WEEKS: dict[int, tuple[dict[int, tuple[str, str]], str]] = {}

def W(n, days, comments):
    """days: dict weekday-> (title, body paragraphs joined)"""
    WEEKS[n] = (days, comments)


W(1, {
    0: ("Project Orientation at the Hub",
        "Met Dr Paradzayi at the MSU Research and Innovation Hub. He explained the Vungu Rural District Council GIS project and Education 5.0 expectations. My role is backend and database. Theophelos handles screens and map. I wrote short notes on wards, permits and stands."),
    1: ("Innovation pitching and IP briefing",
        "Attended the Hub innovation pitching and intellectual property briefing (same induction track other Hub students such as Musawenkosi use). Noted how student projects are screened before expos. Linked this to how we must present the GIS system honestly."),
    2: ("Old backend code review",
        "Read the old Vungu backend with Theophelos. Found weak password storage and database passwords in the code. Listed defects for Dr Paradzayi."),
    3: ("Laptop setup and printer support",
        "Installed Node.js, PostgreSQL, PostGIS tools and Git. Helped a Hub staff member reinstall a printer driver and print a test page."),
    4: ("Team roles meeting",
        "Team meeting with Dr Paradzayi and Theophelos. Agreed Git branches. Confirmed I own API and database. Planned March security work."),
}, "I learnt how the Hub runs pitching and IP rules before any expo. I learnt my GIS role clearly. Printer support is normal Hub work.")

W(2, {
    0: ("PostGIS reading",
        "Read simple PostGIS notes on storing polygons and points. Sketched how ward and stand shapes will sit in the database for Vungu."),
    1: ("Password hashing start",
        "Started changing login so passwords use bcrypt instead of plain text. Tested one demo user locally."),
    2: ("ICT printer workshop",
        "Attended Hub ICT workshop on Windows printers and print queues. Practised clearing a stuck queue on a training PC."),
    3: ("API health check",
        "Brought the Fastify API up locally. Checked the health route with Theophelos. Logged one Wi-Fi support request for a visiting student."),
    4: ("Monthly readiness notes start",
        "Started a short monthly readiness note for Hub management on GIS progress (same reporting habit used across Hub projects). Fixed duplex settings on the boardroom printer before a meeting."),
}, "I learnt PostGIS stores map shapes in the database. I learnt printer queues from the workshop. I learnt Hub monthly readiness notes keep supervisors informed.")

W(3, {
    0: ("Security package audit",
        "Ran a package audit on the backend. Listed known issues to clear before new GIS features."),
    1: ("Secrets moved to env file",
        "Moved database passwords out of source code into an env file. Updated .gitignore. Rotated the local password."),
    2: ("Input checks on public routes",
        "Added simple schema checks on public API routes used by the citizen map and application forms."),
    3: ("Hub open afternoon support",
        "Helped at a Hub open afternoon. Showed visitors a simple ward map demo. Printed handouts after fixing wrong paper size on the reception printer."),
    4: ("Site visit planning",
        "Planned the Vungu RDC visit with Rafiq. Listed questions for planning officers about paper registers and stand allocation."),
}, "I learnt secrets must not sit in Git. Expo-style open days need a working printer. Planning questions before a site visit saves time.")

W(4, {
    0: ("Ward statistics API",
        "Worked on ward statistics endpoint so officers can see application counts per ward."),
    1: ("Application status history",
        "Added application status history so each change stores officer and time."),
    2: ("Site visit to Vungu RDC",
        "Visited Vungu planning offices. Listened to how permits and stands are handled on paper. Took notes for the GIS data model."),
    3: ("Visit notes write-up",
        "Wrote visit notes for Dr Paradzayi. Marked sold versus free stands and register gaps as future work."),
    4: ("Friday presentation",
        "Presented visit findings with Theophelos. Helped reconnect a Hub network printer after a Windows update."),
}, "I learnt council paper work shapes the GIS design. Windows updates often break printers. Short presentations work better than long slides.")

W(5, {
    0: ("Docker compose for GIS stack",
        "Wrote a simple Docker compose file for PostgreSQL/PostGIS and the API so the Hub team starts the GIS stack the same way."),
    1: ("BACKEND_GUIDE draft",
        "Wrote BACKEND_GUIDE steps in plain English for new Hub students joining the Vungu project."),
    2: ("Git workshop",
        "Attended Hub Git workshop on branches and pull requests. Applied the rules to the GIS repository."),
    3: ("Shared printer between offices",
        "Helped fix a printer shared between two Hub offices. Tested a page from each PC."),
    4: ("Demo slide prep",
        "Prepared April demo slides for the Vungu GIS system. Checked map tile load with Theophelos."),
}, "I learnt Docker keeps the GIS stack consistent. Git workshops stop broken main branches. Shared printers need both PCs tested.")

W(6, {
    0: ("API integration tests",
        "Wrote API tests for login and stand lookup used by the GIS portal."),
    1: ("HTTPS check on server",
        "Checked HTTPS certificates on the project server with the team."),
    2: ("ZITF Pitching Challenge support",
        "Supported the Hub at the ZITF Pitching Challenge track (same Hub event Musawenkosi lists). Helped with stand power, laptop charging and a quick GIS map check. Fixed a label printer for visitor badges. I did not pitch a separate product — support was for Hub logistics and our GIS demo readiness."),
    3: ("Demo script practice",
        "Practised a short Vungu GIS demo script for council officers. Timed the stand identify click path."),
    4: ("Good Friday", None),
}, "I learnt ZITF days fail on power and printers if you do not check early. A short GIS demo script keeps officers with you.")

W(7, {
    0: ("Easter Monday", None),
    1: ("API polish after holiday",
        "Fixed small API bugs found in practice. Checked GeoJSON responses Theophelos needs for the map."),
    2: ("Stand data seed check",
        "Checked seed stands for the demo wards. Corrected two wrong labels."),
    3: ("Formal demo to Vungu officers",
        "Presented the GIS system with Theophelos and Dr Paradzayi. Officers accepted it as ready for more work. They asked for sold versus free stands and digital registers."),
    4: ("Hub debrief after demo",
        "Hub debrief presentation. Logged officer feedback into the work list. Helped clean meeting room AV and a stuck projector cable."),
}, "I learnt to listen to officers without arguing. AV support is part of Hub presentation days. Feedback drives the next GIS sprint.")

W(8, {
    0: ("Handbook study day 1",
        "Started the Zimbabwe Development Management Handbook 2021. Mapped chapters to GIS tables we already have."),
    1: ("Gap list versus schema",
        "Compared Handbook needs to the database. Listed missing tables for inspections and certificates."),
    2: ("Independence weekend note",
        "Independence Day fell on Saturday 18 April. Used Friday for Handbook mapping and GIS field checklist before the long weekend."),
    3: ("Writing workshop",
        "Attended Hub report writing workshop on plain English. Redrafted one GIS progress paragraph."),
    4: ("Student support expo help",
        "Helped at a campus support expo linked to Hub projects. Directed visitors to the GIS stand laptop and restarted a dead display PC."),
}, "I learnt the Handbook drives GIS tables. Plain English is clearer for Hub reviews. Expo laptops need a spare charger.")

W(9, {
    0: ("Inspection table design",
        "Designed inspection tables for the GIS database. Wrote draft SQL create scripts."),
    1: ("Certificate of occupation table",
        "Designed certificate of occupation fields linked to applications."),
    2: ("Supervisor SQL review",
        "Showed SQL drafts to Dr Paradzayi. Adjusted two foreign keys."),
    3: ("Peer research presentation",
        "Attended a Hub research presentation by another student (innovation track). Noted slide structure for my own GIS talks."),
    4: ("Boardroom printer duplex",
        "Fixed boardroom printer duplex before a Hub meeting. Printed GIS schema pages for review."),
}, "I learnt to check SQL with the supervisor early. Watching other Hub presenters improves my own GIS talks.")

W(10, {
    0: ("3NF check on new tables",
        "Checked new GIS tables in simple third normal form steps. Wrote short notes."),
    1: ("Development Control Matrix start",
        "Started turning the council Development Control Matrix spreadsheet into database rows."),
    2: ("Excel to database workshop",
        "Attended Hub workshop on Excel to database thinking. Applied it to the matrix."),
    3: ("Printer driver on new staff PC",
        "Installed a printer driver on a new Hub staff PC and tested GIS handout printing."),
    4: ("Workers Day", None),
}, "I learnt 3NF on real GIS tables. Spreadsheets become rows carefully. New PCs need drivers before meetings.")

W(11, {
    0: ("DCM relations",
        "Finished splitting the Development Control Matrix into land use group, zone and permission tables."),
    1: ("DCM data dictionary",
        "Wrote DCM data dictionary entries for the GIS schema."),
    2: ("SQL versus NoSQL note",
        "Wrote a short note on why PostGIS fits the Vungu GIS system better than a document store for stands and wards."),
    3: ("Document verification reading",
        "Read about ID and title deed checks for permit uploads that attach to GIS applications."),
    4: ("Progress presentation",
        "Presented May progress to Dr Paradzayi and Rafiq. Helped set workshop room leads and a printer test page."),
}, "I learnt to explain PostGIS in simple words. Document checks matter for permit files linked to map stands.")

W(12, {
    0: ("Document verification note finish",
        "Finished the document verification note for Hub review. Linked it to GIS application uploads."),
    1: ("API contract sync with Theophelos",
        "Synced API response shapes for new screens. Fixed one date format bug."),
    2: ("Tourism Scholastica Hub support day",
        "Supported Hub logistics during Tourism Scholastica activity week (event on Musawenkosi's Hub record). I stayed on GIS: kept the Vungu demo laptop ready and printed visitor slips. Did not build TourLink."),
    3: ("Tile layer list check",
        "Checked GIS tile layer IDs with Theophelos after new master plan layers arrived."),
    4: ("Printer jam during visitor morning",
        "Cleared two printer jams during a Hub visitor morning. Gave a two-minute GIS map tour to visitors."),
}, "I learnt Hub competition weeks still need GIS demos ready. Visitor mornings mix support and short map tours.")

W(13, {
    0: ("Lookup schema tidy",
        "Tidied lookup tables used by the GIS API. Removed duplicate status values."),
    1: ("Data dictionary comments in SQL",
        "Added SQL comments on key GIS tables for the Hub data dictionary pack."),
    2: ("Bulawayo Robotics Challenge support",
        "Helped Hub transport packing for students going to the Bulawayo Robotics Challenge (Hub event on Musawenkosi's list). Charged spare power banks. My technical work that day remained GIS API tests — I did not build the robot."),
    3: ("Stand locate bug",
        "Fixed parcel locate so HDR stands still resolve when a click is near the boundary."),
    4: ("Friday GIS demo for Hub peers",
        "Short Friday demo of stand identify for other Hub students. Collected questions for next sprint."),
}, "I learnt Hub challenge weeks need logistics help. Boundary clicks need careful GIS queries.")

W(14, {
    0: ("Africa Day", None),
    1: ("Handbook annex cross-check",
        "Cross-checked Handbook annex forms against GIS application fields still missing."),
    2: ("Seed owner names",
        "Prepared seed allottee names for demo stands so the map is not empty in June demos."),
    3: ("Hub mid-month pitching practice",
        "Attended Hub pitching practice afternoon. Timed a three-minute GIS pitch. Fixed a clicker laptop."),
    4: ("Printer offline in corridor",
        "Cleared a Hub corridor printer offline error. Printed updated GIS feedback list."),
}, "I learnt a three-minute GIS pitch for Hub practice. Printer offline errors are often just restart and default tray.")

W(15, {
    0: ("Honest gap list with supervisor",
        "Reviewed with Dr Paradzayi which GIS use cases are still missing in code: rates clearance, by-law register and related registers."),
    1: ("Tenancy login break",
        "Staff login failed after tenancy settings changed. Traced missing user columns."),
    2: ("Login columns fixed",
        "Added authority and platform flags. Confirmed planners can open GIS staff routes again."),
    3: ("Stand identify with allottee",
        "Extended stand identify so map click shows sold or free and allottee name for Vungu officers."),
    4: ("MSU support expo prep meeting",
        "Attended MSU support expo prep (Hub multi-project expo). Listed power, demo user and flyer needs for the GIS stand."),
}, "I learnt not to claim GIS features that are not in code. Login and schema must change together. Expo prep needs a checklist.")

W(16, {
    0: ("Deploy readiness script start",
        "Started e2e deploy readiness checks for GIS health, login roles and stand identify."),
    1: ("Demo role logins",
        "Scripted demo role logins used on the GIS portal. Fixed one clerk password reset."),
    2: ("Owner seed load",
        "Loaded seed owners for HDR demo stands. Verified identify on two stands with Theophelos."),
    3: ("Hub visitor day",
        "Hub visitor day support: printed slips, cleared a paper jam, ran the GIS map for guests."),
    4: ("Deploy check presentation",
        "Short talk to the team on the deploy check script. Noted which GIS checks still skip."),
}, "I learnt automated GIS checks catch demo day surprises. Visitor days mix printing and live map demos.")

W(17, {
    0: ("Land use API pool fix",
        "Fixed land-use API 500 error caused by a bad database pool reference under tenancy."),
    1: ("Development applications list",
        "Reworked development applications list to match the modern schema used by GIS planners."),
    2: ("InsurTech week awareness at Hub",
        "Hub briefed teams about the upcoming MSU SRC InsurTech Hackathon hosted with Cell Insurance (on Musawenkosi's event list). I stayed on GIS — offered printer and room support only, no InsurTech product work."),
    3: ("Citizen map card sync",
        "Synced sold/available fields on the citizen map card with Theophelos."),
    4: ("Monthly readiness report June",
        "Submitted June monthly readiness note for Hub management covering GIS gaps closed and still open."),
}, "I learnt Hub hackathon weeks pull shared rooms and printers. My product work stayed on Vungu GIS.")

W(18, {
    0: ("Register table design",
        "Designed council_ops tables for by-laws, annual district plan, compulsory acquisition, rates clearance and expense recovery."),
    1: ("DDL draft review",
        "Reviewed draft DDL with Dr Paradzayi. Adjusted rates clearance status values."),
    2: ("QGIS pipeline check",
        "Helped Theophelos check QGIS to web coverage for master plan layers used in GIS."),
    3: ("Pitching afternoon support",
        "Supported Hub pitching afternoon: timer, slide clicker, spare laptop. Printed judge packs. Kept GIS laptop charged for later."),
    4: ("Two printers before pitching",
        "Fixed two Hub printers the morning of pitching so handouts worked."),
}, "I learnt register design should follow the Act in plain words. Pitching support is logistics as much as slides.")

W(19, {
    0: ("MVT catalog growth",
        "Checked MVT catalog after new GIS layers. Noted missing grants for the app role."),
    1: ("Grants for vungu_app",
        "Granted select on new spatial tables to vungu_app. Retested tiles."),
    2: ("Cimas Healthathon awareness",
        "Hub mentioned Cimas Healthathon applications (Musawenkosi track). I logged interest for Hub support only and continued GIS register SQL."),
    3: ("Rates clearance flow sketch",
        "Sketched citizen lodge and staff issue/refuse flow for section 109 rates clearance in GIS."),
    4: ("Friday schema demo",
        "Showed register schema to Theophelos for upcoming staff UI."),
}, "I learnt tile grants break maps quietly. Rates clearance needs both citizen and staff paths.")

W(20, {
    0: ("Postgres backup workshop",
        "Attended Hub workshop on PostgreSQL dump and restore. Practised on a small GIS copy."),
    1: ("Lookup consolidation migration",
        "Applied a lookup consolidation migration on the local GIS database."),
    2: ("Scanner install support",
        "Installed a scanner for Hub admin. Scanned one signed GIS feedback sheet."),
    3: ("Wi-Fi password reset",
        "Reset Wi-Fi access for a visiting student so they could view the GIS demo."),
    4: ("Mid-year Hub presentations",
        "Attended Hub mid-year project presentations. Presented a short GIS status. Noted how other teams such as health and AI tracks report progress."),
}, "I learnt restore before you need it. Mid-year Hub talks show many projects; mine stays GIS.")

W(21, {
    0: ("Deploy check expansion",
        "Expanded deploy checks for permits and complaints linked to GIS parcels."),
    1: ("Honest SKIP flags",
        "Kept honest SKIP on unfinished register checks instead of fake passes."),
    2: ("Symbology registry support",
        "Helped Theophelos confirm symbology registry IDs against backend layer names."),
    3: ("Hub IP reminder session",
        "Attended Hub IP reminder session for student projects. Confirmed Vungu GIS IP sits with the university–council engagement."),
    4: ("Printer toner help",
        "Helped replace toner before a Hub reporting deadline. Printed GIS readiness pages."),
}, "I learnt fake passes hide GIS gaps. IP sessions clarify who owns student Hub work.")

W(22, {
    0: ("E-ChroniBook Hub showcase afternoon",
        "Attended Hub showcase where peers presented product releases (including health track releases noted on Musawenkosi's record). I presented only GIS stand identify and register plans — not their product."),
    1: ("Compulsory acquisition fields",
        "Filled compulsory acquisition register fields in SQL comments and sample rows."),
    2: ("By-law register sample",
        "Inserted sample by-law rows for demo council data."),
    3: ("Annual district plan sample",
        "Inserted sample annual district plan rows linked to year and ward notes."),
    4: ("July readiness report",
        "Submitted July monthly readiness report to Hub management for the GIS project."),
}, "I learnt Hub showcase days mix many products. I keep demos on Vungu GIS only.")

W(23, {
    0: ("Expense recovery draft API",
        "Drafted expense recovery list and create handlers for later wiring."),
    1: ("Citizen rates clearance wireframe check",
        "Walked citizen rates clearance fields with Theophelos before UI build."),
    2: ("Button list for future crawl",
        "Listed staff buttons that a future Playwright crawl must hit for GIS registers."),
    3: ("Hub open lab mentoring",
        "Helped two junior Hub students open the GIS demo and explain stands versus parcels."),
    4: ("Network printer share fix",
        "Fixed admin office printer sharing so GIS handouts print from both desks."),
}, "I learnt mentoring juniors forces clearer GIS words. Printer shares break after Windows user changes.")

W(24, {
    0: ("Desktop shell prep",
        "Started Tauri desktop packaging notes so SpartialIQ Local can run without Node for Dr Paradzayi."),
    1: ("Absolute API URLs for desktop",
        "Confirmed map and API calls use absolute local URLs inside the desktop shell."),
    2: ("InsurTech hackathon Hub hosting support",
        "Supported Hub hosting duties around the MSU SRC InsurTech Hackathon (Musawenkosi event). Room setup, spare HDMI, printer test pages. No Fiscora or insurance coding — GIS work continued in the evening on register migrations."),
    3: ("Migration 181 draft",
        "Drafted migration 181 for council statutory registers."),
    4: ("August readiness note",
        "Submitted August readiness note focusing on register migration readiness."),
}, "I learnt hackathon hosting is Hub service. My product line remains the GIS registers and desktop shell.")

W(25, {
    0: ("Heroes Day", None),
    1: ("Defence Forces Day", None),
    2: ("Register migration apply",
        "Applied council_ops register migration on local GIS database. Granted privileges to vungu_app."),
    3: ("Register API routes",
        "Implemented /api/registers routes for the five statutory registers."),
    4: ("Route registration in server",
        "Registered the registers plugin in server.js. Smoke-tested create and list."),
}, "I learnt public holidays pause logging. After the break, register APIs move from paper talk to code.")

W(26, {
    0: ("StatutoryRegistersView wiring",
        "Helped wire staff StatutoryRegistersView tabs to the new GIS register APIs with Theophelos."),
    1: ("Rates clearance lodge path",
        "Citizen lodge path for section 109 rates clearance linked to stand reference."),
    2: ("Staff issue and refuse",
        "Staff issue or refuse rates clearance from the register screen. Logged officer id."),
    3: ("Hub pitching finals support",
        "Supported another Hub pitching session: timer and spare laptop. Printed scoring sheets."),
    4: ("GIS register demo to peers",
        "Friday demo of rates clearance to Hub peers for feedback."),
}, "I learnt registers need both citizen and staff sides. Peer demos catch unclear labels early.")

W(27, {
    0: ("Deploy checks require registers",
        "Changed deploy readiness so register use cases are required PASS, not SKIP."),
    1: ("Playwright crawl start",
        "Started Playwright button crawl for demo roles on GIS portals."),
    2: ("Crawl clerk and planner",
        "Crawled clerk and planner paths including statutory registers."),
    3: ("Crawl citizen rates clearance",
        "Crawled citizen rates clearance lodge. Fixed one selector."),
    4: ("Monthly readiness September draft",
        "Drafted September readiness content covering registers and crawl results."),
}, "I learnt required checks stop silent GIS gaps. Crawls find selector drift after UI edits.")

W(28, {
    0: ("MSU Expo packing day",
        "Packed Hub expo materials for MSU Expo Gweru (Musawenkosi exhibitor event). Banners, power strips, GIS handouts, spare HDMI."),
    1: ("Expo practice laptop printer",
        "Fixed printer on the expo practice laptop. Printed GIS one-pagers."),
    2: ("MSU Expo Gweru — GIS exhibitor",
        "Exhibited the Vungu GIS / SpartialIQ system at MSU Expo. Answered visitor questions on stands, wards and permits. Supported neighbouring Hub stands with a spare cable when asked."),
    3: ("Expo feedback capture",
        "Wrote Expo visitor questions into the GIS backlog (stand names, rates clearance, offline worries)."),
    4: ("Team Expo debrief",
        "Hub Expo debrief. Shared GIS visitor themes with Dr Paradzayi and Theophelos."),
}, "I learnt Expo days are long standing demos. Visitor questions are real requirements for GIS.")

W(29, {
    0: ("Database crash restore",
        "Restored local vungu database after unclean laptop shutdown. Documented steps for Hub team."),
    1: ("Restore drill second pass",
        "Repeated restore drill with a 50 MB dump style practice for GIS data."),
    2: ("Installer beforeBuild notes",
        "Checked desktop beforeBuild script copies backend resources for SpartialIQ Local."),
    3: ("22-slide style progress talk",
        "Prepared a longer Hub progress talk (same reporting style peers use for managers). Kept slides on GIS only: registers, expo feedback, installer."),
    4: ("Admin printer network issue",
        "Supported Hub admin printer networking issue. Printed progress talk handouts."),
}, "I learnt restore drills beat panic. Long Hub talks still need one clear GIS story.")

W(30, {
    0: ("HDR sold versus free tests",
        "Retested HDR-004 and HDR-105 sold versus free identify with Theophelos."),
    1: ("Acua product request notes",
        "Took notes on Acua about 300 square metre sub-plots under parent stands for GIS allocation."),
    2: ("Visitor language workshop",
        "Hub workshop on speaking to council and community visitors. Practised GIS explanations without jargon."),
    3: ("Custodian route scaffolds",
        "Scaffolded Surveyor-General and Deeds notice routes for later GIS custodian work."),
    4: ("September readiness submit",
        "Submitted September monthly readiness report including Expo and register PASS checks."),
}, "I learnt community visitors need simple GIS words. Sub-plots need a child table design.")

W(31, {
    0: ("stand_subunit design",
        "Designed stand_subunit so Acua plots do not overload the parent stands table."),
    1: ("Seed polygon plan",
        "Planned seed polygons for about fifty-nine Acua units inside parent stands."),
    2: ("Property owner import script",
        "Started import-property-owners.js so real Vungu Finance data can replace seed owners later."),
    3: ("Runtime role notes",
        "Documented non-superuser vungu_runtime role for safer local GIS ops."),
    4: ("Printer test before October reviews",
        "Tested meeting room printer ahead of October Hub reviews."),
}, "I learnt child tables keep parent stands clean. Import scripts matter before go-live.")

W(32, {
    0: ("Production env example",
        "Wrote .env.production.example for GIS deployment. Listed required secrets."),
    1: ("Block demo logins in production",
        "Blocked @vungu.test demo logins when NODE_ENV is production."),
    2: ("Acua migration coding",
        "Coded migration seeding Acua stand_subunit polygons and MVT layer acua_stands."),
    3: ("Map toggle with Theophelos",
        "Citizen map toggle for Acua layer. Identify prefers subunits when present."),
    4: ("October readiness draft",
        "Drafted October readiness covering Acua, production gates and installer."),
}, "I learnt demo accounts must not work in production. Subunit identify must prefer the small plot.")

W(33, {
    0: ("Installer build",
        "Built SpartialIQ Local Windows installer for Dr Paradzayi. Copied the setup file for Hub use."),
    1: ("USE-CASES honesty pass",
        "Updated use-case notes so GIS claims match code after registers and Acua."),
    2: ("DEPLOY_READINESS update",
        "Updated DEPLOY_READINESS with restore, runtime role and installer paths."),
    3: ("Full button crawl rerun",
        "Reran Playwright crawl across demo roles. Recorded passes for GIS nav and registers."),
    4: ("Hub review presentation",
        "Presented October GIS progress at Hub review. Fixed meeting room printer before the session."),
}, "I learnt installers remove Node setup pain for supervisors. Honesty in use-case docs protects Hub trust.")

W(34, {
    0: ("API gate final",
        "Ran full API deploy gate. Aimed for all GIS checks green including registers."),
    1: ("Disk full incident",
        "Demo login failed. Disk was full from old backups. Cleared space, restarted Postgres, login worked again."),
    2: ("Owner import dry run",
        "Dry-ran property owner import against sample CSV shape for Vungu Finance handoff."),
    3: ("Restore script finalise",
        "Finalised restore-db.js notes for Hub operators."),
    4: ("Close-out with supervisor",
        "Closed the week with Dr Paradzayi on GIS go-live leftovers: real Property File, Turnstile secrets, and signed desktop updates. Helped Hub admin with toner after the review."),
}, "I learnt disk space can stop the whole GIS stack. Go-live leftovers are data and secrets, not more demo features.")


def build_days(mon: date, day_map: dict[int, tuple[str, str] | None]) -> str:
    parts = []
    for i in range(5):
        d = mon + timedelta(days=i)
        if d in HOLIDAYS:
            parts.append(f"Day {i+1} ({fmt_day(d)}) - Public holiday\n{HOLIDAYS[d]}")
            continue
        entry = day_map.get(i)
        if not entry:
            continue
        title, body = entry
        if body is None:
            # title-only holiday style already handled
            parts.append(f"Day {i+1} ({fmt_day(d)}) - {title}")
            continue
        parts.append(f"Day {i+1} ({fmt_day(d)}) - {title}\n{body}")
    return "\n\n".join(parts)


# ===== COVER =====
cen("MIDLANDS STATE UNIVERSITY", 13, bold=True)
cen("FACULTY OF INFORMATION SCIENCE AND TECHNOLOGY", 11, bold=True)
cen("DEPARTMENT OF COMPUTER SCIENCE", 11, bold=True)
doc.add_paragraph()
cen("INDUSTRIAL ATTACHMENT LOGBOOK", 13, bold=True)
doc.add_paragraph()

info_tbl = doc.add_table(rows=7, cols=2)
info_tbl.style = "Table Grid"
for i, (lbl, val) in enumerate([
    ("Name", "Munyaradzi Namailinga"),
    ("Reg Number", "R243100H"),
    ("Programme", "Bachelor of Science (Honours) in Computer Science"),
    ("Level", "3.1"),
    ("Attachment Organisation",
     "Midlands State University (Research and Innovation) / Faculty of Built Environment "
     "- Vungu RDC GIS Project"),
    ("Attachment Period", "23 February 2026 to 18 October 2026"),
    ("Industrial Supervisor", "Dr Paradzayi (Project Manager)"),
]):
    info_tbl.rows[i].cells[0].text = lbl
    info_tbl.rows[i].cells[1].text = val
    info_tbl.rows[i].cells[0].paragraphs[0].runs[0].bold = True
    for cell in info_tbl.rows[i].cells:
        for para in cell.paragraphs:
            for run in para.runs:
                font(run, 10)

doc.add_paragraph()
for m in MONTHS:
    month_block(f"MONTH: {m} 2026")

page_break()

# Build all 34 weeks
start = date(2026, 2, 23)
# collect Mondays
mondays = []
d = start
while d <= date(2026, 10, 16):
    if d.weekday() == 0:
        mondays.append(d)
    d += timedelta(days=1)

assert len(mondays) == 34, len(mondays)

current_month = None
for n, mon in enumerate(mondays, 1):
    fri = mon + timedelta(days=4)
    if mon.month != current_month:
        if current_month is not None:
            page_break()
        current_month = mon.month
        bold_para(f"MONTH: {mon.strftime('%B').upper()} 2026", 12)

    day_map, comments = WEEKS[n]
    desc = build_days(mon, day_map)
    add_week_table(week_label(n, mon, fri), desc, comments)
    # supervisor lines each week like Theo months — light touch: every 4 weeks
    if n % 4 == 0:
        for heading in ["Supervisor's Comments", "Supervisor's Signature", "Date"]:
            bold_para(heading, 10)
            dotline()

# Extra catch-up 18 Oct (Saturday noted in prior log)
page_break()
bold_para("ADDITIONAL ENTRY — Saturday 18 October 2026", 12)
add_week_table(
    "CATCH-UP\nSat 18 Oct 2026",
    (
        "Day 1 (Sat 18 Oct) - Production harden catch-up\n"
        "Finished remaining production prep on the Vungu GIS stack: confirmed demo login block, "
        "runtime role notes, Acua layer on citizen map, and API gate results. Confirmed the "
        "Windows installer copy for Dr Paradzayi. Short Hub check-in on go-live leftovers."
    ),
    (
        "I learnt catch-up days are for closing GIS ops items, not starting new products. "
        "The Hub calendar events I supported this year (ZITF, Expo, hackathon hosting, pitching) "
        "stayed support roles — my build work remained the Vungu GIS system."
    ),
)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("END OF LOGBOOK")
font(r, 11, True)

doc.save(OUT)
for dest in [
    r"c:\Users\munya\Desktop\finale\WRL 2\Munyaradzi_Namailinga_Logbook_v8.docx",
    r"c:\Users\munya\Desktop\Munyaradzi_Namailinga_Logbook_v8.docx",
]:
    try:
        shutil.copy2(OUT, dest)
        print("Copied:", dest)
    except Exception as e:
        print("Copy skipped", dest, e)
print("Saved:", OUT)
print("Weeks written:", len(mondays))
