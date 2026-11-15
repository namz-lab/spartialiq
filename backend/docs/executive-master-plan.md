# The master plan, for the Chief Executive

Read-only. `GET /api/executive/master-plan` (accounting officer only; `src/services/executiveMasterPlan.js`) and the page `/executive/master-plan`
(`frontend/src/views/executive/ExecutiveMasterPlanView.vue`), linked from the Planning card of the Chief Executive's overview.

## What it shows
- **The plan and its standing:** title, revision (Rev 005 · July 2026 · 1:120 000), and "Not in force" until the plan is gazetted.
- **Adoption:** each step (public notice, the Full Council's adoption, the four signatures, approval, the Minister's approval, gazette) done or not; a signature made before the plan changed is said to be stale.
- **An interactive map:** the zones (coloured as the published style colours them), facilities and business centres, mines/quarries/schemes/the new city, the railway, wards and roads, each switchable. A click on a zone selects it (the list highlights it); a click on a facility or land feature says what it is. Selecting a zone in the list zooms the map to it.
- **The zones as a list** with the same figures as the map: area, share of the plan, parcels in it, and how many of the plan's uses are permitted, by special consent, not allowed or not decided there.
- **Register coverage:** parcels under a zone of the plan and those under none.
- **The plan in applications:** lodged, decided, in progress, approved against the plan, approved on a rule not yet agreed, decided without applying the plan.
- **Held beside the plan:** facilities, land features, railway lines, targeted farms (and how many are linked to the register) and retained zones.

## Honesty rules
- A plan not gazetted says "Not in force". Decisions only **affirmed for testing** (`scripts/affirm-decisions-for-testing.js`) are shown in a banner as that, with the count, and never as the council's decisions.
- A zero is shown as zero; no plan on record, or a failed read, is said plainly.
- Nothing on the page changes anything: there is no sign, approve, adopt or gazette action, and the route accepts only GET. The Chief Executive's signature as a signatory stays with the planning workbench.

## The overview's Planning card
The card gains a "Master plan" group (plan and revision, standing, adoption steps done, parcels under a zone) and a link to the page. If the master plan cannot be read the card is shown without that group.
