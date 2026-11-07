// Type declarations for missing modules

declare module '@turf/turf' {
  export * from '@turf/helpers'
  export function area(geojson: any): number
  export function bbox(geojson: any): [number, number, number, number]
  export function distance(from: any, to: any, options?: { units?: string }): number
  export function kinks(polygon: any): any
  export function booleanIntersects(a: any, b: any): boolean
  export function center(geojson: any): any
  export function centroid(geojson: any): any
  export function buffer(geojson: any, radius: number, options?: { units?: string }): any
  export function union(...polygons: any[]): any
  export function intersect(poly1: any, poly2: any): any | null
  export function length(geojson: any, options?: { units?: string }): number
}

declare module 'vue-toastification' {
  export interface ToastOptions {
    timeout?: number
    closeOnClick?: boolean
    pauseOnFocusLoss?: boolean
    pauseOnHover?: boolean
    draggable?: boolean
    draggablePercent?: number
    showCloseButtonOnHover?: boolean
    hideProgressBar?: boolean
    closeButton?: string | boolean
    icon?: string | boolean
    rtl?: boolean
  }

  export interface Toast {
    content: string
    id: number
    type: 'success' | 'error' | 'default' | 'info' | 'warning'
    isLoading?: boolean
    onClose?: () => void
    onClick?: () => void
  }

  export interface ToastContainerOptions {
    position?: 'top-right' | 'top-center' | 'top-left' | 'bottom-right' | 'bottom-center' | 'bottom-left'
    newestOnTop?: boolean
    maxToasts?: number
    zIndex?: number
    container?: HTMLElement
    timeout?: number
    closeOnClick?: boolean
    pauseOnFocusLoss?: boolean
    pauseOnHover?: boolean
    draggable?: boolean
    draggablePercent?: number
    showCloseButtonOnHover?: boolean
    hideProgressBar?: boolean
    closeButton?: string | boolean
    icon?: string | boolean
    rtl?: boolean
    toastClassName?: string | string[]
    bodyClassName?: string | string[]
    style?: Record<string, any>
  }

  export const useToast: () => {
    success: (message: string, options?: ToastOptions) => Toast
    error: (message: string, options?: ToastOptions) => Toast
    info: (message: string, options?: ToastOptions) => Toast
    warning: (message: string, options?: ToastOptions) => Toast
    default: (message: string, options?: ToastOptions) => Toast
    loading: (message: string, options?: ToastOptions) => Toast
    remove: (toast: Toast) => void
    clear: () => void
    updateDefaults: (defaults: ToastContainerOptions) => void
  }
}

// Icon classes declarations
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// CSS Modules
declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}

declare module '*.module.scss' {
  const classes: { readonly [key: string]: string }
  export default classes
}

declare module '*.module.sass' {
  const classes: { readonly [key: string]: string }
  export default classes
}

// Global styles
declare global {
  interface Window {
    // Add any global window properties here
  }
}

export {}
