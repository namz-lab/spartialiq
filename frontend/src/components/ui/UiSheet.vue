<script setup lang="ts">
// Enterprise UI kit — Sheet. The one overlay primitive.
//
// ONE COMPONENT, THREE PRESENTATIONS (Phase 11 + Phase 20)
//   desktop  → centred dialog, sized to its content
//   mobile   → bottom sheet: full width, rounded top, thumb-reachable
//              actions, drag or flick down to dismiss
//   drawer   → edge-anchored full-height panel, for navigation and filters
//
// The caller does not choose per device. It passes `variant="auto"` (the
// default) and the sheet reads the breakpoint itself, so one call site
// produces the right thing everywhere and there is no parallel markup to
// drift apart.
//
// WHY THIS EXISTS
// The codebase had 35 hand-rolled `position: fixed` overlays across 15 files.
// Not one trapped focus, locked body scroll, restored focus on close, or
// handled Escape — so on desktop a keyboard user tabbed straight out of the
// dialog into the page behind it, and on mobile each rendered as a 480px
// centred card on a 375px screen. Consolidating fixes all of that once.
//
// ACCESSIBILITY (Phase 21, WCAG 2.2 AA)
//   role="dialog" aria-modal="true", labelled by the title
//   focus moves into the panel on open and returns to the trigger on close
//   Tab and Shift+Tab cycle within the panel
//   Escape dismisses when `dismissible`
//   the scrim is aria-hidden; the drag handle is decorative and every
//   dismiss it offers also exists as a button
import {
  computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch,
} from 'vue'
import { X } from 'lucide-vue-next'
import { useBreakpoint } from '@/composables/useBreakpoint'

type Variant = 'auto' | 'sheet' | 'dialog' | 'drawer'

const props = withDefaults(defineProps<{
  open: boolean
  /** Accessible name. Rendered as the header title unless #header is given. */
  title?: string
  /** Sub-label under the title: case reference, layer count, result count. */
  subtitle?: string
  /**
   * 'auto'   dialog on desktop, bottom sheet on mobile (default, use this)
   * 'sheet'  always a bottom sheet
   * 'dialog' always a centred dialog
   * 'drawer' always an edge panel
   */
  variant?: Variant
  /** Which edge a drawer is anchored to. */
  side?: 'left' | 'right'
  /** Max width of the dialog / drawer presentation. */
  width?: string
  /** Escape, scrim click and the close button all dismiss. */
  dismissible?: boolean
  /** Clicking the scrim dismisses. Turn off for destructive confirmations. */
  scrimClose?: boolean
  /** Bottom sheet fills the height rather than hugging its content. */
  tall?: boolean
}>(), {
  variant: 'auto',
  side: 'right',
  width: '30rem',
  dismissible: true,
  scrimClose: true,
  tall: false,
})

const emit = defineEmits<{ 'update:open': [boolean]; close: [] }>()

const { isMobile } = useBreakpoint()

/** The presentation actually rendered, after resolving 'auto'. */
const mode = computed<'sheet' | 'dialog' | 'drawer'>(() => {
  if (props.variant === 'auto') return isMobile.value ? 'sheet' : 'dialog'
  // A drawer on a phone is a bottom sheet: an edge panel on a 375px screen is
  // either almost full width, so the edge anchoring means nothing, or too
  // narrow to use.
  if (props.variant === 'drawer' && isMobile.value) return 'sheet'
  return props.variant
})

const panel = ref<HTMLElement | null>(null)
/** The element focused when the sheet opened, to restore on close. */
let returnFocusTo: HTMLElement | null = null

function close() {
  if (!props.dismissible) return
  emit('update:open', false)
  emit('close')
}

/* ── Focus management ───────────────────────────────────────────────────
   Covers everything natively focusable plus explicit tabindex, excluding
   disabled controls and anything removed from the tab order. */
const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled),' +
  ' textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'

function focusables(): HTMLElement[] {
  if (!panel.value) return []
  return Array.from(panel.value.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(el => el.offsetParent !== null || el === document.activeElement)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); close(); return }
  if (e.key !== 'Tab') return

  const items = focusables()
  if (!items.length) { e.preventDefault(); panel.value?.focus(); return }

  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement as HTMLElement | null

  // Wrap in both directions, and pull focus back in when it has escaped the
  // panel entirely — which happens if the node that had focus unmounts.
  if (e.shiftKey && (active === first || !panel.value?.contains(active))) {
    e.preventDefault(); last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault(); first.focus()
  }
}

/* ── Body scroll lock ───────────────────────────────────────────────────
   Padding compensation stops the page shifting sideways by the scrollbar
   width the instant the overlay opens, a jump the user reads as a bug.
   Mobile browsers report a scrollbar width of 0, so it is a no-op there. */
let savedOverflow = ''
let savedPaddingRight = ''

function lockScroll() {
  const body = document.body
  const gap = window.innerWidth - document.documentElement.clientWidth
  savedOverflow = body.style.overflow
  savedPaddingRight = body.style.paddingRight
  body.style.overflow = 'hidden'
  if (gap > 0) body.style.paddingRight = `${gap}px`
}

function unlockScroll() {
  document.body.style.overflow = savedOverflow
  document.body.style.paddingRight = savedPaddingRight
}

watch(() => props.open, async (isOpen) => {
  if (isOpen) {
    returnFocusTo = document.activeElement as HTMLElement | null
    lockScroll()
    await nextTick()
    // Prefer the first control; fall back to the panel, which carries
    // tabindex="-1" so a screen reader lands inside the dialog and announces
    // its label instead of staying outside it.
    ;(focusables()[0] ?? panel.value)?.focus()
  } else {
    unlockScroll()
    dragY.value = 0
    returnFocusTo?.focus?.()
    returnFocusTo = null
  }
})

onBeforeUnmount(() => { if (props.open) unlockScroll() })

/* ── Cached owners ──────────────────────────────────────────────────────
   A console keeps its sections alive so half-finished work survives a trip to
   another section. A deactivated component's own DOM goes with it — but this
   panel is teleported to <body>, and teleported content is NOT removed when
   its owner is deactivated. An open sheet therefore stayed on screen, over a
   section it had nothing to do with, with the page still scroll-locked behind
   it.

   So the sheet renders only while its owner is on screen. The open state is
   left alone: coming back to the section shows the sheet again, which is what
   keeping the section alive promised. Outside <KeepAlive> neither hook fires
   and `isActive` stays true. */
const isActive = ref(true)
onActivated(() => {
  isActive.value = true
  if (props.open) lockScroll()
})
onDeactivated(() => {
  isActive.value = false
  if (props.open) unlockScroll()
})

/** Rendered only when open AND the owning section is the one on screen. */
const visible = computed(() => props.open && isActive.value)

/* ── Drag to dismiss (bottom sheet only) ────────────────────────────────
   The native gesture on iOS and Android. Downward only: an upward drag would
   fight the sheet's own scroll container. The threshold is a third of the
   sheet's height OR a fast flick, which matches platform feel without a
   physics library.

   Pointer events rather than touch events, so stylus and trackpad work too.
   Capture is taken on the handle so a drag that leaves the element still
   delivers its move and up events. */
const dragY = ref(0)
let dragStartY = 0
let dragStartTime = 0
let dragging = false

function onDragStart(e: PointerEvent) {
  if (mode.value !== 'sheet' || !props.dismissible) return
  dragging = true
  dragStartY = e.clientY
  dragStartTime = e.timeStamp
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onDragMove(e: PointerEvent) {
  if (!dragging) return
  // Clamping at 0 makes an upward drag a no-op rather than lifting the sheet
  // off the bottom edge.
  dragY.value = Math.max(0, e.clientY - dragStartY)
}

function onDragEnd(e: PointerEvent) {
  if (!dragging) return
  dragging = false
  const height = panel.value?.offsetHeight ?? 400
  const elapsed = Math.max(1, e.timeStamp - dragStartTime)
  const velocity = dragY.value / elapsed          // px per ms
  if (dragY.value > height / 3 || velocity > 0.5) close()
  else dragY.value = 0
}

/** Applied only mid-drag: an inline transform would otherwise beat the
 *  enter/leave transition and freeze the sheet in place. */
const dragStyle = computed(() =>
  dragging && dragY.value > 0
    ? { transform: `translateY(${dragY.value}px)`, transition: 'none' }
    : undefined,
)

const labelId = `ui-sheet-title-${Math.random().toString(36).slice(2, 9)}`
</script>

<template>
  <Teleport to="body">
    <Transition :name="mode === 'sheet' ? 'ent-sheet' : mode === 'drawer' ? 'ent-drawer' : 'ent-dialog'">
      <div
        v-if="visible"
        class="us-root"
        :class="[`is-${mode}`, `side-${side}`]"
        @keydown="onKeydown"
      >
        <!-- Scrim. aria-hidden because the dialog carries the semantics; a
             screen reader must not announce a blank div. -->
        <div class="us-scrim ent-scrim" aria-hidden="true" @click="scrimClose && close()" />

        <div
          ref="panel"
          class="us-panel"
          :class="{ 'is-tall': tall }"
          :style="[mode !== 'sheet' ? { maxWidth: width } : undefined, dragStyle]"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="title ? labelId : undefined"
          :aria-label="title ? undefined : 'Dialog'"
          tabindex="-1"
        >
          <!-- Grabber. Decorative: it is the drag surface, but every dismiss
               it offers is also on the close button and Escape, so it carries
               no semantics and no tab stop. -->
          <div
            v-if="mode === 'sheet'"
            class="us-grab"
            aria-hidden="true"
            @pointerdown="onDragStart"
            @pointermove="onDragMove"
            @pointerup="onDragEnd"
            @pointercancel="onDragEnd"
          >
            <span />
          </div>

          <header v-if="title || $slots.header" class="us-head">
            <slot name="header">
              <div class="us-head-text">
                <h2 :id="labelId" class="us-title">{{ title }}</h2>
                <p v-if="subtitle" class="us-sub">{{ subtitle }}</p>
              </div>
            </slot>
            <button
              v-if="dismissible"
              type="button"
              class="us-close"
              :aria-label="`Close ${title || 'dialog'}`"
              @click="close"
            >
              <X :size="18" />
            </button>
          </header>

          <div class="us-body">
            <slot />
          </div>

          <!-- Sticky, safe-area padded: on a phone the primary action must
               stay in the thumb zone even while the body scrolls. -->
          <footer v-if="$slots.footer" class="us-foot">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Tokens: src/styles/enterprise.css + src/styles/responsive.css. */

.us-root {
  position: fixed;
  inset: 0;
  z-index: var(--ent-z-modal);
  display: flex;
  font-family: var(--ent-font);
}

.us-scrim {
  position: absolute;
  inset: 0;
  /* Ink-tinted, not neutral black: it sits over a warm cartographic map, and
     pure black greys the imagery unpleasantly. */
  background: rgba(17, 29, 45, 0.44);
  backdrop-filter: blur(1.5px);
}

.us-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--ent-surface);
  color: var(--ent-text);
  box-shadow: var(--ent-e4);
  min-height: 0;
  /* Never wider than the viewport minus the safe-area gutters. */
  max-width: calc(100% - var(--ent-safe-left) - var(--ent-safe-right));
}

/* ── Dialog: centred, content-sized, desktop ─────────────────────────── */
.is-dialog { align-items: center; justify-content: center; padding: var(--ent-s6); }
.is-dialog .us-panel {
  width: 100%;
  max-height: min(85vh, 52rem);
  border-radius: var(--ent-r-lg);
}

/* ── Drawer: edge-anchored, full height, tablet navigation and filters ── */
.is-drawer .us-panel {
  width: 100%;
  height: 100%;
  max-height: none;
  padding-top: var(--ent-safe-top);
  padding-bottom: var(--ent-safe-bottom);
}
.is-drawer.side-right { justify-content: flex-end; }
.is-drawer.side-right .us-panel { border-left: 1px solid var(--ent-line-strong); }
.is-drawer.side-left  .us-panel { border-right: 1px solid var(--ent-line-strong); }

/* ── Sheet: bottom-anchored, full width, mobile ──────────────────────── */
.is-sheet { align-items: flex-end; }
.is-sheet .us-panel {
  width: 100%;
  max-width: 100%;
  /* Leaves a strip of the page visible above the sheet, which is what tells
     the user this is a layer over their context, not a new screen. */
  max-height: 92dvh;
  border-radius: var(--ent-sheet-radius) var(--ent-sheet-radius) 0 0;
  will-change: transform;
}
.is-sheet .us-panel.is-tall { height: 92dvh; }

.us-grab {
  display: flex;
  justify-content: center;
  padding: 10px 0 2px;
  cursor: grab;
  touch-action: none;   /* the browser must not also scroll while we drag */
}
.us-grab:active { cursor: grabbing; }
.us-grab > span {
  width: 36px;
  height: 4px;
  border-radius: var(--ent-r-pill);
  background: var(--ent-line-strong);
}

/* ── Header ───────────────────────────────────────────────────────────── */
.us-head {
  display: flex;
  align-items: flex-start;
  gap: var(--ent-s3);
  padding: var(--ent-s4) var(--ent-s5);
  border-bottom: 1px solid var(--ent-line);
  flex-shrink: 0;
}
.is-sheet .us-head { padding-top: var(--ent-s2); }
.us-head-text { flex: 1; min-width: 0; }
.us-title {
  margin: 0;
  font-size: var(--ent-fs-lg);
  font-weight: var(--ent-fw-semibold);
  line-height: var(--ent-lh-tight);
  color: var(--ent-text);
}
.us-sub {
  margin: 2px 0 0;
  font-size: var(--ent-fs-xs);
  color: var(--ent-text-3);
  line-height: var(--ent-lh);
}

.us-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: var(--ent-control-h);
  height: var(--ent-control-h);
  margin: -4px -6px -4px 0;
  border: none;
  border-radius: var(--ent-r);
  background: transparent;
  color: var(--ent-text-3);
  cursor: pointer;
}
.us-close:hover { background: var(--ent-surface-2); color: var(--ent-text); }
.us-close:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }

/* ── Body ─────────────────────────────────────────────────────────────── */
.us-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* Stops a scroll that reaches the end of the sheet from scrolling the page
     behind it — the chaining that makes mobile overlays feel broken. */
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: var(--ent-s5);
}
/* A sheet with no footer still must not run its last row under the home
   indicator. */
.is-sheet .us-body:last-child {
  padding-bottom: calc(var(--ent-s5) + var(--ent-safe-bottom));
}

/* ── Footer ───────────────────────────────────────────────────────────── */
.us-foot {
  display: flex;
  gap: var(--ent-s3);
  justify-content: flex-end;
  padding: var(--ent-s4) var(--ent-s5);
  border-top: 1px solid var(--ent-line);
  background: var(--ent-surface);
  flex-shrink: 0;
}
.is-sheet .us-foot {
  padding-bottom: calc(var(--ent-s4) + var(--ent-safe-bottom));
}
/* On a phone the actions go full width and stack primary-last-in-DOM-first-
   on-screen, so the thumb lands on the confirming action without aiming. */
@media (max-width: 767px) {
  .is-sheet .us-foot { flex-direction: column-reverse; }
  .is-sheet .us-foot > * { width: 100%; }
}

/* ── Motion ───────────────────────────────────────────────────────────────
   Emil Kowalski's frequency gate: officers open these dozens of times a
   shift, so transitions are short and carry no character. The scrim fades;
   the surface moves the shortest distance that reads as arrival.
   prefers-reduced-motion strips the transform in responsive.css, leaving a
   plain fade — the accessible equivalent, not a degraded one. */

.ent-sheet-enter-active .us-panel,
.ent-sheet-leave-active .us-panel {
  transition: transform var(--ent-dur-sheet) var(--ent-ease-sheet);
}
.ent-sheet-enter-from .us-panel,
.ent-sheet-leave-to .us-panel { transform: translateY(100%); }

.ent-drawer-enter-active .us-panel,
.ent-drawer-leave-active .us-panel {
  transition: transform var(--ent-dur-lg) var(--ent-ease-sheet);
}
.side-right.ent-drawer-enter-from .us-panel,
.side-right.ent-drawer-leave-to .us-panel { transform: translateX(100%); }
.side-left.ent-drawer-enter-from .us-panel,
.side-left.ent-drawer-leave-to .us-panel { transform: translateX(-100%); }

/* Dialogs scale rather than travel: a centred surface that slides has no
   edge to have come from. */
.ent-dialog-enter-active .us-panel,
.ent-dialog-leave-active .us-panel {
  transition: transform 180ms var(--ent-ease-out-quint), opacity 180ms var(--ent-ease-out-quint);
}
.ent-dialog-enter-from .us-panel,
.ent-dialog-leave-to .us-panel { transform: scale(0.97); opacity: 0; }

.ent-sheet-enter-active .us-scrim,
.ent-sheet-leave-active .us-scrim,
.ent-drawer-enter-active .us-scrim,
.ent-drawer-leave-active .us-scrim,
.ent-dialog-enter-active .us-scrim,
.ent-dialog-leave-active .us-scrim {
  transition: opacity var(--ent-dur-lg) var(--ent-ease);
}
.ent-sheet-enter-from .us-scrim,  .ent-sheet-leave-to .us-scrim,
.ent-drawer-enter-from .us-scrim, .ent-drawer-leave-to .us-scrim,
.ent-dialog-enter-from .us-scrim, .ent-dialog-leave-to .us-scrim { opacity: 0; }
</style>
