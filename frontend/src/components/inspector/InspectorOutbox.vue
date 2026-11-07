<script setup lang="ts">
/**
 * Device outbox — every site photograph still held on this device, across all
 * inspections, in one place.
 *
 * The stage console already holds a failed upload's original bytes, but it only
 * shows the ones for the stage that is open. An inspector who photographed three
 * sites on a dead network had no way to see what was still owed to the council
 * record without reopening each stage. This is that view, plus the connection
 * state it depends on.
 *
 * When the device comes back online the outbox retries by itself. A capture is
 * only removed once the server accepts it (see flushEvidence); discarding is
 * always an explicit, confirmed action.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Wifi, WifiOff, UploadCloud, Trash2, ImageIcon, CheckCircle2, ClipboardList } from 'lucide-vue-next'
import UiSheet from '@/components/ui/UiSheet.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { dmApi } from '@/services/developmentManagementService'
import {
  listAllEvidence, flushEvidence, discardEvidence, type QueuedEvidence,
} from '@/inspector/evidenceQueue'
import { heldChecklistDrafts, type ChecklistDraft } from '@/inspector/checklistDraft'
import { useInspectorPreferences } from '@/composables/useInspectorPreferences'

const { prefs } = useInspectorPreferences()

const open = ref(false)
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const held = ref<QueuedEvidence[]>([])
const syncing = ref(false)
const lastResult = ref<string | null>(null)
const storeError = ref(false)

/**
 * Checklist marks this device is holding.
 *
 * They cannot be flushed from here. Sending a checklist runs a completeness
 * check and asks the server to compute the statutory result, which is the stage
 * console's job — so the outbox's part is to make sure the inspector KNOWS the
 * marks exist and can get to them in one tap, rather than to quietly upload
 * half an inspection from a header pill.
 */
const unsentMarks = ref<ChecklistDraft[]>([])

async function refresh() {
  try {
    held.value = await listAllEvidence()
    storeError.value = false
  } catch {
    storeError.value = true
  }
  unsentMarks.value = heldChecklistDrafts()
}

/** Everything this device owes the council record, photographs and marks alike. */
const owed = computed(() => held.value.length + unsentMarks.value.length)

const router = useRouter()
/** Open the stage the marks belong to. The section IS the URL, so this is a link. */
function openStage(d: ChecklistDraft) {
  open.value = false
  void router.push({
    name: 'inspector-workspace',
    query: { section: 'stages', pane: 'console', permit: d.permitId },
  }).catch(() => undefined)
}

const groups = computed(() => {
  const m = new Map<string, QueuedEvidence[]>()
  for (const r of held.value) {
    if (!m.has(r.inspectionId)) m.set(r.inspectionId, [])
    m.get(r.inspectionId)!.push(r)
  }
  return [...m.entries()]
})

const totalKb = computed(() => Math.round(held.value.reduce((n, r) => n + r.bytes, 0) / 1024))

async function syncAll() {
  if (syncing.value || !held.value.length) return
  syncing.value = true
  lastResult.value = null
  let uploaded = 0
  let failed = 0
  try {
    for (const [inspectionId] of groups.value) {
      const res = await flushEvidence(inspectionId, rec => dmApi.uploadStagePhoto(
        inspectionId,
        new File([rec.blob], rec.fileName, { type: rec.mimeType }),
        { caption: rec.caption, takenAt: rec.takenAt ?? undefined, lat: rec.lat ?? undefined, lng: rec.lng ?? undefined },
      ))
      uploaded += res.uploaded
      failed += res.failed
    }
    lastResult.value = failed
      ? `${uploaded} uploaded. ${failed} still held on this device.`
      : `${uploaded} photograph${uploaded === 1 ? '' : 's'} added to the council record.`
  } finally {
    syncing.value = false
    await refresh()
  }
}

const confirmId = ref<string | null>(null)
async function discard(id: string) {
  if (confirmId.value !== id) { confirmId.value = id; return }
  confirmId.value = null
  await discardEvidence(id)
  await refresh()
}

function fmt(iso: string | null) {
  if (!iso) return 'time not recorded'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'time not recorded'
    : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * Back on the network.
 *
 * Whether the upload starts by itself is the inspector's choice (Settings →
 * Field work): on expensive mobile data a silent multi-megabyte upload is a
 * real cost, so the default is on but it can be turned off — and when it is,
 * the panel below says plainly that the record is incomplete until they sync.
 */
function onOnline() {
  online.value = true
  void refresh().then(() => { if (prefs.value.autoUploadOnReconnect) return syncAll() })
}
function onOffline() { online.value = false }
function onFocus() { void refresh() }

let poll: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  void refresh()
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  window.addEventListener('focus', onFocus)
  // ponytail: 20 s poll picks up captures queued by the stage console; swap for
  // a BroadcastChannel if the outbox ever needs to update instantly.
  poll = setInterval(refresh, 20_000)
})
onUnmounted(() => {
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  window.removeEventListener('focus', onFocus)
  if (poll) clearInterval(poll)
})

function openSheet() { void refresh(); open.value = true }
</script>

<template>
  <button
    type="button" class="iob-pill"
    :class="{ offline: !online, held: owed > 0 }"
    :aria-label="`${online ? 'Online' : 'Offline'}. ${held.length} photograph${held.length === 1 ? '' : 's'} and ${unsentMarks.length} checklist${unsentMarks.length === 1 ? '' : 's'} held on this device. Open device outbox.`"
    @click="openSheet">
    <component :is="online ? Wifi : WifiOff" :size="14" aria-hidden="true" />
    <span class="iob-state">{{ online ? 'Online' : 'Offline' }}</span>
    <span v-if="owed" class="iob-badge">{{ owed }}</span>
  </button>

  <UiSheet v-model:open="open" title="Device outbox"
           :subtitle="owed
             ? [held.length ? `${held.length} photograph${held.length === 1 ? '' : 's'} · ${totalKb} KB` : null,
                unsentMarks.length ? `${unsentMarks.length} checklist${unsentMarks.length === 1 ? '' : 's'}` : null]
                .filter(Boolean).join(' · ')
             : 'Nothing waiting'" width="34rem">
    <div class="iob">
      <p class="ins-banner" :class="online ? 't-info' : 't-warning'">
        <component :is="online ? Wifi : WifiOff" :size="16" aria-hidden="true" />
        <span>
          <strong>{{ online ? 'Connected.' : 'No connection.' }}</strong>
          {{ online
            ? (prefs.autoUploadOnReconnect
                ? ' Held photographs upload when you sync, and automatically whenever the connection returns.'
                : ' Automatic upload is off, so held photographs stay on this device until you sync.')
            : (prefs.autoUploadOnReconnect
                ? ' Keep capturing. Original photographs stay on this device and upload when you reconnect.'
                : ' Keep capturing. Original photographs stay on this device until you sync — automatic upload is off.') }}
        </span>
      </p>

      <p v-if="storeError" class="ins-banner t-negative" role="alert">
        This device's storage could not be read, so held photographs cannot be listed. Do not clear the browser's data.
      </p>

      <div v-if="!owed && !storeError" class="iob-empty">
        <CheckCircle2 :size="28" aria-hidden="true" />
        <p>Everything recorded on this device is on the council record.</p>
      </div>

      <!-- Marks first: an unsent checklist is a whole inspection outstanding,
           where a held photograph is one piece of evidence within one. -->
      <section v-if="unsentMarks.length" class="iob-group">
        <h3><ClipboardList :size="14" aria-hidden="true" /> Unsent checklists
          <span class="iob-n">{{ unsentMarks.length }}</span></h3>
        <ul class="ins-rows">
          <li v-for="d in unsentMarks" :key="`${d.permitId}-${d.stageNumber}`" class="ins-row">
            <span class="iob-thumb" aria-hidden="true"><ClipboardList :size="16" /></span>
            <span class="ins-row-main">
              <span class="ins-row-title">
                Stage {{ d.stageNumber }} ·
                <span class="ins-mono">{{ d.permitId.slice(0, 8).toUpperCase() }}</span>
              </span>
              <span class="ins-row-meta">
                {{ d.rows.length }} mark{{ d.rows.length === 1 ? '' : 's' }} · last changed {{ fmt(d.savedAt) }}
              </span>
            </span>
            <UiButton size="sm" @click="openStage(d)">Open stage</UiButton>
          </li>
        </ul>
        <p class="iob-note">
          A checklist is sent from the stage itself, where the result is computed — Sync below
          carries photographs only.
        </p>
      </section>

      <section v-for="[inspectionId, rows] in groups" :key="inspectionId" class="iob-group">
        <h3>Inspection <span class="ins-mono">{{ inspectionId.slice(0, 8).toUpperCase() }}</span>
          <span class="iob-n">{{ rows.length }}</span></h3>
        <ul class="ins-rows">
          <li v-for="r in rows" :key="r.id" class="ins-row">
            <span class="iob-thumb" aria-hidden="true"><ImageIcon :size="16" /></span>
            <span class="ins-row-main">
              <span class="ins-row-title">{{ r.caption || r.fileName }}</span>
              <span class="ins-row-meta">
                {{ fmt(r.takenAt) }} · {{ Math.round(r.bytes / 1024) }} KB
                <template v-if="r.attempts"> · {{ r.attempts }} attempt{{ r.attempts === 1 ? '' : 's' }}</template>
              </span>
              <span v-if="r.lastError" class="iob-err">{{ r.lastError }}</span>
            </span>
            <UiButton size="sm" :variant="confirmId === r.id ? 'danger' : 'ghost'" @click="discard(r.id)">
              <template #icon><Trash2 :size="13" /></template>
              {{ confirmId === r.id ? 'Confirm discard' : 'Discard' }}
            </UiButton>
          </li>
        </ul>
      </section>

      <p v-if="lastResult" class="iob-result" role="status">{{ lastResult }}</p>
    </div>

    <template #footer>
      <UiButton variant="primary" block :loading="syncing" :disabled="!held.length || !online" @click="syncAll">
        <template #icon><UploadCloud :size="15" /></template>
        {{ syncing ? 'Uploading' : 'Sync now' }}
      </UiButton>
    </template>
  </UiSheet>
</template>

<style scoped>
.iob-pill {
  display: inline-flex; align-items: center; gap: var(--ent-s2); flex-shrink: 0;
  height: var(--ent-control-h-sm); padding: 0 var(--ent-s3);
  font-family: var(--ent-font); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold);
  color: var(--ent-success); background: var(--ent-success-soft);
  border: 1px solid var(--ent-tone-positive-line); border-radius: var(--ent-r-pill); cursor: pointer;
  transition: background-color var(--ent-dur) var(--ent-ease), color var(--ent-dur) var(--ent-ease);
}
.iob-pill.held { color: var(--ent-warning); background: var(--ent-warning-soft); border-color: var(--ent-tone-warning-line); }
.iob-pill.offline { color: var(--ent-danger); background: var(--ent-danger-soft); border-color: var(--ent-tone-negative-line); }
.iob-pill:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.iob-badge {
  min-width: 18px; height: 18px; padding: 0 5px; display: inline-flex; align-items: center; justify-content: center;
  font-variant-numeric: tabular-nums; color: var(--ent-text-on-accent); background: var(--ent-warning); border-radius: var(--ent-r-pill);
}
.iob-pill.offline .iob-badge { background: var(--ent-danger); }

.iob { display: flex; flex-direction: column; gap: var(--ent-s3); }
.iob-empty { display: flex; flex-direction: column; align-items: center; gap: var(--ent-s2); padding: var(--ent-s6) var(--ent-s4); color: var(--ent-success); text-align: center; }
.iob-empty p { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); max-width: 32ch; }
.iob-group { border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); overflow: hidden; }
.iob-group h3 {
  display: flex; align-items: center; gap: var(--ent-s2); margin: 0;
  padding: var(--ent-s2) var(--ent-s4); background: var(--ent-surface-2); border-bottom: 1px solid var(--ent-line);
  font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text);
}
.iob-n { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--ent-text-3); }
.iob-note { margin: 0; padding: var(--ent-s2) var(--ent-s4) var(--ent-s3);
  font-size: var(--ent-fs-xs); color: var(--ent-text-3); line-height: var(--ent-lh); }
.iob-thumb { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; flex-shrink: 0; border-radius: var(--ent-r); background: var(--ent-surface-sunken); color: var(--ent-text-3); }
.iob-err { display: block; margin-top: 2px; font-size: var(--ent-fs-xs); color: var(--ent-danger); }
.iob-result { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }

@media (max-width: 767px) { .iob-state { display: none; } }
@media (prefers-reduced-motion: reduce) { .iob-pill { transition: none; } }
</style>
