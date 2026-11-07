<script setup lang="ts">
// Council IT Administration console.
//
// Everything a local-authority IT officer does with this system, in one
// workspace: provision and retire staff accounts, prove who did what, see who
// is signed in, hold the line on sign-in security, watch the database and the
// outgoing mail, keep the establishment current, and configure the parts of
// the portal that are the council's to decide.
//
// SECTIONS (fifteen)
//   people    Overview · Employees · Invitations · Roles & permissions · Org structure
//   security  Audit trail · Active sessions · Sign-in security
//   system    System health · Email & jobs · Backups · Announcements
//   config    System settings · Integrations
//   device    Console preferences
//
// WHAT IS DELIBERATELY ABSENT
// There is no planning, analytics or map entry, at any width. The IT Admin
// owns people and configuration; they do not open cases or determine
// applications. That is separation of duties, and it is enforced in three
// places that agree: ADMIN_BLOCKED in router/index.ts, the role lists on the
// planning routes, and the fact that src/routes/admin-console.js cannot reach
// the planning record at all.
//
// URL
// The section, and each section's own filters, live in the URL
// (src/admin/console.ts). An IT admin's work ends in "send me the link" more
// often than any other role's — a support conversation about a failed sign-in
// is finished by pasting the filtered log, not by describing it.
//
// RESPONSIVE
//   ≥1024px  labelled rail with count badges
//   768–1023 rail collapsed to icons by default (overridable, remembered)
//   ≤767px   bottom navigation, four slots plus More
//
// The primitives are the shared ins-* sheet (views/inspector/inspector.css)
// and the --ent-* UI kit: one console vocabulary across every staff role
// rather than a fifth that drifts.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useAdminNav, useAdminPreferences } from '@/admin/useAdminConsole'
import { GROUP_LABELS, type SectionGroup, type SectionKey } from '@/admin/console'
import { useAdminOverview } from '@/admin/useAdminOverview'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import UiBottomNav, { type BottomNavItem } from '@/components/ui/UiBottomNav.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import './inspector/inspector.css'

import OverviewSection      from './admin/sections/OverviewSection.vue'
import EmployeesSection     from './admin/sections/EmployeesSection.vue'
import InvitationsSection   from './admin/sections/InvitationsSection.vue'
import RolesSection         from './admin/sections/RolesSection.vue'
import OrgSection           from './admin/sections/OrgSection.vue'
import AuditSection         from './admin/sections/AuditSection.vue'
import SessionsSection      from './admin/sections/SessionsSection.vue'
import SignInSection        from './admin/sections/SignInSection.vue'
import HealthSection        from './admin/sections/HealthSection.vue'
import JobsSection          from './admin/sections/JobsSection.vue'
import BackupsSection       from './admin/sections/BackupsSection.vue'
import UsageSection         from './admin/sections/UsageSection.vue'
import AnnouncementsSection from './admin/sections/AnnouncementsSection.vue'
import SettingsSection      from './admin/sections/SettingsSection.vue'
import IntegrationsSection  from './admin/sections/IntegrationsSection.vue'
import PreferencesSection   from './admin/sections/PreferencesSection.vue'

import {
  ShieldCheck, LayoutDashboard, Users, MailPlus, KeyRound, Network,
  ScrollText, MonitorSmartphone, LogIn, Activity, Send, DatabaseBackup,
  Megaphone, SlidersHorizontal, Plug, Settings2, Menu, X, Search,
  CornerDownLeft, RefreshCw, Wrench, AlertTriangle, BarChart3,
} from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()
const { isMobile, isTablet } = useBreakpoint()
const { prefs } = useAdminPreferences()
const nav = useAdminNav()
const overview = useAdminOverview()

type Section = BottomNavItem & { key: SectionKey; desc: string; group: SectionGroup }

const SECTIONS: readonly Omit<Section, 'badge'>[] = [
  { key: 'overview',      label: 'Overview',            short: 'Home',     icon: LayoutDashboard,    group: 'people',
    desc: 'What needs attention across accounts, security and the system' },
  { key: 'employees',     label: 'Employee accounts',   short: 'Staff',    icon: Users,              group: 'people',
    desc: 'Provision staff, assign system roles, suspend and restore access' },
  { key: 'invitations',   label: 'Invitations',         short: 'Invites',  icon: MailPlus,           group: 'people',
    desc: 'Outstanding invitations, their links and their expiry' },
  { key: 'roles',         label: 'Roles & permissions', short: 'Roles',    icon: KeyRound,           group: 'people',
    desc: 'What each role may do, as the server enforces it' },
  { key: 'org',           label: 'Org structure',       short: 'Org',      icon: Network,            group: 'people',
    desc: 'The council establishment, its reporting lines and its vacancies' },

  { key: 'audit',         label: 'Audit trail',         short: 'Audit',    icon: ScrollText,         group: 'security',
    desc: 'Every change to the council record, and who made it' },
  { key: 'sessions',      label: 'Active sessions',     short: 'Devices',  icon: MonitorSmartphone,  group: 'security',
    desc: 'Who is signed in, from where, and on what' },
  { key: 'signin',        label: 'Sign-in security',    short: 'Sign-in',  icon: LogIn,              group: 'security',
    desc: 'Failed attempts, lockouts and the network blocklist' },

  { key: 'health',        label: 'System health',       short: 'Health',   icon: Activity,           group: 'system',
    desc: 'Database, process and host, with the table inventory' },
  { key: 'jobs',          label: 'Email & jobs',        short: 'Email',    icon: Send,               group: 'system',
    desc: 'The outgoing message queue, its failures and its retries' },
  { key: 'backups',       label: 'Backups',             short: 'Backups',  icon: DatabaseBackup,     group: 'system',
    desc: 'What has actually been written to the backup directory' },
  { key: 'usage',         label: 'Portal usage',        short: 'Usage',    icon: BarChart3,          group: 'system',
    desc: 'Page views from visitors who accepted analytics' },
  { key: 'announcements', label: 'Announcements',       short: 'Notices',  icon: Megaphone,          group: 'system',
    desc: 'Service messages to staff and citizens' },

  { key: 'settings',      label: 'System settings',     short: 'Settings', icon: SlidersHorizontal,  group: 'config',
    desc: 'Security policy, maintenance, council details and notifications' },
  { key: 'integrations',  label: 'Integrations',        short: 'Connect',  icon: Plug,               group: 'config',
    desc: 'QGIS, the other configuration consoles and the system documentation' },

  { key: 'preferences',   label: 'Console preferences', short: 'You',      icon: Settings2,          group: 'device',
    desc: 'How this console behaves on this device' },
]

/**
 * Badges are work waiting, never totals.
 *
 * A rail that says "412" beside Employees teaches the admin to stop reading
 * the rail. Each number here is something somebody has to do: an invitation
 * that has expired unused, a lockout in force, a message that failed to send,
 * a post nobody holds.
 */
const badges = computed<Partial<Record<SectionKey, number>>>(() => {
  const o = overview.data.value
  if (!o) return {}
  return {
    employees: o.staff.suspended || undefined,
    invitations: o.invites.expired || undefined,
    signin: o.security.ipBlocks || undefined,
    jobs: o.outbox.failed || undefined,
    org: o.org.vacancies || undefined,
  }
})

const sections = computed<Section[]>(() =>
  SECTIONS.map(s => ({ ...s, badge: badges.value[s.key] || undefined })))

const activeSection = nav.section
const activeMeta = computed(() =>
  sections.value.find(s => s.key === activeSection.value) ?? sections.value[0])

const SECTION_COMPONENTS: Record<SectionKey, Component> = {
  overview: OverviewSection, employees: EmployeesSection, invitations: InvitationsSection,
  roles: RolesSection, org: OrgSection,
  audit: AuditSection, sessions: SessionsSection, signin: SignInSection,
  health: HealthSection, jobs: JobsSection, backups: BackupsSection,
  usage: UsageSection, announcements: AnnouncementsSection,
  settings: SettingsSection, integrations: IntegrationsSection,
  preferences: PreferencesSection,
}

// ── Rail collapse ───────────────────────────────────────────────────────
// A tablet starts collapsed — room for the rail, not for the labels. The
// admin's own choice (Preferences, or the toggle) wins once made this session.
const userCollapse = ref<boolean | null>(null)
const railCollapsed = computed(() => userCollapse.value ?? (isTablet.value || prefs.value.railCollapsed))
function toggleRail() { userCollapse.value = !railCollapsed.value }

// ── Counters ────────────────────────────────────────────────────────────
// Re-read on every section change rather than on a timer: a timer would spend
// a rural data allowance idling on a screen nobody is looking at, and the
// moment the numbers matter is the moment the admin moves to the section
// they belong to.
onMounted(() => { void overview.refresh() })
watch(activeSection, () => { void overview.refresh() })

// ── Section change: focus + scroll ──────────────────────────────────────
// A screen-reader user who picks a section is moved to its content; a sighted
// user is not left halfway down the previous section's scroll position.
const mainEl = ref<HTMLElement | null>(null)
watch(activeSection, async () => {
  await nextTick()
  mainEl.value?.scrollTo({ top: 0 })
  mainEl.value?.focus({ preventScroll: true })
})

// ── Maintenance mode ────────────────────────────────────────────────────
// Shown as a standing bar rather than a toast, because it is a STATE and not
// an event: while it is on, every other officer in the council is being
// refused, and the person who can end that is the one reading this screen.
const maintenanceOn = computed(() => overview.maintenanceMode.value)

// ── Jump palette (Ctrl/⌘ K) ─────────────────────────────────────────────
// Fifteen sections and a staff register: the fastest route to an officer's
// account is typing their name, not scrolling a rail and then a table.
const paletteOpen = ref(false)
const paletteQuery = ref('')
const paletteIndex = ref(0)

interface PaletteItem { id: string; title: string; meta: string; icon: Component; run: () => void }

const paletteItems = computed<PaletteItem[]>(() => {
  const q = paletteQuery.value.trim().toLowerCase()
  const secs: PaletteItem[] = SECTIONS
    .filter(s => !q || s.label.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q))
    .map(s => ({ id: `s:${s.key}`, title: s.label, meta: s.desc, icon: s.icon, run: () => nav.go(s.key) }))
  if (!q) return secs
  // Staff are searched only once something is typed: an empty palette should
  // offer navigation, not dump the whole register.
  const staff: PaletteItem[] = overview.staff.value
    .filter(u => `${u.name} ${u.email} ${u.role} ${u.jobTitle ?? ''}`.toLowerCase().includes(q))
    .slice(0, 6)
    .map(u => ({
      id: `u:${u.id}`,
      title: u.name,
      meta: [u.email, u.jobTitle, u.status].filter(Boolean).join(' · '),
      icon: Users,
      run: () => nav.go('employees', { q: u.email }),
    }))
  return [...staff, ...secs]
})
watch(paletteQuery, () => { paletteIndex.value = 0 })

function openPalette() {
  paletteQuery.value = ''
  paletteIndex.value = 0
  paletteOpen.value = true
  void overview.loadStaff()
}

// The palette is typed into the moment it opens. Not `autofocus`: UiSheet
// moves focus to its own close button on open, which would swallow the
// attribute and leave Ctrl K + typing going nowhere. This runs after that.
const paletteInput = ref<HTMLInputElement | null>(null)
watch(paletteOpen, (open) => {
  if (open) setTimeout(() => paletteInput.value?.focus(), 0)
})

function runPalette(item?: PaletteItem) {
  const target = item ?? paletteItems.value[paletteIndex.value]
  if (!target) return
  paletteOpen.value = false
  target.run()
}

function paletteKey(e: KeyboardEvent) {
  const n = paletteItems.value.length
  if (!n) return
  if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex.value = (paletteIndex.value + 1) % n }
  else if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex.value = (paletteIndex.value - 1 + n) % n }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette() }
}

function globalKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    paletteOpen.value ? (paletteOpen.value = false) : openPalette()
  }
}
onMounted(() => window.addEventListener('keydown', globalKey))
onBeforeUnmount(() => window.removeEventListener('keydown', globalKey))

function handleLogout() {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="aw-root">
    <a class="aw-skip" href="#aw-main">Skip to content</a>

    <header class="aw-header">
      <button v-if="!isMobile" class="ins-iconbtn aw-railbtn" type="button"
              :aria-expanded="!railCollapsed" aria-controls="aw-section-rail"
              @click="toggleRail">
        <component :is="railCollapsed ? Menu : X" :size="15" aria-hidden="true" />
        <span class="ent-sr-only">{{ railCollapsed ? 'Expand' : 'Collapse' }} section menu</span>
      </button>

      <div class="aw-brand">
        <div class="aw-mark"><ShieldCheck :size="16" aria-hidden="true" /></div>
        <div class="aw-brand-text">
          <span class="aw-title">IT Administration</span>
          <span class="aw-sub">Vungu RDC · staff access &amp; system configuration</span>
        </div>
      </div>

      <h1 class="aw-section-title">
        <component :is="activeMeta.icon" :size="15" aria-hidden="true" />
        <span class="aw-section-name">{{ activeMeta.label }}</span>
        <span class="aw-section-sub">{{ activeMeta.desc }}</span>
      </h1>

      <button type="button" class="aw-jump" @click="openPalette">
        <Search :size="14" aria-hidden="true" />
        <span class="aw-jump-label">Jump to…</span>
        <kbd class="aw-kbd" aria-hidden="true">Ctrl K</kbd>
      </button>

      <button type="button" class="aw-sync" :disabled="overview.loading.value"
              title="Re-read the console counters" @click="overview.refresh()">
        <span class="aw-sync-label" aria-live="polite">
          {{ overview.loading.value ? 'Refreshing' : 'Refresh' }}
        </span>
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': overview.loading.value }" />
      </button>

      <ProfileDropdown
        role-label="IT Administrator"
        avatar-key="admin_avatar"
        @logout="handleLogout"
      />
    </header>

    <!-- A state, not an event: while this is on every other officer is being
         refused, and the person who can end it is reading this screen. -->
    <div v-if="maintenanceOn" class="aw-maint" role="status">
      <Wrench :size="15" aria-hidden="true" />
      <span>
        <strong>Maintenance mode is on.</strong>
        Every change to council records is being refused except yours.
      </span>
      <button type="button" class="aw-maint-go" @click="nav.go('settings')">Open settings</button>
    </div>

    <div class="aw-body">
      <nav v-if="!isMobile" id="aw-section-rail" class="aw-nav"
           :class="{ collapsed: railCollapsed }"
           aria-label="IT administration console sections">
        <template v-for="(s, i) in sections" :key="s.key">
          <span v-if="!railCollapsed && (i === 0 || sections[i - 1].group !== s.group)" class="aw-nav-group">
            {{ GROUP_LABELS[s.group] }}
          </span>
          <hr v-else-if="railCollapsed && i > 0 && sections[i - 1].group !== s.group" class="aw-nav-rule" />
          <button type="button"
                  class="aw-nav-item"
                  :class="{ active: activeSection === s.key }"
                  :aria-current="activeSection === s.key ? 'page' : undefined"
                  :title="railCollapsed ? s.label : undefined"
                  @click="nav.go(s.key)">
            <span class="aw-nav-icon">
              <component :is="s.icon" :size="16" aria-hidden="true" />
              <span v-if="railCollapsed && s.badge" class="aw-nav-dot" aria-hidden="true" />
            </span>
            <span v-if="!railCollapsed" class="aw-nav-label">{{ s.label }}</span>
            <span v-if="!railCollapsed && s.badge" class="aw-nav-badge">{{ s.badge > 99 ? '99+' : s.badge }}</span>
            <span class="ent-sr-only">
              <template v-if="railCollapsed">{{ s.label }}</template>
              <template v-if="s.badge">, {{ s.badge }} needing attention</template>
            </span>
          </button>
        </template>

        <p v-if="!railCollapsed" class="aw-nav-foot">
          Staff access &amp; configuration only. This console holds no planning data.
        </p>
      </nav>

      <main id="aw-main" ref="mainEl" class="aw-content"
            :class="{ 'ent-bottomnav-gap': isMobile }" tabindex="-1">
        <!-- A mount-time CSS animation, not <Transition mode="out-in">: out-in
             holds the new section back until the old one has finished leaving,
             which costs every switch a delay and strands the old section
             entirely if frames stop (a backgrounded tab). The swap is instant;
             only the arrival moves. -->
        <component :is="SECTION_COMPONENTS[activeSection]" :key="activeSection" class="aw-section" />
      </main>
    </div>

    <UiBottomNav
      v-if="isMobile"
      :items="sections"
      :model-value="activeSection"
      label="IT administration console sections"
      @update:model-value="nav.go($event as SectionKey)"
    />

    <UiSheet :open="paletteOpen" title="Jump to" subtitle="Sections and staff accounts" width="34rem"
             @close="paletteOpen = false" @update:open="paletteOpen = $event">
      <div class="aw-pal">
        <label class="ins-search">
          <Search :size="15" aria-hidden="true" />
          <span class="ent-sr-only">Search sections and staff</span>
          <input ref="paletteInput" v-model="paletteQuery" type="search"
                 placeholder="Section, officer name or email"
                 role="combobox" aria-controls="aw-pal-list" aria-expanded="true"
                 :aria-activedescendant="paletteItems[paletteIndex] ? `aw-pal-${paletteIndex}` : undefined"
                 @keydown="paletteKey" />
        </label>
        <ul id="aw-pal-list" class="aw-pal-list" role="listbox">
          <li v-for="(item, i) in paletteItems" :id="`aw-pal-${i}`" :key="item.id"
              role="option" :aria-selected="i === paletteIndex"
              class="aw-pal-item" :class="{ on: i === paletteIndex }"
              @mouseenter="paletteIndex = i" @click="runPalette(item)">
            <component :is="item.icon" :size="15" aria-hidden="true" />
            <span class="aw-pal-text">
              <strong>{{ item.title }}</strong>
              <small>{{ item.meta }}</small>
            </span>
            <CornerDownLeft v-if="i === paletteIndex" :size="13" class="aw-pal-enter" aria-hidden="true" />
          </li>
          <li v-if="!paletteItems.length" class="aw-pal-empty">
            Nothing matches “{{ paletteQuery }}”. Staff are searched by name, email and role.
          </li>
        </ul>
      </div>
    </UiSheet>

    <!-- The counters failing is not the same as there being nothing to count:
         a silent zero on a security overview is the one number nobody should
         ever be shown without knowing it is real. -->
    <div v-if="overview.error.value" class="aw-toast" role="alert">
      <AlertTriangle :size="15" aria-hidden="true" />
      <span>{{ overview.error.value }}</span>
      <button type="button" @click="overview.refresh()">Retry</button>
    </div>
  </div>
</template>

<style scoped>
/* Tokens: src/styles/enterprise.css. Primitives: views/inspector/inspector.css.
   This file styles only the chrome — every section renders on ins-* and the
   --ent-* UI kit, so the console cannot drift from the other staff consoles. */

.aw-root { display:flex; flex-direction:column; height:var(--ent-vh);
  background:var(--ent-canvas); color:var(--ent-text); font-family:var(--ent-font); }

.aw-skip {
  position:absolute; top:8px; left:8px; z-index:80;
  padding:var(--ent-s2) var(--ent-s3); background:var(--ent-surface); color:var(--ent-accent);
  border:1px solid var(--ent-accent); border-radius:var(--ent-r-sm);
  font-weight:var(--ent-fw-semibold); text-decoration:none; transform:translateY(-220%);
}
.aw-skip:focus-visible { transform:translateY(0); outline:2px solid var(--ent-accent); outline-offset:2px; }

/* ── Header ──────────────────────────────────────────────────────────── */
.aw-header { display:flex; align-items:center; gap:var(--ent-s3);
  min-height:var(--ent-topbar-h); padding:var(--ent-s2) var(--ent-s4);
  padding-left:calc(var(--ent-s4) + var(--ent-safe-left));
  padding-right:calc(var(--ent-s4) + var(--ent-safe-right));
  background:var(--ent-surface); border-bottom:1px solid var(--ent-line); flex-shrink:0; }
.aw-railbtn { width:var(--ent-control-h-sm); height:var(--ent-control-h-sm); }

.aw-brand { display:flex; align-items:center; gap:var(--ent-s2); min-width:0; }
.aw-mark { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:1.9rem; height:1.9rem; border-radius:var(--ent-r);
  background:var(--ent-accent); color:var(--ent-text-on-accent); }
.aw-brand-text { min-width:0; }
.aw-title { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-bold); line-height:1.15; white-space:nowrap; }
.aw-sub { display:block; font-size:var(--ent-fs-micro); color:var(--ent-text-3); white-space:nowrap; }

.aw-section-title { flex:1; min-width:0; display:flex; align-items:center; gap:var(--ent-s2);
  margin:0 0 0 var(--ent-s2); padding-left:var(--ent-s4); border-left:1px solid var(--ent-line);
  font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.aw-section-name { flex-shrink:0; }
.aw-section-sub { color:var(--ent-text-3); font-weight:var(--ent-fw-normal); font-size:var(--ent-fs-xs);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.aw-section-sub::before { content:'— '; }

.aw-jump { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h-sm); padding:0 var(--ent-s2) 0 var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); color:var(--ent-text-3);
  background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:var(--ent-r);
  cursor:pointer; transition:border-color var(--ent-dur) var(--ent-ease), color var(--ent-dur) var(--ent-ease); }
.aw-jump:hover { border-color:var(--ent-line-strong); color:var(--ent-text-2); }
.aw-jump:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.aw-kbd { font-family:var(--ent-font-mono); font-size:var(--ent-fs-micro); color:var(--ent-text-3);
  padding:1px 5px; border:1px solid var(--ent-line); border-radius:var(--ent-r-sm); background:var(--ent-surface); }

.aw-sync { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h-sm); padding:0 var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-medium);
  color:var(--ent-text-2); background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-pill); cursor:pointer; white-space:nowrap;
  transition:background-color var(--ent-dur) var(--ent-ease); }
.aw-sync:hover:not(:disabled) { background:var(--ent-surface-2); }
.aw-sync:disabled { opacity:0.7; cursor:progress; }
.aw-sync:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

/* ── Maintenance bar ─────────────────────────────────────────────────── */
.aw-maint { display:flex; align-items:center; gap:var(--ent-s3);
  padding:var(--ent-s2) var(--ent-s4); flex-shrink:0;
  font-size:var(--ent-fs-sm); color:var(--ent-tone-warning-fg);
  background:var(--ent-tone-warning-bg); border-bottom:1px solid var(--ent-tone-warning-line); }
.aw-maint > svg { flex-shrink:0; }
.aw-maint > span { flex:1; min-width:0; }
.aw-maint-go { flex-shrink:0; min-height:var(--ent-control-h-sm); padding:0 var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold);
  color:var(--ent-tone-warning-fg); background:var(--ent-surface);
  border:1px solid var(--ent-tone-warning-line); border-radius:var(--ent-r); cursor:pointer; }
.aw-maint-go:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

/* ── Rail ────────────────────────────────────────────────────────────── */
.aw-body { flex:1; min-height:0; display:flex; overflow:hidden; }

.aw-nav { display:flex; flex-direction:column; gap:2px;
  width:var(--ent-rail-w); padding:var(--ent-s3) var(--ent-s2); background:var(--ent-surface);
  border-right:1px solid var(--ent-line); overflow-y:auto; flex-shrink:0; }
.aw-nav.collapsed { width:var(--ent-rail-w-collapsed); align-items:center; }

.aw-nav-group { display:block; padding:var(--ent-s3) var(--ent-s3) var(--ent-s1);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); letter-spacing:0.06em;
  text-transform:uppercase; color:var(--ent-text-3); }
.aw-nav-group:first-child { padding-top:0; }
.aw-nav-rule { width:60%; margin:var(--ent-s2) auto; border:0; border-top:1px solid var(--ent-line); }

.aw-nav-item { position:relative; display:flex; align-items:center; gap:var(--ent-s3);
  width:100%; min-height:var(--ent-control-h); padding:0 var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  background:none; border:1px solid transparent; border-radius:var(--ent-r);
  color:var(--ent-text-2); text-align:left; cursor:pointer;
  transition:background-color var(--ent-dur) var(--ent-ease), color var(--ent-dur) var(--ent-ease); }
.aw-nav.collapsed .aw-nav-item { width:var(--ent-control-h); padding:0; justify-content:center; }
.aw-nav-item:hover { background:var(--ent-surface-2); color:var(--ent-text); }
.aw-nav-item:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
/* Tinted, not solid: the accent stays well under a tenth of the surface. */
.aw-nav-item.active { background:var(--ent-accent-soft); color:var(--ent-accent);
  border-color:var(--ent-accent-line); font-weight:var(--ent-fw-semibold); }
.aw-nav-icon { position:relative; display:inline-flex; flex-shrink:0; }
.aw-nav-dot { position:absolute; top:-2px; right:-3px; width:7px; height:7px; border-radius:50%;
  background:var(--ent-danger); box-shadow:0 0 0 2px var(--ent-surface); }
.aw-nav-label { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  animation:aw-rail-label var(--ent-dur) var(--ent-ease); }
@keyframes aw-rail-label { from { opacity:0; transform:translateX(-6px); } }
.aw-nav-badge { flex-shrink:0; min-width:1.35rem; padding:0 6px; text-align:center;
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); font-variant-numeric:tabular-nums;
  line-height:1.35rem; border-radius:var(--ent-r-pill);
  color:var(--ent-tone-negative-fg); background:var(--ent-tone-negative-bg); }
.aw-nav-item.active .aw-nav-badge { color:var(--ent-accent); background:var(--ent-surface); }

.aw-nav-foot { margin:auto 0 0; padding:var(--ent-s4) var(--ent-s3) var(--ent-s2);
  font-size:var(--ent-fs-micro); line-height:var(--ent-lh); color:var(--ent-text-3); }

.aw-content { flex:1; min-width:0; overflow-y:auto; background:var(--ent-canvas);
  -webkit-overflow-scrolling:touch; outline:none; }

/* Section arrival: a short rise and fade, on the compositor only. */
.aw-section { animation:aw-section-in var(--ent-dur-lg) var(--ent-ease) backwards; }
@keyframes aw-section-in { from { opacity:0; transform:translateY(6px); } }

/* ── Jump palette ────────────────────────────────────────────────────── */
.aw-pal { display:flex; flex-direction:column; gap:var(--ent-s3); }
.aw-pal-list { list-style:none; margin:0; padding:0; max-height:min(55vh, 26rem); overflow-y:auto; }
.aw-pal-item { display:flex; align-items:center; gap:var(--ent-s3);
  padding:var(--ent-s2) var(--ent-s3); border-radius:var(--ent-r); cursor:pointer; color:var(--ent-text-2); }
.aw-pal-item.on { background:var(--ent-accent-soft); color:var(--ent-accent); }
.aw-pal-text { flex:1; min-width:0; }
.aw-pal-text strong { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); color:var(--ent-text);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.aw-pal-text small { display:block; font-size:var(--ent-fs-xs); color:var(--ent-text-3);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.aw-pal-enter { color:var(--ent-accent); flex-shrink:0; }
.aw-pal-empty { padding:var(--ent-s5) var(--ent-s3); text-align:center; font-size:var(--ent-fs-sm); color:var(--ent-text-3); }

/* ── Counter failure ─────────────────────────────────────────────────── */
.aw-toast { position:fixed; left:50%; bottom:var(--ent-s5); transform:translateX(-50%);
  z-index:var(--ent-z-toast); display:flex; align-items:center; gap:var(--ent-s3);
  max-width:min(92vw, 34rem); padding:var(--ent-s3) var(--ent-s4);
  font-size:var(--ent-fs-sm); color:var(--ent-tone-negative-fg);
  background:var(--ent-surface); border:1px solid var(--ent-tone-negative-line);
  border-radius:var(--ent-r-md); box-shadow:var(--ent-e3);
  animation:aw-toast-in var(--ent-dur-lg) var(--ent-ease) backwards; }
@keyframes aw-toast-in { from { opacity:0; transform:translate(-50%, 10px); } }
.aw-toast > span { flex:1; min-width:0; }
.aw-toast button { flex-shrink:0; font-family:var(--ent-font); font-size:var(--ent-fs-xs);
  font-weight:var(--ent-fw-semibold); color:var(--ent-accent);
  background:none; border:0; cursor:pointer; text-decoration:underline; }

@media (max-width: 1279px) { .aw-section-sub { display:none; } }
@media (max-width: 1023px) { .aw-jump-label, .aw-kbd { display:none; } }
@media (max-width: 767px) {
  .aw-section-title { margin-left:0; padding-left:0; border-left:none; font-size:var(--ent-fs-md); }
  .aw-brand-text, .aw-sync-label { display:none; }
  /* The jump palette is a keyboard affordance and there is no Ctrl K on a
     phone; the bottom bar is the navigation there. Removing it gives the
     section title back the width it needs to be readable. */
  .aw-jump { display:none; }
  .aw-maint { font-size:var(--ent-fs-xs); }
}
@media (prefers-reduced-motion: reduce) {
  .aw-section, .aw-nav-label, .aw-toast { animation:none; }
}
</style>
