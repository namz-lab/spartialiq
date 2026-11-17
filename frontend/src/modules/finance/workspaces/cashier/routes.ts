/**
 * The Cash Office workspace, `/finance/cashier` (spec 2026-11-12-cashier-workspace-design.md §12).
 *
 * Importing this file (from `workspaces/index.ts`) registers it. Who may open it is the server's
 * answer on `/api/finance/me`; every request on every page is still authorised by the backend.
 */
import type { RouteRecordRaw } from 'vue-router'
import { registerWorkspace } from '../../shell/workspaces'
import { useFinanceStore } from '../../stores/finance'

/**
 * A cash supervisor takes no money, so the cashier's dashboard has nothing of theirs on it; they
 * land on the drawers board instead. Anyone who can work a till keeps the dashboard.
 */
export function supervisorLanding(): { name: string } | true {
  const store = useFinanceStore()
  if (!store.identity) return true
  const tills = store.can('finance.cash.session.operate') || store.can('finance.cash.receipt.record')
  if (tills) return true
  if (store.can('finance.cash.session.supervise') || store.can('finance.cash.assignment.manage')) return { name: 'cashier-drawers' }
  if (store.can('finance.cash.session.verify')) return { name: 'cashier-verify' }
  return true
}

const crumbs = (...items: { label: string; to?: string }[]) => [{ label: 'Cashier', to: 'cashier-dashboard' }, ...items]

const routes: RouteRecordRaw[] = [
  {
    path: '/finance/cashier',
    component: () => import('./CashierLayout.vue'),
    meta: { title: 'Cash Office - Vungu Rural District Council' },
    children: [
      { path: 'property-map', name: 'cashier-gis', component: () => import('../shared/PropertyGisPage.vue'), meta: { cwTitle: 'Find Property', gisMode: 'cashier', cwCrumbs: [{ label: 'Cashier', to: 'cashier-dashboard' }, { label: 'Find Property' }] } },
      {
        path: '', name: 'cashier-dashboard', component: () => import('./pages/CashierDashboard.vue'), meta: { cwTitle: 'Dashboard' },
        beforeEnter: supervisorLanding,
      },
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
        path: 'banking', name: 'cashier-banking', component: () => import('./pages/OfficePage.vue'),
        meta: {
          cwOffice: 'banking', cwTitle: 'Banking',
          cwLead: 'What each till holds in the book, and the deposit slip that carries it to the bank. The accountant posts it.',
          cwCrumbs: crumbs({ label: 'Banking' }),
        },
      },
      {
        path: 'drawers', name: 'cashier-drawers', component: () => import('./pages/OfficePage.vue'),
        meta: {
          cwOffice: 'drawers', cwTitle: 'Drawers',
          cwLead: 'Every cash point, who holds it and since when. A drawer left open is counted with a witness; nothing frees it without a count.',
          cwCrumbs: crumbs({ label: 'Drawers' }),
        },
      },
      {
        path: 'verify', name: 'cashier-verify', component: () => import('./pages/OfficePage.vue'),
        meta: {
          cwOffice: 'cashups', cwTitle: 'Cash-ups to Verify',
          cwLead: 'Counted sessions waiting for a second person. Verifying a cash-up posts its difference; your own is refused.',
          cwCrumbs: crumbs({ label: 'Cash-ups to Verify' }),
        },
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
    'cash.banking': 'cashier-banking',
  },
})
