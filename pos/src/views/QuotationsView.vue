<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { db, saveQuote, quoteToInvoice } from '../store'
import { docTotal, money } from '../lib/format'
import type { Line } from '../types'

const customerId = ref(db.customers[0]?.id || '')
const note = ref('')
const lines = reactive<Line[]>([])
const printId = ref<string | null>(null)

function addLine() {
  const p = db.products[0]
  if (!p) return
  lines.push({ productId: p.id, name: p.name, qty: 1, unitPrice: p.price })
}
function sync(i: number) {
  const p = db.products.find(x => x.id === lines[i].productId)
  if (p) { lines[i].name = p.name; lines[i].unitPrice = p.price }
}
function issue() {
  const c = db.customers.find(x => x.id === customerId.value)
  if (!c || !lines.length) return
  saveQuote({ customerId: c.id, customerName: c.name, lines: JSON.parse(JSON.stringify(lines)), note: note.value })
  lines.splice(0)
  note.value = ''
}
const preview = computed(() => db.quotes.find(q => q.id === printId.value))
</script>

<template>
  <div class="top">
    <div>
      <h2>Quotations</h2>
      <p>Price a job, send it, then convert an accepted quote into an invoice.</p>
    </div>
  </div>
  <div class="split">
    <article class="card">
      <table>
        <thead><tr><th>No.</th><th>Customer</th><th>Total</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr v-for="q in db.quotes" :key="q.id">
            <td>{{ q.number }}</td>
            <td>{{ q.customerName }}</td>
            <td>{{ money(docTotal(q.lines), db.profile.currency) }}</td>
            <td><span class="pill teal">{{ q.status }}</span></td>
            <td class="row">
              <button class="btn ghost" @click="printId = q.id; $nextTick(() => window.print())">Print</button>
              <button v-if="q.status !== 'invoiced'" class="btn primary" @click="quoteToInvoice(q.id)">To invoice</button>
            </td>
          </tr>
        </tbody>
      </table>
    </article>
    <article class="card no-print">
      <h3>New quotation</h3>
      <label class="field">Customer
        <select v-model="customerId">
          <option v-for="c in db.customers" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>
      <div v-for="(l, i) in lines" :key="i" class="row" style="margin:8px 0">
        <select v-model="l.productId" @change="sync(i)">
          <option v-for="p in db.products" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <input type="number" v-model.number="l.qty" style="width:72px" />
      </div>
      <button class="btn ghost" @click="addLine">Add line</button>
      <label class="field" style="margin-top:10px">Note <textarea v-model="note" rows="2" /></label>
      <p class="fig">{{ money(docTotal(lines), db.profile.currency) }}</p>
      <button class="btn primary" @click="issue">Issue quotation</button>
    </article>
  </div>
  <article v-if="preview" class="doc" style="margin-top:20px">
    <img v-if="db.profile.logoDataUrl" :src="db.profile.logoDataUrl" alt="" style="height:52px" />
    <h2 style="font-family:var(--serif)">Quotation {{ preview.number }}</h2>
    <p>{{ db.profile.businessName }} · {{ db.profile.address }}</p>
    <p>To: {{ preview.customerName }} · Valid until {{ new Date(preview.validUntil).toLocaleDateString('en-GB') }}</p>
    <table>
      <tr v-for="l in preview.lines" :key="l.productId"><td>{{ l.name }}</td><td>{{ l.qty }}</td><td>{{ money(l.qty*l.unitPrice, db.profile.currency) }}</td></tr>
    </table>
    <p class="fig">{{ money(docTotal(preview.lines), db.profile.currency) }}</p>
    <p>{{ preview.note }}</p>
  </article>
</template>
