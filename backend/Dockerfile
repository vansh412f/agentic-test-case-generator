# Multi-stage Dockerfile for Render (512MB RAM, 0.1 CPU, ephemeral disk)

# Stage 1: Build
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@10 --activate

# Copy workspace definitions
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY playwright-runner/package.json ./playwright-runner/
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

# Install tini for clean process reaping
RUN apt-get update && \
    apt-get install -y --no-install-recommends tini && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@10 --activate

# Copy workspace package definitions
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY playwright-runner/package.json ./playwright-runner/
COPY prisma ./prisma/

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built application and generated Prisma client from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy playwright-runner (including its node_modules) from builder
COPY --from=builder /app/playwright-runner ./playwright-runner

# Install chromium-headless-shell ONLY with OS dependencies
RUN node playwright-runner/node_modules/@playwright/test/cli.js install --with-deps chromium-headless-shell

# Setup directory permissions for non-root user 'node'
RUN mkdir -p /app/playwright-runner/tests /tmp && \
    chown -R node:node /app/playwright-runner/tests /tmp /ms-playwright

USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
