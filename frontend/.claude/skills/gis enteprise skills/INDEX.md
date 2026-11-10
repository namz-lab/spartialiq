# GIS-EOS — Enterprise GIS AI Engineering Operating System

An AI engineering methodology for the Vungu RDC municipal planning platform, encoded as
Claude Code skills. Skills are **flat** under `.claude/skills/gis-eos-*/` (so they auto-load);
this folder is the documentation home (`_shared/` handbooks + this index).

## How it works
**One command calls all skills: `/theo <request>`** (alias for the orchestrator).
`gis-eos-orchestrator` is the entry point (acts as CTO, not dispatcher). It runs the
governance pipeline in `_shared/GOVERNANCE.md`, delegates domain work to the specialist skills
below, and delegates generic engineering to installed `everything-claude-code` agents. Every
skill obeys `_shared/STANDARDS.md` (ponytail: shortest path, reuse-first, delete dead code).

## Departments (skills)
| # | Skill | Concern |
|---|---|---|
| 00 | `gis-eos-orchestrator` | routing, governance, quality gates, CTO reject authority |
| 01 | `gis-eos-architect` | module design, boundaries, ADRs, CODEMAP |
| 02 | `gis-eos-requirements` | request → acceptance criteria |
| 03 | `gis-eos-frontend` | Vue 3 + `--login-*` tokens + lucide (+ references/) |
| 04 | `gis-eos-backend` | Fastify routes + services (+ references/) |
| 05 | `gis-eos-gis-architect` `-postgis` `-maplibre` `-spatial-analysis` `-cadastre` | GIS |
| 06 | `gis-eos-database` | schema, migrations, indexes (+ references/) |
| 07 | `gis-eos-security` | → `security-reviewer` agent + repo checklist |
| 08 | `gis-eos-qa` | → `tdd-guide`; vitest rules |
| 09 | `gis-eos-performance` | → `performance-optimizer`; METRICS budgets |
| 10 | `gis-eos-maintenance` | dead code + graphs → `refactor-cleaner` (+ references/) |
| 11 | `gis-eos-docs` | → `doc-updater`; CODEMAP |
| 12 | `gis-eos-devops` | vite/tauri/render deploy |
| 13 | `gis-eos-municipal` | planning domain + DOMAIN-GRAPH |
| 14 | `gis-eos-tpm` | roadmaps, critical path, OWNERSHIP, feature-history |
| 15 | `gis-eos-principal` | simplicity guardian → `ponytail-review`/`simplify` |
| 16 | `gis-eos-ux-research` | personas, task analysis, IA (pre-pixels) |
| 17 | `gis-eos-release` | deploy validation, rollback, smoke, versioning |
| 18 | `gis-eos-platform` | skill versioning, effectiveness metrics, DX |

## Role boundaries (so they never drift)
- **Architect** = structure & long-lived decisions (modules, boundaries, ADRs).
- **Principal** = simplicity of *this* diff (over-engineering, merge/split). Reviews the diff,
  not the roadmap. If both reach one file: Architect rules on *shape*, Principal on *simplicity*;
  they do not re-review each other.
- **TPM** = sequencing, dependencies, milestones, tracking — not design.
- **Platform** = the framework itself (skill versioning, metrics, DX) — not features.

## Artifact ownership (one writer each; others read-only)
| Artifact | Sole owner |
|---|---|
| `docs/architecture/CODEMAP.md`, `docs/adr/` | architect |
| `docs/architecture/DOMAIN-GRAPH.md` | municipal |
| `docs/architecture/OWNERSHIP.md`, `docs/history/feature-history.md` | tpm |
| `_shared/METRICS.md`, `_shared/PATTERNS.md`, `--login-*` tokens | platform |
| `_shared/GOVERNANCE.md`, Definition of Done | orchestrator |

## Reuse ledger (installed capabilities we do NOT rebuild)
`refactor-cleaner` (dead code/graphs) · `doc-updater` (codemaps) ·
`architecture-decision-records` · `learn-eval`/`continuous-learning` (patterns) ·
`codebase-onboarding`/`resume-session` (cold start) · `security-reviewer` ·
`performance-optimizer` · `tdd-guide` · `github-project-management` ·
`deployment-patterns`/`github-release-management` · `verify`/`browser-qa` ·
`token-budget-advisor`/`context-budget` · `ponytail-review`/`simplify`.
