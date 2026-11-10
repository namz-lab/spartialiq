<script setup lang="ts">
import { ref } from 'vue'
import { db } from '../store'
import { money } from '../lib/format'

const printId = ref<string | null>(null)
const preview = () => db.receipts.find(r => r.id === printId.value)
</script>

<template>
  <div class="top">
    <div>
      <h2>Receipts</h2>
      <p>Every till payment and invoice collection is filed here, ready to reprint.</p>
    </div>
  </div>
  <article class="card">
    <table>
      <thead><tr><th>Receipt</th><th>Customer</th><th>Method</th><th>Total</th><th></th></tr></thead>
      <tbody>
        <tr v-for="r in db.receipts" :key="r.id">
          <td>{{ r.number }}</td>
          <td>{{ r.customerName }}</td>
          <td class="pill teal">{{ r.method }}</td>
          <td>{{ money(r.total, db.profile.currency) }}</td>
          <td><button class="btn ghost" @click="printId = r.id; $nextTick(() => window.print())">Reprint</button></td>
        </tr>
      </tbody>
    </table>
  </article>
  <article v-if="preview()" class="doc" style="margin-top:20px">
    <img v-if="db.profile.logoDataUrl" :src="db.profile.logoDataUrl" alt="" style="height:52px" />
    <h2 style="font-family:var(--serif)">Receipt {{ preview()!.number }}</h2>
    <p>{{ db.profile.businessName }}<br>{{ db.profile.address }} · {{ db.profile.phone }}</p>
    <p>{{ preview()!.customerName }} · {{ preview()!.method.toUpperCase() }}</p>
    <table>
      <tr v-for="l in preview()!.lines" :key="l.productId"><td>{{ l.name }}</td><td>{{ l.qty }}</td><td>{{ money(l.qty*l.unitPrice, db.profile.currency) }}</td></tr>
    </table>
    <p class="fig">{{ money(preview()!.total, db.profile.currency) }}</p>
    <p>VAT {{ db.profile.vatNumber }}</p>
  </article>
</template>
