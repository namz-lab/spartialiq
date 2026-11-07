<script setup lang="ts">
// Console preferences — how this console behaves on this machine.
//
// THREE PREFERENCES, AND THE TEST FOR ADMITTING A FOURTH
// Each one has to change real behaviour somewhere. A preference that only
// moves a thing around is a way of avoiding a decision about where the thing
// belongs, and a settings screen full of them is how a console stops having an
// opinion.
//
// THIS DEVICE, NOT THE COUNCIL RECORD
// These live in this browser's storage. A colleague borrowing the machine gets
// the safe defaults rather than someone else's habits, and nothing here is
// audited because nothing here affects anybody else.
//
// WHAT IS DELIBERATELY NOT OFFERED HERE
// Anything the server enforces. The lockout threshold, the password minimum
// and the audit retention period are council POLICY: they belong in System
// settings, where they are one value for the whole council and every change is
// attributed. Offering a per-device copy of a server-enforced value would let
// an administrator believe they had changed something they had not.

import { computed } from 'vue'
import { useAdminPreferences, useAdminNav } from '@/admin/useAdminConsole'
import {
  AUDIT_WINDOW_CHOICES, LANDING_CHOICES, DEFAULT_PREFERENCES, type SectionKey,
} from '@/admin/console'
import { Settings2, ShieldCheck, RotateCcw, Info } from 'lucide-vue-next'

const { prefs, set } = useAdminPreferences()
const nav = useAdminNav()

const SECTION_LABELS: Partial<Record<SectionKey, string>> = {
  overview: 'Overview',
  employees: 'Employee accounts',
  audit: 'Audit trail',
  sessions: 'Active sessions',
  signin: 'Sign-in security',
  health: 'System health',
  jobs: 'Email & jobs',
}

const isDefault = computed(() =>
  prefs.value.landingSection === DEFAULT_PREFERENCES.landingSection
  && prefs.value.railCollapsed === DEFAULT_PREFERENCES.railCollapsed
  && prefs.value.auditWindowDays === DEFAULT_PREFERENCES.auditWindowDays)

function reset() {
  set('landingSection', DEFAULT_PREFERENCES.landingSection)
  set('railCollapsed', DEFAULT_PREFERENCES.railCollapsed)
  set('auditWindowDays', DEFAULT_PREFERENCES.auditWindowDays)
}
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">This device</span>
        <h2 class="ins-title">Console preferences</h2>
        <p class="ins-lede">
          How this console behaves on this machine. Stored in this browser only —
          a colleague signing in here gets the defaults, not your settings.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="pr-btn" :disabled="isDefault" @click="reset">
          <RotateCcw :size="14" aria-hidden="true" /> Reset to defaults
        </button>
      </div>
    </header>

    <section class="ins-card">
      <div class="ins-card-head"><h3><Settings2 :size="15" aria-hidden="true" /> Preferences</h3></div>
      <div class="ins-card-body pr-body">

        <!-- ── Landing section ──────────────────────────────────────── -->
        <div class="pr-row">
          <div class="pr-label">
            <span class="ins-label">Where a bare /admin link lands</span>
            <p class="ins-hint">
              An administrator who spends the week on sign-in incidents should not have
              to walk past the overview every morning. A link that names a section still
              wins — the link is the more specific instruction.
            </p>
          </div>
          <div class="pr-control">
            <div class="ins-chips">
              <button v-for="key in LANDING_CHOICES" :key="key" type="button"
                      class="ins-chip" :aria-pressed="prefs.landingSection === key"
                      @click="set('landingSection', key)">
                {{ SECTION_LABELS[key] ?? key }}
              </button>
            </div>
          </div>
        </div>

        <!-- ── Rail ─────────────────────────────────────────────────── -->
        <div class="pr-row">
          <div class="pr-label">
            <span class="ins-label">Section menu</span>
            <p class="ins-hint">
              Whether the rail starts collapsed to icons. On a tablet it starts collapsed
              regardless, because there is room for the rail and not for the labels; the
              toggle in the header overrides either for the current session.
            </p>
          </div>
          <div class="pr-control">
            <div class="ins-seg" role="radiogroup" aria-label="Section menu">
              <button type="button" role="radio" :aria-checked="!prefs.railCollapsed"
                      @click="set('railCollapsed', false)">Labels</button>
              <button type="button" role="radio" :aria-checked="prefs.railCollapsed"
                      @click="set('railCollapsed', true)">Icons only</button>
            </div>
          </div>
        </div>

        <!-- ── Audit window ─────────────────────────────────────────── -->
        <div class="pr-row">
          <div class="pr-label">
            <span class="ins-label">How far back the logs open on</span>
            <p class="ins-hint">
              Applies to the audit trail and the sign-in log. A longer window is a
              heavier query on a rural link, so this is the starting point, not a limit —
              the filters on each screen reach further whenever you need them to.
            </p>
          </div>
          <div class="pr-control">
            <div class="ins-seg" role="radiogroup" aria-label="Log window">
              <button v-for="days in AUDIT_WINDOW_CHOICES" :key="days" type="button" role="radio"
                      :aria-checked="prefs.auditWindowDays === days"
                      @click="set('auditWindowDays', days)">
                {{ days === 1 ? '24 hours' : `${days} days` }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- The boundary between a device preference and council policy, stated
         where somebody looking for the wrong one would look. -->
    <p class="pr-boundary">
      <ShieldCheck :size="15" aria-hidden="true" />
      <span>
        Security policy is not here. The password minimum, the lockout threshold, the
        session lifetime and the audit retention period are one value for the whole
        council, enforced by the server and recorded when changed — they live in
        <button type="button" class="pr-link" @click="nav.go('settings')">System settings</button>.
      </span>
    </p>

    <p class="pr-storage">
      <Info :size="15" aria-hidden="true" />
      <span>
        These three are kept in this browser's local storage. Clearing site data, or
        opening the console in a private window, returns them to the defaults — nothing
        is lost that matters.
      </span>
    </p>
  </div>
</template>

<style scoped>
.pr-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r); cursor:pointer; }
.pr-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.pr-btn:disabled { opacity:0.5; cursor:not-allowed; }
.pr-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.pr-body { display:flex; flex-direction:column; }
.pr-row { display:grid; grid-template-columns:minmax(0, 1.3fr) minmax(0, 1fr);
  gap:var(--ent-s4); padding:var(--ent-s4) 0; border-top:1px solid var(--ent-line); }
.pr-row:first-child { border-top:0; padding-top:0; }
.pr-label { min-width:0; }
.pr-control { min-width:0; display:flex; align-items:flex-start; }
.pr-control > * { max-width:100%; }

.pr-boundary, .pr-storage { display:flex; align-items:flex-start; gap:var(--ent-s2);
  margin:0; padding:var(--ent-s4); max-width:80ch;
  font-size:var(--ent-fs-sm); line-height:var(--ent-lh); color:var(--ent-text-2);
  background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:var(--ent-r-md); }
.pr-boundary > svg, .pr-storage > svg { flex-shrink:0; margin-top:2px; color:var(--ent-text-3); }

.pr-link { font-family:var(--ent-font); font-size:inherit; color:var(--ent-accent);
  background:none; border:0; padding:0; cursor:pointer; text-decoration:underline;
  font-weight:var(--ent-fw-medium); }
.pr-link:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); border-radius:2px; }

@media (max-width: 767px) {
  .pr-row { grid-template-columns:1fr; gap:var(--ent-s2); }
}
</style>
