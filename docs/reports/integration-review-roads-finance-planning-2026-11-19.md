# Roads and Works, Finance and Planning: how well they work together, and a register of persons

*Review of the code on `main` at 473dcd7 (PR #53, automatic circulation), 19 November 2026. Read-only: nothing was changed.*

## 1. Summary

| Link | Rating | In one line |
|---|---|---|
| Planning → Roads and Works | **Good** | Every application is circulated to Roads and Works automatically (255). Its s.26(5) assessment blocks the decision until it is answered (253), and the EO sees it at Determination. |
| Roads and Works → Planning (back again) | **Partly done** | The engineers' proposed conditions and estimated cost are shown to the EO, but nothing carries them into the permit or the fee. |
| Planning → Finance | **Good for fees, weak after the decision** | Fees reach the ledger (246), and the inspection fee releases the booking (247). Approval does nothing in Finance, nobody checks for a rates clearance, and three fee codes are missing (D22). |
| Roads and Works → Finance | **Weak** | Plant is linked to its fixed asset (252), but its hours and fuel are not costed. Road works, plant and assessments cannot be a Finance project. |
| **People** (applicants, objectors, payers, owners) | **Missing** | Each module keeps its own copy of a person's name as text. Staff have no way to register a walk-in person, so the same person in two modules is never known to be the same. |

The departments are joined well *around the application*. They are not joined *around the person or the stand*. That is the gap you suspected, and it causes most of the others.

## 2. What works

- **Automatic circulation** (migration 255, `spatial_planning.circulation_rule`, `circulate_case`): the rules choose the departments, and no planner picks them. Roads and Works is consulted on every application and blocks the decision until it replies.
- **Engineering assessment** (253, `roads-works-referrals.js`):
  - the five heads of the s.26(5) cost test, the estimated cost and the proposed condition;
  - road reserves (s.41);
  - access onto a council road, linked to `council_ops.road_asset`.
  The EO's Determination screen reads it through `GET /permit-applications/:id/engineering-assessment`.
- **The roads registers** (252, 254): roads, structures, water points, council assets and plant, with the field survey log. Writes are limited to the engineering posts and protected by RLS.
- **Planning fees in the ledger:**
  - the cashier takes the fee against the application (246);
  - the clerk's Fee card reads it;
  - an inspection fee releases the stage booking (247);
  - the revenue officer sees each fee by application.
- **Finance projects** (`finance-projects.js`) can point at a development application, a planning project, a survey, a council asset or a service-desk ticket, with checks for broken links.

## 3. Gaps and proposed fixes

### 3.1 Roads and Works ↔ Planning

| # | Gap | Evidence | Fix |
|---|---|---|---|
| R1 | The engineers' `cost_condition` and `access_conditions` are only displayed. The EO retypes them into `permit_conditions` (082) or forgets them. | Only `roads-works-referrals.js` reads them. | At Determination, show each proposed condition with a **"Put on the permit"** tick. The permit then records which department proposed each condition. |
| R2 | The s.26(5) **estimated cost** never becomes a charge. The Act lets the council recover it from the developer as a condition of the permit. | No code path reads `estimated_cost` into Finance. | Add a **development contribution** income code. On approval with a cost condition, raise a debtor invoice against the applicant (§4), linked to the application and to a Finance project for the works. |
| R3 | No inspection checks the roads conditions after approval (the soakaway, the access, the culvert). | The stage inspections are Planning-only. | Let a permit condition name the department that signs it off. Roads and Works gets a "conditions to check" list on its referrals screen. |

### 3.2 Roads and Works ↔ Finance

| # | Gap | Fix |
|---|---|---|
| F1 | `council_ops.plant_log` records hours and fuel, but nothing costs them. Finance cannot tell what grading a road cost. | Cost each log line as hours × plant rate plus litres × fuel price, against a job: a road, a Finance project or a service-desk ticket. Post the totals monthly as an internal charge. |
| F2 | Finance project links cannot point at a **road**, an item of **plant**, or an **engineering assessment** (`SUBJECT_KINDS` in `finance-projects.js:28`). | Add `road_asset`, `plant` and `engineering_assessment` to the subject kinds, so a road rehabilitation is one project that carries its budget, its commitments and its register entry. |
| F3 | Roads and water points are not in the fixed-asset register as infrastructure assets, so the asset register understates council infrastructure. | Add an infrastructure category and link `road_asset` and `water_point` to `finance.fixed_asset`, as plant already is (252). |

### 3.3 Planning ↔ Finance (open items from the earlier analysis)

| # | Gap | Fix |
|---|---|---|
| P1 | `DevelopmentApproved` has no Finance action. `finance-property.js` handles only `StandAllocated` and `AllocationRevoked`. | When a permit is issued or completed, raise an event that puts the stand on the valuation roll's "improvements to value" list, with the rates account and its owner. |
| P2 | Nobody checks for a rates clearance before a decision or a stand transfer. | A Determination gate asks whether the stand's rates account is in arrears. It shows only *clear / not clear*, never the amount (D13), and the EO can override it with a reason. **This needs §4:** today the system cannot say who owns the stand. |
| P3 | No fee codes exist for appeals, public notices or searches (D22). | Add the codes on the same pattern as PLN-APP. |
| P4 | Live shows 1,603 of 1,609 stands as unallocated. The 1,589 stand-to-rates-account links on local were not copied to live. | Load them with a targeted script (dry run, then `--apply`), the same way as the earlier live loads. |
| P5 | No screen creates inspection bookings. | Add one on the clerk's console. |

## 4. Registering individual persons

### 4.1 How people are recorded today

| Module | Where | What it holds | Can staff register someone? |
|---|---|---|---|
| Sign-in | `public.users` | Email, password, national ID, phone, address | Only the person can, online, with an email address (`POST /auth/register`) |
| Planning | `permit_application` | `applicant_name`, `applicant_id_number`, phone, email | Text typed per application |
| Public notice | `objections` | `objector_name`, address, ID number | Text typed per objection |
| Allocations | `stand_allocation` | `allottee_name`, optionally `allocated_to` (a user) | Text |
| Cash office | receipts | `payer_name` | Text |
| Finance | `finance.party` and `party_identity` (244) | Name, contact details; matched on national ID, company registration, planning user or allottee name | Finance staff, for ratepayers, debtors and suppliers |

**Result:** if Mrs Hlongwane pays at the counter, lodges the application, later objects to a neighbour's application, and owns a stand on the rates roll, she exists **four times** under four spellings. The system cannot:
- tell the EO that the applicant owns Stand 1379;
- tell the clerk that Mr Khumalo is an adjoining owner, which is what gives him standing to object;
- check her rates account;
- send any of them a letter from one address on record.

A walk-in person with no email, who is most of Vungu's applicants, cannot be registered at all.

### 4.2 Proposal: one council register of persons

A new, neutral schema used by every department. It is not inside `finance`, because Planning and Roads and Works must be able to read and write it without being given Finance access.

```
registry.person                  one row per natural person or organisation, per council
  id, authority_id, kind ('individual' | 'organisation')
  surname, first_names | organisation_name, display_name (generated)
  date_of_birth (optional), phone, alt_phone, email, physical_address, postal_address, ward_no
  preferred_channel ('sms' | 'email' | 'post' | 'collect')
  verified_at, verified_by, verified_how ('ID sighted at counter' …)
  merged_into (→ person), status, created_by, created_at, audit columns

registry.person_identifier        how a person is recognised; unique per council and kind
  person_id, kind ('national_id' | 'passport' | 'company_registration' | 'user_account'), value (normalised)

registry.property_interest         who stands in what relation to which stand
  person_id, parcel_id, interest ('owner' | 'lessee' | 'allottee' | 'occupier' | 'agent'),
  share, from_date, to_date, source ('rates roll' | 'allocation' | 'deed' | 'counter'), evidence_ref
```

**Links (each one a nullable column, added beside the existing text):**
- `permit_application.applicant_person_id`, and `agent_person_id` for an architect or agent
- `objections.objector_person_id`
- `stand_allocation.allottee_person_id`
- `receipts.payer_person_id`
- `users.person_id`
- `finance.party.person_id`. A person can have more than one finance account: rates, a debtor account, a supplier account.

**Rules:**
- **Keep the text columns.** They are the record *as written on the day*, which the law relies on. The link adds identity and does not replace the record.
- **Roles are not stored on the person.** "Applicant", "objector", "payer", "owner" and "ratepayer" come from the links, so they can never fall out of date.
- **Search before you create.** A shared *Find or register a person* panel searches by national ID (exact), phone (exact) and name (similar). A new record is allowed only after the search shows no match.
- **Duplicates.**
  - A national ID is unique per council, enforced by a unique index.
  - Possible duplicates go to a review list.
  - A supervisor merges them; `merged_into` keeps the trail, and links follow the survivor.
- **Personal information.** The Cyber and Data Protection Act [Chapter 12:07] applies, so:
  - a national ID shows masked (`63-•••••••-X-27`) except to the roles that need it;
  - each record notes why it was collected;
  - reads of the full ID are logged, like `finance.property.view_identity` today.
- **Three ways in:**
  1. **At the counter.** The clerk, the cashier or the revenue officer sights the ID and registers the person. The record is marked *verified*.
  2. **Online.** Self-service sign-up creates a person and a user. The record stays *unverified* until the person shows their ID at the counter.
  3. **From registers.** The rates roll, the allocations and the deeds are matched on national ID, then by review, and are never merged automatically on name alone.

### 4.3 The two cases with a person register

**Case 1: Mr B. Phiri, extension on Stand 1378 (approved)**

| Step | Who | What changes |
|---|---|---|
| Pays the fee | Cashier | Issue Receipt → **Find or register a person** → searches his ID → not found → registers B. Phiri (ID sighted, phone, address). The receipt carries `payer_person_id`. |
| Lodges | Clerk | The application form picks Phiri from the register instead of retyping him. The system shows **"Owner of Stand 1378 (rates roll)"** from `property_interest`. If he were not the owner, the clerk would be asked for the owner's consent. |
| Circulation | Automatic | Unchanged (255). Roads and Works replies with no cost. |
| Before deciding | EO | New gate (P2): *Stand 1378 rates account: clear*. No amounts are shown. |
| Decision | EO | Approve. The permit carries any condition Roads and Works proposed, ticked across (R1). |
| Notified | System | The notification goes to his `preferred_channel`. The notification date starts the appeal month, as now. |
| After | Finance | `DevelopmentApproved` (P1) puts Stand 1378 on the improvements-to-value list against **his** rates account. |

**Case 2: Mrs L. Hlongwane, tuck shop on Stand 1379 (refused); objector Mr J. Khumalo**

| Step | Who | What changes |
|---|---|---|
| Lodges | Clerk | Hlongwane is found or registered once. All her letters use her recorded address: the objection put to her, the 14 days, the refusal. |
| Objection | Clerk | Public notice → **Find or register the objector** → Mr J. Khumalo. The system shows **"Owner of Stand 1380, adjoining"**, which establishes his standing. A non-adjoining objector is recorded too, and marked as such. |
| Put to the applicant | Clerk | The letter is addressed from her person record. Sending it is recorded against her, so the 14 days are provable. |
| Written extension | EO | Her letter is filed against the case **and** her person record. |
| Refusal | EO, Clerk | The refusal letter goes to her address of record. Mr Khumalo is told the outcome through his preferred channel, which the system cannot do today. |
| Later | Anyone | If she applies again, or appeals, her earlier refusal and the Roads and Works objection appear on her record. If Mr Khumalo applies for something himself, the clerk finds him, not a fourth copy. |

## 5. Recommended order of work

| Phase | What | Why first |
|---|---|---|
| **1** | `registry.person`, `person_identifier`, the *Find or register* API and panel (clerk, cashier, revenue officer), and nullable link columns on applications, objections and receipts. Backfill links where the national ID matches exactly; everything else goes to a review list. | It unblocks the rest, and it is the step that lets staff register a walk-in person. |
| **2** | `property_interest`, loaded from the rates roll and allocations. Copy the 1,589 account links to live (P4). Link `finance.party.person_id`, and move the national IDs in `party_identity` across. | Owners for every stand: needed for P1, P2 and objector standing. |
| **3** | The roads conditions on the permit (R1), the rates clearance gate (P2), approval to Finance (P1), and the missing fee codes (P3). | Closes the Planning ↔ Finance ↔ Roads loop around each case. |
| **4** | The s.26(5) contribution charge (R2), plant job costing (F1), roads as project subjects and assets (F2, F3), and condition sign-off by Roads and Works (R3). | Engineering costs reach Finance. |

Each schema change reaches live only through a reviewed `backend/scripts/apply-*-to-live.js` (dry run, then `--apply`), never through `npm run migrate`.

## 6. Status

**Phase 1 is built (19 November 2026).**

| Piece | Where |
|---|---|
| The register: `registry.person`, `person_identifier`, `receipt_payer`, the link columns, `registry.v_unlinked` | `backend/migrations/256_person_register.sql`; rollback in `migrations/rollback/256_person_register.down.sql` |
| The API: search, register (refuses a second record for the same ID; warns on the same phone or name), correct and verify, reveal an ID (logged), link an applicant or an objector, list records not yet linked | `backend/src/routes/persons.js` |
| Optional links when the records are made: an application (`applicant_person_id`), an objection (`objector_person_id`), a cash receipt (`payer_person_id`) | `development-management.js`, `finance-cash.js` |
| The *Find or register a person* panel | `frontend/src/components/shared/PersonPicker.vue` |

The panel appears in three places:
- **Clerk console → Application receipt**: *Applicant in the register*.
- **EO console → Public notice → Record an objection**: the objector.
- **Cashier → Issue Receipt**: the payer, optional.

On the live system: applied on 19 November 2026 with `backend/scripts/apply-person-register-256-to-live.js --apply`. It backfilled one person, linked one application, and left 29 records to link. The code that reads it goes live with the next deploy.

Not in Phase 1: the review screen for unlinked records (only the API exists), merging duplicates, and citizens' online accounts.

**One register with four levels, and the Registrar-General prototype (migrations 257 and 258).**

What is now in place:
- **One register.** Online sign-up joins the register. An officer's approval of an uploaded ID or proof of residence raises the person's level, and so does a deed check. The account's residency status now mirrors the register.
- **Four levels:** 0 recorded, 1 identity verified, 2 resident or ratepayer, 3 original sighted. Every desk can register a person, but only the planning clerk raises a level, with the cash supervisor and the administrator as back-up.
- **A new clerk desk, *Register of persons*,** with the level ladder, the Registrar-General's answer, *Confirm at the counter*, the history, and the work list of records not yet linked.
- **A prototype Registrar-General service** at `/api/rg-prototype/v1` with a fictional register, and its console at `/mock/registrar-general`. The demonstration is described in [registrar-general-prototype-demo.md](../presentations/registrar-general-prototype-demo.md).

On the live system:
- 257 was applied on 19 November 2026 (`scripts/apply-person-levels-257-to-live.js --apply`). All 13 online citizen accounts are now in the register, at level 0.
- 258 is never applied to live, and the check stays off there.

Still to do: merging duplicate persons, and the gates that require a level for acts of legal weight (issuing a permit, allocating a stand). The levels each act requires are for the council to adopt.
