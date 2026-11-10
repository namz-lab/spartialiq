<script setup lang="ts">
import { computed } from 'vue'
import { books, db } from '../store'
import { money } from '../lib/format'
const b = computed(() => books())
</script>

<template>
  <div class="top">
    <div>
      <h2>Profit &amp; loss</h2>
      <p>Trading statement from receipts, cost of goods and wages already paid.</p>
    </div>
    <button class="btn ghost no-print" @click="window.print()">Print</button>
  </div>
  <article class="card doc">
    <img v-if="db.profile.logoDataUrl" :src="db.profile.logoDataUrl" alt="" style="height:48px" />
    <h3>{{ db.profile.businessName }}</h3>
    <table>
      <tr><td>Sales</td><td>{{ money(b.sales, db.profile.currency) }}</td></tr>
      <tr><td>Cost of goods sold</td><td>({{ money(b.cogs, db.profile.currency) }})</td></tr>
      <tr><td><strong>Gross profit</strong></td><td><strong>{{ money(b.gross, db.profile.currency) }}</strong></td></tr>
      <tr><td>Salaries paid</td><td>({{ money(b.wages, db.profile.currency) }})</td></tr>
      <tr><td><strong>Net profit / (loss)</strong></td><td><strong>{{ money(b.profit, db.profile.currency) }}</strong></td></tr>
    </table>
  </article>
</template>
