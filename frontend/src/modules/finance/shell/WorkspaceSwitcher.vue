<script setup lang="ts">
/**
 * Moving between the finance workspaces a person holds.
 *
 * Lists the workspaces the SERVER granted (`identity.workspaces`) that exist in this build, in
 * catalogue order. A revenue officer who is also the relief cashier sees both; a cashier with only
 * the till sees no switcher at all, because a control with one option is noise.
 *
 * While the migration lasts it also offers the previous console (spec §13.7), so nothing a person
 * could do before is out of reach while their part of the new system is still being built.
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { ArrowLeftRight, Check } from 'lucide-vue-next'
import { useFinanceStore } from '../stores/finance'
import { builtWorkspaces, WORKSPACE_META, type WorkspaceKey } from './workspaces'
import { CONSOLE_PATH } from './workspaceGuard'

const props = withDefaults(defineProps<{ current: WorkspaceKey; showConsole?: boolean }>(), {
  showConsole: true,
})

const store = useFinanceStore()
const open = ref(false)
const button = ref<HTMLButtonElement | null>(null)
const root = ref<HTMLElement | null>(null)
const uid = `wsw-${Math.random().toString(36).slice(2, 9)}`

const options = computed(() => {
  const held = new Set(store.identity?.workspaces ?? [])
  return builtWorkspaces().filter((k) => held.has(k)).map((key) => ({ key, ...WORKSPACE_META[key] }))
})

const shown = computed(() => options.value.length > 1 || props.showConsole)

function close(returnFocus: boolean): void {
  open.value = false
  document.removeEventListener('pointerdown', onOutside)
  if (returnFocus) void nextTick(() => button.value?.focus())
}

function onOutside(event: PointerEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) close(false)
}

function toggle(): void {
  if (open.value) { close(false); return }
  open.value = true
  document.addEventListener('pointerdown', onOutside)
}

onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside))
</script>

<template>
  <div v-if="shown" ref="root" class="wsw">
    <button ref="button" type="button" class="wsw-button" :aria-expanded="open" :aria-controls="uid"
            @click="toggle">
      <ArrowLeftRight :size="15" aria-hidden="true" />
      <span>Switch workspace</span>
    </button>
    <ul v-if="open" :id="uid" class="wsw-menu" aria-label="Your finance workspaces"
        @keydown.escape.stop="close(true)">
      <li v-for="o in options" :key="o.key">
        <RouterLink :to="o.path" class="wsw-item" :aria-current="o.key === current ? 'page' : undefined"
                    @click="close(false)">
          <Check v-if="o.key === current" :size="14" aria-hidden="true" class="wsw-check" />
          <span>{{ o.name }}</span>
        </RouterLink>
      </li>
      <li v-if="showConsole" class="wsw-console">
        <RouterLink :to="CONSOLE_PATH" class="wsw-item" @click="close(false)">
          <span>Previous finance console</span>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.wsw { position: relative; }
.wsw-button {
  display: inline-flex; align-items: center; gap: var(--ent-s2);
  min-height: var(--ent-control-h); padding: 0 var(--ent-control-px);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-sm);
  background: var(--ent-surface); color: var(--ent-text); font: inherit; font-size: var(--ent-fs-sm);
  cursor: pointer;
}
.wsw-button:hover { background: var(--ent-surface-2); }
.wsw-button:focus-visible { outline: var(--ent-focus-ring); outline-offset: 2px; }
.wsw-menu {
  position: absolute; right: 0; top: calc(100% + var(--ent-s1)); z-index: var(--ent-z-popover);
  min-width: 16rem; margin: 0; padding: var(--ent-s1); list-style: none;
  background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md);
  box-shadow: var(--ent-e2);
}
.wsw-item {
  display: flex; align-items: center; gap: var(--ent-s2);
  padding: var(--ent-s2) var(--ent-s3) var(--ent-s2) calc(var(--ent-s3) + 14px + var(--ent-s2));
  border-radius: var(--ent-r-sm); color: var(--ent-text); text-decoration: none; font-size: var(--ent-fs-sm);
}
.wsw-item[aria-current='page'] { padding-left: var(--ent-s3); font-weight: var(--ent-fw-semibold); }
.wsw-item:hover { background: var(--ent-surface-2); }
.wsw-item:focus-visible { outline: var(--ent-focus-ring); outline-offset: -2px; }
.wsw-check { color: var(--ent-accent); }
.wsw-console { margin-top: var(--ent-s1); padding-top: var(--ent-s1); border-top: 1px solid var(--ent-line); }
.wsw-console .wsw-item { color: var(--ent-text-2); }
</style>
