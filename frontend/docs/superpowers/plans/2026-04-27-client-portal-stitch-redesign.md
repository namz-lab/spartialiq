# Client Portal Stitch Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the citizen portal and connected application/payment pages to match the Stitch export while preserving current functionality.

**Architecture:** Use the current Vue single-file components and add a shared visual token layer in global CSS. Apply scoped CSS overrides per view rather than replacing working templates with static Stitch HTML.

**Tech Stack:** Vue 3, TypeScript, Vite, scoped CSS, lucide-vue-next, existing Pinia/router/API services.

---

### Task 1: Global Stitch Tokens

**Files:**
- Modify: `src/styles/main.css`

- [ ] Add Public Sans import and Stitch color/radius/elevation variables.
- [ ] Update the base font family to Public Sans.
- [ ] Keep existing generic `.btn`, `.card`, and form helpers compatible by mapping them to the new tokens.

### Task 2: Portal Dashboard Restyle

**Files:**
- Modify: `src/views/ViewerPortalView.vue`

- [ ] Restyle the portal shell, sidebar, page headers, service cards, application cards, journey cards, report forms, land-use accordions, notices, modals, and toast using Stitch tokens.
- [ ] Keep all existing template bindings, service data, report submission, and navigation behavior.

### Task 3: Application Hub Restyle

**Files:**
- Modify: `src/views/OnlineApplicationsView.vue`

- [ ] Align the `/apply` hub with the Stitch Service Catalogue screen: white top shell, Oxford Blue headings, search/catalogue card rhythm, restrained shadows, and consistent pill badges.
- [ ] Keep current service grouping and local application counts.

### Task 4: Application Form Restyle

**Files:**
- Modify: `src/views/OnlineApplicationFormView.vue`

- [ ] Align the multi-step form with the Stitch Application Flow screen: breadcrumb-style header, clean progress tracker, white form card, accessible inputs, document upload states, and review panels.
- [ ] Preserve current validation, document verification, localStorage submission, and success routing.

### Task 5: Payment/Receipt Restyle

**Files:**
- Modify: `src/views/PaymentGatewayView.vue`
- Modify: `src/views/PaymentReceiptView.vue`

- [ ] Replace the dark/gold payment styling with the Stitch civic portal palette.
- [ ] Preserve payment status loading, method selection, polling, offline fallback, receipt loading, and print behavior.

### Task 6: Verification

**Files:**
- No source edits unless verification reveals a bug.

- [ ] Run `npm run type-check`.
- [ ] Run `npm run build`.
- [ ] Start `npm run dev` and provide the local URL if the build succeeds.
