// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { hasSessionHint, markSignedIn, clearSession } from '../session'

describe('session', () => {
  beforeEach(() => localStorage.clear())

  it('tracks the presence hint without storing a token', () => {
    expect(hasSessionHint()).toBe(false)
    markSignedIn()
    expect(hasSessionHint()).toBe(true)

    // The whole point of the change: nothing resembling a credential or a
    // user record is persisted — only the one boolean bit.
    expect(localStorage.getItem('auth_token')).toBeNull()
    expect(localStorage.getItem('auth_user')).toBeNull()
    expect(localStorage.length).toBe(1)
  })

  it('purges cached case files (PII) on clear, across every role prefix', () => {
    markSignedIn()
    localStorage.setItem('planner_case_PA-2026-0042', '{"applicantNationalId":"63-1234567X00"}')
    localStorage.setItem('planner_recent_cases', '[]')
    localStorage.setItem('inspector_case_new_draft', '{}')
    localStorage.setItem('clerk_fee_receipts_v1', '[]')
    localStorage.setItem('eho_complaints_v1', '[]')
    localStorage.setItem('gis_map_requests_v1', '[]')
    localStorage.setItem('citizen_drafts_v1', '[]')
    localStorage.setItem('studio-draft:stand-77', '{}')
    localStorage.setItem('bpa_check_991', '{}')
    localStorage.setItem('survey.estimate.draft', '{}')
    localStorage.setItem('userProfile', '{"email":"surveyor@example.test"}')

    clearSession()

    expect(hasSessionHint()).toBe(false)
    expect(localStorage.length).toBe(0)
  })

  it('keeps UI preferences that merely share a purged prefix', () => {
    markSignedIn()
    localStorage.setItem('citizen_language', 'en')
    localStorage.setItem('citizen_drafts_v1', '[]')

    clearSession()

    // The draft (case data) goes; the language choice (a setting) stays.
    expect(localStorage.getItem('citizen_drafts_v1')).toBeNull()
    expect(localStorage.getItem('citizen_language')).toBe('en')
  })

  it('leaves unrelated keys alone', () => {
    localStorage.setItem('theme', 'dark')
    clearSession()
    expect(localStorage.getItem('theme')).toBe('dark')
  })
})
