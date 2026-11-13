/**
 * The council's ward register, as every screen that writes a ward code needs it (audit GAP-10).
 *
 * WHY A SHARED LOADER AND NOT A FETCH PER FORM
 * `ward_code` is free text in the database on purpose — import resilience: budgeting must not stop
 * because the national register has not been loaded (ARCHITECTURE-ASSESSMENT §6.2(2)). The UI's job
 * is therefore not to constrain the field but to offer the real list where one exists, and to say
 * what it is. Three screens write a ward (budget lines, projects, spatial allocations) and a fourth
 * filters by one; they must all offer the same list and the same caveat, so the list is loaded once
 * per session and shared.
 *
 * WHAT IT REFUSES TO DO
 * - It does not hide a code that is not in the register. A legacy or imported code stays visible
 *   and is flagged `unlinked`; dropping it would silently change a recorded figure's geography.
 * - It does not present the list as settled. Decision D11 is open: migration 201 linked the 19
 *   COD-AB wards with `basis = 'interim'`, so `provisional` is true and every picker says so.
 * - It does not invent the basis. When the bases cannot be read the register is offered without a
 *   provisional label and `basesKnown` is false, rather than asserting a confirmed list.
 */
import { computed, ref } from 'vue'
import { financeApi } from '../api/financeApi'

export interface WardOption {
  code: string
  name: string | null
}

/** The register as the whole module sees it. One load per page session, shared by every picker. */
const wards = ref<WardOption[]>([])
const bases = ref<string[]>([])
const basesKnown = ref(false)
const linked = ref<boolean | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
let inFlight: Promise<void> | null = null

/** Visible for tests: forget what was loaded so a spec can drive the loader again. */
export function resetWardRegister(): void {
  wards.value = []
  bases.value = []
  basesKnown.value = false
  linked.value = null
  error.value = null
  inFlight = null
}

async function fetchRegister(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    // The geometry route carries the authority's current wards with their names and is the one
    // the audit names for this picker. The bases come from the ward map payload, which is the only
    // staff surface that reports them; it is a separate, best-effort read because a failure there
    // must not cost the picker its list.
    const geometry = await financeApi.mapWardGeometry()
    linked.value = geometry.ward_register_linked
    wards.value = geometry.features.map((f) => ({
      code: f.properties.ward_code,
      name: f.properties.name ?? null,
    }))
    try {
      const map = await financeApi.mapWards({})
      bases.value = map.ward_register_bases ?? []
      basesKnown.value = true
    } catch {
      basesKnown.value = false
    }
  } catch (err) {
    error.value = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      ?? 'The council\'s ward register could not be read.'
    linked.value = null
  } finally {
    loading.value = false
  }
}

/**
 * Whether a code the record already carries belongs to the register.
 *
 * `null` for an empty code and while the register is unknown: "we cannot tell" is a different
 * statement from "this code is wrong", and a picker that flagged every code as unlinked while the
 * register was still loading would teach officers to ignore the flag.
 */
export function wardCodeStatus(
  code: string | null | undefined,
  register: readonly WardOption[],
  registerLinked: boolean | null,
): 'linked' | 'unlinked' | 'unknown' {
  const value = (code ?? '').trim()
  if (!value) return 'unknown'
  if (registerLinked !== true || register.length === 0) return 'unknown'
  return register.some((w) => w.code === value) ? 'linked' : 'unlinked'
}

/**
 * The options a picker offers: the register, plus the code the record already carries when that
 * code is not in the register. A legacy code must remain selectable and must remain visible as
 * what it is, or saving an unrelated field would quietly relocate the money.
 */
export function wardOptionsWith(
  register: readonly WardOption[],
  current: string | null | undefined,
): Array<WardOption & { inRegister: boolean }> {
  const value = (current ?? '').trim()
  const options = register.map((w) => ({ ...w, inRegister: true }))
  if (value && !register.some((w) => w.code === value)) {
    options.unshift({ code: value, name: null, inRegister: false })
  }
  return options
}

export function useWardRegister() {
  /** Load once. Concurrent callers await the same request rather than issuing four. */
  async function load(force = false): Promise<void> {
    if (force) resetWardRegister()
    if (wards.value.length > 0 || (linked.value !== null && !force)) return
    if (!inFlight) {
      inFlight = fetchRegister().finally(() => { inFlight = null })
    }
    await inFlight
  }

  return {
    wards,
    bases,
    basesKnown,
    linked,
    loading,
    error,
    /** Decision D11: the loaded list is interim reference data, not a Council resolution. */
    provisional: computed(() => bases.value.includes('interim')),
    load,
  }
}
