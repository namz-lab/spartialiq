<script setup lang="ts">
/**
 * The shared combobox behind AccountPicker and PartyPicker: a text box and a listbox, used by
 * keyboard. Arrows move, Enter chooses, Escape closes and keeps the previous value; leaving the box
 * puts the chosen value's text back. Matching and ranking belong to the caller (`search`).
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

export interface PickOption { id: string; text: string; sub?: string }

const props = defineProps<{
  modelValue: string
  label: string
  /** Options for what has been typed, already ranked and capped. */
  search: (query: string) => PickOption[]
  /** The text shown for the chosen id. */
  textFor: (id: string) => string
  placeholder?: string
  disabled?: boolean
  describedby?: string
  invalid?: boolean
}>()
const emit = defineEmits<{ (e: 'update:modelValue', id: string): void }>()

let serial = 0
const uid = `cp${++serial}-${Math.random().toString(36).slice(2, 7)}`
const open = ref(false)
const query = ref(props.textFor(props.modelValue))
const active = ref(-1)
const options = computed(() => (open.value ? props.search(query.value) : []))

watch(() => props.modelValue, v => { if (!open.value) query.value = props.textFor(v) })

const inputEl = ref<HTMLInputElement | null>(null)
/**
 * S5: the list is fixed-positioned from the input's rectangle, so a table wrap's overflow cannot clip it,
 * and it opens upward when there is less than 260px below.
 */
const listStyle = ref<Record<string, string>>({})
function place() {
  const el = inputEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const below = window.innerHeight - r.bottom
  const up = below < 260 && r.top > below
  listStyle.value = {
    position: 'fixed', left: `${r.left}px`, width: `${r.width}px`, right: 'auto',
    ...(up ? { bottom: `${window.innerHeight - r.top + 2}px`, top: 'auto', maxHeight: `${Math.min(260, r.top - 8)}px` }
      : { top: `${r.bottom + 2}px`, bottom: 'auto', maxHeight: `${Math.max(120, Math.min(260, below - 8))}px` }),
  }
}
function track(on: boolean) {
  const f = on ? window.addEventListener : window.removeEventListener
  f.call(window, 'scroll', place, true)
  f.call(window, 'resize', place)
}
watch(open, (o) => { if (o) place(); track(o) })
onBeforeUnmount(() => track(false))
function show() { open.value = true }
function restore() { open.value = false; active.value = -1; query.value = props.textFor(props.modelValue) }
function choose(o: PickOption) {
  emit('update:modelValue', o.id)
  query.value = o.text
  open.value = false
  active.value = -1
}
function onInput(e: Event) {
  query.value = (e.target as HTMLInputElement).value
  active.value = -1
  show()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (!open.value) { show(); return }
    if (options.value.length) active.value = (active.value + 1) % options.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (!open.value) { show(); return }
    if (options.value.length) active.value = active.value <= 0 ? options.value.length - 1 : active.value - 1
  } else if (e.key === 'Enter') {
    if (open.value && active.value >= 0 && options.value[active.value]) {
      e.preventDefault()
      choose(options.value[active.value])
    }
  } else if (e.key === 'Escape') {
    if (open.value) { e.preventDefault(); e.stopPropagation(); restore() }
  }
}
const optionId = (i: number) => `${uid}-opt-${i}`
</script>

<template>
  <div class="cw-field kp">
    <label class="cw-label" :for="`${uid}-input`">{{ label }}</label>
    <div class="kp-wrap">
      <input
        :id="`${uid}-input`" class="cw-input" type="text" autocomplete="off" spellcheck="false"
        ref="inputEl" role="combobox" aria-autocomplete="list" :aria-describedby="describedby" :aria-invalid="invalid ? 'true' : undefined"
        :aria-expanded="open ? 'true' : 'false'" :aria-controls="`${uid}-list`"
        :aria-activedescendant="open && active >= 0 ? optionId(active) : undefined"
        :placeholder="placeholder" :disabled="disabled" :value="query"
        @input="onInput" @focus="show" @keydown="onKey" @blur="restore"
      />
      <ul v-show="open" :id="`${uid}-list`" class="kp-list" :style="listStyle" role="listbox" :aria-label="label">
        <li
          v-for="(o, i) in options" :id="optionId(i)" :key="o.id" role="option"
          :aria-selected="i === active ? 'true' : 'false'" class="kp-opt" :class="{ 'is-active': i === active }"
          @mousedown.prevent @click="choose(o)" @mousemove="active = i"
        >
          <span>{{ o.text }}</span><small v-if="o.sub">{{ o.sub }}</small>
        </li>
        <li v-if="open && !options.length" class="kp-none" role="presentation">Nothing matches.</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.kp-wrap { position: relative; }
.kp-list {
  position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 2px); margin: 0; padding: 4px; list-style: none;
  max-height: 260px; overflow-y: auto; background: var(--cw-surface); border: 1px solid var(--cw-line-2);
  border-radius: var(--cw-r-sm); box-shadow: var(--cw-shadow);
}
.kp-opt { display: flex; justify-content: space-between; gap: 12px; padding: 7px 10px; border-radius: 6px; font-size: 14px; cursor: pointer; color: var(--cw-ink); }
.kp-opt small { color: var(--cw-ink-3); font-size: 12.5px; white-space: nowrap; }
/* The option Enter will pick: an inset outline (6.8:1 on the tint, kept in forced colours), not the tint alone (1.15:1). */
.kp-opt.is-active { background: var(--cw-accent-soft); color: var(--cw-accent-ink); outline: 2px solid var(--cw-accent); outline-offset: -2px; font-weight: 600; }
.kp-none { padding: 8px 10px; font-size: 13.5px; color: var(--cw-ink-2); }
</style>
