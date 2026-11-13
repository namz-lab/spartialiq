<script setup lang="ts">
/**
 * Printing and saving a receipt.
 *
 * Print: the document is teleported to <body> as `.cw-print-root`, and cashier.css hides
 * everything else on paper. PDF: the on-screen document is rendered with html2canvas onto an A4
 * page by jsPDF, both loaded only when a PDF is asked for.
 */
import { nextTick, ref } from 'vue'
import ReceiptDocument from './ReceiptDocument.vue'
import type { ReceiptView } from '../receipt'

const printing = ref<{ view: ReceiptView; copy: boolean } | null>(null)

async function print(view: ReceiptView, copy = false): Promise<void> {
  printing.value = { view, copy }
  await nextTick()
  window.print()
}

async function pdf(element: HTMLElement, fileName: string): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
  const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const width = 190
  const height = Math.min(277, (canvas.height * width) / canvas.width)
  doc.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 10, width, height)
  doc.save(`${fileName}.pdf`)
}

defineExpose({ print, pdf })
</script>

<template>
  <Teleport to="body">
    <div v-if="printing" class="cw-print-root" aria-hidden="true">
      <ReceiptDocument :view="printing.view" :copy="printing.copy" />
    </div>
  </Teleport>
</template>
