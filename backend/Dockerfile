# Multi-stage Dockerfile for Render (512MB RAM, 0.1 CPU, ephemeral disk)

# Stage 1: Build
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@10 --activate

# Copy workspace definitions
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY playwright-runner/package.json playwright-runner/playwright.config.ts playwright-runner/tsconfig.json playwright-runner/netGuard.mjs playwright-runner/agt-capture.ts ./playwright-runner/
COPY prisma ./prisma/

# Install all dependencies (workspace including playwright-runner)
RUN pnpm install --frozen-lockfile

# Generate Prisma Client
RUN pnpm exec prisma generate

# Copy source and build
COPY tsconfig.json ./
COPY src ./src/
RUN pnpm build

# Stage 2: Runtime
FROM node:22-bookworm-slim AS runner

# Install tini, openssl, ca-certificates, and setpriv (from setpriv or util-linux)
RUN apt-get update && \
    (apt-get install -y --no-install-recommends tini openssl ca-certificates setpriv || \
     apt-get install -y --no-install-recommends tini openssl ca-certificates util-linux) && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV RUNNER_ISOLATION=uid
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV MALLOC_ARENA_MAX=2
ENV UV_THREADPOOL_SIZE=2

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@10 --activate

# Copy workspace package definitions
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY playwright-runner/package.json ./playwright-runner/
COPY prisma ./prisma/

# Install production dependencies only and generate prisma client
RUN pnpm install --prod --frozen-lockfile && \
    pnpm exec prisma generate

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Copy playwright-runner source files from builder
COPY --from=builder /app/playwright-runner/package.json /app/playwright-runner/playwright.config.ts /app/playwright-runner/tsconfig.json /app/playwright-runner/netGuard.mjs /app/playwright-runner/agt-capture.ts ./playwright-runner/

# Install chromium-headless-shell ONLY with OS dependencies
RUN node playwright-runner/node_modules/@playwright/test/cli.js install --with-deps chromium-headless-shell

# Setup users and permissions
# Group agt (1002), user agtrunner (1001), node added to agt
# /app/playwright-runner/tests: owner node, group agt, mode 2770
RUN groupadd -g 1002 agt && \
    useradd -u 1001 -g 1002 -M -s /usr/sbin/nologin agtrunner && \
    usermod -aG agt node && \
    mkdir -p /app/playwright-runner/tests /app/playwright-runner/.traces /tmp && \
    chown node:agt /app/playwright-runner/tests && \
    chmod 2770 /app/playwright-runner/tests && \
    chown node:node /app/playwright-runner/.traces && \
    chmod 0700 /app/playwright-runner/.traces

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod 0755 /app/docker-entrypoint.sh && chown root:root /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]
