/**
 * The Budget Management workspace, `/finance/budget` (spec 2026-11-12-finance-role-workspaces-design.md).
 *
 * Importing this file (from `workspaces/index.ts`) registers it. Who may open it is the server's
 * answer on `/api/finance/me`; every request on every page is still authorised by the backend.
 */
import type { RouteRecordRaw } from 'vue-router'
import { registerWorkspace } from '../../shell/workspaces'

const crumbs = (label: string) => [{ label: 'Budget Officer', to: 'bud-dashboard' }, { label }]
const Section = () => import('./pages/BudgetSectionPage.vue')
const section = (path: string, name: string, key: string, title: string, lead: string): RouteRecordRaw => ({
  path, name, component: Section, meta: { cwSection: key, cwTitle: title, cwLead: lead, cwCrumbs: crumbs(title) },
})
const page = (path: string, name: string, title: string, component: RouteRecordRaw['component']): RouteRecordRaw =>
  ({ path, name, component, meta: { cwTitle: title, cwCrumbs: crumbs(title) } }) as RouteRecordRaw

const routes: RouteRecordRaw[] = [
  {
    path: '/finance/budget',
    component: () => import('./BudgetLayout.vue'),
    meta: { title: 'Budget Management - Vungu Rural District Council' },
    children: [
      { path: '', name: 'bud-dashboard', component: () => import('./pages/BudgetDashboard.vue'), meta: { cwTitle: 'Dashboard' } },
      section('planning', 'bud-planning', 'planning', 'Budget Planning', 'Prepare budget lines for the year and submit them for approval.'),
      section('approval', 'bud-approval', 'approval', 'Budget Approval', 'Where each budget line stands: draft, pending approval, returned or approved. An approver never approves their own submission.'),
      page('monitoring', 'bud-monitoring', 'Budget Monitoring', () => import('./pages/BudgetMonitoring.vue')),
      section('virements', 'bud-virements', 'virements', 'Virements & Adjustments', 'Change an approved budget through a revision: a supplementary allocation, a reduction, or a pair that moves money between lines.'),
      page('commitments', 'bud-commitments', 'Commitments (Encumbrances)', () => import('./pages/CommitmentsPage.vue')),
      section('reports', 'bud-reports', 'reports', 'Budget Reports', 'Budget performance reports, ready to export.'),
      page('programmes', 'bud-programmes', 'Programme / Cost Centres', () => import('./pages/ProgrammesPage.vue')),
      section('projects', 'bud-projects', 'projects', 'Project Budgets', 'Capital projects, their approved budgets and what has been allocated and spent.'),
      page('kpis', 'bud-kpis', 'Performance & KPIs', () => import('./pages/ProgrammesPage.vue')),
      page('settings', 'bud-settings', 'Budget Settings', () => import('./pages/BudgetSettings.vue')),
      { path: 'messages', name: 'bud-messages', component: () => import('../shared/MessagesPage.vue'), meta: { cwTitle: 'Messages', cwNav: 'bud-dashboard', cwCrumbs: crumbs('Messages') } },
    ],
  },
]

registerWorkspace({
  key: 'budget',
  routes,
  home: 'bud-dashboard',
  serves: {
    budget: 'bud-planning',
    revisions: 'bud-virements',
    projects: 'bud-projects',
    reports: 'bud-reports',
  },
})
