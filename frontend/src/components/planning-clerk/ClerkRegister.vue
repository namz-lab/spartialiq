<script setup lang="ts">
// One register screen, for all nine of them.
//
// WHY THIS EXISTS
// The nine registers in migration 125 are the same shape on screen as they
// are in the database: a searchable, dated list of entries against a file,
// written by a named officer, exported as CSV, never deleted. Nine
// hand-written sections would be nine copies of the search box, the empty
// state, the paging, the void confirmation and the CSV button — and nine
// chances for one of them to forget that a voided entry must still be
// visible, or to offer a delete that the server does not have.
//
// The sections that use it stay small and say only what is different about
// their register: which fields, which columns, and what extra judgement
// belongs at the top (the day's takings, the letters past their date).
//
// WHAT IT IS NOT
// It is not a generic CRUD table. It knows what a clerk's register is: that
// `permit_application_id` is the open file rather than something to type,
// that an entry is voided rather than deleted, and that a voided entry is
// struck through in place rather than removed. A screen that needed none of
// that should not use this.

import { computed, onMounted, ref, watch } from 'vue'
import {
  listRegister, createEntry, voidEntry, exportRegister,
  errorMessage, errorFields,
  type RegisterKey, type RegisterQuery, type RegisterRowBase,
} from '@/services/planningClerk'
import { useClerkNav } from '@/planning-clerk/useClerkConsole'
import { useClerkOverview } from '@/planning-clerk/useClerkOverview'
import type { ClerkColumn, ClerkField } from '@/planning-clerk/registerSpec'
import UiButton from '@/components/ui/UiButton.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import {
  Search, Download, Plus, RefreshCw, Ban, AlertTriangle, Inbox,
  FolderOpen, ChevronLeft, ChevronRight, CheckCircle2,
} from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  register: RegisterKey
  title: string
  lede?: string
  columns: ClerkColumn[]
  fields: ClerkField[]
  /** The label on the button that opens the form. */
  addLabel?: string
  /**
   * Whether an entry must be filed against a file.
   *
   * True for the registers whose table says NOT NULL. The form then refuses
   * to open without one and says to find a file first, rather than letting
   * the clerk fill in eight boxes and be refused by the server at the end.
   */
  requiresFile?: boolean
  /** Extra server-side filters this register always applies. */
  baseQuery?: RegisterQuery
  /** Placeholder for the search box — name the columns actually searched. */
  searchHint?: string
}>(), {
  addLabel: 'Add entry',
  requiresFile: false,
  searchHint: 'Search this register',
})

const nav = useClerkNav()
const overview = useClerkOverview()

type Row = RegisterRowBase & Record<string, unknown>

const rows = ref<Row[]>([])
const total = ref(0)
const offset = ref(0)
const PAGE = 50
const loading = ref(false)
const loadError = ref<string | null>(null)

// Search is bound to the URL, so a filtered register is a link the clerk can
// send. Debounced before it reaches the router AND the server: typing six
// characters should not be six history entries or six requests.
const search = ref(nav.param('q'))
const includeVoided = ref(false)
const onlyThisFile = ref(true)

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    nav.setParam('q', value.trim() || null)
    offset.value = 0
    void load()
  }, 260)
})

/**
 * Whether the list is narrowed to the open file.
 *
 * On by default when a file is open, because a clerk who has just opened a
 * file and moved to the correspondence log means "this file's post". The
 * toggle is there because the answer is sometimes no.
 */
const filterPermit = computed(() =>
  onlyThisFile.value && nav.permit.value ? nav.permit.value : undefined)

const query = computed<RegisterQuery>(() => ({
  ...props.baseQuery,
  q: search.value.trim() || undefined,
  permit: filterPermit.value,
  includeVoided: includeVoided.value || undefined,
  limit: PAGE,
  offset: offset.value,
}))

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const page = await listRegister(props.register, query.value)
    // Through `unknown`: the nine row types are a union and `Row` is their
    // common shape plus an index signature, which TypeScript will not narrow
    // to directly. The table only ever reads columns the section declared.
    rows.value = page.rows as unknown as Row[]
    total.value = page.total
  } catch (err) {
    // Never fall back to an empty list: "nothing was logged" and "the server
    // could not be reached" look identical on screen and mean opposite things
    // to a clerk about to tell somebody their letter went out.
    loadError.value = errorMessage(err, 'Could not read this register.')
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([() => props.register, filterPermit, includeVoided], () => {
  offset.value = 0
  void load()
})

const page = computed(() => Math.floor(offset.value / PAGE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE)))
function step(by: number) {
  const next = offset.value + by * PAGE
  if (next < 0 || next >= total.value) return
  offset.value = next
  void load()
}

// ── Add an entry ────────────────────────────────────────────────────────

const formOpen = ref(false)
// Bound to <input>, so the values are the primitives a control can hold.
// Anything richer would have to be serialised before it reached the wire
// anyway, and a register field that is not a string, a number or a tick is
// a field that belongs in its own control rather than in this form.
type FormValue = string | number | boolean
const form = ref<Record<string, FormValue>>({})
const formError = ref<string | null>(null)
const formFields = ref<Record<string, string>>({})
const saving = ref(false)
const justSaved = ref<string | null>(null)

function openForm() {
  form.value = Object.fromEntries(props.fields.map((f) => [
    f.name,
    typeof f.initial === 'function' ? f.initial()
      : f.initial !== undefined ? f.initial
      : f.type === 'checkbox' ? false : '',
  ]))
  formError.value = null
  formFields.value = {}
  formOpen.value = true
}

const canOpenForm = computed(() => !props.requiresFile || !!nav.permit.value)

async function save() {
  saving.value = true
  formError.value = null
  formFields.value = {}
  try {
    const body: Record<string, unknown> = {}
    for (const field of props.fields) {
      const value: FormValue | undefined = form.value[field.name]
      // An untouched optional box is absent, not an empty string: the server
      // refuses to clear a non-nullable column, and sending '' for one the
      // clerk simply did not fill in would fail the whole entry.
      if (value === '' || value === undefined || value === null) {
        if (field.required) body[field.name] = value
        continue
      }
      body[field.name] = field.type === 'number' ? Number(value) : value
    }
    if (nav.permit.value && props.fields.every((f) => f.name !== 'permit_application_id')) {
      body.permit_application_id = nav.permit.value
    }

    const created = await createEntry(props.register, body)
    formOpen.value = false
    justSaved.value = created.id
    // The badge in the rail, the day's takings and the open file all move
    // when a register does; invalidate() is the one call that keeps them level.
    overview.invalidate()
    offset.value = 0
    await load()
    setTimeout(() => { justSaved.value = null }, 6000)
  } catch (err) {
    formError.value = errorMessage(err, 'The entry was not written.')
    formFields.value = errorFields(err)
  } finally {
    saving.value = false
  }
}

// ── Void an entry ───────────────────────────────────────────────────────
// Not "delete": a register a clerk can delete rows from is not evidence. The
// row stays, struck through, with the reason and the officer's name.

const voidTarget = ref<Row | null>(null)
const voidReason = ref('')
const voidError = ref<string | null>(null)
const voiding = ref(false)

function askVoid(row: Row) {
  voidTarget.value = row
  voidReason.value = ''
  voidError.value = null
}

async function confirmVoid() {
  if (!voidTarget.value || !voidReason.value.trim()) return
  voiding.value = true
  voidError.value = null
  try {
    await voidEntry(props.register, voidTarget.value.id, voidReason.value.trim())
    voidTarget.value = null
    overview.invalidate()
    await load()
  } catch (err) {
    voidError.value = errorMessage(err, 'The entry was not voided.')
  } finally {
    voiding.value = false
  }
}

// ── Export ──────────────────────────────────────────────────────────────

const exporting = ref(false)
const exportError = ref<string | null>(null)
async function download() {
  exporting.value = true
  exportError.value = null
  try {
    // The visible filters, not the visible page: a clerk exporting a filtered
    // register means the filter, and would not expect only the first fifty.
    await exportRegister(props.register, { ...query.value, limit: undefined, offset: undefined })
  } catch (err) {
    exportError.value = errorMessage(err, 'The register could not be exported.')
  } finally {
    exporting.value = false
  }
}

// ── Cells ───────────────────────────────────────────────────────────────

function cell(row: Row, column: ClerkColumn): string {
  if (column.value) return column.value(row)
  const raw = row[column.key]
  if (raw === null || raw === undefined || raw === '') return '—'
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No'
  return String(raw)
}

defineExpose({ reload: load })
</script>

<template>
  <section class="ins-card clk-reg">
    <header class="ins-card-head clk-reg-head">
      <h3>
        {{ title }}
        <span class="ins-count">{{ total }}</span>
      </h3>

      <div class="ins-actions">
        <UiButton size="sm" variant="ghost" :disabled="loading"
                  title="Re-read this register" @click="load()">
          <template #icon><RefreshCw :size="14" :class="{ 'ins-spin': loading }" /></template>
          Refresh
        </UiButton>
        <UiButton size="sm" variant="secondary" :loading="exporting" @click="download">
          <template #icon><Download :size="14" /></template>
          CSV
        </UiButton>
        <UiButton size="sm" variant="primary" :disabled="!canOpenForm" @click="openForm">
          <template #icon><Plus :size="14" /></template>
          {{ addLabel }}
        </UiButton>
      </div>
    </header>

    <div class="ins-card-body clk-reg-body">
      <p v-if="lede" class="ins-lede clk-reg-lede">{{ lede }}</p>

      <!-- Anything the section wants above the table: the day's takings, the
           letters past their date, a warning about the register itself. -->
      <slot name="summary" :rows="rows" :total="total" />

      <div class="clk-reg-filters">
        <label class="ins-search clk-reg-search">
          <Search :size="15" aria-hidden="true" />
          <span class="ent-sr-only">{{ searchHint }}</span>
          <input v-model="search" type="search" :placeholder="searchHint" />
        </label>

        <label v-if="nav.permit.value" class="clk-reg-toggle">
          <input v-model="onlyThisFile" type="checkbox" />
          <FolderOpen :size="13" aria-hidden="true" />
          <span>Only the open file</span>
        </label>

        <label class="clk-reg-toggle">
          <input v-model="includeVoided" type="checkbox" />
          <span>Show voided entries</span>
        </label>
      </div>

      <p v-if="requiresFile && !nav.permit.value" class="ins-banner t-info clk-reg-note">
        <FolderOpen :size="15" aria-hidden="true" />
        <span>
          An entry in this register belongs to a file. Open one from
          <button type="button" class="clk-reg-link" @click="nav.go('search')">Find a file</button>
          before adding.
        </span>
      </p>

      <p v-if="loadError" class="ins-banner t-negative" role="alert">
        <AlertTriangle :size="15" aria-hidden="true" />
        <span>{{ loadError }}</span>
      </p>
      <p v-if="exportError" class="ins-banner t-negative" role="alert">
        <AlertTriangle :size="15" aria-hidden="true" />
        <span>{{ exportError }}</span>
      </p>

      <!-- Loading is skeleton rows, not a spinner over an empty box: the
           table's shape stays put, so nothing jumps when the rows land. -->
      <div v-if="loading && !rows.length" class="clk-reg-loading" aria-busy="true">
        <span v-for="n in 6" :key="n" class="ins-skel" />
        <span class="ent-sr-only">Reading the register</span>
      </div>

      <div v-else-if="rows.length" class="clk-reg-scroll">
        <table class="clk-reg-table">
          <thead>
            <tr>
              <th v-for="c in columns" :key="c.key"
                  :class="{ sec: c.secondary, nowrap: c.nowrap }" scope="col">
                {{ c.label }}
              </th>
              <th class="clk-reg-actions-col"><span class="ent-sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id"
                :class="{ voided: !!row.voided_at, fresh: row.id === justSaved }">
              <td v-for="c in columns" :key="c.key"
                  :class="{ sec: c.secondary, nowrap: c.nowrap }">
                <span v-if="c.tone && c.tone(row)" class="clk-reg-chip" :class="`t-${c.tone(row)}`">
                  {{ cell(row, c) }}
                </span>
                <span v-else :class="{ 'ins-mono': c.mono }">{{ cell(row, c) }}</span>
              </td>
              <td class="clk-reg-actions-col">
                <!-- Per-row extras: "mark sent", "record the return". -->
                <slot name="row-actions" :row="row" :reload="load" />
                <button v-if="!row.voided_at" type="button" class="clk-reg-void"
                        :title="`Void this entry`" @click="askVoid(row)">
                  <Ban :size="13" aria-hidden="true" />
                  <span class="ent-sr-only">Void this entry</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- The reason a voided row is still here, said once rather than per row. -->
        <p v-if="rows.some(r => r.voided_at)" class="clk-reg-voidnote">
          Struck-through entries were voided. They stay in the register with
          the reason and the officer’s name — there is no delete.
        </p>
      </div>

      <div v-else class="clk-reg-empty">
        <Inbox :size="22" aria-hidden="true" />
        <p v-if="search || filterPermit">
          Nothing in this register matches the current filters.
        </p>
        <p v-else>
          Nothing has been written to this register yet.
        </p>
        <UiButton v-if="canOpenForm" size="sm" variant="secondary" @click="openForm">
          <template #icon><Plus :size="14" /></template>
          {{ addLabel }}
        </UiButton>
      </div>

      <div v-if="pages > 1" class="clk-reg-pager">
        <UiButton size="sm" variant="ghost" :disabled="offset === 0 || loading" @click="step(-1)">
          <template #icon><ChevronLeft :size="14" /></template>
          Previous
        </UiButton>
        <span class="clk-reg-page">Page {{ page }} of {{ pages }} · {{ total }} entries</span>
        <UiButton size="sm" variant="ghost"
                  :disabled="offset + rows.length >= total || loading" @click="step(1)">
          Next
          <template #icon><ChevronRight :size="14" /></template>
        </UiButton>
      </div>
    </div>

    <!-- ── Add an entry ───────────────────────────────────────────────── -->
    <UiSheet :open="formOpen" :title="addLabel" :subtitle="title" width="40rem"
             @close="formOpen = false" @update:open="formOpen = $event">
      <form class="clk-form" @submit.prevent="save">
        <!-- The file this will be written against, named before the clerk
             fills anything in. The old console made the clerk paste a UUID
             into a text box; this is the same information, read off the bar
             they already have open. -->
        <p v-if="overview.file.value" class="ins-banner t-info">
          <FolderOpen :size="15" aria-hidden="true" />
          <span>
            Filed against
            <strong class="ins-mono">
              {{ overview.file.value.permit.tpd_reference
                 || overview.file.value.permit.dev_register_no || 'this file' }}</strong>
            — {{ overview.file.value.permit.applicant_name }},
            stand {{ overview.file.value.permit.stand_number || '—' }}.
          </span>
        </p>
        <p v-else-if="!requiresFile" class="ins-hint">
          No file is open, so this entry will be filed on its own. That is
          normal for post that arrives before there is an application to
          attach it to.
        </p>

        <p v-if="formError" class="ins-banner t-negative" role="alert">
          <AlertTriangle :size="15" aria-hidden="true" />
          <span>{{ formError }}</span>
        </p>

        <div class="ins-form">
          <div v-for="f in fields" :key="f.name" class="ins-field" :class="{ full: f.full }">
            <label class="ins-label" :for="`clkf-${f.name}`">
              {{ f.label }}<span v-if="f.required" aria-hidden="true"> *</span>
            </label>

            <select v-if="f.type === 'select'" :id="`clkf-${f.name}`"
                    v-model="form[f.name]" class="ins-input" :required="f.required">
              <option value="" disabled>Choose…</option>
              <option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>

            <!-- :value/@input rather than v-model: the form holds a union of
                 the three primitives a control can carry, and v-model on a
                 textarea insists on a string. -->
            <textarea v-else-if="f.type === 'textarea'" :id="`clkf-${f.name}`"
                      :value="String(form[f.name] ?? '')" class="ins-input" rows="4"
                      :required="f.required" :placeholder="f.placeholder"
                      @input="form[f.name] = ($event.target as HTMLTextAreaElement).value" />

            <label v-else-if="f.type === 'checkbox'" class="clk-form-check">
              <input :id="`clkf-${f.name}`" v-model="form[f.name]" type="checkbox" />
              <span>{{ f.hint || f.label }}</span>
            </label>

            <input v-else :id="`clkf-${f.name}`" v-model="form[f.name]" class="ins-input"
                   :type="f.type === 'datetime' ? 'datetime-local' : f.type"
                   :required="f.required" :placeholder="f.placeholder" :step="f.step" />

            <p v-if="formFields[f.name]" class="clk-form-bad">{{ formFields[f.name] }}</p>
            <p v-else-if="f.hint && f.type !== 'checkbox'" class="ins-hint">{{ f.hint }}</p>
          </div>
        </div>

        <div class="clk-form-foot">
          <UiButton variant="ghost" type="button" @click="formOpen = false">Cancel</UiButton>
          <UiButton variant="primary" type="submit" :loading="saving">Write to register</UiButton>
        </div>
      </form>
    </UiSheet>

    <!-- ── Void ───────────────────────────────────────────────────────── -->
    <UiSheet :open="!!voidTarget" title="Void this entry"
             subtitle="The entry stays in the register with your reason against it"
             width="30rem" @close="voidTarget = null" @update:open="voidTarget = null">
      <form class="clk-form" @submit.prevent="confirmVoid">
        <p class="ins-banner t-warning">
          <AlertTriangle :size="15" aria-hidden="true" />
          <span>
            This does not delete anything. The entry is struck through and
            keeps your reason and your name, because a register the council
            can erase is not evidence.
          </span>
        </p>

        <p v-if="voidError" class="ins-banner t-negative" role="alert">
          <AlertTriangle :size="15" aria-hidden="true" />
          <span>{{ voidError }}</span>
        </p>

        <div class="ins-field">
          <label class="ins-label" for="clk-void-reason">Reason *</label>
          <textarea id="clk-void-reason" v-model="voidReason" class="ins-input" rows="3"
                    required placeholder="Why this entry is being withdrawn" />
          <p class="ins-hint">Written into the register beside the entry.</p>
        </div>

        <div class="clk-form-foot">
          <UiButton variant="ghost" type="button" @click="voidTarget = null">Cancel</UiButton>
          <UiButton variant="danger" type="submit" :loading="voiding"
                    :disabled="!voidReason.trim()">Void entry</UiButton>
        </div>
      </form>
    </UiSheet>

    <!-- Confirmation of a write is a quiet line under the header, not a toast
         that covers the row the clerk is checking. -->
    <p v-if="justSaved" class="clk-reg-saved" role="status">
      <CheckCircle2 :size="14" aria-hidden="true" />
      Written to the register.
    </p>
  </section>
</template>

<style scoped>
/* Tokens only — src/styles/enterprise.css. The structure is the shared ins-*
   sheet; what is here is the table, which the primitives do not cover. */

.clk-reg { display:flex; flex-direction:column; min-height:0; }
.clk-reg-head h3 { gap:var(--ent-s2); }
.clk-reg-body { display:flex; flex-direction:column; gap:var(--ent-s3); }
.clk-reg-lede { margin:0; }

.clk-reg-filters { display:flex; align-items:center; gap:var(--ent-s3); flex-wrap:wrap; }
.clk-reg-search { flex:1; min-width:14rem; }
.clk-reg-toggle { display:inline-flex; align-items:center; gap:var(--ent-s2);
  font-size:var(--ent-fs-xs); color:var(--ent-text-2); cursor:pointer; white-space:nowrap; }
.clk-reg-toggle input { width:15px; height:15px; accent-color:var(--ent-accent); }
.clk-reg-toggle:focus-within { outline:none; }
.clk-reg-toggle input:focus-visible { outline:2px solid var(--ent-accent); outline-offset:2px; }

.clk-reg-note { margin:0; }
.clk-reg-link { font:inherit; color:var(--ent-accent); background:none; border:0; padding:0;
  cursor:pointer; text-decoration:underline; }
.clk-reg-link:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); border-radius:var(--ent-r-sm); }

/* ── Loading ─────────────────────────────────────────────────────────── */
.clk-reg-loading { display:flex; flex-direction:column; gap:var(--ent-s3); padding:var(--ent-s2) 0; }
.clk-reg-loading .ins-skel:nth-child(odd) { width:92%; }
.clk-reg-loading .ins-skel:nth-child(even) { width:78%; }

/* ── Table ───────────────────────────────────────────────────────────── */
/* Horizontal scroll on the table only, not the page: a register is wide, and
   a phone should scroll the columns rather than the whole console sideways. */
.clk-reg-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch;
  margin:0 calc(-1 * var(--ent-s4)); padding:0 var(--ent-s4); }
/* A min-width so the table OVERFLOWS and its container scrolls, rather than
   compressing every column until a timestamp wraps over four lines. Squeezing
   and scrolling at the same time is the worst of both. */
.clk-reg-table { width:100%; min-width:54rem; border-collapse:collapse;
  font-size:var(--ent-fs-sm); }
.clk-reg-table th, .clk-reg-table td {
  padding:var(--ent-s2) var(--ent-s3); text-align:left; vertical-align:top;
  border-bottom:1px solid var(--ent-line); }
.clk-reg-table th {
  position:sticky; top:0; z-index:var(--ent-z-sticky);
  background:var(--ent-surface-2); color:var(--ent-text-3);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  letter-spacing:0.05em; text-transform:uppercase; white-space:nowrap;
  border-bottom:1px solid var(--ent-line-strong); }
.clk-reg-table td { color:var(--ent-text); line-height:var(--ent-lh); }
.clk-reg-table th.nowrap, .clk-reg-table td.nowrap { white-space:nowrap; }
/* A machine identifier is one token to a reader. Without this, `anywhere`
   below breaks TPD/VUN/2026/0003 over four lines at the slashes, which is
   not a reference any more. */
.clk-reg-table td .ins-mono { white-space:nowrap; }
/* A long subject or a set of reasons should use a column, not the table. */
.clk-reg-table td { max-width:24rem; overflow-wrap:anywhere; }
.clk-reg-table tbody tr:hover td { background:var(--ent-surface-2); }

/* A voided entry reads as struck through, not as missing. */
.clk-reg-table tr.voided td { color:var(--ent-text-3); text-decoration:line-through;
  text-decoration-thickness:1px; }
.clk-reg-table tr.voided .clk-reg-chip { opacity:0.6; }

/* The row just written, marked for a few seconds so the clerk can see where
   it landed in a register sorted by date rather than by arrival. */
.clk-reg-table tr.fresh td { background:var(--ent-accent-soft);
  animation:clk-fresh 4s var(--ent-ease) forwards; }
@keyframes clk-fresh { 0%, 55% { background:var(--ent-accent-soft); } 100% { background:transparent; } }

.clk-reg-chip { display:inline-block; padding:1px var(--ent-s2); border-radius:var(--ent-r-pill);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); white-space:nowrap;
  background:var(--ent-tone-neutral-bg); color:var(--ent-tone-neutral-fg);
  border:1px solid var(--ent-tone-neutral-line); }
.clk-reg-chip.t-info { background:var(--ent-tone-info-bg); color:var(--ent-tone-info-fg); border-color:var(--ent-tone-info-line); }
.clk-reg-chip.t-positive { background:var(--ent-tone-positive-bg); color:var(--ent-tone-positive-fg); border-color:var(--ent-tone-positive-line); }
.clk-reg-chip.t-warning { background:var(--ent-tone-warning-bg); color:var(--ent-tone-warning-fg); border-color:var(--ent-tone-warning-line); }
.clk-reg-chip.t-negative { background:var(--ent-tone-negative-bg); color:var(--ent-tone-negative-fg); border-color:var(--ent-tone-negative-line); }

.clk-reg-actions-col { width:1%; white-space:nowrap; text-align:right; }
.clk-reg-actions-col > * { vertical-align:middle; }
.clk-reg-void { display:inline-flex; align-items:center; justify-content:center;
  width:26px; height:26px; margin-left:var(--ent-s1);
  color:var(--ent-text-3); background:none; border:1px solid transparent;
  border-radius:var(--ent-r-sm); cursor:pointer;
  transition:color var(--ent-dur) var(--ent-ease), border-color var(--ent-dur) var(--ent-ease); }
.clk-reg-void:hover { color:var(--ent-danger); border-color:var(--ent-tone-negative-line); }
.clk-reg-void:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.clk-reg-voidnote { margin:var(--ent-s2) 0 0; font-size:var(--ent-fs-micro);
  color:var(--ent-text-3); line-height:var(--ent-lh); }

/* ── Empty ───────────────────────────────────────────────────────────── */
.clk-reg-empty { display:flex; flex-direction:column; align-items:center; gap:var(--ent-s3);
  padding:var(--ent-s7) var(--ent-s4); text-align:center; color:var(--ent-text-3); }
.clk-reg-empty p { margin:0; font-size:var(--ent-fs-sm); max-width:34ch; line-height:var(--ent-lh); }

/* ── Pager ───────────────────────────────────────────────────────────── */
.clk-reg-pager { display:flex; align-items:center; justify-content:space-between;
  gap:var(--ent-s3); flex-wrap:wrap; padding-top:var(--ent-s2);
  border-top:1px solid var(--ent-line); }
.clk-reg-page { font-size:var(--ent-fs-xs); color:var(--ent-text-3);
  font-variant-numeric:tabular-nums; }

.clk-reg-saved { display:flex; align-items:center; gap:var(--ent-s2);
  margin:0; padding:var(--ent-s2) var(--ent-s4);
  font-size:var(--ent-fs-xs); color:var(--ent-success);
  border-top:1px solid var(--ent-line); }

/* ── Form ────────────────────────────────────────────────────────────── */
.clk-form { display:flex; flex-direction:column; gap:var(--ent-s4); }
.clk-form-check { display:inline-flex; align-items:center; gap:var(--ent-s2);
  font-size:var(--ent-fs-sm); color:var(--ent-text-2); cursor:pointer;
  min-height:var(--ent-control-h); }
.clk-form-check input { width:17px; height:17px; accent-color:var(--ent-accent); }
.clk-form-bad { margin:0; font-size:var(--ent-fs-xs); color:var(--ent-danger); }
.clk-form-foot { display:flex; justify-content:flex-end; gap:var(--ent-s2);
  padding-top:var(--ent-s3); border-top:1px solid var(--ent-line); }

@media (max-width: 1023px) {
  .clk-reg-table th.sec, .clk-reg-table td.sec { display:none; }
}
@media (max-width: 767px) {
  .clk-reg-scroll { margin:0 calc(-1 * var(--ent-s3)); padding:0 var(--ent-s3); }
  .clk-reg-filters { gap:var(--ent-s2); }
  .clk-reg-search { min-width:100%; }
}
@media (prefers-reduced-motion: reduce) {
  .clk-reg-table tr.fresh td { animation:none; background:transparent; }
}
</style>
