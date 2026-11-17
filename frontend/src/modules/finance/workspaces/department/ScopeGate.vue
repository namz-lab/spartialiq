<script setup lang="ts">
/**
 * Department Finance's guard on every page that reads budget data.
 *
 * The server confines a departmentally scoped person to their own votes on every read. A head of
 * department with NO department recorded is not scoped, so those same reads would answer for the
 * whole council. This gate stops that in the workspace: without a recorded department the page says
 * no votes are assigned and makes no request at all (spec §12: "says no votes are assigned rather
 * than showing the whole council"). The scope comes from the server (`/api/finance/me`).
 */
import { computed } from 'vue'
import { Info } from 'lucide-vue-next'
import { useRoute } from 'vue-router'
import { useFinanceStore } from '../../stores/finance'

const store = useFinanceStore()
const scoped = computed(() => store.isScoped)
const route = useRoute()
</script>

<template>
  <slot v-if="scoped" />
  <template v-else>
  <section class="cw-pagehead"><div class="cw-pagehead-text"><h2>{{ route.meta.cwTitle }}</h2></div></section>
  <div class="cw-banner-msg cw-banner-msg--warn sg-none" role="status">
    <Info :size="18" aria-hidden="true" />
    <span>No department is recorded against your account yet, so there are no votes to show. The finance administrator records which department you head; until then this workspace shows nothing rather than the whole council.</span>
  </div>
  </template>
</template>
