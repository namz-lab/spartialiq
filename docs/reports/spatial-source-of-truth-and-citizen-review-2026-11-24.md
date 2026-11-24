# Spatial data as the single source of truth, and how citizen-centric LAMIS is — 24 November 2026

*Review of the code on `main` at 3ef96f8 (after PR #58). Read-only: nothing was changed. Counts are from the local database; live will differ. The code and data were read; the screens were not clicked through.*

Case units: **Planning and Environment**, **Roads and Works**, **Finance**.

## 1. Summary

| Question | Verdict | In one line |
|---|---|---|
| Spatial data as the single source of truth | **Largely achieved, for staff** | The stand (`land.parcel`) and the ward (`admin.authority_ward`) are the shared keys. Planning and Finance use the same parcel register; Roads and Works and Finance meet Planning at the ward. |
| An enterprise view | **Achieved in structure, thin in content** | The spatial engine turns each unit's registers into ward measures that the Chief Executive and each unit head read. Planning has one measure, and money does not follow a decision. |
| Citizen-centric | **Partly** | The portal is organised around the resident's **login**, not around the **person** or their **property**. The register of persons joins records up for staff, but the resident does not see what it joins. |

Two points close most of the gap:
- the portal should find a resident's records through their person record;
- a resident should be able to see their stand, its rates account and their bills.

## 2. What is achieved

### 2.1 The stand is the shared key

| What | Evidence |
|---|---|
| **One parcel register.** Three parcel tables became one; farms are a kind of parcel. | Migration 227 (`land.parcel`, `land.parcel_farm`; `public.vungu_parcels` is now a compatibility view). About 20 foreign keys point at `land.parcel`: buildings, lineage, events, change requests, stand offers, finance. |
| **Finance bills the same stand.** There is no second property register in Finance. | Migration 205 (`finance.rates_account` on `land.parcel.parcel_id`), migration 244 (property finance on the planning register). Locally, 1,589 stands each have a rates account and an ERP account link (`revenue_link.account_link`). |
| **An application finds its stand and the plan once.** | Migration 231 (`resolve_stand_parcel` reads `land.parcel` only; the rule snapshot is taken at lodgement). |
| **Changes to a parcel are requests with lineage.** | Migration 229 (`land.parcel_change_request`, `_parent`, `_item`), `land.parcel_lineage`, `land.parcel_event`. |

### 2.2 The ward is the shared key between units

| Unit | How it reaches the ward | Evidence |
|---|---|---|
| Roads and Works | Every road, water point and council building gets its ward from its geometry; a trigger fills it on new or moved records; a typed ward is never overwritten. | Migration 252 (`council_ops.ward_of`, `fill_ward`) |
| Finance | Budget lines and projects reach wards only through approved, recorded splits; nothing is divided equally or by assumption. | Migrations 198 and 199 (`finance.v_budget_ward_attribution`) |
| All units | The spatial engine turns the registers into comparable ward measures. A ward with no figure is "no data", never zero; facts that cannot be placed are counted, not dropped. | Migration 215 (`spatial_engine.measure`, `ward_value`, `refresh()`) |

The seven measures, by owning unit:

| Unit | Measures |
|---|---|
| Finance | Spending against budget; stands with a rates account |
| Planning | Registered parcels per km² |
| Roads and Works | Road length per km²; water points per 10,000 registered voters; water points working |
| Social Services | Health premises with a valid fitness certificate |

**Who sees what.** `backend/src/config/units.js` is the single rule (`canSeeUnit`):
- the Chief Executive (`accounting_officer`) sees every unit;
- a unit head and its members see their own unit.

The executive overview and the unit dashboards both read it.

### 2.3 A case moves between the units by itself

- **Circulation is automatic** (migration 255). An acknowledged application goes to the departments its kind of development needs. Roads and Works is consulted on every application, as a blocking referral, so the decision waits for its reply.
- **Roads and Works records its assessment** (migration 253): the infrastructure-cost test (RTCP Act s.26(5)), road reserves (s.41) and access onto a council road.
- **Fees reach the ledger** (migrations 246 and 247). The cashier takes the application fee against the case, and the inspection fee releases the stage booking.

### 2.4 One register of persons

- **One register** (migrations 256 and 257). One record per person or organisation, shared by every department, recognised by national ID, passport or company registration.
- **Four levels of assurance:**
  - 0, recorded;
  - 1, identity verified;
  - 2, resident or ratepayer;
  - 3, original document sighted.
- **Online and counter meet.** An online sign-up joins the register.

## 3. Gaps in the enterprise view

| # | Gap | Evidence | Effect |
|---|---|---|---|
| E1 | **Phases 2–4 of the 19 November integration review are not built.** | No code found for: `property_interest` (owners per stand), Roads and Works conditions onto the permit (R1), the s.26(5) development contribution charge (R2), approval reaching Finance (P1), or plant job costing (F1). Finance project subjects still exclude roads, plant and engineering assessments (`finance-projects.js:28`). | The council cannot say who owns a stand. Engineering costs never reach Finance. Money does not follow a decision. |
| E2 | **A second property register is still in use.** | Rates clearance (`council-registers.js`, `POST /registers/rates-clearances`) reads arrears from `spatial_planning.property` / `property_assessment`, matched on the stand number as typed, not from `finance.rates_account`. Locally `spatial_planning.property` has 1,593 rows and `property_assessment` has 0. | The check never finds a balance. Clearing depends on the figure the finance officer types in. It contradicts the single register. |
| E3 | **Planning's ward measure is thin.** | One measure (parcels per km²); none comes from its cases. | The Chief Executive cannot compare wards by applications, time to decision or approvals. |

## 4. Is it citizen-centric?

### 4.1 What is in place

- **One sign-in and a portal of 16 sections:**
  - home and reception;
  - new application, my applications;
  - map;
  - documents;
  - public notices;
  - payments (Paynow);
  - inspections and certificates;
  - rates clearance;
  - appeals;
  - reporting building work;
  - service requests;
  - profile and reference.
- **Public pages:** a public map (`/qgis-map`), the public finance page (`/council/finances`) and public notices.
- **Identity and residence:** the resident's uploaded identity and residence proofs raise their level in the register of persons.

### 4.2 What stops it being citizen-centric

| # | Gap | Evidence | Effect on a resident |
|---|---|---|---|
| C1 | **The portal finds records by login, not by person.** | Citizen lists filter on the signed-in account: applications on `created_by`, rates clearances on `requested_by`, service requests on `requester_user_id`. Reads through `registry.person` exist only on staff routes (`persons.js`). Locally 1 of 50 applications is linked to a person. | An application lodged for them at the counter, a receipt paid at the cash office or their objection does not appear, even when staff have linked it to them. |
| C2 | **No "my property" page.** | No citizen route reads `land.parcel`, `finance.rates_account` or rates bills for the resident. | A resident cannot see their stand, its rates account, their bills or their balance, although the accounts exist. Blocked by E1 (no owners per stand). |
| C3 | **Rates clearance answers from an empty table.** | E2 above. | No automatic answer on whether the resident is clear; the outcome depends on what an officer types. |
| C4 | **Service requests do not reach the departments' registers.** | `service-desk.js` takes the department as free text, with no location and no ward. Nothing in Roads and Works or the unit dashboards reads the tickets. Locally there are none. | A pothole or a broken water point is not placed on the map and does not reach Roads and Works. |
| C5 | **Email only, English only.** | No SMS, WhatsApp or USSD channel; no translation framework in the frontend. | Residents without email or a smartphone, and Shona and Ndebele speakers, are poorly served. |

## 5. Recommended order of work

| Order | What | Closes |
|---|---|---|
| 1 | Have the citizen portal find records through `users.person_id` → `registry.person`, so applications, receipts and objections linked to the person appear under "My applications" and "Payments". | C1 |
| 2 | Build owners per stand (`property_interest`, from the rates roll and the allocations). Then add a "My property" page that reads the stand, its rates account and its bills from the ledger, showing standing only, never arrears amounts (decision D13). | E1 (in part), C2 |
| 3 | Point rates clearance at `finance.rates_account` and its bills; retire `spatial_planning.property`. | E2, C3 |
| 4 | Give service requests a map location, place them in a ward, route them to the owning unit, and show them on that unit's dashboard. | C4 |
| 5 | Add case-based Planning measures to the spatial engine (applications per ward, median days to decision). | E3 |
| 6 | Complete phases 3–4 of the 19 November review: the roads conditions on the permit, approval reaching Finance, the development contribution, plant costing. | E1 |
| 7 | Add an SMS channel for status changes, and a translation framework for Shona and Ndebele. | C5 |

Each schema change reaches live only through a reviewed `backend/scripts/apply-*-to-live.js` (dry run, then `--apply`), never through `npm run migrate`.

## 6. Sources

- Migrations:
  - 198–199, finance spatial allocation;
  - 205, rates;
  - 215, the spatial engine;
  - 227, one parcel register;
  - 229, parcel change requests;
  - 231, applications read the plan;
  - 244, property finance;
  - 246–247, planning fees;
  - 252–255, Roads and Works and circulation;
  - 256–257, the register of persons.
- Routes:
  - `council-registers.js` (rates clearance);
  - `service-desk.js`;
  - `persons.js`;
  - `finance-projects.js`;
  - `units.js` and `spatial-engine.js`;
  - `config/units.js`.
- Frontend: `views/CitizenPortalView.vue` and `views/citizen/sections/*`.
- Earlier review: [integration-review-roads-finance-planning-2026-11-19.md](integration-review-roads-finance-planning-2026-11-19.md).
