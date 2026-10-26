FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV MALLOC_ARENA_MAX=2
ENV UV_THREADPOOL_SIZE=4

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends tini ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && \
    npx playwright install --with-deps chromium-headless-shell && \
    npm cache clean --force && \
    rm -rf /var/lib/apt/lists/* /tmp/* /root/.npm

COPY egressProxy.mjs server.mjs ./

RUN chown -R node:node /app /ms-playwright
USER node

EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--max-old-space-size=384", "server.mjs"]
