# Operations & Keep-Alive Monitoring

This document describes the external monitor configuration to keep the free hosting infrastructure responsive.

## UptimeRobot Monitors

### Monitor 1: Backend Keep-Alive
- **URL**: `GET {backend}/api/health`
- **Interval**: Every 5 minutes
- **Purpose**: Keeps the free Render web service warm and prevents cold start latency for visitors.
- **Render Free Hours Budget**:
  - A 31-day month has 744 hours ($31 \times 24 = 744$).
  - Render provides 750 free instance hours per calendar month per account.
  - Keeping a single web service awake continuously consumes 744 of 750 free hours, leaving 6 hours of headroom.

### Monitor 2: Database Activity Ping
- **URL**: `GET {backend}/api/health/db`
- **Interval**: Every 12 hours
- **Purpose**: Executes a lightweight query against Supabase (`prisma.job.findFirst({ select: { id: true } })`). This keeps Supabase active and prevents automatic database pausing on the free tier (which occurs after 7 days without queries).
- **Throttling**: The `/api/health/db` endpoint is throttled in-memory to at most once per 10 minutes to protect against accidental spam.

## Server Observability & Events

Out-of-job server events and errors are recorded in the `ServerEvent` table with SHA-1 fingerprinting, in-memory deduplication (60s), and a hard rate cap of 200 writes/hour:
- View recent server events: `GET /api/admin/events?level=error&limit=50` (requires `X-Admin-Secret` header).
- View edge client IP verification: `GET /api/admin/whoami` (requires `X-Admin-Secret` header).
- Automatic retention: Expired server events (>14 days) are automatically deleted by the daily maintenance loop (`runRetention`).

## Local Development & Agent Mode

When running locally, set `LOCAL_AGENT_MODE=true` in `backend/.env`:
- **All usage limits disabled:** Rate limits, daily IP/visitor quotas, and proof-of-work (PoW) verification are turned off.
- **Localhost and private targets allowed:** Test local web apps directly on loopback or private IP addresses without needing tunnels. Runs are marked as `quotaExempt`.
- **Production guard:** If `NODE_ENV=production` and `LOCAL_AGENT_MODE=true`, the backend exits fatally (`process.exit(1)`) on boot to prevent deploying with limits turned off.
- **Protections that stay on:** `JOB_TOKEN_BUDGET`, `QUEUE_MAX_WAITING_GROUPS`, and `PIPELINE_CONCURRENCY` remain active to safeguard your local machine and API key consumption.

For step-by-step deploy instructions and environment configuration, see [DEPLOY.md](./DEPLOY.md).

## Runner Sandboxing & UID Isolation

In production Docker environments, the test runner executes under strict multi-layer defense-in-depth isolation:
- **UID Model & Threat Boundary:** Because target web pages can attempt prompt-injection attacks on generated test code, AST safety checks (`codeSafety.ts`) provide defense-in-depth, but the physical security boundary is enforced at the Linux process level. The backend runs as the `node` user with only `CAP_SETUID` and `CAP_SETGID`. Tests are spawned via `/usr/bin/setpriv` as an unprivileged dedicated runner account `agtrunner` (UID 1001, shared group `agt` GID 1002).
- **Process Memory & Secret Protection:** Under Linux security semantics, `/proc/<pid>/environ` and `/proc/<pid>/mem` require matching UID or root privileges. Running the test runner as UID 1001 prevents child processes from reading backend environment variables, secrets, or memory belonging to the backend or PID 1.
- **Container Capabilities:** The backend container relies only on standard capabilities present in Docker's default capability set (`SETUID` and `SETGID`). No `--privileged` mode or extra host capabilities are required. The runner process has all ambient, inheritable, and bounding capabilities dropped (`-all`) and `no_new_privs` enforced.
- **Filesystem Permissions:** Root owns the application codebase (`/app`, mode 0755) and browser cache (`/ms-playwright`), which are strictly read-only to `agtrunner`. Test runs execute within ephemeral per-run directories (`/app/playwright-runner/tests/<runId>`) with mode 2770 (setgid) and `umask 0007`, allowing clean cleanup by group `agt`.
- **Boot Self-Check & RUNNER_UNAVAILABLE:** When `RUNNER_ISOLATION=uid` is active, the backend runs an automated self-check at boot (`selfCheck()`), verifying that `setpriv` switches to UID 1001 and that `/proc/<pid>/environ` and `/proc/1/environ` cannot be accessed. If this check fails, the runner enters a fail-safe state, logging an error and rejecting test execution with `RUNNER_UNAVAILABLE` ("Test execution is temporarily unavailable. Try again later.").
- **Execution Mutex & Reaping:** Process cleanup uses process-group signals (`kill -KILL -1`) running under `agtrunner` to reliably terminate all spawned processes (including background daemons) without requiring backend root permissions. To prevent a reaper invocation from killing concurrent test runners, test executions are serialized through an execution mutex when `RUNNER_ISOLATION=uid`.
