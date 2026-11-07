/**
 * Land Use Management Service
 * Handles CRUD operations for land uses, zones, and development matrix
 */

import { apiBaseUrl } from './runtimeOrigin'

export interface LandUseGroup {
  id: string  // Primary key (matches backend)
  group_code: string
  description: string
  short_name?: string
  group_category: 'residential' | 'commercial' | 'industrial' | 'institutional' | 'recreational' | 'agricultural' | 'mixed'
  development_category: 'permitted' | 'prohibited' | 'special_consent'
  use_scale: 'small_scale' | 'large_scale' | 'mixed_scale' | 'all_scales'
  typical_floor_area_sqm?: number
  typical_height_meters?: number
  notes?: string
  is_active: boolean
  created_at: string
  updated_at?: string
  land_use_controls_count?: number
}

export interface LandUseZone {
  id: number
  zone_name: string
  zone_type: string
  scale_category?: 'small_scale' | 'large_scale' | 'mixed_scale'
  authority?: string
  zone_description?: string
  land_use_controls_count?: number
}

export interface PaginationParams {
  page?: number
  limit?: number
  search?: string
  is_active?: boolean
}

export interface PaginatedResponse<T> {
  success: boolean
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

class LandUseService {
  private baseUrl = `${apiBaseUrl()}/land-use`

  // ============================================
  // LAND USE GROUPS
  // ============================================

  async getLandUseGroups(params: PaginationParams & { 
    development_category?: 'permitted' | 'prohibited' | 'special_consent'
    use_scale?: 'small_scale' | 'large_scale' | 'mixed_scale' | 'all_scales'
    category?: string 
  } = {}): Promise<PaginatedResponse<LandUseGroup>> {
    const queryParams = new URLSearchParams()
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        queryParams.append(key, value.toString())
      }
    })

    const response = await fetch(`${this.baseUrl}/groups?${queryParams}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch land use groups: ${response.statusText}`)
    }
    
    return response.json()
  }

  async getLandUseGroup(id: string): Promise<{ success: boolean; data: LandUseGroup }> {
    const response = await fetch(`${this.baseUrl}/groups/${id}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch land use group: ${response.statusText}`)
    }
    
    return response.json()
  }

  async createLandUseGroup(group: Omit<LandUseGroup, 'id' | 'created_at' | 'updated_at'>): Promise<{ success: boolean; data: LandUseGroup }> {
    const response = await fetch(`${this.baseUrl}/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(group),
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `Failed to create land use group: ${response.statusText}`)
    }
    
    return response.json()
  }

  async updateLandUseGroup(id: string, updates: Partial<LandUseGroup>): Promise<{ success: boolean; data: LandUseGroup }> {
    const response = await fetch(`${this.baseUrl}/groups/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `Failed to update land use group: ${response.statusText}`)
    }
    
    return response.json()
  }

  async deleteLandUseGroup(id: string): Promise<{ success: boolean; data: LandUseGroup }> {
    const response = await fetch(`${this.baseUrl}/groups/${id}`, {
      method: 'DELETE',
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `Failed to delete land use group: ${response.statusText}`)
    }
    
    return response.json()
  }

  // ============================================
  // LAND USE ZONES
  // ============================================

  async getLandUseZones(params: PaginationParams & { 
    zone_type?: string
    scale_category?: 'small_scale' | 'large_scale' | 'mixed_scale'
    authority?: string 
  } = {}): Promise<PaginatedResponse<LandUseZone>> {
    const queryParams = new URLSearchParams()
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        queryParams.append(key, value.toString())
      }
    })

    const response = await fetch(`${this.baseUrl}/zones?${queryParams}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch land use zones: ${response.statusText}`)
    }
    
    return response.json()
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  async getLandUseCategories(): Promise<{ value: string; label: string; color: string }[]> {
    return [
      { value: 'residential', label: 'Residential', color: '#4CAF50' },
      { value: 'commercial', label: 'Commercial', color: '#2196F3' },
      { value: 'industrial', label: 'Industrial', color: '#FF9800' },
      { value: 'institutional', label: 'Institutional', color: '#9C27B0' },
      { value: 'recreational', label: 'Recreational', color: '#00BCD4' },
      { value: 'agricultural', label: 'Agricultural', color: '#8BC34A' },
      { value: 'mixed', label: 'Mixed Use', color: '#607D8B' },
    ]
  }

  async getPermissionTypes(): Promise<{ value: string; label: string; color: string }[]> {
    return [
      { value: 'permitted', label: 'Permitted', color: '#4CAF50' },
      { value: 'special_consent', label: 'Special Consent', color: '#FF9800' },
      { value: 'prohibited', label: 'Prohibited', color: '#F44336' },
    ]
  }

  formatLandUseGroup(group: LandUseGroup): string {
    return `${group.group_code} - ${group.description}`
  }

  formatLandUseZone(zone: LandUseZone): string {
    return `${zone.zone_name} (${zone.zone_type})`
  }

  getCategoryColor(category: string): string {
    const colors: Record<string, string> = {
      residential: '#4CAF50',
      commercial: '#2196F3',
      industrial: '#FF9800',
      institutional: '#9C27B0',
      recreational: '#00BCD4',
      agricultural: '#8BC34A',
      mixed: '#607D8B',
    }
    return colors[category] || '#757575'
  }

  getPermissionColor(permission: string): string {
    const colors: Record<string, string> = {
      permitted: '#4CAF50',
      special_consent: '#FF9800',
      prohibited: '#F44336',
    }
    return colors[permission] || '#757575'
  }
}

export const landUseService = new LandUseService()
export default landUseService
