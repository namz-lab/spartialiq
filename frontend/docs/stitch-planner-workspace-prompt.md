# Stitch prompt — Vungu RDC Town Planning Officer workspace redesign

Source of truth: `src/views/planner/PlannerShell.vue` + `src/views/PlannerWorkspaceView.vue`
+ `src/views/planner/sections/DashboardSection.vue`.
Paste the block below into Google Stitch. It reproduces the real information architecture,
sections, and content, but deliberately leaves the **visual language open** — Stitch should
propose a fresh, modern palette, typography, and spacing within the civic guardrails below.

---

## Prompt

Design a desktop web app screen: the **Town Planning Officer workspace** for **Vungu Rural
District Council**, a Zimbabwean local-government planning authority operating under the
RTCP Act [Chapter 29:12]. This is a professional civic case-management console for a trained
planning officer, not a marketing site or a SaaS dashboard — the personality is
**trustworthy, calm, and confident without decoration**. No marketing language, no
exclamation marks, no hero metrics, no gradients-for-show. WCAG 2.1 AA contrast throughout.

### Layout — fixed-height app shell (100vh, no page scroll on the shell)
Three regions:
1. **Top header bar** (clean surface, 1px bottom hairline border, subtle shadow), height ~48px:
   - Brand block: a ~30px rounded-square icon in the **primary accent** with a white
     civic-building glyph, then two stacked lines — bold "Town Planning Officer" (~13px)
     and a muted subtitle "Vungu RDC · RTCP Act [Ch. 29:12]" (~10px).
   - A **segmented two-tab switch** labelled "Map" (map icon) and "Console" (gavel icon) —
     the officer flips between a full-screen GIS map and this console. "Console" is active.
   - A quiet link-style button "Statutory" with a civic-building icon.
   - A small **sync status chip** with icon + label, three states: "Saved" (cloud icon,
     neutral), "Syncing…" (upload icon), "Offline — saved locally" (wifi-off icon, warning
     treatment). Show the "Saved" state.
   - Far right: a profile dropdown chip labelled "Town Planning Officer" with an avatar.
2. **Left sidebar nav** (~220px wide, 1px right border, collapsible to an icon rail):
   a vertical list of 7 items, each an icon + label + tiny muted description line. The active
   item is clearly emphasised (solid **primary accent** fill or an equivalently strong
   treatment of your choosing); hover is a soft accent-tinted state. Items in order:
   - **Dashboard** — Workload overview & deadlines (active)
   - **Statutory Workflow** — Section 26 intake → permit issue
   - **Permit Register** — All applications & permits
   - **Enforcement** — Stop work / prohibition orders
   - **Building Plans** — Plans queue & appraisal
   - **Reports & Returns** — Quarterly aggregates & exports
   - **Reference** — Use Classes, Acts, fees, wards
3. **Main content area** (a calm neutral page background distinct from the cards, scrolls
   independently), showing the **Dashboard** state:
   - Page heading "Today's planning workload" with a small ghost "Refresh" button on the right.
   - **KPI row** — an auto-fit grid of 4 clickable cards (min 220px each, hairline border,
     ~8px radius). Each card: a line icon on the left, a large bold number, a small muted
     label below, and a faint right-chevron. The four: "Active permits" (accent icon),
     "Approved (incl. conditional)" (success-coloured icon), "Open enforcement orders"
     (danger-coloured icon), "Cases with deadline pressure" (warning-coloured icon).
   - Below, a **two-column card grid** (cards have a compact header strip: small icon, bold
     title, muted right-aligned caption):
     - **Card: "Timeline performance"** — statutory SLA metrics: average days from intake to
       decision, % decided within the 90-day statutory clock, small per-stage bars.
     - **Card: "Deadlines watchlist"** — caption "Permits within statutory danger zone".
       A list of up to 8 rows; each row: a small countdown pill ("14d", "3d", or "DUE" —
       warning/danger treatment by urgency), a monospace register number (e.g.
       "DR/2026/0142"), the applicant name, and a muted "Stand 1234 · Ward 7" line.
       Empty state copy: "All active permits are on track. No clock-pressure today."
     - **Card: "Recent applications"** — caption "Last 6 registrations". Rows of monospace
       register number, applicant name, a small status label, and a muted date.
     - **Card: "Permit register by status"** — caption "128 total". A compact horizontal
       bar list: status label, thin accent progress bar, count (e.g. Under assessment,
       Advertised, Committee, Approved, Refused, Withdrawn).
     - **Card: "Common actions"** — caption "Jump to a planner duty". An auto-fit grid of 7
       outline buttons, each with a small icon, a bold title and a muted one-line
       description: "Register a new application / Intake → Section 26 workflow"; "Appraise
       building plans / Plans queue per permit"; "Issue enforcement / prohibition order /
       Stop-work + compliance"; "Generate quarterly returns / Aggregate stats for province";
       "Look up Use Class / Act / Statutory reference library"; "Open a property file /
       Parcel record, owners, zoning & history"; "Ad-hoc report builder / Filter the
       register & export CSV".

### Visual direction (fresh — propose your own language within these guardrails)
Choose a modern, accessible visual system. You are not bound to the current colours — design
a palette, type scale, and spacing that feel contemporary and refined for a government
casework tool. Guardrails:
- **One restrained accent.** Pick a single saturated accent and keep it under ~10% of any
  surface; everything else is neutral. No rainbow of colours.
- **Civic, not consumer.** Trustworthy, calm, confident without decoration. Avoid the generic
  SaaS-dashboard cliché (cream + bright-blue + oversized hero metric cards) — that is the
  strongest anti-reference. No gradients-for-show, no glassmorphism, no playful illustration.
- **Status semantics must stay legible**: distinct success, warning, danger, and info
  treatments for the countdown pills, KPI accents, and sync chip, each passing WCAG AA
  against its background. Deadline urgency (warning → danger → DUE) must be readable at a
  glance — this officer's legal clock depends on it.
- **Dense and scannable.** This is a daily working console for a professional: labels small,
  numbers prominent, monospace for register numbers, generous but compact row rhythm. No
  oversized whitespace-heavy layouts.
- **Type**: choose a clean, professional typeface (a humanist or grotesque sans; a Google
  Font is fine) plus a monospace for register/reference numbers.
- **Surfaces & elevation**: clearly separated cards on a calmer page background, hairline
  borders, restrained shadow. No heavy drop shadows.
- **Radii**: pick one consistent radius and use it everywhere.
- **Icons**: thin line icons.
- **Accessibility**: WCAG 2.1 AA contrast throughout; visible focus states.

Keep the information architecture, section names, copy, and the dashboard content exactly as
specified above — only the visual language is new. Deliver clean semantic HTML + CSS,
responsive down to ~900px (sidebar narrows to the icon rail, the header section descriptions
hide). Do not invent extra branding, taglines, or imagery.
