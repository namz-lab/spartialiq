# Role → Workflow → Screen coverage audit

**Project:** Vungu RDC — GIS-Integrated Municipal Budget and Financial Management System
**Date:** 2026-11-08
**Type:** Read-only requirements audit. No source was modified; this document is the only artefact.
**Question audited:** *"Every user of the budget system must have their screens based on what they do, and every user must have all the workflows they need."*

**Repositories inspected**

| Half | Path | Finance surface |
|---|---|---|
| Frontend | `/home/theo-madzinaga/Documents/Manicipal-drums-frontend` | `src/modules/finance/` (15 sections, 1 shell, 1 public view, 12 112 lines) |
| Backend | `/home/theo-madzinaga/Documents/Manicipal-drums-backend-3` | `src/routes/finance-{budget,config,documents,imports,projects,public,publication,reports,spatial,users}.js`, migrations 188–199 |

> The frontend `CLAUDE.md` states the backend is at `../app-backend`. That path does not exist. The real backend is `Manicipal-drums-backend-3`, as already recorded in `docs/finance/2026-11-05-finance-impact-gap-note.md` ("Repositories actually in play").

---

## 0. Verdict

The requirement is **half true**.

- **"Every user must have all the workflows they need"** — very nearly true for the *budget cycle proper*. Of 34 permission codes, 33 have a screen and a control. Preparation, submission, approval, revision, import, exception resolution, variance explanation, project allocation, publication, reporting, export, audit review, configuration and year close all have a real screen with a real handler, enumerated with file:line in §4. Two workflows are missing entirely: the **staff transaction register** (§5 GAP-1) and the **spatial allocation** workflow (§5 GAP-2), the latter having a complete, separation-of-duties-enforced backend and zero frontend.
- **"Every user must have their screens based on what they do"** — **not true**. All eight roles arrive on the same section, see a rail filtered only by permission, and get no queue, no count and no landing shaped to their job. The one role-shaped cue in the whole module is the `awaitingMe` banner in Revisions (`src/modules/finance/pages/sections/RevisionsSection.vue:109,136-138`). This is milestone **M6**, which the architecture assessment schedules but which is not implemented.

Gap counts: **3 BLOCKER, 7 MAJOR, 6 MINOR** (§5). Four gaps are blocked on Council decisions (§8).

---

## 1. The authoritative role × permission matrix

Derived from the migrations, not from documentation.

- Catalogue: `migrations/188_finance_foundation.sql:1054-1087` — 33 codes.
- Default grants: `migrations/188_finance_foundation.sql:1107-1232`.
- 34th code and its grants: `migrations/199_finance_ward_performance.sql:217-230` (`finance.map.view`, granted to the seven finance roles only — **not** to `admin`).
- Separation-of-duties assertion (fails the migration if violated): `migrations/188_finance_foundation.sql:1234-1254`.
- Role names also added to `public.users_role_check` at `188:995-1002` and `invites_role_check` at `188:1041-1047`.

Legend: `✔` granted by default. `A` = approval permission (`is_approval`), `P` = publication permission (`is_publication`), `R` = restricted-data permission (`is_restricted`).

| # | Permission code | Flags | finance_admin | finance_officer | budget_officer | dept_head | finance_committee | publisher | auditor | admin |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 1 | `finance.config.manage` | | ✔ | | | | | | | |
| 2 | `finance.year.close` | | ✔ | | | | | | | |
| 3 | `finance.budget.view` | | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 4 | `finance.budget.prepare` | | ✔ | ✔ | ✔ | ✔ | | | | |
| 5 | `finance.budget.submit` | | ✔ | ✔ | ✔ | ✔ | | | | |
| 6 | `finance.budget.approve` | A | | | | | ✔ | | | |
| 7 | `finance.revision.prepare` | | ✔ | ✔ | ✔ | ✔ | | | | |
| 8 | `finance.revision.submit` | | ✔ | ✔ | ✔ | ✔ | | | | |
| 9 | `finance.revision.approve` | A | | | | | ✔ | | | |
| 10 | `finance.actuals.view` | | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 11 | `finance.transaction.view` | | ✔ | ✔ | | | ✔ | | ✔ | |
| 12 | `finance.transaction.view_counterparty` | R | ✔ | ✔ | | | | | ✔ | |
| 13 | `finance.import.upload` | | ✔ | ✔ | | | | | | |
| 14 | `finance.import.validate` | | ✔ | ✔ | | | | | | |
| 15 | `finance.import.commit` | | ✔ | | | | | | | |
| 16 | `finance.import.exception.resolve` | | ✔ | ✔ | | | | | | |
| 17 | `finance.project.view` | | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 18 | `finance.project.manage` | | ✔ | ✔ | | ✔ | | | | |
| 19 | `finance.project.approve` | A | | | | | ✔ | | | |
| 20 | `finance.document.view` | | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | |
| 21 | `finance.document.upload` | | ✔ | ✔ | ✔ | ✔ | | | | |
| 22 | `finance.document.view_restricted` | R | ✔ | | | | | | ✔ | |
| 23 | `finance.report.view` | | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 24 | `finance.report.export` | | ✔ | ✔ | ✔ | | ✔ | | ✔ | |
| 25 | `finance.report.export_restricted` | R | ✔ | | | | | | ✔ | |
| 26 | `finance.variance.explain` | | ✔ | ✔ | ✔ | ✔ | | | | |
| 27 | `finance.publication.review` | | ✔ | | | | ✔ | ✔ | | |
| 28 | `finance.publication.approve` | A | | | | | ✔ | | | |
| 29 | `finance.publication.publish` | P | | | | | | ✔ | | |
| 30 | `finance.publication.withdraw` | P | | | | | | ✔ | | |
| 31 | `finance.audit.view` | | ✔ | | | | ✔ | | ✔ | ✔ |
| 32 | `finance.audit.export` | | | | | | | | ✔ | ✔ |
| 33 | `finance.users.manage_finance_roles` | | | | | | | | | ✔ |
| 34 | `finance.map.view` | | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | **—** |
| | **Total** | | **26** | **19** | **13** | **13** | **14** | **9** | **13** | **7** |

**Facts that follow from the matrix and matter for screen design**

1. **`finance_admin` cannot provision finance roles.** Only `admin` holds `finance.users.manage_finance_roles` (`188:1222`). The Access section (`FinanceWorkspace.vue:135-137`) is therefore visible to exactly one role out of eight — the technical administrator. This is deliberate ("User provisioning. Confers no authority over financial content", `188:1087`) but it is not stated anywhere a finance administrator can read.
2. **`admin` has no `finance.map.view`** (`199:228` lists only the seven finance roles). The IT administrator's rail has no Finance map at all.
3. **`dept_head` is the only preparing role without `finance.report.export`** (`188:1186-1197`), and the only one with `finance.project.manage` but no `finance.report.export`.
4. **`finance_committee` is the single approver** for all three approval permissions (budget, revisions, projects) and also approves publications. It is the system's bottleneck actor.
5. **`publisher` is the only holder of `finance.publication.publish` / `.withdraw`** and holds nine permissions in total — the thinnest finance role.
6. **Non-finance staff grants** (`188:1224-1231`): `planner` → budget.view, actuals.view, project.view, report.view; `eo` and `env_officer` → project.view, budget.view. These accounts are *not* routed to `/finance` (`src/router/index.ts:807` admits `FINANCE_ROLES` + `admin` only); they consume finance through `LinkedFinancePanel.vue` mounted in `src/views/planner/case/CaseFinancePanel.vue`.

---

## 2. The nine personas → seven roles + admin

The specification personas are enumerated in `VUNGU_RDC_CLAUDE_CODE_PROMPT.md:26`: *"least-privilege finance administrators/officers, budget officers, departmental heads, committee reviewers, publishers, read-only auditors, technical administrators, and public users."*

| # | Specification persona | Maps to | Home surface | Evidence | Status |
|---|---|---|---|---|---|
| 1 | Finance administrator | `finance_admin` | `/finance` | `188:1109-1133`; `router/index.ts:858` | Mapped |
| 2 | Finance officer | `finance_officer` | `/finance` | `188:1135-1152`; `router/index.ts:859` | Mapped |
| 3 | Budget officer | `budget_officer` | `/finance` | `188:1154-1165`; `router/index.ts:860` | Mapped |
| 4 | Departmental head | `dept_head` (+ `finance.user_scope`) | `/finance`, scoped | `188:1167-1178`; `router/index.ts:861`; scope note `FinanceWorkspace.vue:291-295` | Mapped |
| 5 | Committee reviewer | `finance_committee` | `/finance` | `188:1180-1192`; `router/index.ts:862` | Mapped |
| 6 | Publisher | `publisher` | `/finance` | `188:1194-1201` | Mapped |
| 7 | Read-only auditor | `auditor` | `/finance` | `188:1203-1214` | Mapped |
| 8 | Technical administrator | `admin` | `/finance` (audit + access only, by intent) | `188:1216-1222`; `router/index.ts:793-796` | Mapped |
| 9 | Public user | **no role** — anonymous | `/council/finances` | `router/index.ts:145-156`; `pages/CouncilFinanceView.vue`; RLS `published_select` (migrations 194/197) | Mapped, but see GAP-9 |

**No persona is homeless.** The constraint "no new roles" is satisfiable as stated: the nine personas fit the seven finance roles plus `admin`, with persona 9 served by anonymous RLS rather than by a role.

**Two naming inconsistencies to resolve in the docs, not in the role model**

- `docs/gis-finance/ARCHITECTURE-ASSESSMENT.md:§6.4` names presets "Finance Manager", "Budget Officer", "Revenue Officer", "Auditor". **"Revenue Officer" and "Finance Manager" are not roles and are not personas.** "Finance Manager" ≈ `finance_admin`; "Revenue Officer" has no role — revenue work is an *account-kind filter* (`finance.account.kind='revenue'`, `188:209`), exercised by `finance_officer` / `budget_officer`. The assessment should say "preset" not a role-sounding name, or the presets should be renamed after the eight real roles.
- The workspace header docblock says "twelve sections" in two places (`REQUIREMENTS.md:358`, `router/index.ts:790`) while `FinanceWorkspace.vue:91-141` defines **fifteen**. Cosmetic, but it is the document a reviewer uses to check coverage.

---

## 3. What each role actually sees on arrival

Computed from `FinanceWorkspace.vue:91-141` (the `requires` arrays) against the §1 matrix, plus `FinanceWorkspace.vue:190` (`visibleSections`) and `FinanceWorkspace.vue:199-203` (`activeKey` = first visible section).

Section gates, verbatim:

| Section | `requires` (any one suffices) | Line |
|---|---|---|
| overview | `budget.view`, `actuals.view` | `:94` |
| map | `map.view` | `:97` |
| years | `budget.view` | `:101` |
| classifications | `budget.view` | `:104` |
| budget | `budget.view` | `:108` |
| revisions | `budget.view` | `:111` |
| projects | `project.view` | `:114` |
| imports | `import.upload`, `import.validate`, `import.commit`, `audit.view` | `:118` |
| reports | `report.view` | `:121` |
| documents | `document.view`, `document.upload`, `budget.view`, `project.view` | `:124` |
| publication | `publication.review`, `publication.approve`, `publication.publish`, `budget.view` | `:128` |
| audit | `audit.view` | `:131` |
| permissions | `budget.view`, `project.view`, `audit.view` | `:134` |
| access | `users.manage_finance_roles` | `:137` |
| settings | `budget.view` | `:140` |

Resulting arrival experience:

| Role | Sections visible | Lands on | Sections that are its actual job | Sections it can only read |
|---|:-:|---|---|---|
| finance_admin | 14 (all but access) | Overview | years, classifications, budget, revisions, imports, projects, documents, reports, settings | publication (request only), audit |
| finance_officer | 13 | Overview | budget, revisions, imports (not commit), projects, documents, reports | years, classifications, settings, publication, permissions |
| budget_officer | 12 | Overview | budget, revisions, reports, documents | years, classifications, settings, publication, projects, imports(hidden), permissions |
| dept_head | 12 | Overview | budget (own votes), revisions, projects, documents | years, classifications, settings, publication, reports(no export), permissions |
| finance_committee | 13 | Overview | budget (approve), revisions (approve), projects (approve), publication (approve), audit | years, classifications, imports (via audit.view), settings, reports |
| publisher | 12 | Overview | publication, documents (visibility) | **years, classifications, budget, revisions, projects, reports, settings, permissions — 8 of 12 sections are not its job** |
| auditor | 14 | Overview | audit, reports (incl. restricted export), documents (incl. restricted) | everything else; writes nothing except — see GAP-3 |
| admin | 14 (no map) | Overview | access, audit | **12 of 14 sections are not its job** |

**Every role lands on Overview.** `activeKey` (`FinanceWorkspace.vue:199-203`) resolves to `visibleSections.value[0]`, and `SECTIONS[0]` is `overview` (`:92`), which every role can open because all eight hold `budget.view`. The role string is read in exactly one place in the shell — `FINANCE_ROLE_LABELS` / `roleLabel` at `FinanceWorkspace.vue:158-172`, consumed only by the profile chip at `:253`. `src/modules/finance/stores/finance.ts:216-234` exports no preset, no landing and no queue state. There is no role-conditioned behaviour anywhere else in the module.

Overview itself is identical for all eight: departmental performance per currency plus flagged exception rows (`FinanceOverviewSection.vue:37-56`, `:61-91`). For `publisher` and `admin` it is a page of figures neither of them acts on.

---

## 4. Role × job × screen coverage

Fifteen cycle stages, as requested. Where a role does not hold the permission, the cell reads `n/a (by design)` — that is separation of duties working, not a gap. `GAP-n` refers to §5.

### 4.1 Where each job is performed (the screen and the control)

| Job | Section key | File | Control (line) | Handler (line) | Backend |
|---|---|---|---|---|---|
| Prepare budget line | `budget` | `pages/sections/BudgetSection.vue` | `:394` toggle, `:402` `FinanceGuard requires="finance.budget.prepare"`, `:474` save | `create()` `:129-149`, `save()` `:181-196` | `finance-budget.js:183`, `:253` |
| Submit budget line | `budget` | `BudgetSection.vue` | `:556` | `act(id,'submit')` `:211-216` | `finance-budget.js:301` |
| Approve budget line | `budget` | `BudgetSection.vue` | `:561` | `act(id,'approve')` `:219` | `finance-budget.js:334` |
| Return budget line | `budget` | `BudgetSection.vue` | `:566` | `act(id,'return')` `:231` | `finance-budget.js:313` |
| Raise revision | `budget` | `BudgetSection.vue` | `:571` | `raiseRevision()` `:243-264` | `finance-budget.js:397` |
| Submit revision | `revisions` | `RevisionsSection.vue` | `:221` | `act(r,'submit')` `:66-71` | `finance-budget.js:484` |
| Approve / refuse revision | `revisions` | `RevisionsSection.vue` | `:229`, `:232` | `:82`, `:95` | `finance-budget.js:503`, `:553` |
| Explain variance | `budget` | `BudgetSection.vue` | `:575` | `explain()` `:276-289` | `finance-budget.js:620` |
| Read variance explanations | `budget` | `BudgetSection.vue` | line-detail panel, `selected.explanations` `:60` | `openLine()` `:120-123` | `finance-budget.js:139` (sub-select `:175`) |
| Upload source file | `imports` | `ImportsSection.vue` | `:515` guard | `send()` `:95-102` | `finance-imports.js:370` |
| Map columns / save profile | `imports` | `ImportsSection.vue` | `:749` guard | `saveMappingProfile()` `:186-216` | `finance-config.js:657` |
| Validate batch | `imports` | `ImportsSection.vue` | `:708` guard | `validate()` `:329-340` | `finance-imports.js:641` |
| Resolve exception | `imports` | `ImportsSection.vue` | `:933` | `resolve()` `:413-442` | `finance-imports.js:931` |
| Reconcile to control totals | `imports` | `ImportsSection.vue` | shown with batch | `:245`, `:340`, `:381` | `finance-imports.js:1242` |
| Commit batch | `imports` | `ImportsSection.vue` | `:953` guard (+ `:961` refusal explanation) | `commit()` `:352-381` | `finance-imports.js:975` |
| Cancel batch | `imports` | `ImportsSection.vue` | `:948` | `cancel()` `:390-403` | `finance-imports.js:1212` |
| Create / edit project | `projects` | `ProjectsSection.vue` | `:511`, `:519` guard, `:699` | `create()` `:127-138`, `save()` `:198-211` | `finance-projects.js:217`, `:303` |
| Submit / approve project | `projects` | `ProjectsSection.vue` | `:687`, `:691` | `act()` `:238-246` | `finance-projects.js:371`, `:381` |
| Allocate budget to project | `projects` | `ProjectsSection.vue` | `:695` | `allocate()` `:256-297` | `finance-projects.js:411` |
| Associate / unlink transaction | `projects` | `ProjectsSection.vue` | `:704`, `:851` | `associate()` `:323-378`, `unlink()` `:393-411` | `finance-projects.js:515`, `:555` |
| Trace project money | `projects` | `ProjectsSection.vue` | `:666` | `open()` `:120-122` | `finance-projects.js:128` |
| **Allocate spatially (multi-ward split)** | — | — | **none** | **none** | `finance-spatial.js:137,248,254,261` — **GAP-2** |
| Request publication | `publication` | `PublicationSection.vue` | `:193`, `:201` guard | `request()` `:81-86` | `finance-publication.js:183` |
| Preview a release | `publication` | `PublicationSection.vue` | `:278`, `:332` | `look()` `:101-103` | `finance-publication.js:104` |
| Approve / refuse release | `publication` | `PublicationSection.vue` | `:337`, `:341` | `:121`, `:134` | `finance-publication.js:232`, `:264` |
| Publish | `publication` | `PublicationSection.vue` | `:350` | `:137` | `finance-publication.js:295` |
| Mark budget lines published | `publication` | `PublicationSection.vue` | `:282` | `:153` | `finance-publication.js:398` |
| Withdraw a publication | `publication` | `PublicationSection.vue` | `:286` | `:150` | `finance-publication.js:361` |
| Set document visibility | `documents` | `DocumentsSection.vue` | `:473`, `:477`, `:481` | `setVisibility()` `:226-255` | `finance-publication.js:440` |
| Upload document | `documents` | `DocumentsSection.vue` | `:318`, `:334` guard | `send()` `:196-206` | `finance-documents.js:83` |
| Withdraw document | `documents` | `DocumentsSection.vue` | `:486` | `withdraw()` `:265-280` | `finance-documents.js:294` — **GAP-3** |
| Run a report | `reports` | `ReportsSection.vue` | `:197` | `run()` `:61-67` | `finance-reports.js:444` |
| Export a report (CSV/XLSX/PDF) | `reports` | `ReportsSection.vue` | `:200`, `:203`, `:208` | `download()` `:82-88` | `finance-reports.js:486` |
| Include restricted columns | `reports` | `ReportsSection.vue` | `:179-184` checkbox, `:55` capability | `:74`, `:95` | `finance-reports.js:460`, `:499` |
| Search audit history | `audit` | `FinanceAuditSection.vue` | `:108-127` filters, `:130` | `load()` `:51-55` | `finance-reports.js:570` |
| Export audit history | `audit` | `FinanceAuditSection.vue` | `:133`, `:136`, `:139` | `download()` `:72-75` | `finance-reports.js:618` |
| Create / edit financial year | `years` | `FinancialYearsSection.vue` | `:178`, `:186` guard, `:291`, `:299` | `create()` `:56-65`, `saveEdit()` `:101-108` | `finance-config.js:97`, `:148` |
| Open year | `years` | `FinancialYearsSection.vue` | `:303` | `act(id,'open')` `:123-129` | `finance-config.js:184` |
| **Close year** | `years` | `FinancialYearsSection.vue` | `:307` (gated by `canClose` `:46`) | `act(id,'close')` `:140` | `finance-config.js:196` |
| Reopen year | `years` | `FinancialYearsSection.vue` | `:311` | `act(id,'reopen')` `:153` | `finance-config.js:229` |
| Departments / programmes / activities / chart | `classifications` | `ClassificationsSection.vue` | `:495`, `:585`, `:694`, `:833` guards | `:66`, `:148`, `:213`, `:267`, `:335-364` | `finance-config.js:267`, `:363`, `:452`, `:489` |
| Change finance settings | `settings` | `FinanceSettingsSection.vue` | `:184` guard | `save()` `:108-114` | `finance-config.js:610` |
| Provision finance roles / scopes | `access` | `AccessSection.vue` | `:377` guard | `save()` `:176-195` | `finance-users.js:179` |
| See own permissions and held duties | `permissions` | `PermissionsSection.vue` | `:55`, `:115`, `:149` | reads `store.catalogue` | `finance-config.js:54` (`/finance/me`) |
| Ward choropleth + drill-down | `map` | `MapSection.vue` | `:263-275` measure/currency, `:117` `selectWard` | `load()` `:72-79`, `loadWardDetail()` `:96-107` | `finance-spatial.js:322`, `:391` |
| **Browse the transaction register** | — | — | **none** | **none** | **no route exists** — **GAP-1** |

### 4.2 Role × job coverage grid

`✔` = the role holds the permission and the screen above serves it. `n/a` = correctly withheld. `GAP-n` = the role needs it and has no screen.

| Job | finance_admin | finance_officer | budget_officer | dept_head | finance_committee | publisher | auditor | admin |
|---|---|---|---|---|---|---|---|---|
| 1. Preparation (budget lines) | ✔ | ✔ | ✔ | ✔ (scoped) | n/a | n/a | n/a | n/a |
| 2. Submission | ✔ | ✔ | ✔ | ✔ **GAP-5** | n/a | n/a | n/a | n/a |
| 3. Approval (budget) | n/a | n/a | n/a | n/a | ✔ **GAP-5** | n/a | n/a | n/a |
| 4. Revision (prepare→submit→decide) | ✔ | ✔ | ✔ | ✔ | ✔ (has `awaitingMe`) | n/a | n/a | n/a |
| 5. Actuals import (upload→validate) | ✔ | ✔ | n/a | n/a | read-only | n/a | n/a | read-only |
| 5b. Commit batch | ✔ **GAP-6** | n/a (by design, `188:1101`) | n/a | n/a | n/a | n/a | n/a | n/a |
| 6. Exception resolution | ✔ | ✔ | n/a | n/a | n/a | n/a | n/a | n/a |
| 7. Variance explanation | ✔ | ✔ | ✔ | ✔ | n/a | n/a | n/a | n/a |
| 8. Project allocation | ✔ | ✔ | n/a | ✔ | approve only **GAP-7** | n/a | n/a | n/a |
| 9. **Spatial allocation** | **GAP-2** | **GAP-2** | n/a | **GAP-2** | **GAP-2** (approver) | n/a | n/a | n/a |
| 10. Publication (request) | ✔ | n/a | n/a | n/a | ✔ | ✔ | n/a | n/a |
| 10b. Publication (approve) | n/a | n/a | n/a | n/a | ✔ | n/a | n/a | n/a |
| 10c. Publish / withdraw | n/a | n/a | n/a | n/a | n/a | ✔ | n/a | n/a |
| 11. Reporting | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 12. Export | ✔ (+restricted) | ✔ | ✔ | n/a (no `report.export`) | ✔ | n/a | ✔ (+restricted) | n/a |
| 13. Audit review | ✔ (view) | n/a | n/a | n/a | ✔ (view) | n/a | ✔ (+export) | ✔ (+export) |
| 14. Configuration | ✔ | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 15. Year close / reopen | ✔ | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 16. **Transaction register** | **GAP-1** | **GAP-1** | n/a | n/a | **GAP-1** | n/a | **GAP-1** | n/a |
| 17. Counterparty identity | partial **GAP-1** | partial **GAP-1** | n/a | n/a | n/a | n/a | partial **GAP-1** | n/a |
| 18. Finance access provisioning | n/a (no grant) | n/a | n/a | n/a | n/a | n/a | n/a | ✔ |
| 19. Finance map | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a (no `map.view`) |
| 20. **Own work queue** | **GAP-4** | **GAP-4** | **GAP-4** | **GAP-4** | partial (revisions only) | partial (publication only) | **GAP-4** | **GAP-4** |

---

## 5. Gap list, severity-ranked

### BLOCKER

---

#### GAP-1 — `finance.transaction.view` has no endpoint, no screen, and is bypassed by the report route

**What is missing.** There is no staff transaction register anywhere. No route serves `GET /api/finance/transactions`; the complete finance route inventory is the 85 routes in `src/routes/finance-{budget,config,documents,imports,projects,public,publication,reports,spatial,users}.js` and none of them is it. There is no `TransactionsSection.vue` in `src/modules/finance/pages/sections/` (15 files, all enumerated in §3). `finance.transaction.view` (`migrations/188_finance_foundation.sql:1065`) is never read by any `requirePermission` call in the backend — `grep -rn "transaction.view" src/` returns only three hits, all for the *counterparty* variant (`finance-projects.js:125`, `:172`, `:608`).

Evidence that it was intended to exist: `src/middleware/auditLog.js:92` already carries the audit rule `{ match: '/finance/transactions', event: 'FIN_TRANSACTION', severity: 'high', entity: 'finance_transaction' }` for a route that does not exist.

**Who it harms.** `finance_admin`, `finance_officer`, `finance_committee`, `auditor` — the four holders of the permission. Their only sight of a transaction is (a) one project's trace (`ProjectsSection.vue:834-847`, gated by `finance.project.view` via `finance-projects.js:70`) or (b) the `transaction_register` **report** (`finance-reports.js:78`).

**The control inversion.** The `transaction_register` report is gated by `finance.report.view` only (`finance-reports.js:63` → `:444`, `:486`; SQL at `:312-331`). So `budget_officer`, `dept_head`, `publisher` and `admin`, none of whom holds `finance.transaction.view`, can read the whole year's transaction register — department-scoped for `dept_head` (`:328`), unscoped for the others. `admin` reading the register contradicts `188:1104-1105` ("the TECHNICAL administrator… No… counterparty access") in spirit: counterparty columns are correctly withheld (`:319`, needs `finance.report.export_restricted`), but every other transaction field is served.

**Recommendation (one task, ~2 days).**
1. Backend: add `GET /api/finance/transactions` to `finance-budget.js` (it already owns `finance.transaction` reads), `preHandler: requirePermission(fastify, 'finance.transaction.view')`, with `financial_year_id`, `department_id`, `account_id`, `budget_line_id`, `ward_code`, `record_type`, `from`/`to`, `q`, paging and the closed-set sort pattern already used at `finance-budget.js:84-90`. Counterparty columns present only when `hasPermission(..., 'finance.transaction.view_counterparty')`, exactly as `finance-projects.js:172` already does. Apply `departmentScope()`.
2. Backend: add `finance.transaction.view` as an **additional** requirement on `report === 'transaction_register'` in both `/finance/reports/run` and `/finance/reports/export` — a narrowing, not a weakening; it makes the catalogue's own statement true. The report catalogue response (`finance-reports.js:67-84`) should drop `transaction_register` from `reports[]` for callers who lack it, so the picker never offers a 403.
3. Frontend: `TransactionsSection.vue` in the `budget` group (`FinanceWorkspace.vue` `SECTIONS`, after `revisions`), `requires: ['finance.transaction.view']`; `financeApi.transactions()`; a row drills to its budget line (reuse `BudgetSection.openLine`) and to its import batch (`ImportsSection.openBatch`), closing the lineage loop the import pipeline already records. Suppressed counterparty columns get the sentence already written at `ProjectsSection.vue:820-824`.

---

#### GAP-2 — the spatial-allocation workflow has a complete backend and no frontend at all

**What is missing.** Five routes, all unreachable from the browser:

| Route | File:line | Guard |
|---|---|---|
| `GET /finance/spatial-allocations` | `finance-spatial.js:93` | `finance.map.view` |
| `POST /finance/spatial-allocations` | `finance-spatial.js:137` | any of `finance.budget.prepare`, `finance.project.manage` |
| `POST /finance/spatial-allocations/:id/approve` | `finance-spatial.js:248` | any of `finance.budget.approve`, `finance.project.approve` |
| `POST /finance/spatial-allocations/:id/reject` | `finance-spatial.js:254` | as above |
| `POST /finance/spatial-allocations/:id/withdraw` | `finance-spatial.js:261` | prepare/manage/approve set |

`src/modules/finance/api/financeApi.ts` (647 lines, every call enumerated) contains no `spatial` or `allocation` call other than `ProjectAllocation` (budget→project money, a different thing) — so these five are dead from the UI's point of view. The decision logic at `finance-spatial.js:210-246` already enforces status `draft`, the correct per-subject approval permission, and `requested_by ≠ decider` (`:231-234`). The withdrawal path distinguishes draft-by-requester from approved-by-approver (`:277-288`).

**Why it is a blocker and not a nicety.** `ARCHITECTURE-ASSESSMENT.md §6.1` principle 7 is binding: *"Allocations are auditable acts with explicit methodology; splits never default to equal division."* `finance.v_ward_performance` (migration 199) and therefore the whole choropleth in `MapSection.vue` prefers allocations over `ward_code` where allocations exist (the all-or-nothing rule, `§6.2(1)`). Today no officer can create one, so the map can only ever show the degenerate single-`ward_code` case, and `ward_code` itself is a free-text input (`BudgetSection.vue:464`, `maxlength="24"`) with no picker. A multi-ward road or clinic budget — the normal case for a rural district — cannot be represented at all.

**Who it harms.** `finance_admin`, `finance_officer`, `dept_head` (cannot record a split); `finance_committee` (cannot decide one); every `finance.map.view` holder (sees a map whose geography cannot be made correct).

**Recommendation (one task, ~3 days).**
1. `financeApi.ts`: five calls mirroring the routes, plus the `target_status` field (`'linked' | 'unlinked' | 'ward_register_empty'`, `finance-spatial.js:113-123`) in the model.
2. An **Allocation drawer** opened from a budget line (`BudgetSection.vue`, beside `raiseRevision` at `:571`) and from a project (`ProjectsSection.vue`, beside `allocate` at `:695`), not a new section: the split belongs to the subject. Fields: target ward (picker, see GAP-10), amount, optional share, `methodology` (required, `finance-spatial.js:141`), evidence document (reuse `DocumentsSection` upload). Running "Σ allocated / subject revised" with the remainder shown as *unallocated*, never spread.
3. A **Splits awaiting decision** panel in `MapSection.vue` (or the Revisions pattern), filtered `status=draft`, with the `RevisionsSection.vue:109` self-approval guard reproduced verbatim.
4. Replace `GET /finance/unlocated`'s absence of a caller (GAP-11) by using it for the "unallocated remainder" figure.

**Council dependency:** D15 (approval authority and required methodology evidence for multi-area allocations) is **open** — `DECISION-REGISTER.md:206`. The screens can be built now because the backend already encodes the conservative default (approval by the subject's approval permission, requester ≠ decider); D15 may later *change the authority*, not whether the screen exists. Do not pre-fill any methodology text.

---

#### GAP-3 — any `finance.document.view` holder, including the read-only auditor, can withdraw a finance document

**What is wrong.** `DELETE /api/finance/documents/:id` is guarded by `canView` = `finance.document.view` (`finance-documents.js:294` with `canView` defined at `:77`). The frontend mirrors it exactly: `DocumentsSection.vue:78` `const canWithdraw = computed(() => store.can('finance.document.view'))`, button at `:486`. So the soft-delete is available to `auditor`, `publisher` and `finance_committee` — three roles that hold no upload or write permission over documents.

`auditor` is specified as *"read-only, including the audit trail; writes nothing"* (`188:1103`) and its grant list (`188:1203-1214`) contains no write permission at all. This is the single place where that statement is false. The record survives (soft delete, `finance-documents.js:289-292`), but the document stops being listed and stops being served, which for an auditor is exactly the wrong capability.

**Who it harms.** The integrity of the control, and anyone relying on `auditor` being non-destructive. Also `publisher`, which should release documents, not remove them.

**Recommendation (one task, ~2 hours).** Change `finance-documents.js:294` from `...canView` to `requirePermission(fastify, 'finance.document.upload')` — the permission whose description is "Upload finance documents" and which is held by exactly the four roles that add documents (`finance_admin`, `finance_officer`, `budget_officer`, `dept_head`). Change `DocumentsSection.vue:78` to match and add the `whyUnavailable('finance.document.upload')` sentence for the rest. Add a backend test asserting an `auditor` session receives 403 and that the refusal is audited. This is a narrowing of authority and so is permitted by the constraints; the alternative of a new `finance.document.withdraw` code is also defensible but adds a 35th permission for one button.

---

### MAJOR

---

#### GAP-4 — no role-shaped landing, and no work queue for six of eight roles (milestone M6)

**What is missing.** Three separable things, none of which exists.

*(a) Landing.* `FinanceWorkspace.vue:199-203` resolves the open section to `visibleSections.value[0]`, and `SECTIONS[0]` is `overview` (`:92`) whose gate is `['finance.budget.view','finance.actuals.view']` (`:94`) — held by all eight roles. So all eight land on the same page. The role string is used nowhere except the display label (`:158-172`, consumed at `:253`).

*(b) Rail shape.* The rail is permission-filtered only (`:190`). Because `years`, `classifications`, `budget`, `revisions`, `settings` and `publication` all accept bare `finance.budget.view` (`:101`, `:104`, `:108`, `:111`, `:140`, `:128`), a `publisher` sees 12 sections of which 2 are its job, and `admin` sees 14 of which 2 are its job (§3). The `publication` gate including `finance.budget.view` (`:128`) is the widest: four roles that can do nothing in that section still see it.

*(c) Queues.* Exactly two exist, both inside their own section and neither visible on arrival:
- `RevisionsSection.vue:108-110` — `pending` / `awaitingMe` / `myOwnPending`, rendered as banners at `:136-138` and `:140-145`. This is the correct pattern and includes the self-approval refusal. But `stateFilter` defaults to `''` (`:17`), so the committee must still scan all states.
- `PublicationSection.vue:170-172` — `live` / `queue` / `history`, with `wouldSelfPublish` at `:167` and the refusal note at `:358`.

Nothing else. `BudgetSection.vue:43` initialises `query` with no `status`, so a committee member opening Budget sees draft, submitted, returned, approved and published lines in one list and must choose `submitted` manually from `:385-391`. A `dept_head` has no "my department's lines still in draft". `ProjectsSection` offers an `awaiting_approval` filter option (`:503`) with no default and no count. `ImportsSection` has no "validated, awaiting commit" list. There are no counts or badges in the rail anywhere, and no notification mechanism in the module (no `notify`/`inbox` identifier in `src/modules/finance/` outside the two cases above; no notification code in any `src/routes/finance-*.js`).

**Who it harms.** All eight, most acutely `publisher` and `admin` (rail is mostly irrelevant), `finance_committee` (its three approval duties have one queue out of three), `dept_head` (scoped to its votes but with no view of its own pipeline).

**Recommendation (one task, ~4 days).** See §6 for the per-role specification. Mechanically:
1. Add to `stores/finance.ts` a `rolePreset` computed keyed on `identity.role` returning `{ landing: SectionKey, foreground: SectionKey[], defaultFilters: Record<string, unknown> }`. Keep it a *presentation* preset: it must not change `can()` and must not hide a section the permission allows (the rail stays complete, ordered differently).
2. `FinanceWorkspace.vue:199-203`: when `route.query.section` is absent, open `rolePreset.landing` instead of `visibleSections[0]`; keep the existing URL-correction watcher at `:228-232` untouched so links still win.
3. Render the rail in two bands — "Your work" (preset `foreground`) and "Also available" (the rest) — reusing `fin-rail-group` (`:276-289`). A section in the second band keeps working; it is only de-emphasised. This satisfies the constraint that the frontend explains rather than gates.
4. Generalise the `RevisionsSection.vue:108-110` queue shape into a small `useWorkQueue(kind)` composable and mount it on Budget (`status=submitted` for approvers, `draft`+`returned` for preparers), Projects (`awaiting_approval`), Imports (`status=validated`), Publication (already present), plus a count on the rail item.
5. Give Overview a role-conditional first block: the queue the role owns, above the departmental table it mostly does not act on.

---

#### GAP-5 — budget line submit → approve is an invisible handover

**What is missing.** `finance-budget.js:301` moves a line to `submitted`; `:334` approves it; `:313` returns it. On the frontend the three controls exist (`BudgetSection.vue:556`, `:561`, `:566`). Nothing tells the next actor. `finance_committee` gets no count, no banner and no default filter — `BudgetSection.vue:43` has no `status` in the initial query, and the only cue is the manual `:385-391` selector. Symmetrically, a preparer whose line was **returned** (`:389` offers the filter) is never told; `returned` is a terminal silence.

**Who it harms.** `finance_committee` (may not know a budget is waiting), and `finance_admin`/`finance_officer`/`budget_officer`/`dept_head` (may not know a line came back).

**Recommendation (~1 day, part of GAP-4's item 4).** Reproduce the Revisions pattern in `BudgetSection.vue`: `pending`/`awaitingMe` computeds on `status==='submitted'` for `canApprove` holders, `mine`/`returned` for `canPrepare` holders, banners above the filter bar, and set the initial `query.status` from the role preset. The `return` note (`finance-budget.js:313` requires one) should be shown on the line row, not only in the audit trail.

---

#### GAP-6 — validated import batches have no "awaiting commit" queue, and only one role can commit

**What is missing.** By design, `finance_officer` validates but cannot commit — `finance.import.commit` is granted to `finance_admin` alone (`188:1121`), the second-pair-of-eyes rule stated at `188:1097-1098`. `ImportsSection.vue:961` correctly explains the refusal to the officer. But the `finance_admin` who must act has no list of batches in status `validated`: `ImportsSection.vue:451-455` loads batches with whatever filter is set, and there is no default, no count and no banner. A validated batch can sit indefinitely with nobody informed.

**Who it harms.** `finance_admin` (the only committer), and the actuals pipeline, which stalls silently.

**Recommendation (~0.5 day).** An `awaitingCommit` computed over `batches` filtered `status==='validated'`, a banner for `canCommit` holders, and `status: 'validated'` as the `finance_admin` preset default for the Imports section.

---

#### GAP-7 — project approval has a control but no queue, and project submit is held by `project.manage`

**What is missing.** `ProjectsSection.vue:687` submits (`finance-projects.js:371`, guarded by `canManage` = `finance.project.manage`) and `:691` approves (`:381`, `finance.project.approve`). `finance_committee` holds `project.approve` but **not** `project.manage`, so it sees the Approve button only on rows already in `awaiting_approval` (`:690` condition) — correct — but has no list of them. The `awaiting_approval` filter option exists at `:503` with no default and no count.

**Who it harms.** `finance_committee`; and `finance_admin`/`finance_officer`/`dept_head`, whose submitted projects may wait unseen.

**Recommendation (~0.5 day, same composable as GAP-4/5).** `awaitingMe` banner for `canApprove` holders, self-submission guard mirroring `RevisionsSection.vue:109`, and `status: 'awaiting_approval'` as the `finance_committee` preset default for Projects.

---

#### GAP-8 — the finance map has no project layer and no project endpoint

**What is missing.** `ARCHITECTURE-ASSESSMENT.md §6.3` specifies `GET /api/finance/map/projects?year&currency&status&bbox`. `finance-spatial.js` serves only `/finance/map/wards` (`:322`) and `/finance/map/ward-geometry` (`:391`). `MapSection.vue` renders two ward layers (`:194`, `:198`) and lists a selected ward's projects as text (`:352-355`), fetched through the ordinary project list (`:107`). No point geometry is drawn, although `GET /finance/projects` already returns `ST_X(pr.location) AS longitude, ST_Y(pr.location) AS latitude` (`finance-projects.js:97-98`) and `finance.project.location` has a GIST index (migration 188).

**Who it harms.** Every `finance.map.view` holder; the capital-projects view (milestone M5) does not exist.

**Recommendation (~2 days).** `GET /finance/map/projects` guarded by `finance.map.view`, reading `finance.v_project_performance` joined to `finance.project.location` (render, never compute — §6.1 principle 2), with unlocated projects returned as a separate list. Graduated circles in `MapSection.vue` on the existing MapLibre instance, status-categorised; clicking a circle opens the existing trace panel (`ProjectsSection.open()`), so one record has one detail view. **Blocked for the progress-vs-spend overlay only** on D12 (`DECISION-REGISTER.md:167`): `physical_progress_percent` does not exist in the schema. Build the layer without it; do not invent a progress figure.

---

#### GAP-9 — the public user, persona 9, has no map and no ward view

**What is missing.** `CouncilFinanceView.vue` (750 lines) has no map: the only spatial token in it is a ward *label* on a project row (`:592`). No `/api/public/finance/map/*` route exists — `finance-public.js` serves `years` (`:61`), `overview` (`:79`), `budget` (`:185`), `revenue`/`expenditure` (`:238`), `transactions` (`:291`, `:344`), `projects` (`:360`), `documents` (`:414`) and nothing geographic. This is milestone M7.

**Who it harms.** The ninth persona — the citizen, for whom "where did the money go in my ward" is the primary question the GIS integration exists to answer.

**Recommendation (~2 days, after D14).** `GET /api/public/finance/map/wards?year` reading `finance.v_ward_performance` under anonymous RLS so only rows passing `published_select` appear (migrations 194/197 shape), aggregated per ward only, no counterparties, no individual project points unless the projects dataset is published. A map panel in `CouncilFinanceView` reusing `MapSection`'s choropleth code. **Blocked on D14** (public map disclosure matrix, `DECISION-REGISTER.md:193`) — which ward-level aggregates may be released is a Council decision and must not be chosen by the implementation.

---

#### GAP-10 — `ward_code` is free text on every screen that writes it

**What is missing.** `BudgetSection.vue:464` is `<input id="bl-ward" v-model="form.ward_code" class="ins-input" maxlength="24" />` — a plain text box, used by `create()` (`:145`) and `save()` (`:196`). The backend accepts it deliberately (import resilience, `ARCHITECTURE-ASSESSMENT.md §6.2(2)`) and flags unknown codes rather than rejecting them. `ARCHITECTURE-ASSESSMENT.md §6.2(2)` specifies "UI gets a ward picker fed by the authority's linked wards"; it does not exist. The filter box at `BudgetSection.vue:374` is likewise free text.

**Who it harms.** Every preparing role; and the map, since a typo silently becomes an `unlinked` ward that the choropleth cannot shade.

**Recommendation (~1 day).** A ward picker component fed by `GET /finance/map/ward-geometry` (`finance-spatial.js:391`), which already returns the authority's current wards and the `ward_register_empty` flag. When the register is empty (**D11 open**, `DECISION-REGISTER.md:154`) the picker degrades to the current free-text input with the sentence `MapSection.vue:377` already uses. Do not populate `admin.authority_ward` from the 19 COD-AB ZW1704 wards — that is the Council's confirmation to make.

---

### MINOR

---

#### GAP-11 — `GET /finance/unlocated` has no caller

`finance-spatial.js:300`, guarded by `finance.map.view`, reads `finance.v_unlocated_finance`. `MapSection.vue:59-60` instead uses the `unlocated` array embedded in `/finance/map/wards`. The dedicated endpoint is therefore unreachable. Either call it where a year-wide unlocated figure is needed outside the map (Overview, Reports) or delete it; a route with no caller and no test is a maintenance liability. **Recommendation:** use it for the Overview "what has no geography" card in the GAP-4 work (~2 hours).

#### GAP-12 — `PATCH /finance/column-mappings/:id` has no caller

`finance-config.js:690`. `financeApi.ts` has `createColumnMapping` (`:230`) and `columnMappings` (`:235`) only; `ImportsSection.vue:213` creates a profile and `:216`/`:469` lists them, but nothing edits one. A mis-named or wrong mapping profile can only be superseded, never corrected. **Recommendation:** an edit affordance in the mapping-profile panel around `ImportsSection.vue:749` (~3 hours).

#### GAP-13 — `finance.transaction.view_counterparty` is only ever an explanation, never an affordance

The permission is held by `finance_admin`, `finance_officer`, `auditor`. Everywhere it appears it governs a *suppression message*: `ProjectsSection.vue:820-824` and `:834`/`:847`, `LinkedFinancePanel.vue:191-194` and `:202`/`:212`, `DocumentsSection.vue` (visibility wording), plus the restricted-export checkbox which is a different code. Holding it unlocks two columns in one project trace. This resolves once GAP-1 lands; recorded separately because it is the measurable symptom.

#### GAP-14 — variance explanation is not reachable from the exception that prompts it

`FinanceOverviewSection.vue:47` loads flagged exception rows and `:114` has `openSection()`, but the section jump carries no line identifier, and the Explain control lives on the Budget row (`BudgetSection.vue:575`). An officer told "this line is over budget" on Overview must re-find the line in Budget. **Recommendation:** make the Overview flagged rows deep-link `?section=budget&line=<id>`, and have `BudgetSection` open that line's detail panel on mount — the panel and `openLine()` (`:120`) already exist (~3 hours).

#### GAP-15 — `finance_admin` cannot see or administer finance access, and nothing says why

Only `admin` holds `finance.users.manage_finance_roles` (`188:1222`), so the Access section (`FinanceWorkspace.vue:135-137`) is invisible to the finance administrator. That is the correct separation, but a finance administrator looking for "who has which finance role" finds no section and no explanation. **Recommendation:** extend `PermissionsSection.vue` (already the "what your role may do" page, `:115`) with a read-only statement that role provisioning is the technical administrator's duty and is deliberately held apart from financial authority, quoting the catalogue description at `188:1087`. No new permission (~2 hours).

#### GAP-16 — documentation says twelve sections; there are fifteen

`REQUIREMENTS.md:358`, `router/index.ts:790-791` and the `FinanceWorkspace.vue:10-15` docblock's group list all predate `map`, `documents` and `access`. `SECTIONS` at `FinanceWorkspace.vue:91-141` defines fifteen and `type Group` at `:70` includes `geo`. Cosmetic, but it is the text a reviewer uses to check coverage (~30 minutes).

---

## 6. What a role-based workspace must do

Per role: the landing section, default filters, the queue it needs, what to foreground and what to keep but de-emphasise. **No role loses access to any section** — the rail stays complete and permission-filtered as now (`FinanceWorkspace.vue:190`); this is ordering and emphasis, and the backend remains the only gate (`stores/finance.ts:45-50`).

### finance_admin — 26 permissions; the operator of the cycle
- **Landing:** `imports` when any batch is in `uploaded`/`mapped`/`validated`, otherwise `overview`.
- **Default filters:** Imports `status=validated` (it is the only committer, GAP-6); Budget unfiltered; selected year = newest open.
- **Queue it needs:** *Batches validated and awaiting your commit* (count + list). Secondary: *exceptions open across batches*, *publications you requested and their state*.
- **Foreground:** Imports, Budget, Classifications, Financial years, Projects, Documents, Settings.
- **Keep, de-emphasise:** Publication (can request, cannot approve or publish — the two controls it will never hold should read as explanations, `stores/finance.ts:57-70` already supplies the sentences), Audit (view only), Map, Permissions, Reports.

### finance_officer — 19 permissions; the data custodian
- **Landing:** `imports`.
- **Default filters:** Imports `status` in `uploaded,mapped,validating,validated`; Budget `status=draft,returned` (its own work).
- **Queue it needs:** *Open exceptions on your batches*; *lines returned to you*; *batches you validated, now awaiting commit* (so the handover to `finance_admin` is visible from the side that made it).
- **Foreground:** Imports, Budget, Projects, Documents, Reports.
- **Keep, de-emphasise:** Financial years, Classifications, Settings (read-only: no `finance.config.manage`), Publication, Permissions, Map.

### budget_officer — 13 permissions; the preparer
- **Landing:** `budget`.
- **Default filters:** Budget `status=draft,returned`; Revisions `state=draft`.
- **Queue it needs:** *Your draft and returned lines*; *your submitted lines awaiting the committee* (status, not action); *your draft revisions not yet submitted*; *lines flagged over/near threshold with no variance explanation* — it holds `finance.variance.explain` and that is the work.
- **Foreground:** Budget, Revisions, Reports, Documents, Map (allocations and unallocated areas, per `ARCHITECTURE-ASSESSMENT.md §6.4`).
- **Keep, de-emphasise:** Financial years, Classifications, Settings, Projects (view only), Publication, Permissions.

### dept_head — 13 permissions, confined to its votes (`finance.user_scope`)
- **Landing:** `budget`, pre-filtered to its scope. `FinanceWorkspace.vue:291-295` already states the confinement; the filter should state it too.
- **Default filters:** `department_id` locked to the scope (the backend already scopes every read via `departmentScope()`; the UI should show the department name rather than "All departments", which is currently what `BudgetSection.vue:382` offers and is misleading for a scoped user).
- **Queue it needs:** **"My department's lines awaiting my submission"** — this is the user's named example and it does not exist. Concretely: Budget filtered `status=draft` within scope, with a count. Plus *lines returned to my department*, and *my department's lines flagged and unexplained*.
- **Foreground:** Budget (own votes), Revisions, Projects (it holds `project.manage`), Documents.
- **Keep, de-emphasise:** Reports (view only — no `report.export`, and the export buttons at `ReportsSection.vue:200-208` must carry the explanation, not merely disappear), Financial years, Classifications, Settings, Publication, Map, Permissions.

### finance_committee — 14 permissions; the sole approver of three things plus publication
- **Landing:** a **decisions** view. Since no such section exists, land on `revisions` (the one section with a working `awaitingMe`, `RevisionsSection.vue:109`) until the queue composable of GAP-4 can drive an Overview decisions block.
- **Default filters:** Revisions `state=submitted`; Budget `status=submitted`; Projects `status=awaiting_approval`; Publication `state=pending`.
- **Queue it needs:** **"Revisions awaiting my approval"** — exists (`:136-138`). Missing: *budget lines awaiting approval* (GAP-5), *projects awaiting approval* (GAP-7), *publications awaiting approval* (partially present, `PublicationSection.vue:171`), *spatial splits awaiting decision* (GAP-2). In every case the self-approval exclusion of `:109` must be reproduced, and the "you cannot approve your own" warning of `:140-145` with it.
- **Foreground:** Revisions, Budget, Projects, Publication, Audit, Reports.
- **Keep, de-emphasise:** Financial years, Classifications, Settings, Imports (visible only through `finance.audit.view`, `FinanceWorkspace.vue:118`; it is lineage reading, not work), Documents, Map, Permissions.

### publisher — 9 permissions; the narrowest role and the worst-served rail today
- **Landing:** `publication`. It is the only section it acts in, and it currently lands on Overview.
- **Default filters:** Publication `state=approved` — "approved and awaiting publication" is its whole job.
- **Queue it needs:** **"Approved and awaiting publication"**. `PublicationSection.vue:170-172` already computes `queue` as pending+approved; split it so `approved` is the publisher's queue and `pending` is the committee's, each labelled for its owner. Keep `wouldSelfPublish` (`:167`) and its warning (`:358`). Secondary: *documents approved for release but still private* (it holds `finance.publication.publish`, which `finance-publication.js:440` uses for document visibility).
- **Foreground:** Publication, Documents.
- **Keep, de-emphasise:** the other ten. Budget, Revisions, Financial years, Classifications and Settings are visible only because their gate is bare `finance.budget.view` (`FinanceWorkspace.vue:101,104,108,111,140`); they should move to the second band so the publisher's two sections are not one-sixth of the rail.

### auditor — 13 permissions; read-only, with the widest disclosure
- **Landing:** `audit`.
- **Default filters:** Audit `refusedOnly=false`, last 30 days (`FinanceAuditSection.vue:28-29` currently defaults every filter to empty, i.e. everything ever); a *refused actions* quick filter is already at `:127` and should be a one-click chip.
- **Queue it needs:** not a work queue — a **review set**: *refused actions this period*, *approvals and publications this period*, *import commits with reconciliation overrides*, *budget lines flagged with no variance explanation*. All are selections over data it can already read.
- **Foreground:** Audit, Reports (it alone besides `finance_admin` holds `report.export_restricted`, `ReportsSection.vue:179-184`), Documents (restricted visible, `DocumentsSection.vue:66,90`), Budget, Map.
- **Keep, de-emphasise:** Financial years, Classifications, Settings, Projects, Publication, Permissions, Imports.
- **Must change:** remove its ability to withdraw a document (GAP-3). A read-only role with a destructive button is a worse defect than a missing screen.

### admin — 7 permissions; the technical administrator
- **Landing:** `access`. It is the only role that can provision finance roles (`188:1222`) and the only one for which that section renders.
- **Default filters:** Access list unfiltered; Audit last 7 days.
- **Queue it needs:** *finance roles changed recently*, *refused finance actions* (an access problem usually presents as a 403, and `src/middleware/auditLog.js` records refusals). Not a financial queue — `admin` must stay outside the money.
- **Foreground:** Access, Audit.
- **Keep, de-emphasise:** everything else. Overview, Budget, Revisions, Projects, Reports, Documents, Publication, Financial years, Classifications, Settings and Permissions are all visible to it today, eleven sections of financial content for a role that holds no financial authority. The `publication` gate's `finance.budget.view` fallback (`:128`) is the clearest case to tighten.
- **Note, not a gap:** `admin` has no `finance.map.view` (`199:228`), so no Finance map. Keep it that way and say so on the Permissions page.

### public user (persona 9) — no role
- **Landing:** `/council/finances` (`router/index.ts:145`), anonymous.
- **Needs:** the ward map it does not have (GAP-9), gated by D14.
- **Already correct:** published rows only, no counterparty identity anywhere (`finance-public.js`; `finance.v_published_transaction` has the columns structurally absent), and the honest empty state when nothing is published.

### Cross-cutting rules for the implementation
1. The preset is presentation only. `can()` (`stores/finance.ts:45-47`) must not consult it, and no section may become unreachable because of it — a URL with `?section=` continues to win (`FinanceWorkspace.vue:228-232`).
2. Where a role lacks a permission, show the explanation, never the button. The vocabulary already exists: `whyUnavailable()` (`stores/finance.ts:57-70`) distinguishes approval, publication and restricted-data refusals, and `FinanceGuard.vue` renders it. Six sections use it; the preset work should extend it to the de-emphasised sections so "visible but not yours" reads as intentional.
3. Every queue excludes the viewer's own submissions from their approval list, as `RevisionsSection.vue:109` does, and says so when they overlap (`:140-145`).
4. Queue counts come from the same filtered endpoints the lists use — no new count endpoints, no client-side totals over partial pages. All the relevant routes already return `total` or accept `limit`/`offset`.

---

## 7. Endpoint ↔ caller reconciliation

### (b) Backend routes with no frontend caller — 7 of 85

| Route | File:line | Why it matters |
|---|---|---|
| `GET /finance/spatial-allocations` | `finance-spatial.js:93` | GAP-2 |
| `POST /finance/spatial-allocations` | `finance-spatial.js:137` | GAP-2 |
| `POST /finance/spatial-allocations/:id/approve` | `finance-spatial.js:248` | GAP-2 |
| `POST /finance/spatial-allocations/:id/reject` | `finance-spatial.js:254` | GAP-2 |
| `POST /finance/spatial-allocations/:id/withdraw` | `finance-spatial.js:261` | GAP-2 |
| `GET /finance/unlocated` | `finance-spatial.js:300` | GAP-11 |
| `PATCH /finance/column-mappings/:id` | `finance-config.js:690` | GAP-12 |

Every other route in `finance-budget.js`, `finance-config.js`, `finance-documents.js`, `finance-imports.js`, `finance-projects.js`, `finance-publication.js`, `finance-public.js`, `finance-reports.js` and `finance-users.js` has a named caller in `src/modules/finance/api/financeApi.ts`. Six of the seven orphans are milestone-2 spatial work shipped backend-first.

### (c) UI controls with no backend — none found

Every `financeApi.*` method resolves to a route that exists. The inverse-shaped defect is GAP-3, where the UI gate matches a backend gate that is itself too permissive.

### (a) Permission codes checked against the frontend — 34 of 34

The caller's suspected list was **mostly wrong**, and that matters: ten of the eleven named suspects do have a screen and a control. Verified individually:

| Suspected | Verdict | Evidence |
|---|---|---|
| `finance.variance.explain` | **present** | `BudgetSection.vue:86`, button `:575`, handler `:276-289` → `finance-budget.js:620` |
| `finance.revision.submit` | **present** | `RevisionsSection.vue:36`, button `:221`, handler `:71` → `finance-budget.js:484` |
| `finance.year.close` | **present** | `FinancialYearsSection.vue:46`, button `:307`, handler `:140` → `finance-config.js:196` |
| `finance.project.approve` | **present** | `ProjectsSection.vue:70`, button `:691`, handler `:246` → `finance-projects.js:381` |
| `finance.transaction.view_counterparty` | **no affordance** | only suppression messages: `ProjectsSection.vue:820-847`, `LinkedFinancePanel.vue:191-212`. GAP-13 |
| `finance.audit.export` | **present** | `FinanceAuditSection.vue:32`, buttons `:133-139`, handler `:72-75` → `finance-reports.js:618` |
| `finance.report.export_restricted` | **present** | `ReportsSection.vue:55`, checkbox `:179-184`, sent at `:74`/`:95` → `finance-reports.js:460`, `:499` |
| `finance.document.view_restricted` | **present** | `DocumentsSection.vue:66`, `:90`, note `:326`; backend `finance-documents.js:206`, `:256` |
| `finance.publication.withdraw` | **present** | `PublicationSection.vue:59`, button `:286`, handler `:150` → `finance-publication.js:361` |
| `finance.users.manage_finance_roles` | **present** | `AccessSection.vue:55`, guard `:377`, handler `:176-195` → `finance-users.js:179` |
| `finance.import.exception.resolve` | **present** | `ImportsSection.vue:61`, button `:933`, handler `:413-442` → `finance-imports.js:931` |

Codes **not** on the suspect list, checked too: `config.manage` (`ClassificationsSection.vue:495,585,694,833`; `FinancialYearsSection.vue:186`; `FinanceSettingsSection.vue:184`; `ImportsSection.vue:749`), `budget.view/prepare/submit/approve` (`BudgetSection.vue:82-85`), `revision.prepare/approve` (`BudgetSection.vue:86`, `RevisionsSection.vue:37`), `actuals.view` (`FinanceOverviewSection.vue:46`), `import.upload/validate/commit` (`ImportsSection.vue:57,60`, `:515,708,953`), `project.view/manage` (`ProjectsSection.vue:69`, `MapSection.vue:106`), `document.view/upload` (`DocumentsSection.vue:76-78`), `report.view/export` (`ReportsSection.vue:44`), `publication.review/approve/publish` (`PublicationSection.vue:56-58`), `audit.view` (`FinanceWorkspace.vue:131`), `map.view` (`FinanceWorkspace.vue:97`).

**The single true permission-with-no-UI is `finance.transaction.view`** (GAP-1) — plus `finance.transaction.view_counterparty` reduced to an explanation (GAP-13) as its consequence.

---

## 8. Gaps blocked on Council decisions or on absent data

| Gap | Blocked on | Decision text | What can be built now |
|---|---|---|---|
| GAP-2 spatial allocation UI | **D15** — approval authority and required methodology evidence for multi-area allocations (`DECISION-REGISTER.md:206`; `ARCHITECTURE-ASSESSMENT.md §8`) | Open | All of it. The backend already encodes the conservative default (subject's approval permission; requester ≠ decider, `finance-spatial.js:231-234`). D15 may later change *who decides*, not whether the screen exists. Do not pre-fill methodology text. |
| GAP-10 ward picker | **D11** — the Council's official ward list for `admin.authority_ward` (`DECISION-REGISTER.md:154`) | Open; `admin.authority_ward` has **0 rows** (`ARCHITECTURE-ASSESSMENT.md §7`) | The picker, fed by `/finance/map/ward-geometry` (`finance-spatial.js:391`), which already reports `ward_register_empty`. It degrades to today's free-text input with the sentence at `MapSection.vue:377`. **Do not** load the 19 COD-AB ZW1704 wards as if confirmed. |
| GAP-8 progress-vs-spend overlay | **D12** — physical progress reporting (`DECISION-REGISTER.md:167`) | Open; `physical_progress_percent` **does not exist** in the schema | The project point layer and its status categories. Not the progress comparison, and no progress figure may be synthesised. |
| GAP-9 public map | **D14** — public map disclosure matrix (`DECISION-REGISTER.md:193`) | Open | The endpoint shape and the panel, behind the existing publication gate. Which aggregates are released is the Council's to set; defaulting to "all ward aggregates" would pre-empt D14. |
| Revenue-by-area / arrears measures on the map | **D13** — outstanding-revenue data source (`DECISION-REGISTER.md:180`) | Open; **no debtor or arrears amounts exist anywhere** — `revenue_link` carries keys and status bands only (`ARCHITECTURE-ASSESSMENT.md §5`, §7) | Nothing. Revenue maps can show budget and collections only. A "no arrears source" statement is the honest screen. |
| Any map data at all | **Data, not a decision** | `admin.authority_ward` 0 rows; 0 of 4 demo budget lines carry a `ward_code`; 0 projects; `finance.project.location` 0 populated (`ARCHITECTURE-ASSESSMENT.md §7`) | The screens. **No synthetic finance or ward data may be created to demonstrate them** — the assessment's explicit prohibition. |
| Currency presets | **D4** — currency policy and conversion method (`COUNCIL-DECISIONS.md` D4) | Open and inert | Per-currency views only, as now. No role preset may introduce a combined figure. |
| Approval thresholds in queues | **D6** — approval roles, delegated authorities and thresholds (`COUNCIL-DECISIONS.md` D6; `finance.approval_threshold` empty) | Open | Queues ordered by submission date and amount. No amount-based auto-approval and no threshold-based routing. |

Release gate unchanged: **D10** (UAT sign-off and a demonstrated restore test) is open; the system is not production-approved.

---

## 9. Summary

| Severity | Count | Gaps |
|---|:-:|---|
| BLOCKER | 3 | GAP-1 transaction register absent and its permission bypassed; GAP-2 spatial allocation has no UI; GAP-3 read-only auditor can withdraw documents |
| MAJOR | 7 | GAP-4 no role-shaped landing or queues (M6); GAP-5 budget submit→approve invisible; GAP-6 no awaiting-commit queue; GAP-7 no project approval queue; GAP-8 no project map layer; GAP-9 no public map; GAP-10 free-text ward code |
| MINOR | 6 | GAP-11 `/finance/unlocated` uncalled; GAP-12 `PATCH column-mappings/:id` uncalled; GAP-13 counterparty permission is explanation-only; GAP-14 variance explanation not reachable from the exception; GAP-15 finance_admin cannot see access administration; GAP-16 docs say twelve sections |

Suggested order: GAP-3 (hours, and it is a live control defect) → GAP-1 → GAP-4 with GAP-5/6/7 (one queue composable serves all four) → GAP-2 → GAP-10 → GAP-8 → GAP-9 → the minors.

Nothing in this audit recommends a new role, a new approval path, a weakened gate or invented data. GAP-1 item 2 and GAP-3 both *narrow* existing authority; every other recommendation adds a screen over a control the backend already enforces.
