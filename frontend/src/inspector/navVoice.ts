/**
 * Spoken turn guidance for in-app navigation.
 *
 * An inspector driving to a stand cannot read a banner, so the turn has to be
 * said out loud. The decision of WHEN to say it is a pure function over the
 * distance to the next manoeuvre; the saying is a thin wrapper over the
 * browser's own speech synthesis. No dependency, no network, no voice service —
 * which also means it keeps working on a district road with no signal.
 */
import type { RouteStep } from './routeGraph'

/**
 * Distances, in metres, at which a turn is called — descending.
 *
 * Fixed bands rather than a speed-derived lead time: the council road data
 * carries a design speed per class, not a measured one, so a "call it 20
 * seconds out" rule would inherit that error and announce turns at the wrong
 * moment. A band the driver can verify against a road sign is the honest form.
 */
export const CUE_BANDS_M = [800, 400, 200, 50] as const
export type CueBand = (typeof CUE_BANDS_M)[number]

/** The final band: said as "Now", and it interrupts anything still queued. */
const IMMINENT: CueBand = 50

/**
 * The band `distanceM` currently sits in, or null when the turn is too far off
 * to call.
 *
 * The SMALLEST band at or above the distance — so a turn first seen at 300 m is
 * announced as "in 400 metres" and never as "in 800 metres", which would be a
 * lie the driver notices immediately.
 */
export function bandFor(distanceM: number): CueBand | null {
  if (!Number.isFinite(distanceM) || distanceM < 0) return null
  let chosen: CueBand | null = null
  for (const b of CUE_BANDS_M) if (distanceM <= b) chosen = b
  return chosen
}

/**
 * What to say. `step.instruction` is already a written instruction
 * ("Turn left onto Main Street"), so the band only supplies the lead-in.
 */
export function phraseFor(step: RouteStep, band: CueBand): string {
  if (step.manoeuvre === 'arrive') {
    return band === IMMINENT ? 'Arriving at the site.' : `In ${band} metres, arrive at the site.`
  }
  const body = step.instruction.charAt(0).toLowerCase() + step.instruction.slice(1)
  return band === IMMINENT ? `Now, ${body}.` : `In ${band} metres, ${body}.`
}

const MUTE_KEY = 'vungu.nav.voice.muted'

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    // A blocked store costs the preference, not the guidance.
  }
}

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/**
 * Say `text`. Returns false when nothing was said.
 *
 * `interrupt` drops whatever is still queued: "Now, turn left" must not wait
 * behind "in 800 metres, turn left", or the driver hears the turn called after
 * passing it.
 */
export function speak(text: string, opts: { interrupt?: boolean; muted?: boolean } = {}): boolean {
  if (opts.muted ?? isMuted()) return false
  if (!voiceSupported()) return false
  try {
    const synth = window.speechSynthesis
    if (opts.interrupt) synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-GB'
    // A voice matching the app's language when the device has one; the engine's
    // default otherwise, which is still intelligible.
    const voice = synth.getVoices().find((v) => v.lang === 'en-GB' || v.lang === 'en_GB')
    if (voice) u.voice = voice
    synth.speak(u)
    return true
  } catch {
    return false
  }
}

export function stopSpeaking(): void {
  if (!voiceSupported()) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    // Nothing to do: the utterance queue drains on its own.
  }
}

export interface Announcer {
  /** Call on every position fix. Returns the phrase due, or null. */
  onProgress(step: RouteStep | null, distanceToNextM: number, muted: boolean): string | null
  /** Say something once under a caller-chosen key — departure, re-route, arrival. */
  once(key: string, text: string, muted: boolean): string | null
  /** A new route voids everything said about the old one. */
  reset(): void
}

/**
 * Remembers what has already been said, so each turn is called once per band
 * however many fixes arrive in between.
 *
 * A cue suppressed by the mute is still recorded as said. Un-muting mid-drive
 * should resume from where the drive is now, not replay a backlog of turns the
 * inspector has already taken.
 */
export function createAnnouncer(): Announcer {
  const said = new Set<string>()
  return {
    onProgress(step, distanceToNextM, muted) {
      if (!step) return null
      const band = bandFor(distanceToNextM)
      if (band === null) return null
      const key = `${step.coordinateIndex}:${step.manoeuvre}:${band}`
      if (said.has(key)) return null
      said.add(key)
      const phrase = phraseFor(step, band)
      speak(phrase, { interrupt: band === IMMINENT, muted })
      return phrase
    },
    once(key, text, muted) {
      if (said.has(key)) return null
      said.add(key)
      speak(text, { interrupt: true, muted })
      return text
    },
    reset() {
      said.clear()
    },
  }
}
