/**
 * Finance Access Administration, `/finance/administration`: the IT administrator's workspace.
 * Who holds which finance role, the personal overrides and departmental scopes in force, duty
 * conflicts, the role catalogue and the access-change log (spec §9).
 *
 * Admitted by finance.users.manage_finance_roles (backend `financeWorkspaces.js`). It holds no
 * financial authority and no finance map. Every change goes through `PUT /finance/users/:id/access`,
 * which requires a reason, refuses self-edits and duty conflicts, and is audited.
 */
import type { RouteRecordRaw } from 'vue-router'
import { Users, KeyRound } from 'lucide-vue-next'
import { registerWorkspace } from '../../shell/workspaces'
import { routeKit } from '../shared/routeKit'

const k = routeKit('Access Administration', 'adm-dashboard')

const routes: RouteRecordRaw[] = [
  {
    path: '/finance/administration',
    component: () => import('./AdministrationLayout.vue'),
    meta: { title: 'Finance Access Administration - Vungu Rural District Council' },
    children: [
      { path: 'property-map', name: 'adm-gis', component: () => import('../shared/PropertyGisPage.vue'), meta: { cwTitle: 'Property Map', gisMode: 'administration', cwCrumbs: [{ label: 'Access Administration', to: 'adm-dashboard' }, { label: 'Property Map' }] } },
      { path: '', name: 'adm-dashboard', component: () => import('./pages/AdministrationDashboard.vue'), meta: { cwTitle: 'Dashboard' } },
      k.section('users', 'adm-users', 'access', 'Finance Users', 'Assign or change a finance role, set personal overrides and departmental scopes. Every change needs a reason and is logged.', Users, {
        needs: 'finance.users.manage_finance_roles',
      }),
      k.page('effective', 'adm-effective', 'Effective Access', () => import('./pages/EffectiveAccessPage.vue')),
      k.page('duties', 'adm-duties', 'Separation of Duties', () => import('./pages/DutiesPage.vue')),
      k.section('roles', 'adm-roles', 'permissions', 'Role Catalogue', 'What each finance role may do by default, and which duties are kept apart.', KeyRound),
      k.page('log', 'adm-log', 'Access Log', () => import('./pages/AccessLogPage.vue')),
      k.messages('adm-messages'),
    ],
  },
]

registerWorkspace({
  key: 'administration',
  routes,
  home: 'adm-dashboard',
  serves: { access: 'adm-users', permissions: 'adm-roles' },
})
