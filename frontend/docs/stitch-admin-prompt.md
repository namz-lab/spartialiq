# Stitch prompt — Vungu RDC IT Admin console (employee access & system configuration)

Source of truth: `src/views/AdminView.vue` (the 4-tab console shell, stats row, employee
table, org structure, activity log, system & integrations, and the invite/edit modal),
`src/components/shared/ProfileDropdown.vue` (the account chip), and the role taxonomy in
`src/services/types.ts`. Permissions/scope are documented in `docs/ADMIN.md`. The router
boundary (`ADMIN_BLOCKED` in `src/router/index.ts`) is why this console never links to
planning data.

Like the planner prompt, this one **locks the real visual language** — reproduce the existing
tokens, do not invent a new palette. Note the IT Admin console's primary buttons are **near-black
`#111827` pills**, not accent blue; the accent `#2563eb` is used for state, links and tints only.

---

## Prompt

Design an **internal IT-administration web application** (desktop, white page that scrolls
normally; sticky top navbar) — the **IT Admin console** for **Vungu Rural District Council**, a
Zimbabwean local authority. This is the tool the council's **IT desk** uses to provision staff
accounts and maintain system configuration. It is NOT a planning tool and NOT a marketing site:
the IT Admin manages *people, access and configuration* — they can never open planning cases,
map/GIS workspaces, citizen data, or analytics (separation of duties). The personality is
**trustworthy, calm, utilitarian, administrative** — no marketing language, no hero metrics, no
decoration. WCAG 2.1 AA throughout.

### App shell — stacked regions on a white page

**1. Top navbar** (white surface, 1px bottom hairline `#e2e8f0`, subtle shadow, ~4rem tall,
**sticky** to the top):
- Left: brand block — a 2rem rounded-square icon filled **near-black `#111827`** holding a white
  **shield-check** glyph; then two stacked lines: bold "Vungu Spatial Data Portal" (~1rem, color
  `#111827`) and a muted subtitle "IT Administration · Employee Access Management" (~0.69rem,
  `#6b7280`).
- Right (pushed with margin-left:auto), a row of controls:
  - **"Refresh"** — outline pill (white, 1px `#e2e8f0` border, `#374151` text) with a refresh-cw
    icon.
  - **"Website Content"** — outline pill with a globe icon (links to the public-site editor).
  - **"Invite Employee"** — **primary near-black `#111827` pill** with white text and a
    user-plus icon, a soft shadow `0 2px 8px rgba(17,24,39,0.28)`.
  - A **profile dropdown** chip: a rounded-pill outline holding a circular avatar (initials on a
    `#374151` fill), the label "IT Admin", and a chevron; clicking opens a small white dropdown
    card (account, then a red "Log out" row).

**2. Stats row** (max-width 1280px, centered, ~1.75rem top padding): an auto-fit grid (min 150px)
of **6 stat cards**. Each card is white, 1px hairline border, ~1rem radius, and holds a left
**tinted rounded-square icon** (its own hue), then a large bold number (~1.75rem, colored to match)
and a small muted label under it. The six, in order:
- "Total Employees" (users icon, blue `#2563eb` on `#eff6ff`)
- "Active" (user-check icon, green `#16a34a` on `#f0fdf4`)
- "Pending Invites" (mail-open icon, amber `#f59e0b` on `#fffbeb`)
- "Suspended" (user-x icon, red `#ef4444` on `#fef2f2`)
- "IT Admins" (key-round icon, violet `#7c3aed` on `#f5f3ff`)
- "Planners" (map icon, cyan `#0891b2` on `#ecfeff`)

**3. Tab bar** (max-width 1280px, centered, sits on a 1px bottom hairline): four **pill-top tabs**
(rounded only at the top), each an icon + label; the active tab is a white chip whose bottom edge
merges into the content below (border `#e2e8f0` with a white bottom border), inactive tabs are
muted `#64748b` and tint `#f8fafc` on hover. The first tab carries a small near-black **count
badge**. The four tabs, in order — and these labels are deliberate (this console's whole scope):
1. **Employee Accounts** (users icon) — badge = employee count
2. **Org Structure** (building icon)
3. **Activity Log** (clipboard-list icon)
4. **System & Integrations** (settings icon)

Design **all four tab panels** as fully realised screens. Below, each in detail.

### Tab 1 — Employee Accounts (PRIMARY screen)
A toolbar over a single full-width table card.

**Toolbar** (wraps on narrow widths):
- Left: a **search field** — a rounded-pill input on `#f8fafc` with a leading search icon,
  placeholder "Search name, email, role…".
- Then a **status filter chip-row**: "All", "Active", "Pending", "Suspended". The active chip is
  a solid near-black `#111827` fill with white text; others are white outline pills.
- Pushed to the far right (margin-left:auto): a **role filter chip-row**: "All Roles", then one
  short chip per assignable staff role — "Planner", "EO", "EHO", "Inspector", "Clerk",
  "Surveyor", "GIS", "Viewer", "Admin".

**Table card** (white, hairline border, ~1rem radius, overflow hidden). A `#f8fafc` header row
with uppercase ~0.69rem muted column labels; body rows hover to a faint `#f8fafc` tint. Columns:
- **Employee** — a circular avatar (two-letter initials on a per-name color from a fixed palette)
  beside a stacked bold name (`#0f172a`) + muted email (`#64748b`).
- **Job Title / Department** — a `#374151` job title over a muted `#94a3b8` department line.
- **System Role** — a **role badge** pill (soft tinted background, bold colored text), one tint
  per role: Admin blue `#2563eb`/`#eff6ff`, Planner violet `#7c3aed`/`#f5f3ff`, Viewer green
  `#16a34a`/`#f0fdf4`, EO indigo `#4f46e5`/`#eef2ff`, EHO emerald `#059669`/`#ecfdf5`, Inspector
  amber `#d97706`/`#fffbeb`, Clerk cyan `#0891b2`/`#ecfeff`, Surveyor rose `#e11d48`/`#fff1f2`,
  GIS teal `#0d9488`/`#f0fdfa`.
- **Status** — a pill with a leading status dot: Active green, Pending amber, Suspended red (each
  a soft tinted fill).
- **Last Active** and **Invited** — small muted `#94a3b8` date metadata.
- **Actions** (centered) — a row of small ghost icon-buttons: edit (pencil); resend invite (send,
  only on pending rows); suspend (user-x, red hover) on active rows OR reactivate (user-check,
  green hover) on suspended rows; remove (trash, red hover). Include an empty-state row "No users
  match the current filters." spanning all columns.

### Tab 2 — Org Structure
- A small uppercase section title "Organisation Structure — Planning & Environment Department".
- An **org tree** card (white, hairline, centered): stacked levels connected by thin 1px vertical
  connector lines. Top a **CEO node** (accent-blue tinted, role badge "IT Admin"); below an
  **E.O. Planning & Environment** node (violet tinted, "Planner" badge); then two rows of
  officer nodes (Planning Officer, Environment Technician, GIS Officer, Building Inspector,
  Planning Clerk, Surveyor) — each a small rounded `#f8fafc` card with an uppercase role line, a
  bold name, and a role badge. **Vacant** posts render dimmed with an italic "VACANT" name and a
  neutral "Vacant" badge.
- A **Role Access Legend** below: an auto-fit grid (min 220px) of white cards, one per assignable
  staff role. Each card: a line icon, the role badge, then a list of permission rows — each a
  small **dot (green = granted, grey = denied)** beside a permission label (e.g. for Planner:
  "Open planning cases ✓", "Map workspace & analytics ✓", "Approve / reject applications ✓",
  "Manage users ✗"; for IT Admin: "Invite & manage employees ✓", "Assign staff roles ✓", "Edit
  content & config ✓", "Open planning cases ✗", "View planning analytics ✗").

### Tab 3 — Activity Log
- Section title "Recent System Activity".
- A vertical list of **activity rows** — each a white hairline card with a left tinted
  rounded-square icon, a bold message line ("Invite sent to …", "Role updated for …", "…
  suspended"), a muted timestamp under it, and a right-aligned uppercase **type pill** (invite =
  blue, signup = green, edit = amber, system = violet). Include a calm empty state for when no
  actions have happened this session.

### Tab 4 — System & Integrations
- Section title "System Information".
- A **sys grid** (auto-fit, min 180px) of white cards, each: a line icon, an uppercase muted
  label, a bold value, and an optional muted sub-line. The cards: "Active Sessions" (N users,
  "Online now"), "Pending Invites" (N invites, "Awaiting sign-up"), "Auth Storage" ("PostgreSQL",
  "spatial_planning + public schemas"), "Auth Mode" ("JWT + bcrypt", "Backend-issued tokens"),
  "Frontend Version" ("v1.0.0-alpha", "Vungu RDC Portal"), "Session Date" (today's date).
- Then a "Pending Invites" sub-section: a table card with columns Email · Role (role badge) · Job
  Title · Created · Status (a pending/used pill). Empty state "No invites stored yet." Note: this
  list is backend-sourced — there is **no localStorage** anywhere in this console.

### Overlay — Invite / Edit Employee modal (design this in full)
A centered modal over a blurred `rgba(15,23,42,0.55)` backdrop; white card, ~1.25rem radius,
max-width ~540px, max-height 90vh scrolling, generous padding.
- **Header**: a `#f8fafc` rounded-square icon (mail icon for invite, pencil for edit), a bold
  title ("Invite Employee" / "Edit Employee") + a muted one-line subtitle, and a top-right × close.
- **Form**:
  - A two-up field row: **"Job Title *"** text input ("e.g. Planning Officer") and **"Department"**
    select (Planning & Environment, Finance, Engineering, Health Services, Administration, IT).
  - **"Work Email Address *"** input ("employee@vungurdc.gov.zw") with a hint "The invite link will
    be sent to this address." (disabled when editing).
  - **"System Role *"** — a **role-card picker**: a 3-column grid of selectable cards, one per
    **assignable staff role** (Planner, EO Planner, Environmental Health Officer, Building
    Inspector, Planning Clerk, Surveyor, GIS Officer, Viewer, IT Admin). Each card is a `#f8fafc`
    rounded tile with a centered line icon, a bold role name, and a small muted one-line
    description (e.g. "Town Planning Officer — handles development applications end to end"). The
    selected card gets a near-black `#111827` 2px border, white fill, and a faint focus ring.
  - Directly under the picker, a **"System-only · not assignable"** strip separated by a dashed
    top hairline: a small lock icon + label, then **disabled dashed chips** for the citizen/system
    roles "Citizen", "Registered", "Public" — visibly greyed-out to make the boundary explicit
    (these are never assignable by the IT Admin).
  - A **permissions preview** panel (`#f8fafc`, hairline): "Access for **<role>**" then the
    selected role's permission rows (granted/denied dots + labels), updating live with the
    selection.
  - **Actions** row (right-aligned, top hairline): a "Cancel" outline button and a primary
    near-black "Send Invite" / "Save Changes" button.

### Overlay — Invite Link modal (design it)
A smaller centered modal (max-width ~440px): header with a link icon and "Invite Link Ready", a
**monospace link box** on `#f8fafc` holding the single-use URL with a near-black "Copy" pill, a
hint paragraph ("The employee opens this link, enters their full name and sets a password to
activate their account. The link expires once used."), and a primary "Done" button.

### Overlay — Remove User confirm (design it)
A small modal with a **red-tinted** warning icon, title "Remove User", subtitle "This permanently
revokes all access.", a sentence naming the user + email, then "Cancel" (outline) and a red
"Remove" button.

### Toast
A bottom-center floating pill toast (near-black for success, amber for warnings, red tint for
errors) that slides up.

### Visual language — REPRODUCE these exact tokens (do not invent a new palette)
- **Light, administrative theme.** Page background pure white `#ffffff`; cards white; surfaces &
  input fills `#f8fafc`; hairline borders `#e2e8f0`.
- **Text**: near-black `#0f172a`/`#111827` for headings & values; slate `#374151`/`#64748b` for
  body & labels; muted `#94a3b8` for metadata/captions.
- **Primary action = near-black `#111827` pill** with white text and a soft shadow (this is the
  signature of the admin console — Invite Employee, Copy, Save, Send). Hover darkens to `#1e293b`
  and lifts 1px.
- **Accent = blue `#2563eb`** — used only for state, links, the brand-adjacent tints and the
  focus ring; it is NOT the primary button color. Keep it disciplined.
- **Role badge tints** (soft bg + bold text), one per role as listed in Tab 1. **Citizen/system
  roles** are neutral slate `#64748b` on `#f1f5f9` and shown only as disabled chips.
- **Status semantics** (AA-legible): green `#16a34a` = active/granted; amber `#f59e0b` =
  pending/caution; red `#ef4444`/`#dc2626` = suspended/remove/error. Pills use a soft tint fill;
  status dots are `currentColor`.
- **Pills everywhere** — buttons, chips, badges, filters all use the `9999px` pill radius. Cards
  use ~0.75–1rem radius; inputs ~0.625rem.
- **Restrained shadow** (`0 1px 4px rgba(0,0,0,0.06)` on the navbar, `0 4px 16px rgba(0,0,0,0.07)`
  on card hover); no heavy drop shadows.
- **Icons**: thin line icons (Lucide-style).
- **Type scale**: section titles ~0.69rem uppercase tracked muted; table headers ~0.69rem
  uppercase; body ~0.875rem; KPI numbers ~1.75rem. Use a system UI font stack.
- **Accessibility**: WCAG 2.1 AA contrast, visible focus states, real table semantics.

Keep the information architecture, tab names, column labels, role names and copy exactly as
specified. Deliver clean semantic HTML + CSS, responsive down to ~900px (the stats and sys grids
reflow, the toolbar wraps, the table becomes horizontally scrollable). Do **not** add any planning,
map, analytics, or citizen-facing surface — this console is strictly staff accounts + configuration
(separation of duties). Do not invent extra branding, taglines, imagery, or colours beyond the
accent + status palette above.
