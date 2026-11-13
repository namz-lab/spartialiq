<script setup lang="ts">
/**
 * One sentence explaining why the person was redirected (`?notice=`, set by workspaceGuard.ts).
 *
 * Used by the workspace frame and by the previous console, which is where most people are
 * redirected while the migration lasts. A redirect without a reason reads as a fault.
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { X } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()

const SENTENCES: Record<string, string> = {
  'not-yours': 'That workspace is not one of yours. You have been returned to your own work.',
  'not-built': 'That workspace is not available yet.',
  unavailable: 'The page in that link is not part of your finance workspaces.',
}

const sentence = computed(() => {
  const key = route.query.notice
  return typeof key === 'string' ? SENTENCES[key] ?? null : null
})

function dismiss(): void {
  const { notice: _dropped, ...rest } = route.query
  void router.replace({ query: rest })
}
</script>

<template>
  <p v-if="sentence" class="wsn" role="status">
    <span>{{ sentence }}</span>
    <button type="button" class="wsn-close" @click="dismiss">
      <X :size="14" aria-hidden="true" /><span class="wsn-sr">Dismiss</span>
    </button>
  </p>
</template>

<style scoped>
.wsn {
  display: flex; align-items: center; justify-content: space-between; gap: var(--ent-s3); margin: 0;
  padding: var(--ent-s2) var(--ent-s3); border: 1px solid var(--ent-tone-info-line); border-radius: var(--ent-r-sm);
  background: var(--ent-tone-info-bg); color: var(--ent-tone-info-fg); font-size: var(--ent-fs-sm);
}
.wsn-close { display: inline-grid; place-items: center; min-width: var(--ent-touch-min); min-height: 32px; border: 0; background: none; color: inherit; cursor: pointer; border-radius: var(--ent-r-sm); }
.wsn-close:focus-visible { outline: var(--ent-focus-ring); }
.wsn-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
