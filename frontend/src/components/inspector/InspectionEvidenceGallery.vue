<script setup lang="ts">
// Inspection evidence gallery — photos linked to an inspection, not a file dump.
import { computed } from 'vue'
import { Camera, MapPin, Clock } from 'lucide-vue-next'
import type { StageInspectionPhoto } from '@/services/developmentManagementService'
import type { InspectionPhoto } from '@/services/inspectionsService'

const props = defineProps<{
  photos: Array<StageInspectionPhoto | InspectionPhoto>
  emptyMessage?: string
}>()

const emit = defineEmits<{ select: [id: string] }>()

type Row = {
  id: string
  src: string
  caption: string
  takenAt: string | null
  lat: number | null
  lng: number | null
}

const rows = computed<Row[]>(() => props.photos.map((p) => {
  const anyP = p as unknown as Record<string, unknown>
  return {
    id: p.id,
    src: String(anyP.storage_url || anyP.storageUrl || ''),
    caption: String(anyP.caption ?? 'Inspection photograph'),
    takenAt: (anyP.taken_at ?? anyP.takenAt ?? anyP.created_at ?? anyP.createdAt ?? null) as string | null,
    lat: (anyP.taken_lat ?? anyP.takenLat ?? null) as number | null,
    lng: (anyP.taken_lng ?? anyP.takenLng ?? null) as number | null,
  }
}))

function fmt(iso: string | null) {
  if (!iso) return 'Time not recorded'
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function coords(lat: number | null, lng: number | null) {
  if (lat == null || lng == null) return 'GPS not captured'
  return `${lat.toFixed(5)}, ${lng.toFixed(5)} · GPS observation`
}
</script>

<template>
  <div class="ieg">
    <div v-if="!rows.length" class="ieg-empty">
      <Camera :size="18" aria-hidden="true" />
      <p>{{ emptyMessage || 'No inspection evidence has been captured.' }}</p>
    </div>
    <ul v-else class="ieg-grid" aria-label="Inspection evidence">
      <li v-for="p in rows" :key="p.id">
        <button type="button" class="ieg-card" @click="emit('select', p.id)">
          <img v-if="p.src" :src="p.src" :alt="p.caption" />
          <div v-else class="ieg-ph"><Camera :size="16" /></div>
          <div class="ieg-meta">
            <strong>{{ p.caption }}</strong>
            <span><Clock :size="11" aria-hidden="true" /> {{ fmt(p.takenAt) }}</span>
            <span><MapPin :size="11" aria-hidden="true" /> {{ coords(p.lat, p.lng) }}</span>
          </div>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ieg-empty {
  display:flex; flex-direction:column; align-items:center; gap:var(--ent-s2);
  padding:var(--ent-s6); color:var(--ent-text-3); font-size:var(--ent-fs-sm); text-align:center;
}
.ieg-grid {
  list-style:none; margin:0; padding:0;
  display:grid; grid-template-columns:repeat(auto-fill, minmax(11rem, 1fr)); gap:var(--ent-s3);
}
.ieg-card {
  display:flex; flex-direction:column; width:100%; text-align:left;
  border:1px solid var(--ent-line); border-radius:var(--ent-r-sm);
  background:var(--ent-surface); cursor:pointer; overflow:hidden; padding:0;
  color:inherit; font:inherit;
}
.ieg-card:hover { border-color:var(--ent-accent); }
.ieg-card:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.ieg-card img, .ieg-ph {
  width:100%; height:8rem; object-fit:cover; background:var(--ent-surface-2); display:block;
}
.ieg-ph { display:flex; align-items:center; justify-content:center; color:var(--ent-text-3); }
.ieg-meta { display:flex; flex-direction:column; gap:0.15rem; padding:var(--ent-s2) var(--ent-s3); }
.ieg-meta strong { font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.ieg-meta span { display:inline-flex; align-items:center; gap:0.25rem; font-size:var(--ent-fs-micro); color:var(--ent-text-3); }
</style>
