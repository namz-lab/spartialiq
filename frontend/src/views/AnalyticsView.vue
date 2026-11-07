<template>
  <div class="analytics-page">

    <!-- ── Page header ───────────────────────────────────────────────── -->
    <div class="an-page-header">
      <div class="an-header-inner">
        <div>
          <h1 class="an-page-title">Analytics Dashboard</h1>
          <p class="an-page-sub">Data analytics and spatial insights for Vungu RDC</p>
        </div>
        <div class="an-header-actions">
          <select v-model="selectedPeriod" class="an-select">
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="1y">Last year</option>
          </select>
          <button class="an-btn-export">Export Report</button>
          <button class="an-logout-btn" @click="handleLogout" title="Logout"><LogOut :size="14" /></button>
        </div>
      </div>
    </div>

    <!-- ── Body ──────────────────────────────────────────────────────── -->
    <div class="an-body">

      <!-- KPI row -->
      <div class="an-kpi-row">
        <div v-for="k in kpis" :key="k.label" class="an-kpi-card">
          <div class="an-kpi-icon" :style="{ background: k.color + '18', color: k.color }">
            <component :is="k.icon" :size="20" />
          </div>
          <div>
            <div class="an-kpi-value">{{ k.value }}</div>
            <div class="an-kpi-label">{{ k.label }}</div>
          </div>
          <div class="an-kpi-trend" :class="k.up ? 'up' : 'down'">
            {{ k.up ? '▲' : '▼' }} {{ k.trend }}
          </div>
        </div>
      </div>

      <!-- Row 1: land use + applications -->
      <div class="an-row-2">

        <!-- Land-use breakdown -->
        <div class="an-card an-card-land">
          <h3 class="an-card-title">Land Use Distribution</h3>
          <div class="an-land-bars">
            <div v-for="z in landUse" :key="z.name" class="an-land-row">
              <span class="an-land-name">{{ z.name }}</span>
              <div class="an-land-track">
                <div class="an-land-fill" :style="{ width: z.pct + '%', background: z.color }"></div>
              </div>
              <span class="an-land-pct">{{ z.pct }}%</span>
            </div>
          </div>
        </div>

        <!-- Applications donut -->
        <div class="an-card an-card-donut">
          <h3 class="an-card-title">Applications by Status</h3>
          <div class="an-donut-wrap">
            <svg viewBox="0 0 120 120" class="an-donut-svg">
              <circle cx="60" cy="60" r="48" fill="none" stroke="#e2e8f0" stroke-width="16"/>
              <circle cx="60" cy="60" r="48" fill="none" stroke="#2563eb" stroke-width="16"
                stroke-dasharray="120 182" stroke-dashoffset="-12" stroke-linecap="round"/>
              <circle cx="60" cy="60" r="48" fill="none" stroke="#10b981" stroke-width="16"
                stroke-dasharray="72 230" stroke-dashoffset="-132" stroke-linecap="round"/>
              <circle cx="60" cy="60" r="48" fill="none" stroke="#f59e0b" stroke-width="16"
                stroke-dasharray="48 254" stroke-dashoffset="-204" stroke-linecap="round"/>
              <circle cx="60" cy="60" r="48" fill="none" stroke="#ef4444" stroke-width="16"
                stroke-dasharray="24 278" stroke-dashoffset="-252" stroke-linecap="round"/>
              <text x="60" y="56" text-anchor="middle" font-size="18" font-weight="700" fill="#0f172a">264</text>
              <text x="60" y="70" text-anchor="middle" font-size="8" fill="#64748b">Total</text>
            </svg>
            <div class="an-donut-legend">
              <div v-for="s in appStatus" :key="s.label" class="an-donut-item">
                <span class="an-donut-dot" :style="{ background: s.color }"></span>
                <span class="an-donut-label">{{ s.label }}</span>
                <span class="an-donut-val">{{ s.val }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Zone compliance -->
        <div class="an-card an-card-comply">
          <h3 class="an-card-title">Zone Compliance Rate</h3>
          <div class="an-comply-list">
            <div v-for="z in compliance" :key="z.zone" class="an-comply-row">
              <span class="an-comply-zone">{{ z.zone }}</span>
              <div class="an-comply-track">
                <div class="an-comply-fill"
                  :style="{ width: z.rate + '%', background: z.rate >= 80 ? '#10b981' : z.rate >= 60 ? '#f59e0b' : '#ef4444' }">
                </div>
              </div>
              <span class="an-comply-rate">{{ z.rate }}%</span>
            </div>
          </div>
        </div>

      </div>

      <!-- Row 2: monthly trend -->
      <div class="an-card an-card-trend">
        <h3 class="an-card-title">Monthly Application Submissions (2024)</h3>
        <div class="an-trend-chart">
          <div v-for="m in monthly" :key="m.month" class="an-trend-col">
            <div class="an-trend-bar-wrap">
              <div class="an-trend-bar" :style="{ height: (m.val / 38) * 100 + '%' }"></div>
            </div>
            <span class="an-trend-label">{{ m.month }}</span>
          </div>
        </div>
      </div>

      <!-- Row 3: layer inventory + infrastructure -->
      <div class="an-row-2">

        <div class="an-card an-card-layers">
          <h3 class="an-card-title">Spatial Layer Inventory</h3>
          <table class="an-table">
            <thead>
              <tr><th>Layer</th><th>Type</th><th>Features</th><th>Updated</th><th>Status</th></tr>
            </thead>
            <tbody>
              <tr v-for="l in layers" :key="l.name">
                <td>{{ l.name }}</td>
                <td><span class="an-badge" :style="{ background: l.type === 'Vector' ? '#eff6ff' : '#f0fdf4', color: l.type === 'Vector' ? '#2563eb' : '#10b981' }">{{ l.type }}</span></td>
                <td>{{ l.features.toLocaleString() }}</td>
                <td>{{ l.updated }}</td>
                <td><span class="an-badge" :style="{ background: '#f0fdf4', color: '#10b981' }">Active</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="an-card an-card-infra">
          <h3 class="an-card-title">Infrastructure Coverage</h3>
          <div class="an-infra-grid">
            <div v-for="i in infra" :key="i.name" class="an-infra-tile">
              <div class="an-infra-icon"><component :is="i.icon" :size="22" /></div>
              <div class="an-infra-name">{{ i.name }}</div>
              <div class="an-infra-val">{{ i.val }}</div>
              <div class="an-infra-bar-track">
                <div class="an-infra-bar-fill" :style="{ width: i.pct + '%', background: i.color }"></div>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- Row 4: officer workload + zone summary -->
      <div class="an-row-2">

        <div class="an-card">
          <h3 class="an-card-title">Officer Workload</h3>
          <div class="an-officer-list">
            <div v-for="o in officers" :key="o.name" class="an-officer-row">
              <div class="an-officer-avatar">{{ o.name[0] }}</div>
              <div class="an-officer-info">
                <div class="an-officer-name">{{ o.name }}</div>
                <div class="an-officer-role">{{ o.role }}</div>
              </div>
              <div class="an-officer-stats">
                <span class="an-badge" style="background:#eff6ff;color:#2563eb">{{ o.open }} open</span>
                <span class="an-badge" style="background:#f0fdf4;color:#10b981">{{ o.closed }} closed</span>
              </div>
            </div>
          </div>
        </div>

        <div class="an-card">
          <h3 class="an-card-title">Zone Summary</h3>
          <table class="an-table">
            <thead>
              <tr><th>Zone</th><th>Area (ha)</th><th>Parcels</th><th>Built-up %</th></tr>
            </thead>
            <tbody>
              <tr v-for="z in zones" :key="z.zone">
                <td>{{ z.zone }}</td>
                <td>{{ z.area }}</td>
                <td>{{ z.parcels }}</td>
                <td>
                  <div class="an-mini-bar-track">
                    <div class="an-mini-bar-fill" :style="{ width: z.builtup + '%' }"></div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>

      <!-- Row 5: recent applications -->
      <div class="an-card">
        <h3 class="an-card-title">Recent Applications</h3>
        <table class="an-table">
          <thead>
            <tr><th>Ref</th><th>Applicant</th><th>Type</th><th>Zone</th><th>Submitted</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr v-for="a in recentApps" :key="a.ref">
              <td><code>{{ a.ref }}</code></td>
              <td>{{ a.name }}</td>
              <td>{{ a.type }}</td>
              <td>{{ a.zone }}</td>
              <td>{{ a.date }}</td>
              <td>
                <span class="an-badge"
                  :style="{ background: a.status === 'Approved' ? '#f0fdf4' : a.status === 'Pending' ? '#fffbeb' : a.status === 'Review' ? '#eff6ff' : '#fef2f2',
                             color:      a.status === 'Approved' ? '#10b981' : a.status === 'Pending' ? '#f59e0b' : a.status === 'Review' ? '#2563eb' : '#ef4444' }">
                  {{ a.status }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </div><!-- /an-body -->
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ClipboardList, CheckCircle2, Clock, XCircle, Map, User, Droplets, Zap, Route, Wrench, Radio, Bus, LogOut } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

async function handleLogout() {
  await authStore.logout()
  router.push('/login')
}

const selectedPeriod = ref('30d')

const kpis = [
  { label: 'Total Applications', value: '264', trend: '12%', up: true,  icon: ClipboardList, color: '#2563eb' },
  { label: 'Approved',           value: '120', trend: '8%',  up: true,  icon: CheckCircle2,  color: '#10b981' },
  { label: 'Pending Review',     value: '87',  trend: '3%',  up: false, icon: Clock,         color: '#f59e0b' },
  { label: 'Rejected',           value: '31',  trend: '5%',  up: false, icon: XCircle,       color: '#ef4444' },
  { label: 'Active Layers',      value: '18',  trend: '2',   up: true,  icon: Map,           color: '#8b5cf6' },
  { label: 'Registered Users',   value: '142', trend: '15%', up: true,  icon: User,          color: '#0ea5e9' },
]

const landUse = [
  { name: 'Residential',  pct: 42, color: '#2563eb' },
  { name: 'Commercial',   pct: 18, color: '#10b981' },
  { name: 'Industrial',   pct: 12, color: '#f59e0b' },
  { name: 'Agricultural', pct: 15, color: '#84cc16' },
  { name: 'Conservation', pct:  8, color: '#8b5cf6' },
  { name: 'Other',        pct:  5, color: '#94a3b8' },
]

const appStatus = [
  { label: 'Approved',  val: 120, color: '#10b981' },
  { label: 'Pending',   val:  87, color: '#f59e0b' },
  { label: 'Review',    val:  26, color: '#2563eb' },
  { label: 'Rejected',  val:  31, color: '#ef4444' },
]

const compliance = [
  { zone: 'Central Business', rate: 91 },
  { zone: 'Residential A',    rate: 83 },
  { zone: 'Residential B',    rate: 74 },
  { zone: 'Industrial Park',  rate: 68 },
  { zone: 'Agricultural',     rate: 55 },
]

const monthly = [
  { month: 'Jan', val: 18 }, { month: 'Feb', val: 22 }, { month: 'Mar', val: 28 },
  { month: 'Apr', val: 24 }, { month: 'May', val: 30 }, { month: 'Jun', val: 35 },
  { month: 'Jul', val: 38 }, { month: 'Aug', val: 32 }, { month: 'Sep', val: 27 },
  { month: 'Oct', val: 20 }, { month: 'Nov', val: 15 }, { month: 'Dec', val: 10 },
]

const layers = [
  { name: 'Cadastral Boundaries', type: 'Vector', features: 12480, updated: '2024-11-01' },
  { name: 'Road Network',         type: 'Vector', features:  3214, updated: '2024-10-15' },
  { name: 'Land Use Zones',       type: 'Vector', features:   847, updated: '2024-11-20' },
  { name: 'Satellite Imagery',    type: 'Raster', features:     1, updated: '2024-09-30' },
  { name: 'Infrastructure',       type: 'Vector', features:  6932, updated: '2024-11-05' },
]

const infra = [
  { name: 'Water Supply',    val: '78%', pct: 78, icon: Droplets, color: '#0ea5e9' },
  { name: 'Electricity',     val: '85%', pct: 85, icon: Zap,      color: '#f59e0b' },
  { name: 'Road Access',     val: '67%', pct: 67, icon: Route,    color: '#94a3b8' },
  { name: 'Sewage System',   val: '52%', pct: 52, icon: Wrench,   color: '#10b981' },
  { name: 'Internet',        val: '41%', pct: 41, icon: Radio,    color: '#8b5cf6' },
  { name: 'Public Transport',val: '33%', pct: 33, icon: Bus,      color: '#ef4444' },
]

const officers = [
  { name: 'Tendai Moyo',    role: 'Senior Planner', open: 12, closed: 48 },
  { name: 'Rudo Chikwanda', role: 'Town Planner',   open:  9, closed: 32 },
  { name: 'Farai Mutasa',   role: 'Junior Planner', open: 14, closed: 21 },
  { name: 'Nyasha Banda',   role: 'GIS Analyst',    open:  5, closed: 19 },
]

const zones = [
  { zone: 'CBD',        area: '145',  parcels: 284,  builtup: 92 },
  { zone: 'Res A',      area: '1240', parcels: 3182, builtup: 78 },
  { zone: 'Res B',      area: '860',  parcels: 1904, builtup: 61 },
  { zone: 'Industrial', area: '420',  parcels: 218,  builtup: 54 },
  { zone: 'Agri',       area: '3800', parcels: 642,  builtup: 12 },
]

const recentApps = [
  { ref: 'VDC-2024-0892', name: 'T. Moyo Investments',  type: 'Commercial',  zone: 'CBD',      date: '2024-11-28', status: 'Review'   },
  { ref: 'VDC-2024-0891', name: 'R. Chikwanda',         type: 'Residential', zone: 'Res A',    date: '2024-11-27', status: 'Approved' },
  { ref: 'VDC-2024-0890', name: 'Farai Holdings Ltd',   type: 'Industrial',  zone: 'Indust.',  date: '2024-11-26', status: 'Pending'  },
  { ref: 'VDC-2024-0889', name: 'N. Banda Properties',  type: 'Residential', zone: 'Res B',    date: '2024-11-25', status: 'Rejected' },
  { ref: 'VDC-2024-0888', name: 'City Developers Co.',  type: 'Mixed-Use',   zone: 'CBD',      date: '2024-11-24', status: 'Approved' },
]
</script>

<style scoped>
/* ── Page ────────────────────────────────────────────────────────────── */
.analytics-page {
  min-height: var(--ent-vh);
  background: #f8fafc;
}

/* ── Header ──────────────────────────────────────────────────────────── */
.an-page-header {
  background: #0f172a;
  padding: 2rem 2.5rem 1.75rem;
  border-bottom: 1px solid #1e293b;
}
.an-header-inner {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.an-page-title {
  font-size: clamp(1.5rem, 3vw, 2.25rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #ffffff;
  margin: 0 0 0.25rem;
}
.an-page-sub {
  font-size: 0.9375rem;
  color: #94a3b8;
  margin: 0;
}
.an-header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}
.an-select {
  padding: 0.5rem 0.875rem;
  border: 1px solid #334155;
  border-radius: 9999px;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 0.875rem;
  cursor: pointer;
  outline: none;
}
.an-btn-export {
  padding: 0.5rem 1.25rem;
  background: #111827;
  color: #fff;
  border: none;
  border-radius: 9999px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0,0,0,0.25);
  transition: background 0.15s ease, transform 0.1s;
}
.an-btn-export:hover { background: #1e293b; transform: translateY(-1px); }
.an-logout-btn { display:flex; align-items:center; justify-content:center; width:1.75rem; height:1.75rem; background:none; border:1px solid #e2e8f0; border-radius:0.375rem; cursor:pointer; color:#6b7280; transition:all 0.15s; }
.an-logout-btn:hover { background:#fef2f2; border-color:#fecaca; color:#dc2626; }

/* ── Body ────────────────────────────────────────────────────────────── */
.an-body {
  max-width: 1400px;
  margin: 0 auto;
  padding: 2rem 2.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* ── KPI row ─────────────────────────────────────────────────────────── */
.an-kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
}
.an-kpi-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 1rem;
  padding: 1.25rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  position: relative;
}
.an-kpi-icon {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.an-kpi-emoji { font-size: 1.25rem; }
.an-kpi-value {
  font-size: 1.5rem;
  font-weight: 800;
  color: #0f172a;
  line-height: 1;
}
.an-kpi-label {
  font-size: 0.75rem;
  color: #64748b;
  margin-top: 0.2rem;
}
.an-kpi-trend {
  position: absolute;
  top: 0.75rem;
  right: 0.875rem;
  font-size: 0.7rem;
  font-weight: 700;
}
.an-kpi-trend.up   { color: #10b981; }
.an-kpi-trend.down { color: #ef4444; }

/* ── Generic card ────────────────────────────────────────────────────── */
.an-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 1rem;
  padding: 1.5rem;
}
.an-card-title {
  font-size: 0.9375rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 1.25rem;
  letter-spacing: -0.01em;
}

/* ── Two-col row ─────────────────────────────────────────────────────── */
.an-row-2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1.5rem;
}

/* ── Land-use bars ───────────────────────────────────────────────────── */
.an-land-bars { display: flex; flex-direction: column; gap: 0.75rem; }
.an-land-row  { display: flex; align-items: center; gap: 0.75rem; }
.an-land-name { font-size: 0.8125rem; color: #374151; width: 90px; flex-shrink: 0; }
.an-land-track {
  flex: 1;
  height: 8px;
  background: #f1f5f9;
  border-radius: 999px;
  overflow: hidden;
}
.an-land-fill  { height: 100%; border-radius: 999px; transition: width 0.4s ease; }
.an-land-pct   { font-size: 0.8125rem; font-weight: 600; color: #374151; width: 36px; text-align: right; }

/* ── Donut ───────────────────────────────────────────────────────────── */
.an-donut-wrap   { display: flex; align-items: center; gap: 1.5rem; }
.an-donut-svg    { width: 120px; height: 120px; flex-shrink: 0; }
.an-donut-legend { display: flex; flex-direction: column; gap: 0.5rem; }
.an-donut-item   { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem; }
.an-donut-dot    { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.an-donut-label  { color: #374151; flex: 1; }
.an-donut-val    { font-weight: 700; color: #0f172a; }

/* ── Compliance ──────────────────────────────────────────────────────── */
.an-comply-list  { display: flex; flex-direction: column; gap: 0.75rem; }
.an-comply-row   { display: flex; align-items: center; gap: 0.75rem; }
.an-comply-zone  { font-size: 0.8125rem; color: #374151; width: 130px; flex-shrink: 0; }
.an-comply-track { flex: 1; height: 8px; background: #f1f5f9; border-radius: 999px; overflow: hidden; }
.an-comply-fill  { height: 100%; border-radius: 999px; transition: width 0.4s ease; }
.an-comply-rate  { font-size: 0.8125rem; font-weight: 600; color: #374151; width: 40px; text-align: right; }

/* ── Monthly trend ───────────────────────────────────────────────────── */
.an-trend-chart {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  height: 140px;
}
.an-trend-col   { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0.25rem; height: 100%; }
.an-trend-bar-wrap { flex: 1; width: 100%; display: flex; align-items: flex-end; }
.an-trend-bar {
  width: 100%;
  background: linear-gradient(to top, #2563eb, #60a5fa);
  border-radius: 4px 4px 0 0;
  min-height: 4px;
  transition: height 0.4s ease;
}
.an-trend-label { font-size: 0.625rem; color: #94a3b8; }

/* ── Table ───────────────────────────────────────────────────────────── */
.an-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
.an-table th {
  text-align: left;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #64748b;
  padding: 0 0.75rem 0.625rem;
  border-bottom: 1px solid #e2e8f0;
}
.an-table td {
  padding: 0.625rem 0.75rem;
  color: #374151;
  border-bottom: 1px solid #f1f5f9;
}
.an-table tr:last-child td { border-bottom: none; }
.an-table code { font-size: 0.75rem; color: #2563eb; background: #eff6ff; padding: 0.125rem 0.375rem; border-radius: 4px; }

/* ── Badge ───────────────────────────────────────────────────────────── */
.an-badge {
  display: inline-block;
  padding: 0.125rem 0.625rem;
  border-radius: 9999px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

/* ── Infrastructure grid ─────────────────────────────────────────────── */
.an-infra-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 1rem;
}
.an-infra-tile {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  padding: 1rem;
  text-align: center;
}
.an-infra-icon { font-size: 1.5rem; margin-bottom: 0.5rem; }
.an-infra-name { font-size: 0.7rem; color: #64748b; margin-bottom: 0.25rem; }
.an-infra-val  { font-size: 1.125rem; font-weight: 800; color: #0f172a; margin-bottom: 0.5rem; }
.an-infra-bar-track { height: 4px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
.an-infra-bar-fill  { height: 100%; border-radius: 999px; }

/* ── Officer list ────────────────────────────────────────────────────── */
.an-officer-list  { display: flex; flex-direction: column; gap: 0.75rem; }
.an-officer-row   { display: flex; align-items: center; gap: 0.875rem; }
.an-officer-avatar {
  width: 2.25rem; height: 2.25rem;
  background: #0f172a; color: #fff;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 0.875rem; font-weight: 700; flex-shrink: 0;
}
.an-officer-info  { flex: 1; }
.an-officer-name  { font-size: 0.875rem; font-weight: 600; color: #0f172a; }
.an-officer-role  { font-size: 0.75rem; color: #64748b; }
.an-officer-stats { display: flex; gap: 0.5rem; }

/* ── Mini bar ────────────────────────────────────────────────────────── */
.an-mini-bar-track { height: 6px; background: #f1f5f9; border-radius: 999px; overflow: hidden; width: 80px; }
.an-mini-bar-fill  { height: 100%; background: #2563eb; border-radius: 999px; }

/* ── Responsive ──────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .an-body { padding: 1rem; }
  .an-page-header { padding: 1.25rem 1rem; }
  .an-header-inner { flex-direction: column; }
  .an-kpi-row { grid-template-columns: repeat(2, 1fr); }
}
</style>
