#!/usr/bin/env node
/**
 * Shows Vungu's zones to the public for a DEMONSTRATION of the draft plan, or takes them back.
 *
 *   node scripts/publish-zones-preview.js            show the current state
 *   node scripts/publish-zones-preview.js --on       the public may see the zones
 *   node scripts/publish-zones-preview.js --off      back to staff only (the default)
 *
 * Two gates keep a draft plan's zones from the public, and --on opens both, on the record:
 *   1. plan_instrument.public_preview (migration 219): a plan's zones are visible to the public only if the plan is
 *      gazetted. The Vungu plan is NOT gazetted (status 'unknown', no gazette reference); this switch shows it anyway.
 *   2. layer_publication: the portal exposes a table only if the server has approved it for the public audience.
 *      The zone layers' records are set to 'public', approved by "MVP demonstration (plan not gazetted)", with a note.
 *
 * Nothing about the plan's status changes: it is still a draft, and its zone types are unreviewed. A person looking at the
 * public map is looking at a draft. Use --off before anyone relies on it as the Council's act.
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') })
const { Client } = require('pg')

const PLAN_TITLE = 'Vungu RDC peri-urban local plan (as mapped)'
const TABLES = ['zones_master', 'proposed_peri_urban_zones', 'vungu_beyond_peri_urban_zones']
const WHO = 'MVP demonstration (plan not gazetted)'
const NOTE = 'Public preview of a DRAFT plan for demonstrating the MVP. The plan is not gazetted. Reverse with scripts/publish-zones-preview.js --off.'

const on = process.argv.includes('--on')
const off = process.argv.includes('--off')
if (on && off) { console.error('Give --on or --off, not both.'); process.exit(1) }

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try {
    const { rows: [plan] } = await db.query('SELECT id, status, gazette_ref, public_preview FROM public.plan_instrument WHERE title = $1', [PLAN_TITLE])
    if (!plan) throw new Error(`The plan "${PLAN_TITLE}" does not exist.`)
    if (on || off) {
      await db.query('BEGIN')
      await db.query('UPDATE public.plan_instrument SET public_preview = $2 WHERE id = $1', [plan.id, on])
      for (const t of TABLES) {
        await db.query(
          `INSERT INTO public.layer_publication (table_name, audience, approved_by, approved_at, note)
           VALUES ($1, $2, $3, now(), $4)
           ON CONFLICT (table_name) DO UPDATE SET audience = EXCLUDED.audience, approved_by = EXCLUDED.approved_by,
                  approved_at = now(), note = EXCLUDED.note`,
          [t, on ? 'public' : 'staff', on ? WHO : 'scripts/publish-zones-preview.js --off', on ? NOTE : 'Back to staff only.'])
      }
      await db.query('COMMIT')
    }
    const { rows: [now] } = await db.query('SELECT status, gazette_ref, public_preview FROM public.plan_instrument WHERE id = $1', [plan.id])
    const { rows: pubs } = await db.query('SELECT table_name, audience FROM public.layer_publication WHERE table_name = ANY($1) ORDER BY 1', [TABLES])
    console.log(`[zones-preview] plan status "${now.status}", gazette reference ${now.gazette_ref ?? 'none'}; public preview ${now.public_preview ? 'ON' : 'off'}`)
    for (const p of pubs) console.log(`[zones-preview]   ${p.table_name}: ${p.audience}`)
    if (now.public_preview) console.log('[zones-preview] The zones are public and the plan is still a DRAFT. Use --off to take them back.')
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error('[zones-preview] failed:', err.message); process.exit(1) })
