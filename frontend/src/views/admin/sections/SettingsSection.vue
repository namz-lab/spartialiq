<script setup lang="ts">
// System settings — the council's own configuration.
//
// THE ENFORCED FLAG IS THE POINT OF THIS SCREEN
// Every setting here is marked either "enforced" — the server reads it and
// behaves differently — or "record only". A console that showed both the same
// way would let an administrator switch something off, watch nothing change,
// and conclude the system is broken. Each enforced row says WHERE it bites;
// each record-only row says that it does not.
//
// SAVING IS ALL OR NOTHING
// The whole form goes to the server as one transaction, because a security
// page that saved four of six values and then failed would leave the council's
// policy in a state nobody chose. If the server refuses, it names every
// offending key at once rather than one per round trip.
//
// MAINTENANCE MODE IS CONFIRMED, NOT TOGGLED
// It is the one switch here that immediately stops every other officer in the
// council working. It gets a confirmation that says so.

import { computed, onMounted, ref, watch } from 'vue'
import {
  listSettings, saveSettings, rejectionsFrom, errorMessage,
  type AdminSetting, type SettingsRejection,
} from '@/services/adminConsole'
import { useAdminOverview } from '@/admin/useAdminOverview'
import { formatWhen, timeAgo } from '@/admin/console'
import AdminConfirm from '../AdminConfirm.vue'
import {
  RefreshCw, AlertTriangle, CheckCircle2, ShieldCheck, FileText, Undo2,
} from 'lucide-vue-next'

const overview = useAdminOverview()

const settings = ref<AdminSetting[]>([])
const draft = ref<Record<string, unknown>>({})
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const rejections = ref<SettingsRejection[]>([])

const CATEGORY_LABELS: Record<string, { title: string; lede: string }> = {
  security: {
    title: 'Security policy',
    lede: 'Applied every time somebody signs in or sets a password. Changing these takes effect within half a minute.',
  },
  system: {
    title: 'Availability',
    lede: 'Whether the portal is accepting work, and what people are told while it is not.',
  },
  notifications: {
    title: 'Notifications',
    lede: 'Whether queued messages are dispatched. Switching a channel off still queues its messages — it stops them going out.',
  },
  council: {
    title: 'Council details',
    lede: 'Used on generated documents and the public portal. These are recorded, not enforced: changing one alters what is printed, nothing else.',
  },
}

/** The setting's live value, coerced from the text column to its declared type. */
function parse(s: AdminSetting): unknown {
  switch (s.value_type) {
    case 'number': return Number(s.value ?? 0)
    case 'boolean': return s.value === 'true'
    case 'json': try { return JSON.parse(s.value ?? '[]') } catch { return [] }
    default: return s.value ?? ''
  }
}

async function load() {
  loading.value = true
  error.value = null
  rejections.value = []
  try {
    settings.value = await listSettings()
    draft.value = Object.fromEntries(settings.value.map(s => [s.key, parse(s)]))
  } catch (err) {
    settings.value = []
    error.value = errorMessage(err, 'The settings could not be read.')
  } finally {
    loading.value = false
  }
}

onMounted(load)

const groups = computed(() => {
  const order = ['security', 'system', 'notifications', 'council']
  const map = new Map<string, AdminSetting[]>()
  for (const s of settings.value) {
    const list = map.get(s.category) ?? []
    list.push(s)
    map.set(s.category, list)
  }
  return [...map.entries()]
    .sort((a, b) => {
      const ai = order.indexOf(a[0]); const bi = order.indexOf(b[0])
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
    .map(([category, rows]) => ({
      category,
      meta: CATEGORY_LABELS[category] ?? { title: category, lede: '' },
      rows,
    }))
})

/** Only what the administrator actually changed goes to the server. */
const changed = computed(() => {
  const out: Record<string, unknown> = {}
  for (const s of settings.value) {
    const current = parse(s)
    const next = draft.value[s.key]
    if (JSON.stringify(current) !== JSON.stringify(next)) out[s.key] = next
  }
  return out
})

const changedCount = computed(() => Object.keys(changed.value).length)
const dirty = computed(() => changedCount.value > 0)

const maintenanceSetting = computed(() => settings.value.find(s => s.key === 'system.maintenance_mode'))

/**
 * Turning maintenance ON stops every other officer working, immediately.
 * Turning it off does not, so only the first direction is confirmed.
 */
const turningMaintenanceOn = computed(() =>
  maintenanceSetting.value
  && draft.value['system.maintenance_mode'] === true
  && parse(maintenanceSetting.value) !== true)

const confirmingMaintenance = ref(false)

function attemptSave() {
  if (turningMaintenanceOn.value) { confirmingMaintenance.value = true; return }
  void commit()
}

async function commit() {
  confirmingMaintenance.value = false
  if (!dirty.value) return
  saving.value = true
  error.value = null
  note.value = null
  rejections.value = []
  try {
    const n = await saveSettings(changed.value)
    note.value = `${n} setting${n === 1 ? '' : 's'} saved. The change is in the audit trail.`
    await load()
    // The shell's maintenance bar and the Email screen's warning both read
    // these, so they have to be told rather than left to notice.
    overview.invalidate()
  } catch (err) {
    rejections.value = rejectionsFrom(err)
    error.value = rejections.value.length
      ? 'Some values were refused. Nothing was saved — the whole form is applied together or not at all.'
      : errorMessage(err, 'The settings could not be saved.')
  } finally {
    saving.value = false
  }
}

function revert() {
  draft.value = Object.fromEntries(settings.value.map(s => [s.key, parse(s)]))
  rejections.value = []
  error.value = null
}

const rejectionFor = (key: string) => rejections.value.find(r => r.key === key)?.why ?? null

/** A json-typed setting with `choices` is a multi-select over those choices. */
function toggleChoice(key: string, choice: string) {
  const list = Array.isArray(draft.value[key]) ? [...(draft.value[key] as string[])] : []
  const i = list.indexOf(choice)
  if (i === -1) list.push(choice)
  else list.splice(i, 1)
  draft.value = { ...draft.value, [key]: list }
}

const isChosen = (key: string, choice: string) =>
  Array.isArray(draft.value[key]) && (draft.value[key] as string[]).includes(choice)

// Leaving with unsaved edits loses them silently otherwise; the section is
// kept alive so there is no route guard to hook.
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) { e.preventDefault(); e.returnValue = '' }
}
watch(dirty, (on) => {
  if (on) window.addEventListener('beforeunload', beforeUnload)
  else window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Configuration</span>
        <h2 class="ins-title">System settings</h2>
        <p class="ins-lede">
          The council's own configuration. Each setting says whether the server acts on
          it or merely records it — so a switch that changes nothing never looks like one
          that does.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="st-btn" :disabled="loading || saving" @click="load">
          <RefreshCw :size="14" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Reload
        </button>
      </div>
    </header>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <div>
        <strong>{{ error }}</strong>
        <ul v-if="rejections.length" class="st-rejections">
          <li v-for="r in rejections" :key="r.key">
            <code class="ins-mono">{{ r.key }}</code> — {{ r.why }}
          </li>
        </ul>
      </div>
    </div>

    <p v-if="note" class="st-note" role="status">
      <CheckCircle2 :size="15" aria-hidden="true" /> {{ note }}
    </p>

    <p v-if="loading && !settings.length" class="st-loading" role="status">Reading the settings…</p>

    <template v-else-if="settings.length">
      <section v-for="group in groups" :key="group.category" class="ins-card">
        <div class="ins-card-head">
          <h3>{{ group.meta.title }}</h3>
        </div>
        <div class="ins-card-body">
          <p v-if="group.meta.lede" class="st-lede">{{ group.meta.lede }}</p>

          <div class="st-rows">
            <div v-for="s in group.rows" :key="s.key" class="st-row"
                 :class="{ invalid: rejectionFor(s.key) }">
              <div class="st-label">
                <label class="ins-label" :for="`st-${s.key}`">{{ s.label }}</label>
                <span class="st-flag" :class="s.enforced ? 't-enforced' : 't-record'">
                  <component :is="s.enforced ? ShieldCheck : FileText" :size="12" aria-hidden="true" />
                  {{ s.enforced ? 'Enforced' : 'Record only' }}
                </span>
                <p v-if="s.description" class="ins-hint">{{ s.description }}</p>
                <p v-if="!s.enforced" class="ins-hint st-record-note">
                  Recorded for use on documents and pages. Changing it alters what is
                  printed, and nothing about how the system behaves.
                </p>
              </div>

              <div class="st-control">
                <!-- Boolean -->
                <label v-if="s.value_type === 'boolean'" class="st-switch">
                  <input :id="`st-${s.key}`" type="checkbox"
                         :checked="draft[s.key] === true"
                         @change="draft = { ...draft, [s.key]: ($event.target as HTMLInputElement).checked }" />
                  <span>{{ draft[s.key] === true ? 'On' : 'Off' }}</span>
                </label>

                <!-- Number, with its declared bounds on the input itself -->
                <input v-else-if="s.value_type === 'number'" :id="`st-${s.key}`"
                       type="number" class="ins-input st-number"
                       :min="s.constraints.min" :max="s.constraints.max"
                       :value="draft[s.key]"
                       @input="draft = { ...draft, [s.key]: Number(($event.target as HTMLInputElement).value) }" />

                <!-- Multi-choice list -->
                <div v-else-if="s.value_type === 'json' && s.constraints.choices" class="ins-chips">
                  <button v-for="choice in s.constraints.choices" :key="choice" type="button"
                          class="ins-chip" :aria-pressed="isChosen(s.key, choice)"
                          @click="toggleChoice(s.key, choice)">{{ choice }}</button>
                </div>

                <!-- Long text -->
                <textarea v-else-if="s.value_type === 'text'" :id="`st-${s.key}`"
                          class="ins-input" rows="3"
                          :maxlength="s.constraints.max"
                          :value="draft[s.key] as string"
                          @input="draft = { ...draft, [s.key]: ($event.target as HTMLTextAreaElement).value }"></textarea>

                <!-- Short text -->
                <input v-else :id="`st-${s.key}`" class="ins-input"
                       :maxlength="s.constraints.max"
                       :value="draft[s.key] as string"
                       @input="draft = { ...draft, [s.key]: ($event.target as HTMLInputElement).value }" />

                <p v-if="rejectionFor(s.key)" class="st-invalid" role="alert">{{ rejectionFor(s.key) }}</p>
                <p v-else-if="s.updated_by_name" class="st-history" :title="formatWhen(s.updated_at)">
                  Last changed {{ timeAgo(s.updated_at) }} by {{ s.updated_by_name }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- A sticky bar rather than a button at the foot of a long form: the
           change an administrator just made is usually not at the bottom. -->
      <div v-if="dirty" class="st-savebar" role="region" aria-label="Unsaved changes">
        <span class="st-savebar-text">
          {{ changedCount }} unsaved change{{ changedCount === 1 ? '' : 's' }}.
          They are applied together or not at all.
        </span>
        <button type="button" class="st-btn" :disabled="saving" @click="revert">
          <Undo2 :size="14" aria-hidden="true" /> Discard
        </button>
        <button type="button" class="st-btn st-btn-primary" :disabled="saving" @click="attemptSave">
          {{ saving ? 'Saving…' : 'Save changes' }}
        </button>
      </div>
    </template>

    <AdminConfirm
      :open="confirmingMaintenance"
      title="Turn on maintenance mode"
      message="Every officer in the council except you will be refused any change to council records, from the moment this saves."
      consequence="Reading stays available, and sign-in keeps working. Anything an officer is part-way through will fail to save. Announce the window before starting it."
      confirm-label="Turn it on"
      destructive
      :busy="saving"
      @confirm="commit"
      @cancel="confirmingMaintenance = false"
    />
  </div>
</template>

<style scoped>
.st-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r); cursor:pointer; }
.st-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.st-btn:disabled { opacity:0.55; cursor:not-allowed; }
.st-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.st-btn-primary { color:var(--ent-text-on-accent); background:var(--ent-accent); border-color:var(--ent-accent); }
.st-btn-primary:hover:not(:disabled) { background:var(--ent-accent-hover); }

.st-note { display:flex; align-items:center; gap:var(--ent-s2); margin:0;
  padding:var(--ent-s2) var(--ent-s3); font-size:var(--ent-fs-sm);
  color:var(--ent-success); background:var(--ent-success-soft);
  border:1px solid var(--ent-tone-positive-line); border-radius:var(--ent-r); }

.st-loading { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-3); }
.st-lede { margin:0 0 var(--ent-s4); max-width:80ch;
  font-size:var(--ent-fs-sm); line-height:var(--ent-lh); color:var(--ent-text-2); }

.st-rejections { margin:var(--ent-s2) 0 0; padding-left:var(--ent-s5); font-size:var(--ent-fs-sm); }

.st-rows { display:flex; flex-direction:column; }
.st-row { display:grid; grid-template-columns:minmax(0, 1.4fr) minmax(0, 1fr);
  gap:var(--ent-s4); padding:var(--ent-s4) 0; border-top:1px solid var(--ent-line); }
.st-row:first-child { border-top:0; padding-top:0; }
.st-row.invalid { box-shadow:inset 3px 0 0 var(--ent-danger); padding-left:var(--ent-s3); }

.st-label { min-width:0; }
.st-flag { display:inline-flex; align-items:center; gap:3px; margin-left:var(--ent-s2);
  padding:1px 6px; font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  border-radius:var(--ent-r-pill); vertical-align:middle; }
.st-flag.t-enforced { color:var(--ent-success); background:var(--ent-success-soft); }
.st-flag.t-record { color:var(--ent-text-3); background:var(--ent-tone-neutral-bg); }
.st-record-note { font-style:italic; }

.st-control { min-width:0; display:flex; flex-direction:column; gap:var(--ent-s2); }
.st-number { max-width:9rem; }

.st-switch { display:inline-flex; align-items:center; gap:var(--ent-s2);
  font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium); color:var(--ent-text); cursor:pointer; }
.st-switch input { width:18px; height:18px; accent-color:var(--ent-accent); }

.st-invalid { margin:0; font-size:var(--ent-fs-xs); color:var(--ent-danger); }
.st-history { margin:0; font-size:var(--ent-fs-micro); color:var(--ent-text-3); }

.st-savebar { position:sticky; bottom:var(--ent-s4); z-index:var(--ent-z-sticky);
  display:flex; align-items:center; gap:var(--ent-s3); flex-wrap:wrap;
  padding:var(--ent-s3) var(--ent-s4);
  background:var(--ent-surface); border:1px solid var(--ent-accent-line);
  border-radius:var(--ent-r-md); box-shadow:var(--ent-e3); }
.st-savebar-text { flex:1; min-width:12rem; font-size:var(--ent-fs-sm); color:var(--ent-text-2); }

@media (max-width: 767px) {
  .st-row { grid-template-columns:1fr; gap:var(--ent-s2); }
}
</style>
