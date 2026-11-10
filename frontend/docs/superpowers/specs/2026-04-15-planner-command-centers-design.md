# Planner Command Centers Design

**Date:** 2026-04-15
**Status:** Approved in chat, written for review
**Scope:** `src/views/VunguPlannerView.vue` and `src/views/EOPlannerView.vue`

## Goal

Expand the existing `Planner` and `E.O.` command-center windows so they expose the full local-authority planning workflow while keeping the screen clean. Every major task must be available from within the current windowed workspaces through tabs, drawers, bottom sheets, modals, and expandable cards rather than by adding cluttered full-screen pages.

## Problem

The current planner windows already cover parts of the workflow, but the coverage is uneven:

- `VunguPlannerView.vue` already supports map work, basic proposal actions, yield, approvals, comments, and property inspection.
- `EOPlannerView.vue` already supports review, compliance, reporting, audit, and master-plan monitoring.
- Important municipal workflow areas are still fragmented or too shallow, such as application registers, site work, circulation details, finance handoff, executive revenue oversight, and case-based navigation across both roles.

The system needs broader task coverage without turning either screen into a crowded dashboard.

## Design Principles

- Keep the current command-center window pattern.
- Use a progressive workspace: show summaries and quick actions first, open detail only when needed.
- Keep the map as the primary work surface in both roles.
- Make every action hang off a selected case, proposal, application, stand, or enforcement record.
- Keep high-frequency controls always visible and move heavy detail into on-demand modules.
- Preserve a clean screen through tabs, drawers, bottom panels, modals, and expandable sections.

## Role Split

### Planner Window

The planner window is the operational planning desk. It owns:

- Intake and application registration
- Parcel and stand lookup
- Technical planning analysis
- Site work and inspection capture
- Scheme design and layout drafting
- Change of use, subdivision, and related workflow actions
- Circulation preparation and departmental comment collection
- Planner recommendation drafting
- Finance handoff preparation
- Ongoing case communication and history

### E.O. Window

The E.O. window is the executive control desk. It owns:

- Executive review and decision-making
- Approval, revision, deferment, and rejection
- Compliance and enforcement control
- Revenue oversight and finance follow-up
- District-wide monitoring and workload visibility
- Formal reporting and council-ready outputs
- Audit trail visibility
- Master-plan and strategic project oversight

### Shared Rule

The same underlying record must be reachable from both windows. A planner and an E.O. should see the same case or proposal with different tools and permissions rather than duplicated screens.

## Recommended Interaction Model

Three possible approaches were considered:

1. Dense command center with most modules visible at once
2. Progressive workspace with summaries visible and detail opened on demand
3. Step-by-step workflow view organized as a linear pipeline

The approved approach is `Progressive workspace`.

Reason:

- It fits the structure already present in both views.
- It allows full workflow coverage without overcrowding the screen.
- It supports real daily work better than a rigid step-by-step wizard.

## Planner Window Information Architecture

### Left Sidebar: Operational Context

Keep the left sidebar as a compact context and queue area.

Add or formalize these grouped sections:

- `Ward / Area`
- `GIS Layers`
- `My Tasks`
- `Application Inbox`
- `Registers`

`Registers` should open filtered views rather than dump all detail into the sidebar. The register set should cover:

- Subdivision cases
- Change-of-use cases
- Layout applications
- Development permits
- Site visits
- Circulation items

### Center Pane: Working Map Canvas

Keep the map as the main work surface.

The top toolbar should prioritize only high-frequency tools:

- `Select`
- `Search`
- `Draw`
- `Measure`
- `Buffer`
- `Subdivision`
- `Annotate`
- `Print`
- `Quick Check`

Heavy analytical output should open through bottom panels or slide-up workspaces:

- `Yield & Costing`
- `Constraint Results`
- `Stand Schedule`
- `Circulation Status`
- `Site Visit Notes`

### Right Sidebar: Case Workspace

Replace the current narrow task framing with a broader case workspace.

Approved tab structure:

- `Case`
- `Analysis`
- `Workflow`
- `Documents`
- `Comments`

Tab responsibilities:

- `Case`: parcel, applicant, land use, ownership, reference numbers, and application metadata
- `Analysis`: zoning, buffers, environmental conflicts, road reserve checks, service availability, and policy checks
- `Workflow`: change of use, subdivision, layout generation, circulation, conditions, recommendation, and handoff
- `Documents`: checklist, attached plans, permits, minutes, and letters
- `Comments`: planner notes, inter-department comments, and applicant communication history

## E.O. Window Information Architecture

### Left Column: District Monitoring

Keep the left column compact and executive-focused.

Existing sections to retain:

- `Approval Queue`
- `Staff Workload`
- `Ward Activity`
- `GIS Layers`

Add compact summary cards for:

- `Revenue Pending`
- `Overdue Cases`
- `Active Enforcement Orders`
- `Council Agenda Items`

This side must answer one question quickly: what needs executive attention right now?

### Center Pane: Oversight Map

The E.O. map is for review and hotspot visibility, not drafting.

Approved overlay toggles:

- `Pending Applications`
- `Conflict Hotspots`
- `Environmental Alerts`
- `Revenue Areas`
- `Master Plan Projects`
- `Enforcement Cases`

### Right Column: Executive Modules

Keep the tabbed pattern and extend it into these modules:

- `Review`
- `Compliance`
- `Revenue`
- `Reports`
- `Audit`
- `Master Plan`

Tab responsibilities:

- `Review`: approve, defer, revise, reject, conditions, and sign-off notes
- `Compliance`: stop orders, fines, notices, hearings, and resolved cases
- `Revenue`: billed applications, unpaid items, expected income, and finance handoff status
- `Reports`: monthly, quarterly, ward, compliance, revenue, and council reports
- `Audit`: who did what, when, and against which record
- `Master Plan`: strategic projects, deviations, milestones, and implementation status

Executive cards and modals should show summary first and expand technical detail only when needed.

## Case Lifecycle and Module Coverage

To keep the interface clean while still covering everything, each task should attach to a case record or proposal record.

### Planner Modules

- `Intake & Register`: new applications, applicant details, reference numbers, request type, and status
- `Parcel & Ownership`: stand details, ward, tenure, ownership, neighboring stands, and existing use
- `Technical Analysis`: zoning, buffers, road reserve, servitudes, utilities, environmental constraints, and policy checks
- `Site Work`: visit scheduling, inspection notes, site photos, and field observations
- `Scheme Design`: subdivision, consolidation, change of use, layout drawing, stand schedule, and yield/costing
- `Circulation`: comments from environment, survey, engineering, building, health, and related departments
- `Recommendation`: planner report, conditions of approval, reasons for refusal, and E.O. handoff
- `Finance Handoff`: fee estimate, billing request, permit readiness, and receipt status
- `History & Communication`: comments, revision notes, letters, and action trail

### E.O. Modules

- `Executive Review`: summary, planner recommendation, technical comments, and decision actions
- `Conditions & Sign-off`: approval conditions, decision notes, and formal sign-off
- `Compliance & Enforcement`: notices, stop orders, fines, hearings, and case closure
- `Revenue Oversight`: billed items, unpaid items, expected income, and finance follow-up
- `District Oversight`: overdue cases, staff bottlenecks, ward hotspots, and agenda items
- `Audit & Reporting`: statutory reports, traceability, and council-ready outputs
- `Master Plan Control`: strategic projects, deviations, milestones, and implementation risk

## Record-First Behavior

The system should behave as a case-driven workspace:

- When no record is selected, the right workspace shows clean empty states and queue summaries.
- When a record is selected, tabs should populate automatically with the modules relevant to that record.
- Actions such as `Send for Circulation`, `Approve`, `Bill`, `Issue Fine`, and `Close Case` must validate the current stage before running.
- If a module has no data yet, it should still appear as an available part of the system with a clear empty or ready state.

## Clean-Screen Rules

- No new cluttered full-screen workflow pages.
- Always visible: map, quick actions, queue counts, urgent alerts, and active case summary.
- Open on demand: long tables, document lists, circulation matrices, finance detail, audit history, and stand schedules.
- Show summary chips and counts before detailed tables.
- Use expandable sections inside tabs for technical detail.
- Use bottom sheets for heavy analytical output.
- Keep only the most-used tools in the top toolbar.

## Error Handling and Guardrails

- Missing input should show a clear explanatory state instead of disabled-looking broken controls.
- Stage-sensitive actions must explain why they are blocked.
- Approval or enforcement actions should prefer friendly status messages and validation over silent failure.
- Empty modules must render intentionally, not disappear.

## Acceptance Criteria

This design is successful when:

- The `Planner` window exposes every major local-authority planning task through in-window modules.
- The `E.O.` window exposes executive review, compliance, revenue, reporting, audit, and master-plan tasks through in-window modules.
- Both windows stay clean because detailed modules expand only when needed.
- Users can move through the full case lifecycle without leaving the command-center views for separate workflow pages.
- The same record can be reached from both windows with role-appropriate tools.

## Implementation Direction

The implementation should extend the existing views rather than replace them:

- Expand `src/views/VunguPlannerView.vue` around the current three-pane structure
- Expand `src/views/EOPlannerView.vue` around the current queue-map-tabs structure
- Reorganize current tabs and actions into the approved module groupings
- Add missing modules first as visible, clean, in-window components
- Prefer staged progressive disclosure over permanently visible panels

## Out of Scope for This Design

- Backend data model redesign
- Permission model redesign
- New full-screen workflow route creation
- Detailed implementation task breakdown

Those belong in the implementation plan that follows this reviewed spec.
