# Migration runner — a one-shot container that brings the schema up to date, then
# exits. Run on every deploy: it applies only migrations not yet recorded in
# schema_migrations, so re-running is a no-op.
FROM node:20-slim
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/db/package.json ./packages/db/

# tsx is a devDependency and the runner executes TypeScript directly — there is no
# build step to keep in sync, and the migrations are plain .sql either way.
RUN npm ci --workspace=packages/db && npm cache clean --force

COPY packages/db ./packages/db

RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m -s /bin/sh nodejs
USER nodejs

CMD ["npm", "run", "migrate", "-w", "packages/db"]
