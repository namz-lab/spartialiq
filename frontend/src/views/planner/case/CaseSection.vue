<script setup lang="ts">
// Case workspace — Section. THE container for every block of the planner case
// workspace (intake, due diligence, zoning, survey, notices). One header
// grammar: optional stage number, icon, title, subtitle, status, actions.
//
// Deliberately NOT a nested card by default: sections are hairline-separated
// bands inside a panel, so eight of them read as one workspace rather than
// eight floating cards. Pass `boxed` when the section IS the outermost surface.
// Presentation only — consumes --ent-* (src/styles/enterprise.css).
withDefaults(defineProps<{
  title: string
  subtitle?: string
  /** Two-digit stage marker, e.g. "01". Statutory sequence, not decoration. */
  step?: string
  /** Render as its own bordered surface instead of a band in a parent panel. */
  boxed?: boolean
  /** Remove body padding so a table can sit edge-to-edge. */
  flush?: boolean
}>(), { boxed: false, flush: false })
</script>

<template>
  <section class="cs" :class="{ boxed }">
    <header class="cs-head">
      <span v-if="step" class="cs-step" aria-hidden="true">{{ step }}</span>
      <span v-if="$slots.icon" class="cs-icon"><slot name="icon" /></span>
      <div class="cs-titles">
        <h3 class="cs-title">{{ title }}</h3>
        <p v-if="subtitle" class="cs-sub">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.status" class="cs-status"><slot name="status" /></div>
      <div v-if="$slots.actions" class="cs-actions"><slot name="actions" /></div>
    </header>
    <div class="cs-body" :class="{ flush }"><slot /></div>
    <footer v-if="$slots.footer" class="cs-foot"><slot name="footer" /></footer>
  </section>
</template>

<style scoped>
.cs { display: flex; flex-direction: column; min-width: 0; background: var(--ent-surface); }
.cs.boxed { border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); }

.cs-head {
  display: flex; align-items: center; gap: var(--ent-s2);
  padding: var(--ent-s2) var(--ent-s4);
  min-height: 38px;
  border-bottom: 1px solid var(--ent-line);
  background: var(--ent-surface-2);
}
.cs.boxed > .cs-head { border-radius: var(--ent-r-md) var(--ent-r-md) 0 0; }

.cs-step {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 18px; padding: 0 4px; flex-shrink: 0;
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm);
  background: var(--ent-surface);
  font-family: var(--ent-font-mono); font-size: 10px;
  font-weight: var(--ent-fw-bold); font-variant-numeric: tabular-nums;
  color: var(--ent-text-2);
}
.cs-icon { display: inline-flex; color: var(--ent-text-3); flex-shrink: 0; }
.cs-titles { min-width: 0; flex: 1 1 auto; }
.cs-title {
  margin: 0; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-bold);
  color: var(--ent-text); line-height: var(--ent-lh-tight);
}
.cs-sub {
  margin: 0; font-size: var(--ent-fs-micro); color: var(--ent-text-3);
  line-height: var(--ent-lh-tight);
}
.cs-status, .cs-actions { display: inline-flex; align-items: center; gap: var(--ent-s2); flex-shrink: 0; }
.cs-actions { margin-left: var(--ent-s1); }

.cs-body { padding: var(--ent-s3) var(--ent-s4); min-width: 0; }
.cs-body.flush { padding: 0; }
.cs-foot {
  padding: var(--ent-s2) var(--ent-s4);
  border-top: 1px solid var(--ent-line);
  background: var(--ent-surface-2);
}
.cs.boxed > .cs-foot { border-radius: 0 0 var(--ent-r-md) var(--ent-r-md); }
</style>
