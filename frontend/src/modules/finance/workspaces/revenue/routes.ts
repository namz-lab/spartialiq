/**
 * Revenue and Rates, `/finance/revenue`: the revenue officer's workspace. Property rates from the
 * valuation roll to the bill, the receipt and the arrears, and the council's counter charges. Each
 * page is the rates screen opened on its part, so the billing controls stay in one place.
 */
import type { RouteRecordRaw } from 'vue-router'
import { FileText, HandCoins, Users, Clock, Percent, ChartColumn, SlidersHorizontal } from 'lucide-vue-next'
import { registerWorkspace } from '../../shell/workspaces'
import { routeKit } from '../shared/routeKit'

const k = routeKit('Revenue Officer', 'rev-dashboard')

const routes: RouteRecordRaw[] = [
  {
    path: '/finance/revenue',
    component: () => import('./RevenueLayout.vue'),
    meta: { title: 'Revenue and Rates - Vungu Rural District Council' },
    children: [
      { path: '', name: 'rev-dashboard', component: () => import('./pages/RevenueDashboard.vue'), meta: { cwTitle: 'Dashboard' } },
      k.section('billing', 'rev-billing', 'rates', 'Billing & Invoicing', 'Preview a billing period, raise it, and have it committed by somebody else. Each committed run issues the bills.', FileText, { props: { initialTab: 'billing' } }),
      k.section('collections', 'rev-collections', 'rates', 'Collections', 'Payments received on rates accounts and what each settled.', HandCoins, { props: { initialTab: 'receipts' } }),
      k.section('accounts', 'rev-accounts', 'rates', 'Customer Accounts', 'Each property and its ratepayer of record.', Users, { props: { initialTab: 'accounts' } }),
      k.section('arrears', 'rev-arrears', 'rates', 'Arrears Management', 'Who owes, for how long, and the control account they sit in.', Clock, { props: { initialTab: 'arrears' } }),
      k.section('rates', 'rev-rates', 'rates', 'Rates & Levies', 'The rate in the dollar for each property category, approved by council resolution.', Percent, { props: { initialTab: 'tariffs' } }),
      k.page('service-charges', 'rev-charges', 'Service Charges', () => import('./pages/ServiceCharges.vue')),
      k.section('reports', 'rev-reports', 'reports', 'Revenue Reports', 'Revenue and arrears reports, ready to export.', ChartColumn),
      k.notBuilt('adjustments', 'rev-adjust', 'Apply Adjustment', 'Credit notes and write-offs on a rates account.', SlidersHorizontal,
        'A rates adjustment is a credit note or a write-off voucher in the ledger. The ledger can hold both, but there is no screen yet that raises one from a rates account; until there is, the accountant raises it as a voucher against the account and posts it.',
        [{ name: 'rev-arrears', label: 'Arrears by account' }, { name: 'rev-accounts', label: 'Customer Accounts' }]),
      { ...k.messages('rev-messages'), meta: { cwTitle: 'Notifications', cwCrumbs: [{ label: 'Revenue Officer', to: 'rev-dashboard' }, { label: 'Notifications' }] } },
    ],
  },
]

registerWorkspace({
  key: 'revenue',
  routes,
  home: 'rev-dashboard',
  serves: { rates: 'rev-billing' },
})
