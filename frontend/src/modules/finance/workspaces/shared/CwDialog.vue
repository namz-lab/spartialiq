<script setup lang="ts">
/**
 * The workspace's one modal dialog (audit B10). It owns what every dialog must do the same way:
 *
 * - `role` dialog, or alertdialog for a destructive confirmation; `aria-modal`;
 * - named by its own visible heading (`aria-labelledby`), described by the `describe` slot;
 * - focus in: the element marked `data-autofocus`, else the first field of the body, else the first
 *   control; Tab and Shift+Tab stay inside;
 * - Esc and a click on the backdrop close it, except while `busy`: a save in flight is not abandoned;
 * - `aria-busy` while busy;
 * - on close, focus goes back to the opener (the `opener` prop, else what had focus when it opened),
 *   or to the page (`#cw-main`) when the opener has gone. Only when focus was still in the dialog:
 *   a host that has moved focus on purpose (to a new row, a notice) is left alone.
 *
 * The footer is the host's: busy buttons there use `aria-disabled` and a guard in the handler, never
 * `disabled`, which would drop the focus of the button just pressed.
 */
import { nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, useId, useSlots } from 'vue'

const props = withDefaults(defineProps<{
  title: string
  role?: 'dialog' | 'alertdialog'
  busy?: boolean
  /** The control that opened the dialog; defaults to whatever had focus when it mounted. */
  opener?: HTMLElement | null
  wide?: boolean
  /** Render the panel as a <form>; its submit is emitted as `submit`. */
  form?: boolean
  /** A click on the backdrop closes it. Off by default for a form (a half-filled one is not thrown away by a stray click). */
  backdropClose?: boolean
}>(), { role: 'dialog', busy: false, opener: null, wide: false, form: false, backdropClose: undefined })
const emit = defineEmits<{ (e: 'close'): void; (e: 'submit'): void }>()
const slots = useSlots()

const uid = useId()
const titleId = `cwd-${uid}-title`
const descId = `cwd-${uid}-desc`
const panel = ref<HTMLElement | null>(null)

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(', ')
const FIELDS = '.cw-dialog-body input:not([disabled]):not([type="hidden"]), .cw-dialog-body select:not([disabled]), .cw-dialog-body textarea:not([disabled])'

/**
 * Is `node` inside this panel? Matched by the panel's own title id rather than by identity: under
 * happy-dom a <form>'s descendants report a parent that is not `===` the form element.
 */
function within(node: Node | null): boolean {
  return node instanceof Element && node.closest(`[aria-labelledby="${titleId}"]`) !== null
}
/** A control that is hidden (the `hidden` attribute, display:none or visibility:hidden on it or an ancestor inside the panel) cannot take focus, so Tab must not count it. */
function visible(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n && n !== panel.value; n = n.parentElement) {
    if (n.hidden || n.hasAttribute('inert')) return false
    const st = getComputedStyle(n)
    if (st.display === 'none' || st.visibility === 'hidden') return false
  }
  return true
}
function focusables(): HTMLElement[] {
  return [...(panel.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(visible)
}

let back: HTMLElement | null = null
let restore = false

onMounted(async () => {
  const had = document.activeElement
  back = props.opener ?? (had instanceof HTMLElement && had !== document.body ? had : null)
  await nextTick()
  const p = panel.value
  if (!p) return
  const target = p.querySelector<HTMLElement>('[data-autofocus]') ?? [...p.querySelectorAll<HTMLElement>(FIELDS)].find(visible) ?? focusables()[0] ?? p
  target.focus()
  lockPage()
})

/**
 * P13: while the dialog is open the page behind it does not scroll and is `inert` (not focusable, not read).
 * The siblings of the dialog's own mount point are marked, and restored on close; only those that were not
 * already inert, so a second dialog never un-inerts what the first one set.
 */
const inerted: HTMLElement[] = []
let scrollWas = ''
function lockPage(): void {
  const root = panel.value?.closest('.cw-dialog-backdrop') as HTMLElement | null
  if (!root) return
  scrollWas = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  for (let n: HTMLElement | null = root; n && n !== document.body; n = n.parentElement) {
    for (const sib of Array.from(n.parentElement?.children ?? []) as HTMLElement[]) {
      if (sib === n || sib.hasAttribute('inert') || sib.tagName === 'SCRIPT') continue
      sib.setAttribute('inert', '')
      inerted.push(sib)
    }
  }
}
function unlockPage(): void {
  document.body.style.overflow = scrollWas
  for (const el of inerted.splice(0)) el.removeAttribute('inert')
}

onBeforeUnmount(() => {
  unlockPage()
  const at = document.activeElement
  restore = !at || at === document.body || within(at)
})
onUnmounted(() => {
  if (!restore) return
  const target = back?.isConnected ? back : document.getElementById('cw-main')
  target?.focus()
  back = null
})

function requestClose(): void {
  if (props.busy) return
  emit('close')
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    requestClose()
    return
  }
  if (e.key !== 'Tab') return
  const items = focusables()
  if (!items.length) { e.preventDefault(); return }
  const first = items[0], last = items[items.length - 1]
  const at = document.activeElement
  const inside = !!at && items.includes(at as HTMLElement)
  if (e.shiftKey && (at === first || !inside)) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && (at === last || !inside)) { e.preventDefault(); first.focus() }
}
</script>

<template>
  <div class="cw-dialog-backdrop" @click.self="(backdropClose ?? !form) ? requestClose() : undefined">
    <component
      :is="form ? 'form' : 'div'" ref="panel" class="cw-dialog" :class="{ 'cw-dialog--wide': wide }" :role="role" aria-modal="true"
      :aria-labelledby="titleId" :aria-describedby="slots.describe ? descId : undefined" :aria-busy="busy ? 'true' : undefined" tabindex="-1"
      @keydown="onKeydown" @submit.prevent="emit('submit')"
    >
      <header><h3 :id="titleId">{{ title }}</h3><slot name="header" /></header>
      <div class="cw-dialog-body">
        <div v-if="slots.describe" :id="descId" class="cwd-describe"><slot name="describe" /></div>
        <slot />
      </div>
      <footer><slot name="footer" /></footer>
    </component>
  </div>
</template>

<style scoped>
.cwd-describe { display: flex; flex-direction: column; gap: 10px; }
.cwd-describe :deep(p) { margin: 0; }
.cw-dialog:focus { outline: none; }
</style>
