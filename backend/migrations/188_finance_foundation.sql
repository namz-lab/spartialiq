-- 188: the finance foundation — financial years, the chart of accounts, budgets and their revision
-- history, the actuals register, imports, projects, publication control and a real finance
-- permission catalogue.
--
-- WHY A NEW SCHEMA
-- Nothing in this database holds council budget data. `public.payments` is citizen application
-- fees; `revenue_link.account_link` maps a parcel to an ERP account and is not a classification.
-- The council's budget is a distinct subject with its own approval and publication controls, so it
-- gets its own schema rather than another twenty tables in `public`.
--
-- ROUTES / FEATURES THAT DEPEND ON THIS
--   src/routes/finance-config.js       financial years, departments, programmes, accounts, settings
--   src/routes/finance-budget.js       budget lines, revisions, variance explanations
--   src/routes/finance-imports.js      upload, mapping, validate, exceptions, commit, reconcile
--   src/routes/finance-projects.js     project register and transaction association
--   src/routes/finance-publication.js  publication queue
--   src/routes/finance-public.js       the public portal's read-only surface
--   src/middleware/financePermissions.js  requirePermission(), reading the catalogue below
--
-- THREE DESIGN DECISIONS WORTH THE READING TIME
--
-- 1. An account's revenue/expenditure classification is DATA, not arithmetic. The reference
--    implementation this work drew on infers it from the numeric range of the account code
--    (`item < 5000` is income, 5000–8000 expenditure — the Czech *položka* convention). That is a
--    local accounting convention masquerading as a rule. Here `finance.account.kind` is set
--    explicitly per account from the Council-approved chart of accounts, and an import citing an
--    unknown code lands in the exception queue instead of being guessed at.
--
-- 2. A transaction carries its ORIGINAL amount and currency and is never converted. USD and ZWG
--    rows coexist in one register and every aggregate groups by currency, so a cross-currency
--    total cannot be produced by forgetting to think about it. `finance.exchange_rate_policy`
--    exists, is empty, and nothing reads it: conversion needs a Council-approved rate source
--    (decision D4).
--
-- 3. Separation of duties is data. `finance.permission` is a catalogue, `finance.role_permission`
--    the default grants, and no seeded role holds both an approval and the publication
--    permission. The technical administrator (`admin`) is seeded with no permission that moves
--    money — deliberately unlike the rest of this codebase, where `admin` is permitted nearly
--    everywhere.
--
-- IDEMPOTENT: every statement is IF NOT EXISTS / ON CONFLICT DO NOTHING / CREATE OR REPLACE, and
-- the tenancy conversion at the foot is guarded on the VUNGU authority existing. Safe to re-run.

CREATE SCHEMA IF NOT EXISTS finance;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0. SHARED TYPES
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Zimbabwe local authorities budget in USD; ZWG has been legal tender alongside it since April
-- 2024. Both are first-class and are never added together. Adding a currency is a migration, on
-- purpose: a new code must be a decision, not a free-text typo.
DO $$ BEGIN
  CREATE DOMAIN finance.currency_code AS text
    CONSTRAINT currency_code_known CHECK (VALUE IN ('USD', 'ZWG'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- NUMERIC(18,2), never float. 18 digits carries a national-scale figure in ZWG cents.
DO $$ BEGIN
  CREATE DOMAIN finance.money AS numeric(18,2);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. PERMISSION CATALOGUE  (global: a catalogue, not any one council's data)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS finance.permission (
  code          text PRIMARY KEY,
  label         text NOT NULL,
  category      text NOT NULL,
  -- An approval permission decides official financial content. A publication permission releases
  -- it to the public. The seeding below asserts that no role holds one of each.
  is_approval   boolean NOT NULL DEFAULT false,
  is_publication boolean NOT NULL DEFAULT false,
  -- Reads that expose supplier identity, personal data or commercially sensitive detail.
  is_restricted boolean NOT NULL DEFAULT false,
  description   text
);

CREATE TABLE IF NOT EXISTS finance.role_permission (
  role_name       text NOT NULL,
  permission_code text NOT NULL REFERENCES finance.permission (code) ON DELETE CASCADE,
  PRIMARY KEY (role_name, permission_code)
);

-- Per-person least privilege on top of the role defaults. `deny` always wins, so a single person
-- can be held back from something their role would otherwise allow without inventing a role.
CREATE TABLE IF NOT EXISTS finance.user_permission_override (
  user_id         uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES finance.permission (code) ON DELETE CASCADE,
  effect          text NOT NULL CHECK (effect IN ('grant', 'deny')),
  authority_id    integer REFERENCES public.local_authorities (id),
  reason          text,
  granted_by      uuid REFERENCES public.users (id),
  granted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  PRIMARY KEY (user_id, permission_code)
);

-- Department-level data scope. A departmental head sees their own votes; an empty scope means
-- "not scoped" and is interpreted by the route as council-wide for roles that are council-wide.
CREATE TABLE IF NOT EXISTS finance.user_scope (
  user_id       uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  department_id uuid NOT NULL,
  granted_by    uuid REFERENCES public.users (id),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, department_id)
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. COUNCIL CONFIGURATION
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- `public.local_authorities` is the specification's `councils` entity; it already exists and
-- carries the code, name, kind and jurisdiction. Only the finance-specific settings are new.
CREATE TABLE IF NOT EXISTS finance.setting (
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  key          text NOT NULL,
  value        jsonb NOT NULL,
  updated_by   uuid REFERENCES public.users (id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (authority_id, key)
);

CREATE TABLE IF NOT EXISTS finance.financial_year (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  label        text NOT NULL,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  -- draft: being set up. open: the only state that accepts writes. closed: frozen, still readable.
  -- archived: closed and withdrawn from routine listings.
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'archived')),
  reporting_currency finance.currency_code NOT NULL DEFAULT 'USD',
  opened_at    timestamptz,
  opened_by    uuid REFERENCES public.users (id),
  closed_at    timestamptz,
  closed_by    uuid REFERENCES public.users (id),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES public.users (id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  deleted_by   uuid REFERENCES public.users (id),
  CONSTRAINT financial_year_dates CHECK (end_date > start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_year_label
  ON finance.financial_year (authority_id, label) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_financial_year_status ON finance.financial_year (authority_id, status);

-- The vote: which arm of the council spends or collects. `vote_number` is the council's own
-- numbering and is informational; `code` is what source exports carry and what imports match on.
CREATE TABLE IF NOT EXISTS finance.department (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  code         text NOT NULL,
  name         text NOT NULL,
  vote_number  integer,
  parent_id    uuid REFERENCES finance.department (id),
  head_user_id uuid REFERENCES public.users (id),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES public.users (id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  deleted_by   uuid REFERENCES public.users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_department_code
  ON finance.department (authority_id, code) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS finance.programme (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id  integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  department_id uuid NOT NULL REFERENCES finance.department (id),
  code          text NOT NULL,
  name          text NOT NULL,
  description   text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.users (id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  deleted_by    uuid REFERENCES public.users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_programme_code
  ON finance.programme (authority_id, code) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS finance.activity (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  programme_id uuid NOT NULL REFERENCES finance.programme (id),
  code         text NOT NULL,
  name         text NOT NULL,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES public.users (id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  deleted_by   uuid REFERENCES public.users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_activity_code
  ON finance.activity (authority_id, code) WHERE deleted_at IS NULL;

-- The chart of accounts — the economic line. `kind` is the whole point of this table: it says
-- whether money on this code is coming in or going out, and it is SET BY THE COUNCIL, never
-- derived from the shape of the code. See decision D2.
CREATE TABLE IF NOT EXISTS finance.account (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  code         text NOT NULL,
  name         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('revenue', 'expenditure')),
  -- Specification §3.4: internally generated revenue, grants, transfers and other funding must be
  -- distinguishable. Only meaningful on revenue accounts.
  revenue_class text CHECK (revenue_class IN ('internally_generated', 'grant', 'transfer', 'other')),
  -- Specification §3.5 / §6: capital and recurrent are reported separately.
  expenditure_class text CHECK (expenditure_class IN ('recurrent', 'capital')),
  parent_id    uuid REFERENCES finance.account (id),
  -- A heading cannot be posted against; only leaves carry transactions.
  is_postable  boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to   date,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES public.users (id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  deleted_by   uuid REFERENCES public.users (id),
  CONSTRAINT account_class_matches_kind CHECK (
    (kind = 'revenue'     AND expenditure_class IS NULL) OR
    (kind = 'expenditure' AND revenue_class     IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_code
  ON finance.account (authority_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_account_kind ON finance.account (authority_id, kind);

-- A Council-approved conversion basis. EMPTY AND INERT: no code reads this table. Populating it
-- is decision D4 and will need its own migration to wire the reporting layer up.
CREATE TABLE IF NOT EXISTS finance.exchange_rate_policy (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id   integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  from_currency  finance.currency_code NOT NULL,
  to_currency    finance.currency_code NOT NULL,
  rate           numeric(18,6) NOT NULL CHECK (rate > 0),
  rate_date      date NOT NULL,
  rate_source    text NOT NULL,
  method         text NOT NULL,
  approved_by    uuid REFERENCES public.users (id),
  approved_at    timestamptz,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exchange_rate_distinct_currencies CHECK (from_currency <> to_currency)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_exchange_rate_policy
  ON finance.exchange_rate_policy (authority_id, from_currency, to_currency, rate_date);

-- Delegated approval authority by amount. EMPTY: decision D6. While empty, every revision needs
-- an explicit approval event from someone who is not the requester; nothing auto-approves.
CREATE TABLE IF NOT EXISTS finance.approval_threshold (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id        integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  scope               text NOT NULL CHECK (scope IN ('budget_revision', 'project', 'publication')),
  currency            finance.currency_code NOT NULL,
  min_amount          finance.money NOT NULL DEFAULT 0,
  max_amount          finance.money,
  required_permission text NOT NULL REFERENCES finance.permission (code),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3. IMPORTS  (declared before the records they create, so the lineage FK can be NOT NULL-able)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Which source columns feed which target field. Configuration, not code: a council uploads what
-- its finance system exports, and adding a system means adding aliases here rather than asking
-- the council to rename columns. Seeded from the spellings observed in PROMUN and Pastel/Sage
-- style exports; no format is assumed correct (decision D7).
CREATE TABLE IF NOT EXISTS finance.column_mapping (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id  integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  name          text NOT NULL,
  dataset       text NOT NULL CHECK (dataset IN ('budget', 'actuals', 'commitments', 'projects')),
  source_system text,
  -- { target_field: [accepted source header, ...] }. Matching is case- and space-insensitive.
  mapping       jsonb NOT NULL,
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.users (id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  deleted_by    uuid REFERENCES public.users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_column_mapping_name
  ON finance.column_mapping (authority_id, name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS finance.import_batch (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  financial_year_id uuid NOT NULL REFERENCES finance.financial_year (id),
  dataset           text NOT NULL CHECK (dataset IN ('budget', 'actuals', 'commitments', 'projects')),
  original_filename text NOT NULL,
  -- Where the untouched upload is kept. Specification §5.1: preserve the original source file.
  stored_object_key text NOT NULL,
  file_hash         text NOT NULL,
  file_size_bytes   bigint NOT NULL,
  mime_type         text,
  mapping_id        uuid REFERENCES finance.column_mapping (id),
  -- Supplied by the caller. Two commit attempts carrying the same key are the same attempt, so a
  -- retry after a timeout cannot double-post (specification §9.1).
  idempotency_key   text NOT NULL,
  status            text NOT NULL DEFAULT 'uploaded'
                    CHECK (status IN ('uploaded', 'mapped', 'validating', 'validated',
                                      'committing', 'committed', 'failed', 'cancelled', 'superseded')),
  rows_total        integer NOT NULL DEFAULT 0,
  rows_valid        integer NOT NULL DEFAULT 0,
  rows_rejected     integer NOT NULL DEFAULT 0,
  -- What the council says the source totals are. Reconciliation compares against these rather
  -- than against the file, so a truncated upload is caught (specification §6.5).
  declared_control_count    integer,
  declared_control_total    finance.money,
  declared_control_currency finance.currency_code,
  reconciled_count   integer,
  reconciled_total   finance.money,
  reconciliation_status text NOT NULL DEFAULT 'not_checked'
                        CHECK (reconciliation_status IN ('not_checked', 'matched', 'mismatched', 'not_declared')),
  error_summary     text,
  uploaded_by       uuid NOT NULL REFERENCES public.users (id),
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  validated_at      timestamptz,
  committed_at      timestamptz,
  committed_by      uuid REFERENCES public.users (id),
  superseded_by     uuid REFERENCES finance.import_batch (id),
  deleted_at        timestamptz,
  deleted_by        uuid REFERENCES public.users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_batch_idempotency
  ON finance.import_batch (authority_id, idempotency_key);
-- The same file cannot be committed twice for the same year and dataset. A correction is a new
-- batch that supersedes the old one, never a second commit of the same bytes (specification §6.5).
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_batch_committed_file
  ON finance.import_batch (authority_id, financial_year_id, dataset, file_hash)
  WHERE status = 'committed';
CREATE INDEX IF NOT EXISTS idx_import_batch_status ON finance.import_batch (authority_id, status);
CREATE INDEX IF NOT EXISTS idx_import_batch_year ON finance.import_batch (financial_year_id);

-- Staging. Every row of the upload lands here with its raw values kept verbatim, so a rejected
-- row can be shown to the officer exactly as the council's system wrote it.
CREATE TABLE IF NOT EXISTS finance.import_row (
  id           bigserial PRIMARY KEY,
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  batch_id     uuid NOT NULL REFERENCES finance.import_batch (id) ON DELETE CASCADE,
  row_number   integer NOT NULL,
  raw          jsonb NOT NULL,
  normalised   jsonb,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'valid', 'rejected', 'committed', 'skipped_duplicate')),
  target_id    uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_row ON finance.import_row (batch_id, row_number);
CREATE INDEX IF NOT EXISTS idx_import_row_status ON finance.import_row (batch_id, status);

-- The exception queue. Specification §5.3: a transaction that cannot be mapped reliably must land
-- here. It must NOT be silently assigned to a default department or budget line, and no code in
-- this module does so.
CREATE TABLE IF NOT EXISTS finance.import_exception (
  id           bigserial PRIMARY KEY,
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  batch_id     uuid NOT NULL REFERENCES finance.import_batch (id) ON DELETE CASCADE,
  row_number   integer NOT NULL,
  field        text,
  error_code   text NOT NULL,
  message      text NOT NULL,
  raw          jsonb,
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES public.users (id),
  resolution   text CHECK (resolution IN ('corrected_at_source', 'mapping_added', 'row_excluded', 'accepted_as_is')),
  resolution_note text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_import_exception_batch ON finance.import_exception (batch_id);
CREATE INDEX IF NOT EXISTS idx_import_exception_open
  ON finance.import_exception (authority_id) WHERE resolved_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4. BUDGETS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- `original_amount` is written once, at approval, and never changed. Every later movement is a row
-- in finance.budget_revision. That is what makes "original and revised separately visible"
-- (specification §3.3, test §13.1) structural rather than a reporting convention.
CREATE TABLE IF NOT EXISTS finance.budget_line (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  financial_year_id uuid NOT NULL REFERENCES finance.financial_year (id),
  department_id     uuid NOT NULL REFERENCES finance.department (id),
  programme_id      uuid REFERENCES finance.programme (id),
  activity_id       uuid REFERENCES finance.activity (id),
  account_id        uuid NOT NULL REFERENCES finance.account (id),
  -- The organisational unit: a ward or cost centre. The existing ward register is `admin.ward`,
  -- which is keyed by `ward_code` (a text P-code from the national delimitation), not by a uuid.
  -- No foreign key: that register is national reference data that a fresh database may not yet
  -- carry, and a budget must not be un-enterable because the ward table has not been loaded. The
  -- route and the importer validate the code against it when it is populated.
  ward_code         text,
  funding_source_account_id uuid REFERENCES finance.account (id),
  code              text NOT NULL,
  description       text NOT NULL,
  currency          finance.currency_code NOT NULL,
  original_amount   finance.money NOT NULL DEFAULT 0,
  -- draft → submitted → (returned | approved) → published. Specification §5.2.
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'submitted', 'returned', 'approved', 'published')),
  submitted_at      timestamptz,
  submitted_by      uuid REFERENCES public.users (id),
  returned_note     text,
  approved_at       timestamptz,
  approved_by       uuid REFERENCES public.users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES public.users (id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  deleted_by        uuid REFERENCES public.users (id),
  CONSTRAINT budget_line_amount_not_negative CHECK (original_amount >= 0),
  CONSTRAINT budget_line_approval_recorded CHECK (
    status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_line_code
  ON finance.budget_line (authority_id, financial_year_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_budget_line_year_dept
  ON finance.budget_line (financial_year_id, department_id);
CREATE INDEX IF NOT EXISTS idx_budget_line_account ON finance.budget_line (account_id);
CREATE INDEX IF NOT EXISTS idx_budget_line_status ON finance.budget_line (authority_id, status);

CREATE TABLE IF NOT EXISTS finance.budget_revision (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id   integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  budget_line_id uuid NOT NULL REFERENCES finance.budget_line (id),
  revision_no    integer NOT NULL,
  -- Signed: a positive delta is a supplementary allocation, a negative one a reduction.
  amount_delta   finance.money NOT NULL,
  currency       finance.currency_code NOT NULL,
  reason         text NOT NULL,
  evidence_document_id uuid,
  state          text NOT NULL DEFAULT 'draft'
                 CHECK (state IN ('draft', 'submitted', 'approved', 'rejected', 'withdrawn')),
  effective_date date,
  requested_by   uuid NOT NULL REFERENCES public.users (id),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  submitted_at   timestamptz,
  decided_by     uuid REFERENCES public.users (id),
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  deleted_by     uuid REFERENCES public.users (id),
  CONSTRAINT budget_revision_delta_not_zero CHECK (amount_delta <> 0),
  -- Separation of duties, enforced by the database rather than by remembering to check: an
  -- approved revision has a decision maker, and that person is not the person who asked for it.
  CONSTRAINT budget_revision_requester_is_not_approver CHECK (
    state <> 'approved' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decided_by <> requested_by))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_revision_no
  ON finance.budget_revision (budget_line_id, revision_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_budget_revision_state ON finance.budget_revision (authority_id, state);

CREATE TABLE IF NOT EXISTS finance.commitment (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id   integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  budget_line_id uuid NOT NULL REFERENCES finance.budget_line (id),
  reference      text NOT NULL,
  amount         finance.money NOT NULL CHECK (amount >= 0),
  currency       finance.currency_code NOT NULL,
  committed_on   date NOT NULL,
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'partially_liquidated', 'liquidated', 'cancelled')),
  liquidated_amount finance.money NOT NULL DEFAULT 0 CHECK (liquidated_amount >= 0),
  source_system  text,
  source_ref     text,
  import_batch_id uuid REFERENCES finance.import_batch (id),
  description    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES public.users (id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  deleted_by     uuid REFERENCES public.users (id),
  CONSTRAINT commitment_liquidation_within_amount CHECK (liquidated_amount <= amount)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_commitment_source
  ON finance.commitment (authority_id, source_system, source_ref)
  WHERE source_ref IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_commitment_line ON finance.commitment (budget_line_id);

CREATE TABLE IF NOT EXISTS finance.variance_explanation (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  financial_year_id uuid NOT NULL REFERENCES finance.financial_year (id),
  budget_line_id    uuid REFERENCES finance.budget_line (id),
  department_id     uuid REFERENCES finance.department (id),
  period_label      text,
  explanation       text NOT NULL,
  recorded_by       uuid NOT NULL REFERENCES public.users (id),
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  deleted_by        uuid REFERENCES public.users (id),
  CONSTRAINT variance_explanation_has_subject CHECK (budget_line_id IS NOT NULL OR department_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_variance_explanation_line ON finance.variance_explanation (budget_line_id);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5. PROJECTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The municipal capital/development project register. It does not duplicate the existing planning
-- entities — `linked_subject_kind` / `linked_subject_id` point at them by their own primary keys,
-- so a planning application or a planning project keeps one identity across both domains. The
-- `location` geometry puts a project on the same map as everything else in this product.
CREATE TABLE IF NOT EXISTS finance.project (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id  integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  reference     text NOT NULL,
  name          text NOT NULL,
  description   text,
  department_id uuid REFERENCES finance.department (id),
  ward_code     text,
  location_text text,
  location      geometry(Point, 4326),
  funding_source_account_id uuid REFERENCES finance.account (id),
  start_date    date,
  end_date      date,
  status        text NOT NULL DEFAULT 'proposed'
                CHECK (status IN ('proposed', 'awaiting_approval', 'approved', 'in_progress',
                                  'suspended', 'completed', 'cancelled')),
  currency      finance.currency_code NOT NULL,
  approved_budget finance.money NOT NULL DEFAULT 0 CHECK (approved_budget >= 0),
  -- Stable reference into the existing domain. 'other' covers a project with no digital antecedent.
  linked_subject_kind text CHECK (linked_subject_kind IN (
    'development_application', 'planning_project', 'survey_project',
    'council_asset', 'service_desk_ticket', 'environmental_review', 'other')),
  linked_subject_id   text,
  approved_at   timestamptz,
  approved_by   uuid REFERENCES public.users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.users (id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  deleted_by    uuid REFERENCES public.users (id),
  CONSTRAINT project_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CONSTRAINT project_link_is_complete CHECK (
    (linked_subject_kind IS NULL AND linked_subject_id IS NULL) OR
    (linked_subject_kind IS NOT NULL AND linked_subject_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_reference
  ON finance.project (authority_id, reference) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_status ON finance.project (authority_id, status);
CREATE INDEX IF NOT EXISTS idx_project_link ON finance.project (linked_subject_kind, linked_subject_id);
CREATE INDEX IF NOT EXISTS idx_project_location ON finance.project USING gist (location);

CREATE TABLE IF NOT EXISTS finance.project_allocation (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id   integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  project_id     uuid NOT NULL REFERENCES finance.project (id),
  budget_line_id uuid NOT NULL REFERENCES finance.budget_line (id),
  amount         finance.money NOT NULL CHECK (amount >= 0),
  currency       finance.currency_code NOT NULL,
  allocation_type text NOT NULL DEFAULT 'original' CHECK (allocation_type IN ('original', 'revision')),
  budget_revision_id uuid REFERENCES finance.budget_revision (id),
  effective_date date,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES public.users (id),
  deleted_at     timestamptz,
  deleted_by     uuid REFERENCES public.users (id),
  CONSTRAINT project_allocation_revision_link CHECK (
    allocation_type <> 'revision' OR budget_revision_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_allocation_original
  ON finance.project_allocation (project_id, budget_line_id)
  WHERE allocation_type = 'original' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_allocation_line ON finance.project_allocation (budget_line_id);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 6. THE ACTUALS REGISTER
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- One register for revenue and expenditure. The direction is NOT stored: it is the `kind` of the
-- account the row is posted against. Storing it as well would create a second place for the truth
-- to live and a way for the two to disagree.
--
-- `source_ref` is the stable identifier from the originating accounting system and is mandatory.
-- The unique index on it is the duplicate protection the specification's first critical test
-- scenario asks for (§13.1).
CREATE TABLE IF NOT EXISTS finance.transaction (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  financial_year_id uuid NOT NULL REFERENCES finance.financial_year (id),
  account_id        uuid NOT NULL REFERENCES finance.account (id),
  department_id     uuid NOT NULL REFERENCES finance.department (id),
  programme_id      uuid REFERENCES finance.programme (id),
  activity_id       uuid REFERENCES finance.activity (id),
  ward_code         text,
  budget_line_id    uuid REFERENCES finance.budget_line (id),
  txn_date          date NOT NULL,
  amount            finance.money NOT NULL,
  currency          finance.currency_code NOT NULL,
  description       text,
  -- The council's own voucher / invoice / receipt number, as printed on the document.
  reference         text,
  -- Provenance from the source system, stored untouched and not interpreted.
  record_type       text,
  -- RESTRICTED. Never returned by the public API, and gated behind
  -- finance.transaction.view_counterparty for staff (specification §3.5, §10).
  counterparty_ref  text,
  counterparty_name text,
  source_system     text NOT NULL,
  source_ref        text NOT NULL,
  import_batch_id   uuid REFERENCES finance.import_batch (id),
  -- A correction is a reversal plus a replacement, both visible, never an edit in place (§6.5).
  reverses_id       uuid REFERENCES finance.transaction (id),
  posted_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES public.users (id),
  deleted_at        timestamptz,
  deleted_by        uuid REFERENCES public.users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_source
  ON finance.transaction (authority_id, source_system, source_ref) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transaction_year_date ON finance.transaction (financial_year_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_transaction_account ON finance.transaction (account_id);
CREATE INDEX IF NOT EXISTS idx_transaction_department ON finance.transaction (department_id);
CREATE INDEX IF NOT EXISTS idx_transaction_line ON finance.transaction (budget_line_id);
CREATE INDEX IF NOT EXISTS idx_transaction_batch ON finance.transaction (import_batch_id);

-- Specification §3.6 / §8: project_transactions with an association type. This is the ONLY link
-- between a transaction and a project, so a project's actual spend has one definition.
CREATE TABLE IF NOT EXISTS finance.project_transaction (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id   integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  project_id     uuid NOT NULL REFERENCES finance.project (id),
  transaction_id uuid NOT NULL REFERENCES finance.transaction (id),
  association    text NOT NULL DEFAULT 'direct' CHECK (association IN ('direct', 'apportioned')),
  -- The fraction of the transaction that belongs to this project. 1 for a direct association.
  share          numeric(6,5) NOT NULL DEFAULT 1 CHECK (share > 0 AND share <= 1),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES public.users (id),
  deleted_at     timestamptz,
  deleted_by     uuid REFERENCES public.users (id),
  CONSTRAINT project_transaction_direct_is_whole CHECK (association <> 'direct' OR share = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_transaction
  ON finance.project_transaction (project_id, transaction_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_transaction_txn ON finance.project_transaction (transaction_id);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 7. DOCUMENTS AND PUBLICATION
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS finance.document (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id  integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  subject_kind  text NOT NULL CHECK (subject_kind IN (
    'financial_year', 'budget_line', 'budget_revision', 'transaction',
    'project', 'import_batch', 'publication', 'report')),
  subject_id    text NOT NULL,
  object_key    text NOT NULL,
  filename      text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    bigint NOT NULL,
  checksum      text NOT NULL,
  document_type text,
  -- private: finance only. internal: any staff holder of finance.document.view.
  -- public: served by the public portal, and only once its subject is published.
  visibility    text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'internal', 'public')),
  uploaded_by   uuid NOT NULL REFERENCES public.users (id),
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  deleted_by    uuid REFERENCES public.users (id)
);
CREATE INDEX IF NOT EXISTS idx_finance_document_subject ON finance.document (subject_kind, subject_id);
CREATE INDEX IF NOT EXISTS idx_finance_document_visibility ON finance.document (authority_id, visibility);

-- Controlled release. A dataset becomes public by a publication row reaching 'published', and the
-- previous version stays on the table — "prior versions remain traceable" (UC-06).
CREATE TABLE IF NOT EXISTS finance.publication (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  financial_year_id uuid NOT NULL REFERENCES finance.financial_year (id),
  dataset           text NOT NULL CHECK (dataset IN (
    'budget', 'revenue', 'expenditure', 'projects', 'documents', 'reports')),
  version           integer NOT NULL,
  -- The filter the published view applies, if the release is partial.
  scope             jsonb,
  import_batch_id   uuid REFERENCES finance.import_batch (id),
  state             text NOT NULL DEFAULT 'pending'
                    CHECK (state IN ('pending', 'approved', 'rejected', 'published', 'withdrawn')),
  reviewed_by       uuid REFERENCES public.users (id),
  reviewed_at       timestamptz,
  approved_by       uuid REFERENCES public.users (id),
  approved_at       timestamptz,
  published_by      uuid REFERENCES public.users (id),
  published_at      timestamptz,
  withdrawn_by      uuid REFERENCES public.users (id),
  withdrawn_at      timestamptz,
  withdraw_reason   text,
  decision_note     text,
  reporting_period_label text,
  data_as_at        date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES public.users (id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Both actors are recorded on a published version. Whether they must be DIFFERENT people is the
  -- council's call (decision D6) and is enforced by the route against
  -- finance.setting 'separation_of_duties.publication', not hard-wired here: a council with one
  -- finance officer must be able to switch it off knowingly rather than be unable to publish.
  CONSTRAINT publication_published_has_both_actors CHECK (
    state <> 'published' OR (approved_by IS NOT NULL AND published_by IS NOT NULL AND published_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_publication_version
  ON finance.publication (authority_id, financial_year_id, dataset, version);
-- At most one live published version per dataset and year. A new release withdraws the old one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_publication_live
  ON finance.publication (authority_id, financial_year_id, dataset)
  WHERE state = 'published';
CREATE INDEX IF NOT EXISTS idx_publication_state ON finance.publication (authority_id, state);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 8. A CLOSED YEAR ACCEPTS NOTHING
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Specification §13.1: "Verify that a closed financial year cannot be silently overwritten." A
-- route-level check would be one forgotten `if` away from failing, so the refusal lives in the
-- database and applies to every path into these tables, including psql.
-- NOTE ON THE BRANCHING. This was first written as a single CASE over TG_TABLE_NAME. PL/pgSQL
-- hands the whole CASE to the SQL parser as one expression, so `NEW.budget_line_id` was resolved
-- for every table the trigger is attached to — and a budget_line, which has no such field, failed
-- with `record "new" has no field "budget_line_id"` on every insert. Separate IF branches are the
-- fix: only the branch that runs is parsed against NEW.
CREATE OR REPLACE FUNCTION finance.assert_year_open() RETURNS trigger AS $$
DECLARE
  y_id uuid;
  y_status text;
  y_label text;
BEGIN
  IF TG_TABLE_NAME IN ('budget_revision', 'commitment') THEN
    SELECT financial_year_id INTO y_id FROM finance.budget_line WHERE id = NEW.budget_line_id;
  ELSE
    y_id := NEW.financial_year_id;
  END IF;
  IF y_id IS NULL THEN RETURN NEW; END IF;
  SELECT status, label INTO y_status, y_label FROM finance.financial_year WHERE id = y_id;
  IF y_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'financial year % is %; it accepts no further financial records', y_label, y_status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget_line', 'budget_revision', 'transaction', 'commitment', 'import_batch'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_year_open ON finance.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_year_open BEFORE INSERT OR UPDATE ON finance.%I
         FOR EACH ROW EXECUTE FUNCTION finance.assert_year_open()', t, t);
  END LOOP;
END $$;

-- Closing a year is itself a decision: a year cannot go from closed back to open without the
-- status passing through a recorded reopening, and the audit event the route writes.
CREATE OR REPLACE FUNCTION finance.touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['financial_year', 'department', 'programme', 'activity', 'account',
                           'budget_line', 'budget_revision', 'commitment', 'project',
                           'column_mapping', 'publication'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_touch ON finance.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON finance.%I
         FOR EACH ROW EXECUTE FUNCTION finance.touch_updated_at()', t, t);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 9. THE CALCULATIONS, IN ONE PLACE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Specification §6.1 defines seven measures. They are defined here, once, so the admin screens,
-- the public portal, the exports and the reports cannot drift apart on what "available" means.
--
-- CURRENCY. A budget line is denominated in one currency. An actual posted against it in a
-- DIFFERENT currency is a data fault, not something to be converted: it is excluded from the
-- totals and counted in `actual_currency_mismatch_rows` so it shows up as a fault instead of
-- vanishing. Nothing in this view adds two currencies together.
--
-- REVERSALS. A correction is a reversal row carrying the signed opposite of the row it reverses
-- (`reverses_id`), so a plain SUM is already net of corrections.
DROP VIEW IF EXISTS finance.v_budget_line_performance CASCADE;
CREATE VIEW finance.v_budget_line_performance WITH (security_invoker = true) AS
WITH adjustments AS (
  SELECT r.budget_line_id,
         sum(r.amount_delta) FILTER (WHERE r.currency = l.currency) AS approved_adjustments,
         count(*) FILTER (WHERE r.currency <> l.currency)::int      AS revision_currency_mismatch_rows
    FROM finance.budget_revision r
    JOIN finance.budget_line l ON l.id = r.budget_line_id
   WHERE r.state = 'approved' AND r.deleted_at IS NULL
   GROUP BY r.budget_line_id
), actuals AS (
  SELECT t.budget_line_id,
         sum(t.amount) FILTER (WHERE t.currency = l.currency) AS actual_amount,
         count(*)      FILTER (WHERE t.currency <> l.currency)::int AS actual_currency_mismatch_rows,
         count(*)::int                                            AS transaction_rows,
         max(t.txn_date)                                      AS last_transaction_date
    FROM finance.transaction t
    JOIN finance.budget_line l ON l.id = t.budget_line_id
   WHERE t.deleted_at IS NULL
   GROUP BY t.budget_line_id
), commitments AS (
  SELECT c.budget_line_id,
         sum(c.amount - c.liquidated_amount) FILTER (WHERE c.currency = l.currency) AS open_commitments,
         count(*) FILTER (WHERE c.currency <> l.currency)::int AS commitment_currency_mismatch_rows
    FROM finance.commitment c
    JOIN finance.budget_line l ON l.id = c.budget_line_id
   WHERE c.status IN ('open', 'partially_liquidated') AND c.deleted_at IS NULL
   GROUP BY c.budget_line_id
)
SELECT l.id                AS budget_line_id,
       l.authority_id,
       l.financial_year_id,
       l.department_id,
       l.programme_id,
       l.activity_id,
       l.account_id,
       l.ward_code,
       l.code,
       l.description,
       l.status,
       l.currency,
       a.kind              AS account_kind,
       l.original_amount,
       COALESCE(adj.approved_adjustments, 0)::finance.money AS approved_adjustments,
       (l.original_amount + COALESCE(adj.approved_adjustments, 0))::finance.money AS revised_amount,
       COALESCE(act.actual_amount, 0)::finance.money        AS actual_amount,
       COALESCE(com.open_commitments, 0)::finance.money     AS open_commitments,
       (l.original_amount + COALESCE(adj.approved_adjustments, 0)
          - COALESCE(act.actual_amount, 0))::finance.money  AS available_excluding_commitments,
       (l.original_amount + COALESCE(adj.approved_adjustments, 0)
          - COALESCE(act.actual_amount, 0)
          - COALESCE(com.open_commitments, 0))::finance.money AS available_including_commitments,
       -- Undefined, not zero and not infinity, where the revised budget is zero (§6.1).
       CASE WHEN (l.original_amount + COALESCE(adj.approved_adjustments, 0)) = 0 THEN NULL
            ELSE round(COALESCE(act.actual_amount, 0) * 100
                       / (l.original_amount + COALESCE(adj.approved_adjustments, 0)), 2)
       END AS execution_percentage,
       -- §6.2 revenue variance = actual − revised. §6.3 expenditure variance = revised − actual.
       CASE WHEN a.kind = 'revenue'
            THEN (COALESCE(act.actual_amount, 0) - (l.original_amount + COALESCE(adj.approved_adjustments, 0)))
            ELSE ((l.original_amount + COALESCE(adj.approved_adjustments, 0)) - COALESCE(act.actual_amount, 0))
       END::finance.money AS variance,
       COALESCE(act.transaction_rows, 0)::int AS transaction_rows,
       act.last_transaction_date,
       COALESCE(act.actual_currency_mismatch_rows, 0)::int     AS actual_currency_mismatch_rows,
       COALESCE(adj.revision_currency_mismatch_rows, 0)::int   AS revision_currency_mismatch_rows,
       COALESCE(com.commitment_currency_mismatch_rows, 0)::int AS commitment_currency_mismatch_rows
  FROM finance.budget_line l
  JOIN finance.account a      ON a.id = l.account_id
  LEFT JOIN adjustments adj   ON adj.budget_line_id = l.id
  LEFT JOIN actuals act       ON act.budget_line_id = l.id
  LEFT JOIN commitments com   ON com.budget_line_id = l.id
 WHERE l.deleted_at IS NULL;

COMMENT ON VIEW finance.v_budget_line_performance IS
  'Specification §6.1 measures per budget line. Both available-balance definitions are returned so '
  'a screen must state which one it is showing. Amounts are per the line''s own currency; rows in '
  'another currency are excluded and counted, never converted.';

-- Department roll-up. GROUPED BY CURRENCY, always: a department that budgets in both USD and ZWG
-- gets two rows, which is the only honest answer until the Council sets a conversion basis (D4).
DROP VIEW IF EXISTS finance.v_department_performance CASCADE;
CREATE VIEW finance.v_department_performance WITH (security_invoker = true) AS
SELECT p.authority_id,
       p.financial_year_id,
       p.department_id,
       p.account_kind,
       p.currency,
       count(*)::int                        AS line_count,
       sum(p.original_amount)::finance.money AS original_amount,
       sum(p.approved_adjustments)::finance.money AS approved_adjustments,
       sum(p.revised_amount)::finance.money  AS revised_amount,
       sum(p.actual_amount)::finance.money   AS actual_amount,
       sum(p.open_commitments)::finance.money AS open_commitments,
       sum(p.available_excluding_commitments)::finance.money AS available_excluding_commitments,
       sum(p.available_including_commitments)::finance.money AS available_including_commitments,
       CASE WHEN sum(p.revised_amount) = 0 THEN NULL
            ELSE round(sum(p.actual_amount) * 100 / sum(p.revised_amount), 2) END AS execution_percentage,
       sum(p.actual_currency_mismatch_rows)::int AS actual_currency_mismatch_rows
  FROM finance.v_budget_line_performance p
 GROUP BY p.authority_id, p.financial_year_id, p.department_id, p.account_kind, p.currency;

-- A project's approved allocation against what was actually spent on it. The spend comes through
-- finance.project_transaction, the single definition of "a transaction belongs to this project",
-- and respects the apportionment share.
DROP VIEW IF EXISTS finance.v_project_performance CASCADE;
CREATE VIEW finance.v_project_performance WITH (security_invoker = true) AS
WITH alloc AS (
  SELECT a.project_id, a.currency,
         sum(a.amount) FILTER (WHERE a.allocation_type = 'original') AS allocated_original,
         sum(a.amount) FILTER (WHERE a.allocation_type = 'revision') AS allocated_revisions
    FROM finance.project_allocation a
   WHERE a.deleted_at IS NULL
   GROUP BY a.project_id, a.currency
), spend AS (
  SELECT pt.project_id, t.currency,
         sum(t.amount * pt.share)::finance.money AS actual_spend,
         count(*)::int AS transaction_rows,
         max(t.txn_date) AS last_transaction_date
    FROM finance.project_transaction pt
    JOIN finance.transaction t ON t.id = pt.transaction_id AND t.deleted_at IS NULL
   WHERE pt.deleted_at IS NULL
   GROUP BY pt.project_id, t.currency
)
SELECT pr.id AS project_id,
       pr.authority_id,
       pr.reference,
       pr.name,
       pr.department_id,
       pr.ward_code,
       pr.status,
       pr.linked_subject_kind,
       pr.linked_subject_id,
       COALESCE(al.currency, sp.currency, pr.currency) AS currency,
       pr.approved_budget,
       COALESCE(al.allocated_original, 0)::finance.money  AS allocated_original,
       COALESCE(al.allocated_revisions, 0)::finance.money AS allocated_revisions,
       (COALESCE(al.allocated_original, 0) + COALESCE(al.allocated_revisions, 0))::finance.money AS allocated_total,
       COALESCE(sp.actual_spend, 0)::finance.money AS actual_spend,
       (COALESCE(al.allocated_original, 0) + COALESCE(al.allocated_revisions, 0)
          - COALESCE(sp.actual_spend, 0))::finance.money AS remaining_allocation,
       CASE WHEN COALESCE(al.allocated_original, 0) + COALESCE(al.allocated_revisions, 0) = 0 THEN NULL
            ELSE round(COALESCE(sp.actual_spend, 0) * 100
                 / (COALESCE(al.allocated_original, 0) + COALESCE(al.allocated_revisions, 0)), 2)
       END AS execution_percentage,
       COALESCE(sp.transaction_rows, 0)::int AS transaction_rows,
       sp.last_transaction_date
  FROM finance.project pr
  LEFT JOIN alloc al ON al.project_id = pr.id
  LEFT JOIN spend sp ON sp.project_id = pr.id AND (al.currency IS NULL OR sp.currency = al.currency)
 WHERE pr.deleted_at IS NULL;

-- What the public is allowed to see, expressed as a view rather than as a route's good intentions.
-- A row appears only while a live publication row covers its year and dataset, and the counterparty
-- columns are not selected at all — they cannot leak through a forgotten field list.
DROP VIEW IF EXISTS finance.v_published_transaction CASCADE;
CREATE VIEW finance.v_published_transaction WITH (security_invoker = true) AS
SELECT t.id,
       t.authority_id,
       t.financial_year_id,
       t.txn_date,
       t.amount,
       t.currency,
       t.description,
       t.reference,
       a.code AS account_code,
       a.name AS account_name,
       a.kind AS account_kind,
       d.code AS department_code,
       d.name AS department_name,
       t.budget_line_id,
       pub.published_at,
       pub.data_as_at,
       pub.reporting_period_label
  FROM finance.transaction t
  JOIN finance.account a ON a.id = t.account_id
  JOIN finance.department d ON d.id = t.department_id
  JOIN finance.publication pub
    ON pub.authority_id = t.authority_id
   AND pub.financial_year_id = t.financial_year_id
   AND pub.state = 'published'
   AND pub.dataset = CASE a.kind WHEN 'revenue' THEN 'revenue' ELSE 'expenditure' END
 WHERE t.deleted_at IS NULL;

COMMENT ON VIEW finance.v_published_transaction IS
  'The public transaction surface. Counterparty identity is absent by construction, not by filter.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 10. FINANCE ROLES
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The specification's role model (§2.2). None of these existed: the 19 roles in users_role_check
-- are all planning, GIS or citizen roles.
DO $$
DECLARE n text;
BEGIN
  FOR n IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.users'::regclass AND conname LIKE '%role_check%'
  LOOP EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', n); END LOOP;
END $$;

ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN (
  -- existing (migration 132)
  'public', 'registered', 'viewer', 'admin', 'planner', 'eo', 'env_officer',
  'building_inspector', 'planning_clerk', 'surveyor', 'gis_officer',
  'gis_head', 'gis_data', 'gis_dev', 'gis_analyst', 'gis_tech', 'gis_clerk',
  'dept_editor', 'dept_viewer',
  -- finance (migration 188). `admin` is NOT a finance role and holds no permission that moves
  -- money; see the grants below.
  'finance_admin', 'finance_officer', 'budget_officer', 'dept_head',
  'finance_committee', 'publisher', 'auditor'
));

-- A staff member with no authority cannot write a single finance row: every finance table defaults
-- `authority_id` to `app.authority_id()` and refuses NULL, which is the protection working as
-- designed. Migration 154 gives a new staff account its authority through this trigger, and its
-- list of roles predates the finance ones — so a finance officer created today would be unable to
-- enter a budget line and the reason would be most unobvious. Replaced here, additively: every
-- role 154 named is still in the list.
CREATE OR REPLACE FUNCTION public.users_default_authority() RETURNS trigger AS $fn$
BEGIN
  IF NEW.authority_id IS NULL AND NEW.role IN (
    -- migration 154
    'admin', 'planner', 'planning_clerk', 'building_inspector', 'eo', 'env_officer',
    'surveyor', 'gis_officer',
    -- migration 188: the finance roles. 'auditor' is included: a read-only auditor still needs an
    -- authority, or row-level security shows them nothing at all.
    'finance_admin', 'finance_officer', 'budget_officer', 'dept_head',
    'finance_committee', 'publisher', 'auditor'
  ) THEN
    SELECT id INTO NEW.authority_id FROM public.local_authorities WHERE code = 'VUNGU';
  END IF;
  RETURN NEW;
END $fn$ LANGUAGE plpgsql;

-- Existing accounts that were created before the list above included their role.
UPDATE public.users u
   SET authority_id = (SELECT id FROM public.local_authorities WHERE code = 'VUNGU')
 WHERE u.authority_id IS NULL
   AND u.role IN ('finance_admin', 'finance_officer', 'budget_officer', 'dept_head',
                  'finance_committee', 'publisher', 'auditor')
   AND EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU');

DO $$
BEGIN
  IF to_regclass('public.invites') IS NOT NULL THEN
    ALTER TABLE public.invites DROP CONSTRAINT IF EXISTS invites_role_check;
    ALTER TABLE public.invites ADD CONSTRAINT invites_role_check CHECK (role IN (
      'admin', 'planner', 'viewer', 'eo', 'env_officer', 'building_inspector',
      'planning_clerk', 'surveyor', 'gis_officer', 'gis_head', 'gis_data', 'gis_dev',
      'gis_analyst', 'gis_tech', 'gis_clerk', 'dept_editor', 'dept_viewer',
      'finance_admin', 'finance_officer', 'budget_officer', 'dept_head',
      'finance_committee', 'publisher', 'auditor'
    ));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 11. THE PERMISSION CATALOGUE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO finance.permission (code, label, category, is_approval, is_publication, is_restricted, description) VALUES
  ('finance.config.manage',            'Manage finance configuration', 'configuration', false, false, false, 'Financial years, departments, programmes, activities, chart of accounts, column mappings and finance settings.'),
  ('finance.year.close',               'Close a financial year',       'configuration', false, false, false, 'Close or reopen a reporting period. A closed year accepts no further financial records.'),
  ('finance.budget.view',              'View budgets',                 'budget',        false, false, false, null),
  ('finance.budget.prepare',           'Prepare budget lines',         'budget',        false, false, false, 'Create and edit draft budget lines.'),
  ('finance.budget.submit',            'Submit budget for review',     'budget',        false, false, false, null),
  ('finance.budget.approve',           'Approve budget',               'budget',        true,  false, false, 'Authorise the official approved allocation.'),
  ('finance.revision.prepare',         'Prepare budget revisions',     'budget',        false, false, false, null),
  ('finance.revision.submit',          'Submit budget revisions',      'budget',        false, false, false, null),
  ('finance.revision.approve',         'Approve budget revisions',     'budget',        true,  false, false, 'Authorise a supplementary allocation or reduction. Never the requester.'),
  ('finance.actuals.view',             'View actuals and performance', 'actuals',       false, false, false, null),
  ('finance.transaction.view',         'View the transaction register','actuals',       false, false, false, null),
  ('finance.transaction.view_counterparty', 'View counterparty identity', 'actuals',    false, false, true,  'Supplier and beneficiary names and references. Restricted; never public.'),
  ('finance.import.upload',            'Upload source files',          'import',        false, false, false, null),
  ('finance.import.validate',          'Run import validation',        'import',        false, false, false, null),
  ('finance.import.commit',            'Commit an import batch',       'import',        false, false, false, 'Write a validated batch into the register. Separate from upload by design (§3.8).'),
  ('finance.import.exception.resolve', 'Resolve import exceptions',    'import',        false, false, false, null),
  ('finance.project.view',             'View projects',                'projects',      false, false, false, null),
  ('finance.project.manage',           'Create and maintain projects', 'projects',      false, false, false, null),
  ('finance.project.approve',          'Approve projects',             'projects',      true,  false, false, null),
  ('finance.document.view',            'View finance documents',       'documents',     false, false, false, null),
  ('finance.document.upload',          'Upload finance documents',     'documents',     false, false, false, null),
  ('finance.document.view_restricted', 'View restricted documents',    'documents',     false, false, true,  'Documents classified private, including supplier and personal material.'),
  ('finance.report.view',              'View reports',                 'reporting',     false, false, false, null),
  ('finance.report.export',            'Export reports',               'reporting',     false, false, false, null),
  ('finance.report.export_restricted', 'Export restricted data',       'reporting',     false, false, true,  'Exports containing counterparty or personal data require this explicitly (§2.3).'),
  ('finance.variance.explain',         'Record variance explanations', 'budget',        false, false, false, null),
  ('finance.publication.review',       'Review the publication queue', 'publication',   false, false, false, null),
  ('finance.publication.approve',      'Approve a dataset for release','publication',   true,  false, false, null),
  ('finance.publication.publish',      'Publish a dataset',            'publication',   false, true,  false, 'Make an approved dataset visible on the public portal.'),
  ('finance.publication.withdraw',     'Withdraw a published dataset', 'publication',   false, true,  false, null),
  ('finance.audit.view',               'Search audit history',         'audit',         false, false, false, null),
  ('finance.audit.export',             'Export audit history',         'audit',         false, false, false, null),
  ('finance.users.manage_finance_roles','Assign finance roles and scopes','administration', false, false, false, 'User provisioning. Confers no authority over financial content.')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category,
      is_approval = EXCLUDED.is_approval, is_publication = EXCLUDED.is_publication,
      is_restricted = EXCLUDED.is_restricted, description = EXCLUDED.description;

-- ── Default grants ────────────────────────────────────────────────────────────────────────────
-- Read this table as the answer to "who can do what, and who deliberately cannot".
--
--   finance_admin     prepares everything, approves nothing, publishes nothing.
--   finance_officer   prepares and validates; cannot commit a batch (§3.8 wants a second pair of
--                     eyes between validation and the register).
--   budget_officer    prepares budget and revisions; no imports, no approvals.
--   dept_head         own department only (finance.user_scope); prepares and explains.
--   finance_committee reviews and approves; prepares nothing, imports nothing, publishes nothing.
--   publisher         publishes what was approved; approves nothing.
--   auditor           reads everything authorised, including the audit trail; writes nothing.
--   admin             the TECHNICAL administrator: user provisioning and the audit trail. No
--                     approval, no publication, no import commit, no counterparty access.
--   planner / eo      enough to trace their own project's money (§ integration requirement).
INSERT INTO finance.role_permission (role_name, permission_code) VALUES
  -- finance_admin
  ('finance_admin', 'finance.config.manage'),
  ('finance_admin', 'finance.year.close'),
  ('finance_admin', 'finance.budget.view'),
  ('finance_admin', 'finance.budget.prepare'),
  ('finance_admin', 'finance.budget.submit'),
  ('finance_admin', 'finance.revision.prepare'),
  ('finance_admin', 'finance.revision.submit'),
  ('finance_admin', 'finance.actuals.view'),
  ('finance_admin', 'finance.transaction.view'),
  ('finance_admin', 'finance.transaction.view_counterparty'),
  ('finance_admin', 'finance.import.upload'),
  ('finance_admin', 'finance.import.validate'),
  ('finance_admin', 'finance.import.commit'),
  ('finance_admin', 'finance.import.exception.resolve'),
  ('finance_admin', 'finance.project.view'),
  ('finance_admin', 'finance.project.manage'),
  ('finance_admin', 'finance.document.view'),
  ('finance_admin', 'finance.document.upload'),
  ('finance_admin', 'finance.document.view_restricted'),
  ('finance_admin', 'finance.report.view'),
  ('finance_admin', 'finance.report.export'),
  ('finance_admin', 'finance.report.export_restricted'),
  ('finance_admin', 'finance.variance.explain'),
  ('finance_admin', 'finance.publication.review'),
  ('finance_admin', 'finance.audit.view'),
  -- finance_officer
  ('finance_officer', 'finance.budget.view'),
  ('finance_officer', 'finance.budget.prepare'),
  ('finance_officer', 'finance.budget.submit'),
  ('finance_officer', 'finance.revision.prepare'),
  ('finance_officer', 'finance.revision.submit'),
  ('finance_officer', 'finance.actuals.view'),
  ('finance_officer', 'finance.transaction.view'),
  ('finance_officer', 'finance.transaction.view_counterparty'),
  ('finance_officer', 'finance.import.upload'),
  ('finance_officer', 'finance.import.validate'),
  ('finance_officer', 'finance.import.exception.resolve'),
  ('finance_officer', 'finance.project.view'),
  ('finance_officer', 'finance.project.manage'),
  ('finance_officer', 'finance.document.view'),
  ('finance_officer', 'finance.document.upload'),
  ('finance_officer', 'finance.report.view'),
  ('finance_officer', 'finance.report.export'),
  ('finance_officer', 'finance.variance.explain'),
  -- budget_officer
  ('budget_officer', 'finance.budget.view'),
  ('budget_officer', 'finance.budget.prepare'),
  ('budget_officer', 'finance.budget.submit'),
  ('budget_officer', 'finance.revision.prepare'),
  ('budget_officer', 'finance.revision.submit'),
  ('budget_officer', 'finance.actuals.view'),
  ('budget_officer', 'finance.project.view'),
  ('budget_officer', 'finance.document.view'),
  ('budget_officer', 'finance.document.upload'),
  ('budget_officer', 'finance.report.view'),
  ('budget_officer', 'finance.report.export'),
  ('budget_officer', 'finance.variance.explain'),
  -- dept_head (scoped to their own departments)
  ('dept_head', 'finance.budget.view'),
  ('dept_head', 'finance.budget.prepare'),
  ('dept_head', 'finance.budget.submit'),
  ('dept_head', 'finance.revision.prepare'),
  ('dept_head', 'finance.revision.submit'),
  ('dept_head', 'finance.actuals.view'),
  ('dept_head', 'finance.project.view'),
  ('dept_head', 'finance.project.manage'),
  ('dept_head', 'finance.document.view'),
  ('dept_head', 'finance.document.upload'),
  ('dept_head', 'finance.report.view'),
  ('dept_head', 'finance.variance.explain'),
  -- finance_committee / treasurer
  ('finance_committee', 'finance.budget.view'),
  ('finance_committee', 'finance.budget.approve'),
  ('finance_committee', 'finance.revision.approve'),
  ('finance_committee', 'finance.project.view'),
  ('finance_committee', 'finance.project.approve'),
  ('finance_committee', 'finance.actuals.view'),
  ('finance_committee', 'finance.transaction.view'),
  ('finance_committee', 'finance.publication.review'),
  ('finance_committee', 'finance.publication.approve'),
  ('finance_committee', 'finance.document.view'),
  ('finance_committee', 'finance.report.view'),
  ('finance_committee', 'finance.report.export'),
  ('finance_committee', 'finance.audit.view'),
  -- publisher
  ('publisher', 'finance.budget.view'),
  ('publisher', 'finance.actuals.view'),
  ('publisher', 'finance.project.view'),
  ('publisher', 'finance.publication.review'),
  ('publisher', 'finance.publication.publish'),
  ('publisher', 'finance.publication.withdraw'),
  ('publisher', 'finance.document.view'),
  ('publisher', 'finance.report.view'),
  -- auditor: read-only, including the audit trail
  ('auditor', 'finance.budget.view'),
  ('auditor', 'finance.actuals.view'),
  ('auditor', 'finance.transaction.view'),
  ('auditor', 'finance.transaction.view_counterparty'),
  ('auditor', 'finance.project.view'),
  ('auditor', 'finance.document.view'),
  ('auditor', 'finance.document.view_restricted'),
  ('auditor', 'finance.report.view'),
  ('auditor', 'finance.report.export'),
  ('auditor', 'finance.report.export_restricted'),
  ('auditor', 'finance.audit.view'),
  ('auditor', 'finance.audit.export'),
  -- admin: the technical administrator. Nothing here approves, publishes, commits or discloses.
  ('admin', 'finance.budget.view'),
  ('admin', 'finance.actuals.view'),
  ('admin', 'finance.project.view'),
  ('admin', 'finance.report.view'),
  ('admin', 'finance.audit.view'),
  ('admin', 'finance.audit.export'),
  ('admin', 'finance.users.manage_finance_roles'),
  -- planning and environmental staff: enough to follow their own project's money end to end
  ('planner', 'finance.budget.view'),
  ('planner', 'finance.actuals.view'),
  ('planner', 'finance.project.view'),
  ('planner', 'finance.report.view'),
  ('eo', 'finance.project.view'),
  ('eo', 'finance.budget.view'),
  ('env_officer', 'finance.project.view'),
  ('env_officer', 'finance.budget.view')
ON CONFLICT (role_name, permission_code) DO NOTHING;

-- The separation-of-duties invariant, asserted rather than trusted: if a later edit to the grants
-- above ever gives one role both an approval and the publication permission, this migration fails
-- instead of quietly weakening the control.
DO $$
DECLARE offender text;
BEGIN
  SELECT rp.role_name INTO offender
    FROM finance.role_permission rp JOIN finance.permission p ON p.code = rp.permission_code
   GROUP BY rp.role_name
  HAVING bool_or(p.is_approval) AND bool_or(p.is_publication)
   LIMIT 1;
  IF offender IS NOT NULL THEN
    RAISE EXCEPTION 'role % would hold both an approval and a publication permission; separation of duties (§2.3) forbids it', offender;
  END IF;
  IF EXISTS (
    SELECT 1 FROM finance.role_permission rp JOIN finance.permission p ON p.code = rp.permission_code
     WHERE rp.role_name = 'admin' AND (p.is_approval OR p.is_publication OR p.is_restricted)
  ) THEN
    RAISE EXCEPTION 'the technical administrator must not hold approval, publication or restricted-data permissions by default';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 12. DEFAULTS THAT ARE SAFE TO ASSUME, AND NOTHING ELSE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- No financial year, no department, no account and no amount is seeded. Those are the Council's
-- (decisions D1–D3) and a plausible-looking placeholder in a finance system is worse than an empty
-- one. What is seeded is behaviour: how the application should conduct itself until told otherwise.
DO $$
DECLARE a integer;
BEGIN
  SELECT id INTO a FROM public.local_authorities WHERE code = 'VUNGU';
  IF a IS NULL THEN
    RAISE NOTICE 'no VUNGU authority here: finance settings and mappings stay unseeded';
    RETURN;
  END IF;

  INSERT INTO finance.setting (authority_id, key, value) VALUES
    -- Specification §6.3 asks the application to state whether commitments are included in the
    -- available balance. It shows the excluding figure by default and labels it; both are in the view.
    (a, 'available_balance.include_commitments', 'false'::jsonb),
    -- Whether the approver and the publisher must be different people. True until the Council says
    -- otherwise (decision D6); a one-officer council can turn it off knowingly.
    (a, 'separation_of_duties.publication', 'true'::jsonb),
    -- Specification §3.5: configurable thresholds for flagging lines. These are display warnings,
    -- not controls, and block nothing.
    (a, 'overspend.warn_execution_percentage', '90'::jsonb),
    (a, 'overspend.flag_execution_percentage', '100'::jsonb),
    -- Reporting currency shown when no year is selected. Per-year currency lives on the year.
    (a, 'reporting.default_currency', '"USD"'::jsonb),
    -- Import ceiling. A council export of a full year is tens of thousands of rows, not millions.
    (a, 'import.max_rows', '200000'::jsonb),
    (a, 'import.max_file_bytes', '52428800'::jsonb)
  ON CONFLICT (authority_id, key) DO NOTHING;

  -- Column aliases observed in PROMUN and Pastel/Sage style council exports, and in hand-kept
  -- spreadsheets. This is a starting point a finance administrator edits, not a format contract:
  -- a council uploads what its system produces (decision D7).
  INSERT INTO finance.column_mapping (authority_id, name, dataset, source_system, mapping, is_default) VALUES
    (a, 'Default — budget', 'budget', NULL, jsonb_build_object(
      'department_code', jsonb_build_array('vote', 'votecode', 'vote_code', 'department', 'departmentcode', 'department_code', 'service'),
      'account_code',    jsonb_build_array('economicline', 'economic_line', 'economiccode', 'accountcode', 'account', 'account_code', 'lineitem', 'glcode', 'gl_code'),
      'programme_code',  jsonb_build_array('programme', 'program', 'programmecode', 'programme_code'),
      'activity_code',   jsonb_build_array('activity', 'activitycode', 'activity_code'),
      'ward_code',       jsonb_build_array('unit', 'costcentre', 'costcenter', 'cost_centre', 'ward', 'wardnumber', 'ward_number'),
      'project_ref',     jsonb_build_array('eventid', 'event', 'project', 'projectcode', 'project_code', 'projectid'),
      'line_code',       jsonb_build_array('linecode', 'line_code', 'budgetline', 'budget_line', 'code'),
      'description',     jsonb_build_array('description', 'narration', 'details', 'remarks', 'note', 'particulars'),
      'amount',          jsonb_build_array('amount', 'value', 'total', 'budget', 'budgetamount', 'budget_amount'),
      'currency',        jsonb_build_array('currency', 'currencycode', 'currency_code', 'ccy')
    ), true),
    (a, 'Default — actuals', 'actuals', NULL, jsonb_build_object(
      'department_code', jsonb_build_array('vote', 'votecode', 'vote_code', 'department', 'departmentcode', 'department_code', 'service'),
      'account_code',    jsonb_build_array('economicline', 'economic_line', 'economiccode', 'accountcode', 'account', 'account_code', 'lineitem', 'glcode', 'gl_code'),
      'programme_code',  jsonb_build_array('programme', 'program', 'programmecode', 'programme_code'),
      'activity_code',   jsonb_build_array('activity', 'activitycode', 'activity_code'),
      'ward_code',       jsonb_build_array('unit', 'costcentre', 'costcenter', 'cost_centre', 'ward', 'wardnumber', 'ward_number'),
      'project_ref',     jsonb_build_array('eventid', 'event', 'project', 'projectcode', 'project_code', 'projectid'),
      'line_code',       jsonb_build_array('linecode', 'line_code', 'budgetline', 'budget_line'),
      'txn_date',        jsonb_build_array('date', 'transactiondate', 'transaction_date', 'documentdate', 'document_date', 'invoicedate', 'postingdate'),
      'amount',          jsonb_build_array('amount', 'value', 'total'),
      'currency',        jsonb_build_array('currency', 'currencycode', 'currency_code', 'ccy'),
      'description',     jsonb_build_array('description', 'narration', 'details', 'remarks', 'note', 'particulars'),
      'reference',       jsonb_build_array('reference', 'ref', 'voucher', 'voucherno', 'voucher_no', 'documentno', 'document_no', 'invoiceno', 'invoice_no', 'receiptno', 'receipt_no'),
      'record_type',     jsonb_build_array('type', 'recordtype', 'record_type', 'documenttype', 'document_type', 'transactiontype', 'transaction_type'),
      'source_ref',      jsonb_build_array('sourceref', 'source_ref', 'srcid', 'src_id', 'sourceid', 'source_id', 'transactionid', 'transaction_id', 'id'),
      'counterparty_ref',  jsonb_build_array('counterpartyid', 'counterparty_id', 'supplierid', 'supplier_id', 'bpnumber', 'bp_number', 'supplierbpnumber', 'vendorid', 'vendor_id'),
      'counterparty_name', jsonb_build_array('counterpartyname', 'counterparty_name', 'suppliername', 'supplier_name', 'supplier', 'vendorname', 'vendor_name', 'payee')
    ), true),
    (a, 'Default — commitments', 'commitments', NULL, jsonb_build_object(
      'department_code', jsonb_build_array('vote', 'votecode', 'vote_code', 'department', 'department_code'),
      'account_code',    jsonb_build_array('economicline', 'economic_line', 'accountcode', 'account', 'account_code', 'glcode'),
      'line_code',       jsonb_build_array('linecode', 'line_code', 'budgetline', 'budget_line'),
      'reference',       jsonb_build_array('reference', 'ref', 'ordernumber', 'order_number', 'purchaseorder', 'purchase_order', 'ponumber', 'po_number'),
      'amount',          jsonb_build_array('amount', 'value', 'total', 'committed', 'committedamount', 'committed_amount'),
      'currency',        jsonb_build_array('currency', 'currencycode', 'currency_code', 'ccy'),
      'committed_on',    jsonb_build_array('date', 'committedon', 'committed_on', 'orderdate', 'order_date'),
      'source_ref',      jsonb_build_array('sourceref', 'source_ref', 'srcid', 'src_id', 'id'),
      'description',     jsonb_build_array('description', 'narration', 'details', 'remarks')
    ), true),
    (a, 'Default — projects', 'projects', NULL, jsonb_build_object(
      'reference',       jsonb_build_array('reference', 'ref', 'projectcode', 'project_code', 'id', 'eventid', 'event'),
      'name',            jsonb_build_array('name', 'projectname', 'project_name', 'eventname', 'title'),
      'description',     jsonb_build_array('description', 'details', 'scope', 'remarks'),
      'department_code', jsonb_build_array('vote', 'department', 'departmentcode', 'department_code'),
      'ward_code',       jsonb_build_array('ward', 'wardnumber', 'ward_number', 'unit'),
      'location_text',   jsonb_build_array('location', 'site', 'place', 'locality'),
      'start_date',      jsonb_build_array('startdate', 'start_date', 'commencement'),
      'end_date',        jsonb_build_array('enddate', 'end_date', 'completion'),
      'status',          jsonb_build_array('status', 'projectstatus', 'project_status'),
      'amount',          jsonb_build_array('amount', 'budget', 'approvedbudget', 'approved_budget', 'value'),
      'currency',        jsonb_build_array('currency', 'currencycode', 'currency_code', 'ccy')
    ), true)
  ON CONFLICT DO NOTHING;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 13. TENANCY
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Every finance table holding a council's data gets row-level security through the standard
-- helper (migration 167): read your own and your combination's authorities, write only your own,
-- platform operators see all. The permission catalogue and the per-user grants are SYSTEM data:
-- they decide who may do what, so the application role must not be able to edit them through the
-- person's own connection. Routes read them with systemOf(fastify.pg).
DO $$
DECLARE r text;
BEGIN
  -- The catalogue and the grants: system plane, no application-role access.
  FOREACH r IN ARRAY ARRAY['finance.permission', 'finance.role_permission',
                           'finance.user_permission_override', 'finance.user_scope'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
      EXECUTE format('REVOKE ALL ON %s FROM vungu_app', r);
    END IF;
    PERFORM tenancy.classify(r, 'system',
      'who may do what in finance: read by the system plane only (systemOf), never writable by the person''s own connection');
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    RAISE NOTICE 'no VUNGU authority here: the finance tables stay pending until converted by hand';
    FOREACH r IN ARRAY ARRAY['finance.setting', 'finance.financial_year', 'finance.department',
                             'finance.programme', 'finance.activity', 'finance.account',
                             'finance.exchange_rate_policy', 'finance.approval_threshold',
                             'finance.column_mapping', 'finance.import_batch', 'finance.import_row',
                             'finance.import_exception', 'finance.budget_line', 'finance.budget_revision',
                             'finance.commitment', 'finance.variance_explanation', 'finance.project',
                             'finance.project_allocation', 'finance.transaction',
                             'finance.project_transaction', 'finance.document', 'finance.publication'] LOOP
      PERFORM tenancy.classify(r, 'pending', 'finance data awaiting the authority it belongs to');
    END LOOP;
    RETURN;
  END IF;

  FOREACH r IN ARRAY ARRAY['finance.setting', 'finance.financial_year', 'finance.department',
                           'finance.programme', 'finance.activity', 'finance.account',
                           'finance.exchange_rate_policy', 'finance.approval_threshold',
                           'finance.column_mapping', 'finance.import_batch', 'finance.import_row',
                           'finance.import_exception', 'finance.budget_line', 'finance.budget_revision',
                           'finance.commitment', 'finance.variance_explanation', 'finance.project',
                           'finance.project_allocation', 'finance.transaction',
                           'finance.project_transaction', 'finance.document', 'finance.publication'] LOOP
    PERFORM tenancy.make_tenant(r::regclass, 'VUNGU');
  END LOOP;

  -- The reporting views run as the caller, so the policies above decide what each person sees.
  FOREACH r IN ARRAY ARRAY['finance.v_budget_line_performance', 'finance.v_department_performance',
                           'finance.v_project_performance', 'finance.v_published_transaction'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
      EXECUTE format('GRANT SELECT ON %s TO vungu_app', r);
    END IF;
    PERFORM tenancy.classify(r, 'tenant_view', 'runs as the caller (security_invoker); the underlying policies decide the rows');
  END LOOP;
END $$;

-- The public portal reads published finance data while signed out, so the anonymous path needs the
-- published view. Row-level security on finance.transaction still applies underneath; the view's
-- join to a live publication row is what makes a row public, and nothing else does.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT USAGE ON SCHEMA finance TO vungu_app;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 14. WHAT THE PUBLIC MAY READ
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The standard tenant policy gives an anonymous visitor nothing: `app.authority_id()` is null, so
-- `app.visible_authorities()` is empty and `tenant_select` matches no row. That is the right
-- default and the reason the public surface has to be stated explicitly, as `public.stands` does
-- for a stand that is for sale (migration 172).
--
-- Each policy below says, in one place, what makes a finance row public. It is always a LIVE
-- PUBLICATION ROW — never a flag on the record itself, which could be set by accident, and never
-- a route's WHERE clause, which could be forgotten. Withdraw the publication and the data leaves
-- the public portal in the same instant, without touching the records.
--
-- Policies for the same command are OR-ed, so staff keep their own authority's rows through
-- `tenant_select` and additionally see what is published.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN RETURN; END IF;

  -- A publication row is itself public once published: it carries the publication date and the
  -- reporting period the portal must show beside every figure (specification §3.1).
  DROP POLICY IF EXISTS published_select ON finance.publication;
  CREATE POLICY published_select ON finance.publication FOR SELECT USING (state = 'published');

  -- A financial year is public while something of it is published — that is what populates the
  -- year selector.
  DROP POLICY IF EXISTS published_select ON finance.financial_year;
  CREATE POLICY published_select ON finance.financial_year FOR SELECT USING (
    EXISTS (SELECT 1 FROM finance.publication p
             WHERE p.financial_year_id = finance.financial_year.id AND p.state = 'published'));

  -- Classifications: the labels the published figures hang on. Public while the authority has
  -- anything published at all. These carry no amounts and no personal data.
  DROP POLICY IF EXISTS published_select ON finance.department;
  CREATE POLICY published_select ON finance.department FOR SELECT USING (
    deleted_at IS NULL AND EXISTS (SELECT 1 FROM finance.publication p
      WHERE p.authority_id = finance.department.authority_id AND p.state = 'published'));

  DROP POLICY IF EXISTS published_select ON finance.programme;
  CREATE POLICY published_select ON finance.programme FOR SELECT USING (
    deleted_at IS NULL AND EXISTS (SELECT 1 FROM finance.publication p
      WHERE p.authority_id = finance.programme.authority_id AND p.state = 'published'));

  DROP POLICY IF EXISTS published_select ON finance.activity;
  CREATE POLICY published_select ON finance.activity FOR SELECT USING (
    deleted_at IS NULL AND EXISTS (SELECT 1 FROM finance.publication p
      WHERE p.authority_id = finance.activity.authority_id AND p.state = 'published'));

  DROP POLICY IF EXISTS published_select ON finance.account;
  CREATE POLICY published_select ON finance.account FOR SELECT USING (
    deleted_at IS NULL AND EXISTS (SELECT 1 FROM finance.publication p
      WHERE p.authority_id = finance.account.authority_id AND p.state = 'published'));

  -- A budget line is public when the budget for its year is published AND the line itself has
  -- reached 'published'. Both conditions: a council releasing its budget does not thereby release
  -- lines that are still in draft.
  DROP POLICY IF EXISTS published_select ON finance.budget_line;
  CREATE POLICY published_select ON finance.budget_line FOR SELECT USING (
    deleted_at IS NULL AND status = 'published'
    AND EXISTS (SELECT 1 FROM finance.publication p
                 WHERE p.financial_year_id = finance.budget_line.financial_year_id
                   AND p.dataset = 'budget' AND p.state = 'published'));

  -- An approved budget revision is public with the budget it revises: the specification requires
  -- the original and the revised allocation to be separately visible, and that must hold on the
  -- public portal too, not only in the admin screens.
  DROP POLICY IF EXISTS published_select ON finance.budget_revision;
  CREATE POLICY published_select ON finance.budget_revision FOR SELECT USING (
    deleted_at IS NULL AND state = 'approved'
    AND EXISTS (SELECT 1 FROM finance.budget_line l
                  JOIN finance.publication p ON p.financial_year_id = l.financial_year_id
                 WHERE l.id = finance.budget_revision.budget_line_id
                   AND l.status = 'published'
                   AND p.dataset = 'budget' AND p.state = 'published'));

  -- A transaction is public when the dataset matching its account's kind is published for its
  -- year. The counterparty columns are still on the row; what keeps them from the public is that
  -- finance.v_published_transaction does not select them and the public route reads only that view.
  DROP POLICY IF EXISTS published_select ON finance.transaction;
  CREATE POLICY published_select ON finance.transaction FOR SELECT USING (
    deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM finance.account a
                  JOIN finance.publication p
                    ON p.financial_year_id = finance.transaction.financial_year_id
                   AND p.dataset = CASE a.kind WHEN 'revenue' THEN 'revenue' ELSE 'expenditure' END
                 WHERE a.id = finance.transaction.account_id AND p.state = 'published'));

  -- A project summary is public only after approval and only while the projects dataset is
  -- published (specification §3.6).
  DROP POLICY IF EXISTS published_select ON finance.project;
  CREATE POLICY published_select ON finance.project FOR SELECT USING (
    deleted_at IS NULL
    AND status IN ('approved', 'in_progress', 'suspended', 'completed')
    AND EXISTS (SELECT 1 FROM finance.publication p
                 WHERE p.authority_id = finance.project.authority_id
                   AND p.dataset = 'projects' AND p.state = 'published'));

  DROP POLICY IF EXISTS published_select ON finance.project_allocation;
  CREATE POLICY published_select ON finance.project_allocation FOR SELECT USING (
    deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM finance.project pr
                  JOIN finance.publication p ON p.authority_id = pr.authority_id
                 WHERE pr.id = finance.project_allocation.project_id
                   AND pr.status IN ('approved', 'in_progress', 'suspended', 'completed')
                   AND p.dataset = 'projects' AND p.state = 'published'));

  DROP POLICY IF EXISTS published_select ON finance.project_transaction;
  CREATE POLICY published_select ON finance.project_transaction FOR SELECT USING (
    deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM finance.project pr
                  JOIN finance.publication p ON p.authority_id = pr.authority_id
                 WHERE pr.id = finance.project_transaction.project_id
                   AND pr.status IN ('approved', 'in_progress', 'suspended', 'completed')
                   AND p.dataset = 'projects' AND p.state = 'published'));

  -- A document reaches the public only by being classified 'public' by hand. There is no rule that
  -- makes a document public as a side effect of anything else (decision D5).
  DROP POLICY IF EXISTS published_select ON finance.document;
  CREATE POLICY published_select ON finance.document FOR SELECT USING (
    deleted_at IS NULL AND visibility = 'public'
    AND EXISTS (SELECT 1 FROM finance.publication p
                 WHERE p.authority_id = finance.document.authority_id
                   AND p.dataset = 'documents' AND p.state = 'published'));

  -- The two settings the portal needs in order to LABEL its figures honestly: which currency it is
  -- defaulting to, and whether the available balance it shows includes commitments. Nothing else.
  DROP POLICY IF EXISTS published_select ON finance.setting;
  CREATE POLICY published_select ON finance.setting FOR SELECT USING (
    key IN ('reporting.default_currency', 'available_balance.include_commitments'));
END $$;
