from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

doc = Document()
for sec in doc.sections:
    sec.top_margin    = Cm(2.0)
    sec.bottom_margin = Cm(2.0)
    sec.left_margin   = Cm(2.5)
    sec.right_margin  = Cm(2.0)

# ── helpers ───────────────────────────────────────────────────────────────────
def sf(run, name="Times New Roman", size=11, bold=False, italic=False, colour=None):
    run.font.name   = name
    run.font.size   = Pt(size)
    run.font.bold   = bold
    run.font.italic = italic
    if colour:
        run.font.color.rgb = RGBColor(*colour)

def shade(cell, fill):
    tc = cell._tc; pr = tc.get_or_add_tcPr()
    s = OxmlElement("w:shd")
    s.set(qn("w:val"),"clear"); s.set(qn("w:color"),"auto"); s.set(qn("w:fill"),fill)
    pr.append(s)

def vcenter(cell):
    tc = cell._tc; pr = tc.get_or_add_tcPr()
    va = OxmlElement("w:vAlign"); va.set(qn("w:val"),"center"); pr.append(va)

def cline(text, size=12, bold=False, sb=0, sa=4, colour=(0,0,0), align=WD_ALIGN_PARAGRAPH.CENTER):
    p = doc.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_before = Pt(sb)
    p.paragraph_format.space_after  = Pt(sa)
    r = p.add_run(text); sf(r, size=size, bold=bold, colour=colour)

def pb(): doc.add_page_break()

def month_header(month_year):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after  = Pt(4)
    r = p.add_run(f"MONTH: {month_year}")
    sf(r, size=13, bold=True, colour=(31,56,100))

def week_row(t, week_label, work_done, comments):
    """Add one week row to the main logbook table."""
    row = t.add_row()
    # col 0 – week label
    c0 = row.cells[0]
    shade(c0, "D9E1F2")
    p0 = c0.paragraphs[0]; p0.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r0 = p0.add_run(week_label); sf(r0, size=10, bold=True)

    # col 1 – work done
    c1 = row.cells[1]
    p1 = c1.paragraphs[0]; p1.alignment = WD_ALIGN_PARAGRAPH.LEFT
    r1 = p1.add_run(work_done); sf(r1, size=10)

    # col 2 – student comments
    c2 = row.cells[2]
    p2 = c2.paragraphs[0]; p2.alignment = WD_ALIGN_PARAGRAPH.LEFT
    r2 = p2.add_run(comments); sf(r2, size=10)

def supervisor_block():
    for label in ["Supervisor's Comments", "Supervisor's Signature", "Date"]:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(4)
        p.paragraph_format.space_after  = Pt(2)
        r = p.add_run(label); sf(r, bold=True, size=11)
        doc.add_paragraph("." * 120)
        doc.add_paragraph("." * 120)

def make_table():
    t = doc.add_table(rows=1, cols=3)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for i, h in enumerate(["DATE", "DESCRIPTION OF WORK DONE", "STUDENT'S COMMENTS"]):
        shade(hdr[i], "1F3864")
        p = hdr[i].paragraphs[0]; p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(h); sf(r, size=11, bold=True, colour=(255,255,255))
    # column widths
    widths = [Cm(3.0), Cm(9.0), Cm(6.5)]
    for row in t.rows:
        for i, w in enumerate(widths):
            row.cells[i].width = w
    return t

# ═══════════════════════════════════════════════════════════════════════════════
# COVER PAGE
# ═══════════════════════════════════════════════════════════════════════════════
cline("MIDLANDS STATE UNIVERSITY", 16, True, sa=2, colour=(0,51,102))
cline("Faculty of Science and Technology", 13, True, sa=16, colour=(0,51,102))
cline("INDUSTRIAL ATTACHMENT LOGBOOK", 18, True, sa=16, colour=(31,56,100))

meta = [
    ("Name",                    "Munyaradzi Namailinga"),
    ("Reg Number",              "R243100H"),
    ("Programme",               "Bachelor of Science (Honours) in Computer Science"),
    ("Level",                   "3.1"),
    ("Attachment Organisation", "MSU Research and Innovation Hub / Vungu RDC GIS Project"),
    ("Attachment Period",       "23 February 2026 to 13 May 2026 (ongoing)"),
    ("Industrial Supervisor",   "Dr Paradzayi (Project Manager)"),
]
mt = doc.add_table(rows=len(meta), cols=2)
mt.style = "Table Grid"
mt.alignment = WD_TABLE_ALIGNMENT.CENTER
for i,(lbl,val) in enumerate(meta):
    lc = mt.rows[i].cells[0]; vc = mt.rows[i].cells[1]
    shade(lc,"1F3864"); shade(vc,"EBF3FB")
    lc.width = Cm(5); vc.width = Cm(10)
    lp = lc.paragraphs[0]; lp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    lr = lp.add_run(lbl); sf(lr, bold=True, colour=(255,255,255))
    vp = vc.paragraphs[0]; vp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    vr = vp.add_run(val); sf(vr)
pb()

# ═══════════════════════════════════════════════════════════════════════════════
# FEBRUARY 2026
# ═══════════════════════════════════════════════════════════════════════════════
month_header("FEBRUARY 2026")
t = make_table()

week_row(t,
"WEEK 1\nMon 23 Feb\nFri 27 Feb 2026",
"""Day 1 (Mon 23 Feb) - Project Orientation and Onboarding
Attended the formal project orientation with supervisor Dr Paradzayi. He gave a full briefing on the system: a GIS-based Municipal Planning Information System commissioned by Vungu Rural District Council, covering 19 wards with a five-tier user hierarchy (Public, Applicant, Planning Officer, Senior Planner, Administrator) across land-use planning, development applications, spatial inspections, and a public access portal. Read through the full project brief and annotated areas needing clarification. The scope was larger than any project I had worked on before, but the layered architecture made it manageable.

Day 2 (Tue 24 Feb) - Prototype Codebase Review
Reviewed the existing prototype codebase. Recognised immediately that the password storage approach was wrong: prepending "hashed_" to plain text is not hashing. Also flagged hardcoded database credentials in two source files, missing input validation on public endpoints, and no structured logging. Documented all findings and presented them to Dr Paradzayi.

Day 3 (Wed 25 Feb) - GIS Technology Research
Studied PostGIS and OGC standards. I understand relational databases well from coursework, but storing and querying geographic shapes as a typed geometry column required a shift in thinking. Studied WMS and WFS: WMS serves rendered map images, WFS serves raw vector data as GeoJSON. These are the standards our Nginx and QGIS Server components will implement.

Day 4 (Thu 26 Feb) - Tech Stack Research and Environment Setup
Researched the full technology stack. I had used Express.js before so comparing it to Fastify was straightforward: Fastify's schema-based validation and better throughput made it the right choice for a system handling large GeoJSON payloads. Set up the development environment: VS Code, ESLint, Prettier, Node.js v22 LTS, Git configured.

Day 5 (Fri 27 Feb) - Remote SSH Configuration and Team Meeting
Configured VS Code Remote-SSH to edit files directly on the project VM. Team meeting with Dr Paradzayi and Theophelos: roles confirmed (I take backend, Theophelos takes frontend), Git branching strategy agreed, VM credentials expected in Week 1 of March.""",

"""I came in knowing relational databases and basic REST API design, so the overall architecture made sense quickly. What was genuinely new was the GIS layer. Storing and querying geographic shapes is a different mental model from standard tabular data, and I needed to spend real time on it before touching any schema design.

Recognising the password storage issue on Day 2 felt like the security module paying off. We covered authentication security in second year and the "hashed_" prefix was obviously not hashing. Applying that knowledge in a real codebase was a different experience from answering exam questions about it.

The project brief described a large system. Breaking it into layers (data, API, frontend, GIS bridge) made the scope feel workable."""
)

supervisor_block()
pb()

# ═══════════════════════════════════════════════════════════════════════════════
# MARCH 2026
# ═══════════════════════════════════════════════════════════════════════════════
month_header("MARCH 2026")
t = make_table()

week_row(t,
"WEEK 1\nMon 02 Mar\nFri 06 Mar 2026",
"""Day 1 (Mon 02 Mar) - PostGIS Schema Design Research
Studied PostGIS spatial database schema design in depth: geometry column types (Point, LineString, Polygon, MultiPolygon), SRID enforcement, and GiST spatial indexing. I had covered B-tree indexes in my databases module, so understanding why GiST is needed for multi-dimensional data was a logical step. Standard B-trees rely on one-dimensional ordering, which geographic shapes do not have. GiST groups shapes by their bounding boxes, enabling fast overlap queries without full table scans.

Day 2 (Tue 03 Mar) - GeoJSON Specification and API Design
Read RFC 7946 (the GeoJSON specification) in full. GeoJSON is the exchange format between the backend API and Leaflet.js. Every spatial feature returned from the API must be a valid GeoJSON FeatureCollection: any deviation causes silent rendering failures in Leaflet with no error output. Mapped out the expected response schema for all spatial endpoints.

Day 3 (Wed 04 Mar) - VS Code Remote-SSH and QGIS Server Documentation
Fully configured VS Code Remote-SSH for direct server file editing. Also reviewed QGIS Server documentation: WMS tile requests are proxied through Nginx to QGIS Server, while WFS vector data requests go directly to PostGIS. This keeps rendered tiles and raw data on separate paths.

Day 4 (Thu 05 Mar) - Fastify Framework Deep Dive
Explored Fastify's plugin ecosystem and lifecycle hooks. The key insight: schema-based routing provides automatic request validation (malformed requests are rejected before the handler runs) and faster JSON serialisation through pre-compiled serialisers. Having used Express middleware before, the Fastify hook pattern felt familiar but more structured.

Day 5 (Fri 06 Mar) - Progress Meeting, VM Credentials Received
Meeting with Dr Paradzayi: VM credentials received (IP: 10.10.8.253). Installation order agreed to avoid port conflicts: PostgreSQL/PostGIS first, then Node.js and PM2, then Nginx. Initial entity list reviewed. Technology stack formally confirmed.""",

"""The GiST index concept clicked because I already understood B-tree indexes. GiST is essentially the same idea applied to two-dimensional bounding box data. Once I made that connection, spatial indexing made complete sense.

Defining the GeoJSON response schema before writing any code was a discipline from the software engineering module: establish the contract first so both backend and frontend can work to it independently. It meant Theophelos could start frontend work without waiting for the API.

Fastify's named and explicitly ordered hooks are genuinely better for a team project than Express's implicit sequential middleware chain."""
)

week_row(t,
"WEEK 2\nMon 09 Mar\nFri 13 Mar 2026",
"""Day 1 (Mon 09 Mar) - Ubuntu VM Initialisation and Security Baseline
Initialised the Ubuntu 24.04 LTS VM via SSH. Applied all pending kernel and package updates. Configured SSH hardening: disabled password authentication, disabled root login, set MaxAuthTries to 3. Rebooted for a clean baseline.

Day 2 (Tue 10 Mar) - Backend Stack Installation
Installed the full backend stack in dependency order: Node.js v22 LTS, PM2, PostgreSQL 16 with PostGIS 3.4, Nginx 1.24, and Git. Generated SSH keys on the VM for authenticated Git pulls. Verified all services with systemctl status before proceeding. PM2 was new to me as a concept: running node app.js directly stops when the session ends. PM2 supervises the process, restarts it on crash, and starts it on server reboot.

Day 3 (Wed 11 Mar) - Repository Setup, Team Access and Strategic Meeting
Created team user accounts on the VM and set up the shared project directory with chmod 2775 (setgid) so new files automatically inherit the group. Initialised the Git repositories and migrated the prototype codebase with a restructured commit history. Meeting with Dr Paradzayi: confirmed three-layer architecture, no plain-text credentials in any files, approved to proceed to schema and API development.

Day 4 (Thu 12 Mar) - Codebase Migration and Branch Protection
Completed migration of all prototype code into the new repository. Used git rebase -i to produce a clean, meaningful commit history where each commit represents one atomic change. Configured branch protection on main: direct pushes disabled, all merges require a pull request with at least one review.

Day 5 (Fri 13 Mar) - CRUD Demo Deployment and End-to-End Verification
Deployed a minimal CRUD demo to verify the full request chain before committing to the main project structure: browser to Nginx (port 80) to Node.js (localhost:3000) to PostgreSQL. All stages passed cleanly. Documented the deployment steps for the team.""",

"""This was the first time I had configured a server I was solely responsible for. Setting up systemctl, managing packages, and configuring file permissions in a real deployment context is different from a lab environment: mistakes here have real consequences.

The chmod 2775 setgid bit was something I had read about but never used. Seeing it work as expected was a confirmation that the OS module theory applies directly in practice.

I had used git rebase interactively once before but had not fully appreciated why commit history matters until now. A clean log of atomic commits is the difference between understanding a system and being lost when someone else reads it months later."""
)

week_row(t,
"WEEK 3\nMon 16 Mar\nFri 20 Mar 2026",
"""Day 1 (Mon 16 Mar) - Dependency Audit and Vulnerability Remediation
Ran npm audit across the backend repository. Found 10 vulnerabilities: 2 moderate, 6 high, 2 critical. Replaced the abandoned xmldom package with its maintained fork. Upgraded node-pg-migrate to resolve transitive CVEs. Achieved a zero-vulnerability audit report before any other work proceeded.

Day 2 (Tue 17 Mar) - Authentication System Overhaul and Status History
Replaced the insecure password prefix scheme with bcrypt at cost factor 12. Replaced forgeable tokens with HMAC-SHA256 JWTs. Removed the backdoor registration endpoint that bypassed role validation. Replaced Math.random() with crypto.randomBytes(32) for token generation. Personal contribution: proposed and implemented an application_status_history table that records every status transition with the officer's user ID and a timestamp, creating an audit trail that was missing from the original design.

Day 3 (Wed 18 Mar) - Server Entry Point Improvements
Added startup-time environment variable validation: the server now fails immediately with a clear error if JWT_SECRET or DATABASE_URL are absent rather than starting silently and crashing at runtime. Replaced console.log calls with structured pino JSON logging. Implemented graceful shutdown so in-flight requests drain before the server exits on SIGTERM or SIGINT.

Day 4 (Thu 19 Mar) - Credential Security and Git History Rewrite
Removed hardcoded database passwords from two OGC bridge source files. Replaced with environment variable guards that throw at module load time if DB_PASSWORD is absent. Purged the commit containing the hardcoded credential using git filter-branch. All team members re-cloned. Database password rotated immediately across all environments.

Day 5 (Fri 20 Mar) - Middleware Fixes, Site Visit and Sprint Review
Rewrote the InputSanitizer as a Fastify onRequest hook targeting only XSS and path traversal patterns: the previous version was blocking legitimate inputs containing words like SELECT or ORDER. Site visit to Vungu RDC Department of Planning: structured interviews with planning officers revealed that the 19-ward hierarchy is the fundamental organising principle of all council data, which was missing from the technical documentation entirely. Sprint review: all 5 security tasks completed.""",

"""Seeing 2 critical CVEs in a project about to go live made the risk concrete in a way coursework examples never did. I knew bcrypt was correct from second year, but implementing it in a real system rather than a tutorial is a different experience.

The status history table was my own suggestion after reviewing the schema. The planning system had no record of who changed what and when, which would be a real problem in any dispute. The supervisor approved it immediately. Having an idea I proposed end up in the production schema was motivating.

The site visit changed how I thought about the project. We had been building against a written brief. Talking to actual users revealed how they work in practice, and the 19-ward hierarchy being the core organising principle was something no amount of document reading would have surfaced."""
)

week_row(t,
"WEEK 4\nMon 23 Mar\nFri 27 Mar 2026",
"""Day 6 (Mon 23 Mar) - Public Routes Refinement and Ward Statistics
Added MAX_FEATURES_LIMIT (10,000) enforced at both schema validation and handler level. Fixed a critical bounds parsing bug in the /api/public/features endpoint that was returning a polygon ring instead of a bounding box, causing silent rendering failures. Added a layer existence check returning HTTP 404 for unpublished layers. Parallelised statistics queries using Promise.all. Personal innovation: built a new /api/public/ward-stats endpoint returning application counts per ward broken down by status, directly from a planning officer's comment during the site visit.

Day 7 (Tue 24 Mar) - Development Control Routes Refinement
Replaced all debug console.log calls with structured pino logging throughout the development control module: the most business-critical part of the system, handling application approvals, rejections, and conditional approvals. Standardised error handling patterns across all route handlers. Added comprehensive JSDoc documentation to the development control module.

Day 8 (Wed 25 Mar) - Land Use Management Routes Rewrite
Fixed a critical const mutation TypeError (const countQuery += ... fails at runtime on any filtered query but passes all static analysis). Removed a dead params array never used in query execution. Parallelised data fetch and count queries with Promise.all, cutting paginated endpoint response time by about 50%. Added HTTP 409 Conflict detection for duplicate zone control entries. Implemented COALESCE-based partial updates for PATCH endpoints.

Day 9 (Thu 26 Mar) - Infrastructure and Docker Configuration
Created docker-compose.yml with a three-service stack (db, api, qgis-server) with health check ordering so the API waits for PostgreSQL readiness before starting. Created docker-compose.dev.yml with an anonymous node_modules volume to prevent Windows-compiled binaries causing failures inside Linux containers. Rewrote .env.example from 9 to 50 documented lines covering every required variable.

Day 10 (Fri 27 Mar) - Architecture Documentation and Sprint Retrospective
Authored BACKEND_GUIDE.md: technology stack rationale, full repository layout, database schema for 20+ tables, complete API route map, authentication flow, known issues register, and a 16-step production deployment checklist. Created ARCHITECTURE_DIAGRAMS.md with Mermaid diagrams covering C4 Context, C4 Container, ER Diagram, Authentication Flow, Security Layers, and PostGIS Data Flow. Documentation approved as official onboarding material.""",

"""The bounds parsing bug was instructive because MapLibre accepted the wrong value without any error: the map just behaved incorrectly in a subtle way. Silent acceptance of wrong data is often harder to debug than an outright crash, and explicit response schema validation catches these before they reach the frontend.

The ward statistics endpoint was the most satisfying contribution of the week. It came from listening to users rather than following a spec, and a single aggregated query gave the planning department a ward-level backlog view they had previously compiled manually.

The const mutation bug showed why real integration testing matters. Static analysis cannot catch runtime errors that only appear under specific conditions."""
)

supervisor_block()
pb()

# ═══════════════════════════════════════════════════════════════════════════════
# APRIL 2026
# ═══════════════════════════════════════════════════════════════════════════════
month_header("APRIL 2026")
t = make_table()

week_row(t,
"WEEK 1\nMon 30 Mar\nFri 03 Apr 2026",
"""Day 1 (Mon 30 Mar) - VM Deployment Exercise
Participated in a structured team deployment exercise: deploy a complete web project from scratch on the shared VM starting from zero, to verify that every team member could independently replicate a production deployment. Connected to the VM via SSH, performed a full system update, and installed prerequisite utilities. Attempted project transfer via SCP: encountered a Permission Denied error caused by targeting /home (root-owned system directory) instead of /home/doctor/ (user-writable subdirectory). Diagnosed and corrected the path. Transfer completed successfully.

Day 2 (Tue 31 Mar) - Application Deployment and Nginx Configuration
Extracted the project archive on the VM, installed Node.js dependencies, and confirmed the application was listening on localhost:3000 via curl. Installed Nginx and configured /etc/nginx/sites-available/default as a reverse proxy. Validated the Nginx configuration with sudo nginx -t before reloading.

Day 3 (Wed 01 Apr) - UFW Firewall Configuration and Public Access
Configured UFW in the correct sequence: opened port 22 (SSH) before enabling the firewall. Enabling UFW without first allowing SSH permanently locks out all SSH sessions, requiring physical console access. Opened port 80, activated UFW, and verified public browser access. Began drafting the team intern discovery report documenting all deployment steps, errors, root causes, and corrective actions.

Day 4 (Thu 02 Apr) - Code Review, Security Fix and Spatial Validation
Conducted peer code review of Theophelos's frontend API integration. Found two defects: mismatched endpoint paths and incorrect GeoJSON FeatureCollection parsing caused by a double-nesting assumption. Added requireAuth middleware to previously unguarded development control route handlers. Personal innovation: proposed and implemented a spatial boundary validation check using PostGIS ST_Within on application submission. The system now verifies that submitted property coordinates actually fall within the ward the applicant declared. Previously, applications could be filed under the wrong ward with no automatic detection.

Day 5 (Fri 03 Apr) - End-to-End Integration Test and Progress Meeting
Tested the complete end-to-end flow for the first time: user registration, JWT issuance, authenticated API request, PostGIS spatial query, GeoJSON response, Leaflet map rendering. All stages passed. Submitted the team intern discovery report. Meeting with Dr Paradzayi: spatial validation innovation reviewed and approved. Final demonstration to Vungu RDC scheduled for the following week.""",

"""The SCP Permission Denied error taught me something concrete. I knew that /home contains user directories, but targeting /home versus /home/doctor/ in a real transfer command makes the distinction stick in a way that knowing it theoretically does not.

The spatial boundary validation was the idea I was most proud of. The system was accepting ward declarations without checking them against the actual ward polygon data in PostGIS. A single ST_Within query at submission time closes that gap. It was a small addition technically but meaningfully improved the integrity of the planning data.

The end-to-end test showed that individual components that work in isolation can still fail when connected. The GeoJSON parsing bug was a good example: both the API response and the frontend parsing were individually correct, but the integration assumption about nesting was wrong."""
)

week_row(t,
"WEEK 2\nMon 06 Apr\nFri 10 Apr 2026",
"""Day 1 (Mon 06 Apr) - Integration Test Suite and Research Scoping
Wrote a comprehensive API integration test suite using Jest and Supertest. Integration tests fire real HTTP requests against a running server connected to a real database, testing the full middleware chain rather than isolated functions. Tests covered: /health (200 with DB reachable, 503 with DB unreachable), authentication routes (valid credentials return JWT, invalid return 401, missing fields return 400), public ward endpoint (valid GeoJSON, MAX_FEATURES_LIMIT respected), and development control routes (401 without token, data returned with valid token). During testing found a previously undetected security gap: /api/admin/users was missing its requireAuth guard. The entire admin user management route was publicly accessible. Added the guard immediately and added a regression test. Research scoping meeting with Rafiq: agreed on a structured documentation plan covering legacy system documentation, a formal system status report, and finalised data model documents.

Day 2 (Tue 07 Apr) - SSL/HTTPS Implementation and System Documentation
Implemented SSL/HTTPS using Certbot with Let's Encrypt. Configured Nginx to serve over HTTPS on port 443 with HSTS headers and automatic HTTP-to-HTTPS redirect. Configured the certificate auto-renewal cron job. Conducted structured research into the existing prototype system as the first documentation artefact for Rafiq.

Day 3 (Wed 08 Apr) - CSV Export Feature, Load Testing and Documentation
Personal innovation: implemented an admin CSV export endpoint (/api/admin/export) allowing administrators to download a filtered report of all development applications. The endpoint accepts query parameters for ward, status, and date range, builds a dynamic SQL query, and streams results as a properly formatted CSV with column headers. The planning department had previously been asking the system administrator to run manual queries for these reports. Conducted API load testing at 50 concurrent virtual users: P95 response time 187ms, zero errors. Completed the system status report for Rafiq.

Day 4 (Thu 09 Apr) - Demo Environment and Architecture Documentation
Configured the production-mirror staging environment with a complete representative dataset: 19 ward polygons inserted using ST_GeomFromText with SRID 4326, 847 land parcel geometries, 34 sample development applications across all workflow states, and 5 user accounts covering all role tiers. Wrote a demo script for five user journeys. Finalised the backend architecture and schema documentation: all 22 database tables with purpose, column-level specifications, foreign key relationships as a dependency graph, index definitions, and an annotated ER diagram.

Day 5 (Fri 10 Apr) - Final System Demonstration and Progress Meeting
Conducted the formal final demonstration to Dr Paradzayi and two Vungu RDC planning officers via video conference. All five user journeys demonstrated successfully. Officers gave positive feedback on the interactive map interface and application submission workflow. They requested one enhancement: automated email notifications to applicants when application status changes. Dr Paradzayi formally approved the system as demonstration-ready and noted the BACKEND_GUIDE.md and architecture diagrams as exemplary for a Level 3 attachment student. All three research documentation artefacts accepted by Rafiq.""",

"""Writing the integration tests made a point from the testing module concrete: unit tests check that components work in isolation, integration tests check that they work together. The missing auth guard on /api/admin/users was completely invisible when reading the code. It only showed up when I actually sent a request without a token and got a 200 response.

The CSV export came from a real user problem. The planning team was running manual queries to compile reports that a well-designed export endpoint could generate in seconds. It also introduced me to streaming responses in Node.js, which I had not implemented before.

The final demonstration to Vungu RDC officers was the most professionally significant experience of the attachment so far. Presenting a working system to people who will actually use it, and having them test it in real time, is completely different from any academic presentation."""
)

week_row(t,
"WEEK 3\nMon 13 Apr\nFri 17 Apr 2026",
"""Day 1 (Mon 13 Apr) - Zimbabwe Development Management Handbook Study
Started a systematic study of the Zimbabwe Development Management (Control) Handbook 2021. This is the statutory instrument from the Ministry of Local Government and Public Works that prescribes exactly how local planning authorities must manage development management. Studied Section 2 in detail: the eight-step development permit application process, from initial registration through One-Stop-Shop consultation, public notification, objections period, officer recommendation, and permit issuance or refusal. Noted all data objects and actors at each step and began mapping them to potential database tables.

Day 2 (Tue 14 Apr) - Handbook Study Continued: Enforcement and Building Plans
Studied Sections 3.3 and 3.4 (enforcement orders and prohibition orders against illegal development) and Section 4 with Annexure 11 (building plan appraisal). The enforcement sections describe two distinct legal instruments that need separate tables. Annexure 11 specifies five mandatory drawing types for every building plan submission, each of which requires its own appraisal checklist. That means at minimum four tables to cover building plan appraisal properly.

Day 3 (Wed 15 Apr) - Handbook Study Continued: Stage Inspections and COO
Studied Annexures 12 and 14 (the nine-stage construction inspection sequence and inspection items by category) and Section 5.9 with Annexure 13 (Certificate of Occupation). Annexure 12 defines exactly nine inspection stages in a fixed sequence, each with specific items to check. The existing schema had a single undifferentiated inspection table that could not represent this structure at all. Annexure 14 defines inspection items by category within each stage. Documented all findings.

Day 4 (Thu 16 Apr) - Gap Analysis
Produced the formal gap analysis comparing the v1.1 enterprise geodatabase schema against all Handbook requirements identified this week. The analysis found 15 missing tables across five implementation phases and 7 missing columns on the existing permit_application table. Documented each gap with its Handbook basis and a severity rating. Presented the findings to Dr Paradzayi and Rafiq in the afternoon progress meeting. Approved to proceed with the full schema refinement document.

Day 5 (Fri 17 Apr) - Schema Refinement Planning and Phase 1 Design
Began planning the schema refinement document v1.2. Designed the three Phase 1 tables in detail: application_consultation (for the One-Stop-Shop step), application_objection (for objections received during the public notification period), and application_appeal (for appeals to the Administrative Court). Wrote column-level specifications and DDL for all three tables with appropriate CHECK constraints and UNIQUE indexes.""",

"""Reading the Handbook took longer than I expected. Legal and procedural language does not map transparently to database attributes. The data requirements are often implicit in the procedural steps rather than stated explicitly, and several sections required multiple readings before I was confident I had captured everything.

The gap analysis was eye-opening. The v1.1 schema covered roughly two of the five lifecycle phases. Phase 3 (building plan appraisal) and Phase 4 (stage inspections) were essentially absent despite being core statutory functions that any planning authority must perform. It made the earlier prototype feel underspecified in retrospect.

Designing the Phase 1 tables was satisfying because the Handbook makes the data requirements explicit for the application process. Once I understood the One-Stop-Shop step and the objections period as distinct procedural events, the table structures followed naturally."""
)

week_row(t,
"WEEK 4\nMon 20 Apr\nFri 24 Apr 2026",
"""Day 1 (Mon 20 Apr) - Phase 2 and Phase 3 Schema Design
Designed the Phase 2 enforcement tables: enforcement_order and prohibition_order. The Handbook treats these as two distinct legal instruments, so they get separate tables with a foreign key from prohibition_order to enforcement_order. Designed the four Phase 3 building plan appraisal tables: building_plan, plan_drawing, plan_appraisal, and plan_appraisal_item. Applied the principle that all legal constraints from the Handbook must be enforced at the database level through CHECK constraints, not just at the application layer.

Day 2 (Tue 21 Apr) - Phase 4 and Phase 5 Schema Design
Designed the Phase 4 stage inspection tables. Created three lookup tables (inspection_stage, inspection_category, inspection_item_type) with seed data matching Annexures 12 and 14 exactly, and two operational tables (stage_inspection and stage_inspection_result). Added UNIQUE constraints on (application_id, stage_id) in stage_inspection so the same application cannot have duplicate records for the same inspection stage. Designed the Phase 5 occupation_certificate table with a UNIQUE constraint on application_id to enforce that each application can result in at most one certificate.

Day 3 (Wed 22 Apr) - DDL Authoring and Implementation Workflow
Wrote the complete DDL for all 15 new tables and the 2 modified existing tables, ordered to respect foreign key dependencies. Produced the phase-by-phase implementation workflow mapping each Handbook procedure to the specific tables, API endpoints, and GIS screens involved. This workflow section was requested by Rafiq to help future developers understand which part of the database serves which part of the planning process.

Day 4 (Thu 23 Apr) - Schema Refinement Document Completion and Submission
Assembled all five parts of the schema refinement document v1.2: Handbook content analysis, gap analysis table, column-level specifications, DDL, and implementation workflow. Reviewed the document for consistency between the specifications and the DDL. Submitted v1.2 to Rafiq and Dr Paradzayi.

Day 5 (Fri 24 Apr) - 3NF Verification: Lookup Tables and Phase 1 Tables
Began the 3NF verification report as a companion to v1.2. Verified the three lookup tables first (inspection_stage, inspection_category, inspection_item_type) as they have simple structures that are straightforward to verify. Verified all three Phase 1 tables (application_consultation, application_objection, application_appeal). All confirmed in 3NF with no decomposition needed.""",

"""Designing 15 tables in one week was the most concentrated database work I have done. The key discipline was keeping the Handbook open and checking every column against a specific statutory requirement rather than adding columns based on intuition. Every field has a source.

The enforcement table design required careful reading of Sections 3.3 and 3.4. Enforcement orders and prohibition orders are separate legal instruments with different triggers and different legal authority, so they genuinely need separate tables rather than a status field on a single table.

The UNIQUE constraint on (application_id, stage_id) in stage_inspection was a detail I nearly missed. Without it, the database would allow the same inspection stage to be recorded twice for the same application, which would corrupt the nine-stage sequence that the Handbook requires."""
)

supervisor_block()
pb()

# ═══════════════════════════════════════════════════════════════════════════════
# MAY 2026
# ═══════════════════════════════════════════════════════════════════════════════
month_header("MAY 2026")
t = make_table()

week_row(t,
"WEEK 5\nMon 27 Apr\nFri 01 May 2026",
"""Day 1 (Mon 27 Apr) - 3NF Verification: Phase 2 and Phase 3 Tables
Continued the 3NF verification report. Verified the two Phase 2 enforcement tables (enforcement_order and prohibition_order) and the four Phase 3 building plan appraisal tables (building_plan, plan_drawing, plan_appraisal, plan_appraisal_item). The plan_appraisal_item table required more careful analysis because of its composite unique constraint on (appraisal_id, drawing_type, check_item). Confirmed this composite is the determining key for all other attributes in the table with no partial or transitive dependencies.

Day 2 (Tue 28 Apr) - 3NF Verification: Phase 4 and Phase 5 Tables, Report Completion
Verified the four Phase 4 operational tables (stage_inspection and stage_inspection_result) and the Phase 5 occupation_certificate table. Assembled all verification analyses into the final 3NF Verification Report v1.2.1. All 15 tables confirmed in 3NF. Submitted v1.2.1 to Rafiq as a companion to the schema refinement document v1.2.

Day 3 (Wed 29 Apr) - Development Control Matrix Analysis
Received the Development Control Matrix from the Spatial Planning and Development unit. The DCM is a spreadsheet with 32 land-use group rows and 19 zone columns showing whether each land use is Permitted (P), Prohibited (X), or requires Special Consent (S) in each zone, giving 608 permission values. Identified immediately that it is in unnormalised form: the 19 zone columns are a repeating group. Began planning the normalisation approach.

Day 4 (Thu 30 Apr) - DCM Normalisation: UNF to 1NF to 2NF
Applied normalisation to the DCM in stages. Achieved 1NF by unpivoting the 19 zone columns into rows, producing DCM_1NF(ug_code, ug_description, zone_code, zone_name, permission_status) with composite primary key (ug_code, zone_code) and 608 rows. Applied 2NF by identifying two partial dependencies: ug_description depends only on ug_code, and zone_name depends only on zone_code. Decomposed into three relations: land_use_group, land_use_zone, and development_control_permission.

Fri 01 May - Workers Day Public Holiday
Public holiday observed. No work.""",

"""The plan_appraisal_item verification was the most analytically demanding table in the report. The composite unique constraint is not the primary key, but it is a candidate key that determines all other attributes. Getting that distinction right and documenting it clearly took longer than the simpler tables.

Receiving the DCM felt like the beginning of a different kind of problem. Schema design for new tables is fairly straightforward once you understand the Handbook requirements. Normalising an existing unnormalised structure requires identifying dependencies that are implicit in the spreadsheet layout rather than stated anywhere.

The 19-column repeating group in the DCM is a textbook example of why normalisation matters in practice. Storing 608 values as columns rather than rows makes every zone compliance query an enormous CASE statement rather than a simple WHERE clause."""
)

week_row(t,
"WEEK 6\nMon 04 May\nFri 08 May 2026",
"""Day 1 (Mon 04 May) - DCM Normalisation: 2NF to 3NF and Verification
Completed the 3NF check on all three DCM relations. No transitive dependencies were found in any of them: ug_description depends only on ug_code, zone_name depends only on zone_code, and permission_status depends directly on the composite primary key (ug_code, zone_code). All three relations confirmed in 3NF. Verified losslessness: a natural join of the three relations on their shared keys reproduces the original 608-value matrix exactly. Defined two integration tables linking the DCM to the existing spatial_planning schema: zone_spatial_plan (linking zone_code to PostGIS polygon geometry) and application_zone_check (recording the zone compliance check result for each application).

Day 2 (Tue 05 May) - DCM Normalisation Report
Wrote the full DCM Normalisation Report documenting the three-stage normalisation process with formal notation, the losslessness verification, the five normalised relations with full column specifications, and the integration table definitions. Submitted to Rafiq.

Day 3 (Wed 06 May) - DCM Data Dictionary v1.0
Produced the DCM Data Dictionary v1.0 as a companion to the normalisation report. Documents all six DCM-related tables at column level: name, data type, nullable status, default value, constraint description, and a plain-language explanation of the business rule each column enforces. Also included the seed data specification for land_use_group and land_use_zone so a developer can populate these tables directly from the dictionary without needing the original spreadsheet.

Day 4 (Thu 07 May) - SQL vs NoSQL Research Paper: Analysis and Writing
Worked on the SQL versus NoSQL Databases for GIS Systems research paper. Evaluated both paradigms across sixteen criteria relevant to GIS workloads: spatial data support, query language, ACID compliance, scalability, schema flexibility, indexing and performance, raster data handling, topology and network analysis, real-time and streaming data, replication, tooling and ecosystem, and typical use cases. PostgreSQL with PostGIS performs better on twelve of the sixteen criteria for the Vungu RDC workload.

Day 5 (Fri 08 May) - SQL vs NoSQL Research Paper: Completion and Submission
Completed and submitted the SQL vs NoSQL research paper. The conclusion is that PostgreSQL with PostGIS is the right choice for the authoritative spatial dataset and all statutory planning records. NoSQL databases (MongoDB for document storage, Elasticsearch for full-text search) are identified as potentially useful for specific future modules but not as replacements for the core geodatabase.""",

"""The losslessness verification for the DCM was important to document explicitly. Any decomposition that loses data is worse than the unnormalised original, so demonstrating that a natural join reproduces all 608 values exactly is the proof that the normalisation is sound.

Writing the DCM data dictionary was more time-consuming than I expected. Documenting every constraint and business rule in plain language requires thinking carefully about what each column is actually saying, not just what type it is. It is a different kind of thinking from writing DDL.

The SQL vs NoSQL comparison forced me to engage with NoSQL seriously rather than dismissing it. The conclusion that PostgreSQL is right for this system is more convincing because I had to work through the cases where NoSQL would actually be better, like real-time streaming, and explain why those cases do not apply here."""
)

week_row(t,
"WEEK 7\nMon 11 May\nFri 13 May 2026",
"""Day 1 (Mon 11 May) - Document Verification Research: Manual Verification Methods
Began the Document Verification and Storage research paper. This covers the three document categories required at application submission: identity documents (national ID, passport), title deeds registered by the Deeds Registry of Zimbabwe, and previous planning approvals from a recognised LPA. Researched manual verification methods for each category: visual security feature checks, official stamp verification, registration number format checking, and cross-referencing with council records. Documented a fraud indicator checklist for council clerks based on common document fraud patterns.

Day 2 (Tue 12 May) - Document Verification Research: Automated Methods and Comparison
Researched automated digital verification methods: OCR for text extraction from scanned documents, barcode and QR-code reading for electronically issued documents, facial recognition for identity document photo matching, and API-based registry lookups. Assessed automation feasibility for each document type in the Zimbabwean context. The Deeds Registry API is not publicly accessible, which limits automated title deed verification significantly. Wrote the manual versus automated comparison section.

Day 3 (Wed 13 May) - Document Storage Architecture and Data Protection
Researched and wrote the document storage architecture section: file naming conventions, database record linkage patterns, access control tiers (document visibility by user role), and data retention policies. Studied Zimbabwe's Data Protection Act Chapter 11:12 (2021) and its implications for storing identity documents and title deeds in a municipal system: lawful basis for processing, data subject rights, security obligations, and breach notification requirements. The DPA section has direct implications for the database schema and access control model.""",

"""The manual verification section was more involved than I expected because it required understanding what makes a genuine Zimbabwean identity document or title deed look different from a fraudulent one. That is domain knowledge that no amount of database design experience prepares you for.

The Deeds Registry API gap is a real limitation. Automated title deed verification is theoretically possible but practically unavailable in the current environment. Documenting that clearly is more useful than designing a system around an API that does not exist.

The Data Protection Act work was new territory. Privacy legislation is not covered in the Computer Science curriculum in much depth, but it has direct implications for every design decision in the document storage module: what you store, who can access it, how long you keep it, and what you do when a data subject asks to see their records."""
)

supervisor_block()
pb()

# final note
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(20)
r = p.add_run("END OF LOGBOOK (Reporting period: 23 February 2026 to 13 May 2026)")
sf(r, size=11, bold=True, colour=(31,56,100))

out = r"c:\Users\munya\Desktop\WRL\Munyaradzi_Namailinga_Logbook_v4.docx"
doc.save(out)
print(f"Saved: {out}")
