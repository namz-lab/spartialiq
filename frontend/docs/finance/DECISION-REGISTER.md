# Vungu RDC finance module — Council decision register

Companion to `COUNCIL-DECISIONS.md` (the engineering view of where each seam waits). This is
the management view: what must be decided, by whom, with what options and what happens if it
stays open. Produced 2026-11-07. Status column reflects Council action only — none of these
has been decided by Council, and **the system is not production-approved until D10 closes.**

Options and recommendations are engineering input to the decision, not decisions. Where no
recommendation is offered, the choice is genuinely the Council's (financial or political, not
technical). No policy, classification or value is invented here.

---

## D1 — Financial year dates and naming convention

| | |
|---|---|
| **Decision** | The label, start and end dates of each financial year, and the naming convention for future years. |
| **Why required** | Every budget line, transaction, import and publication belongs to exactly one financial year. Nothing can be budgeted or imported until a year exists; a year created wrongly (wrong dates, wrong label) mis-files every figure entered after it. |
| **Where the code waits** | `finance.financial_year` rows (created by Finance staff under Financial years; no year is seeded). |
| **Options** | (a) Calendar year, `2027` style labels. (b) Zimbabwe government fiscal year with the Council's own label convention. |
| **Recommendation** | Whichever the Council's auditors use — the module must reconcile to the books of account, so the year definition has to match the ERP's, not the calendar's. |
| **If left open** | No budgets, no imports, no publications. The finance module stays empty (by design — it refuses to guess). |
| **Responsible** | Finance Director / Treasurer (with the Council's auditors). |
| **Status** | OPEN. |

## D2 — Approved chart of accounts

| | |
|---|---|
| **Decision** | The list of account codes and each account's classification as revenue or expenditure (and postable vs heading). |
| **Why required** | The specification forbids inferring revenue/expenditure from the numeric range of an account code (the Czech convention the reference implementation used). Every account's kind must come from the Council's approved chart. |
| **Where the code waits** | `finance.account` (bulk load available under Departments & accounts). |
| **Options** | (a) Load the Council's existing chart from the ERP export. (b) Adopt a new chart before go-live. |
| **Recommendation** | (a) — load the chart the auditor already accepts; a new chart is a year-one reconciliation hazard. |
| **If left open** | Every import citing an account code lands in the exception queue. Nothing sums anywhere. |
| **Responsible** | Finance Director (chart owner); system administrator loads it. |
| **Status** | OPEN. |

## D3 — Budget hierarchy depth

| | |
|---|---|
| **Decision** | Whether budgets are classified vote → programme → activity, and how deep. |
| **Where the code waits** | `finance.account.parent_id`, `finance.programme` — hierarchy supported, not populated. |
| **Options** | Votes only; votes + programmes; votes + programmes + activities. |
| **Recommendation** | None — this is how the Council wants to read its budget; the system supports any depth. |
| **If left open** | Budgets work at vote level only; programme/activity reporting stays empty but nothing is mis-stated. |
| **Responsible** | Finance Director with departmental heads. |
| **Status** | OPEN. |

## D4 — Currency policy and conversion method

| | |
|---|---|
| **Decision** | Whether reporting is single- or multi-currency, and if conversion is ever performed, the official rate source and rule. |
| **Why required** | USD and ZWG are stored in separate columns and never summed or converted anywhere in the system. Any conversion needs a Council-approved rate source and rule (Treasury function, not engineering). |
| **Where the code waits** | `finance.exchange_rate_policy` — empty and deliberately inert (migration 193 documents this in-schema). |
| **Options** | (a) Keep separate-currency reporting (current behaviour). (b) Approve a rate source and rule and have conversion implemented as a controlled change. |
| **Recommendation** | (a) until Treasury has a documented, auditable rate source — an ad-hoc rate would invent figures. |
| **If left open** | Current behaviour continues: honest, separate, per-currency figures. Low risk. |
| **Responsible** | Treasurer / Treasury function. |
| **Status** | OPEN (safe default in force). |

## D5 — Public disclosure matrix

| | |
|---|---|
| **Decision** | Which transaction fields, supplier identities and document classes may appear on the public portal. |
| **Why required** | The Public Finance Management Act's transparency duty pulls one way; supplier commercial confidentiality and personal data pull the other. The current behaviour (publish amounts, dates, descriptions, references; withhold all counterparty identity) is the conservative reading, not a policy. |
| **Where the code waits** | `finance.publication` datasets and `finance.document.visibility`; the public API's withheld-fields list. |
| **Options** | (a) Keep full counterparty withholding. (b) Publish supplier names above a materiality threshold. (c) Publish supplier names with a delay. |
| **Recommendation** | None — a legal determination the Council should take on advice, not a preference. |
| **If left open** | The conservative behaviour holds: nothing unlawful can leak, at the cost of less transparency than the Act may intend. |
| **Responsible** | Council resolution on legal advice (Chamber Secretary / legal counsel). |
| **Status** | OPEN (conservative default in force). |

## D6 — Approval roles, delegated authorities and thresholds

| | |
|---|---|
| **Decision** | Who may approve what value of revision or commitment, and any delegated-authority limits. |
| **Where the code waits** | `finance.approval_threshold` — empty. Current rule: every revision needs an approval event by a holder of `finance.budget.approve` who is not the requester; no amount-based auto-approval exists. |
| **Options** | (a) Single committee approval for everything (current). (b) Thresholds: departmental head below a limit, committee above. |
| **Recommendation** | None — this mirrors the Council's delegation of financial authority instrument. |
| **If left open** | All revisions go to the committee. Slower, but no control is weakened. |
| **Responsible** | Council resolution (delegation of financial authority). |
| **Status** | OPEN. |

## D7 — Representative source exports and control totals

| | |
|---|---|
| **Decision** | Which actual ERP/Payroll exports the council will supply each period, with declared control totals. |
| **Why required** | The import flow reconciles against totals the source system declares. Column mappings are seeded with aliases observed in PROMUN / Pastel-Sage style exports and are editable — but no format is assumed correct until a real one is supplied. |
| **Where the code waits** | `finance.column_mapping`; import batch control-total fields. |
| **Options** | n/a — this is a data supply commitment, not a choice. |
| **Recommendation** | Supply three consecutive months of real exports as acceptance evidence before go-live. |
| **If left open** | Imports run only on test files; the acceptance criteria A1–A3 are exercised but not against production sources. |
| **Responsible** | Finance Director (extracts from the ERP with the vendor). |
| **Status** | OPEN. |

## D8 — Statutory report formats and formulas

| | |
|---|---|
| **Decision** | The exact formats and formulas of any statutory return the system must generate. |
| **Where the code waits** | Reporting layer. Only the formulas stated in specification §6 are implemented, labelled as such; exports carry the §3.9 provenance block. No statutory return is generated. |
| **If left open** | The system reports internally but produces nothing a regulator has asked for. |
| **Responsible** | Finance Director with the responsible Ministry's format requirements. |
| **Status** | OPEN. |

## D9 — Retention, backup, hosting, RPO and RTO

| | |
|---|---|
| **Decision** | Retention periods for financial records; backup schedule and off-site arrangements; hosting; recovery-point and recovery-time objectives. |
| **Where the code waits** | Operations. Soft delete everywhere (no hard deletes of financial or statutory records); nightly database backup script exists; no retention job, off-site arrangement or tested RTO is in place. |
| **Options** | n/a — operational commitments, to be set with the Council's IT hosting arrangement. |
| **If left open** | Records are retained indefinitely (safe); recovery capability is untested (unsafe) — see D10. |
| **Responsible** | IT officer / hosting provider, with the Finance Director for retention periods. |
| **Status** | OPEN — **release blocker until backup/restore is demonstrated (D10)**. |

## D10 — UAT sign-off and demonstrated restore test

| | |
|---|---|
| **Decision** | Formal user acceptance testing by Finance staff, and a demonstrated, timed restore of a backup to a clean environment. |
| **Why required** | The system is **not production-approved**. Every other decision can close in any order; this one closes last and needs them closed. |
| **Evidence needed** | (a) UAT script covering the twelve workspace sections and the public portal, signed by the Finance Director. (b) A restore of the nightly backup to a scratch database, with a finance report reconciled against the pre-backup figure, timed. |
| **If left open** | No go-live. |
| **Responsible** | Finance Director (UAT), IT officer (restore), Council (acceptance). |
| **Status** | **OPEN — the release gate.** |

---

## Summary for the Council agenda

1. **D1, D2, D7 first** — without a year, a chart of accounts and real source exports, Finance
   staff cannot even begin UAT.
2. **D4, D5, D6 need legal/financial judgment** — each has a safe conservative default already
   in force, so they gate *policy completeness*, not *testing*.
3. **D9 + D10 are the release gate** — no go-live until a restore has been demonstrated and
   UAT is signed, whatever else is decided.

---

# GIS–finance integration decisions (D11–D15)

Added 2026-11-08 with the GIS–finance integration programme
(`docs/gis-finance/ARCHITECTURE-ASSESSMENT.md`). Each has a safe degraded default in force, so
none blocks the engineering milestones — but the map stays partly empty until D11 lands.

## D11 — The Council's official ward list

| | |
|---|---|
| **Decision** | Which wards constitute Vungu RDC, recorded in the ward register with delimitation basis and instrument. |
| **Why required** | The ward↔council link (`admin.authority_ward`) is empty: no ward choropleth, ward panel or ward validation can resolve any ward to this Council until it is loaded. The national register carries 19 candidate wards under COD-AB district ZW1704 (Gweru); confirming the list is the Council's act, not the system's guess. |
| **Where the code waits** | `admin.authority_ward` rows (basis `delimitation`/`proclamation`, `instrument_ref`); `finance.v_ward_performance.ward_status` reports `unlinked` for every coded ward until then. |
| **Options** | (a) Confirm the 19 COD-AB wards under ZW1704. (b) Confirm a subset (if any wards belong to another council) with the instrument that says so. |
| **Recommendation** | (a) unless the Council's delimitation instrument says otherwise; COD-AB is the same source the boundaries came from. |
| **If left open** | Every ward-tagged figure reports honestly as `unlinked`; the map shows the "ward register not linked" state instead of polygons. |
| **Responsible** | Chief Executive Officer / Chamber Secretary (the delimitation instrument); GIS officer records it. |
| **Status** | OPEN (degraded default in force). |

## D12 — Physical progress reporting on projects

| | |
|---|---|
| **Decision** | Whether project physical completion % is recorded, by whom, how often, and with what evidence. |
| **Why required** | The GIS programme must compare financial execution with physical delivery (a project 80% spent but 40% built is a management exception). The field does not exist in `finance.project`; adding it without an owner and a reporting discipline would produce decorative numbers. |
| **Where the code waits** | Not implemented. On approval: `finance.project.physical_progress_percent` + evidence document link + audit (a controlled migration). |
| **Options** | (a) Not recorded — financial execution only. (b) Recorded per project by the responsible officer with evidence. |
| **Recommendation** | (b) for capital projects only, recorded monthly with a progress report document. |
| **If left open** | Project maps colour by status and spend only; no progress-vs-spend exception flags (Phase 7 of the programme stays partial). |
| **Responsible** | Finance Director with departmental heads (project owners). |
| **Status** | OPEN. |

## D13 — Outstanding-revenue (arrears) data source

| | |
|---|---|
| **Decision** | Which system holds arrears/debtor amounts per property or ward, and whether that data may be imported into this system. |
| **Why required** | "Areas with outstanding revenue" requires debtor amounts. The rates integration (`revenue_link`) deliberately carries account keys and status bands only — **no amounts** — so nothing in this system can state what a ward owes. |
| **Where the code waits** | Nothing invented. On approval: an import dataset + reconciliation in the existing import pipeline, never a live link that could mis-state arrears. |
| **Options** | (a) Out of scope — collections and budgets only. (b) Periodic arrears extract from the billing/ERP system, imported and reconciled like actuals. |
| **Recommendation** | (b) only if the billing system can produce a control-totaled extract; otherwise (a). |
| **If left open** | Revenue maps show budgeted vs collected revenue by ward; nothing claims to show outstanding revenue. |
| **Responsible** | Finance Director / Revenue officer (with the billing system vendor). |
| **Status** | OPEN. |

## D14 — Public map disclosure matrix

| | |
|---|---|
| **Decision** | Which ward-level aggregates (budget / revenue / expenditure / projects) may appear on the public transparency map, extending D5 to geography. |
| **Why required** | The public map (Milestone 7) aggregates figures the Council already publishes, but choropleths make geography explicit: a ward-level revenue map is more revealing than a totals table even from the same rows. The existing publication workflow is the mechanism; the Council decides which datasets it covers. |
| **Where the code waits** | `finance.publication` datasets + the public map endpoint's RLS-keyed reads (nothing public renders outside a live publication). |
| **Options** | (a) Budget and expenditure only. (b) Add projects. (c) Everything D5 publishes, aggregated per ward. |
| **Recommendation** | Start (a), widen after the first publication cycle — aggregation reversal risk is low but unproven. |
| **If left open** | The public map shows only what existing publications already cover, per dataset. |
| **Responsible** | Council resolution on legal advice (same posture as D5). |
| **Status** | OPEN. |

## D15 — Spatial allocation approval authority

| | |
|---|---|
| **Decision** | Who may approve a geographic split of a budget line or project, and what evidence the methodology note must carry. |
| **Why required** | `finance.spatial_allocation` (migration 198) is live: splits are approved acts with mandatory methodology, capped at the canonical totals, requester ≠ approver. The default grants the approve permission to the same roles that approve budgets/projects; a stricter delegation (e.g. committee-only) is the Council's to make. |
| **Where the code waits** | `finance.role_permission` rows for `finance.budget.approve` / `finance.project.approve` (the split decisions ride them); methodology text is free-form today. |
| **Options** | (a) Same approvers as the money (current default). (b) Committee-only for splits above a share threshold. |
| **Recommendation** | (a) to start; revisit with D6's delegation instrument rather than inventing a parallel one. |
| **If left open** | Current default holds: the officer who approves the budget approves its geography. |
| **Responsible** | Council resolution (delegation of financial authority, with D6). |
| **Status** | OPEN (default in force). |

---

## Addendum — owner direction recorded 2026-11-09

Recorded by the project owner to unblock implementation. These are **implementation directions, not
Council resolutions**: D11, D12 and D14 remain formally OPEN against the Council bodies named in
their entries above, and nothing below is a compliance claim. Where a direction permits work to
proceed on provisional data, the provisional status is carried in the data itself and stated in the
UI, so a later Council resolution replaces it without rewriting the feature.

| Decision | Owner direction | Consequence for implementation | Formal status |
|---|---|---|---|
| **D11** — official ward list | Load the **19 COD-AB wards under district ZW1704** into `admin.authority_ward` for authority 1 (VUNGU) as **provisional**: `basis='interim'`, `instrument_ref` stating the list is unconfirmed pending Council resolution. | The ward choropleth renders real geometry instead of the `ward_register_empty` state. Every surface that names the ward list must label it provisional. Replacing it with the confirmed list is one migration; no feature code changes. | OPEN — Council confirmation still required. The loaded rows are **not** evidence of a Council act. |
| **D12** — physical progress | **Include.** Add `physical_progress_percent numeric(5,2) NULL` + `progress_evidence_document_id` to `finance.project`; surface spend-vs-progress exception flags on the project map and in project reporting. | Enables the Phase 7 comparison. The field is nullable and a project with no recorded progress shows "not recorded", never 0 %. Who records it and how often remains a Council/management matter. | OPEN as to procedure; the field is approved for build. |
| **D13** — outstanding revenue source | **No source available.** No arrears or debtor amounts may be imported or displayed. | Revenue mapping shows **budgeted and collected** revenue only. The import seam is built so arrears can be loaded later; the outstanding-revenue choropleth is **not built** and must not be approximated from status bands. | OPEN — unblocks only when a debtor source is identified and release-approved. |
| **D14** — public map disclosure | Public ward-level map may display: **budget allocation, expenditure, revenue** (each per ward, per currency) **and project locations with status**. Counterparty identity is excluded at every width. | Sets the ceiling for `/api/public/finance/map/wards`. The live `finance.publication` RLS gate still governs absolutely: an aggregate permitted here appears publicly **only** if its dataset is actually published. Permission here is not publication. | OPEN — Council resolution on legal advice still required before a real publication cycle. |

**D15** (spatial allocation approval authority) is unchanged: the default holds — the officer who
approves the money approves its geography, requester ≠ approver.

## D16 — A budget reduction is refused while approved spatial splits would exceed the revised total

| | |
|---|---|
| **Decision** | When an approved budget revision (or a direct edit of `original_amount`/`currency`) would lower a line's revised total below the sum of its **approved** spatial allocations, the reduction is **refused** — it is not permitted-and-flagged, and the splits are not auto-withdrawn. |
| **Taken by** | Implementation decision, migration 202, recorded 2026-11-10. Open to Council override. |
| **Why refuse rather than flag** | A permitted inconsistency leaves the database arithmetically wrong: the unallocated remainder is a subtraction in a view, and a negative remainder is not a warning but a figure the choropleth must shade and the ward panel must read out. A control that allows the inconsistency and then labels it has moved the problem onto the reader. |
| **Why not auto-withdraw the splits** | An approved allocation carries a recorded methodology and a named approver (§6.1 principle 7). Revoking it is itself an audited decision belonging to whoever holds the deciding permission — not something the system does on an officer's behalf as a side effect of a different approval. |
| **Cost of refusing** | Only the *order* of two approved decisions is enforced: the officer withdraws the splits that no longer fit (one audited act each), then approves the reduction. Nothing is lost. |
| **Where enforced** | `finance.assert_spatial_allocations_fit()` on both reduction paths, plus a route-level `409 spatial_allocations_exceed_revised` that names the offending `allocation_ids` / `target_codes` and the withdraw endpoint, so the officer is told which splits to withdraw rather than handed a trigger message. Reads `v_budget_line_performance.revised_amount`, the same definition migration 198's approve-time cap uses, so the two cannot disagree. |
| **Residual, stated** | A *project* subject's cap is `Σ project_allocation.amount`; soft-deleting a project allocation could shrink that below an approved project split. That path is **not** re-validated — a known, separate change. |
| **Legacy data** | A pre-existing negative remainder is published, not hidden: `v_budget_ward_attribution.attribution_exception = 'split_exceeds_revised'` and `v_ward_performance.attribution_exception_rows`. |
| **Status** | IN FORCE. Council may direct the flag-instead-of-refuse behaviour; it would require a decision on who reads and clears the exception. |

## Operational note — closed years and spatial allocations (migration 202)

A closed or archived financial year now refuses **all** writes to `finance.spatial_allocation`, including
**withdrawing** one, consistent with every other table in the `assert_year_open()` set. Reopening the year
is the documented way out. This is a behaviour change worth a line in the operations runbook.
