-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 193 — Record that the exchange-rate table is intentionally dormant (audit D-05)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- finance.exchange_rate_policy exists because a future Council decision may permit converting
-- between USD and ZWG for reporting. No code path applies a rate today, and none should: decision
-- D4 (docs/finance/COUNCIL-DECISIONS.md) says there is no combined USD/ZWG total until the Council
-- approves a rate source, a rate date convention and a method. Every report and public figure keeps
-- the currencies in separate rows.
--
-- This migration changes no behaviour. It puts that decision where an operator or a future developer
-- will see it: on the table and its rate column. Without it, an empty table looks like an unfinished
-- feature and invites someone to "fix" it by wiring a conversion nobody approved.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE finance.exchange_rate_policy IS
  'Intentionally dormant (audit D-05). No code path applies a rate. Decision D4: USD and ZWG are never converted or combined until the Council approves a rate source, date convention and method. A combined total without that decision would be a fabrication.';

COMMENT ON COLUMN finance.exchange_rate_policy.rate IS
  'Not consumed by any report, view or public endpoint today. See the table comment and COUNCIL-DECISIONS.md D4 before wiring this into a calculation.';

COMMENT ON COLUMN finance.exchange_rate_policy.method IS
  'The approved conversion method would be recorded here. No method is approved; the table is dormant.';

COMMENT ON COLUMN finance.exchange_rate_policy.rate_source IS
  'The approved rate source would be recorded here. No source is approved; the table is dormant.';
