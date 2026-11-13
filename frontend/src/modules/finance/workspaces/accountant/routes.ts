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
const NotBuilt = () => import('./pages/NotBuiltPage.vue')

/** A page built on an existing console screen (see SectionPage.vue). */
const section = (path: string, name: string, key: string, title: string, lead: string): RouteRecordRaw => ({
  path, name, component: Section, meta: { cwSection: key, cwTitle: title, cwLead: lead, cwCrumbs: crumbs(title) },
})

const routes: RouteRecordRaw[] = [
  {
    path: '/finance/accountant',
    component: () => import('./AccountantLayout.vue'),
    meta: { title: 'Accounting - Vungu Rural District Council' },
    children: [
      { path: '', name: 'acc-dashboard', component: () => import('./pages/AccountantDashboard.vue'), meta: { cwTitle: 'Dashboard' } },
      section('cash-ups', 'acc-cashups', 'cashups', 'Cash-Up Approvals', 'Verify each cashier\'s declared count, or return it for a recount. You cannot verify a drawer you counted or witnessed.'),
      { path: 'bank', name: 'acc-bank', component: () => import('./pages/BankReconciliation.vue'), meta: { cwTitle: 'Bank Reconciliation', cwCrumbs: crumbs('Bank Reconciliation') } },
      section('banking', 'acc-banking', 'bank', 'Banking & Deposits', 'What each till holds, and the deposits carried to the bank, which you post.'),
      section('journals', 'acc-journals', 'journals', 'Journal Entries', 'Prepare journals and post the ones others prepared. A posted voucher is corrected by a reversal, never edited.'),
      { path: 'payable', name: 'acc-payable', component: () => import('./pages/AccountsPayable.vue'), meta: { cwTitle: 'Accounts Payable', cwCrumbs: crumbs('Accounts Payable') } },
      section('receivable', 'acc-receivable', 'receivable', 'Accounts Receivable', 'What ratepayers and debtors owe, and for how long, from the posted ledger.'),
      section('ledger', 'acc-ledger', 'ledger', 'General Ledger', 'The chart of accounts and each account\'s balance.'),
      section('trial-balance', 'acc-trial', 'trial', 'Trial Balance', 'One per currency. Each must balance.'),
      section('reports', 'acc-reports', 'reports', 'Financial Reports', 'The statements of financial position and performance, per currency.'),
      section('budget', 'acc-budget', 'budget', 'Budget Management', 'Budget lines, revisions and what has been spent against them.'),
      {
        path: 'assets', name: 'acc-assets', component: NotBuilt,
        meta: {
          cwTitle: 'Asset Register', cwLead: 'The council\'s property, plant and equipment, and its depreciation.', cwCrumbs: crumbs('Asset Register'),
          cwWhy: 'The fixed-asset register and the depreciation charge are a later workstream of the finance system. The statement of financial position lists this among what it does not yet include.',
          cwSee: [{ name: 'acc-ledger', label: 'Fixed-asset accounts in the General Ledger' }, { name: 'acc-reports', label: 'Financial position' }],
        },
      },
      { path: 'suppliers', name: 'acc-suppliers', component: () => import('./pages/SupplierManagement.vue'), meta: { cwTitle: 'Supplier Management', cwCrumbs: crumbs('Supplier Management') } },
      section('revenue', 'acc-revenue', 'revenue', 'Revenue & Billing', 'Property rates: valuations, tariffs, billing runs to commit, bills and receipts.'),
      {
        path: 'tax', name: 'acc-tax', component: NotBuilt,
        meta: {
          cwTitle: 'Tax & Statutory', cwLead: 'VAT, PAYE and statutory returns.', cwCrumbs: crumbs('Tax & Statutory'),
          cwWhy: 'Tax and statutory returns are not part of the finance system yet. Tax liabilities can be kept on a tax-typed account in the chart and moved by journal.',
          cwSee: [{ name: 'acc-journals', label: 'Journal Entries' }, { name: 'acc-trial', label: 'Trial Balance' }],
        },
      },
      { path: 'migration', name: 'acc-migration', component: () => import('./pages/DataMigration.vue'), meta: { cwTitle: 'Data Migration', cwCrumbs: crumbs('Data Migration') } },
      section('close-period', 'acc-close', 'close', 'Close Period', 'Open and close the accounting periods. Nothing posts into a closed period.'),
      section('audit', 'acc-audit', 'audit', 'Audit Trail', 'Every finance action, who took it and when.'),
      section('settings', 'acc-settings', 'settings', 'Settings', 'The cash points and the council\'s income list used at the counter.'),
      { path: 'messages', name: 'acc-messages', component: () => import('../shared/MessagesPage.vue'), meta: { cwTitle: 'Messages', cwNav: 'acc-dashboard', cwCrumbs: crumbs('Messages') } },
    ],
  },
]

registerWorkspace({
  key: 'accountant',
  routes,
  home: 'acc-dashboard',
  serves: {
    ledger: 'acc-journals',
    'ledger.periods': 'acc-close',
    'ledger.chart': 'acc-ledger',
    'ledger.vouchers': 'acc-journals',
    statements: 'acc-reports',
    'statements.trial-balance': 'acc-trial',
    'statements.position': 'acc-reports',
    'statements.performance': 'acc-reports',
    'statements.ageing': 'acc-receivable',
    'cash.banking': 'acc-banking',
    'cash.setup': 'acc-settings',
  },
})
