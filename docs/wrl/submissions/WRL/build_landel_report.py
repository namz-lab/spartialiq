"""
Build Landel updated preliminary report: extends existing report through Week 17 (May 2026).
"""
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

SRC = "Landel_Lunga_WRL_Preliminary_Report_R242094G.docx"
OUT = "Landel_Lunga_WRL_Preliminary_Report_R242094G_Updated.docx"

doc = Document(SRC)

# ── helpers
def find_para_containing(doc, text):
    for i, p in enumerate(doc.paragraphs):
        if text in p.text:
            return i, p
    return None, None

def para_after(doc, index):
    """Return paragraph at index+1 or None."""
    if index + 1 < len(doc.paragraphs):
        return doc.paragraphs[index + 1]
    return None

def set_para_text(para, text, bold=False, size=10):
    for run in para.runs:
        run.text = ""
    if para.runs:
        run = para.runs[0]
    else:
        run = para.add_run()
    run.text = text
    run.bold = bold
    run.font.size = Pt(size)

def add_para_after_index(doc, after_index, text, style="Normal", bold=False, size=10):
    """Insert a new paragraph after the paragraph at after_index."""
    ref_para = doc.paragraphs[after_index]
    new_para = OxmlElement('w:p')
    ref_para._element.addnext(new_para)
    # get updated reference
    for i, p in enumerate(doc.paragraphs):
        if p._element is new_para:
            p.style = doc.styles[style] if style in [s.name for s in doc.styles] else doc.styles['Normal']
            run = p.add_run(text)
            run.bold = bold
            run.font.size = Pt(size)
            return i, p
    return None, None

# ── 1. Update cover table: Report Date April -> May 2026
for table in doc.tables:
    for row in table.rows:
        for cell in row.cells:
            if "Report Date" in cell.text and "April 2026" in cell.text:
                for para in cell.paragraphs:
                    for run in para.runs:
                        if "April 2026" in run.text:
                            run.text = run.text.replace("April 2026", "May 2026")
            if "April 2026" in cell.text and "Report Date" not in cell.text:
                for para in cell.paragraphs:
                    for run in para.runs:
                        if "April 2026" in run.text:
                            run.text = run.text.replace("April 2026", "May 2026")

# ── 2. Update all inline "April 2026" -> "May 2026" in header paras
for para in doc.paragraphs:
    if "Report Date" in para.text and "April 2026" in para.text:
        for run in para.runs:
            if "April 2026" in run.text:
                run.text = run.text.replace("April 2026", "May 2026")

# ── 3. Update scope text from "first 14 weeks" -> "first 17 weeks"
for para in doc.paragraphs:
    for run in para.runs:
        if "first 14 weeks" in run.text:
            run.text = run.text.replace("first 14 weeks", "first 17 weeks")
        if "14 weeks" in run.text and "covered" in para.text:
            run.text = run.text.replace("14 weeks", "17 weeks")
        if "January 2026 to June 2026" in run.text:
            pass  # keep the full period

# ── 4. Extend the work plan table to include Phases 6-7
work_plan_table = None
for tbl in doc.tables:
    for row in tbl.rows:
        cells_text = [c.text.strip() for c in row.cells]
        if any("Phase" in t for t in cells_text) and any("Week" in t for t in cells_text):
            work_plan_table = tbl
            break

if work_plan_table:
    def add_plan_row(tbl, phase, weeks, activities):
        row = tbl.add_row()
        row.cells[0].text = phase
        row.cells[1].text = weeks
        row.cells[2].text = activities
        for cell in row.cells:
            for para in cell.paragraphs:
                for run in para.runs:
                    run.font.size = Pt(10)

    add_plan_row(work_plan_table,
                 "6 - Scale-Up and Quality Analysis",
                 "Weeks 15-16",
                 "50-litre batch scale-up trials, feedstock screening, ICP-MS review, pharmaceutical-grade quality assessment, Workers Day observation")
    add_plan_row(work_plan_table,
                 "7 - Commercial Evaluation",
                 "Week 17",
                 "Batch data consolidation, product specification drafting, commercial partner engagement, second-phase work plan preparation")

# ── 5. Locate "CHAPTER 5" and insert new Chapter 4 subsection content before it
# Find "5.1 Summary" paragraph and insert new work before it
target_idx = None
for i, para in enumerate(doc.paragraphs):
    if "5.1" in para.text and "Summary" in para.text:
        target_idx = i
        break

if target_idx is None:
    # fallback: find CHAPTER 5
    for i, para in enumerate(doc.paragraphs):
        if "CHAPTER 5" in para.text.upper():
            target_idx = i
            break

# We will inject new section 4.5 content before Chapter 5
# Build list of (text, bold, size) tuples to insert
new_section = [
    ("4.5  Scale-Up, Quality Analysis, and Commercial Engagement", True, 11),
    (
        "The work carried out in Weeks 15 to 17 focused on scaling the production process to a larger "
        "volume, evaluating the quality of accumulated product batches against pharmaceutical and water "
        "treatment specifications, and engaging with a potential commercial partner.",
        False, 10
    ),
    (
        "Scale-up activities in Week 15 involved transitioning from the 20-litre pilot reactor to a "
        "50-litre configuration. Preparing a feedstock batch of consistent particle size required "
        "systematic grinding and sieving to the target range of 0.5 to 2 mm. The larger vessel required "
        "repositioning of pH, temperature, and ORP sensors to ensure representative monitoring throughout "
        "the reaction volume. Two 50-litre batches were completed, with samples collected at 30-minute "
        "intervals. A notable finding was that heat generated during dissolution was significantly higher "
        "than at the pilot scale, requiring closer temperature management to remain within the safe "
        "operating range. The team also attended the monthly Innovation Hub progress review meeting, "
        "where updates were presented to Hub management alongside other resident innovation projects.",
        False, 10
    ),
    (
        "In Week 16, ICP-MS results received from the analytical laboratory were compiled into a "
        "comparative table covering all batches produced between Weeks 8 and 15. Comparison against "
        "British Pharmacopoeia limits for ferrous sulphate tablets revealed that three batches showed "
        "lead and arsenic concentrations marginally above pharmaceutical thresholds. The source of "
        "elevated contamination was traced to specific lots of scrap iron from a vehicle parts supplier. "
        "A feedstock screening protocol was drafted, specifying approved source types, visual inspection "
        "criteria, and pre-treatment washing requirements. Zimbabwe's Workers Day public holiday on "
        "1 May 2026 was observed, and the Innovation Hub was closed for the day.",
        False, 10
    ),
    (
        "Week 17 involved a full project team review of all accumulated experimental data. A "
        "consolidated batch comparison table was produced, comparing yield, crystal quality, heavy metals "
        "profile, and estimated production cost per kilogram across all completed batches. The review "
        "confirmed that batches using pre-screened, low-contaminant feedstock and temperature-controlled "
        "crystallisation produced the most consistent results. A draft product specification sheet for "
        "ferrous sulphate monohydrate for water treatment applications was prepared, referenced against "
        "the Standards Association of Zimbabwe specification SAZ 229. A representative from a Gweru-based "
        "water treatment company visited the Hub to examine product samples and discuss commercial supply "
        "arrangements, providing direct market feedback on pricing expectations, minimum order quantities, "
        "and certification requirements. The week concluded with the preparation of an outline for the "
        "second half of the work plan, covering pharmaceutical-grade production optimisation, formalisation "
        "of the cost model, and preparation for regulatory sample submission.",
        False, 10
    ),
]

if target_idx is not None:
    # Insert paragraphs before target_idx (before Chapter 5)
    # We need to insert in reverse order since each insert goes after target_idx-1
    ref_para = doc.paragraphs[target_idx]
    for (text, bold, size) in reversed(new_section):
        new_p = OxmlElement('w:p')
        ref_para._element.addprevious(new_p)
        # find the new para object
        for p in doc.paragraphs:
            if p._element is new_p:
                run = p.add_run(text)
                run.bold = bold
                run.font.size = Pt(size)
                p.paragraph_format.space_after = Pt(4)
                break

# ── 6. Update Summary section (5.1) to include new weeks
for i, para in enumerate(doc.paragraphs):
    if "5.1" in para.text and "Summary" in para.text:
        # Find the bullet list that follows and add new items
        # Locate the last bullet item in that section
        last_bullet_idx = i
        for j in range(i+1, min(i+40, len(doc.paragraphs))):
            p = doc.paragraphs[j]
            if p.text.strip().startswith("-") or (p.style and "List" in p.style.name):
                last_bullet_idx = j
            if "5.2" in p.text or "Problems" in p.text:
                break

        # Insert new summary bullets after last_bullet_idx
        new_bullets = [
            "Scale-up of batch production from 20-litre to 50-litre reactor configuration with full sensor repositioning and process monitoring.",
            "Comparative ICP-MS quality analysis of all product batches against British Pharmacopoeia pharmaceutical-grade limits and SAZ 229 water treatment limits.",
            "Feedstock screening and drafting of a revised feedstock selection protocol to manage heavy metals contamination risk.",
            "Observation of Workers Day public holiday on 1 May 2026.",
            "Full batch data consolidation and production of a comparative performance table covering all experimental batches.",
            "Preparation of a draft product specification sheet for ferrous sulphate monohydrate for water treatment applications.",
            "Commercial engagement with a Gweru-based water treatment company, including product sample review and market feedback collection.",
            "Preparation of the second-phase work plan outline covering pharmaceutical-grade optimisation and regulatory sample preparation.",
        ]

        ref_p = doc.paragraphs[last_bullet_idx]
        for bullet_text in reversed(new_bullets):
            new_p = OxmlElement('w:p')
            ref_p._element.addnext(new_p)
            for p in doc.paragraphs:
                if p._element is new_p:
                    run = p.add_run(bullet_text)
                    run.font.size = Pt(10)
                    p.paragraph_format.left_indent = Inches(0.3)
                    p.paragraph_format.space_after = Pt(2)
                    break
        break

doc.save(OUT)
print(f"Saved: {OUT}")
