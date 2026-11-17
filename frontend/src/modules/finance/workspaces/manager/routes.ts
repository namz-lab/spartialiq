/**
 * Finance Management, `/finance/manager`: the finance director's (finance administrator's)
 * workspace. Management, not processing: the council's financial position, what is waiting for a
 * decision and what is out of line, the statutory statements, then the configuration of the finance
 * system (years and periods, chart, classifications, approval rules, imports) and its oversight
 * (audit trail, documents, roles, health). Desk work is reached through the workspace switcher.
 * Who may open it is the server's answer on `/api/finance/me`; every request is still authorised.
 */
import type { RouteRecordRaw } from 'vue-router'
import {
  Users, KeyRound, Workflow, BookOpen, CalendarRange, PlugZap, ShieldCheck, Shapes, FileStack, ChartColumn, FolderOpen,
} from 'lucide-vue-next'
import { registerWorkspace } from '../../shell/workspaces'
import { routeKit } from '../shared/routeKit'

const k = routeKit('Finance Admin', 'mgr-dashboard')

const routes: RouteRecordRaw[] = [
  {
    path: '/finance/manager',
    component: () => import('./ManagerLayout.vue'),
    meta: { title: 'Finance Management - Vungu Rural District Council' },
    children: [
      { path: '', name: 'mgr-dashboard', component: () => import('./pages/ManagerDashboard.vue'), meta: { cwTitle: 'Dashboard' } },
      k.page('position', 'mgr-position', 'Financial Position', () => import('./pages/FinancialPosition.vue')),
      k.page('approvals', 'mgr-approvals', 'Approvals', () => import('./pages/ApprovalsInbox.vue')),
      k.page('exceptions', 'mgr-exceptions', 'Exceptions', () => import('./pages/ExceptionsPage.vue')),
      k.section('statements', 'mgr-statements', 'statements', 'Statements', 'The statutory statements from the posted ledger: trial balance, financial position, financial performance and debtor ageing, one currency at a time.', FileStack, { needs: 'finance.ledger.view' }),
      k.section('reports', 'mgr-reports', 'reports', 'Reports', 'Budget against actual, variance, departmental and project reports, ready to export for council and the Auditor-General.', ChartColumn, { needs: 'finance.report.view' }),
      k.section('documents', 'mgr-documents', 'documents', 'Documents', 'The evidence behind the figures: budget books, minutes, statements and import files, with who may see each.', FolderOpen),
      k.section('users', 'mgr-users', 'access', 'Users & Roles', 'Who holds which finance role, and the personal adjustments to it.', Users, {
        needs: 'finance.users.manage_finance_roles',
        denied: 'Finance roles are granted by the system administrator (Finance Access Administration), so that the person who configures finance does not also decide who holds it. The roles themselves and what each may do are under Permissions.',
      }),
      k.section('permissions', 'mgr-permissions', 'permissions', 'Permissions', 'What each finance role may do, and which duties are kept apart.', KeyRound),
      k.section('workflow', 'mgr-workflow', 'settings', 'Workflow Setup', 'Approval thresholds, separation of duties and the other finance rules.', Workflow),
      k.section('chart', 'mgr-chart', 'ledger', 'Chart of Accounts', 'The ledger accounts every voucher posts to, and their balances.', BookOpen, { props: { only: 'chart' } }),
      k.section('periods', 'mgr-periods', 'years', 'Financial Periods', 'Open, close and reopen financial years.', CalendarRange),
      k.section('integration', 'mgr-integration', 'imports', 'System Integration', 'Data brought in from the council\'s other systems: upload, validate, reconcile and commit.', PlugZap),
      k.section('audit', 'mgr-audit', 'audit', 'Audit Logs', 'Every finance action, who took it and when, including refused attempts.', ShieldCheck, { needs: 'finance.audit.view' }),
      k.page('health', 'mgr-health', 'System Health', () => import('./pages/SystemHealth.vue')),
      k.section('settings', 'mgr-settings', 'classifications', 'Classifications', 'Departments (votes), programmes, activities and budget accounts.', Shapes),
      k.messages('mgr-messages'),
    ],
  },
]

registerWorkspace({
  key: 'manager',
  routes,
  home: 'mgr-dashboard',
  serves: {
    years: 'mgr-periods',
    classifications: 'mgr-settings',
    'classifications.departments': 'mgr-settings',
    'classifications.programmes': 'mgr-settings',
    'classifications.activities': 'mgr-settings',
    'classifications.accounts': 'mgr-settings',
    settings: 'mgr-workflow',
    imports: 'mgr-integration',
    audit: 'mgr-audit',
    permissions: 'mgr-permissions',
    access: 'mgr-users',
    statements: 'mgr-statements',
    reports: 'mgr-reports',
    documents: 'mgr-documents',
  },
})
