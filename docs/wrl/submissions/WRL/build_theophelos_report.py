"""
Build Theophelos Madzinga WRL Preliminary Report.
Theophelos is the frontend developer on the Vungu RDC GIS project.
Reg: R24221B | Programme: BSc (Honours) Computer Science | Level 3.1
No dash bullets. Clean prose throughout.
Frontend focus: Leaflet.js, HTML/CSS/JS, GeoJSON, UI design, wireframes, document research.
"""
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH

OUT = "Theophelos_Madzinga_WRL_Preliminary_Report_R24221B_v2.docx"
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
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    return p


def body(text, size=10, indent=None, after=4):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(size)
    p.paragraph_format.space_after = Pt(after)
    if indent:
        p.paragraph_format.left_indent = Inches(indent)
        p.paragraph_format.first_line_indent = Inches(-0.2)
    return p


def numbered(items, size=10):
    for i, item in enumerate(items, 1):
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Inches(0.5)
        p.paragraph_format.first_line_indent = Inches(-0.3)
        p.paragraph_format.space_after = Pt(2)
        run = p.add_run(f"{i}.  {item}")
        run.font.size = Pt(size)


def h(text, level=1):
    sizes = {1: 12, 2: 11, 3: 10}
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(sizes.get(level, 10))
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(3)
    return p


def page_break():
    doc.add_page_break()


# ═══════════════════════════════════════
# COVER PAGE
# ═══════════════════════════════════════
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

tbl = doc.add_table(rows=8, cols=2)
tbl.style = 'Table Grid'
info = [
    ("Student Name", "Theophelos Madzinga"),
    ("Student ID", "R24221B"),
    ("Programme", "Bachelor of Science Honours Degree in Computer Science"),
    ("Level", "3.1"),
    ("Organisation", "MSU Research and Innovation Hub / Vungu RDC GIS Project"),
    ("Supervisor", "Dr Paradzayi, Project Manager"),
    ("WRL Period", "23 February 2026 to 14 May 2026 (ongoing)"),
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

# ═══════════════════════════════════════
# ABSTRACT
# ═══════════════════════════════════════
h("ABSTRACT")
body(
    "This preliminary work-related learning (WRL) report documents the activities carried out by "
    "Theophelos Madzinga (Student ID: R24221B), a Level 3.1 Computer Science student at Midlands "
    "State University, during an industrial attachment at the MSU Research and Innovation Hub, "
    "working on a GIS-based Municipal Planning Information System commissioned by Vungu Rural District "
    "Council. The placement covers the period 23 February 2026 to the date of this report."
)
body(
    "The project involves the development of a web-based system to support land-use planning, "
    "development permit applications, spatial inspections, and compliance checking across nineteen "
    "wards in the Vungu RDC jurisdiction. The student's role is frontend development: building all "
    "user-facing interfaces using HTML, CSS, and vanilla JavaScript with Leaflet.js as the interactive "
    "mapping library. The backend API is developed by a companion team member and consumed by the "
    "frontend over a documented REST contract."
)
body(
    "The first phase of the placement, covering February to mid-April, involved project orientation, "
    "prototype frontend code review, GeoJSON specification study, UI wireframe design, frontend "
    "project structure establishment, interactive map component development, multi-step application "
    "submission form, authentication forms with JWT handling, planning officer and senior planner "
    "dashboards, land use zone overlay, Nginx configuration for static file serving and API proxying, "
    "integration debugging, and a formal system demonstration to Vungu RDC planning officers. "
    "The second phase, from mid-April onwards, focused on design research and documentation. "
    "Work in this phase included a study of the Zimbabwe Development Management (Control) "
    "Handbook 2021 from a user interface perspective, production of a screen inventory document, "
    "wireframe design for the fifteen new screens required by the schema refinement v1.2 features, "
    "construction of static HTML and CSS mockups for all new screens, and two research papers "
    "on document verification and storage in a local municipal GIS user system."
)
body(
    "Keywords: Work-Related Learning, Computer Science, GIS, Frontend Development, Leaflet.js, "
    "Vungu RDC, Municipal Planning, UI Design, Wireframes, Document Verification, Zimbabwe."
)

page_break()

# ═══════════════════════════════════════
# ACKNOWLEDGEMENTS
# ═══════════════════════════════════════
h("ACKNOWLEDGEMENTS")
body(
    "The completion of this placement and the preparation of this report would not have been possible "
    "without the guidance and support of a number of people."
)
body(
    "Sincere thanks go to Dr Paradzayi, Project Manager for the Vungu RDC GIS project, for clear "
    "supervision, consistent direction, and high professional standards that shaped the approach taken "
    "at every stage of the work. His feedback on the wireframes and screen inventory during the "
    "weekly progress meetings gave the UI design work a level of rigour it would not have reached "
    "without external review."
)
body(
    "Appreciation is extended to Rafiq, the project research assistant, for setting structured and "
    "meaningful research deliverables that gave the documentation phase of the attachment clear "
    "purpose and measurable outputs. The two document verification research papers produced during "
    "this placement reflect the seriousness with which he reviewed and accepted research submissions."
)
body(
    "Thanks also go to the planning officers at Vungu Rural District Council for their engagement "
    "during the site visit in March and the system demonstration in April. The site visit produced "
    "a key finding that changed the planning officer dashboard design significantly: observing how "
    "officers organise their daily workload by ward made it clear that the interface should present "
    "a ward-level summary before an application list, not the other way around."
)
body(
    "Finally, gratitude is owed to the Department of Computer Science at Midlands State University "
    "for the academic foundation in web technologies, human-computer interaction, and systems design "
    "that made it possible to contribute effectively to the project's frontend from the first week "
    "of the placement."
)

page_break()

# ═══════════════════════════════════════
# TABLE OF CONTENTS
# ═══════════════════════════════════════
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
    "   4.1  System Analysis and Prototype Frontend Review",
    "   4.2  GeoJSON Study, Wireframe Design, and Frontend Architecture",
    "   4.3  Interactive Map Component and User Interface Development",
    "   4.4  Deployment, Integration Testing, and System Demonstration",
    "   4.5  Handbook Study from a User Interface Perspective",
    "   4.6  Screen Inventory, Wireframes, and Static Mockups for New Features",
    "   4.7  Document Verification Research Papers",
    "   4.8  Document Management Module Interface Design",
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

# ═══════════════════════════════════════
# LIST OF ABBREVIATIONS
# ═══════════════════════════════════════
h("LIST OF ABBREVIATIONS")
abbrev_tbl = doc.add_table(rows=1, cols=2)
abbrev_tbl.style = 'Table Grid'
abbrev_tbl.rows[0].cells[0].paragraphs[0].add_run("Abbreviation").bold = True
abbrev_tbl.rows[0].cells[1].paragraphs[0].add_run("Meaning").bold = True
for cell in abbrev_tbl.rows[0].cells:
    cell.paragraphs[0].runs[0].font.size = Pt(10)

abbrevs = [
    ("API", "Application Programming Interface"),
    ("COO", "Certificate of Occupation"),
    ("CSS", "Cascading Style Sheets"),
    ("DCM", "Development Control Matrix"),
    ("DOM", "Document Object Model"),
    ("GeoJSON", "Geographic JavaScript Object Notation (RFC 7946)"),
    ("GIS", "Geographic Information System"),
    ("HTML", "HyperText Markup Language"),
    ("HTTP", "Hypertext Transfer Protocol"),
    ("HTTPS", "Hypertext Transfer Protocol Secure"),
    ("JS", "JavaScript"),
    ("JSON", "JavaScript Object Notation"),
    ("JWT", "JSON Web Token"),
    ("LPA", "Local Planning Authority"),
    ("MRZ", "Machine-Readable Zone (identity document format)"),
    ("MSU", "Midlands State University"),
    ("Nginx", "Engine-X (web server and reverse proxy)"),
    ("OCR", "Optical Character Recognition"),
    ("OGC", "Open Geospatial Consortium"),
    ("RDC", "Rural District Council"),
    ("REST", "Representational State Transfer"),
    ("SHA-256", "Secure Hash Algorithm 256-bit (cryptographic hash function)"),
    ("SPA", "Single Page Application"),
    ("SSH", "Secure Shell"),
    ("SSL", "Secure Sockets Layer"),
    ("UI", "User Interface"),
    ("UX", "User Experience"),
    ("VM", "Virtual Machine"),
    ("WFS", "Web Feature Service"),
    ("WMS", "Web Map Service"),
    ("WRL", "Work-Related Learning"),
    ("ZITF", "Zimbabwe International Trade Fair"),
]
for abbr, meaning in abbrevs:
    row = abbrev_tbl.add_row()
    row.cells[0].text = abbr
    row.cells[1].text = meaning
    for cell in row.cells:
        cell.paragraphs[0].runs[0].font.size = Pt(10)

page_break()

# ═══════════════════════════════════════
# CHAPTER 1: INTRODUCTION
# ═══════════════════════════════════════
h("CHAPTER 1: INTRODUCTION")

h("1.1  Background", 2)
body(
    "Work-Related Learning (WRL) is a structured component of undergraduate degree programmes at "
    "Midlands State University (MSU) that places students in professional environments relevant to "
    "their field of study. For Computer Science students, the placement provides direct experience "
    "of the gap between the design of software systems in academic settings and the realities of "
    "building, iterating on, and delivering user-facing systems that non-technical clients and "
    "end users depend on."
)
body(
    "MSU operates under the Education 5.0 philosophy promoted by the Government of Zimbabwe, which "
    "requires universities to contribute directly to national industrialisation and innovation. "
    "The MSU Research and Innovation Hub was established as the operational centre of this mandate, "
    "hosting projects that combine student development with genuine applied research and system "
    "development value."
)
body(
    "This report documents the placement of the author at the MSU Research and Innovation Hub, "
    "working on a GIS-based Municipal Planning Information System commissioned by Vungu Rural "
    "District Council. The author's responsibility is the entire user-facing layer of the system: "
    "the interactive map interface, the development application submission portal, the planning "
    "officer and senior planner dashboards, the administrator panel, and the document management "
    "interface currently in design. All user interfaces are built with HTML, CSS, and vanilla "
    "JavaScript, using Leaflet.js for interactive map rendering and GeoJSON for spatial feature "
    "exchange with the backend API."
)

h("1.2  Purpose of the Placement", 2)
body(
    "The placement serves three connected purposes. The first is academic: to fulfil the WRL "
    "requirement for the Bachelor of Science Honours Degree in Computer Science at Midlands State "
    "University. The second is professional: to give the student sustained experience designing and "
    "building production-grade web user interfaces for a multi-role system with real stakeholders. "
    "The third is practical: to contribute a fully functional and user-tested frontend to a local "
    "government system that Vungu RDC planning officers are actively using."
)

h("1.3  Objectives of the Placement", 3)
body("The objectives of this placement are as follows:")
numbered([
    "To apply web development skills acquired through academic training to the design and "
    "construction of a multi-role GIS system frontend.",
    "To gain practical experience integrating a Leaflet.js interactive map with GeoJSON data "
    "served by a RESTful backend API.",
    "To develop a working understanding of the Zimbabwe Development Management (Control) Handbook "
    "2021 and its implications for the screens, forms, and workflows required in the system frontend.",
    "To produce professionally designed wireframes and static mockups for all handbook-required "
    "user interactions, documented as a screen inventory.",
    "To produce research documents of professional quality covering document verification and "
    "storage in a local municipal GIS user system.",
    "To identify gaps between the knowledge acquired through undergraduate study and the demands "
    "of professional frontend development and UI design practice.",
])

h("1.4  Scope of Work", 2)
body(
    "The scope of this placement covers frontend development and UI design research activities "
    "carried out between 23 February 2026 and the date of this report. The first phase covered "
    "prototype frontend review, GeoJSON and Leaflet.js research, wireframe design, frontend "
    "architecture setup, interactive map and dashboard development, Nginx configuration, "
    "integration debugging, and a formal system demonstration. The second phase covers handbook "
    "study from a UI perspective, screen inventory production, wireframe and mockup design for "
    "new screens, and two research papers on document verification and storage."
)

h("1.5  Significance of the Work", 2)
body(
    "Rural district councils in Zimbabwe typically manage development permit applications through "
    "paper-based workflows with manual registers. The system developed during this placement "
    "provides a digital interface through which planning officers, applicants, and administrators "
    "interact with a spatially-aware planning database. The quality of this interface is the "
    "primary determinant of whether the system is adopted and used correctly, because planning "
    "officers will rely on it for daily application management without a training programme beyond "
    "the demonstration provided during the site visit and system handover."
)
body(
    "For the student, the significance lies in the opportunity to design interfaces for real users "
    "whose workflows were observed directly during the site visit, and to do research that is "
    "directly applied to a specific problem the project team is solving rather than a generic "
    "academic exercise."
)

page_break()

# ═══════════════════════════════════════
# CHAPTER 2: DESCRIPTION OF THE ORGANISATION
# ═══════════════════════════════════════
h("CHAPTER 2: DESCRIPTION OF THE WRL ORGANISATION")

h("2.1  Overview of Midlands State University", 2)
body(
    "Midlands State University was established in 1999 and is located in Gweru, Midlands Province, "
    "Zimbabwe. It operates under the Education 5.0 philosophy, which extends the university mandate "
    "to include innovation and industrialisation alongside teaching and research. The university "
    "enrols approximately 20,000 students across undergraduate and postgraduate programmes, with "
    "a strong emphasis on applied research and community engagement. Work-Related Learning is a "
    "core expression of the Education 5.0 framework."
)

h("2.2  The MSU Research and Innovation Hub", 2)
body(
    "The MSU Research and Innovation Hub is located on the Senga Road campus in Gweru. It provides "
    "incubation support, laboratory and computing facilities, mentorship, and access to seed funding "
    "pathways for student innovators, staff researchers, and early-stage start-up companies. "
    "Students working at the Hub are expected to function as active project team members, held "
    "accountable for the quality and completeness of their contributions."
)

h("2.3  The Vungu RDC GIS Project", 2)
body(
    "The Vungu Rural District Council GIS project is a commissioned system development engagement "
    "between the Faculty of Built Environment at MSU and Vungu RDC, facilitated through the "
    "Innovation Hub. The project builds a web-based GIS planning management system covering "
    "nineteen wards and five user tiers: public access, applicants, planning officers, senior "
    "planners, and administrators. The system manages the full development permit lifecycle as "
    "defined by the Zimbabwe Development Management (Control) Handbook 2021, and integrates "
    "spatial data from the enterprise geodatabase to support map-based planning decisions and "
    "spatial compliance checking."
)

h("2.4  Organisational Structure", 2)
body(
    "The project is managed by Dr Paradzayi as Project Manager, working through the Faculty of "
    "Built Environment and the MSU Innovation Hub. Rafiq, the project research assistant, manages "
    "documentation deliverables and coordinates with Vungu RDC stakeholders. The development team "
    "consists of two student developers: the author, responsible for frontend development and UI "
    "design research, and Munyaradzi, responsible for backend engineering, database design, and "
    "schema documentation. Progress is reviewed in weekly virtual meetings with the project "
    "supervisor."
)

page_break()

# ═══════════════════════════════════════
# CHAPTER 3: WORK PLAN
# ═══════════════════════════════════════
h("CHAPTER 3: WORK PLAN")

h("3.1  Planned Activities", 2)
body(
    "At the start of the placement, the supervisor and the student agreed on a phased work plan. "
    "The table below summarises the activities across the two phases covered by this report."
)

plan_tbl = doc.add_table(rows=1, cols=3)
plan_tbl.style = 'Table Grid'
for i, hdr_text in enumerate(["Phase", "Period", "Activities"]):
    plan_tbl.rows[0].cells[i].paragraphs[0].add_run(hdr_text).bold = True
    plan_tbl.rows[0].cells[i].paragraphs[0].runs[0].font.size = Pt(10)

plan_rows = [
    ("1 - Orientation and Code Review",
     "Week 1 (Feb)",
     "Project briefing, prototype frontend review, Leaflet.js and GeoJSON research, environment setup"),
    ("2 - Architecture and Map Component",
     "Weeks 1-2 (Mar)",
     "GeoJSON spec study, UI wireframes for five roles, frontend project structure, base map component"),
    ("3 - Core UI Development",
     "Weeks 2-3 (Mar)",
     "Ward boundary layer, application form, authentication forms, planning officer dashboard, "
     "route guards, map click handlers, form validation, site visit"),
    ("4 - Dashboard Redesign and Admin Panel",
     "Week 4 (Mar)",
     "Ward-summary dashboard redesign, API centralisation, zone overlay, admin panel, frontend documentation"),
    ("5 - Deployment and Integration",
     "Weeks 1-2 (Apr)",
     "VM deployment, Nginx configuration, integration bug fixes, end-to-end testing, "
     "HTTPS verification, ZITF hackathon, final demonstration"),
    ("6 - Handbook Study from UI Perspective",
     "Week 3 (Apr)",
     "Zimbabwe Development Management Handbook 2021 study, screen inventory, wireframes for new screens"),
    ("7 - Static Mockups for New Screens",
     "Week 4 (Apr)",
     "Static HTML/CSS mockups for all new screens, schema cross-check, submission to Rafiq"),
    ("8 - Document Verification Research",
     "Week 5 (Apr/May)",
     "Document verification research, manual process documentation, automated technology study, "
     "comparative analysis, Workers Day observation"),
    ("9 - Research Paper Completion",
     "Week 1 (May)",
     "Completion and submission of both document research papers"),
    ("10 - Document Module Interface Design",
     "Week 2 (May)",
     "Document upload wireframe, clerk review interface wireframe, planning meeting"),
]
for phase, period, activities in plan_rows:
    row = plan_tbl.add_row()
    row.cells[0].text = phase
    row.cells[1].text = period
    row.cells[2].text = activities
    for cell in row.cells:
        for para in cell.paragraphs:
            for run in para.runs:
                run.font.size = Pt(10)
doc.add_paragraph()

h("3.2  Links to Programme of Study", 2)
body(
    "The work undertaken during this placement connects directly to multiple units in the Bachelor "
    "of Science Honours Degree in Computer Science at MSU. The interactive map and frontend "
    "architecture work draws on the Web Systems and Human-Computer Interaction modules. The JWT "
    "authentication flow and sessionStorage security decision connect to the Information Security "
    "module. The API integration work, including understanding REST principles, HTTP methods, and "
    "response handling, connects to the Distributed Computing and Web Systems modules. The "
    "wireframe and UI design work reflects the Human-Computer Interaction module's coverage of "
    "user-centred design. The research papers produced align with the Technical Writing and "
    "Research Methods components of the programme. The handbook study, screen inventory, and "
    "document verification research represent substantial new domain knowledge acquired beyond "
    "the programme curriculum, directly relevant to the GIS and local government context."
)

page_break()

# ═══════════════════════════════════════
# CHAPTER 4: WORK ACCOMPLISHED
# ═══════════════════════════════════════
h("CHAPTER 4: WORK ACCOMPLISHED")

h("4.1  System Analysis and Prototype Frontend Review", 2)
body(
    "The placement began with a formal project orientation with Dr Paradzayi, who described the "
    "GIS-based Municipal Planning Information System being developed for Vungu RDC and confirmed "
    "the author's responsibility for the entire user-facing layer. The first technical task was "
    "a review of the existing prototype frontend codebase. The review identified several structural "
    "problems: no consistent component organisation across pages, API base URLs hardcoded directly "
    "in each JavaScript file rather than in a single shared configuration module, no error handling "
    "for failed API responses, and the Leaflet map initialisation code duplicated across multiple "
    "files. These findings were documented and presented to the supervisor alongside the backend "
    "review findings from the backend developer."
)
body(
    "The first week was also used for GIS technology research relevant to the frontend role. "
    "The Leaflet.js documentation was studied to understand how the library loads tile layers, "
    "renders GeoJSON vector features, handles map events, and manages layer controls. The "
    "distinction between raster tile layers served via WMS from QGIS Server and GeoJSON vector "
    "feature data served from the backend API was established early, as Leaflet handles each "
    "type differently in terms of rendering, interactivity, and performance. The GeoJSON "
    "specification (RFC 7946) was identified as essential reading before writing any frontend "
    "code that consumes spatial data."
)

h("4.2  GeoJSON Study, Wireframe Design, and Frontend Architecture", 2)
body(
    "The GeoJSON specification was studied in detail at the start of March. Every spatial feature "
    "returned from the backend API is serialised as GeoJSON, and Leaflet.js expects data in "
    "exactly this format. Understanding the precise structure of a FeatureCollection, with its "
    "required type field, features array, and per-feature geometry and properties objects, was "
    "a prerequisite for writing any map-rendering code. The specification was clear that any "
    "deviation from the format causes Leaflet to render nothing without an error message, making "
    "thorough advance study essential."
)
body(
    "User interface wireframes were designed for all five user roles: the public map view, the "
    "applicant portal, the planning officer dashboard, the senior planner overview, and the "
    "administrator panel. The wireframes defined the screen layout, the information displayed, "
    "and the user interactions for each view. They were shared with the backend developer to "
    "establish the API response shapes the backend would need to produce for each screen, "
    "allowing frontend and backend development to proceed independently."
)
body(
    "The frontend project structure was established based on the findings from the prototype "
    "review. A single config.js file was created as the sole location for the API base URL and "
    "application constants, eliminating the hardcoded URL problem. The project was organised "
    "into a logical folder hierarchy: pages, components, services (API call wrappers), styles, "
    "and assets. A shared api.js service module was built to attach the JWT Bearer token to "
    "every authenticated request automatically, ensuring consistent token handling across all "
    "pages without duplication."
)

h("4.3  Interactive Map Component and User Interface Development", 2)
body(
    "The base map component was built in the first week of March. The Leaflet map instance was "
    "configured with the correct centre coordinates for the Vungu RDC area and appropriate zoom "
    "level bounds for the nineteen-ward jurisdiction. A reusable function was written to load "
    "a GeoJSON FeatureCollection onto the map as a styled vector layer with hover highlighting "
    "and click event handling, making it straightforward to add new spatial layers without "
    "duplicating map event logic."
)
body(
    "The ward boundary layer was connected to the backend endpoint in the second week of March, "
    "rendering the nineteen ward polygons with visual styling that distinguishes ward boundaries "
    "from land parcel boundaries. The multi-step application submission form was built with "
    "client-side validation on each step: applicant identity details in step one, property "
    "information including ward selection from an API-populated dropdown in step two, and a "
    "summary confirmation before submission in step three. The login and registration forms "
    "were built with JWT token storage in sessionStorage rather than localStorage, a deliberate "
    "security decision to reduce exposure when sessions are left open on shared computers."
)
body(
    "The planning officer dashboard was built with a map panel alongside a paginated application "
    "table, so that clicking an application row highlights the property on the map. After the "
    "site visit in Week 3 of March, the dashboard was redesigned to add a ward summary section "
    "at the top: a row of cards showing the count of pending applications per ward, each linking "
    "to the filtered application list for that ward. This redesign came directly from observing "
    "how planning officers begin their working day by reviewing ward-level workload before "
    "looking at individual applications, a workflow detail absent from the written project brief. "
    "The land use zone overlay was added as a toggleable Leaflet layer with a colour-coded "
    "legend panel, and the administrator panel was built covering user management and an "
    "application statistics reporting section."
)

h("4.4  Deployment, Integration Testing, and System Demonstration", 2)
body(
    "The team deployment exercise in Week 1 of April required each team member to deploy the "
    "complete project independently from scratch. The author configured Nginx to serve the "
    "frontend static files on port 80 and proxy API requests prefixed with /api to the Node.js "
    "backend on port 3000, and validated the configuration with the nginx -t test command before "
    "reloading. A cross-team code review identified two integration defects in the frontend: "
    "the public feature API endpoint path was incorrect, and the GeoJSON FeatureCollection was "
    "being parsed with an incorrect property access path that caused all map features to render "
    "nothing. Both defects were corrected and the fix was confirmed with a full end-to-end test "
    "of the request chain from browser to database and back."
)
body(
    "A formal system demonstration was conducted to Dr Paradzayi and two Vungu RDC planning "
    "officers in Week 2 of April. All five user journeys were demonstrated through the frontend "
    "interface: public map browsing, development application submission, planning officer "
    "review of the submitted application, spatial compliance result display, and administrative "
    "reporting. All journeys completed successfully. The planning officers gave positive feedback "
    "and requested email notification functionality for applicants when application status "
    "changes. Dr Paradzayi approved the system as demonstration-ready."
)

h("4.5  Handbook Study from a User Interface Perspective", 2)
body(
    "Beginning in Week 3 of April, the focus shifted to a systematic study of the Zimbabwe "
    "Development Management (Control) Handbook 2021 from the perspective of what user interfaces "
    "the system needs to support. While the backend developer studied the handbook to define "
    "the database schema, the frontend focus was on identifying every data entry screen, every "
    "status transition visible to a user, and every document that the system must accept from or "
    "present to its users."
)
body(
    "Section 2 of the handbook describes an eight-step development application process. Each "
    "step was mapped to a specific UI interaction: step 1 produces the application registration "
    "form, step 3 produces the public notification display on the map, step 6 produces the "
    "planning officer decision screen, and so on. Section 3 was studied for the enforcement "
    "module screens: enforcement order creation and prohibition order issuance each need their "
    "own form with the fields prescribed in the handbook. Annexure 12 describes a nine-stage "
    "sequential inspection process with a strict gate structure: no stage can be signed off "
    "until the previous one is complete. This constraint must be communicated and enforced by "
    "the inspection sign-off interface. Annexure 14 lists 38 specific inspection items across "
    "eight categories that appear in the inspection assessment form. Annexure 11 defines "
    "five mandatory drawing types for the building plan appraisal checklist. Section 5.9 "
    "and Annexure 13 define the Certificate of Occupation issuance screen."
)
body(
    "The output of the handbook study was a screen inventory document listing every UI screen "
    "required by the handbook, with the data fields, user role, and handbook reference for each. "
    "This document was presented to Dr Paradzayi and Rafiq in the Week 3 virtual progress meeting "
    "and was approved as a complete account of the handbook-required interactions."
)

h("4.6  Screen Inventory, Wireframes, and Static Mockups for New Features", 2)
body(
    "Wireframes were designed for all new screens required by the schema refinement v1.2 features: "
    "the building plan submission form, the building plan appraisal checklist grouped by the five "
    "drawing types from Annexure 11, the stage inspection sign-off form with the nine sequential "
    "stages displayed as a vertical stepper, the inspection item assessment grid for the "
    "thirty-eight Annexure 14 items, the enforcement order creation form, and the certificate "
    "of occupation issuance form. The stage inspection screen was the most complex design "
    "problem: the interface must make it impossible to submit a stage sign-off if earlier stages "
    "are incomplete, while communicating this constraint to the user informatively rather than "
    "with a generic error. A vertical stepper with completed stages marked in green and future "
    "stages greyed out was adopted after evaluating the alternatives."
)
body(
    "Static HTML and CSS mockups were built for all new screens in Week 4 of April. The mockups "
    "use hardcoded sample data rather than live API calls, allowing the layout and interaction "
    "design to be reviewed before backend integration begins. The building plan appraisal "
    "checklist was implemented with an accordion layout so each drawing type section is "
    "accessible in navigation but the user focuses on one section at a time. The mockups "
    "were cross-checked against the schema refinement v1.2 document by comparing every form "
    "field against the corresponding database column. One mismatch was found and corrected: "
    "a completion date field in the building plan form that had no corresponding column in "
    "the schema was removed. All completed mockups were submitted to Rafiq as documentation "
    "of the planned frontend extensions."
)

h("4.7  Document Verification Research Papers", 2)
body(
    "Two research papers on document verification and storage were produced as the assigned "
    "research deliverables for the second phase of the placement. The topic was chosen because "
    "of its direct relevance to the document management module planned for the next phase of "
    "the system."
)
body(
    "The first paper, Manual versus Automated Document Verification for Municipal Systems, "
    "examines the verification process for the three document categories handled by the "
    "municipal planning system: national identity documents and passport photographs, title "
    "deeds, and regulatory permits and approvals. The manual verification process for each "
    "category was documented in detail by studying the verification obligations of council "
    "clerks as defined by the Zimbabwe Deeds Registries Act, the Zimbabwe Regional Town and "
    "Country Planning Act, and standard municipal practice. The automated verification "
    "technologies applicable to each category were then studied: OCR and MRZ readers for "
    "identity documents, API-based registry lookups for title deeds, and barcode readers "
    "for permit reference extraction. The paper compared both approaches across eight "
    "criteria including speed, accuracy, fraud detection, cost, and data protection, and "
    "produced a recommended hybrid model for local municipalities that automates reliably "
    "automatable tasks while using clerks for exception handling. A fraud indicator section "
    "and a clerk verification checklist were produced as practical reference tools."
)
body(
    "The second paper, Municipal Document Verification and Storage in a Local GIS User System, "
    "covers the procedural and technical aspects of document management: the document types "
    "the system handles, the submission channels, a tiered verification process with three "
    "levels based on document type and application risk, the database record structure linking "
    "each stored document to the resident, property, and application it relates to, the role-based "
    "access control table defining which user roles can upload, view, verify, and archive "
    "documents, and the document status lifecycle from submission through to verified or "
    "rejected. The paper also covers the server folder hierarchy, file naming convention, "
    "scanning standards, the SHA-256 integrity hash field, retention periods by document type, "
    "fraud recognition indicators for clerks, and data protection requirements under Zimbabwe's "
    "Data Protection Act 2021. Both papers were accepted by Rafiq."
)

h("4.8  Document Management Module Interface Design", 2)
body(
    "Following the completion of the research papers, work began on translating the verification "
    "and storage architecture into specific frontend components for the document management "
    "module. The module requires four interface elements: a document upload interface on the "
    "applicant portal, a document status display reflecting the full verification lifecycle, "
    "a clerk document review interface, and an administrator document audit trail view."
)
body(
    "The document upload interface wireframe was designed to list all required document types "
    "for the application category with a separate upload button for each. Once a file is "
    "selected, a thumbnail preview and file name appear alongside a remove button, and the "
    "submission button remains disabled until all required document types have been uploaded. "
    "The clerk review interface wireframe shows all submitted documents for a pending application "
    "with the thumbnail, document type label, submission date, and a status badge for each. "
    "The clerk can expand any document to view the full scan and complete the verification "
    "checklist defined in the research papers. Accept and Request Resubmission buttons are "
    "provided for each document, with a required notes field when requesting resubmission. "
    "These wireframes were presented to Dr Paradzayi in the Week 2 of May virtual progress "
    "meeting and approved for implementation in the next sprint."
)

page_break()

# ═══════════════════════════════════════
# CHAPTER 5: SUMMARY, CONCLUSIONS, RECOMMENDATIONS
# ═══════════════════════════════════════
h("CHAPTER 5: SUMMARY, CONCLUSIONS, AND RECOMMENDATIONS")

h("5.1  Summary of Activities Carried Out", 2)
body("The following key activities were completed during the period covered by this report:")
numbered([
    "Project orientation and prototype frontend code review.",
    "Leaflet.js interactive map library research and GeoJSON specification study.",
    "User interface wireframe design for all five user roles.",
    "Frontend project structure setup: config.js, api.js service module, folder hierarchy.",
    "Base map component with GeoJSON layer rendering, hover and click interactions.",
    "Ward boundary layer integration connected to the backend API.",
    "Multi-step development application submission form with client-side validation.",
    "Authentication forms with JWT token handling using sessionStorage.",
    "Planning officer dashboard with application table and map panel.",
    "Route-level access control for all user role pages.",
    "Map click handler and parcel feature popup for the public interface.",
    "Site visit to Vungu RDC Department of Planning with planning officer observations.",
    "Redesigned planning officer dashboard based on site visit findings: ward summary first.",
    "API call centralisation in the api.js service module with consistent error handling.",
    "Land use zone overlay with toggleable layer control and colour-coded legend.",
    "Administrator panel with user management and application statistics reporting.",
    "VM deployment exercise and Nginx configuration for static files and API proxy.",
    "Integration defect identification and correction with backend developer.",
    "Formal system demonstration to Vungu RDC planning officers, approved as demonstration-ready.",
    "ZITF 2026 Innovation Hackathon participation: APEX NEXUS frontend UI concepts.",
    "Systematic study of the Zimbabwe Development Management (Control) Handbook 2021.",
    "Screen inventory document: all handbook-required UI screens with fields, roles, and references.",
    "Wireframes for six new screens required by the schema refinement v1.2 features.",
    "Static HTML and CSS mockups for all new screens, cross-checked against the schema document.",
    "Manual versus Automated Document Verification research paper, completed and submitted.",
    "Municipal Document Verification and Storage research paper, completed and submitted.",
    "Workers Day public holiday observation on 1 May 2026.",
    "Document upload and clerk review interface wireframes for the document management module.",
])

h("5.2  Problems Encountered", 2)
body(
    "The most significant technical problem during the frontend development phase was the "
    "GeoJSON parsing defect identified during the integration review in Week 1 of April. "
    "The frontend was accessing features.data instead of features directly when iterating "
    "the FeatureCollection, which caused all map features to render nothing without any "
    "visible error. Leaflet's silent failure mode for malformed GeoJSON meant the defect "
    "was not immediately obvious during development, because the map rendered a valid "
    "empty state rather than an error. The lesson reinforced the importance of the "
    "GeoJSON specification study conducted at the start of March: knowing the exact "
    "expected structure makes defects of this kind easier to diagnose."
)
body(
    "Designing the stage inspection sign-off interface was the most demanding UI design "
    "problem of the placement. The nine-stage sequential gate structure means that the "
    "interface must enforce a completion order while communicating that constraint to the "
    "user clearly. The challenge was that a user who encounters a greyed-out submit button "
    "with no explanation will not know whether they need to complete earlier stages or "
    "whether a permission they lack is blocking them. Iterating through several layout "
    "alternatives before settling on the vertical stepper with stage status indicators "
    "took more time than anticipated."
)
body(
    "Understanding the Zimbabwe Development Management Handbook from a UI design "
    "perspective required patience with the legal language and procedural structure "
    "of the document. Identifying every screen from the handbook text required reading "
    "annexures that are written as statutory forms rather than user flow descriptions, "
    "and deriving the required fields and user interactions from the form structure. "
    "Producing the screen inventory in parallel with the reading, rather than after "
    "completing the whole document, was the approach that worked best."
)

h("5.3  Recommendations", 2)
numbered([
    "Prototype frontend codebases handed to attachment students should be reviewed for "
    "basic structural problems before handover: hardcoded configuration, duplicated "
    "initialisation logic, and absent error handling. Resolving these foundational "
    "issues before development begins saves time that could be directed to productive "
    "feature development.",
    "The Zimbabwe Development Management Handbook 2021 should be read by both the frontend "
    "and backend developers on the project team, not only by the database designer. "
    "The handbook defines the workflows and the documents that the user interface must "
    "support, and reading it produces a screen inventory that is the frontend analogue of "
    "the schema refinement document.",
    "A screen inventory document should be produced for any system whose user interactions "
    "are defined by a statutory or procedural document. Enumerating all required screens "
    "before designing wireframes prevents important interactions from being overlooked "
    "and provides a structured checklist for design review.",
    "Form fields in frontend mockups should always be cross-checked against the corresponding "
    "database schema document before the mockups are finalised. A field that has no "
    "corresponding column will be submitted silently and lost during backend integration, "
    "with no error message to indicate the problem.",
    "Future attachment students working on the document management module should study "
    "the two document verification research papers produced during this placement, as "
    "they establish the document categories, verification process, storage architecture, "
    "access control model, and data protection requirements that the frontend module "
    "must reflect.",
])

page_break()

h("REFERENCES")
refs = [
    "[1]  S. Billett, \"Learning in the Circumstances of Practice,\" Int. J. Lifelong Educ., vol. 30, no. 5, pp. 35–47, 2011.",
    "[2]  Government of Zimbabwe, Education 5.0 Policy Framework. Harare, Zimbabwe: Government Printer, 2018.",
    "[3]  Government of Zimbabwe, Development Management (Control) Handbook. Harare, Zimbabwe: Government Printer, 2021.",
    "[4]  Government of Zimbabwe, Data Protection Act, Chapter 11:12. Harare, Zimbabwe: Government Printer, 2021.",
    "[5]  Government of Zimbabwe, Deeds Registries Act, Chapter 20:05. Harare, Zimbabwe: Government Printer, 2001.",
    "[6]  Government of Zimbabwe, Regional, Town and Country Planning Act, Chapter 29:12. Harare, Zimbabwe: Government Printer, 1976.",
    "[7]  H. Butler, M. Daly, A. Doyle, S. Gillies, S. Hagen, and T. Schaub, \"The GeoJSON Format,\" IETF, RFC 7946, Aug. 2016. [Online]. Available: https://tools.ietf.org/html/rfc7946",
    "[8]  Leaflet.js Contributors, \"Leaflet Documentation,\" 2024. [Online]. Available: https://leafletjs.com/reference.html. [Accessed: May 2026].",
    "[9]  MSU Research and Innovation Hub, Hub Profile and Services Overview. Gweru, Zimbabwe: Midlands State University, 2025.",
    "[10] J. Nielsen, Usability Engineering. San Francisco, CA, USA: Morgan Kaufmann, 1994.",
    "[11] D. Norman, The Design of Everyday Things: Revised and Expanded Edition. New York, NY, USA: Basic Books, 2013.",
    "[12] Open Geospatial Consortium, \"OGC Simple Features for SQL,\" OGC Standard 06-104r4, 2011.",
    "[13] OWASP Foundation, \"OWASP Top Ten Web Application Security Risks,\" OWASP, 2021. [Online]. Available: https://owasp.org/www-project-top-ten/",
    "[14] PostGIS Development Group, \"PostGIS 3.4 Documentation,\" 2024. [Online]. Available: https://postgis.net/docs. [Accessed: May 2026].",
    "[15] B. Shneiderman, C. Plaisant, M. Cohen, S. Jacobs, and N. Elmqvist, Designing the User Interface: Strategies for Effective Human-Computer Interaction, 6th ed. Hoboken, NJ, USA: Pearson, 2016.",
]
for ref in refs:
    p = doc.add_paragraph()
    run = p.add_run(ref)
    run.font.size = Pt(10)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.left_indent = Inches(0.35)
    p.paragraph_format.first_line_indent = Inches(-0.35)

doc.save(OUT)
print(f"Saved: {OUT}")
