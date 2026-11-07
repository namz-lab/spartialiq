<script setup lang="ts">
// Employee accounts — the council staff register and its whole lifecycle.
//
// WHAT AN ACCOUNT CAN HAVE DONE TO IT, AND WHY EACH IS HERE
//   invite     the only way a staff account is created. There is no "add
//              user" form: a password the IT Admin chose is a password the IT
//              Admin knows, and an officer's account has to be theirs alone.
//   amend      role, job title and department. Not email — the address is the
//              identity the audit trail attributes to.
//   suspend    the reversible one. Used for a suspension, a secondment, a
//              disciplinary hold. The row stays and the history stays.
//   restore    the other half of it.
//   sign out   ends every session the officer has open. What a lost laptop
//              needs, and it is separate from suspending because the officer
//              has usually done nothing wrong.
//   remove     a soft delete. The row survives for audit attribution, the
//              account cannot sign in, and the email stays reserved.
//
// CITIZENS ARE NOT EMPLOYEES
// The backend scopes to staff roles with ?staff=true. The client-side filter
// below is defence in depth for legacy rows carrying `user`, not the primary
// control — a citizen appearing in the employee register is how the wrong
// person ends up with a council role.
//
// THE ROLE PICKER CAN ONLY GRANT STAFF ROLES
// Citizen roles are issued by the system on self-registration and must never
// be handed out here. They are not merely hidden: assertAssignable() refuses
// them on the way to the server as well, because a hidden option is a UI
// decision and this is an access-control one.

import { computed, onMounted, reactive, ref } from 'vue'
import api from '@/services/api'
import { isClientRole } from '@/services/types'
import { useAdminNav } from '@/admin/useAdminConsole'
import { useAdminOverview } from '@/admin/useAdminOverview'
import {
  listStaff, revokeAllSessions, errorMessage, type StaffUser,
} from '@/services/adminConsole'
import { asLabel, formatWhen, timeAgo } from '@/admin/console'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import AdminConfirm from '../AdminConfirm.vue'
import {
  Search, UserPlus, RefreshCw, AlertTriangle, CheckCircle2, Copy, MoreHorizontal,
} from 'lucide-vue-next'

const nav = useAdminNav()
const overview = useAdminOverview()

// Client (citizen) accounts never appear in the employee register — a
// client-side safeguard behind the server's ?staff=true. `user` is a legacy
// pre-role value that is not staff either.
const isNotStaff = (role: string) => isClientRole(role) || role === 'user'

/**
 * Roles the IT Admin may grant.
 *
 * Mirrors ASSIGNABLE_ROLES in the backend's src/config/permissions.js. Kept
 * as a literal here rather than fetched, because the picker has to render
 * before /admin/permissions returns and an empty picker is worse than a
 * list that a test keeps honest.
 */
const ASSIGNABLE = [
  { id: 'planner',            label: 'Town Planning Officer' },
  { id: 'eo',                 label: 'Executive Officer' },
  { id: 'env_officer',        label: 'Environmental Health Officer' },
  { id: 'building_inspector', label: 'Building Inspector' },
  { id: 'planning_clerk',     label: 'Planning Clerk' },
  { id: 'surveyor',           label: 'Surveyor' },
  { id: 'gis_officer',        label: 'GIS Officer' },
  { id: 'admin',              label: 'IT Administrator' },
]
const ASSIGNABLE_IDS = new Set(ASSIGNABLE.map(r => r.id))
const roleLabel = (id: string) => ASSIGNABLE.find(r => r.id === id)?.label ?? id

const users = ref<StaffUser[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref<string | null>(null)

const search = computed(() => nav.param('q'))
const statusFilter = computed(() => nav.param('status'))
const roleFilter = computed(() => nav.param('user'))

const STATUSES = [
  { id: '', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'pending', label: 'Pending' },
  { id: 'suspended', label: 'Suspended' },
]

async function load() {
  loading.value = true
  error.value = null
  try {
    users.value = (await listStaff(true)).filter(u => !isNotStaff(u.role))
  } catch (err) {
    // Never fall back to a synthetic list: an empty employee register that is
    // actually a failed request is how an admin concludes nobody has access.
    users.value = []
    error.value = errorMessage(err, 'The employee register could not be loaded.')
  } finally {
    loading.value = false
  }
}

onMounted(load)

/**
 * "Pending" is not a column in the users table — it is the absence of a first
 * sign-in on an active account, which is what an unaccepted invitation looks
 * like from the register's side.
 */
function statusOf(u: StaffUser): 'active' | 'pending' | 'suspended' {
  if (u.status === 'suspended' || !u.active) return 'suspended'
  return u.lastLogin ? 'active' : 'pending'
}

const filtered = computed(() => {
  let list = users.value
  if (statusFilter.value) list = list.filter(u => statusOf(u) === statusFilter.value)
  if (roleFilter.value) list = list.filter(u => u.role === roleFilter.value)
  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter(u =>
      `${u.name} ${u.email} ${u.role} ${u.jobTitle ?? ''} ${u.department ?? ''}`.toLowerCase().includes(q))
  }
  return list
})

const summary = computed(() => {
  const s = { total: users.value.length, active: 0, pending: 0, suspended: 0 }
  for (const u of users.value) s[statusOf(u)]++
  return s
})

const columns = [
  { key: 'name', label: 'Officer', width: '18rem' },
  { key: 'jobTitle', label: 'Post', width: '14rem' },
  { key: 'role', label: 'System role', width: '13rem' },
  { key: 'status', label: 'Status', width: '8rem' },
  { key: 'lastLogin', label: 'Last signed in', width: '10rem', hideOnMobile: true },
  { key: 'actions', label: '', width: '3rem', align: 'right' },
]

const tableRows = computed(() => filtered.value.map(u => ({ ...u, status: statusOf(u) })))

const statusTone = { active: 'positive', pending: 'warning', suspended: 'negative' } as const

// ── Invite / amend ──────────────────────────────────────────────────────
const formOpen = ref(false)
const editing = ref<StaffUser | null>(null)
const form = reactive({ email: '', name: '', jobTitle: '', department: 'Planning & Environment', role: '' })
const formError = ref<string | null>(null)
const saving = ref(false)

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function openInvite() {
  editing.value = null
  // No default role: a mis-click on Save must never grant access, and there is
  // no staff role without access to pre-select.
  Object.assign(form, { email: '', name: '', jobTitle: '', department: 'Planning & Environment', role: '' })
  formError.value = null
  formOpen.value = true
}

function openEdit(u: StaffUser) {
  editing.value = u
  Object.assign(form, {
    email: u.email, name: u.name,
    jobTitle: u.jobTitle ?? '', department: u.department ?? '', role: u.role,
  })
  formError.value = null
  formOpen.value = true
}

// ── Invite link ─────────────────────────────────────────────────────────
const inviteLink = ref<string | null>(null)
const inviteEmail = ref('')
const inviteEmailed = ref(false)
const copied = ref(false)

async function save() {
  formError.value = null

  // Refused here as well as hidden from the picker: a hidden option is a UI
  // decision and this is an access-control one.
  if (!form.role) {
    formError.value = 'Choose the officer’s system role.'
    return
  }
  if (!ASSIGNABLE_IDS.has(form.role)) {
    formError.value = 'That is a client (citizen) role and cannot be granted to staff.'
    return
  }
  if (!form.jobTitle.trim()) {
    formError.value = 'A post title is required — it is what the org structure and the invitation both use.'
    return
  }
  if (!editing.value && !EMAIL_RX.test(form.email.trim())) {
    formError.value = 'Enter a valid work email address.'
    return
  }

  saving.value = true
  try {
    if (editing.value) {
      await api.put(`/admin/users/${editing.value.id}`, {
        role: form.role,
        jobTitle: form.jobTitle.trim(),
        department: form.department.trim() || null,
      })
      note.value = `${editing.value.name} updated. The change is in the audit trail.`
      formOpen.value = false
      await load()
    } else {
      const response = await api.post('/auth/invite', {
        email: form.email.trim(),
        name: form.name.trim() || form.jobTitle.trim(),
        role: form.role,
        department: form.department.trim() || null,
        jobTitle: form.jobTitle.trim(),
      })
      const payload = response.data?.data ?? {}
      const token = payload.invite_token || payload.token
      if (!token) {
        formError.value = 'The server accepted the invitation but returned no link. Check Invitations before retrying.'
        return
      }
      inviteLink.value = `${window.location.origin}/invite?token=${token}`
      inviteEmail.value = form.email.trim()
      inviteEmailed.value = payload.emailQueued === true
      copied.value = false
      formOpen.value = false
      await load()
    }
    overview.invalidate()
  } catch (err) {
    formError.value = errorMessage(err, 'The change could not be saved.')
  } finally {
    saving.value = false
  }
}

async function copyInvite() {
  if (!inviteLink.value) return
  try {
    await navigator.clipboard.writeText(inviteLink.value)
    copied.value = true
  } catch {
    // Clipboard access is refused in some hardened browser configurations.
    // The link is on screen and selectable, so this is a note, not a failure.
    copied.value = false
    note.value = 'The clipboard is not available here. Select the link and copy it manually.'
  }
}

// ── Lifecycle actions ───────────────────────────────────────────────────
type Pending =
  | { kind: 'suspend' | 'restore' | 'remove' | 'signout'; user: StaffUser }
  | null

const pending = ref<Pending>(null)

/**
 * The wording for each action, keyed by kind.
 *
 * A record rather than a switch so it is total by construction: adding a kind
 * to Pending without wording for it is a type error here, not a confirmation
 * dialog that renders blank.
 */
const CONFIRM_COPY: Record<NonNullable<Pending>['kind'], (who: string) => {
  title: string; message: string; consequence?: string; confirmLabel: string; destructive: boolean
}> = {
  suspend: (who) => ({
    title: 'Suspend this account',
    message: `${who} will be signed out and refused access until the account is restored.`,
    consequence: 'Any work they have open and unsaved will be lost. Their record and history stay.',
    confirmLabel: 'Suspend',
    destructive: false,
  }),
  restore: (who) => ({
    title: 'Restore access',
    message: `${who} will be able to sign in again with the same role and password.`,
    confirmLabel: 'Restore',
    destructive: false,
  }),
  signout: (who) => ({
    title: 'Sign out of every device',
    message: `Every session ${who} has open will be ended immediately.`,
    consequence: 'They can sign straight back in — this does not suspend the account. Use it for a lost or stolen device.',
    confirmLabel: 'Sign out everywhere',
    destructive: false,
  }),
  remove: (who) => ({
    title: 'Remove this account',
    message: `${who} will be permanently unable to sign in.`,
    consequence: 'The record is kept so the audit trail can still name them, and the email address stays reserved. Only a database administrator can undo this.',
    confirmLabel: 'Remove the account',
    destructive: true,
  }),
}

const confirmCopy = computed(() => {
  const p = pending.value
  if (!p) return null
  return CONFIRM_COPY[p.kind](p.user.name || p.user.email)
})

async function runPending() {
  const p = pending.value
  if (!p) return
  busy.value = p.user.id
  error.value = null
  try {
    const who = p.user.name || p.user.email
    switch (p.kind) {
      case 'suspend':
        await api.post(`/admin/users/${p.user.id}/suspend`, { suspended: true })
        note.value = `${who} is suspended.`
        break
      case 'restore':
        await api.post(`/admin/users/${p.user.id}/suspend`, { suspended: false })
        note.value = `${who} can sign in again.`
        break
      case 'signout': {
        const n = await revokeAllSessions(p.user.id)
        note.value = n === 0
          ? `${who} had no session open.`
          : `Ended ${n} session${n === 1 ? '' : 's'} for ${who}.`
        break
      }
      case 'remove':
        await api.delete(`/admin/users/${p.user.id}`)
        note.value = `${who} has been removed.`
        break
    }
    pending.value = null
    await load()
    overview.invalidate()
  } catch (err) {
    error.value = errorMessage(err, 'The action could not be completed.')
    pending.value = null
  } finally {
    busy.value = null
  }
}

// ── Row menu ────────────────────────────────────────────────────────────
// One menu rather than five inline buttons: at six columns, five icon buttons
// per row is a wall of glyphs an admin has to decode on every line.
const menuFor = ref<string | null>(null)
function toggleMenu(id: string) { menuFor.value = menuFor.value === id ? null : id }
</script>

<template>
  <div class="ins-page" @click="menuFor = null">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">People &amp; access</span>
        <h2 class="ins-title">Employee accounts</h2>
        <p class="ins-lede">
          Council staff only. Citizens who registered themselves are not employees and
          never appear here.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="em-btn em-btn-primary" @click.stop="openInvite">
          <UserPlus :size="14" aria-hidden="true" /> Invite an employee
        </button>
        <button type="button" class="em-btn" :disabled="loading" @click="load">
          <RefreshCw :size="14" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
        </button>
      </div>
    </header>

    <p class="em-summary">
      {{ summary.total }} employee{{ summary.total === 1 ? '' : 's' }} on the register ·
      {{ summary.active }} active · {{ summary.pending }} yet to sign in ·
      {{ summary.suspended }} suspended.
    </p>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <div>
        <strong>{{ error }}</strong>
        <p>An empty register below would not mean nobody has access. Retry before acting on it.</p>
      </div>
      <button type="button" class="em-btn" @click="load">Retry</button>
    </div>

    <p v-if="note" class="em-note" role="status">
      <CheckCircle2 :size="15" aria-hidden="true" /> {{ note }}
    </p>

    <!-- ── Filters ────────────────────────────────────────────────────── -->
    <div class="em-filters">
      <label class="ins-search em-search">
        <Search :size="15" aria-hidden="true" />
        <span class="ent-sr-only">Search employees</span>
        <input type="search" :value="search" placeholder="Name, email, post or role"
               @input="nav.setParam('q', ($event.target as HTMLInputElement).value)" />
      </label>

      <div class="ins-seg" role="group" aria-label="Filter by status">
        <button v-for="s in STATUSES" :key="s.id" type="button"
                :aria-pressed="statusFilter === s.id"
                @click="nav.setParam('status', s.id || null)">{{ s.label }}</button>
      </div>

      <label class="em-select">
        <span class="ent-sr-only">Filter by role</span>
        <select class="ins-input" :value="roleFilter"
                @change="nav.setParam('user', ($event.target as HTMLSelectElement).value)">
          <option value="">Every role</option>
          <option v-for="r in ASSIGNABLE" :key="r.id" :value="r.id">{{ r.label }}</option>
        </select>
      </label>
    </div>

    <!-- ── Register ───────────────────────────────────────────────────── -->
    <section class="ins-card">
      <UiDataTable
        :columns="columns" :rows="tableRows" row-key="id" :loading="loading"
        :empty-message="users.length
          ? 'No employee matches these filters.'
          : 'No employee on the register yet. Invite the first staff account.'"
        mobile-primary="name" mobile-secondary="jobTitle" mobile-status="status" mobile-actions="actions"
      >
        <template #cell-name="{ row }">
          <span class="em-person">
            <strong>{{ row.name }}</strong>
            <small>{{ row.email }}</small>
          </span>
        </template>
        <template #cell-jobTitle="{ row }">
          <span class="em-person">
            <strong>{{ row.jobTitle || '—' }}</strong>
            <small>{{ row.department || 'No department' }}</small>
          </span>
        </template>
        <template #cell-role="{ row }">{{ roleLabel(row.role) }}</template>
        <template #cell-status="{ row }">
          <UiStatusBadge :tone="statusTone[row.status as keyof typeof statusTone]"
                         :label="row.status === 'pending' ? 'Not yet signed in' : asLabel(row.status)" />
        </template>
        <template #cell-lastLogin="{ row }">
          <span :title="formatWhen(row.lastLogin)">
            {{ row.lastLogin ? timeAgo(row.lastLogin) : 'Never' }}
          </span>
        </template>
        <template #cell-actions="{ row }">
          <div class="em-menu-wrap">
            <button type="button" class="ins-iconbtn" :aria-expanded="menuFor === row.id"
                    :aria-label="`Actions for ${row.name}`" @click.stop="toggleMenu(row.id)">
              <MoreHorizontal :size="15" aria-hidden="true" />
            </button>
            <div v-if="menuFor === row.id" class="em-menu" @click.stop>
              <button type="button" @click="openEdit(row); menuFor = null">Amend post &amp; role</button>
              <button type="button" @click="pending = { kind: 'signout', user: row }; menuFor = null">
                Sign out of every device
              </button>
              <button v-if="row.status !== 'suspended'" type="button"
                      @click="pending = { kind: 'suspend', user: row }; menuFor = null">
                Suspend access
              </button>
              <button v-else type="button" @click="pending = { kind: 'restore', user: row }; menuFor = null">
                Restore access
              </button>
              <hr />
              <button type="button" class="em-menu-danger"
                      @click="pending = { kind: 'remove', user: row }; menuFor = null">
                Remove the account
              </button>
            </div>
          </div>
        </template>
      </UiDataTable>
    </section>

    <!-- ── Invite / amend form ────────────────────────────────────────── -->
    <UiSheet :open="formOpen"
             :title="editing ? 'Amend this account' : 'Invite an employee'"
             :subtitle="editing ? editing.email : 'They set their own password from the link'"
             width="32rem" @close="formOpen = false" @update:open="formOpen = $event">
      <form class="ins-form" @submit.prevent="save">
        <div v-if="!editing" class="ins-field full">
          <label class="ins-label" for="em-email">Work email</label>
          <input id="em-email" v-model="form.email" type="email" class="ins-input"
                 placeholder="officer@vungurdc.gov.zw" autocomplete="off" />
          <p class="ins-hint">
            The invitation goes here, and this becomes the identity the audit trail
            attributes their work to. It cannot be changed afterwards.
          </p>
        </div>
        <div v-else class="ins-field full">
          <label class="ins-label">Work email</label>
          <input class="ins-input" :value="editing.email" disabled />
          <p class="ins-hint">
            Fixed. The audit trail already attributes work to this address, so changing
            it would break the attribution.
          </p>
        </div>

        <div v-if="!editing" class="ins-field">
          <label class="ins-label" for="em-name">Full name (optional)</label>
          <input id="em-name" v-model="form.name" class="ins-input" placeholder="As it appears on council records" />
        </div>

        <div class="ins-field">
          <label class="ins-label" for="em-post">Post</label>
          <input id="em-post" v-model="form.jobTitle" class="ins-input" placeholder="Planning Officer" />
        </div>

        <div class="ins-field">
          <label class="ins-label" for="em-dept">Department</label>
          <input id="em-dept" v-model="form.department" class="ins-input" />
        </div>

        <div class="ins-field full">
          <label class="ins-label" for="em-role">System role</label>
          <select id="em-role" v-model="form.role" class="ins-input">
            <option value="" disabled>Choose a role…</option>
            <option v-for="r in ASSIGNABLE" :key="r.id" :value="r.id">{{ r.label }}</option>
          </select>
          <p class="ins-hint">
            What the role can do is set out under Roles &amp; permissions. Citizen roles are
            issued by the system on self-registration and cannot be granted here.
          </p>
        </div>

        <p v-if="formError" class="em-error" role="alert">{{ formError }}</p>

        <div class="em-form-actions">
          <button type="button" class="em-btn" @click="formOpen = false">Cancel</button>
          <button type="submit" class="em-btn em-btn-primary" :disabled="saving">
            {{ saving ? 'Saving…' : editing ? 'Save the change' : 'Send the invitation' }}
          </button>
        </div>
      </form>
    </UiSheet>

    <!-- ── The invitation link ────────────────────────────────────────── -->
    <!-- Shown whether or not the email went out. The token is single-use and
         the server is its only source, so if the email failed this link is the
         ONLY way that officer gets an account. -->
    <UiSheet :open="inviteLink !== null" title="Invitation created"
             :subtitle="inviteEmail" width="32rem"
             @close="inviteLink = null" @update:open="inviteLink = $event ? inviteLink : null">
      <div class="em-invite">
        <p v-if="inviteEmailed" class="ins-banner t-positive">
          <CheckCircle2 :size="16" aria-hidden="true" />
          <span>The invitation has been emailed to {{ inviteEmail }}.</span>
        </p>
        <p v-else class="ins-banner t-warning">
          <AlertTriangle :size="16" aria-hidden="true" />
          <span>
            The email could not be queued. Send this link to {{ inviteEmail }} yourself —
            it is the only way they can create their account.
          </span>
        </p>

        <label class="ins-label" for="em-link">Invitation link</label>
        <div class="em-link-row">
          <input id="em-link" class="ins-input ins-mono" :value="inviteLink" readonly
                 @focus="($event.target as HTMLInputElement).select()" />
          <button type="button" class="em-btn" @click="copyInvite">
            <Copy :size="14" aria-hidden="true" /> {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </div>
        <p class="ins-hint">
          Single-use and time-limited. Anyone holding it can create this account, so send
          it the way you would send a password. Outstanding invitations are listed under
          Invitations, where one can be revoked.
        </p>
      </div>
    </UiSheet>

    <AdminConfirm
      v-if="confirmCopy"
      :open="pending !== null"
      :title="confirmCopy.title"
      :message="confirmCopy.message"
      :consequence="confirmCopy.consequence"
      :confirm-label="confirmCopy.confirmLabel"
      :destructive="confirmCopy.destructive"
      :busy="busy !== null"
      @confirm="runPending"
      @cancel="pending = null"
    />
  </div>
</template>

<style scoped>
.em-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r); cursor:pointer;
  transition:background-color var(--ent-dur) var(--ent-ease); }
.em-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.em-btn:disabled { opacity:0.55; cursor:not-allowed; }
.em-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.em-btn-primary { color:var(--ent-text-on-accent); background:var(--ent-accent); border-color:var(--ent-accent); }
.em-btn-primary:hover:not(:disabled) { background:var(--ent-accent-hover); }

.em-summary { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); }

.em-note { display:flex; align-items:center; gap:var(--ent-s2); margin:0;
  padding:var(--ent-s2) var(--ent-s3); font-size:var(--ent-fs-sm);
  color:var(--ent-success); background:var(--ent-success-soft);
  border:1px solid var(--ent-tone-positive-line); border-radius:var(--ent-r); }

.em-filters { display:flex; align-items:center; gap:var(--ent-s3); flex-wrap:wrap; }
.em-search { flex:1; min-width:16rem; }
.em-select { display:inline-flex; min-width:12rem; }
.em-select select { width:100%; }

.em-person { display:block; min-width:0; }
.em-person strong { display:block; font-weight:var(--ent-fw-medium); color:var(--ent-text);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.em-person small { display:block; font-size:var(--ent-fs-micro); color:var(--ent-text-3);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.em-menu-wrap { position:relative; display:inline-flex; }
.em-menu { position:absolute; right:0; top:calc(100% + 4px); z-index:var(--ent-z-popover);
  min-width:14rem; padding:var(--ent-s1); display:flex; flex-direction:column;
  background:var(--ent-surface); border:1px solid var(--ent-line-strong);
  border-radius:var(--ent-r-md); box-shadow:var(--ent-e3); }
.em-menu button { text-align:left; padding:var(--ent-s2) var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); color:var(--ent-text);
  background:none; border:0; border-radius:var(--ent-r-sm); cursor:pointer; white-space:nowrap; }
.em-menu button:hover { background:var(--ent-surface-2); }
.em-menu button:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.em-menu hr { margin:var(--ent-s1) 0; border:0; border-top:1px solid var(--ent-line); }
.em-menu-danger { color:var(--ent-danger) !important; }

.em-form-actions { grid-column:1 / -1; display:flex; justify-content:flex-end; gap:var(--ent-s2); }
.em-error { grid-column:1 / -1; margin:0; font-size:var(--ent-fs-sm); color:var(--ent-danger); }

.em-invite { display:flex; flex-direction:column; gap:var(--ent-s3); }
.em-link-row { display:flex; gap:var(--ent-s2); }
.em-link-row input { flex:1; min-width:0; }

@media (max-width: 767px) {
  .em-search { min-width:100%; }
  .em-menu { right:auto; left:0; }
}
</style>
