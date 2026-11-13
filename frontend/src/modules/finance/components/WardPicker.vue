<script setup lang="ts">
/**
 * The ward field, everywhere a ward is written or filtered (audit GAP-10).
 *
 * It replaces a 24-character free-text box that silently turned a typo into an `unlinked` ward the
 * choropleth could not shade. What it does NOT do is make the field a foreign key: the database
 * keeps `ward_code` as text deliberately, so an imported or legacy code must stay recordable and
 * stay visible. The picker therefore offers the register, keeps an unregistered code as a flagged
 * option, and always allows the code to be typed.
 *
 * Decision D11 is open. The 19 wards loaded by migration 201 carry basis `interim`, so the control
 * labels the list PROVISIONAL. The label is not decoration: a surface that presents an unconfirmed
 * ward list as settled would let a committee paper cite a boundary the Council has not resolved.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { Info, Keyboard, List } from 'lucide-vue-next'
import { useWardRegister, wardCodeStatus, wardOptionsWith } from '../composables/useWardRegister'

const props = withDefaults(defineProps<{
  modelValue: string
  id?: string
  /** A filter field may be cleared to "every ward"; a record field says "no ward recorded". */
  emptyLabel?: string
  /** Filters do not need the explanatory hints a record field carries. */
  compact?: boolean
  disabled?: boolean
}>(), {
  id: undefined,
  emptyLabel: 'No ward recorded',
  compact: false,
  disabled: false,
})

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const register = useWardRegister()
/** Typing a code stays available: an officer reading a code off an instrument may not find it listed. */
const typing = ref(false)
/**
 * Whether the officer asked for the text box.
 *
 * Without this the control was stuck in text mode: the register has not loaded on first paint, so
 * `registerEmpty` is briefly true, and the watcher that switches to typing for an empty register
 * never switched back when the 19 wards arrived. A register that loads late must still produce a
 * picker — but a deliberate choice to type must not be undone underneath the officer.
 */
const chosenManually = ref(false)

onMounted(() => { void register.load() })

const options = computed(() => wardOptionsWith(register.wards.value, props.modelValue))
const status = computed(() =>
  wardCodeStatus(props.modelValue, register.wards.value, register.linked.value))
const registerEmpty = computed(() =>
  register.linked.value === false || register.wards.value.length === 0)

// An unregistered code is not an error to be corrected away; it is a fact about the record, and the
// officer is told what it means for the map rather than being stopped.
const unlinked = computed(() => status.value === 'unlinked')

watch(registerEmpty, (empty) => {
  if (empty) typing.value = true
  else if (!chosenManually.value) typing.value = false
}, { immediate: true })

function toggleTyping(): void {
  typing.value = !typing.value
  chosenManually.value = true
}

function set(value: string): void {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="ward-picker">
    <select v-if="!typing && !registerEmpty" :id="id" class="ins-input"
            :disabled="disabled"
            :value="modelValue"
            :aria-describedby="id ? `${id}-note` : undefined"
            @change="set(($event.target as HTMLSelectElement).value)">
      <option value="">{{ emptyLabel }}</option>
      <option v-for="w in options" :key="w.code" :value="w.code">
        {{ w.name ? `${w.code} — ${w.name}` : w.code
        }}{{ w.inRegister ? '' : ' (not in the register)' }}
      </option>
    </select>

    <input v-else :id="id" class="ins-input" type="text" maxlength="64"
           :disabled="disabled"
           :value="modelValue"
           :aria-describedby="id ? `${id}-note` : undefined"
           placeholder="Ward code"
           @input="set(($event.target as HTMLInputElement).value)" />

    <div class="ward-picker-tools">
      <button v-if="!registerEmpty" type="button" class="ward-picker-switch"
              @click="toggleTyping">
        <component :is="typing ? List : Keyboard" :size="12" aria-hidden="true" />
        {{ typing ? 'Choose from the register' : 'Type a code instead' }}
      </button>
    </div>

    <p v-if="!compact || unlinked || registerEmpty" :id="id ? `${id}-note` : undefined"
       class="ins-hint ward-picker-note">
      <template v-if="registerEmpty">
        <Info :size="12" aria-hidden="true" />
        The council's ward register is not linked yet (decision D11), so a code is recorded but
        cannot be checked against a list.
      </template>
      <template v-else-if="unlinked">
        <Info :size="12" aria-hidden="true" />
        <strong>{{ modelValue }}</strong> is not one of this council's registered wards. It is kept
        as recorded — nothing is dropped — and the ward map reports it as <em>unlinked</em> rather
        than shading it.
      </template>
      <template v-else-if="register.provisional.value">
        <Info :size="12" aria-hidden="true" />
        Ward list is <strong>provisional</strong>: loaded as interim reference data pending a
        Council resolution (decision D11).
      </template>
      <template v-else-if="!register.basesKnown.value">
        <Info :size="12" aria-hidden="true" />
        The council's wards as currently linked. How the list was established could not be read, so
        it is not described as confirmed.
      </template>
      <template v-else>The council's registered wards.</template>
    </p>

    <p v-if="register.error.value" class="ins-hint ward-picker-note">
      {{ register.error.value }} The field still accepts a typed code.
    </p>
  </div>
</template>

<style scoped>
.ward-picker { display: flex; flex-direction: column; gap: 3px; }
.ward-picker-tools { display: flex; justify-content: flex-start; }
.ward-picker-switch {
  border: 0; background: none; padding: 0; font: inherit; font-size: 11.5px;
  color: var(--ent-accent); cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
}
.ward-picker-switch:focus-visible { outline: var(--ent-focus-ring); outline-offset: 2px; }
.ward-picker-note { display: flex; align-items: flex-start; gap: 4px; margin: 0; }
</style>
