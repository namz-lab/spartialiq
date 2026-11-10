# STANDARDS — engineering house rules (GIS-EOS)

Referenced by every `gis-eos-*` skill. Read once; it is the coding + testing + ponytail baseline.

## Stack (from package.json — do not add deps without an ADR)
- Vue 3.3 `<script setup lang="ts">`, Pinia 2, Vue Router 4, Vite 7, TypeScript 5.
- MapLibre GL 4.7, `@turf/*` + `jsts` (spatial), `proj4` (CRS). Tailwind 3.3.
- Icons: **`lucide-vue-next`**. `@heroicons/vue` is legacy — do not add new heroicons usage.
- Backend (`../app-backend`): Fastify + `@fastify/postgres`, CommonJS.

## The ponytail ladder (house default — full mode)
Stop at the first rung that holds: (1) does it need to exist? (2) already in this repo —
reuse it (check `src/components`, `src/composables`, `src/services`, `src/map`, PATTERNS.md);
(3) stdlib / native platform; (4) already-installed dep; (5) one line; (6) minimum code.
Deletion over addition. No abstraction with one caller. No config for a value that never changes.

## Bug fixes = root cause
Grep every caller of the function before editing. One guard in the shared function beats a
guard in every caller. Patch where all callers route through, not just the path named.

## TypeScript / Vue conventions
- Type-check with `npm run type-check` (vue-tsc). **Never plain `tsc`** — it emits ~44 false
  `.vue` cannot-find-module errors.
- Composition API only for new code; colocate shared state in `src/stores/*` (Pinia).
- No `outline: none` without a `:focus-visible` replacement (a11y baseline lives in main.css).

## Testing (Vitest)
- Mount/router specs need `// @vitest-environment happy-dom` on **line 1** (no global test env).
- Full runs flake with `reading 'config'` under parallelism — run `vitest run --no-file-parallelism`.
- Non-trivial logic leaves ONE runnable check (assert-based). No fixtures/frameworks unless asked.

## Definition of "clean change"
Every change removes the unused imports/files/routes/styles it obsoletes. A feature that adds
without deleting its own dead predecessors is not done. Delegate the sweep to the installed
`refactor-cleaner` agent when it spans many files.

## Security baseline (delegates to `security-reviewer` agent)
Validate input at the trust boundary. Parameterised SQL only. No secrets in code. See the
`gis-eos-security` skill for the repo-specific checklist.
