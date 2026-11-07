<script setup lang="ts">
// Layer tree: grouped as the brief lists them, each layer with visibility,
// opacity, order, a legend swatch and its custodian. The accuracy filter
// applies to every GMS layer at once.
import { computed } from 'vue'
import { ChevronUp, ChevronDown } from 'lucide-vue-next'
import { custodianColour } from '@/map/gmsStyle'
import type { AccuracyClass, LayerGroup } from '@/services/gms'

export interface TreeLayer {
  id: string
  title: string
  grp: LayerGroup
  geom: 'Point' | 'LineString' | 'Polygon'
  custodian: string
  count: number | null
  visible: boolean
  opacity: number
}

const props = defineProps<{ layers: TreeLayer[]; accuracy: AccuracyClass[] }>()
const emit = defineEmits<{
  toggle: [id: string]
  opacity: [id: string, value: number]
  move: [id: string, dir: -1 | 1]
  accuracy: [cls: AccuracyClass]
}>()

const GROUPS: LayerGroup[] = ['Administrative', 'Land & Cadastre', 'Planning', 'Revenue', 'Infrastructure', 'Social', 'Environment', 'Imagery']
const groups = computed(() => GROUPS
  .map((g) => ({ g, items: props.layers.filter((l) => l.grp === g) }))
  .filter((x) => x.items.length))
const CLASSES: AccuracyClass[] = ['A', 'B', 'C', 'D']
</script>

<template>
  <div class="lt">
    <fieldset class="lt-acc">
      <legend>Accuracy class</legend>
      <label v-for="c in CLASSES" :key="c" class="lt-chip" :class="{ on: accuracy.includes(c) }">
        <input type="checkbox" :checked="accuracy.includes(c)" @change="emit('accuracy', c)" />{{ c }}
      </label>
    </fieldset>

    <section v-for="{ g, items } in groups" :key="g" class="lt-group" :aria-label="g">
      <h3 class="lt-h">{{ g }}</h3>
      <ul class="lt-list">
        <li v-for="l in items" :key="l.id" class="lt-item">
          <div class="lt-row">
            <label class="lt-name">
              <input type="checkbox" :checked="l.visible" @change="emit('toggle', l.id)" />
              <span class="lt-swatch" :class="`lt-${l.geom}`" :style="{ '--c': custodianColour(l.custodian) }" aria-hidden="true" />
              <span class="lt-title">{{ l.title }}</span>
            </label>
            <span v-if="l.count != null" class="lt-count">{{ l.count }}</span>
            <button type="button" class="lt-mv" :aria-label="`Move ${l.title} up`" @click="emit('move', l.id, 1)"><ChevronUp :size="12" /></button>
            <button type="button" class="lt-mv" :aria-label="`Move ${l.title} down`" @click="emit('move', l.id, -1)"><ChevronDown :size="12" /></button>
          </div>
          <div v-if="l.visible" class="lt-sub">
            <span class="lt-badge" :style="{ '--c': custodianColour(l.custodian) }">{{ l.custodian }}</span>
            <label class="lt-op">
              <span class="ent-sr-only">Opacity of {{ l.title }}</span>
              <input type="range" min="0.1" max="1" step="0.1" :value="l.opacity"
                     @input="emit('opacity', l.id, Number(($event.target as HTMLInputElement).value))" />
            </label>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.lt { display:flex; flex-direction:column; gap:var(--ent-s3); font-size:var(--ent-fs-sm); }
.lt-acc { display:flex; gap:var(--ent-s1); align-items:center; flex-wrap:wrap; margin:0; padding:0; border:0; }
.lt-acc legend { float:left; margin-right:var(--ent-s2); font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.lt-chip { display:inline-flex; align-items:center; justify-content:center; min-width:28px; height:24px; cursor:pointer;
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r-pill); font-family:var(--ent-font-mono);
  font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.lt-chip.on { background:var(--ent-accent-soft); border-color:var(--ent-accent-line); color:var(--ent-accent); }
.lt-chip input { position:absolute; opacity:0; width:1px; height:1px; }
.lt-chip:focus-within { box-shadow:var(--ent-focus-ring); }
.lt-h { margin:0 0 var(--ent-s1); font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  text-transform:uppercase; letter-spacing:0.04em; color:var(--ent-text-3); }
.lt-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; }
.lt-row { display:flex; align-items:center; gap:var(--ent-s1); }
.lt-name { flex:1; min-width:0; display:flex; align-items:center; gap:var(--ent-s2); cursor:pointer; }
.lt-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.lt-count { font-family:var(--ent-font-mono); font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.lt-mv { display:inline-flex; padding:2px; background:none; border:0; color:var(--ent-text-3); cursor:pointer; border-radius:var(--ent-r-sm); }
.lt-mv:hover { color:var(--ent-text); background:var(--ent-surface-2); }
.lt-mv:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.lt-swatch { width:14px; height:14px; flex-shrink:0; }
.lt-Point { border-radius:50%; background:var(--c); border:2px solid var(--ent-surface); box-shadow:0 0 0 1px var(--c); width:10px; height:10px; }
.lt-LineString { height:3px; background:var(--c); border-radius:2px; }
.lt-Polygon { background:color-mix(in srgb, var(--c) 20%, transparent); border:1.5px solid var(--c); border-radius:2px; }
.lt-sub { display:flex; align-items:center; gap:var(--ent-s2); padding:2px 0 var(--ent-s1) 1.6rem; }
.lt-badge { font-size:var(--ent-fs-micro); padding:0 var(--ent-s2); border-radius:var(--ent-r-pill);
  color:var(--c); border:1px solid color-mix(in srgb, var(--c) 45%, transparent); white-space:nowrap; }
.lt-op { flex:1; display:flex; }
.lt-op input { width:100%; accent-color:var(--ent-accent); }
</style>
