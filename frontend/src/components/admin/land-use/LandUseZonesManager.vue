<template>
  <div class="land-use-zones-manager">
    <!-- Header with Filter -->
    <div class="header-section">
      <div class="header-content">
        <h3>🗺️ Land Use Zones</h3>
        <div class="filters">
          <div class="filter-group">
            <label for="type-filter">Filter by Type:</label>
            <select 
              id="type-filter"
              v-model="selectedType"
              class="type-dropdown"
            >
              <option value="">All Types</option>
              <option 
                v-for="type in uniqueTypes" 
                :key="type" 
                :value="type"
              >
                {{ type }}
              </option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- Zones Content -->
    <div class="zones-content">
      <div v-if="filteredZones.length === 0" class="empty-state">
        <i class="icon-map"></i>
        <p>No zones available{{ selectedType ? ` for type "${selectedType}"` : '' }}</p>
      </div>
      
      <div v-else class="zones-grid">
        <div class="zones-header">
          <div class="header-cell">Zone Name</div>
          <div class="header-cell">Zone Type</div>
          <div class="header-cell">Scale Category</div>
          <div class="header-cell">Authority</div>
          <div class="header-cell">Controls Count</div>
        </div>
        
        <div 
          v-for="zone in filteredZones" 
          :key="zone.id"
          class="zones-row"
        >
          <div class="data-cell">{{ zone.zone_name }}</div>
          <div class="data-cell">{{ zone.zone_type || 'N/A' }}</div>
          <div class="data-cell">{{ zone.scale_category || 'N/A' }}</div>
          <div class="data-cell">{{ zone.authority || 'N/A' }}</div>
          <div class="data-cell">{{ zone.land_use_controls_count || 0 }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  loading: boolean
  zones: any[]
  pagination: any
}>()

const emit = defineEmits<{
  refresh: []
}>()

// State
const selectedType = ref('')

// Computed properties
const uniqueTypes = computed(() => {
  const types = new Set<string>()
  props.zones.forEach(zone => {
    if (zone.zone_type) {
      types.add(zone.zone_type)
    }
  })
  return Array.from(types).sort()
})

const filteredZones = computed(() => {
  if (!selectedType.value) {
    return props.zones
  }
  return props.zones.filter(zone => 
    zone.zone_type === selectedType.value
  )
})
</script>

<style scoped>
.land-use-zones-manager {
  background: white;
  border-radius: 0.5rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.header-section {
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  padding: 1.5rem 2rem;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 2rem;
}

.header-content h3 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: #1e293b;
}

.filters {
  display: flex;
  gap: 1rem;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.filter-group label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #475569;
}

.type-dropdown {
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  background: white;
  color: #374151;
  min-width: 200px;
}

.type-dropdown:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.zones-content {
  padding: 2rem;
}

.empty-state {
  text-align: center;
  color: #6b7280;
  padding: 3rem 1rem;
}

.empty-state i {
  font-size: 3rem;
  margin-bottom: 1rem;
  color: #d1d5db;
}

.empty-state p {
  margin: 0;
  font-size: 1rem;
}

.zones-grid {
  display: flex;
  flex-direction: column;
  border: 1px solid #e2e8f0;
  border-radius: 0.5rem;
  overflow: hidden;
}

.zones-header {
  display: grid;
  grid-template-columns: 2fr 1.5fr 1.5fr 1.5fr 1fr;
  gap: 1px;
  background: #f8fafc;
}

.header-cell {
  padding: 1rem;
  font-weight: 600;
  font-size: 0.875rem;
  color: #374151;
  background: #f1f5f9;
  text-align: left;
}

.zones-row {
  display: grid;
  grid-template-columns: 2fr 1.5fr 1.5fr 1.5fr 1fr;
  gap: 1px;
  background: white;
  transition: background-color 0.2s ease;
}

.zones-row:hover {
  background: #f8fafc;
}

.data-cell {
  padding: 1rem;
  font-size: 0.875rem;
  color: #374151;
  border-bottom: 1px solid #f1f5f9;
}

/* Responsive */
@media (max-width: 1024px) {
  .header-content {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .filters {
    justify-content: center;
  }

  .zones-header,
  .zones-row {
    grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
  }

  .header-cell,
  .data-cell {
    padding: 0.75rem 0.5rem;
    font-size: 0.8rem;
  }
}

@media (max-width: 768px) {
  .header-section,
  .zones-content {
    padding: 1rem;
  }

  .zones-header,
  .zones-row {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .header-cell,
  .data-cell {
    padding: 0.5rem;
    font-size: 0.75rem;
  }

  .header-cell:not(:first-child),
  .data-cell:not(:first-child) {
    border-top: 1px solid #e2e8f0;
  }
}
</style>
