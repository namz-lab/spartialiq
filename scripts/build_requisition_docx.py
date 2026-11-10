"""Build CLAUDE_ENTERPRISE_REQUISITION.docx from structured content."""

from docx import Document
from docx.shared import Pt, RGBColor, Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import copy

doc = Document()

# ── Page margins ──────────────────────────────────────────────────────────────
for section in doc.sections:
    section.top_margin    = Cm(2.5)
    section.bottom_margin = Cm(2.5)
    section.left_margin   = Cm(2.8)
    section.right_margin  = Cm(2.8)

# ── Colour palette ────────────────────────────────────────────────────────────
DARK_BLUE  = RGBColor(0x1A, 0x37, 0x5E)   # headings / header bar
MID_BLUE   = RGBColor(0x2E, 0x6D, 0xA4)   # sub-headings
ACCENT     = RGBColor(0x0E, 0xA5, 0xE9)   # table header fill text
TABLE_HDR  = RGBColor(0x1A, 0x37, 0x5E)   # table header bg
TABLE_ALT  = RGBColor(0xF0, 0xF5, 0xFA)   # alternating row bg
WHITE      = RGBColor(0xFF, 0xFF, 0xFF)
BODY_TEXT  = RGBColor(0x1E, 0x1E, 0x2E)
MUTED      = RGBColor(0x55, 0x65, 0x7A)

# ── Helper: set paragraph shading ─────────────────────────────────────────────
def shade_paragraph(para, hex_color: str):
    pPr = para._p.get_or_add_pPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_color)
    pPr.append(shd)

def shade_cell(cell, hex_color: str):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_color)
    tcPr.append(shd)

def set_cell_border(cell, **kwargs):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcBorders = OxmlElement('w:tcBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        if edge in kwargs:
            tag = OxmlElement(f'w:{edge}')
            for key, val in kwargs[edge].items():
                tag.set(qn(f'w:{key}'), val)
            tcBorders.append(tag)
    tcPr.append(tcBorders)

def no_border(cell):
    for edge in ('top', 'left', 'bottom', 'right'):
        set_cell_border(cell, **{edge: {'val': 'none', 'sz': '0', 'space': '0', 'color': 'auto'}})

# ── Helper: styled heading ─────────────────────────────────────────────────────
def add_h1(text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(18)
    p.paragraph_format.space_after  = Pt(4)
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(16)
    run.font.color.rgb = DARK_BLUE
    # bottom border
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '12')
    bottom.set(qn('w:space'), '1')
    bottom.set(qn('w:color'), '1A375E')
    pBdr.append(bottom)
    pPr.append(pBdr)
    return p

def add_h2(text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(12)
    p.paragraph_format.space_after  = Pt(2)
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(12)
    run.font.color.rgb = MID_BLUE
    return p

def add_body(text, bold_parts=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.space_before = Pt(0)
    if bold_parts:
        # bold_parts: list of (phrase, is_bold)
        for phrase, is_bold in bold_parts:
            run = p.add_run(phrase)
            run.bold = is_bold
            run.font.size = Pt(10.5)
            run.font.color.rgb = BODY_TEXT
    else:
        run = p.add_run(text)
        run.font.size = Pt(10.5)
        run.font.color.rgb = BODY_TEXT
    return p

def add_bullet(text, level=0):
    p = doc.add_paragraph(style='List Bullet')
    p.paragraph_format.space_after  = Pt(2)
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.left_indent  = Inches(0.3 + level * 0.25)
    run = p.add_run(text)
    run.font.size = Pt(10.5)
    run.font.color.rgb = BODY_TEXT
    return p

def add_numbered(text):
    p = doc.add_paragraph(style='List Number')
    p.paragraph_format.space_after  = Pt(3)
    p.paragraph_format.space_before = Pt(0)
    run = p.add_run(text)
    run.font.size = Pt(10.5)
    run.font.color.rgb = BODY_TEXT
    return p

def add_table(headers, rows, col_widths=None):
    t = doc.add_table(rows=1 + len(rows), cols=len(headers))
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.LEFT
    # header row
    hdr = t.rows[0]
    for i, h in enumerate(headers):
        cell = hdr.cells[i]
        shade_cell(cell, '1A375E')
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(3)
        p.paragraph_format.space_after  = Pt(3)
        run = p.add_run(h)
        run.bold = True
        run.font.size = Pt(9.5)
        run.font.color.rgb = WHITE
    # data rows
    for ri, row_data in enumerate(rows):
        row = t.rows[ri + 1]
        fill = 'F0F5FA' if ri % 2 == 0 else 'FFFFFF'
        for ci, cell_text in enumerate(row_data):
            cell = row.cells[ci]
            shade_cell(cell, fill)
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after  = Pt(2)
            run = p.add_run(str(cell_text))
            run.font.size = Pt(9.5)
            run.font.color.rgb = BODY_TEXT
    # column widths
    if col_widths:
        for ri2, row2 in enumerate(t.rows):
            for ci2, w in enumerate(col_widths):
                row2.cells[ci2].width = Inches(w)
    doc.add_paragraph()
    return t

# ══════════════════════════════════════════════════════════════════════════════
#  COVER HEADER BLOCK
# ══════════════════════════════════════════════════════════════════════════════
# Title banner paragraph
banner = doc.add_paragraph()
banner.paragraph_format.space_before = Pt(0)
banner.paragraph_format.space_after  = Pt(2)
shade_paragraph(banner, '1A375E')
r = banner.add_run('  REQUISITION FOR CLAUDE ENTERPRISE ACCOUNT')
r.bold = True
r.font.size = Pt(18)
r.font.color.rgb = WHITE

sub = doc.add_paragraph()
sub.paragraph_format.space_before = Pt(0)
sub.paragraph_format.space_after  = Pt(0)
shade_paragraph(sub, '2E6DA4')
r2 = sub.add_run('  SpartialIQ — Zimbabwe Multi-Council Digital Planning Portal')
r2.bold = True
r2.font.size = Pt(12)
r2.font.color.rgb = WHITE

doc.add_paragraph()

# Meta block
meta_rows = [
    ('Prepared by',  'Kedar Munyama (munyanamaz@gmail.com)'),
    ('Date',         '15 June 2026'),
    ('Repository',   r'c:\Users\munya\Desktop\finale  (branch: master)'),
    ('Account Type', 'Anthropic Claude Enterprise'),
]
mt = doc.add_table(rows=len(meta_rows), cols=2)
mt.style = 'Table Grid'
for i, (label, val) in enumerate(meta_rows):
    lc = mt.rows[i].cells[0]
    vc = mt.rows[i].cells[1]
    shade_cell(lc, 'E8EFF7')
    shade_cell(vc, 'FFFFFF')
    lc.width = Inches(1.8)
    vc.width = Inches(4.8)
    lp = lc.paragraphs[0]
    lp.paragraph_format.space_before = Pt(3)
    lp.paragraph_format.space_after  = Pt(3)
    lr = lp.add_run(label)
    lr.bold = True
    lr.font.size = Pt(10)
    lr.font.color.rgb = DARK_BLUE
    vp = vc.paragraphs[0]
    vp.paragraph_format.space_before = Pt(3)
    vp.paragraph_format.space_after  = Pt(3)
    vr = vp.add_run(val)
    vr.font.size = Pt(10)
    vr.font.color.rgb = BODY_TEXT

doc.add_paragraph()

# ══════════════════════════════════════════════════════════════════════════════
#  SECTION 1 — EXECUTIVE SUMMARY
# ══════════════════════════════════════════════════════════════════════════════
add_h1('1.  Executive Summary')
add_body(
    'SpartialIQ is a full-stack digital planning portal built to replace paper-based development '
    'control across multiple Zimbabwe local authorities. The system handles the complete lifecycle '
    'of a planning application — from citizen submission through statutory review, building '
    'inspections, fee payments, and certificate of occupation — serving eight distinct staff roles '
    'across multiple councils.'
)
add_body(
    'Development of this system has been conducted using Claude Code (Sonnet 4.6) as the primary '
    'AI-assisted engineering tool. This requisition formally requests an Anthropic Claude Enterprise '
    'account to continue and complete the project, given the scale of the remaining work and the '
    'loss of the development virtual machine environment.',
    bold_parts=[
        ('Development of this system has been conducted using ', False),
        ('Claude Code (Sonnet 4.6)', True),
        (' as the primary AI-assisted engineering tool. This requisition formally requests an ', False),
        ('Anthropic Claude Enterprise account', True),
        (' to continue and complete the project, given the scale of the remaining work and the '
         'loss of the development virtual machine environment.', False),
    ]
)

# ══════════════════════════════════════════════════════════════════════════════
#  SECTION 2 — WHAT HAS BEEN BUILT
# ══════════════════════════════════════════════════════════════════════════════
add_h1('2.  Project Status — What Has Been Built')

add_h2('2.1  Core Platform')
add_table(
    ['Layer', 'Technology', 'Status'],
    [
        ('Frontend',  'Vue 3 + Composition API + Pinia + MapLibre GL 4.7.1 + Vite',  'Deployed locally'),
        ('Backend',   'Fastify 5.7.1 + Node.js 20 LTS',                              'Deployed locally'),
        ('Database',  'PostgreSQL 14+ / PostGIS 3.3+',                               '80+ migrations written'),
        ('Auth',      'JWT HS256 (12h access / 14d refresh)',                         'Complete'),
        ('Maps',      'MVT/PBF tile pipeline via ST_AsMVT (24 PostGIS layers)',       'Complete'),
    ],
    col_widths=[1.2, 3.5, 1.9]
)

add_h2('2.2  Completed Features')

features = [
    ('Welcome Layer',
     '10-council Zimbabwe selector with province filter, animated branding, and council-gated '
     'routing enforced across the entire application.'),
    ('Authentication',
     'Full registration, login, invite system (8 staff roles), role-based portal redirect, '
     'refresh-token session management.'),
    ('Payment Gateways',
     'Paynow, EcoCash, OneMoney, and Stripe drivers with USSD display, webhook-driven '
     'confirmation, RBZ exchange-rate resolution (USD → ZWG), and outbox-pattern email receipts.'),
    ('Interactive Map',
     '24 PostGIS spatial layers served as binary vector tiles (MVT/PBF) to MapLibre GL; '
     'zoom-aware low-resolution filtering; LRU tile cache (4,000 tiles, 128 MB, 24h TTL); '
     'single-feature GeoJSON popup.'),
    ('Stands Layer',
     'Mutable stand polygons editable by planner/GIS officer; Register Stand and Edit Stand '
     'modals; status-coded fill colours; stand labels at zoom 14+; tile cache invalidation on '
     'mutation.'),
    ('Zones Layer',
     'Full CRUD for vungu_proposed_peri_urban_zones and zone_land_use_controls; EO Planner '
     'zones right-rail tab; management columns (zone_type, scale_category, is_active).'),
    ('Workflow Dashboard',
     'Real-time staff dashboard (/workflow) with application queue, status pipeline, and '
     'inspection panel. NOTE: currently reads the wrong DB table — see Section 3 P0.'),
    ('Application Tracking',
     'Citizen-facing 8-stage pipeline tracker with backend polling. NOTE: same table bug — '
     'see Section 3 P0.'),
    ('EO Planner Portal',
     'Most complete staff portal; all sections (intake, due diligence, technical circulation, '
     'public notification, objections, committee reports, permit drafting, enforcement) are '
     'fully wired to the backend.'),
    ('Building Inspector Portal',
     'Fully wired; 9-stage DM Handbook inspection API, checklist recording, photo upload, '
     'scoring breakdown, occupation certificate issuance.'),
    ('Planning Clerk Portal',
     'Dashboard, development register, application receipt, dispatch queue, refusal queue, '
     'enforcement view — all wired. Three sections remain as UI stubs only.'),
    ('Admin Panel',
     'User list, invite, suspend/activate, role edit, password reset, invite revocation — '
     'all wired to backend.'),
    ('HTTP Caching Middleware',
     'LRU server-side cache with tiered Cache-Control headers (tiles 24h, API 5min–1h).'),
    ('Document & KYC System',
     'Citizen upload, planning clerk verification queue, KYC submission and approval; '
     'SHA-256 deduplication; per-user 100 MB quota.'),
    ('Notification System',
     'Outbox-pattern email queue decoupled from API response time; 11 notification '
     'templates; in-app unread badge via polling.'),
    ('Security Hardening',
     'bcrypt-12 password hashing, rate limiting (global 100/min, auth 10/min), Fastify '
     'Helmet headers, full audit log (every authenticated mutation to security_audit_log), '
     'parameterised SQL throughout.'),
    ('Database Normalisation',
     '3NF migrations (078–080): ref tables, v_stands view, user_profiles table, '
     'stands_tile_view, zone_type_cache copy column with trigger.'),
    ('Production Deployment Guide',
     'docs/deployment/DEPLOYMENT.md covering NGINX, SSL, PM2, environment variables, migration order '
     '(80+ migrations), and spatial data import via ogr2ogr.'),
]
for title, desc in features:
    p = doc.add_paragraph(style='List Bullet')
    p.paragraph_format.space_after  = Pt(3)
    p.paragraph_format.space_before = Pt(0)
    r1 = p.add_run(title + ' — ')
    r1.bold = True
    r1.font.size = Pt(10.5)
    r1.font.color.rgb = DARK_BLUE
    r2 = p.add_run(desc)
    r2.font.size = Pt(10.5)
    r2.font.color.rgb = BODY_TEXT

# ══════════════════════════════════════════════════════════════════════════════
#  SECTION 3 — WHAT REMAINS
# ══════════════════════════════════════════════════════════════════════════════
doc.add_page_break()
add_h1('3.  What Remains — Prioritised Outstanding Work')

# P0
add_h2('P0 — Blocking (No End-to-End Data Flow Without These)')
add_body('These items must be resolved before any real permit can flow through the system.')
add_numbered(
    'Data-Split Bug (root cause) — The citizen submission flow writes to permit_applications; '
    'the Workflow Dashboard, Application Tracking view, and status-advance button all read from '
    'and write to development_applications (a separate, stale legacy table). Staff see nothing '
    'when a citizen submits. The citizen\'s own tracker always returns 404. Six specific '
    'file/line changes are required across two Vue views and one router file.'
)
add_numbered(
    'Planner Role Redirect — The planner role lands on the spatial map view (/planner) instead '
    'of the workflow workspace (/planner-workspace). A one-line router fix is required.'
)
add_numbered(
    'PostgreSQL Must Be Running — Without a live database every authenticated endpoint returns '
    'HTTP 500. Registration, login, permit submission, and tile generation all fail. '
    'Critically impacted by the loss of the development VM — see Section 5.'
)

# P1
add_h2('P1 — Backend Wiring for Remaining Staff Roles')
add_numbered(
    'Environmental Health Officer (EHO) Backend Link — The EHO portal currently runs entirely '
    'on local mock state. When a planner circulates a permit to department = environmental_health, '
    'the EHO portal must query the consultations endpoint and record clearance. Until wired, EHO '
    'decisions are not persisted and cannot gate permit advancement.'
)
add_numbered(
    'Surveyor Portal Backend Link — The surveyor portal also runs on local mock state. It must '
    'be connected to the consultations table, filtering permits at survey_review status. '
    'Cadastral sections (beacons, encroachments, setting-out) require schema decisions — '
    'either wire to backend tables or formally document as Phase 3.'
)
add_numbered(
    'Citizen Appeals Persistence — The "File appeal" button saves to localStorage only; appeals '
    'are lost on page refresh and invisible on other devices. Must be wired to a backend endpoint.'
)
add_numbered(
    'Planning Clerk Gaps — Three sections have UI without backend wiring: (a) "Mark as '
    'dispatched" button; (b) public notice form needs a POST endpoint; (c) payment link field '
    'requires autocomplete rather than manual UUID entry.'
)
add_numbered(
    'Document File Upload Completion — Document upload in the citizen 5-step wizard is '
    'stub-only (marks files as staged but uploads no bytes). Actual multipart upload must be wired.'
)
add_numbered(
    'Certificate Download — The occupation certificate view shows data but has no download '
    'endpoint. A PDF-generation or file-serve endpoint must be built.'
)

# P2
add_h2('P2 — Quality, Security, and Observability')
add_bullet('Re-lock /admin/land-use — the requiresAdmin guard is commented out; any authenticated user can reach the land-use management page.')
add_bullet('Security Dashboard — SecurityAuditService is disabled on the backend; the admin security page returns a placeholder. Must be re-enabled.')
add_bullet('QGIS Plugin Sync — the sync endpoint returns a placeholder because the service is disabled. Needed for GIS officer workflow.')
add_bullet('GIS Officer KPI Backend — the GIS Officer dashboard uses local-state composable. Decide whether to wire to backend tables or document as Phase 3.')
add_bullet('Offline Fallback Consistency — only the Planner and Inspector portals show labelled demo data when the API is unreachable. All other portals silently fail.')
add_bullet('Fee Auto-Reconcile — when a payment is confirmed, permit_applications.fee_paid should be set automatically via the webhook handler rather than requiring manual clerk input.')

# P3
add_h2('P3 — Deployment and Go-Live')
add_numbered('Run and verify migrations 077–080 against a clean PostgreSQL instance.')
add_numbered('Configure production environment variables (JWT_SECRET, payment keys, SMTP, CORS origins).')
add_numbered('Import zimbabwe.gpkg (24 spatial layers) via ogr2ogr; verify SRID 900914 → EPSG:3857 transform in tile pipeline.')
add_numbered('Configure NGINX reverse proxy, SSL certificates, PM2 process manager.')
add_numbered('End-to-end integration test of the full citizen → planner → EO → building inspector → certificate lifecycle with a live database.')

# ══════════════════════════════════════════════════════════════════════════════
#  SECTION 4 — WHY CLAUDE ENTERPRISE
# ══════════════════════════════════════════════════════════════════════════════
add_h1('4.  Why a Claude Enterprise Account Is Required')

add_h2('4.1  Codebase Scale')
add_body(
    'SpartialIQ is a large, tightly interlocked codebase. Productive engineering sessions require '
    'holding extensive context simultaneously — route files, view components, database schema, '
    'and migration state — to correctly diagnose bugs that span multiple layers.'
)
add_table(
    ['Layer', 'Volume'],
    [
        ('Frontend views',        '30+ Vue single-file components'),
        ('Pinia stores / composables', '10+ stores, 20+ composables'),
        ('Backend route files',   '25+ Fastify route modules'),
        ('Database migrations',   '80+ ordered SQL migration files'),
        ('Spatial layers',        '24 PostGIS tables from zimbabwe.gpkg'),
        ('API surface',           '60+ REST endpoints across 9 domain groups'),
        ('Staff role portals',    '8 distinct role-gated portals'),
        ('Documentation',         'System integration report (12 sections) + full user-flow testing audit (8 roles, 15 priority fixes)'),
    ],
    col_widths=[2.4, 4.2]
)

add_h2('4.2  Development Velocity')
add_body(
    'The outstanding work in Section 3 involves surgical fixes requiring simultaneous awareness of '
    'six interconnected files (P0 bug), backend wiring across three unstubbed portals, security '
    'and compliance fixes that must not introduce regressions, and a full production deployment '
    'sequence with 80+ ordered migrations.'
)
add_body(
    'Claude Code has already produced the integration report, the testing audit, and the completed '
    'features listed in Section 2. Continuing with the same tool and account tier is the most '
    'efficient path to project completion.'
)

add_h2('4.3  Access Continuity and Reliability')
add_body('A Claude Enterprise account provides:')
add_bullet('Higher usage limits to sustain long uninterrupted engineering sessions without hitting rate limits mid-task.')
add_bullet('Priority access during peak hours, critical when working to a deadline.')
add_bullet(
    'Larger context windows for sessions that require simultaneous awareness of multiple large '
    'files — e.g., fixing the P0 bug requires holding WorkflowDashboardView.vue (500+ lines), '
    'ApplicationTrackingView.vue (300+ lines), router/index.ts, the backend route catalogue, '
    'and the DB schema simultaneously.'
)
add_bullet('Organisation seat management for future collaboration if additional developers join the project.')

# ══════════════════════════════════════════════════════════════════════════════
#  SECTION 5 — LOSS OF VIRTUAL MACHINE
# ══════════════════════════════════════════════════════════════════════════════
doc.add_page_break()
add_h1('5.  Loss of Development Virtual Machine')

# Alert box
alert = doc.add_paragraph()
alert.paragraph_format.space_before = Pt(4)
alert.paragraph_format.space_after  = Pt(4)
shade_paragraph(alert, 'FFF3CD')
ar = alert.add_run(
    '  ⚠  CRITICAL: The virtual machine previously used for development is no longer '
    'accessible. All database-backed endpoints now return HTTP 500.'
)
ar.bold = True
ar.font.size = Pt(10.5)
ar.font.color.rgb = RGBColor(0x7D, 0x4E, 0x00)

add_body('The VM hosted the following development infrastructure:')
add_table(
    ['Asset', 'Status', 'Impact'],
    [
        ('PostgreSQL 14 / PostGIS 3.3 database\n(vungu_master_db_v1)',
         'LOST — VM inaccessible',
         'All authenticated endpoints return HTTP 500. No registration, login, permit submission, or map tile generation is possible.'),
        ('Applied migration state\n(migrations 000–076 confirmed; 077–080 unknown)',
         'LOST — must be re-applied',
         'A fresh PostgreSQL instance must be provisioned and all 80+ migrations run in sequence before any testing can resume.'),
        ('Imported spatial data\n(24 layers from zimbabwe.gpkg)',
         'LOST — must be re-imported',
         'The zimbabwe.gpkg file is kept at data/spatial/zimbabwe.gpkg. ogr2ogr import must be re-run after the database is restored.'),
        ('Test data\n(users, permits, payments, inspections)',
         'LOST — permanently',
         'All permit applications, payment records, and user accounts created during prior testing sessions are no longer accessible.'),
        ('Uploaded files\n(/uploads/ directory)',
         'LOST — permanently',
         'Citizen documents, building plan PDFs, and inspection photos uploaded during testing are not recoverable.'),
    ],
    col_widths=[1.8, 1.6, 3.2]
)

add_body(
    'This situation significantly increases the urgency of a stable, persistent development '
    'environment and reliable AI-assisted tooling to rebuild and re-verify the system state '
    'efficiently. Without a running database, none of the P0 fixes listed in Section 3 can be '
    'tested end-to-end until infrastructure is restored.'
)

# ══════════════════════════════════════════════════════════════════════════════
#  SECTION 6 — SUMMARY TABLE
# ══════════════════════════════════════════════════════════════════════════════
add_h1('6.  Summary and Request')
add_table(
    ['Item', 'Detail'],
    [
        ('Project',              'SpartialIQ — Zimbabwe multi-council digital planning portal'),
        ('Stack',                'Vue 3 / Fastify / PostgreSQL+PostGIS / MapLibre GL'),
        ('Completion estimate',  '~60% complete; P0–P2 work represents approximately 3–5 weeks of focused development'),
        ('Primary blockers',     'VM lost → no running database; P0 data-split bug prevents end-to-end permit flow'),
        ('AI tooling in use',    'Claude Code (Sonnet 4.6) for all AI-assisted engineering'),
        ('Account requested',    'Anthropic Claude Enterprise'),
        ('Justification',        'Codebase scale, context window requirements, development velocity, and continuity of an established AI-assisted workflow embedded in the project'),
    ],
    col_widths=[2.0, 4.6]
)

add_body(
    'We respectfully request that an Anthropic Claude Enterprise account be provisioned to '
    'support the completion and production deployment of SpartialIQ.'
)

# ── Footer line ───────────────────────────────────────────────────────────────
doc.add_paragraph()
footer_p = doc.add_paragraph()
footer_p.paragraph_format.space_before = Pt(12)
shade_paragraph(footer_p, '1A375E')
fr = footer_p.add_run('  SpartialIQ Engineering  ·  munyanamaz@gmail.com  ·  15 June 2026')
fr.font.size = Pt(9)
fr.font.color.rgb = WHITE

# ── Save ──────────────────────────────────────────────────────────────────────
out = r'c:\Users\munya\Desktop\finale\docs\CLAUDE_ENTERPRISE_REQUISITION.docx'
doc.save(out)
print(f'Saved: {out}')
