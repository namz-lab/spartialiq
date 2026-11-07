// @vitest-environment happy-dom
//
// Needs a window: the external-map rules below read matchMedia and window.open.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  haversineMetres, formatDistance, hasCoordinates, navigationUrls, gpsFailureMessage,
  navigationHref, prefersGeoHandoff, openExternalNavigation,
} from '../useInspectionNavigation'
import { checklistComplete, overallFromMarks } from '../useInspectorFieldCapture'

describe('navigation URLs', () => {
  it('uses coordinates only — no case text', () => {
    const { geo, https } = navigationUrls(-19.45012, 29.81670)
    expect(geo).toContain('-19.450120')
    expect(geo).not.toMatch(/stand|permit|moyo|inspection/i)
    expect(https).toContain('openstreetmap.org')
    expect(https).not.toMatch(/stand|permit/i)
  })
})

describe('distance', () => {
  it('returns a finite metre distance between two nearby points', () => {
    const m = haversineMetres({ lat: -19.45, lng: 29.82 }, { lat: -19.451, lng: 29.821 })
    expect(m).toBeGreaterThan(50)
    expect(m).toBeLessThan(500)
    expect(formatDistance(m)).toMatch(/m$/)
  })
  it('rejects missing coordinates', () => {
    expect(hasCoordinates(null, 29)).toBe(false)
    expect(hasCoordinates(-19.45, 29.82)).toBe(true)
  })
})

describe('gps failure copy', () => {
  it('explains denied and unsupported without implying a fake fix', () => {
    expect(gpsFailureMessage({ kind: 'denied' })).toMatch(/denied/i)
    expect(gpsFailureMessage({ kind: 'unsupported' })).toMatch(/does not support/i)
  })
})

describe('checklistComplete', () => {
  it('blocks submit while mandatory items are not inspected', () => {
    const r = checklistComplete([
      { result: 'pass', is_mandatory: true },
      { result: 'not_inspected', is_mandatory: true },
    ])
    expect(r.ok).toBe(false)
    expect(r.remaining).toBe(1)
  })
  it('counts FAIL items for the failure banner', () => {
    const r = checklistComplete([
      { result: 'fail' },
      { result: 'pass' },
    ])
    expect(r.ok).toBe(true)
    expect(r.failed).toBe(1)
  })
  it('does not invent a pass when items failed', () => {
    expect(overallFromMarks([{ result: 'fail' }, { result: 'pass' }])).toBe('fail')
    expect(overallFromMarks([{ result: 'not_inspected' }])).toBe('not_completed')
  })
})


/**
 * Getting an inspector to a site is the whole point of the Navigate control, and
 * it silently did nothing on a workstation: window.open('geo:…') neither throws
 * nor opens anything there, so the https fallback never ran, the inspector saw
 * no map, and the function still reported success. These pin the device rule.
 */
describe('opening an external map', () => {
  const realOpen = globalThis.window?.open
  const realUa = Object.getOwnPropertyDescriptor(globalThis.navigator, 'userAgent')

  /** A touch laptop reports a desktop UA — and must NOT get a geo: link. */
  const DESKTOP_TOUCH = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141 Safari/537.36'
  const PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141 Mobile Safari/537.36'

  function setDevice(ua: string) {
    Object.defineProperty(globalThis.navigator, 'userAgent', { value: ua, configurable: true })
    // Chrome's own hint, when present, is authoritative over the UA string.
    Object.defineProperty(globalThis.navigator, 'userAgentData',
      { value: { mobile: /Mobile|Android|iPhone/.test(ua) }, configurable: true })
  }

  afterEach(() => {
    if (realUa) Object.defineProperty(globalThis.navigator, 'userAgent', realUa)
    Object.defineProperty(globalThis.navigator, 'userAgentData', { value: undefined, configurable: true })
    if (realOpen) globalThis.window.open = realOpen
  })

  it('sends a workstation — including a touch-screen one — to a web map, never to geo:', () => {
    setDevice(DESKTOP_TOUCH)
    expect(prefersGeoHandoff()).toBe(false)
    const href = navigationHref(-19.45, 29.65)
    expect(href).toContain('openstreetmap.org')
    expect(href.startsWith('geo:')).toBe(false)
  })

  it('hands a phone the geo: URI so its maps application takes over', () => {
    setDevice(PHONE)
    expect(prefersGeoHandoff()).toBe(true)
    expect(navigationHref(-19.45, 29.65).startsWith('geo:')).toBe(true)
  })

  it('reports failure when the browser blocks the map window, instead of claiming success', () => {
    setDevice(DESKTOP_TOUCH)
    const open = vi.fn().mockReturnValue(null)   // popup blocked
    // @ts-expect-error — test double for a browser API
    globalThis.window.open = open
    expect(openExternalNavigation(-19.45, 29.65)).toBe(false)
    expect(open).toHaveBeenCalledOnce()
    expect(String(open.mock.calls[0][0])).toContain('openstreetmap.org')
  })

  it('trusts a mobile user agent even when the client hint is missing or stale', () => {
    // iOS Safari and Firefox expose no userAgentData at all; Chrome's device
    // emulation reports mobile:false while sending an Android UA.
    Object.defineProperty(globalThis.navigator, 'userAgent', { value: PHONE, configurable: true })
    Object.defineProperty(globalThis.navigator, 'userAgentData', { value: { mobile: false }, configurable: true })
    expect(prefersGeoHandoff()).toBe(true)
  })

  it('reports success when the map window opens', () => {
    setDevice(DESKTOP_TOUCH)
    // @ts-expect-error — test double for a browser API
    globalThis.window.open = vi.fn().mockReturnValue({})
    expect(openExternalNavigation(-19.45, 29.65)).toBe(true)
  })
})
