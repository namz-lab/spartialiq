/**
 * Executive Finance, `/finance/accounting` (the workspace key is the address): the chief executive's view as
 * accounting officer. The whole financial position, read-only: no act here changes a figure, and
 * every approval stays with the person whose duty it is.
 */
import type { RouteRecordRaw } from 'vue-router'
import { LayoutDashboard, TrendingUp, FolderKanban, MapPinned, ChartColumn, Receipt, Scale, Hourglass, ShieldCheck } from 'lucide-vue-next'
import { registerWorkspace } from '../../shell/workspaces'
import { routeKit } from '../shared/routeKit'

const k = routeKit('Chief Executive Officer', 'exe-dashboard')
const Kind = () => import('./pages/KindOverview.vue')

const routes: RouteRecordRaw[] = [
  {
    path: '/finance/accounting',
    component: () => import('./ExecutiveLayout.vue'),
    meta: { title: 'Executive Finance - Vungu Rural District Council' },
    children: [
      { path: 'property-map', name: 'exe-gis', component: () => import('../shared/PropertyGisPage.vue'), meta: { cwTitle: 'Property Map', gisMode: 'executive', cwCrumbs: [{ label: 'Chief Executive Officer', to: 'exe-dashboard' }, { label: 'Property Map' }] } },
      { path: '', name: 'exe-dashboard', component: () => import('./pages/ExecutiveDashboard.vue'), meta: { cwTitle: 'Dashboard' } },
      k.section('overview', 'exe-overview', 'overview', 'Executive Overview', 'The year\'s position period by period, and what may need your attention.', LayoutDashboard),
      k.section('performance', 'exe-performance', 'statements', 'Financial Performance', 'The statement of financial performance from the posted ledger, per currency.', TrendingUp, { props: { initialTab: 'performance' } }),
      k.section('position', 'exe-position', 'statements', 'Financial Position', 'The statement of financial position from the posted ledger, per currency. Exportable.', Scale, { props: { initialTab: 'position' } }),
      k.section('debtors', 'exe-ageing', 'statements', 'Debtors by Age', 'What ratepayers and other debtors owe, by how long it has been outstanding, reconciled to the control account.', Hourglass, { props: { initialTab: 'ageing' } }),
      k.page('cash', 'exe-cash', 'Cash and Bank', () => import('./pages/CashPosition.vue')),
      k.page('revenue', 'exe-revenue', 'Revenue Overview', Kind, { cwKind: 'revenue' }),
      k.page('expenditure', 'exe-expenditure', 'Expenditure Overview', Kind, { cwKind: 'expenditure' }),
      k.section('projects', 'exe-projects', 'projects', 'Projects & Capital', 'Capital projects: approved budgets, allocations, spending and physical progress.', FolderKanban),
      k.section('service-delivery', 'exe-service', 'map', 'Service Delivery', 'Where the money is going, ward by ward, and the projects on the ground.', MapPinned),
      k.page('departments', 'exe-departments', 'Department Performance', () => import('./pages/DepartmentPerformance.vue')),
      k.section('reports', 'exe-reports', 'reports', 'Reports & Briefs', 'Budget and financial reports, ready to export for council and committee.', ChartColumn),
      k.section('payments', 'exe-payments', 'ledger', 'Payments and Vouchers', 'Every voucher in the ledger, read-only. Payments are prepared by finance and posted by somebody other than the preparer.', Receipt, { props: { only: 'vouchers' } }),
      k.section('trail', 'exe-trail', 'audit', 'Audit Trail', 'Every finance action, who took it and when, including refused attempts. Read-only.', ShieldCheck, { needs: 'finance.audit.view' }),
      k.messages('exe-messages'),
    ],
  },
]

registerWorkspace({
  key: 'accounting',
  routes,
  home: 'exe-dashboard',
  serves: {
    overview: 'exe-overview',
    map: 'exe-service',
    'statements.performance': 'exe-performance',
    'statements.position': 'exe-position',
    'statements.ageing': 'exe-ageing',
    audit: 'exe-trail',
    projects: 'exe-projects',
    reports: 'exe-reports',
  },
})
