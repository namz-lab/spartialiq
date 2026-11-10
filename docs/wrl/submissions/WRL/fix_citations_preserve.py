"""
In-place citation cleanup on the user's edited finals.
Preserves content; converts author-year to [n]; removes Musa/Ngulube.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

from docx import Document

DESKTOP = Path(r"c:\Users\munya\Desktop")
WRL = Path(r"c:\Users\munya\Desktop\finale\WRL 2")
WRL_SUB = WRL / "WRL"


def set_paragraph_text(paragraph, new_text: str) -> None:
    """Replace full paragraph text, keep first-run font settings where possible."""
    if not paragraph.runs:
        paragraph.add_run(new_text)
        return
    paragraph.runs[0].text = new_text
    for run in paragraph.runs[1:]:
        run.text = ""


def replace_in_paragraph(paragraph, mapping: list[tuple[str, str]]) -> int:
    text = paragraph.text
    if not text:
        return 0
    new = text
    for old, repl in mapping:
        if old in new:
            new = new.replace(old, repl)
    if new != text:
        set_paragraph_text(paragraph, new)
        return 1
    return 0


def replace_in_doc(doc: Document, mapping: list[tuple[str, str]]) -> int:
    n = 0
    for p in doc.paragraphs:
        n += replace_in_paragraph(p, mapping)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    n += replace_in_paragraph(p, mapping)
    return n


def save_copies(src: Path, names: list[Path]) -> None:
    for dest in names:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        print("Copied:", dest)


# ── Level 3.2 Report (user-edited) ──────────────────────────────────────────
# Reference list order already on disk:
# [1] Billett [2] Codd [3] Date [4] GoZ Handbook [5] DPA [6] RDC Act
# [7] MSU guidelines [8] Hub notes [9] OWASP [10] PostGIS [11] Namailinga Report 1

L32_MAP = [
    # Remove Musa entirely
    (" (Ngulube, 2026)", ""),
    ("(Ngulube, 2026)", ""),
    ("Ngulube, 2026", ""),
    # Author-year -> numbers only (longest / multi-cites first)
    (
        "(Government of Zimbabwe, 2021a; Government of Zimbabwe, n.d.)",
        "[4], [6]",
    ),
    (
        "(OWASP Foundation, 2021; Government of Zimbabwe, 2021b)",
        "[9], [5]",
    ),
    ("(Codd, 1970; Date, 2015)", "[2], [3]"),
    ("(Date, 2015; PostGIS Development Group, 2024)", "[3], [10]"),
    ("(Midlands State University, n.d.)", "[7]"),
    ("(Government of Zimbabwe, 2021a)", "[4]"),
    ("(Government of Zimbabwe, 2021b)", "[5]"),
    ("(Government of Zimbabwe, n.d.)", "[6]"),
    ("(Namailinga, 2026)", "[11]"),
    ("(Billett, 2011)", "[1]"),
    ("(PostGIS Development Group, 2024)", "[10]"),
    ("(OWASP Foundation, 2021)", "[9]"),
    ("(Midlands State University Research and Innovation Hub, 2026)", "[8]"),
    # Small standard tidy from edit artifact (spacing)
    ("reporting .My product", "reporting. My product"),
    ("PostGISDevelopment Group", "PostGIS Development Group"),
    (" [9]\t", "[9]\t"),
]

l32 = DESKTOP / "Munyaradzi_Namailinga_WRL_Level32_Report2_R243100H.docx"
doc = Document(str(l32))
changed = replace_in_doc(doc, L32_MAP)

# Drop any reference line that still names Ngulube/Musa
for p in list(doc.paragraphs):
    if re.search(r"Ngulube|Musawenkosi", p.text, re.I):
        set_paragraph_text(p, "")
        changed += 1

# Ensure no author-year leftovers in body (except inside References entries)
in_refs = False
leftovers = []
for p in doc.paragraphs:
    t = p.text.strip()
    if t.upper().startswith("6. REFERENCES") or t.upper() == "REFERENCES":
        in_refs = True
        continue
    if in_refs:
        continue
    if re.search(r"\([A-Za-z][^)]{0,60}20\d\d[^)]*\)|\([A-Za-z][^)]{0,60}n\.d\.[^)]*\)", t):
        leftovers.append(t[:120])

doc.save(str(l32))
print("Level32 saved:", l32, "paragraph edits:", changed)
if leftovers:
    print("WARN leftovers:", leftovers)
else:
    print("Level32 in-text author-year cleared (body).")

save_copies(
    l32,
    [
        WRL / l32.name,
        WRL_SUB / l32.name,
    ],
)

# ── Preliminary report v8 (remove Musa) ─────────────────────────────────────
PRELIM_MAP = [
    (
        "The Hub event list below matches events recorded by fellow Hub student Musawenkosi Ngulube. "
        "My role at each event is stated so it is clear I stayed on the GIS system.",
        "The Hub event list below covers shared Innovation Hub calendar activities. "
        "My role at each event is stated so it is clear I stayed on the GIS system.",
    ),
    (
        "Ngulube, M.B.J. (2026). INFO342 Work Related Learning Report (Hub event record used for shared calendar alignment). Midlands State University.",
        "",
    ),
    ("Musawenkosi Ngulube", "fellow Hub students"),
    ("Ngulube", ""),
]

prelim = DESKTOP / "Munyaradzi_Namailinga_WRL_Preliminary_Report_R243100H_v8.docx"
if prelim.exists():
    d2 = Document(str(prelim))
    c2 = replace_in_doc(d2, PRELIM_MAP)
    # Number references if present as plain lines under References
    # Leave structure; user may use Level32 as main report.
    d2.save(str(prelim))
    print("Prelim v8 saved, edits:", c2)
    save_copies(prelim, [WRL / prelim.name, WRL_SUB / prelim.name])

# ── Logbook v8 (remove Musa name; keep events) ──────────────────────────────
LOG_MAP = [
    (
        "(same induction track other Hub students such as Musawenkosi use)",
        "(same induction track other Hub students use)",
    ),
    (
        "(Hub event on Musawenkosi's list)",
        "(shared Hub event)",
    ),
    (
        "(on Musawenkosi's event list)",
        "(on the Hub event calendar)",
    ),
    ("Musawenkosi's", "the Hub"),
    ("Musawenkosi", "other Hub students"),
    ("Ngulube", ""),
]

for log_name in [
    "Munyaradzi_Namailinga_Logbook_v8.docx",
    "Munyaradzi_Namailinga_Logbook_v7.docx",
]:
    log = DESKTOP / log_name
    if not log.exists():
        continue
    d3 = Document(str(log))
    c3 = replace_in_doc(d3, LOG_MAP)
    # verify
    blob = "\n".join(p.text for p in d3.paragraphs)
    for t in d3.tables:
        for row in t.rows:
            for cell in row.cells:
                blob += "\n" + cell.text
    if re.search(r"Musawenkosi|Ngulube", blob, re.I):
        print("WARN still Musa in", log_name)
    d3.save(str(log))
    print(log_name, "saved, edits:", c3)
    save_copies(log, [WRL / log_name, WRL_SUB / log_name])

print("Done.")
