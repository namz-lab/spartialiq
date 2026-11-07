import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import type { Role } from '../services/types'
import { routePattern, trackPageView } from '../services/analytics'
import { GMS_CAN } from '../services/gms'

// Typed route metadata. Declaring these here means a typo in `meta.roles`
// (or a role string the backend cannot issue) is a compile error rather than
// a guard that silently never matches.
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    requiresAuth?: boolean
    requiresAdmin?: boolean
    hideForAuth?: boolean
    /** Roles allowed to open this route. Omit for "any authenticated user". */
    roles?: readonly Role[]
    /** GIS portal section a /gis/* route opens (GISOfficerPortalView). */
    gisSection?: string
  }
}

// ── Role groups ────────────────────────────────────────────────────────
// Named once, referenced by `meta.roles` on the routes below. These reproduce
// the previous hand-written allow-lists exactly — M0.2 refactors how
// authorisation is expressed, not who can reach what.
//
// 'admin' appears throughout because the backend permits it throughout; see
// the ADMIN_BLOCKED caveat further down.

/** Every council staff role. Guards surfaces carrying applicant PII. */
const COUNCIL_STAFF: readonly Role[] = [
  'planner', 'planning_clerk', 'eo', 'gis_officer', 'env_officer',
  'building_inspector', 'surveyor', 'admin',
]

/** A role's own workspace, plus planning oversight. */
const withOversight = (...owners: Role[]): readonly Role[] => [...owners, 'admin', 'planner']

// Import views
const HomeView = () => import('../views/HomeView.vue')
const MapExplorer = () => import('../views/MapExplorer.vue')
const ExploreView = () => import('../views/ExploreView.vue')
const LayersView = () => import('../views/LayersView.vue')
const AnalyticsView = () => import('../views/AnalyticsView.vue')
const AboutView = () => import('../views/view/AboutView.vue')
const ServicesView = () => import('../views/view/ServicesView.vue')
const LoginView = () => import('../views/LoginView.vue')
const RegisterView = () => import('../views/RegisterView.vue')
const ForgotPasswordView = () => import('../views/ForgotPasswordView.vue')
const ResetPasswordView = () => import('../views/ResetPasswordView.vue')
const ProfileView = () => import('../views/ProfileView.vue')
// The council IT Administration console: fifteen sections on one route, with
// the open section and its filters in the query (src/admin/console.ts).
// Replaces AdminView.vue, whose four tabs held a hardcoded org chart and a
// session-only "activity log" that no backend ever wrote to.
const AdminWorkspaceView = () => import('../views/AdminWorkspaceView.vue')
const QGISPluginView = () => import('../views/admin/QGISPluginView.vue')
// Enterprise GIS symbology registry: which style version is live on every
// layer, where it was authored, who approved it, and the publish/rollback path.
const GisSymbologyRegistryView = () => import('../views/admin/GisSymbologyRegistryView.vue')
// Live-sync verification: per layer, whether a QGIS Desktop save reaches an
// open browser tab, and which link of the chain is open if it does not.
const PipelineSyncView = () => import('../views/admin/PipelineSyncView.vue')
const PlanWorkbenchView = () => import('../views/admin/PlanWorkbenchView.vue')
const PlanAuditView = () => import('../views/admin/PlanAuditView.vue')
const PlanLookupView = () => import('../views/PlanLookupView.vue')
const LandUseManagementView = () => import('../views/admin/LandUseManagementView.vue')
const InviteAcceptView = () => import('../views/InviteAcceptView.vue')
const QGISMapView = () => import('../views/QGISMapView.vue')
const PlannerShell = () => import('../views/planner/PlannerShell.vue')
const PlanningStudio = () => import('../views/planner/PlanningStudio.vue')
// Role workspaces: map pane + sections console in one shell.
//
// These three routes used to point straight at the legacy map-bearing views,
// because the newer section consoles had dropped the per-role map. That traded
// one half of each workspace for the other and left ~7,000 LOC of sections
// unreachable (audit F17). Each route now serves a RoleWorkspaceShell hosting
// BOTH — the same pattern PlannerShell has always used for the planner — so
// neither half has to be given up.
const EOPlannerWorkspace  = () => import('../views/EOPlannerWorkspace.vue')
const EnvOfficerWorkspace = () => import('../views/EnvOfficerWorkspace.vue')
const InspectorWorkspace  = () => import('../views/InspectorWorkspace.vue')
// Legacy intake views (DevelopmentApplicationView, ApplicationsListView,
// ApplicationDetailView, ApplicationTrackingView, ApplicationConfirmationView,
// ApplicationSuccessView, OnlineApplicationsView, OnlineApplicationFormView)
// were retired in the intake-unification work (audit C1/C5/M3). Every
// development application now flows through the Citizen Portal at /citizen →
// useCitizenCase → dmApi.createPermit → POST /permit-applications. The old
// routes are kept below only as redirects so existing links/bookmarks resolve.
const CitizenPortalView = () => import('../views/CitizenPortalView.vue')
// Statutory (RTCP Act [Ch. 29:12]) planner workspace — Phase A (planner only).
const GISMapView = () => import('../views/GISMapView.vue')
const NotFoundView = () => import('../views/NotFoundView.vue')
const PaymentGatewayView = () => import('../views/PaymentGatewayView.vue')
const PaymentReceiptView = () => import('../views/PaymentReceiptView.vue')
const PlanningClerkPortalView = () => import('../views/PlanningClerkPortalView.vue')
const SurveyorJobsView = () => import('../views/SurveyorJobsView.vue')  // the council's survey job queue
const SurveyorConsoleView = () => import('../views/SurveyorView.vue')  // map console: GIS map + task queue + per-task capture
// Survey Task Manager child routes, all lazy.
const GISOfficerPortalView = () => import('../views/GISOfficerPortalView.vue')

// Citizen surfaces wired in this round (Turn C/D follow-up).
const PaymentsView    = () => import('../views/PaymentsView.vue')
const DocumentsView   = () => import('../views/DocumentsView.vue')
const PlanReviewView  = () => import('../views/PlanReviewView.vue')
const LegalView       = () => import('../views/LegalView.vue')

// Public council pages migrated from the old static vungurdc.org.zw site.
// One generic component renders every page by slug; content is editable by
// the IT Admin via /admin/content (see ContentManagementView).
const CouncilPageView = () => import('../views/council/CouncilPageView.vue')
const ContactView     = () => import('../views/council/ContactView.vue')
const ContentManagementView = () => import('../views/admin/ContentManagementView.vue')
const StatutoryRegistersView = () => import('../views/StatutoryRegistersView.vue')
const FinanceWorkspaceView = () => import('../views/FinanceWorkspaceView.vue')
const TitleNoticesView = () => import('../views/TitleNoticesView.vue')
const CustodianDeskView = () => import('../views/CustodianDeskView.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: { title: 'Home - Vungu Spatial Data Portal' }
    },
    {
      // Public: "what can I build here?" A stand number or farm name in, what the published plan says out.
      path: '/lookup',
      name: 'plan-lookup',
      component: PlanLookupView,
      meta: { title: 'What can I build here? - Vungu Spatial Data Portal' }
    },
    {
      path: '/explorer',
      name: 'map-explorer',
      component: MapExplorer,
      meta: { title: 'Map Explorer - Vungu Spatial Data Portal' }
    },
    {
      path: '/explore',
      name: 'explore',
      component: ExploreView,
      meta: { title: 'Explore - Vungu Spatial Data Portal' }
    },
    {
      path: '/layers',
      name: 'layers',
      component: LayersView,
      meta: { title: 'Layers - Vungu Spatial Data Portal' }
    },
    {
      path: '/analytics',
      name: 'analytics',
      component: AnalyticsView,
      meta: {
        title: 'Analytics - Vungu Spatial Data Portal',
        requiresAuth: true,
        // Officer workload and the application register — council-internal.
        roles: COUNCIL_STAFF,
      }
    },
    {
      path: '/about',
      name: 'about',
      component: AboutView,
      meta: { title: 'About Vungu RDC - Vungu Portal' }
    },
    {
      path: '/services',
      name: 'services',
      component: ServicesView,
      meta: { title: 'Council Services - Vungu Portal' }
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: {
        title: 'Login - Vungu Spatial Data Portal',
        // Matches /register: an already-signed-in user hitting /login lands on
        // their role home instead of a form they cannot use.
        hideForAuth: true,
      }
    },
    {
      path: '/register',
      name: 'register',
      component: RegisterView,
      meta: {
        title: 'Register - Vungu Spatial Data Portal',
        hideForAuth: true
      }
    },
    {
      // Account recovery. Deliberately NOT hideForAuth: someone already
      // signed in on one device may be recovering a second account, and
      // bouncing them to a workspace mid-recovery is the sort of thing that
      // sends them to the IT desk instead.
      path: '/forgot-password',
      name: 'forgot-password',
      component: ForgotPasswordView,
      meta: { title: 'Reset your password - Vungu RDC Portal' },
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: ResetPasswordView,
      meta: { title: 'Set a new password - Vungu RDC Portal' },
    },
    {
      path: '/profile',
      name: 'profile',
      component: ProfileView,
      meta: { 
        title: 'Profile - Vungu Spatial Data Portal',
        requiresAuth: true
      }
    },
    {
      // One route, fifteen sections. The open section and its filters live in
      // the query rather than in the path, because they are a VIEW of one
      // console and not separate destinations — and because a filtered audit
      // trail has to be a link somebody can paste into a support thread.
      path: '/admin',
      name: 'admin',
      component: AdminWorkspaceView,
      meta: {
        title: 'IT Administration — Vungu RDC',
        requiresAuth: true,
        requiresAdmin: true
      }
    },
    {
      // Was a second, separate admin sign-in screen posting to
      // /api/admin/auth/login — an endpoint that does not exist in the
      // backend, so it could never succeed. Its whole chain (AdminLoginView →
      // stores/admin → services/adminService → types/admin, 1,194 LOC) was
      // unreachable and has been removed. Council IT signs in at /login like
      // every other role; roleHome() then lands 'admin' on /admin/users.
      // Kept as a redirect so old bookmarks resolve instead of 404ing.
      path: '/admin/login',
      redirect: '/login',
    },
    {
      // Phase2View probed four /api/admin/*/statistics endpoints that are not
      // registered, over tables (data_cleaning_jobs, qml_style_templates,
      // approval_workflows, batch_jobs) that migration 002 declares and no
      // Vungu database has ever had. It said so honestly on screen — "no
      // Phase 2 service is responding" — which is 1,329 lines of console
      // reporting its own absence. Retired; the System sections show what the
      // database actually holds.
      path: '/admin/phase2',
      redirect: '/admin?section=health',
    },
    {
      // Six "tutorials", every one with videoUrl: null, illustrated from
      // via.placeholder.com — an external CDN this application does not use
      // (ADR: everything is self-hosted). The real material is the markdown in
      // public/, which Integrations links directly.
      path: '/admin/video-tutorials',
      redirect: '/admin?section=integrations',
    },
    {
      // Superseded by the console's Security sections, which read the tables
      // migration 124 creates. The old dashboard called
      // /qgis-plugin/security/metrics and the own-user /auth/sessions, and
      // charted security_audit_log — a table that has never existed.
      path: '/admin/security-dashboard',
      redirect: '/admin?section=audit',
    },
    {
      path: '/admin/qgis-plugin',
      name: 'admin-qgis-plugin',
      component: QGISPluginView,
      meta: { 
        title: 'QGIS Plugin Integration - Vungu Spatial Data Portal',
        requiresAuth: true,
        requiresAdmin: true
      }
    },
    {
      // GIS officer / admin control surface for the symbology registry: active
      // style version per layer, provenance, approval, publish and rollback.
      // Admin-gated because publishing changes what every client renders.
      path: '/admin/gis-symbology',
      name: 'admin-gis-symbology',
      component: GisSymbologyRegistryView,
      meta: {
        title: 'GIS Symbology Registry - Vungu Spatial Data Portal',
        requiresAuth: true,
        // NOT requiresAdmin. The GIS Officer is the cartographic author — they
        // restyle layers in QGIS and publish the version every client renders —
        // so locking this to the IT Admin would shut the owner out of their own
        // tool. These two roles mirror STYLE_ADMINS in the backend's
        // src/routes/gisStyles.js exactly, so the route and the API agree on who
        // may publish. `planner` is absent on purpose: planners consume
        // symbology, they do not author it.
        roles: ['admin', 'gis_officer'],
      }
    },
    {
      // Verification surface for the QGIS -> web live-sync chain: per layer,
      // whether a PostGIS write reaches an open browser tab. Reached by URL and
      // from the symbology view, deliberately NOT a rail entry — it is a
      // diagnostic for a broken chain, not a daily task, and the GIS officer
      // console already carries eighteen sections.
      //
      // Same two roles as /admin/gis-symbology, for the same reason: the officer
      // authors the data and the admin owns the runtime, and both are the people
      // who need to know when the two are not talking. A planner consumes the
      // result and never edits it. Mirrors the requireRole on the backend's
      // GET /api/qgis/sync/coverage so the route and the API agree.
      path: '/admin/pipeline-sync',
      name: 'admin-pipeline-sync',
      component: PipelineSyncView,
      meta: {
        title: 'QGIS to Web Pipeline - Vungu Spatial Data Portal',
        requiresAuth: true,
        roles: ['admin', 'gis_officer'],
      },
    },
    {
      // Onboarding an authority and taking its plan from draft to gazetted. The rules are the
      // database's (migration 150); the backend's /api/workbench uses the same two roles.
      path: '/admin/plan-workbench',
      name: 'admin-plan-workbench',
      component: PlanWorkbenchView,
      meta: {
        title: 'Plan Workbench - Vungu Spatial Data Portal',
        requiresAuth: true,
        roles: ['admin', 'planner'],
      },
    },
    {
      // One plan's whole matrix and everything the audit found in it, for the council to read and print.
      // Read only; the roles are those the backend's audit and matrix reads allow.
      path: '/admin/plan-audit/:id',
      name: 'admin-plan-audit',
      component: PlanAuditView,
      meta: {
        title: 'Plan Audit - Vungu Spatial Data Portal',
        requiresAuth: true,
        roles: ['admin', 'planner', 'planning_clerk', 'eo', 'gis_officer'],
      },
    },
    {
      // roleHome() lands the IT Admin here; the console's own landing
      // preference then decides which section a bare /admin opens on.
      path: '/admin/users',
      redirect: '/admin?section=employees',
    },
    {
      path: '/admin/land-use',
      name: 'admin-land-use',
      component: LandUseManagementView,
      meta: {
        title: 'Land Use Management - Vungu Spatial Data Portal',
        requiresAuth: true,
        // Planners own the development control matrix; mirrors adminPlanner
        // on POST/DELETE /api/development-control/matrix.
        roles: ['admin', 'planner'],
      }
    },
    {
      // IT-Admin editor for the public council pages (replaces the static site).
      path: '/admin/content',
      name: 'admin-content',
      component: ContentManagementView,
      meta: {
        title: 'Website Content - Vungu RDC',
        requiresAuth: true,
        requiresAdmin: true,
      }
    },
    {
      path: '/qgis-map',
      name: 'qgis-map',
      component: QGISMapView,
      meta: { title: 'QGIS Styled Layers - Vungu Spatial Data Portal' }
    },
    {
      path: '/planner',
      name: 'planner',
      component: PlannerShell,
      meta: {
        title: 'Town Planning Officer — Vungu RDC',
        requiresAuth: true,
        // Was `requiresAuth` only, so any authenticated account — including a
        // `registered` citizen who guessed the URL — rendered the whole planner
        // shell with its case registers and applicant PII (review P0).
        //
        // 'admin' is deliberately absent: ADMIN_BLOCKED below already bounces
        // the IT admin off every /planner path, so listing it here would be a
        // dead entry contradicting the separation-of-duties rule.
        roles: ['planner'],
      }
    },
    {
      // Full-screen Planning Studio (right-click a parcel → "Subdivide this land").
      // Same allow-list as the shell it is launched from.
      // Params optional: bare /planner/studio opens a blank drafting canvas.
      path: '/planner/studio/:layer?/:fid?',
      name: 'planner-studio',
      component: PlanningStudio,
      meta: { title: 'Planning Studio — Vungu RDC', requiresAuth: true, roles: ['planner'] },
    },
    {
      path: '/planner/statutory',
      redirect: () => ({ path: '/planner', query: { pane: 'console', section: 'workflow' } }),
    },
    {
      // The separate "Statutory" page duplicated the console in another design,
      // with no navigation back, and lodged register entries with placeholder
      // stand/ID values. Old bookmarks land on the console workflow instead.
      path: '/statutory/planner',
      redirect: () => ({ path: '/planner', query: { pane: 'console', section: 'workflow' } }),
    },
    {
      path: '/planner-workspace',
      redirect: () => ({ path: '/planner', query: { pane: 'console' } }),
    },
    // Legacy console — redirects to the modern EO portal (deprecated).
    { path: '/eo-planner', redirect: '/eo-planner-portal' },
    {
      path: '/eo-planner-portal',
      name: 'eo-planner-portal',
      component: EOPlannerWorkspace,
      meta: {
        title: 'EO Planner Portal - Vungu RDC',
        requiresAuth: true,
        roles: ['eo', 'admin', 'planner', 'planning_clerk'],
      }
    },
    // Legacy console — redirects to the modern EHO workspace (deprecated).
    { path: '/env-officer', redirect: '/env-officer-workspace' },
    {
      path: '/env-officer-workspace',
      name: 'env-officer-workspace',
      component: EnvOfficerWorkspace,
      meta: {
        title: 'Environmental Health Officer Workspace - Vungu RDC',
        requiresAuth: true,
        roles: withOversight('env_officer'),
      }
    },
    // Legacy console — redirects to the modern Inspector workspace (deprecated).
    { path: '/building-inspector', redirect: '/inspector-workspace' },
    {
      // :inspectionId is a spatial_planning.stage_inspection UUID. It is optional so
      // the bare workspace still opens (roleHome and the guard specs rely on the
      // plain path), and it makes an opened inspection a stable, shareable URL whose
      // context is restored from the server on reload — never from localStorage.
      path: '/inspector-workspace/:inspectionId?',
      name: 'inspector-workspace',
      component: InspectorWorkspace,
      props: true,
      meta: {
        title: 'Building Inspector Workspace - Vungu RDC',
        requiresAuth: true,
        roles: withOversight('building_inspector'),
      }
    },
    // /portal now redirects to the Citizen Portal — the old ViewerPortalView
    // has been retired, the citizen sees only the new console.
    { path: '/portal', redirect: '/citizen' },
    {
      path: '/citizen',
      name: 'citizen-portal',
      component: CitizenPortalView,
      meta: {
        title: 'Citizen Services Portal - Vungu RDC',
        requiresAuth: true
      }
    },
    {
      path: '/gis-map',
      name: 'gis-map',
      component: GISMapView,
      meta: {
        title: 'Spatial Intelligence Map - Vungu RDC',
        requiresAuth: true,
        // Previously unguarded (audit F3). The spatial intelligence map
        // overlays permit locations and enforcement orders onto parcels.
        roles: COUNCIL_STAFF,
      }
    },
    {
      // Parcel-centric Property File (land register dossier).
      path: '/property/:standNo?',
      name: 'property-file',
      component: () => import('@/views/PropertyFileView.vue'),
      meta: {
        title: 'Property File - Vungu RDC',
        requiresAuth: true,
        roles: COUNCIL_STAFF,   // carries owner/applicant PII
      },
    },
    {
      // Ad-hoc report builder over the permit register.
      path: '/report-builder',
      name: 'report-builder',
      component: () => import('@/views/ReportBuilderView.vue'),
      meta: {
        title: 'Report Builder - Vungu RDC',
        requiresAuth: true,
        roles: COUNCIL_STAFF,   // queries the permit register
      },
    },
    // ── Retired /portal-applications intake → canonical citizen flow ─────
    // The /apply service-catalogue funnel posted to /portal/applications, a
    // table the planner queue never read. Development applications now go
    // through /citizen?section=new. (Audit C1.)
    // TODO[product]: non-permit municipal e-services that used to live here
    // (business_license, vendor_permit, tree_felling, housing_waiting_list …)
    // are NOT development-control permits and must not be funnelled into
    // permit-applications. Reintroduce them as their own backed flows if the
    // council still wants them online.
    {
      path: '/apply',
      redirect: { path: '/citizen', query: { section: 'new' } },
    },
    {
      path: '/apply/:serviceId',
      redirect: to => ({
        path: '/citizen',
        query: { section: 'new', ...(to.query.stand ? { stand: String(to.query.stand) } : {}) },
      }),
    },
    {
      path: '/payment/new',
      name: 'payment-new',
      component: () => import('@/views/PaymentInitView.vue'),
      meta: { title: 'Pay Application Fee - Vungu RDC', requiresAuth: true },
    },
    {
      path: '/payment/:refNo',
      name: 'payment-gateway',
      component: PaymentGatewayView,
      meta: { title: 'Pay Online - Vungu RDC', requiresAuth: true }
    },
    {
      path: '/receipt/:refNo',
      name: 'payment-receipt',
      component: PaymentReceiptView,
      meta: { title: 'Payment Receipt - Vungu RDC', requiresAuth: true }
    },
    // Citizen pages introduced after Turn C/D ─ all require auth.
    {
      path: '/payments',
      name: 'payments',
      component: PaymentsView,
      // The free-form fee console (with manual confirmation) is the counter's
      // tool. A client paying their own fees does it from the Citizen Portal.
      meta: { title: 'Payments - Vungu RDC', requiresAuth: true },
      beforeEnter: () => {
        const auth = useAuthStore()
        if (auth.isClient) return { path: '/citizen', query: { section: 'payments' } }
      },
    },
    {
      path: '/documents',
      name: 'documents',
      component: DocumentsView,
      meta: { title: 'My Documents - Vungu RDC', requiresAuth: true },
    },
    {
      // Citizen residency verification: title-deed registry check or document
      // upload (settlement letter, lodger's permit, chief's letter, …).
      // Unverified citizens land here straight after login.
      path: '/residency',
      name: 'residency-verification',
      component: () => import('@/views/ResidencyVerificationView.vue'),
      meta: { title: 'Residency Verification - Vungu RDC', requiresAuth: true },
    },
    {
      // Simulated external national registry (Ministry of Lands). Staff-only:
      // it exists to demonstrate the deed-check integration end to end.
      path: '/mock/ministry-lands',
      name: 'ministry-lands',
      component: () => import('@/views/MinistryLandsView.vue'),
      meta: {
        title: 'Deeds Registry (Simulation) - Ministry of Lands',
        requiresAuth: true,
        roles: ['admin', 'planner', 'planning_clerk', 'eo', 'gis_officer'],
      },
    },
    {
      path: '/plan-review',
      name: 'plan-review',
      component: PlanReviewView,
      meta: { title: 'Plan Auto-Review - Vungu RDC', requiresAuth: true },
    },
    // Legal pages — single component, content driven by route path.
    {
      path: '/privacy',
      name: 'privacy',
      component: LegalView,
      meta: { title: 'Privacy notice - Vungu RDC' },
    },
    {
      path: '/terms',
      name: 'terms',
      component: LegalView,
      meta: { title: 'Terms of use - Vungu RDC' },
    },
    // ── Public council pages (migrated from the static website) ──────────
    {
      path: '/contact',
      name: 'contact',
      component: ContactView,
      meta: { title: 'Contact - Vungu RDC' },
    },
    {
      // Generic council page (Our Profile, Executive Arm, Deliberative Arm,
      // committees, departments, publications, stand application, …).
      path: '/council/:slug',
      name: 'council-page',
      component: CouncilPageView,
      meta: { title: 'Vungu RDC' },
    },
    // Legacy console — redirects to the modern Planning Clerk portal (deprecated).
    { path: '/planning-clerk', redirect: '/planning-clerk-portal' },
    {
      path: '/planning-clerk-portal',
      name: 'planning-clerk-portal',
      component: PlanningClerkPortalView,
      meta: {
        title: 'Planning Clerk Portal - Vungu RDC',
        requiresAuth: true,
        roles: withOversight('planning_clerk'),
      }
    },
    // RDC Act statutory registers: A5 by-laws, P10 annual plan, G11 acquisition,
    // C15 s109 clearance (staff decide), F7 expense recovery.
    {
      path: '/statutory-registers',
      name: 'statutory-registers',
      component: StatutoryRegistersView,
      meta: {
        title: 'Statutory Registers — Vungu RDC',
        requiresAuth: true,
        roles: ['admin', 'eo', 'planner', 'planning_clerk', 'finance_officer'],
      },
    },
    {
      // Chegutu-style finance console: cadastre-linked accounts, district
      // balances, map topography, clearances, receipts, tariff, workflows.
      path: '/finance',
      name: 'finance-workspace',
      component: FinanceWorkspaceView,
      meta: {
        title: 'Finance — Vungu RDC',
        requiresAuth: true,
        roles: ['admin', 'eo', 'planner', 'planning_clerk', 'gis_officer', 'finance_officer'],
      },
    },
    {
      path: '/title-notices',
      name: 'title-notices',
      component: TitleNoticesView,
      meta: {
        title: 'Section 73 notices — Vungu RDC',
        requiresAuth: true,
        roles: ['admin', 'eo', 'planner', 'planning_clerk', 'building_inspector'],
      },
    },
    {
      path: '/custodian',
      name: 'custodian-desk',
      component: CustodianDeskView,
      meta: {
        title: 'Custodian desk — Vungu RDC',
        requiresAuth: true,
        roles: ['admin', 'eo', 'planner', 'planning_clerk', 'gis_officer', 'surveyor'],
      },
    },
    // Map console — GIS map + task queue + per-task capture.
    {
      path: '/surveyor',
      name: 'surveyor-console',
      component: SurveyorConsoleView,
      meta: {
        title: 'Surveyor Console - Vungu RDC',
        requiresAuth: true,
        roles: ['surveyor', 'admin'],
      }
    },
    // The council's survey job queue (the native job module). Surveying itself is done in SurveyPro; the console's
    // "Survey in SurveyPro" button opens a job there (docs/SURVEYPRO-INTEGRATION.md).
    {
      path: '/surveyor/jobs',
      name: 'surveyor-jobs',
      component: SurveyorJobsView,
      meta: {
        title: 'Survey Jobs - Vungu RDC',
        requiresAuth: true,
        roles: ['surveyor', 'admin'],
      }
    },
    // The embedded Survey Task Manager is gone (surveying moved to SurveyPro): old bookmarks land on the console.
    { path: '/surveyor-workspace/:rest(.*)*', redirect: '/surveyor' },
    // Legacy console — redirects to the modern GIS Officer portal (deprecated).
    { path: '/gis-officer', redirect: '/gis-officer-portal' },
    {
      path: '/gis-officer-portal',
      name: 'gis-officer-portal',
      component: GISOfficerPortalView,
      meta: {
        title: 'GIS Officer Portal - Vungu RDC',
        requiresAuth: true,
        roles: withOversight('gis_officer'),
      }
    },
    // GIS Management System (backend migration 132). Same portal shell as
    // /gis-officer-portal; the route picks the section so a parcel profile or
    // the integration console has a link someone can send. Roles are the
    // widest a section needs; the portal hides sections a role cannot use.
    ...([
      ['/gis',                   'gms-home',        'register',      GMS_CAN.view],
      ['/gis/parcels',           'gms-parcels',     'register',      GMS_CAN.view],
      ['/gis/parcels/:parcelId', 'gms-parcel',      'register',      GMS_CAN.view],
      ['/gis/map',               'gms-map',         'map',           GMS_CAN.view],
      ['/gis/edits',             'gms-edits',       'edits',         GMS_CAN.editLayers],
      ['/gis/edits/:sessionId',  'gms-edit',        'edits',         GMS_CAN.editLayers],
      ['/gis/integration',       'gms-integration', 'integration',   GMS_CAN.integrationView],
      ['/gis/data/import',       'gms-import',      'survey_import', GMS_CAN.importSurvey],
    ] as const).map(([path, name, gisSection, roles]) => ({
      path,
      name,
      component: GISOfficerPortalView,
      meta: {
        title: 'GIS Branch - Vungu RDC',
        requiresAuth: true,
        roles: withOversight(...roles),
        gisSection,
      },
    })),
    // ── Retired localStorage intake (`vungu_applications`) → canonical ──
    // /development-application + /applications/* were a separate, broken
    // flow (submitted to /development-applications, then read a localStorage
    // list, and redirected to a non-existent /applications/success — audit
    // C5). Everything now resolves to the Citizen Portal, whose lists come
    // from dmApi.listPermits (single source of truth — audit M3).
    {
      path: '/development-application',
      redirect: to => ({
        path: '/citizen',
        query: { section: 'new', ...(to.query.stand ? { stand: String(to.query.stand) } : {}) },
      }),
    },
    {
      path: '/development-application/success',
      redirect: { path: '/citizen', query: { section: 'applications' } },
    },
    {
      path: '/applications',
      redirect: { path: '/citizen', query: { section: 'applications' } },
    },
    {
      // Catches /applications/:id, /applications/:id/track, /:id/confirm, …
      path: '/applications/:pathMatch(.*)*',
      redirect: { path: '/citizen', query: { section: 'applications' } },
    },
    {
      path: '/invite',
      name: 'invite-accept',
      component: InviteAcceptView,
      meta: { title: 'Accept Invite - Vungu RDC Portal' }
    },
    // Informational page redirects (footer links → nearest existing page)
    { path: '/docs',      redirect: '/about' },
    { path: '/api',       redirect: '/about' },
    { path: '/tutorials', redirect: '/about' },
    { path: '/help',      redirect: { path: '/citizen', query: { section: 'new' } } },
    // (/privacy and /terms intentionally NOT redirected — they resolve to the
    //  real LegalView routes declared above.)
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: NotFoundView,
      meta: { title: 'Page Not Found - Vungu Spatial Data Portal' }
    }
  ]
})

// Routes the IT Admin is NOT allowed to visit.
//
// The 'admin' role is the council *IT* role: it manages staff accounts and
// system configuration, not planning work. These paths expose statutory
// planning cases, the map/GIS workspaces and planning analytics — all of which
// carry applicant PII and statutory decision data. Blocking them enforces
// separation of duties (the person who provisions accounts is not the person
// who decides or sees development applications) and keeps citizen PII out of
// the IT desk.
//
// CAVEAT — this boundary is front-end only. The backend's requireRole() lists
// include 'admin' on essentially every planning route, so an IT admin calling
// the API directly is not stopped. Real separation of duties needs the backend
// allow-lists narrowed too; until then this only keeps the screens out of the
// IT desk's browser. See docs/frontend-audit-2026-08.md §8.
const ADMIN_BLOCKED = ['/planner', '/analytics', '/explore', '/layers', '/explorer']

/** Landing route per role, used after login and when a guard rejects. */
const ROLE_HOME: Record<Role, string> = {
  admin:              '/admin/users',
  planner:            '/planner',
  // Every staff role lands on the modern workspace/portal generation.
  eo:                 '/eo-planner-portal',
  env_officer:        '/env-officer-workspace',
  building_inspector: '/inspector-workspace',
  planning_clerk:     '/planning-clerk-portal',
  finance_officer:    '/finance',
  surveyor:           '/surveyor',
  gis_officer:        '/gis-officer-portal',
  gis_head:           '/gis',
  gis_data:           '/gis',
  gis_dev:            '/gis',
  gis_analyst:        '/gis',
  gis_tech:           '/gis',
  gis_clerk:          '/gis',
  dept_editor:        '/gis',
  dept_viewer:        '/gis',
  viewer:             '/citizen',
  registered:         '/citizen',
  public:             '/citizen',
}

/**
 * Where to send `role` when it has nowhere better to be — after login, and
 * whenever a guard rejects a navigation. Exported so the login screen uses
 * this map rather than keeping a second, divergent copy.
 */
export function roleHome(role: string) {
  return ROLE_HOME[role as Role] ?? '/citizen'
}

// Navigation guards
let authInitialized = false
let authInitPromise: Promise<void> | null = null

router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore()

  // Hydrate the session once per app load. The tokens are httpOnly cookies
  // the client cannot read, so identity comes from GET /auth/me — awaited
  // here so the role checks below see a settled user instead of racing it.
  // initializeAuth() is a no-op without the `auth_present` hint, so anonymous
  // visitors on public pages pay nothing for this.
  if (!authInitialized) {
    if (!authInitPromise) authInitPromise = authStore.initializeAuth()
    await authInitPromise
    authInitialized = true
  }

  if (to.meta.title) document.title = to.meta.title as string

  const hasAuth = authStore.isAuthenticated
  const role = authStore.user?.role ?? ''

  // ── Unauthenticated → login ──────────────────────────────────────────
  // Carry where they were going. Without this, an officer who opens a link to
  // a specific case from an email signs in and lands on their dashboard, with
  // the case they were sent to nowhere in sight — they have to find it again,
  // and most of the time they open the email a second time to do it.
  //
  // `redirect` is a path within this app and LoginView re-checks that before
  // using it: a full URL here would make sign-in an open redirect.
  if (to.meta.requiresAuth && !hasAuth) {
    const query = to.fullPath === '/' ? {} : { redirect: to.fullPath }
    next({ path: '/login', query }); return
  }

  // ── Admin-only routes ────────────────────────────────────────────────
  if (to.meta.requiresAdmin && !authStore.isAdmin) {
    next(roleHome(role)); return
  }

  // ── IT Admin is blocked from planning/analytics routes ───────────────
  if (authStore.isAdmin && ADMIN_BLOCKED.some(p => to.path.startsWith(p))) {
    next('/admin/users'); return
  }

  // ── Non-admin trying to reach /admin routes ──────────────────────────
  //
  // This is the *fallback* for /admin routes that carry no explicit allow-list.
  // A route that declares `meta.roles` has already stated exactly who may open
  // it, and that declaration wins — otherwise the prefix would silently
  // override it. That was the GIS-symbology production blocker: the registry at
  // /admin/gis-symbology declares roles ['admin','gis_officer'] to mirror the
  // backend's STYLE_ADMINS, but this prefix check ran first and bounced every
  // gis_officer out of the tool they own. The `meta.roles` branch below still
  // rejects anyone outside that list, so this exemption widens nothing.
  if (to.path.startsWith('/admin') && !to.meta.roles && !authStore.isAdmin && hasAuth) {
    next(roleHome(role)); return
  }

  // ── Per-route role allow-list ────────────────────────────────────────
  // Replaces ten hand-written path comparisons. `to.meta` is merged across
  // all matched records, so a parent's `roles` covers its children (that is
  // what gates every child route of a parent that declares roles).
  //
  // Frontend gating is advisory — the backend re-checks each role on every
  // API call via requireRole(). This stops the screen rendering; it is not
  // the security boundary.
  if (to.meta.roles && hasAuth && !to.meta.roles.includes(role as Role)) {
    next(roleHome(role)); return
  }

  // ── Redirect authenticated users away from login/register ────────────
  if (to.meta.hideForAuth && authStore.isAuthenticated) {
    next(roleHome(role)); return
  }

  next()
})

// One page view per page actually opened. trackPageView() sends nothing until
// the visitor accepts analytics, and only ever the route pattern. A change of
// query alone (a console section, a filter) is the same page and is not counted;
// the initial navigation comes from START_LOCATION, which matches nothing.
router.afterEach((to, from, failure) => {
  if (failure) return
  if (from.matched.length > 0 && to.path === from.path) return
  trackPageView(routePattern(to))
})

// Every route above is a lazy import, so a chunk that fails to load (Vite dep
// re-optimisation in dev, a stale index pointing at deleted hashes after a
// deploy in prod) rejects the navigation and dead-ends the user on the current
// page. Reload at the target URL once so the fresh manifest is used.
// ponytail: one reload, no retry counter — add one if reload loops show up.
router.onError((err, to) => {
  if (/dynamically imported module|Importing a module script failed/i.test(String(err))) {
    window.location.assign(to.fullPath)
  }
})

export default router
