# ADR 0010 — An inspection site is resolved by the server, and always states its precision

Status: Accepted · Owner: `gis-eos-gis-architect`
Recorded: 2026-09-13, during Building Inspector GIS work.

## Context

`permit_application` carries an optional `location` point and a hand-typed `stand_number`.
On the reference database, **0 of 8 permits had a location**, and the stand numbers
("Somabula", "Communal Land") match cadastre *farms*, not stands in the Stands Register.

The map pane previously papered over this: it read `permit.lat/lng`, and when those were
null it flew to one of five hardcoded ward centroids. An inspector could therefore be
shown a confident pin for a site whose position the council does not actually hold — the
worst possible failure for a record that supports enforcement.

Three registers can locate a site, with very different precision: the Stands Register
(`stands`, stand-sized polygons), the cadastre (`vungu_parcels`, mostly farms of
hundreds or thousands of hectares), and the permit's own point.

## Decision

1. **Resolution is server-side and single-source.** `siteSelectSql()` in
   `src/services/inspectorSpatial.js` (backend) resolves every permit through one SQL
   fragment, used by the sites layer, the site report, identify and the geofence. The
   client never re-derives a site position.

2. **Precedence, first hit wins:** permit point inside a Stands Register polygon → stand
   number matched in the Stands Register (unique, or unique within the recorded ward, and
   within 100 m of the permit point when one exists) → cadastre parcel containing the point
   or matching the name, **only if ≤ 5 ha** → the permit point alone → a larger cadastral
   area (display only).

3. **Every site states a precision**, and the UI is built on it:

   | precision | meaning | navigate | geofence | coverage |
   |---|---|---|---|---|
   | `boundary` | stand-sized polygon known | yes | to polygon, 30 m | yes |
   | `point` | position only | yes | to point, 75 m | no |
   | `area` | only a farm/communal area | no | `unverifiable` | no |
   | `none` | nothing resolves | no | `unverifiable` | no |

   `area` and `none` are **not** placed on the map and run no site checks. The report says
   which farm the site lies within and asks for a position instead.

4. **A missing position is fixable in the field, with provenance.**
   `PUT /api/permit-applications/:id/site-location` records a GPS fix (≤ 25 m) or a map
   pick, inside the council boundary, with a reason; it writes `location_source`,
   `location_accuracy_m`, `location_set_by/at` (migration 118) and a `site_location_set`
   audit event carrying the previous position.

## Consequences

- Honest, and visibly so: the workspace shows "3 of 4 sites have no usable position and are
  not on the map" rather than four confident pins.
- A farm outline can never be presented as a building site, and attendance can never be
  "verified" against one.
- Cadastre matching is capped at 5 ha (`CADASTRE_SITE_MAX_SQM`). A genuinely larger single
  stand would resolve to `point`/`area`; raise the constant if such stands are registered.
- Hardcoded ward centroids are deleted. Nothing in the inspector map guesses a position.
