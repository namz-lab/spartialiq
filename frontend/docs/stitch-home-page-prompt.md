# Stitch prompt — Vungu RDC public website (Home · About · Services · Council · Contact · Map)

Source of truth: `src/views/HomeView.vue`, `src/views/view/AboutView.vue`,
`src/views/view/ServicesView.vue`, `src/views/council/CouncilPageView.vue`,
`src/views/council/ContactView.vue`, `src/views/MapExplorer.vue`, plus the shared
`src/components/SiteHeader.vue` / `src/components/SiteFooter.vue`.

Paste the block below into Google Stitch. It reproduces the real information architecture,
sections, and copy of the public-facing site across **six screens**, but deliberately leaves
the **visual language open** — Stitch should propose a fresh, modern palette, typography, and
spacing within the civic guardrails at the end.

---

## Prompt

Design a **multi-page public website** (desktop web) for the **Vungu Rural District Council**
planning and spatial-data portal — a Zimbabwean local-government authority in Midlands
Province. Produce **six screens** that share a common header and footer: **Home**, **About**,
**Services**, **Council page**, **Contact**, and a full-screen **Map Explorer**.

This is a civic government site, not a startup or SaaS marketing site: the personality is
**trustworthy, calm, and confident without decoration**. No marketing hype, no exclamation
marks, no hero-metric cards, no gradients-for-show. WCAG 2.1 AA contrast throughout. On the
marketing pages, constrain content to a centred max-width column (~1100px) with generous side
padding.

### Shared header (sticky on every marketing page; clean surface, 1px bottom hairline, subtle shadow)
- Left: brand block — a small rounded-square map/location icon in the **primary accent**, then
  the wordmark "Vungu Portal".
- Nav links: "Home", "About", "Council" (a dropdown revealing: Our Profile, Executive Arm,
  Deliberative Arm, Departments, Publications, Stand Applications), "Services", "Map",
  "Contact".
- Far right: an outline "Login" button and a solid **primary accent** "Get Started" button.

### Shared footer (calm dark or deep-neutral band; four columns)
- **Brand column**: "Vungu Portal" logo + wordmark, then "The online services and spatial-data
  portal of Vungu Rural District Council, Midlands Province, Zimbabwe."
- **Services**: Apply for a stand · Development permit · Submit building plans · Pay council
  fees · District map explorer.
- **The Council**: About Vungu RDC · Our profile · Executive arm · Deliberative arm ·
  Publications · Contact.
- **Contact**: a location pin "19 Lincoln Road, Light Industrial Site, Gweru"; a phone
  "(+263) 54 226515/6"; an envelope "admin@vungurdc.org.zw".
- Bottom bar (hairline above): left = "© 2026 Vungu Rural District Council. Serving 19 wards
  across the Midlands."; right = small links "Privacy", "Terms", "vungurdc.org.zw".

---

### SCREEN 1 — Home
1. **Hero** (full-width, tall, dark premium background with a subtle decorative
   star/constellation motion — atmospheric, low-contrast, never competing with text; static
   under reduced-motion). Centred: headline "Find spatial data for / Vungu District"; muted
   subtitle "Explore urban planning, development areas, environmental zones, and more"; two
   buttons — solid accent "Get Started" (map icon) and outline "Login".
2. **Interactive Map Explorer** section (two-column ~50/50). Left: eyebrow "Spatial Explorer";
   heading "Interactive / Map Explorer"; paragraph "Discover urban planning zones, development
   areas, and environmental data across Vungu District."; four feature pills with line icons —
   "Urban Planning Zones", "Development Areas", "Environmental Zones", "Infrastructure"; CTA
   "Launch Full Explorer" (arrow icon) with hint "Toggle layers · Search places · Export data".
   Right: a framed map preview card with faux browser chrome (three traffic-light dots +
   centred label "Vungu District — Live Preview") whose body is a warm Google-Maps-style
   basemap.
3. **Closing CTA** (centred band): eyebrow "Get Started"; heading "Everything Vungu RDC, in one
   place"; paragraph "Learn about the council, use its online services, or open the full
   interactive map of the district."; buttons "About the Council" (accent) and "Council
   Services" (outline).

### SCREEN 2 — About
- **Page hero**: eyebrow "Your Council"; H1 "About Vungu Rural District Council"; subtext "The
  local authority for 609,589 hectares of Zimbabwe's Midlands Province — 19 wards across
  natural farming regions 3 and 4, bordered by Kwekwe, Chirumanzu, Shurugwi, Insiza and
  Inyati."
- **Vision, mission & governance** (eyebrow "Who We Are"; subtext about maintaining roads,
  allocating stands, delivering health/water/planning/social services). A 3-card grid, each
  card with a line icon, title, description, and a footer meta line:
  - "Our Vision" — "A well-developed Vungu community with a high quality of life for its people
    by the year 2030." (meta: Strategic Plan 2026–2030)
  - "Our Mission" — "To provide and maintain social and economic facilities and services to the
    people of Vungu in an environmentally friendly and sustainable way." (meta: Mandate of the
    council)
  - "Governance" — "Led by 19 ward councillors and 6 women's-quota councillors, working with 4
    chiefs, 9 headmen and 215 village heads across the district." (meta: Deliberative &
    executive arms)
- **Vungu District at a Glance** — a stat grid (definition list) of six figures: Administrative
  Wards 19 · Hectares of Land 609,589 · Households Served 24,127 · Health Facilities 22 · Water
  Points 360 · Kilometres of Roads 1,521. Small note: "Figures from the Vungu RDC profile.
  Natural farming regions 3 and 4; catchment areas Gwai and Sanyati."
- **Economy & Investment** (eyebrow; heading "A district open for business"). A 4-card grid:
  Agriculture, Mining ("The SINO mine produces quarry stone and cement products"), Tourism &
  Safaris ("Linton Safari and Antelope Park"), Trade & Enterprise.
- **Departments & Services** (eyebrow "Inside the Council"; heading "Departments & Services").
  An 8-card grid of clickable cards, each with icon, title, description, "Department" meta and a
  "View →" link: Planning & Environment · Roads & Works · Health Services · Finance · Social
  Services · Human Resources & Administration · Environment & Agriculture · Local Economic
  Development.

### SCREEN 3 — Services
- **Page hero**: eyebrow "Online Services"; H1 "Council services, online"; subtext "Apply,
  submit, pay and track — the Vungu RDC services residents and developers use most, now
  available without a trip to the council offices."
- **Six things, start to finish** (eyebrow "What you can do here"; subtext "Every service below
  runs end to end in this portal"). A 6-card grid, each card icon + title + description + meta +
  CTA link:
  - "Apply for a Stand" — residential/commercial stand registration (meta: Stand allocation;
    CTA Start)
  - "Development Permit" — submit online using Form TPD.1 (meta: Planning & Environment; CTA
    Apply)
  - "Submit Building Plans" — lodge plans for review and approval (meta: Plan review; CTA
    Submit)
  - "Track an Application" — sign in to follow approval stages (meta: Applicant account; CTA
    Sign in)
  - "Pay Council Fees" — settle rates and charges online (meta: Finance; CTA Pay)
  - "Explore the District Map" — wards, zoning, roads, water points, facilities (meta: Spatial
    explorer; CTA Open)
- **Plans & Notices** (eyebrow "Public Documents"; heading "Plans & Notices"). A 4-card grid of
  document links, each icon + title + description + meta + "Read →": Strategic Plan 2026–2030 ·
  Master Plan · Annual Plan 2026 · Budget Approval Notice 2026.

### SCREEN 4 — Council page (generic template, e.g. "Our Profile")
- **Page hero**: a small eyebrow (e.g. "The Council"), an H1 page title (e.g. "Our Profile"),
  and an intro paragraph.
- **Content blocks**: a clean long-form article layout below the hero — section headings,
  body paragraphs, and simple lists — readable measure, generous vertical rhythm. This one
  template is reused for Our Profile, Executive Arm, Deliberative Arm, Departments,
  Publications, and Stand Applications, so keep it flexible and content-driven (no
  page-specific chrome).

### SCREEN 5 — Contact
- **Page hero**: eyebrow "Contact"; H1 "Get in touch with the Council"; subtext "Fill in the
  form below with your details and our team will respond to you, or reach us directly using the
  contact details provided."
- **Two-column layout**:
  - Left, "Have any questions?" — a list of contact rows, each a line icon + label + value:
    Phone "(+263) 54 226515/6"; Email "admin@vungurdc.org.zw"; Address "19 Lincoln Road, Light
    Industrial Site, Gweru"; Office hours "8am – 5pm, Monday to Friday".
  - Right, a message form: "Your name" (text), "Your email" (email), "Your message" (textarea),
    and a solid accent "Send a message" button (disabled until a message is typed).

### SCREEN 6 — Map Explorer (full-screen application, NOT a marketing page)
This is a 100vh app surface with its own chrome — no shared marketing header/footer.
- **Left sidebar** (~280px, collapsible to a 48px icon rail): a header with a small house/home
  glyph and the title "Map Explorer" plus a collapse chevron. Sections:
  - "Base Map" — a 3-button grid: Streets, Satellite, Terrain (one active).
  - "Layers" — a header row with small refresh and "hide all" icon buttons; below, two
    collapsible groups, each with a chevron, a name, and a count badge: "QGIS Server Layers"
    and "Database Layers". Each layer row is a small toggle switch + layer name + tiny status
    badges ("WFS"/"DB", a feature-count "ft" badge, or an "Unavailable" badge for errored
    layers).
  - "Active" summary — a pill "N layers" and a "Clear all" button.
- **Map area** (fills the rest): a full district map, with a slim bottom **status bar**
  showing "Zoom 10", a separator, "N active", and a right-aligned "Reset view" button.
- A **Feature Properties** modal (shown on feature click): a titled dialog with a close button
  and a list of key/value property rows (Layer, Geometry, then feature attributes).
- This surface may read as a focused, slightly denser "tool" UI distinct from the calm
  marketing pages, but must use the same accent and type system.

---

### Visual direction (fresh — propose your own language within these guardrails)
Choose a modern, accessible visual system. You are not bound to the current colours — design a
palette, type scale, and spacing that feel contemporary and refined for a government service.
Guardrails:
- **One restrained accent.** Pick a single saturated accent for primary buttons, the brand
  icon, eyebrow labels, active states, and toggles; keep it under ~10% of any surface.
  Everything else is neutral. No rainbow of colours.
- **Civic, not consumer.** Trustworthy, calm, confident without decoration. Avoid the generic
  SaaS-landing cliché (cream + bright-blue + oversized hero-metric cards) — that is the
  strongest anti-reference. No gradients-for-show, no glassmorphism, no playful illustration.
- **Consistency across screens.** The header, footer, card style, button styles, eyebrow
  labels, and stat figures must look identical across Home/About/Services/Council/Contact. The
  Map Explorer reuses the same accent and type but may be a denser tool layout.
- **Cards**: hairline border, one consistent radius, restrained shadow, a small line icon, a
  bold title, a muted description, and an optional footer meta + "View/Read/Start →" link.
- **Map cartography**: any map reads like a real warm, Google-Maps-style basemap (off-white
  land, legible roads, district boundaries) — not a flat coloured rectangle.
- **Type**: a clean, professional typeface (humanist or grotesque sans; a Google Font is fine).
  Confident headline scale, restrained body, small uppercase eyebrows, large stat numbers.
- **Surfaces & elevation**: hairline borders, restrained shadow; the map preview/feature cards
  are the clearly elevated elements. No heavy drop shadows.
- **Icons**: thin line icons throughout.
- **Accessibility**: WCAG 2.1 AA contrast; visible focus states; honour reduced-motion (the
  hero constellation collapses to a static background).

Keep the information architecture, section order, headings, figures, and copy exactly as
specified above — only the visual language is new. Deliver clean semantic HTML + CSS,
responsive down to ~900px (header nav collapses to a menu button; two-column sections stack;
the Map Explorer sidebar collapses to its icon rail). Do not invent extra branding, taglines,
statistics, testimonials, or imagery.
