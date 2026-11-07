<script setup lang="ts">
// Settings — how this inspector's console and this device behave.
//
// Two kinds of thing live here, and the page keeps them visibly apart:
//
//   Council record   the appointment details printed on notices and
//                    certificates. Saved to the server; wrong here means wrong
//                    on a statutory document.
//   This device      preferences and custody. Stored on the handset only, so a
//                    borrowed tablet gives the next inspector safe defaults
//                    rather than someone else's habits.
//
// Nothing on this page is a switch that does nothing. Every control either
// writes to /auth/profile, changes real console behaviour through
// src/inspector/preferences.ts, or performs a real device operation. Values the
// inspector must NOT be able to set — the geofence tolerance that decides
// whether a visit counts as on-site, the stage gate on a certificate — are not
// here at all, because an officer quietly loosening their own verification is
// the failure this system exists to prevent.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  Settings, UserCog, HardHat, Wifi, WifiOff, UploadCloud, Volume2, PanelLeftClose,
  Smartphone, Database, RotateCcw, Check, AlertTriangle, Info, ShieldCheck,
} from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiFeedback from '@/components/UiFeedback.vue'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { useAuthStore } from '@/stores/auth'
import { useInspectorPreferences } from '@/composables/useInspectorPreferences'
import { LANDING_SECTIONS, type LandingSection } from '@/inspector/preferences'
import { voiceSupported, speak } from '@/inspector/navVoice'
import { listAllEvidence, flushEvidence, type QueuedEvidence } from '@/inspector/evidenceQueue'
import { clearCachedCaseDrafts, cachedCaseDraftKeys } from '@/composables/useInspectionCase'
import { heldChecklistDrafts } from '@/inspector/checklistDraft'
import { dmApi } from '@/services/developmentManagementService'

const fb = useUiFeedback()
const auth = useAuthStore()
const { prefs, set, reset } = useInspectorPreferences()

/* ── Appointment (council record) ──────────────────────────────────────── */

const form = ref({
  jobTitle: auth.user?.jobTitle ?? '',
  department: auth.user?.department ?? '',
  phone: auth.user?.phone ?? '',
})
const savingProfile = ref(false)
const savedProfile = ref(false)

const dirty = computed(() =>
  form.value.jobTitle.trim() !== (auth.user?.jobTitle ?? '')
  || form.value.department.trim() !== (auth.user?.department ?? '')
  || form.value.phone.trim() !== (auth.user?.phone ?? ''),
)

/**
 * Only non-empty, changed fields are sent.
 *
 * The endpoint COALESCEs each column, so an empty string cannot clear a value —
 * it silently keeps the old one. Sending blanks would therefore show a save
 * that did not happen, so a blank is treated as "leave it", and the hint below
 * the form says so rather than letting the inspector discover it.
 */
async function saveProfile() {
  if (!dirty.value || savingProfile.value) return
  const patch: Record<string, string> = {}
  const jobTitle = form.value.jobTitle.trim()
  const department = form.value.department.trim()
  const phone = form.value.phone.trim()
  if (jobTitle && jobTitle !== (auth.user?.jobTitle ?? '')) patch.jobTitle = jobTitle
  if (department && department !== (auth.user?.department ?? '')) patch.department = department
  if (phone && phone !== (auth.user?.phone ?? '')) patch.phone = phone

  if (!Object.keys(patch).length) {
    fb.showToast('Nothing to save — a detail cannot be cleared from this page.', 'warning')
    return
  }

  savingProfile.value = true
  savedProfile.value = false
  try {
    await auth.updateProfile(patch)
    form.value = {
      jobTitle: auth.user?.jobTitle ?? '',
      department: auth.user?.department ?? '',
      phone: auth.user?.phone ?? '',
    }
    savedProfile.value = true
    fb.showToast('Appointment details saved to the council record.', 'success')
  } catch {
    fb.showToast(auth.error ?? 'Those details could not be saved. Try again when you have a connection.', 'error')
  } finally {
    savingProfile.value = false
  }
}

/* ── Device and custody ────────────────────────────────────────────────── */

const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const held = ref<QueuedEvidence[]>([])
const heldUnreadable = ref(false)
const syncing = ref(false)
const drafts = ref(0)
// Checklist marks this device is holding because the server has never seen
// them. Unlike the case cache beside it, these are NOT recoverable from the
// council record — so they are reported separately and never cleared from here.
const unsentMarks = ref<ReturnType<typeof heldChecklistDrafts>>([])
const unsentMarkCount = computed(() => unsentMarks.value.reduce((n, d) => n + d.rows.length, 0))
const quota = ref<{ usedMb: number; quotaMb: number } | null>(null)

const heldKb = computed(() => Math.round(held.value.reduce((n, r) => n + r.bytes, 0) / 1024))

async function refreshDevice() {
  try {
    held.value = await listAllEvidence()
    heldUnreadable.value = false
  } catch {
    // The custody store itself is unreadable. Say so: reporting zero held
    // captures here would tell an inspector their evidence is filed when we
    // cannot see whether it is.
    heldUnreadable.value = true
  }
  drafts.value = cachedCaseDraftKeys().length
  unsentMarks.value = heldChecklistDrafts()
  try {
    const est = await navigator.storage?.estimate?.()
    quota.value = est && est.usage != null && est.quota != null
      ? { usedMb: Math.round(est.usage / 1e5) / 10, quotaMb: Math.round(est.quota / 1e5) / 10 }
      : null
  } catch {
    quota.value = null
  }
}

async function syncNow() {
  if (syncing.value || !held.value.length) return
  syncing.value = true
  let uploaded = 0
  let failed = 0
  try {
    const byInspection = new Set(held.value.map(r => r.inspectionId))
    for (const inspectionId of byInspection) {
      const res = await flushEvidence(inspectionId, rec => dmApi.uploadStagePhoto(
        inspectionId,
        new File([rec.blob], rec.fileName, { type: rec.mimeType }),
        { caption: rec.caption, takenAt: rec.takenAt ?? undefined, lat: rec.lat ?? undefined, lng: rec.lng ?? undefined },
      ))
      uploaded += res.uploaded
      failed += res.failed
    }
    fb.showToast(
      failed
        ? `${uploaded} uploaded. ${failed} still held on this device.`
        : `${uploaded} photograph${uploaded === 1 ? '' : 's'} added to the council record.`,
      failed ? 'warning' : 'success',
    )
  } finally {
    syncing.value = false
    await refreshDevice()
  }
}

async function clearDrafts() {
  const ok = await fb.confirmAction(
    'Clear cached case files?',
    `${drafts.value} case file${drafts.value === 1 ? '' : 's'} cached on this device will be removed. `
    + 'Nothing is lost — every verdict, mark and photograph was written to the council record before it was shown as saved, '
    + 'and each case is re-fetched when you next open it. Held photographs and unsent checklist marks are NOT touched.',
    { confirmLabel: 'Clear cached files' },
  )
  if (!ok) return
  const n = clearCachedCaseDrafts()
  drafts.value = cachedCaseDraftKeys().length
  fb.showToast(`${n} cached case file${n === 1 ? '' : 's'} cleared.`, 'success')
}

/* ── Console preferences ───────────────────────────────────────────────── */

const LANDING_LABELS: Record<LandingSection, string> = {
  dashboard: 'Today',
  stages: 'Inspections',
  bookings: 'Bookings',
  enforcement: 'Enforcement',
  complaints: 'Public reports',
}

const canSpeak = voiceSupported()

function toggleVoice(on: boolean) {
  set('voiceGuidance', on)
  if (on) speak('Spoken guidance is on.', { interrupt: true, muted: false })
}

async function resetPrefs() {
  const ok = await fb.confirmAction(
    'Reset console preferences?',
    'Landing section, rail, spoken guidance and automatic upload go back to their defaults. '
    + 'Your appointment details and any held evidence are not affected.',
    { confirmLabel: 'Reset preferences' },
  )
  if (ok) {
    reset()
    fb.showToast('Console preferences reset.', 'success')
  }
}

/* ── Environment facts (read-only) ─────────────────────────────────────── */

const reducedMotion = ref(false)
let motionQuery: MediaQueryList | null = null
function onMotionChange(e: MediaQueryListEvent | MediaQueryList) { reducedMotion.value = e.matches }

function onOnline() { online.value = true; void refreshDevice() }
function onOffline() { online.value = false }

onMounted(() => {
  void refreshDevice()
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  try {
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotion.value = motionQuery.matches
    motionQuery.addEventListener('change', onMotionChange)
  } catch {
    motionQuery = null
  }
})
onUnmounted(() => {
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  motionQuery?.removeEventListener('change', onMotionChange)
})

const roleLabel = computed(() => auth.user?.role === 'building_inspector' ? 'Building Inspector' : (auth.user?.role ?? '—'))
</script>

<template>
  <div class="ins-page iset">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Office</span>
        <h2 class="ins-title">Settings</h2>
        <p class="ins-lede">
          Your appointment as it appears on council documents, and how this console and this
          device behave in the field.
        </p>
      </div>
      <div class="ins-actions">
        <UiButton variant="ghost" @click="resetPrefs">
          <template #icon><RotateCcw :size="15" aria-hidden="true" /></template>
          Reset preferences
        </UiButton>
      </div>
    </header>

    <!-- ── Appointment ──────────────────────────────────────────────── -->
    <section class="ins-card" aria-labelledby="iset-id-h">
      <header class="ins-card-head">
        <h3 id="iset-id-h"><UserCog :size="16" aria-hidden="true" /> Appointment</h3>
        <span class="iset-scope iset-scope-record">Council record</span>
      </header>
      <div class="ins-card-body iset-stack">
        <dl class="ins-dl">
          <div>
            <dt>Officer</dt>
            <dd>{{ auth.user?.name || '—' }}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{{ auth.user?.email || '—' }}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd><HardHat :size="13" aria-hidden="true" /> {{ roleLabel }}</dd>
          </div>
        </dl>

        <div class="ins-form">
          <div class="ins-field">
            <label class="ins-label" for="iset-title">Designation</label>
            <input id="iset-title" v-model="form.jobTitle" class="ins-input" maxlength="120"
                   autocomplete="organization-title" placeholder="Building Inspector Grade 1" />
            <p class="ins-hint">Printed under your signature on Annexure 13 certificates and enforcement papers.</p>
          </div>
          <div class="ins-field">
            <label class="ins-label" for="iset-dept">Section or unit</label>
            <input id="iset-dept" v-model="form.department" class="ins-input" maxlength="120"
                   placeholder="Building Control" />
            <p class="ins-hint">The desk a referral to you is addressed to.</p>
          </div>
          <div class="ins-field">
            <label class="ins-label" for="iset-phone">Field telephone</label>
            <input id="iset-phone" v-model="form.phone" class="ins-input" type="tel" inputmode="tel"
                   maxlength="32" autocomplete="tel" placeholder="+263 7X XXX XXXX" />
            <p class="ins-hint">How an owner or the office reaches you about a booked visit.</p>
          </div>
        </div>

        <p class="ins-hint">
          A detail can be changed here but not emptied — ask the administrator to clear one.
          Your name, photograph and password are in the account menu at the top of the workspace.
        </p>
      </div>
      <footer class="ins-card-foot">
        <span v-if="savedProfile && !dirty" class="iset-saved" role="status">
          <Check :size="14" aria-hidden="true" /> Saved
        </span>
        <UiButton variant="primary" :loading="savingProfile" :disabled="!dirty" @click="saveProfile">
          Save appointment details
        </UiButton>
      </footer>
    </section>

    <div class="iset-cols">
      <!-- ── Field work ─────────────────────────────────────────────── -->
      <section class="ins-card" aria-labelledby="iset-field-h">
        <header class="ins-card-head">
          <h3 id="iset-field-h"><HardHat :size="16" aria-hidden="true" /> Field work</h3>
          <span class="iset-scope">This device</span>
        </header>
        <div class="ins-card-body">
          <ul class="ins-checks">
            <li>
              <label class="ins-check" :class="{ on: prefs.voiceGuidance && canSpeak }">
                <input type="checkbox" :checked="prefs.voiceGuidance" :disabled="!canSpeak"
                       @change="toggleVoice(($event.target as HTMLInputElement).checked)" />
                <span>
                  <strong><Volume2 :size="14" aria-hidden="true" /> Speak driving directions</strong>
                  <small v-if="canSpeak">
                    Turns are called out at 800, 400, 200 and 50 metres while you drive to a stand,
                    so you are not reading the screen at the wheel.
                  </small>
                  <small v-else>
                    This device has no speech engine, so directions stay on screen only.
                  </small>
                </span>
              </label>
            </li>
            <li>
              <label class="ins-check" :class="{ on: prefs.autoUploadOnReconnect }">
                <input type="checkbox" :checked="prefs.autoUploadOnReconnect"
                       @change="set('autoUploadOnReconnect', ($event.target as HTMLInputElement).checked)" />
                <span>
                  <strong><UploadCloud :size="14" aria-hidden="true" /> Upload held evidence as soon as the connection returns</strong>
                  <small>
                    On, photographs taken out of signal reach the council record without you
                    remembering. Off, they stay on this device until you press Sync — useful on
                    expensive mobile data, but the record is incomplete until you do.
                  </small>
                </span>
              </label>
            </li>
          </ul>
        </div>
      </section>

      <!-- ── Console ────────────────────────────────────────────────── -->
      <section class="ins-card" aria-labelledby="iset-console-h">
        <header class="ins-card-head">
          <h3 id="iset-console-h"><Settings :size="16" aria-hidden="true" /> Console</h3>
          <span class="iset-scope">This device</span>
        </header>
        <div class="ins-card-body iset-stack">
          <div class="ins-field">
            <span id="iset-landing-l" class="ins-label">Open the console on</span>
            <div class="ins-seg" role="radiogroup" aria-labelledby="iset-landing-l">
              <button v-for="k in LANDING_SECTIONS" :key="k" type="button" role="radio"
                      :aria-checked="prefs.landingSection === k"
                      @click="set('landingSection', k)">
                {{ LANDING_LABELS[k] }}
              </button>
            </div>
            <p class="ins-hint">
              Where a plain workspace link lands. A link that names a section or an inspection
              still opens what it names.
            </p>
          </div>

          <ul class="ins-checks">
            <li>
              <label class="ins-check" :class="{ on: prefs.railCollapsed }">
                <input type="checkbox" :checked="prefs.railCollapsed"
                       @change="set('railCollapsed', ($event.target as HTMLInputElement).checked)" />
                <span>
                  <strong><PanelLeftClose :size="14" aria-hidden="true" /> Start with the section rail collapsed</strong>
                  <small>Icons only, for more room on a tablet. The rail can still be expanded at any time.</small>
                </span>
              </label>
            </li>
          </ul>

          <div class="ins-banner" :class="reducedMotion ? 't-info' : ''">
            <Info :size="16" aria-hidden="true" />
            <div>
              <strong>Motion: {{ reducedMotion ? 'reduced' : 'standard' }}.</strong>
              <p v-if="reducedMotion">
                This device asks for reduced motion, so map movements jump rather than glide.
              </p>
              <p v-else>
                Set &ldquo;reduce motion&rdquo; in the device&rsquo;s accessibility settings and the console follows it.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- ── Device and custody ───────────────────────────────────────── -->
    <section class="ins-card" aria-labelledby="iset-device-h">
      <header class="ins-card-head">
        <h3 id="iset-device-h"><Smartphone :size="16" aria-hidden="true" /> This device</h3>
        <span class="iset-scope">Custody and storage</span>
      </header>
      <div class="ins-card-body iset-stack">
        <p class="ins-banner" :class="online ? 't-info' : 't-warning'">
          <component :is="online ? Wifi : WifiOff" :size="16" aria-hidden="true" />
          <span>
            <strong>{{ online ? 'Connected.' : 'No connection.' }}</strong>
            {{ online
              ? 'Anything held on this device can be sent to the council record now.'
              : 'Keep working. Original photographs stay on this device until the connection returns.' }}
          </span>
        </p>

        <div v-if="heldUnreadable" class="ins-banner t-negative" role="alert">
          <AlertTriangle :size="16" aria-hidden="true" />
          <div>
            <strong>The evidence store on this device could not be read.</strong>
            <p>Do not treat any photograph as filed until this page can list it. Report the device.</p>
          </div>
        </div>

        <dl class="ins-dl">
          <div>
            <dt>Photographs held</dt>
            <dd v-if="heldUnreadable">unknown</dd>
            <dd v-else>{{ held.length }}<span v-if="held.length" class="iset-dim"> · {{ heldKb }} KB</span></dd>
          </div>
          <div>
            <dt>Cached case files</dt>
            <dd>{{ drafts }}</dd>
          </div>
          <div>
            <dt>Unsent checklist marks</dt>
            <dd :class="{ 'iset-unsent': unsentMarkCount > 0 }">
              {{ unsentMarkCount }}<span v-if="unsentMarks.length" class="iset-dim">
                · across {{ unsentMarks.length }} stage{{ unsentMarks.length === 1 ? '' : 's' }}</span>
            </dd>
          </div>
          <div v-if="quota">
            <dt>Device storage used</dt>
            <dd>{{ quota.usedMb }} MB<span class="iset-dim"> of {{ quota.quotaMb }} MB available</span></dd>
          </div>
        </dl>

        <p class="ins-hint">
          A photograph leaves this device only once the server confirms it. Held captures are
          listed one by one in the outbox beside your name at the top of the workspace.
        </p>
        <p v-if="unsentMarkCount" class="ins-hint iset-unsent">
          Unsent marks are not part of the council record and cannot be recovered from it.
          Open the stage in Inspections and send the checklist before this device is handed on.
        </p>
      </div>
      <footer class="ins-card-foot">
        <UiButton :disabled="!drafts" @click="clearDrafts">
          <template #icon><Database :size="15" aria-hidden="true" /></template>
          Clear cached case files
        </UiButton>
        <UiButton variant="primary" :loading="syncing" :disabled="!held.length || !online" @click="syncNow">
          <template #icon><UploadCloud :size="15" aria-hidden="true" /></template>
          Sync held evidence
        </UiButton>
      </footer>
    </section>

    <div class="ins-banner">
      <ShieldCheck :size="16" aria-hidden="true" />
      <div>
        <strong>Not settable from here, by design.</strong>
        <p>
          The distance that counts as on-site, the stages that must pass before an occupation
          certificate, and who may issue or close an enforcement order are set by the council and
          enforced by the server. An officer cannot relax their own verification.
        </p>
      </div>
    </div>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.iset-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); gap: var(--ent-s4); align-items: start; }
.iset-stack { display: flex; flex-direction: column; gap: var(--ent-s4); }

/* Which authority a block answers to — the difference between a detail printed
   on a certificate and a preference that never leaves the handset. */
.iset-scope {
  flex-shrink: 0; padding: 2px var(--ent-s2);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--ent-text-3); background: var(--ent-surface-sunken);
  border-radius: var(--ent-r-pill);
}
.iset-scope-record { color: var(--ent-accent); background: var(--ent-accent-soft); }

.iset-saved { display: inline-flex; align-items: center; gap: var(--ent-s1); margin-right: auto;
  font-size: var(--ent-fs-sm); color: var(--ent-success); }

.iset-dim { color: var(--ent-text-3); }
/* Work the council has never seen. Warning, not danger: it is safe here, but
   only here — and only until this device is wiped or replaced. */
.iset-unsent { color: var(--ent-warning); font-weight: var(--ent-fw-semibold); }
p.iset-unsent { font-weight: var(--ent-fw-normal); }

.ins-dl dd > svg, .ins-check strong > svg { vertical-align: -2px; margin-right: 4px; color: var(--ent-text-3); }
.ins-check.on strong > svg { color: var(--ent-success); }
</style>
