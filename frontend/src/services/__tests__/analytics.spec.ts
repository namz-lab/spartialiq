// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const post = vi.fn()
vi.mock('../api', () => ({ default: { post: (...args: unknown[]) => post(...args) } }))

async function freshModule() {
  vi.resetModules()
  return import('../analytics')
}

beforeEach(() => {
  localStorage.clear()
  post.mockReset()
  post.mockResolvedValue({ status: 204 })
  Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true })
})

describe('analytics consent', () => {
  it('sends nothing and creates no visitor id before a choice is made', async () => {
    const a = await freshModule()
    a.trackPageView('/')
    expect(post).not.toHaveBeenCalled()
    expect(localStorage.getItem(a.VISITOR_KEY)).toBeNull()
  })

  it('sends nothing after rejection', async () => {
    const a = await freshModule()
    a.setConsent('rejected')
    a.trackPageView('/')
    expect(post).not.toHaveBeenCalled()
    expect(localStorage.getItem(a.CONSENT_KEY)).toBe('rejected')
  })

  it('records the pattern and a stable visitor id after acceptance', async () => {
    const a = await freshModule()
    a.setConsent('accepted')
    a.trackPageView('/citizen')
    a.trackPageView('/explorer')
    expect(post).toHaveBeenCalledTimes(2)
    const [url, body] = post.mock.calls[0]
    expect(url).toBe('/analytics/pageview')
    expect(body.path).toBe('/citizen')
    expect(body.visitorId).toMatch(/^[0-9a-f-]{36}$/)
    expect(post.mock.calls[1][1].visitorId).toBe(body.visitorId)
  })

  it('respects Do Not Track', async () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true })
    const a = await freshModule()
    a.setConsent('accepted')
    a.trackPageView('/')
    expect(post).not.toHaveBeenCalled()
  })

  it('never throws when the request fails', async () => {
    post.mockRejectedValue(new Error('offline'))
    const a = await freshModule()
    a.setConsent('accepted')
    expect(() => a.trackPageView('/')).not.toThrow()
    await Promise.resolve()
  })

  it('reset forgets the choice and the visitor id', async () => {
    const a = await freshModule()
    a.setConsent('accepted')
    a.trackPageView('/')
    a.resetConsent()
    expect(a.consent.value).toBeNull()
    expect(localStorage.getItem(a.CONSENT_KEY)).toBeNull()
    expect(localStorage.getItem(a.VISITOR_KEY)).toBeNull()
  })
})

describe('routePattern', () => {
  it('uses the matched record path, never the concrete URL', async () => {
    const { routePattern } = await freshModule()
    const matched = [{ path: '/inspector/:id' }] as never
    expect(routePattern({ matched })).toBe('/inspector/:id')
  })

  it('collapses unmatched URLs to one bucket', async () => {
    const { routePattern } = await freshModule()
    expect(routePattern({ matched: [{ path: '/:pathMatch(.*)*' }] as never })).toBe('(not found)')
    expect(routePattern({ matched: [] })).toBe('(not found)')
  })
})
