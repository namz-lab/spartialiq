-- ROLLBACK OF 209 — THE CASH OFFICE SERVICE QUEUE
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/209_cash_service_queue.down.sql
-- The tickets are kept, renamed to finance.cash_queue_ticket_209_archive; only the functions go.
DROP FUNCTION IF EXISTS finance.add_cash_queue_ticket(uuid, text, uuid, text);
DROP FUNCTION IF EXISTS finance.close_cash_queue_ticket(uuid, uuid, text, text, text);
ALTER TABLE IF EXISTS finance.cash_queue_ticket RENAME TO cash_queue_ticket_209_archive;
DELETE FROM public.schema_migrations WHERE filename = '209_cash_service_queue.sql';
