<script lang="ts">
/**
 * THIS BLOCK EXISTS SO THE COUNTER IS MODULE STATE.
 *
 * It used to live in `<script setup>` below, which was the bug: everything
 * declared at the top level of `<script setup>` is compiled INTO the setup()
 * function, so `let seq = 0` was re-initialised for every instance and
 * `++seq` was always 1. Every field on every auth form rendered
 * `id="auth-f1"` — duplicate ids, so each `<label for>` pointed at the email
 * box and each `aria-describedby` resolved to the first field's error. On
 * the sign-in form that meant a screen-reader user tabbing to the password
 * field was read the email field's error message.
 *
 * Vue 3.5's `useId()` is the proper answer and is what is installed, but
 * package.json still declares `^3.3.8`, where it does not exist. A plain
 * `<script>` block is the fix that cannot break on a resolved 3.3.
 */
let seq = 0
export function nextFieldId(): string {
  return `auth-f${++seq}`
}
</script>

<script setup lang="ts">
/**
 * One labelled field, wired for assistive technology the way the five auth
 * forms all need and none of them had: the hint and the error are both
 * referenced from aria-describedby, the input carries aria-invalid, and a
 * password field gets a reveal button that announces its own state.
 *
 * The error is NOT role="alert". Submitting a nine-field form with six
 * mistakes would fire six alerts over each other; the form owns one live
 * region and one error summary instead (see RegisterView), and the text here
 * is reached through aria-describedby when focus lands on the field.
 */
import { computed, ref } from 'vue'
import { AlertCircle, Eye, EyeOff } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  label: string
  /** 'select' renders a <select> and takes its <option>s from the default slot. */
  as?: 'input' | 'select'
  type?: string
  hint?: string
  error?: string
  /** Shown beside the label. Everything else is assumed required. */
  optional?: boolean
  placeholder?: string
  autocomplete?: string
  inputmode?: 'text' | 'email' | 'tel' | 'numeric' | 'none'
  disabled?: boolean
  required?: boolean
  maxlength?: number
  autofocus?: boolean
  spellcheck?: boolean
}>(), {
  as: 'input',
  type: 'text',
  required: true,
  spellcheck: false,
})

const model = defineModel<string>({ default: '' })
// A select emits `blur` on change as well. There is nothing to "finish
// typing" in a dropdown — choosing IS the commit — and waiting for blur left
// a stale "choose an option" error under a field that had been answered.
const emit = defineEmits<{ blur: [] }>()

const uid = nextFieldId()
const fieldId = computed(() => uid)
const hintId = computed(() => `${fieldId.value}-hint`)
const errorId = computed(() => `${fieldId.value}-error`)

const describedBy = computed(() => {
  const ids = []
  if (props.hint) ids.push(hintId.value)
  if (props.error) ids.push(errorId.value)
  return ids.length ? ids.join(' ') : undefined
})

const isPassword = computed(() => props.type === 'password')
const revealed = ref(false)
// A revealed password becomes a text input, which browsers offer to save and
// autofill as a username. type stays 'password' in the DOM contract the
// password manager reads by keeping autocomplete intact.
const renderedType = computed(() => (isPassword.value && revealed.value ? 'text' : props.type))

const el = ref<HTMLInputElement | HTMLSelectElement | null>(null)
/** Lets a form move focus to the first field that failed. */
defineExpose({ focus: () => el.value?.focus() })
</script>

<template>
  <div class="auth-field">
    <div class="auth-label-row">
      <label class="auth-label" :for="fieldId">
        {{ label }}<span v-if="optional" class="auth-optional"> (optional)</span>
      </label>
      <slot name="label-aside" />
    </div>

    <select
      v-if="as === 'select'"
      :id="fieldId"
      ref="el"
      v-model="model"
      class="auth-select"
      :required="required"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      @blur="emit('blur')"
      @change="emit('blur')"
    >
      <slot />
    </select>

    <div v-else class="auth-input-wrap">
      <input
        :id="fieldId"
        ref="el"
        v-model="model"
        class="auth-input"
        :type="renderedType"
        :placeholder="placeholder"
        :autocomplete="autocomplete"
        :inputmode="inputmode"
        :required="required"
        :disabled="disabled"
        :maxlength="maxlength"
        :spellcheck="spellcheck"
        :autofocus="autofocus"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        @blur="emit('blur')"
      />
      <button
        v-if="isPassword"
        type="button"
        class="auth-reveal"
        :aria-label="revealed ? 'Hide password' : 'Show password'"
        :aria-pressed="revealed"
        tabindex="0"
        @click="revealed = !revealed"
      >
        <component :is="revealed ? EyeOff : Eye" :size="17" aria-hidden="true" />
      </button>
    </div>

    <p v-if="hint" :id="hintId" class="auth-hint">{{ hint }}</p>
    <p v-if="error" :id="errorId" class="auth-field-error">
      <AlertCircle :size="13" aria-hidden="true" />
      <span>{{ error }}</span>
    </p>
  </div>
</template>
