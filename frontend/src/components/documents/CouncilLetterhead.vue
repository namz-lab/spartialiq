<script setup lang="ts">
/**
 * The council letterhead for screen and print.
 *
 * The artwork is attempted first and the typographic mark is the fallback, not
 * a placeholder: if the asset is missing or blocked, the council's identity
 * still renders. The surface this replaces hard-coded an image path that did
 * not exist, so every print carried a broken image icon.
 */
import { ref } from 'vue'
import { COUNCIL, LETTERHEAD_ASSET } from '@/documents/council'

defineProps<{
  /** e.g. 'OFFICIAL RECEIPT'. Printed on the right. */
  docType: string
  /** Reference or receipt number, under the document type. */
  reference?: string
}>()

const artworkFailed = ref(false)
</script>

<template>
  <div class="lh">
    <div class="lh-left">
      <img
        v-if="!artworkFailed"
        :src="LETTERHEAD_ASSET"
        alt=""
        class="lh-art"
        @error="artworkFailed = true"
      >
      <div>
        <div class="lh-name">{{ COUNCIL.name }}</div>
        <div class="lh-sub">{{ COUNCIL.address }}</div>
        <div class="lh-sub">{{ COUNCIL.contactLine() }}</div>
      </div>
    </div>
    <div class="lh-right">
      <div class="lh-doctype">{{ docType }}</div>
      <div v-if="reference" class="lh-ref">{{ reference }}</div>
    </div>
  </div>
</template>

<style scoped>
.lh { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
.lh-left { display: flex; align-items: flex-start; gap: 1rem; }
.lh-art { height: 56px; width: auto; object-fit: contain; }
/*
 * Type and colour come from custom properties so a host document can theme
 * the letterhead. Scoped styles are otherwise unreachable from the parent,
 * and the payment receipt carries its own palette and typeface — without
 * these hooks, dropping this component in silently reverted both.
 * The fallbacks are the council's default ink and faces.
 */
.lh-name { font-family: var(--lh-name-font, 'Playfair Display', serif); font-size: .98rem; color: var(--lh-name-color, #1a3d2b); font-weight: 700; letter-spacing: .02em; }
.lh-sub { font-size: .72rem; color: var(--lh-sub-color, #4a5a50); line-height: 1.5; }
.lh-right { text-align: right; }
.lh-doctype { font-size: .72rem; letter-spacing: .12em; color: var(--lh-doctype-color, #4a5a50); text-transform: uppercase; }
.lh-ref { font-size: var(--lh-ref-size, .9rem); color: var(--lh-ref-color, #1a3d2b); font-weight: 700; }

@media (max-width: 600px) {
  .lh { flex-direction: column; }
  .lh-right { text-align: left; }
}

@media print {
  .lh-art { height: 64px; }
}
</style>
