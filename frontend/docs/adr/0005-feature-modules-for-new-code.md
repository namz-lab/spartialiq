# ADR 0005 — Feature modules for NEW code; keep existing views/<role>/sections

Status: Accepted · Owner: `gis-eos-architect`

## Context
Existing code is organised `src/views/<role>/sections/*.vue` (290 SFCs). A feature-module layout
is desirable for new capabilities, but a full migration is risky and out of scope.

## Decision
New self-contained capabilities may use `src/modules/<capability>/{components,pages,services,
api,stores,models,validation,tests}`. **Extend an existing capability before adding a module.**
Do not migrate the 290 existing files.

## Consequences
- Two layouts coexist deliberately; when both fit, follow the legacy layout unless asked.
- Superseding this (e.g. a real migration) requires a new ADR.
