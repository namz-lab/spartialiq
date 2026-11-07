# Council letterhead artwork

Drop the council's letterhead here as:

    council-letterhead.png

That filename is the one swap point. Every surface that carries the council's
identity reads it from `LETTERHEAD_ASSET` in `src/documents/council.ts`, so no
code changes when the artwork arrives.

## Requirements

- PNG with a transparent background, or SVG.
- At least 2000px wide, so it stays sharp in print.
- Trimmed to the mark and wordmark. The address and contacts are set in type
  beneath it — artwork that repeats them will render them twice.

## What renders when this file is absent

A typographic letterhead: council name, address, contact line, rule. This is
deliberate, not a placeholder. The surveyor estimate previously hard-coded an
image path that did not exist, so every print carried a broken-image icon. The
fallback means the council's identity is always present.

## Where it appears

| Surface | Renderer |
| --- | --- |
| Payment receipt | `src/components/documents/CouncilLetterhead.vue` |
| Surveyor financial estimate | the same component |
| EHO notices, certificates, permits, dossiers | `src/documents/letterheadPdf.ts` |
| Outbound email | `../app-backend/src/config/council.js` |

The PDF and email letterheads are **typographic by design and do not use this
artwork**. jsPDF would need it rasterised and base64-encoded into every
document, and mail clients block remote images by default — in both cases the
artwork would be absent or costly exactly where the council's identity matters
most. Only the on-screen and print surfaces show it.

## Theming

The component takes its colours from `--lh-name-color`, `--lh-sub-color`,
`--lh-doctype-color` and `--lh-ref-color`, each defaulting to the council's
standard ink. A host document with its own palette maps those properties on
the element it passes to the component — see `.rcpt-letterhead` in
`src/views/PaymentReceiptView.vue`. Scoped styles mean a parent cannot reach
inside the component any other way.
