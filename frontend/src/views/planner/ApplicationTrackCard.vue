<script setup lang="ts">
// CityView-style auto-generated approval track for the chosen development type:
// required submittals (completeness), departments to circulate to, public-
// hearing requirement, and the legislated decision timeline. Read-only; it
// reacts live to the development type the officer selects at intake.
import { computed } from 'vue'
import type { DevType } from '@/composables/usePlannerCase'
import { trackFor } from './developmentTracks'
import UiPanel from '@/components/ui/UiPanel.vue'
import { CheckCircle2, Circle, Clock, Users, Megaphone, FileCheck, ChevronRight } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  devType: DevType | string
  /** Per-submittal satisfied flags (keyed by SubmittalItem.key) where known. */
  satisfied?: Record<string, boolean>
}>(), { satisfied: () => ({}) })

const track = computed(() => trackFor(props.devType))
const outstanding = computed(() =>
  track.value.submittals.filter(s => !props.satisfied[s.key]).length)
const received = computed(() => track.value.submittals.length - outstanding.value)
const pct = computed(() =>
  track.value.submittals.length ? Math.round((received.value / track.value.submittals.length) * 100) : 0)
</script>

<template>
  <UiPanel class="req" title="Application requirements" :subtitle="track.label">
    <template #icon><FileCheck :size="15" /></template>
    <template #actions>
      <span class="req-tag">
        <Clock :size="11" aria-hidden="true" />
        <span class="req-num">{{ track.statutoryDays }}</span>-day decision
      </span>
      <span class="req-tag" :class="track.hearingRequired ? 'is-warning' : 'is-neutral'">
        <Megaphone :size="11" aria-hidden="true" />
        {{ track.hearingRequired ? 'Public hearing required' : 'No public hearing' }}
      </span>
    </template>

    <p class="req-note">{{ track.note }}</p>

    <div class="req-cols">
      <!-- ── Submission completeness ─────────────────────────────────────── -->
      <section class="req-col">
        <h5 class="req-eyebrow">
          Submission completeness
          <span class="req-count" :class="{ ok: outstanding === 0 }">
            <span class="req-num">{{ received }} / {{ track.submittals.length }}</span> complete
          </span>
        </h5>

        <div
          class="req-meter"
          role="progressbar"
          :aria-valuenow="received"
          :aria-valuemin="0"
          :aria-valuemax="track.submittals.length"
          :aria-label="`${received} of ${track.submittals.length} required submittals received`"
        >
          <span class="req-meter-fill" :class="{ ok: outstanding === 0 }" :style="{ width: pct + '%' }" />
        </div>

        <ul class="req-list">
          <li v-for="s in track.submittals" :key="s.key" :class="{ done: satisfied[s.key] }">
            <component :is="satisfied[s.key] ? CheckCircle2 : Circle" :size="13" class="req-ico" aria-hidden="true" />
            <span class="req-doc">{{ s.label }}</span>
            <span class="req-state">{{ satisfied[s.key] ? 'Received' : 'Outstanding' }}</span>
          </li>
        </ul>
      </section>

      <!-- ── Technical referrals ─────────────────────────────────────────── -->
      <section class="req-col">
        <h5 class="req-eyebrow">
          <Users :size="12" aria-hidden="true" /> Technical referrals
          <span class="req-count neutral"><span class="req-num">{{ track.referrals.length }}</span> bodies</span>
        </h5>

        <ul class="req-list">
          <li v-for="r in track.referrals" :key="r" class="req-ref">
            <ChevronRight :size="13" class="req-ico" aria-hidden="true" />
            <span class="req-doc">{{ r }}</span>
          </li>
        </ul>

        <p class="req-hint">Technical circulation requirements for this application type.</p>
      </section>
    </div>
  </UiPanel>
</template>

<style scoped>
.req { margin: var(--ent-s3) 0; }
.req-num { font-family: var(--ent-font-mono); font-weight: var(--ent-fw-semibold); font-variant-numeric: tabular-nums; }

/* Header meta tags — informational, not decorative chips. */
.req-tag {
  display: inline-flex; align-items: center; gap: var(--ent-s1);
  padding: 2px var(--ent-s2); border-radius: var(--ent-r-sm);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); line-height: 1.5;
  background: var(--ent-tone-info-bg); color: var(--ent-tone-info-fg);
  border: 1px solid var(--ent-tone-info-line);
}
.req-tag.is-warning { background: var(--ent-tone-warning-bg); color: var(--ent-tone-warning-fg); border-color: var(--ent-tone-warning-line); }
.req-tag.is-neutral { background: var(--ent-tone-neutral-bg); color: var(--ent-tone-neutral-fg); border-color: var(--ent-tone-neutral-line); }

.req-note {
  margin: 0 0 var(--ent-s3);
  font-size: var(--ent-fs-xs); color: var(--ent-text-2); line-height: var(--ent-lh);
}

.req-cols { display: grid; grid-template-columns: 1.35fr 1fr; gap: var(--ent-s5); }
.req-col { min-width: 0; }
.req-col + .req-col { border-left: 1px solid var(--ent-line); padding-left: var(--ent-s5); }

.req-eyebrow {
  display: flex; align-items: center; gap: var(--ent-s2);
  margin: 0 0 var(--ent-s2); padding-bottom: var(--ent-s2);
  border-bottom: 1px solid var(--ent-line);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold);
  text-transform: uppercase; letter-spacing: 0.06em; color: var(--ent-text-2);
}
.req-count {
  margin-left: auto; text-transform: none; letter-spacing: 0;
  font-weight: var(--ent-fw-semibold); color: var(--ent-warning); white-space: nowrap;
}
.req-count.ok { color: var(--ent-success); }
.req-count.neutral { color: var(--ent-text-3); }

.req-meter { height: 3px; border-radius: var(--ent-r-pill); background: var(--ent-surface-sunken); overflow: hidden; margin-bottom: var(--ent-s2); }
.req-meter-fill { display: block; height: 100%; background: var(--ent-warning); transition: width var(--ent-dur-lg) var(--ent-ease); }
.req-meter-fill.ok { background: var(--ent-success); }

/* Rows separated by hairlines, not nested cards. */
.req-list { list-style: none; margin: 0; padding: 0; }
.req-list li {
  display: flex; align-items: center; gap: var(--ent-s2);
  min-height: 28px; padding: var(--ent-s1) 0;
  font-size: var(--ent-fs-sm); color: var(--ent-text);
  border-bottom: 1px solid var(--ent-line);
}
.req-list li:last-child { border-bottom: none; }
.req-ico { flex-shrink: 0; color: var(--ent-warning); }
.req-list li.done .req-ico { color: var(--ent-success); }
.req-ref .req-ico { color: var(--ent-text-3); }
.req-doc { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.req-list li.done .req-doc { color: var(--ent-text-2); font-weight: var(--ent-fw-normal); }
.req-list li:not(.done) .req-doc { font-weight: var(--ent-fw-medium); }
.req-state {
  margin-left: auto; flex-shrink: 0;
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--ent-warning);
}
.req-list li.done .req-state { color: var(--ent-text-3); font-weight: var(--ent-fw-normal); }

.req-hint { margin: var(--ent-s3) 0 0; font-size: var(--ent-fs-micro); color: var(--ent-text-3); line-height: var(--ent-lh); }

@media (max-width: 1023px) {
  .req-cols { grid-template-columns: 1fr; gap: var(--ent-s4); }
  .req-col + .req-col { border-left: none; padding-left: 0; border-top: 1px solid var(--ent-line); padding-top: var(--ent-s4); }
}
@media (prefers-reduced-motion: reduce) { .req-meter-fill { transition: none; } }
</style>
