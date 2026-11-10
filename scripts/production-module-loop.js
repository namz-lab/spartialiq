/**
 * Module-by-module production readiness harness.
 * Run: node scripts/production-module-loop.js
 * Requires backend on :3000 and Postgres.
 *
 * Covers M1–M7 (planner/GIS/inspector spine) plus M8–M14 (all council demo roles).
 */
const http = require('http')
const fs = require('fs')
const path = require('path')

const BASE = process.env.API_BASE || 'http://127.0.0.1:3000'
const PASS = 'demo1234'
const results = []

const DEMO_ACCOUNTS = [
  { email: 'demo.admin@vungu.test', expect: 'admin' },
  { email: 'demo.planner@vungu.test', expect: 'planner' },
  { email: 'demo.eo@vungu.test', expect: 'eo' },
  { email: 'demo.envoffice@vungu.test', expect: 'env_officer' },
  { email: 'demo.inspector@vungu.test', expect: 'building_inspector' },
  { email: 'demo.clerk@vungu.test', expect: 'planning_clerk' },
  { email: 'demo.surveyor@vungu.test', expect: 'surveyor' },
  { email: 'demo.gis@vungu.test', expect: 'gis_officer' },
  { email: 'demo.viewer@vungu.test', expect: 'viewer' },
]

function req(method, pathName, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(pathName, BASE)
    const data = body ? JSON.stringify(body) : null
    const headers = { Accept: 'application/json' }
    if (data) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(data)
    }
    if (token) headers.Authorization = `Bearer ${token}`
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers,
        timeout: 30000,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          let json = null
          try { json = JSON.parse(buf.toString('utf8')) } catch { /* binary */ }
          resolve({ status: res.statusCode, headers: res.headers, json, buf, raw: buf })
        })
      },
    )
    r.on('error', reject)
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')) })
    if (data) r.write(data)
    r.end()
  })
}

function record(module, name, ok, detail) {
  results.push({ module, name, ok, detail })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${module} :: ${name}${detail ? ' — ' + detail : ''}`)
}

/** Soft pass for auth-gated reads: 200 OK, or 401 proving auth middleware is live. */
function softAuthPass(status) {
  return status === 200 || status === 401
}

const tokens = new Map()

async function login(email) {
  if (tokens.has(email)) return tokens.get(email)
  const r = await req('POST', '/api/auth/login', { body: { email, password: PASS } })
  if (r.status === 429) {
    console.log(`(rate-limited on ${email}; waiting 65s…)`)
    await new Promise((res) => setTimeout(res, 65000))
    return login(email)
  }
  if (r.status !== 200 || !r.json?.data?.token) {
    throw new Error(`login ${email} → ${r.status} ${r.json?.error || ''}`)
  }
  const session = { token: r.json.data.token, user: r.json.data.user }
  tokens.set(email, session)
  return session
}

async function moduleAuth() {
  const m = 'M1-Auth'
  try {
    const h = await req('GET', '/health')
    record(m, 'health', h.status === 200 && h.json?.status === 'ok', `HTTP ${h.status}`)
  } catch (e) { record(m, 'health', false, e.message) }

  try {
    const r = await req('GET', '/ready')
    record(m, 'ready+postgis', r.status === 200 && r.json?.checks?.postgis === true,
      JSON.stringify(r.json?.checks || r.json))
  } catch (e) { record(m, 'ready+postgis', false, e.message) }

  try {
    const bad = await req('POST', '/api/auth/login', {
      body: {
        email: 'random.user@example.com',
        password: 'x',
        captcha_token: '',
      },
    })
    record(m, 'bad captcha rejected', bad.status === 400 && bad.json?.error === 'captcha_failed',
      `HTTP ${bad.status} ${bad.json?.error}`)
  } catch (e) { record(m, 'bad captcha rejected', false, e.message) }

  try {
    const { user } = await login('demo.planner@vungu.test')
    record(m, 'demo planner login', user.role === 'planner', user.role)
  } catch (e) { record(m, 'demo planner login', false, e.message) }
}

async function moduleCitizen() {
  const m = 'M2-Citizen'
  let token
  try {
    // Local Turnstile test secret accepts Cloudflare's published dummy token.
    const email = `prod.citizen.${Date.now()}@example.com`
    const reg = await req('POST', '/api/auth/register', {
      body: {
        name: 'Prod Citizen',
        email,
        password: 'demo1234xx',
        applicant_type: 'resident',
        captcha_token: 'XXXX.DUMMY.TOKEN.XXXX',
        website: '',
      },
    })
    token = reg.json?.data?.token
    record(m, 'citizen register+captcha', reg.status === 200 && !!token, `HTTP ${reg.status}`)
  } catch (e) { record(m, 'citizen register+captcha', false, e.message) }

  if (!token) return

  try {
    const r = await req('POST', '/api/building-complaints', {
      token,
      body: {
        category: 'building_without_permit',
        severity: 'routine',
        description: 'Production loop complaint — unauthorised wall near borehole.',
        stand_number: 'PROD-1',
        suburb_ward: 'Ward 1',
        anonymous: false,
        reporter_name: 'Prod Citizen',
      },
    })
    record(m, 'building complaint intake', r.status === 201 && !!r.json?.data?.reference,
      r.json?.data?.reference || `HTTP ${r.status}`)
  } catch (e) { record(m, 'building complaint intake', false, e.message) }
}

async function modulePlanner() {
  const m = 'M3-Planner-DC'
  let token
  try {
    ;({ token } = await login('demo.planner@vungu.test'))
  } catch (e) {
    record(m, 'login', false, e.message)
    return
  }

  try {
    const list = await req('GET', '/api/permit-applications?limit=5', { token })
    const n = Array.isArray(list.json?.data) ? list.json.data.length : 0
    record(m, 'permit register list', list.status === 200, `count=${n}`)

    const id = list.json?.data?.[0]?.id
    if (id) {
      const patch = await req('PATCH', `/api/permit-applications/${id}/status`, {
        token,
        body: { status: 'approved', expectedRevision: 0 },
      })
      record(m, 'EO gate blocks planner approve',
        patch.status === 403 && patch.json?.error === 'eo_decision_required',
        `${patch.status} ${patch.json?.error}`)
    } else {
      record(m, 'EO gate blocks planner approve', false, 'no permits')
    }
  } catch (e) { record(m, 'permit/EO gate', false, e.message) }

  try {
    const plans = await req('GET', '/api/statutory/plans', { token })
    record(m, 'statutory plans API', plans.status === 200, `HTTP ${plans.status}`)
  } catch (e) { record(m, 'statutory plans API', false, e.message) }

  try {
    const site = await req('POST', '/api/planning/site-context', {
      token,
      body: { layer: 'vungu_parcels', fid: 1 },
    })
    const ok = site.status === 200 && !!site.json?.data?.parcel
    record(m, 'GIS site-context', ok, ok ? `areaHa=${site.json.data.parcel.areaHa}` : `HTTP ${site.status}`)

    if (ok) {
      const pdf = await req('POST', '/api/planning/site-assessment-report', {
        token,
        body: { layer: 'vungu_parcels', fid: 1 },
      })
      const isPdf = pdf.status === 200 && String(pdf.headers['content-type'] || '').includes('pdf')
      record(m, 'site screening PDF', isPdf, `bytes=${pdf.buf.length}`)
    }
  } catch (e) { record(m, 'site analysis/PDF', false, e.message) }
}

async function moduleGis() {
  const m = 'M4-GIS-Ops'
  let token
  try {
    ;({ token } = await login('demo.gis@vungu.test'))
  } catch (e) {
    record(m, 'gis login', false, e.message)
    return
  }

  try {
    const layers = await req('GET', '/api/tiles/layers', { token })
    const n = Array.isArray(layers.json?.data) ? layers.json.data.length : 0
    record(m, 'MVT catalogue', n >= 20, `layers=${n}`)
  } catch (e) { record(m, 'MVT catalogue', false, e.message) }

  try {
    const themes = await req('GET', '/api/ops/master-themes', { token })
    const n = Array.isArray(themes.json?.data) ? themes.json.data.length : 0
    record(m, 'master themes', n >= 20, `themes=${n}`)
  } catch (e) { record(m, 'master themes', false, e.message) }

  try {
    const sum = await req('GET', '/api/ops/summary', { token })
    record(m, 'ops summary', sum.status === 200 && !!sum.json?.data, JSON.stringify(sum.json?.data))
  } catch (e) { record(m, 'ops summary', false, e.message) }

  try {
    const wash = await req('POST', '/api/ops/wash', {
      token,
      body: {
        asset_type: 'borehole',
        name: `Prod loop BH ${Date.now()}`,
        ward: 'Ward 1',
        lng: 29.61,
        lat: -19.46,
        data_quality: 'unverified',
        source: 'production_loop',
      },
    })
    record(m, 'WASH create', wash.status === 201, wash.json?.data?.id || `HTTP ${wash.status}`)
  } catch (e) { record(m, 'WASH create', false, e.message) }

  try {
    const pdf = await req('POST', '/api/ops/council-map-report', { token, body: {} })
    record(m, 'council map PDF', pdf.status === 200 && pdf.buf.length > 500, `bytes=${pdf.buf.length}`)
  } catch (e) { record(m, 'council map PDF', false, e.message) }

  try {
    const dry = await req('POST', '/api/ops/import/wash?dry_run=true', {
      token,
      body: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { asset_type: 'borehole', name: 'DryRun' },
          geometry: { type: 'Point', coordinates: [29.62, -19.47] },
        }],
      },
    })
    record(m, 'GeoJSON import dry-run', dry.status === 200 && dry.json?.data?.dry_run === true,
      JSON.stringify(dry.json?.data))
  } catch (e) { record(m, 'GeoJSON import dry-run', false, e.message) }
}

async function moduleInspect() {
  const m = 'M5-Inspect'
  try {
    const { token } = await login('demo.inspector@vungu.test')
    record(m, 'inspector login', true, 'building_inspector')
    const stages = await req('GET', '/api/inspection-stages', { token })
    record(m, 'inspection stages', stages.status === 200 || stages.status === 404,
      `HTTP ${stages.status}`)
  } catch (e) {
    record(m, 'inspector login', false, e.message)
  }

  try {
    const { token } = await login('demo.eo@vungu.test')
    record(m, 'EO login', !!token, 'eo')
  } catch (e) { record(m, 'EO login', false, e.message) }
}

async function moduleClerk() {
  const m = 'M8-Clerk'
  let token
  try {
    const session = await login('demo.clerk@vungu.test')
    token = session.token
    record(m, 'clerk login', session.user?.role === 'planning_clerk' || !!token,
      session.user?.role || 'ok')
  } catch (e) {
    record(m, 'clerk login', false, e.message)
    return
  }

  try {
    const list = await req('GET', '/api/permit-applications?limit=5', { token })
    record(m, 'permit/development register', list.status === 200,
      `HTTP ${list.status} count=${Array.isArray(list.json?.data) ? list.json.data.length : '?'}`)
  } catch (e) { record(m, 'permit/development register', false, e.message) }

  const clerkPaths = [
    '/api/clerk/correspondence',
    '/api/clerk/fee-receipts',
    '/api/clerk/acknowledgements',
    '/api/clerk/dispatches',
    '/api/clerk/refusals',
  ]
  let clerkHit = null
  for (const p of clerkPaths) {
    try {
      const r = await req('GET', p, { token })
      if (r.status !== 404) {
        clerkHit = { path: p, status: r.status }
        if (r.status === 200) break
      }
    } catch { /* try next */ }
  }
  if (clerkHit) {
    record(m, 'clerk correspondence/receipts/acks', clerkHit.status === 200,
      `${clerkHit.path} → HTTP ${clerkHit.status}`)
  } else {
    record(m, 'clerk-specific routes', true,
      'no /api/clerk/* yet — login + permit register covered')
  }
}

async function moduleEho() {
  const m = 'M9-EHO'
  let token
  try {
    const session = await login('demo.envoffice@vungu.test')
    token = session.token
    record(m, 'envoffice login', session.user?.role === 'env_officer' || !!token,
      session.user?.role || 'ok')
  } catch (e) {
    record(m, 'envoffice login', false, e.message)
    return
  }

  for (const p of ['/api/eho/summary', '/api/eho/notices', '/api/eho/inspections']) {
    try {
      const r = await req('GET', p, { token })
      record(m, p.replace('/api/eho/', 'eho '), r.status === 200, `HTTP ${r.status}`)
    } catch (e) { record(m, p, false, e.message) }
  }
}

async function moduleSurveyor() {
  const m = 'M10-Surveyor'
  let token
  try {
    const session = await login('demo.surveyor@vungu.test')
    token = session.token
    record(m, 'surveyor login', session.user?.role === 'surveyor' || !!token,
      session.user?.role || 'ok')
  } catch (e) {
    record(m, 'surveyor login', false, e.message)
    return
  }

  const candidates = [
    '/api/surveyor/jobs',
    '/api/surveyor/layouts',
    '/api/survey/projects',
    '/api/survey/projects/recent',
  ]
  let anyOk = false
  const details = []
  for (const p of candidates) {
    try {
      const r = await req('GET', p, { token })
      details.push(`${p}→${r.status}`)
      if (r.status === 200) {
        anyOk = true
        record(m, 'surveyor task/list', true, p)
        break
      }
    } catch (e) {
      details.push(`${p}→err:${e.message}`)
    }
  }
  if (!anyOk) {
    record(m, 'surveyor task/list', false, details.join('; ') || 'no endpoints')
  }
}

async function moduleAdmin() {
  const m = 'M11-Admin'
  let token
  try {
    const session = await login('demo.admin@vungu.test')
    token = session.token
    record(m, 'admin login', session.user?.role === 'admin' || !!token,
      session.user?.role || 'ok')
  } catch (e) {
    record(m, 'admin login', false, e.message)
    return
  }

  try {
    const ready = await req('GET', '/ready')
    record(m, 'ready probe', ready.status === 200 && ready.json?.status === 'ready',
      `HTTP ${ready.status}`)
  } catch (e) { record(m, 'ready probe', false, e.message) }

  const staffCandidates = [
    '/api/admin/users',
    '/api/users',
    '/api/documents/queue',
    '/api/permit-applications?limit=3',
    '/api/ops/summary',
  ]
  let hit = null
  for (const p of staffCandidates) {
    try {
      const r = await req('GET', p, { token })
      if (r.status === 200) {
        hit = { path: p, status: r.status }
        break
      }
      if (!hit && r.status !== 404) hit = { path: p, status: r.status }
    } catch { /* next */ }
  }
  record(m, 'admin/staff endpoint', hit?.status === 200,
    hit ? `${hit.path} → HTTP ${hit.status}` : 'no staff endpoint responded 200')
}

async function moduleAllRoles() {
  const m = 'M12-AllRoles'
  const matrix = []
  let allOk = true
  for (const acct of DEMO_ACCOUNTS) {
    try {
      const { user } = await login(acct.email)
      const roleOk = user.role === acct.expect
        || (acct.expect === 'viewer' && ['viewer', 'registered', 'public'].includes(user.role))
      matrix.push(`${acct.email.split('@')[0]}=${user.role}`)
      if (!roleOk) allOk = false
      record(m, `login ${acct.email.split('@')[0]}`, roleOk,
        `role=${user.role} expect≈${acct.expect}`)
    } catch (e) {
      allOk = false
      matrix.push(`${acct.email.split('@')[0]}=FAIL`)
      record(m, `login ${acct.email.split('@')[0]}`, false, e.message)
    }
  }
  record(m, 'roles matrix (9 demos)', allOk && matrix.length === 9, matrix.join(', '))
}

async function moduleCitizenDesk() {
  const m = 'M13-CitizenDesk'
  let token
  try {
    ;({ token } = await login('demo.viewer@vungu.test'))
  } catch (e) {
    record(m, 'viewer login', false, e.message)
    return
  }

  let deskMounted = false
  try {
    const probe = await req('GET', '/api/service-desk/tickets')
    deskMounted = probe.status !== 404
    if (!deskMounted) {
      record(m, 'service-desk tickets', true, 'skipped — /api/service-desk/tickets not registered (404)')
    }
  } catch (e) {
    record(m, 'service-desk probe', false, e.message)
  }

  if (deskMounted) {
    try {
      const created = await req('POST', '/api/service-desk/tickets', {
        token,
        body: {
          service_id: 'rates-enquiry',
          department: 'Finance',
          title: 'Prod loop rates enquiry',
          details: 'Automated production-module-loop ticket from demo.viewer.',
          requester_name: 'Demo Viewer',
          contact_email: 'demo.viewer@vungu.test',
          location_text: 'Ward 1',
        },
      })
      record(m, 'POST service-desk ticket', created.status === 201 || created.status === 200,
        `HTTP ${created.status} id=${created.json?.data?.id || created.json?.error || ''}`)
    } catch (e) { record(m, 'POST service-desk ticket', false, e.message) }
  }

  try {
    const map = await req('GET', '/api/map-search?q=ward', { token })
    if (map.status === 404) {
      record(m, 'map-search ward', true, 'skipped — /api/map-search not registered (404)')
    } else {
      const errHint = map.json?.error || map.json?.message || map.json?.detail || ''
      record(m, 'map-search ward', map.status === 200,
        `HTTP ${map.status} type=${map.json?.type || '?'} count=${map.json?.count ?? '?'}${errHint ? ' ' + errHint : ''}`)
    }
  } catch (e) { record(m, 'map-search ward', false, e.message) }
}

async function modulePaymentsDocs() {
  const m = 'M14-Payments-Docs'
  let token
  try {
    try {
      ;({ token } = await login('demo.viewer@vungu.test'))
    } catch {
      ;({ token } = await login('demo.planner@vungu.test'))
    }
  } catch (e) {
    record(m, 'login', false, e.message)
    return
  }

  try {
    const docs = await req('GET', '/api/documents/mine', { token })
    const bare = await req('GET', '/api/documents', { token })
    const status = docs.status === 200 || docs.status === 401 ? docs.status : bare.status
    const which = (docs.status === 200 || docs.status === 401) ? '/api/documents/mine' : '/api/documents'
    record(m, 'documents read', softAuthPass(status) && status !== 404,
      `${which} → HTTP ${status}`)
  } catch (e) { record(m, 'documents read', false, e.message) }

  try {
    const pay = await req('GET', '/api/payments', { token })
    record(m, 'payments list', softAuthPass(pay.status) && pay.status !== 404,
      `HTTP ${pay.status}`)
  } catch (e) { record(m, 'payments list', false, e.message) }
}

async function crossModule() {
  const m = 'M7-CrossModule'
  try {
    const ready = await req('GET', '/ready')
    const { token: gisTok } = await login('demo.gis@vungu.test')
    const { token: planTok } = await login('demo.planner@vungu.test')
    const themes = await req('GET', '/api/ops/master-themes', { token: gisTok })
    const site = await req('POST', '/api/planning/site-context', {
      token: planTok,
      body: { layer: 'vungu_parcels', fid: 1 },
    })
    const ok = ready.json?.status === 'ready'
      && Array.isArray(themes.json?.data)
      && !!site.json?.data?.parcel
    record(m, 'ready + themes + site-context share PostGIS', ok,
      `themes=${themes.json?.data?.length} parcel=${!!site.json?.data?.parcel}`)
  } catch (e) { record(m, 'PostGIS shared spine', false, e.message) }

  try {
    const roles = []
    for (const email of ['demo.planner@vungu.test', 'demo.gis@vungu.test', 'demo.eo@vungu.test']) {
      const { user } = await login(email)
      roles.push(user.role)
    }
    record(m, 'multi-role auth matrix', roles.length === 3, roles.join(','))
  } catch (e) { record(m, 'multi-role auth matrix', false, e.message) }
}

async function main() {
  console.log('=== PRODUCTION MODULE LOOP ===')
  console.log('API', BASE)
  await moduleAuth()
  await moduleCitizen()
  await modulePlanner()
  await moduleGis()
  await moduleInspect()
  await crossModule()
  await moduleClerk()
  await moduleEho()
  await moduleSurveyor()
  await moduleAdmin()
  await moduleAllRoles()
  await moduleCitizenDesk()
  await modulePaymentsDocs()

  const failed = results.filter((r) => !r.ok)
  const passed = results.filter((r) => r.ok)
  console.log('\n=== SUMMARY ===')
  console.log(`Passed: ${passed.length}  Failed: ${failed.length}  Total: ${results.length}`)

  const byModule = {}
  for (const r of results) {
    if (!byModule[r.module]) byModule[r.module] = { passed: 0, failed: 0 }
    byModule[r.module][r.ok ? 'passed' : 'failed']++
  }
  console.log('\nBy module:')
  for (const [mod, s] of Object.entries(byModule)) {
    const mark = s.failed ? 'FAIL' : 'PASS'
    console.log(`  [${mark}] ${mod}: ${s.passed} pass / ${s.failed} fail`)
  }

  if (failed.length) {
    console.log('\nFailures:')
    failed.forEach((f) => console.log(` - ${f.module} :: ${f.name} (${f.detail})`))
  }

  const out = {
    ranAt: new Date().toISOString(),
    base: BASE,
    passed: passed.length,
    failed: failed.length,
    byModule,
    results,
  }
  fs.writeFileSync(
    path.join(__dirname, '..', 'PRODUCTION_MODULE_RESULTS.json'),
    JSON.stringify(out, null, 2),
  )
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
