# Design

Visual system for the Vungu RDC planning portal. The map is the spine of the product, so this document weights cartographic guidance heavily.

## Theme

Light, warm-neutral. A council planning officer at a desk in Vungu, working two-monitor with maps open all day under fluorescent office light and afternoon sun. Light theme keeps text legible against the warm light and matches the printed cartography council staff still cross-reference. Dark theme is not provided; there is no scene that forces it.

## Color Palette

Source uses OKLCH; hex equivalents below are for reference. Every neutral is tinted toward warm yellow (chroma roughly 0.008) so the palette holds together across elevations.

### Surface
| Token              | Hex     | Use |
|--------------------|---------|-----|
| `--surface-base`   | #f5f3ee | paper-warm; the land base on the map and the page background |
| `--surface-raised` | #ffffff | cards, modals, popups |
| `--surface-sunken` | #ece9e0 | muted panels, disabled fields |

### Text
| Token              | Hex     | Use |
|--------------------|---------|-----|
| `--text-primary`   | #3c4043 | headings, body, primary labels (Google primary grey) |
| `--text-secondary` | #5a5a5a | muted text, road labels, secondary meta |
| `--text-tertiary`  | #9aa0a6 | ward labels, placeholder, helper |
| `--text-on-color`  | #ffffff | on accent surfaces only |

### Borders
| Token              | Hex     | Use |
|--------------------|---------|-----|
| `--border-default` | #dadce0 | card borders, input outlines, building strokes |
| `--border-strong`  | #bdc1c6 | focused inputs, district lines |

### Accent (one saturated colour, at most 10 % of any surface)
| Token            | Hex     | Use |
|------------------|---------|-----|
| `--accent`       | #1a73e8 | primary actions, transit POIs, selected map features |
| `--accent-hover` | #1557b0 | hover state |
| `--accent-soft`  | #e8f0fe | accent-tinted backgrounds |

### Functional
| Token       | Hex     | Use |
|-------------|---------|-----|
| `--danger`  | #d93025 | destructive actions, validation errors |
| `--success` | #1e8e3e | confirmations |
| `--warning` | #f9ab00 | committee-stage flags |

The cartographic palette is its own taxonomy and lives in `## Map Cartographic System` below. UI accents do not bleed into cartography and vice versa.

## Typography

System UI stack. No web-font dependency: too heavy for rural-bandwidth users and any custom font would feel marketing-y, against the brand.

```css
font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
```

### Scale (1.25 ratio)
| Token         | Size / line | Use |
|---------------|-------------|-----|
| `--text-xs`   | 11 / 16     | helper, eyebrows, scale-bar labels |
| `--text-sm`   | 13 / 20     | secondary, table cells, road labels |
| `--text-base` | 15 / 24     | body, default labels |
| `--text-lg`   | 17 / 26     | section headings |
| `--text-xl`   | 22 / 30     | portal view titles |
| `--text-2xl`  | 28 / 36     | page hero (rare, home and login only) |

### Weight
- 400 body
- 500 secondary navigation
- 600 buttons, eyebrows, table headers
- 700 page titles, popup titles

Line height: 1.45 body, 1.2 headings. Tracking: -0.01em headings, 0 body, +0.08em uppercase eyebrows. Line length capped 65 to 75ch.

## Layout

- Containers: 1200 px content max, 1440 px shells max, full-bleed for map surfaces.
- Gutter: 16 px mobile, 24 px tablet, 32 px desktop.
- Vertical rhythm: 8 / 12 / 16 / 24 / 32 / 48 / 64. Chosen consciously per section; not "16 everywhere".
- Cards used sparingly, never nested. Application forms and detail panels lean on borders and headings instead.

## Radii

| Token           | Px     | Use |
|-----------------|--------|-----|
| `--radius-sm`   | 6      | chips, inputs, small buttons |
| `--radius-md`   | 10     | cards, popups, dropdowns |
| `--radius-lg`   | 16     | modals, full-bleed sheets |
| Pill (`9999px`) | n/a    | status badges, segmented controls only |

## Elevation

Subtle. Government-flat, not iOS-physical.

| Token        | Value                                       | Use |
|--------------|---------------------------------------------|-----|
| `--shadow-0` | none                                        | flat |
| `--shadow-1` | `0 1px 2px rgba(15,23,42,0.04)`             | input focus, hover |
| `--shadow-2` | `0 4px 16px rgba(15,23,42,0.10)`            | floating controls (map zoom, filter chip) |
| `--shadow-3` | `0 8px 28px rgba(15,23,42,0.14)`            | popups, dropdowns |
| `--shadow-4` | `0 20px 48px rgba(15,23,42,0.18)`           | modals |

No glassmorphism. No coloured shadows.

## Motion

- Default duration 160 ms. Long actions (drill-down zoom) up to 700 ms.
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-quart) for entrances; linear for tile fades.
- `prefers-reduced-motion: reduce` collapses all transitions to 0 ms and replaces drill-down `flyTo` / `fitBounds` with `jumpTo`.
- No bounce, no spring, no elastic.

## Components

### Buttons
Three roles: `primary` (accent fill), `secondary` (border + neutral), `ghost` (text-only). One size. Icon-only buttons get an `aria-label`. Disabled is `opacity: 0.55`, never grey-on-grey.

### Inputs
14 px text, 12 px padding-Y, 14 px padding-X, 1 px border. Focus ring is a 2 px accent outline at `-2px` offset, not a glow.

### Tables
Borderless rows, 1 px row-divider, 12 px row padding. Sticky header on long tables. Right-align numerics. Empty state is one sentence explaining what would appear, never an illustration.

### Filter chips (map layers)
Pill shape, 10 px swatch + label. Active = accent fill, inactive = neutral surface. Country is never a chip.

### Popups (map drill-down)
Rounded 10 px, shadow-3, 14 to 16 px padding. Eyebrow / title / meta stack. Implemented via `.vungu-popup` class in `src/styles/maplibre-polish.css`.

---

## Map Cartographic System

The map is the product's spine. Its visual language is rooted in Google Maps' city-zoom conventions, adapted to the planning context.

### Land base
Warm off-white `#f5f3ee`. The paper-warmth that anchors the whole palette and lets road yellows and park greens read as figure.

### Water
| Element     | Colour | Notes |
|-------------|--------|-------|
| Water areas | `#aadaff` fill, `#7fb8e3` stroke at 0.95 opacity | signature pale cyan |
| Waterways   | `#aadaff` stroke, width 1.5                       | linear rivers and streams |

### Roads (data-driven by OSM `fclass`, width zoom-interpolated z8 to z18)
| Class                  | Colour    |
|------------------------|-----------|
| motorway, _link        | `#ffc06f` warm gold |
| trunk, _link           | `#ffd58a` |
| primary, _link         | `#fde7b0` |
| secondary, _link       | `#fff3cf` |
| tertiary, residential  | `#ffffff` |
| service                | `#fafafa` |
| pedestrian, footway    | `#ededed` |
| track                  | `#e8e0cf` |
| fallback               | `#e0e0e0` |

Road labels prepend `ref` (e.g. `A17 Bulawayo Road`, `R6 Main Street`) at z11+.

### Landuse (data-driven by OSM `fclass`)
| Class                                 | Colour    | Note |
|---------------------------------------|-----------|------|
| residential                           | `#eef0f2` | mauve-grey |
| commercial / retail                   | `#f3eee8` / `#f4ede4` | warm grey |
| industrial                            | `#e9ecef` | flat grey |
| park / forest / nature_reserve        | `#c8e6c9` | mossy green |
| farmland / meadow / grass             | `#eef0e4` / `#dbeed4` | pale yellow-green |
| cemetery                              | `#c9dccc` | muted green |
| military                              | `#efe6e6` | pink-grey |

### Buildings (z14+)
Flat `#ededed` fill, `#dadada` stroke, full opacity. Looks like printed cartography, not slate rectangles.

### Administrative units (drill-down hierarchy)
Country -> provinces -> districts -> wards. Provinces carry per-region colour at country zoom; all admin fills fade to 0 by z11 so cityscape detail reads:

| Province              | Fill colour |
|-----------------------|-------------|
| Bulawayo              | `#fda4af` |
| Harare                | `#f9a8d4` |
| Manicaland            | `#86efac` |
| Mashonaland Central   | `#fde68a` |
| Mashonaland East      | `#fcd34d` |
| Mashonaland West      | `#fed7aa` |
| Masvingo              | `#c4b5fd` |
| Matabeleland North    | `#a5b4fc` |
| Matabeleland South    | `#67e8f9` |
| Midlands              | `#d9f99d` |

Boundary strokes are cool desaturated greys (`#7a8089` country -> `#bdc1c6` wards), recessive at deep zoom (opacity interpolated by zoom).

### Labels
| Level             | Size | Colour      | Style |
|-------------------|------|-------------|-------|
| Country           | 14   | `#3c4043`   | UPPERCASE, letter-spacing 0.1 |
| Provinces         | 12   | `#3c4043`   | mixed case |
| Districts         | 10   | `#3c4043`   | mixed case |
| Wards             | 9    | `#3c4043`   | mixed case |
| Road / ref        | 11   | `#3c4043`   | line-following |
| Railway           | 10   | `#5f6368`   | line-following |
| Waterway          | 10   | `#3a6e9e`   | line-following |
| Place suburb      | 11   | `#5f6368`   | UPPERCASE, letter-spacing 0.08 |
| POI (clinic, etc) | 10   | `#b06000`   | dot + name |
| Transit POI       | 10   | `#1a73e8`   | dot + name |
| Worship POI       | 10   | `#9334e8`   | dot + name |
| Protected area    | 11   | `#3b6f3a`   | UPPERCASE |

All halos: `rgba(255,255,255,0.95)`, width 1.2, blur 0.4. Visible but not shouty.

### Filter chip swatch system
Every layer in `src/map/vunguBasemapStyle.ts:PALETTE.chip` exposes one representative colour for the filter UI. The map paint and the filter swatch always agree (single source of truth via `chipColorFor()`).

### Click and motion
- Click on a province: fits to province bounds at zoom 9, shows districts + wards filtered by `parent_pcode` and pcode prefix.
- Click on a district: fits to district bounds at zoom 11, shows wards filtered.
- Click on country: clears filters, restores defaults.
- All `fitBounds` calls use `duration: 700` with ease-out-quart, OR `duration: 0` when `prefers-reduced-motion: reduce` is set (see `prefersReducedMotion()` in `src/map/vunguBasemap.ts`).
