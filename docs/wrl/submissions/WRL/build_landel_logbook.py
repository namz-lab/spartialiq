"""
Build Landel updated logbook: copy existing + add Weeks 15-17 (filled) + Week 19 template.
"""
import copy
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import docx

SRC = "Landel_Lunga_WRL_LogBook_R242094G.docx"
OUT = "Landel_Lunga_WRL_LogBook_R242094G_Updated.docx"

doc = Document(SRC)

# ── helper: find the main weeks table (3 cols: WEEK/DATES | DESCRIPTION | COMMENTS)
main_table = None
for tbl in doc.tables:
    if tbl.rows and len(tbl.rows[0].cells) == 3:
        header = tbl.rows[0].cells[0].text.strip().upper()
        if "WEEK" in header or "DATE" in header:
            main_table = tbl
            break

if main_table is None:
    raise RuntimeError("Could not find the weeks table")

def copy_row_format(source_row, target_row):
    """Copy basic cell shading/borders from source row to target row."""
    for i, cell in enumerate(target_row.cells):
        if i < len(source_row.cells):
            src_cell = source_row.cells[i]
            tc = cell._tc
            src_tc = src_cell._tc
            src_tcPr = src_tc.find(qn('w:tcPr'))
            if src_tcPr is not None:
                tc_tcPr = tc.find(qn('w:tcPr'))
                if tc_tcPr is None:
                    tc_tcPr = OxmlElement('w:tcPr')
                    tc.insert(0, tc_tcPr)

def add_week_row(table, week_label, date_range, description, comments):
    """Append a new row to the table and fill it."""
    row = table.add_row()

    # Copy formatting from last data row
    if len(table.rows) > 2:
        copy_row_format(table.rows[-2], row)

    def set_cell(cell, bold_header, body_text):
        cell.text = ""
        para = cell.paragraphs[0]
        if bold_header:
            run_h = para.add_run(bold_header + "\n")
            run_h.bold = True
            run_h.font.size = Pt(10)
        run_b = para.add_run(body_text)
        run_b.font.size = Pt(10)
        para.paragraph_format.space_after = Pt(2)

    set_cell(row.cells[0], week_label, date_range)
    set_cell(row.cells[1], "", description)
    set_cell(row.cells[2], "", comments)

# ── Week 15
add_week_row(
    main_table,
    "Week 15",
    "(20/04/2026 - 26/04/2026)",
    (
        "Conducted scale-up trials to increase batch production volume from the 20-litre pilot reactor to "
        "a 50-litre configuration. Prepared a larger scrap iron feedstock batch with consistent particle size "
        "achieved through systematic grinding and sieving to the target size range of 0.5 to 2 mm. Modified "
        "the reactor configuration to accommodate the increased volume, including repositioning sensors for pH, "
        "temperature, and ORP to ensure representative monitoring throughout the larger vessel. Ran two 50-litre "
        "batches over the course of the week and collected samples at 30-minute intervals for iron content "
        "analysis by titration. Observed that heat generated during dissolution was significantly higher than at "
        "the 20-litre scale, requiring active temperature monitoring to prevent exceeding the safe operating "
        "range. Attended the monthly Innovation Hub progress review meeting, where all resident project teams "
        "presented brief updates on their work to Hub management and invited guests."
    ),
    (
        "The scale-up exposed problems that were not visible at the 20-litre scale. Managing heat buildup in a "
        "larger batch requires either active cooling capacity or a slower acid addition rate. The Hub progress "
        "meeting was a useful checkpoint for hearing how other projects are developing and for identifying any "
        "shared resource or equipment needs across teams."
    )
)

# ── Week 16
add_week_row(
    main_table,
    "Week 16",
    "(27/04/2026 - 03/05/2026)",
    (
        "Received ICP-MS analytical results from the external laboratory for all product batches produced "
        "between Weeks 8 and 15. Compiled a comparative analysis table of heavy metal concentrations across all "
        "batches and checked each result against the limits specified in the British Pharmacopoeia for "
        "ferrous sulphate tablets. Results showed that lead and arsenic levels in three batches were marginally "
        "above acceptable pharmaceutical thresholds, traced to specific lots of scrap iron feedstock collected "
        "from a vehicle parts source. Conducted a feedstock screening exercise to segregate and reject "
        "high-contaminant source material from the approved input stock. Drafted a revised feedstock selection "
        "protocol specifying approved source types, visual inspection criteria, and pre-treatment requirements. "
        "Observed Workers Day on 1 May 2026, a public holiday in Zimbabwe. The Innovation Hub was closed for "
        "the day and no formal laboratory or office work was conducted."
    ),
    (
        "The pharmaceutical-grade heavy metals threshold is significantly more stringent than the threshold for "
        "water treatment applications. Recognising this distinction is essential because the project is "
        "pursuing both product lines simultaneously and the feedstock selection process has to be managed "
        "differently depending on which product is being produced. The Workers Day break was a good opportunity "
        "to review notes and consolidate my understanding of the analytical data before the next phase."
    )
)

# ── Week 17 (last week: 04–10 May)
add_week_row(
    main_table,
    "Week 17",
    "(04/05/2026 - 10/05/2026)",
    (
        "Convened a comprehensive batch review meeting with the full project team to consolidate all analytical "
        "results accumulated since Week 8. Produced a consolidated data table comparing yield, crystal quality "
        "score, heavy metals profile, and estimated production cost per kilogram across all completed batches. "
        "The review confirmed that batches using pre-screened, low-contaminant scrap iron and controlled "
        "crystallisation temperature produced consistently better pharmaceutical-grade results. Prepared a draft "
        "product specification sheet for ferrous sulphate monohydrate for water treatment applications, "
        "referencing the Standards Association of Zimbabwe specification SAZ 229 as the benchmark. Met with a "
        "representative from a Gweru-based water treatment company who visited the Hub to assess product "
        "samples and discuss the timeline and minimum volumes required for a first commercial supply agreement. "
        "Collected market feedback on acceptable pricing and packaging requirements. Began drafting the outline "
        "for the second phase of the work plan, focusing on pharmaceutical-grade production optimisation, "
        "formalisation of the commercial cost model, and preparation of samples for regulatory submission."
    ),
    (
        "The commercial partner visit provided the most direct market feedback received during the placement "
        "to date. The representative made it clear that consistency of supply and product certification are "
        "weighted more heavily than price alone in their procurement decisions. That has shifted how I am "
        "thinking about the second half of the placement, particularly around the regulatory documentation "
        "work that will be needed before any commercial samples can be formally submitted."
    )
)

# ── Week 18 template (this week: 11–17 May) – partially underway
add_week_row(
    main_table,
    "Week 18",
    "(11/05/2026 - 17/05/2026)",
    "[In progress]",
    "[To be completed]"
)

# ── Week 19 template (next week: 18–24 May)
add_week_row(
    main_table,
    "Week 19",
    "(18/05/2026 - 24/05/2026)",
    "[To be completed]",
    "[To be completed]"
)

# ── Update report date in header paragraphs
for para in doc.paragraphs:
    if "Report Date" in para.text and "April 2026" in para.text:
        for run in para.runs:
            if "April 2026" in run.text:
                run.text = run.text.replace("April 2026", "May 2026")

doc.save(OUT)
print(f"Saved: {OUT}")
