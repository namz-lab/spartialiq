/**
 * Finance Operations, `/finance/officer`: the finance officer's workspace. Day-to-day bookkeeping:
 * transactions, payments and journals prepared for posting, debtors, banking, imports and reports.
 * A voucher the officer prepares is posted by somebody else (preparer ≠ poster).
 */
import type { RouteRecordRaw } from 'vue-router'
import { ArrowLeftRight, HandCoins, Wallet, NotebookPen, Scale, BookOpen, ChartColumn } from 'lucide-vue-next'
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
      k.section('transactions', 'ofc-transactions', 'transactions', 'Transactions', 'Every imported actual: what was spent and received, against which line.', ArrowLeftRight, { needs: 'finance.transaction.view' }),
      k.section('payments', 'ofc-payments', 'ledger', 'Payments', 'A payment is a journal that debits the expense or the creditor and credits a bank account. You prepare it; somebody else posts it.', HandCoins, { props: { only: 'vouchers' } }),
      k.section('receivables', 'ofc-receivables', 'statements', 'Receivables', 'What debtors owe, and for how long, from the posted ledger.', Wallet, { props: { initialTab: 'ageing' } }),
      k.section('journals', 'ofc-journals', 'ledger', 'Journals', 'Prepare journals for posting. A posted voucher is corrected by a reversal, never edited.', NotebookPen, { props: { only: 'vouchers' } }),
      k.page('banking', 'ofc-banking', 'Banking', () => import('./pages/BankingPage.vue')),
      k.section('reconciliation', 'ofc-reconciliation', 'imports', 'Reconciliation', 'Each import checked against its declared control count and total before it is committed, and its exceptions resolved.', Scale),
      k.section('ledger', 'ofc-ledger', 'ledger', 'General Ledger', 'The chart of accounts and each account\'s balance.', BookOpen, { props: { only: 'chart' } }),
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
    imports: 'ofc-reconciliation',
    ledger: 'ofc-journals',
    'ledger.vouchers': 'ofc-journals',
    'ledger.chart': 'ofc-ledger',
    'statements.ageing': 'ofc-receivables',
    reports: 'ofc-reports',
  },
})
