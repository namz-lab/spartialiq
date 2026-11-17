<script lang="ts">
import CwSkeleton from '../kit/CwSkeleton.vue'
import { ref as sessionRef } from 'vue'
/** Collapsed headings, kept for the whole session: module scope, so leaving the page and coming back keeps them. */
export const collapsed = sessionRef<Set<string>>(new Set())
</script>

<script setup lang="ts">
/**
 * The General Ledger: the chart of accounts with each account's balance, one column per book.
 *
 * The tree is built here from `parent_id` (structure only). Every figure, including a heading's
 * sum, is the server's and is shown as sent. A balance on the side opposite the account's nature
 * is shown on its real side and marked in words; it is never flipped.
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { AlertTriangle, BookMarked, ChevronDown, ChevronRight, Info, Plus } from 'lucide-vue-next'
import { ledgerApi } from '../../../api/ledgerApi'
import CwDialog from '../../shared/CwDialog.vue'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney } from '../../../composables/useMoney'
import type {
  ChartBalanceRow, ChartBalances, LedgerAccountBody, LedgerAccountType, LedgerRootType,
} from '../../../models/ledgerTypes'

const ROOT_LABEL: Record<LedgerRootType, string> = {
  asset: 'Asset', liability: 'Liability', equity: 'Equity', revenue: 'Revenue', expense: 'Expenditure',
}
const BEHAVIOURS: { value: LedgerAccountType; label: string }[] = [
  { value: 'receivable', label: 'Receivable control' }, { value: 'payable', label: 'Payable control' },
  { value: 'bank', label: 'Bank' }, { value: 'cash', label: 'Cash' },
  { value: 'accumulated_surplus', label: 'Accumulated surplus' }, { value: 'current_surplus', label: 'Current surplus' },
  { value: 'tax', label: 'Tax' }, { value: 'fixed_asset', label: 'Fixed asset' },
  { value: 'inventory', label: 'Inventory' }, { value: 'provision', label: 'Provision' }, { value: 'other', label: 'Other' },
]
const behaviourLabel = (t: string | null): string => BEHAVIOURS.find((b) => b.value === t)?.label ?? ''

const store = useFinanceStore()
const route = useRoute()
const router = useRouter()

const chart = ref<ChartBalances | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const q = (key: string): string => {
  const v = route.query[key]
  return typeof v === 'string' ? v : ''
}
const search = computed(() => q('q').trim().toLowerCase())
const rootFilter = computed(() => q('root'))
const withBalance = computed(() => q('nonzero') === '1')
const filtered = computed(() => !!(search.value || rootFilter.value || withBalance.value))

function setQuery(over: Record<string, string | undefined>): void {
  const query: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...route.query, ...over })) if (typeof v === 'string' && v !== '') query[k] = v
  void router.replace({ query })
}

/** Only the latest request may touch the page: a slow earlier answer is dropped. */
let reqId = 0
async function load(): Promise<void> {
  const seq = ++reqId
  if (!store.selectedYearId) { chart.value = null; loading.value = false; error.value = null; return }
  error.value = null
  loading.value = true
  try {
    const got = await ledgerApi.chartBalances({ financial_year_id: store.selectedYearId })
    if (seq === reqId) chart.value = got
  } catch (err) {
    if (seq === reqId) error.value = messageOf(err, 'The chart of accounts could not be read.')
  } finally {
    if (seq === reqId) loading.value = false
  }
}
onMounted(() => { void load() })
watch(() => store.selectedYearId, () => { void load() })

const byCode = (a: ChartBalanceRow, b: ChartBalanceRow): number => a.code.localeCompare(b.code, undefined, { numeric: true })

interface Flat { row: ChartBalanceRow; depth: number; hasKids: boolean }

const accounts = computed(() => chart.value?.accounts ?? [])
const currencies = computed(() => chart.value?.currencies ?? [])

const childrenOf = computed(() => {
  const ids = new Set(accounts.value.map((a) => a.id))
  const kids = new Map<string, ChartBalanceRow[]>()
  const roots: ChartBalanceRow[] = []
  for (const a of accounts.value) {
    if (a.parent_id && ids.has(a.parent_id)) {
      const list = kids.get(a.parent_id) ?? []
      list.push(a)
      kids.set(a.parent_id, list)
    } else roots.push(a)
  }
  for (const list of kids.values()) list.sort(byCode)
  roots.sort(byCode)
  return { kids, roots }
})

const hasBalance = (r: ChartBalanceRow): boolean => r.balances.some((b) => Number(b.amount) !== 0)
const matches = (r: ChartBalanceRow): boolean => {
  if (search.value && !`${r.code} ${r.name}`.toLowerCase().includes(search.value)) return false
  if (rootFilter.value && r.root_type !== rootFilter.value) return false
  if (withBalance.value && !hasBalance(r)) return false
  return true
}

const flat = computed<Flat[]>(() => {
  const { kids, roots } = childrenOf.value
  const out: Flat[] = []
  // With a filter, show matching accounts and the headings above them, ignoring what is collapsed.
  const keep = new Set<string>()
  if (filtered.value) {
    const parentOf = new Map(accounts.value.map((a) => [a.id, a.parent_id]))
    for (const a of accounts.value) {
      if (!matches(a)) continue
      let id: string | null = a.id
      while (id && !keep.has(id)) { keep.add(id); id = parentOf.get(id) ?? null }
    }
  }
  const walk = (r: ChartBalanceRow, depth: number): void => {
    if (filtered.value && !keep.has(r.id)) return
    const k = kids.get(r.id) ?? []
    out.push({ row: r, depth, hasKids: k.length > 0 })
    if (filtered.value || !collapsed.value.has(r.id)) for (const c of k) walk(c, depth + 1)
  }
  for (const r of roots) walk(r, 0)
  return out
})

function toggle(id: string): void {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
}

/** Asset and expense accounts are naturally debit; the others credit. */
function againstNature(r: ChartBalanceRow, b: { amount: string; side: 'Dr' | 'Cr' }): boolean {
  // A zero balance arrives as 'Dr' whatever the account; it is on no side, so it is never marked.
  if (Number(b.amount) === 0) return false
  const side = b.side
  const debitNature = r.root_type === 'asset' || r.root_type === 'expense'
  return debitNature ? side === 'Cr' : side === 'Dr'
}
const balanceOf = (r: ChartBalanceRow, cur: string) => r.balances.find((b) => b.currency === cur)
const contraTitle = (r: ChartBalanceRow): string =>
  `This ${ROOT_LABEL[r.root_type].toLowerCase()} account is on the opposite side to its usual one.`

function open(r: ChartBalanceRow): void {
  if (r.is_group) return
  void router.push({ name: 'acc-account', params: { id: r.id } })
}

// ── Account maintenance ─────────────────────────────────────────────────────────────────────
const canManage = computed(() => store.can('finance.ledger.account.manage'))
type Mode = 'new' | 'edit' | 'withdraw'
const dialog = ref<{ mode: Mode; row: ChartBalanceRow | null } | null>(null)
const form = reactive({
  code: '', name: '', root_type: 'asset' as LedgerRootType, account_type: '', parent_id: '',
  is_group: false, notes: '', status: 'active' as 'active' | 'inactive',
})
const busy = ref(false)
const dialogError = ref<string | null>(null)

const headings = computed(() => accounts.value.filter((a) => a.is_group && a.id !== dialog.value?.row?.id).sort(byCode))

const notice = ref('')
const noticeEl = ref<HTMLElement | null>(null)
// Focus in, the Tab trap, Esc (ignored while busy) and the focus return are CwDialog's.
const dialogTitle = computed(() => {
  const d = dialog.value
  if (!d) return ''
  return d.mode === 'new' ? 'New account' : d.mode === 'edit' ? `Edit ${d.row?.code}` : `Withdraw ${d.row?.code}`
})
// The button that opened the dialog, named outright for the focus return (Safari does not focus a clicked button).
const dialogOpener = ref<HTMLElement | null>(null)
function openDialog(mode: Mode, row: ChartBalanceRow | null = null, e?: Event): void {
  if (busy.value) return
  dialogOpener.value = e?.currentTarget instanceof HTMLElement ? e.currentTarget : null
  dialogError.value = null
  notice.value = ''
  Object.assign(form, {
    code: row?.code ?? '', name: row?.name ?? '', root_type: row?.root_type ?? 'asset',
    account_type: row?.account_type ?? '', parent_id: row?.parent_id ?? '', is_group: row?.is_group ?? false,
    notes: row?.notes ?? '', status: row?.status ?? 'active',
  })
  dialog.value = { mode, row }
}
function closeDialog(): void {
  if (busy.value) return
  dialog.value = null
}

async function submit(): Promise<void> {
  const d = dialog.value
  if (!d || busy.value) return
  busy.value = true
  dialogError.value = null
  try {
    let focusId: string | null = d.row?.id ?? null
    let said = ''
    if (d.mode === 'new') {
      const body: LedgerAccountBody = { code: form.code.trim(), name: form.name.trim(), root_type: form.root_type }
      if (form.account_type) body.account_type = form.account_type as LedgerAccountType
      if (form.parent_id) body.parent_id = form.parent_id
      if (form.is_group) body.is_group = true
      if (form.notes.trim()) body.notes = form.notes.trim()
      const made = await ledgerApi.createAccount(body)
      focusId = made?.id ?? null
      said = `Account ${body.code} ${body.name} added.`
    } else if (d.mode === 'edit' && d.row) {
      await ledgerApi.updateAccount(d.row.id, {
        name: form.name.trim(),
        account_type: (form.account_type || null) as LedgerAccountType | null,
        parent_id: form.parent_id || null,
        status: form.status,
        notes: form.notes.trim() || null,
      })
      said = `Account ${d.row.code} ${form.name.trim()} saved.`
    } else if (d.mode === 'withdraw' && d.row) {
      await ledgerApi.withdrawAccount(d.row.id)
      focusId = null
      said = `Account ${d.row.code} ${d.row.name} withdrawn.`
    }
    dialog.value = null
    notice.value = said
    await load()
    await nextTick()
    // The reload rebuilt every row, so the trigger is gone: land on the account's row, else on the notice.
    const rowButton = focusId ? document.querySelector<HTMLElement>(`tr[data-account="${focusId}"] .gl-edit`) : null
    if (rowButton) rowButton.focus()
    else noticeEl.value?.focus()
  } catch (err) {
    dialogError.value = messageOf(err, 'The change could not be made.')
  } finally {
    busy.value = false
  }
}
const canSubmit = computed(() => {
  const d = dialog.value
  if (!d) return false
  if (d.mode === 'withdraw') return true
  return form.name.trim() !== '' && (d.mode === 'edit' || form.code.trim() !== '')
})
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><BookMarked :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>General Ledger</h2>
      <p>The chart of accounts and each account's balance, one column for each book. Open an account to see its postings.</p>
    </div>
    <button v-if="canManage && chart && chart.accounts.length" type="button" class="cw-btn cw-btn--primary" @click="openDialog('new', null, $event)">
      <Plus :size="18" aria-hidden="true" /> New account
    </button>
  </section>

  <section v-if="!store.selectedYearId" class="cw-card">
    <p class="cw-empty"><strong>Choose a financial year in the banner above.</strong>The balances are read one financial year at a time.</p>
  </section>

  <template v-else>
    <p v-if="!canManage" class="cw-banner-msg cw-banner-msg--info"><Info :size="18" aria-hidden="true" />The chart is maintained by the accountant and the Director of Finance.</p>

    <p v-if="notice" ref="noticeEl" class="cw-banner-msg cw-banner-msg--info" role="status" tabindex="-1"><Info :size="18" aria-hidden="true" />{{ notice }}</p>

    <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
      <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>

    <CwSkeleton v-if="loading" label="the chart of accounts" />

    <section v-else-if="chart && !chart.accounts.length" class="cw-card">
      <p class="cw-empty"><strong>The chart of accounts is not set up yet.</strong>
        The chart comes from the council's data migration<template v-if="canManage">, or you can add accounts one at a time</template>.
        <RouterLink class="cw-link" :to="{ name: 'acc-migration' }">Go to Data Migration</RouterLink>
        <button v-if="canManage" type="button" class="cw-btn cw-btn--small" @click="openDialog('new', null, $event)">New account</button></p>
    </section>

    <template v-else-if="chart">
      <form class="cw-card gl-filters" aria-label="Filter the chart" @submit.prevent>
        <div class="cw-field gl-search">
          <label class="cw-label" for="gl-search">Search</label>
          <input id="gl-search" class="cw-input" type="search" placeholder="Code or name" :value="q('q')"
            @input="setQuery({ q: ($event.target as HTMLInputElement).value })" />
        </div>
        <div class="cw-field">
          <label class="cw-label" for="gl-root">Type</label>
          <select id="gl-root" class="cw-select" :value="q('root')" @change="setQuery({ root: ($event.target as HTMLSelectElement).value })">
            <option value="">All types</option>
            <option v-for="(label, root) in ROOT_LABEL" :key="root" :value="root">{{ label }}</option>
          </select>
        </div>
        <label class="gl-check"><input type="checkbox" class="cw-check" :checked="withBalance"
          @change="setQuery({ nonzero: ($event.target as HTMLInputElement).checked ? '1' : undefined })" /> With a balance only</label>
        <button v-if="filtered" type="button" class="cw-btn" @click="setQuery({ q: undefined, root: undefined, nonzero: undefined })">Clear filters</button>
      </form>

      <section v-if="!flat.length" class="cw-card">
        <p class="cw-empty"><strong>No account matches these filters.</strong>Clear the filters to see the whole chart.</p>
      </section>

      <section v-else class="cw-card" aria-label="Chart of accounts">
        <div class="cw-card-body cw-table-wrap">
          <table class="cw-table gl-table">
            <caption class="gl-caption">Balances as at {{ chart.as_at }}. A balance marked "against its usual side" sits on the opposite side to the account's nature.</caption>
            <thead><tr>
              <th>Code and name</th><th>Type</th>
              <th v-for="c in currencies" :key="c" class="r">{{ c }} balance</th>
              <th v-if="canManage" class="no-print"><span class="sr-only">Maintenance</span></th>
            </tr></thead>
            <tbody>
              <tr v-for="f in flat" :key="f.row.id" :data-account="f.row.id" :class="{ 'gl-group': f.row.is_group, 'gl-click': !f.row.is_group, 'gl-off': f.row.status === 'inactive' }"
                @click="open(f.row)">
                <td>
                  <span class="gl-name" :style="{ paddingLeft: `${f.depth * 18}px` }">
                    <button v-if="f.hasKids" type="button" class="gl-toggle" :aria-expanded="filtered || !collapsed.has(f.row.id) ? 'true' : 'false'"
                      :aria-label="`${collapsed.has(f.row.id) ? 'Expand' : 'Collapse'} ${f.row.code} ${f.row.name}`" @click.stop="toggle(f.row.id)">
                      <component :is="filtered || !collapsed.has(f.row.id) ? ChevronDown : ChevronRight" :size="16" aria-hidden="true" />
                    </button>
                    <span v-else class="gl-toggle-gap" />
                    <span class="gl-code">{{ f.row.code }}</span>
                    <span v-if="f.row.is_group">{{ f.row.name }}</span>
                    <RouterLink v-else class="cw-link" :to="{ name: 'acc-account', params: { id: f.row.id } }" @click.stop>{{ f.row.name }}</RouterLink>
                    <span class="sr-only">, level {{ f.depth + 1 }}{{ f.row.is_group ? ', heading' : '' }}</span>
                    <span v-if="f.row.status === 'inactive'" class="cw-pill cw-pill--mute">Inactive</span>
                  </span>
                </td>
                <td>{{ f.row.is_group ? 'Heading' : ROOT_LABEL[f.row.root_type] }}
                  <span v-if="f.row.account_type" class="cw-hint">{{ behaviourLabel(f.row.account_type) }}</span></td>
                <td v-for="c in currencies" :key="c" class="amt">
                  <template v-if="balanceOf(f.row, c)">
                    <span v-if="againstNature(f.row, balanceOf(f.row, c)!)" class="is-contra" :title="contraTitle(f.row)">
                      <span class="gl-bal">{{ formatMoney(balanceOf(f.row, c)!.amount, c, { bare: true }) }} {{ balanceOf(f.row, c)!.side }}</span>
                      <span class="gl-contra-note">against its usual side</span>
                    </span>
                    <span v-else class="gl-bal">{{ formatMoney(balanceOf(f.row, c)!.amount, c, { bare: true }) }} {{ balanceOf(f.row, c)!.side }}</span>
                  </template>
                  <span v-else class="cw-hint">—</span>
                </td>
                <td v-if="canManage" class="no-print"><div class="gl-actions">
                  <button type="button" class="cw-btn cw-btn--small gl-edit" :aria-label="`Edit ${f.row.code} ${f.row.name}`" @click.stop="openDialog('edit', f.row, $event)">Edit</button>
                  <button type="button" class="cw-btn cw-btn--small cw-btn--danger" :aria-label="`Withdraw ${f.row.code} ${f.row.name}`" @click.stop="openDialog('withdraw', f.row, $event)">Withdraw</button>
                </div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </template>

  <CwDialog v-if="dialog" :title="dialogTitle" :busy="busy" :opener="dialogOpener" form @close="closeDialog" @submit="submit">
        <template v-if="dialog.mode === 'withdraw'" #describe><p>Withdraw <strong>{{ dialog.row?.code }} {{ dialog.row?.name }}</strong> from the chart? An account with entries posted cannot be withdrawn.</p></template>
        <template v-if="dialog.mode !== 'withdraw'">
          <div v-if="dialog.mode === 'new'" class="cw-field">
            <label class="cw-label" for="ga-code">Code</label>
            <input id="ga-code" v-model="form.code" class="cw-input" required autocomplete="off" />
          </div>
          <div class="cw-field">
            <label class="cw-label" for="ga-name">Name</label>
            <input id="ga-name" v-model="form.name" class="cw-input" required />
          </div>
          <div v-if="dialog.mode === 'new'" class="cw-field">
            <label class="cw-label" for="ga-root">Type</label>
            <select id="ga-root" v-model="form.root_type" class="cw-select" aria-describedby="ga-root-hint">
              <option v-for="(label, root) in ROOT_LABEL" :key="root" :value="root">{{ label }}</option>
            </select>
            <span id="ga-root-hint" class="cw-hint">Fixed once set: it decides which statement the account appears on.</span>
          </div>
          <div class="cw-field">
            <label class="cw-label" for="ga-type">Behaviour</label>
            <select id="ga-type" v-model="form.account_type" class="cw-select" aria-describedby="ga-type-hint">
              <option value="">Not classified</option>
              <option v-for="b in BEHAVIOURS" :key="b.value" :value="b.value">{{ b.label }}</option>
            </select>
            <span id="ga-type-hint" class="cw-hint">Debtor ageing finds its bills in the receivable control, and the year-end closing moves the surplus into accumulated surplus.</span>
          </div>
          <div class="cw-field">
            <label class="cw-label" for="ga-parent">Sits beneath</label>
            <select id="ga-parent" v-model="form.parent_id" class="cw-select">
              <option value="">Nothing, a root of the chart</option>
              <option v-for="h in headings" :key="h.id" :value="h.id">{{ h.code }} {{ h.name }}</option>
            </select>
          </div>
          <label v-if="dialog.mode === 'new'" class="gl-check"><input v-model="form.is_group" type="checkbox" class="cw-check" /> This is a heading (nothing posts to it)</label>
          <div v-if="dialog.mode === 'edit'" class="cw-field">
            <label class="cw-label" for="ga-status">Status</label>
            <select id="ga-status" v-model="form.status" class="cw-select"><option value="active">Active</option><option value="inactive">Inactive</option></select>
          </div>
          <div class="cw-field">
            <label class="cw-label" for="ga-notes">Notes</label>
            <textarea id="ga-notes" v-model="form.notes" class="cw-input" rows="2" />
          </div>
        </template>
        <p v-if="dialogError" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ dialogError }}</p>
      <template #footer>
        <button type="button" class="cw-btn" :aria-disabled="busy || undefined" @click="closeDialog">Cancel</button>
        <!-- Disabled only while incomplete; while busy it stays focusable (aria-disabled) and submit() ignores it. -->
        <button type="submit" class="cw-btn" :class="dialog.mode === 'withdraw' ? 'cw-btn--danger' : 'cw-btn--primary'" :disabled="!canSubmit" :aria-disabled="busy || undefined">
          {{ busy ? 'Working' : dialog.mode === 'withdraw' ? 'Withdraw account' : dialog.mode === 'new' ? 'Add account' : 'Save changes' }}
        </button>
      </template>
  </CwDialog>
</template>

<style scoped>
.gl-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; padding: 14px 16px; margin-bottom: 12px; }
.gl-search { min-width: 220px; flex: 1; }
.gl-check { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; font-size: 13.5px; }
.gl-caption { text-align: left; padding: 10px 12px; font-size: 12.5px; color: var(--cw-ink-3); caption-side: top; }
.gl-table td.amt, .gl-table th.r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.gl-name { display: inline-flex; align-items: center; gap: 6px; }
.gl-code { font-variant-numeric: tabular-nums; color: var(--cw-ink-2); min-width: 52px; }
.gl-toggle { border: 0; background: none; padding: 2px; cursor: pointer; color: var(--cw-ink-2); display: inline-flex; }
.gl-toggle:focus-visible { outline: 2px solid var(--cw-accent); border-radius: 4px; }
.gl-toggle-gap { display: inline-block; width: 20px; }
.gl-group td { font-weight: 600; background: var(--cw-accent-softer); }
.gl-click { cursor: pointer; }
.gl-click:hover td { background: var(--cw-row-hover); }
.gl-off .gl-name { font-style: italic; } /* inactive: italic name and the "Inactive" pill; no opacity, which took the text below 4.5:1 */
.is-contra { color: var(--cw-neg); }
.gl-contra-note { display: block; font-size: 11.5px; font-weight: 500; }
.gl-actions { white-space: nowrap; display: flex; gap: 6px; }
</style>
