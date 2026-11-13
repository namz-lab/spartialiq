<script setup lang="ts">
/**
 * The Cash Office's illustrations, drawn inline so a slow sub-office link downloads nothing:
 *   crest   the council shield, for the sidebar and the printed receipt
 *   seal    the round office stamp on a receipt
 *   side    the dusk landscape with an acacia under the sidebar
 *   banner  low hills along the foot of the top banner
 * All are decorative and hidden from assistive technology.
 */
withDefaults(defineProps<{ kind: 'crest' | 'seal' | 'side' | 'banner'; size?: number }>(), { size: 64 })
</script>

<template>
  <svg v-if="kind === 'crest'" :width="size" :height="size * 1.08" viewBox="0 0 100 108" aria-hidden="true" focusable="false">
    <!-- crown -->
    <path d="M30 18 L36 6 L43 15 L50 3 L57 15 L64 6 L70 18 Z" fill="#f2c230" stroke="#a87800" stroke-width="1.5" />
    <rect x="30" y="17" width="40" height="6" rx="1.5" fill="#e0a915" stroke="#a87800" stroke-width="1.2" />
    <!-- mantling -->
    <path d="M14 34 C4 44 6 66 18 78 C14 62 16 48 24 38 Z" fill="#f2c230" opacity="0.9" />
    <path d="M86 34 C96 44 94 66 82 78 C86 62 84 48 76 38 Z" fill="#f2c230" opacity="0.9" />
    <!-- shield -->
    <path d="M22 26 H78 V60 C78 80 64 92 50 98 C36 92 22 80 22 60 Z" fill="#fff" stroke="#a87800" stroke-width="2.5" />
    <path d="M24.5 28.5 H50 V60 H24.5 Z" fill="#2a5bc4" />
    <path d="M50 28.5 H75.5 V60 H50 Z" fill="#f2c230" />
    <path d="M24.5 60 H50 V95 C38 89 24.5 79 24.5 60 Z" fill="#f2c230" />
    <path d="M50 60 H75.5 C75.5 79 62 89 50 95 Z" fill="#2a5bc4" />
    <circle cx="37" cy="44" r="6" fill="#f2c230" />
    <path d="M58 50 L63 38 L68 50 Z" fill="#2f7d32" />
    <rect x="31" y="70" width="12" height="8" fill="#2f7d32" />
    <circle cx="63" cy="74" r="5" fill="#fff" />
    <!-- scroll -->
    <path d="M18 92 Q50 108 82 92 L80 100 Q50 114 20 100 Z" fill="#f2c230" stroke="#a87800" stroke-width="1.2" />
  </svg>

  <svg v-else-if="kind === 'seal'" :width="size" :height="size" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
    <defs><path id="cw-seal-top" d="M20 60 A40 40 0 0 1 100 60" /><path id="cw-seal-bottom" d="M16 60 A44 44 0 0 0 104 60" /></defs>
    <circle cx="60" cy="60" r="56" fill="none" stroke="#3a5f8f" stroke-width="3" opacity="0.75" />
    <circle cx="60" cy="60" r="40" fill="none" stroke="#3a5f8f" stroke-width="1.5" opacity="0.6" />
    <text font-size="12" font-weight="700" fill="#3a5f8f" opacity="0.8" letter-spacing="2"><textPath href="#cw-seal-top" startOffset="50%" text-anchor="middle">VUNGU RURAL</textPath></text>
    <text font-size="11" font-weight="700" fill="#3a5f8f" opacity="0.8" letter-spacing="1.5"><textPath href="#cw-seal-bottom" startOffset="50%" text-anchor="middle">DISTRICT COUNCIL</textPath></text>
    <g transform="translate(40 36) scale(0.4)" opacity="0.7">
      <path d="M22 26 H78 V60 C78 80 64 92 50 98 C36 92 22 80 22 60 Z" fill="none" stroke="#3a5f8f" stroke-width="5" />
      <path d="M30 18 L36 6 L43 15 L50 3 L57 15 L64 6 L70 18 Z" fill="#3a5f8f" />
    </g>
  </svg>

  <svg v-else-if="kind === 'side'" viewBox="0 0 296 210" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="cw-side-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#143c72" stop-opacity="0" />
        <stop offset="1" stop-color="#4b77b0" stop-opacity="0.55" />
      </linearGradient>
    </defs>
    <rect width="296" height="210" fill="url(#cw-side-sky)" />
    <path d="M0 150 C60 120 110 140 160 128 C210 116 250 132 296 120 V210 H0 Z" fill="#325b90" opacity="0.8" />
    <path d="M0 176 C70 160 140 172 200 160 C240 152 270 160 296 156 V210 H0 Z" fill="#1d385c" />
    <!-- acacia -->
    <path d="M150 196 C152 172 150 150 146 136" stroke="#0e1e33" stroke-width="5" fill="none" />
    <path d="M147 146 C138 138 124 134 112 132 M148 140 C160 132 176 128 190 128" stroke="#0e1e33" stroke-width="3" fill="none" />
    <path d="M86 128 C100 112 130 106 150 110 C176 104 204 110 214 124 C190 132 120 134 86 128 Z" fill="#0e1e33" />
    <path d="M40 196 l3 -14 l3 14 M232 198 l2 -10 l2 10" stroke="#0e1e33" stroke-width="2" />
    <rect y="196" width="296" height="14" fill="#0e1e33" />
  </svg>

  <svg v-else viewBox="0 0 1200 94" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
    <path d="M0 70 C150 52 260 64 420 56 C560 48 700 62 860 54 C1000 48 1100 58 1200 52 V94 H0 Z" fill="#2f4f78" opacity="0.55" />
    <path d="M0 82 C200 72 380 80 560 74 C760 68 980 78 1200 72 V94 H0 Z" fill="#223d60" opacity="0.7" />
  </svg>
</template>
