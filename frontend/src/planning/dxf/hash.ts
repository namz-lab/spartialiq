export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  if (globalThis.crypto?.subtle) {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
  }
  let h = 2166136261
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 16777619)
  }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, '0')}`
}

export function looksLikeDwg(bytes: Uint8Array | string): boolean {
  const head = typeof bytes === 'string' ? bytes.slice(0, 6) : String.fromCharCode(...bytes.slice(0, 6))
  return /^AC10\d\d/.test(head)
}

export function looksLikeDxf(text: string): boolean {
  const t = text.replace(/^\uFEFF/, '').trimStart()
  if (!t) return false
  if (looksLikeDwg(t)) return false
  return /^(999\b|0\s*\r?\n\s*SECTION\b|  0\s*\r?\nSECTION\b)/i.test(t) || /\bSECTION\b/.test(t.slice(0, 400))
}

export function downloadTextFile(fileName: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
