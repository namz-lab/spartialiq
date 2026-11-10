# Council Letterhead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse four divergent letterhead surfaces into one identity module with a single swappable artwork asset.

**Architecture:** One pure TypeScript module holds the council's identity and the artwork path. Three renderers consume it — a jsPDF drawer, a Vue component, and a backend email-HTML function. Each falls back to a typographic letterhead when the artwork is absent, so nothing is ever visibly broken. Dropping the real artwork file at a fixed path completes the work with no code change.

**Tech Stack:** Vue 3, TypeScript, jsPDF (already a dependency), Vitest + happy-dom, Node/CommonJS for the backend.

**Spec:** `docs/superpowers/specs/2026-09-21-production-test-readiness-design.md`

**Repo gotchas:**
- Vitest has no global environment. Any spec that calls `mount()` needs `// @vitest-environment happy-dom` as **line 1**.
- Run tests with `npm run test:unit -- --no-file-parallelism` — the full parallel run flakes with `reading 'config'`.
- Type-check with `npm run type-check` (vue-tsc). Plain `tsc` emits ~44 false "cannot find module" errors on `.vue` files.
- The backend is a **separate repo** at `../app-backend` and uses CommonJS.

---

### Task 1: Council identity module

The single source of truth. Values are taken from the existing receipt markup
(`src/views/PaymentReceiptView.vue:31-35`), which is the only place today that
carries the full address and contacts.

**Files:**
- Create: `src/documents/council.ts`
- Test: `src/documents/__tests__/council.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { COUNCIL, LETTERHEAD_ASSET } from '../council'

describe('council identity', () => {
  it('carries the registered council name in upper case', () => {
    expect(COUNCIL.name).toBe('VUNGU RURAL DISTRICT COUNCIL')
  })

  it('carries a postal address, telephone and email', () => {
    expect(COUNCIL.address).toBe('Stand 1, Gweru Road, Gweru, Zimbabwe')
    expect(COUNCIL.telephone).toBe('+263 54 123 456')
    expect(COUNCIL.email).toBe('admin@vungu.gov.zw')
  })

  it('exposes one artwork path so the asset can be swapped without code changes', () => {
    expect(LETTERHEAD_ASSET).toBe('/letterhead/council-letterhead.png')
  })

  it('offers a contact line that joins telephone and email', () => {
    expect(COUNCIL.contactLine()).toBe('Tel: +263 54 123 456  |  admin@vungu.gov.zw')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --no-file-parallelism src/documents/__tests__/council.spec.ts`
Expected: FAIL — `Failed to resolve import "../council"`.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * The council's identity, in one place. Every letterhead — PDF, screen, print
 * and email — renders from this module, so a notice and the certificate that
 * follows it cannot drift apart.
 *
 * Pure data and pure functions: no Vue, no I/O, no jsPDF.
 */

export interface CouncilIdentity {
  name: string
  department: string
  address: string
  telephone: string
  email: string
  /** Telephone and email as one line, for a letterhead's contact row. */
  contactLine: () => string
}

export const COUNCIL: CouncilIdentity = {
  name: 'VUNGU RURAL DISTRICT COUNCIL',
  department: 'Department of Environmental Health',
  address: 'Stand 1, Gweru Road, Gweru, Zimbabwe',
  telephone: '+263 54 123 456',
  email: 'admin@vungu.gov.zw',
  contactLine() {
    return `Tel: ${this.telephone}  |  ${this.email}`
  },
}

/**
 * The one swap point. Drop the council's real letterhead artwork at this path
 * under `public/` and every surface picks it up with no code change.
 *
 * Until that file exists, every renderer falls back to a typographic
 * letterhead. That fallback is deliberate: the previous surveyor
 * implementation hard-coded an image path that did not exist, so every print
 * carried a broken image.
 */
export const LETTERHEAD_ASSET = '/letterhead/council-letterhead.png'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --no-file-parallelism src/documents/__tests__/council.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/documents/council.ts src/documents/__tests__/council.spec.ts
git commit -m "feat(documents): one council identity module"
```

---

### Task 2: jsPDF letterhead drawer

Replaces the hand-drawn header inside `councilDoc()`. `councilDoc()` keeps its
exact signature, so its eight existing callers are untouched.

**Files:**
- Create: `src/documents/letterheadPdf.ts`
- Test: `src/documents/__tests__/letterheadPdf.spec.ts`

- [ ] **Step 1: Write the failing test**

jsPDF is real here rather than mocked — it runs headless and its internal text
list is readable, which makes the assertions meaningful rather than
tautological.

```ts
import { describe, it, expect } from 'vitest'
import jsPDF from 'jspdf'
import { drawLetterhead } from '../letterheadPdf'
import { COUNCIL } from '../council'

/** Every string drawn onto the page, flattened. */
function textOf(doc: jsPDF): string {
  // @ts-expect-error - internal, but stable and the only way to read back text
  return doc.internal.pages.flat().join(' ')
}

describe('drawLetterhead', () => {
  it('writes the council name onto the page', () => {
    const doc = new jsPDF()
    drawLetterhead(doc, { department: COUNCIL.department })
    expect(textOf(doc)).toContain('VUNGU RURAL DISTRICT COUNCIL')
  })

  it('writes the department it was given', () => {
    const doc = new jsPDF()
    drawLetterhead(doc, { department: 'Department of Planning' })
    expect(textOf(doc)).toContain('Department of Planning')
  })

  it('returns a cursor below the letterhead so callers can keep writing', () => {
    const doc = new jsPDF()
    const y = drawLetterhead(doc, { department: COUNCIL.department })
    expect(y).toBeGreaterThan(28)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --no-file-parallelism src/documents/__tests__/letterheadPdf.spec.ts`
Expected: FAIL — `Failed to resolve import "../letterheadPdf"`.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * The letterhead as drawn onto a jsPDF page.
 *
 * Typographic rather than an image: jsPDF needs the artwork rasterised and
 * base64-encoded before it can place it, which would make every PDF heavier
 * and would fail silently when the asset is missing. The council's identity is
 * short enough to set in type, and type always renders.
 */
import type jsPDF from 'jspdf'
import { COUNCIL } from './council'

export interface LetterheadOptions {
  /** The issuing department, printed beneath the council name. */
  department: string
}

/**
 * Draws the letterhead at the top of the current page.
 *
 * @returns the y cursor, in mm, immediately below the rule.
 */
export function drawLetterhead(doc: jsPDF, opts: LetterheadOptions): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(COUNCIL.name, 105, 18, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(opts.department, 105, 24, { align: 'center' })

  doc.setFontSize(8)
  doc.text(COUNCIL.address, 105, 29, { align: 'center' })
  doc.text(COUNCIL.contactLine(), 105, 33, { align: 'center' })

  doc.setLineWidth(0.4)
  doc.line(14, 36, 196, 36)

  return 36
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --no-file-parallelism src/documents/__tests__/letterheadPdf.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/documents/letterheadPdf.ts src/documents/__tests__/letterheadPdf.spec.ts
git commit -m "feat(documents): jsPDF letterhead drawer"
```

---

### Task 3: Point the EHO documents module at the shared drawer

`src/environment-officer/documents.ts:16-27` currently draws its own header.
It becomes a caller of Task 2. Its eight callers across three EHO sections are
not touched:

- `src/views/environment-officer/sections/CertificatesSection.vue:158,205,266`
- `src/views/environment-officer/sections/EnforcementSection.vue:262,276`
- `src/views/environment-officer/sections/ReportsSection.vue:79`

**Files:**
- Modify: `src/environment-officer/documents.ts:16-27`
- Test: `src/environment-officer/__tests__/documents.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { councilDoc } from '../documents'

function textOf(d: { doc: unknown }): string {
  // @ts-expect-error - internal, but stable
  return d.doc.internal.pages.flat().join(' ')
}

describe('councilDoc', () => {
  it('renders the shared council letterhead', () => {
    const d = councilDoc('Abatement notice', 'REF/001')
    const text = textOf(d)
    expect(text).toContain('VUNGU RURAL DISTRICT COUNCIL')
    expect(text).toContain('Department of Environmental Health')
  })

  it('renders the address, which the old hand-drawn header omitted', () => {
    expect(textOf(councilDoc('Abatement notice', 'REF/001')))
      .toContain('Stand 1, Gweru Road, Gweru, Zimbabwe')
  })

  it('still renders the title and subtitle it was given', () => {
    const text = textOf(councilDoc('Abatement notice', 'REF/001'))
    expect(text).toContain('ABATEMENT NOTICE')
    expect(text).toContain('REF/001')
  })

  it('leaves the cursor clear of the letterhead', () => {
    expect(councilDoc('Abatement notice', 'REF/001').y).toBeGreaterThan(45)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --no-file-parallelism src/environment-officer/__tests__/documents.spec.ts`
Expected: FAIL on the address assertion — the current header draws only the
name, the department and a rule.

- [ ] **Step 3: Replace the hand-drawn header**

Replace lines 16-27 of `src/environment-officer/documents.ts` (the whole
`councilDoc` function body) with:

```ts
export function councilDoc(title: string, subtitle: string): CouncilDoc {
  const doc = new jsPDF()
  const y = drawLetterhead(doc, { department: COUNCIL.department })

  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text(title.toUpperCase(), 105, y + 9, { align: 'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text(subtitle, 105, y + 14, { align: 'center' })
  return { doc, y: y + 24 }
}
```

Add to the imports at the top of the file, below the existing `import jsPDF`:

```ts
import { COUNCIL } from '@/documents/council'
import { drawLetterhead } from '@/documents/letterheadPdf'
```

Update the module docstring's second paragraph, which no longer describes what
the file does:

```ts
/**
 * Council documents the EHO console prints — notices, dossiers, certificates,
 * permits. One layout, so a notice and the certificate that follows it look
 * like they came from the same office.
 *
 * The letterhead itself lives in `@/documents/letterheadPdf`, shared with
 * every other surface that carries the council's identity.
 */
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --no-file-parallelism src/environment-officer/`
Expected: PASS — the 4 new tests, plus `console.spec.ts`, `report.spec.ts` and
`waterQuality.spec.ts` unchanged.

- [ ] **Step 5: Verify the EHO sections still type-check**

Run: `npm run type-check`
Expected: exit 0, no output. This confirms the eight callers still match
`councilDoc`'s signature.

- [ ] **Step 6: Commit**

```bash
git add src/environment-officer/documents.ts src/environment-officer/__tests__/documents.spec.ts
git commit -m "refactor(eho): draw the shared letterhead instead of its own"
```

---

### Task 4: The Vue letterhead component

For screen and print. Uses the artwork when it loads and falls back to type
when it does not, which is what stops the surveyor's broken-image bug
recurring.

**Files:**
- Create: `src/components/documents/CouncilLetterhead.vue`
- Test: `src/components/documents/__tests__/CouncilLetterhead.spec.ts`

- [ ] **Step 1: Write the failing test**

Note `// @vitest-environment happy-dom` on line 1 — required, this spec mounts.

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CouncilLetterhead from '../CouncilLetterhead.vue'

describe('CouncilLetterhead', () => {
  it('renders the council name and address as text', () => {
    const w = mount(CouncilLetterhead, { props: { docType: 'OFFICIAL RECEIPT' } })
    expect(w.text()).toContain('VUNGU RURAL DISTRICT COUNCIL')
    expect(w.text()).toContain('Stand 1, Gweru Road, Gweru, Zimbabwe')
  })

  it('renders the document type and reference it was given', () => {
    const w = mount(CouncilLetterhead, {
      props: { docType: 'OFFICIAL RECEIPT', reference: 'RCP-0042' },
    })
    expect(w.text()).toContain('OFFICIAL RECEIPT')
    expect(w.text()).toContain('RCP-0042')
  })

  it('attempts the artwork', () => {
    const w = mount(CouncilLetterhead, { props: { docType: 'NOTICE' } })
    expect(w.find('img').attributes('src')).toBe('/letterhead/council-letterhead.png')
  })

  it('falls back to the typographic mark when the artwork fails to load', async () => {
    const w = mount(CouncilLetterhead, { props: { docType: 'NOTICE' } })
    await w.find('img').trigger('error')
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).toContain('VUNGU RURAL DISTRICT COUNCIL')
  })

  it('never renders an emoji as the coat of arms', () => {
    const w = mount(CouncilLetterhead, { props: { docType: 'NOTICE' } })
    expect(w.text()).not.toContain('\u{1F6E1}')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --no-file-parallelism src/components/documents/`
Expected: FAIL — `Failed to resolve import "../CouncilLetterhead.vue"`.

- [ ] **Step 3: Write minimal implementation**

```vue
<script setup lang="ts">
/**
 * The council letterhead for screen and print.
 *
 * The artwork is attempted first and the typographic mark is the fallback, not
 * a placeholder: if the asset is missing or blocked, the council's identity
 * still renders. The surface this replaces hard-coded an image path that did
 * not exist, so every print carried a broken image icon.
 */
import { ref } from 'vue'
import { COUNCIL, LETTERHEAD_ASSET } from '@/documents/council'

defineProps<{
  /** e.g. 'OFFICIAL RECEIPT'. Printed on the right. */
  docType: string
  /** Reference or receipt number, under the document type. */
  reference?: string
}>()

const artworkFailed = ref(false)
</script>

<template>
  <div class="lh">
    <div class="lh-left">
      <img
        v-if="!artworkFailed"
        :src="LETTERHEAD_ASSET"
        alt=""
        class="lh-art"
        @error="artworkFailed = true"
      >
      <div>
        <div class="lh-name">{{ COUNCIL.name }}</div>
        <div class="lh-sub">{{ COUNCIL.address }}</div>
        <div class="lh-sub">{{ COUNCIL.contactLine() }}</div>
      </div>
    </div>
    <div class="lh-right">
      <div class="lh-doctype">{{ docType }}</div>
      <div v-if="reference" class="lh-ref">{{ reference }}</div>
    </div>
  </div>
</template>

<style scoped>
.lh { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
.lh-left { display: flex; align-items: flex-start; gap: 1rem; }
.lh-art { height: 56px; width: auto; object-fit: contain; }
.lh-name { font-family: 'Playfair Display', serif; font-size: .98rem; color: #1a3d2b; font-weight: 700; letter-spacing: .02em; }
.lh-sub { font-size: .72rem; color: #4a5a50; line-height: 1.5; }
.lh-right { text-align: right; }
.lh-doctype { font-size: .72rem; letter-spacing: .12em; color: #4a5a50; text-transform: uppercase; }
.lh-ref { font-size: .9rem; color: #1a3d2b; font-weight: 700; }

@media (max-width: 600px) {
  .lh { flex-direction: column; }
  .lh-right { text-align: left; }
}

@media print {
  .lh-art { height: 64px; }
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --no-file-parallelism src/components/documents/`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/documents/CouncilLetterhead.vue src/components/documents/__tests__/CouncilLetterhead.spec.ts
git commit -m "feat(documents): council letterhead component for screen and print"
```

---

### Task 5: Replace the emoji letterhead on the receipt

**Files:**
- Modify: `src/views/PaymentReceiptView.vue:27-42` (markup), and the
  `.rcpt-letterhead` / `.rcpt-lh-left` / `.rcpt-coat-arms` /
  `.rcpt-council-name` / `.rcpt-council-sub` / `.rcpt-lh-right` /
  `.rcpt-doc-type` / `.rcpt-receipt-no` rules in its `<style>` block
- Test: `src/views/__tests__/paymentReceiptLetterhead.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(__dirname, '../PaymentReceiptView.vue'), 'utf8',
)

describe('PaymentReceiptView letterhead', () => {
  it('uses the shared component', () => {
    expect(source).toContain('CouncilLetterhead')
  })

  it('no longer uses the shield emoji as a coat of arms', () => {
    expect(source).not.toContain('\u{1F6E1}')
  })

  it('no longer hard-codes the council address', () => {
    expect(source).not.toContain('Stand 1, Gweru Road')
  })
})
```

This reads the source rather than mounting, because mounting the view needs a
route, a payments API stub and a store. The letterhead swap is a structural
change and source assertions catch a regression just as reliably.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --no-file-parallelism src/views/__tests__/paymentReceiptLetterhead.spec.ts`
Expected: FAIL — all three: the component is absent, the emoji is present at
line 30, the address is hard-coded at line 33.

- [ ] **Step 3: Replace the markup**

Replace lines 27-42 of `src/views/PaymentReceiptView.vue` — the
`<!-- Letterhead -->` comment through the closing `</div>` of
`.rcpt-letterhead` — with:

```vue
      <CouncilLetterhead
        doc-type="OFFICIAL RECEIPT"
        :reference="tx.receipt_no || tx.ref_no"
        class="rcpt-letterhead"
      />
```

Add the import to the view's `<script setup>` block:

```ts
import CouncilLetterhead from '@/components/documents/CouncilLetterhead.vue'
```

- [ ] **Step 4: Remove the dead styles**

In the `<style>` block, delete these now-unused rules: `.rcpt-lh-left`,
`.rcpt-coat-arms`, `.rcpt-council-name`, `.rcpt-council-sub`, `.rcpt-lh-right`,
`.rcpt-doc-type`, `.rcpt-receipt-no`, and the `.rcpt-lh-right` override inside
the `@media(max-width:600px)` block.

Keep `.rcpt-letterhead`, reduced to spacing only, since it is now a layout
wrapper passed to the component:

```css
.rcpt-letterhead{margin-bottom:1.5rem}
```

Also delete the `.rcpt-letterhead{flex-direction:column;gap:1rem}` rule inside
the `@media(max-width:600px)` block — the component handles its own narrow
layout.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit -- --no-file-parallelism src/views/__tests__/paymentReceiptLetterhead.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/views/PaymentReceiptView.vue src/views/__tests__/paymentReceiptLetterhead.spec.ts
git commit -m "fix(payments): real letterhead on the receipt, not an emoji"
```

---

### Task 6: Fix the surveyor estimate's broken image

`EstimateView.vue` probes three URLs that do not exist, so every estimate
prints a broken image. The probe goes; the component replaces it.

**Files:**
- Modify: `src/views/surveyor/views/modules/lite/finance/EstimateView.vue`
  — markup at lines 3-6, the refs at 471-472, the preload blocks at 476-492
  and 496-510, the `onMounted` probe at 532-542, and the print styles at
  899-905
- Test: `src/views/surveyor/__tests__/estimateLetterhead.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(__dirname, '../views/modules/lite/finance/EstimateView.vue'), 'utf8',
)

describe('EstimateView letterhead', () => {
  it('uses the shared component', () => {
    expect(source).toContain('CouncilLetterhead')
  })

  it('no longer probes letterhead URLs that do not exist', () => {
    expect(source).not.toContain('/tariff/letterhead.png')
    expect(source).not.toContain('/help/letterhead.png')
  })

  it('no longer hard-codes a bare letterhead path', () => {
    expect(source).not.toContain("'/letterhead.png'")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --no-file-parallelism src/views/surveyor/__tests__/estimateLetterhead.spec.ts`
Expected: FAIL — all three assertions.

- [ ] **Step 3: Replace the markup**

Replace lines 3-6 (the `<!-- Letterhead image for print views -->` block) with:

```vue
    <div v-if="printMode==='summary' || printMode==='detailed'" class="print-letterhead mb-4">
      <CouncilLetterhead doc-type="Financial Estimate" />
    </div>
```

Add the import alongside the other imports in `<script setup>`:

```ts
import CouncilLetterhead from '@/components/documents/CouncilLetterhead.vue'
```

- [ ] **Step 4: Delete the probe and the preloaders**

Delete the two refs at lines 471-472:

```ts
const letterheadEl = ref<HTMLImageElement|null>(null)
const letterheadSrc = ref<string>('/letterhead.png')
```

In both `exportSummaryPdf()` and `exportDetailedPdf()`, delete the
`const img = letterheadEl.value` preload block — the whole `if (img &&
!img.complete) { await new Promise(...) }` construct in each. The `nextTick`
wrapper and the `window.print()` call after it stay.

In `onMounted`, delete the whole probe: the comment at line 532 through the
closing `catch {}` at line 542.

These go because the component now owns loading and its own fallback. Waiting
on an image that may never exist was the reason the old code needed a probe.

- [ ] **Step 5: Keep the print styles, drop the image rule**

In the `@media print` block, keep `.print-letterhead` and delete
`.print-letterhead-img`, which no longer matches anything:

```css
  .print-letterhead { display: block !important; text-align: left; margin-bottom: 1rem; }
```

Leave the `@media screen { .print-letterhead { display: none; } }` rule as-is.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:unit -- --no-file-parallelism src/views/surveyor/__tests__/estimateLetterhead.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Type-check**

Run: `npm run type-check`
Expected: exit 0. This catches any leftover reference to the deleted refs.

- [ ] **Step 8: Commit**

```bash
git add src/views/surveyor/views/modules/lite/finance/EstimateView.vue src/views/surveyor/__tests__/estimateLetterhead.spec.ts
git commit -m "fix(surveyor): replace the broken letterhead probe with the shared component"
```

---

### Task 7: Backend council config

The backend cannot import `src/documents/council.ts` — separate repo, and it
is CommonJS. It gets a mirror, plus a test asserting the fields it depends on,
so the two cannot drift silently. Silent duplication is how the four surfaces
diverged in the first place.

**Files:**
- Create: `../app-backend/src/config/council.js`
- Test: `../app-backend/src/config/__tests__/council.test.js`

- [ ] **Step 1: Write the failing test**

The backend uses Jest. Check the existing convention with
`cat ../app-backend/jest.config.js` before writing.

```js
const { COUNCIL, emailLetterhead } = require('../council')

describe('council config', () => {
  it('carries the same identity the frontend renders', () => {
    expect(COUNCIL.name).toBe('VUNGU RURAL DISTRICT COUNCIL')
    expect(COUNCIL.address).toBe('Stand 1, Gweru Road, Gweru, Zimbabwe')
    expect(COUNCIL.email).toBe('admin@vungu.gov.zw')
  })

  it('renders an inline-styled letterhead with no stylesheet dependency', () => {
    const html = emailLetterhead()
    expect(html).toContain('VUNGU RURAL DISTRICT COUNCIL')
    expect(html).toContain('style=')
    expect(html).not.toContain('<style')
  })

  it('uses no remote image, which mail clients block by default', () => {
    expect(emailLetterhead()).not.toContain('<img')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ../app-backend && npx jest src/config/__tests__/council.test.js`
Expected: FAIL — `Cannot find module '../council'`.

- [ ] **Step 3: Write minimal implementation**

```js
/**
 * The council's identity for outbound mail.
 *
 * This mirrors `src/documents/council.ts` in the frontend repo, which cannot
 * be imported across the repo boundary. The test beside this file asserts the
 * fields, so the two cannot drift without a red build. If you change one,
 * change both.
 */

const COUNCIL = {
  name: 'VUNGU RURAL DISTRICT COUNCIL',
  address: 'Stand 1, Gweru Road, Gweru, Zimbabwe',
  telephone: '+263 54 123 456',
  email: 'admin@vungu.gov.zw',
}

/**
 * The letterhead as inline-styled email HTML.
 *
 * Typographic, with no image. Mail clients block remote images by default and
 * strip `<style>` blocks, so artwork can never be the thing carrying the
 * council's identity in an email — it would simply be absent for most
 * recipients.
 */
function emailLetterhead() {
  return [
    '<div style="border-bottom:2px solid #1a3d2b;padding-bottom:12px;margin-bottom:20px;">',
    `<div style="font-size:15px;font-weight:700;color:#1a3d2b;letter-spacing:.02em;">${COUNCIL.name}</div>`,
    `<div style="font-size:12px;color:#4a5a50;line-height:1.5;">${COUNCIL.address}</div>`,
    `<div style="font-size:12px;color:#4a5a50;line-height:1.5;">Tel: ${COUNCIL.telephone} | ${COUNCIL.email}</div>`,
    '</div>',
  ].join('')
}

module.exports = { COUNCIL, emailLetterhead }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ../app-backend && npx jest src/config/__tests__/council.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

Commit in the **backend** repo. Its worktree carries unrelated dirty files —
stage only these two paths, and never stash there.

```bash
cd ../app-backend
git add src/config/council.js src/config/__tests__/council.test.js
git commit -m "feat(config): council identity and email letterhead"
```

---

### Task 8: Put the letterhead on outbound email

`textToHtml` in `notifier.js:258-267` claims in its docstring to keep "the
council letterhead simple and inline-styled", but emits a bare `<div>`. Every
email a citizen receives is anonymous.

**Files:**
- Modify: `../app-backend/src/services/notifier.js:253-267`
- Test: `../app-backend/src/services/__tests__/notifierLetterhead.test.js` (create)

- [ ] **Step 1: Write the failing test**

`textToHtml` is module-private. Export it for testing rather than reaching
into the module — an exported pure function is the smaller change.

```js
const { textToHtml } = require('../notifier')

describe('textToHtml', () => {
  it('puts the council letterhead above the body', () => {
    const html = textToHtml('Your application was received.')
    expect(html).toContain('VUNGU RURAL DISTRICT COUNCIL')
    expect(html.indexOf('VUNGU RURAL DISTRICT COUNCIL'))
      .toBeLessThan(html.indexOf('Your application was received.'))
  })

  it('still renders one paragraph per blank-line-separated block', () => {
    const html = textToHtml('First block.\n\nSecond block.')
    expect(html).toContain('<p style="margin:0 0 1em;">First block.</p>')
    expect(html).toContain('<p style="margin:0 0 1em;">Second block.</p>')
  })

  it('still turns single newlines into breaks', () => {
    expect(textToHtml('Line one.\nLine two.')).toContain('Line one.<br>Line two.')
  })

  it('still escapes markup in the body', () => {
    expect(textToHtml('5 < 6 & <script>')).toContain('5 &lt; 6 &amp; &lt;script&gt;')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ../app-backend && npx jest src/services/__tests__/notifierLetterhead.test.js`
Expected: FAIL — `textToHtml is not a function` (not yet exported).

- [ ] **Step 3: Prepend the letterhead**

Replace the docstring and function at `notifier.js:253-267`:

```js
/**
 * Wrap a plain-text email body in minimal, email-safe HTML. One <p> per
 * blank-line-separated block; single newlines become <br>. The council
 * letterhead is prepended and inline-styled, because mail clients ignore
 * <style>.
 */
function textToHtml(text) {
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const blocks = String(text).split(/\n{2,}/).map(b => b.trim()).filter(Boolean)
  const paras = blocks
    .map(b => `<p style="margin:0 0 1em;">${esc(b).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;line-height:1.6;max-width:560px;">
${emailLetterhead()}
${paras}
</div>`
}
```

Add the require near the top of the file, with the other local requires:

```js
const { emailLetterhead } = require('../config/council')
```

- [ ] **Step 4: Export it**

Find the `module.exports` block at the end of `notifier.js` and add
`textToHtml` to it, keeping the existing entries.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ../app-backend && npx jest src/services/__tests__/notifierLetterhead.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 6: Check nothing else that sends mail regressed**

Run: `cd ../app-backend && npx jest src/services/`
Expected: no **new** failures. Payment and surveyor suites fail already — that
is the recorded pre-existing baseline, not this change.

- [ ] **Step 7: Commit**

```bash
cd ../app-backend
git add src/services/notifier.js src/services/__tests__/notifierLetterhead.test.js
git commit -m "fix(notifier): council letterhead on outbound email"
```

---

### Task 9: The artwork drop point

Creates the directory and documents the swap, so the real file is a drag and
drop rather than a code change.

**Files:**
- Create: `public/letterhead/README.md`

- [ ] **Step 1: Write the note**

```markdown
# Council letterhead artwork

Drop the council's letterhead here as:

    council-letterhead.png

That filename is the one swap point. Every surface that carries the council's
identity reads it from `LETTERHEAD_ASSET` in `src/documents/council.ts`, so no
code changes when the artwork arrives.

**Requirements**

- PNG with a transparent background, or SVG.
- At least 2000px wide, so it stays sharp in print.
- Trimmed to the mark and wordmark. The address and contacts are set in type
  beneath it — artwork that repeats them will render them twice.

**What renders when this file is absent**

A typographic letterhead: council name, address, contact line, rule. This is
deliberate. The surveyor estimate previously hard-coded an image path that did
not exist, so every print carried a broken-image icon. The fallback means the
council's identity is always present.

**Not used by email.** Mail clients block remote images by default, so
outbound mail always uses the typographic letterhead from
`../app-backend/src/config/council.js`.
```

- [ ] **Step 2: Verify the fallback renders**

Run: `npm run dev`, open `http://localhost:5174/receipt/<any-ref>`.
Expected: the council name, address and contacts render as text. No
broken-image icon anywhere on the page.

- [ ] **Step 3: Commit**

```bash
git add public/letterhead/README.md
git commit -m "docs(letterhead): artwork drop point and asset requirements"
```

---

### Task 10: Full verification

- [ ] **Step 1: Frontend test suite**

Run: `npm run test:unit -- --no-file-parallelism`
Expected: PASS. Record any pre-existing failures; do not fix them here.

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: exit 0, clean — this was the baseline before the work and must stay.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: the 3 known pre-existing errors outside the inspector module. No new
ones.

- [ ] **Step 4: Confirm every surface is converted**

Run:

```bash
grep -rn "letterhead" src/ --include=*.vue --include=*.ts | grep -v "src/documents/" | grep -v "components/documents/" | grep -v "__tests__"
```

Expected: only layout class names (`.print-letterhead`, `.rcpt-letterhead`).
No image paths, no `letterheadSrc`, no emoji. Anything else is a missed
surface.

- [ ] **Step 5: Confirm the four surfaces render**

With `npm run dev` running, and signed in per portal:

1. Receipt — `/receipt/<ref>`: letterhead at the top, no emoji.
2. Surveyor estimate — the Lite finance module, Export summary: letterhead in
   the print preview, no broken image.
3. EHO certificate — the EHO console's Certificates section, generate any
   certificate: the PDF opens with the council name, department and address.
4. Email — with `MAIL_TRANSPORT=console`, submit an application and read the
   backend's console output: the HTML body begins with the letterhead.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix(documents): letterhead verification fixes"
```
