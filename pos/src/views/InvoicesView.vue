<script setup lang="ts">
import { ref } from 'vue'
import { db, recordReceiptOnInvoice } from '../store'
import { docTotal, money } from '../lib/format'

const amount = ref(0)
const method = ref<'cash' | 'card' | 'ecocash' | 'transfer'>('transfer')
function collect(id: string) {
  if (amount.value <= 0) return
  recordReceiptOnInvoice(id, amount.value, method.value)
  amount.value = 0
}
</script>

<template>
  <div class="top">
    <div>
      <h2>Invoices</h2>
      <p>Open invoices, part-payments, and a receipt each time money comes in.</p>
    </div>
  </div>
  <article class="card no-print">
    <div class="row" style="margin-bottom:12px">
      <label class="field">Amount to collect <input type="number" step="0.01" v-model.number="amount" /></label>
      <label class="field">Method
        <select v-model="method">
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="ecocash">EcoCash</option>
          <option value="transfer">Transfer</option>
        </select>
      </label>
    </div>
    <table>
      <thead><tr><th>Invoice</th><th>Customer</th><th>Total</th><th>Paid</th><th>Status</th><th></th></tr></thead>
      <tbody>
        <tr v-for="i in db.invoices" :key="i.id">
          <td>{{ i.number }}</td>
          <td>{{ i.customerName }}</td>
          <td>{{ money(docTotal(i.lines), db.profile.currency) }}</td>
          <td>{{ money(i.paid, db.profile.currency) }}</td>
          <td><span :class="['pill', i.status==='paid' ? 'good' : i.status==='partial' ? 'warn' : 'bad']">{{ i.status }}</span></td>
          <td><button class="btn primary" :disabled="i.status==='paid'" @click="collect(i.id)">Collect</button></td>
        </tr>
      </tbody>
    </table>
  </article>
</template>
