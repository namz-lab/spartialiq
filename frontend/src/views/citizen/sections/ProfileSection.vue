<script setup lang="ts">
// Profile & Settings — citizen identity (PUT /auth/profile), properties
// derived from the citizen's applications, password change and the
// signed-in device list (GET/DELETE /auth/sessions).

import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useCitizenCase } from '@/composables/useCitizenCase'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import api from '@/services/api'
import { describeAgent, timeAgo } from '@/admin/console'
import {
  isPersonName, isNationalId, isZwPhone, sanitizeNationalId, sanitizePhone,
} from '@/utils/citizenValidation'
import {
  Camera, BadgeCheck, MapPin, Home, Shield, KeyRound, LogOut, Building2, Check,
  MonitorSmartphone, ShieldAlert,
} from 'lucide-vue-next'

const router = useRouter()
const auth = useAuthStore()
const cc = useCitizenCase()
const fb = useUiFeedback()

const u = computed(() => auth.user as any)
const displayName = computed(() => u.value?.name || u.value?.email || 'Citizen')
const initials = computed(() => (displayName.value as string)
  .split(/[\s.@]+/).filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 2))

// ── Editable identity ─────────────────────────────────────────────────
const form = reactive({
  name: u.value?.name ?? '',
  phone: u.value?.phone ?? '',
  nationalId: u.value?.nationalId ?? '',
  address: u.value?.address ?? '',
})
const residencyVerified = computed(() => u.value?.residencyStatus === 'verified')
const saving = ref(false)
async function saveProfile() {
  if (!isPersonName(form.name)) { fb.showToast('Enter your full name using letters only.', 'warning'); return }
  if (form.nationalId && !isNationalId(form.nationalId)) {
    fb.showToast('National ID must look like 12-345678-X-78.', 'warning'); return
  }
  if (form.phone && !isZwPhone(form.phone)) {
    fb.showToast('Phone must be a Zimbabwe mobile number, e.g. 0771234567.', 'warning'); return
  }
  saving.value = true
  try {
    await auth.updateProfile({ name: form.name.trim(), phone: form.phone, nationalId: form.nationalId, address: form.address } as any)
    fb.showToast('Profile updated.', 'success')
  } catch {
    fb.showToast('Could not save the profile. Check your connection and try again.', 'error')
  } finally {
    saving.value = false
  }
}

// ── Avatar (shared key with the header chip) ──────────────────────────
const AVATAR_KEY = 'citizen_avatar'
const avatarUrl = ref<string>(localStorage.getItem(AVATAR_KEY) || '')
function onAvatarChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file || file.size > 1_500_000) {
    if (file) fb.showToast('Image too large (max 1.5 MB).', 'warning')
    return
  }
  const reader = new FileReader()
  reader.onload = ev => {
    avatarUrl.value = ev.target?.result as string
    try { localStorage.setItem(AVATAR_KEY, avatarUrl.value) } catch { /* quota */ }
  }
  reader.readAsDataURL(file)
}

// ── Linked properties (from real applications) ────────────────────────
const properties = computed(() => {
  const seen = new Set<string>()
  const out: { address: string; parcel: string; zone: string }[] = []
  for (const p of cc.applications.value) {
    const key = `${p.stand_number}|${p.suburb_ward}`
    if (!p.stand_number || seen.has(key)) continue
    seen.add(key)
    out.push({
      address: `Stand ${p.stand_number}, ${p.suburb_ward}`,
      parcel: p.dev_register_no || p.id.slice(0, 10),
      zone: (p.development_type || '—').replace(/_/g, ' '),
    })
  }
  return out
})

// ── Signed-in devices ─────────────────────────────────────────────────
interface Session { id: string; user_agent: string | null; ip: string | null; created_at: string; last_used_at: string | null; current: boolean }
const sessions = ref<Session[]>([])
const sessionsError = ref('')
const revoking = ref<string | null>(null)
async function loadSessions() {
  sessionsError.value = ''
  try {
    const r = await api.get<{ success: boolean; data: Session[] }>('/auth/sessions')
    sessions.value = r.data.data ?? []
  } catch {
    sessionsError.value = 'Could not load your signed-in devices.'
  }
}
async function revoke(s: Session) {
  revoking.value = s.id
  try {
    await api.delete(`/auth/sessions/${encodeURIComponent(s.id)}`)
    sessions.value = sessions.value.filter(x => x.id !== s.id)
    fb.showToast(`Signed out ${describeAgent(s.user_agent)}.`, 'success')
  } catch (e) {
    fb.showToast(fb.parseApiError(e, 'Could not sign that device out.'), 'error')
  } finally {
    revoking.value = null
  }
}
onMounted(loadSessions)

// ── Password ──────────────────────────────────────────────────────────
const pw = reactive({ current: '', next: '', confirm: '' })
const pwSaving = ref(false)
async function changePassword() {
  if (!pw.current || !pw.next) { fb.showToast('Fill in all password fields.', 'warning'); return }
  if (pw.next !== pw.confirm) { fb.showToast('New passwords do not match.', 'error'); return }
  if (pw.next.length < 8) { fb.showToast('Password must be at least 8 characters.', 'warning'); return }
  pwSaving.value = true
  try {
    await auth.changePassword(pw.current, pw.next)
    pw.current = pw.next = pw.confirm = ''
    fb.showToast('Password updated.', 'success')
  } catch {
    fb.showToast('Could not change the password. Check the current password and try again.', 'error')
  } finally {
    pwSaving.value = false
  }
}

function signOut() { auth.logout(); router.push('/login') }
</script>

<template>
  <div class="pf">
    <header class="pf-header">
      <h1>Profile &amp; settings</h1>
      <p>Manage your identity, properties, and account preferences.</p>
    </header>

    <div class="pf-grid">
      <!-- Left column -->
      <div class="pf-main">
        <!-- Personal details -->
        <div class="cp-card pf-personal">
          <div class="pf-identity">
            <div class="pf-avatar-wrap">
              <span class="pf-avatar">
                <img v-if="avatarUrl" :src="avatarUrl" alt="" />
                <span v-else>{{ initials }}</span>
              </span>
              <label class="pf-avatar-edit" title="Change photo">
                <Camera :size="14" />
                <input type="file" accept="image/*" @change="onAvatarChange" />
              </label>
            </div>
            <div class="pf-id-text">
              <div class="pf-name-row">
                <h2>{{ displayName }}</h2>
                <span v-if="residencyVerified" class="pf-verified"><BadgeCheck :size="13" /> Residency verified</span>
                <router-link v-else to="/residency" class="pf-unverified"><ShieldAlert :size="13" /> Verify residency</router-link>
              </div>
              <p class="mono pf-uid">ID: {{ form.nationalId || '—' }}</p>
              <div v-if="form.address" class="pf-id-meta">
                <span><MapPin :size="15" /> {{ form.address }}</span>
              </div>
            </div>
          </div>

          <div class="pf-fields">
            <label class="pf-field"><span>Full name</span><input v-model="form.name" autocomplete="name" /></label>
            <label class="pf-field"><span>National ID</span>
              <input :value="form.nationalId" placeholder="12-345678-X-90" autocomplete="off"
                     @input="form.nationalId = sanitizeNationalId(($event.target as HTMLInputElement).value)" />
            </label>
            <label class="pf-field"><span>Email address</span><input :value="u?.email" disabled /></label>
            <label class="pf-field"><span>Phone number</span>
              <input :value="form.phone" placeholder="0771234567" type="tel" inputmode="tel" autocomplete="tel"
                     @input="form.phone = sanitizePhone(($event.target as HTMLInputElement).value)" />
            </label>
            <label class="pf-field full"><span>Physical address</span><input v-model="form.address" autocomplete="street-address" /></label>
          </div>
          <div class="pf-save-row">
            <button class="pf-btn primary" :disabled="saving" @click="saveProfile">
              <Check :size="16" /> {{ saving ? 'Saving…' : 'Save changes' }}
            </button>
          </div>
        </div>

        <!-- Linked properties -->
        <div class="cp-card">
          <div class="cp-card-head between">
            <h3><Home :size="16" class="ic-mut" /> My properties</h3>
          </div>
          <div v-if="!properties.length" class="pf-empty">Stands appear here once you submit an application for them.</div>
          <template v-else>
            <div class="pf-prop-head">
              <span class="c-addr">Stand</span><span class="c-parcel">Latest application</span><span class="c-zone">Type</span><span class="c-act"></span>
            </div>
            <div class="pf-prop-list">
              <div v-for="(p, i) in properties" :key="i" class="pf-prop">
                <span class="pf-prop-addr"><span class="pf-prop-ic"><Building2 :size="16" /></span>{{ p.address }}</span>
                <span class="mono muted c-parcel">{{ p.parcel }}</span>
                <span class="muted cap c-zone">{{ p.zone }}</span>
                <span class="c-act"></span>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- Right column -->
      <div class="pf-side">
        <!-- Security -->
        <div class="cp-card">
          <div class="cp-card-head"><h3><Shield :size="16" class="ic-mut" /> Security</h3></div>
          <div class="pf-sec">
            <details class="pf-pw">
              <summary class="pf-btn ghost full"><KeyRound :size="16" /> Change password</summary>
              <div class="pf-pw-body">
                <label class="pf-field"><span>Current password</span><input v-model="pw.current" type="password" autocomplete="current-password" /></label>
                <label class="pf-field"><span>New password</span><input v-model="pw.next" type="password" autocomplete="new-password" /></label>
                <label class="pf-field"><span>Confirm new password</span><input v-model="pw.confirm" type="password" autocomplete="new-password" /></label>
                <button class="pf-btn primary full" :disabled="pwSaving" @click="changePassword">
                  <Check :size="15" /> {{ pwSaving ? 'Updating…' : 'Update password' }}
                </button>
              </div>
            </details>
          </div>
        </div>

        <!-- Signed-in devices -->
        <div class="cp-card">
          <div class="cp-card-head"><h3><MonitorSmartphone :size="16" class="ic-mut" /> Signed-in devices</h3></div>
          <p v-if="sessionsError" class="pf-empty">{{ sessionsError }}
            <button type="button" class="pf-linkbtn" @click="loadSessions">Retry</button></p>
          <ul v-else class="pf-sessions">
            <li v-for="s in sessions" :key="s.id">
              <div class="pf-session-text">
                <p class="pf-row-t">{{ describeAgent(s.user_agent) }}<em v-if="s.current"> · this device</em></p>
                <p class="pf-row-s">Active {{ timeAgo(s.last_used_at || s.created_at) }}<template v-if="s.ip"> · {{ s.ip }}</template></p>
              </div>
              <button v-if="!s.current" type="button" class="pf-linkbtn" :disabled="revoking === s.id" @click="revoke(s)">
                {{ revoking === s.id ? 'Signing out…' : 'Sign out' }}
              </button>
            </li>
          </ul>
          <p class="pf-sec-note">If you see a device you do not recognise, sign it out and change your password.</p>
        </div>

        <!-- Sign out -->
        <button type="button" class="pf-signout" @click="signOut"><LogOut :size="16" /> Sign out</button>
      </div>
    </div>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
/* Tokens (--cp-*) inherited from .cp-root */
.pf { padding:1rem; display:flex; flex-direction:column; gap:1rem; max-width:1100px; margin:0 auto; width:100%; }
.mono { font-family:var(--cp-mono); }
.muted { color:var(--cp-muted); }
.cap { text-transform:capitalize; }

.pf-header h1 { margin:0; font-size:1.4rem; font-weight:700; letter-spacing:-0.01em; color:var(--cp-text); }
.pf-header p { margin:0.2rem 0 0; font-size:0.85rem; color:var(--cp-text-2); }

.pf-grid { display:flex; flex-direction:column; gap:1rem; }
.pf-main, .pf-side { display:flex; flex-direction:column; gap:1rem; min-width:0; }

/* Cards */
.cp-card { background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius); box-shadow:var(--cp-shadow); overflow:hidden; }
.cp-card-head { display:flex; align-items:center; gap:0.5rem; padding:0.85rem 1.1rem; border-bottom:1px solid var(--cp-border); }
.cp-card-head.between { justify-content:space-between; }
.cp-card-head h3 { display:flex; align-items:center; gap:0.45rem; margin:0; font-size:0.92rem; font-weight:600; color:var(--cp-text); }
.cp-card-head .ic-mut { color:var(--cp-muted); }

/* Buttons */
.pf-btn { display:inline-flex; align-items:center; justify-content:center; gap:0.4rem; padding:0.5rem 0.9rem;
  border:1px solid transparent; border-radius:var(--cp-radius-sm); font-size:0.8rem; font-weight:600; cursor:pointer; }
.pf-btn.primary { background:var(--cp-primary); color:var(--cp-on-primary); }
.pf-btn.primary:hover:not(:disabled) { background:var(--cp-primary-hover); }
.pf-btn.primary:disabled { background:var(--cp-border-strong); cursor:not-allowed; }
.pf-btn.ghost { background:var(--cp-surface); border-color:var(--cp-border); color:var(--cp-text); }
.pf-btn.ghost:hover { background:var(--cp-surface-2); }
.pf-btn.sm { padding:0.35rem 0.7rem; font-size:0.76rem; }
.pf-btn.full { width:100%; }

/* Personal */
.pf-personal { padding:1.25rem; }
.pf-identity { display:flex; gap:1.25rem; align-items:center; padding-bottom:1.25rem; margin-bottom:1.25rem; border-bottom:1px solid var(--cp-border); }
.pf-avatar-wrap { position:relative; flex-shrink:0; }
.pf-avatar { display:flex; align-items:center; justify-content:center; width:84px; height:84px; border-radius:50%;
  background:var(--cp-primary); color:#fff; font-size:1.6rem; font-weight:700; overflow:hidden; border:2px solid var(--cp-primary-tint); }
.pf-avatar img { width:100%; height:100%; object-fit:cover; }
.pf-avatar-edit { position:absolute; bottom:0; right:0; display:inline-flex; align-items:center; justify-content:center;
  width:28px; height:28px; border-radius:50%; background:var(--cp-surface); border:1px solid var(--cp-border); color:var(--cp-muted); cursor:pointer; box-shadow:var(--cp-shadow); }
.pf-avatar-edit input { display:none; }
.pf-id-text { min-width:0; }
.pf-name-row { display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap; }
.pf-name-row h2 { margin:0; font-size:1.2rem; font-weight:700; color:var(--cp-text); }
.pf-verified { display:inline-flex; align-items:center; gap:0.25rem; padding:0.15rem 0.5rem; border-radius:var(--cp-radius-pill);
  background:var(--cp-blue-bg); color:var(--cp-blue-fg); font-size:0.64rem; font-weight:700; text-transform:uppercase; }
.pf-uid { margin:0.3rem 0 0.5rem; font-size:0.78rem; color:var(--cp-muted); }
.pf-id-meta { display:flex; flex-wrap:wrap; gap:1rem; }
.pf-id-meta span { display:inline-flex; align-items:center; gap:0.35rem; font-size:0.8rem; color:var(--cp-text-2); }

.pf-fields { display:grid; grid-template-columns:1fr 1fr; gap:0.85rem; }
.pf-field { display:flex; flex-direction:column; gap:0.3rem; }
.pf-field.full { grid-column:1 / -1; }
.pf-field > span { font-size:0.64rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--cp-muted); }
.pf-field input, .pf-field select { padding:0.5rem 0.65rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm);
  font-size:0.85rem; color:var(--cp-text); font-family:inherit; background:var(--cp-surface); }
.pf-field input:disabled { background:var(--cp-surface-2); color:var(--cp-muted); }
.pf-field input:focus, .pf-field select:focus { outline:2px solid var(--cp-primary); outline-offset:-2px; border-color:var(--cp-primary); }
.pf-save-row { display:flex; justify-content:flex-end; margin-top:1rem; }

/* Linked properties */
.pf-empty { padding:1.75rem 1rem; text-align:center; color:var(--cp-faint); font-size:0.82rem; }
.pf-prop-head { display:none; }
.pf-prop-list { display:flex; flex-direction:column; }
.pf-prop { display:flex; flex-direction:column; gap:0.35rem; padding:0.85rem 1.1rem; border-bottom:1px solid var(--cp-border); }
.pf-prop:last-child { border-bottom:0; }
.pf-prop-addr { display:flex; align-items:center; gap:0.6rem; font-size:0.85rem; font-weight:600; color:var(--cp-text); }
.pf-prop-ic { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; flex-shrink:0;
  border-radius:50%; background:var(--cp-primary-tint); color:var(--cp-primary); }
.pf-prop-more { border:0; background:none; color:var(--cp-faint); cursor:pointer; align-self:flex-start; }

/* Security */
.pf-sec { padding:1.1rem; }
.pf-row { display:flex; align-items:center; justify-content:space-between; gap:1rem; }
.pf-row-t { margin:0; font-size:0.85rem; color:var(--cp-text); }
.pf-row-s { margin:0.1rem 0 0; font-size:0.76rem; color:var(--cp-muted); }
.pf-divider { height:1px; background:var(--cp-border); margin:0.85rem 0; }
.pf-toggle { position:relative; width:38px; height:22px; border:0; border-radius:9999px; background:var(--cp-border-strong); cursor:pointer; transition:background .15s; flex-shrink:0; }
.pf-toggle span { position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:#fff; transition:transform .15s; }
.pf-toggle.on { background:var(--cp-primary); }
.pf-toggle.on span { transform:translateX(16px); }
.pf-pw { margin-top:0.2rem; }
.pf-pw summary { list-style:none; }
.pf-pw summary::-webkit-details-marker { display:none; }
.pf-pw-body { display:flex; flex-direction:column; gap:0.6rem; padding-top:0.85rem; }

/* Notifications */
.pf-notif { padding:1.1rem; display:flex; flex-direction:column; gap:1rem; }
.pf-check { display:flex; align-items:flex-start; gap:0.7rem; cursor:pointer; }
.pf-check input { margin-top:0.15rem; width:18px; height:18px; accent-color:var(--cp-primary); }

/* Sign out */
.pf-signout { display:inline-flex; align-items:center; justify-content:center; gap:0.5rem; width:100%; padding:0.7rem;
  border:1px solid #fecaca; border-radius:var(--cp-radius-sm); background:var(--cp-surface); color:var(--cp-red-fg); font-size:0.85rem; font-weight:600; cursor:pointer; }
.pf-signout:hover { background:var(--cp-red-bg); }
.pf-unverified { display:inline-flex; align-items:center; gap:0.25rem; padding:0.15rem 0.5rem; border-radius:var(--cp-radius-pill);
  background:var(--cp-amber-bg); color:var(--cp-amber-fg); font-size:0.64rem; font-weight:700; text-transform:uppercase; text-decoration:none; }
.pf-linkbtn { border:0; background:none; padding:0; color:var(--cp-primary); font-size:0.78rem; font-weight:600; cursor:pointer; flex-shrink:0; }
.pf-linkbtn:hover:not(:disabled) { text-decoration:underline; }
.pf-sessions { list-style:none; margin:0; padding:0; }
.pf-sessions li { display:flex; align-items:center; gap:0.75rem; padding:0.75rem 1.1rem; border-bottom:1px solid var(--cp-border); }
.pf-session-text { flex:1; min-width:0; }
.pf-session-text em { font-style:normal; color:var(--cp-green-fg); }
.pf-sec-note { margin:0; padding:0.75rem 1.1rem 1rem; font-size:0.74rem; color:var(--cp-muted); }

/* ── Desktop ──────────────────────────────────────────────────────── */
@media (min-width: 1024px) {
  .pf { padding:1.5rem; }
  .pf-grid { display:grid; grid-template-columns:2fr 1fr; align-items:start; }
  .pf-prop-head { display:grid; grid-template-columns:1fr 8rem 7rem 2rem; gap:0.75rem; padding:0.5rem 1.1rem;
    background:var(--cp-surface-2); border-bottom:1px solid var(--cp-border);
    font-size:0.62rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--cp-muted); }
  .pf-prop { display:grid; grid-template-columns:1fr 8rem 7rem 2rem; gap:0.75rem; align-items:center; }
  .pf-prop-more { align-self:center; justify-self:end; }
}
</style>
