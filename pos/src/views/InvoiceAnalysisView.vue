<script setup lang="ts">
import { computed } from 'vue'
import { db } from '../store'
import { docTotal, money } from '../lib/format'

const rows = computed(() => db.invoices.map(i => {
  const total = docTotal(i.lines)
  const due = Math.max(0, total - i.paid)
  return { ...i, total, due, pct: total ? Math.round((i.paid / total) * 100) : 0 }
}))
const open = computed(() => rows.value.filter(r => r.due > 0).reduce((s, r) => s + r.due, 0))
</script>

<template>
  <div class="top">
    <div>
      <h2>Invoice analysis</h2>
      <p>{{ money(open, db.profile.currency) }} still collectable across the book.</p>
    </div>
  </div>
  <article class="card">
    <table>
      <thead><tr><th>Invoice</th><th>Customer</th><th>Total</th><th>Collected</th><th></th></tr></thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td>{{ r.number }}</td>
          <td>{{ r.customerName }}</td>
          <td>{{ money(r.total, db.profile.currency) }}</td>
          <td>{{ money(r.paid, db.profile.currency) }}</td>
          <td><div class="bar"><i :style="{ width: r.pct + '%' }" /></div></td>
        </tr>
      </tbody>
    </table>
  </article>
</template>
