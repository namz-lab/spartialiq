<script setup lang="ts">
// Desktop-style right-click menu for the map. Driven by the basemap's
// 'feature-contextmenu' event: the host passes the screen point + the hit layer,
// and this popover offers context actions (chiefly "Subdivide this land").
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LayoutGrid, MousePointerSquareDashed, Info } from 'lucide-vue-next'

interface MenuItem { key: string; label: string; icon: any; primary?: boolean }

const props = defineProps<{
  open: boolean
  x: number
  y: number
  /** layer id of the right-clicked feature (e.g. 'vungu_farm_cadastre') */
  layer: string
  /** label shown as the menu header (parcel name / layer) */
  title?: string
  /** whether an identifiable feature was hit (a tile fid is present) */
  hasFeature: boolean
}>()
const emit = defineEmits<{ (e: 'action', key: string): void; (e: 'close'): void }>()

// Layers that represent a piece of land you can subdivide.
const LAND_LAYERS = new Set(['vungu_farm_cadastre', 'vungu_parcels', 'landuse'])
const isLand = computed(() => LAND_LAYERS.has(props.layer))

const items = computed<MenuItem[]>(() => {
  if (isLand.value && props.hasFeature) {
    return [
      { key: 'subdivide', label: 'Subdivide this land', icon: LayoutGrid, primary: true },
      { key: 'set-area', label: 'Set as planning area', icon: MousePointerSquareDashed },
      { key: 'details', label: 'View details', icon: Info },
    ]
  }
  return [{ key: 'details', label: 'View details', icon: Info }]
})

const root = ref<HTMLElement | null>(null)
function onItem(key: string) { emit('action', key); emit('close') }
function onOutside(ev: MouseEvent) {
  if (root.value && !root.value.contains(ev.target as Node)) emit('close')
}
function onKey(ev: KeyboardEvent) { if (ev.key === 'Escape') emit('close') }

watch(() => props.open, (o) => {
  if (o) {
    // defer so the opening right-click doesn't immediately close it
    setTimeout(() => document.addEventListener('mousedown', onOutside), 0)
    document.addEventListener('keydown', onKey)
  } else {
    document.removeEventListener('mousedown', onOutside)
    document.removeEventListener('keydown', onKey)
  }
})
onMounted(() => { if (props.open) document.addEventListener('keydown', onKey) })
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onOutside)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div
    v-if="open"
    ref="root"
    class="mcm"
    :style="{ left: x + 'px', top: y + 'px' }"
    role="menu"
  >
    <div v-if="title" class="mcm-head">{{ title }}</div>
    <button
      v-for="it in items"
      :key="it.key"
      class="mcm-item"
      :class="{ primary: it.primary }"
      role="menuitem"
      @click="onItem(it.key)"
    >
      <component :is="it.icon" :size="15" />
      <span>{{ it.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.mcm {
  position: absolute;
  z-index: 50;
  min-width: 190px;
  padding: 4px;
  background: #ffffff;
  border: 1px solid #e3e6ea;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
  font-size: 13px;
  color: #1f2933;
}
.mcm-head {
  padding: 6px 8px 7px;
  margin-bottom: 2px;
  font-size: 11px;
  font-weight: 600;
  color: #65727f;
  border-bottom: 1px solid #eef1f4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}
.mcm-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.mcm-item:hover { background: #f1f5f9; }
.mcm-item.primary { color: #1a73e8; font-weight: 600; }
.mcm-item.primary:hover { background: #e8f0fe; }
</style>
