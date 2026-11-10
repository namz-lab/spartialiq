# METRICS — architectural limits & performance budgets (GIS-EOS)

`gis-eos-platform` owns this file. These are **reject-gates**: exceed one, the change is
rejected or refactored, not merged. Numbers are guidance ceilings, not laws of physics —
raise one only with a one-line justification in the PR/commit.

## Architectural limits
| Metric | Ceiling | Action when exceeded |
|---|---|---|
| Component size | ~300 lines | split into subcomponents / extract composable |
| Service/module fn | ~200 lines | extract collaborators |
| Nesting depth | 4 | early-return / extract |
| Imports per file | ~15 | the file is doing too much — split |
| SQL joins | reviewed at >4 | justify or denormalise/index |
| Duplication | 0 knowingly | reuse (ladder rung 2) |
| Dead code | 0 | delete as part of the change |

## Performance budgets (runtime review gate)
| Target | Budget |
|---|---|
| Initial load (interactive) | < 2 s |
| Vector tile render | < 100 ms |
| Search / autocomplete response | < 200 ms |
| Map pan/zoom | 60 fps |
| Table virtualization | required > 500 rows |
| API p95 latency | < 300 ms (spatial reads may be higher, budget per-endpoint) |
| Bundle | no unexplained growth; lazy-load heavy routes |

## How they're measured (no new tooling)
Static limits via the installed `refactor-cleaner` (knip/ts-prune) + grep. Runtime budgets via
the installed `performance-optimizer` / `verify` / `browser-qa` during the runtime-review gate.
The orchestrator rolls these into the Architecture Health Score on major completion.
