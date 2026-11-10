# Vungu Planner — Statutory Workflow Shell

**Date:** 2026-05-15
**Scope:** Frontend-only build inside `src/views/VunguPlannerView.vue`.
**Statutory basis:** Section 26, Regional, Town and Country Planning Act [Chapter 29:12], with cross-references to UCA [29:15], Public Health Act [15:09], Model Building By-Laws (1977), Factories & Works Act [14:08], Liquor Licensing Act [14:12], Atmospheric Pollution Prevention Act [318], Mines & Minerals Act [21:05], Constitution of Zimbabwe.

## 1. Purpose

Equip the Town Planning Officer console (`VunguPlannerView.vue`) to carry out every duty in the five statutory functions of the role:

1. Processing planning permission applications under Section 26.
2. Conducting due diligence on each application.
3. Preparing reports for the Works and Planning Committee.
4. Drafting development permits with the 5-test conditions.
5. Issuing acknowledgement and notice letters within statutory deadlines.

The current view (2,748 lines, 8 right-rail tabs) is map-centric with no statutory framing. We replace the right rail with a step-wise statutory shell while keeping map + header intact.

## 2. Non-goals

- New backend endpoints. We use `dmApi` (already wired, 26 endpoints) where it exists. Anything else lives in memory + `localStorage`.
- Multi-user real-time collaboration on a case file. Tab-to-tab sync only.
- Database schema changes.
- Re-using or relocating the EO Planner, Building Inspector, or Planning Clerk consoles. Scope is strictly `VunguPlannerView`.

## 3. Architecture

Approach A from brainstorming: directory of statutory step components + composables.

```
src/views/VunguPlannerView.vue          # slim shell: header + map + statutory rail + drawer
src/views/planner/
  StatutoryShell.vue                    # 5-step container, lock gates, drawer toggle
  Step1Intake.vue                       # Register, classify, intake queue
  Step2DueDiligence.vue                 # File / compatibility / statutory / title / referrals
  Step3CommitteeReport.vue              # Report drafter + PDF export
  Step4PermitDrafting.vue               # Permit + 5-test conditions builder
  Step5Notices.vue                      # Acks, 26(3) public notice, outcome letters
  StatutoryClockBanner.vue              # 12-week clock strip
  CaseFileDrawer.vue                    # Council Tools (existing Resources/Villages/Returns/etc.)
  StepLockGate.vue                      # Renders locked/unlocked state per step
  FieldError.vue                        # Inline validation error display
src/composables/
  usePlannerCase.ts                     # CaseFile state, provide/inject, save orchestration
  useStatutoryClock.ts                  # Day counter + phase + warningLevel
  useConditionLibrary.ts                # Permit condition templates + 5-test gating
src/views/planner/__tests__/
  planner-composables.spec.ts           # Clock math + 5-test gating + lock transitions
```

File-size cap: every step component stays under 700 lines. Composables under 400 lines each.

## 4. Layout

Four horizontal zones inside the existing planner page chrome.

```
┌──────────────────────────────────────────────────────────────────────┐
│  PLANNER HEADER (unchanged: brand · search · draw tools · profile)   │
├──────────────────────────────────────────────────────────────────────┤
│  STATUTORY CLOCK BANNER (visible when case file is open)             │
│  Day 0 — Day 5 — Wk 4 — Wk 9 — Wk 12      [27 days left]             │
│  Markers: Intake | Ack | Notice | Objections | Report | Resolution   │
├─────────────────────────┬────────────────────────────────────────────┤
│                         │  RIGHT RAIL: STATUTORY SHELL               │
│                         │  Step 1 ▸ Intake & Register                │
│   MAP CANVAS            │  Step 2 ▸ Due Diligence                    │
│   (unchanged behaviour) │  Step 3 ▸ Committee Report                 │
│                         │  Step 4 ▸ Permit & Conditions              │
│                         │  Step 5 ▸ Notices & Acknowledgements       │
│                         │  ⚙ Council Tools  (drawer toggle)          │
└─────────────────────────┴────────────────────────────────────────────┘
                                          │
                                          ▼ slides in from right
                              ┌──────────────────────────────────────┐
                              │  COUNCIL TOOLS DRAWER                │
                              │  Resources / Villages / Returns      │
                              │  Permit Register / Costing / Tracker │
                              └──────────────────────────────────────┘
```

The clock banner hides when no case file is open. Steps 2–5 are locked until prerequisites are met (see § 8.2).

## 5. Step modules

### 5.1 Step 1 — Intake & Register

**Surfaces:**
- Intake queue (top, scrollable). Source: `dmApi.listPermits({ status:'registered', ... })` plus any in-flight `localStorage` drafts. Row click loads the case via `usePlannerCase.loadFromPermit(id)`.
- "Register new application" form, TPD-shaped:
  - Applicant: name, ID number, phone, email.
  - Property: stand number, ward, description, title-deed number.
  - Proposal: dev type, description, estimated cost, plinth area, floors, parking bays.
  - Intake checks: fee paid (Y/N + amount + receipt no), copies submitted (≥3), title-deed attached, bondholder consent.
  - Classification radio: `routine_26_1` / `special_consent_26_3` / `preliminary` / `change_of_use` / `building_ops` / `mining`.
- Submit handler:
  1. Validate (§ 8.6 table).
  2. Generate registration number `VR-YYYY-NNNN`, file ref, application date = now.
  3. `dmApi.createPermit(payload)` → store returned `permitId` on case.
  4. Persist case to `localStorage` cache.
  5. Surface success toast; unlock Step 2; auto-advance to Step 5 → "Send acknowledgement".

### 5.2 Step 2 — Due Diligence

Five accordion sub-panels. Every check has `pass | fail | n/a` + officer notes. Step completes when planner ticks "Due diligence complete".

- **File checks:** existing use rights, prior applications, active enforcement orders, title-deed restrictions. Sourced from `dmApi.getPermitById` history and map layer queries.
- **Compatibility:** zoning, conflict of use, multi-stand use, layout conformity, traffic circulation, coordinated development, environmental sensitivity, public health adjacency.
- **Statutory provisions table** (9 rows): RTCP, UCA, Public Health, Building By-Laws, Factories, Liquor, Atmospheric, Mines, Constitution.
- **Title-deed verification:** if conflict, requires deed photostat + bondholder consent + public-notice flag.
- **External referrals:** multi-select departments (Health, Environment, Lands, ZESA, ZINWA, Telecom, etc.); each adds a `dmApi.addConsultation` row.

"Due diligence complete" button sets `dueDiligence.completedAt`, unlocks Step 3.

### 5.3 Step 3 — Committee Report

Structured drafter with 7 sections matching the brief:

1. Application particulars (auto-filled from Step 1).
2. Description of proposed development (auto-filled, editable).
3. Site context (free text + "Capture map snapshot" → PNG via existing MapLibre instance).
4. Policy & statutory analysis (auto-pulled from Step 2 ticks).
5. Public response (objections list via `dmApi.listObjections` + officer's view per objection).
6. Recommendation radio: `approve` / `approve_modified` / `refuse` / `defer` + reasons text.
7. Tabling: date tabled, date of Council resolution, resolution text.

"Export to PDF" via existing `jsPDF` dependency. Recording the resolution date:
- Unlocks Step 4 if recommendation ∈ {approve, approve_modified}.
- Unlocks Step 5 outcome letter path if recommendation ∈ {refuse, defer}.

### 5.4 Step 4 — Permit & Conditions

Two sub-panels.

**Permit core (Annexure 6):** permit number (auto), file ref (carried), use class (I–VI dropdown), permitted-development description, conditions list, applicant rights boilerplate, issue date, issuing officer (from auth store).

**Conditions builder:** template library covers setbacks, materials, parking, hours of operation, landscaping, services, commencement time-limit, stage inspections, plus custom. Each condition row has a checkbox set for the five legal tests — necessity, relevance, enforceability, precision, reasonableness. A condition with any test unchecked renders with a red ring and blocks permit issue (see § 8.3).

**Annexure 7 notes:** auto-generated template covering right of appeal (1 month to Administrative Court), risk warning, amendment under 26(12), expiry date, burden of land. Editable.

"Issue permit" → `dmApi.issuePermit(permitId, payload)` + downloadable PDF.

### 5.5 Step 5 — Notices & Acknowledgements

Three sub-flows:

- **Acknowledgement letter** (statutory deadline: 5 working days from receipt). Auto-drafted on Step 1 submit. "Send acknowledgement" records `acknowledgedDate` — this is what starts the statutory clock. Alternative path: "Return with reasons" produces a deficiency letter if the application is incomplete.
- **Section 26(3) public notice** (only visible if classification = `special_consent_26_3`):
  - Newspaper + publication date + abutting-owner list + proof-of-publication upload deadline (7 days).
  - Objections-period countdown card.
  - Each objection has its own 14-day applicant-response timer.
- **Final outcome letter.** Auto-drafted from Step 3 recommendation + Step 4 permit (or refusal reasons). One-click send.

### 5.6 Council Tools drawer

Holds existing Resources / Villages / Returns / Scheme / Consult content intact, restructured as vertical accordion sections. Toggle from bottom of statutory shell. Hidden by default.

## 6. Composables & shared logic

### 6.1 `usePlannerCase()`

Single source of truth for the active case file. Provided at `StatutoryShell` level, injected by every step.

```ts
interface CaseFile {
  // Step 1
  registrationNo: string
  fileRef: string
  permitId: string | null
  applicant: { name: string; idNumber: string; phone: string; email: string }
  property:  { standNo: string; ward: string; description: string; titleDeedNo: string }
  proposal:  { devType: DevType; description: string; estimatedCost: number
               plinthArea: number; floors: number; parkingBays: number }
  intake:    { feePaid: boolean; feeReceiptNo: string; feeAmount: number
               copiesSubmitted: number; titleDeedAttached: boolean
               bondholderConsent: boolean }
  classification: 'routine_26_1' | 'special_consent_26_3' | 'preliminary'
                | 'change_of_use' | 'building_ops' | 'mining'
  applicationDate:  string                    // ISO
  acknowledgedDate: string | null
  expiryDate:       string | null             // ack + 90 days
  // Step 2
  dueDiligence: {
    fileChecks:        Record<FileCheckKey, CheckResult>
    compatibility:     Record<CompatKey,    CheckResult>
    statutoryChecks:   Record<StatuteKey,   CheckResult>
    titleDeedConflict: { hasConflict: boolean; deedFileName?: string
                         bondholderConsentReceived?: boolean }
    referrals: Array<{ department: string; contactedAt: string
                       response: string; outcome: ConsultationOutcome }>
    completedAt: string | null
  }
  // Step 3
  committeeReport: {
    siteContext: string
    policyAnalysis: string
    publicResponseNotes: string
    recommendation: 'approve' | 'approve_modified' | 'refuse' | 'defer'
    recommendationReasons: string
    tabledAt: string | null
    resolutionAt: string | null
    resolutionText: string
  }
  // Step 4
  permit: {
    permitNo: string
    useClass: 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI'
    permittedDescription: string
    conditions: PlanningCondition[]
    annexure7Notes: string
    issueDate: string | null
    issuingOfficer: string
  }
  // Step 5
  notices: {
    ackSentAt:           string | null
    ackReturnedAt:       string | null
    publicNotice:        { newspaper: string; publishedAt: string
                           abuttingOwners: string[]; proofUploadedAt: string | null } | null
    objections:          Objection[]
    outcomeLetterSentAt: string | null
  }
  // Bookkeeping
  lastEditedAt: string
}
```

Exposes: `loadFromPermit(id)`, `registerNew(payload)`, `save()` (debounced 800 ms — writes to localStorage + applies dmApi mutations for backed fields), `clear()`. Reactive selectors: `step2Unlocked`, `step3Unlocked`, `step4Unlocked`, `step5Available` (always true).

### 6.2 `useStatutoryClock()`

Pure-function logic, reactive on `acknowledgedDate`. Recomputes every minute via `setInterval`.

```ts
interface ClockState {
  ackDate:       Date | null
  expiryDate:    Date | null               // ack + 90 calendar days
  daysElapsed:   number
  daysRemaining: number                    // can go negative
  weekNumber:    number                    // 0..13
  phase: 'pre_ack' | 'consultation' | 'objections'
       | 'report_drafting' | 'committee' | 'permit_issue'
       | 'overdue' | 'deemed_refused' | 'completed'
  warningLevel: 'ok' | 'caution' | 'urgent' | 'critical'
}
```

Warning thresholds: ok = >30 days, caution = 30–15, urgent = 14–1, critical = ≤0.

Exports `weekMilestones()` for the timeline banner markers.

### 6.3 `useConditionLibrary()`

Permit conditions with built-in 5-test gating.

```ts
type ConditionCategory =
  | 'setback' | 'materials' | 'parking' | 'hours' | 'landscaping'
  | 'services' | 'commencement' | 'inspection' | 'custom'

interface PlanningCondition {
  id: string
  category: ConditionCategory
  text: string
  tests: {
    necessity: boolean; relevance: boolean; enforceability: boolean
    precision: boolean; reasonableness: boolean
  }
}

// Composable also exposes:
//   passesAllTests(c): boolean       — true iff every test === true
```

Exposes `templates: ConditionTemplate[]` (the eight standard categories from the brief) and `addFromTemplate(key)`.

## 7. Data flow

Three persistence tiers, picked per field.

| Tier | Mechanism | Used for |
|---|---|---|
| 1 | `dmApi` | Permit CRUD, consultations, objections, permit issue, status transitions |
| 2 | Reactive in-memory state | Due-diligence checks, report drafts, ack/notice drafts, 5-test gating, 26(3) tracker |
| 3 | `localStorage` cache | Draft preservation; debounced 800 ms after any mutation |

**Tier 1 endpoints used:**

| Step | Call |
|---|---|
| 1 | `dmApi.listPermits({ status, search, limit, offset })`, `dmApi.createPermit(payload)`, `dmApi.getPermitById(id)` |
| 2 | `dmApi.addConsultation(permitId, payload)`, `dmApi.listConsultations(permitId)` |
| 3 | `dmApi.updatePermitStatus(permitId, status, reason)`, `dmApi.listObjections(permitId)` |
| 4 | `dmApi.issuePermit(permitId, payload)` |
| 5 | `dmApi.addObjection(permitId, payload)`, `dmApi.listObjections(permitId)` |

**localStorage layout:**

```
planner_case_<permitId>   = JSON.stringify(CaseFile)
planner_case_new_draft    = JSON.stringify(CaseFile)   // pre-persistence draft
planner_recent_cases      = JSON of [{ permitId, label, openedAt }]   // last 10
```

On load, `usePlannerCase.loadFromPermit(id)` prefers `planner_case_<id>` if its `lastEditedAt` is newer than the `dmApi.getPermitById` server timestamp, surfacing "Resume draft from <relative time>" before applying.

**Error contract:** every API call routes through `useUiFeedback()` + `parseApiError`. No silent catches.

## 8. Error handling & edge cases

### 8.1 Deemed refusal (Section 26(7))

When `daysRemaining ≤ 0` without a recorded resolution, `useStatutoryClock` returns `phase = 'deemed_refused'` and `warningLevel = 'critical'`. Banner turns red full-width: "DEEMED REFUSED — applicant may appeal to Administrative Court". Permit-issue button in Step 4 disables. Step 5 surfaces "Generate appeal-rights notice".

Earlier-warning tiers fire at:
- 30 days remaining → yellow, "Committee report due"
- 14 days remaining → orange, "Urgent — schedule for next committee"
- 1 day remaining → red, "Decision required today"

### 8.2 Step prerequisites

`StepLockGate` reads from `usePlannerCase` selectors and renders a locked state until conditions met:

| Step | Unlocks when |
|---|---|
| 2 | `permitId !== null` |
| 3 | `dueDiligence.completedAt !== null` |
| 4 | `committeeReport.resolutionAt !== null` AND `committeeReport.recommendation ∈ {approve, approve_modified}` |
| 5 | Always available — ack at Step 1, outcome letter unlocks at Step 4 |

Composable mutation guards reject writes to locked steps (defence in depth).

### 8.3 5-test gate for permit issue

```ts
canIssuePermit = conditions.every(c => passesAllTests(c))
              && permitNo.length > 0
              && useClass !== ''
              && permittedDescription.length > 20
```

Failure → `openMessageBox` titled "Conditions do not meet the 5 legal tests" listing non-compliant rows.

### 8.4 Concurrent edits across tabs

`lastEditedAt` written into `localStorage` on every save. On focus event, composable compares against in-memory value. If localStorage is newer, confirm dialog: "This case file was edited in another window — reload?" Default = reload.

### 8.5 Network failure during `dmApi` writes

Mutation kept in memory + localStorage. Toast surfaces error via `parseApiError`. Mutation added to a retry queue; queue auto-flushes on next successful API call. Banner shows "⚠ Saved locally — sync pending" until queue drains.

### 8.6 Validation

| Action | Required fields |
|---|---|
| Step 1 Register | applicant name, ID, stand no, dev type, classification, fee paid, copies submitted ≥ 3. Title deed required unless classification = `preliminary`. |
| Step 4 Issue Permit | use class, permitted-description ≥ 20 chars, ≥ 1 condition, every condition 5-test compliant, issuing officer = current authenticated user. Annexure 7 may be empty (template defaults applied). |

Blocking errors → `openMessageBox`. Field-level errors → inline `<FieldError>` red text below the input.

### 8.7 Refresh-loss prevention

`beforeunload` handler fires "You may have unsaved changes" when the mutation queue is non-empty or debounce hasn't flushed.

## 9. Migration plan

Six phases, each independently mergeable.

**Phase 1 — Scaffolding (zero behaviour change).** Create new directory + empty step components + composable stubs. `VunguPlannerView.vue` untouched. CI green.

**Phase 2 — Composables in isolation.** Implement `usePlannerCase`, `useStatutoryClock`, `useConditionLibrary`. Add `__tests__/planner-composables.spec.ts` covering clock math + 5-test gating + lock transitions.

**Phase 3 — Step components bottom-up.** Order: Step1 → Step5 (ack drafter) → Step2 → Step3 → Step4 → ClockBanner → StatutoryShell. Each independently renderable while others are placeholders.

**Phase 4 — Wire behind feature toggle.** Add header toggle "Classic ⟷ Statutory view" inside `VunguPlannerView.vue`. Default = classic. Both render side-by-side; user picks.

**Phase 5 — Drawer extraction.** Move existing right-rail content (Apps / Resources / Actions / Scheme / Consult / Villages / Returns) into `CaseFileDrawer.vue`. Both views still functional.

**Phase 6 — Flip default + delete dead code.** Default = statutory view. Remove classic-view branch. `VunguPlannerView.vue` shrinks from ~2,748 to ~600 lines.

**Rollback:** Phase 6 ships behind one commit; revert restores Phase 5 with classic default. No data migrations.

## 10. Effort estimate

| Phase | Files | LOC delta |
|---|---|---|
| 1 Scaffolding | 11 new | +200 |
| 2 Composables + tests | 4 | +500 |
| 3 Step components | 7 | +2,500 |
| 4 Toggle wiring | 1 | +30 |
| 5 Drawer extraction | 2 | net move ~600 |
| 6 Cutover | 1 | −2,000 |
| **Net** | **~10 new files** | **~+1,800 lines** |

## 11. Out of scope (named explicitly)

- Backend API additions or schema changes.
- A planner mobile/responsive layout. Desktop only, matches existing planner console.
- Integration with external Zimbabwean Government APIs (Deeds Office, ZINARA, etc.).
- Automatic generation of legal Annexure boilerplate from RTCP Act source text — we use templated wording matching the brief, editable by the planner.
- Multi-language support. English only, consistent with other operator consoles.

## 12. Open questions for review

None at spec time. The brainstorming flow resolved scope, architecture, persistence, error handling, and migration. If anything surfaces during implementation it gets raised on the implementation plan.
