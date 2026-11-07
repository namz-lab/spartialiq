// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { DirectiveBinding } from 'vue'
import { vReveal, vStagger, prefersReducedMotion } from '../reveal'

/**
 * `.reveal` starts at `opacity: 0` and only becomes visible when the
 * directive adds `.is-revealed`. That makes the directive responsible for a
 * guarantee, not just an effect: content must never be left permanently
 * invisible because the motion never ran.
 *
 * There are two ways that can happen and both are tested here — the OS has
 * asked for reduced motion, and the browser has no IntersectionObserver.
 * In both, the element must be revealed at mount and never hidden at all.
 */

function mountDirective(el: HTMLElement, value?: number, modifiers: Record<string, boolean> = {}) {
  vReveal.mounted?.(el, { value, modifiers } as DirectiveBinding<number | undefined>, null as never, null)
}

const realMatchMedia = window.matchMedia
const realIO = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

/** Records what was observed without ever reporting an intersection. */
function stubObserver() {
  const observed: Element[] = []
  class Stub {
    constructor(_cb: unknown, _opts?: unknown) {}
    observe(el: Element) { observed.push(el) }
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = Stub
  return observed
}

beforeEach(() => { setReducedMotion(false) })

afterEach(() => {
  window.matchMedia = realMatchMedia
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = realIO
  vi.restoreAllMocks()
})

describe('prefersReducedMotion', () => {
  it('reports the OS preference', () => {
    setReducedMotion(true)
    expect(prefersReducedMotion()).toBe(true)
    setReducedMotion(false)
    expect(prefersReducedMotion()).toBe(false)
  })
})

describe('v-reveal with reduced motion', () => {
  it('reveals at mount and never applies the hidden starting state', () => {
    setReducedMotion(true)
    const observed = stubObserver()
    const el = document.createElement('div')

    mountDirective(el, 200)

    expect(el.classList.contains('is-revealed')).toBe(true)
    // `.reveal` is the class that carries `opacity: 0`. It must not be added
    // at all — relying on the media query to undo it would still leave a
    // frame of invisible content.
    expect(el.classList.contains('reveal')).toBe(false)
    expect(observed).toHaveLength(0)
    expect(el.style.getPropertyValue('--reveal-delay')).toBe('')
  })
})

describe('v-reveal without IntersectionObserver', () => {
  it('shows the element rather than hiding it for ever', () => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
    const el = document.createElement('div')

    mountDirective(el)

    expect(el.classList.contains('is-revealed')).toBe(true)
  })
})

describe('v-reveal in the normal case', () => {
  it('hides, observes, and records the delay and direction', () => {
    const observed = stubObserver()
    const el = document.createElement('div')

    mountDirective(el, 150, { up: true })

    expect(el.classList.contains('reveal')).toBe(true)
    expect(el.classList.contains('reveal--up')).toBe(true)
    expect(el.classList.contains('is-revealed')).toBe(false)
    expect(el.style.getPropertyValue('--reveal-delay')).toBe('150ms')
    expect(observed).toContain(el)
  })

  it('ignores a delay that is not a positive number', () => {
    stubObserver()
    const el = document.createElement('div')
    mountDirective(el, Number.NaN)
    expect(el.style.getPropertyValue('--reveal-delay')).toBe('')
  })
})

describe('v-stagger', () => {
  function stagger(el: HTMLElement, value?: number) {
    vStagger.mounted?.(el, { value, modifiers: {} } as DirectiveBinding<number | undefined>, null as never, null)
  }

  it('ramps each child by the step', () => {
    const parent = document.createElement('div')
    for (let i = 0; i < 4; i++) parent.appendChild(document.createElement('span'))

    stagger(parent, 60)

    const delays = Array.from(parent.children).map((c) => (c as HTMLElement).style.getPropertyValue('--reveal-delay'))
    expect(delays).toEqual(['0ms', '60ms', '120ms', '180ms'])
  })

  it('caps the ramp so a long grid does not leave the last card waiting', () => {
    const parent = document.createElement('div')
    for (let i = 0; i < 14; i++) parent.appendChild(document.createElement('span'))

    stagger(parent, 70)

    const last = (parent.children[13] as HTMLElement).style.getPropertyValue('--reveal-delay')
    // Capped at index 8, not 13 * 70 = 910ms.
    expect(last).toBe('560ms')
  })

  it('does nothing under reduced motion', () => {
    setReducedMotion(true)
    const parent = document.createElement('div')
    parent.appendChild(document.createElement('span'))

    stagger(parent, 70)

    expect((parent.children[0] as HTMLElement).style.getPropertyValue('--reveal-delay')).toBe('')
  })
})
