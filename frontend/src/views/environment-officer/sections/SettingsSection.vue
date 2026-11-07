<script setup lang="ts">
// Settings — how this console behaves on this device.
//
// Every control changes behaviour somewhere real (see src/environment-officer/
// console.ts). A settings page with decorative switches teaches the officer the
// controls in this product do nothing.
//
// Device data is shown too, because offline-first means this device can be
// holding records the council does not have yet. Clearing the cache is only
// offered once nothing is held — it would otherwise destroy an inspection.

import { computed, ref } from 'vue'
import { useHealthCase } from '@/composables/useHealthCase'
import { useAuthStore } from '@/stores/auth'
import { useEhoPreferences } from '@/environment-officer/useEhoPreferences'
import { LANDING_SECTIONS, INSPECTION_CYCLES, type LandingSection } from '@/environment-officer/console'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { Settings, HardDrive, RefreshCw, Trash2, CloudOff, CheckCircle2, UserRound } from 'lucide-vue-next'

const hc = useHealthCase()
const auth = useAuthStore()
const fb = useUiFeedback()
const { prefs, set, reset } = useEhoPreferences()

const LANDING_LABELS: Record<LandingSection, string> = {
  dashboard: 'Dashboard', inspections: 'Inspections', surveillance: 'Surveillance',
  enforcement: 'Enforcement', programmes: 'Field programmes', licensing: 'Licence clearance',
}

const cached = computed(() => ({
  premises: hc.registry.value.length, inspections: hc.inspections.value.length,
  outbreaks: hc.outbreaks.value.length, samples: hc.waterSamples.value.length, complaints: hc.complaints.value.length,
}))
const syncing = ref(false)
async function syncNow() {
  syncing.value = true
  try {
    await hc.refresh()
    fb.showToast(hc.syncState.value === 'offline' ? 'Still offline. Held records stay on this device.' : 'Registers are up to date.',
      hc.syncState.value === 'offline' ? 'warning' : 'success')
  } finally { syncing.value = false }
}

async function clearCache() {
  if (hc.pendingCount.value) return
  const ok = await fb.confirmAction('Clear this device’s copy',
    'Remove the cached registers and appraisal drafts from this device. Council records are unaffected and reload from the server. Unfiled plan-appraisal drafts are lost.',
    { confirmLabel: 'Clear device copy', danger: true })
  if (!ok) return
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('eho_')) localStorage.removeItem(k)
    }
  } catch { /* storage blocked: nothing to clear */ }
  hc.registry.value = []; hc.inspections.value = []; hc.outbreaks.value = []; hc.waterSamples.value = []; hc.complaints.value = []
  await hc.refresh()
  fb.showToast('Device copy cleared and reloaded from the server.', 'success')
}

function resetPrefs() {
  reset()
  fb.showToast('Preferences restored to their defaults.', 'info')
}
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">This device only</span>
        <h2 class="ins-title">Settings</h2>
        <p class="ins-lede">Preferences stay on this device. A colleague using it after you gets the defaults, not your choices.</p>
      </div>
    </header>

    <section class="ins-card" aria-labelledby="st-console">
      <div class="ins-card-head"><h3 id="st-console"><Settings :size="16" aria-hidden="true" /> Console</h3></div>
      <div class="ins-card-body st-rows">
        <div class="st-row">
          <div><strong id="st-landing">Open on</strong><p class="ins-hint">The section a plain link to the console opens. A link naming a section still opens that section.</p></div>
          <select class="ins-input st-control" aria-labelledby="st-landing" :value="prefs.landingSection"
                  @change="set('landingSection', ($event.target as HTMLSelectElement).value as LandingSection)">
            <option v-for="s in LANDING_SECTIONS" :key="s" :value="s">{{ LANDING_LABELS[s] }}</option>
          </select>
        </div>
        <div class="st-row">
          <div><strong id="st-cycle">Inspection cycle</strong>
            <p class="ins-hint">A premises not inspected within this many days counts as overdue — on the dashboard, the rail and the register.</p></div>
          <div class="ins-seg st-control" role="radiogroup" aria-labelledby="st-cycle">
            <button v-for="d in INSPECTION_CYCLES" :key="d" type="button" role="radio" :aria-checked="prefs.inspectionCycleDays === d"
                    @click="set('inspectionCycleDays', d)">{{ d }}d</button>
          </div>
        </div>
        <label class="st-row st-check">
          <div><strong>Start with the section rail collapsed</strong><p class="ins-hint">On a desktop screen. Tablets always start collapsed.</p></div>
          <input type="checkbox" class="st-switch" :checked="prefs.railCollapsed"
                 @change="set('railCollapsed', ($event.target as HTMLInputElement).checked)" />
        </label>
      </div>
      <div class="ins-card-foot"><UiButton size="sm" variant="ghost" @click="resetPrefs">Restore defaults</UiButton></div>
    </section>

    <section class="ins-card" aria-labelledby="st-data">
      <div class="ins-card-head"><h3 id="st-data"><HardDrive :size="16" aria-hidden="true" /> Data on this device</h3></div>
      <div class="ins-card-body st-rows">
        <p v-if="hc.pendingCount.value" class="ins-banner t-warning">
          <CloudOff :size="16" aria-hidden="true" />
          <span><strong>{{ hc.pendingCount.value }} record{{ hc.pendingCount.value === 1 ? ' is' : 's are' }} held here and not yet on the server.</strong>
            They send automatically when the connection returns. Do not clear this browser’s data until they have.</span>
        </p>
        <p v-else class="ins-banner t-positive">
          <CheckCircle2 :size="16" aria-hidden="true" /><span>Nothing is held on this device. Everything recorded here is on the council record.</span>
        </p>
        <dl class="ins-dl">
          <div><dt>Premises</dt><dd>{{ cached.premises }}</dd></div>
          <div><dt>Inspections</dt><dd>{{ cached.inspections }}</dd></div>
          <div><dt>Outbreaks</dt><dd>{{ cached.outbreaks }}</dd></div>
          <div><dt>Water samples</dt><dd>{{ cached.samples }}</dd></div>
          <div><dt>Complaints</dt><dd>{{ cached.complaints }}</dd></div>
          <div><dt>Connection</dt><dd>{{ hc.syncState.value === 'offline' ? 'Offline' : hc.syncState.value === 'loading' ? 'Syncing' : 'Online' }}</dd></div>
        </dl>
      </div>
      <div class="ins-card-foot">
        <UiButton size="sm" variant="ghost" :disabled="!!hc.pendingCount.value" :title="hc.pendingCount.value ? 'Unavailable while records are held' : undefined" @click="clearCache">
          <template #icon><Trash2 :size="14" /></template>Clear device copy</UiButton>
        <UiButton size="sm" :loading="syncing" @click="syncNow"><template #icon><RefreshCw :size="14" /></template>Sync now</UiButton>
      </div>
    </section>

    <section class="ins-card" aria-labelledby="st-me">
      <div class="ins-card-head"><h3 id="st-me"><UserRound :size="16" aria-hidden="true" /> Officer</h3></div>
      <div class="ins-card-body">
        <dl class="ins-dl">
          <div><dt>Name on forms</dt><dd>{{ auth.userName || 'Not set on your account' }}</dd></div>
        </dl>
        <p class="ins-hint st-mt">Pre-filled as the inspecting or issuing officer on every form, and editable there when someone else signs. It comes from your council account.</p>
      </div>
    </section>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.st-rows { display:flex; flex-direction:column; gap:var(--ent-s4); }
.st-row { display:flex; align-items:center; justify-content:space-between; gap:var(--ent-s4); flex-wrap:wrap; }
.st-row > div:first-child { flex:1; min-width:14rem; }
.st-row strong { font-size:var(--ent-fs-base); color:var(--ent-text); }
.st-row p { margin:2px 0 0; }
.st-control { width:auto; flex-shrink:0; }
.st-check { cursor:pointer; }
.st-switch { width:2.5rem; height:1.4rem; accent-color:var(--ent-accent); cursor:pointer; flex-shrink:0; }
.st-mt { margin-top:var(--ent-s3); }
@media (max-width: 767px) { .st-control { width:100%; } }
</style>
