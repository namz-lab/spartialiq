<template>
  <div class="modal-overlay" @click="$emit('cancel')">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h2>{{ isEditing ? 'Edit Land Use Group' : 'Create Land Use Group' }}</h2>
        <button @click="$emit('cancel')" class="btn-close">
          <i class="icon-x"></i>
        </button>
      </div>

      <form @submit.prevent="handleSubmit" class="modal-body">
        <div class="form-grid">
          <!-- Group Code -->
          <div class="form-group">
            <label for="group_code">Group Code *</label>
            <input
              id="group_code"
              v-model="formData.group_code"
              type="text"
              required
              maxlength="10"
              placeholder="e.g., A1, B2, C3"
              :disabled="isEditing"
            />
            <small>Unique identifier for this land use group</small>
          </div>

          <!-- Description -->
          <div class="form-group full-width">
            <label for="description">Description *</label>
            <input
              id="description"
              v-model="formData.description"
              type="text"
              required
              maxlength="255"
              placeholder="e.g., Single Family Residential"
            />
          </div>

          <!-- Short Name -->
          <div class="form-group">
            <label for="short_name">Short Name</label>
            <input
              id="short_name"
              v-model="formData.short_name"
              type="text"
              maxlength="100"
              placeholder="e.g., Single Family"
            />
          </div>

          <!-- Category -->
          <div class="form-group">
            <label for="group_category">Category *</label>
            <select
              id="group_category"
              v-model="formData.group_category"
              required
            >
              <option value="">Select a category</option>
              <option
                v-for="category in categories"
                :key="category.value"
                :value="category.value"
              >
                {{ category.label }}
              </option>
            </select>
          </div>

          <!-- Typical Floor Area -->
          <div class="form-group">
            <label for="typical_floor_area_sqm">Typical Floor Area (m²)</label>
            <input
              id="typical_floor_area_sqm"
              v-model.number="formData.typical_floor_area_sqm"
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g., 150"
            />
          </div>

          <!-- Typical Height -->
          <div class="form-group">
            <label for="typical_height_meters">Typical Height (m)</label>
            <input
              id="typical_height_meters"
              v-model.number="formData.typical_height_meters"
              type="number"
              min="0"
              step="0.1"
              placeholder="e.g., 6.5"
            />
          </div>

          <!-- Notes -->
          <div class="form-group full-width">
            <label for="notes">Notes</label>
            <textarea
              id="notes"
              v-model="formData.notes"
              rows="3"
              placeholder="Additional notes or requirements for this land use group..."
            ></textarea>
          </div>

          <!-- Active Status -->
          <div class="form-group full-width">
            <label class="checkbox-label">
              <input
                type="checkbox"
                v-model="formData.is_active"
              />
              <span class="checkmark"></span>
              Active
            </label>
            <small>Only active land use groups will be available for new applications</small>
          </div>
        </div>

        <!-- Category Preview -->
        <div v-if="formData.group_category" class="category-preview">
          <div class="preview-badge" :style="{ backgroundColor: getCategoryColor(formData.group_category) }">
            <i :class="getCategoryIcon(formData.group_category)"></i>
            <span>{{ formatCategory(formData.group_category) }}</span>
          </div>
          <p>This land use group will appear as <strong>{{ formData.group_code }}</strong> in applications and permits.</p>
        </div>
      </form>

      <div class="modal-footer">
        <button type="button" @click="$emit('cancel')" class="btn btn-secondary">
          Cancel
        </button>
        <button type="submit" @click="handleSubmit" class="btn btn-primary" :disabled="saving">
          <i v-if="saving" class="icon-spinner"></i>
          {{ saving ? 'Saving...' : (isEditing ? 'Update Group' : 'Create Group') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
// import { useToast } from 'vue-toastification'
import type { LandUseGroup } from '../../../services/landUseService'

const props = defineProps<{
  group?: LandUseGroup | null
  categories: Array<{ value: string; label: string; color: string }>
}>()

const emit = defineEmits<{
  save: [data: Partial<LandUseGroup>]
  cancel: []
}>()

// Simple toast replacement
const toast = {
  success: (message: string) => console.log('✅', message),
  error: (message: string) => console.error('❌', message)
}

// State
const saving = ref(false)

// Form data
const formData = ref({
  group_code: '',
  description: '',
  short_name: '',
  group_category: '',
  typical_floor_area_sqm: null as number | null,
  typical_height_meters: null as number | null,
  notes: '',
  is_active: true
})

// Computed
const isEditing = computed(() => !!props.group)

// Methods
const formatCategory = (category: string) => {
  const cat = props.categories.find(c => c.value === category)
  return cat ? cat.label : category
}

const getCategoryColor = (category: string) => {
  const cat = props.categories.find(c => c.value === category)
  return cat ? cat.color : '#757575'
}

const getCategoryIcon = (category: string) => {
  const icons: Record<string, string> = {
    residential: 'icon-home',
    commercial: 'icon-shopping-cart',
    industrial: 'icon-industry',
    institutional: 'icon-building',
    recreational: 'icon-tree',
    agricultural: 'icon-tractor',
    mixed: 'icon-layers'
  }
  return icons[category] || 'icon-tag'
}

const validateForm = () => {
  if (!formData.value.group_code.trim()) {
    toast.error('Group code is required')
    return false
  }

  if (!formData.value.description.trim()) {
    toast.error('Description is required')
    return false
  }

  if (!formData.value.group_category) {
    toast.error('Category is required')
    return false
  }

  if (formData.value.group_code.length > 10) {
    toast.error('Group code must be 10 characters or less')
    return false
  }

  if (formData.value.description.length > 255) {
    toast.error('Description must be 255 characters or less')
    return false
  }

  return true
}

const handleSubmit = async () => {
  if (!validateForm()) {
    return
  }

  saving.value = true

  try {
    // Prepare data for submission
    const submitData: Partial<LandUseGroup> = {
      group_code: formData.value.group_code.trim().toUpperCase(),
      description: formData.value.description.trim(),
      short_name: formData.value.short_name?.trim() || undefined,
      notes: formData.value.notes?.trim() || undefined,
      typical_floor_area_sqm: formData.value.typical_floor_area_sqm ?? undefined,
      typical_height_meters: formData.value.typical_height_meters ?? undefined,
      group_category: formData.value.group_category as LandUseGroup['group_category'],
      is_active: formData.value.is_active
    }

    emit('save', submitData)
  } catch (error: any) {
    toast.error(error.message || 'Failed to save land use group')
  } finally {
    saving.value = false
  }
}

// Initialize form data when editing
const initializeFormData = () => {
  if (props.group) {
    formData.value = {
      group_code: props.group.group_code,
      description: props.group.description,
      short_name: props.group.short_name || '',
      group_category: props.group.group_category,
      typical_floor_area_sqm: props.group.typical_floor_area_sqm ?? null,
      typical_height_meters: props.group.typical_height_meters ?? null,
      notes: props.group.notes || '',
      is_active: props.group.is_active
    }
  } else {
    // Reset form for new group
    formData.value = {
      group_code: '',
      description: '',
      short_name: '',
      group_category: '',
      typical_floor_area_sqm: null,
      typical_height_meters: null,
      notes: '',
      is_active: true
    }
  }
}

onMounted(() => {
  initializeFormData()
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
  max-width: 600px;
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

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
}

.form-group.full-width {
  grid-column: 1 / -1;
}

.form-group label {
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: #374151;
  font-size: 0.875rem;
}

.form-group input,
.form-group select,
.form-group textarea {
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  transition: border-color 0.2s ease;
}

.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-group input:disabled {
  background: #f9fafb;
  color: #6b7280;
  cursor: not-allowed;
}

.form-group small {
  margin-top: 0.25rem;
  color: #6b7280;
  font-size: 0.75rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  font-weight: 500;
  color: #374151;
  font-size: 0.875rem;
}

.checkbox-label input[type="checkbox"] {
  width: 1rem;
  height: 1rem;
  margin: 0;
}

.category-preview {
  margin-top: 1.5rem;
  padding: 1rem;
  background: #f8fafc;
  border-radius: 0.375rem;
  border: 1px solid #e2e8f0;
}

.preview-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.25rem;
  color: white;
  font-weight: 500;
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
}

.category-preview p {
  margin: 0;
  color: #6b7280;
  font-size: 0.875rem;
}

.modal-footer {
  padding: 1.5rem;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: flex-end;
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

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

.btn-primary:hover:not(:disabled) {
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

.icon-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Responsive */
@media (max-width: 640px) {
  .modal-content {
    margin: 0;
    max-height: var(--ent-vh);
    border-radius: 0;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .modal-header,
  .modal-body,
  .modal-footer {
    padding: 1rem;
  }
}
</style>
