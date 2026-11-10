# Maintenance reference — dead-code detection

## Tooling (installed — do not add new)
Run via the `refactor-cleaner` agent: `knip` (unused files/exports/deps), `ts-prune` (unused TS
exports), `depcheck` (unused deps). `rg`/`madge` for the import graph. `vue-tsc` to confirm no
break after removal.

## Vue-specific false positives (verify before deleting)
- Components used only via `<component :is>` or router `component: () => import(...)` look unused
  to static tools — they are NOT.
- Components referenced only in a template (not imported in `<script>`) — check the SFC template.
- Route-only views: grep `src/router/index.ts` before removing any `views/*`.
- Pinia stores auto-registered, composables used in templates, CSS classes used by string binding.

## Order of operations
1. Scan → candidate list.
2. For each candidate: grep all usages (static + dynamic) + router + templates.
3. Deletion report.
4. Remove → `npm run type-check` → `vitest run --no-file-parallelism` → done.

Nothing is deleted that a dynamic path could load. When unsure, keep it and flag it.
