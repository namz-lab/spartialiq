"""
Build Munyaradzi updated logbook: copy v3 + add April Week 3 through May Week 1 (last week).
Generic shared events from Landel (same MSU institute):
  - Workers Day May 1
  - Innovation Hub open exhibition late April
"""
from docx import Document
from docx.shared import Pt, Inches
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

SRC = "Munyaradzi_Namailinga_Logbook_v3.docx"
OUT = "Munyaradzi_Namailinga_Logbook_Updated.docx"

doc = Document(SRC)

# ─────────────────────────────────────────────
# Helper: append a new page-break + month header + supervisor block + weeks table
# We'll insert after the existing content.
# ─────────────────────────────────────────────

def add_page_break(doc):
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    p = doc.add_paragraph()
    run = p.add_run()
    run.add_break(docx.enum.text.WD_BREAK.PAGE)


def bold_para(doc, text, size=12):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(size)
    return p


def normal_para(doc, text, size=10):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(size)
    return p


def supervisor_block(doc, month_label):
    bold_para(doc, month_label, 12)
    for label in ["Supervisor's Comments", "Supervisor's Signature", "Date"]:
        p = doc.add_paragraph()
        run = p.add_run(label)
        run.bold = True
        run.font.size = Pt(10)
        lines_para = doc.add_paragraph()
        lines_para.add_run(
            "................................................................................................................................................................\n"
            "................................................................................................................................................................"
        ).font.size = Pt(10)


def add_week_table(doc, header_row, rows):
    """
    header_row: list of 3 strings for the column headers
    rows: list of (week_label, date_range, description, comments) tuples
    """
    table = doc.add_table(rows=1, cols=3)
    table.style = 'Table Grid'

    # header
    hdr = table.rows[0]
    for i, h in enumerate(header_row):
        cell = hdr.cells[i]
        cell.text = ""
        run = cell.paragraphs[0].add_run(h)
        run.bold = True
        run.font.size = Pt(10)

    for (week_label, date_range, description, comments) in rows:
        row = table.add_row()

        # Col 0: week label + date range
        cell0 = row.cells[0]
        cell0.text = ""
        p0 = cell0.paragraphs[0]
        r0h = p0.add_run(week_label + "\n")
        r0h.bold = True
        r0h.font.size = Pt(10)
        r0b = p0.add_run(date_range)
        r0b.font.size = Pt(10)

        # Col 1: description
        cell1 = row.cells[1]
        cell1.text = ""
        p1 = cell1.paragraphs[0]
        p1.add_run(description).font.size = Pt(10)

        # Col 2: comments
        cell2 = row.cells[2]
        cell2.text = ""
        p2 = cell2.paragraphs[0]
        p2.add_run(comments).font.size = Pt(10)

    doc.add_paragraph()  # spacing


import docx.enum.text

# ══════════════════════════════════════════════
# APRIL 2026 continued (weeks 3-4-5)
# ══════════════════════════════════════════════

add_page_break(doc)
supervisor_block(doc, "MONTH: APRIL 2026 (continued)")
doc.add_paragraph()

add_week_table(doc,
    ["DATE", "DESCRIPTION OF WORK DONE", "STUDENT'S COMMENTS"],
    [
        (
            "WEEK 3\nMon 13 Apr\nFri 17 Apr 2026",
            "Mon 13 Apr – Fri 17 Apr 2026",
            (
                "Day 1 (Mon 13 Apr): Email Notification System Design\n"
                "Designed the email notification architecture in response to the planning officers' request from the Week 2 demonstration. "
                "Identified three notification trigger points: application status change, inspection scheduled, and application approaching decision deadline. "
                "Selected Nodemailer as the delivery library for its compatibility with the existing Node.js stack. "
                "Drafted the notification service interface and event types. "
                "Created a Mailtrap sandbox account for safe development testing without sending real emails.\n\n"
                "Day 2 (Tue 14 Apr): Email Template Development\n"
                "Built responsive HTML email templates for each notification type. "
                "Parameterised each template to accept dynamic content: application reference number, applicant name, current status label, assigned officer name, and a direct link to the portal. "
                "Used string-based rendering rather than a third-party templating engine to keep dependencies minimal and the templates auditable.\n\n"
                "Day 3 (Wed 15 Apr): Nodemailer Integration and Testing\n"
                "Integrated Nodemailer with connection pooling into the application startup routine. "
                "Added startup environment variable validation for SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS. "
                "Wired the notification service into the application status update handler so a notification fires automatically on every transition recorded in the application_status_history table. "
                "Tested all notification types against the Mailtrap sandbox and confirmed delivery and formatting.\n\n"
                "Day 4 (Thu 16 Apr): Architecture Decision on Database Triggers\n"
                "Investigated an alternative approach: using a PostgreSQL trigger with pg_notify to fire notifications from the database layer. "
                "Concluded that the application-layer implementation was preferable because it keeps notification logic visible in the codebase and avoids splitting business logic between Node.js and the database. "
                "Documented the decision and its rationale in the project architecture notes for future reference.\n\n"
                "Day 5 (Fri 17 Apr): Sprint Review\n"
                "Sprint review with Dr Paradzayi: email notification system approved. "
                "All status transitions triggering notifications correctly as confirmed through Mailtrap logs. "
                "Dr Paradzayi noted the system was approaching a point where it could be showcased to a broader MSU audience and suggested the team prepare a brief exhibit for the Innovation Hub open event planned for the final week of April."
            ),
            (
                "Designing the notification system before writing code was the right approach. "
                "Mapping the trigger points first made the implementation straightforward and easy to test in isolation.\n\n"
                "The database trigger alternative was interesting but the supervision discussion confirmed that keeping all application behaviour in one layer is better for a team project. "
                "A future developer reading the code should not need to check both the application and the database to understand how notifications work.\n\n"
                "The Innovation Hub exhibit suggestion from Dr Paradzayi was a welcome milestone to work toward."
            )
        ),
        (
            "WEEK 4\nMon 20 Apr\nFri 24 Apr 2026",
            "Mon 20 Apr – Fri 24 Apr 2026",
            (
                "Day 1 (Mon 20 Apr): Redis Installation and Configuration\n"
                "Installed Redis 7 on the production VM. "
                "Configured Redis to bind only to localhost to prevent external access, set a strong password via the requirepass directive, and enabled AOF (Append-Only File) persistence so rate limit state survives a server reboot. "
                "Verified connectivity using redis-cli ping. Documented all configuration parameters and their rationale for the team.\n\n"
                "Day 2 (Tue 21 Apr): Redis-Backed Rate Limiting Implementation\n"
                "Replaced the in-memory @fastify/rate-limit configuration with a Redis-backed implementation using ioredis as the client. "
                "The critical difference between the two approaches: in-memory rate limiting resets whenever the Node.js process restarts and does not coordinate limits across multiple application instances if the service is scaled horizontally. "
                "Redis-backed limiting maintains state independently of the application process, solving both problems in one change.\n\n"
                "Day 3 (Wed 22 Apr): Rate Limit Testing and Tuning\n"
                "Load tested the Redis rate limiter under simulated burst traffic. "
                "Confirmed limits were being enforced correctly across simulated concurrent clients and that Redis keys were expiring as configured after the window elapsed. "
                "Tuned limits by endpoint type: stricter limits on authentication endpoints (10 requests per minute per IP) and higher limits on public read endpoints (300 requests per minute per IP). "
                "Confirmed that normal users browsing the public map would not trigger rate limits under expected usage patterns.\n\n"
                "Day 4 (Thu 23 Apr): GitHub Actions CI/CD Pipeline Creation\n"
                "Created the GitHub Actions workflow file (.github/workflows/ci.yml). "
                "Configured the pipeline to trigger on push and pull request events to the main branch. "
                "Pipeline stages: checkout code, install Node.js dependencies, run npm audit for zero-vulnerability check, execute the Jest integration test suite against a test database, and produce a coverage report. "
                "Added a step to scan for accidentally committed .env files.\n\n"
                "Day 5 (Fri 24 Apr): MSU Innovation Hub Open Exhibition\n"
                "Participated in the MSU Innovation Hub open exhibition. "
                "Prepared a live demonstration of the GIS-based Municipal Planning Information System on a laptop connected to the development server. "
                "Demonstrated the public map interface, the application submission workflow, and the planning officer dashboard to visitors including university management, faculty representatives, and external guests. "
                "Several delegates from the Faculty of Built Environment expressed interest in expanding the system to cover additional rural district councils. "
                "This was an Institute-wide event attended by teams from different departments, including projects from the chemical technology and engineering research groups."
            ),
            (
                "The difference between in-memory and distributed rate limiting felt like a theoretical point until I thought through what happens when you restart the process under attack: the counter resets, which defeats the purpose entirely. "
                "Redis makes the state persistent and process-independent, which is the only correct approach for production.\n\n"
                "The Innovation Hub exhibition was the most public-facing event of the attachment. "
                "Having a working live system to demonstrate rather than slides was a significant advantage. "
                "The interest from the Faculty of Built Environment suggests the system has broader applicability than the original brief, which is a useful finding for the project team to present to the Hub management."
            )
        ),
        (
            "WEEK 5\nMon 27 Apr\nFri 01 May 2026",
            "Mon 27 Apr – Fri 01 May 2026",
            (
                "Day 1 (Mon 27 Apr): CI/CD Pipeline Completion with Auto-Deploy\n"
                "Completed the GitHub Actions pipeline by adding a deployment stage that, on a successful merge to the main branch, connects to the production VM over SSH and runs the PM2 reload command to apply the latest code with zero downtime. "
                "Tested by pushing a minor configuration change and verifying that the production server updated automatically within two minutes without any manual intervention.\n\n"
                "Day 2 (Tue 28 Apr): Branch Protection and Pull Request Enforcement\n"
                "Updated GitHub branch protection rules to require all pull requests to pass the full CI pipeline before merging is permitted. "
                "Added a pull request description template prompting contributors to confirm: no hardcoded credentials, all new endpoints have authentication guards, all new routes have integration tests, and documentation has been updated. "
                "These checks enforce the security and quality standards from the production hardening sprint at the workflow level rather than relying on individual memory.\n\n"
                "Day 3 (Wed 29 Apr): System Monitoring and Health Checking\n"
                "Configured PM2's built-in monitoring and added a cron-based health check that fires every five minutes and sends an alert email if the application returns a non-200 status on the /health endpoint. "
                "Added structured response time fields to the Nginx access log format. "
                "Reviewed the Nginx error log for recurring patterns. No critical errors were found over the preceding 48 hours of production operation.\n\n"
                "Day 4 (Thu 30 Apr): Code Consistency Review\n"
                "Conducted a thorough review of all backend route handlers to ensure consistency in error handling, logging, and response format. "
                "Identified and corrected inconsistencies in HTTP status codes where some error paths were returning 500 where 400 or 404 was the correct and more informative response. "
                "Standardised the error response body format across all endpoints to ensure the frontend could handle all error conditions uniformly.\n\n"
                "Day 5 (Fri 01 May): Workers Day Public Holiday\n"
                "Workers Day (Labour Day) is a public holiday in Zimbabwe. The MSU campus and all affiliated facilities including the Innovation Hub were closed for the day. "
                "No formal work was conducted. Used the day to review attachment progress to date and to plan priorities for the remaining weeks of the placement."
            ),
            (
                "The auto-deploy stage in the CI/CD pipeline completes the automation loop: code passes tests, merges, and reaches production without any manual steps. "
                "The value only becomes clear when you compare it to the earlier deployment process of logging in, running git pull, and restarting PM2 by hand, which introduced human error and delay.\n\n"
                "The Workers Day break was a natural point to reflect on the attachment as a whole. "
                "From the initial code review in February to a fully tested, SSL-secured, Redis-rate-limited, CI/CD-deployed system by the end of April represents a significant amount of ground covered in approximately ten weeks."
            )
        ),
    ]
)

# ══════════════════════════════════════════════
# MAY 2026 section
# ══════════════════════════════════════════════
add_page_break(doc)
supervisor_block(doc, "MONTH: MAY 2026")
doc.add_paragraph()

add_week_table(doc,
    ["DATE", "DESCRIPTION OF WORK DONE", "STUDENT'S COMMENTS"],
    [
        (
            "WEEK 1\nMon 04 May\nFri 08 May 2026",
            "Mon 04 May – Fri 08 May 2026",
            (
                "Day 1 (Mon 04 May): Frontend Integration Testing\n"
                "Worked with Theophelos to run systematic frontend integration tests across all five user journeys. "
                "Created a test matrix covering all combinations of user role, application status, and map layer state. "
                "Identified and fixed two remaining edge cases: the admin reporting dashboard was not applying the ward filter correctly for multi-ward queries, and the public map was not refreshing ward boundary highlights after a zoom-level change. "
                "Both defects were fixed, committed, and pushed through the CI pipeline for automated verification before deployment.\n\n"
                "Day 2 (Tue 05 May): Full Performance Benchmark\n"
                "Ran a staged load test across all major API endpoints. "
                "Used load profiles of 10, 25, 50, and 100 concurrent virtual users, each running for 60 seconds. "
                "Results: /api/public/wards maintained a P95 response time under 200ms at all load levels. "
                "/api/dev-control/applications maintained acceptable performance up to 50 concurrent users, with P95 rising to 380ms at 100 concurrent users, which is within specification for a council planning system. "
                "Zero errors were recorded at any load level. "
                "All results were entered into the project performance baseline register.\n\n"
                "Day 3 (Wed 06 May): Documentation Update\n"
                "Updated BACKEND_GUIDE.md to reflect all changes implemented during the April sprint: Redis rate limiting configuration, email notification architecture, CI/CD pipeline structure, spatial boundary validation logic, and CSV export endpoint. "
                "Added a dedicated section on system monitoring and health checking procedures. "
                "Reviewed and updated the API route map to confirm that all routes added in April were fully documented with authentication requirements and expected response schemas.\n\n"
                "Day 4 (Thu 07 May): Research Meeting and Second-Phase Planning\n"
                "Met with Rafiq and Dr Paradzayi to review the second-phase plan for the remainder of the attachment. "
                "Agreed on three focus areas: mobile responsiveness of the public citizen interface, integration of a document management module for supporting documents submitted with planning applications, and performance optimisation of the spatial compliance check for large ward geometry datasets. "
                "Received confirmation from Dr Paradzayi that the planning department at Vungu RDC had begun using the system for live application processing, which marked the transition from development to active production use.\n\n"
                "Day 5 (Fri 08 May): Second-Phase Sprint Planning\n"
                "Conducted a sprint planning session for the next four weeks. "
                "Produced a detailed task breakdown for the document management module: file upload endpoint with MIME type validation, document storage using a structured file system path convention, document retrieval with role-based access control, and frontend upload interface. "
                "Estimated development effort, assigned tasks between team members, and recorded the sprint plan in the project repository as a Markdown file for visibility and version control."
            ),
            (
                "The frontend integration tests surfaced two defects that unit tests would not have caught because both involved the interaction between the frontend state and the backend data. "
                "The ward filter bug in particular was only visible when querying across more than one ward simultaneously, which a single-endpoint test would never exercise.\n\n"
                "The confirmation that Vungu RDC had begun live production use was significant. "
                "A system being used in real planning decisions is a different context from a system being tested in a demonstration environment. "
                "It raised my awareness of the responsibility that comes with the backend code I have been writing.\n\n"
                "Planning the document management module exposed a question I had not thought about: what happens to uploaded files if the application is rejected or withdrawn? "
                "Retention and deletion policy needs to be agreed with the council before the module goes live."
            )
        ),
    ]
)

doc.save(OUT)
print(f"Saved: {OUT}")
