<script setup lang="ts">
/**
 * What to render when this person does not hold the permission a surface needs.
 *
 * It explains rather than hides. A budget officer who opens the publication queue should learn
 * that approving and publishing are separate duties held by other roles — not find a blank page
 * and wonder whether the system is broken.
 *
 * This is presentation only. The backend refuses the request regardless of what is rendered here,
 * and the acceptance suite asserts that the refusal is recorded in the audit trail.
 */
import { computed } from 'vue'
import { useFinanceStore } from '../stores/finance'
import { ShieldAlert } from 'lucide-vue-next'

const props = defineProps<{
  /** Any one of these is enough to see the surface. */
  requires: string | string[]
  /** What the person was trying to reach, for the sentence. */
  surface?: string
}>()

const store = useFinanceStore()
const codes = computed(() => (Array.isArray(props.requires) ? props.requires : [props.requires]))
const allowed = computed(() => store.canAny(...codes.value))
const explanation = computed(() => store.whyUnavailable(codes.value[0]))
</script>

<template>
  <slot v-if="allowed" />
  <div v-else class="fin-empty" role="status">
    <strong>
      <ShieldAlert :size="16" aria-hidden="true" />
      {{ surface ? `${surface} is not open to your role.` : 'This is not open to your role.' }}
    </strong>
    <p>{{ explanation }}</p>
    <p>
      Your role is <strong>{{ store.identity?.role ?? 'unknown' }}</strong>. Finance roles are
      assigned by a system administrator, and the permission each one carries is listed under
      Permissions.
    </p>
  </div>
</template>

<style scoped>
.fin-empty strong { display: inline-flex; align-items: center; gap: var(--ent-s2); }
</style>
