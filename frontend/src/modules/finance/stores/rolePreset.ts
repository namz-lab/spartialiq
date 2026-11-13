/**
 * The role preset: which part of the finance workspace is this person's actual job.
 *
 * WHY THIS EXISTS
 * Before this module every one of the eight roles arrived on the same section, because every one of
 * them holds `finance.budget.view` and Overview is the first section in the rail. A publisher saw
 * twelve sections of which two are its work; a technical administrator saw fourteen of which two
 * are. The rail was filtered by permission and shaped by nothing.
 *
 * WHAT IT IS NOT
 * It is NOT a gate. Nothing here narrows `can()`, nothing here makes a section unreachable, and the
 * backend re-checks every action regardless (src/middleware/financePermissions.js). A section that
 * is not in `foreground` still appears in the rail, still opens, and still works — it is moved to a
 * second band so that the two sections a publisher acts in are not one sixth of its rail. An
 * explicit `?section=` link always wins over the landing choice, because a finance conversation
 * ends in "send me the link" as often as a planning one.
 *
 * WHY IT IS DRIVEN BY PERMISSIONS AND NOT BY THE ROLE NAME
 * A council can grant a personal override or a departmental scope to any account
 * (`finance.user_scope`, `finance.user_permission_override`), so the role string is not a reliable
 * description of what someone may do. Every rule below reads the permission set the server sent.
 * The role string is used only where presentation genuinely needs a tiebreaker — the label on the
 * profile chip, which lives in the shell — and never to decide what is offered.
 *
 * The per-role specification this implements is docs/gis-finance/ROLE-WORKFLOW-COVERAGE.md §6
 * ("What a role-based workspace must do"), itself derived from the grants in migrations 188 and 199.
 */

/** Every section of the workspace. The shell owns the components; this owns the keys. */
export type FinanceSectionKey =
  | 'overview' | 'map' | 'years' | 'classifications'
  | 'budget' | 'revisions' | 'projects'
  | 'ledger' | 'statements' | 'rates' | 'cash'
  | 'transactions' | 'imports' | 'reports' | 'documents'
  | 'publication' | 'audit' | 'permissions' | 'access' | 'settings'

/**
 * The filters a section opens with when the person has not asked for something else.
 *
 * Each is a single status value, because the API's status filters are single-valued enums
 * (`finance-budget.js:70`) — a comma list would be silently ignored. Where a role's work spans two
 * statuses (a preparer's drafts and its returned lines) the default picks the one that is the work,
 * and the work queue counts the other separately.
 */
export interface FinanceDefaultFilters {
  /** Budget section: `finance.budget_line.status`. */
  budgetStatus?: 'draft' | 'submitted' | 'returned' | 'approved' | 'published'
  /** Revisions section: `finance.budget_revision.state`. */
  revisionState?: 'draft' | 'submitted' | 'approved' | 'rejected' | 'withdrawn'
  /** Projects section: `finance.project.status`. */
  projectStatus?: 'proposed' | 'awaiting_approval' | 'approved' | 'in_progress' | 'suspended' | 'completed' | 'cancelled'
  /** Publication section: `finance.publication.state`. */
  publicationState?: 'pending' | 'approved' | 'published' | 'rejected' | 'withdrawn'
  /** Imports section: `finance.import_batch.status`. */
  importStatus?: 'uploaded' | 'mapped' | 'validating' | 'validated' | 'committed' | 'failed' | 'cancelled'
  /** Audit section: how far back to look on arrival. Everything-ever is not a review set. */
  auditDays?: number
  /** True when the person is confined to their own votes, so "All departments" would be a lie. */
  departmentLocked?: boolean
}

export interface FinanceRolePreset {
  /** The section to open when the URL does not name one. */
  landing: FinanceSectionKey
  /** The sections that are this person's work. Rail band one. */
  foreground: FinanceSectionKey[]
  /** What the person is here to do, in one sentence, shown above their queue. */
  summary: string
  defaultFilters: FinanceDefaultFilters
}

export interface RolePresetInput {
  /** The role the SERVER reports, used for presentation only. */
  role?: string | null
  /** The permission codes the server reports. */
  permissions: Iterable<string>
  /** True when `finance.user_scope` confines this person to particular votes. */
  scoped?: boolean
}

/**
 * The capabilities a preset is built from.
 *
 * Named after the job rather than the code, so the rules below read as statements about work:
 * "someone who commits imports lands on imports" rather than "someone with bit 15 set".
 */
interface Capabilities {
  viewsBudget: boolean
  prepares: boolean
  approvesMoney: boolean
  approvesPublication: boolean
  requestsPublication: boolean
  publishes: boolean
  revises: boolean
  explains: boolean
  importsData: boolean
  commitsImports: boolean
  resolvesExceptions: boolean
  configures: boolean
  closesYears: boolean
  managesUsers: boolean
  readsAudit: boolean
  exportsAudit: boolean
  viewsTransactions: boolean
  viewsCounterparty: boolean
  /** Reads the book of account: the GL chart, the vouchers and the statements. */
  viewsLedger: boolean
  /** Maintains the GL chart of accounts or the accounting periods. */
  keepsLedger: boolean
  /** Drafts vouchers. Drafting posts nothing. */
  draftsVouchers: boolean
  /** Posts or reverses a voucher — the acts that write and correct the book of account. */
  postsVouchers: boolean
  /** Runs the year-end closing. An annual act, held by the committee. */
  closesLedgerYear: boolean
  /** Reads the valuation roll, the tariff, the bills, the receipts and the arrears. */
  viewsRates: boolean
  /** Does the rates office's work: keeps a register, raises or commits a run, takes a payment. */
  worksRates: boolean
  /** Records the Council's resolution of a rate in the dollar. */
  approvesTariffs: boolean
  /** Reads the cash office: sessions, receipts, cash-ups and bankings. */
  viewsCash: boolean
  /** Works a till: opens a session, issues receipts, declares the count, prepares the banking. */
  worksTill: boolean
  /** Agrees another person's cash-up, which posts the session to the book of account. */
  verifiesCash: boolean
  /** Maintains the cash points and the Council's income list. */
  setsUpCash: boolean
  /** Supervises the tills: the drawers board, abandoned sessions, witnessed counts (migration 208). */
  supervisesTills: boolean
  /**
   * Reads the whole position and acts on none of it: the accounting officer. Distinguished from the
   * auditor by not holding the audit EXPORT (the auditor takes the trail away; the executive reads
   * it), and from everyone else by holding nothing that prepares, posts, approves or configures.
   */
  oversees: boolean
  viewsProjects: boolean
  managesProjects: boolean
  approvesProjects: boolean
  uploadsDocuments: boolean
  viewsRestrictedDocuments: boolean
  exportsReports: boolean
  viewsMap: boolean
  scoped: boolean
}

function capabilitiesOf(input: RolePresetInput): Capabilities {
  const held = input.permissions instanceof Set
    ? input.permissions as Set<string>
    : new Set<string>(input.permissions)
  const has = (code: string) => held.has(code)
  const writes = [...held].some((code) => !/\.(view|export|view_counterparty|view_restricted|export_restricted)$/.test(code))
  return {
    viewsCash: has('finance.cash.view'),
    worksTill: has('finance.cash.session.operate') || has('finance.cash.receipt.record'),
    verifiesCash: has('finance.cash.session.verify'),
    setsUpCash: has('finance.cash.setup.manage'),
    supervisesTills: has('finance.cash.session.supervise'),
    oversees: has('finance.audit.view') && has('finance.ledger.view') && !has('finance.audit.export') && !writes,
    viewsBudget: has('finance.budget.view'),
    prepares: has('finance.budget.prepare') || has('finance.budget.submit'),
    approvesMoney: has('finance.budget.approve') || has('finance.revision.approve') || has('finance.project.approve'),
    approvesPublication: has('finance.publication.approve'),
    requestsPublication: has('finance.publication.review'),
    publishes: has('finance.publication.publish') || has('finance.publication.withdraw'),
    revises: has('finance.revision.prepare') || has('finance.revision.submit') || has('finance.revision.approve'),
    explains: has('finance.variance.explain'),
    importsData: has('finance.import.upload') || has('finance.import.validate'),
    commitsImports: has('finance.import.commit'),
    resolvesExceptions: has('finance.import.exception.resolve'),
    configures: has('finance.config.manage'),
    closesYears: has('finance.year.close'),
    managesUsers: has('finance.users.manage_finance_roles'),
    readsAudit: has('finance.audit.view'),
    exportsAudit: has('finance.audit.export'),
    viewsTransactions: has('finance.transaction.view'),
    viewsCounterparty: has('finance.transaction.view_counterparty'),
    viewsLedger: has('finance.ledger.view'),
    keepsLedger: has('finance.ledger.account.manage') || has('finance.ledger.period.manage'),
    draftsVouchers: has('finance.ledger.voucher.prepare'),
    postsVouchers: has('finance.ledger.voucher.post') || has('finance.ledger.voucher.reverse'),
    closesLedgerYear: has('finance.ledger.close_year'),
    viewsRates: has('finance.rates.view'),
    worksRates: has('finance.rates.valuation.manage') || has('finance.rates.tariff.manage')
      || has('finance.rates.account.manage') || has('finance.rates.bill.prepare')
      || has('finance.rates.bill.post') || has('finance.rates.receipt.record'),
    approvesTariffs: has('finance.rates.tariff.approve'),
    viewsProjects: has('finance.project.view'),
    managesProjects: has('finance.project.manage'),
    approvesProjects: has('finance.project.approve'),
    uploadsDocuments: has('finance.document.upload'),
    viewsRestrictedDocuments: has('finance.document.view_restricted'),
    exportsReports: has('finance.report.export') || has('finance.report.export_restricted'),
    viewsMap: has('finance.map.view'),
    scoped: input.scoped === true,
  }
}

/**
 * Where this person arrives.
 *
 * Ordered by how narrow the duty is, narrowest first, so the role whose work is one section lands
 * in it. The two roles that land on Overview are the ones whose work is *deciding across* the
 * cycle — the committee, which approves four different things, and the finance administrator, which
 * operates all of it. For them Overview is the decisions surface: the work queue renders above the
 * departmental position, which is why it is not simply "the dashboard" any more.
 */
function landingFor(c: Capabilities): FinanceSectionKey {
  // A technical administrator provisions accounts and reads the trail, and holds no financial
  // authority at all (migration 188:1216-1222). Access is the only section that is its job.
  if (c.managesUsers && !c.prepares && !c.approvesMoney && !c.commitsImports) return 'access'
  // A cashier's whole day is the counter. Whatever else an override has added, a person who works
  // a till arrives at it: there is a queue of payers in front of them.
  if (c.worksTill) return 'cash'
  // The cash supervisor's day is the drawers board in the cash office (migration 208).
  if (c.supervisesTills && !c.draftsVouchers && !c.configures) return 'cash'
  // A publisher's nine permissions do one thing: release what someone else approved.
  if (c.publishes) return 'publication'
  // The accounting officer reads the position, and Overview is the position.
  if (c.oversees) return 'overview'
  // Read-only with the widest disclosure: the trail is the work, not a by-product of it. Holding
  // the audit EXPORT is what marks the auditor; the accounting officer reads the trail without it.
  if (c.readsAudit && c.exportsAudit && !c.prepares && !c.approvesMoney && !c.publishes && !c.importsData && !c.configures) return 'audit'
  // Approving budget lines, revisions, projects and releases is four queues, not one section.
  if (c.approvesMoney || c.approvesPublication) return 'overview'
  // The sole committer of an import batch operates the whole cycle; its queue spans sections too.
  if (c.commitsImports) return 'overview'
  if (c.importsData) return 'imports'
  if (c.prepares) return 'budget'
  // The accountant keeps the book: drafts vouchers and posts the ones others drafted.
  if (c.draftsVouchers && c.postsVouchers) return 'ledger'
  // The revenue office: the roll, the accounts, the runs and the arrears.
  if (c.viewsRates && c.worksRates) return 'rates'
  if (c.viewsBudget) return 'overview'
  return 'permissions'
}

/**
 * The sections that are this person's work.
 *
 * One rule per section, each a statement about the permission that makes the section a task rather
 * than a reference. The landing section is always included: arriving somewhere that is presented as
 * "also available" would be incoherent.
 */
function foregroundFor(c: Capabilities, landing: FinanceSectionKey): FinanceSectionKey[] {
  const keys: FinanceSectionKey[] = []
  const add = (key: FinanceSectionKey, when: boolean) => { if (when) keys.push(key) }

  // Overview is the position page for everyone who moves money through the cycle. For a publisher
  // or a technical administrator it is a page of figures they do not act on.
  add('overview', c.viewsBudget && (c.prepares || c.approvesMoney || c.commitsImports || c.importsData || c.oversees))
  // The map is foregrounded for the roles whose work is deciding or reviewing WHERE money goes
  // across the whole council: a preparer who is not confined to one vote, and the auditor. For an
  // importer or a committer the map is a check on their work, not the work; for a scoped
  // departmental head a one-department choropleth says little it cannot read in a table.
  add('map', c.viewsMap && !c.scoped && !c.importsData && !c.commitsImports && (c.prepares || c.exportsAudit))
  add('years', c.configures || c.closesYears)
  add('classifications', c.configures)
  add('budget', c.prepares || c.approvesMoney || c.explains || (c.readsAudit && c.exportsReports))
  add('revisions', c.revises)
  add('projects', c.managesProjects || c.approvesProjects)
  // The register is the work of everyone who holds the permission: it is how a director answers
  // "what did we actually spend on this", and how an auditor samples. Four of the eight roles hold
  // it (migration 188:1065) and until this module none of them had a screen for it (GAP-1).
  // THE BOOK OF ACCOUNT IS WORK for whoever keeps it: the officer who drafts vouchers, the
  // director who posts and reverses them, and whoever maintains the chart and the periods. It is
  // deliberately NOT work for a role that merely holds `finance.ledger.view` — the committee and
  // the auditor read the statements, and the technical administrator reads them and acts on
  // nothing. Reading a ledger is not keeping one.
  add('ledger', c.viewsLedger && (c.draftsVouchers || c.postsVouchers || c.keepsLedger))
  // The statements are work for the roles that DECIDE on them or take them away: whoever posts
  // into the book and must see what it now says, whoever runs the year-end closing, and the
  // auditor, whose job is reading and exporting. For a drafting officer the statements are a check
  // on their own work rather than the work, which is the same reasoning the map already uses.
  add('statements', c.viewsLedger && (c.postsVouchers || c.closesLedgerYear || c.oversees || (c.readsAudit && c.exportsAudit)))
  // RATES IS WORK for the rates office — whoever keeps the roll or the accounts, raises or commits
  // a run, or takes a payment — and for the committee, which resolves the rate in the dollar. For
  // the auditor and the technical administrator, who hold `finance.rates.view` alone, it is on the
  // rail to read, like the ledger.
  add('rates', c.viewsRates && (c.worksRates || c.approvesTariffs))
  // THE CASH OFFICE IS WORK for whoever works a till, whoever agrees a cash-up, and whoever sets
  // the counters up. For the committee and the auditor, who hold `finance.cash.view` alone, it is
  // on the rail to read. For the accounting officer it is foregrounded as oversight: unbanked
  // takings are the one figure in a council's finances that goes wrong by the day.
  add('cash', c.viewsCash && (c.worksTill || c.verifiesCash || c.setsUpCash || c.supervisesTills || c.oversees))
  add('transactions', c.viewsTransactions)
  add('imports', c.importsData || c.commitsImports || c.resolvesExceptions)
  add('reports', c.exportsReports)
  add('documents', c.uploadsDocuments || c.viewsRestrictedDocuments || c.publishes)
  add('publication', c.publishes || c.approvesPublication)
  // Reading the trail is work for the roles that can take it away and act on it, or that decide.
  add('audit', c.readsAudit && (c.exportsAudit || c.approvesMoney || c.managesUsers || c.oversees))
  add('access', c.managesUsers)
  add('settings', c.configures)

  // The landing section leads the band: a cashier's rail starts with the counter, not with Rates.
  return [landing, ...keys.filter((key) => key !== landing)]
}

function filtersFor(c: Capabilities): FinanceDefaultFilters {
  const filters: FinanceDefaultFilters = {}

  // An approver's register is the things submitted to it. A preparer's is its own unfinished work.
  // A finance administrator both prepares and operates, so its budget register opens unfiltered —
  // narrowing it would hide the line someone is asking about on the telephone.
  if (c.approvesMoney) filters.budgetStatus = 'submitted'
  else if (c.prepares && !c.configures) filters.budgetStatus = 'draft'

  if (c.approvesMoney) filters.revisionState = 'submitted'
  else if (c.revises) filters.revisionState = 'draft'

  if (c.approvesProjects && !c.managesProjects) filters.projectStatus = 'awaiting_approval'

  // "Approved and awaiting publication" is the publisher's whole job; "pending" is the committee's.
  if (c.publishes) filters.publicationState = 'approved'
  else if (c.approvesPublication) filters.publicationState = 'pending'

  // The committer is the only one for whom "validated" is a to-do list.
  if (c.commitsImports) filters.importStatus = 'validated'

  if (c.readsAudit) filters.auditDays = c.managesUsers && !c.exportsReports ? 7 : 30

  if (c.scoped) filters.departmentLocked = true
  return filters
}

function summaryFor(c: Capabilities): string {
  if (c.managesUsers && !c.prepares && !c.approvesMoney) {
    return 'You provision finance access and read the trail. You hold no permission that approves, publishes, commits an import or discloses restricted data.'
  }
  if (c.worksTill) {
    return 'You take the council\'s money at the counter: open your till, issue a receipt for every payment, and declare your count at the end of the day. Somebody else verifies the count, and only then do your receipts reach the book of account.'
  }
  if (c.supervisesTills && !c.draftsVouchers && !c.configures) {
    return 'You supervise the tills: see who holds every drawer, find a session abandoned when a cashier has left it, count that drawer with a witness, assign cashiers to counters and verify other people\'s cash-ups. You take no money, and you never verify a count you made or witnessed.'
  }
  if (c.oversees) {
    return 'You read the council\'s whole financial position: the budget, the book of account, the arrears, the cash office and the trail. Nothing on these screens is yours to change.'
  }
  if (c.publishes) {
    return 'You release what someone else approved, and you can take it off the portal again. Approving a dataset and publishing it are separate duties.'
  }
  if (c.readsAudit && !c.prepares && !c.approvesMoney && !c.importsData) {
    return 'You read everything and change nothing. Refused attempts are part of the record and are shown beside the successful ones.'
  }
  if (c.approvesMoney || c.approvesPublication) {
    return 'You decide what the council approves. You cannot approve your own request — that is refused by the route and by the database, not only by this screen.'
  }
  if (c.commitsImports) {
    return 'You operate the cycle: the reporting period, the classifications, the imports and the commit no one else may make.'
  }
  if (c.importsData) {
    return 'You bring the accounting system\'s figures in and reconcile them. Committing a batch is a second pair of eyes and is held by the finance administrator.'
  }
  if (c.draftsVouchers && c.postsVouchers && !c.prepares) {
    return 'You keep the book of account: draft journals, post what others prepared, verify the cash office\'s cash-ups and close the periods. You cannot post a voucher you prepared yourself.'
  }
  if (c.viewsRates && c.worksRates && !c.prepares) {
    return 'You keep the registers that rates billing depends on, raise the billing runs and follow the arrears. A tariff you draft is approved by the committee, and a run you raise is committed by someone else.'
  }
  if (c.scoped && c.prepares) {
    return 'You prepare and submit your department\'s allocations. Your figures are confined to your own votes, and approval comes from the committee.'
  }
  if (c.prepares) {
    return 'You prepare and submit allocations, raise revisions and explain variances. Approval comes from someone else.'
  }
  return 'You have read access to the council\'s budget. Nothing on these screens changes a figure.'
}

/**
 * The preset for one person.
 *
 * Pure: it reads a permission set and returns presentation. Keeping it a free function rather than
 * a store getter is what makes "all eight roles resolve coherently" a test rather than a claim.
 */
export function resolveRolePreset(input: RolePresetInput): FinanceRolePreset {
  const c = capabilitiesOf(input)
  const landing = landingFor(c)
  return {
    landing,
    foreground: foregroundFor(c, landing),
    summary: summaryFor(c),
    defaultFilters: filtersFor(c),
  }
}

/**
 * Which section is open: the URL first, then the preset, then whatever this person can open.
 *
 * THE ORDER IS THE WHOLE POINT. A finance conversation ends in "send me the link" as often as a
 * planning one, so a section named in the address always wins — a colleague who sends
 * `?section=imports` must land on imports whatever their role would otherwise open. The preset is
 * consulted only when the address says nothing, and it can never widen what the permissions allow:
 * a landing the person cannot open falls through to the first section they can, which is exactly
 * what the workspace did for all eight roles before the preset existed.
 */
export function resolveActiveSection(input: {
  /** `?section=` from the URL, if any. */
  requested?: string | null
  /** The sections this person's permissions allow, in rail order. */
  openable: readonly FinanceSectionKey[]
  /** This person's preset, for its landing. */
  preset: Pick<FinanceRolePreset, 'landing'>
}): FinanceSectionKey {
  const openable = input.openable
  const requested = input.requested ? String(input.requested) : ''
  const explicit = openable.find((key) => key === requested)
  if (explicit) return explicit
  const landing = openable.find((key) => key === input.preset.landing)
  if (landing) return landing
  return openable[0] ?? 'overview'
}

/**
 * What a role cannot see, said out loud.
 *
 * Two absences in this workspace are deliberate and look like defects from the inside:
 *
 *  - A FINANCE ADMINISTRATOR CANNOT ADMINISTER FINANCE ACCESS. Only the technical administrator
 *    holds `finance.users.manage_finance_roles` (migration 188:1222), described in the catalogue as
 *    "User provisioning. Confers no authority over financial content". So the Finance access section
 *    renders for exactly one role out of eight, and a finance administrator looking for "who holds
 *    which finance role" finds no section and, until now, no explanation. (GAP-15.)
 *  - A TECHNICAL ADMINISTRATOR HAS NO FINANCE MAP. `finance.map.view` was granted to the seven
 *    finance roles only (migration 199:228). The rail simply had no map on it and said nothing.
 *
 * Both are returned as sentences rather than resolved as features: the answer to "why can I not see
 * this" is an explanation, never a button that would produce a 403.
 */
export function deliberateAbsences(input: RolePresetInput): string[] {
  const c = capabilitiesOf(input)
  const notes: string[] = []
  if (!c.managesUsers && (c.configures || c.commitsImports)) {
    notes.push(
      'Finance access — who holds which finance role, override or departmental scope — is provisioned by the technical administrator, not from here. User provisioning confers no authority over financial content, and financial authority confers none over accounts. Ask the administrator for a list; the grants they make are recorded in Audit history.',
    )
  }
  if (c.viewsLedger && !c.draftsVouchers && !c.postsVouchers && !c.keepsLedger) {
    notes.push(
      'The general ledger is on your rail to read, not to keep: you hold finance.ledger.view and none of the permissions that draft, post or reverse a voucher. That is deliberate — posting is the act that puts a figure beyond amendment, and it is separated from preparing it by a constraint on the record rather than by this screen. The statements drawn from the ledger are yours in full.',
    )
  }
  if (c.viewsRates && !c.worksRates && !c.approvesTariffs) {
    notes.push(
      'Rates is on your rail to read: you hold finance.rates.view and none of the permissions that maintain the roll, raise a billing run, take a payment or approve a tariff. The arrears and their agreement with the receivable control account are yours in full.',
    )
  }
  if (c.viewsCash && !c.worksTill && !c.verifiesCash && !c.setsUpCash) {
    notes.push(
      'The cash office is on your rail to read: you hold finance.cash.view and none of the permissions that work a till, verify a cash-up or maintain the counters. Every session, receipt and banking is yours to read in full.',
    )
  }
  if (c.worksTill && !c.viewsBudget) {
    notes.push(
      'Your rail holds the cash office and the rates register and nothing else. That is deliberate: a counter is where the public pays, not a place to browse the council\'s budget or its book of account, and a cashier holds no permission that reads either.',
    )
  }
  if (!c.viewsMap && c.viewsBudget) {
    notes.push(
      'There is no Finance map on your rail. The ward view is granted to the seven finance roles and deliberately not to the technical administrator, who holds no financial authority and no need of financial geography.',
    )
  }
  return notes
}
