<script setup lang="ts">
// Sign-in security — failed attempts, lockouts in force, and the blocklist.
//
// THREE THINGS ON ONE SCREEN, ON PURPOSE
// They are one investigation. "Nobody can sign in" is answered by the lockout
// list; "why" is answered by the attempt log immediately below it; "make it
// stop" is the blocklist. Splitting them into three sections would mean
// walking the rail twice in the middle of an incident.
//
// WHAT THE LOCKOUT IS AND IS NOT
// Per email address, counting consecutive failures since that address last
// signed in successfully — so a correct sign-in clears the count and there is
// no counter for anyone to forget to reset. It is deliberately NOT per IP: a
// council office behind one NAT address would otherwise lock out the whole
// planning department when one officer mistypes. The blocklist is the
// per-address tool, and it is manual for the same reason.
//
// LIFTING A LOCKOUT DOES NOT ERASE ANYTHING
// It records a synthetic success, which both clears the count and leaves the
// failures in place as evidence. The copy below says so, because an admin who
// believes they are deleting an incident will use the button differently from
// one who knows they are annotating it.

import { computed, onMounted, ref, watch } from 'vue'
import { useAdminNav, useAdminPreferences } from '@/admin/useAdminConsole'
import {
  listLoginAttempts, clearLockout, listIpBlocks, createIpBlock, releaseIpBlock,
  errorMessage,
  type LoginAttempt, type LockedOut, type IpBlock, type LoginFailureReason,
} from '@/services/adminConsole'
import { daysAgoIso, describeAgent, formatWhen, timeAgo } from '@/admin/console'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import {
  Search, AlertTriangle, LockKeyhole, Ban, RefreshCw, ShieldCheck, Plus, CheckCircle2,
} from 'lucide-vue-next'

const nav = useAdminNav()
const { prefs } = useAdminPreferences()

const attempts = ref<LoginAttempt[]>([])
const lockedOut = ref<LockedOut[]>([])
const blocks = ref<IpBlock[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const busy = ref<string | null>(null)
const note = ref<string | null>(null)

// ?status=failures is what the Overview tile links to, so the screen it opens
// is already showing the rows the tile counted.
const failuresOnly = computed(() => nav.param('status') === 'failures')
const emailFilter = computed(() => nav.param('q'))
const windowDays = computed(() => prefs.value.auditWindowDays)

/**
 * Why each attempt failed, in words an admin can act on.
 *
 * `no_such_user` and `bad_password` are deliberately distinguished HERE and
 * deliberately NOT distinguished to the person signing in — the login route
 * returns one message for both, so the form cannot be used to discover which
 * addresses exist. This screen is behind the admin gate, where the difference
 * is the whole diagnosis.
 */
const REASONS: Record<LoginFailureReason, { label: string; help: string }> = {
  no_such_user: { label: 'No such account', help: 'The address has no account. Often a typo; in a run, someone guessing addresses.' },
  bad_password: { label: 'Wrong password', help: 'The account exists and the password did not match.' },
  suspended:    { label: 'Suspended', help: 'The account is suspended. Restore it from Employee accounts.' },
  deleted:      { label: 'Deleted', help: 'The account has been removed.' },
  locked_out:   { label: 'Locked out', help: 'Refused before the password was read, because the lockout was already in force.' },
  mfa_failed:   { label: 'Second factor failed', help: 'The password was right and the authenticator code was not.' },
  ip_blocked:   { label: 'Network blocked', help: 'Refused at the door because the address is on the blocklist.' },
}

const attemptColumns = [
  { key: 'attempted_at', label: 'When', width: '10rem' },
  { key: 'email', label: 'Address', width: '16rem' },
  { key: 'succeeded', label: 'Result', width: '10rem' },
  { key: 'ip', label: 'From', width: '10rem', mono: true },
  { key: 'user_agent', label: 'Device', hideOnMobile: true },
]

const blockColumns = [
  { key: 'cidr', label: 'Address or range', width: '12rem', mono: true },
  { key: 'reason', label: 'Reason' },
  { key: 'expires_at', label: 'Expires', width: '10rem' },
  { key: 'created_at', label: 'Blocked', width: '9rem', hideOnMobile: true },
  { key: 'actions', label: '', width: '7rem', align: 'right' },
]

async function load() {
  loading.value = true
  error.value = null
  try {
    const [log, blockList] = await Promise.all([
      listLoginAttempts({
        failuresOnly: failuresOnly.value,
        email: emailFilter.value || undefined,
        from: daysAgoIso(windowDays.value),
        limit: 150,
      }),
      listIpBlocks(),
    ])
    attempts.value = log.data
    lockedOut.value = log.meta.lockedOut ?? []
    blocks.value = blockList
  } catch (err) {
    attempts.value = []
    lockedOut.value = []
    blocks.value = []
    error.value = errorMessage(err, 'The sign-in record could not be read.')
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([failuresOnly, emailFilter, windowDays], load)

async function lift(email: string) {
  busy.value = email
  note.value = null
  try {
    await clearLockout(email)
    note.value = `${email} can sign in again. The failed attempts stay in the log.`
    await load()
  } catch (err) {
    error.value = errorMessage(err, 'The lockout could not be lifted.')
  } finally {
    busy.value = null
  }
}

// ── Blocking an address ─────────────────────────────────────────────────
const blockOpen = ref(false)
const draft = ref({ cidr: '', reason: '', expiresAt: '' })
const blockError = ref<string | null>(null)
const saving = ref(false)

function openBlock(prefill = '') {
  draft.value = { cidr: prefill, reason: '', expiresAt: '' }
  blockError.value = null
  blockOpen.value = true
}

async function saveBlock() {
  if (!draft.value.cidr.trim() || !draft.value.reason.trim()) {
    blockError.value = 'An address and a reason are both required. The reason is what the next administrator reads.'
    return
  }
  saving.value = true
  blockError.value = null
  try {
    await createIpBlock({
      cidr: draft.value.cidr.trim(),
      reason: draft.value.reason.trim(),
      expiresAt: draft.value.expiresAt || null,
    })
    blockOpen.value = false
    note.value = `${draft.value.cidr.trim()} is blocked. Sign-in from it is now refused before the password is read.`
    await load()
  } catch (err) {
    blockError.value = errorMessage(err, 'The block could not be created.')
  } finally {
    saving.value = false
  }
}

async function release(block: IpBlock) {
  busy.value = block.id
  try {
    await releaseIpBlock(block.id)
    note.value = `${block.cidr} is no longer blocked.`
    await load()
  } catch (err) {
    error.value = errorMessage(err, 'The block could not be released.')
  } finally {
    busy.value = null
  }
}

const failureCount = computed(() => attempts.value.filter(a => !a.succeeded).length)
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Security &amp; audit</span>
        <h2 class="ins-title">Sign-in security</h2>
        <p class="ins-lede">
          Who has tried to sign in, which addresses are locked out, and which networks
          are refused at the door. The three answer one question between them.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="si-btn" @click="openBlock()">
          <Plus :size="14" aria-hidden="true" /> Block a network
        </button>
        <button type="button" class="si-btn" :disabled="loading" @click="load">
          <RefreshCw :size="14" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
        </button>
      </div>
    </header>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <div>
        <strong>{{ error }}</strong>
        <p>Nothing below has been checked. An empty list is not a clean result until this is resolved.</p>
      </div>
      <button type="button" class="si-btn" @click="load">Retry</button>
    </div>

    <p v-if="note" class="si-note" role="status">
      <CheckCircle2 :size="15" aria-hidden="true" /> {{ note }}
    </p>

    <!-- ── Lockouts in force ──────────────────────────────────────────── -->
    <section class="ins-card">
      <div class="ins-card-head">
        <h3><LockKeyhole :size="15" aria-hidden="true" /> Locked out
          <span class="ins-count">{{ lockedOut.length }}</span></h3>
      </div>
      <div class="ins-card-body">
        <p v-if="!lockedOut.length && !loading" class="si-clear">
          <ShieldCheck :size="15" aria-hidden="true" />
          No address is locked out. Officers can sign in normally.
        </p>
        <ul v-else class="si-locks">
          <li v-for="l in lockedOut" :key="l.email" class="si-lock">
            <div class="si-lock-text">
              <strong>{{ l.email }}</strong>
              <small>
                {{ l.failures }} consecutive failure{{ l.failures === 1 ? '' : 's' }},
                most recent {{ timeAgo(l.last_failure) }}
              </small>
            </div>
            <button type="button" class="si-btn" :disabled="busy === l.email" @click="lift(l.email)">
              {{ busy === l.email ? 'Lifting…' : 'Lift the lockout' }}
            </button>
          </li>
        </ul>
        <p v-if="lockedOut.length" class="ins-hint si-lock-hint">
          Lifting records a successful sign-in against the address, which is what clears
          the count. The failed attempts stay in the log below — nothing is erased.
        </p>
      </div>
    </section>

    <!-- ── The attempt log ────────────────────────────────────────────── -->
    <section class="ins-card">
      <div class="ins-card-head">
        <h3>Sign-in attempts
          <span class="ins-count">
            {{ attempts.length }} in {{ windowDays }} day{{ windowDays === 1 ? '' : 's' }},
            {{ failureCount }} failed
          </span>
        </h3>
      </div>

      <div class="si-filters">
        <label class="ins-search si-search">
          <Search :size="15" aria-hidden="true" />
          <span class="ent-sr-only">Filter by email address</span>
          <input type="search" :value="emailFilter" placeholder="Email address"
                 @input="nav.setParam('q', ($event.target as HTMLInputElement).value)" />
        </label>
        <div class="ins-seg" role="group" aria-label="Which attempts to show">
          <button type="button" :aria-pressed="!failuresOnly" @click="nav.setParam('status', null)">
            All attempts
          </button>
          <button type="button" :aria-pressed="failuresOnly" @click="nav.setParam('status', 'failures')">
            Failures only
          </button>
        </div>
      </div>

      <UiDataTable
        :columns="attemptColumns" :rows="attempts" row-key="id" :loading="loading" dense
        :empty-message="failuresOnly
          ? `No failed sign-in in the last ${windowDays} days.`
          : `No sign-in recorded in the last ${windowDays} days.`"
        mobile-primary="email" mobile-secondary="ip" mobile-status="succeeded"
      >
        <template #cell-attempted_at="{ row }">
          <span :title="formatWhen(row.attempted_at)">{{ timeAgo(row.attempted_at) }}</span>
        </template>
        <template #cell-email="{ row }">
          <span class="si-who">
            <strong>{{ row.email }}</strong>
            <small v-if="row.name">{{ row.name }} · {{ row.role }}</small>
            <small v-else>No account</small>
          </span>
        </template>
        <template #cell-succeeded="{ row }">
          <UiStatusBadge v-if="row.succeeded" tone="positive" label="Signed in" />
          <UiStatusBadge
            v-else
            tone="negative"
            :label="row.reason ? REASONS[row.reason as LoginFailureReason].label : 'Failed'"
            :title="row.reason ? REASONS[row.reason as LoginFailureReason].help : undefined"
          />
        </template>
        <template #cell-user_agent="{ row }">
          <span :title="row.user_agent ?? ''">{{ describeAgent(row.user_agent) }}</span>
        </template>
      </UiDataTable>
    </section>

    <!-- ── Blocklist ──────────────────────────────────────────────────── -->
    <section class="ins-card">
      <div class="ins-card-head">
        <h3><Ban :size="15" aria-hidden="true" /> Blocked networks
          <span class="ins-count">{{ blocks.length }}</span></h3>
      </div>
      <UiDataTable
        :columns="blockColumns" :rows="blocks" row-key="id" :loading="loading" dense
        empty-message="No network is blocked."
        mobile-primary="cidr" mobile-secondary="reason" mobile-actions="actions"
      >
        <template #cell-expires_at="{ row }">
          <span v-if="row.expires_at" :title="formatWhen(row.expires_at)">{{ timeAgo(row.expires_at) }}</span>
          <span v-else class="si-permanent">Permanent</span>
        </template>
        <template #cell-created_at="{ row }">
          <span :title="`${formatWhen(row.created_at)} by ${row.created_by_name ?? 'unknown'}`">
            {{ timeAgo(row.created_at) }}
          </span>
        </template>
        <template #cell-actions="{ row }">
          <button type="button" class="si-btn si-btn-sm" :disabled="busy === row.id" @click="release(row)">
            {{ busy === row.id ? 'Releasing…' : 'Release' }}
          </button>
        </template>
      </UiDataTable>
      <div class="ins-card-foot si-foot">
        <p class="ins-hint">
          A block refuses sign-in from the address before the password is read. Blocking
          is manual on purpose: automatic banning in front of a shared municipal
          connection locks out the council, not the attacker.
        </p>
      </div>
    </section>

    <!-- ── Block form ─────────────────────────────────────────────────── -->
    <UiSheet :open="blockOpen" title="Block a network"
             subtitle="Sign-in from this address will be refused" width="30rem"
             @close="blockOpen = false" @update:open="blockOpen = $event">
      <form class="si-form" @submit.prevent="saveBlock">
        <div class="ins-field full">
          <label class="ins-label" for="si-cidr">Address or range</label>
          <input id="si-cidr" v-model="draft.cidr" class="ins-input"
                 placeholder="198.51.100.4 or 198.51.100.0/24" autocomplete="off" />
          <p class="ins-hint">
            A single address, or a range in CIDR notation. A range blocks every address
            inside it, so check it before entering one — a /16 is 65,536 addresses.
          </p>
        </div>

        <div class="ins-field full">
          <label class="ins-label" for="si-reason">Reason</label>
          <textarea id="si-reason" v-model="draft.reason" class="ins-input" rows="3"
                    placeholder="What happened, and when"></textarea>
          <p class="ins-hint">Required. This is what the next administrator reads when deciding whether to lift it.</p>
        </div>

        <div class="ins-field full">
          <label class="ins-label" for="si-expires">Expires (optional)</label>
          <input id="si-expires" v-model="draft.expiresAt" type="datetime-local" class="ins-input" />
          <p class="ins-hint">Leave empty for a permanent block. A dated block lifts itself.</p>
        </div>

        <p v-if="blockError" class="si-error" role="alert">{{ blockError }}</p>

        <div class="si-form-actions">
          <button type="button" class="si-btn" @click="blockOpen = false">Cancel</button>
          <button type="submit" class="si-btn si-btn-primary" :disabled="saving">
            {{ saving ? 'Blocking…' : 'Block this network' }}
          </button>
        </div>
      </form>
    </UiSheet>
  </div>
</template>

<style scoped>
.si-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r); cursor:pointer;
  transition:background-color var(--ent-dur) var(--ent-ease); }
.si-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.si-btn:disabled { opacity:0.55; cursor:not-allowed; }
.si-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.si-btn-sm { min-height:var(--ent-control-h-sm); padding:0 var(--ent-s2); font-size:var(--ent-fs-xs); }
.si-btn-primary { color:var(--ent-text-on-accent); background:var(--ent-accent); border-color:var(--ent-accent); }
.si-btn-primary:hover:not(:disabled) { background:var(--ent-accent-hover); }

.si-note { display:flex; align-items:center; gap:var(--ent-s2); margin:0;
  padding:var(--ent-s2) var(--ent-s3); font-size:var(--ent-fs-sm);
  color:var(--ent-success); background:var(--ent-success-soft);
  border:1px solid var(--ent-tone-positive-line); border-radius:var(--ent-r); }

.si-clear { display:flex; align-items:center; gap:var(--ent-s2); margin:0;
  font-size:var(--ent-fs-sm); color:var(--ent-success); }

.si-locks { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s2); }
.si-lock { display:flex; align-items:center; gap:var(--ent-s3);
  padding:var(--ent-s3); background:var(--ent-tone-warning-bg);
  border:1px solid var(--ent-tone-warning-line); border-radius:var(--ent-r); }
.si-lock-text { flex:1; min-width:0; }
.si-lock-text strong { display:block; font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold);
  color:var(--ent-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.si-lock-text small { display:block; margin-top:2px; font-size:var(--ent-fs-xs); color:var(--ent-text-2); }
.si-lock-hint { margin-top:var(--ent-s3); }

.si-filters { display:flex; align-items:center; gap:var(--ent-s3); flex-wrap:wrap;
  padding:var(--ent-s3) var(--ent-s4); border-bottom:1px solid var(--ent-line); }
.si-search { flex:1; min-width:14rem; }

.si-who { display:block; min-width:0; }
.si-who strong { display:block; font-weight:var(--ent-fw-medium); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.si-who small { display:block; font-size:var(--ent-fs-micro); color:var(--ent-text-3); }

.si-permanent { color:var(--ent-text-3); }
.si-foot { justify-content:flex-start; }

.si-form { display:flex; flex-direction:column; gap:var(--ent-s4); }
.si-form-actions { display:flex; justify-content:flex-end; gap:var(--ent-s2); }
.si-error { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-danger); }

@media (max-width: 767px) {
  .si-lock { flex-wrap:wrap; }
  .si-search { min-width:100%; }
}
</style>
