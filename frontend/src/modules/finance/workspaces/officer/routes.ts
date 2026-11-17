/**
 * Finance Operations, `/finance/officer`: the finance officer's workspace. Day-to-day bookkeeping:
 * data brought in from other systems and its exceptions, supplier invoices and payments prepared
 * for approval, journals prepared for posting, debtors, banking, the registers and the documents
 * behind them. Whatever the officer prepares is approved or posted by somebody else
 * (preparer ≠ approver, preparer ≠ poster). Rates and budget work are in Revenue and Rates and
 * Budget Management, reached through the workspace switcher.
 */
import type { RouteRecordRaw } from 'vue-router'
import {
  ArrowLeftRight, Wallet, NotebookPen, BookOpen, ChartColumn, Upload, FolderOpen, FolderKanban,
} from 'lucide-vue-next'
import { registerWorkspace } from '../../shell/workspaces'
import { routeKit } from '../shared/routeKit'

const k = routeKit('Finance Officer', 'ofc-dashboard')

const routes: RouteRecordRaw[] = [
  {
    path: '/finance/officer',
    component: () => import('./OfficerLayout.vue'),
    meta: { title: 'Finance Operations - Vungu Rural District Council' },
    children: [
      { path: '', name: 'ofc-dashboard', component: () => import('./pages/OfficerDashboard.vue'), meta: { cwTitle: 'Dashboard' } },
      k.section('imports', 'ofc-imports', 'imports', 'Imports', 'Upload a file from another system, map its columns, validate it against the chart and its declared control count and total, and resolve its exceptions before it is committed.', Upload),
      k.page('exceptions', 'ofc-exceptions', 'Import Exceptions', () => import('./pages/ImportExceptions.vue')),
      // The earlier name of the imports page; kept so bookmarks and notes still open it.
      { path: 'reconciliation', name: 'ofc-reconciliation', redirect: (to) => ({ name: 'ofc-imports', query: to.query }) },
      k.page('banking', 'ofc-banking', 'Banking', () => import('./pages/BankingPage.vue')),
      // One screen per function: the creditors screen the accountant uses, opened here for the
      // officer who prepares invoices and payments. What the officer may do is decided by the
      // payables permissions on the server, and the screen offers only those.
      k.page('payments', 'ofc-payments', 'Supplier Invoices and Payments', () => import('../accountant/pages/AccountsPayable.vue')),
      k.section('journals', 'ofc-journals', 'ledger', 'Journals', 'Prepare journals for posting. A posted voucher is corrected by a reversal, never edited.', NotebookPen, { props: { only: 'vouchers' } }),
      k.section('receivables', 'ofc-receivables', 'statements', 'Receivables', 'What debtors owe, and for how long, from the posted ledger.', Wallet, { props: { initialTab: 'ageing' } }),
      k.section('transactions', 'ofc-transactions', 'transactions', 'Transaction Register', 'Every imported actual: what was spent and received, against which line.', ArrowLeftRight, { needs: 'finance.transaction.view' }),
      k.section('ledger', 'ofc-ledger', 'ledger', 'General Ledger', 'The chart of accounts and each account\'s balance.', BookOpen, { props: { only: 'chart' } }),
      k.section('projects', 'ofc-projects', 'projects', 'Projects Register', 'Capital and ward projects: allocations, spend and progress.', FolderKanban, { needs: 'finance.project.view' }),
      k.section('documents', 'ofc-documents', 'documents', 'Documents', 'Attach the evidence: invoices, statements, minutes and import files, each to the record it supports.', FolderOpen),
      k.section('reports', 'ofc-reports', 'reports', 'Reports', 'Budget and financial reports, ready to export.', ChartColumn),
      k.messages('ofc-messages'),
    ],
  },
]

registerWorkspace({
  key: 'officer',
  routes,
  home: 'ofc-dashboard',
  serves: {
    transactions: 'ofc-transactions',
    imports: 'ofc-imports',
    ledger: 'ofc-journals',
    'ledger.vouchers': 'ofc-journals',
    'ledger.chart': 'ofc-ledger',
    'statements.ageing': 'ofc-receivables',
    projects: 'ofc-projects',
    documents: 'ofc-documents',
    reports: 'ofc-reports',
  },
})
