#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Generate: SpartialIQ_RTCP_Act_UseCases_ERD.docx
Regional, Town and Country Planning Act [Chapter 29:12] - Zimbabwe
Produces: detailed use cases, UML use-case diagrams, and full ERD
"""

import io, os, textwrap
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import Ellipse, FancyArrowPatch, FancyBboxPatch
from matplotlib.lines import Line2D
import numpy as np

from docx import Document
from docx.shared import Pt, Cm, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUTPUT = r"c:\Users\munya\Desktop\finale\docs\manuals\SpartialIQ_RTCP_Act_UseCases_ERD.docx"

# ─────────────────────────────────────────────
# Colour palette
# ─────────────────────────────────────────────
C_NAVY   = (0.05, 0.18, 0.38)
C_TEAL   = (0.05, 0.50, 0.50)
C_GOLD   = (0.80, 0.60, 0.10)
C_LGREY  = (0.93, 0.94, 0.96)
C_WHITE  = (1.00, 1.00, 1.00)
C_RED    = (0.75, 0.12, 0.12)
C_GREEN  = (0.12, 0.55, 0.20)

# ─────────────────────────────────────────────
# Helper: save a matplotlib figure → BytesIO
# ─────────────────────────────────────────────
def fig_to_bytes(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=150, bbox_inches='tight')
    buf.seek(0)
    plt.close(fig)
    return buf

# ─────────────────────────────────────────────
# Helper: Word formatting helpers
# ─────────────────────────────────────────────
def set_cell_bg(cell, hex_colour):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_colour)
    tcPr.append(shd)

def heading(doc, text, level=1, colour=(0.05,0.18,0.38)):
    p = doc.add_heading(text, level=level)
    run = p.runs[0]
    r, g, b = [int(x*255) for x in colour]
    run.font.color.rgb = RGBColor(r, g, b)
    return p

def body(doc, text):
    p = doc.add_paragraph(text)
    p.paragraph_format.space_after = Pt(4)
    return p

def bullet(doc, text, level=0):
    p = doc.add_paragraph(text, style='List Bullet')
    p.paragraph_format.left_indent = Cm(1.0 + level*0.5)
    return p

def add_image(doc, buf, width_cm=16):
    doc.add_picture(buf, width=Cm(width_cm))
    last = doc.paragraphs[-1]
    last.alignment = WD_ALIGN_PARAGRAPH.CENTER

def uc_table(doc, uc):
    """Render a single use-case as a 2-col table."""
    tbl = doc.add_table(rows=0, cols=2)
    tbl.style = 'Table Grid'
    tbl.autofit = False
    tbl.columns[0].width = Cm(4.5)
    tbl.columns[1].width = Cm(12.5)

    def row(label, value, header=False):
        r = tbl.add_row()
        r.cells[0].text = label
        r.cells[1].text = value
        for i, cell in enumerate(r.cells):
            for para in cell.paragraphs:
                for run in para.runs:
                    run.font.size = Pt(9)
                    if header or i == 0:
                        run.font.bold = True
            if header:
                set_cell_bg(cell, '0D2F61')
                for para in cell.paragraphs:
                    for run in para.runs:
                        run.font.color.rgb = RGBColor(255,255,255)
            elif i == 0:
                set_cell_bg(cell, 'E8EDF5')

    row(uc['id'] + '  ' + uc['name'], '', header=True)
    # merge header row
    tbl.rows[0].cells[0].merge(tbl.rows[0].cells[1])
    for para in tbl.rows[0].cells[0].paragraphs:
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for run in para.runs:
            run.font.size = Pt(10)
            run.font.bold = True
            run.font.color.rgb = RGBColor(255,255,255)

    row('Actor(s)',       uc.get('actors',''))
    row('Description',   uc.get('desc',''))
    row('Legal Ref',     uc.get('ref',''))
    row('Preconditions', uc.get('pre',''))
    row('Main Flow',     uc.get('main',''))
    row('Alt / Exception', uc.get('alt','—'))
    row('Postconditions', uc.get('post',''))
    row('System (SpartialIQ)', uc.get('system',''))
    doc.add_paragraph()

# ═══════════════════════════════════════════════════════════════
# DIAGRAM 1 – High-Level Use Case Diagram (whole system)
# ═══════════════════════════════════════════════════════════════
def draw_system_ucd():
    fig, ax = plt.subplots(figsize=(18, 22))
    ax.set_xlim(0, 18); ax.set_ylim(0, 22)
    ax.axis('off')
    ax.set_facecolor('#F7F9FC')
    fig.patch.set_facecolor('#F7F9FC')

    # System boundary box
    sys_box = FancyBboxPatch((2.8, 1.2), 12.5, 19.5,
                              boxstyle="round,pad=0.15", linewidth=2,
                              edgecolor=C_NAVY, facecolor='white', zorder=1)
    ax.add_patch(sys_box)
    ax.text(9.05, 20.85, 'SpartialIQ — RTCP Act Planning Portal', ha='center',
            fontsize=13, fontweight='bold', color=C_NAVY, zorder=5)

    # ── Actors (left column) ──────────────────────────────────────
    actors_left = [
        (0.9, 18.5, 'Citizen /\nApplicant'),
        (0.9, 15.5, 'Local Planning\nAuthority\n(Vungu RDC)'),
        (0.9, 12.2, 'Planner'),
        (0.9,  9.2, 'Building\nInspector'),
        (0.9,  6.2, 'Env. Officer'),
        (0.9,  3.2, 'GIS Officer'),
    ]
    actors_right = [
        (16.8, 18.5, 'Minister'),
        (16.8, 15.5, 'Regional\nPlanning\nCouncil'),
        (16.8, 12.2, 'Director of\nPhysical Planning'),
        (16.8,  9.2, 'Administrative\nCourt'),
        (16.8,  6.2, 'Surveyor-\nGeneral'),
        (16.8,  3.2, 'Registrar\nof Deeds'),
    ]

    def draw_actor(ax, x, y, label):
        # head
        head = plt.Circle((x, y+0.55), 0.28, color=C_NAVY, zorder=4)
        ax.add_patch(head)
        # body
        ax.plot([x, x], [y+0.27, y-0.28], color=C_NAVY, lw=2, zorder=4)
        # arms
        ax.plot([x-0.38, x+0.38], [y+0.05, y+0.05], color=C_NAVY, lw=2, zorder=4)
        # legs
        ax.plot([x, x-0.32], [y-0.28, y-0.72], color=C_NAVY, lw=2, zorder=4)
        ax.plot([x, x+0.32], [y-0.28, y-0.72], color=C_NAVY, lw=2, zorder=4)
        ax.text(x, y-1.0, label, ha='center', va='top', fontsize=7.5,
                fontweight='bold', color=C_NAVY, zorder=5,
                multialignment='center')

    for x, y, lbl in actors_left + actors_right:
        draw_actor(ax, x, y, lbl)

    # ── Use-case ellipses ─────────────────────────────────────────
    use_cases = [
        # (x_centre, y_centre, label, colour)
        # --- Development Control ---
        (9.05, 19.8, 'Submit Development\nPermit Application', C_TEAL),
        (9.05, 18.5, 'Review & Process\nPermit Application', C_TEAL),
        (9.05, 17.2, 'Grant / Refuse Permit\nor PPP', C_TEAL),
        (9.05, 15.9, 'Apply for Subdivision /\nConsolidation Permit', C_TEAL),
        (9.05, 14.6, 'Regularise Existing\nDevelopment (s.27)', C_TEAL),
        # --- Plans ---
        (9.05, 13.1, 'Prepare / Adopt\nRegional Plan', C_GREEN),
        (9.05, 11.9, 'Prepare / Submit\nMaster Plan', C_GREEN),
        (9.05, 10.7, 'Prepare / Approve\nLocal Plan', C_GREEN),
        (9.05,  9.5, 'Conduct Study of\nPlanning Area (s.13)', C_GREEN),
        (9.05,  8.3, 'Give Public Notice\nof Draft Plan', C_GREEN),
        # --- Enforcement ---
        (9.05,  7.0, 'Issue Enforcement\nOrder (s.32)', C_RED),
        (9.05,  5.8, 'Issue Prohibition\nOrder (s.34)', C_RED),
        (9.05,  4.6, 'Issue Building\nPreservation Order (s.30)', C_RED),
        (9.05,  3.4, 'Issue Tree\nPreservation Order (s.31)', C_RED),
        # --- Appeals & Legal ---
        (9.05,  2.2, 'Lodge Appeal to\nAdministrative Court (s.38)', (0.4,0.1,0.6)),
        (9.05,  1.3, 'Lodge Compensation\nClaim (s.50-53)', (0.4,0.1,0.6)),
    ]

    ell_w, ell_h = 3.6, 0.72
    for (cx, cy, lbl, col) in use_cases:
        e = Ellipse((cx, cy), ell_w, ell_h,
                    facecolor=(*col, 0.12), edgecolor=col, linewidth=1.5, zorder=2)
        ax.add_patch(e)
        ax.text(cx, cy, lbl, ha='center', va='center', fontsize=6.8,
                color='black', zorder=3, multialignment='center')

    # ── Association lines (actor → use case) ─────────────────────
    def assoc(ax, ax_, ay_, ux, uy):
        ax.annotate('', xy=(ux-ell_w/2, uy), xytext=(ax_+0.45, ay_),
                    arrowprops=dict(arrowstyle='-', color='#888888', lw=1.0), zorder=0)

    def assoc_r(ax, ax_, ay_, ux, uy):
        ax.annotate('', xy=(ux+ell_w/2, uy), xytext=(ax_-0.45, ay_),
                    arrowprops=dict(arrowstyle='-', color='#888888', lw=1.0), zorder=0)

    # Citizen
    for uy in [19.8, 18.5, 15.9, 14.6, 2.2, 1.3]:
        assoc(ax, 0.9, 18.5, 9.05, uy)

    # LPA (Vungu RDC)
    for uy in [18.5, 17.2, 15.9, 14.6, 13.1, 11.9, 10.7, 9.5, 8.3, 7.0, 5.8, 4.6, 3.4]:
        assoc(ax, 0.9, 15.5, 9.05, uy)

    # Planner
    for uy in [18.5, 17.2, 11.9, 10.7, 9.5]:
        assoc(ax, 0.9, 12.2, 9.05, uy)

    # Building Inspector
    for uy in [18.5, 7.0, 4.6]:
        assoc(ax, 0.9, 9.2, 9.05, uy)

    # Env Officer
    for uy in [18.5, 7.0, 5.8]:
        assoc(ax, 0.9, 6.2, 9.05, uy)

    # GIS Officer
    for uy in [9.5]:
        assoc(ax, 0.9, 3.2, 9.05, uy)

    # Minister (right)
    for uy in [13.1, 11.9, 10.7]:
        assoc_r(ax, 16.8, 18.5, 9.05, uy)

    # Regional Planning Council (right)
    for uy in [13.1]:
        assoc_r(ax, 16.8, 15.5, 9.05, uy)

    # Director (right)
    for uy in [11.9, 10.7, 9.5]:
        assoc_r(ax, 16.8, 12.2, 9.05, uy)

    # Admin Court (right)
    for uy in [2.2, 1.3]:
        assoc_r(ax, 16.8, 9.2, 9.05, uy)

    # Surveyor-General (right)
    for uy in [15.9]:
        assoc_r(ax, 16.8, 6.2, 9.05, uy)

    # Registrar of Deeds (right)
    for uy in [17.2, 15.9]:
        assoc_r(ax, 16.8, 3.2, 9.05, uy)

    # Legend
    legend_items = [
        mpatches.Patch(facecolor=(*C_TEAL,0.2), edgecolor=C_TEAL, label='Development Control'),
        mpatches.Patch(facecolor=(*C_GREEN,0.2), edgecolor=C_GREEN, label='Planning (Plans)'),
        mpatches.Patch(facecolor=(*C_RED,0.2), edgecolor=C_RED, label='Enforcement & Orders'),
        mpatches.Patch(facecolor=(0.4,0.1,0.6,0.2), edgecolor=(0.4,0.1,0.6), label='Appeals & Compensation'),
    ]
    ax.legend(handles=legend_items, loc='lower right', fontsize=8, framealpha=0.9)

    ax.set_title('Figure 1 — System-Level Use Case Diagram\nRTCP Act [Chapter 29:12] → SpartialIQ',
                 fontsize=14, fontweight='bold', color=C_NAVY, pad=10)
    return fig_to_bytes(fig)


# ═══════════════════════════════════════════════════════════════
# DIAGRAM 2 – Development Control Sub-diagram
# ═══════════════════════════════════════════════════════════════
def draw_dev_control_ucd():
    fig, ax = plt.subplots(figsize=(16, 13))
    ax.set_xlim(0, 16); ax.set_ylim(0, 13)
    ax.axis('off')
    ax.set_facecolor('#F7F9FC')
    fig.patch.set_facecolor('#F7F9FC')

    # System boundary
    sys_box = FancyBboxPatch((2.5, 0.5), 11.0, 12.0,
                              boxstyle="round,pad=0.15", linewidth=2,
                              edgecolor=C_TEAL, facecolor='white', zorder=1)
    ax.add_patch(sys_box)
    ax.text(8.0, 12.7, 'Development Control Subsystem (Part V — Sections 22–38)',
            ha='center', fontsize=11, fontweight='bold', color=C_TEAL)

    actors = [
        (1.0, 10.5, 'Citizen /\nApplicant'),
        (1.0,  7.5, 'Local Planning\nAuthority'),
        (1.0,  4.5, 'Planner'),
        (1.0,  2.0, 'Building\nInspector'),
        (14.8, 10.5, 'Minister'),
        (14.8,  7.5, 'Admin\nCourt'),
        (14.8,  4.5, 'Registrar\nof Deeds'),
        (14.8,  2.0, 'Env. Officer'),
    ]

    def draw_actor(x, y, label):
        head = plt.Circle((x, y+0.45), 0.25, color=C_NAVY, zorder=4)
        ax.add_patch(head)
        ax.plot([x, x], [y+0.20, y-0.22], color=C_NAVY, lw=2, zorder=4)
        ax.plot([x-0.32, x+0.32], [y+0.02, y+0.02], color=C_NAVY, lw=2, zorder=4)
        ax.plot([x, x-0.26], [y-0.22, y-0.58], color=C_NAVY, lw=2, zorder=4)
        ax.plot([x, x+0.26], [y-0.22, y-0.58], color=C_NAVY, lw=2, zorder=4)
        ax.text(x, y-0.85, label, ha='center', va='top', fontsize=7.5,
                fontweight='bold', color=C_NAVY, multialignment='center')

    for x, y, lbl in actors:
        draw_actor(x, y, lbl)

    ucs = [
        (8.0, 11.5, 'UC-01: Submit Development\nPermit Application (s.26(1))'),
        (8.0, 10.2, 'UC-02: Give Public Notice of\nApplication (s.26(3))'),
        (8.0,  8.9, 'UC-03: Review & Evaluate\nApplication (s.26(5))'),
        (8.0,  7.6, 'UC-04: Grant Permit or PPP\nor Refuse (s.26(6))'),
        (8.0,  6.3, 'UC-05: Apply for Preliminary\nPlanning Permission (s.26(1))'),
        (8.0,  5.0, 'UC-06: Regularise Existing\nDevelopment (s.27)'),
        (8.0,  3.8, 'UC-07: Issue Enforcement\nOrder (s.32)'),
        (8.0,  2.6, 'UC-08: Issue Prohibition\nOrder (s.34)'),
        (8.0,  1.4, 'UC-09: Lodge Appeal (s.38)'),
    ]

    ew, eh = 4.0, 0.70
    for cx, cy, lbl in ucs:
        e = Ellipse((cx, cy), ew, eh, facecolor=(*C_TEAL,0.12),
                    edgecolor=C_TEAL, linewidth=1.5, zorder=2)
        ax.add_patch(e)
        ax.text(cx, cy, lbl, ha='center', va='center', fontsize=7,
                color='black', zorder=3, multialignment='center')

    def line(x1,y1,x2,y2):
        ax.annotate('', xy=(x2,y2), xytext=(x1,y1),
                    arrowprops=dict(arrowstyle='-', color='#999', lw=0.9), zorder=0)

    # Citizen associations
    for cy in [11.5, 10.2, 6.3, 6.3, 1.4]:
        line(1.45, 10.5, 8.0-ew/2, cy)
    # LPA
    for cy in [10.2, 8.9, 7.6, 6.3, 3.8, 2.6]:
        line(1.45, 7.5, 8.0-ew/2, cy)
    # Planner
    for cy in [8.9, 7.6]:
        line(1.45, 4.5, 8.0-ew/2, cy)
    # Building Inspector
    for cy in [3.8, 2.6]:
        line(1.45, 2.0, 8.0-ew/2, cy)
    # Minister (right)
    for cy in [7.6, 3.8]:
        line(14.55, 10.5, 8.0+ew/2, cy)
    # Admin Court (right)
    for cy in [1.4]:
        line(14.55, 7.5, 8.0+ew/2, cy)
    # Registrar of Deeds (right)
    for cy in [7.6]:
        line(14.55, 4.5, 8.0+ew/2, cy)
    # Env Officer (right)
    for cy in [8.9, 3.8]:
        line(14.55, 2.0, 8.0+ew/2, cy)

    # «include» relationship
    ax.annotate('', xy=(8.0-ew/2, 10.2), xytext=(8.0-ew/2, 11.5-eh/2),
                arrowprops=dict(arrowstyle='->', color=C_GOLD, lw=1.2,
                                connectionstyle='arc3,rad=0.0'), zorder=3)
    ax.text(6.8, 10.85, '«include»', fontsize=6.5, color=C_GOLD, style='italic')

    ax.set_title('Figure 2 — Development Control Use Case Diagram\nSections 22–38, RTCP Act',
                 fontsize=12, fontweight='bold', color=C_TEAL, pad=8)
    return fig_to_bytes(fig)


# ═══════════════════════════════════════════════════════════════
# DIAGRAM 3 – Plans Sub-diagram
# ═══════════════════════════════════════════════════════════════
def draw_plans_ucd():
    fig, ax = plt.subplots(figsize=(15, 11))
    ax.set_xlim(0, 15); ax.set_ylim(0, 11)
    ax.axis('off')
    ax.set_facecolor('#F7F9FC')
    fig.patch.set_facecolor('#F7F9FC')

    sys_box = FancyBboxPatch((2.4, 0.4), 10.2, 10.2,
                              boxstyle="round,pad=0.15", linewidth=2,
                              edgecolor=C_GREEN, facecolor='white', zorder=1)
    ax.add_patch(sys_box)
    ax.text(7.5, 10.75, 'Planning Subsystem (Parts II, III & IV — Sections 3–21)',
            ha='center', fontsize=11, fontweight='bold', color=C_GREEN)

    def draw_actor(x, y, label):
        head = plt.Circle((x, y+0.42), 0.23, color=C_NAVY, zorder=4)
        ax.add_patch(head)
        ax.plot([x,x],[y+0.19,y-0.2],color=C_NAVY,lw=2,zorder=4)
        ax.plot([x-0.3,x+0.3],[y+0.02,y+0.02],color=C_NAVY,lw=2,zorder=4)
        ax.plot([x,x-0.22],[y-0.2,y-0.52],color=C_NAVY,lw=2,zorder=4)
        ax.plot([x,x+0.22],[y-0.2,y-0.52],color=C_NAVY,lw=2,zorder=4)
        ax.text(x, y-0.78, label, ha='center', va='top', fontsize=7.2,
                fontweight='bold', color=C_NAVY, multialignment='center')

    actors = [
        (1.0, 9.0, 'Local Planning\nAuthority'),
        (1.0, 6.0, 'Planner'),
        (1.0, 3.5, 'GIS Officer'),
        (13.8, 9.0, 'Minister'),
        (13.8, 6.5, 'Regional\nPlanning\nCouncil'),
        (13.8, 3.5, 'Director of\nPhys. Planning'),
        (13.8, 1.2, 'Admin Court /\nInvestigator'),
    ]
    for x,y,lbl in actors:
        draw_actor(x,y,lbl)

    ucs = [
        (7.5, 9.7,  'UC-10: Conduct Study\nof Planning Area (s.13)'),
        (7.5, 8.5,  'UC-11: Prepare &\nAdopt Master Plan (s.14-15)'),
        (7.5, 7.3,  'UC-12: Submit Master Plan\nto Minister (s.16)'),
        (7.5, 6.1,  'UC-13: Prepare & Adopt\nLocal Plan (s.17-18)'),
        (7.5, 4.9,  'UC-14: Consider Objections\n& Approve Local Plan (s.19)'),
        (7.5, 3.7,  'UC-15: Alter / Repeal /\nReplace Plan (s.20)'),
        (7.5, 2.5,  'UC-16: Prepare\nRegional Plan (s.5-7)'),
        (7.5, 1.3,  'UC-17: Refer to Local\nInquiry / Advisory Board (s.67)'),
    ]

    ew, eh = 3.8, 0.68
    for cx,cy,lbl in ucs:
        e = Ellipse((cx,cy),ew,eh,facecolor=(*C_GREEN,0.12),
                    edgecolor=C_GREEN,linewidth=1.5,zorder=2)
        ax.add_patch(e)
        ax.text(cx,cy,lbl,ha='center',va='center',fontsize=7,
                color='black',zorder=3,multialignment='center')

    def line(x1,y1,x2,y2):
        ax.annotate('',xy=(x2,y2),xytext=(x1,y1),
                    arrowprops=dict(arrowstyle='-',color='#999',lw=0.9),zorder=0)

    for cy in [9.7,8.5,7.3,6.1,4.9,3.7]:
        line(1.42,9.0,7.5-ew/2,cy)
    for cy in [9.7,8.5,7.3,6.1,3.7]:
        line(1.42,6.0,7.5-ew/2,cy)
    for cy in [9.7]:
        line(1.42,3.5,7.5-ew/2,cy)
    for cy in [7.3,8.5,4.9,3.7,1.3]:
        line(13.58,9.0,7.5+ew/2,cy)
    for cy in [2.5]:
        line(13.58,6.5,7.5+ew/2,cy)
    for cy in [7.3,8.5,4.9]:
        line(13.58,3.5,7.5+ew/2,cy)
    for cy in [4.9,1.3]:
        line(13.58,1.2,7.5+ew/2,cy)

    ax.set_title('Figure 3 — Planning (Plans) Use Case Diagram\nSections 3–21, RTCP Act',
                 fontsize=12,fontweight='bold',color=C_GREEN,pad=8)
    return fig_to_bytes(fig)


# ═══════════════════════════════════════════════════════════════
# DIAGRAM 4 – Subdivision, Land Acquisition & Appeals
# ═══════════════════════════════════════════════════════════════
def draw_subdiv_appeals_ucd():
    fig, ax = plt.subplots(figsize=(15, 10))
    ax.set_xlim(0, 15); ax.set_ylim(0, 10)
    ax.axis('off')
    ax.set_facecolor('#F7F9FC')
    fig.patch.set_facecolor('#F7F9FC')

    sys_box = FancyBboxPatch((2.4, 0.4), 10.2, 9.2,
                              boxstyle="round,pad=0.15", linewidth=2,
                              edgecolor=(0.4,0.1,0.6), facecolor='white', zorder=1)
    ax.add_patch(sys_box)
    ax.text(7.5, 9.75, 'Subdivision, Land Acquisition & Appeals (Parts VI–X, Sections 39–61)',
            ha='center', fontsize=10.5, fontweight='bold', color=(0.4,0.1,0.6))

    def draw_actor(x, y, label):
        head = plt.Circle((x, y+0.42), 0.23, color=C_NAVY, zorder=4)
        ax.add_patch(head)
        ax.plot([x,x],[y+0.19,y-0.2],color=C_NAVY,lw=2,zorder=4)
        ax.plot([x-0.3,x+0.3],[y+0.02,y+0.02],color=C_NAVY,lw=2,zorder=4)
        ax.plot([x,x-0.22],[y-0.2,y-0.52],color=C_NAVY,lw=2,zorder=4)
        ax.plot([x,x+0.22],[y-0.2,y-0.52],color=C_NAVY,lw=2,zorder=4)
        ax.text(x, y-0.78, label, ha='center', va='top', fontsize=7.2,
                fontweight='bold', color=C_NAVY, multialignment='center')

    actors = [
        (1.0, 7.5, 'Citizen /\nOwner'),
        (1.0, 4.5, 'Local Planning\nAuthority'),
        (1.0, 1.5, 'Planner'),
        (13.8, 7.5, 'Admin\nCourt'),
        (13.8, 5.0, 'Surveyor-\nGeneral'),
        (13.8, 2.5, 'Minister'),
        (13.8, 0.8, 'Registrar\nof Deeds'),
    ]
    for x,y,lbl in actors:
        draw_actor(x,y,lbl)

    ucs = [
        (7.5, 8.8, 'UC-18: Apply for Subdivision\nor Consolidation Permit (s.40)'),
        (7.5, 7.6, 'UC-19: Set Aside Land\nfor Public Purposes (s.41)'),
        (7.5, 6.4, 'UC-20: Cancel General\nPlan (s.42)'),
        (7.5, 5.2, 'UC-21: Acquire / Expropriate\nLand (s.45-46)'),
        (7.5, 4.0, 'UC-22: Owner Requires\nAcquisition (s.47)'),
        (7.5, 2.8, 'UC-23: Lodge Compensation\nClaim (s.50-53)'),
        (7.5, 1.6, 'UC-24: Appeal to\nAdministrative Court (s.38, 44)'),
        (7.5, 0.7, 'UC-25: Road Closure\nor Diversion (s.58)'),
    ]

    ew, eh = 3.8, 0.65
    pc = (0.4,0.1,0.6)
    for cx,cy,lbl in ucs:
        e = Ellipse((cx,cy),ew,eh,facecolor=(*pc,0.10),
                    edgecolor=pc,linewidth=1.5,zorder=2)
        ax.add_patch(e)
        ax.text(cx,cy,lbl,ha='center',va='center',fontsize=7,
                color='black',zorder=3,multialignment='center')

    def line(x1,y1,x2,y2):
        ax.annotate('',xy=(x2,y2),xytext=(x1,y1),
                    arrowprops=dict(arrowstyle='-',color='#999',lw=0.9),zorder=0)

    for cy in [8.8,7.6,6.4,5.2,4.0,2.8,1.6]:
        line(1.42,7.5,7.5-ew/2,cy)
    for cy in [8.8,6.4,5.2,4.0,2.8,0.7]:
        line(1.42,4.5,7.5-ew/2,cy)
    for cy in [8.8,5.2]:
        line(1.42,1.5,7.5-ew/2,cy)
    for cy in [1.6,2.8]:
        line(13.58,7.5,7.5+ew/2,cy)
    for cy in [8.8,7.6,6.4]:
        line(13.58,5.0,7.5+ew/2,cy)
    for cy in [5.2,4.0,6.4,0.7]:
        line(13.58,2.5,7.5+ew/2,cy)
    for cy in [8.8,7.6]:
        line(13.58,0.8,7.5+ew/2,cy)

    ax.set_title('Figure 4 — Subdivision, Land Acquisition & Appeals Use Case Diagram',
                 fontsize=11,fontweight='bold',color=pc,pad=8)
    return fig_to_bytes(fig)


# ═══════════════════════════════════════════════════════════════
# DIAGRAM 5 – Entity Relationship Diagram
# ═══════════════════════════════════════════════════════════════
def draw_erd():
    fig, ax = plt.subplots(figsize=(22, 26))
    ax.set_xlim(0, 22); ax.set_ylim(0, 26)
    ax.axis('off')
    ax.set_facecolor('#F2F4F8')
    fig.patch.set_facecolor('#F2F4F8')

    ax.set_title('Figure 5 — Entity Relationship Diagram\nSpartialIQ — RTCP Act [Chapter 29:12]',
                 fontsize=14, fontweight='bold', color=C_NAVY, pad=10)

    entities = {
        # name: (cx, cy, [(attr, pk/fk/'')])
        'USERS': (3.2, 23.5, [
            ('user_id', 'PK'), ('full_name',''), ('email',''), ('phone',''),
            ('role',''), ('ward_id','FK'), ('created_at',''),
        ]),
        'PROPERTY': (10.5, 23.5, [
            ('property_id','PK'), ('stand_no',''), ('erf_no',''), ('area_ha',''),
            ('land_use',''), ('title_deed_no',''), ('ward_id','FK'),
            ('owner_id','FK'), ('geom',''),
        ]),
        'DEVELOPMENT_APPLICATIONS': (18.2, 23.5, [
            ('application_id','PK'), ('applicant_id','FK'), ('property_id','FK'),
            ('app_type',''), ('description',''), ('status',''),
            ('submitted_at',''), ('decided_at',''), ('permit_id','FK'),
        ]),
        'PERMITS': (18.2, 19.2, [
            ('permit_id','PK'), ('application_id','FK'), ('permit_type',''),
            ('conditions',''), ('issued_at',''), ('expires_at',''),
            ('issued_by','FK'), ('registered_deeds',''),
        ]),
        'SUBDIVISION_APPLICATIONS': (10.5, 19.2, [
            ('subdiv_id','PK'), ('applicant_id','FK'), ('property_id','FK'),
            ('status',''), ('surveyor_ref',''), ('land_set_aside_ha',''),
            ('permit_id','FK'),
        ]),
        'ENFORCEMENT_ORDERS': (3.2, 19.2, [
            ('order_id','PK'), ('property_id','FK'), ('order_type',''),
            ('issued_by','FK'), ('issued_at',''), ('complied_at',''),
            ('registered_deeds',''), ('status',''),
        ]),
        'BUILDING_PRESERVATION_ORDERS': (3.2, 14.8, [
            ('bpo_id','PK'), ('property_id','FK'), ('issued_by','FK'),
            ('museums_consulted',''), ('issued_at',''), ('status',''),
        ]),
        'TREE_PRESERVATION_ORDERS': (10.5, 14.8, [
            ('tpo_id','PK'), ('property_id','FK'), ('issued_by','FK'),
            ('tree_desc',''), ('issued_at',''), ('status',''),
        ]),
        'APPEALS': (18.2, 14.8, [
            ('appeal_id','PK'), ('appellant_id','FK'), ('ref_type',''),
            ('ref_id',''), ('grounds',''), ('lodged_at',''),
            ('court_decision',''), ('decided_at',''),
        ]),
        'COMPENSATION_CLAIMS': (3.2, 10.5, [
            ('claim_id','PK'), ('claimant_id','FK'), ('property_id','FK'),
            ('basis',''), ('amount_claimed',''), ('amount_awarded',''),
            ('lodged_at',''), ('decided_at',''),
        ]),
        'REGIONAL_PLANS': (10.5, 10.5, [
            ('plan_id','PK'), ('region_name',''), ('status',''),
            ('prepared_by','FK'), ('adopted_at',''), ('operative_at',''),
            ('document_url',''),
        ]),
        'MASTER_PLANS': (18.2, 10.5, [
            ('plan_id','PK'), ('planning_area',''), ('status',''),
            ('submitted_by','FK'), ('approved_by','FK'),
            ('operative_at',''), ('document_url',''),
        ]),
        'LOCAL_PLANS': (3.2, 6.2, [
            ('plan_id','PK'), ('master_plan_id','FK'), ('area_name',''),
            ('status',''), ('approved_by','FK'),
            ('operative_at',''), ('document_url',''),
        ]),
        'PUBLIC_NOTICES': (10.5, 6.2, [
            ('notice_id','PK'), ('ref_type',''), ('ref_id',''),
            ('notice_text',''), ('gazette_ref',''), ('published_at',''),
            ('objection_deadline',''),
        ]),
        'OBJECTIONS': (18.2, 6.2, [
            ('objection_id','PK'), ('notice_id','FK'), ('objector_id','FK'),
            ('content',''), ('lodged_at',''), ('referred_to',''),
            ('outcome',''),
        ]),
        'INSPECTIONS': (10.5, 2.5, [
            ('inspection_id','PK'), ('application_id','FK'),
            ('inspector_id','FK'), ('scheduled_at',''), ('conducted_at',''),
            ('findings',''), ('recommendation',''),
        ]),
        'APPLICATION_STATUS_HISTORY': (3.2, 2.5, [
            ('id','PK'), ('application_id','FK'), ('from_status',''),
            ('to_status',''), ('changed_by','FK'), ('notes',''),
            ('changed_at',''),
        ]),
        'WARDS': (18.2, 2.5, [
            ('ward_id','PK'), ('ward_name',''), ('ward_no',''),
            ('district',''), ('geom',''),
        ]),
    }

    box_w, line_h = 3.8, 0.34
    entity_ports = {}  # name -> (cx, top_y, bot_y, left_x, right_x)

    ENTITY_BG   = '#1A3A6B'
    ATTR_BG_1   = '#FFFFFF'
    ATTR_BG_2   = '#EFF2F8'
    PK_COL      = '#D4A017'
    FK_COL      = '#0D7680'

    for name, (cx, cy, attrs) in entities.items():
        n_rows = len(attrs)
        total_h = (n_rows + 1) * line_h
        x0 = cx - box_w/2
        top_y = cy
        bot_y = cy - total_h

        entity_ports[name] = (cx, top_y, bot_y, x0, x0+box_w)

        # Header
        hdr = FancyBboxPatch((x0, cy - line_h), box_w, line_h,
                              boxstyle="square,pad=0", linewidth=0,
                              facecolor=ENTITY_BG, zorder=3)
        ax.add_patch(hdr)
        ax.text(cx, cy - line_h/2, name, ha='center', va='center',
                fontsize=7.5, fontweight='bold', color='white', zorder=4)

        # Attributes
        for i, (attr, kind) in enumerate(attrs):
            row_y = cy - (i+2)*line_h
            bg = ATTR_BG_1 if i%2==0 else ATTR_BG_2
            rect = FancyBboxPatch((x0, row_y), box_w, line_h,
                                   boxstyle="square,pad=0", linewidth=0,
                                   facecolor=bg, zorder=3)
            ax.add_patch(rect)
            col = 'black'
            prefix = ''
            if kind == 'PK':
                col = PK_COL; prefix = '* '
            elif kind == 'FK':
                col = FK_COL; prefix = '> '
            ax.text(x0+0.12, row_y+line_h/2, f'{prefix}{attr}',
                    ha='left', va='center', fontsize=6.5, color=col, zorder=4)
            if kind:
                ax.text(x0+box_w-0.08, row_y+line_h/2, kind,
                        ha='right', va='center', fontsize=5.8,
                        color=col, style='italic', zorder=4)

        # Border
        border = FancyBboxPatch((x0, bot_y), box_w, total_h,
                                 boxstyle="square,pad=0", linewidth=1.5,
                                 edgecolor='#8899BB', facecolor='none', zorder=5)
        ax.add_patch(border)

    # Relationships
    rels = [
        ('USERS','DEVELOPMENT_APPLICATIONS', '1','M','applicant'),
        ('PROPERTY','DEVELOPMENT_APPLICATIONS', '1','M','subject of'),
        ('DEVELOPMENT_APPLICATIONS','PERMITS', '1','1','granted'),
        ('DEVELOPMENT_APPLICATIONS','ENFORCEMENT_ORDERS', '1','M','triggers'),
        ('PROPERTY','ENFORCEMENT_ORDERS', '1','M','applies to'),
        ('PROPERTY','BUILDING_PRESERVATION_ORDERS', '1','M','applies to'),
        ('PROPERTY','TREE_PRESERVATION_ORDERS', '1','M','applies to'),
        ('DEVELOPMENT_APPLICATIONS','APPEALS', '1','M','appealed via'),
        ('PERMITS','APPEALS', '1','M','appealed via'),
        ('USERS','APPEALS', '1','M','lodges'),
        ('PROPERTY','COMPENSATION_CLAIMS', '1','M','subject of'),
        ('USERS','COMPENSATION_CLAIMS', '1','M','claimant'),
        ('REGIONAL_PLANS','MASTER_PLANS', '1','M','guides'),
        ('MASTER_PLANS','LOCAL_PLANS', '1','M','details'),
        ('LOCAL_PLANS','PUBLIC_NOTICES', '1','M','published via'),
        ('PUBLIC_NOTICES','OBJECTIONS', '1','M','receives'),
        ('USERS','OBJECTIONS', '1','M','lodges'),
        ('DEVELOPMENT_APPLICATIONS','INSPECTIONS', '1','M','requires'),
        ('DEVELOPMENT_APPLICATIONS','APPLICATION_STATUS_HISTORY', '1','M','tracks'),
        ('PROPERTY','SUBDIVISION_APPLICATIONS', '1','M','subject of'),
        ('USERS','SUBDIVISION_APPLICATIONS', '1','M','applicant'),
        ('PROPERTY','WARDS', 'M','1','located in'),
        ('USERS','WARDS', 'M','1','serves'),
    ]

    def get_edge(e_name, direction):
        cx, top, bot, left, right = entity_ports[e_name]
        if direction == 'T': return (cx, top)
        if direction == 'B': return (cx, bot)
        if direction == 'L': return (left, (top+bot)/2)
        if direction == 'R': return (right, (top+bot)/2)

    def rel_line(a, b, card_a, card_b, label=''):
        cx_a, top_a, bot_a, left_a, right_a = entity_ports[a]
        cx_b, top_b, bot_b, left_b, right_b = entity_ports[b]
        # pick closest edges
        if abs(cx_a - cx_b) >= abs((top_a+bot_a)/2 - (top_b+bot_b)/2):
            if cx_a < cx_b:
                p1 = (right_a, (top_a+bot_a)/2)
                p2 = (left_b,  (top_b+bot_b)/2)
            else:
                p1 = (left_a,  (top_a+bot_a)/2)
                p2 = (right_b, (top_b+bot_b)/2)
        else:
            if (top_a+bot_a)/2 > (top_b+bot_b)/2:
                p1 = (cx_a, bot_a)
                p2 = (cx_b, top_b)
            else:
                p1 = (cx_a, top_a)
                p2 = (cx_b, bot_b)
        ax.plot([p1[0],p2[0]],[p1[1],p2[1]], color='#6688AA', lw=0.9, zorder=1)
        mx, my = (p1[0]+p2[0])/2, (p1[1]+p2[1])/2
        ax.text(mx, my+0.12, label, ha='center', va='bottom',
                fontsize=5.5, color='#445566', style='italic', zorder=6)
        ax.text(p1[0]+0.06, p1[1]+0.06, card_a, ha='center', va='center',
                fontsize=6, color=PK_COL, fontweight='bold', zorder=6)
        ax.text(p2[0]-0.06, p2[1]+0.06, card_b, ha='center', va='center',
                fontsize=6, color=PK_COL, fontweight='bold', zorder=6)

    for a, b, ca, cb, lbl in rels:
        try:
            rel_line(a, b, ca, cb, lbl)
        except Exception:
            pass

    # Legend
    legend_items = [
        mpatches.Patch(facecolor=ENTITY_BG, label='Entity name'),
        mpatches.Patch(facecolor='white', edgecolor='#8899BB', label='Attributes'),
        Line2D([0],[0], color=PK_COL, lw=2, label='PK — Primary Key'),
        Line2D([0],[0], color=FK_COL, lw=2, label='FK — Foreign Key'),
        Line2D([0],[0], color='#6688AA', lw=1.5, label='Relationship line'),
    ]
    ax.legend(handles=legend_items, loc='lower left', fontsize=7.5, framealpha=0.95)

    return fig_to_bytes(fig)


# ═══════════════════════════════════════════════════════════════
# USE CASE DATA
# ═══════════════════════════════════════════════════════════════
USE_CASES = [
    # ── PART V – Development Control ─────────────────────────────
    dict(
        id='UC-01', name='Submit Development Permit Application',
        actors='Citizen / Applicant (Owner, Developer)',
        desc='Any person wishing to carry out development (erect a building, change land use, mining, '
             'display advertisements, deposit waste, etc.) must apply to the Local Planning Authority '
             'for a permit before commencing work.',
        ref='Section 26(1), Part V; Section 22 (definition of development)',
        pre='Applicant has registered an account in the system. Property record exists. '
            'Owner consent and bond-holder consent obtained where required.',
        main=(
            '1. Applicant logs in and selects "New Development Application".\n'
            '2. Selects application type (Permit / Preliminary Planning Permission).\n'
            '3. Fills in property details, description of proposed development, EIA references.\n'
            '4. Uploads site plans, drawings, consents (owner, bond-holder).\n'
            '5. Pays prescribed application fee (via system payment module).\n'
            '6. System generates reference number and timestamps submission.\n'
            '7. System emails acknowledgement to applicant within 2 working days.'
        ),
        alt=(
            'A. Application incomplete → System flags missing fields; applicant must rectify before submission.\n'
            'B. Property does not exist in cadastre → Applicant requests GIS officer to add property first.\n'
            'C. Development near regional road (200m buffer) → System auto-notifies Minister responsible for roads.'
        ),
        post='Application record created with status = "submitted". Planner assigned. '
             'Clock starts: LPA must decide within 3 months (s.26(7)) or deemed refused.',
        system='Route: POST /api/permit-applications. Roles: public, registered. '
               'Tables: development_applications, application_documents. '
               'Auto-trigger: notify planner via SSE/email. GIS buffer check at 200m.'
    ),
    dict(
        id='UC-02', name='Process & Review Permit Application',
        actors='Planner, Planning Clerk, Environmental Officer, Building Inspector, Local Planning Authority',
        desc='The LPA examines the application, determines if public notice is required, '
             'consults neighbouring authorities, and evaluates the proposal against operative '
             'master plans, local plans, development orders, and any other material considerations.',
        ref='Sections 26(2)–(5)',
        pre='Application submitted (UC-01). Status = "submitted".',
        main=(
            '1. System auto-assigns application to a planner (round-robin or by ward).\n'
            '2. Planner acknowledges receipt within 2 weeks (s.26(2)(a)).\n'
            '3. System checks spatial triggers: regional road, aerodrome, adjacent LPA boundary.\n'
            '4. If required (s.26(3)), planner marks application for public notice.\n'
            '5. Planner/Building Inspector/Env. Officer add review comments internally.\n'
            '6. Planner assesses against master plan, local plan, development orders.\n'
            '7. Planner may request additional information from applicant.\n'
            '8. Status updated → "under_review".'
        ),
        alt=(
            'A. Adjacent LPA interest → System auto-notifies neighbouring authority.\n'
            'B. Application involves demolition of heritage building → BPO check; notify Executive Director of Museums.\n'
            'C. Within aerodrome obstacle limitation area → Notify Minister responsible for aviation.'
        ),
        post='Review complete. Application moves to "awaiting decision" state. '
             'All review comments recorded in application timeline.',
        system='Routes: PATCH /api/permit-applications/:id, GET /api/permit-applications/:id/comments. '
               'Roles: planner, planning_clerk, env_officer, building_inspector. '
               'Spatial checks via PostGIS ST_DWithin on roads/aerodrome layers.'
    ),
    dict(
        id='UC-03', name='Issue Public Notice for Application',
        actors='Local Planning Authority, Planning Clerk, Applicant',
        desc='Where the proposed development deviates from the operative plan, '
             'conflicts with title conditions, or may adversely affect the area, '
             'the LPA directs the applicant to give public notice at their own expense.',
        ref='Section 26(3)–(4)',
        pre='Application under review. Planner has determined public notice is required.',
        main=(
            '1. Planner marks application "public notice required".\n'
            '2. System generates public notice template with application summary.\n'
            '3. Applicant publishes notice in Gazette and local newspaper.\n'
            '4. Applicant uploads proof of publication to system.\n'
            '5. System opens 1-month objection window from notice date.\n'
            '6. Objections received are logged against the application.\n'
            '7. Applicant notified of objections; given opportunity to comment (s.26(4)).'
        ),
        alt=(
            'A. No objections received → Application proceeds to decision after 1 month.\n'
            'B. Objection from Minister (roads/aviation) → Must be resolved before decision.'
        ),
        post='Public notice period expired. Objections summarised for planner. '
             'Application ready for determination.',
        system='Table: public_notices, objections. '
               'Auto-close objection window with cron job at deadline. '
               'Objection portal visible to public users.'
    ),
    dict(
        id='UC-04', name='Grant or Refuse Permit / Preliminary Planning Permission',
        actors='Local Planning Authority, Planner (delegated), Minister (if referred)',
        desc='The LPA decides to grant a permit, grant preliminary planning permission (PPP), '
             'or refuse the application. If granted, conditions are attached. '
             'Minister may call in any application (s.29).',
        ref='Sections 26(6)–(12), 29',
        pre='Application under review or awaiting decision. Review complete.',
        main=(
            '1. Planner drafts recommendation (grant/refuse) with reasons.\n'
            '2. Planning committee approves or modifies recommendation.\n'
            '3. Decision recorded: permit or PPP with conditions, or refusal with reasons.\n'
            '4. If permit: conditions recorded including implementation deadline (s.26(8)(a)(ii)).\n'
            '5. System generates permit document (PDF) with unique permit number.\n'
            '6. Applicant notified in writing (email + in-app notification).\n'
            '7. If development conflicts with title condition, copy sent to Registrar of Deeds (s.26(9)).\n'
            '8. Status → "approved" or "rejected".'
        ),
        alt=(
            'A. Minister calls in application (s.29(1)) → LPA refers file to Minister; Minister decides.\n'
            'B. 3-month deadline expires without decision → Deemed refused (s.26(7)); appeal right opens.\n'
            'C. PPP granted → Detailed application required within prescribed period (s.26(11)).'
        ),
        post='Permit issued and recorded. If refused, appeal right arises. '
             'Permit copy sent to Registrar of Deeds if applicable.',
        system='Route: POST /api/applications/:id/status (toStatus: approved|rejected). '
               'Auto-generate permit PDF. FK: permits.application_id. '
               'Deadline enforcement via scheduled job.'
    ),
    dict(
        id='UC-05', name='Regularise Existing Unauthorised Development',
        actors='Citizen / Owner, Local Planning Authority, Planner',
        desc='Where development has been carried out in contravention of section 24, '
             'the owner may apply under section 26 to regularise it. '
             'If granted, the permit takes effect retrospectively.',
        ref='Section 27',
        pre='Development exists on property without a valid permit. '
            'Enforcement order may or may not have been issued.',
        main=(
            '1. Owner submits regularisation application (same form as UC-01) noting "regularisation".\n'
            '2. Planner marks application type = "regularisation".\n'
            '3. Normal review process (UC-02) applies.\n'
            '4. If permit granted, effective date = date development commenced.\n'
            '5. If refused, enforcement action may proceed (UC-07).'
        ),
        alt=(
            'A. Development is totally non-compliant → Refused; enforcement order issued.\n'
            'B. Partial regularisation possible → Conditions require modification of development.'
        ),
        post='If granted: retrospective permit issued; property status updated. '
             'If refused: enforcement escalated.',
        system='application_type = "regularisation". '
               'permit.effective_from = development_start_date. '
               'Linked to any existing enforcement_orders.'
    ),
    dict(
        id='UC-06', name='Apply for Subdivision or Consolidation Permit',
        actors='Owner, Surveyor, Local Planning Authority, Surveyor-General',
        desc='No land may be subdivided or consolidated, and no agreement for the sale or lease '
             'of a portion for 10+ years may be entered into, without a permit from the LPA.',
        ref='Sections 39–41, 44',
        pre='Property registered in system. Owner and bond-holder consents obtained.',
        main=(
            '1. Owner/Surveyor submits subdivision application.\n'
            '2. System checks adjacency to regional/primary/secondary road → advises Minister for roads.\n'
            '3. If public notice required (s.40(3)), same process as UC-03.\n'
            '4. If agricultural land, Minister responsible for agriculture consulted.\n'
            '5. LPA evaluates against master plan and local plan.\n'
            '6. Permit granted with conditions including: (a) land set aside for roads, '
            '(b) % of land or money paid for public purposes (s.41).\n'
            '7. Surveyor-General reference required; survey records must be submitted within permit period (s.40(5)(a)(ii)).\n'
            '8. On approval, ownership of set-aside land vests in appropriate authority immediately (s.41(2)).'
        ),
        alt=(
            'A. 4-month deadline expires without decision → Deemed refused (s.40(6)).\n'
            'B. Survey records not submitted in time → Permit deemed revoked (s.40(9)).\n'
            'C. Value of subdivision disputed → Appeal to Administrative Court (s.41(6)).'
        ),
        post='Subdivision permit issued with conditions. Set-aside land recorded. '
             'Surveyor-General and Registrar of Deeds notified.',
        system='Table: subdivision_applications. Spatial check for road adjacency. '
               'Track surveyor_ref and survey_submission_deadline. '
               'Auto-revoke permit if survey deadline passed.'
    ),
    # ── Enforcement ───────────────────────────────────────────────
    dict(
        id='UC-07', name='Issue Enforcement Order',
        actors='Local Planning Authority, Building Inspector, Planner, Env. Officer',
        desc='Where the LPA determines that development has been or is being carried out '
             'in contravention of the Act, it may issue an enforcement order '
             'requiring demolition, cessation, or remedial works.',
        ref='Sections 32–33, 37',
        pre='Evidence of unauthorised development gathered (inspection report). '
            'LPA has considered whether enforcement is expedient.',
        main=(
            '1. Inspector files inspection report documenting the contravention.\n'
            '2. Planner drafts enforcement order specifying required steps and deadline (min 1 month).\n'
            '3. Order served on owner and any other affected persons.\n'
            '4. System records service date; appeal window opens (1 month from service).\n'
            '5. If no appeal: order becomes operative; copy sent to Registrar of Deeds.\n'
            '6. Compliance monitored by inspector.\n'
            '7. If non-compliant: LPA may enter property and carry out works at owner\'s cost (s.37).'
        ),
        alt=(
            'A. Owner appeals (UC-09) → Enforcement order suspended during appeal.\n'
            'B. Affects many persons in an area → Notice published in newspaper (s.32(6)).\n'
            'C. Non-compliance → Criminal prosecution (fine up to level 8 / 1 year imprisonment s.32(7)).'
        ),
        post='Enforcement order active and registered against title. '
             'Compliance tracked via follow-up inspection.',
        system='Table: enforcement_orders. order_type: enforcement|prohibition|bpo|tpo. '
               'Auto-set operative_date after appeal window. Link to Registrar of Deeds flag.'
    ),
    dict(
        id='UC-08', name='Issue Prohibition Order',
        actors='Local Planning Authority, Planner',
        desc='Where the LPA has issued or intends to issue an enforcement order, '
             'it may issue a prohibition order to immediately stop development '
             'before the enforcement order becomes operative.',
        ref='Section 34',
        pre='Enforcement order issued or about to be issued. Urgent stop needed.',
        main=(
            '1. Planner identifies urgent need to stop development immediately.\n'
            '2. Prohibition order drafted, specifying operative date.\n'
            '3. Order served on all persons who received or will receive the enforcement order.\n'
            '4. Development must stop immediately from operative date.\n'
            '5. Order ceases when enforcement order becomes operative or is set aside.'
        ),
        alt=(
            'A. Contravention → Fine up to level 8 / 1 year imprisonment (s.34(3)).'
        ),
        post='Development halted. Prohibition order linked to enforcement order in system.',
        system='enforcement_orders with order_type = "prohibition". '
               'Status transitions: issued → operative → withdrawn|superseded.'
    ),
    dict(
        id='UC-09', name='Issue Building Preservation Order',
        actors='Local Planning Authority, Planner, Executive Director of Museums',
        desc='The LPA may serve a building preservation order on the owner and occupier of '
             'a building of special architectural merit or historic interest, restricting '
             'demolition, alteration, or extension without consent.',
        ref='Section 30',
        pre='Building identified as having special architectural or historic value. '
            'Executive Director of Museums consulted (mandatory for non-monument buildings).',
        main=(
            '1. LPA identifies building for preservation (survey / citizen report).\n'
            '2. Planner consults Executive Director of Museums; conditions obtained.\n'
            '3. Building Preservation Order drafted incorporating museum conditions.\n'
            '4. Order served on owner and occupier.\n'
            '5. Owner may appeal within 1 month (UC-13).\n'
            '6. After appeal period, copy registered with Registrar of Deeds.\n'
            '7. Any development permit involving demolition of the building requires museum notification.'
        ),
        alt=(
            'A. Whole building demolished under permit → LPA notifies Registrar of Deeds to cancel endorsement.\n'
            'B. Partial demolition → Amended BPO issued for remaining structure.\n'
            'C. Owner deliberately lets building deteriorate → LPA applies to court for assessment on basis no permit granted (s.48(5)).\n'
            'D. Unauthorised demolition/alteration → Fine up to level 8 / 1 year (s.30(7)).'
        ),
        post='BPO registered against title deed. Building flagged in GIS layer as "heritage protected".',
        system='Table: building_preservation_orders. GIS heritage layer updated. '
               'Notification workflow for future permit applications on same property.'
    ),
    dict(
        id='UC-10', name='Issue Tree Preservation Order',
        actors='Local Planning Authority, Environmental Officer',
        desc='The LPA may serve a tree preservation order on any landowner to protect '
             'natural forest, trees, or woodlands from cutting, topping, lopping, '
             'injuring, or destruction without consent.',
        ref='Section 31',
        pre='Trees or woodland of amenity / ecological value identified in planning area.',
        main=(
            '1. Env. Officer identifies trees requiring protection.\n'
            '2. TPO drafted and served on owner/occupier.\n'
            '3. Owner cannot cut/lop without LPA consent or valid legal obligation.\n'
            '4. Consent applications handled through same permit process.\n'
            '5. Enforcement if breached (fine up to level 7 / 6 months, s.31(4)).'
        ),
        alt=('A. Owner appeals TPO within 1 month to Administrative Court.'),
        post='TPO active and recorded. Trees mapped in GIS environmental layer.',
        system='Table: enforcement_orders with order_type = "tpo". '
               'Env layer updated in PostGIS. Consent requests linked to application system.'
    ),
    # ── Planning ──────────────────────────────────────────────────
    dict(
        id='UC-11', name='Prepare and Submit Master Plan',
        actors='Local Planning Authority (Vungu RDC), Planner, GIS Officer, Director of Physical Planning, Minister',
        desc='The LPA prepares a master plan for its planning area, undertakes a study, '
             'holds public consultation, publishes the draft for 2 months, '
             'receives objections and representations, then submits to the Minister.',
        ref='Sections 13–16',
        pre='Planning area study commenced (s.13). No operative master plan exists or '
            'Minister has directed preparation.',
        main=(
            '1. Planner / GIS Officer conduct area study (land use, roads, utilities, demographics).\n'
            '2. Draft master plan prepared: written statement + maps.\n'
            '3. LPA adopts draft master plan.\n'
            '4. Public exhibition for 2 months; public notice given in Gazette and newspaper.\n'
            '5. Objections and representations logged in system.\n'
            '6. LPA submits to Minister: draft plan + study report + objections report (s.16(1)).\n'
            '7. Minister refers to Director for evaluation; to relevant Ministries for comment.\n'
            '8. Minister approves/rejects/modifies master plan.\n'
            '9. Approved plan published in Gazette; becomes operative 6 weeks after Gazette notice.'
        ),
        alt=(
            'A. Minister returns plan for additional info or further publicity (s.16(2)).\n'
            'B. Objections referred to Administrative Court or Local Inquiry.\n'
            'C. Person aggrieved challenges validity in High Court within 6 weeks (s.71).'
        ),
        post='Operative master plan stored in system. All future permit decisions must accord with it.',
        system='Table: master_plans. document_url links to uploaded plan PDF. '
               'Status: draft → exhibition → submitted → approved → operative. '
               'GIS: master plan boundary layer in PostGIS.'
    ),
    dict(
        id='UC-12', name='Prepare and Approve Local Plan',
        actors='Local Planning Authority, Planner, GIS Officer, Minister',
        desc='The LPA prepares a local plan for specific areas within its jurisdiction '
             'to detail the implementation of master plan policies. '
             'Approved by the LPA itself (unless Minister intervenes).',
        ref='Sections 17–19',
        pre='Operative master plan exists (except scheduled LPA). '
            'Planning need identified for specific area.',
        main=(
            '1. LPA decides to prepare local plan (or directed by Minister).\n'
            '2. Planner prepares draft: map of area + written statement.\n'
            '3. Draft submitted to Minister for information.\n'
            '4. Public exhibition for 2 months; notice given.\n'
            '5. Objections referred to Administrative Court; representations to local inquiry.\n'
            '6. LPA considers investigator\'s report; gives public notice of recommendations.\n'
            '7. LPA approves local plan (with or without modifications).\n'
            '8. Notice in Gazette; plan becomes operative.'
        ),
        alt=(
            'A. Minister directs that plan shall not become operative until he approves it (s.19(5)) → '
            'Master plan process (s.16) applies mutatis mutandis.\n'
            'B. Local plan conflicts with master plan → Master plan prevails (s.21).'
        ),
        post='Operative local plan stored and linked to master plan. '
             'Spatial data updated in GIS.',
        system='Table: local_plans. FK: master_plan_id. '
               'Status workflow same as master plans.'
    ),
    dict(
        id='UC-13', name='Prepare and Adopt Regional Plan',
        actors='Regional Planning Council, Minister, Director of Physical Planning',
        desc='The Regional Planning Council prepares a regional plan within 3 years of establishment, '
             'covering major land uses, infrastructure, conservation, and development phasing '
             'for the region.',
        ref='Sections 3–9',
        pre='Regional Planning Council established by Presidential proclamation.',
        main=(
            '1. RPC prepares inventory of regional assets and resources.\n'
            '2. Draft regional plan prepared (written statement + maps).\n'
            '3. Public exhibition for 2 months; representations received.\n'
            '4. RPC adopts draft (with modifications); submits to Minister with representations report.\n'
            '5. Minister refers to Director for evaluation; to relevant Ministries.\n'
            '6. Minister may refer representations to Local Inquiry.\n'
            '7. Minister approves regional plan; submitted to President for determination.\n'
            '8. Regional plan becomes operative on Presidential approval.'
        ),
        alt=(
            'A. Minister returns plan to RPC for reconsideration (s.7(8)).\n'
            'B. Regional plan conflicts with existing master/local plan → Regional plan prevails (s.9(2)).'
        ),
        post='Operative regional plan uploaded. All master plans within region must conform.',
        system='Table: regional_plans. '
               'Linked to master_plans via region boundary. '
               'Spatial boundary loaded as GIS layer.'
    ),
    dict(
        id='UC-14', name='Conduct Planning Area Study',
        actors='Local Planning Authority, Planner, GIS Officer, Surveyor',
        desc='Before preparing or altering any master or local plan, the LPA must '
             'undertake a study examining matters likely to affect development or '
             'redevelopment of the area.',
        ref='Section 13',
        pre='Decision to prepare or alter a plan has been made.',
        main=(
            '1. GIS Officer extracts spatial data: roads, buildings, land use, wards, waterways.\n'
            '2. Planner records demographic data, economic data, infrastructure status.\n'
            '3. Neighbouring LPAs consulted regarding shared boundaries.\n'
            '4. Study report compiled and uploaded to system.\n'
            '5. Study informs draft master/local plan content.'
        ),
        alt=('A. Study reveals conflicts with regional plan → Must be reconciled before plan submission.'),
        post='Study report stored and linked to plan preparation record.',
        system='GIS: spatial analysis using PostGIS (area stats, buffer, overlay). '
               'Document upload: study_report linked to master_plans or local_plans.'
    ),
    # ── Acquisition & Compensation ────────────────────────────────
    dict(
        id='UC-15', name='Acquire or Expropriate Land',
        actors='Local Planning Authority, Minister, Owner',
        desc='The LPA may acquire land by agreement or expropriation to implement '
             'proposals in an operative master or local plan, or as directed by the Minister.',
        ref='Sections 45–47',
        pre='Operative plan reserves land for a specific purpose. '
            'Owner identified and notified.',
        main=(
            '1. LPA identifies land reserved in operative plan.\n'
            '2. LPA approaches owner for purchase by agreement.\n'
            '3. If no agreement: LPA initiates expropriation under Land Acquisition Act.\n'
            '4. Compensation assessed by Administrative Court if disputed.\n'
            '5. LPA issues certificate stating permitted development type for expropriation purposes (s.46(2)).\n'
            '6. Title transferred; land vests in LPA or President.\n'
            '7. Registrar of Deeds notified; title records updated.'
        ),
        alt=(
            'A. Owner requires acquisition (s.47) → Owner calls upon LPA; LPA must act within 2 years.\n'
            'B. Owner challenges certificate → Appeal to Administrative Court within 1 month.'
        ),
        post='Land acquired, title updated. Compensation paid from development account (s.66).',
        system='Table: compensation_claims. Development account ledger. '
               'Property record ownership updated. Registrar of Deeds flag.'
    ),
    dict(
        id='UC-16', name='Lodge Compensation Claim',
        actors='Owner / Affected Person, Local Planning Authority, Administrative Court',
        desc='Any person whose property is injuriously affected by an operative plan, order, or '
             'LPA action may lodge a compensation claim within the prescribed period.',
        ref='Sections 50–53',
        pre='Injurious affection caused by plan operation, BPO, TPO, or s.35 action. '
            'Claim lodged within prescribed period.',
        main=(
            '1. Claimant submits claim via system specifying basis, amount, and supporting evidence.\n'
            '2. LPA acknowledges claim; records in compensation claims register.\n'
            '3. Parties attempt to agree on amount.\n'
            '4. If not agreed: referred to Administrative Court for determination (s.53(1)).\n'
            '5. Court determines amount based on decrease in property value.\n'
            '6. Compensation paid from development account.'
        ),
        alt=(
            'A. Claim excluded by s.52 (planning restrictions, density controls, etc.) → LPA rejects; '
            'claimant may appeal.\n'
            'B. Same matter claimable under another Act → Double compensation prohibited (s.52(5)).'
        ),
        post='Compensation paid and recorded. Property value impact noted in planning register.',
        system='Table: compensation_claims. FK: claimant_id, property_id. '
               'Status: lodged → assessment → agreed|court_referred → settled.'
    ),
    # ── Appeals ───────────────────────────────────────────────────
    dict(
        id='UC-17', name='Lodge Appeal to Administrative Court',
        actors='Aggrieved Person (Applicant, Owner, Objector), Administrative Court',
        desc='Any person aggrieved by a decision on a permit, PPP, enforcement order, '
             'BPO, TPO, or notice under s.35 may appeal to the Administrative Court '
             'within 1 month of the decision.',
        ref='Sections 38, 44, 53',
        pre='Decision made (or deemed made) by LPA. Appellant aggrieved.',
        main=(
            '1. Appellant logs appeal in system: specifies decision, grounds, relief sought.\n'
            '2. System validates that appeal is within 1-month deadline.\n'
            '3. Appellant may apply to suspend enforcement pending appeal (s.38(4)).\n'
            '4. Administrative Court convenes (President + 2 assessors from expert list, s.59).\n'
            '5. Court considers all representations; makes order as it deems fit.\n'
            '6. Order recorded in system; LPA notified.\n'
            '7. Further appeal to Supreme Court only on point of law (s.61).'
        ),
        alt=(
            'A. Court declines to entertain appeal if permission could not have been granted (s.38(2)).\n'
            'B. Same application refused twice without material change → Court may decline (s.38(2)(b)).\n'
            'C. Question of law → Reference to Supreme Court (s.61).'
        ),
        post='Court order recorded. LPA must comply. If order varies permit, permit treated as so varied.',
        system='Table: appeals. FK: ref_type (application|enforcement|bpo|tpo), ref_id. '
               'Status: lodged → hearing → decided. '
               'Enforcement suspension flag linked to enforcement_orders.'
    ),
    dict(
        id='UC-18', name='Conduct Site Inspection',
        actors='Building Inspector, Environmental Officer, Surveyor, GIS Officer, Director',
        desc='Authorised officers may enter any property at reasonable times to inspect '
             'buildings, verify permit compliance, investigate contraventions, '
             'or gather data for planning purposes.',
        ref='Section 65',
        pre='Inspection authorised by LPA or Director. Owner/occupier notified '
            '(except urgent contravention cases).',
        main=(
            '1. Inspector creates inspection record in system (property, date, purpose).\n'
            '2. Inspector visits property; records findings.\n'
            '3. Photographs, measurements, GIS coordinates recorded.\n'
            '4. Inspection report submitted in system.\n'
            '5. Report linked to relevant application or enforcement order.\n'
            '6. If contravention found → Triggers UC-07 (enforcement order).\n'
            '7. If compliant → Compliance certificate attached to permit.'
        ),
        alt=(
            'A. Owner obstructs entry → Offence: fine up to level 6 / 6 months (s.65(6)).\n'
            'B. Entry to dwelling → Only permitted if necessary to prevent/detect contravention (s.65(4)).'
        ),
        post='Inspection report stored. Linked to application, enforcement order, or permit.',
        system='Table: inspections. FK: application_id, inspector_id. '
               'Geo-tagged photos and coordinates. '
               'Route: POST /api/inspections.'
    ),
    dict(
        id='UC-19', name='Manage Road Closure or Diversion',
        actors='Local Planning Authority, Surveyor-General, Registrar of Deeds',
        desc='When an operative master plan or local plan declares a road closed or diverted, '
             'the LPA notifies the Surveyor-General who amends the general plan accordingly.',
        ref='Section 58',
        pre='Operative master plan or local plan declares road closure/diversion.',
        main=(
            '1. Planner identifies road closure/diversion in operative plan.\n'
            '2. LPA formally notifies Surveyor-General of effective date.\n'
            '3. Surveyor-General endorses general plan accordingly.\n'
            '4. Road layer in GIS updated to reflect closure/diversion.\n'
            '5. Registrar of Deeds notified where ownership of road land is affected.'
        ),
        alt=('A. Road vested in President/road authority → Ownership continues despite closure (s.58(2)).'),
        post='GIS road layer updated. Cadastral records amended.',
        system='GIS roads layer update via GIS Officer. '
               'Notification workflow to Surveyor-General. '
               'Change logged in application_status_history.'
    ),
    dict(
        id='UC-20', name='Manage Development Account',
        actors='Local Planning Authority, Finance Officer, Minister',
        desc='The LPA maintains a dedicated development account into which '
             'subdivision levies, endowment moneys, and land sale proceeds are paid. '
             'Funds may only be used for prescribed purposes.',
        ref='Section 66',
        pre='LPA has received subdivision levy or other prescribed payment.',
        main=(
            '1. System records levy payment against subdivision permit or application.\n'
            '2. Finance officer allocates to development account.\n'
            '3. Account used for: land acquisition, compensation payments, valuation costs.\n'
            '4. Minister may authorise additional uses in writing.\n'
            '5. Separate sub-account for moneys paid under s.26(8)(b)(i) conditions.'
        ),
        alt=('A. Moneys directed by Minister for specific purpose → System enforces restricted use flag.'),
        post='Development account ledger updated. Audit trail maintained.',
        system='Financial module: development_account_ledger table. '
               'FK: permit_id, subdivision_id. Read-only for non-finance roles.'
    ),
]


# ═══════════════════════════════════════════════════════════════
# BUILD WORD DOCUMENT
# ═══════════════════════════════════════════════════════════════
def build_doc():
    doc = Document()

    # ── Page layout ──────────────────────────────────────────────
    from docx.shared import Cm
    section = doc.sections[0]
    section.page_width  = Cm(21.0)
    section.page_height = Cm(29.7)
    section.left_margin = section.right_margin = Cm(2.5)
    section.top_margin  = section.bottom_margin = Cm(2.2)

    # ── Default style ─────────────────────────────────────────────
    style = doc.styles['Normal']
    style.font.name = 'Calibri'
    style.font.size = Pt(10)

    # ═══ TITLE PAGE ══════════════════════════════════════════════
    doc.add_paragraph()
    doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run('REGIONAL, TOWN AND COUNTRY PLANNING ACT')
    run.font.size = Pt(20); run.font.bold = True
    run.font.color.rgb = RGBColor(13, 47, 97)

    p2 = doc.add_paragraph()
    p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r2 = p2.add_run('Chapter 29:12 — Zimbabwe')
    r2.font.size = Pt(14); r2.font.color.rgb = RGBColor(13, 47, 97)

    doc.add_paragraph()
    p3 = doc.add_paragraph()
    p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r3 = p3.add_run('Use Cases · Use Case Diagrams · Entity Relationship Diagram')
    r3.font.size = Pt(16); r3.font.bold = True; r3.font.color.rgb = RGBColor(12, 128, 128)

    doc.add_paragraph()
    p4 = doc.add_paragraph()
    p4.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r4 = p4.add_run('Prepared for: SpartialIQ — Vungu Rural District Council Planning Portal')
    r4.font.size = Pt(12)

    p5 = doc.add_paragraph()
    p5.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r5 = p5.add_run('June 2026')
    r5.font.size = Pt(11)

    doc.add_page_break()

    # ═══ SECTION 1 – INTRODUCTION ════════════════════════════════
    heading(doc, '1. Introduction', 1)
    body(doc,
        'The Regional, Town and Country Planning Act [Chapter 29:12] of Zimbabwe ('
        'the Act) provides the legal framework governing the planning of regions, '
        'districts, and local areas across Zimbabwe. It authorises the making of '
        'regional plans, master plans, and local plans; controls development including '
        'the use and construction of land and buildings; regulates subdivisions and '
        'consolidations; provides for land acquisition; and establishes enforcement, '
        'compensation, and appeal mechanisms.')
    body(doc,
        'This document provides a critical analysis of the Act from a system-design '
        'perspective, specifically in relation to the SpartialIQ platform operated by '
        'Vungu Rural District Council (RDC). Vungu RDC is a Local Planning Authority '
        'under s.10(1)(b) of the Act. Every use case documented below is directly '
        'traceable to one or more sections of the Act and to specific modules '
        'and database tables within SpartialIQ.')

    heading(doc, '1.1 Scope', 2)
    body(doc, 'This document covers:')
    for item in [
        'All actors/entities identified in the Act and their roles within SpartialIQ',
        '20 detailed use cases covering all major functional areas of the Act',
        '4 UML-style use case diagrams (system-level + 3 subsystem diagrams)',
        '1 comprehensive Entity Relationship Diagram (18 entities)',
        'A system coverage matrix mapping Act sections to SpartialIQ features',
    ]:
        bullet(doc, item)

    heading(doc, '1.2 Acronyms', 2)
    tbl = doc.add_table(rows=1, cols=2)
    tbl.style = 'Table Grid'
    tbl.rows[0].cells[0].text = 'Acronym'
    tbl.rows[0].cells[1].text = 'Meaning'
    for cell in tbl.rows[0].cells:
        set_cell_bg(cell, '0D2F61')
        for p in cell.paragraphs:
            for r in p.runs:
                r.font.bold = True; r.font.color.rgb = RGBColor(255,255,255)
    for acr, meaning in [
        ('Act',  'Regional, Town and Country Planning Act [Chapter 29:12]'),
        ('LPA',  'Local Planning Authority (= Vungu RDC for this system)'),
        ('PPP',  'Preliminary Planning Permission (s.26)'),
        ('BPO',  'Building Preservation Order (s.30)'),
        ('TPO',  'Tree Preservation Order (s.31)'),
        ('RPC',  'Regional Planning Council (Part II)'),
        ('RDC',  'Rural District Council'),
        ('GIS',  'Geographic Information System'),
        ('ERD',  'Entity Relationship Diagram'),
        ('UCD',  'Use Case Diagram'),
        ('UC',   'Use Case'),
        ('FK',   'Foreign Key'), ('PK', 'Primary Key'),
    ]:
        r = tbl.add_row()
        r.cells[0].text = acr; r.cells[1].text = meaning
    doc.add_paragraph()

    # ═══ SECTION 2 – ACTORS ══════════════════════════════════════
    doc.add_page_break()
    heading(doc, '2. Actors and Entities', 1)
    body(doc,
        'The following actors are identified in the Act and mapped to user roles '
        'within SpartialIQ. Each actor interacts with the system in distinct ways '
        'governed by their statutory duties and permissions.')

    actors_data = [
        ('Actor', 'Statutory Role (Act reference)', 'SpartialIQ Role(s)', 'Key Responsibilities'),
        ('Minister\n(Local Govt)', 'Overall control; approves master plans; '
          'issues development orders; calls in applications; default powers (ss.16,25,29,70)',
          'External authority (not a system user; notified via correspondence)',
          'Approve/reject master plans; issue development orders; call in applications'),
        ('Regional Planning Council', 'Prepares regional plan for the region (ss.3-9)',
          'External body (plan documents uploaded by planner)',
          'Regional plan preparation; advise LPAs on master/local plans'),
        ('Local Planning Authority\n(Vungu RDC)', 'Primary decision-maker: grants permits, issues orders, '
          'prepares plans, acquires land (Parts III–IX)',
          'Represented by admin, planner, planning_clerk, building_inspector, eo, env_officer, gis_officer, surveyor',
          'All planning decisions; plan preparation; enforcement; compensation'),
        ('Director of Physical Planning', 'Evaluates regional and master plans for Minister; '
          'approves State land subdivisions (ss.16(4)(a),43,63)',
          'External authority (system generates reports for submission)',
          'Technical evaluation of plans; subdivision of State land'),
        ('Planner', 'Prepares plans; reviews applications; drafts orders (ss.13-20,26,32)',
          'planner role', 'Review applications; prepare plans; draft enforcement orders'),
        ('Planning Clerk', 'Administrative support: receives applications, '
          'serves notices, maintains registers (s.68(c))',
          'planning_clerk role', 'Application intake; public notices; register maintenance'),
        ('Building Inspector', 'Inspects buildings; verifies permit compliance; '
          'investigates contraventions (ss.26,32,65)',
          'building_inspector role', 'Site inspections; compliance verification'),
        ('Environmental Officer', 'Environmental review of applications; '
          'TPO enforcement; environmental conditions (ss.26(5),31)',
          'env_officer, eo roles', 'Environmental assessment; TPO management'),
        ('GIS Officer', 'Spatial data management; mapping planning areas; '
          'cadastral updates (ss.13,58,65)',
          'gis_officer role', 'Spatial data; map layers; cadastral management'),
        ('Surveyor', 'Land surveys for subdivision; boundary demarcation (ss.40,43)',
          'surveyor role', 'Survey records; subdivision boundary verification'),
        ('Citizen / Applicant\n(Owner, Developer)', 'Any person wishing to develop land; '
          'must apply for permits (ss.24,26,39)',
          'public, registered roles', 'Submit applications; track status; lodge appeals'),
        ('Surveyor-General', 'Approves survey records; amends general plans; '
          'manages road records (ss.40,42,43,55-58)',
          'External (system generates notifications)',
          'Survey approval; general plan amendments; road vesting'),
        ('Registrar of Deeds', 'Endorses title deeds with permits, enforcement orders, '
          'BPOs (ss.26(9),30(4),32(4-5))',
          'External (system generates copy documents for submission)',
          'Title deed endorsements; deeds registry management'),
        ('Administrative Court', 'Hears appeals; determines compensation; '
          'refers questions to Supreme Court (ss.38,44,53,59-62)',
          'External (system records appeal outcomes)',
          'Appeal determinations; compensation awards'),
        ('Investigator', 'Conducts local inquiries; reports to LPA or Minister (s.67)',
          'External (inquiry documents uploaded)',
          'Local inquiry conduct; reporting'),
        ('Executive Director of Museums', 'Must be consulted before BPO on non-monument buildings (s.30(1))',
          'External (system records consultation)',
          'Heritage assessment; BPO conditions'),
        ('Adjacent Property Owners /\nObjectors', 'Right to receive notice of applications; '
          'right to object within prescribed periods (ss.26(3-4),40(3-4))',
          'registered, public roles (objection portal)',
          'Lodge objections; attend local inquiries'),
    ]

    tbl2 = doc.add_table(rows=1, cols=4)
    tbl2.style = 'Table Grid'
    tbl2.autofit = False
    widths = [Cm(3.5), Cm(5.0), Cm(3.5), Cm(5.0)]
    for i, w in enumerate(widths):
        tbl2.columns[i].width = w
    for i, h in enumerate(actors_data[0]):
        tbl2.rows[0].cells[i].text = h
        set_cell_bg(tbl2.rows[0].cells[i], '0D2F61')
        for p in tbl2.rows[0].cells[i].paragraphs:
            for r in p.runs:
                r.font.bold = True; r.font.size = Pt(9)
                r.font.color.rgb = RGBColor(255,255,255)
    for row_data in actors_data[1:]:
        r = tbl2.add_row()
        for i, val in enumerate(row_data):
            r.cells[i].text = val
            for p in r.cells[i].paragraphs:
                for run in p.runs:
                    run.font.size = Pt(8.5)
    doc.add_paragraph()

    # ═══ SECTION 3 – USE CASES ═══════════════════════════════════
    doc.add_page_break()
    heading(doc, '3. Detailed Use Cases', 1)
    body(doc,
        'Each use case below corresponds to a distinct function mandated or permitted '
        'by the Act. The use cases are grouped by functional area and cross-referenced '
        'to Act sections and SpartialIQ implementation details.')

    # Group headers
    groups = [
        ('3.1 Development Control (Part V, Sections 22–38)',
         ['UC-01','UC-02','UC-03','UC-04','UC-05']),
        ('3.2 Subdivisions and Consolidations (Part VI, Sections 39–44)',
         ['UC-06']),
        ('3.3 Enforcement and Preservation Orders (Sections 30–37)',
         ['UC-07','UC-08','UC-09','UC-10']),
        ('3.4 Planning — Master, Local & Regional Plans (Parts II–IV)',
         ['UC-11','UC-12','UC-13','UC-14']),
        ('3.5 Land Acquisition, Compensation & Roads (Parts VII–IX)',
         ['UC-15','UC-16','UC-19']),
        ('3.6 Appeals, Inspections & Administration (Parts X–XI)',
         ['UC-17','UC-18','UC-20']),
    ]

    uc_map = {uc['id']: uc for uc in USE_CASES}

    for grp_title, uc_ids in groups:
        heading(doc, grp_title, 2, colour=C_TEAL)
        for uid in uc_ids:
            if uid in uc_map:
                uc_table(doc, uc_map[uid])
        doc.add_paragraph()

    # ═══ SECTION 4 – USE CASE DIAGRAMS ═══════════════════════════
    doc.add_page_break()
    heading(doc, '4. Use Case Diagrams', 1)
    body(doc,
        'The following UML-style use case diagrams illustrate the relationships between '
        'actors and use cases at the system level and for each major subsystem. '
        'Actors are shown as stick figures; use cases as ellipses inside the system boundary. '
        'Solid lines denote associations; dashed labelled arrows denote «include» or «extend» relationships.')

    heading(doc, '4.1 System-Level Use Case Diagram', 2)
    body(doc, 'Figure 1 shows all actors and their primary use cases across the entire RTCP Act system.')
    print('  Rendering Figure 1 (system UCD)...')
    add_image(doc, draw_system_ucd(), width_cm=17)
    doc.add_paragraph()

    heading(doc, '4.2 Development Control Subsystem', 2)
    body(doc,
        'Figure 2 details the development control process (Part V, ss.22–38): permit '
        'application, public notice, review, decision, enforcement, and appeals.')
    print('  Rendering Figure 2 (development control UCD)...')
    add_image(doc, draw_dev_control_ucd(), width_cm=16)
    doc.add_paragraph()

    heading(doc, '4.3 Planning Subsystem (Plans)', 2)
    body(doc,
        'Figure 3 covers the hierarchical plan-making process (Parts II–IV, ss.3–21): '
        'regional plans, master plans, and local plans including public consultation and approval.')
    print('  Rendering Figure 3 (plans UCD)...')
    add_image(doc, draw_plans_ucd(), width_cm=16)
    doc.add_paragraph()

    heading(doc, '4.4 Subdivision, Acquisition & Appeals Subsystem', 2)
    body(doc,
        'Figure 4 covers Parts VI–X: subdivision permits, land acquisition, '
        'compensation claims, appeals to the Administrative Court, and road management.')
    print('  Rendering Figure 4 (subdivision/appeals UCD)...')
    add_image(doc, draw_subdiv_appeals_ucd(), width_cm=16)
    doc.add_paragraph()

    # ═══ SECTION 5 – ERD ═════════════════════════════════════════
    doc.add_page_break()
    heading(doc, '5. Entity Relationship Diagram', 1)
    body(doc,
        'The ERD below models the full database schema required to implement '
        'the RTCP Act within SpartialIQ. Each entity corresponds to a PostgreSQL table. '
        'Primary keys (PK) are shown in gold; foreign keys (FK) in teal. '
        'Relationship cardinalities (1, M) are marked at each end of the relationship line.')

    print('  Rendering Figure 5 (ERD)...')
    add_image(doc, draw_erd(), width_cm=17)
    doc.add_paragraph()

    heading(doc, '5.1 Entity Descriptions', 2)
    entity_descs = [
        ('USERS', 'All system users: citizens, planners, inspectors, GIS officers, admins. '
          'Role field controls access. Linked to a ward.'),
        ('PROPERTY', 'Cadastral record of every land parcel (stand, erf, farm) within Vungu RDC jurisdiction. '
          'Includes PostGIS geometry, land use, and title deed reference.'),
        ('DEVELOPMENT_APPLICATIONS', 'Central table for all development permit and PPP applications (s.26). '
          'Covers new development, changes of use, advertisements, mining, and regularisation (s.27).'),
        ('PERMITS', 'Issued permits and PPPs. Linked to the originating application. '
          'Stores conditions, validity period, and Registrar of Deeds registration flag.'),
        ('SUBDIVISION_APPLICATIONS', 'Applications for subdivision, consolidation, or long-term lease '
          'agreements (Part VI, ss.39-41). Tracks Surveyor-General reference and set-aside land.'),
        ('ENFORCEMENT_ORDERS', 'All enforcement orders (s.32), prohibition orders (s.34), '
          'BPOs (s.30), and TPOs (s.31) issued against properties. Registered against title deeds.'),
        ('BUILDING_PRESERVATION_ORDERS', 'Detailed BPO records including museum consultation status, '
          'specific conditions, and status (active/cancelled/amended).'),
        ('TREE_PRESERVATION_ORDERS', 'TPO records for protected trees, forests, and woodlands '
          'with species/location descriptions.'),
        ('APPEALS', 'Appeals lodged with the Administrative Court. Polymorphic ref_type '
          'allows appeals against applications, permits, enforcement orders, BPOs, or TPOs.'),
        ('COMPENSATION_CLAIMS', 'Claims for compensation under Part VIII. Tracks claimed amount, '
          'awarded amount, and court reference if disputed.'),
        ('REGIONAL_PLANS', 'Regional plans prepared by Regional Planning Councils. '
          'Stored with document URL and operative status.'),
        ('MASTER_PLANS', 'Master plans prepared by the LPA (Vungu RDC). '
          'Must be submitted to and approved by the Minister. Spatial boundary stored in GIS.'),
        ('LOCAL_PLANS', 'Local plans that detail master plan proposals for specific sub-areas. '
          'Approved by LPA unless Minister intervenes. Linked to parent master plan.'),
        ('PUBLIC_NOTICES', 'Gazetting and newspaper notices required for applications, draft plans, '
          'and enforcement actions. Tracks publication date and objection deadline.'),
        ('OBJECTIONS', 'Objections and representations lodged by the public or adjacent owners '
          'against applications or draft plans. Tracks referral outcome.'),
        ('INSPECTIONS', 'Site inspection records created by building inspectors or environmental officers. '
          'Linked to applications or enforcement orders.'),
        ('APPLICATION_STATUS_HISTORY', 'Immutable audit trail of every status change on a '
          'development application (submitted → under_review → approved/rejected).'),
        ('WARDS', 'Administrative ward boundaries for Vungu RDC\'s 19 wards. '
          'Spatial geometry stored in PostGIS. Used to assign applications and staff.'),
    ]
    for ename, edesc in entity_descs:
        p = doc.add_paragraph()
        r1 = p.add_run(ename + ': ')
        r1.font.bold = True; r1.font.size = Pt(9.5)
        r2 = p.add_run(edesc)
        r2.font.size = Pt(9.5)
        p.paragraph_format.space_after = Pt(3)

    # ═══ SECTION 6 – COVERAGE MATRIX ════════════════════════════
    doc.add_page_break()
    heading(doc, '6. Act-to-System Coverage Matrix', 1)
    body(doc,
        'The following table maps every Part of the RTCP Act to the corresponding '
        'SpartialIQ module, use cases, and database entities, confirming that the '
        'system provides full statutory coverage.')

    matrix = [
        ('Act Part / Section', 'Subject', 'Use Case(s)', 'SpartialIQ Module', 'DB Entity'),
        ('Part I — s.2', 'Definitions & Interpretation', '—', 'Core (role model, property types)', 'USERS, PROPERTY'),
        ('Part II — ss.3-9', 'Regional Planning', 'UC-13', 'Plan Management', 'REGIONAL_PLANS'),
        ('Part III — ss.10-12', 'Local Planning Authorities', '—', 'User/Role Management', 'USERS'),
        ('Part IV — ss.13-21', 'Master & Local Plans', 'UC-11,12,14', 'Plan Management, GIS', 'MASTER_PLANS, LOCAL_PLANS'),
        ('Part V — ss.22-24', 'Development Control (definitions)', 'UC-01,05', 'Permit Applications', 'DEVELOPMENT_APPLICATIONS'),
        ('Part V — s.25', 'Development Orders', '—', 'Admin Config', 'master_plans (conditions)'),
        ('Part V — s.26', 'Application for Permit/PPP', 'UC-01,02,03,04', 'Permit Applications', 'DEVELOPMENT_APPLICATIONS, PERMITS'),
        ('Part V — s.27', 'Regularisation', 'UC-05', 'Permit Applications', 'DEVELOPMENT_APPLICATIONS'),
        ('Part V — s.28', 'State Development', '—', 'Exempt application type', 'DEVELOPMENT_APPLICATIONS'),
        ('Part V — s.29', 'Minister Call-In', 'UC-04', 'Escalation Workflow', 'DEVELOPMENT_APPLICATIONS'),
        ('Part V — s.30', 'Building Preservation Orders', 'UC-09', 'Heritage Management', 'BUILDING_PRESERVATION_ORDERS, ENFORCEMENT_ORDERS'),
        ('Part V — s.31', 'Tree Preservation Orders', 'UC-10', 'Environmental Management', 'TREE_PRESERVATION_ORDERS, ENFORCEMENT_ORDERS'),
        ('Part V — ss.32-33', 'Enforcement Orders', 'UC-07', 'Enforcement Module', 'ENFORCEMENT_ORDERS'),
        ('Part V — s.34', 'Prohibition Orders', 'UC-08', 'Enforcement Module', 'ENFORCEMENT_ORDERS'),
        ('Part V — ss.35-36', 'LPA Powers over Existing Dev.', 'UC-07', 'Enforcement Module', 'ENFORCEMENT_ORDERS'),
        ('Part V — s.37', 'Non-Compliance', 'UC-07', 'Enforcement + Legal', 'ENFORCEMENT_ORDERS'),
        ('Part V — s.38', 'Appeals (Part V)', 'UC-17', 'Appeals Module', 'APPEALS'),
        ('Part VI — ss.39-41', 'Subdivision/Consolidation', 'UC-06', 'Subdivision Module', 'SUBDIVISION_APPLICATIONS'),
        ('Part VI — s.42', 'Cancellation of General Plan', 'UC-06', 'GIS / Plan Management', 'LOCAL_PLANS, PROPERTY'),
        ('Part VI — s.44', 'Subdivision Appeals', 'UC-17', 'Appeals Module', 'APPEALS'),
        ('Part VII — ss.45-49', 'Land Acquisition', 'UC-15', 'Land Acquisition Module', 'PROPERTY, COMPENSATION_CLAIMS'),
        ('Part VIII — ss.50-53', 'Compensation', 'UC-16', 'Compensation Module', 'COMPENSATION_CLAIMS'),
        ('Part IX — ss.54-58', 'Roads', 'UC-19', 'GIS Roads Layer', 'PROPERTY, WARDS'),
        ('Part X — ss.59-62', 'Administrative Court', 'UC-17', 'Appeals Module', 'APPEALS'),
        ('Part XI — s.63', 'Director of Physical Planning', '—', 'Report generation', '—'),
        ('Part XI — s.65', 'Entry upon Property', 'UC-18', 'Inspections Module', 'INSPECTIONS'),
        ('Part XI — s.66', 'Development Account', 'UC-20', 'Finance Module', 'development_account_ledger'),
        ('Part XI — s.67', 'Local Inquiries', 'UC-11,12,17', 'Document Management', 'PUBLIC_NOTICES, OBJECTIONS'),
        ('Part XI — s.67A', 'Advisory Boards', 'UC-04,15', 'Escalation Workflow', '—'),
        ('Part XI — s.68', 'Minister Regulations', '—', 'System Config', '—'),
    ]

    tbl3 = doc.add_table(rows=1, cols=5)
    tbl3.style = 'Table Grid'
    tbl3.autofit = False
    col_ws = [Cm(3.0), Cm(3.5), Cm(2.5), Cm(3.5), Cm(4.5)]
    for i, w in enumerate(col_ws):
        tbl3.columns[i].width = w
    for i, h in enumerate(matrix[0]):
        tbl3.rows[0].cells[i].text = h
        set_cell_bg(tbl3.rows[0].cells[i], '0D2F61')
        for p in tbl3.rows[0].cells[i].paragraphs:
            for r in p.runs:
                r.font.bold = True; r.font.size = Pt(8)
                r.font.color.rgb = RGBColor(255,255,255)
    for ri, row_data in enumerate(matrix[1:]):
        r = tbl3.add_row()
        for i, val in enumerate(row_data):
            r.cells[i].text = val
            if ri % 2 == 0:
                set_cell_bg(r.cells[i], 'EFF2F8')
            for p in r.cells[i].paragraphs:
                for run in p.runs:
                    run.font.size = Pt(8)
    doc.add_paragraph()

    # ═══ SECTION 7 – SUMMARY ═════════════════════════════════════
    doc.add_page_break()
    heading(doc, '7. Summary and Recommendations', 1)
    body(doc,
        'The SpartialIQ platform, as currently designed for Vungu Rural District Council, '
        'provides a strong foundation for statutory compliance with the RTCP Act. '
        'The following areas are recommended for full compliance:')

    recs = [
        ('Development Account Module (s.66)', 'Implement a dedicated financial sub-ledger within SpartialIQ to '
          'track all subdivision levies, endowment moneys, and land sale proceeds. Restricted to prescribed uses.'),
        ('Heritage Protection Layer (s.30)', 'Create a dedicated "Heritage Buildings" PostGIS layer visible to all '
          'users. Any permit application on a property with an active BPO must trigger an automatic notification workflow '
          'to the Executive Director of Museums.'),
        ('Regional Plan Integration (ss.3-9)', 'Upload operative Regional Plans as spatial layers so that all '
          'development applications within the region are automatically checked for conformance.'),
        ('Deemed Refusal Auto-Trigger (s.26(7))', 'Implement a scheduled job that flags applications not decided '
          'within 3 months as "deemed refused" and automatically opens the appeal window.'),
        ('Registrar of Deeds Notification (ss.26(9),30(4),32(4))', 'Implement a formal notification workflow '
          'that generates a certified copy of each permit, BPO, or enforcement order for submission to the '
          'Registrar of Deeds, with a confirmation receipt recorded in the system.'),
        ('Public Objection Portal (ss.26(3),40(3))', 'Expose a public-facing objection portal where adjacent '
          'owners and members of the public can lodge objections electronically during the notice period, '
          'with automatic closure at the deadline.'),
        ('Subdivision Deadline Enforcement (s.40(9))', 'Auto-revoke subdivision permits where Surveyor-General '
          'survey records have not been submitted within the specified deadline.'),
        ('Local Inquiry Document Management (s.67)', 'Add a document management module for local inquiry reports '
          'so that investigator reports, LPA comments, and Minister responses are traceable and accessible '
          'to authorised users.'),
        ('Administrative Court Appeal Tracking (s.59)', 'Link appeals to specific orders/permits in the system. '
          'Track hearing dates, assessor panels, decisions, and any Supreme Court references (s.61).'),
        ('Multi-LPA Combination Support (s.10(2))', 'For future inter-authority planning initiatives, '
          'the system should support combination LPA configurations where two or more authorities share '
          'planning responsibilities for a defined area.'),
    ]

    for title, desc in recs:
        p = doc.add_paragraph()
        r1 = p.add_run(title + ': ')
        r1.font.bold = True; r1.font.size = Pt(10)
        r2 = p.add_run(desc)
        r2.font.size = Pt(10)
        p.paragraph_format.left_indent = Cm(0.5)
        p.paragraph_format.space_after = Pt(5)

    # ── Footer ────────────────────────────────────────────────────
    doc.add_paragraph()
    p_foot = doc.add_paragraph(
        'SpartialIQ — Vungu Rural District Council | RTCP Act [Chapter 29:12] Analysis | June 2026')
    p_foot.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for r in p_foot.runs:
        r.font.size = Pt(8); r.font.color.rgb = RGBColor(120,120,120)

    # ── Save ──────────────────────────────────────────────────────
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    doc.save(OUTPUT)
    print(f'\nSaved: {OUTPUT}')


if __name__ == '__main__':
    print('Building SpartialIQ RTCP Act document...')
    build_doc()
