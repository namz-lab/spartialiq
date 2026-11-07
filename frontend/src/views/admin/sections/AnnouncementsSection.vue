<script setup lang="ts">
// Announcements — service messages to staff and citizens.
//
// WHY A COUNCIL NEEDS THIS
// "The portal is down on Saturday for the migration" currently travels by
// telephone, which means the IT office fields the same call from every
// department. This is the one way to say something to everybody without
// emailing them, and it is the reason the maintenance window can be announced
// before it starts rather than discovered.
//
// AUDIENCE IS A REAL CHOICE, NOT A LABEL
//   admin   a note to whoever is next in this console
//   staff   every officer, on their own workspace
//   all     citizens on the public portal too
// The third one is a public statement by the council and the form says so —
// an administrator should know when they are about to publish.
//
// WITHDRAWN, NOT DELETED
// An announcement that was live is a fact about what the council said and
// when. It is withdrawn and kept, the same posture the enforcement and
// certificate registers take everywhere else in this system.

import { computed, onMounted, ref } from 'vue'
import {
  listAnnouncements, createAnnouncement, updateAnnouncement, withdrawAnnouncement,
  errorMessage, type Announcement, type AnnouncementLevel, type AnnouncementAudience,
} from '@/services/adminConsole'
import { useAdminOverview } from '@/admin/useAdminOverview'
import { formatWhen, timeAgo } from '@/admin/console'
import UiSheet from '@/components/ui/UiSheet.vue'
import AdminConfirm from '../AdminConfirm.vue'
import {
  RefreshCw, AlertTriangle, CheckCircle2, Plus, Pencil, Megaphone, Globe, Users, ShieldCheck,
} from 'lucide-vue-next'

const overview = useAdminOverview()

const announcements = ref<Announcement[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref(false)
const showWithdrawn = ref(false)

const LEVELS: Array<{ id: AnnouncementLevel; label: string; help: string }> = [
  { id: 'info', label: 'Information', help: 'Something to know. Shown quietly.' },
  { id: 'warning', label: 'Warning', help: 'Something that will affect their work.' },
  { id: 'critical', label: 'Critical', help: 'Something happening now that stops work.' },
]

const AUDIENCES: Array<{ id: AnnouncementAudience; label: string; help: string; icon: typeof Globe }> = [
  { id: 'admin', label: 'IT administrators', help: 'A note for whoever is next in this console.', icon: ShieldCheck },
  { id: 'staff', label: 'Council staff', help: 'Every officer, on their own workspace.', icon: Users },
  { id: 'all', label: 'Staff and the public', help: 'Citizens see this on the public portal. It is a public statement by the council.', icon: Globe },
]

async function load() {
  loading.value = true
  error.value = null
  try {
    announcements.value = await listAnnouncements(true)
  } catch (err) {
    announcements.value = []
    error.value = errorMessage(err, 'The announcements could not be read.')
  } finally {
    loading.value = false
  }
}

onMounted(load)

type State = 'live' | 'scheduled' | 'ended' | 'withdrawn'

function stateOf(a: Announcement): State {
  if (a.withdrawn_at) return 'withdrawn'
  const now = new Date()
  if (new Date(a.starts_at) > now) return 'scheduled'
  if (a.ends_at && new Date(a.ends_at) <= now) return 'ended'
  return 'live'
}

const visible = computed(() => {
  const rank: Record<State, number> = { live: 0, scheduled: 1, ended: 2, withdrawn: 3 }
  return announcements.value
    .map(a => ({ ...a, state: stateOf(a) }))
    .filter(a => showWithdrawn.value || (a.state !== 'withdrawn' && a.state !== 'ended'))
    .sort((a, b) => rank[a.state] - rank[b.state] || b.starts_at.localeCompare(a.starts_at))
})

const liveCount = computed(() => announcements.value.filter(a => stateOf(a) === 'live').length)

// ── Compose ─────────────────────────────────────────────────────────────
const formOpen = ref(false)
const editing = ref<Announcement | null>(null)
const form = ref({
  title: '', body: '',
  level: 'info' as AnnouncementLevel,
  audience: 'staff' as AnnouncementAudience,
  startsAt: '', endsAt: '',
})
const formError = ref<string | null>(null)

/** A datetime-local value from an ISO instant, in the reader's own zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function openNew() {
  editing.value = null
  form.value = { title: '', body: '', level: 'info', audience: 'staff', startsAt: '', endsAt: '' }
  formError.value = null
  formOpen.value = true
}

function openEdit(a: Announcement) {
  editing.value = a
  form.value = {
    title: a.title, body: a.body, level: a.level, audience: a.audience,
    startsAt: toLocalInput(a.starts_at), endsAt: toLocalInput(a.ends_at),
  }
  formError.value = null
  formOpen.value = true
}

async function save() {
  if (!form.value.title.trim() || !form.value.body.trim()) {
    formError.value = 'A title and a message are both required.'
    return
  }
  if (form.value.startsAt && form.value.endsAt && form.value.endsAt <= form.value.startsAt) {
    formError.value = 'The end has to come after the start.'
    return
  }
  busy.value = true
  formError.value = null
  try {
    const payload = {
      title: form.value.title.trim(),
      body: form.value.body.trim(),
      level: form.value.level,
      audience: form.value.audience,
      // A datetime-local carries no zone; new Date() reads it in the browser's,
      // which is the zone the administrator meant.
      startsAt: form.value.startsAt ? new Date(form.value.startsAt).toISOString() : null,
      endsAt: form.value.endsAt ? new Date(form.value.endsAt).toISOString() : null,
    }
    if (editing.value) {
      await updateAnnouncement(editing.value.id, payload)
      note.value = 'The announcement has been amended.'
    } else {
      await createAnnouncement(payload)
      note.value = payload.audience === 'all'
        ? 'Published. Citizens will see it on the public portal.'
        : 'Published to council staff.'
    }
    formOpen.value = false
    await load()
    overview.invalidate()
  } catch (err) {
    formError.value = errorMessage(err, 'The announcement could not be saved.')
  } finally {
    busy.value = false
  }
}

const withdrawing = ref<Announcement | null>(null)

async function withdraw() {
  const a = withdrawing.value
  if (!a) return
  busy.value = true
  try {
    await withdrawAnnouncement(a.id)
    note.value = 'Withdrawn. It is no longer shown, and the record of it is kept.'
    withdrawing.value = null
    await load()
    overview.invalidate()
  } catch (err) {
    error.value = errorMessage(err, 'The announcement could not be withdrawn.')
    withdrawing.value = null
  } finally {
    busy.value = false
  }
}

const stateTone: Record<State, string> = {
  live: 'positive', scheduled: 'info', ended: 'neutral', withdrawn: 'neutral',
}
const audienceMeta = (id: AnnouncementAudience) => AUDIENCES.find(a => a.id === id)!
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">System &amp; operations</span>
        <h2 class="ins-title">Announcements</h2>
        <p class="ins-lede">
          Service messages to staff, and to citizens on the public portal. The way to
          announce a maintenance window before it starts rather than after.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="an-btn an-btn-primary" @click="openNew">
          <Plus :size="14" aria-hidden="true" /> New announcement
        </button>
        <button type="button" class="an-btn" :disabled="loading" @click="load">
          <RefreshCw :size="14" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
        </button>
      </div>
    </header>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>{{ error }}</span>
      <button type="button" class="an-btn" @click="load">Retry</button>
    </div>

    <p v-if="note" class="an-note" role="status">
      <CheckCircle2 :size="15" aria-hidden="true" /> {{ note }}
    </p>

    <div class="an-bar">
      <p class="an-summary">
        {{ liveCount }} announcement{{ liveCount === 1 ? '' : 's' }} live right now.
      </p>
      <label class="an-toggle">
        <input type="checkbox" v-model="showWithdrawn" />
        Show ended and withdrawn
      </label>
    </div>

    <p v-if="loading && !announcements.length" class="an-loading" role="status">Reading announcements…</p>

    <p v-else-if="!visible.length" class="an-empty">
      <Megaphone :size="18" aria-hidden="true" />
      {{ announcements.length
        ? 'Nothing live. Tick the box above to see what has been said before.'
        : 'Nothing has been announced.' }}
    </p>

    <ul v-else class="an-list">
      <li v-for="a in visible" :key="a.id" class="an-item" :class="`st-${a.state}`">
        <div class="an-item-head">
          <span class="an-state" :class="`t-${stateTone[a.state as State]}`">
            {{ a.state === 'live' ? 'Live now'
              : a.state === 'scheduled' ? 'Scheduled'
              : a.state === 'ended' ? 'Ended' : 'Withdrawn' }}
          </span>
          <span class="an-audience">
            <component :is="audienceMeta(a.audience).icon" :size="13" aria-hidden="true" />
            {{ audienceMeta(a.audience).label }}
          </span>
          <span class="an-level" :class="`lv-${a.level}`">{{ a.level }}</span>
        </div>

        <h3 class="an-title">{{ a.title }}</h3>
        <p class="an-body">{{ a.body }}</p>

        <div class="an-item-foot">
          <span class="an-when">
            <template v-if="a.state === 'scheduled'">
              Starts {{ timeAgo(a.starts_at) }}
            </template>
            <template v-else>
              Published {{ timeAgo(a.starts_at) }}
            </template>
            <template v-if="a.ends_at"> · ends {{ timeAgo(a.ends_at) }}</template>
            <template v-else-if="a.state === 'live'"> · no end date</template>
            <template v-if="a.created_by_name"> · {{ a.created_by_name }}</template>
          </span>
          <div v-if="a.state !== 'withdrawn'" class="an-item-actions">
            <button type="button" class="an-btn an-btn-sm" @click="openEdit(a)">
              <Pencil :size="13" aria-hidden="true" /> Amend
            </button>
            <button type="button" class="an-btn an-btn-sm an-danger" @click="withdrawing = a">
              Withdraw
            </button>
          </div>
          <span v-else class="an-withdrawn" :title="formatWhen(a.withdrawn_at)">
            Withdrawn {{ timeAgo(a.withdrawn_at) }}
          </span>
        </div>
      </li>
    </ul>

    <!-- ── Compose ────────────────────────────────────────────────────── -->
    <UiSheet :open="formOpen" :title="editing ? 'Amend this announcement' : 'New announcement'"
             subtitle="Shown to whoever the audience names, for as long as it is live"
             width="34rem" @close="formOpen = false" @update:open="formOpen = $event">
      <form class="an-form" @submit.prevent="save">
        <div class="ins-field">
          <label class="ins-label" for="an-title">Title</label>
          <input id="an-title" v-model="form.title" class="ins-input"
                 placeholder="Planned maintenance on Saturday" maxlength="160" />
        </div>

        <div class="ins-field">
          <label class="ins-label" for="an-body">Message</label>
          <textarea id="an-body" v-model="form.body" class="ins-input" rows="4"
                    placeholder="What is happening, when, and what it means for their work"></textarea>
          <p class="ins-hint">Plain sentences. No exclamation marks — this is the council speaking.</p>
        </div>

        <fieldset class="an-fieldset">
          <legend class="ins-label">Who sees it</legend>
          <label v-for="a in AUDIENCES" :key="a.id" class="ins-check" :class="{ on: form.audience === a.id }">
            <input type="radio" name="an-audience" :value="a.id" v-model="form.audience" />
            <span>
              <strong>{{ a.label }}</strong>
              <small>{{ a.help }}</small>
            </span>
          </label>
        </fieldset>

        <fieldset class="an-fieldset">
          <legend class="ins-label">How it is shown</legend>
          <div class="ins-seg an-levels" role="radiogroup">
            <button v-for="l in LEVELS" :key="l.id" type="button" role="radio"
                    :aria-checked="form.level === l.id" :title="l.help"
                    @click="form.level = l.id">{{ l.label }}</button>
          </div>
          <p class="ins-hint">{{ LEVELS.find(l => l.id === form.level)?.help }}</p>
        </fieldset>

        <div class="an-dates">
          <div class="ins-field">
            <label class="ins-label" for="an-start">Starts</label>
            <input id="an-start" v-model="form.startsAt" type="datetime-local" class="ins-input" />
            <p class="ins-hint">Leave empty to publish now.</p>
          </div>
          <div class="ins-field">
            <label class="ins-label" for="an-end">Ends</label>
            <input id="an-end" v-model="form.endsAt" type="datetime-local" class="ins-input" />
            <p class="ins-hint">Leave empty and it stays up until withdrawn.</p>
          </div>
        </div>

        <!-- Publishing to citizens is a public statement by the council. The
             administrator should know it before pressing Publish, not after. -->
        <p v-if="form.audience === 'all'" class="ins-banner t-warning an-public">
          <Globe :size="16" aria-hidden="true" />
          <span>
            This will appear on the public portal, where anyone can read it. Check the
            wording — it is the council speaking to the district.
          </span>
        </p>

        <p v-if="formError" class="an-error" role="alert">{{ formError }}</p>

        <div class="an-form-actions">
          <button type="button" class="an-btn" @click="formOpen = false">Cancel</button>
          <button type="submit" class="an-btn an-btn-primary" :disabled="busy">
            {{ busy ? 'Saving…' : editing ? 'Save the change' : 'Publish' }}
          </button>
        </div>
      </form>
    </UiSheet>

    <AdminConfirm
      :open="withdrawing !== null"
      title="Withdraw this announcement"
      :message="`“${withdrawing?.title}” will stop being shown immediately.`"
      consequence="The record of what was said, and when, is kept — nothing is deleted."
      confirm-label="Withdraw"
      :busy="busy"
      @confirm="withdraw"
      @cancel="withdrawing = null"
    />
  </div>
</template>

<style scoped>
.an-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r); cursor:pointer; }
.an-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.an-btn:disabled { opacity:0.55; cursor:not-allowed; }
.an-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.an-btn-sm { min-height:var(--ent-control-h-sm); padding:0 var(--ent-s2);
  font-size:var(--ent-fs-xs); gap:var(--ent-s1); }
.an-btn-primary { color:var(--ent-text-on-accent); background:var(--ent-accent); border-color:var(--ent-accent); }
.an-btn-primary:hover:not(:disabled) { background:var(--ent-accent-hover); }
.an-danger { color:var(--ent-danger); }

.an-bar { display:flex; align-items:center; justify-content:space-between; gap:var(--ent-s3); flex-wrap:wrap; }
.an-summary { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); }
.an-toggle { display:inline-flex; align-items:center; gap:var(--ent-s2);
  font-size:var(--ent-fs-sm); color:var(--ent-text-2); cursor:pointer; }
.an-toggle input { accent-color:var(--ent-accent); }

.an-note { display:flex; align-items:center; gap:var(--ent-s2); margin:0;
  padding:var(--ent-s2) var(--ent-s3); font-size:var(--ent-fs-sm);
  color:var(--ent-success); background:var(--ent-success-soft);
  border:1px solid var(--ent-tone-positive-line); border-radius:var(--ent-r); }

.an-loading { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-3); }
.an-empty { display:flex; align-items:center; gap:var(--ent-s2); margin:0;
  padding:var(--ent-s6); justify-content:center;
  font-size:var(--ent-fs-sm); color:var(--ent-text-3);
  background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:var(--ent-r-md); }

.an-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s3); }
.an-item { padding:var(--ent-s4); background:var(--ent-surface);
  border:1px solid var(--ent-line);
  border-radius:var(--ent-r-md); box-shadow:var(--ent-e1); }
/* Ended and withdrawn recede rather than disappearing: what the council said
   before is still part of the record. */
.an-item.st-ended, .an-item.st-withdrawn { opacity:0.62; }

.an-item-head { display:flex; align-items:center; gap:var(--ent-s3); flex-wrap:wrap;
  margin-bottom:var(--ent-s2); font-size:var(--ent-fs-micro); }
.an-state { font-weight:var(--ent-fw-semibold); letter-spacing:0.04em; text-transform:uppercase; }
.an-state.t-positive { color:var(--ent-success); }
.an-state.t-info { color:var(--ent-accent); }
.an-state.t-neutral { color:var(--ent-text-3); }
.an-audience { display:inline-flex; align-items:center; gap:var(--ent-s1); color:var(--ent-text-2); }
/* The severity, as a badge rather than the grey lowercase word it was. This
   is where the level lives now: it is the same vocabulary every other state in
   this console uses, it is legible at a glance, and it carries the tone in the
   place the reader is already looking. */
.an-level { padding:1px 7px; border-radius:var(--ent-r-pill);
  font-weight:var(--ent-fw-semibold); text-transform:capitalize;
  color:var(--ent-tone-neutral-fg); background:var(--ent-tone-neutral-bg); }
.an-level.lv-info     { color:var(--ent-tone-info-fg);     background:var(--ent-tone-info-bg); }
.an-level.lv-warning  { color:var(--ent-tone-warning-fg);  background:var(--ent-tone-warning-bg); }
.an-level.lv-critical { color:var(--ent-tone-negative-fg); background:var(--ent-tone-negative-bg); }

.an-title { margin:0; font-size:var(--ent-fs-md); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.an-body { margin:var(--ent-s1) 0 0; font-size:var(--ent-fs-sm); line-height:var(--ent-lh);
  color:var(--ent-text-2); max-width:80ch; white-space:pre-wrap; }

.an-item-foot { display:flex; align-items:center; justify-content:space-between;
  gap:var(--ent-s3); flex-wrap:wrap; margin-top:var(--ent-s3); }
.an-when { font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.an-item-actions { display:inline-flex; gap:var(--ent-s2); }
.an-withdrawn { font-size:var(--ent-fs-xs); color:var(--ent-text-3); }

.an-form { display:flex; flex-direction:column; gap:var(--ent-s4); }
.an-fieldset { margin:0; padding:0; border:0; display:flex; flex-direction:column; gap:var(--ent-s2); }
.an-levels { align-self:flex-start; }
.an-dates { display:grid; grid-template-columns:repeat(auto-fit, minmax(12rem, 1fr)); gap:var(--ent-s3); }
.an-public { margin:0; }
.an-error { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-danger); }
.an-form-actions { display:flex; justify-content:flex-end; gap:var(--ent-s2); }
</style>
