<script setup lang="ts">
// Two-pane role workspace chrome: a spatial map pane and a sections console,
// switched by a tab and kept alive so neither loses state.
//
// Generalises the shape PlannerShell.vue already proved for the planner. It
// exists because three roles — EO planner, environmental officer, building
// inspector — each had BOTH halves built, but the router could only serve one:
// the newer section consoles dropped the per-role map, so the routes were
// pointed back at the older map views and ~7,000 LOC of sections became
// unreachable (audit F17). Hosting both panes is what makes the revert
// unnecessary.
//
// The shell owns exactly the chrome that was duplicated in every pane: brand,
// pane switch, and the profile menu. Each pane keeps its own working controls
// (search, map tools, section rail) and hides only its redundant chrome via
// its own `embedded` prop.
//
// RESPONSIVE STRUCTURE (Phase 5)
// One bar at every width; what changes is how much of it is spelled out. At
// ≤767px the subtitle and the pane-switch labels reduce to icons, because a
// 375px bar has to hold a brand mark, a title, a two-way switch and the
// profile menu, and the switch is the control an officer actually touches.
// The labels survive as sr-only text, so nothing is lost to assistive
// technology.
//
// The switch deliberately stays in the TOP bar rather than becoming a bottom
// bar: each console pane in the #console slot already owns a bottom
// navigation for its own sections, and two stacked bottom bars would be both
// ambiguous and 112px of chrome on a 667px-tall screen.
import { computed, ref, watch, nextTick, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useBreakpoint } from '@/composables/useBreakpoint'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import { Map as MapIcon, LayoutGrid } from 'lucide-vue-next'

type Pane = 'map' | 'console'

const props = withDefaults(defineProps<{
  /** Workspace name, e.g. "EO Planner". */
  title: string
  /** Second line under the title — council + statutory context. */
  subtitle: string
  /** lucide icon component for the brand mark. */
  icon: Component
  /** Passed through to ProfileDropdown. */
  roleLabel: string
  avatarKey: string
  mapLabel?: string
  consoleLabel?: string
  /** Which pane to show first. Console is the field default for inspectors. */
  initialPane?: Pane
  /**
   * Controlled mode. Pass `v-model:pane` and the host owns which pane is open —
   * the inspector workspace does this so the pane lives in the URL and survives
   * a reload, the Back button and a shared link. Omit it and the shell keeps
   * its own state, which is what the EO and EHO workspaces still do.
   */
  pane?: Pane
}>(), { mapLabel: 'Map', consoleLabel: 'Console', initialPane: 'map' })

const emit = defineEmits<{ 'update:pane': [Pane] }>()

const router = useRouter()
const auth = useAuthStore()
const { isMobile } = useBreakpoint()

const uncontrolledPane = ref<Pane>(props.initialPane)
const activePane = computed<Pane>(() => props.pane ?? uncontrolledPane.value)
const consoleMounted = ref(activePane.value === 'console')

// The console pane is mounted lazily and then kept alive, so a host that
// switches panes from the URL still gets it built the first time.
watch(activePane, (pane) => {
  if (pane === 'console') consoleMounted.value = true
  if (pane === 'map') nextTick(() => window.dispatchEvent(new Event('resize')))
})

function showMap() {
  uncontrolledPane.value = 'map'
  emit('update:pane', 'map')
  // A map hidden with display:none has no content box. MapLibre 4.x observes
  // its container (trackResize defaults on) so it recovers by itself; the
  // window event is belt-and-braces for any pane that predates that, and
  // costs one tick.
  nextTick(() => window.dispatchEvent(new Event('resize')))
}

function showConsole() {
  consoleMounted.value = true
  uncontrolledPane.value = 'console'
  emit('update:pane', 'console')
}

function handleLogout() {
  auth.logout()
  router.push('/login')
}

defineExpose({ showMap, showConsole })
</script>

<template>
  <div class="rw-root">
    <a class="rw-skip" href="#rw-main">Skip to content</a>
    <header class="rw-chrome">
      <div class="rw-brand">
        <div class="rw-logo"><component :is="props.icon" :size="17" aria-hidden="true" /></div>
        <div class="rw-brand-text">
          <span class="rw-title">{{ props.title }}</span>
          <span class="rw-sub">{{ props.subtitle }}</span>
        </div>
      </div>

      <div class="rw-switch" role="tablist" :aria-label="`${props.title} view`">
        <button role="tab" type="button" :aria-selected="activePane === 'map'"
                :class="{ active: activePane === 'map' }" @click="showMap">
          <MapIcon :size="14" aria-hidden="true" />
          <span :class="isMobile ? 'ent-sr-only' : 'rw-switch-label'">{{ props.mapLabel }}</span>
        </button>
        <button role="tab" type="button" :aria-selected="activePane === 'console'"
                :class="{ active: activePane === 'console' }" @click="showConsole">
          <LayoutGrid :size="14" aria-hidden="true" />
          <span :class="isMobile ? 'ent-sr-only' : 'rw-switch-label'">{{ props.consoleLabel }}</span>
        </button>
      </div>

      <ProfileDropdown
        class="rw-profile"
        :role-label="props.roleLabel"
        :avatar-key="props.avatarKey"
        @logout="handleLogout"
      />
    </header>

    <div id="rw-main" class="rw-body" tabindex="-1">
      <div class="rw-pane" v-show="activePane === 'map'"><slot name="map" /></div>
      <div class="rw-pane" v-if="consoleMounted" v-show="activePane === 'console'">
        <slot name="console" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Tokens: src/styles/enterprise.css + src/styles/responsive.css.
   Breakpoints: 768 and 1024 only. The former 700px value is retired — it left
   700–767 as an untested band nothing else in the app used. */

.rw-root { display:flex; flex-direction:column; height:var(--ent-vh);
  background:var(--ent-canvas); color:var(--ent-text); font-family:var(--ent-font); }

.rw-skip {
  position:absolute; top:8px; left:8px; z-index:80;
  padding:0.45rem 0.75rem; background:var(--ent-surface); color:var(--ent-accent);
  border:1px solid var(--ent-accent); border-radius:var(--ent-r-sm);
  font-weight:600; text-decoration:none; transform:translateY(-220%);
}
.rw-skip:focus-visible { transform:translateY(0); outline:2px solid var(--ent-accent); outline-offset:2px; }

.rw-root :deep(input:focus-visible),
.rw-root :deep(textarea:focus-visible),
.rw-root :deep(select:focus-visible),
.rw-root :deep(button:focus-visible) {
  outline:2px solid var(--ent-accent);
  outline-offset:2px;
}

@media (prefers-reduced-motion: reduce) {
  .rw-root, .rw-root :deep(*) { transition-duration:0ms !important; animation-duration:0ms !important; }
}

.rw-chrome { display:flex; align-items:center; gap:var(--ent-s3);
  padding:0 var(--ent-s4);
  /* The bar clears the notch on a landscape phone, where the safe-area inset
     is on the left/right rather than the top. */
  padding-left:calc(var(--ent-s4) + var(--ent-safe-left));
  padding-right:calc(var(--ent-s4) + var(--ent-safe-right));
  min-height:var(--ent-topbar-h);
  background:var(--ent-surface); border-bottom:1px solid var(--ent-line);
  box-shadow:var(--ent-e1); flex-shrink:0; }

.rw-brand { display:flex; align-items:center; gap:var(--ent-s2); min-width:0; }
.rw-logo { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:1.85rem; height:1.85rem; border-radius:var(--ent-r);
  background:var(--ent-accent); color:var(--ent-text-on-accent); }
.rw-brand-text { min-width:0; }
.rw-title { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-bold);
  line-height:1.1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rw-sub   { display:block; font-size:var(--ent-fs-micro); color:var(--ent-text-3);
  line-height:1.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.rw-switch { display:inline-flex; gap:2px; margin-left:var(--ent-s4); padding:2px; flex-shrink:0;
  background:var(--ent-surface-sunken); border:1px solid var(--ent-line); border-radius:var(--ent-r); }
.rw-switch button { display:inline-flex; align-items:center; justify-content:center; gap:var(--ent-s1);
  min-height:var(--ent-control-h-sm); padding:var(--ent-s1) var(--ent-s3);
  font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold);
  border:none; background:transparent; color:var(--ent-text-2); border-radius:var(--ent-r-sm);
  cursor:pointer; font-family:var(--ent-font); }
.rw-switch button:hover { color:var(--ent-text); }
.rw-switch button.active { background:var(--ent-surface); color:var(--ent-accent); box-shadow:var(--ent-e1); }
.rw-switch button:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.rw-switch-label { white-space:nowrap; }

.rw-profile { margin-left:auto; flex-shrink:0; }

.rw-body { flex:1; min-height:0; position:relative; display:flex; }
.rw-pane { flex:1; min-width:0; display:flex; }
.rw-pane > * { flex:1; min-width:0; }

/* ── Tablet: 768–1023 ─────────────────────────────────────────────────── */
@media (max-width: 1023px) {
  .rw-switch { margin-left:var(--ent-s3); }
}

/* ── Mobile: ≤767 ─────────────────────────────────────────────────────────
   The statutory subtitle goes and the switch becomes icon-only. Both are
   still announced: the subtitle is decorative context the title already
   implies, and the switch labels move to sr-only spans in the template. The
   icon buttons become square at the touch minimum, which the pointer:coarse
   block in responsive.css already sizes via --ent-control-h-sm. */
@media (max-width: 767px) {
  .rw-sub { display:none; }
  .rw-switch button { min-width:var(--ent-control-h-sm); padding:var(--ent-s1) var(--ent-s2); }
}
</style>
