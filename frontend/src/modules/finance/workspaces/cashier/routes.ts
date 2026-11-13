/**
 * The Cash Office workspace, `/finance/cashier` (spec 2026-11-12-cashier-workspace-design.md §12).
 *
 * Importing this file (from `workspaces/index.ts`) registers it. Who may open it is the server's
 * answer on `/api/finance/me`; every request on every page is still authorised by the backend.
 */
import type { RouteRecordRaw } from 'vue-router'
import { registerWorkspace } from '../../shell/workspaces'

const crumbs = (...items: { label: string; to?: string }[]) => [{ label: 'Cashier', to: 'cashier-dashboard' }, ...items]

const routes: RouteRecordRaw[] = [
  {
    path: '/finance/cashier',
    component: () => import('./CashierLayout.vue'),
    meta: { title: 'Cash Office - Vungu Rural District Council' },
    children: [
      { path: '', name: 'cashier-dashboard', component: () => import('./pages/CashierDashboard.vue'), meta: { cwTitle: 'Dashboard' } },
      {
        path: 'take-payment', name: 'cashier-pay', component: () => import('./pages/TakePayment.vue'),
        meta: { cwTitle: 'Take Payment', cwCrumbs: crumbs({ label: 'Take Payment' }) },
      },
      {
        path: 'issue-receipt', name: 'cashier-issue', component: () => import('./pages/IssueReceipt.vue'),
        meta: { cwTitle: 'Issue Receipt', cwNav: 'cashier-pay', cwCrumbs: crumbs({ label: 'Issue Receipt' }) },
      },
      {
        path: 'receipts', name: 'cashier-receipts', component: () => import('./pages/ReceiptsPage.vue'),
        meta: { cwTitle: 'Receipts', cwCrumbs: crumbs({ label: 'Receipts' }) },
      },
      {
        path: 'customers', name: 'cashier-customers', component: () => import('./pages/CustomerAccounts.vue'),
        meta: { cwTitle: 'Customer Accounts', cwCrumbs: crumbs({ label: 'Customer Accounts' }) },
      },
      {
        path: 'bills', name: 'cashier-bills', component: () => import('./pages/BillEnquiries.vue'),
        meta: { cwTitle: 'Bill Enquiries', cwCrumbs: crumbs({ label: 'Bill Enquiries' }) },
      },
      {
        path: 'cash-up', name: 'cashier-cashup', component: () => import('./pages/DailyCashUp.vue'),
        meta: { cwTitle: 'Daily Cash Up', cwCrumbs: crumbs({ label: 'Daily Cash Up' }) },
      },
      {
        path: 'reports', name: 'cashier-reports', component: () => import('./pages/CashierReports.vue'),
        meta: { cwTitle: 'Reports', cwCrumbs: crumbs({ label: 'Reports' }) },
      },
      {
        path: 'messages', name: 'cashier-messages', component: () => import('../shared/MessagesPage.vue'),
        meta: { cwTitle: 'Messages', cwCrumbs: crumbs({ label: 'Messages' }) },
      },
      {
        path: 'help', name: 'cashier-help', component: () => import('./pages/HelpPage.vue'),
        meta: { cwTitle: 'Help & Support', cwCrumbs: crumbs({ label: 'Help & Support' }) },
      },
    ],
  },
]

registerWorkspace({
  key: 'cashier',
  routes,
  home: 'cashier-dashboard',
  serves: {
    cash: 'cashier-dashboard',
    'cash.counter': 'cashier-pay',
    'cash.sessions': 'cashier-cashup',
  },
})
