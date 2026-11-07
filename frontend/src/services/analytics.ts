// First-party usage analytics, gated on cookie consent.
//
// Page views go to our own backend (POST /api/analytics/pageview), never to a
// third party: the frontend is self-hosted. Nothing is sent, and no visitor id
// is created, until the visitor accepts. What is sent is the route PATTERN
// (/applications/:id), not the concrete URL, so no record id or query string
// leaves the page.
//
// The consent flag and the visitor id live in localStorage: they are per-browser
// conveniences, not auth state (auth stays in httpOnly cookies).

import { ref } from 'vue'
import type { RouteLocationNormalized } from 'vue-router'
import api from './api'

export type ConsentChoice = 'accepted' | 'rejected'

export const CONSENT_KEY = 'vungu_cookie_consent'
export const VISITOR_KEY = 'vungu_visitor_id'

function readChoice(): ConsentChoice | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY)
    return v === 'accepted' || v === 'rejected' ? v : null
  } catch {
    return null
  }
}

/** The visitor's choice, or null while they have not made one. */
export const consent = ref<ConsentChoice | null>(readChoice())

export function setConsent(choice: ConsentChoice) {
  consent.value = choice
  try {
    localStorage.setItem(CONSENT_KEY, choice)
    if (choice === 'rejected') localStorage.removeItem(VISITOR_KEY)
  } catch {
    // Storage blocked: the choice holds for this visit only.
  }
}

/** Forget the choice so the banner asks again (the privacy notice's control). */
export function resetConsent() {
  consent.value = null
  try {
    localStorage.removeItem(CONSENT_KEY)
    localStorage.removeItem(VISITOR_KEY)
  } catch {
    // Storage blocked: nothing was kept to forget.
  }
}

/**
 * The route pattern for a resolved route: `/applications/:id`, never
 * `/applications/4127?tab=fees`. Unmatched URLs collapse to one bucket so a
 * mistyped address cannot write an arbitrary string into the table.
 */
export function routePattern(route: Pick<RouteLocationNormalized, 'matched'>): string {
  const record = route.matched[route.matched.length - 1]
  if (!record || record.path.includes(':pathMatch')) return '(not found)'
  return record.path || '/'
}

function visitorId(): string | undefined {
  try {
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(VISITOR_KEY, id)
    }
    return id
  } catch {
    return undefined
  }
}

function externalReferrerHost(): string | undefined {
  try {
    if (!document.referrer) return undefined
    const host = new URL(document.referrer).host
    return host && host !== location.host ? host : undefined
  } catch {
    return undefined
  }
}

function doNotTrack(): boolean {
  const nav = navigator as Navigator & { msDoNotTrack?: string }
  const w = window as Window & { doNotTrack?: string }
  return [nav.doNotTrack, w.doNotTrack, nav.msDoNotTrack].some(v => v === '1' || v === 'yes')
}

let initialView = true

/** Record one view of a route pattern. Fire-and-forget; never throws. */
export function trackPageView(path: string): void {
  // The referrer belongs to the page the visitor arrived on, whether or not
  // that view is the one recorded.
  const isInitial = initialView
  initialView = false
  try {
    if (consent.value !== 'accepted' || doNotTrack()) return
    void api.post('/analytics/pageview', {
      path,
      visitorId: visitorId(),
      referrerHost: isInitial ? externalReferrerHost() : undefined,
    }).catch(() => { /* analytics must never disturb the page */ })
  } catch {
    // Same: a failure here is never the visitor's problem.
  }
}
