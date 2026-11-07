<script setup lang="ts">
// One condition of approval, with the five legal tests.
//
// Three states, distinguished by icon + text + border, never colour alone:
//   PASS       — wording present and all five tests satisfied
//   INCOMPLETE — no wording yet (the officer has not written the condition)
//   FAIL       — wording present but one or more tests unsatisfied
//
// A condition failing any test is not lawfully enforceable, which is why it
// blocks issuance rather than merely warning.

import { computed } from 'vue'
import { CheckCircle2, XCircle, PencilLine, Trash2 } from 'lucide-vue-next'
import type { PlanningCondition } from '@/composables/useConditionLibrary'

const props = defineProps<{
  condition: PlanningCondition
  index: number
  /** An issued permit is a fixed legal record — nothing here may change. */
  readonly: boolean
}>()

const emit = defineEmits<{
  (e: 'change'): void
  (e: 'remove'): void
}>()

const TESTS = [
  ['necessity',      'Necessary'],
  ['relevance',      'Relevant to planning'],
  ['enforceability', 'Enforceable'],
  ['precision',      'Precise / unambiguous'],
  ['reasonableness', 'Reasonable / proportionate'],
] as const

const hasText = computed(() => props.condition.text.trim().length > 0)
const passedCount = computed(() => TESTS.filter(([k]) => props.condition.tests[k]).length)
const allPassed = computed(() => passedCount.value === TESTS.length)

const state = computed<'pass' | 'fail' | 'incomplete'>(() => {
  if (!hasText.value) return 'incomplete'
  return allPassed.value ? 'pass' : 'fail'
})

const STATE_META = {
  pass:       { label: 'Passes all five tests',   icon: CheckCircle2 },
  fail:       { label: 'Fails one or more tests', icon: XCircle },
  incomplete: { label: 'Incomplete — no wording', icon: PencilLine },
} as const

const textId = computed(() => `cond-text-${props.condition.id}`)
const errId  = computed(() => `cond-err-${props.condition.id}`)

const problem = computed(() => {
  if (!hasText.value) return 'This condition has no wording yet.'
  if (!allPassed.value) {
    const missing = TESTS.filter(([k]) => !props.condition.tests[k]).map(([, l]) => l)
    return `Not yet confirmed as: ${missing.join(', ')}.`
  }
  return ''
})
</script>

<template>
  <li class="ce" :class="state">
    <div class="ce-head">
      <span class="ce-num">{{ index + 1 }}</span>
      <span class="ce-cat">{{ condition.category }}</span>

      <span class="ce-state" :class="state">
        <component :is="STATE_META[state].icon" :size="12" aria-hidden="true" />
        {{ STATE_META[state].label }}
      </span>

      <button v-if="!readonly" type="button" class="ce-remove" @click="emit('remove')">
        <Trash2 :size="12" aria-hidden="true" />
        <span class="sr-only">Remove condition {{ index + 1 }}</span>
        <span aria-hidden="true">Remove</span>
      </button>
    </div>

    <label class="sr-only" :for="textId">Condition {{ index + 1 }} wording</label>
    <!-- Deliberate in-place edit: the parent (Step4PermitDrafting) owns the
         conditions array, passes each element by reference and persists it with
         save() on @change. The prop object is mutated, never reassigned.
         disable/enable rather than disable-next-line: the rule reports the
         v-model attribute's own line, which is inside the tag where an HTML
         comment cannot go. -->
    <!-- eslint-disable vue/no-mutating-props -->
    <textarea
      :id="textId"
      v-model="condition.text"
      class="ce-text"
      rows="3"
      :readonly="readonly"
      :aria-invalid="state !== 'pass'"
      :aria-describedby="problem ? errId : undefined"
      placeholder="State the condition precisely enough that a breach could be identified on site."
      @change="emit('change')"
    />

    <fieldset class="ce-tests" :disabled="readonly">
      <legend>
        Legal tests
        <span class="ce-count" :class="{ done: allPassed }">
          {{ passedCount }} of {{ TESTS.length }} confirmed
        </span>
      </legend>
      <label v-for="[key, label] in TESTS" :key="key" class="ce-test">
        <input type="checkbox" v-model="condition.tests[key]" @change="emit('change')" />
        <span>{{ label }}</span>
      </label>
    </fieldset>
    <!-- eslint-enable vue/no-mutating-props -->

    <p v-if="problem" :id="errId" class="ce-problem">{{ problem }}</p>
  </li>
</template>

<style scoped>
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px;
  overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }

.ce { list-style:none; padding:0.6rem 0.7rem; border:1px solid var(--sw-border-soft);
  border-left-width:3px; border-radius:var(--sw-radius-sm); background:var(--sw-surface); }
.ce.pass       { border-left-color:var(--sw-green); }
.ce.fail       { border-left-color:var(--sw-red);   background:var(--sw-red-bg); }
.ce.incomplete { border-left-color:var(--sw-amber-strong); background:var(--sw-amber-bg); }

.ce-head { display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap; margin-bottom:0.4rem; }
.ce-num { display:inline-flex; align-items:center; justify-content:center;
  width:1.15rem; height:1.15rem; border-radius:0.25rem; flex-shrink:0;
  background:var(--sw-surface-3); color:var(--sw-text-2);
  font-family:var(--sw-mono); font-size:0.65rem; font-weight:700; }
.ce-cat { font-size:0.62rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;
  padding:0.1rem 0.35rem; border-radius:9999px;
  background:var(--sw-primary-tint); color:var(--sw-primary);
  border:1px solid var(--sw-primary-tint-border); }

.ce-state { display:inline-flex; align-items:center; gap:0.25rem; font-size:0.66rem; font-weight:700; }
.ce-state.pass       { color:var(--sw-green); }
.ce-state.fail       { color:var(--sw-red); }
.ce-state.incomplete { color:var(--sw-amber-text); }

.ce-remove { margin-left:auto; display:inline-flex; align-items:center; gap:0.25rem;
  padding:0.2rem 0.45rem; font-size:0.66rem; font-weight:600; cursor:pointer;
  border:1px solid var(--sw-border); border-radius:0.25rem;
  background:var(--sw-surface); color:var(--sw-text-2); }
.ce-remove:hover { background:var(--sw-red-bg); color:var(--sw-red); border-color:var(--sw-red); }

.ce-text { width:100%; box-sizing:border-box; font:inherit; font-size:0.75rem;
  line-height:1.5; padding:0.4rem 0.5rem; resize:vertical;
  border:1px solid var(--sw-border); border-radius:0.3rem;
  background:var(--sw-surface); color:var(--sw-text); }
.ce-text:read-only { background:var(--sw-surface-3); color:var(--sw-text-2); }

.ce-tests { margin:0.5rem 0 0; padding:0; border:0; }
.ce-tests legend { display:flex; align-items:center; gap:0.4rem; padding:0;
  font-size:0.62rem; font-weight:700; text-transform:uppercase;
  letter-spacing:0.05em; color:var(--sw-muted); }
.ce-count { font-size:0.62rem; font-weight:700; text-transform:none; letter-spacing:0;
  padding:0.05rem 0.3rem; border-radius:0.2rem;
  background:var(--sw-surface-3); color:var(--sw-text-2); }
.ce-count.done { background:var(--sw-green-bg); color:var(--sw-green); }

.ce-test { display:inline-flex; align-items:center; gap:0.3rem; margin:0.35rem 0.75rem 0 0;
  font-size:0.7rem; color:var(--sw-text-2); cursor:pointer; }
.ce-tests:disabled .ce-test { cursor:default; opacity:0.75; }
.ce-test input { width:0.85rem; height:0.85rem; accent-color:var(--sw-primary); cursor:inherit; }

.ce-problem { margin:0.45rem 0 0; font-size:0.68rem; line-height:1.45; color:var(--sw-text-2); }

/* Visible focus everywhere (WCAG 2.2 AA, 2.4.7). */
.ce :is(textarea, input, button):focus-visible {
  outline:2px solid var(--sw-primary); outline-offset:2px;
}

@media (max-width: 640px) {
  .ce-test { display:flex; margin-right:0; }
}
</style>
