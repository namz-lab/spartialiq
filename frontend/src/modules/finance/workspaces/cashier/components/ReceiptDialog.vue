<script setup lang="ts">
/** An issued receipt opened from a list: read it, reprint it (marked COPY), save it as PDF. */
import { onMounted, ref } from 'vue'
import { X, Printer, Download, AlertTriangle } from 'lucide-vue-next'
import { cashApi } from '../../../api/cashApi'
import { messageOf } from '../../../stores/finance'
import { viewOfPrintable, type ReceiptView } from '../receipt'
import ReceiptDocument from './ReceiptDocument.vue'
import ReceiptOutput from './ReceiptOutput.vue'

const props = defineProps<{ receiptId: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const view = ref<ReceiptView | null>(null)
const error = ref<string | null>(null)
const busy = ref(false)
const docEl = ref<HTMLElement | null>(null)
const output = ref<InstanceType<typeof ReceiptOutput> | null>(null)

onMounted(async () => {
  try {
    view.value = viewOfPrintable((await cashApi.receipt(props.receiptId)).receipt)
  } catch (err) {
    error.value = messageOf(err, 'The receipt could not be read.')
  }
})

async function savePdf(): Promise<void> {
  if (!docEl.value || !view.value) return
  busy.value = true
  try {
    await output.value?.pdf(docEl.value, view.value.receipt_no ?? 'receipt')
  } catch (err) {
    error.value = messageOf(err, 'The PDF could not be made.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="cw-dialog-backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="cw-dialog cw-dialog--wide" role="dialog" aria-modal="true" aria-label="Receipt">
      <header>
        <h3>Receipt {{ view?.receipt_no ?? '' }}</h3>
        <button type="button" class="cw-icon-btn" aria-label="Close" @click="emit('close')"><X :size="20" /></button>
      </header>
      <div class="cw-dialog-body">
        <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
        <div v-else-if="!view"><span class="cw-skel" /><span class="cw-skel" /><span class="cw-skel" style="width: 60%" /></div>
        <div v-else ref="docEl" style="border: 1px solid #e9eff6; border-radius: 12px; overflow: hidden">
          <ReceiptDocument :view="view" />
        </div>
      </div>
      <footer>
        <button type="button" class="cw-btn" @click="emit('close')">Close</button>
        <button type="button" class="cw-btn cw-btn--outline" :disabled="!view || busy" @click="savePdf"><Download :size="18" aria-hidden="true" /> Download PDF</button>
        <button type="button" class="cw-btn cw-btn--primary" :disabled="!view" @click="view && output?.print(view, true)"><Printer :size="18" aria-hidden="true" /> Reprint</button>
      </footer>
    </div>
    <ReceiptOutput ref="output" />
  </div>
</template>
