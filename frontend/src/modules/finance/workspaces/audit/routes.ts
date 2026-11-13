/**
 * Internal Audit, `/finance/audit`: the internal auditor's workspace. The audit plan and its
 * findings (migration 210) are the auditor's own record; the finance audit trail, documents and
 * reports are read-only here. Nothing in this workspace changes a finance figure.
 */
import type { RouteRecordRaw } from 'vue-router'
import { FolderOpen, ChartColumn, ShieldCheck } from 'lucide-vue-next'
import { registerWorkspace } from '../../shell/workspaces'
import { routeKit } from '../shared/routeKit'

const k = routeKit('Internal Auditor', 'aud-dashboard')
const Plan = () => import('./pages/EngagementsPage.vue')
const Findings = () => import('./pages/FindingsPage.vue')

const routes: RouteRecordRaw[] = [
  {
    path: '/finance/audit',
    component: () => import('./AuditLayout.vue'),
    meta: { title: 'Internal Audit - Vungu Rural District Council' },
    children: [
      { path: '', name: 'aud-dashboard', component: () => import('./pages/AuditDashboard.vue'), meta: { cwTitle: 'Dashboard' } },
      k.page('plans', 'aud-plans', 'Audit Plans', Plan, { cwMode: 'plan' }),
      k.page('assignments', 'aud-assignments', 'Audit Assignments', Plan, { cwMode: 'assignments' }),
      k.page('findings', 'aud-findings', 'Findings', Findings, { cwMode: 'findings' }),
      k.page('risks', 'aud-risks', 'Risk Register', Findings, { cwMode: 'risks' }),
      k.page('compliance', 'aud-compliance', 'Compliance', Findings, { cwMode: 'compliance' }),
      k.section('evidence', 'aud-evidence', 'documents', 'Evidence', 'Supporting documents held against finance records, including restricted ones.', FolderOpen),
      k.section('reports', 'aud-reports', 'reports', 'Reports', 'Budget and financial reports, including restricted exports.', ChartColumn),
      k.section('trail', 'aud-trail', 'audit', 'Audit Trail', 'Every finance action, who took it and when, including refused attempts. Exportable.', ShieldCheck, { needs: 'finance.audit.view' }),
      k.messages('aud-messages'),
    ],
  },
]

registerWorkspace({
  key: 'audit',
  routes,
  home: 'aud-dashboard',
  serves: { audit: 'aud-trail', documents: 'aud-evidence', reports: 'aud-reports' },
})
