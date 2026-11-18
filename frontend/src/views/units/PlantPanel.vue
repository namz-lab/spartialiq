<script setup lang="ts">
// The Department of Roads and Works' plant register (backend migration 252): each grader, loader, roller and bowser, its
// status and hours, this month's work and fuel, and when it is due a service. The District Engineer, the Civil Engineering
// Technician and the Foreman log a day's work and change an item's status; the Chief Executive reads.
//
// A register with nothing in it says so; a failed read says so. Nothing here is estimated.
import { computed, onMounted, ref } from 'vue'
import { Info, TriangleAlert, Wrench, RefreshCw } from 'lucide-vue-next'
import { plantApi, type PlantItem, type PlantRegister, type PlantStatus } from '@/services/units'

const reg = ref<PlantRegister | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try { reg.value = await plantApi.list() } catch { error.value = 'The plant register could not be read. Try again in a moment.' } finally { loading.value = false }
}
onMounted(load)

const STATUS_LABEL: Record<PlantStatus, string> = {
  working: 'Working', under_repair: 'Under repair', broken_down: 'Broken down', standby: 'Standby', disposed: 'Disposed',
}
const KIND_LABEL: Record<string, string> = {
  grader: 'Grader', loader: 'Loader', roller: 'Roller', tipper: 'Tipper', tractor: 'Tractor', tow_grader: 'Tow grader',
  bowser: 'Bowser', excavator: 'Excavator', other: 'Other',
}
const n = (v: string | number | null | undefined, unit = '') => (v === null || v === undefined || v === '' ? '—' : `${Number(v).toLocaleString('en-GB')}${unit}`)
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

// ── Log a day / change status ──────────────────────────────────────────
const open = ref<PlantItem | null>(null)
const form = ref({ worked_on: new Date().toISOString().slice(0, 10), hours: '', fuel_litres: '', hour_meter_end: '', job: '', operator_name: '' })
const busy = ref(false)
const formError = ref<string | null>(null)
function start(p: PlantItem) {
  open.value = p
  form.value = { worked_on: new Date().toISOString().slice(0, 10), hours: '', fuel_litres: '', hour_meter_end: '', job: '', operator_name: '' }
  formError.value = null
}
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
async function saveDay() {
  if (!open.value) return
  busy.value = true
  formError.value = null
  try {
    await plantApi.logDay(open.value.id, {
      worked_on: form.value.worked_on, hours: numOrNull(form.value.hours), fuel_litres: numOrNull(form.value.fuel_litres),
      hour_meter_end: numOrNull(form.value.hour_meter_end), job: form.value.job.trim() || undefined, operator_name: form.value.operator_name.trim() || undefined,
    })
    open.value = null
    await load()
  } catch (e: unknown) {
    formError.value = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'The day could not be recorded.'
  } finally { busy.value = false }
}
async function setStatus(p: PlantItem, status: PlantStatus) {
  try { await plantApi.update(p.id, { status }); await load() } catch { error.value = 'The status could not be changed.' }
}

const empty = computed(() => reg.value !== null && reg.value.plant.length === 0)
</script>

<template>
  <section class="pl" aria-labelledby="pl-h" data-testid="plant-panel">
    <header class="pl-head">
      <div>
        <h2 id="pl-h" class="pl-title"><Wrench :size="18" aria-hidden="true" /> Plant</h2>
        <p class="pl-sub">The department's graders, loaders, rollers and bowsers: status, hours and this month's work.</p>
      </div>
      <button type="button" class="pl-btn" :disabled="loading" @click="load"><RefreshCw :size="14" aria-hidden="true" /> Refresh</button>
    </header>

    <p v-if="error" class="pl-msg is-error" role="alert"><TriangleAlert :size="16" aria-hidden="true" />{{ error }}</p>
    <p v-else-if="loading && !reg" class="pl-msg">Reading the plant register…</p>
    <p v-else-if="empty" class="pl-msg"><Info :size="16" aria-hidden="true" />No plant is recorded yet. Items of plant in the finance asset register appear here once the register is set up.</p>

    <template v-else-if="reg">
      <dl class="pl-totals">
        <div><dt>Items</dt><dd>{{ reg.totals.items }}</dd></div>
        <div><dt>Working</dt><dd>{{ reg.totals.working }}</dd></div>
        <div><dt>Out of action</dt><dd :class="{ 'is-warn': reg.totals.out_of_action }">{{ reg.totals.out_of_action }}</dd></div>
        <div><dt>Due a service</dt><dd :class="{ 'is-warn': reg.totals.service_due }">{{ reg.totals.service_due }}</dd></div>
      </dl>

      <div class="pl-scroll">
        <table class="pl-table">
          <caption class="pl-sr">The plant register</caption>
          <thead>
            <tr>
              <th scope="col">Plant</th><th scope="col">Status</th><th scope="col" class="r">Hour meter</th>
              <th scope="col" class="r">This month</th><th scope="col">Last worked</th><th scope="col">Last service</th>
              <th v-if="reg.can_write" scope="col"><span class="pl-sr">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in reg.plant" :key="p.id">
              <th scope="row">
                <span class="pl-name">{{ p.description }}</span>
                <span class="pl-meta">{{ p.plant_no }} · {{ KIND_LABEL[p.kind] ?? p.kind }}<template v-if="p.location"> · {{ p.location }}</template></span>
              </th>
              <td>
                <select v-if="reg.can_write" class="pl-select" :value="p.status" :aria-label="`Status of ${p.description}`"
                        @change="setStatus(p, ($event.target as HTMLSelectElement).value as PlantStatus)">
                  <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
                </select>
                <span v-else class="pl-status" :class="`is-${p.status}`">{{ STATUS_LABEL[p.status] }}</span>
              </td>
              <td class="r">{{ n(p.hour_meter, ' h') }}<span v-if="p.service_due" class="pl-due">Service due</span></td>
              <td class="r">
                <template v-if="p.days_this_month">{{ n(p.hours_this_month, ' h') }} · {{ n(p.fuel_this_month, ' L') }}</template>
                <template v-else>Not worked</template>
              </td>
              <td>{{ day(p.last_worked_on) }}<span v-if="p.last_job" class="pl-meta">{{ p.last_job }}</span></td>
              <td>{{ day(p.last_service_on) }}</td>
              <td v-if="reg.can_write"><button type="button" class="pl-btn" @click="start(p)">Log a day</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <form v-if="open" class="pl-form" aria-labelledby="pl-form-h" @submit.prevent="saveDay">
      <h3 id="pl-form-h">Log a day: {{ open.description }}</h3>
      <div class="pl-grid">
        <label>Date <input v-model="form.worked_on" type="date" required /></label>
        <label>Hours worked <input v-model="form.hours" type="number" min="0" max="24" step="0.5" /></label>
        <label>Fuel (litres) <input v-model="form.fuel_litres" type="number" min="0" step="0.5" /></label>
        <label>Hour meter at the end <input v-model="form.hour_meter_end" type="number" min="0" step="0.1" /></label>
        <label class="wide">Road or job <input v-model="form.job" type="text" maxlength="500" placeholder="e.g. Grading, Somabhula access road" /></label>
        <label class="wide">Operator <input v-model="form.operator_name" type="text" maxlength="120" /></label>
      </div>
      <p v-if="formError" class="pl-msg is-error" role="alert">{{ formError }}</p>
      <div class="pl-actions">
        <button type="button" class="pl-btn" @click="open = null">Cancel</button>
        <button type="submit" class="pl-btn is-primary" :disabled="busy">{{ busy ? 'Recording…' : 'Record the day' }}</button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.pl { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: 8px; padding: 1.25rem 1.5rem; }
.pl-head { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; margin-bottom: 1rem; }
.pl-title { display: flex; align-items: center; gap: 0.5rem; margin: 0; font-size: 1.125rem; font-weight: 600; }
.pl-sub { margin: 0.25rem 0 0; color: var(--ent-text-2); font-size: 0.875rem; }
.pl-msg { display: flex; gap: 0.5rem; align-items: center; padding: 0.625rem 0.75rem; border-radius: 6px; background: var(--ent-surface-2); color: var(--ent-text-2); font-size: 0.875rem; }
.pl-msg.is-error { background: var(--ent-danger-soft); color: var(--ent-danger); }
.pl-totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: 0.75rem; margin: 0 0 1rem; }
.pl-totals div { background: var(--ent-surface-2); border-radius: 6px; padding: 0.5rem 0.75rem; }
.pl-totals dt { font-size: 0.75rem; color: var(--ent-text-2); }
.pl-totals dd { margin: 0; font-size: 1.25rem; font-weight: 600; }
.pl-totals dd.is-warn { color: var(--ent-warning); }
.pl-scroll { overflow-x: auto; }
.pl-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.pl-table th, .pl-table td { padding: 0.5rem; border-top: 1px solid var(--ent-surface-2); text-align: left; vertical-align: top; font-weight: 400; }
.pl-table thead th { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ent-text-2); border-top: 0; }
.pl-table .r { text-align: right; font-variant-numeric: tabular-nums; }
.pl-name { display: block; font-weight: 600; }
.pl-meta { display: block; font-size: 0.75rem; color: var(--ent-text-3); }
.pl-due { display: block; font-size: 0.75rem; color: var(--ent-warning); font-weight: 600; }
.pl-status.is-broken_down, .pl-status.is-under_repair { color: var(--ent-warning); font-weight: 600; }
.pl-select, .pl-form input { font: inherit; font-size: 0.875rem; padding: 0.25rem 0.375rem; border: 1px solid var(--ent-line); border-radius: 4px; background: var(--ent-surface); color: var(--ent-text); }
.pl-btn { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.375rem 0.75rem; border: 1px solid var(--ent-line); border-radius: 6px; background: var(--ent-surface); color: var(--ent-text); font: inherit; font-size: 0.8125rem; cursor: pointer; white-space: nowrap; }
.pl-btn.is-primary { background: var(--ent-accent); border-color: var(--ent-accent); color: #fff; }
.pl-btn:disabled { opacity: 0.6; cursor: default; }
.pl-form { margin-top: 1rem; padding: 1rem; border: 1px solid var(--ent-line); border-radius: 8px; background: var(--ent-surface-2); }
.pl-form h3 { margin: 0 0 0.75rem; font-size: 1rem; }
.pl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.75rem; }
.pl-grid label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8125rem; color: var(--ent-text-2); }
.pl-grid .wide { grid-column: 1 / -1; }
.pl-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.75rem; }
.pl-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
