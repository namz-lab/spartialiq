<script setup lang="ts">
/**
 * The finance console's prompt dialog — the replacement for every `window.prompt` this module
 * used to open when a financial act needed a reason, an amount or a choice.
 *
 * It is a thin form on top of the shared `UiSheet` overlay, which already traps focus, locks body
 * scroll, restores focus to the trigger on close and renders as a bottom sheet on a phone. What
 * this component adds is the part `window.prompt` could never do:
 *
 *   - the answer is validated BEFORE the promise resolves, so a reason the server would refuse is
 *     refused here, in the field, with the rule stated next to it;
 *   - an amount field accepts exactly the decimal string the money formatter accepts — no number,
 *     no thousands separator, no comma;
 *   - a choice is a labelled select, never "type the number of the line you want";
 *   - the confirming button disables while invalid, so a financial mutation cannot be sent empty
 *     or malformed by accident.
 *
 * The controller prop is the section's `useFinancePrompt()` object. The component resolves the
 * pending request and clears it in one place, so no section has to wire an event handler, and the
 * dialog can never stay open over a promise nobody is holding.
 *
 * Escape and Cancel resolve `null` — the `window.prompt` contract, so call sites keep their
 * existing early returns. The scrim does not close on click: a stray click should not throw away a
 * half-typed reason that is about to go on the record.
 */
import { computed, ref, watch } from 'vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import { isValidAmount, type useFinancePrompt } from '../composables/useFinancePrompt'

const props = defineProps<{
  /** The value returned by `useFinancePrompt()` in the owning section. */
  controller: ReturnType<typeof useFinancePrompt>
}>()

const value = ref('')
/** Validation is quiet until the user tries to submit. After that it corrects live. */
const showInvalid = ref(false)

const request = computed(() => props.controller.request.value)
const open = computed(() => request.value !== null)
const kind = computed(() => request.value?.kind ?? 'text')

const trimmed = computed(() => value.value.trim())

const invalidReason = computed<string | null>(() => {
  const r = request.value
  if (!r) return null
  if (kind.value === 'amount') {
    if (trimmed.value === '') return 'Enter an amount.'
    if (!isValidAmount(value.value, r.allowNegative ?? true)) {
      return 'A plain decimal figure, like 25000.00 or -5000.00 — no separators or symbols.'
    }
    return null
  }
  if (kind.value === 'select') {
    const ok = (r.options ?? []).some((o) => o.value === value.value)
    return ok ? null : 'Choose one of the options.'
  }
  const min = r.minLength ?? 0
  if (min > 0 && trimmed.value.length < min) {
    return `At least ${min} characters — this goes on the record.`
  }
  return null
})

const canSubmit = computed(() => invalidReason.value === null)

/** A request arriving (or changing while open) re-seeds the field and hides the last error. */
watch(request, (r) => {
  if (r) {
    value.value = r.initial ?? ''
    showInvalid.value = false
  }
})

function submit(): void {
  if (!canSubmit.value) {
    showInvalid.value = true
    return
  }
  props.controller.settle(trimmed.value)
}

function cancel(): void {
  props.controller.settle(null)
}
</script>

<template>
  <UiSheet
    :open="open"
    :title="request?.title"
    :subtitle="request?.message"
    variant="dialog"
    width="30rem"
    :scrim-close="false"
    @close="cancel"
  >
    <form class="fpq-body" @submit.prevent="submit">
      <template v-if="kind === 'select'">
        <label class="ins-label" for="fpq-field">{{ request?.label }}</label>
        <select
          id="fpq-field"
          v-model="value"
          class="ins-input"
          :aria-invalid="showInvalid && invalidReason ? 'true' : undefined"
          aria-describedby="fpq-rule"
        >
          <option value="" disabled>{{ request?.placeholder ?? 'Choose…' }}</option>
          <option v-for="o in request?.options ?? []" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </template>

      <template v-else>
        <label class="ins-label" for="fpq-field">{{ request?.label }}</label>
        <textarea
          v-if="kind === 'textarea'"
          id="fpq-field"
          v-model="value"
          class="ins-input"
          rows="4"
          :placeholder="request?.placeholder"
          :aria-invalid="showInvalid && invalidReason ? 'true' : undefined"
          aria-describedby="fpq-rule"
        />
        <input
          v-else
          id="fpq-field"
          v-model="value"
          class="ins-input"
          type="text"
          :inputmode="kind === 'amount' ? 'decimal' : undefined"
          :placeholder="request?.placeholder ?? (kind === 'amount' ? '25000.00' : undefined)"
          :aria-invalid="showInvalid && invalidReason ? 'true' : undefined"
          aria-describedby="fpq-rule"
        >
      </template>

      <!-- The rule sits under the field whether or not it is currently broken, so the requirement
           is read before the mistake, not only after it. -->
      <p id="fpq-rule" class="ins-hint" :class="{ 'is-error': showInvalid && invalidReason }">
        <template v-if="showInvalid && invalidReason">{{ invalidReason }}</template>
        <template v-else-if="request?.minLength">
          {{ request.minLength }} characters minimum — kept on the record.
        </template>
        <template v-else-if="kind === 'amount'">
          A plain decimal figure in the line's own currency.{{ request?.allowNegative === false ? '' : ' A negative figure is a reduction.' }}
        </template>
      </p>
    </form>

    <template #footer>
      <button type="button" class="fin-btn" @click="cancel">Cancel</button>
      <button
        type="button"
        class="fin-btn primary"
        :class="{ danger: request?.danger }"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ request?.submitLabel ?? 'Confirm' }}
      </button>
    </template>
  </UiSheet>
</template>

<style scoped>
.fpq-body { display: flex; flex-direction: column; gap: var(--ent-s2); }
.fpq-body .ins-hint.is-error { color: var(--ent-negative-text, #b3261e); }
</style>
