<script setup lang="ts">
// Download a table as Excel or CSV, or print the page (the browser's "Save as PDF" gives the PDF). The table is built when the button is pressed, so
// what is exported is what the screen holds at that moment, with its title, "as at", source and caveats (src/utils/tableExport.ts).
import { ref } from 'vue'
import { Download, FileSpreadsheet, Printer } from 'lucide-vue-next'
import { downloadCsv, downloadExcel, type ExportTable } from '@/utils/tableExport'

const props = defineProps<{
  /** Builds the table to export. */
  build: () => ExportTable
  /** The file's base name; the date is added. */
  filename: string
  /** Offer printing too (a page with its own print layout). */
  print?: boolean
}>()

const busy = ref(false)
const failed = ref(false)

async function excel() {
  busy.value = true
  failed.value = false
  try { await downloadExcel(props.build(), props.filename) } catch { failed.value = true } finally { busy.value = false }
}
function printPage() { window.print() }
function csv() {
  failed.value = false
  try { downloadCsv(props.build(), props.filename) } catch { failed.value = true }
}
</script>

<template>
  <div class="em-root" role="group" aria-label="Export this table">
    <button type="button" class="em-btn" :disabled="busy" @click="excel"><FileSpreadsheet :size="14" aria-hidden="true" /> Excel</button>
    <button type="button" class="em-btn" @click="csv"><Download :size="14" aria-hidden="true" /> CSV</button>
    <button v-if="print" type="button" class="em-btn" @click="printPage"><Printer :size="14" aria-hidden="true" /> Print</button>
    <span v-if="failed" class="em-fail" role="alert">The file could not be made.</span>
  </div>
</template>

<style scoped>
.em-root { display: inline-flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
.em-btn { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.25rem 0.625rem; border: 1px solid var(--ent-line-strong, var(--ent-line)); border-radius: 4px; background: var(--ent-surface); color: var(--ent-text); font: inherit; font-size: 0.8125rem; cursor: pointer; }
.em-btn:hover:not(:disabled) { background: var(--ent-surface-2); }
.em-btn:focus-visible { outline: 2px solid var(--ent-accent); outline-offset: 1px; }
.em-btn:disabled { opacity: 0.6; cursor: progress; }
.em-fail { color: var(--ent-danger); font-size: 0.8125rem; }
@media print { .em-root { display: none; } }
</style>
