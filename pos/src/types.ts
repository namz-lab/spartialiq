export type Money = number

export type ModuleKey = 'pnl' | 'balance' | 'cashflow' | 'invoiceAnalysis' | 'ageing'

export interface Profile {
  businessName: string
  tradingAs: string
  logoDataUrl: string
  address: string
  phone: string
  email: string
  vatNumber: string
  currency: string
  modules: Record<ModuleKey, boolean>
}

export interface Product {
  id: string
  sku: string
  name: string
  qty: number
  reorderLevel: number
  cost: Money
  price: Money
  recurring: { enabled: boolean; everyDays: number; qty: number; lastRestockAt: string | null }
}

export interface Party {
  id: string
  name: string
  phone: string
  email: string
}

export interface Line {
  productId: string
  name: string
  qty: number
  unitPrice: Money
}

export type DocStatus = 'draft' | 'sent' | 'accepted' | 'invoiced' | 'paid' | 'void' | 'overdue'

export interface Quote {
  id: string
  number: string
  customerId: string
  customerName: string
  lines: Line[]
  note: string
  status: DocStatus
  createdAt: string
  validUntil: string
}

export interface Invoice {
  id: string
  number: string
  customerId: string
  customerName: string
  lines: Line[]
  status: 'unpaid' | 'partial' | 'paid' | 'void'
  createdAt: string
  dueAt: string
  paid: Money
}

export interface Receipt {
  id: string
  number: string
  invoiceId: string | null
  customerName: string
  method: 'cash' | 'card' | 'ecocash' | 'transfer'
  lines: Line[]
  total: Money
  createdAt: string
}

export interface Purchase {
  id: string
  supplierId: string
  supplierName: string
  amount: Money
  paid: Money
  createdAt: string
  dueAt: string
}

export interface SalaryRun {
  id: string
  staffName: string
  amount: Money
  paid: Money
  period: string
  createdAt: string
}

export interface Db {
  profile: Profile
  products: Product[]
  customers: Party[]
  suppliers: Party[]
  quotes: Quote[]
  invoices: Invoice[]
  receipts: Receipt[]
  purchases: Purchase[]
  salaries: SalaryRun[]
}
