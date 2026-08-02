# ─── Build stage ──────────────────────────────────────────────────────────────
# node:20-slim (Debian/glibc, not Alpine/musl) so the native `argon2` module
# installs from a prebuilt binary instead of compiling from source.
FROM node:22-slim AS builder
WORKDIR /app

# Copy workspace manifests
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json        ./packages/shared/
COPY packages/api/package.json           ./packages/api/
COPY packages/db/package.json            ./packages/db/

# Install all deps (including dev for the build)
RUN npm ci --workspace=packages/shared --workspace=packages/api --workspace=packages/db

# Copy source
COPY packages/shared ./packages/shared
COPY packages/api    ./packages/api
COPY packages/db     ./packages/db

# Build shared (declarations) then the API (transpile)
RUN npm run build -w packages/shared && npm run build -w packages/api

# ─── Production stage ─────────────────────────────────────────────────────────
FROM node:22-slim AS production
WORKDIR /app
ENV NODE_ENV=production

# Run as a non-root user
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m -s /bin/sh nodejs

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json    ./packages/api/

# Production dependencies only (prebuilt argon2 binary; no compiler needed)
RUN npm ci --workspace=packages/shared --workspace=packages/api --omit=dev && \
    npm cache clean --force

# Compiled output
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/api/dist    ./packages/api/dist

USER nodejs
EXPOSE 3001

# Health check via Node (no wget/curl in the slim image)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "packages/api/dist/server.js"]
