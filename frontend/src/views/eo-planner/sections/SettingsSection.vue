<script setup lang="ts">
// Settings — how this console behaves on this device.
//
// Three settings, and each one changes something real. What is NOT here is as
// deliberate: the 90-day determination period, the 28-day appeal window and
// the five tests for a condition are the Act's, not the council's, and a
// console that let an officer edit them would be offering to break the law
// from a preferences screen.
//
// Device preferences, not council record: a colleague borrowing the machine
// gets the safe defaults rather than someone else's.

import { computed } from 'vue'
import { useEoPreferences } from '@/eo-planner/useEoPreferences'
import {
  CLOCK_WARNING_CHOICES, LANDING_SECTIONS, DEFAULT_EO_PREFERENCES,
  type LandingSection,
} from '@/eo-planner/console'
import { Settings, RotateCcw, Info } from 'lucide-vue-next'
import '@/views/inspector/inspector.css'

const { prefs, set, reset } = useEoPreferences()

const LANDING_LABELS: Record<LandingSection, string> = {
  dashboard: 'Dashboard — the clock and the queues',
  register: 'Applications — the development register',
  appeals: 'Appeals — the s.38 register',
  enforcement: 'Enforcement — open orders',
  reports: 'Reports — returns and statistics',
}

const isDefault = computed(() =>
  prefs.value.landingSection === DEFAULT_EO_PREFERENCES.landingSection
  && prefs.value.railCollapsed === DEFAULT_EO_PREFERENCES.railCollapsed
  && prefs.value.clockWarningDays === DEFAULT_EO_PREFERENCES.clockWarningDays)
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">This device</span>
        <h2 class="ins-title"><Settings :size="18" aria-hidden="true" /> Settings</h2>
        <p class="ins-lede">
          These choices live on this computer only. They change how the console opens and
          how early it starts warning you — never what the Act requires.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="ins-iconbtn" :disabled="isDefault"
                title="Restore the defaults" @click="reset">
          <RotateCcw :size="15" aria-hidden="true" />
          <span class="ent-sr-only">Restore the defaults</span>
        </button>
      </div>
    </header>

    <section class="ins-card">
      <header class="ins-card-head"><h3>Opening</h3></header>
      <div class="ins-card-body st-stack">
        <label class="ins-field">
          <span class="ins-label">Land on</span>
          <select class="ins-input" :value="prefs.landingSection"
                  @change="set('landingSection', ($event.target as HTMLSelectElement).value as LandingSection)">
            <option v-for="s in LANDING_SECTIONS" :key="s" :value="s">{{ LANDING_LABELS[s] }}</option>
          </select>
          <p class="ins-hint">
            Where a bare link to this console opens. A link that names a section still opens
            that section.
          </p>
        </label>

        <label class="st-toggle">
          <input type="checkbox" :checked="prefs.railCollapsed"
                 @change="set('railCollapsed', ($event.target as HTMLInputElement).checked)" />
          <span>
            <strong>Start with the section rail collapsed</strong>
            <small>Icons only, for a narrow screen or a second monitor. The toggle in the
              header still overrides this for the current session.</small>
          </span>
        </label>
      </div>
    </section>

    <section class="ins-card">
      <header class="ins-card-head"><h3>The statutory clock</h3></header>
      <div class="ins-card-body st-stack">
        <fieldset class="st-fieldset">
          <legend class="ins-label">Start warning me this long before a case is deemed refused</legend>
          <div class="ins-seg" role="radiogroup" aria-label="Warning window">
            <button v-for="d in CLOCK_WARNING_CHOICES" :key="d" type="button"
                    role="radio" :aria-checked="prefs.clockWarningDays === d"
                    @click="set('clockWarningDays', d)">
              {{ d }} days
            </button>
          </div>
          <p class="ins-hint">
            Used by the dashboard, the rail and the case bar. The three months themselves are
            section 26(7) and are not adjustable — this is only how much notice this council
            wants, which depends on how often your committee sits.
          </p>
        </fieldset>

        <p class="ins-banner t-info">
          <Info :size="16" aria-hidden="true" />
          <span>
            <strong>Fixed by statute, and not settings.</strong>
            The three-month determination period (s.26(7); four for a subdivision, s.40(6)), the one-month appeal window (s.38) and the
            five tests a condition must pass are the same in every council and are enforced by
            the server, not by this screen.
          </span>
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.st-stack { display:flex; flex-direction:column; gap:var(--ent-s5); }
.st-fieldset { margin:0; padding:0; border:0; display:flex; flex-direction:column; gap:var(--ent-s2); }
.st-toggle { display:flex; align-items:flex-start; gap:var(--ent-s3); cursor:pointer; }
.st-toggle input { width:18px; height:18px; margin-top:2px; accent-color:var(--ent-accent); flex-shrink:0; }
.st-toggle strong { display:block; font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold);
  color:var(--ent-text); }
.st-toggle small { display:block; margin-top:2px; font-size:var(--ent-fs-xs);
  color:var(--ent-text-2); line-height:var(--ent-lh); }
</style>
