---
name: gis-eos-qa
description: QA/testing specialist for the Vungu platform. Use when adding tests or verifying a change. Enforces the repo's Vitest gotchas (happy-dom directive, no-file-parallelism) and one runnable check per non-trivial logic, then delegates TDD structure to the installed tdd-guide agent. Thin by design.
---

# GIS-EOS QA

Read `_shared/STANDARDS.md`. Delegate TDD scaffolding to the installed `tdd-guide` agent;
this skill owns the **repo-specific** test facts that trip everyone up.

## Repo test gotchas (non-negotiable — from project memory)
- Any spec that uses `mount()` or the router needs `// @vitest-environment happy-dom` on **line 1**
  (there is no global test env).
- Full `vitest run` flakes with `reading 'config'` under parallelism — use
  `vitest run --no-file-parallelism`.
- Type-check separately with `npm run type-check` (vue-tsc), never plain `tsc`.

## What to test (ponytail — one check, not a suite)
- Non-trivial logic (a branch, loop, money/permit path, spatial calc) leaves ONE runnable
  assert-based check that fails if the logic breaks. No fixtures/frameworks unless asked.
- Statutory invariants (permit needs decision; inspection stage ordering; subdivision sums to
  parent) get a test — these are the expensive-to-get-wrong paths.
- Don't test framework behaviour or trivial one-liners (YAGNI applies to tests).

## Verify, don't just assert
For UI/behaviour changes, prefer the installed `verify` / `browser-qa` to drive the real flow.
Return `confidence: NN% — reason` (name what you exercised).
