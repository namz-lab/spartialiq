<template>
  <div class="land-use-groups-manager">
    <!-- Actions Bar -->
    <div class="actions-bar">
      <div class="search-filters">
        <div class="search-box">
          <i class="icon-search"></i>
          <input 
            v-model="searchQuery" 
            type="text" 
            placeholder="Search land use groups..."
            @input="debouncedSearch"
          />
        </div>
        <select v-model="categoryFilter" @change="filterGroups" class="filter-select">
          <option value="">All Categories</option>
          <option 
            v-for="category in categories" 
            :key="category.value" 
            :value="category.value"
          >
            {{ category.label }}
          </option>
        </select>
        <select v-model="activeFilter" @change="filterGroups" class="filter-select">
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>
      <div class="action-buttons">
        <button @click="showCreateModal = true" class="btn btn-primary">
          <i class="icon-plus"></i>
          Add Land Use Group
        </button>
        <button @click="exportGroups" class="btn btn-secondary">
          <i class="icon-download"></i>
          Export
        </button>
      </div>
    </div>

    <!-- Groups Table -->
    <div class="table-container" v-if="props.groups && Array.isArray(props.groups)">
      <table class="groups-table">
        <thead>
          <tr>
            <th @click="sortBy('group_code')" class="sortable">
              Code
              <i :class="getSortIcon('group_code')"></i>
            </th>
            <th @click="sortBy('description')" class="sortable">
              Description
              <i :class="getSortIcon('description')"></i>
            </th>
            <th @click="sortBy('group_category')" class="sortable">
              Category
              <i :class="getSortIcon('group_category')"></i>
            </th>
            <th>Short Name</th>
            <th @click="sortBy('typical_floor_area_sqm')" class="sortable">
              Floor Area (m²)
              <i :class="getSortIcon('typical_floor_area_sqm')"></i>
            </th>
            <th @click="sortBy('typical_height_meters')" class="sortable">
              Height (m)
              <i :class="getSortIcon('typical_height_meters')"></i>
            </th>
            <th @click="sortBy('is_active')" class="sortable">
              Status
              <i :class="getSortIcon('is_active')"></i>
            </th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="group in sortedGroups" :key="group.id" :class="{ inactive: !group.is_active }">
            <td>
              <span class="code-badge" :style="{ backgroundColor: getCategoryColor(group.group_category) }">
                {{ group.group_code }}
              </span>
            </td>
            <td class="description-cell">
              <div>
                <strong>{{ group.description }}</strong>
                <p v-if="group.notes" class="notes">{{ group.notes }}</p>
              </div>
            </td>
            <td>
              <span class="category-badge" :style="{ backgroundColor: getCategoryColor(group.group_category) }">
                {{ formatCategory(group.group_category) }}
              </span>
            </td>
            <td>{{ group.short_name || '-' }}</td>
            <td>{{ formatNumber(group.typical_floor_area_sqm) }}</td>
            <td>{{ formatNumber(group.typical_height_meters) }}</td>
            <td>
              <span :class="['status-badge', group.is_active ? 'active' : 'inactive']">
                {{ group.is_active ? 'Active' : 'Inactive' }}
              </span>
            </td>
            <td>
              <div class="action-buttons-cell">
                <button @click="editGroup(group)" class="btn-icon" title="Edit">
                  <i class="icon-edit"></i>
                </button>
                <button @click="viewGroup(group)" class="btn-icon" title="View Details">
                  <i class="icon-eye"></i>
                </button>
                <button 
                  @click="deleteGroup(group)" 
                  class="btn-icon btn-danger" 
                  :disabled="isGroupInUse(group.id)"
                  :title="isGroupInUse(group.id) ? 'Cannot delete - group is in use' : 'Delete'"
                >
                  <i class="icon-trash"></i>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      
      <!-- Empty State -->
      <div v-if="sortedGroups.length === 0 && !loading" class="empty-state">
        <i class="icon-layers"></i>
        <h3>No land use groups found</h3>
        <p>Get started by creating your first land use group.</p>
        <button @click="showCreateModal = true" class="btn btn-primary">
          <i class="icon-plus"></i>
          Create Land Use Group
        </button>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="pagination.totalPages > 1" class="pagination">
      <button 
        @click="changePage(pagination.page - 1)" 
        :disabled="pagination.page <= 1"
        class="btn btn-secondary"
      >
        <i class="icon-chevron-left"></i>
        Previous
      </button>
      <span class="page-info">
        Page {{ pagination.page }} of {{ pagination.totalPages }}
        ({{ pagination.total }} total)
      </span>
      <button 
        @click="changePage(pagination.page + 1)" 
        :disabled="pagination.page >= pagination.totalPages"
        class="btn btn-secondary"
      >
        Next
        <i class="icon-chevron-right"></i>
      </button>
    </div>

    <!-- Create/Edit Modal -->
    <LandUseGroupModal
      v-if="showCreateModal || showEditModal"
      :group="editingGroup"
      :categories="categories"
      @save="handleSave"
      @cancel="closeModal"
    />

    <!-- View Details Modal -->
    <LandUseGroupDetailsModal
      v-if="showDetailsModal"
      :group="viewingGroup"
      @close="showDetailsModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
// import { useToast } from 'vue-toastification'

// Simple debounce function since lodash-es might not be available
function debounce<T extends (...args: any[]) => any>(func: T, wait: number): T {
  let timeout: ReturnType<typeof setTimeout>
  return ((...args: any[]) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }) as T
}

import landUseService, { type LandUseGroup } from '../../../services/landUseService'
import LandUseGroupModal from './LandUseGroupModal.vue'
import LandUseGroupDetailsModal from './LandUseGroupDetailsModal.vue'

const props = defineProps<{
  loading: boolean
  groups: LandUseGroup[]
  zones: any[]
  pagination: any
}>()

const emit = defineEmits<{
  refresh: []
}>()

// Simple toast replacement
const toast = {
  success: (message: string) => console.log('✅', message),
  error: (message: string) => console.error('❌', message)
}

// State
const searchQuery = ref('')
const categoryFilter = ref('')
const activeFilter = ref('')
const sortField = ref('group_code')
const sortDirection = ref<'asc' | 'desc'>('asc')

// Modals
const showCreateModal = ref(false)
const showEditModal = ref(false)
const showDetailsModal = ref(false)
const editingGroup = ref<LandUseGroup | null>(null)
const viewingGroup = ref<LandUseGroup | null>(null)

// Categories
const categories = computed(() => {
  if (!props.zones || !Array.isArray(props.zones)) {
    return []
  }

  const uniqueZones = new Set<string>()
  props.zones.forEach(zone => {
    if (zone && zone.zone_name) {
      uniqueZones.add(zone.zone_name)
    }
  })

  // Color palette for categories
  const colors = [
    '#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#00BCD4', 
    '#8BC34A', '#607D8B', '#FF5722', '#795548', '#9E9E9E',
    '#3F51B5', '#E91E63', '#009688', '#CDDC39', '#FFC107'
  ]

  const sortedZones = Array.from(uniqueZones).sort()
  return sortedZones.map((zoneName, index) => ({
    value: zoneName.toLowerCase().replace(/[^a-z0-9]/g, '_'),
    label: zoneName,
    color: colors[index % colors.length]
  }))
})

// Computed
const filteredGroups = computed(() => {
  if (!props.groups || !Array.isArray(props.groups)) {
    return []
  }
  
  let filtered = [...props.groups]
  
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    filtered = filtered.filter(group => 
      group.group_code.toLowerCase().includes(query) ||
      group.description.toLowerCase().includes(query) ||
      group.short_name?.toLowerCase().includes(query) ||
      group.notes?.toLowerCase().includes(query)
    )
  }
  
  if (categoryFilter.value) {
    filtered = filtered.filter(group => group.group_category === categoryFilter.value)
  }
  
  if (activeFilter.value !== '') {
    filtered = filtered.filter(group => group.is_active === (activeFilter.value === 'true'))
  }
  
  return filtered
})

const sortedGroups = computed(() => {
  const groups = filteredGroups.value
  if (!groups || groups.length === 0) {
    return []
  }
  
  const sorted = [...groups]
  sorted.sort((a, b) => {
    let aVal = a[sortField.value as keyof LandUseGroup]
    let bVal = b[sortField.value as keyof LandUseGroup]
    
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      aVal = aVal.toLowerCase()
      bVal = bVal.toLowerCase()
    }
    
    if (aVal === undefined || bVal === undefined) return 0
    if (aVal < bVal) return sortDirection.value === 'asc' ? -1 : 1
    if (aVal > bVal) return sortDirection.value === 'asc' ? 1 : -1
    return 0
  })
  return sorted
})

// Methods
const debouncedSearch = debounce(() => {
  // Search is handled by computed property
}, 300)

const sortBy = (field: string) => {
  if (sortField.value === field) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortField.value = field
    sortDirection.value = 'asc'
  }
}

const getSortIcon = (field: string) => {
  if (sortField.value !== field) return 'icon-sort'
  return sortDirection.value === 'asc' ? 'icon-sort-up' : 'icon-sort-down'
}

const formatCategory = (category: string) => {
  const cat = categories.value.find(c => c.value === category)
  return cat ? cat.label : category
}

const getCategoryColor = (category: string) => {
  const cat = categories.value.find(c => c.value === category)
  return cat ? cat.color : '#757575'
}

const formatNumber = (num: number | null | undefined) => {
  return num !== null && num !== undefined ? num.toLocaleString() : '-'
}

const isGroupInUse = (groupId: string) => {
  // This would need to be implemented based on your business logic
  // For now, return false to allow deletion
  return false
}

const editGroup = (group: LandUseGroup) => {
  editingGroup.value = { ...group }
  showEditModal.value = true
}

const viewGroup = (group: LandUseGroup) => {
  viewingGroup.value = group
  showDetailsModal.value = true
}

const deleteGroup = async (group: LandUseGroup) => {
  if (!confirm(`Are you sure you want to delete the land use group "${group.group_code} - ${group.description}"?`)) {
    return
  }
  
  try {
    await landUseService.deleteLandUseGroup(group.id)
    toast.success('Land use group deleted successfully')
    emit('refresh')
  } catch (error: any) {
    toast.error(error.message || 'Failed to delete land use group')
  }
}

const handleSave = async (groupData: Partial<LandUseGroup>) => {
  try {
    if (editingGroup.value) {
      // Update existing group
      await landUseService.updateLandUseGroup(editingGroup.value.id, groupData)
      toast.success('Land use group updated successfully')
    } else {
      // Create new group
      await landUseService.createLandUseGroup(groupData as Omit<LandUseGroup, 'id' | 'created_at' | 'updated_at'>)
      toast.success('Land use group created successfully')
    }
    
    closeModal()
    emit('refresh')
  } catch (error: any) {
    toast.error(error.message || 'Failed to save land use group')
  }
}

const closeModal = () => {
  showCreateModal.value = false
  showEditModal.value = false
  editingGroup.value = null
}

const changePage = (page: number) => {
  // This would need to be implemented to handle pagination
  console.log('Change to page:', page)
}

const filterGroups = () => {
  // Filtering is handled by computed property
}

const exportGroups = () => {
  // Implement export functionality
  const csv = [
    ['Code', 'Description', 'Category', 'Short Name', 'Floor Area', 'Height', 'Status'].join(','),
    ...sortedGroups.value.map(group => [
      group.group_code,
      group.description,
      group.group_category,
      group.short_name || '',
      group.typical_floor_area_sqm || '',
      group.typical_height_meters || '',
      group.is_active ? 'Active' : 'Inactive'
    ].join(','))
  ].join('\n')
  
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'land-use-groups.csv'
  a.click()
  URL.revokeObjectURL(url)
  
  toast.success('Land use groups exported successfully')
}
</script>

<style scoped>
.land-use-groups-manager {
  background: white;
  border-radius: 0.5rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
}

.actions-bar {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.search-filters {
  display: flex;
  gap: 0.75rem;
  flex: 1;
  min-width: 0;
}

.search-box {
  position: relative;
  flex: 1;
  max-width: 300px;
}

.search-box i {
  position: absolute;
  left: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  color: #9ca3af;
}

.search-box input {
  width: 100%;
  padding: 0.5rem 0.75rem 0.5rem 2.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 0.875rem;
}

.filter-select {
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  background: white;
}

.action-buttons {
  display: flex;
  gap: 0.75rem;
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

.btn-primary {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

.btn-primary:hover {
  background: #2563eb;
  border-color: #2563eb;
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

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.table-container {
  overflow-x: auto;
}

.groups-table {
  width: 100%;
  border-collapse: collapse;
}

.groups-table th {
  padding: 0.75rem 1rem;
  text-align: left;
  font-size: 0.75rem;
  font-weight: 600;
  color: #6b7280;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  cursor: pointer;
  user-select: none;
}

.groups-table th.sortable:hover {
  background: #f3f4f6;
}

.groups-table td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e5e7eb;
  font-size: 0.875rem;
}

.groups-table tr.inactive {
  opacity: 0.6;
  background: #f9fafb;
}

.code-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-weight: 600;
  font-size: 0.75rem;
  color: white;
}

.category-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: white;
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

.description-cell strong {
  display: block;
  margin-bottom: 0.25rem;
}

.notes {
  margin: 0;
  color: #6b7280;
  font-size: 0.75rem;
  font-style: italic;
}

.action-buttons-cell {
  display: flex;
  gap: 0.5rem;
}

.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  background: white;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-icon:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
  color: #374151;
}

.btn-icon.btn-danger {
  color: #dc2626;
  border-color: #fecaca;
}

.btn-icon.btn-danger:hover {
  background: #fef2f2;
  border-color: #fca5a5;
}

.btn-icon:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.empty-state {
  text-align: center;
  padding: 4rem 2rem;
  color: #6b7280;
}

.empty-state i {
  font-size: 3rem;
  margin-bottom: 1rem;
  color: #d1d5db;
}

.empty-state h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1.125rem;
  font-weight: 600;
}

.empty-state p {
  margin: 0 0 1.5rem 0;
}

.pagination {
  padding: 1rem 1.5rem;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.page-info {
  color: #6b7280;
  font-size: 0.875rem;
}

/* Responsive */
@media (max-width: 768px) {
  .actions-bar {
    flex-direction: column;
    align-items: stretch;
  }

  .search-filters {
    flex-direction: column;
  }

  .search-box {
    max-width: none;
  }

  .action-buttons {
    justify-content: center;
  }

  .groups-table {
    font-size: 0.75rem;
  }

  .groups-table th,
  .groups-table td {
    padding: 0.5rem;
  }

  .action-buttons-cell {
    flex-direction: column;
  }
}
</style>
