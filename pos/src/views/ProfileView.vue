<script setup lang="ts">
import { reactive } from 'vue'
import { db, saveProfile, setLogo, toggleModule, resetDemo } from '../store'
import type { ModuleKey, Profile } from '../types'

const form = reactive<Profile>(JSON.parse(JSON.stringify(db.profile)))
const extras: { key: ModuleKey; title: string; copy: string }[] = [
  { key: 'pnl', title: 'Profit & loss', copy: 'Sales, cost of goods, wages and trading profit.' },
  { key: 'balance', title: 'Balance sheet', copy: 'Cash, stock, debtors, creditors and capital.' },
  { key: 'cashflow', title: 'Cash flow', copy: 'Money in from receipts versus purchases and salaries.' },
  { key: 'invoiceAnalysis', title: 'Invoice analysis', copy: 'Paid, partial and overdue invoices by customer.' },
  { key: 'ageing', title: 'Ageing & sales analysis', copy: 'Debtors, creditors and salary ageing, plus sales mix.' },
]

function onLogo(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const url = String(reader.result || '')
    form.logoDataUrl = url
    setLogo(url)
  }
  reader.readAsDataURL(file)
}
function save() { saveProfile(JSON.parse(JSON.stringify(form))) }
function flip(key: ModuleKey, ev: Event) {
  const on = (ev.target as HTMLInputElement).checked
  form.modules[key] = on
  toggleModule(key, on)
}
</script>

<template>
  <div class="top">
    <div>
      <h2>Customise your profile</h2>
      <p>Your logo prints on quotations and receipts. Switch on the five extra books your clients need.</p>
    </div>
    <button class="btn ghost" @click="resetDemo">Reload sample shop</button>
  </div>
  <div class="split">
    <article class="card">
      <h3>Business identity</h3>
      <label class="logo-slot">
        <img v-if="form.logoDataUrl" :src="form.logoDataUrl" alt="Business logo" />
        <span v-else>Upload logo</span>
        <input type="file" accept="image/*" hidden @change="onLogo" />
      </label>
      <p style="color:var(--muted);font-size:0.85rem">PNG or JPG. Shown in the sidebar and on printed stationery.</p>
      <div class="grid" style="gap:10px;margin-top:12px">
        <label class="field">Registered name <input v-model="form.businessName" /></label>
        <label class="field">Trading as <input v-model="form.tradingAs" /></label>
        <label class="field">Address <textarea v-model="form.address" rows="2" /></label>
        <label class="field">Phone <input v-model="form.phone" /></label>
        <label class="field">Email <input v-model="form.email" /></label>
        <label class="field">VAT / tax no. <input v-model="form.vatNumber" /></label>
        <label class="field">Currency
          <select v-model="form.currency">
            <option>USD</option>
            <option>ZAR</option>
            <option>ZWG</option>
            <option>GBP</option>
          </select>
        </label>
        <button class="btn primary" @click="save">Save profile</button>
      </div>
    </article>
    <article class="card">
      <h3>Five extra books for clients</h3>
      <p style="color:var(--muted)">Turn on only what this business uses. They appear in the Books menu.</p>
      <label v-for="m in extras" :key="m.key" class="card" style="box-shadow:none;margin-top:10px;display:block">
        <div class="row" style="justify-content:space-between">
          <strong>{{ m.title }}</strong>
          <input type="checkbox" :checked="form.modules[m.key]" @change="flip(m.key, $event)" />
        </div>
        <p style="margin:6px 0 0;color:var(--muted)">{{ m.copy }}</p>
      </label>
    </article>
  </div>
</template>
