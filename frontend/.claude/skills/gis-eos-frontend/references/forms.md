# Frontend reference — forms

Load when building an input form (applications, assessments, inspections).

## Structure (mirror LoginView.vue)
- `form-group` = `<label for>` + control + inline error slot. Label 14/500 `--login-label`.
- Input: `padding:12px 16px; border:2px solid var(--login-input-border); border-radius:
  var(--login-control-radius)`. Focus: `border-color:var(--login-accent); box-shadow:0 0 0 3px
  var(--login-accent-ring)`. Disabled: `var(--login-input-disabled)`.
- Primary button: `background: var(--login-btn-gradient)`; disabled `#ccc`; loading label swap.
- Error surface: `--login-error-bg` / `--login-error-fg` with a lucide `<AlertCircle :size="16"/>`.

## Validation (defence in depth)
- Client-side for UX (`computed` validity like LoginView's `isFormValid`), but **the server
  validates too** — never trust the client (STANDARDS.md, backend reject-gate).
- Money/identity/permit fields: server is the source of truth for amount + status.
- Show one clear error per field; don't block submit silently — disable with a reason.

## A11y
Every control labelled, errors linked via `aria-describedby`, focus moves to first error on
submit, `prefers-reduced-motion` respected. No placeholder-as-label.
