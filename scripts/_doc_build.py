"""Builds the Vungu RDC SpartialIQ 'System Actors & Use-Cases Handbook' DOCX."""
import os
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
FLOWS = os.path.join(BASE, "flowcharts")

BLUE = RGBColor(0x09, 0x69, 0xda)
GREEN = RGBColor(0x2d, 0xa4, 0x4e)
PURPLE = RGBColor(0x82, 0x50, 0xdf)
DARK = RGBColor(0x24, 0x29, 0x2f)
GREY = RGBColor(0x57, 0x60, 0x6a)

doc = Document()

# ---- base styles ----
normal = doc.styles["Normal"]
normal.font.name = "Calibri"
normal.font.size = Pt(11)
normal.paragraph_format.space_after = Pt(6)
normal.paragraph_format.line_spacing = 1.12

for s in doc.sections:
    s.top_margin = Inches(0.9); s.bottom_margin = Inches(0.9)
    s.left_margin = Inches(0.9); s.right_margin = Inches(0.9)


def _shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hexcolor)
    tcPr.append(shd)


def h1(text, color=BLUE):
    p = doc.add_heading(level=1)
    r = p.add_run(text); r.font.color.rgb = color; r.font.size = Pt(18)
    r.font.name = "Calibri"; r.bold = True
    return p


def h2(text, color=DARK):
    p = doc.add_heading(level=2)
    r = p.add_run(text); r.font.color.rgb = color; r.font.size = Pt(14.5)
    r.font.name = "Calibri"; r.bold = True
    return p


def h3(text, color=BLUE):
    p = doc.add_heading(level=3)
    r = p.add_run(text); r.font.color.rgb = color; r.font.size = Pt(12)
    r.font.name = "Calibri"; r.bold = True
    return p


def para(text, italic=False, color=None, size=11, bold=False, after=6):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.italic = italic; r.bold = bold; r.font.size = Pt(size)
    if color is not None:
        r.font.color.rgb = color
    p.paragraph_format.space_after = Pt(after)
    return p


def bullet(text):
    p = doc.add_paragraph(style="List Bullet")
    p.add_run(text)
    p.paragraph_format.space_after = Pt(2)
    return p


def caption(text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(text); r.italic = True; r.font.size = Pt(9)
    r.font.color.rgb = GREY
    p.paragraph_format.space_after = Pt(10)
    return p


def page_break():
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def add_image(fname):
    path = os.path.join(FLOWS, fname)
    with Image.open(path) as im:
        wpx, hpx = im.size
    max_w, max_h = 6.4, 8.6
    w = max_w; h = w * hpx / wpx
    if h > max_h:
        h = max_h; w = h * wpx / hpx
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(path, width=Inches(w), height=Inches(h))
    return p


def table(headers, rows, widths=None, header_fill="0969da"):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"; t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for i, htxt in enumerate(headers):
        hdr[i].text = ""
        run = hdr[i].paragraphs[0].add_run(htxt)
        run.bold = True; run.font.color.rgb = RGBColor(0xff, 0xff, 0xff)
        run.font.size = Pt(10)
        _shade(hdr[i], header_fill)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ""
            run = cells[i].paragraphs[0].add_run(val)
            run.font.size = Pt(9.5)
    if widths:
        for r in t.rows:
            for i, wd in enumerate(widths):
                r.cells[i].width = Inches(wd)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


# ============================= TITLE PAGE =============================
tp = doc.add_paragraph(); tp.alignment = WD_ALIGN_PARAGRAPH.CENTER
tp.paragraph_format.space_before = Pt(90)
r = tp.add_run("VUNGU RURAL DISTRICT COUNCIL")
r.bold = True; r.font.size = Pt(15); r.font.color.rgb = GREY

tp = doc.add_paragraph(); tp.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = tp.add_run("SpartialIQ Information System")
r.font.size = Pt(14); r.font.color.rgb = GREY

tp = doc.add_paragraph(); tp.alignment = WD_ALIGN_PARAGRAPH.CENTER
tp.paragraph_format.space_before = Pt(24)
r = tp.add_run("System Actors and Use-Cases Handbook")
r.bold = True; r.font.size = Pt(30); r.font.color.rgb = BLUE

tp = doc.add_paragraph(); tp.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = tp.add_run("A one-page guide to every person who uses the system, "
               "split into internal council operations and external client operations")
r.italic = True; r.font.size = Pt(13); r.font.color.rgb = DARK

tp = doc.add_paragraph(); tp.alignment = WD_ALIGN_PARAGRAPH.CENTER
tp.paragraph_format.space_before = Pt(30)
r = tp.add_run("Internal operations  |  External client operations  |  Flowcharts")
r.font.size = Pt(11); r.font.color.rgb = GREY

tp = doc.add_paragraph(); tp.alignment = WD_ALIGN_PARAGRAPH.CENTER
tp.paragraph_format.space_before = Pt(120)
r = tp.add_run("Prepared for training, supervision and system documentation\n"
               "Version 1.0  -  October 2026")
r.font.size = Pt(10.5); r.font.color.rgb = GREY

page_break()

# ============================= INTRODUCTION =============================
h1("1.  How to read this handbook")
para("This handbook explains, in plain English, every person who works with the "
     "Vungu Rural District Council information system (known in the project as "
     "SpartialIQ). It is written from the roles and workflows that actually exist "
     "in the software, and it is organised around one clear split:")
bullet("Internal operations are the council's own protected workflow, where "
       "council staff receive records, carry out technical work, and make or "
       "support decisions. Citizens do not take part in this side directly.")
bullet("External operations are the public-facing services used by clients - "
       "residents, landowners, businesses and their representatives - who apply, "
       "pay, upload documents, communicate and track their own cases.")
para("The two sides meet through controlled hand-offs: a receipted application, "
     "an assigned task, a recorded decision, a formal notice, a payment, and a "
     "status update the client can see. Each actor below is given a full page "
     "covering who they are, what the law and good local-authority practice "
     "expect of them, exactly what they do inside the system, and the limits of "
     "their role.")
para("A role is a category of system account. It does not replace the legal "
     "authority, professional judgement or appointment of the person holding it. "
     "Council resolutions, adopted by-laws and the current wording of Acts always "
     "come first; this document is a training and supervision aid, not legal advice.",
     italic=True, color=GREY, size=10)

h2("1.1  The legal backbone")
para("Every activity in the system traces back to Zimbabwean law and to the "
     "council's own procedures. The main instruments are:")
table(["Instrument", "Why it matters here"],
      [["Regional, Town and Country Planning Act [Chapter 29:12]",
        "Master and local plans, development permits, subdivision, enforcement and appeals"],
       ["Rural District Councils Act [Chapter 29:13]",
        "Council powers, committees and the administration of the district"],
       ["Urban Councils Act [Chapter 29:15]",
        "Building permits and by-laws that shape inspection practice"],
       ["Public Health Act, 2018",
        "The council must appoint environmental health officers; premises, nuisances, food and burial"],
       ["Environmental Management Act [Chapter 20:27]",
        "Environmental impact and consultation requirements for certain developments"],
       ["Land Survey Act [Chapter 20:12] & Land Surveyors Act [Chapter 27:06]",
        "Licensed land surveyors; the Surveyor-General examines cadastral surveys"]],
      widths=[3.1, 3.6])

h2("1.2  Five best-practice principles built into the system")
bullet("Separation of duties - the person who assesses a case is not always the "
       "person who finally decides it.")
bullet("A complete file before determination - decisions are not recorded on "
       "incomplete or unregistered files.")
bullet("Records that survive staff change - everything is stored in the central "
       "database, not on one officer's computer.")
bullet("One spatial Single Source of Truth - no invented or duplicated map geometry.")
bullet("A lawful cadastral chain - planning permit, then licensed survey, then "
       "Surveyor-General, then Deeds. SpartialIQ supports this chain; it does not replace it.")

page_break()


# ============================= ACTOR MAP =============================
h1("2.  The full actor map")
para("The system recognises eleven account roles. Three are citizen-side access "
     "levels (public, registered, viewer) and eight are council staff roles. The "
     "table below is the master index for the rest of the handbook. Governance "
     "participants such as committee members and a Director of Planning appear in "
     "the statutory workflow but are not separate login accounts; they are covered "
     "at the end of the internal section.")

h2("2.1  External operations - clients and the public", color=GREEN)
table(["Actor (account role)", "Landing area", "Main responsibility"],
      [["Public visitor (public)", "Citizen landing page",
        "Browse public information and services; begin an account or application where enabled"],
       ["Registered applicant (registered)", "Citizen portal",
        "Maintain an account and submit, pay for and follow their own service requests"],
       ["Viewer (viewer)", "Citizen landing page (read-only)",
        "Read permitted public or shared information without the full applicant workflow"],
       ["Citizen / client", "Citizen portal",
        "The main service user: prove residency, apply, upload, pay, communicate and track outcomes"]],
      widths=[2.1, 1.9, 2.7], header_fill="2da44e")

h2("2.2  Internal operations - council staff", color=PURPLE)
table(["Actor (account role)", "Landing area", "Main responsibility"],
      [["Planning Clerk (planning_clerk)", "Planning Clerk portal",
        "Intake, records, fees, notices, registers, correspondence and dispatch"],
       ["Planner (planner)", "Planner workspace / Planning Studio",
        "Assessment, due diligence, technical circulation, land-use planning, recommendations"],
       ["Environmental Officer / EHO (env_officer)", "Environmental Health Officer workspace",
        "Environmental appraisal, inspections, surveillance, health clearances and specialist responses"],
       ["Surveyor (surveyor)", "Surveyor map console / task manager",
        "Assigned field survey, beacons, measurements, Reports on Survey and diagrams"],
       ["GIS Officer (gis_officer)", "GIS Officer portal",
        "Authoritative spatial data, zoning and constraints, map publication, QGIS coordination"],
       ["Executive Officer (eo)", "EO planner portal",
        "Statutory review and determination within the configured decision controls"],
       ["Building Inspector (building_inspector)", "Inspector workspace",
        "Construction-stage inspections, compliance records, enforcement, occupation certificate"],
       ["System Administrator (admin)", "Admin console",
        "User access, configuration, content, platform health and system governance"]],
      widths=[2.1, 1.9, 2.7], header_fill="8250df")

para("The eleven roles are exactly the values permitted by the users_role_check "
     "rule in the database. A role that is not in that list cannot exist on any "
     "account, so the software cannot accidentally depend on a role that does not "
     "exist. Admin is deliberately treated as an IT role: several planning screens "
     "are kept out of the administrator's way so that the IT desk cannot quietly "
     "make a planning decision.", italic=True, color=GREY, size=10)

page_break()


# =====================================================================
# PART A - EXTERNAL OPERATIONS (CLIENTS AND THE PUBLIC)
# =====================================================================
h1("Part A - External operations: clients and the public", color=GREEN)
para("External operations are the services the council offers to the people it "
     "serves. These are the actors who do not sit inside the council's protected "
     "workflow but who start it, feed it, pay for it and receive its outcomes. "
     "Each is given a full page below.")

page_break()

# ---------- A.1 Public visitor ----------
h2("A.1  The public visitor  (account role: public)", color=GREEN)
para("Who they are.  A public visitor is a person who has not yet completed the "
     "account or residency steps needed for a full client workflow. This may be a "
     "resident curious about services, a prospective investor researching the "
     "district, a student, a journalist, or an ordinary member of the public "
     "checking public information. In practice it is anyone who opens the council "
     "portal without being signed in to a verified account.")
para("What the system lets them do.  The public-facing system gives this person a "
     "starting point for understanding council services, finding public "
     "information, registering or logging in, and beginning a service request "
     "where the relevant route is available. Public information includes service "
     "descriptions and permitted map or layer information. Crucially, it does not "
     "expose private application records, internal staff comments, personal "
     "details, or anyone's work queue. If the person proceeds to a service that "
     "requires an identity or district-residency check, the system directs them "
     "into the appropriate account and evidence process rather than letting them "
     "carry on unprotected.")
para("Their use case in one line.  Discovery and entry: understand what the "
     "council offers, provide the minimum information needed to establish an "
     "account, and move into a protected client space before submitting any "
     "sensitive material.")
para("What they cannot do.  A public visitor does not make council decisions, "
     "verify another person's evidence, edit official land or permit records, or "
     "restyle or publish any map layer. Once they authenticate, their practical "
     "actor category becomes a registered applicant or a citizen/client, depending "
     "on the account status and the service being used.")
para("Typical activities:", bold=True, after=2)
bullet("Read service descriptions, guidance and public maps or layers.")
bullet("Register for an account (with CAPTCHA protection) or sign in.")
bullet("Start a service request where the route is open to them.")
bullet("Be routed to identity or residency proofing when the service requires it.")

page_break()

# ---------- A.2 Viewer ----------
h2("A.2  The viewer  (account role: viewer)", color=GREEN)
para("Who they are.  The viewer is an account holder who needs read-only access "
     "to information the system permits them to see, but who does not need - or "
     "has not yet chosen - the full registered-applicant workflow. This might be a "
     "consultant, a researcher, a neighbouring landowner, a partner agency, or a "
     "resident who simply wants to consult information before deciding whether to "
     "transact with the council.")
para("What the system lets them do.  The viewer role supports inspecting "
     "public-facing information, maps, service guidance, or shared records without "
     "the authority to submit or manage the full client application workflow. A "
     "viewer can use the information to understand the district, locate relevant "
     "public data, or review a service before deciding whether to register and "
     "apply. The role is deliberately different from an internal staff role.")
para("What they cannot do.  A viewer cannot edit authoritative GIS layers, update "
     "a permit, access another applicant's private file, record an inspection, or "
     "issue a decision. If a viewer needs to transact with the council, they must "
     "use the registration and application path and satisfy any identity or "
     "residency requirements for that service. This separation lets the council "
     "provide genuinely useful information while keeping personal and operational "
     "records inside authenticated, role-appropriate workspaces.")
para("Why the role exists.  It gives the council a safe middle ground: enough "
     "access to be transparent and useful, not enough access to create risk. It "
     "keeps read-only public data available to people who should see it, without "
     "forcing every one of them into a full applicant account they do not need.")

page_break()


# ---------- A.3 Registered applicant ----------
h2("A.3  The registered applicant  (account role: registered)", color=GREEN)
para("Who they are.  A registered applicant is an external user who has created "
     "an account and can carry out the client-side steps the portal makes "
     "available. They have moved beyond anonymous browsing and now have a "
     "persistent identity in the system: a place where their contact details, "
     "their documents and the history of their dealings with the council are kept "
     "together.")
para("What the system lets them do.  They use their account to maintain contact "
     "and identity information, start and submit applications, upload plans and "
     "supporting documents, arrange payment, review receipts, respond to requests "
     "for more information, and follow the progress of their own cases. Where "
     "residency verification applies, an unverified account must provide "
     "acceptable proof, or complete the available deed-check process, before "
     "relying on services restricted to verified residents.")
para("Life after submission.  Once the application is submitted it becomes an "
     "official work item for council staff. From that point the applicant can see "
     "the permitted status and next-step information on their own case, while "
     "internal recommendations and restricted staff notes remain internal. A "
     "registered applicant is responsible for the accuracy and completeness of "
     "what they submit, and for responding to notices or document requests. The "
     "system provides a traceable communication and status channel, but the "
     "applicant does not route cases between council departments and cannot grant "
     "themselves a permit.")
para("Where the relationship ends.  Their interaction ends with a recorded "
     "council outcome, delivery of the permitted documents or service, and any "
     "follow-up obligations such as construction-stage inspections. Good practice "
     "expects them to keep copies of what they submit, to respond when the council "
     "asks for missing documents, and not to start illegal building while a file is "
     "still pending.")

page_break()

# ---------- A.4 Citizen / client ----------
h2("A.4  The citizen / client  (resident, landowner, business or representative)", color=GREEN)
para("Who they are.  The citizen/client is the main external service user, whether "
     "the underlying account is public or registered. Depending on the service, a "
     "client may act as an owner, occupier, business, applicant, or authorised "
     "representative. This is the person at the centre of the council's promise: to "
     "serve its own residents lawfully and transparently.")
para("Starting a service.  The client begins by selecting the service, completing "
     "the requested application fields, identifying the relevant property or stand, "
     "attaching plans and evidence, and submitting the request. For "
     "residency-controlled services, the client supplies a deed reference for a "
     "logged registry check, or uploads acceptable proof such as an occupation "
     "certificate, a lodger's permit, a settlement or offer letter, a rates or "
     "utility statement, or a chief or councillor confirmation letter.")
para("Paying and participating.  The client pays applicable fees through an "
     "available payment route and keeps the receipt and reference. During "
     "processing, the client uses the application timeline to see the current stage "
     "and may answer a request for more information, review a notice, or lodge a "
     "permitted objection or appeal. If a neighbour applies during a formal notice "
     "period, an affected client may object in the way the notice explains, with "
     "their name and grounds.")
para("Building and close-out.  If a development permit is approved, the client "
     "follows its conditions, requests inspections at the required stages, and "
     "receives the occupation certificate only after the applicable inspection "
     "process is complete. The portal gives the client a clear view of their own "
     "case; statutory assessment, internal circulation and decision authority "
     "remain with council officers and the configured governance steps. The client "
     "is not expected to edit council maps, approve their own permit, or treat an "
     "online map or a demonstration registry screen as their title deed.")

page_break()


# ---------- External flowcharts ----------
h2("A.5  External flowcharts", color=GREEN)

h3("A.5.1  Proving you belong to the district (residency verification)")
para("The council serves its own residents, so a new citizen-tier account must "
     "prove it belongs before it can use restricted services. On first login, any "
     "account whose residency is not yet verified is routed to the residency page. "
     "There it can either enter a deed number for an instant check against the "
     "Deeds Registry (a logged lookup against a simulated Ministry of Lands "
     "service), or upload acceptable proof - an occupation certificate, a lodger's "
     "permit, a settlement or offer letter, a rates or utility statement, or a "
     "chief or councillor confirmation letter. Uploaded documents go into a review "
     "queue that authorised staff can verify or reject. A deed check that matches "
     "the holder's national ID verifies residency instantly; an uploaded document "
     "is verified by a reviewing officer. Until verification succeeds, restricted "
     "services stay locked.")
add_image("01_residency.png")
caption("Figure 1. Residency verification (UC-0): the deed-check and document-upload routes to a verified account.")

page_break()

h3("A.5.2  From a public visitor to a council determination")
para("This end-to-end view shows the whole external journey and where it hands "
     "over to the internal team. A visitor explores public information; if they "
     "need a protected service they register and prove residency; they complete "
     "and pay for an application; the Planning Clerk receipts and routes it; the "
     "Planner assesses and circulates it to specialists; the Clerk records the "
     "public notice; and finally the committee gate (where required) and the "
     "Executive Officer produce a determination, which the Clerk dispatches and the "
     "client sees on their own case.")
add_image("02_external_determination.png")
caption("Figure 2. The external client journey from discovery through to a recorded council determination.")

page_break()


# =====================================================================
# PART B - INTERNAL OPERATIONS (COUNCIL STAFF)
# =====================================================================
h1("Part B - Internal operations: council staff", color=PURPLE)
para("Internal operations are the council's protected workflow. Citizens do not "
     "act here directly; they send work into it and receive its results. Each "
     "staff role below is given a full page covering the legal and practical "
     "expectations, the exact activities performed in the system, and the "
     "boundaries of the role. 'Internal' does not mean that every record is "
     "visible to every staff member - access stays role- and route-controlled "
     "throughout.")

page_break()

# ---------- B.1 Planning Clerk ----------
h2("B.1  The Planning Clerk  (account role: planning_clerk)", color=PURPLE)
para("Who they are.  Planning clerks in Zimbabwean local authorities are the "
     "records and reception spine of development control. Job models and office "
     "practice expect them to receive applications, check that the pack is "
     "complete enough to register, issue receipts for fees, keep the development "
     "register, and write formal letters. The clerk is the person who makes the "
     "file exist in council memory. In the system they are the administrative "
     "custodian of the record from intake through outward correspondence and "
     "register maintenance.")
para("What the law and good practice expect.  Under sound RTCP office practice, "
     "acknowledgement of a valid application starts or supports the statutory "
     "clock. The system encodes a five-working-day acknowledgement target and a "
     "seven-day refusal-letter target after determination, and the clerk is "
     "expected to meet those clocks or record why they could not - late silence is "
     "a governance failure, not a small admin slip. The clerk files public-notice "
     "certificates and neighbour notifications when required, dispatches approved "
     "permits with proof of delivery, and sends refusal letters with clear reasons.")
para("What they do in the system.  When a client submits a request, the clerk "
     "checks that it arrived, records and acknowledges receipt, assigns or confirms "
     "the official reference (the TPD reference), and flags missing administrative "
     "items for follow-up. They maintain the fee and payment record, reconcile "
     "receipts, keep the statutory and development registers current, and file "
     "notices and case documents against the correct application. At the public "
     "notice stage they prepare or record the notice, observe the objection period, "
     "attach representations to the case, and route them to the responsible "
     "planner. Once a decision is ready they support preparation and dispatch of "
     "the permit, refusal or other formal correspondence and record when it was "
     "sent.")
para("Boundaries of the role.  The clerk must never approve or refuse the "
     "development, change map geometry, or delete history to hide a mistake - they "
     "add a correcting note instead. Any money taken at the counter must appear in "
     "the fee register the same day. Their central use case is continuity and "
     "auditability: every incoming item is receipted, every outgoing item is "
     "traceable, and the file shows what is awaiting action and which office owns "
     "the next step.")

page_break()


# ---------- B.2 Planner ----------
h2("B.2  The Planner  (account role: planner)", color=PURPLE)
para("Who they are.  The Planner owns the technical planning assessment of "
     "development and land-use cases. Zimbabwean planner posts and the RTCP Act "
     "expect the planner to help prepare and update master and local plans, "
     "process development permits, subdivisions, consolidations, changes of use "
     "and special consents, advise committees, and support the enforcement of "
     "planning law. The work splits into plan-making and development control; the "
     "system supports both.")
para("Assessment and circulation.  On development control the planner reviews the "
     "submitted proposal against the operative plan, zoning, site context, policy "
     "and statutory requirements; identifies deficiencies; and records the case "
     "analysis. Where more expertise is needed, the planner creates and coordinates "
     "technical circulation to the Environmental Officer, Surveyor, GIS Officer, "
     "Building Inspector and other bodies. The planner reads the responses "
     "together, resolves questions with the applicant through formal requests, "
     "evaluates representations received during public notice, and develops the "
     "recommendation for the configured committee and Executive Officer process.")
para("Spatial and layout work.  For subdivision, consolidation and stand-layout "
     "work, the planner uses the in-browser Planning Studio tool, or exports a "
     "georeferenced DXF for editing in QGIS, AutoCAD or Civil 3D and re-imports "
     "it. They validate the resulting lots and roads, and coordinate survey pegging "
     "and GIS updates. The planner is expected to use spatial evidence - running "
     "site-context checks against the map layers and filing a screening document - "
     "and to refer to GIS when layers are wrong and to surveyors when boundaries "
     "need a licensed survey.")
para("Boundaries of the role.  Separation of duties is a deliberate control "
     "against error and corruption: in this deployment, final approval is gated to "
     "the Executive Officer decision path. The planner is expected to recommend and "
     "complete the assessment pack, not to bypass the gate with someone else's "
     "password. When the system returns an 'EO decision required' response, the "
     "planner has reached the correct hand-off. The planner's records provide the "
     "reasoned technical basis for the next authority; the recommendation is not "
     "itself the final statutory determination.")

page_break()

# ---------- B.3 Environmental Officer / EHO ----------
h2("B.3  The Environmental Officer / Environmental Health Officer  (account role: env_officer)", color=PURPLE)
para("Who they are.  This role carries two connected duties under one account. As "
     "an environmental officer it contributes specialist environmental judgement to "
     "planning applications. As an environmental health officer (EHO) it carries "
     "the public-health duties the Public Health Act, 2018 places on the local "
     "authority. The two functions share one workspace in the system.")
para("Environmental appraisal.  On receiving a circulated case, the officer "
     "reviews the proposal, site context, supporting material and relevant "
     "environmental constraints, then records an appraisal, requested mitigation, "
     "conditions, or a reasoned response for the planner and the decision file. The "
     "officer may conduct environmental inspections or surveillance connected to a "
     "site, record observations and evidence, identify non-compliance, and "
     "recommend follow-up action. The environmental response is recorded so it can "
     "be considered alongside planning, survey, GIS and building comments before a "
     "decision is made.")
para("Public-health duties.  The EHO inspects trading and food premises before or "
     "during licensing (an online ticket is not a licence), investigates nuisances "
     "and infectious-disease risks, checks water points, and serves abatement, "
     "prohibition or closure notices using lawful methods, following up until "
     "compliance, escalation or withdrawal is documented. Health clearances gate "
     "certain licences, and burial, food-handler and related clearances are handled "
     "through dated registers with identifiable officers and no back-dating.")
para("Boundaries of the role.  The officer does not issue RTCP development permits "
     "by virtue of this role; the environmental and health responses inform the "
     "authorised decision-maker and become part of the auditable case history. If "
     "the council has not filled an EHO post, the Act's appointment duties still sit "
     "with the local authority - software cannot replace a missing statutory officer.")

page_break()


# ---------- B.4 Surveyor ----------
h2("B.4  The Surveyor  (account role: surveyor)", color=PURPLE)
para("Who they are.  The Surveyor performs assigned ground-truth and cadastral or "
     "engineering survey work needed to establish reliable site and boundary "
     "information. Cadastral survey for registration in Zimbabwe is the work of a "
     "licensed land surveyor under the Land Surveyors Act [Chapter 27:06], with "
     "examination and approval by the Surveyor-General under the Land Survey Act "
     "[Chapter 20:12]. The lawful chain is: planning permit, then licensed survey, "
     "then Surveyor-General approval, then Deeds. SpartialIQ must respect that "
     "chain and supports it without replacing the Surveyor-General or the Deeds "
     "Registry.")
para("What they do in the system.  A planner, EO, clerk or other permitted "
     "assigner creates a survey task with a case, property, purpose and requested "
     "deliverable. The Surveyor reviews the task, plans the field work, captures "
     "relevant beacons, control points, traverses, measurements and site "
     "observations, and checks geometry and area calculations. They prepare the "
     "appropriate outputs - a Report on Survey, a diagram, a GeoPDF or DXF, or a "
     "supporting certificate where applicable. Findings are submitted to the "
     "assigning officer, who can accept them, ask for clarification or correction, "
     "or cancel the task with a recorded reason.")
para("How their work is used.  Accepted geometry and documents inform the planning "
     "case and, where approved, the spatial record. When a planner approves a "
     "subdivision conceptually, the surveyor still surveys to the Act and "
     "regulations; when the GIS Officer wants a layer update, the surveyor supplies "
     "controlled files that GIS imports only after checks. The surveyor's main "
     "contribution is defensible spatial evidence that lets staff and clients act "
     "on the same measured understanding of the property.")
para("Boundaries of the role.  The surveyor does not independently make the "
     "planning decision or assign official stand numbers outside the controlled "
     "allocation process. They must refuse instructions that ask them to fake "
     "boundaries to match an illegal building - public boundary truth comes above "
     "client convenience. They must not tell clients the council app has replaced "
     "the Surveyor-General.")

page_break()

# ---------- B.5 GIS Officer ----------
h2("B.5  The GIS Officer  (account role: gis_officer)", color=PURPLE)
para("Who they are.  The GIS Officer maintains and publishes the council's "
     "authoritative spatial information, used by planning staff, service users and "
     "connected GIS tools. RDC GIS and spatial-planning posts are expected to "
     "maintain district spatial data, layouts and maps that support the RTCP Act "
     "and the council's infrastructure programmes, and to stop divergent 'map "
     "copies' of the same zone.")
para("What they do in the system.  Their work includes validating parcel and "
     "stand geometry, managing zoning and environmental-constraint layers, "
     "supporting abutting-owner and location analysis, maintaining spatial-database "
     "quality, and coordinating the connection between the web map, QGIS Server and "
     "desktop GIS. When a planning or survey change is authorised, the GIS Officer "
     "checks that the submitted geometry is valid, correctly attributed and "
     "consistent with authoritative identifiers before updating or publishing it. "
     "They govern map symbology through a versioned style workflow so that the "
     "published web and GIS views use one consistent visual meaning - one zone "
     "name, one colour, one geometry.")
para("Guarding the Single Source of Truth.  International and regional models "
     "stress one legal and spatial story: planning, survey and deeds must not "
     "invent three different boundaries for one stand. The system therefore treats "
     "its zoning master data as the peri-urban single source of truth for both the "
     "map and permits, and the GIS Officer is expected to defend it - importing "
     "only authoritative data, dry-running imports first, and leaving registers "
     "empty rather than drawing fake roads or water points.")
para("Boundaries of the role.  The officer may provide a spatial due-diligence "
     "response to a case, but map data is not a substitute for a statutory planning "
     "determination or for a field survey where one is required. Write APIs are "
     "staff-locked: anonymous internet users must never be able to restyle or "
     "publish layers.")

page_break()


# ---------- B.6 Executive Officer ----------
h2("B.6  The Executive Officer (EO)  (account role: eo)", color=PURPLE)
para("Who they are.  The Executive Officer is the senior statutory decision actor "
     "in the development-permit workflow. In Zimbabwean local planning authorities "
     "a senior planning officer or designated decision-maker determines applications "
     "after assessment, subject to schemes of delegation and committee oversight set "
     "by Council. The RTCP framework assumes decisions are reasoned, timed and "
     "appealable, and the system's EO role is that determination seat for day-to-day "
     "permits.")
para("What they do.  The EO reviews the complete case file: the planner's "
     "assessment, the technical responses, the public representations, the committee "
     "or agenda record where required, payment and process prerequisites, and any "
     "proposed conditions. The configured decision action records an outcome - "
     "approval, approval with conditions, refusal, deferral, or a return for further "
     "work - with reasons and conditions attached to the official case. The EO may "
     "also oversee technical circulation, due diligence, committee reporting and "
     "enforcement decisions according to the permissions available.")
para("Decision controls.  Two independent, server-enforced gates guard a "
     "determination. First, a resolution is required: an EO decision is rejected "
     "unless it is backed by a recorded committee resolution (or an audited "
     "delegated-authority override). Second, a quorum is required: a resolution "
     "cannot be recorded on a meeting where the number present is below the "
     "required quorum. These controls exist so that an outcome cannot be recorded "
     "when the required governance evidence is absent.")
para("Boundaries of the role.  The EO must refuse incomplete packs - approving an "
     "empty file creates liability for the council - and must write reasons a "
     "citizen and an appeal body can understand. Conditions must be precise; "
     "refusals must state grounds linked to the plan or standards, not personal "
     "preference. The EO must not share their login, and planner self-approval is "
     "blocked on purpose. Where Council requires committee determination for "
     "certain classes of application, the EO follows that resolution: software does "
     "not cancel a Council resolution.")

page_break()

# ---------- B.7 Building Inspector ----------
h2("B.7  The Building Inspector  (account role: building_inspector)", color=PURPLE)
para("Who they are.  The Building Inspector protects public safety and verifies "
     "construction compliance after the relevant permit has been issued. Building "
     "inspectors in Zimbabwean local authorities inspect construction stages against "
     "approved plans and by-laws, sign off key stages with Engineering or Works "
     "where required, and act on illegal building.")
para("What they do.  The client or the authorised workflow requests an inspection "
     "at the appropriate stage; the inspector reviews the permitted plans and "
     "conditions, schedules or reschedules the visit, attends the site, records "
     "observations, captures supporting photographs or evidence, and marks "
     "checklist items as passed, failed or requiring correction. The inspector "
     "communicates deficiencies and the next action to the client through the "
     "permitted case channel, then re-inspects when corrections are reported. The "
     "nine statutory inspection stages are drawn from the DM Handbook 2021 v1.2: "
     "setting out; foundation trenches and footing levels; foundation brickwork to "
     "floor level; brickwork and window level; brickwork to wall plate; roof "
     "trusses; drainage and sewerage work; final inspection; and the certificate of "
     "occupation.")
para("Occupation certificate and enforcement.  The system maintains stage history "
     "and, server-side, prevents the occupation certificate from being issued until "
     "all required earlier stages have passed. The inspector may also identify "
     "unauthorised work or enforcement concerns and route them into the appropriate "
     "enforcement record, keeping a clear chain of custody for photos and notes and "
     "coordinating with Roads & Works and the EHO when a defect is structural, "
     "drainage or health-related.")
para("Boundaries of the role.  The inspector's findings relate to observed work and "
     "approved requirements; changes to the planning permission itself remain with "
     "the authorised planning decision process. The inspector does not quietly "
     "'approve' a planning file from the field. Inspector evidence feeds the "
     "occupation and compliance chain, but title and diagram approval still sit with "
     "the Surveyor-General and Deeds.")

page_break()


# ---------- B.8 System Administrator ----------
h2("B.8  The System Administrator  (account role: admin)", color=PURPLE)
para("Who they are.  The System Administrator keeps the application available, "
     "secure and correctly configured for council operations. Under the RDC Act "
     "framework the executive administration runs day-to-day council business, and "
     "ICT and records support must keep systems available, secure and auditable so "
     "the technical departments can meet their planning and public-health duties. "
     "The council's CEO and executive officers remain the human authority; Admin in "
     "SpartialIQ is the digital keyring and platform steward.")
para("What they do.  Their principal use cases include managing user accounts and "
     "invitations, assigning approved access roles, supporting account recovery, "
     "removing leavers, maintaining system content and configuration, running "
     "migrations from an allow-list, restoring basemap data when needed, monitoring "
     "operational health, and administering technical integration or map-style "
     "settings where permitted. They support content editors for council website "
     "pages (committees, rates information, contacts) without changing planning "
     "decisions, and they help the GIS Officer with symbology-registry access.")
para("Security and honesty.  The administrator is expected to keep secrets strong "
     "(secure tokens and CAPTCHA), keep transport encryption on, keep backups "
     "tested, and keep status pages honest - faking an 'all green' status when the "
     "spatial database is down is a professional failure. They must never leave "
     "demonstration passwords on the public internet, and they refuse requests to "
     "open mutating GIS or planning APIs to the anonymous public.")
para("Boundaries of the role.  Because this role has broad technical access, "
     "changes should be attributable and limited to the administrative purpose. The "
     "role is not a substitute for a Planner, EO, Surveyor or Inspector and does not "
     "itself create technical or statutory authority. The project explicitly treats "
     "admin as an IT role, and route-level controls keep administrative accounts out "
     "of certain planning actions. Any exceptional support action that affects a live "
     "case should keep a clear audit trail and respect the applicable business "
     "approval, and legal questions are escalated to the proper executive officer or "
     "council lawyer rather than invented in a configuration file.")

page_break()

# ---------- B.9 Governance participants ----------
h2("B.9  Committee and governance participants  (workflow participants, not login accounts)", color=PURPLE)
para("Who they are.  Committee members, a committee chair and a Director of "
     "Planning may be involved in statutory review, quorum, resolution or "
     "recommendation steps represented by the application workflow. They are not "
     "part of the active account taxonomy, so this handbook does not imply that each "
     "has a separate login or portal. Councillors set policy and approve budgets and "
     "certain planning items under resolutions, working through committees such as "
     "finance, roads and works, social services and health portfolios, and "
     "development-planning structures such as the Rural District Development "
     "Committee.")
para("How they interact with the system.  SpartialIQ does not replace committee "
     "minutes. Officers are expected to bring system-printed registers, maps and "
     "documents to committee, then record the resolution back into the case. Where a "
     "committee resolution is required, authorised staff record or verify the "
     "governance evidence through the configured process, and the system uses that "
     "evidence as a prerequisite to the EO decision.")
para("Their use case.  Collective consideration and accountable resolution: review "
     "the material placed before the committee, record the result through the "
     "council's authorised procedure, and ensure the case file contains enough "
     "evidence for the decision stage. Best governance keeps politics in the chamber "
     "and evidence in the file. Citizens and staff should know which decisions are "
     "delegated to the EO and which must wait for committee - that split is a "
     "Council document decision. Future implementation of individual accounts for "
     "these participants would require matching backend role issuance, route "
     "permissions and audit controls.")

page_break()


# =====================================================================
# INTERNAL FLOWCHARTS
# =====================================================================
h1("Internal flowcharts", color=PURPLE)

h3("B.10  Internal council application processing")
para("This view follows a receipted application through the internal team. The "
     "Planning Clerk takes intake and creates the official record; the Planner "
     "assesses and, where needed, circulates the case in parallel to the "
     "Environmental Officer, Surveyor, GIS Officer and Building Inspector. Their "
     "responses are consolidated by the Planner, the Clerk records the public "
     "notice and representations, the Planner makes a recommendation, a governance "
     "record is made where required, the EO determines the outcome, and the Clerk "
     "dispatches it and updates the register.")
add_image("03_internal_processing.png")
caption("Figure 3. Internal processing: parallel specialist circulation through to determination and dispatch.")

page_break()

h3("B.11  Permit, construction inspections and occupation certificate")
para("Once a permit is issued and dispatched, a separate inspection lifecycle "
     "begins. The client builds to the approved plans and conditions, requests each "
     "required inspection (booking and paying), and the Building Inspector schedules "
     "the visit. If a stage complies it is recorded as passed; if not, the failure, "
     "evidence and required correction are recorded and the client corrects and "
     "re-books. The system will not allow the final stage or the occupation "
     "certificate until all required earlier stages have passed.")
add_image("04_inspections.png")
caption("Figure 4. The nine-stage construction inspection lifecycle through to the occupation certificate.")

page_break()

h3("B.12  Survey and spatial-data hand-off")
para("When a case needs ground truth, authorised staff assign a survey task. The "
     "Surveyor captures and validates field evidence - beacons, control points, "
     "traverses and areas - and submits a Report on Survey with diagrams. The "
     "assigning officer can accept the findings or return them for correction. "
     "Accepted evidence is used by the Planner in the case assessment and, in "
     "parallel, validated by the GIS Officer before it updates the authoritative "
     "spatial database and published map layers.")
add_image("05_survey_spatial.png")
caption("Figure 5. The survey-to-GIS hand-off that keeps spatial evidence authoritative.")

page_break()

h3("B.13  Payments and receipts")
para("A client starts a payment for a fee or inspection through a payment provider "
     "or an authorised manual route. If the payment is confirmed, the system records "
     "the transaction and issues a receipt, the Planning Clerk's fees ledger reflects "
     "it, and eligible application processing continues. If it is not confirmed, the "
     "client sees a pending or failed state and can retry or seek help.")
add_image("06_payments.png")
caption("Figure 6. The payment and receipt loop that unblocks application processing.")

page_break()


# =====================================================================
# APPENDICES
# =====================================================================
h1("Appendix A - Master use-case catalogue")
para("This table summarises the main use cases, who performs them, and the result "
     "each one produces. It is the quick-reference companion to the actor pages.")
table(["Use case", "Primary actors", "Result"],
      [["Discover council services and public maps", "Public visitor, viewer",
        "Client understands available information and services"],
       ["Create account and verify residency", "Citizen/client; reviewing staff; registry",
        "Account and residency state support eligible service access"],
       ["Submit development application", "Citizen/client, Planning Clerk",
        "A referenced and receipted case enters the council workflow"],
       ["Assess development proposal", "Planner, specialists, EO",
        "A reasoned recommendation and a recorded statutory outcome"],
       ["Publish notice and process representations", "Clerk, Planner, public/client",
        "Notice period and received representations become part of the file"],
       ["Pay application fees", "Citizen/client, payment service, Clerk",
        "Transaction and receipt are recorded and reconciled"],
       ["Subdivide or consolidate land", "Planner, GIS Officer, Surveyor",
        "A validated proposed spatial arrangement and related records"],
       ["Complete survey task", "Surveyor, assigning officer, Planner/GIS",
        "Accepted measurements, findings and spatial deliverables"],
       ["Inspect construction and issue occupation certificate", "Client, Inspector, Clerk",
        "Passed inspection history and a final certificate where eligible"],
       ["Record environmental appraisal or surveillance", "Env Officer, Planner, EO",
        "Environmental findings and follow-up attached to the case or site"],
       ["Maintain GIS data and published styles", "GIS Officer, Planner, Admin",
        "Consistent authoritative spatial records and map presentation"],
       ["Maintain users and system configuration", "System Administrator",
        "Correctly provisioned access and reliable system operation"],
       ["Record governance prerequisite and determination", "Governance participants; EO",
        "Auditable resolution evidence and an authorised case outcome"]],
      widths=[2.6, 2.0, 2.1])

page_break()

h1("Appendix B - The lawful end-to-end chain")
para("The council's planning work sits inside a longer legal chain that extends "
     "beyond this one system. Keeping the chain clear protects both the council and "
     "the client:")
bullet("RTCP development permit or subdivision permission - granted by the local "
       "planning authority (the council, through its Planner and EO).")
bullet("Licensed land surveyor field survey - under the Land Surveyors Act "
       "[Chapter 27:06].")
bullet("Surveyor-General examination and approval - under the Land Survey Act "
       "[Chapter 20:12].")
bullet("Deeds registration - at the Deeds Registry.")
para("SpartialIQ covers the council's planning and operations spine. It does not "
     "replace the Surveyor-General or the Deeds Registry, and no screen in the "
     "system should be read as a substitute for those statutory approvals.",
     italic=True, color=GREY, size=10)

h1("Appendix C - Important interpretation notes")
bullet("Internal means the council's protected operational workflow; it does not "
       "mean every record is visible to every staff member. Access stays role- and "
       "route-controlled.")
bullet("External operations include clients and other public users. A client sees "
       "their own permitted case status, receipts, notices and outcomes; internal "
       "technical notes and restricted personal records are not public information.")
bullet("A system role describes available application permissions. It does not, by "
       "itself, create legal authority beyond the user's actual appointment and the "
       "council's procedures.")
bullet("Governance roles shown as workflow participants are not active user roles "
       "in the current system. Their portal capabilities should be treated as future "
       "or separately configured until backend role issuance and access controls "
       "exist.")
bullet("The application lifecycle and the construction-inspection lifecycle are "
       "connected in the user's journey but have separate records and status "
       "transitions. A permit decision is not the same event as passing an "
       "inspection or issuing an occupation certificate.")

h1("Appendix D - Source references")
bullet("docs/ACTOR_USE_CASES.md - actor-by-actor descriptions and cross-system flowcharts.")
bullet("docs/USE_CASES.md - plain-language use cases and the routing loop for each document.")
bullet("docs/COUNCIL_OPERATIONS_FLOW.md - the code-level stage-by-stage trace and role capability matrix.")
bullet("Vungu_Zimbabwe_Role_Expectations.docx - what Zimbabwe law and good RDC practice expect of each role.")
bullet("frontend/src/services/types.ts - the active account-role taxonomy.")
bullet("frontend/src/router/index.ts - landing area per role and route access controls.")

# ---- closing line ----
para("")
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("- End of the System Actors and Use-Cases Handbook -")
r.italic = True; r.font.color.rgb = GREY; r.font.size = Pt(10)

OUT = os.path.join(BASE, "Vungu_SpartialIQ_Actors_and_Use_Cases_Handbook.docx")
doc.save(OUT)
print("SAVED:", OUT)


