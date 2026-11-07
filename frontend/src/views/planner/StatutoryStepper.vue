<script setup lang="ts">
// Presentational rail for the statutory case workflow. Renders the descriptors
// from useStatutorySteps as one continuous process (marker + connector), the
// active stage expanding to its subtasks. No business logic — emits `select`
// for unlocked stages only; every label below comes from the descriptor.
import { computed } from 'vue'
import type { StatutoryStep } from '@/composables/useStatutorySteps'
import { ArrowRight, CheckCircle2, Circle, Lock } from 'lucide-vue-next'

const props = defineProps<{ steps: StatutoryStep[]; activeId: number }>()
const emit = defineEmits<{ select: [id: number] }>()

// Presentation-only: position of the active stage in the supplied sequence.
const activePosition = computed(() => props.steps.findIndex(s => s.id === props.activeId) + 1)

function onClick(s: StatutoryStep) {
  if (s.status === 'locked') return
  emit('select', s.id)
}

function stageNo(i: number) {
  return String(i + 1).padStart(2, '0')
}

function stateLabel(s: StatutoryStep) {
  if (s.status === 'done') return 'Completed'
  if (s.status === 'locked') return 'Locked'
  return s.id === props.activeId ? 'In progress' : 'Available'
}

function percent(s: StatutoryStep) {
  return s.progressTotal > 0 ? Math.round((s.progressDone / s.progressTotal) * 100) : 0
}
</script>

<template>
  <nav class="sx-rail" aria-label="Statutory steps">
    <header class="sx-rail-head">
      <span class="sx-eyebrow">Statutory workflow</span>
      <span v-if="activePosition > 0" class="sx-counter">
        Stage {{ activePosition }} of {{ props.steps.length }}
      </span>
    </header>

    <ol class="sx-list">
      <li v-for="(s, i) in props.steps" :key="s.id" class="sx-item">
        <button
          type="button"
          class="sx-step"
          :class="{ active: s.id === props.activeId, locked: s.status === 'locked',
                    done: s.status === 'done' }"
          :disabled="s.status === 'locked'"
          :aria-current="s.id === props.activeId ? 'step' : undefined"
          @click="onClick(s)">
          <span class="sx-track">
            <span class="sx-marker" :class="['st-' + s.status, { current: s.id === props.activeId }]">
              <CheckCircle2 v-if="s.status === 'done'" :size="16" aria-hidden="true" />
              <Lock v-else-if="s.status === 'locked'" :size="14" aria-hidden="true" />
              <span v-else class="sx-marker-no">{{ stageNo(i) }}</span>
            </span>
            <span v-if="i < props.steps.length - 1" class="sx-connector" :class="'cn-' + s.status" />
          </span>

          <span class="sx-body">
            <span class="sx-head">
              <span class="sx-title">{{ s.title }}</span>
              <span class="sx-state" :class="'sv-' + s.status">{{ stateLabel(s) }}</span>
            </span>

            <span v-if="s.lockedReason" class="sx-locked">{{ s.lockedReason }}</span>

            <span v-if="s.progressTotal > 0" class="sx-progress">
              <span class="sx-progress-row">
                <span class="sx-progress-label">Completion</span>
                <span class="sx-chip">{{ s.progressDone }}/{{ s.progressTotal }}</span>
              </span>
              <span class="sx-bar" aria-hidden="true">
                <i :style="{ width: percent(s) + '%' }" />
              </span>
            </span>

            <span v-if="s.nextAction" class="sx-next">
              <ArrowRight class="sx-next-icon" :size="12" aria-hidden="true" />
              <span class="sx-next-text"><span class="sx-next-label">Next action</span>{{ s.nextAction }}</span>
            </span>

            <span v-if="s.id === props.activeId && s.subtasks.length" class="sx-subs">
              <span class="sx-subs-label">Subtasks</span>
              <span v-for="t in s.subtasks" :key="t.label" class="sx-subtask" :class="{ done: t.done }">
                <component :is="t.done ? CheckCircle2 : Circle" :size="12" aria-hidden="true" />
                {{ t.label }}
              </span>
            </span>
          </span>
        </button>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.sx-rail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 100%;
  overflow-y: auto;
  background: var(--ent-surface, #fff);
  font-family: var(--ent-font, inherit);
}

.sx-rail-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--ent-s3, 12px) var(--ent-s3, 12px) var(--ent-s2, 8px);
  background: var(--ent-surface-2, #f4f6f9);
  border-bottom: 1px solid var(--ent-line, #dde2e9);
}
.sx-eyebrow {
  font-size: var(--ent-fs-micro, 0.6875rem);
  font-weight: var(--ent-fw-semibold, 600);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--ent-text-3, #7b8797);
}
.sx-counter {
  font-size: var(--ent-fs-sm, 0.8125rem);
  font-weight: var(--ent-fw-semibold, 600);
  color: var(--ent-text, #1a2430);
}

.sx-list { list-style: none; margin: 0; padding: var(--ent-s2, 8px) var(--ent-s3, 12px) var(--ent-s4, 16px); }

/* One continuous process: rows butt together, the connector spans the gap. */
.sx-step {
  position: relative;
  display: flex;
  gap: var(--ent-s3, 12px);
  align-items: flex-start;
  width: 100%;
  padding: var(--ent-s2, 8px) var(--ent-s2, 8px) var(--ent-s2, 8px) 0;
  text-align: left;
  background: none;
  border: 0;
  border-left: 2px solid transparent;
  border-radius: var(--ent-r, 6px);
  color: var(--ent-text-2, #515c6b);
  font: inherit;
  cursor: pointer;
  transition: background var(--ent-dur, 150ms) var(--ent-ease, ease),
              border-color var(--ent-dur, 150ms) var(--ent-ease, ease);
}
.sx-step:hover:not(:disabled) { background: var(--ent-surface-2, #f4f6f9); }
.sx-step:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--ent-focus-ring, 0 0 0 3px rgba(31, 90, 168, 0.32));
}
.sx-step.active {
  background: var(--ent-accent-soft, #e8f0f9);
  border-left-color: var(--ent-accent, #1f5aa8);
  padding-left: var(--ent-s2, 8px);
}
.sx-step:disabled { cursor: not-allowed; }

/* Marker column ---------------------------------------------------------- */
.sx-track { position: relative; display: flex; flex-direction: column; align-items: center; align-self: stretch; }
.sx-marker {
  position: relative;
  z-index: 1;
  width: 32px;
  height: 32px;
  min-width: 32px;
  border-radius: var(--ent-r-pill, 9999px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--ent-fs-xs, 0.75rem);
  font-weight: var(--ent-fw-bold, 700);
  font-variant-numeric: tabular-nums;
  background: var(--ent-surface, #fff);
  border: 1px solid var(--ent-line-strong, #c4ccd7);
  color: var(--ent-text-2, #515c6b);
}
.sx-marker.st-done { background: var(--ent-success, #1d7a4d); border-color: var(--ent-success, #1d7a4d); color: #fff; }
.sx-marker.st-available { border-color: var(--ent-accent, #1f5aa8); color: var(--ent-accent, #1f5aa8); }
.sx-marker.st-locked { background: var(--ent-surface-sunken, #e8ecf1); border-color: var(--ent-line, #dde2e9); color: var(--ent-text-3, #7b8797); }
.sx-marker.current {
  background: var(--ent-accent, #1f5aa8);
  border-color: var(--ent-accent, #1f5aa8);
  color: var(--ent-text-on-accent, #fff);
  box-shadow: 0 0 0 3px var(--ent-surface, #fff), 0 0 0 5px var(--ent-accent-line, #b9d1ec);
}

.sx-connector {
  flex: 1;
  width: 0;
  min-height: var(--ent-s3, 12px);
  margin-bottom: -16px;   /* bridge this row's padding through to the next marker */
  border-left: 2px solid var(--ent-line-strong, #c4ccd7);
}
.sx-connector.cn-done { border-left-color: var(--ent-success, #1d7a4d); }
.sx-connector.cn-available { border-left-color: var(--ent-accent, #1f5aa8); }
.sx-connector.cn-locked { border-left-style: dashed; border-left-color: var(--ent-line, #dde2e9); }

/* Stage body ------------------------------------------------------------- */
.sx-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--ent-s1, 4px); padding-top: 2px; }
.sx-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--ent-s2, 8px); }
.sx-title {
  font-size: var(--ent-fs-sm, 0.8125rem);
  font-weight: var(--ent-fw-semibold, 600);
  color: var(--ent-text, #1a2430);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sx-step.done .sx-title { color: var(--ent-text-2, #515c6b); font-weight: var(--ent-fw-medium, 500); }
.sx-state {
  flex: none;
  font-size: var(--ent-fs-micro, 0.6875rem);
  font-weight: var(--ent-fw-semibold, 600);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ent-text-3, #7b8797);
}
.sx-state.sv-done { color: var(--ent-success, #1d7a4d); }
.sx-step.active .sx-state.sv-available { color: var(--ent-accent, #1f5aa8); }

.sx-locked { font-size: var(--ent-fs-xs, 0.75rem); color: var(--ent-text-3, #7b8797); }

.sx-progress { display: flex; flex-direction: column; gap: 3px; margin-top: 2px; }
.sx-progress-row { display: flex; align-items: center; justify-content: space-between; gap: var(--ent-s2, 8px); }
.sx-progress-label {
  font-size: var(--ent-fs-micro, 0.6875rem);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ent-text-3, #7b8797);
}
.sx-chip {
  font-size: var(--ent-fs-micro, 0.6875rem);
  font-weight: var(--ent-fw-semibold, 600);
  font-variant-numeric: tabular-nums;
  color: var(--ent-text-2, #515c6b);
}
.sx-bar { height: 3px; border-radius: var(--ent-r-pill, 9999px); background: var(--ent-surface-sunken, #e8ecf1); overflow: hidden; }
.sx-bar > i {
  display: block;
  height: 100%;
  background: var(--ent-accent, #1f5aa8);
  transition: width var(--ent-dur-lg, 240ms) var(--ent-ease, ease);
}
.sx-step.done .sx-bar > i { background: var(--ent-success, #1d7a4d); }
.sx-step.locked .sx-bar > i { background: var(--ent-line-strong, #c4ccd7); }

.sx-next { display: flex; align-items: flex-start; gap: var(--ent-s1, 4px); margin-top: 2px; color: var(--ent-accent, #1f5aa8); }
.sx-next-icon { flex: none; margin-top: 3px; }
.sx-next-text { font-size: var(--ent-fs-xs, 0.75rem); font-weight: var(--ent-fw-medium, 500); }
.sx-next-label {
  display: block;
  font-size: var(--ent-fs-micro, 0.6875rem);
  font-weight: var(--ent-fw-semibold, 600);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ent-text-3, #7b8797);
}

.sx-subs {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: var(--ent-s1, 4px);
  padding-top: var(--ent-s1, 4px);
  border-top: 1px solid var(--ent-accent-line, #b9d1ec);
}
.sx-subs-label {
  font-size: var(--ent-fs-micro, 0.6875rem);
  font-weight: var(--ent-fw-semibold, 600);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ent-text-3, #7b8797);
}
.sx-subtask {
  display: flex;
  align-items: center;
  gap: var(--ent-s1, 4px);
  font-size: var(--ent-fs-xs, 0.75rem);
  color: var(--ent-text-2, #515c6b);
}
.sx-subtask > svg { flex: none; color: var(--ent-text-3, #7b8797); }
.sx-subtask.done { color: var(--ent-text-3, #7b8797); }
.sx-subtask.done > svg { color: var(--ent-success, #1d7a4d); }

@media (prefers-reduced-motion: reduce) {
  .sx-step, .sx-bar > i { transition: none; }
}
</style>
