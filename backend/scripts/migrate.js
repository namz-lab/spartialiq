require("dotenv").config()
const fs = require('node:fs')
const path = require('node:path')
const { Pool } = require('pg')

const MIGRATIONS = [
  // Empty-but-shaped placeholders for legacy spatial tables that are only
  // populated from external sources (ogr2ogr imports / supervisor dump).
  // Fresh deployments need the shape so indexes, FKs and views parse.
  '000_legacy_spatial_stubs.sql',
  '001_initial_schema.sql',
  '042_development_applications.sql',
  // '050_enhance_land_use_management_corrected.sql' skipped: ALTER/INSERTs into
  // land_use_groups + land_zones tables that no migration creates. Re-enable
  // once a prerequisite migration that CREATEs those tables exists.
  '060_invite_system_and_roles.sql',
  '061_applicant_type_and_invite_roles.sql',
  '062_stands_and_planning_templates.sql',
  '063_notifications_and_inspections.sql',
  '064_payments_and_documents.sql',
  '065_plan_review.sql',
  '070_development_management_handbook_v1_2.sql',
  '071_stage_inspection_photos_and_flags.sql',
  '072_per_item_inspection_scoring.sql',
  '073_score_includes_na_as_zero.sql',
  '074_spatial_tile_indexes.sql',
  '075_v_application_summary_add_created_by.sql',
  '075_notifications_and_kyc.sql',
  '076_available_stands.sql',
  '076_production_hardening.sql',
  '077_permit_application_pending_payment.sql',
  // 3NF normalisation pass (reference tables, stands/zone cache + v_stands
  // view, status CHECK, user_profiles). Only fix: v_stands joins the canonical
  // proposed_peri_urban_zones (112 repoint), not the obsolete vungu_* copy.
  '078_3nf_normalization.sql',
  '078_missing_gist_indexes.sql',
  // Clip OSM buildings/water-wise layers to the council buffer — spatial
  // filter the vector-tile registry depends on (previously local-only).
  '079_filter_buildings_to_council_buffer.sql',
  '080_survey_tasks.sql',
  // Exposes `stands` as a vector-tile-compatible view (integer fid over
  // stands.id UUID); the tile registry serves table `stands_tile_view`.
  '080_stands_tile_view.sql',
  '081_v_application_summary_add_lnglat.sql',
  // 082–084 were applied to local/dev via psql but were never added to this
  // Render allowlist. They are idempotent and tracked in schema_migrations, so
  // listing them here is safe and ensures a fresh deploy has the planner case
  // columns (082) before 085 (which depends on them) runs.
  '082_planner_case_and_audit.sql',
  '083_committee_meetings.sql',
  '084_property_register.sql',
  '085_planner_case_backend.sql',
  '086_eo_decision_returns.sql',
  '087_generated_document_content.sql',
  '088_map_evidence_doc_type.sql',
  '089_public_notice.sql',
  '090_consultation_blocking_escalation.sql',
  '091_gis_editable_features.sql',
  '092_gis_feature_history.sql',
  '093_user_applicant_profile.sql',
  '094_site_content.sql',
  '095_planning_projects.sql',
  '096_planning_revisions.sql',
  '097_case_locking_mfa_sessions.sql',
  '098_control_points.sql',
  '099_survey_parcels.sql',
  '100_survey_task_zone_docs.sql',
  '101_statutory_plans.sql',
  '102_survey_task_manager.sql',
  '103_soft_delete.sql',
  '104_committee_quorum_attendance.sql',
  '105_stand_allocation.sql',
  '106_geometry_validation.sql',
  '107_stands_topology.sql',
  // 075_fix arrived after 107 shipped; it only CREATE OR REPLACEs a function,
  // so running it out of numeric order is safe (the allowlist IS the order).
  '075_fix_check_development_permission.sql',
  '108_planning_project_case_link.sql',
  '109_spatial_change_notify.sql',
  '110_local_authorities.sql',
  '111_spatial_layers_catalogue.sql',
  // Canonical peri-urban zoning source of truth: the vector-tile registry
  // serves table `zones_master` (spatialLayers.js) which only these two
  // migrations create — previously applied ad-hoc on local, never deployed.
  '112_zones_master_view.sql',
  '113_zones_master_columns.sql',
  '114_gis_style_registry.sql',
  '115_residency_verification.sql',
  '116_inspector_work_queue.sql',
  '117_stage_inspection_field_events.sql',
  '118_inspector_site_geometry.sql',
  '119_permit_document_uploads.sql',
  '120_building_complaints.sql',
  '121_environmental_health_registers.sql',
  '122_environmental_health_operations.sql',
  '123_council_ops_asset_registers.sql',
  '124_planning_clerk_registers.sql',
  '125_service_desk_tickets.sql',
  '126_stands_zone_id_integer.sql',
  // The IT admin console. Depends on public.users only.
  '127_admin_console.sql',
  // The Planning Clerk's nine statutory registers (spatial_planning.clerk_*).
  // Its only dependencies are spatial_planning.permit_application and
  // spatial_planning.set_updated_at(), both from 070, and public.users from
  // 001 — all of them earlier in this list.
  //
  // Not to be confused with 124_planning_clerk_registers.sql, which creates a
  // separate seven-table planning_clerk schema. 128 is the one the Planning
  // Clerk console talks to.
  '128_planning_clerk_registers.sql',
  // Self-service password reset. Depends on public.users (001) and
  // public.user_session (097) only by FK on users; the session revoke in the
  // route is a plain UPDATE that is a no-op where that table is absent.
  '129_password_reset.sql',
  // Revocable QGIS/API tokens: /auth/generate-api-token records each jti and
  // the sync routes refuse any token without a live row. FK on users only.
  '130_api_token_registry.sql',
  // First-party usage analytics table (page_view). It was written with 130-133 but left out of
  // this list, so it was never applied and POST /api/analytics/pageview had nothing to write to.
  '131_page_view.sql',
  // GIS Management System core register + ERP integration. Depends on
  // public.users (001) and public.admin_audit_event (127).
  '132_gis_core_register.sql',
  // GMS editing, QA queue and feature history. Depends on 132 (gis_ops).
  '133_gms_editing.sql',
  // Single-source the peri-urban zones table. Retargets the land-use-control
  // FK off the superseded copy the 2026-10-02 recovery restored, drops that
  // copy, and starts maintaining updated_at on a QGIS-authored table.
  '134_zones_single_source.sql',
  // area_ha as a STORED generated column: zones.js referenced a column that only
  // existed on the superseded copy, so every route in the file returned 500.
  '135_zones_area_ha.sql',
  // A value source for proposed_peri_urban_zones.id, without which drawing a new
  // zone in QGIS Desktop fails the NOT NULL constraint on insert.
  '136_zones_id_sequence.sql',
  // 137: land.parcel.accuracy_basis, how a parcel's position was arrived at; 174 fills it.
  '137_parcel_accuracy_basis.sql',
  // 138: district development control matrix. Zone-type keyed controls, the
  // coded land-use vocabulary, and the zone_effective_controls view.
  '138_district_development_matrix.sql',
  // 139: plan-model foundation. Authority kinds and combination membership, plan
  // profiles and instruments, zone types per plan, existing data attached.
  '139_plan_model_foundation.sql',
  // 140: a plan owns its land uses and decisions. Land-use codes unique per plan,
  // decisions on a plan's own zone types, adopt_plan_template() and plan_diff().
  '140_plan_scoped_matrix.sql',
  // 141: reference classification (HILUCS L1-2), crosswalk, urban starter palette; adopt copies the crosswalk.
  '141_reference_classification_and_urban_starter.sql',
  // 142: default template per profile, rural starter palette, plan_compare() and import_plan_items().
  '142_rural_starter_palette_and_palette_tools.sql',
  // 143-145: decision pathways and zone standards; parcel zoning; application rule snapshots.
  '143_decision_pathways_and_zone_standards.sql',
  '144_parcel_zoning.sql',
  '145_application_rule_snapshots.sql',
  // 146: permit parcel link, append-only rule snapshots; retires the snapshot columns on development_applications.
  '146_permit_parcel_and_rule_snapshots.sql',
  // 147: Vungu's plan gets the council use-class vocabulary (no decisions) and proposed class mappings.
  '147_vungu_plan_land_uses.sql',
  // 148: renaming a zone polygon keeps its zone type in step; repairs Vungu's Cemetry typo.
  '148_zone_rename_keeps_zone_type.sql',
  // 149: drops the unused legacy table public.gweru_peri_urban_zone (dumped first).
  '149_drop_gweru_peri_urban_zone.sql',
  // 150: plan workbench support: events, sign-off, status chain, freeze, versions, decision diff.
  '150_plan_workbench.sql',
  // 151: council settings for the usage analytics (kill switch, retention).
  '151_analytics_settings.sql',
  // 152: layer_publication, the server's approval list behind the QGIS-project layer catalogue.
  '152_layer_publication.sql',
  // 154: authority membership for users and row-level security on permits and plans (Phase 4, slice 1).
  '154_authority_row_level_security.sql',
  // 155: permit children (consultations, objections, inspections, ...) follow their permit (Phase 4, slice 2).
  '155_permit_children_row_level_security.sql',
  // 156-160: matrix reference data derived from the local plan draft: use-group hierarchy, development activities,
  // standard kinds, existing use as a group, and the matrix audit view.
  '156_land_use_group_hierarchy.sql',
  '157_development_activity.sql',
  '158_activity_standard_kinds.sql',
  '159_existing_use_land_use_group.sql',
  '160_plan_matrix_audit.sql',
  // 161: provisional rules: review status per zone column, and the provisional flag in every rule snapshot.
  '161_provisional_rules.sql',
  // 162: the spatial concept registry (generic layer ids and the sources behind them) and the spatial tests each
  // development activity needs.
  '162_spatial_concepts.sql',
  // 163: admin.ward is the canonical ward table (public.wards becomes a view); the authority-to-ward relation and an
  // authority's area as the union of its wards; reference data read-only for the application role.
  '163_admin_ward_authority_area.sql',
  // 164: land.parcel can hold farms as well as surveyed stands, and records where each row came from.
  '164_land_parcel_kinds.sql',
  // 165: the tenancy contract: every relation classified, a guard view of any departure, default-deny for new objects,
  // secrets closed to the application role, reference and national data read only.
  '165_tenancy_contract.sql',
  // 166: least-privilege login roles for direct clients (QGIS, the tile server), bound to an authority by the role itself.
  '166_direct_client_roles.sql',
  // 167: tenancy.make_tenant / make_tenant_child (one call turns authority-owned data into tenant data); council_ops converted.
  '167_make_tenant.sql',
  '168_runtime_role.sql',
  '169_spatial_planning_tenancy.sql',
  '170_statutory_periods.sql',
  '171_acknowledgement_starts_clock.sql',
  '172_stands_revenue_legacy_tenancy.sql',
  '173_embedded_survey_legacy.sql',
  '174_parcel_survey_class.sql',
  '175_parcel_event.sql',
  '176_surveypro_import_run.sql',
  // 181–187 were first applied to dev databases by hand, out of band, which left them off this
  // list — until a fresh deploy (and the acceptance harness) proved the point: routes read
  // columns these add (stands.requires_minister_approval from 185 among them) and a database
  // migrated from the chain alone 500s on stand allocation. They are idempotent (IF NOT EXISTS
  // / DO guards, no destructive statements) and sit in numeric order, which is the order they
  // were applied in by hand, so adding them here changes nothing for a database that already
  // has them and fixes one that does not.
  '181_council_statutory_registers.sql',
  '182_custodian_boundary_scaffolds.sql',
  '183_acua_stand_subunits.sql',
  '184_runtime_gap_tables.sql',
  '185_use_cases_complete.sql',
  '186_zoning_lookup_view.sql',
  '187_fill_parcel_register_and_rates.sql',
  // The finance foundation: the finance schema, the chart of accounts, budgets and their
  // revision history, the actuals register, imports, projects, publication control and the
  // finance permission catalogue. Depends on 154/165/167 (tenancy) and nothing from 181-187.
  '188_finance_foundation.sql',
  '189_finance_project_reporting.sql',
  // F-05: a transaction may not be posted against a budget line from another financial year.
  // Currency mismatches stay storable and reported (specification A8/§6.4), so they are not rejected.
  '190_finance_transaction_line_year.sql',
  // F-07: derive a document's financial year from its subject and index it for the public register.
  '191_finance_document_year.sql',
  // D-04: the closed-year guard also covers project allocations and project links.
  '192_finance_closed_year_project_links.sql',
  // D-05: document in the schema that the exchange-rate table is intentionally dormant (decision D4).
  '193_finance_exchange_rate_dormant.sql',
  // P-01: make the publication policies set-based and short-circuit the tenant policies for the
  // public session. Fixes the 20k-transaction statement timeout without weakening RLS.
  '194_finance_public_query_performance.sql',
  // The column /api/context/parcels reads (estimated positional accuracy, metres). Its migration
  // never landed: the endpoint 500s on a chain-built database without this.
  '195_parcel_estimated_accuracy.sql',
  // 085 rebuilt the permit status CHECK without 077's 'pending_payment': the online
  // application-fee flow has 500'd on every chain-built database since. Restores it.
  '196_permit_pending_payment_restored.sql',
  // Cross-tenant fix: published_select serves only the authority-less public session
  // (and a session's own council). Other councils' staff no longer match it.
  '197_published_select_public_session_only.sql',
  // GIS-finance integration Milestone 2: the explicit multi-area split table with its
  // guard trigger (subject/currency/council pinning, all-or-nothing roll-up semantics,
  // approval caps against the canonical totals) and ward-code normalisation.
  '198_finance_spatial_allocation.sql',
  // The ward roll-ups the map renders: budget attribution (allocation splits, whole-line
  // ward codes, unallocated remainders, unlocated), ward performance per year+currency,
  // the unlocated register, and the read-only finance.map.view permission.
  '199_finance_ward_performance.sql',
  // Access-control hardening for the four blockers in the production-readiness audit:
  // published_select for finance.spatial_allocation (B-1), the published budget-line view the
  // public route now filters through (BLOCKER-1), the finance.document.withdraw write permission
  // with its withdrawn_reason column (BLOCKER-3), and the deferred separation-of-duties
  // constraint over one person's EFFECTIVE permission set (BLOCKER-2).
  '200_finance_access_control_hardening.sql',
  // Decision D11, provisionally: links the COD-AB wards of district ZW1704 to authority VUNGU
  // with basis 'interim' and an instrument_ref saying the list is unconfirmed, so the ward
  // choropleth has real geometry. Loads exactly what admin.ward actually contains -- none, on a
  // database where the national ward register was never imported.
  '201_authority_ward_provisional_register.sql',
  // The SQL half of GIS-finance M4/M5/M7: project physical progress with its configurable
  // spend-versus-progress threshold (D12), the attribution and ward views completed with the
  // missing dimensions, measures and the second actuals basis, the department/programme
  // breakdown view, spatial_allocation inside the closed-year trigger set (MAJOR-8), and the
  // re-validation that refuses a reduction leaving approved splits over the revised total
  // (MAJOR-1).
  '202_finance_spatial_measures_and_progress.sql',
  // The general ledger core: the GL chart of accounts, accounting periods, the voucher /
  // voucher_line business document, the INSERT-ONLY finance.ledger_entry, the party register and
  // the trial-balance / account-balance / debtor-ageing views. The three invariants live in the
  // DATABASE rather than in a route -- a deferred constraint trigger asserting that a voucher's
  // debits equal its credits, one currency per voucher (two books, no rate, decision D4), and
  // immutability of a posted line, with UPDATE/DELETE/TRUNCATE revoked from the application role
  // and refused by trigger. Seeds the eight finance.ledger.* permissions and no data at all: the
  // chart of accounts is a Council resolution, and the retraction that lets this be the book of
  // account is decision D16.
  '203_finance_general_ledger.sql',
  // Budget phasing profiles: a named per-financial-year profile of period percentages, keyed by
  // the SAME period keys src/lib/financePeriods.js generates, so a July-June year phases Jul-Sep
  // as Q1. The total-100 rule is a DEFERRED CONSTRAINT TRIGGER rather than a model validation, so
  // a profile written by psql or an import is refused too. budget_line.distribution_id is
  // NULLABLE and NULL means the phasing was never recorded -- the management account then reports
  // the annual allocation and no per-period budget, and never an even twelfth. Seeds nothing: an
  // even spread is a Council choice (decision D20), not a default the code applies.
  '204_finance_budget_phasing.sql',
  // Rates billing, debtors and arrears -- the client's selected functional scope. The valuation
  // roll (D17), the tariff schedule (D18) and the rates accounts that tie a land.parcel to a
  // finance.party as ratepayer of record (D19), plus the bill, receipt, billing-run and
  // billing-REFUSAL records. Bills post through finance.post_voucher() and nothing here writes
  // finance.ledger_entry. finance.rates_bill.amount is a GENERATED column over
  // finance.rates_bill_amount(), so the charge has exactly one definition and no route computes
  // it. Seeds no data at all: 731 parcels exist, none has a value, no rate exists and
  // spatial_planning.parcel_owner holds 0 rows -- so a run today considers 731 properties, raises
  // 0 bills and writes 731 refusals naming the decision each waits on (acceptance check G9).
  '205_finance_rates.sql',
  // Rates operations. Corrects finance.v_debtor_ageing so a reversal acts on the voucher it
  // reverses: until this, a dishonoured receipt left its bill reading `settled` and the debt fell
  // out of finance.v_rates_arrears, which then disagreed with the receivable control account.
  // Adds the three acts 205 stopped short of -- finance.record_rates_receipt(),
  // finance.commit_rates_billing_run() and finance.cancel_rates_billing_run(), each atomic and
  // none writing finance.ledger_entry itself -- plus finance.rates_bill_unsettled() (the cashier's
  // figure, counting draft receipts so one bill cannot be settled twice) and the constraint that
  // whoever drafts a tariff does not approve it. Uses CREATE OR REPLACE VIEW, never DROP CASCADE:
  // finance.v_rates_arrears reads the ageing view. Seeds nothing.
  '206_finance_rates_operations.sql',
  // The enterprise role model, phase 1, and the cash office. Adds four roles that arrive WITH
  // work -- cashier, accountant, revenue_officer, accounting_officer -- by rebuilding
  // users_role_check additively from whatever it holds. Adds cash points and income codes (both
  // seeded empty, decision D22), cashier sessions, the general receipt, the cash-up and the
  // banking. Receipt numbers come from finance.document_sequence, a ROW counter and not a
  // SEQUENCE, so a rolled-back receipt burns no number. A receipt is taken only inside the
  // caller's own open session, is never edited or deleted, and reaches the ledger when a
  // DIFFERENT person verifies the cash-up -- finance.verify_cashier_session() posts the whole
  // session through finance.post_voucher(), which stays the only writer of finance.ledger_entry.
  // A cash difference is posted to the cash point's difference account or verification is
  // refused. Seeds the seven finance.cash.* permissions and no data.
  '207_finance_cash_office.sql',
  // The till session lifecycle. Adds `suspended` and `abandoned` to a cashier session -- both still
  // HOLD the drawer, so one-cashier-per-drawer is unchanged -- and the only way out of `abandoned` is a
  // count by a supervisor with a witness, verified by a fourth person. Adds the cash_supervisor role,
  // cash point assignment, and finance.cashier_session_event, an append-only history written by
  // triggers. Fingerprints every existing session, receipt, voucher and ledger row and refuses to
  // commit if any changed. Policy values (abandon threshold, assignment required) are provisional,
  // decision D29. Rollback: migrations/rollback/208_cash_session_lifecycle.down.sql.
  '208_cash_session_lifecycle.sql',
  // 209-214 were applied to dev databases by hand and never added here, so a database built from
  // this chain 500s on the cashier's service queue, the auditor's dashboard (finance.audit_finding),
  // the cut-over, bank reconciliation, creditors and the fixed-asset register, whose routes read
  // them; the CEO's Executive dashboard reads the audit findings. Each has its rollback in
  // migrations/rollback/ and depends on nothing later than 208.
  '209_cash_service_queue.sql',
  '210_finance_internal_audit.sql',
  '211_finance_cutover.sql',
  '212_finance_bank_reconciliation.sql',
  '213_finance_creditors.sql',
  '214_finance_fixed_assets.sql',
  // The spatial engine: ward measures for the Chief Executive's maps (schema spatial_engine). Reads registers
  // only; stores its own results. Rollback: migrations/rollback/215_spatial_engine.down.sql.
  '215_spatial_engine.sql',
]

function createPool(env = process.env) {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run migrations.')
  }
  return new Pool({
    connectionString: env.DATABASE_URL,
  })
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)
}

async function appliedMigrations(client) {
  const { rows } = await client.query('SELECT filename FROM schema_migrations')
  return new Set(rows.map(row => row.filename))
}

async function applyMigration(client, filename) {
  const migrationPath = path.join(__dirname, '..', 'migrations', filename)
  const sql = fs.readFileSync(migrationPath, 'utf8')
  console.log(`[render-migrate] applying ${filename}`)
  await client.query(sql)
  await client.query(
    `INSERT INTO schema_migrations (filename, applied_at)
     VALUES ($1, NOW())
     ON CONFLICT (filename) DO NOTHING`,
    [filename],
  )
}

async function runRenderMigrations(env = process.env) {
  const pool = createPool(env)
  const client = await pool.connect()
  try {
    await ensureMigrationTable(client)
    const applied = await appliedMigrations(client)
    for (const filename of MIGRATIONS) {
      if (applied.has(filename)) {
        console.log(`[render-migrate] skipping ${filename}`)
        continue
      }
      await applyMigration(client, filename)
    }
    console.log('[render-migrate] complete')
  } finally {
    client.release()
    await pool.end()
  }
}

if (require.main === module) {
  runRenderMigrations().catch((error) => {
    console.error('[render-migrate] failed:', error)
    process.exit(1)
  })
}

module.exports = {
  MIGRATIONS,
  createPool,
  runRenderMigrations,
}
