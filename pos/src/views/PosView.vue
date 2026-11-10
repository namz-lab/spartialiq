<script setup lang="ts">
import { computed, ref } from 'vue'
import { db, checkout } from '../store'
import { docTotal, money } from '../lib/format'
import type { Line } from '../types'

const cart = ref<Line[]>([])
const method = ref<'cash' | 'card' | 'ecocash' | 'transfer'>('cash')
const customerName = ref(db.customers[1]?.name || 'Walk-in customer')
const last = ref<ReturnType<typeof checkout>>(null)

function add(id: string) {
  const p = db.products.find(x => x.id === id)
  if (!p || p.qty <= 0) return
  const line = cart.value.find(l => l.productId === id)
  if (line) { if (line.qty < p.qty) line.qty += 1 }
  else cart.value.push({ productId: p.id, name: p.name, qty: 1, unitPrice: p.price })
}
function drop(id: string) { cart.value = cart.value.filter(l => l.productId !== id) }
const total = computed(() => docTotal(cart.value))
function pay() {
  last.value = checkout(customerName.value, method.value, cart.value.map(l => ({ ...l })))
  if (last.value) cart.value = []
}
function printLast() { window.print() }
</script>

<template>
  <div class="top">
    <div>
      <h2>Point of sale</h2>
      <p>Ring up a sale, take payment, and a receipt is written automatically.</p>
    </div>
    <button v-if="last" class="btn ghost no-print" @click="printLast">Print last receipt</button>
  </div>
  <div class="split">
    <article class="card">
      <h3>Catalogue</h3>
      <table>
        <thead><tr><th>SKU</th><th>Item</th><th>Price</th><th>Qty</th><th></th></tr></thead>
        <tbody>
          <tr v-for="p in db.products" :key="p.id">
            <td>{{ p.sku }}</td>
            <td>{{ p.name }}</td>
            <td>{{ money(p.price, db.profile.currency) }}</td>
            <td>{{ p.qty }}</td>
            <td><button class="btn primary" :disabled="p.qty<=0" @click="add(p.id)">Add</button></td>
          </tr>
        </tbody>
      </table>
    </article>
    <article class="card">
      <h3>Current till</h3>
      <label class="field">Customer
        <select v-model="customerName">
          <option v-for="c in db.customers" :key="c.id" :value="c.name">{{ c.name }}</option>
        </select>
      </label>
      <table>
        <tbody>
          <tr v-for="l in cart" :key="l.productId">
            <td>{{ l.name }} × {{ l.qty }}</td>
            <td>{{ money(l.qty * l.unitPrice, db.profile.currency) }}</td>
            <td><button class="btn ghost" @click="drop(l.productId)">Remove</button></td>
          </tr>
        </tbody>
      </table>
      <p class="fig">{{ money(total, db.profile.currency) }}</p>
      <div class="row" style="margin:12px 0">
        <label v-for="m in ['cash','card','ecocash','transfer']" :key="m"><input type="radio" v-model="method" :value="m" /> {{ m }}</label>
      </div>
      <button class="btn primary" :disabled="!cart.length" @click="pay">Take payment</button>
      <p v-if="last" class="pill good" style="margin-top:12px">Receipt {{ last.number }} posted.</p>
    </article>
  </div>
  <article v-if="last" class="doc" style="margin-top:20px">
    <div class="row" style="justify-content:space-between">
      <div>
        <img v-if="db.profile.logoDataUrl" :src="db.profile.logoDataUrl" alt="" style="height:48px" />
        <h2 style="font-family:var(--serif);margin:8px 0 0">{{ db.profile.businessName }}</h2>
        <p>{{ db.profile.address }}<br>{{ db.profile.phone }}</p>
      </div>
      <div>
        <strong>RECEIPT {{ last.number }}</strong>
        <p>{{ last.method.toUpperCase() }}</p>
      </div>
    </div>
    <table>
      <tr v-for="l in last.lines" :key="l.productId"><td>{{ l.name }}</td><td>{{ l.qty }}</td><td>{{ money(l.qty*l.unitPrice, db.profile.currency) }}</td></tr>
    </table>
    <p class="fig">Total {{ money(last.total, db.profile.currency) }}</p>
    <p>Thank you for trading with {{ db.profile.tradingAs }}.</p>
  </article>
</template>
