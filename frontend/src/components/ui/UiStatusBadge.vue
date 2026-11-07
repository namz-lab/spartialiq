<script setup lang="ts">
// Enterprise UI kit — StatusBadge. THE canonical workflow-state indicator.
// Pass a raw status key (permit lifecycle or enforcement) and it resolves the
// human label + one of five tones defined in enterprise.css, so "Approved"
// looks identical everywhere. Or pass an explicit `tone` + `label` for
// domain states not in the map. Consumes --ent-tone-* tokens.
import { computed } from 'vue'

type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'negative'

const props = withDefaults(defineProps<{
  status?: string
  tone?: Tone
  label?: string
  dot?: boolean
}>(), { dot: true })

// Statutory permit lifecycle + enforcement states → (tone, human label).
const MAP: Record<string, { tone: Tone; label: string }> = {
  // Permit application lifecycle (RTCP Act workflow)
  registered:               { tone: 'neutral',  label: 'Registered' },
  acknowledged:             { tone: 'neutral',  label: 'Acknowledged' },
  pending_docs:             { tone: 'neutral',  label: 'Pending docs' },
  pending_payment:          { tone: 'neutral',  label: 'Pending payment' },
  under_review:             { tone: 'info',     label: 'Under review' },
  circulation:              { tone: 'info',     label: 'In circulation' },
  consultation:             { tone: 'info',     label: 'Consultation' },
  objection_period:         { tone: 'info',     label: 'Objection period' },
  awaiting_eo_decision:     { tone: 'info',     label: 'Awaiting EO decision' },
  deferred:                 { tone: 'warning',  label: 'Deferred' },
  appeal:                   { tone: 'warning',  label: 'On appeal' },
  appealed:                 { tone: 'warning',  label: 'Under appeal' },
  approved:                 { tone: 'positive', label: 'Approved' },
  approved_with_conditions: { tone: 'positive', label: 'Approved (conditions)' },
  conditionally_approved:   { tone: 'positive', label: 'Conditionally approved' },
  refused:                  { tone: 'negative', label: 'Refused' },
  withdrawn:                { tone: 'neutral',  label: 'Withdrawn' },
  lapsed:                   { tone: 'neutral',  label: 'Lapsed' },
  // Enforcement orders
  active:                   { tone: 'negative', label: 'Active' },
  extended:                 { tone: 'warning',  label: 'Extended' },
  complied:                 { tone: 'positive', label: 'Complied' },
  cancelled:                { tone: 'neutral',  label: 'Cancelled' },
  scheduled:                { tone: 'info',     label: 'Scheduled' },
  held:                     { tone: 'positive', label: 'Held' },
  closed:                   { tone: 'neutral',  label: 'Closed' },
  // Building plan revisions
  submitted:                { tone: 'info',     label: 'Submitted' },
  under_appraisal:          { tone: 'info',     label: 'Under appraisal' },
  approved_with_amendments: { tone: 'positive', label: 'Approved (amendments)' },
  resubmitted:              { tone: 'info',     label: 'Resubmitted' },
  rejected:                 { tone: 'negative', label: 'Rejected' },
  superseded:               { tone: 'neutral',  label: 'Superseded' },
  // Official enforcement lifecycle (spatial_planning.enforcement_order CHECK)
  draft:                    { tone: 'neutral',  label: 'Draft' },
  issued:                   { tone: 'negative', label: 'Issued' },
  served:                   { tone: 'negative', label: 'Served' },
  non_complied:             { tone: 'negative', label: 'Non-complied' },
  // Stage inspection bookings and results
  waitlisted:               { tone: 'warning',  label: 'Awaiting date' },
  rescheduled:              { tone: 'warning',  label: 'Rescheduled' },
  in_progress:              { tone: 'info',     label: 'In progress' },
  passed:                   { tone: 'positive', label: 'Passed' },
  failed:                   { tone: 'negative', label: 'Failed' },
  pass:                     { tone: 'positive', label: 'Pass' },
  conditional_pass:         { tone: 'warning',  label: 'Conditional pass' },
  fail:                     { tone: 'negative', label: 'Fail' },
  reinspection_required:    { tone: 'negative', label: 'Reinspection required' },
}

const resolved = computed(() => {
  const hit = props.status ? MAP[props.status] : undefined
  return {
    tone: props.tone ?? hit?.tone ?? 'neutral',
    label: props.label ?? hit?.label ?? props.status ?? '—',
  }
})
</script>

<template>
  <span class="ui-badge" :class="`t-${resolved.tone}`">
    <span v-if="dot" class="ui-badge-dot" aria-hidden="true" />
    {{ resolved.label }}
  </span>
</template>

<style scoped>
.ui-badge {
  display: inline-flex; align-items: center; gap: var(--ent-s2);
  padding: 2px var(--ent-s2); border-radius: var(--ent-r-pill);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  line-height: 1.4; white-space: nowrap;
  border: 1px solid transparent;
}
.ui-badge-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

.ui-badge.t-neutral  { background: var(--ent-tone-neutral-bg);  color: var(--ent-tone-neutral-fg);  border-color: var(--ent-tone-neutral-line); }
.ui-badge.t-info     { background: var(--ent-tone-info-bg);     color: var(--ent-tone-info-fg);     border-color: var(--ent-tone-info-line); }
.ui-badge.t-positive { background: var(--ent-tone-positive-bg); color: var(--ent-tone-positive-fg); border-color: var(--ent-tone-positive-line); }
.ui-badge.t-warning  { background: var(--ent-tone-warning-bg);  color: var(--ent-tone-warning-fg);  border-color: var(--ent-tone-warning-line); }
.ui-badge.t-negative { background: var(--ent-tone-negative-bg); color: var(--ent-tone-negative-fg); border-color: var(--ent-tone-negative-line); }
</style>
