/**
 * A receipt as the Cash Office shows and prints it, built from either the payment still being
 * keyed (a preview, no number yet) or a receipt the server issued.
 *
 * The amount received and the change are not money the council holds, so the database does not
 * keep them as amounts; they are written into the receipt's narration as text when it is issued
 * ("Tendered 60000.00; change 7800.00") so a reprint carries them too.
 */
import { methodLabel, type CashMethod, type PrintableReceipt } from '../../models/cashTypes'
import type { Currency } from '../../composables/useMoney'

export interface ReceiptLineView { ref: string; service: string; period: string; amount: string }

export interface ReceiptView {
  receipt_no: string | null
  council_name: string
  issued_at: string | null
  cashier_name: string
  till: string
  customer_name: string
  account_no: string | null
  customer_type: string | null
  contact: string | null
  currency: Currency
  lines: ReceiptLineView[]
  total: string
  method: CashMethod | null
  method_reference: string | null
  tendered: string | null
  change: string | null
  is_cancelled?: boolean
  cancel_reason?: string | null
}

const TENDER = /Tendered ([\d.]+); change ([\d.]+)/

export function tenderNarration(tendered: string, change: string): string {
  return `Tendered ${tendered}; change ${change}`
}

export function readTender(narration: string | null | undefined): { tendered: string; change: string } | null {
  const m = TENDER.exec(narration ?? '')
  return m ? { tendered: m[1], change: m[2] } : null
}

/** An issued receipt, as the server prints it. */
export function viewOfPrintable(r: PrintableReceipt, extra: Partial<ReceiptView> = {}): ReceiptView {
  const tender = readTender(r.narration)
  return {
    receipt_no: r.receipt_no,
    council_name: r.council_name,
    issued_at: r.created_at,
    cashier_name: r.cashier_name,
    till: r.cash_point_name,
    customer_name: r.payer_name,
    account_no: null,
    customer_type: null,
    contact: null,
    currency: r.currency,
    lines: r.lines.map((l) => ({ ref: l.code, service: l.description, period: '', amount: l.amount })),
    total: r.amount,
    method: r.method,
    method_reference: r.method_reference,
    tendered: tender?.tendered ?? null,
    change: tender?.change ?? null,
    is_cancelled: r.is_cancelled,
    cancel_reason: r.cancel_reason,
    ...extra,
  }
}

export { methodLabel }
