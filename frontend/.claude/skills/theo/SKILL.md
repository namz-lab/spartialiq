---
name: theo
description: Master entry point for the entire GIS-EOS engineering suite — one command that calls all skills. Use for ANY Vungu platform request (feature, fix, review, cleanup, release). Runs the orchestrator, which routes to all 22 specialist gis-eos-* skills and enforces the governance gates.
---

# /theo — GIS-EOS master entry ("calling all skills")

Alias: immediately invoke the Skill tool with `skill: gis-eos-orchestrator`, passing this
skill's arguments through unchanged. The orchestrator is the CTO — it runs the governance
pipeline and routes to every specialist: architect, requirements, frontend, backend,
gis-architect, postgis, maplibre, spatial-analysis, cadastre, database, security, qa,
performance, maintenance, docs, devops, municipal, tpm, principal, ux-research, release,
platform.

No arguments? Ask the user what they want to build/fix, then invoke the orchestrator with it.
