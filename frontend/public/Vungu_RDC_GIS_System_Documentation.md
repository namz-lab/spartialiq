# Vungu RDC GIS System Documentation

## 1. Purpose and Scope

This document expands the current system documentation so it reflects the web application that is now implemented in the frontend, not only the legacy "Phase 2" admin modules.

The Vungu RDC GIS System is a multi-role web portal for:

- public access to district spatial information
- authenticated access to dashboards and analytics
- online development permit applications
- parcel-based planning and land-use checks
- internal planning workflows for officers and executives
- administrative user management, land-use configuration, QGIS integration, and security monitoring

The current portal covers Vungu Rural District in Midlands Province, Zimbabwe, including 20 wards and district-wide planning, environmental, and infrastructure layers.

## 2. Main Technology and Data Context

The web app combines:

- Vue 3 single-page application routes
- interactive web mapping
- OGC-aligned spatial services, including WMS and WFS usage
- QGIS-aligned layer styling and integration
- role-based routing and dashboard access
- document upload, PDF generation, and application tracking workflows

The About page presents the portal as an open-standards GIS platform for planners, environmental officers, administrators, researchers, developers, and communities.

## 3. User Roles and Access Model

The frontend currently exposes the following practical access patterns:

| Role or access level | Main experience |
| --- | --- |
| Public visitor | Home page, About page, registration, login, map-facing portal entry points |
| Registered or viewer user | Analytics and standard authenticated views |
| Planner | Planner workspace and planning tools |
| Admin | IT administration, employee access management, land-use management, QGIS integration, security tools |
| E.O. demo access | Executive Officer command centre workflow |

### Demo access currently available in the login screen

The login page includes demo accounts for testing:

| Label | Email | Password | Target area |
| --- | --- | --- | --- |
| E.O. Planning | `demo.eo@vungu.test` | `demo1234` | `/eo-planner` |
| Planner | `demo.planner@vungu.test` | `demo1234` | `/planner` |
| Admin | `demo.admin@vungu.test` | `demo1234` | `/admin/users` |
| Viewer | `demo.viewer@vungu.test` | `demo1234` | `/analytics` |

## 4. Core Application Modules

### 4.1 Public landing and information pages

The public-facing portal includes:

- `/` home page with portal overview, live map preview, datasets, statistics, and entry points
- `/about` about page with mission, district coverage, platform capabilities, standards, and contact information
- `/register` account creation
- `/login` sign-in, including demo account shortcuts

The home page highlights these public data categories:

- urban planning zones
- development areas
- environmental zones
- health facilities
- schools and education
- infrastructure
- development permit applications

### 4.2 Interactive Map Explorer

The main explorer route is `/explorer`.

Documented functionality visible in the app includes:

- switchable base maps: Streets, Satellite, and Terrain
- grouped layer browsing for QGIS Server layers and database layers
- refresh and hide-all actions for layers
- active layer counts and feature counts
- loading and unavailable-state feedback for layers
- map reset controls
- feature property inspection in a modal
- support for QGIS Server and dynamic backend layer loading

The explorer is effectively the system's general-purpose public GIS viewer.

### 4.3 Development Application Portal

The development permit flow is one of the most important modules now present in the web app.

Main entry route:

- `/development-application`

The portal is spatial-first. The workflow implemented in the UI is:

1. Discover a parcel on the map.
2. Check development eligibility automatically.
3. Select a permitted or consent-based land use.
4. Complete the application form.
5. Upload required supporting documents.
6. Review fees, declarations, and generated forms.
7. Submit and track the application.

#### Development tools available in the application portal

The top and bottom toolbars expose:

- Search
- Draw
- Measure
- Info

The map panel also supports:

- user location centering
- layer toggling
- reset view
- parcel selection
- contextual parcel analysis

#### Eligibility and zoning checks

The system currently checks parcel eligibility using zoning overlap.

Important rule implemented in the frontend:

- a parcel needs at least 25% overlap with a designated planning zone to proceed normally with development application workflows

The contextual panel displays:

- parcel name, parcel ID, and area
- detected zone and overlap percentage
- eligibility status
- permitted uses
- special-consent uses
- prohibited uses
- zone and land-use constraints

#### Land-use-driven workflow

Once a parcel is eligible, the portal lets the applicant choose from available land uses. The selected land use affects:

- the application workflow
- development options shown in the panel
- required supporting documents
- zone-specific compliance expectations

#### Site plan generation

The application step includes built-in site plan generation with:

- SVG download
- PDF download
- a preview panel
- metered dimensions
- Cape Lo Datum coordinate output for planning-oriented presentation

#### Application form capture

The review and form steps capture or display:

- applicant name
- contact email and phone
- physical address
- development type
- project description
- building height
- floor area
- number of units
- parking spaces
- project start and completion dates

#### Required document workflow

The document upload component supports:

- required and optional document presentation
- dynamic requirements based on zone and land use
- upload, replace, preview, download, and delete actions
- PDF, JPG, PNG, DOC, and DOCX files
- 10 MB per file limit in the current UI copy
- summary counters for total files, required files, and total size

Baseline required documents visible in the current workflow include:

- proof of ownership
- site plan
- building plans
- signed application form

Additional requirements can be added automatically for:

- environmental uses
- agricultural uses
- estates
- conservation areas
- irrigation farming
- urban expansion contexts
- land uses with height, unit, or minimum lot-size constraints

#### Review, save, and PDF output

The review step currently supports:

- section-by-section review
- fee breakdown display
- terms and conditions acknowledgement
- save and continue later
- PDF application form download

The review component saves draft application data to local storage under `draft-application`.

#### Fee handling in the current frontend

The portal already exposes fee logic and summaries, including:

- application fees
- planning fees
- building-related fees
- processing fees
- total calculated amount

The application flow also presents an estimated timeline of approximately 6 to 8 weeks for standard processing.

### 4.4 Submitted applications, details, and tracking

The current authenticated routes include:

- `/applications`
- `/applications/:id`
- `/applications/:id/track`

These pages provide:

- a "My Applications" list
- per-application status badges
- applicant and parcel details
- uploaded document summaries
- timeline events
- a visual progress tracker

Tracking steps currently shown in the tracking view are:

- Submitted
- Under Review
- Site Inspection
- Decision

### 4.5 Analytics Dashboard

The analytics route is:

- `/analytics`

The dashboard currently presents:

- KPI cards for applications, approvals, pending review, rejections, active layers, and registered users
- land-use distribution
- application status breakdown
- zone compliance rates
- monthly submission trends
- spatial layer inventory
- infrastructure coverage summaries
- officer workload
- zone summaries
- recent application tables

This is the main authenticated dashboard for operational spatial insights.

### 4.6 Planner workspace

The planner route is:

- `/planner`

The planner workspace contains an advanced map-and-workflow environment with:

- parcel, stand, ward, and address search
- ward selector with population, area, and stand counts
- layer switcher with visibility and opacity controls
- legend and task list
- base map switching
- draw and measure tools
- current cursor coordinate and zoom readouts
- property and feature information panels
- workflow actions such as change-of-use initiation
- yield and costing table
- traffic-light approval tracker

The planner interface is built for internal planning officers rather than public users.

### 4.7 Executive Officer command centre

The executive route is:

- `/eo-planner`

This dashboard is tailored for higher-level review and oversight. The current frontend includes:

- approval action queue
- quick approve, revise, and reject actions
- staff workload monitor
- ward activity summary
- executive GIS layer controls
- heatmap and map toggle controls
- advanced proposal review
- compliance and enforcement views
- dynamic report generation
- recent report download actions

The right-side workflow tabs cover:

- proposal review
- compliance and enforcement
- reporting

### 4.8 IT administration and employee access management

The main admin route is:

- `/admin`

The current admin area includes:

- employee list and filtering
- invite employee workflow
- invite link generation
- edit, suspend, reactivate, resend invite, and remove actions
- organisation structure view
- role access legend
- activity log
- system information
- pending invite display

This area is aimed at internal administrative access control rather than planning analysis.

### 4.9 Land Use Management

The land-use management route is:

- `/admin/land-use`

Current tabs implemented in the frontend are:

- Land Use Groups
- Land Use Zones
- Development Matrix
- Analytics

This module is important because it underpins parcel-level development control logic and permitted-use decisions in the application workflow.

### 4.10 QGIS Plugin Integration

The QGIS plugin route is:

- `/admin/qgis-plugin`

This page currently documents and exposes:

- QGIS integration status
- style sync status
- performance monitor status
- security audit status
- QGIS plugin download
- installation guide access
- API token generation and email actions
- token history and resend flow
- automated style synchronization
- performance metrics display

This is the clearest bridge between the web portal and desktop GIS operations.

### 4.11 Security dashboard

The security route is:

- `/admin/security-dashboard`

Security features visible in the current web app include:

- overview cards for critical events, failed logins, suspicious activities, blocked IPs, total events, and risk score
- threat analysis
- blocked IP review
- risk distribution
- recent event timeline with filters
- security recommendations
- report generation flow

### 4.12 Video tutorials and training resources

The training route is:

- `/admin/video-tutorials`

The tutorials portal currently provides:

- training cards
- topic coverage lists
- modal playback placeholders
- script downloads

The existing script library focuses mainly on the legacy Phase 2 admin training set, but it remains a useful support asset for administrators.

## 5. Important Workflow and Data Notes

### 5.1 Route structure worth documenting

These routes are important enough to include in formal documentation because they represent the main user journey:

| Route | Purpose |
| --- | --- |
| `/` | Public portal home |
| `/about` | District and platform background |
| `/login` | Authentication and demo access |
| `/register` | New account registration |
| `/explorer` | General GIS map explorer |
| `/development-application` | Submit a development permit application |
| `/applications` | View submitted applications |
| `/applications/:id` | View one application's details |
| `/applications/:id/track` | Track one application |
| `/analytics` | Authenticated dashboard |
| `/planner` | Planning officer workspace |
| `/eo-planner` | Executive command centre |
| `/admin` | IT admin dashboard |
| `/admin/land-use` | Land-use rules and matrix management |
| `/admin/qgis-plugin` | QGIS plugin and integration functions |
| `/admin/security-dashboard` | Security monitoring |
| `/admin/video-tutorials` | Training resources |

### 5.2 Persistence and prototype behaviour

Some parts of the current frontend use demo or local persistence patterns that should be documented honestly:

- demo logins are supported directly in the frontend
- invite data can be stored locally when backend invite flow is unavailable
- selected land use is stored in local storage
- saved draft applications are stored in local storage
- several dashboards display seeded or demonstration data while still showing the intended workflow design

### 5.3 Relationship to older Phase 2 documentation

The repository still contains the earlier documentation set:

- `PHASE2_USER_MANUAL.md`
- `PHASE2_ADMIN_GUIDE.md`
- `PHASE2_QUICK_START_GUIDE.md`
- `PHASE2_TROUBLESHOOTING_GUIDE.md`
- `PHASE2_API_REFERENCE.md`
- `PHASE2_VIDEO_TUTORIALS.md`
- `QGIS_PLUGIN_INSTALLATION_GUIDE.md`

Those files are still useful, especially for older admin-oriented flows, but they do not fully describe the current web portal now present in the frontend.

## 6. What This Document Adds Beyond the Older Manual

Compared with the earlier Phase 2 manual, this expanded document now covers:

- the public home and about pages
- authentication and demo access patterns
- the map explorer
- the full development permit workflow
- application review, draft saving, and tracking pages
- the analytics dashboard
- the planner workspace
- the Executive Officer command centre
- the IT admin user-management area
- land-use management
- QGIS plugin integration
- security monitoring
- training and tutorial access

## 7. Recommended Next Documentation Improvements

If the documentation will continue to evolve, the next high-value additions should be:

- screenshots for each major module
- a role-by-role user journey section
- a formal data dictionary for layer names and attributes
- a backend integration note that clearly separates live data from demo data
- a deployment appendix for environment variables, services, and URLs
- a changelog section describing when each module was added
