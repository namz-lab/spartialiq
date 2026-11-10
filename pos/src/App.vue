<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { db } from './store'

const route = useRoute()
const modules = computed(() => db.profile.modules)
const initial = computed(() => (db.profile.businessName || 'T').slice(0, 1).toUpperCase())

const core = [
  { to: '/', label: 'Home' },
  { to: '/pos', label: 'Point of sale' },
  { to: '/stock', label: 'Recurring stock' },
  { to: '/quotations', label: 'Quotations' },
  { to: '/receipts', label: 'Receipts' },
  { to: '/invoices', label: 'Invoices' },
]
</script>

<template>
  <div class="shell">
    <aside class="rail">
      <div class="brand">
        <img v-if="db.profile.logoDataUrl" :src="db.profile.logoDataUrl" :alt="db.profile.businessName" />
        <div v-else class="brand-mark">{{ initial }}</div>
        <div>
          <h1>Tillbook</h1>
          <p>{{ db.profile.tradingAs || db.profile.businessName }}</p>
        </div>
      </div>
      <nav class="nav">
        <router-link v-for="l in core" :key="l.to" :to="l.to" :class="{ active: route.path === l.to }">{{ l.label }}</router-link>
        <h4>Books</h4>
        <router-link v-if="modules.pnl" to="/reports/pnl" :class="{ active: route.path === '/reports/pnl' }">Profit &amp; loss</router-link>
        <router-link v-if="modules.balance" to="/reports/balance" :class="{ active: route.path === '/reports/balance' }">Balance sheet</router-link>
        <router-link v-if="modules.cashflow" to="/reports/cashflow" :class="{ active: route.path === '/reports/cashflow' }">Cash flow</router-link>
        <router-link v-if="modules.invoiceAnalysis" to="/reports/invoices" :class="{ active: route.path === '/reports/invoices' }">Invoice analysis</router-link>
        <router-link v-if="modules.ageing" to="/reports/ageing" :class="{ active: route.path === '/reports/ageing' }">Ageing &amp; sales</router-link>
        <h4>Business</h4>
        <router-link to="/profile" :class="{ active: route.path === '/profile' }">Customise profile</router-link>
      </nav>
    </aside>
    <main class="stage">
      <router-view />
    </main>
  </div>
</template>
