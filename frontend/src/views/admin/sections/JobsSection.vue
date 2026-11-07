<script setup lang="ts">
// Email & jobs — the council's outgoing message queue.
//
// THE QUESTION THIS ANSWERS
// "The applicant says they were never told." That is an IT support question,
// not a planning one, and until now there was nowhere to answer it: the
// outbox existed in the database and nothing rendered it. This screen is the
// answer — whether the message was composed, whether it was sent, when, and
// what the failure was if it was not.
//
// RETRY RESETS THE ATTEMPT COUNT
// A message that has exhausted its attempts fails again immediately if it is
// requeued with the count intact, which makes the button look broken. Retry
// gives it a fresh run, which is what "retry" means to the person pressing it.
//
// WHAT IS NOT HERE
// The message BODY. It carries an applicant's name, their case and sometimes
// their address, and an IT administrator does not need to read a citizen's
// correspondence to establish whether it was delivered. Subject, recipient and
// outcome answer the question; the content is the planning file's business.

import { computed, onMounted, ref, watch } from 'vue'
import { useAdminNav } from '@/admin/useAdminConsole'
import { useAdminOverview } from '@/admin/useAdminOverview'
import {
  listOutbox, retryMessage, cancelMessage, errorMessage,
  type OutboxMessage, type OutboxStatus, type OutboxDelivery,
} from '@/services/adminConsole'
import { asLabel, formatWhen, timeAgo } from '@/admin/console'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import {
  Search, RefreshCw, AlertTriangle, CheckCircle2, RotateCcw, Ban, MailX, Send,
} from 'lucide-vue-next'

const nav = useAdminNav()
const overview = useAdminOverview()

const messages = ref<OutboxMessage[]>([])
const counts = ref<Partial<Record<OutboxStatus, number>>>({})
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref<string | null>(null)

const status = computed(() => nav.param('status') as OutboxStatus | '')
const search = computed(() => nav.param('q'))

const STATUSES: Array<{ id: OutboxStatus | ''; label: string }> = [
  { id: '', label: 'All' },
  { id: 'failed', label: 'Failed' },
  { id: 'pending', label: 'Waiting' },
  { id: 'sent', label: 'Sent' },
  { id: 'cancelled', label: 'Cancelled' },
]

async function load() {
  loading.value = true
  error.value = null
  try {
    const result = await listOutbox({ status: status.value, q: search.value || undefined, limit: 100 })
    messages.value = result.data
    counts.value = result.meta.counts ?? {}
    delivery.value = result.meta.delivery ?? null
  } catch (err) {
    messages.value = []
    counts.value = {}
    delivery.value = null
    error.value = errorMessage(err, 'The message queue could not be read.')
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([status, search], load)

const columns = [
  { key: 'created_at', label: 'Queued', width: '9rem' },
  { key: 'email', label: 'To', width: '16rem' },
  { key: 'subject', label: 'Subject' },
  { key: 'channel', label: 'Channel', width: '7rem', hideOnMobile: true },
  { key: 'status', label: 'Outcome', width: '11rem' },
  { key: 'actions', label: '', width: '8rem', align: 'right' },
]

const tone: Record<OutboxStatus, 'positive' | 'info' | 'negative' | 'neutral'> = {
  sent: 'positive', pending: 'info', failed: 'negative', cancelled: 'neutral',
}

async function retry(m: OutboxMessage) {
  busy.value = m.id
  note.value = null
  try {
    await retryMessage(m.id)
    note.value = `Requeued the message to ${m.email ?? 'the recipient'}. It will be attempted again shortly.`
    await load()
    overview.invalidate()
  } catch (err) {
    error.value = errorMessage(err, 'The message could not be requeued.')
  } finally {
    busy.value = null
  }
}

async function cancel(m: OutboxMessage) {
  busy.value = m.id
  note.value = null
  try {
    await cancelMessage(m.id)
    note.value = `Cancelled the message to ${m.email ?? 'the recipient'}. It will not be sent.`
    await load()
    overview.invalidate()
  } catch (err) {
    error.value = errorMessage(err, 'The message could not be cancelled.')
  } finally {
    busy.value = null
  }
}

/** The failed messages, oldest first: the queue's backlog in the order it formed. */
const failing = computed(() => messages.value.filter(m => m.status === 'failed'))

/**
 * How this deployment actually delivers, reported by the server.
 *
 * THE DISTINCTION THIS SCREEN EXISTS TO DRAW
 * A worker does drain the queue. But on the `console` transport it advances a
 * row to `sent` after printing the message to the server log — nothing leaves
 * the building. "86 sent" is then true of the database and false of the
 * applicant's inbox, and an administrator answering "were they told?" would
 * give the wrong answer with complete confidence.
 *
 * So the banner reports the SERVER's state, not the council's intent: the
 * email_enabled setting is what the council asked for and lives on the
 * Settings screen, and reporting one as the other is the confusion the whole
 * enforced/record-only split exists to avoid.
 */
const delivery = ref<OutboxDelivery | null>(null)

const deliveryWarning = computed(() => {
  const d = delivery.value
  if (!d) return null
  if (!d.workerRunning) return {
    headline: 'No worker is running, so nothing in this queue is being sent.',
    detail: 'Messages are being composed and queued, and they will go out when a worker is started. Nothing is lost in the meantime.',
  }
  if (!d.delivers) return {
    headline: `Messages are not reaching anybody — this server is using the “${d.transport}” transport.`,
    detail: 'The worker prints each message to the server log and then marks it sent, so “sent” below means “logged”, not “delivered”. Configure SMTP before relying on any of this as proof an applicant was notified.',
  }
  return null
})

const emailHeld = computed(() =>
  overview.settings.value.find(s => s.key === 'notifications.email_enabled')?.value === 'false')
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">System &amp; operations</span>
        <h2 class="ins-title">Email &amp; jobs</h2>
        <p class="ins-lede">
          Every message the portal has queued to send, and what became of it. This is
          where “they say they were never told” is settled.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="jb-btn" :disabled="loading" @click="load">
          <RefreshCw :size="14" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
        </button>
      </div>
    </header>

    <!-- The state of the machinery, from the server. The single most important
         thing this screen can say, and it has to be said before an
         administrator reads "sent" as "delivered". -->
    <div v-if="deliveryWarning" class="ins-banner t-warning">
      <MailX :size="16" aria-hidden="true" />
      <div>
        <strong>{{ deliveryWarning.headline }}</strong>
        <p>{{ deliveryWarning.detail }}</p>
      </div>
    </div>

    <!-- The council's own choice, which is a different statement and belongs
         on a different line. Held, not lost. -->
    <div v-if="emailHeld" class="ins-banner t-info">
      <MailX :size="16" aria-hidden="true" />
      <div>
        <strong>Email sending is switched off.</strong>
        <p>Messages are still being queued and are being held as pending. They go out when it is switched back on.</p>
      </div>
      <button type="button" class="jb-btn" @click="nav.go('settings')">Open settings</button>
    </div>

    <p class="jb-summary">
      {{ counts.pending ?? 0 }} waiting · {{ counts.failed ?? 0 }} failed ·
      {{ (counts.sent ?? 0).toLocaleString() }} sent · {{ counts.cancelled ?? 0 }} cancelled.
    </p>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>{{ error }}</span>
      <button type="button" class="jb-btn" @click="load">Retry</button>
    </div>

    <p v-if="note" class="jb-note" role="status">
      <CheckCircle2 :size="15" aria-hidden="true" /> {{ note }}
    </p>

    <!-- The failures, with their reasons, above the full queue: an admin who
         opened this screen almost always opened it for these. -->
    <section v-if="failing.length && !status" class="ins-card jb-failures">
      <div class="ins-card-head">
        <h3><AlertTriangle :size="15" aria-hidden="true" /> Not delivered
          <span class="ins-count">{{ failing.length }}</span></h3>
        <button type="button" class="jb-btn jb-btn-sm" @click="nav.setParam('status', 'failed')">
          Show only these
        </button>
      </div>
      <div class="ins-card-body">
        <ul class="jb-fails">
          <li v-for="m in failing.slice(0, 5)" :key="m.id" class="jb-fail">
            <div class="jb-fail-text">
              <strong>{{ m.subject }}</strong>
              <small>{{ m.email ?? 'No address recorded' }} · {{ m.attempts }} attempt{{ m.attempts === 1 ? '' : 's' }}</small>
              <small v-if="m.last_error" class="jb-reason ins-mono">{{ m.last_error }}</small>
            </div>
            <button type="button" class="jb-btn jb-btn-sm" :disabled="busy === m.id" @click="retry(m)">
              <RotateCcw :size="13" aria-hidden="true" /> Retry
            </button>
          </li>
        </ul>
      </div>
    </section>

    <!-- ── The queue ──────────────────────────────────────────────────── -->
    <div class="jb-filters">
      <label class="ins-search jb-search">
        <Search :size="15" aria-hidden="true" />
        <span class="ent-sr-only">Search the queue</span>
        <input type="search" :value="search" placeholder="Recipient or subject"
               @input="nav.setParam('q', ($event.target as HTMLInputElement).value)" />
      </label>
      <div class="ins-seg" role="group" aria-label="Filter by outcome">
        <button v-for="s in STATUSES" :key="s.id" type="button"
                :aria-pressed="status === s.id"
                @click="nav.setParam('status', s.id || null)">{{ s.label }}</button>
      </div>
    </div>

    <section class="ins-card">
      <UiDataTable
        :columns="columns" :rows="messages" row-key="id" :loading="loading" dense
        :empty-message="status ? `No ${status} message.` : 'Nothing has been queued.'"
        mobile-primary="subject" mobile-secondary="email" mobile-status="status" mobile-actions="actions"
      >
        <template #cell-created_at="{ row }">
          <span :title="formatWhen(row.created_at)">{{ timeAgo(row.created_at) }}</span>
        </template>
        <template #cell-email="{ row }">
          <span class="jb-to">{{ row.email ?? '—' }}</span>
        </template>
        <template #cell-status="{ row }">
          <UiStatusBadge :tone="tone[row.status as OutboxStatus]"
                         :label="row.status === 'pending' ? 'Waiting' : asLabel(row.status)"
                         :title="row.last_error ?? undefined" />
          <small v-if="row.status === 'sent' && row.sent_at" class="jb-when">{{ timeAgo(row.sent_at) }}</small>
          <small v-else-if="row.attempts > 0" class="jb-when">{{ row.attempts }} attempt{{ row.attempts === 1 ? '' : 's' }}</small>
        </template>
        <template #cell-actions="{ row }">
          <button v-if="row.status === 'failed' || row.status === 'cancelled'"
                  type="button" class="jb-btn jb-btn-sm" :disabled="busy === row.id" @click="retry(row)">
            <RotateCcw :size="13" aria-hidden="true" /> Retry
          </button>
          <button v-else-if="row.status === 'pending'"
                  type="button" class="jb-btn jb-btn-sm" :disabled="busy === row.id" @click="cancel(row)">
            <Ban :size="13" aria-hidden="true" /> Cancel
          </button>
          <!-- A sent message has nothing to do to it. An action that would be
               refused is not offered. -->
          <span v-else class="jb-muted">—</span>
        </template>
      </UiDataTable>
      <div class="ins-card-foot jb-foot">
        <p class="ins-hint">
          <Send :size="13" aria-hidden="true" />
          Message contents are not shown here. Subject, recipient and outcome answer
          whether it was delivered; the correspondence itself belongs to the case file.
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.jb-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r); cursor:pointer; }
.jb-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.jb-btn:disabled { opacity:0.55; cursor:not-allowed; }
.jb-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.jb-btn-sm { min-height:var(--ent-control-h-sm); padding:0 var(--ent-s2);
  font-size:var(--ent-fs-xs); gap:var(--ent-s1); }

.jb-summary { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); }

.jb-note { display:flex; align-items:center; gap:var(--ent-s2); margin:0;
  padding:var(--ent-s2) var(--ent-s3); font-size:var(--ent-fs-sm);
  color:var(--ent-success); background:var(--ent-success-soft);
  border:1px solid var(--ent-tone-positive-line); border-radius:var(--ent-r); }

.jb-failures { border-color:var(--ent-tone-negative-line); }

.jb-fails { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s2); }
.jb-fail { display:flex; align-items:flex-start; gap:var(--ent-s3);
  padding:var(--ent-s3); background:var(--ent-tone-negative-bg);
  border:1px solid var(--ent-tone-negative-line); border-radius:var(--ent-r); }
.jb-fail-text { flex:1; min-width:0; }
.jb-fail-text strong { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.jb-fail-text small { display:block; margin-top:2px; font-size:var(--ent-fs-xs); color:var(--ent-text-2); }
.jb-reason { color:var(--ent-danger) !important; overflow-wrap:anywhere; }

.jb-filters { display:flex; align-items:center; gap:var(--ent-s3); flex-wrap:wrap; }
.jb-search { flex:1; min-width:16rem; }

.jb-to { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block; }
.jb-when { display:block; margin-top:2px; font-size:var(--ent-fs-micro); color:var(--ent-text-3); }
.jb-muted { color:var(--ent-text-3); }
.jb-foot { justify-content:flex-start; }
.jb-foot .ins-hint { display:flex; align-items:center; gap:var(--ent-s2); }

@media (max-width: 767px) { .jb-search { min-width:100%; } }
</style>
