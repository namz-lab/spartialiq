// @vitest-environment happy-dom
//
// The promise this page makes is that none of its switches are decorative. So
// what is tested here is not that a checkbox renders, but that flipping it
// actually reaches the preference store the rest of the console reads — and
// that the page refuses to claim a save it did not make.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

const updateProfile = vi.fn()
const authUser = {
  id: '1', email: 'i.moyo@vungurdc.gov.zw', name: 'I. Moyo', role: 'building_inspector',
  jobTitle: 'Building Inspector Grade 1', department: 'Building Control', phone: '+263 77 000 0000',
}

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: authUser, error: null, updateProfile }),
}))
// IndexedDB is not in happy-dom; the custody store is exercised by its own spec.
vi.mock('@/inspector/evidenceQueue', () => ({
  listAllEvidence: vi.fn(async () => []),
  flushEvidence: vi.fn(async () => ({ uploaded: 0, failed: 0 })),
}))
vi.mock('@/services/developmentManagementService', () => ({ dmApi: { uploadStagePhoto: vi.fn() } }))

import SettingsSection from '../SettingsSection.vue'
import { readPreferences } from '@/inspector/preferences'
import { __resetInspectorPreferencesForTest } from '@/composables/useInspectorPreferences'

beforeEach(() => {
  localStorage.clear()
  __resetInspectorPreferencesForTest()
  updateProfile.mockReset()
  updateProfile.mockResolvedValue(authUser)
})
afterEach(() => { __resetInspectorPreferencesForTest() })

function page() {
  return mount(SettingsSection, { global: { stubs: { UiFeedback: true } } })
}

/** The checkbox whose row mentions `needle`. */
function checkbox(w: ReturnType<typeof page>, needle: string) {
  const row = w.findAll('.ins-check').find(r => r.text().includes(needle))
  if (!row) throw new Error(`no settings row mentioning "${needle}"`)
  return row.find('input[type="checkbox"]')
}

describe('the switches reach the preference store', () => {
  it('turns automatic upload off, where the outbox will read it', async () => {
    const w = page()
    expect(readPreferences().autoUploadOnReconnect).toBe(true)

    await checkbox(w, 'Upload held evidence').setValue(false)
    expect(readPreferences().autoUploadOnReconnect).toBe(false)
    w.unmount()
  })

  it('collapses the rail by default, where the workspace will read it', async () => {
    const w = page()
    await checkbox(w, 'section rail collapsed').setValue(true)
    expect(readPreferences().railCollapsed).toBe(true)
    w.unmount()
  })

  it('sets the landing section from the segmented control', async () => {
    const w = page()
    const enforcement = w.findAll('[role="radio"]').find(b => b.text() === 'Enforcement')!
    await enforcement.trigger('click')

    expect(readPreferences().landingSection).toBe('enforcement')
    expect(enforcement.attributes('aria-checked')).toBe('true')
    w.unmount()
  })

  it('shows what is already stored, rather than the defaults', () => {
    localStorage.setItem('vungu.inspector.preferences', JSON.stringify({ railCollapsed: true }))
    __resetInspectorPreferencesForTest()
    const w = page()
    expect((checkbox(w, 'section rail collapsed').element as HTMLInputElement).checked).toBe(true)
    w.unmount()
  })
})

describe('appointment details', () => {
  it('cannot be saved until something changes', async () => {
    const w = page()
    const save = w.findAll('button').find(b => b.text().includes('Save appointment'))!
    expect(save.attributes('disabled')).toBeDefined()

    await w.find('#iset-title').setValue('Chief Building Inspector')
    expect(save.attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  it('sends only the fields that actually changed', async () => {
    const w = page()
    await w.find('#iset-title').setValue('Chief Building Inspector')
    await w.findAll('button').find(b => b.text().includes('Save appointment'))!.trigger('click')
    await nextTick()

    expect(updateProfile).toHaveBeenCalledWith({ jobTitle: 'Chief Building Inspector' })
    w.unmount()
  })

  it('does not report a save when every change was a blank', async () => {
    // The endpoint COALESCEs, so a blank cannot clear a value. Sending it would
    // show "Saved" for a write that kept the old text.
    const w = page()
    await w.find('#iset-dept').setValue('   ')
    await w.findAll('button').find(b => b.text().includes('Save appointment'))!.trigger('click')
    await nextTick()

    expect(updateProfile).not.toHaveBeenCalled()
    expect(w.text()).not.toContain('Saved')
    w.unmount()
  })
})

describe('what the page refuses to offer', () => {
  it('has no control over the geofence tolerance or the certificate gate', () => {
    // An officer must not be able to relax their own verification, so those
    // values are server-set and the page says so instead of exposing them.
    const w = page()
    const inputs = w.findAll('input, select, [role="radio"]')
    for (const el of inputs) {
      expect(el.attributes('id') ?? '').not.toMatch(/toleran|geofence|stage-gate/i)
    }
    expect(w.text()).toContain('Not settable from here, by design')
    w.unmount()
  })
})
