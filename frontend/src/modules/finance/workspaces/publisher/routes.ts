/**
 * Publication, `/finance/publisher`: the publisher's workspace. Putting approved finance datasets and
 * documents in front of residents, and taking them down again. Approving a release and publishing it
 * are separate duties held by different people; the publication screen keeps that rule.
 */
import type { RouteRecordRaw } from 'vue-router'
import { LayoutTemplate, FileUp, Globe2, Wallet, FileSpreadsheet, FolderOpen, Megaphone } from 'lucide-vue-next'
import { registerWorkspace } from '../../shell/workspaces'
import { routeKit } from '../shared/routeKit'

const k = routeKit('Publisher', 'pub-dashboard')
const STATES = [
  { value: 'pending', label: 'Pending approval' }, { value: 'approved', label: 'Ready to publish' },
  { value: 'published', label: 'Published' }, { value: 'withdrawn', label: 'Withdrawn' },
]

const routes: RouteRecordRaw[] = [
  {
    path: '/finance/publisher',
    component: () => import('./PublisherLayout.vue'),
    meta: { title: 'Publication - Vungu Rural District Council' },
    children: [
      { path: 'property-map', name: 'pub-gis', component: () => import('../shared/PropertyGisPage.vue'), meta: { cwTitle: 'Property Map', gisMode: 'publisher', cwCrumbs: [{ label: 'Publisher', to: 'pub-dashboard' }, { label: 'Property Map' }] } },
      { path: '', name: 'pub-dashboard', component: () => import('./pages/PublisherDashboard.vue'), meta: { cwTitle: 'Dashboard' } },
      k.notBuilt('templates', 'pub-templates', 'Document Templates', 'Standard layouts for council finance documents.', LayoutTemplate,
        'Templates are not part of the finance system yet. A published dataset is laid out by the public portal itself, and a document is published as the file that was uploaded.',
        [{ name: 'pub-council', label: 'Council Documents' }, { name: 'pub-website', label: 'Website Publishing' }]),
      k.section('reports', 'pub-reports', 'publication', 'Report Publishing', 'Every release request: approve, publish to the portal, or withdraw. Approving and publishing are done by different people.', FileUp,
        { states: STATES, stateParam: 'state' }),
      k.section('disclosures', 'pub-disclosures', 'documents', 'Public Disclosures', 'Documents set to public, shown on the portal while the documents dataset is published.', Globe2, { props: { visibility: 'public' } }),
      k.section('budget', 'pub-budget', 'publication', 'Budget Publications', 'Releases of the budget and capital projects datasets.', Wallet, { props: { datasets: ['budget', 'projects'] } }),
      k.section('statements', 'pub-statements', 'publication', 'Financial Statements', 'Releases of revenue, expenditure and financial reports.', FileSpreadsheet, { props: { datasets: ['revenue', 'expenditure', 'reports'] } }),
      k.section('documents', 'pub-council', 'documents', 'Council Documents', 'Every finance document held, and who may see it.', FolderOpen),
      k.notBuilt('notices', 'pub-notices', 'Notices & Announcements', 'Public notices about council finances.', Megaphone,
        'Finance notices are not built yet. Site-wide announcements are made by the system administrator; a finance notice can be published today as a public document.',
        [{ name: 'pub-disclosures', label: 'Public Disclosures' }]),
      k.page('website', 'pub-website', 'Website Publishing', () => import('./pages/WebsitePublishing.vue')),
      k.page('versions', 'pub-versions', 'Version History', () => import('./pages/VersionHistory.vue')),
      k.page('log', 'pub-log', 'Publication Log', () => import('./pages/PublicationLog.vue')),
      k.messages('pub-messages'),
    ],
  },
]

registerWorkspace({
  key: 'publisher',
  routes,
  home: 'pub-dashboard',
  serves: { publication: 'pub-reports', documents: 'pub-council' },
})
