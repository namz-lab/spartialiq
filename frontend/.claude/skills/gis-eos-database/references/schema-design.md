# Database reference — schema design

## Principles
- Model the domain, not the screen. Tables mirror MUNICIPAL-STANDARDS entities (application,
  parcel, decision, permit, condition, inspection, register entry, payment).
- Constraints are the safety net: FK for every relationship, CHECK for enums/ranges, NOT NULL by
  default. If the app is the only thing stopping bad data, the schema is wrong.
- Audit + soft-delete columns on domain tables: `created_at`, `updated_at`, `deleted_at`
  (timestamptz, ISO-8601 / `now()`), plus an audit trail row per state change.
- Money: store minor units as integer + currency; never float.

## Spatial
Geom columns SRID 900914 (≡4326). GiST index each. Register any new tileable table in
`spatialLayers.js` (with attribute allowlist + minzoom) or it will not tile.

## Don't over-model (ponytail)
No table/column for a requirement that doesn't exist yet. No polymorphic association where two
FKs are clearer. Add the column when the feature needs it.
