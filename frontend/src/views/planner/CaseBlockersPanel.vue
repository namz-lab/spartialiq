<script setup lang="ts">
import type { CaseBlocker } from '@/views/planner/caseBlockers'

defineProps<{
  blockers: CaseBlocker[]
  nextAction: string
}>()
</script>

<template>
  <section class="cb" aria-label="Application blockers">
    <h3>Application blockers</h3>
    <ul v-if="blockers.length" class="cb-list">
      <li v-for="b in blockers" :key="b.id" class="cb-item" :class="b.severity">
        <span class="cb-mark" aria-hidden="true" />
        <span>{{ b.label }}</span>
      </li>
    </ul>
    <p v-else class="cb-empty">No blockers recorded on this case yet.</p>
    <div class="cb-next">
      <span class="cb-next-label">Next best action</span>
      <p>{{ nextAction }}</p>
    </div>
  </section>
</template>

<style scoped>
.cb { display: flex; flex-direction: column; gap: var(--ent-s2); }
.cb h3 {
  margin: 0; font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.07em; text-transform: uppercase; color: var(--ent-text-3);
}
.cb-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.cb-item { display: flex; align-items: flex-start; gap: var(--ent-s2); font-size: var(--ent-fs-sm); color: var(--ent-text); }
.cb-mark {
  width: 8px; height: 8px; margin-top: 6px; border-radius: var(--ent-r-pill); flex-shrink: 0;
  background: var(--ent-text-3);
}
.cb-item.blocking .cb-mark { background: var(--ent-danger); }
.cb-item.warning .cb-mark { background: var(--ent-warning); }
.cb-item.clear .cb-mark { background: var(--ent-success); }
.cb-empty { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.cb-next {
  margin-top: var(--ent-s2); padding: var(--ent-s3);
  background: var(--ent-accent-soft); border: 1px solid var(--ent-accent-line);
  border-radius: var(--ent-r);
}
.cb-next-label {
  display: block; font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--ent-text-3);
}
.cb-next p { margin: 4px 0 0; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
</style>
