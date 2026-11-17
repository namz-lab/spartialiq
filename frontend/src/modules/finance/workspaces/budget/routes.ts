/**
 * The Budget Management workspace, `/finance/budget` (spec 2026-11-12-finance-role-workspaces-design.md).
 *
 * Importing this file (from `workspaces/index.ts`) registers it. Who may open it is the server's
 * answer on `/api/finance/me`; every request on every page is still authorised by the backend.
 *
 * Pages built on a console screen (budget lines, revisions, reports, projects, map, documents) go
 * through the shared SectionPage so each control has one implementation; the rest are this
 * workspace's own.
 */
import type { RouteRecordRaw } from 'vue-router'
import { ClipboardList, ClipboardCheck, ArrowLeftRight, ChartColumn, FolderKanban, Map as MapIcon, FolderOpen } from 'lucide-vue-next'
import { registerWorkspace } from '../../shell/workspaces'
import { routeKit } from '../shared/routeKit'

const k = routeKit('Budget Officer', 'bud-dashboard')

/** Budget-line workflow states, as the line register filters them (`?status=`). */
export const LINE_STATES = [
  { value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Pending approval' },
  { value: 'returned', label: 'Returned for revision' }, { value: 'approved', label: 'Approved' },
]
/** Revision states, as the revision register filters them (`?state=`). */
export const REVISION_STATES = [
  { value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Awaiting approval' },
  { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' },
]

const Monitoring = () => import('./pages/BudgetMonitoring.vue')
const Programmes = () => import('./pages/ProgrammesPage.vue')

export const budgetRoutes: RouteRecordRaw[] = [
  {
    path: '/finance/budget',
    component: () => import('./BudgetLayout.vue'),
    meta: { title: 'Budget Management - Vungu Rural District Council' },
    children: [
      { path: 'property-map', name: 'bud-gis', component: () => import('../shared/PropertyGisPage.vue'), meta: { cwTitle: 'Property Map', gisMode: 'budget', cwCrumbs: [{ label: 'Budget Officer', to: 'bud-dashboard' }, { label: 'Property Map' }] } },
      { path: '', name: 'bud-dashboard', component: () => import('./pages/BudgetDashboard.vue'), meta: { cwTitle: 'Dashboard' } },

      // Preparation
      k.section('planning', 'bud-planning', 'budget', 'Budget Planning',
        'Prepare the year\'s budget lines by vote, programme and account, recurrent and capital, spending and revenue, and submit them for approval.', ClipboardList),
      k.section('approval', 'bud-approval', 'budget', 'Approval Status',
        'Where each budget line stands: draft, pending approval, returned or approved. Approval is the committee\'s; nobody approves their own submission.',
        ClipboardCheck, { states: LINE_STATES, stateDefault: 'submitted' }),
      k.page('preparation', 'bud-preparation', 'Preparation by Vote', () => import('./pages/PreparationPage.vue')),

      // Execution
      k.page('monitoring', 'bud-monitoring', 'Budget Monitoring', Monitoring, { bmKind: 'expenditure' }),
      k.page('revenue', 'bud-revenue', 'Revenue Estimates', Monitoring, { bmKind: 'revenue' }),
      k.page('commitments', 'bud-commitments', 'Commitments (Encumbrances)', () => import('./pages/CommitmentsPage.vue')),
      k.page('variance', 'bud-variance', 'Variance Explanations', () => import('./pages/VariancePage.vue')),
      k.section('virements', 'bud-virements', 'revisions', 'Virements & Revisions',
        'Change an approved line through a revision: a supplementary allocation or a reduction. A virement between lines is recorded today as a reduction on one line and a matching supplementary on the other, each approved on its own.',
        ArrowLeftRight, { states: REVISION_STATES, stateParam: 'state' }),

      // Structure
      k.page('programmes', 'bud-programmes', 'Programmes & Votes', Programmes),
      k.section('projects', 'bud-projects', 'projects', 'Project Budgets', 'Capital projects, their approved budgets and what has been allocated and spent.', FolderKanban),
      k.section('map', 'bud-map', 'map', 'Allocation by Ward', 'Where the budget is allocated and spent, ward by ward.', MapIcon, { needs: 'finance.map.view' }),

      // Reporting
      k.section('reports', 'bud-reports', 'reports', 'Budget Reports', 'Budget performance reports, ready to read on screen or export.', ChartColumn),
      k.page('submission', 'bud-submission', 'Council Submission Pack', () => import('./pages/SubmissionPack.vue')),
      k.page('kpis', 'bud-kpis', 'Performance & KPIs', Programmes),
      k.section('documents', 'bud-documents', 'documents', 'Documents', 'Supporting documents for budget lines, revisions and projects.', FolderOpen, { needs: 'finance.document.view' }),

      // Control
      k.page('settings', 'bud-settings', 'Budget Settings', () => import('./pages/BudgetSettings.vue')),
      k.messages('bud-messages'),
    ],
  },
]

registerWorkspace({
  key: 'budget',
  routes: budgetRoutes,
  home: 'bud-dashboard',
  serves: {
    budget: 'bud-planning',
    revisions: 'bud-virements',
    projects: 'bud-projects',
    reports: 'bud-reports',
    map: 'bud-map',
    documents: 'bud-documents',
  },
})
