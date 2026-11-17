/**
 * Committee Decisions, `/finance/committee`: the finance committee's workspace. An agenda, not a
 * console (spec §9): what waits for a decision, by kind, with the figures to decide on; the
 * decisions already taken; and the position for context.
 *
 * Admitted by any of finance.budget.approve, finance.revision.approve, finance.project.approve,
 * finance.publication.approve or finance.rates.tariff.approve (backend `financeWorkspaces.js`).
 * Each member sees only the kinds their permissions decide. The year-end close is no longer the
 * committee's (migration 242: the accountant raises it), so it is not on this agenda.
 *
 * The registers reuse the console screens, so the controls (preparer is not approver, closed-year
 * refusals, publication approval apart from publishing) have one implementation.
 */
import type { RouteRecordRaw } from 'vue-router'
import { Wallet, ArrowLeftRight, HardHat, Globe2, Percent, Landmark, ChartColumn, FolderOpen } from 'lucide-vue-next'
import { registerWorkspace } from '../../shell/workspaces'
import { routeKit } from '../shared/routeKit'

const k = routeKit('Finance Committee', 'com-dashboard')

const routes: RouteRecordRaw[] = [
  {
    path: '/finance/committee',
    component: () => import('./CommitteeLayout.vue'),
    meta: { title: 'Committee Decisions - Vungu Rural District Council' },
    children: [
      { path: '', name: 'com-dashboard', component: () => import('./pages/CommitteeDashboard.vue'), meta: { cwTitle: 'Dashboard' } },
      k.page('agenda', 'com-agenda', 'Awaiting Decision', () => import('./pages/AgendaPage.vue')),
      k.page('decided', 'com-decided', 'Decided', () => import('./pages/DecidedPage.vue')),
      k.section('budget', 'com-budget', 'budget', 'Budget', 'Every budget line by vote and state. Submitted lines are also on the agenda.', Wallet, {
        needs: 'finance.budget.view',
        states: [{ value: 'submitted', label: 'Submitted' }, { value: 'returned', label: 'Returned' }, { value: 'approved', label: 'Approved' }],
      }),
      k.section('revisions', 'com-revisions', 'revisions', 'Revisions', 'Supplementary allocations and reductions, decided and undecided.', ArrowLeftRight, {
        needs: 'finance.revision.approve',
        states: [{ value: 'submitted', label: 'Submitted' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }],
        stateParam: 'state',
      }),
      k.section('projects', 'com-projects', 'projects', 'Projects', 'The capital projects register, with allocations, spend and progress.', HardHat, { needs: 'finance.project.view' }),
      k.section('publications', 'com-publication', 'publication', 'Publications', 'Release requests to the public portal. Approving and publishing are done by different people.', Globe2, {
        needs: 'finance.publication.approve',
        states: [{ value: 'pending', label: 'Pending approval' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Refused' }, { value: 'published', label: 'Published' }],
        stateParam: 'state',
      }),
      k.section('tariffs', 'com-tariffs', 'rates', 'Rates Tariffs', 'The rate in the dollar per property category and year, with the resolution that set it.', Percent, {
        needs: 'finance.rates.tariff.approve', props: { initialTab: 'tariffs' },
      }),
      k.section('position', 'com-position', 'overview', 'Financial Position', 'Where the council stands, by currency, for context on each decision.', Landmark),
      k.section('reports', 'com-reports', 'reports', 'Reports', 'Budget against actual, variance and departmental reports.', ChartColumn, { needs: 'finance.report.view' }),
      k.section('documents', 'com-documents', 'documents', 'Documents', 'Supporting documents held against budget lines and projects.', FolderOpen, { needs: 'finance.document.view' }),
      k.messages('com-messages'),
    ],
  },
]

registerWorkspace({
  key: 'committee',
  routes,
  home: 'com-dashboard',
  serves: {
    budget: 'com-budget', revisions: 'com-revisions', projects: 'com-projects',
    publication: 'com-publication', overview: 'com-position', reports: 'com-reports', documents: 'com-documents',
  },
})
