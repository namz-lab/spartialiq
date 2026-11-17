/** Saving what the server sent. The CSV itself is built server-side and saved as it arrives. */

/** Save a blob as a file: an object URL on a temporary anchor, revoked afterwards. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
    URL.revokeObjectURL(url)
  }
}

/** `['Trial balance', 'USD', '2026-09-30']` becomes `trial-balance-usd-2026-09-30.csv`. */
export function csvName(parts: (string | null | undefined)[]): string {
  const stem = parts
    .filter((p): p is string => !!p && p.trim() !== '')
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
  return `${stem}.csv`
}
