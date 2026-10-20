# Production Deployment Guide 

This document provides exact, copy-pasteable deployment instructions for hosting the Agentic Test Generator on free-tier infrastructure: Supabase (Database), Render (Docker Backend), and Vercel (Next.js Frontend).

---

## 1. Supabase Database Setup

### Connection URLs
Supabase provides two database URLs in **Project Settings -> Database**:
1. **Pooled Connection URL (Transaction Mode / PgBouncer, Port 6543)**:
   - Used at runtime by the backend application.
   - Requires parameter `?pgbouncer=true&connection_limit=1`.
   - Format:
     ```
     postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
     ```
2. **Direct Connection URL (Session Mode, Port 5432)**:
   - Required for running Prisma migrations (`prisma migrate deploy`), because PgBouncer does not support advisory locks and prepared statements.
   - Format:
     ```
     postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
     ```

### Applying Migrations Locally Before Deploy
Run Prisma migration deploy from your local workstation using PowerShell:

```powershell
# Set DIRECT_URL for migrations
$env:DATABASE_URL="postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"

# Apply pending migrations
cd backend
pnpm exec prisma migrate deploy
cd ..
```

---

## 2. Render Backend Deployment

### Blueprint Deployment
1. Log into [Render Dashboard](https://dashboard.render.com).
2. Click **New +** -> **Blueprint**.
3. Connect your repository and select branch `main`.
4. Render will detect `render.yaml` and configure the web service:
   - **Service Name**: `agentic-test-generator-backend`
   - **Environment**: Docker (`backend/Dockerfile`)
   - **Plan**: Free (`512 MB RAM, 0.1 CPU, 750 free hours/month`)
   - **Health Check Path**: `/api/health`
   - **Auto Deploy**: Enabled on `main` branch

### Free-Tier Operating Constraints
> [!IMPORTANT]
> - **RAM**: 512 MB hard ceiling (Docker headless Chromium shell only; main process memory tuned).
> - **CPU**: 0.1 vCPU (Timeout scaling enabled via `RUNNER_TIMEOUT_SCALE=3`).
> - **Disk**: Ephemeral (tests and artifacts are ephemeral; database is in Supabase).
> - **Inactivity Sleep**: Spins down after 15 minutes of inactivity if not pinged by UptimeRobot.
> - **Monthly Budget**: 750 free instance hours per calendar month (31 days continuous = 744 hours).

### Environment Secrets Configuration
In Render Dashboard -> **Environment Variables**, fill in values for the `sync: false` variables:

| Variable | Description | Example / Requirement |
|---|---|---|
| `DATABASE_URL` | Pooled connection string | Port 6543 with `?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | Direct connection string | Port 5432 |
| `VISITOR_SIGNING_SECRET` | HMAC key for signed visitor IDs | min 16 characters (enforced); use `openssl rand -hex 32` |
| `POW_SECRET` | ALTCHA PoW secret | min 16 characters (enforced); use `openssl rand -hex 32` |
| `ADMIN_SECRET` | Header key for admin routes (`X-Admin-Secret`) | Min 24 characters (e.g., `openssl rand -hex 24`) |
| `EDGE_SHARED_SECRET` | Shared secret with Vercel edge rewrite | Min 24 characters (must match Vercel) |
| `FRONTEND_ORIGIN` | Allowed CORS origins (comma-separated) | `https://your-app.vercel.app` |
| `GROQ_API_KEY` | Groq API Key | `gsk_...` |
| `GEMINI_API_KEY` | Gemini API Key (optional fallback) | `AIza...` |

Non-secret defaults are preset automatically via `render.yaml`:
- `NODE_ENV=production`
- `RUNNER_TIMEOUT_SCALE=3`
- `TRUST_PROXY_HOPS=1`
- `PIPELINE_CONCURRENCY=1`
- `CRAWL_CONCURRENCY=1`

---

## 3. Vercel Frontend Deployment

1. Log into [Vercel Dashboard](https://vercel.com).
2. Click **Add New** -> **Project** -> import the GitHub repository.
3. Configure the project settings:
   - **Framework Preset**: Next.js
   - **Root Directory**: `frontend`
   - **Install Command**: `pnpm install --frozen-lockfile`
   - **Build Command**: `pnpm build`
4. Add the following Environment Variables in Vercel:

| Variable | Value | Notes |
|---|---|---|
| `BACKEND_URL` | `https://agentic-test-generator-backend.onrender.com` | No trailing slash |
| `EDGE_SHARED_SECRET` | *Same secret as Render* | Authenticates Vercel edge rewrite |
| `NEXT_PUBLIC_SITE_URL` | `https://your-app.vercel.app` | Production canonical URL |
| `NEXT_PUBLIC_DEPLOYMENT_MODE` | `production` | Set to `production` |
| `NEXT_PUBLIC_STREAM_ORIGIN` | *(Optional)* `https://agentic-test-generator-backend.onrender.com` | Direct SSE fallback to Render |
| `NEXT_PUBLIC_GA_ID` | `G-XXXXXXXXXX` | Optional Google Analytics |
| `NEXT_PUBLIC_GSC_VERIFICATION` | `google-site-verification=...` | Optional search console |

5. Click **Deploy**.

---

## 4. UptimeRobot Keep-Alive Monitors

To prevent cold-starts and prevent Supabase from pausing after 7 days:

1. **Backend Keep-Alive**:
   - **Monitor Type**: HTTP(s)
   - **URL**: `https://agentic-test-generator-backend.onrender.com/api/health`
   - **Monitoring Interval**: Every 5 minutes
   - **Purpose**: Keeps Render awake continuously (744 hours in 31 days).
2. **Database Activity Ping**:
   - **Monitor Type**: HTTP(s)
   - **URL**: `https://agentic-test-generator-backend.onrender.com/api/health/db`
   - **Monitoring Interval**: Every 12 hours
   - **Purpose**: Issues a lightweight query against Supabase to reset inactivity timer.

---

## 5. Post-Deploy Checklist (Phase 9B)

1. **Smoke Test**:
   - Navigate to `https://your-app.vercel.app`.
   - Submit a test run for `https://demo.playwright.dev/todomvc`.
   - Confirm crawling, test generation, and test execution complete successfully.
2. **IP Calibration Verification**:
   - Verify that client IP is correctly extracted from Vercel edge rewrite:
     ```powershell
     curl -s -H "X-Admin-Secret: <YOUR_ADMIN_SECRET>" https://agentic-test-generator-backend.onrender.com/api/admin/whoami
     ```
   - Verify `clientIp` returns the real visitor IP rather than Vercel's internal edge IP.
3. **SSE Stream Soak Test**:
   - Hold an SSE stream through Vercel for 10 minutes:
     ```powershell
     $env:SOAK="1"; $env:BASE="https://your-app.vercel.app"; $env:JOB="<jobId>"; $env:MINUTES="10"; npx tsx scratch/sseSoak.ts
     ```
   - Verify 0 disconnects or clean reconnects with heartbeats every 15s.

---

## 6. Rollback Procedures

### Render Backend
1. Go to **Render Dashboard** -> `agentic-test-generator-backend`.
2. Click **Deploys**.
3. Select the last known good deployment.
4. Click **Rollback to this deploy**.

### Vercel Frontend
1. Go to **Vercel Dashboard** -> Project -> **Deployments**.
2. Locate the previous working deployment.
3. Click the three dots `...` -> **Promote to Production**.

---

## 7. Secrets Rotation Procedures

### `VISITOR_SIGNING_SECRET`
> [!WARNING]
> Rotating `VISITOR_SIGNING_SECRET` invalidates all existing visitor tokens.
> When rotated, returning users will be issued new anonymous visitor IDs and will lose access to their past job history in `/jobs`. Only rotate if the secret is compromised.

### `EDGE_SHARED_SECRET`
Must be updated in **both** Render and Vercel environments simultaneously:
1. Update `EDGE_SHARED_SECRET` in Render Environment Variables.
2. Update `EDGE_SHARED_SECRET` in Vercel Environment Variables.
3. Redeploy Render and Vercel.

### `ADMIN_SECRET`
Used solely for internal/admin endpoints (`/api/admin/events`, `/api/admin/whoami`).
Can be rotated anytime in Render without affecting end users.
