# Stitch prompt — Vungu RDC Citizen Services Portal redesign

Source of truth: `src/views/CitizenPortalView.vue` + `src/views/citizen/sections/DashboardSection.vue`.
Paste the block below into Google Stitch. It reproduces the real information architecture,
sections, and content, but deliberately leaves the **visual language open** — Stitch should
propose a fresh, modern palette, typography, and spacing within the civic guardrails below.

---

## Prompt

Design a desktop web app screen: the **Citizen Services Portal** for **Vungu Rural District
Council**, a Zimbabwean local-government planning authority. This is a civic government tool,
not a marketing site or a SaaS dashboard — the personality is **trustworthy, calm, and
confident without decoration**. No marketing language, no exclamation marks, no hero metrics,
no gradients-for-show. WCAG 2.1 AA contrast throughout.

### Layout — fixed-height app shell (100vh, no page scroll on the shell)
Three regions:
1. **Top header bar** (clean surface, 1px bottom hairline border, subtle shadow), height ~52px:
   - Left: a small square icon button (hamburger/collapse toggle).
   - Brand block: a 30px rounded-square icon in the **primary accent** with a white user glyph,
     then two stacked lines — bold "Citizen Services Portal" (~13px) and a muted subtitle
     "Vungu RDC · Development applications & permits" (~10px).
   - A vertical divider, then the active section title with its icon and a muted one-line
     description (e.g. "Dashboard — Current stage · next action · deadlines").
   - Far right: a profile dropdown chip labelled "Applicant" with an avatar.
2. **Left sidebar nav** (~224px wide, 1px right border, collapsible to a 48px icon rail):
   a vertical list of 11 items, each an icon + label. The active item is clearly emphasised
   (solid **primary accent** fill or an equivalently strong treatment of your choosing); hover
   is a soft accent-tinted state. Items in order: Dashboard, New application, My applications,
   Map & Discover, Documents, Public notices, Payments, Inspections, Certificates, Appeals,
   Reference.
3. **Main content area** (a calm neutral page background distinct from the cards, scrolls
   independently), showing the **Dashboard** state:
   - Page heading "My applications & next actions" with a small user icon.
   - **KPI row** — an auto-fit grid of 5 cards (min 200px each, hairline border, ~8px radius).
     Each card: a line icon on the left, a large bold number, a small muted label below, and a
     faint right-chevron. The five: "Open drafts", "Submitted applications", "Needing my
     action" (danger-coloured icon), "Unpaid fees" (warning-coloured icon), "Active appeals".
     Default KPI icons use the primary accent.
   - **Card: "Cases waiting on me"** — card with a subtly tinted header strip carrying a
     warning icon, the bold title, and a muted right-aligned caption "Council cannot move
     forward until you respond". Body is a list of case rows; each row is a 3-column grid:
     left = monospace reference + "Stand 1234 · Ward 7"; middle = an accent-coloured stage
     label + a muted citizen-action line; right (right-aligned) = an info pill "76 d to
     90-day decision" (switches to a danger treatment when urgent), optional warning
     "missing document" pills, and a muted "Received 12 Mar 2026" date.
   - **Card: "Quick actions"** — card; body is an auto-fit grid of 6 outline buttons,
     each with a small icon, a bold title and a muted one-line description: "Start a new
     application / TPD form · screen for permit · stage documents"; "Upload a document /
     Title deed · plans · consent · ID"; "Respond to objections / Section 26(3) notices &
     objector responses"; "Request stage inspection / Notify the Inspector ≥ 48 hours in
     advance"; "Claim occupation certificate / After Stage 9 joint inspection passes";
     "Reference library / Lifecycle · fees · required documents".

### Visual direction (fresh — propose your own language within these guardrails)
Choose a modern, accessible visual system. You are not bound to the current colours — design
a palette, type scale, and spacing that feel contemporary and refined for a government
service. Guardrails:
- **One restrained accent.** Pick a single saturated accent and keep it under ~10% of any
  surface; everything else is neutral. No rainbow of colours.
- **Civic, not consumer.** Trustworthy, calm, confident without decoration. Avoid the generic
  SaaS-dashboard cliché (cream + bright-blue + oversized hero metric cards) — that is the
  strongest anti-reference. No gradients-for-show, no glassmorphism, no playful illustration.
- **Status semantics must stay legible**: distinct success, warning, danger, and info
  treatments for the pills and KPI accents, each passing WCAG AA against its background.
- **Type**: choose a clean, professional typeface (a humanist or grotesque sans; a Google
  Font is fine). Keep the screen compact and information-rich — labels small, KPI numbers
  prominent, monospace for case references.
- **Surfaces & elevation**: clearly separated cards on a calmer page background, hairline
  borders, restrained shadow. No heavy drop shadows.
- **Radii**: pick one consistent radius and use it everywhere.
- **Icons**: thin line icons.
- **Accessibility**: WCAG 2.1 AA contrast throughout; visible focus states.

Keep the information architecture, section names, copy, and the dashboard content exactly as
specified above — only the visual language is new. Deliver clean semantic HTML + CSS,
responsive down to ~900px (sidebar narrows to the icon rail, the header section-title hides).
Do not invent extra branding, taglines, or imagery.
