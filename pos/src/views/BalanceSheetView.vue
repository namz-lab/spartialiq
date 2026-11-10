<script setup lang="ts">
import { computed } from 'vue'
import { books, db } from '../store'
import { money } from '../lib/format'
const b = computed(() => books())
const assets = computed(() => b.value.cash + b.value.stockValue + b.value.debtors)
const equity = computed(() => assets.value - b.value.creditors - b.value.salaryOwed)
</script>

<template>
  <div class="top">
    <div>
      <h2>Balance sheet</h2>
      <p>What the shop owns and what it still owes, as of today.</p>
    </div>
    <button class="btn ghost no-print" @click="window.print()">Print</button>
  </div>
  <div class="split">
    <article class="card">
      <h3>Assets</h3>
      <table>
        <tr><td>Cash</td><td>{{ money(b.cash, db.profile.currency) }}</td></tr>
        <tr><td>Inventory</td><td>{{ money(b.stockValue, db.profile.currency) }}</td></tr>
        <tr><td>Trade debtors</td><td>{{ money(b.debtors, db.profile.currency) }}</td></tr>
        <tr><td><strong>Total assets</strong></td><td><strong>{{ money(assets, db.profile.currency) }}</strong></td></tr>
      </table>
    </article>
    <article class="card">
      <h3>Liabilities &amp; capital</h3>
      <table>
        <tr><td>Trade creditors</td><td>{{ money(b.creditors, db.profile.currency) }}</td></tr>
        <tr><td>Salary outstanding</td><td>{{ money(b.salaryOwed, db.profile.currency) }}</td></tr>
        <tr><td>Owner's capital (balancing figure)</td><td>{{ money(equity, db.profile.currency) }}</td></tr>
      </table>
    </article>
  </div>
</template>
