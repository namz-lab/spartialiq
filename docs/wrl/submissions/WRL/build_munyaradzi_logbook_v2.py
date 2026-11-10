"""
Rebuild Munyaradzi logbook: copy v3 + accurate extended weeks (Apr 13 to May 13).
Actual work: Development Management Handbook study, schema refinement v1.2,
3NF verification, DCM normalisation, data dictionaries, research papers.
No fabricated practical implementations.
No work on Workers Day (1 May 2026).
No hyphens as bullet-point starters.
"""
from docx import Document
from docx.shared import Pt, Inches
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import docx.enum.text

SRC = "Munyaradzi_Namailinga_Logbook_v3.docx"
OUT = "Munyaradzi_Namailinga_Logbook_Updated_v2.docx"

doc = Document(SRC)


def add_page_break(doc):
    p = doc.add_paragraph()
    run = p.add_run()
    run.add_break(docx.enum.text.WD_BREAK.PAGE)


def bold_para(doc, text, size=12):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(size)
    return p


def supervisor_block(doc, month_label):
    bold_para(doc, month_label, 12)
    for label in ["Supervisor's Comments", "Supervisor's Signature", "Date"]:
        p = doc.add_paragraph()
        run = p.add_run(label)
        run.bold = True
        run.font.size = Pt(10)
        lines = doc.add_paragraph()
        lines.add_run(
            "................................................................................................................................................................\n"
            "................................................................................................................................................................"
        ).font.size = Pt(10)


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


def add_week_table(doc, header_row, rows):
    table = doc.add_table(rows=1, cols=3)
    table.style = 'Table Grid'
    tblLook = table._tbl.find(qn('w:tblPr'))
    if tblLook is not None:
        lk = OxmlElement('w:tblLook')
        lk.set(qn('w:noHBand'), '1')
        lk.set(qn('w:noVBand'), '1')
        tblLook.append(lk)
    hdr = table.rows[0]
    for i, h in enumerate(header_row):
        hdr.cells[i].text = ""
        run = hdr.cells[i].paragraphs[0].add_run(h)
        run.bold = True
        run.font.size = Pt(10)
        _white_cell(hdr.cells[i])

    for (date_cell, description, comments) in rows:
        row = table.add_row()

        cell0 = row.cells[0]
        cell0.text = ""
        p0 = cell0.paragraphs[0]
        p0.add_run(date_cell).font.size = Pt(10)
        _white_cell(cell0)

        cell1 = row.cells[1]
        cell1.text = ""
        cell1.paragraphs[0].add_run(description).font.size = Pt(10)
        _white_cell(cell1)

        cell2 = row.cells[2]
        cell2.text = ""
        cell2.paragraphs[0].add_run(comments).font.size = Pt(10)
        _white_cell(cell2)

    doc.add_paragraph()


# ======================================================================
# APRIL 2026 continued  (Weeks 3, 4, and 5)
# ======================================================================
add_page_break(doc)
supervisor_block(doc, "MONTH: APRIL 2026 (continued)")
doc.add_paragraph()

add_week_table(doc,
    ["DATE", "DESCRIPTION OF WORK DONE", "STUDENT'S COMMENTS"],
    [
        (
            # ---- DATE CELL ----
            "WEEK 3\nMon 13 Apr\nFri 17 Apr 2026",

            # ---- DESCRIPTION ----
            (
                "Day 1 (Mon 13 Apr) - Studying the Zimbabwe Development Management (Control) Handbook 2021\n"
                "Started a structured reading of the Zimbabwe Development Management (Control) Handbook 2021, "
                "which is the statutory reference for development management in Zimbabwean local authorities. "
                "Focused on the overall structure of the document: the handbook prescribes a comprehensive "
                "four-phase development lifecycle covering the development permit application process, the "
                "enforcement framework, building plan appraisal procedures, nine-stage construction "
                "inspections, and the final Certificate of Occupation. Reviewed the relevant annexures "
                "(Annexures 1 to 14) to understand what data each phase requires. Made notes on the "
                "Development Register requirements in Annexure 2 and the eight-step application process "
                "defined in Section 2 of the handbook.\n\n"

                "Day 2 (Tue 14 Apr) - Handbook Gap Analysis against Geodatabase v1.1\n"
                "Worked through the existing Vungu Municipality Enterprise Geodatabase Design (v1.1) "
                "table by table, comparing each existing entity against the data requirements defined in "
                "the handbook. The current schema implements only the core development permit application "
                "record and a basic inspection record. The gap analysis identified that the handbook "
                "requires an additional 15 tables across five phases: application consultations, objections "
                "and representations, appeals to the Administrative Court, enforcement orders, prohibition "
                "orders, building plans, plan drawings, plan appraisals, appraisal checklist items, "
                "inspection stage lookups, inspection item category lookups, inspection item type lookups, "
                "stage inspections, inspection item results, and the Certificate of Occupation. Also "
                "identified seven additional columns needed on the existing permit_application table "
                "(TPD reference, file reference, permit number, registration date, acknowledgement date, "
                "expiry date, construction start deadline) and one additional column on the existing "
                "permit_inspection table.\n\n"

                "Day 3 (Wed 15 Apr) - Defining the 15 New Tables\n"
                "For each of the 15 identified gaps, drafted column specifications: data types, nullable "
                "constraints, default values, foreign key relationships, and the legal or procedural "
                "source from the handbook. Worked through Phase 1 and Phase 2 in detail: Phase 1 "
                "requires three operational tables (application_consultation, application_objection, "
                "application_appeal) and Phase 2 requires two enforcement tables (enforcement_order, "
                "prohibition_order). For each table noted the relevant handbook section and the specific "
                "annexure that prescribes the data format.\n\n"

                "Day 4 (Thu 16 Apr) - Phases 3, 4, and 5 Table Definitions\n"
                "Continued defining the remaining tables. Phase 3 (Building Plan Appraisal) requires "
                "three tables: building_plan for the submitted plans, plan_drawing for the five mandatory "
                "drawing types per Annexure 11 (floor plan, cross section, elevations, site plan, notes "
                "and specifications), and plan_appraisal with its plan_appraisal_item child. Phase 4 "
                "(Stage Inspections) introduces four lookup tables (inspection_stage with nine rows "
                "matching Annexure 12, inspection_category with eight rows matching Annexure 14, and "
                "inspection_item_type with thirty-eight items) and two operational tables "
                "(stage_inspection and stage_inspection_result). Phase 5 adds the occupation_certificate "
                "table as the terminal document in the lifecycle. Drafted the DDL (CREATE TABLE) "
                "statements for all fifteen tables.\n\n"

                "Day 5 (Fri 17 Apr) - Virtual Progress Meeting and Schema Refinement Draft\n"
                "Attended a virtual progress meeting with Dr Paradzayi and Rafiq. Presented the gap "
                "analysis summary and the planned 15 new tables. Supervisor confirmed the approach and "
                "approved proceeding with a full schema refinement document. Rafiq set the deliverable "
                "as a complete document covering the handbook analysis, gap analysis, all new table "
                "definitions with DDL, and a phase-by-phase implementation workflow mapped to specific "
                "GIS screens. Started drafting the executive summary and Part 1 (Handbook Content "
                "Analysis) of the schema refinement document."
            ),

            # ---- COMMENTS ----
            (
                "Reading the handbook alongside the existing schema made the gaps visible in a way that "
                "neither document alone would have. The handbook is written from a legal and procedural "
                "perspective, not a database perspective, so translating its requirements into table "
                "definitions required careful reading of each section to extract the actual data points "
                "being described.\n\n"
                "The nine sequential inspection stages in the handbook (from Setting Out through to "
                "Certificate of Occupation) are the most structured part of the data model. Each stage "
                "is a hard gate: the next stage cannot proceed without sign-off on the current one. "
                "Representing that constraint at the database level with a UNIQUE constraint on "
                "(building_plan_id, stage_id) WHERE outcome is passed is a good example of how a "
                "legal requirement maps directly to a database integrity constraint.\n\n"
                "The virtual meeting was productive. Getting explicit confirmation on the scope and "
                "deliverable format before spending time writing a full document was the right approach."
            )
        ),

        (
            # ---- DATE CELL ----
            "WEEK 4\nMon 20 Apr\nFri 24 Apr 2026",

            # ---- DESCRIPTION ----
            (
                "Day 1 (Mon 20 Apr) - Schema Refinement Document: Phases 1 and 2\n"
                "Continued writing the Vungu GIS Development Management Schema Refinement document "
                "(v1.2). Completed Part 1 (Handbook Content Analysis) covering all six subsections: "
                "the development application process, enforcement framework, building plan contents, "
                "stage inspection stamp, building inspection checklist, and the Certificate of "
                "Occupation requirements. Drafted Part 2 (Gap Analysis) with the comparison table "
                "showing existing tables, what each covers, and what the gaps are. Began Part 3 "
                "(Refined Schema) with the column-level specifications for the two modified existing "
                "tables and the Phase 1 tables.\n\n"

                "Day 2 (Tue 21 Apr) - Schema Refinement Document: Phases 3 and 4\n"
                "Wrote the Phase 3 and Phase 4 table definitions in Part 3. For Phase 3 (Building "
                "Plan Appraisal), documented all columns for building_plan, plan_drawing, plan_appraisal, "
                "and plan_appraisal_item including the constraints and the regulatory references "
                "from Annexure 11. For Phase 4 (Stage Inspections), documented the lookup tables "
                "with complete seed data: all nine inspection stages from Annexure 12, the eight "
                "inspection categories from Annexure 14, and all thirty-eight inspection items with "
                "their mandatory flags. Also documented the two operational stage inspection tables.\n\n"

                "Day 3 (Wed 22 Apr) - Schema Refinement Document: DDL and Workflow\n"
                "Wrote Part 4 (Complete SQL DDL Implementation) with all CREATE TABLE and ALTER TABLE "
                "statements ordered to respect foreign key dependencies. Documented a critical note "
                "about execution order: the four lookup tables must be created first because the "
                "operational tables reference them. Steps 1 to 4 create lookup tables, steps 5 to 12 "
                "create operational tables in dependency order, steps 13 and 14 modify the existing "
                "permit_application and permit_inspection tables, and step 15 creates indexes. "
                "Included unique index definitions, particularly the constraint on stage_inspection "
                "ensuring only one passed result per stage per building plan.\n\n"

                "Day 4 (Thu 23 Apr) - Schema Refinement Document: Implementation Workflow\n"
                "Wrote Part 5 (Implementation Workflow), mapping each step in the handbook's "
                "development application process to specific database INSERT and UPDATE operations "
                "and the corresponding GIS screen. Documented the eight-step development application "
                "workflow, the five-step enforcement workflow (E1 to E5), the three-step building plan "
                "approval workflow (B1 to B3), the nine-stage inspection workflow, and the final "
                "certificate of occupation issuance step. Added legal notes from the handbook where "
                "specific requirements impose constraints on the database design.\n\n"

                "Day 5 (Fri 24 Apr) - Schema Refinement v1.2 Review and Submission\n"
                "Reviewed the complete schema refinement v1.2 document for consistency. Checked that "
                "every table referenced in the DDL section matches the schema definitions in Part 3, "
                "and that every step in the implementation workflow correctly names the tables and "
                "columns it writes to. Made corrections to the enforcement workflow legal notes "
                "based on re-reading Sections 3.3 and 3.4 of the handbook. Submitted the completed "
                "schema refinement v1.2 document to Rafiq as the first formal research deliverable "
                "of this phase of the attachment."
            ),

            # ---- COMMENTS ----
            (
                "Writing the implementation workflow was the most time-consuming part of the document. "
                "For each step I had to identify which tables are written to, which columns are "
                "updated, which officer performs the action, and what the corresponding GIS screen "
                "would be called. That level of specificity forces you to think through the full "
                "data flow, not just the table structure.\n\n"
                "The legal notes embedded in the handbook are important and easy to miss when reading "
                "quickly. The requirement in Section 3.3 that an Enforcement Order remains in force "
                "against the land even after a sale (binding on successors in title) has a direct "
                "implication for the database: the enforcement record must be linked to the parcel, "
                "not to the person, so it persists through ownership changes.\n\n"
                "Submitting a complete, reviewed document rather than a draft gave the deliverable a "
                "professional character. The review step found several inconsistencies that would "
                "have been embarrassing to leave in a document submitted to a supervisor."
            )
        ),

        (
            # ---- DATE CELL ----
            "WEEK 5\nMon 27 Apr\nThu 30 Apr 2026\n(Fri 01 May: Workers Day)",

            # ---- DESCRIPTION ----
            (
                "Day 1 (Mon 27 Apr) - Third Normal Form (3NF) Verification of Schema Refinement v1.2\n"
                "Began work on the 3NF Verification Report for the schema refinement (v1.2.1). "
                "The purpose is to verify that each of the 15 new tables introduced in v1.2 satisfies "
                "First, Second, and Third Normal Form. Applied the verification methodology: for each "
                "table, identified the primary key, listed all functional dependencies, checked for "
                "repeating groups (1NF), checked that all non-key attributes depend on the whole "
                "primary key and not a subset (2NF), and checked that all non-key attributes depend "
                "directly on the primary key and not transitively on another non-key attribute (3NF). "
                "Verified the lookup tables first (inspection_stage, inspection_category, "
                "inspection_item_type) since they are simple structures by design.\n\n"

                "Day 2 (Tue 28 Apr) - 3NF Verification: Operational Tables\n"
                "Continued 3NF verification for the operational tables. Checked "
                "application_consultation and application_objection: all attributes depend directly "
                "on the surrogate primary key with no transitive dependencies. For building_plan, "
                "identified that plan_number and tpd_reference are declared UNIQUE but are not the "
                "primary key, which is correct because UNIQUE constraints on natural keys coexist "
                "with surrogate primary keys without violating 3NF. Verified plan_appraisal_item "
                "carefully: it uses (appraisal_id, drawing_type, check_item) as a composite unique "
                "constraint, and confirmed that all other attributes in the table depend on this "
                "composite and not on any proper subset of it. Documented each verification step "
                "and the outcome in the report.\n\n"

                "Day 3 (Wed 29 Apr) - Development Control Matrix: UNF Analysis\n"
                "Shifted to the Development Control Matrix (DCM) normalisation work. The DCM is a "
                "two-dimensional matrix received from the Spatial Planning and Development unit "
                "showing which land uses are permitted, prohibited, or require special consent in "
                "each of nineteen land use zones. In spreadsheet form it has 32 use group rows and "
                "19 zone columns, giving 608 permission values. Analysed the raw matrix to identify "
                "its UNF violations: the 19 zone columns are a repeating group because they all "
                "represent the same attribute (permission_status) for different values of the zone "
                "dimension. Documented the UNF relation as DCM_RAW with 21 attributes (ug_code, "
                "ug_description, and one attribute per zone column).\n\n"

                "Day 4 (Thu 30 Apr) - DCM Normalisation: 1NF and 2NF\n"
                "Applied the first transformation to achieve 1NF: unpivoted the 19 zone columns "
                "into rows. Each row in the 1NF table now represents one permission decision for "
                "one use group in one zone. The 1NF relation DCM_1NF(ug_code, ug_description, "
                "zone_code, zone_name, permission_status) has a composite primary key of "
                "(ug_code, zone_code). Checked for partial dependencies to assess 2NF: ug_description "
                "depends only on ug_code (partial dependency on ug_code alone), and zone_name depends "
                "only on zone_code (partial dependency on zone_code alone). These partial dependencies "
                "violate 2NF. Applied decomposition to remove them: created a separate use_group "
                "table with (ug_code, ug_description) and a zone table with (zone_code, zone_name). "
                "Documented the 2NF decomposition and the resulting three tables.\n\n"

                "Day 5 (Fri 01 May) - Workers Day (Public Holiday)\n"
                "Workers Day is a public holiday in Zimbabwe. No work was conducted."
            ),

            # ---- COMMENTS ----
            (
                "The 3NF verification process is more systematic than it might appear. For each table "
                "you have to write out all the non-trivial functional dependencies before you can "
                "check the 3NF condition. Tables with surrogate integer primary keys tend to pass 3NF "
                "easily for exactly that reason: a surrogate key has no meaningful subset, so partial "
                "dependencies cannot arise. The more interesting cases were the tables with composite "
                "unique constraints.\n\n"
                "The DCM unpivot transformation is a good illustration of why normalisation matters "
                "in practice. In spreadsheet form, querying which land uses are permitted in a given "
                "zone requires reading a specific column. In the 1NF table, the same query is a simple "
                "WHERE zone_code = 'zone_11_commercial' filter. The relational model handles it more "
                "cleanly once the repeating groups are eliminated."
            )
        ),
    ]
)

# ======================================================================
# MAY 2026
# ======================================================================
add_page_break(doc)
supervisor_block(doc, "MONTH: MAY 2026")
doc.add_paragraph()

add_week_table(doc,
    ["DATE", "DESCRIPTION OF WORK DONE", "STUDENT'S COMMENTS"],
    [
        (
            # ---- DATE CELL ----
            "WEEK 1\nMon 04 May\nFri 08 May 2026",

            # ---- DESCRIPTION ----
            (
                "Day 1 (Mon 04 May) - DCM Normalisation: 3NF and Normalisation Report\n"
                "Completed the DCM normalisation by checking the three tables from the 2NF step for "
                "3NF compliance. The development_control_permission table (ug_code, zone_code, "
                "permission_status) has no non-key attributes other than permission_status, which "
                "depends on the full composite key (ug_code, zone_code). There are no transitive "
                "dependencies. Confirmed that the full normalised schema consists of five tables: "
                "land_use_group, land_use_zone, development_control_permission (the three core tables "
                "from the decomposition), plus two integration tables linking into the existing "
                "spatial_planning schema. Verified that all 608 permission values from the original "
                "matrix are preserved. Started writing the DCM Normalisation Report, covering the UNF "
                "analysis, 1NF transformation, 2NF decomposition, and 3NF confirmation.\n\n"

                "Day 2 (Tue 05 May) - DCM Normalisation Report: Completion\n"
                "Completed the DCM Normalisation Report. Included in the report: the raw matrix "
                "structure and its UNF violations, the full 1NF relation with its composite primary "
                "key, the identification of partial dependencies and the 2NF decomposition, "
                "the 3NF confirmation, and how the five resulting tables integrate with the existing "
                "spatial_planning schema in the enterprise geodatabase (v1.1). Also included the "
                "CREATE TABLE DDL for all five tables and noted the integration points with the "
                "permit_application workflow. Reviewed the report and submitted it to Rafiq as the "
                "second research deliverable of the week.\n\n"

                "Day 3 (Wed 06 May) - DCM Data Dictionary v1.0\n"
                "Began writing the Vungu Municipality GIS DCM Data Dictionary (v1.0). This document "
                "supplements the main GIS Data Dictionary by focusing on the six tables introduced "
                "by normalising the Development Control Matrix. For each table, documented: table "
                "purpose, all column names, data types, nullable status, default values, constraint "
                "descriptions, and a plain-language explanation of what the column stores. Also "
                "documented the relationship between the DCM tables and the existing "
                "spatial_planning.permit_application table. Completed documentation for "
                "land_use_group, land_use_zone, and development_control_permission.\n\n"

                "Day 4 (Thu 07 May) - DCM Data Dictionary Completion and Virtual Progress Meeting\n"
                "Completed the DCM Data Dictionary by documenting the remaining tables. Submitted "
                "the final document to Rafiq. Attended a virtual progress meeting with Dr Paradzayi "
                "and Rafiq to review the deliverables produced since the last meeting: schema "
                "refinement v1.2, 3NF verification report v1.2.1, DCM normalisation report, and "
                "DCM data dictionary v1.0. Supervisor approved all four documents. The next "
                "assigned research tasks are: (1) a comparative research paper on SQL versus NoSQL "
                "databases in the context of GIS systems, and (2) a study on document verification "
                "and storage in a local municipal GIS system. Rafiq provided reference materials "
                "and suggested key sources for both topics.\n\n"

                "Day 5 (Fri 08 May) - Research Paper: SQL vs NoSQL Databases for GIS Systems\n"
                "Started work on the comparative research paper on SQL and NoSQL databases for GIS "
                "systems. Read through the relevant PostGIS, MongoDB, Elasticsearch, and Cassandra "
                "documentation sections relating to spatial data handling. Structured the paper into "
                "sections covering: the data model comparison, spatial data support, query language, "
                "ACID compliance, scalability, schema flexibility, indexing and performance, "
                "raster data handling, topology and network analysis, standards compliance, "
                "real-time and streaming data, replication and high availability, tooling and "
                "ecosystem, and typical GIS use cases. Drafted the executive summary and the "
                "introduction establishing why database choice matters for GIS infrastructure."
            ),

            # ---- COMMENTS ----
            (
                "Completing the normalisation from UNF to 3NF in steps was satisfying because each "
                "step has a clear objective and a clear test for whether you have met it. UNF to 1NF "
                "removes repeating groups. 1NF to 2NF removes partial dependencies. 2NF to 3NF "
                "removes transitive dependencies. When you apply each transformation systematically "
                "and verify the result before moving on, the final schema is clearly correct.\n\n"
                "Writing the data dictionary for the DCM tables took longer than expected because "
                "documenting each column well requires understanding not just the data type but the "
                "business rule that column enforces. For example, the permission_status column looks "
                "simple (a VARCHAR with three allowed values) but the description needs to explain "
                "what Permitted, Prohibited, and Special Consent mean in the planning workflow.\n\n"
                "The SQL versus NoSQL comparison is the broadest research task assigned so far. "
                "The GIS context makes it more focused than a general database comparison because "
                "PostGIS has a very clear advantage for authoritative spatial data, and the NoSQL "
                "use cases are mostly at the edges of the workload (high-velocity sensor data, "
                "full-text search) rather than the core planning database."
            )
        ),

        (
            # ---- DATE CELL ----
            "WEEK 2\nMon 11 May\nWed 13 May 2026",

            # ---- DESCRIPTION ----
            (
                "Day 1 (Mon 11 May) - SQL vs NoSQL Research Paper: Main Comparison Sections\n"
                "Continued the SQL versus NoSQL research paper. Wrote the comparative analysis "
                "sections covering spatial data support, ACID compliance, scalability, and "
                "standards compliance. For spatial data support, detailed how PostGIS provides "
                "the full OGC geometry type hierarchy, GiST spatial indexing, and the complete "
                "ST_ function library, contrasting with MongoDB's 2dsphere index (suited to "
                "bounding-box and proximity queries but not complex spatial joins), Elasticsearch's "
                "geo_point type (optimised for search and proximity but limited for analytical "
                "GIS work), and the general absence of raster support in NoSQL systems. For "
                "standards compliance, noted that PostGIS supports OGC Simple Features for SQL "
                "(SFS), WKT and WKB geometry encoding, and ISO 19125 geometry types, while "
                "NoSQL systems typically support GeoJSON only (RFC 7946) and lack the broader "
                "OGC WMS and WFS service integration.\n\n"

                "Day 2 (Tue 12 May) - SQL vs NoSQL Paper: Conclusion, Recommendations, and References\n"
                "Completed the SQL versus NoSQL comparison paper. Wrote the recommendations "
                "section, which concludes that PostgreSQL with PostGIS remains the recommended "
                "database backend for the majority of GIS project types due to full ACID "
                "compliance, mature spatial function library, OGC standards support, and deep "
                "integration with the GIS software ecosystem. Documented the specific NoSQL "
                "scenarios where an alternative or hybrid architecture is appropriate: high-velocity "
                "IoT and GPS tracking data (Cassandra or MongoDB), full-text combined with geo "
                "search (Elasticsearch), and complex network topology analysis (Neo4j). Produced "
                "the indicative performance characteristics table and the decision framework. "
                "Added all references and submitted the completed paper to Rafiq.\n\n"

                "Day 3 (Wed 13 May) - Research Paper: Manual vs Automated Document Verification\n"
                "Started work on the first of two document verification research papers. This paper "
                "compares manual (physical) document verification by council clerks with automated "
                "digital verification using OCR, barcode reading, facial recognition, and API-based "
                "registry lookups, applied to the three document categories handled by the municipal "
                "GIS system: identity documents, title deeds, and permits. Studied the manual "
                "verification process for each document type, describing the steps a clerk performs "
                "at the service counter. Then studied the automated verification technologies and "
                "how they would perform the equivalent checks. Structured the comparative analysis "
                "across eight criteria: speed, accuracy, cost, fraud detection, accessibility, "
                "scalability, and data protection. Drafted the scope, manual process sections, "
                "and automated workflow descriptions for identity documents."
            ),

            # ---- COMMENTS ----
            (
                "The GIS context makes the SQL versus NoSQL question less ambiguous than it first "
                "appears. For authoritative spatial data like cadastral records, planning zones, "
                "and ward boundaries, the answer is clearly PostGIS. The interesting design question "
                "is whether to add a NoSQL layer at the edges of the system for specific workloads "
                "like real-time field inspection tracking. The hybrid architecture section of the "
                "paper addresses this directly.\n\n"
                "The document verification paper is a practically relevant topic for the Vungu "
                "RDC system. The system currently accepts document uploads from applicants with "
                "no automated verification. Studying what automated verification would look like "
                "for each document type is directly applicable to the document management module "
                "planned for the next phase of development."
            )
        ),
    ]
)

doc.save(OUT)
print(f"Saved: {OUT}")
