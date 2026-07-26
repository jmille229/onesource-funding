# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace manifests
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json        ./packages/shared/
COPY packages/api/package.json           ./packages/api/
COPY packages/db/package.json            ./packages/db/

# Install all deps (including dev for build)
RUN npm ci --workspace=packages/shared --workspace=packages/api --workspace=packages/db

# Copy source
COPY packages/shared ./packages/shared
COPY packages/api    ./packages/api
COPY packages/db     ./packages/db

# Build
RUN npm run build -w packages/shared && npm run build -w packages/api

# ─── Production stage ─────────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Security: run as non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json    ./packages/api/

# Install production dependencies only
RUN npm ci --workspace=packages/shared --workspace=packages/api --omit=dev && \
    npm cache clean --force

# Copy compiled output
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/api/dist    ./packages/api/dist

USER nodejs
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "packages/api/dist/server.js"]
