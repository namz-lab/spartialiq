<script setup lang="ts">
// Console preferences — this device only.
//
// WHAT IS OFFERED HERE AND WHAT IS NOT
// Four settings, and each one changes real behaviour the clerk notices every
// day. Nothing the SERVER enforces appears on this screen: the five-working-
// day rule, the seven-day rule and the three-month determination period are
// statute, they are computed in the database, and a desk that could change
// them would be a desk that could quietly move a deadline the council is held
// to. A preference that only records an intention is worse than none.
//
// DEVICE, NOT COUNCIL RECORD
// Stored in this browser's localStorage. A colleague borrowing the machine
// gets the safe defaults rather than someone else's landing screen, and
// nothing here travels to another desk.

import { computed } from 'vue'
import { useClerkNav, useClerkPreferences } from '@/planning-clerk/useClerkConsole'
import {
  LANDING_CHOICES, HORIZON_CHOICES, DEFAULT_PREFERENCES,
  type SectionKey, type Currency,
} from '@/planning-clerk/console'
import UiButton from '@/components/ui/UiButton.vue'
import { Settings2, Info, RotateCcw, Link2 } from 'lucide-vue-next'

const nav = useClerkNav()
const { prefs, set } = useClerkPreferences()

const SECTION_LABEL: Record<string, string> = {
  dashboard: 'Today at the counter',
  search: 'Find a file',
  receipt: 'Application receipt',
  deadlines: 'Statutory deadlines',
  register: 'Development Register',
  correspondence: 'Correspondence',
  fees: 'Fees & cashbook',
}

function reset() {
  set('landingSection', DEFAULT_PREFERENCES.landingSection)
  set('railCollapsed', DEFAULT_PREFERENCES.railCollapsed)
  set('deadlineHorizonDays', DEFAULT_PREFERENCES.deadlineHorizonDays)
  set('counterCurrency', DEFAULT_PREFERENCES.counterCurrency)
}

const isDefault = computed(() =>
  prefs.value.landingSection === DEFAULT_PREFERENCES.landingSection
  && prefs.value.railCollapsed === DEFAULT_PREFERENCES.railCollapsed
  && prefs.value.deadlineHorizonDays === DEFAULT_PREFERENCES.deadlineHorizonDays
  && prefs.value.counterCurrency === DEFAULT_PREFERENCES.counterCurrency)

/**
 * What a bare link to this console will now open.
 *
 * Shown because the landing preference and the URL contract are tied: a
 * section is omitted from the query when it IS the landing section, so
 * changing this changes what a link with no ?section= means. A clerk who
 * bookmarks the console should be able to see that.
 */
const bareLink = computed(() =>
  `/planning-clerk-portal — opens ${SECTION_LABEL[prefs.value.landingSection]
    ?? prefs.value.landingSection}`)
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">This device</span>
        <h2 class="ins-title">Console preferences</h2>
        <p class="ins-lede">
          How this console behaves on this machine. Nothing here is council
          record, and nothing here changes a statutory rule.
        </p>
      </div>
      <div class="ins-actions">
        <UiButton size="sm" variant="ghost" :disabled="isDefault" @click="reset">
          <template #icon><RotateCcw :size="14" /></template>
          Reset to defaults
        </UiButton>
      </div>
    </header>

    <section class="ins-card">
      <header class="ins-card-head">
        <h3><Settings2 :size="15" aria-hidden="true" /> Where the console opens</h3>
      </header>
      <div class="ins-card-body clk-pref">
        <div class="ins-field">
          <label class="ins-label" for="clk-pref-landing">Landing section</label>
          <select id="clk-pref-landing" class="ins-input"
                  :value="prefs.landingSection"
                  @change="set('landingSection', ($event.target as HTMLSelectElement).value as SectionKey)">
            <option v-for="k in LANDING_CHOICES" :key="k" :value="k">
              {{ SECTION_LABEL[k] ?? k }}
            </option>
          </select>
          <p class="ins-hint">
            A clerk who spends the day at the counter may prefer to open on
            Find a file rather than on the dashboard.
          </p>
        </div>

        <p class="ins-banner t-info">
          <Link2 :size="15" aria-hidden="true" />
          <span>
            <strong>This also changes what a plain link means.</strong>
            A link with no section in it opens your landing section, so
            <span class="ins-mono">{{ bareLink }}</span>.
            Links you copy out of the address bar while inside another section
            still carry that section and are unaffected.
          </span>
        </p>

        <label class="ins-check clk-pref-check" :class="{ on: prefs.railCollapsed }">
          <input type="checkbox" :checked="prefs.railCollapsed"
                 @change="set('railCollapsed', ($event.target as HTMLInputElement).checked)" />
          <span>
            <strong>Start with the section rail collapsed</strong>
            <small>
              Icons only, giving the register tables their full width. The
              toggle in the header still overrides it for the session, and a
              tablet starts collapsed regardless.
            </small>
          </span>
        </label>
      </div>
    </section>

    <section class="ins-card">
      <header class="ins-card-head">
        <h3>At the counter</h3>
      </header>
      <div class="ins-card-body clk-pref">
        <div class="ins-field">
          <span class="ins-label" id="clk-pref-ccy">Default receipt currency</span>
          <div class="ins-seg" role="radiogroup" aria-labelledby="clk-pref-ccy">
            <button v-for="c in (['USD', 'ZWG'] as Currency[])" :key="c" type="button"
                    role="radio" :aria-checked="prefs.counterCurrency === c"
                    @click="set('counterCurrency', c)">
              {{ c }}
            </button>
          </div>
          <p class="ins-hint">
            Which currency the receipt form opens on. Both are always
            available — this only saves re-picking the usual one forty times
            a day. The amount itself is never converted.
          </p>
        </div>

        <div class="ins-field">
          <span class="ins-label" id="clk-pref-horizon">Deadline horizon</span>
          <div class="ins-seg" role="radiogroup" aria-labelledby="clk-pref-horizon">
            <button v-for="days in HORIZON_CHOICES" :key="days" type="button"
                    role="radio" :aria-checked="prefs.deadlineHorizonDays === days"
                    @click="set('deadlineHorizonDays', days)">
              {{ days }} days
            </button>
          </div>
          <p class="ins-hint">
            How far ahead the deadline board and the dashboard look. Anything
            already past its date is always shown, whatever this is set to.
          </p>
        </div>
      </div>
    </section>

    <section class="ins-card">
      <header class="ins-card-head">
        <h3><Info :size="15" aria-hidden="true" /> What is not here</h3>
      </header>
      <div class="ins-card-body">
        <p class="ins-lede clk-pref-why">
          The acknowledgement period, the refusal period and the three-month
          determination clock are statute. They are computed by the server and
          cannot be changed from a desk — a console that let one officer
          quietly move a deadline the council is answerable for would not be
          worth the deadline. Fee amounts, user accounts and role permissions
          are the same: they belong to the council, not to this machine, and
          they are set in the IT Administration console.
        </p>
        <UiButton size="sm" variant="ghost" @click="nav.go('deadlines')">
          Open the deadline board
        </UiButton>
      </div>
    </section>
  </div>
</template>

<style scoped>
.clk-pref { display:flex; flex-direction:column; gap:var(--ent-s4); }
.clk-pref-check { cursor:pointer; }
.clk-pref-why { max-width:70ch; margin:0 0 var(--ent-s3); }
</style>
