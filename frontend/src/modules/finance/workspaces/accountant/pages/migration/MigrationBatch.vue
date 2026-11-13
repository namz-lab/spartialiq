<script setup lang="ts">
/**
 * One file from the previous accounting package, from its columns to the ledger:
 * match the columns, check the file, settle each row that needs a person, commit, and (for the
 * balance loads) have somebody else post the opening vouchers.
 *
 * Nothing here decides what may be written. The server refuses a commit with rows undecided, a
 * trial balance that does not balance, and open items that disagree with their control account;
 * this screen shows the refusal as the server words it.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { AlertTriangle, Check, CircleCheck, FileSpreadsheet, RotateCcw, X } from 'lucide-vue-next'
import ReasonDialog from '../../../shared/ReasonDialog.vue'
import { migrationApi, type MigrationBatch, type MigrationProfiles, type MigrationRow, type RowDecision, type RowStatus } from '../../../../api/migrationApi'
import { ledgerApi } from '../../../../api/ledgerApi'
import { messageOf } from '../../../../stores/finance'
import { formatMoney, formatDateTime } from '../../../../composables/useMoney'
import type { LedgerAccount, LedgerParty } from '../../../../models/ledgerTypes'

const props = defineProps<{
  batchId: string; profiles: MigrationProfiles; accounts: LedgerAccount[]; userId: string | null
  canPrepare: boolean; canPost: boolean; open: boolean
}>()
const emit = defineEmits<{ (e: 'changed'): void; (e: 'close'): void }>()

const batch = ref<MigrationBatch | null>(null)
const sample = ref<(string | number | null)[][]>([])
const missing = ref<string[]>([])
const rows = ref<MigrationRow[]>([])
const rowTotal = ref(0)
const showing = ref<RowStatus>('problem')
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref<string | null>(null)
const withdrawing = ref(false)

const columnMap = reactive<Record<string, string>>({})
const categoryMap = reactive<Record<string, { root_type: string; account_type: string }>>({})
const declared = ref('')
const draft = reactive<Record<string, { action: string; root_type: string; account_type: string; ledger_account_id: string; party_id: string; note: string; new_code: string }>>({})
const partyHits = ref<LedgerParty[]>([])
const partyQuery = ref('')

const editable = computed(() => props.canPrepare && !!batch.value && ['uploaded', 'validated'].includes(batch.value.status))
const isBalance = computed(() => !!batch.value && ['opening_balance', 'comparison_balance'].includes(batch.value.load_kind))
const postable = computed(() => props.accounts.filter((a) => a.is_postable && !a.is_group && a.status === 'active'))
const iCommitted = computed(() => !!batch.value && batch.value.committed_by === props.userId)
const KIND_LABEL = computed(() => Object.fromEntries(props.profiles.loads.map((l) => [l.key, l.label])))
const STATUS: Record<string, { label: string; tone: string }> = {
  uploaded: { label: 'Not yet checked', tone: 'cw-pill--warn' }, validated: { label: 'Checked', tone: 'cw-pill--info' },
  committed: { label: 'Committed', tone: 'cw-pill--pos' }, cancelled: { label: 'Cancelled', tone: 'cw-pill--mute' },
  withdrawn: { label: 'Withdrawn', tone: 'cw-pill--mute' },
}
const TAB: Record<RowStatus, string> = { problem: 'Need a decision', ready: 'Will be loaded', set_aside: 'Set aside' }
const title = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

function adopt(b: MigrationBatch): void {
  batch.value = b
  for (const key of Object.keys(columnMap)) delete columnMap[key]
  for (const f of b.fields) columnMap[f.key] = b.column_map[f.key] ?? ''
  for (const key of Object.keys(categoryMap)) delete categoryMap[key]
  for (const [category, cls] of Object.entries(b.options.category_map ?? {})) {
    categoryMap[category] = { root_type: cls.root_type ?? '', account_type: cls.account_type ?? '' }
  }
  declared.value = b.declared_total ?? ''
}

async function loadRows(): Promise<void> {
  if (!batch.value || batch.value.status === 'uploaded') { rows.value = []; rowTotal.value = 0; return }
  const page = await migrationApi.rows(batch.value.id, { status: showing.value, limit: 100 })
  rows.value = page.rows
  rowTotal.value = page.total
  for (const r of page.rows) {
    draft[r.id] ??= {
      action: r.problems[0]?.candidates?.length ? 'map' : defaultAction(), root_type: '', account_type: '',
      ledger_account_id: '', party_id: r.problems[0]?.candidates?.[0]?.id ?? '', note: '', new_code: '',
    }
  }
}
function defaultAction(): string {
  const kind = batch.value?.load_kind
  return kind === 'chart' ? 'create' : 'map'
}

async function load(): Promise<void> {
  error.value = null
  try {
    const got = await migrationApi.batch(props.batchId)
    adopt(got.batch)
    sample.value = got.sample.map((s) => s.raw)
    missing.value = got.missing_columns
    showing.value = got.batch.rows_problem > 0 ? 'problem' : 'ready'
    await loadRows()
  } catch (err) {
    error.value = messageOf(err, 'The file could not be read.')
  }
}
onMounted(() => { if (props.open) void load() })
watch(() => props.open, (o) => { if (o && !batch.value) void load() })
watch(showing, () => { void loadRows() })

/** Run one act, show the server's own words if it refuses, and tell the page something changed. */
async function act(name: string, work: () => Promise<string | void>, fallback: string): Promise<void> {
  if (busy.value) return
  busy.value = name
  error.value = null
  notice.value = null
  try {
    const said = await work()
    if (said) notice.value = said
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, fallback)
  } finally {
    busy.value = null
  }
}

const sampleOf = (header: string): string => {
  const index = batch.value?.headers.indexOf(header) ?? -1
  if (index < 0) return ''
  return sample.value.map((r) => r[index]).filter((v) => v !== null && v !== undefined && v !== '').slice(0, 2).join(', ')
}

function saveAndCheck(): Promise<void> {
  return act('check', async () => {
    const saved = await migrationApi.saveMapping(props.batchId, {
      column_map: { ...columnMap },
      ...(batch.value?.load_kind === 'chart' ? { category_map: { ...categoryMap } } : {}),
      ...(isBalance.value ? { declared_total: declared.value.trim() } : {}),
    })
    missing.value = saved.missing_columns
    if (saved.missing_columns.length) { adopt(saved.batch); return }
    adopt(await migrationApi.validate(props.batchId))
    showing.value = batch.value && batch.value.rows_problem > 0 ? 'problem' : 'ready'
    await loadRows()
  }, 'The file could not be checked.')
}

function decide(row: MigrationRow): Promise<void> {
  const d = draft[row.id]
  const decision: RowDecision = { action: d.action as RowDecision['action'] }
  if (d.action === 'create' && batch.value?.load_kind === 'chart') {
    if (d.root_type) decision.root_type = d.root_type as RowDecision['root_type']
    decision.account_type = d.account_type as RowDecision['account_type']
    if (d.new_code.trim()) decision.new_code = d.new_code.trim()
  }
  if (d.action === 'map') {
    if (batch.value?.load_kind === 'parties' || batch.value?.load_kind === 'open_items') decision.party_id = d.party_id
    else decision.ledger_account_id = d.ledger_account_id
  }
  if (d.action === 'set_aside') decision.note = d.note.trim()
  return act(`row-${row.id}`, async () => {
    adopt(await migrationApi.decide(props.batchId, [row.id], decision))
    await loadRows()
  }, 'The decision could not be recorded.')
}
const decidable = (row: MigrationRow): boolean => {
  const d = draft[row.id]
  if (!d) return false
  if (d.action === 'set_aside') return d.note.trim().length >= 3
  if (d.action === 'map') return batch.value?.load_kind === 'parties' || batch.value?.load_kind === 'open_items' ? !!d.party_id : !!d.ledger_account_id
  return true
}
const undo = (row: MigrationRow): Promise<void> => act(`row-${row.id}`, async () => {
  adopt(await migrationApi.decide(props.batchId, [row.id], { action: 'clear' }))
  await loadRows()
}, 'The decision could not be undone.')

/** The actions a person may take on a row that needs them, by load. */
const actions = computed<{ key: string; label: string }[]>(() => {
  switch (batch.value?.load_kind) {
    case 'chart': return [{ key: 'create', label: 'Load as a new account' }, { key: 'map', label: 'It is this existing account' }, { key: 'set_aside', label: 'Retire, do not bring across' }]
    case 'parties': return [{ key: 'map', label: 'It is this existing party' }, { key: 'create', label: 'A different party, bring it across' }, { key: 'set_aside', label: 'Do not bring across' }]
    case 'open_items': return [{ key: 'map', label: 'It belongs to this party' }]
    case 'comparison_balance': return [{ key: 'map', label: 'Map to a ledger account' }, { key: 'set_aside', label: 'No account here, explain in the reconciliation' }]
    default: return [{ key: 'map', label: 'Map to a ledger account' }]
  }
})

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(partyQuery, (q) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    if (q.trim().length < 2) { partyHits.value = []; return }
    try { partyHits.value = (await ledgerApi.parties({ q: q.trim(), limit: 20 })).parties } catch { partyHits.value = [] }
  }, 250)
})
const partyChoices = (row: MigrationRow): { id: string; label: string }[] => {
  const seen = new Set<string>()
  const out: { id: string; label: string }[] = []
  for (const c of [...(row.problems.flatMap((p) => p.candidates ?? [])), ...partyHits.value]) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    out.push({ id: c.id, label: c.reference ? `${c.name} (${c.reference})` : c.name })
  }
  return out
}

const commit = (): Promise<void> => act('commit', async () => {
  const done = await migrationApi.commit(props.batchId)
  adopt(done.batch)
  showing.value = 'ready'
  await loadRows()
  return done.note
}, 'The file could not be committed.')
const post = (): Promise<void> => act('post', async () => {
  const done = await migrationApi.post(props.batchId)
  adopt(done.batch)
  return done.note
}, 'The opening vouchers could not be posted.')
const cancel = (): Promise<void> => act('cancel', async () => {
  await migrationApi.cancel(props.batchId)
  await load()
}, 'The file could not be cancelled.')
const withdraw = (reason: string): Promise<void> => act('withdraw', async () => {
  await migrationApi.withdraw(props.batchId, reason)
  withdrawing.value = false
  await load()
}, 'The load could not be withdrawn.')
const reconcile = (): Promise<void> => act('reconcile', async () => {
  await migrationApi.reconcile(props.batchId)
  await load()
  return 'The reconciliation has been drawn up. It is in the Reconciliation step below.'
}, 'The reconciliation could not be drawn up.')

const cells = (row: MigrationRow): string => row.raw.filter((v) => v !== null && v !== '').slice(0, 5).join(' · ')
const resultLines = computed<string[]>(() => {
  const r = batch.value?.result
  if (!r) return []
  const cur = batch.value?.currency ?? 'USD'
  const out: string[] = []
  if (r.accounts_created !== undefined) out.push(`${r.accounts_created} account(s) created, ${r.codes_mapped} mapped to accounts already in the chart, ${r.codes_retired} retired`)
  if (r.parties_created !== undefined) out.push(`${r.parties_created} created, ${r.parties_matched} matched to parties already in the register, ${r.rows_set_aside} left behind`)
  if (r.voucher_no) out.push(`Opening voucher ${r.voucher_no}: ${r.lines} lines, debits ${formatMoney(String(r.debit_total), cur)}, credits ${formatMoney(String(r.credit_total), cur)}`)
  if (r.vouchers !== undefined) out.push(`${r.vouchers} opening voucher(s) totalling ${formatMoney(String(r.items_total), cur)}, equal to the control account in ${r.opening_voucher_no}`)
  return out
})
</script>

<template>
  <div v-if="open" class="mg-batch">
    <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
    <p v-if="notice" class="cw-banner-msg cw-banner-msg--pos" role="status"><CircleCheck :size="18" aria-hidden="true" />{{ notice }}</p>
    <div v-if="!batch && !error"><span class="cw-skel" /><span class="cw-skel" /></div>

    <template v-if="batch">
      <header class="mg-batch-head">
        <FileSpreadsheet :size="22" aria-hidden="true" />
        <div>
          <strong>{{ batch.original_filename }}</strong>
          <div class="cw-hint">
            {{ KIND_LABEL[batch.load_kind] }}<template v-if="batch.currency"> · {{ batch.currency }}</template>
            <template v-if="batch.item_side"> · {{ title(batch.item_side) }}</template>
            · {{ batch.rows_total }} rows · uploaded by {{ batch.uploaded_by_name ?? 'somebody' }}, {{ formatDateTime(batch.uploaded_at) }}
          </div>
        </div>
        <span class="cw-pill" :class="STATUS[batch.status].tone">{{ STATUS[batch.status].label }}</span>
        <button type="button" class="cw-icon-btn" aria-label="Close this file" @click="emit('close')"><X :size="18" /></button>
      </header>

      <!-- 1. Columns -->
      <section v-if="editable" :aria-label="`Columns of ${batch.original_filename}`">
        <h4 class="mg-h">1. Which column holds what</h4>
        <p class="cw-hint">Matched from the column headings. Correct any that are wrong; leave a field on "Not in this file" if the file does not carry it.</p>
        <p v-if="missing.length" class="cw-banner-msg cw-banner-msg--warn" role="alert"><AlertTriangle :size="18" aria-hidden="true" />Say which column holds: {{ missing.join('; ') }}.</p>
        <div class="mg-map">
          <label v-for="f in batch.fields" :key="f.key" class="cw-field">
            <span class="cw-label">{{ f.label }}</span>
            <select v-model="columnMap[f.key]" class="cw-select">
              <option value="">Not in this file</option>
              <option v-for="h in batch.headers" :key="h" :value="h">{{ h }}</option>
            </select>
            <span v-if="columnMap[f.key] && sampleOf(columnMap[f.key])" class="cw-hint">e.g. {{ sampleOf(columnMap[f.key]) }}</span>
          </label>
        </div>

        <template v-if="batch.load_kind === 'chart' && Object.keys(categoryMap).length">
          <h4 class="mg-h">Class of each category</h4>
          <p class="cw-hint">Suggested from the old package's own category names. An account's class is the Council's data, so check each one. A category left blank makes its accounts wait for a decision.</p>
          <div class="cw-table-wrap">
            <table class="cw-table">
              <thead><tr><th>Category in the file</th><th>Statement class</th><th>Behaves as</th></tr></thead>
              <tbody>
                <tr v-for="(cls, category) in categoryMap" :key="category">
                  <td>{{ category }}</td>
                  <td><select v-model="cls.root_type" class="cw-select" :aria-label="`Class of ${category}`">
                    <option value="">Not classed</option>
                    <option v-for="r in profiles.root_types" :key="r" :value="r">{{ title(r) }}</option>
                  </select></td>
                  <td><select v-model="cls.account_type" class="cw-select" :aria-label="`Behaviour of ${category}`">
                    <option value="">An ordinary account</option>
                    <option v-for="t in profiles.account_types" :key="t" :value="t">{{ title(t) }}</option>
                  </select></td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <label v-if="isBalance" class="cw-field" style="max-width: 320px">
          <span class="cw-label">Control total (optional)</span>
          <input v-model="declared" class="cw-input" inputmode="decimal" placeholder="Total debits on the printed trial balance" />
          <span class="cw-hint">From the old package's own printed report. The file is refused if it totals differently.</span>
        </label>

        <div class="mg-actions">
          <button type="button" class="cw-btn cw-btn--primary" :disabled="!!busy" @click="saveAndCheck">{{ busy === 'check' ? 'Checking…' : batch.status === 'validated' ? 'Save and check again' : 'Save and check the file' }}</button>
          <button type="button" class="cw-btn" :disabled="!!busy" @click="cancel">Cancel this file</button>
        </div>
      </section>

      <!-- 2. What the check found -->
      <section v-if="batch.status !== 'uploaded'" aria-label="What the check found">
        <h4 v-if="editable" class="mg-h">2. What the check found</h4>
        <dl class="mg-counts">
          <div><dt>Will be loaded</dt><dd>{{ batch.rows_ready }}</dd></div>
          <div :class="{ 'mg-counts--warn': batch.rows_problem > 0 }"><dt>Need a decision</dt><dd>{{ batch.rows_problem }}</dd></div>
          <div><dt>Set aside</dt><dd>{{ batch.rows_set_aside }}</dd></div>
          <template v-if="isBalance && batch.currency">
            <div><dt>Debits</dt><dd>{{ formatMoney(batch.total_debit ?? '0', batch.currency) }}</dd></div>
            <div><dt>Credits</dt><dd>{{ formatMoney(batch.total_credit ?? '0', batch.currency) }}</dd></div>
          </template>
        </dl>
        <p v-if="batch.load_kind === 'opening_balance' && batch.status === 'validated' && batch.rows_problem === 0 && batch.total_debit !== batch.total_credit"
           class="cw-banner-msg cw-banner-msg--warn" role="alert">
          <AlertTriangle :size="18" aria-hidden="true" />Debits and credits differ, so this trial balance will be refused. Find the missing account in the old package; no balancing figure is added here.
        </p>

        <div class="cw-seg mg-tabs" role="group" aria-label="Rows to show">
          <button v-for="(label, key) in TAB" :key="key" type="button" :aria-pressed="showing === key" @click="showing = key">{{ label }}</button>
        </div>
        <div class="cw-table-wrap">
          <p v-if="!rows.length" class="cw-empty"><strong>{{ showing === 'problem' ? 'No row needs a decision.' : 'No rows.' }}</strong></p>
          <table v-else class="cw-table mg-rows">
            <thead><tr><th>Row</th><th>In the file</th><th>{{ showing === 'problem' ? 'Why it waits, and your decision' : showing === 'ready' ? 'What will be written' : 'Why it is set aside' }}</th></tr></thead>
            <tbody>
              <tr v-for="row in rows" :key="row.id">
                <td>{{ row.row_no }}</td>
                <td>{{ cells(row) }}</td>
                <td v-if="showing === 'problem'">
                  <p v-for="(p, i) in row.problems" :key="i" class="mg-problem">{{ p.message }}</p>
                  <form v-if="editable && draft[row.id]" class="mg-decide" @submit.prevent="decide(row)">
                    <select v-model="draft[row.id].action" class="cw-select" :aria-label="`Decision for row ${row.row_no}`">
                      <option v-for="a in actions" :key="a.key" :value="a.key">{{ a.label }}</option>
                    </select>
                    <template v-if="draft[row.id].action === 'create' && batch.load_kind === 'chart'">
                      <select v-model="draft[row.id].root_type" class="cw-select" aria-label="Statement class">
                        <option value="">Class from its category</option>
                        <option v-for="r in profiles.root_types" :key="r" :value="r">{{ title(r) }}</option>
                      </select>
                      <select v-model="draft[row.id].account_type" class="cw-select" aria-label="Behaves as">
                        <option value="">An ordinary account</option>
                        <option v-for="t in profiles.account_types" :key="t" :value="t">{{ title(t) }}</option>
                      </select>
                      <input v-model="draft[row.id].new_code" class="cw-input" placeholder="New number (if taken)" aria-label="New account number" />
                    </template>
                    <template v-else-if="draft[row.id].action === 'map' && (batch.load_kind === 'parties' || batch.load_kind === 'open_items')">
                      <input v-model="partyQuery" class="cw-input" placeholder="Search the party register" aria-label="Search the party register" />
                      <select v-model="draft[row.id].party_id" class="cw-select" aria-label="Party">
                        <option value="">Choose a party</option>
                        <option v-for="c in partyChoices(row)" :key="c.id" :value="c.id">{{ c.label }}</option>
                      </select>
                    </template>
                    <select v-else-if="draft[row.id].action === 'map'" v-model="draft[row.id].ledger_account_id" class="cw-select" aria-label="Ledger account">
                      <option value="">Choose a ledger account</option>
                      <option v-for="a in (batch.load_kind === 'chart' ? accounts : postable)" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option>
                    </select>
                    <input v-else-if="draft[row.id].action === 'set_aside'" v-model="draft[row.id].note" class="cw-input" placeholder="Reason, kept on the record" aria-label="Reason" />
                    <button type="submit" class="cw-btn cw-btn--small cw-btn--primary" :disabled="!!busy || !decidable(row)"><Check :size="15" aria-hidden="true" /> Decide</button>
                  </form>
                </td>
                <td v-else>
                  <template v-if="row.parsed.maps_to">{{ row.parsed.action === 'map' || !row.parsed.action ? '→ ' : '' }}{{ row.parsed.maps_to }}</template>
                  <template v-else-if="row.parsed.action === 'create'">New {{ row.parsed.root_type ?? row.parsed.party_type }}<template v-if="row.parsed.account_type"> ({{ title(String(row.parsed.account_type)) }})</template></template>
                  <template v-else>{{ row.parsed.note ?? (row.parsed.action === 'retire' ? `Retired: ${row.decision.note ?? ''}` : '') }}</template>
                  <button v-if="editable && Object.keys(row.decision).length" type="button" class="cw-link" :disabled="!!busy" @click="undo(row)"><RotateCcw :size="14" aria-hidden="true" /> Undo my decision</button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="rowTotal > rows.length" class="cw-hint" style="padding: 8px 2px">Showing the first {{ rows.length }} of {{ rowTotal }}.</p>
        </div>
      </section>

      <!-- 3. Commit -->
      <section v-if="editable && batch.status === 'validated'" aria-label="Commit">
        <h4 class="mg-h">3. Commit</h4>
        <p v-if="batch.rows_problem > 0" class="cw-hint">{{ batch.rows_problem }} row(s) still need a decision. Every row is either loaded or set aside with a reason.</p>
        <div class="mg-actions">
          <button type="button" class="cw-btn cw-btn--primary" :disabled="!!busy || batch.rows_problem > 0" @click="commit">{{ busy === 'commit' ? 'Committing…' : 'Commit this file' }}</button>
        </div>
      </section>

      <!-- After commit -->
      <section v-if="batch.status === 'committed' || batch.status === 'withdrawn'" aria-label="Result">
        <p v-for="line in resultLines" :key="line" class="mg-result">{{ line }}</p>
        <p class="cw-hint">Committed by {{ batch.committed_by_name ?? 'somebody' }}, {{ formatDateTime(batch.committed_at) }}.</p>
        <p v-if="batch.status === 'withdrawn'" class="cw-banner-msg cw-banner-msg--warn">Withdrawn: {{ batch.withdraw_reason }}</p>
        <template v-if="batch.status === 'committed' && (batch.vouchers_draft > 0 || batch.vouchers_posted > 0)">
          <p v-if="batch.vouchers_draft > 0 && iCommitted" class="cw-banner-msg cw-banner-msg--info" role="status">
            {{ batch.vouchers_draft }} opening voucher(s) are drafts. You loaded them, so somebody else posts them: nothing is in the ledger until they do.
          </p>
          <p v-else-if="batch.vouchers_draft > 0 && !canPost" class="cw-banner-msg cw-banner-msg--info" role="status">
            {{ batch.vouchers_draft }} opening voucher(s) are waiting to be posted by somebody who may post vouchers.
          </p>
          <p v-else-if="batch.vouchers_draft === 0" class="cw-banner-msg cw-banner-msg--pos" role="status"><CircleCheck :size="18" aria-hidden="true" />{{ batch.vouchers_posted }} opening voucher(s) posted to the ledger.</p>
          <div class="mg-actions">
            <button v-if="batch.vouchers_draft > 0 && canPost && !iCommitted" type="button" class="cw-btn cw-btn--primary" :disabled="!!busy" @click="post">{{ busy === 'post' ? 'Posting…' : `Post ${batch.vouchers_draft} opening voucher(s)` }}</button>
            <button v-if="batch.load_kind === 'opening_balance' && batch.vouchers_draft === 0 && canPrepare" type="button" class="cw-btn cw-btn--outline" :disabled="!!busy" @click="reconcile">{{ batch.reconciliation_id ? 'Draw up the reconciliation again' : 'Reconcile against the ledger' }}</button>
            <button v-if="canPrepare" type="button" class="cw-btn" :disabled="!!busy" @click="withdrawing = true">Withdraw this load</button>
          </div>
        </template>
      </section>
    </template>

    <ReasonDialog
      v-if="withdrawing" title="Withdraw this load" label="Reason" :min-length="3" submit-label="Withdraw" danger :busy="busy === 'withdraw'" :error="error"
      message="Draft opening vouchers are discarded. A load whose vouchers are posted can be withdrawn only after each has been reversed."
      @submit="withdraw" @close="withdrawing = false"
    />
  </div>
</template>

<style scoped>
.mg-batch { display: flex; flex-direction: column; gap: 14px; padding: 14px; border: 1px solid var(--cw-line); border-radius: 10px; background: #fbfcfe; }
.mg-batch section { display: flex; flex-direction: column; gap: 10px; }
.mg-batch-head { display: flex; align-items: center; gap: 10px; }
.mg-batch-head > div { flex: 1; min-width: 0; }
.mg-batch-head strong { overflow-wrap: anywhere; }
.mg-h { margin: 6px 0 0; font-size: 14px; font-weight: 650; }
.mg-map { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.mg-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.mg-counts { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin: 0; }
.mg-counts > div { padding: 10px 12px; border: 1px solid var(--cw-line); border-radius: 8px; background: #fff; }
.mg-counts dt { font-size: 12.5px; color: var(--cw-ink-2); }
.mg-counts dd { margin: 2px 0 0; font-size: 18px; font-weight: 650; font-variant-numeric: tabular-nums; }
.mg-counts--warn { border-color: var(--cw-warn) !important; }
.mg-counts--warn dd { color: var(--cw-warn); }
.mg-tabs { max-width: 480px; }
.mg-rows td { vertical-align: top; overflow-wrap: anywhere; }
.mg-problem { margin: 0 0 6px; color: #7a4300; }
.mg-decide { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.mg-decide .cw-select, .mg-decide .cw-input { flex: 1 1 190px; min-width: 0; }
.mg-result { margin: 0; font-weight: 600; }
</style>
