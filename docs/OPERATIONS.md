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
