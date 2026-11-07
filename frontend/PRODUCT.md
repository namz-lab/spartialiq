# Product

## Register

product

## Users

The Vungu Rural District Council planning portal serves three audiences from a single Vue 3 + Fastify codebase:

- **Council planning staff** — planners, planning clerks, GIS officers, environmental officers, surveyors, building inspectors, RDC administrators. Their context: desk-based work in a council office, dual monitors, frequent map use, multi-step statutory workflows from application intake through due diligence, committee report, permit issue, inspections, enforcement.
- **Citizens and applicants** — Vungu-district residents and developers submitting and tracking development applications, paying fees, receiving notices. Their context: mostly mobile, modest devices, intermittent connectivity in rural Midlands Province.
- **Council leadership and admin** — IT user management, security audit, analytics. Oversight rather than day-to-day operations.

The job to be done varies sharply by role but the spine is the same: locate land, understand what is allowed there, route an application correctly, decide, communicate, inspect what was built.

## Product Purpose

Replace paper-based development-control workflows with a single auditable digital system, and publish authoritative spatial data (planning boundaries, zoning, infrastructure, country basemap) to both staff and the public.

Success looks like:

- A development application moves from submission to certificate of occupancy without a paper file.
- The country-wide spatial dataset (provinces, districts, wards, roads, buildings, landuse) renders identically in every view that needs it.
- A citizen on a phone can find their stand, see its zoning, and submit a TPD.1 without staff help.

## Brand Personality

Trustworthy. Calm. Confident-without-decoration.

The voice is plain English. Sentences are short. Planning jargon is named once and then explained. The interface never apologises and never hypes, a senior planner explaining patiently. No exclamation marks, no marketing language ("supercharged", "powerful", "next-generation" are all banned), no emoji.

## Anti-references

- **Generic SaaS dashboard** — cream background, bright blue accent, hero-metric cards ("834 applications, up 12%"), identical icon-and-heading grids, gradient pill buttons. The default AI-generated look. Most strongly to be avoided.
- **Crowded ESRI-style GIS** — toolbar walls, dense ribbons, micro-icons that need hover labels, panels nested four deep.
- **Government-portal cliché** — stock-photo handshakes, giant national-flag header, "Service Charter" PDFs as the only content, mid-2000s framework defaults.

If a screen could be guessed as "Stripe Atlas for African councils" or "WordPress government theme", it has failed.

## Design Principles

1. **Authority through restraint.** Government tooling earns trust by being calm and predictable, not by shouting. Subtle palette, generous space, neutral typography, no marketing flourish anywhere.
2. **Map first, chrome second.** The spatial picture is the work. Every control, panel, legend and toggle visually subordinates to the map content. Where the map fights chrome, the chrome loses.
3. **One job per surface.** Each role-specific portal does one thing well. The planner workspace is for planning; the citizen portal is for applying. No "universal dashboards" trying to be everything.
4. **Show, don't summarise.** Where data exists, render the data. Where it does not, say so plainly. Never invent placeholder hero-metrics. Empty states explain what would appear and how.
5. **Plain language always.** Planning jargon (TPD.1, Stand, Permit, EIA, Subdivision) is named once and explained inline on first use. Codes (ZW1921) are always paired with the human name (Harare District).

## Accessibility and Inclusion

WCAG 2.1 AA across the board.

- Contrast at least 4.5:1 for body text; at least 3:1 for large text, icon-only controls, and chart elements.
- Colour is never the only signal. Province colours (Mashonaland West orange, Manicaland green) are reinforced by labels and outlines. Layer filter chips combine a colour swatch with the layer name.
- Keyboard reachable end-to-end. Skip links above each role-portal header.
- Reduced motion respected: drill-down `flyTo` / `fitBounds` collapses to `jumpTo` under `prefers-reduced-motion: reduce`.
- Tested with NVDA on the primary action paths: login, new application, map view, application tracking.
- Designed for modest devices and intermittent connectivity. Avoid full-page images. Map tiles cached aggressively; offline tile failure must never blank the page.
