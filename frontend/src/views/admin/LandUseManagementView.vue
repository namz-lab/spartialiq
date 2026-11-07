<template>
  <div class="land-use-management">
    <!-- Header -->
    <div class="page-header">
      <div class="header-content">
        <div class="title-section">
          <h1>Land Use Management</h1>
          <p class="subtitle">Land use groups, zones, and the development control matrix</p>
        </div>
        <div class="header-actions">
          <button @click="refreshData" class="btn btn-secondary" :disabled="loading">
            Refresh
          </button>
        </div>
      </div>
    </div>

    <div v-if="loadError" class="lu-banner" role="alert">
      <span>{{ loadError }}</span>
      <button type="button" @click="refreshData">Retry</button>
    </div>

    <!-- Navigation Tabs -->
    <div class="tabs-container">
      <div class="tabs">
        <button 
          v-for="tab in tabs" 
          :key="tab.id"
          :class="['tab', { active: activeTab === tab.id }]"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
          <span v-if="tab.count" class="tab-count">{{ tab.count }}</span>
        </button>
      </div>
    </div>

    <!-- Tab Content -->
    <div class="tab-content">
      <!-- Land Use Groups Tab -->
      <div v-if="activeTab === 'groups'" class="tab-panel">
        <LandUseGroupsManager 
          @refresh="refreshLandUseGroups"
          :loading="loading"
          :groups="landUseGroups"
          :zones="landUseZones"
          :pagination="groupsPagination"
        />
      </div>

      <!-- Land Use Zones Tab -->
      <div v-if="activeTab === 'zones'" class="tab-panel">
        <LandUseZonesManager 
          @refresh="refreshLandUseZones"
          :loading="loading"
          :zones="landUseZones"
          :pagination="zonesPagination"
        />
      </div>

      <!-- Development Matrix Tab -->
      <div v-if="activeTab === 'matrix'" class="tab-panel">
        <DevelopmentMatrixManager @changed="n => (matrixCount = n)" />
      </div>

      <!-- Analytics Tab -->
      <div v-if="activeTab === 'analytics'" class="tab-panel">
        <LandUseAnalytics 
          :groups="landUseGroups"
          :zones="landUseZones"
        />
      </div>
    </div>

    <!-- Loading Overlay -->
    <div v-if="loading" class="loading-overlay">
      <div class="loading-spinner">
        <p>Loading land use data</p>
      </div>
    </div>
    <UiFeedback :feedback="fb" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useUiFeedback, parseApiError } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import landUseService, { type LandUseGroup, type LandUseZone } from '../../services/landUseService'
import LandUseGroupsManager from '../../components/admin/land-use/LandUseGroupsManager.vue'
import LandUseZonesManager from '../../components/admin/land-use/LandUseZonesManager.vue'
import DevelopmentMatrixManager from '../../components/admin/land-use/DevelopmentMatrixManager.vue'
import LandUseAnalytics from '../../components/admin/land-use/LandUseAnalytics.vue'

const fb = useUiFeedback()

// State
const loading = ref(false)
const activeTab = ref('groups')
const landUseGroups = ref<LandUseGroup[]>([])
const landUseZones = ref<LandUseZone[]>([])
// Set by the matrix tab, which loads its own data (development_matrix).
const matrixCount = ref<number | null>(null)

// Pagination
const groupsPagination = ref({
  page: 1,
  limit: 50,
  total: 0,
  totalPages: 0
})

const zonesPagination = ref({
  page: 1,
  limit: 50,
  total: 0,
  totalPages: 0
})

// Tabs configuration
const tabs = computed(() => [
  {
    id: 'groups',
    label: 'Land Use Groups',
    count: landUseGroups.value.filter(g => g.is_active).length
  },
  {
    id: 'zones',
    label: 'Land Use Zones',
    count: landUseZones.value.length
  },
  {
    id: 'matrix',
    label: 'Development Matrix',
    count: matrixCount.value
  },
  {
    id: 'analytics',
    label: 'Analytics',
    count: null
  }
])

const loadError = ref('')

function normalizeGroup(g: any): LandUseGroup {
  return { ...g, id: g.id || g.group_id }
}

const refreshData = async () => {
  loading.value = true
  loadError.value = ''
  try {
    await Promise.all([
      refreshLandUseGroups(),
      refreshLandUseZones(),
    ])
  } catch (error: any) {
    loadError.value = parseApiError(error, 'Could not load land use data. Confirm the backend is running.')
    fb.showToast(loadError.value, 'error')
  } finally {
    loading.value = false
  }
}

const refreshLandUseGroups = async () => {
  const response = await landUseService.getLandUseGroups({
    page: groupsPagination.value.page,
    limit: groupsPagination.value.limit,
    is_active: undefined
  })
  landUseGroups.value = (response.data || []).map(normalizeGroup)
  groupsPagination.value = response.pagination
}

const refreshLandUseZones = async () => {
  const response = await landUseService.getLandUseZones({
    page: zonesPagination.value.page,
    limit: zonesPagination.value.limit,
    is_active: undefined
  })
  landUseZones.value = response.data || []
  zonesPagination.value = response.pagination
}

// Lifecycle
onMounted(async () => {
  await refreshData()
})
</script>

<style scoped>
.land-use-management {
  min-height: var(--ent-vh);
  background: #f8fafc;
}

.lu-banner {
  max-width: 1200px;
  margin: 1rem auto 0;
  padding: 0.65rem 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
  border-radius: 0.4rem;
  font-size: 0.85rem;
}
.lu-banner button {
  margin-left: auto;
  background: #fff;
  border: 1px solid #fde68a;
  border-radius: 0.3rem;
  padding: 0.25rem 0.6rem;
  cursor: pointer;
  color: #92400e;
}

.page-header {
  background: #ffffff;
  border-bottom: 1px solid #dadce0;
  padding: 1.5rem 0;
}

.header-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.title-section h1 {
  font-size: 1.375rem;
  font-weight: 600;
  color: #3c4043;
  margin: 0 0 0.5rem 0;
  letter-spacing: -0.01em;
}

.subtitle {
  color: #5a5a5a;
  margin: 0;
  font-size: 0.875rem;
}

.header-actions {
  display: flex;
  gap: 0.75rem;
}

.tabs-container {
  background: #ffffff;
  border-bottom: 1px solid #dadce0;
  position: sticky;
  top: 0;
  z-index: 10;
}

.tabs {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1.5rem;
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
}

.tab {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: #5a5a5a;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: color 160ms ease, border-color 160ms ease;
  white-space: nowrap;
}

.tab:hover {
  color: #3c4043;
}

.tab:focus-visible {
  outline: 2px solid #1a73e8;
  outline-offset: -2px;
}

.tab.active {
  color: #1a73e8;
  border-bottom-color: #1a73e8;
}

.tab-count {
  background: #ece9e0;
  color: #3c4043;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.tab.active .tab-count {
  background: #e8f0fe;
  color: #1557b0;
}

.tab-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1.5rem;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border: 1px solid #dadce0;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: #ffffff;
  color: #3c4043;
  border-color: #dadce0;
}

.btn-secondary:hover:not(:disabled) {
  background: #f5f3ee;
  border-color: #bdc1c6;
}

.btn-secondary:focus-visible {
  outline: 2px solid #1a73e8;
  outline-offset: 2px;
}

.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(245, 243, 238, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.loading-spinner {
  text-align: center;
  color: #5a5a5a;
}

.loading-spinner p {
  margin: 0;
  font-weight: 500;
}

@media (prefers-reduced-motion: reduce) {
  .tab, .btn { transition: none; }
}

/* Responsive */
@media (max-width: 768px) {
  .header-content {
    flex-direction: column;
    gap: 1rem;
    align-items: stretch;
  }

  .tabs {
    padding: 0 1rem;
  }

  .tab {
    padding: 0.75rem 1rem;
    font-size: 0.8rem;
  }

  .tab-content {
    padding: 1rem;
  }
}
</style>
