<script setup lang="ts">
// Development control matrix: every land-use group (rows) against every zone
// (columns), each cell P / SC / X. Reads and writes `development_matrix`, the
// table check_development_permission(), the planner zoning card and the
// citizen map all consult. A blank cell is "not scheduled", which the
// compliance check treats as prohibited.
import { computed, onMounted, ref } from 'vue'
import { Download, RefreshCw, Upload } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import { useAuthStore } from '@/stores/auth'
import { parseApiError } from '@/composables/useUiFeedback'
import {
  MATRIX_EDITORS, PERMISSION_CODE_LABEL, cellKey, clearMatrixRule, getLandUseGroups, getMatrixHistory, getMatrixRules,
  getMatrixZones, importMatrixChanges, matrixCsv, planMatrixImport, saveMatrixRule,
  type MatrixGroup, type MatrixHistoryEntry, type MatrixImportPlan, type MatrixRule, type MatrixZone,
  type PermissionCode,
} from '@/services/developmentControl'

const emit = defineEmits<{ changed: [count: number] }>()

const auth = useAuthStore()
// Everyone else reads: they can open a cell for its conditions and history.
const canEdit = computed(() => (MATRIX_EDITORS as readonly string[]).includes(auth.user?.role ?? ''))

const zones = ref<MatrixZone[]>([])
const groups = ref<MatrixGroup[]>([])
const rules = ref<MatrixRule[]>([])
const loading = ref(false)
const error = ref('')

const search = ref('')
const category = ref('')
const zoneType = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [z, g, r] = await Promise.all([getMatrixZones(), getLandUseGroups(), getMatrixRules()])
    zones.value = z
    groups.value = g
    rules.value = r
    emit('changed', r.length)
  } catch (e) {
    error.value = parseApiError(e, 'Could not load the development control matrix.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const byCell = computed(() => new Map(rules.value.map(r => [cellKey(r.zone_id, r.group_id), r])))

const categories = computed(() =>
  [...new Set(groups.value.map(g => g.group_category).filter(Boolean) as string[])].sort())
const zoneTypes = computed(() =>
  [...new Set(zones.value.map(z => z.zone_type).filter(Boolean) as string[])].sort())

const visibleZones = computed(() =>
  zoneType.value ? zones.value.filter(z => z.zone_type === zoneType.value) : zones.value)
const visibleGroups = computed(() => {
  const q = search.value.trim().toLowerCase()
  return groups.value.filter(g =>
    (!category.value || g.group_category === category.value) &&
    (!q || g.group_code.toLowerCase().includes(q) || g.description.toLowerCase().includes(q)))
})

const zoneLabel = (z: MatrixZone) => z.zone_code || z.zone_name

function hasDetail(r?: MatrixRule) {
  return !!r && !!(r.conditions || r.max_units != null || r.max_height_meters != null ||
    r.min_lot_size_sqm != null || r.legal_reference)
}

function exportCsv() {
  const blob = new Blob([matrixCsv(visibleZones.value, visibleGroups.value, rules.value)], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `development-control-matrix-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

// ── Cell editor ─────────────────────────────────────────────────────────────
type Choice = PermissionCode | ''
const editing = ref<{ zone: MatrixZone; group: MatrixGroup; rule?: MatrixRule } | null>(null)
const form = ref({
  permission: '' as Choice, conditions: '', max_units: '', max_height_meters: '',
  min_lot_size_sqm: '', legal_reference: '',
})
const saving = ref(false)
const formError = ref('')

const s = (v: number | null | undefined) => (v == null ? '' : String(v))

const history = ref<MatrixHistoryEntry[]>([])
const historyState = ref<'loading' | 'ready' | 'unavailable' | 'error'>('loading')

async function loadHistory(zoneId: number, groupId: string) {
  historyState.value = 'loading'
  history.value = []
  try {
    const h = await getMatrixHistory(zoneId, groupId)
    history.value = h.entries
    historyState.value = h.unavailable ? 'unavailable' : 'ready'
  } catch {
    historyState.value = 'error'
  }
}

const ACTION_LABEL = { created: 'Set', updated: 'Changed', cleared: 'Cleared' } as const
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function openCell(zone: MatrixZone, group: MatrixGroup) {
  const rule = byCell.value.get(cellKey(zone.id, group.group_id))
  editing.value = { zone, group, rule }
  formError.value = ''
  loadHistory(zone.id, group.group_id)
  form.value = {
    permission: rule?.permission_code ?? '',
    conditions: rule?.conditions ?? '',
    max_units: s(rule?.max_units),
    max_height_meters: s(rule?.max_height_meters),
    min_lot_size_sqm: s(rule?.min_lot_size_sqm),
    legal_reference: rule?.legal_reference ?? '',
  }
}

// v-model on type=number hands back a number once typed, '' when empty
const optNum = (v: string | number) => (String(v).trim() === '' ? undefined : Number(v))

async function save() {
  const e = editing.value
  if (!e) return
  saving.value = true
  formError.value = ''
  try {
    const f = form.value
    if (f.permission === '') {
      if (e.rule) await clearMatrixRule(e.rule.matrix_id)
    } else {
      const nums = [f.max_units, f.max_height_meters, f.min_lot_size_sqm].map(optNum)
      if (nums.some(n => n !== undefined && (!Number.isFinite(n) || n < 0))) {
        formError.value = 'Limits must be zero or a positive number.'
        return
      }
      if (nums[0] !== undefined && !Number.isInteger(nums[0])) {
        formError.value = 'Maximum units must be a whole number.'
        return
      }
      await saveMatrixRule({
        zone_id: e.zone.id,
        group_code: e.group.group_code,
        permission_code: f.permission,
        conditions: f.conditions.trim() || undefined,
        max_units: nums[0],
        max_height_meters: nums[1],
        min_lot_size_sqm: nums[2],
        legal_reference: f.legal_reference.trim() || undefined,
      })
    }
    editing.value = null
    // ponytail: full reload after each edit; 835 rows is one small request
    await load()
  } catch (err) {
    formError.value = parseApiError(err, 'The rule was not saved.')
  } finally {
    saving.value = false
  }
}

// ── CSV import ──────────────────────────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null)
const importPlan = ref<(MatrixImportPlan & { fileName: string }) | null>(null)
const importing = ref(false)
const importError = ref('')

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // the same file can be chosen again after a fix
  if (!file) return
  importError.value = ''
  importPlan.value = { ...planMatrixImport(await file.text(), zones.value, groups.value, rules.value), fileName: file.name }
}

const importCounts = computed(() => {
  const c = importPlan.value?.changes ?? []
  return { set: c.filter(x => x.permission_code).length, cleared: c.filter(x => !x.permission_code).length }
})

async function applyImport() {
  const plan = importPlan.value
  if (!plan || plan.invalid.length || !plan.changes.length) return
  importing.value = true
  importError.value = ''
  try {
    await importMatrixChanges(plan.changes)
    importPlan.value = null
    await load()
  } catch (err) {
    importError.value = parseApiError(err, 'The import was not applied. Nothing changed.')
  } finally {
    importing.value = false
  }
}

const CHOICES: { value: Choice; label: string; hint: string }[] = [
  { value: 'P', label: PERMISSION_CODE_LABEL.P, hint: 'May proceed as of right, subject to any conditions.' },
  { value: 'SC', label: PERMISSION_CODE_LABEL.SC, hint: 'Needs a special consent application and advertisement.' },
  { value: 'X', label: PERMISSION_CODE_LABEL.X, hint: 'Not allowed in this zone.' },
  { value: '', label: 'Not scheduled', hint: 'No rule. The compliance check treats this as prohibited.' },
]
</script>

<template>
  <section class="dm" aria-labelledby="dm-title">
    <header class="dm-head">
      <div>
        <h2 id="dm-title">Development control matrix</h2>
        <p class="dm-sub">
          {{ rules.length }} rules across {{ zones.length }} zones and {{ groups.length }} land-use groups.
          {{ canEdit ? 'Select a cell to change its rule.' : 'Select a cell for its conditions and history.' }}
        </p>
      </div>
      <div class="dm-actions">
        <UiButton size="sm" :disabled="loading" @click="load">
          <RefreshCw :size="14" aria-hidden="true" /> Refresh
        </UiButton>
        <UiButton size="sm" :disabled="!rules.length" @click="exportCsv">
          <Download :size="14" aria-hidden="true" /> Export CSV
        </UiButton>
        <template v-if="canEdit">
          <UiButton size="sm" :disabled="loading || !zones.length" @click="fileInput?.click()">
            <Upload :size="14" aria-hidden="true" /> Import CSV
          </UiButton>
          <input ref="fileInput" type="file" accept=".csv,text/csv" hidden @change="onFile" />
        </template>
      </div>
    </header>

    <div class="dm-filters">
      <label>
        <span>Search groups</span>
        <input v-model="search" type="search" placeholder="Code or description" />
      </label>
      <label>
        <span>Category</span>
        <select v-model="category">
          <option value="">All categories</option>
          <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>
      <label>
        <span>Zone type</span>
        <select v-model="zoneType">
          <option value="">All zone types</option>
          <option v-for="t in zoneTypes" :key="t" :value="t">{{ t }}</option>
        </select>
      </label>
      <ul class="dm-legend" aria-label="Legend">
        <li><span class="dm-chip p">P</span> Permitted</li>
        <li><span class="dm-chip sc">SC</span> Special consent</li>
        <li><span class="dm-chip x">X</span> Prohibited</li>
        <li><span class="dm-chip none">·</span> Not scheduled</li>
        <li><span class="dm-dot" aria-hidden="true" /> Has conditions or limits</li>
      </ul>
    </div>

    <div v-if="error" class="dm-error" role="alert">
      <span>{{ error }}</span>
      <UiButton size="sm" @click="load">Retry</UiButton>
    </div>
    <p v-else-if="loading && !rules.length" class="dm-loading" role="status">Loading the matrix</p>
    <UiEmptyState
      v-else-if="!zones.length || !groups.length"
      message="No zones or land-use groups yet."
      sub="Add them on the Zones and Land Use Groups tabs, then set rules here."
    />
    <UiEmptyState v-else-if="!visibleGroups.length || !visibleZones.length" message="Nothing matches these filters." />

    <div v-else class="dm-scroll" tabindex="0" aria-label="Development control matrix, scrolls horizontally">
      <table class="dm-table">
        <thead>
          <tr>
            <th scope="col" class="dm-corner">Land-use group</th>
            <th v-for="z in visibleZones" :key="z.id" scope="col" :title="z.zone_name">
              <span class="dm-zone">{{ zoneLabel(z) }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in visibleGroups" :key="g.group_id">
            <th scope="row" class="dm-group" :title="g.description">
              <span class="dm-code">{{ g.group_code }}</span>
              <span class="dm-desc">{{ g.description }}</span>
            </th>
            <td v-for="z in visibleZones" :key="z.id">
              <button
                type="button"
                class="dm-cell"
                :class="(byCell.get(cellKey(z.id, g.group_id))?.permission_code ?? 'none').toLowerCase()"
                :title="byCell.get(cellKey(z.id, g.group_id))?.conditions || undefined"
                :aria-label="`${g.group_code} in ${z.zone_name}: ${
                  PERMISSION_CODE_LABEL[byCell.get(cellKey(z.id, g.group_id))?.permission_code as PermissionCode] ?? 'Not scheduled'}`"
                @click="openCell(z, g)"
              >
                {{ byCell.get(cellKey(z.id, g.group_id))?.permission_code ?? '·' }}
                <span v-if="hasDetail(byCell.get(cellKey(z.id, g.group_id)))" class="dm-dot" aria-hidden="true" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UiSheet
      :open="!!editing"
      :title="editing ? `${editing.group.group_code} in ${editing.zone.zone_name}` : ''"
      :subtitle="editing?.group.description"
      width="520px"
      @update:open="v => { if (!v) editing = null }"
    >
      <form v-if="editing && canEdit" id="dm-form" class="dm-form" @submit.prevent="save">
        <fieldset>
          <legend>Permission</legend>
          <label v-for="c in CHOICES" :key="c.value" class="dm-choice">
            <input v-model="form.permission" type="radio" name="permission" :value="c.value" />
            <span>
              <strong>{{ c.label }}</strong>
              <small>{{ c.hint }}</small>
            </span>
          </label>
        </fieldset>
        <template v-if="form.permission">
          <label class="dm-field">
            <span>Conditions</span>
            <textarea v-model="form.conditions" rows="3" placeholder="For example: one dwelling per stand, 5 m building line" />
          </label>
          <div class="dm-row">
            <label class="dm-field">
              <span>Maximum units</span>
              <input v-model="form.max_units" type="number" min="0" step="1" inputmode="numeric" />
            </label>
            <label class="dm-field">
              <span>Maximum height (m)</span>
              <input v-model="form.max_height_meters" type="number" min="0" step="0.1" inputmode="decimal" />
            </label>
            <label class="dm-field">
              <span>Minimum lot (m²)</span>
              <input v-model="form.min_lot_size_sqm" type="number" min="0" step="1" inputmode="decimal" />
            </label>
          </div>
          <label class="dm-field">
            <span>Legal reference</span>
            <input v-model="form.legal_reference" type="text" maxlength="500" placeholder="Scheme clause or statutory instrument" />
          </label>
        </template>
        <p v-if="formError" class="dm-form-error" role="alert">{{ formError }}</p>
      </form>
      <div v-else-if="editing" class="dm-form">
        <dl class="dm-detail">
          <div>
            <dt>Permission</dt>
            <dd>
              <span class="dm-chip" :class="(editing.rule?.permission_code ?? 'none').toLowerCase()">
                {{ editing.rule?.permission_code ?? '·' }}
              </span>
              {{ CHOICES.find(c => c.value === (editing!.rule?.permission_code ?? ''))?.label }}.
              {{ CHOICES.find(c => c.value === (editing!.rule?.permission_code ?? ''))?.hint }}
            </dd>
          </div>
          <div v-if="editing.rule?.conditions"><dt>Conditions</dt><dd>{{ editing.rule.conditions }}</dd></div>
          <div v-if="editing.rule?.max_units != null"><dt>Maximum units</dt><dd>{{ editing.rule.max_units }}</dd></div>
          <div v-if="editing.rule?.max_height_meters != null"><dt>Maximum height</dt><dd>{{ editing.rule.max_height_meters }} m</dd></div>
          <div v-if="editing.rule?.min_lot_size_sqm != null"><dt>Minimum lot</dt><dd>{{ editing.rule.min_lot_size_sqm }} m²</dd></div>
          <div v-if="editing.rule?.legal_reference"><dt>Legal reference</dt><dd>{{ editing.rule.legal_reference }}</dd></div>
        </dl>
        <p class="dm-muted">Changes to the matrix are made by the Town Planning Officer or the Executive Officer.</p>
      </div>
      <div v-if="editing" class="dm-form">
        <section class="dm-history" aria-labelledby="dm-history-title">
          <h3 id="dm-history-title">History</h3>
          <p v-if="historyState === 'loading'" class="dm-muted">Loading</p>
          <p v-else-if="historyState === 'unavailable'" class="dm-muted">
            Change history starts once database migration 134 is applied.
          </p>
          <p v-else-if="historyState === 'error'" class="dm-muted">History could not be loaded.</p>
          <p v-else-if="!history.length" class="dm-muted">No recorded changes to this rule.</p>
          <ol v-else>
            <li v-for="h in history" :key="h.history_id">
              <span class="dm-h-what">
                {{ ACTION_LABEL[h.action] }}<template v-if="h.action !== 'cleared' && h.permission_code">
                  to {{ PERMISSION_CODE_LABEL[h.permission_code] }}</template>
              </span>
              <span class="dm-muted">{{ h.changed_by_name || 'Unknown user' }}, {{ fmtDate(h.changed_at) }}</span>
            </li>
          </ol>
        </section>
      </div>
      <template #footer>
        <template v-if="canEdit">
          <UiButton variant="ghost" @click="editing = null">Cancel</UiButton>
          <UiButton variant="primary" type="submit" form="dm-form" :loading="saving">Save rule</UiButton>
        </template>
        <UiButton v-else @click="editing = null">Close</UiButton>
      </template>
    </UiSheet>

    <UiSheet
      :open="!!importPlan"
      title="Import matrix"
      :subtitle="importPlan?.fileName"
      width="520px"
      :scrim-close="false"
      @update:open="v => { if (!v) importPlan = null }"
    >
      <div v-if="importPlan" class="dm-import">
        <template v-if="importPlan.invalid.length">
          <p class="dm-form-error" role="alert">
            {{ importPlan.invalid.length }} {{ importPlan.invalid.length === 1 ? 'problem needs' : 'problems need' }}
            fixing before this sheet can be imported. Cells take P, SC, X or blank, and each group appears once.
          </p>
          <ul class="dm-import-list">
            <li v-for="(v, i) in importPlan.invalid.slice(0, 12)" :key="i">
              <span class="dm-code">{{ v.group }}</span> in {{ v.zone }}: {{ v.value }}
            </li>
            <li v-if="importPlan.invalid.length > 12" class="dm-muted">and {{ importPlan.invalid.length - 12 }} more</li>
          </ul>
        </template>
        <template v-else>
          <p v-if="!importPlan.changes.length">This sheet matches the current matrix. Nothing would change.</p>
          <p v-else>
            {{ importCounts.set }} {{ importCounts.set === 1 ? 'rule' : 'rules' }} will be set and
            {{ importCounts.cleared }} cleared. Conditions and limits on existing rules are kept.
          </p>
        </template>
        <p v-if="importPlan.unknownZones.length" class="dm-muted">
          Columns ignored, no zone of that name or code: {{ importPlan.unknownZones.join(', ') }}.
        </p>
        <p v-if="importPlan.unknownGroups.length" class="dm-muted">
          Rows ignored, no land-use group with that code: {{ importPlan.unknownGroups.join(', ') }}.
        </p>
        <p class="dm-muted">A blank cell clears the rule. Zones and groups not in the sheet are left as they are.</p>
        <p v-if="importError" class="dm-form-error" role="alert">{{ importError }}</p>
      </div>
      <template #footer>
        <UiButton variant="ghost" @click="importPlan = null">Cancel</UiButton>
        <UiButton
          variant="primary"
          :loading="importing"
          :disabled="!importPlan || !!importPlan.invalid.length || !importPlan.changes.length"
          @click="applyImport"
        >Apply changes</UiButton>
      </template>
    </UiSheet>
  </section>
</template>

<style scoped>
.dm {
  background: var(--ent-surface);
  border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-md);
  font-family: var(--ent-font);
  color: var(--ent-text);
}
.dm-head {
  display: flex; justify-content: space-between; align-items: flex-start; gap: var(--ent-s4);
  padding: var(--ent-s4) var(--ent-s5);
  border-bottom: 1px solid var(--ent-line);
}
.dm-head h2 { margin: 0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-semibold); }
.dm-sub { margin: var(--ent-s1) 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.dm-actions { display: flex; gap: var(--ent-s2); flex-shrink: 0; }

.dm-filters {
  display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--ent-s3) var(--ent-s4);
  padding: var(--ent-s3) var(--ent-s5);
  background: var(--ent-surface-2);
  border-bottom: 1px solid var(--ent-line);
}
.dm-filters label { display: flex; flex-direction: column; gap: var(--ent-s1); font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.dm-filters input, .dm-filters select,
.dm-field input, .dm-field textarea {
  height: var(--ent-control-h);
  padding: 0 var(--ent-s3);
  border: 1px solid var(--ent-line-strong);
  border-radius: var(--ent-r-sm);
  background: var(--ent-surface);
  color: var(--ent-text);
  font: inherit; font-size: var(--ent-fs-base);
  min-width: 0;
}
.dm-field textarea { height: auto; padding: var(--ent-s2) var(--ent-s3); resize: vertical; }
.dm-filters input:focus-visible, .dm-filters select:focus-visible,
.dm-field input:focus-visible, .dm-field textarea:focus-visible {
  outline: none; border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring);
}

.dm-legend {
  display: flex; flex-wrap: wrap; gap: var(--ent-s2) var(--ent-s4);
  margin: 0 0 0 auto; padding: 0; list-style: none;
  font-size: var(--ent-fs-xs); color: var(--ent-text-2);
}
.dm-legend li { display: inline-flex; align-items: center; gap: var(--ent-s1); }

.dm-chip, .dm-cell {
  display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold);
  border-radius: var(--ent-r-sm);
  border: 1px solid transparent;
}
.dm-chip { min-width: 26px; height: 20px; padding: 0 var(--ent-s1); }
.p    { background: var(--ent-tone-positive-bg); color: var(--ent-tone-positive-fg); border-color: var(--ent-tone-positive-line); }
.sc   { background: var(--ent-tone-warning-bg);  color: var(--ent-tone-warning-fg);  border-color: var(--ent-tone-warning-line); }
.x    { background: var(--ent-tone-negative-bg); color: var(--ent-tone-negative-fg); border-color: var(--ent-tone-negative-line); }
.none { background: transparent; color: var(--ent-text-3); border-color: var(--ent-line); }

.dm-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--ent-accent); display: inline-block;
}
.dm-cell .dm-dot { position: absolute; top: 2px; right: 2px; width: 5px; height: 5px; }

.dm-error {
  display: flex; align-items: center; gap: var(--ent-s3);
  margin: var(--ent-s4) var(--ent-s5); padding: var(--ent-s3) var(--ent-s4);
  background: var(--ent-danger-soft); color: var(--ent-danger);
  border-radius: var(--ent-r); font-size: var(--ent-fs-sm);
}
.dm-error span { flex: 1; }
.dm-loading { padding: var(--ent-s7); text-align: center; color: var(--ent-text-3); font-size: var(--ent-fs-sm); margin: 0; }

.dm-scroll { overflow: auto; max-height: 70vh; }
.dm-scroll:focus-visible { outline: none; box-shadow: inset var(--ent-focus-ring); }
.dm-table { border-collapse: separate; border-spacing: 0; font-size: var(--ent-fs-sm); }
.dm-table th, .dm-table td { border-bottom: 1px solid var(--ent-line); border-right: 1px solid var(--ent-line); }
.dm-table thead th {
  position: sticky; top: 0; z-index: 2;
  background: var(--ent-surface-2);
  height: 96px; padding: var(--ent-s2) 0; vertical-align: bottom;
  font-weight: var(--ent-fw-medium); color: var(--ent-text-2);
}
.dm-zone {
  writing-mode: vertical-rl; transform: rotate(180deg);
  font-size: var(--ent-fs-xs); white-space: nowrap; max-height: 84px; overflow: hidden; text-overflow: ellipsis;
}
.dm-table th.dm-corner, .dm-group {
  position: sticky; left: 0; z-index: 1;
  background: var(--ent-surface); text-align: left;
}
.dm-table th.dm-corner { z-index: 3; background: var(--ent-surface-2); padding: var(--ent-s2) var(--ent-s3); vertical-align: bottom; font-size: var(--ent-fs-xs); }
.dm-group {
  min-width: 240px; max-width: 280px; padding: var(--ent-s1) var(--ent-s3);
  font-weight: var(--ent-fw-normal);
}
.dm-code { font-family: var(--ent-font-mono); font-weight: var(--ent-fw-semibold); margin-right: var(--ent-s2); }
.dm-desc { color: var(--ent-text-2); }
.dm-table td { padding: 2px; text-align: center; }
.dm-cell { position: relative; width: 34px; height: 26px; }
.dm-cell { cursor: pointer; transition: box-shadow var(--ent-dur) var(--ent-ease); }
.dm-cell:hover { box-shadow: inset 0 0 0 1px var(--ent-text-3); }
.dm-cell:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.dm-table tbody tr:hover .dm-group { background: var(--ent-surface-2); }

.dm-form { display: flex; flex-direction: column; gap: var(--ent-s4); }
.dm-form fieldset { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ent-s2); }
.dm-form legend { font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); margin-bottom: var(--ent-s2); }
.dm-choice {
  display: flex; gap: var(--ent-s3); align-items: flex-start;
  padding: var(--ent-s2) var(--ent-s3);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r);
  cursor: pointer;
}
.dm-choice:has(input:checked) { border-color: var(--ent-accent-line); background: var(--ent-accent-soft); }
.dm-choice input { margin-top: 3px; accent-color: var(--ent-accent); }
.dm-choice strong { display: block; font-size: var(--ent-fs-base); font-weight: var(--ent-fw-medium); }
.dm-choice small { color: var(--ent-text-2); font-size: var(--ent-fs-xs); }
.dm-field { display: flex; flex-direction: column; gap: var(--ent-s1); font-size: var(--ent-fs-xs); color: var(--ent-text-2); flex: 1; }
.dm-row { display: flex; gap: var(--ent-s3); }
.dm-form-error { margin: 0; color: var(--ent-danger); font-size: var(--ent-fs-sm); }
.dm-detail { margin: 0; display: flex; flex-direction: column; gap: var(--ent-s3); }
.dm-detail dt { font-size: var(--ent-fs-xs); color: var(--ent-text-2); margin-bottom: 2px; }
.dm-detail dd { margin: 0; font-size: var(--ent-fs-base); display: flex; flex-wrap: wrap; align-items: center; gap: var(--ent-s1) var(--ent-s2); }
.dm-form + .dm-form { margin-top: var(--ent-s4); }
.dm-muted { margin: 0; color: var(--ent-text-3); font-size: var(--ent-fs-xs); }

.dm-history { border-top: 1px solid var(--ent-line); padding-top: var(--ent-s3); }
.dm-history h3 { margin: 0 0 var(--ent-s2); font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); }
.dm-history ol { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--ent-s2); }
.dm-history li { display: flex; flex-direction: column; gap: 2px; font-size: var(--ent-fs-sm); }
.dm-h-what { color: var(--ent-text); }

.dm-import { display: flex; flex-direction: column; gap: var(--ent-s3); font-size: var(--ent-fs-base); }
.dm-import p { margin: 0; }
.dm-import-list { margin: 0; padding-left: var(--ent-s5); font-size: var(--ent-fs-sm); display: flex; flex-direction: column; gap: var(--ent-s1); }

@media (max-width: 767px) {
  .dm-head { flex-direction: column; padding: var(--ent-s4); }
  .dm-filters { padding: var(--ent-s3) var(--ent-s4); }
  .dm-filters label { flex: 1 1 100%; }
  .dm-legend { margin: 0; }
  .dm-group { min-width: 150px; max-width: 170px; }
  .dm-desc { display: none; }
  .dm-row { flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) {
  .dm-cell { transition: none; }
}
</style>
