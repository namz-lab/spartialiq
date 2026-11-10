from pathlib import Path
import re
from docx import Document

def set_paragraph_text(paragraph, new_text):
    if not paragraph.runs:
        paragraph.add_run(new_text)
        return
    paragraph.runs[0].text = new_text
    for run in paragraph.runs[1:]:
        run.text = ""


def replace_in_doc(doc, mapping):
    n = 0
    items = list(doc.paragraphs)
    for t in doc.tables:
        for row in t.rows:
            for cell in row.cells:
                items.extend(cell.paragraphs)
    for p in items:
        text = p.text
        if not text:
            continue
        new = text
        for old, repl in mapping:
            if old in new:
                new = new.replace(old, repl)
        if new != text:
            set_paragraph_text(p, new)
            n += 1
    return n


LOG_MAP = [
    (
        "(same induction track other Hub students such as Musawenkosi use)",
        "(same induction track other Hub students use)",
    ),
    ("(Hub event on Musawenkosi's list)", "(shared Hub event)"),
    ("(on Musawenkosi's event list)", "(on the Hub event calendar)"),
    ("Musawenkosi's", "the Hub"),
    ("Musawenkosi", "other Hub students"),
    ("Ngulube", ""),
]

# verify level32
d = Document(r"c:\Users\munya\Desktop\Munyaradzi_Namailinga_WRL_Level32_Report2_R243100H.docx")
blob = "\n".join(p.text for p in d.paragraphs)
print("Level32 Ngulube left:", "Ngulube" in blob or "Musawenkosi" in blob)
body = blob.split("6. REFERENCES")[0] if "6. REFERENCES" in blob else blob
# ignore TOC false positives
print("Level32 number cites sample:", re.findall(r"\[\d+\]", body)[:20])
ay = re.findall(r"\([A-Z][A-Za-z .,&;]{2,50}20\d\d[A-Za-z0-9 .,&;]*\)", body)
print("Level32 author-year left:", ay)

for name in [
    "Munyaradzi_Namailinga_Logbook_v8.docx",
    "Munyaradzi_Namailinga_Logbook_v7.docx",
]:
    src = Path(r"c:\Users\munya\Desktop") / name
    if not src.exists():
        print("missing", name)
        continue
    d3 = Document(str(src))
    c = replace_in_doc(d3, LOG_MAP)
    out1 = Path(r"c:\Users\munya\Desktop\finale\WRL 2") / name
    out2 = Path(r"c:\Users\munya\Desktop\finale\WRL 2\WRL") / name
    alt = Path(r"c:\Users\munya\Desktop") / name.replace(".docx", "_final.docx")
    d3.save(str(out1))
    d3.save(str(out2))
    try:
        d3.save(str(src))
        print(name, "desktop OK, edits", c)
    except PermissionError:
        d3.save(str(alt))
        print(name, "LOCKED on Desktop -> saved", alt.name, "edits", c)
    blob = "\n".join(cell.text for t in d3.tables for row in t.rows for cell in row.cells)
    print("  Musa/Ngulube left:", bool(re.search(r"Musawenkosi|Ngulube", blob, re.I)))
