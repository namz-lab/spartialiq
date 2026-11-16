<script setup lang="ts">
// Decision-readiness panel.
//
// The screen this replaces disabled the issue button with no explanation, so a
// blocked officer had no way to learn WHICH record was incomplete. Every
// requirement here states its own detail, whether it passes or not.
//
// Accessibility: status is carried by an icon, a text label AND the row's
// accessible name — never by colour alone (WCAG 2.2 AA, 1.4.1 Use of Colour).

import { computed } from 'vue'
import {
  CheckCircle2, AlertTriangle, CircleHelp, MinusCircle, ShieldCheck, RefreshCw,
} from 'lucide-vue-next'
import type { ReadinessRequirement, RequirementStatus } from './usePermitIssuance'

const props = defineProps<{
  requirements: ReadinessRequirement[]
  loading: boolean
  /** The permit is issued: the list is the record of what stood at the time, not a block. */
  issued?: boolean
}>()

defineEmits<{ (e: 'refresh'): void }>()

const META: Record<RequirementStatus, { label: string; icon: unknown; cls: string }> = {
  complete:       { label: 'Complete',       icon: CheckCircle2,  cls: 'ok' },
  outstanding:    { label: 'Outstanding',    icon: AlertTriangle, cls: 'bad' },
  not_applicable: { label: 'Not applicable', icon: MinusCircle,   cls: 'na' },
  unknown:        { label: 'Not verified',   icon: CircleHelp,    cls: 'unknown' },
}

const outstanding = computed(() => props.requirements.filter(r => r.status === 'outstanding'))
const unverified  = computed(() => props.requirements.filter(r => r.status === 'unknown'))

const summary = computed(() => {
  if (props.loading) return { tone: 'busy', text: 'Checking decision readiness…' }
  if (props.issued) return { tone: 'ok', text: 'Decided: this is the record as it stood' }
  if (outstanding.value.length) {
    return {
      tone: 'bad',
      text: `Blocked — ${outstanding.value.length} requirement`
        + `${outstanding.value.length === 1 ? '' : 's'} outstanding`,
    }
  }
  if (unverified.value.length) {
    return {
      tone: 'warn',
      text: `${unverified.value.length} requirement`
        + `${unverified.value.length === 1 ? '' : 's'} could not be verified`,
    }
  }
  return { tone: 'ok', text: 'Ready for decision' }
})
</script>

<template>
  <section class="rp" aria-labelledby="rp-heading">
    <header class="rp-head">
      <h3 id="rp-heading">Decision readiness</h3>
      <p class="rp-summary" :class="summary.tone" role="status">{{ summary.text }}</p>
      <button type="button" class="rp-refresh" :disabled="loading" @click="$emit('refresh')">
        <RefreshCw :size="12" :class="{ spin: loading }" aria-hidden="true" />
        <span>Re-check</span>
      </button>
    </header>

    <table class="rp-table">
      <caption class="sr-only">
        Statutory requirements for issuing this permit, and whether each is complete.
      </caption>
      <thead>
        <tr>
          <th scope="col">Requirement</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in requirements" :key="r.id" :class="META[r.status].cls">
          <th scope="row">
            <span class="rp-label">
              {{ r.label }}
              <span v-if="r.serverEnforced" class="rp-enforced">
                <ShieldCheck :size="11" aria-hidden="true" />
                <span class="sr-only">Independently enforced by the server.</span>
                <span aria-hidden="true">enforced</span>
              </span>
            </span>
            <span class="rp-detail">{{ r.detail }}</span>
          </th>
          <td>
            <span class="rp-status" :class="META[r.status].cls">
              <component :is="META[r.status].icon" :size="13" aria-hidden="true" />
              {{ META[r.status].label }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>

    <details class="rp-legend">
      <summary>What these words mean</summary>
      <dl>
        <dt>Complete</dt><dd>The council's record shows it is done.</dd>
        <dt>Outstanding</dt><dd>It is not done, and it stands in the way.</dd>
        <dt>Not verified</dt><dd>The record needed to tell could not be read, so nothing is known. It is not evidence that the step was done, and it also stands in the way.</dd>
        <dt>Not applicable</dt><dd>It does not apply to this case, for example no objections were lodged.</dd>
        <dt>enforced</dt><dd>The server re-checks it when the decision is made. The unmarked rows are shown to help you.</dd>
      </dl>
    </details>
  </section>
</template>

<style scoped>
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px;
  overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }

.rp { border:1px solid var(--sw-border-soft); border-radius:var(--sw-radius);
  background:var(--sw-surface); box-shadow:var(--sw-shadow); overflow:hidden; }

.rp-head { display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;
  padding:0.6rem 0.8rem; background:var(--sw-surface-2);
  border-bottom:1px solid var(--sw-border-soft); }
.rp-head h3 { margin:0; font-size:0.8rem; font-weight:700; color:var(--sw-text); }

.rp-summary { margin:0; font-size:0.72rem; font-weight:700; padding:0.15rem 0.5rem;
  border-radius:0.3rem; border:1px solid transparent; }
.rp-summary.ok   { background:var(--sw-green-bg); color:var(--sw-green); border-color:var(--sw-green-border); }
.rp-summary.bad  { background:var(--sw-red-bg);   color:var(--sw-red);   border-color:var(--ent-tone-negative-line); }
.rp-summary.warn { background:var(--sw-amber-bg); color:var(--sw-amber-text); border-color:var(--sw-amber-border); }
.rp-summary.busy { background:var(--sw-surface-3); color:var(--sw-text-2); border-color:var(--sw-border-soft); }

.rp-refresh { margin-left:auto; display:inline-flex; align-items:center; gap:0.3rem;
  padding:0.25rem 0.55rem; font-size:0.7rem; font-weight:600; cursor:pointer;
  border:1px solid var(--sw-border); border-radius:0.3rem;
  background:var(--sw-surface); color:var(--sw-text-2); }
.rp-refresh:hover:not(:disabled) { background:var(--sw-surface-3); color:var(--sw-text); }
.rp-refresh:disabled { opacity:0.55; cursor:not-allowed; }
.spin { animation:rp-spin 1s linear infinite; }
@keyframes rp-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation:none; } }

.rp-table { width:100%; border-collapse:collapse; }
.rp-table thead th { text-align:left; font-size:0.62rem; font-weight:700;
  letter-spacing:0.06em; text-transform:uppercase; color:var(--sw-muted);
  padding:0.4rem 0.8rem; border-bottom:1px solid var(--sw-border-soft); }
.rp-table thead th:last-child { text-align:right; }

.rp-table tbody tr { border-bottom:1px solid var(--sw-border-soft); }
.rp-table tbody tr:last-child { border-bottom:0; }
.rp-table tbody th { text-align:left; font-weight:400; padding:0.5rem 0.8rem;
  display:flex; flex-direction:column; gap:0.15rem; }
.rp-table tbody td { padding:0.5rem 0.8rem; text-align:right; vertical-align:top;
  white-space:nowrap; }

.rp-label { font-size:0.76rem; font-weight:600; color:var(--sw-text);
  display:inline-flex; align-items:center; gap:0.35rem; flex-wrap:wrap; }
.rp-detail { font-size:0.7rem; color:var(--sw-text-2); line-height:1.4; }

.rp-enforced { display:inline-flex; align-items:center; gap:0.15rem;
  font-size:0.58rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;
  padding:0.05rem 0.3rem; border-radius:0.2rem;
  background:var(--sw-surface-3); color:var(--sw-text-2); border:1px solid var(--sw-border-soft); }

.rp-status { display:inline-flex; align-items:center; gap:0.3rem;
  font-size:0.7rem; font-weight:700; padding:0.15rem 0.45rem;
  border-radius:0.3rem; border:1px solid transparent; }
.rp-status.ok      { background:var(--sw-green-bg);  color:var(--sw-green);      border-color:var(--sw-green-border); }
.rp-status.bad     { background:var(--sw-red-bg);    color:var(--sw-red);        border-color:var(--ent-tone-negative-line); }
.rp-status.na      { background:var(--sw-surface-3); color:var(--sw-muted);      border-color:var(--sw-border-soft); }
.rp-status.unknown { background:var(--sw-amber-bg);  color:var(--sw-amber-text); border-color:var(--sw-amber-border); }

.rp-legend { margin-top:0.5rem; font-size:0.72rem; color:var(--sw-text-2); }
.rp-legend summary { cursor:pointer; font-weight:600; }
.rp-legend dl { display:grid; grid-template-columns:max-content 1fr; gap:0.2rem 0.8rem; margin:0.4rem 0 0; }
.rp-legend dt { font-weight:600; }
.rp-legend dd { margin:0; }
.rp-note { margin:0; padding:0.5rem 0.8rem; font-size:0.68rem; line-height:1.5;
  color:var(--sw-muted); background:var(--sw-surface-2);
  border-top:1px solid var(--sw-border-soft); }

/* Narrow screens: the status column drops under the label rather than forcing
   the table to scroll sideways. */
@media (max-width: 720px) {
  .rp-table thead { display:none; }
  .rp-table tbody tr { display:flex; flex-direction:column; gap:0.25rem; padding-bottom:0.5rem; }
  .rp-table tbody th { padding-bottom:0; }
  .rp-table tbody td { text-align:left; padding-top:0; }
}
</style>
