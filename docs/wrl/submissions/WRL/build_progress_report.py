"""
Build the MSU Research Progress Report for the Vungu RDC GIS project.
Template: MIDLANDS STATE UNIVERSITY RESEARCH PROGRESS TEMPLATE.docx
Example:  Professor Wekwete- Tabulated Research Progress Report 18-06-18(1).docx
Generic, non-technical language suitable for a research committee audience.
"""
from docx import Document
from docx.shared import Pt, Inches
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_ALIGN_PARAGRAPH

OUT = "Vungu_GIS_Research_Progress_Report_May2026.docx"
doc = Document()

section = doc.sections[0]
section.left_margin = Inches(1.2)
section.right_margin = Inches(1.0)
section.top_margin = Inches(1.0)
section.bottom_margin = Inches(1.0)


# ── helpers ────────────────────────────────────────────────────────────────

def center(text, size=12, bold=False):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    run.font.size = Pt(size)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    return p


def left(text, size=10, bold=False, after=3):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    run.font.size = Pt(size)
    p.paragraph_format.space_after = Pt(after)
    return p


def dotline():
    p = doc.add_paragraph()
    p.add_run(
        "................................................................................................................................................................\n"
        "................................................................................................................................................................"
    ).font.size = Pt(9)


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


def set_col_width(cell, width_inches):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcW = OxmlElement('w:tcW')
    tcW.set(qn('w:w'), str(int(width_inches * 1440)))
    tcW.set(qn('w:type'), 'dxa')
    tcPr.append(tcW)


def add_cell_text(cell, text, size=9, bold=False):
    cell.text = ""
    paragraphs = text.split('\n')
    first = True
    for para_text in paragraphs:
        if first:
            p = cell.paragraphs[0]
            first = False
        else:
            p = cell.add_paragraph()
        if para_text.strip():
            run = p.add_run(para_text)
            run.font.size = Pt(size)
            if bold:
                run.bold = True
        p.paragraph_format.space_after = Pt(1)
    _white_cell(cell)


def add_cell_mixed(cell, label_text, body_text, label_size=9, body_size=9):
    cell.text = ""
    p = cell.paragraphs[0]
    run = p.add_run(label_text)
    run.bold = True
    run.font.size = Pt(label_size)
    p.paragraph_format.space_after = Pt(2)
    for line in body_text.split('\n'):
        bp = cell.add_paragraph()
        bp.add_run(line).font.size = Pt(body_size)
        bp.paragraph_format.space_after = Pt(1)
    _white_cell(cell)


def disable_banding(table):
    tblPr = table._tbl.find(qn('w:tblPr'))
    if tblPr is not None:
        lk = OxmlElement('w:tblLook')
        lk.set(qn('w:noHBand'), '1')
        lk.set(qn('w:noVBand'), '1')
        tblPr.append(lk)


# ══════════════════════════════════════════════════════════════════════════
# HEADER
# ══════════════════════════════════════════════════════════════════════════
center("MIDLANDS STATE UNIVERSITY", 13, bold=True)
center("RESEARCH AND INNOVATION", 11, bold=True)
doc.add_paragraph()
center("RESEARCH PROGRESS REPORT", 13, bold=True)
doc.add_paragraph()

info_tbl = doc.add_table(rows=5, cols=2)
info_tbl.style = 'Table Grid'
disable_banding(info_tbl)
info_data = [
    ("Project Title:",
     "Towards an Innovative Planning and Management Framework for Local Authorities: "
     "The Case for Introducing an Enterprise Wide GIS Application for Vungu Rural District Council"),
    ("Principal Investigator(s):", "Dr Paradzayi (Project Manager, MSU Faculty of Built Environment)"),
    ("Research Team:",
     "Munyaradzi Namailinga (R243100H)\n"
     "Theophelos Madzinga (R24221B)\n"
     "Rafiq (Research Assistant and Documentation Coordinator)"),
    ("Affiliation:", "MSU Research and Innovation Hub / Faculty of Built Environment"),
    ("Date of Report:", "May 2026"),
]
for i, (lbl, val) in enumerate(info_data):
    info_tbl.rows[i].cells[0].text = lbl
    info_tbl.rows[i].cells[0].paragraphs[0].runs[0].bold = True
    info_tbl.rows[i].cells[0].paragraphs[0].runs[0].font.size = Pt(10)
    set_col_width(info_tbl.rows[i].cells[0], 1.8)
    for line in val.split('\n'):
        if info_tbl.rows[i].cells[1].paragraphs[0].text == '':
            p = info_tbl.rows[i].cells[1].paragraphs[0]
            p.text = line
        else:
            p = info_tbl.rows[i].cells[1].add_paragraph(line)
        for run in p.runs:
            run.font.size = Pt(10)
    _white_cell(info_tbl.rows[i].cells[0])
    _white_cell(info_tbl.rows[i].cells[1])

doc.add_paragraph()

left("I certify that all the details in this progress report are correct and complete.", 9, bold=True)
doc.add_paragraph()
left("Principal Investigator's Signature  ................................   Date  ......................", 9)
doc.add_paragraph()
left("Comments on this research", 9, bold=True)
dotline()
doc.add_paragraph()
left("Innovation Manager (if applicable) Signature  ............................   Date  ......................", 9)
left("Research Manager — Research and Innovation Signature  ............................   Date  ......................", 9)
doc.add_paragraph()

# ══════════════════════════════════════════════════════════════════════════
# MAIN TABLE
# ══════════════════════════════════════════════════════════════════════════
mt = doc.add_table(rows=1, cols=3)
mt.style = 'Table Grid'
disable_banding(mt)
col_widths = [1.6, 1.6, 3.8]


def add_row(c0, c1, c2):
    row = mt.add_row()
    for ci, w in enumerate(col_widths):
        set_col_width(row.cells[ci], w)
    add_cell_text(row.cells[0], c0, size=9, bold=True)
    add_cell_text(row.cells[1], c1, size=9)
    add_cell_text(row.cells[2], c2, size=9)
    return row


# Header row
for ci, (h, w) in enumerate(zip(["SECTION", "SUB-SECTION", "CONTENT"], col_widths)):
    set_col_width(mt.rows[0].cells[ci], w)
    add_cell_text(mt.rows[0].cells[ci], h, size=9, bold=True)

# ── 1. Project Overview ────────────────────────────────────────────────────
add_row(
    "1. Project Overview",
    "Problem Statement",
    "Rural District Councils in Zimbabwe continue to rely on paper-based systems "
    "for managing development permit applications, land use planning, building "
    "inspections, and occupation certificates. Vungu Rural District Council, "
    "which covers nineteen wards, has no digital information management system "
    "to support its planning functions.\n"
    "\n"
    "This means permit applications are tracked in manual registers, spatial "
    "analysis for planning decisions cannot be performed efficiently, and "
    "the public has no access to ward-level planning information. The Zimbabwe "
    "Development Management (Control) Handbook 2021 defines a detailed and "
    "comprehensive permit lifecycle that the current paper-based approach cannot "
    "adequately support."
)

add_row(
    "1. Project Overview",
    "Project Objectives",
    "1.  To develop a web-based GIS Planning Information System covering the full "
    "development permit lifecycle for Vungu RDC.\n"
    "2.  To design a spatial database that fully captures the requirements of the "
    "Zimbabwe Development Management (Control) Handbook 2021.\n"
    "3.  To develop a secure web application accessible to all five user categories: "
    "public, applicants, planning officers, senior planners, and administrators.\n"
    "4.  To produce comprehensive technical documentation for the database design, "
    "normalisation, and data standards adopted.\n"
    "5.  To produce research papers on the technology and procedural aspects of "
    "digital planning management for local authorities."
)

# ── 2. Progress Summary ────────────────────────────────────────────────────
add_row(
    "2. Progress Summary",
    "Methods Implemented",
    "Systems Analysis: The existing prototype system was reviewed and a full "
    "security audit conducted. Weaknesses identified were corrected before "
    "development proceeded.\n"
    "\n"
    "Database Design and Normalisation: The land use permission data (Development "
    "Control Matrix) was reorganised from its original spreadsheet format into a "
    "properly structured relational database. The full database schema was refined "
    "to include fifteen additional tables required by the handbook, covering "
    "consultations, objections, appeals, enforcement, building plan appraisals, "
    "stage inspections, and certificates of occupation.\n"
    "\n"
    "Application Development: A web application with an interactive map interface "
    "was developed and deployed on a production server. The system supports five "
    "user roles and allows planning officers to manage applications spatially.\n"
    "\n"
    "Documentation: Database documentation, data dictionaries, normalisation "
    "reports, and comparative research papers were produced."
)

add_row(
    "2. Progress Summary",
    "Key Findings",
    "The original prototype system had significant data security shortcomings "
    "that required a dedicated remediation effort before further development "
    "could proceed safely.\n"
    "\n"
    "A systematic review of the Zimbabwe Development Management (Control) "
    "Handbook 2021 revealed that fifteen categories of planning data required "
    "by the handbook were not captured by the existing database design. These "
    "gaps were documented and addressed in the revised schema.\n"
    "\n"
    "The land use permission matrix, which governs what developments are "
    "permitted in each planning zone, existed only in spreadsheet form and "
    "was restructured into a relational format that allows the system to "
    "perform automated compliance checks.\n"
    "\n"
    "A formal demonstration to Vungu RDC planning officers in April 2026 "
    "confirmed that the system meets the client's operational requirements "
    "and was approved for active use."
)

add_row(
    "2. Progress Summary",
    "Milestones Achieved",
    "Security review and remediation of the prototype system completed.\n"
    "Production server set up and configured.\n"
    "Spatial database designed, deployed, and verified.\n"
    "Web application developed with interactive map and all five user interfaces.\n"
    "System deployed with secure connection and publicly accessible.\n"
    "Formal demonstration to Vungu RDC planning officers completed and approved "
    "(April 2026).\n"
    "Database Schema Refinement Document v1.2 produced.\n"
    "Database Verification Report v1.2.1 produced.\n"
    "Development Control Matrix Normalisation Report produced.\n"
    "Data Dictionary v1.0 produced.\n"
    "Three research papers completed and accepted by the project team."
)

# ── 3. Outputs ─────────────────────────────────────────────────────────────
row = mt.add_row()
for ci, w in enumerate(col_widths):
    set_col_width(row.cells[ci], w)
add_cell_text(row.cells[0],
              "3. Outputs:\nPublications / Prototypes / Intellectual Property",
              size=9, bold=True)
add_cell_mixed(row.cells[1],
               "Outputs Statement",
               "\n"
               "Three research papers produced and submitted:\n"
               "  SQL vs NoSQL Databases for GIS Systems.\n"
               "  Manual vs Automated Document Verification for Municipal Systems.\n"
               "  Municipal Document Verification and Storage in a Local GIS System.\n"
               "\n"
               "Working web-based GIS prototype demonstrated to client (April 2026).\n"
               "\n"
               "Technical documentation suite: database schema design, verification "
               "report, normalisation report, data dictionary.\n"
               "\n"
               "Document management module interface designs in progress.")
add_cell_text(row.cells[2],
              "Expected date of Publication: Q3 2026\n"
              "\n"
              "Expected date of IP filing: Q4 2026\n"
              "(Copyright application for the GIS web application)\n"
              "\n"
              "Expected date of prototype completion:\n"
              "Core system demo-ready: April 2026 (achieved).\n"
              "Document management module: Q3 2026.\n"
              "Full handover to Vungu RDC: Q4 2026.",
              size=9)

# ── 4. Challenges and Solutions ────────────────────────────────────────────
add_row(
    "4. Challenges and Solutions",
    "Risks, Issues or Challenges Encountered",
    "The prototype system delivered at the start of the project contained "
    "security weaknesses that required corrective work before development "
    "could continue safely. This consumed time originally planned for "
    "new feature development.\n"
    "\n"
    "The Zimbabwe Development Management (Control) Handbook 2021 is a "
    "detailed legal and procedural document. Interpreting its requirements "
    "for the purposes of database design and system development required "
    "careful reading and repeated review of its annexures.\n"
    "\n"
    "Access to the project server was delayed during the early weeks of "
    "the development phase, temporarily limiting hands-on development work.\n"
    "\n"
    "No major risks to overall project completion have been identified."
)

add_row(
    "4. Challenges and Solutions",
    "Actions Taken",
    "A structured security review was conducted and all identified weaknesses "
    "were corrected before new development proceeded. Access controls, "
    "data protection measures, and input handling were all strengthened.\n"
    "\n"
    "A systematic and section-by-section reading of the Development Management "
    "Handbook was conducted alongside the gap analysis, producing a documented "
    "inventory of all data and screen requirements before design work began. "
    "This approach ensured no statutory requirement was overlooked.\n"
    "\n"
    "The period of delayed server access was used productively for research "
    "into the technical standards and protocols underpinning the system, "
    "resulting in a stronger technical foundation when access became available."
)

# ── 5. Future Plans ────────────────────────────────────────────────────────
add_row(
    "5. Future Plans",
    "Next Steps",
    "Implement the fifteen additional database tables identified in the "
    "schema refinement to fully support the development permit lifecycle "
    "as defined in the handbook.\n"
    "\n"
    "Develop the document management module: allowing applicants to upload "
    "supporting documents, clerks to verify them, and administrators to "
    "maintain an audit trail.\n"
    "\n"
    "Extend the web interface with the new screens required for building "
    "plan appraisals, stage-by-stage construction inspections, enforcement "
    "orders, and certificate of occupation issuance.\n"
    "\n"
    "Conduct acceptance testing with Vungu RDC staff using the full "
    "council dataset.\n"
    "\n"
    "Prepare the system for formal handover to Vungu RDC, including user "
    "guides and administrator training materials."
)

add_row(
    "5. Future Plans",
    "Timeline Adjustments",
    "Additional database features (schema v1.2): Q2 to Q3 2026.\n"
    "Document management module: Q3 2026.\n"
    "Extended user interface screens: Q3 2026.\n"
    "Acceptance testing with Vungu RDC: Q3 2026.\n"
    "Formal system handover and copyright application: Q4 2026.\n"
    "\n"
    "The core system milestone (demonstration-ready) was achieved as "
    "planned in April 2026. The overall project remains on schedule."
)

# ── 6. Funding ─────────────────────────────────────────────────────────────
row = mt.add_row()
for ci, w in enumerate(col_widths):
    set_col_width(row.cells[ci], w)
add_cell_text(row.cells[0], "6. Funding", size=9, bold=True)
add_cell_text(row.cells[1], "Financial Statement", size=9)
add_cell_text(row.cells[2],
              "Grant received: Project supported through the MSU Research and "
              "Innovation Hub as part of the Work-Related Learning industrial "
              "attachment programme.\n"
              "\n"
              "Expenditure to date: No external grant expenditure incurred "
              "during the reporting period.\n"
              "\n"
              "Grant Balance: To be confirmed by the Principal Investigator.",
              size=9)

# ── 7. Research Ethical Clearance ─────────────────────────────────────────
row = mt.add_row()
for ci, w in enumerate(col_widths):
    set_col_width(row.cells[ci], w)
add_cell_text(row.cells[0], "7. Research Ethical Clearance", size=9, bold=True)
add_cell_mixed(row.cells[1],
               "Ethical Clearance Statement",
               "\n"
               "No primary data collection from human subjects was conducted "
               "during the reporting period. Work consisted of system development, "
               "database design, and documentary research using published statutory "
               "and technical sources.\n"
               "\n"
               "Requirements of the Zimbabwe Data Protection Act 2021 have been "
               "incorporated into the system design. Personal data is protected "
               "through role-based access controls and the research papers on "
               "document management address the council's data protection obligations "
               "towards residents.")
add_cell_text(row.cells[2],
              "Ethical clearance number: To be confirmed by PI\n"
              "\n"
              "Date of issuance of ethical clearance letter: To be confirmed by PI",
              size=9)

# ── 8. Dissemination Strategy ──────────────────────────────────────────────
add_row(
    "8. Dissemination Strategy",
    "Results and Lessons",
    "Three research papers submitted to and accepted by the project supervisor "
    "and research coordinator as formal project deliverables.\n"
    "\n"
    "System prototype demonstrated to Vungu RDC planning officers via video "
    "conference in April 2026; positive reception and client approval received.\n"
    "\n"
    "Planned dissemination:\n"
    "  Submission of research papers to a relevant planning or GIS journal.\n"
    "  Formal presentation and handover to Vungu RDC council.\n"
    "  Presentation at the MSU Research and Innovation Symposium (Q4 2026).\n"
    "\n"
    "Key lesson from the project so far: grounding the database and system "
    "design in a thorough reading of the Zimbabwe Development Management "
    "Handbook 2021, rather than designing from the brief alone, produced "
    "a significantly more complete and legally sound system than the "
    "prototype it replaced."
)

# ── References ─────────────────────────────────────────────────────────────
row = mt.add_row()
for ci, w in enumerate(col_widths):
    set_col_width(row.cells[ci], w)
add_cell_text(row.cells[0], "References", size=9, bold=True)
row.cells[1].merge(row.cells[2])
add_cell_text(row.cells[1],
              "[1]  Government of Zimbabwe, Development Management (Control) Handbook. "
              "Harare: Government Printer, 2021.\n"
              "[2]  Government of Zimbabwe, Data Protection Act, Chapter 11:12. "
              "Harare: Government Printer, 2021.\n"
              "[3]  Government of Zimbabwe, Regional, Town and Country Planning Act, "
              "Chapter 29:12. Harare: Government Printer.\n"
              "[4]  Vungu RDC Master Plan Study Report, 2024.\n"
              "[5]  Open Geospatial Consortium, \"OGC Simple Features for SQL,\" "
              "OGC Standard 06-104r4, 2011.\n"
              "[6]  H. Butler et al., \"The GeoJSON Format,\" IETF RFC 7946, Aug. 2016.",
              size=9)
set_col_width(row.cells[0], col_widths[0])
_white_cell(row.cells[0])
_white_cell(row.cells[1])

doc.save(OUT)
print(f"Saved: {OUT}")
