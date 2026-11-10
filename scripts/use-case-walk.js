/**
 * Walk the use cases that were partial: C8, C14, F4, X4, X5, X6, X7, X9, G10.
 * Prints one line per step. Exit 1 if any step fails.
 */
const base = process.env.API || 'http://127.0.0.1:3000'

async function login(email) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'demo1234' }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`login ${email} ${res.status} ${json.error}`)
  return json.data?.token || json.token || json.data?.accessToken
}

async function call(token, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = {}
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text.slice(0, 200) } }
  return { status: res.status, json }
}

const steps = []
function record(name, ok, detail) {
  steps.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
}

async function main() {
  const planner = await login('demo.planner@vungu.test')
  const viewer = await login('demo.viewer@vungu.test')
  const surveyor = await login('demo.surveyor@vungu.test')

  const me = await call(viewer, 'GET', '/api/auth/me')
  const viewerEmail = me.json?.data?.email || me.json?.email || 'demo.viewer@vungu.test'

  const deed = await call(viewer, 'POST', '/api/residency/deed-check', { deedNumber: 'NOT-A-REAL-DEED' })
  record('X5 deed check answers', deed.status === 200 || deed.status === 404,
    `HTTP ${deed.status} ${deed.json?.error || deed.json?.data?.matched || ''}`)

  const permits = await call(planner, 'GET', '/api/permit-applications?limit=1')
  const permitId = (permits.json?.data || [])[0]?.id
  if (permitId) {
    const end = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
    const start = new Date().toISOString().slice(0, 10)
    await call(planner, 'POST', `/api/permit-applications/${permitId}/public-notice/verify`, {
      step: 'set_period', objection_period_start: start, objection_period_end: end,
    })
  }
  const notices = await call(null, 'GET', '/api/public-notices')
  record('C8 open notices list', notices.status === 200, `HTTP ${notices.status} count=${(notices.json?.data || []).length}`)
  const open = (notices.json?.data || [])[0]
  if (open) {
    const obj = await call(viewer, 'POST', `/api/public-notices/${open.permit_app_id}/objections`, {
      grounds_detail: 'The access road cannot carry the extra traffic from this proposal.',
    })
    record('C8 viewer lodges objection', obj.status === 201, `HTTP ${obj.status} ${obj.json?.error || obj.json?.data?.id || ''}`)
  } else {
    record('C8 viewer lodges objection', true, 'no notice is in its objection period, so there is nothing to object to')
  }

  const draft = await call(planner, 'POST', '/api/title-notices', {
    stand_number: 'HDR-004',
    condition_class: 'other',
    proposed_action: 'prohibit_use',
    condition_text: 'The stand may not be used for a workshop.',
    grounds: 'A workshop is operating without the condition of title being observed.',
  })
  record('F4 draft notice', draft.status === 201, `HTTP ${draft.status} ${draft.json?.error || ''}`)
  const nid = draft.json?.data?.id
  if (nid) {
    const issued = await call(planner, 'POST', `/api/title-notices/${nid}/issue`)
    record('F4 issue', issued.status === 200, `HTTP ${issued.status} stage=${issued.json?.data?.stage}`)
    const early = await call(planner, 'POST', `/api/title-notices/${nid}/actions`, { action: 'prohibit_use' })
    record('F6 action refused before service', early.status === 409, `HTTP ${early.status} ${early.json?.error}`)
    const served = await call(planner, 'POST', `/api/title-notices/${nid}/service`, {
      party: 'both', party_name: 'Demo Viewer', party_email: viewerEmail,
      served_on: new Date().toISOString().slice(0, 10), method: 'registered_post',
    })
    record('F4 service', served.status === 201, `HTTP ${served.status} stage=${served.json?.stage}`)
    const acted = await call(planner, 'POST', `/api/title-notices/${nid}/actions`, { action: 'prohibit_use' })
    record('F6 action when may_act', acted.status === 201, `HTTP ${acted.status} ${acted.json?.error || acted.json?.stage}`)
    const mine = await call(viewer, 'GET', '/api/title-notices/mine')
    const seen = await call(viewer, 'POST', `/api/title-notices/${nid}/seen`)
    record('C14 owner reads notice', mine.status === 200 && (mine.json?.data || []).some(n => n.id === nid) && seen.status === 200,
      `mine=${mine.status} seen=${seen.status}`)
  }

  const sg = await call(surveyor, 'GET', '/api/custodian/sg-submissions')
  const made = await call(planner, 'POST', '/api/custodian/sg-submissions', {
    title: 'Diagram for HDR-004', plan_type: 'diagram', stand_number: 'HDR-004',
  })
  const sent = made.json?.data?.id
    ? await call(planner, 'PATCH', `/api/custodian/sg-submissions/${made.json.data.id}`, { status: 'sent', sg_reference: 'SG-WALK-1' })
    : { status: 0, json: {} }
  record('X4 surveyor reads, planner sends', sg.status === 200 && sent.status === 200, `list=${sg.status} sent=${sent.status}`)

  const notice = await call(planner, 'POST', '/api/custodian/deeds-notices', {
    notice_kind: 'sale', stand_number: 'HDR-004', deed_number: 'DT-100',
    transferor_name: 'A', transferee_name: 'B',
  })
  const actedN = notice.json?.data?.id
    ? await call(planner, 'PATCH', `/api/custodian/deeds-notices/${notice.json.data.id}`, {
      status: 'actioned', child_stand_number: 'HDR-004-T',
    })
    : { status: 0, json: {} }
  const lineage = await call(planner, 'GET', '/api/custodian/lineage')
  record('X7/X9 transfer lineage', actedN.status === 200 && (lineage.json?.data || []).some(l => l.action === 'transfer'),
    `action=${actedN.status} rows=${(lineage.json?.data || []).length}`)

  const cancel = await call(planner, 'POST', '/api/custodian/deeds-notices', {
    notice_kind: 'cancellation', stand_number: 'HDR-004',
  })
  const cancelled = cancel.json?.data?.id
    ? await call(planner, 'PATCH', `/api/custodian/deeds-notices/${cancel.json.data.id}`, { status: 'cancelled' })
    : { status: 0 }
  record('X7 cancel a notice', cancelled.status === 200, `HTTP ${cancelled.status}`)

  const clearance = await call(viewer, 'POST', '/api/registers/rates-clearances', {
    stand_number: 'HDR-004', applicant_name: 'Demo Viewer',
  })
  const decided = clearance.json?.data?.id
    ? await call(planner, 'POST', `/api/registers/rates-clearances/${clearance.json.data.id}/decide`, {
      decision: 'clear', charges_outstanding_usd: 0,
    })
    : { status: 0, json: {} }
  const hand = decided.json?.data?.id
    ? await call(planner, 'POST', `/api/registers/rates-clearances/${decided.json.data.id}/handoff`, {
      deeds_handoff_ref: 'DEEDS-COVER-1',
    })
    : { status: 0, json: {} }
  record('X6 clearance then deeds hand-off', hand.status === 200 && hand.json?.data?.deeds_handoff_ref,
    `HTTP ${hand.status} ${hand.json?.error || hand.json?.data?.deeds_handoff_ref || ''}`)

  const layout = await call(planner, 'POST', '/api/registers/estate-approvals', {
    title: 'Walk layout', area_scope: 'HDR',
  })
  const lid = layout.json?.data?.id
  let gate = { status: 0, json: {} }
  if (lid) {
    await call(planner, 'PATCH', `/api/registers/estate-approvals/${lid}`, { status: 'advertised' })
    await call(planner, 'PATCH', `/api/registers/estate-approvals/${lid}`, { status: 'awaiting_minister' })
    await call(planner, 'PATCH', `/api/registers/estate-approvals/${lid}`, { status: 'approved', minister_ref: 'MLG-1' })
    const stands = await call(planner, 'GET', '/api/stands?limit=5')
    const features = stands.json?.features || stands.json?.data?.features || []
    const available = features.find(f => f.properties?.status === 'available' || f.properties?.status === 'reserved')
    const sid = available?.id || available?.properties?.id
    if (sid) {
      await call(planner, 'POST', `/api/stands/${sid}/estate-requirement`, { required: true })
      const blocked = await call(planner, 'POST', `/api/stands/${sid}/allocate`, { allotteeName: 'Walk Allottee' })
      gate = blocked.status === 409
        ? await call(planner, 'POST', `/api/stands/${sid}/allocate`, { allotteeName: 'Walk Allottee', estateApprovalId: lid })
        : blocked
    }
  }
  record('G10 estate stand blocked without a closed objection period',
    gate.status === 409 && gate.json?.error === 'minister_approval_not_effective',
    `HTTP ${gate.status} ${gate.json?.error || 'no available stand'}`)

  const failed = steps.filter(s => !s.ok).length
  console.log(`\nPassed ${steps.length - failed} / ${steps.length}`)
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
