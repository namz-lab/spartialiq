<script setup lang="ts">
// Per-case audit trail — "who did what, when, why" (requirement #13).
// Reads the append-only spatial_planning.permit_event log via the backend
// (migration 082) and renders it with explicit loading / empty / error /
// unavailable states (requirement #11). Read-only.
import { ref, watch } from 'vue'
import { dmApi, type PermitEvent } from '@/services/developmentManagementService'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { RefreshCw, History, AlertTriangle } from 'lucide-vue-next'

const props = defineProps<{ permitId: string | null }>()

const events  = ref<PermitEvent[]>([])
const loading = ref(false)
const error   = ref('')

const EVENT_LABELS: Record<string, string> = {
  status_changed:    'Status changed',
  case_updated:      'Case file updated',
  referral_created:  'Referral circulated',
  referral_response: 'Referral response received',
}
function labelFor(t: string): string {
  return EVENT_LABELS[t] ?? t.replace(/_/g, ' ')
}

// A short, human summary of the event detail (never raw PII values).
function summaryFor(e: PermitEvent): string {
  const d = e.detail ?? {}
  if (e.event_type === 'status_changed') {
    const status = typeof d.status === 'string' ? d.status.replace(/_/g, ' ') : ''
    return d.has_conditions ? `${status} · with conditions` : status
  }
  if (e.event_type === 'case_updated' && Array.isArray(d.fields)) {
    return `Updated: ${(d.fields as string[]).join(', ')}`
  }
  if (e.event_type === 'referral_created') {
    return typeof d.body_name === 'string' ? `To ${d.body_name}` : ''
  }
  if (e.event_type === 'referral_response') {
    const who = typeof d.body_name === 'string' ? d.body_name : 'Specialist'
    const st  = typeof d.response_status === 'string' ? d.response_status.replace(/_/g, ' ') : ''
    return `${who}: ${st}`
  }
  return ''
}

function actorLabel(e: PermitEvent): string {
  return e.actor_name || e.actor_role || 'System'
}
// Date and time are split so the trail scans as a register column, not prose.
function dateOf(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function timeOf(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

async function load() {
  if (!props.permitId) { events.value = []; return }
  loading.value = true
  error.value = ''
  try {
    events.value = await dmApi.listEvents(props.permitId)
  } catch {
    error.value = 'Audit history could not be loaded.'
  } finally {
    loading.value = false
  }
}

watch(() => props.permitId, load, { immediate: true })
</script>

<template>
  <UiPanel
    class="cat"
    title="Case audit trail"
    subtitle="Append-only record of actions, changes and referrals"
  >
    <template #icon><History :size="15" /></template>
    <template #actions>
      <UiButton
        v-if="permitId" variant="ghost" size="sm"
        :disabled="loading" aria-label="Refresh audit trail" title="Refresh"
        @click="load"
      >
        <template #icon><RefreshCw :size="13" :class="{ spin: loading }" /></template>
      </UiButton>
    </template>

    <!-- Unavailable: no permit id yet (unsaved case) -->
    <p v-if="!permitId" class="cat-muted">
      Register the application first — the audit trail starts once the case is saved.
    </p>

    <!-- Loading: skeleton rows, same geometry as real rows so nothing jumps -->
    <ol v-else-if="loading && !events.length" class="cat-list is-skeleton" aria-busy="true" aria-label="Loading audit trail">
      <li v-for="n in 3" :key="n" class="cat-item">
        <span class="cat-dot" aria-hidden="true" />
        <div class="cat-body">
          <span class="cat-sk cat-sk-a" />
          <span class="cat-sk cat-sk-b" />
        </div>
      </li>
    </ol>

    <!-- Error -->
    <div v-else-if="error" class="cat-error" role="alert">
      <AlertTriangle :size="14" aria-hidden="true" />
      <span>{{ error }}</span>
      <UiButton variant="secondary" size="sm" @click="load">Retry</UiButton>
    </div>

    <!-- Empty -->
    <p v-else-if="!events.length" class="cat-muted">No recorded case activity.</p>

    <!-- Trail -->
    <ol v-else class="cat-list">
      <li v-for="e in events" :key="e.id" class="cat-item" :class="`ev-${e.event_type}`">
        <span class="cat-dot" aria-hidden="true" />
        <div class="cat-body">
          <div class="cat-line">
            <span class="cat-type">{{ labelFor(e.event_type) }}</span>
            <time class="cat-stamp" :datetime="e.created_at">
              {{ dateOf(e.created_at) }}<span class="cat-sep">·</span>{{ timeOf(e.created_at) }}
            </time>
          </div>
          <p v-if="summaryFor(e)" class="cat-summary">{{ summaryFor(e) }}</p>
          <div class="cat-meta">
            <span class="cat-actor">{{ actorLabel(e) }}</span>
            <span v-if="e.actor_role" class="cat-role">{{ e.actor_role }}</span>
          </div>
        </div>
      </li>
    </ol>
  </UiPanel>
</template>

<style scoped>
.spin { animation: cat-spin 1s linear infinite; }
@keyframes cat-spin { to { transform: rotate(360deg); } }

.cat-muted { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }

.cat-error {
  display: flex; align-items: center; gap: var(--ent-s2);
  padding: var(--ent-s3); border-radius: var(--ent-r-sm);
  background: var(--ent-tone-negative-bg); border: 1px solid var(--ent-tone-negative-line);
  font-size: var(--ent-fs-sm); color: var(--ent-danger);
}
.cat-error > :last-child { margin-left: auto; }

/* ── Vertical timeline ──────────────────────────────────────────────────── */
.cat-list { list-style: none; margin: 0; padding: 0 0 0 20px; position: relative; }
.cat-list::before {
  content: ''; position: absolute; left: 4px; top: 12px; bottom: 12px;
  width: 1px; background: var(--ent-line-strong);
}
.cat-item { position: relative; padding: var(--ent-s2) 0; border-bottom: 1px solid var(--ent-line); }
.cat-item:last-child { border-bottom: none; padding-bottom: 0; }
.cat-item:first-child { padding-top: 0; }

.cat-dot {
  position: absolute; left: -20px; top: 13px;
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--ent-text-3);
  box-shadow: 0 0 0 3px var(--ent-surface);
}
.cat-item:first-child .cat-dot { top: 5px; }
/* Semantic indicator only — the event type is always present as text. */
.ev-status_changed    .cat-dot { background: var(--ent-accent); }
.ev-case_updated      .cat-dot { background: var(--ent-text-3); }
.ev-referral_created  .cat-dot { background: var(--ent-warning); }
.ev-referral_response .cat-dot { background: var(--ent-success); }

.cat-body { min-width: 0; }
.cat-line { display: flex; align-items: baseline; gap: var(--ent-s3); }
.cat-type {
  font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold);
  color: var(--ent-text); line-height: var(--ent-lh-tight);
}
.cat-stamp {
  margin-left: auto; flex-shrink: 0;
  font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums;
  font-size: var(--ent-fs-micro); color: var(--ent-text-3); white-space: nowrap;
}
.cat-sep { padding: 0 var(--ent-s1); }

.cat-summary {
  margin: 2px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2);
  line-height: var(--ent-lh); overflow-wrap: anywhere;
}

.cat-meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ent-s2); margin-top: var(--ent-s1); }
.cat-actor { font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); color: var(--ent-text-2); }
.cat-role {
  font-size: var(--ent-fs-micro); color: var(--ent-tone-neutral-fg);
  background: var(--ent-tone-neutral-bg); border: 1px solid var(--ent-tone-neutral-line);
  border-radius: var(--ent-r-sm); padding: 0 var(--ent-s1); text-transform: capitalize;
}

/* ── Skeleton (reserves the same height as a real row) ──────────────────── */
.is-skeleton .cat-dot { background: var(--ent-line-strong); }
.cat-sk { display: block; height: 10px; border-radius: var(--ent-r-sm); background: var(--ent-surface-sunken); }
.cat-sk-a { width: 45%; }
.cat-sk-b { width: 28%; margin-top: var(--ent-s2); height: 9px; }
.is-skeleton .cat-item { animation: cat-pulse 1.4s ease-in-out infinite; }
.is-skeleton .cat-item:nth-child(2) { animation-delay: 0.12s; }
.is-skeleton .cat-item:nth-child(3) { animation-delay: 0.24s; }
@keyframes cat-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }

@media (max-width: 720px) {
  .cat-line { flex-wrap: wrap; gap: var(--ent-s1); }
  .cat-stamp { margin-left: 0; flex-basis: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .spin, .is-skeleton .cat-item { animation: none; }
}
</style>
