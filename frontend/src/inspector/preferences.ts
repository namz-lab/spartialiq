/**
 * Building Inspector console preferences.
 *
 * Four settings, and every one of them changes real behaviour somewhere else in
 * the console. That constraint is the point: a settings page whose switches do
 * nothing is worse than no settings page, because it teaches the inspector that
 * the controls in this product are decorative.
 *
 *   landingSection         which section the console opens on when the URL
 *                          does not name one (src/inspector/consoleRoute.ts)
 *   railCollapsed          whether the desktop section rail starts collapsed
 *                          (InspectorWorkspaceView)
 *   autoUploadOnReconnect  whether held evidence uploads by itself the moment
 *                          the connection returns (InspectorOutbox)
 *   voiceGuidance          whether driving directions are spoken aloud
 *                          (SiteNavigation, via src/inspector/navVoice.ts)
 *
 * WHERE THE VALUES LIVE
 * Three of them in one localStorage key. The fourth — voice — is NOT stored
 * here: navVoice already owns that flag and the navigation screen has its own
 * mute button, so this module reads and writes through navVoice rather than
 * keeping a second copy that could disagree with it.
 *
 * These are device preferences, not council record. They are deliberately not
 * synced to the server: an inspector's second device, or a colleague borrowing
 * the tablet, should get the safe defaults rather than inherit someone else's.
 *
 * Pure: no Vue. The reactive wrapper is src/composables/useInspectorPreferences.
 */

import { isSectionKey } from './consoleRoute'
import { isMuted, setMuted } from './navVoice'

/**
 * Sections offered as a landing choice.
 *
 * The operational sections only. The case-bound ones are excluded on purpose:
 * opening the console on Case file with no case open lands the inspector on an
 * empty state every morning, which is not a preference anyone wants.
 *
 * Public reports is here because in a complaint-heavy ward it is genuinely the
 * first thing an inspector wants to see, and it needs no case to be useful.
 */
export const LANDING_SECTIONS = ['dashboard', 'stages', 'bookings', 'enforcement', 'complaints'] as const
export type LandingSection = (typeof LANDING_SECTIONS)[number]

export interface InspectorPreferences {
  landingSection: LandingSection
  railCollapsed: boolean
  autoUploadOnReconnect: boolean
  voiceGuidance: boolean
}

/**
 * What an inspector gets before they change anything.
 *
 * Auto-upload defaults ON because evidence owed to the council record should
 * not wait on someone remembering to press sync; voice defaults ON because a
 * driver cannot read a banner.
 */
export const DEFAULT_PREFERENCES: Readonly<InspectorPreferences> = Object.freeze({
  landingSection: 'dashboard',
  railCollapsed: false,
  autoUploadOnReconnect: true,
  voiceGuidance: true,
})

const KEY = 'vungu.inspector.preferences'

/** The subset this module stores itself — voice is navVoice's. */
type StoredPreferences = Omit<InspectorPreferences, 'voiceGuidance'>

export function isLandingSection(value: unknown): value is LandingSection {
  return isSectionKey(value) && (LANDING_SECTIONS as readonly string[]).includes(value)
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Read the stored half, field by field.
 *
 * Every field falls back independently, so a blob written by an older build —
 * or hand-edited, or half-corrupted — still yields a usable set rather than
 * throwing the lot away. A preference store is not worth an error screen.
 */
function readStored(): StoredPreferences {
  const fallback: StoredPreferences = {
    landingSection: DEFAULT_PREFERENCES.landingSection,
    railCollapsed: DEFAULT_PREFERENCES.railCollapsed,
    autoUploadOnReconnect: DEFAULT_PREFERENCES.autoUploadOnReconnect,
  }
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return fallback  // private mode, or storage blocked: defaults, no error.
  }
  if (!raw) return fallback

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fallback
  }
  if (typeof parsed !== 'object' || parsed === null) return fallback
  const o = parsed as Record<string, unknown>

  return {
    landingSection: isLandingSection(o.landingSection) ? o.landingSection : fallback.landingSection,
    railCollapsed: bool(o.railCollapsed, fallback.railCollapsed),
    autoUploadOnReconnect: bool(o.autoUploadOnReconnect, fallback.autoUploadOnReconnect),
  }
}

function writeStored(next: StoredPreferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // A blocked store costs the preference, not the session. The value still
    // applies for as long as this tab is open, because callers read what this
    // module returns rather than re-reading storage.
  }
}

/** The current preferences, stored half plus navVoice's half. */
export function readPreferences(): InspectorPreferences {
  return { ...readStored(), voiceGuidance: !isMuted() }
}

type Listener = (prefs: InspectorPreferences) => void
const listeners = new Set<Listener>()
let storageBound = false

function emit(): void {
  const snapshot = readPreferences()
  for (const fn of listeners) fn(snapshot)
}

/**
 * Subscribe to preference changes; returns the unsubscribe.
 *
 * Covers both directions a change can arrive from: this tab (writePreference
 * calls emit directly, because a `storage` event never fires in the tab that
 * caused it) and another tab, via the storage event. An inspector with the
 * workspace open in two tabs sees one truth.
 */
export function onPreferencesChange(fn: Listener): () => void {
  listeners.add(fn)
  if (!storageBound && typeof window !== 'undefined') {
    storageBound = true
    window.addEventListener('storage', (e) => {
      if (e.key === null || e.key === KEY) emit()
    })
  }
  return () => { listeners.delete(fn) }
}

/** Set one preference and return the whole set as it now stands. */
export function writePreference<K extends keyof InspectorPreferences>(
  key: K,
  value: InspectorPreferences[K],
): InspectorPreferences {
  if (key === 'voiceGuidance') {
    setMuted(!(value as boolean))
  } else {
    writeStored({ ...readStored(), [key]: value } as StoredPreferences)
  }
  emit()
  return readPreferences()
}

/** Put every preference back to its default, including the voice flag. */
export function resetPreferences(): InspectorPreferences {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to undo — readStored already answers with the defaults.
  }
  setMuted(!DEFAULT_PREFERENCES.voiceGuidance)
  emit()
  return readPreferences()
}
