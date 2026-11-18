/**
 * Revenue and Rates, `/finance/revenue`: the revenue officer's workspace. Property rates from the
 * valuation roll to the bill, the receipt and the arrears, and the council's counter charges. Each
 * page is the rates screen opened on its part, so the billing controls stay in one place.
 */
import type { RouteRecordRaw } from 'vue-router'
import { FileText, HandCoins, Users, Clock, Percent, ChartColumn, SlidersHorizontal, Landmark, BadgeCheck, TrendingUp } from 'lucide-vue-next'
import { registerWorkspace } from '../../shell/workspaces'
import { routeKit } from '../shared/routeKit'

const k = routeKit('Revenue Officer', 'rev-dashboard')

const routes: RouteRecordRaw[] = [
  {
    path: '/finance/revenue',
    component: () => import('./RevenueLayout.vue'),
    meta: { title: 'Revenue and Rates - Vungu Rural District Council' },
    children: [
      { path: 'property-map', name: 'rev-gis', component: () => import('../shared/PropertyGisPage.vue'), meta: { cwTitle: 'Property Map', gisMode: 'revenue', cwCrumbs: [{ label: 'Revenue Officer', to: 'rev-dashboard' }, { label: 'Property Map' }] } },
      { path: '', name: 'rev-dashboard', component: () => import('./pages/RevenueDashboard.vue'), meta: { cwTitle: 'Dashboard' } },
      k.section('billing', 'rev-billing', 'rates', 'Billing & Invoicing', 'Preview a billing period, raise it, and have it committed by somebody else. Each committed run issues the bills.', FileText, { props: { initialTab: 'billing' } }),
      k.page('bills', 'rev-bills', 'Bills Register', () => import('./pages/BillsRegister.vue')),
      k.section('collections', 'rev-collections', 'rates', 'Collections', 'Payments received on rates accounts and what each settled.', HandCoins, { props: { initialTab: 'receipts' } }),
      k.section('accounts', 'rev-accounts', 'rates', 'Customer Accounts', 'Each property and its ratepayer of record.', Users, { props: { initialTab: 'accounts' } }),
      k.section('arrears', 'rev-arrears', 'rates', 'Arrears Management', 'Who owes, for how long, and the control account they sit in.', Clock, { props: { initialTab: 'arrears' } }),
      k.page('collection-list', 'rev-collection', 'Collection List', () => import('./pages/CollectionList.vue')),
      k.page('statements/:id?', 'rev-statement', 'Statements', () => import('./pages/AccountStatement.vue')),
      k.section('roll', 'rev-roll', 'rates', 'Valuation Roll', 'The rateable value of each property, as entered and as it stands for billing. A value changes the next bill, never one already issued.', Landmark, { props: { initialTab: 'roll' } }),
      k.section('rates', 'rev-rates', 'rates', 'Rates & Levies', 'The rate in the dollar for each property category, approved by council resolution.', Percent, { props: { initialTab: 'tariffs' } }),
      k.page('service-charges', 'rev-charges', 'Service Charges', () => import('./pages/ServiceCharges.vue')),
      k.page('planning-fees', 'rev-planning-fees', 'Planning Fees', () => import('./pages/PlanningFees.vue')),
      k.section('reports', 'rev-reports', 'reports', 'Revenue Reports', 'Revenue and arrears reports, ready to export.', ChartColumn),
      k.notBuilt('adjustments', 'rev-adjust', 'Apply Adjustment', 'Credit notes and write-offs on a rates account.', SlidersHorizontal,
        'A rates adjustment is a credit note or a write-off voucher in the ledger. The ledger can hold both, but there is no screen yet that raises one from a rates account; until there is, the accountant raises it as a voucher against the account and posts it.',
        [{ name: 'rev-arrears', label: 'Arrears by account' }, { name: 'rev-accounts', label: 'Customer Accounts' }]),
      k.notBuilt('interest', 'rev-interest', 'Interest on Arrears', 'Interest charged on overdue rates at the rate council resolves.', TrendingUp,
        'Interest on arrears needs a resolved rate, a rule for which bills it runs on, and a run that raises it as a charge the way a billing run raises bills. The backend has none of these yet, so no interest is charged from here.',
        [{ name: 'rev-collection', label: 'Collection List' }]),
      k.notBuilt('clearance', 'rev-clearance', 'Clearance Certificates', 'A certificate that a property owes the council nothing, for a transfer.', BadgeCheck,
        'A rates clearance certificate is issued against a paid-up account and numbered from its own series. The backend has no certificate yet; until it does, the account statement shows whether anything is owed.',
        [{ name: 'rev-statement', label: 'Statements' }]),
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
