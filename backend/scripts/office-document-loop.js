// Office document loop.
//
// Signs one development file out of the registry to every other office,
// checks that office can open the file, then brings it back. Also writes
// the clerk's outward documents and a survey job that the surveyor answers
// with a report the planner can read.
//
// Launch from the backend folder while the API is on port 3000:
//   node scripts/office-document-loop.js
//
// Demo password is demo1234. The rows it creates stay in the registers,
// marked with the run stamp, so a clerk can see them in the morning.

const BASE = process.env.API_BASE || 'http://127.0.0.1:3000'
const PASSWORD = 'demo1234'
const STAMP = new Date().toISOString().slice(0, 16).replace('T', ' ')

const OFFICES = [
  ['planner', 'demo.planner@vungu.test', 'Town Planner'],
  ['eo_planner', 'demo.eo@vungu.test', 'Executive Officer'],
  ['gis_officer', 'demo.gis@vungu.test', 'GIS Officer'],
  ['building_inspector', 'demo.inspector@vungu.test', 'Building Inspector'],
  ['env_officer', 'demo.envoffice@vungu.test', 'Environmental Health Officer'],
  ['committee', 'demo.eo@vungu.test', 'Works Committee'],
  ['treasury', 'demo.clerk@vungu.test', 'Treasury'],
  ['legal', 'demo.admin@vungu.test', 'Legal'],
  ['registry', 'demo.clerk@vungu.test', 'Registry'],
  ['chief_executive', 'demo.admin@vungu.test', 'Chief Executive'],
]

const results = []

function record(step, ok, detail) {
  results.push({ step, ok, detail: String(detail).slice(0, 220) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}  ${detail}`)
}

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const json = await res.json().catch(() => ({}))
  const token = json?.data?.token || json?.token
  if (!res.ok || !token) throw new Error(`${email} login ${res.status}`)
  return token
}

async function call(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = {}
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text.slice(0, 180) } }
  return { status: res.status, json }
}

function due(days) {
  const d = new Date(Date.now() + days * 86400000)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const clerk = await login('demo.clerk@vungu.test')
  const found = await call(clerk, 'GET', '/api/planning-clerk/search?q=CIT')
  const permit = found.json?.data?.[0]
  if (!permit?.id) {
    record('find a file', false, `search ${found.status}`)
    finish(1)
    return
  }
  record('find a file', true, `${permit.stand_number || permit.tpd_reference || permit.id}`)
  const permitId = permit.id

  const stampNo = String(Date.now()).slice(-8)
  const papers = [
    ['correspondence', {
      direction: 'in', ref_no: `IN-${stampNo}`, party: 'Applicant',
      subject: `Office loop ${STAMP} incoming letter`, channel: 'in_person',
      permit_application_id: permitId,
    }],
    ['correspondence', {
      direction: 'out', ref_no: `OUT-${stampNo}`, party: 'Applicant',
      subject: `Office loop ${STAMP} outgoing letter`, channel: 'email',
      permit_application_id: permitId,
    }],
    ['receipts', {
      receipt_no: `LOOP-${stampNo}`, fee_kind: 'application', permit_application_id: permitId,
      payer_name: 'Office loop payer', amount: 50, currency: 'USD', payment_method: 'ecocash',
    }],
    ['acknowledgements', {
      letter_no: `ACK-${stampNo}`, permit_application_id: permitId,
      received_at: new Date().toISOString(), due_by: new Date(Date.now() + 14 * 86400000).toISOString(),
      recipient: 'Applicant', sent_at: new Date().toISOString(), sent_method: 'email',
    }],
    ['certificates', {
      permit_application_id: permitId, newspaper_name: 'The Chronicle',
      advert_date: due(0), filed_under_ref: `ADV-${stampNo}`,
    }],
    ['abutters', {
      permit_application_id: permitId, abutter_name: 'Neighbouring owner',
      abutter_address: 'Next stand, Vungu', method: 'hand_delivered',
    }],
    ['dispatches', {
      permit_application_id: permitId, delivery_method: 'email',
      recipient: 'Applicant', proof_of_delivery_ref: `POD-${stampNo}`,
    }],
    ['refusals', {
      letter_no: `REF-${stampNo}`, permit_application_id: permitId,
      council_resolution_date: new Date().toISOString(),
      due_by: new Date(Date.now() + 30 * 86400000).toISOString(),
      recipient: 'Applicant',
      reasons: `Office loop ${STAMP}: sample refusal letter so the outward register can be opened.`,
      sent_method: 'email',
    }],
    ['inspections', {
      permit_application_id: permitId, subject_description: `Office loop ${STAMP} public inspection`,
      requester_name: 'Member of the public', requester_capacity: 'member_of_public',
      request_kind: 'inspection',
    }],
  ]

  for (const [register, body] of papers) {
    const res = await call(clerk, 'POST', `/api/planning-clerk/registers/${register}`, body)
    const already = res.status === 409 && /already has/i.test(res.json?.message || '')
    record(
      `clerk writes ${register}`,
      res.status === 201 || already,
      already ? res.json.message : (res.json?.message || res.json?.error || res.json?.data?.id || res.status),
    )
  }

  for (const [destination, email, holder] of OFFICES) {
    const sent = await call(clerk, 'POST', '/api/planning-clerk/registers/movements', {
      permit_application_id: permitId,
      holder_name: holder,
      destination,
      purpose: `Office loop ${STAMP}: file to ${holder}`,
      due_back_on: due(7),
    })
    if (sent.status !== 201) {
      record(`sign out to ${destination}`, false, JSON.stringify(sent.json?.fields || sent.json?.error || sent.status))
      continue
    }
    const movementId = sent.json.data.id
    const reader = await login(email)
    const file = await call(reader, 'GET', `/api/planning-clerk/file/${permitId}`)
    const open = (file.json?.data?.registers?.movements || []).find((m) => m.id === movementId && !m.returned_at)
    record(
      `${holder} opens the file`,
      file.status === 200 && !!open,
      file.status === 200 ? `destination ${open?.destination || 'missing'}` : `${file.status} ${file.json?.error || ''}`,
    )
    const back = await call(clerk, 'PATCH', `/api/planning-clerk/registers/movements/${movementId}`, {
      returned_at: new Date().toISOString(),
      returned_condition: 'intact',
    })
    record(`file back from ${destination}`, back.status === 200, back.json?.error || back.status)
  }

  const planner = await login('demo.planner@vungu.test')
  const surveyorToken = await login('demo.surveyor@vungu.test')
  const me = await call(surveyorToken, 'GET', '/api/auth/me')
  const surveyorId = me.json?.data?.id || me.json?.data?.user?.id || me.json?.user?.id
  const job = await call(planner, 'POST', '/api/surveyor/jobs', {
    permit_app_id: permitId,
    task_type: 'verification',
    stand_number: permit.stand_number || 'CIT-SMK-1',
    instructions: `Office loop ${STAMP}: check the stand before the file returns to the clerk`,
    priority: 'normal',
    assigned_to: surveyorId,
  })
  record('planner sends a survey job', job.status === 201, job.json?.error || job.json?.data?.id || job.status)
  if (job.status === 201) {
    const jobId = job.json.data.id
    const report = await call(surveyorToken, 'POST', `/api/surveyor/jobs/${jobId}/documents`, {
      doc_type: 'report_on_survey',
      title: `Report on survey ${STAMP}`,
      content: 'The beacons were found. The stand matches the file.',
    })
    record('surveyor files the report', report.status === 201, report.json?.error || report.status)
    const note = await call(surveyorToken, 'POST', `/api/surveyor/jobs/${jobId}/comments`, {
      audience: 'planner',
      body: `Office loop ${STAMP}: report is on the job for the planner.`,
    })
    record('surveyor writes to the planner', note.status === 201, note.json?.error || note.status)
    const read = await call(planner, 'GET', `/api/surveyor/jobs/${jobId}`)
    const seen = (read.json?.data?.documents || []).some((d) => d.title?.includes(STAMP))
      && (read.json?.data?.comments || []).some((c) => String(c.body || '').includes(STAMP))
    record('planner reads the survey report', read.status === 200 && seen, read.status === 200 ? (seen ? 'report and note' : 'job opened, report missing') : read.status)
  }

  const refused = await call(await login('demo.viewer@vungu.test'), 'GET', `/api/planning-clerk/file/${permitId}`)
  record('a resident cannot open the office file', refused.status === 403, refused.status)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed} passed, ${failed} failed, file ${permitId}`)
  finish(failed ? 1 : 0)
}

function finish(code) {
  process.exitCode = code
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
