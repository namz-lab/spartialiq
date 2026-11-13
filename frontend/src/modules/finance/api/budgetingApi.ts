/**
 * The budget officer's dashboard read (backend `src/routes/finance-budgeting.js`). Spending lines
 * only; every amount is a decimal string from Postgres, one row per currency.
 */
import api from '../../../services/api'
import type { Currency } from '../models/types'

export interface BudgetingDashboard {
  year: { id: string; label: string; start_date: string; end_date: string; status: string; reporting_currency: Currency }
  totals: {
    currency: Currency; budget: string; committed: string; actual: string; available: string
    committed_pct: string | null; actual_pct: string | null; available_pct: string | null; utilised_pct: string | null
  }[]
  programmes: { currency: Currency; code: string; name: string; budget: string; actual: string }[]
  departments: {
    currency: Currency; code: string; name: string; budget: string; actual: string; committed: string
    variance: string; utilisation: string | null; variance_pct: string | null
  }[]
  workflow: { draft: number; submitted: number; returned: number; approved: number }
  revisions_awaiting: number
  alerts: { tone: 'neg' | 'warn' | 'info'; key: string; text: string }[]
  calendar: { date: string; days_left: number | null; text: string }[]
}

export const budgetingApi = {
  async dashboard(financialYearId?: string | null): Promise<BudgetingDashboard> {
    const r = await api.get('/finance/budgeting/dashboard', { params: financialYearId ? { financial_year_id: financialYearId } : {} })
    return (r.data?.data ?? r.data) as BudgetingDashboard
  },
}
