// Spatial service for Map Explorer - connects to PostgreSQL PostGIS database
import api from './api'

export async function listLandParcels(projectId = 'default-project') {
  try {
    const response = await api.get(`/spatial-data/land-parcels?project_id=${projectId}`)
    return response.data || []
  } catch (error) {
    console.error('Error loading land parcels:', error)
    return []
  }
}

export async function listCoordinatePoints(projectId = 'default-project') {
  try {
    const response = await api.get(`/spatial-data/coordinate-points?project_id=${projectId}`)
    return response.data || []
  } catch (error) {
    console.error('Error loading coordinate points:', error)
    return []
  }
}

// New function for proposed_peri_urban_zones dataset
export async function getProposedPeriUrbanZones() {
  try {
    const response = await api.get('/spatial-data/proposed-peri-urban-zones')
    return response.data || []
  } catch (error) {
    console.error('Error loading proposed peri-urban zones:', error)
    return []
  }
}

// Generic function to get any PostGIS layer
export async function getPostGISLayer(tableName: string, options: { bbox?: string; limit?: number; where?: string } = {}) {
  try {
    const params = new URLSearchParams()
    if (options.bbox) params.append('bbox', options.bbox)
    if (options.limit) params.append('limit', options.limit.toString())
    if (options.where) params.append('where', options.where)
    
    const response = await api.get(`/spatial/layer/${tableName}?${params}`)
    return response.data || []
  } catch (error) {
    console.error(`Error loading layer ${tableName}:`, error)
    return []
  }
}

// Function to get available PostGIS layers
export async function getAvailableLayers() {
  try {
    const response = await api.get('/spatial-data/layers')
    return response.data || []
  } catch (error) {
    console.error('Error getting available layers:', error)
    return []
  }
}
