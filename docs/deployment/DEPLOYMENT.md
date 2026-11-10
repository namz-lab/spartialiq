# SpartialIQ — Production Deployment Guide

> **Version:** 2.0.0  
> **Last updated:** 2026-05-26  
> **Platform:** Vungu Rural District Council · Zimbabwe Council Spatial Platform

---

## Table of Contents

1. [Architecture overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Database setup](#3-database-setup)
4. [Backend setup](#4-backend-setup)
5. [Frontend build & deploy](#5-frontend-build--deploy)
6. [Environment variables reference](#6-environment-variables-reference)
7. [Payment gateway configuration](#7-payment-gateway-configuration)
8. [NGINX configuration](#8-nginx-configuration)
9. [SSL / TLS](#9-ssl--tls)
10. [Process management](#10-process-management)
11. [Monitoring & logging](#11-monitoring--logging)
12. [Database migrations](#12-database-migrations)
13. [File uploads](#13-file-uploads)
14. [Email / notification worker](#14-email--notification-worker)
15. [Redis (optional but recommended)](#15-redis-optional-but-recommended)
16. [Security checklist](#16-security-checklist)
17. [First-run checklist](#17-first-run-checklist)
18. [Troubleshooting](#18-troubleshooting)

---

## 1. Architecture overview

```
                          ┌──────────────────────────────────────────────┐
                          │               Internet / Citizens             │
                          └──────────────────┬───────────────────────────┘
                                             │ HTTPS :443
                                             ▼
                          ┌──────────────────────────────────────────────┐
                          │  NGINX (reverse proxy + static file server)  │
                          │  TLS termination via Let's Encrypt (certbot) │
                          └──────┬───────────────────────┬───────────────┘
                                 │ /api/*                │ /* (static)
                                 ▼                       ▼
                          ┌──────────┐          ┌────────────────────┐
                          │ Fastify  │          │  Vue 3 SPA dist/   │
                          │ :3000    │          │  (served by NGINX) │
                          └────┬─────┘          └────────────────────┘
                               │
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
             ┌──────────┐ ┌────────┐ ┌────────────────────────┐
             │PostgreSQL│ │Uploads │ │  External payment APIs  │
             │:5432     │ │/uploads│ │  Paynow · EcoCash ·    │
             │          │ │(disk)  │ │  OneMoney · Stripe      │
             └──────────┘ └────────┘ └────────────────────────┘
```

**Key facts:**
- Backend: Node.js 20 LTS + Fastify 5.7.1 (CommonJS)
- Frontend: Vue 3 + Vite SPA, compiled to static assets
- Database: PostgreSQL 15+ with PostGIS 3.x extension
- Spatial data: 24 layers from `zimbabwe.gpkg` (vector tiles via `ST_AsMVT`)
- Auth: JWT HS256, 12 h access tokens + 14 d refresh tokens
- File storage: local disk (`./uploads/`) — replace with S3/Cloudflare R2 at scale

---

## 2. Prerequisites

### Server requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU      | 2 vCPU  | 4 vCPU      |
| RAM      | 2 GB    | 4 GB        |
| Disk     | 20 GB   | 50 GB SSD   |
| OS       | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

### Software

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL 15 + PostGIS
sudo apt install -y postgresql-15 postgresql-15-postgis-3

# NGINX
sudo apt install -y nginx

# Certbot (Let's Encrypt)
sudo snap install core; sudo snap refresh core
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot

# PM2 (process manager)
sudo npm install -g pm2

# Build tools
sudo apt install -y build-essential git
```

---

## 3. Database setup

### 3.1 Create database and user

```sql
-- As postgres superuser
CREATE ROLE spartialiq LOGIN PASSWORD 'CHANGE_THIS_PASSWORD';
CREATE DATABASE spartialiq_db
  OWNER = spartialiq
  ENCODING = 'UTF8'
  LC_COLLATE = 'en_US.utf8'
  LC_CTYPE = 'en_US.utf8'
  TEMPLATE = template0;

\c spartialiq_db
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- for text search
```

### 3.2 Run migrations

```bash
cd /srv/spartialiq/backend

# Apply all migrations in order
for f in migrations/*.sql; do
  echo "Applying $f…"
  PGPASSWORD=CHANGE_THIS psql -U spartialiq -d spartialiq_db -f "$f"
done

# Or use the migration script
node scripts/migrate-render.js
```

### 3.3 Load spatial data (zimbabwe.gpkg)

The source file in this project is `data/spatial/zimbabwe.gpkg`. Copy it to the server path below before the import.

```bash
# Load the GeoPackage into PostGIS (run once)
ogr2ogr \
  -f "PostgreSQL" \
  "PG:host=localhost dbname=spartialiq_db user=spartialiq password=CHANGE_THIS" \
  /srv/spatialdata/zimbabwe.gpkg \
  -overwrite \
  -progress \
  -lco GEOMETRY_NAME=geom \
  -lco FID=ogc_fid \
  -t_srs EPSG:4326

# Build required spatial indexes (idempotent)
psql -U spartialiq -d spartialiq_db -f migrations/074_spatial_tile_indexes.sql
```

### 3.4 Key tables

The application uses these primary tables:

| Table | Purpose |
|-------|---------|
| `users` | All accounts (8 roles: admin, planner, eo, env_officer, building_inspector, planning_clerk, surveyor, gis_officer, user/viewer) |
| `development_applications` | All submitted applications |
| `application_status_history` | Audit log of every status change |
| `application_timeline` | Free-text event log |
| `inspection_bookings` | DM Handbook 2021 inspection bookings (9 stages) |
| `inspection_status_events` | Audit log of booking state changes |
| `inspection_photos` | Photos taken during inspections |
| `payments` | Payment records (Paynow / EcoCash / OneMoney / Stripe / Manual) |
| `notification_queue` | Outgoing email job queue |
| `stands` | Land parcels / stands registry |
| `planning_assistant_templates` | Planning assistant AI templates |

---

## 4. Backend setup

### 4.1 Clone and install

```bash
sudo mkdir -p /srv/spartialiq
sudo chown $USER:$USER /srv/spartialiq
cd /srv/spartialiq

git clone <your-repo-url> backend
cd backend
npm install --production
```

### 4.2 Create `.env`

```bash
cp .env.example .env
nano .env  # Fill in all values — see Section 6
```

### 4.3 Create required directories

```bash
mkdir -p uploads/inspection-photos
chmod 755 uploads
```

### 4.4 Start with PM2

```bash
pm2 start server.js --name spartialiq-backend \
  --log /var/log/spartialiq/backend.log \
  --error /var/log/spartialiq/backend-error.log

pm2 save
pm2 startup  # follow the printed command to enable on boot
```

---

## 5. Frontend build & deploy

### 5.1 Build

```bash
cd /srv/spartialiq/frontend
npm install
npm run build

# Output: dist/  (static files ready to serve)
```

### 5.2 Deploy static files

```bash
sudo cp -r dist /var/www/spartialiq
sudo chown -R www-data:www-data /var/www/spartialiq
```

### 5.3 Environment variables for the frontend

Create `/srv/spartialiq/frontend/.env.production`:

```env
VITE_API_BASE_URL=https://api.spartialiq.co.zw
VITE_COUNCIL_ID=vungu
```

> The Vite proxy (`/api/*` → `:3000`) is used in development only. In production, NGINX routes `/api/*` to the backend directly.

---

## 6. Environment variables reference

Create `/srv/spartialiq/backend/.env`:

```env
# ── Core ──────────────────────────────────────────────────────────────
NODE_ENV=production
PORT=3000

# ── Database ──────────────────────────────────────────────────────────
DATABASE_URL=postgresql://spartialiq:CHANGE_THIS_PASSWORD@localhost:5432/spartialiq_db

# ── Authentication ────────────────────────────────────────────────────
# Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
JWT_SECRET=REPLACE_WITH_64_CHAR_RANDOM_STRING
JWT_REFRESH_SECRET=REPLACE_WITH_DIFFERENT_64_CHAR_RANDOM_STRING
# Token lifetimes (optional — defaults: 12h access, 14d refresh)
JWT_ACCESS_EXPIRY=12h
JWT_REFRESH_EXPIRY=14d

# ── CORS ──────────────────────────────────────────────────────────────
# Comma-separated list of allowed origins
ALLOWED_ORIGINS=https://spartialiq.co.zw,https://www.spartialiq.co.zw

# ── File uploads ──────────────────────────────────────────────────────
INSPECTION_PHOTO_ROOT=/srv/spartialiq/backend/uploads/inspection-photos

# ── Email (SMTP) ──────────────────────────────────────────────────────
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=postmaster@mg.spartialiq.co.zw
SMTP_PASS=MAILGUN_SMTP_PASSWORD
EMAIL_FROM="SpartialIQ Notifications <noreply@spartialiq.co.zw>"

# ── Paynow (Zimbabwe's leading payment aggregator) ────────────────────
# https://developers.paynow.co.zw
PAYNOW_INTEGRATION_ID=YOUR_PAYNOW_INTEGRATION_ID
PAYNOW_INTEGRATION_KEY=YOUR_PAYNOW_INTEGRATION_KEY
PAYNOW_RESULT_URL=https://api.spartialiq.co.zw/api/payments/webhook/paynow
PAYNOW_RETURN_URL=https://spartialiq.co.zw/payments

# ── EcoCash (Econet C2B merchant API) ────────────────────────────────
# Contact Econet Business Sales: +263-772-101-000
ECOCASH_MERCHANT_CODE=YOUR_ECOCASH_MERCHANT_CODE
ECOCASH_API_KEY=YOUR_ECOCASH_API_KEY
ECOCASH_API_URL=https://api.ecocash.co.zw/transactions
ECOCASH_HASH_SECRET=YOUR_ECOCASH_WEBHOOK_HASH_SECRET

# ── OneMoney (NetOne C2B merchant API) ───────────────────────────────
# Contact NetOne Business: business@netone.co.zw
ONEMONEY_MERCHANT_CODE=YOUR_ONEMONEY_MERCHANT_CODE
ONEMONEY_API_KEY=YOUR_ONEMONEY_API_KEY
ONEMONEY_API_URL=https://api.onemoney.co.zw/transactions
ONEMONEY_HASH_SECRET=YOUR_ONEMONEY_WEBHOOK_HASH_SECRET

# ── Stripe (international card payments) ─────────────────────────────
# https://dashboard.stripe.com/apikeys
STRIPE_SECRET_KEY=sk_live_YOUR_STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=whsec_YOUR_STRIPE_WEBHOOK_SIGNING_SECRET

# ── Exchange rate service ─────────────────────────────────────────────
# Used to quote USD amounts in ZiG / ZWG for local payment methods.
# Leave blank to use the built-in fallback rate.
EXCHANGE_RATE_API_URL=https://open.er-api.com/v6/latest/USD
EXCHANGE_RATE_API_KEY=YOUR_EXCHANGE_RATE_API_KEY

# ── Redis (optional — for session / job queue at scale) ───────────────
# If set, the notification worker uses Redis; otherwise falls back to
# in-process polling of the notification_queue table.
# REDIS_URL=redis://localhost:6379
```

---

## 7. Payment gateway configuration

### 7.1 Paynow (primary — handles EcoCash, OneMoney, Telecash, ZIPIT)

1. Register at [https://www.paynow.co.zw](https://www.paynow.co.zw)
2. Create an integration (select "web" type)
3. Note your **Integration ID** and **Integration Key**
4. Set the **Result URL** to `https://api.spartialiq.co.zw/api/payments/webhook/paynow`
5. Set the **Return URL** to `https://spartialiq.co.zw/payments`

Paynow handles EcoCash, OneMoney, Telecash, and ZIPIT under one integration — simplest setup for Zimbabwe.

### 7.2 EcoCash direct C2B (optional — lower fees than Paynow)

1. Contact Econet Business Sales: **+263 772 101 000** or **business@econet.co.zw**
2. Request a **C2B Merchant Account** (requires business registration documents)
3. You receive: Merchant Code, API Key, and API URL
4. Set webhook URL to `https://api.spartialiq.co.zw/api/payments/webhook/ecocash`
5. Citizens can pay via USSD: `*151*1*1*MERCHANT_CODE*AMOUNT#`

### 7.3 OneMoney direct C2B (optional)

1. Contact NetOne: **business@netone.co.zw**
2. Request merchant API credentials
3. Set webhook URL to `https://api.spartialiq.co.zw/api/payments/webhook/onemoney`
4. Citizens can pay via USSD: `*111*2*MERCHANT_CODE#`

### 7.4 Stripe (international cards)

1. Create account at [https://stripe.com](https://stripe.com)
2. Go to Developers → API Keys → copy **Secret key**
3. Go to Developers → Webhooks → Add endpoint:
   - URL: `https://api.spartialiq.co.zw/api/payments/webhook/stripe`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
4. Copy the **Signing secret** (starts with `whsec_`)

### 7.5 Which driver to use

| Scenario | Recommendation |
|----------|---------------|
| Simplest setup | Paynow only (handles all local methods) |
| Lower fees on mobile | Paynow + direct EcoCash + direct OneMoney |
| International donors | Add Stripe |
| Offline / government | Manual driver (staff confirm payment on phone) |

The `isDriverLive(name)` function in `paymentDriver.js` detects which drivers are configured. The `/api/payments/methods` endpoint returns the live configuration to the frontend automatically — no code changes needed when you add/remove credentials.

---

## 8. NGINX configuration

Create `/etc/nginx/sites-available/spartialiq`:

```nginx
# SpartialIQ — Vungu RDC Spatial Platform
# nginx/sites-available/spartialiq

upstream spartialiq_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name spartialiq.co.zw www.spartialiq.co.zw api.spartialiq.co.zw;

    # ACME challenge for certbot
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect everything else to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

# ── API backend ───────────────────────────────────────────────────────
server {
    listen 443 ssl http2;
    server_name api.spartialiq.co.zw;

    ssl_certificate     /etc/letsencrypt/live/api.spartialiq.co.zw/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.spartialiq.co.zw/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # Upload size limit (for inspection photos — 10 MB + overhead)
    client_max_body_size 15M;

    # Proxy to Fastify
    location / {
        proxy_pass http://spartialiq_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
        proxy_connect_timeout 10s;
    }

    # Serve uploaded photos directly without hitting Node.js
    location /uploads/ {
        alias /srv/spartialiq/backend/uploads/;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
        try_files $uri =404;
    }
}

# ── Frontend SPA ──────────────────────────────────────────────────────
server {
    listen 443 ssl http2;
    server_name spartialiq.co.zw www.spartialiq.co.zw;

    ssl_certificate     /etc/letsencrypt/live/spartialiq.co.zw/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/spartialiq.co.zw/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://api.spartialiq.co.zw https://tiles.openfreemap.org;" always;

    root /var/www/spartialiq;
    index index.html;

    # Vite built assets — immutable hashed filenames
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    # Vector tile cache (served via the backend, but front-end caches too)
    location ~* \.pbf$ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # Vue Router — all paths serve index.html (SPA)
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
    }
}
```

Enable and test:

```bash
sudo ln -s /etc/nginx/sites-available/spartialiq /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 9. SSL / TLS

```bash
# Obtain certificates (run BEFORE enabling HTTPS server block)
sudo certbot --nginx \
  -d spartialiq.co.zw \
  -d www.spartialiq.co.zw \
  -d api.spartialiq.co.zw \
  --email admin@spartialiq.co.zw \
  --agree-tos \
  --non-interactive

# Auto-renewal (certbot installs a systemd timer automatically)
sudo systemctl status snap.certbot.renew.timer

# Verify renewal works
sudo certbot renew --dry-run
```

---

## 10. Process management

### PM2 ecosystem file

Create `/srv/spartialiq/ecosystem.config.js`:

```js
module.exports = {
  apps: [
    {
      name: 'spartialiq-backend',
      cwd: '/srv/spartialiq/backend',
      script: 'server.js',
      instances: 'max',           // cluster mode — one worker per CPU
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      out_file: '/var/log/spartialiq/backend-out.log',
      error_file: '/var/log/spartialiq/backend-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
}
```

```bash
sudo mkdir -p /var/log/spartialiq
pm2 start /srv/spartialiq/ecosystem.config.js --env production
pm2 save
pm2 startup systemd -u $USER --hp $HOME
```

### Zero-downtime deploy

```bash
cd /srv/spartialiq/backend
git pull
npm install --production
pm2 reload spartialiq-backend  # graceful reload — no dropped connections
```

---

## 11. Monitoring & logging

### Application logs

```bash
# Live tail
pm2 logs spartialiq-backend

# Error log
tail -f /var/log/spartialiq/backend-err.log

# NGINX access log
tail -f /var/log/nginx/access.log
```

### Health check endpoint

```bash
curl https://api.spartialiq.co.zw/health
# Expected: {"status":"ok","service":"spartialiq-backend","version":"2.0.0"}
```

### Logrotate

Create `/etc/logrotate.d/spartialiq`:

```
/var/log/spartialiq/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

### Optional: Uptime monitoring

- [Uptime Kuma](https://github.com/louislam/uptime-kuma) — self-hosted, free
- Monitor: `https://api.spartialiq.co.zw/health` (liveness, every 60s)
- Ready: `https://api.spartialiq.co.zw/ready` (PostGIS; fail closed before sending traffic)
- Client handoff: see `CLIENT_HANDOFF.md`

---

## 12. Database migrations

### Run a new migration

```bash
cd /srv/spartialiq/backend
PGPASSWORD=YOUR_PW psql -U spartialiq -d spartialiq_db -f migrations/NNN_description.sql
```

### Migration naming convention

Files are numbered sequentially: `001_initial_schema.sql`, `002_add_users.sql`, etc. The prefix ensures alphabetical = chronological order.

### Backup before migrating

```bash
pg_dump -U spartialiq -d spartialiq_db \
  --format=custom \
  -f /var/backups/spartialiq/pre-migration-$(date +%Y%m%d-%H%M%S).pgdump
```

### Automated daily backups

Add to `/etc/cron.daily/spartialiq-backup`:

```bash
#!/bin/bash
BACKUP_DIR=/var/backups/spartialiq
mkdir -p "$BACKUP_DIR"

pg_dump -U spartialiq -d spartialiq_db \
  --format=custom \
  -f "$BACKUP_DIR/daily-$(date +%Y%m%d).pgdump"

# Keep 30 days of backups
find "$BACKUP_DIR" -name "daily-*.pgdump" -mtime +30 -delete
```

```bash
chmod +x /etc/cron.daily/spartialiq-backup
```

---

## 13. File uploads

Inspection photos are stored on disk under `./uploads/inspection-photos/<booking_id>/<uuid>.<ext>`.

### Production recommendation

For multi-instance deployments or if the server disk fills up, migrate to object storage:

**Cloudflare R2 (free tier, S3-compatible):**
1. Create an R2 bucket at [dash.cloudflare.com](https://dash.cloudflare.com)
2. Add these env vars:
   ```env
   R2_ACCOUNT_ID=your_account_id
   R2_ACCESS_KEY=your_access_key
   R2_SECRET_KEY=your_secret_key
   R2_BUCKET=spartialiq-uploads
   R2_PUBLIC_URL=https://uploads.spartialiq.co.zw
   ```
3. Replace the `fs.writeFile` call in `src/routes/inspections.js` with an S3-compatible `PutObject` call using the `@aws-sdk/client-s3` package.

### Backup uploads

```bash
# Sync uploads to a backup location daily
rsync -az /srv/spartialiq/backend/uploads/ backup@backup-server:/backups/spartialiq/uploads/
```

---

## 14. Email / notification worker

The `src/services/notifier.js` module enqueues email jobs into the `notification_queue` table. A background worker must poll and send these.

### Start the notification worker

The worker is not yet extracted as a separate process — it currently runs inline. To add a proper worker:

```bash
# In the backend, add a worker script: workers/notificationWorker.js
# Then run it with PM2:
pm2 start workers/notificationWorker.js --name spartialiq-notifier
```

### SMTP provider options for Zimbabwe

| Provider | Notes |
|----------|-------|
| [Mailgun](https://mailgun.com) | Best deliverability, 1000 free emails/month |
| [SendGrid](https://sendgrid.com) | 100 free/day, easy DKIM setup |
| [AWS SES](https://aws.amazon.com/ses) | Cheapest at scale ($0.10 per 1000 emails) |
| [Brevo](https://brevo.com) | Free tier 300/day |

### DNS records for email (critical for deliverability)

Add to your DNS zone:

```dns
; SPF
spartialiq.co.zw. 300 IN TXT "v=spf1 include:mailgun.org ~all"

; DKIM (provided by your email provider)
krs._domainkey.spartialiq.co.zw. 300 IN TXT "v=DKIM1; k=rsa; p=..."

; DMARC
_dmarc.spartialiq.co.zw. 300 IN TXT "v=DMARC1; p=quarantine; rua=mailto:dmarc@spartialiq.co.zw"
```

---

## 15. Redis (optional but recommended)

Redis improves the server-side LRU cache (currently in-process) to work across multiple PM2 cluster workers.

```bash
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

Add to `.env`:

```env
REDIS_URL=redis://127.0.0.1:6379
```

The `src/middleware/httpCache.js` LRU cache should then be replaced with a Redis-backed cache using `ioredis`. The existing `cached(key, ttlMs, fn)` wrapper interface remains unchanged — only the storage backend changes.

---

## 16. Security checklist

### Before going live

- [ ] `JWT_SECRET` is ≥ 32 random bytes (use `crypto.randomBytes(48).toString('base64')`)
- [ ] `JWT_REFRESH_SECRET` is different from `JWT_SECRET`
- [ ] Database password is strong and not the example value
- [ ] `.env` is not committed to git (check `.gitignore`)
- [ ] `NODE_ENV=production` is set
- [ ] CORS `ALLOWED_ORIGINS` is set to your exact frontend domain(s) only
- [ ] All payment webhook secrets are set (Paynow key, EcoCash hash, etc.)
- [ ] HTTPS is enforced on all endpoints
- [ ] HSTS header is set (max-age ≥ 31536000)
- [ ] Upload directory is not publicly listable (`autoindex off` in NGINX)
- [ ] Fastify rate limiting is active (100 req/min by default)
- [ ] PostgreSQL is not exposed on port 5432 to the internet (firewall rule)
- [ ] SSH password authentication is disabled (key-only)
- [ ] `ufw` (or iptables) allows only ports 22, 80, 443

### Firewall setup

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 5432/tcp   # PostgreSQL must not be internet-accessible
sudo ufw deny 3000/tcp   # Fastify — behind NGINX only
sudo ufw enable
```

### Fastify production hardening

In `server.js`, ensure:

```js
const server = Fastify({
  logger: { level: 'warn' },  // not 'info' — too verbose in prod
  trustProxy: true,
})
```

---

## 17. First-run checklist

After deployment, run through this list top to bottom:

```
□ curl https://api.spartialiq.co.zw/health   → 200 OK
□ curl https://spartialiq.co.zw/             → index.html (Vue app)
□ Open browser → https://spartialiq.co.zw/welcome → council selector renders
□ Select "Vungu Rural District Council" → navigates to /
□ Register a citizen account → email verification received
□ Login → navigates to /citizen portal
□ Submit a development application → appears in /workflow dashboard
□ Staff login (planner) → navigate to /planner → workflow tab shows application
□ Advance application status → citizen tracking view updates
□ Test payment (use Paynow sandbox) → EcoCash USSD code appears
□ Upload an inspection photo → photo appears in booking detail
□ Map tiles load on /explorer → 24 layers render
□ Check /admin → user management works
□ Trigger a 404 → returns JSON error, not stack trace
□ Check /var/log/spartialiq/backend-err.log → no startup errors
```

---

## 18. Troubleshooting

### Backend won't start

```bash
pm2 logs spartialiq-backend --lines 50
# Common causes:
# - Missing .env → add DATABASE_URL and JWT_SECRET
# - PostgreSQL not running → sudo systemctl start postgresql
# - Port 3000 already in use → sudo lsof -i :3000
```

### Database connection refused

```bash
sudo systemctl status postgresql
sudo -u postgres psql -c "\l"  # list databases

# Check pg_hba.conf allows local connections
sudo nano /etc/postgresql/15/main/pg_hba.conf
# Ensure: local   all   all   md5
sudo systemctl reload postgresql
```

### NGINX 502 Bad Gateway

```bash
# Is the backend running?
pm2 status
curl http://localhost:3000/health

# Check NGINX error log
tail -50 /var/log/nginx/error.log

# Common fix: backend crashed, restart it
pm2 restart spartialiq-backend
```

### Payments not completing

1. Check webhook URL is reachable: `curl -X POST https://api.spartialiq.co.zw/api/payments/webhook/paynow`
2. Verify the webhook secret matches what the provider sends
3. Check NGINX is not blocking POST to `/api/payments/webhook/*`
4. Check the payment record in the database: `SELECT * FROM payments ORDER BY created_at DESC LIMIT 5;`

### Tiles not loading

```bash
# Check PostGIS is installed
psql -U spartialiq -d spartialiq_db -c "SELECT PostGIS_version();"

# Check layer registry
curl https://api.spartialiq.co.zw/api/tiles/layers

# Check a specific tile
curl -I "https://api.spartialiq.co.zw/api/tiles/provinces/5/17/14.pbf"
# Expect: 200 OK with Content-Type: application/x-protobuf
```

### JWT errors (401 Unauthorized)

```bash
# Verify JWT_SECRET matches what was used to sign tokens
# If you rotated the secret, all existing tokens are invalid — users must log in again
# This is expected behaviour; inform users if you rotate

# Check the token hasn't expired (default 12h)
# Access token expiry is set by JWT_ACCESS_EXPIRY env var
```

---

*Built by the SpartialIQ team. For support, open an issue on the project repository.*
