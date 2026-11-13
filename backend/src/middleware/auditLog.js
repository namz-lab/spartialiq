/**
 * Audit logging middleware.
 *
 * Writes one row to public.admin_audit_event (migration 124) for every
 * mutating request made by an identified user. Critical for Zimbabwe municipal
 * compliance: any change to permit data, user accounts, KYC decisions or
 * enforcement orders must be traceable to a specific officer.
 *
 * HISTORY — WHY THE TRAIL WAS EMPTY
 * This plugin previously inserted into `security_audit_log`, a table declared
 * in migration 041 that has never existed in any Vungu database: 041 aborts
 * partway through on a CHECK naming a column that is not there, and its
 * user_id columns are INTEGER against a uuid users.id. Because the catch below
 * swallows its own failure by design, the council ran for the whole of that
 * period appearing to have an audit trail and having none. Migration 124
 * supersedes 041 and this file now targets it.
 *
 * WHY THE CATCH STAYS
 * An audit write must never fail the request it is auditing — a council
 * officer must not be unable to record an inspection because the log disk is
 * full. The mitigation for the failure mode above is not removing the catch;
 * it is the smoke test (test-admin-console.js) that asserts a row actually
 * lands, so an empty trail is caught by CI rather than by an auditor.
 *
 * WHY fastify-plugin WRAPS THIS
 * The second half of the same bug. Fastify ENCAPSULATES a plugin by default,
 * so `fastify.addHook` inside a plain `async function plugin(fastify)` binds
 * the hook to that plugin's own scope — which contains no routes. Registered
 * bare, as this was, the hook is created and then never fires for a single
 * request in the application. So even once migration 124 gave the table a
 * home, nothing would have been written to it. fp() opts out of the
 * encapsulation and attaches the hook to the root instance, where the routes
 * live.
 *
 * COST
 * The hook runs on onResponse, after the reply is sent, so the INSERT never
 * sits in the request's latency. Reads are skipped entirely, which is what
 * keeps the table's growth proportional to the work done rather than to the
 * traffic.
 */

const { systemOf } = require('../lib/dbContext')
const fp = require('fastify-plugin')

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Routes whose mutations are noise rather than record: they change no council
 * data and would otherwise dominate the trail and bury the permit decisions.
 * Kept short on purpose — when in doubt, log it.
 */
const SKIP = [
  '/api/auth/refresh',     // fires on a timer in every open tab
  '/api/auth/heartbeat',
  '/api/tiles',            // POST only for cache priming
]

/**
 * URL prefix → what the council calls this, and how much it matters.
 *
 * Order matters: the first match wins, so the specific prefixes precede the
 * general ones. `/admin/users` must be tested before `/admin`.
 */
const RULES = [
  { match: '/admin/settings',      event: 'SETTINGS',      severity: 'high',     entity: 'setting' },
  { match: '/admin/users',         event: 'USER_MGMT',     severity: 'high',     entity: 'user' },
  { match: '/admin/invites',       event: 'USER_MGMT',     severity: 'high',     entity: 'invite' },
  { match: '/admin/sessions',      event: 'SESSION',       severity: 'high',     entity: 'session' },
  { match: '/admin/ip-blocks',     event: 'SECURITY',      severity: 'high',     entity: 'ip_block' },
  { match: '/admin/announcements', event: 'ANNOUNCE',      severity: 'medium',   entity: 'announcement' },
  { match: '/admin/org',           event: 'ORG',           severity: 'medium',   entity: 'org_position' },
  // Finance (migration 188). Listed before the general '/documents' and '/gis' rules because the
  // first match wins and '/api/finance/documents' would otherwise be filed as a plain document.
  // A publication or an approval is the most consequential thing this module does, so both are
  // 'critical'; a refused attempt lands here too, which is what makes an unauthorised publication
  // attempt visible to an auditor.
  { match: '/finance/publications', event: 'FIN_PUBLICATION', severity: 'critical', entity: 'finance_publication' },
  { match: '/finance/budget-revisions', event: 'FIN_REVISION', severity: 'critical', entity: 'finance_budget_revision' },
  { match: '/finance/budget-lines', event: 'FIN_BUDGET',     severity: 'high',     entity: 'finance_budget_line' },
  // Geographic attribution of money (GIS-finance migration 198): changes how every ward
  // roll-up reads, so refusals are as visible as decisions.
  { match: '/finance/spatial-allocations', event: 'FIN_SPATIAL_ALLOCATION', severity: 'high', entity: 'finance_spatial_allocation' },
  { match: '/finance/imports',     event: 'FIN_IMPORT',     severity: 'critical', entity: 'finance_import_batch' },
  { match: '/finance/financial-years', event: 'FIN_CONFIG',  severity: 'high',     entity: 'finance_financial_year' },
  { match: '/finance/accounts',    event: 'FIN_CONFIG',     severity: 'high',     entity: 'finance_account' },
  { match: '/finance/departments', event: 'FIN_CONFIG',     severity: 'high',     entity: 'finance_department' },
  { match: '/finance/programmes',  event: 'FIN_CONFIG',     severity: 'medium',   entity: 'finance_programme' },
  { match: '/finance/activities',  event: 'FIN_CONFIG',     severity: 'medium',   entity: 'finance_activity' },
  { match: '/finance/settings',    event: 'FIN_CONFIG',     severity: 'high',     entity: 'finance_setting' },
  { match: '/finance/column-mappings', event: 'FIN_CONFIG', severity: 'medium',   entity: 'finance_column_mapping' },
  { match: '/finance/projects',    event: 'FIN_PROJECT',    severity: 'high',     entity: 'finance_project' },
  { match: '/finance/transactions', event: 'FIN_TRANSACTION', severity: 'high',   entity: 'finance_transaction' },
  { match: '/finance/documents',   event: 'FIN_DOCUMENT',   severity: 'medium',   entity: 'finance_document' },
  // Changing who holds finance access is a permission grant, not generic finance activity: the
  // audit screen's "Permission grants" filter must find it.
  { match: '/finance/users',       event: 'FIN_PERMISSION', severity: 'high',     entity: 'finance_user_access' },
  { match: '/finance/permissions', event: 'FIN_PERMISSION', severity: 'high',     entity: 'finance_permission_grant' },
  // The book of account (migration 203) and rates billing (205, 206). These had no rule of their
  // own and fell through to the generic '/finance' line below, so posting a voucher, closing a
  // year and committing a billing run were all filed as medium-severity "FINANCE" with no entity
  // -- indistinguishable, in the audit screen, from somebody opening a report. Posting is the act
  // that puts a figure beyond amendment and a tariff approval sets what every property is charged,
  // so both are 'critical', and a refused attempt lands here too.
  { match: '/finance/ledger/close-year', event: 'FIN_LEDGER_POST', severity: 'critical', entity: 'finance_ledger_year' },
  { match: '/finance/ledger/vouchers', event: 'FIN_LEDGER_POST', severity: 'critical', entity: 'finance_voucher' },
  { match: '/finance/ledger/periods', event: 'FIN_LEDGER',  severity: 'high',     entity: 'finance_ledger_period' },
  { match: '/finance/ledger',      event: 'FIN_LEDGER',     severity: 'high',     entity: 'finance_ledger' },
  { match: '/finance/rates/billing', event: 'FIN_RATES_BILLING', severity: 'critical', entity: 'finance_rates_billing_run' },
  { match: '/finance/rates/tariffs', event: 'FIN_RATES_TARIFF', severity: 'critical', entity: 'finance_rates_tariff' },
  { match: '/finance/rates/receipts', event: 'FIN_RATES_RECEIPT', severity: 'high', entity: 'finance_rates_receipt' },
  { match: '/finance/rates',       event: 'FIN_RATES',      severity: 'high',     entity: 'finance_rates' },
  // The cash office (migration 207). Verifying a cash-up posts a day's takings and is the same
  // act as posting a voucher, so it is 'critical'; a receipt, a cancellation and a banking are money
  // changing hands and are 'high'. More specific prefixes first: the first match wins.
  { match: '/finance/cash/sessions', event: 'FIN_CASH_SESSION', severity: 'critical', entity: 'finance_cashier_session' },
  { match: '/finance/cash/receipts', event: 'FIN_CASH_RECEIPT', severity: 'high', entity: 'finance_cash_receipt' },
  { match: '/finance/cash/deposits', event: 'FIN_CASH_DEPOSIT', severity: 'high', entity: 'finance_bank_deposit' },
  // Migration 208: who may work which drawer. Session lifecycle acts (suspend, abandon, supervised
  // count) fall under /finance/cash/sessions above, at critical.
  { match: '/finance/cash/assignments', event: 'FIN_CASH_ASSIGNMENT', severity: 'high', entity: 'finance_cash_point_assignment' },
  { match: '/finance/cash',        event: 'FIN_CASH',       severity: 'high',     entity: 'finance_cash_office' },
  // The internal audit plan and its findings (migration 210): the auditor's own record.
  { match: '/finance/payables/payments', event: 'FIN_PAYMENT_VOUCHER', severity: 'critical', entity: 'finance_supplier_payment' },
  { match: '/finance/payables', event: 'FIN_SUPPLIER_INVOICE', severity: 'high', entity: 'finance_supplier_invoice' },
  { match: '/finance/assets/runs', event: 'FIN_DEPRECIATION', severity: 'critical', entity: 'finance_depreciation_run' },
  { match: '/finance/assets', event: 'FIN_ASSET', severity: 'high', entity: 'finance_fixed_asset' },
  { match: '/finance/bank', event: 'FIN_BANK_RECONCILIATION', severity: 'high', entity: 'finance_bank_statement' },
  { match: '/finance/migration/cutovers', event: 'FIN_CUTOVER', severity: 'critical', entity: 'finance_cutover' },
  { match: '/finance/migration', event: 'FIN_MIGRATION', severity: 'critical', entity: 'finance_migration_batch' },
  { match: '/finance/internal-audit', event: 'FIN_INTERNAL_AUDIT', severity: 'high', entity: 'finance_audit_engagement' },
  { match: '/finance',             event: 'FINANCE',        severity: 'medium',   entity: null },
  { match: '/auth/invite',         event: 'USER_MGMT',     severity: 'high',     entity: 'invite' },
  { match: '/auth',                event: 'AUTH',          severity: 'medium',   entity: null },
  { match: '/kyc',                 event: 'KYC',           severity: 'high',     entity: 'kyc_check' },
  { match: '/residency',           event: 'KYC',           severity: 'high',     entity: 'residency' },
  { match: '/payments',            event: 'PAYMENT',       severity: 'high',     entity: 'payment' },
  { match: '/enforcement',         event: 'ENFORCEMENT',   severity: 'high',     entity: 'enforcement_order' },
  { match: '/eho/notices',         event: 'ENFORCEMENT',   severity: 'high',     entity: 'health_notice' },
  { match: '/eho',                 event: 'HEALTH',        severity: 'medium',   entity: null },
  { match: '/inspector',           event: 'INSPECTION',    severity: 'high',     entity: 'inspection' },
  { match: '/inspections',         event: 'INSPECTION',    severity: 'high',     entity: 'inspection' },
  { match: '/occupation-cert',     event: 'CERTIFICATE',   severity: 'high',     entity: 'certificate' },
  { match: '/appeals',             event: 'APPEAL',        severity: 'high',     entity: 'appeal' },
  { match: '/development-control', event: 'DETERMINATION', severity: 'critical', entity: 'application' },
  { match: '/development-applications', event: 'APPLICATION', severity: 'high',  entity: 'application' },
  { match: '/planner/committee',   event: 'COMMITTEE',     severity: 'high',     entity: 'committee_item' },
  { match: '/gms/imports',         event: 'SURVEY_IMPORT', severity: 'critical', entity: 'general_plan' },
  { match: '/gms/edit-sessions',   event: 'GIS_EDIT',      severity: 'high',     entity: 'edit_session' },
  { match: '/gms/features',        event: 'GIS_EDIT',      severity: 'high',     entity: 'feature' },
  { match: '/gms/parcels',         event: 'PARCEL',        severity: 'high',     entity: 'parcel' },
  { match: '/integration',         event: 'INTEGRATION',   severity: 'medium',   entity: 'integration' },
  { match: '/gis-styles',          event: 'SYMBOLOGY',     severity: 'medium',   entity: 'gis_style' },
  { match: '/gis',                 event: 'SPATIAL',       severity: 'medium',   entity: 'feature' },
  { match: '/land-use',            event: 'LAND_USE',      severity: 'medium',   entity: 'land_use' },
  { match: '/site-content',        event: 'CONTENT',       severity: 'medium',   entity: 'content_block' },
  { match: '/documents',           event: 'DOCUMENT',      severity: 'medium',   entity: 'document' },
  { match: '/notifications',       event: 'NOTIFICATION',  severity: 'low',      entity: 'notification' },
]

function categorize(method, url) {
  for (const rule of RULES) {
    if (url.includes(rule.match)) return rule
  }
  // An unrecognised DELETE is still a deletion, and is worth more than 'low'.
  if (method === 'DELETE') return { event: 'DELETE', severity: 'high', entity: null }
  return { event: 'MUTATION', severity: 'low', entity: null }
}

/**
 * The record this request acted on.
 *
 * Fastify's params already hold whatever the route matched, so the id does not
 * have to be parsed back out of the URL. `:id` covers most routes; the few
 * that name their parameter differently are picked up by the fallbacks.
 */
function entityId(req) {
  const p = req.params || {}
  const value = p.id ?? p.parcel_id ?? p.applicationId ?? p.permitId ?? p.inspectionId ?? p.userId ?? p.key
  if (value === undefined || value === null) return null
  return String(value).slice(0, 64)
}

/**
 * A 4xx is not noise — a rejected attempt to change a permit is exactly what
 * an auditor wants to see. A 404 on a route nobody owns is, so it is dropped.
 */
function worthRecording(status) {
  return status !== 404
}

async function auditLog(fastify) {
  fastify.addHook('onResponse', async (req, reply) => {
    try {
      if (!MUTATING_METHODS.has(req.method)) return
      const url = req.url || ''
      if (SKIP.some((s) => url.startsWith(s))) return
      if (!worthRecording(reply.statusCode)) return

      // An unauthenticated mutation has no officer to attribute it to. Sign-in
      // attempts are recorded separately, with the address and the reason, in
      // admin_login_attempt — that table is the right home for them.
      const user = req.user
      if (!user?.id) return

      const { event, severity, entity } = categorize(req.method, url)
      const ip = req.ip || null
      const ua = req.headers['user-agent'] || null
      const ms = Number(reply.elapsedTime)

      // Query strings can carry a citizen's national ID or a search term; the
      // path alone is what the trail needs, and keeping PII out of the audit
      // table is the whole point of pruning it here.
      const path = url.split('?')[0].slice(0, 400)

      await systemOf(fastify.pg).query(
        `INSERT INTO public.admin_audit_event
           (actor_id, actor_email, actor_role, event, severity,
            method, path, status, duration_ms, entity_type, entity_id,
            ip, user_agent, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::inet, $13, $14::jsonb)`,
        [
          user.id, user.email ?? null, user.role ?? null,
          event, severity,
          req.method, path, reply.statusCode,
          Number.isFinite(ms) ? Math.round(ms) : null,
          entity, entityId(req),
          ip, ua,
          // A route may attach the before/after state of the change it just made
          // (req.auditDetails). The generic hook cannot know it, and an auditor
          // needs it for the changes that matter most — a permission grant, for
          // one. Everything is merged under the route's own keys, so a route
          // cannot accidentally overwrite routerPath.
          JSON.stringify({
            ...(req.auditDetails && typeof req.auditDetails === 'object' ? req.auditDetails : {}),
            routerPath: req.routeOptions?.url ?? req.routerPath ?? null,
          }),
        ],
      )
    } catch (err) {
      // Never fail the request being audited. The smoke test is what catches a
      // trail that has stopped being written; see the header.
      fastify.log.warn({ err }, 'audit-log write failed')
    }
  })
}

// fp() is load-bearing, not decoration. See the header.
const auditLogPlugin = fp(auditLog, { name: 'vungu-audit-log' })

module.exports = { auditLogPlugin, categorize, entityId }
