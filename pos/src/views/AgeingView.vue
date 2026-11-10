<script setup lang="ts">
import { computed } from 'vue'
import { db } from '../store'
import { daysBetween, docTotal, money } from '../lib/format'

type Bucket = 'Current' | '1–30' | '31–60' | '61–90' | '90+'
const buckets: Bucket[] = ['Current', '1–30', '31–60', '61–90', '90+']

function bucket(iso: string): Bucket {
  const d = daysBetween(iso)
  if (d <= 0) return 'Current'
  if (d <= 30) return '1–30'
  if (d <= 60) return '31–60'
  if (d <= 90) return '61–90'
  return '90+'
}
function empty(): Record<Bucket, number> {
  return { Current: 0, '1–30': 0, '31–60': 0, '61–90': 0, '90+': 0 }
}

const debtors = computed(() => {
  const t = empty()
  for (const i of db.invoices) {
    const due = Math.max(0, docTotal(i.lines) - i.paid)
    if (due) t[bucket(i.dueAt)] += due
  }
  return t
})
const creditors = computed(() => {
  const t = empty()
  for (const p of db.purchases) {
    const due = Math.max(0, p.amount - p.paid)
    if (due) t[bucket(p.dueAt)] += due
  }
  return t
})
const salary = computed(() => {
  const t = empty()
  for (const s of db.salaries) {
    const due = Math.max(0, s.amount - s.paid)
    if (due) t[bucket(s.createdAt)] += due
  }
  return t
})
const ledgers = computed(() => [
  { title: 'Debtors ageing', data: debtors.value },
  { title: 'Creditors ageing', data: creditors.value },
  { title: 'Salary ageing', data: salary.value },
])
const salesMix = computed(() => {
  const map = new Map<string, number>()
  for (const r of db.receipts) {
    for (const l of r.lines) map.set(l.name, (map.get(l.name) || 0) + l.qty * l.unitPrice)
  }
  const total = [...map.values()].reduce((s, n) => s + n, 0) || 1
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, amount]) => ({
    name, amount, pct: Math.round((amount / total) * 100),
  }))
})
</script>

<template>
  <div class="top">
    <div>
      <h2>Ageing &amp; sales analysis</h2>
      <p>How old unpaid debtors, creditors and salary are — and what is actually selling.</p>
    </div>
  </div>
  <div class="grid kpis">
    <article class="card" v-for="row in ledgers" :key="row.title">
      <h3>{{ row.title }}</h3>
      <table>
        <tr v-for="k in buckets" :key="k"><td>{{ k }} days</td><td>{{ money(row.data[k], db.profile.currency) }}</td></tr>
      </table>
    </article>
  </div>
  <article class="card" style="margin-top:16px">
    <h3>Sales analysis</h3>
    <table>
      <thead><tr><th>Line</th><th>Revenue</th><th>Share</th></tr></thead>
      <tbody>
        <tr v-for="s in salesMix" :key="s.name">
          <td>{{ s.name }}</td>
          <td>{{ money(s.amount, db.profile.currency) }}</td>
          <td><div class="bar"><i :style="{ width: s.pct + '%' }" /></div></td>
        </tr>
      </tbody>
    </table>
  </article>
</template>
