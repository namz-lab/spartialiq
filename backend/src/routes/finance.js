/**
 * Finance module — Chegutu-style cadastre-linked revenue console for Vungu RDC.
 *
 *   GET  /finance/overview
 *   GET  /finance/districts
 *   GET  /finance/districts/:code
 *   GET  /finance/accounts
 *   GET  /finance/accounts/:accountNo
 *   GET  /finance/accounts/:accountNo/ledger
 *   GET  /finance/map/districts          GeoJSON choropleth of balances by district
 *   GET  /finance/map/accounts           GeoJSON points/centroids coloured by balance
 *   GET  /finance/trends                 Monthly billed / collected / arrears
 *   GET  /finance/receipts               Council payment receipts (public.payments)
 *   GET  /finance/tariff                 Active fee schedule
 *   GET  /finance/clearances             Section 109 queue with live balance
 *   GET  /finance/workflows              Cross-module payment + permit fee visibility
 *   POST /finance/accounts/:accountNo/adjust   Manual ledger adjustment (staff)
 *   POST /finance/clearances/:id/decide        Proxy decide with live balance check
 */

const { requireRole } = require('../middleware/jwtAuth')
const { systemOf } = require('../lib/dbContext')
const { isDriverLive } = require('../services/paymentDriver')
const exchangeRate = require('../services/exchangeRate')

const FINANCE_ROLES = [
  'admin', 'planning_clerk', 'eo', 'planner', 'gis_officer', 'finance_officer',
]
const FINANCE_WRITERS = ['admin', 'planning_clerk', 'eo', 'finance_officer']

const isStr = (v, max = 200) =>
  typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max

function money(n) {
  const x = Number(n)
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0
}

function accountDTO(row) {
  if (!row) return null
  return {
    accountNo: row.account_no,
    parcelId: row.parcel_id,
    standNo: row.stand_no,
    townshipCode: row.township_code,
    districtCode: row.district_code,
    districtName: row.district_name || null,
    accountHolder: row.account_holder,
    holderPhone: row.holder_phone,
    holderEmail: row.holder_email,
    accountCategory: row.account_category,
    valuationUsd: money(row.valuation_usd),
    annualRatesUsd: money(row.annual_rates_usd),
    balanceUsd: money(row.balance_usd),
    lastPaymentAt: row.last_payment_at,
    lastPaymentUsd: row.last_payment_usd != null ? money(row.last_payment_usd) : null,
    statusBand: row.status_band,
    demonstration: !!row.demonstration,
    asAt: row.as_at,
    areaM2: row.area_m2 != null ? Number(row.area_m2) : null,
  }
}

function certNo() {
  const y = new Date().getFullYear()
  const r = Math.floor(100000 + Math.random() * 900000)
  return `VRDC-S109-${y}-${r}`
}

async function financeRoutes(fastify) {
  const staff = { preHandler: requireRole(fastify, FINANCE_ROLES) }
  const write = { preHandler: requireRole(fastify, FINANCE_WRITERS) }

  // ── Overview KPIs ───────────────────────────────────────────────────
  fastify.get('/finance/overview', staff, async (_request, reply) => {
    const pg = systemOf(fastify.pg)
    const { rows: [k] } = await pg.query(`
      SELECT
        COUNT(*)::int AS accounts,
        COUNT(*) FILTER (WHERE status_band = 'current')::int AS current_count,
        COUNT(*) FILTER (WHERE status_band = 'in_arrears')::int AS arrears_count,
        COUNT(*) FILTER (WHERE status_band = 'closed')::int AS closed_count,
        COUNT(*) FILTER (WHERE balance_usd > 0)::int AS owing_accounts,
        COALESCE(SUM(balance_usd),0)::numeric AS total_owing_usd,
        COALESCE(SUM(valuation_usd),0)::numeric AS total_valuation_usd,
        COALESCE(SUM(annual_rates_usd),0)::numeric AS annual_rates_roll_usd,
        COALESCE(SUM(balance_usd) FILTER (WHERE status_band = 'in_arrears'),0)::numeric AS arrears_usd,
        COUNT(DISTINCT district_code)::int AS districts
      FROM finance.revenue_account
    `)
    const { rows: [pay] } = await pg.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count,
        COALESCE(SUM(amount_usd) FILTER (WHERE status = 'paid'),0)::numeric AS paid_usd,
        COUNT(*) FILTER (WHERE status = 'paid' AND paid_at >= date_trunc('month', now()))::int AS paid_this_month,
        COALESCE(SUM(amount_usd) FILTER (WHERE status = 'paid' AND paid_at >= date_trunc('month', now())),0)::numeric AS paid_this_month_usd
      FROM public.payments
    `)
    const { rows: [clr] } = await pg.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'requested')::int AS clearance_queued,
        COUNT(*) FILTER (WHERE status = 'cleared')::int AS clearance_issued,
        COUNT(*) FILTER (WHERE status = 'refused')::int AS clearance_refused
      FROM council_ops.rates_clearance
    `)
    const { rows: topArrears } = await pg.query(`
      SELECT ra.*, d.name AS district_name
        FROM finance.revenue_account ra
        JOIN finance.billing_district d ON d.code = ra.district_code
       WHERE ra.balance_usd > 0
       ORDER BY ra.balance_usd DESC
       LIMIT 8
    `)
    return reply.send({
      success: true,
      data: {
        accounts: Number(k.accounts),
        currentCount: Number(k.current_count),
        arrearsCount: Number(k.arrears_count),
        closedCount: Number(k.closed_count),
        owingAccounts: Number(k.owing_accounts),
        totalOwingUsd: money(k.total_owing_usd),
        totalValuationUsd: money(k.total_valuation_usd),
        annualRatesRollUsd: money(k.annual_rates_roll_usd),
        arrearsUsd: money(k.arrears_usd),
        districts: Number(k.districts),
        payments: {
          paidCount: Number(pay.paid_count),
          paidUsd: money(pay.paid_usd),
          paidThisMonth: Number(pay.paid_this_month),
          paidThisMonthUsd: money(pay.paid_this_month_usd),
        },
        clearances: {
          queued: Number(clr.clearance_queued),
          issued: Number(clr.clearance_issued),
          refused: Number(clr.clearance_refused),
        },
        topArrears: topArrears.map(accountDTO),
        note: 'Balances are a working demonstration roll linked to the cadastre. Finance replaces figures when Council adopts a gazetted tariff or an ERP extract.',
      },
    })
  })

  // ── Districts ───────────────────────────────────────────────────────
  fastify.get('/finance/districts', staff, async (_request, reply) => {
    const pg = systemOf(fastify.pg)
    const { rows } = await pg.query(`
      SELECT
        d.code, d.name, d.township_group, d.sort_order,
        COUNT(ra.account_no)::int AS accounts,
        COUNT(ra.account_no) FILTER (WHERE ra.status_band = 'in_arrears')::int AS arrears_count,
        COALESCE(SUM(ra.balance_usd),0)::numeric AS balance_usd,
        COALESCE(SUM(ra.valuation_usd),0)::numeric AS valuation_usd,
        COALESCE(SUM(ra.annual_rates_usd),0)::numeric AS annual_rates_usd
      FROM finance.billing_district d
      LEFT JOIN finance.revenue_account ra ON ra.district_code = d.code
      GROUP BY d.code, d.name, d.township_group, d.sort_order
      HAVING COUNT(ra.account_no) > 0
      ORDER BY SUM(ra.balance_usd) DESC NULLS LAST, d.sort_order
    `)
    return reply.send({
      success: true,
      data: rows.map((r) => ({
        code: r.code,
        name: r.name,
        townshipGroup: r.township_group,
        accounts: Number(r.accounts),
        arrearsCount: Number(r.arrears_count),
        balanceUsd: money(r.balance_usd),
        valuationUsd: money(r.valuation_usd),
        annualRatesUsd: money(r.annual_rates_usd),
      })),
    })
  })

  fastify.get('/finance/districts/:code', staff, async (request, reply) => {
    const pg = systemOf(fastify.pg)
    const code = String(request.params.code || '')
    const { rows: [d] } = await pg.query(
      `SELECT * FROM finance.billing_district WHERE code = $1`, [code],
    )
    if (!d) return reply.code(404).send({ success: false, error: 'district_not_found' })
    const { rows: accounts } = await pg.query(`
      SELECT ra.*, d.name AS district_name
        FROM finance.revenue_account ra
        JOIN finance.billing_district d ON d.code = ra.district_code
       WHERE ra.district_code = $1
       ORDER BY ra.balance_usd DESC, ra.stand_no
       LIMIT 500
    `, [code])
    return reply.send({
      success: true,
      data: {
        code: d.code,
        name: d.name,
        townshipGroup: d.township_group,
        accounts: accounts.map(accountDTO),
      },
    })
  })

  // ── Accounts search ─────────────────────────────────────────────────
  fastify.get('/finance/accounts', staff, async (request, reply) => {
    const pg = systemOf(fastify.pg)
    const q = String(request.query?.q || '').trim()
    const district = String(request.query?.district || '').trim()
    const status = String(request.query?.status || '').trim()
    const category = String(request.query?.category || '').trim()
    const owing = String(request.query?.owing || '') === '1'
    const limit = Math.min(Number(request.query?.limit) || 50, 200)
    const offset = Math.max(Number(request.query?.offset) || 0, 0)

    const params = []
    const where = []
    if (q) {
      params.push(`%${q}%`)
      const i = params.length
      where.push(`(
        ra.account_no ILIKE $${i}
        OR ra.stand_no ILIKE $${i}
        OR ra.account_holder ILIKE $${i}
        OR ra.parcel_id ILIKE $${i}
      )`)
    }
    if (district) {
      params.push(district)
      where.push(`ra.district_code = $${params.length}`)
    }
    if (status) {
      params.push(status)
      where.push(`ra.status_band = $${params.length}`)
    }
    if (category) {
      params.push(category)
      where.push(`ra.account_category = $${params.length}`)
    }
    if (owing) where.push(`ra.balance_usd > 0`)

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    params.push(limit, offset)
    const { rows } = await pg.query(`
      SELECT ra.*, d.name AS district_name, p.area_m2
        FROM finance.revenue_account ra
        JOIN finance.billing_district d ON d.code = ra.district_code
        LEFT JOIN land.parcel p ON p.parcel_id = ra.parcel_id
        ${whereSql}
       ORDER BY ra.balance_usd DESC, ra.stand_no
       LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params)

    const countParams = params.slice(0, -2)
    const { rows: [{ total }] } = await pg.query(
      `SELECT COUNT(*)::int AS total FROM finance.revenue_account ra ${whereSql}`,
      countParams,
    )

    return reply.send({
      success: true,
      data: {
        total,
        limit,
        offset,
        accounts: rows.map(accountDTO),
      },
    })
  })

  fastify.get('/finance/accounts/:accountNo', staff, async (request, reply) => {
    const pg = systemOf(fastify.pg)
    const accountNo = decodeURIComponent(String(request.params.accountNo || ''))
    const { rows: [row] } = await pg.query(`
      SELECT ra.*, d.name AS district_name, p.area_m2,
             ST_AsGeoJSON(ST_Centroid(p.geom_wgs84))::json AS centroid,
             ST_AsGeoJSON(ST_SimplifyPreserveTopology(p.geom_wgs84, 0.00005))::json AS geometry
        FROM finance.revenue_account ra
        JOIN finance.billing_district d ON d.code = ra.district_code
        LEFT JOIN land.parcel p ON p.parcel_id = ra.parcel_id
       WHERE ra.account_no = $1
    `, [accountNo])
    if (!row) return reply.code(404).send({ success: false, error: 'account_not_found' })

    const { rows: ledger } = await pg.query(`
      SELECT id, entry_date, entry_type, purpose, description,
             amount_usd, balance_after_usd, payment_id, receipt_no, created_at
        FROM finance.ledger_entry
       WHERE account_no = $1
       ORDER BY entry_date DESC, created_at DESC
       LIMIT 100
    `, [accountNo])

    const { rows: clearances } = await pg.query(`
      SELECT id, stand_number, applicant_name, status, certificate_no,
             charges_outstanding_usd, erp_status_band, issued_at, valid_until, created_at
        FROM council_ops.rates_clearance
       WHERE upper(stand_number) = upper($1)
       ORDER BY created_at DESC
       LIMIT 20
    `, [row.stand_no])

    const { rows: payments } = await pg.query(`
      SELECT id, purpose, amount_usd, status, issued_receipt_no, paid_at, driver,
             metadata, related_kind, related_id, created_at
        FROM public.payments
       WHERE status = 'paid'
         AND (
           metadata->>'accountRef' ILIKE $1
           OR metadata->>'accountRef' ILIKE $2
           OR related_id = $2
         )
       ORDER BY COALESCE(paid_at, created_at) DESC
       LIMIT 30
    `, [`%${row.stand_no}%`, row.stand_no])

    const { rows: permits } = await pg.query(`
      SELECT id, tpd_reference, stand_number, applicant_name, development_type,
             status, fee_paid_at, received_at
        FROM spatial_planning.permit_application
       WHERE upper(stand_number) = upper($1)
          OR stand_number ILIKE $2
       ORDER BY received_at DESC
       LIMIT 20
    `, [row.stand_no, `%${row.stand_no}%`])

    return reply.send({
      success: true,
      data: {
        account: accountDTO(row),
        geometry: row.geometry || null,
        centroid: row.centroid || null,
        ledger: ledger.map((e) => ({
          id: e.id,
          entryDate: e.entry_date,
          entryType: e.entry_type,
          purpose: e.purpose,
          description: e.description,
          amountUsd: money(e.amount_usd),
          balanceAfterUsd: money(e.balance_after_usd),
          paymentId: e.payment_id,
          receiptNo: e.receipt_no,
          createdAt: e.created_at,
        })),
        clearances,
        payments: payments.map((p) => ({
          id: p.id,
          purpose: p.purpose,
          amountUsd: money(p.amount_usd),
          status: p.status,
          receiptNo: p.issued_receipt_no,
          paidAt: p.paid_at,
          driver: p.driver,
          metadata: p.metadata,
        })),
        permits,
      },
    })
  })

  fastify.get('/finance/accounts/:accountNo/ledger', staff, async (request, reply) => {
    const pg = systemOf(fastify.pg)
    const accountNo = decodeURIComponent(String(request.params.accountNo || ''))
    const { rows } = await pg.query(`
      SELECT * FROM finance.ledger_entry
       WHERE account_no = $1
       ORDER BY entry_date DESC, created_at DESC
       LIMIT 200
    `, [accountNo])
    return reply.send({ success: true, data: rows })
  })

  // ── Map: district choropleth ────────────────────────────────────────
  fastify.get('/finance/map/districts', staff, async (_request, reply) => {
    const pg = systemOf(fastify.pg)
    const { rows } = await pg.query(`
      WITH stats AS (
        SELECT district_code,
               COUNT(*)::int AS accounts,
               COALESCE(SUM(balance_usd),0)::numeric AS balance_usd,
               COUNT(*) FILTER (WHERE status_band = 'in_arrears')::int AS arrears_count
          FROM finance.revenue_account
         GROUP BY district_code
      )
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(
          jsonb_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(g.geom, 0.0002))::jsonb,
            'properties', jsonb_build_object(
              'code', d.code,
              'name', d.name,
              'townshipGroup', d.township_group,
              'accounts', COALESCE(s.accounts, 0),
              'balanceUsd', COALESCE(s.balance_usd, 0),
              'arrearsCount', COALESCE(s.arrears_count, 0)
            )
          )
        ), '[]'::jsonb)
      ) AS fc
      FROM finance.billing_district d
      JOIN stats s ON s.district_code = d.code
      JOIN LATERAL (
        SELECT ST_Multi(ST_Union(p.geom_wgs84)) AS geom
          FROM land.parcel p
          JOIN finance.revenue_account ra ON ra.parcel_id = p.parcel_id
         WHERE ra.district_code = d.code
      ) g ON g.geom IS NOT NULL
    `)
    return reply.send({ success: true, data: rows[0]?.fc || { type: 'FeatureCollection', features: [] } })
  })

  // ── Map: account centroids (balance heat) ───────────────────────────
  fastify.get('/finance/map/accounts', staff, async (request, reply) => {
    const pg = systemOf(fastify.pg)
    const district = String(request.query?.district || '').trim()
    const owingOnly = String(request.query?.owing || '') === '1'
    const limit = Math.min(Number(request.query?.limit) || 800, 1200)
    const params = []
    const where = ['p.geom_wgs84 IS NOT NULL']
    if (district) {
      params.push(district)
      where.push(`ra.district_code = $${params.length}`)
    }
    if (owingOnly) where.push('ra.balance_usd > 0')
    params.push(limit)

    const { rows } = await pg.query(`
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(feat), '[]'::jsonb)
      ) AS fc
      FROM (
        SELECT jsonb_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(ST_Centroid(p.geom_wgs84))::jsonb,
          'properties', jsonb_build_object(
            'accountNo', ra.account_no,
            'standNo', ra.stand_no,
            'holder', ra.account_holder,
            'districtCode', ra.district_code,
            'balanceUsd', ra.balance_usd,
            'statusBand', ra.status_band,
            'category', ra.account_category,
            'valuationUsd', ra.valuation_usd
          )
        ) AS feat
        FROM finance.revenue_account ra
        JOIN land.parcel p ON p.parcel_id = ra.parcel_id
        WHERE ${where.join(' AND ')}
        ORDER BY ra.balance_usd DESC
        LIMIT $${params.length}
      ) t
    `, params)

    return reply.send({ success: true, data: rows[0]?.fc || { type: 'FeatureCollection', features: [] } })
  })

  // ── 3D extrusion geometry (layout stands + owing parcels) ──────────
  fastify.get('/finance/map/extrude', staff, async (request, reply) => {
    const pg = systemOf(fastify.pg)
    const scope = String(request.query?.scope || 'layout')
    const where = scope === 'owing'
      ? `ra.township_code = 'LAYOUT' AND ra.balance_usd > 0`
      : `ra.township_code = 'LAYOUT'`
    const { rows } = await pg.query(`
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(feat), '[]'::jsonb)
      ) AS fc
      FROM (
        SELECT jsonb_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(p.geom_wgs84, 0.00002))::jsonb,
          'properties', jsonb_build_object(
            'accountNo', ra.account_no,
            'standNo', ra.stand_no,
            'holder', ra.account_holder,
            'districtCode', ra.district_code,
            'balanceUsd', ra.balance_usd,
            'statusBand', ra.status_band,
            'category', ra.account_category,
            'valuationUsd', ra.valuation_usd,
            'heightM', LEAST(720, LN(1 + GREATEST(ra.balance_usd, 0)) * 160)
          )
        ) AS feat
        FROM finance.revenue_account ra
        JOIN land.parcel p ON p.parcel_id = ra.parcel_id
        WHERE ${where}
          AND p.geom_wgs84 IS NOT NULL
          AND NOT ST_IsEmpty(p.geom_wgs84)
        ORDER BY ra.balance_usd DESC
        LIMIT 220
      ) t
    `)
    return reply.send({
      success: true,
      data: rows[0]?.fc || { type: 'FeatureCollection', features: [] },
      camera: { center: [29.82765, -19.5108], zoom: 14.2, pitch: 58, bearing: -24 },
    })
  })

  // ── Zimbabwe payment rails + USD/ZWG board ─────────────────────────
  fastify.get('/finance/rails', staff, async (_request, reply) => {
    const pg = systemOf(fastify.pg)
    const rateMeta = await exchangeRate.getLatestRate(pg, 'USD', 'ZWG')
    const { rows: series } = await pg.query(`
      SELECT rate_date, rate, source
        FROM public.exchange_rates
       WHERE base_ccy = 'USD' AND quote_ccy = 'ZWG'
       ORDER BY rate_date DESC
       LIMIT 14
    `)
    const { rows: [owing] } = await pg.query(`
      SELECT COALESCE(SUM(balance_usd),0)::numeric AS usd
        FROM finance.revenue_account
    `)
    const rate = Number(rateMeta.rate)
    const rails = [
      {
        id: 'ecocash',
        name: 'EcoCash',
        operator: 'Econet',
        currency: 'USD / ZWG',
        kind: 'mobile money',
        ussd: '*151#',
        live: isDriverLive('ecocash'),
        note: 'Direct merchant push, or through Paynow when that account is connected.',
      },
      {
        id: 'onemoney',
        name: 'OneMoney',
        operator: 'NetOne',
        currency: 'USD / ZWG',
        kind: 'mobile money',
        ussd: '*111#',
        live: isDriverLive('onemoney'),
        note: 'Direct merchant push, or through Paynow.',
      },
      {
        id: 'innbucks',
        name: 'InnBucks',
        operator: 'InnBucks',
        currency: 'USD / ZWG',
        kind: 'wallet',
        ussd: null,
        live: isDriverLive('paynow'),
        note: 'Wallet on the Paynow checkout.',
      },
      {
        id: 'zimswitch',
        name: 'Zimswitch',
        operator: 'Zimswitch',
        currency: 'ZWG / USD',
        kind: 'card',
        ussd: null,
        live: isDriverLive('paynow'),
        note: 'Local card switch. On this build it rides the Paynow card button until a direct Zimswitch merchant id is issued.',
      },
      {
        id: 'zipit',
        name: 'ZIPIT',
        operator: 'Zimswitch',
        currency: 'ZWG',
        kind: 'instant transfer',
        ussd: null,
        live: false,
        note: 'Bank-to-council instant payment. The council account number is entered by Finance; the console records the reference.',
      },
      {
        id: 'rtgs',
        name: 'RTGS',
        operator: 'Bank',
        currency: 'ZWG / USD',
        kind: 'bank transfer',
        ussd: null,
        live: false,
        note: 'Real-time gross settlement into the council’s bank account, then a clerk posts the receipt.',
      },
      {
        id: 'paynow',
        name: 'Paynow',
        operator: 'Paynow',
        currency: 'USD / ZWG',
        kind: 'checkout',
        ussd: null,
        live: isDriverLive('paynow'),
        note: 'Hosted checkout covering EcoCash, OneMoney, InnBucks and Zimswitch cards.',
      },
      {
        id: 'counter',
        name: 'Cash office',
        operator: 'Council treasury',
        currency: 'USD / ZWG',
        kind: 'counter',
        ussd: null,
        live: true,
        note: 'Manual receipt on this computer. In production only a clerk confirms it.',
      },
    ]
    return reply.send({
      success: true,
      data: {
        rate: {
          base: 'USD',
          quote: 'ZWG',
          rate,
          asOf: rateMeta.asOf || rateMeta.rateDate || null,
          source: rateMeta.source,
          fallback: !!rateMeta.isStale,
        },
        series: series.slice().reverse().map((r) => ({
          date: r.rate_date,
          rate: Number(r.rate),
          source: r.source,
        })),
        book: {
          owingUsd: money(owing.usd),
          owingZwg: money(Number(owing.usd) * rate),
        },
        rails,
        note: 'The USD/ZWG figure is the working rate on this computer. Replace it with the day’s interbank rate before a public bill is quoted.',
      },
    })
  })

  // ── Trends ──────────────────────────────────────────────────────────
  fastify.get('/finance/trends', staff, async (request, reply) => {
    const pg = systemOf(fastify.pg)
    const district = String(request.query?.district || '').trim()
    const params = []
    let where = ''
    if (district) {
      params.push(district)
      where = `WHERE cs.district_code = $${params.length}`
    }
    const { rows } = await pg.query(`
      SELECT cs.month,
             SUM(cs.billed_usd)::numeric AS billed_usd,
             SUM(cs.collected_usd)::numeric AS collected_usd,
             SUM(cs.arrears_usd)::numeric AS arrears_usd,
             SUM(cs.account_count)::int AS accounts
        FROM finance.collection_snapshot cs
        ${where}
       GROUP BY cs.month
       ORDER BY cs.month
    `, params)
    return reply.send({
      success: true,
      data: rows.map((r) => ({
        month: r.month,
        billedUsd: money(r.billed_usd),
        collectedUsd: money(r.collected_usd),
        arrearsUsd: money(r.arrears_usd),
        accounts: Number(r.accounts),
      })),
    })
  })

  // ── Receipts (existing payments) ────────────────────────────────────
  fastify.get('/finance/receipts', staff, async (request, reply) => {
    const pg = systemOf(fastify.pg)
    const limit = Math.min(Number(request.query?.limit) || 50, 200)
    const { rows } = await pg.query(`
      SELECT id, purpose, amount_usd, status, driver, issued_receipt_no,
             paid_at, payer_email, metadata, related_kind, related_id, created_at
        FROM public.payments
       WHERE status = 'paid'
       ORDER BY COALESCE(paid_at, created_at) DESC
       LIMIT $1
    `, [limit])
    return reply.send({
      success: true,
      data: rows.map((p) => ({
        id: p.id,
        purpose: p.purpose,
        amountUsd: money(p.amount_usd),
        status: p.status,
        driver: p.driver,
        receiptNo: p.issued_receipt_no,
        paidAt: p.paid_at,
        payerEmail: p.payer_email,
        accountRef: p.metadata?.accountRef || null,
        relatedKind: p.related_kind,
        relatedId: p.related_id,
        createdAt: p.created_at,
      })),
    })
  })

  // ── Tariff ──────────────────────────────────────────────────────────
  fastify.get('/finance/tariff', staff, async (_request, reply) => {
    const pg = systemOf(fastify.pg)
    const { rows } = await pg.query(`
      SELECT code, department, title, detail, amount_usd, unit_label, priced_by, sort_order
        FROM public.council_fee_tariff
       WHERE active
       ORDER BY sort_order, department, title
    `)
    return reply.send({
      success: true,
      data: rows.map((t) => ({
        code: t.code,
        department: t.department,
        title: t.title,
        detail: t.detail,
        amountUsd: t.amount_usd != null ? money(t.amount_usd) : null,
        unitLabel: t.unit_label,
        pricedBy: t.priced_by,
      })),
      note: 'Working fee schedule. Finance replaces a figure when Council adopts a new one.',
    })
  })

  // ── Clearances with live balance ────────────────────────────────────
  fastify.get('/finance/clearances', staff, async (request, reply) => {
    const pg = systemOf(fastify.pg)
    const status = String(request.query?.status || '').trim()
    const params = []
    let where = ''
    if (status) {
      params.push(status)
      where = `WHERE rc.status = $${params.length}`
    }
    const { rows } = await pg.query(`
      SELECT rc.*,
             ra.account_no,
             ra.balance_usd AS live_balance_usd,
             ra.status_band AS live_status_band,
             ra.account_holder
        FROM council_ops.rates_clearance rc
        LEFT JOIN finance.revenue_account ra
          ON upper(ra.stand_no) = upper(rc.stand_number)
        ${where}
       ORDER BY rc.created_at DESC
       LIMIT 200
    `, params)
    return reply.send({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        standNumber: r.stand_number,
        applicantName: r.applicant_name,
        applicantEmail: r.applicant_email,
        status: r.status,
        certificateNo: r.certificate_no,
        chargesOutstandingUsd: r.charges_outstanding_usd != null ? money(r.charges_outstanding_usd) : null,
        erpStatusBand: r.erp_status_band,
        liveBalanceUsd: r.live_balance_usd != null ? money(r.live_balance_usd) : null,
        liveStatusBand: r.live_status_band,
        accountNo: r.account_no,
        accountHolder: r.account_holder,
        issuedAt: r.issued_at,
        validUntil: r.valid_until,
        createdAt: r.created_at,
      })),
    })
  })

  fastify.post('/finance/clearances/:id/decide', write, async (request, reply) => {
    const pg = systemOf(fastify.pg)
    const b = request.body || {}
    const decision = b.decision === 'refuse' ? 'refused' : 'cleared'

    const { rows: [rc] } = await pg.query(
      `SELECT * FROM council_ops.rates_clearance WHERE id = $1`, [request.params.id],
    )
    if (!rc) return reply.code(404).send({ success: false, error: 'not_found' })

    const { rows: [ra] } = await pg.query(
      `SELECT * FROM finance.revenue_account WHERE upper(stand_no) = upper($1) LIMIT 1`,
      [rc.stand_number],
    )
    const liveBal = ra ? money(ra.balance_usd) : (b.charges_outstanding_usd != null ? Number(b.charges_outstanding_usd) : 0)

    if (decision === 'cleared' && liveBal > 0) {
      return reply.code(400).send({
        success: false,
        error: 'cannot_clear_with_arrears',
        message: `Section 109: stand still owes USD ${liveBal.toFixed(2)}. Collect before issuing.`,
        liveBalanceUsd: liveBal,
      })
    }
    if (decision === 'refused' && !isStr(b.refusal_reason, 500)) {
      return reply.code(400).send({ success: false, error: 'refusal_reason required' })
    }

    const no = decision === 'cleared' ? certNo() : null
    const { rows } = await pg.query(`
      UPDATE council_ops.rates_clearance SET
        status = $2,
        charges_outstanding_usd = $3,
        erp_status_band = $4,
        certificate_no = COALESCE($5, certificate_no),
        issued_at = CASE WHEN $2 = 'cleared' THEN now() ELSE issued_at END,
        valid_until = CASE WHEN $2 = 'cleared' THEN (CURRENT_DATE + 90) ELSE valid_until END,
        refusal_reason = $6,
        reviewed_by = $7,
        updated_at = now()
      WHERE id = $1
      RETURNING *
    `, [
      request.params.id,
      decision,
      liveBal,
      ra?.status_band || (liveBal > 0 ? 'in_arrears' : 'current'),
      no,
      b.refusal_reason || null,
      request.user.id,
    ])
    return reply.send({ success: true, data: rows[0] })
  })

  // ── Cross-module workflows ──────────────────────────────────────────
  fastify.get('/finance/workflows', staff, async (_request, reply) => {
    const pg = systemOf(fastify.pg)
    const { rows: permitFees } = await pg.query(`
      SELECT pa.id, pa.stand_number, pa.applicant_name, pa.development_type, pa.status,
             pa.fee_paid_at, pa.received_at, pa.tpd_reference,
             pay.issued_receipt_no, pay.amount_usd AS fee_amount_usd, pay.paid_at
        FROM spatial_planning.permit_application pa
        LEFT JOIN LATERAL (
          SELECT issued_receipt_no, amount_usd, paid_at
            FROM public.payments
           WHERE related_kind = 'permit' AND related_id = pa.id::text AND status = 'paid'
           ORDER BY paid_at DESC NULLS LAST
           LIMIT 1
        ) pay ON true
       ORDER BY pa.received_at DESC NULLS LAST
       LIMIT 40
    `)

    const { rows: recentLedger } = await pg.query(`
      SELECT le.account_no, le.entry_date, le.entry_type, le.purpose,
             le.amount_usd, le.receipt_no, ra.stand_no, ra.account_holder
        FROM finance.ledger_entry le
        JOIN finance.revenue_account ra ON ra.account_no = le.account_no
       WHERE le.entry_type = 'payment'
       ORDER BY le.entry_date DESC, le.created_at DESC
       LIMIT 25
    `)

    const { rows: unlinked } = await pg.query(`
      SELECT COUNT(*)::int AS parcels_without_account
        FROM land.parcel p
       WHERE NOT EXISTS (
         SELECT 1 FROM finance.revenue_account ra WHERE ra.parcel_id = p.parcel_id
       )
    `)

    return reply.send({
      success: true,
      data: {
        permitFees: permitFees.map((p) => ({
          id: p.id,
          standNumber: p.stand_number,
          applicantName: p.applicant_name,
          developmentType: p.development_type,
          status: p.status,
          feePaidAt: p.fee_paid_at,
          receiptNo: p.issued_receipt_no,
          feeAmountUsd: p.fee_amount_usd != null ? money(p.fee_amount_usd) : null,
          paidAt: p.paid_at,
          receivedAt: p.received_at,
          tpdReference: p.tpd_reference,
        })),
        recentAccountPayments: recentLedger.map((e) => ({
          accountNo: e.account_no,
          standNo: e.stand_no,
          holder: e.account_holder,
          entryDate: e.entry_date,
          purpose: e.purpose,
          amountUsd: money(e.amount_usd),
          receiptNo: e.receipt_no,
        })),
        cadastreLink: {
          parcelsWithoutAccount: Number(unlinked[0]?.parcels_without_account || 0),
          accountsLinked: 751,
        },
      },
    })
  })

  // ── Manual adjustment ───────────────────────────────────────────────
  fastify.post('/finance/accounts/:accountNo/adjust', write, async (request, reply) => {
    const pg = systemOf(fastify.pg)
    const accountNo = decodeURIComponent(String(request.params.accountNo || ''))
    const b = request.body || {}
    const amount = Number(b.amountUsd)
    const entryType = String(b.entryType || 'adjustment')
    if (!Number.isFinite(amount) || amount === 0) {
      return reply.code(400).send({ success: false, error: 'amountUsd required' })
    }
    if (!['charge', 'payment', 'adjustment', 'penalty', 'write_off'].includes(entryType)) {
      return reply.code(400).send({ success: false, error: 'bad_entry_type' })
    }
    if (!isStr(b.description, 500)) {
      return reply.code(400).send({ success: false, error: 'description required' })
    }

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const { rows: [ra] } = await client.query(
        `SELECT * FROM finance.revenue_account WHERE account_no = $1 FOR UPDATE`,
        [accountNo],
      )
      if (!ra) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ success: false, error: 'account_not_found' })
      }
      const signed = entryType === 'payment' || entryType === 'write_off'
        ? -Math.abs(amount)
        : (entryType === 'adjustment' ? amount : Math.abs(amount))
      const newBal = money(Number(ra.balance_usd) + signed)
      const band = newBal <= 0 ? (ra.status_band === 'closed' ? 'closed' : 'current') : 'in_arrears'

      await client.query(`
        UPDATE finance.revenue_account SET
          balance_usd = $2,
          status_band = $3,
          last_payment_at = CASE WHEN $4 = 'payment' THEN now() ELSE last_payment_at END,
          last_payment_usd = CASE WHEN $4 = 'payment' THEN $5 ELSE last_payment_usd END,
          as_at = now(),
          updated_at = now()
        WHERE account_no = $1
      `, [accountNo, newBal, band, entryType, Math.abs(amount)])

      await client.query(`
        UPDATE revenue_link.billing_status SET status_band = $2, as_at = now()
         WHERE erp_account_no = $1
      `, [accountNo, band === 'disputed' ? 'in_arrears' : band])

      const { rows: [entry] } = await client.query(`
        INSERT INTO finance.ledger_entry
          (account_no, entry_date, entry_type, purpose, description, amount_usd, balance_after_usd, created_by)
        VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        accountNo, entryType, b.purpose || 'land_rates', b.description.trim(),
        signed, newBal, request.user.id,
      ])

      await client.query('COMMIT')
      return reply.code(201).send({
        success: true,
        data: {
          balanceUsd: newBal,
          statusBand: band,
          entry,
        },
      })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })
}

module.exports = { financeRoutes }
