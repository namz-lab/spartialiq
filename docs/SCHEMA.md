# SpartialIQ Planning Portal
## Normalised Database Schema — 1NF, 2NF & 3NF
### Spatial Planning Department Edition

**Stack:** PostgreSQL 14+ / PostGIS 3.3+ | EPSG:4326 WGS84 | Node.js Fastify backend  
**Version:** 1.0 — June 2026  
**Prepared by:** SpartialIQ GIS & Planning Unit  
**Legal basis:** Regional, Town & Country Planning Act [Ch 29:12] | Urban Councils Act [Ch 29:15] | DM Handbook 2021 v1.2

---

## 1. Legal & Institutional Framework

SpartialIQ's database is grounded in Zimbabwe planning legislation. Every table traces back to at least one of the following instruments:

| Act / Instrument | Chapter | Relevance to Schema |
|---|---|---|
| Regional, Town & Country Planning Act | Ch 29:12 (rev. 2016) | Development control, zoning, applications, appeals — `development_applications`, `spatial_planning.permit_application`, `application_status_history` |
| Urban Councils Act | Ch 29:15 (1996) | Building permits, by-laws, urban boundaries — `building_permits`, `inspection_bookings` |
| Rural District Councils Act | Ch 29:13 (1988) | RDC jurisdiction, communal land — `local_authorities` (RDC type) |
| Environmental Management Act | Ch 20:27 (2002) | EIA requirements — `eia_records`, `application_consultation` |
| DM Handbook 2021 v1.2 | Ministry of LGPW | Stage inspections, enforcement — `stage_inspections`, `enforcement_orders` |
| RTCP Act Ch 29:12 s.38 | | Development orders — `development_orders`, `application_objection` |

---

## 2. Normalisation Walkthrough

### 2.1 Unnormalised Form (UNF) — Raw Application Submission

The original development application submission contained repeating groups and transitive dependencies in a single flat record:

| APP_ID | USER_ID | STATUS | DOCUMENT_NAME (repeating) | STAGE_NO (repeating) | INSPECTOR_NAME | INSPECTOR_ROLE |
|---|---|---|---|---|---|---|
| DEV-001 | u-abc | submitted | site_plan.pdf | 1 | T. Moyo | building_inspector |
| DEV-001 | u-abc | submitted | id_copy.pdf | 1 | T. Moyo | building_inspector |
| DEV-001 | u-abc | submitted | site_plan.pdf | 2 | J. Ndlovu | building_inspector |

**UNF Violations:**
- Repeating group: `DOCUMENT_NAME` repeats per application → violates 1NF
- Multi-valued cells: multiple stages per application in one row
- Transitive dependency: `INSPECTOR_ROLE` depends on `INSPECTOR_NAME` not on `APP_ID`

### 2.2 First Normal Form (1NF)

Action: Remove repeating document group → create `application_documents` table.  
Action: Remove repeating stage group → create `inspection_bookings` table.

**Table: development_applications (1NF)**

| PK app_id | user_id | status | submitted_at |
|---|---|---|---|
| DEV-001 | u-abc | submitted | 2026-01-10 |

**Table: application_documents (1NF)**

| PK id | FK app_id | document_name | document_type |
|---|---|---|---|
| 1 | DEV-001 | site_plan.pdf | site_plan |
| 2 | DEV-001 | id_copy.pdf | national_id |

✓ 1NF achieved: no repeating groups, all values atomic, each row uniquely identified.

### 2.3 Second Normal Form (2NF)

Problem: `inspection_bookings` with composite dependency. `INSPECTOR_NAME` depended only on `inspector_id` (part of key), not the full composite key `(booking_id, stage_number)`.

Fix: Extract inspector details to `users` table. `inspection_bookings` references `inspector_id` as FK.

✓ 2NF achieved: all non-key attributes depend on the WHOLE key of their respective table.

### 2.4 Third Normal Form (3NF)

Problem: `development_applications` stored `user_email` directly. `user_email` depends on `user_id`, not on `application_id` — a transitive dependency.

Fix: `user_email` removed from `development_applications`. Join to `users` table when needed.

Problem: `payments` stored `payer_email` and `payer_id` directly. `payer_email` → `payer_id` → resolved by joining `users`.

✓ 3NF achieved: every non-key attribute depends only on the primary key.

---

## 3. Conceptual Data Model

```
AUTHENTICATION LAYER
  users ──── invites
    │
    ├──── user_sessions
    │
    ├──── kyc_verifications
    │
    └──── citizen_documents

PLANNING WORKFLOW LAYER
  development_applications ──── application_documents
           │                ──── application_timeline
           │                ──── application_status_history
           │                ──── application_comments
           │                ──── application_drafts
           │
           ├──── inspection_bookings ──── inspection_photos
           │              │          ──── inspection_status_events
           │              │
           ├──── plan_reviews ──── plan_review_findings
           │
           └──── payments ──── exchange_rates
                               payment_webhooks
                               payment_audit

SPATIAL PLANNING SCHEMA (DM Handbook)
  spatial_planning.permit_application
           ├──── application_consultation
           ├──── application_objection
           ├──── enforcement_orders
           ├──── building_plans
           └──── stage_inspections ──── stage_inspection_items

SPATIAL DATA LAYER (PostGIS)
  24 Spatial Tables (GPKG import) ──── served as MVT via /api/tiles

NOTIFICATIONS LAYER
  notifications_outbox          (email / SMS / in-app)
  workflow_notifications        (cross-department)

AUDIT LAYER
  security_audit_log
  security_metrics_summary
  blocked_ips
  rate_limit_log
  api_token_revocations
```

---

## 4. Complete Table Index

All 55+ tables listed by domain. Spatial layers are served directly from PostGIS via MVT; their internal schema is the GeoPackage import structure.

| # | Table Name | Domain | Geometry | Source / Authority |
|---|---|---|---|---|
| 1 | users | Auth | None | RTCP Act — staff + citizen accounts |
| 2 | invites | Auth | None | Admin-issued staff invitations |
| 3 | user_sessions | Auth | None | JWT refresh token tracking |
| 4 | kyc_verifications | Auth | None | Identity verification (DM Handbook KYC) |
| 5 | citizen_documents | Documents | None | Proof of identity / ownership uploads |
| 6 | development_applications | Planning | None | RTCP Act Part V — citizen-submitted |
| 7 | application_documents | Planning | None | Attached submission docs |
| 8 | application_drafts | Planning | None | Saved-but-not-submitted forms |
| 9 | application_timeline | Planning | None | Audit trail of events |
| 10 | application_comments | Planning | None | Internal + public comments |
| 11 | application_status_history | Planning | None | Status transition log |
| 12 | inspection_bookings | Inspections | None | DM Handbook Annexure 12 — 9 stages |
| 13 | inspection_status_events | Inspections | None | Inspection state machine audit |
| 14 | inspection_photos | Inspections | None | Site photo evidence |
| 15 | plan_reviews | Planning | None | Building plan auto-review uploads |
| 16 | plan_review_findings | Planning | None | Deterministic check results |
| 17 | payments | Payments | None | USD/ZWG fee transactions |
| 18 | exchange_rates | Payments | None | RBZ ZWG/USD rate register |
| 19 | payment_webhooks | Payments | None | Provider webhook raw log |
| 20 | payment_audit | Payments | None | Payment state change audit |
| 21 | notifications_outbox | Notifications | None | Email/SMS/in-app queue |
| 22 | workflow_notifications | Notifications | None | Cross-dept staff notifications |
| 23 | security_audit_log | Security | None | All mutating API requests |
| 24 | security_metrics_summary | Security | None | Daily security statistics |
| 25 | blocked_ips | Security | None | Rate-limit/abuse blocks |
| 26 | security_event_types | Security | None | Event classification lookup |
| 27 | rate_limit_log | Security | None | Per-IP rate limit hits |
| 28 | api_token_revocations | Security | None | Revoked JWT JTIs |
| 29 | spatial_planning.permit_application | Statutory | POINT 4326 | RTCP Act + DM Handbook |
| 30 | spatial_planning.application_consultation | Statutory | None | Statutory body responses |
| 31 | spatial_planning.application_objection | Statutory | None | Public objections |
| 32 | spatial_planning.enforcement_orders | Statutory | None | DM Handbook enforcement |
| 33 | spatial_planning.prohibition_orders | Statutory | None | DM Handbook prohibitions |
| 34 | spatial_planning.building_plans | Statutory | None | Urban Councils Act Ch 29:15 |
| 35 | spatial_planning.stage_inspections | Statutory | None | DM Handbook Annexure 14 |
| 36 | spatial_planning.occupation_certificates | Statutory | None | Final certificate |
| 37–60 | **24 Spatial Layers (GPKG)** | Spatial | Various | zimbabwe.gpkg PostGIS import |

---

## 5. Lookup Tables & Seed Data

### 5.1 User Roles

Authority: SpartialIQ RBAC (maps to RTCP Act job titles)

| code | name | Access level |
|---|---|---|
| public | Unregistered visitor | Public map only |
| registered | Registered citizen | Apply, track, pay |
| viewer | Readonly staff | View all records |
| planning_clerk | Planning Clerk | Intake, receipting |
| planner | Town Planning Officer | Review, recommend |
| eo | Executive Officer / EO Planner | Approve, refuse |
| env_officer | Environmental Health Officer | Env review |
| building_inspector | Building Inspector | Stage inspections |
| surveyor | Surveyor | Survey review |
| gis_officer | GIS Officer | Spatial data management |
| admin | IT Administrator | System config, user management |

### 5.2 Application Status Flow

Authority: RTCP Act Ch 29:12 Part V — Control of Development

```
submitted
   → under_review        (planning_clerk receipts)
   → env_review          (sent to env_officer)
   → survey_review       (sent to surveyor)
   → pending_decision    (planner recommendation prepared)
   → approved            (EO issues development order)
   → building_permit_issued (building_inspector approves plans)
   → foundation_insp     (Stage 1 inspection)
   → superstructure_insp (Stage 2–7 inspections)
   → roofing_insp        (Stage 6)
   → final_insp          (Stage 8 final)
   → occupation_issued   (Stage 9 certificate)
```

### 5.3 Inspection Stages (DM Handbook 2021 v1.2 Annexure 12)

| Stage # | Name | Purpose |
|---|---|---|
| 1 | Setting out | Confirm peg positions match approved plan |
| 2 | Foundation trenches and footing levels | Depth, width, soil bearing compliance |
| 3 | Foundation brickwork to floor level | Course bond, DPC position |
| 4 | Brickwork and window level | Opening sizes, lintels |
| 5 | Brickwork to wall plate | Wall plate bolting, tie-down |
| 6 | Roof trusses | Truss spacing, bracing, tie-down |
| 7 | Drainage / sewerage work | Fall, invert levels, manhole positioning |
| 8 | Final inspection | Completeness, safety, services connection |
| 9 | Certificate of occupation | Occupation certificate issued |

### 5.4 Payment Drivers

| code | label | Type | Live condition |
|---|---|---|---|
| manual | Manual (dev) | Dev only | Always |
| paynow | Paynow | Redirect | PAYNOW_ID + PAYNOW_KEY set |
| ecocash | EcoCash Direct | USSD | ECOCASH_MERCHANT_CODE + ECOCASH_API_KEY set |
| onemoney | OneMoney Direct | USSD | ONEMONEY_MERCHANT_CODE set |
| stripe | International Card | Card | STRIPE_SECRET_KEY set |

### 5.5 Document Kinds

| code | name |
|---|---|
| national_id | National ID Card |
| passport | Passport |
| drivers_licence | Driver's Licence |
| proof_of_residence | Proof of Residence |
| title_deed | Title Deed |
| company_registration | Company Registration |
| tax_clearance | Tax Clearance Certificate |
| other | Other Document |

### 5.6 Spatial Layer Groups

| code | name | Tables |
|---|---|---|
| admin | Administrative Boundaries | country, provinces, districts, wards |
| landuse | Land Use | landuse, admin_areas, places_areas |
| hydro | Hydrology & Nature | water_areas, waterways, protected_areas, natural_areas |
| transport | Transport Network | roads, railways |
| structures | Built Structures | buildings, traffic_areas, transport_areas, pois_areas, places_of_worship_areas |
| poi | Points of Interest | places_points, pois_points, traffic_points, transport_points, natural_points, places_of_worship_points |

---

## 6. Full Table Definitions

### 6.1 AUTH DOMAIN

#### Table: users

Authority: SpartialIQ platform — staff created via invite, citizens self-register

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY | Surrogate key |
| email | VARCHAR(255) | NOT NULL UNIQUE | Login email |
| password_hash | VARCHAR(255) | NOT NULL | bcrypt hash (cost factor 12) |
| name | VARCHAR(255) | NULL | Short display name |
| full_name | VARCHAR(255) | NULL | Full legal name |
| organization | VARCHAR(255) | NULL | Employer / company |
| role | VARCHAR(50) | NOT NULL CHECK | One of 11 roles (§5.1) |
| job_title | VARCHAR(255) | NULL | Council job title |
| department | VARCHAR(255) | NULL | Council department |
| phone | VARCHAR(50) | NULL | Contact phone |
| status | VARCHAR(20) | DEFAULT 'active' | active / suspended / pending |
| applicant_type | VARCHAR(50) | NULL | resident / landowner / business / consultant / visitor |
| active | BOOLEAN | DEFAULT true | Soft delete flag |
| last_login_at | TIMESTAMPTZ | NULL | Last successful login |
| doc_quota_bytes | BIGINT | DEFAULT 104857600 | 100 MB document storage quota |
| doc_used_bytes | BIGINT | DEFAULT 0 | Bytes consumed |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Record creation |
| updated_at | TIMESTAMPTZ | NULL | Last modification |

#### Table: invites

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY DEFAULT uuid_generate_v4() | Surrogate key |
| token | VARCHAR(255) | NOT NULL UNIQUE | One-time invite token |
| email | VARCHAR(255) | NOT NULL | Invitee email address |
| role | VARCHAR(50) | CHECK | Target role (admin/planner/viewer + all staff roles) |
| job_title | VARCHAR(255) | NULL | Pre-assigned job title |
| department | VARCHAR(255) | NULL | Pre-assigned department |
| invited_by | UUID | FK → users NULL | Issuing admin |
| used | BOOLEAN | DEFAULT false | Claimed flag |
| used_at | TIMESTAMPTZ | NULL | When claimed |
| expires_at | TIMESTAMPTZ | DEFAULT NOW()+7d | Expiry |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Creation |

#### Table: user_sessions

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY | Session surrogate key |
| user_id | UUID | FK → users NOT NULL CASCADE | Owner |
| token_hash | VARCHAR(255) | NOT NULL | SHA-256 hash of refresh token |
| expires_at | TIMESTAMPTZ | NOT NULL | Token expiry (14 days) |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Creation |
| last_used | TIMESTAMPTZ | DEFAULT NOW() | Last activity |

---

### 6.2 PLANNING WORKFLOW DOMAIN

#### Table: development_applications

Authority: RTCP Act Ch 29:12 Part V — requires written permission for any development

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | VARCHAR(20) | PRIMARY KEY | Format: DEV-NNNNNN |
| user_id | VARCHAR(50) | NOT NULL | Submitting citizen |
| selection_data | JSONB | NOT NULL | Parcel / stand information |
| eligibility_data | JSONB | NOT NULL | Zoning eligibility analysis result |
| form_data | JSONB | NOT NULL | Full application form payload |
| fees_data | JSONB | NULL | Calculated fee schedule |
| status | VARCHAR(50) | DEFAULT 'submitted' | Status machine state (§5.2) |
| submitted_at | TIMESTAMPTZ | NULL | Date received |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Record creation |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last update |

> Spatial location derived from `selection_data.geometry` — not stored as a column to avoid 3NF violation; PostGIS geometry created on demand.

#### Table: application_status_history

Authority: RTCP Act s.38 — decision trail mandatory for compliance

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | Surrogate key |
| application_id | VARCHAR(32) | NOT NULL | Parent application |
| from_status | VARCHAR(64) | NULL | Previous status (NULL on first) |
| to_status | VARCHAR(64) | NOT NULL | New status |
| changed_by | UUID | FK → users NULL | Staff actor |
| notes | TEXT | NULL | Reason / decision notes |
| changed_at | TIMESTAMPTZ | DEFAULT NOW() | Transition timestamp |

#### Table: application_documents

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Surrogate key |
| application_id | VARCHAR(20) | FK → development_applications CASCADE | Parent application |
| document_name | VARCHAR(255) | NOT NULL | Original filename |
| document_type | VARCHAR(100) | NOT NULL | Type classification |
| file_size | BIGINT | NULL | Bytes |
| file_url | TEXT | NULL | Storage path |
| uploaded_at | TIMESTAMPTZ | DEFAULT NOW() | Upload timestamp |

#### Table: application_drafts

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | VARCHAR(25) | PRIMARY KEY | Format: DRAFT-NNNNNN |
| user_id | VARCHAR(50) | NOT NULL | Owning citizen |
| draft_data | JSONB | NOT NULL | Partial form state |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Creation |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last save |

#### Table: application_timeline

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Surrogate key |
| application_id | VARCHAR(20) | FK → development_applications CASCADE | Parent |
| event_type | VARCHAR(50) | NOT NULL | Event code |
| event_description | TEXT | NULL | Human-readable description |
| event_date | TIMESTAMPTZ | NOT NULL | When occurred |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Row creation |

#### Table: application_comments

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Surrogate key |
| application_id | VARCHAR(20) | FK → development_applications CASCADE | Parent |
| comment_text | TEXT | NOT NULL | Comment body |
| is_internal | BOOLEAN | DEFAULT FALSE | Staff-only flag |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Creation |

---

### 6.3 INSPECTION DOMAIN

#### Table: inspection_bookings

Authority: DM Handbook 2021 v1.2 Annexure 12 — 9 mandatory building stages

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Surrogate key |
| application_id | VARCHAR(32) | NOT NULL | Parent application |
| stage_number | INT | NOT NULL CHECK (1–9) | Stage from Annexure 12 |
| stage_name | VARCHAR(64) | NOT NULL | Human stage label |
| citizen_id | VARCHAR(64) | NULL | Booking citizen |
| inspector_id | UUID | FK → users NULL | Assigned inspector |
| status | VARCHAR(20) | CHECK | pending_payment → waitlisted → scheduled → in_progress → passed/failed |
| fee_paid_at | TIMESTAMPTZ | NULL | When inspection fee paid |
| scheduled_for | TIMESTAMPTZ | NULL | Confirmed inspection date/time |
| completed_at | TIMESTAMPTZ | NULL | Completion timestamp |
| passed | BOOLEAN | NULL | NULL = not yet completed |
| citizen_notes | TEXT | NULL | Citizen site access notes |
| inspector_notes | TEXT | NULL | Inspector outcome notes |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Booking creation |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last update |
| UNIQUE | (application_id, stage_number) | — | One booking per stage |

#### Table: inspection_status_events

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | Surrogate key |
| booking_id | UUID | FK → inspection_bookings CASCADE | Parent booking |
| from_status | VARCHAR(20) | NULL | Previous state |
| to_status | VARCHAR(20) | NOT NULL | New state |
| scheduled_for | TIMESTAMPTZ | NULL | New scheduled time if rescheduled |
| actor_id | UUID | FK → users NULL | Who triggered change |
| actor_role | VARCHAR(32) | NULL | Role at time of change |
| notes | TEXT | NULL | Transition notes |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Event timestamp |

#### Table: inspection_photos

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Surrogate key |
| booking_id | UUID | FK → inspection_bookings CASCADE | Parent booking |
| uploaded_by | UUID | FK → users NULL | Uploader |
| storage_url | TEXT | NOT NULL | File path under /uploads/ |
| mime_type | VARCHAR(64) | NOT NULL | image/jpeg, image/png, etc. |
| bytes | BIGINT | NOT NULL CHECK (> 0) | File size |
| width_px | INT | NULL | Image width |
| height_px | INT | NULL | Image height |
| sha256_hex | VARCHAR(64) | NULL | Deduplication hash |
| caption | VARCHAR(255) | NULL | Photo description |
| taken_at | TIMESTAMPTZ | NULL | EXIF capture time |
| taken_lng | DOUBLE PRECISION | NULL | EXIF GPS longitude |
| taken_lat | DOUBLE PRECISION | NULL | EXIF GPS latitude |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Upload timestamp |
| UNIQUE | (booking_id, sha256_hex) WHERE sha256_hex IS NOT NULL | — | No duplicate photos |

---

### 6.4 PLAN REVIEW DOMAIN

#### Table: plan_reviews

Authority: Urban Councils Act Ch 29:15 s.179–186 — building plans review

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Surrogate key |
| application_id | VARCHAR(32) | NOT NULL | Parent application |
| uploaded_by | UUID | FK → users NULL | Uploader |
| storage_url | TEXT | NOT NULL | File path |
| mime_type | VARCHAR(64) | NOT NULL | application/pdf, image/vnd.dxf, etc. |
| bytes | BIGINT | NOT NULL CHECK (> 0) | File size |
| sha256_hex | VARCHAR(64) | NULL | Deduplication hash |
| status | VARCHAR(20) | DEFAULT 'pending' | pending → auto_passed/warned/failed → staff_approved/rejected |
| notes | TEXT | NULL | Staff review notes |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Upload time |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last update |
| UNIQUE | (application_id, sha256_hex) WHERE sha256_hex IS NOT NULL | — | No duplicate uploads |

#### Table: plan_review_findings

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | Surrogate key |
| review_id | UUID | FK → plan_reviews CASCADE | Parent review |
| severity | VARCHAR(8) | CHECK (info/warn/error) | Finding severity |
| code | VARCHAR(64) | NOT NULL | Stable code for frontend i18n |
| message | TEXT | NOT NULL | Human-readable finding |
| source | JSONB | NULL | Section reference (e.g. {doc:"DM Handbook", section:"3.2.1"}) |
| bbox | JSONB | NULL | PDF bounding box as percentages |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Creation |

---

### 6.5 PAYMENT DOMAIN

#### Table: payments

Authority: Fees set under RTCP Act / DM Handbook schedule of fees

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Surrogate key |
| purpose | VARCHAR(32) | CHECK | application_fee / inspection_fee / permit_fee / occupation_certificate / other |
| related_kind | VARCHAR(32) | NULL | inspection_booking / development_application / permit |
| related_id | VARCHAR(64) | NULL | ID of related entity |
| payer_id | UUID | FK → users NULL | Payer account |
| payer_email | VARCHAR(255) | NULL | Payer email (denormalised for receipts) |
| amount_usd | NUMERIC(14,2) | NOT NULL CHECK (≥ 0) | USD equivalent |
| amount_zwg | NUMERIC(16,2) | NOT NULL CHECK (≥ 0) | ZWG equivalent |
| rate_used | NUMERIC(20,8) | NOT NULL CHECK (> 0) | Exchange rate at time of payment |
| rate_id | UUID | FK → exchange_rates NULL | Rate record used |
| wallet_ccy | VARCHAR(8) | CHECK (USD/ZWG) | Billed currency |
| driver | VARCHAR(32) | DEFAULT 'manual' | Payment driver (§5.4) |
| provider_ref | VARCHAR(255) | NULL | Provider transaction reference |
| provider_status | VARCHAR(64) | NULL | Raw provider status |
| status | VARCHAR(20) | DEFAULT 'pending' | pending → awaiting_provider → paid/failed/cancelled/refunded |
| issued_receipt_no | VARCHAR(32) | UNIQUE WHERE NOT NULL | Receipt number |
| paid_at | TIMESTAMPTZ | NULL | Payment confirmed timestamp |
| receipt_url | TEXT | NULL | Receipt document URL |
| metadata | JSONB | DEFAULT '{}' | Provider extras (pollUrl, ussdCode, etc.) |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Creation |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last update |

#### Table: exchange_rates

Authority: Reserve Bank of Zimbabwe (RBZ) — official ZWG/USD interbank rate

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Surrogate key |
| rate_date | DATE | NOT NULL | Effective date |
| base_ccy | VARCHAR(8) | NOT NULL DEFAULT 'USD' | Base currency |
| quote_ccy | VARCHAR(8) | NOT NULL DEFAULT 'ZWG' | Quote currency |
| rate | NUMERIC(20,8) | NOT NULL CHECK (> 0) | 1 USD = rate ZWG |
| source | VARCHAR(64) | NOT NULL | rbz / manual_override / paynow_live |
| source_url | TEXT | NULL | Reference URL |
| fetched_at | TIMESTAMPTZ | DEFAULT NOW() | When fetched |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Row creation |
| UNIQUE | (rate_date, base_ccy, quote_ccy, source) | — | One rate per source per day |

#### Table: payment_webhooks

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Surrogate key |
| driver | TEXT | NOT NULL | Provider name |
| received_at | TIMESTAMPTZ | DEFAULT NOW() | Webhook arrival time |
| headers | JSONB | NULL | Raw HTTP headers |
| body_raw | TEXT | NULL | Raw body |
| hmac_valid | BOOLEAN | NULL | Signature verification result |
| payment_id | UUID | FK → payments NULL | Matched payment |
| processed | BOOLEAN | DEFAULT FALSE | Processing flag |
| error | TEXT | NULL | Processing error if any |

#### Table: payment_audit

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Surrogate key |
| payment_id | UUID | FK → payments CASCADE | Parent payment |
| from_status | TEXT | NULL | Previous status |
| to_status | TEXT | NOT NULL | New status |
| changed_by | INTEGER | FK → users NULL | Actor |
| ip_address | INET | NULL | Client IP |
| note | TEXT | NULL | Reason |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Timestamp |

---

### 6.6 DOCUMENTS DOMAIN

#### Table: citizen_documents

Authority: KYC requirements for planning applicants under DM Handbook

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Surrogate key |
| user_id | UUID | FK → users CASCADE | Owning citizen |
| doc_kind | VARCHAR(32) | CHECK | Document type (§5.5) |
| storage_url | TEXT | NOT NULL | File path |
| mime_type | VARCHAR(64) | NOT NULL | MIME type |
| bytes | BIGINT | NOT NULL CHECK (> 0) | File size |
| sha256_hex | VARCHAR(64) | NULL | Content hash for deduplication |
| extracted_name | VARCHAR(255) | NULL | OCR-extracted name |
| extracted_id_number | VARCHAR(64) | NULL | OCR-extracted ID number |
| extracted_dob | DATE | NULL | OCR-extracted date of birth |
| verification_status | VARCHAR(20) | DEFAULT 'pending' | pending → under_review → verified/rejected/expired |
| verification_notes | TEXT | NULL | Staff rejection notes |
| verified_by | UUID | FK → users NULL | Verifying staff member |
| verified_at | TIMESTAMPTZ | NULL | Verification timestamp |
| verifier_provider | VARCHAR(32) | NULL | manual / smile_id / onfido |
| verifier_payload | JSONB | NULL | Raw provider response |
| verifier_confidence | NUMERIC(5,4) | NULL | 0–1 confidence score |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Upload time |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last update |
| UNIQUE | (user_id, sha256_hex) WHERE sha256_hex IS NOT NULL | — | No duplicate files |

---

### 6.7 KYC DOMAIN

#### Table: kyc_verifications

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Surrogate key |
| user_id | INTEGER | FK → users CASCADE UNIQUE | One KYC per user |
| id_type | TEXT | CHECK | national_id / passport / drivers_licence |
| id_number | TEXT | NOT NULL | Identity document number |
| full_name | TEXT | NOT NULL | Name as on document |
| status | TEXT | DEFAULT 'pending' | pending → approved/rejected |
| reviewer_notes | TEXT | NULL | Admin notes |
| reviewed_by | INTEGER | FK → users NULL | Reviewing admin |
| reviewed_at | TIMESTAMPTZ | NULL | Review timestamp |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Submission time |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last update |

---

### 6.8 NOTIFICATIONS DOMAIN

#### Table: notifications_outbox

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Surrogate key |
| user_id | VARCHAR(64) | NULL | Target user |
| email | VARCHAR(255) | NULL | Target email |
| channel | VARCHAR(16) | DEFAULT 'email' | email / sms / in_app |
| kind | VARCHAR(64) | NOT NULL | Template key (e.g. inspection_waitlisted) |
| subject | VARCHAR(255) | NOT NULL | Email subject |
| body_text | TEXT | NOT NULL | Plain text body |
| body_html | TEXT | NULL | HTML body |
| payload | JSONB | DEFAULT '{}' | Template data |
| status | VARCHAR(16) | DEFAULT 'pending' | pending → sent/failed/cancelled |
| attempts | INT | DEFAULT 0 | Send attempt count |
| last_error | TEXT | NULL | Last error message |
| scheduled_at | TIMESTAMPTZ | DEFAULT NOW() | Earliest send time |
| sent_at | TIMESTAMPTZ | NULL | Actual send time |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Creation |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last update |

#### Table: workflow_notifications

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Surrogate key |
| permit_application_id | UUID | FK → spatial_planning.permit_applications NULL | Related application |
| title | TEXT | NOT NULL | Notification title |
| message | TEXT | NOT NULL | Body text |
| kind | TEXT | DEFAULT 'info' | info / success / warning / error |
| recipient_role | TEXT | DEFAULT 'all' | Target role or 'all' |
| recipient_user_id | INTEGER | FK → users CASCADE | Specific recipient (NULL = broadcast) |
| created_by | INTEGER | FK → users NULL | Sender |
| read_at | TIMESTAMPTZ | NULL | When read (NULL = unread) |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Creation |

---

### 6.9 SPATIAL PLANNING SCHEMA (DM Handbook)

#### Table: spatial_planning.permit_application

Authority: RTCP Act Ch 29:12 Part V + DM Handbook 2021 v1.2

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Surrogate key |
| dev_app_id | VARCHAR(20) | FK → public.development_applications NULL | Linked citizen application |
| tpd_reference | VARCHAR(40) | UNIQUE | TPD statutory reference number |
| dev_register_no | VARCHAR(40) | NULL | Development register entry |
| stand_number | VARCHAR(40) | NULL | Stand / plot number |
| suburb_ward | VARCHAR(80) | NULL | Suburb and ward |
| street_address | TEXT | NULL | Physical address |
| stand_area_sqm | NUMERIC(12,2) | NULL | Stand area (sq metres) |
| location | GEOMETRY(Point,4326) | NULL | Map centroid |
| applicant_name | VARCHAR(255) | NOT NULL | Applicant full name |
| applicant_id_number | VARCHAR(40) | NULL | National ID number |
| applicant_phone | VARCHAR(32) | NULL | Contact phone |
| applicant_email | VARCHAR(255) | NULL | Contact email |
| development_type | VARCHAR(60) | CHECK | new_building / alteration / extension / change_of_use / subdivision / consolidation / rezoning / other |
| description | TEXT | NULL | Development description |
| site_plan_url | TEXT | NULL | Uploaded site plan |
| status | VARCHAR(30) | CHECK | registered → acknowledged → circulation → objection_period → under_review → deferred → approved → approved_with_conditions → refused → withdrawn → appealed |
| received_at | DATE | DEFAULT CURRENT_DATE | Submission date |
| acknowledged_at | DATE | NULL | Acknowledgement date |
| decision_at | DATE | NULL | Decision date |
| decision_conditions | TEXT | NULL | Conditions text |
| decision_officer | UUID | FK → users NULL | Deciding officer |
| created_by | UUID | FK → users NULL | Creating staff |
| search_vector | TSVECTOR | GENERATED | Full-text search |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Creation |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last update |

#### Table: spatial_planning.application_consultation

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY | Surrogate key |
| permit_app_id | UUID | FK → permit_application CASCADE | Parent application |
| body_name | VARCHAR(120) | NOT NULL | Consulting body name |
| body_type | VARCHAR(40) | CHECK | water_authority / roads_authority / environmental_agency / fire_brigade / electricity_utility / heritage_office / rural_district_council / military_authority / other |
| contact_name | VARCHAR(120) | NULL | Body contact person |
| contact_email | VARCHAR(255) | NULL | Contact email |
| circulated_at | DATE | NULL | Date circulated |
| response_due_at | DATE | NULL | Response deadline |
| response_status | VARCHAR(20) | CHECK | pending / no_objection / objection / conditional_approval / no_response |
| response_received_at | DATE | NULL | Response date |
| response_notes | TEXT | NULL | Body's notes |
| response_document_url | TEXT | NULL | Response document |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Creation |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last update |

#### Table: spatial_planning.application_objection

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PRIMARY KEY | Surrogate key |
| permit_app_id | UUID | FK → permit_application CASCADE | Parent application |
| objector_name | VARCHAR(255) | NOT NULL | Objector full name |
| objector_address | TEXT | NULL | Objector address |
| objector_id_number | VARCHAR(40) | NULL | National ID |
| grounds | JSONB | NOT NULL DEFAULT '[]' | Array of codes: traffic_impact / noise / privacy / heritage / environmental / infrastructure_capacity / non_compliance / other |
| grounds_detail | TEXT | NULL | Detailed objection |
| received_at | DATE | DEFAULT CURRENT_DATE | Receipt date |
| document_url | TEXT | NULL | Supporting document |
| consideration_notes | TEXT | NULL | Planner's consideration |
| sustained | BOOLEAN | NULL | NULL = not yet considered |
| considered_at | DATE | NULL | Consideration date |
| considered_by | UUID | FK → users NULL | Considering planner |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Creation |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last update |

---

### 6.10 SECURITY & AUDIT DOMAIN

#### Table: security_audit_log

Authority: RTCP Act traceability requirements + Zimbabwe municipal compliance

| Column | Data Type | Constraints | Description |
|---|---|---|---|
| id | SERIAL | PRIMARY KEY | Surrogate key |
| event_type | VARCHAR(100) | NOT NULL | Category code (AUTH, USER_MGMT, PERMIT, etc.) |
| severity | VARCHAR(20) | CHECK | low / medium / high / critical |
| user_id | INTEGER | FK → users NULL | Acting user |
| ip_address | INET | NOT NULL | Client IP |
| user_agent | TEXT | NULL | Browser/client |
| details | JSONB | DEFAULT '{}' | method, url, status, role, response_ms |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Event time |

---

### 6.11 SPATIAL DATA DOMAIN (24 PostGIS Layers)

All 24 layers share the same base structure from the zimbabwe.gpkg GeoPackage import:

| Column | Data Type | Description |
|---|---|---|
| fid | BIGINT | Feature ID (GeoPackage primary key) |
| geom | GEOMETRY(*, 900914) | Geometry (SRID 900914 = WGS84/CRS84 — same coords as 4326) |
| name | TEXT | Feature name |
| fclass | TEXT | Feature classification |

Additional attributes vary by layer:

| Layer | Extra attributes |
|---|---|
| country, provinces, districts, wards | pcode (admin code), level (admin level) |
| roads | ref (route ref), oneway (yes/no/reversible) |
| places_points | population (ZIMSTAT figure) |
| buildings | type (building subtype) |

**Zoom ranges by group:**

| Group | Layers | Min zoom | Notes |
|---|---|---|---|
| admin | country, provinces | 0 | Always visible |
| admin | districts | 5 | Province level detail |
| admin | wards | 8 | Local detail |
| landuse, hydro | Most | 8 | Medium zoom |
| transport | roads | 8 | Low-zoom filter: motorway/trunk/primary/secondary only below z12 |
| structures | buildings | 14 | Dense — high zoom only |
| poi | places_points | 6 | Major settlements |
| poi | pois_points, traffic_points | 13–14 | Street-level detail |

---

## 7. Full Entity Relationship Reference

| Parent Table | Child Table | Cardinality | FK Column on Child |
|---|---|---|---|
| users | invites | 1 → Many | invited_by |
| users | user_sessions | 1 → Many | user_id |
| users | kyc_verifications | 1 → 1 | user_id |
| users | citizen_documents | 1 → Many | user_id |
| users | inspection_bookings | 1 → Many | inspector_id |
| users | inspection_photos | 1 → Many | uploaded_by |
| users | payments | 1 → Many | payer_id |
| users | plan_reviews | 1 → Many | uploaded_by |
| users | spatial_planning.permit_application | 1 → Many | decision_officer, created_by |
| users | workflow_notifications | 1 → Many | recipient_user_id, created_by |
| users | security_audit_log | 1 → Many | user_id |
| development_applications | application_documents | 1 → Many | application_id |
| development_applications | application_drafts | 1 → Many | user_id (implicit) |
| development_applications | application_timeline | 1 → Many | application_id |
| development_applications | application_comments | 1 → Many | application_id |
| development_applications | application_status_history | 1 → Many | application_id |
| development_applications | inspection_bookings | 1 → Many | application_id |
| development_applications | plan_reviews | 1 → Many | application_id |
| development_applications | spatial_planning.permit_application | 1 → 1 | dev_app_id |
| inspection_bookings | inspection_status_events | 1 → Many | booking_id |
| inspection_bookings | inspection_photos | 1 → Many | booking_id |
| inspection_bookings | payments | 1 → Many | related_id (kind=inspection_booking) |
| plan_reviews | plan_review_findings | 1 → Many | review_id |
| exchange_rates | payments | 1 → Many | rate_id |
| payments | payment_webhooks | 1 → Many | payment_id |
| payments | payment_audit | 1 → Many | payment_id |
| spatial_planning.permit_application | application_consultation | 1 → Many | permit_app_id |
| spatial_planning.permit_application | application_objection | 1 → Many | permit_app_id |
| spatial_planning.permit_application | workflow_notifications | 1 → Many | permit_application_id |

---

## 8. Recommended Indexes (PostGIS / PostgreSQL)

### 8.1 Spatial GiST Indexes

```sql
CREATE INDEX idx_permit_app_location ON spatial_planning.permit_application USING GIST(location);
CREATE INDEX idx_country_geom   ON country   USING GIST(geom);
CREATE INDEX idx_provinces_geom ON provinces USING GIST(geom);
CREATE INDEX idx_districts_geom ON districts USING GIST(geom);
CREATE INDEX idx_wards_geom     ON wards     USING GIST(geom);
CREATE INDEX idx_roads_geom     ON roads     USING GIST(geom);
CREATE INDEX idx_buildings_geom ON buildings USING GIST(geom);
CREATE INDEX idx_landuse_geom   ON landuse   USING GIST(geom);
```

### 8.2 B-Tree Attribute Indexes

```sql
-- Auth
CREATE INDEX ON users(email);
CREATE INDEX ON users(role);
CREATE INDEX ON user_sessions(user_id);

-- Planning workflow
CREATE INDEX ON development_applications(user_id);
CREATE INDEX ON development_applications(status);
CREATE INDEX ON development_applications(submitted_at DESC);
CREATE INDEX ON application_status_history(application_id);

-- Inspections
CREATE INDEX ON inspection_bookings(application_id);
CREATE INDEX ON inspection_bookings(inspector_id);
CREATE INDEX ON inspection_bookings(status);
CREATE INDEX ON inspection_bookings(scheduled_for);

-- Payments
CREATE INDEX ON payments(payer_id);
CREATE INDEX ON payments(status);
CREATE INDEX ON payments(related_id, related_kind);
CREATE INDEX ON exchange_rates(rate_date DESC, base_ccy, quote_ccy);

-- Spatial planning
CREATE INDEX ON spatial_planning.permit_application(status);
CREATE INDEX ON spatial_planning.permit_application(development_type);
CREATE INDEX ON spatial_planning.permit_application USING GIN(search_vector);

-- Security
CREATE INDEX ON security_audit_log(user_id);
CREATE INDEX ON security_audit_log(created_at DESC);
CREATE INDEX ON security_audit_log(event_type);
```

---

## 9. Derived Attributes — Removed from Schema

| Removed Attribute | Was On Table | Why Removed | Equivalent Query |
|---|---|---|---|
| stand_area_ha | development_applications | Derivable from selection_data geometry | ST_Area(geom::geography)/10000 |
| application_count | users | Derivable by COUNT | SELECT COUNT(*) FROM development_applications WHERE user_id=? |
| payment_total | development_applications | Derivable by SUM | SELECT SUM(amount_usd) FROM payments WHERE related_id=? |
| stage_count_passed | inspection_bookings | Derivable by COUNT | SELECT COUNT(*) FROM inspection_bookings WHERE application_id=? AND passed=TRUE |
| length_km | roads, waterways | Derivable from geometry | ST_Length(geom::geography)/1000 |
| area_km2 | country, provinces, districts, wards | Derivable from polygon | ST_Area(geom::geography)/1000000 |

---

## 10. Data Population Sequence

Tables must be populated in this order to satisfy FK constraints:

| Step | Table(s) | Source |
|---|---|---|
| 1 | exchange_rates | RBZ rate seed or manual insert |
| 2 | users (admin) | First admin via direct insert or invite flow |
| 3 | invites | Admin issues staff invites |
| 4 | users (staff) | Staff claim invites |
| 5 | kyc_verifications | Citizens submit KYC |
| 6 | citizen_documents | Citizens upload documents |
| 7 | development_applications | Citizens submit applications |
| 8 | application_documents | Files attached at submission |
| 9 | application_status_history | Status transitions by staff |
| 10 | spatial_planning.permit_application | Planning clerk creates statutory record |
| 11 | application_consultation | Planner circulates to bodies |
| 12 | application_objection | Public objections received |
| 13 | payments (application_fee) | Citizen pays application fee |
| 14 | inspection_bookings | Citizen books stages |
| 15 | payments (inspection_fee) | Citizen pays inspection fee |
| 16 | inspection_photos | Inspector uploads site photos |
| 17 | plan_reviews | Citizen uploads building plans |
| 18 | plan_review_findings | Auto-review runs deterministic checks |
| 19 | notifications_outbox | Triggered by all status changes |
| 20 | security_audit_log | Written by auditLog middleware on every mutation |

---

*SpartialIQ Database Schema v1.0 | 55+ Tables | 3NF Compliant*  
*Grounded in Zimbabwe Legislation | RTCP Act Ch 29:12 | DM Handbook 2021 v1.2 | EPSG:4326 WGS84*
