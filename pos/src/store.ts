import { reactive, watch } from 'vue'
import type { Db, Invoice, Line, ModuleKey, Product, Profile } from './types'
import { addDays, docTotal, todayIso, uid } from './lib/format'

const KEY = 'tillbook.v1'

function seed(): Db {
  const now = todayIso()
  return {
    profile: {
      businessName: 'Mufakose Hardware',
      tradingAs: 'Mufakose Hardware',
      logoDataUrl: '',
      address: 'Stand 14, High Glen Road, Mufakose, Harare',
      phone: '+263 77 200 1180',
      email: 'accounts@mufakosehardware.co.zw',
      vatNumber: 'VAT-1002941',
      currency: 'USD',
      modules: { pnl: true, balance: true, cashflow: true, invoiceAnalysis: true, ageing: true },
    },
    products: [
      { id: 'p1', sku: 'CEM-50', name: 'Portland cement 50kg', qty: 42, reorderLevel: 20, cost: 8.4, price: 11.5, recurring: { enabled: true, everyDays: 14, qty: 40, lastRestockAt: now } },
      { id: 'p2', sku: 'PNT-20', name: 'Exterior PVA 20L', qty: 8, reorderLevel: 6, cost: 22, price: 31, recurring: { enabled: true, everyDays: 21, qty: 12, lastRestockAt: addDays(now, -22) } },
      { id: 'p3', sku: 'PIP-20', name: 'PVC pipe 20mm x 6m', qty: 60, reorderLevel: 24, cost: 3.1, price: 4.75, recurring: { enabled: false, everyDays: 30, qty: 40, lastRestockAt: null } },
      { id: 'p4', sku: 'NAIL-2', name: 'Wire nails 2 inch (kg)', qty: 18, reorderLevel: 10, cost: 1.8, price: 2.6, recurring: { enabled: true, everyDays: 10, qty: 25, lastRestockAt: addDays(now, -11) } },
    ],
    customers: [
      { id: 'c1', name: 'Chipo Builders', phone: '+263 71 555 0192', email: 'chipo@builders.co.zw' },
      { id: 'c2', name: 'Walk-in customer', phone: '', email: '' },
    ],
    suppliers: [
      { id: 's1', name: 'PPC Zimbabwe', phone: '+263 24 275 0000', email: 'orders@ppc.co.zw' },
      { id: 's2', name: 'Astra Paints', phone: '+263 24 266 1400', email: 'sales@astra.co.zw' },
    ],
    quotes: [
      { id: 'q1', number: 'QT-1008', customerId: 'c1', customerName: 'Chipo Builders', lines: [{ productId: 'p1', name: 'Portland cement 50kg', qty: 30, unitPrice: 11.5 }], note: 'Site delivery excluded.', status: 'sent', createdAt: addDays(now, -4), validUntil: addDays(now, 10) },
    ],
    invoices: [
      { id: 'i1', number: 'INV-2041', customerId: 'c1', customerName: 'Chipo Builders', lines: [{ productId: 'p1', name: 'Portland cement 50kg', qty: 20, unitPrice: 11.5 }], status: 'partial', createdAt: addDays(now, -18), dueAt: addDays(now, -3), paid: 100 },
      { id: 'i2', number: 'INV-2042', customerId: 'c1', customerName: 'Chipo Builders', lines: [{ productId: 'p2', name: 'Exterior PVA 20L', qty: 4, unitPrice: 31 }], status: 'unpaid', createdAt: addDays(now, -40), dueAt: addDays(now, -10), paid: 0 },
      { id: 'i3', number: 'INV-2043', customerId: 'c2', customerName: 'Walk-in customer', lines: [{ productId: 'p4', name: 'Wire nails 2 inch (kg)', qty: 3, unitPrice: 2.6 }], status: 'paid', createdAt: addDays(now, -2), dueAt: addDays(now, 12), paid: 7.8 },
    ],
    receipts: [
      { id: 'r1', number: 'RCT-9011', invoiceId: 'i3', customerName: 'Walk-in customer', method: 'cash', lines: [{ productId: 'p4', name: 'Wire nails 2 inch (kg)', qty: 3, unitPrice: 2.6 }], total: 7.8, createdAt: addDays(now, -2) },
      { id: 'r2', number: 'RCT-9012', invoiceId: 'i1', customerName: 'Chipo Builders', method: 'ecocash', lines: [{ productId: 'p1', name: 'Portland cement 50kg', qty: 20, unitPrice: 11.5 }], total: 100, createdAt: addDays(now, -6) },
    ],
    purchases: [
      { id: 'u1', supplierId: 's1', supplierName: 'PPC Zimbabwe', amount: 336, paid: 200, createdAt: addDays(now, -25), dueAt: addDays(now, -5) },
      { id: 'u2', supplierId: 's2', supplierName: 'Astra Paints', amount: 264, paid: 0, createdAt: addDays(now, -8), dueAt: addDays(now, 6) },
    ],
    salaries: [
      { id: 'w1', staffName: 'Tariro Ncube', amount: 280, paid: 280, period: 'August 2026', createdAt: addDays(now, -20) },
      { id: 'w2', staffName: 'Peter Moyo', amount: 220, paid: 80, period: 'September 2026', createdAt: addDays(now, -3) },
    ],
  }
}

function load(): Db {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return seed()
    return { ...seed(), ...JSON.parse(raw) } as Db
  } catch {
    return seed()
  }
}

export const db = reactive<Db>(load())

watch(db, () => localStorage.setItem(KEY, JSON.stringify(db)), { deep: true })

export function resetDemo() {
  Object.assign(db, seed())
}

export function nextNo(kind: 'QT' | 'INV' | 'RCT'): string {
  const n = Math.floor(1000 + Math.random() * 8000)
  return `${kind}-${n}`
}

export function saveProfile(p: Profile) {
  db.profile = { ...p }
}

export function setLogo(dataUrl: string) {
  db.profile.logoDataUrl = dataUrl
}

export function toggleModule(key: ModuleKey, on: boolean) {
  db.profile.modules[key] = on
}

export function upsertProduct(p: Product) {
  const i = db.products.findIndex(x => x.id === p.id)
  if (i >= 0) db.products[i] = p
  else db.products.unshift(p)
}

export function runDueRestocks(): Product[] {
  const due: Product[] = []
  for (const p of db.products) {
    if (!p.recurring.enabled) continue
    const last = p.recurring.lastRestockAt ? new Date(p.recurring.lastRestockAt).getTime() : 0
    const elapsed = (Date.now() - last) / 86_400_000
    if (elapsed >= p.recurring.everyDays || p.qty <= p.reorderLevel) {
      p.qty += p.recurring.qty
      p.recurring.lastRestockAt = todayIso()
      due.push({ ...p })
    }
  }
  return due
}

export function checkout(customerName: string, method: 'cash' | 'card' | 'ecocash' | 'transfer', lines: Line[]) {
  if (!lines.length) return null
  for (const l of lines) {
    const p = db.products.find(x => x.id === l.productId)
    if (p) p.qty = Math.max(0, p.qty - l.qty)
  }
  const total = docTotal(lines)
  const walkIn = db.customers.find(c => c.name === customerName) ?? db.customers[1]
  const invoice: Invoice = {
    id: uid('inv'),
    number: nextNo('INV'),
    customerId: walkIn?.id ?? 'c2',
    customerName,
    lines,
    status: 'paid',
    createdAt: todayIso(),
    dueAt: addDays(todayIso(), 0),
    paid: total,
  }
  db.invoices.unshift(invoice)
  const receipt = {
    id: uid('rct'),
    number: nextNo('RCT'),
    invoiceId: invoice.id,
    customerName,
    method,
    lines,
    total,
    createdAt: todayIso(),
  }
  db.receipts.unshift(receipt)
  return receipt
}

export function saveQuote(q: { customerId: string; customerName: string; lines: Line[]; note: string }) {
  const row = {
    id: uid('qt'),
    number: nextNo('QT'),
    status: 'sent' as const,
    createdAt: todayIso(),
    validUntil: addDays(todayIso(), 14),
    ...q,
  }
  db.quotes.unshift(row)
  return row
}

export function quoteToInvoice(id: string) {
  const q = db.quotes.find(x => x.id === id)
  if (!q) return null
  q.status = 'invoiced'
  const inv: Invoice = {
    id: uid('inv'),
    number: nextNo('INV'),
    customerId: q.customerId,
    customerName: q.customerName,
    lines: q.lines,
    status: 'unpaid',
    createdAt: todayIso(),
    dueAt: addDays(todayIso(), 14),
    paid: 0,
  }
  db.invoices.unshift(inv)
  return inv
}

export function recordReceiptOnInvoice(invoiceId: string, amount: number, method: 'cash' | 'card' | 'ecocash' | 'transfer') {
  const inv = db.invoices.find(x => x.id === invoiceId)
  if (!inv) return null
  inv.paid = Math.min(docTotal(inv.lines), Math.round((inv.paid + amount) * 100) / 100)
  inv.status = inv.paid >= docTotal(inv.lines) - 0.009 ? 'paid' : inv.paid > 0 ? 'partial' : 'unpaid'
  const r = {
    id: uid('rct'),
    number: nextNo('RCT'),
    invoiceId: inv.id,
    customerName: inv.customerName,
    method,
    lines: inv.lines,
    total: amount,
    createdAt: todayIso(),
  }
  db.receipts.unshift(r)
  return r
}

export function books() {
  const sales = db.receipts.reduce((s, r) => s + r.total, 0)
  const cogs = db.receipts.reduce((s, r) => {
    return s + r.lines.reduce((ls, l) => {
      const p = db.products.find(x => x.id === l.productId)
      return ls + (p ? l.qty * p.cost : 0)
    }, 0)
  }, 0)
  const wages = db.salaries.reduce((s, w) => s + w.paid, 0)
  const purchasesPaid = db.purchases.reduce((s, p) => s + p.paid, 0)
  const gross = sales - cogs
  const profit = gross - wages
  const stockValue = db.products.reduce((s, p) => s + p.qty * p.cost, 0)
  const debtors = db.invoices.reduce((s, i) => s + Math.max(0, docTotal(i.lines) - i.paid), 0)
  const creditors = db.purchases.reduce((s, p) => s + Math.max(0, p.amount - p.paid), 0)
  const salaryOwed = db.salaries.reduce((s, w) => s + Math.max(0, w.amount - w.paid), 0)
  const cash = Math.max(0, sales - purchasesPaid - wages)
  return { sales, cogs, wages, purchasesPaid, gross, profit, stockValue, debtors, creditors, salaryOwed, cash }
}
