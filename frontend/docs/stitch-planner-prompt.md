# Stitch prompt — Vungu RDC Town Planning Officer workspace (planner app)

Source of truth: `src/views/planner/PlannerShell.vue`, `src/views/PlannerWorkspaceView.vue`,
`src/views/planner/sections/DashboardSection.vue`, `src/views/planner/StatutoryShell.vue` +
`StatutoryStepper.vue`, and the section components under `src/views/planner/sections/`.
The **Map pane** mirrors `src/views/planner/VunguPlannerView.vue` (three-pane GIS workspace) with
`src/components/MapLayerFilters.vue` + `src/components/MapLegend.vue` and the basemap cartography in
`src/map/vunguBasemap.ts` / `vunguBasemapStyle.ts`.

Unlike the public-site prompts, this one **locks the real visual language** — the user asked
for something "exactly like" the planner app, so Stitch should reproduce the existing tokens,
not invent a new palette.

---

## Prompt

Design an **internal staff web application** (desktop, fixed-height app shell, 100vh, no page
scroll on the shell) — the **Town Planning Officer workspace** for **Vungu Rural District
Council**, a Zimbabwean local authority. This is a dense, professional government case-management
tool used by a planning officer to run development applications through the statutory Section 26
workflow under the RTCP Act [Ch. 29:12]. It is NOT a marketing site or a consumer dashboard:
the personality is **precise, calm, utilitarian, information-rich**. No marketing language, no
hero metrics, no decoration. WCAG 2.1 AA throughout.

### App shell — three stacked regions

**1. Top chrome bar** (white surface, 1px bottom hairline, subtle shadow, ~52px):
- Left: brand block — a 1.85rem rounded-square icon in the **accent blue** holding a white
  gavel glyph; then two stacked lines: bold "Town Planning Officer" (~13px) and a muted
  subtitle "Vungu RDC · RTCP Act [Ch. 29:12]" (~10px).
- A segmented **pane switcher** (a pill-group on a light slate track): two tabs "Map" (map
  icon) and "Console" (gavel icon); the active tab is a white chip with accent-blue text and a
  faint shadow.
- Far right (pushed with margin-left:auto): a **sync status pill** — a rounded chip showing one
  of three states with an icon + label: "Saved" (cloud icon, green tint), "Syncing…" (upload
  icon, blue tint), or "Offline — saved locally" (wifi-off icon, red tint).
- Then a **profile dropdown** chip labelled "Town Planning Officer" with an avatar.

**2. The shell hosts two panes** (only one visible at a time; the pane switcher in the chrome bar
toggles between them, and they share ONE case context — a stand picked on the map flows straight
into the Console's Statutory Workflow):
- **Map pane** — the full GIS workspace (a three-pane spatial console). **Design this in full —
  it is a second primary screen, not a placeholder.** Detailed below under "First screen — Map
  pane (GIS workspace)".
- **Console pane** — the case-management screen. Detailed below under "Console pane".

Design **both** the Map pane and the Console pane (plus the Console's Statutory Workflow screen)
as fully realised screens at equal fidelity.

### First screen — Map pane (GIS workspace)
A dense three-pane spatial console that fills the shell body below the chrome bar. Top toolbar
strip, then three columns: a **left data/layer sidebar**, a **centre map canvas**, and a **right
information/workflow sidebar**. Both sidebars are independently collapsible (a small chevron
toggle on the inner edge; collapsed = a thin spine). Same light, utilitarian tokens as the
Console — no new palette.

**Map toolbar** (white strip, hairline bottom):
- A **Google-Maps-style search field** on the left: a search icon, an input placeholder
  "Search Vungu RDC", and a clear (×) button when populated. Focused, it drops a **typeahead
  panel** of result rows — each row is a small type-tinted icon, a bold label (with the matched
  substring emphasised), and a muted subtitle/type ("Ward", "Stand", "Road", "Place"). Show a
  "Searching…" spinner row and a "No results for …" empty row as states.
- A **draw-tool toolbar** on the right: a row of small icon+label buttons — Select (cursor),
  Measure distance (ruler), Polygon (pen), Point (dot). The active tool is an accent-blue chip.

**Left sidebar — Data & layers** (~15rem white column, scrolls; each block is a titled section
with a small leading icon):
- **Ward selector** (navigation icon) — a `<select>` "— All wards (N) —" listing the council's
  wards; choosing one flies the map there. Below it, a full-width accent **"Register new
  application"** action button (plus icon) with a two-line label ("Register new application /
  Opens Step 1 in the Planner Console").
- **Layer Switcher** (layers icon, with a faint "loading…" badge while fetching) — a checkbox
  list of PostGIS spatial layers. Each row: a checkbox, a **colour dot** (the layer's cartographic
  colour), a two-line name + description, and a right-aligned geometry-type badge ("Polygon",
  "Line", "Point", "WMS") tinted in the layer colour. The active rows get a faint tint. Below the
  list, one **opacity slider row per active layer** (layer name · range slider · "80%" value).
- **QGIS Server** (server icon) — a URL input + "Connect" button; on success, an "Available
  Layers (N)" checkbox list to overlay WMS layers. Show an inline error string on failure.

**Centre — map canvas** (full-bleed warm basemap, the visual focus):
- A **Google-Maps-style basemap**: warm off-white land, a road hierarchy by `fclass` (motorway →
  residential), landuse classes (greens for parks/forest, etc.), per-province fills, **ward
  boundary** lines, and parcels/stands — with a calm label hierarchy. This is cartographic colour,
  a separate taxonomy from the UI accent; let it be the one colourful surface.
- **Top-left overlay**: a floating **layer-filter chip panel** (toggle chips whose swatch colour
  matches each layer) and, when a draw tool is armed, a **tool-status pill** (tool icon + hint +
  a "× Cancel" button).
- **In-canvas readouts** as small floating chips: a polygon-in-progress hint ("N vertices —
  double-click to close"); a completed-polygon **stats chip** ("2.41 ha · 24,100 m² · 620 m
  perimeter" with a clear ×); a **measure readout** ("ruler · 1.2 km"); a loading overlay
  ("Loading spatial data…" with a spinner).
- **Bottom-right zoom controls**: a vertical stack of square buttons — zoom in (+), zoom out (−),
  reset view (home), fit all layers (maximize).
- A **map legend / key** card (bottom area) and a **coordinate status bar** along the bottom edge:
  cursor lng/lat ("29.8167° E, 19.4500° S"), current zoom, "CRS: EPSG:4326", "<layer> selected"
  when a feature is picked, and an "<tool> active" hint.

**Right sidebar — Information & workflow** (~16rem white column). A **tab row** of 4 tabs (each
icon + label) over a scrolling tab body. All tabs are **driven by the feature selected on the
map** — show a centered empty state (faint icon + one line, e.g. "Click a feature on the map to
view its properties") when nothing is selected. The tabs:
- **Plot** (map-pin) — selected-feature detail: a header with the layer name and a small "GIS"
  status chip, then a "Feature Properties" key→value grid (from the GeoJSON attributes) and a
  "Geometry Info" grid (Layer · Type · click coordinate).
- **Permits** (file-text) — "Permits for this stand" card listing live records pulled from the
  Development Register (monospace register no · applicant · status pill · development type), with
  a record count and empty copy. Below it, a primary **"Open in Planner Console"** action ("Drill
  into the Section 26 workflow for this stand", with a right-chevron).
- **Checks** (shield-check) — "Due-diligence at a glance" checklist with pass/fail/na rows
  (permits on file, approved permits, active enforcement orders, prohibition orders in force,
  each with a tick / warning / dash icon). A "Statutory context to verify" todo card (Master/Local
  Plan use class, setbacks, sensitive sites, title-deed restrictions). Then two actions: "Use
  abutting owners (100 m)" (buffers the stand and fills Step 5 notice recipients) and "Full
  due-diligence checklist" (Step 2).
- **Tools** (ruler) — a **sub-tab strip** (Draw · Buffer · Coords · View · Export) over a small
  tool pane:
  - *Draw*: a 2×2 grid of tool buttons (Distance, Polygon, Point, Select) + a danger "Clear all
    drawings".
  - *Buffer*: a distance input (m) + "Apply", a **"Statutory setbacks"** preset row (Front 6 m,
    Side 7.5 m, Road 5 m, Primary road 30 m, Borehole 15 m, Wetland 30 m, River 50 m — each a
    small chip, tooltip cites the Act) and a free-form row (100 m, 250 m), plus "Clear active
    buffer".
  - *Coords*: a cursor read-out with a copy button, and a "lat, lng" go-to input + "Go".
  - *View*: Reset · Fit all · Locate me (GPS).
  - *Export*: PNG snapshot · Print view · Site report (PDF, needs a selection) · Drawings
    (GeoJSON).
  - A footer primary action **"Planner Console / Register · enforcement · reports"** (gavel,
    right-chevron) that switches to the Console pane.

Selecting a stand on the map (or "Register new application" / "Open in Planner Console") seeds the
shared case and jumps to the Console's **Statutory Workflow**.

### Console pane (PRIMARY SCREEN to design)
A secondary header + a left nav rail + a content area.

**Console header** (white, hairline bottom): a small square icon-button (menu/collapse toggle),
then a vertical divider, then the active section title with its icon and a muted one-line
description, e.g. "Dashboard — Workload overview & deadlines".

**Left nav rail** (~14rem wide, white, 1px right border, collapsible to a 3rem icon-only rail):
a vertical list of 7 items, each an icon + label. The active item is a **solid accent-blue
fill with white text**; hover is a faint slate tint. Items in order:
1. Dashboard (layout-dashboard icon) — Workload overview & deadlines
2. Statutory Workflow (gavel) — Section 26 intake → permit issue
3. Permit Register (file-text) — All applications & permits
4. Enforcement (shield-alert) — Stop work / prohibition orders
5. Building Plans (building) — Plans queue & appraisal
6. Reports & Returns (bar-chart) — Quarterly aggregates & exports
7. Reference (book-open) — Use Classes, Acts, fees, wards

**Content area** (calm slate background `#f1f5f9`, scrolls independently) — show the **Dashboard**:
- Header row: bold "Today's planning workload" + a small outline "Refresh" button (refresh icon).
- **KPI row** — an auto-fit grid of 4 white cards (min 220px, hairline border, ~0.5rem radius).
  Each card: a line icon on the left (coloured per status), a large bold number, a small muted
  label below, and a faint right-chevron. The four:
  - "Active permits" (file icon, accent blue)
  - "Approved (incl. conditional)" (file icon, green)
  - "Open enforcement orders" (shield-alert icon, red)
  - "Cases with deadline pressure" (clock icon, amber)
- **Card grid** below — an auto-fit grid (min 360px) of white cards, each with a tinted
  (`#f8fafc`) header strip carrying a small icon, a bold title, and a muted right-aligned
  caption:
  - **"Statutory timeline performance"** (SLA summary) — a few compact metrics / mini-gauges on
    how cases track against the statutory clock.
  - **"Deadlines watchlist — Permits within statutory danger zone"** — a list of rows; each row
    is a grid: a coloured rounded **day pill** ("76d", or "DUE" in red), a monospace register
    number, the applicant name, and a muted "stand · ward". Critical rows have a faint red
    background, urgent rows a faint amber background.
  - **"Recent applications — Last 6 registrations"** — rows of: monospace id, applicant name, an
    uppercase accent-blue status label, and a muted date.
  - **"Permit register by status"** — a horizontal **bar-chart list**: each row is a status
    label, a thin track with an accent-blue fill bar, and a right-aligned count.
  - **"Common actions — Jump to a planner duty"** — a vertical list of outline buttons, each a
    small icon + bold title + muted subtitle: "Register a new application / Intake → Section 26
    workflow"; "Appraise building plans / Plans queue per permit"; "Issue enforcement /
    prohibition order / Stop-work + compliance"; "Generate quarterly returns / Aggregate stats
    for province"; "Look up Use Class / Act / Statutory reference library"; "Open a property
    file / Parcel record, owners, zoning & history"; "Ad-hoc report builder / Filter the
    register & export CSV".

### Second screen — Statutory Workflow (the Section 26 case workflow)
A two-region layout inside the console content area:
- A **statutory clock banner** across the top: a 90-day countdown for the active case (received
  date → statutory decision deadline), turning amber then red as the deadline nears.
- A **vertical 5-step stepper rail** on the left: each step is a card with a circular status dot
  (a green check for done, the **accent-blue numbered dot** for the available/active step, a
  grey lock for locked steps), the step title, a small "X/Y" progress chip, a blue next-action
  line, and a thin progress bar. The active step expands to show its subtasks (tiny check /
  empty-circle rows). Locked steps are dimmed with a "No active case" reason. The five steps in
  order:
  1. **Intake** — next action "Register the application"
  2. **Due Diligence**
  3. **Committee Report** — next action "Record committee resolution"
  4. **Permit** — next action "Draft & issue the permit"
  5. **Notices** — next action "Issue acknowledgement & notices"
- A **case-file drawer** (toggleable side panel) holding the current application's details, and
  the step's working form to the right of the rail.

### Visual language — REPRODUCE these exact tokens (do not invent a new palette)
- **Light, utilitarian theme.** App background slate `#f1f5f9`; cards pure white `#fff`;
  hairline borders `#e2e8f0`; tinted card-header strips `#f8fafc`.
- **Text**: near-black `#0f172a` for headings/values, slate `#475569` for body, muted
  `#64748b`/`#94a3b8` for captions and metadata.
- **One accent — royal blue `#1d4ed8`** (active nav fill, KPI primary icon, status labels,
  links, progress-bar fills, the available step dot, brand icon). Keep it disciplined; it marks
  state and primary actions only.
- **Status semantics** (each AA-legible): green `#16a34a` = done / approved; red `#dc2626` =
  critical / enforcement / DUE; amber/orange `#b45309`–`#c2410c` = caution / urgent. Pills use a
  solid fill with white text; row backgrounds use a 5–8% tint of the same hue.
- **Compact and dense.** Small type (labels ~0.7rem, body ~0.78rem, KPI numbers ~1.4rem),
  tight padding, lots of information per screen — this is a power-user tool, not a spacious
  marketing page. Use **monospace** for case/register references.
- **Radii** ~0.4–0.5rem everywhere; **restrained shadow** (`0 1px 2px rgba(15,23,42,0.04)`),
  no heavy drop shadows.
- **Icons**: thin line icons (Lucide-style).
- **Accessibility**: WCAG 2.1 AA contrast; visible focus states.

Keep the information architecture, section names, labels, and copy exactly as specified above.
Deliver clean semantic HTML + CSS, responsive down to ~900px: on the Console the nav rail
collapses to its icon-only rail and the section title hides; on the Map pane the left and right
sidebars collapse to thin spines, leaving the canvas full-width. The only colourful surface is the
map's cartographic basemap (its own taxonomy) — everywhere else, do not invent extra branding,
taglines, or imagery, and do not add colours beyond the accent + status palette above.
