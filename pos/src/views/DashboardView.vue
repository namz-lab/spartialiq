<script setup lang="ts">
import { computed } from 'vue'
import { db, books, runDueRestocks } from '../store'
import { money } from '../lib/format'

const b = computed(() => books())
const due = computed(() => db.products.filter(p => p.recurring.enabled && (p.qty <= p.reorderLevel)))
function restock() { runDueRestocks() }
</script>

<template>
  <div class="top">
    <div>
      <h2>Good trading day</h2>
      <p>{{ db.profile.businessName }} · till, stock, quotes and books in one place.</p>
    </div>
    <div class="row">
      <button class="btn gold" @click="restock">Run recurring restock</button>
      <router-link class="btn primary" to="/pos">Open till</router-link>
    </div>
  </div>
  <section class="grid kpis">
    <article class="card"><h3>Cash in till books</h3><p class="fig">{{ money(b.cash, db.profile.currency) }}</p></article>
    <article class="card"><h3>Sales</h3><p class="fig">{{ money(b.sales, db.profile.currency) }}</p></article>
    <article class="card"><h3>Debtors</h3><p class="fig">{{ money(b.debtors, db.profile.currency) }}</p></article>
    <article class="card"><h3>Stock value</h3><p class="fig">{{ money(b.stockValue, db.profile.currency) }}</p></article>
  </section>
  <div class="split" style="margin-top:16px">
    <article class="card">
      <h3>Needs restock</h3>
      <table>
        <thead><tr><th>Item</th><th>On hand</th><th>Reorder at</th></tr></thead>
        <tbody>
          <tr v-for="p in due" :key="p.id"><td>{{ p.name }}</td><td>{{ p.qty }}</td><td>{{ p.reorderLevel }}</td></tr>
          <tr v-if="!due.length"><td colspan="3">All recurring lines are healthy.</td></tr>
        </tbody>
      </table>
    </article>
    <article class="card">
      <h3>Latest receipts</h3>
      <table>
        <thead><tr><th>No.</th><th>Customer</th><th>Total</th></tr></thead>
        <tbody>
          <tr v-for="r in db.receipts.slice(0,5)" :key="r.id">
            <td>{{ r.number }}</td><td>{{ r.customerName }}</td><td>{{ money(r.total, db.profile.currency) }}</td>
          </tr>
        </tbody>
      </table>
    </article>
  </div>
</template>
