<script setup lang="ts">
// Active sessions — who is signed in, from where, and on what.
//
// THE QUESTION THIS ANSWERS
// "An officer has lost their laptop." Everything on this screen exists to make
// that a thirty-second job: find the officer, see what is open, end it. The
// grouping is by person rather than by session because that is how the
// question arrives — nobody reports a lost session id.
//
// WHY /auth/sessions COULD NOT DO THIS
// That endpoint is scoped to the caller's own sessions, correctly: an officer
// managing their own devices must not be able to see anyone else's. The
// console needs the opposite scope, which is why /admin/sessions exists and is
// requireAdmin.
//
// THE ADMIN'S OWN SESSION IS PROTECTED
// The server flags it and the row here refuses to revoke it. An admin who
// signs themselves out of the console while holding a maintenance window open
// has locked the council out of its own portal until someone else signs in.

import { computed, onMounted, ref } from 'vue'
import { useAdminNav } from '@/admin/useAdminConsole'
import { useAdminOverview } from '@/admin/useAdminOverview'
import {
  listSessions, revokeSession, revokeAllSessions, errorMessage, type AdminSession,
} from '@/services/adminConsole'
import { describeAgent, formatWhen, timeAgo } from '@/admin/console'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import AdminConfirm from '../AdminConfirm.vue'
import {
  Search, RefreshCw, AlertTriangle, CheckCircle2, LogOut, MonitorSmartphone, ShieldCheck,
} from 'lucide-vue-next'

const nav = useAdminNav()
const overview = useAdminOverview()

const sessions = ref<AdminSession[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref<string | null>(null)

const search = computed(() => nav.param('q'))

async function load() {
  loading.value = true
  error.value = null
  try {
    sessions.value = await listSessions()
  } catch (err) {
    sessions.value = []
    error.value = errorMessage(err, 'The session list could not be read.')
  } finally {
    loading.value = false
  }
}

onMounted(load)

interface Person {
  userId: string
  name: string
  email: string
  role: string | null
  sessions: AdminSession[]
  lastSeen: string | null
  /** The admin reading this screen. Their own sessions are not revocable here. */
  isSelf: boolean
}

/**
 * Grouped by person, most recently active first.
 *
 * A flat list of sessions sorted by time interleaves three devices belonging
 * to one officer with somebody else's, which is precisely the arrangement that
 * makes "end everything for this person" hard to do correctly by hand.
 */
const people = computed<Person[]>(() => {
  const q = search.value.trim().toLowerCase()
  const byUser = new Map<string, Person>()

  for (const s of sessions.value) {
    if (q && !`${s.name ?? ''} ${s.email} ${s.role ?? ''} ${s.ip ?? ''}`.toLowerCase().includes(q)) continue
    let person = byUser.get(s.user_id)
    if (!person) {
      person = {
        userId: s.user_id,
        name: s.name || s.email,
        email: s.email,
        role: s.role,
        sessions: [],
        lastSeen: null,
        isSelf: false,
      }
      byUser.set(s.user_id, person)
    }
    person.sessions.push(s)
    if (s.current) person.isSelf = true
    const seen = s.last_used_at ?? s.created_at
    if (!person.lastSeen || seen > person.lastSeen) person.lastSeen = seen
  }

  return [...byUser.values()]
    .map(p => ({
      ...p,
      sessions: [...p.sessions].sort((a, b) =>
        (b.last_used_at ?? b.created_at).localeCompare(a.last_used_at ?? a.created_at)),
    }))
    .sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''))
})

const columns = [
  { key: 'user_agent', label: 'Device', width: '16rem' },
  { key: 'ip', label: 'From', width: '10rem', mono: true },
  { key: 'last_used_at', label: 'Last active', width: '10rem' },
  { key: 'created_at', label: 'Signed in', width: '10rem', hideOnMobile: true },
  { key: 'expires_at', label: 'Expires', width: '9rem', hideOnMobile: true },
  { key: 'actions', label: '', width: '7rem', align: 'right' },
]

type Pending =
  | { kind: 'one'; session: AdminSession; person: Person }
  | { kind: 'all'; person: Person }
  | null

const pending = ref<Pending>(null)

const confirmCopy = computed(() => {
  const p = pending.value
  if (!p) return null
  if (p.kind === 'all') {
    const n = p.person.sessions.length
    return {
      title: 'End every session',
      message: `${p.person.name} will be signed out of ${n} device${n === 1 ? '' : 's'} immediately.`,
      consequence: 'Anything they have open and unsaved is lost. They can sign back in straight away — this does not suspend the account.',
      confirmLabel: 'Sign out everywhere',
    }
  }
  return {
    title: 'End this session',
    message: `${p.person.name} will be signed out of ${describeAgent(p.session.user_agent)}${p.session.ip ? ` at ${p.session.ip}` : ''}.`,
    consequence: 'Anything open and unsaved on that device is lost.',
    confirmLabel: 'End the session',
  }
})

async function runPending() {
  const p = pending.value
  if (!p) return
  busy.value = p.kind === 'all' ? p.person.userId : p.session.id
  error.value = null
  try {
    if (p.kind === 'all') {
      const n = await revokeAllSessions(p.person.userId)
      note.value = `Ended ${n} session${n === 1 ? '' : 's'} for ${p.person.name}.`
    } else {
      await revokeSession(p.session.id)
      note.value = `Ended one session for ${p.person.name}.`
    }
    pending.value = null
    await load()
    overview.invalidate()
  } catch (err) {
    error.value = errorMessage(err, 'The session could not be ended.')
    pending.value = null
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Security &amp; audit</span>
        <h2 class="ins-title">Active sessions</h2>
        <p class="ins-lede">
          Every officer currently signed in, grouped by person. Ending a session signs
          that device out at once; it does not suspend the account.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="se-btn" :disabled="loading" @click="load">
          <RefreshCw :size="14" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
        </button>
      </div>
    </header>

    <p class="se-summary">
      {{ sessions.length }} session{{ sessions.length === 1 ? '' : 's' }} open across
      {{ people.length }} {{ people.length === 1 ? 'person' : 'people' }}.
    </p>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>{{ error }}</span>
      <button type="button" class="se-btn" @click="load">Retry</button>
    </div>

    <p v-if="note" class="se-note" role="status">
      <CheckCircle2 :size="15" aria-hidden="true" /> {{ note }}
    </p>

    <label class="ins-search se-search">
      <Search :size="15" aria-hidden="true" />
      <span class="ent-sr-only">Search sessions</span>
      <input type="search" :value="search" placeholder="Name, email, role or address"
             @input="nav.setParam('q', ($event.target as HTMLInputElement).value)" />
    </label>

    <p v-if="loading && !sessions.length" class="se-loading" role="status">Reading the session list…</p>

    <p v-else-if="!people.length" class="se-empty">
      <MonitorSmartphone :size="18" aria-hidden="true" />
      {{ sessions.length ? 'Nobody matches that search.' : 'Nobody is signed in.' }}
    </p>

    <section v-for="person in people" :key="person.userId" class="ins-card">
      <div class="ins-card-head">
        <h3>
          {{ person.name }}
          <span class="ins-count">
            {{ person.role }} · {{ person.sessions.length }}
            device{{ person.sessions.length === 1 ? '' : 's' }} ·
            last active {{ timeAgo(person.lastSeen) }}
          </span>
        </h3>
        <span v-if="person.isSelf" class="se-you">
          <ShieldCheck :size="13" aria-hidden="true" /> This is you
        </span>
        <button v-else type="button" class="se-btn se-btn-sm"
                :disabled="busy === person.userId"
                @click="pending = { kind: 'all', person }">
          <LogOut :size="13" aria-hidden="true" /> Sign out everywhere
        </button>
      </div>

      <UiDataTable
        :columns="columns" :rows="person.sessions" row-key="id" dense
        mobile-primary="user_agent" mobile-secondary="ip" mobile-actions="actions"
      >
        <template #cell-user_agent="{ row }">
          <span class="se-device" :title="row.user_agent ?? ''">
            {{ describeAgent(row.user_agent) }}
            <em v-if="row.current">— the session you are using</em>
          </span>
        </template>
        <template #cell-last_used_at="{ row }">
          <span :title="formatWhen(row.last_used_at)">{{ timeAgo(row.last_used_at) }}</span>
        </template>
        <template #cell-created_at="{ row }">
          <span :title="formatWhen(row.created_at)">{{ timeAgo(row.created_at) }}</span>
        </template>
        <template #cell-expires_at="{ row }">
          <span :title="formatWhen(row.expires_at)">{{ timeAgo(row.expires_at) }}</span>
        </template>
        <template #cell-actions="{ row }">
          <!-- Revoking your own session while a maintenance window is open
               locks the council out of its own portal. The server flags it;
               this refuses it. -->
          <span v-if="row.current" class="se-muted">—</span>
          <button v-else type="button" class="se-btn se-btn-sm" :disabled="busy === row.id"
                  @click="pending = { kind: 'one', session: row, person }">
            End
          </button>
        </template>
      </UiDataTable>
    </section>

    <AdminConfirm
      v-if="confirmCopy"
      :open="pending !== null"
      :title="confirmCopy.title"
      :message="confirmCopy.message"
      :consequence="confirmCopy.consequence"
      :confirm-label="confirmCopy.confirmLabel"
      :busy="busy !== null"
      @confirm="runPending"
      @cancel="pending = null"
    />
  </div>
</template>

<style scoped>
.se-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r); cursor:pointer; }
.se-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.se-btn:disabled { opacity:0.55; cursor:not-allowed; }
.se-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.se-btn-sm { min-height:var(--ent-control-h-sm); padding:0 var(--ent-s2);
  font-size:var(--ent-fs-xs); gap:var(--ent-s1); }

.se-summary { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); }
.se-search { max-width:26rem; }

.se-note { display:flex; align-items:center; gap:var(--ent-s2); margin:0;
  padding:var(--ent-s2) var(--ent-s3); font-size:var(--ent-fs-sm);
  color:var(--ent-success); background:var(--ent-success-soft);
  border:1px solid var(--ent-tone-positive-line); border-radius:var(--ent-r); }

.se-loading { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-3); }
.se-empty { display:flex; align-items:center; gap:var(--ent-s2); margin:0;
  padding:var(--ent-s6); justify-content:center;
  font-size:var(--ent-fs-sm); color:var(--ent-text-3);
  background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:var(--ent-r-md); }

.se-you { display:inline-flex; align-items:center; gap:var(--ent-s1);
  font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold); color:var(--ent-accent); }

.se-device em { font-style:normal; color:var(--ent-accent); font-size:var(--ent-fs-xs); }
.se-muted { color:var(--ent-text-3); }
</style>
