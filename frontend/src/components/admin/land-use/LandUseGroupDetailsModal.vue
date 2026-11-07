<template>
  <div class="modal-overlay" @click="$emit('close')">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h2>Land Use Group Details</h2>
        <button @click="$emit('close')" class="btn-close">
          <i class="icon-x"></i>
        </button>
      </div>

      <div v-if="group" class="modal-body">
        <!-- Group Header -->
        <div class="group-header">
          <div class="group-badge" :style="{ backgroundColor: getCategoryColor(group.group_category) }">
            {{ group.group_code }}
          </div>
          <div class="group-info">
            <h3>{{ group.description }}</h3>
            <span class="category-badge" :style="{ backgroundColor: getCategoryColor(group.group_category) }">
              {{ formatCategory(group.group_category) }}
            </span>
          </div>
        </div>

        <!-- Details Grid -->
        <div class="details-grid">
          <div class="detail-item">
            <label>Group Code</label>
            <value>{{ group.group_code }}</value>
          </div>
          
          <div class="detail-item">
            <label>Description</label>
            <value>{{ group.description }}</value>
          </div>
          
          <div class="detail-item" v-if="group.short_name">
            <label>Short Name</label>
            <value>{{ group.short_name }}</value>
          </div>
          
          <div class="detail-item">
            <label>Category</label>
            <value>
              <span class="category-badge" :style="{ backgroundColor: getCategoryColor(group.group_category) }">
                {{ formatCategory(group.group_category) }}
              </span>
            </value>
          </div>
          
          <div class="detail-item" v-if="group.typical_floor_area_sqm">
            <label>Typical Floor Area</label>
            <value>{{ formatNumber(group.typical_floor_area_sqm) }} m²</value>
          </div>
          
          <div class="detail-item" v-if="group.typical_height_meters">
            <label>Typical Height</label>
            <value>{{ formatNumber(group.typical_height_meters) }} m</value>
          </div>
          
          <div class="detail-item">
            <label>Status</label>
            <value>
              <span :class="['status-badge', group.is_active ? 'active' : 'inactive']">
                {{ group.is_active ? 'Active' : 'Inactive' }}
              </span>
            </value>
          </div>
          
          <div class="detail-item">
            <label>Created</label>
            <value>{{ formatDate(group.created_at) }}</value>
          </div>
          
          <div class="detail-item">
            <label>Last Updated</label>
            <value>{{ group.updated_at ? formatDate(group.updated_at) : '—' }}</value>
          </div>
        </div>

        <!-- Notes Section -->
        <div v-if="group.notes" class="notes-section">
          <h4>Notes</h4>
          <p>{{ group.notes }}</p>
        </div>

        <!-- Usage Statistics -->
        <div class="usage-section">
          <h4>Usage Statistics</h4>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-value">{{ stats.matrixRules }}</div>
              <div class="stat-label">Matrix Rules</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ stats.applications }}</div>
              <div class="stat-label">Applications</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ stats.parcels }}</div>
              <div class="stat-label">Assigned Parcels</div>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button @click="$emit('close')" class="btn btn-secondary">
          Close
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { LandUseGroup } from '../../../services/landUseService'
import { getMatrixRules } from '@/services/developmentControl'

const props = defineProps<{
  group?: LandUseGroup | null
}>()

const emit = defineEmits<{
  close: []
}>()

// State
const stats = ref({
  matrixRules: 0,
  applications: 0,
  parcels: 0
})

// Categories
const categories = [
  { value: 'residential', label: 'Residential', color: '#4CAF50' },
  { value: 'commercial', label: 'Commercial', color: '#2196F3' },
  { value: 'industrial', label: 'Industrial', color: '#FF9800' },
  { value: 'institutional', label: 'Institutional', color: '#9C27B0' },
  { value: 'recreational', label: 'Recreational', color: '#00BCD4' },
  { value: 'agricultural', label: 'Agricultural', color: '#8BC34A' },
  { value: 'mixed', label: 'Mixed Use', color: '#607D8B' },
]

// Methods
const formatCategory = (category: string) => {
  const cat = categories.find(c => c.value === category)
  return cat ? cat.label : category
}

const getCategoryColor = (category: string) => {
  const cat = categories.find(c => c.value === category)
  return cat ? cat.color : '#757575'
}

const formatNumber = (num: number | null | undefined) => {
  return num !== null && num !== undefined ? num.toLocaleString() : '-'
}

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const loadUsageStats = async () => {
  if (!props.group) return

  try {
    // Get matrix rules for this group
    const rules = await getMatrixRules()
    stats.value.matrixRules = rules.filter(r => r.group_id === props.group!.id).length

    // Note: Applications and parcels stats would need to be implemented
    // based on your actual data structure and API endpoints
    stats.value.applications = 0 // Placeholder
    stats.value.parcels = 0 // Placeholder
  } catch (error) {
    console.error('Failed to load usage stats:', error)
  }
}

onMounted(() => {
  if (props.group) {
    loadUsageStats()
  }
})
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.modal-content {
  background: white;
  border-radius: 0.5rem;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  max-width: 700px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  padding: 1.5rem;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
}

.btn-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: none;
  background: none;
  color: #6b7280;
  cursor: pointer;
  border-radius: 0.25rem;
  transition: all 0.2s ease;
}

.btn-close:hover {
  background: #f3f4f6;
  color: #374151;
}

.modal-body {
  padding: 1.5rem;
}

.group-header {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 2rem;
  padding: 1rem;
  background: #f8fafc;
  border-radius: 0.5rem;
  border: 1px solid #e2e8f0;
}

.group-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 3rem;
  height: 3rem;
  padding: 0.5rem;
  border-radius: 0.25rem;
  color: white;
  font-weight: 700;
  font-size: 1.125rem;
}

.group-info h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
}

.category-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: white;
}

.details-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.detail-item label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.detail-item value {
  font-size: 0.875rem;
  color: #1f2937;
  font-weight: 500;
}

.status-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.status-badge.active {
  background: #dcfce7;
  color: #166534;
}

.status-badge.inactive {
  background: #fef2f2;
  color: #991b1b;
}

.notes-section {
  margin-bottom: 2rem;
  padding: 1rem;
  background: #fefce8;
  border-radius: 0.375rem;
  border: 1px solid #fde047;
}

.notes-section h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: #854d0e;
}

.notes-section p {
  margin: 0;
  color: #713f12;
  font-size: 0.875rem;
  line-height: 1.5;
}

.usage-section h4 {
  margin: 0 0 1rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: #1f2937;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
}

.stat-card {
  padding: 1rem;
  background: #f8fafc;
  border-radius: 0.375rem;
  border: 1px solid #e2e8f0;
  text-align: center;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.stat-label {
  font-size: 0.75rem;
  color: #6b7280;
  font-weight: 500;
}

.modal-footer {
  padding: 1.5rem;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: flex-end;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-secondary {
  background: white;
  color: #374151;
  border-color: #d1d5db;
}

.btn-secondary:hover {
  background: #f9fafb;
  border-color: #9ca3af;
}

/* Responsive */
@media (max-width: 640px) {
  .modal-content {
    margin: 0;
    max-height: var(--ent-vh);
    border-radius: 0;
  }

  .group-header {
    flex-direction: column;
    text-align: center;
  }

  .details-grid {
    grid-template-columns: 1fr;
  }

  .stats-grid {
    grid-template-columns: 1fr;
  }

  .modal-header,
  .modal-body,
  .modal-footer {
    padding: 1rem;
  }
}
</style>
