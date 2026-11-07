<template>
  <!--
    ══════════════════════════════════════════════════════════════════════
    PLANNING GIS WORKSTATION
    Three-zone enterprise workspace: COMMAND BAR / [DATA RAIL · MAP ·
    CONTEXT RAIL] / STATUS BAR. The map is the dominant surface; every
    other zone frames it. Nothing floats over the map except transient
    operator feedback (active-tool banner, measurement readout, legend).
    ══════════════════════════════════════════════════════════════════════
  -->
  <div class="pw" @click="closeOverlays">

    <!-- ═══════════════ COMMAND BAR ═══════════════════════════════════ -->
    <header class="pw-cmd" @click.stop>
      <div class="cmd-ws" title="Active workspace">
        <Layers :size="14" />
        <span class="cmd-ws-label">Planning GIS</span>
      </div>

      <!-- ── Global planning search ─────────────────────────────────── -->
      <div class="cmd-search" role="search">
        <Search :size="14" class="cs-ico" />
        <input
          id="planner-global-search"
          v-model="searchQuery"
          class="cs-input"
          type="search"
          autocomplete="off"
          placeholder="Search application, stand, property, owner or reference…"
          aria-label="Global planning search"
          :aria-expanded="searchActive && !!searchResults.length"
          aria-controls="cs-results"
          role="combobox"
          @input="onSearch"
          @focus="searchActive = true"
          @keydown.down.prevent="moveSearch(1)"
          @keydown.up.prevent="moveSearch(-1)"
          @keydown.enter.prevent="enterSearch"
          @keydown.esc="closeSearch"
        />
        <kbd v-if="!searchQuery" class="cs-kbd">/</kbd>
        <button v-else class="cs-clear" title="Clear search" aria-label="Clear search" @click="closeSearch">
          <X :size="13" />
        </button>

        <div v-if="searchActive && searchResults.length" id="cs-results" class="cs-drop" role="listbox">
          <div class="cs-drop-head">{{ searchResults.length }} result{{ searchResults.length === 1 ? '' : 's' }}</div>
          <button
            v-for="(r, i) in searchResults" :key="r.id"
            class="cs-row" :class="{ active: i === searchActiveIndex }"
            role="option" :aria-selected="i === searchActiveIndex"
            @mousedown.prevent="selectResult(r)" @mouseenter="searchActiveIndex = i">
            <span class="cs-row-ico" :class="'cs-t-' + r.type">
              <component :is="searchIcon(r.type)" :size="14" />
            </span>
            <span class="cs-row-text">
              <span class="cs-row-label" v-html="highlightMatch(r.label)"></span>
              <span class="cs-row-sub">{{ r.subtitle || searchTypeLabel(r.type) }}</span>
            </span>
            <span class="cs-row-type">{{ searchTypeLabel(r.type) }}</span>
          </button>
        </div>
        <div v-else-if="searchActive && searchBusy" class="cs-drop">
          <div class="cs-note"><RefreshCw :size="13" class="spin-icon" /> Searching the planning register…</div>
        </div>
        <div v-else-if="searchActive && searchQuery.trim().length >= 1" class="cs-drop">
          <div class="cs-note">No match for &ldquo;{{ searchQuery.trim() }}&rdquo;</div>
        </div>
      </div>

      <!-- ── Tool groups ────────────────────────────────────────────── -->
      <nav class="cmd-tools" aria-label="Map tools">
        <div class="tgrp" role="group" aria-label="Navigate">
          <button class="tbtn" :class="{ on: activeTool === 'select' }" @click="setTool('select')" title="Select / identify features (V)" aria-label="Select">
            <MousePointer2 :size="15" />
          </button>
          <button class="tbtn" @click="resetView" title="Reset to district view" aria-label="Reset view"><Home :size="15" /></button>
          <button class="tbtn" @click="fitExtent" title="Fit to region" aria-label="Fit extent"><Maximize2 :size="15" /></button>
          <button class="tbtn" :class="{ on: locating }" @click="locateMe" title="Locate me (GPS)" aria-label="Locate me"><Navigation :size="15" /></button>
        </div>

        <div class="tgrp" role="group" aria-label="Measure and draw">
          <button class="tbtn" :class="{ on: activeTool === 'measure' }" @click="setTool('measure')" title="Measure distance (M)" aria-label="Measure"><Ruler :size="15" /></button>
          <button class="tbtn" :class="{ on: activeTool === 'polygon' }" @click="setTool('polygon')" title="Draw polygon (D)" aria-label="Draw polygon"><PenLine :size="15" /></button>
          <button class="tbtn" :class="{ on: activeTool === 'line' }" @click="setTool('line')" title="Draw line (L)" aria-label="Draw line"><Slash :size="15" /></button>
          <button class="tbtn" :class="{ on: activeTool === 'point' }" @click="setTool('point')" title="Place point" aria-label="Place point"><CircleDot :size="15" /></button>
          <button class="tbtn" :class="{ on: snap.enabled }" @click="snap.enabled = !snap.enabled" :title="snap.enabled ? 'Object snap ON' : 'Object snap OFF'" aria-label="Object snap"><Magnet :size="15" /></button>
        </div>

        <div class="tgrp" role="group" aria-label="Analysis">
          <button class="tbtn" :class="{ on: activeTool === 'buffer' }" @click="setTool('buffer')" title="Buffer / setback (B)" aria-label="Buffer"><Crosshair :size="15" /></button>
          <button class="tbtn" :disabled="!selectedFeature" @click="runSpatialQuery" title="Spatial query — abutting owners within 100 m" aria-label="Spatial query"><Users :size="15" /></button>
        </div>

        <div class="tgrp" role="group" aria-label="Panels">
          <button class="tbtn" :class="{ on: layerPanelOpen }" @click="toggleLayers" title="Basemap layer filters" aria-label="Basemap layers"><Layers :size="15" /></button>
        </div>

        <div class="tgrp" role="group" aria-label="Output">
          <button class="tbtn" @click="printMapView" title="Print current view" aria-label="Print"><Printer :size="15" /></button>
          <div class="tmenu">
            <button class="tbtn tbtn-wide" :class="{ on: exportMenuOpen }" @click.stop="exportMenuOpen = !exportMenuOpen" title="Export" aria-haspopup="menu" :aria-expanded="exportMenuOpen">
              <Download :size="15" /><ChevronDown :size="11" />
            </button>
            <div v-if="exportMenuOpen" class="pop pop-right" role="menu" @click.stop>
              <div class="pop-head">Export</div>
              <button class="pop-item" role="menuitem" @click="exportMenuOpen = false; captureMapSnapshot()">
                <Download :size="13" /> Map view (PNG)
              </button>
              <button class="pop-item" role="menuitem" :disabled="!selectedFeature" @click="exportMenuOpen = false; exportSiteReportPDF()">
                <FileText :size="13" /> Site report (PDF)
              </button>
              <button class="pop-item" role="menuitem" @click="exportMenuOpen = false; exportDrawingsGeoJSON()">
                <Download :size="13" /> Drawings (GeoJSON)
              </button>
              <button class="pop-item" role="menuitem" @click="exportMenuOpen = false; exportSubdivisionDXF()">
                <Download :size="13" /> Subdivision (DXF)
              </button>
              <button class="pop-item" role="menuitem" :disabled="!planning.lots.value.length" @click="exportMenuOpen = false; exportSubdivisionPlanPDF()">
                <FileText :size="13" /> Subdivision plan (PDF)
              </button>
            </div>
          </div>
        </div>
      </nav>

      <!-- ── Right cluster: case · notifications · QGIS ─────────────── -->
      <div class="cmd-right">
        <button v-if="caseCtx" class="cmd-case" :class="'lv-' + caseCtx.level"
          :title="`Open case ${caseCtx.ref} in the Planner Console`"
          @click="caseCtx.permitId ? shell.openCaseForStand(caseCtx.permitId) : shell.showConsole('workflow')">
          <Clock :size="13" />
          <span class="cc-ref">{{ caseCtx.ref }}</span>
          <span class="cc-days">{{ caseCtx.daysRemaining }}d</span>
        </button>

        <div class="tmenu">
          <button class="cmd-icon" :class="{ on: notifOpen }" @click.stop="notifOpen = !notifOpen"
            :title="`${plannerNotifsUnread} unread notification${plannerNotifsUnread === 1 ? '' : 's'}`"
            aria-haspopup="menu" :aria-expanded="notifOpen">
            <Bell :size="15" />
            <span v-if="plannerNotifsUnread" class="cmd-badge">{{ plannerNotifsUnread > 9 ? '9+' : plannerNotifsUnread }}</span>
          </button>
          <div v-if="notifOpen" class="pop pop-right pop-wide" role="menu" @click.stop>
            <div class="pop-head">Notifications<span class="pop-head-meta">{{ plannerNotifsUnread }} unread</span></div>
            <p v-if="!plannerNotifs.length" class="pop-empty">No notifications from the Environment Officer or Council.</p>
            <button v-for="n in plannerNotifs.slice(0, 12)" :key="n.id" class="pop-notif"
              :class="{ unread: !n.is_read }" role="menuitem" @click="markPlannerNotifRead(n.id)">
              <span class="pn-dot" :class="{ on: !n.is_read }"></span>
              <span class="pn-body">
                <span class="pn-title">{{ n.title || n.subject || 'Notification' }}</span>
                <span class="pn-text">{{ n.message || n.body || '' }}</span>
              </span>
            </button>
          </div>
        </div>

        <button class="cmd-qgis" :class="'q-' + qgisStatus" @click="revealRailSection('connections')"
          :title="`QGIS Server — ${qgisStatusLabel}. Open data connections.`">
          <span class="q-dot"></span>
          <span class="q-text">QGIS</span>
        </button>
      </div>
    </header>

    <!-- ═══════════════ WORKSPACE BODY ════════════════════════════════ -->
    <div class="pw-body">

      <!-- ┌─────────── LEFT: DATA RAIL ──────────────────────────────┐ -->
      <aside class="pw-rail rail-l" :class="{ 'is-collapsed': leftCollapsed }" aria-label="Data rail">
        <!-- Collapsed: icon strip keeps every section one click away -->
        <div v-if="leftCollapsed" class="rail-strip">
          <button class="strip-btn" title="Expand data rail" aria-label="Expand data rail" @click="leftCollapsed = false">
            <PanelLeft :size="16" />
          </button>
          <span class="strip-sep"></span>
          <button class="strip-btn" title="Workspace &amp; ward" @click="revealRailSection('workspace')"><Navigation :size="16" /></button>
          <button class="strip-btn" title="Layers" @click="revealRailSection('layers')"><Layers :size="16" /></button>
          <button class="strip-btn" title="Data connections" @click="revealRailSection('connections')"><Database :size="16" /></button>
        </div>

        <template v-else>
          <div class="rail-head">
            <span class="rail-head-title">Data</span>
            <button class="rail-head-btn" title="Collapse data rail" aria-label="Collapse data rail" @click="leftCollapsed = true">
              <PanelLeft :size="14" />
            </button>
          </div>

          <div class="rail-scroll">

            <!-- ── WORKSPACE ─────────────────────────────────────── -->
            <section id="rail-sec-workspace" class="sec">
              <button class="sec-head" :aria-expanded="railOpen.workspace" @click="toggleRail('workspace')">
                <ChevronDown :size="12" class="sec-caret" :class="{ closed: !railOpen.workspace }" />
                <Navigation :size="12" /> Workspace
              </button>
              <div v-show="railOpen.workspace" class="sec-body">
                <label class="fld">
                  <span class="fld-label">Ward</span>
                  <select v-model="selectedWard" class="fld-input" @change="flyToWard">
                    <option value="">All wards ({{ wards.length }})</option>
                    <option v-for="w in wards" :key="w.id" :value="w.id">{{ w.name }}</option>
                  </select>
                </label>
                <p v-if="!wards.length" class="sec-note">{{ wardsState === 'loading' ? 'Loading wards…' : 'The ward list is unavailable. Pan the map to the ward instead.' }}</p>

                <div class="extent">
                  <div class="extent-row"><span>Centre</span><code>{{ cursorCoords }}</code></div>
                  <div class="extent-row"><span>Zoom</span><code>{{ mapZoom }}</code></div>
                  <div class="extent-row"><span>Scale</span><code>{{ mapScale }}</code></div>
                </div>
              </div>
            </section>

            <!-- ── LAYERS ────────────────────────────────────────── -->
            <section id="rail-sec-layers" class="sec">
              <button class="sec-head" :aria-expanded="railOpen.layers" @click="toggleRail('layers')">
                <ChevronDown :size="12" class="sec-caret" :class="{ closed: !railOpen.layers }" />
                <Layers :size="12" /> Layers
                <span v-if="spatialStore.isLoading" class="sec-badge">loading</span>
              </button>
              <div v-show="railOpen.layers" class="sec-body sec-body--flush">

                <!-- Stands registry -->
                <div class="sec-sub">Council registry</div>
                <div class="lyr" :class="{ on: standsVisible }">
                  <button class="lyr-eye" :aria-pressed="standsVisible"
                    :title="standsVisible ? 'Hide stands' : 'Show stands'" @click="standsVisible = !standsVisible">
                    <component :is="standsVisible ? Eye : EyeOff" :size="14" />
                  </button>
                  <span class="lyr-sym sym-poly" style="--sym:#1e6b4a"></span>
                  <span class="lyr-txt">
                    <span class="lyr-name">Stands</span>
                    <span class="lyr-meta">Polygon · allocation register</span>
                  </span>
                </div>
                <div class="chips">
                  <label v-for="s in ['available','reserved','allocated','withdrawn']" :key="s"
                    class="chip" :class="{ on: standsFilter.includes(s as StandStatus) }">
                    <input type="checkbox" class="sr-only" :checked="standsFilter.includes(s as StandStatus)"
                      @change="standsFilter.includes(s as StandStatus) ? standsFilter = standsFilter.filter(x=>x!==s) : standsFilter = [...standsFilter, s as StandStatus]" />
                    {{ s }}
                  </label>
                </div>

                <!-- Municipal / dynamic layers -->
                <p v-if="!plannerLayers.length" class="sec-note">No layers published by the spatial service.</p>
                <template v-for="g in layerGroups" :key="g.key">
                <button type="button" class="sec-sub sec-sub-btn" :aria-expanded="!collapsedGroups[g.key]" @click="collapsedGroups[g.key] = !collapsedGroups[g.key]">
                  <span class="sec-sub-chev" aria-hidden="true">{{ collapsedGroups[g.key] ? '▸' : '▾' }}</span>
                  {{ g.name }} <span class="sec-sub-n">{{ g.layers.length }}</span>
                </button>
                <template v-if="!collapsedGroups[g.key]">
                <div v-for="l in g.layers" :key="l.id" class="lyr" :class="{ on: layerVisibility[l.id], unavailable: !l.loadable }">
                  <button class="lyr-eye" :aria-pressed="!!layerVisibility[l.id]" :disabled="!l.loadable"
                    :title="!l.loadable ? `${l.name} cannot be shown on the map (no primary key)` : layerVisibility[l.id] ? `Hide ${l.name}` : `Show ${l.name}`" @click="toggleLayer(l)">
                    <component :is="layerVisibility[l.id] ? Eye : EyeOff" :size="14" />
                  </button>
                  <span class="lyr-sym"
                    :class="l.type === 'Line' ? 'sym-line' : l.type === 'Point' ? 'sym-pt' : 'sym-poly'"
                    :style="{ '--sym': l.color }"></span>
                  <span class="lyr-txt">
                    <span class="lyr-name" :title="l.name">{{ l.name }}</span>
                    <span class="lyr-meta">
                      {{ [l.type === 'Vector' ? '' : l.type, l.desc].filter(Boolean).join(' · ') }}
                    </span>
                  </span>
                  <span v-if="layerVisibility[l.id] && layerFeatureCount(l.id) != null" class="lyr-n">
                    {{ layerFeatureCount(l.id)!.toLocaleString() }}
                  </span>
                  <div class="tmenu">
                    <button class="lyr-more" :title="`${l.name} options`" aria-haspopup="menu"
                      :aria-expanded="layerMenuId === l.id" @click.stop="toggleLayerMenu(l.id)">
                      <MoreVertical :size="13" />
                    </button>
                    <div v-if="layerMenuId === l.id" class="pop pop-left" role="menu" @click.stop>
                      <div class="pop-head">{{ l.name }}</div>
                      <div class="pop-slider">
                        <label :for="'op-' + l.id">Opacity</label>
                        <input :id="'op-' + l.id" type="range" min="0" max="100"
                          :value="layerOpacity[l.id] ?? 80"
                          @input="setLayerOpacity(l, +($event.target as HTMLInputElement).value)" />
                        <output>{{ layerOpacity[l.id] ?? 80 }}%</output>
                      </div>
                      <button class="pop-item" role="menuitem" @click="zoomToLayer(l)">
                        <Maximize2 :size="13" /> Zoom to layer
                      </button>
                      <div class="pop-info">
                        <div><span>Type</span><code>{{ l.type }}</code></div>
                        <div><span>Id</span><code>{{ l.id }}</code></div>
                        <div v-if="layerFeatureCount(l.id) != null"><span>Features</span><code>{{ layerFeatureCount(l.id)!.toLocaleString() }}</code></div>
                      </div>
                    </div>
                  </div>
                  <ul v-if="layerVisibility[l.id] && qgisLegend(qgisStyles[l.id] ?? null).length > 1"
                    class="lyr-legend" :aria-label="`${l.name} legend`">
                    <li v-for="row in qgisLegend(qgisStyles[l.id] ?? null)" :key="row.label">
                      <span class="lyr-legend-sw" :style="{ background: row.color }"></span>{{ row.label }}
                    </li>
                  </ul>
                </div>
                </template>
                </template>

                <!-- QGIS project layers -->
                <div class="sec-sub">QGIS project <span class="sec-sub-n">{{ qgisLayers.length }}</span></div>
                <p v-if="!qgisLayers.length" class="sec-note">
                  Not connected — open Data connections below.
                </p>
                <div v-for="ql in qgisLayers" :key="ql.name" class="lyr"
                  :class="{ on: qgisActiveLayerNames.includes(ql.name) }">
                  <button class="lyr-eye" :aria-pressed="qgisActiveLayerNames.includes(ql.name)"
                    :title="qgisActiveLayerNames.includes(ql.name) ? `Hide ${ql.title || ql.name}` : `Show ${ql.title || ql.name}`"
                    @click="toggleQgisLayer(ql)">
                    <component :is="qgisActiveLayerNames.includes(ql.name) ? Eye : EyeOff" :size="14" />
                  </button>
                  <span class="lyr-sym"
                    :class="/line/i.test(ql.geometry || '') ? 'sym-line' : /point/i.test(ql.geometry || '') ? 'sym-pt' : 'sym-poly'"
                    :style="{ '--sym': layerColor(ql.name) }"></span>
                  <span class="lyr-txt">
                    <span class="lyr-name" :title="ql.name">{{ ql.title || humanise(ql.name) }}</span>
                    <span class="lyr-meta">{{ ql.geometry || 'QGIS Server' }}</span>
                  </span>
                  <ul v-if="qgisActiveLayerNames.includes(ql.name) && qgisLegend(qgisStyles[ql.name] ?? null).length > 1"
                    class="lyr-legend" :aria-label="`${ql.title || humanise(ql.name)} legend`">
                    <li v-for="row in qgisLegend(qgisStyles[ql.name] ?? null)" :key="row.label">
                      <span class="lyr-legend-sw" :style="{ background: row.color }"></span>{{ row.label }}
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            <!-- ── DATA CONNECTIONS ──────────────────────────────── -->
            <section id="rail-sec-connections" class="sec">
              <button class="sec-head" :aria-expanded="railOpen.connections" @click="toggleRail('connections')">
                <ChevronDown :size="12" class="sec-caret" :class="{ closed: !railOpen.connections }" />
                <Database :size="12" /> Data connections
              </button>
              <div v-show="railOpen.connections" class="sec-body">

                <div class="conn">
                  <div class="conn-head">
                    <span class="conn-dot" :class="'q-' + qgisStatus"></span>
                    <span class="conn-name"><Server :size="12" /> QGIS Server</span>
                    <span class="conn-state" :class="'q-' + qgisStatus">{{ qgisStatusLabel }}</span>
                  </div>
                  <div class="conn-rows">
                    <div><span>Project layers</span><code>{{ qgisLayers.length }}</code></div>
                    <div><span>Rendering</span><code>{{ qgisStatus === 'healthy' ? 'WMS raster' : 'Vector fallback' }}</code></div>
                    <div><span>Last sync</span><code>{{ qgisLastSync || '—' }}</code></div>
                  </div>
                  <button class="btn btn-sm btn-block" :disabled="qgisConnecting" @click="connectQgis()">
                    <RefreshCw :size="12" :class="{ 'spin-icon': qgisConnecting }" />
                    {{ qgisConnecting ? 'Connecting…' : (qgisLayers.length ? 'Refresh catalogue' : 'Connect') }}
                  </button>
                  <p v-if="qgisError" class="conn-err"><AlertTriangle :size="12" /> {{ qgisError }}</p>
                </div>

                <div class="conn">
                  <div class="conn-head">
                    <span class="conn-dot" :class="spatialStore.isLoading ? 'q-unknown' : (plannerLayers.length ? 'q-healthy' : 'q-offline')"></span>
                    <span class="conn-name"><Database :size="12" /> PostGIS</span>
                    <span class="conn-state" :class="spatialStore.isLoading ? 'q-unknown' : (plannerLayers.length ? 'q-healthy' : 'q-offline')">
                      {{ spatialStore.isLoading ? 'Loading' : (plannerLayers.length ? 'Connected' : 'No layers') }}
                    </span>
                  </div>
                  <div class="conn-rows">
                    <div><span>Published layers</span><code>{{ plannerLayers.length }}</code></div>
                    <div><span>CRS</span><code>EPSG:4326</code></div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </template>
      </aside>

      <!-- ┌─────────── CENTRE: MAP ──────────────────────────────────┐ -->
      <main class="pw-map">
        <div ref="mapContainer" v-show="!editorOpen" class="map-canvas"></div>
        <OpenLayersEditorMap
          v-if="editorOpen"
          :center="[31.05, -18.93]"
          :zoom="7"
          :layers="qgisLayers.map((l: any) => l.name || l.table_name).filter(Boolean).slice(0, 5)"
          :editable="true"
          :enable-wfs-t="true"
          @dirty-change="editorPending = $event"
        />
        <button v-if="staffRoleIn(['planner', 'gis_officer', 'admin'])" class="tb-cancel" style="position:absolute;top:8px;left:8px;z-index:20;" @click="toggleEditor">
          {{ editorOpen ? 'Close editor' : 'Open OpenLayers editor' }}
        </button>

        <MapContextMenu
          :open="ctxMenu.open" :x="ctxMenu.x" :y="ctxMenu.y" :layer="ctxMenu.layer"
          :title="ctxMenu.title" :has-feature="ctxMenu.fid != null"
          @action="onCtxAction" @close="closeCtxMenu"
        />

        <!-- Basemap chip panel (toggled from the command bar) -->
        <div v-show="layerPanelOpen" class="map-filters" @click.stop>
          <MapLayerFilters :map="mapInstance" />
        </div>

        <!--
          Floating rail controls (mobile only). Below 768px the collapsed
          icon strips are hidden: two 40px vertical strips would take 80px of
          a 375px screen and give the map 295px. These replace them as thumb
          height controls on the map itself, and they disappear while their
          rail is open so nothing floats on top of a sheet.
        -->
        <div v-if="isMobile" class="map-railfabs">
          <button
            v-if="leftCollapsed"
            type="button" class="railfab"
            aria-label="Open data rail" :aria-expanded="!leftCollapsed"
            @click.stop="leftCollapsed = false"
          >
            <Layers :size="18" aria-hidden="true" />
            <span class="railfab-label">Data</span>
          </button>
          <button
            v-if="rightCollapsed"
            type="button" class="railfab"
            aria-label="Open context rail" :aria-expanded="!rightCollapsed"
            @click.stop="rightCollapsed = false"
          >
            <Info :size="18" aria-hidden="true" />
            <span class="railfab-label">Context</span>
          </button>
        </div>

        <!-- Active-tool instruction banner -->
        <div v-if="activeTool !== 'select' && activeToolMeta" class="tool-banner" role="status">
          <component :is="activeToolMeta.icon" :size="14" class="tb-ico" />
          <span class="tb-name">{{ activeToolMeta.label }} active</span>
          <span class="tb-hint">{{ activeToolMeta.hint }}</span>
          <button class="tb-cancel" @click="setTool('select')">Cancel <kbd>Esc</kbd></button>
        </div>

        <!-- Planning-mode banner (a distinct mode from the GIS tools) -->
        <div v-else-if="planning.tool.value !== 'idle'" class="tool-banner tb-plan" role="status">
          <LayoutGrid :size="14" class="tb-ico" />
          <span class="tb-name">Planning · {{ planning.tool.value.replace(/-/g, ' ') }}</span>
          <span class="tb-hint">Follow the prompts in the Planning panel</span>
          <button class="tb-cancel" @click="planning.tool.value = 'idle'">Cancel <kbd>Esc</kbd></button>
        </div>

        <!-- Map camera controls -->
        <div class="map-ctrl">
          <div class="mc-grp">
            <button class="mc-btn" @click="zoomIn" title="Zoom in" aria-label="Zoom in"><Plus :size="16" /></button>
            <button class="mc-btn" @click="zoomOut" title="Zoom out" aria-label="Zoom out"><Minus :size="16" /></button>
          </div>
          <div class="mc-grp">
            <button class="mc-btn" @click="fitExtent" title="Fit to region" aria-label="Fit to region"><Maximize2 :size="16" /></button>
          </div>
        </div>

        <!-- Transient operator readouts (bottom-centre, never over data) -->
        <div class="map-readouts">
          <div v-if="activeTool === 'polygon' && drawPoints.length" class="ro">
            <PenLine :size="12" /> {{ drawPoints.length }} vertices — double-click to close
          </div>
          <div v-if="activeTool === 'polygon' && drawStats" class="ro ro-strong">
            <span><b>{{ drawStats.areaHa.toFixed(2) }}</b> ha</span>
            <span><b>{{ drawStats.areaSqm.toLocaleString(undefined,{maximumFractionDigits:0}) }}</b> m²</span>
            <span><b>{{ drawStats.perimeterM.toFixed(0) }}</b> m perimeter</span>
            <button class="ro-act" @click="openRegisterDialog"><Plus :size="11" /> Register as stand</button>
            <button class="ro-x" title="Clear drawings" aria-label="Clear drawings" @click="clearDrawings"><X :size="11" /></button>
          </div>
          <div v-if="activeTool === 'measure' && measureResult" class="ro ro-strong">
            <Ruler :size="12" /> <b>{{ measureResult }}</b>
            <button class="ro-x" title="Clear measurement" aria-label="Clear measurement"
              @click="measurePoints=[];measureResult='';(mapInstance?.getSource('measure-src') as any)?.setData({type:'FeatureCollection',features:[]})">
              <X :size="11" />
            </button>
          </div>
        </div>

        <!-- Map key -->
        <div class="map-legend"><MapLegend /></div>

        <!-- Loading -->
        <Transition name="fade">
          <div v-if="mapLoading" class="map-loading">
            <RefreshCw :size="17" class="spin-icon" />
            <span>Loading spatial data…</span>
          </div>
        </Transition>
      </main>

      <!-- ┌─────────── RIGHT: CONTEXT RAIL ──────────────────────────┐ -->
      <aside class="pw-rail rail-r" :class="{ 'is-collapsed': rightCollapsed }" aria-label="Context rail">
        <div v-if="rightCollapsed" class="rail-strip">
          <button class="strip-btn" title="Expand context rail" aria-label="Expand context rail" @click="rightCollapsed = false">
            <PanelRight :size="16" />
          </button>
          <span class="strip-sep"></span>
          <button v-for="t in visibleRightTabs" :key="t.id" class="strip-btn"
            :class="{ on: rightTab === t.id }" :title="t.label"
            @click="rightTab = t.id; rightCollapsed = false">
            <component :is="t.icon" :size="16" />
          </button>
        </div>

        <template v-else>
          <!-- Context header — always states WHAT is selected -->
          <header class="ctx-head">
            <div class="ctx-head-top">
              <span class="ctx-eyebrow">{{ parcelSummary ? 'Selected property' : 'Context' }}</span>
              <button class="rail-head-btn" title="Collapse context rail" aria-label="Collapse context rail" @click="rightCollapsed = true">
                <PanelRight :size="14" />
              </button>
            </div>
            <template v-if="parcelSummary">
              <div class="ctx-title-row">
                <h2 class="ctx-title">{{ parcelSummary.id }}</h2>
                <button class="ctx-clear" title="Clear selection" aria-label="Clear selection" @click="selectedFeature = null">
                  <X :size="14" />
                </button>
              </div>
              <div class="ctx-tags">
                <span class="tag">{{ parcelSummary.layer }}</span>
                <span v-if="parcelSummary.zoning" class="tag tag-accent">{{ parcelSummary.zoning }}</span>
                <span v-if="parcelSummary.area" class="tag">{{ parcelSummary.area }}</span>
                <span v-if="selectedStand" class="tag" :class="'st-' + selectedStand.properties.status">
                  {{ selectedStand.properties.status }}
                </span>
              </div>
            </template>
            <p v-else class="ctx-none">No feature selected</p>
          </header>

          <!-- Statutory case banner — the bridge between GIS and workflow -->
          <div v-if="caseCtx" class="case" :class="'lv-' + caseCtx.level">
            <div class="case-top">
              <span class="case-eyebrow">Current case</span>
              <span v-if="caseMatchesSelection" class="case-match" title="This case is for the selected stand">
                <CheckCircle2 :size="11" /> this stand
              </span>
            </div>
            <div class="case-ref">{{ caseCtx.ref }}</div>
            <div class="case-meta">
              <span v-if="caseCtx.devType">{{ caseCtx.devType }}</span>
              <span v-if="caseCtx.standNo">Stand {{ caseCtx.standNo }}</span>
              <span>Stage: {{ caseCtx.phase }}</span>
            </div>
            <div class="case-clock">
              <span v-if="caseCtx.expiry">Expires {{ caseCtx.expiry }}</span>
              <span v-else>Not yet acknowledged</span>
              <strong>{{ caseCtx.daysRemaining > 0 ? caseCtx.daysRemaining + ' days left' : 'Deemed refused' }}</strong>
            </div>
            <button class="btn btn-sm btn-block btn-primary"
              @click="caseCtx.permitId ? shell.openCaseForStand(caseCtx.permitId) : shell.showConsole('workflow')">
              <Gavel :size="12" /> Open case
            </button>
          </div>

          <!-- Tabs -->
          <div class="ctx-tabs" role="tablist" aria-label="Context panel">
            <button v-for="t in visibleRightTabs" :key="t.id" class="ctx-tab"
              role="tab" :aria-selected="rightTab === t.id" :class="{ on: rightTab === t.id }"
              @click="rightTab = t.id">
              <component :is="t.icon" :size="13" /><span>{{ t.label }}</span>
            </button>
          </div>

          <div class="ctx-body">

            <!-- ══ PROPERTY ═══════════════════════════════════════ -->
            <div v-if="rightTab === 'info'" class="pane">
              <div v-if="!selectedFeature" class="empty">
                <MousePointer2 :size="26" />
                <p class="empty-t">Nothing selected</p>
                <p class="empty-s">Click a parcel, stand or zone on the map to inspect it. Right-click for parcel actions.</p>
              </div>
              <template v-else>
                <section class="pnl">
                  <h3 class="pnl-h"><Map :size="12" /> Feature attributes</h3>
                  <dl class="kv">
                    <template v-for="(val, key) in featureDisplayProps" :key="key">
                      <dt>{{ formatPropKey(String(key)) }}</dt>
                      <dd>{{ val ?? '—' }}</dd>
                    </template>
                  </dl>
                  <p v-if="!Object.keys(featureDisplayProps).length" class="pnl-note">This layer publishes no attributes.</p>
                </section>

                <section class="pnl">
                  <h3 class="pnl-h"><Building :size="12" /> Geometry</h3>
                  <dl class="kv">
                    <dt>Layer</dt><dd>{{ selectedFeature._layerName }}</dd>
                    <dt>Type</dt><dd>{{ selectedFeature._geomType || '—' }}</dd>
                    <dt>Click point</dt><dd class="mono">{{ selectedFeature._clickCoord || '—' }}</dd>
                  </dl>
                </section>

                <section class="pnl">
                  <h3 class="pnl-h"><Gavel :size="12" /> Actions</h3>
                  <div class="acts">
                    <button class="act act-primary" @click="actOnSelectedStand">
                      <Gavel :size="14" />
                      <span><b>Open in Planner Console</b><i>Section 26 workflow for this stand</i></span>
                      <ChevronRight :size="12" />
                    </button>
                    <button class="act" @click="startRezoning">
                      <FileText :size="14" />
                      <span><b>Rezoning / permit application</b><i>Take this stand into the register</i></span>
                      <ChevronRight :size="12" />
                    </button>
                    <button class="act" @click="editParcelGeometry">
                      <PenLine :size="14" />
                      <span><b>Edit parcel geometry</b><i>Switch to the polygon tool</i></span>
                      <ChevronRight :size="12" />
                    </button>
                    <button class="act" @click="runSpatialQuery">
                      <Crosshair :size="14" />
                      <span><b>Spatial query</b><i>Abutting owners within 100 m</i></span>
                      <ChevronRight :size="12" />
                    </button>
                  </div>
                </section>

                <section v-if="selectedStand" class="pnl">
                  <h3 class="pnl-h"><MapPin :size="12" /> Stand register</h3>
                  <div class="btn-row">
                    <button class="btn btn-sm" @click="openEditDialog(selectedStand)"><PenLine :size="12" /> Edit stand</button>
                    <button class="btn btn-sm btn-danger"
                      @click="withdrawStand(selectedStand.properties.id, selectedStand.properties.standNumber)">
                      <X :size="12" /> Withdraw
                    </button>
                  </div>
                </section>
              </template>
            </div>

            <!-- ══ PERMITS ════════════════════════════════════════ -->
            <div v-if="rightTab === 'permits'" class="pane">
              <div v-if="!selectedFeature" class="empty">
                <FileText :size="26" />
                <p class="empty-t">No property selected</p>
                <p class="empty-s">Select a stand on the map to load its permit history from the Development Register.</p>
              </div>
              <template v-else>
                <section class="pnl">
                  <h3 class="pnl-h">
                    <FileText :size="12" /> Development register
                    <span class="pnl-meta">{{ standLoading ? 'loading…' : `${standPermits.length} record${standPermits.length === 1 ? '' : 's'}` }}</span>
                  </h3>
                  <p v-if="standLoading" class="pnl-note"><RefreshCw :size="12" class="spin-icon" /> Querying the register…</p>
                  <p v-else-if="!standPermits.length" class="pnl-note">No permits on file for this stand.</p>
                  <table v-else class="tbl">
                    <thead>
                      <tr><th>Reference</th><th>Applicant</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      <tr v-for="p in standPermits" :key="p.id" @click="shell.openCaseForStand(p.id)"
                        :title="`Open ${p.dev_register_no || p.id} in the Planner Console`">
                        <td>
                          <span class="mono">{{ p.dev_register_no || p.id.slice(0, 10) }}</span>
                          <span class="tbl-sub">{{ p.development_type }}</span>
                        </td>
                        <td>{{ p.applicant_name }}</td>
                        <td><span class="badge" :class="'st-' + p.status">{{ p.status.replace(/_/g, ' ') }}</span></td>
                      </tr>
                    </tbody>
                  </table>
                </section>

                <button class="act act-primary" @click="actOnSelectedStand">
                  <Gavel :size="14" />
                  <span><b>Open in Planner Console</b><i>Drill into the Section 26 workflow</i></span>
                  <ChevronRight :size="12" />
                </button>
              </template>
            </div>

            <!-- ══ CHECKS ═════════════════════════════════════════ -->
            <div v-if="rightTab === 'checks'" class="pane">
              <div v-if="!selectedFeature" class="empty">
                <ShieldCheck :size="26" />
                <p class="empty-t">No property selected</p>
                <p class="empty-s">Select a stand on the map to run the at-a-glance due-diligence checks.</p>
              </div>
              <template v-else>
                <section class="pnl">
                  <h3 class="pnl-h"><ShieldCheck :size="12" /> Register status</h3>
                  <ul class="checks">
                    <li :class="standPermits.length ? 'pass' : 'na'">
                      <component :is="standPermits.length ? CheckCircle2 : Minus" :size="13" />
                      <span class="chk-lbl">Permits on file</span>
                      <span class="chk-v">{{ standPermits.length ? 'PASS' : 'NOT CHECKED' }}</span>
                      <span class="chk-n">{{ standPermits.length }}</span>
                    </li>
                    <li :class="standApprovedCount ? 'pass' : 'na'">
                      <component :is="standApprovedCount ? CheckCircle2 : Minus" :size="13" />
                      <span class="chk-lbl">Approved permits</span>
                      <span class="chk-v">{{ standApprovedCount ? 'PASS' : 'NOT CHECKED' }}</span>
                      <span class="chk-n">{{ standApprovedCount }}</span>
                    </li>
                    <li :class="standEnforcement.filter(e => e.status === 'active' || e.status === 'extended').length ? 'fail' : 'pass'">
                      <component :is="standEnforcement.filter(e => e.status === 'active' || e.status === 'extended').length ? AlertTriangle : CheckCircle2" :size="13" />
                      <span class="chk-lbl">Enforcement orders</span>
                      <span class="chk-v">{{ standEnforcement.filter(e => e.status === 'active' || e.status === 'extended').length ? 'BLOCKED' : 'PASS' }}</span>
                      <span class="chk-n">{{ standEnforcement.filter(e => e.status === 'active' || e.status === 'extended').length }}</span>
                    </li>
                    <li :class="standProhibitions.filter(p => !p.lifted_at).length ? 'fail' : 'pass'">
                      <component :is="standProhibitions.filter(p => !p.lifted_at).length ? AlertOctagon : CheckCircle2" :size="13" />
                      <span class="chk-lbl">Prohibition orders</span>
                      <span class="chk-v">{{ standProhibitions.filter(p => !p.lifted_at).length ? 'BLOCKED' : 'PASS' }}</span>
                      <span class="chk-n">{{ standProhibitions.filter(p => !p.lifted_at).length }}</span>
                    </li>
                  </ul>
                  <p class="pnl-note">Status is derived from the Development Register only. The statutory checks below are officer judgements and are recorded in the case file.</p>
                </section>

                <section class="pnl">
                  <h3 class="pnl-h"><Layers :size="12" /> Statutory context to verify</h3>
                  <ul class="todo">
                    <li>Cross-check the approved Master / Local Plan use class for this stand.</li>
                    <li>Confirm the 5 m road-reserve setback and side / rear boundaries.</li>
                    <li>Check proximity to wetlands, water bodies and sensitive sites (school, clinic, place of worship).</li>
                    <li>Title-deed restrictions and bondholder consent (Section 26 due diligence).</li>
                  </ul>
                </section>

                <div class="acts">
                  <button class="act" @click="useAbuttingOwners">
                    <Users :size="14" />
                    <span><b>Use abutting owners (100 m)</b><i>Buffer the stand and fill Step 5 notice recipients</i></span>
                    <ChevronRight :size="12" />
                  </button>
                  <button class="act" @click="actOnSelectedStand">
                    <ShieldCheck :size="14" />
                    <span><b>Full due-diligence checklist</b><i>Step 2 of the Section 26 workflow</i></span>
                    <ChevronRight :size="12" />
                  </button>
                </div>
              </template>
            </div>

            <!-- ══ TOOLS ══════════════════════════════════════════ -->
            <div v-if="rightTab === 'tools'" class="pane pane-tools">
              <nav class="palettes" role="tablist" aria-label="Tool palettes">
                <button v-for="p in TOOL_PALETTES" :key="p.id" class="palette" role="tab"
                  :aria-selected="toolsSubTab === p.id" :class="{ on: toolsSubTab === p.id }"
                  :title="p.label" @click="toolsSubTab = p.id">
                  <component :is="p.icon" :size="13" /><span>{{ p.label }}</span>
                </button>
              </nav>

              <!-- ── ANALYSIS ── -->
              <div v-if="toolsSubTab === 'analysis'" class="pal">
                <section class="pnl">
                  <h3 class="pnl-h">Measurement</h3>
                  <div class="tool-grid">
                    <button class="tool" :class="{ on: activeTool === 'measure' }" @click="setTool('measure')">
                      <Ruler :size="14" /><span>Distance</span>
                    </button>
                    <button class="tool" :class="{ on: activeTool === 'polygon' }" @click="setTool('polygon')">
                      <PenLine :size="14" /><span>Area</span>
                    </button>
                  </div>
                </section>

                <section class="pnl">
                  <h3 class="pnl-h">Buffer &amp; setback</h3>
                  <div class="inline">
                    <input v-model.number="bufferDistance" type="number" min="1" max="1000" class="fld-input fld-num" aria-label="Buffer distance in metres" />
                    <span class="unit">m</span>
                    <button class="btn btn-sm btn-primary" @click="applyBuffer"><Crosshair :size="12" /> Apply</button>
                  </div>
                  <div class="sub-h">Statutory setbacks</div>
                  <div class="presets">
                    <button class="preset" @click="bufferDistance = 6;   applyBuffer()" title="Class I residential front setback (RTCP Act / Model Building By-Laws)">Front 6 m</button>
                    <button class="preset" @click="bufferDistance = 7.5; applyBuffer()" title="Class I residential side / rear setback (Model Building By-Laws)">Side 7.5 m</button>
                    <button class="preset" @click="bufferDistance = 5;   applyBuffer()" title="Secondary road reserve (Roads Act)">Road 5 m</button>
                    <button class="preset" @click="bufferDistance = 30;  applyBuffer()" title="Primary road reserve (Roads Act)">Primary 30 m</button>
                    <button class="preset" @click="bufferDistance = 15;  applyBuffer()" title="Borehole protection zone (Public Health Act)">Borehole 15 m</button>
                    <button class="preset" @click="bufferDistance = 30;  applyBuffer()" title="Wetland / stream bank (Environmental Management Act s.113)">Wetland 30 m</button>
                    <button class="preset" @click="bufferDistance = 50;  applyBuffer()" title="River / dam reserve (Water Act)">River 50 m</button>
                  </div>
                  <div class="sub-h">Free-form</div>
                  <div class="presets">
                    <button class="preset" @click="bufferDistance = 100; applyBuffer()">100 m</button>
                    <button class="preset" @click="bufferDistance = 250; applyBuffer()">250 m</button>
                  </div>
                  <button v-if="bufferActive" class="btn btn-sm btn-block btn-danger" @click="clearBuffer">
                    <X :size="12" /> Clear active buffer
                  </button>
                </section>

                <section class="pnl">
                  <h3 class="pnl-h">Query</h3>
                  <button class="btn btn-sm btn-block" :disabled="!selectedFeature" @click="runSpatialQuery">
                    <Users :size="12" /> Abutting owners within 100 m
                  </button>
                </section>

                <section class="pnl">
                  <h3 class="pnl-h">Coordinates</h3>
                  <div class="coord">
                    <span class="coord-l">Cursor</span>
                    <code class="coord-v">{{ cursorCoord || '—' }}</code>
                    <button class="btn btn-icon" :disabled="!cursorCoord" title="Copy coordinates" aria-label="Copy coordinates" @click="copyCursorCoord">
                      <Link2 :size="12" />
                    </button>
                  </div>
                  <div class="inline">
                    <input v-model="gotoInput" class="fld-input" placeholder="lat, lng — e.g. -19.45, 29.82"
                      aria-label="Go to coordinates" @keyup.enter="gotoCoordinates" />
                    <button class="btn btn-sm btn-primary" @click="gotoCoordinates"><Navigation :size="12" /> Go</button>
                  </div>
                </section>

                <section class="pnl">
                  <h3 class="pnl-h">View</h3>
                  <div class="tool-grid tool-grid-3">
                    <button class="tool" @click="resetView"><Home :size="14" /><span>Reset</span></button>
                    <button class="tool" @click="fitExtent"><Maximize2 :size="14" /><span>Fit all</span></button>
                    <button class="tool" :class="{ on: locating }" @click="locateMe"><Crosshair :size="14" /><span>Locate</span></button>
                  </div>
                </section>
              </div>

              <!-- ── DRAW ── -->
              <div v-if="toolsSubTab === 'draw'" class="pal">
                <section class="pnl">
                  <h3 class="pnl-h">Precision geometry</h3>
                  <div class="tool-grid tool-grid-3">
                    <button class="tool" :class="{ on: activeTool === 'line' }" @click="setTool('line')" title="Line — click two points">
                      <Slash :size="14" /><span>Line</span>
                    </button>
                    <button class="tool" :class="{ on: activeTool === 'polyline' }" @click="setTool('polyline')" title="Polyline — click vertices, double-click to finish">
                      <PenLine :size="14" /><span>Polyline</span>
                    </button>
                    <button class="tool" :class="{ on: activeTool === 'polygon' }" @click="setTool('polygon')" title="Polygon — click vertices, double-click to close">
                      <LayoutGrid :size="14" /><span>Polygon</span>
                    </button>
                    <button class="tool" :class="{ on: activeTool === 'arc' }" @click="setTool('arc')" title="Arc — click start, mid, end">
                      <Spline :size="14" /><span>Arc</span>
                    </button>
                    <button class="tool" :class="{ on: activeTool === 'circle' }" @click="setTool('circle')" title="Circle — click centre, then edge">
                      <Circle :size="14" /><span>Circle</span>
                    </button>
                    <button class="tool" :class="{ on: activeTool === 'point' }" @click="setTool('point')" title="Place a single point">
                      <CircleDot :size="14" /><span>Point</span>
                    </button>
                  </div>
                </section>

                <section class="pnl">
                  <h3 class="pnl-h">
                    Object snap
                    <button class="pnl-toggle" :class="{ on: snap.enabled }" role="switch" :aria-checked="snap.enabled"
                      @click="snap.enabled = !snap.enabled">
                      <Magnet :size="11" /> {{ snap.enabled ? 'On' : 'Off' }}
                    </button>
                  </h3>
                  <div class="checkrow">
                    <label class="check"><input type="checkbox" v-model="snap.vertex" :disabled="!snap.enabled" /> Vertex</label>
                    <label class="check"><input type="checkbox" v-model="snap.midpoint" :disabled="!snap.enabled" /> Midpoint</label>
                    <label class="check"><input type="checkbox" v-model="snap.intersection" :disabled="!snap.enabled" /> Intersection</label>
                  </div>
                </section>

                <section class="pnl">
                  <h3 class="pnl-h">Selection</h3>
                  <button class="btn btn-sm btn-block" :class="{ 'btn-on': activeTool === 'select' }" @click="setTool('select')">
                    <MousePointer2 :size="12" /> Select / identify
                  </button>
                </section>
              </div>

              <!-- ── EDIT ── -->
              <div v-if="toolsSubTab === 'edit'" class="pal">
                <section class="pnl">
                  <h3 class="pnl-h">Modify</h3>
                  <div class="inline">
                    <button class="btn btn-sm" @click="cadOffset" title="Offset the last shape by the distance"><Crop :size="12" /> Offset</button>
                    <input v-model.number="offsetDistance" type="number" min="0.5" step="0.5" class="fld-input fld-num" aria-label="Offset distance in metres" />
                    <span class="unit">m</span>
                  </div>
                  <div class="tool-grid tool-grid-2">
                    <button class="tool" @click="cadTrim" title="Trim the last line to the previous crossing line"><Scissors :size="14" /><span>Trim</span></button>
                    <button class="tool" @click="cadRotate" title="Rotate the last shape"><RotateCw :size="14" /><span>Rotate</span></button>
                    <button class="tool" @click="cadScale" title="Scale the last shape"><Scaling :size="14" /><span>Scale</span></button>
                    <button class="tool" @click="cadMirror" title="Mirror the last shape about its centroid"><FlipHorizontal :size="14" /><span>Mirror</span></button>
                  </div>
                </section>

                <section class="pnl">
                  <h3 class="pnl-h">Spatial operations</h3>
                  <div class="inline">
                    <button class="btn btn-sm" @click="cadBuffer" title="Buffer the last shape (or the selected parcel)"><Crosshair :size="12" /> Buffer</button>
                    <select v-model.number="bufferDistance" class="fld-input fld-num" aria-label="Buffer distance">
                      <option :value="5">5 m</option>
                      <option :value="15">15 m</option>
                      <option :value="30">30 m</option>
                    </select>
                  </div>
                  <div class="tool-grid tool-grid-2">
                    <button class="tool" @click="cadSplitParcel" title="Split the last polygon with the last crossing line">
                      <SplitSquareHorizontal :size="14" /><span>Split parcel</span>
                    </button>
                    <button class="tool" @click="cadTransformTRS" title="Translate the last shape by metres east / north">
                      <Move :size="14" /><span>Transform</span>
                    </button>
                  </div>
                </section>

                <section class="pnl">
                  <h3 class="pnl-h">Scratch geometry</h3>
                  <p class="pnl-note">
                    {{ unsavedGeometryCount }} unsaved item{{ unsavedGeometryCount === 1 ? '' : 's' }} — drawings live in this
                    browser session until exported or registered as a stand.
                  </p>
                  <button class="btn btn-sm btn-block btn-danger" @click="clearAllCad">
                    <X :size="12" /> Clear all drawings
                  </button>
                </section>
              </div>

              <!-- ── ANNOTATE ── -->
              <div v-if="toolsSubTab === 'annotate'" class="pal">
                <section class="pnl">
                  <h3 class="pnl-h">Annotation</h3>
                  <div class="tool-grid tool-grid-3">
                    <button class="tool" :class="{ on: activeTool === 'dimension' }" @click="setTool('dimension')" title="Linear dimension — click two points">
                      <Ruler :size="14" /><span>Dimension</span>
                    </button>
                    <button class="tool" :class="{ on: activeTool === 'arealabel' }" @click="setTool('arealabel')" title="Area label — click inside a drawn polygon">
                      <Tag :size="14" /><span>Area</span>
                    </button>
                    <button class="tool" :class="{ on: activeTool === 'textnote' }" @click="setTool('textnote')" title="Text note — click to place">
                      <Type :size="14" /><span>Text</span>
                    </button>
                  </div>
                  <p class="pnl-note">Annotations are carried into the DXF and GeoJSON exports.</p>
                </section>
              </div>

              <!-- ── EXPORT ── -->
              <div v-if="toolsSubTab === 'export'" class="pal">
                <section class="pnl">
                  <h3 class="pnl-h">Map output</h3>
                  <div class="tool-grid tool-grid-2">
                    <button class="tool" @click="captureMapSnapshot"><Download :size="14" /><span>PNG snapshot</span></button>
                    <button class="tool" @click="printMapView"><Printer :size="14" /><span>Print view</span></button>
                  </div>
                </section>
                <section class="pnl">
                  <h3 class="pnl-h">Documents</h3>
                  <button class="btn btn-sm btn-block" :disabled="!selectedFeature" @click="exportSiteReportPDF">
                    <FileText :size="12" /> Site report (PDF)
                  </button>
                  <button class="btn btn-sm btn-block" :disabled="!planning.lots.value.length" @click="exportSubdivisionPlanPDF">
                    <FileText :size="12" /> Subdivision plan (PDF)
                  </button>
                </section>
                <section class="pnl">
                  <h3 class="pnl-h">Data handover</h3>
                  <button class="btn btn-sm btn-block" @click="exportDrawingsGeoJSON">
                    <Download :size="12" /> Drawings (GeoJSON)
                  </button>
                  <button class="btn btn-sm btn-block btn-primary" @click="exportSubdivisionDXF"
                    title="Georeferenced AutoCAD DXF — true-to-scale UTM metres, parcels auto-labelled by area">
                    <Download :size="12" /> Subdivision (DXF for AutoCAD)
                  </button>
                </section>
              </div>

              <button class="act act-primary" @click="shell.showConsole()">
                <Gavel :size="14" />
                <span><b>Planner Console</b><i>Register · enforcement · reports</i></span>
                <ChevronRight :size="12" />
              </button>
            </div>

            <!-- ══ PLANNING ═══════════════════════════════════════ -->
            <div v-if="rightTab === 'planning'" class="pane">
              <section class="pnl">
                <h3 class="pnl-h"><LayoutGrid :size="12" /> Planning actions</h3>
                <div class="acts">
                  <button class="act act-primary" :disabled="!selectedFeature" @click="openPlanningStudio">
                    <LayoutGrid :size="14" />
                    <span><b>Open Planning Studio</b><i>Full-page subdivision layout for the selected parcel</i></span>
                    <ChevronRight :size="12" />
                  </button>
                  <button class="act" :class="{ on: planning.tool.value === 'select-parcel' }"
                    @click="planning.tool.value = planning.tool.value === 'select-parcel' ? 'idle' : 'select-parcel'">
                    <Crosshair :size="14" />
                    <span><b>Set planning parcel</b><i>Click a parcel or your drawn boundary on the map</i></span>
                    <ChevronRight :size="12" />
                  </button>
                </div>
                <p class="pnl-note">Planning tools operate on the planning parcel, not on the map selection — set the parcel first.</p>
              </section>

              <PlanningPanel :planning="planning"
                @notify="(m, t) => showToast(m, t)"
                @river-buffer="addRiverBuffer"
                @export-pdf="exportSubdivisionPlanPDF"
                @focus="focusPlanningFeature" />
            </div>
          </div>
        </template>
      </aside>
    </div>

    <!-- ═══════════════ STATUS BAR ════════════════════════════════════ -->
    <footer class="pw-status" @click.stop>
      <span class="st-item" title="Coordinate reference system"><code>EPSG:4326</code></span>
      <span class="st-sep"></span>
      <span class="st-item" title="Cursor position"><MapPin :size="11" /><code>{{ cursorCoords }}</code></span>
      <span class="st-sep"></span>
      <span class="st-item" title="Zoom level"><ZoomIn :size="11" /><code>{{ mapZoom }}</code></span>
      <span class="st-sep"></span>
      <span class="st-item" title="Representative fraction"><code>{{ mapScale }}</code></span>
      <span class="st-sep"></span>
      <span class="st-item" :title="selectedFeature ? 'Current map selection' : 'Nothing selected'">
        <CircleDot :size="11" />
        <code>{{ parcelSummary ? parcelSummary.id : 'No selection' }}</code>
      </span>

      <span class="st-fill"></span>

      <span class="st-item st-state" :class="'ss-' + editingState.tone" title="Editing state">
        <PenLine :size="11" /><code>{{ editingState.label }}</code>
      </span>
      <span class="st-sep"></span>
      <button class="st-item st-btn" :class="'q-' + qgisStatus" :title="`QGIS Server — ${qgisStatusLabel}`"
        @click="revealRailSection('connections')">
        <span class="q-dot"></span><code>Map styles: {{ qgisStatusLabel }}</code>
      </button>
      <span class="st-sep"></span>
      <button class="st-item st-btn" title="Data connections" @click="revealRailSection('connections')">
        <Database :size="11" /><code>PostGIS {{ plannerLayers.length }}</code>
      </button>
    </footer>

    <!-- ══ STANDS LAYER (headless — hooks into mapInstance) ══════════ -->
    <StandsLayer
      v-if="standsVisible && mapInstance"
      ref="standsLayerRef"
      :map="mapInstance"
      :statuses="standsFilter"
      @select="onStandSelected"
    />

    <!-- ══ REGISTER STAND DIALOG ══════════════════════════════════════ -->
    <Teleport to="body">
      <div v-if="registerDialog.open" class="modal-backdrop" @click.self="registerDialog.open=false">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="reg-title">
          <header class="modal-head">
            <div class="modal-head-txt">
              <h3 id="reg-title">Register new stand</h3>
              <p class="modal-sub">
                <strong>{{ registerDialog.areaHa.toFixed(4) }} ha</strong> ·
                {{ Math.round(registerDialog.areaSqm).toLocaleString() }} m² ·
                {{ Math.round(registerDialog.perimeterM).toLocaleString() }} m perimeter
              </p>
            </div>
            <button class="modal-x" aria-label="Close" @click="registerDialog.open=false"><X :size="15" /></button>
          </header>
          <div class="modal-body">
            <div class="frm-row">
              <label class="fld"><span class="fld-label">Stand number <i>*</i></span>
                <input v-model="registerDialog.standNumber" placeholder="e.g. 1042A" class="fld-input" />
              </label>
              <label class="fld"><span class="fld-label">Ward <i>*</i></span>
                <select v-model="registerDialog.ward" class="fld-input">
                  <option value="">— select ward —</option>
                  <option v-for="w in wards" :key="w.id" :value="w.name">{{ w.name }}</option>
                </select>
              </label>
            </div>
            <label class="fld"><span class="fld-label">Planning zone</span>
              <select v-model="registerDialog.zoneId" class="fld-input" @change="onRegisterZoneChange">
                <option value="">— select zone, or type the zone type below —</option>
                <option v-for="z in plannerZones" :key="z.id" :value="z.id">
                  {{ z.zone }}{{ z.ward ? ' (' + z.ward + ')' : '' }}
                </option>
              </select>
            </label>
            <label class="fld"><span class="fld-label">Zone type <i class="fld-hint">auto-filled from zone</i></span>
              <input v-model="registerDialog.zoneType" placeholder="e.g. Proposed Peri-Urban Zone" class="fld-input" />
            </label>
            <div class="frm-row">
              <label class="fld"><span class="fld-label">Use scale</span>
                <select v-model="registerDialog.useScale" class="fld-input">
                  <option value="small_scale">Small scale</option>
                  <option value="mixed_scale">Mixed scale</option>
                  <option value="large_scale">Large scale</option>
                </select>
              </label>
              <label class="fld"><span class="fld-label">Price (USD)</span>
                <input v-model="registerDialog.priceUsd" type="number" min="0" step="0.01" placeholder="0.00" class="fld-input" />
              </label>
            </div>
            <div class="frm-row">
              <label class="fld"><span class="fld-label">Frontage (m)</span>
                <input v-model="registerDialog.frontageM" type="number" min="0" step="0.1" placeholder="e.g. 20" class="fld-input" />
              </label>
              <label class="fld"><span class="fld-label">Depth (m)</span>
                <input v-model="registerDialog.depthM" type="number" min="0" step="0.1" placeholder="e.g. 40" class="fld-input" />
              </label>
            </div>
            <label class="fld"><span class="fld-label">Description / notes</span>
              <textarea v-model="registerDialog.description" rows="2" class="fld-input fld-area"
                placeholder="Servicing status, access road, restrictions…" />
            </label>
          </div>
          <footer class="modal-foot">
            <button class="btn" @click="registerDialog.open=false">Cancel</button>
            <button class="btn btn-primary" :disabled="registerDialog.saving" @click="saveStand">
              <RefreshCw v-if="registerDialog.saving" :size="12" class="spin-icon" />
              <Plus v-else :size="12" />
              {{ registerDialog.saving ? 'Saving…' : 'Register stand' }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>

    <!-- ══ EDIT STAND DIALOG ══════════════════════════════════════════ -->
    <Teleport to="body">
      <div v-if="editDialog.open" class="modal-backdrop" @click.self="editDialog.open=false">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title">
          <header class="modal-head">
            <div class="modal-head-txt">
              <h3 id="edit-title">Edit stand {{ editDialog.standNumber }}</h3>
              <p class="modal-sub">Changes are written to the council stands register.</p>
            </div>
            <button class="modal-x" aria-label="Close" @click="editDialog.open=false"><X :size="15" /></button>
          </header>
          <div class="modal-body">
            <div class="frm-row">
              <label class="fld"><span class="fld-label">Stand number</span>
                <input v-model="editDialog.standNumber" class="fld-input" />
              </label>
              <label class="fld"><span class="fld-label">Ward</span>
                <select v-model="editDialog.ward" class="fld-input">
                  <option value="">— select —</option>
                  <option v-for="w in wards" :key="w.id" :value="w.name">{{ w.name }}</option>
                </select>
              </label>
            </div>
            <label class="fld"><span class="fld-label">Planning zone</span>
              <select v-model="editDialog.zoneId" class="fld-input" @change="onEditZoneChange">
                <option value="">— select zone —</option>
                <option v-for="z in plannerZones" :key="z.id" :value="z.id">
                  {{ z.zone }}{{ z.ward ? ' (' + z.ward + ')' : '' }}
                </option>
              </select>
            </label>
            <label class="fld"><span class="fld-label">Zone type</span>
              <input v-model="editDialog.zoneType" class="fld-input" placeholder="e.g. Proposed Peri-Urban Zone" />
            </label>
            <div class="frm-row">
              <label class="fld"><span class="fld-label">Use scale</span>
                <select v-model="editDialog.useScale" class="fld-input">
                  <option value="small_scale">Small scale</option>
                  <option value="mixed_scale">Mixed scale</option>
                  <option value="large_scale">Large scale</option>
                </select>
              </label>
              <label class="fld"><span class="fld-label">Status</span>
                <select v-model="editDialog.status" class="fld-input">
                  <option value="available">Available</option>
                  <option value="reserved">Reserved</option>
                  <option value="allocated">Allocated</option>
                  <option value="withdrawn">Withdrawn</option>
                </select>
              </label>
            </div>
            <div class="frm-row">
              <label class="fld"><span class="fld-label">Frontage (m)</span>
                <input v-model="editDialog.frontageM" type="number" min="0" step="0.1" class="fld-input" />
              </label>
              <label class="fld"><span class="fld-label">Depth (m)</span>
                <input v-model="editDialog.depthM" type="number" min="0" step="0.1" class="fld-input" />
              </label>
            </div>
            <label class="fld"><span class="fld-label">Price (USD)</span>
              <input v-model="editDialog.priceUsd" type="number" min="0" step="0.01" class="fld-input" />
            </label>
            <label class="fld"><span class="fld-label">Description / notes</span>
              <textarea v-model="editDialog.description" rows="2" class="fld-input fld-area"
                placeholder="Servicing status, access road, restrictions…" />
            </label>
          </div>
          <footer class="modal-foot">
            <button class="btn" @click="editDialog.open=false">Cancel</button>
            <button class="btn btn-primary" :disabled="editDialog.saving" @click="saveEditStand">
              <RefreshCw v-if="editDialog.saving" :size="12" class="spin-icon" />
              {{ editDialog.saving ? 'Saving…' : 'Save changes' }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>

    <!-- ══ TOAST ═════════════════════════════════════════════════════ -->
    <Transition name="toast">
      <div v-if="toast.visible" class="toast" :class="toast.type" role="status" aria-live="polite">
        <component :is="toast.type === 'error' ? AlertTriangle : CheckCircle2" :size="14" />
        {{ toast.message }}
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, nextTick, onMounted, onUnmounted, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import OpenLayersEditorMap from '@/components/OpenLayersEditorMap.vue'
import { escapeHtml } from '@/utils/escapeHtml'
import 'maplibre-gl/dist/maplibre-gl.css'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import { useSpatialStore } from '@/stores/spatial'
import { addVunguBasemap, pickTopHit, setBasemapLayerVisible, PLANNER_BASEMAP_DEFAULT } from '@/map/vunguBasemap'
import { getCatalogue, defaultTileLayers, startsCollapsed, type Catalogue } from '@/services/catalogue'
import MapLayerFilters from '@/components/MapLayerFilters.vue'
import MapLegend from '@/components/MapLegend.vue'
const editorOpen = ref(false)
const editorPending = ref(0)

function toggleEditor() {
  if (editorOpen.value && editorPending.value > 0 &&
      !window.confirm(`You have ${editorPending.value} unsaved edit${editorPending.value === 1 ? '' : 's'}. Close the editor and discard them?`)) {
    return
  }
  editorOpen.value = !editorOpen.value
  if (!editorOpen.value) editorPending.value = 0
}
function staffRoleIn(roles: string[]) { return roles.includes(authStore.user?.role || '') }
import jsPDF from 'jspdf'
import { exportFeaturesToDxf } from '@/map/tools/dxfExport'
import { usePlanningTools } from '@/planning/usePlanningTools'
import { addPlanningLayers, syncPlanningLayers, LOT_FILL_DEFAULT, LOT_FILL_BY_USE } from '@/planning/planning-layers'
import { ogcService } from '@/services/ogc'
import {
  addQgisLayer, removeQgisLayer, fetchQgisStyle, qgisVectorLayers, addVectorLayers,
  vectorIds, setLayersOpacity, qgisLegend, clearQgisStyleCache, refreshQgisOverlays, type QgisStyle,
} from '@/map/qgisWmsOverlay'
import { exportSubdivisionPlanPdf } from '@/planning/planning-exports'
import PlanningPanel from '@/components/planner/PlanningPanel.vue'
import MapContextMenu from '@/components/map/MapContextMenu.vue'
import { useRouter } from 'vue-router'
import axios from '@/utils/axios'
import {
  Map, Search, MapPin, Layers, Navigation,
  MousePointer2, PenLine, Ruler, Crosshair, Plus, Minus,
  Home, Maximize2, ZoomIn, CircleDot,
  X, ChevronRight, FileText, Building,
  RefreshCw, ShieldCheck, AlertTriangle, CheckCircle2,
  Download,
  Server, Link2, Wheat,
  Users, Landmark, Gavel,
  AlertOctagon,
  // AutoCAD-style toolkit icons
  Slash, Spline, Circle, Crop, Scissors, RotateCw, Scaling,
  FlipHorizontal, SplitSquareHorizontal, Move, Tag, Type, Magnet,
  LayoutGrid,
  // Enterprise chrome
  Eye, EyeOff, MoreVertical, Bell, Printer, ChevronDown, Database,
  PanelLeft, PanelRight, Clock,
  // Mobile floating rail controls
  Info,
} from 'lucide-vue-next'
import { useAuthStore } from '../../stores/auth'
import { plannerApi, spatialApi } from '../../services/api'
import { usePlannerShell } from '@/composables/usePlannerShell'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { useBreakpoint, BREAKPOINTS } from '@/composables/useBreakpoint'
import { deriveStatutoryState } from '@/composables/useStatutoryClock'
import StandsLayer from '@/components/shared/StandsLayer.vue'
import type { StandFeature, StandStatus } from '@/services/standsService'

const authStore = useAuthStore()
const shell = usePlannerShell()
const { current, save } = usePlannerCase()

// ── Land-subdivision planning (Phase 1, planner-only) ──────────────────────
// Sits ALONGSIDE the statutory case logic — never touches usePlannerCase or
// dmApi. Only planners (route is auth-gated; tab gated on isPlanner) see it.
const planning = usePlanningTools()
const canPlan = computed(() => authStore.isPlanner)
const planningReady = ref(false)
const router = useRouter()

// Right-click context menu state (desktop-style "Subdivide this land").
const ctxMenu = ref<{
  open: boolean; x: number; y: number; layer: string; title: string
  fid: number | null; properties: any | null; loadFeature: (() => Promise<any | null>) | null
}>(
  { open: false, x: 0, y: 0, layer: '', title: '', fid: null, properties: null, loadFeature: null },
)
function closeCtxMenu() { ctxMenu.value.open = false }
async function onCtxAction(key: string) {
  const { layer, fid, properties, loadFeature } = ctxMenu.value

  // Subdivide navigates on layer + fid alone — both come straight off the rendered
  // tile. The Studio re-loads the parcel from its own route params, so making this
  // wait on a geometry fetch only meant a dead menu item whenever the API was slow.
  if (key === 'subdivide') {
    if (!layer || fid == null) {
      showToast('Right-click a cadastral parcel to subdivide', 'error'); return
    }
    // Carry the active statutory case so the studio's Export to Map can link
    // the proposal to it and write the case audit event.
    const c = current.value
    router.push({
      path: `/planner/studio/${layer}/${fid}`,
      query: c?.permitId ? { case: c.permitId, ref: c.registrationNo } : undefined,
    })
    return
  }

  // The remaining actions do need the un-clipped geometry, so they pay for it here.
  const feature = loadFeature ? await loadFeature() : null

  if (key === 'set-area') {
    if (!feature) { showToast('Could not load that parcel — check the connection', 'error'); return }
    if (planning.selectParcel(feature, feature.properties?.name)) {
      planning.tool.value = 'idle'; rightTab.value = 'planning'; fitToPlanningArea()
      showToast('Planning parcel selected', 'success')
    }
  } else if (key === 'details') {
    // Falls back to the tile attributes so details still open when the fetch fails.
    const props = feature?.properties || properties || {}
    selectedFeature.value = {
      ...props,
      _layerId:   layer,
      _layerName: layer.replace(/_/g, ' '),
      _geomType:  feature?.geometry?.type || '—',
    }
    rightTab.value = 'info'
  }
}
// Open the full-page subdivision studio for the selected cadastral feature —
// the same route the right-click "Subdivide this land" action uses, exposed as
// a first-class planning action so it isn't buried in a context menu.
function openPlanningStudio() {
  const f = selectedFeature.value as any
  const fid = f?.fid ?? f?.id
  if (!f?._layerId || fid == null) {
    showToast('Select a cadastral parcel on the map first', 'error'); return
  }
  const c = current.value
  router.push({
    path: `/planner/studio/${f._layerId}/${fid}`,
    query: c?.permitId ? { case: c.permitId, ref: c.registrationNo } : undefined,
  })
}

const planRoadPts = ref<[number, number][]>([])   // in-progress street vertices
const splitTargetLotId = ref<string | null>(null) // lot picked for the Split tool
const splitCutPts = ref<[number, number][]>([])    // in-progress split cut line

function resizeMap() { mapInstance.value?.resize() }
function flyTo(centroid: [number, number]) {
  mapInstance.value?.flyTo({ center: centroid, zoom: 17, speed: 1.2 })
}
defineExpose({ resizeMap, flyTo })

// Open the Section 26 workflow for the selected stand. Applications are
// lodged by applicants (citizen portal), so the planner never registers a
// fresh one here: if a permit exists, open that case; otherwise just open
// the console (which prompts the officer to pick an application to review).
function actOnSelectedStand() {
  if (standPermits.value.length) shell.openCaseForStand(standPermits.value[0].id)
  else shell.showConsole('workflow')
}

// Pull abutting owners from a spatial buffer around the selected stand and
// hand them to the Section 26 public-notice step (Step 5).
const OWNER_KEYS = ['owner', 'owner_name', 'registered_owner', 'holder', 'occupier', 'proprietor']
const STAND_KEYS_FALLBACK = ['stand_number', 'stand_no', 'standno', 'erf_no', 'parcel_id']

function extractOwners(features: any[]): string[] {
  const out = new Set<string>()
  for (const f of features ?? []) {
    const p = f?.properties ?? f ?? {}
    let name = ''
    for (const k of OWNER_KEYS) if (typeof p[k] === 'string' && p[k].trim()) { name = p[k].trim(); break }
    if (!name) for (const k of STAND_KEYS_FALLBACK) {
      if (p[k] != null && String(p[k]).trim()) { name = `Stand ${String(p[k]).trim()}`; break }
    }
    if (name) out.add(name)
  }
  return [...out]
}

async function useAbuttingOwners() {
  const parcelId = (selectedFeature.value as any)?.properties?.id
    ?? (selectedFeature.value as any)?.id
  if (!parcelId) { showToast('Select a stand first', 'error'); return }
  if (!current.value) {
    showToast('Open or register a case first, then add abutting owners', 'error')
    return
  }
  try {
    const res = await spatialApi.getSurroundingParcels(String(parcelId), 100)
    const features = res.data?.features ?? res.data?.data?.features ?? res.data ?? []
    const owners = extractOwners(features)
    if (!owners.length) { showToast('No abutting owners found', 'error'); return }
    const pn = current.value.notices.publicNotice
      ?? { newspaper: '', publishedAt: '', abuttingOwners: [], proofUploadedAt: null }
    pn.abuttingOwners = owners
    current.value.notices.publicNotice = pn
    save()
    showToast(`${owners.length} abutting owner(s) added to the public notice`)
    shell.showConsole('workflow')
  } catch {
    showToast('Could not fetch abutting owners', 'error')
  }
}

// Top chrome (brand, profile, logout) now lives in PlannerShell.

// ── QGIS Server integration ───────────────────────────────────────────────
// The QGIS Server address is backend configuration (QGIS_SERVER_URL). The
// frontend only talks to the backend OGC bridge (/api/ogc/*), which proxies
// WMS renders and falls back to the QGIS project file when the server is
// unreachable — nothing here is typed in or hardcoded.
const qgisConnecting       = ref(false)
const qgisError            = ref('')
const qgisStatus           = ref<'unknown' | 'healthy' | 'degraded' | 'offline'>('unknown')
const qgisLayers           = ref<{ name: string; title: string; geometry?: string }[]>([])
const qgisActiveLayerNames = ref<string[]>([])
const qgisLastSync         = ref<string>('')

const qgisStatusLabel = computed(() => ({
  unknown:  'Not connected',
  healthy:  'Connected',
  degraded: 'Limited — using saved styles',
  offline:  'Unreachable',
}[qgisStatus.value]))

async function connectQgis(quiet = false) {
  qgisConnecting.value = true
  qgisError.value = ''
  try {
    const health = await ogcService.health().catch(() => null)
    qgisStatus.value = health?.data?.status ?? 'degraded'
    // The project catalogue is read from the .qgs file even when QGIS Server
    // itself is down, so a failed probe must not hide those layers.
    const layers = await ogcService.getAvailableLayers()
    qgisLayers.value = layers.map((l: any) => ({
      name: l.name,
      title: l.title || humanise(l.name),
      geometry: l.geometry || l.geometryType,
    }))
    qgisLastSync.value = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    if (!qgisLayers.value.length) {
      qgisError.value = 'Connected, but the QGIS project publishes no layers'
    } else if (!quiet) {
      showToast(`QGIS Server — ${qgisLayers.value.length} layers available`)
    }
  } catch {
    qgisStatus.value = 'offline'
    qgisError.value = 'QGIS service unreachable — check the backend OGC bridge'
  } finally {
    qgisConnecting.value = false
  }
}

async function toggleQgisLayer(ql: { name: string; title: string; geometry?: string }) {
  const map = mapInstance.value
  if (!map) return
  if (qgisActiveLayerNames.value.includes(ql.name)) {
    removeQgisLayer(map, ql.name)
    qgisActiveLayerNames.value = qgisActiveLayerNames.value.filter(n => n !== ql.name)
    showToast(`${ql.title || humanise(ql.name)} hidden`)
    return
  }

  // Shared overlay module (also used by the home map) does the rendering:
  // WMS raster from QGIS Server when healthy, PostGIS/WFS vectors when not.
  // Insert beneath the planning overlay so drafted roads/lots stay on top.
  const beforeId = map.getLayer('pl-area-fill') ? 'pl-area-fill' : undefined
  try {
    const mode = await addQgisLayer(map, ql, {
      mode: qgisStatus.value === 'healthy' ? 'wms' : 'vector',
      opacity: 0.8,
      beforeId,
    })
    qgisActiveLayerNames.value = [...qgisActiveLayerNames.value, ql.name]
    loadStyle(ql.name)
    showToast(`${ql.title || ql.name} added${mode === 'vector' ? ' (vector fallback)' : ''}`)
  } catch (e: any) {
    showToast(`Could not load ${ql.title || ql.name}: ${e?.message || 'error'}`, 'error')
  }
}

// ── Live symbology ────────────────────────────────────────────────────────
// Saving the QGIS project makes the backend drop its rendered tiles and push a
// `style` event on /api/map/events. Repaint what is on screen from the new
// symbology instead of waiting for a reload or a layer toggle.
let styleRefreshTimer: ReturnType<typeof setTimeout> | null = null
function onMapEvent(e: { detail?: { type?: string } }) {
  if (e.detail?.type !== 'style') return
  // A save can emit several events in a burst; handle the last one.
  if (styleRefreshTimer) clearTimeout(styleRefreshTimer)
  styleRefreshTimer = setTimeout(() => { void refreshSymbology() }, 400)
}

/** Re-read QGIS symbology and repaint every layer that uses it. */
async function refreshSymbology() {
  const map = mapInstance.value
  if (!map) return
  clearQgisStyleCache()
  const active = qgisLayers.value.filter(l => qgisActiveLayerNames.value.includes(l.name))
  await refreshQgisOverlays(map, active, {
    opacity: 0.8,
    beforeId: map.getLayer('pl-area-fill') ? 'pl-area-fill' : undefined,
  })
  active.forEach(l => loadStyle(l.name))
  await restyleLoadedPlannerLayers()
  showToast('QGIS symbology updated')
}

// Municipal layers already on the map keep their GeoJSON source; only their
// style layers are rebuilt. A style that fails to load keeps what is drawn.
async function restyleLoadedPlannerLayers() {
  const map = mapInstance.value
  if (!map) return
  for (const l of plannerLayers.value) {
    if (!loadedLayerIds.has(l.id) || l.id.startsWith('wms-')) continue
    const style = await fetchQgisStyle(l.id)
    if (!style) continue
    qgisStyles[l.id] = style
    const mapId = `planner-${l.id}`
    const sourceId = `planner-src-${l.id}`
    const data: any = map.getSource(sourceId)?._data
    const geomType = l._raw?.geometry_type || (data?.features?.[0] ?? data)?.geometry?.type || 'polygon'
    const hidden = layerVisibility[l.id] === false
    for (const id of plannerLayerStyleIds(l.id)) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    addVectorLayers(map, qgisVectorLayers(mapId, sourceId, geomType, style, (layerOpacity[l.id] ?? 80) / 100))
    if (hidden) {
      for (const id of plannerLayerStyleIds(l.id)) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none')
      }
    }
  }
}

// ── Legend / Map Filters ──────────────────────────────────────────────────
// Two filter groups serve a Town Planning Officer's day-to-day map work:
//
//   1. BASEMAP — toggles cadastre + Use-Class zoning + sensitive ground.
//      These map to MapLibre basemap style layers via substring patterns.
//      Categories track the things a planner reaches for during the
//      Section 26 due-diligence check (zoning conformity, env. sensitivity,
//      adjacent uses, road access).
//
//   2. PERMIT OVERLAY — toggles permit/enforcement data markers grouped
//      by what the planner needs to act on: deadline pressure, Section
//      26(3) special-consent cases, active enforcement, decided permits.
//      These are wired to the dmApi data layer (see the Permit Register
//      section in /planner-workspace). The toggle state lives here; the
//      data-layer renderer reads it.

// Legend / basemap-pattern filters were removed in favour of the
// PostGIS layer chip panel (MapLayerFilters) — see template.

// ── Spatial store ─────────────────────────────────────────────────────────
const spatialStore = useSpatialStore()

// ── Map instance ──────────────────────────────────────────────────────────
const mapContainer = ref<HTMLElement|null>(null)
// maplibre's nominal Map class clashes with Vue's PropType + default-import
// interop across StandsLayer / planning-layers; typed any to match the file's
// existing as-any map handling (see the TS2589 note below).
const mapInstance   = ref<any>(null)
const mapLoading    = ref(true)
const mapZoom       = ref(13)
const mapCenterLat  = ref(-19.48)
const cursorCoords  = ref('29.8167° E, 19.4500° S')

// Representative fraction for the status bar. Web-Mercator ground resolution
// at the view centre, over the OGC standard pixel size (0.28 mm) — the same
// convention QGIS and ArcGIS print in their scale box.
const mapScale = computed(() => {
  const mPerPx = (40075016.686 * Math.cos((mapCenterLat.value * Math.PI) / 180)) / Math.pow(2, mapZoom.value + 8)
  const denom = mPerPx / 0.00028
  if (!isFinite(denom) || denom <= 0) return '—'
  return `1:${Math.round(denom).toLocaleString()}`
})

// Layer visibility + opacity state (id → value)
const layerVisibility = reactive<Record<string, boolean>>({})
const layerOpacity    = reactive<Record<string, number>>({})
// track which layer ids have been added to the map
const loadedLayerIds  = reactive<Set<string>>(new Set())

// ── Drawing / tool state ──────────────────────────────────────────────────
const drawPoints      = ref<[number,number][]>([])          // in-progress polygon vertices
const drawnPolygons   = ref<{id:string;coords:[number,number][];areaSqm:number;areaHa:number;perimeterM:number}[]>([])
const measurePoints   = ref<[number,number][]>([])          // measure tool clicked points
const measureLiveCoord = ref<[number,number]|null>(null)    // live mouse position for measure preview
const drawStats       = ref<{areaSqm:number;areaHa:number;perimeterM:number}|null>(null)
const toolsReady      = ref(false)

// ── AutoCAD-style toolkit state ─────────────────────────────────────────────
// Object snap settings — snap to geometry the planner has already drawn.
const snap = reactive({ enabled: true, vertex: true, midpoint: true, intersection: false })
const offsetDistance = ref(5)                                  // metres
const cadFeatures = ref<GeoJSON.Feature[]>([])                 // committed lines/arcs/circles/polygons
const cadPoints   = ref<[number,number][]>([])                 // in-progress vertices
interface CadLabel { id: string; lngLat: [number,number]; text: string }
const cadLabels   = ref<CadLabel[]>([])                        // dimension / area / text annotations
let   cadMarkers: maplibregl.Marker[] = []
let   cadSeq = 0
const CAD_CLICK_TOOLS = ['line','polyline','arc','circle','dimension','arealabel','textnote']

// ── Stands layer ──────────────────────────────────────────────────────────
const standsLayerRef   = ref<InstanceType<typeof StandsLayer> | null>(null)
const standsVisible    = ref(true)
const standsFilter     = ref<StandStatus[]>(['available', 'reserved', 'allocated'])
const selectedStand    = ref<StandFeature | null>(null)

// Zones list for dropdown in register/edit dialogs
const plannerZones = ref<{ id: string; zone: string; zoneType: string; ward: string }[]>([])
async function loadPlannerZones() {
  try {
    // baseURL is already '/api'; the real endpoint is /api/development-control/zones,
    // which returns { data: [{ id, zone_code, zone_name, zone_type, ... }] } (flat
    // rows, not GeoJSON). The list endpoint carries no ward, so it stays blank.
    const res = await axios.get('/development-control/zones')
    plannerZones.value = (res.data.data ?? []).map((z: any) => ({
      id: String(z.id), zone: z.zone_name,
      zoneType: z.zone_type, ward: '',
    }))
  } catch { /* zones unavailable — user can type manually */ }
}

// Register-stand dialog: shown after planner finishes drawing a polygon
const registerDialog = reactive({
  open: false,
  standNumber: '',
  ward: '',
  zoneId:     '' as string,
  zoneType:   '',
  useScale:   'mixed_scale' as string,
  frontageM:  '' as string | number,
  depthM:     '' as string | number,
  priceUsd:   '' as string | number,
  description:'',
  saving:     false,
  geometry:   null as GeoJSON.Polygon | null,
  areaSqm:    0,
  areaHa:     0,
  perimeterM: 0,
})

// Edit-stand dialog
const editDialog = reactive({
  open:        false,
  id:          '',
  standNumber: '',
  ward:        '',
  zoneId:      '' as string,
  zoneType:    '',
  useScale:    '' as string,
  frontageM:   '' as string | number,
  depthM:      '' as string | number,
  priceUsd:    '' as string | number,
  description: '',
  status:      'available' as string,
  saving:      false,
})

// ── Workspace rail state ─────────────────────────────────────────────────
// Enterprise workstation layout: a persistent DATA rail (left) and CONTEXT
// rail (right) frame a dominant map. Both collapse to an icon strip rather
// than to zero width, so the sections stay discoverable — a planner working
// eight hours a day should never hunt for the layer tree.
// Layout choices persist per-browser: reopening the workspace restores the
// rails and the last-used context tab.
const { isMobile } = useBreakpoint()

const WS_KEY = 'vungu.planner.workspace.v1'
const saved = (() => {
  try { return JSON.parse(localStorage.getItem(WS_KEY) || '{}') } catch { return {} }
})()
// On a phone both rails start closed regardless of what was saved: at that
// width they are full-width sheets, so restoring "expanded" would open the
// workspace with the map entirely covered. The saved preference is not
// overwritten, only not applied here, so the planner's desktop layout is
// still waiting for them when they sit back down.
const startCollapsedOnPhone =
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia(`(max-width: ${BREAKPOINTS.mobile}px)`).matches

const leftCollapsed  = ref<boolean>(startCollapsedOnPhone || (saved.leftCollapsed ?? false))
const rightCollapsed = ref<boolean>(startCollapsedOnPhone || (saved.rightCollapsed ?? false))
const rightTab       = ref<'info'|'permits'|'checks'|'tools'|'planning'>(saved.rightTab ?? 'info')

// Left-rail accordion sections. All open by default — an enterprise data rail
// shows its tree, it does not make the operator expand it every session.
const railOpen = reactive<Record<'workspace'|'layers'|'connections', boolean>>({
  workspace:   saved.railOpen?.workspace   ?? true,
  layers:      saved.railOpen?.layers      ?? true,
  connections: saved.railOpen?.connections ?? true,
})
function toggleRail(k: 'workspace'|'layers'|'connections') { railOpen[k] = !railOpen[k] }
/** Expand the rail and reveal a section — used by the status-bar/QGIS chips. */
function revealRailSection(k: 'workspace'|'layers'|'connections') {
  leftCollapsed.value = false
  railOpen[k] = true
  nextTick(() => document.getElementById(`rail-sec-${k}`)?.scrollIntoView({ block: 'nearest' }))
}

// The basemap chip panel (PostGIS tile layers) floats over the map top-left.
const layerPanelOpen = ref(false)
function toggleLayers() { layerPanelOpen.value = !layerPanelOpen.value }

// Per-layer overflow menu (opacity · zoom to · info) — one open at a time.
const layerMenuId = ref<string | null>(null)
function toggleLayerMenu(id: string) { layerMenuId.value = layerMenuId.value === id ? null : id }

// Command-bar popovers.
const exportMenuOpen = ref(false)
const notifOpen      = ref(false)

// Click-away for every transient overlay. The search box is only dismissed,
// not cleared — a planner clicking the map to check a result should still
// find their query in the box.
function closeOverlays() {
  layerMenuId.value = null
  exportMenuOpen.value = false
  notifOpen.value = false
  searchActive.value = false
  closeCtxMenu()
}

// Planner-focused context tabs. All five are driven by the selected feature
// on the map (a stand / parcel). The admin/workflow surfaces (Permit
// Register, Enforcement, Building Plans, Reports) live in the Planner
// Console at /planner-workspace — they're not duplicated here.
const rightTabs = [
  { id:'info',     icon: MapPin,      label:'Property' },
  { id:'permits',  icon: FileText,    label:'Permits'  },
  { id:'checks',   icon: ShieldCheck, label:'Checks'   },
  { id:'tools',    icon: Ruler,       label:'Tools'    },
  { id:'planning', icon: LayoutGrid,  label:'Planning' },
] as const
// The Planning tab is planner-only (citizens / other roles never see it).
const visibleRightTabs = computed(() => rightTabs.filter(t => t.id !== 'planning' || canPlan.value))

// Persist workspace layout so the workstation reopens the way it was left.
watch([leftCollapsed, rightCollapsed, rightTab, railOpen], () => {
  try {
    localStorage.setItem(WS_KEY, JSON.stringify({
      leftCollapsed: leftCollapsed.value, rightCollapsed: rightCollapsed.value,
      rightTab: rightTab.value, railOpen: { ...railOpen },
    }))
  } catch { /* private mode — layout simply won't persist */ }
}, { deep: true })

// ── Statutory case context ───────────────────────────────────────────────
// The GIS surface is not the case workspace, but a planner must never lose
// sight of the 90-day Section 26(7) clock while working the map. This derives
// a compact banner from the SAME case file the console edits — no new state.
const caseCtx = computed(() => {
  const c = current.value
  if (!c) return null
  const clock = deriveStatutoryState(c.acknowledgedDate)
  return {
    ref: c.registrationNo || c.fileRef || 'Unregistered case',
    standNo: c.property?.standNo || '',
    devType: (c.proposal?.devType || '').replace(/_/g, ' '),
    permitId: c.permitId,
    daysRemaining: clock.daysRemaining,
    expiry: clock.expiryDate ? clock.expiryDate.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : null,
    level: clock.warningLevel,
    phase: clock.phase.replace(/_/g, ' '),
  }
})
/** True when the selected map feature is the stand on the open case file. */
const caseMatchesSelection = computed(() => {
  const s = caseCtx.value?.standNo
  return !!s && !!selectedFeature.value && extractStandRef(selectedFeature.value) === s
})

// ── Wards — fetched from PostGIS (wards table) ───────────────────────────
// Centroids and names come from GET /api/wards. The list is the council's
// administrative reference, so it loads once on mount and feeds the
// selector + flyTo.
interface Ward { id: number; name: string; center: [number, number] }
const wards = ref<Ward[]>([])
const selectedWard = ref<number|''>('')
const currentWard  = computed(() => wards.value.find(w => w.id === selectedWard.value))
function flyToWard() {
  const ward = currentWard.value
  if (!ward || !mapInstance.value) return
  mapInstance.value.flyTo({ center: ward.center, zoom: 13, speed: 1.2 })
  showToast(`Zoomed to ${ward.name}`)
}
// 'loading' until the request settles; getWards() returns [] on failure, and
// the note used to say "Loading…" forever when it did.
const wardsState = ref<'loading' | 'done'>('loading')
async function loadWards() {
  const { getWards } = await import('@/services/vectorTiles')
  const records = await getWards()
  wardsState.value = 'done'
  wards.value = records.map(r => ({ id: r.fid, name: r.name, center: r.center }))
  // After wards load, fit the map to Vungu district extent, unless the QGIS project already says where to open.
  if (records.length > 0 && mapInstance.value && !catalogue.value?.project.extent) {
    const lngs = records.map(r => r.center[0]).filter(Boolean)
    const lats = records.map(r => r.center[1]).filter(Boolean)
    if (lngs.length) {
      const pad = 0.15
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lngs) - pad, Math.min(...lats) - pad],
        [Math.max(...lngs) + pad, Math.max(...lats) + pad],
      ]
      mapInstance.value.fitBounds(bounds, { padding: 40, maxZoom: 12, duration: 1000 })
    }
  }
}

// ── Planner layers (fixed set + dynamic from store) ───────────────────────
// Symbology comes from the QGIS project (fetchQgisStyle), keyed by table name.
// A style is fetched when its layer is first switched on (the endpoint is
// slow, see fetchQgisStyle); from then on the row shows the real swatch and
// the layer's legend.
const qgisStyles = reactive<Record<string, QgisStyle>>({})
function loadStyle(name: string) {
  void fetchQgisStyle(name).then(s => { if (s) qgisStyles[name] = s })
}
/** Swatch = the first class colour; a neutral grey when QGIS has no style. */
function layerColor(id: string) {
  return qgisLegend(qgisStyles[id] ?? null).find(r => r.color !== 'rgba(0,0,0,0)')?.color ?? '#94a3b8'
}
const plannerLayerStyleIds = (id: string) => [...Object.values(vectorIds(`planner-${id}`)), `planner-${id}-labels`]
// QGIS layer names are table names; the project sets no titles.
const humanise = (name: string) => name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
function layerType(l: any): string {
  if (l.type === 'WMS' || l.type === 'WFS') return l.type
  const g = (l.geometry_type || '').toLowerCase()
  if (g.includes('point')) return 'Point'
  if (g.includes('line') || g.includes('linestring')) return 'Line'
  if (g.includes('poly')) return 'Polygon'
  return 'Vector'
}

// Merged: dynamic store layers presented as planner layer entries
const plannerLayers = computed(() => {
  const storeLayers = spatialStore.allAvailableLayers as any[]
  return storeLayers.map(l => ({
    id:    l.id,
    name:  l.name,
    // Registry boilerplate ("Auto-registered polygon layer") says nothing to a
    // planner; show a description only when someone wrote one.
    desc:  /auto-?registered/i.test(l.description || l.metadata?.abstract || '') ? '' : (l.description || l.metadata?.abstract || ''),
    color: layerColor(l.id),
    type:  layerType(l),
    // The spatial service flags views and key-less tables it cannot serve.
    loadable: l.loadable !== false,
    _raw:  l,
  }))
})

// The layer catalogue: declared by the QGIS project, approved by the server (services/catalogue.ts).
// The panel groups layers as the project does and the map opens where the project's author left it.
// If the catalogue cannot be fetched the panel falls back to the flat list and the built-in defaults.
const catalogue = ref<Catalogue | null>(null)
const collapsedGroups = reactive<Record<string, boolean>>({})

const layerGroups = computed(() => {
  const cat = catalogue.value
  if (!cat) return [{ key: 'all', name: 'Municipal layers', layers: plannerLayers.value }]
  // (A plain object: this component imports the lucide `Map` icon, which shadows the global Map.)
  const byId: Record<string, (typeof plannerLayers.value)[number]> = {}
  plannerLayers.value.forEach(p => { byId[p.id] = p })
  return cat.groups
    .map(g => ({
      key: g.name,
      name: g.name,
      // Titles come from the catalogue; a layer the spatial service cannot toggle is not listed.
      layers: g.layers.map(c => {
        const p = byId[c.id] ?? byId[c.table]
        if (p) return { ...p, name: c.title }
        // The project declares it but the older layer list has no row for it (the zones view the project
        // reads, for one). Tile layers still toggle through the basemap, so they are listed; a layer that
        // is neither cannot be loaded from here and is listed disabled rather than hidden.
        return {
          id: c.id, name: c.title, desc: '', color: layerColor(c.id),
          type: c.geometryType === 'line' ? 'Line' : c.geometryType === 'point' ? 'Point' : 'Polygon',
          loadable: c.tile, _raw: null,
        } as (typeof plannerLayers.value)[number]
      }),
    }))
    .filter(g => g.layers.length)
})

function fitToCatalogueExtent(duration = 0) {
  const ext = catalogue.value?.project.extent
  if (!ext || !mapInstance.value) return false
  mapInstance.value.fitBounds([[ext[0], ext[1]], [ext[2], ext[3]]] as any, { padding: 40, duration })
  return true
}

// A layer the basemap already draws (as vector tiles) is switched on or off in the basemap.
// The panel's eye must say what the map shows: it used to read "off" for layers that were on.
const isBasemapLayer = (id: string) => !!mapInstance.value?.getLayer(`vungu-${id}`)

function syncBasemapVisibility() {
  const map = mapInstance.value
  if (!map) return
  // Catalogue entries too: the project's zones layer has no row in the older layer list.
  for (const l of [...plannerLayers.value, ...layerGroups.value.flatMap(g => g.layers)]) {
    const sid = `vungu-${l.id}`
    if (map.getLayer(sid)) layerVisibility[l.id] = map.getLayoutProperty(sid, 'visibility') !== 'none'
  }
}

// Sync visibility defaults when new layers arrive
watch(plannerLayers, (layers) => {
  layers.forEach(l => {
    if (!(l.id in layerVisibility)) layerVisibility[l.id] = false
    if (!(l.id in layerOpacity))    layerOpacity[l.id]    = 80
  })
  syncBasemapVisibility()
}, { immediate: true })

async function toggleLayer(l: any) {
  if (l.loadable === false) return
  const nowVisible = !layerVisibility[l.id]
  layerVisibility[l.id] = nowVisible
  if (!mapInstance.value) return

  if (isBasemapLayer(l.id)) {
    setBasemapLayerVisible(mapInstance.value, l.id, nowVisible)
    showToast(`${l.name} ${nowVisible ? 'shown' : 'hidden'}`)
    return
  }

  const map = mapInstance.value

  if (nowVisible && !loadedLayerIds.has(l.id)) {
    await addLayerToMap(l)
  } else {
    // Every style layer of this dataset: hiding only the fill used to leave
    // its outline (and casing, labels) drawn on a "hidden" layer.
    for (const id of plannerLayerStyleIds(l.id)) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', nowVisible ? 'visible' : 'none')
    }
  }
  showToast(`${l.name} ${nowVisible ? 'shown' : 'hidden'}`)
}

function setLayerOpacity(l: any, value: number) {
  layerOpacity[l.id] = value
  if (mapInstance.value) setLayersOpacity(mapInstance.value, plannerLayerStyleIds(l.id), value / 100)
}

// Zoom the view to a loaded layer's full extent — the "Zoom to layer" any GIS
// operator expects on a layer-tree row. Reads the bbox off the geojson source
// that addLayerToMap already created, so it costs no extra request.
function zoomToLayer(l: any) {
  const map = mapInstance.value
  if (!map) return
  const src: any = map.getSource(`planner-src-${l.id}`)
  const data = src?._data
  if (!data?.features?.length) { showToast(`${l.name} is not loaded yet — switch it on first`, 'error'); return }
  try {
    const bb = turf.bbox(data)
    map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]] as any, { padding: 60, duration: 600 })
    layerMenuId.value = null
  } catch { showToast(`Could not read the extent of ${l.name}`, 'error') }
}

// Feature count for a loaded layer — shown on the layer row so the operator
// knows whether an empty map means "no data" or "not loaded".
function layerFeatureCount(id: string): number | null {
  const src: any = mapInstance.value?.getSource(`planner-src-${id}`)
  return src?._data?.features?.length ?? null
}

async function addLayerToMap(l: any) {
  const map = mapInstance.value
  if (!map) return
  const raw = l._raw
  const sourceId = `planner-src-${l.id}`
  const mapId    = `planner-${l.id}`

  try {
    // WMS layer
    if (l.id.startsWith('wms-')) {
      const layerName = l.id.slice(4)
      const wmsUrl = (raw.metadata?.url || '').split('?')[0]
      if (!wmsUrl) return
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: 'raster',
          tiles: [`${wmsUrl}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${encodeURIComponent(layerName)}&STYLES=&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}`],
          tileSize: 256
        })
      }
      if (!map.getLayer(mapId)) {
        map.addLayer({
          id: mapId,
          type: 'raster',
          source: sourceId,
          paint: { 'raster-opacity': (layerOpacity[l.id] ?? 80) / 100 }
        })
      }
      loadedLayerIds.add(l.id)
      return
    }

    // Vector GeoJSON layer via dynamic-layers API.
    // The backend ships a TopoJSON envelope (type: 'Topology') with the
    // features tucked inside objects.collection — MapLibre's geojson source
    // only understands plain GeoJSON, so unwrap before passing it in.
    const response = await axios.get(`/dynamic-layers/layer/${l.id}`, { params: { limit: 5000 } })
    const payload = response.data
    let geojson: any = null
    if (payload?.type === 'FeatureCollection' || payload?.type === 'Feature') {
      geojson = payload
    } else if (payload?.type === 'Topology' && payload.objects?.collection) {
      geojson = payload.objects.collection
    } else if (payload?.geojson) {
      geojson = payload.geojson
    } else if (payload?.data?.type) {
      geojson = payload.data
    }
    if (!geojson || !geojson.type) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: 'geojson', data: geojson })
    }

    if (!map.getLayer(mapId)) {
      // The registry leaves geometry_type null for most tables, which used to
      // draw rivers and clinics as polygons: read it off the data instead.
      const firstGeom = (geojson.features?.[0] ?? geojson)?.geometry?.type
      const geomType  = raw.geometry_type || firstGeom || 'polygon'
      // Same symbology QGIS draws for this table (read from the project file,
      // so it holds while QGIS Server is down); statutory palette otherwise.
      const style = await fetchQgisStyle(l.id)
      if (style) qgisStyles[l.id] = style
      addVectorLayers(map, qgisVectorLayers(mapId, sourceId, geomType, style, (layerOpacity[l.id] ?? 80) / 100))
    }

    loadedLayerIds.add(l.id)

    // Click interactivity. MapLibre fires this per-layer handler for every
    // visible layer with a feature at the click point, so when overlays
    // stack (e.g. a peri-urban zone drawn over a farm) every layer's
    // handler races to write `selectedFeature` and the last one wins.
    // pickTopHit imposes a specificity priority across ALL hits at the
    // pixel — points > parcels > farms > zones > landuse > admin — and we
    // only write if THIS layer is the winner. The other layers' handlers
    // see the same hit list and silently bow out.
    map.on('click', mapId, (e: any) => {
      const feat = e.features?.[0]
      if (!feat) return
      const allHits = map.queryRenderedFeatures(e.point)
      const top = pickTopHit(allHits as any[])
      if (top && top.layer?.id !== mapId) return
      selectedFeature.value = {
        ...feat.properties,
        _layerId:     l.id,
        _layerName:   l.name,
        _geomType:    feat.geometry?.type || '—',
        _clickCoord:  `${e.lngLat.lng.toFixed(4)}° E, ${Math.abs(e.lngLat.lat).toFixed(4)}° S`,
      }
      rightTab.value = 'info'
    })
    map.on('mouseenter', mapId, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', mapId, () => { map.getCanvas().style.cursor = activeTool.value === 'select' ? 'default' : 'crosshair' })

  } catch (err) {
    console.warn(`[Planner] Could not load layer ${l.id}:`, err)
  }
}

// ── Selected feature (replaces mock stand) ───────────────────────────────
interface SelectedFeature { [key: string]: any; _layerName: string; _geomType: string; _clickCoord: string }
const selectedFeature = ref<SelectedFeature|null>(null)

const featureDisplayProps = computed(() => {
  if (!selectedFeature.value) return {}
  return Object.fromEntries(
    Object.entries(selectedFeature.value)
      .filter(([k]) => !k.startsWith('_'))
      .slice(0, 20) // cap at 20 props
  )
})
function formatPropKey(k: string) {
  return k.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Stitch "Selected Parcel" panel ─────────────────────────────────────────
// Distils the clicked feature's arbitrary GeoJSON properties into the four
// fields the Stitch card shows (id / zoning / area), falling back gracefully
// when a layer doesn't carry that attribute.
function pickProp(f: Record<string, any>, keys: string[]): string {
  for (const k of keys) {
    const v = f[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}
const parcelSummary = computed(() => {
  const f = selectedFeature.value as any
  if (!f) return null
  const area = pickProp(f, ['area', 'shape_area', 'area_sqm', 'sqm', 'area_ha', 'hectares', 'st_area'])
  return {
    id:     pickProp(f, ['stand_number', 'stand_no', 'standNo', 'parcel_id', 'PARCEL', 'erf_no', 'plot_no', 'id']) || (f._layerName ?? '—'),
    zoning: pickProp(f, ['zoning', 'zone', 'use_class', 'useclass', 'land_use', 'landuse', 'category']),
    area,
    layer:  f._layerName ?? 'Feature',
    coord:  f._clickCoord ?? '',
  }
})

// Quick-action wiring for the Stitch parcel card. These reuse the existing
// planner tools so the card is functional, not decorative:
//   • Edit geometry   → polygon draw/edit tool
//   • Rezoning         → opens the Section 26 workflow for the stand
//   • Spatial query    → buffers the stand & pulls abutting owners
function editParcelGeometry() { setTool('polygon') }
function startRezoning()      { actOnSelectedStand() }
function runSpatialQuery()    { void useAbuttingOwners() }


// ── Feature-driven planner data (permits + enforcement for the selected stand) ──
// When the planner clicks a feature on the map, we try to extract a stand
// reference from its properties and pull live records from the backend.
import { watch as _watchFeature } from 'vue'
import { dmApi as _dmApi, type PermitApplication as _PA, type EnforcementOrder as _EO, type ProhibitionOrder as _PO } from '@/services/developmentManagementService'
import { isPermitApproved } from '@/composables/useApplicationPipeline'

function extractStandRef(feat: SelectedFeature | null): string {
  if (!feat) return ''
  // Try the conventional property names a planner would expect.
  const candidates = ['stand_number','stand_no','standNo','STAND','stand','plot','plot_no','parcel_id','PARCEL']
  for (const k of candidates) {
    const v = (feat as any)[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

const standPermits     = ref<_PA[]>([])
const standEnforcement = ref<_EO[]>([])
const standProhibitions = ref<_PO[]>([])
const standLoading     = ref(false)
const standApprovedCount = computed(() =>
  standPermits.value.filter(p => isPermitApproved(p.status)).length)

async function loadStandData(standRef: string) {
  if (!standRef) {
    standPermits.value = []; standEnforcement.value = []; standProhibitions.value = []
    return
  }
  standLoading.value = true
  try {
    const [p, e, pr] = await Promise.all([
      _dmApi.listPermits({ search: standRef, limit: 50 }),
      _dmApi.listEnforcement({ stand_number: standRef }),
      _dmApi.listProhibitionOrders({ stand_number: standRef }),
    ])
    standPermits.value     = p.data
    standEnforcement.value = e
    standProhibitions.value = pr
  } catch {
    // Silent fail — leave whatever we had. The empty-state copy handles
    // the no-data case so the planner isn't blocked by transient errors.
  } finally {
    standLoading.value = false
  }
}

_watchFeature(selectedFeature, (feat) => {
  void loadStandData(extractStandRef(feat))
})

// ── Tools tab helpers ───────────────────────────────────────────────
// Tool palettes, grouped the way a GIS operator thinks about them rather than
// by which library implements them: measurement/queries, geometry creation,
// geometry modification, annotation, output.
type ToolsSubTab = 'analysis'|'draw'|'edit'|'annotate'|'export'
const toolsSubTab = ref<ToolsSubTab>('analysis')
const TOOL_PALETTES = [
  { id: 'analysis', icon: Crosshair, label: 'Analysis' },
  { id: 'draw',     icon: PenLine,   label: 'Draw'     },
  { id: 'edit',     icon: Scissors,  label: 'Edit'     },
  { id: 'annotate', icon: Tag,       label: 'Annotate' },
  { id: 'export',   icon: Download,  label: 'Export'   },
] as const

const cursorLat = ref<number | null>(null)
const cursorLng = ref<number | null>(null)
const cursorCoord = computed(() => {
  if (cursorLat.value == null || cursorLng.value == null) return ''
  return `${cursorLng.value.toFixed(5)}° E,  ${Math.abs(cursorLat.value).toFixed(5)}° S`
})

function attachCursorReadout() {
  const m = mapInstance.value
  if (!m) return
  m.on('mousemove', (e: any) => {
    cursorLat.value = e.lngLat.lat
    cursorLng.value = e.lngLat.lng
  })
  m.on('mouseout', () => { cursorLat.value = null; cursorLng.value = null })
}

async function copyCursorCoord() {
  if (!cursorCoord.value) return
  try {
    await navigator.clipboard.writeText(cursorCoord.value)
    showToast('Coordinates copied', 'success')
  } catch {
    showToast('Could not copy — clipboard unavailable', 'error')
  }
}

// Jump to coordinates (lat, lng) typed by the planner.
const gotoInput = ref('')
function gotoCoordinates() {
  const m = mapInstance.value
  if (!m) return
  const parts = gotoInput.value.split(/[,\s]+/).map(s => parseFloat(s)).filter(n => !isNaN(n))
  if (parts.length !== 2) {
    showToast('Enter as "lat, lng" — e.g. -19.45, 29.82', 'warning')
    return
  }
  const [lat, lng] = parts
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    showToast('Coordinates out of range', 'warning')
    return
  }
  m.flyTo({ center: [lng, lat], zoom: 16, speed: 1.4 })
  showToast(`Jumped to ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'info')
}

// Capture the current map view as a PNG download.
function captureMapSnapshot() {
  const m = mapInstance.value
  if (!m) return
  try {
    const canvas = m.getCanvas()
    const dataUrl = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `planner-snapshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`
    a.click()
    showToast('Map snapshot saved', 'success')
  } catch (e: any) {
    showToast('Snapshot failed — try after the map finishes drawing', 'error')
  }
}

// Print the current map view via the browser print dialog.
function printMapView() { window.print() }

// Export all planner drawings (completed polygons, measurements, buffers and
// analysis results) as a single GeoJSON FeatureCollection — the standard
// handoff format for the council GIS team.
function exportDrawingsGeoJSON() {
  const m = mapInstance.value
  if (!m) return
  const sourceIds = ['draw-completed', 'measure-src', 'buffer-src', 'analysis-results-src']
  const features: any[] = []
  for (const id of sourceIds) {
    const src = m.getSource(id) as any
    const data = src?._data
    if (!data?.features?.length) continue
    for (const f of data.features) {
      features.push({ ...f, properties: { ...(f.properties ?? {}), _source: id } })
    }
  }
  if (!features.length) { showToast('No drawings to export', 'error'); return }
  const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features }, null, 2)], { type: 'application/geo+json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `planner-drawings-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.geojson`
  a.click()
  URL.revokeObjectURL(url)
  showToast(`Exported ${features.length} feature${features.length === 1 ? '' : 's'}`, 'success')
}

// Generate a one-page site report PDF for the currently-selected stand:
// header + map snapshot + feature properties + permits on file.
async function exportSiteReportPDF() {
  const m = mapInstance.value
  if (!m) return
  if (!selectedFeature.value) { showToast('Click a stand on the map first', 'error'); return }
  try {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const imgData = m.getCanvas().toDataURL('image/png')

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    doc.setFontSize(14); doc.setFont('helvetica', 'bold')
    doc.text('Vungu RDC — Site Report', 15, 18)
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text(new Date().toLocaleString(), 15, 24)
    doc.text(`Feature: ${(selectedFeature.value as any)._layerName || 'Selected'}`, 80, 24)

    doc.addImage(imgData, 'PNG', 15, 30, 180, 100)

    // Left column: feature properties
    let y = 138
    doc.setFontSize(11); doc.setFont('helvetica', 'bold')
    doc.text('Selected feature', 15, y); y += 6
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    const props = Object.entries(featureDisplayProps.value || {}).slice(0, 10)
    if (!props.length) { doc.text('No properties available.', 15, y); y += 5 }
    for (const [k, v] of props) {
      doc.text(`${formatPropKey(String(k))}: ${String(v ?? '—')}`.slice(0, 60), 15, y)
      y += 5
    }

    // Right column: permits on file
    let py = 138
    doc.setFontSize(11); doc.setFont('helvetica', 'bold')
    doc.text('Permits on file', 110, py); py += 6
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    if (!standPermits.value.length) {
      doc.text('No permits in the Development Register.', 110, py); py += 5
    } else {
      for (const p of standPermits.value.slice(0, 10)) {
        const line = `${p.dev_register_no || p.id.slice(0, 8)} — ${p.applicant_name} — ${p.status}`
        doc.text(line.slice(0, 60), 110, py); py += 5
      }
    }

    // Footer
    doc.setFontSize(8); doc.setFont('helvetica', 'italic')
    doc.text('Generated by Vungu RDC Planning Command Center', 15, 200)

    doc.save(`site-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.pdf`)
    showToast('Site report exported', 'success')
  } catch (e: any) {
    showToast('Could not generate site report', 'error')
  }
}

// Locate-me via browser geolocation API (planners use this to confirm
// they're on the right stand during a site visit).
const locating = ref(false)
function locateMe() {
  if (!navigator.geolocation) { showToast('Geolocation not supported by this browser', 'error'); return }
  locating.value = true
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locating.value = false
      const m = mapInstance.value
      if (m) m.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 17, speed: 1.4 })
      showToast(`Located: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`, 'success')
    },
    () => { locating.value = false; showToast('Could not get location', 'error') },
    { enableHighAccuracy: true, timeout: 10_000 },
  )
}

// Clear all drawn polygons / lines / measurement geometry.
function clearAllDrawings() {
  const m = mapInstance.value
  if (!m) return
  const empty = () => ({ type: 'FeatureCollection' as const, features: [] })
  ;['draw-preview', 'draw-completed', 'measure-src', 'buffer-src'].forEach(srcId => {
    const src = m.getSource(srcId) as any
    if (src?.setData) src.setData(empty())
  })
  drawnPolygons.value = []
  bufferActive.value = false
  showToast('Drawings cleared', 'info')
}

// ════════════════════════════════════════════════════════════════════════════
//  AutoCAD-style precision toolkit
//  Line · Polyline · Arc · Circle · Offset · Trim · Rotate · Scale · Mirror ·
//  Buffer · Split Parcel · Transform (TRS) · Dimension · Area label · Text note.
//  Geometry lives in-memory (cadFeatures + marker annotations) and is drawn on
//  the dedicated 'cad-src' / 'cad-preview' map sources. turf does the maths.
// ════════════════════════════════════════════════════════════════════════════
function cadEmptyFC(): GeoJSON.FeatureCollection { return { type:'FeatureCollection', features: [] } }
function cadSetSrc(id: string, data: any) {
  ;(mapInstance.value?.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data)
}
function fmtLen(m: number): string { return m >= 1000 ? `${(m/1000).toFixed(2)} km` : `${m.toFixed(1)} m` }
function fmtArea(sqm: number): string { return sqm >= 10000 ? `${(sqm/10000).toFixed(2)} ha` : `${sqm.toFixed(0)} m²` }

// Render committed geometry + annotation markers.
function renderCad() {
  cadSetSrc('cad-src', { type:'FeatureCollection', features: cadFeatures.value })
  renderCadLabels()
}
function renderCadLabels() {
  const map = mapInstance.value
  cadMarkers.forEach(m => m.remove())
  cadMarkers = []
  if (!map) return
  for (const l of cadLabels.value) {
    const el = document.createElement('div')
    el.textContent = l.text
    el.style.cssText =
      'background:#0369a1;color:#fff;font:600 11px/1.1 ui-sans-serif,system-ui,sans-serif;' +
      'padding:2px 6px;border-radius:4px;white-space:nowrap;pointer-events:none;' +
      'box-shadow:0 1px 3px rgba(15,23,42,0.35);'
    cadMarkers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(l.lngLat).addTo(map))
  }
}

// Snap a clicked position to the nearest vertex / midpoint / intersection of
// geometry the planner has already drawn (within ~12 screen px).
function snapPoint(lngLat: [number,number], screen: { x:number; y:number }): [number,number] {
  const map = mapInstance.value
  if (!snap.enabled || !map) return lngLat
  const TOL = 12
  let best: [number,number] | null = null
  let bestD = TOL
  const consider = (c: [number,number]) => {
    const p = map.project(c as any)
    const d = Math.hypot(p.x - screen.x, p.y - screen.y)
    if (d < bestD) { bestD = d; best = c }
  }
  const rings: [number,number][][] = []
  for (const f of cadFeatures.value) {
    const g: any = f.geometry
    if (g.type === 'LineString') rings.push(g.coordinates)
    else if (g.type === 'Polygon') rings.push(g.coordinates[0])
  }
  for (const d of drawnPolygons.value) rings.push([...d.coords, d.coords[0]])
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      if (snap.vertex) consider(ring[i] as [number,number])
      if (snap.midpoint && i < ring.length - 1) {
        const a = ring[i], b = ring[i + 1]
        consider([(a[0]+b[0])/2, (a[1]+b[1])/2])
      }
    }
  }
  if (snap.intersection) {
    const lines = cadFeatures.value.filter(f => (f.geometry as any).type === 'LineString')
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        try {
          const hits = turf.lineIntersect(lines[i] as any, lines[j] as any)
          for (const h of hits.features) consider(h.geometry.coordinates as [number,number])
        } catch { /* skip */ }
      }
    }
  }
  return best ?? lngLat
}

// ── Click dispatch for the point-collecting CAD tools ───────────────────────
function handleCadClick(raw: [number,number], screen: { x:number; y:number }) {
  const tool = activeTool.value
  const pt = snapPoint(raw, screen)

  if (tool === 'textnote') {
    const text = window.prompt('Annotation text:')?.trim()
    if (text) { cadLabels.value.push({ id:`TXT${++cadSeq}`, lngLat: pt, text }); renderCadLabels() }
    return
  }
  if (tool === 'arealabel') {
    const poly = polygonAt(pt)
    if (!poly) { showToast('Click inside a drawn polygon to label its area', 'error'); return }
    const a = turf.area(poly)
    const c = turf.centroid(poly).geometry.coordinates as [number,number]
    cadLabels.value.push({ id:`AREA${++cadSeq}`, lngLat: c, text: fmtArea(a) })
    renderCadLabels()
    showToast(`Area ${fmtArea(a)}`)
    return
  }

  cadPoints.value.push(pt)
  const n = cadPoints.value.length
  if (tool === 'line' && n >= 2) finalizeCadLine()
  else if (tool === 'dimension' && n >= 2) finalizeDimension()
  else if (tool === 'circle' && n >= 2) finalizeCircle()
  else if (tool === 'arc' && n >= 3) finalizeArc()
  else updateCadPreview()
}

function updateCadPreview() {
  const pts = cadPoints.value
  const feats: GeoJSON.Feature[] = pts.map(c => ({ type:'Feature', geometry:{ type:'Point', coordinates:c }, properties:{} }))
  if (pts.length >= 2) feats.push({ type:'Feature', geometry:{ type:'LineString', coordinates:[...pts] }, properties:{} })
  cadSetSrc('cad-preview', { type:'FeatureCollection', features: feats })
}
function updateCadPreviewMouse(mouse: [number,number]) {
  const pts = cadPoints.value
  if (!pts.length) return
  const tool = activeTool.value
  const feats: GeoJSON.Feature[] = pts.map(c => ({ type:'Feature', geometry:{ type:'Point', coordinates:c }, properties:{} }))
  if (tool === 'circle' && pts.length === 1) {
    const r = turf.distance(pts[0], mouse, { units:'kilometers' })
    if (r > 0) {
      const ring = (turf.circle(pts[0], r, { steps:64 }).geometry as any).coordinates[0]
      feats.push({ type:'Feature', geometry:{ type:'LineString', coordinates: ring }, properties:{} })
    }
  } else {
    feats.push({ type:'Feature', geometry:{ type:'LineString', coordinates:[...pts, mouse] }, properties:{} })
  }
  cadSetSrc('cad-preview', { type:'FeatureCollection', features: feats })
}

function pushCad(geometry: any, kind: string) {
  cadFeatures.value.push({ type:'Feature', geometry, properties:{ id:`${kind}${++cadSeq}`, kind } })
  cadPoints.value = []
  cadSetSrc('cad-preview', cadEmptyFC())
  renderCad()
}

function finalizeCadLine() {
  const pts = cadPoints.value.slice(0, 2)
  const len = turf.length(turf.lineString(pts), { units:'meters' })
  pushCad({ type:'LineString', coordinates: pts }, 'line')
  showToast(`Line — ${fmtLen(len)}`)
}
function finalizePolyline() {
  const pts = [...cadPoints.value]
  if (pts.length < 2) { cadPoints.value = []; cadSetSrc('cad-preview', cadEmptyFC()); return }
  const len = turf.length(turf.lineString(pts), { units:'meters' })
  pushCad({ type:'LineString', coordinates: pts }, 'polyline')
  showToast(`Polyline — ${fmtLen(len)} over ${pts.length} points`)
}
function finalizeDimension() {
  const [a, b] = cadPoints.value
  const len = turf.length(turf.lineString([a, b]), { units:'meters' })
  const mid: [number,number] = [(a[0]+b[0])/2, (a[1]+b[1])/2]
  pushCad({ type:'LineString', coordinates:[a, b] }, 'dimension')
  cadLabels.value.push({ id:`DIM${++cadSeq}`, lngLat: mid, text: fmtLen(len) })
  renderCadLabels()
  showToast(`Dimension — ${fmtLen(len)}`)
}
function finalizeCircle() {
  const [c, edge] = cadPoints.value
  const r = turf.distance(c, edge, { units:'kilometers' })
  if (r <= 0) { cadPoints.value = []; cadSetSrc('cad-preview', cadEmptyFC()); return }
  pushCad((turf.circle(c, r, { steps:64 }).geometry as any), 'circle')
  showToast(`Circle — radius ${fmtLen(r * 1000)}`)
}
function finalizeArc() {
  const [a, b, c] = cadPoints.value
  const coords = arc3(a, b, c)
  if (!coords) { showToast('Those points are collinear — pick a curved arc', 'error'); cadPoints.value = []; cadSetSrc('cad-preview', cadEmptyFC()); return }
  pushCad({ type:'LineString', coordinates: coords }, 'arc')
  showToast('Arc drawn')
}

// Circular arc through three points (computed in Web-Mercator metres).
function arc3(a: [number,number], b: [number,number], c: [number,number]): [number,number][] | null {
  const A = turf.toMercator(a) as [number,number]
  const B = turf.toMercator(b) as [number,number]
  const C = turf.toMercator(c) as [number,number]
  const [ax, ay] = A, [bx, by] = B, [cx, cy] = C
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-6) return null
  const ux = ((ax*ax + ay*ay) * (by - cy) + (bx*bx + by*by) * (cy - ay) + (cx*cx + cy*cy) * (ay - by)) / d
  const uy = ((ax*ax + ay*ay) * (cx - bx) + (bx*bx + by*by) * (ax - cx) + (cx*cx + cy*cy) * (bx - ax)) / d
  const r = Math.hypot(ax - ux, ay - uy)
  const t0 = Math.atan2(ay - uy, ax - ux)
  const TWO_PI = Math.PI * 2
  const norm = (t: number) => { let x = t; while (x < t0) x += TWO_PI; while (x >= t0 + TWO_PI) x -= TWO_PI; return x }
  const nb = norm(Math.atan2(by - uy, bx - ux))
  const n1 = norm(Math.atan2(cy - uy, cx - ux))
  const end = nb <= n1 ? n1 : n1 - TWO_PI       // sweep direction that passes through b
  const N = 64
  const out: [number,number][] = []
  for (let i = 0; i <= N; i++) {
    const t = t0 + (end - t0) * (i / N)
    out.push(turf.toWgs84([ux + r * Math.cos(t), uy + r * Math.sin(t)]) as [number,number])
  }
  return out
}

// ── Targets for the modify / transform operations ──────────────────────────
function activeCadIndex(): number { return cadFeatures.value.length - 1 }
function activeCad(): GeoJSON.Feature | null { const i = activeCadIndex(); return i >= 0 ? cadFeatures.value[i] : null }
function replaceActiveCad(f: GeoJSON.Feature) {
  const i = activeCadIndex()
  if (i < 0) return
  f.properties = { ...(cadFeatures.value[i].properties || {}), ...(f.properties || {}) }
  cadFeatures.value.splice(i, 1, f)
  renderCad()
}
function polygonAt(pt: [number,number]): GeoJSON.Feature | null {
  const p = turf.point(pt)
  for (let i = cadFeatures.value.length - 1; i >= 0; i--) {
    const f = cadFeatures.value[i]
    if ((f.geometry as any).type === 'Polygon' && turf.booleanPointInPolygon(p, f as any)) return f
  }
  for (let i = drawnPolygons.value.length - 1; i >= 0; i--) {
    const d = drawnPolygons.value[i]
    const poly = turf.polygon([[...d.coords, d.coords[0]]])
    if (turf.booleanPointInPolygon(p, poly)) return poly
  }
  return null
}
function lastPolygon(): { feature: GeoJSON.Feature; remove: () => void } | null {
  for (let i = cadFeatures.value.length - 1; i >= 0; i--) {
    if ((cadFeatures.value[i].geometry as any).type === 'Polygon') {
      const idx = i
      return { feature: cadFeatures.value[i], remove: () => cadFeatures.value.splice(idx, 1) }
    }
  }
  if (drawnPolygons.value.length) {
    const d = drawnPolygons.value[drawnPolygons.value.length - 1]
    return {
      feature: turf.polygon([[...d.coords, d.coords[0]]]),
      remove: () => {
        drawnPolygons.value = drawnPolygons.value.filter(x => x !== d)
        cadSetSrc('draw-completed', {
          type: 'FeatureCollection',
          features: drawnPolygons.value.map(p => ({
            type: 'Feature', properties: { id: p.id },
            geometry: { type: 'Polygon', coordinates: [[...p.coords, p.coords[0]]] },
          })),
        })
      },
    }
  }
  return null
}
function lastCadLine(): GeoJSON.Feature | null {
  for (let i = cadFeatures.value.length - 1; i >= 0; i--) {
    if ((cadFeatures.value[i].geometry as any).type === 'LineString') return cadFeatures.value[i]
  }
  return null
}
function explodePolys(f: any): GeoJSON.Feature[] {
  const g = f.geometry || f
  if (g.type === 'Polygon') return [{ type:'Feature', geometry: g, properties:{} }]
  if (g.type === 'MultiPolygon') return g.coordinates.map((co: any) => ({ type:'Feature', geometry:{ type:'Polygon', coordinates: co }, properties:{} }))
  return []
}

// ── Modify & Transform ──────────────────────────────────────────────────────
function cadOffset() {
  const f = activeCad()
  if (!f) { showToast('Draw a line or shape first, then Offset', 'error'); return }
  const dist = offsetDistance.value
  if (!dist || dist <= 0) { showToast('Set an offset distance in metres', 'error'); return }
  try {
    let res: any = null
    const g: any = f.geometry
    if (g.type === 'LineString') res = turf.lineOffset(f as any, dist, { units:'meters' })
    else if (g.type === 'Polygon') res = turf.buffer(f as any, dist, { units:'meters' })
    if (!res) { showToast('Offset produced no geometry', 'error'); return }
    res.properties = { id:`offset${++cadSeq}`, kind:'offset' }
    cadFeatures.value.push(res); renderCad()
    showToast(`Offset ${dist} m`)
  } catch { showToast('Offset failed', 'error') }
}
function cadTrim() {
  const lines = cadFeatures.value.filter(f => (f.geometry as any).type === 'LineString')
  if (lines.length < 2) { showToast('Draw the line to trim, then a crossing line as the cutting edge', 'error'); return }
  const cutter = lines[lines.length - 1]
  const target = lines[lines.length - 2]
  try {
    const hits = turf.lineIntersect(target as any, cutter as any)
    if (!hits.features.length) { showToast('Lines do not cross — nothing to trim', 'error'); return }
    const start = (target.geometry as any).coordinates[0]
    let best = hits.features[0]
    let bestD = turf.distance(start, best.geometry.coordinates)
    for (const h of hits.features) {
      const dd = turf.distance(start, h.geometry.coordinates)
      if (dd < bestD) { bestD = dd; best = h }
    }
    const sliced: any = turf.lineSlice(turf.point(start), best, target as any)
    sliced.properties = { id:`trim${++cadSeq}`, kind:'line' }
    const idx = cadFeatures.value.indexOf(target)
    cadFeatures.value.splice(idx, 1, sliced); renderCad()
    showToast('Trimmed to cutting edge')
  } catch { showToast('Trim failed', 'error') }
}
function cadRotate() {
  const f = activeCad()
  if (!f) { showToast('Draw a shape first, then Rotate', 'error'); return }
  const ang = parseFloat(window.prompt('Rotate the last shape by degrees (+ clockwise):', '90') || '')
  if (isNaN(ang)) return
  try { replaceActiveCad(turf.transformRotate(f as any, ang)); showToast(`Rotated ${ang}°`) }
  catch { showToast('Rotate failed', 'error') }
}
function cadScale() {
  const f = activeCad()
  if (!f) { showToast('Draw a shape first, then Scale', 'error'); return }
  const fac = parseFloat(window.prompt('Scale factor (e.g. 1.5 = +50%, 0.5 = half):', '1.5') || '')
  if (isNaN(fac) || fac <= 0) return
  try { replaceActiveCad(turf.transformScale(f as any, fac)); showToast(`Scaled ×${fac}`) }
  catch { showToast('Scale failed', 'error') }
}
function cadMirror() {
  const f = activeCad()
  if (!f) { showToast('Draw a shape first, then Mirror', 'error'); return }
  try {
    const c = turf.centroid(f as any).geometry.coordinates as [number,number]
    const flip = (co: [number,number]): [number,number] => [2 * c[0] - co[0], co[1]]
    const f2: any = JSON.parse(JSON.stringify(f))
    const g = f2.geometry
    if (g.type === 'LineString') g.coordinates = g.coordinates.map(flip)
    else if (g.type === 'Polygon') g.coordinates = g.coordinates.map((r: any) => r.map(flip))
    else if (g.type === 'Point') g.coordinates = flip(g.coordinates)
    replaceActiveCad(f2); showToast('Mirrored about centroid')
  } catch { showToast('Mirror failed', 'error') }
}

// ── Spatial Operations ──────────────────────────────────────────────────────
function cadBuffer() {
  const f = activeCad()
  if (f) {
    try {
      const b: any = turf.buffer(f as any, bufferDistance.value, { units:'meters' })
      if (!b) { showToast('Buffer produced no geometry', 'error'); return }
      b.properties = { id:`buffer${++cadSeq}`, kind:'buffer' }
      cadFeatures.value.push(b); renderCad()
      showToast(`${bufferDistance.value} m buffer`)
    } catch { showToast('Buffer failed', 'error') }
    return
  }
  applyBuffer()      // fall back to the legacy buffer (last drawn polygon / map centre)
}
function cadSplitParcel() {
  const lp = lastPolygon()
  const line = lastCadLine()
  if (!lp || !line) { showToast('Draw a polygon and a line that crosses it, then Split', 'error'); return }
  try {
    const ribbon = turf.buffer(line as any, 0.5, { units:'meters' })   // thin cutting ribbon
    const diff = turf.difference(lp.feature as any, ribbon as any)
    if (!diff) { showToast('The line must cross the polygon to split it', 'error'); return }
    const pieces = explodePolys(diff)
    if (pieces.length < 2) { showToast('The line must fully cross the polygon', 'error'); return }
    lp.remove()
    for (const pc of pieces) { pc.properties = { id:`split${++cadSeq}`, kind:'polygon' }; cadFeatures.value.push(pc) }
    renderCad()
    showToast(`Parcel split into ${pieces.length} parts`)
  } catch { showToast('Split failed', 'error') }
}
function cadTransformTRS() {
  const f = activeCad()
  if (!f) { showToast('Draw a shape first, then Transform', 'error'); return }
  const east = parseFloat(window.prompt('Move east by metres (− = west):', '0') || '0')
  const north = parseFloat(window.prompt('Move north by metres (− = south):', '0') || '0')
  if (isNaN(east) || isNaN(north) || (east === 0 && north === 0)) return
  try {
    const dist = Math.hypot(east, north) / 1000
    const bearing = Math.atan2(east, north) * 180 / Math.PI
    replaceActiveCad(turf.transformTranslate(f as any, dist, bearing, { units:'kilometers' }))
    showToast(`Moved ${east} m E, ${north} m N`)
  } catch { showToast('Transform failed', 'error') }
}

// ── Clear everything the planner has drawn ──────────────────────────────────
function clearAllCad() {
  cadFeatures.value = []
  cadLabels.value = []
  cadPoints.value = []
  cadMarkers.forEach(m => m.remove()); cadMarkers = []
  cadSetSrc('cad-src', cadEmptyFC())
  cadSetSrc('cad-preview', cadEmptyFC())
  clearAllDrawings()        // also clears legacy draw / measure / buffer (and toasts)
}

// Export the subdivision (split parcels + every drawn shape and annotation) as
// a georeferenced AutoCAD DXF — what a planner hands to a surveyor after, e.g.,
// splitting a farm. Coordinates are projected to UTM (WGS84) metres so the
// drawing opens true-to-scale in AutoCAD / Civil 3D / QGIS, with each parcel
// auto-labelled by area.
function exportSubdivisionDXF() {
  const polys: GeoJSON.Feature[] = drawnPolygons.value.map(d => ({
    type: 'Feature',
    properties: { id: d.id, kind: 'polygon', area_sqm: Math.round(d.areaSqm) },
    geometry: { type: 'Polygon', coordinates: [[...d.coords, d.coords[0]]] },
  }))
  const features = [...cadFeatures.value, ...polys]
  const labels = cadLabels.value.map(l => ({ lngLat: l.lngLat, text: l.text }))
  if (!features.length && !labels.length) {
    showToast('Nothing to export — draw or split a parcel first', 'error')
    return
  }
  try {
    const res = exportFeaturesToDxf(features, labels, {
      fileName: 'vungu-subdivision',
      title: 'Vungu RDC — Subdivision',
    })
    showToast(`DXF exported — ${res.count} entities · UTM zone ${res.zone}${res.epsg.startsWith('EPSG:327') ? 'S' : 'N'}`)
  } catch {
    showToast('DXF export failed', 'error')
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  Land-subdivision planning — map interactions (Phase 1)
//  The PlanningPanel owns the controls + rules; these handlers own the map.
//  Draw-road reuses the CAD preview source for the rubber band, then commits
//  the line to the planning engine (planning.addRoad).
// ════════════════════════════════════════════════════════════════════════════
function handlePlanningRoadClick(lngLat: [number, number]) {
  planRoadPts.value.push(lngLat)
  updatePlanningRoadPreview()
}
function updatePlanningRoadPreview(mouse?: [number, number]) {
  const pts = mouse ? [...planRoadPts.value, mouse] : [...planRoadPts.value]
  const feats: GeoJSON.Feature[] = planRoadPts.value.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} }))
  if (pts.length >= 2) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} })
  cadSetSrc('cad-preview', { type: 'FeatureCollection', features: feats })
}
function finalizePlanningRoad() {
  if (planRoadPts.value.length < 2) { planRoadPts.value = []; cadSetSrc('cad-preview', cadEmptyFC()); return }
  const line = { type: 'LineString' as const, coordinates: [...planRoadPts.value] }
  // P0 fix: a street must touch the planning area to be useful, and it must
  // span the parcel (reach the boundary on both ends) to form blocks.
  const area = planning.planningArea.value
  if (area) {
    try {
      const areaFeat = turf.feature(area.geom as any)
      if (!turf.booleanIntersects(areaFeat as any, turf.feature(line) as any)) {
        showToast('Road is outside the planning area — not added', 'error')
        planRoadPts.value = []; cadSetSrc('cad-preview', cadEmptyFC()); return
      }
      // both endpoints inside ⇒ it won't reach the boundary ⇒ won't split blocks
      const a0 = turf.point(line.coordinates[0])
      const aN = turf.point(line.coordinates[line.coordinates.length - 1])
      const insideBoth = turf.booleanPointInPolygon(a0, areaFeat as any) && turf.booleanPointInPolygon(aN, areaFeat as any)
      if (insideBoth) showToast('Street added — extend it to the parcel edge so it splits the block', 'success')
      else showToast('Street added — draw more, then Generate Blocks', 'success')
    } catch { showToast('Street added', 'success') }
  } else {
    showToast('Street added', 'success')
  }
  planning.addRoad(line, { hierarchy: 'local', widthM: 12 })
  planRoadPts.value = []
  cadSetSrc('cad-preview', cadEmptyFC())
}
function fitToPlanningArea() {
  const a = planning.planningArea.value
  if (!a || !mapInstance.value) return
  try {
    const bb = turf.bbox(turf.feature(a.geom as any))
    mapInstance.value.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]] as any, { padding: 60, duration: 600 })
  } catch { /* ignore */ }
}
// P0 fix: use a polygon the planner DREW (farm boundary) as the planning area.
// Uses the full owned geometry (drawnPolygons / cadFeatures), not a clipped render.
function selectPlanningAreaFromDrawn(hit: any) {
  const id = hit?.properties?.id
  let geom: any = null
  const dp = drawnPolygons.value.find(d => d.id === id)
  if (dp) geom = { type: 'Polygon', coordinates: [[...dp.coords, dp.coords[0]]] }
  else {
    const cf = cadFeatures.value.find(f => (f.properties as any)?.id === id)
    if (cf && (cf.geometry as any).type === 'Polygon') geom = cf.geometry
  }
  if (!geom) geom = hit.geometry
  if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) {
    showToast('Click a drawn polygon (or a cadastral parcel)', 'error'); return
  }
  planning.selectParcel({ type: 'Feature', properties: { name: 'Drawn area' }, geometry: geom } as any, 'Drawn area')
  planning.tool.value = 'idle'
  rightTab.value = 'planning'
  fitToPlanningArea()
  showToast('Planning area set from your drawing', 'success')
}
// Phase-1 constraint: buffer rivers 30 m and clip to the parcel. Source =
// rendered hydro features, falling back to the planner's own drawn lines so a
// river can be traced with the Line tool when no hydro layer is present.
function addRiverBuffer() {
  const map = mapInstance.value
  const area = planning.planningArea.value
  if (!map || !area) { showToast('Select a planning parcel first', 'error'); return }
  const areaFeat = turf.feature(area.geom as any)
  const hydroLayers = (map.getStyle().layers || [])
    .map((l: any) => l.id)
    .filter((id: string) => /water|river|hydro|stream|dam|wetland|lake/i.test(id))
  let hits: any[] = []
  try { hits = hydroLayers.length ? map.queryRenderedFeatures({ layers: hydroLayers }) : [] } catch { hits = [] }
  const rivers: GeoJSON.Feature[] = []
  for (const h of hits) {
    try {
      if (h.geometry && turf.booleanIntersects(areaFeat as any, h as any)) {
        rivers.push({ type: 'Feature', geometry: h.geometry, properties: {} })
      }
    } catch { /* skip */ }
  }
  // Fallback: drawn CAD lines (planner traced the river with the Line tool).
  if (!rivers.length) {
    for (const f of cadFeatures.value) {
      if ((f.geometry as any).type === 'LineString') rivers.push({ type: 'Feature', geometry: f.geometry, properties: {} })
    }
  }
  if (!rivers.length) { showToast('No river/water found — trace the river with the Line tool first', 'error'); return }
  const c = planning.addBufferConstraint(rivers, 30, 'river_buffer', 'River buffer 30 m')
  if (c) {
    // Clip the exclusion to the parcel so blocks/metrics stay correct.
    try {
      const clipped = turf.intersect(areaFeat as any, turf.feature(c.geom) as any)
      if (clipped) { c.geom = clipped.geometry as any; planning.constraints.value = [...planning.constraints.value] }
    } catch { /* keep unclipped */ }
  }
  showToast(c ? 'River buffer added (30 m) — re-run blocks to apply' : 'Could not build buffer', c ? 'success' : 'error')
}
// Click popups on the planning layers (only when no planning tool is active).
function wirePlanningPopups(map: any) {
  const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '240px' })
  const show = (e: any, html: string) => popup.setLngLat(e.lngLat).setHTML(html).addTo(map)
  map.on('click', 'pl-lot-fill', (e: any) => {
    if (planning.tool.value !== 'idle') return
    const p = e.features?.[0]?.properties || {}
    // useLabel/lotNumber/hierarchy reach this popup as MapLibre feature
    // properties, which on QGIS-extracted or imported layers are database
    // strings — escape before they enter setHTML.
    const useLabel = (planning.standards.uses as any)?.[p.useType]?.label || p.useType || '—'
    show(e, `<div class="pl-pop"><strong>Lot ${escapeHtml(p.lotNumber ?? '')}</strong><br>${fmtArea(Number(p.areaSqm) || 0)}${p.isCorner ? ' · corner lot (corner setbacks)' : ''}<br>${escapeHtml(useLabel)} · ${escapeHtml(p.unitsPerLot ?? 1)} unit(s)</div>`)
  })
  map.on('click', 'pl-block-fill', (e: any) => {
    if (planning.tool.value !== 'idle') return
    const p = e.features?.[0]?.properties || {}
    show(e, `<div class="pl-pop"><strong>Block</strong><br>${fmtArea(Number(p.areaSqm) || 0)}</div>`)
  })
  map.on('click', 'pl-road-line', (e: any) => {
    if (planning.tool.value !== 'idle') return
    const p = e.features?.[0]?.properties || {}
    show(e, `<div class="pl-pop"><strong>${escapeHtml(p.hierarchy || 'street')}</strong><br>${Number(p.widthM) || 12} m reserve</div>`)
  })
  for (const id of ['pl-lot-fill', 'pl-block-fill', 'pl-road-line']) {
    map.on('mouseenter', id, () => { if (planning.tool.value === 'idle') map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = activeTool.value === 'select' ? 'default' : 'crosshair' })
  }
}

// ── Manual lot editing — map side (engine does the geometry) ────────────────
function lotIdAt(e: any): string | null {
  const hit = mapInstance.value?.queryRenderedFeatures(e.point, { layers: ['pl-lot-fill'] })?.[0]
  if (!hit) return null
  return hit.id != null ? String(hit.id) : (hit.properties?.id != null ? String(hit.properties.id) : null)
}
function handleSplitLotClick(e: any, lngLat: [number, number]) {
  const map = mapInstance.value!
  if (!splitTargetLotId.value) {
    const id = lotIdAt(e)
    if (!id) { showToast('Click a lot to split', 'error'); return }
    splitTargetLotId.value = id
    splitCutPts.value = []
    try { map.setFeatureState({ source: 'pl-lots', id }, { selected: true }) } catch { /* ignore */ }
    showToast('Now click 2 points across the lot · double-click to cut', 'info')
    return
  }
  splitCutPts.value.push(lngLat)
  updateSplitPreview()
}
function updateSplitPreview(mouse?: [number, number]) {
  const pts = mouse ? [...splitCutPts.value, mouse] : [...splitCutPts.value]
  const feats: GeoJSON.Feature[] = splitCutPts.value.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} }))
  if (pts.length >= 2) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} })
  cadSetSrc('cad-preview', { type: 'FeatureCollection', features: feats })
}
function finalizeSplitLot() {
  const id = splitTargetLotId.value
  if (!id || splitCutPts.value.length < 2) return
  const ok = planning.splitLot(id, { type: 'LineString', coordinates: [...splitCutPts.value] })
  showToast(ok ? 'Lot split' : 'Cut line must cross the lot', ok ? 'success' : 'error')
  try { mapInstance.value?.setFeatureState({ source: 'pl-lots', id }, { selected: false }) } catch { /* ignore */ }
  splitTargetLotId.value = null
  splitCutPts.value = []
  cadSetSrc('cad-preview', cadEmptyFC())
}
function handleMergeLotClick(e: any) {
  const id = lotIdAt(e)
  if (!id) { showToast('Click a lot to add/remove it from the merge set', 'error'); return }
  const wasSelected = planning.mergeSelection.value.includes(id)
  planning.toggleMergeSelection(id)
  try { mapInstance.value?.setFeatureState({ source: 'pl-lots', id }, { selected: !wasSelected }) } catch { /* ignore */ }
}
function clearMergeHighlight() {
  const m = mapInstance.value
  if (m) for (const id of planning.mergeSelection.value) {
    try { m.setFeatureState({ source: 'pl-lots', id }, { selected: false }) } catch { /* ignore */ }
  }
  planning.clearMergeSelection()
}

// Capture the fitted map (basemap + planning overlay) and hand it to the PDF
// builder along with the metrics + lot schedule.
async function exportSubdivisionPlanPDF() {
  const map = mapInstance.value
  if (!map) return
  if (!planning.lots.value.length) { showToast('Run subdivision first', 'error'); return }
  showToast('Preparing subdivision plan…', 'info')
  fitToPlanningArea()
  // Let the camera settle + the overlay render before capturing the canvas.
  await new Promise<void>((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    try { map.once('idle', finish) } catch { /* ignore */ }
    setTimeout(finish, 1400)
  })
  const canvas = map.getCanvas()
  let imageDataUrl: string | null = null
  try { imageDataUrl = canvas.toDataURL('image/png') } catch { imageDataUrl = null }
  const lat = map.getCenter().lat
  const zoom = map.getZoom()
  const metresPerPixel = (40075016.686 * Math.abs(Math.cos((lat * Math.PI) / 180))) / Math.pow(2, zoom + 8)
  try {
    exportSubdivisionPlanPdf({
      title: planning.projectName.value || 'Subdivision',
      imageDataUrl,
      imgWidthPx: canvas.width,
      imgHeightPx: canvas.height,
      metresPerPixel,
      metrics: planning.metrics.value,
      lots: planning.lots.value,
      areaSqm: planning.planningArea.value?.areaSqm || 0,
    })
    showToast('Subdivision plan PDF exported', 'success')
  } catch { showToast('PDF export failed', 'error') }
}

// Zoom to + briefly highlight a lot/block flagged in the Validation panel.
function focusPlanningFeature(payload: { kind: 'lot' | 'block' | 'road'; id: string; variant?: 'env' }) {
  const map = mapInstance.value
  if (!map) return
  const { kind, id, variant } = payload
  const geom = kind === 'lot'
    ? planning.lots.value.find(l => l.id === id)?.geom
    : kind === 'block'
      ? planning.blocks.value.find(b => b.id === id)?.geom
      : planning.roads.value.find(r => r.id === id)?.geom
  if (!geom) return
  try {
    const bb = turf.bbox(turf.feature(geom as any))
    map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]] as any, { padding: 90, duration: 600, maxZoom: 19 })
  } catch { /* ignore */ }
  const src = kind === 'lot' ? 'pl-lots' : kind === 'block' ? 'pl-blocks' : 'pl-roads'
  // envelope failures highlight purple (envFail); other issues amber (selected)
  const onState = variant === 'env' ? { envFail: true } : { selected: true }
  const offState = variant === 'env' ? { envFail: false } : { selected: false }
  try {
    map.setFeatureState({ source: src, id }, onState)
    setTimeout(() => { try { map.setFeatureState({ source: src, id }, offState) } catch { /* ignore */ } }, 2600)
  } catch { /* ignore */ }
}

// ── Draw Tools ───────────────────────────────────────────────────────────
const drawTools = [
  { id:'select',    icon:MousePointer2, label:'Select',    hint:'Click a feature to identify it'            },
  { id:'polygon',   icon:PenLine,       label:'Draw',      hint:'Click to place vertices — double-click to close' },
  { id:'measure',   icon:Ruler,         label:'Measure',   hint:'Click start/end points to measure distance & area' },
  { id:'buffer',    icon:Crosshair,     label:'Buffer',    hint:'Click a feature to apply buffer zone'      },
  // AutoCAD-style precision tools
  { id:'line',      icon:Slash,   label:'Line',       hint:'Click two points to draw a line'                 },
  { id:'polyline',  icon:PenLine, label:'Polyline',   hint:'Click vertices — double-click to finish'         },
  { id:'arc',       icon:Spline,  label:'Arc',        hint:'Click the start, a point on the arc, then the end' },
  { id:'circle',    icon:Circle,  label:'Circle',     hint:'Click the centre, then a point on the edge'      },
  { id:'dimension', icon:Ruler,   label:'Dimension',  hint:'Click two points to dimension the distance'      },
  { id:'arealabel', icon:Tag,     label:'Area label', hint:'Click inside a drawn polygon to label its area'  },
  { id:'textnote',  icon:Type,    label:'Text note',  hint:'Click on the map to place a text annotation'     },
]
const activeTool    = ref('select')
const measureResult = ref('')

// The active tool drives the on-map instruction banner: a workstation always
// tells the operator what mode it is in and how to leave it.
const activeToolMeta = computed(() => drawTools.find(t => t.id === activeTool.value) ?? null)

// Status-bar editing state. "Unsaved" counts scratch geometry that exists only
// in the browser — a planner must be able to see at a glance that closing the
// tab would lose a drawn subdivision.
const unsavedGeometryCount = computed(() =>
  drawnPolygons.value.length + cadFeatures.value.length + cadLabels.value.length)
const editingState = computed(() => {
  if (planning.tool.value !== 'idle') return { label: `Planning · ${planning.tool.value.replace(/-/g, ' ')}`, tone: 'active' }
  if (activeTool.value !== 'select')  return { label: `${activeTool.value} active`, tone: 'active' }
  if (unsavedGeometryCount.value)     return { label: `${unsavedGeometryCount.value} unsaved`, tone: 'warn' }
  return { label: 'Idle', tone: 'idle' }
})

function setTool(id: string) {
  activeTool.value = id
  drawPoints.value = []
  measurePoints.value = []
  measureResult.value = ''
  measureLiveCoord.value = null
  cadPoints.value = []

  if (id !== 'buffer') {
    bufferActive.value = false
    clearBufferLayer()
  }

  const map = mapInstance.value
  if (!map || !toolsReady.value) return

  // Update cursor
  map.getCanvas().style.cursor = id === 'select' ? 'default' : 'crosshair'

  // Clear in-progress previews
  ;(map.getSource('draw-preview') as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features:[] })
  ;(map.getSource('measure-src') as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features:[] })
  ;(map.getSource('cad-preview') as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features:[] })
}

// ── Buffer ────────────────────────────────────────────────────────────────
const bufferDistance = ref(30)
const bufferActive   = ref(false)

function clearBufferLayer() {
  bufferActive.value = false
  const map = mapInstance.value
  if (!map || !toolsReady.value) return
  ;(map.getSource('buffer-src') as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features:[] })
}

function applyBuffer() {
  const map = mapInstance.value
  if (!map || !toolsReady.value) return

  let geometry: any = null

  // Use last clicked point, or center of map as fallback
  const center = map.getCenter()
  geometry = turf.point([center.lng, center.lat])

  // If a drawn polygon exists, buffer that
  if (drawnPolygons.value.length > 0) {
    const last = drawnPolygons.value[drawnPolygons.value.length - 1]
    geometry = turf.polygon([[...last.coords, last.coords[0]]])
  }

  try {
    const buffered = turf.buffer(geometry, bufferDistance.value, { units: 'meters' })
    if (!buffered) return
    ;(map.getSource('buffer-src') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: [buffered]
    })
    bufferActive.value = true
    showToast(`${bufferDistance.value}m buffer applied`)
  } catch (e) {
    showToast('Buffer failed', 'error')
  }
}

function clearBuffer() { clearBufferLayer() }

function applyBufferAtFeature(map: any, lngLat: [number, number]) {
  try {
    const pt = turf.point(lngLat)
    const buffered = turf.buffer(pt, bufferDistance.value, { units: 'meters' })
    if (!buffered) return
    ;(map.getSource('buffer-src') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: [buffered]
    })
    bufferActive.value = true
    showToast(`${bufferDistance.value}m buffer applied at click point`)
  } catch (e) {
    console.warn('Buffer error:', e)
  }
}

// ── Map tool infrastructure ───────────────────────────────────────────────
function initMapTools(map: any) {
  const empty = (): GeoJSON.FeatureCollection => ({ type:'FeatureCollection', features:[] })

  // Sources
  map.addSource('draw-preview',        { type:'geojson', data: empty() })
  map.addSource('draw-completed',      { type:'geojson', data: empty() })
  map.addSource('measure-src',         { type:'geojson', data: empty() })
  map.addSource('buffer-src',          { type:'geojson', data: empty() })
  map.addSource('analysis-results-src',{ type:'geojson', data: empty() })

  // Completed drawn polygons
  map.addLayer({ id:'draw-completed-fill',    type:'fill',   source:'draw-completed', paint:{ 'fill-color':'#3b82f6', 'fill-opacity':0.12 } })
  map.addLayer({ id:'draw-completed-outline', type:'line',   source:'draw-completed', paint:{ 'line-color':'#2563eb', 'line-width':2, 'line-dasharray':[4,2] } })

  // In-progress preview
  map.addLayer({ id:'draw-preview-line',  type:'line',   source:'draw-preview', filter:['==','$type','LineString'], paint:{ 'line-color':'#f59e0b', 'line-width':2, 'line-dasharray':[5,3] } })
  map.addLayer({ id:'draw-preview-verts', type:'circle', source:'draw-preview', filter:['==','$type','Point'],      paint:{ 'circle-radius':5, 'circle-color':'#fff', 'circle-stroke-width':2.5, 'circle-stroke-color':'#f59e0b' } })

  // Measure line + points
  map.addLayer({ id:'measure-line', type:'line',   source:'measure-src', filter:['==','$type','LineString'], paint:{ 'line-color':'#8b5cf6', 'line-width':2.5, 'line-dasharray':[6,3] } })
  map.addLayer({ id:'measure-pts',  type:'circle', source:'measure-src', filter:['==','$type','Point'],      paint:{ 'circle-radius':5, 'circle-color':'#8b5cf6', 'circle-stroke-width':2, 'circle-stroke-color':'#fff' } })

  // Buffer ring
  map.addLayer({ id:'buffer-fill',    type:'fill', source:'buffer-src', paint:{ 'fill-color':'#f59e0b', 'fill-opacity':0.12 } })
  map.addLayer({ id:'buffer-outline', type:'line', source:'buffer-src', paint:{ 'line-color':'#f59e0b', 'line-width':2.5, 'line-dasharray':[4,2] } })

  // Analysis results overlay
  map.addLayer({ id:'analysis-results-fill',    type:'fill', source:'analysis-results-src', paint:{ 'fill-color':'#7c3aed', 'fill-opacity':0.18 } })
  map.addLayer({ id:'analysis-results-outline', type:'line', source:'analysis-results-src', paint:{ 'line-color':'#7c3aed', 'line-width':2, 'line-dasharray':[3,2] } })

  // AutoCAD toolkit: committed geometry (lines / polylines / arcs / circles /
  // dimensions / split parcels) + a live rubber-band preview source.
  map.addSource('cad-src',     { type:'geojson', data: empty() })
  map.addSource('cad-preview', { type:'geojson', data: empty() })
  map.addLayer({ id:'cad-fill',     type:'fill',   source:'cad-src', filter:['==','$type','Polygon'], paint:{ 'fill-color':'#0ea5e9', 'fill-opacity':0.10 } })
  map.addLayer({ id:'cad-line',     type:'line',   source:'cad-src', paint:{ 'line-color':'#0369a1', 'line-width':2 } })
  map.addLayer({ id:'cad-verts',    type:'circle', source:'cad-src', filter:['==','$type','Point'], paint:{ 'circle-radius':3.5, 'circle-color':'#0369a1' } })
  map.addLayer({ id:'cad-prev-line', type:'line',   source:'cad-preview', filter:['==','$type','LineString'], paint:{ 'line-color':'#f59e0b', 'line-width':2, 'line-dasharray':[2,2] } })
  map.addLayer({ id:'cad-prev-pt',   type:'circle', source:'cad-preview', filter:['==','$type','Point'], paint:{ 'circle-radius':4, 'circle-color':'#fff', 'circle-stroke-width':2, 'circle-stroke-color':'#f59e0b' } })

  toolsReady.value = true

  // ── Unified click handler ─────────────────────────────────────────────
  map.on('click', (e: any) => {
    const tool = activeTool.value
    const lngLat: [number,number] = [e.lngLat.lng, e.lngLat.lat]

    // Planning mode takes over the map; existing tools resume when it's idle.
    if (planning.tool.value !== 'idle') {
      if (planning.tool.value === 'draw-road') { handlePlanningRoadClick(lngLat); return }
      if (planning.tool.value === 'split-lot') { handleSplitLotClick(e, lngLat); return }
      if (planning.tool.value === 'merge-lots') { handleMergeLotClick(e); return }
      if (planning.tool.value === 'select-parcel') {
        // A polygon the planner drew (farm boundary) can be the planning area —
        // full owned geometry. A cadastral parcel is handled by feature-click.
        const drawnHit = map.queryRenderedFeatures(e.point, { layers: ['draw-completed-fill', 'cad-fill'] })[0]
        if (drawnHit) selectPlanningAreaFromDrawn(drawnHit)
      }
      return
    }

    if (CAD_CLICK_TOOLS.includes(tool)) {
      e.preventDefault?.()
      handleCadClick(lngLat, e.point)
      return
    }

    if (tool === 'select') {
      // Check if we clicked on any drawn polygon
      const drawn = map.queryRenderedFeatures(e.point, { layers: ['draw-completed-fill'] })
      if (!drawn.length) {
        // Clicked empty space - deselect
        const hadFeature = !!selectedFeature.value
        selectedFeature.value = null
        if (hadFeature) showToast('Selection cleared')
      }
      return
    }

    if (tool === 'polygon') {
      e.preventDefault()
      drawPoints.value.push(lngLat)
      updateDrawPreview(map)
      return
    }

    if (tool === 'measure') {
      measurePoints.value.push(lngLat)
      updateMeasureLine(map)
      return
    }

    if (tool === 'buffer') {
      applyBufferAtFeature(map, lngLat)
      return
    }
  })

  // ── Double-click: close polygon ───────────────────────────────────────
  map.on('dblclick', (e: any) => {
    if (activeTool.value === 'polygon' && drawPoints.value.length >= 3) {
      e.preventDefault()
      finalizePolygon(map)
    }
    if (activeTool.value === 'polyline' && cadPoints.value.length >= 2) {
      e.preventDefault()
      finalizePolyline()
    }
    if (planning.tool.value === 'draw-road' && planRoadPts.value.length >= 2) {
      e.preventDefault()
      finalizePlanningRoad()
    }
    if (planning.tool.value === 'split-lot' && splitCutPts.value.length >= 2) {
      e.preventDefault()
      finalizeSplitLot()
    }
  })

  // ── Mouse move: live previews ─────────────────────────────────────────
  map.on('mousemove', (e: any) => {
    const { lng, lat } = e.lngLat
    cursorCoords.value = `${Math.abs(lng).toFixed(4)}° ${lng>=0?'E':'W'}, ${Math.abs(lat).toFixed(4)}° ${lat>=0?'N':'S'}`
    measureLiveCoord.value = [lng, lat]

    if (activeTool.value === 'polygon' && drawPoints.value.length > 0) {
      updateDrawPreviewWithMouse(map, [lng, lat])
    }
    if (activeTool.value === 'measure' && measurePoints.value.length > 0) {
      updateMeasureLive(map, [lng, lat])
    }
    if (CAD_CLICK_TOOLS.includes(activeTool.value) && cadPoints.value.length > 0) {
      updateCadPreviewMouse([lng, lat])
    }
    if (planning.tool.value === 'draw-road' && planRoadPts.value.length > 0) {
      updatePlanningRoadPreview([lng, lat])
    }
    if (planning.tool.value === 'split-lot' && splitTargetLotId.value && splitCutPts.value.length > 0) {
      updateSplitPreview([lng, lat])
    }
  })

  // ── Zoom ──────────────────────────────────────────────────────────────
  map.on('zoom', () => {
    mapZoom.value = Math.round((map.getZoom() ?? 10) * 10) / 10
  })

  // Scale depends on latitude in Web Mercator, so track the view centre too.
  map.on('move', () => { mapCenterLat.value = map.getCenter()?.lat ?? mapCenterLat.value })
}

// Draw preview (just the fixed vertices)
function updateDrawPreview(map: any) {
  const pts = drawPoints.value
  if (!pts.length) return
  const features: GeoJSON.Feature[] = [
    ...pts.map(c => ({ type:'Feature' as const, geometry:{ type:'Point' as const, coordinates:c }, properties:{} }))
  ]
  if (pts.length >= 2) {
    features.push({ type:'Feature', geometry:{ type:'LineString', coordinates:[...pts] }, properties:{} })
  }
  ;(map.getSource('draw-preview') as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features })
}

// Draw preview + live mouse position closing line
function updateDrawPreviewWithMouse(map: any, mouse: [number,number]) {
  const pts = drawPoints.value
  if (!pts.length) return
  const features: GeoJSON.Feature[] = [
    ...pts.map(c => ({ type:'Feature' as const, geometry:{ type:'Point' as const, coordinates:c }, properties:{} })),
    { type:'Feature', geometry:{ type:'LineString', coordinates:[...pts, mouse] }, properties:{} }
  ]
  ;(map.getSource('draw-preview') as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features })
}

// Close and save the polygon
function finalizePolygon(map: any) {
  const pts = drawPoints.value
  if (pts.length < 3) return

  const closedCoords: [number,number][] = [...pts, pts[0]]
  const poly = turf.polygon([closedCoords])
  const areaSqm   = turf.area(poly)
  const areaHa    = areaSqm / 10000
  const line      = turf.lineString(closedCoords)
  const perimeterM = turf.length(line, { units:'meters' })

  const id = 'DRW-' + Date.now().toString().slice(-5)
  drawnPolygons.value.push({ id, coords:[...pts], areaSqm, areaHa, perimeterM })
  drawStats.value = { areaSqm, areaHa, perimeterM }

  // Refresh completed layer with ALL polygons
  const completedFeatures: GeoJSON.Feature[] = drawnPolygons.value.map(d => ({
    type:'Feature' as const,
    geometry:{ type:'Polygon' as const, coordinates:[[...d.coords, d.coords[0]]] },
    properties:{ id: d.id }
  }))
  ;(map.getSource('draw-completed') as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features: completedFeatures })

  // Clear the in-progress preview
  ;(map.getSource('draw-preview') as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features:[] })
  drawPoints.value = []

  // Pre-fill register dialog with drawn polygon geometry + measurements
  registerDialog.geometry   = { type: 'Polygon', coordinates: [[...closedCoords]] }
  registerDialog.areaSqm    = areaSqm
  registerDialog.areaHa     = areaHa
  registerDialog.perimeterM = perimeterM
  registerDialog.ward       = currentWard.value?.name || ''
  registerDialog.zoneId     = ''
  registerDialog.zoneType   = ''
  if (!plannerZones.value.length) loadPlannerZones()

  showToast(`Polygon drawn — ${areaHa.toFixed(2)} ha · click "Save as Stand" to register`)
}

// Update measure line source with all clicked points
function updateMeasureLine(map: any) {
  const pts = measurePoints.value
  const features: GeoJSON.Feature[] = [
    ...pts.map(c => ({ type:'Feature' as const, geometry:{ type:'Point' as const, coordinates:c }, properties:{} }))
  ]
  if (pts.length >= 2) {
    const line = turf.lineString(pts)
    const dist = turf.length(line, { units:'meters' })
    measureResult.value = dist >= 1000
      ? `${(dist/1000).toFixed(3)} km`
      : `${dist.toFixed(1)} m`
    features.push({ type:'Feature', geometry:{ type:'LineString', coordinates:pts }, properties:{} })
  }
  ;(map.getSource('measure-src') as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features })
}

// Live measure with mouse position
function updateMeasureLive(map: any, mouse: [number,number]) {
  const pts = measurePoints.value
  if (!pts.length) return
  const allPts = [...pts, mouse]
  const features: GeoJSON.Feature[] = [
    ...pts.map(c => ({ type:'Feature' as const, geometry:{ type:'Point' as const, coordinates:c }, properties:{} })),
    { type:'Feature', geometry:{ type:'LineString', coordinates:allPts }, properties:{} }
  ]
  ;(map.getSource('measure-src') as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features })
  const line = turf.lineString(allPts)
  const dist = turf.length(line, { units:'meters' })
  measureResult.value = dist >= 1000
    ? `${(dist/1000).toFixed(3)} km`
    : `${dist.toFixed(1)} m`
}

// ── Stand CRUD helpers ────────────────────────────────────────────────────
function onStandSelected(feat: StandFeature) {
  selectedStand.value = feat
  const p = feat.properties
  selectedFeature.value = {
    ...p,
    _layerName: `Stand ${p.standNumber}`,
    _geomType: 'Polygon',
    _clickCoord: p.centroid ? `${p.centroid[0]?.toFixed(4)}° E, ${Math.abs(p.centroid[1] ?? 0).toFixed(4)}° S` : '—',
  }
  rightTab.value = 'info'
}

function openRegisterDialog() {
  if (!registerDialog.geometry) { showToast('Draw a polygon first', 'error'); return }
  if (!plannerZones.value.length) loadPlannerZones()
  registerDialog.open = true
}

// When zone is selected from dropdown, auto-fill zone type
function onRegisterZoneChange() {
  const z = plannerZones.value.find(z => z.id === registerDialog.zoneId)
  if (z) {
    registerDialog.zoneType = z.zoneType || z.zone
    if (!registerDialog.ward && z.ward) registerDialog.ward = z.ward
  }
}
function onEditZoneChange() {
  const z = plannerZones.value.find(z => z.id === editDialog.zoneId)
  if (z) editDialog.zoneType = z.zoneType || z.zone
}

async function saveStand() {
  const d = registerDialog
  if (!d.standNumber.trim()) { showToast('Enter a stand number', 'error'); return }
  if (!d.ward.trim())        { showToast('Enter a ward name', 'error'); return }
  if (!d.geometry)           { showToast('No polygon drawn', 'error'); return }
  d.saving = true
  try {
    await axios.post('/api/stands', {
      standNumber: d.standNumber.trim(),
      ward:        d.ward.trim(),
      zoneId:      d.zoneId || undefined,
      zoneType:    d.zoneType.trim() || undefined,
      useScale:    d.useScale || undefined,
      frontageM:   d.frontageM !== '' ? Number(d.frontageM) : undefined,
      depthM:      d.depthM    !== '' ? Number(d.depthM)    : undefined,
      priceUsd:    d.priceUsd  !== '' ? Number(d.priceUsd)  : undefined,
      description: d.description.trim() || undefined,
      geometry:    d.geometry,
    })
    showToast(`Stand ${d.standNumber} registered`, 'success')
    d.open = false; d.standNumber = ''; d.geometry = null; drawStats.value = null
    clearDrawings()
    standsLayerRef.value?.refresh()
  } catch (err: any) {
    const msg = err.response?.data?.error || 'Save failed'
    showToast(msg, 'error')
  } finally { d.saving = false }
}

function openEditDialog(stand: StandFeature) {
  const p = stand.properties
  if (!plannerZones.value.length) loadPlannerZones()
  Object.assign(editDialog, {
    open: true, id: p.id,
    standNumber: p.standNumber, ward: p.ward,
    zoneId: p.zoneId || '', zoneType: p.zoneType || '',
    useScale: p.useScale || 'mixed_scale',
    frontageM: p.frontageM ?? '', depthM: p.depthM ?? '',
    priceUsd: p.priceUsd ?? '', description: p.description || '',
    status: p.status,
  })
}

async function saveEditStand() {
  const d = editDialog
  d.saving = true
  try {
    await axios.put(`/api/stands/${d.id}`, {
      standNumber: d.standNumber.trim(),
      ward:        d.ward.trim(),
      zoneId:      d.zoneId || undefined,
      zoneType:    d.zoneType.trim() || undefined,
      useScale:    d.useScale || undefined,
      frontageM:   d.frontageM !== '' ? Number(d.frontageM) : undefined,
      depthM:      d.depthM    !== '' ? Number(d.depthM)    : undefined,
      priceUsd:    d.priceUsd  !== '' ? Number(d.priceUsd)  : undefined,
      description: d.description.trim() || undefined,
      status:      d.status,
    })
    showToast('Stand updated', 'success')
    d.open = false
    standsLayerRef.value?.refresh()
  } catch (err: any) {
    showToast(err.response?.data?.error || 'Update failed', 'error')
  } finally { d.saving = false }
}

async function withdrawStand(id: string, standNumber: string) {
  if (!confirm(`Withdraw stand ${standNumber}? It will no longer appear to citizens.`)) return
  try {
    await axios.delete(`/api/stands/${id}`)
    showToast(`Stand ${standNumber} withdrawn`)
    selectedStand.value = null
    standsLayerRef.value?.refresh()
  } catch (err: any) {
    showToast(err.response?.data?.error || 'Withdraw failed', 'error')
  }
}

// Clear all drawn polygons from map
function clearDrawings() {
  drawnPolygons.value = []
  drawPoints.value = []
  drawStats.value = null
  const map = mapInstance.value
  if (!map || !toolsReady.value) return
  ;(map.getSource('draw-completed') as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features:[] })
  ;(map.getSource('draw-preview') as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features:[] })
  showToast('Drawings cleared')
}

// ── Map controls ──────────────────────────────────────────────────────────
function zoomIn()  { mapInstance.value?.zoomIn() }
function zoomOut() { mapInstance.value?.zoomOut() }
function resetView() {
  mapInstance.value?.flyTo({ center: [29.8167, -19.45], zoom: 12, speed: 1.2 })
  showToast('View reset')
}
function fitExtent() {
  if (!mapInstance.value) return
  mapInstance.value.flyTo({ center: [29.8167, -19.45], zoom: 11, speed: 1.0 })
  showToast('Fit to region')
}

// ── Search (Google-Maps style) ─────────────────────────────────────────────
// Live search across wards, parcels, farm cadastre, places, POIs and zones
// via /api/map-search. Debounced; two-line results with per-type icons,
// matched-text highlighting and keyboard navigation; selecting flies the map
// to the centroid and drops a marker pin.
interface MapSearchResult { id: string; type: string; label: string; subtitle?: string; center: [number, number] }
const searchQuery       = ref('')
const searchResults     = ref<MapSearchResult[]>([])
const searchBusy        = ref(false)
const searchActive      = ref(false)
const searchActiveIndex = ref(-1)
let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchMarker: maplibregl.Marker | null = null

const SEARCH_TYPE_LABEL: Record<string, string> = {
  ward: 'Ward', parcel: 'Parcel', farm: 'Farm', place: 'Place', poi: 'Facility', zone: 'Zone',
}
function searchTypeLabel(t: string) { return SEARCH_TYPE_LABEL[t] || 'Result' }
function searchIcon(t: string) {
  switch (t) {
    case 'ward':   return Landmark
    case 'parcel': return Home
    case 'farm':   return Wheat
    case 'poi':    return Building
    case 'zone':   return Layers
    default:       return MapPin
  }
}
// Bold the matched substring, à la Google. Escapes HTML first so labels are
// never injected as markup.
function highlightMatch(label: string): string {
  const q = searchQuery.value.trim()
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
  if (!q) return esc(label)
  const i = label.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return esc(label)
  return esc(label.slice(0, i)) + '<strong>' + esc(label.slice(i, i + q.length)) + '</strong>' + esc(label.slice(i + q.length))
}

function onSearch() {
  const q = searchQuery.value.trim()
  searchActive.value = true
  searchActiveIndex.value = -1
  if (searchTimer) clearTimeout(searchTimer)
  if (q.length < 1) { searchResults.value = []; searchBusy.value = false; return }
  searchBusy.value = true
  searchTimer = setTimeout(async () => {
    const { searchMap } = await import('@/services/vectorTiles')
    const hits = await searchMap(q)
    // Guard against a stale response landing after the box was cleared/changed.
    if (searchQuery.value.trim() !== q) return
    searchResults.value = hits.map((h, i) => ({ id: `${h.type}-${i}`, ...h }))
    searchActiveIndex.value = -1
    searchBusy.value = false
  }, 250)
}

function moveSearch(delta: number) {
  const n = searchResults.value.length
  if (!n) return
  searchActive.value = true
  searchActiveIndex.value = (searchActiveIndex.value + delta + n) % n
}
function enterSearch() {
  const list = searchResults.value
  if (!list.length) return
  const idx = searchActiveIndex.value >= 0 ? searchActiveIndex.value : 0
  selectResult(list[idx])
}

function closeSearch() {
  searchQuery.value = ''
  searchResults.value = []
  searchActive.value = false
  searchBusy.value = false
  searchActiveIndex.value = -1
  if (searchMarker) { searchMarker.remove(); searchMarker = null }
}

const SEARCH_ZOOM: Record<string, number> = { ward: 13, place: 14, parcel: 17, farm: 15, poi: 16, zone: 14 }
function selectResult(r: MapSearchResult) {
  searchQuery.value = r.label
  searchResults.value = []
  searchActive.value = false
  searchActiveIndex.value = -1
  const map = mapInstance.value
  if (!map || !r.center) { showToast(`Selected: ${r.label}`); return }
  map.flyTo({ center: r.center, zoom: SEARCH_ZOOM[r.type] ?? 14, duration: 900, essential: true })
  // Drop a single marker pin at the hit (replacing any previous one), the
  // way Google Maps pins a searched place.
  if (searchMarker) searchMarker.remove()
  // The stale @types/maplibre-gl@1 pin conflicts with maplibre-gl v4's own
  // types, so Marker.addTo sees a different `Map` type than mapInstance
  // (casting to maplibregl.Map triggers TS2589 deep instantiation). Cast via
  // any until @types/maplibre-gl is removed (see Step 6 report). map is
  // non-null here (guarded above).
  searchMarker = new maplibregl.Marker({ color: '#1a73e8' }).setLngLat(r.center).addTo(map as any)
}

// ── Toast ──────────────────────────────────────────────────────────────────
const toast = reactive({ visible:false, message:'', type:'success' })
function showToast(msg: string, type='success') {
  toast.message=msg; toast.type=type; toast.visible=true
  setTimeout(()=>{ toast.visible=false }, 3200)
}

// ── EO feedback notifications ─────────────────────────────────────────────
const plannerNotifs = ref<any[]>([])
const plannerNotifsUnread = computed(() => plannerNotifs.value.filter(n => !n.is_read).length)
async function loadPlannerNotifications() {
  try {
    const res = await plannerApi.getNotifications()
    plannerNotifs.value = res.data?.data ?? []
  } catch { /* offline — notifications unavailable */ }
}
async function markPlannerNotifRead(id: string) {
  try { await plannerApi.markNotificationRead(id) } catch { /* offline */ }
  const n = plannerNotifs.value.find(x => x.id === id)
  if (n) n.is_read = true
}

// ── Workstation keyboard shortcuts ───────────────────────────────────────
// Desktop-GIS muscle memory: Esc always returns to Select and dismisses any
// popover; the single-key tool shortcuts only fire when focus is not in a
// text field, so typing in the search box or a form is never hijacked.
function onWorkspaceKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  const typing = !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)
  if (e.key === 'Escape') {
    closeOverlays()
    if (planning.tool.value !== 'idle') planning.tool.value = 'idle'
    else if (activeTool.value !== 'select') setTool('select')
    else if (searchActive.value) closeSearch()
    return
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return
  const key = e.key.toLowerCase()
  if (key === 'v') setTool('select')
  else if (key === 'm') setTool('measure')
  else if (key === 'd') setTool('polygon')
  else if (key === 'b') setTool('buffer')
  else if (key === 'l') setTool('line')
  else if (key === '/') { e.preventDefault(); document.getElementById('planner-global-search')?.focus() }
}

onMounted(async () => {
  window.addEventListener('keydown', onWorkspaceKey)
  loadPlannerNotifications()
  loadWards()
  loadPlannerZones()
  // Load spatial layers from store
  if (!spatialStore.isLoading && spatialStore.availableLayers.length === 0) {
    spatialStore.loadLayers()
  }

  // Initialize real MapLibre map
  await nextTick()
  if (!mapContainer.value) return

  // Cream land base matching the home preview — PostGIS basemap layers
  // are painted on top of this background via addVunguBasemap().
  const blankStyle = {
    version: 8 as const,
    sources: {},
    layers: [
      { id: 'background', type: 'background' as const, paint: { 'background-color': '#f2efe9' } },
    ],
    // Self-hosted glyphs (public/fonts) — no external CDN. Matches InteractiveMap.vue.
    glyphs: '/fonts/{fontstack}/{range}.pbf',
  }

  mapInstance.value = new maplibregl.Map({
    container: mapContainer.value,
    style: blankStyle as any,
    center: [29.82, -19.48],  // Vungu RDC district centre
    zoom: 10,
    minZoom: 1,
    maxZoom: 22,
    attributionControl: false,
    preserveDrawingBuffer: true,  // needed for PNG/PDF map capture (snapshot, plan PDF)
  })

  // @ts-ignore — MapLibre types cause deep-instantiation TS2589 here
  // Zoom lives in the map's own top-right controls; this adds only the compass (reset bearing).
  mapInstance.value.addControl(new maplibregl.NavigationControl({ showZoom: false, showCompass: true }), 'bottom-right')
  // @ts-ignore
  mapInstance.value.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

  mapInstance.value.on('load', () => {
    // PostGIS-backed basemap (same source the home preview uses): 24
    // country-wide vector-tile layers served from /api/tiles/:layer.
    // Planner defaults, and the basemap kept BENEATH the planner's drawing, CAD and planning
    // layers (it is added after an async fetch, so without beforeId it landed on top of them).
    // What to draw on arrival comes from the catalogue (the QGIS project's own on/off boxes); the
    // built-in set is only the fallback when the catalogue cannot be fetched.
    void (async () => {
      try { catalogue.value = await getCatalogue() } catch { catalogue.value = null }
      if (catalogue.value) {
        for (const g of catalogue.value.groups) collapsedGroups[g.name] = startsCollapsed(g.name)
        fitToCatalogueExtent()
      }
      await addVunguBasemap(mapInstance.value!, {
        defaultVisible: defaultTileLayers(catalogue.value) ?? PLANNER_BASEMAP_DEFAULT,
        beforeId: 'draw-completed-fill',
      })
      syncBasemapVisibility()
    })()
    mapInstance.value!.on('vungu:map-event', onMapEvent)
    mapLoading.value = false
    initMapTools(mapInstance.value!)
    attachCursorReadout()

    // Land-subdivision planning overlay (planner-only). Sources start empty and
    // are kept in sync by the watch on planning.layers below.
    addPlanningLayers(mapInstance.value!)
    planningReady.value = true
    syncPlanningLayers(mapInstance.value!, planning.layers.value as any)
    wirePlanningPopups(mapInstance.value!)

    // Auto-discover the QGIS Server catalog (config lives backend-side).
    // Quiet: no toast on page load, the panel dot reports the status.
    connectQgis(true)

    // Dev/test handles — used by the headless-Chrome verification harness to
    // exercise the planning workflow programmatically. Harmless in production.
    if (import.meta.env.DEV) {
      ;(window as any).__plannerMap = mapInstance.value
      ;(window as any).__planning = planning
    }

    // Basemap emits a 'feature-click' CustomEvent on the map container for
    // every clicked feature (provinces, parcels, zones, landuse, etc.).
    // Pipe that into the right rail so clicking anything on the map fills
    // the Plot tab. Tools-mode clicks (polygon / measure / select-clear)
    // are handled separately by initMapTools' map-wide click.
    const container = mapInstance.value!.getContainer()
    container.addEventListener('feature-click', ((ev: Event) => {
      const detail = (ev as CustomEvent).detail || {}

      // Planning mode intercepts feature clicks. `detail.feature` carries the
      // FULL (un-clipped) geometry fetched from the backend, so the planning
      // area is the real parcel, not the tile-clipped render.
      if (planning.tool.value === 'select-parcel') {
        const f = detail.feature
        const gt = f?.geometry?.type
        if (f && (gt === 'Polygon' || gt === 'MultiPolygon')) {
          planning.selectParcel(f, detail.properties?.name)
          planning.tool.value = 'idle'
          rightTab.value = 'planning'
          fitToPlanningArea()
          showToast('Planning parcel selected', 'success')
        } else {
          showToast('Click a parcel/polygon feature to set the planning area', 'error')
        }
        return
      }
      if (planning.tool.value !== 'idle') return  // e.g. draw-road: don't fill Plot

      const props = detail.properties || (detail.feature && detail.feature.properties) || {}
      const layerId = detail.layer || 'feature'
      const layerMeta = plannerLayers.value.find(p => p.id === layerId)
      const lngLat = detail.lngLat
      selectedFeature.value = {
        ...props,
        _layerId:     layerId,
        _layerName:   layerMeta?.name || layerId.replace(/_/g, ' '),
        _geomType:    detail.feature?.geometry?.type || '—',
        _clickCoord:  lngLat ? `${lngLat.lng.toFixed(4)}° E, ${Math.abs(lngLat.lat).toFixed(4)}° S` : '—',
      }
      rightTab.value = 'info'
    }) as EventListener)

    // Right-click → desktop-style context menu (chiefly "Subdivide this land").
    container.addEventListener('feature-contextmenu', ((ev: Event) => {
      const d = (ev as CustomEvent).detail || {}
      const p = d.point || { x: 0, y: 0 }
      const name = d.properties?.name || d.properties?.name_cfu || (d.layer ? String(d.layer).replace(/_/g, ' ') : 'Feature')
      ctxMenu.value = {
        open: true, x: p.x, y: p.y, layer: d.layer || '', title: String(name),
        fid: d.fid != null ? Number(d.fid) : null,
        properties: d.properties || null,
        loadFeature: typeof d.loadFeature === 'function' ? d.loadFeature : null,
      }
    }) as EventListener)

    showToast('Planning Command Center ready — map loaded')
  })
})

// When the left/right sidebar collapses or expands, the map container's
// width changes but MapLibre won't notice until the next pan/zoom event.
// resize() forces it to recompute and re-render at the new size so the
// canvas always fills the visible space.
watch([leftCollapsed, rightCollapsed], () => {
  if (!mapInstance.value) return
  // Wait one frame so the DOM has applied the new sidebar width.
  requestAnimationFrame(() => mapInstance.value?.resize())
})

// Keep the MapLibre planning sources in sync with the engine output.
watch(planning.layers, (l) => {
  if (planningReady.value && mapInstance.value) syncPlanningLayers(mapInstance.value, l as any)
}, { deep: true })

// Crosshair cursor while a planning tool is active; reset transient tool state on exit.
watch(planning.tool, (t, prev) => {
  const m = mapInstance.value
  if (m) m.getCanvas().style.cursor = t === 'idle' ? (activeTool.value === 'select' ? 'default' : 'crosshair') : 'crosshair'
  if (t !== 'draw-road') { planRoadPts.value = []; cadSetSrc('cad-preview', cadEmptyFC()) }
  if (t !== 'split-lot') {
    if (splitTargetLotId.value && m) { try { m.setFeatureState({ source: 'pl-lots', id: splitTargetLotId.value }, { selected: false }) } catch { /* ignore */ } }
    splitTargetLotId.value = null
    splitCutPts.value = []
  }
  if (prev === 'merge-lots' && t !== 'merge-lots') clearMergeHighlight()
})

// Streets layer visibility toggle (flag lives in the planning state).
watch(planning.roadsVisible, (v) => {
  const m = mapInstance.value
  if (m && m.getLayer('pl-road-line')) m.setLayoutProperty('pl-road-line', 'visibility', v ? 'visible' : 'none')
})

// Colour the lots layer by use type when the planner toggles it.
watch(planning.colourByUse, (on) => {
  const m = mapInstance.value
  if (m && m.getLayer('pl-lot-fill')) m.setPaintProperty('pl-lot-fill', 'fill-color', on ? LOT_FILL_BY_USE : LOT_FILL_DEFAULT)
})

// Leaving the Plan tab cancels any active planning tool so existing map tools resume.
watch(rightTab, (t) => { if (t !== 'planning' && planning.tool.value !== 'idle') planning.tool.value = 'idle' })

onUnmounted(() => {
  window.removeEventListener('keydown', onWorkspaceKey)
  if (searchMarker) { searchMarker.remove(); searchMarker = null }
  if (searchTimer) clearTimeout(searchTimer)
  cadMarkers.forEach(m => m.remove()); cadMarkers = []
  mapInstance.value?.remove()
})
</script>

<style scoped>
/*
  ══════════════════════════════════════════════════════════════════════════
  PLANNING GIS WORKSTATION — presentation layer
  Every colour, radius, shadow and spacing step comes from the enterprise
  token SSOT (src/styles/enterprise.css). The only local additions are the
  workstation's own geometry (bar heights, rail widths) and JetBrains Mono
  for machine-readable values, which the brief specifies and which is
  already self-hosted in public/fonts/webfonts.
  ══════════════════════════════════════════════════════════════════════════
*/
.pw {
  --pw-cmd-h:      44px;
  --pw-status-h:   26px;
  --pw-rail-l:     288px;
  --pw-rail-r:     360px;
  --pw-strip:      40px;
  --pw-mono:       'JetBrains Mono', var(--ent-font-mono);

  display: grid;
  grid-template-rows: var(--pw-cmd-h) minmax(0, 1fr) var(--pw-status-h);
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--ent-canvas);
  color: var(--ent-text);
  font-family: var(--ent-font);
  font-size: var(--ent-fs-base);
  line-height: var(--ent-lh);
}

.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
code, .mono { font-family: var(--pw-mono); font-variant-numeric: tabular-nums; }

/* Shared focus treatment — visible on every interactive element. */
.pw :is(button, input, select, textarea, a, [tabindex]):focus-visible {
  outline: 2px solid var(--ent-accent);
  outline-offset: 1px;
  border-radius: var(--ent-r-sm);
}

@keyframes pw-spin { to { transform: rotate(360deg); } }
.spin-icon { animation: pw-spin 1s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .spin-icon { animation-duration: 3s; }
  .pw * { transition-duration: 0.01ms !important; }
}

/* ══════════════════════ COMMAND BAR ═══════════════════════════════════ */
.pw-cmd {
  display: flex; align-items: center; gap: var(--ent-s3);
  padding: 0 var(--ent-s3);
  background: var(--ent-surface);
  border-bottom: 1px solid var(--ent-line-strong);
  position: relative; z-index: var(--ent-z-rail);
}

.cmd-ws {
  display: inline-flex; align-items: center; gap: var(--ent-s2);
  padding-right: var(--ent-s3); flex-shrink: 0;
  border-right: 1px solid var(--ent-line);
  height: 22px; color: var(--ent-text-2);
}
.cmd-ws-label {
  font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-bold);
  letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap;
}

/* ── Global planning search ─────────────────────────────────────────── */
.cmd-search { position: relative; flex: 1 1 auto; min-width: 160px; max-width: 460px; }
.cs-ico {
  position: absolute; left: var(--ent-s2); top: 50%; transform: translateY(-50%);
  color: var(--ent-text-3); pointer-events: none;
}
.cs-input {
  width: 100%; height: var(--ent-control-h-sm);
  padding: 0 30px 0 30px;
  font-family: var(--ent-font); font-size: var(--ent-fs-sm); color: var(--ent-text);
  background: var(--ent-surface-2);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r);
  outline: none; transition: border-color var(--ent-dur), background var(--ent-dur);
}
.cs-input::placeholder { color: var(--ent-text-3); }
.cs-input:focus { background: var(--ent-surface); border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring); }
.cs-input::-webkit-search-cancel-button { display: none; }
.cs-kbd {
  position: absolute; right: var(--ent-s2); top: 50%; transform: translateY(-50%);
  font-family: var(--pw-mono); font-size: 10px; color: var(--ent-text-3);
  border: 1px solid var(--ent-line-strong); border-radius: 3px;
  padding: 0 4px; line-height: 15px; pointer-events: none;
}
.cs-clear {
  position: absolute; right: 5px; top: 50%; transform: translateY(-50%);
  width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; color: var(--ent-text-3); cursor: pointer; border-radius: var(--ent-r-sm);
}
.cs-clear:hover { background: var(--ent-surface-sunken); color: var(--ent-text); }

.cs-drop {
  position: absolute; top: calc(100% + 5px); left: 0; right: 0;
  background: var(--ent-surface); border: 1px solid var(--ent-line-strong);
  border-radius: var(--ent-r-md); box-shadow: var(--ent-e3);
  z-index: var(--ent-z-popover); overflow: hidden;
  max-height: 60vh; overflow-y: auto;
}
.cs-drop-head {
  padding: var(--ent-s1) var(--ent-s3);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold);
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--ent-text-3);
  background: var(--ent-surface-2); border-bottom: 1px solid var(--ent-line);
}
.cs-row {
  display: flex; align-items: center; gap: var(--ent-s2); width: 100%;
  padding: var(--ent-s2) var(--ent-s3);
  background: none; border: none; border-bottom: 1px solid var(--ent-line);
  text-align: left; cursor: pointer; font-family: var(--ent-font);
}
.cs-row:last-child { border-bottom: none; }
.cs-row:hover, .cs-row.active { background: var(--ent-accent-soft); }
.cs-row-ico {
  flex-shrink: 0; width: 24px; height: 24px; border-radius: var(--ent-r-sm);
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--ent-surface-sunken); color: var(--ent-text-2);
}
.cs-t-ward   { background: var(--ent-tone-info-bg);     color: var(--ent-tone-info-fg); }
.cs-t-parcel { background: var(--ent-tone-warning-bg);  color: var(--ent-tone-warning-fg); }
.cs-t-farm   { background: var(--ent-tone-positive-bg); color: var(--ent-tone-positive-fg); }
.cs-t-place  { background: var(--ent-tone-negative-bg); color: var(--ent-tone-negative-fg); }
.cs-t-poi    { background: var(--ent-tone-neutral-bg);  color: var(--ent-tone-neutral-fg); }
.cs-t-zone   { background: var(--ent-accent-soft);      color: var(--ent-accent); }
.cs-row-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.cs-row-label { font-size: var(--ent-fs-sm); color: var(--ent-text); line-height: 1.3;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cs-row-label :deep(strong) { font-weight: var(--ent-fw-bold); }
.cs-row-sub { font-size: var(--ent-fs-micro); color: var(--ent-text-3); line-height: 1.3;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cs-row-type {
  flex-shrink: 0; font-size: var(--ent-fs-micro); color: var(--ent-text-3);
  text-transform: uppercase; letter-spacing: 0.05em;
}
.cs-note {
  display: flex; align-items: center; gap: var(--ent-s2);
  padding: var(--ent-s3); font-size: var(--ent-fs-sm); color: var(--ent-text-3);
}

/* ── Tool groups ────────────────────────────────────────────────────── */
.cmd-tools { display: flex; align-items: center; gap: var(--ent-s2); flex-shrink: 1; min-width: 0; overflow: hidden; }
.tgrp {
  display: inline-flex; align-items: center;
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r);
  background: var(--ent-surface-2); overflow: hidden; flex-shrink: 0;
}
.tbtn {
  width: 30px; height: var(--ent-control-h-sm);
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-right: 1px solid var(--ent-line);
  background: transparent; color: var(--ent-text-2); cursor: pointer;
  transition: background var(--ent-dur) var(--ent-ease), color var(--ent-dur);
}
.tgrp .tbtn:last-child, .tgrp .tmenu:last-child .tbtn { border-right: none; }
.tbtn:hover:not(:disabled) { background: var(--ent-surface-sunken); color: var(--ent-text); }
.tbtn.on { background: var(--ent-accent); color: var(--ent-text-on-accent); }
.tbtn:disabled { opacity: 0.38; cursor: not-allowed; }
.tbtn-wide { width: 40px; gap: 1px; }

/* ── Right cluster ──────────────────────────────────────────────────── */
.cmd-right { display: flex; align-items: center; gap: var(--ent-s2); margin-left: auto; flex-shrink: 0; }

.cmd-case {
  display: inline-flex; align-items: center; gap: var(--ent-s1);
  height: var(--ent-control-h-sm); padding: 0 var(--ent-s2);
  max-width: 220px;
  border: 1px solid var(--ent-tone-info-line); border-radius: var(--ent-r);
  background: var(--ent-tone-info-bg); color: var(--ent-tone-info-fg);
  font-family: var(--ent-font); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold);
  cursor: pointer;
}
.cmd-case:hover { filter: brightness(0.97); }
.cmd-case.lv-caution  { background: var(--ent-tone-warning-bg);  color: var(--ent-tone-warning-fg);  border-color: var(--ent-tone-warning-line); }
.cmd-case.lv-urgent,
.cmd-case.lv-critical { background: var(--ent-tone-negative-bg); color: var(--ent-tone-negative-fg); border-color: var(--ent-tone-negative-line); }
.cc-ref { font-family: var(--pw-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cc-days { font-family: var(--pw-mono); font-weight: var(--ent-fw-bold); padding-left: var(--ent-s1);
  border-left: 1px solid currentColor; opacity: 0.9; }

.cmd-icon {
  position: relative; width: 30px; height: var(--ent-control-h-sm);
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r);
  background: var(--ent-surface-2); color: var(--ent-text-2); cursor: pointer;
}
.cmd-icon:hover, .cmd-icon.on { background: var(--ent-surface-sunken); color: var(--ent-text); }
.cmd-badge {
  position: absolute; top: -5px; right: -5px; min-width: 15px; height: 15px;
  padding: 0 3px; border-radius: var(--ent-r-pill);
  background: var(--ent-danger); color: #fff;
  font-family: var(--pw-mono); font-size: 9px; font-weight: var(--ent-fw-bold);
  display: inline-flex; align-items: center; justify-content: center;
}

.cmd-qgis {
  display: inline-flex; align-items: center; gap: var(--ent-s1);
  height: var(--ent-control-h-sm); padding: 0 var(--ent-s2);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r);
  background: var(--ent-surface-2); color: var(--ent-text-2);
  font-family: var(--ent-font); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold);
  cursor: pointer;
}
.cmd-qgis:hover { background: var(--ent-surface-sunken); }
.q-text { letter-spacing: 0.04em; }

/* Connection dots — a word always accompanies the colour (never colour alone). */
.q-dot, .conn-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
  background: var(--ent-text-3); box-shadow: 0 0 0 2px var(--ent-surface);
}
.q-healthy  .q-dot, .conn-dot.q-healthy  { background: var(--ent-success); }
.q-degraded .q-dot, .conn-dot.q-degraded { background: var(--ent-warning); }
.q-offline  .q-dot, .conn-dot.q-offline  { background: var(--ent-danger); }
.q-unknown  .q-dot, .conn-dot.q-unknown  { background: var(--ent-text-3); }

/* ── Popovers (export menu, notifications, layer options) ───────────── */
.tmenu { position: relative; display: inline-flex; }
.pop {
  position: absolute; top: calc(100% + 5px); min-width: 210px;
  background: var(--ent-surface); border: 1px solid var(--ent-line-strong);
  border-radius: var(--ent-r-md); box-shadow: var(--ent-e3);
  z-index: var(--ent-z-popover); overflow: hidden;
}
.pop-right { right: 0; }
.pop-left  { right: 0; }
.pop-wide  { min-width: 300px; max-height: 60vh; overflow-y: auto; }
.pop-head {
  display: flex; align-items: center; justify-content: space-between; gap: var(--ent-s2);
  padding: var(--ent-s2) var(--ent-s3);
  background: var(--ent-surface-2); border-bottom: 1px solid var(--ent-line);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold);
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--ent-text-2);
}
.pop-head-meta { text-transform: none; letter-spacing: 0; font-weight: var(--ent-fw-normal); color: var(--ent-text-3); }
.pop-item {
  display: flex; align-items: center; gap: var(--ent-s2); width: 100%;
  padding: var(--ent-s2) var(--ent-s3); border: none; background: none;
  font-family: var(--ent-font); font-size: var(--ent-fs-sm); color: var(--ent-text);
  text-align: left; cursor: pointer;
}
.pop-item:hover:not(:disabled) { background: var(--ent-accent-soft); color: var(--ent-accent); }
.pop-item:disabled { opacity: 0.4; cursor: not-allowed; }
.pop-empty { margin: 0; padding: var(--ent-s4) var(--ent-s3); font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.pop-slider {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--ent-s2);
  padding: var(--ent-s2) var(--ent-s3); border-bottom: 1px solid var(--ent-line);
  font-size: var(--ent-fs-xs); color: var(--ent-text-2);
}
.pop-slider input { accent-color: var(--ent-accent); min-width: 0; }
.pop-slider output { font-family: var(--pw-mono); font-size: var(--ent-fs-micro); color: var(--ent-text); }
.pop-info {
  padding: var(--ent-s2) var(--ent-s3); border-top: 1px solid var(--ent-line);
  background: var(--ent-surface-2); display: flex; flex-direction: column; gap: 2px;
}
.pop-info div { display: flex; justify-content: space-between; gap: var(--ent-s2); font-size: var(--ent-fs-micro); }
.pop-info span { color: var(--ent-text-3); }
.pop-info code { color: var(--ent-text); font-size: var(--ent-fs-micro);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px; }
.pop-notif {
  display: flex; gap: var(--ent-s2); width: 100%; text-align: left;
  padding: var(--ent-s2) var(--ent-s3); border: none; border-bottom: 1px solid var(--ent-line);
  background: none; cursor: pointer; font-family: var(--ent-font);
}
.pop-notif:hover { background: var(--ent-surface-2); }
.pop-notif.unread { background: var(--ent-accent-soft); }
.pn-dot { width: 6px; height: 6px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; background: transparent; }
.pn-dot.on { background: var(--ent-accent); }
.pn-body { display: flex; flex-direction: column; min-width: 0; }
.pn-title { font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.pn-text { font-size: var(--ent-fs-micro); color: var(--ent-text-2); line-height: 1.4; }

/* ══════════════════════ BODY / RAILS ══════════════════════════════════ */
.pw-body {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-height: 0; min-width: 0;
}

.pw-rail {
  display: flex; flex-direction: column; min-height: 0;
  background: var(--ent-surface);
  transition: width var(--ent-dur-lg) var(--ent-ease);
}
.rail-l { width: var(--pw-rail-l); border-right: 1px solid var(--ent-line-strong); }
.rail-r { width: var(--pw-rail-r); border-left: 1px solid var(--ent-line-strong); }
.rail-l.is-collapsed, .rail-r.is-collapsed { width: var(--pw-strip); background: var(--ent-surface-sunken); }

.rail-strip {
  display: flex; flex-direction: column; align-items: center; gap: var(--ent-s1);
  padding: var(--ent-s2) 0;
}
.strip-btn {
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent; border-radius: var(--ent-r-sm);
  background: none; color: var(--ent-text-2); cursor: pointer;
}
.strip-btn:hover { background: var(--ent-surface); border-color: var(--ent-line); color: var(--ent-text); }
.strip-btn.on { background: var(--ent-accent); color: var(--ent-text-on-accent); }
.strip-sep { width: 20px; height: 1px; background: var(--ent-line-strong); margin: var(--ent-s1) 0; }

.rail-head {
  display: flex; align-items: center; justify-content: space-between;
  height: 30px; padding: 0 var(--ent-s2) 0 var(--ent-s3); flex-shrink: 0;
  background: var(--ent-surface-2); border-bottom: 1px solid var(--ent-line);
}
.rail-head-title {
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold);
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--ent-text-3);
}
.rail-head-btn {
  width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; color: var(--ent-text-3); cursor: pointer; border-radius: var(--ent-r-sm);
}
.rail-head-btn:hover { background: var(--ent-surface-sunken); color: var(--ent-text); }

.rail-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.rail-scroll::-webkit-scrollbar, .ctx-body::-webkit-scrollbar,
.pop-wide::-webkit-scrollbar, .cs-drop::-webkit-scrollbar { width: 8px; }
.rail-scroll::-webkit-scrollbar-thumb, .ctx-body::-webkit-scrollbar-thumb,
.pop-wide::-webkit-scrollbar-thumb, .cs-drop::-webkit-scrollbar-thumb {
  background: var(--ent-line-strong); border-radius: var(--ent-r-pill);
  border: 2px solid var(--ent-surface);
}

/* ── Rail sections ──────────────────────────────────────────────────── */
.sec { border-bottom: 1px solid var(--ent-line); }
.sec-head {
  display: flex; align-items: center; gap: var(--ent-s2); width: 100%;
  height: 30px; padding: 0 var(--ent-s3);
  border: none; background: none; cursor: pointer;
  font-family: var(--ent-font); font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold);
  letter-spacing: 0.07em; text-transform: uppercase; color: var(--ent-text-2);
}
.sec-head:hover { background: var(--ent-surface-2); color: var(--ent-text); }
.sec-caret { transition: transform var(--ent-dur) var(--ent-ease); }
.sec-caret.closed { transform: rotate(-90deg); }
.sec-badge {
  margin-left: auto; padding: 0 var(--ent-s1); border-radius: var(--ent-r-sm);
  background: var(--ent-tone-neutral-bg); color: var(--ent-tone-neutral-fg);
  font-size: 9px; letter-spacing: 0.04em;
}
.sec-body { padding: var(--ent-s2) var(--ent-s3) var(--ent-s3); display: flex; flex-direction: column; gap: var(--ent-s2); }
.sec-body--flush { padding-left: 0; padding-right: 0; gap: 0; }
.sec-note { margin: 0; padding: 0 var(--ent-s3); font-size: var(--ent-fs-micro); color: var(--ent-text-3); line-height: 1.45; }
.sec-body:not(.sec-body--flush) .sec-note { padding: 0; }
.sec-sub {
  display: flex; align-items: center; gap: var(--ent-s1);
  padding: var(--ent-s3) var(--ent-s3) var(--ent-s1);
  font-size: 10px; font-weight: var(--ent-fw-bold); letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--ent-text-3);
}
.sec-sub-n { font-family: var(--pw-mono); font-weight: var(--ent-fw-normal); letter-spacing: 0; }
/* A group header that opens and closes its layers. */
.sec-sub-btn { display: flex; align-items: center; gap: 6px; width: 100%; background: none; border: 0; cursor: pointer; text-align: left; font-family: inherit; }
.sec-sub-btn:hover { color: var(--ent-text-2); }
.sec-sub-btn:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.sec-sub-chev { width: 10px; flex: none; }

/* ── Fields ─────────────────────────────────────────────────────────── */
.fld { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.fld-label {
  display: flex; align-items: baseline; gap: var(--ent-s1);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); color: var(--ent-text-2);
}
.fld-label i { font-style: normal; color: var(--ent-danger); }
.fld-hint { color: var(--ent-text-3) !important; font-weight: var(--ent-fw-normal); }
.fld-input {
  width: 100%; min-width: 0; height: var(--ent-control-h-sm);
  padding: 0 var(--ent-s2);
  font-family: var(--ent-font); font-size: var(--ent-fs-sm); color: var(--ent-text);
  background: var(--ent-surface); border: 1px solid var(--ent-line-strong);
  border-radius: var(--ent-r-sm); outline: none;
  transition: border-color var(--ent-dur), box-shadow var(--ent-dur);
}
.fld-input:focus { border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring); }
.fld-input:disabled { background: var(--ent-surface-sunken); color: var(--ent-text-3); }
.fld-num { width: 74px; flex: 0 0 auto; font-family: var(--pw-mono); }
.fld-area { height: auto; min-height: 52px; padding: var(--ent-s2); resize: vertical; line-height: 1.45; }
.frm-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ent-s3); }

.extent {
  display: flex; flex-direction: column; gap: 2px;
  padding: var(--ent-s2); border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-sm); background: var(--ent-surface-2);
}
.extent-row { display: flex; justify-content: space-between; gap: var(--ent-s2); font-size: var(--ent-fs-micro); }
.extent-row span { color: var(--ent-text-3); }
.extent-row code { color: var(--ent-text); font-size: var(--ent-fs-micro);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Layer tree rows ────────────────────────────────────────────────── */
.lyr {
  display: flex; align-items: center; gap: var(--ent-s2);
  min-height: 32px; padding: 0 var(--ent-s2);
  border-left: 2px solid transparent;
}
.lyr:hover { background: var(--ent-surface-2); }
.lyr.on { border-left-color: var(--ent-accent); }
.lyr.unavailable .lyr-name, .lyr.unavailable .lyr-meta, .lyr.unavailable .lyr-sym { opacity: 0.5; }
.lyr-eye:disabled { cursor: not-allowed; opacity: 0.5; }
.lyr-eye {
  width: 22px; height: 22px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; border-radius: var(--ent-r-sm);
  color: var(--ent-text-3); cursor: pointer;
}
.lyr.on .lyr-eye { color: var(--ent-accent); }
.lyr-eye:hover { background: var(--ent-surface-sunken); color: var(--ent-text); }
.lyr-sym { width: 12px; height: 12px; flex-shrink: 0; background: var(--sym, var(--ent-text-3)); }
.sym-poly { border-radius: 2px; opacity: 0.85; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.22); }
.sym-line { height: 3px; border-radius: 2px; }
.sym-pt   { border-radius: 50%; box-shadow: 0 0 0 1.5px var(--ent-surface); }
/* An active layer's legend, in the QGIS project's own class names. */
.lyr { flex-wrap: wrap; }
.lyr-legend { flex-basis: 100%; list-style: none; margin: 0; padding: 0 0 var(--ent-s2) 34px;
  display: grid; gap: 2px; font-size: var(--ent-fs-micro); color: var(--ent-text-2);
  max-height: 11rem; overflow-y: auto; } /* roads carry 27 classes */
.lyr-legend li { display: flex; align-items: center; gap: var(--ent-s2); line-height: 1.35; }
.lyr-legend-sw { width: 14px; height: 10px; flex-shrink: 0; border-radius: 2px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25); }
.lyr-txt { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.lyr-name {
  font-size: var(--ent-fs-sm); color: var(--ent-text); line-height: 1.25;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.lyr.on .lyr-name { font-weight: var(--ent-fw-semibold); }
.lyr-meta {
  font-size: var(--ent-fs-micro); color: var(--ent-text-3); line-height: 1.3;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.lyr-n { font-family: var(--pw-mono); font-size: 10px; color: var(--ent-text-3); flex-shrink: 0; }
.lyr-more {
  width: 20px; height: 20px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; border-radius: var(--ent-r-sm);
  color: var(--ent-text-3); cursor: pointer; opacity: 0;
}
.lyr:hover .lyr-more, .lyr-more[aria-expanded="true"] { opacity: 1; }
.lyr-more:focus-visible { opacity: 1; }
.lyr-more:hover { background: var(--ent-surface-sunken); color: var(--ent-text); }

.chips { display: flex; flex-wrap: wrap; gap: var(--ent-s1); padding: var(--ent-s1) var(--ent-s3) var(--ent-s2) 42px; }
.chip {
  display: inline-flex; align-items: center; height: 20px; padding: 0 var(--ent-s2);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-pill);
  background: var(--ent-surface); color: var(--ent-text-3);
  font-size: 10px; font-weight: var(--ent-fw-semibold); text-transform: capitalize;
  cursor: pointer; transition: background var(--ent-dur), color var(--ent-dur);
}
.chip:hover { border-color: var(--ent-text-3); color: var(--ent-text-2); }
.chip.on { background: var(--ent-accent); border-color: var(--ent-accent); color: var(--ent-text-on-accent); }
.chip:focus-within { box-shadow: var(--ent-focus-ring); }

/* ── Connection cards ───────────────────────────────────────────────── */
.conn {
  display: flex; flex-direction: column; gap: var(--ent-s2);
  padding: var(--ent-s2); border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-sm); background: var(--ent-surface-2);
}
.conn-head { display: flex; align-items: center; gap: var(--ent-s2); }
.conn-name {
  display: inline-flex; align-items: center; gap: var(--ent-s1);
  font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text);
}
.conn-state { margin-left: auto; font-size: 10px; font-weight: var(--ent-fw-bold);
  letter-spacing: 0.05em; text-transform: uppercase; color: var(--ent-text-3); }
.conn-state.q-healthy  { color: var(--ent-success); }
.conn-state.q-degraded { color: var(--ent-warning); }
.conn-state.q-offline  { color: var(--ent-danger); }
.conn-rows { display: flex; flex-direction: column; gap: 2px; }
.conn-rows div { display: flex; justify-content: space-between; gap: var(--ent-s2); font-size: var(--ent-fs-micro); }
.conn-rows span { color: var(--ent-text-3); }
.conn-rows code { color: var(--ent-text); font-size: var(--ent-fs-micro); }
.conn-err {
  display: flex; align-items: flex-start; gap: var(--ent-s1); margin: 0;
  padding: var(--ent-s1) var(--ent-s2); border-radius: var(--ent-r-sm);
  background: var(--ent-tone-negative-bg); color: var(--ent-tone-negative-fg);
  font-size: var(--ent-fs-micro); line-height: 1.4;
}

/* ══════════════════════ MAP ═══════════════════════════════════════════ */
.pw-map { position: relative; min-width: 0; min-height: 0; background: var(--ent-surface-sunken); overflow: hidden; }
.map-canvas { position: absolute; inset: 0; }

.map-filters { position: absolute; top: var(--ent-s3); left: var(--ent-s3); z-index: 6; max-width: 300px; }
.map-legend  { position: absolute; left: var(--ent-s3); bottom: var(--ent-s3); z-index: 6; }

.map-ctrl { position: absolute; top: var(--ent-s3); right: var(--ent-s3); z-index: 6;
  display: flex; flex-direction: column; gap: var(--ent-s2); }
.mc-grp {
  display: flex; flex-direction: column;
  background: var(--ent-map-panel-bg); border: 1px solid var(--ent-map-panel-line);
  border-radius: var(--ent-r); box-shadow: var(--ent-map-panel-shadow); overflow: hidden;
}
.mc-btn {
  width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
  border: none; border-bottom: 1px solid var(--ent-line);
  background: transparent; color: var(--ent-text-2); cursor: pointer;
}
.mc-grp .mc-btn:last-child { border-bottom: none; }
.mc-btn:hover { background: var(--ent-surface-2); color: var(--ent-text); }

/* Active-tool instruction banner */
.tool-banner {
  position: absolute; top: var(--ent-s3); left: 50%; transform: translateX(-50%);
  z-index: 8; display: flex; align-items: center; gap: var(--ent-s2);
  max-width: min(620px, calc(100% - 96px));
  height: 30px; padding: 0 var(--ent-s2) 0 var(--ent-s3);
  background: var(--ent-text); color: #fff;
  border-radius: var(--ent-r); box-shadow: var(--ent-e3);
  font-size: var(--ent-fs-xs);
}
.tool-banner.tb-plan { background: var(--ent-accent); }
.tb-ico { flex-shrink: 0; opacity: 0.85; }
.tb-name { font-weight: var(--ent-fw-bold); text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
.tb-hint { color: rgba(255, 255, 255, 0.72); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tb-cancel {
  margin-left: auto; flex-shrink: 0;
  display: inline-flex; align-items: center; gap: var(--ent-s1);
  height: 20px; padding: 0 var(--ent-s2);
  border: 1px solid rgba(255, 255, 255, 0.32); border-radius: var(--ent-r-sm);
  background: rgba(255, 255, 255, 0.1); color: #fff;
  font-family: var(--ent-font); font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  cursor: pointer;
}
.tb-cancel:hover { background: rgba(255, 255, 255, 0.2); }
.tb-cancel kbd { font-family: var(--pw-mono); font-size: 9px; opacity: 0.75; }

/* Transient readouts */
.map-readouts {
  position: absolute; left: 50%; bottom: var(--ent-s3); transform: translateX(-50%);
  z-index: 7; display: flex; flex-direction: column; align-items: center; gap: var(--ent-s1);
  pointer-events: none; max-width: calc(100% - 96px);
}
.ro {
  pointer-events: auto; display: inline-flex; align-items: center; gap: var(--ent-s2);
  height: 28px; padding: 0 var(--ent-s3);
  background: var(--ent-map-panel-bg); border: 1px solid var(--ent-map-panel-line);
  border-radius: var(--ent-r); box-shadow: var(--ent-map-panel-shadow);
  font-size: var(--ent-fs-xs); color: var(--ent-text-2); white-space: nowrap;
}
.ro-strong { color: var(--ent-text); }
.ro b { font-family: var(--pw-mono); font-weight: var(--ent-fw-semibold); }
.ro-act {
  display: inline-flex; align-items: center; gap: var(--ent-s1);
  height: 20px; padding: 0 var(--ent-s2); margin-left: var(--ent-s1);
  border: none; border-radius: var(--ent-r-sm);
  background: var(--ent-accent); color: var(--ent-text-on-accent);
  font-family: var(--ent-font); font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  cursor: pointer;
}
.ro-act:hover { background: var(--ent-accent-hover); }
.ro-x {
  width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; color: var(--ent-text-3); cursor: pointer; border-radius: var(--ent-r-sm);
}
.ro-x:hover { background: var(--ent-danger-soft); color: var(--ent-danger); }

.map-loading {
  position: absolute; inset: 0; z-index: 9;
  background: rgba(236, 239, 243, 0.82); backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center; gap: var(--ent-s2);
  font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text-2);
}
.fade-enter-active, .fade-leave-active { transition: opacity var(--ent-dur-lg); }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ══════════════════════ CONTEXT RAIL ══════════════════════════════════ */
.ctx-head {
  flex-shrink: 0; padding: var(--ent-s2) var(--ent-s3) var(--ent-s3);
  background: var(--ent-surface-2); border-bottom: 1px solid var(--ent-line);
}
.ctx-head-top { display: flex; align-items: center; justify-content: space-between; min-height: 22px; }
.ctx-eyebrow {
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold);
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--ent-text-3);
}
.ctx-title-row { display: flex; align-items: center; gap: var(--ent-s2); }
.ctx-title {
  margin: 0; flex: 1; min-width: 0;
  font-family: var(--pw-mono); font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-semibold);
  line-height: var(--ent-lh-tight); color: var(--ent-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ctx-clear {
  width: 22px; height: 22px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; color: var(--ent-text-3); cursor: pointer; border-radius: var(--ent-r-sm);
}
.ctx-clear:hover { background: var(--ent-surface-sunken); color: var(--ent-text); }
.ctx-tags { display: flex; flex-wrap: wrap; gap: var(--ent-s1); margin-top: var(--ent-s2); }
.tag {
  display: inline-flex; align-items: center; height: 18px; padding: 0 var(--ent-s2);
  border-radius: var(--ent-r-sm);
  background: var(--ent-tone-neutral-bg); color: var(--ent-tone-neutral-fg);
  font-size: 10px; font-weight: var(--ent-fw-semibold); text-transform: capitalize;
}
.tag-accent { background: var(--ent-tone-info-bg); color: var(--ent-tone-info-fg); }
.tag.st-available  { background: var(--ent-tone-positive-bg); color: var(--ent-tone-positive-fg); }
.tag.st-reserved   { background: var(--ent-tone-warning-bg);  color: var(--ent-tone-warning-fg); }
.tag.st-allocated  { background: var(--ent-tone-info-bg);     color: var(--ent-tone-info-fg); }
.tag.st-withdrawn  { background: var(--ent-tone-negative-bg); color: var(--ent-tone-negative-fg); }
.ctx-none { margin: var(--ent-s1) 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }

/* ── Statutory case banner ──────────────────────────────────────────── */
.case {
  flex-shrink: 0; display: flex; flex-direction: column; gap: var(--ent-s1);
  padding: var(--ent-s2) var(--ent-s3) var(--ent-s3);
  border-bottom: 1px solid var(--ent-line);
  border-left: 3px solid var(--ent-accent);
  background: var(--ent-accent-soft);
}
.case.lv-caution  { border-left-color: var(--ent-warning); background: var(--ent-warning-soft); }
.case.lv-urgent,
.case.lv-critical { border-left-color: var(--ent-danger);  background: var(--ent-danger-soft); }
.case-top { display: flex; align-items: center; justify-content: space-between; gap: var(--ent-s2); }
.case-eyebrow {
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold);
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--ent-text-2);
}
.case-match {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10px; font-weight: var(--ent-fw-semibold); color: var(--ent-success);
}
.case-ref { font-family: var(--pw-mono); font-size: var(--ent-fs-base); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.case-meta { display: flex; flex-wrap: wrap; gap: var(--ent-s1) var(--ent-s3);
  font-size: var(--ent-fs-micro); color: var(--ent-text-2); text-transform: capitalize; }
.case-clock {
  display: flex; align-items: baseline; justify-content: space-between; gap: var(--ent-s2);
  padding-top: var(--ent-s1); border-top: 1px solid rgba(0, 0, 0, 0.07);
  font-size: var(--ent-fs-micro); color: var(--ent-text-2);
}
.case-clock strong { font-family: var(--pw-mono); font-size: var(--ent-fs-xs); color: var(--ent-text); }

/* ── Context tabs ───────────────────────────────────────────────────── */
.ctx-tabs { display: flex; flex-shrink: 0; border-bottom: 1px solid var(--ent-line-strong); background: var(--ent-surface); }
.ctx-tab {
  flex: 1; min-width: 0;
  display: inline-flex; flex-direction: column; align-items: center; gap: 2px;
  padding: var(--ent-s2) 2px;
  border: none; border-bottom: 2px solid transparent; background: none; cursor: pointer;
  font-family: var(--ent-font); font-size: 10px; font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.04em; text-transform: uppercase; color: var(--ent-text-3);
  transition: color var(--ent-dur), background var(--ent-dur);
}
.ctx-tab span { overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.ctx-tab:hover { background: var(--ent-surface-2); color: var(--ent-text-2); }
.ctx-tab.on { color: var(--ent-accent); border-bottom-color: var(--ent-accent); }

.ctx-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.pane { display: flex; flex-direction: column; gap: var(--ent-s3); padding: var(--ent-s3); }
.pane-tools { gap: var(--ent-s2); }
.pal { display: flex; flex-direction: column; gap: var(--ent-s2); }

/* ── Panels inside the context rail ─────────────────────────────────── */
.pnl {
  display: flex; flex-direction: column; gap: var(--ent-s2);
  padding: var(--ent-s2) var(--ent-s3) var(--ent-s3);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-sm);
  background: var(--ent-surface);
}
.pnl-h {
  display: flex; align-items: center; gap: var(--ent-s1); margin: 0;
  padding-bottom: var(--ent-s1); border-bottom: 1px solid var(--ent-line);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold);
  letter-spacing: 0.07em; text-transform: uppercase; color: var(--ent-text-2);
}
.pnl-meta { margin-left: auto; font-weight: var(--ent-fw-normal); letter-spacing: 0;
  text-transform: none; color: var(--ent-text-3); }
.pnl-note { margin: 0; font-size: var(--ent-fs-micro); color: var(--ent-text-3); line-height: 1.45;
  display: flex; align-items: center; gap: var(--ent-s1); }
.pnl-toggle {
  margin-left: auto; display: inline-flex; align-items: center; gap: 3px;
  height: 18px; padding: 0 var(--ent-s1);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm);
  background: var(--ent-surface); color: var(--ent-text-3);
  font-family: var(--ent-font); font-size: 10px; font-weight: var(--ent-fw-semibold);
  text-transform: none; letter-spacing: 0; cursor: pointer;
}
.pnl-toggle.on { background: var(--ent-success-soft); border-color: var(--ent-tone-positive-line); color: var(--ent-success); }
.sub-h { font-size: 10px; font-weight: var(--ent-fw-bold); letter-spacing: 0.07em;
  text-transform: uppercase; color: var(--ent-text-3); }

/* Key/value grid */
.kv { display: grid; grid-template-columns: minmax(84px, 40%) 1fr; gap: 0; margin: 0; }
.kv dt, .kv dd {
  padding: 5px var(--ent-s1) 5px 0; margin: 0; min-width: 0;
  border-bottom: 1px solid var(--ent-line);
  font-size: var(--ent-fs-xs); line-height: 1.35; overflow-wrap: anywhere;
}
.kv dt { color: var(--ent-text-3); }
.kv dd { color: var(--ent-text); font-weight: var(--ent-fw-medium); }
.kv dt:last-of-type, .kv dd:last-of-type { border-bottom: none; }

/* Action rows */
.acts { display: flex; flex-direction: column; gap: var(--ent-s1); }
.act {
  display: flex; align-items: center; gap: var(--ent-s2); width: 100%;
  min-height: 40px; padding: var(--ent-s2);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm);
  background: var(--ent-surface); color: var(--ent-text);
  text-align: left; cursor: pointer; font-family: var(--ent-font);
  transition: background var(--ent-dur), border-color var(--ent-dur);
}
.act:hover:not(:disabled) { background: var(--ent-surface-2); border-color: var(--ent-text-3); }
.act:disabled { opacity: 0.45; cursor: not-allowed; }
.act.on { border-color: var(--ent-accent); background: var(--ent-accent-soft); color: var(--ent-accent); }
.act > span { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.act b { font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); line-height: 1.3; }
.act i { font-style: normal; font-size: var(--ent-fs-micro); color: var(--ent-text-3); line-height: 1.35; }
.act-primary { background: var(--ent-accent); border-color: var(--ent-accent); color: var(--ent-text-on-accent); }
.act-primary:hover:not(:disabled) { background: var(--ent-accent-hover); border-color: var(--ent-accent-hover); }
.act-primary i { color: rgba(255, 255, 255, 0.75); }

/* Buttons */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--ent-s1);
  height: var(--ent-control-h); padding: 0 var(--ent-control-px);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r);
  background: var(--ent-surface); color: var(--ent-text);
  font-family: var(--ent-font); font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-medium);
  cursor: pointer; white-space: nowrap;
  transition: background var(--ent-dur), border-color var(--ent-dur);
}
.btn:hover:not(:disabled) { background: var(--ent-surface-2); border-color: var(--ent-text-3); }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-sm { height: var(--ent-control-h-sm); padding: 0 var(--ent-s2); font-size: var(--ent-fs-xs); }
.btn-block { width: 100%; }
.btn-icon { width: var(--ent-control-h-sm); height: var(--ent-control-h-sm); padding: 0; flex-shrink: 0; }
.btn-primary { background: var(--ent-accent); border-color: var(--ent-accent); color: var(--ent-text-on-accent); font-weight: var(--ent-fw-semibold); }
.btn-primary:hover:not(:disabled) { background: var(--ent-accent-hover); border-color: var(--ent-accent-hover); }
.btn-danger { color: var(--ent-danger); border-color: var(--ent-tone-negative-line); }
.btn-danger:hover:not(:disabled) { background: var(--ent-danger-soft); border-color: var(--ent-danger); }
.btn-on { background: var(--ent-accent-soft); border-color: var(--ent-accent-line); color: var(--ent-accent); }
.btn-row { display: flex; gap: var(--ent-s2); }
.btn-row .btn { flex: 1; }

/* Tool palette grids */
.palettes {
  display: grid; grid-template-columns: repeat(5, 1fr); flex-shrink: 0;
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm);
  background: var(--ent-surface); overflow: hidden;
}
.palette {
  display: inline-flex; flex-direction: column; align-items: center; gap: 2px;
  padding: var(--ent-s2) 2px; min-width: 0;
  border: none; border-right: 1px solid var(--ent-line); background: none;
  font-family: var(--ent-font); font-size: 9px; font-weight: var(--ent-fw-bold);
  letter-spacing: 0.04em; text-transform: uppercase; color: var(--ent-text-3);
  cursor: pointer;
}
.palette:last-child { border-right: none; }
.palette:hover { background: var(--ent-surface-2); color: var(--ent-text-2); }
.palette.on { background: var(--ent-accent); color: var(--ent-text-on-accent); }
.palette span { overflow: hidden; text-overflow: ellipsis; max-width: 100%; }

.tool-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--ent-s1); }
.tool-grid-3 { grid-template-columns: repeat(3, 1fr); }
.tool-grid-2 { grid-template-columns: repeat(2, 1fr); }
.tool {
  display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  min-height: 46px; padding: var(--ent-s1);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm);
  background: var(--ent-surface); color: var(--ent-text-2);
  font-family: var(--ent-font); font-size: 10px; font-weight: var(--ent-fw-semibold);
  cursor: pointer; text-align: center;
  transition: background var(--ent-dur), border-color var(--ent-dur), color var(--ent-dur);
}
.tool span { line-height: 1.15; }
.tool:hover:not(:disabled) { background: var(--ent-surface-2); border-color: var(--ent-text-3); color: var(--ent-text); }
.tool.on { background: var(--ent-accent); border-color: var(--ent-accent); color: var(--ent-text-on-accent); }
.tool:disabled { opacity: 0.45; cursor: not-allowed; }

.inline { display: flex; align-items: center; gap: var(--ent-s2); }
.inline .fld-input { flex: 1; }
.unit { font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); color: var(--ent-text-3); }

.presets { display: flex; flex-wrap: wrap; gap: var(--ent-s1); }
.preset {
  display: inline-flex; align-items: center; height: 22px; padding: 0 var(--ent-s2);
  border: 1px solid var(--ent-accent-line); border-radius: var(--ent-r-sm);
  background: var(--ent-accent-soft); color: var(--ent-accent);
  font-family: var(--ent-font); font-size: 10px; font-weight: var(--ent-fw-semibold);
  cursor: pointer;
}
.preset:hover { background: var(--ent-accent); color: var(--ent-text-on-accent); border-color: var(--ent-accent); }

.checkrow { display: flex; flex-wrap: wrap; gap: var(--ent-s3); }
.check { display: inline-flex; align-items: center; gap: var(--ent-s1);
  font-size: var(--ent-fs-micro); color: var(--ent-text-2); cursor: pointer; }
.check input { width: 13px; height: 13px; accent-color: var(--ent-accent); }
.check input:disabled { cursor: not-allowed; }

.coord { display: flex; align-items: center; gap: var(--ent-s2);
  padding: var(--ent-s1) var(--ent-s2); border-radius: var(--ent-r-sm); background: var(--ent-surface-sunken); }
.coord-l { font-size: 9px; font-weight: var(--ent-fw-bold); letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--ent-text-3); }
.coord-v { flex: 1; min-width: 0; font-size: var(--ent-fs-micro); color: var(--ent-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Permit table */
.tbl { width: 100%; border-collapse: collapse; font-size: var(--ent-fs-xs); }
.tbl th {
  text-align: left; padding: var(--ent-s1) var(--ent-s1) var(--ent-s1) 0;
  border-bottom: 1px solid var(--ent-line-strong);
  font-size: 9px; font-weight: var(--ent-fw-bold); letter-spacing: 0.07em;
  text-transform: uppercase; color: var(--ent-text-3); white-space: nowrap;
}
.tbl td {
  padding: var(--ent-s1) var(--ent-s1) var(--ent-s1) 0;
  border-bottom: 1px solid var(--ent-line);
  color: var(--ent-text-2); vertical-align: top; overflow-wrap: anywhere;
}
.tbl tbody tr { cursor: pointer; }
.tbl tbody tr:hover { background: var(--ent-accent-soft); }
.tbl tbody tr:last-child td { border-bottom: none; }
.tbl .mono { display: block; color: var(--ent-text); font-weight: var(--ent-fw-semibold); font-size: var(--ent-fs-micro); }
.tbl-sub { display: block; font-size: 10px; color: var(--ent-text-3); text-transform: capitalize; }
.badge {
  display: inline-flex; align-items: center; padding: 1px var(--ent-s1);
  border-radius: var(--ent-r-sm);
  background: var(--ent-tone-neutral-bg); color: var(--ent-tone-neutral-fg);
  font-size: 9px; font-weight: var(--ent-fw-bold); letter-spacing: 0.03em;
  text-transform: uppercase; white-space: nowrap;
}
.badge.st-approved, .badge.st-conditionally_approved { background: var(--ent-tone-positive-bg); color: var(--ent-tone-positive-fg); }
.badge.st-refused, .badge.st-withdrawn, .badge.st-lapsed { background: var(--ent-tone-negative-bg); color: var(--ent-tone-negative-fg); }
.badge.st-registered, .badge.st-pending_docs, .badge.st-appeal { background: var(--ent-tone-warning-bg); color: var(--ent-tone-warning-fg); }
.badge.st-under_review, .badge.st-consultation, .badge.st-objection_period { background: var(--ent-tone-info-bg); color: var(--ent-tone-info-fg); }

/* Due-diligence checks — icon + word + count, never colour alone */
.checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.checks li {
  display: flex; align-items: center; gap: var(--ent-s2);
  padding: var(--ent-s1) var(--ent-s2); border-radius: var(--ent-r-sm);
  border-left: 3px solid transparent;
  font-size: var(--ent-fs-xs);
}
.checks li.pass { background: var(--ent-tone-positive-bg); color: var(--ent-tone-positive-fg); border-left-color: var(--ent-success); }
.checks li.fail { background: var(--ent-tone-negative-bg); color: var(--ent-tone-negative-fg); border-left-color: var(--ent-danger); }
.checks li.na   { background: var(--ent-tone-neutral-bg);  color: var(--ent-tone-neutral-fg);  border-left-color: var(--ent-line-strong); }
.chk-lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chk-v { font-size: 9px; font-weight: var(--ent-fw-bold); letter-spacing: 0.06em; opacity: 0.9; }
.chk-n { font-family: var(--pw-mono); font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold); min-width: 16px; text-align: right; }

.todo { list-style: disc; margin: 0; padding-left: var(--ent-s5);
  display: flex; flex-direction: column; gap: var(--ent-s1);
  font-size: var(--ent-fs-micro); color: var(--ent-text-2); line-height: 1.45; }

/* Empty states */
.empty {
  display: flex; flex-direction: column; align-items: center; gap: var(--ent-s2);
  padding: var(--ent-s7) var(--ent-s4); text-align: center; color: var(--ent-text-3);
}
.empty-t { margin: 0; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text-2); }
.empty-s { margin: 0; font-size: var(--ent-fs-micro); line-height: 1.5; max-width: 26ch; }

/* ══════════════════════ STATUS BAR ════════════════════════════════════ */
.pw-status {
  display: flex; align-items: center; gap: var(--ent-s2);
  padding: 0 var(--ent-s3);
  background: var(--ent-surface); border-top: 1px solid var(--ent-line-strong);
  font-size: var(--ent-fs-micro); color: var(--ent-text-3);
  overflow: hidden; white-space: nowrap;
}
.st-item { display: inline-flex; align-items: center; gap: var(--ent-s1); min-width: 0; }
.st-item code { font-size: 10px; color: var(--ent-text-2); overflow: hidden; text-overflow: ellipsis; }
.st-sep { width: 1px; height: 12px; background: var(--ent-line); flex-shrink: 0; }
.st-fill { flex: 1 1 auto; min-width: var(--ent-s2); }
.st-btn { border: none; background: none; cursor: pointer; padding: 0 var(--ent-s1); height: 18px;
  border-radius: var(--ent-r-sm); font-family: var(--ent-font); }
.st-btn:hover { background: var(--ent-surface-2); }
.st-state.ss-active code { color: var(--ent-accent); font-weight: var(--ent-fw-semibold); }
.st-state.ss-warn code   { color: var(--ent-warning); font-weight: var(--ent-fw-semibold); }
.st-btn.q-healthy  code { color: var(--ent-success); }
.st-btn.q-degraded code { color: var(--ent-warning); }
.st-btn.q-offline  code { color: var(--ent-danger); }

/* ══════════════════════ MODALS ════════════════════════════════════════ */
.modal-backdrop {
  position: fixed; inset: 0; z-index: var(--ent-z-modal);
  background: rgba(17, 29, 45, 0.45);
  display: flex; align-items: center; justify-content: center; padding: var(--ent-s4);
}
.modal {
  width: 460px; max-width: 100%; max-height: 90vh;
  display: flex; flex-direction: column;
  background: var(--ent-surface); border-radius: var(--ent-r-lg); box-shadow: var(--ent-e4);
  font-family: var(--ent-font);
}
.modal-head {
  display: flex; align-items: flex-start; gap: var(--ent-s2);
  padding: var(--ent-s3) var(--ent-s4); border-bottom: 1px solid var(--ent-line);
}
.modal-head-txt { flex: 1; min-width: 0; }
.modal-head h3 { margin: 0 0 2px; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.modal-sub { margin: 0; font-size: var(--ent-fs-micro); color: var(--ent-text-3); line-height: 1.45; }
.modal-sub strong { font-family: var(--pw-mono); color: var(--ent-text); }
.modal-x {
  width: 26px; height: 26px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; color: var(--ent-text-3); cursor: pointer; border-radius: var(--ent-r-sm);
}
.modal-x:hover { background: var(--ent-surface-2); color: var(--ent-text); }
.modal-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: var(--ent-s4); display: flex; flex-direction: column; gap: var(--ent-s3);
}
.modal-foot {
  display: flex; justify-content: flex-end; gap: var(--ent-s2);
  padding: var(--ent-s3) var(--ent-s4); border-top: 1px solid var(--ent-line);
  background: var(--ent-surface-2);
  border-bottom-left-radius: var(--ent-r-lg); border-bottom-right-radius: var(--ent-r-lg);
}

/* ══════════════════════ TOAST ═════════════════════════════════════════ */
.toast {
  position: fixed; bottom: calc(var(--pw-status-h) + var(--ent-s4)); left: 50%; transform: translateX(-50%);
  z-index: var(--ent-z-toast);
  display: flex; align-items: center; gap: var(--ent-s2);
  padding: var(--ent-s2) var(--ent-s4); border-radius: var(--ent-r);
  background: var(--ent-text); color: #fff;
  font-family: var(--ent-font); font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-medium);
  box-shadow: var(--ent-e3); max-width: min(520px, 90vw);
}
.toast.error   { background: var(--ent-danger); }
.toast.warning { background: var(--ent-warning); }
.toast-enter-active, .toast-leave-active { transition: opacity var(--ent-dur-lg) var(--ent-ease), transform var(--ent-dur-lg) var(--ent-ease); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 10px); }

/* ══════════════════════ RESPONSIVE ════════════════════════════════════
   1440×900 is the design target. Below that the rails narrow, then the
   toolbar sheds its optional groups, then the rails become overlays so the
   map never stops being the dominant surface.                            */
@media (max-width: 1440px) {
  .pw { --pw-rail-r: 340px; }
}
@media (max-width: 1280px) {
  .pw { --pw-rail-l: 260px; --pw-rail-r: 320px; }
  .cmd-search { max-width: 300px; }
  .cmd-tools .tgrp:nth-child(1) .tbtn:nth-child(n + 3) { display: none; }
}
@media (max-width: 1100px) {
  .cmd-ws-label { display: none; }
  .cmd-search { max-width: 220px; }
  .cmd-tools .tgrp:nth-child(3) { display: none; }
  .cc-ref { display: none; }
}
@media (max-width: 1024px) {
  /* Rails float over the map as drawers — the map keeps the full width. */
  .pw-body { position: relative; }
  .pw-rail { position: absolute; top: 0; bottom: 0; z-index: var(--ent-z-rail); box-shadow: var(--ent-e3); }
  .rail-l { left: 0; }
  .rail-r { right: 0; }
  .pw-rail.is-collapsed { box-shadow: none; }
  .pw-map { grid-column: 1 / -1; }
  .cmd-qgis .q-text { display: none; }
}
@media (max-width: 860px) {
  .pw { --pw-rail-r: 300px; }
  .cmd-tools .tgrp:nth-child(2) .tbtn:nth-child(n + 4) { display: none; }
  .map-filters { max-width: 220px; }
  .tb-hint { display: none; }
}

/* ═══════════════════════════════════════════════════════════════════════
   MOBILE: ≤767px (Phase 12)
   Below the tablet breakpoint the rails stop being panels beside a map and
   become sheets over one. 300px of rail on a 375px screen is not a rail, it
   is a takeover.

   Just as importantly, this block UNDOES the progressive `display: none`
   above. Those rules shed toolbar groups at 1280, 1100 and 860 to keep the
   command bar on one line; cascading down to 375 they would hide almost
   every tool with no other route to it, which is exactly the failure Phase 9
   names. Here the bar scrolls horizontally instead, and every tool returns.
   ═══════════════════════════════════════════════════════════════════════ */
@media (max-width: 767px) {
  /* ── Command bar: scroll, do not shed ───────────────────────────────── */
  .cmd-tools {
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    flex-shrink: 1;
  }
  .cmd-tools::-webkit-scrollbar { display: none; }
  .cmd-tools .tgrp { flex: 0 0 auto; }
  /* Every tool hidden by the 1280 / 1100 / 860 rules comes back. */
  .cmd-tools .tgrp:nth-child(1) .tbtn:nth-child(n + 3),
  .cmd-tools .tgrp:nth-child(2) .tbtn:nth-child(n + 4),
  .cmd-tools .tgrp:nth-child(3) { display: inline-flex; }

  .cmd-search { max-width: none; min-width: 120px; }

  /* ── Rails as sheets ────────────────────────────────────────────────── */
  .pw-rail {
    position: absolute; left: 0; right: 0; bottom: 0; top: auto;
    width: 100%;
    /* 62dvh leaves better than a third of the map visible, which is what
       makes this a panel over a map rather than a different screen. */
    height: 62dvh; max-height: 62dvh;
    border: none; border-top: 1px solid var(--ent-line-strong);
    border-radius: var(--ent-sheet-radius) var(--ent-sheet-radius) 0 0;
    box-shadow: 0 -8px 28px rgba(17, 29, 45, 0.22);
    padding-bottom: var(--ent-safe-bottom);
    overflow-y: auto; overscroll-behavior: contain;
    z-index: var(--ent-z-rail);
    transition: transform var(--ent-dur-sheet) var(--ent-ease-sheet);
  }
  .rail-l, .rail-r { width: 100%; }

  /* Collapsed means gone, not a 40px strip. The floating controls on the map
     take over the strip's job at 48px, inside the thumb arc. */
  .pw-rail.is-collapsed {
    width: 100%; height: 62dvh;
    transform: translateY(100%);
    visibility: hidden;
    box-shadow: none;
  }
  .rail-strip { display: none; }

  /* The rail head becomes the sheet head, sticky so the collapse control
     stays reachable however far the layer tree has been scrolled. */
  .rail-head {
    position: sticky; top: 0; z-index: 1;
    background: var(--ent-surface);
    border-bottom: 1px solid var(--ent-line);
  }

  /* ── Floating rail controls ─────────────────────────────────────────── */
  .map-railfabs {
    position: absolute; left: var(--ent-s3);
    bottom: calc(var(--ent-s3) + var(--ent-safe-bottom));
    z-index: 12;
    display: flex; flex-direction: column; gap: var(--ent-s2);
    align-items: flex-start;
  }
  .railfab {
    display: inline-flex; align-items: center; gap: var(--ent-s2);
    min-height: var(--ent-touch-primary); padding: 0 var(--ent-s4);
    border: 1px solid var(--ent-line-strong);
    border-radius: var(--ent-r-pill);
    background: var(--ent-map-panel-bg);
    color: var(--ent-text);
    font-family: var(--ent-font); font-size: var(--ent-fs-sm);
    font-weight: var(--ent-fw-semibold);
    box-shadow: var(--ent-e3);
    cursor: pointer;
  }
  .railfab:active { background: var(--ent-surface-2); }
  .railfab:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
  .railfab-label { white-space: nowrap; }

  /* The basemap chip panel must not run off the edge of a 375px map. */
  .map-filters { max-width: calc(100% - var(--ent-s6)); }
}

/* The sheets travel the full height of the viewport, the largest movement in
   this view, so reduced motion removes the travel rather than compressing it
   into a single frame. */
@media (prefers-reduced-motion: reduce) {
  .pw-rail { transition: none !important; }
}
</style>
