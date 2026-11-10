# ADR 0006 — LoginView.vue-derived tokens are the frontend design source (over DESIGN.md)

Status: Accepted · Owner: `gis-eos-platform`

## Context
`DESIGN.md` specifies accent `#1a73e8`, flat surfaces, no gradients. `src/views/admin/
LoginView.vue` uses `#0066cc`, gradients, and glow shadows. The user chose the LoginView look as
the standard for the frontend design skill, and asked that no single page be the source of truth.

## Decision
Extract the LoginView.vue values **once** into `--login-*` custom properties in
`src/styles/main.css` (`:root`, global via `main.ts`). That token block is the single source of
truth for `gis-eos-frontend`; components reference the tokens and never hardcode the values.
Scope: the frontend design skill only — this does not change backend/GIS/cartographic conventions,
and the map cartographic palette in DESIGN.md is untouched.

## Consequences
- The frontend design language diverges from DESIGN.md's UI accent, intentionally and in one place.
- A future re-alignment to `#1a73e8` = edit the tokens once; no page is authoritative.
- `LoginView.vue` may later be refactored to consume the tokens with no visual change.
