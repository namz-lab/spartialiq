"""
Build Theophelos Madzinga logbook from scratch.
Theophelos is the frontend developer on the Vungu RDC GIS project.
Same project, same supervisor (Dr Paradzayi), same institute (MSU).
Reg: R24221B | Programme: BSc (Honours) Computer Science | Level 3.1
Covers Feb 23 2026 through May 14 2026 (current date).
No dash bullets. No fabricated practical meetings.
Phase 2 (Apr 13 onwards): handbook study from UI/forms perspective,
screen design, document verification research papers.
Workers Day (May 1): no work.
"""
from docx import Document
from docx.shared import Pt, Inches
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_ALIGN_PARAGRAPH
import docx.enum.text

OUT = "Theophelos_Madzinga_Logbook_R24221B.docx"
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
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    return p


def bold_para(text, size=11):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(size)
    return p


def norm(text, size=10):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(size)
    return p


def dotline(doc):
    p = doc.add_paragraph()
    p.add_run(
        "................................................................................................................................................................\n"
        "................................................................................................................................................................"
    ).font.size = Pt(10)


def month_block(label):
    bold_para(label, 12)
    for heading in ["Supervisor's Comments", "Supervisor's Signature", "Date"]:
        bold_para(heading, 10)
        dotline(doc)


def page_break():
    doc.add_page_break()


def _white_cell(cell):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    for s in tcPr.findall(qn('w:shd')):
        tcPr.remove(s)
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), 'FFFFFF')
    tcPr.append(shd)


def add_week_table(rows):
    """rows: list of (date_cell_text, description_text, comments_text)"""
    tbl = doc.add_table(rows=1, cols=3)
    tbl.style = 'Table Grid'
    tblPr = tbl._tbl.find(qn('w:tblPr'))
    if tblPr is not None:
        lk = OxmlElement('w:tblLook')
        lk.set(qn('w:noHBand'), '1')
        lk.set(qn('w:noVBand'), '1')
        tblPr.append(lk)
    hdr = tbl.rows[0]
    for i, h in enumerate(["DATE", "DESCRIPTION OF WORK DONE", "STUDENT'S COMMENTS"]):
        hdr.cells[i].text = ""
        run = hdr.cells[i].paragraphs[0].add_run(h)
        run.bold = True
        run.font.size = Pt(10)
        _white_cell(hdr.cells[i])
    for (date_text, desc_text, comm_text) in rows:
        row = tbl.add_row()
        row.cells[0].text = ""
        row.cells[0].paragraphs[0].add_run(date_text).font.size = Pt(10)
        _white_cell(row.cells[0])
        row.cells[1].text = ""
        row.cells[1].paragraphs[0].add_run(desc_text).font.size = Pt(10)
        _white_cell(row.cells[1])
        row.cells[2].text = ""
        row.cells[2].paragraphs[0].add_run(comm_text).font.size = Pt(10)
        _white_cell(row.cells[2])
    doc.add_paragraph()


# ===== COVER =====
cen("MIDLANDS STATE UNIVERSITY", 13, bold=True)
cen("FACULTY OF INFORMATION SCIENCE AND TECHNOLOGY", 11, bold=True)
cen("DEPARTMENT OF COMPUTER SCIENCE", 11, bold=True)
doc.add_paragraph()
cen("INDUSTRIAL ATTACHMENT LOGBOOK", 13, bold=True)
doc.add_paragraph()

info_tbl = doc.add_table(rows=7, cols=2)
info_tbl.style = 'Table Grid'
info_rows = [
    ("Name", "Theophelos Madzinga"),
    ("Reg Number", "R24221B"),
    ("Programme", "Bachelor of Science (Honours) in Computer Science"),
    ("Level", "3.1"),
    ("Attachment Organisation",
     "Midlands State University (Research and Innovation) / Faculty of Built Environment "
     "- Vungu RDC GIS Project"),
    ("Attachment Period", "23 February 2026 to present"),
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

doc.add_paragraph()

# ===== FEBRUARY 2026 supervisor block =====
month_block("MONTH: FEBRUARY 2026")
month_block("MONTH: MARCH 2026")
month_block("MONTH: APRIL 2026")

page_break()

# ===================================================================
# FEBRUARY 2026  Week 1
# ===================================================================
add_week_table([
    (
        "WEEK 1\nMon 23 Feb\nFri 27 Feb 2026",

        (
            "Day 1 (Mon 23 Feb) - Project Orientation and Onboarding\n"
            "Attended the formal project orientation with supervisor Dr Paradzayi. Received "
            "the full project brief for the GIS-based Municipal Planning Information System "
            "commissioned by Vungu Rural District Council. The system is required to support "
            "nineteen wards and a five-tier user hierarchy covering public access, applicants, "
            "planning officers, senior planners, and administrators. Reviewed the project brief "
            "and made notes on the scope of the frontend responsibilities: the public map "
            "interface, the application submission portal, the planning officer dashboard, the "
            "senior planner overview, and the administrator panel.\n\n"

            "Day 2 (Tue 24 Feb) - Prototype Frontend Review\n"
            "Reviewed the existing prototype frontend codebase. Identified several structural "
            "problems: no consistent component structure, API base URLs hardcoded directly in "
            "each JavaScript file rather than in a single configuration, no error handling for "
            "failed API calls, and the Leaflet map initialisation was duplicated in multiple "
            "files. Documented the findings and presented them to the supervisor alongside "
            "Munyaradzi's backend findings from the same review.\n\n"

            "Day 3 (Wed 25 Feb) - Leaflet.js and GIS Standards Research\n"
            "Studied the Leaflet.js documentation to understand how the interactive map library "
            "works: tile layer loading, GeoJSON layer rendering, popup handling, and map "
            "controls. Researched how WMS (Web Map Service) tile layers are consumed in "
            "Leaflet using L.tileLayer.wms(), which is how the QGIS Server map tiles will "
            "be integrated. Understood the difference between raster tiles served by WMS and "
            "vector features served as GeoJSON, and how Leaflet handles each.\n\n"

            "Day 4 (Thu 26 Feb) - Technology Stack Research\n"
            "Researched the frontend technology decisions. Vanilla JavaScript was confirmed "
            "as the approach for this project, avoiding framework overhead for a system "
            "that needs to run reliably on low-bandwidth connections. Reviewed CSS grid and "
            "flexbox layout strategies for the responsive dashboard interfaces. Installed the "
            "development environment: VS Code with ESLint and Prettier, Node.js for running "
            "local tooling, and Git.\n\n"

            "Day 5 (Fri 27 Feb) - Remote SSH Configuration and Team Meeting\n"
            "Configured VS Code Remote-SSH to connect to the project development server, "
            "enabling file edits to take effect on the server directly without a separate "
            "upload step. Team meeting with Dr Paradzayi and Munyaradzi: roles confirmed "
            "(Theophelos handles frontend, Munyaradzi handles backend), Git branching "
            "strategy agreed (feature branches for development, main branch for reviewed code "
            "only), VM credentials expected in the first week of March."
        ),

        (
            "The project brief described a large and complex system, but breaking it into "
            "user roles made the scope manageable: each role has a defined set of screens, "
            "and those screens have a clear relationship to the data flows described in the "
            "brief. Starting from the user role structure rather than the feature list made "
            "it easier to plan the frontend work.\n\n"
            "The prototype frontend had the same kind of structural problems the backend did. "
            "Hardcoded URLs are a maintenance problem in any codebase, but in a frontend "
            "application they become critical when the server address or port changes during "
            "deployment. A single configuration file that all other files reference is the "
            "correct approach.\n\n"
            "Leaflet.js was new to me. The distinction between tile layers (raster images "
            "from a tile server) and GeoJSON layers (vector features rendered by the browser) "
            "was important to grasp early, because the application uses both and they behave "
            "very differently in terms of performance and interactivity."
        )
    ),
])

page_break()

# ===================================================================
# MARCH 2026
# ===================================================================
add_week_table([
    (
        "WEEK 1\nMon 02 Mar\nFri 06 Mar 2026",

        (
            "Day 1 (Mon 02 Mar) - GeoJSON Specification Study\n"
            "Studied the GeoJSON specification (RFC 7946) in detail. Every spatial feature "
            "returned from the backend API will be serialised as GeoJSON, and Leaflet.js "
            "expects data in exactly this format. A FeatureCollection must contain a type "
            "field set to FeatureCollection and a features array where each element has a "
            "type of Feature, a geometry object with type and coordinates, and a properties "
            "object. Any deviation from the specification causes Leaflet to render nothing "
            "on the map with no error message, making early study of the format essential "
            "before writing any frontend code.\n\n"

            "Day 2 (Tue 03 Mar) - UI Wireframe Design\n"
            "Designed wireframes for the five user role interfaces. The public map view "
            "centres on the interactive ward map with a search bar and a public application "
            "status tracker. The applicant portal includes a multi-step application submission "
            "form and a status tracking page. The planning officer dashboard shows a table "
            "of pending applications with quick-action buttons for status changes. The senior "
            "planner overview shows a ward-level heat map of application volumes. The admin "
            "panel covers user management and reporting. Shared the wireframes with the team "
            "and agreed on the API response shapes the backend would need to produce.\n\n"

            "Day 3 (Wed 04 Mar) - Frontend Project Structure Setup\n"
            "Set up the frontend repository structure. Established a single config.js file "
            "for the API base URL and application constants, eliminating the hardcoded URL "
            "problem from the prototype. Organised the project into a logical folder "
            "structure: pages, components, services (API call wrappers), styles, and assets. "
            "Set up a shared api.js module that attaches the JWT token to every authenticated "
            "request automatically.\n\n"

            "Day 4 (Thu 05 Mar) - Leaflet Map Component\n"
            "Built the base map component. Configured the Leaflet map instance with the "
            "correct centre coordinates for the Vungu RDC area and appropriate zoom level "
            "bounds. Added the OpenStreetMap base tile layer as a reference. Created a "
            "reusable function for loading a GeoJSON FeatureCollection onto the map as a "
            "styled vector layer with hover and click interactions.\n\n"

            "Day 5 (Fri 06 Mar) - Virtual Progress Meeting\n"
            "Weekly virtual meeting with Dr Paradzayi: VM credentials received. Agreed with "
            "Munyaradzi on the API response schemas for the ward boundaries and public "
            "features endpoints, so frontend development could proceed independently of "
            "the backend implementation. Reviewed the initial screen designs with the "
            "supervisor and received feedback on the planning officer dashboard layout."
        ),

        (
            "Reading the GeoJSON spec before writing any Leaflet code was the right "
            "approach. The silent failure mode when the format is wrong meant I needed "
            "to know the exact expected structure before connecting to any real API "
            "response. Planning the API contract between frontend and backend at the "
            "start of this week paid off throughout the rest of the development.\n\n"
            "The single config.js pattern seems obvious in hindsight but was not present "
            "in the prototype at all. Every time the server address changed in testing, "
            "the prototype required updates in multiple files. A single point of "
            "configuration is one of those foundational decisions that saves time "
            "every single day of development.\n\n"
            "The ward-level heat map for the senior planner view was the most challenging "
            "wireframe to design because it required thinking about how aggregate data "
            "is communicated visually on a map, which is a different design problem from "
            "a standard data table."
        )
    ),

    (
        "WEEK 2\nMon 09 Mar\nFri 13 Mar 2026",

        (
            "Day 1 (Mon 09 Mar) - Ward Boundary Layer Integration\n"
            "Connected the ward boundary layer to the backend /api/public/wards endpoint. "
            "The endpoint returns a GeoJSON FeatureCollection of the nineteen ward polygons. "
            "Implemented the fetch call, parsed the response, and added the polygons to "
            "the Leaflet map with colour styling that distinguishes ward boundaries from "
            "land parcel boundaries. Verified the polygons rendered correctly by comparing "
            "them against known ward geography.\n\n"

            "Day 2 (Tue 10 Mar) - Application Submission Form\n"
            "Built the multi-step development application submission form. Step 1 collects "
            "applicant identity details (name, ID number, contact information). Step 2 "
            "collects property information (stand number, ward selection from a dropdown "
            "populated from the API, development type). Step 3 is a summary confirmation "
            "before submission. Implemented client-side validation on each step before "
            "allowing navigation to the next step.\n\n"

            "Day 3 (Wed 11 Mar) - Authentication Forms and JWT Handling\n"
            "Built the login and registration forms. Implemented JWT token storage in "
            "sessionStorage rather than localStorage to reduce the exposure window if a "
            "session is left open on a shared computer. Built the authentication service "
            "module that attaches the Bearer token to all authenticated API requests and "
            "handles the 401 response by clearing the session and redirecting to the "
            "login page.\n\n"

            "Day 4 (Thu 12 Mar) - Planning Officer Dashboard\n"
            "Built the planning officer application dashboard. Displays a paginated table "
            "of applications with columns for reference number, applicant name, ward, "
            "development type, submission date, and current status. Implemented status "
            "filter buttons that call the appropriate API endpoint and refresh the table. "
            "Added a map panel alongside the table that highlights the selected application's "
            "property location when a row is clicked.\n\n"

            "Day 5 (Fri 13 Mar) - End-to-End Verification\n"
            "Deployed the current frontend build to the server and ran an end-to-end "
            "verification with Munyaradzi to confirm the full request chain was working: "
            "browser to Nginx to Node.js API to PostgreSQL and back. Confirmed the ward "
            "boundary data was rendering correctly, the login flow was working, and the "
            "application submission form was reaching the backend. Documented the deployment "
            "steps and the current feature status."
        ),

        (
            "The ward boundary rendering worked on the first attempt once the GeoJSON "
            "format was correctly understood. The value of studying the spec thoroughly "
            "before writing any code was confirmed here.\n\n"
            "Building the multi-step form required thinking carefully about state management. "
            "Each step needs to retain the data entered in previous steps. Using a simple "
            "JavaScript object as the form state and updating it at each step before "
            "submitting the complete object was cleaner than reading form fields at "
            "submission time.\n\n"
            "The side-by-side layout of the application table and the map panel required "
            "more CSS work than expected. The map needs an explicit height or it renders "
            "with zero height and disappears. That is a Leaflet-specific behaviour that "
            "is easy to miss if you are used to elements sizing themselves from their content."
        )
    ),

    (
        "WEEK 3\nMon 16 Mar\nFri 20 Mar 2026",

        (
            "Day 1 (Mon 16 Mar) - Development Control Module UI\n"
            "Built the development control module interface for planning officers. The module "
            "shows an application in full detail with all submitted information and a status "
            "change panel. The panel includes a dropdown for the new status, a text area for "
            "the decision notes, and a submit button that calls the backend development "
            "control endpoint. Implemented confirmation dialogs before any status change to "
            "prevent accidental submissions.\n\n"

            "Day 2 (Tue 17 Mar) - Authentication State and Route Guards\n"
            "Implemented route-level access control in the frontend. Each page checks the "
            "JWT token and the decoded user role before rendering. A public user attempting "
            "to access a planning officer page is redirected to the login page. A planning "
            "officer attempting to access an admin page is shown an access denied message. "
            "Role checking is done by decoding the JWT payload in the browser, with the "
            "understanding that server-side enforcement remains the authoritative control.\n\n"

            "Day 3 (Wed 18 Mar) - Map Click Handler and Spatial Feature Popup\n"
            "Implemented the map click handler for the public interface. When a user clicks "
            "on a parcel feature, the frontend queries the backend for the applications "
            "associated with that parcel and displays a popup showing the application count "
            "and most recent application status. Also implemented a hover effect that "
            "highlights the parcel boundary in a different colour when the mouse passes over "
            "it, providing visual feedback that the feature is interactive.\n\n"

            "Day 4 (Thu 19 Mar) - Form Validation and Input Handling\n"
            "Added comprehensive client-side validation across all forms. Validated ID number "
            "format against the Zimbabwe national ID format pattern. Required field checks, "
            "character limits on text inputs, and date range validation for the submission "
            "date field. Added clear error messages adjacent to each invalid field rather "
            "than a generic alert.\n\n"

            "Day 5 (Fri 20 Mar) - Site Visit to Vungu RDC and Sprint Review\n"
            "Participated in the site visit to the Vungu RDC Department of Planning with "
            "Munyaradzi. Conducted observations of how planning officers use their current "
            "paper-based system and interviewed two officers about their daily workflow. "
            "The most significant finding for the frontend: officers think in terms of "
            "ward-based workload rather than individual application lists. The dashboard "
            "layout designed from the brief placed individual applications first; the "
            "site visit showed that a ward-level summary at the top would better match "
            "how officers actually start their working day. Sprint review: all week three "
            "tasks completed."
        ),

        (
            "Building route guards in a vanilla JavaScript application required more "
            "careful thinking than in a framework where routing is handled declaratively. "
            "The solution was a checkAccess function called at the top of each page's "
            "init function, which redirects before any content is rendered if the role "
            "check fails.\n\n"
            "The map click handler required understanding Leaflet's event model. A click "
            "on a GeoJSON layer fires the event on the layer, not the underlying map, "
            "and you receive the feature properties in the event object. That is "
            "different from a standard DOM click event and took some time to understand "
            "correctly from the Leaflet documentation.\n\n"
            "The site visit was the most valuable experience of the week. Seeing "
            "how officers actually structure their day changed the dashboard design "
            "significantly. The ward summary first, application list second ordering "
            "was not obvious from the written brief but was immediately clear from "
            "watching how an officer opens their register every morning."
        )
    ),

    (
        "WEEK 4\nMon 23 Mar\nFri 27 Mar 2026",

        (
            "Day 1 (Mon 23 Mar) - Redesigned Planning Officer Dashboard\n"
            "Redesigned the planning officer dashboard based on the site visit findings. "
            "Added a ward summary section at the top: a row of cards showing the count "
            "of pending applications per ward, each card linking to the filtered application "
            "list for that ward. The redesign reduced the number of clicks needed for an "
            "officer to reach the applications they are responsible for from three to one.\n\n"

            "Day 2 (Tue 24 Mar) - Development Control Route Cleanup\n"
            "Standardised the JavaScript structure across all development control page "
            "handlers. Replaced ad-hoc API calls scattered through event listeners with "
            "calls to the centralised api.js service module, ensuring consistent error "
            "handling and token attachment across all development control operations. "
            "Added JSDoc comments to all public functions in the module.\n\n"

            "Day 3 (Wed 25 Mar) - Land Use Zone Layer\n"
            "Built the land use zone overlay layer for the map. The layer loads the zoning "
            "polygons from the backend and colours each polygon according to its zone "
            "category using a predefined colour scheme. Added a layer toggle control so "
            "users can switch the zone overlay on and off without reloading the page. "
            "Implemented a zone legend panel that displays the colour coding with "
            "the zone name.\n\n"

            "Day 4 (Thu 26 Mar) - Admin Panel\n"
            "Built the administrator panel covering user management and basic reporting. "
            "The user list displays all registered users with their roles and allows "
            "an administrator to change a user's role from the UI. The reporting section "
            "shows a summary of all applications by status and by ward, drawn from the "
            "backend statistics endpoint.\n\n"

            "Day 5 (Fri 27 Mar) - Sprint Retrospective and Frontend Documentation\n"
            "Sprint retrospective with Dr Paradzayi: all planned screens were delivered "
            "and the dashboard redesign was approved. Began writing frontend documentation "
            "covering the project structure, the API service module, the routing convention, "
            "the Leaflet map component API, and the CSS naming convention used across "
            "the application."
        ),

        (
            "The ward summary card redesign was a direct result of the site visit. "
            "The same data presented in a different order changes how useful the "
            "interface is. Information hierarchy in a dashboard should match the "
            "sequence in which a user mentally processes their workload, not the "
            "sequence in which the data is easiest to fetch.\n\n"
            "Centralising API calls in the service module made error handling "
            "consistent across the whole application. Before the centralisation, "
            "some pages showed raw error objects in the console and continued "
            "rendering broken state. After, every API failure triggers a visible "
            "user-facing message and prevents the page from showing incomplete data.\n\n"
            "The layer toggle control was more CSS work than logic work. Leaflet "
            "provides the layer management; the challenge was positioning the "
            "toggle and legend in the map corner without overlapping the zoom "
            "controls on small screens."
        )
    ),
])

page_break()

# ===================================================================
# APRIL 2026 - Weeks 1 and 2
# ===================================================================
add_week_table([
    (
        "WEEK 1\nMon 30 Mar\nFri 03 Apr 2026",

        (
            "Day 1 (Mon 30 Mar) - VM Deployment Exercise\n"
            "Participated in the team deployment exercise alongside Munyaradzi: each team "
            "member deploys the complete project independently from scratch to verify "
            "the ability to replicate a production deployment without assistance. Connected "
            "to the VM via SSH, performed a system update, and transferred project files. "
            "Encountered a permissions error when targeting an incorrect directory path; "
            "corrected the path and completed the transfer.\n\n"

            "Day 2 (Tue 31 Mar) - Frontend Deployment and Nginx Configuration\n"
            "Extracted the frontend files to the correct server directory and configured "
            "Nginx to serve the frontend static files on port 80 and proxy API requests "
            "prefixed with /api to the Node.js backend on port 3000. Validated the Nginx "
            "configuration with sudo nginx -t before reloading. Confirmed the frontend "
            "was accessible in a browser and the API calls were routing correctly.\n\n"

            "Day 3 (Wed 01 Apr) - Firewall and Public Access\n"
            "Reviewed the UFW firewall configuration set by Munyaradzi. Confirmed the "
            "correct port configuration: SSH on 22, HTTP on 80, HTTPS on 443. Tested "
            "public access to the frontend from an external browser connection. Began "
            "drafting the team deployment report documenting all steps, errors encountered, "
            "and corrective actions.\n\n"

            "Day 4 (Thu 02 Apr) - Cross-Team Code Review and Bug Fixes\n"
            "Munyaradzi reviewed the frontend code and identified two integration defects: "
            "the API endpoint paths in the frontend used /api/features instead of the "
            "correct /api/public/features, causing a 404 on all public feature requests, "
            "and the GeoJSON FeatureCollection was being parsed with an incorrect nesting "
            "assumption where features.data was used instead of features directly, causing "
            "all map features to render nothing. Both were corrected and tested.\n\n"

            "Day 5 (Fri 03 Apr) - End-to-End Integration Test\n"
            "Ran the complete end-to-end integration test with Munyaradzi: user "
            "registration, login, authenticated application submission, planning officer "
            "review, map rendering of the submitted application's property location, and "
            "admin reporting. All stages passed. Submitted the team deployment report."
        ),

        (
            "The GeoJSON parsing bug was a straightforward mistake with a significant "
            "impact: all map features silently failed to render because the array being "
            "iterated was undefined rather than the features array. This is the silent "
            "failure mode I had been warned about when studying the GeoJSON spec in "
            "Week 1 of March, and it confirmed why understanding the exact structure "
            "before writing code matters.\n\n"
            "The Nginx configuration for serving both static files and API proxying "
            "from the same server requires careful location block ordering. The /api/ "
            "location block must come before the general / block, or Nginx matches "
            "API requests against the static file handler first.\n\n"
            "The end-to-end test was the first time all the components built over six "
            "weeks were tested together as a complete system. Seeing the full journey "
            "from registration to a rendered map application confirmed that the contract "
            "agreed between the frontend and backend in Week 1 of March had been "
            "implemented correctly on both sides."
        )
    ),

    (
        "WEEK 2\nMon 06 Apr\nFri 10 Apr 2026",

        (
            "Day 1 (Mon 06 Apr) - Frontend Integration Test Scenarios\n"
            "Wrote a structured set of frontend integration test scenarios covering all "
            "five user journeys. The test scenarios describe the precise sequence of UI "
            "actions, the expected API call for each action, and the expected visual result. "
            "This gave a consistent checklist for verifying the system before the final "
            "demonstration. Running through the scenarios also identified one remaining "
            "defect: the public map was not refreshing the ward boundary highlights after "
            "a zoom-level change, leaving stale highlights from a previous selection "
            "visible at a different zoom level.\n\n"

            "Day 2 (Tue 07 Apr) - HTTPS Verification and ZITF Preparation\n"
            "Verified the frontend functioned correctly over HTTPS after Munyaradzi "
            "configured the Let's Encrypt certificate. Checked that all API calls use "
            "the HTTPS scheme rather than HTTP to avoid mixed-content browser warnings. "
            "Started reviewing the APEX NEXUS architecture documentation for the ZITF "
            "2026 Innovation Hackathon alongside the rest of the team.\n\n"

            "Day 3 (Wed 08 Apr) - ZITF Hackathon Work and Load Test Observation\n"
            "Worked on the APEX NEXUS frontend concept for the ZITF 2026 Innovation "
            "Hackathon. Drafted the user interface flows for two of the five modules: "
            "InformalX (informal sector onboarding portal) and POSGrid (POS terminal "
            "monitoring dashboard). Observed the load test results Munyaradzi ran on "
            "the main GeoJSON endpoint to understand the performance baseline from a "
            "frontend perspective.\n\n"

            "Day 4 (Thu 09 Apr) - Final Demonstration Preparation\n"
            "Prepared the live demonstration environment. Loaded a representative dataset: "
            "nineteen ward polygons, sample land parcels, and development applications "
            "covering all workflow states. Rehearsed the five user journeys to ensure "
            "smooth execution during the demonstration. Prepared a brief verbal "
            "explanation for each screen transition.\n\n"

            "Day 5 (Fri 10 Apr) - Final System Demonstration\n"
            "Participated in the formal demonstration to Dr Paradzayi and two Vungu "
            "RDC planning officers via video conference. Demonstrated all five user "
            "journeys through the frontend: public map browsing, application submission, "
            "planning officer review, spatial compliance result display, and admin "
            "reporting. All journeys completed successfully. Planning officers gave "
            "positive feedback and requested email notifications to applicants on "
            "status change. Dr Paradzayi approved the system as demonstration-ready."
        ),

        (
            "The zoom-level highlight bug was found by following the test scenario "
            "checklist rather than by casual testing. A quick manual run-through of "
            "the map would likely not have tested that specific interaction. Structured "
            "test scenarios add value precisely because they force you to test "
            "transitions and edge cases, not just the happy path.\n\n"
            "The HTTPS mixed-content check is something that is easy to miss. The "
            "browser blocks mixed-content silently in some cases and shows a warning "
            "in others. Running a search for http:// in the frontend source files "
            "before the demonstration was the simplest way to confirm none were present.\n\n"
            "Presenting to actual end users felt very different from presenting to "
            "the supervisor. The planning officers assessed the system entirely in "
            "terms of whether it solved their problems. The email notification request "
            "was their immediate priority, which showed that their mental model of "
            "the system was already as a tool they would use daily rather than "
            "a prototype to be evaluated."
        )
    ),
])

page_break()

# ===================================================================
# APRIL 2026 continued  (Weeks 3, 4, 5)
# ===================================================================
bold_para("MONTH: APRIL 2026 (continued)", 12)
for heading in ["Supervisor's Comments", "Supervisor's Signature", "Date"]:
    bold_para(heading, 10)
    dotline(doc)
doc.add_paragraph()

add_week_table([
    (
        "WEEK 3\nMon 13 Apr\nFri 17 Apr 2026",

        (
            "Day 1 (Mon 13 Apr) - Development Management Handbook Study: UI Requirements\n"
            "Started reading the Zimbabwe Development Management (Control) Handbook 2021 "
            "to understand the full permit lifecycle from a user interface perspective. "
            "While Munyaradzi studied the handbook to define the database schema, the "
            "focus here was on identifying every data entry screen, every status "
            "transition, and every document that needs to be generated or accepted by "
            "the system. Read through the eight-step development application process "
            "defined in Section 2 and mapped each step to a specific UI interaction.\n\n"

            "Day 2 (Tue 14 Apr) - Handbook Study: Inspection and Enforcement Screens\n"
            "Continued reading the handbook. Studied the enforcement framework in Section "
            "3 to understand the screens needed for enforcement orders and prohibition "
            "orders. Read through Annexures 12 and 14 in detail: the nine-stage "
            "inspection process has a very specific sequential gate structure (no stage "
            "can be signed off out of order) that must be reflected in the inspection "
            "sign-off interface. Annexure 14 lists 38 specific inspection items across "
            "eight categories that an inspector must assess at each visit.\n\n"

            "Day 3 (Wed 15 Apr) - Handbook Study: Building Plan and Certificate Screens\n"
            "Read through the building plan appraisal requirements in Section 4 and the "
            "Certificate of Occupation requirements in Section 5.9. Identified the fields "
            "that Annexure 11 (building plan appraisal checklist) requires the frontend "
            "to present per drawing type, and the fields that Annexure 13 (Certificate "
            "of Occupation template) requires for the final certificate issuance screen. "
            "Produced a screen inventory document listing every UI screen required by "
            "the handbook with the data fields, user role, and handbook reference for each.\n\n"

            "Day 4 (Thu 16 Apr) - Wireframe Design for New Screens\n"
            "Designed wireframes for the screens required by the schema refinement v1.2 "
            "features. Screens designed: building plan submission form, plan appraisal "
            "checklist (grouped by the five drawing types), stage inspection sign-off "
            "form with the nine sequential stages, inspection item assessment grid for "
            "the 38 Annexure 14 items, enforcement order creation form, and certificate "
            "of occupation issuance form. The stage inspection screen required careful "
            "design to communicate the sequential gate constraint clearly without "
            "requiring the user to read documentation.\n\n"

            "Day 5 (Fri 17 Apr) - Virtual Progress Meeting and Wireframe Review\n"
            "Attended the virtual progress meeting with Dr Paradzayi and Rafiq. Presented "
            "the screen inventory document and the wireframes for the new screens. "
            "Supervisor confirmed that the screen inventory correctly captures all "
            "handbook-required interactions. One change requested: the stage inspection "
            "sign-off screen should show the inspector which items were flagged in the "
            "previous visit to the same stage before they start the current assessment. "
            "Updated the wireframe accordingly."
        ),

        (
            "Reading the handbook as a UI designer rather than a database designer "
            "produces a different set of observations. The database view asks what "
            "data needs to be stored. The UI view asks who enters the data, at what "
            "point in the workflow, and in what sequence. Both perspectives are "
            "necessary and they complement each other.\n\n"
            "The nine-stage sequential gate structure in the inspection process is a "
            "significant design challenge. The UI must make it impossible to submit "
            "a stage six sign-off if stages one through five are not complete, but "
            "it must communicate this constraint to the user in a way that is "
            "informative rather than just blocking. A progress indicator showing "
            "completed and pending stages is more useful than a generic error message.\n\n"
            "Producing the screen inventory before designing wireframes was the right "
            "order of work. A screen inventory forces you to account for every user "
            "interaction that the handbook requires, including the ones that are easy "
            "to overlook when reading the document quickly."
        )
    ),

    (
        "WEEK 4\nMon 20 Apr\nFri 24 Apr 2026",

        (
            "Day 1 (Mon 20 Apr) - Static HTML Mockups: Application and Enforcement Screens\n"
            "Began building static HTML and CSS mockups of the new screens designed in "
            "Week 3. The static mockups use hardcoded sample data rather than API calls "
            "to allow layout and interaction design to be reviewed and approved before "
            "backend integration begins. Completed mockups for the building plan submission "
            "form and the enforcement order creation screen. Both screens use a consistent "
            "form layout that matches the existing screens in the application.\n\n"

            "Day 2 (Tue 21 Apr) - Static Mockups: Building Plan Appraisal Checklist\n"
            "Built the building plan appraisal checklist mockup. The checklist is grouped "
            "by the five drawing types from Annexure 11: floor plan, cross section, "
            "elevations, site plan, and notes and specifications. Each group contains "
            "the specific check items for that drawing type, each with a result selector "
            "(satisfactory, more information required, refused) and a notes field. "
            "The layout uses an accordion structure so all five groups are visible but "
            "each can be expanded independently.\n\n"

            "Day 3 (Wed 22 Apr) - Static Mockup: Stage Inspection Sign-Off Form\n"
            "Built the stage inspection sign-off form mockup. The form displays the nine "
            "stages as a vertical stepper. Completed stages are shown with a green check. "
            "The current stage is highlighted as the active step. Future stages are shown "
            "greyed out and their submit buttons are disabled. Below the stepper, the form "
            "shows the inspection items for the current stage from Annexure 14, each with "
            "a result field and notes. A previous visit section shows the findings from "
            "the last visit to this stage, implementing the supervisor's feedback from "
            "the Week 3 meeting.\n\n"

            "Day 4 (Thu 23 Apr) - Mockup Review and Refinements\n"
            "Reviewed all completed mockups with Munyaradzi to check that the form fields "
            "correctly match the column names and data types in the schema refinement "
            "document. Found one mismatch: the building plan submission form included a "
            "completion date field that does not exist in the schema; removed it. "
            "Confirmed the dropdown values for development type and inspection stage "
            "match the lookup table seed data in the schema document.\n\n"

            "Day 5 (Fri 24 Apr) - Mockup Submission and Research Planning\n"
            "Submitted all completed screen mockups to Rafiq as documentation of the "
            "planned frontend extensions. Attended a brief team meeting to plan the "
            "research paper deliverables for the following weeks. Agreed that the "
            "document verification and storage research area would be the frontend "
            "developer's primary research contribution, given its relevance to the "
            "planned document management module in the system."
        ),

        (
            "The accordion layout for the appraisal checklist was a deliberate choice. "
            "Showing all five drawing type sections simultaneously would produce a very "
            "long form that requires excessive scrolling. An accordion keeps all groups "
            "visible in the navigation while letting the user focus on one section at "
            "a time.\n\n"
            "The vertical stepper for the stage inspection form communicates the "
            "sequential constraint visually without any explanatory text. A user who "
            "sees stage 3 greyed out because stages 1 and 2 have checks next to them "
            "understands immediately that the sequence must be followed, without "
            "reading any instruction.\n\n"
            "Cross-checking the form fields against the schema document caught a real "
            "error. A field that does not correspond to a database column would have "
            "caused a silent failure during backend integration: the field would have "
            "been submitted, ignored by the backend, and lost without any error message."
        )
    ),

    (
        "WEEK 5\nMon 27 Apr\nThu 30 Apr 2026\n(Fri 01 May: Workers Day)",

        (
            "Day 1 (Mon 27 Apr) - Research: Document Verification in Municipal GIS Systems\n"
            "Started reading around the topic of document verification and storage in "
            "local municipal GIS user systems. Reviewed the types of documents that the "
            "Vungu RDC system would need to accept from applicants: national ID cards "
            "and passport photographs, title deeds, and regulatory permits and approvals. "
            "Read relevant sections of the Zimbabwe Deeds Registries Act and the Zimbabwe "
            "Regional, Town and Country Planning Act to understand the legal requirements "
            "for document acceptance in planning applications. Read the Zimbabwe Data "
            "Protection Act 2021 provisions relevant to storing personal information such "
            "as ID numbers and photographs.\n\n"

            "Day 2 (Tue 28 Apr) - Research: Manual Verification Process Documentation\n"
            "Studied and documented the manual verification process for each of the three "
            "document categories. For identity documents: the clerk examines the physical "
            "ID card, checks the format and security features, compares the photo to the "
            "person, and compares the submitted passport photo to the ID. For title deeds: "
            "the clerk checks the Registrar of Deeds stamp, matches the registered owner "
            "to the applicant, and cross-references the erf number against the rates "
            "register. For permits: the clerk checks the permit number against the "
            "municipal permit register and verifies the expiry date and coverage. "
            "Drafted the manual verification section of the research paper.\n\n"

            "Day 3 (Wed 29 Apr) - Research: Automated Verification Technologies\n"
            "Studied the automated verification technologies relevant to the municipal "
            "context: OCR and MRZ readers for extracting data from ID documents, "
            "facial recognition for photo matching, barcode and QR code readers for "
            "permit reference extraction, and API-based lookups against the Deeds Office "
            "and municipal permit register. Understood the infrastructure constraints "
            "facing most Zimbabwean municipalities: intermittent power, limited internet "
            "connectivity, and limited access to formal API integrations with national "
            "registries. These constraints shape which automation approaches are realistic.\n\n"

            "Day 4 (Thu 30 Apr) - Research Paper: Comparative Analysis Sections\n"
            "Wrote the comparative analysis sections of the Manual vs Automated Document "
            "Verification paper. Compared both approaches across eight criteria: speed, "
            "accuracy, cost, fraud detection, accessibility, scalability, and data "
            "protection. Also produced the per-document-type comparison showing how "
            "manual and automated approaches perform differently for ID documents, "
            "title deeds, and permits. Drafted the recommended hybrid model for local "
            "municipalities, which automates what can be automated reliably while "
            "using clerks for exceptions and cases where technology is unavailable.\n\n"

            "Day 5 (Fri 01 May) - Workers Day (Public Holiday)\n"
            "Workers Day is a public holiday in Zimbabwe. No work was conducted."
        ),

        (
            "The document verification research was directly relevant to the system's "
            "planned document management module. Studying the problem properly before "
            "building the frontend gave a much clearer picture of the verification "
            "statuses the upload interface needs to reflect: pending, under review, "
            "verified, rejected, and flagged for fraud.\n\n"
            "The infrastructure constraints in the Zimbabwe municipal context are an "
            "important part of the research. A fully automated system that depends on "
            "continuous internet connectivity and formal API access to national "
            "registries is not realistic for most councils in the short term. The "
            "hybrid model recommended in the paper is a more honest and useful "
            "output than a theoretical ideal that cannot be implemented.\n\n"
            "The legal reading (Data Protection Act, Deeds Registries Act) produced "
            "several design constraints that need to be reflected in the frontend. "
            "The requirement that original identity documents are never retained, only "
            "certified digital copies, has a direct implication for the document upload "
            "interface: it should record that the original was presented in person "
            "rather than that it was scanned and stored."
        )
    ),
])

page_break()

# ===================================================================
# MAY 2026
# ===================================================================
bold_para("MONTH: MAY 2026", 12)
for heading in ["Supervisor's Comments", "Supervisor's Signature", "Date"]:
    bold_para(heading, 10)
    dotline(doc)
doc.add_paragraph()

add_week_table([
    (
        "WEEK 1\nMon 04 May\nFri 08 May 2026",

        (
            "Day 1 (Mon 04 May) - Research Paper Completion: Manual vs Automated Verification\n"
            "Completed the Manual versus Automated Document Verification research paper. "
            "Finalised the summary scorecard table comparing both approaches across all "
            "criteria, the per-document-type comparison tables, and the hybrid model "
            "architecture section with its implementation phases. Added a fraud indicator "
            "section listing the visual and documentary signs that a clerk should escalate, "
            "and a clerk verification checklist that can be used as a practical reference "
            "at the service counter. Reviewed the paper for consistency and submitted to "
            "Rafiq as a completed deliverable.\n\n"

            "Day 2 (Tue 05 May) - Research Paper: Municipal Document Verification and Storage\n"
            "Started the second document-related research paper covering the verification "
            "and storage of resident documents in a local municipal GIS user system. This "
            "paper focuses on the procedural and technical aspects of document management: "
            "the types of documents the municipal system handles, the submission channels, "
            "the tiered verification process (three levels depending on document type and "
            "application risk), the database record structure that links each stored "
            "document to the resident, property, and application it relates to, and the "
            "data protection obligations the municipality must meet.\n\n"

            "Day 3 (Wed 06 May) - Document Storage Architecture and Access Controls\n"
            "Wrote the document storage sections of the second research paper: the server "
            "folder hierarchy, the file naming convention, the scanning standards for "
            "each document type, the database record linkage structure including the "
            "SHA-256 integrity hash field, the retention periods by document type, and "
            "the role-based access control table defining which user roles can upload, "
            "view, verify, and archive documents. Also wrote the document status flags "
            "section covering the lifecycle states each document passes through from "
            "submission to verified or rejected.\n\n"

            "Day 4 (Thu 07 May) - Virtual Progress Meeting\n"
            "Attended the virtual progress meeting with Dr Paradzayi and Rafiq. Submitted "
            "the completed Manual vs Automated Document Verification paper and the draft "
            "of the Municipal Document Verification and Storage paper. Both were accepted. "
            "Rafiq confirmed that the document verification papers, together with "
            "Munyaradzi's SQL versus NoSQL paper, constitute the research deliverables "
            "assigned for this phase of the attachment.\n\n"

            "Day 5 (Fri 08 May) - Document Storage Paper: Completion and Submission\n"
            "Completed the Municipal Document Verification and Storage paper. Finalised "
            "the concluding sections on fraud recognition indicators for clerks, the "
            "full clerk verification checklist covering all document categories, and the "
            "conclusion summarising how a well-designed document verification and storage "
            "framework supports trustworthy municipal records. Added all references and "
            "submitted the final paper to Rafiq."
        ),

        (
            "The clerk verification checklist at the end of the Manual vs Automated "
            "paper is the most practically useful output. A research paper that "
            "ends with a tool a council clerk can actually use at the counter is "
            "more valuable than one that ends with a theoretical conclusion.\n\n"
            "The SHA-256 hash field in the document record structure was a "
            "detail I had not encountered before in a practical context. Storing "
            "a hash of the file at the time of upload allows the system to detect "
            "if the stored file is ever modified or corrupted, because recomputing "
            "the hash of the current file and comparing it to the stored hash will "
            "produce a mismatch if the file has changed.\n\n"
            "The virtual meeting confirmed that the research papers are being "
            "received as serious outputs, not as student exercises. That changed "
            "how I approached the writing. A paper that a supervisor submits to "
            "a council or an external partner needs a different level of rigour "
            "in its reasoning and its practical recommendations."
        )
    ),

    (
        "WEEK 2\nMon 11 May\nThu 14 May 2026",

        (
            "Day 1 (Mon 11 May) - Frontend Implications of Document Storage Architecture\n"
            "Reviewed the document storage architecture described in the research papers "
            "to identify the specific frontend components that will be needed for the "
            "document management module. The module will require: a document upload "
            "interface with file type and size validation, a document status display "
            "that reflects the verification lifecycle (pending, under review, verified, "
            "rejected, flagged), a clerk review interface for marking documents as "
            "verified or requesting resubmission, and an admin document audit trail "
            "view showing who verified each document and when.\n\n"

            "Day 2 (Tue 12 May) - Document Upload Interface Design\n"
            "Designed the wireframe for the document upload interface on the application "
            "submission portal. The interface lists the required document types for the "
            "application category (ID card, title deed, relevant permits) with an upload "
            "button for each. Once a file is selected, a preview thumbnail and the file "
            "name are displayed alongside a remove button. The submission button is "
            "disabled until all required document types have been uploaded. A status "
            "indicator updates to show each document's verification state once the "
            "application has been submitted.\n\n"

            "Day 3 (Wed 13 May) - Clerk Document Review Interface Design\n"
            "Designed the wireframe for the clerk document review interface. The screen "
            "shows a list of submitted documents for a pending application, each with "
            "a thumbnail, the document type label, the submission date, and a current "
            "status badge. The clerk can expand each document to view the full scan "
            "and complete the verification checklist items from Annexure A of the "
            "document research paper. Accept and Request Resubmission buttons are "
            "provided for each document, with a required notes field when requesting "
            "resubmission.\n\n"

            "Day 4 (Thu 14 May) - Planning and Progress Review\n"
            "Attended the weekly virtual meeting with Dr Paradzayi. Presented the document "
            "management module wireframes. Supervisor confirmed that the interface designs "
            "correctly reflect the verification workflow described in the research papers "
            "and approved proceeding to implementation in the next sprint. Agreed on the "
            "development priority order: document upload on the applicant portal first, "
            "followed by the clerk review interface, and finally the admin audit trail. "
            "Reviewed and agreed on the remaining attachment objectives for the second "
            "half of the placement period."
        ),

        (
            "Translating the research paper into frontend requirements was a direct "
            "application of the document verification work. The paper describes what "
            "the system should do; the wireframes describe how a user interacts with "
            "it to make that happen. Having done both in sequence, the wireframes "
            "are grounded in the actual verification requirements rather than in "
            "a generic file upload pattern.\n\n"
            "The document status badge is a small but important UI element. The "
            "research paper defines eight distinct document statuses: pending, under "
            "review, verified, verified with query, rejected, expired, superseded, "
            "and flagged for suspected fraud. Each status needs a distinct visual "
            "treatment that communicates its meaning without the user having to read "
            "a label. Colour coding with consistent semantics (green for verified, "
            "amber for pending or query, red for rejected or flagged) is the "
            "appropriate approach.\n\n"
            "The required notes field when requesting resubmission was an oversight "
            "in the first wireframe draft. A clerk who rejects a document without "
            "explaining why forces the applicant to guess what to resubmit. Making "
            "the notes field mandatory prevents this outcome at the interface level."
        )
    ),
])

doc.save(OUT)
print(f"Saved: {OUT}")
