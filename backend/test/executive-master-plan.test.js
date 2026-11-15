/**
 * What the Chief Executive reads about the master plan (src/services/executiveMasterPlan.js, GET /api/executive/master-plan), against the loaded Vungu plan.
 * The route's access rules are pinned with the overview's, in src/routes/__tests__/executive-overview.test.js.
 */
require('dotenv').config({ quiet: true })
const { Pool } = require('pg')
const { read } = require('../src/services/executiveMasterPlan')

describe('the master plan for the chief executive', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  afterAll(() => pool.end())

  test('says which plan, that it is not in force, and how far its adoption has got', async () => {
    const d = await read(pool)
    expect(d.plan).toMatchObject({ revision_label: 'Rev 005', map_scale: 120000, in_force: false })
    expect(d.adoption.of).toBe(d.adoption.steps.length)
    expect(d.adoption.steps.map((s) => s.code)).toEqual(expect.arrayContaining(['council_adoption', 'signature:chief_executive', 'ministerial_approval', 'gazetted']))
    expect(d.adoption.steps.find((s) => s.code === 'gazetted').done).toBe(false)
  })

  test('lists every zone with its area, share, parcels and what the plan decides there', async () => {
    const d = await read(pool)
    expect(d.zones.length).toBeGreaterThanOrEqual(18)
    const sum = d.zones.reduce((a, z) => a + z.share_pct, 0)
    expect(Math.round(sum)).toBe(100)
    for (const z of d.zones) {
      expect(z.permitted + z.special_consent + z.prohibited + z.not_decided).toBe(d.decisions.uses_in_plan)
      expect(z.bbox).toHaveLength(4)
    }
  })

  test('counts the parcels the plan covers and those it does not, and they add up', async () => {
    const { coverage } = await read(pool)
    expect(coverage.zoned + coverage.unzoned).toBe(coverage.parcels)
    expect(coverage.parcels).toBeGreaterThan(0)
  })

  test('reports decisions only affirmed for testing as that, never as the council\'s', async () => {
    const d = await read(pool)
    expect(d.decisions.tested_on_affirmation).toBe(d.decisions.affirmed_for_testing > 0)
  })

  test('holds the facilities, land features, targeted farms and retained zones beside the plan', async () => {
    const { held } = await read(pool)
    expect(held.facilities.find((f) => f.kind === 'school').n).toBe(102)
    expect(held.land_features.find((f) => f.kind === 'mine').n).toBe(41)
    expect(held.targeted_farms).toEqual({ targeted: 283, linked: 278 })
    expect(held.retained_zones).toBe(16)
  })
})
