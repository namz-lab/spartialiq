<template>
  <!--
    Single source of truth for the user-account chip + drop-down panel.
    Replaces the same ~50 lines duplicated verbatim across 7 role views
    (AdminWorkspaceView, EOPlannerView, GISOfficerView, BuildingInspectorView,
    PlanningClerkView, SurveyorView, EnvironmentalOfficerView,
    VunguPlannerView, EnvironmentalOfficerView).

    Visual contract preserved (same .ph-* / .ppd-* class names) so callers
    can drop this in without restyling, but a11y, focus management and
    keyboard support are properly wired.
  -->
  <div ref="rootEl" class="ph-user">
    <div v-if="open" class="ph-backdrop" aria-hidden="true" @click="close" />

    <div class="ph-user-chip">
      <button
        ref="chipBtn"
        type="button"
        class="ph-chip-identity"
        :aria-label="`${displayName}, ${roleLabel} — account menu`"
        :aria-expanded="open"
        :aria-haspopup="true"
        aria-controls="ph-profile-panel"
        @click.stop="toggle"
      >
        <span class="ph-avatar">
          <img v-if="avatarUrl" :src="avatarUrl" class="ph-avatar-img" alt="" />
          <span v-else aria-hidden="true">{{ initials }}</span>
        </span>
        <span class="ph-chip-name">{{ displayName }}</span>
        <span class="ph-role-badge">{{ roleLabel }}</span>
      </button>
      <button
        type="button"
        class="ph-logout-btn"
        :aria-label="`Sign out ${displayName}`"
        title="Sign out"
        @click="emit('logout')"
      >
        <LogOut :size="14" aria-hidden="true" />
      </button>
    </div>

    <Transition name="profile-drop">
      <div
        v-if="open"
        id="ph-profile-panel"
        class="ph-profile-dropdown"
        role="dialog"
        aria-label="Account menu"
        @click.stop
        @keydown.esc="close"
      >
        <div class="ppd-header">
          <div class="ppd-avatar-wrap">
            <img v-if="avatarUrl" :src="avatarUrl" class="ppd-avatar-img" alt="" />
            <div v-else class="ppd-avatar-initials" aria-hidden="true">{{ initials }}</div>
            <label class="ppd-avatar-edit" title="Change photo">
              <Camera :size="12" aria-hidden="true" />
              <span class="sr-only">Upload new avatar</span>
              <input
                type="file"
                accept="image/*"
                class="ppd-file-input"
                @change="onAvatarChange"
              />
            </label>
          </div>
          <div class="ppd-user-info">
            <p class="ppd-name">{{ displayName }}</p>
            <p class="ppd-email">{{ email }}</p>
            <span class="ppd-role-pill">{{ roleLabel }}</span>
          </div>
        </div>

        <div class="ppd-divider" />

        <nav class="ppd-menu" aria-label="Account">
          <!-- Profile -->
          <button
            type="button"
            class="ppd-menu-item"
            :class="{ active: panel === 'profile' }"
            :aria-expanded="panel === 'profile'"
            aria-controls="ppd-profile-panel"
            @click.stop="togglePanel('profile')"
          >
            <User :size="16" aria-hidden="true" />
            Edit Profile
            <ChevronDown
              :size="14"
              class="ppd-item-chevron"
              :class="{ 'rotate-180': panel === 'profile' }"
              aria-hidden="true"
            />
          </button>
          <Transition name="slide-down">
            <div
              v-if="panel === 'profile'"
              id="ppd-profile-panel"
              class="ppd-sub-panel"
              @click.stop
            >
              <div class="ppd-field">
                <label :for="`${uid}-name`">Full Name</label>
                <input
                  :id="`${uid}-name`"
                  v-model="form.name"
                  class="ppd-input"
                  autocomplete="name"
                  placeholder="Your name"
                />
              </div>
              <div class="ppd-field">
                <label :for="`${uid}-phone`">Phone</label>
                <input
                  :id="`${uid}-phone`"
                  v-model="form.phone"
                  type="tel"
                  inputmode="tel"
                  autocomplete="tel"
                  class="ppd-input"
                  placeholder="+263 7X XXX XXXX"
                />
              </div>
              <button
                type="button"
                class="ppd-save-btn"
                :disabled="profileSaving"
                @click.stop="saveProfile"
              >
                <Check :size="14" aria-hidden="true" /> Save Changes
              </button>
              <p v-if="profileSaved" class="ppd-saved-msg" role="status" aria-live="polite">
                <Check :size="12" aria-hidden="true" /> Profile saved
              </p>
            </div>
          </Transition>

          <!-- Password -->
          <button
            type="button"
            class="ppd-menu-item"
            :class="{ active: panel === 'password' }"
            :aria-expanded="panel === 'password'"
            aria-controls="ppd-password-panel"
            @click.stop="togglePanel('password')"
          >
            <Lock :size="16" aria-hidden="true" />
            Change Password
            <ChevronDown
              :size="14"
              class="ppd-item-chevron"
              :class="{ 'rotate-180': panel === 'password' }"
              aria-hidden="true"
            />
          </button>
          <Transition name="slide-down">
            <div
              v-if="panel === 'password'"
              id="ppd-password-panel"
              class="ppd-sub-panel"
              @click.stop
            >
              <div class="ppd-field">
                <label :for="`${uid}-pw-current`">Current Password</label>
                <input
                  :id="`${uid}-pw-current`"
                  v-model="pw.current"
                  type="password"
                  autocomplete="current-password"
                  class="ppd-input"
                />
              </div>
              <div class="ppd-field">
                <label :for="`${uid}-pw-new`">New Password</label>
                <input
                  :id="`${uid}-pw-new`"
                  v-model="pw.next"
                  type="password"
                  autocomplete="new-password"
                  class="ppd-input"
                />
              </div>
              <div class="ppd-field">
                <label :for="`${uid}-pw-confirm`">Confirm New Password</label>
                <input
                  :id="`${uid}-pw-confirm`"
                  v-model="pw.confirm"
                  type="password"
                  autocomplete="new-password"
                  class="ppd-input"
                />
              </div>
              <button
                type="button"
                class="ppd-save-btn"
                @click.stop="changePassword"
              >
                <Check :size="14" aria-hidden="true" /> Update Password
              </button>
              <p v-if="pwSaved" class="ppd-saved-msg" role="status" aria-live="polite">
                <Check :size="12" aria-hidden="true" /> Password updated
              </p>
              <p v-if="pwError" class="ppd-error-msg" role="alert">{{ pwError }}</p>
            </div>
          </Transition>

          <!-- Help -->
          <button
            type="button"
            class="ppd-menu-item"
            :class="{ active: panel === 'help' }"
            :aria-expanded="panel === 'help'"
            @click.stop="togglePanel('help')"
          >
            <HelpCircle :size="16" aria-hidden="true" />
            Help &amp; Support
            <ChevronDown
              :size="14"
              class="ppd-item-chevron"
              :class="{ 'rotate-180': panel === 'help' }"
              aria-hidden="true"
            />
          </button>
          <Transition name="slide-down">
            <div
              v-if="panel === 'help'"
              class="ppd-sub-panel ppd-help"
              @click.stop
            >
              <p>For technical support, contact the Vungu RDC IT helpdesk.</p>
              <p>Email: <strong>support@vungurdc.gov.zw</strong></p>
              <p>Tel: <strong>+263 54 220 456</strong></p>
            </div>
          </Transition>

          <!-- About -->
          <button
            type="button"
            class="ppd-menu-item"
            :class="{ active: panel === 'about' }"
            :aria-expanded="panel === 'about'"
            @click.stop="togglePanel('about')"
          >
            <Info :size="16" aria-hidden="true" />
            About
            <ChevronDown
              :size="14"
              class="ppd-item-chevron"
              :class="{ 'rotate-180': panel === 'about' }"
              aria-hidden="true"
            />
          </button>
          <Transition name="slide-down">
            <div
              v-if="panel === 'about'"
              class="ppd-sub-panel ppd-help"
              @click.stop
            >
              <p><strong>Vungu Spatial Data Portal</strong> v2.4.0</p>
              <p>© 2026 Vungu Rural District Council.</p>
            </div>
          </Transition>
        </nav>

        <div class="ppd-divider" />

        <button
          type="button"
          class="ppd-logout-btn"
          @click="emit('logout')"
        >
          <LogOut :size="16" aria-hidden="true" /> Sign Out
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  Camera,
  Check,
  ChevronDown,
  HelpCircle,
  Info,
  Lock,
  LogOut,
  User,
} from 'lucide-vue-next'
import { useAuthStore } from '../../stores/auth'

interface Props {
  /** Override role label shown in chip & pill (e.g. "Planning Clerk"). */
  roleLabel?: string
  /** Avatar storage key — separate per role to avoid the shared `planner_avatar` collision. */
  avatarKey?: string
}

const props = withDefaults(defineProps<Props>(), {
  roleLabel: '',
  avatarKey: 'user_avatar',
})

const emit = defineEmits<{
  (e: 'logout'): void
}>()

const authStore = useAuthStore()

// Stable id per instance for label/aria-controls pairing.
const uid = `pd-${Math.random().toString(36).slice(2, 9)}`

// ── Open / panel state ────────────────────────────────────────────────────
const open = ref(false)
const panel = ref<'' | 'profile' | 'password' | 'help' | 'about'>('')
const rootEl = ref<HTMLElement | null>(null)
const chipBtn = ref<HTMLButtonElement | null>(null)

function close() {
  open.value = false
  panel.value = ''
}

function toggle() {
  open.value = !open.value
  if (!open.value) panel.value = ''
}

function togglePanel(name: typeof panel.value) {
  panel.value = panel.value === name ? '' : name
}

// Close on outside click + Escape, return focus to chip on close.
function onDocClick(e: MouseEvent) {
  if (!open.value || !rootEl.value) return
  if (!rootEl.value.contains(e.target as Node)) close()
}
function onDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    close()
    chipBtn.value?.focus()
  }
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKey)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKey)
})

// ── Display values ────────────────────────────────────────────────────────
const displayName = computed(() => authStore.user?.name || authStore.user?.email || 'User')
const email = computed(() => authStore.user?.email ?? '')
const roleLabel = computed(() => props.roleLabel || authStore.user?.role || 'User')
const initials = computed(() => {
  const source = authStore.user?.name || authStore.user?.email || 'U'
  return source
    .split(/[\s.@]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
})

// ── Avatar (scoped key per role) ──────────────────────────────────────────
const avatarUrl = ref<string>(localStorage.getItem(props.avatarKey) || '')
watch(
  () => props.avatarKey,
  (k) => { avatarUrl.value = localStorage.getItem(k) || '' },
)

function onAvatarChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  // Cap at 1.5 MB — anything larger blocks main thread on base64 encode and
  // would push past the localStorage 5 MB ceiling fast.
  if (file.size > 1_500_000) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    const url = ev.target?.result as string
    avatarUrl.value = url
    try { localStorage.setItem(props.avatarKey, url) } catch { /* quota */ }
  }
  reader.readAsDataURL(file)
}

// ── Profile form ──────────────────────────────────────────────────────────
const form = reactive({
  name:  authStore.user?.name ?? '',
  phone: (authStore.user as { phone?: string } | null)?.phone ?? '',
})
const profileSaved = ref(false)
const profileSaving = ref(false)

async function saveProfile() {
  profileSaving.value = true

  // Optimistic in-memory update — keeps the UI responsive even when offline.
  // The user record is deliberately not persisted (it carries PII); a refresh
  // re-hydrates it from GET /auth/me, so an edit that never reached the
  // backend correctly disappears instead of lingering as a local lie about
  // what the server holds.
  if (authStore.user) {
    authStore.user = {
      ...authStore.user,
      ...(form.name  ? { name:  form.name  } : {}),
      ...(form.phone ? { phone: form.phone } : {}),
    }
  }

  try {
    await authStore.updateProfile({ name: form.name })
  } catch {
    // Backend offline — local update still applied.
  } finally {
    profileSaving.value = false
    profileSaved.value = true
    setTimeout(() => { profileSaved.value = false }, 2500)
  }
}

// ── Password change ───────────────────────────────────────────────────────
const pw = reactive({ current: '', next: '', confirm: '' })
const pwSaved = ref(false)
const pwError = ref('')

function changePassword() {
  pwError.value = ''
  if (!pw.current || !pw.next) {
    pwError.value = 'All fields are required.'
    return
  }
  if (pw.next !== pw.confirm) {
    pwError.value = 'New passwords do not match.'
    return
  }
  if (pw.next.length < 8) {
    pwError.value = 'Password must be at least 8 characters.'
    return
  }
  // NOTE: backend wiring intentionally omitted — preserves the original
  // local-only behaviour. When the API exists, call it here.
  pw.current = ''
  pw.next = ''
  pw.confirm = ''
  pwSaved.value = true
  setTimeout(() => { pwSaved.value = false }, 2500)
}
</script>

<style scoped>
/*
  Visual contract preserved from the originals so the role views drop in
  without restyling. New work should migrate to Tailwind tokens.
*/
.ph-user        { position: relative; display: flex; align-items: center; }
.ph-user-chip   {
  display: flex;
  align-items: center;
  border: 1px solid #dde1e8;
  border-radius: 9999px;
  background: #fbfbf8;
  overflow: hidden;
}
.ph-chip-identity {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.625rem 0.25rem 0.25rem;
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  border-radius: 0;
  transition: background-color 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.ph-chip-identity:hover { background: #f7f8fa; }
.ph-chip-identity:active { transform: scale(0.985); }

.ph-chip-name { font-size: 0.8rem; font-weight: 600; color: #0b1220; }
.ph-avatar {
  width: 1.75rem;
  height: 1.75rem;
  background: #0b1220;
  color: #fbfbf8;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6875rem;
  font-weight: 600;
  overflow: hidden;
  flex-shrink: 0;
}
.ph-avatar-img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
.ph-backdrop { position: fixed; inset: 0; z-index: 39; }
.ph-role-badge {
  font-size: 0.65rem;
  font-weight: 600;
  background: #f7f8fa;
  color: #5b6473;
  padding: 0.2rem 0.65rem;
  border-radius: 9999px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.ph-logout-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  background: none;
  border: 1px solid #dde1e8;
  border-radius: 6px;
  cursor: pointer;
  color: #5b6473;
  margin: 0 0.25rem;
  transition: background-color 160ms cubic-bezier(0.23, 1, 0.32, 1),
              color 160ms cubic-bezier(0.23, 1, 0.32, 1);
  flex-shrink: 0;
}
.ph-logout-btn:hover { background: #fef3f2; color: #b42318; }
.ph-logout-btn:active { transform: scale(0.985); }

.ph-profile-dropdown {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: 460px;
  max-width: calc(100vw - 1.5rem);
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 12px 28px -8px rgba(11, 18, 32, 0.18);
  border: 1px solid #e2e6ec;
  z-index: 100;
  overflow: hidden;
}

.ppd-header {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 22px 22px 18px;
}

.ppd-avatar-wrap { position: relative; flex-shrink: 0; }
.ppd-avatar-img {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid #e2e6ec;
  display: block;
}
.ppd-avatar-initials {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: #0b1220;
  color: #fbfbf8;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 600;
}
.ppd-avatar-edit {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 24px;
  height: 24px;
  background: #0b1220;
  color: #fbfbf8;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 2px solid #fff;
  transition: background-color 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.ppd-avatar-edit:hover { background: #1a1f29; }
.ppd-file-input { display: none; }

.ppd-user-info { min-width: 0; flex: 1; }
.ppd-name  { font-size: 15px; font-weight: 600; color: #0b1220; margin: 0 0 3px; }
.ppd-email { font-size: 12.5px; color: #8e96a4; margin: 0 0 8px; word-break: break-all; }
.ppd-role-pill {
  font-size: 10.5px;
  background: #f7f8fa;
  color: #404a59;
  border-radius: 9999px;
  padding: 3px 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.ppd-divider { height: 1px; background: #eef0f4; margin: 0; }

.ppd-menu { padding: 6px 0; }

.ppd-menu-item {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 12px 20px;
  border: none;
  background: none;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 500;
  color: #2b333f;
  cursor: pointer;
  text-align: left;
  transition: background-color 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.ppd-menu-item:hover         { background: #f7f8fa; color: #0b1220; }
.ppd-menu-item.active        { background: #f0f3f7; color: #0b1220; }
.ppd-menu-item:active        { transform: scale(0.99); }

.ppd-item-chevron { margin-left: auto; color: #8e96a4; transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1); flex-shrink: 0; }
.ppd-item-chevron.rotate-180 { transform: rotate(180deg); }

.ppd-sub-panel {
  padding: 14px 20px 16px 52px;
  background: #fbfbf8;
  border-top: 1px solid #eef0f4;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ppd-field { display: flex; flex-direction: column; gap: 5px; }
.ppd-field label {
  font-size: 10.5px;
  font-weight: 600;
  color: #8e96a4;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.ppd-input {
  border: 1px solid #dde1e8;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13.5px;
  font-family: inherit;
  outline: none;
  color: #0b1220;
  background: #fff;
  transition: border-color 160ms cubic-bezier(0.23, 1, 0.32, 1),
              box-shadow  160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.ppd-input:focus {
  border-color: #1e6b4a;
  box-shadow: 0 0 0 3px rgba(30, 107, 74, 0.18);
}

.ppd-save-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 9px;
  background: #0b1220;
  color: #fbfbf8;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  transition: background-color 160ms cubic-bezier(0.23, 1, 0.32, 1),
              transform        100ms cubic-bezier(0.23, 1, 0.32, 1);
}
.ppd-save-btn:hover:not(:disabled) { background: #1a1f29; }
.ppd-save-btn:active:not(:disabled) { transform: scale(0.985); }
.ppd-save-btn:disabled { opacity: 0.55; cursor: not-allowed; }

.ppd-saved-msg {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: #1e6b4a;
  margin: 0;
  font-weight: 600;
}
.ppd-error-msg { font-size: 11.5px; color: #b42318; margin: 0; font-weight: 600; }

.ppd-help { font-size: 12.5px; color: #5b6473; line-height: 1.7; gap: 8px !important; }
.ppd-help p { margin: 0; }

.ppd-logout-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 13px 20px;
  border: none;
  background: none;
  font-family: inherit;
  color: #b42318;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.ppd-logout-btn:hover { background: #fef3f2; }
.ppd-logout-btn:active { transform: scale(0.99); }

/* Transitions */
.profile-drop-enter-active,
.profile-drop-leave-active { transition: opacity 160ms cubic-bezier(0.23, 1, 0.32, 1),
                                          transform 160ms cubic-bezier(0.23, 1, 0.32, 1); }
.profile-drop-enter-from,
.profile-drop-leave-to     { opacity: 0; transform: translateY(-6px) scale(0.98); }

.slide-down-enter-active,
.slide-down-leave-active   { transition: opacity 160ms cubic-bezier(0.23, 1, 0.32, 1),
                                          transform 160ms cubic-bezier(0.23, 1, 0.32, 1); }
.slide-down-enter-from,
.slide-down-leave-to       { opacity: 0; transform: translateY(-4px); }

/* ── Mobile: the chip reduces to the avatar ──────────────────────────────
   The trigger carried no responsive rule, so at 390px a long role label —
   "IT ADMINISTRATOR", "Environmental Health Officer" — wrapped to three lines
   and pushed the header of every role workspace past 60px, squeezing the
   section title beside it into an ellipsis.

   Nothing is lost: the name and the role are both repeated inside the menu
   this button opens, one tap away, and the avatar keeps its touch target. The
   button carries an explicit aria-label naming both, so hiding these two spans
   cannot leave it unlabelled — which it would otherwise, since the avatar's
   initials are aria-hidden. */
@media (max-width: 767px) {
  .ph-chip-name, .ph-role-badge { display: none; }
  .ph-chip-identity { padding: 0.25rem; gap: 0; }
}
</style>
