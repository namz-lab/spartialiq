// Draws the two workflow figures for the EO Planning manual as SVG, and renders them to PNG at 2x with Playwright.
const fs = require('fs')
const path = require('path')
const { chromium } = require('C:/lamis/frontend/node_modules/playwright')

const OUT = 'C:/lamis/docs/manuals/images'
fs.mkdirSync(OUT, { recursive: true })

const FONT = "font-family:'Segoe UI',Arial,sans-serif"
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const lines = (t, x, y, lh, anchor = 'middle', extra = '') => String(t).split('\n').map((l, i) => `<text x="${x}" y="${y + i * lh}" text-anchor="${anchor}" ${extra}>${esc(l)}</text>`).join('')

// ───────────────────────── Figure 1: the road of an application ─────────────────────────
function figRoad() {
  const W = 680, colW = 150, x0 = 40
  const lanes = [
    { name: 'Clerk', c: '#e8f0fe', s: '#4a78c9' },
    { name: 'Planner', c: '#e6f4ea', s: '#3d8b5a' },
    { name: 'Committee', c: '#fef3e0', s: '#c98a2b' },
    { name: 'EO Planning', c: '#fde8ec', s: '#c0485f' },
  ]
  const cx = (i) => x0 + colW * i + colW / 2
  const steps = [
    { n: 1, lane: 0, y: 90, t: 'Lodged and registered\nfee paid' },
    { n: 2, lane: 0, y: 170, t: 'Acknowledged\nthe Act\'s clock starts', clock: true },
    { n: 3, lane: 1, y: 250, t: 'Circulated to\ndepartments' },
    { n: 4, lane: 0, y: 330, t: 'Public notice, if s.26(3)\nobjections put to the\napplicant: 14 days' },
    { n: 5, lane: 1, y: 420, t: 'Assessed:\nrecommendation\nand committee report' },
    { n: 6, lane: 2, y: 500, t: 'Committee hears\nthe case and\nrecords a resolution' },
    { n: 7, lane: 3, y: 590, t: 'EO answers the Act\'s\nquestions, checks\ndirections and decides', eo: true },
    { n: 8, lane: 3, y: 690, t: 'Permit issued,\napplicant notified:\nappeal window 1 month' },
  ]
  const H = 770
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="${FONT}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${W / 2}" y="26" text-anchor="middle" font-size="17" font-weight="700" fill="#1f3a5f">The road of an application</text>`
  lanes.forEach((l, i) => {
    svg += `<rect x="${x0 + colW * i}" y="44" width="${colW}" height="${H - 60}" fill="${l.c}" opacity="0.55"/>
    <rect x="${x0 + colW * i}" y="44" width="${colW}" height="26" fill="${l.s}"/>
    <text x="${cx(i)}" y="62" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">${l.name}</text>`
  })
  // arrows first, so boxes sit on top
  svg += `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#5f6b7a"/></marker></defs>`
  const bh = (s) => 14 + String(s.t).split('\n').length * 16
  steps.forEach((s, i) => {
    if (i === 0) return
    const p = steps[i - 1]
    const x1 = cx(p.lane), y1 = p.y + bh(p) / 2, x2 = cx(s.lane), y2 = s.y - bh(s) / 2
    const my = (y1 + y2) / 2
    svg += `<path d="M${x1},${y1} L${x1},${my} L${x2},${my} L${x2},${y2 - 2}" fill="none" stroke="#5f6b7a" stroke-width="1.6" marker-end="url(#a)"/>`
  })
  steps.forEach((s) => {
    const l = lanes[s.lane]
    const w = colW - 14, h = bh(s)
    svg += `<rect x="${cx(s.lane) - w / 2}" y="${s.y - h / 2}" width="${w}" height="${h}" rx="7" fill="#fff" stroke="${l.s}" stroke-width="${s.eo ? 3 : 1.6}"/>`
    svg += lines(s.t, cx(s.lane), s.y - h / 2 + 18, 16, 'middle', 'font-size="11.5" fill="#1d2733"')
    svg += `<circle cx="${cx(s.lane) - w / 2}" cy="${s.y - h / 2}" r="11" fill="${l.s}"/><text x="${cx(s.lane) - w / 2}" y="${s.y - h / 2 + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${s.n}</text>`
  })
  // the clock bracket: from acknowledgement to the deemed-refusal date
  const y2 = steps[1].y, y7 = steps[6].y + 30
  svg += `<path d="M${W - 36},${y2} L${W - 24},${y2} L${W - 24},${y7} L${W - 36},${y7}" fill="none" stroke="#b3261e" stroke-width="2"/>`
  svg += `<text transform="translate(${W - 8},${(y2 + y7) / 2}) rotate(90)" text-anchor="middle" font-size="11.5" font-weight="700" fill="#b3261e">3 months (4 for a subdivision), then deemed refused</text>`
  svg += `</svg>`
  return { svg, W, H }
}

// ───────────────────────── Figure 2: the gates before an approval ─────────────────────────
function figGates() {
  const W = 680
  const gates = [
    ['Acknowledged?', 'the Act\'s clock must have started', 'Not acknowledged'],
    ['Lane open?', 'a subdivision or rezoning needs the\nMinister\'s instrument (switch S2)', 'Lane closed'],
    ['Not yet deemed refused?', 'counted to any written extension', 'Deemed refused'],
    ['Directions checked,\nnone binding?', 'recorded check; no direction that refers\nthe case to the Minister', 'Direction check required /\nA direction applies'],
    ['No blocking reply\noutstanding?', 'departments marked "blocking"', 'Blocking reply outstanding'],
    ['The Act\'s questions answered,\nreferrals made?', 'road, aerodrome, neighbouring authority,\nagriculture, title, adverse use', 'Statutory checks required /\nReferral pending'],
    ['Public notice complete\n(where required)?', 's.26(3): advert, owners, site notice,\nobjection period closed', 'Public notice incomplete'],
    ['Objections dealt with?', 'considered, put to the applicant,\n14 days used or answered', 'Objections open'],
    ['Authority?', 'a committee resolution that matches the\ndecision, or the recorded delegation\n(S1, S3; S5 to refuse)', 'Resolution required /\nDelegation not open'],
  ]
  const gx = 40, gw = 300, sx = 590, sw = 150, GAP = 26, lh = 15
  const boxH = (g) => 20 + g[0].split('\n').length * lh + g[1].split('\n').length * 14 + 4
  let y = 112
  const pos = gates.map((g) => { const p = { y, h: boxH(g) }; y += p.h + GAP; return p })
  const lastY = y
  const H = lastY + 70
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="' + FONT + '">' +
    '<rect width="' + W + '" height="' + H + '" fill="#ffffff"/>' +
    '<defs>' +
    '<marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#5f6b7a"/></marker>' +
    '<marker id="r" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#b3261e"/></marker>' +
    '</defs>' +
    '<text x="' + (W / 2) + '" y="24" text-anchor="middle" font-size="17" font-weight="700" fill="#1f3a5f">The gates before an approval</text>' +
    '<text x="' + (W / 2) + '" y="44" text-anchor="middle" font-size="11.5" fill="#5f6b7a">The server checks them in this order. A refusal skips gates 6 to 8.</text>' +
    '<rect x="' + gx + '" y="58" width="' + gw + '" height="30" rx="15" fill="#1f3a5f"/>' +
    '<text x="' + (gx + gw / 2) + '" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="#fff">The EO presses Approve</text>'
  const arrow = (y1, y2) => '<line x1="' + (gx + gw / 2) + '" y1="' + y1 + '" x2="' + (gx + gw / 2) + '" y2="' + y2 + '" stroke="#5f6b7a" stroke-width="1.6" marker-end="url(#a)"/>'
  svg += arrow(88, pos[0].y - 2)
  gates.forEach((g, i) => {
    const { y: gy, h } = pos[i]
    const nameLines = g[0].split('\n')
    const yc = gy + h / 2
    svg += '<rect x="' + gx + '" y="' + gy + '" width="' + gw + '" height="' + h + '" rx="8" fill="#e6f4ea" stroke="#3d8b5a" stroke-width="1.6"/>'
    svg += '<circle cx="' + gx + '" cy="' + gy + '" r="11" fill="#3d8b5a"/><text x="' + gx + '" y="' + (gy + 4) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">' + (i + 1) + '</text>'
    svg += lines(g[0], gx + gw / 2, gy + 20, lh, 'middle', 'font-size="12.5" font-weight="700" fill="#1d2733"')
    svg += lines(g[1], gx + gw / 2, gy + 20 + nameLines.length * lh + 1, 14, 'middle', 'font-size="10.5" fill="#46515e"')
    const sh = 14 + g[2].split('\n').length * 14
    svg += '<line x1="' + (gx + gw) + '" y1="' + yc + '" x2="' + (sx - sw / 2 - 2) + '" y2="' + yc + '" stroke="#b3261e" stroke-width="1.6" marker-end="url(#r)"/>'
    svg += '<text x="' + (gx + gw + 12) + '" y="' + (yc - 6) + '" font-size="11" font-weight="700" fill="#b3261e">no</text>'
    svg += '<rect x="' + (sx - sw / 2) + '" y="' + (yc - sh / 2) + '" width="' + sw + '" height="' + sh + '" rx="6" fill="#fdecea" stroke="#b3261e" stroke-width="1.4"/>'
    svg += lines(g[2], sx, yc - sh / 2 + 15, 14, 'middle', 'font-size="10.5" font-weight="600" fill="#8c1d18"')
    if (i > 0) svg += arrow(pos[i - 1].y + pos[i - 1].h, gy - 2)
  })
  const last = pos[pos.length - 1]
  svg += arrow(last.y + last.h, lastY - 2)
  svg += '<rect x="' + gx + '" y="' + lastY + '" width="' + gw + '" height="42" rx="21" fill="#c0485f"/>' +
    '<text x="' + (gx + gw / 2) + '" y="' + (lastY + 18) + '" text-anchor="middle" font-size="12.5" font-weight="700" fill="#fff">The decision is recorded</text>' +
    '<text x="' + (gx + gw / 2) + '" y="' + (lastY + 33) + '" text-anchor="middle" font-size="10.5" fill="#fff">with what it rested on; the letter is produced</text>' +
    '<text x="' + (W - 14) + '" y="' + (H - 10) + '" text-anchor="end" font-size="10" fill="#7b8794">The red boxes are the messages the screen shows</text>'
  svg += `</svg>`
  return { svg, W, H }
}

;(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Users/Dr Paradzayi/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
  for (const [name, fig] of [['fig-road', figRoad()], ['fig-gates', figGates()]]) {
    fs.writeFileSync(path.join(OUT, name + '.svg'), fig.svg)
    const page = await browser.newPage({ viewport: { width: fig.W, height: fig.H }, deviceScaleFactor: 2 })
    await page.setContent(`<html><body style="margin:0;background:#fff">${fig.svg}</body></html>`)
    await page.screenshot({ path: path.join(OUT, name + '.png'), clip: { x: 0, y: 0, width: fig.W, height: fig.H } })
    await page.close()
    console.log('wrote', name, fig.W + 'x' + fig.H)
  }
  await browser.close()
})()
