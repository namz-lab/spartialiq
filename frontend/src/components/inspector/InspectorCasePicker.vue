<script setup lang="ts">
/**
 * The one permit picker for the Building Inspector console.
 *
 * Pre-construction, Inspections, Certificates and Plan examination each carried
 * their own copy of this list, and each copy held its own idea of "selected".
 * This one has no selection state at all: it reads and writes the shared
 * inspection case, so opening a permit here opens it on the map, in the case
 * header and in every other section at once.
 *
 * A failed load is shown as a failure with a retry, never as "no permits".
 */
import { computed, onMounted, ref, watch } from 'vue'
import { Search, RefreshCw, AlertTriangle, ChevronRight } from 'lucide-vue-next'
import { dmApi, type PermitApplication } from '@/services/developmentManagementService'
import { isPermitApproved, normalizeStatus } from '@/composables/useApplicationPipeline'
import { useInspectionCase } from '@/composables/useInspectionCase'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'

const props = withDefaults(defineProps<{
  /** approved: permits that can be built on. reviewable: also those still under review (plan examination). */
  scope?: 'approved' | 'reviewable'
  heading?: string
  emptyMessage?: string
}>(), {
  scope: 'approved',
  heading: 'Permits',
  emptyMessage: 'No approved permits. Building work can only be inspected once a permit is approved.',
})

const emit = defineEmits<{ opened: [permit: PermitApplication] }>()

const ic = useInspectionCase()

const permits = ref<PermitApplication[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const opening = ref<string | null>(null)

function inScope(p: PermitApplication): boolean {
  if (isPermitApproved(p.status)) return true
  return props.scope === 'reviewable' && normalizeStatus(p.status) === 'under_review'
}

let seq = 0
async function load() {
  const mine = ++seq
  loading.value = true
  error.value = null
  try {
    const r = await dmApi.listPermits({ limit: 200, offset: 0, search: search.value.trim() || undefined })
    if (mine !== seq) return
    permits.value = r.data.filter(inScope)
  } catch (err: unknown) {
    if (mine !== seq) return
    error.value = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      || 'The permit register could not be loaded.'
  } finally {
    if (mine === seq) loading.value = false
  }
}
onMounted(load)

let timer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(load, 300)
})

const activeId = computed(() => ic.current.value?.permitId ?? null)

async function open(p: PermitApplication) {
  if (opening.value) return
  opening.value = p.id
  try {
    await ic.loadPermit(p.id)
    emit('opened', p)
  } finally {
    opening.value = null
  }
}

function ref_(p: PermitApplication) {
  return p.dev_register_no || p.tpd_reference || p.id.slice(0, 8).toUpperCase()
}

defineExpose({ reload: load })
</script>

<template>
  <section class="icp ins-card" :aria-label="heading">
    <header class="icp-head">
      <label class="ins-search">
        <Search :size="15" aria-hidden="true" />
        <span class="ent-sr-only">Search permits</span>
        <input v-model="search" type="search" placeholder="Register no, stand, applicant" autocomplete="off" />
      </label>
      <button type="button" class="ins-iconbtn" :disabled="loading" @click="load">
        <RefreshCw :size="14" :class="{ 'ins-spin': loading }" aria-hidden="true" />
        <span class="ent-sr-only">Reload permits</span>
      </button>
    </header>

    <div v-if="error" class="icp-state" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <p>{{ error }}</p>
      <button type="button" class="icp-retry" @click="load">Try again</button>
    </div>

    <ul v-else-if="loading && !permits.length" class="icp-list" aria-busy="true">
      <li v-for="n in 5" :key="n" class="icp-skel">
        <span class="ins-skel" style="width: 45%" />
        <span class="ins-skel" style="width: 75%; height: 11px" />
      </li>
    </ul>

    <p v-else-if="!permits.length" class="icp-empty">
      {{ search ? `No permits match “${search}”.` : emptyMessage }}
    </p>

    <ul v-else class="icp-list">
      <li v-for="p in permits" :key="p.id">
        <button
          type="button" class="icp-item"
          :class="{ active: activeId === p.id }"
          :aria-current="activeId === p.id ? 'true' : undefined"
          :aria-busy="opening === p.id"
          @click="open(p)">
          <span class="icp-line">
            <span class="icp-ref">{{ ref_(p) }}</span>
            <UiStatusBadge v-if="scope === 'reviewable'" :status="p.status" />
            <slot name="badge" :permit="p" />
          </span>
          <span class="icp-name">{{ p.applicant_name }}</span>
          <span class="icp-meta">Stand {{ p.stand_number }}<template v-if="p.suburb_ward"> · {{ p.suburb_ward }}</template></span>
          <ChevronRight :size="14" class="icp-chev" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.icp { display: flex; flex-direction: column; max-height: calc(100vh - 12rem); overflow: hidden; }
.icp-head { display: flex; gap: var(--ent-s2); padding: var(--ent-s3); border-bottom: 1px solid var(--ent-line); }
.icp-head .ins-search { flex: 1; }
.icp-list { list-style: none; margin: 0; padding: var(--ent-s1); overflow-y: auto; flex: 1; }
.icp-item {
  position: relative; display: flex; flex-direction: column; gap: 2px; width: 100%;
  padding: var(--ent-s2) var(--ent-s7) var(--ent-s2) var(--ent-s3);
  text-align: left; font-family: var(--ent-font); color: var(--ent-text);
  background: transparent; border: 1px solid transparent; border-radius: var(--ent-r);
  cursor: pointer; transition: background-color var(--ent-dur) var(--ent-ease), border-color var(--ent-dur) var(--ent-ease);
}
.icp-item:hover { background: var(--ent-surface-2); }
.icp-item:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.icp-item.active { background: var(--ent-accent-soft); border-color: var(--ent-accent-line); }
.icp-item[aria-busy='true'] { opacity: 0.6; }
.icp-line { display: flex; align-items: center; gap: var(--ent-s2); }
.icp-ref { font-family: var(--ent-font-mono); font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); }
.icp-item.active .icp-ref { color: var(--ent-accent); }
.icp-name { font-size: var(--ent-fs-sm); color: var(--ent-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icp-meta { font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
.icp-chev { position: absolute; right: var(--ent-s3); top: 50%; transform: translateY(-50%); color: var(--ent-text-3); transition: transform var(--ent-dur) var(--ent-ease); }
.icp-item:hover .icp-chev { transform: translate(2px, -50%); }
.icp-skel { display: flex; flex-direction: column; gap: 6px; padding: var(--ent-s3); }
.icp-empty { margin: 0; padding: var(--ent-s6) var(--ent-s4); text-align: center; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.icp-state { display: flex; flex-direction: column; align-items: center; gap: var(--ent-s2); padding: var(--ent-s5) var(--ent-s4); text-align: center; color: var(--ent-danger); }
.icp-state p { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.icp-retry { font-family: var(--ent-font); font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-accent); background: none; border: 0; cursor: pointer; text-decoration: underline; }

@media (max-width: 1023px) { .icp { max-height: 18rem; } }
@media (prefers-reduced-motion: reduce) { .icp-chev { transition: none; } }
</style>
