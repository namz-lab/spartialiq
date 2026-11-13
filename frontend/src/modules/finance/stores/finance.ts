/**
 * The finance store: who this person is in finance terms, which year they are looking at, and the
 * council's classifications.
 *
 * WHAT `can()` IS AND IS NOT
 * It answers "should this screen offer this action?" — so a budget officer is not shown an Approve
 * button that would only give them a 403. It is NOT the control. Every finance endpoint re-checks
 * the permission server-side (src/middleware/financePermissions.js), and the acceptance suite
 * asserts that a request made without the permission is refused and audited whether or not a
 * button existed. Treating `can()` as security would be the mistake the specification warns about
 * in §2.2: permissions assigned "to actions and data scopes, not merely to menu visibility".
 *
 * WHY THE SELECTED YEAR LIVES HERE
 * Nearly every finance screen is "this thing, for this reporting period". Keeping the year in one
 * place means moving between sections does not silently change which year's figures are on screen,
 * which is the kind of mistake that gets a wrong number into a committee paper.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { financeApi } from '../api/financeApi'
import { deliberateAbsences, resolveRolePreset, type FinanceRolePreset } from './rolePreset'
import type {
  Account, Department, FinanceIdentity, FinancePermission, FinancialYear, Programme,
} from '../models/types'

const LAST_YEAR_KEY = 'vungu.finance.lastFinancialYear'

export const useFinanceStore = defineStore('finance', () => {
  const identity = ref<FinanceIdentity | null>(null)
  const identityError = ref<string | null>(null)
  const loadingIdentity = ref(false)

  const years = ref<FinancialYear[]>([])
  const selectedYearId = ref<string | null>(null)
  /** The ward the finance map selected (GIS-finance M3): Budget reads it so the map and the
   *  dashboard answer the same question. Session state only — not persisted. */
  const mapWardCode = ref<string | null>(null)
  const departments = ref<Department[]>([])
  const programmes = ref<Programme[]>([])
  const accounts = ref<Account[]>([])
  const loadingReference = ref(false)
  const referenceError = ref<string | null>(null)

  const permissions = computed<Set<string>>(() => new Set(identity.value?.permissions ?? []))
  const catalogue = computed<FinancePermission[]>(() => identity.value?.catalogue ?? [])

  /** Should the UI offer this? The backend still decides whether it happens. */
  function can(code: string): boolean {
    return permissions.value.has(code)
  }
  function canAny(...codes: string[]): boolean {
    return codes.some((c) => permissions.value.has(c))
  }

  /**
   * Why an action is unavailable, in words, taken from the permission catalogue the backend sends.
   * A disabled button that explains itself is worth four support calls.
   */
  function whyUnavailable(code: string): string {
    const entry = catalogue.value.find((p) => p.code === code)
    if (!entry) return 'This action is not available to your role.'
    if (entry.is_approval) {
      return `Approval is reserved to the roles holding "${entry.label}". Your role prepares and submits; someone else approves.`
    }
    if (entry.is_publication) {
      return `Publication is reserved to the roles holding "${entry.label}". Approving a dataset and releasing it are separate duties.`
    }
    if (entry.is_restricted) {
      return `"${entry.label}" covers supplier, personal or commercially sensitive data and is granted explicitly.`
    }
    return `This action needs "${entry.label}", which your role does not hold.`
  }

  /** Whether this person is confined to particular votes (a departmental head). */
  const departmentScope = computed(() => identity.value?.department_scope ?? [])
  const isScoped = computed(() => departmentScope.value.length > 0)

  /**
   * Which part of this workspace is this person's job — the landing section, the sections to
   * foreground, and the filters each one opens with.
   *
   * PRESENTATION ONLY. `can()` does not consult it, no section becomes unreachable because of it,
   * and an explicit `?section=` link overrides the landing. See `./rolePreset.ts` for the rules and
   * for why they read the permission set rather than the role name.
   */
  const rolePreset = computed<FinanceRolePreset>(() => resolveRolePreset({
    role: identity.value?.role ?? null,
    permissions: permissions.value,
    scoped: isScoped.value,
  }))

  /** The absences in this person's rail that are deliberate, as sentences. GAP-15. */
  const absenceNotes = computed<string[]>(() => (identity.value ? deliberateAbsences({
    role: identity.value.role,
    permissions: permissions.value,
    scoped: isScoped.value,
  }) : []))

  const selectedYear = computed<FinancialYear | null>(
    () => years.value.find((y) => y.id === selectedYearId.value) ?? null,
  )
  const openYears = computed(() => years.value.filter((y) => y.status === 'open'))
  /** A closed year is readable and reportable; it accepts no writes. Screens use this to say so. */
  const selectedYearAcceptsWrites = computed(() => selectedYear.value?.status === 'open')

  const activeDepartments = computed(() => departments.value.filter((d) => d.status === 'active'))
  const postableAccounts = computed(() => accounts.value.filter((a) => a.is_postable && a.status === 'active'))
  const revenueAccounts = computed(() => postableAccounts.value.filter((a) => a.kind === 'revenue'))
  const expenditureAccounts = computed(() => postableAccounts.value.filter((a) => a.kind === 'expenditure'))

  const departmentById = computed(() => new Map(departments.value.map((d) => [d.id, d])))
  const accountById = computed(() => new Map(accounts.value.map((a) => [a.id, a])))

  /** True when the council has not yet entered the things nothing can be done without. */
  const needsSetup = computed(() => ({
    noYear: years.value.length === 0,
    noDepartments: departments.value.length === 0,
    noAccounts: accounts.value.length === 0,
    any: years.value.length === 0 || departments.value.length === 0 || accounts.value.length === 0,
  }))

  /**
   * Whether `needsSetup` may be shown to anyone yet.
   *
   * `needsSetup` is derived from three array lengths, and those arrays are empty for two entirely
   * different reasons: the council has not entered its classifications, or the four reference calls
   * have not come back. Until this module distinguished them, every officer on a slow link was told
   * on every load, in a prominent panel, that "the council's finance setup is incomplete" — on a
   * council with a year, fourteen votes and a three-thousand-line chart of accounts. It was wrong
   * for the two to four seconds the reads took, and it was the first thing they read.
   *
   * It is also false after a FAILED read: an empty array because `departments()` returned 500 means
   * the figures could not be read, which `referenceError` already says, and not that the council has
   * no votes. So the claim is made only when a load has completed and nothing failed.
   */
  const referenceLoaded = ref(false)
  const setupStatusKnown = computed(
    () => referenceLoaded.value && !loadingReference.value && referenceError.value === null,
  )

  async function loadIdentity(force = false): Promise<FinanceIdentity | null> {
    if (identity.value && !force) return identity.value
    loadingIdentity.value = true
    identityError.value = null
    try {
      identity.value = await financeApi.identity()
      return identity.value
    } catch (err) {
      identity.value = null
      identityError.value = messageOf(err, 'Your finance permissions could not be read.')
      return null
    } finally {
      loadingIdentity.value = false
    }
  }

  /**
   * The council's classifications, loaded once per session.
   *
   * Each of the four is fetched independently and a failure on one does not blank the others: a
   * council with no programmes yet must still be able to see its departments.
   */
  /**
   * Whether this person may read the reporting-period reference data at all.
   *
   * The four reference reads (years, votes, chart, programmes) are open to anyone holding one of
   * these, which until migration 207 was every finance role. A cashier holds none of them: a
   * counter is not a place to browse the budget. Issuing the reads anyway produced four 403s, a
   * "could not load" warning and a "finance setup is incomplete" panel on a council whose setup
   * was complete — so the reads are simply not made, and the shell does not claim anything about
   * a setup this person cannot see.
   */
  const readsReference = computed(() => canAny(
    'finance.budget.view', 'finance.actuals.view', 'finance.project.view', 'finance.report.view',
  ))

  async function loadReference(force = false): Promise<void> {
    if (!readsReference.value) { referenceLoaded.value = false; return }
    if (years.value.length && !force) return
    loadingReference.value = true
    referenceError.value = null
    const failures: string[] = []
    const settled = await Promise.allSettled([
      financeApi.financialYears(),
      financeApi.departments(),
      financeApi.accounts(),
      financeApi.programmes(),
    ])
    if (settled[0].status === 'fulfilled') years.value = settled[0].value
    else failures.push('financial years')
    if (settled[1].status === 'fulfilled') departments.value = settled[1].value
    else failures.push('departments')
    if (settled[2].status === 'fulfilled') accounts.value = settled[2].value
    else failures.push('the chart of accounts')
    if (settled[3].status === 'fulfilled') programmes.value = settled[3].value
    else failures.push('programmes')

    if (failures.length) {
      referenceError.value = `Could not load ${failures.join(', ')}. The figures on this page may be incomplete.`
    }
    ensureSelectedYear()
    referenceLoaded.value = true
    loadingReference.value = false
  }

  /**
   * Pick a year if none is chosen: the one the officer last used, else the open one, else the most
   * recent. Never a silent guess among several open years — if the remembered one is still there it
   * wins, so a session does not drift between periods.
   */
  function ensureSelectedYear(): void {
    if (selectedYearId.value && years.value.some((y) => y.id === selectedYearId.value)) return
    let remembered: string | null = null
    try { remembered = window.localStorage.getItem(LAST_YEAR_KEY) } catch { /* private mode */ }
    if (remembered && years.value.some((y) => y.id === remembered)) {
      selectedYearId.value = remembered
      return
    }
    selectedYearId.value = openYears.value[0]?.id ?? years.value[0]?.id ?? null
  }

  function selectYear(id: string | null): void {
    selectedYearId.value = id
    try {
      if (id) window.localStorage.setItem(LAST_YEAR_KEY, id)
      else window.localStorage.removeItem(LAST_YEAR_KEY)
    } catch { /* a remembered year is a convenience, not state the app depends on */ }
  }

  async function refreshYears(): Promise<void> {
    years.value = await financeApi.financialYears()
    ensureSelectedYear()
  }
  async function refreshDepartments(): Promise<void> {
    departments.value = await financeApi.departments()
  }
  async function refreshAccounts(): Promise<void> {
    accounts.value = await financeApi.accounts()
  }

  function reset(): void {
    identity.value = null
    years.value = []
    departments.value = []
    programmes.value = []
    accounts.value = []
    selectedYearId.value = null
    identityError.value = null
    referenceError.value = null
    referenceLoaded.value = false
  }

  function setMapWard(code: string | null): void {
    mapWardCode.value = code
  }

  return {
    identity, identityError, loadingIdentity,
    years, selectedYearId, mapWardCode, departments, programmes, accounts,
    loadingReference, referenceError,
    permissions, catalogue, can, canAny, whyUnavailable,
    departmentScope, isScoped, rolePreset, absenceNotes,
    selectedYear, openYears, selectedYearAcceptsWrites,
    activeDepartments, postableAccounts, revenueAccounts, expenditureAccounts,
    departmentById, accountById, needsSetup, referenceLoaded, setupStatusKnown, readsReference,
    loadIdentity, loadReference, selectYear, refreshYears, refreshDepartments, refreshAccounts, reset,
    setMapWard,
  }
})

/**
 * The sentence to show the person when a finance call fails.
 *
 * The backend sends `{ success: false, error, message }` with a message written for a council
 * officer, so it is used as-is rather than replaced with something vaguer. `required_permission`
 * is appended when present, because "you do not hold finance.publication.publish" is actionable
 * and "forbidden" is not.
 */
export function messageOf(err: unknown, fallback = 'Something went wrong.'): string {
  const e = err as {
    response?: { status?: number; data?: { message?: string; error?: string; required_permission?: string } }
    message?: string
  }
  const data = e?.response?.data
  if (data?.message) {
    return data.required_permission
      ? `${data.message} (needs ${data.required_permission})`
      : data.message
  }
  if (e?.response?.status === 401) return 'Your session has ended. Sign in again.'
  if (e?.response?.status === 403) return 'You do not hold the permission this action requires.'
  if (e?.response?.status === 413) return 'That file is larger than the council allows.'
  if (e?.message) return e.message
  return fallback
}
