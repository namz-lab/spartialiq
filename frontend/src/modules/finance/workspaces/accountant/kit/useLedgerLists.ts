/**
 * The ledger lists every accountant page needs for a picker: the chart, the party register and the
 * accounting periods. Held once at module level so moving between pages does not re-read them, and
 * emptied by `resetLedgerLists()` when the person signs out (`resetAccountant()` calls it).
 */
import { ref } from 'vue'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf } from '../../../stores/finance'
import type { LedgerAccount, LedgerParty, LedgerPeriod } from '../../../models/ledgerTypes'

const accounts = ref<LedgerAccount[]>([])
const parties = ref<LedgerParty[]>([])
const periods = ref<LedgerPeriod[]>([])
const error = ref<string | null>(null)
let accountsLoaded = false
let partiesLoaded = false
let periodsYear: string | null = null

export function resetLedgerLists(): void {
  accounts.value = []
  parties.value = []
  periods.value = []
  error.value = null
  accountsLoaded = false
  partiesLoaded = false
  periodsYear = null
}

async function loadAccounts(force = false): Promise<void> {
  if (accountsLoaded && !force) return
  error.value = null
  try {
    accounts.value = (await ledgerApi.accounts({ status: 'active' })).accounts
    accountsLoaded = true
  } catch (err) {
    error.value = messageOf(err, 'The chart of accounts could not be read.')
  }
}

async function loadParties(force = false): Promise<void> {
  if (partiesLoaded && !force) return
  error.value = null
  try {
    const all: LedgerParty[] = []
    for (;;) {
      const page = await ledgerApi.parties({ status: 'active', limit: 200, offset: all.length })
      all.push(...page.parties)
      if (!page.parties.length || all.length >= page.total) break
    }
    parties.value = all
    partiesLoaded = true
  } catch (err) {
    error.value = messageOf(err, 'The party register could not be read.')
  }
}

/** Resolves true when the periods were read, false when the read failed (the message is in `error`). */
async function loadPeriods(yearId: string): Promise<boolean> {
  error.value = null
  try {
    periods.value = (await ledgerApi.periods({ financial_year_id: yearId })).periods
    periodsYear = yearId
    return true
  } catch (err) {
    error.value = messageOf(err, 'The accounting periods could not be read.')
    return false
  }
}

/** The loaded period whose dates hold `date` (YYYY-MM-DD), or null. */
function periodFor(date: string): LedgerPeriod | null {
  return periods.value.find(p => p.from_date <= date && date <= p.to_date) ?? null
}

export function useLedgerLists() {
  return { accounts, parties, periods, loadAccounts, loadParties, loadPeriods, periodFor, error, periodsYear: () => periodsYear }
}
