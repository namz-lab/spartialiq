<template>
  <!--
    Detail card that pops up when the citizen taps a stand on the map.
    Shows: stand metadata, planning-assistant suggestion, permitted uses,
    plot-fit flags. Primary action is "Apply for this stand" which routes
    to /citizen?section=new&stand=<id>; the Citizen Portal new-application
    wizard reads the stand from the URL and pre-fills the parcel block.
  -->
  <aside class="stand-card" role="dialog" :aria-label="title">
    <header class="stand-card-head">
      <p class="stand-eyebrow">{{ stand.status === 'available' ? 'Available' : prettyStatus }}</p>
      <h3 class="stand-title">Stand {{ stand.standNumber }}</h3>
      <p class="stand-sub">Ward {{ stand.ward }}<span v-if="stand.zoneType"> · {{ stand.zoneType }}</span></p>
      <button
        type="button"
        class="stand-close"
        aria-label="Close"
        @click="$emit('close')"
      >
        <X :size="14" aria-hidden="true" />
      </button>
    </header>

    <dl class="stand-grid">
      <div>
        <dt>Area</dt>
        <dd>{{ formatArea(stand.areaSqm) }}</dd>
      </div>
      <div v-if="stand.frontageM != null">
        <dt>Frontage</dt>
        <dd>{{ stand.frontageM }} m</dd>
      </div>
      <div v-if="stand.depthM != null">
        <dt>Depth</dt>
        <dd>{{ stand.depthM }} m</dd>
      </div>
      <div v-if="stand.priceUsd != null">
        <dt>Price</dt>
        <dd>{{ formatUsd(stand.priceUsd) }}</dd>
      </div>
    </dl>

    <!-- Suggested plan, computed by the rules engine. -->
    <section v-if="suggested?.template" class="stand-suggest">
      <p class="stand-suggest-eyebrow">Suggested plan</p>
      <p class="stand-suggest-title">{{ suggested.template.displayName }}</p>
      <p class="stand-suggest-desc">{{ suggested.template.description }}</p>

      <ul class="stand-suggest-list" v-if="envelopeRows.length">
        <li v-for="row in envelopeRows" :key="row.label">
          <span>{{ row.label }}</span>
          <strong>{{ row.value }}</strong>
        </li>
      </ul>

      <p
        v-if="suggested.template.maxBuildableFootprintSqm != null"
        class="stand-suggest-foot"
      >
        Maximum buildable footprint:
        <strong>{{ suggested.template.maxBuildableFootprintSqm }} m²</strong>
      </p>

      <p v-if="suggested.template.sourceCitation" class="stand-suggest-cite">
        {{ suggested.template.sourceCitation }}
      </p>
    </section>

    <!-- Permitted / special-consent / prohibited uses. -->
    <section v-if="suggested?.permittedUses?.length" class="stand-uses">
      <p class="stand-uses-eyebrow">What can be developed here</p>
      <ul class="stand-uses-list">
        <li
          v-for="u in suggested.permittedUses"
          :key="u.groupCode"
          :class="['stand-use', `stand-use--${u.decision}`]"
        >
          <span class="stand-use-dot" :data-decision="u.decision" aria-hidden="true" />
          <span class="stand-use-name">{{ u.groupName }}</span>
          <span class="stand-use-decision">{{ decisionLabel(u.decision) }}</span>
        </li>
      </ul>
    </section>

    <!-- Plot-fit warnings. -->
    <ul v-if="suggested?.flags?.length" class="stand-flags">
      <li
        v-for="f in suggested.flags"
        :key="f.code"
        :class="['stand-flag', `stand-flag--${f.severity}`]"
      >
        <AlertTriangle :size="12" aria-hidden="true" />
        {{ f.message }}
      </li>
    </ul>

    <footer class="stand-actions">
      <router-link
        v-if="stand.status === 'available'"
        :to="{ path: '/citizen', query: { section: 'new', stand: stand.id } }"
        class="stand-cta"
      >
        Apply for this stand
        <ArrowRight :size="14" aria-hidden="true" />
      </router-link>
      <p v-else class="stand-not-available">
        This stand is not currently available.
      </p>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed, type PropType } from 'vue'
import { ArrowRight, AlertTriangle, X } from 'lucide-vue-next'
import type { StandDetail, SuggestedPlan } from '../../services/standsService'

const props = defineProps({
  stand:     { type: Object as PropType<StandDetail>,           required: true },
  suggested: { type: Object as PropType<SuggestedPlan | null>,  default: null },
})
defineEmits(['close'])

const title = computed(() => `Stand ${props.stand.standNumber}`)
const prettyStatus = computed(() => {
  const s = props.stand.status
  return s.charAt(0).toUpperCase() + s.slice(1)
})

function formatArea(sqm: number | null): string {
  if (sqm == null) return '—'
  if (sqm >= 10000) return `${(sqm / 10000).toFixed(2)} ha`
  return `${sqm.toLocaleString('en-GB')} m²`
}

function formatUsd(v: number): string {
  return `US$ ${v.toLocaleString('en-GB')}`
}

function decisionLabel(d: string): string {
  switch (d) {
    case 'permitted':       return 'Permitted'
    case 'special_consent': return 'Special consent'
    case 'prohibited':      return 'Prohibited'
    default:                return 'Unknown'
  }
}

const envelopeRows = computed(() => {
  const t = props.suggested?.template
  if (!t) return []
  const rows: Array<{ label: string; value: string }> = []
  const e = t.envelope
  if (e.maxPlotCoveragePct != null) rows.push({ label: 'Max plot coverage', value: `${e.maxPlotCoveragePct} %` })
  if (e.maxFloorAreaRatio  != null) rows.push({ label: 'Max FAR',           value: `${e.maxFloorAreaRatio}` })
  if (e.maxHeightM         != null) rows.push({ label: 'Max height',        value: `${e.maxHeightM} m` })
  if (e.maxStoreys         != null) rows.push({ label: 'Max storeys',       value: `${e.maxStoreys}` })
  if (e.setbackFrontM      != null) rows.push({ label: 'Front setback',     value: `${e.setbackFrontM} m` })
  if (e.setbackRearM       != null) rows.push({ label: 'Rear setback',      value: `${e.setbackRearM} m` })
  if (e.setbackSideM       != null) rows.push({ label: 'Side setback',      value: `${e.setbackSideM} m` })
  return rows
})
</script>

<style scoped>
.stand-card {
  width: min(28rem, 100%);
  background: #ffffff;
  border: 1px solid #e2e6ec;
  border-radius: 12px;
  padding: 1.25rem 1.25rem 1rem;
  box-shadow: 0 18px 42px -16px rgba(11, 18, 32, 0.25);
  font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
  color: #0b1220;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.stand-card-head {
  position: relative;
  padding-right: 2rem;
}

.stand-eyebrow {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #1e6b4a;
  margin: 0 0 0.25rem;
}

.stand-title {
  font-family: 'Fraunces', ui-serif, Georgia, serif;
  font-weight: 600;
  font-size: 1.35rem;
  letter-spacing: -0.01em;
  margin: 0;
}

.stand-sub {
  margin: 0.15rem 0 0;
  font-size: 0.8125rem;
  color: #5b6473;
}

.stand-close {
  position: absolute;
  top: 0;
  right: 0;
  width: 1.75rem;
  height: 1.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid #dde1e8;
  border-radius: 6px;
  color: #5b6473;
  cursor: pointer;
  transition: background-color 160ms cubic-bezier(0.23, 1, 0.32, 1),
              color 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.stand-close:hover  { background: #f7f8fa; color: #0b1220; }
.stand-close:active { transform: scale(0.985); }

/* ── Stand metadata grid ─────────────────────────────────────────── */
.stand-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem 1rem;
  margin: 0;
  padding: 0.5rem 0;
  border-top: 1px solid #eef0f4;
  border-bottom: 1px solid #eef0f4;
}
.stand-grid div { margin: 0; }
.stand-grid dt {
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #8e96a4;
  margin: 0;
}
.stand-grid dd {
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.85rem;
  color: #0b1220;
  margin: 0.1rem 0 0;
}

/* ── Suggested plan ──────────────────────────────────────────────── */
.stand-suggest {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.stand-suggest-eyebrow {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #5b6473;
  margin: 0;
}

.stand-suggest-title {
  font-family: 'Fraunces', ui-serif, Georgia, serif;
  font-weight: 600;
  font-size: 1.05rem;
  margin: 0;
}

.stand-suggest-desc {
  font-size: 0.85rem;
  line-height: 1.55;
  color: #404a59;
  margin: 0 0 0.25rem;
  max-width: 52ch;
}

.stand-suggest-list {
  list-style: none;
  margin: 0;
  padding: 0.5rem 0;
  border-top: 1px solid #eef0f4;
  border-bottom: 1px solid #eef0f4;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem 0.75rem;
}
.stand-suggest-list li {
  display: flex;
  justify-content: space-between;
  font-size: 0.78rem;
  color: #404a59;
  font-family: 'Geist Mono', ui-monospace, monospace;
}
.stand-suggest-list strong {
  font-weight: 600;
  color: #0b1220;
}

.stand-suggest-foot {
  margin: 0;
  font-size: 0.825rem;
  color: #404a59;
}
.stand-suggest-foot strong { color: #1e6b4a; font-weight: 600; }

.stand-suggest-cite {
  font-size: 0.7rem;
  color: #8e96a4;
  font-style: italic;
  margin: 0;
}

/* ── Permitted uses ──────────────────────────────────────────────── */
.stand-uses-eyebrow {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #5b6473;
  margin: 0 0 0.4rem;
}

.stand-uses-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.stand-use {
  display: grid;
  grid-template-columns: 12px 1fr auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  font-size: 0.825rem;
}
.stand-use:hover { background: #f7f8fa; }

.stand-use-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.stand-use-dot[data-decision="permitted"]       { background: #1e6b4a; }
.stand-use-dot[data-decision="special_consent"] { background: #b54708; }
.stand-use-dot[data-decision="prohibited"]      { background: #b42318; }
.stand-use-dot[data-decision="unknown"]         { background: #c0c6d1; }

.stand-use-decision {
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #5b6473;
}

/* ── Flags ───────────────────────────────────────────────────────── */
.stand-flags {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.stand-flag {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
}
.stand-flag--info    { color: #404a59; background: #f7f8fa; }
.stand-flag--warning { color: #93390a; background: #fef7e6; border: 1px solid #fdecc4; }
.stand-flag--error   { color: #9a1c12; background: #fef3f2; border: 1px solid #fcd9d4; }

/* ── Action ──────────────────────────────────────────────────────── */
.stand-actions { margin-top: 0.25rem; }

.stand-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  width: 100%;
  height: 2.5rem;
  background: #0b1220;
  color: #ffffff;
  font: 600 0.875rem/1 inherit;
  letter-spacing: 0.01em;
  border-radius: 8px;
  border: 1px solid #0b1220;
  text-decoration: none;
  cursor: pointer;
  transition: background-color 160ms cubic-bezier(0.23, 1, 0.32, 1),
              transform 100ms cubic-bezier(0.23, 1, 0.32, 1),
              box-shadow 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.stand-cta:hover  { background: #1a1f29; box-shadow: 0 6px 16px -8px rgba(11, 18, 32, 0.4); }
.stand-cta:active { transform: scale(0.985); }

.stand-not-available {
  font-size: 0.825rem;
  color: #5b6473;
  text-align: center;
  margin: 0;
  padding: 0.6rem;
  border: 1px dashed #dde1e8;
  border-radius: 8px;
}
</style>
