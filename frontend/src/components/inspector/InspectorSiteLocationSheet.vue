<script setup lang="ts">
// Record or correct a site's position (PUT /permit-applications/:id/site-location).
//
// Two sources, both audited server-side with the previous position and a reason:
//   field_gps  a fresh fix taken standing at the pegs, accurate to 25 m or better
//   map_pick   a point picked on the map against the cadastre
// A GPS observation never becomes the site position silently — this sheet is
// the only path, and it asks for a reason every time.
import { computed, ref, watch } from 'vue'
import { LocateFixed, MousePointerClick, Satellite } from 'lucide-vue-next'
import UiSheet from '@/components/ui/UiSheet.vue'
import UiButton from '@/components/ui/UiButton.vue'
import {
  captureGps, gpsFailureMessage, isGpsFailure, type GpsObservation,
} from '@/composables/useInspectionNavigation'
import { inspectorGis, type SiteLocationResult } from '@/services/inspectorGis'
import { distanceM, formatMetres } from '@/inspector/siteGeo'

const MAX_GPS_ACCURACY_M = 25

const props = defineProps<{
  open: boolean
  permitId: string | null
  permitRef?: string | null
  /** Point chosen in map-pick mode, [lng, lat]. */
  pickedPoint: [number, number] | null
  /** The site's current position, to show how far the change moves it. */
  currentCenter?: [number, number] | null
}>()

const emit = defineEmits<{
  'update:open': [boolean]
  saved: [SiteLocationResult]
  'start-pick': []
}>()

const source = ref<'field_gps' | 'map_pick'>('field_gps')
const fix = ref<GpsObservation | null>(null)
const gpsError = ref<string | null>(null)
const locating = ref(false)
const reason = ref('')
const saving = ref(false)
const saveError = ref<string | null>(null)

watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  saveError.value = null
  if (props.pickedPoint) source.value = 'map_pick'
})

const candidate = computed<[number, number] | null>(() => {
  if (source.value === 'map_pick') return props.pickedPoint
  return fix.value ? [fix.value.lng, fix.value.lat] : null
})

const accuracyOk = computed(() => source.value === 'map_pick'
  || (fix.value?.accuracyM != null && fix.value.accuracyM <= MAX_GPS_ACCURACY_M))

const moveM = computed(() => candidate.value && props.currentCenter
  ? distanceM(props.currentCenter, candidate.value)
  : null)

const canSave = computed(() => Boolean(props.permitId && candidate.value && accuracyOk.value
  && reason.value.trim().length >= 10 && !saving.value))

async function takeFix() {
  locating.value = true
  gpsError.value = null
  const r = await captureGps({ timeoutMs: 20000, maximumAgeMs: 0 })
  locating.value = false
  if (isGpsFailure(r)) {
    fix.value = null
    gpsError.value = gpsFailureMessage(r).replace(/ Photos will be saved without GPS coordinates\.| Coordinates will not be attached\./, '')
    return
  }
  fix.value = r
}

const ERRORS: Record<string, string> = {
  accuracy_insufficient: `The GPS fix is not accurate enough. Wait for a fix of ${MAX_GPS_ACCURACY_M} m or better.`,
  outside_jurisdiction: 'That position is outside the council planning boundary.',
  reason_required: 'Give a reason of at least 10 characters.',
  forbidden: 'You do not have permission to record site positions.',
  not_found: 'This permit could not be found.',
}

async function save() {
  if (!canSave.value || !props.permitId || !candidate.value) return
  saving.value = true
  saveError.value = null
  try {
    const result = await inspectorGis.setSiteLocation(props.permitId, {
      lng: candidate.value[0],
      lat: candidate.value[1],
      source: source.value,
      accuracy_m: source.value === 'field_gps' && fix.value?.accuracyM != null ? fix.value.accuracyM : undefined,
      reason: reason.value.trim(),
    })
    reason.value = ''
    fix.value = null
    emit('saved', result)
    emit('update:open', false)
  } catch (e: unknown) {
    const d = (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data
    saveError.value = (d?.error && ERRORS[d.error]) || d?.message || 'The site position was not saved.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiSheet
    :open="open"
    title="Record site position"
    :subtitle="permitRef || undefined"
    width="28rem"
    @update:open="emit('update:open', $event)"
  >
    <div class="isl">
      <fieldset class="isl-source">
        <legend>Position from</legend>
        <label :class="{ on: source === 'field_gps' }">
          <input v-model="source" type="radio" value="field_gps" />
          <Satellite :size="14" aria-hidden="true" />
          <span><strong>GPS at the site</strong><small>Stand at the pegs. Needs {{ MAX_GPS_ACCURACY_M }} m accuracy.</small></span>
        </label>
        <label :class="{ on: source === 'map_pick' }">
          <input v-model="source" type="radio" value="map_pick" />
          <MousePointerClick :size="14" aria-hidden="true" />
          <span><strong>Pick on the map</strong><small>Against the cadastre and imagery.</small></span>
        </label>
      </fieldset>

      <div v-if="source === 'field_gps'" class="isl-panel">
        <UiButton size="sm" :loading="locating" :disabled="locating" @click="takeFix">
          <template #icon><LocateFixed :size="13" /></template>
          {{ fix ? 'Take a new fix' : 'Take GPS fix' }}
        </UiButton>
        <p v-if="locating" class="isl-muted" role="status">Waiting for a fresh fix. Keep the device still with a clear view of the sky.</p>
        <p v-if="gpsError" class="isl-error" role="alert">{{ gpsError }}</p>
        <dl v-if="fix" class="isl-dl">
          <div><dt>Fix</dt><dd class="mono">{{ fix.lat.toFixed(6) }}, {{ fix.lng.toFixed(6) }}</dd></div>
          <div>
            <dt>Accuracy</dt>
            <dd :class="accuracyOk ? 'ok' : 'bad'">
              {{ fix.accuracyM != null ? `±${Math.round(fix.accuracyM)} m` : 'Not reported' }}
              <template v-if="!accuracyOk"> · not accurate enough, take another fix</template>
            </dd>
          </div>
        </dl>
      </div>

      <div v-else class="isl-panel">
        <UiButton size="sm" @click="emit('start-pick')">
          <template #icon><MousePointerClick :size="13" /></template>
          {{ pickedPoint ? 'Pick again' : 'Pick on map' }}
        </UiButton>
        <dl v-if="pickedPoint" class="isl-dl">
          <div><dt>Point</dt><dd class="mono">{{ pickedPoint[1].toFixed(6) }}, {{ pickedPoint[0].toFixed(6) }}</dd></div>
        </dl>
        <p v-else class="isl-muted">The sheet closes while you click the site on the map, then returns.</p>
      </div>

      <p v-if="moveM != null" class="isl-muted">
        Moves the recorded position {{ formatMetres(moveM) }}.
      </p>

      <label class="isl-reason">
        <span>Reason for the audit record</span>
        <textarea v-model="reason" rows="3" maxlength="1000"
                  placeholder="For example: permit had no position; fix taken at the north-east corner peg during setting out." />
        <small>{{ reason.trim().length < 10 ? `At least 10 characters (${reason.trim().length})` : 'Recorded with your name and the previous position.' }}</small>
      </label>

      <p v-if="saveError" class="isl-error" role="alert">{{ saveError }}</p>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="emit('update:open', false)">Cancel</UiButton>
      <UiButton variant="primary" :disabled="!canSave" :loading="saving" @click="save">Save position</UiButton>
    </template>
  </UiSheet>
</template>

<style scoped>
.isl { display: flex; flex-direction: column; gap: var(--ent-s3); font-size: var(--ent-fs-sm); }
.isl-source { margin: 0; padding: 0; border: none; display: grid; gap: var(--ent-s2); }
.isl-source legend { margin-bottom: var(--ent-s2); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); color: var(--ent-text-2); }
.isl-source label {
  display: flex; align-items: flex-start; gap: var(--ent-s2);
  padding: var(--ent-s2) var(--ent-s3); border: 1px solid var(--ent-line); border-radius: var(--ent-r-sm);
  cursor: pointer; min-height: var(--ent-control-h);
}
.isl-source label.on { border-color: var(--ent-accent-line); background: var(--ent-accent-soft); }
.isl-source label:focus-within { box-shadow: var(--ent-focus-ring); }
.isl-source input { margin: 0.2rem 0 0; accent-color: var(--ent-accent); }
.isl-source span { display: flex; flex-direction: column; }
.isl-source small { color: var(--ent-text-3); font-size: var(--ent-fs-xs); }
.isl-panel { display: flex; flex-direction: column; align-items: flex-start; gap: var(--ent-s2); }
.isl-dl { margin: 0; display: grid; gap: var(--ent-s1); width: 100%; }
.isl-dl > div { display: grid; grid-template-columns: 5.5rem 1fr; gap: var(--ent-s2); }
.isl-dl dt { color: var(--ent-text-3); }
.isl-dl dd { margin: 0; }
.isl-dl dd.ok { color: var(--ent-tone-positive-fg); }
.isl-dl dd.bad { color: var(--ent-danger); }
.isl-reason { display: flex; flex-direction: column; gap: var(--ent-s1); }
.isl-reason span { font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); color: var(--ent-text-2); }
.isl-reason textarea {
  width: 100%; box-sizing: border-box; resize: vertical;
  padding: var(--ent-s2); border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm);
  font: inherit; color: var(--ent-text); background: var(--ent-surface);
}
.isl-reason textarea:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); border-color: var(--ent-accent); }
.isl-reason small { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.isl-muted { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
.isl-error { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-danger); }
.mono { font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); }
</style>
