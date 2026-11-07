<script setup lang="ts">
// Invitations — every staff invitation and what became of it.
//
// WHY THIS IS ITS OWN SECTION
// An invitation has a life of its own and outlives the moment it was sent. It
// can be accepted, sit unopened, expire, or be revoked — and the question "did
// that officer ever get their account" is asked days after the Employee
// screen has moved on. Folding it into the register would mean the answer is
// only visible in the seconds after the invitation is created.
//
// THE LINK IS SHOWN, NOT HIDDEN
// The token is single-use and time-limited, and the email may not have gone
// out — the outbox is a queue, not a guarantee. When the email fails, this
// link is the only route to an account, so hiding it would make a failed email
// into a blocked officer. It is treated as a credential in the copy, because
// that is what it is.

import { computed, onMounted, ref } from 'vue'
import api from '@/services/api'
import { useAdminNav } from '@/admin/useAdminConsole'
import { useAdminOverview } from '@/admin/useAdminOverview'
import { listInvites, errorMessage, type Invite } from '@/services/adminConsole'
import { formatWhen, timeAgo } from '@/admin/console'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import AdminConfirm from '../AdminConfirm.vue'
import {
  Search, RefreshCw, AlertTriangle, CheckCircle2, Copy, Send, Trash2,
} from 'lucide-vue-next'

const nav = useAdminNav()
const overview = useAdminOverview()

const invites = ref<Invite[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref<string | null>(null)
const copiedId = ref<string | null>(null)

const search = computed(() => nav.param('q'))
const statusFilter = computed(() => nav.param('status'))

type InviteState = 'accepted' | 'open' | 'expired'

/** Three outcomes, and each one needs a different action from the admin. */
function stateOf(i: Invite): InviteState {
  if (i.used) return 'accepted'
  return new Date(i.expiresAt) <= new Date() ? 'expired' : 'open'
}

const STATES: Array<{ id: '' | InviteState; label: string }> = [
  { id: '', label: 'All' },
  { id: 'open', label: 'Outstanding' },
  { id: 'expired', label: 'Expired' },
  { id: 'accepted', label: 'Accepted' },
]

async function load() {
  loading.value = true
  error.value = null
  try {
    invites.value = await listInvites()
  } catch (err) {
    invites.value = []
    error.value = errorMessage(err, 'The invitation list could not be loaded.')
  } finally {
    loading.value = false
  }
}

onMounted(load)

const rows = computed(() => {
  let list = invites.value.map(i => ({ ...i, state: stateOf(i) }))
  if (statusFilter.value) list = list.filter(i => i.state === statusFilter.value)
  const q = search.value.trim().toLowerCase()
  if (q) list = list.filter(i => `${i.email} ${i.role} ${i.jobTitle ?? ''}`.toLowerCase().includes(q))
  // Outstanding first: they are the only ones that need anything doing.
  const rank: Record<InviteState, number> = { expired: 0, open: 1, accepted: 2 }
  return list.sort((a, b) => rank[a.state] - rank[b.state]
    || b.createdAt.localeCompare(a.createdAt))
})

const counts = computed(() => {
  const c = { open: 0, expired: 0, accepted: 0 }
  for (const i of invites.value) c[stateOf(i)]++
  return c
})

const columns = [
  { key: 'email', label: 'Invited', width: '18rem' },
  { key: 'role', label: 'Role', width: '11rem' },
  { key: 'state', label: 'Status', width: '9rem' },
  { key: 'expiresAt', label: 'Expires', width: '9rem' },
  { key: 'invitedBy', label: 'Sent by', width: '11rem', hideOnMobile: true },
  { key: 'actions', label: '', width: '11rem', align: 'right' },
]

const tone = { accepted: 'positive', open: 'info', expired: 'warning' } as const

function linkFor(i: Invite) {
  return `${window.location.origin}${i.inviteUrl}`
}

async function copy(i: Invite) {
  try {
    await navigator.clipboard.writeText(linkFor(i))
    copiedId.value = i.id
    note.value = `Link for ${i.email} copied. Treat it as a password — anyone holding it can create that account.`
  } catch {
    note.value = 'The clipboard is not available here. Open the invitation row and copy the link manually.'
  }
}

/**
 * Re-issuing produces a NEW token; the old one stops working.
 *
 * That is what makes this the correct answer to an expired invitation and to a
 * link that may have been forwarded to the wrong person.
 */
async function reissue(i: Invite) {
  busy.value = i.id
  note.value = null
  try {
    const response = await api.post('/auth/invite', {
      email: i.email, name: i.jobTitle || i.email.split('@')[0],
      role: i.role, department: i.department, jobTitle: i.jobTitle,
    })
    const payload = response.data?.data ?? {}
    note.value = payload.emailQueued === true
      ? `A fresh invitation has been emailed to ${i.email}. The previous link no longer works.`
      : `A fresh invitation was created for ${i.email}, but the email could not be queued — copy the new link below and send it yourself.`
    await load()
    overview.invalidate()
  } catch (err) {
    error.value = errorMessage(err, 'The invitation could not be re-issued.')
  } finally {
    busy.value = null
  }
}

const revoking = ref<Invite | null>(null)

async function revoke() {
  const i = revoking.value
  if (!i) return
  busy.value = i.id
  try {
    await api.delete(`/admin/invites/${i.id}`)
    note.value = `The invitation for ${i.email} has been revoked. The link no longer works.`
    revoking.value = null
    await load()
    overview.invalidate()
  } catch (err) {
    error.value = errorMessage(err, 'The invitation could not be revoked.')
    revoking.value = null
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">People &amp; access</span>
        <h2 class="ins-title">Invitations</h2>
        <p class="ins-lede">
          Every staff invitation and what became of it. An invitation is the only way a
          council account is created — no password is ever chosen on someone's behalf.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="iv-btn" :disabled="loading" @click="load">
          <RefreshCw :size="14" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
        </button>
      </div>
    </header>

    <p class="iv-summary">
      {{ counts.open }} outstanding · {{ counts.expired }} expired unused ·
      {{ counts.accepted }} accepted.
    </p>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>{{ error }}</span>
      <button type="button" class="iv-btn" @click="load">Retry</button>
    </div>

    <p v-if="note" class="iv-note" role="status">
      <CheckCircle2 :size="15" aria-hidden="true" /> {{ note }}
    </p>

    <div class="iv-filters">
      <label class="ins-search iv-search">
        <Search :size="15" aria-hidden="true" />
        <span class="ent-sr-only">Search invitations</span>
        <input type="search" :value="search" placeholder="Email address or role"
               @input="nav.setParam('q', ($event.target as HTMLInputElement).value)" />
      </label>
      <div class="ins-seg" role="group" aria-label="Filter by status">
        <button v-for="s in STATES" :key="s.id" type="button"
                :aria-pressed="statusFilter === s.id"
                @click="nav.setParam('status', s.id || null)">{{ s.label }}</button>
      </div>
    </div>

    <section class="ins-card">
      <UiDataTable
        :columns="columns" :rows="rows" row-key="id" :loading="loading"
        :empty-message="invites.length
          ? 'No invitation matches this filter.'
          : 'No invitation has been sent. Invite an employee from the register.'"
        mobile-primary="email" mobile-secondary="role" mobile-status="state" mobile-actions="actions"
      >
        <template #cell-email="{ row }">
          <span class="iv-who">
            <strong>{{ row.email }}</strong>
            <small>{{ row.jobTitle || 'No post recorded' }}</small>
          </span>
        </template>
        <template #cell-state="{ row }">
          <UiStatusBadge :tone="tone[row.state as InviteState]"
                         :label="row.state === 'open' ? 'Outstanding'
                                 : row.state === 'expired' ? 'Expired' : 'Accepted'" />
        </template>
        <template #cell-expiresAt="{ row }">
          <span v-if="row.used" class="iv-muted" :title="formatWhen(row.usedAt)">
            Used {{ timeAgo(row.usedAt) }}
          </span>
          <span v-else :title="formatWhen(row.expiresAt)">{{ timeAgo(row.expiresAt) }}</span>
        </template>
        <template #cell-invitedBy="{ row }">
          <span :title="formatWhen(row.createdAt)">{{ row.invitedBy ?? '—' }}</span>
        </template>
        <template #cell-actions="{ row }">
          <!-- An accepted invitation has no actions: the token is spent, and
               offering a revoke that does nothing is worse than offering none. -->
          <div v-if="row.state !== 'accepted'" class="iv-row-actions">
            <button v-if="row.state === 'open'" type="button" class="iv-btn iv-btn-sm"
                    :title="`Copy the invitation link for ${row.email}`" @click="copy(row)">
              <Copy :size="13" aria-hidden="true" />
              {{ copiedId === row.id ? 'Copied' : 'Link' }}
            </button>
            <button type="button" class="iv-btn iv-btn-sm" :disabled="busy === row.id"
                    :title="`Issue a fresh invitation to ${row.email}`" @click="reissue(row)">
              <Send :size="13" aria-hidden="true" /> Re-issue
            </button>
            <button type="button" class="iv-btn iv-btn-sm iv-danger"
                    :title="`Revoke the invitation for ${row.email}`" @click="revoking = row">
              <Trash2 :size="13" aria-hidden="true" />
              <span class="ent-sr-only">Revoke</span>
            </button>
          </div>
          <span v-else class="iv-muted">—</span>
        </template>
      </UiDataTable>
      <div class="ins-card-foot iv-foot">
        <p class="ins-hint">
          Re-issuing creates a new token and stops the previous link working — which is
          also the right answer if a link may have reached the wrong person.
        </p>
      </div>
    </section>

    <AdminConfirm
      :open="revoking !== null"
      title="Revoke this invitation"
      :message="`The link sent to ${revoking?.email} will stop working immediately.`"
      consequence="They will not be able to create an account until a fresh invitation is issued."
      confirm-label="Revoke"
      destructive
      :busy="busy !== null"
      @confirm="revoke"
      @cancel="revoking = null"
    />
  </div>
</template>

<style scoped>
.iv-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r); cursor:pointer; }
.iv-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.iv-btn:disabled { opacity:0.55; cursor:not-allowed; }
.iv-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.iv-btn-sm { min-height:var(--ent-control-h-sm); padding:0 var(--ent-s2);
  font-size:var(--ent-fs-xs); gap:var(--ent-s1); }
.iv-danger { color:var(--ent-danger); }

.iv-summary { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); }

.iv-note { display:flex; align-items:flex-start; gap:var(--ent-s2); margin:0;
  padding:var(--ent-s2) var(--ent-s3); font-size:var(--ent-fs-sm); line-height:var(--ent-lh);
  color:var(--ent-success); background:var(--ent-success-soft);
  border:1px solid var(--ent-tone-positive-line); border-radius:var(--ent-r); }
.iv-note > svg { flex-shrink:0; margin-top:2px; }

.iv-filters { display:flex; align-items:center; gap:var(--ent-s3); flex-wrap:wrap; }
.iv-search { flex:1; min-width:16rem; }

.iv-who { display:block; min-width:0; }
.iv-who strong { display:block; font-weight:var(--ent-fw-medium); overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.iv-who small { display:block; font-size:var(--ent-fs-micro); color:var(--ent-text-3); }

.iv-row-actions { display:inline-flex; gap:var(--ent-s1); justify-content:flex-end; }
.iv-muted { color:var(--ent-text-3); }
.iv-foot { justify-content:flex-start; }

@media (max-width: 767px) { .iv-search { min-width:100%; } }
</style>
