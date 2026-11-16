// Removes everything capture.js created (listed in created.json): the example cases and what hangs off them, the meetings and the members.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const f = path.join(__dirname, 'created.json')
if (!fs.existsSync(f)) { console.log('nothing to clean'); process.exit(0) }
const c = JSON.parse(fs.readFileSync(f, 'utf8'))
const psql = (sql) => execSync(`docker exec lamis-db psql -U postgres -d vungu_master_db_v1 -At -c "${sql}"`, { encoding: 'utf8' }).trim()
const list = (a) => a.map((x) => `'${x}'`).join(',')
if (c.permits.length) {
  const ids = list(c.permits)
  for (const t of ['case_referral', 'public_notice', 'application_objection', 'permit_event', 'generated_document', 'eo_handoff_package', 'agenda_item', 'permit_rule_snapshot'])
    try { psql(`DELETE FROM spatial_planning.${t} WHERE ${t === 'permit_rule_snapshot' ? 'permit_id' : 'permit_app_id'} IN (${ids})`) } catch (e) { /* table or column differs */ }
}
if (c.meetings.length) psql(`DELETE FROM spatial_planning.committee_meeting WHERE id IN (${list(c.meetings)})`)
if (c.members.length) psql(`DELETE FROM spatial_planning.committee_member WHERE id IN (${list(c.members)})`)
if (c.permits.length) psql(`DELETE FROM spatial_planning.permit_application WHERE id IN (${list(c.permits)})`)
fs.unlinkSync(f)
console.log('cleaned', c.permits.length, 'cases,', c.meetings.length, 'meetings,', c.members.length, 'members')
