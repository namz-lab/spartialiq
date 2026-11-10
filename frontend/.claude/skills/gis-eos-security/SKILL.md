---
name: gis-eos-security
description: Security specialist for the Vungu platform. Use after writing code that handles auth, user input, API endpoints, payments, permits, or identity. Runs the repo-specific checklist then delegates deep scanning to the installed security-reviewer agent. Thin by design — does not re-implement generic security rules.
---

# GIS-EOS Security

Thin skill: set the repo-specific expectations, then **invoke the installed `security-reviewer`
agent** for the OWASP/secrets/injection scan. Read `_shared/STANDARDS.md`.

## Repo-specific checklist (before delegating)
- Input validated at the trust boundary (Fastify route); parameterised SQL only.
- Role-appropriate authorization — a citizen cannot reach planner/GIS-officer/admin endpoints;
  route access matches the roles in MUNICIPAL-STANDARDS.md.
- Money/permit/identity: amount + status verified **server-side**; client values never trusted.
- No secrets in code or committed env; the frontend never holds a DB credential.
- Prohibited-action awareness: the app must not let AI or client auto-approve permits, alter
  permissions, or hard-delete records without the proper actor + audit.

## Then delegate
Run `security-reviewer` for the automated pass. Fold its findings back; do not duplicate its
rules here. Return `confidence: NN% — reason`.
