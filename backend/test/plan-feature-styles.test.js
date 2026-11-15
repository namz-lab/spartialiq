/**
 * The symbology of the printed sheet's features (scripts/publish-plan-feature-styles.js): every style document is valid, and
 * every kind in the tile views has a category, so no feature is drawn in the "other" colour by accident.
 */
require('dotenv').config({ quiet: true })
const { Pool } = require('pg')
const { validate } = require('../src/services/gis/styleDoc')
const { LAYERS } = require('../scripts/publish-plan-feature-styles')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
afterAll(() => pool.end())

describe('plan feature styles', () => {
  test.each(LAYERS.map((l) => [l.layerId, l]))('%s is a valid style document', (_id, l) => {
    const v = validate(l.doc)
    expect(v.errors).toEqual([])
  })

  test.each([['vungu_facilities', 'public.vungu_facilities'], ['vungu_land_features', 'public.vungu_land_features']])(
    'every kind in %s has its own category', async (layerId, view) => {
      const { rows } = await pool.query(`SELECT DISTINCT kind FROM ${view}`)
      const styled = new Set(LAYERS.find((l) => l.layerId === layerId).doc.renderer.categories.map((c) => c.value))
      expect(rows.map((r) => r.kind).filter((k) => !styled.has(k))).toEqual([])
    })

  test('the tile views carry one unique fid per feature', async () => {
    const { rows } = await pool.query('SELECT count(*)::int AS n, count(DISTINCT fid)::int AS d FROM public.vungu_facilities')
    expect(rows[0].n).toBe(rows[0].d)
  })
})
