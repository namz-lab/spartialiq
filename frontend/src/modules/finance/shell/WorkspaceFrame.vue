<script setup lang="ts">
/**
 * The frame around every finance workspace. Chrome only.
 *
 * It owns what is the same for everyone and nothing else: the council and application name, the
 * financial year, the workspace switcher, the profile and sign-out, the boot and identity-error
 * states, and the sentence that explains a redirect. Each workspace supplies its own navigation
 * (`nav` slot), its own quick actions (`actions` slot) and its own content — the frame does not
 * know what a section is, which is the point of the architecture (spec §7).
 *
 * `layout` is the one structural choice the frame offers: a sidebar beside the content, or a bar
 * above it. The Cash Office uses the bar: a counter has no room for a sidebar at 390 px.
 */
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { AlertTriangle, RefreshCw } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import FinanceYearPicker from '../components/FinanceYearPicker.vue'
import { useFinanceStore } from '../stores/finance'
import { WORKSPACE_META, type WorkspaceKey } from './workspaces'
import { financeRoleLabel } from './roleLabels'
import WorkspaceSwitcher from './WorkspaceSwitcher.vue'
import WorkspaceNotice from './WorkspaceNotice.vue'
import '@/views/inspector/inspector.css'
import '../pages/finance.css'

const props = withDefaults(defineProps<{
  workspace: WorkspaceKey
  /** Whether this workspace works within a financial year. The Cash Office does not. */
  showYear?: boolean
  layout?: 'sidebar' | 'top'
}>(), { showYear: true, layout: 'sidebar' })

const router = useRouter()
const store = useFinanceStore()
const auth = useAuthStore()

const appName = computed(() => WORKSPACE_META[props.workspace].name)
const roleLabel = computed(() => financeRoleLabel(store.identity?.role ?? auth.user?.role))

async function boot(force = false): Promise<void> {
  const identity = await store.loadIdentity(force)
  if (identity && store.readsReference) await store.loadReference(force)
}

onMounted(() => { void boot() })

/** See FinanceWorkspace.vue: the store outlives the component, so sign-out must clear it. */
async function handleLogout(): Promise<void> {
  await auth.logout()
  store.reset()
  void router.push('/login')
}
</script>

<template>
  <div class="wsf" :class="`wsf--${layout}`">
    <a class="wsf-skip" href="#fin-main">Skip to content</a>
    <header class="wsf-top">
      <div class="wsf-brand">
        <span class="ins-eyebrow">Vungu Rural District Council · Finance</span>
        <h1 class="wsf-app">{{ appName }}</h1>
      </div>
      <div class="wsf-tools">
        <slot name="actions" />
        <FinanceYearPicker v-if="showYear && store.identity && store.readsReference" />
        <WorkspaceSwitcher v-if="store.identity" :current="workspace" />
        <ProfileDropdown :role-label="roleLabel" avatar-key="finance_avatar" @logout="handleLogout" />
      </div>
    </header>

    <WorkspaceNotice />

    <p v-if="store.loadingIdentity && !store.identity" class="wsf-loading" role="status">
      Reading your finance permissions…
    </p>

    <div v-else-if="!store.identity" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>{{ store.identityError ?? 'Your finance permissions could not be read.' }}</span>
      <button type="button" class="fin-btn small" @click="boot(true)">
        <RefreshCw :size="13" aria-hidden="true" /> Retry
      </button>
    </div>

    <template v-else>
      <p v-if="store.referenceError" class="ins-banner t-warning" role="alert">
        <AlertTriangle :size="16" aria-hidden="true" />
        <span>{{ store.referenceError }}</span>
      </p>
      <div class="wsf-body">
        <slot name="nav" />
        <main id="fin-main" class="wsf-main" tabindex="-1">
          <slot />
        </main>
      </div>
    </template>
  </div>
</template>

<style scoped>
.wsf { display: flex; flex-direction: column; gap: var(--ent-s4); min-height: 100%; padding: var(--ent-s4) var(--ent-s6) var(--ent-s7); background: var(--ent-canvas); }
.wsf-top { display: flex; align-items: center; gap: var(--ent-s4); flex-wrap: wrap; padding-bottom: var(--ent-s3); border-bottom: 1px solid var(--ent-line); }
.wsf-brand { flex: 1; min-width: 14rem; display: flex; flex-direction: column; gap: 2px; }
.wsf-app { margin: 0; font-size: var(--ent-fs-xl); font-weight: var(--ent-fw-semibold); line-height: var(--ent-lh-tight); color: var(--ent-text); }
.wsf-tools { display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap; }
.wsf-skip {
  position: absolute; top: 8px; left: 8px; z-index: var(--ent-z-toast);
  padding: 0.45rem 0.75rem; background: var(--ent-surface); color: var(--ent-accent);
  border: 1px solid var(--ent-accent); border-radius: var(--ent-r-sm);
  font-weight: var(--ent-fw-semibold); text-decoration: none; transform: translateY(-220%);
}
.wsf-skip:focus-visible { transform: translateY(0); outline: var(--ent-focus-ring); outline-offset: 2px; }
.wsf-loading { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.wsf-main { min-width: 0; display: flex; flex-direction: column; gap: var(--ent-s4); }
.wsf-main:focus { outline: none; }
.wsf--sidebar .wsf-body { display: grid; grid-template-columns: minmax(12rem, 15rem) minmax(0, 1fr); gap: var(--ent-s5); align-items: start; }
.wsf--top .wsf-body { display: flex; flex-direction: column; gap: var(--ent-s4); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@media (max-width: 1023px) {
  .wsf { padding: var(--ent-s3) var(--ent-s4) var(--ent-s7); }
  .wsf--sidebar .wsf-body { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 480px) {
  .wsf { padding: var(--ent-s3) var(--ent-s3) var(--ent-s7); }
}
</style>
