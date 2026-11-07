/**
 * Scroll-reveal and count-up motion for the PUBLIC pages.
 *
 * SCOPE — this is deliberately not available to the signed-in consoles.
 * DESIGN.md holds the workspaces to 150–240ms fades because an inspector
 * standing in a plot in Maboleni wants the checklist, not a performance.
 * The public pages are a different job: they are the council's front door and
 * they have to look like a government that has its act together. So the
 * ambition lives here, behind one import, and does not leak into the app.
 *
 * WHY A DIRECTIVE AND NOT A LIBRARY
 * The whole mechanism is: add a class when the element first crosses into
 * view, and let CSS do the rest (see `public-pages.css`, "MOTION LAYER").
 * That is one shared IntersectionObserver and a class name. GSAP is already
 * a dependency and could do it, but GSAP animates from JavaScript, which
 * means every revealed element holds an inline transform and a running
 * tween; forty of those on one page is how a landing page ends up janky on
 * the mid-range Android phones most of this district browses on.
 *
 * REDUCED MOTION IS A HARD GATE, NOT A DIMMER.
 * When the OS asks for reduced motion nothing is observed, nothing is
 * deferred, and every element is marked revealed at mount. A person who has
 * turned motion off must never be left looking at content that is invisible
 * until it animates in — that is the failure mode that makes scroll-reveal
 * an accessibility problem rather than a flourish.
 */
import type { Directive, DirectiveBinding } from 'vue'
import { ref, onMounted, onUnmounted, watch, type Ref } from 'vue'

/**
 * Local copy rather than the one in `map/vunguBasemap.ts`: that module
 * imports maplibre-gl, and importing it here would put the whole map engine
 * in the bundle of every public page that merely wants to fade a heading in.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const REVEALED = 'is-revealed'

// One observer for the whole document. Forty elements each with their own
// IntersectionObserver is forty callbacks the browser has to schedule.
let sharedObserver: IntersectionObserver | null = null

// ── Failsafe ───────────────────────────────────────────────────────────
// `.reveal` starts at opacity 0, so anything the observer never reports on
// stays invisible for ever. That is not a theoretical worry: an observer
// whose callback is starved on a slow device, a headless renderer that
// rasterises the whole page without scrolling it (which is what a crawler
// and a screenshot tool both do), and any future bug in the wiring all land
// in the same place — a council page that is blank below the hero.
//
// So: every element the directive observes is also tracked here, and a
// sweep shortly after mount reveals anything already at or above the fold
// that the observer has not accounted for. Elements genuinely below the
// fold stay observed and still animate on scroll.
const pending = new Set<HTMLElement>()
let sweepTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSweep() {
  if (sweepTimer || typeof window === 'undefined') return
  sweepTimer = setTimeout(() => {
    sweepTimer = null
    const fold = window.innerHeight || 0
    for (const el of Array.from(pending)) {
      if (!el.isConnected) { pending.delete(el); continue }
      if (el.classList.contains(REVEALED)) { pending.delete(el); continue }
      if (el.getBoundingClientRect().top < fold) {
        el.classList.add(REVEALED)
        sharedObserver?.unobserve(el)
        pending.delete(el)
      }
    }
  }, 1200)
}

function observer(): IntersectionObserver | null {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return null
  if (sharedObserver) return sharedObserver
  sharedObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add(REVEALED)
        pending.delete(entry.target as HTMLElement)
        // Reveal is a one-way door: content that fades back out as you
        // scroll up is a party trick that makes a long page feel unstable.
        sharedObserver?.unobserve(entry.target)
      }
    },
    {
      threshold: 0.12,
      // The top margin is enormous on purpose. It extends the observer's
      // root upward without limit, so anything ABOVE the viewport counts as
      // intersecting and is revealed at once.
      //
      // Without it, an element that was never scrolled THROUGH is never
      // reported, and there are four ordinary ways that happens: an in-page
      // anchor (this page has one), a browser restoring the scroll position
      // on reload, End/Ctrl-End, and a deep link to a fragment. Each of
      // those left whole sections of the council's front page permanently
      // blank — the reader arrived below them and they had missed their cue.
      //
      // The bottom margin is the opposite and is presentational: pull the
      // root up 8% so the motion is finishing as the element arrives rather
      // than starting once it has already been read.
      rootMargin: '100000px 0px -8% 0px',
    },
  )
  return sharedObserver
}

function delayFrom(binding: DirectiveBinding<number | undefined>): number {
  const raw = Number(binding.value)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

/**
 * `v-reveal` — fade+rise into view. `v-reveal="120"` delays 120ms.
 * Modifiers pick the direction: `.up` (default), `.down`, `.left`, `.right`,
 * `.scale`, `.blur`, `.clip`.
 */
export const vReveal: Directive<HTMLElement, number | undefined> = {
  mounted(el, binding) {
    if (prefersReducedMotion()) {
      el.classList.add(REVEALED)
      return
    }
    el.classList.add('reveal')
    for (const name of Object.keys(binding.modifiers)) {
      if (binding.modifiers[name]) el.classList.add(`reveal--${name}`)
    }
    const delay = delayFrom(binding)
    if (delay) el.style.setProperty('--reveal-delay', `${delay}ms`)

    const io = observer()
    // No IntersectionObserver (very old browser): show it rather than hide it.
    if (!io) { el.classList.add(REVEALED); return }
    io.observe(el)
    pending.add(el)
    scheduleSweep()
  },
  unmounted(el) {
    sharedObserver?.unobserve(el)
    pending.delete(el)
  },
}

/**
 * `v-stagger` on a container — gives each child an increasing reveal delay so
 * a grid resolves as a wave instead of a slab. `v-stagger="90"` sets the step
 * in ms (default 70). Children still need their own `v-reveal`.
 *
 * Re-applied whenever the child list changes, because the common case is a
 * grid rendered from a `v-for` over data that arrives after mount.
 */
export const vStagger: Directive<HTMLElement, number | undefined> = {
  mounted(el, binding) { applyStagger(el, binding) },
  updated(el, binding) { applyStagger(el, binding) },
}

function applyStagger(el: HTMLElement, binding: DirectiveBinding<number | undefined>) {
  if (prefersReducedMotion()) return
  const step = Number(binding.value) > 0 ? Number(binding.value) : 70
  const children = Array.from(el.children) as HTMLElement[]
  children.forEach((child, i) => {
    // Cap the ramp: with 24 cards a linear stagger leaves the last one
    // waiting 1.7s, long after the reader has scrolled past it.
    child.style.setProperty('--reveal-delay', `${Math.min(i, 8) * step}ms`)
  })
}

/**
 * Count a number up when it first becomes visible.
 *
 * Only ever counts to a real value: `target` is the figure the server
 * returned, and until one arrives the composable holds at null so the
 * template can render an em dash. It never animates from a placeholder and
 * it never invents an intermediate figure that outlives the animation.
 */
export function useCountUp(
  target: Ref<number | null | undefined>,
  options: { duration?: number; element?: Ref<HTMLElement | null> } = {},
) {
  const duration = options.duration ?? 1100
  const shown = ref<number | null>(null)
  let frame = 0
  let started = false

  function run() {
    const to = target.value
    if (to == null || !Number.isFinite(to)) return
    if (prefersReducedMotion()) { shown.value = to; return }
    cancelAnimationFrame(frame)
    const start = performance.now()
    const from = shown.value ?? 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      // Same ease-out as --ent-ease, evaluated directly: strong arrival,
      // no overshoot. A council's figures should land, not bounce.
      const eased = 1 - Math.pow(1 - t, 4)
      shown.value = Math.round(from + (to - from) * eased)
      if (t < 1) frame = requestAnimationFrame(tick)
      else shown.value = to
    }
    frame = requestAnimationFrame(tick)
  }

  onMounted(() => {
    const host = options.element?.value
    // No element to watch, or no observer: count as soon as a value exists.
    if (!host || !('IntersectionObserver' in window)) {
      if (target.value != null) run()
      started = true
      watch(target, () => run())
      return
    }
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      started = true
      io.disconnect()
      run()
    }, { threshold: 0.35 })
    io.observe(host)
    onUnmounted(() => io.disconnect())
    // The figures arrive over the network, so the value usually lands after
    // the tile is already on screen. Re-run on arrival, but only once the
    // tile has actually been seen.
    watch(target, () => { if (started) run() })
  })

  onUnmounted(() => cancelAnimationFrame(frame))

  return shown
}
