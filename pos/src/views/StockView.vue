<script setup lang="ts">
import { reactive } from 'vue'
import { db, upsertProduct, runDueRestocks } from '../store'
import { money, uid } from '../lib/format'
import type { Product } from '../types'

const draft = reactive<Product>({
  id: '', sku: '', name: '', qty: 0, reorderLevel: 5, cost: 0, price: 0,
  recurring: { enabled: true, everyDays: 14, qty: 10, lastRestockAt: null },
})
const msg = { text: '' }

function edit(p: Product) { Object.assign(draft, JSON.parse(JSON.stringify(p))) }
function save() {
  if (!draft.name || !draft.sku) return
  if (!draft.id) draft.id = uid('p')
  upsertProduct(JSON.parse(JSON.stringify(draft)))
  msg.text = 'Stock line saved.'
}
function restock() {
  const due = runDueRestocks()
  msg.text = due.length ? `Restocked ${due.length} recurring line(s).` : 'Nothing was due.'
}
</script>

<template>
  <div class="top">
    <div>
      <h2>Recurring stock</h2>
      <p>Keep reorder levels, unit cost, and an automatic restock cadence for each line.</p>
    </div>
    <button class="btn gold" @click="restock">Run due restocks</button>
  </div>
  <p v-if="msg.text" class="pill teal">{{ msg.text }}</p>
  <div class="split">
    <article class="card">
      <table>
        <thead><tr><th>SKU</th><th>Item</th><th>On hand</th><th>Cadence</th><th></th></tr></thead>
        <tbody>
          <tr v-for="p in db.products" :key="p.id">
            <td>{{ p.sku }}</td>
            <td>{{ p.name }}</td>
            <td><span :class="['pill', p.qty <= p.reorderLevel ? 'warn' : 'good']">{{ p.qty }}</span></td>
            <td>{{ p.recurring.enabled ? `Every ${p.recurring.everyDays} days · +${p.recurring.qty}` : 'Manual' }}</td>
            <td><button class="btn ghost" @click="edit(p)">Edit</button></td>
          </tr>
        </tbody>
      </table>
    </article>
    <article class="card">
      <h3>{{ draft.id ? 'Edit line' : 'New line' }}</h3>
      <div class="grid" style="gap:10px">
        <label class="field">SKU <input v-model="draft.sku" /></label>
        <label class="field">Name <input v-model="draft.name" /></label>
        <label class="field">On hand <input type="number" v-model.number="draft.qty" /></label>
        <label class="field">Reorder at <input type="number" v-model.number="draft.reorderLevel" /></label>
        <label class="field">Cost <input type="number" step="0.01" v-model.number="draft.cost" /></label>
        <label class="field">Sell price <input type="number" step="0.01" v-model.number="draft.price" /></label>
        <label class="row"><input type="checkbox" v-model="draft.recurring.enabled" /> Recurring restock</label>
        <label class="field">Every (days) <input type="number" v-model.number="draft.recurring.everyDays" /></label>
        <label class="field">Quantity each cycle <input type="number" v-model.number="draft.recurring.qty" /></label>
        <button class="btn primary" @click="save">Save stock line</button>
      </div>
      <p class="fig" style="font-size:1rem">{{ money(draft.price, db.profile.currency) }} sell · {{ money(draft.cost, db.profile.currency) }} cost</p>
    </article>
  </div>
</template>
