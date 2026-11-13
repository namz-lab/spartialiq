-- 195: land.parcel.estimated_accuracy_m — the column /api/context/parcels reads and its test
-- seeds, which no migration ever created: the endpoint 500s ("column does not exist") on any
-- database built from the chain, which is every fresh deployment.
--
-- Nullable metres of estimated positional accuracy, for parcels whose position was estimated
-- or digitised rather than surveyed (accuracy_basis 'estimated' / 'map_digitised'). The
-- service (src/services/contextParcels.js) falls back to transform_accuracy_m when it is
-- NULL, so existing parcels keep exactly their current reported accuracy.

ALTER TABLE land.parcel ADD COLUMN IF NOT EXISTS estimated_accuracy_m numeric;
COMMENT ON COLUMN land.parcel.estimated_accuracy_m IS
  'Estimated positional accuracy in metres, declared where the position was estimated or digitised (accuracy_basis estimated/map_digitised) rather than surveyed. NULL when not declared; readers fall back to transform_accuracy_m.';
