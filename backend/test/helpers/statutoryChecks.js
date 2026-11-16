/**
 * Answer the statutory questions on a case (POST /permit-applications/:id/statutory-checks), as the EO does before an approval.
 * By default every answer is "no"; pass `overrides` to say "yes" to some.
 */
const KEYS = ['road_within_200m', 'aviation_olz', 'neighbouring_authority', 'agricultural_subdivision', 'title_condition_conflict', 'adverse_or_nonconforming']

async function answerChecks(app, token, id, overrides = {}) {
  const answers = Object.fromEntries(KEYS.map((k) => [k, false]))
  Object.assign(answers, overrides)
  const res = await app.inject({
    method: 'POST', url: `/api/permit-applications/${id}/statutory-checks`,
    headers: { authorization: `Bearer ${token}` }, payload: { answers },
  })
  if (res.statusCode !== 200) throw new Error(`statutory checks not recorded: ${res.statusCode} ${res.body}`)
  return res
}

module.exports = { answerChecks, KEYS }
