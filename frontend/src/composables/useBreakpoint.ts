// Reactive viewport and input-method state, for the cases where CSS alone
// cannot express the adaptation.
//
// WHEN TO USE THIS, AND WHEN NOT TO
// Prefer a media query. If the difference between desktop and mobile is
// visual — columns, spacing, which affordance is visible — CSS does it with
// no JavaScript and no re-render. Reach for this composable only when the
// difference is STRUCTURAL: a <table> that must become a list of <article>s,
// a persistent rail that must become a focus-trapped sheet, a map panel that
// should not mount at all until opened. Those cannot be done by hiding one
// DOM tree and showing another, because duplicating the tree duplicates the
// state with it — exactly what Phase 20's component contract forbids.
//
// Breakpoint values are the same four as src/styles/responsive.css. They are
// repeated here because a CSS custom property cannot be read from inside a
// media query, and matchMedia cannot read one either. Change both or neither.
//
// One set of MediaQueryList listeners is shared by every caller: the state is
// module-level, so a hundred components observing `isMobile` cost five
// listeners in total, not five hundred.

import { computed, readonly, ref, type Ref } from 'vue'

/** Mirrors the --ent-bp-* tokens in src/styles/responsive.css. */
export const BREAKPOINTS = {
  /** Phone. Single column, touch, bottom navigation. */
  mobile: 767,
  /** iPad portrait / 820 / small Android tablet. Touch, collapsible panels. */
  tablet: 768,
  /** Laptop, iPad landscape with keyboard. Persistent rail. */
  desktop: 1024,
  /** Planning workstation. Wider context columns. */
  wide: 1440,
} as const

export type BreakpointName = 'mobile' | 'tablet' | 'desktop' | 'wide'

const QUERIES = {
  mobile:  `(max-width: ${BREAKPOINTS.mobile}px)`,
  tablet:  `(min-width: ${BREAKPOINTS.tablet}px) and (max-width: ${BREAKPOINTS.desktop - 1}px)`,
  desktop: `(min-width: ${BREAKPOINTS.desktop}px)`,
  wide:    `(min-width: ${BREAKPOINTS.wide}px)`,
  // Input method, deliberately independent of width: a 1024px iPad Pro in
  // landscape is a desktop-width TOUCH device and needs the desktop layout
  // with touch-sized targets.
  coarse:  '(pointer: coarse)',
} as const

const mobile  = ref(false)
const tablet  = ref(false)
const desktop = ref(false)
const wide    = ref(false)
const touch   = ref(false)

let initialised = false

/**
 * Attaches the listeners once, on first use.
 *
 * Guarded for environments with no `window` — the Vitest default environment,
 * and any future prerender step. There every flag stays false, which callers
 * read as "not mobile", so components render their desktop tree and specs
 * assert against stable markup instead of a guessed viewport. Specs that want
 * the mobile tree stub matchMedia themselves.
 */
function init(): void {
  if (initialised) return
  initialised = true
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

  const bind = (query: string, target: Ref<boolean>) => {
    const mql = window.matchMedia(query)
    target.value = mql.matches
    // addEventListener, not the deprecated addListener; Safari has supported
    // it since 14. Never detached: this is module-level state that outlives
    // every component, so removing it on one unmount would silently freeze
    // the value for every other component still mounted.
    //
    // The feature test is for test environments, not browsers: happy-dom
    // returns a MediaQueryList whose listener surface has varied between
    // versions, and a component tree must not fail to mount because the DOM
    // shim is incomplete. Without a listener the value is still correct at
    // read time, it simply stops updating — which is right for a test that
    // never resizes anyway.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', (e) => { target.value = e.matches })
    } else if (typeof (mql as MediaQueryList & {
      addListener?: (cb: (e: MediaQueryListEvent) => void) => void
    }).addListener === 'function') {
      ;(mql as MediaQueryList & {
        addListener: (cb: (e: MediaQueryListEvent) => void) => void
      }).addListener((e) => { target.value = e.matches })
    }
  }

  bind(QUERIES.mobile,  mobile)
  bind(QUERIES.tablet,  tablet)
  bind(QUERIES.desktop, desktop)
  bind(QUERIES.wide,    wide)
  bind(QUERIES.coarse,  touch)
}

/** ≤1023px — phone or tablet. The usual test for "no room for a side rail". */
const compact = computed(() => mobile.value || tablet.value)

/** Current breakpoint as a name, for logging and for :class bindings. */
const name = computed<BreakpointName>(() =>
  mobile.value ? 'mobile'
  : tablet.value ? 'tablet'
  : wide.value ? 'wide'
  : 'desktop',
)

export function useBreakpoint() {
  init()
  return {
    /** ≤767px. Bottom navigation, sheets, single column, card lists. */
    isMobile: readonly(mobile),
    /** 768–1023px. Collapsible panels, two columns, drawer navigation. */
    isTablet: readonly(tablet),
    /** ≥1024px. Persistent rail, multi-pane, full data tables. */
    isDesktop: readonly(desktop),
    /** ≥1440px. Wider context columns on split layouts. */
    isWide: readonly(wide),
    /** Coarse pointer at any width. Governs target size, never layout. */
    isTouch: readonly(touch),
    /** ≤1023px. Shorthand for "collapse the rail". */
    isCompact: compact,
    /** 'mobile' | 'tablet' | 'desktop' | 'wide'. */
    breakpoint: name,
  }
}
