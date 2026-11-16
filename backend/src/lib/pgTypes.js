/**
 * Plain dates stay plain dates.
 *
 * node-postgres turns a DATE column into a JavaScript Date at LOCAL midnight. On a server in Harare time (UTC+2) the date 2026-11-16 is then
 * serialised as "2026-11-15T22:00:00.000Z", and any screen that cuts the date text shows the previous day. A DATE has no time and no zone; it is
 * returned as the text "YYYY-MM-DD", which means the same on every machine. (timestamp and timestamptz columns are not touched.)
 *
 * Required once, before the first query: by server.js and by the test app.
 */
const { types } = require('pg')

const DATE_OID = 1082
types.setTypeParser(DATE_OID, (value) => value)

module.exports = { DATE_OID }
