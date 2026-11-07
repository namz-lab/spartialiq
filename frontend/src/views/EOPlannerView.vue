<template>
  <div class="eo-root" :class="{ embedded: props.embedded }">

    <!-- ══ HEADER ══════════════════════════════════════════════════════════ -->
    <header class="eo-header">
      <div v-if="!props.embedded" class="eo-brand">
        <div class="eo-brand-icon"><Shield :size="18" /></div>
        <div>
          <span class="eo-brand-title">Executive Officer Command Centre</span>
          <span class="eo-brand-sub">Vungu RDC · Planning &amp; Environment Department</span>
        </div>
      </div>
      <div class="eo-header-center">
        <div class="eo-datetime">
          <Calendar :size="13" />
          <span>{{ currentDate }}</span>
          <Clock :size="13" style="margin-left:10px" />
          <span>{{ currentTime }}</span>
        </div>
        <div class="eo-alert-strip" v-if="urgentCount > 0">
          <AlertTriangle :size="13" class="pulse-ico" />
          <span>{{ urgentCount }} item{{ urgentCount > 1 ? 's' : '' }} require your immediate attention</span>
        </div>
      </div>
      <button v-if="!props.embedded" class="eo-portal-btn" @click="router.push('/eo-planner-portal')"
              title="Open the new 10-section EO Planner Portal">
        <LayoutGrid :size="14" /><span>EO Planner Portal</span>
      </button>
      <ProfileDropdown
        v-if="!props.embedded"
        role-label="E.O. Planning"
        avatar-key="eo_avatar"
        @logout="goBack"
      />
    </header>

    <!-- ══ KPI STRIP ════════════════════════════════════════════════════════ -->
    <div class="kpi-strip">
      <div class="kpi-card" v-for="kpi in kpis" :key="kpi.label" :class="kpi.cls">
        <div class="kpi-icon"><component :is="kpi.icon" :size="20" /></div>
        <div class="kpi-body">
          <div class="kpi-value">{{ kpi.value }}</div>
          <div class="kpi-label">{{ kpi.label }}</div>
          <div class="kpi-trend" :class="kpi.trendDir">
            <TrendingUp v-if="kpi.trendDir==='up'" :size="11" />
            <TrendingDown v-else-if="kpi.trendDir==='down'" :size="11" />
            <Minus v-else :size="11" />
            {{ kpi.trend }}
          </div>
        </div>
      </div>
    </div>

    <!-- ══ WORKSPACE ════════════════════════════════════════════════════════ -->
    <div class="eo-workspace">

      <!-- ┌── LEFT: Queue & Staff ──────────────────────────────────────────┐ -->
      <aside class="eo-left">

        <!-- Approval Queue -->
        <section class="eo-panel">
          <div class="eo-panel-head">
            <ClipboardCheck :size="14" />
            <span>Approval Action Queue</span>
            <span class="panel-badge urgent">{{ approvalQueue.filter(a=>a.priority==='urgent').length }} urgent</span>
          </div>
          <div class="queue-list">
            <div v-for="item in approvalQueue" :key="item.id" class="queue-item" :class="item.priority"
                 @click="openReview(item)">
              <div class="qi-priority-bar" :class="item.priority"></div>
              <div class="qi-body">
                <div class="qi-title">{{ item.title }}</div>
                <div class="qi-meta">
                  <span class="qi-type">{{ item.type }}</span>
                  <span>·</span>
                  <span>{{ item.ward }}</span>
                  <span>·</span>
                  <span class="qi-days" :class="{ overdue: item.daysWaiting > 14 }">{{ item.daysWaiting }}d waiting</span>
                </div>
                <div class="qi-submitted">Submitted by {{ item.submittedBy }} on {{ item.date }}</div>
              </div>
              <div class="qi-actions">
                <button class="qi-btn determine" type="button"
                        @click.stop="determineInConsole(item.id, item.ref)"
                        title="Open this case in Determination">
                  <Gavel :size="15" /><span class="qi-btn-label">Determine</span>
                </button>
              </div>
            </div>
            <div v-if="approvalQueue.length === 0" class="empty-state">
              <CheckCircle :size="28" style="color:#22c55e;margin-bottom:6px" />
              <p>All items reviewed</p>
            </div>
          </div>
        </section>

        <!-- Staff Workload -->
        <section class="eo-panel">
          <div class="eo-panel-head">
            <Users :size="14" />
            <span>Staff Workload Monitor</span>
          </div>
          <div class="staff-list">
            <div v-if="!staffWorkload.length" class="empty-state">No live cases on any desk yet</div>
            <div v-for="s in staffWorkload" :key="s.name" class="staff-row">
              <div class="staff-avatar" :style="{ background: s.color }">{{ s.initials }}</div>
              <div class="staff-info">
                <div class="staff-name">{{ s.name }}</div>
                <div class="staff-role">{{ s.role }}</div>
              </div>
              <div class="staff-meter">
                <div class="staff-bar-wrap">
                  <div class="staff-bar" :class="s.load" :style="{ width: s.pct + '%' }"></div>
                </div>
                <span class="staff-tasks" :class="s.load">{{ s.tasks }} tasks</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Ward Summary -->
        <section class="eo-panel">
          <div class="eo-panel-head"><Map :size="14" /><span>Ward Activity Summary</span></div>
          <div class="ward-summary-list">
            <div v-if="!wardActivity.length" class="empty-state">No ward activity yet</div>
            <div v-for="w in wardActivity" :key="w.key" class="ward-summary-row">
              <div class="ws-name">{{ w.label }}</div>
              <div class="ws-bars">
                <div class="ws-bar-item" title="Applications">
                  <div class="ws-mini-bar apps" :style="{ width: (w.apps/maxApps*60)+'px' }"></div>
                  <span>{{ w.apps }}</span>
                </div>
                <div class="ws-bar-item" title="Violations">
                  <div class="ws-mini-bar viol" :style="{ width: (w.violations/maxViol*60)+'px' }"></div>
                  <span>{{ w.violations }}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="ws-legend">
            <span><span class="ws-dot apps"></span>Applications</span>
            <span><span class="ws-dot viol"></span>Violations</span>
          </div>
        </section>

        <!-- GIS Layer Switcher -->
        <section class="eo-panel">
          <div class="eo-panel-head">
            <Layers :size="14" />
            <span>GIS Layers</span>
            <span v-if="spatialStore.isLoading" class="layer-loading-badge">loading…</span>
            <span v-else class="layer-count-badge">{{ eoLayers.length }}</span>
          </div>
          <div v-if="eoLayers.length === 0 && !spatialStore.isLoading" class="empty-state">
            No layers available
          </div>
          <div class="eo-layer-list">
            <label v-for="l in eoLayers" :key="l.id" class="eo-layer-row" :class="{ active: layerVisibility[l.id] }">
              <input type="checkbox" :checked="layerVisibility[l.id]" @change="toggleEOLayer(l)" />
              <div class="eo-layer-dot" :style="{ background: l.color }"></div>
              <div class="eo-layer-info">
                <span class="eo-layer-name">{{ l.name }}</span>
                <span class="eo-layer-desc">{{ l.desc }}</span>
              </div>
              <span class="eo-layer-badge" :style="{ background: l.color + '18', color: l.color }">{{ l.type }}</span>
            </label>
          </div>
        </section>

      </aside>

      <!-- ┌── CENTER: Executive Map ───────────────────────────────────────┐ -->
      <div class="eo-center">
        <!-- Quick toggles -->
        <div class="eo-map-controls">
          <div class="map-toggle-group">
            <button v-for="t in mapToggles" :key="t.id"
              class="map-toggle-btn" :class="{ active: t.active }"
              @click="t.active = !t.active; applyMapToggle(t)" :title="t.label">
              <component :is="t.icon" :size="12" />
              <span>{{ t.label }}</span>
            </button>
          </div>
        </div>

        <!-- Map canvas -->
        <div class="eo-map-canvas">
          <div ref="mapContainer" class="map-container"></div>
          <!-- Search / measure / notification radius / map sheet. Imagery is
               off: it is an external tile source and this platform runs on
               council infrastructure. -->
          <MapToolbar :map="mapInstance" :imagery="false" @tool-change="activeMapTool = $event" />

          <!-- "What is here" for the last clicked point. -->
          <div v-if="identifyPoint" class="eo-identify-panel">
            <InspectorIdentifyCard
              :result="identifyResult"
              :loading="identifyLoading"
              :error="identifyError"
              :point="identifyPoint"
              :map-feature="mapFeature"
              @close="clearIdentify"
              @open-case="openCaseFromIdentify"
            />
          </div>
          <div v-if="mapLoading" class="map-overlay-loading">
            <RefreshCw :size="18" class="spin-icon" />
            <span>Loading district map…</span>
          </div>
          <!-- Map key -->
          <div class="heatmap-legend" v-if="toggleOn('sites') || toggleOn('heatmap')">
            <template v-if="toggleOn('sites')">
              <span class="hml-title">Application sites</span>
              <div class="eo-legend-row"><i style="background:#ea580c"></i>Under consideration</div>
              <div class="eo-legend-row"><i style="background:#16a34a"></i>Approved</div>
              <div class="eo-legend-row"><i style="background:#dc2626"></i>Refused or lapsed</div>
              <div v-if="unlocatedCases" class="eo-legend-note">{{ unlocatedCases }} case(s) with no mapped site</div>
              <div v-if="sitesError" class="eo-legend-err">{{ sitesError }}</div>
            </template>
            <template v-if="toggleOn('heatmap')">
              <span class="hml-title" style="margin-top:6px">Application density</span>
              <div class="hml-gradient"></div>
              <div class="hml-labels"><span>Low</span><span>High</span></div>
            </template>
          </div>
          <button class="eo-identify-btn" type="button" @click="identifyCentre"
                  title="Identify what is at the centre of the map">
            <Crosshair :size="14" />
            <span class="eo-sr-only">Identify what is at the centre of the map</span>
          </button>
          <!-- Locate user btn -->
          <button class="eo-locate-btn" :class="{ active: userLocation, locating }" @click="locateUser" title="My Location">
            <LocateFixed :size="14" :class="{ 'spin-icon': locating }" />
          </button>
        </div>

        <!-- Status bar -->
        <div class="eo-statusbar">
          <span><MapPin :size="11" /> {{ cursorCoords }}</span>
          <span><ZoomIn :size="11" /> Zoom {{ mapZoom }}</span>
          <span>CRS: EPSG:4326</span>
          <span>Vungu RDC · Midlands Province · Zimbabwe</span>
          <span v-if="userLocation" class="loc-active"><LocateFixed :size="11" /> Location active</span>
          <span class="eo-status-hint">{{ activeMapTool === 'none' ? 'Click the map to identify a spot' : 'Map tool active' }}</span>
        </div>
      </div>

      <!-- ┌── RIGHT: Executive Modules ────────────────────────────────────┐ -->
      <aside class="eo-right">
        <!-- Tab nav -->
        <div class="eo-tabs">
          <button v-for="t in rightTabs" :key="t.id"
            class="eo-tab" :class="{ active: rightTab===t.id }"
            @click="rightTab=t.id" :title="t.label">
            <component :is="t.icon" :size="13" />
            <span>{{ t.label }}</span>
          </button>
        </div>

        <!-- ── Proposal Review ── -->
        <div v-show="rightTab==='review'" class="eo-tab-body">
          <div class="tab-section-head">Advanced Proposal Review</div>
          <div class="proposal-filter">
            <select v-model="proposalFilter" class="eo-select">
              <option value="all">All Stages</option>
              <option value="awaiting_eo">Awaiting E.O.</option>
              <option value="circulating">Circulating</option>
              <option value="conflict_check">Conflict Check</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
            </select>
          </div>
          <div class="proposal-list">
            <div v-if="!filteredProposals.length" class="empty-state">No applications in this stage</div>
            <div v-for="p in filteredProposals" :key="p.id" class="proposal-card"
                 :class="p.stage" @click="openProposalDetail(p)">
              <div class="pc-header">
                <span class="pc-id">{{ p.ref }}</span>
                <span class="pc-stage" :class="p.stage">{{ stageLabel(p.stage) }}</span>
              </div>
              <div class="pc-title">{{ p.title }}</div>
              <div class="pc-meta">
                <span>{{ p.ward }}</span> · <span>Stand {{ p.stand }}</span> · <span>{{ p.date }}</span>
              </div>
              <div class="pc-flags" v-if="p.flags && p.flags.length">
                <div v-for="f in p.flags" :key="f" class="pc-flag">
                  <AlertTriangle :size="10" /> {{ f }}
                </div>
              </div>
              <div class="pc-actions" @click.stop>
                <button class="pc-btn determine" type="button" @click="determineInConsole(p.id, p.ref)">
                  <Gavel :size="13"/>Determine
                </button>
                <button class="pc-btn survey" type="button" @click="assignSurvey(p)"
                        title="Assign a survey task"><Ruler :size="13"/>Survey</button>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Compliance & Enforcement ── -->
        <div v-show="rightTab==='compliance'" class="eo-tab-body">
          <div class="tab-section-head">Compliance &amp; Environmental Enforcement</div>
          <div class="compliance-stats">
            <div class="cs-card red"><AlertTriangle :size="16" /><span>{{ violations.filter(v=>v.severity==='critical').length }}</span><small>Critical</small></div>
            <div class="cs-card orange"><AlertTriangle :size="16" /><span>{{ violations.filter(v=>v.severity==='high').length }}</span><small>High</small></div>
            <div class="cs-card yellow"><AlertTriangle :size="16" /><span>{{ violations.filter(v=>v.severity==='medium').length }}</span><small>Medium</small></div>
            <div class="cs-card green"><CheckCircle :size="16" /><span>{{ violations.filter(v=>v.resolved).length }}</span><small>Resolved</small></div>
          </div>
          <div class="violation-list">
            <div v-for="v in violations" :key="v.id" class="violation-card" :class="v.severity">
              <div class="vc-head">
                <span class="vc-severity" :class="v.severity">{{ v.severity.toUpperCase() }}</span>
                <span class="vc-id">{{ v.ref }}</span>
                <span class="vc-resolved" v-if="v.resolved">✓ Resolved</span>
              </div>
              <div class="vc-title">{{ v.description }}</div>
              <div class="vc-meta">{{ v.ward }} · {{ v.date }} · {{ v.reporter }}</div>
              <div class="vc-actions" v-if="!v.resolved">
                <button class="vc-btn stop-work" @click="issueStopWork(v)"><Ban :size="12"/>Stop Work</button>
                <button class="vc-btn fine" @click="issueFine(v)"><DollarSign :size="12"/>Issue Fine</button>
                <button class="vc-btn resolve" @click="resolveViolation(v)"><CheckCircle :size="12"/>Resolve</button>
              </div>
            </div>
          </div>

          <!-- Citizen Portal Reports (all types) -->
          <div class="tab-section-head" style="margin-top:16px">
            Public building reports
            <span class="panel-badge" style="margin-left:6px">{{ citizenReportsQueue.length }}</span>
            <span v-if="citizenReportsLoading" style="font-size:0.7rem;color:#94a3b8;margin-left:6px">loading…</span>
          </div>
          <div v-if="citizenReportsError" class="empty-state" role="alert">
            <AlertTriangle :size="22" style="color:#b45309;margin-bottom:4px" />
            <p>{{ citizenReportsError }}</p>
          </div>
          <div v-else-if="citizenReportsQueue.length === 0 && !citizenReportsLoading" class="empty-state">
            <CheckCircle :size="22" style="color:#22c55e;margin-bottom:4px" />
            <p>No open public building reports</p>
            <p style="font-size:0.72rem;color:#94a3b8;margin-top:4px">Live from <code>/api/building-complaints</code>. Empty until citizens lodge a report.</p>
          </div>
          <div class="cr-list">
            <div v-for="cr in citizenReportsQueue" :key="cr.id" class="cr-card"
                 :class="{ 'cr-actioned': ['actioned','closed'].includes(cr.status) }">
              <div class="cr-head">
                <span class="cr-type">{{ REPORT_TYPE_LABELS[cr.report_type] ?? cr.report_type }}</span>
                <span class="cr-status" :class="cr.status">{{ cr.status.replace(/_/g,' ') }}</span>
              </div>
              <div class="cr-summary">{{ cr.summary ?? '—' }}</div>
              <div class="cr-meta">
                {{ cr.ward ?? 'Unknown Ward' }} ·
                {{ new Date(cr.created_at).toLocaleDateString('en-ZW',{day:'2-digit',month:'short',year:'numeric'}) }} ·
                {{ cr.citizen_name ?? cr.citizen_email ?? 'Citizen' }}
                <span v-if="cr.ref_no" class="cr-ref">{{ cr.ref_no }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Report Generator ── -->
        <div v-show="rightTab==='reports'" class="eo-tab-body">
          <div class="tab-section-head">Dynamic Report Generator</div>
          <div class="report-form">
            <label class="rf-label">Report Type</label>
            <select v-model="reportConfig.type" class="eo-select">
              <option value="monthly">Monthly Summary</option>
              <option value="quarterly">Quarterly Report</option>
              <option value="annual">Annual Review</option>
              <option value="ward">Ward-Specific Report</option>
              <option value="compliance">Compliance & Enforcement</option>
              <option value="revenue">Revenue Report</option>
              <option value="masterplan">Master Plan Progress</option>
            </select>
            <label class="rf-label">Period</label>
            <div class="rf-row">
              <input type="date" v-model="reportConfig.from" class="eo-input" />
              <span style="color:#94a3b8">to</span>
              <input type="date" v-model="reportConfig.to" class="eo-input" />
            </div>
            <label class="rf-label">Scope</label>
            <select v-model="reportConfig.ward" class="eo-select">
              <option value="all">All Wards</option>
              <option v-for="w in wards" :key="w.id" :value="w.id">Ward {{ w.id }} — {{ w.name }}</option>
            </select>
            <label class="rf-label">Include</label>
            <div class="rf-checkboxes">
              <label v-for="opt in reportOptions" :key="opt.id" class="rf-check">
                <input type="checkbox" v-model="opt.checked" /> {{ opt.label }}
              </label>
            </div>
            <div class="rf-export-btns">
              <button class="rf-btn pdf" @click="generateReport('pdf')"><FileText :size="14"/>Export PDF</button>
              <button class="rf-btn excel" @click="generateReport('excel')"><Table2 :size="14"/>Export Excel</button>
              <button class="rf-btn print" @click="generateReport('print')"><Printer :size="14"/>Print</button>
            </div>
          </div>
          <div class="report-history">
            <div class="tab-section-head" style="margin-top:12px">Recent Reports</div>
            <div v-for="r in recentReports" :key="r.id" class="rh-row">
              <FileText :size="13" :style="{ color: r.format==='pdf' ? '#ef4444' : '#22c55e' }" />
              <div class="rh-info">
                <span class="rh-title">{{ r.title }}</span>
                <span class="rh-meta">{{ r.date }} · {{ r.format.toUpperCase() }}</span>
              </div>
              <button class="rh-dl" @click="downloadReport(r)" title="Download"><Download :size="13"/></button>
            </div>
          </div>
        </div>

        <!-- ── Audit Trail ── -->
        <div v-show="rightTab==='audit'" class="eo-tab-body">
          <div class="tab-section-head">System Audit Trail</div>
          <div class="audit-search">
            <Search :size="13" />
            <input v-model="auditSearch" class="eo-input" placeholder="Search parcel, stand, user…" />
          </div>
          <div class="audit-list">
            <div v-for="entry in filteredAudit" :key="entry.id" class="audit-entry">
              <div class="ae-icon" :class="entry.action">
                <CheckCircle v-if="entry.action==='approved'" :size="13"/>
                <XCircle     v-else-if="entry.action==='rejected'" :size="13"/>
                <Edit3       v-else-if="entry.action==='modified'" :size="13"/>
                <PlusCircle  v-else-if="entry.action==='created'" :size="13"/>
                <DollarSign  v-else-if="entry.action==='fine'" :size="13"/>
                <Ban         v-else-if="entry.action==='stopwork'" :size="13"/>
                <Activity    v-else :size="13"/>
              </div>
              <div class="ae-body">
                <div class="ae-title">{{ entry.description }}</div>
                <div class="ae-meta">{{ entry.user }} · {{ entry.timestamp }}</div>
                <div class="ae-ref" v-if="entry.ref">Ref: {{ entry.ref }}</div>
              </div>
              <span class="ae-action-label" :class="entry.action">{{ entry.action }}</span>
            </div>
          </div>
        </div>

        <!-- ── Master Plan ── -->
        <div v-show="rightTab==='masterplan'" class="eo-tab-body">
          <div class="tab-section-head">Master Plan Management</div>
          <div class="mp-progress-header">
            <div class="mp-overall">
              <span class="mp-pct">{{ overallMPProgress }}%</span>
              <span class="mp-label">Overall District Plan Realised</span>
            </div>
            <div class="mp-donut-wrap">
              <svg viewBox="0 0 36 36" class="mp-donut">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1e293b" stroke-width="3"/>
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#3b82f6" stroke-width="3"
                  stroke-dasharray="100" :stroke-dashoffset="100 - overallMPProgress"
                  stroke-linecap="round" transform="rotate(-90 18 18)"/>
              </svg>
            </div>
          </div>
          <div class="mp-plan-list">
            <div v-if="!masterPlans.length" class="empty-state">Master-plan progress dataset not available yet</div>
            <div v-for="plan in masterPlans" :key="plan.id" class="mp-plan-card" :class="{ active: plan.active }">
              <div class="mpc-head">
                <span class="mpc-name">{{ plan.name }}</span>
                <span class="mpc-year">{{ plan.horizon }}</span>
                <span class="mpc-status" :class="plan.status">{{ plan.status }}</span>
              </div>
              <div class="mpc-desc">{{ plan.description }}</div>
              <div class="mpc-bar-wrap">
                <div class="mpc-bar" :style="{ width: plan.progress + '%', background: plan.color }"></div>
              </div>
              <div class="mpc-footer">
                <span>{{ plan.progress }}% complete</span>
                <span>{{ plan.wards.join(', ') }}</span>
              </div>
              <div class="mpc-deviation" v-if="plan.deviation">
                <AlertTriangle :size="11" /> {{ plan.deviation }}
              </div>
            </div>
          </div>
        </div>

        <!-- ── Zones Management ── -->
        <div v-show="rightTab==='zones'" class="eo-tab-body zones-tab">
          <div class="tab-section-head" style="display:flex;align-items:center;justify-content:space-between">
            <span>Planning Zones</span>
            <button class="eo-mini-btn" @click="loadZones" title="Refresh zones list">
              <RefreshCw :size="11" :class="{ 'spin-icon': zonesLoading }" />
            </button>
          </div>

          <div v-if="zonesLoading" class="zones-loading">
            <RefreshCw :size="14" class="spin-icon" /> Loading zones…
          </div>
          <div v-else-if="zonesError" class="zones-error">{{ zonesError }}</div>
          <div v-else-if="!zonesList.length" class="zones-empty">
            No zones loaded. Make sure the backend is running.
          </div>

          <!-- Zone list -->
          <div v-else class="zones-list">
            <div v-for="z in zonesList" :key="z.id"
              class="zone-row" :class="{ selected: selectedZone?.id === z.id, inactive: !z.isActive }"
              @click="selectZone(z)">
              <div class="zone-row-body">
                <span class="zone-name">{{ z.zone }}</span>
                <span class="zone-type-badge">{{ z.zoneType || z.scaleCategory || '—' }}</span>
              </div>
              <div class="zone-row-meta">
                <span>{{ z.ward || 'All wards' }}</span>
                <span v-if="z.areaHa">{{ Number(z.areaHa).toFixed(1) }} ha</span>
                <span class="zone-status" :class="z.isActive ? 'active' : 'inactive'">
                  {{ z.isActive ? 'active' : 'inactive' }}
                </span>
              </div>
            </div>
          </div>

          <!-- Selected zone detail -->
          <div v-if="selectedZone" class="zone-detail">
            <div class="zone-detail-head">
              <strong>{{ selectedZone.zone }}</strong>
              <div class="zone-detail-actions">
                <button class="eo-mini-btn" @click="openZoneEdit(selectedZone)" title="Edit zone">
                  <PenLine :size="11" /> Edit
                </button>
                <button class="eo-mini-btn danger" @click="deactivateZone(selectedZone.id, selectedZone.zone)" title="Deactivate">
                  <Trash2 :size="11" />
                </button>
              </div>
            </div>
            <div class="zone-meta-grid">
              <div><span>Type</span><strong>{{ selectedZone.zoneType || '—' }}</strong></div>
              <div><span>Scale</span><strong>{{ selectedZone.scaleCategory || '—' }}</strong></div>
              <div><span>Ward</span><strong>{{ selectedZone.ward || 'All' }}</strong></div>
              <div><span>Authority</span><strong>{{ selectedZone.authority || '—' }}</strong></div>
            </div>

            <!-- Land-use controls -->
            <div class="controls-head">
              <span>Land-Use Controls ({{ zoneControls.length }})</span>
              <button class="eo-mini-btn" @click="newControlDialog.zoneId = selectedZone.id; newControlDialog.open = true"
                title="Add land-use control">+ Add</button>
            </div>
            <div v-if="zoneControlsLoading" class="zones-loading">Loading controls…</div>
            <div v-else class="controls-list">
              <div v-for="c in zoneControls" :key="c.id"
                class="control-row" :class="c.control_type">
                <span class="ct-badge" :class="c.control_type">{{ c.control_type.replace('_', ' ') }}</span>
                <span class="ct-name">{{ c.group_code }} — {{ c.description }}</span>
                <button class="ct-del" @click="removeZoneControl(selectedZone.id, c.id)" title="Remove">
                  <X :size="10" />
                </button>
              </div>
              <div v-if="!zoneControls.length" class="zones-empty">No controls defined</div>
            </div>
          </div>
        </div>

      </aside>
    </div>

    <!-- ══ ZONE EDIT MODAL ════════════════════════════════════════════════════ -->
    <Teleport to="body">
      <div v-if="zoneEditDialog.open" class="modal-backdrop" @click.self="zoneEditDialog.open=false">
        <div class="zone-modal">
          <div class="rm-head">
            <h3>Edit Zone — {{ zoneEditDialog.zone }}</h3>
            <button @click="zoneEditDialog.open=false"><X :size="16"/></button>
          </div>
          <div class="rm-body" style="display:flex;flex-direction:column;gap:10px">
            <div class="rf-row">
              <label class="rf-label">Zone Name</label>
              <input v-model="zoneEditDialog.zone" class="eo-input" />
            </div>
            <div class="rf-row">
              <label class="rf-label">Zone Code</label>
              <input v-model="zoneEditDialog.zoneCode" class="eo-input" placeholder="e.g. PUZ-01" />
            </div>
            <div class="rf-row">
              <label class="rf-label">Zone Type</label>
              <input v-model="zoneEditDialog.zoneType" class="eo-input" placeholder="e.g. Proposed Peri-Urban Zone" />
            </div>
            <div class="rf-row">
              <label class="rf-label">Scale Category</label>
              <select v-model="zoneEditDialog.scaleCategory" class="eo-select">
                <option value="small_scale">Small Scale</option>
                <option value="mixed_scale">Mixed Scale</option>
                <option value="large_scale">Large Scale</option>
              </select>
            </div>
            <div class="rf-row">
              <label class="rf-label">Ward</label>
              <input v-model="zoneEditDialog.ward" class="eo-input" placeholder="Ward name (leave blank = all wards)" />
            </div>
            <div class="rf-row">
              <label class="rf-label">Authority</label>
              <input v-model="zoneEditDialog.authority" class="eo-input" />
            </div>
            <div class="rf-row">
              <label class="rf-label">Description</label>
              <textarea v-model="zoneEditDialog.description" class="rm-comment" rows="2" />
            </div>
            <div class="rf-row" style="flex-direction:row;align-items:center;gap:8px">
              <input type="checkbox" v-model="zoneEditDialog.isActive" id="zone-active" />
              <label for="zone-active" class="rf-label" style="margin:0">Zone is active</label>
            </div>
          </div>
          <div class="rm-footer">
            <button class="rm-btn approve" :disabled="zoneEditDialog.saving" @click="saveZoneEdit">
              <RefreshCw v-if="zoneEditDialog.saving" :size="13" class="spin-icon" />
              {{ zoneEditDialog.saving ? 'Saving…' : 'Save Changes' }}
            </button>
            <button class="rm-btn cancel" @click="zoneEditDialog.open=false">Cancel</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ══ ADD LAND-USE CONTROL MODAL ════════════════════════════════════════ -->
    <Teleport to="body">
      <div v-if="newControlDialog.open" class="modal-backdrop" @click.self="newControlDialog.open=false">
        <div class="zone-modal">
          <div class="rm-head">
            <h3>Add Land-Use Control</h3>
            <button @click="newControlDialog.open=false"><X :size="16"/></button>
          </div>
          <div class="rm-body" style="display:flex;flex-direction:column;gap:10px">
            <div class="rf-row">
              <label class="rf-label">Control Type</label>
              <select v-model="newControlDialog.controlType" class="eo-select">
                <option value="permitted">Permitted</option>
                <option value="special_consent">Special Consent</option>
                <option value="prohibited">Prohibited</option>
              </select>
            </div>
            <div class="rf-row">
              <label class="rf-label">Land Use Group</label>
              <select v-model="newControlDialog.landUseGroupId" class="eo-select">
                <option value="" disabled>— select —</option>
                <option v-for="g in landUseGroups" :key="g.group_id || g.id" :value="g.group_id || g.id">
                  {{ g.group_code }} — {{ g.description }}
                </option>
              </select>
            </div>
            <div class="rf-row">
              <label class="rf-label">Notes</label>
              <textarea v-model="newControlDialog.notes" class="rm-comment" rows="2" placeholder="Optional conditions or notes…" />
            </div>
          </div>
          <div class="rm-footer">
            <button class="rm-btn approve" :disabled="newControlDialog.saving || !newControlDialog.landUseGroupId" @click="addControl">
              <RefreshCw v-if="newControlDialog.saving" :size="13" class="spin-icon" />
              {{ newControlDialog.saving ? 'Saving…' : 'Add Control' }}
            </button>
            <button class="rm-btn cancel" @click="newControlDialog.open=false">Cancel</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ══ PROPOSAL DETAIL MODAL ════════════════════════════════════════════ -->
    <Teleport to="body">
      <div v-if="reviewModal" class="modal-backdrop" @click.self="reviewModal=null">
        <div class="review-modal">
          <div class="rm-head">
            <h3>Proposal Review — {{ reviewModal.ref ?? reviewModal.id }}</h3>
            <button @click="reviewModal=null"><X :size="16"/></button>
          </div>
          <div class="rm-body">
            <div class="rm-title">{{ reviewModal.title }}</div>
            <div class="rm-meta">
              <span>{{ reviewModal.ward }}</span> · <span>Stand {{ reviewModal.stand }}</span> · <span>{{ reviewModal.date }}</span>
            </div>
            <!-- Site checks from the registers (GET /inspector/permits/:id/site-report):
                 position and its precision, zoning and land-use controls, constraints
                 with distances, road access, mapped structures and coverage, adjoining
                 stands and nearby cases. It replaces three stock sentences that said
                 "no environmental concerns", "beacons set" and "road access confirmed"
                 whether or not anyone had looked. -->
            <div class="rm-site">
              <div class="rm-overlay-title">
                <Layers :size="13"/> Site checks
                <button type="button" class="eo-mini-btn rm-locate" @click="locateCase(reviewModal.id)">
                  <MapPin :size="11" /> Show on map
                </button>
              </div>
              <InspectorSiteReport :permit-id="reviewModal.id" @open-permit="openCaseFromIdentify" />
            </div>
            <div v-if="reviewModal.envNote || reviewModal.surveyNote || reviewModal.infraNote" class="rm-notes">
              <p v-if="reviewModal.envNote"><strong>Environment</strong> {{ reviewModal.envNote }}</p>
              <p v-if="reviewModal.surveyNote"><strong>Survey</strong> {{ reviewModal.surveyNote }}</p>
              <p v-if="reviewModal.infraNote"><strong>Infrastructure</strong> {{ reviewModal.infraNote }}</p>
            </div>
            <div class="rm-comment-wrap">
              <label class="rf-label">E.O. Decision Notes</label>
              <textarea v-model="reviewModal.eoComment" class="rm-comment" rows="3" placeholder="Add your decision notes or conditions of approval…"></textarea>
            </div>
          </div>
          <div class="rm-footer">
            <p class="rm-note">
              The determination itself — conditions, reasons and the decision letter —
              is made in the console, on the full decision package.
            </p>
            <button class="rm-btn determine" type="button"
                    @click="determineInConsole(reviewModal.id, reviewModal.ref)">
              <Gavel :size="14"/> Open in Determination
            </button>
            <button class="rm-btn cancel" type="button" @click="reviewModal=null">Close</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ══ STOP WORK / FINE MODAL ══════════════════════════════════════════ -->
    <Teleport to="body">
      <div v-if="enforcementModal" class="modal-backdrop" @click.self="enforcementModal=null">
        <div class="enforcement-modal">
          <div class="rm-head">
            <h3>{{ enforcementModal.actionType === 'stopwork' ? 'Issue Stop Work Order' : 'Issue Environmental Fine' }}</h3>
            <button @click="enforcementModal=null"><X :size="16"/></button>
          </div>
          <div class="rm-body">
            <div class="rm-title">{{ enforcementModal.violation?.description }}</div>
            <div class="rm-meta">{{ enforcementModal.violation?.ward }} · {{ enforcementModal.violation?.date }}</div>
            <label class="rf-label" style="margin-top:14px">
              {{ enforcementModal.actionType === 'stopwork' ? 'Reason for Stop Work Order' : 'Fine Amount (USD)' }}
            </label>
            <input v-if="enforcementModal.actionType==='fine'" v-model="enforcementModal.amount"
              type="number" class="eo-input" placeholder="0.00" style="width:100%" />
            <textarea v-else v-model="enforcementModal.reason" class="rm-comment" rows="3"
              placeholder="State the grounds for stopping work…"></textarea>
            <label class="rf-label" style="margin-top:10px">Reference Number</label>
            <input v-model="enforcementModal.ref" class="eo-input" style="width:100%"
              :placeholder="enforcementModal.actionType==='stopwork' ? 'SWO-2026-XXX' : 'EF-2026-XXX'" />
          </div>
          <div class="rm-footer">
            <button class="rm-btn reject" @click="confirmEnforcement">
              <Ban v-if="enforcementModal.actionType==='stopwork'" :size="14"/>
              <DollarSign v-else :size="14"/>
              {{ enforcementModal.actionType === 'stopwork' ? 'Issue Stop Work Order' : 'Confirm Fine' }}
            </button>
            <button class="rm-btn cancel" @click="enforcementModal=null">Cancel</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ══ TOAST ══════════════════════════════════════════════════════════ -->
    <Teleport to="body">
      <Transition name="toast">
        <div v-if="toast" class="eo-toast" :class="toast.type">
          <component :is="toast.type==='success' ? CheckCircle : toast.type==='error' ? XCircle : AlertTriangle" :size="14"/>
          {{ toast.msg }}
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSpatialStore } from '@/stores/spatial'
import { dmApi } from '@/services/developmentManagementService'
import api from '@/services/api'
import { complaintsApi, COMPLAINT_CATEGORY_LABELS } from '@/services/buildingComplaints'
import { useEoCommandCentre, parseWard } from '@/composables/useEoCommandCentre'
import jsPDF from 'jspdf'
import { addVunguBasemap, setBasemapLayerVisible, DEFAULT_VISIBLE, prefersReducedMotion } from '@/map/vunguBasemap'
import { chipColorFor } from '@/map/vunguBasemapStyle'
import { escapeHtml } from '@/utils/escapeHtml'
import { surveyorApi } from '@/services/surveyor'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Shield, Calendar, Clock, AlertTriangle, TrendingUp, TrendingDown, Minus,
  ClipboardCheck, Users, Map, CheckCircle, XCircle, Ban, DollarSign,
  Search, Edit3, PlusCircle, Activity, FileText, Table2, Printer, Download,
  Layers, TreePine, Ruler, MapPin, ZoomIn, LocateFixed, RefreshCw,
  X, ClipboardList, BookOpen, PenLine, LayoutGrid, Trash2, Gavel, Crosshair,
} from 'lucide-vue-next'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import MapToolbar from '@/components/map/MapToolbar.vue'
import InspectorIdentifyCard from '@/components/inspector/InspectorIdentifyCard.vue'
import InspectorSiteReport from '@/components/inspector/InspectorSiteReport.vue'
import { inspectorGis, type IdentifyResult } from '@/services/inspectorGis'
import { useInspectorSites } from '@/composables/useInspectorSites'
import { featureAtPoint, type ClickedFeature } from '@/map/featureAtPoint'

// `embedded` hides this console's own brand block, profile menu and the
// navigate-to-workspace button when it is hosted as the map pane of
// RoleWorkspaceShell (which supplies that chrome). Every working control —
// search, map tools, refresh, alert strip — is kept.
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

// Asks the workspace shell to show the console pane — used when a case is
// handed to Determination, so the officer lands on the screen they were sent to.
const emit = defineEmits<{ 'open-console': [] }>()


const router    = useRouter()
const route     = useRoute()
const authStore    = useAuthStore()
const spatialStore = useSpatialStore()

// ── GIS layers — the canonical PostGIS vector-tile basemap (the same 24
//    layers the home/explorer pages use). addVunguBasemap() adds them all on
//    map load; the panel below just toggles their visibility. ──────────────
const layerVisibility = reactive<Record<string, boolean>>({})

const eoLayers = computed(() =>
  spatialStore.tileLayers.map(l => ({
    id:    l.id,
    name:  l.title,
    desc:  l.group.replace(/_/g, ' '),
    color: chipColorFor(l.id, l.geomType),
    type:  l.geomType,
  }))
)

// Toggle a tile layer on the map (addVunguBasemap already added every layer;
// toggleTileLayer flips visibility via setBasemapLayerVisible).
function toggleEOLayer(l: { id: string; name: string }) {
  const map = mapInstance.value
  if (!map) return
  spatialStore.toggleTileLayer(map, l.id)
  layerVisibility[l.id] = spatialStore.visibleTileLayers.has(l.id)
  showToast(`${l.name} ${layerVisibility[l.id] ? 'shown' : 'hidden'}`)
}

// ── Date / Time ──────────────────────────────────────────────────────────────
const currentDate = ref('')
const currentTime = ref('')
function updateClock() {
  const now = new Date()
  currentDate.value = now.toLocaleDateString('en-ZW', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
  currentTime.value = now.toLocaleTimeString('en-ZW', { hour:'2-digit', minute:'2-digit' })
}
updateClock()
const clockTimer = setInterval(updateClock, 60000)

// ── EO Command Centre data — real, via dmApi (permits + enforcement) ───────
const eo = useEoCommandCentre()
const apiLoading = computed(() => eo.loading.value)

// KPI cards. Real figures from the permit + enforcement spine; Revenue and
// Stands-allocated have no backend feed yet, so they show an honest dash.
const kpis = computed(() => {
  const m = eo.metrics.value
  return [
    { label:'Revenue This Month',       value:'—', icon: DollarSign,    cls:'kpi-revenue', trend:'Awaiting payments summary API', trendDir:'neutral' },
    { label:'Avg. Turnaround (days)',   value: m.avgTurnaroundDays != null ? String(m.avgTurnaroundDays) : '—', icon: Clock, cls:'kpi-time', trend:'received → decision', trendDir:'neutral' },
    { label:'Active Projects',          value: String(m.activeProjects), icon: Activity, cls:'kpi-active', trend:'Undetermined applications', trendDir:'neutral' },
    { label:'Pending Approvals',        value: String(m.pendingApprovals), icon: ClipboardList, cls:'kpi-pending', trend:'Awaiting EO action', trendDir:'neutral' },
    { label:'Environmental Violations', value: String(m.envViolations), icon: AlertTriangle, cls:'kpi-viol', trend:'Open enforcement orders', trendDir:'neutral' },
    { label:'Stands Allocated (YTD)',   value:'—', icon: MapPin, cls:'kpi-stands', trend:'Awaiting stands register API', trendDir:'neutral' },
  ]
})

// Real approval queue + urgency, derived from permits needing EO action.
const approvalQueue = eo.queue
const urgentCount = eo.urgentCount
const staffWorkload = eo.staffWorkload

// Ward activity grouped from real permits + enforcement by suburb_ward.
const wardActivity = eo.wardActivity
const maxApps = computed(() => Math.max(1, ...wardActivity.value.map(w => w.apps)))
const maxViol = computed(() => Math.max(1, ...wardActivity.value.map(w => w.violations)))

// ── Proposals — real permits mapped to review cards ────────────────────────
const proposals = eo.proposals
const proposalFilter = ref('all')
const filteredProposals = computed(() =>
  proposalFilter.value === 'all'
    ? proposals.value
    : proposals.value.filter(p => p.stage === proposalFilter.value)
)
function stageLabel(s: string) {
  const map: Record<string,string> = {
    awaiting_eo:'Awaiting E.O.', circulating:'Circulating', conflict_check:'Conflict Check',
    draft:'Draft', approved:'Approved', rejected:'Rejected', revision:'Revision'
  }
  return map[s] || s
}

// ── Violations — real enforcement orders (spatial_planning.enforcement_order) ─
const violations = eo.violations

// ── Reports ────────────────────────────────────────────────────────────────
const reportConfig = reactive({
  type: 'monthly',
  from: '2026-03-01',
  to: '2026-03-31',
  ward: 'all',
})
const reportOptions = ref([
  { id:'map',       label:'Spatial Map Snapshot', checked:true  },
  { id:'stands',    label:'Stands Allocated',      checked:true  },
  { id:'revenue',   label:'Revenue Collected',     checked:true  },
  { id:'violations',label:'Violations & Orders',   checked:true  },
  { id:'proposals', label:'Proposals & Approvals', checked:true  },
  { id:'staff',     label:'Staff Workload',         checked:false },
  { id:'kpi',       label:'KPI Dashboard',         checked:false },
])
// Reports are produced entirely client-side from the data already loaded into
// the command centre (the permit + enforcement spine and the KPI metrics) — no
// backend report engine needed, mirroring planner/sections/ReportsSection.vue.
interface RecentReport {
  id: number; title: string; date: string; format: string
  blobUrl?: string; filename?: string; reprint?: () => void
}
const recentReports = ref<RecentReport[]>([])

const REPORT_TITLES: Record<string, string> = {
  monthly: 'Monthly Summary', quarterly: 'Quarterly Report', annual: 'Annual Review',
  ward: 'Ward-Specific Report', compliance: 'Compliance & Enforcement',
  revenue: 'Revenue Report', masterplan: 'Master Plan Progress',
}

// Period + ward filter over the raw permit/enforcement spine the composable holds.
function reportData() {
  const from = reportConfig.from ? new Date(reportConfig.from).getTime() : null
  const to   = reportConfig.to ? new Date(reportConfig.to + 'T23:59:59').getTime() : null
  const wardSel = reportConfig.ward
  const wardMatch = (sw: string | null | undefined) =>
    wardSel === 'all' || parseWard(sw).key === `w${wardSel}`
  const inPeriod = (iso: string | null | undefined) => {
    const t = iso ? new Date(iso).getTime() : null
    if (from != null && (t == null || t < from)) return false
    if (to != null && (t == null || t > to)) return false
    return true
  }
  const permits = eo.permits.value.filter(p => inPeriod(p.received_at || p.created_at) && wardMatch(p.suburb_ward))
  const enforcement = eo.enforcement.value.filter(e => inPeriod(e.issued_at) && wardMatch(e.suburb_ward))
  return { permits, enforcement }
}

// Aggregate model the three renderers share, honouring the "Include" checkboxes.
function buildReportModel() {
  const { permits, enforcement } = reportData()
  const want = (id: string) => reportOptions.value.find(o => o.id === id)?.checked ?? false
  const tally = (arr: any[], key: (x: any) => string): [string, number][] => {
    const m: Record<string, number> = {}
    for (const x of arr) { const k = key(x) || '—'; m[k] = (m[k] || 0) + 1 }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }
  const m = eo.metrics.value
  return {
    title: REPORT_TITLES[reportConfig.type] ?? 'Report',
    periodLabel: `${reportConfig.from || '—'} to ${reportConfig.to || '—'}`,
    scopeLabel: reportConfig.ward === 'all' ? 'All Wards' : `Ward ${reportConfig.ward}`,
    totals: {
      received: permits.length,
      approved: permits.filter(p => p.status === 'approved' || p.status === 'approved_with_conditions' || p.status === 'conditionally_approved').length,
      refused: permits.filter(p => p.status === 'refused' || p.status === 'lapsed').length,
      enforcement: enforcement.length,
    },
    kpi: want('kpi') ? ([
      ['Pending approvals', String(m.pendingApprovals)],
      ['Active projects', String(m.activeProjects)],
      ['Environmental violations', String(m.envViolations)],
      ['Avg. turnaround (days)', m.avgTurnaroundDays != null ? String(m.avgTurnaroundDays) : '—'],
    ] as [string, string][]) : null,
    byStatus: tally(permits, p => String(p.status).replace(/_/g, ' ')),
    byType: want('proposals') ? tally(permits, p => p.development_type) : null,
    byWard: tally(permits, p => parseWard(p.suburb_ward).label),
    violations: want('violations')
      ? enforcement.map(e => [e.order_reference, parseWard(e.suburb_ward).label, e.status, e.breach_description || e.required_action || '—'] as [string, string, string, string])
      : null,
    gaps: ([
      want('map') ? 'Spatial map snapshot' : null,
      want('stands') ? 'Stands allocated' : null,
      want('revenue') ? 'Revenue collected' : null,
      want('staff') ? 'Staff workload' : null,
    ].filter(Boolean)) as string[],
    generatedAt: new Date().toLocaleString('en-ZW'),
  }
}
type ReportModel = ReturnType<typeof buildReportModel>

function reportFilenameBase() {
  return `${reportConfig.type}-report-${reportConfig.from || 'all'}_${reportConfig.to || 'all'}`
}

function trackRecent(entry: Omit<RecentReport, 'id' | 'date'>) {
  recentReports.value.unshift({
    id: Date.now(),
    date: new Date().toLocaleString('en-ZW', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    ...entry,
  })
}

function downloadBlob(blob: Blob, filename: string): string {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  return url // retained so Recent Reports can re-download; revoked on unmount
}

function generatePdf(model: ReportModel): Blob {
  const doc = new jsPDF()
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  let y = 16
  const line = (text: string, o: { bold?: boolean; size?: number } = {}) => {
    if (y > pageH - 14) { doc.addPage(); y = 16 }
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal')
    doc.setFontSize(o.size ?? 10)
    doc.text(text, 14, y); y += 6
  }
  const divider = () => { doc.setDrawColor(226, 232, 240); doc.line(14, y, pageW - 14, y); y += 4 }

  line(model.title.toUpperCase(), { bold: true, size: 15 })
  line('Vungu RDC · Planning & Environment Department', { size: 9 })
  line(`Period: ${model.periodLabel}   ·   Scope: ${model.scopeLabel}`, { size: 9 })
  y += 2; divider()

  line('Summary', { bold: true, size: 11 })
  line(`Applications received: ${model.totals.received}`)
  line(`Approved (incl. conditional): ${model.totals.approved}`)
  line(`Refused: ${model.totals.refused}`)
  line(`Enforcement orders: ${model.totals.enforcement}`)
  y += 2; divider()

  if (model.kpi) {
    line('KPI dashboard', { bold: true, size: 11 })
    for (const [k, v] of model.kpi) line(`  ${k.padEnd(30)} ${v}`)
    y += 2; divider()
  }

  line('Breakdown by status', { bold: true, size: 11 })
  if (model.byStatus.length) for (const [k, v] of model.byStatus) line(`  ${k.padEnd(30)} ${v}`)
  else line('  (no applications in period)')
  y += 2; divider()

  if (model.byType) {
    line('Breakdown by development type', { bold: true, size: 11 })
    for (const [k, v] of model.byType) line(`  ${k.padEnd(30)} ${v}`)
    y += 2; divider()
  }

  line('Breakdown by ward', { bold: true, size: 11 })
  if (model.byWard.length) for (const [k, v] of model.byWard) line(`  ${k.padEnd(30)} ${v}`)
  else line('  (no applications in period)')

  if (model.violations) {
    y += 2; divider()
    line('Violations & enforcement orders', { bold: true, size: 11 })
    if (model.violations.length) for (const [refNo, ward, status, desc] of model.violations) {
      line(`  ${refNo}  ·  ${ward}  ·  ${status}`)
      line(`     ${String(desc).slice(0, 90)}`, { size: 9 })
    } else line('  (no enforcement orders in period)')
  }

  if (model.gaps.length) {
    y += 2; divider()
    line('Sections without a data feed (omitted):', { bold: true, size: 9 })
    line(`  ${model.gaps.join(', ')}`, { size: 9 })
  }

  y += 4
  line(`Compiled: ${model.generatedAt}`, { size: 9 })
  return doc.output('blob')
}

function buildCsv(model: ReportModel): string {
  const esc = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  const rows: string[] = []
  rows.push(esc(`${model.title} — ${model.scopeLabel} — ${model.periodLabel}`))
  rows.push('')
  rows.push('metric,value')
  rows.push(`received,${model.totals.received}`)
  rows.push(`approved,${model.totals.approved}`)
  rows.push(`refused,${model.totals.refused}`)
  rows.push(`enforcement,${model.totals.enforcement}`)
  if (model.kpi) { rows.push(''); rows.push('kpi,value'); for (const [k, v] of model.kpi) rows.push(`${esc(k)},${esc(v)}`) }
  rows.push(''); rows.push('status,count'); for (const [k, v] of model.byStatus) rows.push(`${esc(k)},${v}`)
  if (model.byType) { rows.push(''); rows.push('dev_type,count'); for (const [k, v] of model.byType) rows.push(`${esc(k)},${v}`) }
  rows.push(''); rows.push('ward,count'); for (const [k, v] of model.byWard) rows.push(`${esc(k)},${v}`)
  if (model.violations) {
    rows.push(''); rows.push('order_ref,ward,status,breach')
    for (const cols of model.violations) rows.push(cols.map(x => esc(String(x))).join(','))
  }
  return rows.join('\n')
}

function buildPrintHtml(model: ReportModel): string {
  const rows2 = (pairs: [string, string | number][]) =>
    pairs.map(([k, v]) => `<tr><td>${escapeHtml(String(k))}</td><td class="num">${escapeHtml(String(v))}</td></tr>`).join('')
  const section = (title: string, pairs: [string, string | number][] | null) =>
    pairs ? `<h2>${escapeHtml(title)}</h2><table>${rows2(pairs)}</table>` : ''
  const violationRows = model.violations
    ? `<h2>Violations &amp; enforcement orders</h2><table>
        <tr><th>Ref</th><th>Ward</th><th>Status</th><th>Breach</th></tr>
        ${model.violations.map(([r, w, s, d]) => `<tr><td>${escapeHtml(r)}</td><td>${escapeHtml(w)}</td><td>${escapeHtml(s)}</td><td>${escapeHtml(String(d))}</td></tr>`).join('')}
      </table>` : ''
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(model.title)}</title>
    <style>
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:32px;font-size:13px}
      h1{font-size:18px;margin:0 0 2px} h2{font-size:13px;margin:18px 0 6px;border-bottom:1px solid #e2e8f0;padding-bottom:3px}
      .sub{color:#64748b;font-size:11px;margin:0 0 4px}
      table{border-collapse:collapse;width:100%;margin-bottom:6px} td,th{padding:3px 6px;border-bottom:1px solid #f1f5f9;text-align:left}
      th{color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.4px} td.num{text-align:right;font-weight:600}
      .foot{margin-top:18px;color:#94a3b8;font-size:11px}
      @media print{@page{margin:18mm}}
    </style></head><body>
    <h1>${escapeHtml(model.title)}</h1>
    <p class="sub">Vungu RDC · Planning &amp; Environment Department</p>
    <p class="sub">Period: ${escapeHtml(model.periodLabel)} · Scope: ${escapeHtml(model.scopeLabel)}</p>
    ${section('Summary', [
      ['Applications received', model.totals.received],
      ['Approved (incl. conditional)', model.totals.approved],
      ['Refused', model.totals.refused],
      ['Enforcement orders', model.totals.enforcement],
    ])}
    ${section('KPI dashboard', model.kpi)}
    ${section('Breakdown by status', model.byStatus)}
    ${section('Breakdown by development type', model.byType)}
    ${section('Breakdown by ward', model.byWard)}
    ${violationRows}
    ${model.gaps.length ? `<p class="sub">Sections without a data feed (omitted): ${escapeHtml(model.gaps.join(', '))}</p>` : ''}
    <p class="foot">Compiled: ${escapeHtml(model.generatedAt)}</p>
  </body></html>`
}

function printHtml(html: string) {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) { showToast('Allow pop-ups to print the report', 'warning'); return }
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 250) // let the new window paint before printing
}

function generateReport(fmt: string) {
  if (!eo.permits.value.length && !eo.enforcement.value.length) {
    showToast('No data loaded yet — try again once the command centre has loaded', 'warning')
    return
  }
  const model = buildReportModel()
  const base = reportFilenameBase()
  try {
    if (fmt === 'pdf') {
      const filename = `${base}.pdf`
      const url = downloadBlob(generatePdf(model), filename)
      trackRecent({ title: model.title, format: 'pdf', blobUrl: url, filename })
      showToast('PDF report generated', 'success')
    } else if (fmt === 'excel') {
      const filename = `${base}.csv`
      const url = downloadBlob(new Blob([buildCsv(model)], { type: 'text/csv;charset=utf-8' }), filename)
      trackRecent({ title: model.title, format: 'csv', blobUrl: url, filename })
      showToast('Spreadsheet (CSV) generated', 'success')
    } else {
      const html = buildPrintHtml(model)
      const reprint = () => printHtml(html)
      reprint()
      trackRecent({ title: model.title, format: 'print', reprint })
    }
  } catch {
    showToast('Could not generate the report', 'error')
  }
}

function downloadReport(r: RecentReport) {
  if (r.blobUrl && r.filename) {
    const a = document.createElement('a')
    a.href = r.blobUrl; a.download = r.filename; a.click()
    showToast(`Downloading: ${r.title}`, 'success')
  } else if (r.reprint) {
    r.reprint()
  } else {
    showToast('This report is no longer available — regenerate it', 'warning')
  }
}

// ── Audit Trail ────────────────────────────────────────────────────────────
const auditSearch = ref('')
// Session-local activity log: real actions the EO takes in this session
// (decisions, enforcement) are appended via addAuditEntry. A persistent audit
// trail needs a backend audit endpoint (gap, see plan B4).
const auditLog = ref<Array<{ id:number; description:string; user:string; timestamp:string; action:string; ref:string }>>([])
const filteredAudit = computed(() => {
  const q = auditSearch.value.toLowerCase()
  if (!q) return auditLog.value
  return auditLog.value.filter(e =>
    e.description.toLowerCase().includes(q) ||
    e.user.toLowerCase().includes(q) ||
    (e.ref || '').toLowerCase().includes(q)
  )
})

// ── Master Plans ───────────────────────────────────────────────────────────
// Gap: master-plan progress needs a master_plan dataset/endpoint (the tile
// catalog exposes a 'master_plan' group but no progress metadata yet).
const masterPlans = ref<Array<{ id:number; name:string; horizon:string; status:string; progress:number; color:string; active:boolean; description:string; wards:string[]; deviation:string|null }>>([])
const overallMPProgress = computed(() => {
  const active = masterPlans.value.filter(p => p.status === 'active')
  if (!active.length) return 0
  return Math.round(active.reduce((s, p) => s + p.progress, 0) / active.length)
})

// ── Modals ─────────────────────────────────────────────────────────────────
const reviewModal = ref<any>(null)
const enforcementModal = ref<any>(null)

function openReview(item: any) { reviewModal.value = { ...item } }
function openProposalDetail(p: any) { reviewModal.value = { ...p } }

/**
 * Hand a case to the console's Determination section, with it open.
 *
 * The map pane used to determine applications itself, with three one-click
 * buttons that transitioned the permit's status. That is not a determination:
 * section 26 asks for reasons, conditions where they apply, and a decision
 * communicated to the applicant, and the decision route writes all of it plus
 * the letter and the audit entry. A status flipped from a dashboard tile
 * produced an approval with none of that behind it.
 *
 * So the queue, the proposal cards and the review modal all end here, and the
 * determination itself is made once, in one place.
 */
function determineInConsole(id: string, refNo?: string) {
  reviewModal.value = null
  void router.push({
    query: { ...route.query, section: 'decision', case: id },
  }).catch(() => undefined)
  emit('open-console')
  showToast(`${refNo || 'Application'} opened in Determination`, 'success')
}

// Cross-role connection: assign a survey task on this application. The surveyor
// picks it up in their Console (/surveyor); findings return to the EO/planner.
async function assignSurvey(p: any) {
  try {
    await surveyorApi.assignJob({
      permit_app_id: p.id,
      task_type: 'verification',
      stand_number: p.stand,
      suburb_ward: p.ward,
      instructions: `Survey verification requested for ${p.ref ?? p.id}`,
    })
    addAuditEntry('created', `Assigned survey task — ${p.ref ?? p.id}`, p.ref ?? p.id)
    showToast(`Survey task assigned for ${p.ref ?? p.id}`, 'success')
  } catch (e: any) {
    showToast(e?.response?.data?.error ?? 'Could not assign survey task', 'error')
  }
}

function issueStopWork(v: any) {
  enforcementModal.value = { actionType:'stopwork', violation:v, reason:'', ref:`SWO-${new Date().getFullYear()}-${String(v.ref || '').slice(-3)}` }
}
function issueFine(v: any) {
  enforcementModal.value = { actionType:'fine', violation:v, amount:'', ref:`EF-${new Date().getFullYear()}-${String(v.ref || '').slice(-3)}` }
}
async function resolveViolation(v: any) {
  try {
    await dmApi.setEnforcementStatus(v.id, 'complied')
    addAuditEntry('approved', `Resolved enforcement ${v.ref}`, v.ref)
    showToast(`${v.ref} marked resolved`, 'success')
    await eo.refresh()
  } catch (e: any) {
    showToast(e?.response?.data?.error ?? 'Could not resolve the order', 'error')
  }
}
const enforcementSubmitting = ref(false)

async function confirmEnforcement() {
  if (!enforcementModal.value || enforcementSubmitting.value) return
  enforcementSubmitting.value = true
  const { actionType, violation, reason, amount, ref } = enforcementModal.value
  // The violation row now carries the enforcement order's stand + subject so we
  // can build a payload the backend accepts. POST /enforcement-orders and
  // /prohibition-orders both REQUIRE subject_name + subject_address; the ward
  // label is the best available address fallback when the order has neither.
  const standNo        = violation?.standNumber || ''
  const subjectName    = violation?.subjectName || 'Unknown'
  const subjectAddress = violation?.subjectAddress || violation?.ward || 'Vungu Rural District'
  const summary        = violation?.description || 'Breach of planning conditions'

  try {
    if (actionType === 'stopwork') {
      // DM Handbook 2021 §3.2 — Prohibition Order (Section 36 UDC Act). Linked
      // to the originating enforcement order so the two stay connected.
      await dmApi.createProhibitionOrder({
        enforcement_order_id: violation?.id ?? null,
        order_reference:      ref,
        subject_name:         subjectName,
        subject_address:      subjectAddress,
        stand_number:         standNo,
        prohibited_activity:  'All construction and development activity on the stand',
        reason:               reason || summary,
      })
      addAuditEntry('stopwork', `Stop Work Order issued — ${summary}`, ref)
      showToast(`Stop Work Order ${ref} issued`, 'error')
    } else {
      // DM Handbook 2021 §3.1 — Enforcement Order (Section 34 UDC Act).
      await dmApi.createEnforcement({
        order_reference:    ref,
        subject_name:       subjectName,
        subject_address:    subjectAddress,
        stand_number:       standNo,
        order_type:         'rectification',
        breach_description: summary,
        required_action:    amount ? `Pay environmental fine of USD ${amount}` : 'Rectify breach',
        compliance_period:  30,
      })
      addAuditEntry('fine', `Environmental fine $${amount} issued — ${summary}`, ref)
      showToast(`Fine ${ref} for $${amount} issued`, 'warning')
    }
    await eo.refresh()
  } catch (e: any) {
    showToast(e?.response?.data?.error ?? e?.response?.data?.message ?? `Failed to issue ${actionType === 'stopwork' ? 'stop work order' : 'fine'}`, 'error')
    enforcementSubmitting.value = false
    return
  }
  enforcementSubmitting.value = false
  enforcementModal.value = null
}

function addAuditEntry(action: string, description: string, ref: string) {
  auditLog.value.unshift({
    id: Date.now(),
    description, action, ref,
    user: 'S. Maramwidze (E.O.)',
    timestamp: new Date().toLocaleString('en-ZW', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }),
  })
}

// ── Toast ──────────────────────────────────────────────────────────────────
const toast = ref<{ msg:string; type:string }|null>(null)
let toastTimer: ReturnType<typeof setTimeout>|null = null
function showToast(msg: string, type = 'success') {
  if (toastTimer) clearTimeout(toastTimer)
  toast.value = { msg, type }
  toastTimer = setTimeout(() => { toast.value = null }, 3500)
}

// ── Public building reports (live) ─────────────────────────────────────────
// Fed from /api/building-complaints (migration 120). No fake rows; empty means
// no open complaints. Dedicated /eo/citizen-reports is not required for this panel.
interface CitizenReportRow {
  id: string; ref_no: string; report_type: string; status: string
  summary: string; citizen_name?: string; citizen_email?: string
  ward?: string; stand_no?: string; latitude?: number; longitude?: number
  created_at: string; eo_notes?: string
}
const citizenReportsQueue = ref<CitizenReportRow[]>([])
const citizenReportsLoading = ref(false)
const citizenReportsError = ref('')

const REPORT_TYPE_LABELS: Record<string, string> = {
  ...COMPLAINT_CATEGORY_LABELS,
  building_progress:'Building Phase Report', illegal_development:'Illegal Development',
  boundary_encroachment:'Boundary Encroachment', environmental_nuisance:'Environmental Nuisance',
  ownership_change:'Ownership Change', dev_milestone:'Dev Milestone',
  safety_land_intel:'Safety / Land Intel', env_compliance:'Env. Compliance Metrics',
  plan_deviation:'Plan Deviation', utility_connection:'Utility Connection',
}

async function loadCitizenReports() {
  citizenReportsLoading.value = true
  citizenReportsError.value = ''
  try {
    const res = await complaintsApi.list({ open: true, limit: 50 })
    citizenReportsQueue.value = (res.data || []).map(c => ({
      id: c.id,
      ref_no: c.reference,
      report_type: c.category,
      status: c.status,
      summary: c.description,
      citizen_name: c.anonymous ? undefined : (c.reporter_name || undefined),
      ward: c.suburb_ward || undefined,
      stand_no: c.stand_number || undefined,
      latitude: c.observed_lat ?? undefined,
      longitude: c.observed_lng ?? undefined,
      created_at: c.received_at,
    }))
  } catch {
    citizenReportsQueue.value = []
    citizenReportsError.value = 'Could not load public building reports (migration 120 / building-complaints).'
  } finally {
    citizenReportsLoading.value = false
  }
}

// ── Navigation ────────────────────────────────────────────────────────────
async function goBack() {
  await authStore.logout()
  router.push('/login')
}

// Profile dropdown moved to <ProfileDropdown> shared component.

// ── Wards (for report selector) ────────────────────────────────────────────
const wards = [
  { id:1, name:'Somabhula' }, { id:2, name:'Vungu Central' }, { id:3, name:'Sebakwe' },
  { id:4, name:'Lalapanzi' }, { id:5, name:'Zhombe North' }, { id:6, name:'Zhombe South' },
  { id:7, name:'Munyati' },   { id:8, name:'Shurugwi Border' }, { id:9, name:'Mudarikwa' },
  { id:10,name:'Lower Gweru'},{ id:11,name:'Tongogara' }, { id:12,name:'Zvishavane Border' },
  { id:13,name:'Mberengwa Border' }, { id:14,name:'Insiza Border' }, { id:15,name:'Silobela' },
  { id:16,name:'Mbundane' },  { id:17,name:'Ripple Creek' }, { id:18,name:'Mvuma Border' },
  { id:19,name:'Kwekwe Border' }, { id:20,name:'Gweru Rural' },
]

// ── Map ────────────────────────────────────────────────────────────────────
const mapContainer = ref<HTMLElement|null>(null)
const mapInstance  = ref<any>(null)
const mapLoading   = ref(true)
const mapZoom      = ref(9)
const cursorCoords = ref('29.8167° E, 19.4500° S')
const userLocation = ref<[number,number]|null>(null)
const locating     = ref(false)
let userMarker: maplibregl.Marker|null = null

// Basemap is fixed to the Vungu PostGIS cartographic system (addVunguBasemap);
// an external raster basemap switcher would wipe the tile layers, so it's gone.

const mapToggles = reactive([
  { id:'sites',       label:'Application sites',    icon:MapPin,        active:true  },
  { id:'enforcement', label:'Enforcement orders',   icon:Ban,           active:true  },
  { id:'heatmap',     label:'Activity heatmap',     icon:AlertTriangle, active:false },
  { id:'masterplan',  label:'Master-plan zones',    icon:BookOpen,      active:false },
  { id:'wetlands',    label:'Env. sensitive areas', icon:TreePine,      active:false },
])
// "Unpaid stands" is gone: nothing in the platform records payment against a
// stand, so the toggle could only ever have warned that it had no data.

const rightTabs = [
  { id:'review',     label:'Review',     icon:ClipboardCheck  },
  { id:'compliance', label:'Compliance', icon:Ban             },
  { id:'reports',    label:'Reports',    icon:FileText        },
  { id:'audit',      label:'Audit Trail',icon:Activity        },
  { id:'masterplan', label:'Master Plan',icon:BookOpen        },
  { id:'zones',      label:'Zones',      icon:Layers          },
]

// ── Mutable Zones (restricted / special-consent permit zones) ───────────
const zonesList = ref<any[]>([])
const zonesLoading = ref(false)
const zonesError = ref('')
const selectedZone = ref<any>(null)
const zoneControls = ref<any[]>([])
const zoneControlsLoading = ref(false)
const zoneEditDialog = reactive({
  open: false, id: '', zone: '', zoneCode: '', zoneType: '',
  scaleCategory: 'mixed_scale', authority: 'Vungu RDC',
  description: '', ward: '', isActive: true, saving: false,
})
const newControlDialog = reactive({
  open: false, zoneId: '', controlType: 'special_consent',
  landUseGroupId: '', notes: '', saving: false,
})
const landUseGroups = ref<any[]>([])

async function loadZones() {
  zonesLoading.value = true; zonesError.value = ''
  try {
    // GET /zones (zones.js) returns proposed_peri_urban_zones as a
    // FeatureCollection — geometry, centroid, ward, area and scale included. The
    // development-control list of the same table carries none of those, which is
    // why the detail grid read "—" and the fly-to never moved the camera.
    const res = await api.get('/zones')
    zonesList.value = (res.data?.features ?? []).map((f: any) => ({
      ...f.properties,
      geometry: f.geometry ?? null,
      centroid: Array.isArray(f.properties?.centroid) && f.properties.centroid.every((n: any) => typeof n === 'number')
        ? f.properties.centroid
        : null,
    }))
  } catch (err: any) {
    zonesError.value = 'Could not load zones'
  } finally { zonesLoading.value = false }
}

async function selectZone(z: any) {
  selectedZone.value = z
  zoneControlsLoading.value = true
  try {
    const res = await api.get(`/zones/${z.id}/controls`)
    zoneControls.value = res.data.data ?? []
  } catch { zoneControls.value = [] }
  finally { zoneControlsLoading.value = false }
  // Outline the zone and go to it — a zone you are editing should be visible.
  drawZone(z.geometry)
  if (z.centroid && mapInstance.value) {
    mapInstance.value.flyTo({ center: z.centroid, zoom: 13, duration: prefersReducedMotion() ? 0 : 1200 })
  }
}

function openZoneEdit(z: any) {
  Object.assign(zoneEditDialog, {
    open: true, id: z.id, zone: z.zone, zoneCode: z.zoneCode || '',
    zoneType: z.zoneType || '', scaleCategory: z.scaleCategory || 'mixed_scale',
    authority: z.authority || 'Vungu RDC', description: z.description || '',
    ward: z.ward || '', isActive: z.isActive !== false,
  })
}

async function saveZoneEdit() {
  const d = zoneEditDialog; d.saving = true
  try {
    await api.put(`/zones/${d.id}`, {
      zone: d.zone, zoneCode: d.zoneCode, zoneType: d.zoneType,
      scaleCategory: d.scaleCategory, authority: d.authority,
      description: d.description, ward: d.ward, isActive: d.isActive,
    })
    d.open = false
    await loadZones()
    showToast('Zone saved', 'success')
  } catch (err: any) {
    showToast(err.response?.data?.error || 'Could not save the zone', 'error')
  } finally { d.saving = false }
}

async function deactivateZone(id: string, name: string) {
  if (!confirm(`Deactivate zone "${name}"? Existing stands will not be affected.`)) return
  try {
    await api.delete(`/zones/${id}`)
    if (selectedZone.value?.id === id) { selectedZone.value = null; drawZone(null) }
    await loadZones()
    showToast('Zone deactivated', 'success')
  } catch (err: any) {
    showToast(err.response?.data?.error || 'Could not deactivate the zone', 'error')
  }
}

async function removeZoneControl(zoneId: string, controlId: string) {
  try {
    await api.delete(`/zones/${zoneId}/controls/${controlId}`)
    await selectZone(selectedZone.value)
  } catch { /* ignore */ }
}

async function loadLandUseGroups() {
  try {
    const res = await api.get('/development-control/groups')
    landUseGroups.value = res.data?.data ?? []
  } catch { /* land use groups may not be available */ }
}

async function addControl() {
  const d = newControlDialog; d.saving = true
  try {
    await api.post(`/zones/${d.zoneId}/controls`, {
      landUseGroupId: d.landUseGroupId,
      controlType: d.controlType,
      notes: d.notes,
    })
    d.open = false
    await selectZone(selectedZone.value)
    showToast('Control added', 'success')
  } catch (err: any) {
    showToast(err.response?.data?.error || 'Could not add the control', 'error')
  } finally { d.saving = false }
}
const rightTab = ref('review')

function applyMapToggle(t: any) {
  // The three case overlays are our own layers; the rest flip matching PostGIS
  // tile layers by keyword.
  if (t.id === 'sites') {
    setLayerVisible(SITE_LYRS.fill, t.active)
    setLayerVisible(SITE_LYRS.line, t.active)
    setLayerVisible(SITE_LYRS.pt, t.active)
    showToast(`${t.active ? 'Showing' : 'Hiding'} application sites`)
    return
  }
  if (t.id === 'heatmap') {
    setLayerVisible(SITE_LYRS.heat, t.active)
    showToast(`${t.active ? 'Showing' : 'Hiding'} application density`)
    return
  }
  if (t.id === 'enforcement') {
    enforcementVisible.value = t.active
    renderEnforcementPins()
    showToast(`${t.active ? 'Showing' : 'Hiding'} enforcement orders`)
    return
  }
  const keywordMap: Record<string, string[]> = {
    masterplan: ['master', 'plan', 'zone'],
    wetlands:   ['water', 'wetland', 'river', 'landuse'],
  }
  const map = mapInstance.value
  const keywords = keywordMap[t.id]
  const matches = (map && keywords)
    ? eoLayers.value.filter(l => keywords.some(k => l.id.toLowerCase().includes(k) || l.name.toLowerCase().includes(k)))
    : []
  if (map && matches.length) {
    matches.forEach(l => {
      layerVisibility[l.id] = t.active
      setBasemapLayerVisible(map, l.id, t.active)
      if (t.active) spatialStore.visibleTileLayers.add(l.id)
      else spatialStore.visibleTileLayers.delete(l.id)
    })
    showToast(`${t.active ? 'Showing' : 'Hiding'} ${t.label}`)
  } else {
    showToast(`${t.label} has no spatial layer yet`, 'warning')
  }
}

// ══ GIS QUERY SURFACE ═════════════════════════════════════════════════════
// The EO answers the same spatial questions a local-authority inspector does —
// what is at this spot, what is within a notification radius, how far apart are
// two things, where are the live cases — so the map carries the shared
// MapToolbar (search / measure / radius / export) and the same identify query
// the building inspector uses. Nothing here is computed from what happens to be
// on screen: the registers answer, and the answer states its own precision.

/** MapToolbar owns map clicks while a tool is armed; identify stands down. */
const activeMapTool = ref<'none' | 'search' | 'measure' | 'radius' | 'imagery'>('none')

// ── identify: "what is here" (GET /inspector/identify) ────────────────────
const identifyPoint = ref<[number, number] | null>(null)
const identifyResult = shallowRef<IdentifyResult | null>(null)
const identifyLoading = ref(false)
const identifyError = ref<string | null>(null)
let identifySeq = 0
let identifyMarker: maplibregl.Marker | null = null

// "What is this thing" (the road, parcel or landuse polygon itself) sits
// beside "what do the registers hold here" in the same card.
const mapFeature = shallowRef<ClickedFeature | null>(null)
const layerTitles = computed(() =>
  Object.fromEntries(spatialStore.tileLayers.map(l => [l.id, l.title])) as Record<string, string>)

async function runIdentify(lng: number, lat: number, feature: ClickedFeature | null = null) {
  const mine = ++identifySeq
  identifyPoint.value = [lng, lat]
  // A click on bare ground carries no feature: the previous one must not sit
  // there looking like an answer to this click.
  mapFeature.value = feature
  identifyResult.value = null
  identifyError.value = null
  identifyLoading.value = true
  placeIdentifyMarker([lng, lat])
  try {
    const r = await inspectorGis.identify(lng, lat)
    if (mine === identifySeq) identifyResult.value = r
  } catch (e: any) {
    if (mine !== identifySeq) return
    identifyError.value = e?.response?.data?.message || 'This location could not be identified.'
  } finally {
    if (mine === identifySeq) identifyLoading.value = false
  }
}

/** Keyboard and touch route to the same query: identify the map centre. */
function identifyCentre() {
  const map = mapInstance.value
  const c = map?.getCenter?.()
  if (!c) return
  const point = map.project ? map.project(c) : null
  runIdentify(c.lng, c.lat, point ? featureAtPoint(map, point, layerTitles.value) : null)
}

function clearIdentify() {
  identifySeq++
  identifyPoint.value = null
  identifyResult.value = null
  identifyError.value = null
  identifyLoading.value = false
  mapFeature.value = null
  identifyMarker?.remove()
  identifyMarker = null
}

function placeIdentifyMarker(at: [number, number]) {
  const map = mapInstance.value
  if (!map) return
  identifyMarker?.remove()
  const el = document.createElement('div')
  el.className = 'eo-identify-marker'
  identifyMarker = new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map)
}

/** A case found under the cursor opens in the review modal, so the EO can act on
 *  it without hunting for it in the queue. */
function openCaseFromIdentify(permitId: string) {
  const hit = proposals.value.find(pr => pr.id === permitId)
    ?? approvalQueue.value.find(q => q.id === permitId)
  if (hit) { reviewModal.value = { ...hit }; return }
  showToast('That case is not on the EO desk — open it from the case console', 'warning')
}

// ── application sites (GET /inspector/sites?scope=all) ────────────────────
// Permits do not carry geometry; the server resolves each one to a Stands
// Register boundary, a stand-sized cadastre parcel or the permit point, and
// states the precision. A site resolved only to a coarse area is never drawn as
// a site (ADR 0010) — the endpoint leaves its geometry null and it is skipped.
const appSites = useInspectorSites()
const SITE_SRC = 'eo-app-sites'
const BOUNDARY_SRC = 'eo-app-boundaries'
const SITE_LYRS = { fill: 'eo-app-bnd-fill', line: 'eo-app-bnd-line', pt: 'eo-app-pt', heat: 'eo-app-heat' }

// Case status drives the colour: live work amber, determined green or red.
const STATUS_COLOR: any = [
  'match', ['get', 'permitStatus'],
  'approved', '#16a34a',
  'approved_with_conditions', '#16a34a',
  'conditionally_approved', '#16a34a',
  'refused', '#dc2626',
  'lapsed', '#dc2626',
  'withdrawn', '#94a3b8',
  '#ea580c',
]

function addSiteLayers(map: any) {
  if (map.getSource(SITE_SRC)) return
  const empty = { type: 'FeatureCollection', features: [] }
  map.addSource(BOUNDARY_SRC, { type: 'geojson', data: empty })
  map.addSource(SITE_SRC, { type: 'geojson', data: empty })
  map.addLayer({
    id: SITE_LYRS.fill, type: 'fill', source: BOUNDARY_SRC,
    paint: { 'fill-color': '#1a73e8', 'fill-opacity': 0.12 },
  })
  map.addLayer({
    id: SITE_LYRS.line, type: 'line', source: BOUNDARY_SRC,
    paint: { 'line-color': '#1a73e8', 'line-width': 1.6 },
  })
  map.addLayer({
    id: SITE_LYRS.heat, type: 'heatmap', source: SITE_SRC,
    layout: { visibility: 'none' },
    paint: {
      'heatmap-radius': 26,
      'heatmap-opacity': 0.65,
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(37,99,235,0)', 0.3, '#2563eb', 0.6, '#f97316', 1, '#ef4444',
      ],
    },
  })
  map.addLayer({
    id: SITE_LYRS.pt, type: 'circle', source: SITE_SRC,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 7],
      'circle-color': STATUS_COLOR,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    },
  })
  map.addSource(ZONE_SRC, { type: 'geojson', data: empty })
  map.addLayer({
    id: 'eo-zone-fill', type: 'fill', source: ZONE_SRC,
    paint: { 'fill-color': '#7c3aed', 'fill-opacity': 0.1 },
  })
  map.addLayer({
    id: 'eo-zone-line', type: 'line', source: ZONE_SRC,
    paint: { 'line-color': '#7c3aed', 'line-width': 2, 'line-dasharray': [2, 1] },
  })
  map.on('mouseenter', SITE_LYRS.pt, () => { map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', SITE_LYRS.pt, () => { map.getCanvas().style.cursor = '' })
}

/** Features whose geometry the server could not resolve are dropped — a null
 *  geometry would otherwise throw inside MapLibre. */
function positioned(fc: any) {
  return { type: 'FeatureCollection', features: (fc?.features ?? []).filter((f: any) => f && f.geometry) }
}

const ZONE_SRC = 'eo-zone-outline'
function drawZone(geometry: any) {
  const map = mapInstance.value
  const src = map?.getSource(ZONE_SRC)
  if (!src) return
  src.setData(geometry
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry, properties: {} }] }
    : { type: 'FeatureCollection', features: [] })
}

function pushSites() {
  const map = mapInstance.value
  if (!map || !map.getSource(SITE_SRC)) return
  map.getSource(SITE_SRC).setData(positioned(appSites.layers.value.points))
  map.getSource(BOUNDARY_SRC).setData(positioned(appSites.layers.value.boundaries))
}
watch(() => appSites.layers.value, pushSites)

function setLayerVisible(id: string, on: boolean) {
  const map = mapInstance.value
  if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
}

const toggleOn = (id: string) => mapToggles.find(t => t.id === id)?.active === true
// Cases the server could not place. An EO must see the number: an empty patch
// of district is otherwise indistinguishable from an unmapped one.
const unlocatedCases = computed(() => appSites.unpositioned.value.length)
const sitesError = appSites.error

/** Fly to a case's resolved site — the "where is this?" the EO asks of a file. */
function locateCase(permitId: string) {
  const site = appSites.sites.value.find(s => s.permitId === permitId)
  if (!site?.center) { showToast('This application has no resolved site position', 'warning'); return }
  mapInstance.value?.flyTo({ center: site.center, zoom: 16, duration: prefersReducedMotion() ? 0 : 1200 })
  runIdentify(site.center[0], site.center[1])
}

function locateUser() {
  if (!navigator.geolocation) { showToast('Geolocation not supported', 'error'); return }
  locating.value = true
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const coords: [number,number] = [pos.coords.longitude, pos.coords.latitude]
      userLocation.value = coords
      locating.value = false
      if (userMarker) userMarker.remove()
      const el = document.createElement('div')
      el.className = 'eo-user-marker'
      el.innerHTML = `<div class="uml-dot"></div><div class="uml-ring"></div>`
      userMarker = new maplibregl.Marker({ element: el }).setLngLat(coords).addTo(mapInstance.value!)
      mapInstance.value?.flyTo({ center: coords, zoom: 13, duration: 1200 })
      showToast('Location found', 'success')
    },
    () => { locating.value = false; showToast('Could not get location', 'error') }
  )
}

// ── Enforcement pins — real coordinates from enforcement orders ────────────
// Permits carry no geometry yet (see plan G1), so the map plots enforcement
// orders, which do have latitude/longitude. Popups escape all DB-derived text.
let enforcementMarkers: maplibregl.Marker[] = []
const enforcementVisible = ref(true)
function renderEnforcementPins() {
  const map = mapInstance.value
  if (!map) return
  enforcementMarkers.forEach(m => m.remove())
  enforcementMarkers = []
  if (!enforcementVisible.value) return
  for (const v of violations.value) {
    if (v.lng == null || v.lat == null) continue
    const el = document.createElement('div')
    el.style.cssText = 'width:14px;height:14px;border-radius:50%;border:2px solid #fff;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.4)'
    el.style.background = v.resolved ? '#22c55e' : v.severity === 'critical' ? '#dc2626' : v.severity === 'high' ? '#f97316' : '#eab308'
    const popup = new maplibregl.Popup({ offset: 12, closeButton: true }).setHTML(
      `<div style="font-family:inherit;font-size:12px">
         <div style="font-weight:700">${escapeHtml(v.ref)}</div>
         <div>${escapeHtml(v.description)}</div>
         <div style="color:#64748b;font-size:11px;margin-top:3px">${escapeHtml(v.ward)} · ${escapeHtml(v.date)}</div>
       </div>`)
    const m = new maplibregl.Marker({ element: el }).setLngLat([v.lng, v.lat]).setPopup(popup).addTo(map)
    enforcementMarkers.push(m)
  }
}
watch(violations, () => renderEnforcementPins())

// Load zones when the tab activates
watch(() => rightTab.value, (tab) => {
  if (tab === 'zones' && !zonesList.value.length) {
    loadZones()
    loadLandUseGroups()
  }
})

onMounted(async () => {
  eo.refresh()
  void loadCitizenReports()
  spatialStore.loadTileLayers()
  // Every case, not just the inspectable ones: the EO works on applications
  // long before they are approved.
  appSites.scope.value = 'all'
  appSites.refresh()

  if (!mapContainer.value) return
  // Cream land base; the PostGIS basemap (addVunguBasemap) is the content.
  const blankStyle = {
    version: 8 as const,
    sources: {},
    layers: [{ id:'background', type:'background' as const, paint:{ 'background-color':'#f2efe9' } }],
    glyphs: '/fonts/{fontstack}/{range}.pbf',
  }
  // @ts-ignore
  mapInstance.value = new maplibregl.Map({
    container: mapContainer.value,
    style: blankStyle as any,
    center: [29.82, -19.48],  // Vungu RDC district centre
    zoom: 10,
    minZoom: 1,
    maxZoom: 22,
    attributionControl: false,
  })
  // @ts-ignore
  mapInstance.value.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
  // @ts-ignore
  mapInstance.value.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left')

  mapInstance.value.on('load', () => {
    // The canonical 24-layer PostGIS basemap (provinces…buildings + labels +
    // admin drill-down), identical to the home/explorer map.
    addVunguBasemap(mapInstance.value)
    DEFAULT_VISIBLE.forEach(id => { layerVisibility[id] = true })
    mapLoading.value = false
    addSiteLayers(mapInstance.value)
    pushSites()
    renderEnforcementPins()
  })

  // Every click that is not feeding a measure/radius tool asks the registers
  // what is at that spot. addVunguBasemap's own click handler (admin
  // drill-down) is untouched — it answers a different question.
  mapInstance.value.on('click', (e: any) => {
    if (activeMapTool.value !== 'none') return
    runIdentify(e.lngLat.lng, e.lngLat.lat, featureAtPoint(mapInstance.value, e.point, layerTitles.value))
  })

  mapInstance.value.on('mousemove', (e: any) => {
    const lng = e.lngLat.lng.toFixed(4)
    const lat = Math.abs(e.lngLat.lat).toFixed(4)
    cursorCoords.value = `${lng}° E, ${lat}° S`
  })
  mapInstance.value.on('zoom', () => {
    mapZoom.value = Math.round((mapInstance.value?.getZoom() ?? 9) * 10) / 10
  })
})

onUnmounted(() => {
  clearInterval(clockTimer)
  identifyMarker?.remove()
  if (toastTimer) clearTimeout(toastTimer)
  mapInstance.value?.remove()
})
</script>

<style scoped>
/* ── Root ──────────────────────────────────────────────────────────────── */
.eo-root.embedded { height:100%; }
.eo-root { display:flex; flex-direction:column; height:var(--ent-vh); background:var(--ent-surface-2); color:var(--ent-text); font-family:var(--ent-font); overflow:hidden; font-size:0.875rem; }

/* ── Header ───────────────────────────────────────────────────────────── */
.eo-header { display:flex; align-items:center; gap:12px; padding:0 1rem; height:3.25rem; background:var(--ent-surface); border-bottom:1px solid var(--ent-line); flex-shrink:0; box-shadow:0 1px 3px rgba(0,0,0,0.06); z-index:40; }
.eo-brand { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.eo-brand-icon { width:1.75rem; height:1.75rem; background:var(--ent-text); border-radius:6px; display:flex; align-items:center; justify-content:center; color:var(--ent-text-on-accent); }
.eo-brand-title { display:block; font-size:0.875rem; font-weight:700; color:var(--ent-text); line-height:1.2; }
.eo-brand-sub { display:block; font-size:0.625rem; color:var(--ent-text-2); }
.eo-header-center { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; }
.eo-datetime { display:flex; align-items:center; gap:6px; font-size:0.75rem; color:var(--ent-text-2); }
.eo-alert-strip { display:flex; align-items:center; gap:6px; padding:3px 10px; background:var(--ent-danger-soft); border:1px solid var(--ent-tone-negative-line); border-radius:20px; font-size:0.6875rem; color:var(--ent-danger); }
.pulse-ico { animation:pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
.eo-portal-btn { display:inline-flex; align-items:center; gap:0.4rem;
  padding:0.4rem 0.85rem; background:var(--ent-accent); color:var(--ent-text-on-accent); border:none;
  border-radius:0.45rem; font-size:0.75rem; font-weight:700; cursor:pointer;
  box-shadow:0 1px 2px rgba(124, 58, 237, 0.25); flex-shrink:0; }
.eo-portal-btn:hover { background:var(--ent-accent-hover); }
.eo-user-chip { display:flex; align-items:center; gap:8px; padding:0.25rem 0.75rem 0.25rem 0.25rem; border:1px solid var(--ent-line); border-radius:9999px; background:var(--ent-surface-2); }
.eo-avatar { width:1.75rem; height:1.75rem; background:var(--ent-text); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.6875rem; font-weight:700; color:var(--ent-text-on-accent); }
.eo-user-name { display:block; font-size:0.8rem; font-weight:600; color:var(--ent-text); }
.eo-user-role { display:block; font-size:0.625rem; color:var(--ent-text-2); }
.eo-logout-btn { background:none; border:none; color:var(--ent-text-2); cursor:pointer; padding:4px; border-radius:4px; }
.eo-logout-btn:hover { color:var(--ent-text); background:var(--ent-surface-2); }

/* ── KPI Strip ────────────────────────────────────────────────────────── */
.kpi-strip { display:flex; gap:8px; padding:8px 12px; background:var(--ent-surface); border-bottom:1px solid var(--ent-line); flex-shrink:0; overflow-x:auto; }
.kpi-card { display:flex; align-items:center; gap:10px; padding:8px 12px; background:var(--ent-surface-2); border-radius:8px; border:1px solid var(--ent-line); min-width:160px; flex-shrink:0; }
.kpi-icon { width:34px; height:34px; border-radius:8px; display:flex; align-items:center; justify-content:center; }
.kpi-revenue .kpi-icon { background:var(--ent-success-soft); color:var(--ent-success); }
.kpi-time    .kpi-icon { background:var(--ent-accent-soft); color:var(--ent-accent); }
.kpi-active  .kpi-icon { background:var(--ent-accent-soft); color:var(--ent-accent); }
.kpi-pending .kpi-icon { background:var(--ent-warning-soft); color:var(--ent-warning); }
.kpi-viol    .kpi-icon { background:var(--ent-danger-soft); color:var(--ent-danger); }
.kpi-stands  .kpi-icon { background:var(--ent-accent-soft); color:var(--ent-accent); }
.kpi-value { font-size:17px; font-weight:800; color:var(--ent-text); }
.kpi-label { font-size:0.6875rem; color:var(--ent-text-2); text-transform:uppercase; letter-spacing:.5px; }
.kpi-trend { display:flex; align-items:center; gap:3px; font-size:0.6875rem; margin-top:2px; }
.kpi-trend.up { color:var(--ent-success); } .kpi-trend.down { color:var(--ent-danger); } .kpi-trend.neutral { color:var(--ent-text-2); }

/* ── Workspace ────────────────────────────────────────────────────────── */
.eo-workspace { display:grid; grid-template-columns:300px 1fr 320px; flex:1; overflow:hidden; }

/* ── Panels ───────────────────────────────────────────────────────────── */
.eo-left, .eo-right { overflow-y:auto; background:var(--ent-surface); border-right:1px solid var(--ent-line); }
.eo-left::-webkit-scrollbar, .eo-right::-webkit-scrollbar { width:3px; }
.eo-left::-webkit-scrollbar-thumb, .eo-right::-webkit-scrollbar-thumb { background:var(--ent-text-3); border-radius:2px; }
.eo-right { border-left:1px solid var(--ent-line); border-right:none; }
.eo-panel { border-bottom:1px solid var(--ent-line); padding:10px 12px; }
.eo-panel-head { display:flex; align-items:center; gap:6px; font-size:0.6875rem; font-weight:700; color:var(--ent-text-2); text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid var(--ent-line); }
.panel-badge { margin-left:auto; padding:2px 7px; border-radius:10px; font-size:0.625rem; font-weight:700; }
.panel-badge.urgent { background:var(--ent-danger-soft); color:var(--ent-danger); border:1px solid var(--ent-tone-negative-line); }

/* ── Queue ────────────────────────────────────────────────────────────── */
.queue-list { display:flex; flex-direction:column; gap:6px; }
.queue-item { display:flex; align-items:stretch; gap:8px; background:var(--ent-surface-2); border-radius:6px; border:1px solid var(--ent-line); cursor:pointer; overflow:hidden; transition:border-color .15s,background .15s; }
.queue-item:hover { border-color:var(--ent-text-3); background:var(--ent-surface-2); }
.qi-priority-bar { width:3px; flex-shrink:0; }
.queue-item.urgent  .qi-priority-bar { background:var(--ent-danger); }
.queue-item.high    .qi-priority-bar { background:var(--ent-warning); }
.queue-item.medium  .qi-priority-bar { background:var(--ent-warning); }
.queue-item.low     .qi-priority-bar { background:var(--ent-success); }
.qi-body { flex:1; padding:7px 4px; }
.qi-title { font-size:0.8rem; font-weight:600; color:var(--ent-text); }
.qi-meta { display:flex; gap:5px; font-size:0.6875rem; color:var(--ent-text-2); margin-top:3px; flex-wrap:wrap; }
.qi-type { background:var(--ent-surface-2); padding:1px 6px; border-radius:10px; color:var(--ent-text); }
.qi-days { font-weight:600; } .qi-days.overdue { color:var(--ent-danger); }
.qi-submitted { font-size:0.6875rem; color:var(--ent-text-3); margin-top:2px; }
.qi-actions { display:flex; flex-direction:column; gap:3px; padding:6px 6px 6px 0; }
.qi-btn { width:24px; height:24px; border:none; border-radius:4px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.qi-btn.determine { width:auto; padding:0 10px; gap:6px; background:var(--ent-accent-soft);
  color:var(--ent-accent); border:1px solid var(--ent-accent-line); font-size:0.6875rem;
  font-weight:600; }
.qi-btn.determine:hover { background:var(--ent-accent); color:var(--ent-text-on-accent);
  border-color:var(--ent-accent); }
.qi-btn-label { white-space:nowrap; }
.pc-btn.determine { background:var(--ent-accent-soft); color:var(--ent-accent);
  border-color:var(--ent-accent-line); }
.pc-btn.determine:hover { background:var(--ent-accent); color:var(--ent-text-on-accent);
  border-color:var(--ent-accent); }
.rm-btn.determine { background:var(--ent-accent); color:var(--ent-text-on-accent);
  border-color:var(--ent-accent); }
.rm-btn.determine:hover { background:var(--ent-accent-hover); }
.rm-note { flex:1; margin:0; font-size:0.6875rem; color:var(--ent-text-2); line-height:1.45; }
.qi-btn.approve { background:var(--ent-success-soft); color:var(--ent-success); border:1px solid var(--ent-tone-positive-line); } .qi-btn.approve:hover { background:var(--ent-success); color:var(--ent-text-on-accent); border-color:var(--ent-success); }
.qi-btn.revise  { background:var(--ent-accent-soft); color:var(--ent-accent); border:1px solid var(--ent-accent-line); } .qi-btn.revise:hover { background:var(--ent-accent); color:var(--ent-text-on-accent); border-color:var(--ent-accent); }
.qi-btn.reject  { background:var(--ent-danger-soft); color:var(--ent-danger); border:1px solid var(--ent-tone-negative-line); } .qi-btn.reject:hover { background:var(--ent-danger); color:var(--ent-text-on-accent); border-color:var(--ent-danger); }
.empty-state { text-align:center; padding:20px; color:var(--ent-text-2); font-size:0.8rem; }

/* ── Staff ────────────────────────────────────────────────────────────── */
.staff-list { display:flex; flex-direction:column; gap:8px; }
.staff-row { display:flex; align-items:center; gap:8px; }
.staff-avatar { width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.625rem; font-weight:700; color:var(--ent-text-on-accent); flex-shrink:0; }
.staff-name { font-size:0.8rem; font-weight:600; color:var(--ent-text); }
.staff-role { font-size:0.6875rem; color:var(--ent-text-2); }
.staff-meter { flex:1; display:flex; align-items:center; gap:6px; }
.staff-bar-wrap { flex:1; height:4px; background:var(--ent-surface-2); border-radius:2px; overflow:hidden; }
.staff-bar { height:100%; border-radius:2px; transition:width .5s; }
.staff-bar.critical { background:var(--ent-danger); } .staff-bar.high { background:var(--ent-warning); }
.staff-bar.moderate { background:var(--ent-warning); } .staff-bar.light { background:var(--ent-success); }
.staff-tasks { font-size:0.6875rem; font-weight:700; min-width:40px; text-align:right; }
.staff-tasks.critical { color:var(--ent-danger); } .staff-tasks.high { color:var(--ent-warning); }
.staff-tasks.moderate { color:var(--ent-warning); } .staff-tasks.light { color:var(--ent-success); }

/* ── Ward Summary ─────────────────────────────────────────────────────── */
.ward-summary-list { display:flex; flex-direction:column; gap:5px; }
.ward-summary-row { display:flex; align-items:center; gap:6px; }
.ws-ward { font-size:0.625rem; font-weight:700; color:var(--ent-text-2); width:22px; flex-shrink:0; }
.ws-name { font-size:0.6875rem; color:var(--ent-text); width:80px; flex-shrink:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ws-bars { display:flex; flex-direction:column; gap:2px; flex:1; }
.ws-bar-item { display:flex; align-items:center; gap:4px; }
.ws-mini-bar { height:4px; border-radius:2px; min-width:4px; transition:width .4s; }
.ws-mini-bar.apps { background:var(--ent-accent); } .ws-mini-bar.viol { background:var(--ent-danger); }
.ws-bar-item span { font-size:0.625rem; color:var(--ent-text-2); }
.ws-legend { display:flex; gap:10px; margin-top:6px; font-size:0.625rem; color:var(--ent-text-2); }
.ws-dot { display:inline-block; width:8px; height:4px; border-radius:2px; margin-right:3px; }
.ws-dot.apps { background:var(--ent-accent); } .ws-dot.viol { background:var(--ent-danger); }

/* ── Center Map ───────────────────────────────────────────────────────── */
.eo-center { display:flex; flex-direction:column; position:relative; }
.eo-map-controls { display:flex; align-items:center; gap:8px; padding:5px 10px; background:var(--ent-surface); border-bottom:1px solid var(--ent-line); flex-wrap:wrap; }
.map-toggle-group { display:flex; gap:4px; flex-wrap:wrap; }
.map-toggle-btn { display:flex; align-items:center; gap:4px; padding:4px 8px; background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:6px; cursor:pointer; font-size:0.75rem; color:var(--ent-text); transition:all .15s; }
.map-toggle-btn:hover { border-color:var(--ent-text); color:var(--ent-text); background:var(--ent-surface-2); }
.map-toggle-btn.active { background:var(--ent-text); border-color:var(--ent-line-strong); color:var(--ent-text-on-accent); }
.basemap-group { display:flex; gap:4px; margin-left:auto; }
.bm-btn { display:flex; align-items:center; gap:4px; padding:4px 8px; background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:6px; cursor:pointer; font-size:0.75rem; color:var(--ent-text); }
.bm-btn.active { background:var(--ent-text); border-color:var(--ent-line-strong); color:var(--ent-text-on-accent); }
.eo-map-canvas { flex:1; position:relative; }
.map-container { width:100%; height:100%; }
.map-overlay-loading { position:absolute; inset:0; background:rgba(248,250,252,0.85); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; font-size:0.8125rem; color:var(--ent-text-2); }
.heatmap-legend { position:absolute; bottom:40px; left:10px; background:rgba(255,255,255,0.95); border:1px solid var(--ent-line); border-radius:6px; padding:8px 10px; font-size:0.75rem; color:var(--ent-text); box-shadow:0 2px 8px rgba(0,0,0,0.08); }
.hml-title { display:block; margin-bottom:4px; font-weight:600; color:var(--ent-text); }
.hml-gradient { height:8px; width:120px; background:linear-gradient(to right, var(--ent-accent), var(--ent-warning), var(--ent-danger)); border-radius:4px; margin-bottom:3px; }
.hml-labels { display:flex; justify-content:space-between; font-size:0.625rem; color:var(--ent-text-2); }
.eo-legend-row { display:flex; align-items:center; gap:6px; font-size:0.6875rem; color:var(--ent-text); }
.eo-legend-row i { width:9px; height:9px; border-radius:50%; border:1.5px solid var(--ent-surface); box-shadow:0 0 0 1px rgba(15,23,42,.15); }
.eo-legend-note { margin-top:4px; font-size:0.625rem; color:var(--ent-text-2); }
.eo-legend-err { margin-top:4px; font-size:0.625rem; color:var(--ent-danger); max-width:180px; }
/* Identify card: bottom-right, clear of the locate button and the scale bar. */
.eo-identify-panel { position:absolute; right:10px; bottom:80px; width:min(340px, 70%); max-height:calc(100% - 130px); overflow-y:auto; background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:8px; padding:12px; box-shadow:0 8px 24px rgba(15,23,42,0.14); z-index:6; }
.eo-status-hint { margin-left:auto; color:var(--ent-text-3); }
.eo-identify-btn { position:absolute; bottom:40px; right:50px; width:32px; height:32px; background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:6px; cursor:pointer; display:flex; align-items:center; justify-content:center; color:var(--ent-text-2); box-shadow:0 1px 4px rgba(0,0,0,0.08); }
.eo-identify-btn:hover { color:var(--ent-text); border-color:var(--ent-line-strong); }
.eo-identify-btn:focus-visible, .eo-locate-btn:focus-visible { outline:2px solid var(--ent-accent); outline-offset:2px; }
.eo-sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
.eo-locate-btn { position:absolute; bottom:40px; right:10px; width:32px; height:32px; background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:6px; cursor:pointer; display:flex; align-items:center; justify-content:center; color:var(--ent-text-2); box-shadow:0 1px 4px rgba(0,0,0,0.08); }
.eo-locate-btn.active { color:var(--ent-success); border-color:var(--ent-success); }
.eo-locate-btn.locating { color:var(--ent-warning); }
.eo-statusbar { display:flex; align-items:center; gap:14px; padding:4px 12px; background:var(--ent-surface); border-top:1px solid var(--ent-line); font-size:0.6875rem; color:var(--ent-text-2); }
.loc-active { color:var(--ent-success); display:flex; align-items:center; gap:4px; }

/* ── Right Tabs ───────────────────────────────────────────────────────── */
.eo-tabs { display:flex; border-bottom:1px solid var(--ent-line); background:var(--ent-surface); overflow-x:auto; }
.eo-tab { display:flex; align-items:center; gap:5px; padding:8px 10px; background:none; border:none; cursor:pointer; font-size:0.75rem; color:var(--ent-text-2); border-bottom:2px solid transparent; white-space:nowrap; font-weight:500; }
.eo-tab:hover { color:var(--ent-text); }
.eo-tab.active { color:var(--ent-text); border-bottom-color:var(--ent-line-strong); font-weight:600; }
.eo-tab-body { padding:10px; }
.tab-section-head { font-size:0.6875rem; font-weight:700; color:var(--ent-text-2); text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid var(--ent-line); }

/* ── Proposals ────────────────────────────────────────────────────────── */
.proposal-filter { margin-bottom:8px; }
.eo-select { width:100%; padding:5px 8px; background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:6px; color:var(--ent-text); font-size:0.8125rem; outline:none; }
.eo-select:focus { border-color:var(--ent-text); }
.proposal-list { display:flex; flex-direction:column; gap:6px; }
.proposal-card { background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:6px; padding:8px; cursor:pointer; transition:border-color .15s,background .15s; }
.proposal-card:hover { border-color:var(--ent-text-3); background:var(--ent-surface-2); }
.pc-header { display:flex; align-items:center; gap:6px; margin-bottom:4px; }
.pc-id { font-size:0.75rem; font-weight:700; color:var(--ent-accent); }
.pc-stage { margin-left:auto; padding:2px 7px; border-radius:10px; font-size:0.625rem; font-weight:700; }
.pc-stage.awaiting_eo { background:var(--ent-warning-soft); color:var(--ent-warning); border:1px solid var(--ent-tone-warning-line); }
.pc-stage.circulating { background:var(--ent-accent-soft); color:var(--ent-accent); border:1px solid var(--ent-accent-line); }
.pc-stage.conflict_check { background:var(--ent-accent-soft); color:var(--ent-accent); border:1px solid var(--ent-accent-line); }
.pc-stage.draft { background:var(--ent-surface-2); color:var(--ent-text-2); border:1px solid var(--ent-line); }
.pc-stage.approved { background:var(--ent-success-soft); color:var(--ent-success); border:1px solid var(--ent-tone-positive-line); }
.pc-stage.rejected { background:var(--ent-danger-soft); color:var(--ent-danger); border:1px solid var(--ent-tone-negative-line); }
.pc-stage.revision { background:var(--ent-warning-soft); color:var(--ent-warning); border:1px solid var(--ent-tone-warning-line); }
.pc-title { font-size:0.8rem; font-weight:600; color:var(--ent-text); margin-bottom:3px; }
.pc-meta { font-size:0.6875rem; color:var(--ent-text-2); }
.pc-flags { display:flex; flex-direction:column; gap:2px; margin-top:5px; }
.pc-flag { display:flex; align-items:center; gap:4px; font-size:0.6875rem; color:var(--ent-warning); padding:2px 6px; background:var(--ent-warning-soft); border:1px solid var(--ent-tone-warning-line); border-radius:4px; }
.pc-actions { display:flex; gap:4px; margin-top:6px; }
.pc-btn { display:flex; align-items:center; gap:4px; padding:4px 8px; border:1px solid; border-radius:4px; cursor:pointer; font-size:0.6875rem; font-weight:600; }
.pc-btn.approve { background:var(--ent-success-soft); color:var(--ent-success); border-color:var(--ent-tone-positive-line); } .pc-btn.approve:hover { background:var(--ent-success); color:var(--ent-text-on-accent); border-color:var(--ent-success); }
.pc-btn.revise  { background:var(--ent-accent-soft); color:var(--ent-accent); border-color:var(--ent-accent-line); } .pc-btn.revise:hover { background:var(--ent-accent); color:var(--ent-text-on-accent); border-color:var(--ent-accent); }
.pc-btn.reject  { background:var(--ent-danger-soft); color:var(--ent-danger); border-color:var(--ent-tone-negative-line); } .pc-btn.reject:hover { background:var(--ent-danger); color:var(--ent-text-on-accent); border-color:var(--ent-danger); }

/* ── Compliance ───────────────────────────────────────────────────────── */
.compliance-stats { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:4px; margin-bottom:8px; }
.cs-card { display:flex; flex-direction:column; align-items:center; padding:6px; border-radius:6px; font-size:0.625rem; gap:2px; border:1px solid; }
.cs-card span { font-size:15px; font-weight:800; }
.cs-card small { color:var(--ent-text-2); }
.cs-card.red    { background:var(--ent-danger-soft); color:var(--ent-danger); border-color:var(--ent-tone-negative-line); }
.cs-card.orange { background:var(--ent-warning-soft); color:var(--ent-warning); border-color:var(--ent-tone-warning-line); }
.cs-card.yellow { background:var(--ent-warning-soft); color:var(--ent-warning); border-color:var(--ent-tone-warning-line); }
.cs-card.green  { background:var(--ent-success-soft); color:var(--ent-success); border-color:var(--ent-tone-positive-line); }
.violation-list { display:flex; flex-direction:column; gap:6px; }
.violation-card { background:var(--ent-surface-2); border-left:3px solid; border-radius:0 6px 6px 0; padding:8px; border-top:1px solid var(--ent-line); border-right:1px solid var(--ent-line); border-bottom:1px solid var(--ent-line); }
.violation-card.critical { border-left-color:var(--ent-danger); }
.violation-card.high     { border-left-color:var(--ent-warning); }
.violation-card.medium   { border-left-color:var(--ent-warning); }
.vc-head { display:flex; align-items:center; gap:6px; margin-bottom:4px; }
.vc-severity { padding:2px 6px; border-radius:4px; font-size:0.625rem; font-weight:800; }
.vc-severity.critical { background:var(--ent-danger-soft); color:var(--ent-danger); border:1px solid var(--ent-tone-negative-line); }
.vc-severity.high     { background:var(--ent-warning-soft); color:var(--ent-warning); border:1px solid var(--ent-tone-warning-line); }
.vc-severity.medium   { background:var(--ent-warning-soft); color:var(--ent-warning); border:1px solid var(--ent-tone-warning-line); }
.vc-id { font-size:0.625rem; color:var(--ent-text-2); margin-left:auto; }
.vc-resolved { font-size:0.625rem; color:var(--ent-success); font-weight:700; }
.vc-title { font-size:0.8rem; color:var(--ent-text); margin-bottom:3px; font-weight:500; }
.vc-meta { font-size:0.6875rem; color:var(--ent-text-2); margin-bottom:5px; }
.vc-actions { display:flex; gap:4px; }
.vc-btn { display:flex; align-items:center; gap:4px; padding:4px 8px; border:1px solid; border-radius:4px; cursor:pointer; font-size:0.6875rem; font-weight:600; }
.vc-btn.stop-work { background:var(--ent-danger-soft); color:var(--ent-danger); border-color:var(--ent-tone-negative-line); } .vc-btn.stop-work:hover { background:var(--ent-danger); color:var(--ent-text-on-accent); border-color:var(--ent-danger); }
.vc-btn.fine      { background:var(--ent-warning-soft); color:var(--ent-warning); border-color:var(--ent-tone-warning-line); } .vc-btn.fine:hover { background:var(--ent-warning); color:var(--ent-text-on-accent); border-color:var(--ent-warning); }
.vc-btn.resolve   { background:var(--ent-success-soft); color:var(--ent-success); border-color:var(--ent-tone-positive-line); } .vc-btn.resolve:hover { background:var(--ent-success); color:var(--ent-text-on-accent); border-color:var(--ent-success); }

/* ── Reports ──────────────────────────────────────────────────────────── */
.report-form { background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:6px; padding:10px; }
.rf-label { display:block; font-size:0.625rem; color:var(--ent-text-2); text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px; margin-top:8px; font-weight:700; }
.rf-row { display:flex; align-items:center; gap:6px; }
.eo-input { padding:5px 8px; background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:6px; color:var(--ent-text); font-size:0.8125rem; outline:none; }
.eo-input:focus { border-color:var(--ent-text); }
.rf-checkboxes { display:flex; flex-direction:column; gap:4px; margin-bottom:8px; }
.rf-check { display:flex; align-items:center; gap:6px; font-size:0.75rem; color:var(--ent-text); cursor:pointer; }
.rf-export-btns { display:flex; gap:6px; }
.rf-btn { display:flex; align-items:center; gap:5px; padding:6px 12px; border:1px solid; border-radius:6px; cursor:pointer; font-size:0.75rem; font-weight:600; }
.rf-btn.pdf   { background:var(--ent-danger-soft); color:var(--ent-danger); border-color:var(--ent-tone-negative-line); }
.rf-btn.excel { background:var(--ent-success-soft); color:var(--ent-success); border-color:var(--ent-tone-positive-line); }
.rf-btn.print { background:var(--ent-accent-soft); color:var(--ent-accent); border-color:var(--ent-accent-line); }
.rf-btn:hover { opacity:.85; }
.report-history { margin-top:4px; }
.rh-row { display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--ent-line); }
.rh-info { flex:1; }
.rh-title { display:block; font-size:0.75rem; color:var(--ent-text); font-weight:500; }
.rh-meta  { display:block; font-size:0.6875rem; color:var(--ent-text-2); }
.rh-dl { background:none; border:none; cursor:pointer; color:var(--ent-text-2); padding:3px; border-radius:4px; }
.rh-dl:hover { color:var(--ent-text); background:var(--ent-surface-2); }

/* ── Audit ────────────────────────────────────────────────────────────── */
.audit-search { display:flex; align-items:center; gap:6px; padding:5px 8px; background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:6px; margin-bottom:8px; }
.audit-search .eo-input { background:none; border:none; flex:1; padding:0; font-size:0.8125rem; color:var(--ent-text); }
.audit-list { display:flex; flex-direction:column; gap:4px; }
.audit-entry { display:flex; gap:8px; padding:6px; background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:5px; }
.ae-icon { width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.ae-icon.approved { background:var(--ent-success-soft); color:var(--ent-success); }
.ae-icon.rejected { background:var(--ent-danger-soft); color:var(--ent-danger); }
.ae-icon.modified { background:var(--ent-accent-soft); color:var(--ent-accent); }
.ae-icon.created  { background:var(--ent-accent-soft); color:var(--ent-accent); }
.ae-icon.fine     { background:var(--ent-warning-soft); color:var(--ent-warning); }
.ae-icon.stopwork { background:var(--ent-danger-soft); color:var(--ent-danger); }
.ae-body { flex:1; }
.ae-title { font-size:0.75rem; color:var(--ent-text); font-weight:500; }
.ae-meta  { font-size:0.6875rem; color:var(--ent-text-2); margin-top:2px; }
.ae-ref   { font-size:0.6875rem; color:var(--ent-accent); margin-top:1px; }
.ae-action-label { font-size:0.625rem; font-weight:700; padding:2px 6px; border-radius:4px; align-self:flex-start; text-transform:capitalize; border:1px solid; }
.ae-action-label.approved { background:var(--ent-success-soft); color:var(--ent-success); border-color:var(--ent-tone-positive-line); }
.ae-action-label.rejected { background:var(--ent-danger-soft); color:var(--ent-danger); border-color:var(--ent-tone-negative-line); }
.ae-action-label.modified { background:var(--ent-accent-soft); color:var(--ent-accent); border-color:var(--ent-accent-line); }
.ae-action-label.created  { background:var(--ent-accent-soft); color:var(--ent-accent); border-color:var(--ent-accent-line); }
.ae-action-label.fine     { background:var(--ent-warning-soft); color:var(--ent-warning); border-color:var(--ent-tone-warning-line); }
.ae-action-label.stopwork { background:var(--ent-danger-soft); color:var(--ent-danger); border-color:var(--ent-tone-negative-line); }

/* ── Master Plan ──────────────────────────────────────────────────────── */
.mp-progress-header { display:flex; align-items:center; justify-content:space-between; padding:10px; background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:6px; margin-bottom:8px; }
.mp-overall { display:flex; flex-direction:column; }
.mp-pct { font-size:28px; font-weight:800; color:var(--ent-text); }
.mp-label { font-size:0.625rem; color:var(--ent-text-2); }
.mp-donut-wrap { width:48px; height:48px; }
.mp-donut { width:100%; height:100%; }
.mp-plan-list { display:flex; flex-direction:column; gap:6px; }
.mp-plan-card { background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:6px; padding:8px; }
.mp-plan-card.active { border-color:var(--ent-line-strong); background:var(--ent-surface-2); }
.mpc-head { display:flex; align-items:center; gap:6px; margin-bottom:4px; flex-wrap:wrap; }
.mpc-name { font-size:0.75rem; font-weight:700; color:var(--ent-text); flex:1; }
.mpc-year { font-size:0.625rem; color:var(--ent-text-2); }
.mpc-status { padding:2px 6px; border-radius:10px; font-size:0.625rem; font-weight:700; border:1px solid; }
.mpc-status.active   { background:var(--ent-success-soft); color:var(--ent-success); border-color:var(--ent-tone-positive-line); }
.mpc-status.review   { background:var(--ent-warning-soft); color:var(--ent-warning); border-color:var(--ent-tone-warning-line); }
.mpc-status.draft    { background:var(--ent-surface-2); color:var(--ent-text-2); border-color:var(--ent-line); }
.mpc-status.approved { background:var(--ent-accent-soft); color:var(--ent-accent); border-color:var(--ent-accent-line); }
.mpc-desc { font-size:0.6875rem; color:var(--ent-text-2); margin-bottom:6px; }
.mpc-bar-wrap { height:4px; background:var(--ent-surface-sunken); border-radius:2px; overflow:hidden; margin-bottom:4px; }
.mpc-bar { height:100%; border-radius:2px; }
.mpc-footer { display:flex; justify-content:space-between; font-size:0.6875rem; color:var(--ent-text-2); }
.mpc-deviation { display:flex; align-items:center; gap:4px; font-size:0.6875rem; color:var(--ent-warning); margin-top:4px; padding:3px 6px; background:var(--ent-warning-soft); border:1px solid var(--ent-tone-warning-line); border-radius:4px; }

/* ── Modals ───────────────────────────────────────────────────────────── */
.modal-backdrop { position:fixed; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:9000; }
.review-modal, .enforcement-modal { background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:10px; width:560px; max-width:95vw; max-height:85vh; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.15); }
.rm-head { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid var(--ent-line); }
.rm-head h3 { font-size:0.875rem; font-weight:700; color:var(--ent-text); }
.rm-head button { background:none; border:none; color:var(--ent-text-2); cursor:pointer; padding:4px; border-radius:4px; }
.rm-head button:hover { color:var(--ent-text); background:var(--ent-surface-2); }
.rm-body { padding:16px; overflow-y:auto; flex:1; }
.rm-title { font-size:0.9375rem; font-weight:700; color:var(--ent-text); margin-bottom:4px; }
.rm-meta  { font-size:0.8125rem; color:var(--ent-text-2); margin-bottom:12px; }
.rm-site { display:flex; flex-direction:column; gap:8px; margin-bottom:12px; }
.rm-locate { margin-left:auto; }
.rm-notes { display:flex; flex-direction:column; gap:6px; margin-bottom:12px; padding:10px; border:1px solid var(--ent-line); border-radius:6px; background:var(--ent-surface-2); }
.rm-notes p { margin:0; font-size:0.8125rem; color:var(--ent-text); }
.rm-notes strong { display:block; font-size:0.6875rem; color:var(--ent-text-2); text-transform:uppercase; letter-spacing:.3px; }
.rm-overlay-title { display:flex; align-items:center; gap:6px; font-size:0.6875rem; font-weight:700; color:var(--ent-text-2); text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px; }
.rm-comment { width:100%; padding:8px; background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:6px; color:var(--ent-text); font-size:0.8125rem; resize:vertical; font-family:inherit; box-sizing:border-box; outline:none; }
.rm-comment:focus { border-color:var(--ent-text); background:var(--ent-surface); }
.rm-comment-wrap { margin-top:8px; }
.rm-footer { display:flex; gap:8px; padding:12px 16px; border-top:1px solid var(--ent-line); flex-wrap:wrap; }
.rm-btn { display:flex; align-items:center; gap:6px; padding:8px 14px; border:1px solid; border-radius:6px; cursor:pointer; font-size:0.8125rem; font-weight:600; }
.rm-btn.approve { background:var(--ent-success-soft); color:var(--ent-success); border-color:var(--ent-tone-positive-line); } .rm-btn.approve:hover { background:var(--ent-success); color:var(--ent-text-on-accent); border-color:var(--ent-success); }
.rm-btn.revise  { background:var(--ent-accent-soft); color:var(--ent-accent); border-color:var(--ent-accent-line); } .rm-btn.revise:hover { background:var(--ent-accent); color:var(--ent-text-on-accent); border-color:var(--ent-accent); }
.rm-btn.reject  { background:var(--ent-danger-soft); color:var(--ent-danger); border-color:var(--ent-tone-negative-line); } .rm-btn.reject:hover { background:var(--ent-danger); color:var(--ent-text-on-accent); border-color:var(--ent-danger); }
.rm-btn.cancel  { background:var(--ent-surface-2); color:var(--ent-text-2); border-color:var(--ent-line); margin-left:auto; } .rm-btn.cancel:hover { background:var(--ent-text-3); }

/* ── Ward Markers ─────────────────────────────────────────────────────── */
:global(.eo-ward-marker) { width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:9px; font-weight:800; color:var(--ent-text-on-accent); border:2px solid rgba(255,255,255,.5); cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,0.2); }
:global(.eo-identify-marker) { width:14px; height:14px; border-radius:50%; background:var(--ent-text); border:2px solid var(--ent-surface); box-shadow:0 1px 4px rgba(15,23,42,.45); }
:global(.eo-user-marker) { position:relative; width:20px; height:20px; }
:global(.uml-dot) { position:absolute; inset:6px; background:var(--ent-accent); border-radius:50%; z-index:2; }
:global(.uml-ring) { position:absolute; inset:0; border:2px solid rgba(37,99,235,0.4); border-radius:50%; animation:ring-pulse 2s infinite; }
@keyframes ring-pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.6);opacity:0} }

/* ── Toast ────────────────────────────────────────────────────────────── */
/* Citizen Reports panel */
.cr-list { display:flex; flex-direction:column; gap:0.5rem; margin-top:0.5rem; }
.cr-card { border:1px solid var(--ent-line); border-radius:8px; padding:0.625rem 0.75rem; background:var(--ent-surface); }
.cr-card.cr-actioned { opacity:0.55; }
.cr-head { display:flex; align-items:center; gap:0.5rem; margin-bottom:0.25rem; }
.cr-type { font-size:0.7rem; font-weight:700; color:var(--ent-text); background:var(--ent-surface-2); padding:0.1rem 0.45rem; border-radius:4px; }
.cr-status { font-size:0.65rem; font-weight:700; text-transform:uppercase; padding:0.1rem 0.4rem; border-radius:4px; margin-left:auto; }
.cr-status.submitted           { background:var(--ent-accent-soft); color:var(--ent-accent); }
.cr-status.received            { background:var(--ent-success-soft); color:var(--ent-success); }
.cr-status.under_investigation { background:var(--ent-warning-soft); color:var(--ent-warning); }
.cr-status.actioned            { background:var(--ent-success-soft); color:var(--ent-success); }
.cr-status.closed              { background:var(--ent-surface-2); color:var(--ent-text-2); }
.cr-summary { font-size:0.8rem; color:var(--ent-text); margin-bottom:0.25rem; }
.cr-meta { font-size:0.7rem; color:var(--ent-text-3); display:flex; gap:0.375rem; flex-wrap:wrap; align-items:center; }
.cr-ref { background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:3px; padding:0 0.3rem; font-size:0.65rem; color:var(--ent-text-2); }
.cr-actions { display:flex; gap:0.375rem; margin-top:0.375rem; }

.eo-toast { position:fixed; bottom:20px; right:20px; z-index:9999; display:flex; align-items:center; gap:8px; padding:10px 16px; border-radius:8px; font-size:0.8125rem; font-weight:600; box-shadow:0 4px 20px rgba(0,0,0,0.12); }
.eo-toast.success { background:var(--ent-success-soft); color:var(--ent-success); border:1px solid var(--ent-tone-positive-line); }
.eo-toast.error   { background:var(--ent-danger-soft); color:var(--ent-danger); border:1px solid var(--ent-tone-negative-line); }
.eo-toast.warning { background:var(--ent-warning-soft); color:var(--ent-warning); border:1px solid var(--ent-tone-warning-line); }
.toast-enter-active, .toast-leave-active { transition:all .3s; }
.toast-enter-from, .toast-leave-to { opacity:0; transform:translateX(20px); }

/* ── Utils ────────────────────────────────────────────────────────────── */
.spin-icon { animation:spin .8s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }

/* ── GIS Layer Switcher ───────────────────────────────────────────────── */
.layer-loading-badge { font-size:0.65rem; font-weight:700; padding:0.1rem 0.5rem; border-radius:9999px; background:var(--ent-warning-soft); color:var(--ent-warning); margin-left:auto; }
.layer-count-badge   { font-size:0.65rem; font-weight:700; padding:0.1rem 0.5rem; border-radius:9999px; background:var(--ent-accent-soft); color:var(--ent-accent); margin-left:auto; }
.eo-layer-list { display:flex; flex-direction:column; gap:0.375rem; margin-top:0.25rem; }
.eo-layer-row {
  display:flex; align-items:center; gap:0.5rem;
  padding:0.5rem; border-radius:0.5rem; cursor:pointer;
  border:1px solid transparent; transition:all 0.12s;
}
.eo-layer-row:hover { background:var(--ent-text-3); border-color:var(--ent-line); }
.eo-layer-row.active { background:var(--ent-surface-2); border-color:var(--ent-line); }
.eo-layer-row input { width:0.875rem; height:0.875rem; accent-color:var(--ent-text); flex-shrink:0; cursor:pointer; }
.eo-layer-dot  { width:0.625rem; height:0.625rem; border-radius:2px; flex-shrink:0; }
.eo-layer-info { flex:1; min-width:0; }
.eo-layer-name { font-size:0.8rem; font-weight:600; color:var(--ent-text); display:block; }
.eo-layer-desc { font-size:0.6875rem; color:var(--ent-text-3); display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.eo-layer-badge { font-size:0.6rem; font-weight:700; padding:0.1rem 0.375rem; border-radius:9999px; flex-shrink:0; }
/* Profile chip + account window now live in <ProfileDropdown>. */

/* ══ ZONES TAB ══════════════════════════════════════════════════════════ */
.zones-tab { display:flex; flex-direction:column; gap:8px; }
.zones-loading, .zones-empty, .zones-error {
  font-size:12px; color:var(--ent-text-3); padding:10px 0; text-align:center;
  display:flex; align-items:center; gap:6px; justify-content:center; }
.zones-error { color:var(--ent-danger); }
.zones-list { display:flex; flex-direction:column; gap:3px; max-height:200px; overflow-y:auto; }
.zone-row {
  padding:6px 8px; border-radius:6px; cursor:pointer; border:1px solid transparent;
  transition:all 0.12s; }
.zone-row:hover { background:var(--ent-text-3); border-color:var(--ent-line); }
.zone-row.selected { background:var(--ent-accent-soft); border-color:var(--ent-accent-line); }
.zone-row.inactive { opacity:0.5; }
.zone-row-body { display:flex; align-items:center; gap:6px; }
.zone-name { font-size:12px; font-weight:600; color:var(--ent-text); flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.zone-type-badge { font-size:9px; font-weight:700; background:var(--ent-surface-2); color:var(--ent-text-2);
  padding:1px 5px; border-radius:9999px; white-space:nowrap; }
.zone-row-meta { display:flex; gap:6px; font-size:10px; color:var(--ent-text-3); margin-top:2px; }
.zone-status.active   { color:var(--ent-success); font-weight:700; }
.zone-status.inactive { color:var(--ent-danger); font-weight:700; }

.zone-detail { border-top:1px solid var(--ent-line); padding-top:8px; }
.zone-detail-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
.zone-detail-head strong { font-size:12px; font-weight:700; color:var(--ent-text); }
.zone-detail-actions { display:flex; gap:4px; }
.zone-meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:4px 8px; margin-bottom:8px; }
.zone-meta-grid > div { display:flex; flex-direction:column; gap:1px; }
.zone-meta-grid span  { font-size:9px; color:var(--ent-text-3); text-transform:uppercase; letter-spacing:0.06em; }
.zone-meta-grid strong { font-size:11px; color:var(--ent-text); font-weight:600; }

.controls-head { display:flex; align-items:center; justify-content:space-between;
  font-size:11px; font-weight:600; color:var(--ent-text); padding:4px 0 6px; }
.controls-list { display:flex; flex-direction:column; gap:3px; }
.control-row { display:flex; align-items:center; gap:6px;
  padding:4px 6px; border-radius:5px; background:var(--ent-surface-2); }
.ct-badge { font-size:9px; font-weight:700; padding:1px 5px; border-radius:9999px;
  flex-shrink:0; text-transform:capitalize; }
.ct-badge.permitted       { background:var(--ent-success-soft); color:var(--ent-success); }
.ct-badge.special_consent { background:var(--ent-warning-soft); color:var(--ent-warning); }
.ct-badge.prohibited      { background:var(--ent-danger-soft); color:var(--ent-danger); }
.ct-name { flex:1; font-size:11px; color:var(--ent-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ct-del  { background:none; border:none; color:var(--ent-text-3); cursor:pointer; padding:2px; border-radius:3px; flex-shrink:0; }
.ct-del:hover { color:var(--ent-danger); background:var(--ent-danger-soft); }

.eo-mini-btn {
  display:inline-flex; align-items:center; gap:3px;
  padding:3px 7px; border:1px solid var(--ent-line); border-radius:5px;
  background:var(--ent-surface); color:var(--ent-text); font-size:10px; font-weight:600; cursor:pointer; }
.eo-mini-btn:hover { background:var(--ent-text-3); }
.eo-mini-btn.danger { color:var(--ent-danger); border-color:var(--ent-tone-negative-line); }
.eo-mini-btn.danger:hover { background:var(--ent-danger); color:var(--ent-text-on-accent); border-color:var(--ent-danger); }
.zone-modal { background:var(--ent-surface); border-radius:10px; width:400px; max-width:95vw;
  box-shadow:0 20px 60px rgba(0,0,0,0.25); }
</style>
