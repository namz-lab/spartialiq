import { describe, expect, it } from 'vitest'
import { bandFor, createAnnouncer, phraseFor } from '../navVoice'
import type { RouteStep } from '../routeGraph'

function step(partial: Partial<RouteStep> = {}): RouteStep {
  return {
    manoeuvre: 'left',
    road: 'Main Street',
    distanceM: 900,
    at: { lng: 29.8, lat: -19.45 },
    coordinateIndex: 12,
    instruction: 'Turn left onto Main Street',
    ...partial,
  }
}

describe('bandFor', () => {
  it('calls the smallest band at or above the distance', () => {
    // A turn first seen at 300 m must not be announced as "in 800 metres".
    expect(bandFor(300)).toBe(400)
    expect(bandFor(790)).toBe(800)
    expect(bandFor(150)).toBe(200)
    expect(bandFor(45)).toBe(50)
  })

  it('stays silent while the turn is still far off', () => {
    expect(bandFor(900)).toBeNull()
    expect(bandFor(NaN)).toBeNull()
    expect(bandFor(-5)).toBeNull()
  })

  it('calls exactly at a band boundary', () => {
    expect(bandFor(400)).toBe(400)
    expect(bandFor(50)).toBe(50)
  })
})

describe('phraseFor', () => {
  it('leads the written instruction with the band', () => {
    expect(phraseFor(step(), 400)).toBe('In 400 metres, turn left onto Main Street.')
  })

  it('says "now" at the last band rather than a distance', () => {
    expect(phraseFor(step(), 50)).toBe('Now, turn left onto Main Street.')
  })

  it('speaks arrival as arrival', () => {
    const arrive = step({ manoeuvre: 'arrive', instruction: 'Arrive at the site', road: null })
    expect(phraseFor(arrive, 50)).toBe('Arriving at the site.')
    expect(phraseFor(arrive, 200)).toBe('In 200 metres, arrive at the site.')
  })
})

describe('createAnnouncer', () => {
  it('calls each band once however many fixes arrive inside it', () => {
    const a = createAnnouncer()
    const s = step()
    expect(a.onProgress(s, 780, true)).toBe('In 800 metres, turn left onto Main Street.')
    expect(a.onProgress(s, 700, true)).toBeNull()
    expect(a.onProgress(s, 500, true)).toBeNull()
    expect(a.onProgress(s, 390, true)).toBe('In 400 metres, turn left onto Main Street.')
    expect(a.onProgress(s, 30, true)).toBe('Now, turn left onto Main Street.')
    expect(a.onProgress(s, 25, true)).toBeNull()
  })

  it('treats a different turn as a different turn', () => {
    const a = createAnnouncer()
    expect(a.onProgress(step(), 180, true)).not.toBeNull()
    expect(a.onProgress(step({ coordinateIndex: 40, manoeuvre: 'right' }), 180, true)).not.toBeNull()
  })

  it('does not replay the old route after a re-route', () => {
    const a = createAnnouncer()
    expect(a.onProgress(step(), 180, true)).not.toBeNull()
    expect(a.onProgress(step(), 180, true)).toBeNull()
    a.reset()
    expect(a.onProgress(step(), 180, true)).not.toBeNull()
  })

  it('records a muted cue as said, so un-muting resumes rather than replays', () => {
    const a = createAnnouncer()
    a.onProgress(step(), 390, true)
    expect(a.onProgress(step(), 380, false)).toBeNull()
  })

  it('says nothing when there is no next turn', () => {
    expect(createAnnouncer().onProgress(null, 100, true)).toBeNull()
  })

  it('says a keyed one-off exactly once', () => {
    const a = createAnnouncer()
    expect(a.once('depart', 'Head north on Main Street.', true)).toBe('Head north on Main Street.')
    expect(a.once('depart', 'Head north on Main Street.', true)).toBeNull()
  })
})
