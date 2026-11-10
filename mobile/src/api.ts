export type Row = Record<string, unknown>

const SKIP = new Set(['success', 'message', 'error', 'total', 'limit', 'offset', 'count'])

export function asRows(json: unknown): Row[] {
  if (Array.isArray(json)) return json.filter(isRow)
  if (!isRow(json)) return []
  if (Array.isArray(json.features)) {
    return json.features.filter(isRow).map((feature) => {
      const props = isRow(feature.properties) ? feature.properties : {}
      return { id: feature.id, ...props }
    })
  }
  if (Array.isArray(json.data)) return json.data.filter(isRow)
  if (isRow(json.data)) return fieldsOf(json.data)
  return fieldsOf(json)
}

function fieldsOf(source: Row): Row[] {
  return Object.entries(source)
    .filter(([key]) => !SKIP.has(key))
    .map(([key, value]) => ({
      id: key,
      title: key.replaceAll('_', ' '),
      detail: value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value),
    }))
}

function isRow(value: unknown): value is Row {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const TITLE_KEYS = [
  'stand_number', 'standNumber', 'reference', 'tpd_reference', 'dev_register_no',
  'title', 'name', 'zone_name', 'certificate_no', 'order_reference', 'service_id',
  'task_type', 'parcel_id', 'stand_no', 'zone_code', 'applicant_name', 'notice_kind',
]

const DETAIL_KEYS = [
  'status', 'stage', 'development_type', 'suburb_ward', 'ward', 'department',
  'category', 'billing_status', 'status_band', 'allocation_status', 'role',
  'objection_end', 'condition_class', 'proposed_action', 'plan_type',
]

export function rowTitle(row: Row): string {
  if (typeof row.title === 'string' && 'detail' in row && Object.keys(row).length <= 4) return row.title
  for (const key of TITLE_KEYS) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return String(row.id ?? 'Record')
}

export function rowDetail(row: Row): string {
  if (typeof row.detail === 'string') return row.detail
  const bits: string[] = []
  for (const key of DETAIL_KEYS) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) bits.push(value.replaceAll('_', ' '))
    if (typeof value === 'number') bits.push(String(value))
  }
  return bits.slice(0, 3).join(' · ')
}

export async function api(
  base: string,
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {},
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })
    const text = await response.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { message: text }
    }
    if (!response.ok) {
      const body = isRow(json) ? json : {}
      const message = String(body.message || body.error || text || response.status)
      throw new Error(`${response.status} ${message}`)
    }
    return json
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('The council server did not answer. Check the server address and that this phone is on the same network.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
