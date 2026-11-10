---
name: gis-eos-frontend
description: Frontend/UI specialist for the Vungu GIS platform. Use for any Vue 3 UI work — components, pages, dashboards, forms, modals, layouts. Enforces the LoginView.vue-derived design tokens (--login-* in src/styles/main.css), lucide-vue-next icons, WCAG 2.1 AA, and reuse of existing src/components. Rejects hardcoded colors, duplicate components, and missing loading/empty/error states.
---

# GIS-EOS Frontend

Vue 3 `<script setup lang="ts">` only. Read `_shared/DESIGN-SYSTEM.md` (tokens + lucide) and
`_shared/STANDARDS.md`. References for depth: `references/components.md`, `dashboards.md`,
`forms.md`.

## Reuse before you build (ladder rung 2)
Check `src/components/*` and PATTERNS.md first — `ParcelSelectorMap`, `StandPickerModal`,
`PaymentMethodPicker`, `workflow/ApplicationPipeline`, `map/*`, `UiFeedback`. Extend before adding.

## Design tokens — reference, never hardcode
All values live as `--login-*` custom properties in `src/styles/main.css` (global via
`main.ts:5`). Use `var(--login-accent)` etc. See DESIGN-SYSTEM.md for the full table.

```vue
<script setup lang="ts">
import { AlertCircle } from 'lucide-vue-next'   // icons: lucide only, never heroicons in new code
defineProps<{ error?: string }>()
</script>

<template>
  <div class="card">
    <label class="field-label" for="stand">Stand number</label>
    <input id="stand" class="field-input" type="text" />
    <p v-if="error" class="field-error"><AlertCircle :size="16" /> {{ error }}</p>
  </div>
</template>

<style scoped>
.card        { background: var(--login-surface); border-radius: var(--login-card-radius);
               box-shadow: var(--login-card-shadow); padding: 40px; }
.field-label { display:block; margin-bottom:8px; font-size:14px; font-weight:500; color:var(--login-label); }
.field-input { width:100%; padding:12px 16px; border:2px solid var(--login-input-border);
               border-radius: var(--login-control-radius); transition: var(--login-motion); }
.field-input:focus { outline:none; border-color:var(--login-accent);
               box-shadow:0 0 0 3px var(--login-accent-ring); }
.field-error { display:flex; align-items:center; gap:8px;
               background:var(--login-error-bg); color:var(--login-error-fg);
               padding:12px 16px; border-radius: var(--login-control-radius); }
</style>
```

## Reject-gate (frontend)
Reject: inaccessible UI (fails WCAG 2.1 AA / no visible focus / input without `<label for>` /
icon-only button without `aria-label`); a duplicate of an existing component; a hardcoded
color/radius/shadow instead of a token; missing loading, empty, or error state; motion that
ignores `prefers-reduced-motion`.

Return `confidence: NN% — reason`. Delete the styles/components your change obsoletes.
