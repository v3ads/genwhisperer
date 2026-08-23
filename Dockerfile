FROM node:22-alpine AS base
WORKDIR /app

# ─── Install backend deps ─────────────────────────────────────────────────────
FROM base AS backend-deps
COPY package*.json ./
RUN npm ci --omit=dev

# ─── Build backend ────────────────────────────────────────────────────────────
FROM base AS backend-build
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
# Migrations folder is needed at build time so build:server can copy it into
# dist/migrations, which the production stage then ships to the runtime image
# (only dist/ is COPY'd to production — see line below). Without this, the
# startup runMigrations() throws "Can't find meta/_journal.json" in production.
COPY drizzle ./drizzle
RUN npm run build:server

# ─── Build frontend ───────────────────────────────────────────────────────────
FROM base AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

# ─── Production image ─────────────────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
COPY package.json ./

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/index.js"]
