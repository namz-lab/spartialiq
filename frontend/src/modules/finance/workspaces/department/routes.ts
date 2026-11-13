/**
 * Department Finance, `/finance/department`: a head of department's workspace, confined to the
 * department(s) recorded for them (finance.user_scope). The server applies that scope on every read;
 * a head with no department recorded sees nothing rather than the whole council.
 */
import type { RouteRecordRaw } from 'vue-router'
import { Wallet, FileSignature, FolderKanban, ChartColumn, FolderOpen, ArrowLeftRight } from 'lucide-vue-next'
import { registerWorkspace } from '../../shell/workspaces'
import { routeKit } from '../shared/routeKit'

const k = routeKit('Department Head', 'dep-dashboard')
const STATES = [
  { value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Submitted' },
  { value: 'returned', label: 'Returned' }, { value: 'approved', label: 'Approved' },
]

const routes: RouteRecordRaw[] = [
  {
    path: '/finance/department',
    component: () => import('./DepartmentLayout.vue'),
    meta: { title: 'Department Finance - Vungu Rural District Council' },
    children: [
      { path: '', name: 'dep-dashboard', component: () => import('./pages/DepartmentDashboard.vue'), meta: { cwTitle: 'Dashboard' } },
      k.section('budget', 'dep-budget', 'budget', 'Department Budget', 'Your department\'s budget lines: prepare and submit them, and revise the ones returned. Approval is somebody else\'s.', Wallet, { states: STATES }),
      k.page('commitments', 'dep-commitments', 'Commitments (PR/PO)', () => import('../budget/pages/CommitmentsPage.vue')),
      k.page('expenditure', 'dep-expenditure', 'Expenditure', () => import('../budget/pages/BudgetMonitoring.vue')),
      k.notBuilt('requisitions', 'dep-requisitions', 'Requisitions', 'Purchase requisitions raised by the department.', FileSignature,
        'Requisitions are raised in the council\'s procurement system, not here. Once a purchase order is issued it arrives as a commitment against your budget line through the commitments import.',
        [{ name: 'dep-commitments', label: 'Commitments (PR/PO)' }, { name: 'dep-expenditure', label: 'Expenditure' }]),
      k.section('projects', 'dep-projects', 'projects', 'Projects', 'Your department\'s capital projects, their budgets and progress.', FolderKanban),
      k.page('performance', 'dep-performance', 'Performance (KPIs)', () => import('./pages/DepartmentPerformance.vue')),
      k.section('reports', 'dep-reports', 'reports', 'Reports', 'Budget reports for your department, ready to export.', ChartColumn),
      k.section('documents', 'dep-documents', 'documents', 'Documents', 'Supporting documents for your department\'s budget and projects.', FolderOpen),
      k.section('revisions', 'dep-revisions', 'revisions', 'Budget Revisions', 'Changes to an approved line: prepare and submit them; approval is somebody else\'s.', ArrowLeftRight, { states: [
        { value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Submitted' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' },
      ], stateParam: 'state' }),
      k.messages('dep-messages'),
    ],
  },
]

registerWorkspace({
  key: 'department',
  routes,
  home: 'dep-dashboard',
  serves: { budget: 'dep-budget', revisions: 'dep-revisions', projects: 'dep-projects', reports: 'dep-reports', documents: 'dep-documents' },
})
