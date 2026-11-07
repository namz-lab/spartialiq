<script setup lang="ts">
// Document verification queue.
//
// Second stage of the document workflow: the citizen uploads a document, an
// automatic check runs over it, and it arrives here for a council officer to
// confirm. Each row shows what the automatic check thought, why, how sure it
// was, and the fields it read — so the officer can make the decision quickly
// without being led by it.
//
// WHAT CHANGED, BESIDES THE STYLING
// A rejection needed no reason, and the note box was labelled "optional"
// while its own placeholder said the text is shown to the applicant. So the
// ordinary path was: reject with nothing, the citizen is told their document
// was rejected and not why, and they upload the same one again. A rejection
// now requires the reason, and the button says so until there is one. An
// approval still needs nothing, because "accepted" is a complete answer.
//
// THE AUTOMATIC CHECK IS A SUGGESTION AND READS LIKE ONE
// It is rendered as a recommendation with its confidence and its reason, not
// as a verdict with a pre-selected button. An officer who is shown "valid" on
// a green row beside a highlighted Approve button is being asked to agree,
// not to decide, and their signature is what the council relies on.

import { computed, onActivated, onMounted, ref } from 'vue'
import { documentsService, type DocumentQueueRow } from '@/services/documentsService'
import { formatWhen } from '@/planning-clerk/console'
import type { Tone } from '@/planning-clerk/registerSpec'
import UiButton from '@/components/ui/UiButton.vue'
import {
  ShieldCheck, ShieldAlert, ShieldQuestion, FileCheck2, FileX2,
  ExternalLink, RefreshCw, Inbox, AlertTriangle,
} from 'lucide-vue-next'

const rows = ref<DocumentQueueRow[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const busyId = ref<string | null>(null)
const notes = ref<Record<string, string>>({})

const DOC_KIND_LABELS: Record<string, string> = {
  national_id: 'National ID', passport: 'Passport', drivers_licence: 'Driver’s licence',
  proof_of_residence: 'Proof of residence', title_deed: 'Title deed',
  company_registration: 'Company registration', tax_clearance: 'Tax clearance',
  other: 'Other',
}

const AI_META: Record<string, { label: string; tone: Tone; icon: typeof ShieldCheck }> = {
  pass: { label: 'Automatic check: looks valid', tone: 'positive', icon: ShieldCheck },
  fail: { label: 'Automatic check: flagged', tone: 'negative', icon: ShieldAlert },
  uncertain: { label: 'Automatic check: needs a human', tone: 'warning', icon: ShieldQuestion },
}

function meta(row: DocumentQueueRow) {
  return AI_META[row.aiRecommendation ?? ''] ?? AI_META.uncertain
}

async function load() {
  loading.value = true
  error.value = null
  try {
    rows.value = await documentsService.queue()
  } catch (err: unknown) {
    const e = err as { response?: { status?: number } }
    error.value = e.response?.status === 403
      ? 'Your role may not review documents.'
      : 'Could not read the verification queue. Check the connection and try again.'
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
// A queue, so it is re-read on return rather than only on the session's
// first mount — sections are kept alive and onMounted fires once.
onActivated(() => { void load() })

/** A rejection the applicant cannot act on is a rejection that comes back. */
function canReject(row: DocumentQueueRow): boolean {
  return (notes.value[row.id]?.trim().length ?? 0) > 0
}

async function decide(row: DocumentQueueRow, decision: 'verified' | 'rejected') {
  if (decision === 'rejected' && !canReject(row)) return
  busyId.value = row.id
  error.value = null
  try {
    await documentsService.verify(row.id, decision, {
      notes: notes.value[row.id]?.trim() || undefined,
      // The fields the officer is confirming, persisted with the decision.
      extracted: {
        name: row.extractedName ?? undefined,
        idNumber: row.extractedIdNumber ?? undefined,
        dob: row.extractedDob ?? undefined,
      },
    })
    rows.value = rows.value.filter((r) => r.id !== row.id)
    delete notes.value[row.id]
  } catch {
    error.value = 'The decision was not saved. Nothing has changed — try again.'
  } finally {
    busyId.value = null
  }
}

function confidence(v: number | null): string {
  return v === null || v === undefined ? 'not stated' : `${Math.round(v * 100)}%`
}

const flagged = computed(() => rows.value.filter((r) => r.aiRecommendation === 'fail').length)
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Front counter</span>
        <h2 class="ins-title">Document verification</h2>
        <p class="ins-lede">
          Documents uploaded by applicants, with what the automatic check made
          of them. The recommendation is advice — the decision recorded here is
          the officer’s, and it is the one the council relies on.
        </p>
      </div>
      <div class="ins-actions">
        <UiButton size="sm" variant="ghost" :disabled="loading" @click="load">
          <template #icon><RefreshCw :size="14" :class="{ 'ins-spin': loading }" /></template>
          Refresh
        </UiButton>
      </div>
    </header>

    <p v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="15" aria-hidden="true" />
      <span>{{ error }}</span>
    </p>

    <p v-if="flagged" class="ins-banner t-warning" role="status">
      <ShieldAlert :size="15" aria-hidden="true" />
      <span>
        {{ flagged }} document{{ flagged === 1 ? ' has' : 's have' }} been flagged by
        the automatic check. Those are worth opening before deciding.
      </span>
    </p>

    <div v-if="loading && !rows.length" class="clk-dv-load" aria-busy="true">
      <span v-for="n in 3" :key="n" class="ins-skel" />
      <span class="ent-sr-only">Reading the verification queue</span>
    </div>

    <div v-else-if="!rows.length" class="clk-dv-empty">
      <Inbox :size="22" aria-hidden="true" />
      <p>Nothing is waiting. Every uploaded document has been reviewed.</p>
    </div>

    <ul v-else class="clk-dv-list">
      <li v-for="row in rows" :key="row.id" class="ins-card clk-dv-card">
        <header class="ins-card-head">
          <h3>
            {{ row.ownerName || 'Unknown applicant' }}
            <span v-if="row.ownerEmail" class="clk-dv-email">{{ row.ownerEmail }}</span>
          </h3>
          <span class="clk-dv-kind">{{ DOC_KIND_LABELS[row.docKind] || row.docKind }}</span>
          <span class="clk-dv-when">{{ formatWhen(row.createdAt) }}</span>
        </header>

        <div class="ins-card-body clk-dv-body">
          <!-- Advice, with its own uncertainty on the face of it. -->
          <p class="ins-banner" :class="`t-${meta(row).tone}`">
            <component :is="meta(row).icon" :size="15" aria-hidden="true" />
            <span>
              <strong>{{ row.aiRecommendation ? meta(row).label : 'No automatic assessment' }}</strong>
              <template v-if="row.aiRecommendation">
                · confidence {{ confidence(row.verifierConfidence) }}
              </template>
              <template v-if="row.aiReason"> — {{ row.aiReason }}</template>
              <template v-if="!row.aiRecommendation"> — review it manually.</template>
            </span>
          </p>

          <dl class="ins-dl">
            <div><dt>Name read</dt><dd>{{ row.extractedName || '—' }}</dd></div>
            <div><dt>Identity number read</dt><dd class="ins-mono">{{ row.extractedIdNumber || '—' }}</dd></div>
            <div><dt>Date of birth read</dt><dd>{{ row.extractedDob || '—' }}</dd></div>
          </dl>

          <a class="clk-dv-open" :href="row.storageUrl" target="_blank" rel="noopener noreferrer">
            <ExternalLink :size="14" aria-hidden="true" />
            Open the document
          </a>

          <div class="ins-field">
            <label class="ins-label" :for="`clk-dv-note-${row.id}`">
              Reason, shown to the applicant
            </label>
            <textarea :id="`clk-dv-note-${row.id}`" v-model="notes[row.id]"
                      class="ins-input" rows="2"
                      placeholder="What is wrong with it, and what they should send instead" />
            <p class="ins-hint">
              Required to reject — a rejection with no reason means the same
              document is uploaded again. Not needed to accept.
            </p>
          </div>
        </div>

        <footer class="ins-card-foot">
          <UiButton variant="danger" :disabled="busyId === row.id || !canReject(row)"
                    :loading="busyId === row.id"
                    :title="canReject(row) ? undefined : 'Give the applicant a reason first'"
                    @click="decide(row, 'rejected')">
            <template #icon><FileX2 :size="14" /></template>
            {{ canReject(row) ? 'Reject' : 'Reject — reason needed' }}
          </UiButton>
          <UiButton variant="primary" :disabled="busyId === row.id"
                    :loading="busyId === row.id" @click="decide(row, 'verified')">
            <template #icon><FileCheck2 :size="14" /></template>
            Accept
          </UiButton>
        </footer>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.clk-dv-load { display:flex; flex-direction:column; gap:var(--ent-s3); }
.clk-dv-load .ins-skel { height:60px; }

.clk-dv-list { list-style:none; margin:0; padding:0; display:flex;
  flex-direction:column; gap:var(--ent-s4); }
.clk-dv-card { min-width:0; }
.clk-dv-body { display:flex; flex-direction:column; gap:var(--ent-s4); }

.clk-dv-email { font-weight:var(--ent-fw-normal); font-size:var(--ent-fs-xs);
  color:var(--ent-text-3); margin-left:var(--ent-s2); }
.clk-dv-kind { padding:1px var(--ent-s2); border-radius:var(--ent-r-pill);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  color:var(--ent-tone-info-fg); background:var(--ent-tone-info-bg);
  border:1px solid var(--ent-tone-info-line); white-space:nowrap; }
.clk-dv-when { font-size:var(--ent-fs-micro); color:var(--ent-text-3); white-space:nowrap; }

.clk-dv-open { display:inline-flex; align-items:center; gap:var(--ent-s2);
  align-self:flex-start; min-height:var(--ent-control-h-sm);
  font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold);
  color:var(--ent-accent); text-decoration:none; }
.clk-dv-open:hover { text-decoration:underline; }
.clk-dv-open:focus-visible { outline:none; box-shadow:var(--ent-focus-ring);
  border-radius:var(--ent-r-sm); }

.clk-dv-empty { display:flex; flex-direction:column; align-items:center;
  gap:var(--ent-s3); padding:var(--ent-s8) var(--ent-s4); text-align:center;
  color:var(--ent-text-3); }
.clk-dv-empty p { margin:0; font-size:var(--ent-fs-sm); max-width:40ch;
  line-height:var(--ent-lh); }
</style>
