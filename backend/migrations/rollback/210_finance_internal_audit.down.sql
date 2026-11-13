-- ROLLBACK OF 210 — INTERNAL AUDIT
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/210_finance_internal_audit.down.sql
-- The plan and findings are kept, renamed with a _210_archive suffix; only the grant goes.
DELETE FROM finance.role_permission WHERE permission_code = 'finance.audit.manage';
DELETE FROM finance.user_permission_override WHERE permission_code = 'finance.audit.manage';
DELETE FROM finance.permission WHERE code = 'finance.audit.manage';
ALTER TABLE IF EXISTS finance.audit_finding RENAME TO audit_finding_210_archive;
ALTER TABLE IF EXISTS finance.audit_engagement RENAME TO audit_engagement_210_archive;
DELETE FROM public.schema_migrations WHERE filename = '210_finance_internal_audit.sql';
