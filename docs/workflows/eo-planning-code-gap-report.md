# The EO Planning working workflow against the code: gap report

**Status: DRAFT, 15 November 2026.** Compares [the working workflow](eo-planning-working-workflow.md) with the permit code on branch `docs/eo-planning-workflow`. Nothing was changed and no tests were run. No screen is to change until the workflow is agreed.

**Not checked:** whether the clerk dispatch register sends the Registrar and Surveyor-General copies; the enforcement routes against section 6; the EO portal screens beyond a search for "delegated"; whether the clock-event table is written to.

## 0. What has been done since (migration 239, `services/eoWorkflow.js`, `routes/eo-workflow.js`)

| # | Now |
|---|---|
| 1, 2 | **Done.** The server refuses a typed "delegated authority" unless the council's confirmations are recorded as switches S1 and S3 (S5 for a refusal), and never for a case the workflow keeps for the committee. The planner screens no longer say "within delegated authority". |
| 3 | **Done.** The committee's latest resolution must match the decision (`resolution_mismatch`). Deferred and noted outcomes no longer authorise anything. |
| 4 | **Done for L3 and L7.** A subdivision, consolidation or rezoning is not decided until switch S2 records the Minister's instrument (`lane_closed`). |
| 5 | **Done.** An approval after the deemed-refusal date is refused (`deemed_refused`); the date counts to the applicant's written extension, which needs its evidence and cannot revive a case already deemed refused; the planner save no longer writes the due date. The dates to work to (a month and fifteen days before the deemed-refusal date) are worked out by the server and shown under the case bar and in *Before you decide*. |
| 6 | **Done.** A refusal without written reasons is refused. |
| 7 | **Done.** An outstanding blocking reply stops the decision. |
| 8 | **Done.** Public notice is required where the proposal is a special consent, conflicts with a condition of title, or is a non-conforming or adverse use, and an approval waits until it is complete (`public_notice_incomplete`); a `departure_reason` no longer stands in for it. Each objection is considered, put to the applicant, and the applicant's 14 days to comment are used or answered (`objections_open`). |
| 9 | **Done.** An administrator override needs a written reason, and the basis of every decision is written to the case history. |
| 10 | **Done.** Recording a committee outcome is the EO's, the planning clerk's or an administrator's; a planner can no longer. (The planning clerk stands in for the Committee Clerk, which has no role of its own.) |
| Section 3 | **Done.** The delegation switches S1 to S8 (the CEO or an administrator turns one on with its evidence), the step 5 direction check, the register of ministerial directions, and the referral log with a 21-day reply-by and "no reply" recorded. The EO sees them in the decision screen ("Before you decide") and in a new "Referrals & switches" section. |
| Section 4 | **Done, by asking.** The software cannot know a site's distance to a State road or an obstacle limitation area, so the EO answers the Act's six questions; an approval waits for every answer, for the referral each "yes" leads to, and for the body's reply or its one month (`statutory_checks_required`, `statutory_referral_pending`). The copies to the Surveyor-General and the Registrar after a subdivision, and to the Registrar after a title conflict, are listed and recorded in the log. |
| Section 11, step 4 | **Done in part.** The menu is regrouped (Your cases, Prepared for you, Registers, Office), the planner's and clerk's screens are folded away, a road of seven steps with its owners, the lane and the next date sits under the case bar, and the permit page leads with what stands in the way. |
| Review items | **Done:** the case bar overlap at narrow widths; the unexplained "Command centre / Case console" toggle (tooltips); the three words for "not done" (a legend, and "not verified" now blocks like "outstanding"); the "issue without these records" justification (removed). |

Sections 1 to 4 below describe the code **before** this change.

## 1. What the code already does

| Workflow | In the code |
|---|---|
| Clock runs from acknowledgement: 3 months, 4 for subdivisions (rule 2, step 2) | Migrations 170 and 171 set the deemed-refusal date from acknowledgement, in calendar months; empty until acknowledged. The front end mirrors it in `caseClock.ts`. |
| Decisions need a committee (S4, checklist) | `POST /eo-decision` returns 409 `committee_resolution_required` without a resolution. Recording an outcome checks quorum. |
| Plan gate (checklist) | `planGates.js` asks for a reason when the use is prohibited or a rule is not acknowledged. |
| Decided cases are not reopened quietly (step 17) | The transition table in `permitWorkflow.js` allows only an appeal after a decision. |
| Public notice (step 8) | The `public_notice` table records the advert, abutting owners, site notice and objection window. |
| Appeal window (step 17) | `appeals.js` tests one calendar month from the decision date. |

## 2. Where the code departs from the workflow

| # | Departure | Where | Workflow reference |
|---|---|---|---|
| 1 | **The delegated lane is open.** Any typed sentence in `delegated_authority` replaces the committee resolution. The permit-drafting step prompts for "named delegated authority" and counts any text as complete. | `development-management.js:1546`; `Step4PermitDrafting.vue:396`; `usePermitIssuance.ts:241` | Rule 1; S1 to S3 |
| 2 | **The screen says "Within delegated authority".** The workflow says no delegation exists. The check is advisory only and its rules are not those of section 7. | `Step3CommitteeReport.vue:120`; `caseClock.ts:81` | Section 7 |
| 3 | **The resolution is not matched to the decision.** Any agenda outcome other than pending, with any resolution text, passes. A committee outcome of refused, deferred or noted lets the EO approve. Quorum is checked only when the meeting has one set. | `development-management.js:87` | Checklist item 1 |
| 4 | **No lane check.** The same route decides subdivisions, refusals and special consents. Nothing blocks L3 while S2 is off. | `development-management.js:1512` | L1 to L3, step 1 |
| 5 | **The deemed-refusal date is not enforced.** The decision route never compares today with it, so a case past three months can be approved. The planner save can write `statutory_due_date` with no written extension from the applicant. The stop-dates (A+2 months, A+2 months 15 days) do not exist. | `development-management.js:778`, `:1512` | Rule 2; steps 13, 14 |
| 6 | **Refusals do not need written reasons.** `notes` is optional and a refusal can go through the delegated route. | `development-management.js:1525` | Step 15 |
| 7 | **The blocking flag does nothing.** `application_consultation.blocking` is stored; no decision check reads it. | migration 090 | Step 7 |
| 8 | **Public notice is mostly optional.** Enforced only for special consent, and a `departure_reason` bypasses that. The other s.26(3) triggers are not tested. The front-end notice rule keys on development type, which is not the Act's test. The applicant's 14 days to comment on objections were not found. | `planGates.js:79`; `caseClock.ts:96` | Steps 8, 9 |
| 9 | **Admin can override** the committee gate with `override: true`. It is logged; the workflow does not mention it. | `development-management.js:1547` | Section 8 |
| 10 | **Planners can record committee outcomes.** The workflow gives that to the EO or the Committee Clerk. | `development-management.js:2939` | Step 13 |

## 3. What does not exist yet

- A delegation register with switches S1 to S8, and a lane field on each case.
- The step 5 direction check and a register of ministerial directions.
- A Department referral log and its tiers.
- The section 4 statutory referrals: roads, aviation, the agriculture minister for farm subdivisions, and the Registrar of Deeds and Surveyor-General copies.
- Any mention of DSPD or the Department of Physical Planning in `backend/src`.

These are the items section 11 of the workflow lists as the next step, plus the statutory referrals.

## 4. Order of risk

Items 1, 3, 5 and 6 can let a wrong decision through today. Until the software changes, the manual rules in section 9 of the workflow are the only protection.
