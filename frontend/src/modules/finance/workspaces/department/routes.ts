/**
 * Department Finance, `/finance/department`: a head of department's workspace, confined to the
 * department(s) recorded for them (finance.user_scope). The server applies that scope on every read
 * and write. A head with no department recorded is NOT scoped on the server, so every page that reads
 * budget data is wrapped in the scope gate (`scoped()`): it says no votes are assigned and makes no
 * request, rather than showing the whole council.
 */
import type { RouteRecordRaw } from 'vue-router'
import { Wallet, FileSignature, FolderKanban, ChartColumn, FolderOpen, ArrowLeftRight } from 'lucide-vue-next'
import { registerWorkspace } from '../../shell/workspaces'
import { routeKit, type SectionOptions } from '../shared/routeKit'
import type { Component } from 'vue'
import { scoped } from './scoped'

const k = routeKit('Department Head', 'dep-dashboard')
const STATES = [
  { value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Submitted' },
  { value: 'returned', label: 'Returned' }, { value: 'approved', label: 'Approved' },
]
const REVISION_STATES = [
  { value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' },
]

const ScopedSection = scoped(() => import('../shared/SectionPage.vue'))
/** A console screen, behind the scope gate. */
const section = (path: string, name: string, embed: string, title: string, lead: string, icon: Component, o: SectionOptions = {}): RouteRecordRaw =>
  ({ ...k.section(path, name, embed, title, lead, icon, o), component: ScopedSection }) as RouteRecordRaw

export const departmentRoutes: RouteRecordRaw[] = [
  {
    path: '/finance/department',
    component: () => import('./DepartmentLayout.vue'),
    meta: { title: 'Department Finance - Vungu Rural District Council' },
    children: [
      { path: 'property-map', name: 'dep-gis', component: () => import('../shared/PropertyGisPage.vue'), meta: { cwTitle: 'Property Map', gisMode: 'department', cwCrumbs: [{ label: 'Department Head', to: 'dep-dashboard' }, { label: 'Property Map' }] } },
      { path: '', name: 'dep-dashboard', component: () => import('./pages/DepartmentDashboard.vue'), meta: { cwTitle: 'Dashboard' } },
      section('budget', 'dep-budget', 'budget', 'Department Budget',
        'Your department\'s budget requests: prepare lines, submit them, and revise the ones returned. Approval is the committee\'s, and the state of each line is shown here.',
        Wallet, { states: STATES }),
      section('revisions', 'dep-revisions', 'revisions', 'Budget Revisions',
        'Ask for a change to an approved line: a supplementary allocation or a reduction. To move money between two of your lines, raise a reduction on one and a matching supplementary on the other. Approval is somebody else\'s.',
        ArrowLeftRight, { states: REVISION_STATES, stateParam: 'state' }),
      k.page('commitments', 'dep-commitments', 'Commitments (PR/PO)', scoped(() => import('../budget/pages/CommitmentsPage.vue'))),
      k.page('expenditure', 'dep-expenditure', 'Budget vs Actual', scoped(() => import('../budget/pages/BudgetMonitoring.vue')), {
        bmKind: 'expenditure', bmTitle: 'Budget vs Actual',
        bmLead: 'Each of your spending lines against its budget: spent, committed and still available.',
      }),
      k.page('variance', 'dep-variance', 'Variance Explanations', scoped(() => import('../budget/pages/VariancePage.vue'))),
      k.notBuilt('requisitions', 'dep-requisitions', 'Requisitions', 'Purchase requisitions raised by the department.', FileSignature,
        'Requisitions are raised in the council\'s procurement system, not here. Once a purchase order is issued it arrives as a commitment against your budget line through the commitments import.',
        [{ name: 'dep-commitments', label: 'Commitments (PR/PO)' }, { name: 'dep-expenditure', label: 'Budget vs Actual' }]),
      section('projects', 'dep-projects', 'projects', 'Projects', 'Your department\'s capital projects, their budgets and progress.', FolderKanban),
      k.page('performance', 'dep-performance', 'Performance (KPIs)', scoped(() => import('./pages/DepartmentPerformance.vue'))),
      section('reports', 'dep-reports', 'reports', 'Reports', 'Budget reports for your department, to read on screen.', ChartColumn),
      section('documents', 'dep-documents', 'documents', 'Documents', 'Supporting documents for your department\'s budget and projects.', FolderOpen),
      k.messages('dep-messages'),
    ],
  },
]

registerWorkspace({
  key: 'department',
  routes: departmentRoutes,
  home: 'dep-dashboard',
  serves: { budget: 'dep-budget', revisions: 'dep-revisions', projects: 'dep-projects', reports: 'dep-reports', documents: 'dep-documents' },
})
