import { createRouter, createWebHashHistory } from 'vue-router'
import DashboardView from './views/DashboardView.vue'
import PosView from './views/PosView.vue'
import StockView from './views/StockView.vue'
import QuotationsView from './views/QuotationsView.vue'
import ReceiptsView from './views/ReceiptsView.vue'
import InvoicesView from './views/InvoicesView.vue'
import ProfileView from './views/ProfileView.vue'
import ProfitLossView from './views/ProfitLossView.vue'
import BalanceSheetView from './views/BalanceSheetView.vue'
import CashflowView from './views/CashflowView.vue'
import InvoiceAnalysisView from './views/InvoiceAnalysisView.vue'
import AgeingView from './views/AgeingView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: DashboardView },
    { path: '/pos', name: 'pos', component: PosView },
    { path: '/stock', name: 'stock', component: StockView },
    { path: '/quotations', name: 'quotations', component: QuotationsView },
    { path: '/receipts', name: 'receipts', component: ReceiptsView },
    { path: '/invoices', name: 'invoices', component: InvoicesView },
    { path: '/profile', name: 'profile', component: ProfileView },
    { path: '/reports/pnl', name: 'pnl', component: ProfitLossView },
    { path: '/reports/balance', name: 'balance', component: BalanceSheetView },
    { path: '/reports/cashflow', name: 'cashflow', component: CashflowView },
    { path: '/reports/invoices', name: 'invoice-analysis', component: InvoiceAnalysisView },
    { path: '/reports/ageing', name: 'ageing', component: AgeingView },
  ],
})
