/**
 * The Accounting workspace, `/finance/accountant` (spec 2026-11-12-finance-role-workspaces-design.md).
 *
 * Importing this file (from `workspaces/index.ts`) registers it. Who may open it is the server's
 * answer on `/api/finance/me` (holders of `finance.ledger.voucher.post`); every request on every
 * page is still authorised by the backend.
 */
import type { RouteRecordRaw } from 'vue-router'
import { registerWorkspace } from '../../shell/workspaces'

const crumbs = (label: string) => [{ label: 'Accountant', to: 'acc-dashboard' }, { label }]
const Section = () => import('./pages/SectionPage.vue')

/** A page built on an existing console screen (see SectionPage.vue). */
const section = (path: string, name: string, key: string, title: string, lead: string): RouteRecordRaw => ({
  path, name, component: Section, meta: { cwSection: key, cwTitle: title, cwLead: lead, cwCrumbs: crumbs(title) },
})

export const accountantRoutes: RouteRecordRaw[] = [
  {
    path: '/finance/accountant',
    component: () => import('./AccountantLayout.vue'),
    meta: { title: 'Accounting - Vungu Rural District Council' },
    children: [
      { path: 'property-map', name: 'acc-gis', component: () => import('../shared/PropertyGisPage.vue'), meta: { cwTitle: 'Property Map', gisMode: 'accountant', cwCrumbs: [{ label: 'Accountant', to: 'acc-dashboard' }, { label: 'Property Map' }] } },
      { path: '', name: 'acc-dashboard', component: () => import('./pages/AccountantDashboard.vue'), meta: { cwTitle: 'Dashboard' } },
      section('cash-ups', 'acc-cashups', 'cashups', 'Cash-Up Approvals', 'Verify each cashier\'s declared count, or return it for a recount. You cannot verify a drawer you counted or witnessed.'),
      { path: 'bank', name: 'acc-bank', component: () => import('./pages/BankReconciliation.vue'), meta: { cwTitle: 'Bank Reconciliation', cwCrumbs: crumbs('Bank Reconciliation') } },
      section('banking', 'acc-banking', 'bank', 'Banking & Deposits', 'What each till holds, and the deposits carried to the bank, which you post.'),
      { path: 'journals', name: 'acc-journals', component: () => import('./pages/JournalsPage.vue'), meta: { cwTitle: 'Journals', cwCrumbs: crumbs('Journals') } },
      { path: 'salaries', name: 'acc-salaries', component: () => import('./pages/SalariesPage.vue'), meta: { cwTitle: 'Salaries Journal', cwCrumbs: crumbs('Salaries Journal') } },
      { path: 'journals/new', name: 'acc-journal-new', component: () => import('./pages/JournalEditorPage.vue'), meta: { cwTitle: 'New journal', cwNav: 'acc-journals', cwCrumbs: [{ label: 'Accountant', to: 'acc-dashboard' }, { label: 'Journals', to: 'acc-journals' }, { label: 'New journal' }] } },
      { path: 'journals/:id/edit', name: 'acc-journal-edit', component: () => import('./pages/JournalEditorPage.vue'), meta: { cwTitle: 'Edit draft', cwNav: 'acc-journals', cwCrumbs: [{ label: 'Accountant', to: 'acc-dashboard' }, { label: 'Journals', to: 'acc-journals' }, { label: 'Edit draft' }] } },
      { path: 'journals/:id', name: 'acc-voucher', component: () => import('./pages/VoucherPage.vue'), meta: { cwTitle: 'Voucher', cwNav: 'acc-journals', cwCrumbs: [{ label: 'Accountant', to: 'acc-dashboard' }, { label: 'Journals', to: 'acc-journals' }, { label: 'Voucher' }] } },
      { path: 'payable', name: 'acc-payable', component: () => import('./pages/AccountsPayable.vue'), meta: { cwTitle: 'Accounts Payable', cwCrumbs: crumbs('Accounts Payable') } },
      { path: 'receivable', name: 'acc-receivable', component: () => import('./pages/DebtorsPage.vue'), meta: { cwTitle: 'Debtors', cwCrumbs: crumbs('Debtors') } },
      { path: 'ledger', name: 'acc-ledger', component: () => import('./pages/GeneralLedgerPage.vue'), meta: { cwTitle: 'General Ledger', cwCrumbs: crumbs('General Ledger') } },
      { path: 'ledger/:id', name: 'acc-account', component: () => import('./pages/AccountLedgerPage.vue'), meta: { cwTitle: 'Account', cwNav: 'acc-ledger', cwCrumbs: [{ label: 'Accountant', to: 'acc-dashboard' }, { label: 'General Ledger', to: 'acc-ledger' }, { label: 'Account' }] } },
      { path: 'trial-balance', name: 'acc-trial', component: () => import('./pages/TrialBalancePage.vue'), meta: { cwTitle: 'Trial Balance', cwCrumbs: crumbs('Trial Balance') } },
      { path: 'reports', name: 'acc-reports', component: () => import('./pages/StatementsPage.vue'), meta: { cwTitle: 'Financial Statements', cwCrumbs: crumbs('Financial Statements') } },
      { path: 'cashbook', name: 'acc-cashbook', component: () => import('./pages/CashbookPage.vue'), meta: { cwTitle: 'Cashbook', cwCrumbs: crumbs('Cashbook') } },
      { path: 'ledger-reports', name: 'acc-ledger-reports', component: () => import('./pages/LedgerReportsPage.vue'), meta: { cwTitle: 'Ledger Reports', cwCrumbs: crumbs('Ledger Reports') } },
      { path: 'payable/:partyId', name: 'acc-creditor', component: () => import('./pages/CreditorStatementPage.vue'), meta: { cwTitle: 'Creditor', cwNav: 'acc-payable', cwCrumbs: [{ label: 'Accountant', to: 'acc-dashboard' }, { label: 'Accounts Payable', to: 'acc-payable' }, { label: 'Creditor' }] } },
      { path: 'receivable/:partyId', name: 'acc-debtor', component: () => import('./pages/DebtorStatementPage.vue'), meta: { cwTitle: 'Debtor', cwNav: 'acc-receivable', cwCrumbs: [{ label: 'Accountant', to: 'acc-dashboard' }, { label: 'Debtors', to: 'acc-receivable' }, { label: 'Debtor' }] } },
      { path: 'vote-book', name: 'acc-votebook', component: () => import('./pages/VoteBookPage.vue'), meta: { cwTitle: 'Vote Book', cwCrumbs: crumbs('Vote Book') } },
      { path: 'assets', name: 'acc-assets', component: () => import('./pages/AssetRegister.vue'), meta: { cwTitle: 'Asset Register', cwCrumbs: crumbs('Asset Register') } },
      { path: 'parties', name: 'acc-parties', component: () => import('./pages/PartiesPage.vue'), meta: { cwTitle: 'Parties', cwCrumbs: crumbs('Parties') } },
      { path: 'suppliers', name: 'acc-suppliers', redirect: { name: 'acc-parties', query: { type: 'supplier' } } },
      section('revenue', 'acc-revenue', 'revenue', 'Revenue & Billing', 'Property rates: valuations, tariffs, billing runs to commit, bills and receipts.'),
      { path: 'tax', name: 'acc-tax', component: () => import('./pages/TaxControlPage.vue'), meta: { cwTitle: 'Tax Control', cwCrumbs: crumbs('Tax Control') } },
      { path: 'migration', name: 'acc-migration', component: () => import('./pages/DataMigration.vue'), meta: { cwTitle: 'Data Migration', cwCrumbs: crumbs('Data Migration') } },
      { path: 'close-period', name: 'acc-close', component: () => import('./pages/PeriodClosePage.vue'), meta: { cwTitle: 'Period Close', cwCrumbs: crumbs('Period Close') } },
      section('audit', 'acc-audit', 'audit', 'Audit Trail', 'Every finance action, who took it and when.'),
      section('settings', 'acc-settings', 'settings', 'Settings', 'The cash points and the council\'s income list used at the counter.'),
      { path: 'messages', name: 'acc-messages', component: () => import('../shared/MessagesPage.vue'), meta: { cwTitle: 'Messages', cwNav: 'acc-dashboard', cwCrumbs: crumbs('Messages') } },
    ],
  },
]

registerWorkspace({
  key: 'accountant',
  routes: accountantRoutes,
  home: 'acc-dashboard',
  serves: {
    ledger: 'acc-journals',
    'ledger.periods': 'acc-close',
    'ledger.chart': 'acc-ledger',
    'ledger.vouchers': 'acc-journals',
    budget: 'acc-votebook',
    statements: 'acc-reports',
    'statements.trial-balance': 'acc-trial',
    'statements.position': 'acc-reports',
    'statements.performance': 'acc-reports',
    'statements.ageing': 'acc-receivable',
    'cash.banking': 'acc-banking',
    'cash.setup': 'acc-settings',
  },
})
