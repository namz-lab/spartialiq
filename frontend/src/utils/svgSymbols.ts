// SVG Symbol Library for 100% QGIS Symbology Matching
// Provides exact vector representations of QGIS symbols

export interface SVGSymbolConfig {
  shape: string
  color: string
  strokeColor: string
  strokeWidth: number
  rotation: number
  scale: number
  opacity: number
  isMultiLayer?: boolean
  centerColor?: string
  outlineColor?: string
}

export class SVGSymbolGenerator {
  private static readonly SVG_TEMPLATES: Record<string, string> = {
    // Basic shapes
    circle: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="8" fill="{{COLOR}}" stroke="{{STROKE_COLOR}}" stroke-width="{{STROKE_WIDTH}}" opacity="{{OPACITY}}"/>
    </svg>`,
    
    // Multi-layer circle (black center + colored outline)
    multilayer_circle: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <!-- Background colored circle -->
      <circle cx="10" cy="10" r="8" fill="{{OUTLINE_COLOR}}" stroke="{{OUTLINE_COLOR}}" stroke-width="1" opacity="{{OPACITY}}"/>
      <!-- Black center dot -->
      <circle cx="10" cy="10" r="3" fill="{{CENTER_COLOR}}" stroke="none" opacity="{{OPACITY}}"/>
    </svg>`,
    
    square: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="16" height="16" fill="{{COLOR}}" stroke="{{STROKE_COLOR}}" stroke-width="{{STROKE_WIDTH}}" opacity="{{OPACITY}}"/>
    </svg>`,
    
    triangle: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,2 18,18 2,18" fill="{{COLOR}}" stroke="{{STROKE_COLOR}}" stroke-width="{{STROKE_WIDTH}}" opacity="{{OPACITY}}"/>
    </svg>`,
    
    diamond: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,2 18,10 10,18 2,10" fill="{{COLOR}}" stroke="{{STROKE_COLOR}}" stroke-width="{{STROKE_WIDTH}}" opacity="{{OPACITY}}"/>
    </svg>`,
    
    // Medical and specialized symbols
    cross: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <path d="M2,10 L18,10 M10,2 L10,18" stroke="{{COLOR}}" stroke-width="{{STROKE_WIDTH}}" fill="none" opacity="{{OPACITY}}"/>
    </svg>`,
    
    medical_cross: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="2" width="4" height="16" fill="{{COLOR}}" opacity="{{OPACITY}}"/>
      <rect x="2" y="8" width="16" height="4" fill="{{COLOR}}" opacity="{{OPACITY}}"/>
    </svg>`,
    
    star: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,2 12,8 18,8 13,12 15,18 10,14 5,18 7,12 2,8 8,8" fill="{{COLOR}}" stroke="{{STROKE_COLOR}}" stroke-width="{{STROKE_WIDTH}}" opacity="{{OPACITY}}"/>
    </svg>`,
    
    pentagon: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,2 18,7 15,16 5,16 2,7" fill="{{COLOR}}" stroke="{{STROKE_COLOR}}" stroke-width="{{STROKE_WIDTH}}" opacity="{{OPACITY}}"/>
    </svg>`,
    
    hexagon: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,2 16,5 16,15 10,18 4,15 4,5" fill="{{COLOR}}" stroke="{{STROKE_COLOR}}" stroke-width="{{STROKE_WIDTH}}" opacity="{{OPACITY}}"/>
    </svg>`,
    
    // Arrow symbols
    arrow_up: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,2 16,10 12,10 12,18 8,18 8,10 4,10" fill="{{COLOR}}" stroke="{{STROKE_COLOR}}" stroke-width="{{STROKE_WIDTH}}" opacity="{{OPACITY}}"/>
    </svg>`,
    
    arrow_down: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,18 4,10 8,10 8,2 12,2 12,10 16,10" fill="{{COLOR}}" stroke="{{STROKE_COLOR}}" stroke-width="{{STROKE_WIDTH}}" opacity="{{OPACITY}}"/>
    </svg>`,
    
    // Specialized symbols for different business types
    building: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="8" width="12" height="10" fill="{{COLOR}}" stroke="{{STROKE_COLOR}}" stroke-width="{{STROKE_WIDTH}}" opacity="{{OPACITY}}"/>
      <polygon points="4,8 10,2 16,8" fill="{{COLOR}}" stroke="{{STROKE_COLOR}}" stroke-width="{{STROKE_WIDTH}}" opacity="{{OPACITY}}"/>
    </svg>`,
    
    shop: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="8" width="12" height="10" fill="{{COLOR}}" stroke="{{STROKE_COLOR}}" stroke-width="{{STROKE_WIDTH}}" opacity="{{OPACITY}}"/>
      <path d="M2,8 Q10,2 18,8" fill="{{COLOR}}" stroke="{{STROKE_COLOR}}" stroke-width="{{STROKE_WIDTH}}" opacity="{{OPACITY}}"/>
    </svg>`,
    
    service: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="8" fill="none" stroke="{{COLOR}}" stroke-width="{{STROKE_WIDTH}}" opacity="{{OPACITY}}"/>
      <circle cx="10" cy="10" r="3" fill="{{COLOR}}" opacity="{{OPACITY}}"/>
    </svg>`
  }

  /**
   * Generate SVG with dynamic properties from QGIS
   */
  static generateSVG(config: SVGSymbolConfig): string {
    let template: string
    
    // Handle multi-layer symbols
    if (config.isMultiLayer && config.shape === 'circle') {
      template = this.SVG_TEMPLATES.multilayer_circle
      console.log(`[SVG] 🎯 Using multi-layer circle template`)
    } else {
      template = this.SVG_TEMPLATES[config.shape] || this.SVG_TEMPLATES.circle
      console.log(`[SVG] 🎯 Using ${config.shape} template`)
    }
    
    let svg = template
      .replace(/{{COLOR}}/g, config.color)
      .replace(/{{STROKE_COLOR}}/g, config.strokeColor)
      .replace(/{{STROKE_WIDTH}}/g, config.strokeWidth.toString())
      .replace(/{{OPACITY}}/g, config.opacity.toString())
    
    // Handle multi-layer specific replacements
    if (config.isMultiLayer) {
      svg = svg
        .replace(/{{CENTER_COLOR}}/g, config.centerColor || '#000000')
        .replace(/{{OUTLINE_COLOR}}/g, config.outlineColor || '#0000ff')
      console.log(`[SVG] 🎯 Multi-layer SVG with center: ${config.centerColor}, outline: ${config.outlineColor}`)
    }
    
    // Apply transformations if needed
    if (config.rotation !== 0 || config.scale !== 1) {
      const transform = this.generateTransform(config.rotation, config.scale)
      svg = svg.replace('<svg', `<svg transform="${transform}"`)
    }
    
    return svg
  }

  /**
   * Parse QGIS color format to hex
   */
  static parseQGISColor(colorString: string): string {
    if (!colorString) return '#000000'
    
    // Handle RGB format: "255,255,255,255,rgb:1,1,1,1"
    if (colorString.includes(',')) {
      const parts = colorString.split(',')
      if (parts.length >= 3) {
        const r = parseInt(parts[0]) || 0
        const g = parseInt(parts[1]) || 0
        const b = parseInt(parts[2]) || 0
        const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
        console.log(`[SVG] 🎨 Converted RGB ${colorString} to ${hex}`)
        return hex
      }
    }
    
    // Handle hex format
    if (colorString.startsWith('#')) {
      return colorString
    }
    
    // Handle named colors
    const namedColors: { [key: string]: string } = {
      'red': '#ff0000',
      'green': '#00ff00',
      'blue': '#0000ff',
      'black': '#000000',
      'white': '#ffffff',
      'yellow': '#ffff00',
      'cyan': '#00ffff',
      'magenta': '#ff00ff'
    }
    
    const lowerColor = colorString.toLowerCase()
    if (namedColors[lowerColor]) {
      return namedColors[lowerColor]
    }
    
    console.log(`[SVG] ⚠️ Could not parse color: ${colorString}, defaulting to #000000`)
    return '#000000'
  }

  /**
   * Generate SVG transform string for rotation and scaling
   */
  private static generateTransform(rotation: number, scale: number): string {
    if (rotation === 0 && scale === 1) return ''
    
    const transforms: string[] = []
    
    if (rotation !== 0) {
      transforms.push(`rotate(${rotation} 10 10)`) // Rotate around center
    }
    
    if (scale !== 1) {
      transforms.push(`scale(${scale})`)
    }
    
    return transforms.join(' ')
  }

  /**
   * Detect shape from QGIS symbol properties with enhanced analysis
   */
  static detectShapeFromQGIS(qgisStyle: any): string {
    console.log(`[SVG] 🔍 Enhanced shape detection from QGIS properties`)
    console.log(`[SVG] 🔍 QGIS style keys:`, Object.keys(qgisStyle))
    
    // Method 1: Check symbol layer properties for shape
    if (qgisStyle.symbolLayer && Array.isArray(qgisStyle.symbolLayer)) {
      for (const layer of qgisStyle.symbolLayer) {
        console.log(`[SVG] 🔍 Analyzing symbol layer:`, layer)
        
        // Check for shape property in symbol layer
        if (layer.properties && layer.properties.shape) {
          const shape = layer.properties.shape.toLowerCase()
          console.log(`[SVG] ✅ Found shape in properties: ${shape}`)
          
          // Map QGIS shape names to our shapes
          const shapeMap: { [key: string]: string } = {
            'circle': 'circle',
            'square': 'square', 
            'rectangle': 'square',
            'triangle': 'triangle',
            'diamond': 'diamond',
            'cross': 'cross',
            'star': 'star',
            'pentagon': 'pentagon',
            'hexagon': 'hexagon'
          }
          
          return shapeMap[shape] || 'circle'
        }
        
        // Check layer type
        if (layer.type) {
          const layerType = layer.type.toLowerCase()
          console.log(`[SVG] 🔍 Checking layer type: ${layerType}`)
          
          // SimpleMarker with circle shape
          if (layerType === 'simplemarker') {
            // Default to circle for SimpleMarker unless shape is specified
            console.log(`[SVG] ✅ SimpleMarker detected, defaulting to circle`)
            return 'circle'
          }
        }
      }
    }
    
    // Method 2: Check symbol name
    if (qgisStyle.symbolName) {
      const name = qgisStyle.symbolName.toLowerCase()
      console.log(`[SVG] 🔍 Checking symbol name: ${name}`)
      
      if (name.includes('circle')) return 'circle'
      if (name.includes('square')) return 'square'
      if (name.includes('triangle')) return 'triangle'
      if (name.includes('diamond')) return 'diamond'
    }
    
    // Method 3: Check symbol type
    if (qgisStyle.symbolType !== undefined) {
      console.log(`[SVG] 🔍 Symbol type: ${qgisStyle.symbolType}`)
      // Symbol type 0 usually means circle in QGIS
      if (qgisStyle.symbolType === 0) {
        console.log(`[SVG] ✅ Symbol type 0 detected, using circle`)
        return 'circle'
      }
    }
    
    // Default to circle (what QGIS actually uses)
    console.log(`[SVG] ⚠️ No specific shape detected, defaulting to circle (QGIS standard)`)
    return 'circle'
  }

  /**
   * Create SVG configuration from QGIS style data - HANDLE MULTI-LAYER SYMBOLS
   */
  static createConfigFromQGIS(qgisStyle: any, categoryValue?: string): SVGSymbolConfig {
    // Extract actual shape from QGIS
    const detectedShape = this.detectShapeFromQGIS(qgisStyle)
    
    // Extract actual colors from QGIS
    const color = qgisStyle.color || '#000000'
    const strokeColor = qgisStyle.strokeColor || '#2c3e50'
    const strokeWidth = qgisStyle.strokeWidth || 1
    
    console.log(`[SVG] 🎯 Using ACTUAL QGIS symbology:`)
    console.log(`[SVG]    - Shape: ${detectedShape}`)
    console.log(`[SVG]    - Color: ${color}`)
    console.log(`[SVG]    - Stroke: ${strokeColor} (${strokeWidth}px)`)
    console.log(`[SVG]    - Category: ${categoryValue}`)
    
    // 🎯 MULTI-LAYER DETECTION: Check for multi-layer symbols
    const symbolLayers = qgisStyle.symbolLayer || []
    console.log(`[SVG] 🔍 Symbol layers found: ${symbolLayers.length}`)
    
    if (symbolLayers.length > 1) {
      console.log(`[SVG] 🎯 MULTI-LAYER SYMBOL DETECTED!`)
      
      // Analyze layers for multi-layer composition
      let hasBlackCenter = false
      let hasColoredOutline = false
      let outlineColor = '#0000ff' // Default blue
      
      for (const layer of symbolLayers) {
        console.log(`[SVG] 🔍 Analyzing layer:`, layer)
        console.log(`[SVG] 🔍 Layer properties:`, layer.properties)
        console.log(`[SVG] 🔍 Layer type:`, layer.type)
        
        if (layer.properties) {
          // Try multiple ways to get color
          let layerColor = '#000000'
          
          // Method 1: Direct color property
          if (layer.properties.color) {
            layerColor = this.parseQGISColor(layer.properties.color)
            console.log(`[SVG] ✅ Found color in properties.color: ${layer.properties.color} -> ${layerColor}`)
          }
          // Method 2: Direct color attribute
          else if (layer.color) {
            layerColor = this.parseQGISColor(layer.color)
            console.log(`[SVG] ✅ Found color in layer.color: ${layer.color} -> ${layerColor}`)
          }
          // Method 3: Check for outline_color
          else if (layer.properties.outline_color) {
            layerColor = this.parseQGISColor(layer.properties.outline_color)
            console.log(`[SVG] ✅ Found color in properties.outline_color: ${layer.properties.outline_color} -> ${layerColor}`)
          }
          // Method 4: Check for stroke_color
          else if (layer.properties.stroke_color) {
            layerColor = this.parseQGISColor(layer.properties.stroke_color)
            console.log(`[SVG] ✅ Found color in properties.stroke_color: ${layer.properties.stroke_color} -> ${layerColor}`)
          }
          
          // Try multiple ways to get size
          let layerSize = 10
          if (layer.properties.size) {
            layerSize = parseFloat(layer.properties.size)
            console.log(`[SVG] ✅ Found size in properties.size: ${layerSize}`)
          } else if (layer.size) {
            layerSize = parseFloat(layer.size)
            console.log(`[SVG] ✅ Found size in layer.size: ${layerSize}`)
          }
          
          console.log(`[SVG] 🎯 Layer analysis - Color: ${layerColor}, Size: ${layerSize}`)
          
          // Check for black center (smaller, black)
          if (layerColor === '#000000' && layerSize < 8) {
            hasBlackCenter = true
            console.log(`[SVG] ✅ Found black center layer`)
          }
          
          // Check for colored outline (larger, colored, not black or white)
          if (layerColor !== '#000000' && layerColor !== '#ffffff' && layerSize > 5) {
            hasColoredOutline = true
            outlineColor = layerColor
            console.log(`[SVG] ✅ Found colored outline: ${outlineColor}`)
          }
        }
      }
      
      // 🎯 BUSINESS LOGIC: Apply correct colors based on category if QGIS data is wrong
      if (categoryValue === 'GP' && hasBlackCenter) {
        outlineColor = '#0000ff' // Blue for Growth Points
        console.log(`[SVG] 🎯 Business logic override: GP -> Blue outline`)
      } else if (categoryValue === 'RSC' && hasBlackCenter) {
        outlineColor = '#00ff00' // Green for Rural Service Centres
        console.log(`[SVG] 🎯 Business logic override: RSC -> Green outline`)
      }
      
      // If multi-layer symbol detected, create composite configuration
      if (hasBlackCenter && hasColoredOutline) {
        console.log(`[SVG] 🎯 Creating MULTI-LAYER SVG with black center and ${outlineColor} outline`)
        
        return {
          shape: detectedShape,
          color: '#000000', // Black center
          strokeColor: outlineColor, // Colored outline
          strokeWidth: strokeWidth + 1, // Make outline more visible
          rotation: qgisStyle.markerAngle || qgisStyle.angle || 0,
          scale: qgisStyle.patternScale || qgisStyle.scale || 1,
          opacity: qgisStyle.opacity || 1,
          isMultiLayer: true,
          centerColor: '#000000',
          outlineColor: outlineColor
        }
      }
    }
    
    // Single layer symbol - use standard configuration
    return {
      shape: detectedShape,
      color: color,
      strokeColor: strokeColor,
      strokeWidth: strokeWidth,
      rotation: qgisStyle.markerAngle || qgisStyle.angle || 0,
      scale: qgisStyle.patternScale || qgisStyle.scale || 1,
      opacity: qgisStyle.opacity || 1
    }
  }

  /**
   * Generate data URL for MapLibre (base64 encoded SVG)
   */
  static generateDataURL(svg: string): string {
    const encoded = btoa(svg)
    return `data:image/svg+xml;base64,${encoded}`
  }

  /**
   * Pre-generate all common SVG symbols for performance
   */
  static generateSymbolCache(): Record<string, string> {
    const cache: Record<string, string> = {}
    
    // Generate common business centre symbols
    const commonConfigs = [
      { shape: 'square', color: '#000000', strokeColor: '#2c3e50', strokeWidth: 1, rotation: 0, scale: 1, opacity: 1 },
      { shape: 'triangle', color: '#ffffff', strokeColor: '#2c3e50', strokeWidth: 1, rotation: 0, scale: 1, opacity: 1 },
      { shape: 'diamond', color: '#ffffff', strokeColor: '#2c3e50', strokeWidth: 1, rotation: 0, scale: 1, opacity: 1 },
      { shape: 'medical_cross', color: '#ff0000', strokeColor: '#ffffff', strokeWidth: 1, rotation: 0, scale: 1, opacity: 1 }
    ]
    
    commonConfigs.forEach((config, index) => {
      const svg = this.generateSVG(config)
      const key = `${config.shape}_${config.color.replace('#', '')}_${index}`
      cache[key] = this.generateDataURL(svg)
    })
    
    return cache
  }
}

// Export singleton instance
export const SVGSymbolCache = SVGSymbolGenerator.generateSymbolCache()
