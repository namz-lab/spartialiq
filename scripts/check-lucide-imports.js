/**
 * Fail fast if any lucide-vue-next named import is missing from the package.
 * Run before production builds: node scripts/check-lucide-imports.js
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', 'frontend', 'src')
const lucide = require(path.join(__dirname, '..', 'frontend', 'node_modules', 'lucide-vue-next'))

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(vue|ts|tsx|js)$/.test(e.name)) acc.push(p)
  }
  return acc
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const re = /import\s*\{([^}]+)\}\s*from\s*['"]lucide-vue-next['"]/g
const bad = []
for (const f of walk(root)) {
  const t = stripComments(fs.readFileSync(f, 'utf8'))
  let m
  while ((m = re.exec(t))) {
    const names = m[1]
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean)
    for (const n of names) {
      if (!lucide[n]) bad.push(`${path.relative(root, f)}: ${n}`)
    }
  }
}

if (bad.length) {
  console.error('Missing lucide icons:\n' + bad.join('\n'))
  process.exit(1)
}
console.log('lucide imports OK')
