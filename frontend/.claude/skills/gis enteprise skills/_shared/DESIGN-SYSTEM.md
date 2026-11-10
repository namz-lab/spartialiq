# DESIGN-SYSTEM — frontend visual language (GIS-EOS)

**Scope: `gis-eos-frontend` and UI work only.** This does not govern backend/GIS conventions.

## Source of truth: tokens, not a page
The visual language is seeded from `src/views/admin/LoginView.vue` but the authority is the
`--login-*` custom properties in **`src/styles/main.css`** (`:root`), imported globally at
`src/main.ts:5`. **Never hardcode these hex/px values — reference the token.**

> Deliberate divergence: DESIGN.md specifies accent `#1a73e8`, flat surfaces, no gradients.
> The frontend design skill intentionally follows LoginView.vue (`#0066cc`, gradients, glow)
> per user choice. This is a conscious scope decision, recorded here and in ADR.

## Tokens (all defined in main.css `:root`)
| Purpose | Token | Value |
|---|---|---|
| Accent / focus / links | `--login-accent` | `#0066cc` |
| Accent hover | `--login-accent-dark` | `#0052a3` |
| Focus ring | `--login-accent-ring` | `rgba(0,102,204,.1)` (use as `0 0 0 3px`) |
| Heading text | `--login-heading` | `#1a1a1a` |
| Label text | `--login-label` | `#333` |
| Muted/subtitle | `--login-muted` | `#666` |
| Input border | `--login-input-border` | `#e1e5e9` (2px) |
| Card surface | `--login-surface` | `#fff` |
| Card radius | `--login-card-radius` | `12px` |
| Control radius | `--login-control-radius` | `8px` |
| Card shadow | `--login-card-shadow` | `0 20px 40px rgba(0,0,0,.1)` |
| Primary button | `--login-btn-gradient` | `linear-gradient(135deg,#0066cc,#0052a3)` |
| Error surface | `--login-error-bg` / `--login-error-fg` | `#ffeeee` / `#cc3333` |
| Page shell bg | `--login-page-gradient` | `linear-gradient(135deg,#667eea,#764ba2)` |
| Motion | `--login-motion` | `all .2s ease` |

Type scale: heading 28/700, subtitle 14, label 14/500, body 14. Inputs: `padding:12px 16px`.
Primary button: `padding:14px 24px; font:16px/600`; hover adds `translateY(-1px)` + shadow;
disabled `#ccc`. Responsive: single column below `480px`, card padding `32px 24px`.

## Icons — lucide only
```ts
import { AlertCircle, MapPin } from 'lucide-vue-next'
```
`<AlertCircle :size="16" />`. Worked example: replace LoginView.vue's placeholder
`<i class="icon-error"></i>` with `<AlertCircle :size="16" />`. Icon-only buttons need `aria-label`.

## Non-negotiables (a11y)
WCAG 2.1 AA contrast, visible focus ring on every interactive element, honour
`prefers-reduced-motion`, every input has a `<label for>`, loading/empty/error states present.
