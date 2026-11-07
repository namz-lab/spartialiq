<script setup lang="ts">
// Case workspace — due-diligence check table. One compact assessment grid used
// for all three Step 2 buckets (file checks, compatibility, statutory
// provisions), which differ only in their rows and their verdict wording.
//
// Presentation + local expand state only. Every verdict and note is emitted
// upward; Step2DueDiligence owns the case mutation and the debounced save().
import { reactive, computed } from 'vue'
import { CheckCircle2, XCircle, MinusCircle, ChevronDown, ChevronRight, StickyNote } from 'lucide-vue-next'

type Result = 'pass' | 'fail' | 'na'
type Row = { result: Result | null; notes: string }

const props = withDefaults(defineProps<{
  /** [key, label] tuples — the persisted keys from dueDiligenceChecks.ts. */
  items: ReadonlyArray<readonly [string, string]>
  /** The case's bucket for these items. Missing keys read as unassessed. */
  rows: Record<string, Row | undefined>
  /** Verdict wording. Statutory provisions say Compliant / Non-compliant. */
  passLabel?: string
  failLabel?: string
  /** Distinguishes the notes textarea ids across the three tables. */
  idPrefix: string
}>(), { passLabel: 'Pass', failLabel: 'Fail' })

const emit = defineEmits<{
  set: [key: string, value: Result]
  notes: [key: string, notes: string]
  /** Fired on textarea change so the parent can flush its save(). */
  commit: []
}>()

const expanded = reactive<Record<string, boolean>>({})

const verdicts = computed<Array<{ value: Result; label: string; icon: any; cls: string }>>(() => [
  { value: 'pass', label: props.passLabel, icon: CheckCircle2, cls: 'v-pass' },
  { value: 'fail', label: props.failLabel, icon: XCircle, cls: 'v-fail' },
  { value: 'na', label: 'N/A', icon: MinusCircle, cls: 'v-na' },
])

function resultOf(key: string): Result | null { return props.rows[key]?.result ?? null }
function notesOf(key: string): string { return props.rows[key]?.notes ?? '' }
function hasNotes(key: string): boolean { return notesOf(key).trim().length > 0 }
</script>

<template>
  <table class="dct">
    <thead>
      <tr>
        <th scope="col" class="dct-th-item">Item</th>
        <th scope="col" class="dct-th-verdict">Assessment</th>
      </tr>
    </thead>
    <tbody>
      <template v-for="[key, label] in props.items" :key="key">
        <tr class="dct-row" :class="{ unassessed: resultOf(key) === null }">
          <td class="dct-item">
            <span class="dct-label">{{ label }}</span>
            <span v-if="resultOf(key) === null" class="dct-pending">Outstanding</span>
          </td>
          <td class="dct-verdict">
            <div class="dct-group" role="group" :aria-label="`Assessment for ${label}`">
              <button
                v-for="v in verdicts" :key="v.value"
                type="button"
                class="dct-btn" :class="[v.cls, { active: resultOf(key) === v.value }]"
                :aria-pressed="resultOf(key) === v.value"
                @click="emit('set', key, v.value)"
              >
                <component :is="v.icon" :size="12" aria-hidden="true" />
                {{ v.label }}
              </button>
            </div>
            <button
              type="button"
              class="dct-notes-btn" :class="{ active: expanded[key], filled: hasNotes(key) }"
              :aria-expanded="!!expanded[key]"
              :aria-controls="`${props.idPrefix}-${key}-notes`"
              @click="expanded[key] = !expanded[key]"
            >
              <component :is="expanded[key] ? ChevronDown : ChevronRight" :size="11" aria-hidden="true" />
              <StickyNote v-if="hasNotes(key)" :size="11" aria-hidden="true" />
              Notes
            </button>
          </td>
        </tr>
        <tr v-if="expanded[key]" class="dct-notes-row">
          <td colspan="2">
            <label class="dct-notes-label" :for="`${props.idPrefix}-${key}-notes`">
              Officer notes — included verbatim in the exported due-diligence report
            </label>
            <textarea
              :id="`${props.idPrefix}-${key}-notes`"
              :value="notesOf(key)"
              rows="2"
              placeholder="Findings, evidence relied on, references…"
              @input="emit('notes', key, ($event.target as HTMLTextAreaElement).value)"
              @change="emit('commit')"
            />
          </td>
        </tr>
      </template>
    </tbody>
  </table>
</template>

<style scoped>
.dct { width: 100%; border-collapse: collapse; font-family: var(--ent-font); }

.dct th {
  padding: var(--ent-s2) var(--ent-s4) 5px; text-align: left;
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold);
  text-transform: uppercase; letter-spacing: 0.05em; color: var(--ent-text-3);
  border-bottom: 1px solid var(--ent-line-strong); white-space: nowrap;
}
.dct-th-verdict { text-align: right; }

.dct-row > td {
  padding: 6px var(--ent-s4); border-bottom: 1px solid var(--ent-line);
  vertical-align: middle; height: var(--ent-row-h); box-sizing: border-box;
}
.dct-row:hover { background: var(--ent-surface-2); }

.dct-item { min-width: 0; }
.dct-label { font-size: var(--ent-fs-sm); color: var(--ent-text); }
.dct-pending {
  display: inline-block; margin-left: var(--ent-s2);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  text-transform: uppercase; letter-spacing: 0.04em; color: var(--ent-warning);
}

.dct-verdict {
  display: flex; align-items: center; justify-content: flex-end;
  gap: var(--ent-s2); flex-wrap: wrap;
}
.dct-group { display: inline-flex; }

/* Segmented control: one decision, three mutually exclusive answers. */
.dct-btn {
  display: inline-flex; align-items: center; gap: 4px;
  height: var(--ent-control-h-sm); padding: 0 var(--ent-s2);
  border: 1px solid var(--ent-line-strong); background: var(--ent-surface);
  color: var(--ent-text-2); font-family: var(--ent-font);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  white-space: nowrap; cursor: pointer;
  transition: background var(--ent-dur) var(--ent-ease), color var(--ent-dur) var(--ent-ease);
}
.dct-btn + .dct-btn { margin-left: -1px; }
.dct-btn:first-child { border-radius: var(--ent-r-sm) 0 0 var(--ent-r-sm); }
.dct-btn:last-child { border-radius: 0 var(--ent-r-sm) var(--ent-r-sm) 0; }
.dct-btn:hover:not(.active) { background: var(--ent-surface-2); color: var(--ent-text); }
.dct-btn:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); z-index: 1; }

.dct-btn.active { z-index: 1; color: var(--ent-text-on-accent); }
.dct-btn.v-pass.active { background: var(--ent-success); border-color: var(--ent-success); }
.dct-btn.v-fail.active { background: var(--ent-danger); border-color: var(--ent-danger); }
.dct-btn.v-na.active { background: var(--ent-tone-neutral-fg); border-color: var(--ent-tone-neutral-fg); }

.dct-notes-btn {
  display: inline-flex; align-items: center; gap: 3px;
  height: var(--ent-control-h-sm); padding: 0 var(--ent-s2);
  border: 1px solid transparent; border-radius: var(--ent-r-sm);
  background: none; color: var(--ent-text-3);
  font-family: var(--ent-font); font-size: var(--ent-fs-micro);
  font-weight: var(--ent-fw-semibold); cursor: pointer;
}
.dct-notes-btn:hover { color: var(--ent-accent); background: var(--ent-accent-soft); }
.dct-notes-btn.active, .dct-notes-btn.filled { color: var(--ent-accent); }
.dct-notes-btn:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }

.dct-notes-row > td {
  padding: var(--ent-s2) var(--ent-s4) var(--ent-s3);
  background: var(--ent-surface-2); border-bottom: 1px solid var(--ent-line);
}
.dct-notes-label {
  display: block; margin-bottom: 3px;
  font-size: var(--ent-fs-micro); color: var(--ent-text-3);
}
.dct-notes-row textarea {
  width: 100%; box-sizing: border-box; resize: vertical;
  padding: 6px var(--ent-s2);
  font-family: var(--ent-font); font-size: var(--ent-fs-sm);
  line-height: var(--ent-lh); color: var(--ent-text);
  background: var(--ent-surface); border: 1px solid var(--ent-line-strong);
  border-radius: var(--ent-r-sm);
}
.dct-notes-row textarea:focus-visible {
  outline: none; border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring);
}

@media (prefers-reduced-motion: reduce) { .dct-btn { transition: none; } }
</style>
