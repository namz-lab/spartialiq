// src/services/catalogue.ts
// ---------------------------------------------------------------------------
// Client for the layer catalogue (/api/catalogue): what layers the portal has and how they are
// organised.
//
// THE QGIS PROJECT DECLARES, THE SERVER APPROVES
// The catalogue is built on the server from the QGIS project (which layers, which groups, which are
// switched on, the extent the author left the map on) and the server's approval list. This module
// holds no layer names, no groups and no defaults: it asks. A layer the project does not declare yet
// comes back under "Not yet in the QGIS project", so the screen never has to guess.
import api from './api'

export interface CatalogueLayer {
  /** The tile layer id when the table is served as vector tiles, otherwise the table name. */
  id: string
  table: string
  title: string
  /** The layer's name inside the QGIS project, when it is in the project. It can differ from the table. */
  projectName: string | null
  group: string[]
  geometryType: 'polygon' | 'line' | 'point' | null
  source: 'project' | 'legacy'
  inProject: boolean
  defaultVisible: boolean
  /** Served as vector tiles. Layers without tiles load when switched on. */
  tile: boolean
  audience: 'staff' | 'public'
}

export interface CatalogueGroup {
  name: string
  path: string[]
  layers: CatalogueLayer[]
}

export interface Catalogue {
  project: { title: string | null; savedAt: string | null; savedBy: string | null; extent: [number, number, number, number] | null }
  groups: CatalogueGroup[]
  layers: CatalogueLayer[]
}

export const NOT_IN_PROJECT = 'Not yet in the QGIS project'

let pending: Promise<Catalogue> | null = null

/** One fetch per page load, shared by every caller. A failure is not cached. */
export function getCatalogue(): Promise<Catalogue> {
  if (!pending) {
    pending = api.get('/catalogue').then((r) => r.data.data as Catalogue).catch((err) => {
      pending = null
      throw err
    })
  }
  return pending
}

/** A group the planner should not meet expanded: another authority's layers, and layers the project has yet to adopt. */
export const startsCollapsed = (groupName: string): boolean =>
  groupName === NOT_IN_PROJECT || /^other authorities/i.test(groupName)

/** The tile layers to draw on arrival: those the catalogue marks on. Null when there is no catalogue. */
export function defaultTileLayers(cat: Catalogue | null): Set<string> | null {
  return cat ? new Set(cat.layers.filter((l) => l.tile && l.defaultVisible).map((l) => l.id)) : null
}
