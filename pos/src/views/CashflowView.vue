<script setup lang="ts">
import { computed } from 'vue'
import { books, db } from '../store'
import { money } from '../lib/format'
const b = computed(() => books())
</script>

<template>
  <div class="top">
    <div>
      <h2>Cash flow</h2>
      <p>Receipts in, supplier payments and wages out.</p>
    </div>
  </div>
  <article class="card">
    <table>
      <tr><td>Receipts collected</td><td>{{ money(b.sales, db.profile.currency) }}</td></tr>
      <tr><td>Paid to suppliers</td><td>({{ money(b.purchasesPaid, db.profile.currency) }})</td></tr>
      <tr><td>Salaries paid</td><td>({{ money(b.wages, db.profile.currency) }})</td></tr>
      <tr><td><strong>Net cash movement</strong></td><td><strong>{{ money(b.cash, db.profile.currency) }}</strong></td></tr>
    </table>
  </article>
</template>
