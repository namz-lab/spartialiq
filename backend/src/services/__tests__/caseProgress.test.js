/**
 * caseProgress.advance: a case is moved on only forward, only from the statuses named, only where the workflow allows it,
 * and every move is logged. A fake client stands in for the database, so this needs none.
 */
const { advance } = require('../caseProgress')

function fakeClient({ current }) {
  const calls = []
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params })
      if (/UPDATE spatial_planning\.permit_application/.test(sql)) {
        const allowed = params[2]
        return { rows: allowed.includes(current) ? [{ id: params[0], old_status: current }] : [] }
      }
      return { rows: [] }
    },
  }
}
const request = { user: { id: '00000000-0000-0000-0000-000000000001', role: 'planner' }, log: { error: jest.fn() } }

describe('caseProgress.advance', () => {
  test('moves an acknowledged case into circulation and logs it as an automatic status change', async () => {
    const c = fakeClient({ current: 'acknowledged' })
    const r = await advance(c, 'p1', 'circulation', ['acknowledged'], { request, reason: 'Circulated to Engineering.' })
    expect(r).toEqual({ moved: true, from: 'acknowledged', to: 'circulation' })
    const ev = c.calls.find((x) => /INSERT INTO spatial_planning\.permit_event/.test(x.sql))
    expect(ev.params.slice(0, 3)).toEqual(['p1', request.user.id, 'planner'])
    expect(JSON.parse(ev.params[3])).toEqual({ status: 'circulation', from_status: 'acknowledged', automatic: true, reason: 'Circulated to Engineering.' })
  })

  test('bumps the revision, so a screen holding the old one is told the case changed', async () => {
    const c = fakeClient({ current: 'circulation' })
    await advance(c, 'p1', 'under_review', ['acknowledged', 'circulation'], { request, reason: 'x' })
    expect(c.calls[0].sql).toMatch(/revision = p\.revision \+ 1/)
  })

  test('never moves a case that is not at one of the named statuses, and logs nothing', async () => {
    for (const current of ['registered', 'under_review', 'awaiting_eo_decision', 'approved', 'withdrawn']) {
      const c = fakeClient({ current })
      const r = await advance(c, 'p1', 'under_review', ['acknowledged', 'circulation'], { request, reason: 'x' })
      expect(r).toEqual({ moved: false })
      expect(c.calls.some((x) => /permit_event/.test(x.sql))).toBe(false)
    }
  })

  test('drops a named status the workflow does not allow the move from', async () => {
    // registered -> under_review is not lawful (the clock must exist first), so it is never offered to the database
    const c = fakeClient({ current: 'registered' })
    const r = await advance(c, 'p1', 'under_review', ['registered', 'acknowledged'], { request, reason: 'x' })
    expect(r.moved).toBe(false)
    expect(c.calls[0].params[2]).toEqual(['acknowledged'])
  })
})
