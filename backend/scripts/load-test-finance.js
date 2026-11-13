#!/usr/bin/env node
/**
 * Finance module load test.
 *
 * Starts the real finance Fastify app against a database prepared by
 * scripts/seed-load-dataset.js, then drives a closed-loop mix of the read paths a council uses:
 *
 *   public portal   overview, transactions, budget, projects   (no session)
 *   staff screens   budget register, departmental performance, budget-vs-actual report,
 *                   transaction register export
 *
 * WHY THE SERVER IS A SEPARATE PROCESS
 * The generator and the server would otherwise share one Node event loop. Serialising an 8 MB
 * transaction register would then stall the server and the reported latency would describe the
 * harness, not the application. In --serve mode this file only serves; the default mode forks it
 * and drives it over HTTP.
 *
 * The numbers are end-to-end HTTP latency: routing, JWT/session verification, the tenancy
 * context, SQL, serialisation and transfer. They are not a database benchmark.
 *
 * USAGE
 *   DATABASE_URL='postgresql://…/vungu_workflow_test' node scripts/load-test-finance.js --check
 *   DATABASE_URL=… node scripts/load-test-finance.js
 *   DATABASE_URL=… node scripts/load-test-finance.js --levels 1,10,30 --seconds 15 --json out.json
 *   DATABASE_URL=… node scripts/load-test-finance.js --url http://127.0.0.1:3000   # existing server
 *
 * --check sends one request per scenario and prints status, latency and payload size. Run it
 * first: a load run against a mis-seeded database measures the wrong thing.
 *
 * The app is built with the production pool size (server.js sets max: 30) so a queueing effect is
 * visible rather than hidden by the test helper's default of 10.
 */
require('dotenv').config()
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const { Client } = require('pg')
const { buildFinanceAppForTest } = require('../test/helpers/buildApp')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const POOL_MAX = Number(process.env.LOAD_POOL_MAX || 30)
const args = process.argv.slice(2)
const CHECK = args.includes('--check')
const SERVE = args.includes('--serve')
const argValue = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const LEVELS = argValue('--levels', '1,10,30').split(',').map(Number)
const SECONDS = Number(argValue('--seconds', 12))
const WARMUP_SECONDS = Number(argValue('--warmup', 3))
const OUT = argValue('--json', null)
const EXTERNAL_URL = argValue('--url', null)
const ONLY = argValue('--only', null)

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}
const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, '')
if (!/test/i.test(dbName) && process.env.ALLOW_NON_TEST_DB !== '1') {
  console.error(`Refusing: ${dbName} does not look like a test database (set ALLOW_NON_TEST_DB=1 to override)`)
  process.exit(1)
}

function percentile(sorted, p) {
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

function summarise(latencies, statuses, errors, elapsedMs) {
  const sorted = [...latencies].sort((a, b) => a - b)
  const total = latencies.length + errors.length
  const mean = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null
  const statusCounts = {}
  for (const status of statuses) statusCounts[status] = (statusCounts[status] || 0) + 1
  return {
    requests: total,
    completed: latencies.length,
    errors: errors.length,
    error_rate: total ? Number((errors.length / total * 100).toFixed(2)) : 0,
    status_counts: statusCounts,
    rps: elapsedMs > 0 ? Number((total / (elapsedMs / 1000)).toFixed(1)) : 0,
    latency_ms: sorted.length ? {
      min: Number(sorted[0].toFixed(1)),
      mean: Number(mean.toFixed(1)),
      p50: Number(percentile(sorted, 50).toFixed(1)),
      p95: Number(percentile(sorted, 95).toFixed(1)),
      p99: Number(percentile(sorted, 99).toFixed(1)),
      max: Number(sorted[sorted.length - 1].toFixed(1)),
    } : null,
    sample_errors: errors.slice(0, 5),
  }
}

/** Query the seeded year. Runs in the parent; the child only serves. */
async function loadYear() {
  const db = new Client({ connectionString: DATABASE_URL })
  await db.connect()
  try {
    const { rows } = await db.query(
      `SELECT id, label FROM finance.financial_year
        WHERE label LIKE 'LOAD-%' AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
    )
    if (!rows[0]) throw new Error('No LOAD- financial year. Run scripts/seed-load-dataset.js first.')
    const { rows: counts } = await db.query(
      `SELECT count(*)::int AS transactions FROM finance.transaction WHERE source_system = 'LOADTEST'`,
    )
    return { id: process.env.LOAD_YEAR_ID || rows[0].id, label: rows[0].label, transactions: counts[0].transactions }
  } finally {
    await db.end()
  }
}

/** --serve: start the app and print its port. The parent owns the lifecycle. */
async function serve() {
  const app = await buildFinanceAppForTest({ poolMax: POOL_MAX })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  process.stdout.write(`READY ${address.port}\n`)
  const stop = async () => {
    try { await app.close() } finally { process.exit(0) }
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  // Keep the event loop alive; the parent kills this process when the run is over.
  setInterval(() => {}, 1 << 30)
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, '--serve'], {
      cwd: __dirname,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('server did not start within 30s')), 30000)
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      const match = buffer.match(/READY (\d+)/)
      if (match) {
        clearTimeout(timer)
        resolve({ child, base: `http://127.0.0.1:${match[1]}` })
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`server exited early with code ${code}`))
    })
  })
}

async function main() {
  if (SERVE) return serve()

  const year = await loadYear()
  console.log(`[load] database=${dbName} year=${year.label} (${year.id}) transactions=${year.transactions} pool=${POOL_MAX}`)

  let child = null
  let base = EXTERNAL_URL
  if (!base) {
    const started = await startServer()
    child = started.child
    base = started.base
  }
  console.log(`[load] target ${base}`)

  try {
    const tokens = {}
    const login = async (email) => {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: PASSWORD }),
      })
      if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${await res.text()}`)
      const cookies = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : [res.headers.get('set-cookie') || '']
      const access = cookies.find((c) => c.startsWith('vungu_at='))
      if (!access) throw new Error(`login ${email} returned no vungu_at cookie`)
      await res.arrayBuffer()
      return access.split(';')[0].slice('vungu_at='.length)
    }
    tokens.auditor = await login('demo.auditor@vungu.test')
    tokens.financeAdmin = await login('demo.finance-admin@vungu.test')

    const q = (params) => new URLSearchParams({ financial_year_id: year.id, ...params }).toString()
    const allScenarios = [
      { name: 'public_overview', auth: null, url: `${base}/api/public/finance/overview?${q({})}`, expect: 200 },
      { name: 'public_transactions', auth: null, url: `${base}/api/public/finance/transactions?${q({ limit: '50' })}`, expect: 200 },
      { name: 'public_budget', auth: null, url: `${base}/api/public/finance/budget?${q({ limit: '50' })}`, expect: 200 },
      { name: 'public_projects', auth: null, url: `${base}/api/public/finance/projects?${q({})}`, expect: 200 },
      { name: 'admin_budget_lines', auth: 'auditor', url: `${base}/api/finance/budget-lines?${q({ limit: '100' })}`, expect: 200 },
      { name: 'admin_performance', auth: 'auditor', url: `${base}/api/finance/performance?${q({})}`, expect: 200 },
      { name: 'admin_report_budget_vs_actual', auth: 'auditor', url: `${base}/api/finance/reports/run?${q({ report: 'budget_vs_actual', format: 'json' })}`, expect: 200 },
      { name: 'admin_report_transaction_register', auth: 'auditor', url: `${base}/api/finance/reports/run?${q({ report: 'transaction_register', format: 'json' })}`, expect: 200 },
    ]
    const scenarios = ONLY ? allScenarios.filter((s) => ONLY.split(',').includes(s.name)) : allScenarios
    if (!scenarios.length) throw new Error(`--only matched no scenario: ${ONLY}`)

    const call = async (scenario) => {
      const started = process.hrtime.bigint()
      const res = await fetch(scenario.url, {
        headers: scenario.auth ? { authorization: `Bearer ${tokens[scenario.auth]}` } : {},
      })
      const body = await res.text()
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      return { status: res.status, ms, bytes: body.length, body }
    }

    if (CHECK) {
      const results = []
      for (const scenario of scenarios) {
        const result = await call(scenario)
        results.push({
          scenario: scenario.name,
          status: result.status,
          expected: scenario.expect,
          ok: result.status === scenario.expect,
          latency_ms: Number(result.ms.toFixed(1)),
          bytes: result.bytes,
          error: result.status === scenario.expect ? undefined : result.body.slice(0, 160),
        })
      }
      console.table(results)
      if (results.some((r) => !r.ok)) process.exitCode = 2
      return
    }

    // Warm the routes, the pool and the JIT before measuring.
    const warmupDeadline = Date.now() + WARMUP_SECONDS * 1000
    await Promise.all(Array.from({ length: Math.min(8, POOL_MAX) }, async () => {
      let i = 0
      while (Date.now() < warmupDeadline) {
        await call(scenarios[i++ % scenarios.length]).catch(() => {})
      }
    }))
    console.log(`[load] warmup complete (${WARMUP_SECONDS}s)`)

    const report = {
      database: dbName, year_id: year.id, transactions: year.transactions,
      pool_max: POOL_MAX, levels: [],
    }
    for (const level of LEVELS) {
      const latencies = []
      const statuses = []
      const errors = []
      const perScenario = Object.fromEntries(scenarios.map((s) => [s.name, { latencies: [], statuses: [], errors: [] }]))
      const started = Date.now()
      const deadline = started + SECONDS * 1000
      let cursor = 0

      await Promise.all(Array.from({ length: level }, async () => {
        while (Date.now() < deadline) {
          const scenario = scenarios[cursor++ % scenarios.length]
          const bucket = perScenario[scenario.name]
          try {
            const result = await call(scenario)
            latencies.push(result.ms)
            statuses.push(result.status)
            bucket.latencies.push(result.ms)
            bucket.statuses.push(result.status)
            if (result.status !== scenario.expect) {
              const message = `${scenario.name} returned ${result.status}: ${result.body.slice(0, 140)}`
              errors.push(message)
              bucket.errors.push(message)
            }
          } catch (err) {
            const message = `${scenario.name}: ${err.message}`
            errors.push(message)
            bucket.errors.push(message)
          }
        }
      }))

      const elapsedMs = Date.now() - started
      const levelReport = {
        concurrency: level,
        seconds: Number((elapsedMs / 1000).toFixed(1)),
        overall: summarise(latencies, statuses, errors, elapsedMs),
        scenarios: Object.fromEntries(Object.entries(perScenario).map(([name, bucket]) => [
          name, summarise(bucket.latencies, bucket.statuses, bucket.errors, elapsedMs),
        ])),
      }
      report.levels.push(levelReport)

      const o = levelReport.overall
      console.log(`\n[load] concurrency=${level}  ${o.requests} req in ${levelReport.seconds}s`
        + `  ${o.rps} rps  errors=${o.errors} (${o.error_rate}%)`)
      console.log(`       latency ms  p50=${o.latency_ms?.p50}  p95=${o.latency_ms?.p95}`
        + `  p99=${o.latency_ms?.p99}  max=${o.latency_ms?.max}`)
      console.table(Object.entries(levelReport.scenarios).map(([name, s]) => ({
        scenario: name,
        requests: s.requests,
        rps: s.rps,
        errors: s.errors,
        p50: s.latency_ms?.p50,
        p95: s.latency_ms?.p95,
        p99: s.latency_ms?.p99,
      })))
    }

    if (OUT) {
      fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
      console.log(`\n[load] wrote ${OUT}`)
    } else {
      console.log(`\n[load] json report:\n${JSON.stringify(report)}`)
    }
  } finally {
    if (child) {
      child.removeAllListeners('exit')
      child.kill('SIGTERM')
    }
  }
}

main().catch((err) => {
  console.error('[load] failed:', err.message)
  process.exit(1)
})
