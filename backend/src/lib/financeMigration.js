/**
 * Reading a cut-over file: what each row of an old package's export means, and why a row cannot be
 * loaded when it cannot.
 *
 * PURE. Nothing here touches the database: each function takes the row's cells, the confirmed
 * column mapping and the lookups it needs, and returns `{ status, parsed, problems }`. The route
 * (src/routes/finance-migration.js) stores that; the commit functions of migration 211 are the
 * only writers of migrated data and they apply the gates. Tested in test/finance-migration.test.js.
 *
 * THE RULE THIS FILE EXISTS TO KEEP
 * A row that cannot be placed is a `problem` for a person, never a guess: no default class for an
 * account, no nearest-name match for a customer, no balancing figure for a trial balance.
 *
 * MONEY IS NEVER ADDED HERE. Amounts are normalised to decimal strings by parseMoney and summed in
 * SQL. The one comparison made here — is this amount nil, is it negative — is on the string.
 */

const { parseMoney, parseDate, normaliseCode, normaliseHeader } = require('./finance')
const { AGE_FIELDS, CATEGORY_SUGGESTIONS } = require('../config/migrationProfiles')

const ROOT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense']
const ACCOUNT_TYPES = ['receivable', 'payable', 'bank', 'cash', 'accumulated_surplus',
  'current_surplus', 'tax', 'fixed_asset', 'inventory', 'provision', 'other']

const ROOT_WORDS = {
  asset: 'asset', assets: 'asset',
  liability: 'liability', liabilities: 'liability',
  equity: 'equity', capital: 'equity', netassets: 'equity',
  revenue: 'revenue', income: 'revenue',
  expense: 'expense', expenses: 'expense', expenditure: 'expense',
}

const text = (v, max = 500) => {
  if (v === undefined || v === null) return ''
  const s = String(v).trim()
  return s.length > max ? s.slice(0, max) : s
}
const key = (v) => normaliseCode(v).toUpperCase()
const nameKey = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const isNil = (money) => /^-?0+(\.0+)?$/.test(money)
const negate = (money) => (money.startsWith('-') ? money.slice(1) : `-${money}`)
const problem = (field, message) => ({ field, message })
// Exact integer cents, for the two places a figure must be netted or totalled for display. BigInt,
// so there is no floating point anywhere; the figures that gate a commit are summed again in SQL.
const cents = (money) => BigInt(money.replace('.', ''))
const fromCents = (n) => {
  const neg = n < 0n
  const digits = (neg ? -n : n).toString().padStart(3, '0')
  return `${neg ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`
}

/** Subtract n days from an ISO date, in UTC so a date stays the date it is. */
function daysBefore(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/** The cell a target field was matched to, or undefined when the field has no column. */
function pick(columnMap, headers, row, field) {
  const header = columnMap[field]
  if (!header) return undefined
  const index = headers.findIndex((h) => normaliseHeader(h) === normaliseHeader(header))
  if (index < 0) return undefined
  const v = row[index]
  return v === undefined || v === null ? undefined : v
}

/** An amount cell: '' and absent are nil, anything unreadable is reported. */
function amountOf(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { ok: true, value: '0.00' }
  const parsed = parseMoney(typeof raw === 'number' ? raw : String(raw))
  return parsed.ok ? parsed : { ok: false, reason: parsed.reason }
}

/** The distinct financial categories in a chart file, each with a suggested class or none. */
function suggestCategoryMap(categories) {
  const out = {}
  for (const c of categories) {
    const label = text(c, 120)
    if (!label || out[label]) continue
    const hit = CATEGORY_SUGGESTIONS[normaliseHeader(label).replace(/[^a-z]/g, '')]
    out[label] = hit ? { root_type: hit.root_type, account_type: hit.account_type || null, suggested: true }
      : { root_type: null, account_type: null, suggested: false }
  }
  return out
}

/**
 * One row of an old chart of accounts.
 *
 * lookups: `accountsByCode` (this ledger's chart, by upper-cased code → { id, name, is_group }),
 * `mappedCodes` (codes an earlier file of this cut-over already mapped), `seen` (codes already met
 * in this file, mutated).
 */
function readChartRow({ cells, headers, columnMap, options = {}, decision = {}, lookups }) {
  const get = (f) => pick(columnMap, headers, cells, f)
  const code = normaliseCode(get('code'))
  const name = text(get('name'), 200)
  const category = text(get('category'), 120)
  const parsed = {
    code, name, category,
    parent_code: normaliseCode(get('parent_code')) || null,
    is_group: /^(y|yes|true|1|h|heading|group)$/i.test(text(get('is_group'))),
  }
  const problems = []

  if (!code && !name) return { status: 'set_aside', parsed: { ...parsed, action: 'skip', note: 'Blank line' }, problems }
  if (!code) problems.push(problem('code', 'This line has no account number.'))
  if (!name) problems.push(problem('name', 'This account has no description.'))

  if (decision.action === 'set_aside') {
    if (text(decision.note).length < 3) {
      problems.push(problem('decision', 'Retiring an old account needs a reason, which is kept with the mapping.'))
      return { status: 'problem', parsed, problems }
    }
    return { status: 'set_aside', parsed: { ...parsed, action: 'retire' }, problems: [] }
  }

  const k = key(code)
  if (code && lookups.seen.has(k)) {
    problems.push(problem('code', `Account number ${code} appears more than once in this file.`))
  }
  if (code) lookups.seen.add(k)

  if (code && lookups.mappedCodes.has(k)) {
    return {
      status: 'set_aside',
      parsed: { ...parsed, action: 'skip', note: 'Already mapped by an earlier file of this cut-over' },
      problems: [],
    }
  }

  if (decision.action === 'map') {
    const target = lookups.accountsById.get(decision.ledger_account_id)
    if (!target) problems.push(problem('decision', 'The account chosen for this code is no longer in the chart.'))
    if (problems.length) return { status: 'problem', parsed, problems }
    return { status: 'ready', parsed: { ...parsed, action: 'map', ledger_account_id: target.id, maps_to: `${target.code} ${target.name}` }, problems }
  }

  const newCode = normaliseCode(decision.new_code) || null
  const existing = lookups.accountsByCode.get(key(newCode || code))
  if (existing) {
    if (!newCode && nameKey(existing.name) === nameKey(name)) {
      // The same number and the same description is the same account, not a resemblance.
      if (problems.length) return { status: 'problem', parsed, problems }
      return { status: 'ready', parsed: { ...parsed, action: 'map', ledger_account_id: existing.id, maps_to: `${existing.code} ${existing.name}` }, problems }
    }
    problems.push(problem('code',
      `Account number ${newCode || code} is already in the chart as "${existing.name}". Map this line to it, or load it under a different number.`))
  }

  const fromCategory = category ? (options.category_map || {})[category] : null
  const stated = ROOT_WORDS[normaliseHeader(get('root_type'))]
  const rootType = decision.root_type || stated || (fromCategory && fromCategory.root_type) || null
  const accountType = decision.account_type !== undefined ? decision.account_type
    : (fromCategory && fromCategory.account_type) || null
  if (!ROOT_TYPES.includes(rootType)) {
    problems.push(problem('root_type', category
      ? `The category "${category}" has not been classed as asset, liability, equity, revenue or expense.`
      : 'This account has no category in the file. Class it as asset, liability, equity, revenue or expense.'))
  }
  if (accountType && !ACCOUNT_TYPES.includes(accountType)) {
    problems.push(problem('account_type', `"${accountType}" is not an account type this ledger knows.`))
  }
  if (problems.length) return { status: 'problem', parsed, problems }
  return {
    status: 'ready',
    parsed: { ...parsed, action: 'create', root_type: rootType, account_type: accountType || null, new_code: newCode },
    problems,
  }
}

/**
 * One row of a customer or supplier master.
 *
 * lookups: `partiesByReference`, `partiesByName` (name key → [{ id, name, reference, party_type }]),
 * `partiesById`, `mappedCodes`, `seen`.
 */
function readPartyRow({ cells, headers, columnMap, options = {}, decision = {}, lookups }) {
  const get = (f) => pick(columnMap, headers, cells, f)
  const code = normaliseCode(get('code'))
  const name = text(get('name'), 200)
  const sourceKind = options.party_kind === 'supplier' ? 'supplier' : 'customer'
  const partyType = sourceKind === 'supplier' ? 'supplier' : (options.party_type === 'ratepayer' ? 'ratepayer' : 'debtor')
  const address = ['address_1', 'address_2', 'address_3'].map((f) => text(get(f), 160)).filter(Boolean).join(', ')
  const parsed = {
    source_kind: sourceKind, code, name, party_type: partyType,
    reference: normaliseCode(decision.reference) || code,
    contact_name: text(get('contact_name'), 160), contact_phone: text(get('contact_phone'), 60),
    contact_email: text(get('contact_email'), 200), address_text: address,
  }
  const problems = []

  if (!code && !name) return { status: 'set_aside', parsed: { ...parsed, note: 'Blank line' }, problems }
  if (decision.action === 'set_aside') {
    if (text(decision.note).length < 3) {
      return { status: 'problem', parsed, problems: [problem('decision', 'Leaving an account behind needs a reason.')] }
    }
    return { status: 'set_aside', parsed: { ...parsed, note: text(decision.note) }, problems }
  }
  if (!code) problems.push(problem('code', 'This line has no account number.'))
  if (!name) problems.push(problem('name', 'This account has no name.'))

  const k = `${sourceKind}:${key(code)}`
  if (code && lookups.seen.has(k)) problems.push(problem('code', `Account number ${code} appears more than once in this file.`))
  if (code) lookups.seen.add(k)
  if (code && lookups.mappedCodes.has(k)) {
    return { status: 'set_aside', parsed: { ...parsed, note: 'Already brought across by an earlier file of this cut-over' }, problems: [] }
  }

  if (decision.action === 'map') {
    const target = lookups.partiesById.get(decision.party_id)
    if (!target) problems.push(problem('decision', 'The party chosen for this account is no longer in the register.'))
    if (problems.length) return { status: 'problem', parsed, problems }
    return { status: 'ready', parsed: { ...parsed, action: 'map', party_id: target.id, maps_to: target.name }, problems }
  }

  // A possible duplicate is put to a person. Nothing is merged because two names look alike.
  const confirmedNew = decision.action === 'create'
  const sameReference = parsed.reference ? lookups.partiesByReference.get(key(parsed.reference)) : null
  if (sameReference) {
    problems.push({
      field: 'code',
      message: `Account number ${parsed.reference} is already used in the party register by "${sameReference.name}". Use that party, or bring this one across under a different number.`,
      candidates: [{ id: sameReference.id, name: sameReference.name, reference: sameReference.reference }],
    })
  } else if (!confirmedNew) {
    const sameName = lookups.partiesByName.get(nameKey(name)) || []
    if (name && sameName.length) {
      problems.push({
        field: 'name',
        message: `"${name}" is already in the party register. Say whether this is the same party or a different one with the same name.`,
        candidates: sameName.slice(0, 5).map((p) => ({ id: p.id, name: p.name, reference: p.reference })),
      })
    }
  }
  if (problems.length) return { status: 'problem', parsed, problems }
  return { status: 'ready', parsed: { ...parsed, action: 'create' }, problems }
}

/**
 * One row of a trial balance (the opening one, or a parallel-run comparison).
 *
 * lookups: `codeMap` (upper-cased old code → { disposition, ledger_account_id, code, name,
 * is_postable, status }). `allowSetAside` is true for a comparison: a balance with no account here
 * is carried to the reconciliation as a difference to explain, not hidden.
 */
function readBalanceRow({ cells, headers, columnMap, decision = {}, lookups, allowSetAside = false }) {
  const get = (f) => pick(columnMap, headers, cells, f)
  const code = normaliseCode(get('code'))
  const name = text(get('name'), 200)
  const parsed = { code, name, debit: '0.00', credit: '0.00' }
  const problems = []

  const debit = amountOf(get('debit'))
  const credit = amountOf(get('credit'))
  const balance = amountOf(get('balance'))
  for (const [field, a] of [['debit', debit], ['credit', credit], ['balance', balance]]) {
    if (!a.ok) problems.push(problem(field, `The ${field} figure on this line cannot be read as an amount.`))
  }
  if (problems.length) return { status: 'problem', parsed, problems }

  // Debit and credit columns win over a single balance column when the file carries both.
  const hasSides = columnMap.debit || columnMap.credit
  let net // { side, value }
  if (hasSides) {
    const d = debit.value; const c = credit.value
    if (d.startsWith('-') || c.startsWith('-')) {
      problems.push(problem('debit', 'A debit or credit column holds a negative figure. Map the file\'s single balance column instead.'))
      return { status: 'problem', parsed, problems }
    }
    if (!isNil(d) && !isNil(c)) {
      // Both sides on one line (a movement layout): the balance is the difference, on its side.
      const diff = cents(d) - cents(c)
      if (diff > 0n) net = { side: 'debit', value: fromCents(diff) }
      else if (diff < 0n) net = { side: 'credit', value: fromCents(-diff) }
    } else if (!isNil(d)) net = { side: 'debit', value: d }
    else if (!isNil(c)) net = { side: 'credit', value: c }
  } else if (!isNil(balance.value)) {
    net = balance.value.startsWith('-') ? { side: 'credit', value: negate(balance.value) } : { side: 'debit', value: balance.value }
  }

  if (!net) {
    return { status: 'set_aside', parsed: { ...parsed, note: code ? 'Nil balance' : 'Blank line' }, problems }
  }
  if (net.side) parsed[net.side] = net.value

  if (!code) {
    // A total or heading line: it carries figures and no account. Never loaded, always listed.
    return { status: 'set_aside', parsed: { ...parsed, debit: '0.00', credit: '0.00', note: `No account number: read as a total or heading line (${name || 'unnamed'})` }, problems }
  }

  const mapped = lookups.codeMap.get(key(code))
  if (!mapped || mapped.disposition !== 'mapped') {
    if (allowSetAside && decision.action === 'set_aside' && text(decision.note).length >= 3) {
      return { status: 'set_aside', parsed: { ...parsed, note: text(decision.note) }, problems }
    }
    problems.push(problem('code', mapped
      ? `Account ${code} was retired in the mapping and carries a balance. Map it to a ledger account.`
      : `Account ${code} is not in the account mapping. Load the chart of accounts first, or map this account now.`))
    return { status: 'problem', parsed, problems }
  }
  if (!mapped.is_postable || mapped.status !== 'active') {
    problems.push(problem('code',
      `Account ${code} is mapped to ${mapped.code} ${mapped.name}, which is a heading or inactive and cannot hold a balance.`))
    return { status: 'problem', parsed, problems }
  }
  return {
    status: 'ready',
    parsed: { ...parsed, ledger_account_id: mapped.ledger_account_id, maps_to: `${mapped.code} ${mapped.name}` },
    problems,
  }
}

/**
 * One row of an age analysis: a single open document, or one account with a column per age.
 *
 * lookups: `partyMap` (source kind + ':' + upper-cased code → { party_id, name }).
 * `cutoverDate` dates an item whose own date is missing only in the per-age layout, where the age
 * column says how old it is; a per-document file must carry each document's date.
 */
function readOpenItemRow({ cells, headers, columnMap, options = {}, lookups, cutoverDate }) {
  const get = (f) => pick(columnMap, headers, cells, f)
  const sourceKind = options.item_side === 'creditors' ? 'supplier' : 'customer'
  const partyCode = normaliseCode(get('party_code'))
  const documentNo = text(get('document_no'), 120)
  const narration = text(get('narration'), 500)
  const parsed = { party_code: partyCode, source_kind: sourceKind, items: [], amount: '0.00' }
  const problems = []
  const items = []

  const byAge = AGE_FIELDS.filter((f) => columnMap[f.key])
  if (columnMap.amount) {
    const amount = amountOf(get('amount'))
    if (!amount.ok) problems.push(problem('amount', 'The amount outstanding on this line cannot be read.'))
    else if (!isNil(amount.value)) {
      const rawDate = get('document_date')
      const date = rawDate === undefined || String(rawDate).trim() === ''
        ? { ok: false, reason: 'missing' } : parseDate(rawDate instanceof Date ? rawDate : String(rawDate))
      if (!date.ok) {
        problems.push(problem('document_date', 'This document has no readable date, so it cannot be aged. Dates are read day first (31/03/2026) or as 2026-03-31.'))
      } else {
        const late = date.value > cutoverDate
        items.push({
          amount: amount.value, document_date: late ? cutoverDate : date.value, document_no: documentNo,
          narration: narration || (late ? `Dated ${date.value} in the old package, after the cut-over` : ''),
        })
      }
    }
  } else {
    for (const f of byAge) {
      const amount = amountOf(get(f.key))
      if (!amount.ok) { problems.push(problem(f.key, `The ${f.label} figure on this line cannot be read.`)); continue }
      if (isNil(amount.value)) continue
      items.push({
        amount: amount.value, document_date: daysBefore(cutoverDate, f.ageDays),
        document_no: `${partyCode || 'ACCOUNT'}/${f.label}`,
        narration: `Balance shown as ${f.label} on the old package's age analysis`,
      })
    }
  }
  if (problems.length) return { status: 'problem', parsed, problems }
  if (items.length === 0) return { status: 'set_aside', parsed: { ...parsed, note: partyCode ? 'Nothing outstanding' : 'Blank line' }, problems }
  parsed.items = items
  parsed.item_count = items.length
  parsed.amount = fromCents(items.reduce((sum, i) => sum + cents(i.amount), 0n))

  if (!partyCode) {
    return { status: 'set_aside', parsed: { ...parsed, items: [], note: 'No account number: read as a total line' }, problems }
  }
  const party = lookups.partyMap.get(`${sourceKind}:${key(partyCode)}`)
  if (!party) {
    problems.push(problem('party_code',
      `Account ${partyCode} was not brought across with the ${sourceKind === 'supplier' ? 'suppliers' : 'customers'}. Load that list first, or say which party this is.`))
    return { status: 'problem', parsed, problems }
  }
  return { status: 'ready', parsed: { ...parsed, party_id: party.party_id, maps_to: party.name }, problems }
}

module.exports = {
  ROOT_TYPES, ACCOUNT_TYPES,
  daysBefore, pick, amountOf, suggestCategoryMap, cents, fromCents,
  readChartRow, readPartyRow, readBalanceRow, readOpenItemRow,
}
