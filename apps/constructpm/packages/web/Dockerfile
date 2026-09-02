# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/web/package.json    ./packages/web/

RUN npm ci --workspace=packages/shared --workspace=packages/web

COPY packages/shared ./packages/shared
COPY packages/web    ./packages/web

# Build args passed at build time (not baked into the image as secrets)
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build -w packages/shared && npm run build -w packages/web

# ─── Production stage — nginx serving static files ────────────────────────────
# 1.28 is the current stable line; 1.25 left mainline in 2024 and no longer
# receives fixes.
FROM nginx:1.28-alpine AS production

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/packages/web/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
