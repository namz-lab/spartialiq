/**
 * Property finance on the Planning register: the client for the backend's
 * `src/routes/finance-property.js` (migration 244).
 *
 * The property is Planning's (land.parcel); the account, bills and receipts are the rates module's.
 * Every figure arrives as a decimal string from SQL and is only formatted here, never summed.
 */
import api from '../../../services/api'

const unwrap = <T>(r: { data?: { data?: T } | T }): T => {
  const body = r.data as { data?: T } | T
  return (body && typeof body === 'object' && 'data' in (body as object) ? (body as { data: T }).data : body) as T
}

export type FinancialStatus =
  | 'paid_up' | 'partially_paid' | 'awaiting_payment' | 'overdue' | 'not_billed'
  | 'allocated_no_account' | 'unallocated' | 'no_account' | 'cancelled'

export type LandUseClass = 'residential' | 'commercial' | 'industrial' | 'institutional' | 'council' | 'agricultural' | 'other'

export interface PropertyRow {
  parcel_id: string
  parcel_kind: 'stand' | 'farm' | 'plot'
  stand_no: string
  township_code: string | null
  area_m2: string
  tenure_class: string | null
  ward_code: string | null
  ward_name: string | null
  ward_derived: boolean
  land_use: string | null
  land_use_class: LandUseClass
  offer_status: string | null
  offer_price_usd: string | null
  use_scale: string | null
  register_allocation_status: string
  allocation_id: string | null
  allocation_reference: string | null
  allottee_name: string | null
  allocation_purpose: string | null
  allocated_at: string | null
  rates_account_id: string | null
  account_no: string | null
  party_id: string | null
  party_name: string | null
  opened_on: string | null
  erp_account_no: string | null
  closed_accounts: number
  usd_billed: string
  usd_paid: string
  usd_balance: string
  usd_overdue: string
  usd_pending: string
  zwg_billed: string
  zwg_paid: string
  zwg_balance: string
  zwg_overdue: string
  zwg_pending: string
  bills: number
  open_bills: number
  receipts: number
  oldest_days: number | null
  last_billed_on: string | null
  last_paid_on: string | null
  is_allocated: boolean
  payment_pending_posting: boolean
  financial_status: FinancialStatus
  financial_status_label: string
  lng?: number
  lat?: number
}

export interface MapFeatureProps {
  parcel_id: string
  kind: string
  stand_no: string
  township: string | null
  ward_code: string | null
  ward_name: string | null
  land_use: string | null
  land_use_class: LandUseClass
  allocated: boolean
  offer_status: string | null
  account_no: string | null
  party_name: string | null
  status: FinancialStatus
  status_label: string
  usd_balance: string
  usd_overdue: string
  zwg_balance: string
  pending: boolean
  area_m2: string
}

export interface FeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection'
  features: { type: 'Feature'; id?: string; geometry: GeoJSON.Geometry; properties: P }[]
}

export interface PropertyLayers {
  wards: FeatureCollection<{ ward_code: string; name: string }>
  zones: FeatureCollection<{ id: number; name: string; zone_code: string | null; zone_type: string | null; color: string | null }>
  projects: FeatureCollection<{ id: string; reference: string; name: string; status: string; ward_code: string | null; currency: string; approved_budget: string; location_text: string | null; progress: string | null }>
  roads: FeatureCollection<{ id: string; name: string }>
  townships: FeatureCollection<{ township: string; stands: number }>
  /** The council's area: its wards merged, the world outside it, and its extent. */
  council: { name: string; boundary: GeoJSON.Geometry; outside: GeoJSON.Geometry; bbox: [number, number, number, number] } | null
  unavailable: { id: string; label: string; reason: string }[]
}

export interface AreaFigures {
  parcels: number
  stands: number
  allocated: number
  accounts: number
  allocated_no_account: number
  not_billed: number
  overdue: number
  owing: number
  paid_up: number
  allocated_not_paid_up: number
  usd_billed: string
  usd_paid: string
  usd_outstanding: string
  usd_overdue: string
  usd_pending: string
  usd_collection_rate: string | null
  zwg_billed: string
  zwg_paid: string
  zwg_outstanding: string
  zwg_collection_rate: string | null
}

export interface PropertyAnalytics {
  by_ward: (AreaFigures & { ward_code: string | null; ward_name: string | null })[]
  by_township: (AreaFigures & { township: string })[]
  totals: AreaFigures
  statuses: { financial_status: FinancialStatus; parcel_kind: string; n: number; label: string }[]
  largest_balances: PropertyRow[]
  projects_by_ward: { ward_code: string; currency: string; projects: number; approved_budget: string }[]
  basis: string
}

export interface PropertyBill {
  id: string
  bill_no: string
  account_no: string
  period_from: string
  period_to: string
  issued_on: string
  due_on: string | null
  currency: 'USD' | 'ZWG'
  amount: string
  voucher_status: string
  voucher_no: string
  open_amount: string
  ageing_bucket: string | null
  days_outstanding: number | null
  narration: string | null
}

export interface PropertyReceipt {
  id: string
  receipt_no: string
  account_no: string
  received_on: string
  currency: 'USD' | 'ZWG'
  amount: string
  method: string | null
  reference: string | null
  voucher_status: string
  voucher_no: string
  session_no: string | null
  taken_by: string | null
}

export interface IntegrationEvent {
  id: string
  event_type: string
  source?: string
  source_ref?: string
  parcel_id?: string
  stand_no?: string
  township_code?: string
  payload?: Record<string, unknown>
  status: 'pending' | 'processed' | 'failed' | 'duplicate' | 'ignored'
  attempts: number
  last_error: string | null
  outcome: string | null
  detected_at: string
  processed_at: string | null
  account_no?: string | null
  party_name?: string | null
}

export interface PropertyProfile {
  property: PropertyRow & { register_source?: string; sg_ref?: string | null; accuracy_basis?: string | null }
  geometry: GeoJSON.Geometry
  centroid: [number, number]
  bbox: [number, number, number, number]
  party: { id: string; name: string; reference: string | null; contact_phone: string | null; contact_email: string | null; address_text: string | null; national_id?: string } | null
  allocations: { id: string; reference_no: string; allottee_name: string | null; purpose: string; status: string; allocated_at: string; revoked_at: string | null; revoke_reason: string | null; allocated_to_name: string | null }[]
  accounts: { id: string; account_no: string; status: string; opened_on: string; closed_on: string | null; notes: string | null; party_name: string; party_reference: string | null }[]
  bills: PropertyBill[]
  receipts: PropertyReceipt[]
  balances: { currency: 'USD' | 'ZWG'; balance: string; owed: string; unallocated_credit: string; overdue: string }[]
  events: IntegrationEvent[]
  purchase: { price_usd: string; note: string } | null
  can_see_identity: boolean
  demonstration_data: boolean
  basis: string
}

export interface IntegrationState {
  runs: { id: string; trigger: string; started_at: string; finished_at: string | null; run_by_name: string | null; discovered: number; processed: number; failed: number; duplicates: number; error: string | null }[]
  counts: { status: string; event_type: string; n: number }[]
  events: IntegrationEvent[]
  awaiting_discovery: { parcel_id: string; stand_no: string; township_code: string | null; allocation_reference: string | null; allottee_name: string | null; allocated_at: string | null }[]
  account_without_allocation: { parcel_id: string; stand_no: string; township_code: string | null; account_no: string; party_name: string; usd_balance: string }[]
  can_sync: boolean
}

export const propertyApi = {
  map: async (kind: 'stand' | 'farm' | 'all' = 'all') =>
    unwrap<FeatureCollection<MapFeatureProps>>(await api.get('/finance/property/map', { params: { kind } })),
  layers: async () => unwrap<PropertyLayers>(await api.get('/finance/property/layers')),
  search: async (q: string, status?: FinancialStatus) =>
    unwrap<{ results: PropertyRow[]; identity_search: boolean }>(
      await api.get('/finance/property/search', { params: { q, ...(status ? { status } : {}) } })),
  analytics: async () => unwrap<PropertyAnalytics>(await api.get('/finance/property/analytics')),
  profile: async (parcelId: string) =>
    unwrap<PropertyProfile>(await api.get(`/finance/property/${encodeURIComponent(parcelId)}`)),
  integration: async (status?: IntegrationEvent['status']) =>
    unwrap<IntegrationState>(await api.get('/finance/property/integration', { params: status ? { status } : {} })),
  runIntegration: async () =>
    unwrap<{ run: IntegrationState['runs'][number] }>(await api.post('/finance/property/integration/run')),
  retryEvent: async (id: string) =>
    unwrap<{ status: string; outcome?: string; error?: string }>(await api.post(`/finance/property/integration/events/${id}/retry`)),
}

/** The map's colour for each financial status. Distinct from the land-use colours by design. */
export const STATUS_COLOURS: Record<FinancialStatus, string> = {
  paid_up: '#1e8e4e',
  partially_paid: '#e0a100',
  awaiting_payment: '#e46d0a',
  overdue: '#c62828',
  not_billed: '#7b5cc4',
  allocated_no_account: '#d81b9a',
  unallocated: '#b8c0cc',
  no_account: '#d9dee5',
  cancelled: '#6b7280',
}

export const STATUS_ORDER: FinancialStatus[] = [
  'overdue', 'awaiting_payment', 'partially_paid', 'paid_up', 'not_billed', 'allocated_no_account', 'unallocated', 'no_account', 'cancelled',
]

export const STATUS_LABELS: Record<FinancialStatus, string> = {
  paid_up: 'Paid up',
  partially_paid: 'Partially paid',
  awaiting_payment: 'Awaiting payment',
  overdue: 'Overdue (over 30 days)',
  not_billed: 'Account open, not yet billed',
  allocated_no_account: 'Allocated, no finance account',
  unallocated: 'Unallocated stand',
  no_account: 'No finance account',
  cancelled: 'Allocation cancelled',
}

export const LAND_USE_COLOURS: Record<LandUseClass, string> = {
  residential: '#f2c46d',
  commercial: '#e57373',
  industrial: '#9575cd',
  institutional: '#4fa3d9',
  council: '#8d9aa8',
  agricultural: '#9ccc65',
  other: '#cfd5dc',
}

export const LAND_USE_LABELS: Record<LandUseClass, string> = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
  institutional: 'Institutional',
  council: 'Council-owned / state land',
  agricultural: 'Agricultural (farm parcels)',
  other: 'Other / unzoned',
}
